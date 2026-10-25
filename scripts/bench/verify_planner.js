'use strict';
/*
 * AutoMix 规划器离线验收：真实 profile 两两配对 → 方案 / 分数 / 理由 / 耗时 / 确定性。
 * 用法: node scripts/bench/verify_planner.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const FFMPEG = path.join(ROOT, 'electron', 'bin', 'win32', 'ffmpeg.exe');
const TMP = path.join(os.tmpdir(), 'carminium-plan');

const FE = require(path.join(ROOT, 'web/analysis/frontend.js'));
const PIPE = require(path.join(ROOT, 'web/analysis/analyzer.js'));
const Planner = require(path.join(ROOT, 'web/automix_planner.js'));

const FILES = [
  ['HOYO-MiX - 垂泪之时 Lacrimosa.mp3', 'Lacrimosa'],
  ['PIKASONIC - Otona !.flac', 'Otona'],
  ['PIKASONIC - Blossom.flac', 'Blossom'],
  ['reputation\\Taylor Swift - Look What You Made Me Do.mp3', 'LWYMMD'],
  ['AURORA,HOYO-MiX - 挪德卡莱 Nod-Krai.flac', 'NodKrai'],
  ["Red (Taylor's Version)\\Taylor Swift - All Too Well (Taylor's Version).mp3", 'ATW'],
  ['Your Name. (Deluxe Edition  Original MotionPicture Soundtrack)\\RADWIMPS - Sparkle (English ver.).mp3', 'Sparkle'],
].map(([rel, label]) => ({ file: path.join('j:\\Users\\rezen\\Music', rel), label }));

function profileFor(entry, idx) {
  if (!fs.existsSync(entry.file)) return null;
  if (!fs.existsSync(TMP)) fs.mkdirSync(TMP, { recursive: true });
  const out = path.join(TMP, idx + '.f32');
  execFileSync(FFMPEG, ['-v', 'error', '-y', '-i', entry.file, '-ac', '1', '-ar', String(FE.SR), '-f', 'f32le', out], { stdio: 'ignore' });
  const buf = fs.readFileSync(out);
  fs.unlinkSync(out);
  const pcm = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
  const an = new PIPE.Analyzer({ title: entry.label, trackId: 't' + idx, durationMs: Math.round(pcm.length / FE.SR * 1000) });
  const CH = FE.SR * 30;
  for (let off = 0; off < pcm.length; off += CH) an.push(pcm.subarray(off, Math.min(pcm.length, off + CH)));
  const p = an.finish();
  // 模拟落库/取库的 JSON 往返
  return JSON.parse(JSON.stringify(p));
}

const profiles = [];
FILES.forEach((f, i) => {
  const p = profileFor(f, i);
  if (p) profiles.push(p);
});
console.log('profiles:', profiles.map((p) => p.title + '(' + p.tempo.primary + ')').join(', '));

let rows = [];
let failures = 0;
let coldMs = null;
for (let i = 0; i < profiles.length - 1; i++) {
  const a = profiles[i], b = profiles[i + 1];
  // 第一次调用包含 V8 JIT 编译，单独记录；稳态门槛只考核之后的热路径。
  // 两者都写进结果，不用"预热过的时间"冒充冷启动性能。
  if (i === 0) {
    const tc = process.hrtime.bigint();
    Planner.plan(a, b, { fallbackDurationMs: 5000, wsola: false });
    coldMs = Number(process.hrtime.bigint() - tc) / 1e6;
  }
  const t0 = process.hrtime.bigint();
  const plan = Planner.plan(a, b, { fallbackDurationMs: 5000, wsola: false });
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  const plan2 = Planner.plan(a, b, { fallbackDurationMs: 5000, wsola: false });
  const deterministic = JSON.stringify(plan) === JSON.stringify(plan2);
  if (!deterministic) failures++;
  if (ms > 5) failures++;

  rows.push({ pair: a.title + ' → ' + b.title, ms: +ms.toFixed(2), coldMs: i === 0 ? +coldMs.toFixed(2) : undefined, ...plan });
  console.log(
    `${(a.title + ' → ' + b.title).padEnd(28)} ${plan.strategy.padEnd(12)} ` +
    `exit=${(plan.exitMs / 1000).toFixed(1)}s entry=${(plan.entryMs / 1000).toFixed(1)}s ` +
    `dur=${(plan.durationMs / 1000).toFixed(1)}s bars=${plan.bars} r=${plan.ratio} ` +
    `score=${plan.score} conf=${plan.confidence} warm=${ms.toFixed(2)}ms ${deterministic ? '' : 'NON-DETERMINISTIC'}`
  );
  console.log('   ' + Planner.describe(plan));
}

fs.writeFileSync(path.join(__dirname, 'verify_planner_result.json'), JSON.stringify(rows, null, 2));
console.log(`\n冷启动首调用（含 JIT）：${coldMs == null ? 'n/a' : coldMs.toFixed(2) + 'ms'}`);
console.log(`确定性 & 热路径 <5ms：${failures === 0 ? 'PASS' : failures + ' 处失败'}`);
try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {}
