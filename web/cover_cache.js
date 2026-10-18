(function () {
  'use strict';


  var COVER_SIZE = 300;
  var COVER_QUALITY = 0.82;
  var PREFETCH_MARGIN = 6;
  var COVER_POOL_MAX = 240;
  var COLOR_CACHE_MAX = 200;
  var PREFETCH_CONCURRENCY = 3;

  function _isSquareAtTarget(img, size) {
    if (size === 'max' || size === 'original') return false;
    var w = img.naturalWidth || img.width;
    var h = img.naturalHeight || img.height;
    if (!w || !h) return false;
    if (w !== h) return false;
    var target = size || COVER_SIZE;
    return Math.abs(w - target) <= 1;
  }


  var _blobCache = new Map();
  var _NO_COVER_TTL_MS = 60 * 1000;
  var _colorCache = new Map();
  var _loadingQueue = new Set();
  var _pendingCallbacks = {};
  var _maxPoolSize = COVER_POOL_MAX;
  var _observer = null;
  var _observedElements = new Map();
  var _pinned = new Set();
  var _visible = new Set();
  var _reportedColors = new Set();

  function _key(trackId, size) {
    return String(trackId) + '\u0000' + (size || COVER_SIZE);
  }

  function _isPinned(key) {
    var pinned = false;
    _pinned.forEach(function (tid) {
      if (key.indexOf(tid + '\u0000') === 0) pinned = true;
    });
    return pinned;
  }

  function _isVisible(key) {
    var sep = key.indexOf('\u0000');
    return sep >= 0 && _visible.has(key.substring(0, sep));
  }


  function _now() { return Date.now(); }

  function _recalcPoolSize() {
    var w = window.innerWidth;
    var h = window.innerHeight;
    var cols = Math.max(3, Math.floor(w / 176));
    var rows = Math.ceil(h / 200) + PREFETCH_MARGIN * 2;
    var calculated = cols * rows;
    _maxPoolSize = Math.min(COVER_POOL_MAX, Math.max(60, calculated * 3));
  }

  function _evict() {
    var guard = _blobCache.size + 1;
    while (_blobCache.size >= _maxPoolSize) {
      if (guard-- <= 0) break;
      var oldest = _blobCache.keys().next();
      if (oldest.done) break;
      var key = oldest.value;
      if (_isPinned(key) || _isVisible(key)) {
        var pinnedEntry = _blobCache.get(key);
        _blobCache.delete(key);
        _blobCache.set(key, pinnedEntry);
        continue;
      }
      var entry = _blobCache.get(key);
      _releaseEntry(entry);
      _blobCache.delete(key);
    }
  }

  function _releaseEntry(entry) {
    if (entry && entry.blob && entry.url) {
      try { URL.revokeObjectURL(entry.url); } catch (e) {  }
    }
  }

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
        var eff = (target === 'max') ? Math.max(iw, ih) : Math.min(target, Math.max(iw, ih));
        var canvas = document.createElement('canvas');
        canvas.width = eff;
        canvas.height = eff;
        var ctx = canvas.getContext('2d', { willReadFrequently: false });

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

  function _extractColors(img) {
    try {
      var canvas = document.createElement('canvas');
      canvas.width = 16;
      canvas.height = 16;
      var ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, 16, 16);
      var data = ctx.getImageData(0, 0, 16, 16).data;

      var pixels = [];
      for (var i = 0; i < data.length; i += 4) {
        if (data[i + 3] < 128) continue;
        pixels.push([data[i], data[i + 1], data[i + 2]]);
      }
      if (pixels.length === 0) return null;

      var buckets = [pixels];
      while (buckets.length < 16) {
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
        var bucket = buckets[maxIdx];
        bucket.sort(function (a, b2) { return a[maxChannel] - b2[maxChannel]; });
        var mid = Math.floor(bucket.length / 2);
        buckets.splice(maxIdx, 1, bucket.slice(0, mid), bucket.slice(mid));
      }

      var colors = [];
      for (var c = 0; c < buckets.length; c++) {
        var avg = _avgColor(buckets[c]);
        colors.push(avg);
      }
      while (colors.length < 16) {
        colors.push(colors[colors.length % colors.length] || [128, 128, 128]);
      }
      return colors.slice(0, 16);
    } catch (e) {
      return null;
    }
  }

  function _channelVariance(pixels) {
    var rs = [0, 0, 0];
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


  function _loadCover(trackId, callback, size) {
    if (!trackId) { callback(null); return; }
    var key = _key(trackId, size);

    var entry = _blobCache.get(key);
    if (entry) {
      if ((entry.status === 'no-cover' || entry.status === 'error') &&
          (entry.timestamp || 0) + _NO_COVER_TTL_MS < _now()) {
        _blobCache.delete(key);
      } else {
        entry.timestamp = _now();
        _blobCache.delete(key);
        _blobCache.set(key, entry);
        callback(entry.status === 'ready' ? entry.url : null);
        return;
      }
    }

    if (_loadingQueue.has(key)) {
      if (!_pendingCallbacks[key]) _pendingCallbacks[key] = [];
      _pendingCallbacks[key].push(callback);
      return;
    }

    _loadingQueue.add(key);
    if (!_pendingCallbacks[key]) _pendingCallbacks[key] = [];
    _pendingCallbacks[key].push(callback);

    _evict();

    var img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    var url = window.coverUrl(trackId, size);
    var done = false;

    img.onload = function () {
      if (done) return;
      done = true;
      _loadingQueue.delete(key);

      if (!_colorCache.has(trackId)) {
        var colors = _extractColors(img);
        if (colors) {
          _colorCache.set(trackId, colors);
          if (!_reportedColors.has(trackId)) {
            _reportedColors.add(trackId);
            _reportColors(trackId, colors);
          }
        }
      }

      if (_isSquareAtTarget(img, size)) {
        _blobCache.set(key, { url: url, timestamp: _now(), status: 'ready' });
        _flushCallbacks(key, url);
        return;
      }

      _processImage(img, size).then(function (blob) {
        var blobUrl = URL.createObjectURL(blob);
        _blobCache.set(key, { url: blobUrl, timestamp: _now(), status: 'ready', blob: true });
        _flushCallbacks(key, blobUrl);
      }).catch(function () {
        _blobCache.set(key, { url: url, timestamp: _now(), status: 'ready' });
        _flushCallbacks(key, url);
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
        try { cb(url); } catch (e) {  }
      });
    }
  }

  function _reportColors(trackId, colors) {
    try {
      if (window.__electronAPI && window.__electronAPI.invoke) {
        window.__electronAPI.invoke('store_cover_colors', trackId, JSON.stringify(colors));
      }
    } catch (e) {  }
  }


  function getCached(trackId, size) {
    var entry = _blobCache.get(_key(trackId, size));
    if (entry && entry.status === 'ready' && entry.url) {
      entry.timestamp = _now();
      _blobCache.delete(_key(trackId, size));
      _blobCache.set(_key(trackId, size), entry);
      return entry.url;
    }
    return null;
  }

  function getCover(trackId, callback, size) {
    _loadCover(trackId, callback, size);
  }

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

  function attachImage(imgEl, trackId, opts) {
    opts = opts || {};
    if (!trackId) {
      if (opts.onError) opts.onError();
      return;
    }

    var size = opts.size;
    imgEl.dataset.coverCache = '1';

    var cached = getCached(trackId, size);
    if (cached) {
      imgEl.src = cached;
      return;
    }

    if (opts.onLoading) opts.onLoading();
    imgEl.dataset.loading = '1';

    _loadCover(trackId, function (url) {
      if (imgEl.dataset.loading !== '1') return;
      delete imgEl.dataset.loading;
      if (url) {
        imgEl.src = url;
      } else {
        if (opts.onError) opts.onError();
      }
    }, size);
  }

  function updateViewport(items, startIndex, endIndex, direction, size) {
    var nextVisible = new Set();
    var start = Math.max(0, startIndex || 0);
    var end = Math.min(items ? items.length : 0, endIndex || 0);
    for (var i = start; i < end; i++) {
      var item = items[i];
      var id = item && item.track && item.track.id;
      if (id) {
        nextVisible.add(String(id));
      }
    }
    _visible = nextVisible;

    var prefetchIds = [];
    var before = direction < 0 ? PREFETCH_MARGIN : 3;
    var after = direction > 0 ? PREFETCH_MARGIN : 3;
    var preStart = Math.max(0, start - before);
    var preEnd = Math.min(items ? items.length : 0, end + after);
    for (var j = preStart; j < preEnd; j++) {
      var preItem = items[j];
      var preId = preItem && preItem.track && preItem.track.id;
      if (preId && !nextVisible.has(String(preId))) prefetchIds.push(preId);
    }
    preload(prefetchIds, size);
  }

  function releaseElement(root) {
    if (!root || !root.querySelectorAll) return;
    root.querySelectorAll('img[data-cover-cache]').forEach(function (img) {
      img.onload = null;
      img.onerror = null;
      img.removeAttribute('src');
      delete img.dataset.loading;
    });
  }

  function clearViewport() {
    _visible.clear();
  }

  function getColors(trackId) {
    return _colorCache.get(trackId) || null;
  }

  function setColors(map) {
    if (!map) return;
    Object.keys(map).forEach(function (tid) {
      _colorCache.set(tid, map[tid]);
    });
  }

  function colorGradient(colors) {
    if (!colors || colors.length === 0) return '';
    var stops = colors.slice(0, 4).map(function (c, i) {
      var pct = Math.round((i / 4) * 100);
      return 'rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ') ' + pct + '%';
    });
    stops.push('rgb(' + colors[0][0] + ',' + colors[0][1] + ',' + colors[0][2] + ') 100%');
    return 'linear-gradient(135deg, ' + stops.join(', ') + ')';
  }

  function clear() {
    var pinnedEntries = [];
    _blobCache.forEach(function (entry, key) {
      if (_isPinned(key) || _isVisible(key)) {
        pinnedEntries.push({ key: key, entry: entry });
        return;
      }
      _releaseEntry(entry);
    });
    _blobCache.clear();
    pinnedEntries.forEach(function (item) {
      _blobCache.set(item.key, item.entry);
    });
    _loadingQueue.clear();
    _pendingCallbacks = {};
  }

  function clearAll() {
    _blobCache.forEach(function (entry) {
      _releaseEntry(entry);
    });
    _blobCache.clear();
    _loadingQueue.clear();
    _pendingCallbacks = {};
    _pinned.clear();
  }

  function cleanupStale() {
    var STALE_THRESHOLD_MS = 3 * 60 * 1000;
    var now = _now();
    var cleaned = 0;
    _blobCache.forEach(function (entry, key) {
      if (entry.status !== 'ready') return;
      if (_isPinned(key) || _isVisible(key)) return;
      if (entry.url && (now - entry.timestamp) > STALE_THRESHOLD_MS) {
        _releaseEntry(entry);
        _blobCache.delete(key);
        cleaned++;
      }
    });
    if (_colorCache.size > COLOR_CACHE_MAX) {
      var toRemove = _colorCache.size - COLOR_CACHE_MAX;
      var iter = _colorCache.keys();
      for (var i = 0; i < toRemove; i++) {
        var k = iter.next().value;
        if (k === undefined) break;
        _colorCache.delete(k);
        _reportedColors.delete(k);
      }
    }
    return cleaned;
  }

  function getStatus() {
    return {
      cached: _blobCache.size,
      loading: _loadingQueue.size,
      maxPool: _maxPoolSize,
      colorCache: _colorCache.size,
      pinned: _pinned.size,
      visible: _visible.size,
    };
  }

  function pin(trackId) {
    if (trackId) _pinned.add(trackId);
  }

  function unpin(trackId) {
    if (trackId) _pinned.delete(trackId);
  }


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
    updateViewport: updateViewport,
    releaseElement: releaseElement,
    clearViewport: clearViewport,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
