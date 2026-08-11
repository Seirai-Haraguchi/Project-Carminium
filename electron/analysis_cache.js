/**
 * AnalysisCache — 音轨分析结果缓存层
 *
 * 将 TrackAnalyzer 和 OsuBeatmapProvider 的分析结果持久化到磁盘，
 * 避免每次播放都重新分析。内存 Map 提供快速访问，JSON 文件提供跨会话持久化。
 *
 * 缓存键：trackId（本地: sha1(path)[:16]，Subsonic: s<serverId>_<subId>）
 * 缓存值：{ bpm, energy, introEndMs, outroStartMs, climaxMs, durationMs, osu, analyzedAt }
 *
 * 防御性设计：
 *   - 文件损坏时自动备份并重建
 *   - 保存操作 debounce + 原子写入（临时文件 + rename）
 *   - 最大缓存条目数限制，LRU 淘汰
 *   - 持久化失败不影响播放
 */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const MAX_ENTRIES = 2000;          // 收紧至 2000 条（原 5000），降低主进程内存占用
const SAVE_DEBOUNCE_MS = 2000;     // 保存防抖间隔
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB 安全上限

class AnalysisCache {
  constructor() {
    this._cache = new Map();        // trackId → analysis result
    this._saveTimer = null;
    this._dirty = false;

    // プラットフォーム標準の構成ディレクトリを使用
    let configDir;
    try {
      const { app } = require('electron');
      if (app && app.getPath) {
        configDir = app.getPath('userData');
      }
    } catch { /* electron not available */ }
    if (!configDir) {
      if (process.platform === 'win32') {
        configDir = path.join(process.env.APPDATA || os.homedir(), 'Carminium');
      } else if (process.platform === 'darwin') {
        configDir = path.join(os.homedir(), 'Library', 'Application Support', 'Carminium');
      } else {
        configDir = path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'Carminium');
      }
    }
    this._dir = configDir;
    this._path = path.join(this._dir, 'track_analysis.json');

    try {
      fs.mkdirSync(this._dir, { recursive: true });
    } catch {
      // 目录创建失败不影响内存缓存
    }

    this._load();
  }

  // ── 公共 API ──────────────────────────────────────────────────────────

  /**
   * 获取缓存的分析结果。
   * @param {string} trackId
   * @returns {object|null} 分析结果，或 null（未缓存）
   */
  get(trackId) {
    if (!trackId) return null;
    const data = this._cache.get(trackId);
    if (!data) return null;

    // 验证缓存的完整性
    if (!this._isValid(data)) {
      this._cache.delete(trackId);
      return null;
    }

    return data;
  }

  /**
   * 检查是否有缓存（不验证）。
   */
  has(trackId) {
    return this._cache.has(trackId);
  }

  /**
   * 设置分析结果并标记为脏（稍后保存）。
   * @param {string} trackId
   * @param {object} analysis - 分析结果
   */
  set(trackId, analysis) {
    if (!trackId || !analysis) return;

    // LRU 淘汰
    if (this._cache.size >= MAX_ENTRIES && !this._cache.has(trackId)) {
      const oldestKey = this._cache.keys().next().value;
      this._cache.delete(oldestKey);
    }

    this._cache.set(trackId, analysis);
    this._dirty = true;
    this._scheduleSave();
  }

  /**
   * 删除缓存条目。
   */
  delete(trackId) {
    if (this._cache.delete(trackId)) {
      this._dirty = true;
      this._scheduleSave();
    }
  }

  /**
   * 强制立即保存（用于应用退出前）。
   * 終了時は同期的に保存し、プロセス終了前に確実に永続化する。
   * （_save の非同期版だとプロセス終了前に保存が完了せず、
   *   .tmp ファイルが残って次回起動時に破損扱いになるリスクがある）
   */
  flush() {
    if (this._saveTimer) {
      clearTimeout(this._saveTimer);
      this._saveTimer = null;
    }
    if (!this._dirty) return;
    this._dirty = false;

    const obj = {};
    for (const [key, value] of this._cache) {
      obj[key] = value;
    }
    try {
      const data = JSON.stringify(obj);
      if (data.length > MAX_FILE_SIZE) {
        console.warn('[AnalysisCache] Cache too large to flush, skipping:', data.length);
        return;
      }
      const tmpPath = this._path + '.tmp';
      fs.writeFileSync(tmpPath, data, 'utf8');
      fs.renameSync(tmpPath, this._path);
    } catch (e) {
      console.error('[AnalysisCache] Flush save failed:', e.message);
      this._dirty = true;
    }
  }

  // ── 内部：加载 ────────────────────────────────────────────────────────

  _load() {
    try {
      const stat = fs.statSync(this._path);
      if (stat.size > MAX_FILE_SIZE) {
        console.warn('[AnalysisCache] Cache file too large, skipping load:', stat.size);
        return;
      }

      const raw = fs.readFileSync(this._path, 'utf8');
      const parsed = JSON.parse(raw);

      if (!parsed || typeof parsed !== 'object') {
        console.warn('[AnalysisCache] Invalid cache format, starting fresh');
        return;
      }

      // 从对象恢复到 Map（保持插入顺序）
      const entries = Object.entries(parsed);
      for (const [key, value] of entries) {
        if (this._isValid(value)) {
          this._cache.set(key, value);
        }
      }

      console.log('[AnalysisCache] Loaded', this._cache.size, 'entries');
    } catch (e) {
      if (e.code === 'ENOENT') return; // 文件不存在，正常

      // 文件损坏，备份后重建
      console.warn('[AnalysisCache] Cache file corrupted, backing up and rebuilding:', e.message);
      try {
        fs.renameSync(this._path, this._path + '.bak');
      } catch {
        // 备份失败也继续，内存缓存从空开始
      }
    }
  }

  // ── 内部：保存 ────────────────────────────────────────────────────────

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

    // 序列化为普通对象
    const obj = {};
    for (const [key, value] of this._cache) {
      obj[key] = value;
    }

    let data;
    try {
      data = JSON.stringify(obj);
    } catch (e) {
      console.error('[AnalysisCache] Serialize failed:', e.message);
      this._dirty = true;
      return;
    }
    if (data.length > MAX_FILE_SIZE) {
      console.warn('[AnalysisCache] Cache too large to save, skipping:', data.length);
      return;
    }

    // 非同期で原子書き込み（臨時ファイル → rename）
    // 以前は writeFileSync + renameSync で同期保存していたが、
    // これがメインプロセスのイベントループをブロックし、
    // 定期保存（debounce 2s）のたびに音切れリスクがあった。
    // fs.promises は libuv スレッドプールに I/O を逃がすため安全。
    // 終了時の確実な永続化は flush() で同期版を使う。
    const tmpPath = this._path + '.tmp';
    fs.promises.writeFile(tmpPath, data, 'utf8')
      .then(() => fs.promises.rename(tmpPath, this._path))
      .catch((e) => {
        console.error('[AnalysisCache] Save failed:', e.message);
        // 保存失败不影响运行，下次再试
        this._dirty = true;
      });
  }

  // ── 内部：验证 ────────────────────────────────────────────────────────

  _isValid(data) {
    if (!data || typeof data !== 'object') return false;
    if (typeof data.durationMs !== 'number' || data.durationMs <= 0) return false;
    if (typeof data.analyzedAt !== 'number' || data.analyzedAt <= 0) return false;
    // energy 可选（Subsonic 可能只有 osu 数据）
    if (data.energy !== undefined && !Array.isArray(data.energy)) return false;
    // BPM 范围校验：旧版本缓存中 BPM_MAX=200 导致大量误检，
    // 新版本 BPM 范围为 60-180，超出范围的缓存视为无效并重新分析
    if (typeof data.bpm === 'number' && data.bpm > 0) {
      if (data.bpm < 60 || data.bpm > 180) return false;
    }
    return true;
  }
}

module.exports = { AnalysisCache };
