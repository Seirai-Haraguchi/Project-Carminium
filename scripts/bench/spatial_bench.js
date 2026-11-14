'use strict';
/*
 * 多声道空间化离线基准。
 *
 *   node scripts/bench/spatial_bench.js
 *
 * 1) 用仓库自带 ffmpeg 合成 5.1 / 7.1 素材（每声道内容不同），再按播放链路的口径
 *    （aformat 强制布局 → f32le 交织）解回 PCM —— 走的是真实解码路径。
 * 2) 双耳线索：单声道稳态音，测左右耳电平与到达时差（4kHz 测 ILD，300Hz 测 ITD）。
 * 3) 音色保真：单声道白噪 → 与标准下混逐八度带比对（应该 ≈ 0dB）。
 * 4) 响度 / 相关度 / 单声道折叠：空间化 vs 旁路。
 * 5) CPU：8 秒 5.1、6 秒 7.1 的实时倍率。
 *
 * 素材是合成的（每声道独立正弦 / 噪声），不是商业 Atmos 混音；主观听感无法在此判定，
 * 只给客观指标 + 落盘可听文件（_preview/spatial/*.wav）。
 */

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const SP = require('../../web/spatial_core.js');

const SR = 44100;
const BLOCK = 128;
const ROOT = path.resolve(__dirname, '../..');
const FFMPEG = path.join(ROOT, 'electron/bin/win32/ffmpeg.exe');
const OUT_DIR = path.join(ROOT, '_preview/spatial');

function ff(args) {
  return execFileSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', ...args], { maxBuffer: 1 << 28 });
}

function ensureDir(dir) { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); }

// ---------------------------------------------------------------- 素材

const SOURCES = {
  music51: {
    channels: 6, layout: '5.1',
    expr: [
      '0.16*sin(2*PI*440*t)+0.09*(random(0)-0.5)',
      '0.16*sin(2*PI*554*t)+0.09*(random(1)-0.5)',
      '0.20*sin(2*PI*300*t)*(0.55+0.45*sin(2*PI*2.7*t))',
      '0.30*sin(2*PI*55*t)',
      '0.16*sin(2*PI*660*t)+0.09*(random(2)-0.5)',
      '0.16*sin(2*PI*880*t)+0.09*(random(3)-0.5)',
    ],
  },
  music71: {
    channels: 8, layout: '7.1',
    expr: [
      '0.14*sin(2*PI*440*t)+0.08*(random(0)-0.5)',
      '0.14*sin(2*PI*554*t)+0.08*(random(1)-0.5)',
      '0.18*sin(2*PI*300*t)*(0.55+0.45*sin(2*PI*2.7*t))',
      '0.26*sin(2*PI*55*t)',
      '0.12*sin(2*PI*700*t)+0.08*(random(2)-0.5)',
      '0.12*sin(2*PI*830*t)+0.08*(random(3)-0.5)',
      '0.12*sin(2*PI*990*t)+0.08*(random(4)-0.5)',
      '0.12*sin(2*PI*1120*t)+0.08*(random(5)-0.5)',
    ],
  },
  noise51: {
    // 6 路独立粉噪（amerge）：aevalsrc 的 random() 各声道相关性太高，测不出真实统计
    channels: 6, layout: '5.1', mergeNoise: 6,
  },
};

function makeSource(name, seconds) {
  ensureDir(OUT_DIR);
  const spec = SOURCES[name];
  const file = path.join(OUT_DIR, `src_${name}.wav`);
  if (fs.existsSync(file)) return { file, channels: spec.channels, layout: spec.layout };

  if (spec.mergeNoise) {
    const args = ['-y'];
    for (let i = 0; i < spec.mergeNoise; i++) {
      args.push('-f', 'lavfi', '-i', `anoisesrc=color=pink:amplitude=0.25:duration=${seconds}:sample_rate=${SR}`);
    }
    args.push('-filter_complex', `amerge=inputs=${spec.mergeNoise},aformat=channel_layouts=${spec.layout}`,
      '-c:a', 'pcm_f32le', file);
    ff(args);
  } else {
    ff(['-y', '-f', 'lavfi',
      '-i', `aevalsrc=${spec.expr.join('|')}:s=${SR}:d=${seconds}:c=${spec.layout}`,
      '-c:a', 'pcm_f32le', file]);
  }
  return { file, channels: spec.channels, layout: spec.layout };
}

// 与 DecoderPool 同口径
function decode(file, layout, channels) {
  const buf = ff(['-v', 'quiet', '-i', file,
    '-af', `aformat=sample_fmts=flt:channel_layouts=${layout}`,
    '-f', 'f32le', '-ar', String(SR), '-ac', String(channels), 'pipe:1']);
  const inter = new Float32Array(buf.buffer, buf.byteOffset, buf.length / 4);
  const frames = Math.floor(inter.length / channels);
  const planar = [];
  for (let c = 0; c < channels; c++) planar.push(new Float32Array(frames));
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < channels; c++) planar[c][i] = inter[i * channels + c];
  }
  return { planar, frames };
}

// ---------------------------------------------------------------- 运行

function run(engine, planar, frames, sink) {
  const L = sink ? sink.L : new Float32Array(frames);
  const R = sink ? sink.R : new Float32Array(frames);
  const chL = new Float32Array(BLOCK);
  const chR = new Float32Array(BLOCK);
  const slice = [];
  for (let c = 0; c < planar.length; c++) slice.push(null);
  let ok = false;
  for (let i = 0; i < frames; i += BLOCK) {
    const n = Math.min(BLOCK, frames - i);
    for (let c = 0; c < planar.length; c++) slice[c] = planar[c].subarray(i, i + n);
    ok = engine.process(slice, n, chL, chR);
    for (let k = 0; k < n; k++) {
      L[i + k] = ok ? chL[k] : 0;
      R[i + k] = ok ? chR[k] : 0;
    }
  }
  return { L, R };
}

function runBypass(engine, planar, frames) {
  const L = new Float32Array(frames), R = new Float32Array(frames);
  const chL = new Float32Array(BLOCK), chR = new Float32Array(BLOCK);
  const slice = [];
  for (let c = 0; c < planar.length; c++) slice.push(null);
  for (let i = 0; i < frames; i += BLOCK) {
    const n = Math.min(BLOCK, frames - i);
    for (let c = 0; c < planar.length; c++) slice[c] = planar[c].subarray(i, i + n);
    engine.downmixBypass(slice, n, chL, chR, planar.length);
    for (let k = 0; k < n; k++) { L[i + k] = chL[k]; R[i + k] = chR[k]; }
  }
  return { L, R };
}

function rms(x, from, to) {
  const a = from || 0, b = to === undefined ? x.length : to;
  let s = 0;
  for (let i = a; i < b; i++) s += x[i] * x[i];
  return Math.sqrt(s / Math.max(1, b - a));
}

function db(x) { return 20 * Math.log10(Math.max(1e-12, x)); }

// 单频复幅值（稳态段）
function probeTone(x, f, start, end) {
  const w = 2 * Math.PI * f / SR, cw = Math.cos(w), sw = Math.sin(w);
  let s1 = 0, s2 = 0;
  for (let i = start; i < end; i++) { const s0 = x[i] + 2 * cw * s1 - s2; s2 = s1; s1 = s0; }
  const re = s1 - cw * s2, im = sw * s2;
  return { mag: 2 * Math.hypot(re, im) / (end - start), ph: Math.atan2(im, re) };
}

function wrapPi(p) {
  while (p > Math.PI) p -= 2 * Math.PI;
  while (p < -Math.PI) p += 2 * Math.PI;
  return p;
}

// 双耳线索：逐声道单频稳态（关掉反射，只看直达 + 头影）
function binauralCues(layout, channels) {
  const rows = [];
  const dur = Math.round(SR * 0.5);
  const s0 = Math.round(SR * 0.2), s1 = dur;

  for (let c = 0; c < channels; c++) {
    const engine = new SP.SpatialEngine({
      sampleRate: SR, channels, layout,
      // 定位线索只测直达+头影：反射和尾音会污染相位测量
      params: Object.assign({}, SP.DEFAULTS, { reflections: 0, tail: 0 }),
    });
    const isLfe = engine.roles[c] === 'LFE';
    const mk = (f) => {
      const planar = [];
      for (let k = 0; k < channels; k++) planar.push(new Float32Array(dur));
      for (let i = 0; i < dur; i++) planar[c][i] = 0.5 * Math.sin(2 * Math.PI * f * i / SR);
      engine.configure(channels, layout, true);
      return run(engine, planar, dur);
    };

    // LFE 只验电平（60Hz 在低通通带内），其余声道 300Hz 测 ITD、4kHz 测 ILD
    const low = mk(isLfe ? 60 : 300);
    const high = mk(isLfe ? 60 : 4000);
    const lmL = probeTone(low.L, isLfe ? 60 : 300, s0, s1);
    const lmR = probeTone(low.R, isLfe ? 60 : 300, s0, s1);
    const hmL = probeTone(high.L, isLfe ? 60 : 4000, s0, s1);
    const hmR = probeTone(high.R, isLfe ? 60 : 4000, s0, s1);

    // 相位差 → 时差；正 = 右耳更晚（音源在左侧）
    const dphi = wrapPi(lmR.ph - lmL.ph);
    const itdUs = Math.round(-dphi / (2 * Math.PI * 300) * 1e6);

    // 定位清晰度：单声道激励时两耳的相关度（1 = 点状声源，低 = 一片弥散）
    const iacc = (() => {
      let ll = 0, rr = 0, lr = 0;
      for (let i = s0; i < s1; i++) {
        ll += low.L[i] * low.L[i]; rr += low.R[i] * low.R[i]; lr += low.L[i] * low.R[i];
      }
      const d = Math.sqrt(ll * rr);
      return d > 0 ? lr / d : 0;
    })();

    rows.push({
      ch: engine.roles[c],
      levelL: +db(lmL.mag).toFixed(1),
      levelR: +db(lmR.mag).toFixed(1),
      ild4k: +(db(hmL.mag) - db(hmR.mag)).toFixed(1),
      itdUs: isLfe ? 0 : itdUs,
      iacc: +iacc.toFixed(2),
    });
  }
  return rows;
}

// 音色保真：只给 FL 白噪。近耳（L）应该是一条平的，任何起伏都是引擎自己加的染色；
// 远耳（R）的滚降是头影，属于意图内的声学线索，单独看形状是否合理。
function tonalFidelity(layout, channels, params) {
  const engine = new SP.SpatialEngine({ sampleRate: SR, channels, layout, params });
  const frames = SR * 3;
  const planar = [];
  let seed = 987654321;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 - 0.5; };
  for (let c = 0; c < channels; c++) planar.push(new Float32Array(frames));
  for (let i = 0; i < frames; i++) planar[0][i] = 0.25 * rnd();
  const out = run(engine, planar, frames);

  const edges = [62, 125, 250, 500, 1000, 2000, 4000, 8000];
  const bandEnergy = (x) => edges.map((f0) => {
    const f1 = f0 * 2;
    let sum = 0;
    for (let k = 0; k < 16; k++) {
      const f = f0 * Math.pow(f1 / f0, k / 15);
      sum += probeTone(x, f, SR, x.length).mag;
    }
    return sum;
  });
  const ref = bandEnergy(planar[0]);
  const gotL = bandEnergy(out.L);
  const gotR = bandEnergy(out.R);
  return edges.map((f, i) => ({
    band: `${f}-${f * 2}`,
    devL: +(db(gotL[i] / ref[i])).toFixed(2),
    devR: +(db(gotR[i] / ref[i])).toFixed(2),
  }));
}

function correlation(L, R) {
  let ll = 0, rr = 0, lr = 0;
  for (let i = 0; i < L.length; i++) { ll += L[i] * L[i]; rr += R[i] * R[i]; lr += L[i] * R[i]; }
  const d = Math.sqrt(ll * rr);
  return d > 0 ? lr / d : 0;
}

function writeWav16(file, L, R) {
  const n = L.length;
  const buf = Buffer.alloc(44 + n * 4);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 4, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(2, 22); buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 4, 28);
  buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(n * 4, 40);
  let o = 44;
  for (let i = 0; i < n; i++) {
    for (const v of [L[i], R[i]]) {
      const s = Math.max(-1, Math.min(1, v));
      buf.writeInt16LE(Math.round(s * 32767), o); o += 2;
    }
  }
  fs.writeFileSync(file, buf);
}

// ---------------------------------------------------------------- main

function levelOf(planar, frames, layout, channels, params) {
  const engine = new SP.SpatialEngine({ sampleRate: SR, channels, layout, params });
  const sp = run(engine, planar, frames);
  const by = runBypass(engine, planar, frames);
  const rmsSp = Math.sqrt((rms(sp.L) ** 2 + rms(sp.R) ** 2) / 2);
  const rmsBy = Math.sqrt((rms(by.L) ** 2 + rms(by.R) ** 2) / 2);
  const peak = (x) => x.reduce((a, v) => Math.max(a, Math.abs(v)), 0);
  const mono = (a, b) => {
    const m = new Float32Array(a.length);
    for (let i = 0; i < a.length; i++) m[i] = 0.5 * (a[i] + b[i]);
    return m;
  };
  return {
    sp, by,
    bypassRmsDb: +db(rmsBy).toFixed(2),
    spatialRmsDb: +db(rmsSp).toFixed(2),
    deltaDb: +(db(rmsSp) - db(rmsBy)).toFixed(2),
    bypassPeak: +Math.max(peak(by.L), peak(by.R)).toFixed(3),
    spatialPeak: +Math.max(peak(sp.L), peak(sp.R)).toFixed(3),
    bypassCorr: +correlation(by.L, by.R).toFixed(3),
    spatialCorr: +correlation(sp.L, sp.R).toFixed(3),
    monoDeltaDb: +(db(rms(mono(sp.L, sp.R))) - db(rms(mono(by.L, by.R)))).toFixed(2),
  };
}

function main() {
  ensureDir(OUT_DIR);
  const report = { version: SP.VERSION, sampleRate: SR, block: BLOCK };

  const m51src = makeSource('music51', 8);
  const m71src = makeSource('music71', 6);
  const n51src = makeSource('noise51', 6);
  const m51 = decode(m51src.file, '5.1', 6);
  const m71 = decode(m71src.file, '7.1', 8);
  const n51 = decode(n51src.file, '5.1', 6);

  const params = Object.assign({}, SP.DEFAULTS);

  report.cues51 = binauralCues('5.1', 6);
  report.cues71 = binauralCues('7.1', 8);
  report.tonal = tonalFidelity('5.1', 6, Object.assign({}, params, { reflections: 0 }));

  const lv = levelOf(m51.planar, m51.frames, '5.1', 6, params);
  report.level51 = {
    bypassRmsDb: lv.bypassRmsDb, spatialRmsDb: lv.spatialRmsDb, deltaDb: lv.deltaDb,
    bypassPeak: lv.bypassPeak, spatialPeak: lv.spatialPeak,
    bypassCorr: lv.bypassCorr, spatialCorr: lv.spatialCorr, monoDeltaDb: lv.monoDeltaDb,
  };
  const lv7 = levelOf(m71.planar, m71.frames, '7.1', 8, params);
  report.level71 = { deltaDb: lv7.deltaDb, spatialPeak: lv7.spatialPeak, spatialCorr: lv7.spatialCorr };
  const lvN = levelOf(n51.planar, n51.frames, '5.1', 6, params);
  report.levelNoise = { deltaDb: lvN.deltaDb, spatialPeak: lvN.spatialPeak, spatialCorr: lvN.spatialCorr };

  // 立体声必须完全不激活
  const e2 = new SP.SpatialEngine({ sampleRate: SR, channels: 2, layout: 'stereo', params });
  const stPlanar = [new Float32Array(256), new Float32Array(256)];
  stPlanar[0][10] = 0.5;
  const stOut = run(e2, stPlanar, 256);
  report.stereoBypass = { active: e2.active, outputSilent: stOut.L.every((v) => v === 0) };

  // CPU
  const t0 = process.hrtime.bigint();
  const e5 = new SP.SpatialEngine({ sampleRate: SR, channels: 6, layout: '5.1', params });
  run(e5, m51.planar, m51.frames);
  const t1 = process.hrtime.bigint();
  const e8 = new SP.SpatialEngine({ sampleRate: SR, channels: 8, layout: '7.1', params });
  run(e8, m71.planar, m71.frames);
  const t2 = process.hrtime.bigint();
  report.cpu = {
    realtimeFactor51: +((m51.frames / SR) / (Number(t1 - t0) / 1e9)).toFixed(1),
    realtimeFactor71: +((m71.frames / SR) / (Number(t2 - t1) / 1e9)).toFixed(1),
    cpuPercent51: +(100 / ((m51.frames / SR) / (Number(t1 - t0) / 1e9))).toFixed(2),
    heapMb: +(process.memoryUsage().heapUsed / 1048576).toFixed(1),
  };

  let bad = 0;
  for (let i = 0; i < lv.sp.L.length; i++) {
    if (!isFinite(lv.sp.L[i]) || !isFinite(lv.sp.R[i])) bad++;
  }
  report.nonFinite = bad;

  if (process.argv.includes('--wav')) {
    // A/B 素材：music 用来听声像，noise 用来听音色/亮度（宽带）
    writeWav16(path.join(OUT_DIR, 'A_spatial_music51.wav'), lv.sp.L, lv.sp.R);
    writeWav16(path.join(OUT_DIR, 'B_bypass_music51.wav'), lv.by.L, lv.by.R);
    const nOut = run(new SP.SpatialEngine({ sampleRate: SR, channels: 6, layout: '5.1', params }),
      n51.planar, n51.frames);
    const nb = runBypass(new SP.SpatialEngine({ sampleRate: SR, channels: 6, layout: '5.1', params }),
      n51.planar, n51.frames);
    writeWav16(path.join(OUT_DIR, 'A_spatial_noise51.wav'), nOut.L, nOut.R);
    writeWav16(path.join(OUT_DIR, 'B_bypass_noise51.wav'), nb.L, nb.R);
    report.wav = OUT_DIR;
  }

  console.log(JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, 'bench_result.json'), JSON.stringify(report, null, 2));
}

main();
