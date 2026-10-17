/**
 * Carminium — Windows 任务栏缩略图工具栏（Thumbnail Toolbar）
 *
 * 在任务栏缩略图预览的下方注册一排媒体控制按钮：
 * 上一首 / 播放·暂停 / 下一首 / 喜欢。
 * 与 SMTC（控制中心）互补：SMTC 负责全局媒体键与会话浮层，这里只负责「鼠标停在
 * 任务栏图标上」时那一排按钮。
 *
 * 实现要点：
 *  · 仅 Windows 有效，其它平台 setThumbarButtons 是空操作——这里直接不接管。
 *  · Electron 的 thumbar 只认静态图标，播放/暂停需要切换图标 → 在 state_changed
 *    时重建按钮数组（切换到任务栏不会重新渲染，图标必须是现成 PNG）。
 *  · 图标按系统暗色模式给两套（build/thumbar/*_{dark,light}.png），由
 *    scripts/gen_thumbar_icons.js 生成；nativeTheme 变化时重载图标。
 *  · setThumbarButtons 会在任务栏缩略图上强制显示一排按钮，会改变窗口预览外观，
 *    因此做成可关闭（设置项 taskbar_thumb_controls）。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { nativeImage, nativeTheme } = require('electron');

const ICON_DIR = path.join(__dirname, '..', 'build', 'thumbar');

// 缩略图工具栏最多 7 个按钮；这里用 4 个：上一首 / 播放·暂停 / 下一首 / 喜欢。
const BUTTON_COUNT = 4;

class ThumbarController {
  /**
   * @param {import('./player').MusicPlayer} player
   * @param {import('./settings').AppSettings|null} settings
   */
  constructor(player, settings = null) {
    this._player = player;
    this._settings = settings;
    this._win = null;
    this._icons = null;          // { dark: {prev,play,pause,next}, light: {...} }
    this._enabled = true;
    this._lastKey = '';          // 按钮数组指纹，避免重复 setThumbarButtons
    this._retries = 0;           // setThumbarButtons 失败重试计数
    this._retryTimer = null;

    if (settings) {
      // 默认开启；显式关闭过才不注册（见 settings.js DEFAULTS）
      this._enabled = settings.get('taskbar_thumb_controls', true) !== false;
    }

    this._onStateChanged = () => this._refresh();
    player.on('state_changed', this._onStateChanged);
    player.on('track_changed', this._onStateChanged);
    player.on('liked_changed', this._onStateChanged);

    // 系统暗色模式切换 → 换一套图标
    this._onThemeUpdated = () => {
      this._icons = null;
      this._lastKey = '';
      this._refresh();
    };
    nativeTheme.on('updated', this._onThemeUpdated);
  }

  /** 是否可用：非 Windows 一律不接管 */
  static isSupported() {
    return process.platform === 'win32';
  }

  setWindow(win) {
    this._detachWindow();
    this._win = win || null;
    this._lastKey = '';
    this._retries = 0;
    if (!win) return;

    // 注册时机很挑：窗口 show 之前任务栏按钮尚未建好，setThumbarButtons 多半会
    // 返回 false（或返回 true 但注册被丢弃）。所以在 show 时、show+250ms 各试一次，
    // 失败还有 _scheduleRetry() 兜底退避重试。
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

    // 先立刻试一次：窗口已可见（activate 重建）时直接生效，否则靠 show + 重试
    this._refresh();
  }

  _detachWindow() {
    const win = this._win;
    if (win && this._onWinShown) {
      try { win.removeListener('show', this._onWinShown); } catch { /* ignore */ }
    }
    this._onWinShown = null;
  }

  /** bridge 的 settings_changed 事件（负载为完整设置的 JSON 字符串） */
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

  // ── 图标 ──────────────────────────────────────────────────────────────────

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

  // ── 按钮构建 ──────────────────────────────────────────────────────────────

  _togglePlayback() {
    const p = this._player;
    if (!p) return;
    // 与界面上的播放键完全同语义：只切播放态，不额外发明行为
    if (p.isPlaying) p.pause();
    else p.play();
  }

  _buildButtons() {
    const icons = this._loadIcons();
    const player = this._player;
    const isPlaying = !!(player && player.isPlaying);
    const isLiked = !!(player && player.isCurrentLiked);

    // 不传 flags（Electron 默认即 ['enabled']）。避免 disabled：
    // disabled 状态下 Windows 不画悬停高亮、点击也不响应，看起来就是一张贴图。
    const playIcon = isPlaying ? icons.pause : icons.play;
    // 原生回调里抛异常会走主进程 uncaughtException（弹错误框），这里统一吞掉并记日志
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
        // 已收藏用实心心形，未收藏用描边心形
        icon: isLiked ? icons.liked : icons.like,
        tooltip: isLiked ? '取消喜欢' : '喜欢',
        click: act(() => { if (player) player.toggleLiked(); }),
      },
    ].filter((b) => !!b.icon);
  }

  // ── 应用 ──────────────────────────────────────────────────────────────────

  _refresh() {
    if (!ThumbarController.isSupported()) return;
    const win = this._win;
    if (!win || win.isDestroyed()) return;
    // 🔴 窗口未显示（任务栏按钮还不存在）时绝不能调 setThumbarButtons：
    // AddButtons 会"成功"但注册被任务栏丢弃，而 Electron 内部已把状态记成
    // 「已添加」，之后所有更新都走无效的 update 路径 → 按钮永远出不来。
    if (!win.isVisible()) return;

    if (!this._enabled) {
      win.setThumbarButtons([]);
      this._lastKey = 'off';
      return;
    }

    const buttons = this._buildButtons();
    if (buttons.length < BUTTON_COUNT) return;   // 图标没生成好，保持上一次状态

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
      // 返回 false：任务栏宿主（缩略图工具栏）还没准备好，退避重试，
      // 否则这一次注册被丢弃后要等到下次状态变化才会再试 —— 表现就是"按钮没了"。
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
    } catch { /* ignore */ }
    try {
      nativeTheme.removeListener('updated', this._onThemeUpdated);
    } catch { /* ignore */ }
    const win = this._win;
    if (win && !win.isDestroyed()) {
      try { win.setThumbarButtons([]); } catch { /* ignore */ }
    }
    this._win = null;
  }
}

module.exports = { ThumbarController };
