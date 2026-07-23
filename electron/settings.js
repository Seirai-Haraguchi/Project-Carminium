/**
 * Carminium — 应用设置持久化
 * 将设置存储为 JSON 文件，位于 %APPDATA%/Carminium/settings.json
 */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const DEFAULTS = {
  volume: 80,
  shuffle: false,
  repeat: 'off',      // "off" | "all" | "one"
  theme: 'system',    // "light" | "dark" | "system"
  music_folders: [],
  playback_state: {}, // { track_id, position_ms, was_playing }
  audio_api: 'wasapi',
  audio_output_device: '',
  wasapi_exclusive: false,
  automix: false,
  gapless: false,
  lyrics_progressive_blur: false,
  lyrics_center: false,
  lyrics_font_size: 16,
  lyrics_font: '',
  lyrics_jp_font: '',
  lyrics_jp_use_distinct: false,
  resume_playback: false,
  circular_cover: false,
  wave_progress: true,
  ui_font: '',
  color_scheme: 'tonal_spot',
  window_beat_shake: false,
  smtc_lyrics: false,
  artist_separators: ';',
  shortcuts: {
    play_pause: 'Space',
    next_track: 'MediaTrackNext',
    prev_track: 'MediaTrackPrevious',
    volume_up: 'Ctrl+ArrowUp',
    volume_down: 'Ctrl+ArrowDown',
    toggle_like: 'Ctrl+l',
    toggle_mute: 'Ctrl+m',
  },
};

class AppSettings {
  constructor() {
    const appdata = process.env.APPDATA || os.homedir();
    this._dir = path.join(appdata, 'Carminium');
    this._path = path.join(this._dir, 'settings.json');
    try {
      fs.mkdirSync(this._dir, { recursive: true });
    } catch {
      // ignore
    }
    this._data = { ...DEFAULTS };
    this._load();
  }

  // ── I/O ──────────────────────────────────────────────────────────────────

  _load() {
    try {
      if (fs.existsSync(this._path)) {
        const raw = fs.readFileSync(this._path, 'utf-8');
        const stored = JSON.parse(raw);
        Object.assign(this._data, stored);
      }
    } catch (e) {
      // File corrupted: rename to .bak so settings aren't silently lost
      try {
        const bak = this._path + '.bak';
        if (fs.existsSync(bak)) fs.unlinkSync(bak);
        fs.renameSync(this._path, bak);
      } catch {
        // ignore
      }
    }
  }

  save() {
    const tmp = this._path + '.tmp';
    try {
      fs.writeFileSync(tmp, JSON.stringify(this._data, null, 2), 'utf-8');
      fs.renameSync(tmp, this._path);
    } catch (e) {
      try {
        if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
      } catch {
        // ignore
      }
      throw e;
    }
  }

  // ── Access ────────────────────────────────────────────────────────────────

  get(key, defaultVal) {
    return key in this._data ? this._data[key] : defaultVal;
  }

  set(key, value) {
    this._data[key] = value;
    this.save();
  }

  update(data) {
    Object.assign(this._data, data);
    this.save();
  }

  all() {
    return { ...this._data };
  }

  // ── Paths ─────────────────────────────────────────────────────────────────

  get dataDir() {
    return this._dir;
  }
}

module.exports = { AppSettings, DEFAULTS };
