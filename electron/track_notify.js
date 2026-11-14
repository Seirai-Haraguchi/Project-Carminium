'use strict';

const { Notification, nativeImage } = require('electron');

// 切歌通知：窗口不在前台时，每首歌开始播放推一条系统通知，通知上带「跳过」按钮。
//
// 几个关键约束（踩过才知道）：
// 1. Windows 的 toast 必须走 AUMID（main.js 已经 setAppUserModelId + IFEO 注册），否则
//    通知会被系统静默丢弃，连 failed 事件都不会有。
// 2. 用固定 id（→ toast 的 Tag）：连续切歌时新通知会顶掉旧的，不会在操作中心堆成一片。
// 3. 封面图必须是 nativeImage / 本地文件，Windows 侧 Electron 会自己落临时 PNG。
//    超过 1024×1024 或体积过大的图会被 toast 拒绝，所以统一缩到 96。
// 4. 不用系统提示音：正在放歌，再响一声是噪音。

const DEBOUNCE_MS = 700;        // 连按下一首时只推最后一条
const DEDUPE_MS = 4000;         // 同一首歌短时间内重复的 track_changed 不重复推
const ICON_CACHE_LIMIT = 24;
const ICON_SIZE = 96;

const LABELS = {
  'zh-CN': { skip: '跳过', unknownTitle: '未知曲目', unknownArtist: '未知艺术家' },
  'zh-TW': { skip: '跳過', unknownTitle: '未知曲目', unknownArtist: '未知藝術家' },
  'ja': { skip: 'スキップ', unknownTitle: '不明な曲', unknownArtist: '不明なアーティスト' },
  'en': { skip: 'Skip', unknownTitle: 'Unknown Track', unknownArtist: 'Unknown Artist' },
  'ru': { skip: 'Пропустить', unknownTitle: 'Неизвестный трек', unknownArtist: 'Неизвестный исполнитель' },
};

class TrackNotifyController {
  constructor(player, library, settings = null, bridge = null) {
    this._player = player;
    this._library = library;
    this._settings = settings;
    this._bridge = bridge;
    this._win = null;

    this._enabled = true;
    if (settings) this._enabled = settings.get('track_notify', true) !== false;

    this._timer = null;
    this._pendingTrackId = '';
    this._lastNotice = { id: '', at: 0 };
    this._active = null;
    this._iconCache = new Map();
    this._disposed = false;

    this._onTrackChanged = (trackJson) => this._schedule(trackJson);
    player.on('track_changed', this._onTrackChanged);
  }

  static isSupported() {
    try {
      return Notification.isSupported();
    } catch {
      return false;
    }
  }

  setWindow(win) {
    this._win = win || null;
  }

  setBridge(bridge) {
    if (!bridge) return;
    this._bridge = bridge;
    bridge.on('settings_changed', (settingsJson) => this._onSettingsChanged(settingsJson));
  }

  _onSettingsChanged(settingsJson) {
    let data;
    try {
      data = JSON.parse(settingsJson);
    } catch {
      return;
    }
    if (!('track_notify' in data)) return;
    this._enabled = data['track_notify'] !== false;
    if (!this._enabled) this._cancel();
  }

  _labels() {
    let lang = 'zh-CN';
    try {
      lang = (this._settings && this._settings.get('language', 'zh-CN')) || 'zh-CN';
    } catch {  }
    return LABELS[lang] || LABELS['zh-CN'];
  }

  // 前台 = 主窗聚焦；浮动小播放器聚焦时也算，否则用户在迷你窗里操作会被通知糊一脸。
  _isForeground() {
    const focused = (w) => {
      if (!w || w.isDestroyed()) return false;
      try {
        return w.isVisible() && !w.isMinimized() && w.isFocused();
      } catch {
        return false;
      }
    };
    if (focused(this._win)) return true;
    try {
      if (this._bridge && typeof this._bridge.floatingWindow === 'function') {
        if (focused(this._bridge.floatingWindow())) return true;
      }
    } catch {  }
    return false;
  }

  _cancel() {
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
    this._pendingTrackId = '';
  }

  _schedule(_trackJson) {
    if (this._disposed || !this._enabled) return;
    if (!TrackNotifyController.isSupported()) return;

    this._cancel();
    this._timer = setTimeout(() => {
      this._timer = null;
      this._maybeNotify();
    }, DEBOUNCE_MS);
  }

  _maybeNotify() {
    if (this._disposed || !this._enabled) return;
    const player = this._player;
    if (!player) return;
    // 只有真的在放歌才推：暂停状态下切歌不打扰。
    if (player.state !== 'playing') return;

    const track = player.currentTrack;
    if (!track) return;

    const id = String(track.id || '');
    const now = Date.now();
    if (id && this._lastNotice.id === id && now - this._lastNotice.at < DEDUPE_MS) return;
    this._lastNotice = { id, at: now };

    this._show(track).catch((e) => {
      console.warn('[track_notify] 通知发送失败:', e && e.message);
    });
  }

  async _show(track) {
    const labels = this._labels();
    const title = String(track.title || labels.unknownTitle);
    const artist = String(track.artist || track.album_artist || '');
    const album = String(track.album || '');

    // 版式对齐 Apple Music：标题＝歌名，正文＝「歌手 — 专辑」。
    let body = '';
    if (artist && album) body = `${artist} — ${album}`;
    else body = artist || album;

    const icon = await this._coverIcon(track);

    // 封面异步回来时可能已经切歌了，别推一条过期的。
    const current = this._player && this._player.currentTrack;
    if (!current || current.id !== track.id) return;
    if (this._disposed || !this._enabled) return;
    if (this._isForeground()) return;

    const options = {
      id: 'carminium-track',
      groupId: 'carminium',
      title,
      body,
      silent: true,
      timeoutType: 'default',
      actions: [{ type: 'button', text: labels.skip }],
    };
    if (icon) options.icon = icon;

    const n = new Notification(options);
    n.on('action', (_event, index) => {
      if (index !== 0) return;
      try {
        if (this._player) this._player.nextTrack();
      } catch (e) {
        console.warn('[track_notify] 跳过失败:', e && e.message);
      }
    });
    n.on('click', () => this._focusWindow());
    n.on('failed', (_event, error) => {
      console.warn('[track_notify] 系统拒绝了通知:', error);
    });
    n.on('close', () => {
      if (this._active === n) this._active = null;
    });

    if (this._active) {
      try { this._active.close(); } catch {  }
    }
    this._active = n;
    n.show();
  }

  _focusWindow() {
    const win = this._win;
    if (!win || win.isDestroyed()) return;
    try {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    } catch {  }
  }

  async _coverIcon(track) {
    const trackId = String(track.id || '');
    if (!trackId) return null;

    const cached = this._iconCache.get(trackId);
    if (cached !== undefined) return cached;

    let buf = null;
    try {
      if (track.source === 'subsonic') {
        buf = await this._library.getSubsonicCoverData(trackId);
      } else {
        const r = await this._library.getCoverDataAsync(trackId);
        buf = r ? r.data : null;
      }
    } catch {
      buf = null;
    }

    let icon = null;
    if (buf && buf.length) {
      try {
        const img = nativeImage.createFromBuffer(buf);
        if (!img.isEmpty()) {
          const size = img.getSize();
          const side = Math.min(size.width, size.height) || ICON_SIZE;
          icon = side > ICON_SIZE
            ? img.resize({ width: ICON_SIZE, height: ICON_SIZE, quality: 'good' })
            : img;
        }
      } catch {
        icon = null;
      }
    }

    // 连「没有封面」也缓存，避免每首歌都去捅一次文件系统。
    if (this._iconCache.size >= ICON_CACHE_LIMIT) {
      const oldest = this._iconCache.keys().next().value;
      if (oldest !== undefined) this._iconCache.delete(oldest);
    }
    this._iconCache.set(trackId, icon);
    return icon;
  }

  dispose() {
    this._disposed = true;
    this._cancel();
    try {
      this._player.removeListener('track_changed', this._onTrackChanged);
    } catch {  }
    if (this._active) {
      try { this._active.close(); } catch {  }
      this._active = null;
    }
    this._iconCache.clear();
    this._win = null;
  }
}

module.exports = { TrackNotifyController };
