/**
 * Carminium — 渲染进程内存管理器
 *
 * 职责：
 *   1. 定时清理前端缓存（CoverCache、AudioBufferCache）
 *   2. Blob URL 泄漏防护：追踪所有 createObjectURL 并确保最终 revoke
 *   3. 事件监听器泄漏防护：注册/注销追踪
 *   4. 页面导航时自动清理上一页的 DOM 引用和事件监听
 *   5. 切歌时清理上一曲的临时资源
 *   6. 内存压力检测（performance.memory + 主进程上报）
 *   7. 定时向主进程上报渲染进程内存状态
 *
 * 设计理念：
 *   - 非侵入式：通过全局钩子协调现有缓存模块
 *   - 低开销：清理周期 45s，上报周期 60s
 *   - 安全：只清理明确无用的资源，不触碰活跃引用
 *   - 可观测：提供 getStats() 供调试
 */
(function () {
  'use strict';

  // ── 常量 ──────────────────────────────────────────────────────────────

  var CLEANUP_INTERVAL_MS = 45_000;   // 清理周期
  var REPORT_INTERVAL_MS = 60_000;    // 上报周期
  var BLOB_MAX_AGE_MS = 5 * 60_000;   // Blob URL 最大存活时间（5 分钟）
  var LISTENER_WARN_THRESHOLD = 500;   // 单元素监听器告警阈值

  // ── 状态 ──────────────────────────────────────────────────────────────

  var _cleanupTimer = null;
  var _reportTimer = null;
  var _started = false;

  // Blob URL 追踪：Map<url, { url, createdAt, revokeFn }>
  var _blobUrls = new Map();

  // 事件监听器追踪：Map<element, Array<{ type, listener, options, label }>>
  var _trackedListeners = new Map();

  // 页面导航清理回调：每次 navigate 时调用
  var _navigationCleanupCallbacks = [];

  // 切歌清理回调：每次 track_changed 时调用
  var _trackChangeCleanupCallbacks = [];

  // 内存统计缓存
  var _lastStats = null;

  // ── Blob URL 管理 ────────────────────────────────────────────────────

  /**
   * 包装 URL.createObjectURL，追踪创建的 Blob URL。
   * 在清理周期中自动 revoke 超期的 Blob URL。
   * @param {Blob|MediaSource} blob
   * @returns {string} Blob URL
   */
  function createTrackedBlobUrl(blob) {
    var url = URL.createObjectURL(blob);
    _blobUrls.set(url, {
      url: url,
      createdAt: Date.now(),
    });
    return url;
  }

  /**
   * 安全 revoke 并从追踪表移除。
   * @param {string} url
   */
  function revokeTrackedBlobUrl(url) {
    if (!url) return;
    if (_blobUrls.has(url)) {
      try { URL.revokeObjectURL(url); } catch (e) { /* ignore */ }
      _blobUrls.delete(url);
    }
  }

  /**
   * 清理超期的 Blob URL。
   * 不触碰正在使用的 URL（由各缓存模块自行管理 LRU）。
   * 这里只作为最后防线，清理可能被遗忘的 URL。
   */
  function _cleanupStaleBlobs() {
    var now = Date.now();
    var cleaned = 0;
    _blobUrls.forEach(function (entry, url) {
      if (now - entry.createdAt > BLOB_MAX_AGE_MS) {
        try { URL.revokeObjectURL(url); } catch (e) { /* ignore */ }
        _blobUrls.delete(url);
        cleaned++;
      }
    });
    return cleaned;
  }

  // ── 事件监听器追踪 ───────────────────────────────────────────────────

  /**
   * 追踪 addEventListener 调用，以便在页面导航时批量移除。
   * @param {EventTarget} target - 目标元素
   * @param {string} type - 事件类型
   * @param {Function|object} listener - 监听器
   * @param {object|boolean} [options] - 选项
   * @param {string} [label] - 可选标签
   */
  function trackListener(target, type, listener, options, label) {
    if (!target) return;
    target.addEventListener(type, listener, options);
    var list = _trackedListeners.get(target);
    if (!list) {
      list = [];
      _trackedListeners.set(target, list);
    }
    list.push({ type: type, listener: listener, options: options, label: label || '' });

    // 告警：单个元素监听器过多
    if (list.length === LISTENER_WARN_THRESHOLD) {
      console.warn('[MemoryManager] Element has ' + LISTENER_WARN_THRESHOLD +
        '+ listeners:', target, label || '');
    }
  }

  /**
   * 移除目标元素上的所有追踪监听器。
   * @param {EventTarget} target
   */
  function removeAllTrackedListeners(target) {
    var list = _trackedListeners.get(target);
    if (!list) return;
    for (var i = 0; i < list.length; i++) {
      try {
        target.removeEventListener(list[i].type, list[i].listener, list[i].options);
      } catch (e) { /* ignore */ }
    }
    _trackedListeners.delete(target);
  }

  /**
   * 清理已从 DOM 移除的元素上的监听器。
   * 检查追踪表中元素是否仍在 DOM 中，不在则移除其监听器。
   */
  function _cleanupDetachedListeners() {
    var cleaned = 0;
    _trackedListeners.forEach(function (list, target) {
      // 跳过非 Element 目标（如 window、document）
      if (!(target instanceof Node)) return;
      // 跳过仍连接到 DOM 的元素
      if (target.isConnected) return;
      // 元素已从 DOM 移除，清理其监听器
      for (var i = 0; i < list.length; i++) {
        try {
          target.removeEventListener(list[i].type, list[i].listener, list[i].options);
        } catch (e) { /* ignore */ }
      }
      _trackedListeners.delete(target);
      cleaned++;
    });
    return cleaned;
  }

  // ── 缓存清理 ─────────────────────────────────────────────────────────

  /**
   * 执行一轮缓存清理。
   * 调用各缓存模块的清理接口，释放不活跃的缓存条目。
   */
  function _cleanupCaches() {
    var results = {};

    // CoverCache：清理超期 Blob URL
    if (window.CoverCache && window.CoverCache.cleanupStale) {
      try { results.coverCache = window.CoverCache.cleanupStale(); } catch (e) { /* ignore */ }
    }

    // AudioBufferCache：在内存压力下缩减
    if (window.__audioEngine && window.__audioEngine._cache) {
      var stats = window.__audioEngine._cache.stats;
      if (stats && stats.bytes > 60 * 1024 * 1024) {
        // 超过 60MB 时缩减到 40MB，释放旧 AudioBuffer
        try {
          window.__audioEngine._cache.shrinkTo(40 * 1024 * 1024);
          results.audioBufferCache = 'shrunk';
        } catch (e) { /* ignore */ }
      }
    }

    // 清理超期 Blob URL
    results.staleBlobs = _cleanupStaleBlobs();

    // 清理已脱离 DOM 的元素监听器
    results.detachedListeners = _cleanupDetachedListeners();

    return results;
  }

  // ── 页面导航 / 切歌清理 ──────────────────────────────────────────────

  /**
   * 注册页面导航清理回调。
   * 每次用户切换页面时调用，用于清理上一页的临时资源。
   * @param {Function} callback
   */
  function onNavigationCleanup(callback) {
    if (typeof callback === 'function') {
      _navigationCleanupCallbacks.push(callback);
    }
  }

  /**
   * 注册切歌清理回调。
   * 每次曲目变更时调用，用于清理上一曲的临时资源。
   * @param {Function} callback
   */
  function onTrackChangeCleanup(callback) {
    if (typeof callback === 'function') {
      _trackChangeCleanupCallbacks.push(callback);
    }
  }

  /**
   * 触发页面导航清理。
   * 由 app.js navigate() 调用。
   */
  function fireNavigationCleanup() {
    for (var i = 0; i < _navigationCleanupCallbacks.length; i++) {
      try { _navigationCleanupCallbacks[i](); } catch (e) {
        console.warn('[MemoryManager] Navigation cleanup error:', e.message);
      }
    }
  }

  /**
   * 触发切歌清理。
   * 由 app.js _onTrackChanged() 调用。
   */
  function fireTrackChangeCleanup() {
    for (var i = 0; i < _trackChangeCleanupCallbacks.length; i++) {
      try { _trackChangeCleanupCallbacks[i](); } catch (e) {
        console.warn('[MemoryManager] Track change cleanup error:', e.message);
      }
    }
  }

  // ── 内存监控 ─────────────────────────────────────────────────────────

  /**
   * 获取渲染进程内存快照。
   */
  function getStats() {
    var stats = {
      timestamp: Date.now(),
      blobUrls: _blobUrls.size,
      trackedElements: _trackedListeners.size,
      totalTrackedListeners: 0,
    };

    // 统计总追踪监听器数
    _trackedListeners.forEach(function (list) {
      stats.totalTrackedListeners += list.length;
    });

    // performance.memory（Chromium 专有）
    if (performance.memory) {
      stats.jsHeapUsed = performance.memory.usedJSHeapSize;
      stats.jsHeapTotal = performance.memory.totalJSHeapSize;
      stats.jsHeapLimit = performance.memory.jsHeapSizeLimit;
      stats.jsHeapUsedMB = +(performance.memory.usedJSHeapSize / (1024 * 1024)).toFixed(2);
    }

    // AudioBufferCache 统计
    if (window.__audioEngine && window.__audioEngine._cache) {
      var cStats = window.__audioEngine._cache.stats;
      stats.audioBufferCache = cStats;
    }

    // CoverCache 统计
    if (window.CoverCache && window.CoverCache.getStatus) {
      stats.coverCache = window.CoverCache.getStatus();
    }

    _lastStats = stats;
    return stats;
  }

  /**
   * 向主进程上报渲染进程内存状态。
   */
  function _reportToMain() {
    var stats = getStats();
    if (window.__electronAPI && window.__electronAPI.invoke) {
      window.__electronAPI.invoke('memory:report_renderer', JSON.stringify(stats)).catch(function () {});
    }
  }

  // ── 启动 / 停止 ──────────────────────────────────────────────────────

  function start() {
    if (_started) return;
    _started = true;

    _cleanupTimer = setInterval(function () {
      _cleanupCaches();
    }, CLEANUP_INTERVAL_MS);

    _reportTimer = setInterval(function () {
      _reportToMain();
    }, REPORT_INTERVAL_MS);

    // 页面隐藏时暂停清理，可见时恢复并立即执行一次
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) {
        // 页面隐藏时执行一次清理再暂停
        _cleanupCaches();
      } else {
        // 页面恢复可见时立即清理一次
        _cleanupCaches();
      }
    });

    // beforeunload 时向主进程做最后一次上报
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
    _started = false;
  }

  // ── 紧急清理 ─────────────────────────────────────────────────────────

  /**
   * 紧急清理所有非关键缓存。
   * 在内存压力严重时调用。
   */
  function emergencyCleanup() {
    // 清理 CoverCache 的 Blob URL（保留 pinned 的当前播放曲目封面）
    if (window.CoverCache && window.CoverCache.clear) {
      try { window.CoverCache.clear(); } catch (e) { /* ignore */ }
    }

    // 清理 AudioBufferCache（保留当前播放的）
    if (window.__audioEngine && window.__audioEngine._cache) {
      try {
        var currentPath = window.__audioEngine._currentFilePath;
        window.__audioEngine._cache.clear();
        // 重新缓存当前播放的 buffer
        if (window.__audioEngine._currentBuffer && currentPath) {
          window.__audioEngine._cache.set(currentPath, window.__audioEngine._currentBuffer);
        }
      } catch (e) { /* ignore */ }
    }

    // 清理所有追踪的 Blob URL
    _blobUrls.forEach(function (entry, url) {
      try { URL.revokeObjectURL(url); } catch (e) { /* ignore */ }
    });
    _blobUrls.clear();

    // 清理已脱离 DOM 的元素监听器
    _cleanupDetachedListeners();

    // 请求主进程也执行清理
    if (window.__electronAPI && window.__electronAPI.invoke) {
      window.__electronAPI.invoke('memory:request_cleanup').catch(function () {});
      window.__electronAPI.invoke('memory:request_gc').catch(function () {});
    }

    console.log('[MemoryManager:Renderer] Emergency cleanup completed');
  }

  // ── 导出 ─────────────────────────────────────────────────────────────

  window.MemoryManager = {
    start: start,
    stop: stop,
    getStats: getStats,
    emergencyCleanup: emergencyCleanup,
    // Blob URL 管理
    createTrackedBlobUrl: createTrackedBlobUrl,
    revokeTrackedBlobUrl: revokeTrackedBlobUrl,
    // 监听器追踪
    trackListener: trackListener,
    removeAllTrackedListeners: removeAllTrackedListeners,
    // 清理回调注册
    onNavigationCleanup: onNavigationCleanup,
    onTrackChangeCleanup: onTrackChangeCleanup,
    fireNavigationCleanup: fireNavigationCleanup,
    fireTrackChangeCleanup: fireTrackChangeCleanup,
  };

})();
