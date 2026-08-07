/**
 * Carminium — 音乐库管理
 * 使用 SQLite (better-sqlite3) 存储曲目元数据，使用 music-metadata 解析音频文件。
 */
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { makeSortKey, makeFirstLetter } = require('./sortkey');

// music-metadata v10+ 是纯 ESM 包。
// 在 Electron 31 (Node.js 20) 中，require() 仅返回 { loadMusicMetadata }，
// 需要通过 loadMusicMetadata() 异步获取 parseFile 等命名导出。
// 在 Node.js 22+ 中，require() 可直接返回命名导出（含 parseFile）。
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

const FEAT_PATTERNS = ['feat.', 'ft.', 'vs.', 'with'];

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
    has_cover    INTEGER DEFAULT 0,
    lyrics       TEXT,
    added_at     REAL NOT NULL
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

CREATE TABLE IF NOT EXISTS cover_colors (
    track_id TEXT PRIMARY KEY REFERENCES tracks(id) ON DELETE CASCADE,
    colors   TEXT NOT NULL
);
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
    // 限制 SQLite 页面缓存（默认 2000 页 × 页大小，大库下可占 30MB+）
    this._db.pragma('cache_size = -2000'); // -2000 = 2000 KB ≈ 2MB
    this._db.exec(CREATE_SQL);
    this._migrateSchema();
    this._closed = false;
    this._dedupCache = null;       // { dupIds: Set<string>, localMap: Map<string, object> }
    this._dedupLocalPathCache = null; // Map<dedupKey, localTrackPath>

    // ── 封面数据缓存：磁盘持久化 + 小内存 LRU ──
    // getCoverData() 每次都会 fs.readFileSync 整个音频文件 + 同步解析 picture frame，
    // 大规模列表渲染时（100+ 曲目）会让 main 进程 event loop 被阻塞 →
    // 后续 HTTP /cover 请求超时 → 封面加载失败。
    //
    // 策略：
    //   1. 磁盘缓存（dataDir/cover_cache/<sha1(trackId)>.jpg）— 持久化，跨重启有效
    //   2. 内存 LRU（最近访问的 50 张，约 1.5MB）— 加速热数据，避免反复读磁盘
    //
    // 流程：
    //   - 请求 → 内存命中？返回
    //   - 内存未命中 → 磁盘缓存命中？读磁盘 + 提升到内存 → 返回
    //   - 磁盘未命中 → 读音频文件 + 提取 → 写磁盘 + 写内存 → 返回
    this._coverDataCache = new Map();  // track_id → Buffer（内存热缓存）
    this._coverDataCacheMax = 50;       // 内存上限（每张 ~30KB，50 张 ≈ 1.5MB）
    this._coverCacheDir = path.join(settings.dataDir, 'cover_cache');
    try {
      fs.mkdirSync(this._coverCacheDir, { recursive: true });
    } catch { /* 已存在或无权限 */ }
  }

  // ── Schema migration ─────────────────────────────────────────────────────

  _migrateSchema() {
    const tryAlter = (sql) => {
      try { this._db.exec(sql); } catch { /* already exists */ }
    };
    tryAlter('ALTER TABLE tracks ADD COLUMN lyrics TEXT');
tryAlter('ALTER TABLE tracks ADD COLUMN genre TEXT');
    for (const [col, def] of [['created_at', '0'], ['updated_at', '0']]) {
      tryAlter(`ALTER TABLE playlists ADD COLUMN ${col} REAL NOT NULL DEFAULT ${def}`);
    }
    for (const col of ['source', 'server_id', 'subsonic_id', 'cover_id', 'suffix']) {
      tryAlter(`ALTER TABLE tracks ADD COLUMN ${col} TEXT`);
    }

    // ── 远程歌单支持：playlists 表添加 source / server_id / remote_id / remote_changed 列 ──
    tryAlter("ALTER TABLE playlists ADD COLUMN source TEXT DEFAULT 'local'");
    tryAlter('ALTER TABLE playlists ADD COLUMN server_id INTEGER');
    tryAlter('ALTER TABLE playlists ADD COLUMN remote_id TEXT');
    tryAlter('ALTER TABLE playlists ADD COLUMN remote_changed TEXT');
    tryAlter('ALTER TABLE playlists ADD COLUMN cover_art_id TEXT');
    tryAlter('ALTER TABLE playlists ADD COLUMN owner TEXT');
    tryAlter('ALTER TABLE playlists ADD COLUMN owner_email TEXT');

    // 歌词回填
    const rows = this._db.prepare(
      "SELECT id, path FROM tracks WHERE lyrics IS NULL AND source IS NULL"
    ).all();
    for (const row of rows) {
      if (!fs.existsSync(row.path)) continue;
      const lrc = this._extractLrcSync(row.path);
      if (lrc) {
        this._db.prepare('UPDATE tracks SET lyrics=? WHERE id=?').run(lrc, row.id);
      }
    }

// 封面回填
    const coverRows = this._db.prepare(
      "SELECT id, path FROM tracks WHERE has_cover=0 AND source IS NULL"
    ).all();
    for (const row of coverRows) {
      if (!fs.existsSync(row.path)) continue;
      if (this._hasCoverSync(row.path)) {
        this._db.prepare('UPDATE tracks SET has_cover=1 WHERE id=?').run(row.id);
      }
    }

    // ── 孤儿曲目清理 ──────────────────────────────────────────
    // 删除 folder_id 不在 folders 表中、且 source IS NULL 的本地曲目
    // （文件夹已被删除但曲目残留，常见于旧后端迁移数据）
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

    // 删除 server_id 不在 subsonic_sources 表中、且 source='subsonic' 的曲目
    // （Subsonic 服务器已被删除但曲目残留）
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
  }

  // ── Folder management ─────────────────────────────────────────────────────

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
    // 兜底：删除 folder_id 为 NULL 但路径属于该文件夹的遗留曲目（旧后端迁移数据）
    this._deleteTracksByCondition(
      "folder_id IS NULL AND source IS NULL AND (path LIKE ? OR path LIKE ?)",
      p.replace(/\\/g, '/') + '/%',
      p + '/%'
    );
    this._db.prepare('DELETE FROM folders WHERE path=?').run(p);
  }

  rescanFolder(folderPath) {
    // 不再删除曲目！旧实现调用 _deleteTracksByCondition('folder_id=?', fid)
    // 会级联清空 liked_tracks / play_history / playlist_tracks，
    // 导致重新扫描后「喜欢的音乐」「播放历史」「Your Mix」全部清零。
    // 现在改为仅返回文件夹信息，实际同步交由 syncFolderIncremental 增量执行，
    // 仅对真正消失的曲目做级联删除，保留仍然存在曲目的关联数据。
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
    const row = this._db.prepare('SELECT id FROM folders WHERE path=?').get(folderPath);
    return row ? row.id : null;
  }

  _folderInfo(folderPath) {
    const row = this._db.prepare(
      `SELECT f.path, f.added_at, f.last_scan,
       (SELECT COUNT(*) FROM tracks t WHERE t.folder_id=f.id) AS track_count
       FROM folders f WHERE f.path=?`
    ).get(folderPath);
    return row || null;
  }

  // ── Scanning ──────────────────────────────────────────────────────────────

  async scanFolder(folderPath) {
    const fid = this._folderId(folderPath);
    if (fid === null) return;
    if (!fs.statSync(folderPath).isDirectory()) return;
    const now = Date.now() / 1000;

    // 阶段1: 遍历目录并解析元数据
    const filesToInsert = [];
    function walkDir(dir) {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walkDir(fullPath);
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          if (SUPPORTED_EXT.has(ext)) {
            filesToInsert.push(fullPath);
          }
        }
      }
    }
    walkDir(folderPath);

    // 阶段2: 解析元数据并写入数据库
    let inserted = 0;
    let alreadyCount = 0;
    for (const filePath of filesToInsert) {
      const already = this._db.prepare('SELECT folder_id FROM tracks WHERE path=?').get(filePath);
      if (already) {
        alreadyCount++;
        // 曲目已存在但 folder_id 可能缺失（旧后端迁移），补上关联
        if (already.folder_id === null || already.folder_id === undefined) {
          this._db.prepare('UPDATE tracks SET folder_id=? WHERE path=?').run(fid, filePath);
        }
        continue;
      }
      try {
        const meta = await this._parseMetadata(filePath);
        const stat = fs.statSync(filePath);
        this._insertLocalTrackRow(fid, filePath, meta, stat.size, now);
        inserted++;
      } catch (e) {
        console.error(`[MusicLibrary] Failed to insert track: ${filePath}`, e.message || e);
      }
    }
    this._db.prepare('UPDATE folders SET last_scan=? WHERE id=?').run(now, fid);
    this._invalidateDedupCache();
  }

  // ── 增量同步（FileWatcher 分层扫描）──────────────────────────────────────

  /**
   * 写入/覆盖一条本地曲目记录（INSERT OR REPLACE，仅用于新增场景）。
   * 注意：REPLACE 会先删除旧行并触发外键级联（收藏/历史/歌单引用），
   * 因此已存在曲目的内容更新必须使用 _updateLocalTrackRow。
   */
  _insertLocalTrackRow(fid, filePath, meta, size, addedAt) {
    const tid = trackId(filePath);
    // 使用 INSERT OR IGNORE 而非 INSERT OR REPLACE：
    // INSERT OR REPLACE 在主键冲突时会先 DELETE 旧行再 INSERT 新行，
    // 触发 ON DELETE CASCADE 级联删除 liked_tracks / play_history / playlist_tracks。
    // INSERT OR IGNORE 在冲突时静默跳过，保留已存在曲目的关联数据。
    this._db.prepare(
      `INSERT OR IGNORE INTO tracks
       (id, path, folder_id, title, artist, album, album_artist,
        track_number, disc_number, year, duration_ms, file_size,
        has_cover, lyrics, genre, added_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(
      tid, filePath, fid,
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
      addedAt
    );
  }

  /**
   * 更新已存在曲目的元数据（保留 added_at 与收藏/历史/歌单关联）。
   */
  _updateLocalTrackRow(filePath, meta, size) {
    this._db.prepare(
      `UPDATE tracks SET title=?, artist=?, album=?, album_artist=?,
       track_number=?, disc_number=?, year=?, duration_ms=?, file_size=?,
       has_cover=?, lyrics=?, genre=? WHERE path=?`
    ).run(
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
      filePath
    );
  }

  /**
   * 分层扫描 L1：仅遍历目录（readdir），收集受支持的音频文件路径。
   * 不 stat、不解析元数据，开销极小。
   * @param {string} rootDir
   * @returns {string[]}
   */
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

  /**
   * 分层增量同步（供 FileWatcher / 定期校验调用）：
   *   L1  数量比对：磁盘遍历结果数 vs DB 记录数
   *   L2  路径 diff：定位 新增 / 移除 的文件
   *   L2b 大小校验：对 watch 事件精确命中的文件 stat，检测同路径内容变动
   *   L3  元数据：仅对差异文件解析并写库
   *
   * 安全保护：
   *   - 磁盘目录不存在（驱动器掉线）→ 跳过，不删任何记录
   *   - 磁盘扫到 0 个音频但 DB 非空（疑似驱动器异常）→ 跳过，防止误清空库
   *
   * @param {string} folderPath
   * @param {{sizeCheckPaths?: string[]}} [opts] - 需做大小校验的精确路径（来自 watch 事件）
   * @returns {Promise<{added:number, removed:number, updated:number, total:number, changed:boolean, skipped?:boolean}|null>}
   */
  async syncFolderIncremental(folderPath, opts = {}) {
    const p = path.resolve(folderPath);
    const fid = this._folderId(p);
    if (fid === null) return null;
    if (!fs.existsSync(p)) {
      return { added: 0, removed: 0, updated: 0, total: 0, changed: false, skipped: true };
    }
    const now = Date.now() / 1000;

    // ── L1 + L2：遍历磁盘并与 DB 索引比对 ──
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

    // ── L2b 大小校验（仅针对 watch 事件精确命中的文件）──
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

    // ── L3 移除：分批删除（含收藏/历史/歌单关联）──
    const CHUNK = 400;
    for (let i = 0; i < toRemoveIds.length; i += CHUNK) {
      const chunk = toRemoveIds.slice(i, i + CHUNK);
      this._deleteTracksByCondition(
        `id IN (${chunk.map(() => '?').join(',')})`,
        ...chunk
      );
    }

    // ── L3 新增 / 更新：解析元数据并写库 ──
    let added = 0;
    for (const filePath of toAdd) {
      try {
        const meta = await this._parseMetadata(filePath);
        const stat = fs.statSync(filePath);
        this._insertLocalTrackRow(fid, filePath, meta, stat.size, now);
        added++;
      } catch (e) {
        console.error(`[MusicLibrary] 增量同步新增失败: ${filePath}`, e.message || e);
      }
    }
    let updated = 0;
    for (const u of toUpdate) {
      try {
        const meta = await this._parseMetadata(u.path);
        this._updateLocalTrackRow(u.path, meta, u.size);
        updated++;
      } catch (e) {
        console.error(`[MusicLibrary] 增量同步更新失败: ${u.path}`, e.message || e);
      }
    }

    this._db.prepare('UPDATE folders SET last_scan=? WHERE id=?').run(now, fid);
    this._invalidateDedupCache();
    return {
      added, removed: toRemoveIds.length, updated,
      total: diskPaths.length, changed: true,
    };
  }

  // ── Metadata ──────────────────────────────────────────────────────────────

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
    meta.lyrics = this._extractLrcSync(filePath, metadata);
    } catch (e) {
      console.error(`[MusicLibrary] Failed to parse metadata: ${filePath}`, e.message || e);
    }
    return meta;
  }

  _extractLrcSync(filePath, metadata = null) {
    try {
      // 1) 侧车 .lrc 文件
      const lrcPath = filePath.replace(/\.[^.]+$/, '.lrc');
      if (fs.existsSync(lrcPath)) {
        return fs.readFileSync(lrcPath, 'utf-8');
      }

      // 2) 从 metadata.native 提取歌词
      if (metadata && metadata.native) {
        for (const [format, tags] of Object.entries(metadata.native)) {
          for (const tag of tags) {
            const id = tag.id.toLowerCase();
            if (id === 'uslt' || id === '©lyr' || id === 'lyrics' || id === 'unsyncedlyrics') {
              if (!tag.value) continue;
              // music-metadata v10+ では USLT/COMM フレームの value が
              // { language, descriptor, text } オブジェクトになるため、
              // text プロパティを抽出する
              if (typeof tag.value === 'object' && tag.value !== null) {
                if (typeof tag.value.text === 'string' && tag.value.text) {
                  return tag.value.text;
                }
                // 稀に descriptor 部分のみの場合
                if (typeof tag.value.descriptor === 'string' && tag.value.descriptor) {
                  return tag.value.descriptor;
                }
              }
              return String(tag.value);
            }
          }
        }
      }
    } catch {
      // ignore
    }
    return null;
  }

  _hasCoverSync(filePath) {
    try {
      // Quick check: read file header with music-metadata
      // This is sync-safe for small reads, but music-metadata is async.
      // We'll just return false for the sync path; the async scan handles it.
      return false;
    } catch {
      return false;
    }
  }

  // ── Cover extraction ──────────────────────────────────────────────────────

  getCoverData(trackId) {
    if (!trackId) return null;

    // ── 1. 内存热缓存命中 ──
    const memCached = this._coverDataCache.get(trackId);
    if (memCached !== undefined) {
      // LRU touch：移到末尾（Map 保持插入顺序）
      if (memCached !== null) {
        this._coverDataCache.delete(trackId);
        this._coverDataCache.set(trackId, memCached);
      }
      return memCached;
    }

    const row = this._db.prepare('SELECT path, source FROM tracks WHERE id=?').get(trackId);
    if (!row) return null;
    if (row.source === 'subsonic') return null;
    if (!row.path) return null;

    // ── 2. 磁盘缓存命中 ──
    // 跨重启有效，避免每次启动都重新读音频文件提取
    const diskPath = this._coverCachePath(trackId);
    let data = null;
    try {
      if (fs.existsSync(diskPath)) {
        data = fs.readFileSync(diskPath);
        if (data && data.length === 0) data = null;  // 空文件 = 标记无封面
      }
    } catch { /* 磁盘读取失败，继续走提取 */ }

    // ── 3. 提取并写入磁盘缓存 ──
    if (data === null) {
      data = this._extractCoverSync(row.path);
      // 写入磁盘缓存（null 写空文件作为"无封面"标记，避免反复读音频文件）
      try {
        fs.writeFileSync(diskPath, data || Buffer.alloc(0));
      } catch { /* 磁盘写入失败，仅靠内存缓存 */ }
    }

    // ── 4. 写入内存 LRU ──
    if (this._coverDataCache.size >= this._coverDataCacheMax) {
      const oldest = this._coverDataCache.keys().next();
      if (!oldest.done) this._coverDataCache.delete(oldest.value);
    }
    this._coverDataCache.set(trackId, data);

    return data;
  }

  /**
   * 磁盘缓存路径：cover_cache/<sha1(trackId)>.jpg
   * 使用 SHA1 哈希避免 trackId 中的特殊字符破坏文件系统。
   * null 封面用 0 字节文件标记，区分"未提取过"和"已确认无封面"。
   */
  _coverCachePath(trackId) {
    const hash = crypto.createHash('sha1').update(trackId, 'utf-8').digest('hex');
    return path.join(this._coverCacheDir, `${hash}.jpg`);
  }

  /**
   * 清除封面数据缓存（单条或全部）。
   * 在曲目元数据变更、文件移动、手动刷新时调用。
   * @param {string} [trackId] - 指定 track_id 清除单条；省略则清除全部
   */
  clearCoverDataCache(trackId) {
    if (trackId) {
      this._coverDataCache.delete(trackId);
      try { fs.unlinkSync(this._coverCachePath(trackId)); } catch { /* ignore */ }
    } else {
      this._coverDataCache.clear();
      // 清空整个磁盘缓存目录
      try {
        const files = fs.readdirSync(this._coverCacheDir);
        for (const f of files) {
          try { fs.unlinkSync(path.join(this._coverCacheDir, f)); } catch { /* ignore */ }
        }
      } catch { /* 目录不存在或无权限 */ }
    }
  }

  _extractCoverSync(filePath) {
    try {
      // music-metadata is async, but better-sqlite3 is sync.
      // We need a synchronous way to extract cover art.
      // For MP3: parse ID3v2 APIC frame
      // For FLAC: parse picture block
      // For MP4: parse covr atom
      // This is complex, so we'll use a simplified approach:
      // Read the file and use music-metadata's parseBuffer (async) — but we need sync.
      //
      // Alternative: use a simple ID3/FLAC/MP4 picture extractor.
      const ext = path.extname(filePath).toLowerCase();
      const buf = fs.readFileSync(filePath);

      if (ext === '.mp3') {
        return _extractMp3Cover(buf);
      } else if (ext === '.flac') {
        return _extractFlacCover(buf);
      } else if (ext === '.m4a' || ext === '.aac' || ext === '.mp4') {
        return _extractMp4Cover(buf);
      } else if (ext === '.ogg' || ext === '.opus') {
        return _extractOggCover(buf);
      }
    } catch {
      // ignore
    }
    return null;
  }

  // ── Artist splitting ────────────────────────────────────────────────────

  _splitArtists(raw) {
    if (!raw || !raw.trim()) return [];
    let text = raw.trim();

    const seps = this._settings.get('artist_separators', ';') || ';';

    // 处理 feat./ft./vs./with 模式
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

    const sepRegex = new RegExp('[' + seps.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\x00]');
    const parts = text.split(sepRegex);
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

  // ── Library queries ───────────────────────────────────────────────────────

  // ── 库去重：当 Subsonic 和本地同时存在相同歌曲时，优先保留本地版本 ────────

  /**
   * Unicode 兼容性归一化（NFKC）：统一全角/半角、兼容性字符。
   * @param {string} s
   * @returns {string}
   */
  _nfkc(s) {
    try {
      return s.normalize('NFKC');
    } catch {
      return s;
    }
  }

  /**
   * 规范化标题：Unicode 归一化、小写、去括号内容、去 feat./ft. 等后缀、去首尾空格。
   * @param {string} title
   * @returns {string}
   */
  _normalizeTitle(title) {
    if (!title) return '';
    let s = this._nfkc(title).toLowerCase().trim();
    // 去除括号及括号内内容：(xxx) [xxx] {xxx} （含全角括号）
    s = s.replace(/\s*[([（【].*?[)\]）】]\s*/g, ' ');
    // 去除 feat./ft./vs./with 及之后内容
    for (const pat of FEAT_PATTERNS) {
      const idx = s.indexOf(pat);
      if (idx > 0) s = s.slice(0, idx);
    }
    return s.replace(/\s+/g, ' ').trim();
  }

  /**
   * 把艺术家串分割成多个规范化后的艺术家名（用于逐一对齐匹配）。
   * 处理：NFKC 归一化、多艺术家分隔符分割、排序名反转、去冠词。
   * 与展示用的 _splitArtists 不同：此处返回小写、去冠词的规范化形式以构建去重 key。
   * @param {string} artist
   * @returns {string[]}
   */
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
      // 排序名反转（针对单个艺术家部分）："beatles, the" → "the beatles"
      const ci = p.lastIndexOf(',');
      if (ci > 0) {
        const before = p.slice(0, ci).trim();
        const after = p.slice(ci + 1).trim();
        if (before && after && !before.includes(',') && !after.includes(',')) {
          p = (after + ' ' + before).trim();
        }
      }
      // 去前导冠词
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

  /**
   * 为一条曲目生成所有去重匹配 key。
   * key 形式：normalizedTitle \0 normalizedArtist。artist 已分割为多个并逐个比对，
   * album_artist 同样分割纳入，任一命中即视为同一首歌（顺序无关）。
   * @param {{title:string, artist?:string, album_artist?:string}} track
   * @returns {Set<string>}
   */
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

  /**
   * 计算并缓存去重信息。
   * 匹配规则：规范化 title + artist 相同即视为同一首歌。
   * 当本地和 Subsonic 同时存在时，标记 Subsonic 版本为重复（需排除）。
   * @returns {{dupIds: Set<string>, localMap: Map<string, object>}}
   *   dupIds: 需排除的 Subsonic 曲目 ID 集合
   *   localMap: Subsonic 曲目 ID → 对应的本地曲目对象（用于播放时重定向到本地）
   */
  _getDedupInfo() {
    if (this._dedupCache !== null) return this._dedupCache;

    const localRows = this._db.prepare(
      "SELECT id, title, artist, album_artist, path, source FROM tracks WHERE source IS NULL"
    ).all();
    const subsonicRows = this._db.prepare(
      "SELECT id, title, artist, album_artist FROM tracks WHERE source = 'subsonic'"
    ).all();

    if (localRows.length === 0 || subsonicRows.length === 0) {
      this._dedupCache = { dupIds: new Set(), localMap: new Map() };
      return this._dedupCache;
    }

    // 构建本地曲目 key → 本地曲目对象 映射
    const localKeyMap = new Map();
    for (const r of localRows) {
      for (const k of this._trackKeys(r)) {
        if (!localKeyMap.has(k)) localKeyMap.set(k, r);
      }
    }

    // 找出 Subsonic 中与本地重复的曲目，并建立 Subsonic ID → 本地曲目 映射
    const dupIds = new Set();
    const localMap = new Map();
    for (const r of subsonicRows) {
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

  /**
   * 获取需排除的 Subsonic 曲目 ID 集合（兼容旧调用）。
   * @returns {Set<string>}
   */
  _getDuplicateSubsonicIds() {
    return this._getDedupInfo().dupIds;
  }

  /**
   * 查找 Subsonic 曲目对应的本地版本（用于播放时优先使用本地文件）。
   * @param {{id: string, source?: string}} track
   * @returns {object|null} 本地曲目对象，或 null
   */
  findLocalTrackForSubsonic(track) {
    if (!track || track.source !== 'subsonic') return null;
    const { localMap } = this._getDedupInfo();
    return localMap.get(track.id) || null;
  }

  /**
   * 使去重缓存失效（在库内容变更后调用）。
   * 同时清空封面数据缓存，避免删除/移动曲目后返回陈旧数据。
   */
  _invalidateDedupCache() {
    this._dedupCache = null;
    this._dedupLocalPathCache = null;
    if (this._coverDataCache) this._coverDataCache.clear();
  }

  /**
   * 从曲目数组中过滤掉与本地重复的 Subsonic 曲目。
   * @template {{id:string, source?:string}} T
   * @param {T[]} tracks
   * @returns {T[]}
   */
  _dedupeTracks(tracks) {
    const dupIds = this._getDuplicateSubsonicIds();
    if (dupIds.size === 0) return tracks;
    return tracks.filter((t) => !dupIds.has(t.id));
  }

  /**
   * 生成 SQL NOT IN 子句用于排除重复 Subsonic 曲目。
   * 返回 { clause: string, params: string[] }
   */
  _dedupExcludeClause() {
    const dupIds = this._getDuplicateSubsonicIds();
    if (dupIds.size === 0) return { clause: '', params: [] };
    const placeholders = dupIds.size === 1 ? '(?)' : `(${Array.from(dupIds).map(() => '?').join(',')})`;
    return { clause: ` AND id NOT IN ${placeholders}`, params: Array.from(dupIds) };
  }

  getAllTracks() {
    const rows = this._db.prepare('SELECT * FROM tracks ORDER BY added_at').all();
    const tracks = this._dedupeTracks(rows);
    tracks.sort((a, b) => makeSortKey(a.title).localeCompare(makeSortKey(b.title)));
    for (const t of tracks) {
      t.sort_key = makeSortKey(t.title);
      t.sort_letter = makeFirstLetter(t.title);
      t.artist_sort_key = makeSortKey(t.artist);
      t.album_sort_key = makeSortKey(t.album);
      t.artists = this._splitArtists(t.artist);
    }
    return tracks;
  }

  getAlbums() {
    const { clause, params } = this._dedupExcludeClause();
    const rows = this._db.prepare(
      `SELECT album, COALESCE(album_artist, artist, '未知艺术家') AS album_artist,
       year, COUNT(*) AS track_count
       FROM tracks WHERE album IS NOT NULL${clause}
       GROUP BY album, COALESCE(album_artist, artist)`
    ).all(...params);
    const result = [];
    for (const r of rows) {
      const cover = this._db.prepare(
        'SELECT id FROM tracks WHERE album=? AND has_cover=1 LIMIT 1'
      ).get(r.album);
      r.cover_track_id = cover ? cover.id : null;
      result.push(r);
    }
    result.sort((a, b) => makeSortKey(a.album).localeCompare(makeSortKey(b.album)));
    for (const a of result) {
      a.sort_key = makeSortKey(a.album);
      a.sort_letter = makeFirstLetter(a.album);
      a.album_artist_sort_key = makeSortKey(a.album_artist);
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
    artists.sort((a, b) => makeSortKey(a.name).localeCompare(makeSortKey(b.name)));
    for (const a of artists) {
      a.sort_key = makeSortKey(a.name);
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
      `SELECT * FROM tracks WHERE (title LIKE ? OR artist LIKE ? OR album LIKE ?)${clause}
       ORDER BY LOWER(COALESCE(artist,'')), LOWER(COALESCE(album,'')), track_number`
    ).all(q, q, q, ...params);
  }

  getTrack(trackId) {
    return this._db.prepare('SELECT * FROM tracks WHERE id=?').get(trackId) || null;
  }

  updateLyrics(trackId, lyrics) {
    this._db.prepare('UPDATE tracks SET lyrics=? WHERE id=?').run(lyrics, trackId);
  }

  /**
   * 从音频文件中提取内嵌歌词（USLT/©lyr 等标签或侧车 .lrc 文件）。
   * @param {string} trackId
   * @returns {Promise<string|null>}
   */
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

  // ── Liked tracks ──────────────────────────────────────────────────────────

  getLikedTrackIds() {
    const rows = this._db.prepare('SELECT track_id FROM liked_tracks').all();
    return new Set(rows.map((r) => r.track_id));
  }

  setLiked(trackId, liked) {
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
      t.artists = this._splitArtists(t.artist);
    }
    return deduped;
  }

  // ── Play history ──────────────────────────────────────────────────────────

  addPlayHistory(trackId) {
    const now = Date.now() / 1000;
    this._db.prepare(
      'INSERT INTO play_history (track_id, played_at) VALUES (?,?)'
    ).run(trackId, now);
    // 修剪：保留最新 500 条
    this._db.prepare(
      `DELETE FROM play_history WHERE id NOT IN (
        SELECT id FROM play_history ORDER BY played_at DESC LIMIT 500
      )`
    ).run();
  }

  getPlayHistory(limit = 200) {
    const rows = this._db.prepare(
      `SELECT t.*, h.played_at FROM tracks t
       INNER JOIN (
         SELECT track_id, MAX(played_at) AS played_at
         FROM play_history GROUP BY track_id
       ) h ON t.id = h.track_id
       ORDER BY h.played_at DESC LIMIT ?`
    ).all(parseInt(limit, 10));
    const deduped = this._dedupeTracks(rows);
    for (const t of deduped) {
      t.artists = this._splitArtists(t.artist);
    }
    return deduped;
  }

  clearPlayHistory() {
    this._db.prepare('DELETE FROM play_history').run();
  }

  // ── Genre backfill (async, called after init) ────────────────────────────

  async backfillGenres() {
    const rows = this._db.prepare(
      "SELECT id, path FROM tracks WHERE genre IS NULL AND source IS NULL"
    ).all();
    if (rows.length === 0) return;
    const parseFile = await _ensureParseFile();
    if (!parseFile) return;
    let updated = 0;
    for (const row of rows) {
      if (!fs.existsSync(row.path)) continue;
      try {
        const metadata = await parseFile(row.path);
        const g = metadata.common.genre;
        if (g && g.length > 0) {
          this._db.prepare('UPDATE tracks SET genre=? WHERE id=?').run(g[0], row.id);
          updated++;
        }
      } catch { /* ignore */ }
    }
    if (updated > 0) {
      console.log(`[MusicLibrary] Backfilled genre for ${updated} tracks`);
    }
  }

  // ── Play statistics ──────────────────────────────────────────────────────

  getPlayStats() {
    const db = this._db;

    // 总播放次数
    const totalPlays = db.prepare('SELECT COUNT(*) AS c FROM play_history').get().c;

    // 唯一曲目数
    const uniqueTracks = db.prepare('SELECT COUNT(DISTINCT track_id) AS c FROM play_history').get().c;

    // 总播放时长（每次播放的曲目时长之和）
    const totalDurationRow = db.prepare(
      `SELECT COALESCE(SUM(t.duration_ms), 0) AS d
       FROM play_history h JOIN tracks t ON t.id = h.track_id`
    ).get();
    const totalDurationMs = totalDurationRow ? totalDurationRow.d : 0;

    // 最近 7 天每日播放数
    const sevenDaysAgo = (Date.now() / 1000) - (7 * 24 * 3600);
    const dailyRows = db.prepare(
      `SELECT date(h.played_at, 'unixepoch', 'localtime') AS day, COUNT(*) AS c
       FROM play_history h
       WHERE h.played_at >= ?
       GROUP BY day ORDER BY day ASC`
    ).all(sevenDaysAgo);
    const dailyActivity = dailyRows.map(r => ({ day: r.day, count: r.c }));

    // Top 5 艺术家（按播放次数）
    const topArtists = db.prepare(
      `SELECT t.artist AS name, COUNT(*) AS play_count, COUNT(DISTINCT t.id) AS track_count
       FROM play_history h JOIN tracks t ON t.id = h.track_id
       WHERE t.artist IS NOT NULL AND t.artist != ''
       GROUP BY t.artist ORDER BY play_count DESC LIMIT 5`
    ).all();

    // Top 5 专辑（按播放次数）
    const topAlbums = db.prepare(
      `SELECT t.album AS name, t.album_artist AS artist, COUNT(*) AS play_count, COUNT(DISTINCT t.id) AS track_count
       FROM play_history h JOIN tracks t ON t.id = h.track_id
       WHERE t.album IS NOT NULL AND t.album != ''
       GROUP BY t.album ORDER BY play_count DESC LIMIT 5`
    ).all();

    // 最近播放时间
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

  // ── Daily Mixes ───────────────────────────────────────────────────────────

  getDailyMixes() {
    const db = this._db;
    const mixes = [];
    const { clause, params } = this._dedupExcludeClause();

    // Top 3 艺术家
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

    // Top 2 流派
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

    // Top 2 专辑
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

    // 交错排列：artist, genre, album, artist, genre, album, artist
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

  // ── Playlists ─────────────────────────────────────────────────────────────

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
    // 重新整理 position
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
      t.artists = this._splitArtists(t.artist);
    }
    return rows;
  }

  // 返回 { playlistId: [trackId, ...] } 映射，用于前端排除筛选
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

  // ── Subsonic sources ─────────────────────────────────────────────────────

  // Remote methods to be added

  // Remote Playlists (Subsonic)

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

  // 返回某服务器下已有远程歌单的 {id, remote_id} 列表，用于同步 diff
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

  /**
   * 将本地 track ID 列表中属于指定 Subsonic 服务器的曲目映射为 Subsonic 服务器端 ID。
   * 不属于该服务器的曲目会被跳过（本地曲目或其他服务器的曲目）。
   * @param {string[]} trackIds - 本地 track ID 列表
   * @param {number} serverId - Subsonic 服务器 ID
   * @returns {{subsonicIds: string[], skipped: string[]}}
   */
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

  // Cover colors
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
    // 兜底：删除 server_id 为 NULL 但来源为 subsonic 且路径匹配的遗留曲目
    this._deleteTracksByCondition(
      "server_id IS NULL AND source='subsonic' AND path LIKE ?",
      `subsonic://${sid}/%`
    );
    this._db.prepare('DELETE FROM subsonic_sources WHERE id=?').run(sid);
    // 清理封面缓存目录
    try {
      const cacheDir = path.join(this._subsonicCoverCacheDir(), String(sid));
      if (fs.existsSync(cacheDir)) {
        fs.rmSync(cacheDir, { recursive: true, force: true });
      }
    } catch {
      // ignore
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

  // ── Subsonic 曲目索引 ───────────────────────────────────────────────────

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
        // 新曲目：使用 INSERT OR IGNORE（不触发级联删除）
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
        // 已存在曲目：使用 UPDATE，避免 INSERT OR REPLACE 触发级联删除
        // 保留 liked_tracks / play_history / playlist_tracks 关联数据
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

  /**
   * 删除指定 Subsonic 服务器中不再存在于服务器端的曲目（增量清理）。
   * 与 deleteSubsonicTracks（全删重建）不同，此方法仅删除真正消失的曲目，
   * 保留仍然存在曲目的 liked_tracks / play_history / playlist_tracks 关联数据。
   * @param {number} serverId - Subsonic 服务器 ID
   * @param {Set<string>} liveSubIds - 服务器端仍存在的 subsonic_id 集合
   */
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

  /**
   * 删除满足条件的曲目及其所有关联数据（收藏、播放历史、歌单引用）。
   * 不依赖外键级联，确保数据一致性。
   * @param {string} where - SQL WHERE 子句（不含 WHERE 关键字）
   * @param  {...any} params - 绑定参数
   */
  _deleteTracksByCondition(where, ...params) {
    const tx = this._db.transaction(() => {
      // 收集待删除的 track ID
      const ids = this._db.prepare(`SELECT id FROM tracks WHERE ${where}`).all(...params).map((r) => r.id);
      if (ids.length === 0) return;

      const placeholders = ids.map(() => '?').join(',');
      // 删除关联数据
      this._db.prepare(`DELETE FROM liked_tracks WHERE track_id IN (${placeholders})`).run(...ids);
      this._db.prepare(`DELETE FROM play_history WHERE track_id IN (${placeholders})`).run(...ids);
      this._db.prepare(`DELETE FROM playlist_tracks WHERE track_id IN (${placeholders})`).run(...ids);
      // 删除曲目
      this._db.prepare(`DELETE FROM tracks WHERE id IN (${placeholders})`).run(...ids);
    });
    tx();
    this._invalidateDedupCache();
  }

  commit() {
    // better-sqlite3 is auto-commit per statement; no-op for compatibility
  }

  // ── Subsonic 服务器侧资源获取 ───────────────────────────────────────────

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

    // 1) 本地缓存命中
    const cached = this.readSubsonicCoverCache(serverId, coverId);
    if (cached) return cached;

    // 2) 缓存未命中：代理获取
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

  // ── Subsonic 封面本地缓存 ────────────────────────────────────────────────

  _subsonicCoverCacheDir() {
    return path.join(this._settings.dataDir, 'subsonic_covers');
  }

  getSubsonicCoverCachePath(serverId, coverId, size) {
    // size 不同时使用独立的缓存文件，避免不同尺寸互相覆盖；
    // 不传 size 时保持原有哈希（向后兼容旧缓存）。
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
      // ignore
    }
  }

  close() {
    if (this._closed) return;
    this._closed = true;
    try { this._db.close(); } catch { /* ignore */ }
  }
}

// ── 同步封面提取辅助函数 ─────────────────────────────────────────────────────
// 由于 better-sqlite3 是同步的，但 music-metadata 是异步的，
// 我们需要同步的方式从音频文件中提取封面。

function _extractMp3Cover(buf) {
  // ID3v2 标签解析
  if (buf.length < 10) return null;
  if (buf[0] !== 0x49 || buf[1] !== 0x44 || buf[2] !== 0x33) return null; // 'ID3'

  const version = buf[3];
  const flags = buf[5];
  let headerSize = 10;

  // 同步安全整数
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
      // APIC frame: encoding(1) + mime(0-terminated) + pictureType(1) + description + data
      let offset = frameDataStart;
      const encoding = buf[offset++];
      // MIME type (null-terminated ASCII)
      let mimeEnd = offset;
      while (mimeEnd < frameDataStart + frameSize && buf[mimeEnd] !== 0) mimeEnd++;
      offset = mimeEnd + 1;
      // Picture type (1 byte)
      if (offset >= frameDataStart + frameSize) break;
      offset++; // skip picture type
      // Description (encoding-dependent, null-terminated)
      if (encoding === 1 || encoding === 2) {
        // UTF-16: null-terminated with 2 bytes
        while (offset < frameDataStart + frameSize - 1) {
          if (buf[offset] === 0 && buf[offset + 1] === 0) { offset += 2; break; }
          offset += 2;
        }
      } else {
        while (offset < frameDataStart + frameSize && buf[offset] !== 0) offset++;
        offset++;
      }
      // Rest is picture data
      const picData = buf.slice(offset, frameDataStart + frameSize);
      if (picData.length > 0) return picData;
    }
    pos = frameDataStart + frameSize;
  }
  return null;
}

function _extractFlacCover(buf) {
  // FLAC: 'fLaC' + metadata blocks
  if (buf.length < 4) return null;
  if (buf[0] !== 0x66 || buf[1] !== 0x4c || buf[2] !== 0x61 || buf[3] !== 0x43) return null;

  let pos = 4;
  while (pos < buf.length - 4) {
    const blockType = buf[pos] & 0x7f;
    const isLast = (buf[pos] & 0x80) !== 0;
    const blockLength = (buf[pos + 1] << 16) | (buf[pos + 2] << 8) | buf[pos + 3];
    pos += 4;

    if (blockType === 6) {
      // PICTURE block
      if (pos + blockLength > buf.length) return null;
      // pictureType(4) + mimeLen(4) + mime + descLen(4) + desc + width(4) + height(4) + colorDepth(4) + colors(4) + dataLen(4) + data
      let offset = pos;
      offset += 4; // picture type
      const mimeLen = buf.readUInt32BE(offset);
      offset += 4 + mimeLen;
      const descLen = buf.readUInt32BE(offset);
      offset += 4 + descLen;
      offset += 16; // width, height, colorDepth, colors
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
  // MP4/M4A: find 'covr' atom
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

  // 递归搜索 ilst/covr
  function searchCovr(data, start, end, depth) {
    if (depth > 6) return null;
    let pos = start;
    while (pos < end - 8) {
      const size = data.readUInt32BE(pos);
      const name = data.toString('ascii', pos + 4, pos + 8);
      if (size < 8 || pos + size > end) break;
      if (name === 'covr') {
        // covr atom: size(4) + 'covr'(4) + data
        // data format: 4 bytes flags (version + flags), then picture data
        const dataStart = pos + 8;
        const dataEnd = pos + size;
        // Check for nested 'data' atom
        const dataAtomPos = findAtom(data, dataStart, dataEnd, 'data');
        if (dataAtomPos >= 0) {
          const dataSize = data.readUInt32BE(dataAtomPos);
          // data atom: size(4) + 'data'(4) + flags(4) + reserved(4) + data
          const picStart = dataAtomPos + 16;
          const picEnd = dataAtomPos + dataSize;
          if (picEnd <= data.length) return data.slice(picStart, picEnd);
        }
        // Fallback: raw data after 'covr'
        return data.slice(dataStart, dataEnd);
      }
      // Recurse into container atoms
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
  // OGG/Opus: look for metadata_block_picture in base64
  const str = buf.toString('latin1');
  const marker = 'metadata_block_picture=';
  const idx = str.indexOf(marker);
  if (idx < 0) return null;

  // Extract base64 until newline or null
  let end = idx + marker.length;
  while (end < str.length && str[end] !== '\n' && str[end] !== '\r' && str[end] !== '\0') end++;
  const b64 = str.slice(idx + marker.length, end);

  try {
    const decoded = Buffer.from(b64, 'base64');
    // FLAC Picture structure in OGG
    // pictureType(4) + mimeLen(4) + mime + descLen(4) + desc + width(4) + height(4) + colorDepth(4) + colors(4) + dataLen(4) + data
    if (decoded.length < 32) return null;
    let offset = 0;
    offset += 4; // picture type
    const mimeLen = decoded.readUInt32BE(offset);
    offset += 4 + mimeLen;
    const descLen = decoded.readUInt32BE(offset);
    offset += 4 + descLen;
    offset += 16; // width, height, colorDepth, colors
    const dataLen = decoded.readUInt32BE(offset);
    offset += 4;
    if (offset + dataLen > decoded.length) return null;
    return decoded.slice(offset, offset + dataLen);
  } catch {
    return null;
  }
}

module.exports = { MusicLibrary, trackId, subsonicTrackId, SUPPORTED_EXT };
