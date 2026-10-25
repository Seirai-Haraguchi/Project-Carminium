'use strict';
/*
 * TrackProfile 生成：调性、段落、1Hz 特征、混音点候选池，以及增量编排器。
 *
 * 输出的 profile 是 L2 档案层的数据契约（见 docs/automix-redesign/）。
 * 体积：v3 实测 14KB（65s）–53KB（613s，gz 3–16KB）；只存 1Hz 特征 + 拍点 + 段落 + 候选池，不存 mel。
 */
(function (root, factory) {
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (typeof root !== 'undefined') root.AnalyzerPipeline = api;
})(typeof self !== 'undefined' ? self : this, function (root) {
  var FE = root.AnalysisFrontend;
  var RHY = root.AnalysisRhythm;
  if (!FE && typeof require === 'function') {
    FE = require('./frontend.js');
    RHY = require('./rhythm.js');
  }

  var PROFILE_VERSION = 5;
  var MEL = FE.MEL_BANDS;

  /* 分析上限：超过 20 分钟只解前 20 分钟（electron/analysis_worker.js 的 -t）。
   * 截断后量到的"尾部"是截断点的形态而不是文件真正的结尾，
   * 不能当作冷结束/无留白的证据——必须按未知处理。 */
  var ANALYSIS_MAX_MS = 20 * 60 * 1000;
  var TRUNCATION_TOL_MS = 150;

  var KEY_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  var MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
  var MINOR = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

  function pearson(a, b) {
    var n = a.length, ma = 0, mb = 0;
    for (var i = 0; i < n; i++) { ma += a[i]; mb += b[i]; }
    ma /= n; mb /= n;
    var num = 0, da = 0, db = 0;
    for (var j = 0; j < n; j++) {
      num += (a[j] - ma) * (b[j] - mb);
      da += (a[j] - ma) * (a[j] - ma);
      db += (b[j] - mb) * (b[j] - mb);
    }
    return num / Math.sqrt((da || 1e-9) * (db || 1e-9));
  }

  /* ---------------- 调性 ---------------- */
  function krumhansl(chroma) {
    var max = 0;
    for (var i = 0; i < 12; i++) if (chroma[i] > max) max = chroma[i];
    if (max > 0) for (var k = 0; k < 12; k++) chroma[k] /= max;

    var results = [];
    for (var r = 0; r < 12; r++) {
      var maj = [], min = [];
      for (var t = 0; t < 12; t++) {
        maj.push(MAJOR[(t - r + 12) % 12]);
        min.push(MINOR[(t - r + 12) % 12]);
      }
      results.push({ tonic: r, mode: 'major', r: pearson(Array.from(chroma), maj) });
      results.push({ tonic: r, mode: 'minor', r: pearson(Array.from(chroma), min) });
    }
    results.sort(function (a, b) { return b.r - a.r; });
    var best = results[0];
    var margin = results[1] ? best.r - results[1].r : best.r;
    return {
      tonic: best.tonic, mode: best.mode, r: best.r,
      margin: margin,
      confidence: Math.max(0, Math.min(1, margin / 0.10)),
    };
  }

  function chromaOfRange(frames, from, to) {
    var chroma = new Float64Array(12);
    for (var f = from; f < to; f++) {
      var rms = frames.rms[f];
      if (rms < 0.01) continue;
      var w = Math.sqrt(rms);
      for (var c = 0; c < 12; c++) chroma[c] += frames.chroma[f * 12 + c] * w;
    }
    return chroma;
  }

  function estimateKey(frames) {
    var chroma = chromaOfRange(frames, 0, frames.count);
    var best = krumhansl(chroma);

    // 稳定性：前后半独立估计是否一致（不一致 ⇒ 调性不可用于决策）
    var half = Math.floor(frames.count / 2);
    var kA = krumhansl(chromaOfRange(frames, 0, half));
    var kB = krumhansl(chromaOfRange(frames, half, frames.count));
    var same = (kA.tonic === kB.tonic && kA.mode === kB.mode);
    var relative = (Math.abs(kA.tonic - kB.tonic) === 3 || Math.abs(kA.tonic - kB.tonic) === 9);
    var stable = same || (relative && kA.mode !== kB.mode);

    var norm = chroma;
    var mx = 0;
    for (var i = 0; i < 12; i++) if (norm[i] > mx) mx = norm[i];
    var mean = [];
    for (var q = 0; q < 12; q++) mean.push(Math.round((mx > 0 ? norm[q] / mx : 0) * 100) / 100);

    return {
      tonic: best.tonic,
      mode: best.mode,
      name: KEY_NAMES[best.tonic] + (best.mode === 'minor' ? 'm' : ''),
      confidence: Math.round(best.confidence * 100) / 100,
      stable: stable,
      halfAgreement: (kA.tonic === kB.tonic && kA.mode === kB.mode) ? 'same' : (relative ? 'relative' : 'differ'),
      chromaMean: mean,
    };
  }

  /* ---------------- 1Hz 特征（chroma 4s，控制体积） ---------------- */
  var CHROMA_HOP_SEC = 4;

  function r2(v) { return Math.round(v * 100) / 100; }

  function buildSecondFrames(frames) {
    var fps = frames.fps;
    var rows = Math.max(1, Math.floor(frames.count / fps));
    var rmsDb = new Array(rows);
    var flux = new Array(rows);
    var centroid = new Array(rows);
    var vocal = new Array(rows);
    var lowRatio = new Array(rows);
    var transient = new Array(rows);
    var onsetCounts = new Array(rows).fill(0);
    var fluxSorted = Array.prototype.slice.call(frames.flux).sort(function (a, b) { return a - b; });
    var fluxP75 = fluxSorted[Math.floor(fluxSorted.length * 0.75)] || 0;
    var fluxScale = Math.max(1e-6, fluxSorted[Math.floor(fluxSorted.length * 0.95)] || 1);

    for (var r = 0; r < rows; r++) {
      var from = Math.floor(r * fps);
      var to = Math.min(frames.count, Math.floor((r + 1) * fps));
      var e = 0, fl = 0, ce = 0, vo = 0, lo = 0, c2 = 0;
      for (var f = from; f < to; f++) {
        e += frames.rms[f] * frames.rms[f];
        fl += frames.flux[f];
        ce += frames.centroid[f];
        var gate = Math.min(1, frames.rms[f] / 0.05);
        vo += frames.flatness[f] * gate;
        // frontend 在每个 STFT 帧已经算好线性低频占比；旧缓存/外部帧缺字段时跳过该项。
        if (frames.lowRatio) lo += frames.lowRatio[f] || 0;
        // 局部峰 + 全曲上分位阈值：衡量每秒显著瞬态数量，避免把持续噪声当鼓点。
        if (f > 0 && f + 1 < frames.count && frames.flux[f] >= fluxP75 &&
            frames.flux[f] >= frames.flux[f - 1] && frames.flux[f] > frames.flux[f + 1] &&
            frames.rms[f] > 0.005) onsetCounts[r]++;
        c2++;
      }
      c2 = c2 || 1;
      rmsDb[r] = r2(20 * Math.log10(Math.max(1e-6, Math.sqrt(e / c2))));
      flux[r] = r2(fl / c2);
      centroid[r] = Math.round(ce / c2);
      vocal[r] = r2(Math.min(1, vo / c2));
      lowRatio[r] = r2(lo / c2);
      transient[r] = r2(Math.min(1, onsetCounts[r] / 8) * Math.min(1, fluxScale / Math.max(1e-6, fluxP75) / 4));
    }

    var cRows = Math.max(1, Math.ceil(rows / CHROMA_HOP_SEC));    var chroma = new Array(cRows * 12);
    for (var cr = 0; cr < cRows; cr++) {
      var f0 = Math.floor(cr * CHROMA_HOP_SEC * fps);
      var f1 = Math.min(frames.count, Math.floor((cr + 1) * CHROMA_HOP_SEC * fps));
      var ch = new Float64Array(12);
      for (var ff = f0; ff < f1; ff++) {
        for (var k = 0; k < 12; k++) ch[k] += frames.chroma[ff * 12 + k];
      }
      var mx = 0;
      for (var q = 0; q < 12; q++) if (ch[q] > mx) mx = ch[q];
      for (var w = 0; w < 12; w++) chroma[cr * 12 + w] = mx > 0 ? r2(ch[w] / mx) : 0;
    }

    // 人声代理归一化：这个指标本质是"中频非平坦度"，它会对任何有调音乐都变高。
    // 因此只用**相对**信息：本曲内部的低分位=伴奏段，高分位=人声/主奏段。
    // 规划器需要的是"这段比本曲平均水平更空吗"，绝对阈值没有意义。
    var sortedV = vocal.slice().sort(function (a, b) { return a - b; });
    var vLo = sortedV[Math.floor(sortedV.length * 0.2)] || 0;
    var vHi = sortedV[Math.floor(sortedV.length * 0.8)] || 0;
    var span = Math.max(0.02, vHi - vLo);
    for (var vi = 0; vi < rows; vi++) {
      vocal[vi] = Math.round(Math.max(0, Math.min(1, (vocal[vi] - vLo) / span)) * 100) / 100;
    }

    return {
      hopMs: 1000,
      chromaHopMs: CHROMA_HOP_SEC * 1000,
      count: rows,
      rmsDb: rmsDb,
      flux: flux,
      centroid: centroid,
      vocal: vocal,
      lowRatio: lowRatio,
      transient: transient,
      vocalRange: Math.round((vHi - vLo) * 100) / 100,
      chroma: chroma,
    };
  }

  /* ---------------- 首尾边界（专辑连续曲判断） ----------------
   * 只回答一个问题：文件开头/结尾有多少**数字静音**。
   * 阈值取 -60dBFS：普通曲目留白通常是数字静音（≤ -90dB），
   * 而淡出到极轻的尾奏、环境音仍会高于它，不会被误判成留白。
   * 连续 3 帧（≈35ms）才算真正开始/结束，避免单帧编码噪声打断静音区间。
   *
   * truncated=true 表示分析被 20 分钟上限截断：尾部量到的是截断点，
   * 不是文件结尾。此时 tailSilenceMs 置 null（未知）并置 tailKnown=false，
   * 逼规划器走保守路径，而不是把"截断点恰好没留白"当成连续证据。
   */
  var EDGE_SILENCE_DB = -60;
  var EDGE_ACTIVE_FRAMES = 3;

  function measureEdges(frames, truncated) {
    var n = frames.count;
    var hop = frames.hopMs || 0;
    if (!n) {
      return {
        headSilenceMs: 0, tailSilenceMs: 0, headRmsDb: -120, tailRmsDb: -120,
        headKnown: false, tailKnown: false,
      };
    }
    var threshold = Math.pow(10, EDGE_SILENCE_DB / 20);
    var active = new Uint8Array(n);
    for (var i = 0; i < n; i++) active[i] = frames.rms[i] > threshold ? 1 : 0;

    var head = n;
    if (n >= EDGE_ACTIVE_FRAMES) {
      for (var h = 0; h + EDGE_ACTIVE_FRAMES <= n; h++) {
        var ok = true;
        for (var k = 0; k < EDGE_ACTIVE_FRAMES; k++) {
          if (!active[h + k]) { ok = false; break; }
        }
        if (ok) { head = h; break; }
      }
    } else {
      head = 0;
    }

    var tail = n;
    if (n >= EDGE_ACTIVE_FRAMES) {
      for (var t = n - 1; t - EDGE_ACTIVE_FRAMES + 1 >= 0; t--) {
        var ok2 = true;
        for (var m = 0; m < EDGE_ACTIVE_FRAMES; m++) {
          if (!active[t - m]) { ok2 = false; break; }
        }
        if (ok2) { tail = n - 1 - t; break; }
      }
    } else {
      tail = 0;
    }

    function level(from, to) {
      var e = 0, c = 0;
      for (var q = from; q < to; q++) { e += frames.rms[q] * frames.rms[q]; c++; }
      return c ? r2(20 * Math.log10(Math.max(1e-6, Math.sqrt(e / c)))) : -120;
    }
    var span = Math.min(10, n);
    var out = {
      headSilenceMs: Math.round(head * hop),
      tailSilenceMs: Math.round(tail * hop),
      headRmsDb: level(0, span),
      tailRmsDb: level(n - span, n),
      headKnown: true,
      tailKnown: !truncated,
    };
    if (truncated) {
      out.tailSilenceMs = null;
      out.tailRmsDb = null;
    }
    return out;
  }

  /* ---------------- 结构：SSM + 棋盘核 ---------------- */
  function beatSyncFeatures(frames, beatFrames) {
    var rows = [];
    for (var i = 0; i < beatFrames.length; i++) {
      var f = Math.max(0, Math.min(frames.count - 1, Math.round(beatFrames[i])));
      var v = new Float32Array(16);
      for (var c = 0; c < 12; c++) v[c] = frames.chroma[f * 12 + c];
      var lo = 0;
      for (var b = 0; b <= 9; b++) lo += frames.mel[f * MEL + b];
      v[12] = lo;
      v[13] = frames.rms[f] * 4;
      var hi = 0;
      for (var b2 = 30; b2 < MEL; b2++) hi += frames.mel[f * MEL + b2];
      v[14] = hi * 0.5;
      v[15] = frames.centroid[f] / 4000;
      // 归一化（余弦用）
      var norm = 0;
      for (var z = 0; z < 16; z++) norm += v[z] * v[z];
      norm = Math.sqrt(norm) || 1;
      for (var z2 = 0; z2 < 16; z2++) v[z2] /= norm;
      rows.push(v);
    }
    return rows;
  }

  function noveltyCurve(rows, kernel) {
    var n = rows.length;
    var nov = new Float32Array(n);
    var K = kernel || 16;
    var half = K >> 1;
    for (var i = half; i < n - half; i++) {
      var acc = 0;
      for (var a = 0; a < half; a++) {
        for (var b = 0; b < half; b++) {
          var g = (b - a + half * 0.5) / half;   // 棋盘：前段×后段取负
          var sign = (a < half && b < half) || (a >= half && b >= half) ? 1 : -1;
          var ia = i - half + a, ib = i - half + b;
          if (ia < 0 || ib < 0 || ia >= n || ib >= n) continue;
          var dot = 0;
          for (var d = 0; d < 16; d++) dot += rows[ia][d] * rows[ib][d];
          acc += sign * dot;
        }
      }
      nov[i] = acc / (half * half);
    }
    return nov;
  }

  function detectSegments(frames, beatFrames, meter, phraseBeats, durationMs) {
    if (beatFrames.length < 16) {
      return {
        segments: [{ type: 'unknown', startMs: 0, endMs: durationMs, energy: 0, confidence: 0 }],
        noveltyPeaksMs: [],
      };
    }
    var rows = beatSyncFeatures(frames, beatFrames);
    var nov = noveltyCurve(rows, 16);
    var n = nov.length;

    var mean = 0, cnt = 0;
    for (var i = 0; i < n; i++) { mean += nov[i]; cnt++; }
    mean /= (cnt || 1);
    var sd = 0;
    for (var j = 0; j < n; j++) sd += (nov[j] - mean) * (nov[j] - mean);
    sd = Math.sqrt(sd / (cnt || 1));

    var peaks = [];
    var minDist = Math.max(4, Math.round(phraseBeats * 0.75));
    var cand = [];
    for (var p = 4; p < n - 4; p++) {
      if (nov[p] < mean + 1.0 * sd) continue;
      if (nov[p] < nov[p - 1] || nov[p] < nov[p + 1]) continue;
      cand.push(p);
    }
    cand.sort(function (x, y) { return nov[y] - nov[x]; });
    for (var ci = 0; ci < cand.length && peaks.length < 20; ci++) {
      var idx0 = cand[ci];
      var tooClose = false;
      for (var q = 0; q < peaks.length; q++) if (Math.abs(peaks[q] - idx0) < minDist) { tooClose = true; break; }
      if (!tooClose) peaks.push(idx0);
    }
    peaks.sort(function (x, y) { return x - y; });

    // 每拍 RMS（段落能量与能量跳变都用它）
    var nb = beatFrames.length;
    var beatRms = new Array(nb);
    for (var br = 0; br < nb; br++) {
      var bf = Math.max(0, Math.min(frames.count - 1, Math.round(beatFrames[br])));
      beatRms[br] = frames.rms[bf];
    }
    function meanRms(a, b) {
      var s = 0, c = 0;
      for (var i2 = Math.max(0, a); i2 < Math.min(nb, b); i2++) { s += beatRms[i2] * beatRms[i2]; c++; }
      return c ? Math.sqrt(s / c) : 0;
    }

    // 能量跳变边界：流行/摇滚的段落边界（主歌→副歌）几乎总是能量阶跃，
    // 自相似 novelty 在编曲稀疏处会漏，这里补一路独立证据。
    var w = Math.max(4, Math.round(phraseBeats / 2));
    var eCand = [];
    for (var eb = w; eb < nb - w; eb++) {
      var before = meanRms(eb - w, eb);
      var after = meanRms(eb, eb + w);
      var rel = Math.abs(after - before) / Math.max(1e-6, Math.max(before, after));
      if (rel > 0.25) eCand.push({ i: eb, rel: rel });
    }
    eCand.sort(function (x, y) { return y.rel - x.rel; });
    var eBounds = [];
    for (var ec = 0; ec < eCand.length && eBounds.length < 8; ec++) {
      var ei = eCand[ec].i;
      var close = false;
      for (var eb2 = 0; eb2 < eBounds.length; eb2++) if (Math.abs(eBounds[eb2] - ei) < minDist) { close = true; break; }
      if (!close) eBounds.push(ei);
    }

    var allPeaks = peaks.concat(eBounds).sort(function (x, y) { return x - y; });

    // 边界吸附到小节头
    var bpb = meter.beatsPerBar || 4;
    var bounds = [0];
    for (var k = 0; k < allPeaks.length; k++) {
      var idx = allPeaks[k];
      var toDown = ((idx - meter.phase) % bpb + bpb) % bpb;
      if (toDown !== 0) idx += (bpb - toDown);
      if (idx > bpb && idx < n - bpb && idx - bounds[bounds.length - 1] >= Math.max(bpb * 2, minDist)) bounds.push(idx);
    }
    bounds.push(n);

    var segs = [];
    var energies = [];
    for (var s = 0; s < bounds.length - 1; s++) {
      var a = bounds[s], b = bounds[s + 1];
      var e = meanRms(a, b);
      energies.push(e);
      segs.push({
        startBeat: a, endBeat: b,
        startMs: Math.round(beatFrames[a] * frames.hopMs),
        endMs: b < beatFrames.length ? Math.round(beatFrames[b] * frames.hopMs) : Math.round(durationMs),
        energy: Math.round(e * 1000) / 1000,
      });
    }
    var sorted = energies.slice().sort(function (x, y) { return x - y; });
    var p25 = sorted[Math.floor(sorted.length * 0.25)] || 0;
    var p75 = sorted[Math.floor(sorted.length * 0.75)] || 0;

    var median = sorted[Math.floor(sorted.length * 0.5)] || 0;
    for (var t = 0; t < segs.length; t++) {
      var sg = segs[t];
      var isFirst = t === 0, isLast = t === segs.length - 1;
      if (segs.length >= 2 && isFirst && sg.energy <= median) sg.type = 'intro';
      else if (segs.length >= 2 && isLast && sg.energy <= median) sg.type = 'outro';
      else if (sg.energy >= p75) sg.type = 'chorus';
      else if (sg.energy <= p25 && segs.length > 2) sg.type = 'breakdown';
      else sg.type = 'verse';
      var beatsInSeg = sg.endBeat - sg.startBeat;
      sg.confidence = Math.min(1, 0.3 + (segs.length >= 3 ? 0.25 : 0) + (sg.type !== 'verse' ? 0.2 : 0) + (beatsInSeg >= 8 ? 0.15 : 0));
    }

    return {
      segments: segs,
      noveltyPeaksMs: peaks.map(function (i2) {
        return Math.round(beatFrames[Math.min(beatFrames.length - 1, i2)] * frames.hopMs);
      }),
    };
  }

  /* ---------------- 混音点候选池 ---------------- */
  function buildMixPoints(profile) {
    var beats = profile.beats;
    var times = beats.timesMs;
    var n = times.length;
    var durationMs = profile.durationMs;
    var frames = profile.frames;
    var bpb = beats.beatsPerBar || 4;
    var phrase = beats.phraseBeats || 8;
    var segments = profile.segments || [];
    var beatGaps = [];
    for (var bg = 1; bg < times.length; bg++) beatGaps.push(times[bg] - times[bg - 1]);
    beatGaps.sort(function (x, y) { return x - y; });
    var phraseMs = (beatGaps[beatGaps.length >> 1] || 500) * phrase;

    function energyAt(ms) {
      var i = Math.max(0, Math.min(frames.count - 1, Math.round(ms / frames.hopMs)));
      return frames.rmsDb[i];
    }
    function segmentStartNear(ms) {
      for (var s = 1; s < segments.length; s++) {
        if (Math.abs(segments[s].startMs - ms) <= Math.min(1500, phraseMs * 0.25)) return segments[s].type;
      }
      return null;
    }
    function vocalAt(ms, spanMs) {
      var a = Math.max(0, Math.round((ms - (spanMs || 2000)) / frames.hopMs));
      var b = Math.min(frames.count - 1, Math.round((ms + (spanMs || 2000)) / frames.hopMs));
      var s = 0, c = 0;
      for (var i = a; i <= b; i++) { s += frames.vocal[i]; c++; }
      return c ? s / c : 0;
    }

    var exits = [];
    var entries = [];

    // 退出点：乐句头（A 尾段） + 段落边界 + 能量下降 + 静音起点
    var tailFrom = Math.max(0, durationMs - 60000);
    for (var i = 0; i < n; i++) {
      var t = times[i];
      if (t < tailFrom || t > durationMs - 1500) continue;
      var isDown = ((i - beats.meterPhase) % bpb + bpb) % bpb === 0;
      var isPhrase = ((i - beats.meterPhase) % phrase + phrase) % phrase === 0;
      var e = energyAt(t);
      var ePrev = energyAt(t - 4000);
      var delta = e - ePrev;
      var v = vocalAt(t, 1500);
      var type = null, score = 0;
      if (isPhrase && isDown) { type = 'phrase'; score = 0.55; }
      else if (isDown) { type = 'bar'; score = 0.35; }
      if (delta <= -2.5) { type = 'drop'; score = Math.max(score, 0.5 + Math.min(0.3, -delta / 20)); }
      if (v < 0.12 && e < -30) { type = 'silence'; score = Math.max(score, 0.6); }
      // 低中频密度窗口是独立的候选证据；它不是 VAD，只在有节拍锚点时加入。
      if (!type && isDown && v < 0.22 && e > -38) { type = 'low-vocal'; score = 0.42; }
      var exitSeg = segmentStartNear(t);
      if (!type && exitSeg && isDown) { type = 'segment'; score = 0.46; }
      if (!type) continue;
      score += Math.min(0.2, Math.max(0, -delta) / 30);
      score += (1 - Math.min(1, v)) * 0.15;
      // 越靠近真尾奏越优先（但不要在最后 1.5s）
      var tailBias = Math.min(0.15, (t - tailFrom) / 60000 * 0.15);

      // 小节头吸附：'drop'/'silence' 候选是能量事件，未必落在拍上；
      // 但节拍匹配的淡变必须在拍上开始，否则整段是"半拍错位"。
      var snapIdx = i;
      if (!isDown) {
        var toDown = ((i - beats.meterPhase) % bpb + bpb) % bpb;
        var shift = toDown <= bpb / 2 ? -toDown : (bpb - toDown);
        snapIdx = Math.max(0, Math.min(n - 1, i + shift));
        isDown = true;
        isPhrase = ((snapIdx - beats.meterPhase) % phrase + phrase) % phrase === 0;
        t = times[snapIdx];
      }

      exits.push({
        tMs: Math.round(t), type: type, score: Math.round(Math.min(1, score + tailBias) * 1000) / 1000,
        energyDb: Math.round(e * 10) / 10, energyDelta: Math.round(delta * 10) / 10,
        vocalGap: Math.round((1 - Math.min(1, v)) * 100) / 100,
        segmentBoundary: exitSeg || null,
        beatIndex: snapIdx, isDownbeat: isDown, isPhrase: isPhrase,
      });
    }
    exits.sort(function (a, b) { return b.score - a.score; });
    exits = exits.slice(0, 24).sort(function (a, b) { return a.tMs - b.tMs; });

    // 进入点：B 前 75s 内的小节头 / 乐句头，偏好低人声与能量上升
    var headTo = Math.min(durationMs - 1000, 75000);
    for (var j = 0; j < n; j++) {
      var tj = times[j];
      if (tj > headTo) break;
      var jDown = ((j - beats.meterPhase) % bpb + bpb) % bpb === 0;
      var jPhrase = ((j - beats.meterPhase) % phrase + phrase) % phrase === 0;
      if (!jDown) continue;
      var e2 = energyAt(tj);
      var rise = energyAt(tj + 4000) - e2;
      var v2 = vocalAt(tj, 1500);
      var score2 = jPhrase ? 0.6 : 0.4;
      score2 += Math.min(0.2, Math.max(0, rise) / 15);
      score2 += (1 - Math.min(1, v2)) * 0.2;
      if (e2 < -42) score2 -= 0.15;
      var entrySeg = segmentStartNear(tj);
      if (entrySeg) score2 += 0.08;
      entries.push({
        tMs: Math.round(tj), type: entrySeg ? 'segment' : (jPhrase ? 'phrase' : 'bar'),
        score: Math.round(Math.max(0, Math.min(1, score2)) * 1000) / 1000,
        energyDb: Math.round(e2 * 10) / 10, energyRise: Math.round(rise * 10) / 10,
        vocalGap: Math.round((1 - Math.min(1, v2)) * 100) / 100,
        segmentBoundary: entrySeg || null,
        beatIndex: j, isDownbeat: true, isPhrase: jPhrase,
      });
    }
    entries.sort(function (a, b) { return b.score - a.score; });
    entries = entries.slice(0, 24).sort(function (a, b) { return a.tMs - b.tMs; });

    return { exits: exits, entries: entries };
  }

  /* ---------------- 组装 profile ---------------- */
  function buildProfile(frames, meta) {
    var t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    var rhythm = RHY.analyze(frames);
    var key = estimateKey(frames);
    var seconds = buildSecondFrames(frames);

    var beatTimesMs = Array.prototype.slice.call(RHY.framesToMs(rhythm.beatFrames, frames.hopMs));
    var strengths = rhythm.beatStrengths.map(function (v) { return Math.round(v * 1000) / 1000; });
    var downbeats = [];
    var bpb = rhythm.meter.beatsPerBar || 4;
    for (var d = rhythm.meter.phase; d < beatTimesMs.length; d += bpb) downbeats.push(d);

    var durationMs = meta.durationMs || Math.round(frames.durationSec * 1000);
    var struct = detectSegments(frames, rhythm.beatFrames, rhythm.meter, rhythm.phrase.beats, durationMs);

    // 人声总判断：1Hz vocal 的高分位
    var vsorted = Array.prototype.slice.call(seconds.vocal).sort(function (a, b) { return a - b; });
    var vHigh = vsorted[Math.floor(vsorted.length * 0.9)] || 0;

    var profile = {
      v: PROFILE_VERSION,
      engine: 'carminium-dsp-v2',
      trackId: meta.trackId || '',
      filePath: meta.filePath || '',
      title: meta.title || '',
      artist: meta.artist || '',
      durationMs: durationMs,
      // 声明时长（库元数据）与实际分析时长分开存档：截断分析时 durationMs
      // 是截断后长度，fileDurationMs 才是文件真实长度；analysisTruncated
      // 标记"尾部证据不可信"（edges.tailKnown=false）。
      fileDurationMs: Number(meta.fileDurationMs) || 0,
      analyzedDurationMs: Number(meta.inputDurationMs) || 0,
      analysisTruncated: !!meta.analysisTruncated,
      analyzedAt: Date.now(),
      tempo: {
        primary: rhythm.bpm,
        confidence: Math.round(rhythm.confidence * 1000) / 1000,
        stability: Math.round(rhythm.stability * 1000) / 1000,
        candidates: rhythm.candidates,
      },
      beats: {
        timesMs: beatTimesMs,
        strengths: strengths,
        downbeats: downbeats,
        beatsPerBar: bpb,
        meterPhase: rhythm.meter.phase,
        meterConfidence: Math.round(rhythm.meter.confidence * 1000) / 1000,
        phraseBeats: rhythm.phrase.beats,
        phraseConfidence: Math.round(rhythm.phrase.confidence * 1000) / 1000,
        // gridStability 与 octaveAmbiguity 分开暴露：八度歧义影响"速度解释"，
        // 网格稳定性影响"相位能否对齐"，规划器不应把两者合成一个不可解释的数。
        gridStability: rhythm.gridStability,
        octaveAmbiguity: rhythm.octaveAmbiguity,
        confidence: Math.round(rhythm.confidence * (0.65 + 0.35 * rhythm.meter.confidence) * 1000) / 1000,
      },
      frames: seconds,
      // 边界静音：同专辑连续曲若两侧都没有留白，说明原文件本来就连着。
      // 截断分析的尾部证据已作废（tailSilenceMs=null / tailKnown=false）。
      edges: measureEdges(frames, !!meta.analysisTruncated),
      segments: struct.segments,
      noveltyPeaksMs: struct.noveltyPeaksMs,
      key: key,
      flags: {
        // 注意：这里没有真正的人声检测（未引入 VAD 模型）。
        // vocalDynamic 只表示"中频带密度在本曲内部有对比明显的段落"，
        // 用于判断"有没有可用的器乐空隙"，不是"有没有人声"。
        vocalDynamic: (seconds.vocalRange || 0) > 0.45,
        vocalConfidence: 0.3,
        lowConfidence: rhythm.confidence < 0.35,
        isDjMix: frames.durationSec > 900,
        keyUsable: !!(key.stable && key.confidence >= 0.45),
      },
    };
    profile.mixPoints = buildMixPoints(profile);
    profile.costMs = Math.round(((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now()) - t0);
    return profile;
  }

  /* ---------------- 增量编排器（Worker 里用） ---------------- */
  function Analyzer(meta) {
    this.meta = meta || {};
    this.fe = new FE.FrameExtractor({ sampleRate: FE.SR });
    this.fedSamples = 0;
  }
  Analyzer.prototype.push = function (samples) {
    this.fedSamples += samples.length;
    this.fe.push(samples);
  };
  /* 截断判定（纯函数，便于单测）：
   * 实解时长触到上限（ffmpeg -t 截断）且声明时长没有佐证"确实解到了结尾"，
   * 或声明时长明显长于实解时长 → 认为分析被截断，尾部证据不可信。 */
  function isTruncatedAnalysis(realMs, declaredMs, limitMs) {
    var limit = limitMs > 0 ? limitMs : ANALYSIS_MAX_MS;
    var hitLimit = realMs >= limit - TRUNCATION_TOL_MS;
    var declaredMatches = declaredMs > 0 && Math.abs(declaredMs - realMs) <= TRUNCATION_TOL_MS;
    var declaredLonger = declaredMs > realMs + 2000;
    return (hitLimit && !declaredMatches) || declaredLonger;
  }

  Analyzer.prototype.finish = function (opts) {
    var frames = this.fe.finalize();
    // 用实际喂入长度校正时长（元数据可能不准）
    var realMs = Math.round(this.fedSamples / FE.SR * 1000);
    var declaredMs = Number(this.meta.durationMs) || 0;
    var meta = Object.assign({}, this.meta);
    // 声明时长先留档：截断判定要靠"声明 vs 实解"的差，不能被下面的校正覆盖掉
    meta.fileDurationMs = declaredMs;
    if (declaredMs && realMs > 0) {
      var dev = Math.abs(declaredMs - realMs) / Math.max(1, declaredMs);
      if (dev > 0.02) meta.durationMs = realMs;
    } else {
      meta.durationMs = realMs;
    }
    meta.inputDurationMs = realMs;
    meta.analysisTruncated = isTruncatedAnalysis(realMs, declaredMs, opts && opts.limitMs);
    return buildProfile(frames, meta);
  };

  return {
    PROFILE_VERSION: PROFILE_VERSION,
    ANALYSIS_MAX_MS: ANALYSIS_MAX_MS,
    Analyzer: Analyzer,
    buildProfile: buildProfile,
    estimateKey: estimateKey,
    buildSecondFrames: buildSecondFrames,
    detectSegments: detectSegments,
    buildMixPoints: buildMixPoints,
    measureEdges: measureEdges,
    isTruncatedAnalysis: isTruncatedAnalysis,
  };
});
