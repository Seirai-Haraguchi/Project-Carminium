'use strict';
/*
 * 节奏分析：onset 包络 → 多假设速度（含半/倍速家族）→ 连续相位 DP 节拍 → 小节头 → 乐句长度。
 *
 * 设计要点（V1 分析器已删除，这里是唯一的节拍分析实现）：
 * - 旧：lag 只取 50ms 整数格，网格步长被量化 → 与上报 BPM 脱钩（全库 33% 不一致）。
 *   新：BPM 连续（0.25 步进），拍点位置是浮点帧号 → 无量化漂移。
 * - 旧：自相关 + 写死的"115–150 BPM 加权 1.5"。
 *   新：ACF 谐波求和 + 对数正态速度先验 + "拍点 vs 拍间中点对比度"判八度。
 * - 旧：单一相位（全局模长最大化），不跟踪速度变化。
 *   新：DP + ±12% 局部速度自适应（Ellis 式），允许现场演奏的微小漂移。
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (typeof root !== 'undefined') root.AnalysisRhythm = api;
})(typeof self !== 'undefined' ? self : this, function () {

  var BPM_MIN = 50;
  var BPM_MAX = 200;
  var BPM_PRIOR_CENTER = 120;
  var BPM_PRIOR_SIGMA = 0.55;   // octave（log2）标准差

  /* --------------- onset 包络 --------------- */
  function onsetEnvelope(frames) {
    var n = frames.count;
    var raw = frames.flux;
    var win = 16;
    var tmp = new Float32Array(win * 2 + 1);
    var out = new Float32Array(n);
    for (var i = 0; i < n; i++) {
      var cnt = 0;
      for (var j = Math.max(0, i - win); j <= Math.min(n - 1, i + win); j++) tmp[cnt++] = raw[j];
      var arr = tmp.subarray(0, cnt).slice().sort();
      var med = arr[cnt >> 1];
      out[i] = Math.max(0, raw[i] - med);
    }
    var mx = 0;
    for (var k = 0; k < n; k++) if (out[k] > mx) mx = out[k];
    if (mx > 0) for (var q = 0; q < n; q++) out[q] /= mx;
    return out;
  }

  /* --------------- ACF（整数 lag） --------------- */
  function acf(env, maxLag) {
    var n = env.length;
    var out = new Float64Array(maxLag + 1);
    for (var lag = 1; lag <= maxLag; lag++) {
      var s = 0;
      for (var i = 0; i + lag < n; i++) s += env[i] * env[i + lag];
      out[lag] = n - lag > 0 ? s / (n - lag) : 0;
    }
    // 去趋势（ACF 随 lag 衰减，减掉局部均值避免偏爱短 lag）
    var trend = 0;
    for (var t = 1; t <= maxLag; t++) trend += out[t];
    trend /= maxLag;
    for (var u = 1; u <= maxLag; u++) out[u] = Math.max(0, out[u] - trend * 0.15);
    return out;
  }

  function interp(arr, x) {
    var i = Math.floor(x);
    if (i < 0) return 0;
    if (i >= arr.length - 1) return arr[arr.length - 1] || 0;
    var f = x - i;
    return arr[i] * (1 - f) + arr[i + 1] * f;
  }

  /* --------------- 速度候选 --------------- */
  function tempoCandidates(env, fps) {
    var maxLag = Math.ceil(fps * 60 / BPM_MIN);
    var a = acf(env, maxLag + 2);

    var results = [];
    for (var bpm = BPM_MIN; bpm <= BPM_MAX; bpm += 0.25) {
      var lag = fps * 60 / bpm;
      var comb = 0, wsum = 0;
      for (var h = 1; h <= 4; h++) {
        var w = 1 / Math.pow(h, 1.4);
        if (lag * h > maxLag) break;
        comb += w * interp(a, lag * h);
        wsum += w;
      }
      comb = wsum > 0 ? comb / wsum : 0;
      var prior = Math.exp(-0.5 * Math.pow(Math.log2(bpm / BPM_PRIOR_CENTER) / BPM_PRIOR_SIGMA, 2));
      results.push({ bpm: bpm, acf: comb, prior: prior, score: comb * prior });
    }

    // 取局部峰
    var peaks = [];
    for (var i2 = 1; i2 < results.length - 1; i2++) {
      if (results[i2].score >= results[i2 - 1].score && results[i2].score >= results[i2 + 1].score) {
        peaks.push(results[i2]);
      }
    }
    peaks.sort(function (x, y) { return y.score - x.score; });

    // 合并高度邻近的候选（<1.5% 视为同一个）
    var merged = [];
    for (var p = 0; p < peaks.length && merged.length < 6; p++) {
      var dup = false;
      for (var m = 0; m < merged.length; m++) {
        if (Math.abs(Math.log2(peaks[p].bpm / merged[m].bpm)) < 0.02) { dup = true; break; }
      }
      if (!dup) merged.push(peaks[p]);
    }
    return merged;
  }

  /* --------------- DP 节拍跟踪 --------------- */
  function trackBeats(env, fps, bpm, opts) {
    opts = opts || {};
    var tightness = opts.tightness == null ? 2.0 : opts.tightness;
    var period = fps * 60 / bpm;
    var lo = Math.max(2, Math.floor(period * 0.88));
    var hi = Math.ceil(period * 1.12);
    var n = env.length;
    if (!(period > 0) || n < period * 4) return { frames: [], strengths: [] };

    var score = new Float32Array(n);
    var back = new Int32Array(n).fill(-1);
    for (var i = 0; i < n; i++) {
      var bestPrev = -1, bestVal = -Infinity;
      for (var c = lo; c <= hi; c++) {
        var j = i - c;
        if (j < 0) break;
        var v = score[j] - tightness * Math.abs(c - period) / period;
        if (v > bestVal) { bestVal = v; bestPrev = j; }
      }
      score[i] = env[i] + (bestPrev >= 0 ? bestVal : 0);
      back[i] = bestPrev;
    }

    // 从"最后一个强拍"回溯，而不是全局最大值（避免被结尾的弱拍带偏）
    var tailStart = Math.max(0, Math.floor(n - period * 2));
    var endIdx = tailStart;
    for (var t = tailStart; t < n; t++) if (score[t] > score[endIdx]) endIdx = t;

    var frames = [];
    var cur = endIdx;
    while (cur >= 0) {
      frames.push(cur);
      cur = back[cur];
    }
    frames.reverse();

    var strengths = frames.map(function (f) {
      var s = 0, c2 = 0;
      for (var d = -2; d <= 2; d++) {
        var idx = f + d;
        if (idx >= 0 && idx < n) { s += env[idx]; c2++; }
      }
      return c2 ? s / c2 : 0;
    });
    return { frames: frames, strengths: strengths };
  }

  function framesToMs(frames, hopMs) {
    var out = new Int32Array(frames.length);
    for (var i = 0; i < frames.length; i++) out[i] = Math.round(frames[i] * hopMs);
    return out;
  }

  /* --------------- 八度判定：拍点 vs 拍间中点 --------------- */
  function beatContrast(env, frames) {
    if (frames.length < 8) return 0;
    var gaps = [];
    for (var i = 1; i < frames.length; i++) gaps.push(frames[i] - frames[i - 1]);
    gaps.sort(function (a, b) { return a - b; });
    var med = gaps[gaps.length >> 1];
    if (!(med > 1)) return 0;
    var on = 0, mid = 0, c = 0;
    for (var k = 0; k < frames.length; k++) {
      var f = Math.round(frames[k]);
      var m = Math.round(f + med / 2);
      if (f < 1 || f >= env.length - 1 || m >= env.length - 1) continue;
      var ev = Math.max(env[f], env[f - 1], env[f + 1]);
      var mv = Math.max(env[m], env[m - 1], env[m + 1]);
      on += ev; mid += mv; c++;
    }
    if (!c) return 0;
    var onAvg = on / c, midAvg = mid / c;
    if (midAvg < 1e-4) return onAvg > 1e-4 ? 6 : 1;
    return onAvg / midAvg;
  }

  /* --------------- 网格稳定性：拍间隔离散度 + 强度一致性 --------------- */
  function gridStability(track) {
    var frames = track.frames;
    if (!frames || frames.length < 8) return 0;
    var gaps = [];
    for (var i = 1; i < frames.length; i++) gaps.push(frames[i] - frames[i - 1]);
    gaps.sort(function (a, b) { return a - b; });
    var med = gaps[gaps.length >> 1] || 0;
    if (!(med > 1)) return 0;
    var dev = 0;
    for (var j = 0; j < gaps.length; j++) dev += Math.abs(gaps[j] - med);
    dev /= gaps.length;
    var interval = Math.max(0, Math.min(1, 1 - dev / Math.max(1, med * 0.12)));
    // 强拍强弱本身可以有对比（小节重音），因此只把"全部近乎零"当异常。
    var s = track.strengths, mean = 0, nz = 0;
    for (var k = 0; k < s.length; k++) { mean += s[k]; if (s[k] > 1e-3) nz++; }
    mean /= (s.length || 1);
    var density = s.length ? nz / s.length : 0;
    return Math.round(Math.max(0, Math.min(1, interval * (0.7 + 0.3 * density))) * 1000) / 1000;
  }

  /* --------------- 稳定性：前后半速度一致性 --------------- */
  function stability(env, fps, bpm) {
    var half = Math.floor(env.length / 2);
    if (half < fps * 8) return 0.5;
    var a = env.subarray(0, half);
    var b = env.subarray(half);
    var ca = tempoCandidates(a, fps);
    var cb = tempoCandidates(b, fps);
    if (!ca.length || !cb.length) return 0.5;
    // 取与主估计最接近的家族（允许 2×）
    function norm(x) {
      var r = Math.log2(x / bpm);
      r -= Math.round(r);
      return Math.abs(r);
    }
    var dev = Math.max(norm(ca[0].bpm), norm(cb[0].bpm));
    return Math.max(0, Math.min(1, 1 - dev / 0.12));
  }

  /* --------------- 小节头 --------------- */
  function estimateMeter(frames, beatFrames) {
    if (beatFrames.length < 8) return { beatsPerBar: 4, phase: 0, confidence: 0 };

    var nb = beatFrames.length;
    var accent = new Float64Array(nb);
    var hchange = new Float64Array(nb);
    var prevChroma = null;
    for (var i = 0; i < nb; i++) {
      var f = Math.round(beatFrames[i]);
      if (f < 0 || f >= frames.count) { accent[i] = 0; continue; }
      var lo = 0;
      for (var b = 0; b <= 7; b++) lo += frames.mel[f * 40 + b];
      accent[i] = lo;
      var ch = new Float64Array(12);
      var norm = 0;
      for (var c = 0; c < 12; c++) { ch[c] = frames.chroma[f * 12 + c]; norm += ch[c] * ch[c]; }
      norm = Math.sqrt(norm) || 1;
      for (var c2 = 0; c2 < 12; c2++) ch[c2] /= norm;
      if (prevChroma) {
        var dot = 0;
        for (var c3 = 0; c3 < 12; c3++) dot += ch[c3] * prevChroma[c3];
        hchange[i] = 1 - dot;
      }
      prevChroma = ch;
    }

    function mean(arr) {
      var s = 0;
      for (var k = 0; k < arr.length; k++) s += arr[k];
      return arr.length ? s / arr.length : 0;
    }
    var accMean = mean(accent) || 1e-9;
    var hcMean = mean(hchange) || 1e-9;

    function evalMeter(period) {
      var best = { phase: 0, score: -1, accContrast: 1, hcContrast: 1 };
      for (var ph = 0; ph < period; ph++) {
        var a = 0, ac = 0, h = 0, hc = 0;
        for (var k = ph; k < nb; k += period) { a += accent[k]; ac++; h += hchange[k]; hc++; }
        var accContrast = ac ? (a / ac) / accMean : 0;
        var hcContrast = hc ? (h / hc) / hcMean : 0;
        // 小节头＝低频重音 + 和声变化，两者都要偏强
        var score = 0.6 * accContrast + 0.4 * hcContrast;
        if (score > best.score) best = { phase: ph, score: score, accContrast: accContrast, hcContrast: hcContrast };
      }
      return { period: period, phase: best.phase, score: best.score, accContrast: best.accContrast, hcContrast: best.hcContrast };
    }

    var m4 = evalMeter(4);
    var m3 = evalMeter(3);
    // 4/4 先验（流行/摇滚/电子压倒性多数）：3 拍必须明显更强才改判
    var pick = m4.score * 1.12 >= m3.score ? m4 : m3;
    return {
      beatsPerBar: pick.period,
      phase: pick.phase,
      confidence: Math.max(0, Math.min(1, (pick.score - 1) / 0.6)),
    };
  }

  /* --------------- 乐句长度（拍） --------------- */
  function estimatePhrase(frames, beatFrames, beatsPerBar) {
    if (beatFrames.length < 16) return { beats: beatsPerBar * 2, confidence: 0 };
    var rows = [];
    for (var i = 0; i < beatFrames.length; i++) {
      var f = Math.round(beatFrames[i]);
      if (f < 0 || f >= frames.count) { rows.push(null); continue; }
      var v = new Float64Array(13);
      for (var c = 0; c < 12; c++) v[c] = frames.chroma[f * 12 + c];
      v[12] = frames.rms[f];
      rows.push(v);
    }
    function dist(a, b) {
      if (!a || !b) return 0;
      var num = 0, da = 0, db = 0;
      for (var k = 0; k < 13; k++) { num += a[k] * b[k]; da += a[k] * a[k]; db += b[k] * b[k]; }
      var cos = num / Math.sqrt((da || 1) * (db || 1));
      return 1 - cos;
    }
    var best = { lag: beatsPerBar * 2, score: -1 };
    var scores = {};
    for (var lag = 2; lag <= 32; lag++) {
      var s = 0, c2 = 0;
      for (var q = 0; q + lag < rows.length; q++) { s += 1 - dist(rows[q], rows[q + lag]); c2++; }
      var sc = c2 ? s / c2 : 0;
      scores[lag] = sc;
      if (sc > best.score) best = { lag: lag, score: sc };
    }
    // 优先落在 2 的幂（4/8/16/32 拍），差 15% 以内就吸附
    var snap = [4, 8, 16, 32].filter(function (v) { return v >= beatsPerBar * 2; });
    for (var s2 = 0; s2 < snap.length; s2++) {
      var v2 = snap[s2];
      if (scores[v2] && scores[v2] >= best.score * 0.85) { best = { lag: v2, score: scores[v2] }; break; }
    }
    var mean = 0, cnt = 0;
    for (var k2 in scores) { mean += scores[k2]; cnt++; }
    mean = cnt ? mean / cnt : 0;
    return {
      beats: best.lag,
      confidence: mean > 0 ? Math.max(0, Math.min(1, (best.score / mean - 1) / 1.5)) : 0,
    };
  }

  /* --------------- 对外主函数 --------------- */
  function analyze(frames) {
    var fps = frames.fps;
    var env = onsetEnvelope(frames);
    var cands = tempoCandidates(env, fps);

    // 显式补上 1:2 家族候选：单靠 ACF 谐波求和会系统性偏向"分拍"解释，
    // 展开后再用 对比度 × 先验 决定，比事后修正更可控。
    var expanded = [];
    var seen = [];
    function addCand(bpm, acf) {
      if (!(bpm >= BPM_MIN && bpm <= BPM_MAX)) return;
      for (var s = 0; s < seen.length; s++) if (Math.abs(Math.log2(bpm / seen[s])) < 0.02) return;
      seen.push(bpm);
      expanded.push({ bpm: bpm, acf: acf || 0 });
    }
    for (var c0 = 0; c0 < Math.min(3, cands.length); c0++) {
      addCand(cands[c0].bpm, cands[c0].acf);
      addCand(cands[c0].bpm * 2, cands[c0].acf * 0.9);
      addCand(cands[c0].bpm / 2, cands[c0].acf * 0.9);
    }

    var evaluated = expanded.map(function (c) {
      var track = trackBeats(env, fps, c.bpm);
      var contrast = beatContrast(env, track.frames);
      var prior = Math.exp(-0.5 * Math.pow(Math.log2(c.bpm / BPM_PRIOR_CENTER) / BPM_PRIOR_SIGMA, 2));
      var score = Math.max(1e-6, c.acf) * prior * Math.pow(Math.max(0.15, contrast), 0.5);
      return {
        bpm: Math.round(c.bpm * 100) / 100,
        acf: c.acf, prior: prior, contrast: contrast,
        score: score, track: track,
      };
    });
    evaluated.sort(function (a, b) { return b.score - a.score; });

    // 八度消歧：若存在 1:2 关系且分数接近，取更接近 120 BPM（对数距离）的那个。
    // 理由：节奏分析里"半速/倍速"在 ACF 上几乎等价，任何"绝对正确"的判定都不可靠；
    // 选择靠近常见速度区间的解释，可以让后续规划的时间拉伸量最小（planner 仍会尝试全部候选）。
    if (evaluated.length > 1) {
      var head = evaluated[0];
      for (var e2 = 1; e2 < evaluated.length; e2++) {
        var c2 = evaluated[e2];
        var r = Math.log2(c2.bpm / head.bpm);
        var isOctave = Math.abs(Math.abs(r) - 1) < 0.03;
        if (!isOctave) continue;
        if (c2.score < head.score * 0.85) continue;
        var dHead = Math.abs(Math.log2(head.bpm / 120));
        var dCand = Math.abs(Math.log2(c2.bpm / 120));
        if (dCand + 0.15 < dHead) {
          evaluated.splice(e2, 1);
          evaluated.unshift(c2);
          head = c2;
        }
        break;
      }
    }

    var best = evaluated[0] || null;
    var stab = best ? stability(env, fps, best.bpm) : 0;
    var totalW = evaluated.reduce(function (s, e) { return s + e.score; }, 0) || 1;

    var beatFrames = best ? best.track.frames : [];
    var meter = estimateMeter(frames, beatFrames);
    var phrase = estimatePhrase(frames, beatFrames, meter.beatsPerBar);

    // 置信度分两类证据：
    // - dominance 只比较**非八度**竞争者。半/倍速解释在 ACF 上本来就接近，
    //   把它当成"网格不可靠"会系统性压低电子乐与慢歌的置信度；
    // - 网格间隔/拍点密度作为独立证据，避免只有 ACF 峰值好、拍点却抖动的误判。
    var conf = 0;
    var octaveAmbiguity = 0;
    var gridStab = best ? gridStability(best.track) : 0;
    if (best) {
      var nonOctave = null;
      for (var nz = 1; nz < evaluated.length; nz++) {
        var rr = Math.log2(evaluated[nz].bpm / best.bpm);
        if (Math.abs(Math.abs(rr) - 1) >= 0.03) { nonOctave = evaluated[nz]; break; }
      }
      var secondScore = nonOctave ? nonOctave.score : 0;
      var dominance = secondScore > 0 ? Math.min(1, (best.score / secondScore - 1) / 1.5) : 1;
      for (var oi = 1; oi < evaluated.length; oi++) {
        var ro = Math.log2(evaluated[oi].bpm / best.bpm);
        if (Math.abs(Math.abs(ro) - 1) < 0.03) {
          octaveAmbiguity = Math.max(octaveAmbiguity, Math.min(1, evaluated[oi].score / Math.max(1e-9, best.score)));
        }
      }
      var contrastPart = Math.min(1, Math.max(0, (best.contrast - 1) / 2.5));
      conf = Math.max(0, Math.min(1,
        0.25 * dominance + 0.25 * contrastPart + 0.2 * stab + 0.3 * gridStab));
    }

    return {
      onset: env,
      bpm: best ? best.bpm : 0,
      confidence: conf,
      stability: stab,
      gridStability: gridStab,
      octaveAmbiguity: Math.round(octaveAmbiguity * 1000) / 1000,
      candidates: evaluated.slice(0, 4).map(function (e) {
        return {
          bpm: e.bpm,
          weight: Math.round((e.score / totalW) * 1000) / 1000,
          family: familyOf(e.bpm, best ? best.bpm : e.bpm),
          contrast: Math.round(e.contrast * 100) / 100,
        };
      }),
      beatFrames: beatFrames,
      beatStrengths: best ? best.track.strengths : [],
      meter: meter,
      phrase: phrase,
    };
  }

  function familyOf(bpm, ref) {
    if (!ref) return 'straight';
    var r = Math.log2(bpm / ref);
    if (Math.abs(r) < 0.04) return 'straight';
    if (Math.abs(r - 1) < 0.04) return 'double';
    if (Math.abs(r + 1) < 0.04) return 'half';
    if (Math.abs(r - Math.log2(1.5)) < 0.05) return '3:2';
    if (Math.abs(r + Math.log2(1.5)) < 0.05) return '2:3';
    return 'other';
  }

  return {
    onsetEnvelope: onsetEnvelope,
    tempoCandidates: tempoCandidates,
    trackBeats: trackBeats,
    framesToMs: framesToMs,
    beatContrast: beatContrast,
    estimateMeter: estimateMeter,
    estimatePhrase: estimatePhrase,
    familyOf: familyOf,
    analyze: analyze,
  };
});
