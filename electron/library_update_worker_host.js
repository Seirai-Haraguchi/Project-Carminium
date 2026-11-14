'use strict';

const { Worker } = require('worker_threads');
const path = require('path');

let nextRequestId = 1;

// Dedicated host for remote library updates. It is intentionally separate from
// LibraryWorkerHost so a remote sync can never queue behind a local scan.
class LibraryUpdateWorkerHost {
  constructor(settings, onStatus) {
    this._settings = settings;
    this._onStatus = onStatus || (() => {});
    this._worker = null;
    this._pending = new Map();
    this._closed = false;
  }

  _spawn() {
    const worker = new Worker(path.join(__dirname, 'library_update_worker.js'), {
      workerData: {
        dataDir: this._settings.dataDir,
        separators: this._settings.get('artist_separators', ';') || ';',
      },
    });
    this._worker = worker;
    worker.on('message', (msg) => {
      if (msg && msg.type === 'update_status') {
        try { this._onStatus(msg); } catch { }
        return;
      }
      const pending = this._pending.get(msg && msg.id);
      if (!pending) return;
      this._pending.delete(msg.id);
      if (msg.ok) {
        pending.resolve(msg.result);
      } else {
        const error = new Error(msg.error || 'library update worker error');
        if (msg.code !== undefined) error.code = msg.code;
        if (msg.name) error.name = msg.name;
        pending.reject(error);
      }
    });
    const fail = (error) => {
      for (const pending of this._pending.values()) pending.reject(error);
      this._pending.clear();
      if (this._worker === worker) this._worker = null;
    };
    worker.on('error', (error) => {
      console.error('[library-update-worker] 工作线程错误:', error.message || error);
      fail(error);
    });
    worker.on('exit', (code) => {
      if (this._pending.size) fail(new Error('library update worker exited: ' + code));
      if (this._worker === worker) this._worker = null;
    });
  }

  request(type, config, options = {}) {
    if (this._closed) return Promise.reject(new Error('library update worker closed'));
    if (!this._worker) this._spawn();
    const id = nextRequestId++;
    return new Promise((resolve, reject) => {
      this._pending.set(id, { resolve, reject });
      try {
        this._worker.postMessage({ id, type, config, options });
      } catch (error) {
        this._pending.delete(id);
        reject(error);
      }
    });
  }

  stop() {
    if (this._closed) return;
    this._closed = true;
    const error = new Error('library update worker stopped');
    for (const pending of this._pending.values()) pending.reject(error);
    this._pending.clear();
    if (this._worker) {
      try { this._worker.terminate(); } catch { }
      this._worker = null;
    }
  }
}

module.exports = { LibraryUpdateWorkerHost };
