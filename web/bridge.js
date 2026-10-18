(function () {
  'use strict';

  const isElectron = !!(window.__electronAPI && window.__electronAPI.isElectron);

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

  window.__coverBase = '';

  window.coverUrl = function (trackId, size) {
    var url = window.__coverBase + '/cover/' + trackId;
    if (size && size !== 'default' && size !== 'auto') {
      url += '?size=' + encodeURIComponent(String(size));
    }
    return url;
  };

  window.artistImageUrl = function (name) {
    if (!name) return '';
    return window.__coverBase + '/artist-image/' + encodeURIComponent(name);
  };

  const SIGNAL_NAMES = new Set([
    'track_changed', 'playback_state_changed', 'position_changed',
    'duration_changed', 'volume_changed', 'shuffle_changed',
    'repeat_changed', 'queue_changed', 'liked_changed',
    'library_updated', 'folders_updated', 'settings_changed',
    'floating_window_closed', 'bpm_analyzed',
    'lyrics_changed', 'playlists_changed', 'history_changed',
    'liked_tracks_changed', 'subsonic_servers_changed',
    'remote_servers_changed', 'library_scan_status',
    'automix_takeover', 'playback_error'
  ]);

  function createSignal(eventName) {
    return {
      connect: function (cb) {
        window.__bridge.on(eventName, cb);
      }
    };
  }

  if (isElectron) {
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

    window.__electronAPI.onBridgeEvent(function (event, payload) {
      window.__bridge.dispatch(event, payload);
    });

    window.__appFrozen = false;
    window.__bridge.on('app:visibility', function (state) {
      window.__appFrozen = state === 'background';
      if (window.__appFrozen) {
        if (window.MemoryManager && window.MemoryManager.emergencyCleanup) {
          window.MemoryManager.emergencyCleanup();
        }
      }
    });

    setupMediaSession();
  }

  const App = window.App || {};
  window.App = App;

  App.backend = new Proxy({}, {
    get: function (_target, method) {
      if (SIGNAL_NAMES.has(method)) {
        return createSignal(method);
      }
      return function () {
        const args = Array.prototype.slice.call(arguments);
        const api = window.pywebview && window.pywebview.api;
        if (!api || typeof api[method] !== 'function') {
          console.warn('[bridge] API not ready or method missing:', method);
          return Promise.resolve(undefined);
        }
        if (args.length > 0 && typeof args[args.length - 1] === 'function') {
          const cb = args.pop();
          return api[method].apply(api, args).then(cb);
        }
        return api[method].apply(api, args);
      };
    }
  });

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


  var _silenceAudio = null;
  var _silenceUnlocked = false;
  var _currentPositionMs = 0;
  var _currentDurationMs = 0;
  var _metadataReady = false;
  var _pendingPlayState = null;

  function _getSilenceAudio() {
    if (_silenceAudio) return _silenceAudio;

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
      view.setUint8(44 + i, 0x80);
    }

    var blob = new Blob([buffer], { type: 'audio/wav' });
    var url = URL.createObjectURL(blob);

    _silenceAudio = document.createElement('audio');
    _silenceAudio.src = url;
    _silenceAudio.loop = true;
    _silenceAudio.muted = true;
    _silenceAudio.volume = 0;
    _silenceAudio.style.display = 'none';
    _silenceAudio.setAttribute('aria-hidden', 'true');
    _silenceAudio.title = 'Project Carminium';
    document.body.appendChild(_silenceAudio);

    return _silenceAudio;
  }

  function _unlockSilenceAudio() {
    if (_silenceUnlocked) return;
    _silenceUnlocked = true;

    ['click', 'keydown', 'touchstart', 'pointerdown'].forEach(function (evt) {
      document.removeEventListener(evt, _unlockSilenceAudio, true);
    });

    var audio = _getSilenceAudio();
    var shouldPlay = !audio.paused ||
      navigator.mediaSession.playbackState === 'playing' ||
      _pendingPlayState === 'playing';

    audio.pause();
    audio.muted = false;
    audio.volume = 0;

    if (shouldPlay) {
      var p = audio.play();
      if (p && typeof p.then === 'function') {
        p.catch(function () {  });
      }
    }
  }

  function _applyPlayState(state) {
    var audio = _getSilenceAudio();
    if (state === 'playing') {
      var p = audio.play();
      if (p && typeof p.then === 'function') {
        p.catch(function () {  });
      }
      navigator.mediaSession.playbackState = 'playing';
      if (_currentDurationMs > 0) {
        try {
          var durSec = _currentDurationMs / 1000;
          var posSec = Math.min(_currentPositionMs, _currentDurationMs) / 1000;
          if (durSec > 0 && posSec >= 0) {
            navigator.mediaSession.setPositionState({
              duration: durSec, position: posSec, playbackRate: 1.0,
            });
          }
        } catch (e) {  }
      }
    } else {
      audio.pause();
      navigator.mediaSession.playbackState = (state === 'none') ? 'none' : 'paused';
      if (_currentDurationMs > 0) {
        try {
          var durSec = _currentDurationMs / 1000;
          var posSec = Math.min(_currentPositionMs, _currentDurationMs) / 1000;
          if (durSec > 0 && posSec >= 0) {
            navigator.mediaSession.setPositionState({
              duration: durSec, position: posSec, playbackRate: 0,
            });
          }
        } catch (e) {  }
      }
    }
  }

  function setupMediaSession() {
    if (!('mediaSession' in navigator)) return;

    document.title = 'Project Carminium';

    _getSilenceAudio();

    ['click', 'keydown', 'touchstart', 'pointerdown'].forEach(function (evt) {
      document.addEventListener(evt, _unlockSilenceAudio, true);
    });

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
      } catch (e) {  }
    }

    try {
      navigator.mediaSession.setActionHandler('seekto', function (details) {
        if (details && details.seekTime !== undefined && details.seekTime !== null) {
          window.__electronAPI.invoke('seek', Math.round(details.seekTime * 1000));
        }
      });
    } catch (e) {  }

    try {
      navigator.mediaSession.setActionHandler('seekbackward', function (details) {
        var offset = ((details && details.seekOffset) || 10) * 1000;
        window.__electronAPI.invoke('seek', Math.max(0, _currentPositionMs - offset));
      });
    } catch (e) {  }

    try {
      navigator.mediaSession.setActionHandler('seekforward', function (details) {
        var offset = ((details && details.seekOffset) || 10) * 1000;
        window.__electronAPI.invoke('seek', Math.min(_currentDurationMs, _currentPositionMs + offset));
      });
    } catch (e) {  }

    try {
      navigator.mediaSession.setActionHandler('stop', function () {
        window.__electronAPI.invoke('pause');
      });
    } catch (e) {  }


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
        if (_pendingPlayState !== null) {
          _applyPlayState(_pendingPlayState);
          _pendingPlayState = null;
        }
      } catch (e) {  }
    });

    window.__electronAPI.onSmtc('state', function (state) {
      try {
        if (!_metadataReady && state === 'playing') {
          _pendingPlayState = 'playing';
          var audio = _getSilenceAudio();
          var p = audio.play();
          if (p && typeof p.then === 'function') {
            p.catch(function () {  });
          }
          return;
        }
        _pendingPlayState = null;
        _applyPlayState(state);
      } catch (e) {  }
    });

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
      } catch (e) {  }
    });

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
      } catch (e) {  }
    });
  }

})();
