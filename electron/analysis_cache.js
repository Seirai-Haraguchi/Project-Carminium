'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const MAX_ENTRIES = 2000;
const SAVE_DEBOUNCE_MS = 2000;
const MAX_FILE_SIZE = 50 * 1024 * 1024;

class AnalysisCache {
  constructor() {
    this._cache = new Map();
    this._saveTimer = null;
    this._dirty = false;

    let configDir;
    try {
      const { app } = require('electron');
      if (app && app.getPath) {
        configDir = app.getPath('userData');
      }
    } catch {  }
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
    }

    this._load();
  }


  get(trackId) {
    if (!trackId) return null;
    const data = this._cache.get(trackId);
    if (!data) return null;

    if (!this._isValid(data)) {
      this._cache.delete(trackId);
      return null;
    }

    return data;
  }

  has(trackId) {
    return this._cache.has(trackId);
  }

  set(trackId, analysis) {
    if (!trackId || !analysis) return;

    if (this._cache.size >= MAX_ENTRIES && !this._cache.has(trackId)) {
      const oldestKey = this._cache.keys().next().value;
      this._cache.delete(oldestKey);
    }

    this._cache.set(trackId, analysis);
    this._dirty = true;
    this._scheduleSave();
  }

  delete(trackId) {
    if (this._cache.delete(trackId)) {
      this._dirty = true;
      this._scheduleSave();
    }
  }

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

      const entries = Object.entries(parsed);
      for (const [key, value] of entries) {
        if (this._isValid(value)) {
          this._cache.set(key, value);
        }
      }

      console.log('[AnalysisCache] Loaded', this._cache.size, 'entries');
    } catch (e) {
      if (e.code === 'ENOENT') return;

      console.warn('[AnalysisCache] Cache file corrupted, backing up and rebuilding:', e.message);
      try {
        fs.renameSync(this._path, this._path + '.bak');
      } catch {
      }
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

    const tmpPath = this._path + '.tmp';
    fs.promises.writeFile(tmpPath, data, 'utf8')
      .then(() => fs.promises.rename(tmpPath, this._path))
      .catch((e) => {
        console.error('[AnalysisCache] Save failed:', e.message);
        this._dirty = true;
      });
  }


  _isValid(data) {
    if (!data || typeof data !== 'object') return false;
    if (typeof data.durationMs !== 'number' || data.durationMs <= 0) return false;
    if (typeof data.analyzedAt !== 'number' || data.analyzedAt <= 0) return false;
    if (data.energy !== undefined && !Array.isArray(data.energy)) return false;
    if (typeof data.bpm === 'number' && data.bpm > 0) {
      if (data.bpm < 60 || data.bpm > 180) return false;
    }
    return true;
  }
}

module.exports = { AnalysisCache };
