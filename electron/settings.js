'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const DEFAULTS = {
  volume: 80,
  shuffle: false,
  repeat: 'off',
  theme: 'system',
  music_folders: [],
  playback_state: {},
  audio_output_device: '',
  wasapi_exclusive: false,
  automix: false,
  radical_transitions: false,
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
  ui_jp_font: false,
  mini_player_lyrics: true,
  np_background_mode: 'cover',
  color_scheme: 'tonal_spot',
  color_spec: '2021',
  monet_source: 'album_cover',
  language: 'zh-CN',
  smtc_lyrics: false,

  taskbar_thumb_controls: true,
  artist_separators: ';',
  tag_editor_path: '',
  cache_dir: '',

  discord_rpc: false,
  discord_rpc_show_paused: true,

  discord_rpc_brief_format: '{artist}',

  discord_rpc_client_id: '',
  eq_enabled: false,
  eq_bands: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  dynamic_bass: false,
  compressor_enabled: false,
  vocal_enhance: false,
  guitar_friendly: false,
  hearing_protection: false,

  volume_normalization: false,
  volume_normalization_target: '-14',
  onboarding_complete: false,

  memory_optimization: 'normal',

  vbe_enabled: false,
  vbe_cutoff: 90,
  vbe_harm: 0.35,
  vbe_sub: 0.15,
  vbe_body: 0.18,
  vbe_reson: 0.25,
  vbe_dry: 1.0,
  vbe_a2: 0.15,
  vbe_a3: 0.85,
  vbe_trans_drive: 2.0,
  vbe_reson_freq: 2200,
  library_auto_watch: true,
  library_watch_poll_minutes: 10,
  library_watch_debounce_ms: 3000,
  subsonic_auto_sync: true,
  subsonic_sync_interval_minutes: 30,

  np_secondary_actions: [],
  show_quality: true,
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

/**
 * 把 V1 时代的 Gapless / AutoMix v2 / WSOLA 配置收敛为单一 `automix`。
 * 返回是否发生迁移；调用方负责持久化。
 */
function normalizeLegacySettings(data) {
  let migrated = false;
  if (data.gapless === true && data.automix !== true) {
    data.automix = true;
    migrated = true;
  }
  for (const legacy of ['automix_v2', 'automix_wsola', 'gapless']) {
    if (legacy in data) {
      delete data[legacy];
      migrated = true;
    }
  }
  return migrated;
}

const NP_SECONDARY_ACTIONS = {
  ids: [
    'shuffle', 'repeat', 'like', 'audio_mode',
    'seek_back_5', 'seek_fwd_5', 'seek_back_30', 'seek_fwd_30',
    'audio_settings', 'mute', 'floating', 'fullscreen',
  ],
  max: 5,
  defaults: ['shuffle', 'repeat', 'like', 'audio_mode'],
};

class AppSettings {
  constructor() {

    let baseDir;
    try {
      const { app } = require('electron');
      if (app && app.getPath) {
        baseDir = app.getPath('userData');
      }
    } catch {  }
    if (!baseDir) {

      if (process.platform === 'win32') {
        baseDir = path.join(process.env.APPDATA || os.homedir(), 'Carminium');
      } else if (process.platform === 'darwin') {
        baseDir = path.join(os.homedir(), 'Library', 'Application Support', 'Carminium');
      } else {

        baseDir = path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'Carminium');
      }
    }
    this._dir = baseDir;
    this._path = path.join(this._dir, 'settings.json');
    try {
      fs.mkdirSync(this._dir, { recursive: true });
    } catch {

    }
    this._data = { ...DEFAULTS };
    this._load();
  }

  _load() {
    try {
      if (fs.existsSync(this._path)) {
        const raw = fs.readFileSync(this._path, 'utf-8');
        const stored = JSON.parse(raw);
        Object.assign(this._data, stored);

        // 合并后 AutoMix 是唯一入口：曾开启 Gapless 的用户保留其无缝诉求，
        // 由 AutoMix 在条件满足时自动选无缝、否则选内容过渡。
        if (normalizeLegacySettings(this._data)) {
          try { this.save(); } catch {  }
        }
      }
    } catch (e) {

      try {
        const bak = this._path + '.bak';
        if (fs.existsSync(bak)) fs.unlinkSync(bak);
        fs.renameSync(this._path, bak);
      } catch {

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

      }
      throw e;
    }
  }

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

  get dataDir() {
    return this._dir;
  }
}

module.exports = { AppSettings, DEFAULTS, NP_SECONDARY_ACTIONS, normalizeLegacySettings };