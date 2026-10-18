(function () {
  'use strict';


  var CLEANUP_INTERVAL_MS = 30_000;
  var REPORT_INTERVAL_MS = 45_000;
  var BLOB_MAX_AGE_MS = 3 * 60_000;
  var LISTENER_WARN_THRESHOLD = 500;
  var AUDIO_CACHE_TRIM_BYTES = 12 * 1024 * 1024;
  var RENDERER_HEAP_SOFT_MB = 160;
  var RENDERER_HEAP_HARD_MB = 220;
  var GC_INTERVAL_MS = 30_000;


  var _cleanupTimer = null;
  var _reportTimer = null;
  var _gcTimer = null;
  var _started = false;

  var _blobUrls = new Map();

  var _trackedListeners = new Map();

  var _navigationCleanupCallbacks = [];

  var _trackChangeCleanupCallbacks = [];

  var _lastStats = null;


  function createTrackedBlobUrl(blob) {
    var url = URL.createObjectURL(blob);
    _blobUrls.set(url, {
      url: url,
      createdAt: Date.now(),
    });
    return url;
  }

  function revokeTrackedBlobUrl(url) {
    if (!url) return;
    if (_blobUrls.has(url)) {
      try { URL.revokeObjectURL(url); } catch (e) {  }
      _blobUrls.delete(url);
    }
  }

  function _cleanupStaleBlobs() {
    var now = Date.now();
    var cleaned = 0;
    _blobUrls.forEach(function (entry, url) {
      if (now - entry.createdAt > BLOB_MAX_AGE_MS) {
        try { URL.revokeObjectURL(url); } catch (e) {  }
        _blobUrls.delete(url);
        cleaned++;
      }
    });
    return cleaned;
  }


  function trackListener(target, type, listener, options, label) {
    if (!target) return;
    target.addEventListener(type, listener, options);
    var list = _trackedListeners.get(target);
    if (!list) {
      list = [];
      _trackedListeners.set(target, list);
    }
    list.push({ type: type, listener: listener, options: options, label: label || '' });

    if (list.length === LISTENER_WARN_THRESHOLD) {
      console.warn('[MemoryManager] Element has ' + LISTENER_WARN_THRESHOLD +
        '+ listeners:', target, label || '');
    }
  }

  function removeAllTrackedListeners(target) {
    var list = _trackedListeners.get(target);
    if (!list) return;
    for (var i = 0; i < list.length; i++) {
      try {
        target.removeEventListener(list[i].type, list[i].listener, list[i].options);
      } catch (e) {  }
    }
    _trackedListeners.delete(target);
  }

  function _cleanupDetachedListeners() {
    var cleaned = 0;
    _trackedListeners.forEach(function (list, target) {
      if (!(target instanceof Node)) return;
      if (target.isConnected) return;
      for (var i = 0; i < list.length; i++) {
        try {
          target.removeEventListener(list[i].type, list[i].listener, list[i].options);
        } catch (e) {  }
      }
      _trackedListeners.delete(target);
      cleaned++;
    });
    return cleaned;
  }


  function _cleanupCaches() {
    var results = {};
    var heapUsedMB = 0;
    if (performance.memory && performance.memory.usedJSHeapSize) {
      heapUsedMB = performance.memory.usedJSHeapSize / (1024 * 1024);
    }
    var rendererUnderPressure = heapUsedMB >= RENDERER_HEAP_SOFT_MB;
    var rendererHardPressure = heapUsedMB >= RENDERER_HEAP_HARD_MB;

    if (window.CoverCache && window.CoverCache.cleanupStale) {
      try { results.coverCache = window.CoverCache.cleanupStale(); } catch (e) {  }
    }
    if (rendererHardPressure && window.CoverCache && window.CoverCache.clear) {
      try {
        window.CoverCache.clear();
        results.coverCachePressure = 'cleared-unpinned';
      } catch (e) {  }
    }

    if (window.__audioEngine && window.__audioEngine._cache) {
      var stats = window.__audioEngine._cache.stats;
      if (stats && (stats.bytes > AUDIO_CACHE_TRIM_BYTES || rendererUnderPressure)) {
        try {
          window.__audioEngine._cache.shrinkTo(
            rendererHardPressure ? 8 * 1024 * 1024 : AUDIO_CACHE_TRIM_BYTES
          );
          results.audioBufferCache = 'shrunk';
        } catch (e) {  }
      }
    }

    if (rendererHardPressure && window.App && window.App.nowPlaying &&
        window.App.nowPlaying.clearBackgroundBlurCache) {
      try {
        window.App.nowPlaying.clearBackgroundBlurCache();
        results.backgroundBlurCache = 'cleared';
      } catch (e) {  }
    }

    results.staleBlobs = _cleanupStaleBlobs();

    results.detachedListeners = _cleanupDetachedListeners();

    return results;
  }


  function _requestGC() {
    if (typeof window.gc !== 'function') return false;
    var run = function () {
      try { window.gc(); } catch (e) {  }
    };
    if (typeof window.requestIdleCallback === 'function') {
      window.requestIdleCallback(run, { timeout: 3000 });
    } else {
      setTimeout(run, 0);
    }
    return true;
  }


  function onNavigationCleanup(callback) {
    if (typeof callback === 'function') {
      _navigationCleanupCallbacks.push(callback);
    }
  }

  function onTrackChangeCleanup(callback) {
    if (typeof callback === 'function') {
      _trackChangeCleanupCallbacks.push(callback);
    }
  }

  function fireNavigationCleanup() {
    for (var i = 0; i < _navigationCleanupCallbacks.length; i++) {
      try { _navigationCleanupCallbacks[i](); } catch (e) {
        console.warn('[MemoryManager] Navigation cleanup error:', e.message);
      }
    }
  }

  function fireTrackChangeCleanup() {
    for (var i = 0; i < _trackChangeCleanupCallbacks.length; i++) {
      try { _trackChangeCleanupCallbacks[i](); } catch (e) {
        console.warn('[MemoryManager] Track change cleanup error:', e.message);
      }
    }
  }


  function getStats() {
    var stats = {
      timestamp: Date.now(),
      blobUrls: _blobUrls.size,
      trackedElements: _trackedListeners.size,
      totalTrackedListeners: 0,
    };

    _trackedListeners.forEach(function (list) {
      stats.totalTrackedListeners += list.length;
    });

    if (performance.memory) {
      stats.jsHeapUsed = performance.memory.usedJSHeapSize;
      stats.jsHeapTotal = performance.memory.totalJSHeapSize;
      stats.jsHeapLimit = performance.memory.jsHeapSizeLimit;
      stats.jsHeapUsedMB = +(performance.memory.usedJSHeapSize / (1024 * 1024)).toFixed(2);
    }

    if (window.__audioEngine && window.__audioEngine._cache) {
      var cStats = window.__audioEngine._cache.stats;
      stats.audioBufferCache = cStats;
    }

    if (window.CoverCache && window.CoverCache.getStatus) {
      stats.coverCache = window.CoverCache.getStatus();
    }

    _lastStats = stats;
    return stats;
  }

  function _reportToMain() {
    var stats = getStats();
    if (window.__electronAPI && window.__electronAPI.invoke) {
      window.__electronAPI.invoke('memory:report_renderer', JSON.stringify(stats)).catch(function () {});
      window.__electronAPI.invoke('memory:get_pressure').then(function (level) {
        if (level === 'critical') {
          emergencyCleanup();
        } else if (level === 'elevated') {
          _cleanupCaches();
        }
      }).catch(function () {});
    }
  }


  function start() {
    if (_started) return;
    _started = true;

    _cleanupTimer = setInterval(function () {
      _cleanupCaches();
    }, CLEANUP_INTERVAL_MS);

    _reportTimer = setInterval(function () {
      _reportToMain();
    }, REPORT_INTERVAL_MS);

    _gcTimer = setInterval(function () {
      _cleanupCaches();
      _requestGC();
    }, GC_INTERVAL_MS);

    document.addEventListener('visibilitychange', function () {
      if (document.hidden) {
        _cleanupCaches();
      } else {
        _cleanupCaches();
      }
    });

    window.addEventListener('beforeunload', function () {
      _reportToMain();
    });

    console.log('[MemoryManager:Renderer] Started — cleanup:', CLEANUP_INTERVAL_MS + 'ms',
      'report:', REPORT_INTERVAL_MS + 'ms');
  }

  function stop() {
    if (_cleanupTimer) {
      clearInterval(_cleanupTimer);
      _cleanupTimer = null;
    }
    if (_reportTimer) {
      clearInterval(_reportTimer);
      _reportTimer = null;
    }
    if (_gcTimer) {
      clearInterval(_gcTimer);
      _gcTimer = null;
    }
    _started = false;
  }


  function emergencyCleanup() {
    if (window.CoverCache && window.CoverCache.clear) {
      try { window.CoverCache.clear(); } catch (e) {  }
    }

    if (window.__audioEngine && window.__audioEngine._cache) {
      try {
        var currentPath = window.__audioEngine._currentFilePath;
        window.__audioEngine._cache.clear();
        if (window.__audioEngine._currentBuffer && currentPath) {
          window.__audioEngine._cache.set(currentPath, window.__audioEngine._currentBuffer);
        }
      } catch (e) {  }
    }

    if (window.App && window.App.nowPlaying &&
        window.App.nowPlaying.clearBackgroundBlurCache) {
      try { window.App.nowPlaying.clearBackgroundBlurCache(); } catch (e) {  }
    }

    _blobUrls.forEach(function (entry, url) {
      try { URL.revokeObjectURL(url); } catch (e) {  }
    });
    _blobUrls.clear();

    _cleanupDetachedListeners();

    _requestGC();

    if (window.__electronAPI && window.__electronAPI.invoke) {
      window.__electronAPI.invoke('memory:request_cleanup').catch(function () {});
      window.__electronAPI.invoke('memory:request_gc').catch(function () {});
    }

    console.log('[MemoryManager:Renderer] Emergency cleanup completed');
  }


  window.MemoryManager = {
    start: start,
    stop: stop,
    getStats: getStats,
    emergencyCleanup: emergencyCleanup,
    requestGC: _requestGC,
    createTrackedBlobUrl: createTrackedBlobUrl,
    revokeTrackedBlobUrl: revokeTrackedBlobUrl,
    trackListener: trackListener,
    removeAllTrackedListeners: removeAllTrackedListeners,
    onNavigationCleanup: onNavigationCleanup,
    onTrackChangeCleanup: onTrackChangeCleanup,
    fireNavigationCleanup: fireNavigationCleanup,
    fireTrackChangeCleanup: fireTrackChangeCleanup,
  };

})();
