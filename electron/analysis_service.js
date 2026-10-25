'use strict';
/*
 * 分析服务：把「分析一首歌」变成一个可排队、可去重、可取消的主进程任务。
 *
 * 分工：
 *   AnalysisService（主进程）
 *     └ worker_thread → analysis_worker.js（ffmpeg 取帧 + DSP）
 *          └ ProfileStore（SQLite，主进程持有）
 *
 * 约束：
 * - 同一 trackId 的并发请求合并成一次；
 * - 全局串行（一个 worker thread），分析永远不会和播放抢 CPU；
 * - 结果直接落库，渲染进程拿到的就是 profile。
 */
const path = require('path');
const { Worker } = require('worker_threads');

const WORKER_PATH = path.join(__dirname, 'analysis_worker.js');

class AnalysisService {
  constructor(opts) {
    this._store = opts.store;
    this._ffmpeg = opts.ffmpegPath;
    this._version = opts.version || 1;
    this._log = opts.log || function () {  };

    this._worker = null;
    this._seq = 0;
    this._pending = new Map();     // id → {resolve, reject}
    this._inflight = new Map();    // trackId → Promise
    this._queue = [];
    this._active = false;
    this._stats = { analyzed: 0, failures: 0, cacheHits: 0, totalCostMs: 0 };
  }

  get available() { return !!this._ffmpeg; }

  _ensureWorker() {
    if (this._worker) return this._worker;
    const w = new Worker(WORKER_PATH, { stdio: 'ignore' });
    w.on('message', (msg) => {
      if (!msg) return;
      if (msg.id === '__ready') return;
      const job = this._pending.get(msg.id);
      if (!job) return;
      this._pending.delete(msg.id);
      if (msg.error) job.reject(new Error(msg.error));
      else job.resolve(msg.profile);
    });
    w.on('error', (e) => {
      this._log('analysis worker error: ' + e.message);
      // 让所有在途任务失败，下次重建线程
      this._pending.forEach((job) => job.reject(e));
      this._pending.clear();
      this._worker = null;
    });
    w.on('exit', () => { this._worker = null; });
    // 空闲时不拖住进程退出；有任务时 ref（见 _pump/done）
    if (w.unref) w.unref();
    this._worker = w;
    return w;
  }

  /**
   * @param {string} trackId
   * @param {string} filePath 可播路径（本地文件或本地代理 URL）
   * @param {object} meta {title, artist, durationMs, hash}
   * @returns {Promise<object|null>}
   */
  async analyze(trackId, filePath, meta) {
    if (!trackId || !filePath) return null;
    if (!this._ffmpeg) return null;

    // 缓存
    const cached = this._store ? this._store.get(trackId, this._version, meta && meta.hash) : null;
    if (cached && cached.profile) {
      this._stats.cacheHits++;
      return cached.profile;
    }
    if (this._inflight.has(trackId)) return this._inflight.get(trackId);

    const p = this._enqueue(trackId, filePath, meta);
    this._inflight.set(trackId, p);
    try {
      return await p;
    } finally {
      this._inflight.delete(trackId);
    }
  }

  _enqueue(trackId, filePath, meta) {
    return new Promise((resolve) => {
      this._queue.push({ trackId, filePath, meta: meta || {}, resolve });
      this._pump();
    });
  }

  _pump() {
    if (this._active || !this._queue.length) return;
    const job = this._queue.shift();
    this._active = true;
    const t0 = Date.now();
    const id = 'j' + (++this._seq);
    const self = this;

    const done = (profile, err) => {
      if (err) {
        self._stats.failures++;
        self._log('analysis failed for ' + job.trackId + ': ' + err.message);
        job.resolve(null);
      } else {
        const cost = profile.costMs || (Date.now() - t0);
        self._stats.analyzed++;
        self._stats.totalCostMs += cost;
        profile.trackId = job.trackId;
        profile.title = profile.title || job.meta.title || '';
        if (self._store) {
          self._store.set(job.trackId, self._version, job.meta.hash || '', cost, profile);
        }
        job.resolve(profile);
      }
      self._active = false;
      if (!self._active && !self._queue.length && self._worker && self._worker.unref) {
        try { self._worker.unref(); } catch (_) {}
      }
      self._pump();
    };

    let worker;
    try {
      worker = this._ensureWorker();
    } catch (e) {
      return done(null, e);
    }
    if (worker && worker.ref) worker.ref();
    this._pending.set(id, { resolve: (p) => done(p), reject: (e) => done(null, e) });
    try {
      worker.postMessage({
        type: 'analyze',
        id: id,
        filePath: job.filePath,
        ffmpegPath: this._ffmpeg,
        meta: {
          trackId: job.trackId,
          filePath: job.filePath,
          title: job.meta.title || '',
          artist: job.meta.artist || '',
          durationMs: job.meta.durationMs || 0,
        },
      });
    } catch (e) {
      this._pending.delete(id);
      done(null, e);
    }
  }

  stats() {
    return Object.assign({}, this._stats, {
      queued: this._queue.length,
      busy: this._active,
      store: this._store ? this._store.stats() : null,
    });
  }

  dispose() {
    this._queue.length = 0;
    if (this._worker) {
      try { this._worker.terminate(); } catch {  }
      this._worker = null;
    }
  }
}

module.exports = { AnalysisService };
