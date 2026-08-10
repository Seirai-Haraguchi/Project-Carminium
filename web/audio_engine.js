/**
 * AudioEngine — Web Audio API 音频引擎
 *
 * 使用 Web Audio API 进行音频解码、混音和过渡效果处理。
 * 最终混合输出通过 OutputCaptureWorklet 捕获，经 IPC 发送到 miniaudio DLL → WASAPI。
 *
 * 架构：
 *   [AudioBuffer] → Source → Gain ──┐
 *                                    ├──→ OutputCaptureWorklet → IPC → DLL → WASAPI
 *   [FFmpeg PCM] → StreamingWorklet → Gain ─┘
 *
 * 支持双源过渡（crossfade / gapless）：
 *   - Buffer ↔ Buffer：两个 AudioBufferSourceNode + GainNode 自动化
 *   - Buffer → Streaming：延迟 crossfade，等 next FFmpeg PCM 就绪后启动
 *   - Streaming → Streaming：两个 StreamingPCMWorkletNode + GainNode 自动化
 *
 * 功能：
 *   - 本地文件解码（decodeAudioData）
 *   - FFmpeg 流式 PCM 注入（StreamingPCMProcessor）
 *   - 等功率交叉淡化（setValueCurveAtTime）
 *   - 无缝播放（gapless switch）
 *   - 音量控制（GainNode）
 *   - 精确位置跟踪（AudioContext.currentTime + consumedFrames + DLL 延迟补偿）
 *   - AudioBuffer LRU 缓存
 */
(function () {
  'use strict';

  // ── 等功率曲线预计算 ──────────────────────────────────────────────────────

  function computeEqualPowerCurves(length) {
    const fadeOut = new Float32Array(length);
    const fadeIn = new Float32Array(length);
    for (let i = 0; i < length; i++) {
      const progress = i / (length - 1);
      fadeOut[i] = Math.cos(progress * Math.PI / 2);
      fadeIn[i] = Math.sin(progress * Math.PI / 2);
    }
    return { fadeOut, fadeIn };
  }

  // ── AudioEngine ────────────────────────────────────────────────────────────

  class AudioEngine {
    constructor() {
      /** @type {AudioContext} */
      this._ctx = null;
      /** @type {Promise|null} init() 的 Promise，用于并发等待 */
      this._initPromise = null;
      /** @type {AudioWorkletNode} 输出捕获节点（终端） */
      this._outputNode = null;
      /** @type {AnalyserNode|null} 频谱分析节点（旁路，不影响音频流） */
      this._analyser = null;
      /** @type {Uint8Array|null} 频谱数据缓冲 */
      this._freqData = null;

      // ── 音频效果链（EQ / 低音补偿 / 压限器） ──
      /** @type {GainNode|null} 效果输入节点（所有源连接到此） */
      this._effectsInput = null;
      /** @type {BiquadFilterNode[]} 16 段均衡器滤波器 */
      this._eqBands = null;
      /** @type {number[]} EQ 各段增益缓存（-12 到 +12 dB） */
      this._eqBandGains = null;
      /** @type {object|null} 缓存的设置（init 完成后应用） */
      this._settingsCache = null;
      /** @type {boolean} EQ 是否启用 */
      this._eqEnabled = false;
      /** @type {BiquadFilterNode|null} 动态低音补偿（低架滤波器） */
      this._bassBoost = null;
      /** @type {boolean} 低音补偿是否启用 */
      this._bassEnabled = false;
      /** @type {AudioWorkletNode|null} 虚拟低音增强 (VBE) 节点 */
      this._vbeNode = null;
      /** @type {boolean} VBE 是否启用 */
      this._vbeEnabled = false;
      /** @type {object} VBE 参数缓存 */
      this._vbeParams = {
        cutoffFrequency: 90,
        harmGain: 0.35,
        subGain: 0.15,
        bodyGain: 0.18,
        resonGain: 0.25,
        dryGain: 1.0,
        a2: 0.15,
        a3: 0.85,
        transDrive: 2.0,
        resonFreq: 2200,
      };
      /** @type {DynamicsCompressorNode|null} 压限器 */
      this._compressor = null;
      /** @type {boolean} 压限器是否启用 */
      this._compressorEnabled = false;
      /** @type {BiquadFilterNode[]} 人声优化滤波器组 */
      this._vocalFilters = null;
      /** @type {boolean} 人声优化是否启用 */
      this._vocalEnabled = false;
      /** @type {BiquadFilterNode[]} 吉他友好滤波器组 */
      this._guitarFilters = null;
      /** @type {boolean} 吉他友好是否启用 */
      this._guitarEnabled = false;

      // ── 当前曲目：Buffer 模式 ──
      /** @type {AudioBufferSourceNode|null} */
      this._currentSource = null;
      /** @type {GainNode|null} */
      this._currentGain = null;
      /** @type {AudioBuffer|null} */
      this._currentBuffer = null;
      this._currentFilePath = '';
      this._currentDurationMs = 0;
      this._seekOffsetMs = 0;

      // ── 当前曲目：Streaming 模式 ──
      /** @type {AudioWorkletNode|null} 当前曲目的 StreamingPCMWorklet */
      this._currentStreamingNode = null;
      /** @type {GainNode|null} 当前曲目的流式 GainNode */
      this._currentStreamingGain = null;
      /** @type {number} 当前流式曲目已消费帧数（worklet 上报） */
      this._streamingConsumedFrames = 0;
      /** @type {boolean} 当前流式曲目是否已标记结束 */
      this._currentStreamingEnded = false;
      /** @type {ArrayBuffer[]} FFmpeg PCM 缓冲（streaming node 创建前的数据暂存） */
      this._pendingStreamingPcm = [];
      /** @type {boolean} baseline 未送信フラグ(clear 後に初回 PCM 到着時に baseline を送信し、FFmpeg 再起動中の静音フレームを位置から除外) */
      this._streamingBaselinePending = false;

      // ── 下一曲：Buffer 模式 ──
      this._nextSource = null;
      this._nextGain = null;
      this._nextBuffer = null;
      this._nextFilePath = '';
      this._nextDurationMs = 0;

      // ── 下一曲：Streaming 模式 ──
      /** @type {AudioWorkletNode|null} 下一曲的 StreamingPCMWorklet */
      this._nextStreamingNode = null;
      /** @type {GainNode|null} 下一曲的流式 GainNode */
      this._nextStreamingGain = null;
      /** @type {number} 下一曲流式已消费帧数 */
      this._nextStreamingConsumedFrames = 0;
      /** @type {boolean} 下一曲流式是否已标记结束 */
      this._nextStreamingEnded = false;
      /** @type {ArrayBuffer[]} 下一曲 FFmpeg PCM 缓冲（node 创建前暂存） */
      this._pendingNextStreamingPcm = [];
      /** @type {boolean} 下一曲 worklet 是否已收到 PCM（用于 _isNextReady 判断，区分"node 已创建但空"和"node 已有数据"） */
      this._nextStreamingPrimed = false;

      // ── 下一曲模式标志 ──
      /** @type {boolean} 下一曲是否为流式模式（FFmpeg） */
      this._nextIsStreaming = false;

      // ── 播放状态 ──
      this._generation = 0;
      this._isPlaying = false;
      this._isPaused = false;
      /** @type {number} AudioContext.currentTime 对应的起播时刻 */
      this._sourceStartCtxTime = 0;

      // ── 交叉淡化 / 无缝 ──
      this._crossfadeEnabled = false;
      this._crossfadeDurationMs = 5000;
      this._gaplessEnabled = false;
      this._crossfadeTimer = null;
      /** @type {boolean} crossfade 进行中标志（抑制 onStreamEnded） */
      this._crossfadeActive = false;
      /** @type {boolean} 等待 next streaming PCM 到达后启动延迟 crossfade */
      this._pendingBufferToStreamingCrossfade = false;
      /** @type {boolean} 到达过渡触发点但下一曲未就绪，等待就绪后补触发 */
      this._crossfadePending = false;
      /** @type {number} pending 开始的时间戳（ms），用于超时保护 */
      this._crossfadePendingSince = 0;
      /** @type {number} crossfade 期间的调速比率（0 = 无调速，>0 = 实际比率） */
      this._tempoAdjustActive = 0;
      /** @type {number} 用户调节的播放速率（变速变调），1.0 = 原速。仅 Buffer 模式生效 */
      this._userRate = 1.0;

      // ── 预调度无缝切换 ──
      /** @type {AudioBufferSourceNode|null} 预调度的 gapless 下一曲源 */
      this._gaplessScheduledSource = null;
      /** @type {GainNode|null} 预调度的 gapless gain */
      this._gaplessScheduledGain = null;
      /** @type {number} 预调度源的启动时间（AudioContext.currentTime） */
      this._gaplessScheduledEndTime = 0;

      // ── 智能过渡方案 ──
      /** @type {object|null} TransitionPlanner 生成的过渡方案 */
      this._transitionPlan = null;
      /** @type {{fadeOut:Float32Array, fadeIn:Float32Array}|null} 预计算的等功率曲线缓存（setTransitionPlan 时算好，startCrossfade 直接取用，避免主线程顿卡） */
      this._cachedCrossfadeCurves = null;

      // ── 音量 ──
      this._volume = 1.0;

      // ── DLL 延迟补偿 ──
      this._dllBufferLatencyMs = 0;

      // ── 缓存 ──
      this._cache = new window.AudioBufferCache();

      // ── 文件加载（IPC 请求/响应） ──
      /** @type {Map<string, {promise: Promise, resolve: Function, reject: Function, timer: number}>} */
      this._pendingLoads = new Map();

      // ── 回调（由 app.js 注入） ──
      this.onOutput = null;           // (ArrayBuffer) → void
      this.onEnded = null;            // () => void
      this.onPositionTick = null;     // (positionMs) → void
      this.onCrossfadeStart = null;   // () => void
      this.onCrossfadeComplete = null;// (positionMs) → void
      this.onStreamEnded = null;      // () => void  — FFmpeg 流结束
      this.onGaplessSwitch = null;    // () => void  — 无缝切换通知

      // ── 定时器 ──
      this._positionTimer = null;
    }

    // ── 初始化 ──────────────────────────────────────────────────────────────

    async _ensureInit() {
      if (this._initPromise) {
        await this._initPromise;
      } else if (!this._ctx) {
        await this.init();
      }
    }

    async init() {
      if (this._ctx) return;

      this._ctx = new AudioContext({
        sampleRate: 44100,
        latencyHint: 'playback',
      });
      this._initPromise = (async () => {
        const workletBase = 'worklets/';
        await Promise.all([
          this._ctx.audioWorklet.addModule(workletBase + 'output-capture-processor.js'),
          this._ctx.audioWorklet.addModule(workletBase + 'streaming-pcm-processor.js'),
          this._ctx.audioWorklet.addModule(workletBase + 'vbe-processor.js'),
        ]);

        this._outputNode = new AudioWorkletNode(this._ctx, 'output-capture-processor', {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          outputChannelCount: [2],
        });

        // ── 创建音频效果链 ──
        this._effectsInput = this._ctx.createGain();
        // EQ: 16 段均衡器（1/3 倍频程）
        this._eqBands = [];
        this._eqBandGains = new Array(16).fill(0);
        var eqFreqs = [25, 40, 63, 100, 160, 250, 400, 630, 1000, 1600, 2500, 4000, 6300, 10000, 16000, 20000];
        for (var i = 0; i < eqFreqs.length; i++) {
          var filter = this._ctx.createBiquadFilter();
          if (i === 0) filter.type = 'lowshelf';
          else if (i === eqFreqs.length - 1) filter.type = 'highshelf';
          else filter.type = 'peaking';
          filter.frequency.value = eqFreqs[i];
          filter.Q.value = 1.0;
          filter.gain.value = 0; // neutral
          this._eqBands.push(filter);
        }
        // 虚拟低音增强 (VBE)：AudioWorklet 节点 — 心理声学低音增强
        this._vbeNode = new AudioWorkletNode(this._ctx, 'vbe-processor', {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          inputChannelCount: [2],
          outputChannelCount: [2],
        });
        // 动态低音补偿：低架滤波器 @ 80Hz，+6dB 增益
        this._bassBoost = this._ctx.createBiquadFilter();
        this._bassBoost.type = 'lowshelf';
        this._bassBoost.frequency.value = 80;
        this._bassBoost.gain.value = 0; // disabled by default
        // 人声优化：三段滤波器（减间浊 → 提升人声存在感 → 增加空气感）
        this._vocalFilters = [];
        var vocalParams = [
          { type: 'peaking', freq: 300, Q: 1.0, gain: -3 },   // 减间浊
          { type: 'peaking', freq: 3000, Q: 1.2, gain: 3 },  // 人声存在感
          { type: 'highshelf', freq: 8000, Q: 0.7, gain: 2 }, // 空气感
        ];
        for (var i = 0; i < vocalParams.length; i++) {
          var vf = this._ctx.createBiquadFilter();
          vf.type = vocalParams[i].type;
          vf.frequency.value = vocalParams[i].freq;
          vf.Q.value = vocalParams[i].Q;
          vf.gain.value = 0; // disabled
          this._vocalFilters.push(vf);
        }
        // 吉他友好：三段滤波器（提升拨片冲击 → 增强尖锐咬合感 → 高频延展）
        this._guitarFilters = [];
        var guitarParams = [
          { type: 'peaking', freq: 1500, Q: 1.2, gain: 3 },  // 拨片冲击
          { type: 'peaking', freq: 4000, Q: 1.0, gain: 4 },   // 咬合感/尖锐
          { type: 'highshelf', freq: 6000, Q: 0.7, gain: 3 }, // 高频延展
        ];
        for (var i = 0; i < guitarParams.length; i++) {
          var gf = this._ctx.createBiquadFilter();
          gf.type = guitarParams[i].type;
          gf.frequency.value = guitarParams[i].freq;
          gf.Q.value = guitarParams[i].Q;
          gf.gain.value = 0; // disabled
          this._guitarFilters.push(gf);
        }
        // 压限器（用户可控）
        this._compressor = this._ctx.createDynamicsCompressor();
        this._compressor.threshold.value = 0; // disabled
        this._compressor.ratio.value = 1;    // 1:1 = no compression
        this._compressor.attack.value = 0.003;
        this._compressor.release.value = 0.25;
        // 末级限幅器（始终启用，防止数字削波）
        this._limiter = this._ctx.createDynamicsCompressor();
        this._limiter.threshold.value = -1;   // -1dB 阈值
        this._limiter.ratio.value = 20;        // 20:1 硬限制
        this._limiter.attack.value = 0.001;   // 1ms 快速响应
        this._limiter.release.value = 0.05;   // 50ms 快速释放
        this._limiter.knee.value = 0;         // 硬拐点
        // 连接效果链: effectsInput → EQ[0-15] → VBE → bassBoost → vocal → guitar → compressor → limiter → outputNode
        var prev = this._effectsInput;
        for (var i = 0; i < this._eqBands.length; i++) {
          prev.connect(this._eqBands[i]);
          prev = this._eqBands[i];
        }
        prev.connect(this._vbeNode);
        prev = this._vbeNode;
        prev.connect(this._bassBoost);
        prev = this._bassBoost;
        for (var i = 0; i < this._vocalFilters.length; i++) {
          prev.connect(this._vocalFilters[i]);
          prev = this._vocalFilters[i];
        }
        for (var i = 0; i < this._guitarFilters.length; i++) {
          prev.connect(this._guitarFilters[i]);
          prev = this._guitarFilters[i];
        }
        prev.connect(this._compressor);
        this._compressor.connect(this._limiter);
        this._limiter.connect(this._outputNode);

        // 必须连接到 destination，否则 Web Audio 渲染引擎不会处理整个音频图，
        // OutputCaptureWorklet.process() 不会被调用，DLL 收不到任何 PCM 数据。
        // worklet 内部输出静音，实际音频由 DLL → WASAPI 负责。
        this._outputNode.connect(this._ctx.destination);

        // ── 频谱分析旁路 ──
        // 从 limiter 旁路连接到 AnalyserNode，用于全窗口视图的背景鼓点流动效果。
        // AnalyserNode 是 dead-end 节点，必须连接到 destination 才会被浏览器处理。
        // 通过零增益 GainNode 连接，确保不产生声音输出。
        this._analyser = this._ctx.createAnalyser();
        this._analyser.fftSize = 512;        // 256 bins，覆盖低频鼓点
        this._analyser.smoothingTimeConstant = 0.6;  // 适度平滑
        this._freqData = new Uint8Array(this._analyser.frequencyBinCount);
        this._limiter.connect(this._analyser);
        // 零增益连接到 destination，保持 AnalyserNode 活跃
        var analyserSink = this._ctx.createGain();
        analyserSink.gain.value = 0;
        this._analyser.connect(analyserSink);
        analyserSink.connect(this._ctx.destination);

        this._outputNode.port.onmessage = (e) => {
          if (this.onOutput) this.onOutput(e.data);
        };

        // 如果设置已缓存（init 前由设置页或 app.js 预存），立即应用
        if (this._settingsCache) {
          this.applyAudioSettings(this._settingsCache);
        }

        console.log('[AudioEngine] Initialized, sampleRate:', this._ctx.sampleRate);
        return { sampleRate: this._ctx.sampleRate, channels: 2 };
      })();

      return this._initPromise;
    }

    // ── Streaming Node 管理 ──────────────────────────────────────────────────

    /**
     * 确保当前曲目的 StreamingPCMWorklet 已创建。
     * 仅在 FFmpeg 回退路径使用。
     */
    _ensureCurrentStreamingNode() {
      if (this._currentStreamingNode) return;

      this._currentStreamingNode = this._createStreamingWorkletNode('current');
      this._currentStreamingGain = this._ctx.createGain();
      this._currentStreamingGain.gain.value = this._volume;
      this._currentStreamingNode.connect(this._currentStreamingGain);
      this._currentStreamingGain.connect(this._effectsInput || this._outputNode);
    }

    /**
     * 确保下一曲的 StreamingPCMWorklet 已创建。
     * 用于过渡期间的双源流式播放。
     * @param {object} [opts] - { paused: boolean } 是否以预缓冲模式创建（暂停消费，仅累积 PCM）
     */
    _ensureNextStreamingNode(opts) {
      if (this._nextStreamingNode) return;
      opts = opts || {};

      this._nextStreamingNode = this._createStreamingWorkletNode('next');
      this._nextStreamingGain = this._ctx.createGain();
      this._nextStreamingGain.gain.value = 0; // 初始静音，由 crossfade 自动化控制
      this._nextStreamingNode.connect(this._nextStreamingGain);
      this._nextStreamingGain.connect(this._effectsInput || this._outputNode);

      // 预缓冲模式：暂停消费，让 PCM 在 ring buffer 累积
      // crossfade 启动时 _resumeNextStreamingWorklet() 解除暂停
      if (opts.paused) {
        try { this._nextStreamingNode.port.postMessage({ type: 'pause' }); } catch (_) {}
      }

      // 刷入缓冲的 PCM 数据
      // 关键：在创建 node 之前发送 baseline，使 worklet 记录当前 consumedFrames 为基线
      // 这样 position 报告从 0 开始，不包含 node 创建前的静音帧
      if (this._pendingNextStreamingPcm.length > 0) {
        this._nextStreamingNode.port.postMessage({ type: 'baseline' });
        for (var i = 0; i < this._pendingNextStreamingPcm.length; i++) {
          this._nextStreamingNode.port.postMessage(
            { type: 'pcm', samples: this._pendingNextStreamingPcm[i] },
            [this._pendingNextStreamingPcm[i]]
          );
        }
        this._pendingNextStreamingPcm = [];
        this._nextStreamingPrimed = true;
      }
    }

    /**
     * 解除 next streaming worklet 的暂停状态，开始正常消费。
     * 在 crossfade 启动时调用，确保 worklet 已有预缓冲数据可消费。
     */
    _resumeNextStreamingWorklet() {
      if (this._nextStreamingNode) {
        try { this._nextStreamingNode.port.postMessage({ type: 'resume' }); } catch (_) {}
      }
    }

    /**
     * 创建 StreamingPCMWorklet 节点并绑定消息处理。
     * @param {'current'|'next'} role - 节点角色
     * @returns {AudioWorkletNode}
     */
    _createStreamingWorkletNode(role) {
      var node = new AudioWorkletNode(this._ctx, 'streaming-pcm-processor', {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [2],
      });

      var self = this;
      node.port.onmessage = function (e) {
        var data = e.data;
        if (role === 'current') {
          if (data.type === 'ended') {
            self._currentStreamingEnded = true;
            // 过渡已将本节点提升为 next→current：旧节点残留的 ended 直接忽略，
            // 否则会触发主进程重复推进队列，破坏循环/列表循环（跳曲）。
            if (node !== self._currentStreamingNode) return;
            // crossfade 期间不触发 onStreamEnded（由 _finishTransition 处理）
            if (!self._crossfadeActive && self.onStreamEnded) {
              self.onStreamEnded();
            }
          }
          if (data.type === 'position') {
            self._streamingConsumedFrames = data.consumedFrames;
          }
          // 背压：worklet buffer 水位过高/过低时控制 FFmpeg stdout 暂停/恢复
          if (data.type === 'flow_pause' || data.type === 'flow_resume') {
            if (window.__electronAPI) {
              window.__electronAPI.invoke('ffmpeg_flow_control', {
                channel: 'main', pause: data.type === 'flow_pause'
              });
            }
          }
        } else { // 'next'
          if (data.type === 'ended') {
            self._nextStreamingEnded = true;
          }
          if (data.type === 'position') {
            self._nextStreamingConsumedFrames = data.consumedFrames;
          }
          // 背压：next worklet 的 buffer 水位控制
          if (data.type === 'flow_pause' || data.type === 'flow_resume') {
            if (window.__electronAPI) {
              window.__electronAPI.invoke('ffmpeg_flow_control', {
                channel: 'next', pause: data.type === 'flow_pause'
              });
            }
          }
        }
      };

      return node;
    }

    /**
     * 停止并断开 streaming 节点。
     */
    _disposeStreamingNode(node, gain) {
      if (node) {
        try { node.port.postMessage({ type: 'clear' }); } catch (_) {}
        try { node.disconnect(); } catch (_) {}
      }
      if (gain) {
        try { gain.disconnect(); } catch (_) {}
      }
    }

    // ── 播放 ────────────────────────────────────────────────────────────────

    /**
     * 处理 'play' audio_control 动作。
     * HTTP URL → 等待 playStreaming()；本地文件 → decodeAudioData → playBuffer。
     *
     * @param {string} filePath
     * @param {number} durationMs
     * @param {number} seekOffsetMs - 开始位置(ms), buffer 模式直接传给 source.start
     * @param {boolean} [startPaused] - true 时加载但不播放(暂停状态), 用于模式切替中の暂停トラック
     */
    async playCurrent(filePath, durationMs, seekOffsetMs, startPaused) {
      await this._ensureInit();
      const savedPcm = this._pendingStreamingPcm;
      this.stop();
      this._pendingStreamingPcm = savedPcm;

      const gen = ++this._generation;
      this._currentFilePath = filePath;
      this._currentDurationMs = durationMs;
      this._seekOffsetMs = seekOffsetMs || 0;

      // HTTP URL 不走浏览器解码路径
      if (filePath.startsWith('http://') || filePath.startsWith('https://')) {
        return;
      }

      // 尝试缓存
      const cached = this._cache.get(filePath);
      if (cached) {
        this._currentBuffer = cached;
        this._isPlaying = true;            // ロード完了 = 再生準備完了
        this._isPaused = !!startPaused;    // 一時停止フラグ
        this._createAndStartSource(cached, seekOffsetMs || 0, gen, true);
        if (startPaused) {
          // コンテキストをサスペンド → ソースは開始済みだが出力されない
          // resume() で _isPaused=false になり再生再開
          if (this._ctx) this._ctx.suspend();
        } else {
          this._startPositionTimer();
          this._resumeContext();
        }
        // 新曲开始后，如果下一曲 buffer 已预加载，调度 gapless
        this._scheduleGaplessSwitch();
        return;
      }

      // 异步加载并解码
      try {
        const audioBuffer = await this._loadAndDecode(filePath);
        if (this._generation !== gen) return;

        this._currentBuffer = audioBuffer;
        this._cache.set(filePath, audioBuffer);
        this._isPlaying = true;            // ロード完了
        this._isPaused = !!startPaused;    // 一時停止フラグ
        this._createAndStartSource(audioBuffer, seekOffsetMs || 0, gen, true);
        if (startPaused) {
          if (this._ctx) this._ctx.suspend();
        } else {
          this._startPositionTimer();
          this._resumeContext();
        }
        // 新曲开始后，如果下一曲 buffer 已预加载，调度 gapless
        this._scheduleGaplessSwitch();
      } catch (e) {
        if (this._generation !== gen) return;
        console.error('[AudioEngine] playCurrent: load/decode failed:', filePath, e);
        this._isPlaying = false;
        if (this.onEnded) this.onEnded();
      }
    }

    /**
     * 通过 FFmpeg 流式 PCM 播放。
     * 用于浏览器无法解码的格式（WMA、APE 等）和 HTTP 流媒体。
     *
     * @param {number} durationMs
     * @param {number} seekOffsetMs - 开始位置(ms)
     * @param {boolean} [startPaused] - true 时ストリーミングノードを準備するが再生しない(暂停状態)
     */
    async playStreaming(durationMs, seekOffsetMs, startPaused) {
      await this._ensureInit();
      const savedPcm = this._pendingStreamingPcm;
      this.stop();
      // seekOffsetMs > 0 の場合、保留中の PCM は別位置(古い)のものなので破棄
      // 例: モード切替時に playFile() が位置 0 で FFmpeg を起動し、
      // その後 renderer.seek(savedPosition) で再起動するまでの間に
      // 産出された位置 0 の PCM が _pendingStreamingPcm に蓄積されている。
      // これをそのまま worklet に流すと、UI 進捗(seekOffsetMs + consumedFrames)
      // が実際の再生位置(0 + consumedFrames)より先に進んでしまう。
      if (seekOffsetMs > 0) {
        this._pendingStreamingPcm = [];
      } else {
        this._pendingStreamingPcm = savedPcm;
      }
      const gen = ++this._generation;

      this._currentDurationMs = durationMs;
      this._seekOffsetMs = seekOffsetMs || 0;

      this._ensureCurrentStreamingNode();
      this._currentStreamingNode.port.postMessage({ type: 'clear' });
      this._streamingConsumedFrames = 0;
      this._currentStreamingEnded = false;

      // 刷入缓冲的 PCM 数据
      if (this._pendingStreamingPcm.length > 0) {
        // 先发 baseline，捕获 clear 后到 PCM 到达前的静音帧
        // 这样 worklet 上报的位置会从真实音频开始，不包含静音帧
        this._currentStreamingNode.port.postMessage({ type: 'baseline' });
        this._streamingBaselinePending = false;
        for (var i = 0; i < this._pendingStreamingPcm.length; i++) {
          this._currentStreamingNode.port.postMessage(
            { type: 'pcm', samples: this._pendingStreamingPcm[i] },
            [this._pendingStreamingPcm[i]]
          );
        }
        this._pendingStreamingPcm = [];
      } else {
        // 保留中の PCM がない場合(シーク後等)、初回 PCM 到着時に
        // baseline を送信するようフラグを立てる
        // これにより FFmpeg 再起動中の静音フレームが位置に反映されない
        this._streamingBaselinePending = true;
      }

      this._isPlaying = true;            // ストリーミング準備完了
      this._isPaused = !!startPaused;    // 一時停止フラグ
      this._sourceStartCtxTime = this._ctx.currentTime;
      if (startPaused) {
        // コンテキストをサスペンド → worklet の process() が停止し
        // _streamingConsumedFrames が進まない = 位置が正しく固定される
        // resume() で再生再開
        if (this._ctx) this._ctx.suspend();
      } else {
        this._resumeContext();
        this._startPositionTimer();
      }
    }

    // ── 内部：创建并启动 AudioBufferSourceNode ──

    _createAndStartSource(buffer, offsetMs, generation, isMain) {
      const source = new AudioBufferSourceNode(this._ctx, { buffer: buffer });
      const gain = this._ctx.createGain();
      gain.gain.value = this._volume;

      source.connect(gain);
      gain.connect(this._effectsInput || this._outputNode);

      const offsetSec = (offsetMs || 0) / 1000;
      source.start(0, offsetSec);

      // 用户调节的播放速率（变速变调）
      if (this._userRate !== 1.0) {
        source.playbackRate.value = this._userRate;
      }

      if (isMain) {
        this._currentSource = source;
        this._currentGain = gain;
        this._sourceStartCtxTime = this._ctx.currentTime;
      }

      source.onended = () => {
        if (this._generation !== generation) return;
        if (isMain) {
          if (this._currentSource !== source) return;
          // 交叉淡化进行中：过渡会接管推进，忽略旧源的自然结束，避免重复推进队列
          if (this._crossfadeActive) return;
          // 预调度 gapless：下一曲源已在播放，直接提升
          if (this._gaplessScheduledSource) {
            this._promoteGaplessScheduled();
          } else {
            this._isPlaying = false;
            if (this.onEnded) this.onEnded();
          }
        }
      };

      return { source, gain };
    }

    /**
     * 设置用户调节的播放速率（变速变调）。
     * 立即应用到当前播放的 Buffer source；切歌时通过 _createAndStartSource 继承。
     * Streaming 模式（AudioWorkletNode）不支持 playbackRate，仅记录状态。
     * @param {number} rate 0.5 ~ 2.0，1.0 = 原速
     */
    setUserRate(rate) {
      rate = Math.max(0.5, Math.min(2.0, parseFloat(rate) || 1.0));
      if (this._ctx && this._currentSource && this._currentSource.playbackRate) {
        // 变速前用旧 rate 快照当前真实位置，重新校准基准，避免积分误差
        var oldRate = this._currentSource.playbackRate.value;
        var elapsedSec = this._ctx.currentTime - this._sourceStartCtxTime;
        this._seekOffsetMs += elapsedSec * 1000 * oldRate;
        this._sourceStartCtxTime = this._ctx.currentTime;
        var pr = this._currentSource.playbackRate;
        pr.cancelScheduledValues(this._ctx.currentTime);
        pr.setValueAtTime(rate, this._ctx.currentTime);
        // 立即上报校准后的位置，让 UI 同步而非等下一个 250ms tick
        if (this.onPositionTick) this.onPositionTick(this.getCurrentPositionMs());
      }
      this._userRate = rate;
    }

    /** @returns {number} 当前用户播放速率 */
    get userRate() { return this._userRate; }

    // ── 停止 / 暂停 / 恢复 ──────────────────────────────────────────────────

    stop() {
      this._stopCrossfadeTimer();
      this._stopPositionTimer();

      // Buffer 源
      this._safeStopSource(this._currentSource);
      this._safeStopSource(this._nextSource);
      this._safeDisconnect(this._currentGain);
      this._safeDisconnect(this._nextGain);

      // Streaming 源
      this._disposeStreamingNode(this._currentStreamingNode, this._currentStreamingGain);
      this._disposeStreamingNode(this._nextStreamingNode, this._nextStreamingGain);

      // VBE DSP 状态重置
      if (this._vbeNode) this._vbeNode.port.postMessage({ type: 'reset' });

      this._pendingStreamingPcm = [];
      this._pendingNextStreamingPcm = [];
      this._nextStreamingPrimed = false;

      // 重置当前曲状态
      this._currentSource = null;
      this._currentGain = null;
      this._currentBuffer = null;
      this._currentFilePath = '';
      this._currentDurationMs = 0;
      this._seekOffsetMs = 0;
      this._streamingConsumedFrames = 0;
      this._currentStreamingEnded = false;
      this._streamingBaselinePending = false;
      this._currentStreamingNode = null;
      this._currentStreamingGain = null;

      // 重置 next 源节点（停止正在播放的 crossfade 源）
      // 但保留 _nextBuffer / _nextFilePath / _nextDurationMs / _nextIsStreaming
      // 这些是预加载数据，不应被 stop() 清除。
      // next 状态的清除由 clearNextState() 显式执行（主进程通过 audio_control: clear_next 调用）。
      this._nextSource = null;
      this._nextGain = null;
      this._nextStreamingNode = null;
      this._nextStreamingGain = null;
      this._nextStreamingConsumedFrames = 0;
      this._nextStreamingEnded = false;
      this._pendingNextStreamingPcm = [];
      this._nextStreamingPrimed = false;

      // Crossfade 状态重置
      this._crossfadeActive = false;
      this._pendingBufferToStreamingCrossfade = false;
      this._crossfadePending = false;
      this._crossfadePendingSince = 0;
      this._tempoAdjustActive = 0;
      this._cancelGaplessSchedule();
      // _transitionPlan 由 setTransitionPlan() / clearNextState() 管理
      // _nextIsStreaming 是 next 曲目的模式标志，由 setNextInfo() 设置

      this._isPlaying = false;
      this._isPaused = false;
    }

    pause() {
      if (this._isPlaying && !this._isPaused && this._ctx) {
        this._ctx.suspend();
        this._isPaused = true;
        this._stopPositionTimer();
      }
    }

    resume() {
      if (this._isPlaying && this._isPaused && this._ctx) {
        this._ctx.resume();
        this._isPaused = false;
        this._startPositionTimer();
      }
    }

    /**
     * 跳转到指定位置。
     * 取消进行中的 crossfade，重新创建当前源。
     */
    async seek(positionMs) {
      await this._ensureInit();

      // 取消进行中的 crossfade
      this._stopCrossfadeTimer();
      this._crossfadeActive = false;
      this._pendingBufferToStreamingCrossfade = false;
      this._crossfadePending = false;
      this._crossfadePendingSince = 0;
      this._tempoAdjustActive = 0;
      this._cancelGaplessSchedule();

      // 停止 crossfade 用的 next 源节点（如果正在播放）
      // 但不清除 _nextBuffer / _nextFilePath / _nextDurationMs / _nextIsStreaming
      // seek 是在当前曲内跳转，不影响下一曲的预加载数据。
      this._safeStopSource(this._nextSource);
      this._safeDisconnect(this._nextGain);
      this._nextSource = null;
      this._nextGain = null;
      this._disposeStreamingNode(this._nextStreamingNode, this._nextStreamingGain);
      this._nextStreamingNode = null;
      this._nextStreamingGain = null;
      this._nextStreamingConsumedFrames = 0;
      this._nextStreamingEnded = false;
      this._pendingNextStreamingPcm = [];
      this._nextStreamingPrimed = false;

      // ── Streaming 模式 ──
      if (!this._currentBuffer && this._currentStreamingNode) {
        this._currentStreamingNode.port.postMessage({ type: 'clear' });
        // VBE DSP 状态重置（防止 seek 后的瞬态伪影）
        if (this._vbeNode) this._vbeNode.port.postMessage({ type: 'reset' });
        this._seekOffsetMs = positionMs;
        this._streamingConsumedFrames = 0;
        this._sourceStartCtxTime = this._ctx.currentTime;
        this._currentStreamingEnded = false;
        // FFmpeg 再起動中に消費される静音フレームを位置から除外するため、
        // 初回 PCM 到着時に baseline を送信するようフラグを立てる
        this._streamingBaselinePending = true;
        this._stopPositionTimer();
        return;
      }

      // ── Buffer 模式 ──
      // _currentBuffer 为 null 时（如 Streaming 曲目未正确初始化），不可 seek
      if (!this._currentBuffer) {
        return;
      }

      const wasPlaying = this._isPlaying && !this._isPaused;

      this._safeStopSource(this._currentSource);
      this._safeDisconnect(this._currentGain);
      this._currentSource = null;
      this._currentGain = null;

      // VBE DSP 状态重置（防止 seek 后的瞬态伪影）
      if (this._vbeNode) this._vbeNode.port.postMessage({ type: 'reset' });

      this._seekOffsetMs = positionMs;
      const gen = ++this._generation;
      this._createAndStartSource(this._currentBuffer, positionMs, gen, true);

      if (wasPlaying) {
        this._resumeContext();
        this._startPositionTimer();
      }

      // seek 后重新调度 gapless（下一曲 buffer 可能已预加载）
      this._scheduleGaplessSwitch();
    }

    // ── 音量 ────────────────────────────────────────────────────────────────

    setVolume(level) {
      this._volume = Math.max(0, Math.min(1, level));
      if (this._currentGain) {
        this._currentGain.gain.value = this._volume;
      }
      if (this._currentStreamingGain && !this._crossfadeActive) {
        this._currentStreamingGain.gain.value = this._volume;
      }
    }

    // ── 次曲信息 ────────────────────────────────────────────────────────────

    /**
     * 准备下一曲信息。
     * Buffer 格式：尝试预加载解码为 AudioBuffer（除非 forceStreaming）。
     * Streaming 格式（HTTP URL 或 forceStreaming）：标记 _nextIsStreaming，等待 FFmpeg PCM。
     * @param {string} filePath
     * @param {number} durationMs
     * @param {boolean} [forceStreaming=false] - 强制使用流式路径（当前曲目为 streaming 时）
     */
    async setNextInfo(filePath, durationMs, forceStreaming) {
      this._nextFilePath = filePath;
      this._nextDurationMs = durationMs;

      // 判断下一曲是否为流式模式
      this._nextIsStreaming = forceStreaming ||
        filePath.startsWith('http://') || filePath.startsWith('https://');

      if (this._nextIsStreaming) {
        // Streaming 格式不预加载解码，等待 FFmpeg PCM 通过 pushNextPcm 到达
        console.log('[AudioEngine] setNextInfo: streaming mode, skip buffer load:', filePath);
        // 提前创建 next streaming worklet（paused 预缓冲模式）
        // FFmpeg PCM 到达后直接进入 worklet ring buffer 累积，不消费，
        // crossfade 启动时 resume → 有充足 buffer → 无 initial underrun stutter
        if (this._ctx) {
          try {
            this._ensureNextStreamingNode({ paused: true });
          } catch (e) {
            console.warn('[AudioEngine] setNextInfo: early worklet create failed:', e.message);
          }
        }
        return;
      }

      // Buffer 格式：尝试缓存
      const cached = this._cache.get(filePath);
      if (cached) {
        this._nextBuffer = cached;
        console.log('[AudioEngine] Next buffer from cache:', filePath);
        // 预调度 gapless
        this._scheduleGaplessSwitch();
        // 如果 crossfade 已到达触发点但下一曲未就绪，现在补触发
        this._checkCrossfadeTrigger();
        return;
      }

      // 异步加载（含一次重试）
      var lastErr = null;
      for (var attempt = 0; attempt < 2; attempt++) {
        try {
          const buf = await this._loadAndDecode(filePath);
          if (this._nextFilePath !== filePath) {
            console.log('[AudioEngine] Next file changed during load, discarding:', filePath);
            return;
          }
          this._nextBuffer = buf;
          // 缓存解码结果，避免后续重复加载
          this._cache.set(filePath, buf);
          console.log('[AudioEngine] Next buffer loaded (attempt ' + (attempt + 1) + '):', filePath,
            'duration=' + (buf ? buf.duration.toFixed(1) + 's' : 'null'));
          // 预调度 gapless
          this._scheduleGaplessSwitch();
          // 补触发：如果 crossfade pending，现在下一曲就绪了
          this._checkCrossfadeTrigger();
          return;
        } catch (e) {
          lastErr = e;
          console.error('[AudioEngine] Next buffer load failed (attempt ' + (attempt + 1) + '):',
            filePath, e.message || e);
          if (attempt === 0) {
            // 等待 2 秒后重试
            await new Promise(function (r) { setTimeout(r, 2000); });
            // 重试前再次检查 nextFilePath 是否已变更
            if (this._nextFilePath !== filePath) {
              console.log('[AudioEngine] Next file changed during retry wait, aborting:', filePath);
              return;
            }
          }
        }
      }

      // 两次加载均失败
      console.error('[AudioEngine] Next buffer load gave up after retries:', filePath,
        lastErr ? lastErr.message : 'unknown error');
      // 补触发检查：_isNextReady 会返回 false，pending 超时逻辑会处理
      this._checkCrossfadeTrigger();
    }

    // ── 交叉淡化 ────────────────────────────────────────────────────────────

    /**
     * 开始交叉淡化。
     * 根据当前/下一曲的模式分发到对应的实现。
     */
    startCrossfade() {
      var currentIsBuffer = !!this._currentBuffer;
      var nextIsBuffer = !!this._nextBuffer;
      var nextIsStreaming = this._nextIsStreaming || this._nextStreamingNode != null;

      if (currentIsBuffer && nextIsBuffer && !nextIsStreaming) {
        this._startBufferCrossfade();
      } else if (currentIsBuffer && nextIsStreaming) {
        // Buffer → Streaming：worklet 已提前创建并预缓冲（primed）→ 直接启动
        // 否则延迟等首块 PCM 到达后再启动（_pendingBufferToStreamingCrossfade）
        if (this._nextStreamingPrimed) {
          this._startBufferToStreamingCrossfade();
        } else {
          this._pendingBufferToStreamingCrossfade = true;
          console.log('[AudioEngine] Deferred crossfade: waiting for next streaming PCM');
          if (this.onCrossfadeStart) this.onCrossfadeStart();
        }
      } else if (!currentIsBuffer && nextIsStreaming) {
        this._startStreamingCrossfade();
      } else if (!currentIsBuffer && nextIsBuffer && !nextIsStreaming) {
        // Streaming → Buffer crossfade
        this._startStreamingToBufferCrossfade();
      } else {
        console.warn('[AudioEngine] startCrossfade: unsupported mode combination',
          'currentBuffer:', currentIsBuffer, 'nextBuffer:', nextIsBuffer,
          'nextStreaming:', nextIsStreaming);
      }
    }

    /**
     * Streaming → Buffer crossfade。
     * 当前曲是流式（FFmpeg），下一曲是 buffer（浏览器解码）。
     * 停止当前流式源，用 buffer 源的 fade-in 替代。
     */
    _startStreamingToBufferCrossfade() {
      if (!this._nextBuffer) {
        console.warn('[AudioEngine] _startStreamingToBufferCrossfade: no next buffer');
        return;
      }

      const cfMs = this._getEffectiveCrossfadeMs();
      const cfSec = cfMs / 1000;
      const cfFrames = Math.round(cfSec * this._ctx.sampleRate);
      if (cfFrames <= 0) return;

      this._crossfadeActive = true;

      // 当前 streaming gain fade out
      const now = this._ctx.currentTime;
      var curves = this._getCrossfadeCurves(cfFrames);
      var fadeOut = curves.fadeOut;
      var fadeIn = curves.fadeIn;
      if (this._currentStreamingGain) {
        this._currentStreamingGain.gain.setValueCurveAtTime(fadeOut, now, cfSec);
      }

      // 下一曲 buffer 源 fade in
      var nextSrc = new AudioBufferSourceNode(this._ctx, { buffer: this._nextBuffer });
      var nextGain = this._ctx.createGain();
      nextGain.gain.value = 0;
      nextSrc.connect(nextGain);
      nextGain.connect(this._effectsInput || this._outputNode);

      // 智能过渡：从分析得出的起始偏移开始播放下一曲
      var nextOffsetSec = 0;
      if (this._transitionPlan && this._transitionPlan.nextStartOffsetMs > 0) {
        nextOffsetSec = Math.min(
          this._transitionPlan.nextStartOffsetMs / 1000,
          this._nextBuffer.duration - 0.1
        );
      }

      // 智能调速：crossfade 期间以调速播放，过渡完成后线性渐回原速
      var tempoAdjust = this._getTempoAdjust();
      if (tempoAdjust !== 1.0) {
        nextSrc.playbackRate.value = tempoAdjust;
        this._tempoAdjustActive = tempoAdjust;
        console.log('[AudioEngine] Tempo adjust (crossfade):', tempoAdjust.toFixed(4),
          '(cur=' + (this._transitionPlan ? this._transitionPlan.bpmCurrent : '?') +
          ' next=' + (this._transitionPlan ? this._transitionPlan.bpmNext : '?') + ')');
      } else {
        this._tempoAdjustActive = 0;
      }

      nextSrc.start(0, nextOffsetSec);
      nextGain.gain.setValueCurveAtTime(fadeIn, now, cfSec);

      this._nextSource = nextSrc;
      this._nextGain = nextGain;

      console.log('[AudioEngine] Streaming→Buffer crossfade start:', cfMs, 'ms');
      if (this.onCrossfadeStart) this.onCrossfadeStart();

      this._crossfadeTimer = setTimeout(() => {
        this._finishTransition();
      }, cfMs + 50);
    }

    /**
     * Buffer → Buffer crossfade。
     * 两个 AudioBufferSourceNode + 等功率 GainNode 自动化。
     */
    _startBufferCrossfade() {
      if (!this._currentSource || !this._currentGain || !this._nextBuffer) {
        console.warn('[AudioEngine] _startBufferCrossfade: missing source or buffer');
        return;
      }

      const cfMs = this._getEffectiveCrossfadeMs();
      const cfSec = cfMs / 1000;
      const cfFrames = Math.round(cfSec * this._ctx.sampleRate);
      if (cfFrames <= 0) return;

      this._crossfadeActive = true;

      var curves = this._getCrossfadeCurves(cfFrames);
      var fadeOut = curves.fadeOut;
      var fadeIn = curves.fadeIn;

      const nextSrc = new AudioBufferSourceNode(this._ctx, { buffer: this._nextBuffer });
      const nextGain = this._ctx.createGain();
      nextGain.gain.value = 0;
      nextSrc.connect(nextGain);
      nextGain.connect(this._effectsInput || this._outputNode);

      // 智能过渡：从分析得出的起始偏移开始播放下一曲
      var nextOffsetSec = 0;
      if (this._transitionPlan && this._transitionPlan.nextStartOffsetMs > 0) {
        nextOffsetSec = Math.min(
          this._transitionPlan.nextStartOffsetMs / 1000,
          this._nextBuffer.duration - 0.1
        );
      }

      // 智能调速：crossfade 期间以调速播放，过渡完成后线性渐回原速
      var tempoAdjust = this._getTempoAdjust();
      if (tempoAdjust !== 1.0) {
        nextSrc.playbackRate.value = tempoAdjust;
        this._tempoAdjustActive = tempoAdjust;
        console.log('[AudioEngine] Tempo adjust (crossfade):', tempoAdjust.toFixed(4),
          '(cur=' + (this._transitionPlan ? this._transitionPlan.bpmCurrent : '?') +
          ' next=' + (this._transitionPlan ? this._transitionPlan.bpmNext : '?') + ')');
      } else {
        this._tempoAdjustActive = 0;
      }

      nextSrc.start(0, nextOffsetSec);

      this._nextSource = nextSrc;
      this._nextGain = nextGain;

      const now = this._ctx.currentTime;
      this._currentGain.gain.setValueCurveAtTime(fadeOut, now, cfSec);
      nextGain.gain.setValueCurveAtTime(fadeIn, now, cfSec);

      console.log('[AudioEngine] Buffer crossfade start:', cfMs, 'ms');
      if (this.onCrossfadeStart) this.onCrossfadeStart();

      this._crossfadeTimer = setTimeout(() => {
        this._finishTransition();
      }, cfMs + 50);
    }

    /**
     * Streaming → Streaming crossfade。
     * 两个 StreamingPCMWorkletNode + 等功率 GainNode 自动化。
     */
    _startStreamingCrossfade() {
      if (!this._currentStreamingNode) {
        console.warn('[AudioEngine] _startStreamingCrossfade: no current streaming node');
        return;
      }

      // 确保 next streaming node 已创建
      this._ensureNextStreamingNode();
      if (!this._nextStreamingNode) {
        console.warn('[AudioEngine] _startStreamingCrossfade: cannot create next streaming node');
        return;
      }

      const cfMs = this._getEffectiveCrossfadeMs();
      const cfSec = cfMs / 1000;
      const cfFrames = Math.round(cfSec * this._ctx.sampleRate);
      if (cfFrames <= 0) return;

      this._crossfadeActive = true;

      // 解除 next worklet 暂停（如果由 setNextInfo 提前创建并 paused 预缓冲）
      this._resumeNextStreamingWorklet();

      var curves = this._getCrossfadeCurves(cfFrames);
      var fadeOut = curves.fadeOut;
      var fadeIn = curves.fadeIn;

      // 当前曲目 gain fade out
      const now = this._ctx.currentTime;
      if (this._currentStreamingGain) {
        this._currentStreamingGain.gain.setValueCurveAtTime(fadeOut, now, cfSec);
      }
      // 下一曲 gain fade in（从 0 开始）
      this._nextStreamingGain.gain.setValueCurveAtTime(fadeIn, now, cfSec);

      console.log('[AudioEngine] Streaming crossfade start:', cfMs, 'ms');
      if (this.onCrossfadeStart) this.onCrossfadeStart();

      this._crossfadeTimer = setTimeout(() => {
        this._finishTransition();
      }, cfMs + 50);
    }

    /**
     * 从延迟 crossfade 状态启动实际的 streaming crossfade。
     * 当 pushNextPcm 收到第一块数据且 _pendingBufferToStreamingCrossfade 为 true 时调用。
     * 也由 startCrossfade 在 nextStreamingPrimed 时直接调用。
     */
    _startBufferToStreamingCrossfade() {
      this._pendingBufferToStreamingCrossfade = false;

      // 确保 next streaming node 存在（可能已由 setNextInfo 提前创建并 paused 预缓冲）
      this._ensureNextStreamingNode();

      const cfMs = this._getEffectiveCrossfadeMs();
      const cfSec = cfMs / 1000;
      const cfFrames = Math.round(cfSec * this._ctx.sampleRate);
      if (cfFrames <= 0) {
        this._finishTransition();
        return;
      }

      this._crossfadeActive = true;

      // 解除 next worklet 暂停，开始消费预缓冲的 PCM
      this._resumeNextStreamingWorklet();

      var curves = this._getCrossfadeCurves(cfFrames);
      var fadeOut = curves.fadeOut;
      var fadeIn = curves.fadeIn;

      const now = this._ctx.currentTime;

      // 当前 buffer source fade out（不是硬切！）
      // 保留 _currentSource / _currentGain / _currentBuffer 不变，
      // 让 _finishTransition 在 crossfade 结束后统一清理。
      // 这样当前曲在 crossfade 期间继续播放并淡出，掩盖 next streaming 起点的小量欠载。
      if (this._currentGain) {
        this._currentGain.gain.setValueCurveAtTime(fadeOut, now, cfSec);
      }

      // next streaming gain fade in（从 0 开始）
      if (this._nextStreamingGain) {
        this._nextStreamingGain.gain.value = 0;
        this._nextStreamingGain.gain.setValueCurveAtTime(fadeIn, now, cfSec);
      }

      console.log('[AudioEngine] Buffer→Streaming crossfade start:', cfMs, 'ms');
      if (this.onCrossfadeStart) this.onCrossfadeStart();

      this._crossfadeTimer = setTimeout(() => {
        this._finishTransition();
      }, cfMs + 50);
    }

    /**
     * 过渡完成处理。统一处理所有模式的 crossfade 完成。
     */
    _finishTransition() {
      this._crossfadeActive = false;
      this._crossfadeTimer = null;
      this._pendingBufferToStreamingCrossfade = false;
      this._crossfadePending = false;
      this._crossfadePendingSince = 0;

      var hadNextStreaming = !!this._nextStreamingNode;
      var hadNextBuffer = !!this._nextSource || !!this._nextBuffer;

      // ── 清理当前曲目旧源 ──
      this._safeStopSource(this._currentSource);
      this._safeDisconnect(this._currentGain);
      this._currentSource = null;
      this._currentGain = null;
      this._currentBuffer = null;

      // 清理旧的 current streaming node（如果有）
      if (this._currentStreamingNode) {
        this._disposeStreamingNode(this._currentStreamingNode, this._currentStreamingGain);
        this._currentStreamingNode = null;
        this._currentStreamingGain = null;
      }

      // ── 提升 next → current ──
      if (hadNextStreaming) {
        this._promoteNextStreamingToCurrent();
      } else if (hadNextBuffer) {
        // Buffer → Buffer
        this._currentSource = this._nextSource;
        this._currentGain = this._nextGain;
        this._currentBuffer = this._nextBuffer;
        this._sourceStartCtxTime = this._ctx.currentTime;
      }

      // ── 位置补偿 ──
      // 智能过渡：根据方案计算正确的 seekOffset
      // Buffer 模式：next source 从 nextStartOffsetMs 开始，播放了 cfMs → seekOffset = nextOffset + cfMs
      // Streaming 模式：consumedFrames 已包含 crossfade 期间的播放时间 → seekOffset = nextOffset
      var cfMs = this._getEffectiveCrossfadeMs();
      var nextOffset = (this._transitionPlan && this._transitionPlan.nextStartOffsetMs > 0)
        ? this._transitionPlan.nextStartOffsetMs : 0;
      var tempoAdj = this._tempoAdjustActive;

      if (hadNextStreaming) {
        // Streaming：consumedFrames 从 next 继承，已包含 crossfade 时间
        this._seekOffsetMs = nextOffset;
      } else if (hadNextBuffer) {
        // Buffer：source 在 nextOffset 处启动，播放了 cfMs
        // 如果有调速，实际消费的音频时长 = cfMs * tempoAdj
        if (tempoAdj > 0 && tempoAdj !== 1.0) {
          this._seekOffsetMs = nextOffset + Math.round(cfMs * tempoAdj);
        } else {
          this._seekOffsetMs = nextOffset + cfMs;
        }
      } else {
        // 回退
        this._seekOffsetMs = cfMs;
      }

      this._currentDurationMs = this._nextDurationMs;
      this._currentFilePath = this._nextFilePath;

      // ── 清除 next 状态 ──
      this._nextSource = null;
      this._nextGain = null;
      this._nextBuffer = null;
      this._nextFilePath = '';
      this._nextDurationMs = 0;
      this._nextIsStreaming = false;
      this._nextStreamingNode = null;
      this._nextStreamingGain = null;
      this._nextStreamingConsumedFrames = 0;
      this._nextStreamingEnded = false;
      this._pendingNextStreamingPcm = [];
      this._nextStreamingPrimed = false;

      // 清除过渡方案（下一曲需要新方案）
      this._transitionPlan = null;
      this._cachedCrossfadeCurves = null;

      // ── 调速渐回原速 ──
      // crossfade 期间下一曲以 tempoAdj 速率播放，现在已提升为当前曲。
      // 用线性渐变在 3 秒内缓慢回到 1.0，避免突变感。
      if (tempoAdj > 0 && tempoAdj !== 1.0 && this._currentSource && this._currentSource.playbackRate) {
        var rampSec = 3.0;
        var pr = this._currentSource.playbackRate;
        var rampStart = this._ctx.currentTime;
        pr.cancelScheduledValues(rampStart);
        pr.setValueAtTime(tempoAdj, rampStart);
        pr.linearRampToValueAtTime(1.0, rampStart + rampSec);
        console.log('[AudioEngine] Tempo ramp-back:', tempoAdj.toFixed(4), '→ 1.0 over', rampSec, 's');
      }
      this._tempoAdjustActive = 0;

      console.log('[AudioEngine] Crossfade complete, seekOffset:', this._seekOffsetMs);
      if (this.onCrossfadeComplete) this.onCrossfadeComplete(this.getCurrentPositionMs());
    }

    /**
     * 将 next streaming node 提升为 current。
     * 断开旧连接，重新绑定引用。
     */
    _promoteNextStreamingToCurrent() {
      this._currentStreamingNode = this._nextStreamingNode;
      this._currentStreamingGain = this._nextStreamingGain;
      this._streamingConsumedFrames = this._nextStreamingConsumedFrames;
      this._currentStreamingEnded = this._nextStreamingEnded;
      this._sourceStartCtxTime = this._ctx.currentTime;

      // 确保 worklet 已解除暂停（gapless 路径可能未单独 resume）
      if (this._currentStreamingNode) {
        try { this._currentStreamingNode.port.postMessage({ type: 'resume' }); } catch (_) {}
      }

      // 设置 gain 为当前音量（crossfade 自动化已结束）
      if (this._currentStreamingGain) {
        this._currentStreamingGain.gain.cancelScheduledValues(this._ctx.currentTime);
        this._currentStreamingGain.gain.value = this._volume;
      }

      // 重新绑定 onmessage 为 'current' 角色
      var self = this;
      var node = this._currentStreamingNode;
      this._currentStreamingNode.port.onmessage = function (e) {
        var data = e.data;
        if (data.type === 'ended') {
          self._currentStreamingEnded = true;
          // 本节点已被后续过渡提升/替换时，残留的 ended 直接忽略，避免主进程重复推进。
          if (node !== self._currentStreamingNode) return;
          if (!self._crossfadeActive && self.onStreamEnded) {
            self.onStreamEnded();
          }
        }
        if (data.type === 'position') {
          self._streamingConsumedFrames = data.consumedFrames;
        }
        // 背压：promote 后 channel 为 'main'
        if (data.type === 'flow_pause' || data.type === 'flow_resume') {
          if (window.__electronAPI) {
            window.__electronAPI.invoke('ffmpeg_flow_control', {
              channel: 'main', pause: data.type === 'flow_pause'
            });
          }
        }
      };

      console.log('[AudioEngine] Promoted next streaming → current, consumedFrames:',
        this._streamingConsumedFrames);
    }

    // ── 无缝播放 ────────────────────────────────────────────────────────────

    /**
     * 预调度 gapless 切换（Buffer → Buffer）。
     * 计算当前源的精确结束时间，在该时刻启动下一曲源。
     * 当当前源 onended 触发时，下一曲已经在播放 = 零间隙。
     */
    _scheduleGaplessSwitch() {
      if (!this._gaplessEnabled) return;
      if (this._crossfadeEnabled) return; // crossfade 优先
      if (!this._currentBuffer || !this._nextBuffer) return;
      if (this._nextIsStreaming) return;  // 仅 Buffer → Buffer
      if (this._gaplessScheduledSource) return; // 已调度
      if (!this._isPlaying || this._isPaused) return;

      var offsetSec = (this._seekOffsetMs || 0) / 1000;
      var remainingSec = this._currentBuffer.duration - offsetSec;
      if (remainingSec <= 0.1) return; // 太短不调度

      var endTime = this._sourceStartCtxTime + remainingSec;
      if (endTime <= this._ctx.currentTime + 0.05) return; // 已过或即将结束

      var nextSrc = new AudioBufferSourceNode(this._ctx, { buffer: this._nextBuffer });
      var nextGain = this._ctx.createGain();
      nextGain.gain.value = this._volume;
      nextSrc.connect(nextGain);
      nextGain.connect(this._effectsInput || this._outputNode);

      nextSrc.start(endTime, 0);

      this._gaplessScheduledSource = nextSrc;
      this._gaplessScheduledGain = nextGain;
      this._gaplessScheduledEndTime = endTime;

      console.log('[AudioEngine] Gapless scheduled: next starts in',
        Math.round((endTime - this._ctx.currentTime) * 1000) + 'ms');
    }

    /**
     * 取消预调度的 gapless 源。
     */
    _cancelGaplessSchedule() {
      if (this._gaplessScheduledSource) {
        try { this._gaplessScheduledSource.onended = null; } catch (_) {}
        try { this._gaplessScheduledSource.stop(); } catch (_) {}
        try { this._gaplessScheduledSource.disconnect(); } catch (_) {}
        this._gaplessScheduledSource = null;
      }
      if (this._gaplessScheduledGain) {
        try { this._gaplessScheduledGain.disconnect(); } catch (_) {}
        this._gaplessScheduledGain = null;
      }
      this._gaplessScheduledEndTime = 0;
    }

    /**
     * 预调度 gapless 源提升为当前源。
     * 在当前源 onended 时调用，此时下一曲已经在播放。
     */
    _promoteGaplessScheduled() {
      if (!this._gaplessScheduledSource) return;

      // 清理旧 current 源
      // 注意：不调用 source.stop()，因为源已自然结束，stop() 可能产生 click
      // 只需断开连接，让 GC 回收
      if (this._currentSource) {
        try { this._currentSource.onended = null; } catch (_) {}
        try { this._currentSource.disconnect(); } catch (_) {}
      }
      if (this._currentGain) {
        try { this._currentGain.disconnect(); } catch (_) {}
      }

      // 提升预调度源 → current
      this._currentSource = this._gaplessScheduledSource;
      this._currentGain = this._gaplessScheduledGain;
      this._currentBuffer = this._nextBuffer;
      this._sourceStartCtxTime = this._gaplessScheduledEndTime;
      this._seekOffsetMs = 0;

      // 更新元数据
      this._currentFilePath = this._nextFilePath;
      this._currentDurationMs = this._nextDurationMs;

      // 保存引用用于 onended
      var source = this._currentSource;
      var gen = this._generation;
      var self = this;

      // 清除预调度状态
      this._gaplessScheduledSource = null;
      this._gaplessScheduledGain = null;
      this._gaplessScheduledEndTime = 0;

      // 清除 next 状态
      this._nextSource = null;
      this._nextGain = null;
      this._nextBuffer = null;
      this._nextFilePath = '';
      this._nextDurationMs = 0;
      this._nextIsStreaming = false;

      // 为提升后的源设置 onended（支持连续 gapless）
      source.onended = function () {
        if (self._generation !== gen) return;
        if (self._currentSource !== source) return;
        if (self._gaplessScheduledSource) {
          self._promoteGaplessScheduled();
        } else {
          self._isPlaying = false;
          if (self.onEnded) self.onEnded();
        }
      };

      console.log('[AudioEngine] Gapless switch (pre-scheduled buffer)');

      // 延迟通知主进程：避免 IPC → UI 更新 → 预加载等重活
      // 同步阻塞 onended 回调，导致 AudioWorklet 消息积压瞬断
      // 关键：使用 setTimeout(0) 而非 Promise.resolve().then()，
      // 因为微任务会在宏任务（AudioWorklet 消息）之前执行，
      // 而 setTimeout(0) 会先让事件循环处理待处理的 AudioWorklet 消息，
      // 确保 OutputCaptureWorklet 的 PCM 数据能及时转发到 DLL。
      var cb = this.onGaplessSwitch;
      if (cb) {
        setTimeout(function () { cb(); }, 0);
      }
    }

    /**
     * 无缝切换到下一曲。
     * 根据模式分发到对应实现。
     */
    switchToNext() {
      var nextIsBuffer = !!this._nextBuffer && !this._nextIsStreaming;
      var nextIsStreaming = this._nextIsStreaming || this._nextStreamingNode != null;

      if (nextIsBuffer) {
        return this._switchToNextBuffer();
      } else if (nextIsStreaming) {
        return this._switchToNextStreaming();
      }
      return false;
    }

    /**
     * Buffer → Buffer gapless 切换。
     */
    _switchToNextBuffer() {
      if (!this._nextBuffer) return false;

      this._safeStopSource(this._currentSource);
      this._safeDisconnect(this._currentGain);

      const gen = ++this._generation;
      this._currentBuffer = this._nextBuffer;
      this._currentFilePath = this._nextFilePath;
      this._currentDurationMs = this._nextDurationMs;
      this._seekOffsetMs = 0;

      this._createAndStartSource(this._currentBuffer, 0, gen, true);

      // 清除 next
      this._nextSource = null;
      this._nextGain = null;
      this._nextBuffer = null;
      this._nextFilePath = '';
      this._nextDurationMs = 0;
      this._nextIsStreaming = false;

      console.log('[AudioEngine] Gapless switch (buffer)');
      if (this.onGaplessSwitch) this.onGaplessSwitch();
      return true;
    }

    /**
     * Streaming → Streaming gapless 切换。
     * 将 next streaming node 提升为 current。
     */
    _switchToNextStreaming() {
      if (!this._nextStreamingNode) {
        // next streaming node 尚未创建（FFmpeg 还没产出 PCM）
        // 无法无缝切换，返回 false 让 player.js 走 nextTrack()
        console.warn('[AudioEngine] Gapless switch (streaming): next node not ready');
        return false;
      }

      // 清理旧的 current streaming node
      this._disposeStreamingNode(this._currentStreamingNode, this._currentStreamingGain);
      this._currentStreamingNode = null;
      this._currentStreamingGain = null;
      this._currentBuffer = null;

      // 提升 next → current
      this._promoteNextStreamingToCurrent();

      // 更新元数据
      this._currentFilePath = this._nextFilePath;
      this._currentDurationMs = this._nextDurationMs;
      this._seekOffsetMs = 0;

      // 清除 next
      this._nextFilePath = '';
      this._nextDurationMs = 0;
      this._nextIsStreaming = false;
      this._nextStreamingNode = null;
      this._nextStreamingGain = null;
      this._nextStreamingConsumedFrames = 0;
      this._nextStreamingEnded = false;
      this._pendingNextStreamingPcm = [];
      this._nextStreamingPrimed = false;

      console.log('[AudioEngine] Gapless switch (streaming)');
      if (this.onGaplessSwitch) this.onGaplessSwitch();
      return true;
    }

    // ── 位置跟踪 ────────────────────────────────────────────────────────────

    /**
     * 获取当前播放位置（ms）。
     * - Buffer 模式：基于 AudioContext.currentTime + DLL 延迟补偿。
     * - Streaming 模式：基于 StreamingPCMWorklet 消费帧数 + DLL 延迟补偿。
     */
    getCurrentPositionMs() {
      if (!this._isPlaying) return this._seekOffsetMs;

      // 总延迟补偿 = DLL 缓冲延迟 + OutputCaptureWorklet 累积延迟 + Web Audio 输出延迟
      var totalLatency = this._dllBufferLatencyMs;

      // OutputCaptureWorklet 累积延迟：4410 frames / 44100Hz ≈ 100ms
      // （worklet 累积 100ms 后才通过 IPC 发送，这 100ms 的音频还没到达 DLL）
      totalLatency += 100;

      // Web Audio 输出延迟（如果 API 支持）
      if (this._ctx && this._ctx.outputLatency) {
        totalLatency += Math.round(this._ctx.outputLatency * 1000);
      } else if (this._ctx && this._ctx.baseLatency) {
        totalLatency += Math.round(this._ctx.baseLatency * 1000);
      }

      // Streaming 模式
      if (!this._currentBuffer && this._currentStreamingNode) {
        var elapsedMs = (this._streamingConsumedFrames / this._ctx.sampleRate) * 1000;
        var posMs = this._seekOffsetMs + elapsedMs;
        return Math.max(0, posMs - totalLatency);
      }

      // Buffer 模式
      if (this._ctx) {
        var elapsedSec = this._ctx.currentTime - this._sourceStartCtxTime;
        var rate = (this._currentSource && this._currentSource.playbackRate)
          ? this._currentSource.playbackRate.value : 1.0;
        var posMs2 = this._seekOffsetMs + elapsedSec * 1000 * rate;
        return Math.max(0, posMs2 - totalLatency);
      }

      return this._seekOffsetMs;
    }

    setDllBufferLatency(ms) {
      this._dllBufferLatencyMs = ms || 0;
    }

    // ── 配置 ────────────────────────────────────────────────────────────────

    setCrossfadeEnabled(enabled) { this._crossfadeEnabled = !!enabled; }
    setCrossfadeDuration(ms) { this._crossfadeDurationMs = ms; this._cachedCrossfadeCurves = null; }
    setGaplessEnabled(enabled) { this._gaplessEnabled = !!enabled; }

    /**
     * 设置 EQ 启用状态。
     * 禁用时所有 EQ 段归零（平坦）。
     */
    setEqEnabled(enabled) {
      this._eqEnabled = !!enabled;
      if (!this._eqBands) return;
      for (var i = 0; i < this._eqBands.length; i++) {
        this._eqBands[i].gain.value = enabled ? (this._eqBandGains[i] || 0) : 0;
      }
      this._updateEffectsGain();
    }

    /**
     * 设置 EQ 单段增益。
     * @param {number} index - 段索引 (0-9)
     * @param {number} gainDb - 增益 (-12 到 +12 dB)
     */
    setEqBand(index, gainDb) {
      if (!this._eqBands || index < 0 || index >= this._eqBands.length) return;
      this._eqBandGains[index] = gainDb;
      if (this._eqEnabled) {
        this._eqBands[index].gain.value = gainDb;
      }
      this._updateEffectsGain();
    }

    /**
     * 批量应用所有音频效果设置（EQ / 低音 / 压限器）。
     * init() 完成后同步调用，避免 IPC 异步延迟导致效果不生效。
     */
    applyAudioSettings(settings) {
      this._settingsCache = settings;
      if (!this._eqBands) return; // init 未完成，缓存等待 init 后应用

      // EQ 频段值
      var bands = settings.eq_bands;
      if (Array.isArray(bands)) {
        for (var i = 0; i < bands.length && i < this._eqBandGains.length; i++) {
          this._eqBandGains[i] = bands[i] || 0;
        }
      }
      // EQ 开关
      this._eqEnabled = !!settings.eq_enabled;
      for (var i = 0; i < this._eqBands.length; i++) {
        this._eqBands[i].gain.value = this._eqEnabled ? (this._eqBandGains[i] || 0) : 0;
      }
      // 动态低音补偿
      this._bassEnabled = !!settings.dynamic_bass;
      if (this._bassBoost) this._bassBoost.gain.value = this._bassEnabled ? 6 : 0;
      // 压限器
      this._compressorEnabled = !!settings.compressor_enabled;
      if (this._compressor) {
        if (this._compressorEnabled) {
          this._compressor.threshold.value = -10;
          this._compressor.ratio.value = 4;
        } else {
          this._compressor.threshold.value = 0;
          this._compressor.ratio.value = 1;
        }
      }
      // 人声优化
      this._vocalEnabled = !!settings.vocal_enhance;
      this._applyVocalFilters();
      // 吉他友好
      this._guitarEnabled = !!settings.guitar_friendly;
      this._applyGuitarFilters();
      // 虚拟低音增强 (VBE)
      this._vbeEnabled = !!settings.vbe_enabled;
      if (settings.vbe_cutoff !== undefined)
        this._vbeParams.cutoffFrequency = settings.vbe_cutoff;
      if (settings.vbe_harm !== undefined)
        this._vbeParams.harmGain = settings.vbe_harm;
      if (settings.vbe_sub !== undefined)
        this._vbeParams.subGain = settings.vbe_sub;
      if (settings.vbe_body !== undefined)
        this._vbeParams.bodyGain = settings.vbe_body;
      if (settings.vbe_reson !== undefined)
        this._vbeParams.resonGain = settings.vbe_reson;
      if (settings.vbe_dry !== undefined)
        this._vbeParams.dryGain = settings.vbe_dry;
      if (settings.vbe_a2 !== undefined)
        this._vbeParams.a2 = settings.vbe_a2;
      if (settings.vbe_a3 !== undefined)
        this._vbeParams.a3 = settings.vbe_a3;
      if (settings.vbe_trans_drive !== undefined)
        this._vbeParams.transDrive = settings.vbe_trans_drive;
      if (settings.vbe_reson_freq !== undefined)
        this._vbeParams.resonFreq = settings.vbe_reson_freq;
      this._sendVbeParams();
      // 增益补偿
      this._updateEffectsGain();
      console.log('[AudioEngine] Audio effects applied: eq=' + this._eqEnabled +
        ', bass=' + this._bassEnabled + ', comp=' + this._compressorEnabled +
        ', vocal=' + this._vocalEnabled + ', guitar=' + this._guitarEnabled +
        ', vbe=' + this._vbeEnabled);
    }

    /**
     * 发送 VBE 参数到 AudioWorklet 处理器。
     */
    _sendVbeParams() {
      if (!this._vbeNode) return;
      this._vbeNode.port.postMessage({
        type: 'params',
        params: Object.assign({ enabled: this._vbeEnabled }, this._vbeParams),
      });
    }

    /**
     * 设置虚拟低音增强 (VBE) 启用状态。
     * 启用时通过 NLD 谐波生成在小型扬声器上创造低音感知。
     */
    setVirtualBass(enabled) {
      this._vbeEnabled = !!enabled;
      if (this._vbeNode) {
        this._vbeNode.port.postMessage({ type: 'enabled', value: this._vbeEnabled });
      }
      this._updateEffectsGain();
    }

    /**
     * 设置 VBE 单个参数。
     * @param {string} name  参数名
     * @param {number} value 参数值
     */
    setVbeParam(name, value) {
      if (!this._vbeParams.hasOwnProperty(name)) return;
      this._vbeParams[name] = value;
      if (this._vbeNode) {
        this._vbeNode.port.postMessage({ type: 'param', name: name, value: value });
      }
      this._updateEffectsGain();
    }

    /**
     * 设置动态低音补偿启用状态。
     * 启用时低架滤波器增益 +6dB @ 80Hz。
     */
    setDynamicBass(enabled) {
      this._bassEnabled = !!enabled;
      if (!this._bassBoost) return;
      this._bassBoost.gain.value = enabled ? 6 : 0;
      this._updateEffectsGain();
    }

    /**
     * 设置人声优化启用状态。
     * 启用时：减间浊 @300Hz，提升存在感 @3kHz，增加空气感 @8kHz。
     */
    setVocalEnhance(enabled) {
      this._vocalEnabled = !!enabled;
      this._applyVocalFilters();
      this._updateEffectsGain();
    }

    _applyVocalFilters() {
      if (!this._vocalFilters) return;
      var gains = [-3, 3, 2]; // 对应 vocalParams
      for (var i = 0; i < this._vocalFilters.length; i++) {
        this._vocalFilters[i].gain.value = this._vocalEnabled ? gains[i] : 0;
      }
    }

    /**
     * 设置吉他友好启用状态。
     * 启用时：拨片冲击 @1.5kHz，咬合尖锐 @4kHz，高频延展 @6kHz。
     */
    setGuitarFriendly(enabled) {
      this._guitarEnabled = !!enabled;
      this._applyGuitarFilters();
      this._updateEffectsGain();
    }

    _applyGuitarFilters() {
      if (!this._guitarFilters) return;
      var gains = [3, 4, 3]; // 对应 guitarParams
      for (var i = 0; i < this._guitarFilters.length; i++) {
        this._guitarFilters[i].gain.value = this._guitarEnabled ? gains[i] : 0;
      }
    }

    /**
     * 设置压限器启用状态。
     * 启用时：threshold -3dB, ratio 20:1（硬限制）。
     */
    setCompressorEnabled(enabled) {
      this._compressorEnabled = !!enabled;
      if (!this._compressor) return;
      if (enabled) {
        // 动态压缩：控制动态范围，阈值 -10dB，比率 4:1
        this._compressor.threshold.value = -10;
        this._compressor.ratio.value = 4;
      } else {
        this._compressor.threshold.value = 0;
        this._compressor.ratio.value = 1;
      }
    }

    /**
     * 自动增益补偿：当 EQ 或低音补偿提升某些频段时，
     * 等量降低总增益，防止信号过载导致爆音。
     * 补偿量 = EQ 最大正增益 + 低音补偿增益
     */
    _updateEffectsGain() {
      if (!this._effectsInput) return;
      var maxBoost = 0;
      // EQ 正增益补偿
      if (this._eqEnabled && this._eqBandGains) {
        for (var i = 0; i < this._eqBandGains.length; i++) {
          if (this._eqBandGains[i] > maxBoost) maxBoost = this._eqBandGains[i];
        }
      }
      // 低音补偿增益
      if (this._bassEnabled) {
        maxBoost += 6; // bass boost +6dB
      }
      // 人声优化正增益
      if (this._vocalEnabled) {
        maxBoost += 3; // 人声存在感 +3dB
      }
      // 吉他友好正增益
      if (this._guitarEnabled) {
        maxBoost += 4; // 咬合感 +4dB
      }
      // VBE 谐波增益补偿（harmGain 的 dB 值）
      if (this._vbeEnabled) {
        var harmDb = 20 * Math.log10(this._vbeParams.harmGain || 0.35);
        maxBoost += Math.max(0, harmDb + 14); // 归一化到 ~0dB 基准
      }
      // dB 转线性增益：gain = 10^(-maxBoost/20)
      var gainLin = Math.pow(10, -maxBoost / 20);
      // 最低不低于 0.1（-20dB），避免过度衰减
      this._effectsInput.gain.value = Math.max(gainLin, 0.1);
    }

    /**
     * 设置智能过渡方案。
     * TransitionPlanner 生成的方案包含 transitionStartMs、crossfadeDurationMs、nextStartOffsetMs。
     * 设为 null 时回退到固定时长交叉淡化。
     */
    setTransitionPlan(plan) {
      this._transitionPlan = plan || null;
      // ── 预计算等功率曲线 ──
      // 避免 startCrossfade() 时同步分配大数组（如 12s@44100Hz ≈ 2×2.1MB）阻塞主线程导致顿卡。
      // 在方案设定时提前算好缓存，crossfade 触发时直接取用。
      var cfMs = this._getEffectiveCrossfadeMs();
      if (cfMs > 0 && this._ctx) {
        var cfFrames = Math.round((cfMs / 1000) * this._ctx.sampleRate);
        if (cfFrames > 0) {
          this._cachedCrossfadeCurves = computeEqualPowerCurves(cfFrames);
        }
      }
      if (plan) {
        console.log('[AudioEngine] Transition plan set: start=' + plan.transitionStartMs +
          'ms, duration=' + plan.crossfadeDurationMs + 'ms, nextOffset=' + plan.nextStartOffsetMs +
          'ms, source=' + plan.source + ', confidence=' + plan.confidence +
          ', curves precomputed=' + (this._cachedCrossfadeCurves ? cfMs + 'ms' : 'no'));
      } else {
        console.log('[AudioEngine] Transition plan cleared (fallback to fixed duration), curves precomputed=' + (this._cachedCrossfadeCurves ? cfMs + 'ms' : 'no'));
      }
    }

    /**
     * 获取当前有效的交叉淡化时长（优先使用 transitionPlan）。
     */
    _getEffectiveCrossfadeMs() {
      if (this._transitionPlan && this._transitionPlan.crossfadeDurationMs > 0) {
        return this._transitionPlan.crossfadeDurationMs;
      }
      return this._crossfadeDurationMs;
    }

    /**
     * 获取等功率曲线（优先使用预计算缓存，避免 startCrossfade 时同步分配大数组导致主线程顿卡）。
     * @param {number} cfFrames - 需要的帧数
     * @returns {{fadeOut:Float32Array, fadeIn:Float32Array}}
     */
    _getCrossfadeCurves(cfFrames) {
      if (this._cachedCrossfadeCurves && this._cachedCrossfadeCurves.fadeOut.length === cfFrames) {
        return this._cachedCrossfadeCurves;
      }
      // 缓存未命中（duration 变更等），同步计算并更新缓存
      this._cachedCrossfadeCurves = computeEqualPowerCurves(cfFrames);
      return this._cachedCrossfadeCurves;
    }

    /**
     * 获取 BPM 匹配的速率调整比率。
     * 如果两曲 BPM 在可调范围内（15% 以内），返回 nextBpm/curBpm 比率。
     * 下一曲以此速率播放，拍子与当前曲对齐。
     * @returns {number} playbackRate（1.0 = 不调整）
     */
    _getTempoAdjust() {
      if (!this._transitionPlan) return 1.0;
      var adjust = this._transitionPlan.bpmTempoAdjust;
      if (typeof adjust !== 'number' || !isFinite(adjust) || adjust <= 0) return 1.0;
      // 限制在 0.85-1.15 范围内（±15%）
      if (adjust < 0.85) adjust = 0.85;
      if (adjust > 1.15) adjust = 1.15;
      return adjust;
    }

    clearNextState() {
      // Buffer next
      this._safeStopSource(this._nextSource);
      this._safeDisconnect(this._nextGain);
      this._nextSource = null;
      this._nextGain = null;
      this._nextBuffer = null;
      this._nextFilePath = '';
      this._nextDurationMs = 0;
      this._nextIsStreaming = false;

      // Streaming next
      this._disposeStreamingNode(this._nextStreamingNode, this._nextStreamingGain);
      this._nextStreamingNode = null;
      this._nextStreamingGain = null;
      this._nextStreamingConsumedFrames = 0;
      this._nextStreamingEnded = false;
      this._pendingNextStreamingPcm = [];
      this._nextStreamingPrimed = false;

      // Crossfade state
      this._stopCrossfadeTimer();
      this._crossfadeActive = false;
      this._pendingBufferToStreamingCrossfade = false;
      this._crossfadePending = false;
      this._crossfadePendingSince = 0;
      this._tempoAdjustActive = 0;
      this._cancelGaplessSchedule();
      this._transitionPlan = null; // 清除过渡方案（下一曲信息已变更）
      this._cachedCrossfadeCurves = null;
    }

    // ── FFmpeg PCM 注入 ─────────────────────────────────────────────────────

    /**
     * 推送当前曲目 FFmpeg PCM 到 StreamingPCMWorklet。
     */
    pushStreamingPcm(float32Array) {
      // 零拷贝：IPC 反序列化产生的 buffer 为精确大小且本消息独占，
      // 直接作为 transferable 转给 worklet（转移后原视图失效，无其他持有者）。
      // 仅当视图未完整覆盖底层 buffer 时回退为拷贝（防御性路径，正常不会走到）。
      var ab;
      if (float32Array.byteOffset === 0 && float32Array.buffer &&
          float32Array.buffer.byteLength === float32Array.byteLength) {
        ab = float32Array.buffer;
      } else {
        ab = new ArrayBuffer(float32Array.byteLength);
        new Float32Array(ab).set(float32Array);
      }

      if (!this._currentStreamingNode) {
        // 内存保护：限制待处理 PCM 缓冲区大小，防止 FFmpeg 产出快于 worklet 创建时无限增长
        if (this._pendingStreamingPcm.length < 200) {
          this._pendingStreamingPcm.push(ab);
        } else {
          // 超限：丢弃最旧的数据，保留最新的
          this._pendingStreamingPcm.shift();
          this._pendingStreamingPcm.push(ab);
        }
        return;
      }
      // clear 後の初回 PCM 到着時に baseline を送信
      // (FFmpeg 再起動中に消費された静音フレームを位置から除外)
      if (this._streamingBaselinePending) {
        this._currentStreamingNode.port.postMessage({ type: 'baseline' });
        this._streamingBaselinePending = false;
      }
      this._currentStreamingNode.port.postMessage({ type: 'pcm', samples: ab }, [ab]);

      // seek 后位置定时器被停止，收到 PCM 说明 FFmpeg 已产出新数据，重启
      if (!this._positionTimer && this._isPlaying && !this._isPaused) {
        this._startPositionTimer();
      }
    }

    setStreamingFinished() {
      if (!this._currentStreamingNode) return;
      this._currentStreamingNode.port.postMessage({ type: 'end' });
    }

    // ── FFmpeg PCM IPC 路由（app.js 调用） ────────────────────────────────────

    /**
     * 主通道 FFmpeg PCM → 当前曲目 streaming worklet。
     */
    pushMainPcm(float32Array) {
      this.pushStreamingPcm(float32Array);
    }

    /**
     * 次通道 FFmpeg PCM → 下一曲 streaming worklet。
     * 如果 next streaming node 尚未创建，缓冲 PCM 数据。
     * 如果延迟 crossfade 待触发且这是第一块数据，启动 crossfade。
     */
    pushNextPcm(float32Array) {
      // 零拷贝 transferable（同 pushStreamingPcm）
      var ab;
      if (float32Array.byteOffset === 0 && float32Array.buffer &&
          float32Array.buffer.byteLength === float32Array.byteLength) {
        ab = float32Array.buffer;
      } else {
        ab = new ArrayBuffer(float32Array.byteLength);
        new Float32Array(ab).set(float32Array);
      }

      if (!this._nextStreamingNode) {
        // Node 尚未创建，缓冲数据
        // 内存保护：限制待处理 PCM 缓冲区大小
        if (this._pendingNextStreamingPcm.length < 200) {
          this._pendingNextStreamingPcm.push(ab);
        } else {
          this._pendingNextStreamingPcm.shift();
          this._pendingNextStreamingPcm.push(ab);
        }
      } else {
        // Worklet 已创建（可能 paused 预缓冲中），直送 PCM 到 ring buffer
        this._nextStreamingNode.port.postMessage({ type: 'pcm', samples: ab }, [ab]);
        this._nextStreamingPrimed = true;
      }

      // 触发检查（无论 worklet 是否已创建）
      // 如果正在等待 next streaming PCM 来启动延迟 crossfade
      if (this._pendingBufferToStreamingCrossfade) {
        var self = this;
        Promise.resolve().then(function () {
          if (self._pendingBufferToStreamingCrossfade) {
            self._startBufferToStreamingCrossfade();
          }
        });
      }
      // 补触发：如果 crossfade pending（到达触发点但下一曲未就绪），现在 PCM 到了
      if (this._crossfadePending) {
        this._checkCrossfadeTrigger();
      }
    }

    /**
     * 主通道 FFmpeg 流结束。
     */
    setMainFfmpegFinished(finished) {
      if (finished) this.setStreamingFinished();
    }

    /**
     * 次通道 FFmpeg 流结束。
     * 标记 next streaming 为结束状态。
     */
    setNextFfmpegFinished(finished) {
      if (finished) {
        this._nextStreamingEnded = true;
        if (this._nextStreamingNode) {
          this._nextStreamingNode.port.postMessage({ type: 'end' });
        }
      }
    }

    // ── 缓存 ────────────────────────────────────────────────────────────────

    getCachedBuffer(filePath) {
      return this._cache.get(filePath);
    }

    setCachedBuffer(filePath, buffer) {
      this._cache.set(filePath, buffer);
    }

    // ── 文件加载（IPC） ─────────────────────────────────────────────────────

    _loadFile(filePath) {
      // If already loading this file, share the existing promise.
      // This allows multiple consumers (e.g. AudioEngine + TrackAnalyzer)
      // to decode the same file concurrently without one superseding the other.
      const existing = this._pendingLoads.get(filePath);
      if (existing) {
        return existing.promise;
      }

      let resolveRef, rejectRef;
      const promise = new Promise((resolve, reject) => {
        resolveRef = resolve;
        rejectRef = reject;
      });

      const timer = setTimeout(() => {
        const entry = this._pendingLoads.get(filePath);
        if (entry) {
          this._pendingLoads.delete(filePath);
          rejectRef(new Error('File load timeout: ' + filePath));
        }
      }, 30000);

      this._pendingLoads.set(filePath, {
        promise: promise,
        resolve: resolveRef,
        reject: rejectRef,
        timer: timer,
      });

      if (window.__electronAPI && window.__electronAPI.requestDecodeAudioFile) {
        window.__electronAPI.requestDecodeAudioFile(filePath);
      } else {
        clearTimeout(timer);
        this._pendingLoads.delete(filePath);
        rejectRef(new Error('requestDecodeAudioFile not available'));
      }

      return promise;
    }

    async _loadAndDecode(filePath) {
      const arrayBuffer = await this._loadFile(filePath);
      // Copy the ArrayBuffer before decoding: when multiple consumers share
      // the same _loadFile promise, decodeAudioData may detach the buffer in
      // some implementations. The copy ensures each consumer gets its own.
      const audioBuffer = await this._ctx.decodeAudioData(arrayBuffer.slice(0));
      return audioBuffer;
    }

    onFileLoaded(filePath, arrayBuffer) {
      const pending = this._pendingLoads.get(filePath);
      if (!pending) return;
      this._pendingLoads.delete(filePath);
      clearTimeout(pending.timer);
      pending.resolve(arrayBuffer);
    }

    onFileLoadError(filePath, error) {
      const pending = this._pendingLoads.get(filePath);
      if (!pending) return;
      this._pendingLoads.delete(filePath);
      clearTimeout(pending.timer);
      pending.reject(new Error(error));
    }

    // ── 内部工具 ────────────────────────────────────────────────────────────

    _resumeContext() {
      if (this._ctx && this._ctx.state === 'suspended') {
        this._ctx.resume();
      }
    }

    /**
     * 位置定时器：250ms 轮询。
     * 负责：
     *   1. 上报位置（onPositionTick）
     *   2. 检查过渡触发条件（crossfade / gapless）
     */
    _startPositionTimer() {
      this._stopPositionTimer();
      var self = this;
      this._positionTimer = setInterval(function () {
        if (self.onPositionTick) {
          self.onPositionTick(self.getCurrentPositionMs());
        }

        // ── 过渡触发检查 ──
        if (self._isPaused) return;
        if (self._crossfadeActive) return;
        if (self._pendingBufferToStreamingCrossfade) return;

        var durMs = self._currentDurationMs;
        if (durMs <= 0) return;

        var posMs = self.getCurrentPositionMs();
        var remainingMs = durMs - posMs;
        if (remainingMs <= 0) return;

        // ── Crossfade 触发（含 pending 机制）──
        if (self._crossfadeEnabled) {
          self._checkCrossfadeTrigger();
        }

      // ── Gapless 触发 ──
      // 预调度的 gapless 通过 onended 自动触发，不需要轮询。
      // 这里仅作为 fallback：streaming 模式或预调度未成功时。
      if (self._gaplessEnabled && remainingMs <= 250 && !self._gaplessScheduledSource) {
          var isBufferMode = !!self._currentBuffer;
          var isStreamingMode = !isBufferMode && !!self._currentStreamingNode;
          var gaplessReady = self._isNextReady(isBufferMode, isStreamingMode);
          if (gaplessReady) {
            console.log('[AudioEngine] Gapless trigger: remaining=' +
              Math.round(remainingMs) + 'ms');
            self.switchToNext();
          }
        }
      }, 250);
    }

    /**
     * 检查下一曲是否就绪（可进行 crossfade / gapless）。
     * 覆盖所有模式组合：Buffer→Buffer、Buffer→Streaming、Streaming→Streaming、Streaming→Buffer。
     */
    _isNextReady(isBufferMode, isStreamingMode) {
      if (isBufferMode && this._nextBuffer && !this._nextIsStreaming) {
        return true; // Buffer → Buffer
      }
      if (isBufferMode && this._nextIsStreaming) {
        // Buffer → Streaming：worklet 已预缓冲（primed）或 pending PCM 有数据
        return this._nextStreamingPrimed || this._pendingNextStreamingPcm.length > 0;
      }
      if (isStreamingMode && this._nextIsStreaming) {
        // Streaming → Streaming
        return this._nextStreamingPrimed || this._pendingNextStreamingPcm.length > 0;
      }
      if (isStreamingMode && this._nextBuffer && !this._nextIsStreaming) {
        // Streaming → Buffer：buffer 已加载即可
        return true;
      }
      return false;
    }

    /**
     * 检查是否应该触发 crossfade。
     * 如果到达触发点但下一曲未就绪，设置 _crossfadePending 标志，
     * 等下一曲就绪后（setNextInfo / pushNextPcm）补触发。
     */
    _checkCrossfadeTrigger() {
      if (!this._crossfadeEnabled) return;
      if (this._crossfadeActive) return;
      if (this._pendingBufferToStreamingCrossfade) return;
      if (this._isPaused) return;

      // Subsonic 流媒体（HTTP URL）现在参与 crossfade：
      // - Streaming → Streaming crossfade 已完整实现（_startStreamingCrossfade）
      // - FFmpeg 可直接处理 HTTP URL 预加载（_spawnNextFfmpeg）
      // - 频谱分析不可用时，TransitionPlanner 回退到固定时长方案
      // 触发时仍通过 _isNextReady() 检查下一曲是否就绪，未就绪时进入 pending 等待。

      var durMs = this._currentDurationMs;
      if (durMs <= 0) return;

      var posMs = this.getCurrentPositionMs();
      var remainingMs = durMs - posMs;
      if (remainingMs <= 0) return;

      // 计算触发阈值
      var plan = this._transitionPlan;
      var triggerMs;
      if (plan && plan.transitionStartMs >= 0) {
        triggerMs = durMs - plan.transitionStartMs;
      } else {
        triggerMs = this._crossfadeDurationMs;
      }

      if (triggerMs <= 0 || remainingMs > triggerMs + 250) {
        return; // 未到触发点
      }

      // 到达触发点，检查下一曲是否就绪
      var isBufferMode = !!this._currentBuffer;
      var isStreamingMode = !isBufferMode && !!this._currentStreamingNode;
      var nextReady = this._isNextReady(isBufferMode, isStreamingMode);

      if (nextReady) {
        this._crossfadePending = false;
        this._crossfadePendingSince = 0;
        console.log('[AudioEngine] Crossfade trigger: remaining=' +
          Math.round(remainingMs) + 'ms, mode=' +
          (isBufferMode ? 'buffer' : 'streaming') +
          (plan ? ', plan=' + plan.source : ', fallback'));
        this.startCrossfade();
      } else {
        // 下一曲未就绪，标记 pending，等就绪后补触发
        if (!this._crossfadePending) {
          this._crossfadePending = true;
          this._crossfadePendingSince = Date.now();
          // 诊断信息：显示下一曲缺少什么
          var diag = 'nextBuffer=' + (!!this._nextBuffer) +
            ', nextIsStreaming=' + this._nextIsStreaming +
            ', nextStreamingNode=' + (!!this._nextStreamingNode) +
            ', pendingPcm=' + this._pendingNextStreamingPcm.length +
            ', nextFilePath=' + (this._nextFilePath || '(empty)');
          console.log('[AudioEngine] Crossfade PENDING: next not ready, remaining=' +
            Math.round(remainingMs) + 'ms (will trigger when next becomes ready) [' + diag + ']');
        } else if (this._crossfadePendingSince > 0) {
          // 超时保护：pending 超过 20 秒仍未就绪，放弃 crossfade
          var pendingElapsed = Date.now() - this._crossfadePendingSince;
          if (pendingElapsed > 20000) {
            console.warn('[AudioEngine] Crossfade PENDING TIMEOUT: gave up after ' +
              pendingElapsed + 'ms, remaining=' + Math.round(remainingMs) +
              'ms — falling back to normal track end');
            this._crossfadePending = false;
            this._crossfadePendingSince = 0;
            // 清除过渡方案，让歌曲自然结束并触发 onEnded → nextTrack()
            this._transitionPlan = null;
            this._cachedCrossfadeCurves = null;
          }
        }
      }
    }

    _stopPositionTimer() {
      if (this._positionTimer) {
        clearInterval(this._positionTimer);
        this._positionTimer = null;
      }
    }

    _stopCrossfadeTimer() {
      if (this._crossfadeTimer) {
        clearTimeout(this._crossfadeTimer);
        this._crossfadeTimer = null;
      }
    }

    _safeStopSource(source) {
      if (!source) return;
      try { source.stop(); } catch (_) {}
      try { source.disconnect(); } catch (_) {}
    }

    _safeDisconnect(node) {
      if (!node) return;
      try { node.disconnect(); } catch (_) {}
    }

    /**
     * 获取鼓点/频谱分析数据。
     * 从 AnalyserNode 旁路读取频谱，提取低频（鼓点）、中频、高频能量。
     * 用于全窗口视图背景的极光式流动效果。
     *
     * @returns {{bass:number, mid:number, treble:number, level:number}|null}
     *   各频段能量 0-1，null 表示分析器未就绪
     */
    getBeatData() {
      if (!this._analyser || !this._freqData) return null;
      this._analyser.getByteFrequencyData(this._freqData);

      var data = this._freqData;
      var n = data.length;  // 256 bins (fftSize=512)
      // 采样率 44100，每 bin ≈ 86Hz
      // bass: bin 0-8 (≈0-700Hz，含 kick 和 bass)
      // mid:  bin 9-46 (≈700Hz-4kHz，人声/吉他主频)
      // treble: bin 47-128 (≈4kHz-11kHz，高频细节)
      var bassSum = 0, midSum = 0, trebleSum = 0;
      var bassCount = 9, midCount = 38, trebleCount = 82;

      for (var i = 0; i < bassCount && i < n; i++) bassSum += data[i];
      for (var i = bassCount; i < bassCount + midCount && i < n; i++) midSum += data[i];
      for (var i = bassCount + midCount; i < bassCount + midCount + trebleCount && i < n; i++) trebleSum += data[i];

      // 归一化到 0-1，加增益补偿（getByteFrequencyData 返回值通常偏小）
      var bass = Math.min(1, (bassSum / (255 * bassCount)) * 2.5);
      var mid = Math.min(1, (midSum / (255 * midCount)) * 2.5);
      var treble = Math.min(1, (trebleSum / (255 * trebleCount)) * 3.0);
      var level = Math.min(1, (bass + mid + treble) / 3);

      return { bass: bass, mid: mid, treble: treble, level: level };
    }
  }

  window.AudioEngine = AudioEngine;
})();
