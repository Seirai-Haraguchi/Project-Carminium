/**
 * Carminium — JS Bridge (Electron 架构)
 * 提供：
 * - window.__bridge：事件分发器（Main→JS 推送）
 * - App.backend：Proxy 代理，将方法调用转发到后端
 *   兼容旧 .connect() 和 callback 风格
 * - window.coverUrl(id)：将 track ID 转换为 HTTP 封面 URL
 * - Electron 模式下：设置 navigator.mediaSession (SMTC)
 */
(function () {
  'use strict';

  // ── 检测运行环境 ───────────────────────────────────────────────────────────
  const isElectron = !!(window.__electronAPI && window.__electronAPI.isElectron);

  // ── 事件分发器 ─────────────────────────────────────────────────────────────
  const _handlers = {};

  window.__bridge = {
    on: function (event, cb) {
      if (!_handlers[event]) _handlers[event] = [];
      _handlers[event].push(cb);
    },
    dispatch: function (event, payload) {
      const cbs = _handlers[event];
      if (cbs) {
        for (const cb of cbs) {
          try { cb(payload); } catch (e) { console.error('[bridge] handler error:', e); }
        }
      }
    }
  };

  // ── Cover URL ──────────────────────────────────────────────────────────────
  window.__coverBase = ''; // 由 bridge 初始化时设置

  // size: 数值（目标边长 px）或 'max'（原始最大分辨率，用于正在播放页）
  // 该参数会被 cover-server 读取并据此缩放，从而让前端只下载所需尺寸的图片，
  // 大幅降低内存与带宽占用。
  window.coverUrl = function (trackId, size) {
    var url = window.__coverBase + '/cover/' + trackId;
    if (size && size !== 'default' && size !== 'auto') {
      url += '?size=' + encodeURIComponent(String(size));
    }
    return url;
  };

  // 艺人头像：由本地封面服务器经在线 API（免 key 多源）抓取并缓存
  window.artistImageUrl = function (name) {
    if (!name) return '';
    return window.__coverBase + '/artist-image/' + encodeURIComponent(name);
  };

  // ── Signal 名称集合（兼容旧 .connect() 调用）────────────────────────────────
  const SIGNAL_NAMES = new Set([
    'track_changed', 'playback_state_changed', 'position_changed',
    'duration_changed', 'volume_changed', 'shuffle_changed',
    'repeat_changed', 'queue_changed', 'liked_changed',
    'library_updated', 'folders_updated', 'settings_changed',
    'floating_window_closed', 'bpm_analyzed',
    'lyrics_changed', 'playlists_changed', 'history_changed',
    'liked_tracks_changed', 'subsonic_servers_changed',
    'automix_takeover'
  ]);

  function createSignal(eventName) {
    return {
      connect: function (cb) {
        window.__bridge.on(eventName, cb);
      }
    };
  }

  // ── Electron 兼容层 ────────────────────────────────────────────────────────
  if (isElectron) {
    // 创建后端 API 兼容 Proxy，将方法调用转发到 ipcRenderer.invoke
    window.pywebview = {
      api: new Proxy({}, {
        get: function (_target, method) {
          if (typeof method !== 'string') return undefined;
          return function () {
            const args = Array.prototype.slice.call(arguments);
            return window.__electronAPI.invoke(method, ...args);
          };
        }
      })
    };

    // 转发 Bridge 事件到 __bridge.dispatch
    window.__electronAPI.onBridgeEvent(function (event, payload) {
      window.__bridge.dispatch(event, payload);
    });

    // ── 应用可见性（省电模式）──
    // 主进程在窗口失焦时发送 'background'，聚焦时发送 'foreground'。
    // 后台时设置全局冻结标志（供动画循环检查）并清理缓存。
    window.__appFrozen = false;
    window.__bridge.on('app:visibility', function (state) {
      window.__appFrozen = state === 'background';
      if (window.__appFrozen) {
        // 后台：紧急清理非关键缓存
        if (window.MemoryManager && window.MemoryManager.emergencyCleanup) {
          window.MemoryManager.emergencyCleanup();
        }
      }
    });

    // ── SMTC (navigator.mediaSession) 设置 ──
    setupMediaSession();
  }

  // ── App.backend Proxy ──────────────────────────────────────────────────────
  const App = window.App || {};
  window.App = App;

  App.backend = new Proxy({}, {
    get: function (_target, method) {
      // Signal 访问：App.backend.signal_name.connect(cb)
      if (SIGNAL_NAMES.has(method)) {
        return createSignal(method);
      }
      // 方法调用：App.backend.method_name(args)
      return function () {
        const args = Array.prototype.slice.call(arguments);
        const api = window.pywebview && window.pywebview.api;
        if (!api || typeof api[method] !== 'function') {
          console.warn('[bridge] API not ready or method missing:', method);
          return Promise.resolve(undefined);
        }
        // 兼容旧 callback 风格：最后一个参数是函数时，转为 Promise.then
        if (args.length > 0 && typeof args[args.length - 1] === 'function') {
          const cb = args.pop();
          return api[method].apply(api, args).then(cb);
        }
        return api[method].apply(api, args);
      };
    }
  });

  // ── 就绪检测 ───────────────────────────────────────────────────────────────
  window.__bridgeReady = false;

  function waitForBridge(callback, maxWait) {
    maxWait = maxWait || 10000;
    const start = Date.now();
    function check() {
      if (window.pywebview && window.pywebview.api) {
        window.__bridgeReady = true;
        callback();
      } else if (Date.now() - start < maxWait) {
        setTimeout(check, 50);
      } else {
        console.error('[bridge] Backend API not available after', maxWait, 'ms');
        var splash = document.getElementById('splash');
        if (splash) {
          splash.innerHTML =
            '<span class="material-symbols-rounded splash-icon" style="color:var(--md-error)">error</span>' +
            '<p class="splash-text">后端连接超时</p>' +
            '<p style="font-size:12px;color:var(--md-on-surface-variant);margin-top:8px">后端 API 不可用，请重启应用</p>';
        }
      }
    }
    check();
  }

  window.__waitForPywebview = waitForBridge;

  // ── SMTC 设置（Electron 专用）──────────────────────────────────────────────

  /**
   * 创建一个静音的隐藏 <audio> 元素，作为 SMTC "心跳"。
   *
   * Chromium 的 SMTC（系统媒体传输控件）只有在检测到 HTMLMediaElement
   * 正在播放时才会激活。本项目使用原生 DLL (Zig + miniaudio) 渲染音频，
   * 不经过 HTMLMediaElement，因此 SMTC 不会触发。
   *
   * 解决方案：创建一个静音、循环播放的 <audio> 元素，在播放时启动它，
   * 让 Chromium 认为有活跃的媒体播放，从而激活 SMTC。
   * 实际音频由原生 DLL 负责渲染，此元素不输出任何声音。
   */
  var _silenceAudio = null;
  var _silenceUnlocked = false;
  var _currentPositionMs = 0;
  var _currentDurationMs = 0;
  var _metadataReady = false;
  var _pendingPlayState = null;

  function _getSilenceAudio() {
    if (_silenceAudio) return _silenceAudio;

    // 生成 1 秒静音 WAV（8000Hz, 8-bit, mono）
    var sampleRate = 8000;
    var numSamples = sampleRate;
    var buffer = new ArrayBuffer(44 + numSamples);
    var view = new DataView(buffer);

    var writeString = function (offset, str) {
      for (var i = 0; i < str.length; i++) {
        view.setUint8(offset + i, str.charCodeAt(i));
      }
    };

    writeString(0, 'RIFF');
    view.setUint32(4, 36 + numSamples, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate, true);
    view.setUint16(32, 1, true);
    view.setUint16(34, 8, true);
    writeString(36, 'data');
    view.setUint32(40, numSamples, true);
    for (var i = 0; i < numSamples; i++) {
      view.setUint8(44 + i, 0x80); // unsigned 8-bit silence
    }

    var blob = new Blob([buffer], { type: 'audio/wav' });
    var url = URL.createObjectURL(blob);

    _silenceAudio = document.createElement('audio');
    _silenceAudio.src = url;
    _silenceAudio.loop = true;
    _silenceAudio.muted = true; // 初始静音：绕过自动播放策略（无用户手势也能 play）
    _silenceAudio.volume = 0;
    _silenceAudio.style.display = 'none';
    _silenceAudio.setAttribute('aria-hidden', 'true');
    // 关键：设置 title 属性。Chromium 在 AUMID 查询失败时，
    // 会回退到媒体元素的 title 或 document.title 作为应用名。
    _silenceAudio.title = 'Project Carminium';
    document.body.appendChild(_silenceAudio);

    return _silenceAudio;
  }

  /**
   * 用户首次交互时解锁静音心跳。
   *
   * Chromium 的 SMTC 只对非静音（muted=false）的 HTMLMediaElement 激活。
   * 初始时 audio.muted=true 以绕过 autoplay 策略，但 SMTC 不会被激活。
   * 用户首次交互后，取消静音（volume 保持 0，无声音输出），
   * 并重新播放以激活 SMTC。
   */
  function _unlockSilenceAudio() {
    if (_silenceUnlocked) return;
    _silenceUnlocked = true;

    // 移除所有解锁监听
    ['click', 'keydown', 'touchstart', 'pointerdown'].forEach(function (evt) {
      document.removeEventListener(evt, _unlockSilenceAudio, true);
    });

    var audio = _getSilenceAudio();
    // 判断当前是否应该正在播放
    var shouldPlay = !audio.paused ||
      navigator.mediaSession.playbackState === 'playing' ||
      _pendingPlayState === 'playing';

    audio.pause();
    // 关键：取消静音以激活 SMTC，volume=0 保证无声音输出
    audio.muted = false;
    audio.volume = 0;

    if (shouldPlay) {
      var p = audio.play();
      if (p && typeof p.then === 'function') {
        p.catch(function () { /* ignore */ });
      }
    }
  }

  function _applyPlayState(state) {
    var audio = _getSilenceAudio();
    if (state === 'playing') {
      var p = audio.play();
      if (p && typeof p.then === 'function') {
        p.catch(function () { /* autoplay 被阻止，等待用户交互解锁 */ });
      }
      navigator.mediaSession.playbackState = 'playing';
      // 恢复 playbackRate，让 SMTC 位置继续推进
      if (_currentDurationMs > 0) {
        try {
          var durSec = _currentDurationMs / 1000;
          var posSec = Math.min(_currentPositionMs, _currentDurationMs) / 1000;
          if (durSec > 0 && posSec >= 0) {
            navigator.mediaSession.setPositionState({
              duration: durSec, position: posSec, playbackRate: 1.0,
            });
          }
        } catch (e) { /* ignore */ }
      }
    } else {
      audio.pause();
      navigator.mediaSession.playbackState = (state === 'none') ? 'none' : 'paused';
      // 关键：playbackRate 设为 0，否则 Chromium 会按上次的 1.0 继续推进 SMTC 位置
      if (_currentDurationMs > 0) {
        try {
          var durSec = _currentDurationMs / 1000;
          var posSec = Math.min(_currentPositionMs, _currentDurationMs) / 1000;
          if (durSec > 0 && posSec >= 0) {
            navigator.mediaSession.setPositionState({
              duration: durSec, position: posSec, playbackRate: 0,
            });
          }
        } catch (e) { /* ignore */ }
      }
    }
  }

  function setupMediaSession() {
    if (!('mediaSession' in navigator)) return;

    // 关键：固定 document.title。Chromium 的 SMTC 在 AUMID 查询失败时，
    // 会回退到 document.title 作为应用显示名。index.html 的 <title> 可能在
    // 路由切换时被改写，这里在初始化时强制固定为应用显示名。
    document.title = 'Project Carminium';

    // 预创建静音心跳元素（需要用户交互后才能真正播放）
    _getSilenceAudio();

    // 用户首次交互时解锁静音心跳：取消静音以激活 SMTC
    ['click', 'keydown', 'touchstart', 'pointerdown'].forEach(function (evt) {
      document.addEventListener(evt, _unlockSilenceAudio, true);
    });

    // ── 媒体按钮事件 → 主进程 ──
    const actionMap = {
      'play': 'play',
      'pause': 'pause',
      'previoustrack': 'prev_track',
      'nexttrack': 'next_track',
    };
    for (const [action, method] of Object.entries(actionMap)) {
      try {
        navigator.mediaSession.setActionHandler(action, function () {
          window.__electronAPI.invoke(method);
        });
      } catch (e) { /* ignore */ }
    }

    // Seek 事件
    try {
      navigator.mediaSession.setActionHandler('seekto', function (details) {
        if (details && details.seekTime !== undefined && details.seekTime !== null) {
          window.__electronAPI.invoke('seek', Math.round(details.seekTime * 1000));
        }
      });
    } catch (e) { /* ignore */ }

    // 快退 / 快进
    try {
      navigator.mediaSession.setActionHandler('seekbackward', function (details) {
        var offset = ((details && details.seekOffset) || 10) * 1000;
        window.__electronAPI.invoke('seek', Math.max(0, _currentPositionMs - offset));
      });
    } catch (e) { /* ignore */ }

    try {
      navigator.mediaSession.setActionHandler('seekforward', function (details) {
        var offset = ((details && details.seekOffset) || 10) * 1000;
        window.__electronAPI.invoke('seek', Math.min(_currentDurationMs, _currentPositionMs + offset));
      });
    } catch (e) { /* ignore */ }

    // 停止
    try {
      navigator.mediaSession.setActionHandler('stop', function () {
        window.__electronAPI.invoke('pause');
      });
    } catch (e) { /* ignore */ }

    // ── 主进程 → navigator.mediaSession 更新 ──

    // 元数据更新（曲目信息、封面）
    window.__electronAPI.onSmtc('metadata', function (data) {
      try {
        _metadataReady = true;
        const metadata = {
          title: data.title || '',
          artist: data.artist || '',
          album: data.album || '',
        };
        if (data.artwork) {
          metadata.artwork = [
            { src: data.artwork, sizes: '96x96', type: 'image/jpeg' },
            { src: data.artwork, sizes: '300x300', type: 'image/jpeg' },
            { src: data.artwork, sizes: '512x512', type: 'image/jpeg' },
          ];
        }
        navigator.mediaSession.metadata = new MediaMetadata(metadata);
        // 如果有等待中的播放状态，现在应用（解决元数据与状态的竞态）
        if (_pendingPlayState !== null) {
          _applyPlayState(_pendingPlayState);
          _pendingPlayState = null;
        }
      } catch (e) { /* ignore */ }
    });

    // 播放状态更新
    window.__electronAPI.onSmtc('state', function (state) {
      try {
        if (!_metadataReady && state === 'playing') {
          // 元数据尚未就绪：先播放静音心跳（muted 可绕过 autoplay 策略），
          // 延迟设置 playbackState 直到元数据就绪，避免 SMTC 显示异常
          _pendingPlayState = 'playing';
          var audio = _getSilenceAudio();
          var p = audio.play();
          if (p && typeof p.then === 'function') {
            p.catch(function () { /* ignore */ });
          }
          return;
        }
        _pendingPlayState = null;
        _applyPlayState(state);
      } catch (e) { /* ignore */ }
    });

    // 位置/时长更新
    window.__electronAPI.onSmtc('position', function (data) {
      _currentPositionMs = data.position || 0;
      _currentDurationMs = data.duration || 0;
      try {
        const durationSec = _currentDurationMs / 1000;
        const positionSec = Math.min(_currentPositionMs, _currentDurationMs) / 1000;
        if (durationSec > 0 && positionSec >= 0) {
          navigator.mediaSession.setPositionState({
            duration: durationSec,
            position: positionSec,
            playbackRate: 1.0,
          });
        }
      } catch (e) { /* ignore */ }
    });

    // 控制中心歌词模式：将当前歌词行作为标题
    window.__electronAPI.onSmtc('lyric_title', function (text) {
      try {
        if (navigator.mediaSession.metadata) {
          const old = navigator.mediaSession.metadata;
          navigator.mediaSession.metadata = new MediaMetadata({
            title: text,
            artist: old.artist,
            album: old.album,
            artwork: old.artwork,
          });
        }
      } catch (e) { /* ignore */ }
    });
  }

})();
