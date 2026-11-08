'use strict';

const path = require('path');
const { BrowserWindow, nativeTheme, ipcMain } = require('electron');
const taskbarUia = require('./taskbar_uia');

const IS_WIN = process.platform === 'win32';

const GWL_EXSTYLE = -20;
const GWL_HWNDPARENT = -8;
const WS_EX_TOPMOST = 0x00000008;
const WS_EX_TOOLWINDOW = 0x00000080;
const WS_EX_NOACTIVATE = 0x08000000;

const HWND_TOPMOST = -1;
const HWND_NOTOPMOST = -2;
const HWND_TOP = 0;
const SWP_NOSIZE = 0x0001;
const SWP_NOMOVE = 0x0002;
const SWP_NOACTIVATE = 0x0010;

const HKCU = 0x80000001;
const RRF_RT_REG_DWORD = 0x00000010;

const POLL_MS = 2000;
const GAP = 8;

// 初始尺寸故意开大，之后只用 setBounds 缩小：透明窗口嵌入任务栏后 Chromium 的
// 合成表面不会随 setBounds 扩大，放大时超出初始尺寸的区域 alpha=0，按像素命中
// 测试会吞掉鼠标事件，表现为只有左侧一小段能操作。
const INITIAL_WIDTH = 3000;
const INITIAL_HEIGHT = 200;

// 任务栏被图标挤满时强行塞进去只剩几个字，不如直接隐藏。
const MIN_LYRIC_WIDTH_DIP = 120;

// 任务栏歌词需要跟随逐字高亮，但位置事件每秒十次，全量推送太浪费。
const POSITION_PUSH_MS = 400;

let _api = null;
let _apiFailed = false;

function _loadApi() {
  if (_api) return _api;
  if (_apiFailed) return null;
  try {
    const koffi = require('koffi');
    const user32 = koffi.load('user32.dll');
    _api = {
      FindWindowW: user32.func('uintptr FindWindowW(str16 cls, str16 title)'),
      FindWindowExW: user32.func('uintptr FindWindowExW(uintptr parent, uintptr after, str16 cls, str16 title)'),
      GetWindowRect: user32.func('int32 GetWindowRect(uintptr hwnd, void *rect)'),
      IsWindowVisible: user32.func('int32 IsWindowVisible(uintptr hwnd)'),
      GetWindowLongPtrW: user32.func('intptr GetWindowLongPtrW(uintptr hwnd, int32 index)'),
      SetWindowLongPtrW: user32.func('intptr SetWindowLongPtrW(uintptr hwnd, int32 index, intptr value)'),
      GetDpiForWindow: user32.func('uint32 GetDpiForWindow(uintptr hwnd)'),
      MonitorFromWindow: user32.func('uintptr MonitorFromWindow(uintptr hwnd, uint32 flags)'),
      GetMonitorInfoW: user32.func('int32 GetMonitorInfoW(uintptr monitor, void *info)'),
      SetWindowPos: user32.func('int32 SetWindowPos(uintptr hwnd, intptr insertAfter, int32 x, int32 y, int32 cx, int32 cy, uint32 flags)'),
    };
  } catch (e) {
    _apiFailed = true;
    console.warn('[taskbar-lyrics] Win32 API 初始化失败:', e.message);
    return null;
  }
  return _api;
}

function _hwndOf(value) {
  if (typeof value === 'bigint') return Number(value);
  return Number(value) || 0;
}

function _rectOf(api, hwnd) {
  if (!hwnd) return null;
  const buf = Buffer.alloc(16);
  if (!api.GetWindowRect(hwnd, buf)) return null;
  const left = buf.readInt32LE(0);
  const top = buf.readInt32LE(4);
  const right = buf.readInt32LE(8);
  const bottom = buf.readInt32LE(12);
  if (right <= left || bottom <= top) return null;
  return { left, top, right, bottom };
}

function _monitorRectOf(api, hwnd) {
  const mon = _hwndOf(api.MonitorFromWindow(hwnd, 2));
  if (!mon) return null;
  const buf = Buffer.alloc(40);
  buf.writeUInt32LE(40, 0);
  if (!api.GetMonitorInfoW(mon, buf)) return null;
  return {
    left: buf.readInt32LE(4),
    top: buf.readInt32LE(8),
    right: buf.readInt32LE(12),
    bottom: buf.readInt32LE(16),
  };
}

let _regFailed = false;
let _RegGetValueW = null;

function _readTaskbarLightTheme() {
  if (_regFailed) return null;
  try {
    if (!_RegGetValueW) {
      const koffi = require('koffi');
      const advapi32 = koffi.load('advapi32.dll');
      _RegGetValueW = advapi32.func(
        'int32 RegGetValueW(uintptr hkey, str16 subkey, str16 value, uint32 flags, void *type, void *data, void *size)'
      );
    }
    const typeBuf = Buffer.alloc(4);
    const dataBuf = Buffer.alloc(4);
    const sizeBuf = Buffer.alloc(4);
    sizeBuf.writeUInt32LE(4, 0);
    const rc = _RegGetValueW(
      HKCU,
      'Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize',
      'SystemUsesLightTheme',
      RRF_RT_REG_DWORD,
      typeBuf,
      dataBuf,
      sizeBuf
    );
    if (rc !== 0) return null;
    return dataBuf.readUInt32LE(0) !== 0;
  } catch {
    _regFailed = true;
    return null;
  }
}

function _clampInt(value, min, max, fallback) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

const LRC_TIME_REGEX = /\[(\d{2}):(\d{2})(?:[.:](\d{2,3}))?\]/g;
const WORD_TIME_REGEX = /<(\d{2}):(\d{2})[.:](\d{2,3})>([^<]*)/g;
const LEADING_TAG_REGEX = /^\[(?:s:([^\]]*)|bg)\]\s*/;

function _timeOf(mm, ss, frac) {
  let ms = 0;
  if (frac !== undefined) {
    ms = parseInt(frac, 10);
    if (frac.length === 2) ms *= 10;
  }
  return parseInt(mm, 10) * 60000 + parseInt(ss, 10) * 1000 + ms;
}

function _parseWords(rawText, lineTime) {
  const words = [];
  let m;
  let firstIndex = -1;
  WORD_TIME_REGEX.lastIndex = 0;
  while ((m = WORD_TIME_REGEX.exec(rawText)) !== null) {
    if (firstIndex < 0) firstIndex = m.index;
    words.push({ start: _timeOf(m[1], m[2], m[3]), text: m[4] });
  }
  if (words.length === 0) return { text: rawText, words: null };

  // 首个时间标签之前的文字没有自己的时间点，归到行首。
  const leading = firstIndex > 0 ? rawText.slice(0, firstIndex) : '';
  if (leading.trim()) {
    words.unshift({ start: Number(lineTime) || 0, text: leading });
  }

  for (let i = 0; i < words.length; i++) {
    const next = words[i + 1];
    words[i].end = next ? next.start : null;
  }
  const last = words[words.length - 1];
  if (last.end === null) last.end = last.start;
  if (!last.text && words.length > 1) {
    words[words.length - 2].end = last.start;
    words.pop();
  }
  const text = words.map((w) => w.text).join('');
  return { text, words };
}

/**
 * 解析歌词为任务栏歌词用的行结构。
 * 同一时间戳的多行按惯例依次是原文 / 翻译，取原文与翻译两行即可。
 */
function parseLyricLines(lrcText) {
  if (!lrcText) return [];
  const entries = [];

  for (const raw of String(lrcText).split('\n')) {
    const line = raw.trim();
    if (!line) continue;

    const times = [];
    let lastIdx = 0;
    let m;
    LRC_TIME_REGEX.lastIndex = 0;
    while ((m = LRC_TIME_REGEX.exec(line)) !== null) {
      times.push(_timeOf(m[1], m[2], m[3]));
      lastIdx = m.index + m[0].length;
    }
    if (times.length === 0) continue;

    let body = line.slice(lastIdx).trim();
    let isBg = false;
    let tag;
    LEADING_TAG_REGEX.lastIndex = 0;
    while ((tag = LEADING_TAG_REGEX.exec(body)) !== null) {
      if (tag[0].charAt(1) === 'b') isBg = true;
      body = body.slice(tag[0].length);
    }

    const parsed = _parseWords(body, times[0]);
    if (!parsed.text) continue;

    for (const t of times) {
      entries.push({ time: t, text: parsed.text, words: parsed.words, isBg });
    }
  }

  entries.sort((a, b) => a.time - b.time);

  const lines = [];
  let k = 0;
  while (k < entries.length) {
    const cluster = [entries[k]];
    let j = k + 1;
    while (j < entries.length && Math.abs(entries[j].time - entries[k].time) <= 30) {
      cluster.push(entries[j]);
      j++;
    }
    const normal = cluster.filter((e) => !e.isBg);
    const pool = normal.length > 0 ? normal : cluster;
    const head = pool[0];
    const item = { time: head.time, text: head.text, words: head.words };
    if (pool.length >= 2) {
      item.translation = pool[1].text;
      item.translationWords = pool[1].words;
    }
    lines.push(item);
    k = j;
  }

  for (let i = 0; i < lines.length; i++) {
    const next = lines[i + 1];
    lines[i].end = next ? next.time : lines[i].time + 6000;
  }
  return lines;
}

class TaskbarLyricsController {
  constructor(player, library = null, settings = null) {
    this._player = player;
    this._library = library;
    this._settings = settings;

    this._win = null;
    this._mainWin = null;
    this._hwnd = 0;
    this._ownerHwnd = 0;
    this._taskbarHwnd = 0;

    this._lines = [];
    this._lineIdx = -1;
    this._region = null;
    this._contentWidth = null;
    this._lastBoundsKey = '';
    this._lastShapeWidth = -1;
    this._lastPosPush = 0;
    this._lastIsLight = null;
    this._layoutDirty = false;
    this._lastTopmost = null;

    this._started = false;
    this._pollTimer = null;
    this._attached = false;
    this._resendTimer = null;
    this._resendTries = 0;
    this._lastEnableAt = 0;

    this._cfg = this._readConfig();

    this._onTrackChanged = () => {
      this._rebuildLyrics();
      this._refresh(true);
    };
    this._onLyricsChanged = () => {
      this._rebuildLyrics();
      this._refresh(true);
    };
    this._onPositionChanged = (pos) => this._onPosition(pos);
    this._onStateChanged = () => this._pushState();
    this._onThemeUpdated = () => this._pushState();

    player.on('track_changed', this._onTrackChanged);
    player.on('lyrics_changed', this._onLyricsChanged);
    player.on('position_changed', this._onPositionChanged);
    player.on('state_changed', this._onStateChanged);
    nativeTheme.on('updated', this._onThemeUpdated);

    this._bindIpc();
  }

  static isSupported() {
    return IS_WIN;
  }

  _bindIpc() {
    this._ipcContentWidth = (event, width) => {
      if (!this._ownsSender(event)) return;
      const n = Number(width);
      if (!Number.isFinite(n) || n <= 0) return;
      this._contentWidth = n;
      this._applyContentShape();
    };
    this._ipcCommand = (event, cmd) => {
      if (!this._ownsSender(event)) return;
      this._handleCommand(String(cmd || ''));
    };
    this._ipcFocusMain = (event) => {
      if (!this._ownsSender(event)) return;
      const win = this._mainWin;
      if (!win || win.isDestroyed()) return;
      try {
        if (win.isMinimized()) win.restore();
        win.show();
        win.focus();
      } catch { }
    };

    ipcMain.on('taskbar_lyrics:content_width', this._ipcContentWidth);
    ipcMain.on('taskbar_lyrics:command', this._ipcCommand);
    ipcMain.on('taskbar_lyrics:focus_main', this._ipcFocusMain);
  }

  _ownsSender(event) {
    const win = this._win;
    if (!win || win.isDestroyed()) return false;
    return event.sender === win.webContents;
  }

  _handleCommand(cmd) {
    try {
      if (cmd === 'prev') this._player.prevTrack();
      else if (cmd === 'next') this._player.nextTrack();
      else if (cmd === 'play') this._player.play();
      else if (cmd === 'pause') this._player.pause();
      else if (cmd === 'toggle') {
        if (this._player.isPlaying) this._player.pause();
        else this._player.play();
      }
    } catch { }
  }

  setBridge(bridge) {
    if (!bridge) return;
    bridge.on('settings_changed', (settingsJson) => this._onSettingsChanged(settingsJson));
  }

  setMainWindow(win) {
    this._mainWin = win || null;
  }

  start() {
    if (this._started) return;
    this._started = true;
    this._rebuildLyrics();
    if (this._cfg.enabled) this._enable();
  }

  _readConfig() {
    const s = this._settings;
    if (!s) {
      return {
        enabled: false,
        position: 'auto',
        autoMaxWidth: true,
        autoAdjust: false,
        maxWidth: 400,
        leftMargin: 0,
        rightMargin: 0,
        colorMode: 'taskbar',
        showBackground: false,
        fontSize: 14,
        fontWeight: 400,
        showCover: true,
        wordByWord: true,
        doubleLine: true,
        showTranslation: true,
        fontFamily: '',
      };
    }
    const position = String(s.get('taskbar_lyrics_position', 'auto'));
    const colorMode = String(s.get('taskbar_lyrics_color_mode', 'taskbar'));
    return {
      enabled: s.get('taskbar_lyrics', false) === true,
      position: ['left', 'right', 'auto'].includes(position) ? position : 'auto',
      autoMaxWidth: s.get('taskbar_lyrics_auto_max_width', true) !== false,
      autoAdjust: s.get('taskbar_lyrics_auto_adjust_occupied_space', false) === true,
      maxWidth: _clampInt(s.get('taskbar_lyrics_max_width', 400), 200, 800, 400),
      leftMargin: _clampInt(s.get('taskbar_lyrics_left_margin', 0), 0, 500, 0),
      rightMargin: _clampInt(s.get('taskbar_lyrics_right_margin', 0), 0, 500, 0),
      colorMode: ['taskbar', 'taskbarInverse', 'light', 'dark'].includes(colorMode) ? colorMode : 'taskbar',
      showBackground: s.get('taskbar_lyrics_show_background', false) === true,
      fontSize: _clampInt(s.get('taskbar_lyrics_font_size', 14), 12, 20, 14),
      fontWeight: _clampInt(s.get('taskbar_lyrics_font_weight', 400), 100, 900, 400),
      showCover: s.get('taskbar_lyrics_show_cover', true) !== false,
      wordByWord: s.get('taskbar_lyrics_word_by_word', true) !== false,
      doubleLine: s.get('taskbar_lyrics_double_line', true) !== false,
      showTranslation: s.get('taskbar_lyrics_show_translation', true) !== false,
      fontFamily: String(s.get('ui_font', '') || '').trim(),
    };
  }

  _onSettingsChanged(settingsJson) {
    let data;
    try {
      data = JSON.parse(settingsJson);
    } catch {
      return;
    }
    if (!Object.keys(data).some((k) => k.startsWith('taskbar_lyrics') || k === 'ui_font')) return;

    this._cfg = this._readConfig();
    if (!this._cfg.enabled) {
      this._disable();
      return;
    }
    if (!this._win) {
      this._enable();
      return;
    }
    this._lastBoundsKey = '';
    this._contentWidth = null;
    this._refresh(true);
  }

  _enable() {
    if (!TaskbarLyricsController.isSupported()) return;
    if (this._win && !this._win.isDestroyed()) {
      this._refresh(true);
      return;
    }
    this._lastEnableAt = Date.now();
    this._resendTries = 0;
    this._contentWidth = null;
    this._lastShapeWidth = -1;
    this._lastBoundsKey = '';
    this._lastIsLight = null;
    this._layoutDirty = false;
    this._lastTopmost = null;

    const win = new BrowserWindow({
      width: INITIAL_WIDTH,
      height: INITIAL_HEIGHT,
      minWidth: 0,
      minHeight: 0,
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      hasShadow: false,
      thickFrame: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      focusable: false,
      type: 'toolbar',
      title: 'Taskbar Lyrics',
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        backgroundThrottling: false,
        zoomFactor: 1,
      },
    });

    this._win = win;
    this._hwnd = 0;
    this._ownerHwnd = 0;
    this._attached = false;

    win.on('closed', () => {
      this._win = null;
      this._hwnd = 0;
      this._ownerHwnd = 0;
      this._region = null;
      this._lastBoundsKey = '';
      this._lastTopmost = null;
    });

    win.webContents.on('did-finish-load', () => {
      this._refresh(true);
    });

    win.loadFile(path.join(__dirname, '..', 'web', 'taskbar_lyrics.html')).catch((e) => {
      console.warn('[taskbar-lyrics] 页面加载失败:', e.message);
    });

    this._startPolling();
  }

  _disable() {
    this._stopPolling();
    if (this._resendTimer) {
      clearTimeout(this._resendTimer);
      this._resendTimer = null;
    }
    const win = this._win;
    this._win = null;
    this._hwnd = 0;
    this._ownerHwnd = 0;
    this._region = null;
    this._lastBoundsKey = '';
    this._lastIsLight = null;
    this._layoutDirty = false;
    this._lastTopmost = null;
    if (win && !win.isDestroyed()) {
      try { win.destroy(); } catch { }
    }
  }

  _startPolling() {
    if (this._pollTimer) return;
    this._pollTimer = setInterval(() => {
      if (!this._cfg.enabled) return;
      this._refresh(false);
    }, POLL_MS);
    if (this._pollTimer.unref) this._pollTimer.unref();
  }

  _stopPolling() {
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
  }

  _rebuildLyrics() {
    const track = this._player.currentTrack;
    const raw = track && track.lyrics ? String(track.lyrics) : '';
    this._lines = raw ? parseLyricLines(raw) : [];
    this._lineIdx = this._lines.length > 0 ? this._indexAt(Number(this._player.position) || 0) : -1;
  }

  _indexAt(positionMs) {
    let idx = -1;
    for (let i = 0; i < this._lines.length; i++) {
      if (positionMs >= this._lines[i].time) idx = i;
      else break;
    }
    return idx;
  }

  _onPosition(pos) {
    if (!this._cfg.enabled) return;
    const ms = Number(pos) || 0;

    if (this._lines.length > 0) {
      const idx = this._indexAt(ms);
      if (idx !== this._lineIdx) {
        this._lineIdx = idx;
        this._pushState();
        return;
      }
    }

    const now = Date.now();
    if (now - this._lastPosPush < POSITION_PUSH_MS) return;
    this._lastPosPush = now;
    this._send({ type: 'position', position: ms, playing: !!this._player.isPlaying });
  }

  _buildItems(track) {
    const cfg = this._cfg;
    const items = [];

    if (track && this._lines.length > 0 && this._lineIdx >= 0 && this._lineIdx < this._lines.length) {
      const line = this._lines[this._lineIdx];
      items.push({
        role: 'primary',
        text: line.text,
        words: line.words || null,
        start: line.time,
        end: line.end,
      });

      if (cfg.doubleLine) {
        const trans = cfg.showTranslation ? line.translation : '';
        if (trans) {
          items.push({
            role: 'secondary',
            text: trans,
            words: null,
            start: line.time,
            end: line.end,
          });
        } else {
          const next = this._lines[this._lineIdx + 1];
          if (next) {
            items.push({
              role: 'secondary',
              text: next.text,
              words: null,
              start: next.time,
              end: next.end,
            });
          }
        }
      }
      return items;
    }

    if (!track) return items;

    items.push({ role: 'primary', text: String(track.title || ''), words: null, start: 0, end: 0 });
    if (cfg.doubleLine) {
      items.push({
        role: 'secondary',
        text: String(track.artist || track.album_artist || ''),
        words: null,
        start: 0,
        end: 0,
      });
    }
    return items;
  }

  _buildState() {
    const track = this._player.currentTrack;
    const cfg = this._cfg;
    const light = _readTaskbarLightTheme();
    const isLight = light === null ? !nativeTheme.shouldUseDarkColors : light;
    const region = this._region;

    return {
      type: 'state',
      layout: {
        anchor: region ? region.anchor : 'left',
        maxWidth: region ? region.maxWidth : 400,
        height: region ? region.height : 48,
        isLight,
      },
      config: {
        colorMode: cfg.colorMode,
        showBackground: cfg.showBackground,
        doubleLine: cfg.doubleLine,
        showCover: cfg.showCover,
        wordByWord: cfg.wordByWord,
        fontSize: cfg.fontSize,
        fontWeight: cfg.fontWeight,
        fontFamily: cfg.fontFamily,
      },
      track: track
        ? {
          id: String(track.id || ''),
          title: String(track.title || ''),
          artist: String(track.artist || track.album_artist || ''),
          cover: this._coverUrl(track),
        }
        : null,
      items: this._buildItems(track),
      playing: !!this._player.isPlaying,
      position: Number(this._player.position) || 0,
    };
  }

  _coverUrl(track) {
    if (!track || !track.has_cover || !track.id) return '';
    const base = typeof this._player.getMediaBaseUrl === 'function'
      ? this._player.getMediaBaseUrl()
      : '';
    if (!base) return '';
    return `${base}/cover/${encodeURIComponent(String(track.id))}?size=128`;
  }

  _pushState() {
    if (!this._cfg.enabled) return;
    this._send(this._buildState());
  }

  _send(payload) {
    const win = this._win;
    if (!win || win.isDestroyed()) return;
    if (win.webContents.isLoading()) {
      this._scheduleResend();
      return;
    }
    try {
      win.webContents.send('taskbar_lyrics:state', payload);
      this._resendTries = 0;
    } catch { }
  }

  _scheduleResend() {
    if (this._resendTimer || this._resendTries >= 30) return;
    this._resendTries++;
    this._resendTimer = setTimeout(() => {
      this._resendTimer = null;
      if (this._cfg.enabled && this._win) this._refresh(true);
    }, 100);
    if (this._resendTimer.unref) this._resendTimer.unref();
  }

  _refresh(forcePayload) {
    if (!this._cfg.enabled) return;
    const win = this._win;
    if (!win || win.isDestroyed()) {
      if (this._started && Date.now() - this._lastEnableAt > 2000) this._enable();
      return;
    }

    const geo = this._computeGeometry();
    if (!geo) {
      this._region = null;
      if (win.isVisible()) win.hide();
      return;
    }

    const hasContent = !!this._player.currentTrack;
    const laid = this._applyLayout(win, geo);
    if (!laid || !hasContent) {
      if (win.isVisible()) win.hide();
      return;
    }

    if (!win.isVisible()) {
      try { win.showInactive(); } catch { }
      forcePayload = true;
    }

    if (this._layoutDirty) {
      this._layoutDirty = false;
      forcePayload = true;
    }

    if (forcePayload) this._pushState();
  }

  _mainMonitor(api) {
    const win = this._mainWin;
    if (!win || win.isDestroyed()) return 0;
    let hwnd = 0;
    try {
      const handle = win.getNativeWindowHandle();
      hwnd = handle.length >= 8 ? Number(handle.readBigUInt64LE(0)) : handle.readUInt32LE(0);
    } catch {
      return 0;
    }
    if (!hwnd) return 0;
    return _hwndOf(api.MonitorFromWindow(hwnd, 2));
  }

  _secondaryTaskbar(api, monitorHwnd) {
    if (!monitorHwnd) return 0;
    let after = 0;
    for (let i = 0; i < 16; i++) {
      const hwnd = _hwndOf(api.FindWindowExW(0, after, 'Shell_SecondaryTrayWnd', null));
      if (!hwnd) break;
      if (_hwndOf(api.MonitorFromWindow(hwnd, 2)) === monitorHwnd) return hwnd;
      after = hwnd;
    }
    return 0;
  }

  _measureTaskbar(api, hwnd, secondary) {
    if (!api.IsWindowVisible(hwnd)) return null;

    const tr = _rectOf(api, hwnd);
    if (!tr) return null;
    // 只有水平贴底的任务栏才放得下歌词。
    if (tr.bottom - tr.top >= tr.right - tr.left) return null;

    const mon = _monitorRectOf(api, hwnd);
    if (mon && (tr.top >= mon.bottom - 2 || tr.bottom <= mon.top + 2)) return null;

    const trayHwnd = _hwndOf(api.FindWindowExW(hwnd, 0, 'TrayNotifyWnd', null));
    const tray = trayHwnd ? _rectOf(api, trayHwnd) : null;

    const rebarHwnd = _hwndOf(api.FindWindowExW(hwnd, 0, 'ReBarWindow32', null));
    const rebar = rebarHwnd ? _rectOf(api, rebarHwnd) : null;

    const startHwnd = _hwndOf(api.FindWindowExW(hwnd, 0, 'Start', null));
    const start = startHwnd ? _rectOf(api, startHwnd) : null;

    // Win11 的 XAML 任务栏只有 UIA 能给出真实图标边界，取不到时退回旧式窗口矩形。
    const bridgeHwnd = _hwndOf(api.FindWindowExW(hwnd, 0, 'Windows.UI.Composition.DesktopWindowContentBridge', null));
    const content = bridgeHwnd && tray
      ? taskbarUia.scanContentBounds(hwnd, tr.right - tr.left, tray.left)
      : null;

    if (secondary && !content && !(rebar && rebar.right - rebar.left > 8)) return null;

    return { hwnd, tr, tray, rebar, start, content };
  }

  _computeGeometry() {
    const api = _loadApi();
    if (!api) return null;

    const primary = _hwndOf(api.FindWindowW('Shell_TrayWnd', null));
    if (!primary) return null;

    let info = this._measureTaskbar(api, primary, false);
    if (!info) return null;

    const mainMon = this._mainMonitor(api);
    const primaryMon = _hwndOf(api.MonitorFromWindow(primary, 2));
    if (mainMon && primaryMon && mainMon !== primaryMon) {
      const sec = this._secondaryTaskbar(api, mainMon);
      const secInfo = sec ? this._measureTaskbar(api, sec, true) : null;
      if (secInfo) info = secInfo;
    }

    const tr = info.tr;
    const tray = info.tray;
    const rebar = info.rebar;
    const start = info.start;
    const content = info.content;
    this._taskbarHwnd = info.hwnd;

    let rightLimit = tr.right;
    if (tray && tray.left > tr.left + 20) rightLimit = tray.left;

    let iconsLeft;
    let iconsRight;
    if (content) {
      iconsLeft = content.left;
      iconsRight = content.right;
    } else if (rebar && rebar.right - rebar.left > 8) {
      iconsLeft = rebar.left;
      iconsRight = rebar.right;
    } else if (start) {
      iconsLeft = start.left;
      iconsRight = start.right;
    } else {
      const cw = tr.right - tr.left;
      iconsLeft = tr.left + Math.round(cw * 0.35);
      iconsRight = tr.left + Math.round(cw * 0.65);
    }

    const leftLimit = start ? Math.min(start.left, iconsLeft) : iconsLeft;
    const leftRegion = { left: tr.left + GAP, right: leftLimit - GAP, top: tr.top, bottom: tr.bottom };
    const rightRegion = { left: iconsRight + GAP, right: rightLimit - GAP, top: tr.top, bottom: tr.bottom };

    const usableLeft = leftRegion.right - leftRegion.left;
    const usableRight = rightRegion.right - rightRegion.left;
    const dpi = Number(api.GetDpiForWindow(info.hwnd)) || 96;
    const scale = dpi / 96 || 1;
    const minRegion = Math.round(MIN_LYRIC_WIDTH_DIP * scale);

    // 图标整体居中时两侧都是空的，选更宽的一侧；左对齐时右侧才是空白区。
    const centerGap = Math.abs((iconsLeft + iconsRight) / 2 - (tr.left + rightLimit) / 2);
    const isCentered = centerGap < 60 * scale;

    const cfg = this._cfg;
    let region = null;
    if (cfg.position === 'left') {
      if (usableLeft >= minRegion) region = leftRegion;
      else if (usableRight >= minRegion) region = rightRegion;
    } else if (cfg.position === 'right') {
      if (usableRight >= minRegion) region = rightRegion;
      else if (usableLeft >= minRegion) region = leftRegion;
    } else if (isCentered) {
      if (usableLeft >= minRegion && usableLeft >= usableRight) region = leftRegion;
      else if (usableRight >= minRegion) region = rightRegion;
      else if (usableLeft >= minRegion) region = leftRegion;
    } else {
      if (usableRight >= minRegion) region = rightRegion;
      else if (usableLeft >= minRegion) region = leftRegion;
    }
    if (!region) return null;

    const anchor = region === leftRegion ? 'left' : 'right';
    return {
      region,
      anchor,
      isCentered,
      isLight: (() => {
        const light = _readTaskbarLightTheme();
        return light === null ? !nativeTheme.shouldUseDarkColors : light;
      })(),
      systemType: content ? 'win11' : 'win10',
      scale,
    };
  }

  _applyLayout(win, geo) {
    const cfg = this._cfg;
    const scale = geo.scale || 1;
    const region = geo.region;

    const availX = Math.round(region.left / scale) + cfg.leftMargin;
    const availY = Math.round(region.top / scale);
    const availWidth = Math.round((region.right - region.left) / scale) - cfg.leftMargin - cfg.rightMargin;
    const availHeight = Math.round((region.bottom - region.top) / scale);

    if (availWidth < MIN_LYRIC_WIDTH_DIP) return false;

    const windowWidth = cfg.autoMaxWidth ? availWidth : Math.min(cfg.maxWidth, availWidth);
    const windowX = geo.anchor === 'right' ? availX + availWidth - windowWidth : availX;

    this._region = {
      x: windowX,
      y: availY,
      maxWidth: windowWidth,
      height: availHeight,
      anchor: geo.anchor,
      isLight: geo.isLight,
      isCentered: geo.isCentered,
      systemType: geo.systemType,
    };

    const key = `${windowX},${availY},${windowWidth},${availHeight}`;
    if (key !== this._lastBoundsKey) {
      this._lastBoundsKey = key;
      this._layoutDirty = true;
      try {
        win.setBounds({ x: windowX, y: availY, width: windowWidth, height: availHeight });
      } catch { }
      this._lastShapeWidth = -1;
    }
    if (this._lastIsLight !== geo.isLight) {
      this._lastIsLight = geo.isLight;
      this._layoutDirty = true;
    }

    this._applyContentShape();
    this._attachNative(win);
    return true;
  }

  _applyContentShape() {
    const win = this._win;
    const region = this._region;
    if (!win || win.isDestroyed() || !region) return;

    const adjust = this._cfg.autoMaxWidth && this._cfg.autoAdjust;
    const target = adjust ? (this._contentWidth || region.maxWidth) : region.maxWidth;
    const shapeWidth = Math.min(region.maxWidth, Math.max(MIN_LYRIC_WIDTH_DIP, Math.round(target)));
    if (shapeWidth === this._lastShapeWidth) return;
    this._lastShapeWidth = shapeWidth;

    const x = region.anchor === 'right' ? region.maxWidth - shapeWidth : 0;
    try {
      win.setShape([{ x, y: 0, width: shapeWidth, height: region.height }]);
    } catch { }
  }

  _attachNative(win) {
    const api = _loadApi();
    if (!api) return;

    if (!this._hwnd) {
      try {
        const handle = win.getNativeWindowHandle();
        this._hwnd = handle.length >= 8
          ? Number(handle.readBigUInt64LE(0))
          : handle.readUInt32LE(0);
      } catch {
        this._hwnd = 0;
      }
    }
    if (!this._hwnd) return;

    // 用 owner 而不是 SetParent：explorer 重启时子窗口会被连带销毁并拖垮主进程。
    const taskbar = this._taskbarHwnd;
    if (taskbar && this._ownerHwnd !== taskbar) {
      try {
        api.SetWindowLongPtrW(this._hwnd, GWL_HWNDPARENT, taskbar);
        this._ownerHwnd = taskbar;
      } catch { }
    }

    if (!this._attached) {
      try {
        const ex = Number(api.GetWindowLongPtrW(this._hwnd, GWL_EXSTYLE)) | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE;
        api.SetWindowLongPtrW(this._hwnd, GWL_EXSTYLE, ex);
        this._attached = true;
      } catch { }
    }

    this._syncZOrder(api);
  }

  // 任务栏本身在 topmost 层，仅靠 owner 关系不够：不跟着置顶就会被任务栏整个盖住。
  _syncZOrder(api) {
    const taskbar = this._taskbarHwnd;
    if (!taskbar || !this._hwnd) return;
    let wantTopmost;
    try {
      const ex = Number(api.GetWindowLongPtrW(taskbar, GWL_EXSTYLE));
      wantTopmost = (ex & WS_EX_TOPMOST) !== 0;
    } catch {
      return;
    }
    if (this._lastTopmost === wantTopmost) return;
    this._lastTopmost = wantTopmost;
    try {
      api.SetWindowPos(
        this._hwnd,
        wantTopmost ? HWND_TOPMOST : HWND_NOTOPMOST,
        0, 0, 0, 0,
        SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE
      );
    } catch { }
  }

  dispose() {
    try {
      this._player.removeListener('track_changed', this._onTrackChanged);
      this._player.removeListener('lyrics_changed', this._onLyricsChanged);
      this._player.removeListener('position_changed', this._onPositionChanged);
      this._player.removeListener('state_changed', this._onStateChanged);
    } catch { }
    try {
      nativeTheme.removeListener('updated', this._onThemeUpdated);
    } catch { }
    try {
      ipcMain.removeListener('taskbar_lyrics:content_width', this._ipcContentWidth);
      ipcMain.removeListener('taskbar_lyrics:command', this._ipcCommand);
      ipcMain.removeListener('taskbar_lyrics:focus_main', this._ipcFocusMain);
    } catch { }
    this._disable();
    try { taskbarUia.dispose(); } catch { }
    this._started = false;
  }
}

module.exports = { TaskbarLyricsController, parseLyricLines };
