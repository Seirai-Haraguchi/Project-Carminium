(function () {
  'use strict';


  var MIN_CROSSFADE_MS = 3000;
  var MAX_CROSSFADE_MS = 15000;
  var DEFAULT_CROSSFADE_MS = 5000;
  var BPM_MATCH_THRESHOLD = 0.08;
  var BPM_TEMPO_ADJUST_THRESHOLD = 0.20;
  var PRELOAD_LEAD_MS = 6000;
  var POST_CLIMAX_DELAY_MS = 3000;
  var MIN_OUTRO_FOR_TRANSITION_MS = 4000;


  function TransitionPlanner() {}

  TransitionPlanner.prototype.plan = function (current, next, settings) {
    var radical = !!(settings && settings.radicalTransitions);
    var fallbackDuration = this._safeGetNumber(settings, 'crossfadeDurationMs', DEFAULT_CROSSFADE_MS);
    if (radical) fallbackDuration = Math.max(fallbackDuration, 10000);

    if (!current && !next) {
      return this._fallbackPlan(fallbackDuration);
    }

    if (!current || !next) {
      return this._partialPlan(current || next, !!current, fallbackDuration);
    }

    return this._fullPlan(current, next, fallbackDuration, radical);
  };


  TransitionPlanner.prototype._fullPlan = function (current, next, fallbackDuration, radical) {
    var cur = this._mergeAnalysis(current);
    var nxt = this._mergeAnalysis(next);

    var curDuration = this._safeGetNumber(cur, 'durationMs', 0);
    var nextDuration = this._safeGetNumber(nxt, 'durationMs', 0);
    if (curDuration <= 0 || nextDuration <= 0) {
      return this._fallbackPlan(fallbackDuration);
    }

    var curClimax = this._getClimax(cur);
    var nextClimax = this._getClimax(nxt);
    var outroStart = this._getOutroStart(cur, curDuration);
    var nextIntroEnd = this._getIntroEnd(nxt, nextDuration);

    if (curClimax > 0 && outroStart < curClimax + POST_CLIMAX_DELAY_MS) {
      outroStart = curClimax + POST_CLIMAX_DELAY_MS;
    }
    outroStart = this._clamp(outroStart, curDuration * 0.6, curDuration - MIN_CROSSFADE_MS);

    var candidates = this._generateCandidates(cur, outroStart, curDuration, curClimax);

    var bpmMatch = this._computeBpmMatch(cur.bpm, nxt.bpm);
    var scoredCandidates = [];

    for (var i = 0; i < candidates.length; i++) {
      var candidate = candidates[i];
      var score = this._scoreCandidate(candidate, cur, nxt, bpmMatch, nextIntroEnd, nextDuration);
      scoredCandidates.push({ candidate: candidate, score: score });
    }

    scoredCandidates.sort(function (a, b) { return b.score.total - a.score.total; });
    var best = scoredCandidates[0];

    var transitionStart = best.candidate.positionMs;

    if (cur.beatGridMs && cur.beatGridMs.length > 0) {
      transitionStart = this._alignToBeat(transitionStart, cur.beatGridMs, cur.beatIntervalMs);
    }

    var crossfadeDuration = this._computeCrossfadeDuration(
      transitionStart, curDuration, nextIntroEnd, nextDuration,
      cur.bpm, nxt.bpm, bpmMatch, fallbackDuration, radical
    );

    var nextStartOffset = this._computeNextStartOffset(
      nextIntroEnd, crossfadeDuration, nextDuration, nxt, bpmMatch
    );

    if (nextStartOffset > 0 && nxt.beatGridMs && nxt.beatGridMs.length > 0) {
      nextStartOffset = this._alignToBeat(nextStartOffset, nxt.beatGridMs, nxt.beatIntervalMs);
    }

    if (transitionStart > curDuration - crossfadeDuration) {
      transitionStart = Math.max(0, curDuration - crossfadeDuration);
    }
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

    var fragmentBeats = density > 0.55 ? 0.5 : 1;
    var spacingBeats = density > 0.7 ? 0.5 : 1;
    var count = intensity > 0.32 ? 6 : 4;
    if (radical && intensity > 0.3) count = 8;
    if (radical && intensity > 0.38) count = 10;
    var spacingMs = Math.round(beatMs * spacingBeats);
    var fragmentMs = Math.round(beatMs * fragmentBeats);
    var totalMs = Math.min(crossfadeDuration, spacingMs * count + beatMs);
    var fragmentOffsetMs = Math.max(0, Math.round(transitionStart - fragmentMs));

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


  TransitionPlanner.prototype._partialPlan = function (analysis, isCurrent, fallbackDuration) {
    if (!analysis) return this._fallbackPlan(fallbackDuration);

    var merged = this._mergeAnalysis(analysis);
    var duration = this._safeGetNumber(merged, 'durationMs', 0);
    if (duration <= 0) return this._fallbackPlan(fallbackDuration);

    var climax = this._getClimax(merged);
    var outroStart = this._getOutroStart(merged, duration);

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


  TransitionPlanner.prototype._fallbackPlan = function (fallbackDuration) {
    return {
      transitionStartMs: -1,
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


  TransitionPlanner.prototype._mergeAnalysis = function (analysis) {
    if (!analysis) return {};
    var merged = Object.assign({}, analysis);

    if (analysis.osu) {
      if (analysis.osu.bpm > 0) {
        merged.bpm = analysis.osu.bpm;
      }
      if (analysis.osu.kiaiSections && analysis.osu.kiaiSections.length > 0) {
        merged.osuKiaiSections = analysis.osu.kiaiSections;
      }
    }

    return merged;
  };


  TransitionPlanner.prototype._getClimax = function (analysis) {
    if (!analysis) return 0;

    if (analysis.osuKiaiSections && analysis.osuKiaiSections.length > 0) {
      var kiai = analysis.osuKiaiSections[0];
      return kiai.startMs || 0;
    }

    return this._safeGetNumber(analysis, 'climaxMs', 0);
  };

  TransitionPlanner.prototype._getOutroStart = function (analysis, duration) {
    var outroStart = this._safeGetNumber(analysis, 'outroStartMs', 0);
    if (outroStart > 0) return outroStart;
    return Math.round(duration * 0.85);
  };

  TransitionPlanner.prototype._getIntroEnd = function (analysis, duration) {
    var introEnd = this._safeGetNumber(analysis, 'introEndMs', 0);
    if (introEnd > 0) return introEnd;
    return Math.round(duration * 0.1);
  };


  TransitionPlanner.prototype._generateCandidates = function (cur, outroStart, curDuration, climax) {
    var candidates = [];

    candidates.push({
      positionMs: outroStart,
      type: 'outro_start',
      reason: 'outro_start',
    });

    var outroRemaining = curDuration - outroStart;
    if (outroRemaining > MIN_OUTRO_FOR_TRANSITION_MS * 2) {
      candidates.push({
        positionMs: outroStart + outroRemaining * 0.3,
        type: 'outro_mid',
        reason: 'outro_mid',
      });
    }

    if (climax > 0 && climax + POST_CLIMAX_DELAY_MS < curDuration - MIN_CROSSFADE_MS) {
      candidates.push({
        positionMs: climax + POST_CLIMAX_DELAY_MS,
        type: 'post_climax',
        reason: 'post_climax',
      });
    }

    candidates.push({
      positionMs: Math.max(outroStart, curDuration - DEFAULT_CROSSFADE_MS),
      type: 'conservative',
      reason: 'conservative',
    });

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

  TransitionPlanner.prototype._findEnergyDropInTail = function (energy, outroStartMs, durationMs, energyLength) {
    try {
      var durationSec = durationMs / 1000;
      var startIdx = Math.floor(outroStartMs / 1000);
      var endIdx = Math.min(energyLength - 1, Math.floor(durationSec));

      if (endIdx <= startIdx + 2) return -1;

      var maxDrop = 0;
      var maxDropIdx = -1;

      for (var i = startIdx + 1; i < endIdx; i++) {
        var drop = energy[i - 1] - energy[i];
        if (drop > maxDrop) {
          maxDrop = drop;
          maxDropIdx = i;
        }
      }

      if (maxDropIdx > 0) {
        return maxDropIdx * 1000;
      }
      return -1;
    } catch (e) {
      return -1;
    }
  };


  TransitionPlanner.prototype._scoreCandidate = function (candidate, cur, nxt, bpmMatch, nextIntroEnd, nextDuration) {
    var scores = {};
    var reasons = [];

    var structureScore = 0.3;
    var curDuration = this._safeGetNumber(cur, 'durationMs', 0);
    var outroStart = this._getOutroStart(cur, curDuration);
    var climax = this._getClimax(cur);

    if (candidate.positionMs >= outroStart) {
      structureScore = 0.3;
      reasons.push('in_outro');
    } else {
      structureScore = 0.1;
      reasons.push('before_outro');
    }

    if (climax > 0) {
      var climaxWindow = 10000;
      if (Math.abs(candidate.positionMs - climax) < climaxWindow) {
        structureScore *= 0.3;
        reasons.push('near_climax_penalty');
      }
    }

    if (candidate.positionMs > curDuration - MIN_CROSSFADE_MS) {
      structureScore *= 0.5;
      reasons.push('too_late');
    }

    scores.structure = structureScore;

    var bpmScore = 0.1;
    if (bpmMatch.matched) {
      bpmScore = 0.25;
      reasons.push('bpm_matched');
    } else if (bpmMatch.tempoAdjust > 0) {
      var adjustRatio = bpmMatch.tempoAdjust;
      var deviation = Math.abs(adjustRatio - 1.0);
      if (deviation <= BPM_TEMPO_ADJUST_THRESHOLD) {
        bpmScore = 0.2 - deviation;
        reasons.push('bpm_adjustable');
      }
    }
    scores.bpm = bpmScore;

    var energyScore = 0.15;
    if (cur.energy && nxt.energy) {
      var curEnergyAtTransition = this._getEnergyAt(cur.energy, candidate.positionMs);
      var nextEnergyAtStart = this._getEnergyAt(nxt.energy, 0);
      if (curEnergyAtTransition > 0 && nextEnergyAtStart > 0) {
        var ratio = Math.min(curEnergyAtTransition, nextEnergyAtStart) /
                    Math.max(curEnergyAtTransition, nextEnergyAtStart);
        energyScore = 0.25 * ratio;
        if (ratio > 0.7) reasons.push('energy_compatible');
      }
    }
    scores.energy = energyScore;

    var introScore = 0.1;
    if (nextIntroEnd > 0) {
      var outroRemaining = curDuration - candidate.positionMs;
      if (nextIntroEnd > outroRemaining * 0.5 && nextIntroEnd < outroRemaining * 2) {
        introScore = 0.2;
        reasons.push('intro_match');
      } else if (nextIntroEnd > 0 && nextIntroEnd < outroRemaining * 3) {
        introScore = 0.15;
      }
    }
    scores.intro = introScore;

    var total = scores.structure + scores.bpm + scores.energy + scores.intro;

    return {
      total: total,
      reason: reasons.join(','),
      scores: scores,
    };
  };


  TransitionPlanner.prototype._computeCrossfadeDuration = function (
    transitionStart, curDuration, nextIntroEnd, nextDuration,
    curBpm, nextBpm, bpmMatch, fallbackDuration, radical
  ) {
    var outroRemaining = curDuration - transitionStart;

    var base = Math.min(outroRemaining, nextIntroEnd);

    var duration;
    if (base > 0) {
      duration = Math.round(base * 0.7);
    } else {
      duration = fallbackDuration;
    }

    if (bpmMatch.matched) {
      duration = Math.round(duration * 1.3);
    } else if (bpmMatch.tempoAdjust > 0) {
      duration = Math.round(duration * 1.15);
    }
    if (radical) duration = Math.round(duration * 1.35);

    duration = Math.max(MIN_CROSSFADE_MS, Math.min(MAX_CROSSFADE_MS, duration));

    if (duration > outroRemaining) {
      duration = Math.max(MIN_CROSSFADE_MS, Math.round(outroRemaining * 0.9));
    }

    return duration;
  };


  TransitionPlanner.prototype._computeNextStartOffset = function (
    nextIntroEnd, crossfadeDuration, nextDuration, nxt, bpmMatch
  ) {
    if (nextIntroEnd <= 0) return 0;

    var offset = 0;

    if (nextIntroEnd > crossfadeDuration) {
      offset = Math.max(0, nextIntroEnd - Math.round(crossfadeDuration * 0.6));
    } else {
      offset = 0;
    }

    if (offset > nextDuration - crossfadeDuration - 1000) {
      offset = 0;
    }

    return offset;
  };


  TransitionPlanner.prototype._computeBpmMatch = function (curBpm, nextBpm) {
    if (!curBpm || !nextBpm || curBpm <= 0 || nextBpm <= 0) {
      return { ratio: 1.0, matched: false, tempoAdjust: 0, tempoRampMs: 0 };
    }

    var ratio = nextBpm / curBpm;
    var normalizedRatio = ratio;
    var matched = Math.abs(normalizedRatio - 1.0) <= BPM_MATCH_THRESHOLD;

    if (!matched) {
      var doubleRatio = ratio > 1 ? ratio / 2 : ratio * 2;
      if (Math.abs(doubleRatio - 1.0) <= BPM_MATCH_THRESHOLD) {
        matched = true;
        normalizedRatio = doubleRatio;
      }
    }

    var tempoAdjust = 0;
    if (!matched) {
      var deviation = Math.abs(normalizedRatio - 1.0);
      if (deviation <= BPM_TEMPO_ADJUST_THRESHOLD) {
        tempoAdjust = curBpm / nextBpm;
      }
    }

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


  TransitionPlanner.prototype._alignToBeat = function (positionMs, beatGridMs, beatIntervalMs) {
    if (!beatGridMs || beatGridMs.length === 0 || !beatIntervalMs || beatIntervalMs <= 0) {
      return positionMs;
    }

    try {
      var lo = 0, hi = beatGridMs.length - 1;
      while (lo < hi) {
        var mid = Math.floor((lo + hi) / 2);
        if (beatGridMs[mid] < positionMs) lo = mid + 1;
        else hi = mid;
      }

      var nearest = beatGridMs[lo];
      var prevBeat = lo > 0 ? beatGridMs[lo - 1] : nearest - beatIntervalMs;

      if (Math.abs(positionMs - prevBeat) < Math.abs(nearest - positionMs)) {
        return prevBeat;
      }
      return nearest;
    } catch (e) {
      return positionMs;
    }
  };


  TransitionPlanner.prototype._getEnergyAt = function (energy, positionMs) {
    if (!energy || energy.length === 0) return 0;
    var idx = Math.floor(positionMs / 1000);
    if (idx < 0) idx = 0;
    if (idx >= energy.length) idx = energy.length - 1;
    var v = energy[idx];
    return isFinite(v) ? v : 0;
  };


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

  TransitionPlanner.prototype._computeConfidence = function (cur, nxt, bestScore) {
    var score = 0;

    if (cur.energy) score += 0.15;
    if (nxt.energy) score += 0.15;
    if (cur.bpm) score += 0.1;
    if (nxt.bpm) score += 0.1;

    if (cur.osu) score += 0.15;
    if (nxt.osu) score += 0.15;

    if (cur.outroStartMs) score += 0.05;
    if (nxt.introEndMs) score += 0.05;

    score += bestScore.total * 0.1;

    return Math.min(1.0, score);
  };


  TransitionPlanner.prototype._safeGetNumber = function (obj, key, defaultVal) {
    if (!obj || typeof obj !== 'object') return defaultVal;
    var v = obj[key];
    if (typeof v !== 'number' || !isFinite(v)) return defaultVal;
    return v;
  };

  TransitionPlanner.prototype._clamp = function (val, min, max) {
    if (!isFinite(val)) return min;
    return Math.max(min, Math.min(max, val));
  };

  window.TransitionPlanner = TransitionPlanner;
})();
