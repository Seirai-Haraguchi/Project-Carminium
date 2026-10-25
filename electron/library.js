'use strict';

const crypto = require('crypto');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { makeSortKey, makeFirstLetter } = require('./sortkey');
const { resolveCacheDir } = require('./cache_dir');

const SCAN_PARSE_PARALLEL = 4;
const SCAN_FLUSH_SIZE = 200;
const BACKFILL_PARSE_PARALLEL = 2;

const _mm = require('music-metadata');
let _parseFile = _mm.parseFile || null;

async function _ensureParseFile() {
  if (_parseFile) return _parseFile;
  if (typeof _mm.loadMusicMetadata === 'function') {
    const api = await _mm.loadMusicMetadata();
    _parseFile = api.parseFile;
  }
  return _parseFile;
}

const SUPPORTED_EXT = new Set(['.mp3', '.flac', '.ogg', '.wav', '.m4a', '.aac', '.opus', '.wma']);

const ALIAS_TITLE_KEYS = [
  'ASCII_TITLE', 'LOCALIZED_TITLE', 'TITLE_UNICODE', 'UNICODE_TITLE',
  'ROMAJI_TITLE', 'ALT_TITLE',
];

const FEAT_PATTERNS = ['feat.', 'ft.', 'vs.', 'with'];

const COVER_HEAD_READ_BYTES = 24 * 1024 * 1024;
const COVER_NEGATIVE_TTL_MS = 24 * 60 * 60 * 1000;

const _artistSepRegexCache = new Map();
function _getArtistSepRegex(seps) {
  let re = _artistSepRegexCache.get(seps);
  if (!re) {
    re = new RegExp('[' + seps.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\x00]');
    if (_artistSepRegexCache.size > 16) {
      _artistSepRegexCache.delete(_artistSepRegexCache.keys().next().value);
    }
    _artistSepRegexCache.set(seps, re);
  }
  return re;
}

const CREATE_SQL = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS folders (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    path      TEXT UNIQUE NOT NULL,
    added_at  REAL NOT NULL,
    last_scan REAL
);

CREATE TABLE IF NOT EXISTS tracks (
    id           TEXT PRIMARY KEY,
    path         TEXT UNIQUE NOT NULL,
    folder_id    INTEGER REFERENCES folders(id) ON DELETE CASCADE,
    title        TEXT,
    artist       TEXT,
    album        TEXT,
    album_artist TEXT,
    track_number INTEGER,
    disc_number  INTEGER,
    year         INTEGER,
    duration_ms  INTEGER,
    file_size    INTEGER,
    has_cover   INTEGER DEFAULT 0,
    lyrics      TEXT,
    alias_title TEXT,
    added_at    REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS liked_tracks (
    track_id   TEXT PRIMARY KEY REFERENCES tracks(id) ON DELETE CASCADE,
    liked_at   REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS play_history (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    track_id   TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
    played_at  REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS playlists (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    created_at REAL NOT NULL,
    updated_at REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS playlist_tracks (
    playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
    track_id    TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
    position    INTEGER NOT NULL,
    added_at    REAL NOT NULL,
    PRIMARY KEY (playlist_id, position)
);

CREATE TABLE IF NOT EXISTS subsonic_sources (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT NOT NULL,
    server_url    TEXT NOT NULL,
    username      TEXT NOT NULL,
    password      TEXT NOT NULL,
    protocol_mode TEXT NOT NULL DEFAULT 'subsonic',
    added_at      REAL NOT NULL,
    last_sync     REAL
);

CREATE TABLE IF NOT EXISTS webdav_sources (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT NOT NULL,
    server_url    TEXT NOT NULL,
    username      TEXT NOT NULL,
    password      TEXT NOT NULL,
    added_at      REAL NOT NULL,
    last_sync     REAL
);

CREATE TABLE IF NOT EXISTS smb_sources (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT NOT NULL,
    host          TEXT NOT NULL,
    share_name    TEXT NOT NULL,
    username      TEXT NOT NULL,
    password      TEXT NOT NULL,
    domain        TEXT NOT NULL DEFAULT '',
    added_at      REAL NOT NULL,
    last_sync     REAL
);

CREATE TABLE IF NOT EXISTS cover_colors (
    track_id TEXT PRIMARY KEY REFERENCES tracks(id) ON DELETE CASCADE,
    colors   TEXT NOT NULL
);

-- 拖入窗口播放的外部文件（不在 media library 内）。
-- 与 tracks 完全隔离：tracks 是「库」，这两张表只服务「播放历史」，
-- 因此不会出现在音乐页，也不会被 play_history 的统计查询（JOIN tracks）计入。
CREATE TABLE IF NOT EXISTS external_tracks (
    id           TEXT PRIMARY KEY,
    path         TEXT NOT NULL,
    title        TEXT,
    artist       TEXT,
    album        TEXT,
    album_artist TEXT,
    duration_ms  INTEGER,
    file_size    INTEGER,
    has_cover    INTEGER DEFAULT 0,
    lyrics       TEXT,
    added_at     REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS external_plays (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    track_id  TEXT NOT NULL,
    played_at REAL NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_external_plays_time ON external_plays(played_at DESC);
CREATE INDEX IF NOT EXISTS idx_external_plays_track ON external_plays(track_id);
`;

function trackId(filePath) {
  return crypto.createHash('sha1').update(filePath, 'utf-8').digest('hex').slice(0, 16);
}

function subsonicTrackId(serverId, subId) {
  return `s${parseInt(serverId, 10)}_${subId}`;
}

class MusicLibrary {
  constructor(settings) {
    this._settings = settings;
    const dbPath = path.join(settings.dataDir, 'library.db');
    this._db = require('better-sqlite3')(dbPath);
    this._db.pragma('journal_mode = WAL');
    this._db.pragma('foreign_keys = ON');
    this._db.pragma('cache_size = -2000');
    this._db.exec(CREATE_SQL);
    this._migrateSchema();
    this._closed = false;
    this._dedupCache = null;
    this._dedupLocalPathCache = null;

    this._coverDataCache = new Map();
    this._coverDataCacheMax = 48;
    this._coverDataCacheBytes = 0;
    this._coverDataCacheByteMax = 32 * 1024 * 1024;
    this._cacheBaseDir = resolveCacheDir(settings);
    this._coverCacheDir = path.join(this._cacheBaseDir, 'cover_cache');
    try {
      fs.mkdirSync(this._coverCacheDir, { recursive: true });
    } catch {  }
    this._coverInflight = new Map();
  }


  _migrateSchema() {
    const tryAlter = (sql) => {
      try { this._db.exec(sql); } catch {  }
    };
    tryAlter('ALTER TABLE tracks ADD COLUMN lyrics TEXT');
    tryAlter('ALTER TABLE tracks ADD COLUMN alias_title TEXT');
tryAlter('ALTER TABLE tracks ADD COLUMN genre TEXT');
    for (const [col, def] of [['created_at', '0'], ['updated_at', '0']]) {
      tryAlter(`ALTER TABLE playlists ADD COLUMN ${col} REAL NOT NULL DEFAULT ${def}`);
    }
    for (const col of ['source', 'server_id', 'subsonic_id', 'cover_id', 'suffix']) {
      tryAlter(`ALTER TABLE tracks ADD COLUMN ${col} TEXT`);
    }

    tryAlter("ALTER TABLE playlists ADD COLUMN source TEXT DEFAULT 'local'");
    tryAlter('ALTER TABLE playlists ADD COLUMN server_id INTEGER');
    tryAlter('ALTER TABLE playlists ADD COLUMN remote_id TEXT');
    tryAlter('ALTER TABLE playlists ADD COLUMN remote_changed TEXT');
    tryAlter('ALTER TABLE playlists ADD COLUMN cover_art_id TEXT');
    tryAlter('ALTER TABLE playlists ADD COLUMN owner TEXT');
    tryAlter('ALTER TABLE playlists ADD COLUMN owner_email TEXT');

    tryAlter('ALTER TABLE tracks ADD COLUMN webdav_path TEXT');


    const orphanFolderIds = this._db.prepare(
      `SELECT t.id FROM tracks t
       WHERE t.source IS NULL AND t.folder_id IS NOT NULL
       AND t.folder_id NOT IN (SELECT id FROM folders)`
    ).all();
    if (orphanFolderIds.length > 0) {
      this._deleteTracksByCondition(
        'source IS NULL AND folder_id IS NOT NULL AND folder_id NOT IN (SELECT id FROM folders)'
      );
    }

    const orphanSubsonicIds = this._db.prepare(
      `SELECT t.id FROM tracks t
       WHERE t.source='subsonic' AND t.server_id IS NOT NULL
       AND CAST(t.server_id AS INTEGER) NOT IN (SELECT id FROM subsonic_sources)`
    ).all();
    if (orphanSubsonicIds.length > 0) {
      this._deleteTracksByCondition(
        "source='subsonic' AND server_id IS NOT NULL AND CAST(server_id AS INTEGER) NOT IN (SELECT id FROM subsonic_sources)"
      );
    }

    const orphanWebdavIds = this._db.prepare(
      `SELECT t.id FROM tracks t
       WHERE t.source='webdav' AND t.server_id IS NOT NULL
       AND CAST(t.server_id AS INTEGER) NOT IN (SELECT id FROM webdav_sources)`
    ).all();
    if (orphanWebdavIds.length > 0) {
      this._deleteTracksByCondition(
        "source='webdav' AND server_id IS NOT NULL AND CAST(server_id AS INTEGER) NOT IN (SELECT id FROM webdav_sources)"
      );
    }

    const orphanSmbIds = this._db.prepare(
      `SELECT t.id FROM tracks t
       WHERE t.source='smb' AND t.server_id IS NOT NULL
       AND CAST(t.server_id AS INTEGER) NOT IN (SELECT id FROM smb_sources)`
    ).all();
    if (orphanSmbIds.length > 0) {
      this._deleteTracksByCondition(
        "source='smb' AND server_id IS NOT NULL AND CAST(server_id AS INTEGER) NOT IN (SELECT id FROM smb_sources)"
      );
    }
  }


  addFolder(folderPath) {
    const p = path.resolve(folderPath);
    const now = Date.now() / 1000;
    this._db.prepare(
      'INSERT OR IGNORE INTO folders (path, added_at) VALUES (?,?)'
    ).run(p, now);
    return this._folderInfo(p) || {};
  }

  removeFolder(folderPath) {
    const p = path.resolve(folderPath);
    const fid = this._folderId(p);
    if (fid !== null) {
      this._deleteTracksByCondition('folder_id=?', fid);
    }
    this._deleteTracksByCondition(
      "folder_id IS NULL AND source IS NULL AND (path LIKE ? OR path LIKE ?)",
      p.replace(/\\/g, '/') + '/%',
      p + '/%'
    );
    this._db.prepare('DELETE FROM folders WHERE path=?').run(p);
  }

  rescanFolder(folderPath) {
    const p = path.resolve(folderPath);
    return this._folderInfo(p) || {};
  }

  getFolders() {
    const rows = this._db.prepare(
      `SELECT f.path, f.added_at, f.last_scan,
       (SELECT COUNT(*) FROM tracks t WHERE t.folder_id=f.id) AS track_count
       FROM folders f ORDER BY f.added_at`
    ).all();
    return rows;
  }

  _folderId(folderPath) {
    const p = path.resolve(folderPath);
    const row = this._db.prepare('SELECT id FROM folders WHERE path=?').get(p);
    return row ? row.id : null;
  }

  _folderInfo(folderPath) {
    const p = path.resolve(folderPath);
    const row = this._db.prepare(
      `SELECT f.path, f.added_at, f.last_scan,
       (SELECT COUNT(*) FROM tracks t WHERE t.folder_id=f.id) AS track_count
       FROM folders f WHERE f.path=?`
    ).get(p);
    return row || null;
  }


  async scanFolder(folderPath, opts = {}) {
    const onProgress = opts.onProgress || null;
    const fid = this._folderId(folderPath);
    if (fid === null) return;
    if (!fs.statSync(folderPath).isDirectory()) return;
    const now = Date.now() / 1000;

    const filesToInsert = this._walkAudioPaths(folderPath);

    let inserted = 0;
    let alreadyCount = 0;

    const insertStmt = this._db.prepare(
      `INSERT OR IGNORE INTO tracks
       (id, path, folder_id, title, artist, album, album_artist,
        track_number, disc_number, year, duration_ms, file_size,
        has_cover, lyrics, genre, alias_title, added_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    );
    const linkFidStmt = this._db.prepare('UPDATE tracks SET folder_id=? WHERE path=?');

    const knownRows = this._db.prepare('SELECT path, folder_id FROM tracks').all();
    const knownPaths = new Set();
    const nullFidPaths = new Set();
    for (const r of knownRows) {
      knownPaths.add(r.path);
      if (r.folder_id === null || r.folder_id === undefined) nullFidPaths.add(r.path);
    }

    const pendingRows = [];
    const pendingLinks = [];
    const insertTx = this._db.transaction((rows, links) => {
      for (const p of links) linkFidStmt.run(p[0], p[1]);
      for (const r of rows) insertStmt.run(...r);
    });

    let parseIndex = 0;
    const worker = async () => {
      for (;;) {
        const i = parseIndex++;
        if (i >= filesToInsert.length) return;
        const filePath = filesToInsert[i];
        if (knownPaths.has(filePath)) {
          alreadyCount++;
          if (nullFidPaths.has(filePath)) pendingLinks.push([fid, filePath]);
          continue;
        }
        try {
          const meta = await this._parseMetadata(filePath);
          let size = 0;
          try { size = (await fsp.stat(filePath)).size; } catch {  }
          pendingRows.push([
            trackId(filePath), filePath, fid,
            meta.title || path.basename(filePath, path.extname(filePath)),
            meta.artist || null,
            meta.album || null,
            meta.album_artist || null,
            meta.track_number || null,
            meta.disc_number || null,
            meta.year || null,
            meta.duration_ms || null,
            size,
            meta.has_cover ? 1 : 0,
            meta.lyrics || null,
            meta.genre || null,
            meta.alias_title || null,
            now,
          ]);
          inserted++;
          if (pendingRows.length >= SCAN_FLUSH_SIZE) {
            insertTx(pendingRows.splice(0), pendingLinks.splice(0));
          }
        } catch (e) {
          console.error(`[MusicLibrary] Failed to insert track: ${filePath}`, e.message || e);
        }
        if ((i & 15) === 15) {
          if (onProgress) {
            try { onProgress({ phase: 'scanning', scanned: i + 1, total: filesToInsert.length, inserted }); } catch {  }
          }
          await new Promise((r) => setImmediate(r));
        }
      }
    };
    await Promise.all(Array.from({ length: SCAN_PARSE_PARALLEL }, worker));
    if (pendingRows.length > 0 || pendingLinks.length > 0) {
      insertTx(pendingRows.splice(0), pendingLinks.splice(0));
    }

    this._db.prepare('UPDATE folders SET last_scan=? WHERE id=?').run(now, fid);
    this._invalidateDedupCache();
    return { inserted, already: alreadyCount, total: filesToInsert.length };
  }


  _walkAudioPaths(rootDir) {
    const paths = [];
    const stack = [rootDir];
    while (stack.length > 0) {
      const dir = stack.pop();
      let entries;
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          stack.push(fullPath);
        } else if (entry.isFile()) {
          if (SUPPORTED_EXT.has(path.extname(entry.name).toLowerCase())) {
            paths.push(fullPath);
          }
        }
      }
    }
    return paths;
  }

  async syncFolderIncremental(folderPath, opts = {}) {
    const p = path.resolve(folderPath);
    const fid = this._folderId(p);
    if (fid === null) return null;
    if (!fs.existsSync(p)) {
      return { added: 0, removed: 0, updated: 0, total: 0, changed: false, skipped: true };
    }
    const now = Date.now() / 1000;

    const diskPaths = this._walkAudioPaths(p);
    const dbRows = this._db.prepare(
      'SELECT id, path, file_size FROM tracks WHERE folder_id=?'
    ).all(fid);

    if (diskPaths.length === 0 && dbRows.length > 0) {
      console.warn(`[MusicLibrary] 增量同步跳过：磁盘 0 个音频但 DB 有 ${dbRows.length} 条，疑似驱动器异常: ${p}`);
      return { added: 0, removed: 0, updated: 0, total: 0, changed: false, skipped: true };
    }

    const diskSet = new Set(diskPaths);
    const dbPathSet = new Set();
    const toRemoveIds = [];
    const commonRows = [];
    for (const row of dbRows) {
      dbPathSet.add(row.path);
      if (!diskSet.has(row.path)) {
        toRemoveIds.push(row.id);
      } else {
        commonRows.push(row);
      }
    }
    const toAdd = [];
    for (const dp of diskPaths) {
      if (!dbPathSet.has(dp)) toAdd.push(dp);
    }

    const toUpdate = [];
    if (opts.sizeCheckPaths && opts.sizeCheckPaths.length > 0) {
      const checkSet = new Set(opts.sizeCheckPaths.map((sp) => path.resolve(sp)));
      for (const row of commonRows) {
        if (!checkSet.has(row.path)) continue;
        let size;
        try { size = fs.statSync(row.path).size; } catch { continue; }
        if (size !== (row.file_size || 0)) toUpdate.push({ path: row.path, size });
      }
    }

    if (toRemoveIds.length === 0 && toAdd.length === 0 && toUpdate.length === 0) {
      this._db.prepare('UPDATE folders SET last_scan=? WHERE id=?').run(now, fid);
      return { added: 0, removed: 0, updated: 0, total: diskPaths.length, changed: false };
    }

    const CHUNK = 400;
    for (let i = 0; i < toRemoveIds.length; i += CHUNK) {
      const chunk = toRemoveIds.slice(i, i + CHUNK);
      this._deleteTracksByCondition(
        `id IN (${chunk.map(() => '?').join(',')})`,
        ...chunk
      );
    }

    let added = 0;
    {
      const onProgress = opts.onProgress || null;
      const insertStmt = this._db.prepare(
        `INSERT OR IGNORE INTO tracks
         (id, path, folder_id, title, artist, album, album_artist,
          track_number, disc_number, year, duration_ms, file_size,
          has_cover, lyrics, genre, alias_title, added_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
      );
      const insertTx = this._db.transaction((rows) => {
        for (const r of rows) insertStmt.run(...r);
      });
      const pendingRows = [];
      let parseIndex = 0;
      const worker = async () => {
        for (;;) {
          const i = parseIndex++;
          if (i >= toAdd.length) return;
          const filePath = toAdd[i];
          try {
            const meta = await this._parseMetadata(filePath);
            let size = 0;
            try { size = (await fsp.stat(filePath)).size; } catch {  }
            pendingRows.push([
              trackId(filePath), filePath, fid,
              meta.title || path.basename(filePath, path.extname(filePath)),
              meta.artist || null,
              meta.album || null,
              meta.album_artist || null,
              meta.track_number || null,
              meta.disc_number || null,
              meta.year || null,
              meta.duration_ms || null,
              size,
              meta.has_cover ? 1 : 0,
              meta.lyrics || null,
              meta.genre || null,
              meta.alias_title || null,
              now,
            ]);
            added++;
            if (pendingRows.length >= SCAN_FLUSH_SIZE) {
              insertTx(pendingRows.splice(0));
            }
          } catch (e) {
            console.error(`[MusicLibrary] 增量同步新增失败: ${filePath}`, e.message || e);
          }
          if ((i & 15) === 15) {
            if (onProgress) {
              try { onProgress({ phase: 'scanning', scanned: i + 1, total: toAdd.length, inserted: added }); } catch {  }
            }
            await new Promise((r) => setImmediate(r));
          }
        }
      };
      await Promise.all(Array.from({ length: SCAN_PARSE_PARALLEL }, worker));
      if (pendingRows.length > 0) insertTx(pendingRows.splice(0));
    }
    let updated = 0;
    {
      const updateTx = this._db.transaction((rows) => {
        const stmt = this._db.prepare(
          `UPDATE tracks SET title=?, artist=?, album=?, album_artist=?,
           track_number=?, disc_number=?, year=?, duration_ms=?, file_size=?,
           has_cover=?, lyrics=?, genre=?, alias_title=? WHERE path=?`
        );
        for (const r of rows) stmt.run(...r);
      });
      const pendingRows = [];
      for (const u of toUpdate) {
        try {
          const meta = await this._parseMetadata(u.path);
          pendingRows.push([
            meta.title || path.basename(u.path, path.extname(u.path)),
            meta.artist || null,
            meta.album || null,
            meta.album_artist || null,
            meta.track_number || null,
            meta.disc_number || null,
            meta.year || null,
            meta.duration_ms || null,
            u.size,
            meta.has_cover ? 1 : 0,
            meta.lyrics || null,
            meta.genre || null,
            meta.alias_title || null,
            u.path,
          ]);
          updated++;
        } catch (e) {
          console.error(`[MusicLibrary] 增量同步更新失败: ${u.path}`, e.message || e);
        }
      }
      if (pendingRows.length > 0) updateTx(pendingRows);
    }

    this._db.prepare('UPDATE folders SET last_scan=? WHERE id=?').run(now, fid);
    this._invalidateDedupCache();
    return {
      added, removed: toRemoveIds.length, updated,
      total: diskPaths.length, changed: true,
    };
  }


  async _parseMetadata(filePath) {
    const meta = {};
    try {
      const parseFile = await _ensureParseFile();
      if (!parseFile) throw new Error('music-metadata parseFile unavailable');
      const metadata = await parseFile(filePath);
      const common = metadata.common;

      meta.title = common.title || null;
      meta.artist = common.artist || null;
      meta.album = common.album || null;
      meta.album_artist = common.albumartist || null;
      meta.year = common.year || null;
      meta.track_number = common.track?.no || null;
      meta.disc_number = common.disk?.no || null;
      if (metadata.format.duration) {
        meta.duration_ms = Math.round(metadata.format.duration * 1000);
      }
      meta.has_cover = !!(common.picture && common.picture.length > 0);
      meta.genre = (common.genre && common.genre.length > 0) ? common.genre[0] : null;
      meta.lyrics = await this._extractLrcAsync(filePath, metadata);
      meta.alias_title = this._extractAliasTitle(metadata, meta.title);
    } catch (e) {
      console.error(`[MusicLibrary] Failed to parse metadata: ${filePath}`, e.message || e);
    }
    return meta;
  }

  _extractAliasTitle(metadata, title) {
    if (!metadata || !metadata.native) return null;
    const found = [];
    for (const tags of Object.values(metadata.native)) {
      if (!Array.isArray(tags)) continue;
      for (const tag of tags) {
        if (!tag || !tag.id) continue;
        let name = String(tag.id);
        let value = tag.value;
        if (name.toUpperCase() === 'TXXX') {
          if (!value || typeof value !== 'object') continue;
          name = String(value.description || '');
          value = Array.isArray(value.text) ? value.text[0] : value.text;
        } else if (name.toUpperCase().startsWith('TXXX:')) {
          name = name.slice(5);
        }
        if (Array.isArray(value)) value = value[0];
        const key = name.trim().toUpperCase();
        if (!key) continue;
        if (!ALIAS_TITLE_KEYS.some((k) => key === k || key.endsWith(':' + k))) continue;
        if (typeof value !== 'string') continue;
        const v = value.trim();
        if (!v || v === title) continue;
        if (!found.includes(v)) found.push(v);
      }
    }
    return found.length > 0 ? found[0] : null;
  }

  _extractEmbeddedLyrics(metadata) {
    if (!metadata || !metadata.native) return null;
    try {
      for (const [format, tags] of Object.entries(metadata.native)) {
        for (const tag of tags) {
          const id = tag.id.toLowerCase();
          if (id === 'uslt' || id === '©lyr' || id === 'lyrics' || id === 'unsyncedlyrics') {
            if (!tag.value) continue;
            if (typeof tag.value === 'object' && tag.value !== null) {
              if (typeof tag.value.text === 'string' && tag.value.text) {
                return tag.value.text;
              }
              if (typeof tag.value.descriptor === 'string' && tag.value.descriptor) {
                return tag.value.descriptor;
              }
            }
            return String(tag.value);
          }
        }
      }
    } catch {
    }
    return null;
  }

  async _findSidecarLrcAsync(filePath) {
    const lrcPath = filePath.replace(/\.[^.]+$/, '.lrc');
    try {
      const buf = await fsp.readFile(lrcPath, 'utf-8');
      return buf;
    } catch {
      return null;
    }
  }

  _extractLrcSync(filePath, metadata = null) {
    try {
      const lrcPath = filePath.replace(/\.[^.]+$/, '.lrc');
      if (fs.existsSync(lrcPath)) {
        return fs.readFileSync(lrcPath, 'utf-8');
      }
      return this._extractEmbeddedLyrics(metadata);
    } catch {
      return null;
    }
  }

  async _extractLrcAsync(filePath, metadata = null) {
    const sidecar = await this._findSidecarLrcAsync(filePath);
    if (sidecar !== null) return sidecar;
    return this._extractEmbeddedLyrics(metadata);
  }


  getCoverDataAsync(trackId) {
    const MISS = { data: null, confirmed: true };
    if (!trackId) return Promise.resolve(MISS);

    const memCached = this._coverDataCache.get(trackId);
    if (memCached !== undefined) {
      if (memCached !== null) {
        this._coverDataCache.delete(trackId);
        this._coverDataCache.set(trackId, memCached);
      }
      return Promise.resolve({ data: memCached, confirmed: true });
    }

    const inflight = this._coverInflight.get(trackId);
    if (inflight) return inflight;

    const p = this._loadCoverDataAsync(trackId).finally(() => {
      this._coverInflight.delete(trackId);
    });
    this._coverInflight.set(trackId, p);
    return p;
  }

  async _loadCoverDataAsync(trackId) {
    let row;
    try {
      row = this._db.prepare('SELECT path, source FROM tracks WHERE id=?').get(trackId);
    } catch {
      return { data: null, confirmed: false };
    }
    if (!row || !row.path) {
      try {
        const ext = this._db.prepare('SELECT path FROM external_tracks WHERE id=?').get(trackId);
        if (ext && ext.path) row = { path: ext.path, source: 'external' };
      } catch {  }
    }
    if (!row || !row.path) return { data: null, confirmed: true };
    if (row.source === 'subsonic' || row.source === 'webdav') return { data: null, confirmed: true };

    const diskPath = this._coverCachePath(trackId);
    let data = null;
    try {
      const buf = await fsp.readFile(diskPath);
      if (buf && buf.length === 0) {
        let stale = false;
        try {
          const st = await fsp.stat(diskPath);
          stale = (Date.now() - st.mtimeMs) > COVER_NEGATIVE_TTL_MS;
        } catch {  }
        if (!stale) {
          this._putCoverCache(trackId, null);
          return { data: null, confirmed: true };
        }
      } else {
        this._putCoverCache(trackId, buf);
        return { data: buf, confirmed: true };
      }
    } catch (e) {
      if (e && e.code !== 'ENOENT') {
      }
    }

    let confirmed = true;
    try {
      data = await this._extractCoverAsync(row.path);
    } catch {
      confirmed = false;
    }
    if (!confirmed) {
      return { data: null, confirmed: false };
    }

    try {
      await fsp.writeFile(diskPath, data || Buffer.alloc(0));
    } catch {  }

    this._putCoverCache(trackId, data);
    return { data, confirmed: true };
  }

  getCoverData(trackId) {
    if (!trackId) return null;
    const memCached = this._coverDataCache.get(trackId);
    if (memCached !== undefined) {
      if (memCached !== null) {
        this._coverDataCache.delete(trackId);
        this._coverDataCache.set(trackId, memCached);
      }
      return memCached;
    }
    let row = this._db.prepare('SELECT path, source FROM tracks WHERE id=?').get(trackId);
    if (!row || !row.path) {
      try {
        const ext = this._db.prepare('SELECT path FROM external_tracks WHERE id=?').get(trackId);
        if (ext && ext.path) row = { path: ext.path, source: 'external' };
      } catch {  }
    }
    if (!row || !row.path) return null;
    if (row.source === 'subsonic' || row.source === 'webdav') return null;

    const diskPath = this._coverCachePath(trackId);
    let data = null;
    let hasDiskRecord = false;
    try {
      const buf = fs.readFileSync(diskPath);
      hasDiskRecord = true;
      data = (buf && buf.length === 0) ? null : buf;
    } catch {  }

    if (!hasDiskRecord) {
      data = this._extractCoverSync(row.path);
      try { fs.writeFileSync(diskPath, data || Buffer.alloc(0)); } catch {  }
    }
    this._putCoverCache(trackId, data);
    return data;
  }

  _putCoverCache(trackId, data) {
    const prev = this._coverDataCache.get(trackId);
    if (prev !== undefined) {
      this._coverDataCacheBytes -= prev ? prev.length : 0;
      this._coverDataCache.delete(trackId);
    }
    this._coverDataCache.set(trackId, data);
    this._coverDataCacheBytes += data ? data.length : 0;
    while (this._coverDataCache.size > this._coverDataCacheMax ||
           this._coverDataCacheBytes > this._coverDataCacheByteMax) {
      const oldest = this._coverDataCache.keys().next();
      if (oldest.done) break;
      const old = this._coverDataCache.get(oldest.value);
      this._coverDataCacheBytes -= old ? old.length : 0;
      this._coverDataCache.delete(oldest.value);
    }
  }

  storeCoverData(trackId, data) {
    if (!trackId || !data) return;
    const diskPath = this._coverCachePath(trackId);
    try {
      fs.writeFileSync(diskPath, data);
    } catch {  }
    this._putCoverCache(trackId, data);
  }

  _coverCachePath(trackId) {
    const hash = crypto.createHash('sha1').update(trackId, 'utf-8').digest('hex');
    return path.join(this._coverCacheDir, `${hash}.jpg`);
  }

  clearCoverDataCache(trackId) {
    if (trackId) {
      const prev = this._coverDataCache.get(trackId);
      if (prev !== undefined) {
        this._coverDataCacheBytes -= prev ? prev.length : 0;
        this._coverDataCache.delete(trackId);
      }
      try { fs.unlinkSync(this._coverCachePath(trackId)); } catch {  }
    } else {
      this._coverDataCache.clear();
      this._coverDataCacheBytes = 0;
      try {
        const files = fs.readdirSync(this._coverCacheDir);
        for (const f of files) {
          try { fs.unlinkSync(path.join(this._coverCacheDir, f)); } catch {  }
        }
      } catch {  }
    }
  }

  _extractCoverSync(filePath) {
    try {
      const ext = path.extname(filePath).toLowerCase();
      const supported = ext === '.mp3' || ext === '.flac' ||
        ext === '.m4a' || ext === '.aac' || ext === '.mp4' ||
        ext === '.ogg' || ext === '.opus';
      if (!supported) return null;

      const extract = (buf) => {
        if (ext === '.mp3') return _extractMp3Cover(buf);
        if (ext === '.flac') return _extractFlacCover(buf);
        if (ext === '.m4a' || ext === '.aac' || ext === '.mp4') return _extractMp4Cover(buf);
        if (ext === '.ogg' || ext === '.opus') return _extractOggCover(buf);
        return null;
      };

      const stat = fs.statSync(filePath);
      const headSize = Math.min(stat.size, COVER_HEAD_READ_BYTES);
      const fd = fs.openSync(filePath, 'r');
      let head;
      try {
        head = Buffer.allocUnsafe(headSize);
        fs.readSync(fd, head, 0, headSize, 0);
      } finally {
        fs.closeSync(fd);
      }

      const found = extract(head);
      if (found) return found;

      if (stat.size > headSize) {
        return extract(fs.readFileSync(filePath));
      }
      return null;
    } catch {
    }
    return null;
  }

  async _extractCoverAsync(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const handWritten = (ext === '.mp3' || ext === '.flac' ||
      ext === '.m4a' || ext === '.aac' || ext === '.mp4' ||
      ext === '.ogg' || ext === '.opus');

    if (handWritten) {
      const extract = (buf) => {
        if (ext === '.mp3') return _extractMp3Cover(buf);
        if (ext === '.flac') return _extractFlacCover(buf);
        if (ext === '.m4a' || ext === '.aac' || ext === '.mp4') return _extractMp4Cover(buf);
        return _extractOggCover(buf);
      };

      let stat;
      try {
        stat = await fsp.stat(filePath);
      } catch {
        throw new Error('cover:stat-failed');
      }
      const headSize = Math.min(stat.size, COVER_HEAD_READ_BYTES);
      const head = Buffer.allocUnsafe(headSize);
      const fh = await fsp.open(filePath, 'r');
      try {
        await fh.read(head, 0, headSize, 0);
      } finally {
        await fh.close();
      }

      const found = extract(head);
      if (found) return found;

      if (stat.size > headSize) {
        const full = await fsp.readFile(filePath);
        return extract(full);
      }
      return null;
    }

    return this._extractCoverViaMetadata(filePath);
  }

  async _extractCoverViaMetadata(filePath) {
    const parseFile = await _ensureParseFile();
    if (!parseFile) return null;
    const metadata = await parseFile(filePath, { duration: false, skipCovers: false });
    const pics = metadata.common.picture;
    if (pics && pics.length > 0) {
      const pic = pics[0];
      return Buffer.from(pic.data);
    }
    return null;
  }


  _splitArtists(raw) {
    if (!raw || !raw.trim()) return [];
    let text = raw.trim();

    const seps = this._settings.get('artist_separators', ';') || ';';

    let lower = text.toLowerCase();
    for (const pat of FEAT_PATTERNS) {
      let idx = lower.indexOf(pat);
      while (idx >= 0) {
        const after = idx + pat.length;
        if (after < text.length && (text[after] === ' ' || text[after] === '\u3000')) {
          text = text.slice(0, idx).replace(/\s+$/, '') + '\x00' + text.slice(after).replace(/^\s+/, '');
          lower = text.toLowerCase();
          idx = lower.indexOf(pat, idx + 1);
        } else {
          idx = lower.indexOf(pat, idx + 1);
        }
      }
    }

    const parts = text.split(_getArtistSepRegex(seps));
    const result = [];
    const seen = new Set();
    for (const p of parts) {
      const name = p.trim();
      if (!name) continue;
      const key = name.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        result.push(name);
      }
    }
    return result;
  }



  _nfkc(s) {
    try {
      return s.normalize('NFKC');
    } catch {
      return s;
    }
  }

  _normalizeTitle(title) {
    if (!title) return '';
    let s = this._nfkc(title).toLowerCase().trim();
    s = s.replace(/\s*[([（【].*?[)\]）】]\s*/g, ' ');
    for (const pat of FEAT_PATTERNS) {
      const idx = s.indexOf(pat);
      if (idx > 0) s = s.slice(0, idx);
    }
    return s.replace(/\s+/g, ' ').trim();
  }

  _splitArtistsForMatch(artist) {
    if (!artist) return [];
    const seps = ['&', ' feat.', ' ft.', ' vs.', ' with', ',', '、', '/', ';'];
    let parts = [this._nfkc(artist).toLowerCase().trim()];
    for (const sep of seps) {
      const next = [];
      for (const p of parts) {
        if (p.includes(sep)) {
          for (const sub of p.split(sep)) next.push(sub);
        } else {
          next.push(p);
        }
      }
      parts = next;
    }
    const result = [];
    const seen = new Set();
    for (let p of parts) {
      p = p.trim();
      if (!p) continue;
      const ci = p.lastIndexOf(',');
      if (ci > 0) {
        const before = p.slice(0, ci).trim();
        const after = p.slice(ci + 1).trim();
        if (before && after && !before.includes(',') && !after.includes(',')) {
          p = (after + ' ' + before).trim();
        }
      }
      const na = p.replace(/^(the|a|an)\s+/, '');
      if (na) p = na;
      p = p.replace(/\s+/g, ' ').trim();
      if (!p) continue;
      if (!seen.has(p)) {
        seen.add(p);
        result.push(p);
      }
    }
    return result;
  }

  _trackKeys(track) {
    const titleKey = this._normalizeTitle(track.title);
    const keys = new Set();
    if (!titleKey) return keys;
    const artists = [];
    if (track.artist) artists.push(...this._splitArtistsForMatch(track.artist));
    if (track.album_artist && track.album_artist !== track.artist) {
      artists.push(...this._splitArtistsForMatch(track.album_artist));
    }
    if (artists.length === 0) {
      keys.add(titleKey + '\0');
    } else {
      for (const a of artists) {
        const k = titleKey + '\0' + a;
        if (k !== '\0') keys.add(k);
      }
    }
    return keys;
  }

  _getDedupInfo() {
    if (this._dedupCache !== null) return this._dedupCache;

    const localRows = this._db.prepare(
      "SELECT id, title, artist, album_artist, path, source FROM tracks WHERE source IS NULL"
    ).all();
    const remoteRows = this._db.prepare(
      "SELECT id, title, artist, album_artist, source FROM tracks WHERE source IN ('subsonic', 'webdav', 'smb')"
    ).all();

    if (localRows.length === 0 || remoteRows.length === 0) {
      this._dedupCache = { dupIds: new Set(), localMap: new Map() };
      return this._dedupCache;
    }

    const localKeyMap = new Map();
    for (const r of localRows) {
      for (const k of this._trackKeys(r)) {
        if (!localKeyMap.has(k)) localKeyMap.set(k, r);
      }
    }

    const dupIds = new Set();
    const localMap = new Map();
    for (const r of remoteRows) {
      for (const k of this._trackKeys(r)) {
        if (localKeyMap.has(k)) {
          dupIds.add(r.id);
          localMap.set(r.id, localKeyMap.get(k));
          break;
        }
      }
    }

    this._dedupCache = { dupIds, localMap };
    return this._dedupCache;
  }

  _getDuplicateSubsonicIds() {
    return this._getDedupInfo().dupIds;
  }

  findLocalTrackForSubsonic(track) {
    if (!track) return null;
    if (track.source !== 'subsonic' && track.source !== 'webdav' && track.source !== 'smb') return null;
    const { localMap } = this._getDedupInfo();
    return localMap.get(track.id) || null;
  }

  _invalidateDedupCache() {
    this._dedupCache = null;
    this._dedupLocalPathCache = null;
    if (this._coverDataCache) {
      this._coverDataCache.clear();
      this._coverDataCacheBytes = 0;
    }
  }

  _dedupeTracks(tracks) {
    const dupIds = this._getDuplicateSubsonicIds();
    if (dupIds.size === 0) return tracks;
    return tracks.filter((t) => !dupIds.has(t.id));
  }

  _dedupExcludeClause() {
    const dupIds = this._getDuplicateSubsonicIds();
    if (dupIds.size === 0) return { clause: '', params: [] };
    const placeholders = dupIds.size === 1 ? '(?)' : `(${Array.from(dupIds).map(() => '?').join(',')})`;
    return { clause: ` AND id NOT IN ${placeholders}`, params: Array.from(dupIds) };
  }

  getAllTracks(opts) {
    const withLyrics = !!(opts && opts.withLyrics);
    const sql = withLyrics
      ? 'SELECT * FROM tracks ORDER BY added_at'
      : `SELECT id, path, title, artist, album, album_artist, track_number,
                disc_number, year, duration_ms, file_size, has_cover,
                alias_title, added_at, source
         FROM tracks ORDER BY added_at`;
    const rows = this._db.prepare(sql).all();
    const tracks = this._dedupeTracks(rows);
    for (const t of tracks) {
      t.sort_key = makeSortKey(t.title);
      t.artist_sort_key = makeSortKey(t.artist);
      t.artists = this._splitArtists(t.artist);
    }
    tracks.sort((a, b) => a.sort_key.localeCompare(b.sort_key));
    for (const t of tracks) {
      t.sort_letter = makeFirstLetter(t.title);
      t.album_sort_key = makeSortKey(t.album);
      t.alias_sort_key = makeSortKey(t.alias_title);
    }
    return tracks;
  }

  getLyricsByIds(trackIds) {
    const out = new Map();
    if (!trackIds || trackIds.length === 0) return out;
    const CHUNK = 900;
    for (let i = 0; i < trackIds.length; i += CHUNK) {
      const slice = trackIds.slice(i, i + CHUNK);
      const rows = this._db.prepare(
        `SELECT id, lyrics FROM tracks
         WHERE lyrics IS NOT NULL AND lyrics <> ''
           AND id IN (${slice.map(() => '?').join(',')})`
      ).all(...slice);
      for (const r of rows) out.set(r.id, r.lyrics);
    }
    return out;
  }

  getAlbums() {
    const { clause, params } = this._dedupExcludeClause();
    const rows = this._db.prepare(
      `SELECT album, COALESCE(album_artist, artist, '未知艺术家') AS album_artist,
       year, COUNT(*) AS track_count
       FROM tracks WHERE album IS NOT NULL${clause}
       GROUP BY album, COALESCE(album_artist, artist)`
    ).all(...params);

    const coverRows = this._db.prepare(
      `SELECT t.album AS album, t.id AS cover_id FROM tracks t
       JOIN (SELECT album, MIN(rowid) AS rid FROM tracks
             WHERE album IS NOT NULL AND has_cover=1${clause}
             GROUP BY album) m
         ON m.album = t.album AND m.rid = t.rowid`
    ).all(...params);
    const coverMap = new Map();
    for (const c of coverRows) {
      if (!coverMap.has(c.album)) coverMap.set(c.album, c.cover_id);
    }

    const result = [];
    for (const r of rows) {
      r.cover_track_id = coverMap.get(r.album) || null;
      result.push(r);
    }
    for (const a of result) {
      a.sort_key = makeSortKey(a.album);
      a.album_artist_sort_key = makeSortKey(a.album_artist);
    }
    result.sort((a, b) => a.sort_key.localeCompare(b.sort_key));
    for (const a of result) {
      a.sort_letter = makeFirstLetter(a.album);
    }
    return result;
  }

  getArtists() {
    const { clause, params } = this._dedupExcludeClause();
    const rows = this._db.prepare(`SELECT id, artist, album, has_cover FROM tracks WHERE 1=1${clause}`).all(...params);
    const artistMap = {};
    for (const row of rows) {
      const names = this._splitArtists(row.artist);
      if (names.length === 0) names.push('未知艺术家');
      const album = row.album || '';
      for (const name of names) {
        if (!artistMap[name]) {
          artistMap[name] = {
            name,
            track_count: 0,
            _albums: new Set(),
            _cover_id: null,
          };
        }
        const info = artistMap[name];
        info.track_count++;
        info._albums.add(album);
        if (info._cover_id === null && row.has_cover) {
          info._cover_id = row.id;
        }
      }
    }
    const artists = [];
    for (const [name, info] of Object.entries(artistMap)) {
      artists.push({
        name,
        album_count: info._albums.size,
        track_count: info.track_count,
        cover_track_id: info._cover_id,
      });
    }
    for (const a of artists) {
      a.sort_key = makeSortKey(a.name);
    }
    artists.sort((a, b) => a.sort_key.localeCompare(b.sort_key));
    for (const a of artists) {
      a.sort_letter = makeFirstLetter(a.name);
    }
    return artists;
  }

  getAlbumTracks(album, albumArtist = null) {
    const { clause, params } = this._dedupExcludeClause();
    if (albumArtist) {
      return this._dedupeTracks(this._db.prepare(
        `SELECT * FROM tracks WHERE album=? AND COALESCE(album_artist,artist)=?${clause}
         ORDER BY disc_number, track_number`
      ).all(album, albumArtist, ...params));
    }
    return this._dedupeTracks(this._db.prepare(
      `SELECT * FROM tracks WHERE album=?${clause} ORDER BY disc_number, track_number`
    ).all(album, ...params));
  }

  getArtistTracks(artist) {
    const { clause, params } = this._dedupExcludeClause();
    const rows = this._db.prepare(
      `SELECT * FROM tracks WHERE 1=1${clause} ORDER BY LOWER(COALESCE(album,'')), disc_number, track_number`
    ).all(...params);
    const targetLower = artist.toLowerCase();
    const result = [];
    for (const row of rows) {
      const names = this._splitArtists(row.artist);
      if (names.length === 0) names.push('未知艺术家');
      if (names.some((n) => n.toLowerCase() === targetLower)) {
        row.artists = names;
        result.push(row);
      }
    }
    return result;
  }

  searchTracks(query) {
    const q = `%${query}%`;
    const { clause, params } = this._dedupExcludeClause();
    return this._db.prepare(
      `SELECT * FROM tracks WHERE (title LIKE ? OR artist LIKE ? OR album LIKE ? OR alias_title LIKE ?)${clause}
       ORDER BY LOWER(COALESCE(artist,'')), LOWER(COALESCE(album,'')), track_number`
    ).all(q, q, q, q, ...params);
  }

  getTrack(trackId) {
    return this._db.prepare('SELECT * FROM tracks WHERE id=?').get(trackId) || null;
  }

  async resolveDroppedFiles(paths) {
    const out = [];
    const seen = new Set();
    for (const raw of Array.isArray(paths) ? paths : []) {
      if (typeof raw !== 'string' || !raw) continue;
      let abs;
      try { abs = path.resolve(raw); } catch { continue; }
      if (seen.has(abs)) continue;
      seen.add(abs);
      let st;
      try { st = fs.statSync(abs); } catch { continue; }
      if (!st.isFile()) continue;
      if (!SUPPORTED_EXT.has(path.extname(abs).toLowerCase())) continue;
      try {
        const track = await this.resolveDroppedFile(abs, st);
        if (track) out.push(track);
      } catch (e) {
        console.warn('[MusicLibrary] resolveDroppedFile failed:', abs, e.message || e);
      }
    }
    return out;
  }

  async resolveDroppedFile(abs, stat) {
    let row = null;
    try {
      row = this._db.prepare('SELECT * FROM tracks WHERE path=?').get(abs)
        || this._db.prepare('SELECT * FROM tracks WHERE id=?').get(trackId(abs))
        || this._db.prepare('SELECT * FROM tracks WHERE path=? COLLATE NOCASE').get(abs)
        || null;
    } catch { row = null; }
    if (row) {
      this._decorateTrack(row);
      row.external = false;
      return row;
    }

    const meta = await this._parseMetadata(abs);
    const ext = path.extname(abs);
    return this._decorateTrack({
      id: trackId(abs),
      path: abs,
      title: meta.title || path.basename(abs, ext),
      artist: meta.artist || null,
      album: meta.album || null,
      album_artist: meta.album_artist || null,
      track_number: meta.track_number || null,
      disc_number: meta.disc_number || null,
      year: meta.year || null,
      duration_ms: meta.duration_ms || 0,
      file_size: (stat && stat.size) || 0,
      has_cover: meta.has_cover ? 1 : 0,
      lyrics: meta.lyrics || null,
      genre: meta.genre || null,
      alias_title: meta.alias_title || null,
      added_at: Date.now() / 1000,
      external: true,
    });
  }

  updateLyrics(trackId, lyrics) {
    this._db.prepare('UPDATE tracks SET lyrics=? WHERE id=?').run(lyrics, trackId);
  }

  async getEmbeddedLyrics(trackId) {
    const track = this.getTrack(trackId);
    if (!track || !track.path) return null;
    if (track.source === 'subsonic') return null;
    try {
      const parseFile = await _ensureParseFile();
      if (!parseFile) throw new Error('parseFile unavailable');
      const metadata = await parseFile(track.path);
      return this._extractLrcSync(track.path, metadata);
    } catch {
      return null;
    }
  }


  getLikedTrackIds() {
    const rows = this._db.prepare('SELECT track_id FROM liked_tracks').all();
    return new Set(rows.map((r) => r.track_id));
  }

  setLiked(trackId, liked) {
    if (liked && !this.getTrack(trackId)) return;
    if (liked) {
      this._db.prepare(
        'INSERT OR IGNORE INTO liked_tracks (track_id, liked_at) VALUES (?,?)'
      ).run(trackId, Date.now() / 1000);
    } else {
      this._db.prepare('DELETE FROM liked_tracks WHERE track_id=?').run(trackId);
    }
  }

  isLiked(trackId) {
    return this._db.prepare('SELECT 1 FROM liked_tracks WHERE track_id=?').get(trackId) !== undefined;
  }

  getLikedTracks() {
    const rows = this._db.prepare(
      `SELECT t.*, l.liked_at FROM tracks t
       INNER JOIN liked_tracks l ON t.id = l.track_id
       ORDER BY l.liked_at DESC`
    ).all();
    const deduped = this._dedupeTracks(rows);
    for (const t of deduped) {
      t.sort_key = makeSortKey(t.title);
      t.artist_sort_key = makeSortKey(t.artist);
      t.album_sort_key = makeSortKey(t.album);
      t.alias_sort_key = makeSortKey(t.alias_title);
      t.artists = this._splitArtists(t.artist);
    }
    return deduped;
  }


  addPlayHistory(trackId) {
    const now = Date.now() / 1000;
    this._db.prepare(
      'INSERT INTO play_history (track_id, played_at) VALUES (?,?)'
    ).run(trackId, now);
    this._db.prepare(
      `DELETE FROM play_history WHERE id NOT IN (
        SELECT id FROM play_history ORDER BY played_at DESC LIMIT 500
      )`
    ).run();
  }

  addExternalPlayHistory(track) {
    if (!track || !track.path) return;
    const now = Date.now() / 1000;
    const id = track.id || trackId(track.path);
    try {
      this._db.prepare(
        `INSERT INTO external_tracks
           (id, path, title, artist, album, album_artist, duration_ms, file_size, has_cover, lyrics, added_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET
           path=excluded.path, title=excluded.title, artist=excluded.artist,
           album=excluded.album, album_artist=excluded.album_artist,
           duration_ms=excluded.duration_ms, file_size=excluded.file_size,
           has_cover=excluded.has_cover,
           lyrics=COALESCE(excluded.lyrics, external_tracks.lyrics)`
      ).run(
        id, track.path, track.title || null, track.artist || null,
        track.album || null, track.album_artist || null,
        track.duration_ms || 0, track.file_size || 0,
        track.has_cover ? 1 : 0, track.lyrics || null, now
      );
      this._db.prepare(
        'INSERT INTO external_plays (track_id, played_at) VALUES (?,?)'
      ).run(id, now);
      this._db.prepare(
        `DELETE FROM external_plays WHERE id NOT IN (
          SELECT id FROM external_plays ORDER BY played_at DESC LIMIT 500
        )`
      ).run();
      this._db.prepare(
        'DELETE FROM external_tracks WHERE id NOT IN (SELECT track_id FROM external_plays)'
      ).run();
    } catch (e) {
      console.warn('[MusicLibrary] addExternalPlayHistory failed:', e.message || e);
    }
  }

  getPlayHistory(limit = 200) {
    const lim = parseInt(limit, 10) || 200;
    const rows = this._db.prepare(
      `SELECT t.*, h.played_at FROM tracks t
       INNER JOIN (
         SELECT track_id, MAX(played_at) AS played_at
         FROM play_history GROUP BY track_id
       ) h ON t.id = h.track_id
       ORDER BY h.played_at DESC LIMIT ?`
    ).all(lim);
    const deduped = this._dedupeTracks(rows);
    for (const t of deduped) {
      this._decorateTrack(t);
    }

    let extRows = [];
    try {
      extRows = this._db.prepare(
        `SELECT e.*, h.played_at FROM external_tracks e
         INNER JOIN (
           SELECT track_id, MAX(played_at) AS played_at
           FROM external_plays GROUP BY track_id
         ) h ON e.id = h.track_id
         ORDER BY h.played_at DESC LIMIT ?`
      ).all(lim);
    } catch {
      extRows = [];
    }
    if (extRows.length > 0) {
      const libPaths = new Set(deduped.map((t) => t.path).filter(Boolean));
      for (const e of extRows) {
        if (libPaths.has(e.path)) continue;
        this._decorateTrack(e);
        e.external = true;
        e.source = e.source || 'external';
        deduped.push(e);
      }
      deduped.sort((a, b) => (b.played_at || 0) - (a.played_at || 0));
    }
    return deduped.slice(0, lim);
  }

  _decorateTrack(t) {
    t.sort_key = makeSortKey(t.title);
    t.artist_sort_key = makeSortKey(t.artist);
    t.album_sort_key = makeSortKey(t.album);
    t.alias_sort_key = makeSortKey(t.alias_title);
    t.artists = this._splitArtists(t.artist);
    return t;
  }

  clearPlayHistory() {
    this._db.prepare('DELETE FROM play_history').run();
    try {
      this._db.prepare('DELETE FROM external_plays').run();
      this._db.prepare('DELETE FROM external_tracks').run();
    } catch {  }
  }


  async backfillMetadata() {
    const rows = this._db.prepare(
      "SELECT id, path, genre, alias_title FROM tracks WHERE (genre IS NULL OR alias_title IS NULL) AND source IS NULL"
    ).all();
    if (rows.length === 0) return 0;
    const parseFile = await _ensureParseFile();
    if (!parseFile) return 0;

    const updateTx = this._db.transaction((updates) => {
      const stmt = this._db.prepare(
        'UPDATE tracks SET genre=COALESCE(?, genre), alias_title=COALESCE(?, alias_title) WHERE id=?'
      );
      for (const u of updates) stmt.run(u.genre, u.alias, u.id);
    });

    let pending = [];
    let updated = 0;
    let cursor = 0;
    const worker = async () => {
      while (cursor < rows.length) {
        const i = cursor++;
        const row = rows[i];
        let genreVal = null;
        let aliasVal = null;
        try {
          const metadata = await parseFile(row.path);
          if (row.genre === null) {
            const g = metadata.common.genre;
            genreVal = (g && g.length > 0) ? g[0] : '';
          }
          if (row.alias_title === null) {
            const alias = this._extractAliasTitle(metadata, metadata.common.title || null);
            aliasVal = alias || '';
          }
        } catch {
        }
        if (genreVal !== null || aliasVal !== null) {
          pending.push({ id: row.id, genre: genreVal, alias: aliasVal });
          if (pending.length >= SCAN_FLUSH_SIZE) updateTx(pending.splice(0));
          updated++;
        }
        if ((i & 15) === 15) await new Promise((r) => setImmediate(r));
      }
    };
    await Promise.all(Array.from({ length: BACKFILL_PARSE_PARALLEL }, worker));
    if (pending.length > 0) updateTx(pending.splice(0));
    if (updated > 0) {
      console.log(`[MusicLibrary] Backfilled genre/alias for ${updated} tracks`);
    }
    return updated;
  }


  getPlayStats() {
    const db = this._db;

    const totalPlays = db.prepare('SELECT COUNT(*) AS c FROM play_history').get().c;

    const uniqueTracks = db.prepare('SELECT COUNT(DISTINCT track_id) AS c FROM play_history').get().c;

    const totalDurationRow = db.prepare(
      `SELECT COALESCE(SUM(t.duration_ms), 0) AS d
       FROM play_history h JOIN tracks t ON t.id = h.track_id`
    ).get();
    const totalDurationMs = totalDurationRow ? totalDurationRow.d : 0;

    const sevenDaysAgo = (Date.now() / 1000) - (7 * 24 * 3600);
    const dailyRows = db.prepare(
      `SELECT date(h.played_at, 'unixepoch', 'localtime') AS day, COUNT(*) AS c
       FROM play_history h
       WHERE h.played_at >= ?
       GROUP BY day ORDER BY day ASC`
    ).all(sevenDaysAgo);
    const dailyActivity = dailyRows.map(r => ({ day: r.day, count: r.c }));

    const topArtists = db.prepare(
      `SELECT t.artist AS name, COUNT(*) AS play_count, COUNT(DISTINCT t.id) AS track_count
       FROM play_history h JOIN tracks t ON t.id = h.track_id
       WHERE t.artist IS NOT NULL AND t.artist != ''
       GROUP BY t.artist ORDER BY play_count DESC LIMIT 5`
    ).all();

    const topAlbums = db.prepare(
      `SELECT t.album AS name, t.album_artist AS artist, COUNT(*) AS play_count, COUNT(DISTINCT t.id) AS track_count
       FROM play_history h JOIN tracks t ON t.id = h.track_id
       WHERE t.album IS NOT NULL AND t.album != ''
       GROUP BY t.album ORDER BY play_count DESC LIMIT 5`
    ).all();

    const lastPlayedRow = db.prepare(
      'SELECT MAX(played_at) AS t FROM play_history'
    ).get();
    const lastPlayedAt = lastPlayedRow ? lastPlayedRow.t : 0;

    return {
      totalPlays,
      uniqueTracks,
      totalDurationMs,
      dailyActivity,
      topArtists,
      topAlbums,
      lastPlayedAt,
    };
  }


  getDailyMixes() {
    const db = this._db;
    const mixes = [];
    const { clause, params } = this._dedupExcludeClause();

    const topArtists = db.prepare(
      `SELECT t.artist AS name, COUNT(*) AS play_count
       FROM play_history h JOIN tracks t ON t.id = h.track_id
       WHERE t.artist IS NOT NULL AND t.artist != ''
       GROUP BY t.artist ORDER BY play_count DESC LIMIT 3`
    ).all();

    for (const a of topArtists) {
      const tracks = db.prepare(
        `SELECT * FROM tracks WHERE artist = ?${clause} ORDER BY album, disc_number, track_number LIMIT 50`
      ).all(a.name, ...params);
      if (tracks.length > 0) {
        for (const t of tracks) t.artists = this._splitArtists(t.artist);
        mixes.push({ type: 'artist', name: a.name, playCount: a.play_count, tracks });
      }
    }

    const topGenres = db.prepare(
      `SELECT t.genre AS name, COUNT(*) AS play_count
       FROM play_history h JOIN tracks t ON t.id = h.track_id
       WHERE t.genre IS NOT NULL AND t.genre != ''
       GROUP BY t.genre ORDER BY play_count DESC LIMIT 2`
    ).all();

    for (const g of topGenres) {
      const tracks = db.prepare(
        `SELECT * FROM tracks WHERE genre = ?${clause} ORDER BY artist, album, disc_number, track_number LIMIT 50`
      ).all(g.name, ...params);
      if (tracks.length > 0) {
        for (const t of tracks) t.artists = this._splitArtists(t.artist);
        mixes.push({ type: 'genre', name: g.name, playCount: g.play_count, tracks });
      }
    }

    const topAlbums = db.prepare(
      `SELECT t.album AS name, t.album_artist AS artist, COUNT(*) AS play_count
       FROM play_history h JOIN tracks t ON t.id = h.track_id
       WHERE t.album IS NOT NULL AND t.album != ''
       GROUP BY t.album ORDER BY play_count DESC LIMIT 2`
    ).all();

    for (const al of topAlbums) {
      const tracks = db.prepare(
        `SELECT * FROM tracks WHERE album = ?${clause} ORDER BY disc_number, track_number LIMIT 50`
      ).all(al.name, ...params);
      if (tracks.length > 0) {
        for (const t of tracks) t.artists = this._splitArtists(t.artist);
        mixes.push({ type: 'album', name: al.name, subtitle: al.artist, playCount: al.play_count, tracks });
      }
    }

    const byType = { artist: [], genre: [], album: [] };
    for (const m of mixes) byType[m.type].push(m);
    const result = [];
    const maxLen = Math.max(byType.artist.length, byType.genre.length, byType.album.length);
    for (let i = 0; i < maxLen; i++) {
      if (byType.artist[i]) result.push(byType.artist[i]);
      if (byType.genre[i]) result.push(byType.genre[i]);
      if (byType.album[i]) result.push(byType.album[i]);
    }

    return result;
  }


  getExploreTracks() {
    const db = this._db;
    const { clause, params } = this._dedupExcludeClause();

    const playedIds = new Set(
      db.prepare('SELECT DISTINCT track_id FROM play_history').all().map(r => r.track_id)
    );

    const topGenres = db.prepare(
      `SELECT t.genre AS name, COUNT(*) AS play_count
       FROM play_history h JOIN tracks t ON t.id = h.track_id
       WHERE t.genre IS NOT NULL AND t.genre != ''
       GROUP BY t.genre ORDER BY play_count DESC LIMIT 5`
    ).all().map(r => r.name);

    const topArtists = db.prepare(
      `SELECT t.artist AS name, COUNT(*) AS play_count
       FROM play_history h JOIN tracks t ON t.id = h.track_id
       WHERE t.artist IS NOT NULL AND t.artist != ''
       GROUP BY t.artist ORDER BY play_count DESC LIMIT 5`
    ).all().map(r => r.name);

    const allTracks = db.prepare(
      `SELECT * FROM tracks WHERE 1=1${clause} ORDER BY added_at DESC LIMIT 500`
    ).all(...params);

    const result = [];
    const seen = new Set();

    for (const t of allTracks) {
      if (playedIds.has(t.id) || seen.has(t.id)) continue;
      if (t.genre && topGenres.includes(t.genre) && t.artist && topArtists.includes(t.artist)) {
        result.push(t);
        seen.add(t.id);
        if (result.length >= 25) break;
      }
    }

    if (result.length < 25) {
      for (const t of allTracks) {
        if (playedIds.has(t.id) || seen.has(t.id)) continue;
        if (t.genre && topGenres.includes(t.genre)) {
          result.push(t);
          seen.add(t.id);
          if (result.length >= 25) break;
        }
      }
    }

    if (result.length < 25) {
      for (const t of allTracks) {
        if (playedIds.has(t.id) || seen.has(t.id)) continue;
        if (t.artist && topArtists.includes(t.artist)) {
          result.push(t);
          seen.add(t.id);
          if (result.length >= 25) break;
        }
      }
    }

    if (result.length < 25) {
      for (const t of allTracks) {
        if (playedIds.has(t.id) || seen.has(t.id)) continue;
        result.push(t);
        seen.add(t.id);
        if (result.length >= 25) break;
      }
    }

    if (result.length < 10) {
      for (const t of allTracks) {
        if (seen.has(t.id)) continue;
        result.push(t);
        seen.add(t.id);
        if (result.length >= 25) break;
      }
    }

    for (const t of result) {
      t.artists = this._splitArtists(t.artist);
    }

    return {
      title: '探索',
      subtitle: '发现你尚未听过的曲目',
      tracks: result.slice(0, 25),
    };
  }


  getSimilarRecommendations() {
    const db = this._db;
    const { clause, params } = this._dedupExcludeClause();

    const listenedGenres = db.prepare(
      `SELECT t.genre AS name, COUNT(*) AS play_count
       FROM play_history h JOIN tracks t ON t.id = h.track_id
       WHERE t.genre IS NOT NULL AND t.genre != ''
       GROUP BY t.genre ORDER BY play_count DESC`
    ).all();

    if (listenedGenres.length === 0) return [];

    const playedIds = new Set(
      db.prepare('SELECT DISTINCT track_id FROM play_history').all().map(r => r.track_id)
    );

    const result = [];

    const topGenres = listenedGenres.slice(0, 4);

    for (const g of topGenres) {
      const tracks = db.prepare(
        `SELECT * FROM tracks WHERE genre = ?${clause}
         ORDER BY added_at DESC LIMIT 50`
      ).all(g.name, ...params);

      const newTracks = tracks.filter(t => !playedIds.has(t.id));

      if (newTracks.length >= 3) {
        const selected = newTracks.slice(0, 25);
        for (const t of selected) {
          t.artists = this._splitArtists(t.artist);
        }
        result.push({
          type: 'genre',
          name: g.name,
          subtitle: '相似类型新推荐',
          playCount: g.play_count,
          tracks: selected,
        });
      } else if (tracks.length >= 3) {
        const mixed = [...newTracks, ...tracks.filter(t => playedIds.has(t.id))].slice(0, 25);
        for (const t of mixed) {
          t.artists = this._splitArtists(t.artist);
        }
        result.push({
          type: 'genre',
          name: g.name,
          subtitle: '相似类型新推荐',
          playCount: g.play_count,
          tracks: mixed,
        });
      }
    }

    return result;
  }


  getPlaylists() {
    return this._db.prepare(
      `SELECT p.id, p.name, p.created_at, p.updated_at,
       p.source, p.server_id, p.remote_id, p.remote_changed, p.cover_art_id,
       p.owner, p.owner_email,
       (SELECT COUNT(*) FROM playlist_tracks pt WHERE pt.playlist_id=p.id) AS track_count,
       (SELECT s.name FROM subsonic_sources s WHERE s.id=p.server_id) AS server_name
       FROM playlists p ORDER BY p.updated_at DESC`
    ).all();
  }

  createPlaylist(name) {
    const now = Date.now() / 1000;
    const result = this._db.prepare(
      'INSERT INTO playlists (name, created_at, updated_at) VALUES (?,?,?)'
    ).run(name, now, now);
    return {
      id: result.lastInsertRowid,
      name,
      created_at: now,
      updated_at: now,
      track_count: 0,
    };
  }

  renamePlaylist(playlistId, name) {
    this._db.prepare(
      'UPDATE playlists SET name=?, updated_at=? WHERE id=?'
    ).run(name, Date.now() / 1000, playlistId);
  }

  deletePlaylist(playlistId) {
    this._db.prepare('DELETE FROM playlists WHERE id=?').run(playlistId);
  }

  addToPlaylist(playlistId, trackId) {
    const row = this._db.prepare(
      'SELECT MAX(position) AS m FROM playlist_tracks WHERE playlist_id=?'
    ).get(playlistId);
    const nextPos = (row && row.m !== null) ? row.m + 1 : 0;
    this._db.prepare(
      'INSERT OR IGNORE INTO playlist_tracks (playlist_id, track_id, position, added_at) VALUES (?,?,?,?)'
    ).run(playlistId, trackId, nextPos, Date.now() / 1000);
    this._db.prepare(
      'UPDATE playlists SET updated_at=? WHERE id=?'
    ).run(Date.now() / 1000, playlistId);
  }

  addTracksToPlaylist(playlistId, trackIds) {
    if (!trackIds || trackIds.length === 0) return 0;
    const ownStmt = this._db.prepare('SELECT 1 FROM tracks WHERE id=?');
    trackIds = trackIds.filter((tid) => {
      try { return !!ownStmt.get(tid); } catch { return false; }
    });
    if (trackIds.length === 0) return 0;
    const row = this._db.prepare(
      'SELECT MAX(position) AS m FROM playlist_tracks WHERE playlist_id=?'
    ).get(playlistId);
    let nextPos = (row && row.m !== null) ? row.m + 1 : 0;
    const now = Date.now() / 1000;
    let added = 0;
    for (const tid of trackIds) {
      const result = this._db.prepare(
        'INSERT OR IGNORE INTO playlist_tracks (playlist_id, track_id, position, added_at) VALUES (?,?,?,?)'
      ).run(playlistId, tid, nextPos, now);
      if (result.changes > 0) {
        nextPos++;
        added++;
      }
    }
    this._db.prepare(
      'UPDATE playlists SET updated_at=? WHERE id=?'
    ).run(Date.now() / 1000, playlistId);
    return added;
  }

  removeFromPlaylist(playlistId, trackId) {
    this._db.prepare(
      'DELETE FROM playlist_tracks WHERE playlist_id=? AND track_id=?'
    ).run(playlistId, trackId);
    const rows = this._db.prepare(
      'SELECT track_id FROM playlist_tracks WHERE playlist_id=? ORDER BY position'
    ).all(playlistId);
    rows.forEach((r, i) => {
      this._db.prepare(
        'UPDATE playlist_tracks SET position=? WHERE playlist_id=? AND track_id=?'
      ).run(i, playlistId, r.track_id);
    });
    this._db.prepare(
      'UPDATE playlists SET updated_at=? WHERE id=?'
    ).run(Date.now() / 1000, playlistId);
  }

  getPlaylistTracks(playlistId) {
    const rows = this._db.prepare(
      `SELECT t.*, pt.position, pt.added_at AS playlist_added_at
       FROM tracks t INNER JOIN playlist_tracks pt ON t.id = pt.track_id
       WHERE pt.playlist_id=? ORDER BY pt.position`
    ).all(playlistId);
    for (const t of rows) {
      t.sort_key = makeSortKey(t.title);
      t.artist_sort_key = makeSortKey(t.artist);
      t.album_sort_key = makeSortKey(t.album);
      t.alias_sort_key = makeSortKey(t.alias_title);
      t.artists = this._splitArtists(t.artist);
    }
    return rows;
  }

  getAllPlaylistTrackIds() {
    const rows = this._db.prepare(
      `SELECT playlist_id, track_id FROM playlist_tracks`
    ).all();
    const map = {};
    for (const r of rows) {
      const key = String(r.playlist_id);
      if (!map[key]) map[key] = [];
      map[key].push(r.track_id);
    }
    return map;
  }




  importRemotePlaylist(serverId, remoteId, name, remoteChanged, coverArtId, owner) {
    const now = Date.now() / 1000;
    const result = this._db.prepare(
      "INSERT INTO playlists (name, created_at, updated_at, source, server_id, remote_id, remote_changed, cover_art_id, owner)" +
      " VALUES (?, ?, ?, 'subsonic', ?, ?, ?, ?, ?)"
    ).run(name, now, now, parseInt(serverId, 10), String(remoteId), remoteChanged || null, coverArtId || null, owner || null);
    return {
      id: result.lastInsertRowid, name, created_at: now, updated_at: now,
      source: 'subsonic', server_id: parseInt(serverId, 10), remote_id: String(remoteId),
      remote_changed: remoteChanged || null, cover_art_id: coverArtId || null,
      owner: owner || null, track_count: 0,
    };
  }

  findRemotePlaylist(serverId, remoteId) {
    return this._db.prepare(
      "SELECT * FROM playlists WHERE source='subsonic' AND server_id=? AND remote_id=?"
    ).get(parseInt(serverId, 10), String(remoteId)) || null;
  }

  updateRemotePlaylist(playlistId, name, remoteChanged, coverArtId, owner) {
    this._db.prepare(
      'UPDATE playlists SET name=?, remote_changed=?, cover_art_id=?, owner=?, updated_at=? WHERE id=?'
    ).run(name, remoteChanged || null, coverArtId || null, owner || null, Date.now() / 1000, parseInt(playlistId, 10));
  }

  updatePlaylistOwnerEmail(playlistId, email) {
    this._db.prepare(
      'UPDATE playlists SET owner_email=? WHERE id=?'
    ).run(email || null, parseInt(playlistId, 10));
  }

  replacePlaylistTracks(playlistId, trackIds) {
    const pid = parseInt(playlistId, 10);
    if (!Array.isArray(trackIds)) return 0;
    this._db.prepare('DELETE FROM playlist_tracks WHERE playlist_id=?').run(pid);
    const now = Date.now() / 1000;
    const stmt = this._db.prepare(
      'INSERT OR IGNORE INTO playlist_tracks (playlist_id, track_id, position, added_at) VALUES (?,?,?,?)'
    );
    for (let i = 0; i < trackIds.length; i++) {
      stmt.run(pid, trackIds[i], i, now);
    }
    this._db.prepare('UPDATE playlists SET updated_at=? WHERE id=?').run(now, pid);
    return trackIds.length;
  }

  removeRemotePlaylistsForServer(serverId) {
    const sid = parseInt(serverId, 10);
    this._db.prepare("DELETE FROM playlists WHERE source='subsonic' AND server_id=?").run(sid);
  }

  listRemotePlaylists(serverId) {
    return this._db.prepare(
      "SELECT id, remote_id FROM playlists WHERE source='subsonic' AND server_id=?"
    ).all(parseInt(serverId, 10)) || [];
  }

  getPlaylistRemoteInfo(playlistId) {
    return this._db.prepare(
      'SELECT id, name, source, server_id, remote_id, remote_changed FROM playlists WHERE id=?'
    ).get(parseInt(playlistId, 10)) || null;
  }

  getSubsonicTrackIds(trackIds, serverId) {
    const sid = parseInt(serverId, 10);
    const subsonicIds = [];
    const skipped = [];
    if (!trackIds || trackIds.length === 0) return { subsonicIds, skipped };
    const stmt = this._db.prepare('SELECT id, subsonic_id, source, server_id FROM tracks WHERE id=?');
    for (const tid of trackIds) {
      const row = stmt.get(tid);
      if (row && row.source === 'subsonic' && row.server_id === sid && row.subsonic_id) {
        subsonicIds.push(row.subsonic_id);
      } else {
        skipped.push(tid);
      }
    }
    return { subsonicIds, skipped };
  }

  storeCoverColors(trackId, colorsJson) {
    this._db.prepare('INSERT OR REPLACE INTO cover_colors (track_id, colors) VALUES (?,?)').run(trackId, colorsJson);
  }
  getCoverColors(trackId) {
    const row = this._db.prepare('SELECT colors FROM cover_colors WHERE track_id=?').get(trackId);
    if (!row) return null;
    try { return JSON.parse(row.colors); } catch { return null; }
  }
  getBatchCoverColors(trackIds) {
    if (!trackIds || trackIds.length === 0) return {};
    const p = trackIds.map(()=>'?').join(',');
    const rows = this._db.prepare('SELECT track_id, colors FROM cover_colors WHERE track_id IN ('+p+')').all(...trackIds);
    const result = {};
    for (const r of rows) { try { result[r.track_id] = JSON.parse(r.colors); } catch {} }
    return result;
  }

  addSubsonicServer(name, serverUrl, username, password, protocolMode = 'subsonic') {
    const now = Date.now() / 1000;
    const result = this._db.prepare(
      `INSERT INTO subsonic_sources
       (name, server_url, username, password, protocol_mode, added_at)
       VALUES (?,?,?,?,?,?)`
    ).run(name, serverUrl, username, password, protocolMode, now);
    return {
      id: result.lastInsertRowid,
      name,
      server_url: serverUrl,
      username,
      protocol_mode: protocolMode,
      added_at: now,
      last_sync: null,
    };
  }

  removeSubsonicServer(serverId) {
    const sid = parseInt(serverId, 10);
    this.removeRemotePlaylistsForServer(sid);
    this._deleteTracksByCondition('server_id=?', sid);
    this._deleteTracksByCondition(
      "server_id IS NULL AND source='subsonic' AND path LIKE ?",
      `subsonic://${sid}/%`
    );
    this._db.prepare('DELETE FROM subsonic_sources WHERE id=?').run(sid);
    try {
      const cacheDir = path.join(this._subsonicCoverCacheDir(), String(sid));
      if (fs.existsSync(cacheDir)) {
        fs.rmSync(cacheDir, { recursive: true, force: true });
      }
    } catch {
    }
  }

  getSubsonicServers() {
    return this._db.prepare(
      `SELECT id, name, server_url, username, protocol_mode, added_at, last_sync,
       (SELECT COUNT(*) FROM tracks t WHERE t.server_id=subsonic_sources.id) AS track_count
       FROM subsonic_sources ORDER BY added_at`
    ).all();
  }

  getSubsonicServer(serverId) {
    return this._db.prepare('SELECT * FROM subsonic_sources WHERE id=?').get(parseInt(serverId, 10)) || null;
  }

  updateSubsonicServerLastSync(serverId) {
    this._db.prepare('UPDATE subsonic_sources SET last_sync=? WHERE id=?').run(
      Date.now() / 1000, parseInt(serverId, 10)
    );
  }

  updateSubsonicServer(serverId, name = null, serverUrl = null, username = null, password = null, protocolMode = null) {
    const sets = [];
    const params = [];
    if (name !== null) { sets.push('name=?'); params.push(name); }
    if (serverUrl !== null) { sets.push('server_url=?'); params.push(serverUrl); }
    if (username !== null) { sets.push('username=?'); params.push(username); }
    if (password !== null && password !== '') { sets.push('password=?'); params.push(password); }
    if (protocolMode !== null) { sets.push('protocol_mode=?'); params.push(protocolMode); }

    if (sets.length === 0) {
      return this._db.prepare(
        `SELECT id, name, server_url, username, protocol_mode, added_at, last_sync,
         (SELECT COUNT(*) FROM tracks t WHERE t.server_id=subsonic_sources.id) AS track_count
         FROM subsonic_sources WHERE id=?`
      ).get(parseInt(serverId, 10)) || null;
    }
    params.push(parseInt(serverId, 10));
    this._db.prepare(`UPDATE subsonic_sources SET ${sets.join(', ')} WHERE id=?`).run(...params);
    return this._db.prepare(
      `SELECT id, name, server_url, username, protocol_mode, added_at, last_sync,
       (SELECT COUNT(*) FROM tracks t WHERE t.server_id=subsonic_sources.id) AS track_count
       FROM subsonic_sources WHERE id=?`
    ).get(parseInt(serverId, 10)) || null;
  }


  deleteSubsonicTracks(serverId) {
    this._deleteTracksByCondition('server_id=?', parseInt(serverId, 10));
  }

  upsertSubsonicTracksBatch(serverId, songs) {
    if (!songs || songs.length === 0) return 0;
    const serverIdInt = parseInt(serverId, 10);
    let inserted = 0;
    const insertStmt = this._db.prepare(
      `INSERT OR IGNORE INTO tracks
       (id, path, folder_id, title, artist, album, album_artist,
        track_number, disc_number, year, duration_ms, file_size,
        has_cover, genre, added_at, source, server_id, subsonic_id, cover_id, suffix)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    );
    const updateStmt = this._db.prepare(
      `UPDATE tracks SET
        title=?, artist=?, album=?, album_artist=?,
        track_number=?, disc_number=?, year=?, duration_ms=?, file_size=?,
        has_cover=?, genre=?, server_id=?, subsonic_id=?, cover_id=?, suffix=?
        WHERE id=?`
    );
    for (const s of songs) {
      const subId = s.id;
      if (!subId) continue;
      const tid = subsonicTrackId(serverIdInt, subId);
      const existed = this._db.prepare('SELECT 1 FROM tracks WHERE id=? LIMIT 1').get(tid) !== undefined;
      if (!existed) {
        insertStmt.run(
          tid, `subsonic://${serverIdInt}/${subId}`, null,
          s.title, s.artist, s.album, s.album_artist,
          s.track_number, s.disc_number, s.year, s.duration_ms, s.size || 0,
          s.cover_art_id ? 1 : 0, s.genre || null,
          Date.now() / 1000,
          'subsonic', serverIdInt, subId, s.cover_art_id, s.suffix
        );
        inserted++;
      } else {
        updateStmt.run(
          s.title, s.artist, s.album, s.album_artist,
          s.track_number, s.disc_number, s.year, s.duration_ms, s.size || 0,
          s.cover_art_id ? 1 : 0, s.genre || null,
          serverIdInt, subId, s.cover_art_id, s.suffix, tid
        );
      }
    }
    this._invalidateDedupCache();
    return inserted;
  }

  deleteStaleSubsonicTracks(serverId, liveSubIds) {
    const serverIdInt = parseInt(serverId, 10);
    const rows = this._db.prepare(
      `SELECT id, subsonic_id FROM tracks WHERE source='subsonic' AND server_id=?`
    ).all(serverIdInt);
    const staleIds = [];
    for (const row of rows) {
      if (!liveSubIds.has(row.subsonic_id)) {
        staleIds.push(row.id);
      }
    }
    if (staleIds.length === 0) return 0;
    this._deleteTracksByCondition(
      `id IN (${staleIds.map(() => '?').join(',')})`,
      ...staleIds
    );
    return staleIds.length;
  }

  _deleteTracksByCondition(where, ...params) {
    const tx = this._db.transaction(() => {
      const ids = this._db.prepare(`SELECT id FROM tracks WHERE ${where}`).all(...params).map((r) => r.id);
      if (ids.length === 0) return;

      const placeholders = ids.map(() => '?').join(',');
      this._db.prepare(`DELETE FROM liked_tracks WHERE track_id IN (${placeholders})`).run(...ids);
      this._db.prepare(`DELETE FROM play_history WHERE track_id IN (${placeholders})`).run(...ids);
      this._db.prepare(`DELETE FROM playlist_tracks WHERE track_id IN (${placeholders})`).run(...ids);
      this._db.prepare(`DELETE FROM tracks WHERE id IN (${placeholders})`).run(...ids);
    });
    tx();
    this._invalidateDedupCache();
  }

  commit() {
  }


  getSubsonicServerForTrack(trackId) {
    if (!trackId || !trackId.startsWith('s')) return null;
    return this._db.prepare(
      `SELECT src.* FROM subsonic_sources src
       INNER JOIN tracks t ON t.server_id=src.id
       WHERE t.id=?`
    ).get(trackId) || null;
  }

  getSubsonicCoverIdForTrack(trackId) {
    const row = this._db.prepare('SELECT cover_id FROM tracks WHERE id=?').get(trackId);
    return row ? row.cover_id : null;
  }

  getSubsonicAlbumCoverIdForTrack(trackId) {
    const row = this._db.prepare('SELECT album, server_id FROM tracks WHERE id=?').get(trackId);
    if (!row || !row.album || !row.server_id) return null;
    const row2 = this._db.prepare(
      `SELECT cover_id FROM tracks
       WHERE album=? AND server_id=? AND cover_id IS NOT NULL AND id!=? LIMIT 1`
    ).get(row.album, row.server_id, trackId);
    return row2 ? row2.cover_id : null;
  }

  async getSubsonicCoverData(trackId) {
    if (!trackId || !trackId.startsWith('s')) return null;
    const rest = trackId.slice(1);
    const [sidStr, , ...subParts] = rest.split('_');
    const subId = subParts.join('_');
    let serverId;
    try { serverId = parseInt(sidStr, 10); } catch { return null; }

    let coverId = this.getSubsonicCoverIdForTrack(trackId);
    if (!coverId) coverId = this.getSubsonicAlbumCoverIdForTrack(trackId);
    if (!coverId) coverId = subId;
    if (!coverId) return null;

    const cached = this.readSubsonicCoverCache(serverId, coverId);
    if (cached) return cached;

    const cfg = this.getSubsonicServer(serverId);
    if (!cfg) return null;

    const { proxyRequest, SubsonicError } = require('./subsonic');
    try {
      const { body, contentType } = await proxyRequest(
        cfg.server_url, cfg.username, cfg.password,
        'getCoverArt', { id: coverId, size: 300 },
        cfg.protocol_mode || 'subsonic', 30.0
      );
      if (body && (contentType || '').startsWith('image/')) {
        this.writeSubsonicCoverCache(serverId, coverId, body);
      }
      return body || null;
    } catch {
      return null;
    }
  }


  _subsonicCoverCacheDir() {
    return path.join(this._cacheBaseDir, 'subsonic_covers');
  }

  // 当前缓存根目录（供 cover-server 等复用）。
  getCacheDir() {
    return this._cacheBaseDir;
  }

  // 运行时热更新缓存根目录（设置变更后由 bridge 调用）。
  setCacheDir(newBase) {
    if (!newBase) return;
    this._cacheBaseDir = path.resolve(newBase);
    this._coverCacheDir = path.join(this._cacheBaseDir, 'cover_cache');
    try {
      fs.mkdirSync(this._coverCacheDir, { recursive: true });
    } catch {  }
    if (this._coverDataCache) {
      this._coverDataCache.clear();
      this._coverDataCacheBytes = 0;
    }
  }

  getSubsonicCoverCachePath(serverId, coverId, size) {
    const s = (size && size !== 'max' && size !== 'original') ? (coverId + ':' + size) : coverId;
    const safe = crypto.createHash('sha1').update(s, 'utf-8').digest('hex');
    return path.join(this._subsonicCoverCacheDir(), String(parseInt(serverId, 10)), `${safe}.bin`);
  }

  readSubsonicCoverCache(serverId, coverId, size) {
    const p = this.getSubsonicCoverCachePath(serverId, coverId, size);
    if (!fs.existsSync(p)) return null;
    try { return fs.readFileSync(p); } catch { return null; }
  }

  writeSubsonicCoverCache(serverId, coverId, data, size) {
    const p = this.getSubsonicCoverCachePath(serverId, coverId, size);
    try {
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, data);
    } catch {
    }
  }


  addWebDAVServer(name, serverUrl, username, password) {
    const now = Date.now() / 1000;
    const result = this._db.prepare(
      `INSERT INTO webdav_sources (name, server_url, username, password, added_at)
       VALUES (?,?,?,?,?)`
    ).run(name, serverUrl, username, password, now);
    return {
      id: result.lastInsertRowid,
      name,
      server_url: serverUrl,
      username,
      added_at: now,
      last_sync: null,
    };
  }

  removeWebDAVServer(serverId) {
    const sid = parseInt(serverId, 10);
    this._deleteTracksByCondition("source='webdav' AND server_id=?", sid);
    this._db.prepare('DELETE FROM webdav_sources WHERE id=?').run(sid);
  }

  getWebDAVServers() {
    return this._db.prepare(
      `SELECT id, name, server_url, username, added_at, last_sync,
       (SELECT COUNT(*) FROM tracks t WHERE t.server_id=webdav_sources.id AND t.source='webdav') AS track_count
       FROM webdav_sources ORDER BY added_at`
    ).all();
  }

  getWebDAVServer(serverId) {
    return this._db.prepare('SELECT * FROM webdav_sources WHERE id=?').get(parseInt(serverId, 10)) || null;
  }

  updateWebDAVServerLastSync(serverId) {
    this._db.prepare('UPDATE webdav_sources SET last_sync=? WHERE id=?').run(
      Date.now() / 1000, parseInt(serverId, 10)
    );
  }

  updateWebDAVServer(serverId, name = null, serverUrl = null, username = null, password = null) {
    const sets = [];
    const params = [];
    if (name !== null) { sets.push('name=?'); params.push(name); }
    if (serverUrl !== null) { sets.push('server_url=?'); params.push(serverUrl); }
    if (username !== null) { sets.push('username=?'); params.push(username); }
    if (password !== null && password !== '') { sets.push('password=?'); params.push(password); }

    if (sets.length === 0) {
      return this._db.prepare(
        `SELECT id, name, server_url, username, added_at, last_sync,
         (SELECT COUNT(*) FROM tracks t WHERE t.server_id=webdav_sources.id AND t.source='webdav') AS track_count
         FROM webdav_sources WHERE id=?`
      ).get(parseInt(serverId, 10)) || null;
    }
    params.push(parseInt(serverId, 10));
    this._db.prepare(`UPDATE webdav_sources SET ${sets.join(', ')} WHERE id=?`).run(...params);
    return this._db.prepare(
      `SELECT id, name, server_url, username, added_at, last_sync,
       (SELECT COUNT(*) FROM tracks t WHERE t.server_id=webdav_sources.id AND t.source='webdav') AS track_count
       FROM webdav_sources WHERE id=?`
    ).get(parseInt(serverId, 10)) || null;
  }


  upsertWebDAVTrack(serverId, relativePath, href, meta) {
    const serverIdInt = parseInt(serverId, 10);
    const crypto = require('crypto');
    const pathHash = crypto.createHash('sha1').update(relativePath, 'utf-8').digest('hex').slice(0, 16);
    const tid = `w${serverIdInt}_${pathHash}`;
    const path = `webdav://${serverIdInt}${relativePath}`;

    const existed = this._db.prepare('SELECT 1 FROM tracks WHERE id=? LIMIT 1').get(tid) !== undefined;
    if (!existed) {
      this._db.prepare(
        `INSERT OR IGNORE INTO tracks
         (id, path, folder_id, title, artist, album, album_artist,
          track_number, disc_number, year, duration_ms, file_size,
          has_cover, genre, added_at, source, server_id, webdav_path)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
      ).run(
        tid, path, null,
        meta.title || relativePath.split('/').pop() || '未知曲目',
        meta.artist || null,
        meta.album || null,
        meta.album_artist || null,
        meta.track_number || null,
        meta.disc_number || null,
        meta.year || null,
        meta.duration_ms || null,
        meta.file_size || 0,
        meta.has_cover ? 1 : 0,
        meta.genre || null,
        Date.now() / 1000,
        'webdav', serverIdInt, href
      );
    } else {
      this._db.prepare(
        `UPDATE tracks SET
          title=?, artist=?, album=?, album_artist=?,
          track_number=?, disc_number=?, year=?, duration_ms=?, file_size=?,
          has_cover=?, genre=?, webdav_path=?
          WHERE id=?`
      ).run(
        meta.title || relativePath.split('/').pop() || '未知曲目',
        meta.artist || null,
        meta.album || null,
        meta.album_artist || null,
        meta.track_number || null,
        meta.disc_number || null,
        meta.year || null,
        meta.duration_ms || null,
        meta.file_size || 0,
        meta.has_cover ? 1 : 0,
        meta.genre || null,
        href, tid
      );
    }
    this._invalidateDedupCache();
  }

  deleteStaleWebDAVTracks(serverId, livePaths) {
    const serverIdInt = parseInt(serverId, 10);
    const rows = this._db.prepare(
      `SELECT id, path FROM tracks WHERE source='webdav' AND server_id=?`
    ).all(serverIdInt);
    const staleIds = [];
    for (const row of rows) {
      const prefix = `webdav://${serverIdInt}`;
      let relPath = row.path;
      if (row.path && row.path.startsWith(prefix)) {
        relPath = row.path.slice(prefix.length);
      }
      if (!livePaths.has(relPath)) {
        staleIds.push(row.id);
      }
    }
    if (staleIds.length === 0) return 0;
    this._deleteTracksByCondition(
      `id IN (${staleIds.map(() => '?').join(',')})`,
      ...staleIds
    );
    return staleIds.length;
  }


  addSMBServer(name, host, shareName, username, password, domain = '') {
    const now = Date.now() / 1000;
    const result = this._db.prepare(
      `INSERT INTO smb_sources (name, host, share_name, username, password, domain, added_at)
       VALUES (?,?,?,?,?,?,?)`
    ).run(name, host, shareName, username, password, domain, now);
    return {
      id: result.lastInsertRowid,
      name,
      host,
      share_name: shareName,
      username,
      domain,
      added_at: now,
      last_sync: null,
    };
  }

  removeSMBServer(serverId) {
    const sid = parseInt(serverId, 10);
    this._deleteTracksByCondition("source='smb' AND server_id=?", sid);
    this._db.prepare('DELETE FROM smb_sources WHERE id=?').run(sid);
  }

  getSMBServers() {
    return this._db.prepare(
      `SELECT id, name, host, share_name, username, domain, added_at, last_sync,
       (SELECT COUNT(*) FROM tracks t WHERE t.server_id=smb_sources.id AND t.source='smb') AS track_count
       FROM smb_sources ORDER BY added_at`
    ).all();
  }

  getSMBServer(serverId) {
    return this._db.prepare('SELECT * FROM smb_sources WHERE id=?').get(parseInt(serverId, 10)) || null;
  }

  updateSMBServerLastSync(serverId) {
    this._db.prepare('UPDATE smb_sources SET last_sync=? WHERE id=?').run(
      Date.now() / 1000, parseInt(serverId, 10)
    );
  }

  updateSMBServer(serverId, name = null, host = null, shareName = null, username = null, password = null, domain = null) {
    const sets = [];
    const params = [];
    if (name !== null) { sets.push('name=?'); params.push(name); }
    if (host !== null) { sets.push('host=?'); params.push(host); }
    if (shareName !== null) { sets.push('share_name=?'); params.push(shareName); }
    if (username !== null) { sets.push('username=?'); params.push(username); }
    if (password !== null && password !== '') { sets.push('password=?'); params.push(password); }
    if (domain !== null) { sets.push('domain=?'); params.push(domain); }

    if (sets.length === 0) {
      return this._db.prepare(
        `SELECT id, name, host, share_name, username, domain, added_at, last_sync,
         (SELECT COUNT(*) FROM tracks t WHERE t.server_id=smb_sources.id AND t.source='smb') AS track_count
         FROM smb_sources WHERE id=?`
      ).get(parseInt(serverId, 10)) || null;
    }
    params.push(parseInt(serverId, 10));
    this._db.prepare(`UPDATE smb_sources SET ${sets.join(', ')} WHERE id=?`).run(...params);
    return this._db.prepare(
      `SELECT id, name, host, share_name, username, domain, added_at, last_sync,
       (SELECT COUNT(*) FROM tracks t WHERE t.server_id=smb_sources.id AND t.source='smb') AS track_count
       FROM smb_sources WHERE id=?`
    ).get(parseInt(serverId, 10)) || null;
  }


  markTracksAsSmb(folderId, serverId) {
    const serverIdInt = parseInt(serverId, 10);
    this._db.prepare(
      `UPDATE tracks SET source='smb', server_id=? WHERE folder_id=? AND source IS NULL`
    ).run(serverIdInt, folderId);
    this._invalidateDedupCache();
  }

  getTracksByFolder(folderId) {
    return this._db.prepare('SELECT * FROM tracks WHERE folder_id=?').all(folderId);
  }

  getSMBServerForTrack(trackId) {
    if (!trackId || !trackId.startsWith('s')) {
    }
    return this._db.prepare(
      `SELECT src.* FROM smb_sources src
       INNER JOIN tracks t ON t.server_id=src.id
       WHERE t.id=? AND t.source='smb'`
    ).get(trackId) || null;
  }


  getAllRemoteServers() {
    const subsonic = this._db.prepare(
      `SELECT id, name, server_url, username, added_at, last_sync,
       'subsonic' AS type,
       (SELECT COUNT(*) FROM tracks t WHERE t.server_id=subsonic_sources.id AND t.source='subsonic') AS track_count
       FROM subsonic_sources ORDER BY added_at`
    ).all();
    const webdav = this._db.prepare(
      `SELECT id, name, server_url, username, added_at, last_sync,
       'webdav' AS type,
       (SELECT COUNT(*) FROM tracks t WHERE t.server_id=webdav_sources.id AND t.source='webdav') AS track_count
       FROM webdav_sources ORDER BY added_at`
    ).all();
    const smb = this._db.prepare(
      `SELECT id, name, host, share_name, username, domain, added_at, last_sync,
       'smb' AS type,
       '' AS server_url,
       (SELECT COUNT(*) FROM tracks t WHERE t.server_id=smb_sources.id AND t.source='smb') AS track_count
       FROM smb_sources ORDER BY added_at`
    ).all();

    for (const s of smb) {
      s.server_url = `\\\\${s.host}\\${s.share_name}`;
    }

    return [...subsonic, ...webdav, ...smb];
  }

  close() {
    if (this._closed) return;
    this._closed = true;
    try { this._db.close(); } catch {  }
  }
}


function _extractMp3Cover(buf) {
  if (buf.length < 10) return null;
  if (buf[0] !== 0x49 || buf[1] !== 0x44 || buf[2] !== 0x33) return null;

  const version = buf[3];
  const flags = buf[5];
  let headerSize = 10;

  function readSyncSafe(offset) {
    return (
      (buf[offset] & 0x7f) * 0x200000 +
      (buf[offset + 1] & 0x7f) * 0x4000 +
      (buf[offset + 2] & 0x7f) * 0x80 +
      (buf[offset + 3] & 0x7f)
    );
  }

  const tagSize = readSyncSafe(6);
  const endPos = headerSize + tagSize;
  if (endPos > buf.length) return null;

  let pos = headerSize;
  while (pos < endPos - 10) {
    const frameId = buf.toString('ascii', pos, pos + 4);
    if (frameId.charCodeAt(0) === 0) break;

    let frameSize;
    if (version === 4) {
      frameSize = readSyncSafe(pos + 4);
    } else if (version === 3) {
      frameSize = buf.readUInt32BE(pos + 4);
    } else {
      frameSize = readSyncSafe(pos + 4);
    }
    const frameFlags = buf.readUInt16BE(pos + 8);
    const frameDataStart = pos + 10;

    if (frameSize <= 0 || frameDataStart + frameSize > buf.length) break;

    if (frameId === 'APIC') {
      let offset = frameDataStart;
      const encoding = buf[offset++];
      let mimeEnd = offset;
      while (mimeEnd < frameDataStart + frameSize && buf[mimeEnd] !== 0) mimeEnd++;
      offset = mimeEnd + 1;
      if (offset >= frameDataStart + frameSize) break;
      offset++;
      if (encoding === 1 || encoding === 2) {
        while (offset < frameDataStart + frameSize - 1) {
          if (buf[offset] === 0 && buf[offset + 1] === 0) { offset += 2; break; }
          offset += 2;
        }
      } else {
        while (offset < frameDataStart + frameSize && buf[offset] !== 0) offset++;
        offset++;
      }
      const picData = buf.slice(offset, frameDataStart + frameSize);
      if (picData.length > 0) return picData;
    }
    pos = frameDataStart + frameSize;
  }
  return null;
}

function _extractFlacCover(buf) {
  if (buf.length < 4) return null;
  if (buf[0] !== 0x66 || buf[1] !== 0x4c || buf[2] !== 0x61 || buf[3] !== 0x43) return null;

  let pos = 4;
  while (pos < buf.length - 4) {
    const blockType = buf[pos] & 0x7f;
    const isLast = (buf[pos] & 0x80) !== 0;
    const blockLength = (buf[pos + 1] << 16) | (buf[pos + 2] << 8) | buf[pos + 3];
    pos += 4;

    if (blockType === 6) {
      if (pos + blockLength > buf.length) return null;
      let offset = pos;
      offset += 4;
      const mimeLen = buf.readUInt32BE(offset);
      offset += 4 + mimeLen;
      const descLen = buf.readUInt32BE(offset);
      offset += 4 + descLen;
      offset += 16;
      const dataLen = buf.readUInt32BE(offset);
      offset += 4;
      if (offset + dataLen > buf.length) return null;
      return buf.slice(offset, offset + dataLen);
    }

    pos += blockLength;
    if (isLast) break;
  }
  return null;
}

function _extractMp4Cover(buf) {
  function findAtom(data, start, end, targetName) {
    let pos = start;
    while (pos < end - 8) {
      const size = data.readUInt32BE(pos);
      const name = data.toString('ascii', pos + 4, pos + 8);
      if (size < 8 || pos + size > end) return -1;
      if (name === targetName) return pos;
      pos += size;
    }
    return -1;
  }

  function searchCovr(data, start, end, depth) {
    if (depth > 6) return null;
    let pos = start;
    while (pos < end - 8) {
      const size = data.readUInt32BE(pos);
      const name = data.toString('ascii', pos + 4, pos + 8);
      if (size < 8 || pos + size > end) break;
      if (name === 'covr') {
        const dataStart = pos + 8;
        const dataEnd = pos + size;
        const dataAtomPos = findAtom(data, dataStart, dataEnd, 'data');
        if (dataAtomPos >= 0) {
          const dataSize = data.readUInt32BE(dataAtomPos);
          const picStart = dataAtomPos + 16;
          const picEnd = dataAtomPos + dataSize;
          if (picEnd <= data.length) return data.slice(picStart, picEnd);
        }
        return data.slice(dataStart, dataEnd);
      }
      if (['moov', 'trak', 'mdia', 'minf', 'stbl', 'udta', 'meta', 'ilst'].includes(name)) {
        const innerStart = name === 'meta' ? pos + 12 : pos + 8;
        const innerEnd = pos + size;
        const result = searchCovr(data, innerStart, innerEnd, depth + 1);
        if (result) return result;
      }
      pos += size;
    }
    return null;
  }

  return searchCovr(buf, 0, buf.length, 0);
}

function _extractOggCover(buf) {
  const str = buf.toString('latin1');
  const marker = 'metadata_block_picture=';
  const idx = str.indexOf(marker);
  if (idx < 0) return null;

  let end = idx + marker.length;
  while (end < str.length && str[end] !== '\n' && str[end] !== '\r' && str[end] !== '\0') end++;
  const b64 = str.slice(idx + marker.length, end);

  try {
    const decoded = Buffer.from(b64, 'base64');
    if (decoded.length < 32) return null;
    let offset = 0;
    offset += 4;
    const mimeLen = decoded.readUInt32BE(offset);
    offset += 4 + mimeLen;
    const descLen = decoded.readUInt32BE(offset);
    offset += 4 + descLen;
    offset += 16;
    const dataLen = decoded.readUInt32BE(offset);
    offset += 4;
    if (offset + dataLen > decoded.length) return null;
    return decoded.slice(offset, offset + dataLen);
  } catch {
    return null;
  }
}

function webdavTrackId(serverId, relativePath) {
  const crypto = require('crypto');
  const pathHash = crypto.createHash('sha1').update(relativePath, 'utf-8').digest('hex').slice(0, 16);
  return `w${parseInt(serverId, 10)}_${pathHash}`;
}

module.exports = { MusicLibrary, trackId, subsonicTrackId, webdavTrackId, SUPPORTED_EXT };
