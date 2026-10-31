'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// 远端流媒体（Subsonic）音频缓存。目录固定在缓存根下的 stream_cache，
// 受 cache_dir 迁移管理；容量上限由设置 stream_cache_limit_mb 控制。
const SUBDIR = 'stream_cache';
const INDEX_FILE = 'index.json';
const INDEX_VERSION = 1;
const TMP_EXT = '.part';
const SAVE_DEBOUNCE_MS = 1200;
// 无索引残留文件（进程异常退出遗留）超过该时长才清理，避免误删正在写入的文件。
const ORPHAN_GRACE_MS = 3600 * 1000;
// 淘汰后目标水位：留出余量，避免每次写入都触发一轮清理。
const EVICT_TARGET_RATIO = 0.9;

const DEFAULT_LIMIT_MB = 2048;
const MIN_LIMIT_MB = 64;

const MIME_EXT = {
  'audio/mpeg': '.mp3',
  'audio/mp3': '.mp3',
  'audio/flac': '.flac',
  'audio/x-flac': '.flac',
  'audio/wav': '.wav',
  'audio/x-wav': '.wav',
  'audio/wave': '.wav',
  'audio/mp4': '.m4a',
  'audio/x-m4a': '.m4a',
  'audio/aac': '.aac',
  'audio/ogg': '.ogg',
  'audio/opus': '.opus',
  'audio/x-ms-wma': '.wma',
};

function _extForMime(mime) {
  const key = String(mime || '').split(';')[0].trim().toLowerCase();
  return MIME_EXT[key] || '.bin';
}

class StreamCache {
  constructor(settings, baseDir) {
    this._settings = settings || null;
    this._baseDir = path.resolve(baseDir || process.cwd());
    this._dir = path.join(this._baseDir, SUBDIR);
    this._entries = new Map();
    this._loaded = false;
    this._loadPromise = null;
    this._saveTimer = null;
    this._writing = new Map();
    this._enforcing = false;
    this._ensureDir();
  }

  get dir() {
    return this._dir;
  }

  get enabled() {
    if (!this._settings) return false;
    return !!this._settings.get('stream_cache_enabled', false);
  }

  get limitBytes() {
    let mb = DEFAULT_LIMIT_MB;
    if (this._settings) {
      const raw = parseInt(this._settings.get('stream_cache_limit_mb', DEFAULT_LIMIT_MB), 10);
      if (Number.isFinite(raw) && raw > 0) mb = raw;
    }
    mb = Math.max(MIN_LIMIT_MB, Math.min(mb, 1024 * 1024));
    return mb * 1024 * 1024;
  }

  _ensureDir() {
    try {
      fs.mkdirSync(this._dir, { recursive: true });
    } catch (e) {  }
  }

  setBaseDir(newBase) {
    if (!newBase) return;
    const abs = path.resolve(String(newBase));
    if (abs === this._baseDir) return;
    // 旧目录的文件已由 cache_dir 迁移流程搬走；这里只需切换到新根。
    for (const state of this._writing.values()) {
      this._abort(state);
    }
    if (this._saveTimer) {
      clearTimeout(this._saveTimer);
      this._saveTimer = null;
    }
    this._baseDir = abs;
    this._dir = path.join(abs, SUBDIR);
    this._entries.clear();
    this._loaded = false;
    this._loadPromise = null;
    this._ensureDir();
    this._load();
  }

  _key(serverId, id) {
    return String(serverId) + ':' + String(id);
  }

  _fileName(key, mime) {
    const hash = crypto.createHash('sha1').update(key, 'utf8').digest('hex').slice(0, 40);
    return hash + _extForMime(mime);
  }

  _load() {
    if (this._loadPromise) return this._loadPromise;
    this._loadPromise = (async () => {
      this._ensureDir();
      let raw = null;
      try {
        raw = await fs.promises.readFile(path.join(this._dir, INDEX_FILE), 'utf-8');
      } catch (e) {
        raw = null;
      }

      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          const list = Array.isArray(parsed) ? parsed : (parsed && parsed.entries) || [];
          for (const item of list) {
            if (!item || !item.file) continue;
            this._entries.set(this._key(item.serverId, item.id), {
              serverId: item.serverId,
              id: item.id,
              file: item.file,
              size: parseInt(item.size, 10) || 0,
              mime: item.mime || 'audio/mpeg',
              lastAccess: parseInt(item.lastAccess, 10) || 0,
            });
          }
        } catch (e) {
          this._entries.clear();
        }
      }

      // 与磁盘核对：缺失的文件剔除，大小以实际为准。
      for (const [key, entry] of Array.from(this._entries.entries())) {
        const filePath = path.join(this._dir, entry.file);
        try {
          const st = await fs.promises.stat(filePath);
          if (!st.isFile() || st.size <= 0) throw new Error('invalid');
          entry.size = st.size;
          if (!entry.lastAccess) entry.lastAccess = st.mtimeMs || 0;
        } catch (e) {
          this._entries.delete(key);
        }
      }

      await this._sweepOrphans();
      this._loaded = true;
    })();
    return this._loadPromise;
  }

  // 清理遗留的未完成分片与长期无索引的文件（例如上次进程异常退出）。
  async _sweepOrphans() {
    let names = [];
    try {
      names = await fs.promises.readdir(this._dir);
    } catch (e) {
      return;
    }
    const known = new Set();
    for (const entry of this._entries.values()) known.add(entry.file);
    // 正在写入的分片不能当残留清掉（索引惰性加载可能与首次写入并发）。
    const activeTmp = new Set();
    for (const state of this._writing.values()) activeTmp.add(state.tmpPath);
    const now = Date.now();
    for (const name of names) {
      if (name === INDEX_FILE || name.endsWith('.json')) continue;
      const filePath = path.join(this._dir, name);
      try {
        if (name.endsWith(TMP_EXT)) {
          if (activeTmp.has(filePath)) continue;
          await fs.promises.unlink(filePath);
          continue;
        }
        if (known.has(name)) continue;
        const st = await fs.promises.stat(filePath);
        if (!st.isFile()) continue;
        if (now - st.mtimeMs > ORPHAN_GRACE_MS) await fs.promises.unlink(filePath);
      } catch (e) {  }
    }
  }

  // 命中返回可直接发送的文件信息；未启用或未命中返回 null。
  async lookup(serverId, id) {
    if (!this.enabled) return null;
    if (!this._loaded) await this._load();
    const key = this._key(serverId, id);
    const entry = this._entries.get(key);
    if (!entry) return null;
    const filePath = path.join(this._dir, entry.file);
    try {
      const st = await fs.promises.stat(filePath);
      if (!st.isFile() || st.size <= 0) throw new Error('missing');
      entry.size = st.size;
    } catch (e) {
      this._entries.delete(key);
      this._scheduleSave();
      return null;
    }
    entry.lastAccess = Date.now();
    this._scheduleSave();
    return { filePath, mime: entry.mime || 'audio/mpeg', size: entry.size };
  }

  // 开始边下边写。返回 writer（write / finish / abort），不满足缓存条件时返回 null。
  startWrite(serverId, id, mime, expectedBytes) {
    if (!this.enabled) return null;
    const key = this._key(serverId, id);
    if (this._writing.has(key)) return null;
    // 单曲超过整块上限时没有缓存意义，直接放弃。
    const expectedRaw = parseInt(expectedBytes, 10);
    if (expectedRaw > 0 && expectedRaw > this.limitBytes) return null;
    if (!this._loaded) this._load();

    const existing = this._entries.get(key);
    if (existing) {
      try {
        const st = fs.statSync(path.join(this._dir, existing.file));
        if (st.isFile() && st.size > 0) return null;
      } catch (e) {
        this._entries.delete(key);
      }
    }

    this._ensureDir();
    const file = this._fileName(key, mime);
    const finalPath = path.join(this._dir, file);
    const tmpPath = finalPath + TMP_EXT;
    try { fs.unlinkSync(tmpPath); } catch (e) {  }

    let stream;
    try {
      stream = fs.createWriteStream(tmpPath);
    } catch (e) {
      return null;
    }

    const state = {
      key, serverId, id, file, mime,
      tmpPath, finalPath,
      expected: parseInt(expectedBytes, 10) > 0 ? parseInt(expectedBytes, 10) : 0,
      bytes: 0,
      stream,
      done: false,
    };
    this._writing.set(key, state);
    stream.on('error', () => this._abort(state));

    return {
      write: (chunk) => {
        if (state.done || state.finishing || !chunk) return;
        state.bytes += chunk.length;
        try { state.stream.write(chunk); } catch (e) { this._abort(state); }
      },
      finish: () => this._finish(state),
      abort: () => this._abort(state),
    };
  }

  _finish(state) {
    if (state.done || state.finishing) return;
    state.finishing = true;

    const expected = state.expected;
    if (state.bytes <= 0 || (expected > 0 && state.bytes !== expected)) {
      state.done = true;
      this._writing.delete(state.key);
      this._discard(state);
      return;
    }

    try {
      state.stream.end(() => {
        if (state.done) return;
        state.done = true;
        this._writing.delete(state.key);
        try {
          fs.renameSync(state.tmpPath, state.finalPath);
          this._entries.set(state.key, {
            serverId: state.serverId,
            id: state.id,
            file: state.file,
            size: state.bytes,
            mime: state.mime,
            lastAccess: Date.now(),
          });
          this._scheduleSave();
          this.enforceLimit();
        } catch (e) {
          this._discard(state);
        }
      });
    } catch (e) {
      state.done = true;
      this._writing.delete(state.key);
      this._discard(state);
    }
  }

  _abort(state) {
    if (state.done) return;
    state.done = true;
    this._writing.delete(state.key);
    this._discard(state);
  }

  _discard(state) {
    // createWriteStream 的 open 是异步的：先 destroy 再等 close 删除，
    // 否则 unlink 之后流才落盘，会留下孤儿分片。
    const cleanup = () => {
      try { fs.unlinkSync(state.tmpPath); } catch (e) {  }
    };
    try {
      if (state.stream && !state.stream.destroyed) {
        state.stream.once('close', cleanup);
        state.stream.destroy();
      } else {
        cleanup();
      }
    } catch (e) {
      cleanup();
    }
  }

  _scheduleSave() {
    if (this._saveTimer) return;
    this._saveTimer = setTimeout(() => {
      this._saveTimer = null;
      this._saveNow();
    }, SAVE_DEBOUNCE_MS);
    if (this._saveTimer.unref) this._saveTimer.unref();
  }

  _saveNow() {
    if (!this._loaded) return;
    const tmp = path.join(this._dir, INDEX_FILE + '.tmp');
    try {
      this._ensureDir();
      const entries = Array.from(this._entries.values());
      fs.writeFileSync(tmp, JSON.stringify({ version: INDEX_VERSION, entries }), 'utf-8');
      fs.renameSync(tmp, path.join(this._dir, INDEX_FILE));
    } catch (e) {
      try { fs.unlinkSync(tmp); } catch (e2) {  }
    }
  }

  // 超出上限时按最后访问时间从旧到新淘汰，降到 limit * 0.9。
  async enforceLimit() {
    if (!this._loaded) await this._load();
    if (this._enforcing) return;
    this._enforcing = true;
    try {
      const limit = this.limitBytes;
      let total = 0;
      for (const entry of this._entries.values()) total += entry.size || 0;
      if (total <= limit) return;

      const target = Math.floor(limit * EVICT_TARGET_RATIO);
      const list = Array.from(this._entries.entries())
        .filter(([key]) => !this._writing.has(key))
        .sort((a, b) => (a[1].lastAccess || 0) - (b[1].lastAccess || 0));

      for (const [key, entry] of list) {
        if (total <= target) break;
        try {
          await fs.promises.unlink(path.join(this._dir, entry.file));
        } catch (e) {  }
        total -= entry.size || 0;
        this._entries.delete(key);
      }
      this._saveNow();
    } finally {
      this._enforcing = false;
    }
  }

  async stats() {
    if (!this._loaded) await this._load();
    let used = 0;
    for (const entry of this._entries.values()) used += entry.size || 0;
    return {
      enabled: this.enabled,
      limit_bytes: this.limitBytes,
      used_bytes: used,
      count: this._entries.size,
      dir: this._dir,
    };
  }

  async clear() {
    if (!this._loaded) await this._load();
    for (const state of Array.from(this._writing.values())) this._abort(state);
    for (const entry of this._entries.values()) {
      try { await fs.promises.unlink(path.join(this._dir, entry.file)); } catch (e) {  }
    }
    this._entries.clear();
    this._saveNow();
    return this.stats();
  }

  close() {
    for (const state of Array.from(this._writing.values())) this._abort(state);
    if (this._saveTimer) {
      clearTimeout(this._saveTimer);
      this._saveTimer = null;
    }
    this._saveNow();
  }
}

module.exports = { StreamCache, SUBDIR };
