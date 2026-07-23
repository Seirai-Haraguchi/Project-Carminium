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
    this._db.exec(CREATE_SQL);
    this._migrateSchema();
    this._closed = false;
  }

  // ── Schema migration ─────────────────────────────────────────────────────

  _migrateSchema() {
    const tryAlter = (sql) => {
      try { this._db.exec(sql); } catch { /* already exists */ }
    };
    tryAlter('ALTER TABLE tracks ADD COLUMN lyrics TEXT');
    for (const [col, def] of [['created_at', '0'], ['updated_at', '0']]) {
      tryAlter(`ALTER TABLE playlists ADD COLUMN ${col} REAL NOT NULL DEFAULT ${def}`);
    }
    for (const col of ['source', 'server_id', 'subsonic_id', 'cover_id', 'suffix']) {
      tryAlter(`ALTER TABLE tracks ADD COLUMN ${col} TEXT`);
    }

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
    const p = path.resolve(folderPath);
    const fid = this._folderId(p);
    if (fid !== null) {
      this._deleteTracksByCondition('folder_id=?', fid);
    }
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
        const tid = trackId(filePath);
        const stat = fs.statSync(filePath);
        this._db.prepare(
          `INSERT OR REPLACE INTO tracks
           (id, path, folder_id, title, artist, album, album_artist,
            track_number, disc_number, year, duration_ms, file_size,
            has_cover, lyrics, added_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
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
          stat.size,
          meta.has_cover ? 1 : 0,
          meta.lyrics || null,
          now
        );
        inserted++;
      } catch (e) {
        console.error(`[MusicLibrary] Failed to insert track: ${filePath}`, e.message || e);
      }
    }
    this._db.prepare('UPDATE folders SET last_scan=? WHERE id=?').run(now, fid);
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
    const row = this._db.prepare('SELECT path, source FROM tracks WHERE id=?').get(trackId);
    if (!row) return null;
    if (row.source === 'subsonic') return null;
    if (!row.path) return null;
    return this._extractCoverSync(row.path);
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

  getAllTracks() {
    const rows = this._db.prepare('SELECT * FROM tracks ORDER BY added_at').all();
    const tracks = rows;
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
    const rows = this._db.prepare(
      `SELECT album, COALESCE(album_artist, artist, '未知艺术家') AS album_artist,
       year, COUNT(*) AS track_count
       FROM tracks WHERE album IS NOT NULL
       GROUP BY album, COALESCE(album_artist, artist)`
    ).all();
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
    const rows = this._db.prepare('SELECT id, artist, album, has_cover FROM tracks').all();
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
    if (albumArtist) {
      return this._db.prepare(
        `SELECT * FROM tracks WHERE album=? AND COALESCE(album_artist,artist)=?
         ORDER BY disc_number, track_number`
      ).all(album, albumArtist);
    }
    return this._db.prepare(
      'SELECT * FROM tracks WHERE album=? ORDER BY disc_number, track_number'
    ).all(album);
  }

  getArtistTracks(artist) {
    const rows = this._db.prepare(
      `SELECT * FROM tracks ORDER BY LOWER(COALESCE(album,'')), disc_number, track_number`
    ).all();
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
    return this._db.prepare(
      `SELECT * FROM tracks WHERE title LIKE ? OR artist LIKE ? OR album LIKE ?
       ORDER BY LOWER(COALESCE(artist,'')), LOWER(COALESCE(album,'')), track_number`
    ).all(q, q, q);
  }

  getTrack(trackId) {
    return this._db.prepare('SELECT * FROM tracks WHERE id=?').get(trackId) || null;
  }

  updateLyrics(trackId, lyrics) {
    this._db.prepare('UPDATE tracks SET lyrics=? WHERE id=?').run(lyrics, trackId);
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
    for (const t of rows) {
      t.artists = this._splitArtists(t.artist);
    }
    return rows;
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
    for (const t of rows) {
      t.artists = this._splitArtists(t.artist);
    }
    return rows;
  }

  clearPlayHistory() {
    this._db.prepare('DELETE FROM play_history').run();
  }

  // ── Playlists ─────────────────────────────────────────────────────────────

  getPlaylists() {
    return this._db.prepare(
      `SELECT p.id, p.name, p.created_at, p.updated_at,
       (SELECT COUNT(*) FROM playlist_tracks pt WHERE pt.playlist_id=p.id) AS track_count
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

  // ── Subsonic sources ─────────────────────────────────────────────────────

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
    for (const s of songs) {
      const subId = s.id;
      if (!subId) continue;
      const tid = subsonicTrackId(serverIdInt, subId);
      const existed = this._db.prepare('SELECT 1 FROM tracks WHERE id=? LIMIT 1').get(tid) !== undefined;
      const syntheticPath = `subsonic://${serverIdInt}/${subId}`;
      this._db.prepare(
        `INSERT OR REPLACE INTO tracks
         (id, path, folder_id, title, artist, album, album_artist,
          track_number, disc_number, year, duration_ms, file_size,
          has_cover, lyrics, added_at,
          source, server_id, subsonic_id, cover_id, suffix)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
      ).run(
        tid, syntheticPath, null,
        s.title, s.artist, s.album, s.album_artist,
        s.track_number, s.disc_number, s.year, s.duration_ms, s.size || 0,
        s.cover_art_id ? 1 : 0, null, Date.now() / 1000,
        'subsonic', serverIdInt, subId, s.cover_art_id, s.suffix
      );
      if (!existed) inserted++;
    }
    return inserted;
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

  getSubsonicCoverCachePath(serverId, coverId) {
    const safe = crypto.createHash('sha1').update(coverId, 'utf-8').digest('hex');
    return path.join(this._subsonicCoverCacheDir(), String(parseInt(serverId, 10)), `${safe}.bin`);
  }

  readSubsonicCoverCache(serverId, coverId) {
    const p = this.getSubsonicCoverCachePath(serverId, coverId);
    if (!fs.existsSync(p)) return null;
    try { return fs.readFileSync(p); } catch { return null; }
  }

  writeSubsonicCoverCache(serverId, coverId, data) {
    const p = this.getSubsonicCoverCachePath(serverId, coverId);
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

module.exports = { MusicLibrary, trackId, subsonicTrackId };
