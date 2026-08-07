/**
 * CoverCache — 封面图片池化缓存
 *
 * 功能：
 *   - LRU 缓存 Blob URL（按 track_id 索引）
 *   - 统一尺寸（缩放到 COVER_SIZE×COVER_SIZE）+ JPEG 压缩
 *   - 视口预加载（viewport 内 + 前后各 PREFETCH_MARGIN 张）
 *   - 加载中/加载失败占位
 *   - 色彩占位（从后端 cover_colors 表获取 16 色数据，绘制渐变占位）
 *
 * 容量策略：
 *   根据窗口尺寸动态计算，最大 COVER_POOL_MAX 张。
 *   超出时淘汰最久未使用的 Blob URL（revokeObjectURL）。
 */
(function () {
  'use strict';

  // ── 常量 ──────────────────────────────────────────────────────

  var COVER_SIZE = 300;           // 统一缩放尺寸
  var COVER_QUALITY = 0.82;        // JPEG 压缩质量
  var PREFETCH_MARGIN = 10;        // 视口前后预加载数量
  var COVER_POOL_MAX = 40;         // 最大缓存数量（收紧，降低渲染进程内存）
  var PREFETCH_CONCURRENCY = 4;   // 并发预加载数量

  // ── 状态 ──────────────────────────────────────────────────────

  var _blobCache = new Map();      // key(track_id + '\0' + size) → { url, timestamp, status }
  // status: 'ready' | 'loading' | 'error' | 'no-cover'
  var _colorCache = new Map();     // track_id → [[r,g,b], ...] (16 colors)
  var _loadingQueue = new Set();   // 正在加载的 key
  var _pendingCallbacks = {};     // key → [callbacks]
  var _maxPoolSize = COVER_POOL_MAX;
  var _observer = null;            // IntersectionObserver
  var _observedElements = new Map(); // element → track_id
  var _pinned = new Set();        // pin 的 track_id，不会被 cleanupStale / clear 清理
  var _reportedColors = new Set(); // 已上报过色彩、无需重复上报的 track_id

  /**
   * 生成缓存键，将 track_id 与目标尺寸组合，使同一曲目不同尺寸各自缓存。
   * size 缺省时回落到 COVER_SIZE（保证未显式指定尺寸的调用方行为不变）。
   */
  function _key(trackId, size) {
    return String(trackId) + '\u0000' + (size || COVER_SIZE);
  }

  /**
   * 判断某缓存键是否属于被 pin 的曲目（按 track_id 前缀匹配，
   * 这样该曲目任意尺寸的封面都不会被清理）。
   */
  function _isPinned(key) {
    var pinned = false;
    _pinned.forEach(function (tid) {
      if (key.indexOf(tid + '\u0000') === 0) pinned = true;
    });
    return pinned;
  }

  // ── 工具函数 ──────────────────────────────────────────────────

  function _now() { return Date.now(); }

  /**
   * 根据窗口大小动态计算池容量。
   * 每张约 300×300 JPEG ≈ 30KB，上限 60 张 ≈ 1.8MB
   */
  function _recalcPoolSize() {
    var w = window.innerWidth;
    var h = window.innerHeight;
    // 假设每行卡片约 160px 宽，间距 16px
    var cols = Math.max(3, Math.floor(w / 176));
    var rows = Math.ceil(h / 200) + PREFETCH_MARGIN * 2;
    var calculated = cols * rows;
    _maxPoolSize = Math.min(COVER_POOL_MAX, Math.max(20, calculated));
  }

  /**
   * 淘汰最久未使用的缓存项。
   * pin 的 track_id 不会被淘汰。
   */
  function _evict() {
    while (_blobCache.size >= _maxPoolSize) {
      // Map 的迭代顺序 = 插入顺序，最前面的是最旧的
      var oldest = _blobCache.keys().next();
      if (oldest.done) break;
      var key = oldest.value;
      // pin 的条目跳过（移到末尾保持，不淘汰）
      if (_isPinned(key)) {
        var pinnedEntry = _blobCache.get(key);
        _blobCache.delete(key);
        _blobCache.set(key, pinnedEntry);
        continue;
      }
      var entry = _blobCache.get(key);
      if (entry && entry.url) {
        try { URL.revokeObjectURL(entry.url); } catch (e) { /* ignore */ }
      }
      _blobCache.delete(key);
    }
  }

  /**
   * 将图片元素绘制到 canvas，缩放并压缩为 JPEG Blob。
   * @param {HTMLImageElement} img
   * @param {number|string} [size] 目标边长（px）；缺省回落到 COVER_SIZE。
   *   不放大：当原图最长边小于目标尺寸时按原图尺寸输出，避免无谓占用更多内存。
   */
  function _processImage(img, size) {
    return new Promise(function (resolve, reject) {
      try {
        var iw = img.naturalWidth || img.width;
        var ih = img.naturalHeight || img.height;
        if (iw === 0 || ih === 0) {
          reject(new Error('zero-size image'));
          return;
        }
        var target = size || COVER_SIZE;
        // size 为 'max' 时按原图最长边输出（即原始最大分辨率）
        var eff = (target === 'max') ? Math.max(iw, ih) : Math.min(target, Math.max(iw, ih));
        var canvas = document.createElement('canvas');
        canvas.width = eff;
        canvas.height = eff;
        var ctx = canvas.getContext('2d', { willReadFrequently: false });

        // cover 绘制（居中裁剪为正方形）
        var scale = Math.max(eff / iw, eff / ih);
        var sw = eff / scale;
        var sh = eff / scale;
        var sx = (iw - sw) / 2;
        var sy = (ih - sh) / 2;
        ctx.drawImage(img, sx, sy, sw, sh, 0, 0, eff, eff);

        canvas.toBlob(function (blob) {
          if (blob) {
            resolve(blob);
          } else {
            reject(new Error('toBlob failed'));
          }
        }, 'image/jpeg', COVER_QUALITY);
      } catch (e) {
        reject(e);
      }
    });
  }

  /**
   * 从封面图片提取 16 个主色调（用于色彩占位）。
   * 使用中位切割法（简化版）。
   */
  function _extractColors(img) {
    try {
      var canvas = document.createElement('canvas');
      canvas.width = 16;
      canvas.height = 16;
      var ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, 16, 16);
      var data = ctx.getImageData(0, 0, 16, 16).data;

      // 收集所有像素
      var pixels = [];
      for (var i = 0; i < data.length; i += 4) {
        if (data[i + 3] < 128) continue;
        pixels.push([data[i], data[i + 1], data[i + 2]]);
      }
      if (pixels.length === 0) return null;

      // 中位切割量化到 16 色
      var buckets = [pixels];
      while (buckets.length < 16) {
        // 找方差最大的桶
        var maxVar = -1;
        var maxIdx = -1;
        var maxChannel = 0;
        for (var b = 0; b < buckets.length; b++) {
          if (buckets[b].length < 2) continue;
          var stats = _channelVariance(buckets[b]);
          if (stats.maxVar > maxVar) {
            maxVar = stats.maxVar;
            maxIdx = b;
            maxChannel = stats.channel;
          }
        }
        if (maxIdx < 0) break;
        // 按最大方差通道排序并分割
        var bucket = buckets[maxIdx];
        bucket.sort(function (a, b2) { return a[maxChannel] - b2[maxChannel]; });
        var mid = Math.floor(bucket.length / 2);
        buckets.splice(maxIdx, 1, bucket.slice(0, mid), bucket.slice(mid));
      }

      // 计算每个桶的平均颜色
      var colors = [];
      for (var c = 0; c < buckets.length; c++) {
        var avg = _avgColor(buckets[c]);
        colors.push(avg);
      }
      // 补齐到 16 色
      while (colors.length < 16) {
        colors.push(colors[colors.length % colors.length] || [128, 128, 128]);
      }
      return colors.slice(0, 16);
    } catch (e) {
      return null;
    }
  }

  function _channelVariance(pixels) {
    var rs = [0, 0, 0]; // sum
    for (var i = 0; i < pixels.length; i++) {
      rs[0] += pixels[i][0];
      rs[1] += pixels[i][1];
      rs[2] += pixels[i][2];
    }
    var means = [rs[0] / pixels.length, rs[1] / pixels.length, rs[2] / pixels.length];
    var vars = [0, 0, 0];
    for (var j = 0; j < pixels.length; j++) {
      vars[0] += Math.pow(pixels[j][0] - means[0], 2);
      vars[1] += Math.pow(pixels[j][1] - means[1], 2);
      vars[2] += Math.pow(pixels[j][2] - means[2], 2);
    }
    var maxVar = Math.max(vars[0], vars[1], vars[2]);
    var channel = vars[0] === maxVar ? 0 : (vars[1] === maxVar ? 1 : 2);
    return { maxVar: maxVar, channel: channel };
  }

  function _avgColor(pixels) {
    if (!pixels || pixels.length === 0) return [128, 128, 128];
    var r = 0, g = 0, b = 0;
    for (var i = 0; i < pixels.length; i++) {
      r += pixels[i][0];
      g += pixels[i][1];
      b += pixels[i][2];
    }
    var n = pixels.length;
    return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
  }

  // ── 核心加载逻辑 ──────────────────────────────────────────────

  /**
   * 加载单张封面图片，处理为 Blob URL 并缓存。
   * @param {string} trackId
   * @param {Function} callback  (url | null)
   * @param {number|string} [size] 目标尺寸；缺省回落到 COVER_SIZE
   */
  function _loadCover(trackId, callback, size) {
    if (!trackId) { callback(null); return; }
    var key = _key(trackId, size);

    // 已缓存
    var entry = _blobCache.get(key);
    if (entry) {
      // LRU：移到末尾并刷新 timestamp（防止 cleanupStale 误删正在使用的封面）
      entry.timestamp = _now();
      _blobCache.delete(key);
      _blobCache.set(key, entry);
      callback(entry.status === 'ready' ? entry.url : null);
      return;
    }

    // 正在加载
    if (_loadingQueue.has(key)) {
      if (!_pendingCallbacks[key]) _pendingCallbacks[key] = [];
      _pendingCallbacks[key].push(callback);
      return;
    }

    _loadingQueue.add(key);
    if (!_pendingCallbacks[key]) _pendingCallbacks[key] = [];
    _pendingCallbacks[key].push(callback);

    // 预留缓存槽
    _evict();

    // 加载图片
    var img = new Image();
    img.crossOrigin = 'anonymous';
    img.loading = 'eager';
    var url = window.coverUrl(trackId, size);
    var done = false;

    img.onload = function () {
      if (done) return;
      done = true;
      _loadingQueue.delete(key);

      // 处理为指定尺寸的 JPEG Blob
      _processImage(img, size).then(function (blob) {
        var blobUrl = URL.createObjectURL(blob);
        _blobCache.set(key, { url: blobUrl, timestamp: _now(), status: 'ready' });

        // 提取 16 色并存入缓存（色彩与尺寸无关，按 track_id 存储，仅上报一次）
        var colors = _extractColors(img);
        if (colors) {
          _colorCache.set(trackId, colors);
          if (!_reportedColors.has(trackId)) {
            _reportedColors.add(trackId);
            _reportColors(trackId, colors);
          }
        }

        _flushCallbacks(key, blobUrl);
      }).catch(function () {
        _blobCache.set(key, { url: null, timestamp: _now(), status: 'error' });
        _flushCallbacks(key, null);
      });
    };

    img.onerror = function () {
      if (done) return;
      done = true;
      _loadingQueue.delete(key);
      _blobCache.set(key, { url: null, timestamp: _now(), status: 'no-cover' });
      _flushCallbacks(key, null);
    };

    img.src = url;
  }

  function _flushCallbacks(key, url) {
    var cbs = _pendingCallbacks[key];
    if (cbs) {
      delete _pendingCallbacks[key];
      cbs.forEach(function (cb) {
        try { cb(url); } catch (e) { /* ignore */ }
      });
    }
  }

  /**
   * 上报色彩数据到后端存储（fire-and-forget）。
   */
  function _reportColors(trackId, colors) {
    try {
      if (window.__electronAPI && window.__electronAPI.invoke) {
        window.__electronAPI.invoke('store_cover_colors', trackId, JSON.stringify(colors));
      }
    } catch (e) { /* ignore */ }
  }

  // ── 公共 API ──────────────────────────────────────────────────

  /**
   * 获取缓存的封面 Blob URL（如果已缓存）。
   * @param {string} trackId
   * @returns {string|null}
   */
  function getCached(trackId, size) {
    var entry = _blobCache.get(_key(trackId, size));
    if (entry && entry.status === 'ready' && entry.url) {
      // LRU touch + 刷新 timestamp（防止 cleanupStale 误删正在使用的封面）
      entry.timestamp = _now();
      _blobCache.delete(_key(trackId, size));
      _blobCache.set(_key(trackId, size), entry);
      return entry.url;
    }
    return null;
  }

  /**
   * 异步获取封面（从缓存或触发加载）。
   * @param {string} trackId
   * @param {Function} callback  (url | null)
   * @param {number|string} [size] 目标尺寸；缺省回落到 COVER_SIZE
   */
  function getCover(trackId, callback, size) {
    _loadCover(trackId, callback, size);
  }

  /**
   * 预加载一组封面。
   * @param {string[]} trackIds
   */
  function preload(trackIds, size) {
    if (!trackIds || trackIds.length === 0) return;
    var toLoad = [];
    for (var i = 0; i < trackIds.length; i++) {
      var id = trackIds[i];
      var key = _key(id, size);
      if (!_blobCache.has(key) && !_loadingQueue.has(key)) {
        toLoad.push(id);
      }
    }
    // 限制并发
    var idx = 0;
    function _next() {
      if (idx >= toLoad.length) return;
      var id = toLoad[idx++];
      _loadCover(id, function () {
        _next();
      }, size);
    }
    for (var c = 0; c < PREFETCH_CONCURRENCY; c++) {
      _next();
    }
  }

  /**
   * 将封面绑定到 <img> 元素，带加载状态和占位。
   * @param {HTMLImageElement} imgEl
   * @param {string} trackId
   * @param {object} [opts]  { onLoading: fn, onError: fn, placeholder: string }
   */
  function attachImage(imgEl, trackId, opts) {
    opts = opts || {};
    if (!trackId) {
      if (opts.onError) opts.onError();
      return;
    }

    var size = opts.size;

    // 已缓存：直接设置
    var cached = getCached(trackId, size);
    if (cached) {
      imgEl.src = cached;
      return;
    }

    // 加载中：先显示占位
    if (opts.onLoading) opts.onLoading();
    imgEl.dataset.loading = '1';

    _loadCover(trackId, function (url) {
      if (imgEl.dataset.loading !== '1') return; // 元素已被复用
      delete imgEl.dataset.loading;
      if (url) {
        imgEl.src = url;
      } else {
        if (opts.onError) opts.onError();
      }
    }, size);
  }

  /**
   * 获取色彩占位数据。
   * @param {string} trackId
   * @returns {number[][]|null} 16 个 RGB 颜色
   */
  function getColors(trackId) {
    return _colorCache.get(trackId) || null;
  }

  /**
   * 设置色彩数据（从后端批量加载时调用）。
   * @param {object} map  { track_id: [[r,g,b],...] }
   */
  function setColors(map) {
    if (!map) return;
    Object.keys(map).forEach(function (tid) {
      _colorCache.set(tid, map[tid]);
    });
  }

  /**
   * 生成基于 16 色的渐变 CSS 背景。
   * @param {number[][]} colors  16 个 [r,g,b]
   * @returns {string} CSS background
   */
  function colorGradient(colors) {
    if (!colors || colors.length === 0) return '';
    // 用前 4 个主色做渐变
    var stops = colors.slice(0, 4).map(function (c, i) {
      var pct = Math.round((i / 4) * 100);
      return 'rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ') ' + pct + '%';
    });
    stops.push('rgb(' + colors[0][0] + ',' + colors[0][1] + ',' + colors[0][2] + ') 100%');
    return 'linear-gradient(135deg, ' + stops.join(', ') + ')';
  }

  /**
   * 清除所有缓存（在切换页面或大量数据变化时）。
   * pin 的 track_id 会被保留。
   */
  function clear() {
    var pinnedEntries = [];
    _blobCache.forEach(function (entry, key) {
      if (_isPinned(key)) {
        pinnedEntries.push({ key: key, entry: entry });
        return;
      }
      if (entry && entry.url) {
        try { URL.revokeObjectURL(entry.url); } catch (e) { /* ignore */ }
      }
    });
    _blobCache.clear();
    // 恢复 pinned 条目
    pinnedEntries.forEach(function (item) {
      _blobCache.set(item.key, item.entry);
    });
    _loadingQueue.clear();
    _pendingCallbacks = {};
  }

  /**
   * 清除所有缓存，包括 pinned 的条目。
   */
  function clearAll() {
    _blobCache.forEach(function (entry) {
      if (entry && entry.url) {
        try { URL.revokeObjectURL(entry.url); } catch (e) { /* ignore */ }
      }
    });
    _blobCache.clear();
    _loadingQueue.clear();
    _pendingCallbacks = {};
    _pinned.clear();
  }

  /**
   * 清理超期的缓存条目。
   * 由 MemoryManager 定时调用，回收长时间未被访问的 Blob URL。
   * 只清理超过 STALE_THRESHOLD_MS 未被访问的条目。
   * @returns {number} 清理的条目数
   */
  function cleanupStale() {
    var STALE_THRESHOLD_MS = 3 * 60 * 1000; // 3 分钟未被访问
    var now = _now();
    var cleaned = 0;
    _blobCache.forEach(function (entry, key) {
      if (entry.status !== 'ready') return;
      // pin 的条目不清理（当前播放曲目等）
      if (_isPinned(key)) return;
      if (entry.url && (now - entry.timestamp) > STALE_THRESHOLD_MS) {
        try { URL.revokeObjectURL(entry.url); } catch (e) { /* ignore */ }
        _blobCache.delete(key);
        cleaned++;
      }
    });
    // 同时清理过大的 colorCache
    if (_colorCache.size > _maxPoolSize * 2) {
      var toRemove = _colorCache.size - _maxPoolSize;
      var iter = _colorCache.keys();
      for (var i = 0; i < toRemove; i++) {
        var k = iter.next().value;
        if (k === undefined) break;
        _colorCache.delete(k);
      }
    }
    return cleaned;
  }

  /**
   * 获取缓存状态。
   */
  function getStatus() {
    return {
      cached: _blobCache.size,
      loading: _loadingQueue.size,
      maxPool: _maxPoolSize,
      colorCache: _colorCache.size,
      pinned: _pinned.size,
    };
  }

  /**
   * Pin 一个 track_id，使其封面不会被 cleanupStale / clear 清理。
   * 用于保护当前正在播放/显示的曲目封面。
   * @param {string} trackId
   */
  function pin(trackId) {
    if (trackId) _pinned.add(trackId);
  }

  /**
   * 取消 pin。
   * @param {string} trackId
   */
  function unpin(trackId) {
    if (trackId) _pinned.delete(trackId);
  }

  // ── 初始化 ────────────────────────────────────────────────────

  function init() {
    _recalcPoolSize();
    window.addEventListener('resize', _debounce(_recalcPoolSize, 300));
    console.log('[cover_cache] 已初始化, 池容量:', _maxPoolSize);
  }

  function _debounce(fn, ms) {
    var t = null;
    return function () {
      clearTimeout(t);
      var args = arguments;
      t = setTimeout(function () { fn.apply(null, args); }, ms);
    };
  }

  // ── 导出 ──────────────────────────────────────────────────────

  window.CoverCache = {
    init: init,
    getCached: getCached,
    getCover: getCover,
    preload: preload,
    attachImage: attachImage,
    getColors: getColors,
    setColors: setColors,
    colorGradient: colorGradient,
    clear: clear,
    clearAll: clearAll,
    cleanupStale: cleanupStale,
    getStatus: getStatus,
    pin: pin,
    unpin: unpin,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
