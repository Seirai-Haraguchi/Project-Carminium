/**
 * Carminium — Electron 主进程入口
 * 应用主进程入口，管理窗口、后端模块与生命周期。
 */
'use strict';

// 全局禁用 TLS 证书验证（Subsonic 服务器常使用自签名证书）
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const electron = require('electron');
const { app, BrowserWindow, nativeImage, shell, dialog } = electron;
const path = require('path');
const fs = require('fs');
const { getInstance: getMemoryManager } = require('./memory_manager');

// ── 全局异常捕获 ─────────────────────────────────────────────────────────────
process.on('uncaughtException', (err) => {
  console.error('[main] uncaughtException:', err);
  try { dialog.showErrorBox('Carminium 错误', String(err && err.stack || err)); } catch { /* ignore */ }
});

// ── Windows AppUserModelID（SMTC / 任务栏标识）─────────────────────────────
/**
 * Windows SMTC "未知应用" 问题排查：
 *
 * SMTC 通过进程级 AUMID 查找应用显示名称。需满足：
 *   1. 进程级 AUMID 已设置（SetCurrentProcessExplicitAppUserModelID）
 *   2. 注册表 HKCU\Software\Classes\AppUserModelId\<AUMID> 下有 DisplayName / IconUri
 *   3. 图标路径持久可用（便携版每次解压到不同临时目录）
 *
 * 此前仅调用 app.setAppUserModelId()，但 Chromium 的 SMTC 会话使用
 * 进程级 AUMID，需要直接调用 SetCurrentProcessExplicitAppUserModelID。
 * 此外 reg 命令通过 cmd.exe 执行时，路径中的 %20 会被解释为变量引用，
 * 导致 IconUri 被破坏。改用 execFileSync 避免 shell 解释。
 */
const AUMID = 'Yunofactory.ProjectCarminium.Player';
const APP_DISPLAY_NAME = 'Project Carminium';

if (app && process.platform === 'win32') {
  app.setAppUserModelId(AUMID);

  // ── 0. 直接调用 SetCurrentProcessExplicitAppUserModelID ──
  // app.setAppUserModelId() 设置窗口级 AUMID，但 Chromium SMTC 使用进程级 AUMID。
  // 直接调用 Windows API 确保进程级 AUMID 被正确设置。
  let _shell32 = null;
  try {
    const koffi = require('koffi');
    _shell32 = koffi.load('shell32.dll');

    const SetCurrentProcessExplicitAppUserModelID = _shell32.func(
      'int32 SetCurrentProcessExplicitAppUserModelID(str16 appID)'
    );
    const hr = SetCurrentProcessExplicitAppUserModelID(AUMID);
    if (hr !== 0) {
      console.warn('[main] SetCurrentProcessExplicitAppUserModelID failed, HRESULT:', hr);
    } else {
      console.log('[main] Process AUMID set to:', AUMID);
    }
  } catch (e) {
    console.warn('[main] Failed to set process AUMID via koffi:', e.message);
  }

  const { execFileSync } = require('child_process');

  // 辅助函数：执行 reg 命令并捕获错误
  function _reg(args) {
    try {
      const output = execFileSync('reg', args, {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });
      return { ok: true, output };
    } catch (e) {
      const stderr = (e.stderr || '').toString().trim();
      console.warn('[main] reg command failed:', args.join(' '), stderr || e.message);
      return { ok: false, output: '', error: stderr || e.message };
    }
  }

  // ── 1. 将图标复制到稳定的持久路径 ──
  // 便携版每次解压到不同临时目录，注册表中的 IconUri 在应用关闭后失效。
  let iconUriValue = null;
  const appDataDir = process.env.APPDATA;

  if (appDataDir) {
    const stableDir = path.join(appDataDir, 'Carminium');
    const stableIconPath = path.join(stableDir, 'app-icon.png');
    const sourceIconPath = path.join(__dirname, '..', 'build', 'icon.png');

    try {
      if (!fs.existsSync(stableDir)) {
        fs.mkdirSync(stableDir, { recursive: true });
      }
      if (fs.existsSync(sourceIconPath)) {
        fs.copyFileSync(sourceIconPath, stableIconPath);
      }
      if (fs.existsSync(stableIconPath)) {
        // 不使用 %20 编码：file:/// 协议中空格可以直接使用，
        // %20 在 reg 命令中会被 cmd.exe 误解释为变量引用。
        iconUriValue = 'file:///' + stableIconPath.replace(/\\/g, '/');
      }
    } catch (e) {
      console.warn('[main] Failed to copy icon to stable path:', e.message);
    }
  }

  // 回退：使用源图标路径（开发模式）
  if (!iconUriValue) {
    const sourceIconPath = path.join(__dirname, '..', 'build', 'icon.png');
    if (fs.existsSync(sourceIconPath)) {
      iconUriValue = 'file:///' + sourceIconPath.replace(/\\/g, '/');
    }
  }

  // ── 2. 清理旧的 AUMID 注册表条目 ──
  try {
    const regParent = 'HKCU\\Software\\Classes\\AppUserModelId';
    const result = _reg(['QUERY', regParent]);
    if (result.ok && result.output) {
      const lines = result.output.split('\n').map(l => l.trim());
      for (const line of lines) {
        if (!line.startsWith(regParent + '\\')) continue;
        const subAumid = line.substring(regParent.length + 1);
        // 只清理包含 Carminium 或 Yunofactory 的旧条目
        if (subAumid !== AUMID &&
            (subAumid.includes('Carminium') || subAumid.includes('Yunofactory'))) {
          _reg(['DELETE', line, '/f']);
          console.log('[main] Cleaned up old AUMID registry entry:', subAumid);
        }
      }
    }
  } catch { /* ignore */ }

  // ── 3. 注册当前 AUMID 的显示名称和图标 ──
  const regKey = `HKCU\\Software\\Classes\\AppUserModelId\\${AUMID}`;

  const dnResult = _reg(['ADD', regKey, '/v', 'DisplayName', '/t', 'REG_SZ', '/d', APP_DISPLAY_NAME, '/f']);
  if (dnResult.ok) {
    console.log('[main] AUMID DisplayName registered:', APP_DISPLAY_NAME);
  }

  if (iconUriValue) {
    const iuResult = _reg(['ADD', regKey, '/v', 'IconUri', '/t', 'REG_SZ', '/d', iconUriValue, '/f']);
    if (iuResult.ok) {
      console.log('[main] AUMID IconUri registered:', iconUriValue);
    }
  }

  // ── 4. 验证注册表值 ──
  const verifyResult = _reg(['QUERY', regKey]);
  if (verifyResult.ok && verifyResult.output) {
    console.log('[main] AUMID registry verification:\n' + verifyResult.output.trim());
  } else {
    console.warn('[main] AUMID registry verification FAILED — values may not be set');
  }

  // ── 5. IFEO 兜底：通过 Image File Execution Options 注入进程级 AUMID ──
  // 开发模式下 electron.exe 的默认 AUMID 可能覆盖 SetCurrentProcessExplicitAppUserModelID。
  // IFEO 在进程创建时由 Windows 直接注入 AUMID，优先级高于运行时 API 调用。
  // 注意：这会影响所有使用同路径 electron.exe 的应用，退出时需清理。
  const exePath = process.execPath;
  if (exePath && exePath.toLowerCase().includes('electron')) {
    try {
      const ifeoKey = 'HKCU\\Software\\Microsoft\\Windows NT\\CurrentVersion\\Image File Execution Options\\' + exePath.replace(/\\/g, '\\');
      _reg(['ADD', ifeoKey, '/v', 'AppUserModelId', '/t', 'REG_SZ', '/d', AUMID, '/f']);
      console.log('[main] IFEO AUMID registered for:', exePath);
    } catch (e) {
      console.warn('[main] Failed to set IFEO AUMID:', e.message);
    }
  }

  // ── 6. 通知 Shell 刷新关联缓存 ──
  // SHCNE_ASSOCCHANGED = 0x08000000, SHCNF_IDLIST = 0x0000
  if (_shell32) {
    try {
      const SHChangeNotify = _shell32.func(
        'void SHChangeNotify(int32 wEventId, int32 uFlags, void *dwItem1, void *dwItem2)'
      );
      SHChangeNotify(0x08000000, 0x0000, null, null);
    } catch { /* non-critical */ }
  }
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
  // 加载应用图标
  const iconPath = path.join(__dirname, '..', 'build', 'icon.png');
  let appIcon = null;
  try {
    if (fs.existsSync(iconPath)) {
      appIcon = nativeImage.createFromPath(iconPath);
    }
  } catch { /* fallback: no icon */ }

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1280,
    minHeight: 720,
    title: 'Project Carminium',
    icon: appIcon,
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

  // F12 切换 DevTools
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'F12' && input.type === 'keyDown') {
      if (mainWindow.webContents.isDevToolsOpened()) {
        mainWindow.webContents.closeDevTools();
      } else {
        mainWindow.webContents.openDevTools({ mode: 'detach' });
      }
    }
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
  // 只有当前有曲目时才覆盖保存，避免快速关闭时丢失上次的状态
  if (state && state.track_id) {
    settings.set('playback_state', state);
  }
}

// ── 应用初始化 ─────────────────────────────────────────────────────────────

async function initializeApp() {
  try {
    // ── 启动主进程内存管理器 ──
    const memMgr = getMemoryManager();
    memMgr.start();

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

    // 非阻塞回填 genre（异步执行，不阻止启动）
    library.backfillGenres().catch(e => console.warn('[main] genre backfill failed:', e.message));

    try {
      wasapi = NativeRenderer ? new NativeRenderer() : null;
    } catch (e) {
      console.warn('[main] Native renderer not available:', e.message);
      wasapi = null;
    }

    player = new MusicPlayer(settings, library, wasapi);
    coverServer = new CoverHTTPServer(library);
    await coverServer.start();

    // 注入媒体服务 URL 到播放器
    player.setMediaBaseUrl(coverServer.baseUrl);

    // 恢复音量
    const vol = settings.get('volume', 80);
    player.setVolume(parseInt(vol, 10) || 80);

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

    // ── 启动库自动刷新（本地 FileWatcher + 远程定期 re-sync）──
    bridge.startAutoRefresh();

    // 恢复播放状态 — 延迟到渲染进程 AudioEngine 就绪后执行，
    // 避免 audio_control (init/play) 事件在窗口加载前丢失导致无声
    bridge.once('renderer-ready', () => {
      restorePlaybackState();
    });
  } catch (err) {
    console.error('[main] 初始化失败:', err);
    try { dialog.showErrorBox('Carminium 启动失败', String(err && err.stack || err)); } catch { /* ignore */ }
    app.quit();
  }
}

// ── 应用退出清理 ───────────────────────────────────────────────────────────

function shutdown() {
  try {
    // 停止内存管理器定时器
    const { getInstance: getMemoryManager } = require('./memory_manager');
    getMemoryManager().stop();
  } catch { /* ignore */ }
  try {
    if (player) player.stop();
  } catch { /* ignore */ }
  savePlaybackState();
  try {
    if (bridge) bridge.close();
  } catch { /* ignore */ }
  try {
    if (coverServer) coverServer.stop();
  } catch { /* ignore */ }
  try {
    if (library) library.close();
  } catch { /* ignore */ }
  try {
    if (player) player.close();
  } catch { /* ignore */ }
  // 清理 IFEO AUMID 注入（避免影响其他使用同路径 electron.exe 的应用）
  if (process.platform === 'win32') {
    try {
      const { execFileSync: _regExec } = require('child_process');
      const exePath = process.execPath;
      if (exePath && exePath.toLowerCase().includes('electron')) {
        const ifeoKey = 'HKCU\\Software\\Microsoft\\Windows NT\\CurrentVersion\\Image File Execution Options\\' + exePath.replace(/\\/g, '\\');
        _regExec('reg', ['DELETE', ifeoKey, '/v', 'AppUserModelId', '/f'], {
          stdio: 'ignore', windowsHide: true,
        }).catch(() => {});
      }
    } catch { /* ignore */ }
  }
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
