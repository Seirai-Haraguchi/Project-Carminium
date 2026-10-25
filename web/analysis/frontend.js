'use strict';
/*
 * 分析前端：增量 STFT → mel / chroma / rms / flux / centroid / flatness。
 *
 * 设计约束：
 * - 纯计算，无 DOM/IPC 依赖，浏览器（Worker）与 Node（基准脚本/单测）双用。
 * - 增量：可把长曲按 30s 分块喂进来，只保留一个 N 样本的尾巴，峰值内存与曲长无关。
 * - 采样率固定 22050（分析用；播放仍是 44100）。44.1k → 22.05k 由 ffmpeg 负责抽取（-ar 22050），
 *   这里不再做重采样，避免两处滤波叠加。
 *
 * 帧率 = 22050 / 256 = 86.13 fps（11.6ms），足够节拍相位精度（±12ms），比 50ms 能量窗好 4 倍。
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (typeof root !== 'undefined') root.AnalysisFrontend = api;
})(typeof self !== 'undefined' ? self : this, function () {
  var SR = 22050;
  var N = 1024;
  var HOP = 256;
  var MEL_BANDS = 40;
  var MEL_FMIN = 30;
  var MEL_FMAX = 10000;
  var CHROMA_FMIN = 55;
  var CHROMA_FMAX = 5000;
  var VOCAL_LO = 300;
  var VOCAL_HI = 3400;
  var LOW_MEL_HZ = 200;

  function hz2mel(f) { return 2595 * Math.log10(1 + f / 700); }
  function mel2hz(m) { return 700 * (Math.pow(10, m / 2595) - 1); }

  /* ---------------- FFT (radix-2, 原地缓冲复用) ---------------- */
  function createFFT(n) {
    var bits = Math.round(Math.log2(n));
    var rev = new Uint32Array(n);
    for (var i = 0; i < n; i++) {
      var r = 0;
      for (var b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
      rev[i] = r;
    }
    var cos = new Float64Array(n / 2);
    var sin = new Float64Array(n / 2);
    for (var k = 0; k < n / 2; k++) {
      cos[k] = Math.cos(2 * Math.PI * k / n);
      sin[k] = Math.sin(2 * Math.PI * k / n);
    }
    var re = new Float64Array(n);
    var im = new Float64Array(n);
    var mag = new Float64Array(n / 2 + 1);

    return function fft(input) {
      for (var i2 = 0; i2 < n; i2++) {
        var j = rev[i2];
        re[j] = input[i2];
        im[j] = 0;
      }
      for (var size = 2; size <= n; size <<= 1) {
        var half = size >> 1;
        var step = n / size;
        for (var s = 0; s < n; s += size) {
          for (var p = s, w = 0; p < s + half; p++, w += step) {
            var tre = re[p + half] * cos[w] + im[p + half] * sin[w];
            var tim = -re[p + half] * sin[w] + im[p + half] * cos[w];
            re[p + half] = re[p] - tre;
            im[p + half] = im[p] - tim;
            re[p] += tre;
            im[p] += tim;
          }
        }
      }
      for (var m = 0; m <= n / 2; m++) mag[m] = Math.sqrt(re[m] * re[m] + im[m] * im[m]);
      return mag;
    };
  }

  /* ---------------- 滤波器组 ---------------- */
  function makeMelBank() {
    var bins = N / 2 + 1;
    var mMin = hz2mel(MEL_FMIN), mMax = hz2mel(MEL_FMAX);
    var pts = [];
    for (var i = 0; i <= MEL_BANDS + 1; i++) pts.push(mel2hz(mMin + (mMax - mMin) * i / (MEL_BANDS + 1)));
    var bank = [];
    for (var b = 0; b < MEL_BANDS; b++) {
      var lo = pts[b], ce = pts[b + 1], hi = pts[b + 2];
      var k0 = Math.max(0, Math.floor(lo * N / SR));
      var k1 = Math.min(bins - 1, Math.ceil(hi * N / SR));
      var g = new Float32Array(Math.max(0, k1 - k0 + 1));
      for (var k = k0; k <= k1; k++) {
        var f = k * SR / N;
        g[k - k0] = (f >= lo && f <= ce) ? (f - lo) / (ce - lo)
          : (f > ce && f <= hi) ? (hi - f) / (hi - ce) : 0;
      }
      bank.push({ k0: k0, g: g });
    }
    return bank;
  }

  function makeChromaMap() {
    var bins = N / 2 + 1;
    var map = new Int8Array(bins).fill(-1);
    var kLo = Math.max(1, Math.ceil(CHROMA_FMIN * N / SR));
    var kHi = Math.min(bins - 1, Math.floor(CHROMA_FMAX * N / SR));
    for (var k = kLo; k <= kHi; k++) {
      var f = k * SR / N;
      var midi = 69 + 12 * Math.log2(f / 440);
      var pc = ((Math.round(midi) % 12) + 12) % 12;
      map[k] = pc;
    }
    return { map: map, kLo: kLo, kHi: kHi };
  }

  var FFT = createFFT(N);
  var MELBANK = makeMelBank();
  var CHROMA = makeChromaMap();
  var LOW_MEL_LOOKUP = new Uint8Array(MEL_BANDS);
  (function () {
    var mMin = hz2mel(MEL_FMIN), mMax = hz2mel(MEL_FMAX);
    for (var b = 0; b < MEL_BANDS; b++) {
      var hz = mel2hz(mMin + (mMax - mMin) * (b + 1) / (MEL_BANDS + 1));
      LOW_MEL_LOOKUP[b] = hz <= LOW_MEL_HZ ? 1 : 0;
    }
  })();
  var HANN = new Float32Array(N);
  for (var h = 0; h < N; h++) HANN[h] = 0.5 - 0.5 * Math.cos(2 * Math.PI * h / N);

  /* ---------------- 可增长的行缓冲（按块分配，避免大数组翻倍复制） ---------------- */
  function GrowBuf(cols, blockRows) {
    this.cols = cols;
    this.blockRows = blockRows || 2048;
    this.blocks = [];
    this.rows = 0;
  }
  GrowBuf.prototype.push = function (src, offset) {
    var idx = this.rows % this.blockRows;
    if (idx === 0) this.blocks.push(new Float32Array(this.cols * this.blockRows));
    var blk = this.blocks[this.blocks.length - 1];
    blk.set(src.subarray(offset || 0, (offset || 0) + this.cols), idx * this.cols);
    this.rows++;
  };
  GrowBuf.prototype.toFlat = function () {
    var out = new Float32Array(this.rows * this.cols);
    var off = 0;
    for (var i = 0; i < this.blocks.length; i++) {
      var take = Math.min(this.blockRows, this.rows - i * this.blockRows) * this.cols;
      out.set(this.blocks[i].subarray(0, take), off);
      off += take;
    }
    return out;
  };

  /* ---------------- 帧提取器 ---------------- */
  function FrameExtractor(opts) {
    opts = opts || {};
    this.sr = opts.sampleRate || SR;
    this.fps = this.sr / HOP;
    this.hopMs = HOP / this.sr * 1000;
    this._tail = new Float32Array(0);
    this._tailLen = 0;
    this._frameIndex = 0;

    this.mel = new GrowBuf(MEL_BANDS);
    this.chroma = new GrowBuf(12);
    this.rms = [];
    this.flux = [];
    this.centroid = [];
    this.flatness = [];
    this.lowRatio = [];
    this._scratchMel = new Float32Array(MEL_BANDS);
    this._scratchChroma = new Float32Array(12);
    this._frame = new Float64Array(N);
  }

  FrameExtractor.prototype.push = function (samples) {
    var total = this._tailLen + samples.length;
    var buf;
    if (this._tailLen > 0) {
      buf = new Float32Array(total);
      buf.set(this._tail.subarray(0, this._tailLen), 0);
      buf.set(samples, this._tailLen);
    } else {
      buf = samples;
    }

    var n = 0;
    var limit = buf.length - N;
    while (n <= limit) {
      this._processFrame(buf, n);
      n += HOP;
    }
    // 保留尾巴（不足一帧的部分留到下次）
    this._tailLen = buf.length - n;
    if (this._tailLen > 0) {
      this._tail = buf.slice(n, n + this._tailLen);
    } else {
      this._tail = new Float32Array(0);
    }
    return this._frameIndex;
  };

  FrameExtractor.prototype._processFrame = function (buf, off) {
    var frame = this._frame;
    var e = 0;
    for (var i = 0; i < N; i++) {
      var s = buf[off + i];
      frame[i] = s * HANN[i];
      e += s * s;
    }
    var rms = Math.sqrt(e / N);
    this.rms.push(rms);

    var mag = FFT(frame);

    // mel（log 压缩）。低频占比在同一次 mel 循环里用**线性**带能量累加，
    // 避免在 1Hz 汇总时对每一帧再做 40 次 expm1。
    var melMax = 0, lowPower = 0, allPower = 0;
    for (var b = 0; b < MEL_BANDS; b++) {
      var bank = MELBANK[b];
      var g = bank.g;
      var acc = 0;
      for (var k = 0; k < g.length; k++) {
        var w = g[k];
        if (w !== 0) acc += w * mag[bank.k0 + k];
      }
      var v = Math.log(1 + acc * 8);
      this._scratchMel[b] = v;
      if (v > melMax) melMax = v;
      allPower += acc;
      if (LOW_MEL_LOOKUP[b]) lowPower += acc;
    }
    this.mel.push(this._scratchMel, 0);
    this.lowRatio.push(allPower > 1e-9 ? lowPower / allPower : 0);

    // 谱通量（log-mel 半波整流），归一化到 [0,1]-ish，真正的归一化在 rhythm 里做
    if (this._frameIndex > 0) {
      var prevOff = (this._frameIndex - 1) * MEL_BANDS;
      var blkPrev = this.mel.blocks[(this._frameIndex - 1) / this.mel.blockRows | 0];
      var idxPrev = (this._frameIndex - 1) % this.mel.blockRows;
      var f = 0;
      for (var m = 0; m < MEL_BANDS; m++) {
        var d = this._scratchMel[m] - (blkPrev ? blkPrev[idxPrev * MEL_BANDS + m] : 0);
        if (d > 0) f += d;
      }
      this.flux.push(f);
    } else {
      this.flux.push(0);
    }

    // 质心 + 人声带谱平坦度
    var num = 0, den = 0;
    for (var kk = 1; kk < N / 2; kk++) {
      var mm = mag[kk];
      num += mm * kk * this.sr / N;
      den += mm;
    }
    this.centroid.push(den > 0 ? num / den : 0);

    var kLo = Math.max(1, Math.ceil(VOCAL_LO * N / this.sr));
    var kHi = Math.min(N / 2, Math.floor(VOCAL_HI * N / this.sr));
    var logSum = 0, linSum = 0, cnt = 0;
    for (var kv = kLo; kv <= kHi; kv++) {
      var p = mag[kv] * mag[kv] + 1e-10;
      logSum += Math.log(p);
      linSum += p;
      cnt++;
    }
    var flat = 0;
    if (cnt > 0 && linSum > 0) {
      var geo = Math.exp(logSum / cnt);
      var ari = linSum / cnt;
      flat = Math.max(0, Math.min(1, 1 - geo / ari));
    }
    this.flatness.push(flat);

    // chroma：先做逐帧谱白化（减去本帧中位附近的均值），再按音级累加
    var cLo = CHROMA.kLo, cHi = CHROMA.kHi;
    var mean = 0, nz = 0;
    for (var kc = cLo; kc <= cHi; kc++) { mean += mag[kc]; nz++; }
    mean = nz ? mean / nz : 0;
    var chroma = this._scratchChroma;
    for (var z = 0; z < 12; z++) chroma[z] = 0;
    for (var kk2 = cLo; kk2 <= cHi; kk2++) {
      var pc = CHROMA.map[kk2];
      if (pc < 0) continue;
      var wgt = mag[kk2] - mean;
      if (wgt > 0) chroma[pc] += wgt;
    }
    this.chroma.push(chroma, 0);

    this._frameIndex++;
  };

  FrameExtractor.prototype.finalize = function () {
    var count = this._frameIndex;
    var mel = this.mel.toFlat();
    var chroma = this.chroma.toFlat();
    var rms = new Float32Array(count);
    var flux = new Float32Array(count);
    var centroid = new Float32Array(count);
    var flatness = new Float32Array(count);
    var lowRatio = new Float32Array(count);
    for (var i = 0; i < count; i++) {
      rms[i] = this.rms[i];
      flux[i] = this.flux[i];
      centroid[i] = this.centroid[i];
      flatness[i] = this.flatness[i];
      lowRatio[i] = this.lowRatio[i] || 0;
    }
    // 释放分块
    this.mel = null; this.chroma = null;
    this.rms = this.flux = this.centroid = this.flatness = this.lowRatio = null;
    return {
      count: count,
      fps: this.fps,
      hopMs: this.hopMs,
      durationSec: count ? count / this.fps : 0,
      mel: mel,
      chroma: chroma,
      rms: rms,
      flux: flux,
      centroid: centroid,
      flatness: flatness,
      lowRatio: lowRatio,
    };
  };

  /* ---------------- 工具 ---------------- */
  function db(v) { return 20 * Math.log10(Math.max(1e-6, v)); }

  function melBand(frames, frameIdx, band) { return frames.mel[frameIdx * MEL_BANDS + band]; }

  function melRange(frames, frameIdx, b0, b1) {
    var s = 0;
    for (var b = b0; b <= b1; b++) s += frames.mel[frameIdx * MEL_BANDS + b];
    return s;
  }

  function chromaAt(frames, frameIdx) {
    var out = new Float32Array(12);
    for (var c = 0; c < 12; c++) out[c] = frames.chroma[frameIdx * 12 + c];
    return out;
  }

  return {
    SR: SR, N: N, HOP: HOP, MEL_BANDS: MEL_BANDS,
    FrameExtractor: FrameExtractor,
    melBand: melBand, melRange: melRange, chromaAt: chromaAt, db: db,
    _internals: { createFFT: createFFT, makeMelBank: makeMelBank, hz2mel: hz2mel, mel2hz: mel2hz },
  };
});
