'use strict';
/*
 * 分析管线离线验收：真实歌曲 → 分块喂入 → TrackProfile。
 * 检查：耗时、profile 体积、节拍相位（同一把尺子 + 随机对照）、调性、段落、候选池。
 * 用法: node scripts/bench/verify_analysis.js [--all]
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const FFMPEG = path.join(ROOT, 'electron', 'bin', 'win32', 'ffmpeg.exe');
const TMP = path.join(os.tmpdir(), 'carminium-verify');

const FE = require(path.join(ROOT, 'web/analysis/frontend.js'));
const RHY = require(path.join(ROOT, 'web/analysis/rhythm.js'));
const PIPE = require(path.join(ROOT, 'web/analysis/analyzer.js'));

const FILES = [
  ['HOYO-MiX - 垂泪之时 Lacrimosa.mp3', 65],
  ['PIKASONIC - Otona !.flac', 120],
  ['PIKASONIC - Blossom.flac', 180],
  ['reputation\\Taylor Swift - Look What You Made Me Do.mp3', 212],
  ['AURORA,HOYO-MiX - 挪德卡莱 Nod-Krai.flac', 260],
  ["Red (Taylor's Version)\\Taylor Swift - All Too Well (Taylor's Version).mp3", 329],
  ['Your Name. (Deluxe Edition  Original MotionPicture Soundtrack)\\RADWIMPS - Sparkle (English ver.).mp3', 409],
  ["Red (Taylor's Version)\\Taylor Swift - All Too Well (10 Minute Version) (Taylor's Version) (From The Vault).mp3", 613],
].map(([rel, sec]) => ({ file: path.join('j:\\Users\\rezen\\Music', rel), sec }));

function decodeMono(file) {
  if (!fs.existsSync(TMP)) fs.mkdirSync(TMP, { recursive: true });
  const out = path.join(TMP, 'm.f32');
  execFileSync(FFMPEG, ['-v', 'error', '-y', '-i', file, '-ac', '1', '-ar', String(FE.SR), '-f', 'f32le', out], { stdio: 'ignore' });
  const buf = fs.readFileSync(out);
  fs.unlinkSync(out);
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
}

function salience(env, timesMs, hopMs, jitterMs = 25) {
  const j = Math.round(jitterMs / hopMs);
  let acc = 0, cnt = 0;
  for (const ms of timesMs) {
    const f = Math.round(ms / hopMs);
    if (f < j || f >= env.length - j) continue;
    let best = 0;
    for (let d = -j; d <= j; d++) if (env[f + d] > best) best = env[f + d];
    acc += best; cnt++;
  }
  let mean = 0;
  for (let i = 0; i < env.length; i++) mean += env[i];
  mean /= env.length || 1;
  return cnt && mean ? acc / cnt / mean : 0;
}

let failures = 0;
const rows = [];
for (const f of FILES) {
  if (!fs.existsSync(f.file)) { console.log('SKIP', f.file); continue; }
  const pcm = decodeMono(f.file);
  const CHUNK = FE.SR * 30;
  const an = new PIPE.Analyzer({ title: path.basename(f.file), trackId: 'test', filePath: f.file, durationMs: Math.round(pcm.length / FE.SR * 1000) });
  const t0 = process.hrtime.bigint();
  for (let off = 0; off < pcm.length; off += CHUNK) an.push(pcm.subarray(off, Math.min(pcm.length, off + CHUNK)));
  const profile = an.finish();
  const totalMs = Number(process.hrtime.bigint() - t0) / 1e6;

  // 用 profile 里的 onset 需要重算（profile 不含 env）→ 用同一段 PCM 再跑一次前端拿 env 打分
  const fe2 = new FE.FrameExtractor();
  fe2.push(pcm);
  const frames2 = fe2.finalize();
  const env = RHY.onsetEnvelope(frames2);
  const newSal = salience(env, profile.beats.timesMs, frames2.hopMs);
  const rnd = [];
  for (let i = 0; i < profile.beats.timesMs.length; i++) rnd.push(Math.random() * frames2.durationSec * 1000);
  const rndSal = salience(env, rnd, frames2.hopMs);

  // 前后半稳定性
  const halfMs = frames2.durationSec * 1000 / 2;
  const first = profile.beats.timesMs.filter((t) => t < halfMs);
  const second = profile.beats.timesMs.filter((t) => t >= halfMs);
  const salFirst = salience(env, first, frames2.hopMs);
  const salSecond = salience(env, second, frames2.hopMs);

  const json = JSON.stringify(profile);
  const gz = zlib.deflateRawSync(Buffer.from(json)).length;

  const row = {
    name: path.basename(f.file).slice(0, 28),
    dur: Math.round(profile.durationMs / 1000),
    costMs: Math.round(totalMs),
    msPerMin: Math.round(totalMs / (profile.durationMs / 60000)),
    bpm: profile.tempo.primary,
    conf: profile.tempo.confidence,
    stab: profile.tempo.stability,
    cands: profile.tempo.candidates.map((c) => c.bpm + c.family[0]).join(' '),
    beats: profile.beats.timesMs.length,
    bar: profile.beats.beatsPerBar,
    phrase: profile.beats.phraseBeats,
    key: profile.key.name + '@' + profile.key.confidence,
    segs: profile.segments.map((s) => s.type[0]).join(''),
    exits: profile.mixPoints.exits.length,
    entries: profile.mixPoints.entries.length,
    version: profile.v,
    edges: profile.edges,
    lowMean: +(profile.frames.lowRatio.reduce((s, v) => s + v, 0) / profile.frames.lowRatio.length).toFixed(3),
    transientMean: +(profile.frames.transient.reduce((s, v) => s + v, 0) / profile.frames.transient.length).toFixed(3),
    finite: profile.frames.lowRatio.every(Number.isFinite) && profile.frames.transient.every(Number.isFinite),
    salNew: +newSal.toFixed(2),
    salRnd: +rndSal.toFixed(2),
    ratio: +(newSal / (rndSal || 1)).toFixed(2),
    salFirst: +salFirst.toFixed(2),
    salSecond: +salSecond.toFixed(2),
    kb: Math.round(json.length / 1024),
    gzKb: Math.round(gz / 1024),
  };
  rows.push(row);
  if (row.ratio < 1.7) failures++;
  if (row.version !== PIPE.PROFILE_VERSION || !row.finite) failures++;
  console.log(
    `${String(row.dur).padStart(4)}s  ${String(row.costMs).padStart(5)}ms (${String(row.msPerMin).padStart(4)} ms/min)  ` +
    `bpm=${String(row.bpm).padStart(6)} conf=${row.conf}  拍=${String(row.beats).padStart(4)} ${row.bar}/4 乐句=${row.phrase}  ` +
    `key=${row.key.padEnd(9)} 段=${row.segs.padEnd(6)} 候选=${row.exits}/${row.entries}  ` +
    `low=${row.lowMean} tr=${row.transientMean}  ` +
    `salience=${row.salNew} vs rnd ${row.salRnd} (${row.ratio}x)  前/后=${row.salFirst}/${row.salSecond}  ` +
    `profile=${row.kb}KB(gz ${row.gzKb}KB)  ` +
    `edge(tail/head)=${row.edges.tailSilenceMs === null ? 'TRUNC' : row.edges.tailSilenceMs}/${row.edges.headSilenceMs}ms`
  );
}

fs.writeFileSync(path.join(__dirname, 'verify_analysis_result.json'), JSON.stringify(rows, null, 2));
console.log(`\n门槛（网格显著度 >=1.7x 随机、profile v${PIPE.PROFILE_VERSION}、区间特征有限）：${failures === 0 ? 'PASS' : failures + ' 项未过'}`);
try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {}
