(function () {
  'use strict';

  function computeEqualPowerCurves(length, amplitude) {
    const amp = (typeof amplitude === 'number' && isFinite(amplitude) && amplitude >= 0)
      ? Math.min(1, amplitude)
      : 1;
    const fadeOut = new Float32Array(length);
    const fadeIn = new Float32Array(length);
    for (let i = 0; i < length; i++) {
      const progress = i / (length - 1);
      fadeOut[i] = Math.cos(progress * Math.PI / 2) * amp;
      fadeIn[i] = Math.sin(progress * Math.PI / 2) * amp;
    }
    return { fadeOut, fadeIn, amplitude: amp };
  }

  var WASH_NEUTRAL = { lowpass: 19500, highpass: 22, threshold: 0, ratio: 1.0, makeup: 1.0 };
  var WASH_OUT_DEEP = { lowpass: 1050, highpass: 190, threshold: -30, ratio: 4.5, makeup: 3.4 };
  var WASH_IN_START = { lowpass: 1500, highpass: 150, threshold: -24, ratio: 3.0, makeup: 3.1 };

  class AudioEngine {
    constructor() {

      this._ctx = null;

      this._initPromise = null;

      this._outputNode = null;

      this._nullSink = false;

      this._analyser = null;

      this._freqData = null;

      this._effectsInput = null;

      this._eqBands = null;

      this._eqBandGains = null;

      this._settingsCache = null;

      this._eqEnabled = false;

      this._bassBoost = null;

      this._bassEnabled = false;

      this._vbeNode = null;

      this._vbeEnabled = false;

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

      this._compressor = null;

      this._compressorEnabled = false;

      this._vocalFilters = null;

      this._vocalEnabled = false;

      this._guitarFilters = null;

      this._guitarEnabled = false;

      this._normGain = null;

      this._normEnabled = false;

      this._normTargetLufs = -14;

      this._trackLoudness = null;

      this._normGainDb = 0;

      this._hearingProtectionEnabled = false;

      this._hearingProtectionFilter = null;

      this._safetyGainNode = null;

      this._SAFETY_MAX_GAIN = 0.398;

      this._currentSource = null;

      this._currentGain = null;

      this._currentBuffer = null;
      this._currentFilePath = '';
      this._currentDurationMs = 0;
      this._seekOffsetMs = 0;

      this._currentStreamingNode = null;

      this._currentStreamingGain = null;

      this._streamingConsumedFrames = 0;

      this._currentStreamingEnded = false;

      this._pendingStreamingPcm = [];

      this._streamingBaselinePending = false;

      this._nextSource = null;
      this._nextGain = null;
      this._nextBuffer = null;
      this._nextFilePath = '';
      this._nextDurationMs = 0;

      this._nextStreamingNode = null;

      this._nextStreamingGain = null;

      this._nextStreamingConsumedFrames = 0;

      this._nextStreamingEnded = false;

      this._pendingNextStreamingPcm = [];

      this._nextStreamingPrimed = false;

      this._nextIsStreaming = false;

      this._generation = 0;
      this._isPlaying = false;
      this._isPaused = false;

      this._sourceStartCtxTime = 0;

      this._crossfadeEnabled = false;
      this._radicalTransitions = false;
      this._crossfadeDurationMs = 5000;
      this._gaplessEnabled = false;
      this._crossfadeTimer = null;

      this._crossfadeActive = false;

      this._currentWash = null;

      this._nextWash = null;

      this._pendingBufferToStreamingCrossfade = false;

      this._crossfadePending = false;

      this._crossfadePendingSince = 0;

      this._tempoAdjustActive = 0;

      this._userRate = 1.0;

      this._crossfadeOutNode = null;

      this._crossfadeInNode = null;

      this._crossfadeStartCtxTime = -1;

      this._crossfadeDurationSec = 0;

      this._gaplessScheduledSource = null;

      this._gaplessScheduledGain = null;

      this._gaplessScheduledEndTime = 0;

      this._transitionPlan = null;

      this._cachedCrossfadeCurves = null;

      this._expansionEffect = null;

      this._volume = 1.0;

      this._dllBufferLatencyMs = 0;

      this._xfadeAnchor = null;

      this._tlInit();

      this._cache = new window.AudioBufferCache();

      this._pendingLoads = new Map();

      this.onOutput = null;
      this.onEnded = null;
      this.onPositionTick = null;
      this.onCrossfadeStart = null;
      this.onCrossfadeComplete = null;
      this.onStreamEnded = null;
      this.onGaplessSwitch = null;

      this._positionTimer = null;
    }

    async _ensureInit() {
      if (this._initPromise) {
        await this._initPromise;
      } else if (!this._ctx) {
        await this.init();
      }
    }

    async init() {
      if (this._ctx) return;

      var ctxOpts = {
        sampleRate: 44100,
        latencyHint: 'playback',
      };

      if (this._nullSink) ctxOpts.sinkId = { type: 'none' };
      this._ctx = new AudioContext(ctxOpts);
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

        this._effectsInput = this._ctx.createGain();

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
          filter.gain.value = 0;
          this._eqBands.push(filter);
        }

        this._vbeNode = new AudioWorkletNode(this._ctx, 'vbe-processor', {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          inputChannelCount: [2],
          outputChannelCount: [2],
        });

        this._bassBoost = this._ctx.createBiquadFilter();
        this._bassBoost.type = 'lowshelf';
        this._bassBoost.frequency.value = 80;
        this._bassBoost.gain.value = 0;

        this._vocalFilters = [];
        var vocalParams = [
          { type: 'peaking', freq: 300, Q: 1.0, gain: -3 },
          { type: 'peaking', freq: 3000, Q: 1.2, gain: 3 },
          { type: 'highshelf', freq: 8000, Q: 0.7, gain: 2 },
        ];
        for (var i = 0; i < vocalParams.length; i++) {
          var vf = this._ctx.createBiquadFilter();
          vf.type = vocalParams[i].type;
          vf.frequency.value = vocalParams[i].freq;
          vf.Q.value = vocalParams[i].Q;
          vf.gain.value = 0;
          this._vocalFilters.push(vf);
        }

        this._guitarFilters = [];
        var guitarParams = [
          { type: 'peaking', freq: 1500, Q: 1.2, gain: 3 },
          { type: 'peaking', freq: 4000, Q: 1.0, gain: 4 },
          { type: 'highshelf', freq: 6000, Q: 0.7, gain: 3 },
        ];
        for (var i = 0; i < guitarParams.length; i++) {
          var gf = this._ctx.createBiquadFilter();
          gf.type = guitarParams[i].type;
          gf.frequency.value = guitarParams[i].freq;
          gf.Q.value = guitarParams[i].Q;
          gf.gain.value = 0;
          this._guitarFilters.push(gf);
        }

        this._compressor = this._ctx.createDynamicsCompressor();
        this._compressor.threshold.value = 0;
        this._compressor.ratio.value = 1;
        this._compressor.attack.value = 0.003;
        this._compressor.release.value = 0.25;

        this._limiter = this._ctx.createDynamicsCompressor();
        this._limiter.threshold.value = -1;
        this._limiter.ratio.value = 20;
        this._limiter.attack.value = 0.001;
        this._limiter.release.value = 0.05;
        this._limiter.knee.value = 0;

        this._hearingProtectionFilter = this._ctx.createBiquadFilter();
        this._hearingProtectionFilter.type = 'highshelf';
        this._hearingProtectionFilter.frequency.value = 3500;
        this._hearingProtectionFilter.Q.value = 0.7;
        this._hearingProtectionFilter.gain.value = 0;

        this._safetyGainNode = this._ctx.createGain();
        this._safetyGainNode.gain.value = 1.0;

        this._normGain = this._ctx.createGain();
        this._normGain.gain.value = this._normalizationLinear();
        this._effectsInput.connect(this._normGain);

        var prev = this._normGain;
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

        this._limiter.connect(this._hearingProtectionFilter);
        this._hearingProtectionFilter.connect(this._safetyGainNode);
        this._safetyGainNode.connect(this._outputNode);

        this._outputNode.connect(this._ctx.destination);

        this._analyser = this._ctx.createAnalyser();
        this._analyser.fftSize = 512;
        this._analyser.smoothingTimeConstant = 0.2;
        this._freqData = new Uint8Array(this._analyser.frequencyBinCount);
        this._limiter.connect(this._analyser);

        var analyserSink = this._ctx.createGain();
        analyserSink.gain.value = 0;
        this._analyser.connect(analyserSink);
        analyserSink.connect(this._ctx.destination);

        this._outputNode.port.onmessage = (e) => {
          if (this.onOutput) this.onOutput(e.data);
        };

        if (this._settingsCache) {
          this.applyAudioSettings(this._settingsCache);
        }

        console.log('[AudioEngine] Initialized, sampleRate:', this._ctx.sampleRate);
        return { sampleRate: this._ctx.sampleRate, channels: 2 };
      })();

      return this._initPromise;
    }

    setNullSink(enabled) {
      this._nullSink = !!enabled;
    }

    releaseContext() {
      const old = this._ctx;
      const oldOutput = this._outputNode;

      this.stop();
      if (oldOutput && oldOutput.port) oldOutput.port.onmessage = null;
      this._detachGraph();

      if (!old) return Promise.resolve();
      let p;
      try { p = old.close(); } catch (e) { return Promise.resolve(); }
      if (!p || !p.then) return Promise.resolve();
      return Promise.race([
        p.catch(function () {  }),
        new Promise(function (r) { setTimeout(r, 2000); }),
      ]);
    }

    recreateContext() {
      return this.releaseContext().then(() => this.init());
    }

    _detachGraph() {
      this._ctx = null;
      this._initPromise = null;
      this._outputNode = null;
      this._analyser = null;
      this._freqData = null;
      this._effectsInput = null;
      this._normGain = null;
      this._eqBands = null;
      this._bassBoost = null;
      this._vbeNode = null;
      this._compressor = null;
      this._vocalFilters = null;
      this._guitarFilters = null;
      this._hearingProtectionFilter = null;
      this._safetyGainNode = null;
      this._eqBandGains = new Array(16).fill(0);
    }

    _ensureCurrentStreamingNode() {
      if (this._currentStreamingNode) return;

      this._currentStreamingNode = this._createStreamingWorkletNode('current');
      this._currentStreamingGain = this._ctx.createGain();
      this._currentStreamingGain.gain.value = this._effectiveVolume();
      this._currentStreamingNode.connect(this._currentStreamingGain);
      this._currentStreamingGain.connect(this._effectsInput || this._outputNode);
    }

    _ensureNextStreamingNode(opts) {
      if (this._nextStreamingNode) return;
      opts = opts || {};

      this._nextStreamingNode = this._createStreamingWorkletNode('next');
      this._nextStreamingGain = this._ctx.createGain();
      this._nextStreamingGain.gain.value = 0;
      this._nextStreamingNode.connect(this._nextStreamingGain);
      this._nextStreamingGain.connect(this._effectsInput || this._outputNode);

      if (opts.paused) {
        try { this._nextStreamingNode.port.postMessage({ type: 'pause' }); } catch (_) {}
      }

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

    _resumeNextStreamingWorklet() {
      if (this._nextStreamingNode) {
        try { this._nextStreamingNode.port.postMessage({ type: 'resume' }); } catch (_) {}

        try { this._nextStreamingNode.port.postMessage({ type: 'baseline' }); } catch (_) {}
        this._nextStreamingConsumedFrames = 0;
      }
    }

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

            if (node !== self._currentStreamingNode) return;

            if (!self._crossfadeActive && self.onStreamEnded) {
              self.onStreamEnded();
            }
          }
          if (data.type === 'position') {
            self._streamingConsumedFrames = data.consumedFrames;
          }

          if (data.type === 'flow_pause' || data.type === 'flow_resume') {
            if (window.__electronAPI) {
              window.__electronAPI.invoke('ffmpeg_flow_control', {
                channel: 'main', pause: data.type === 'flow_pause'
              });
            }
          }
        } else {
          if (data.type === 'ended') {
            self._nextStreamingEnded = true;
          }
          if (data.type === 'position') {
            self._nextStreamingConsumedFrames = data.consumedFrames;
          }

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

    _disposeStreamingNode(node, gain) {
      if (node) {
        try { node.port.postMessage({ type: 'clear' }); } catch (_) {}

        try { node.port.onmessage = null; } catch (_) {}
        try { node.port.close(); } catch (_) {}
        try { node.disconnect(); } catch (_) {}
      }
      if (gain) {
        try { gain.disconnect(); } catch (_) {}
      }
    }

    async playCurrent(filePath, durationMs, seekOffsetMs, startPaused) {
      await this._ensureInit();
      const savedPcm = this._pendingStreamingPcm;
      this.stop();
      this._pendingStreamingPcm = savedPcm;

      const gen = ++this._generation;
      this._currentFilePath = filePath;
      this._currentDurationMs = durationMs;
      this._seekOffsetMs = seekOffsetMs || 0;

      if (filePath.startsWith('http://') || filePath.startsWith('https://')) {
        return;
      }

      const cached = this._cache.get(filePath);
      if (cached) {
        this._currentBuffer = cached;
        this._isPlaying = true;
        this._isPaused = !!startPaused;
        this._createAndStartSource(cached, seekOffsetMs || 0, gen, true);
        if (startPaused) {

          if (this._ctx) this._ctx.suspend();
        } else {
          this._startPositionTimer();
          this._resumeContext();
        }

        this._scheduleGaplessSwitch();
        return;
      }

      try {
        const audioBuffer = await this._loadAndDecode(filePath);
        if (this._generation !== gen) return;

        this._currentBuffer = audioBuffer;
        this._cache.set(filePath, audioBuffer);
        this._isPlaying = true;
        this._isPaused = !!startPaused;
        this._createAndStartSource(audioBuffer, seekOffsetMs || 0, gen, true);
        if (startPaused) {
          if (this._ctx) this._ctx.suspend();
        } else {
          this._startPositionTimer();
          this._resumeContext();
        }

        this._scheduleGaplessSwitch();
      } catch (e) {
        if (this._generation !== gen) return;
        console.error('[AudioEngine] playCurrent: load/decode failed:', filePath, e);
        this._isPlaying = false;
        if (this.onEnded) this.onEnded();
      }
    }

    async playStreaming(durationMs, seekOffsetMs, startPaused) {
      await this._ensureInit();
      const savedPcm = this._pendingStreamingPcm;
      this.stop();

      if (seekOffsetMs > 0) {
        this._pendingStreamingPcm = [];
      } else {
        this._pendingStreamingPcm = savedPcm;
      }
      const gen = ++this._generation;

      this._currentDurationMs = durationMs;
      this._seekOffsetMs = seekOffsetMs || 0;
      this._posHighWater = this._seekOffsetMs;

      this._ensureCurrentStreamingNode();
      this._currentStreamingNode.port.postMessage({ type: 'clear' });
      this._streamingConsumedFrames = 0;
      this._currentStreamingEnded = false;

      if (this._pendingStreamingPcm.length > 0) {

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

        this._streamingBaselinePending = true;
      }

      this._isPlaying = true;
      this._isPaused = !!startPaused;
      this._sourceStartCtxTime = this._ctx.currentTime;
      if (startPaused) {

        if (this._ctx) this._ctx.suspend();
      } else {
        this._resumeContext();
        this._startPositionTimer();
      }
    }

    _createAndStartSource(buffer, offsetMs, generation, isMain) {
      const source = new AudioBufferSourceNode(this._ctx, { buffer: buffer });
      const gain = this._ctx.createGain();
      gain.gain.value = this._effectiveVolume();

      source.connect(gain);
      gain.connect(this._effectsInput || this._outputNode);

      const offsetSec = (offsetMs || 0) / 1000;
      source.start(0, offsetSec);

      if (this._userRate !== 1.0) {
        source.playbackRate.value = this._userRate;
      }

      if (isMain) {
        this._currentSource = source;
        this._currentGain = gain;
        this._sourceStartCtxTime = this._ctx.currentTime;

        this._tlSeed(this._sourceStartCtxTime, offsetMs || 0, this._userRate);
        this._xfadeAnchor = null;
      }

      source.onended = () => {
        if (this._generation !== generation) return;
        if (isMain) {
          if (this._currentSource !== source) return;

          if (this._crossfadeActive) return;

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

    setUserRate(rate) {
      rate = Math.max(0.5, Math.min(2.0, parseFloat(rate) || 1.0));
      if (this._ctx && this._currentSource && this._currentSource.playbackRate) {
        var now = this._ctx.currentTime;

        this._tlPushConst(now, rate);
        this._sourceStartCtxTime = now;
        if (this._currentBuffer) this._seekOffsetMs = this._tlPositionNow();

        var pr = this._currentSource.playbackRate;
        pr.cancelScheduledValues(now);
        pr.setValueAtTime(rate, now);

        if (this.onPositionTick) this.onPositionTick(this.getCurrentPositionMs());
      }
      this._userRate = rate;
    }

    get userRate() { return this._userRate; }

    stop() {
      this._stopCrossfadeTimer();
      this._stopPositionTimer();
      this._stopExpansionEffect();

      this._disposeWash(this._currentWash, null);
      this._currentWash = null;
      this._disposeWash(this._nextWash, null);
      this._nextWash = null;

      this._safeStopSource(this._currentSource);
      this._safeStopSource(this._nextSource);
      this._safeDisconnect(this._currentGain);
      this._safeDisconnect(this._nextGain);

      this._disposeStreamingNode(this._currentStreamingNode, this._currentStreamingGain);
      this._disposeStreamingNode(this._nextStreamingNode, this._nextStreamingGain);

      if (this._vbeNode) this._vbeNode.port.postMessage({ type: 'reset' });

      this._pendingStreamingPcm = [];
      this._pendingNextStreamingPcm = [];
      this._nextStreamingPrimed = false;

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

      this._nextSource = null;
      this._nextGain = null;
      this._nextStreamingNode = null;
      this._nextStreamingGain = null;
      this._nextStreamingConsumedFrames = 0;
      this._nextStreamingEnded = false;
      this._pendingNextStreamingPcm = [];
      this._nextStreamingPrimed = false;

      this._crossfadeActive = false;
      this._pendingBufferToStreamingCrossfade = false;
      this._crossfadePending = false;
      this._crossfadePendingSince = 0;
      this._tempoAdjustActive = 0;
      this._clearCrossfadeTracking();
      this._cancelGaplessSchedule();
      this._xfadeAnchor = null;

      this._isPlaying = false;
      this._isPaused = false;

      this._tlInit();

      this._cache.shrinkTo(16 * 1024 * 1024);

      if (this._ctx && this._ctx.state === 'running') {
        this._ctx.suspend();
      }
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

    async seek(positionMs) {
      await this._ensureInit();
      this._stopExpansionEffect();

      var liveDeck = (!this._currentBuffer && this._currentStreamingGain) ? this._currentStreamingGain : null;
      this._disposeWash(this._currentWash, liveDeck);
      this._currentWash = null;
      this._disposeWash(this._nextWash, null);
      this._nextWash = null;

      this._stopCrossfadeTimer();
      this._crossfadeActive = false;
      this._pendingBufferToStreamingCrossfade = false;
      this._crossfadePending = false;
      this._crossfadePendingSince = 0;
      this._tempoAdjustActive = 0;
      this._clearCrossfadeTracking();
      this._cancelGaplessSchedule();
      this._xfadeAnchor = null;

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

      if (!this._currentBuffer && this._currentStreamingNode) {
        this._currentStreamingNode.port.postMessage({ type: 'clear' });

        if (this._vbeNode) this._vbeNode.port.postMessage({ type: 'reset' });
        this._seekOffsetMs = positionMs;
        this._posHighWater = positionMs;
        this._streamingConsumedFrames = 0;
        this._sourceStartCtxTime = this._ctx.currentTime;
        this._currentStreamingEnded = false;

        this._streamingBaselinePending = true;
        this._stopPositionTimer();
        return;
      }

      if (!this._currentBuffer) {
        return;
      }

      const wasPlaying = this._isPlaying && !this._isPaused;

      this._safeStopSource(this._currentSource);
      this._safeDisconnect(this._currentGain);
      this._currentSource = null;
      this._currentGain = null;

      if (this._vbeNode) this._vbeNode.port.postMessage({ type: 'reset' });

      this._seekOffsetMs = positionMs;
      const gen = ++this._generation;
      this._createAndStartSource(this._currentBuffer, positionMs, gen, true);

      if (wasPlaying) {
        this._resumeContext();
        this._startPositionTimer();
      }

      this._scheduleGaplessSwitch();
    }

    _effectiveVolume() {
      if (this._hearingProtectionEnabled) {
        return Math.min(this._volume, this._SAFETY_MAX_GAIN);
      }
      return this._volume;
    }

    setVolume(level) {
      this._volume = Math.max(0, Math.min(1, level));
      var effectiveVol = this._effectiveVolume();

      if (this._crossfadeActive) {
        this._rescaleActiveCrossfade(effectiveVol);
        this._cachedCrossfadeCurves = null;
        return;
      }
      if (this._currentGain) {
        this._currentGain.gain.value = effectiveVol;
      }
      if (this._currentStreamingGain) {
        this._currentStreamingGain.gain.value = effectiveVol;
      }
      if (this._nextGain) {
        this._nextGain.gain.value = effectiveVol;
      }
      if (this._nextStreamingGain) {
        this._nextStreamingGain.gain.value = effectiveVol;
      }

      if (this._gaplessScheduledGain) {
        this._gaplessScheduledGain.gain.value = effectiveVol;
      }

      this._cachedCrossfadeCurves = null;
    }

    setNormalizationEnabled(enabled) {
      this._normEnabled = !!enabled;
      this._applyNormalizationGain(0.25);
    }

    setNormalizationTarget(lufs) {
      var v = Number(lufs);
      if (!isFinite(v) || v > -5 || v < -30) return;
      this._normTargetLufs = v;
      this._applyNormalizationGain(0.25);
    }

    setTrackLoudness(loudness) {
      if (loudness && isFinite(loudness.integratedLufs)) {
        this._trackLoudness = {
          i: Number(loudness.integratedLufs),
          peak: (typeof loudness.peakDb === 'number' && isFinite(loudness.peakDb))
            ? Number(loudness.peakDb)
            : null,
        };
      } else {
        this._trackLoudness = null;
      }

      this._applyNormalizationGain(0.45);
    }

    _normalizationLinear() {
      if (!this._normEnabled) return 1.0;
      var t = this._trackLoudness;
      if (!t || !isFinite(t.i)) return 1.0;

      var gainDb = this._normTargetLufs - t.i;
      if (t.peak !== null && isFinite(t.peak)) {
        gainDb = Math.min(gainDb, -1 - t.peak);
      }

      if (gainDb > 12) gainDb = 12;
      if (gainDb < -24) gainDb = -24;
      return Math.pow(10, gainDb / 20);
    }

    _applyNormalizationGain(rampSec) {
      var linear = this._normalizationLinear();
      this._normGainDb = linear > 0 ? 20 * Math.log(linear) / Math.LN10 : -Infinity;
      if (!this._normGain || !this._ctx) return linear;

      var g = this._normGain.gain;
      var now = this._ctx.currentTime;
      var ramp = (typeof rampSec === 'number' && rampSec > 0) ? rampSec : 0;
      try {
        if (typeof g.cancelAndHoldAtTime === 'function') g.cancelAndHoldAtTime(now);
        else g.cancelScheduledValues(now);
      } catch (e) {  }

      if (ramp <= 0) {
        g.value = linear;
      } else {

        g.setTargetAtTime(linear, now, ramp / 3);
      }
      return linear;
    }

    _rescaleActiveCrossfade(amplitude) {
      if (!this._ctx) return;
      var t0 = this._crossfadeStartCtxTime;
      var duration = this._crossfadeDurationSec;
      if (!(duration > 0) || !(t0 >= 0)) return;

      var now = this._ctx.currentTime;
      var elapsed = Math.max(0, Math.min(duration, now - t0));
      var progress = duration > 0 ? elapsed / duration : 1;
      var tail = Math.max(0.01, duration - elapsed);

      var full = computeEqualPowerCurves(
        Math.max(2, Math.round(duration * this._ctx.sampleRate)), amplitude
      );
      var outTail = this._subCurve(full.fadeOut, progress);
      var inTail = this._subCurve(full.fadeIn, progress);

      var outNode = this._crossfadeOutNode;
      var inNode = this._crossfadeInNode;
      try {
        if (outNode) {
          outNode.gain.cancelScheduledValues(now);
          outNode.gain.setValueCurveAtTime(outTail, now, tail);
        }
        if (inNode) {
          inNode.gain.cancelScheduledValues(now);
          inNode.gain.setValueCurveAtTime(inTail, now, tail);
        }
      } catch (e) {

        try {
          if (outNode) outNode.gain.value = amplitude;
          if (inNode) inNode.gain.value = amplitude;
        } catch (_) {}
      }
    }

    _subCurve(curve, fromProgress) {
      var n = curve.length;
      if (n < 2) return new Float32Array([curve[0] || 0, curve[0] || 0]);
      var p = Math.max(0, Math.min(1, fromProgress));
      var startIdx = Math.min(n - 2, Math.floor(p * (n - 1)));
      var out = new Float32Array(n - startIdx);
      for (var i = 0; i < out.length; i++) out[i] = curve[startIdx + i];
      return out;
    }

    async setNextInfo(filePath, durationMs, forceStreaming) {
      this._nextFilePath = filePath;
      this._nextDurationMs = durationMs;

      this._nextIsStreaming = forceStreaming ||
        filePath.startsWith('http://') || filePath.startsWith('https://');

      if (this._nextIsStreaming) {

        console.log('[AudioEngine] setNextInfo: streaming mode, skip buffer load:', filePath);

        if (this._ctx) {
          try {
            this._ensureNextStreamingNode({ paused: true });
          } catch (e) {
            console.warn('[AudioEngine] setNextInfo: early worklet create failed:', e.message);
          }
        }
        return;
      }

      const cached = this._cache.get(filePath);
      if (cached) {
        this._nextBuffer = cached;
        console.log('[AudioEngine] Next buffer from cache:', filePath);

        this._scheduleGaplessSwitch();

        this._checkCrossfadeTrigger();
        return;
      }

      var lastErr = null;
      for (var attempt = 0; attempt < 2; attempt++) {
        try {
          const buf = await this._loadAndDecode(filePath);
          if (this._nextFilePath !== filePath) {
            console.log('[AudioEngine] Next file changed during load, discarding:', filePath);
            return;
          }
          this._nextBuffer = buf;

          this._cache.set(filePath, buf);
          console.log('[AudioEngine] Next buffer loaded (attempt ' + (attempt + 1) + '):', filePath,
            'duration=' + (buf ? buf.duration.toFixed(1) + 's' : 'null'));

          this._scheduleGaplessSwitch();

          this._checkCrossfadeTrigger();
          return;
        } catch (e) {
          lastErr = e;
          console.error('[AudioEngine] Next buffer load failed (attempt ' + (attempt + 1) + '):',
            filePath, e.message || e);
          if (attempt === 0) {

            await new Promise(function (r) { setTimeout(r, 2000); });

            if (this._nextFilePath !== filePath) {
              console.log('[AudioEngine] Next file changed during retry wait, aborting:', filePath);
              return;
            }
          }
        }
      }

      console.error('[AudioEngine] Next buffer load gave up after retries:', filePath,
        lastErr ? lastErr.message : 'unknown error');

      this._checkCrossfadeTrigger();
    }

    startCrossfade() {

      this._startExpansionEffect();
      var currentIsBuffer = !!this._currentBuffer;
      var nextIsBuffer = !!this._nextBuffer;
      var nextIsStreaming = this._nextIsStreaming || this._nextStreamingNode != null;

      if (currentIsBuffer && nextIsBuffer && !nextIsStreaming) {
        this._startBufferCrossfade();
      } else if (currentIsBuffer && nextIsStreaming) {

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

        this._startStreamingToBufferCrossfade();
      } else {
        console.warn('[AudioEngine] startCrossfade: unsupported mode combination',
          'currentBuffer:', currentIsBuffer, 'nextBuffer:', nextIsBuffer,
          'nextStreaming:', nextIsStreaming);
      }
    }

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

      const now = this._ctx.currentTime;

      this._engageOutgoingWash(this._currentStreamingGain, now, cfSec);
      var curves = this._getCrossfadeCurves(cfFrames);
      var fadeOut = curves.fadeOut;
      var fadeIn = curves.fadeIn;
      if (this._currentStreamingGain) {
        this._currentStreamingGain.gain.setValueCurveAtTime(fadeOut, now, cfSec);
      }

      var nextSrc = new AudioBufferSourceNode(this._ctx, { buffer: this._nextBuffer });
      var nextGain = this._ctx.createGain();
      nextGain.gain.value = 0;
      nextSrc.connect(nextGain);

      if (!this._routeIncomingWash(nextGain, now, cfSec)) {
        nextGain.connect(this._effectsInput || this._outputNode);
      }

      var nextOffsetSec = 0;
      if (this._transitionPlan && this._transitionPlan.nextStartOffsetMs > 0) {
        nextOffsetSec = Math.min(
          this._transitionPlan.nextStartOffsetMs / 1000,
          this._nextBuffer.duration - 0.1
        );
      }

      var tempoAdjust = this._getTempoAdjust();
      if (tempoAdjust !== 1.0) {
        nextSrc.playbackRate.value = this._userRate * tempoAdjust;
        this._tempoAdjustActive = tempoAdjust;
        console.log('[AudioEngine] Tempo adjust (crossfade):', tempoAdjust.toFixed(4),
          '(cur=' + (this._transitionPlan ? this._transitionPlan.bpmCurrent : '?') +
          ' next=' + (this._transitionPlan ? this._transitionPlan.bpmNext : '?') + ')');
      } else {
        this._tempoAdjustActive = 0;
      }

      nextSrc.start(0, nextOffsetSec);
      nextGain.gain.setValueCurveAtTime(fadeIn, now, cfSec);

      this._xfadeAnchor = {
        ctxTime: now,
        baseMs: Math.round(nextOffsetSec * 1000),
        rate: (tempoAdjust !== 1.0) ? this._userRate * tempoAdjust : this._userRate,
        streaming: false,
      };

      this._nextSource = nextSrc;
      this._nextGain = nextGain;
      this._trackCrossfade(this._currentStreamingGain, nextGain, now, cfSec);

      console.log('[AudioEngine] Streaming→Buffer crossfade start:', cfMs, 'ms');
      if (this.onCrossfadeStart) this.onCrossfadeStart();

      this._crossfadeTimer = setTimeout(() => {
        this._finishTransition();
      }, cfMs + 50);
    }

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

      const now = this._ctx.currentTime;

      this._engageOutgoingWash(this._currentGain, now, cfSec);

      var curves = this._getCrossfadeCurves(cfFrames);
      var fadeOut = curves.fadeOut;
      var fadeIn = curves.fadeIn;

      const nextSrc = new AudioBufferSourceNode(this._ctx, { buffer: this._nextBuffer });
      const nextGain = this._ctx.createGain();
      nextGain.gain.value = 0;
      nextSrc.connect(nextGain);

      if (!this._routeIncomingWash(nextGain, now, cfSec)) {
        nextGain.connect(this._effectsInput || this._outputNode);
      }

      var nextOffsetSec = 0;
      if (this._transitionPlan && this._transitionPlan.nextStartOffsetMs > 0) {
        nextOffsetSec = Math.min(
          this._transitionPlan.nextStartOffsetMs / 1000,
          this._nextBuffer.duration - 0.1
        );
      }

      var rawAdjust = this._transitionPlan ? this._transitionPlan.bpmTempoAdjust : 0;
      var incomingRate = this._userRate;
      if (typeof rawAdjust === 'number' && isFinite(rawAdjust) && rawAdjust > 0 && rawAdjust !== 1.0) {

        var clamped = Math.max(0.80, Math.min(1.25, rawAdjust));
        var half = Math.sqrt(clamped);
        nextSrc.playbackRate.value = this._userRate * half;
        this._tempoAdjustActive = half;
        incomingRate = this._userRate * half;
        if (this._currentSource && this._currentSource.playbackRate) {
          var pr = this._currentSource.playbackRate;
          pr.cancelScheduledValues(now);
          pr.setValueAtTime(this._userRate, now);
          pr.linearRampToValueAtTime(this._userRate / half, now + cfSec * 0.85);

          this._tlPushRamp(now, this._userRate, this._userRate / half, cfSec * 0.85);
        }
        console.log('[AudioEngine] Tempo converge (crossfade): cur ×' + (1 / half).toFixed(4) +
          ' ↔ next ×' + half.toFixed(4) +
          ' (cur=' + (this._transitionPlan ? this._transitionPlan.bpmCurrent : '?') +
          ' next=' + (this._transitionPlan ? this._transitionPlan.bpmNext : '?') + ' bpm)');
      } else {
        this._tempoAdjustActive = 0;
      }

      nextSrc.start(0, nextOffsetSec);

      this._xfadeAnchor = {
        ctxTime: now,
        baseMs: Math.round(nextOffsetSec * 1000),
        rate: incomingRate,
        streaming: false,
      };

      this._nextSource = nextSrc;
      this._nextGain = nextGain;

      this._currentGain.gain.setValueCurveAtTime(fadeOut, now, cfSec);
      nextGain.gain.setValueCurveAtTime(fadeIn, now, cfSec);
      this._trackCrossfade(this._currentGain, nextGain, now, cfSec);

      console.log('[AudioEngine] Buffer crossfade start:', cfMs, 'ms');
      if (this.onCrossfadeStart) this.onCrossfadeStart();

      this._crossfadeTimer = setTimeout(() => {
        this._finishTransition();
      }, cfMs + 50);
    }

    _startStreamingCrossfade() {
      if (!this._currentStreamingNode) {
        console.warn('[AudioEngine] _startStreamingCrossfade: no current streaming node');
        return;
      }

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

      this._resumeNextStreamingWorklet();

      var curves = this._getCrossfadeCurves(cfFrames);
      var fadeOut = curves.fadeOut;
      var fadeIn = curves.fadeIn;

      const now = this._ctx.currentTime;

      this._engageOutgoingWash(this._currentStreamingGain, now, cfSec);
      this._routeIncomingWash(this._nextStreamingGain, now, cfSec);
      if (this._currentStreamingGain) {
        this._currentStreamingGain.gain.setValueCurveAtTime(fadeOut, now, cfSec);
      }

      this._nextStreamingGain.gain.setValueCurveAtTime(fadeIn, now, cfSec);
      this._trackCrossfade(this._currentStreamingGain, this._nextStreamingGain, now, cfSec);

      this._xfadeAnchor = { ctxTime: now, baseMs: 0, rate: 1, streaming: true };

      console.log('[AudioEngine] Streaming crossfade start:', cfMs, 'ms');
      if (this.onCrossfadeStart) this.onCrossfadeStart();

      this._crossfadeTimer = setTimeout(() => {
        this._finishTransition();
      }, cfMs + 50);
    }

    _startBufferToStreamingCrossfade() {
      this._pendingBufferToStreamingCrossfade = false;

      this._ensureNextStreamingNode();

      const cfMs = this._getEffectiveCrossfadeMs();
      const cfSec = cfMs / 1000;
      const cfFrames = Math.round(cfSec * this._ctx.sampleRate);
      if (cfFrames <= 0) {
        this._finishTransition();
        return;
      }

      this._crossfadeActive = true;

      this._resumeNextStreamingWorklet();

      var curves = this._getCrossfadeCurves(cfFrames);
      var fadeOut = curves.fadeOut;
      var fadeIn = curves.fadeIn;

      const now = this._ctx.currentTime;

      this._engageOutgoingWash(this._currentGain, now, cfSec);
      this._routeIncomingWash(this._nextStreamingGain, now, cfSec);

      if (this._currentGain) {
        this._currentGain.gain.setValueCurveAtTime(fadeOut, now, cfSec);
      }

      if (this._nextStreamingGain) {
        this._nextStreamingGain.gain.value = 0;
        this._nextStreamingGain.gain.setValueCurveAtTime(fadeIn, now, cfSec);
      }
      this._trackCrossfade(this._currentGain, this._nextStreamingGain, now, cfSec);

      this._xfadeAnchor = { ctxTime: now, baseMs: 0, rate: 1, streaming: true };

      console.log('[AudioEngine] Buffer→Streaming crossfade start:', cfMs, 'ms');
      if (this.onCrossfadeStart) this.onCrossfadeStart();

      this._crossfadeTimer = setTimeout(() => {
        this._finishTransition();
      }, cfMs + 50);
    }

    _createWashChain(role, deckGain) {
      var input = this._ctx.createGain();
      var highpass = this._ctx.createBiquadFilter();
      highpass.type = 'highpass';
      highpass.Q.value = 0.6;
      highpass.frequency.value = WASH_NEUTRAL.highpass;
      var lowpass = this._ctx.createBiquadFilter();
      lowpass.type = 'lowpass';
      lowpass.Q.value = 0.55;
      lowpass.frequency.value = WASH_NEUTRAL.lowpass;
      var comp = this._ctx.createDynamicsCompressor();
      comp.knee.value = role === 'out' ? 14 : 10;

      comp.attack.value = role === 'out' ? 0.004 : 0.008;
      comp.release.value = role === 'out' ? 0.35 : 0.28;
      comp.threshold.value = WASH_NEUTRAL.threshold;
      comp.ratio.value = WASH_NEUTRAL.ratio;
      var makeup = this._ctx.createGain();
      makeup.gain.value = WASH_NEUTRAL.makeup;
      input.connect(highpass);
      highpass.connect(lowpass);
      lowpass.connect(comp);
      comp.connect(makeup);
      return {
        role: role,
        deckGain: deckGain || null,
        input: input,
        highpass: highpass,
        lowpass: lowpass,
        comp: comp,
        makeup: makeup,
        output: makeup,
        restoreTimer: null,
      };
    }

    _engageOutgoingWash(deckGain, t0, cfSec) {
      if (!this._ctx || !deckGain) return null;

      this._disposeWash(this._currentWash, deckGain);
      var wash = this._createWashChain('out', deckGain);
      try {
        deckGain.disconnect();
        deckGain.connect(wash.input);
        wash.output.connect(this._effectsInput || this._outputNode);
      } catch (e) {
        this._disposeWash(wash, null);
        return null;
      }
      var deepenSec = Math.max(0.35, cfSec * 0.7);
      wash.lowpass.frequency.setValueAtTime(WASH_NEUTRAL.lowpass, t0);
      wash.lowpass.frequency.exponentialRampToValueAtTime(WASH_OUT_DEEP.lowpass, t0 + deepenSec);
      wash.highpass.frequency.setValueAtTime(WASH_NEUTRAL.highpass, t0);
      wash.highpass.frequency.exponentialRampToValueAtTime(WASH_OUT_DEEP.highpass, t0 + deepenSec);
      wash.comp.threshold.setValueAtTime(WASH_NEUTRAL.threshold, t0);
      wash.comp.threshold.linearRampToValueAtTime(WASH_OUT_DEEP.threshold, t0 + deepenSec);
      wash.comp.ratio.setValueAtTime(WASH_NEUTRAL.ratio, t0);
      wash.comp.ratio.linearRampToValueAtTime(WASH_OUT_DEEP.ratio, t0 + deepenSec);
      wash.makeup.gain.setValueAtTime(WASH_NEUTRAL.makeup, t0);
      wash.makeup.gain.linearRampToValueAtTime(WASH_OUT_DEEP.makeup, t0 + deepenSec);
      this._currentWash = wash;
      return wash;
    }

    _routeIncomingWash(deckGain, t0, cfSec) {
      if (!this._ctx || !deckGain) return null;
      this._disposeWash(this._nextWash, null);
      var wash = this._createWashChain('in', deckGain);
      try {

        deckGain.disconnect();
        deckGain.connect(wash.input);
        wash.output.connect(this._effectsInput || this._outputNode);
      } catch (e) {
        this._disposeWash(wash, null);
        return null;
      }

      wash.lowpass.frequency.setValueAtTime(WASH_IN_START.lowpass, t0);
      wash.highpass.frequency.setValueAtTime(WASH_IN_START.highpass, t0);
      wash.comp.threshold.setValueAtTime(WASH_IN_START.threshold, t0);
      wash.comp.ratio.setValueAtTime(WASH_IN_START.ratio, t0);
      wash.makeup.gain.setValueAtTime(WASH_IN_START.makeup, t0);

      var settleSec = Math.max(2.2, Math.min(5.0, cfSec * 0.75));
      var t1 = t0 + cfSec;
      wash.lowpass.frequency.setValueAtTime(WASH_IN_START.lowpass, t1);
      wash.lowpass.frequency.exponentialRampToValueAtTime(WASH_NEUTRAL.lowpass, t1 + settleSec);
      wash.highpass.frequency.setValueAtTime(WASH_IN_START.highpass, t1);
      wash.highpass.frequency.exponentialRampToValueAtTime(WASH_NEUTRAL.highpass, t1 + settleSec);
      wash.comp.threshold.setValueAtTime(WASH_IN_START.threshold, t1);
      wash.comp.threshold.linearRampToValueAtTime(WASH_NEUTRAL.threshold, t1 + settleSec);
      wash.comp.ratio.setValueAtTime(WASH_IN_START.ratio, t1);
      wash.comp.ratio.linearRampToValueAtTime(WASH_NEUTRAL.ratio, t1 + settleSec);
      wash.makeup.gain.setValueAtTime(WASH_IN_START.makeup, t1);
      wash.makeup.gain.linearRampToValueAtTime(WASH_NEUTRAL.makeup, t1 + settleSec);

      var self = this;
      wash.restoreTimer = setTimeout(function () {
        wash.restoreTimer = null;
        var live = wash.deckGain &&
          (wash.deckGain === self._currentGain || wash.deckGain === self._currentStreamingGain);
        self._disposeWash(wash, live ? wash.deckGain : null);
        if (self._currentWash === wash) self._currentWash = null;
        if (self._nextWash === wash) self._nextWash = null;
      }, Math.ceil((cfSec + settleSec + 0.3) * 1000));
      this._nextWash = wash;
      return wash;
    }

    _disposeWash(wash, liveDeckGain) {
      if (!wash) return;
      if (wash.restoreTimer) {
        clearTimeout(wash.restoreTimer);
        wash.restoreTimer = null;
      }
      if (liveDeckGain) {
        try { liveDeckGain.disconnect(); } catch (_) {}
        try { liveDeckGain.connect(this._effectsInput || this._outputNode); } catch (_) {}
      }
      var nodes = [wash.input, wash.highpass, wash.lowpass, wash.comp, wash.makeup];
      for (var i = 0; i < nodes.length; i++) this._safeDisconnect(nodes[i]);
    }

    _finishTransition() {
      this._stopExpansionEffect();
      this._crossfadeActive = false;
      this._crossfadeTimer = null;
      this._pendingBufferToStreamingCrossfade = false;
      this._crossfadePending = false;
      this._crossfadePendingSince = 0;

      this._clearCrossfadeTracking();

      this._disposeWash(this._currentWash, null);
      this._currentWash = this._nextWash;
      this._nextWash = null;

      var hadNextStreaming = !!this._nextStreamingNode;
      var hadNextBuffer = !!this._nextSource || !!this._nextBuffer;

      this._safeStopSource(this._currentSource);
      this._safeDisconnect(this._currentGain);
      this._currentSource = null;
      this._currentGain = null;
      this._currentBuffer = null;

      if (this._currentStreamingNode) {
        this._disposeStreamingNode(this._currentStreamingNode, this._currentStreamingGain);
        this._currentStreamingNode = null;
        this._currentStreamingGain = null;
      }

      if (hadNextStreaming) {
        this._promoteNextStreamingToCurrent();
      } else if (hadNextBuffer) {

        this._currentSource = this._nextSource;
        this._currentGain = this._nextGain;
        this._currentBuffer = this._nextBuffer;

        this._sourceStartCtxTime = (this._xfadeAnchor && this._xfadeAnchor.ctxTime != null)
          ? this._xfadeAnchor.ctxTime
          : this._ctx.currentTime;

        if (this._currentGain) {
          try {
            this._currentGain.gain.cancelScheduledValues(this._ctx.currentTime);
          } catch (_) {}
          this._currentGain.gain.value = this._effectiveVolume();
        }
      }

      var cfMs = this._getEffectiveCrossfadeMs();
      var nextOffset = (this._transitionPlan && this._transitionPlan.nextStartOffsetMs > 0)
        ? this._transitionPlan.nextStartOffsetMs : 0;
      var tempoAdj = this._tempoAdjustActive;
      var anchor = this._xfadeAnchor;
      this._xfadeAnchor = null;

      if (hadNextStreaming) {

        this._seekOffsetMs = anchor ? anchor.baseMs : nextOffset;
        this._tlSeed(this._ctx.currentTime, this._seekOffsetMs, 1);
      } else if (hadNextBuffer) {

        var anchorT, anchorBase, anchorRate;
        if (anchor) {
          anchorT = anchor.ctxTime;
          anchorBase = anchor.baseMs;
          anchorRate = anchor.rate > 0 ? anchor.rate : this._userRate;
        } else {

          anchorRate = this._userRate;
          anchorBase = nextOffset + Math.round(cfMs * anchorRate);
          anchorT = this._ctx.currentTime;
        }
        this._seekOffsetMs = anchorBase;
        this._tlSeed(anchorT, anchorBase, anchorRate);
      } else {

        this._seekOffsetMs = cfMs;
      }

      this._currentDurationMs = this._nextDurationMs;
      this._currentFilePath = this._nextFilePath;

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

      var transitionPlan = this._transitionPlan;
      var tempoRampMs = transitionPlan && transitionPlan.tempoRampMs > 0
        ? transitionPlan.tempoRampMs : 3000;

      this._transitionPlan = null;
      this._cachedCrossfadeCurves = null;

      if (tempoAdj > 0 && tempoAdj !== 1.0 && this._currentSource && this._currentSource.playbackRate) {
        var rampSec = Math.max(1.8, Math.min(4.0, tempoRampMs / 1000));
        var pr = this._currentSource.playbackRate;
        var rampStart = this._ctx.currentTime;
        pr.cancelScheduledValues(rampStart);
        pr.setValueAtTime(this._userRate * tempoAdj, rampStart);
        pr.linearRampToValueAtTime(this._userRate, rampStart + rampSec);
        if (hadNextBuffer) {
          this._tlPushRamp(rampStart, this._userRate * tempoAdj, this._userRate, rampSec);
        }
        console.log('[AudioEngine] Tempo ramp-back:', tempoAdj.toFixed(4), '→ user rate over', rampSec, 's');
      }
      this._tempoAdjustActive = 0;

      console.log('[AudioEngine] Crossfade complete, seekOffset:', this._seekOffsetMs,
        'pos:', Math.round(this.getCurrentPositionMs()));
      if (this.onCrossfadeComplete) this.onCrossfadeComplete(this.getCurrentPositionMs());
    }

    _promoteNextStreamingToCurrent() {
      this._currentStreamingNode = this._nextStreamingNode;
      this._currentStreamingGain = this._nextStreamingGain;
      this._streamingConsumedFrames = this._nextStreamingConsumedFrames;
      this._currentStreamingEnded = this._nextStreamingEnded;
      this._sourceStartCtxTime = this._ctx.currentTime;

      if (this._currentStreamingNode) {
        try { this._currentStreamingNode.port.postMessage({ type: 'resume' }); } catch (_) {}
      }

      if (this._currentStreamingGain) {
        this._currentStreamingGain.gain.cancelScheduledValues(this._ctx.currentTime);
        this._currentStreamingGain.gain.value = this._effectiveVolume();
      }

      var self = this;
      var node = this._currentStreamingNode;
      this._currentStreamingNode.port.onmessage = function (e) {
        var data = e.data;
        if (data.type === 'ended') {
          self._currentStreamingEnded = true;

          if (node !== self._currentStreamingNode) return;
          if (!self._crossfadeActive && self.onStreamEnded) {
            self.onStreamEnded();
          }
        }
        if (data.type === 'position') {
          self._streamingConsumedFrames = data.consumedFrames;
        }

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

    _scheduleGaplessSwitch() {
      if (!this._gaplessEnabled) return;
      if (this._crossfadeEnabled) return;
      if (!this._currentBuffer || !this._nextBuffer) return;
      if (this._nextIsStreaming) return;
      if (this._gaplessScheduledSource) return;
      if (!this._isPlaying || this._isPaused) return;

      var posMs = this._tlPositionNow();
      var gRate = (this._userRate > 0) ? this._userRate : 1;
      var remainingSec = (this._currentBuffer.duration * 1000 - posMs) / (1000 * gRate);
      if (remainingSec <= 0.1) return;

      var endTime = this._ctx.currentTime + remainingSec;
      if (endTime <= this._ctx.currentTime + 0.05) return;

      var nextSrc = new AudioBufferSourceNode(this._ctx, { buffer: this._nextBuffer });
      var nextGain = this._ctx.createGain();
      nextGain.gain.value = this._effectiveVolume();
      nextSrc.connect(nextGain);
      nextGain.connect(this._effectsInput || this._outputNode);

      nextSrc.start(endTime, 0);

      this._gaplessScheduledSource = nextSrc;
      this._gaplessScheduledGain = nextGain;
      this._gaplessScheduledEndTime = endTime;

      console.log('[AudioEngine] Gapless scheduled: next starts in',
        Math.round((endTime - this._ctx.currentTime) * 1000) + 'ms');
    }

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

    _promoteGaplessScheduled() {
      if (!this._gaplessScheduledSource) return;

      if (this._currentSource) {
        try { this._currentSource.onended = null; } catch (_) {}
        try { this._currentSource.disconnect(); } catch (_) {}
      }
      if (this._currentGain) {
        try { this._currentGain.disconnect(); } catch (_) {}
      }

      this._currentSource = this._gaplessScheduledSource;
      this._currentGain = this._gaplessScheduledGain;
      this._currentBuffer = this._nextBuffer;
      this._sourceStartCtxTime = this._gaplessScheduledEndTime;
      this._seekOffsetMs = 0;

      this._tlSeed(this._gaplessScheduledEndTime, 0, this._userRate);

      this._currentFilePath = this._nextFilePath;
      this._currentDurationMs = this._nextDurationMs;

      var source = this._currentSource;
      var gen = this._generation;
      var self = this;

      this._gaplessScheduledSource = null;
      this._gaplessScheduledGain = null;
      this._gaplessScheduledEndTime = 0;

      this._nextSource = null;
      this._nextGain = null;
      this._nextBuffer = null;
      this._nextFilePath = '';
      this._nextDurationMs = 0;
      this._nextIsStreaming = false;

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

      var cb = this.onGaplessSwitch;
      if (cb) {
        setTimeout(function () { cb(); }, 0);
      }
    }

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

    _switchToNextStreaming() {
      if (!this._nextStreamingNode) {

        console.warn('[AudioEngine] Gapless switch (streaming): next node not ready');
        return false;
      }

      this._disposeStreamingNode(this._currentStreamingNode, this._currentStreamingGain);
      this._currentStreamingNode = null;
      this._currentStreamingGain = null;
      this._currentBuffer = null;

      this._promoteNextStreamingToCurrent();

      this._currentFilePath = this._nextFilePath;
      this._currentDurationMs = this._nextDurationMs;
      this._seekOffsetMs = 0;

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

    /* ================= 播放时间轴（进度的唯一真相源） =================
     * 位置 = 锚点位置 + ∫播放速率 dt（对 AudioContext 渲染时钟积分）。
     *
     * 🔴 两条铁律（违反就会让"前端进度慢于实际播放"，且是整首歌永久的偏移）：
     * 1. 锚点时刻必须是**排定的音频时钟时刻**，绝不能用 setTimeout 的触发时刻。
     *    定时器只会晚不会早——交叉淡变期间渲染线程正忙于 wash 链/动画/歌词，
     *    晚 50~500ms 是常态；拿触发时刻当锚点＝整首歌进度永久往后推那么多。
     * 2. playbackRate 变化必须**积分**。过渡的 tempo 收敛/回正是斜坡，
     *    用"已过时间 × 当前速率"会在减速阶段算出"进度倒退 + 永久落后"。
     */
    _tlInit() {
      this._tlCursor = 0;
      this._tlPos = 0;
      this._posHighWater = 0;
      this._tlSegs = [{ t0: 0, t1: Infinity, r0: 1, r1: 1 }];
    }

    _tlSeed(ctxTime, posMs, rate) {
      rate = (rate > 0 && isFinite(rate)) ? rate : 1;
      this._tlCursor = ctxTime;
      this._tlPos = posMs;
      this._posHighWater = posMs;
      this._tlSegs = [{ t0: ctxTime, t1: Infinity, r0: rate, r1: rate }];
    }

    _tlRateIn(seg, t) {
      if (!(seg.t1 > seg.t0)) return seg.r1;
      var f = (t - seg.t0) / (seg.t1 - seg.t0);
      if (f < 0) f = 0; else if (f > 1) f = 1;
      return seg.r0 + (seg.r1 - seg.r0) * f;
    }

    _tlFlush(now) {
      if (now <= this._tlCursor) return;
      var t = this._tlCursor;
      var guard = 0;
      while (t < now - 1e-6 && guard++ < 64) {
        var seg = this._tlSegs[0];
        if (!seg) {
          seg = { t0: t, t1: Infinity, r0: 1, r1: 1 };
          this._tlSegs.push(seg);
        }
        var t1 = Math.min(now, seg.t1);
        var rA = this._tlRateIn(seg, t);
        var rB = this._tlRateIn(seg, t1);

        this._tlPos += (t1 - t) * (rA + rB) * 500;
        t = t1;
        if (t1 >= seg.t1) this._tlSegs.shift();
        else break;
      }
      this._tlCursor = now;
    }

    _tlPushConst(ctxTime, rate) {
      this._tlFlush(ctxTime);
      this._tlSegs.length = 0;
      var r = (rate > 0 && isFinite(rate)) ? rate : 1;
      this._tlSegs.push({ t0: ctxTime, t1: Infinity, r0: r, r1: r });
    }

    _tlPushRamp(ctxTime, fromRate, toRate, durSec) {
      if (!(durSec > 0.01)) {
        this._tlPushConst(ctxTime, toRate);
        return;
      }
      this._tlFlush(ctxTime);
      var last = this._tlSegs[this._tlSegs.length - 1];
      if (last && last.t1 > ctxTime) last.t1 = ctxTime;
      var end = ctxTime + durSec;
      this._tlSegs.push({ t0: ctxTime, t1: end, r0: fromRate, r1: toRate });
      this._tlSegs.push({ t0: end, t1: Infinity, r0: toRate, r1: toRate });
    }

    _tlPositionNow() {
      this._tlFlush(this._ctx ? this._ctx.currentTime : 0);
      return this._tlPos;
    }

    _currentLatencyMs() {
      var total = this._dllBufferLatencyMs + 100;
      if (this._ctx && this._ctx.outputLatency) {
        total += Math.round(this._ctx.outputLatency * 1000);
      } else if (this._ctx && this._ctx.baseLatency) {
        total += Math.round(this._ctx.baseLatency * 1000);
      }
      return total;
    }

    getCurrentPositionMs() {
      if (!this._isPlaying) return this._seekOffsetMs;

      var latency = this._currentLatencyMs();
      var pos = -1;

      if (!this._currentBuffer && this._currentStreamingNode) {
        var elapsedMs = (this._streamingConsumedFrames / this._ctx.sampleRate) * 1000;
        pos = this._seekOffsetMs + elapsedMs - latency;
      } else if (this._ctx) {
        pos = this._tlPositionNow() - latency;
      } else {
        return this._seekOffsetMs;
      }

      if (!(pos >= 0)) pos = 0;

      if (pos > this._posHighWater || pos < this._posHighWater - 400) {
        this._posHighWater = pos;
      }
      return this._posHighWater;
    }

    getPlaybackSnapshot() {
      return {
        positionMs: Math.round(this.getCurrentPositionMs()),
        durationMs: this._currentDurationMs || 0,
        rate: this._userRate,
        playing: this._isPlaying,
        paused: this._isPaused,
        crossfading: this._crossfadeActive,
        sourceKind: this._currentBuffer ? 'buffer'
          : (this._currentStreamingNode ? 'streaming' : 'none'),
        latencyMs: Math.round(this._currentLatencyMs()),
        streamingConsumedFrames: this._streamingConsumedFrames,
        anchoredAt: this._tlCursor,
      };
    }

    setDllBufferLatency(ms) {
      this._dllBufferLatencyMs = ms || 0;
    }

    setCrossfadeEnabled(enabled) { this._crossfadeEnabled = !!enabled; }
    setRadicalTransitionsEnabled(enabled) { this._radicalTransitions = !!enabled; }
    setCrossfadeDuration(ms) { this._crossfadeDurationMs = ms; this._cachedCrossfadeCurves = null; }
    setGaplessEnabled(enabled) { this._gaplessEnabled = !!enabled; }

    setEqEnabled(enabled) {
      this._eqEnabled = !!enabled;
      if (!this._eqBands) return;
      for (var i = 0; i < this._eqBands.length; i++) {
        this._eqBands[i].gain.value = enabled ? (this._eqBandGains[i] || 0) : 0;
      }
      this._updateEffectsGain();
    }

    setEqBand(index, gainDb) {
      if (!this._eqBands || index < 0 || index >= this._eqBands.length) return;
      this._eqBandGains[index] = gainDb;
      if (this._eqEnabled) {
        this._eqBands[index].gain.value = gainDb;
      }
      this._updateEffectsGain();
    }

    applyAudioSettings(settings) {
      this._settingsCache = settings;
      if (!this._eqBands) return;

      var bands = settings.eq_bands;
      if (Array.isArray(bands)) {
        for (var i = 0; i < bands.length && i < this._eqBandGains.length; i++) {
          this._eqBandGains[i] = bands[i] || 0;
        }
      }

      this._eqEnabled = !!settings.eq_enabled;
      for (var i = 0; i < this._eqBands.length; i++) {
        this._eqBands[i].gain.value = this._eqEnabled ? (this._eqBandGains[i] || 0) : 0;
      }

      this._bassEnabled = !!settings.dynamic_bass;
      if (this._bassBoost) this._bassBoost.gain.value = this._bassEnabled ? 6 : 0;

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

      this._vocalEnabled = !!settings.vocal_enhance;
      this._applyVocalFilters();

      this._guitarEnabled = !!settings.guitar_friendly;
      this._applyGuitarFilters();

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

      this._normEnabled = !!settings.volume_normalization;
      if (settings.volume_normalization_target !== undefined) {
        var lufs = Number(settings.volume_normalization_target);
        if (isFinite(lufs) && lufs <= -5 && lufs >= -30) this._normTargetLufs = lufs;
      }
      this._applyNormalizationGain(0);

      this._hearingProtectionEnabled = !!settings.hearing_protection;
      this._applyHearingProtection();

      this._updateEffectsGain();
      console.log('[AudioEngine] Audio effects applied: eq=' + this._eqEnabled +
        ', bass=' + this._bassEnabled + ', comp=' + this._compressorEnabled +
        ', vocal=' + this._vocalEnabled + ', guitar=' + this._guitarEnabled +
        ', vbe=' + this._vbeEnabled +
        ', norm=' + this._normEnabled + '(' + this._normGainDb.toFixed(1) + 'dB)' +
        ', hearingProtection=' + this._hearingProtectionEnabled);
    }

    _sendVbeParams() {
      if (!this._vbeNode) return;
      this._vbeNode.port.postMessage({
        type: 'params',
        params: Object.assign({ enabled: this._vbeEnabled }, this._vbeParams),
      });
    }

    setVirtualBass(enabled) {
      this._vbeEnabled = !!enabled;
      if (this._vbeNode) {
        this._vbeNode.port.postMessage({ type: 'enabled', value: this._vbeEnabled });
      }
      this._updateEffectsGain();
    }

    setVbeParam(name, value) {
      if (!this._vbeParams.hasOwnProperty(name)) return;
      this._vbeParams[name] = value;
      if (this._vbeNode) {
        this._vbeNode.port.postMessage({ type: 'param', name: name, value: value });
      }
      this._updateEffectsGain();
    }

    setDynamicBass(enabled) {
      this._bassEnabled = !!enabled;
      if (!this._bassBoost) return;
      this._bassBoost.gain.value = enabled ? 6 : 0;
      this._updateEffectsGain();
    }

    setVocalEnhance(enabled) {
      this._vocalEnabled = !!enabled;
      this._applyVocalFilters();
      this._updateEffectsGain();
    }

    _applyVocalFilters() {
      if (!this._vocalFilters) return;
      var gains = [-3, 3, 2];
      for (var i = 0; i < this._vocalFilters.length; i++) {
        this._vocalFilters[i].gain.value = this._vocalEnabled ? gains[i] : 0;
      }
    }

    setGuitarFriendly(enabled) {
      this._guitarEnabled = !!enabled;
      this._applyGuitarFilters();
      this._updateEffectsGain();
    }

    _applyGuitarFilters() {
      if (!this._guitarFilters) return;
      var gains = [3, 4, 3];
      for (var i = 0; i < this._guitarFilters.length; i++) {
        this._guitarFilters[i].gain.value = this._guitarEnabled ? gains[i] : 0;
      }
    }

    setCompressorEnabled(enabled) {
      this._compressorEnabled = !!enabled;
      if (!this._compressor) return;
      if (enabled) {

        this._compressor.threshold.value = -10;
        this._compressor.ratio.value = 4;
      } else {
        this._compressor.threshold.value = 0;
        this._compressor.ratio.value = 1;
      }
    }

    setHearingProtection(enabled) {
      this._hearingProtectionEnabled = !!enabled;
      this._applyHearingProtection();

      this.setVolume(this._volume);
      this._updateEffectsGain();
    }

    _applyHearingProtection() {
      if (this._hearingProtectionFilter) {

        this._hearingProtectionFilter.gain.value = this._hearingProtectionEnabled ? -6 : 0;
      }

      if (this._safetyGainNode) {
        this._safetyGainNode.gain.value = 1.0;

      }
    }

    _updateEffectsGain() {
      if (!this._effectsInput) return;
      var maxBoost = 0;

      if (this._eqEnabled && this._eqBandGains) {
        for (var i = 0; i < this._eqBandGains.length; i++) {
          if (this._eqBandGains[i] > maxBoost) maxBoost = this._eqBandGains[i];
        }
      }

      if (this._bassEnabled) {
        maxBoost += 6;
      }

      if (this._vocalEnabled) {
        maxBoost += 3;
      }

      if (this._guitarEnabled) {
        maxBoost += 4;
      }

      if (this._vbeEnabled) {
        var harmDb = 20 * Math.log10(this._vbeParams.harmGain || 0.35);
        maxBoost += Math.max(0, harmDb + 14);
      }

      var gainLin = Math.pow(10, -maxBoost / 20);

      this._effectsInput.gain.value = Math.max(gainLin, 0.1);
    }

    setTransitionPlan(plan) {
      this._transitionPlan = plan || null;

      var cfMs = this._getEffectiveCrossfadeMs();
      if (cfMs > 0 && this._ctx) {
        var cfFrames = Math.round((cfMs / 1000) * this._ctx.sampleRate);
        if (cfFrames > 0) {
          this._cachedCrossfadeCurves = computeEqualPowerCurves(cfFrames, this._effectiveVolume());
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

    _startExpansionEffect() {
      this._stopExpansionEffect();
      var plan = this._transitionPlan;
      var fx = plan && plan.expansionEffect;
      if (!fx || !fx.enabled || !this._ctx || !this._currentBuffer) return;

      var sr = this._ctx.sampleRate;
      var now = this._ctx.currentTime;
      var fragmentSec = Math.max(0.03, fx.fragmentDurationMs / 1000);
      var spacingSec = Math.max(fragmentSec, fx.spacingMs / 1000);
      var fragmentOffset = Math.max(0, Math.min(
        this._currentBuffer.duration - fragmentSec,
        fx.fragmentOffsetMs / 1000
      ));
      if (!isFinite(fragmentOffset) || fragmentOffset < 0) return;

      var repeatBus = this._ctx.createGain();
      repeatBus.gain.value = 0.72;
      var air = this._ctx.createBiquadFilter();
      air.type = 'highshelf';
      air.frequency.value = 7000;
      air.gain.value = 0;

      var convolver = this._ctx.createConvolver();
      convolver.buffer = this._makeExpansionImpulse(Math.min(1.8, 0.65 + fx.reverbWet * 2.2), sr);
      var reverbGain = this._ctx.createGain();
      reverbGain.gain.value = 0;

      var delay = this._ctx.createDelay(2.0);
      delay.delayTime.value = Math.min(0.8, Math.max(0.06, spacingSec * 0.75));
      var feedback = this._ctx.createGain();
      feedback.gain.value = 0.18;
      var delayGain = this._ctx.createGain();
      delayGain.gain.value = 0;

      repeatBus.connect(air);
      air.connect(this._effectsInput || this._outputNode);
      air.connect(convolver);
      convolver.connect(reverbGain);
      reverbGain.connect(this._effectsInput || this._outputNode);
      air.connect(delay);
      delay.connect(delayGain);
      delayGain.connect(this._effectsInput || this._outputNode);
      delay.connect(feedback);
      feedback.connect(delay);

      var totalSec = Math.max(spacingSec, (fx.durationMs || spacingSec * fx.repeatCount) / 1000);
      var peakSec = totalSec * 0.58;
      var endSec = totalSec;
      air.gain.setValueAtTime(0, now);
      air.gain.linearRampToValueAtTime(fx.airGainDb, now + peakSec);
      air.gain.linearRampToValueAtTime(0, now + endSec);
      reverbGain.gain.setValueAtTime(0, now);
      reverbGain.gain.linearRampToValueAtTime(fx.reverbWet, now + peakSec);
      reverbGain.gain.linearRampToValueAtTime(0, now + endSec);
      delayGain.gain.setValueAtTime(0, now);
      delayGain.gain.linearRampToValueAtTime(fx.delayWet, now + peakSec);
      delayGain.gain.linearRampToValueAtTime(0, now + endSec);

      var sources = [];
      var nodes = [repeatBus, air, convolver, reverbGain, delay, feedback, delayGain];
      var count = Math.max(1, Math.min(10, Math.round(fx.repeatCount || 4)));
      var rateRise = Math.max(0, Math.min(0.9, fx.rateRise || 0));
      var lastRate = 1;
      for (var i = 0; i < count; i++) {
        var when = now + i * spacingSec;
        if (when >= now + endSec) break;
        var source = new AudioBufferSourceNode(this._ctx, { buffer: this._currentBuffer });
        var gain = this._ctx.createGain();
        var pan = this._ctx.createStereoPanner();
        var progress = count <= 1 ? 1 : i / (count - 1);

        var rate = 1 + progress * rateRise;
        lastRate = rate;
        source.playbackRate.value = rate;

        var hitSec = fragmentSec / rate;

        var envelope = fx.intensity * (0.55 + 0.45 * progress);
        gain.gain.setValueAtTime(0, when);
        gain.gain.linearRampToValueAtTime(envelope, when + Math.min(0.02, hitSec * 0.15));
        gain.gain.linearRampToValueAtTime(envelope * 0.85, when + hitSec * 0.6);
        gain.gain.linearRampToValueAtTime(0, when + hitSec);

        pan.pan.value = (i % 2 === 0 ? -1 : 1) * Math.min(0.7, fx.width || 0.2);
        source.connect(gain);
        gain.connect(pan);
        pan.connect(repeatBus);
        source.start(when, fragmentOffset, fragmentSec);
        sources.push(source);
        nodes.push(gain, pan);
      }

      if (fx.spinback && sources.length) {
        var spinDur = Math.max(0.15, fragmentSec * 0.7);
        var spinWhen = now + count * spacingSec;
        if (spinWhen + spinDur <= now + endSec + 0.25) {
          var revBuf = this._makeReversedFragment(this._currentBuffer, fragmentOffset, fragmentSec, sr);
          var spin = new AudioBufferSourceNode(this._ctx, { buffer: revBuf });
          var spinGain = this._ctx.createGain();
          var spinPan = this._ctx.createStereoPanner();
          var spinPeak = fx.intensity * 1.35;
          spin.playbackRate.setValueAtTime(Math.max(1, lastRate * 0.9), spinWhen);
          spin.playbackRate.exponentialRampToValueAtTime(2.6, spinWhen + spinDur);
          spinGain.gain.setValueAtTime(0, spinWhen);
          spinGain.gain.linearRampToValueAtTime(spinPeak, spinWhen + 0.02);
          spinGain.gain.setValueAtTime(spinPeak, spinWhen + spinDur * 0.55);
          spinGain.gain.linearRampToValueAtTime(0, spinWhen + spinDur);
          spinPan.pan.setValueAtTime(-0.2, spinWhen);
          spinPan.pan.linearRampToValueAtTime(0.25, spinWhen + spinDur);
          spin.connect(spinGain);
          spinGain.connect(spinPan);
          spinPan.connect(repeatBus);
          spin.start(spinWhen, 0, fragmentSec);
          sources.push(spin);
          nodes.push(spinGain, spinPan);
        }
      }

      if (!sources.length) {
        nodes.forEach((n) => this._safeDisconnect(n));
        return;
      }
      var self = this;
      var cleanupTimer = setTimeout(function () { self._stopExpansionEffect(); }, Math.ceil((endSec + 1.0) * 1000));
      this._expansionEffect = { sources: sources, nodes: nodes, cleanupTimer: cleanupTimer };
      console.log('[AudioEngine] Expansion effect scheduled:', fx.reason,
        'repeats=' + count, 'spacing=' + fx.spacingMs + 'ms', 'rateRise=' + rateRise,
        'spinback=' + !!fx.spinback, 'duration=' + fx.durationMs + 'ms');
    }

    _makeReversedFragment(buffer, offsetSec, lengthSec, sampleRate) {
      var length = Math.max(1, Math.min(buffer.length, Math.round(lengthSec * sampleRate)));
      var start = Math.max(0, Math.min(buffer.length - length, Math.round(offsetSec * sampleRate)));
      var rev = this._ctx.createBuffer(buffer.numberOfChannels, length, sampleRate);
      for (var ch = 0; ch < buffer.numberOfChannels; ch++) {
        var src = buffer.getChannelData(ch);
        var dst = rev.getChannelData(ch);
        for (var i = 0; i < length; i++) {
          dst[i] = src[start + length - 1 - i];
        }
      }
      return rev;
    }

    _makeExpansionImpulse(seconds, sampleRate) {
      var length = Math.max(1, Math.floor(seconds * sampleRate));
      var impulse = this._ctx.createBuffer(2, length, sampleRate);
      for (var ch = 0; ch < 2; ch++) {
        var data = impulse.getChannelData(ch);
        for (var i = 0; i < length; i++) {
          var decay = Math.pow(1 - i / length, 2.4);
          data[i] = (Math.random() * 2 - 1) * decay * (ch === 0 ? 0.72 : 0.66);
        }
      }
      return impulse;
    }

    _stopExpansionEffect() {
      var fx = this._expansionEffect;
      if (!fx) return;
      if (fx.cleanupTimer) clearTimeout(fx.cleanupTimer);
      for (var i = 0; i < fx.sources.length; i++) {
        try { fx.sources[i].stop(); } catch (_) {}
        this._safeDisconnect(fx.sources[i]);
      }
      for (var j = 0; j < fx.nodes.length; j++) this._safeDisconnect(fx.nodes[j]);
      this._expansionEffect = null;
    }

    _getEffectiveCrossfadeMs() {
      if (this._transitionPlan && this._transitionPlan.crossfadeDurationMs > 0) {
        return this._transitionPlan.crossfadeDurationMs;
      }
      return this._crossfadeDurationMs;
    }

    _getCrossfadeCurves(cfFrames) {
      var amp = this._effectiveVolume();
      var cached = this._cachedCrossfadeCurves;
      if (cached && cached.fadeOut.length === cfFrames &&
          Math.abs((cached.amplitude === undefined ? 1 : cached.amplitude) - amp) < 1e-6) {
        return cached;
      }

      this._cachedCrossfadeCurves = computeEqualPowerCurves(cfFrames, amp);
      return this._cachedCrossfadeCurves;
    }

    _trackCrossfade(outNode, inNode, t0, cfSec) {
      this._crossfadeOutNode = outNode || null;
      this._crossfadeInNode = inNode || null;
      this._crossfadeStartCtxTime = (typeof t0 === 'number' && isFinite(t0)) ? t0 : -1;
      this._crossfadeDurationSec = (typeof cfSec === 'number' && isFinite(cfSec) && cfSec > 0) ? cfSec : 0;
    }

    _clearCrossfadeTracking() {
      this._crossfadeOutNode = null;
      this._crossfadeInNode = null;
      this._crossfadeStartCtxTime = -1;
      this._crossfadeDurationSec = 0;
    }

    _getTempoAdjust() {
      if (!this._transitionPlan) return 1.0;
      var adjust = this._transitionPlan.bpmTempoAdjust;
      if (typeof adjust !== 'number' || !isFinite(adjust) || adjust <= 0) return 1.0;

      if (adjust < 0.85) adjust = 0.85;
      if (adjust > 1.15) adjust = 1.15;
      return adjust;
    }

    clearNextState() {
      this._stopExpansionEffect();

      this._disposeWash(this._nextWash, null);
      this._nextWash = null;
      if (this._crossfadeActive) {
        this._disposeWash(this._currentWash, this._currentGain || this._currentStreamingGain);
        this._currentWash = null;
      }

      this._safeStopSource(this._nextSource);
      this._safeDisconnect(this._nextGain);
      this._nextSource = null;
      this._nextGain = null;
      this._nextBuffer = null;
      this._nextFilePath = '';
      this._nextDurationMs = 0;
      this._nextIsStreaming = false;

      this._disposeStreamingNode(this._nextStreamingNode, this._nextStreamingGain);
      this._nextStreamingNode = null;
      this._nextStreamingGain = null;
      this._nextStreamingConsumedFrames = 0;
      this._nextStreamingEnded = false;
      this._pendingNextStreamingPcm = [];
      this._nextStreamingPrimed = false;

      this._stopCrossfadeTimer();
      this._crossfadeActive = false;
      this._pendingBufferToStreamingCrossfade = false;
      this._crossfadePending = false;
      this._crossfadePendingSince = 0;
      this._tempoAdjustActive = 0;
      this._cancelGaplessSchedule();
      this._transitionPlan = null;
      this._cachedCrossfadeCurves = null;
    }

    pushStreamingPcm(float32Array) {

      var ab;
      if (float32Array.byteOffset === 0 && float32Array.buffer &&
          float32Array.buffer.byteLength === float32Array.byteLength) {
        ab = float32Array.buffer;
      } else {
        ab = new ArrayBuffer(float32Array.byteLength);
        new Float32Array(ab).set(float32Array);
      }

      if (!this._currentStreamingNode) {

        if (this._pendingStreamingPcm.length < 200) {
          this._pendingStreamingPcm.push(ab);
        } else {

          this._pendingStreamingPcm.shift();
          this._pendingStreamingPcm.push(ab);
        }
        return;
      }

      if (this._streamingBaselinePending) {
        this._currentStreamingNode.port.postMessage({ type: 'baseline' });
        this._streamingBaselinePending = false;
      }
      this._currentStreamingNode.port.postMessage({ type: 'pcm', samples: ab }, [ab]);

      if (!this._positionTimer && this._isPlaying && !this._isPaused) {
        this._startPositionTimer();
      }
    }

    setStreamingFinished() {
      if (!this._currentStreamingNode) return;
      this._currentStreamingNode.port.postMessage({ type: 'end' });
    }

    pushMainPcm(float32Array) {
      this.pushStreamingPcm(float32Array);
    }

    pushNextPcm(float32Array) {

      var ab;
      if (float32Array.byteOffset === 0 && float32Array.buffer &&
          float32Array.buffer.byteLength === float32Array.byteLength) {
        ab = float32Array.buffer;
      } else {
        ab = new ArrayBuffer(float32Array.byteLength);
        new Float32Array(ab).set(float32Array);
      }

      if (!this._nextStreamingNode) {

        if (this._pendingNextStreamingPcm.length < 200) {
          this._pendingNextStreamingPcm.push(ab);
        } else {
          this._pendingNextStreamingPcm.shift();
          this._pendingNextStreamingPcm.push(ab);
        }
      } else {

        this._nextStreamingNode.port.postMessage({ type: 'pcm', samples: ab }, [ab]);
        this._nextStreamingPrimed = true;
      }

      if (this._pendingBufferToStreamingCrossfade) {
        var self = this;
        Promise.resolve().then(function () {
          if (self._pendingBufferToStreamingCrossfade) {
            self._startBufferToStreamingCrossfade();
          }
        });
      }

      if (this._crossfadePending) {
        this._checkCrossfadeTrigger();
      }
    }

    setMainFfmpegFinished(finished) {
      if (finished) this.setStreamingFinished();
    }

    setNextFfmpegFinished(finished) {
      if (finished) {
        this._nextStreamingEnded = true;
        if (this._nextStreamingNode) {
          this._nextStreamingNode.port.postMessage({ type: 'end' });
        }
      }
    }

    getCachedBuffer(filePath) {
      return this._cache.get(filePath);
    }

    setCachedBuffer(filePath, buffer) {
      this._cache.set(filePath, buffer);
    }

    _loadFile(filePath) {

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

    _resumeContext() {
      if (this._ctx && this._ctx.state === 'suspended') {
        this._ctx.resume();
      }
    }

    _startPositionTimer() {
      this._stopPositionTimer();
      var self = this;
      this._positionTimer = setInterval(function () {
        if (self.onPositionTick) {
          self.onPositionTick(self.getCurrentPositionMs());
        }

        if (self._isPaused) return;
        if (self._crossfadeActive) return;
        if (self._pendingBufferToStreamingCrossfade) return;

        var durMs = self._currentDurationMs;
        if (durMs <= 0) return;

        var posMs = self.getCurrentPositionMs();
        var remainingMs = durMs - posMs;
        if (remainingMs <= 0) return;

        if (self._crossfadeEnabled) {
          self._checkCrossfadeTrigger();
        }

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
      }, 100);
    }

    _isNextReady(isBufferMode, isStreamingMode) {
      if (isBufferMode && this._nextBuffer && !this._nextIsStreaming) {
        return true;
      }
      if (isBufferMode && this._nextIsStreaming) {

        return this._nextStreamingPrimed || this._pendingNextStreamingPcm.length > 0;
      }
      if (isStreamingMode && this._nextIsStreaming) {

        return this._nextStreamingPrimed || this._pendingNextStreamingPcm.length > 0;
      }
      if (isStreamingMode && this._nextBuffer && !this._nextIsStreaming) {

        return true;
      }
      return false;
    }

    _checkCrossfadeTrigger() {
      if (!this._crossfadeEnabled) return;
      if (this._crossfadeActive) return;
      if (this._pendingBufferToStreamingCrossfade) return;
      if (this._isPaused) return;

      var durMs = this._currentDurationMs;
      if (durMs <= 0) return;

      var posMs = this.getCurrentPositionMs();
      var remainingMs = durMs - posMs;
      if (remainingMs <= 0) return;

      var plan = this._transitionPlan;
      var triggerMs;
      if (plan && plan.transitionStartMs >= 0) {
        triggerMs = durMs - plan.transitionStartMs;
      } else {
        triggerMs = this._crossfadeDurationMs;
      }

      if (triggerMs <= 0 || remainingMs > triggerMs + 250) {
        return;
      }

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

        if (!this._crossfadePending) {
          this._crossfadePending = true;
          this._crossfadePendingSince = Date.now();

          var diag = 'nextBuffer=' + (!!this._nextBuffer) +
            ', nextIsStreaming=' + this._nextIsStreaming +
            ', nextStreamingNode=' + (!!this._nextStreamingNode) +
            ', pendingPcm=' + this._pendingNextStreamingPcm.length +
            ', nextFilePath=' + (this._nextFilePath || '(empty)');
          console.log('[AudioEngine] Crossfade PENDING: next not ready, remaining=' +
            Math.round(remainingMs) + 'ms (will trigger when next becomes ready) [' + diag + ']');
        } else if (this._crossfadePendingSince > 0) {

          var pendingElapsed = Date.now() - this._crossfadePendingSince;
          if (pendingElapsed > 20000) {
            console.warn('[AudioEngine] Crossfade PENDING TIMEOUT: gave up after ' +
              pendingElapsed + 'ms, remaining=' + Math.round(remainingMs) +
              'ms — falling back to normal track end');
            this._crossfadePending = false;
            this._crossfadePendingSince = 0;

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
      try { source.onended = null; } catch (_) {}
      try { source.disconnect(); } catch (_) {}
    }

    _safeDisconnect(node) {
      if (!node) return;
      try { node.disconnect(); } catch (_) {}
    }

    getBeatData() {
      if (!this._analyser || !this._freqData) return null;
      this._analyser.getByteFrequencyData(this._freqData);

      var data = this._freqData;
      var n = data.length;

      var bassSum = 0, midSum = 0, trebleSum = 0;
      var bassCount = 9, midCount = 38, trebleCount = 82;

      for (var i = 0; i < bassCount && i < n; i++) bassSum += data[i];
      for (var i = bassCount; i < bassCount + midCount && i < n; i++) midSum += data[i];
      for (var i = bassCount + midCount; i < bassCount + midCount + trebleCount && i < n; i++) trebleSum += data[i];

      var bass = Math.min(1, (bassSum / (255 * bassCount)) * 2.5);
      var mid = Math.min(1, (midSum / (255 * midCount)) * 2.5);
      var treble = Math.min(1, (trebleSum / (255 * trebleCount)) * 3.0);
      var level = Math.min(1, (bass + mid + treble) / 3);

      return { bass: bass, mid: mid, treble: treble, level: level };
    }
  }

  window.AudioEngine = AudioEngine;
})();
