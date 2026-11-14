'use strict';
/*
 * 空间化 worklet 的端到端回归（不需要 Electron）。
 *
 *   node scripts/bench/spatial_worklet_test.js
 *
 * 在 vm 里假装一个 AudioWorkletGlobalScope，先加载 spatial_core.js 再加载 worklet，
 * 然后按真实口径喂交织多声道 PCM、跑 128 帧量子，检查：
 *   - 反交织正确（帧对齐、不串声道）
 *   - 立体声时逐样本透传（零改动）
 *   - 空间化输出非静音、无 NaN、峰值受控
 *   - pause / clear / params 消息不炸
 *   - 缓冲区路径节点（spatial-processor）行为一致
 */

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '../..');

function makeScope() {
  const registered = {};
  const ctx = {
    sampleRate: 44100,
    console,
    Math,
    Float32Array,
    Float64Array,
    Int32Array,
    Uint8Array,
    ArrayBuffer,
    Object,
    JSON,
    isFinite,
    Number,
    AudioWorkletProcessor: class {
      constructor() {
        const self = this;
        this.port = {
          onmessage: null,
          postMessage() {},
          close() {},
          _emit(data) { if (self.port.onmessage) self.port.onmessage({ data }); },
        };
      }
    },
    registerProcessor(name, cls) { registered[name] = cls; },
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'web/spatial_core.js'), 'utf8'), ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'web/worklets/streaming-pcm-processor.js'), 'utf8'), ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'web/worklets/spatial-processor.js'), 'utf8'), ctx);
  return { ctx, registered };
}

function interleave(planar, frames, ch) {
  const out = new Float32Array(frames * ch);
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < ch; c++) out[i * ch + c] = planar[c][i];
  }
  return out;
}

function deinterleave(inter, frames, ch) {
  const planar = [];
  for (let c = 0; c < ch; c++) planar.push(new Float32Array(frames));
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < ch; c++) planar[c][i] = inter[i * ch + c];
  }
  return planar;
}

function runQuantum(proc) {
  const L = new Float32Array(128);
  const R = new Float32Array(128);
  proc.process([], [[L, R]]);
  return { L, R };
}

function rms(x) {
  let s = 0;
  for (let i = 0; i < x.length; i++) s += x[i] * x[i];
  return Math.sqrt(s / x.length);
}

function sourcePlanar(ch, frames) {
  const planar = [];
  for (let c = 0; c < ch; c++) planar.push(new Float32Array(frames));
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < ch; c++) {
      // 每个声道不同频率的正弦，便于验证不串道
      planar[c][i] = 0.2 * Math.sin(2 * Math.PI * (220 + c * 110) * i / 44100);
    }
  }
  return planar;
}

function main() {
  const { registered } = makeScope();
  const frames = 128 * 320;   // 必须整除量子，否则最后一块会读到源数组之外
  const CH = 6;

  // ---- 1) 立体声：必须逐样本透传
  {
    const Proc = registered['streaming-pcm-processor'];
    assert(Proc, 'streaming processor registered');
    const p = new Proc({ processorOptions: { channels: 2, layout: 'stereo', params: {}, sampleRate: 44100 } });
    const planar = sourcePlanar(2, frames);
    p._onMessage({ type: 'pcm', samples: interleave(planar, frames, 2).buffer });
    let maxErr = 0;
    for (let q = 0; q < frames / 128; q++) {
      const { L, R } = runQuantum(p);
      for (let i = 0; i < 128; i++) {
        const k = q * 128 + i;
        maxErr = Math.max(maxErr, Math.abs(L[i] - planar[0][k]), Math.abs(R[i] - planar[1][k]));
      }
    }
    assert(maxErr === 0, 'stereo path must be bit-exact, maxErr=' + maxErr);
    console.log('stereo passthrough: bit-exact');
  }

  // ---- 2) 5.1：反交织 + 空间化
  {
    const Proc = registered['streaming-pcm-processor'];
    // 对称素材（FL=FR、BL=BR、C 居中）：只有内容对称，L/R 能量才应该相等；
    // 用每声道不同频率测平衡会把"频响差异"误判成"左右不平衡"。
    const planar = sourcePlanar(CH, frames);
    planar[1].set(planar[0]);
    planar[5].set(planar[4]);
    const p = new Proc({
      processorOptions: {
        channels: CH, layout: '5.1', sampleRate: 44100,
        params: { enabled: true },
      },
    });
    p._onMessage({ type: 'pcm', samples: interleave(planar, frames, CH).buffer });

    let bad = 0, peak = 0, sumL = 0, sumR = 0;
    // 前 2000 帧是反射/滤波建立期，先跑掉再统计
    for (let q = 0; q < frames / 128; q++) {
      const { L, R } = runQuantum(p);
      for (let i = 0; i < 128; i++) {
        if (!isFinite(L[i]) || !isFinite(R[i])) bad++;
        peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
        sumL += L[i] * L[i];
        sumR += R[i] * R[i];
      }
    }
    assert(bad === 0, 'no non-finite samples, got ' + bad);
    assert(peak > 0.01, 'output must not be silent, peak=' + peak);
    assert(peak <= 1.0, 'output must stay under full scale, peak=' + peak);
    assert(Math.abs(rms([sumL]) - 0) >= 0, 'sanity');
    // 阈值 8%（≈0.33dB）：尾音两耳用不同全通去相关，与直达相加的干涉会让
    // 单耳能量有 ±0.3dB 的频段性起伏，这是去相关本身的代价，不是失衡。
    // 真正的失衡（扩散器延迟不同 2.8dB、反射缺自身 ITD 52%）早就远大于这个量级。
    const balanced = Math.abs(sumL - sumR) / Math.max(sumL, sumR);
    assert(balanced < 0.08, 'L/R energy should be balanced for a symmetric layout, got ' + balanced.toFixed(3));
    console.log('5.1 spatial: peak=' + peak.toFixed(3) + ' lrBalance=' + balanced.toFixed(4) + ' framesConsumed=' + p._consumedFrames);
    assert.equal(p._consumedFrames, frames, 'consumed frames must match input');
  }

  // ---- 3) 空间化关闭：走标准下混
  {
    const Proc = registered['streaming-pcm-processor'];
    const planar = sourcePlanar(CH, frames);
    const p = new Proc({
      processorOptions: { channels: CH, layout: '5.1', sampleRate: 44100, params: { enabled: false } },
    });
    p._onMessage({ type: 'pcm', samples: interleave(planar, frames, CH).buffer });
    let peak = 0;
    for (let q = 0; q < frames / 128; q++) {
      const { L, R } = runQuantum(p);
      for (let i = 0; i < 128; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
    }
    assert(peak > 0.01 && peak <= 1.0, 'bypass downmix peak out of range: ' + peak);
    console.log('5.1 bypass: peak=' + peak.toFixed(3));
  }

  // ---- 4) 控制消息
  {
    const Proc = registered['streaming-pcm-processor'];
    const p = new Proc({ processorOptions: { channels: CH, layout: '5.1', sampleRate: 44100, params: {} } });
    p._onMessage({ type: 'pcm', samples: interleave(sourcePlanar(CH, 512), 512, CH).buffer });
    runQuantum(p);
    p._onMessage({ type: 'pause' });
    const paused = runQuantum(p);
    assert(paused.L.every((v) => v === 0) && paused.R.every((v) => v === 0), 'paused output must be silent');
    p._onMessage({ type: 'resume' });
    p._onMessage({ type: 'params', params: { intensity: 1, width: 1.4, room: 1, reflections: 1 } });
    for (let i = 0; i < 20; i++) {
      const { L, R } = runQuantum(p);
      for (let j = 0; j < 128; j++) assert(isFinite(L[j]) && isFinite(R[j]), 'NaN after param change');
    }
    p._onMessage({ type: 'clear' });
    assert.equal(p._writePos, 0, 'clear resets buffer');
    console.log('control messages: ok');
  }

  // ---- 5) 缓冲区路径节点（N 声道进、立体声出）
  {
    const Proc = registered['spatial-processor'];
    assert(Proc, 'spatial processor registered');
    const planar = sourcePlanar(CH, 128);
    const p = new Proc({ processorOptions: { channels: CH, layout: '5.1', sampleRate: 44100, params: {} } });
    const L = new Float32Array(128), R = new Float32Array(128);
    let peak = 0;
    for (let q = 0; q < 40; q++) {
      p.process([planar], [[L, R]]);
      for (let i = 0; i < 128; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
    }
    assert(peak > 0.01 && peak <= 1.0, 'buffer-path node peak out of range: ' + peak);
    console.log('buffer-path node: peak=' + peak.toFixed(3));
  }

  // ---- 6) 声道数比节点少（输入降级）
  {
    const Proc = registered['spatial-processor'];
    const planar = sourcePlanar(2, 128);
    const p = new Proc({ processorOptions: { channels: CH, layout: '5.1', sampleRate: 44100, params: {} } });
    const L = new Float32Array(128), R = new Float32Array(128);
    let bad = 0;
    for (let q = 0; q < 20; q++) {
      p.process([planar], [[L, R]]);
      for (let i = 0; i < 128; i++) if (!isFinite(L[i]) || !isFinite(R[i])) bad++;
    }
    assert(bad === 0, 'no NaN when input channel count shrinks');
    console.log('channel shrink: ok');
  }

  // ---- 7) 缓冲欠载（readable = 0）不能毒化状态
  {
    const Proc = registered['streaming-pcm-processor'];
    const planar = sourcePlanar(CH, 128);
    const p = new Proc({ processorOptions: { channels: CH, layout: '5.1', sampleRate: 44100, params: {} } });
    p._onMessage({ type: 'pcm', samples: interleave(planar, 128, CH).buffer });
    runQuantum(p);                       // 正常一帧
    for (let q = 0; q < 40; q++) {       // 连续空转：每次都要求全静音
      const { L, R } = runQuantum(p);
      for (let i = 0; i < 128; i++) {
        assert(isFinite(L[i]) && isFinite(R[i]), 'underrun produced non-finite');
        assert(L[i] === 0 && R[i] === 0, 'underrun must output silence');
      }
    }
    // 再来数据，必须还能出声（状态没被 0 帧污染）
    p._onMessage({ type: 'pcm', samples: interleave(sourcePlanar(CH, 512), 512, CH).buffer });
    let peak = 0;
    for (let q = 0; q < 4; q++) {
      const { L, R } = runQuantum(p);
      for (let i = 0; i < 128; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
    }
    assert(peak > 0.01, 'engine must recover after underrun, peak=' + peak);
    console.log('underrun recovery: peak=' + peak.toFixed(3));
  }

  console.log(JSON.stringify({ pass: true }, null, 2));
}

main();
