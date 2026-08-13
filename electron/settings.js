/**
 * Carminium — 应用设置持久化
 * 将设置存储为 JSON 文件，位于平台标准配置目录：
 *   Windows: %APPDATA%/Carminium/settings.json
 *   Linux:   ~/.config/Carminium/settings.json  (XDG_CONFIG_HOME)
 *   macOS:   ~/Library/Application Support/Carminium/settings.json
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
  audio_output_device: '',
  wasapi_exclusive: false,
  automix: false,
  radical_transitions: false,
  gapless: false,
  lyrics_progressive_blur: false,
  lyrics_center: false,
  lyrics_font_size: 16,
  lyrics_font: '',
  lyrics_jp_font: '',
  lyrics_jp_use_distinct: false,
  lyrics_credit_filters: '作词,作曲,编曲,和声,对唱,配唱制作人,钢琴,吉他,鼓,贝斯,制作人,制作,混音,混音师,混音室,母带,录音,录音师,录音室,监制,策划,发行,词曲,填词,谱曲,OP,ED,SP',
  resume_playback: false,
  circular_cover: false,
  wave_progress: true,
  video_background: false,
  ui_font: '',
  color_scheme: 'tonal_spot',
  monet_source: 'album_cover',  // "album_cover" | "system_wallpaper"
  language: 'zh-CN',  // "zh-CN" | "zh-TW" | "ja" | "en" | "ru"
  smtc_lyrics: false,
  artist_separators: ';',
  tag_editor_path: '',          // 外部音乐标签编辑应用路径（如 Mp3tag）
  eq_enabled: false,
  eq_bands: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  dynamic_bass: false,
  compressor_enabled: false,
  vocal_enhance: false,
  guitar_friendly: false,
  onboarding_complete: false,   // 新手引导是否已完成
  // 内存优化等级: 'off' | 'normal' | 'aggressive'
  //   off       — 不做任何 Chromium 内存优化
  //   normal    — 常规优化（默认）：关闭无用后台服务，限制渲染进程数，适度裁剪 features
  //   aggressive — 激进优化：normal 全部 + no-sandbox + low-end-device-mode + 大量 disable-features + V8 堆 96MB
  memory_optimization: 'normal',
  // Virtual Bass Enhancement (modern smartphone DSP pipeline)
  vbe_enabled: false,
  vbe_cutoff: 90,            // Speaker model HPF cutoff (50–300 Hz)
  vbe_harm: 0.35,             // Bass harmonic mix λ (0.0–1.0)
  vbe_sub: 0.15,              // Subharmonic mix (0.0–1.0)
  vbe_body: 0.18,             // Mid-bass body mix (0.0–1.0)
  vbe_reson: 0.25,            // Attack resonance mix (0.0–1.0)
  vbe_dry: 1.0,               // Dry/main gain (0.0–1.0)
  vbe_a2: 0.15,               // NLD x² coefficient (even harmonics)
  vbe_a3: 0.85,               // NLD x³ coefficient (odd harmonics)
  vbe_trans_drive: 2.0,       // Transient saturation drive (1.0–5.0)
  vbe_reson_freq: 2200,        // Attack resonance center freq (1000–4000 Hz)
  library_auto_watch: true,          // 本地库文件夹 FileWatcher 自动刷新
  library_watch_poll_minutes: 10,    // 本地库轮询兜底间隔（0 = 关闭轮询）
  library_watch_debounce_ms: 3000,   // FileWatcher 事件去抖窗口
  subsonic_auto_sync: true,          // 远程库定期 re-sync（刷新本地缓存数据库）
  subsonic_sync_interval_minutes: 30, // 远程库 re-sync 间隔（0 = 禁用）
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
    // 优先使用 Electron 的 app.getPath('userData')（跨平台标准路径）
    // 若 app 模块不可用（理论上不会发生），则回退到平台手动计算
    let baseDir;
    try {
      const { app } = require('electron');
      if (app && app.getPath) {
        baseDir = app.getPath('userData');
      }
    } catch { /* electron not available yet */ }
    if (!baseDir) {
      // 手动回退：遵循各平台规范
      if (process.platform === 'win32') {
        baseDir = path.join(process.env.APPDATA || os.homedir(), 'Carminium');
      } else if (process.platform === 'darwin') {
        baseDir = path.join(os.homedir(), 'Library', 'Application Support', 'Carminium');
      } else {
        // Linux: XDG_CONFIG_HOME or ~/.config
        baseDir = path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'Carminium');
      }
    }
    this._dir = baseDir;
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

  getAll() {
    return this.all();
  }

  // ── Paths ─────────────────────────────────────────────────────────────────

  get dataDir() {
    return this._dir;
  }
}

module.exports = { AppSettings, DEFAULTS };
