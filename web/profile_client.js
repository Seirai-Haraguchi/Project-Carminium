'use strict';
/*
 * 渲染端档案客户端：把 track 变成 TrackProfile。
 *
 * 真正的分析在主进程的 worker_thread 里发生（见 electron/analysis_service.js）。
 * 渲染进程只做三件事：查内存缓存、合并并发请求、发一次 IPC。
 *
 * 为什么不在渲染进程跑 DSP：
 * - 窗口是 loadFile() 的 file:// 源，`new Worker()` 会被 CORS 拦掉；
 * - 摊到主线程会卡 UI（实测 200–280ms / 分钟音频）。
 */
(function () {
  var MAX_ANALYZE_MS = 20 * 60 * 1000;   // 超长（DJ mix）只分析前 20 分钟

  function hashOf(track) {
    if (!track) return '';
    var size = track.file_size || track.fileSize || 0;
    var dur = track.duration_ms || track.durationMs || 0;
    var suffix = track.suffix || (track.path ? String(track.path).split('.').pop() : '');
    var src = track.source || 'local';
    return [src, size, dur, suffix].join(':');
  }

  function ProfileClient() {
    this._mem = new Map();       // trackId → profile
    this._inflight = new Map();  // trackId → Promise
    this._listeners = [];
    this._generation = 0;
    this.stats = { analyzed: 0, cacheHits: 0, failures: 0 };
  }

  ProfileClient.prototype.onUpdate = function (cb) {
    this._listeners.push(cb);
    var self = this;
    return function () {
      var i = self._listeners.indexOf(cb);
      if (i >= 0) self._listeners.splice(i, 1);
    };
  };

  ProfileClient.prototype._emit = function (trackId, profile) {
    for (var i = 0; i < this._listeners.length; i++) {
      try { this._listeners[i](trackId, profile); } catch (e) {  }
    }
  };

  ProfileClient.prototype.getCached = function (trackId) {
    return this._mem.get(trackId) || null;
  };

  ProfileClient.prototype.ensure = function (track, opts) {
    opts = opts || {};
    if (!track) return Promise.resolve(null);
    var trackId = track.id || track.trackId || '';
    var invoke = (window.__electronAPI && window.__electronAPI.invoke) ? window.__electronAPI.invoke : null;
    if (!invoke) return Promise.resolve(null);

    if (trackId && this._mem.has(trackId) && !opts.force) {
      this.stats.cacheHits++;
      return Promise.resolve(this._mem.get(trackId));
    }
    if (trackId && this._inflight.has(trackId)) return this._inflight.get(trackId);

    // 流媒体的可播地址由主进程解析：set_next_info 里传下来的就是可播地址
    // （本地代理 http://127.0.0.1:PORT/... 也能被 ffmpeg 直接读取）。
    var filePath = track.filePath || track.path || '';
    if (!trackId || !filePath) return Promise.resolve(null);
    if (track.duration_ms && track.duration_ms > MAX_ANALYZE_MS * 3) {
      // 超长连播合集：不做节拍级规划，交给保守回退
      return Promise.resolve(null);
    }

    var self = this;
    var meta = {
      title: track.title || '',
      artist: track.artist || '',
      durationMs: track.duration_ms || track.durationMs || 0,
      hash: hashOf(track),
    };
    var p = invoke('analyze_track_profile', trackId, filePath, meta).then(function (profile) {
      if (profile) {
        self.stats.analyzed++;
        self._mem.set(trackId, profile);
        self._emit(trackId, profile);
      }
      return profile || null;
    }).catch(function (e) {
      self.stats.failures++;
      console.warn('[ProfileClient] analyze failed:', trackId, e && e.message);
      return null;
    });
    p.then(function () { self._inflight.delete(trackId); },
      function () { self._inflight.delete(trackId); });

    this._inflight.set(trackId, p);
    return p;
  };

  /** 切歌时调用：让上层用 token 丢弃过期结果（分析在主进程排队，无法逐个取消） */
  ProfileClient.prototype.cancelPending = function () {
    this._generation++;
  };

  ProfileClient.prototype.profileStats = function () {
    var invoke = (window.__electronAPI && window.__electronAPI.invoke) ? window.__electronAPI.invoke : null;
    var local = Object.assign({}, this.stats, { generation: this._generation });
    if (!invoke) return Promise.resolve(local);
    return invoke('analysis_stats').then(function (s) {
      return Object.assign(local, { main: s });
    }).catch(function () { return local; });
  };

  window.ProfileClient = ProfileClient;
  window.App = window.App || {};
  window.App.profileClient = new ProfileClient();
})();
