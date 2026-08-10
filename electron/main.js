/**
 * Carminium — Electron 主进程入口
 * 应用主进程入口，管理窗口、后端模块与生命周期。
 */
'use strict';

// 全局禁用 TLS 证书验证（Subsonic 服务器常使用自签名证书）
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const electron = require('electron');
const { app, BrowserWindow, nativeImage, shell, dialog, nativeTheme } = electron;
const path = require('path');
const fs = require('fs');
const { getInstance: getMemoryManager } = require('./memory_manager');

// ── Chromium 起動フラグ（SMTC アプリ名解決の要因）──────────────────────────
// Win11 24H2 で Chromium の mediaSession が生成する SMTC セッションが
// "不明なアプリ" になる問題に対する対処：
//   1. --enable-features=HardwareMediaKeyHandling,MediaSessionService
//      Chromium の SMTC 統合を明示的に有効化（既定で無効化されるケースがある）
//   2. --app-user-model-id=<AUMID>
//      Chromium 内部のメディアセッション識別子をプロセス AUMID と一致させる
//      （setAppUserModelId と同等だが、より低レイヤの Chromium 側にも伝播）
//   3. --disable-features=MediaSessionSegmentation
//      セッション分割無効化（24H2 で分離されたセッションが未登録 AUMID を使うのを防ぐ）
// 注意: app.whenReady() より前に appendSwitch すること。
app.commandLine.appendSwitch('enable-features',
  'HardwareMediaKeyHandling,MediaSessionService');

// ── 内存优化等级（在 app ready 之前从设置文件读取）──────────────────────────
// 三级优化：off（关闭）/ normal（常规，默认）/ aggressive（激进）
// Chromium 命令行开关必须在 app.whenReady() 之前设置，因此直接从磁盘读取
// settings.json，不走 AppSettings 类（它在 initializeApp 中才初始化）。
function _readMemOptLevel() {
  try {
    const os = require('os');
    const appdata = process.env.APPDATA || os.homedir();
    const settingsPath = path.join(appdata, 'Carminium', 'settings.json');
    if (fs.existsSync(settingsPath)) {
      const raw = fs.readFileSync(settingsPath, 'utf-8');
      const data = JSON.parse(raw);
      const lvl = data.memory_optimization;
      if (lvl === 'off' || lvl === 'normal' || lvl === 'aggressive') return lvl;
    }
  } catch (_) {}
  return 'normal'; // 默认常规优化
}
const _memOptLevel = _readMemOptLevel();
console.log('[main] Memory optimization level:', _memOptLevel);

// ── disable-features 列表定义 ──────────────────────────────────────────────
// 分为两批：normal（安全，VSCode 级别）和 aggressive（激进，额外裁剪）

// normal 级别：本应用确定不需要的后台服务和 Web API（约 80 项）
const _DISABLE_FEATURES_NORMAL = [
  'MediaSessionSegmentation',       // 避免 24H2 会话分裂导致未注册 AUMID
  'Translate',
  'MediaRouter',                    // Cast 投屏发现服务
  'OptimizationHints',
  'AutofillServerCommunication',
  'SpeechRecognitionOnDevice',
  'VoiceTranscription',
  'SitePerProcess',                 // 站点隔离：单源 file://，关闭安全
  'IsolateOrigins',
  'SpareRenderer',                  // 不预建备用渲染进程
  'RendererCodeIntegrity',
  'SharedDictionary',
  'CompressionDictionaryTransport',
  'PrivacySandbox',
  'FirstPartySets',
  'CookieDeprecationLabel',
  'FileSystemAccess',
  'WebBluetooth',
  'WebUSB',
  'WebHID',
  'WebMIDI',
  'Serial',
  'WebNFC',
  'Vulkan',
  'HeavyAdPrivacy',
  'SkiaGraphite',
  'Canvas2DLayers',
  'WebRtc',
  'WebCodecs',
  'WebLocks',
  'WebShare',
  'IdleDetection',
  'KeyboardLock',
  'Presentation',
  'RemotePlayback',
  'PaymentRequest',
  'WebOTP',
  'SmsReceiver',
  'ContentIndex',
  'BackgroundSync',
  'BackgroundFetch',
  'PeriodicBackgroundSync',
  'SharedWorker',
  'Notifications',
  'DesktopPWAs',
  'IsolatedWebApps',
  'WebAppStartup',
  'WebAppLinkHandling',
  'ChromeWhatsNewUI',
  'ReaderMode',
  'PreloadMediaEngagementData',
  'MediaEngagementBypassAutoplayPolicies',
  'NoStatePrefetch',
  'LoadingPredictor',
  'OptimizationGuidePredictionModels',
  'OptimizationGuidePushNotifications',
  'PageInfoAboutThisSite',
  'TextFragmentAnchor',
  'ScrollToTextFragment',
  'IntentPicker',
  'HatsOff',
  'CaptivePortal',
  'NetworkTimeService',
  'SafeBrowsing',
  'PasswordManager',
  'Autofill',
  'PushMessaging',
  'SendTabToSelf',
  'TabRestore',
  'LinkPreview',
  'FormPrediction',
  'FillingAssistance',
  'ExportTaggedPDF',
  'ExpectCT',
  'CertificateTransparency',
  'TrustTokens',
  'Reporting',
  'DocumentReport',
  'MediaDrm',
  'UserMediaCaptureAllOrigins',
  'GpuMemoryBufferVideoPipeline',
  'PictureInPicture',
  'DocumentPictureInPicture',
  'ContactsPicker',
  'InstalledApp',
  'WebAppProvider',
  'WebAppInstallService',
  'WebAppDatabase',
].join(',');

// aggressive 级别：在 normal 基础上追加裁剪（隐私/广告/UI/实验性 API 等）
const _DISABLE_FEATURES_AGGRESSIVE = [
  // 第三批：隐私/广告/测量 API
  'FedCm',
  'ConversionMeasurement',
  'Fledge',
  'AdInterestGroupAPI',
  'TopicsApi',
  'ThirdPartyStoragePartitioning',
  'ThirdPartyCookies',
  'SharedStorage',
  'SharedHeaders',
  'StorageAccessAPI',
  'PrivateAggregationApi',
  'PrivateNetworkAccessSendPreflights',
  'PrivateNetworkAccessRespectPreflight',
  'DragDropCrossOriginIframe',
  'CrossOriginOpenerPolicyAccessReporting',
  'CrossOriginAccessChecks',
  'CookieControlsRedescription',
  'RelatedSiteSet',
  // 第四批：Web API
  'WebGPU',
  'WebNN',
  'SanitizerAPI',
  'ViewTransition',
  'SpellCheck',
  'DigitalGoods',
  'ClickToCall',
  'Tts',
  'GenericSensor',
  'GenericSensorExtraClasses',
  'CdmDocumentStorage',
  'ScreenTime',
  'DeviceTrust',
  'AppBoundEncryption',
  'BluetoothPairingPermission',
  'ClientHintsDeviceModel',
  'AutoWebThemeColor',
  'DataUrlInCssRegistration',
  'DecodeJxl',
  'DeprecateUnload',
  'BeforeunloadEventV8',
  'DelayAsyncScriptExecution',
  'Prerender2',
  'PrerenderSinglePageAppNavigation',
  'SpeculationRules',
  'OptimizationGuide',
  'PreviewsOptHints',
  'ServiceWorkerImportedScriptBypassMainResourceCache',
  'SetIdleStatus',
  'ShareBundle',
  'SelfReportingApi',
  'StaleCacheValidity',
  'Snippets',
  'SystemAnimations',
  'CompositedSelectionBounds',
  'FluentScrollbar',
  'TabletMode',
  'V8VmFuture',
  // 第五批：Chrome UI / 功能
  'SidePanel',
  'SideSearch',
  'TabGroups',
  'TabHoverCards',
  'PinnedTab',
  'ChromeTips',
  'AhsFeedbackDialog',
  'HideOldFeedbackSurvey',
  'ProfilePicker',
  'IncognitoBrandConsistencyForDesktopShowsIncognito',
  'IncognitoDownloads',
  'Suggest',
  'SuggestDialog',
  'NtpCustomize',
  'Instant',
  'WebFeed',
  'ShoppingInsightsApi',
  'LensStub',
  'ContextualSearch',
  'SearchAdditionalParams',
  'SearchInCjk',
  'SyncInvalidations',
  'DropSync',
  'ExtensionContentVerification',
  'ExtensionForceInstall',
  'ManagedExtensions',
  'StrictExtensionIsolation',
  'ManagedConfiguration',
  'PdfPluginProxy',
  'PdfOcr',
  'PdfXfa',
  'PdfPluginSave',
  'PdfPluginUnresponsiveTimeout',
  'AlwaysOpenPdfExternally',
  'PreferHtmlOverPdf',
  'LongScreenshot',
  'Screenshot',
  'DebugHistory',
  'CriticalPathPersistedTrace',
  'AsyncStackFramesForInspector',
  'V8InspectorDeepStack',
  'ConsolidatedSiteStorageReset',
  'ContentSettingsAPI',
  'SiteData',
  'SiteDetails',
  'SiteEngagement',
  'SiteSettings',
  'SiteSettingsDataModel',
  'TopChromeUI',
  'ZeroCopyRasterizer',
  'GpuMemoryBufferVideoFramePool',
].join(',');

// 内存优化 enable-features（安全，normal 和 aggressive 都启用）
const _ENABLE_FEATURES_MEM = [
  'MemoryStoragePressureTracking',
  'LowEffortMemoryPressure',
  'TabFreezing',
  'CalculateNativeWinOcclusion',
  'ReduceAcceptLanguage',
  'BackForwardCache',
  'CompositeBGColorAfterPaint',
  'ReduceImageSize',
  'LazyFrameLoading',
  'LazyImageLoading',
  'CompositingOptimizations',
  'SkipOOMKill',
  'PartiallySkipEarlyMainResourceLoading',
  'MemoryCachePruning',
  'ReduceViewportIntersectionCheck',
  'FreezeBackgroundTabs',
  'ProcessSharingForCFM',
  'UnfreezableFeatureGate',
  'WebAudioGaplessPlaybackOptimization',
].join(',');

// ── 按等级应用 Chromium 开关 ────────────────────────────────────────────────
if (_memOptLevel === 'off') {
  // off：仅 SMTC 必需的 disable-features
  app.commandLine.appendSwitch('disable-features', 'MediaSessionSegmentation');

} else {
  // ── normal 和 aggressive 共有的基础开关 ──
  // 关闭本应用不需要的 Chromium 内置后台服务（借鉴 VSCode 策略）
  app.commandLine.appendSwitch('disable-background-networking');
  app.commandLine.appendSwitch('disable-component-update');
  app.commandLine.appendSwitch('disable-domain-reliability');
  app.commandLine.appendSwitch('disable-extensions');
  app.commandLine.appendSwitch('disable-plugins');
  app.commandLine.appendSwitch('disable-sync');
  app.commandLine.appendSwitch('disable-default-apps');
  app.commandLine.appendSwitch('disable-hang-monitor');
  app.commandLine.appendSwitch('disable-client-side-phishing-detection');
  app.commandLine.appendSwitch('disable-print-preview');
  app.commandLine.appendSwitch('disable-prompt-on-repost');
  app.commandLine.appendSwitch('disable-breakpad');
  app.commandLine.appendSwitch('disable-notifications');
  app.commandLine.appendSwitch('disable-presentation-api');
  app.commandLine.appendSwitch('disable-remote-playback');
  app.commandLine.appendSwitch('disable-speech-api');
  app.commandLine.appendSwitch('renderer-process-limit', '1');
  app.commandLine.appendSwitch('disable-gpu-watchdog');
  // HTTP 磁盘/媒体缓存封顶 8MB
  app.commandLine.appendSwitch('disk-cache-size', String(8 * 1024 * 1024));
  app.commandLine.appendSwitch('media-cache-size', String(8 * 1024 * 1024));

  // disable-features：normal 用基础列表，aggressive 追加激进列表
  if (_memOptLevel === 'aggressive') {
    app.commandLine.appendSwitch('disable-features',
      _DISABLE_FEATURES_NORMAL + ',' + _DISABLE_FEATURES_AGGRESSIVE);
  } else {
    app.commandLine.appendSwitch('disable-features', _DISABLE_FEATURES_NORMAL);
  }

  // enable-features：内存优化特性
  app.commandLine.appendSwitch('enable-features', _ENABLE_FEATURES_MEM);

  if (_memOptLevel === 'aggressive') {
    // ── aggressive 独有开关 ──
    // GPU / 渲染管线裁剪（本应用是 Canvas2D 音乐播放器，不需要 WebGL/WebGPU/颜色管理）
    // --disable-gpu：彻底关闭 GPU 硬件加速，强制软件渲染。
    // 消除 GPU 进程的 D3D11 渲染管线（着色器编译、纹理分配、合成器线程等），
    // 省约 30-80MB。Canvas2D 软件渲染对本音乐播放器完全够用。
    app.commandLine.appendSwitch('disable-gpu');
    app.commandLine.appendSwitch('disable-color-correct-rendering');
    app.commandLine.appendSwitch('force-color-profile', 'srgb');
    app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');
    app.commandLine.appendSwitch('disable-gpu-driver-bug-workarounds');
    app.commandLine.appendSwitch('disable-accelerated-video-decode');
    app.commandLine.appendSwitch('disable-accelerated-mjpeg-decode');
    app.commandLine.appendSwitch('disable-webgl-image-chromium');
    app.commandLine.appendSwitch('disable-2d-canvas-image-chromium');
    app.commandLine.appendSwitch('disable-frame-rate-overlay');

    // GPU 沙箱 + 渲染进程沙箱裁剪
    app.commandLine.appendSwitch('disable-gpu-sandbox');
    app.commandLine.appendSwitch('no-sandbox');

    // Chromium 低内存模式（最强力的单开关，触发一整套内部优化策略）
    app.commandLine.appendSwitch('enable-low-end-device-mode');
  }
}

// ── GPU 进程合并（默认关闭）───────────────────────────────────────────────
// 将 GPU 进程并入浏览器进程可省掉独立 GPU 进程基线（~30-60MB），但 Windows 上
// --in-process-gpu + 无边框自绘标题栏（frame:false）+ 某些 GPU 驱动组合会
// 偶发白屏/画面不刷新，因此默认关闭。
// 需要时可设置环境变量 CARMINIUM_IN_PROCESS_GPU=1 开启并实测稳定性。
if (process.env.CARMINIUM_IN_PROCESS_GPU === '1') {
  app.commandLine.appendSwitch('in-process-gpu');
  console.log('[main] in-process-gpu enabled');
}

// ── V8 堆内存限制 + GC 策略优化（按等级）─────────────────────────────────
// v8.setFlagsFromString 只作用于当前（主进程）V8 实例，不影响渲染进程/GPU 进程。
if (_memOptLevel === 'aggressive') {
  // aggressive：96MB 堆 + GC 优化标志
  require('v8').setFlagsFromString(
    '--max-old-space-size=96 ' +
    '--max-semi-space-size=8 ' +
    '--gc-global ' +
    '--stress-incremental-marking ' +
    '--reuse-registers'
  );
} else if (_memOptLevel === 'normal') {
  // normal：128MB 堆，不加激进 GC 标志
  require('v8').setFlagsFromString('--max-old-space-size=128');
}
// off：不限制 V8 堆，使用 Chromium 默认

// 导出等级供 memory_manager 使用
app._memOptLevel = _memOptLevel;

// ── 全局异常捕获 ─────────────────────────────────────────────────────────────
process.on('uncaughtException', (err) => {
  console.error('[main] uncaughtException:', err);
  try { dialog.showErrorBox('Carminium 错误', String(err && err.stack || err)); } catch { /* ignore */ }
});

// ── Windows AppUserModelID（SMTC / 任务栏标识）─────────────────────────────
/**
 * Windows SMTC "未知应用" 问题排查（Win11 24H2 + Chromium 130+）：
 *
 * SMTC 通过进程级 AUMID 查找应用显示名称。需满足：
 *   1. 进程级 AUMID 已设置（SetCurrentProcessExplicitAppUserModelID）
 *   2. 注册表 HKCU\Software\Classes\AppUserModelId\<AUMID> 下有 DisplayName / IconUri
 *   3. 图标路径持久可用（便携版每次解压到不同临时目录）
 *   4. 渲染进程的 <audio> 元素与 document.title 提供应用名回退
 *      （Chromium 在 AUMID 查询失败时会回退到媒体元素/文档标题）
 *
 * 此前仅调用 app.setAppUserModelId()，但 Chromium 的 SMTC 会话使用
 * 进程级 AUMID，需要直接调用 SetCurrentProcessExplicitAppUserModelID。
 * 此外 reg 命令通过 cmd.exe 执行时，路径中的 %20 会被解释为变量引用，
 * 导致 IconUri 被破坏。改用 execFileSync 避免 shell 解释。
 */
const AUMID = 'Yunofactory.ProjectCarminium.Player';
const APP_DISPLAY_NAME = 'Project Carminium';

// app.name 应保持为用户可见的显示名。
// 将它误设为 AUMID 会让 Chromium / Windows 的部分回退链路拿到内部标识，
// 进而无法把媒体会话正确显示为应用名。
app.setName(APP_DISPLAY_NAME);

// Chromium の内部 AUMID もプロセス AUMID と一致させる。
// setAppUserModelId はウィンドウレベルだが、--app-user-model-id は
// Chromium の BrowserProcess レベルに伝播し、SMTC セッション生成時に使われる。
app.commandLine.appendSwitch('app-user-model-id', AUMID);

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

  function _escapePowerShellSingleQuoted(value) {
    return String(value || '').replace(/'/g, "''");
  }

  function _sanitizeShortcutName(name) {
    const normalized = String(name || '')
      .replace(/[<>:"/\\|?*\u0000-\u001F]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return normalized || APP_DISPLAY_NAME;
  }

  function _ensureStartMenuShortcut(aumid, displayName, targetPath, iconPath) {
    if (!aumid || !displayName || !targetPath) return null;

    const shortcutName = _sanitizeShortcutName(displayName);
    const script = `
$ErrorActionPreference = 'Stop'
$shortcutName = '${_escapePowerShellSingleQuoted(shortcutName)}'
$targetPath = '${_escapePowerShellSingleQuoted(targetPath)}'
$aumid = '${_escapePowerShellSingleQuoted(aumid)}'
$iconPath = '${_escapePowerShellSingleQuoted(iconPath || '')}'
$workingDir = [System.IO.Path]::GetDirectoryName($targetPath)
$startMenuDir = [Environment]::GetFolderPath('Programs')
$shortcutPath = Join-Path $startMenuDir ($shortcutName + '.lnk')

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;

[ComImport, Guid("00021401-0000-0000-C000-000000000046")]
internal class CShellLink {}

[ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("000214F9-0000-0000-C000-000000000046")]
internal interface IShellLinkW
{
    void GetPath([Out, MarshalAs(UnmanagedType.LPWStr)] System.Text.StringBuilder pszFile, int cch, out WIN32_FIND_DATAW pfd, uint fFlags);
    void GetIDList(out IntPtr ppidl);
    void SetIDList(IntPtr pidl);
    void GetDescription([Out, MarshalAs(UnmanagedType.LPWStr)] System.Text.StringBuilder pszName, int cch);
    void SetDescription([MarshalAs(UnmanagedType.LPWStr)] string pszName);
    void GetWorkingDirectory([Out, MarshalAs(UnmanagedType.LPWStr)] System.Text.StringBuilder pszDir, int cch);
    void SetWorkingDirectory([MarshalAs(UnmanagedType.LPWStr)] string pszDir);
    void GetArguments([Out, MarshalAs(UnmanagedType.LPWStr)] System.Text.StringBuilder pszArgs, int cch);
    void SetArguments([MarshalAs(UnmanagedType.LPWStr)] string pszArgs);
    void GetHotkey(out short pwHotkey);
    void SetHotkey(short wHotkey);
    void GetShowCmd(out int piShowCmd);
    void SetShowCmd(int iShowCmd);
    void GetIconLocation([Out, MarshalAs(UnmanagedType.LPWStr)] System.Text.StringBuilder pszIconPath, int cch, out int piIcon);
    void SetIconLocation([MarshalAs(UnmanagedType.LPWStr)] string pszIconPath, int iIcon);
    void SetRelativePath([MarshalAs(UnmanagedType.LPWStr)] string pszPathRel, uint dwReserved);
    void Resolve(IntPtr hwnd, uint fFlags);
    void SetPath([MarshalAs(UnmanagedType.LPWStr)] string pszFile);
}

[ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("0000010b-0000-0000-C000-000000000046")]
internal interface IPersistFile
{
    void GetClassID(out Guid pClassID);
    void IsDirty();
    void Load([MarshalAs(UnmanagedType.LPWStr)] string pszFileName, uint dwMode);
    void Save([MarshalAs(UnmanagedType.LPWStr)] string pszFileName, bool fRemember);
    void SaveCompleted([MarshalAs(UnmanagedType.LPWStr)] string pszFileName);
    void GetCurFile([MarshalAs(UnmanagedType.LPWStr)] out string ppszFileName);
}

[ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99")]
internal interface IPropertyStore
{
    uint GetCount(out uint cProps);
    uint GetAt(uint iProp, out PROPERTYKEY pkey);
    uint GetValue(ref PROPERTYKEY key, out PROPVARIANT pv);
    uint SetValue(ref PROPERTYKEY key, ref PROPVARIANT pv);
    uint Commit();
}

[StructLayout(LayoutKind.Sequential)]
internal struct PROPERTYKEY
{
    public Guid fmtid;
    public uint pid;

    public PROPERTYKEY(Guid formatId, uint propertyId)
    {
        fmtid = formatId;
        pid = propertyId;
    }
}

[StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
internal struct WIN32_FIND_DATAW
{
    public uint dwFileAttributes;
    public System.Runtime.InteropServices.ComTypes.FILETIME ftCreationTime;
    public System.Runtime.InteropServices.ComTypes.FILETIME ftLastAccessTime;
    public System.Runtime.InteropServices.ComTypes.FILETIME ftLastWriteTime;
    public uint nFileSizeHigh;
    public uint nFileSizeLow;
    public uint dwReserved0;
    public uint dwReserved1;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)]
    public string cFileName;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 14)]
    public string cAlternateFileName;
}

[StructLayout(LayoutKind.Explicit)]
internal struct PROPVARIANT
{
    [FieldOffset(0)]
    public ushort vt;
    [FieldOffset(8)]
    public IntPtr pointerValue;

    public static PROPVARIANT FromString(string value)
    {
        var pv = new PROPVARIANT();
        pv.vt = 31; // VT_LPWSTR
        pv.pointerValue = Marshal.StringToCoTaskMemUni(value);
        return pv;
    }

    public void Clear()
    {
        PropVariantClear(ref this);
    }

    [DllImport("ole32.dll")]
    private static extern int PropVariantClear(ref PROPVARIANT pvar);
}

public static class ShortcutHelper
{
    private static readonly PROPERTYKEY PKEY_AppUserModel_ID =
        new PROPERTYKEY(new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3"), 5);

    public static void CreateShortcut(string shortcutPath, string targetPath, string workingDir, string displayName, string iconPath, string aumid)
    {
        var shellLink = (IShellLinkW)new CShellLink();
        shellLink.SetPath(targetPath);
        shellLink.SetWorkingDirectory(workingDir);
        shellLink.SetDescription(displayName);
        if (!string.IsNullOrWhiteSpace(iconPath))
        {
            shellLink.SetIconLocation(iconPath, 0);
        }

        var propertyStore = (IPropertyStore)shellLink;
        var appIdVariant = PROPVARIANT.FromString(aumid);
        try
        {
            var appUserModelIdKey = PKEY_AppUserModel_ID;
            uint hr = propertyStore.SetValue(ref appUserModelIdKey, ref appIdVariant);
            if (hr != 0) Marshal.ThrowExceptionForHR((int)hr);
            hr = propertyStore.Commit();
            if (hr != 0) Marshal.ThrowExceptionForHR((int)hr);
        }
        finally
        {
            appIdVariant.Clear();
        }

        ((IPersistFile)shellLink).Save(shortcutPath, true);
    }
}
'@

[ShortcutHelper]::CreateShortcut($shortcutPath, $targetPath, $workingDir, $shortcutName, $iconPath, $aumid)
Write-Output $shortcutPath
`;

    try {
      const output = execFileSync('powershell.exe', [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy', 'Bypass',
        '-STA',
        '-Command', script,
      ], {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });
      return output.trim().split(/\r?\n/).filter(Boolean).pop() || null;
    } catch (e) {
      const stderr = (e.stderr || '').toString().trim();
      console.warn('[main] Failed to create Start Menu shortcut:', stderr || e.message);
      return null;
    }
  }

  // ── 1. 将图标复制到稳定的持久路径 ──
  // 便携版每次解压到不同临时目录，注册表中的 IconUri 在应用关闭后失效。
  // 注意: Win11 24H2 は file:/// URL の解釈がバグってることがあるため、
  // IconUri にはプレーンな絶対パスを使う（file:// プレフィックス無し）。
  // さらに重要: Windows SMTC の IconUri は .ico 形式を強く期待する。
  // .png ではアイコンを取得できず「不明なアプリ」になる既知のバグがあるため、
  // 起動時に .png を ICO コンテナに包んで .ico ファイルとして登録する。
  let iconUriValue = null;
  let iconPathForLog = null;
  const appDataDir = process.env.APPDATA;

  /**
   * PNG ファイルを PNG-in-ICO 形式の .ico ファイルとして保存する（同期版）。
   * Windows Vista 以降は ICO コンテナ内に PNG を直接格納でき、
   * Windows は表示時に適切なサイズへ自動スケーリングする。
   * 構造: ICONDIR(6B) + ICONDIRENTRY(16B) + PNG データ
   */
  function _generateIcoFromPngSync(pngPath, icoPath) {
    const pngBuffer = fs.readFileSync(pngPath);
    const w = pngBuffer.readUInt32BE(16);   // IHDR width offset
    const h = pngBuffer.readUInt32BE(20);   // IHDR height offset

    const icoHeader = Buffer.alloc(6);
    icoHeader.writeUInt16LE(0, 0);     // reserved
    icoHeader.writeUInt16LE(1, 2);     // type = 1 (icon)
    icoHeader.writeUInt16LE(1, 4);     // count = 1 image

    const icoEntry = Buffer.alloc(16);
    // 256 以上は 0 を設定（ICO 仕様で 0 = 256 を意味する）
    icoEntry.writeUInt8(w >= 256 ? 0 : w, 0);
    icoEntry.writeUInt8(h >= 256 ? 0 : h, 1);
    icoEntry.writeUInt8(0, 2);          // color count
    icoEntry.writeUInt8(0, 3);          // reserved
    icoEntry.writeUInt16LE(1, 4);       // planes
    icoEntry.writeUInt16LE(32, 6);      // bit count
    icoEntry.writeUInt32LE(pngBuffer.length, 8);  // bytes in res
    icoEntry.writeUInt32LE(22, 12);     // image offset (6 + 16)

    const icoBuffer = Buffer.concat([icoHeader, icoEntry, pngBuffer]);
    fs.writeFileSync(icoPath, icoBuffer);
    return icoPath;
  }

  if (appDataDir) {
    const stableDir = path.join(appDataDir, 'Carminium');
    const stableIcoPath = path.join(stableDir, 'app-icon.ico');
    const sourceIconPath = path.join(__dirname, '..', 'build', 'icon.png');

    try {
      if (!fs.existsSync(stableDir)) {
        fs.mkdirSync(stableDir, { recursive: true });
      }
      if (fs.existsSync(sourceIconPath)) {
        try {
          _generateIcoFromPngSync(sourceIconPath, stableIcoPath);
          console.log('[main] Generated ICO file:', stableIcoPath);
        } catch (icoErr) {
          console.warn('[main] Failed to generate ICO:', icoErr.message);
        }
      }
      if (fs.existsSync(stableIcoPath)) {
        iconUriValue = stableIcoPath;
        iconPathForLog = stableIcoPath;
      } else if (fs.existsSync(sourceIconPath)) {
        // .ico 生成失敗時のフォールバック
        iconUriValue = sourceIconPath;
        iconPathForLog = sourceIconPath;
      }
    } catch (e) {
      console.warn('[main] Failed to copy icon to stable path:', e.message);
    }
  }

  // 回退：使用源图标路径（开发模式）
  if (!iconUriValue) {
    const sourceIconPath = path.join(__dirname, '..', 'build', 'icon.png');
    const fallbackIcoPath = path.join(__dirname, '..', 'build', 'app-icon.ico');
    if (fs.existsSync(sourceIconPath)) {
      // フォールバック時も .ico を生成して使う
      try {
        _generateIcoFromPngSync(sourceIconPath, fallbackIcoPath);
        iconUriValue = fallbackIcoPath;
        iconPathForLog = fallbackIcoPath;
        console.log('[main] Generated fallback ICO:', fallbackIcoPath);
      } catch (icoErr) {
        // .ico 生成に失敗した場合は .png をそのまま使う
        iconUriValue = sourceIconPath;
        iconPathForLog = sourceIconPath;
      }
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
  // Windows 任务管理器通过以下注册表项来识别和折叠同一应用的多个进程：
  //   - DisplayName:   应用显示名称
  //   - IconResource:  任务管理器中显示的图标（格式："可执行文件路径,图标索引"）
  //   - IconUri:       SMTC / 任务栏使用的图标 URI
  //   - TaskManagerAppId: 显式声明此 AUMID 对应的任务管理器分组 ID
  //   - CustomDestList: 跳转列表（Jump List）存储位置
  //
  // 关键点：
  //   IconResource 必须指向实际的可执行文件（如 electron.exe 或便携版 .exe），
  //   而不是 .ico/.png 文件。Windows 会从该 PE 文件中提取图标资源。
  //   如果 IconResource 缺失或指向不存在的文件，任务管理器将无法正确折叠子进程。
  const regKey = `HKCU\\Software\\Classes\\AppUserModelId\\${AUMID}`;

  const dnResult = _reg(['ADD', regKey, '/v', 'DisplayName', '/t', 'REG_SZ', '/d', APP_DISPLAY_NAME, '/f']);
  if (dnResult.ok) {
    console.log('[main] AUMID DisplayName registered:', APP_DISPLAY_NAME);
  }

  // ── IconResource：任务管理器进程分组的关键 ──
  // 格式为 "exe路径,图标索引"。Windows Shell 用它来：
  //   1. 在任务管理器中显示应用图标
  //   2. 将所有具有相同 AUMID 的进程折叠到同一个条目下
  //
  // ⚠️ 重要：Portable 模式下 exe 被解压到临时目录（如 Temp\...），每次路径不同。
  // 如果 IconResource 指向临时路径，下次运行时路径失效，任务管理器无法分组。
  // 解决方案：找到解压后的实际 electron.exe 并复制到稳定路径（%APPDATA%\Carminium\app.exe）。
  const iconExePath = process.execPath || '';
  let iconResourceValue = null;
  let iconResourceSource = 'direct';

  if (iconExePath) {
    // 检测是否为 portable 模式（exe 在 Temp 目录中）
    const isPortable = iconExePath.toLowerCase().includes('\\temp\\') ||
                       iconExePath.toLowerCase().includes('\\tmp\\');

    if (isPortable && appDataDir) {
      // Portable 模式：找到解压后的实际 electron.exe
      // electron-builder portable 会将内容解压到临时目录，结构如下：
      //   Temp\xxx\  ← 临时目录（process.execPath 指向这里的 stub exe）
      //   Temp\xxx\app.exe  ← 实际的 electron.exe（重命名后的）
      // 我们需要找到这个实际的 exe，而不是自解压 stub
      let actualExePath = iconExePath;
      const exeDir = path.dirname(iconExePath);

      // 尝试找到同目录下的实际应用 exe（非 stub）
      // electron-builder portable 的 stub 通常很小（<1MB），而实际 exe 较大（>100MB）
      try {
        const stubStat = fs.statSync(iconExePath);
        if (stubStat.size < 5 * 1024 * 1024) { // 小于 5MB 认为是 stub
          // 查找同目录下最大的 .exe 文件（实际 electron.exe）
          const entries = fs.readdirSync(exeDir);
          let largestExe = null;
          let largestSize = 0;
          for (const entry of entries) {
            if (entry.toLowerCase().endsWith('.exe')) {
              const entryPath = path.join(exeDir, entry);
              try {
                const stat = fs.statSync(entryPath);
                if (stat.isFile() && stat.size > largestSize) {
                  largestSize = stat.size;
                  largestExe = entryPath;
                }
              } catch { /* ignore */ }
            }
          }
          if (largestExe && largestExe !== iconExePath) {
            actualExePath = largestExe;
            console.log('[main] Found actual exe in portable temp dir:', actualExePath, 'size:', largestSize);
          }
        }
      } catch (e) {
        console.warn('[main] Failed to find actual exe in portable dir:', e.message);
      }

      // 将实际 exe 复制到稳定路径
      const stableExeDir = path.join(appDataDir, 'Carminium');
      const stableExePath = path.join(stableExeDir, 'Carminium.exe');

      try {
        if (!fs.existsSync(stableExeDir)) {
          fs.mkdirSync(stableExeDir, { recursive: true });
        }
        // 复制 exe（如果文件不存在或大小不同）
        let needCopy = true;
        if (fs.existsSync(stableExePath)) {
          const srcStat = fs.statSync(actualExePath);
          const dstStat = fs.statSync(stableExePath);
          needCopy = srcStat.size !== dstStat.size || srcStat.mtime.getTime() !== dstStat.mtime.getTime();
        }
        if (needCopy) {
          fs.copyFileSync(actualExePath, stableExePath);
          console.log('[main] Copied portable exe to stable path:', stableExePath);
        }
        iconResourceValue = `${stableExePath},0`;
        iconResourceSource = 'stable-copy';
      } catch (e) {
        console.warn('[main] Failed to copy exe to stable path:', e.message);
        // 回退到直接使用实际 exe 路径（至少当前会话有效）
        iconResourceValue = `${actualExePath},0`;
      }
    } else {
      // 开发模式或已安装模式：直接使用 exe 路径
      iconResourceValue = `${iconExePath},0`;
    }

    if (iconResourceValue) {
      _reg(['DELETE', regKey, '/v', 'IconResource', '/f']);
      const irResult = _reg(['ADD', regKey, '/v', 'IconResource', '/t', 'REG_SZ', '/d', iconResourceValue, '/f']);
      if (irResult.ok) {
        console.log('[main] AUMID IconResource registered (' + iconResourceSource + '):', iconResourceValue);
      } else {
        console.warn('[main] AUMID IconResource registration FAILED');
      }
    }
  } else {
    console.warn('[main] No execPath available — IconResource will not be set');
  }

  // ── TaskManagerAppId：显式指定任务管理器分组标识 ──
  // 此值告诉 Windows 任务管理器："将所有带有此 AppUserModelID 的进程归为一组"。
  // 虽然通常 AUMID 本身就足够，但某些 Windows 版本（特别是 Win10 1809+ 和 Win11）
  // 在 Electron 多进程架构下需要此项才能正确折叠 GPU/Renderer/Utility 子进程。
  _reg(['DELETE', regKey, '/v', 'TaskManagerAppId', '/f']);
  const tmaResult = _reg(['ADD', regKey, '/v', 'TaskManagerAppId', '/t', 'REG_SZ', '/d', AUMID, '/f']);
  if (tmaResult.ok) {
    console.log('[main] AUMID TaskManagerAppId registered:', AUMID);
  } else {
    console.warn('[main] AUMID TaskManagerAppId registration FAILED');
  }

  // ── CustomDestList：跳转列表存储路径 ──
  // 声明后 Windows 会在指定路径创建 Automatic Destinations (.autorel) 文件，
  // 用于最近文档列表和 pinned 项目。同时帮助 Shell 正确关联进程。
  const appDataLocal = process.env.LOCALAPPDATA;
  if (appDataLocal) {
    const destListDir = path.join(appDataLocal, 'Microsoft', 'Windows', 'Recent', 'CustomDestinations');
    // 使用 AUMID 的哈希作为文件名（与 Windows Shell 约定一致）
    let destListFile = '';
    try {
      // 简单哈希：取 AUMID 各字符 code 的总和作为 16 进制字符串
      let hash = 0;
      for (let i = 0; i < AUMID.length; i++) {
        hash = ((hash << 5) - hash + AUMID.charCodeAt(i)) | 0;
      }
      destListFile = Math.abs(hash).toString(16).padStart(8, '0') + '.autorel';
    } catch { /* fallback */ }
    if (destListFile) {
      const customDestListValue = path.join(destListDir, destListFile);
      _reg(['DELETE', regKey, '/v', 'CustomDestList', '/f']);
      const cdlResult = _reg(['ADD', regKey, '/v', 'CustomDestList', '/t', 'REG_SZ', '/d', customDestListValue, '/f']);
      if (cdlResult.ok) {
        console.log('[main] AUMID CustomDestList registered:', customDestListValue);
      }
      // 不打印 FAILED 日志——非关键功能
    }
  }

  if (iconUriValue) {
    // 既存の IconUri を明示的に削除してから再設定（24H2 で古い file:/// 値がキャッシュされるのを防ぐ）
    _reg(['DELETE', regKey, '/v', 'IconUri', '/f']);
    const iuResult = _reg(['ADD', regKey, '/v', 'IconUri', '/t', 'REG_SZ', '/d', iconUriValue, '/f']);
    if (iuResult.ok) {
      console.log('[main] AUMID IconUri registered (absolute path):', iconUriValue);
    } else {
      console.warn('[main] AUMID IconUri registration FAILED');
    }
  } else {
    console.warn('[main] No icon path available — IconUri will not be set');
  }

  // ── 3.5. Start Menu 快捷方式 ──
  // Windows Shell 对“可见应用名”的解析更依赖 Start Menu 中已注册的应用项。
  // 对便携 / 未打包为 MSIX 的应用，仅设置 AUMID 往往仍会显示“未知应用”。
  const startMenuShortcut = _ensureStartMenuShortcut(
    AUMID,
    APP_DISPLAY_NAME,
    process.execPath,
    iconUriValue
  );
  if (startMenuShortcut) {
    console.log('[main] Start Menu shortcut ensured:', startMenuShortcut);
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
  // これにより Windows Shell が AUMID → 表示名/アイコンのキャッシュを再構築する。
  // SMTC が「不明なアプリ」になる原因の多くは、このキャッシュ更新が漏れること。
  if (_shell32) {
    try {
      const SHChangeNotify = _shell32.func(
        'void SHChangeNotify(int32 wEventId, int32 uFlags, void *dwItem1, void *dwItem2)'
      );
      SHChangeNotify(0x08000000, 0x0000, null, null);
      console.log('[main] SHChangeNotify(SHCNE_ASSOCCHANGED) sent — Shell cache refreshed');
    } catch (e) {
      console.warn('[main] SHChangeNotify failed:', e.message);
    }
  }

  console.log('[main] === AUMID registration complete ===');
  console.log('[main]   AUMID:', AUMID);
  console.log('[main]   DisplayName:', APP_DISPLAY_NAME);
  console.log('[main]   IconResource:', iconResourceValue || '(none)');
  console.log('[main]   TaskManagerAppId:', AUMID);
  console.log('[main]   IconUri:', iconPathForLog || '(none)');
  console.log('[main]   Icon format:', iconPathForLog && iconPathForLog.endsWith('.ico') ? 'ICO' : 'PNG');

  // ── 任务栏按钮 / SMTC 图标随系统暗色模式切换 ──
  // 上面注册的 IconUri 固定来自 icon.png（亮色）。系统主题变化时必须重生成对应主题的
  // .ico 并更新注册表 IconUri，否则任务栏按钮与 SMTC 媒体控件图标都不会变
  // （这两处读的是 AUMID 的 IconUri，与 win.setIcon 控制的窗口/Alt+Tab 图标无关）。
  function _updateAumidIconIco(isDark) {
    const appDataDir = process.env.APPDATA;
    if (!appDataDir) return;
    const stableDir = path.join(appDataDir, 'Carminium');
    const stableIcoPath = path.join(stableDir, 'app-icon.ico');
    const sourceName = isDark ? 'icon-dark.png' : 'icon.png';
    const sourceIconPath = path.join(__dirname, '..', 'build', sourceName);
    try {
      if (!fs.existsSync(stableDir)) fs.mkdirSync(stableDir, { recursive: true });
      if (!fs.existsSync(sourceIconPath)) {
        console.warn('[main] Missing source icon for theme:', sourceIconPath);
        return;
      }
      _generateIcoFromPngSync(sourceIconPath, stableIcoPath);
      const regKey = 'HKCU\\Software\\Classes\\AppUserModelId\\' + AUMID;
      _reg(['DELETE', regKey, '/v', 'IconUri', '/f']);
      _reg(['ADD', regKey, '/v', 'IconUri', '/t', 'REG_SZ', '/d', stableIcoPath, '/f']);
      if (_shell32) {
        try {
          const SHChangeNotify = _shell32.func(
            'void SHChangeNotify(int32 wEventId, int32 uFlags, void *dwItem1, void *dwItem2)'
          );
          SHChangeNotify(0x08000000, 0x0000, null, null);
        } catch (e) { /* ignore */ }
      }
      console.log('[main] AUMID IconUri updated to', isDark ? 'dark' : 'light', '->', stableIcoPath);
    } catch (e) {
      console.warn('[main] Failed to update AUMID IconUri:', e.message);
    }
  }

  // 启动即按系统主题生成正确的 .ico（覆盖上面固定的亮色 icon.png）
  _updateAumidIconIco(nativeTheme.shouldUseDarkColors);

  // 系统主题变化时实时更新任务栏按钮 / SMTC 图标
  nativeTheme.on('updated', () => {
    _updateAumidIconIco(nativeTheme.shouldUseDarkColors);
  });
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

/**
 * 根据暗色模式加载对应的应用图标。
 * 暗色模式下使用 icon-dark.png，亮色模式下使用 icon.png，
 * 缺失时回退到另一套图标，保证始终有可用图标。
 * @param {boolean} isDark
 * @returns {Electron.NativeImage|null}
 */
function _loadAppIcon(isDark) {
  const primary = isDark ? 'icon-dark.png' : 'icon.png';
  const fallback = isDark ? 'icon.png' : 'icon-dark.png';
  for (const name of [primary, fallback]) {
    const iconPath = path.join(__dirname, '..', 'build', name);
    try {
      if (fs.existsSync(iconPath)) return nativeImage.createFromPath(iconPath);
    } catch { /* 尝试下一套 */ }
  }
  return null;
}

function createMainWindow() {
  // 根据系统暗色模式加载对应的应用图标
  const appIcon = _loadAppIcon(nativeTheme.shouldUseDarkColors);

  mainWindow = new BrowserWindow({
    width: 1152,
    height: 864,
    minWidth: 960,
    minHeight: 520,
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

  // ── 窗口失焦/聚焦：冻结/解冻空闲资源 ──
  // 失焦（后台运行）时：未播放则挂起 FFmpeg 子进程（播放中挂起会断音），
  // 并通知渲染进程进入省电模式。聚焦时恢复 FFmpeg 并退出省电模式。
  mainWindow.on('blur', () => {
    if (wasapi && player && !player.isPlaying) wasapi.suspendDecoders();
    mainWindow.webContents.send('bridge:event', 'app:visibility', 'background');
  });
  mainWindow.on('focus', () => {
    if (wasapi) wasapi.resumeDecoders();
    mainWindow.webContents.send('bridge:event', 'app:visibility', 'foreground');
  });

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
    // 根据内存优化等级设置阈值（与启动时读取的 _memOptLevel 一致）
    memMgr.setOptimizationLevel(_memOptLevel);
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

    // ── 任务栏/窗口图标随系统暗色模式实时变化 ──────────────────────────────
    // 直接监听 nativeTheme（不依赖渲染进程）：即使应用主题设为「固定」亮/暗，
    // 只要系统暗色模式切换，任务栏图标也跟着变（符合「按系统暗色模式自动变化」）。
    nativeTheme.on('updated', () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.setIcon(_loadAppIcon(nativeTheme.shouldUseDarkColors));
      }
    });

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
