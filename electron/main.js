/**
 * Carminium — Electron 主进程入口
 * 应用主进程入口，管理窗口、后端模块与生命周期。
 */
'use strict';

const electron = require('electron');
const { app, BrowserWindow, shell, dialog } = electron;
const path = require('path');
const fs = require('fs');

// ── 全局异常捕获 ─────────────────────────────────────────────────────────────
process.on('uncaughtException', (err) => {
  console.error('[main] uncaughtException:', err);
  try { dialog.showErrorBox('Carminium 错误', String(err && err.stack || err)); } catch { /* ignore */ }
});

// ── Windows AppUserModelID（SMTC / 任务栏标识）─────────────────────────────
if (app && process.platform === 'win32') {
  app.setAppUserModelId('ProjectCarminium.Player');
}

// ── 单实例锁 ───────────────────────────────────────────────────────────────
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const win = _getMainWindow();
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
}

// ── 全局引用（防止被 GC 回收）────────────────────────────────────────────
let mainWindow = null;
let settings = null;
let library = null;
let player = null;
let coverServer = null;
let bridge = null;
let smtc = null;
let wasapi = null;

// ── 获取主窗口 ─────────────────────────────────────────────────────────────

function _getMainWindow() {
  return mainWindow;
}

// ── 创建主窗口 ─────────────────────────────────────────────────────────────

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 820,
    minWidth: 380,
    minHeight: 680,
    title: 'Project Carminium',
    show: false,
    autoHideMenuBar: true,
    frame: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  // 开发模式下打开 DevTools
  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  // 加载前端页面
  const indexPath = path.join(__dirname, '..', 'web', 'index.html');
  mainWindow.loadFile(indexPath);

  // 页面加载失败时输出错误
  mainWindow.webContents.on('did-fail-load', (_e, errorCode, errorDescription, validatedURL) => {
    console.error('[main] 页面加载失败:', errorCode, errorDescription, validatedURL);
  });

  // 窗口准备好后显示（避免白屏闪烁）
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    // 推送初始最大化状态
    _pushMaximizedState();
  });

  // 最大化/还原状态变化时通知渲染进程
  mainWindow.on('maximize', () => _pushMaximizedState());
  mainWindow.on('unmaximize', () => _pushMaximizedState());

  // 全屏状态变化时通知渲染进程
  mainWindow.on('enter-full-screen', () => _pushFullscreenState(true));
  mainWindow.on('leave-full-screen', () => _pushFullscreenState(false));

  // 在外部浏览器打开链接
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // 窗口关闭时清理
  mainWindow.on('closed', () => {
    mainWindow = null;
    if (bridge) bridge.close();
  });

  return mainWindow;
}

// ── 推送最大化状态到渲染进程 ─────────────────────────────────

function _pushMaximizedState() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    const isMaximized = mainWindow.isMaximized();
    mainWindow.webContents.executeJavaScript(
      'window.__updateMaximizedState && window.__updateMaximizedState(' + isMaximized + ')'
    ).catch(() => { /* ignore */ });
  }
}

function _pushFullscreenState(isFullscreen) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.executeJavaScript(
      'window.__updateFullscreenState && window.__updateFullscreenState(' + isFullscreen + ')'
    ).catch(() => { /* ignore */ });
  }
}

// ── 播放状态持久化 ─────────────────────────────────────────────────────────

function restorePlaybackState() {
  const state = settings.get('playback_state', {});
  if (!state || !state.track_id) return;

  const trackId = state.track_id;
  const positionMs = parseInt(state.position_ms, 10) || 0;
  const wasPlaying = !!state.was_playing;

  const track = library.getTrack(trackId);
  if (!track) return;

  // 检查本地文件是否存在
  if (track.source !== 'subsonic' && track.path) {
    if (!fs.existsSync(track.path)) return;
  }

  player.restoreState(track, positionMs, wasPlaying);
}

function savePlaybackState() {
  if (!player) return;
  const state = player.getPersistentState();
  settings.set('playback_state', state);
}

// ── 应用初始化 ─────────────────────────────────────────────────────────────

async function initializeApp() {
  try {
    const { AppSettings } = require('./settings');
    const { MusicLibrary } = require('./library');
    const { MusicPlayer } = require('./player');
    const { CoverHTTPServer } = require('./cover-server');
    const { Bridge } = require('./bridge');
    const { SmtcController } = require('./smtc');

    // ネイティブオーディオレンダラーを初期化（DLL が利用できない場合はスキップ）
    let NativeRenderer = null;
    try {
      ({ NativeRenderer } = require('./wasapi'));
    } catch (e) {
      console.warn('[main] Native audio module not available:', e.message);
    }

    settings = new AppSettings();
    library = new MusicLibrary(settings);

    try {
      wasapi = NativeRenderer ? new NativeRenderer() : null;
    } catch (e) {
      console.warn('[main] Native renderer not available:', e.message);
      wasapi = null;
    }

    player = new MusicPlayer(settings, library, wasapi);
    coverServer = new CoverHTTPServer(library);
    coverServer.start();

    // 注入媒体服务 URL 到播放器
    player.setMediaBaseUrl(coverServer.baseUrl);

    // 恢复音量
    const vol = settings.get('volume', 80);
    player.setVolume(parseInt(vol, 10) || 80);

    // 恢复播放状态
    restorePlaybackState();

    // ── 创建 Bridge ──────────────────────────────────────────────────────────
    bridge = new Bridge(library, player, settings, coverServer, wasapi);
    bridge.registerIpcHandlers();

    // ── 创建 SMTC 控制器 ─────────────────────────────────────────────────────
    smtc = new SmtcController(player, library, settings);
    smtc.setBridge(bridge);

    // ── 创建主窗口 ──────────────────────────────────────────────────────────
    createMainWindow();
    bridge.setMainWindow(mainWindow);
    smtc.setMainWindow(mainWindow);
  } catch (err) {
    console.error('[main] 初始化失败:', err);
    try { dialog.showErrorBox('Carminium 启动失败', String(err && err.stack || err)); } catch { /* ignore */ }
    app.quit();
  }
}

// ── 应用退出清理 ───────────────────────────────────────────────────────────

function shutdown() {
  try {
    if (player) player.stop();
  } catch { /* ignore */ }
  savePlaybackState();
  try {
    if (coverServer) coverServer.stop();
  } catch { /* ignore */ }
  try {
    if (library) library.close();
  } catch { /* ignore */ }
  try {
    if (player) player.close();
  } catch { /* ignore */ }
}

// ── App 事件 ───────────────────────────────────────────────────────────────

app.whenReady().then(async () => {
  await initializeApp();
});

app.on('window-all-closed', () => {
  shutdown();
  app.quit();
});

app.on('before-quit', () => {
  shutdown();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createMainWindow();
    if (bridge) bridge.setMainWindow(mainWindow);
    if (smtc) smtc.setMainWindow(mainWindow);
  }
});

// ── 安全：禁止导航到未知协议 ─────────────────────────────────────────────────
app.on('web-contents-created', (_e, contents) => {
  contents.on('will-navigate', (event, url) => {
    const parsed = new URL(url);
    const allowed = parsed.protocol === 'file:';
    if (!allowed) event.preventDefault();
  });
});
