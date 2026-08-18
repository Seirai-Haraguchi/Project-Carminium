/**
 * TransitionPlanner — 智能过渡规划器（生产级）
 *
 * 综合当前曲和下一曲的频谱分析 / osu! 数据，计算最优过渡方案。
 *
 * 规划流程：
 *   1. 数据合并：合并频谱分析结果和 osu! 数据（osu! 优先）
 *   2. 候选生成：基于尾奏、高潮后、能量变化点生成多个候选过渡点
 *   3. 候选评分：对每个候选点计算综合评分
 *      - 能量兼容性（当前曲过渡点能量 vs 下一曲起始点能量）
 *      - BPM 兼容性（比率接近度、倍频关系）
 *      - 结构合理性（不在高潮中过渡、在尾奏内过渡）
 *      - 节拍对齐度（过渡点是否在节拍边界）
 *   4. 方案生成：选择最佳候选，计算 crossfade 时长和下一曲起始偏移
 *
 * 输出方案：
 *   - transitionStartMs: 当前曲开始过渡的位置
 *   - crossfadeDurationMs: 交叉淡化持续时间
 *   - nextStartOffsetMs: 下一曲从什么位置开始播放（仅 Buffer 模式）
 *   - bpmMatchRatio: BPM 匹配比率（用于播放速率调整）
 *   - preloadTriggerMs: 预加载触发时间
 *   - confidence: 规划置信度（0-1）
 *   - source: 数据来源（hybrid / osu / spectrum / partial / fallback）
 *
 * 兼容性：规划方案与播放模式无关（Buffer/Streaming、Shared/Exclusive 通用）
 *
 * 防御性设计：
 *   - 所有输入参数有 null/undefined 检查
 *   - 数值边界检查，防止 NaN / Infinity
 *   - 分析数据不完整时优雅降级
 *   - 无任何分析数据时回退到固定时长交叉淡化
 */
(function () {
  'use strict';

  // ── 过渡参数约束 ──────────────────────────────────────────────────────────

  var MIN_CROSSFADE_MS = 3000;
  var MAX_CROSSFADE_MS = 15000;
  var DEFAULT_CROSSFADE_MS = 5000;
  var BPM_MATCH_THRESHOLD = 0.08;      // 8% 以内视为 BPM 匹配
  var BPM_TEMPO_ADJUST_THRESHOLD = 0.20; // 20% 以内可做微调（双侧汇合时各承担一半，单侧 ≤12%）
  var PRELOAD_LEAD_MS = 6000;          // 预加载提前量
  var POST_CLIMAX_DELAY_MS = 3000;     // 高潮后延迟过渡的时间
  var MIN_OUTRO_FOR_TRANSITION_MS = 4000; // 尾奏至少 4 秒才能在其中过渡

  // ── TransitionPlanner ──────────────────────────────────────────────────────

  function TransitionPlanner() {}

  /**
   * 计算过渡方案。
   * @param {object|null} current - 当前曲分析结果
   * @param {object|null} next - 下一曲分析结果
   * @param {object} settings - { crossfadeDurationMs }
   * @returns {object} 过渡方案
   */
  TransitionPlanner.prototype.plan = function (current, next, settings) {
    var radical = !!(settings && settings.radicalTransitions);
    var fallbackDuration = this._safeGetNumber(settings, 'crossfadeDurationMs', DEFAULT_CROSSFADE_MS);
    if (radical) fallbackDuration = Math.max(fallbackDuration, 10000);

    // 无任何分析数据：固定时长回退
    if (!current && !next) {
      return this._fallbackPlan(fallbackDuration);
    }

    // 只有一曲的分析数据
    if (!current || !next) {
      return this._partialPlan(current || next, !!current, fallbackDuration);
    }

    // 完整分析数据
    return this._fullPlan(current, next, fallbackDuration, radical);
  };

  // ── 完整规划 ──────────────────────────────────────────────────────────────

  TransitionPlanner.prototype._fullPlan = function (current, next, fallbackDuration, radical) {
    // ── 1. 合并 osu! 数据（osu! 优先）──
    var cur = this._mergeAnalysis(current);
    var nxt = this._mergeAnalysis(next);

    var curDuration = this._safeGetNumber(cur, 'durationMs', 0);
    var nextDuration = this._safeGetNumber(nxt, 'durationMs', 0);
    if (curDuration <= 0 || nextDuration <= 0) {
      return this._fallbackPlan(fallbackDuration);
    }

    // ── 2. 确定关键结构点 ──
    var curClimax = this._getClimax(cur);
    var nextClimax = this._getClimax(nxt);
    var outroStart = this._getOutroStart(cur, curDuration);
    var nextIntroEnd = this._getIntroEnd(nxt, nextDuration);

    // 高潮避让：过渡不应在高潮之前
    if (curClimax > 0 && outroStart < curClimax + POST_CLIMAX_DELAY_MS) {
      outroStart = curClimax + POST_CLIMAX_DELAY_MS;
    }
    // 确保 outroStart 在合理范围
    outroStart = this._clamp(outroStart, curDuration * 0.6, curDuration - MIN_CROSSFADE_MS);

    // ── 3. 生成候选过渡点 ──
    var candidates = this._generateCandidates(cur, outroStart, curDuration, curClimax);

    // ── 4. 评分每个候选 ──
    var bpmMatch = this._computeBpmMatch(cur.bpm, nxt.bpm);
    var scoredCandidates = [];

    for (var i = 0; i < candidates.length; i++) {
      var candidate = candidates[i];
      var score = this._scoreCandidate(candidate, cur, nxt, bpmMatch, nextIntroEnd, nextDuration);
      scoredCandidates.push({ candidate: candidate, score: score });
    }

    // ── 5. 选择最佳候选 ──
    scoredCandidates.sort(function (a, b) { return b.score.total - a.score.total; });
    var best = scoredCandidates[0];

    var transitionStart = best.candidate.positionMs;

    // Snap the transition point before deriving dependent timings.  This
    // keeps the crossfade length and next-track offset consistent with the
    // actual beat-aligned start point.
    if (cur.beatGridMs && cur.beatGridMs.length > 0) {
      transitionStart = this._alignToBeat(transitionStart, cur.beatGridMs, cur.beatIntervalMs);
    }

    var crossfadeDuration = this._computeCrossfadeDuration(
      transitionStart, curDuration, nextIntroEnd, nextDuration,
      cur.bpm, nxt.bpm, bpmMatch, fallbackDuration, radical
    );

    // ── 6. 计算下一曲起始偏移 ──
    var nextStartOffset = this._computeNextStartOffset(
      nextIntroEnd, crossfadeDuration, nextDuration, nxt, bpmMatch
    );

    // ── 7. 下一曲节拍对齐（如果可行）──
    if (nextStartOffset > 0 && nxt.beatGridMs && nxt.beatGridMs.length > 0) {
      nextStartOffset = this._alignToBeat(nextStartOffset, nxt.beatGridMs, nxt.beatIntervalMs);
    }

    // ── 8. 最终约束检查 ──
    // 确保过渡不会超出当前曲范围
    if (transitionStart > curDuration - crossfadeDuration) {
      transitionStart = Math.max(0, curDuration - crossfadeDuration);
    }
    // 确保下一曲起始偏移合理
    if (nextStartOffset > nextDuration - 1000) {
      nextStartOffset = 0;
    }

    return {
      transitionStartMs: Math.round(transitionStart),
      crossfadeDurationMs: Math.round(crossfadeDuration),
      nextStartOffsetMs: Math.round(nextStartOffset),
      preloadTriggerMs: Math.max(0, Math.round(transitionStart - PRELOAD_LEAD_MS)),
      bpmCurrent: cur.bpm || 0,
      bpmNext: nxt.bpm || 0,
      bpmMatchRatio: bpmMatch.ratio,
      bpmMatched: bpmMatch.matched,
      bpmTempoAdjust: bpmMatch.tempoAdjust,
      tempoRampMs: bpmMatch.tempoRampMs,
      curOutroStartMs: Math.round(outroStart),
      curClimaxMs: Math.round(curClimax),
      nextIntroEndMs: Math.round(nextIntroEnd),
      nextClimaxMs: Math.round(nextClimax),
      candidateScore: Math.round(best.score.total * 100) / 100,
      candidateReason: best.score.reason,
      source: this._determineSource(cur, nxt),
      confidence: this._computeConfidence(cur, nxt, best.score),
      radical: !!radical,
      expansionEffect: this._buildExpansionEffect(cur, nxt, transitionStart, crossfadeDuration, bpmMatch, radical, best.candidate.type),
    };
  };

  /**
   * Generate a musical, transition-local expansion effect.  This is deliberately
   * conservative: no beat grid / no structural cue means no effect.
   */
  TransitionPlanner.prototype._buildExpansionEffect = function (cur, nxt, transitionStart, crossfadeDuration, bpmMatch, radical, candidateType) {
    var beatMs = this._safeGetNumber(cur, 'beatIntervalMs', 0);
    if (beatMs <= 0 && cur.bpm > 0) beatMs = 60000 / cur.bpm;
    if (beatMs <= 0 || !cur.beatGridMs || cur.beatGridMs.length < 4) return null;

    var duration = this._safeGetNumber(cur, 'durationMs', 0);
    var phraseMs = beatMs * 4;
    var tailStart = this._getOutroStart(cur, duration);
    var climax = this._getClimax(cur);
    var tailEnergy = this._getEnergyAt(cur.energy, Math.max(tailStart, transitionStart - phraseMs));
    var transitionEnergy = this._getEnergyAt(cur.energy, transitionStart);
    var energyDrop = tailEnergy > 0 ? Math.max(0, (tailEnergy - transitionEnergy) / tailEnergy) : 0;
    var nearClimax = climax > 0 && transitionStart >= climax - phraseMs * 2 && transitionStart <= climax + phraseMs * 2;
    var structuralCue = candidateType === 'energy_drop' || candidateType === 'post_climax' ||
      (candidateType === 'outro_start' && energyDrop >= 0.18);

    // Avoid making every transition sound alike.  Energy movement or a clear
    // phrase/section cue is required, and very weak material is skipped.
    // Radical DJ mode relaxes the gating so the pull-up gesture shows up far
    // more often and hits harder.
    if (radical) {
      if (!structuralCue && !nearClimax && energyDrop < 0.10) return null;
      if (transitionStart < tailStart - phraseMs * 2 && !nearClimax && energyDrop < 0.16) return null;
    } else {
      if (!structuralCue && !nearClimax && energyDrop < 0.16) return null;
      if (transitionStart < tailStart - phraseMs * 2 && !nearClimax && energyDrop < 0.24) return null;
    }

    var density = 0;
    if (cur.energy && cur.energy.length > 3) {
      var from = Math.max(0, Math.floor((transitionStart - phraseMs) / 1000));
      var to = Math.min(cur.energy.length - 1, Math.floor(transitionStart / 1000));
      var sum = 0, count = 0;
      for (var i = from; i <= to; i++) { sum += cur.energy[i] || 0; count++; }
      density = count ? sum / count : 0;
    }
    var intensity = 0.16 + Math.min(0.18, energyDrop * 0.45) + (nearClimax ? 0.08 : 0);
    if (bpmMatch && bpmMatch.matched) intensity += 0.04;
    if (radical) intensity += 0.05;
    if (radical) intensity = Math.max(intensity, 0.30);
    intensity = this._clamp(intensity, 0.14, radical ? 0.5 : 0.42);

    // High-density material uses half-beat fragments; otherwise use one beat.
    // Spacing and all phase boundaries remain musical divisions.
    var fragmentBeats = density > 0.55 ? 0.5 : 1;
    var spacingBeats = density > 0.7 ? 0.5 : 1;
    var count = intensity > 0.32 ? 6 : 4;
    if (radical && intensity > 0.3) count = 8;
    if (radical && intensity > 0.38) count = 10;
    var spacingMs = Math.round(beatMs * spacingBeats);
    var fragmentMs = Math.round(beatMs * fragmentBeats);
    var totalMs = Math.min(crossfadeDuration, spacingMs * count + beatMs);
    var fragmentOffsetMs = Math.max(0, Math.round(transitionStart - fragmentMs));

    // 抽拉：每次重复的 playbackRate 逐次上行（越拉越快、音调越高）。
    // 倒带甩盘：手势收尾时用反向片段 + 快速升速模拟拽盘回卷的"咻"。
    var rateRise = 0.2 + intensity * 0.8;
    if (radical) rateRise = Math.max(0.45, rateRise);

    return {
      enabled: true,
      startMs: Math.round(transitionStart),
      durationMs: Math.round(totalMs),
      fragmentOffsetMs: fragmentOffsetMs,
      fragmentDurationMs: fragmentMs,
      repeatCount: count,
      spacingMs: spacingMs,
      intensity: Math.round(intensity * 1000) / 1000,
      rateRise: Math.round(rateRise * 1000) / 1000,
      spinback: radical || intensity >= 0.32,
      airGainDb: Math.round((1.5 + intensity * 8) * 10) / 10,
      reverbWet: Math.round((0.08 + intensity * 0.34) * 1000) / 1000,
      delayWet: Math.round((0.04 + intensity * 0.18) * 1000) / 1000,
      width: Math.round((0.08 + intensity * 0.42) * 1000) / 1000,
      reason: candidateType || (nearClimax ? 'near_climax' : 'energy_change'),
    };
  };

  // ── 部分规划（只有一曲的分析数据）──

  TransitionPlanner.prototype._partialPlan = function (analysis, isCurrent, fallbackDuration) {
    if (!analysis) return this._fallbackPlan(fallbackDuration);

    var merged = this._mergeAnalysis(analysis);
    var duration = this._safeGetNumber(merged, 'durationMs', 0);
    if (duration <= 0) return this._fallbackPlan(fallbackDuration);

    var climax = this._getClimax(merged);
    var outroStart = this._getOutroStart(merged, duration);

    // 高潮避让
    if (climax > 0 && outroStart < climax + POST_CLIMAX_DELAY_MS) {
      outroStart = climax + POST_CLIMAX_DELAY_MS;
    }
    outroStart = this._clamp(outroStart, duration * 0.6, duration - MIN_CROSSFADE_MS);

    var crossfadeDuration = fallbackDuration;
    if (merged.bpm > 0) {
      crossfadeDuration = Math.min(MAX_CROSSFADE_MS, fallbackDuration + 2000);
    }

    var transitionStart = isCurrent ? outroStart : Math.max(0, duration - crossfadeDuration);

    return {
      transitionStartMs: Math.round(transitionStart),
      crossfadeDurationMs: Math.round(crossfadeDuration),
      nextStartOffsetMs: 0,
      preloadTriggerMs: Math.max(0, Math.round(transitionStart - PRELOAD_LEAD_MS)),
      bpmCurrent: isCurrent ? (merged.bpm || 0) : 0,
      bpmNext: !isCurrent ? (merged.bpm || 0) : 0,
      bpmMatchRatio: 1.0,
      bpmMatched: false,
      bpmTempoAdjust: 1.0,
      tempoRampMs: 0,
      curOutroStartMs: isCurrent ? Math.round(outroStart) : 0,
      curClimaxMs: isCurrent ? Math.round(climax) : 0,
      nextIntroEndMs: !isCurrent ? this._getIntroEnd(merged, duration) : 0,
      nextClimaxMs: !isCurrent ? Math.round(climax) : 0,
      candidateScore: 0.4,
      candidateReason: 'partial',
      source: 'partial',
      confidence: 0.4,
    };
  };

  // ── 回退规划（无分析数据）──

  TransitionPlanner.prototype._fallbackPlan = function (fallbackDuration) {
    return {
      transitionStartMs: -1, // -1 表示使用固定时长回退（duration - crossfadeDuration）
      crossfadeDurationMs: fallbackDuration,
      nextStartOffsetMs: 0,
      preloadTriggerMs: -1,
      bpmCurrent: 0,
      bpmNext: 0,
      bpmMatchRatio: 1.0,
      bpmMatched: false,
      bpmTempoAdjust: 1.0,
      tempoRampMs: 0,
      curOutroStartMs: 0,
      curClimaxMs: 0,
      nextIntroEndMs: 0,
      nextClimaxMs: 0,
      candidateScore: 0,
      candidateReason: 'fallback',
      source: 'fallback',
      confidence: 0,
    };
  };

  // ── 数据合并 ──────────────────────────────────────────────────────────────

  /**
   * 合并频谱分析结果和 osu! 数据。
   * osu! 数据优先：BPM、Kiai 段（高潮）使用 osu! 值。
   * 频谱数据补充：能量曲线、onset、beat grid 保留频谱值。
   */
  TransitionPlanner.prototype._mergeAnalysis = function (analysis) {
    if (!analysis) return {};
    var merged = Object.assign({}, analysis);

    if (analysis.osu) {
      // osu! BPM 优先
      if (analysis.osu.bpm > 0) {
        merged.bpm = analysis.osu.bpm;
      }
      // osu! Kiai 段作为高潮参考
      if (analysis.osu.kiaiSections && analysis.osu.kiaiSections.length > 0) {
        merged.osuKiaiSections = analysis.osu.kiaiSections;
      }
    }

    return merged;
  };

  // ── 关键结构点获取 ────────────────────────────────────────────────────────

  /**
   * 获取高潮点（优先 osu! Kiai，其次频谱分析）。
   */
  TransitionPlanner.prototype._getClimax = function (analysis) {
    if (!analysis) return 0;

    // osu! Kiai 段优先
    if (analysis.osuKiaiSections && analysis.osuKiaiSections.length > 0) {
      // 取第一个 Kiai 段的开始位置
      var kiai = analysis.osuKiaiSections[0];
      return kiai.startMs || 0;
    }

    // 频谱分析的高潮点
    return this._safeGetNumber(analysis, 'climaxMs', 0);
  };

  /**
   * 获取尾奏开始点。
   */
  TransitionPlanner.prototype._getOutroStart = function (analysis, duration) {
    var outroStart = this._safeGetNumber(analysis, 'outroStartMs', 0);
    if (outroStart > 0) return outroStart;
    // 回退：85% 处
    return Math.round(duration * 0.85);
  };

  /**
   * 获取前奏结束点。
   */
  TransitionPlanner.prototype._getIntroEnd = function (analysis, duration) {
    var introEnd = this._safeGetNumber(analysis, 'introEndMs', 0);
    if (introEnd > 0) return introEnd;
    // 回退：10% 处
    return Math.round(duration * 0.1);
  };

  // ── 候选生成 ──────────────────────────────────────────────────────────────

  /**
   * 生成候选过渡点。
   * 基于不同的策略生成多个候选，然后评分选择最佳。
   */
  TransitionPlanner.prototype._generateCandidates = function (cur, outroStart, curDuration, climax) {
    var candidates = [];

    // 候选 1：尾奏开始点（标准策略）
    candidates.push({
      positionMs: outroStart,
      type: 'outro_start',
      reason: 'outro_start',
    });

    // 候选 2：尾奏中段（如果尾奏足够长）
    var outroRemaining = curDuration - outroStart;
    if (outroRemaining > MIN_OUTRO_FOR_TRANSITION_MS * 2) {
      candidates.push({
        positionMs: outroStart + outroRemaining * 0.3,
        type: 'outro_mid',
        reason: 'outro_mid',
      });
    }

    // 候选 3：高潮后 3 秒（快速过渡策略）
    if (climax > 0 && climax + POST_CLIMAX_DELAY_MS < curDuration - MIN_CROSSFADE_MS) {
      candidates.push({
        positionMs: climax + POST_CLIMAX_DELAY_MS,
        type: 'post_climax',
        reason: 'post_climax',
      });
    }

    // 候选 4：歌曲末尾 - crossfadeDuration（保守策略）
    // 使用默认 crossfade 时长
    candidates.push({
      positionMs: Math.max(outroStart, curDuration - DEFAULT_CROSSFADE_MS),
      type: 'conservative',
      reason: 'conservative',
    });

    // 候选 5：基于能量曲线的尾奏内能量骤降点
    if (cur.energy && cur.energy.length > 0) {
      var energyDropPoint = this._findEnergyDropInTail(cur.energy, outroStart, curDuration, cur.energy.length);
      if (energyDropPoint > 0) {
        candidates.push({
          positionMs: energyDropPoint,
          type: 'energy_drop',
          reason: 'energy_drop',
        });
      }
    }

    return candidates;
  };

  /**
   * 在尾奏范围内寻找能量骤降点。
   * 这通常是最好的过渡点——能量自然下降的地方。
   */
  TransitionPlanner.prototype._findEnergyDropInTail = function (energy, outroStartMs, durationMs, energyLength) {
    try {
      // energy 是 1 点/秒的粗粒度能量曲线
      var durationSec = durationMs / 1000;
      var startIdx = Math.floor(outroStartMs / 1000);
      var endIdx = Math.min(energyLength - 1, Math.floor(durationSec));

      if (endIdx <= startIdx + 2) return -1;

      var maxDrop = 0;
      var maxDropIdx = -1;

      // 寻找最大的能量下降
      for (var i = startIdx + 1; i < endIdx; i++) {
        var drop = energy[i - 1] - energy[i];
        if (drop > maxDrop) {
          maxDrop = drop;
          maxDropIdx = i;
        }
      }

      if (maxDropIdx > 0) {
        return maxDropIdx * 1000; // 转回毫秒
      }
      return -1;
    } catch (e) {
      return -1;
    }
  };

  // ── 候选评分 ──────────────────────────────────────────────────────────────

  /**
   * 对候选过渡点进行综合评分。
   * @returns {{total: number, reason: string, scores: object}}
   */
  TransitionPlanner.prototype._scoreCandidate = function (candidate, cur, nxt, bpmMatch, nextIntroEnd, nextDuration) {
    var scores = {};
    var reasons = [];

    // 1. 结构合理性（0-0.3）
    var structureScore = 0.3;
    var curDuration = this._safeGetNumber(cur, 'durationMs', 0);
    var outroStart = this._getOutroStart(cur, curDuration);
    var climax = this._getClimax(cur);

    // 在尾奏范围内：加分
    if (candidate.positionMs >= outroStart) {
      structureScore = 0.3;
      reasons.push('in_outro');
    } else {
      structureScore = 0.1;
      reasons.push('before_outro');
    }

    // 不在高潮中：加分
    if (climax > 0) {
      var climaxWindow = 10000; // 高潮前后 10 秒
      if (Math.abs(candidate.positionMs - climax) < climaxWindow) {
        structureScore *= 0.3;
        reasons.push('near_climax_penalty');
      }
    }

    // 不会太晚（至少留够 crossfade 时间）
    if (candidate.positionMs > curDuration - MIN_CROSSFADE_MS) {
      structureScore *= 0.5;
      reasons.push('too_late');
    }

    scores.structure = structureScore;

    // 2. BPM 兼容性（0-0.25）
    var bpmScore = 0.1; // 基础分
    if (bpmMatch.matched) {
      bpmScore = 0.25;
      reasons.push('bpm_matched');
    } else if (bpmMatch.tempoAdjust > 0) {
      // 可以通过微调速率匹配
      var adjustRatio = bpmMatch.tempoAdjust;
      var deviation = Math.abs(adjustRatio - 1.0);
      if (deviation <= BPM_TEMPO_ADJUST_THRESHOLD) {
        bpmScore = 0.2 - deviation;
        reasons.push('bpm_adjustable');
      }
    }
    scores.bpm = bpmScore;

    // 3. 能量兼容性（0-0.25）
    var energyScore = 0.15; // 基础分
    if (cur.energy && nxt.energy) {
      var curEnergyAtTransition = this._getEnergyAt(cur.energy, candidate.positionMs);
      var nextEnergyAtStart = this._getEnergyAt(nxt.energy, 0);
      // 能量差异越小越好
      if (curEnergyAtTransition > 0 && nextEnergyAtStart > 0) {
        var ratio = Math.min(curEnergyAtTransition, nextEnergyAtStart) /
                    Math.max(curEnergyAtTransition, nextEnergyAtStart);
        energyScore = 0.25 * ratio;
        if (ratio > 0.7) reasons.push('energy_compatible');
      }
    }
    scores.energy = energyScore;

    // 4. 下一曲前奏适配（0-0.2）
    var introScore = 0.1;
    if (nextIntroEnd > 0) {
      var outroRemaining = curDuration - candidate.positionMs;
      // 前奏长度与尾奏剩余长度匹配
      if (nextIntroEnd > outroRemaining * 0.5 && nextIntroEnd < outroRemaining * 2) {
        introScore = 0.2;
        reasons.push('intro_match');
      } else if (nextIntroEnd > 0 && nextIntroEnd < outroRemaining * 3) {
        introScore = 0.15;
      }
    }
    scores.intro = introScore;

    // 综合评分
    var total = scores.structure + scores.bpm + scores.energy + scores.intro;

    return {
      total: total,
      reason: reasons.join(','),
      scores: scores,
    };
  };

  // ── 交叉淡化时长计算 ──────────────────────────────────────────────────────

  /**
   * 计算交叉淡化时长。
   * 基于：
   *   - 尾奏剩余长度
   *   - 下一曲前奏长度
   *   - BPM 匹配度
   *   - 能量兼容性
   */
  TransitionPlanner.prototype._computeCrossfadeDuration = function (
    transitionStart, curDuration, nextIntroEnd, nextDuration,
    curBpm, nextBpm, bpmMatch, fallbackDuration, radical
  ) {
    var outroRemaining = curDuration - transitionStart;

    // 基础时长：尾奏剩余和下一曲前奏的较短者
    var base = Math.min(outroRemaining, nextIntroEnd);

    var duration;
    if (base > 0) {
      // 使用尾奏/前奏的 60-80%
      duration = Math.round(base * 0.7);
    } else {
      duration = fallbackDuration;
    }

    // BPM 匹配时延长（节拍对齐的交叉淡化更自然）
    if (bpmMatch.matched) {
      duration = Math.round(duration * 1.3);
    } else if (bpmMatch.tempoAdjust > 0) {
      duration = Math.round(duration * 1.15);
    }
    if (radical) duration = Math.round(duration * 1.35);

    // 约束在合理范围
    duration = Math.max(MIN_CROSSFADE_MS, Math.min(MAX_CROSSFADE_MS, duration));

    // 确保不超过当前曲剩余时长
    if (duration > outroRemaining) {
      duration = Math.max(MIN_CROSSFADE_MS, Math.round(outroRemaining * 0.9));
    }

    return duration;
  };

  // ── 下一曲起始偏移计算 ────────────────────────────────────────────────────

  /**
   * 计算下一曲从什么位置开始播放。
   * 目标：交叉淡化完成时，下一曲大约在前奏结束/进入段。
   */
  TransitionPlanner.prototype._computeNextStartOffset = function (
    nextIntroEnd, crossfadeDuration, nextDuration, nxt, bpmMatch
  ) {
    if (nextIntroEnd <= 0) return 0;

    var offset = 0;

    if (nextIntroEnd > crossfadeDuration) {
      // 前奏比交叉淡化长：从前奏中间开始，使淡化结束时进入主段
      offset = Math.max(0, nextIntroEnd - Math.round(crossfadeDuration * 0.6));
    } else {
      // 前奏比交叉淡化短：从头开始
      offset = 0;
    }

    // 确保偏移不会导致下一曲过快结束
    if (offset > nextDuration - crossfadeDuration - 1000) {
      offset = 0;
    }

    return offset;
  };

  // ── BPM 匹配计算 ──────────────────────────────────────────────────────────

  /**
   * 计算 BPM 匹配信息。
   * @returns {{ratio: number, matched: boolean, tempoAdjust: number}}
   *   - ratio: BPM 比率（归一化到 0.5-2.0）
   *   - matched: 是否在阈值内匹配
   *   - tempoAdjust: 可用的速率调整比率（1.0 = 不调整）
   */
  TransitionPlanner.prototype._computeBpmMatch = function (curBpm, nextBpm) {
    if (!curBpm || !nextBpm || curBpm <= 0 || nextBpm <= 0) {
      return { ratio: 1.0, matched: false, tempoAdjust: 0, tempoRampMs: 0 };
    }

    // Playback rate is applied to the incoming track.  To make its BPM
    // follow the current track, the incoming track must use cur/next (not
    // next/cur).  Keep ratio as a normalized musical BPM ratio for scoring.
    var ratio = nextBpm / curBpm;
    var normalizedRatio = ratio;
    var matched = Math.abs(normalizedRatio - 1.0) <= BPM_MATCH_THRESHOLD;

    // 检查倍数关系（120 vs 60 = 2x）
    if (!matched) {
      var doubleRatio = ratio > 1 ? ratio / 2 : ratio * 2;
      if (Math.abs(doubleRatio - 1.0) <= BPM_MATCH_THRESHOLD) {
        matched = true;
        normalizedRatio = doubleRatio; // 使用归一化的比率
      }
    }

    // 计算可用的速率调整
    var tempoAdjust = 0;
    if (!matched) {
      var deviation = Math.abs(normalizedRatio - 1.0);
      if (deviation <= BPM_TEMPO_ADJUST_THRESHOLD) {
        // 可以通过微调速率匹配。对 incoming track 使用 cur/next。
        tempoAdjust = curBpm / nextBpm;
      }
    }

    // A longer ramp is less noticeable for larger corrections.  The audio
    // engine uses this only for the rate handoff; it does not alter samples.
    var correction = tempoAdjust > 0 ? Math.abs(tempoAdjust - 1.0) : 0;
    var tempoRampMs = correction > 0
      ? Math.round(1800 + Math.min(2200, correction * 14000))
      : 0;

    return {
      ratio: normalizedRatio,
      matched: matched,
      tempoAdjust: tempoAdjust,
      tempoRampMs: tempoRampMs,
    };
  };

  // ── 节拍对齐 ──────────────────────────────────────────────────────────────

  /**
   * 将时间点对齐到最近的节拍边界。
   */
  TransitionPlanner.prototype._alignToBeat = function (positionMs, beatGridMs, beatIntervalMs) {
    if (!beatGridMs || beatGridMs.length === 0 || !beatIntervalMs || beatIntervalMs <= 0) {
      return positionMs;
    }

    try {
      // 二分查找最近的节拍
      var lo = 0, hi = beatGridMs.length - 1;
      while (lo < hi) {
        var mid = Math.floor((lo + hi) / 2);
        if (beatGridMs[mid] < positionMs) lo = mid + 1;
        else hi = mid;
      }

      // lo 是第一个 >= positionMs 的节拍
      var nearest = beatGridMs[lo];
      var prevBeat = lo > 0 ? beatGridMs[lo - 1] : nearest - beatIntervalMs;

      // 选择更近的那个
      if (Math.abs(positionMs - prevBeat) < Math.abs(nearest - positionMs)) {
        return prevBeat;
      }
      return nearest;
    } catch (e) {
      return positionMs;
    }
  };

  // ── 能量查询 ──────────────────────────────────────────────────────────────

  /**
   * 获取指定时间点的能量值。
   * energy 是 1 点/秒的数组。
   */
  TransitionPlanner.prototype._getEnergyAt = function (energy, positionMs) {
    if (!energy || energy.length === 0) return 0;
    var idx = Math.floor(positionMs / 1000);
    if (idx < 0) idx = 0;
    if (idx >= energy.length) idx = energy.length - 1;
    var v = energy[idx];
    return isFinite(v) ? v : 0;
  };

  // ── 来源和置信度 ──────────────────────────────────────────────────────────

  /**
   * 确定分析数据来源。
   */
  TransitionPlanner.prototype._determineSource = function (cur, nxt) {
    var curHasOsu = !!cur.osu || !!cur.osuKiaiSections;
    var nextHasOsu = !!nxt.osu || !!nxt.osuKiaiSections;
    var curHasSpectrum = cur.energy != null;
    var nextHasSpectrum = nxt.energy != null;

    if ((curHasOsu || nextHasOsu) && (curHasSpectrum || nextHasSpectrum)) return 'hybrid';
    if (curHasOsu || nextHasOsu) return 'osu';
    if (curHasSpectrum || nextHasSpectrum) return 'spectrum';
    return 'fallback';
  };

  /**
   * 计算规划方案的置信度（0-1）。
   */
  TransitionPlanner.prototype._computeConfidence = function (cur, nxt, bestScore) {
    var score = 0;

    // 频谱分析数据
    if (cur.energy) score += 0.15;
    if (nxt.energy) score += 0.15;
    if (cur.bpm) score += 0.1;
    if (nxt.bpm) score += 0.1;

    // osu! 数据
    if (cur.osu) score += 0.15;
    if (nxt.osu) score += 0.15;

    // 结构数据
    if (cur.outroStartMs) score += 0.05;
    if (nxt.introEndMs) score += 0.05;

    // 候选评分贡献
    score += bestScore.total * 0.1;

    return Math.min(1.0, score);
  };

  // ── 工具方法 ──────────────────────────────────────────────────────────────

  /**
   * 安全获取数字属性。
   */
  TransitionPlanner.prototype._safeGetNumber = function (obj, key, defaultVal) {
    if (!obj || typeof obj !== 'object') return defaultVal;
    var v = obj[key];
    if (typeof v !== 'number' || !isFinite(v)) return defaultVal;
    return v;
  };

  /**
   * 将值约束在 [min, max] 范围内。
   */
  TransitionPlanner.prototype._clamp = function (val, min, max) {
    if (!isFinite(val)) return min;
    return Math.max(min, Math.min(max, val));
  };

  window.TransitionPlanner = TransitionPlanner;
})();
