'use strict';

const fs = require('fs');
const path = require('path');
const { nativeImage, nativeTheme } = require('electron');

const ICON_DIR = path.join(__dirname, '..', 'build', 'thumbar');

const BUTTON_COUNT = 4;

// 32×32 近乎全透明的 PNG（白色、alpha=1，肉眼不可见）。Windows 的缩略图工具栏由系统排布，
// 按钮间距固定、没有可调的 API，想让「收藏」和三键运输按钮分成两组，只能塞一个占位按钮把间距撑开。
// 🔴 不能用 alpha 全 0 的图：外壳会把它画成一个纯黑小方块（直角、比按钮小、且没有按钮底色）——
// 留 alpha=1 让它走正常的 alpha 合成路径。`nobackground` 已验证生效（占位槽不会有灰色按钮底）。
const SPACER_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAACXBIWXMAAAPoAAAD6AG1e1JrAAAALElEQVRY' +
  'w+3OoQEAAAwCIPf/0e4MC4FO2t5SBAQEBAQEBAQEBAQEBAQE1oEHLEX4ptMH4ysAAAAASUVORK5CYII=';

let _spacerIcon = null;
function spacerIcon() {
  if (!_spacerIcon) {
    _spacerIcon = nativeImage.createFromBuffer(Buffer.from(SPACER_PNG_B64, 'base64'));
  }
  return _spacerIcon;
}

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
    this._warnedIcons = false;

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
      this._warnedIcons = false;
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
    win.on('show', this._onWinShown);
    win.on('restore', this._onWinShown);

    this._refresh();
  }

  _detachWindow() {
    const win = this._win;
    if (win && this._onWinShown) {
      try { win.removeListener('show', this._onWinShown); } catch {  }
      try { win.removeListener('restore', this._onWinShown); } catch {  }
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

    const likeBtn = {
      icon: isLiked ? icons.liked : icons.like,
      tooltip: isLiked ? '取消喜欢' : '喜欢',
      click: act(() => { if (player) player.toggleLiked(); }),
    };
    const prevBtn = {
      icon: icons.prev,
      tooltip: '上一首',
      click: act(() => { if (player) player.prevTrack(); }),
    };
    const playBtn = {
      icon: playIcon,
      tooltip: isPlaying ? '暂停' : '播放',
      click: act(() => this._togglePlayback()),
    };
    const nextBtn = {
      icon: icons.next,
      tooltip: '下一首',
      click: act(() => { if (player) player.nextTrack(); }),
    };

    // 版式对齐 Apple Music：收藏独占在最左，中间用透明占位撑开，右边才是三键运输按钮。
    // 收藏或运输按钮任一侧缺失时都不插占位，否则会凭空多出一个空槽。
    const transport = [];
    if (prevBtn.icon) transport.push(prevBtn);
    if (playBtn.icon) transport.push(playBtn);
    if (nextBtn.icon) transport.push(nextBtn);

    const out = [];
    if (likeBtn.icon) out.push(likeBtn);
    if (likeBtn.icon && transport.length) {
      out.push({
        icon: spacerIcon(),
        tooltip: '',
        flags: ['nobackground'],
        click: () => {},
        _spacer: true,
      });
    }
    out.push(...transport);
    return out;
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
    const realButtons = buttons.filter((b) => !b._spacer);
    if (!realButtons.length) {
      if (!this._warnedIcons) {
        this._warnedIcons = true;
        console.error('[thumbar] 按钮图标全部加载失败，任务栏缩略图控制不会出现（请运行 npm run gen:thumbar）');
      }
      return;
    }
    if (realButtons.length < BUTTON_COUNT && !this._warnedIcons) {
      this._warnedIcons = true;
      console.warn(`[thumbar] 只有 ${realButtons.length}/${BUTTON_COUNT} 个图标可用，按钮会缺失`);
    }

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
