'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const MAX_ENTRIES = 4000;
const SAVE_DEBOUNCE_MS = 2000;
const PROBE_TIMEOUT_MS = 6000;
const MAX_OUTPUT_BYTES = 512 * 1024;
const MAX_FILE_SIZE = 12 * 1024 * 1024;

// 无损编解码器（ffprobe 的 codec_name）。PCM / DSD 家族另行按前缀判定。
const LOSSLESS_CODECS = new Set([
  'flac', 'alac', 'ape', 'wavpack', 'tta', 'truehd', 'mlp',
  'shorten', 'als', 'tak', 'mp4als', 'dst', 'wmav2lossless', 'wmalossless',
]);

// 这些扩展名只有「无损 / 有损」之分，探测不可用时兜底用
const LOSSLESS_EXTS = new Set([
  'flac', 'wav', 'wave', 'aif', 'aiff', 'aifc', 'ape', 'wv', 'tta', 'dsf', 'dff', 'alac', 'tak',
]);
const LOSSY_EXTS = new Set([
  'mp3', 'mp2', 'aac', 'm4a', 'mp4', 'm4b', 'ogg', 'oga', 'opus', 'wma', 'weba', 'webm', 'mpc', 'ac3', 'eac3', 'ec3',
]);

let _ffprobePathCache;

function _ffprobePath() {
  if (_ffprobePathCache !== undefined) return _ffprobePathCache;
  try {
    const wasapi = require('./wasapi');
    _ffprobePathCache = (wasapi && typeof wasapi.findFFprobe === 'function')
      ? wasapi.findFFprobe()
      : false;
  } catch (e) {
    console.warn('[Quality] ffprobe lookup failed:', e.message);
    _ffprobePathCache = false;
  }
  return _ffprobePathCache;
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

function _isLosslessCodec(codec) {
  if (!codec) return false;
  const c = String(codec).toLowerCase();
  if (c.startsWith('pcm_') || c === 'pcm') return true;
  if (c.startsWith('dsd_')) return true;
  return LOSSLESS_CODECS.has(c);
}

function _extOf(filePath) {
  if (!filePath) return '';
  const clean = String(filePath).split(/[?#]/)[0];
  const idx = clean.lastIndexOf('.');
  if (idx < 0 || idx < clean.length - 8) return '';
  return clean.slice(idx + 1).toLowerCase();
}

/**
 * 把 ffprobe 探测结果归类为四档：standard / lossless / hires / atmos。
 * info: { codec, profile, longName, tagString, formatName, formatLongName,
 *         sampleRate, channels, channelLayout, bits, bitrate, tags[] }
 */
function classify(info) {
  if (!info) return null;
  const codec = String(info.codec || '').toLowerCase();

  const hints = [
    info.profile, info.longName, info.tagString, info.formatLongName,
  ].concat(info.tags || []).filter(Boolean).join(' ').toLowerCase();

  // Dolby Atmos：显式标记 / AC-4 / TrueHD 7.1（蓝光 Atmos 母盘的典型形态）
  const atmosByHint = /atmos|\bjoc\b/.test(hints);
  const atmosByCodec = codec === 'ac4'
    || (codec === 'truehd' && (info.channels || 0) >= 8);
  if (atmosByHint || atmosByCodec) return 'atmos';

  if (!_isLosslessCodec(codec)) return 'standard';

  const sr = Number(info.sampleRate) || 0;
  const bits = Number(info.bits) || 0;
  // 与 Apple Music 的分档一致：≤24bit/48kHz 算「无损」，超出算「高解析度无损」
  if (sr > 48000 || bits > 24) return 'hires';
  return 'lossless';
}

/** 探测不可用时按扩展名兜底（只能分出「标准 / 无损」） */
function classifyFromPath(filePath) {
  const ext = _extOf(filePath);
  if (!ext) return null;
  if (LOSSLESS_EXTS.has(ext)) return 'lossless';
  if (LOSSY_EXTS.has(ext)) {
    // m4a / mp4 既可能是 AAC 也可能是 ALAC，无法在无探测时区分 → 不猜
    if (ext === 'm4a' || ext === 'mp4' || ext === 'm4b') return null;
    return 'standard';
  }
  return null;
}

/** 流媒体（Subsonic / WebDAV）用服务器给的 suffix 兜底 */
function classifyFromSuffix(suffix) {
  const s = String(suffix || '').toLowerCase().replace(/^\./, '');
  if (!s) return null;
  if (LOSSLESS_EXTS.has(s)) return 'lossless';
  if (LOSSLESS_CODECS.has(s)) return 'lossless';
  if (LOSSY_EXTS.has(s)) return 'standard';
  return null;
}

class AudioQualityProbe {
  constructor() {
    this._cache = new Map();
    this._inflight = new Map();
    this._queue = [];
    this._running = false;
    this._dirty = false;
    this._saveTimer = null;

    this._onResult = null;

    this._dir = _resolveConfigDir();
    this._path = path.join(this._dir, 'track_quality.json');
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
    if (!entry.unsupported && !entry.q) {
      this._cache.delete(key);
      return null;
    }
    return entry;
  }

  /** 命中缓存立即返回；否则排队探测并返回 Promise（未命中不阻塞调用方） */
  request(key, filePath, ctx) {
    if (!key || !filePath) return Promise.resolve(null);

    const cached = this.get(key);
    if (cached) return Promise.resolve(cached.unsupported ? null : cached);

    const pending = this._inflight.get(key);
    if (pending) return pending;

    const promise = new Promise((resolve) => {
      this._queue.push({ key, filePath, ctx: ctx || {}, resolve });
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
      console.error('[Quality] Flush failed:', e.message);
      this._dirty = true;
    }
  }

  _pump() {
    if (this._running || this._queue.length === 0) return;
    const job = this._queue.shift();
    this._running = true;

    this._probe(job.filePath).then((entry) => {
      if (entry) this._store(job.key, entry);
      else this._store(job.key, { unsupported: true, at: Date.now() });
      if (entry && this._onResult) {
        try {
          this._onResult(job.key, entry, job.ctx);
        } catch (e) {
          console.warn('[Quality] result handler failed:', e.message);
        }
      }
      job.resolve(entry);
    }).catch((e) => {
      console.warn('[Quality] probe error:', e && e.message);
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

  _probe(filePath) {
    return new Promise((resolve) => {
      const bin = _ffprobePath();
      let stat = null;
      try {
        stat = fs.statSync(filePath);
      } catch {
        return resolve(null);
      }
      if (!stat.isFile() || stat.size === 0) return resolve(null);
      if (!bin) return resolve(null);

      const args = [
        '-v', 'error',
        '-select_streams', 'a:0',
        '-show_streams',
        '-show_format',
        '-of', 'json',
        filePath,
      ];

      let proc;
      try {
        proc = spawn(bin, args, { windowsHide: true });
      } catch (e) {
        console.warn('[Quality] spawn failed:', e.message);
        return resolve(null);
      }

      let out = '';
      let done = false;
      const finish = (value) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        try { proc.kill('SIGKILL'); } catch {  }
        resolve(value);
      };
      const timer = setTimeout(() => {
        console.warn('[Quality] probe timeout:', path.basename(filePath));
        finish(null);
      }, PROBE_TIMEOUT_MS);

      proc.stdout.on('data', (chunk) => {
        out += chunk.toString('utf8');
        if (out.length > MAX_OUTPUT_BYTES) out = out.slice(-MAX_OUTPUT_BYTES);
      });
      proc.stderr.on('data', () => {  });
      proc.on('error', (e) => {
        console.warn('[Quality] ffprobe error:', e.message);
        finish(null);
      });
      proc.on('close', () => {
        finish(this._parseProbe(out));
      });
    });
  }

  _parseProbe(text) {
    if (!text) return null;
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      return null;
    }
    const stream = Array.isArray(data.streams) ? data.streams[0] : null;
    if (!stream) return null;
    const format = data.format || {};

    const tags = [];
    for (const bag of [stream.tags, format.tags]) {
      if (!bag || typeof bag !== 'object') continue;
      for (const [k, v] of Object.entries(bag)) {
        if (v == null) continue;
        tags.push(k + '=' + (typeof v === 'object' ? JSON.stringify(v) : String(v)));
      }
    }

    const info = {
      codec: stream.codec_name || '',
      profile: stream.profile || '',
      longName: stream.codec_long_name || '',
      tagString: stream.codec_tag_string || '',
      formatName: format.format_name || '',
      formatLongName: format.format_long_name || '',
      sampleRate: parseInt(stream.sample_rate || format.sample_rate || '0', 10) || 0,
      channels: parseInt(stream.channels || '0', 10) || 0,
      bits: parseInt(stream.bits_per_raw_sample || stream.bits_per_sample || '0', 10) || 0,
      bitrate: parseInt(stream.bit_rate || format.bit_rate || '0', 10) || 0,
      tags,
    };

    const q = classify(info);
    if (!q) return null;
    return {
      q,
      codec: info.codec,
      sr: info.sampleRate,
      bits: info.bits,
      br: info.bitrate,
      at: Date.now(),
    };
  }

  _load() {
    try {
      const st = fs.statSync(this._path);
      if (st.size > MAX_FILE_SIZE) {
        console.warn('[Quality] Cache too large, skipping load');
        return;
      }
      const parsed = JSON.parse(fs.readFileSync(this._path, 'utf8'));
      if (!parsed || typeof parsed !== 'object') return;
      for (const [k, v] of Object.entries(parsed)) {
        if (!v || typeof v !== 'object') continue;
        if (v.unsupported) this._cache.set(k, v);
        else if (v.q) this._cache.set(k, v);
      }
      console.log('[Quality] Loaded', this._cache.size, 'entries');
    } catch (e) {
      if (e.code === 'ENOENT') return;
      console.warn('[Quality] Cache corrupted, rebuilding:', e.message);
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
        console.error('[Quality] Save failed:', e.message);
        this._dirty = true;
      });
  }
}

module.exports = {
  AudioQualityProbe,
  classify,
  classifyFromPath,
  classifyFromSuffix,
};
