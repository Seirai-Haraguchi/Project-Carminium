'use strict';
/*
 * TrackProfile 持久化（SQLite，与 library.db 同库同连接）。
 *
 * 为什么不再用 track_analysis.json：
 * - 单文件 JSON 每次写入要全量序列化 2000 条，且没有版本/哈希概念（换算法不会失效）；
 * - 现在一个 4 分钟曲目的 profile 是 10–16KB，2000 首约 20–30MB；
 * - profile 里全是数字数组，JSON 体积虚高，这里 deflate 后再存 BLOB（约 3–5× 压缩）。
 *
 * 失效规则（唯一真相源）：
 *   valid ⇔ row.version === version && row.source_hash === hash
 * version：分析算法版本（web/analysis/analyzer.js 的 PROFILE_VERSION）
 * hash：文件指纹 size:mtimeMs:codec（内容换了或重压了就一定变）
 */
const zlib = require('zlib');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS track_profiles (
  track_id    TEXT PRIMARY KEY,
  version     INTEGER NOT NULL,
  source_hash TEXT NOT NULL,
  analyzed_at REAL NOT NULL,
  cost_ms     INTEGER,
  bytes       INTEGER,
  payload     BLOB NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_track_profiles_version ON track_profiles(version);
`;

class ProfileStore {
  constructor(db) {
    this._db = db;
    this._db.exec(SCHEMA);
    this._get = this._db.prepare(
      'SELECT version, source_hash, analyzed_at, payload FROM track_profiles WHERE track_id = ?'
    );
    this._put = this._db.prepare(
      `INSERT INTO track_profiles (track_id, version, source_hash, analyzed_at, cost_ms, bytes, payload)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(track_id) DO UPDATE SET
         version=excluded.version, source_hash=excluded.source_hash, analyzed_at=excluded.analyzed_at,
         cost_ms=excluded.cost_ms, bytes=excluded.bytes, payload=excluded.payload`
    );
    this._del = this._db.prepare('DELETE FROM track_profiles WHERE track_id = ?');
    this._count = this._db.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(bytes),0) AS b FROM track_profiles');
    this._countVersion = this._db.prepare('SELECT COUNT(*) AS n FROM track_profiles WHERE version = ?');
    this._prune = this._db.prepare('DELETE FROM track_profiles WHERE version <> ?');
  }

  /**
   * @returns {null | {profile: object, version: number, hash: string, stale: boolean}}
   * stale=true 表示有旧版本条目但当前版本不匹配（调用方应重算并覆盖）
   */
  get(trackId, version, hash) {
    if (!trackId) return null;
    let row;
    try {
      row = this._get.get(trackId);
    } catch (e) {
      console.warn('[ProfileStore] get failed:', e.message);
      return null;
    }
    if (!row) return null;
    const versionOk = Number(row.version) === Number(version);
    const hashOk = !hash || row.source_hash === hash;
    if (!versionOk || !hashOk) return { profile: null, version: row.version, hash: row.source_hash, stale: true };
    try {
      const json = zlib.inflateRawSync(row.payload).toString('utf8');
      return { profile: JSON.parse(json), version: row.version, hash: row.source_hash, stale: false };
    } catch (e) {
      console.warn('[ProfileStore] corrupt payload, dropping:', trackId, e.message);
      this.delete(trackId);
      return null;
    }
  }

  set(trackId, version, hash, costMs, profile) {
    if (!trackId || !profile) return false;
    try {
      const json = JSON.stringify(profile);
      const buf = zlib.deflateRawSync(Buffer.from(json, 'utf8'));
      this._put.run(
        trackId, Number(version) || 1, String(hash || ''), Date.now(),
        Math.round(costMs || 0), buf.length, buf
      );
      return true;
    } catch (e) {
      console.warn('[ProfileStore] set failed:', e.message);
      return false;
    }
  }

  delete(trackId) {
    try { this._del.run(trackId); } catch {  }
  }

  stats() {
    try {
      const r = this._count.get();
      return { entries: r.n, bytes: r.b };
    } catch {
      return { entries: 0, bytes: 0 };
    }
  }

  countVersion(version) {
    try { return this._countVersion.get(Number(version) || 1).n; } catch { return 0; }
  }

  /** 升级分析算法后清掉旧版本（避免旧 profile 永久占空间） */
  pruneOtherVersions(version) {
    try { return this._prune.run(Number(version) || 1).changes; } catch { return 0; }
  }
}

module.exports = { ProfileStore, SCHEMA };
