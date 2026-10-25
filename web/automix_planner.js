'use strict';
/*
 * AutoMix 规划器 —— 全交叠区间评价、多策略候选、硬约束与软评分分离。
 *
 * 纯函数：不碰音频、DOM、IO 或时钟；相同 profile 与 options 产生逐字节相同的结果。
 * frames.lowRatio / frames.transient 缺失时仅移除对应权重，transient 可回退到 flux。
 * 未知特征永不按 0 分惩罚。
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (typeof root !== 'undefined') root.AutoMixPlanner = api;
})(typeof self !== 'undefined' ? self : this, function () {

  var VERSION = 4;
  var DEFAULTS = {
    minBars: 2,
    bars: 4,
    radicalBars: 8,
    maxStretch: 0.03,
    maxStretchWsola: 0.10, // 仅保留配置兼容；播放层没有 WSOLA，规划器绝不采用它。
    minDurationMs: 1600,
    maxDurationMs: 24000,
    scanTailMs: 75000,
    scanHeadMs: 45000,
    safeDurationMs: 4000,
    shortDurationMs: 2200,
    minTotalScore: 0.45,
    minConfidence: 0.32,
    // 流式 worklet 没有 playbackRate/resample；下一首是流媒体时不能执行
    // 采样率变速。由 app.js 按 audioEngine._nextIsStreaming 传入。
    nextStreaming: false,
    // 同专辑、按碟/轨顺序紧邻。是否真的连续由 profile.edges 决定：
    // 两侧边界都没有数字静音，说明原文件本来就是无缝衔接的。
    albumSequence: false,
    continuousEdgeMs: 120,
  };

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function log2(v) { return Math.log(v) / Math.LN2; }
  function num(v, fallback) { return (typeof v === 'number' && isFinite(v)) ? v : fallback; }
  function r2(v) { return Math.round(v * 100) / 100; }
  function r3(v) { return Math.round(v * 1000) / 1000; }
  function meanConfidence(a, b, fallback) {
    return Math.min(num(a, fallback), num(b, fallback));
  }

  // profile 在生命周期内不变；网格统计被每个候选反复查询，缓存是避免
  // 对数千个拍点重复排序的关键。结果只依赖 profile 内容，不引入时间/随机性。
  var GRID_CACHE = new WeakMap();
  function medianBeatMs(profile) {
    if (!profile || typeof profile !== 'object') return 0;
    var cached = GRID_CACHE.get(profile);
    if (cached) return cached.beatMs;
    var times = profile.beats && profile.beats.timesMs;
    var beatMs = 0;
    if (times && times.length >= 4) {
      var gaps = [];
      for (var i = 1; i < times.length; i++) {
        if (times[i] > times[i - 1]) gaps.push(times[i] - times[i - 1]);
      }
      if (gaps.length) {
        gaps.sort(function (a, b) { return a - b; });
        beatMs = gaps[gaps.length >> 1] || 0;
      }
    }
    GRID_CACHE.set(profile, { beatMs: beatMs, hasGrid: beatMs > 0 && times && times.length >= 4 });
    return beatMs;
  }

  function hasGrid(profile) {
    if (!profile || typeof profile !== 'object') return false;
    medianBeatMs(profile);
    return GRID_CACHE.get(profile).hasGrid;
  }

  function barMs(profile) {
    var bpb = (profile && profile.beats && profile.beats.beatsPerBar) || 4;
    return medianBeatMs(profile) * bpb;
  }

  function profileDuration(profile) {
    var declared = num(profile && profile.durationMs, 0);
    if (declared > 0) return declared;
    var frames = profile && profile.frames;
    if (!frames || !frames.rmsDb || !frames.rmsDb.length) return 0;
    return frames.rmsDb.length * num(frames.hopMs, 1000);
  }

  function energyAt(profile, ms) {
    var frames = profile && profile.frames;
    if (!frames || !frames.rmsDb || !frames.rmsDb.length) return -40;
    var index = clamp(Math.round(ms / num(frames.hopMs, 1000)), 0, frames.rmsDb.length - 1);
    return num(frames.rmsDb[index], -40);
  }

  function segmentAt(profile, ms) {
    var segments = (profile && profile.segments) || [];
    for (var i = 0; i < segments.length; i++) {
      if (ms >= segments[i].startMs && ms < segments[i].endMs) return segments[i];
    }
    return null;
  }

  function nearestPhraseDist(profile, ms) {
    var beats = profile && profile.beats;
    if (!beats || !beats.timesMs || !beats.timesMs.length) return Infinity;
    var bpb = beats.beatsPerBar || 4;
    var phrase = beats.phraseBeats || bpb * 2;
    var step = Math.max(1, Math.round(phrase / bpb));
    var best = Infinity;
    for (var i = 0; i < beats.timesMs.length; i += bpb) {
      if ((i / bpb) % step !== 0) continue;
      best = Math.min(best, Math.abs(beats.timesMs[i] - ms));
    }
    return best;
  }

  /* 返回整个 [startMs, startMs + durationMs] 的统计，而非起点瞬时值。 */
  function seriesStats(profile, key, startMs, durationMs) {
    var frames = profile && profile.frames;
    var values = frames && frames[key];
    var empty = { known: false, mean: null, start: null, end: null, slope: null };
    if (!values || !values.length || !(durationMs > 0)) return empty;
    var hop = num(frames.hopMs, 1000);
    var from = Math.max(0, Math.floor(startMs / hop));
    var to = Math.min(values.length - 1, Math.ceil((startMs + durationMs) / hop));
    if (from >= values.length || to < from) return empty;
    var sum = 0, count = 0, first = null, last = null, firstIndex = from, lastIndex = from;
    for (var i = from; i <= to; i++) {
      var value = values[i];
      if (typeof value !== 'number' || !isFinite(value)) continue;
      if (first === null) { first = value; firstIndex = i; }
      last = value; lastIndex = i;
      sum += value; count++;
    }
    if (!count) return empty;
    var spanSec = Math.max(0, (lastIndex - firstIndex) * hop / 1000);
    return {
      known: true,
      mean: sum / count,
      start: first,
      end: last,
      slope: spanSec > 0 ? (last - first) / spanSec : 0,
    };
  }

  // 同时占用：逐秒取 A/B 同一时刻的值再相乘。用两个区间均值相乘会把
  // "A 前半有人声、B 后半有人声"误当成冲突；这只是代理共现，不是 VAD。
  function alignedProduct(a, keyA, startA, b, keyB, startB, durationMs) {
    var fa = a && a.frames, fb = b && b.frames;
    var va = fa && fa[keyA], vb = fb && fb[keyB];
    if (!va || !vb || !va.length || !vb.length || !(durationMs > 0)) return null;
    var hopA = num(fa.hopMs, 1000), hopB = num(fb.hopMs, 1000);
    var segMs = Math.min(hopA, hopB);
    var sum = 0, count = 0;
    for (var t = 0; t < durationMs; t += segMs) {
      var ia = clamp(Math.round((startA + t) / hopA), 0, va.length - 1);
      var ib = clamp(Math.round((startB + t) / hopB), 0, vb.length - 1);
      var x = va[ia], y = vb[ib];
      if (typeof x !== 'number' || !isFinite(x) || typeof y !== 'number' || !isFinite(y)) continue;
      sum += clamp(x, 0, 1) * clamp(y, 0, 1);
      count++;
    }
    return count ? sum / count : null;
  }

  function intervalStats(a, b, exitMs, entryMs, durationMs) {
    var transientA = a.frames && a.frames.transient ? 'transient' : 'flux';
    var transientB = b.frames && b.frames.transient ? 'transient' : 'flux';
    var lowProduct = alignedProduct(a, 'lowRatio', exitMs, b, 'lowRatio', entryMs, durationMs);
    var vocalProduct = alignedProduct(a, 'vocal', exitMs, b, 'vocal', entryMs, durationMs);
    var transientProduct = alignedProduct(a, transientA, exitMs, b, transientB, entryMs, durationMs);
    return {
      a: {
        rmsDb: seriesStats(a, 'rmsDb', exitMs, durationMs),
        lowRatio: seriesStats(a, 'lowRatio', exitMs, durationMs),
        transient: seriesStats(a, transientA, exitMs, durationMs),
        vocal: seriesStats(a, 'vocal', exitMs, durationMs),
      },
      b: {
        rmsDb: seriesStats(b, 'rmsDb', entryMs, durationMs),
        lowRatio: seriesStats(b, 'lowRatio', entryMs, durationMs),
        transient: seriesStats(b, transientB, entryMs, durationMs),
        vocal: seriesStats(b, 'vocal', entryMs, durationMs),
      },
      joint: { low: lowProduct, vocal: vocalProduct, transient: transientProduct },
    };
  }

  var MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
  var MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

  function keyFit(a, b) {
    if (!a || !b || !a.key || !b.key || !a.flags || !b.flags ||
        !a.flags.keyUsable || !b.flags.keyUsable) {
      return { value: null, known: false };
    }
    var pcA = a.key.tonic, pcB = b.key.tonic;
    if (!(pcA >= 0 && pcA < 12 && pcB >= 0 && pcB < 12)) return { value: null, known: false };
    var fifthA = (pcA * 7) % 12, fifthB = (pcB * 7) % 12;
    var distance = Math.abs(fifthA - fifthB);
    distance = Math.min(distance, 12 - distance);
    var sameMode = a.key.mode === b.key.mode;
    var table = [1.0, 0.85, 0.65, 0.5, 0.35, 0.3, 0.25];
    var value = table[Math.min(6, distance)];
    if (!sameMode) {
      var relative = pcA === (pcB + 9) % 12 || pcB === (pcA + 9) % 12;
      value = relative ? Math.min(1, value + 0.15) : value * 0.8;
    }
    return { value: value, known: true, fifthDistance: distance, sameMode: sameMode };
  }

  function tempoPair(a, b) {
    var candidatesA = (a.tempo && a.tempo.candidates && a.tempo.candidates.length)
      ? a.tempo.candidates : [{ bpm: num(a.tempo && a.tempo.primary, 0), weight: 1 }];
    var candidatesB = (b.tempo && b.tempo.candidates && b.tempo.candidates.length)
      ? b.tempo.candidates : [{ bpm: num(b.tempo && b.tempo.primary, 0), weight: 1 }];
    var best = null;
    for (var i = 0; i < candidatesA.length; i++) {
      for (var j = 0; j < candidatesB.length; j++) {
        var bpmA = candidatesA[i].bpm, bpmB = candidatesB[j].bpm;
        if (!(bpmA > 0 && bpmB > 0)) continue;
        var ratio = bpmA / bpmB;
        while (ratio > 1.45) ratio /= 2;
        while (ratio < 0.7) ratio *= 2;
        var error = Math.abs(log2(ratio));
        var weight = num(candidatesA[i].weight, 0.5) * num(candidatesB[j].weight, 0.5);
        var rank = error / Math.max(0.2, weight);
        if (!best || rank < best.rank) {
          best = { ratio: ratio, error: error, bpmA: bpmA, bpmB: bpmB, rank: rank };
        }
      }
    }
    if (!best) return { ratio: 1, error: null, known: false, bpmA: 0, bpmB: 0 };
    return {
      ratio: best.ratio, error: best.error, known: true,
      bpmA: best.bpmA, bpmB: best.bpmB, semitones: 12 * log2(best.ratio),
    };
  }

  /* 1Hz 能量/相对人声代理用于无网格时的安全边界；不把它当作 VAD 硬门限。 */
  function energyPoints(profile, side, opts) {
    var frames = profile && profile.frames;
    if (!frames || !frames.rmsDb || !frames.rmsDb.length) return [];
    var hop = num(frames.hopMs, 1000);
    var duration = profileDuration(profile);
    var first = 0, last = frames.rmsDb.length - 1;
    if (side === 'exit') {
      first = Math.max(0, Math.floor(Math.max(duration * 0.55, duration - opts.scanTailMs) / hop));
      last = Math.min(last, Math.floor((duration - 400) / hop));
    } else {
      last = Math.min(last, Math.floor(Math.min(opts.scanHeadMs, duration * 0.3) / hop));
    }
    var points = [];
    for (var i = first; i <= last; i++) {
      var energy = num(frames.rmsDb[i], -60);
      var previous = num(frames.rmsDb[Math.max(first, i - 2)], energy);
      var next = num(frames.rmsDb[Math.min(last, i + 2)], energy);
      var vocal = frames.vocal ? clamp(num(frames.vocal[i], 0.5), 0, 1) : 0.5;
      var trend = side === 'exit' ? previous - energy : next - energy;
      var score = clamp(0.35 + trend / 20 + (1 - vocal) * 0.25 - Math.max(0, -42 - energy) / 30, 0, 1);
      points.push({
        tMs: Math.round(i * hop), type: 'energy', score: score,
        energyDb: energy, vocalGap: 1 - vocal, beatIndex: -1,
        isDownbeat: false, isPhrase: false,
      });
    }
    points.sort(function (a, b) { return b.score - a.score || a.tMs - b.tMs; });
    return points.slice(0, 5);
  }

  function pointPool(profile, side, opts) {
    var source = profile.mixPoints && profile.mixPoints[side === 'exit' ? 'exits' : 'entries'];
    var points = (source || []).slice();
    var duration = profileDuration(profile);
    if (side === 'exit') {
      var tail = points.filter(function (p) {
        return p.tMs >= Math.max(duration * 0.55, duration - opts.scanTailMs);
      });
      if (tail.length) points = tail;
    } else {
      var head = points.filter(function (p) {
        return p.tMs <= Math.min(opts.scanHeadMs, duration > 0 ? duration * 0.3 : opts.scanHeadMs);
      });
      if (head.length) points = head;
    }
    points = points.concat(energyPoints(profile, side, opts));
    if (!points.length) {
      var tMs = side === 'exit' ? Math.max(0, duration - opts.safeDurationMs) : 0;
      points = [{ tMs: tMs, type: side === 'exit' ? 'tail' : 'head', score: 0.2,
        energyDb: energyAt(profile, tMs), vocalGap: 0.5, beatIndex: -1,
        isDownbeat: false, isPhrase: false }];
    }
    points.sort(function (a, b) {
      return num(b.score, 0) - num(a.score, 0) || a.tMs - b.tMs ||
        String(a.type).localeCompare(String(b.type));
    });
    var unique = [], seen = {}, buckets = {};
    for (var i = 0; i < points.length && unique.length < 5; i++) {
      var key = Math.round(points[i].tMs);
      if (seen[key]) continue;
      // 不取同一小节附近的 5 个近似点：那会让"多候选比较"退化成同一个方案。
      // 每个 8s 桶最多取 2 个高分点，剩余预算留给真正不同的位置。
      var bucket = Math.floor(key / 8000);
      if ((buckets[bucket] || 0) >= 2) continue;
      buckets[bucket] = (buckets[bucket] || 0) + 1;
      seen[key] = true;
      unique.push(points[i]);
    }
    return unique;
  }

  function fitDuration(desired, exitMs, entryMs, a, b, opts) {
    var duration = clamp(desired, opts.minDurationMs, opts.maxDurationMs);
    var durationA = profileDuration(a), durationB = profileDuration(b);
    if (durationA > 0) duration = Math.min(duration, durationA - exitMs);
    // 流媒体 durationMs 未知时不把 entry 强制归零，也不虚构上界。
    if (durationB > 0) duration = Math.min(duration, durationB - entryMs);
    return Math.floor(duration);
  }

  function gridDuration(A, B, a, b, opts, barRef) {
    var durationA = profileDuration(a), durationB = profileDuration(b);
    var availA = durationA > 0 ? (durationA - A.tMs) / barRef : Infinity;
    var availB = durationB > 0 ? (durationB - B.tMs) / barRef : Infinity;
    var maxBars = Math.floor(Math.min(availA, availB));
    var desired = opts.radical ? opts.radicalBars : opts.bars;
    var allowed = [8, 4, 2, 1].filter(function (bars) {
      return bars <= maxBars && bars >= opts.minBars && bars <= desired;
    });
    var bars = allowed.length ? allowed[0] : Math.max(opts.minBars, Math.min(desired, maxBars));
    if (!isFinite(bars) || bars < 1) bars = desired;
    return { bars: bars, durationMs: clamp(Math.round(bars * barRef), opts.minDurationMs, opts.maxDurationMs) };
  }

  function baseCandidate(strategy, A, B, a, b, durationMs, bars, ratio, interval) {
    return {
      strategy: strategy,
      exitMs: Math.round(A.tMs), entryMs: Math.round(B.tMs), durationMs: Math.round(durationMs),
      bars: bars || 0, ratio: ratio, semitones: 12 * log2(ratio),
      stretchAllowed: Math.abs(ratio - 1) > 1e-6,
      phaseErrMs: 0, exitType: A.type || 'unknown', entryType: B.type || 'unknown',
      isPhraseExit: !!A.isPhrase, isDownbeatEntry: !!B.isDownbeat,
      pointA: A, pointB: B,
      interval: interval || intervalStats(a, b, A.tMs, B.tMs, durationMs),
      conservative: strategy === 'safe-fade' || strategy === 'short-fade' || strategy === 'phrase-cut',
    };
  }

  function buildCandidates(a, b, opts) {
    var exits = pointPool(a, 'exit', opts), entries = pointPool(b, 'entry', opts);
    var pairing = tempoPair(a, b), kf = keyFit(a, b);
    var beatA = medianBeatMs(a), beatB = medianBeatMs(b);
    var fallbackBpm = num(a.tempo && a.tempo.primary, 0) || num(b.tempo && b.tempo.primary, 0) || 120;
    var barRef = barMs(a) || barMs(b) || (60000 / Math.max(40, fallbackBpm) * 4);
    var accepted = [], rejected = [], energyEvidence = false;

    for (var i = 0; i < exits.length; i++) {
      for (var j = 0; j < entries.length; j++) {
        var A = exits[i], B = entries[j];
        var grid = gridDuration(A, B, a, b, opts, barRef);
        var safeDuration = fitDuration(opts.safeDurationMs, A.tMs, B.tMs, a, b, opts);
        var shortDuration = fitDuration(opts.shortDurationMs, A.tMs, B.tMs, a, b, opts);
        var longDuration = fitDuration(grid.durationMs, A.tMs, B.tMs, a, b, opts);
        // 多策略共享同一窗口统计；策略只改变软评分，不重复扫描帧数组。
        var longInterval = intervalStats(a, b, A.tMs, B.tMs, longDuration);
        var safeInterval = intervalStats(a, b, A.tMs, B.tMs, safeDuration);
        var shortInterval = intervalStats(a, b, A.tMs, B.tMs, shortDuration);
        var lowAInt = longInterval.a.lowRatio, lowBInt = longInterval.b.lowRatio;
        var lowConflict = lowAInt.known && lowBInt.known
          ? clamp(Math.sqrt(Math.max(0, lowAInt.mean * lowBInt.mean)), 0, 1) : null;
        var gridUsable = hasGrid(a) && hasGrid(b) && A.beatIndex >= 0 && B.beatIndex >= 0 &&
          !!A.isDownbeat && !!B.isDownbeat;

        // 只生成与该对歌曲证据相符的策略。每个策略都仍要经过硬约束和软评分；
        // 不生成 eq-swap 不叫"拒绝方案"，而是没有低频冲突可处理。
        var list = [baseCandidate('structure-blend', A, B, a, b, longDuration, grid.bars, 1, longInterval)];
        if (lowConflict !== null && lowConflict >= 0.30) {
          list.push(baseCandidate('eq-swap', A, B, a, b, longDuration, grid.bars, 1, longInterval));
        }
        if (gridUsable && pairing.known) {
          list.push(baseCandidate('beatmatch', A, B, a, b, longDuration, grid.bars, pairing.ratio, longInterval));
          if (pairing.known && Math.abs(pairing.ratio - 1) > 1e-3) {
            list.push(baseCandidate('tempo-ramp', A, B, a, b, longDuration, grid.bars, pairing.ratio, longInterval));
          }
        }
        var va = longInterval.a.vocal, vb = longInterval.b.vocal;
        var vocalConflict = va.known && vb.known ? clamp(va.mean, 0, 1) * clamp(vb.mean, 0, 1) : 0;
        // 只在相对人声代理密集且长淡确实冲突时生成；未生成不是 vocal 硬拒绝。
        if (longDuration >= 4000 && vocalConflict >= 0.16) {
          list.push(baseCandidate('vocal-avoid', A, B, a, b, longDuration, grid.bars, 1, longInterval));
        }
        list.push(baseCandidate('safe-fade', A, B, a, b, safeDuration, 0, 1, safeInterval));
        if (A.isPhrase || B.isPhrase) {
          list.push(baseCandidate('phrase-cut', A, B, a, b, shortDuration, 0, 1, shortInterval));
        } else {
          list.push(baseCandidate('short-fade', A, B, a, b, shortDuration, 0, 1, shortInterval));
        }

        for (var k = 0; k < list.length; k++) {
          var candidate = list[k];
          if (candidate.interval.a.rmsDb.known && candidate.interval.b.rmsDb.known) energyEvidence = true;
          var hardWhy = validateCandidate(candidate, a, b, opts, pairing);
          if (hardWhy.length) {
            rejected.push(rejectionSummary(candidate, hardWhy));
          } else {
            scoreCandidate(candidate, a, b, pairing, kf);
            accepted.push(candidate);
          }
        }
      }
    }

    accepted.sort(compareCandidates);
    rejected.sort(function (x, y) {
      return x.strategy.localeCompare(y.strategy) || x.exitMs - y.exitMs ||
        x.entryMs - y.entryMs || x.why.join(',').localeCompare(y.why.join(','));
    });
    return { accepted: accepted, rejected: rejected, pairing: pairing, key: kf, energyEvidence: energyEvidence };
  }

  function validateCandidate(candidate, a, b, opts, pairing) {
    var why = [];
    var durationA = profileDuration(a), durationB = profileDuration(b);
    if (!(candidate.exitMs >= 0) || (durationA > 0 && candidate.exitMs >= durationA)) why.push('exit_out_of_bounds');
    if (!(candidate.entryMs >= 0) || (durationB > 0 && candidate.entryMs >= durationB)) why.push('entry_out_of_bounds');
    if (!(candidate.durationMs >= opts.minDurationMs)) why.push('duration_below_minimum');
    if (!(candidate.durationMs <= opts.maxDurationMs)) why.push('duration_above_maximum');
    if (durationA > 0 && candidate.exitMs + candidate.durationMs > durationA + 1) why.push('overlap_exceeds_current_track');
    if (durationB > 0 && candidate.entryMs + candidate.durationMs > durationB + 1) why.push('overlap_exceeds_next_track');
    if (!(candidate.ratio > 0) || !isFinite(candidate.ratio)) why.push('invalid_rate');
    if (Math.abs(candidate.ratio - 1) > opts.maxStretch + 1e-6) why.push('rate_capability_exceeded');
    if (opts.nextStreaming && Math.abs(candidate.ratio - 1) > 1e-6) {
      why.push('streaming_next_has_no_rate_control');
    }
    if (Math.abs(candidate.ratio - 1) > 1e-6 && candidate.strategy !== 'beatmatch' && candidate.strategy !== 'tempo-ramp') {
      why.push('strategy_cannot_change_rate');
    }
    if (candidate.strategy === 'beatmatch' || candidate.strategy === 'tempo-ramp') {
      if (!pairing.known) why.push('tempo_grid_required');
      if (!hasGrid(a) || !hasGrid(b) || candidate.pointA.beatIndex < 0 || candidate.pointB.beatIndex < 0) {
        why.push('aligned_beat_grid_required');
      }
      if (!candidate.pointA.isDownbeat || !candidate.pointB.isDownbeat) why.push('downbeat_grid_required');
      if (a.flags && a.flags.isDjMix) why.push('dj_mix_grid_untrusted');
    }
    if (candidate.strategy === 'phrase-cut' &&
        ((!candidate.pointA.isPhrase && !candidate.pointB.isPhrase) ||
         meanConfidence(a.beats && a.beats.phraseConfidence, b.beats && b.beats.phraseConfidence, 0) <= 0)) {
      why.push('phrase_grid_required');
    }
    if (candidate.strategy === 'safe-fade' &&
        (!candidate.interval.a.rmsDb.known || !candidate.interval.b.rmsDb.known)) {
      why.push('energy_interval_required');
    }
    var structureKnown = !!((a.segments && a.segments.length) || (b.segments && b.segments.length));
    var energyKnown = candidate.interval.a.rmsDb.known && candidate.interval.b.rmsDb.known;
    if (!hasGrid(a) && !hasGrid(b) && !energyKnown && !structureKnown) why.push('insufficient_transition_evidence');
    return why;
  }

  function rejectionSummary(candidate, why) {
    return {
      strategy: candidate.strategy, exitMs: candidate.exitMs, entryMs: candidate.entryMs,
      durationMs: candidate.durationMs, ratio: r3(candidate.ratio), why: why,
    };
  }

  function scoreCandidate(candidate, a, b, pairing, kf) {
    var A = candidate.pointA, B = candidate.pointB, interval = candidate.interval;
    var terms = { tempo: null, phase: null, phrase: null, energy: null, low: null,
      transient: null, key: null, vocal: null, structure: null, mixPoint: null };
    var weights = { tempo: 0, phase: 0, phrase: 0, energy: 0, low: 0,
      transient: 0, key: 0, vocal: 0, structure: 0, mixPoint: 0 };
    var evidence = {};

    if (pairing.known) {
      terms.tempo = Math.exp(-Math.pow(log2(pairing.ratio), 2) / (2 * 0.05 * 0.05));
      weights.tempo = 0.16 * meanConfidence(a.tempo && a.tempo.confidence, b.tempo && b.tempo.confidence, 0.5);
      evidence.tempo = meanConfidence(a.tempo && a.tempo.confidence, b.tempo && b.tempo.confidence, 0.5);
    }

    var beatMs = medianBeatMs(a) || medianBeatMs(b) || 500;
    if (hasGrid(a) && hasGrid(b) && A.beatIndex >= 0 && B.beatIndex >= 0) {
      var beatTimeA = a.beats.timesMs[A.beatIndex], beatTimeB = b.beats.timesMs[B.beatIndex];
      candidate.phaseErrMs = Math.abs((A.tMs - beatTimeA) - (B.tMs - beatTimeB) * candidate.ratio);
      terms.phase = clamp(1 - candidate.phaseErrMs / (beatMs / 8), 0, 1);
      weights.phase = 0.13 * meanConfidence(a.beats && a.beats.confidence, b.beats && b.beats.confidence, 0.5);
      evidence.phase = meanConfidence(a.beats && a.beats.confidence, b.beats && b.beats.confidence, 0.5);
    }

    if (hasGrid(a) && hasGrid(b) && A.beatIndex >= 0 && B.beatIndex >= 0) {
      var bpbA = a.beats.beatsPerBar || 4, bpbB = b.beats.beatsPerBar || 4;
      var phraseA = a.beats.phraseBeats || bpbA * 2, phraseB = b.beats.phraseBeats || bpbB * 2;
      var phrasePeriod = phraseA * (medianBeatMs(a) || beatMs);
      var phraseDistance = nearestPhraseDist(a, A.tMs);
      terms.phrase = A.isPhrase ? 1 : (A.isDownbeat ? 0.75 : clamp(1 - phraseDistance / (phrasePeriod / 2), 0.05, 0.75));
      var barInPhraseA = Math.round(A.beatIndex / bpbA) % Math.max(1, Math.round(phraseA / bpbA));
      var barInPhraseB = Math.round(B.beatIndex / bpbB) % Math.max(1, Math.round(phraseB / bpbB));
      if (barInPhraseA !== barInPhraseB) terms.phrase *= 0.6;
      var phraseConfidence = Math.min(
        meanConfidence(a.beats && a.beats.phraseConfidence, b.beats && b.beats.phraseConfidence, 0.5),
        meanConfidence(a.beats && a.beats.meterConfidence, b.beats && b.beats.meterConfidence, 0.5)
      );
      // 当前候选点本身已被候选生成器标记为乐句头，这是一条独立证据；
      // 乐句周期置信度低时应降权，而不是把已识别出的乐句头权重直接归零。
      if (A.isPhrase || B.isPhrase) phraseConfidence = Math.max(phraseConfidence, 0.35);
      weights.phrase = 0.12 * phraseConfidence;
      evidence.phrase = phraseConfidence;
    }

    var rmsA = interval.a.rmsDb, rmsB = interval.b.rmsDb;
    var energyGapDb = null;
    if (rmsA.known && rmsB.known) {
      energyGapDb = Math.abs(rmsA.mean - rmsB.mean);
      var levelFit = clamp(1 - energyGapDb / 12, 0, 1);
      var trendFit = clamp(0.5 + (-rmsA.slope + rmsB.slope) / 8, 0, 1);
      // 趋势不能抵消巨大的平均电平差：旧公式在 60dB 差时仍能拿 0.35，
      // 会让"节拍完美但一响一静"的方案胜出。电平占绝对主导。
      terms.energy = levelFit * 0.8 + trendFit * 0.2;
      weights.energy = 0.17;
      evidence.energy = 0.9;
    }

    var lowA = interval.a.lowRatio, lowB = interval.b.lowRatio;
    var lowConflict = null;
    if (lowA.known && lowB.known && interval.joint.low !== null) {
      lowConflict = clamp(Math.sqrt(Math.max(0, interval.joint.low)), 0, 1);
      terms.low = 1 - lowConflict;
      weights.low = 0.11;
      evidence.low = 0.85;
    }

    var transientA = interval.a.transient, transientB = interval.b.transient;
    if (transientA.known && transientB.known && interval.joint.transient !== null) {
      var transientDensity = clamp(Math.sqrt(Math.max(0, interval.joint.transient)), 0, 1);
      terms.transient = 1 - transientDensity;
      weights.transient = 0.08;
      evidence.transient = 0.8;
    }

    if (kf.known) {
      terms.key = kf.value;
      weights.key = 0.06;
      evidence.key = meanConfidence(a.key && a.key.confidence, b.key && b.key.confidence, 0.7);
    }

    var vocalA = interval.a.vocal, vocalB = interval.b.vocal;
    var vocalConflict = null;
    var vocalConfidence = meanConfidence(a.flags && a.flags.vocalConfidence,
      b.flags && b.flags.vocalConfidence, 0.3);
    if (vocalA.known && vocalB.known && interval.joint.vocal !== null && vocalConfidence > 0) {
      vocalConflict = clamp(interval.joint.vocal, 0, 1);
      terms.vocal = 1 - vocalConflict;
      weights.vocal = 0.12 * vocalConfidence;
      evidence.vocal = vocalConfidence;
    }

    var segmentA = segmentAt(a, A.tMs), segmentB = segmentAt(b, B.tMs);
    var structureFit = null;
    if (segmentA || segmentB || A.type || B.type) {
      var exitFit = 0.6, entryFit = 0.85;
      if (segmentA) {
        if (segmentA.type === 'outro' || segmentA.type === 'breakdown') exitFit = 1;
        else if (segmentA.type === 'chorus') exitFit = 0.35;
        else if (segmentA.type === 'verse') exitFit = 0.7;
        else if (segmentA.type === 'intro') exitFit = 0.5;
      }
      if (A.type === 'drop' || A.type === 'silence' || A.type === 'energy') exitFit = Math.max(exitFit, 0.8);
      if (segmentB) {
        if (segmentB.type === 'verse') entryFit = 0.9;
        else if (segmentB.type === 'intro') entryFit = 0.65;
        else if (segmentB.type === 'chorus') entryFit = 0.4;
        else if (segmentB.type === 'breakdown') entryFit = 0.8;
        else if (segmentB.type === 'outro') entryFit = 0.3;
      }
      structureFit = exitFit * (0.55 + 0.45 * entryFit) * clamp(1 - B.tMs / 60000, 0.55, 1);
      terms.structure = structureFit;
      weights.structure = 0.10;
      evidence.structure = Math.max(num(segmentA && segmentA.confidence, 0),
        num(segmentB && segmentB.confidence, 0), 0.55);
    }

    if (typeof A.score === 'number' || typeof B.score === 'number') {
      terms.mixPoint = (num(A.score, 0.5) + num(B.score, 0.5)) / 2;
      weights.mixPoint = 0.06;
      evidence.mixPoint = 0.6;
    }

    var weighted = 0, weightSum = 0, confidence = 0;
    Object.keys(weights).forEach(function (key) {
      if (!(weights[key] > 0) || terms[key] === null) return;
      weighted += weights[key] * terms[key];
      confidence += weights[key] * num(evidence[key], 0.5);
      weightSum += weights[key];
    });
    var baseScore = weightSum > 0 ? weighted / weightSum : 0;
    var strategyBonus = 0, why = [];
    if (energyGapDb !== null && energyGapDb > 12) {
      // 12dB 以上已不是"前奏略安静"，而是明显响度断层。限制惩罚上限，
      // 低于阈值的结构/尾奏方案仍可因为乐句和结构优势胜出。
      strategyBonus -= Math.min(0.12, (energyGapDb - 12) / 40 * 0.12);
      why.push('interval_loudness_gap_penalty');
    }
    var rhythmEvidence = hasGrid(a) && hasGrid(b) &&
      Math.min(num(a.beats.confidence, 0), num(b.beats.confidence, 0)) >= 0.35;
    if (candidate.strategy === 'eq-swap' && lowConflict !== null) {
      strategyBonus += 0.18 * lowConflict;
      if (lowConflict >= 0.35) why.push('prioritize_bass_swap_for_low_frequency_conflict');
    }
    if (candidate.strategy === 'vocal-avoid' && vocalConflict !== null) {
      strategyBonus += 0.16 * vocalConflict * clamp(candidate.durationMs / 8000, 0.5, 1);
      // 只改变 EQ 的 A/B 时序，deck 音量仍是等功率曲线；不要宣称已实现
      // 人声级别上的非对称音量闪避。
      why.push('asymmetric_eq_timing_for_relative_vocal_density');
    }
    if (candidate.strategy === 'safe-fade') {
      // 只有节奏证据不足或区间能量不可接受时，"安全"才是收益；
      // 对两轨都有可靠网格的普通歌曲，默认没有理由用一个短退化方案替代长重叠。
      var safeNeed = !rhythmEvidence || !rmsA.known || !rmsB.known;
      strategyBonus += (safeNeed ? 0.08 : 0) + 0.02 * num(terms.energy, 0.5);
      why.push(!rhythmEvidence ? 'energy_guided_without_complete_beat_grid'
        : 'energy_safe_alternative_when_long_overlap_is_unreliable');
    }
    if (candidate.strategy === 'structure-blend') {
      strategyBonus += 0.025 * num(terms.structure, 0.5);
      why.push('structure_and_interval_energy_without_rate_change');
    }
    if (candidate.strategy === 'beatmatch') {
      // 拍点对齐是唯一能保证整段重叠节奏连续的策略。仅在速度/相位证据
      // 都成立时给先验，而不是无条件偏爱节拍匹配。
      if (rhythmEvidence) strategyBonus += 0.05 + 0.06 * num(terms.tempo, 0) * num(terms.phase, 0);
      else strategyBonus += 0.02 * num(terms.tempo, 0) * num(terms.phase, 0);
      why.push('aligned_tempo_and_downbeat_grid');
    }
    if (candidate.strategy === 'tempo-ramp') {
      if (rhythmEvidence) strategyBonus += 0.045 + 0.05 * num(terms.tempo, 0) * num(terms.phase, 0);
      why.push('small_tempo_ramp_within_native_three_percent_limit');
    }
    if (candidate.strategy === 'phrase-cut') {
      if (terms.phrase !== null && weights.phrase > 0) {
        strategyBonus += 0.04 * num(terms.phrase, 0);
        why.push('phrase_boundary_short_fade');
      } else {
        why.push('short_fade_at_available_boundary');
      }
    }
    if (candidate.strategy === 'short-fade') {
      if (vocalConflict !== null && vocalConflict >= 0.3) strategyBonus += 0.03 * vocalConflict;
      why.push('short_fade_limits_overlap_conflicts');
    }
    if (!why.length) why.push('best_available_soft_score');

    candidate.terms = {};
    candidate.weights = {};
    Object.keys(terms).forEach(function (key) {
      candidate.terms[key] = terms[key] === null ? null : r3(terms[key]);
      candidate.weights[key] = r3(weights[key]);
    });
    candidate.baseScore = r3(baseScore);
    candidate.strategyBonus = r3(strategyBonus);
    candidate._total = clamp(baseScore + strategyBonus, 0, 1);
    candidate.total = r3(candidate._total);
    candidate.confidence = r3(weightSum > 0 ? confidence / weightSum : 0);
    candidate.why = why;
    candidate.lowConflict = lowConflict === null ? null : r3(lowConflict);
    candidate.vocalConflict = vocalConflict === null ? null : r3(vocalConflict);
    candidate.energyA = rmsA.known ? r2(rmsA.mean) : null;
    candidate.energyB = rmsB.known ? r2(rmsB.mean) : null;
    candidate.energyGapDb = energyGapDb === null ? null : r2(energyGapDb);
    candidate.keyKnown = kf.known;
    candidate.entrySegment = segmentB ? segmentB.type : null;
    candidate.requestedRatio = r3(pairing.ratio);
    candidate.ratio = r3(candidate.ratio);
    candidate.semitones = r2(12 * log2(candidate.ratio));
    candidate.phaseErrMs = Math.round(candidate.phaseErrMs * 10) / 10;
  }

  function compareCandidates(a, b) {
    return b._total - a._total || a.strategy.localeCompare(b.strategy) ||
      a.exitMs - b.exitMs || a.entryMs - b.entryMs || a.durationMs - b.durationMs || a.ratio - b.ratio;
  }

  function publicStats(stats) {
    if (!stats.known) return { known: false, mean: null, start: null, end: null, slope: null };
    return { known: true, mean: r3(stats.mean), start: r3(stats.start), end: r3(stats.end), slope: r3(stats.slope) };
  }

  function publicInterval(interval) {
    var out = { a: {}, b: {}, joint: {} };
    ['a', 'b'].forEach(function (side) {
      ['rmsDb', 'lowRatio', 'transient', 'vocal'].forEach(function (key) {
        out[side][key] = publicStats(interval[side][key]);
      });
    });
    ['low', 'transient', 'vocal'].forEach(function (key) {
      out.joint[key] = interval.joint[key] === null ? null : r3(interval.joint[key]);
    });
    return out;
  }

  function candidateSummary(candidate, abandonment) {
    return {
      strategy: candidate.strategy, total: candidate.total, baseScore: candidate.baseScore,
      strategyBonus: candidate.strategyBonus, confidence: candidate.confidence,
      exitMs: candidate.exitMs, entryMs: candidate.entryMs, durationMs: candidate.durationMs,
      bars: candidate.bars, ratio: candidate.ratio, terms: candidate.terms, weights: candidate.weights,
      lowConflict: candidate.lowConflict, vocalConflict: candidate.vocalConflict,
      energyGapDb: candidate.energyGapDb,
      why: abandonment ? candidate.why.concat([abandonment]) : candidate.why.slice(),
    };
  }

  function buildEq(chosen) {
    var enabled = chosen.strategy === 'beatmatch' || chosen.strategy === 'tempo-ramp' ||
      chosen.strategy === 'eq-swap' || chosen.strategy === 'vocal-avoid';
    // structure-blend、safe/short/phrase 淡化一律 eq:null，避免触发旧播放链的 wash。
    if (!enabled || chosen.durationMs < 1200) return null;
    var eq = {
      enabled: true,
      aHighpassHz: chosen.strategy === 'vocal-avoid' ? 180 : 220,
      bLowpassHz: chosen.strategy === 'vocal-avoid' ? 5000 : 4200,
      swapAt: 0.5,
      bassSwap: chosen.strategy === 'beatmatch' || chosen.strategy === 'tempo-ramp' || chosen.strategy === 'eq-swap',
      curve: 'equal-power',
    };
    if (chosen.strategy === 'vocal-avoid') {
      var aVocal = chosen.interval.a.vocal.mean, bVocal = chosen.interval.b.vocal.mean;
      var swapAt = aVocal > bVocal ? 0.35 : 0.65;
      eq.swapAt = swapAt;
      eq.curve = 'asymmetric-vocal-avoid';
      eq.aCurve = { startAt: 0, endAt: swapAt, startMs: 0,
        endMs: Math.round(chosen.durationMs * swapAt), curve: 'equal-power-out' };
      eq.bCurve = { startAt: swapAt, endAt: 1, startMs: Math.round(chosen.durationMs * swapAt),
        endMs: chosen.durationMs, curve: 'equal-power-in' };
    }
    return eq;
  }

  function makeOutput(a, b, opts, chosen, accepted, rejected, fallback) {
    var sorted = accepted.slice().sort(compareCandidates);
    var topCandidates = sorted.slice(0, 5).map(function (candidate) { return candidateSummary(candidate); });
    var alternatives = sorted.filter(function (candidate) { return candidate !== chosen; }).slice(0, 6).map(function (candidate) {
      return candidateSummary(candidate, 'not_selected_lower_total');
    });
    var selected = candidateSummary(chosen);
    selected.interval = publicInterval(chosen.interval);
    return {
      v: VERSION,
      engine: 'carminium-automix',
      a: a.trackId, b: b.trackId, aTitle: a.title, bTitle: b.title,
      strategy: chosen.strategy,
      // 没有可执行重叠时，AutoMix 可在本地双 buffer 条件下退化为自然结束点的
      // 真无缝切换；这是运行期能力，不改变本次候选的音乐决策。
      gaplessFallback: !opts.nextStreaming &&
        (chosen.strategy === 'hard-cut' || chosen.strategy === 'fixed-crossfade'),
      exitMs: chosen.exitMs, entryMs: chosen.entryMs, durationMs: chosen.durationMs,
      bars: chosen.bars, ratio: chosen.ratio, semitones: chosen.semitones,
      phaseErrMs: chosen.phaseErrMs,
      transitionStartMs: chosen.exitMs,
      crossfadeDurationMs: chosen.durationMs,
      nextStartOffsetMs: chosen.entryMs,
      preloadTriggerMs: Math.max(0, chosen.exitMs - 12000),
      bpmCurrent: num(a.tempo && a.tempo.primary, 0),
      bpmNext: num(b.tempo && b.tempo.primary, 0),
      bpmTempoAdjust: chosen.ratio,
      tempoRampMs: chosen.strategy === 'tempo-ramp' ? Math.round((medianBeatMs(a) || 500) * 8) : 0,
      score: chosen.total, terms: chosen.terms, confidence: chosen.confidence,
      eq: buildEq(chosen),
      reason: {
        selected: selected, confidence: chosen.confidence,
        gaplessFallback: !opts.nextStreaming &&
          (chosen.strategy === 'hard-cut' || chosen.strategy === 'fixed-crossfade'),
        topCandidates: topCandidates, rejectedCandidates: rejected.slice(0, 16), alternatives: alternatives,
        rejectedCount: rejected.length, candidates: accepted.length + rejected.length,
        top3: topCandidates.slice(0, 3),
        exitType: chosen.exitType, entryType: chosen.entryType,
        isPhraseExit: chosen.isPhraseExit, isDownbeatEntry: chosen.isDownbeatEntry,
        keyUsed: chosen.keyKnown, energyA: chosen.energyA, energyB: chosen.energyB,
        fallback: fallback && fallback.length ? fallback : null,
      },
      conservative: !!chosen.conservative,
    };
  }

  function hardCut(a, b, opts, built, why) {
    var durationA = profileDuration(a);
    var exitMs = Math.round(Math.max(0, durationA - 400));
    var A = { tMs: exitMs, type: 'tail', score: 0, beatIndex: -1, isDownbeat: false, isPhrase: false };
    var B = { tMs: 0, type: 'head', score: 0, beatIndex: -1, isDownbeat: false, isPhrase: false };
    var chosen = baseCandidate('hard-cut', A, B, a, b, 400, 0, 1);
    chosen.terms = { tempo: null, phase: null, phrase: null, energy: null, low: null,
      transient: null, key: null, vocal: null, structure: null, mixPoint: null };
    chosen.weights = { tempo: 0, phase: 0, phrase: 0, energy: 0, low: 0,
      transient: 0, key: 0, vocal: 0, structure: 0, mixPoint: 0 };
    chosen.baseScore = 0; chosen.strategyBonus = 0; chosen._total = 0.1; chosen.total = 0.1;
    chosen.confidence = 0; chosen.why = [why]; chosen.lowConflict = null; chosen.vocalConflict = null;
    chosen.energyA = chosen.interval.a.rmsDb.known ? r2(chosen.interval.a.rmsDb.mean) : null;
    chosen.energyB = chosen.interval.b.rmsDb.known ? r2(chosen.interval.b.rmsDb.mean) : null;
    chosen.keyKnown = false; chosen.conservative = true;
    return makeOutput(a, b, opts, chosen, [chosen], built.rejected, [{ why: why }]);
  }

  /* ---------------- 专辑连续曲 ----------------
   * 同专辑按原顺序播放时，只要 A 的尾部、B 的头部都没有留白，
   * 就说明这两段是作者设计好的连续过渡。此时任何重叠、EQ、变速
   * 都在改写作品本身，必须让位。档案缺 edges（旧缓存/分析失败）时
   * 仍按保守处理：宁可不淡化，也不毁掉原过渡。
   *
   * edges.*Known（v5）显式标记证据有效性：分析被 20 分钟上限截断时
   * 尾部量到的是截断点而非文件结尾，tailSilenceMs 为 null、tailKnown=false，
   * 同样按未知走保守路径——不能把"截断点恰好没留白"当成连续证据。
   */
  function isAlbumSequence(cur, next) {
    if (!cur || !next) return false;
    var albumA = String(cur.album || '').trim();
    var albumB = String(next.album || '').trim();
    if (!albumA || albumA !== albumB) return false;
    var artistA = String(cur.albumArtist || '').trim().toLowerCase();
    var artistB = String(next.albumArtist || '').trim().toLowerCase();
    if (artistA && artistB && artistA !== artistB) return false;
    var trackA = Number(cur.trackNumber) || 0;
    var trackB = Number(next.trackNumber) || 0;
    if (trackA <= 0 || trackB <= 0) return false;
    var discA = Number(cur.discNumber) || 0;
    var discB = Number(next.discNumber) || 0;
    if (discA === discB) return trackB === trackA + 1;
    // 跨碟：下一首必须正好是新碟第 1 轨。
    return discB === discA + 1 && trackB === 1;
  }

  function albumContinuity(a, b, opts) {
    var ea = a && a.edges;
    var eb = b && b.edges;
    var tailOk = !!ea && isFinite(ea.tailSilenceMs) && ea.tailKnown !== false;
    var headOk = !!eb && isFinite(eb.headSilenceMs) && eb.headKnown !== false;
    if (!tailOk || !headOk) {
      var why = 'album_sequence_edges_unknown';
      if (ea && ea.tailKnown === false) why = 'album_sequence_tail_truncated';
      return { continuous: true, known: false, why: why };
    }
    var tail = num(ea.tailSilenceMs, 0);
    var head = num(eb.headSilenceMs, 0);
    var continuous = tail <= opts.continuousEdgeMs && head <= opts.continuousEdgeMs;
    return {
      continuous: continuous,
      known: true,
      tailSilenceMs: tail,
      headSilenceMs: head,
      why: continuous ? 'same_album_no_boundary_silence' : 'same_album_but_boundary_silence',
    };
  }

  function albumSequencePlan(a, b, opts, info) {
    var confidence = info.known ? 1 : 0.6;
    return {
      v: VERSION, engine: 'carminium-automix', strategy: 'album-sequence',
      // seamless 与 gaplessFallback 语义不同：
      // 前者是「刻意不要重叠」，后者是「找不到可执行重叠」。
      seamless: true, gaplessFallback: false, preserveOriginal: true,
      a: a && a.trackId, b: b && b.trackId,
      aTitle: a && a.title, bTitle: b && b.title,
      exitMs: -1, entryMs: 0, durationMs: 0, bars: 0, ratio: 1, semitones: 0,
      phaseErrMs: 0, transitionStartMs: -1, crossfadeDurationMs: 0,
      nextStartOffsetMs: 0, preloadTriggerMs: -1,
      bpmCurrent: num(a && a.tempo && a.tempo.primary, 0),
      bpmNext: num(b && b.tempo && b.tempo.primary, 0),
      bpmTempoAdjust: 1, tempoRampMs: 0,
      score: 1, terms: {}, confidence: confidence, eq: null,
      reason: {
        selected: { strategy: 'album-sequence', total: 1, confidence: confidence, why: [info.why] },
        confidence: confidence,
        albumSequence: info,
        gaplessFallback: false,
        topCandidates: [], rejectedCandidates: [], alternatives: [],
        rejectedCount: 0, candidates: 0, top3: [], fallback: null,
      },
      conservative: false,
    };
  }

  function plan(a, b, options) {
    var opts = Object.assign({}, DEFAULTS, options || {});
    // 正式播放能力没有 WSOLA；即使调用方传 true，也仍使用原生 ±3% 速率上限。
    opts.wsola = false;
    opts.maxStretch = Math.min(0.03, Math.max(0, num(opts.maxStretch, 0.03)));
    if (opts.albumSequence) {
      var continuity = albumContinuity(a, b, opts);
      if (continuity.continuous) return albumSequencePlan(a, b, opts, continuity);
    }
    if (!a || !b) return fallbackPlan(opts, a ? 'missing_next_profile' : 'missing_current_profile');

    var built = buildCandidates(a, b, opts);
    if (!built.accepted.length) {
      return hardCut(a, b, opts, built, built.energyEvidence ? 'no_valid_candidate_within_hard_constraints' : 'insufficient_usable_transition_data');
    }
    var chosen = built.accepted[0];
    var fallback = null;
    if (chosen.total < opts.minTotalScore || chosen.confidence < opts.minConfidence) {
      var why = chosen.total < opts.minTotalScore ? 'low_total_score' : 'low_decision_confidence';
      var safe = null;
      for (var i = 1; i < built.accepted.length; i++) {
        var c = built.accepted[i];
        if ((c.strategy === 'safe-fade' || c.strategy === 'phrase-cut' || c.strategy === 'structure-blend') &&
            c.total >= chosen.total * 0.85) {
          safe = c;
          break;
        }
      }
      fallback = [{ from: chosen.strategy, why: why, total: chosen.total, confidence: chosen.confidence }];
      if (safe) {
        chosen = safe;
        fallback.push({ to: safe.strategy, total: safe.total, confidence: safe.confidence });
      }
    }
    return makeOutput(a, b, opts, chosen, built.accepted, built.rejected, fallback);
  }

  function fallbackPlan(opts, why) {
    var duration = opts.fallbackDurationMs || 5000;
    return {
      v: VERSION, engine: 'carminium-automix', strategy: 'fixed-crossfade',
      gaplessFallback: !opts.nextStreaming,
      exitMs: -1, entryMs: 0, durationMs: duration, bars: 0, ratio: 1,
      semitones: 0, phaseErrMs: 0, transitionStartMs: -1,
      crossfadeDurationMs: duration, nextStartOffsetMs: 0, preloadTriggerMs: -1,
      bpmCurrent: 0, bpmNext: 0, bpmTempoAdjust: 1, tempoRampMs: 0,
      score: 0, terms: {}, confidence: 0, eq: null,
      reason: {
        selected: { strategy: 'fixed-crossfade', total: 0, why: [why] }, confidence: 0,
        gaplessFallback: !opts.nextStreaming,
        topCandidates: [], rejectedCandidates: [], alternatives: [], rejectedCount: 0,
        candidates: 0, top3: [], fallback: [{ why: why }],
      },
      conservative: true,
    };
  }

  function describe(planObj) {
    if (!planObj) return '';
    var terms = planObj.terms || {}, parts = [];
    parts.push(planObj.strategy + ' @ ' + (planObj.exitMs / 1000).toFixed(1) + 's → ' +
      (planObj.entryMs / 1000).toFixed(1) + 's, ' + (planObj.durationMs / 1000).toFixed(1) + 's');
    if (planObj.bars) parts.push(planObj.bars + ' 小节');
    if (planObj.gaplessFallback) parts.push('条件无缝兜底');
    if (planObj.strategy === 'album-sequence') parts.push('专辑连续曲 · 不做重叠');
    if (Math.abs((planObj.ratio || 1) - 1) > 1e-4) parts.push('速率 ×' + planObj.ratio.toFixed(3));
    var keys = ['tempo', 'phase', 'phrase', 'energy', 'low', 'transient', 'key', 'vocal', 'structure'];
    var values = [];
    for (var i = 0; i < keys.length; i++) {
      if (terms[keys[i]] !== null && terms[keys[i]] !== undefined) values.push(keys[i] + '=' + terms[keys[i]]);
    }
    if (values.length) parts.push('[' + values.join(' ') + ']');
    if (planObj.reason && planObj.reason.selected) parts.push(planObj.reason.selected.why.join(','));
    return parts.join(' · ');
  }

  return {
    VERSION: VERSION,
    DEFAULTS: DEFAULTS,
    plan: plan,
    describe: describe,
    isAlbumSequence: isAlbumSequence,
    _internals: {
      buildCandidates: buildCandidates, tempoPair: tempoPair, keyFit: keyFit,
      medianBeatMs: medianBeatMs, seriesStats: seriesStats, intervalStats: intervalStats,
    },
  };
});
