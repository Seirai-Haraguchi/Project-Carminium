/**
 * Carminium — Streaming Mixer (Timer-based)
 *
 * 在渲染进程中运行，使用定时器驱动音频合成：
 * - Gapless: 曲目结束后立即播放下一曲（无重叠）
 * - AutoMix: 等功率交叉淡化
 * - 音量控制
 *
 * 架构：
 *   Main (FFmpeg decode) → IPC → RingBuffer → setInterval (mix) → IPC → Main (miniaudio)
 *
 * 不依赖 Web Audio API / AudioContext，避免采样率不匹配、
 * 自动播放策略限制、ScriptProcessorNode 不触发等问题。
 * miniaudio DLL 的 8MB 环形缓冲区负责平滑定时器抖动。
 */
(function () {
  'use strict';

  // ── RingBuffer ────────────────────────────────────────────────────────────

  class RingBuffer {
    constructor(initialSampleCapacity) {
      this._buf = new Float32Array(initialSampleCapacity);
      this._writePos = 0;
      this._readPos = 0;
    }

    get available() { return this._writePos - this._readPos; }
    get isEmpty() { return this._writePos === this._readPos; }

    append(data) {
      const needed = data.length;
      const free = this._buf.length - this._writePos;

      if (needed > free) {
        const unread = this.available;
        if (unread > 0) {
          this._buf.copyWithin(0, this._readPos, this._writePos);
        }
        this._writePos = unread;
        this._readPos = 0;

        if (needed > this._buf.length - this._writePos) {
          const newCap = Math.max(this._buf.length * 2, this._writePos + needed);
          const newBuf = new Float32Array(newCap);
          newBuf.set(this._buf.subarray(0, this._writePos));
          this._buf = newBuf;
        }
      }

      this._buf.set(data, this._writePos);
      this._writePos += needed;
    }

    read(dst, dstOffset, sampleCount) {
      const available = this.available;
      const toRead = Math.min(sampleCount, available);
      if (toRead <= 0) return 0;
      dst.set(this._buf.subarray(this._readPos, this._readPos + toRead), dstOffset);
      this._readPos += toRead;
      return toRead;
    }

    clear() {
      this._writePos = 0;
      this._readPos = 0;
    }
  }

  // ── AudioMixer ────────────────────────────────────────────────────────────

  class AudioMixer {
    constructor() {
      this._initialized = false;
      this._sampleRate = 0;
      this._channels = 2;
      this._bytesPerFrame = 8; // 2ch * f32

      // Ring buffers for streaming input
      this._mainRing = null;
      this._nextRing = null;

      // Mode
      this._gaplessEnabled = false;
      this._crossfadeEnabled = false;
      this._crossfadeDurationMs = 4000;

      // Crossfade state
      this._mixingMode = 'normal';  // 'normal' | 'crossfade' | 'gapless'
      this._mixPos = 0;             // frames processed in current mix
      this._mixFramesTotal = 0;     // total frames for crossfade

      // Playback state
      this._playing = false;
      this._paused = false;
      this._volume = 1.0;
      this._ended = false;
      this._durationMs = 0;
      this._seekOffsetMs = 0;
      this._framesOutput = 0;       // total frames output since play start
      this._dllBufferLatencyMs = 0; // DLL ring buffer latency (pushed but not yet played)

      // Next track info
      this._nextFilePath = null;
      this._nextDurationMs = 0;
      this._nextFfmpegFinished = false;
      this._mainFfmpegFinished = false;

      // 过渡完成后，将 'next' 通道的 PCM 数据重定向到 mainRing
      // （解决 promoteNextToCurrent 的 IPC 异步竞态：FFmpeg 数据仍经 'next' 通道到达）
      this._nextRedirectToMain = false;

      // Callbacks — set by the glue code in app.js
      this.onOutput = null;         // (Float32Array interleaved) => void
      this.onEnded = null;          // () => void
      this.onPositionTick = null;   // (number ms) => void
      this.onCrossfadeStart = null;  // () => void — fired when crossfade begins (UI animation trigger)
      this.onCrossfadeComplete = null; // (positionMs: number) => void
      this.onNeedNextTrack = null;  // () => void — request next track preload

      // Timers
      this._posTimer = null;
      this._pumpTimer = null;

      // Pump timing tracking (software PLL)
      this._pumpStartTime = 0;
      this._pumpFramesProduced = 0;
      this._pumpChunkFrames = 2048;  // frames per pump cycle

      // Debug stats
      this._pumpCount = 0;
      this._mainPcmCount = 0;

      // Test tone
      this._testToneEnabled = false;
      this._testToneFreq = 440;
      this._testToneLevel = 0.3;
      this._testTonePhase = 0;

      // Generation counter — 防止旧 FFmpeg 的 close 事件误触 onEnded
      this._playGen = 0;
      this._mainFfmpegGen = 0;
    }

    async init(sampleRate, channels) {
      if (this._initialized) {
        return { sampleRate: this._sampleRate, channels: this._channels };
      }

      this._sampleRate = sampleRate || 44100;
      this._channels = channels || 2;
      this._bytesPerFrame = this._channels * 4;

      // Initialize ring buffers (4 seconds of samples)
      var cap = this._sampleRate * this._channels * 4;
      this._mainRing = new RingBuffer(cap);
      this._nextRing = new RingBuffer(cap);

      this._initialized = true;
      console.log('[audio_mixer] Initialized (timer-based):', this._sampleRate + 'Hz', this._channels + 'ch');
      return { sampleRate: this._sampleRate, channels: this._channels };
    }

    get sampleRate() { return this._sampleRate; }
    get channels() { return this._channels; }
    get isInitialized() { return this._initialized; }
    get isPlaying() { return this._playing; }
    get gaplessEnabled() { return this._gaplessEnabled; }
    get crossfadeEnabled() { return this._crossfadeEnabled; }

    // ── PCM Input (called from IPC) ──────────────────────────────────────

    pushMainPcm(float32Array) {
      if (!this._mainRing) return;
      // 收到 PCM 数据说明当前 generation 的 FFmpeg 正在产出
      this._mainFfmpegGen = this._playGen;
      this._mainPcmCount = (this._mainPcmCount || 0) + 1;
      if (this._mainPcmCount <= 3) {
        console.log('[audio_mixer] pushMainPcm #' + this._mainPcmCount +
          ': ' + float32Array.length + ' samples');
      }
      this._mainRing.append(float32Array);
    }

    pushNextPcm(float32Array) {
      // 过渡完成后，promoteNextToCurrent 的 IPC 尚未生效，
      // FFmpeg 数据仍经 'next' 通道到达 → 重定向到 mainRing
      if (this._nextRedirectToMain) {
        if (this._mainRing) this._mainRing.append(float32Array);
        return;
      }
      if (!this._nextRing) return;
      this._nextRing.append(float32Array);
    }

    setMainFfmpegFinished(finished) {
      // 只接受当前 generation 的 FFmpeg 状态，忽略旧 FFmpeg 的延迟事件
      if (finished && this._mainFfmpegGen !== this._playGen) {
        console.log('[audio_mixer] Ignoring stale ffmpeg finished (gen ' + this._mainFfmpegGen + ' != ' + this._playGen + ')');
        return;
      }
      this._mainFfmpegFinished = !!finished;
    }

    setNextFfmpegFinished(finished) {
      // 过渡完成后，FFmpeg 的 close 事件仍经 'next' 通道到达
      if (this._nextRedirectToMain) {
        this._mainFfmpegFinished = !!finished;
        return;
      }
      this._nextFfmpegFinished = !!finished;
    }

    setNextInfo(filePath, durationMs) {
      this._nextFilePath = filePath;
      this._nextDurationMs = durationMs;
      // 新的下一曲已预加载，不再需要重定向
      this._nextRedirectToMain = false;
    }

    clearNextState() {
      this._nextFilePath = null;
      this._nextDurationMs = 0;
      this._nextFfmpegFinished = false;
      this._nextRedirectToMain = false;
      if (this._nextRing) this._nextRing.clear();
    }

    // ── Test tone (for debugging) ─────────────────────────────────────────

    startTestTone(freq, level) {
      if (!this._initialized) return;
      this._testToneEnabled = true;
      this._testToneFreq = freq || 440;
      this._testToneLevel = level || 0.3;
      this._testTonePhase = 0;
      // 启动 pump 定时器来输出测试音
      if (!this._pumpTimer) {
        this._startPumpTimer();
      }
      console.log('[audio_mixer] Test tone started: ' + this._testToneFreq + 'Hz @ ' + this._testToneLevel);
    }

    stopTestTone() {
      this._testToneEnabled = false;
      if (!this._playing) {
        this._stopPumpTimer();
      }
      console.log('[audio_mixer] Test tone stopped');
    }

    _generateTestTone(interleaved, frames) {
      var channels = this._channels;
      var phaseStep = (2 * Math.PI * this._testToneFreq) / this._sampleRate;
      for (var i = 0; i < frames; i++) {
        var sample = Math.sin(this._testTonePhase) * this._testToneLevel;
        this._testTonePhase += phaseStep;
        if (this._testTonePhase > 2 * Math.PI) {
          this._testTonePhase -= 2 * Math.PI;
        }
        for (var ch = 0; ch < channels; ch++) {
          interleaved[i * channels + ch] = sample;
        }
      }
      return frames;
    }

    // ── Pump: timer-driven audio output ───────────────────────────────────

    _startPumpTimer() {
      if (this._pumpTimer) return;
      this._pumpStartTime = performance.now();
      this._pumpFramesProduced = 0;
      this._pumpCount = 0;

      // 50ms 间隔 — 减少 IPC 开销，DLL 的大缓冲区会平滑抖动
      var self = this;
      this._pumpTimer = setInterval(function () {
        self._pumpAudio();
      }, 50);
      console.log('[audio_mixer] Pump timer started (50ms)');
    }

    _stopPumpTimer() {
      if (this._pumpTimer) {
        clearInterval(this._pumpTimer);
        this._pumpTimer = null;
      }
    }

    _pumpAudio() {
      this._pumpCount++;

      var channels = this._channels;
      var framesDue;

      if (this._testToneEnabled && !this._playing) {
        // 测试音模式：固定每次 4096 帧
        framesDue = 4096;
      } else if (this._playing && !this._paused) {
        // 正常播放模式：基于实际经过的时间计算
        var now = performance.now();
        var elapsedMs = now - this._pumpStartTime;
        var targetFrames = Math.floor(elapsedMs * this._sampleRate / 1000);
        framesDue = targetFrames - this._pumpFramesProduced;
        if (framesDue <= 0) return;
        // 限制单次最大帧数
        if (framesDue > this._sampleRate) {
          framesDue = this._sampleRate;
          this._pumpFramesProduced = targetFrames - framesDue;
        }
      } else {
        return; // 不播放不发数据
      }

      var interleaved = new Float32Array(framesDue * channels);
      var gotFrames = 0;

      if (this._testToneEnabled && !this._playing) {
        gotFrames = this._generateTestTone(interleaved, framesDue);
      } else if (this._playing && !this._paused) {
        gotFrames = this._mixAudio(interleaved, framesDue);
      }

      // 只发实际音频数据，不发静音 — DLL 自己处理 buffer underrun
      if (gotFrames > 0 && this.onOutput) {
        var output = interleaved.subarray(0, gotFrames * channels);
        var copy = new Float32Array(output.length);
        copy.set(output);
        this.onOutput(copy.buffer);
        this._framesOutput += gotFrames;
        this._pumpFramesProduced += gotFrames;
      } else {
        // 没有数据时只推进帧计数，不发 IPC
        this._pumpFramesProduced += framesDue;
      }

      if (this._pumpCount === 1) {
        console.log('[audio_mixer] Pump STARTED! framesDue=' + framesDue +
          ' mainRing=' + (this._mainRing ? this._mainRing.available : 0));
      }

      // 检查曲目结束 — 需要满足所有条件才能触发
      // 1. 正在播放且没有暂停
      // 2. 实际播放的帧数 > 3秒（防止启动时的竞态条件）
      // 3. 当前是 normal 模式
      // 4. main ring 为空且 FFmpeg 已结束
      // 5. 没有 gapless/crossfade 的下一曲可用
      var minFramesBeforeEnd = this._sampleRate * 3; // 至少播放 3 秒
      if (this._playing && !this._paused &&
          this._framesOutput > minFramesBeforeEnd &&
          this._mainRing && this._mainRing.isEmpty &&
          this._mainFfmpegFinished && this._mixingMode === 'normal') {
        if (!this._gaplessEnabled || !this._nextFilePath || this._nextRing.isEmpty) {
          if (!this._crossfadeEnabled || !this._nextFilePath || this._nextRing.isEmpty) {
            this._ended = true;
            if (this.onEnded) this.onEnded();
          }
        }
      }
    }

    // ── Mixing ───────────────────────────────────────────────────────────

    _mixAudio(output, maxFrames) {
      const channels = this._channels;
      let framesWritten = 0;

      while (framesWritten < maxFrames) {
        const remainingFrames = maxFrames - framesWritten;
        const dstOffset = framesWritten * channels;

        if (this._mixingMode === 'normal') {
          // Check if we should start crossfade or gapless
          this._checkTransitionTrigger();

          const available = Math.floor(this._mainRing.available / channels);
          const take = Math.min(available, remainingFrames);

          if (take > 0) {
            this._mainRing.read(output, dstOffset, take * channels);
            framesWritten += take;

            // Apply volume
            if (this._volume < 1.0) {
              const start = dstOffset;
              const end = dstOffset + take * channels;
              for (let i = start; i < end; i++) {
                output[i] *= this._volume;
              }
            }
          } else {
            // No data available — check if we should switch to next
            if (this._mainFfmpegFinished) {
              if (this._gaplessEnabled && this._nextFilePath && !this._nextRing.isEmpty) {
                this._startGaplessSwitch();
                continue;
              } else if (this._crossfadeEnabled && this._nextFilePath && !this._nextRing.isEmpty) {
                this._startCrossfade();
                continue;
              }
            }
            // Output silence for the rest
            break;
          }
        } else if (this._mixingMode === 'crossfade') {
          const cfRemaining = this._mixFramesTotal - this._mixPos;
          const take = Math.min(cfRemaining, remainingFrames);

          if (take <= 0) {
            this._finishMix();
            continue;
          }

          // Read from both buffers
          const mainSamples = new Float32Array(take * channels);
          const nextSamples = new Float32Array(take * channels);
          const mainGot = this._mainRing.read(mainSamples, 0, take * channels);
          const nextGot = this._nextRing.read(nextSamples, 0, take * channels);

          for (let f = 0; f < take; f++) {
            const progress = (this._mixPos + f) / this._mixFramesTotal;
            // Equal-power crossfade
            const mainGain = Math.cos(progress * Math.PI / 2) * this._volume;
            const nextGain = Math.sin(progress * Math.PI / 2) * this._volume;

            for (let ch = 0; ch < channels; ch++) {
              const idx = f * channels + ch;
              const mainSamp = idx < mainGot ? mainSamples[idx] : 0;
              const nextSamp = idx < nextGot ? nextSamples[idx] : 0;
              output[dstOffset + idx] = mainSamp * mainGain + nextSamp * nextGain;
            }
          }

          this._mixPos += take;
          framesWritten += take;

          if (this._mixPos >= this._mixFramesTotal) {
            this._finishMix();
          }
        } else if (this._mixingMode === 'gapless') {
          // After gapless switch, just read from next ring
          const available = Math.floor(this._nextRing.available / channels);
          const take = Math.min(available, remainingFrames);

          if (take > 0) {
            this._nextRing.read(output, dstOffset, take * channels);
            framesWritten += take;

            // Apply volume
            if (this._volume < 1.0) {
              const start = dstOffset;
              const end = dstOffset + take * channels;
              for (let i = start; i < end; i++) {
                output[i] *= this._volume;
              }
            }

            // Check if next track is also done
            if (this._nextRing.isEmpty && this._nextFfmpegFinished) {
              this._finishMix();
            }
          } else {
            break;
          }
        } else {
          break;
        }
      }

      return framesWritten;
    }

    _checkTransitionTrigger() {
      if (this._mixingMode !== 'normal') return;

      // AutoMix: check remaining time
      if (this._crossfadeEnabled && this._nextFilePath && !this._nextRing.isEmpty) {
        const remainingMs = this._durationMs - this.getCurrentPositionMs();
        if (remainingMs <= this._crossfadeDurationMs && remainingMs > -5000) {
          this._startCrossfade();
          return;
        }
      }

      // Gapless: when main buffer is empty and ffmpeg finished
      if (this._gaplessEnabled && this._nextFilePath && !this._nextRing.isEmpty) {
        if (this._mainRing.isEmpty && this._mainFfmpegFinished) {
          this._startGaplessSwitch();
        }
      }
    }

    _startCrossfade() {
      if (this._mixingMode !== 'normal') return;
      if (!this._nextFilePath || this._nextRing.isEmpty) return;

      // 使用配置的固定 crossfade 时长
      const baseCfMs = this._crossfadeDurationMs;
      const configuredCfFrames = Math.floor(this._sampleRate * baseCfMs / 1000);

      // Calculate actual remaining frames to align crossfade end with track end.
      // The trigger fires every ~50ms (pump) using a 100ms position timer,
      // so it can fire up to ~100ms later than ideal. Using the actual remaining
      // frames ensures the crossfade never extends beyond the track boundary.
      const totalTrackFrames = Math.round(this._durationMs * this._sampleRate / 1000);
      const framesIntoTrack = Math.round(this._seekOffsetMs * this._sampleRate / 1000) + this._framesOutput;
      const actualRemainingFrames = Math.max(0, totalTrackFrames - framesIntoTrack);

      // Use actual remaining if less than configured (trigger fired late), otherwise use configured
      const cfFrames = actualRemainingFrames < configuredCfFrames ? actualRemainingFrames : configuredCfFrames;

      if (cfFrames <= 0) return; // Nothing to crossfade

      this._mixingMode = 'crossfade';
      this._mixFramesTotal = cfFrames;
      this._mixPos = 0;

      console.log('[audio_mixer] Starting crossfade:', cfFrames, 'frames (planned:', configuredCfFrames, ', remaining:', actualRemainingFrames, ')');

      if (this.onCrossfadeStart) this.onCrossfadeStart();
    }

    _startGaplessSwitch() {
      if (this._mixingMode !== 'normal') return;
      if (!this._nextFilePath || this._nextRing.isEmpty) return;

      this._mixingMode = 'gapless';
      this._mixPos = 0;
      this._mainRing.clear();

      console.log('[audio_mixer] Starting gapless switch');
    }

    _finishMix() {
      // Swap: next becomes current
      this._mainRing.clear();
      // Copy remaining next data to main
      const remaining = this._nextRing.available;
      if (remaining > 0) {
        const tmp = new Float32Array(remaining);
        this._nextRing.read(tmp, 0, remaining);
        this._mainRing.append(tmp);
      }
      this._nextRing.clear();

      this._durationMs = this._nextDurationMs;
      // 交叉淡化期间已经消费了 _mixFramesTotal 帧的下一曲音频，
      // 所以实际起始位置 = 已消费的淡化时长。
      // 不补偿的话，音频会比进度条快一个 crossfade 时长。
      const cfOffsetMs = Math.round(this._mixFramesTotal * 1000 / this._sampleRate);
      this._seekOffsetMs = cfOffsetMs;
      this._framesOutput = 0;

      this._mainFfmpegFinished = this._nextFfmpegFinished;
      this._nextFfmpegFinished = false;
      this._nextFilePath = null;
      this._nextDurationMs = 0;

      this._mixingMode = 'normal';
      this._mixPos = 0;
      this._mixFramesTotal = 0;
      this._ended = false;

      // 开启重定向：promoteNextToCurrent 的 IPC 是异步的，
      // 在它生效前 FFmpeg 数据仍经 'next' 通道到达，需要转发到 mainRing
      this._nextRedirectToMain = true;

      console.log('[audio_mixer] Mix finished, track switched, seekOffset:', this._seekOffsetMs);

      if (this.onCrossfadeComplete) this.onCrossfadeComplete(this.getCurrentPositionMs());
    }

    // ── Playback control ─────────────────────────────────────────────────

    play(durationMs, seekOffsetMs) {
      if (!this._initialized) return;

      // 新的播放 generation — 旧 FFmpeg 的状态变化将被忽略
      this._playGen++;
      this._mainFfmpegGen = this._playGen;
      this._mainFfmpegFinished = false;

      this._durationMs = durationMs || 0;
      this._seekOffsetMs = seekOffsetMs || 0;
      this._framesOutput = 0;
      this._ended = false;
      this._mixingMode = 'normal';
      this._mixPos = 0;
      this._mixFramesTotal = 0;
      this._nextRedirectToMain = false;

      this._playing = true;
      this._paused = false;

      // 启动 pump 定时器（核心驱动）
      this._startPumpTimer();
      this._startPositionTimer();

      console.log('[audio_mixer] Play: duration=' + this._durationMs + 'ms offset=' + this._seekOffsetMs + 'ms gen=' + this._playGen);
    }

    pause() {
      if (!this._playing || this._paused) return;
      this._paused = true;
      this._stopPumpTimer();
      this._stopPositionTimer();
      console.log('[audio_mixer] Paused');
    }

    resume() {
      if (!this._paused) return;
      this._paused = false;
      this._startPumpTimer();
      this._startPositionTimer();
      console.log('[audio_mixer] Resumed');
    }

    stop() {
      // 增加 generation，使旧 FFmpeg 的状态变化失效
      this._playGen++;
      this._playing = false;
      this._paused = false;
      this._ended = false;
      this._mixingMode = 'normal';
      this._mixPos = 0;
      this._mixFramesTotal = 0;
      this._framesOutput = 0;
      this._nextRedirectToMain = false;
      this._stopPumpTimer();
      this._stopPositionTimer();
      if (this._mainRing) this._mainRing.clear();
      if (this._nextRing) this._nextRing.clear();
      this._nextFilePath = null;
      this._nextFfmpegFinished = false;
      this._mainFfmpegFinished = false;
    }

    seek(positionMs, durationMs) {
      this._seekOffsetMs = positionMs || 0;
      this._framesOutput = 0;
      this._durationMs = durationMs || this._durationMs;
      this._mixingMode = 'normal';
      this._mixPos = 0;
      this._mixFramesTotal = 0;
      this._nextRedirectToMain = false;
      this._mainRing.clear();
      this._mainFfmpegFinished = false;
      // 重置 pump 的 PLL 时钟，避免 seek 后一次性补发大量帧
      this._pumpStartTime = performance.now();
      this._pumpFramesProduced = 0;
    }

    setVolume(level) {
      this._volume = Math.max(0, Math.min(1, level));
    }

    setGaplessEnabled(enabled) {
      this._gaplessEnabled = !!enabled;
      if (this._gaplessEnabled) this._crossfadeEnabled = false;
    }

    setCrossfadeEnabled(enabled) {
      this._crossfadeEnabled = !!enabled;
      if (this._crossfadeEnabled) this._gaplessEnabled = false;
    }

    setCrossfadeDuration(ms) {
      this._crossfadeDurationMs = Math.max(500, Math.min(15000, ms | 0));
    }

    /**
     * 设置 DLL 环形缓冲延迟（由主进程通过 IPC 下发）。
     * 已推送到 DLL 但尚未被 WASAPI 消费的时长。
     */
    setDllBufferLatency(ms) {
      this._dllBufferLatencyMs = Math.max(0, ms | 0);
    }

    // ── Position tracking ────────────────────────────────────────────────

    getCurrentPositionMs() {
      const raw = this._seekOffsetMs + Math.round(this._framesOutput * 1000 / this._sampleRate);
      // 减去 DLL 缓冲延迟：_framesOutput 计数的是推送到 DLL 缓冲区的帧，
      // 而非 WASAPI 实际播放的帧。不补偿的话，位置会比实际听到的声音快
      // ~200-500ms（DLL 8MB 环形缓冲区的稳态填充量）。
      const corrected = raw - this._dllBufferLatencyMs;
      if (corrected < this._seekOffsetMs) return this._seekOffsetMs;
      // Clamp to duration to prevent progress bar overshoot during crossfade/gapless transitions
      if (this._durationMs > 0 && corrected > this._durationMs) return this._durationMs;
      return corrected;
    }

    getDurationMs() {
      return this._durationMs;
    }

    getMainBufferedMs() {
      if (!this._mainRing) return 0;
      return Math.floor(this._mainRing.available / this._channels) * 1000 / this._sampleRate;
    }

    getNextBufferedMs() {
      if (!this._nextRing) return 0;
      return Math.floor(this._nextRing.available / this._channels) * 1000 / this._sampleRate;
    }

    _startPositionTimer() {
      this._stopPositionTimer();
      var self = this;
      this._posTimer = setInterval(function () {
        if (!self._playing || self._paused) return;
        var posMs = self.getCurrentPositionMs();
        if (self.onPositionTick) self.onPositionTick(posMs);
      }, 100);
    }

    _stopPositionTimer() {
      if (this._posTimer) {
        clearInterval(this._posTimer);
        this._posTimer = null;
      }
    }

    close() {
      this.stop();
      this._testToneEnabled = false;
      this._initialized = false;
    }
  }

  // Expose globally
  window.AudioMixer = AudioMixer;

})();
