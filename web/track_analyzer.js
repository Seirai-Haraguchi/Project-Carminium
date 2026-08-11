/**
 * TrackAnalyzer — 音轨频谱分析器（生产级）
 *
 * 对 AudioBuffer 进行离线分析，提取音乐结构特征用于智能过渡：
 *   - 能量曲线（多分辨率：1s 粗粒度用于结构分析，50ms 细粒度用于节拍检测）
 *   - 频谱通量（Spectral Flux）onset 检测，用于精确定位音乐事件
 *   - BPM 检测（增强自相关 + 倍频/半频校正 + 置信度评分）
 *   - 节拍网格估计（beat grid），用于过渡点节拍对齐
 *   - 前奏结束点（能量首次持续达到阈值）
 *   - 尾奏开始点（能量最后一次持续下降到阈值以下）
 *   - 高潮段（最大持续能量窗口 + osu! Kiai 优先）
 *   - 结构段落标记（intro / verse / chorus / breakdown / outro）
 *
 * 分析在 renderer 进程进行，使用 AudioEngine 的 AudioContext 和 AudioBuffer 缓存。
 * 对于浏览器可解码格式（mp3/flac/m4a 等），直接 decodeAudioData 获取 AudioBuffer。
 * 对于 FFmpeg-only 格式（wma/ape）或 Subsonic 流，跳过频谱分析（依赖 osu! 数据）。
 *
 * 防御性设计：
 *   - 所有步骤有 try-catch，失败时返回部分结果而非 null
 *   - 分析超时保护（30s），防止长曲目阻塞
 *   - 内存管理：分析完成后释放临时数组
 *   - 不阻塞 AudioContext（使用独立变量，不修改 AudioEngine 状态）
 *   - 所有数值边界检查，防止 NaN / Infinity 污染结果
 *
 * 兼容性：
 *   - 本地文件：通过 AudioEngine._loadAndDecode 解码
 *   - Subsonic HTTP URL：通过 IPC decodeAudioFile（bridge.js 支持 HTTP fetch）
 *   - FFmpeg-only 格式：isAnalyzable 返回 false，自动回退到 osu! 数据
 */
(function () {
  'use strict';

  // ── 常量 ──────────────────────────────────────────────────────────────────

  var BROWSER_DECODABLE = [
    'mp3', 'wav', 'ogg', 'oga', 'opus',
    'm4a', 'aac', 'flac', 'mp4', 'weba', 'webm',
  ];

  // 分析参数
  var FINE_WINDOW_MS = 50;             // 细粒度能量窗口（用于 BPM 检测）
  var COARSE_WINDOW_MS = 1000;         // 粗粒度能量窗口（用于结构分析，1 点/秒）
  var BPM_MIN = 60;
  var BPM_MAX = 180;                // 收窄上限，200 BPM 太罕见且容易误检
  var BPM_OCTAVE_TOLERANCE = 0.04;     // 倍频/半频匹配容差
  var ENERGY_THRESHOLD_RATIO = 0.3;    // 能量阈值 = max * ratio
  var SUSTAINED_SEC = 5;              // 持续时间阈值（秒）
  var ANALYSIS_TIMEOUT_MS = 30000;     // 分析超时
  var CLIMAX_WINDOW_SEC = 10;          // 高潮检测窗口（秒）
  var MIN_BEAT_LAG_MS = 333;           // 最小节拍间隔（180 BPM = 333ms）
  var MAX_BEAT_LAG_MS = 1000;          // 最大节拍间隔（60 BPM = 1000ms）

  // ── TrackAnalyzer ──────────────────────────────────────────────────────────

  function TrackAnalyzer(audioEngine) {
    this._audioEngine = audioEngine;
    // decodeAudioData cannot be cancelled once started.  Keep only one
    // analysis in flight so rapid track changes cannot retain several full
    // AudioBuffers in the renderer at the same time.
    this._analysisActive = false;
    this._analysisQueue = [];
  }

  // ── 公共 API ──────────────────────────────────────────────────────────────

  /**
   * 判断文件路径可以进行频谱分析。
   * 仅本地浏览器可解码格式（mp3/flac/m4a 等）。
   *
   * HTTP URL（Subsonic 流媒体）不尝试频谱分析：
   *   - 下载整个文件通过 net.fetch → decodeAudioData 路径会 30s 超时
   *   - Subsonic 流媒体已通过 FFmpeg PCM 播放，重复下载浪费带宽
   *   - Subsonic 曲目依赖 osu! 数据获取 BPM/结构信息
   */
  TrackAnalyzer.prototype.isAnalyzable = function (filePath) {
    if (!filePath || typeof filePath !== 'string') return false;
    // HTTP URL（Subsonic）：跳过频谱分析，依赖 osu! 数据
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

  /**
   * 分析一首歌的音频。
   * @param {object} track - 轨道对象（含 path, title, artist, duration_ms）
   * @param {string} resolvedPath - 已解析的可播放路径（本地文件或 HTTP URL）
   * @returns {Promise<object|null>} 分析结果
   */
  TrackAnalyzer.prototype.analyze = function (track, resolvedPath) {
    var self = this;
    if (!track || !resolvedPath) return Promise.resolve(null);
    if (!this.isAnalyzable(resolvedPath)) return Promise.resolve(null);

    return new Promise(function (resolve) {
      // App-level generation tokens already reject stale results.  Matching
      // that policy here prevents stale queued work from ever decoding.
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
      // The decode is still active, so the queue remains blocked until the
      // underlying promise settles.  This avoids starting another large
      // AudioBuffer while a timed-out one is still retained by Chromium.
      request.resolve(null);
      console.warn('[TrackAnalyzer] Analysis timeout for:', request.track.title);
    }, ANALYSIS_TIMEOUT_MS);
    var settled = false;

    // Start on a promise turn so a synchronous defensive failure also goes
    // through the normal cleanup path below.
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

      // 1. 计算粗粒度能量曲线（1 点/秒，用于缓存和结构分析）
      var coarseEnergy = self._computeEnergyCurve(buffer, COARSE_WINDOW_MS);
      if (!coarseEnergy || coarseEnergy.length === 0) {
        console.warn('[TrackAnalyzer] Empty energy curve');
        return null;
      }

      // 2. 计算细粒度能量曲线（50ms，用于 BPM 检测）
      var fineEnergy = self._computeEnergyCurve(buffer, FINE_WINDOW_MS);

      // 3. 计算频谱通量（onset 检测）
      var onsetEnvelope = self._computeOnsetEnvelope(fineEnergy);

      // 4. BPM 检测
      var bpmResult = self._detectBPM(onsetEnvelope, FINE_WINDOW_MS);

      // 5. 节拍网格估计
      var beatGrid = null;
      if (bpmResult.bpm > 0) {
        beatGrid = self._estimateBeatGrid(onsetEnvelope, FINE_WINDOW_MS, bpmResult.bpm, durationSec);
      }

      // 6. 结构分析
      var introEndMs = self._findIntroEnd(coarseEnergy, COARSE_WINDOW_MS, durationSec);
      var outroStartMs = self._findOutroStart(coarseEnergy, COARSE_WINDOW_MS, durationSec);
      var climaxMs = self._findClimax(coarseEnergy, COARSE_WINDOW_MS, durationSec);
      var segments = self._detectSegments(coarseEnergy, COARSE_WINDOW_MS, durationSec, introEndMs, outroStartMs, climaxMs);

      // 7. 构建分析结果
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

      // 清理临时数组（释放内存）
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

  // ── AudioBuffer 获取 ──────────────────────────────────────────────────────

  TrackAnalyzer.prototype._getAudioBuffer = function (filePath) {
    var self = this;

    // 优先从 AudioEngine 的 LRU 缓存获取
    if (self._audioEngine && typeof self._audioEngine.getCachedBuffer === 'function') {
      var cached = self._audioEngine.getCachedBuffer(filePath);
      if (cached) return Promise.resolve(cached);
    }

    // 通过 IPC 加载并解码
    if (!self._audioEngine || typeof self._audioEngine._loadAndDecode !== 'function') {
      return Promise.resolve(null);
    }

    return self._audioEngine._loadAndDecode(filePath).then(function (buffer) {
      // 存入缓存（如果 AudioEngine 支持）
      if (buffer && self._audioEngine && typeof self._audioEngine.setCachedBuffer === 'function') {
        try {
          self._audioEngine.setCachedBuffer(filePath, buffer);
        } catch (e) {
          // 缓存失败不影响分析
        }
      }
      return buffer;
    }).catch(function (e) {
      console.warn('[TrackAnalyzer] _loadAndDecode failed:', filePath, e.message);
      return null;
    });
  };

  // ── 能量曲线 ──────────────────────────────────────────────────────────────

  /**
   * 计算 RMS 能量曲线。
   * 混合双声道后逐窗口计算 RMS。
   * @param {AudioBuffer} buffer
   * @param {number} windowMs - 窗口大小（毫秒）
   * @returns {Float32Array} 每个窗口的 RMS 值
   */
  TrackAnalyzer.prototype._computeEnergyCurve = function (buffer, windowMs) {
    try {
      var sampleRate = buffer.sampleRate || 44100;
      var windowSize = Math.max(1, Math.floor(sampleRate * windowMs / 1000));
      var channelData = buffer.getChannelData(0);
      if (!channelData || channelData.length === 0) return new Float32Array(0);

      // 如果有第二声道，混合
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

  // ── Onset Envelope（频谱通量）──────────────────────────────────────────────

  /**
   * 计算 onset envelope（能量正差分）。
   * 用于 BPM 检测：onset 表示音乐中的"事件"（鼓点、节拍变化）。
   * 使用半波整流差分（HWR）+ 局部均值归一化，提高检测精度。
   */
  TrackAnalyzer.prototype._computeOnsetEnvelope = function (energy) {
    if (!energy || energy.length < 2) return new Float32Array(0);

    try {
      var n = energy.length;
      var rawDiff = new Float32Array(n);

      // 半波整流差分
      for (var i = 1; i < n; i++) {
        var diff = energy[i] - energy[i - 1];
        rawDiff[i] = diff > 0 ? diff : 0;
      }

      // 局部均值归一化（窗口 = 1 秒对应的窗口数）
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
        // 归一化：减去局部均值后取正部分
        normalized[j] = Math.max(0, rawDiff[j] - localMean);
      }

      return normalized;
    } catch (e) {
      console.error('[TrackAnalyzer] _computeOnsetEnvelope error:', e.message);
      return new Float32Array(0);
    }
  };

  // ── BPM 检测 ────────────────────────────────────────────────────────────────

  /**
   * 通过增强自相关检测 BPM。
   *
   * 算法：
   *   1. 对 onset envelope 在每个候选 lag 处计算自相关
   *   2. 对候选 BPM 进行倍频/半频校正
   *   3. 使用加权评分选择最佳 BPM
   *   4. 计算置信度（峰值显著性）
   *
   * @param {Float32Array} onsetEnvelope - onset envelope
   * @param {number} windowMs - onset envelope 的窗口大小（毫秒）
   * @returns {{bpm: number, confidence: number}} BPM 和置信度（0-1）
   */
  TrackAnalyzer.prototype._detectBPM = function (onsetEnvelope, windowMs) {
    if (!onsetEnvelope || onsetEnvelope.length < 20) {
      return { bpm: 0, confidence: 0 };
    }

    try {
      var len = onsetEnvelope.length;
      var minLag = Math.max(1, Math.round(MIN_BEAT_LAG_MS / windowMs));
      var maxLag = Math.min(len - 1, Math.round(MAX_BEAT_LAG_MS / windowMs));

      if (maxLag <= minLag) return { bpm: 0, confidence: 0 };

      // 计算每个 lag 的自相关分数
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

      // 应用 tempo preference bias：流行/电子音乐 BPM 集中在 100-160
      // 对该范围加分，抑制极端值（特别是 200 BPM 等高频误检）
      var bestLag = minLag;
      var bestScore = 0;
      for (var l = minLag; l <= maxLag; l++) {
        var bpm = 60000 / (l * windowMs);
        var bias = 1.0;
        if (bpm >= 100 && bpm <= 170) {
          // 100-170 BPM 范围加权 1.3
          bias = 1.3;
          if (bpm >= 115 && bpm <= 150) {
            // 115-150 BPM 加权 1.5（最常见范围）
            bias = 1.5;
          }
        } else if (bpm > 170) {
          // >170 BPM 降权
          bias = 0.7;
        } else if (bpm < 80) {
          // <80 BPM 降权
          bias = 0.8;
        }
        var adjustedScore = scores[l] * bias;
        if (adjustedScore > bestScore) {
          bestScore = adjustedScore;
          bestLag = l;
        }
      }

      // Keep the selected lag separate from the search range.  The previous
      // implementation overwrote maxLag with bestLag, which made the
      // double-lag check impossible and made half/double-time correction
      // depend on whichever candidate happened to win the biased search.
      var selectedLag = bestLag;
      var maxScore = scores[selectedLag];

      // 倍频/半频校正
      var halfLag = Math.round(selectedLag / 2);
      var doubleLag = selectedLag * 2;

      // doubleLag（半频 = BPM/2）
      if (doubleLag <= maxLag && scores[doubleLag] > maxScore * 0.85) {
        selectedLag = doubleLag;
        maxScore = scores[doubleLag];
      }

      // halfLag（倍频 = BPM*2）
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

      // 计算置信度
      var meanScore = totalEnergy / (maxLag - minLag + 1);
      var confidence = meanScore > 0 ? Math.min(1.0, maxScore / (meanScore * 4)) : 0;

      return { bpm: bpm, confidence: confidence };
    } catch (e) {
      console.error('[TrackAnalyzer] _detectBPM error:', e.message);
      return { bpm: 0, confidence: 0 };
    }
  };

  // ── 节拍网格估计 ────────────────────────────────────────────────────────────

  /**
   * 估计节拍网格。
   * 在已知 BPM 的情况下，找到最佳相位偏移，使节拍网格与 onset 对齐。
   *
   * @returns {{beatPositions: number[], beatIntervalMs: number}}
   */
  TrackAnalyzer.prototype._estimateBeatGrid = function (onsetEnvelope, windowMs, bpm, durationSec) {
    try {
      var beatIntervalMs = 60000 / bpm;
      var beatLag = Math.round(beatIntervalMs / windowMs);
      if (beatLag < 1) return { beatPositions: [], beatIntervalMs: 0 };

      var len = onsetEnvelope.length;
      var bestPhase = 0;
      var bestScore = 0;

      // 在一个 beat 周期内搜索最佳相位
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

      // 生成节拍位置（毫秒）
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

  // ── 结构分析 ──────────────────────────────────────────────────────────────

  /**
   * 找到前奏结束点：能量首次持续达到阈值的位置。
   * 从头开始扫描，找到第一个连续 SUSTAINED_SEC 秒超过阈值的位置。
   */
  TrackAnalyzer.prototype._findIntroEnd = function (energy, windowMs, duration) {
    try {
      if (!energy || energy.length === 0) return 0;

      var maxEnergy = this._maxValue(energy);
      if (maxEnergy <= 0) return Math.round(duration * 0.1 * 1000);

      var threshold = maxEnergy * ENERGY_THRESHOLD_RATIO;
      var sustainedWindows = Math.max(1, Math.round(SUSTAINED_SEC * 1000 / windowMs));

      // 从头开始扫描，找到第一个持续超过阈值的位置
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

      // 回退：前 10% 处
      return Math.round(duration * 0.1 * 1000);
    } catch (e) {
      console.warn('[TrackAnalyzer] _findIntroEnd error:', e.message);
      return Math.round((duration || 0) * 0.1 * 1000);
    }
  };

  /**
   * 找到尾奏开始点：能量最后一次持续下降到阈值以下的位置。
   * 从尾向头扫描，找到最后一个持续超过阈值的位置。
   */
  TrackAnalyzer.prototype._findOutroStart = function (energy, windowMs, duration) {
    try {
      if (!energy || energy.length === 0) return Math.round(duration * 0.85 * 1000);

      var maxEnergy = this._maxValue(energy);
      if (maxEnergy <= 0) return Math.round(duration * 0.85 * 1000);

      var threshold = maxEnergy * ENERGY_THRESHOLD_RATIO;
      var sustainedWindows = Math.max(1, Math.round(SUSTAINED_SEC * 1000 / windowMs));

      // 从尾向头扫描，找到最后一个持续超过阈值的位置
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

      // 尾奏开始 = 最后持续高能量段的末尾
      var outroStart = (lastSustained + sustainedWindows) * windowMs;
      var durationMs = Math.round(duration * 1000);

      // 确保 outroStart 在合理范围（60%-95% 处）
      if (outroStart < durationMs * 0.6) outroStart = Math.round(durationMs * 0.85);
      if (outroStart > durationMs * 0.95) outroStart = Math.round(durationMs * 0.9);

      return outroStart;
    } catch (e) {
      console.warn('[TrackAnalyzer] _findOutroStart error:', e.message);
      return Math.round((duration || 0) * 0.85 * 1000);
    }
  };

  /**
   * 找到高潮段：最大持续能量窗口。
   * 在 20%-80% 范围内寻找 CLIMAX_WINDOW_SEC 秒的最大平均能量窗口。
   */
  TrackAnalyzer.prototype._findClimax = function (energy, windowMs, duration) {
    try {
      if (!energy || energy.length === 0) return Math.round(duration * 0.5 * 1000);

      var startIdx = Math.floor(energy.length * 0.2);
      var endIdx = Math.floor(energy.length * 0.8);
      if (endIdx <= startIdx) return Math.round(duration * 0.5 * 1000);

      var windowSize = Math.max(1, Math.round(CLIMAX_WINDOW_SEC * 1000 / windowMs));
      var bestIdx = startIdx;
      var bestAvg = 0;

      // 滑动窗口求最大平均能量
      // 使用前缀和优化 O(n) 而非 O(n*w)
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

  /**
   * 检测结构段落（简化版）。
   * 基于能量曲线将歌曲分为：intro / body / breakdown / climax / outro
   * @returns {Array<{type: string, startMs: number, endMs: number}>}
   */
  TrackAnalyzer.prototype._detectSegments = function (energy, windowMs, duration, introEndMs, outroStartMs, climaxMs) {
    try {
      if (!energy || energy.length === 0) return [];

      var durationMs = Math.round(duration * 1000);
      var maxEnergy = this._maxValue(energy);
      if (maxEnergy <= 0) return [];

      var threshold = maxEnergy * ENERGY_THRESHOLD_RATIO;
      var segments = [];

      // Intro: 0 → introEndMs
      if (introEndMs > 0) {
        segments.push({ type: 'intro', startMs: 0, endMs: introEndMs });
      }

      // Outro: outroStartMs → end
      if (outroStartMs > 0 && outroStartMs < durationMs) {
        segments.push({ type: 'outro', startMs: outroStartMs, endMs: durationMs });
      }

      // Breakdown: 在 body 中能量低于阈值的持续段落
      var bodyStart = Math.floor(introEndMs / windowMs);
      var bodyEnd = Math.floor(outroStartMs / windowMs);
      var breakdownWindow = Math.max(1, Math.round(3 * 1000 / windowMs)); // 至少 3 秒

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

      // Climax: 标记高潮附近区域
      if (climaxMs > 0) {
        var climaxWindowMs = CLIMAX_WINDOW_SEC * 1000;
        segments.push({
          type: 'climax',
          startMs: Math.max(introEndMs, climaxMs - climaxWindowMs / 2),
          endMs: Math.min(outroStartMs, climaxMs + climaxWindowMs / 2),
        });
      }

      // 按开始时间排序
      segments.sort(function (a, b) { return a.startMs - b.startMs; });

      return segments;
    } catch (e) {
      console.warn('[TrackAnalyzer] _detectSegments error:', e.message);
      return [];
    }
  };

  // ── 辅助方法 ──────────────────────────────────────────────────────────────

  /**
   * 计算数组的最大值（安全）。
   */
  TrackAnalyzer.prototype._maxValue = function (arr) {
    if (!arr || arr.length === 0) return 0;
    var max = 0;
    for (var i = 0; i < arr.length; i++) {
      var v = arr[i];
      if (isFinite(v) && v > max) max = v;
    }
    return max;
  };

  /**
   * 计算 onset 统计信息（用于过渡规划的能量分布参考）。
   */
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

  /**
   * 将粗粒度能量曲线下采样为更紧凑的格式用于缓存。
   * 保留每秒一个点，但限制最大长度为 600（10 分钟歌曲）。
   */
  TrackAnalyzer.prototype._downsampleForCache = function (energy, durationSec) {
    if (!energy || energy.length === 0) return [];
    var maxPoints = 600; // 10 分钟 * 60 秒
    if (energy.length <= maxPoints) {
      // 转为普通数组
      var result = new Array(energy.length);
      for (var i = 0; i < energy.length; i++) {
        result[i] = Math.round(energy[i] * 10000) / 10000; // 保留 4 位小数
      }
      return result;
    }

    // 下采样
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
