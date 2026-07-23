/**
 * Carminium — Web Audio API 播放器
 *
 * 非独占模式下由前端负责音频渲染。后端通过 play_command 事件下发指令，
 * 本模块用 AudioBufferSourceNode + GainNode 实现播放、暂停、seek、音量控制，
 * 以及 AutoMix 等功率交叉淡化。
 *
 * 音频图：source → sourceGain → masterGain → analyser → destination
 *   masterGain 固定 1.0；sourceGain 控制音量 + 交叉淡化淡出。
 *
 * 状态变化通过回调通知 app.js，由 app.js 同步给后端（SMTC / 持久化）。
 */
(function () {
  'use strict';

  const App = window.App || {};
  window.App = App;

  // ── AutoMix 常量 ─────────────────────────────────────────────────────────
  var TRANSITION_DURATION_MS = 10000;
  var LEAD_IN_MS = 3000;
  var PRELOAD_LEAD_MS = 6000;
  var FALLBACK_TAIL_MS = 12000;
  var FADE_TICK_MS = 50;
  var RATE_MIN = 0.82;            // playbackRate 限幅下限（与后端一致）
  var RATE_MAX = 1.22;            // playbackRate 限幅上限
  var BLUR_RATE_AMP = 0.008;      // 速率模糊幅度 ±0.8%（线性渐增渐减）
  var BLUR_VOL_DIP = 0.12;        // 音量模糊下陷深度 12%
  var BLUR_OSC_CYCLES = 4;        // 模糊振荡周期数（偶数，保证零净相位漂移）
  var _TIME_RE = /\[(\d{2}):(\d{2})[\.:](\d{2,3})\]/g;

  var player = {
    // ── 音频图 ───────────────────────────────────────────────────────────
    ctx: null,           // AudioContext
    masterGain: null,    // 主 GainNode（固定 1.0，路由到 analyser）
    sourceGain: null,    // 当前曲的 GainNode（音量 + 交叉淡化淡出）
    analyser: null,      // AnalyserNode（BeatShake / 频谱）

    // ── 当前播放状态 ─────────────────────────────────────────────────────
    buffer: null,        // 当前 AudioBuffer
    source: null,        // 当前 AudioBufferSourceNode（一次性，每次播放新建）
    startTime: 0,        // 开始播放时的 ctx.currentTime（用于计算 position）
    pauseOffset: 0,      // 暂停时的偏移（ms）
    _state: 'stopped',   // 'playing' | 'paused' | 'stopped'
    _volume: 80,         // 0–100
    _trackId: null,      // 当前曲目 ID
    _trackObj: null,     // 当前曲目对象（含歌词等元数据）
    _duration: 0,        // 当前曲目时长（ms）

    // ── 加载缓存 ─────────────────────────────────────────────────────────
    _loadingTrackId: null,  // 正在加载的曲目 ID（防止重复加载）
    _bufferCache: new Map(), // trackId → AudioBuffer（LRU，最多 5 首）
    _CACHE_MAX: 5,

    // ── AutoMix 状态 ──────────────────────────────────────────────────────
    _automixEnabled: false,
    // ── 无间隙播放状态 ────────────────────────────────────────────────────
    // gapless 模式下：在接近末尾时复用 _preloadNext/_nextBuffer 预加载下一曲，
    // 自然结束时立即切换 source 播放，跳过 report_ended → play_command 的常规路径。
    // 与 AutoMix 互斥（_nextBuffer/_nextTrackObj 不能同时被两者使用）。
    _gaplessEnabled: false,
    _gaplessPreloading: false, // 是否正在为 gapless 预加载下一曲
    _triggerPos: -1,         // 过渡触发点（ms）
    _nextTrackObj: null,     // 下一曲对象
    _nextBuffer: null,       // 下一曲预加载的 AudioBuffer
    _nextLoading: false,     // 下一曲正在加载
    _xfading: false,         // 交叉淡化进行中
    _xfadeElapsed: 0,        // 交叉淡化已用时间（ms）
    _xfadeGain: null,        // 下一曲的 GainNode
    _xfadeSource: null,      // 下一曲的 AudioBufferSourceNode
    _xfadeStartTime: 0,      // 下一曲开始播放的 ctx.currentTime
    _xfadeTimer: null,       // 交叉淡化定时器
    _xfadeNextDuration: 0,   // 下一曲时长（ms）

    // ── AutoMix 变速状态 ──────────────────────────────────────────────────
    _bpmCache: {},            // trackId → bpm（由后端 bpm_analyzed 事件填充）
    _xfadeTargetRate: 1.0,    // 上一曲目标速率（nxt_bpm/cur_bpm），过渡期间线性渐变
    _xfadeOffsetSec: 0,       // 下一曲预播起点（秒），用于变速后位置计算

    // ── BeatShake 实时鼓点检测参数 ──────────────────────────────────────────
    _beatEnabled: false,
    _beatThreshold: 1.4,     // 瞬时能量 / 滚动均值的阈值
    _beatMinInterval: 250,   // 鼓点间最小间隔（ms）
    _beatRAF: null,          // requestAnimationFrame 句柄
    _beatFreqData: null,     // Uint8Array，频域数据
    _beatEnergyHistory: [],  // 滚动能量历史
    _beatEnergySum: 0,       // 滚动能量总和（增量维护）
    _beatLastTime: 0,        // 上次鼓点时间戳

    // ── 回调 ─────────────────────────────────────────────────────────────
    onStateChange: null,    // (state, positionMs) => void
    onDuration: null,       // (durationMs) => void
    onEnded: null,          // () => void
    onPositionTick: null,   // (positionMs) => void
    onAdvanceTrack: null,   // () => void  交叉淡化完成后推进后端索引
    onCrossfadeStart: null, // () => void  交叉淡化开始（前端可隐藏曲目信息）
    onCrossfadeEnd: null,   // (completed: boolean) => void  交叉淡化结束（true=正常完成，false=被取消）
    onLoadingStart: null,   // () => void  开始加载音频（用于 Subsonic 等网络音频）
    onLoadingEnd: null,     // () => void  加载完成（成功或失败）
  };

  // ── 初始化 ─────────────────────────────────────────────────────────────

  player.init = function () {
    if (player.ctx) return;
    try {
      player.ctx = new (window.AudioContext || window.webkitAudioContext)();
    } catch (e) {
      console.error('[audio] AudioContext 创建失败:', e);
      return;
    }
    player.masterGain = player.ctx.createGain();
    player.masterGain.gain.value = 1.0; // 固定 1.0，音量在 sourceGain 控制
    player.analyser = player.ctx.createAnalyser();
    player.analyser.fftSize = 256;
    player.masterGain.connect(player.analyser);
    player.analyser.connect(player.ctx.destination);

    // 位置上报定时器（250ms 间隔）
    player._posTimer = setInterval(player._tickPosition, 250);
  };

  // ── 媒体 URL ───────────────────────────────────────────────────────────

  player._mediaUrl = function (trackId) {
    var base = window.__mediaBase || '';
    return base + '/media/' + encodeURIComponent(trackId);
  };

  // ── 加载 AudioBuffer ───────────────────────────────────────────────────

  player._loadBuffer = async function (trackId) {
    // 缓存命中
    var cached = player._bufferCache.get(trackId);
    if (cached) {
      // LRU：移到最新
      player._bufferCache.delete(trackId);
      player._bufferCache.set(trackId, cached);
      return cached;
    }

    var url = player._mediaUrl(trackId);
    var resp = await fetch(url);
    if (!resp.ok) {
      throw new Error('加载音频失败: HTTP ' + resp.status);
    }
    var arrayBuf = await resp.arrayBuffer();
    // decodeAudioData 需要 AudioContext（某些浏览器返回 Promise）
    var audioBuf = await player.ctx.decodeAudioData(arrayBuf);
    // 缓存（LRU 淘汰）
    if (player._bufferCache.size >= player._CACHE_MAX) {
      var oldest = player._bufferCache.keys().next().value;
      player._bufferCache.delete(oldest);
    }
    player._bufferCache.set(trackId, audioBuf);
    return audioBuf;
  };

  // ── 播放控制 ───────────────────────────────────────────────────────────

  /**
   * 加载曲目并播放
   * @param {Object} track - 曲目对象
   * @param {number} [positionMs=0] - 起始位置
   * @param {boolean} [autoPlay=true] - 是否自动播放
   */
  player.loadAndPlay = async function (track, positionMs, autoPlay) {
    if (!track || !track.id) return;
    if (!player.ctx) player.init();
    if (!player.ctx) return;

    // 恢复 AudioContext（浏览器自动暂停策略）
    if (player.ctx.state === 'suspended') {
      try { await player.ctx.resume(); } catch (e) { /* ignore */ }
    }

    var trackId = track.id;
    player._trackId = trackId;
    player._trackObj = track;
    player._loadingTrackId = trackId;

    // 通知前端开始加载（用于显示加载状态）
    if (player.onLoadingStart) player.onLoadingStart();

    // 取消进行中的交叉淡化
    player._cancelCrossfade();
    // 重置 AutoMix / Gapless 状态
    player._triggerPos = -1;
    player._nextTrackObj = null;
    player._nextBuffer = null;
    player._nextLoading = false;
    player._gaplessPreloading = false;

    // 停止当前播放
    player._stopSource();

    try {
      var buf = await player._loadBuffer(trackId);
      // 加载期间可能已切换到其他曲目
      if (player._loadingTrackId !== trackId) return;

      player.buffer = buf;
      player._duration = Math.round(buf.duration * 1000);
      if (player.onDuration) player.onDuration(player._duration);

      var offsetMs = Math.max(0, positionMs || 0);
      player.pauseOffset = offsetMs;

      if (autoPlay !== false) {
        player._startSource(offsetMs);
      } else {
        player._setState('paused');
      }
    } catch (e) {
      console.error('[audio] 加载失败:', e);
      player._setState('stopped');
    } finally {
      if (player._loadingTrackId === trackId) {
        player._loadingTrackId = null;
        // 通知前端加载结束
        if (player.onLoadingEnd) player.onLoadingEnd();
      }
    }
  };

  /**
   * 创建 AudioBufferSourceNode 并从 offsetMs 开始播放
   * 音频图：source → sourceGain → masterGain
   */
  player._startSource = function (offsetMs) {
    if (!player.buffer) return;

    player._stopSource();

    // 为每个 source 创建独立的 GainNode（支持交叉淡化时独立控制音量）
    var gain = player.ctx.createGain();
    gain.gain.value = player._volume / 100;
    gain.connect(player.masterGain);
    player.sourceGain = gain;

    var src = player.ctx.createBufferSource();
    src.buffer = player.buffer;
    src.connect(gain);

    var offsetSec = Math.max(0, (offsetMs || 0) / 1000);
    // 不超过 buffer 时长
    offsetSec = Math.min(offsetSec, player.buffer.duration - 0.05);

    src.onended = function () {
      // 交叉淡化进行中：忽略旧 source 的 ended
      if (player._xfading) return;
      // 只有自然结束（非手动 stop）才触发 onEnded
      if (player._state === 'playing' && player.source === src) {
        // gapless 模式下：有预加载的下一曲时立即切换，跳过常规 ended 流程
        // 避免后端 report_ended → play_command 路径产生的加载停顿
        if (player._gaplessEnabled && player._nextBuffer && player._nextTrackObj) {
          player._gaplessSwitch();
          return;
        }
        player._setState('stopped');
        player.pauseOffset = 0;
        if (player.onEnded) player.onEnded();
      }
    };

    src.start(0, offsetSec);
    player.source = src;
    player.startTime = player.ctx.currentTime - offsetSec;
    player._setState('playing');
  };

  player._stopSource = function () {
    if (player.source) {
      try {
        player.source.onended = null;
        player.source.stop();
      } catch (e) { /* already stopped */ }
      try { player.source.disconnect(); } catch (e) { /* ignore */ }
      player.source = null;
    }
    if (player.sourceGain) {
      try { player.sourceGain.disconnect(); } catch (e) { /* ignore */ }
      player.sourceGain = null;
    }
  };

  // ── 公开接口（由 play_command 调用）────────────────────────────────────

  player.play = function () {
    if (!player.ctx) return;
    if (player.ctx.state === 'suspended') {
      try { player.ctx.resume(); } catch (e) { /* ignore */ }
    }
    if (player._state === 'paused' && player.buffer) {
      player._startSource(player.pauseOffset);
    }
  };

  player.pause = function () {
    if (player._xfading) {
      player._cancelCrossfade();
    }
    if (player._state !== 'playing') return;
    var pos = player.getPosition();
    player.pauseOffset = pos;
    player._stopSource();
    player._setState('paused');
  };

  player.stop = function () {
    player._cancelCrossfade();
    player._stopSource();
    player.pauseOffset = 0;
    player._setState('stopped');
  };

  player.seek = function (positionMs) {
    if (player._xfading) {
      player._cancelCrossfade();
    }
    var pos = Math.max(0, Math.min(positionMs, player._duration));
    var wasPlaying = player._state === 'playing';
    player.pauseOffset = pos;
    if (wasPlaying && player.buffer) {
      player._startSource(pos);
    } else {
      // 暂停或停止状态：_setState 会触发 onStateChange（含最新 position）
      player._setState(player._state === 'stopped' ? 'stopped' : 'paused');
    }
  };

  player.setVolume = function (level) {
    player._volume = Math.max(0, Math.min(100, level));
    // 交叉淡化中：sourceGain/xfadeGain 由交叉淡化曲线控制，不直接修改
    if (!player._xfading && player.sourceGain) {
      player.sourceGain.gain.value = player._volume / 100;
    }
  };

  // ── 状态查询 ───────────────────────────────────────────────────────────

  player.getPosition = function () {
    // 交叉淡化中：返回下一曲的 position（下一曲原速 1.0 播放，位置 = 起点偏移 + 已用时间）
    if (player._xfading && player._xfadeSource && player.ctx) {
      var realElapsed = player.ctx.currentTime - player._xfadeStartTime;
      var audioPosMs = Math.round((player._xfadeOffsetSec + realElapsed) * 1000);
      return Math.min(audioPosMs, player._xfadeNextDuration);
    }
    if (!player.buffer || !player.ctx) return player.pauseOffset;
    if (player._state === 'playing' && player.source) {
      var elapsed = (player.ctx.currentTime - player.startTime) * 1000;
      var pos = Math.min(elapsed, player._duration);
      return Math.round(pos);
    }
    return Math.round(player.pauseOffset);
  };

  player.getDuration = function () {
    return player._duration;
  };

  player.getState = function () {
    return player._state;
  };

  player.getAnalyser = function () {
    return player.analyser;
  };

  // ── 内部 ───────────────────────────────────────────────────────────────

  player._setState = function (state) {
    player._state = state;
    if (state === 'playing') {
      if (player._beatEnabled) player._startBeatDetection();
    } else {
      player._stopBeatDetection();
    }
    var pos = player.getPosition();
    if (player.onStateChange) player.onStateChange(state, pos);
  };

  player._tickPosition = function () {
    if (player._state === 'playing') {
      var pos = player.getPosition();
      if (player.onPositionTick) player.onPositionTick(pos);
      // AutoMix 检测（与 gapless 互斥，由 setAutomixEnabled/setGaplessEnabled 担保）
      if (player._automixEnabled && !player._xfading) {
        player._checkAutomix(pos);
      } else if (player._gaplessEnabled && !player._xfading) {
        // 无间隙播放：接近末尾时预加载下一曲
        player._checkGapless(pos);
      }
    }
  };

  // ── AutoMix ────────────────────────────────────────────────────────────

  player.setAutomixEnabled = function (enabled) {
    player._automixEnabled = !!enabled;
    if (enabled) {
      // 互斥：开启 AutoMix 时关闭 gapless（_nextBuffer 由 AutoMix 接管）
      player._gaplessEnabled = false;
      player._gaplessPreloading = false;
    }
    if (!enabled) {
      player._cancelCrossfade();
      player._triggerPos = -1;
      player._nextTrackObj = null;
      player._nextBuffer = null;
    }
  };

  // ── 无间隙播放 ──────────────────────────────────────────────────────────

  player.setGaplessEnabled = function (enabled) {
    player._gaplessEnabled = !!enabled;
    if (enabled) {
      // 互斥：开启 gapless 时关闭 AutoMix（_nextBuffer 由 gapless 接管）
      player._automixEnabled = false;
      player._cancelCrossfade();
    }
    if (!enabled) {
      // 关闭时清理 gapless 预加载状态
      player._gaplessPreloading = false;
      // 若 AutoMix 未启用，一并清掉预加载的下一曲 buffer
      if (!player._automixEnabled) {
        player._nextTrackObj = null;
        player._nextBuffer = null;
        player._nextLoading = false;
      }
      player._triggerPos = -1;
    }
  };

  player._checkGapless = function (pos) {
    if (!player._trackObj) return;
    if (player._duration <= 0) return;
    // 仅在剩余时长小于预加载阈值时加载一次
    var remaining = player._duration - pos;
    if (remaining > PRELOAD_LEAD_MS) return;
    if (player._nextBuffer || player._nextLoading || player._gaplessPreloading) return;
    player._gaplessPreloading = true;
    player._preloadNext().then(function () {
      player._gaplessPreloading = false;
    }).catch(function () {
      player._gaplessPreloading = false;
    });
  };

  /**
   * 无间隙切换：当前曲自然结束时立即用预加载的下一曲 buffer 启动新 source。
   * 跳过后端 report_ended → play_command 路径，避免加载停顿。
   * 仍调用 onAdvanceTrack 让后端同步曲目索引（仅 track_changed，不发 play_command）。
   */
  player._gaplessSwitch = function () {
    if (!player._nextBuffer || !player._nextTrackObj) return;
    if (!player.ctx || !player.masterGain) return;

    // 缓存下一曲信息（_stopSource / _startSource 不依赖 _nextBuffer）
    var nextBuf = player._nextBuffer;
    var nextTrack = player._nextTrackObj;
    var nextDuration = Math.round(nextBuf.duration * 1000);

    // 停止旧 source（onended 已被触发，此处仅 disconnect）
    player._stopSource();

    // 切换到下一曲
    player.buffer = nextBuf;
    player._trackId = nextTrack.id;
    player._trackObj = nextTrack;
    player._duration = nextDuration;
    player.pauseOffset = 0;

    // 重置 gapless / AutoMix 预加载状态
    player._nextBuffer = null;
    player._nextTrackObj = null;
    player._nextLoading = false;
    player._gaplessPreloading = false;
    player._triggerPos = -1;

    // 启动新 source 从 0 开始播放（_startSource 内部会重置 startTime、source、sourceGain、onended）
    player._startSource(0);

    // 通知后端推进曲目索引（advance_to_next 仅 emit track_changed，不发 play_command）
    if (player.onAdvanceTrack) player.onAdvanceTrack();

    // 上报新曲目时长
    if (player.onDuration) player.onDuration(player._duration);
  };

  // ── BPM 缓存（由后端 bpm_analyzed 事件经 app.js 转发）──────────────────

  player.setBpm = function (trackId, bpm) {
    if (trackId && bpm > 0) {
      player._bpmCache[trackId] = bpm;
    }
  };

  player._computeOutgoingTargetRate = function () {
    /**上一曲目标速率 = nxt_bpm / cur_bpm（限幅）。
     * 使上一曲有效 BPM 从 cur_bpm 渐变到 nxt_bpm，与下一曲开头对齐。
     * BPM 未知时返回 1.0（不变速）。*/
    var curId = player._trackId;
    var nxtId = player._nextTrackObj ? player._nextTrackObj.id : null;
    var curBpm = curId ? (player._bpmCache[curId] || 0) : 0;
    var nxtBpm = nxtId ? (player._bpmCache[nxtId] || 0) : 0;
    if (curBpm <= 0 || nxtBpm <= 0) return 1.0;
    var ratio = nxtBpm / curBpm;
    return Math.max(RATE_MIN, Math.min(RATE_MAX, ratio));
  };

  function _parseLyricTimes(lyrics) {
    if (!lyrics) return [];
    _TIME_RE.lastIndex = 0;
    var times = [];
    var match;
    while ((match = _TIME_RE.exec(lyrics)) !== null) {
      var min = parseInt(match[1], 10);
      var sec = parseInt(match[2], 10);
      var ms = match[3].length === 2 ? parseInt(match[3], 10) * 10 : parseInt(match[3], 10);
      times.push(min * 60000 + sec * 1000 + ms);
    }
    return times;
  }

  function _lastLyricTime(track) {
    var times = _parseLyricTimes(track && track.lyrics);
    return times.length > 0 ? times[times.length - 1] : 0;
  }

  function _firstLyricTime(track) {
    var times = _parseLyricTimes(track && track.lyrics);
    return times.length > 0 ? times[0] : 0;
  }

  // 尾奏长度阈值：最后一句歌词距曲末超过此值视为长尾奏
  var LONG_OUTRO_MS = 20000;

  player._computeTriggerPos = function () {
    var dur = player._duration;
    if (dur <= 0) return -1;
    var lastLyric = _lastLyricTime(player._trackObj);
    var trigger;
    if (lastLyric > 0) {
      var outroLen = dur - lastLyric;
      if (outroLen >= LONG_OUTRO_MS) {
        // 长尾奏：从尾奏刚开始（最后歌词后 ~2s）就触发过渡
        trigger = lastLyric + 2000;
      } else {
        // 正常尾奏：从最后歌词处触发
        trigger = lastLyric;
      }
      trigger = Math.min(trigger, dur - TRANSITION_DURATION_MS);
    } else {
      trigger = dur - FALLBACK_TAIL_MS;
    }
    trigger = Math.min(trigger, dur - TRANSITION_DURATION_MS / 2);
    return Math.max(0, trigger);
  };

  player._checkAutomix = function (pos) {
    if (!player._trackObj) return;
    // 计算触发点
    if (player._triggerPos < 0) {
      player._triggerPos = player._computeTriggerPos();
    }
    if (player._triggerPos < 0) return;

    // 预加载下一曲
    var preloadPos = player._triggerPos - PRELOAD_LEAD_MS;
    if (pos >= preloadPos && !player._nextBuffer && !player._nextLoading) {
      player._preloadNext();
    }
    // 触发交叉淡化
    if (pos >= player._triggerPos) {
      player._startCrossfade();
    }
  };

  player._preloadNext = async function () {
    if (!App.backend || !App.backend.peek_next_track) return;
    player._nextLoading = true;
    try {
      var json = await App.backend.peek_next_track();
      var nextTrack = JSON.parse(json);
      if (!nextTrack || !nextTrack.id) {
        player._nextLoading = false;
        return;
      }
      // 单曲循环：下一曲与当前曲相同，直接复用当前 buffer 和歌词
      if (nextTrack.id === player._trackId && player.buffer) {
        player._nextTrackObj = nextTrack;
        if (player._trackObj && player._trackObj.lyrics) {
          nextTrack.lyrics = player._trackObj.lyrics;
        }
        player._nextBuffer = player.buffer;
        player._xfadeNextDuration = player._duration;
        return;
      }
      player._nextTrackObj = nextTrack;
      if (!nextTrack.lyrics && App.state && App.state.allTracks) {
        for (var i = 0; i < App.state.allTracks.length; i++) {
          if (App.state.allTracks[i].id === nextTrack.id && App.state.allTracks[i].lyrics) {
            nextTrack.lyrics = App.state.allTracks[i].lyrics;
            break;
          }
        }
      }
      var buf = await player._loadBuffer(nextTrack.id);
      // 确认期间未切换曲目
      if (player._nextTrackObj === nextTrack) {
        player._nextBuffer = buf;
        player._xfadeNextDuration = Math.round(buf.duration * 1000);
      }
    } catch (e) {
      console.error('[automix] 预加载下一曲失败:', e);
    } finally {
      player._nextLoading = false;
    }
  };

  player._startCrossfade = function () {
    if (player._xfading || !player._nextBuffer) return;
    if (!player.ctx || !player.masterGain) return;

    player._xfading = true;
    player._xfadeElapsed = 0;

    // 通知前端：交叉淡化开始，隐藏曲目信息
    if (player.onCrossfadeStart) player.onCrossfadeStart();

    // 下一曲的 GainNode（从 0 开始淡入）
    var xfadeGain = player.ctx.createGain();
    xfadeGain.gain.value = 0;
    xfadeGain.connect(player.masterGain);
    player._xfadeGain = xfadeGain;

    // 下一曲的 Source
    var src = player.ctx.createBufferSource();
    src.buffer = player._nextBuffer;
    src.connect(xfadeGain);

    // 下一曲预播起点：从第一句歌词前几秒入场；长前奏时 lead-in 按比例增大
    var firstLyric = _firstLyricTime(player._nextTrackObj);
    var offsetSec;
    if (firstLyric > 0) {
      var leadIn = LEAD_IN_MS;
      if (firstLyric >= 8000) {
        // 长前奏：lead-in = 前奏的 50%，无上限，让更多前奏融入过渡
        leadIn = firstLyric * 0.5;
      }
      offsetSec = Math.max(0, (firstLyric - leadIn) / 1000);
    } else {
      offsetSec = 0;
    }
    offsetSec = Math.min(offsetSec, player._nextBuffer.duration - 0.1);

    src.onended = function () {
      // 交叉淡化进行中或已完成（由主 source 的 onended 处理）
      if (player._xfading) return;
    };

    src.start(0, offsetSec);
    player._xfadeSource = src;
    player._xfadeStartTime = player.ctx.currentTime;  // 真实开始时间
    player._xfadeOffsetSec = offsetSec;                // 缓冲区起点偏移（秒）

    // 变速：上一曲过渡部分变速对齐下一曲开头
    // 上一曲速率从 1.0 线性渐变到 targetRate（nxt_bpm/cur_bpm），有效 BPM 渐变到 nxt_bpm
    // 下一曲保持原速 1.0，二者在过渡结束时 BPM 严格对齐
    player._xfadeTargetRate = player._computeOutgoingTargetRate();
    // 初始化上一曲变速调度起点
    if (player.source && player.ctx && player._xfadeTargetRate !== 1.0) {
      try {
        player.source.playbackRate.setValueAtTime(1.0, player.ctx.currentTime);
      } catch (e) { /* playbackRate 不支持 */ }
    }

    // 交叉淡化定时器
    player._xfadeTimer = setInterval(player._onXfadeTick, FADE_TICK_MS);
  };

  player._onXfadeTick = function () {
    if (!player._xfading) return;
    player._xfadeElapsed += FADE_TICK_MS;
    var progress = player._xfadeElapsed / TRANSITION_DURATION_MS;

    if (progress >= 1.0) {
      player._finishCrossfade();
      return;
    }

    // ── 上一曲（outgoing）变速曲线 ──────────────────────────────────────
    // 基础速率：线性 1.0 → targetRate（BPM 对齐），有效 BPM 从 cur_bpm 渐变到 nxt_bpm
    var targetRate = player._xfadeTargetRate;
    var baseRate = 1.0 + (targetRate - 1.0) * progress;

    // 心理声学模糊：三角包络 × 三角波振荡
    // 渐渐失真（线性渐增）→ 然后线性回归（线性渐减），偶数周期保证零净相位漂移
    var blurEnv = 1.0 - Math.abs(2.0 * progress - 1.0);       // 三角包络 0→1→0
    var oscPhase = (progress * BLUR_OSC_CYCLES) % 1.0;
    var blurOsc = 1.0 - 4.0 * Math.abs(oscPhase - 0.5);        // 三角波 -1↔1
    var rateBlur = blurEnv * BLUR_RATE_AMP * blurOsc;
    var outRate = Math.max(RATE_MIN, Math.min(RATE_MAX, baseRate + rateBlur));

    // 应用到上一曲（outgoing source）：线性插值到下一 tick 值，避免阶梯感
    if (player.source && player.ctx) {
      try {
        player.source.playbackRate.linearRampToValueAtTime(
          outRate, player.ctx.currentTime + FADE_TICK_MS / 1000
        );
      } catch (e) { /* playbackRate 不支持 */ }
    }

    // ── 音量交叉淡化 + 线性模糊下陷 ──────────────────────────────────────
    // cos 淡出上一曲，sin 淡入下一曲；三角包络音量下陷创造“模糊→清晰”听感
    var mainGainVal = Math.cos(progress * Math.PI / 2);
    var auxGainVal = Math.sin(progress * Math.PI / 2);
    var volDip = BLUR_VOL_DIP * blurEnv;   // 线性渐增渐减
    mainGainVal *= (1.0 - volDip);
    auxGainVal *= (1.0 - volDip);
    var vol = player._volume / 100;

    // 上一曲淡出
    if (player.sourceGain) {
      player.sourceGain.gain.value = mainGainVal * vol;
    }
    // 下一曲淡入
    if (player._xfadeGain) {
      player._xfadeGain.gain.value = auxGainVal * vol;
    }
  };

  player._finishCrossfade = function () {
    if (!player._xfading) return;
    if (player._xfadeTimer) {
      clearInterval(player._xfadeTimer);
      player._xfadeTimer = null;
    }

    // 停止旧 source 及其 gain（但不停止 xfadeSource/xfadeGain）
    player._stopSource();

    // 下一曲成为当前曲：xfadeGain 变为新的 sourceGain
    player.buffer = player._nextBuffer;
    player.source = player._xfadeSource;
    player.sourceGain = player._xfadeGain;
    player.sourceGain.gain.value = player._volume / 100;
    player._trackId = player._nextTrackObj ? player._nextTrackObj.id : player._trackId;
    player._trackObj = player._nextTrackObj;
    player._duration = player._xfadeNextDuration;

    // 下一曲原速 1.0 播放，无需恢复变速；取消可能残留的调度值确保干净
    if (player.source && player.ctx) {
      try {
        player.source.playbackRate.cancelScheduledValues(player.ctx.currentTime);
        player.source.playbackRate.setValueAtTime(1.0, player.ctx.currentTime);
      } catch (e) { /* playbackRate 不支持 */ }
    }

    // 下一曲原速播放，位置 = 起点偏移 + 实际经过时间
    var realElapsedSec = player.ctx.currentTime - player._xfadeStartTime;
    var audioPosSec = player._xfadeOffsetSec + realElapsedSec;
    player.startTime = player.ctx.currentTime - audioPosSec;
    player.pauseOffset = Math.round(Math.min(audioPosSec * 1000, player._xfadeNextDuration));

    // 设置 onended 回调
    if (player.source) {
      var src = player.source;
      src.onended = function () {
        if (player._xfading) return;
        if (player._state === 'playing' && player.source === src) {
          player._setState('stopped');
          player.pauseOffset = 0;
          if (player.onEnded) player.onEnded();
        }
      };
    }

    // 重置 AutoMix 状态
    player._xfading = false;
    player._xfadeSource = null;
    player._xfadeGain = null;
    player._nextBuffer = null;
    player._nextTrackObj = null;
    player._triggerPos = -1;
    player._xfadeTargetRate = 1.0;

    // 通知前端：交叉淡化正常完成（track_changed 随后到达并恢复显示）
    if (player.onCrossfadeEnd) player.onCrossfadeEnd(true);

    // 通知后端推进曲目索引
    if (player.onAdvanceTrack) player.onAdvanceTrack();

    // 上报新曲目时长
    if (player.onDuration) player.onDuration(player._duration);
  };

  player._cancelCrossfade = function () {
    if (!player._xfading) return;
    if (player._xfadeTimer) {
      clearInterval(player._xfadeTimer);
      player._xfadeTimer = null;
    }
    // 停止交叉淡化中的下一曲 source
    if (player._xfadeSource) {
      try { player._xfadeSource.onended = null; player._xfadeSource.stop(); } catch (e) {}
      try { player._xfadeSource.disconnect(); } catch (e) {}
      player._xfadeSource = null;
    }
    if (player._xfadeGain) {
      try { player._xfadeGain.disconnect(); } catch (e) {}
      player._xfadeGain = null;
    }
    player._xfading = false;
    player._nextBuffer = null;
    player._nextTrackObj = null;
    player._triggerPos = -1;
    player._xfadeTargetRate = 1.0;
    // 恢复上一曲原速（取消变速调度）
    if (player.source && player.ctx) {
      try {
        player.source.playbackRate.cancelScheduledValues(player.ctx.currentTime);
        player.source.playbackRate.setValueAtTime(1.0, player.ctx.currentTime);
      } catch (e) { /* playbackRate 不支持 */ }
    }
    // 通知前端：交叉淡化被取消，需要恢复当前曲目信息
    if (player.onCrossfadeEnd) player.onCrossfadeEnd(false);
    // 恢复当前曲音量
    if (player.sourceGain) {
      player.sourceGain.gain.value = player._volume / 100;
    }
  };

  // ── BeatShake：实时鼓点检测 ──────────────────────────────────────────────

  player.setBeatShakeEnabled = function (enabled) {
    player._beatEnabled = !!enabled;
    if (player._beatEnabled && player._state === 'playing') {
      player._startBeatDetection();
    } else {
      player._stopBeatDetection();
    }
  };

  player._startBeatDetection = function () {
    if (player._beatRAF) return; // 已在运行
    if (!player.analyser) return;
    player._beatFreqData = new Uint8Array(player.analyser.frequencyBinCount);
    player._beatEnergyHistory = [];
    player._beatEnergySum = 0;
    player._beatLastTime = 0;
    player._beatLoop();
  };

  player._stopBeatDetection = function () {
    if (player._beatRAF) {
      cancelAnimationFrame(player._beatRAF);
      player._beatRAF = null;
    }
  };

  player._beatLoop = function () {
    if (!player._beatEnabled || !player.analyser || player._state !== 'playing') {
      player._beatRAF = null;
      return;
    }

    player.analyser.getByteFrequencyData(player._beatFreqData);

    // 低频能量（前 3 个 bin，约 0–500 Hz，覆盖 kick drum 基频）
    var bassBins = 3;
    var bassEnergy = 0;
    for (var i = 0; i < bassBins; i++) {
      bassEnergy += player._beatFreqData[i];
    }
    bassEnergy /= bassBins;

    // 滚动均值（~0.7s 窗口，60fps ≈ 43 帧）
    var historySize = 43;
    player._beatEnergyHistory.push(bassEnergy);
    player._beatEnergySum += bassEnergy;
    if (player._beatEnergyHistory.length > historySize) {
      player._beatEnergySum -= player._beatEnergyHistory.shift();
    }
    var avg = player._beatEnergySum / player._beatEnergyHistory.length;

    // 鼓点判定：瞬时能量显著高于滚动均值，且有最小间隔
    var now = performance.now();
    if (
      player._beatEnergyHistory.length >= 10 &&
      bassEnergy > avg * player._beatThreshold &&
      bassEnergy > 25 &&
      now - player._beatLastTime > player._beatMinInterval
    ) {
      player._beatLastTime = now;
      if (player.onBeatDetected) player.onBeatDetected();
    }

    player._beatRAF = requestAnimationFrame(player._beatLoop);
  };

  // ── 输出设备切换（Web Audio API setSinkId）──────────────────────────────

  player.enumerateOutputDevices = function () {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
      return Promise.reject(new Error('enumerateDevices 不可用'));
    }
    return navigator.mediaDevices.enumerateDevices().then(function (devices) {
      return devices.filter(function (d) { return d.kind === 'audiooutput'; });
    });
  };

  player.setSinkId = function (deviceId) {
    if (!player.ctx) return Promise.reject(new Error('AudioContext 未初始化'));
    // Chromium 110+ 支持 AudioContext.setSinkId
    if (typeof player.ctx.setSinkId !== 'function') {
      return Promise.reject(new Error('setSinkId 不可用（需 WebView2 Chromium 110+）'));
    }
    return player.ctx.setSinkId(deviceId || '').catch(function (e) {
      console.warn('[audio] setSinkId 失败:', e);
      throw e;
    });
  };

  player.isSinkIdSupported = function () {
    return player.ctx && typeof player.ctx.setSinkId === 'function';
  };

  App.audioPlayer = player;
})();
