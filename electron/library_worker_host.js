'use strict';

// LibraryWorkerHost：主进程侧的工作线程宿主。
// 负责拉起/复用 library_worker.js，封装「扫描」与「库导出」两类请求，
// 并把扫描进度状态通过 onStatus 回调抛给上层（bridge → 渲染进程）。

const { Worker } = require('worker_threads');
const path = require('path');

let _nextId = 1;

class LibraryWorkerHost {
  constructor(settings, onStatus) {
    this._settings = settings;
    this._onStatus = onStatus || (() => {  });
    this._worker = null;
    this._pending = new Map();
    this._closed = false;
  }

  _spawn() {
    const w = new Worker(path.join(__dirname, 'library_worker.js'), {
      workerData: {
        dataDir: this._settings.dataDir,
        separators: this._settings.get('artist_separators', ';') || ';',
      },
    });
    this._worker = w;
    w.on('message', (msg) => {
      if (msg && msg.type === 'scan_status') {
        try { this._onStatus(msg); } catch {  }
        return;
      }
      const p = this._pending.get(msg && msg.id);
      if (!p) return;
      this._pending.delete(msg.id);
      if (msg.ok) p.resolve(msg.result);
      else p.reject(new Error(msg.error || 'worker error'));
    });
    w.on('error', (e) => {
      console.error('[library-worker] 工作线程错误:', (e && e.message) || e);
      this._failAll(e);
      if (this._worker === w) this._worker = null;
    });
    w.on('exit', (code) => {
      if (this._worker === w) this._worker = null;
      this._failAll(new Error('library worker exited: ' + code));
    });
    return w;
  }

  _failAll(err) {
    for (const p of this._pending.values()) {
      try { p.reject(err); } catch {  }
    }
    this._pending.clear();
  }

  _request(type, payload = {}) {
    if (this._closed) {
      return Promise.reject(new Error('library worker closed'));
    }
    if (!this._worker) this._spawn();
    const id = _nextId++;
    return new Promise((resolve, reject) => {
      this._pending.set(id, { resolve, reject });
      try {
        this._worker.postMessage({ id, type, ...payload });
      } catch (e) {
        this._pending.delete(id);
        reject(e);
      }
    });
  }

  scanFolder(folderPath) {
    return this._request('scan_folder', { folderPath, incremental: false });
  }

  syncIncremental(folderPath, sizeCheckPaths = null) {
    return this._request('scan_folder', {
      folderPath,
      incremental: true,
      sizeCheckPaths: sizeCheckPaths || null,
    });
  }

  dumpTracks() { return this._request('dump', { what: 'tracks' }); }
  dumpAlbums() { return this._request('dump', { what: 'albums' }); }
  dumpArtists() { return this._request('dump', { what: 'artists' }); }

  setSeparators(value) {
    if (this._closed) return;
    if (!this._worker) return;
    try { this._worker.postMessage({ id: 0, type: 'set_separators', value: value || ';' }); } catch {  }
  }

  stop() {
    if (this._closed) return;
    this._closed = true;
    this._failAll(new Error('library worker stopped'));
    if (this._worker) {
      try { this._worker.terminate(); } catch {  }
      this._worker = null;
    }
  }
}

module.exports = { LibraryWorkerHost };
