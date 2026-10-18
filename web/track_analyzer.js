(function () {
  'use strict';


  var BROWSER_DECODABLE = [
    'mp3', 'wav', 'ogg', 'oga', 'opus',
    'm4a', 'aac', 'flac', 'mp4', 'weba', 'webm',
  ];

  var FINE_WINDOW_MS = 50;
  var COARSE_WINDOW_MS = 1000;
  var BPM_MIN = 60;
  var BPM_MAX = 180;
  var BPM_OCTAVE_TOLERANCE = 0.04;
  var ENERGY_THRESHOLD_RATIO = 0.3;
  var SUSTAINED_SEC = 5;
  var ANALYSIS_TIMEOUT_MS = 30000;
  var CLIMAX_WINDOW_SEC = 10;
  var MIN_BEAT_LAG_MS = 333;
  var MAX_BEAT_LAG_MS = 1000;


  function TrackAnalyzer(audioEngine) {
    this._audioEngine = audioEngine;
    this._analysisActive = false;
    this._analysisQueue = [];
  }


  TrackAnalyzer.prototype.isAnalyzable = function (filePath) {
    if (!filePath || typeof filePath !== 'string') return false;
    if (filePath.indexOf('http://') === 0 || filePath.indexOf('https://') === 0) {
      return false;
    }
    var ext = '';
    var dotIdx = filePath.lastIndexOf('.');
    if (dotIdx >= 0) {
      ext = filePath.substring(dotIdx + 1).toLowerCase();
    }
    return BROWSER_DECODABLE.indexOf(ext) >= 0;
  };

  TrackAnalyzer.prototype.analyze = function (track, resolvedPath) {
    var self = this;
    if (!track || !resolvedPath) return Promise.resolve(null);
    if (!this.isAnalyzable(resolvedPath)) return Promise.resolve(null);

    return new Promise(function (resolve) {
      while (self._analysisQueue.length > 0) {
        var stale = self._analysisQueue.shift();
        stale.resolve(null);
      }
      self._analysisQueue.push({ track: track, resolvedPath: resolvedPath, resolve: resolve });
      self._drainAnalysisQueue();
    });
  };

  TrackAnalyzer.prototype._drainAnalysisQueue = function () {
    var self = this;
    if (self._analysisActive || self._analysisQueue.length === 0) return;

    var request = self._analysisQueue.pop();
    self._analysisActive = true;

    var timeoutId = setTimeout(function () {
      request.resolve(null);
      console.warn('[TrackAnalyzer] Analysis timeout for:', request.track.title);
    }, ANALYSIS_TIMEOUT_MS);
    var settled = false;

    Promise.resolve().then(function () {
      return self._doAnalyze(request.track, request.resolvedPath);
    }).then(function (result) {
      if (!settled) request.resolve(result);
    }).catch(function (e) {
      if (!settled) {
        console.error('[TrackAnalyzer] Analysis failed:', request.track.title, e.message);
        request.resolve(null);
      }
    }).then(function () {
      settled = true;
      clearTimeout(timeoutId);
      self._analysisActive = false;
      self._drainAnalysisQueue();
    });
  };

  TrackAnalyzer.prototype._doAnalyze = function (track, resolvedPath) {
    var self = this;

    return self._getAudioBuffer(resolvedPath).then(function (buffer) {
      if (!buffer) {
        console.log('[TrackAnalyzer] No AudioBuffer for:', track.title);
        return null;
      }

      var durationSec = buffer.duration || 0;
      if (durationSec <= 0 || !isFinite(durationSec)) {
        console.warn('[TrackAnalyzer] Invalid duration:', durationSec);
        return null;
      }

      var coarseEnergy = self._computeEnergyCurve(buffer, COARSE_WINDOW_MS);
      if (!coarseEnergy || coarseEnergy.length === 0) {
        console.warn('[TrackAnalyzer] Empty energy curve');
        return null;
      }

      var fineEnergy = self._computeEnergyCurve(buffer, FINE_WINDOW_MS);

      var onsetEnvelope = self._computeOnsetEnvelope(fineEnergy);

      var bpmResult = self._detectBPM(onsetEnvelope, FINE_WINDOW_MS);

      var beatGrid = null;
      if (bpmResult.bpm > 0) {
        beatGrid = self._estimateBeatGrid(onsetEnvelope, FINE_WINDOW_MS, bpmResult.bpm, durationSec);
      }

      var introEndMs = self._findIntroEnd(coarseEnergy, COARSE_WINDOW_MS, durationSec);
      var outroStartMs = self._findOutroStart(coarseEnergy, COARSE_WINDOW_MS, durationSec);
      var climaxMs = self._findClimax(coarseEnergy, COARSE_WINDOW_MS, durationSec);
      var segments = self._detectSegments(coarseEnergy, COARSE_WINDOW_MS, durationSec, introEndMs, outroStartMs, climaxMs);

      var analysis = {
        bpm: bpmResult.bpm,
        bpmConfidence: bpmResult.confidence,
        energy: self._downsampleForCache(coarseEnergy, durationSec),
        onsetStrength: self._computeOnsetStats(onsetEnvelope),
        introEndMs: introEndMs,
        outroStartMs: outroStartMs,
        climaxMs: climaxMs,
        segments: segments,
        beatGridMs: beatGrid ? beatGrid.beatPositions : [],
        beatIntervalMs: beatGrid ? beatGrid.beatIntervalMs : 0,
        durationMs: Math.round(durationSec * 1000),
        analyzedAt: Date.now(),
        source: 'spectrum',
      };

      fineEnergy = null;
      onsetEnvelope = null;

      console.log('[TrackAnalyzer] Analysis complete:', track.title,
        'BPM=' + analysis.bpm + ' (conf=' + analysis.bpmConfidence.toFixed(2) + ')',
        'introEnd=' + analysis.introEndMs + 'ms',
        'outroStart=' + analysis.outroStartMs + 'ms',
        'climax=' + analysis.climaxMs + 'ms',
        'segments=' + (segments ? segments.length : 0));

      return analysis;
    });
  };


  TrackAnalyzer.prototype._getAudioBuffer = function (filePath) {
    var self = this;

    if (self._audioEngine && typeof self._audioEngine.getCachedBuffer === 'function') {
      var cached = self._audioEngine.getCachedBuffer(filePath);
      if (cached) return Promise.resolve(cached);
    }

    if (!self._audioEngine || typeof self._audioEngine._loadAndDecode !== 'function') {
      return Promise.resolve(null);
    }

    return self._audioEngine._loadAndDecode(filePath).then(function (buffer) {
      if (buffer && self._audioEngine && typeof self._audioEngine.setCachedBuffer === 'function') {
        try {
          self._audioEngine.setCachedBuffer(filePath, buffer);
        } catch (e) {
        }
      }
      return buffer;
    }).catch(function (e) {
      console.warn('[TrackAnalyzer] _loadAndDecode failed:', filePath, e.message);
      return null;
    });
  };


  TrackAnalyzer.prototype._computeEnergyCurve = function (buffer, windowMs) {
    try {
      var sampleRate = buffer.sampleRate || 44100;
      var windowSize = Math.max(1, Math.floor(sampleRate * windowMs / 1000));
      var channelData = buffer.getChannelData(0);
      if (!channelData || channelData.length === 0) return new Float32Array(0);

      var channel2 = null;
      if (buffer.numberOfChannels >= 2) {
        try {
          channel2 = buffer.getChannelData(1);
        } catch (e) {
          channel2 = null;
        }
      }

      var numWindows = Math.floor(channelData.length / windowSize);
      if (numWindows <= 0) return new Float32Array(0);
      var energy = new Float32Array(numWindows);

      for (var i = 0; i < numWindows; i++) {
        var sum = 0;
        var start = i * windowSize;
        for (var j = 0; j < windowSize; j++) {
          var s = channelData[start + j];
          if (channel2) {
            var s2 = channel2[start + j];
            s = (s + s2) * 0.5;
          }
          sum += s * s;
        }
        energy[i] = Math.sqrt(sum / windowSize);
      }

      return energy;
    } catch (e) {
      console.error('[TrackAnalyzer] _computeEnergyCurve error:', e.message);
      return new Float32Array(0);
    }
  };


  TrackAnalyzer.prototype._computeOnsetEnvelope = function (energy) {
    if (!energy || energy.length < 2) return new Float32Array(0);

    try {
      var n = energy.length;
      var rawDiff = new Float32Array(n);

      for (var i = 1; i < n; i++) {
        var diff = energy[i] - energy[i - 1];
        rawDiff[i] = diff > 0 ? diff : 0;
      }

      var localWindow = Math.max(1, Math.round(1000 / FINE_WINDOW_MS));
      var normalized = new Float32Array(n);

      for (var j = 0; j < n; j++) {
        var sum = 0;
        var count = 0;
        var wStart = Math.max(0, j - localWindow);
        var wEnd = Math.min(n, j + localWindow + 1);
        for (var k = wStart; k < wEnd; k++) {
          sum += rawDiff[k];
          count++;
        }
        var localMean = count > 0 ? sum / count : 0;
        normalized[j] = Math.max(0, rawDiff[j] - localMean);
      }

      return normalized;
    } catch (e) {
      console.error('[TrackAnalyzer] _computeOnsetEnvelope error:', e.message);
      return new Float32Array(0);
    }
  };


  TrackAnalyzer.prototype._detectBPM = function (onsetEnvelope, windowMs) {
    if (!onsetEnvelope || onsetEnvelope.length < 20) {
      return { bpm: 0, confidence: 0 };
    }

    try {
      var len = onsetEnvelope.length;
      var minLag = Math.max(1, Math.round(MIN_BEAT_LAG_MS / windowMs));
      var maxLag = Math.min(len - 1, Math.round(MAX_BEAT_LAG_MS / windowMs));

      if (maxLag <= minLag) return { bpm: 0, confidence: 0 };

      var scores = new Float32Array(maxLag + 1);
      var totalEnergy = 0;

      for (var lag = minLag; lag <= maxLag; lag++) {
        var score = 0;
        var count = 0;
        for (var i = 0; i < len - lag; i++) {
          score += onsetEnvelope[i] * onsetEnvelope[i + lag];
          count++;
        }
        if (count > 0) score /= count;
        scores[lag] = score;
        totalEnergy += score;
      }

      if (totalEnergy <= 0) return { bpm: 0, confidence: 0 };

      var bestLag = minLag;
      var bestScore = 0;
      for (var l = minLag; l <= maxLag; l++) {
        var bpm = 60000 / (l * windowMs);
        var bias = 1.0;
        if (bpm >= 100 && bpm <= 170) {
          bias = 1.3;
          if (bpm >= 115 && bpm <= 150) {
            bias = 1.5;
          }
        } else if (bpm > 170) {
          bias = 0.7;
        } else if (bpm < 80) {
          bias = 0.8;
        }
        var adjustedScore = scores[l] * bias;
        if (adjustedScore > bestScore) {
          bestScore = adjustedScore;
          bestLag = l;
        }
      }

      var selectedLag = bestLag;
      var maxScore = scores[selectedLag];

      var halfLag = Math.round(selectedLag / 2);
      var doubleLag = selectedLag * 2;

      if (doubleLag <= maxLag && scores[doubleLag] > maxScore * 0.85) {
        selectedLag = doubleLag;
        maxScore = scores[doubleLag];
      }

      if (halfLag >= minLag && scores[halfLag] > maxScore * 0.75) {
        var halfBpm = Math.round(60000 / (halfLag * windowMs));
        if (halfBpm >= BPM_MIN && halfBpm <= BPM_MAX) {
          selectedLag = halfLag;
          maxScore = scores[halfLag];
        }
      }

      var bpm = Math.round(60000 / (selectedLag * windowMs));
      if (bpm < BPM_MIN || bpm > BPM_MAX) {
        while (bpm < BPM_MIN) bpm *= 2;
        while (bpm > BPM_MAX) bpm = Math.round(bpm / 2);
      }

      var meanScore = totalEnergy / (maxLag - minLag + 1);
      var confidence = meanScore > 0 ? Math.min(1.0, maxScore / (meanScore * 4)) : 0;

      return { bpm: bpm, confidence: confidence };
    } catch (e) {
      console.error('[TrackAnalyzer] _detectBPM error:', e.message);
      return { bpm: 0, confidence: 0 };
    }
  };


  TrackAnalyzer.prototype._estimateBeatGrid = function (onsetEnvelope, windowMs, bpm, durationSec) {
    try {
      var beatIntervalMs = 60000 / bpm;
      var beatLag = Math.round(beatIntervalMs / windowMs);
      if (beatLag < 1) return { beatPositions: [], beatIntervalMs: 0 };

      var len = onsetEnvelope.length;
      var bestPhase = 0;
      var bestScore = 0;

      for (var phase = 0; phase < beatLag; phase++) {
        var score = 0;
        var count = 0;
        for (var i = phase; i < len; i += beatLag) {
          score += onsetEnvelope[i];
          count++;
        }
        if (count > 0) score /= count;
        if (score > bestScore) {
          bestScore = score;
          bestPhase = phase;
        }
      }

      var beatPositions = [];
      for (var j = bestPhase; j < len; j += beatLag) {
        var posMs = j * windowMs;
        if (posMs < durationSec * 1000) {
          beatPositions.push(posMs);
        }
      }

      return { beatPositions: beatPositions, beatIntervalMs: beatIntervalMs };
    } catch (e) {
      console.error('[TrackAnalyzer] _estimateBeatGrid error:', e.message);
      return { beatPositions: [], beatIntervalMs: 0 };
    }
  };


  TrackAnalyzer.prototype._findIntroEnd = function (energy, windowMs, duration) {
    try {
      if (!energy || energy.length === 0) return 0;

      var maxEnergy = this._maxValue(energy);
      if (maxEnergy <= 0) return Math.round(duration * 0.1 * 1000);

      var threshold = maxEnergy * ENERGY_THRESHOLD_RATIO;
      var sustainedWindows = Math.max(1, Math.round(SUSTAINED_SEC * 1000 / windowMs));

      for (var i = 0; i <= energy.length - sustainedWindows; i++) {
        var sustained = true;
        for (var j = 0; j < sustainedWindows; j++) {
          if (energy[i + j] < threshold) {
            sustained = false;
            break;
          }
        }
        if (sustained) {
          return i * windowMs;
        }
      }

      return Math.round(duration * 0.1 * 1000);
    } catch (e) {
      console.warn('[TrackAnalyzer] _findIntroEnd error:', e.message);
      return Math.round((duration || 0) * 0.1 * 1000);
    }
  };

  TrackAnalyzer.prototype._findOutroStart = function (energy, windowMs, duration) {
    try {
      if (!energy || energy.length === 0) return Math.round(duration * 0.85 * 1000);

      var maxEnergy = this._maxValue(energy);
      if (maxEnergy <= 0) return Math.round(duration * 0.85 * 1000);

      var threshold = maxEnergy * ENERGY_THRESHOLD_RATIO;
      var sustainedWindows = Math.max(1, Math.round(SUSTAINED_SEC * 1000 / windowMs));

      var lastSustained = energy.length;
      for (var i = energy.length - sustainedWindows; i >= 0; i--) {
        var sustained = true;
        for (var j = 0; j < sustainedWindows; j++) {
          if (energy[i + j] < threshold) {
            sustained = false;
            break;
          }
        }
        if (sustained) {
          lastSustained = i;
          break;
        }
      }

      var outroStart = (lastSustained + sustainedWindows) * windowMs;
      var durationMs = Math.round(duration * 1000);

      if (outroStart < durationMs * 0.6) outroStart = Math.round(durationMs * 0.85);
      if (outroStart > durationMs * 0.95) outroStart = Math.round(durationMs * 0.9);

      return outroStart;
    } catch (e) {
      console.warn('[TrackAnalyzer] _findOutroStart error:', e.message);
      return Math.round((duration || 0) * 0.85 * 1000);
    }
  };

  TrackAnalyzer.prototype._findClimax = function (energy, windowMs, duration) {
    try {
      if (!energy || energy.length === 0) return Math.round(duration * 0.5 * 1000);

      var startIdx = Math.floor(energy.length * 0.2);
      var endIdx = Math.floor(energy.length * 0.8);
      if (endIdx <= startIdx) return Math.round(duration * 0.5 * 1000);

      var windowSize = Math.max(1, Math.round(CLIMAX_WINDOW_SEC * 1000 / windowMs));
      var bestIdx = startIdx;
      var bestAvg = 0;

      var prefixSum = new Float64Array(energy.length + 1);
      for (var p = 0; p < energy.length; p++) {
        prefixSum[p + 1] = prefixSum[p] + energy[p];
      }

      for (var i = startIdx; i <= endIdx - windowSize; i++) {
        var sum = prefixSum[i + windowSize] - prefixSum[i];
        var avg = sum / windowSize;
        if (avg > bestAvg) {
          bestAvg = avg;
          bestIdx = i;
        }
      }

      return bestIdx * windowMs;
    } catch (e) {
      console.warn('[TrackAnalyzer] _findClimax error:', e.message);
      return Math.round((duration || 0) * 0.5 * 1000);
    }
  };

  TrackAnalyzer.prototype._detectSegments = function (energy, windowMs, duration, introEndMs, outroStartMs, climaxMs) {
    try {
      if (!energy || energy.length === 0) return [];

      var durationMs = Math.round(duration * 1000);
      var maxEnergy = this._maxValue(energy);
      if (maxEnergy <= 0) return [];

      var threshold = maxEnergy * ENERGY_THRESHOLD_RATIO;
      var segments = [];

      if (introEndMs > 0) {
        segments.push({ type: 'intro', startMs: 0, endMs: introEndMs });
      }

      if (outroStartMs > 0 && outroStartMs < durationMs) {
        segments.push({ type: 'outro', startMs: outroStartMs, endMs: durationMs });
      }

      var bodyStart = Math.floor(introEndMs / windowMs);
      var bodyEnd = Math.floor(outroStartMs / windowMs);
      var breakdownWindow = Math.max(1, Math.round(3 * 1000 / windowMs));

      var inBreakdown = false;
      var breakdownStart = 0;

      for (var i = bodyStart; i < Math.min(bodyEnd, energy.length); i++) {
        if (energy[i] < threshold) {
          if (!inBreakdown) {
            inBreakdown = true;
            breakdownStart = i;
          }
        } else {
          if (inBreakdown) {
            var breakdownLen = i - breakdownStart;
            if (breakdownLen >= breakdownWindow) {
              segments.push({
                type: 'breakdown',
                startMs: breakdownStart * windowMs,
                endMs: i * windowMs,
              });
            }
            inBreakdown = false;
          }
        }
      }

      if (climaxMs > 0) {
        var climaxWindowMs = CLIMAX_WINDOW_SEC * 1000;
        segments.push({
          type: 'climax',
          startMs: Math.max(introEndMs, climaxMs - climaxWindowMs / 2),
          endMs: Math.min(outroStartMs, climaxMs + climaxWindowMs / 2),
        });
      }

      segments.sort(function (a, b) { return a.startMs - b.startMs; });

      return segments;
    } catch (e) {
      console.warn('[TrackAnalyzer] _detectSegments error:', e.message);
      return [];
    }
  };


  TrackAnalyzer.prototype._maxValue = function (arr) {
    if (!arr || arr.length === 0) return 0;
    var max = 0;
    for (var i = 0; i < arr.length; i++) {
      var v = arr[i];
      if (isFinite(v) && v > max) max = v;
    }
    return max;
  };

  TrackAnalyzer.prototype._computeOnsetStats = function (onsetEnvelope) {
    if (!onsetEnvelope || onsetEnvelope.length === 0) return null;
    var sum = 0;
    var max = 0;
    for (var i = 0; i < onsetEnvelope.length; i++) {
      var v = onsetEnvelope[i];
      if (!isFinite(v)) continue;
      sum += v;
      if (v > max) max = v;
    }
    return {
      mean: sum / onsetEnvelope.length,
      max: max,
    };
  };

  TrackAnalyzer.prototype._downsampleForCache = function (energy, durationSec) {
    if (!energy || energy.length === 0) return [];
    var maxPoints = 600;
    if (energy.length <= maxPoints) {
      var result = new Array(energy.length);
      for (var i = 0; i < energy.length; i++) {
        result[i] = Math.round(energy[i] * 10000) / 10000;
      }
      return result;
    }

    var step = energy.length / maxPoints;
    var downsampled = new Array(maxPoints);
    for (var j = 0; j < maxPoints; j++) {
      var srcIdx = Math.floor(j * step);
      downsampled[j] = Math.round(energy[srcIdx] * 10000) / 10000;
    }
    return downsampled;
  };

  window.TrackAnalyzer = TrackAnalyzer;
})();
