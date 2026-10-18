'use strict';

const fs = require('fs');
const path = require('path');
const { nativeImage, nativeTheme } = require('electron');

const ICON_DIR = path.join(__dirname, '..', 'build', 'thumbar');

const BUTTON_COUNT = 4;

class ThumbarController {
  constructor(player, settings = null) {
    this._player = player;
    this._settings = settings;
    this._win = null;
    this._icons = null;
    this._enabled = true;
    this._lastKey = '';
    this._retries = 0;
    this._retryTimer = null;

    if (settings) {
      this._enabled = settings.get('taskbar_thumb_controls', true) !== false;
    }

    this._onStateChanged = () => this._refresh();
    player.on('state_changed', this._onStateChanged);
    player.on('track_changed', this._onStateChanged);
    player.on('liked_changed', this._onStateChanged);

    this._onThemeUpdated = () => {
      this._icons = null;
      this._lastKey = '';
      this._refresh();
    };
    nativeTheme.on('updated', this._onThemeUpdated);
  }

  static isSupported() {
    return process.platform === 'win32';
  }

  setWindow(win) {
    this._detachWindow();
    this._win = win || null;
    this._lastKey = '';
    this._retries = 0;
    if (!win) return;

    this._onWinShown = () => {
      this._retries = 0;
      this._lastKey = '';
      this._refresh();
      setTimeout(() => {
        this._lastKey = '';
        this._refresh();
      }, 250);
    };
    win.once('show', this._onWinShown);

    this._refresh();
  }

  _detachWindow() {
    const win = this._win;
    if (win && this._onWinShown) {
      try { win.removeListener('show', this._onWinShown); } catch {  }
    }
    this._onWinShown = null;
  }

  setBridge(bridge) {
    if (!bridge) return;
    bridge.on('settings_changed', (settingsJson) => this._onSettingsChanged(settingsJson));
  }

  _onSettingsChanged(settingsJson) {
    let data;
    try {
      data = JSON.parse(settingsJson);
    } catch {
      return;
    }
    if (!('taskbar_thumb_controls' in data)) return;
    const next = data['taskbar_thumb_controls'] !== false;
    if (next === this._enabled) return;
    this._enabled = next;
    this._lastKey = '';
    this._refresh();
  }


  _loadIcons() {
    if (this._icons) return this._icons;
    const suffix = nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
    const load = (name) => {
      const p = path.join(ICON_DIR, `${name}_${suffix}.png`);
      try {
        if (!fs.existsSync(p)) {
          console.warn('[thumbar] 图标缺失:', p, '（请运行 node scripts/gen_thumbar_icons.js）');
          return null;
        }
        const img = nativeImage.createFromPath(p);
        return img.isEmpty() ? null : img;
      } catch (e) {
        console.warn('[thumbar] 图标加载失败:', p, e.message);
        return null;
      }
    };
    this._icons = {
      prev: load('prev'),
      play: load('play'),
      pause: load('pause'),
      next: load('next'),
      like: load('like'),
      liked: load('liked'),
    };
    return this._icons;
  }


  _togglePlayback() {
    const p = this._player;
    if (!p) return;
    if (p.isPlaying) p.pause();
    else p.play();
  }

  _buildButtons() {
    const icons = this._loadIcons();
    const player = this._player;
    const isPlaying = !!(player && player.isPlaying);
    const isLiked = !!(player && player.isCurrentLiked);

    const playIcon = isPlaying ? icons.pause : icons.play;
    const act = (fn) => () => {
      try { fn(); } catch (e) { console.warn('[thumbar] 按钮执行失败:', e.message); }
    };

    return [
      {
        icon: icons.prev,
        tooltip: '上一首',
        click: act(() => { if (player) player.prevTrack(); }),
      },
      {
        icon: playIcon,
        tooltip: isPlaying ? '暂停' : '播放',
        click: act(() => this._togglePlayback()),
      },
      {
        icon: icons.next,
        tooltip: '下一首',
        click: act(() => { if (player) player.nextTrack(); }),
      },
      {
        icon: isLiked ? icons.liked : icons.like,
        tooltip: isLiked ? '取消喜欢' : '喜欢',
        click: act(() => { if (player) player.toggleLiked(); }),
      },
    ].filter((b) => !!b.icon);
  }


  _refresh() {
    if (!ThumbarController.isSupported()) return;
    const win = this._win;
    if (!win || win.isDestroyed()) return;
    if (!win.isVisible()) return;

    if (!this._enabled) {
      win.setThumbarButtons([]);
      this._lastKey = 'off';
      return;
    }

    const buttons = this._buildButtons();
    if (buttons.length < BUTTON_COUNT) return;

    const p = this._player;
    const key = `${p ? p.state : ''}|${!!(p && p.isCurrentLiked)}|${nativeTheme.shouldUseDarkColors}`;
    if (key === this._lastKey) return;

    try {
      const ok = win.setThumbarButtons(buttons);
      if (ok) {
        this._lastKey = key;
        this._retries = 0;
        return;
      }
      this._lastKey = '';
      this._scheduleRetry();
    } catch (e) {
      this._lastKey = '';
      this._scheduleRetry();
      console.warn('[thumbar] setThumbarButtons 失败:', e.message);
    }
  }

  _scheduleRetry() {
    if (this._retryTimer) return;
    this._retries += 1;
    if (this._retries > 8) {
      console.warn('[thumbar] 注册重试次数用尽，放弃');
      return;
    }
    const delay = Math.min(200 * this._retries, 1500);
    this._retryTimer = setTimeout(() => {
      this._retryTimer = null;
      this._refresh();
    }, delay);
  }

  dispose() {
    if (this._retryTimer) {
      clearTimeout(this._retryTimer);
      this._retryTimer = null;
    }
    try {
      this._player.removeListener('state_changed', this._onStateChanged);
      this._player.removeListener('track_changed', this._onStateChanged);
      this._player.removeListener('liked_changed', this._onStateChanged);
    } catch {  }
    try {
      nativeTheme.removeListener('updated', this._onThemeUpdated);
    } catch {  }
    const win = this._win;
    if (win && !win.isDestroyed()) {
      try { win.setThumbarButtons([]); } catch {  }
    }
    this._win = null;
  }
}

module.exports = { ThumbarController };
