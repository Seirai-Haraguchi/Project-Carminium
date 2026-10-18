'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const MAX_ENTRIES = 4000;
const SAVE_DEBOUNCE_MS = 2000;
const ANALYZE_TIMEOUT_MS = 90000;
const MAX_STDERR_BYTES = 64 * 1024;
const MAX_FILE_SIZE = 20 * 1024 * 1024;

const LUFS_MIN = -70;
const LUFS_MAX = 0;
const PEAK_MIN = -100;
const PEAK_MAX = 20;

let _ffmpegPathCache;

function _ffmpegPath() {
  if (_ffmpegPathCache !== undefined) return _ffmpegPathCache;
  try {
    const wasapi = require('./wasapi');
    _ffmpegPathCache = (wasapi && typeof wasapi.findFFmpeg === 'function')
      ? wasapi.findFFmpeg()
      : false;
  } catch (e) {
    console.warn('[Loudness] ffmpeg lookup failed:', e.message);
    _ffmpegPathCache = false;
  }
  return _ffmpegPathCache;
}

function _resolveConfigDir() {
  try {
    const { app } = require('electron');
    if (app && app.getPath) return app.getPath('userData');
  } catch {  }
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA || os.homedir(), 'Carminium');
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'Carminium');
  }
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'Carminium');
}

class LoudnessAnalyzer {
  constructor() {
    this._cache = new Map();
    this._inflight = new Map();
    this._queue = [];
    this._running = false;
    this._dirty = false;
    this._saveTimer = null;

    this._onResult = null;

    this._dir = _resolveConfigDir();
    this._path = path.join(this._dir, 'track_loudness.json');
    try {
      fs.mkdirSync(this._dir, { recursive: true });
    } catch {  }
    this._load();
  }

  setResultHandler(cb) {
    this._onResult = typeof cb === 'function' ? cb : null;
  }

  static keyFor(trackId, filePath) {
    if (trackId) return String(trackId);
    if (!filePath) return '';
    return 'p:' + crypto.createHash('sha1').update(String(filePath)).digest('hex').slice(0, 16);
  }

  get(key) {
    if (!key) return null;
    const entry = this._cache.get(key);
    if (!entry) return null;
    if (!entry.unsupported && !this._isValid(entry)) {
      this._cache.delete(key);
      return null;
    }
    return entry;
  }

  has(key) {
    return !!(key && this._cache.has(key));
  }

  request(key, filePath) {
    if (!key || !filePath) return Promise.resolve(null);

    const cached = this.get(key);
    if (cached) return Promise.resolve(cached.unsupported ? null : cached);

    const pending = this._inflight.get(key);
    if (pending) return pending;

    if (/^https?:\/\//i.test(filePath)) {
      this._store(key, { unsupported: true, reason: 'stream' });
      return Promise.resolve(null);
    }

    const promise = new Promise((resolve) => {
      this._queue.push({ key, filePath, resolve });
      this._pump();
    });
    this._inflight.set(key, promise);
    promise.then(() => this._inflight.delete(key));
    return promise;
  }

  flush() {
    if (this._saveTimer) {
      clearTimeout(this._saveTimer);
      this._saveTimer = null;
    }
    if (!this._dirty) return;
    this._dirty = false;

    const obj = {};
    for (const [k, v] of this._cache) obj[k] = v;
    try {
      const data = JSON.stringify(obj);
      if (data.length > MAX_FILE_SIZE) return;
      const tmp = this._path + '.tmp';
      fs.writeFileSync(tmp, data, 'utf8');
      fs.renameSync(tmp, this._path);
    } catch (e) {
      console.error('[Loudness] Flush failed:', e.message);
      this._dirty = true;
    }
  }

  _pump() {
    if (this._running || this._queue.length === 0) return;
    const job = this._queue.shift();
    this._running = true;

    this._measure(job.filePath).then((raw) => {
      let entry = null;
      if (raw) {
        entry = { i: raw.i, peak: raw.peak, lra: raw.lra, at: Date.now() };
        this._store(job.key, entry);
        if (this._onResult) {
          try { this._onResult(job.key, entry, job.filePath); } catch (e) {
            console.warn('[Loudness] result handler failed:', e.message);
          }
        }
      } else {
        this._store(job.key, { unsupported: true, at: Date.now() });
      }
      job.resolve(entry);
    }).catch((e) => {
      console.warn('[Loudness] measure error:', e && e.message);
      this._store(job.key, { unsupported: true, at: Date.now() });
      job.resolve(null);
    }).then(() => {
      this._running = false;
      this._pump();
    });
  }

  _store(key, entry) {
    if (this._cache.size >= MAX_ENTRIES && !this._cache.has(key)) {
      const oldest = this._cache.keys().next().value;
      this._cache.delete(oldest);
    }
    this._cache.set(key, entry);
    this._dirty = true;
    this._scheduleSave();
  }

  _measure(filePath) {
    return new Promise((resolve) => {
      const ffmpeg = _ffmpegPath();
      if (!ffmpeg) {
        console.warn('[Loudness] FFmpeg not available, skipping measurement');
        return resolve(null);
      }
      let stat = null;
      try {
        stat = fs.statSync(filePath);
      } catch {
        return resolve(null);
      }
      if (!stat.isFile() || stat.size === 0) return resolve(null);

      const args = [
        '-nostdin', '-hide_banner', '-nostats',
        '-threads', '1',
        '-i', filePath,
        '-map', '0:a:0',
        '-af', 'ebur128=peak=true',
        '-f', 'null', '-',
      ];

      let proc;
      try {
        proc = spawn(ffmpeg, args, { windowsHide: true });
      } catch (e) {
        console.warn('[Loudness] spawn failed:', e.message);
        return resolve(null);
      }

      let tail = '';
      let done = false;
      const finish = (value) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        try { proc.kill('SIGKILL'); } catch {  }
        resolve(value);
      };
      const timer = setTimeout(() => {
        console.warn('[Loudness] measurement timeout:', path.basename(filePath));
        finish(null);
      }, ANALYZE_TIMEOUT_MS);

      proc.stdout.on('data', () => {  });
      proc.stderr.on('data', (chunk) => {
        tail += chunk.toString('utf8');

        if (tail.length > MAX_STDERR_BYTES) tail = tail.slice(-MAX_STDERR_BYTES);
      });
      proc.on('error', (e) => {
        console.warn('[Loudness] ffmpeg error:', e.message);
        finish(null);
      });
      proc.on('close', () => {
        finish(this._parseSummary(tail));
      });
    });
  }

  _parseSummary(text) {
    if (!text) return null;
    const num = '(-?\\d+(?:\\.\\d+)?)';

    const mi = new RegExp('(?:^|\\n)\\s*I:\\s*' + num + '\\s*LUFS').exec(text);
    if (!mi) return null;
    const i = parseFloat(mi[1]);
    if (!isFinite(i) || i < LUFS_MIN || i > LUFS_MAX) return null;

    let peak = null;
    const mtp = new RegExp('True peak:[\\s\\S]{0,200}?Peak:\\s*' + num + '\\s*dBFS', 'i').exec(text)
      || new RegExp('Sample peak:[\\s\\S]{0,200}?Peak:\\s*' + num + '\\s*dBFS', 'i').exec(text)
      || new RegExp('Peak:\\s*' + num + '\\s*dBFS', 'i').exec(text);
    if (mtp) {
      const p = parseFloat(mtp[1]);
      if (isFinite(p) && p >= PEAK_MIN && p <= PEAK_MAX) peak = p;
    }

    let lra = null;
    const mlr = new RegExp('(?:^|\\n)\\s*LRA:\\s*' + num + '\\s*LU').exec(text);
    if (mlr) {
      const v = parseFloat(mlr[1]);
      if (isFinite(v) && v >= 0 && v <= 60) lra = v;
    }

    return { i, peak, lra };
  }

  _isValid(entry) {
    return !!entry && typeof entry.i === 'number' && isFinite(entry.i)
      && entry.i >= LUFS_MIN && entry.i <= LUFS_MAX;
  }

  _load() {
    try {
      const st = fs.statSync(this._path);
      if (st.size > MAX_FILE_SIZE) {
        console.warn('[Loudness] Cache too large, skipping load');
        return;
      }
      const parsed = JSON.parse(fs.readFileSync(this._path, 'utf8'));
      if (!parsed || typeof parsed !== 'object') return;
      for (const [k, v] of Object.entries(parsed)) {
        if (v && v.unsupported) this._cache.set(k, v);
        else if (this._isValid(v)) this._cache.set(k, v);
      }
      console.log('[Loudness] Loaded', this._cache.size, 'entries');
    } catch (e) {
      if (e.code === 'ENOENT') return;
      console.warn('[Loudness] Cache corrupted, rebuilding:', e.message);
      try { fs.renameSync(this._path, this._path + '.bak'); } catch {  }
    }
  }

  _scheduleSave() {
    if (this._saveTimer) return;
    this._saveTimer = setTimeout(() => {
      this._saveTimer = null;
      this._save();
    }, SAVE_DEBOUNCE_MS);
  }

  _save() {
    if (!this._dirty) return;
    this._dirty = false;
    const obj = {};
    for (const [k, v] of this._cache) obj[k] = v;
    let data;
    try {
      data = JSON.stringify(obj);
    } catch (e) {
      this._dirty = true;
      return;
    }
    if (data.length > MAX_FILE_SIZE) return;
    const tmp = this._path + '.tmp';
    fs.promises.writeFile(tmp, data, 'utf8')
      .then(() => fs.promises.rename(tmp, this._path))
      .catch((e) => {
        console.error('[Loudness] Save failed:', e.message);
        this._dirty = true;
      });
  }
}

module.exports = { LoudnessAnalyzer };
