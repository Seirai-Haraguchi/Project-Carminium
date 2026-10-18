'use strict';

try {
  const _fs = require('fs');
  const _path = require('path');
  const _os = require('os');
  const _logDir = _path.join(process.env.APPDATA || _os.homedir(), 'Project Carminium', 'logs');
  _fs.mkdirSync(_logDir, { recursive: true });
  global.__bootLog = (m) => {
    try { _fs.appendFileSync(_path.join(_logDir, 'boot.log'), `${new Date().toISOString()} [${process.arch}] ${m}\n`); } catch {  }
  };
  __bootLog(`boot start: electron=${process.versions.electron} node=${process.versions.node} packaged=${!!process.defaultApp ? 'no' : 'yes'}`);
  process.on('uncaughtException', (e) => {
    __bootLog(`uncaughtException: ${(e && e.stack) || e}`);
    if (!global.__bootDone) process.exit(1);
  });
  process.on('exit', (c) => __bootLog(`process exit code=${c}`));
} catch {  }

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const electron = require('electron');
const { app, BrowserWindow, nativeImage, shell, dialog, nativeTheme } = electron;
const path = require('path');
const fs = require('fs');
const { getInstance: getMemoryManager } = require('./memory_manager');

app.commandLine.appendSwitch('enable-features',
  'HardwareMediaKeyHandling,MediaSessionService');

function _readMemOptLevel() {
  try {
    const os = require('os');
    let configDir;
    if (process.platform === 'win32') {
      configDir = path.join(process.env.APPDATA || os.homedir(), 'Carminium');
    } else if (process.platform === 'darwin') {
      configDir = path.join(os.homedir(), 'Library', 'Application Support', 'Carminium');
    } else {
      configDir = path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'Carminium');
    }
    const settingsPath = path.join(configDir, 'settings.json');
    if (fs.existsSync(settingsPath)) {
      const raw = fs.readFileSync(settingsPath, 'utf-8');
      const data = JSON.parse(raw);
      const lvl = data.memory_optimization;
      if (lvl === 'off' || lvl === 'normal' || lvl === 'aggressive') return lvl;
    }
  } catch (_) {}
  return 'normal';
}
const _memOptLevel = _readMemOptLevel();
console.log('[main] Memory optimization level:', _memOptLevel);


const _DISABLE_FEATURES_NORMAL = [
  'MediaSessionSegmentation',
  'Translate',
  'MediaRouter',
  'OptimizationHints',
  'AutofillServerCommunication',
  'SpeechRecognitionOnDevice',
  'VoiceTranscription',
  'SitePerProcess',
  'IsolateOrigins',
  'SpareRenderer',
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

const _DISABLE_FEATURES_AGGRESSIVE = [
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

if (_memOptLevel === 'off') {
  app.commandLine.appendSwitch('disable-features', 'MediaSessionSegmentation');

} else {
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
  app.commandLine.appendSwitch('disk-cache-size', String(8 * 1024 * 1024));
  app.commandLine.appendSwitch('media-cache-size', String(8 * 1024 * 1024));

  if (_memOptLevel === 'aggressive') {
    app.commandLine.appendSwitch('disable-features',
      _DISABLE_FEATURES_NORMAL + ',' + _DISABLE_FEATURES_AGGRESSIVE);
  } else {
    app.commandLine.appendSwitch('disable-features', _DISABLE_FEATURES_NORMAL);
  }

  app.commandLine.appendSwitch('enable-features', _ENABLE_FEATURES_MEM);

  if (_memOptLevel === 'aggressive') {
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

    app.commandLine.appendSwitch('disable-gpu-sandbox');
    app.commandLine.appendSwitch('no-sandbox');

    app.commandLine.appendSwitch('enable-low-end-device-mode');
  }
}

if (process.env.CARMINIUM_IN_PROCESS_GPU === '1') {
  app.commandLine.appendSwitch('in-process-gpu');
  console.log('[main] in-process-gpu enabled');
}

if (_memOptLevel === 'aggressive') {
  require('v8').setFlagsFromString(
    '--max-old-space-size=96 ' +
    '--max-semi-space-size=8 ' +
    '--gc-global ' +
    '--stress-incremental-marking ' +
    '--reuse-registers'
  );
} else if (_memOptLevel === 'normal') {
  require('v8').setFlagsFromString('--max-old-space-size=128');
}

if (_memOptLevel === 'normal' || _memOptLevel === 'aggressive') {
  app.commandLine.appendSwitch('js-flags', '--expose-gc');
}

app._memOptLevel = _memOptLevel;

process.on('uncaughtException', (err) => {
  console.error('[main] uncaughtException:', err);
  try { dialog.showErrorBox('Carminium 错误', String(err && err.stack || err)); } catch {  }
});

const AUMID = 'Yunofactory.ProjectCarminium.Player';
const APP_DISPLAY_NAME = 'Project Carminium';

app.setName(APP_DISPLAY_NAME);

app.commandLine.appendSwitch('app-user-model-id', AUMID);

if (app && process.platform === 'win32') {
  app.setAppUserModelId(AUMID);
  if (!process.env.CARMINIUM_MEM_PROBE) {

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

  const _probeLog = process.env.CARMINIUM_MEM_PROBE
    ? (s) => console.log('[main][probe-step]', s) : () => {};
  _probeLog('after-process-aumid');

  const _regApi = (() => {
    try {
      const koffi = require('koffi');
      const adv = koffi.load('advapi32.dll');
      const U32P = koffi.pointer('uint32');
      const U16P = koffi.pointer('uint16');
      const U8P = koffi.pointer('uint8');
      const UPTRP = koffi.pointer('uintptr');
      const api = {
        HKCU: 0x80000001,
        KEY_READ: 0x20019,
        KEY_WRITE: 0x20006,
        REG_SZ: 1,
        ERROR_FILE_NOT_FOUND: 2,
        createKey: adv.func('RegCreateKeyExW', 'int32',
          ['uintptr', 'str16', 'uint32', 'uintptr', 'uint32', 'uint32', 'uintptr', UPTRP, 'uintptr']),
        openKey: adv.func('RegOpenKeyExW', 'int32',
          ['uintptr', 'str16', 'uint32', 'uint32', UPTRP]),
        setValue: adv.func('RegSetValueExW', 'int32',
          ['uintptr', 'str16', 'uint32', 'uint32', U8P, 'uint32']),
        deleteValue: adv.func('RegDeleteValueW', 'int32', ['uintptr', 'str16']),
        queryValue: adv.func('RegQueryValueExW', 'int32',
          ['uintptr', 'str16', 'uintptr', U32P, U8P, U32P]),
        queryInfo: adv.func('RegQueryInfoKeyW', 'int32',
          ['uintptr', 'uintptr', 'uintptr', 'uintptr', U32P, 'uintptr', 'uintptr',
           U32P, 'uintptr', 'uintptr', 'uintptr', 'uintptr']),
        enumKey: adv.func('RegEnumKeyExW', 'int32',
          ['uintptr', 'uint32', U16P, U32P, 'uintptr', 'uintptr', 'uintptr', 'uintptr']),
        enumValue: adv.func('RegEnumValueW', 'int32',
          ['uintptr', 'uint32', U16P, U32P, 'uintptr', U32P, U8P, U32P]),
        deleteTree: adv.func('RegDeleteTreeW', 'int32', ['uintptr', 'str16']),
        close: adv.func('RegCloseKey', 'int32', ['uintptr']),
      };
      api.openOrCreate = (subPath, sam) => {
        const h = Buffer.alloc(8);
        let hr = api.openKey(api.HKCU, subPath, 0, sam, h);
        if (hr !== 0) hr = api.createKey(api.HKCU, subPath, 0, 0, 0, sam, 0, h, 0);
        return hr === 0 ? Number(h.readBigUInt64LE(0)) : null;
      };
      api.handleOf = (buf) => Number(buf.readBigUInt64LE(0));
      return api;
    } catch (e) {
      console.warn('[main] koffi registry init failed:', e.message);
      return null;
    }
  })();

  function _splitRegPath(fullKey) {
    const m = /^(?:HKCU|HKEY_CURRENT_USER)\\(.+)$/i.exec(String(fullKey || ''));
    return m ? m[1] : null;
  }

  function _reg(args) {
    if (process.env.CARMINIUM_MEM_PROBE) return { ok: false, output: '', error: 'probe-skip' };
    const A = _regApi;
    if (!A) return { ok: false, output: '', error: 'registry api unavailable' };
    const op = String(args[0] || '').toUpperCase();
    const fullKey = String(args[1] || '');
    try {
      const subPath = _splitRegPath(fullKey);
      if (!subPath) return { ok: false, output: '', error: 'unsupported root key: ' + fullKey };

      if (op === 'ADD') {
        const vi = args.indexOf('/v');
        const di = args.indexOf('/d');
        if (vi === -1 || di === -1 || di <= vi) {
          return { ok: false, output: '', error: 'bad ADD args' };
        }
        const name = String(args[vi + 1] || '');
        const data = String(args[di + 1] ?? '');
        const h = A.openOrCreate(subPath, A.KEY_WRITE);
        if (h === null) return { ok: false, output: '', error: 'open/create failed: ' + subPath };
        try {
          const buf = Buffer.from(data + '\0', 'utf16le');
          const hr = A.setValue(h, name, 0, A.REG_SZ, buf, buf.length);
          return hr === 0 ? { ok: true, output: '' }
                          : { ok: false, output: '', error: 'RegSetValueExW hr=' + hr };
        } finally { A.close(h); }
      }

      if (op === 'DELETE') {
        const vi = args.indexOf('/v');
        if (vi !== -1) {
          const name = String(args[vi + 1] || '');
          const h = A.openOrCreate(subPath, A.KEY_WRITE);
          if (h === null) return { ok: true, output: '' };
          try {
            const hr = A.deleteValue(h, name);
            return (hr === 0 || hr === A.ERROR_FILE_NOT_FOUND)
              ? { ok: true, output: '' } : { ok: false, output: '', error: 'hr=' + hr };
          } finally { A.close(h); }
        }
        const cut = subPath.lastIndexOf('\\');
        if (cut <= 0) return { ok: false, output: '', error: 'cannot delete root-level key' };
        const parent = subPath.slice(0, cut);
        const leaf = subPath.slice(cut + 1);
        const h = A.openOrCreate(parent, A.KEY_WRITE);
        if (h === null) return { ok: true, output: '' };
        try {
          const hr = A.deleteTree(h, leaf);
          return (hr === 0 || hr === A.ERROR_FILE_NOT_FOUND)
            ? { ok: true, output: '' } : { ok: false, output: '', error: 'hr=' + hr };
        } finally { A.close(h); }
      }

      if (op === 'QUERY') {
        const h = A.openOrCreate(subPath, A.KEY_READ);
        if (h === null) return { ok: false, output: '', error: 'open failed: ' + subPath };
        const lines = [];
        try {
          const subCnt = Buffer.alloc(4);
          const valCnt = Buffer.alloc(4);
          if (A.queryInfo(h, 0, 0, 0, subCnt, 0, 0, valCnt, 0, 0, 0, 0) === 0) {
            for (let i = 0; i < subCnt.readUInt32LE(0); i++) {
              const nameBuf = Buffer.alloc(512);
              const nameLen = Buffer.alloc(4); nameLen.writeUInt32LE(256);
              if (A.enumKey(h, i, nameBuf, nameLen, 0, 0, 0, 0) === 0) {
                const name = nameBuf.toString('utf16le', 0, nameLen.readUInt32LE(0) * 2);
                lines.push(fullKey + '\\' + name);
              }
            }
            for (let i = 0; i < valCnt.readUInt32LE(0); i++) {
              const nameBuf = Buffer.alloc(512);
              const nameLen = Buffer.alloc(4); nameLen.writeUInt32LE(256);
              const typeBuf = Buffer.alloc(4);
              const dataBuf = Buffer.alloc(2048);
              const dataSize = Buffer.alloc(4); dataSize.writeUInt32LE(2048);
              if (A.enumValue(h, i, nameBuf, nameLen, 0, typeBuf, dataBuf, dataSize) === 0) {
                const vName = nameBuf.toString('utf16le', 0, nameLen.readUInt32LE(0) * 2);
                const vType = typeBuf.readUInt32LE(0);
                const vLen = dataSize.readUInt32LE(0);
                const vData = vType === A.REG_SZ
                  ? dataBuf.toString('utf16le', 0, Math.max(0, vLen - 2))
                  : '(binary)';
                lines.push('    ' + vName + '    REG_SZ    ' + vData);
              }
            }
          }
        } finally { A.close(h); }
        return { ok: true, output: lines.join('\n') };
      }

      return { ok: false, output: '', error: 'unsupported op: ' + op };
    } catch (e) {
      console.warn('[main] registry op failed:', args.join(' '), e.message);
      return { ok: false, output: '', error: e.message };
    }
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
    const appDataDir = process.env.APPDATA;
    if (!appDataDir) return null;
    const shortcutName = _sanitizeShortcutName(displayName);
    const programsDir = path.join(appDataDir, 'Microsoft', 'Windows', 'Start Menu', 'Programs');
    const shortcutPath = path.join(programsDir, shortcutName + '.lnk');
    try {
      const operation = fs.existsSync(shortcutPath) ? 'update' : 'create';
      const ok = shell.writeShortcutLink(shortcutPath, operation, {
        target: targetPath,
        cwd: path.dirname(targetPath),
        description: displayName,
        icon: iconPath || targetPath,
        iconIndex: 0,
        appUserModelId: aumid,
      });
      return ok ? shortcutPath : null;
    } catch (e) {
      console.warn('[main] Failed to create Start Menu shortcut:', e.message);
      return null;
    }
  }

  let iconUriValue = null;
  let iconPathForLog = null;
  const appDataDir = process.env.APPDATA;

  function _generateIcoFromPngSync(pngPath, icoPath) {
    const pngBuffer = fs.readFileSync(pngPath);
    const w = pngBuffer.readUInt32BE(16);
    const h = pngBuffer.readUInt32BE(20);

    const icoHeader = Buffer.alloc(6);
    icoHeader.writeUInt16LE(0, 0);
    icoHeader.writeUInt16LE(1, 2);
    icoHeader.writeUInt16LE(1, 4);

    const icoEntry = Buffer.alloc(16);
    icoEntry.writeUInt8(w >= 256 ? 0 : w, 0);
    icoEntry.writeUInt8(h >= 256 ? 0 : h, 1);
    icoEntry.writeUInt8(0, 2);
    icoEntry.writeUInt8(0, 3);
    icoEntry.writeUInt16LE(1, 4);
    icoEntry.writeUInt16LE(32, 6);
    icoEntry.writeUInt32LE(pngBuffer.length, 8);
    icoEntry.writeUInt32LE(22, 12);

    const icoBuffer = Buffer.concat([icoHeader, icoEntry, pngBuffer]);
    fs.writeFileSync(icoPath, icoBuffer);
    return icoPath;
  }

  _probeLog('before-ico');
  if (process.env.CARMINIUM_MEM_PROBE) {
    _probeLog('skip-ico');
  } else if (appDataDir) {
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
        iconUriValue = sourceIconPath;
        iconPathForLog = sourceIconPath;
      }
    } catch (e) {
      console.warn('[main] Failed to copy icon to stable path:', e.message);
    }
  }

  if (!iconUriValue) {
    const sourceIconPath = path.join(__dirname, '..', 'build', 'icon.png');
    const fallbackIcoPath = path.join(__dirname, '..', 'build', 'app-icon.ico');
    if (fs.existsSync(sourceIconPath)) {
      try {
        _generateIcoFromPngSync(sourceIconPath, fallbackIcoPath);
        iconUriValue = fallbackIcoPath;
        iconPathForLog = fallbackIcoPath;
        console.log('[main] Generated fallback ICO:', fallbackIcoPath);
      } catch (icoErr) {
        iconUriValue = sourceIconPath;
        iconPathForLog = sourceIconPath;
      }
    }
  }

  try {
    const regParent = 'HKCU\\Software\\Classes\\AppUserModelId';
    const result = _reg(['QUERY', regParent]);
    if (result.ok && result.output) {
      const lines = result.output.split('\n').map(l => l.trim());
      for (const line of lines) {
        if (!line.startsWith(regParent + '\\')) continue;
        const subAumid = line.substring(regParent.length + 1);
        if (subAumid !== AUMID &&
            (subAumid.includes('Carminium') || subAumid.includes('Yunofactory'))) {
          _reg(['DELETE', line, '/f']);
          console.log('[main] Cleaned up old AUMID registry entry:', subAumid);
        }
      }
    }
  } catch {  }

  const regKey = `HKCU\\Software\\Classes\\AppUserModelId\\${AUMID}`;

  const dnResult = _reg(['ADD', regKey, '/v', 'DisplayName', '/t', 'REG_SZ', '/d', APP_DISPLAY_NAME, '/f']);
  if (dnResult.ok) {
    console.log('[main] AUMID DisplayName registered:', APP_DISPLAY_NAME);
  }

  const iconExePath = process.execPath || '';
  let iconResourceValue = null;
  let iconResourceSource = 'direct';

  if (iconExePath) {
    const isPortable = iconExePath.toLowerCase().includes('\\temp\\') ||
                       iconExePath.toLowerCase().includes('\\tmp\\');

    if (isPortable && iconUriValue) {
      iconResourceValue = `${iconUriValue},0`;
      iconResourceSource = 'stable-ico';
    } else {
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

  _reg(['DELETE', regKey, '/v', 'TaskManagerAppId', '/f']);
  const tmaResult = _reg(['ADD', regKey, '/v', 'TaskManagerAppId', '/t', 'REG_SZ', '/d', AUMID, '/f']);
  if (tmaResult.ok) {
    console.log('[main] AUMID TaskManagerAppId registered:', AUMID);
  } else {
    console.warn('[main] AUMID TaskManagerAppId registration FAILED');
  }

  const appDataLocal = process.env.LOCALAPPDATA;
  if (appDataLocal) {
    const destListDir = path.join(appDataLocal, 'Microsoft', 'Windows', 'Recent', 'CustomDestinations');
    let destListFile = '';
    try {
      let hash = 0;
      for (let i = 0; i < AUMID.length; i++) {
        hash = ((hash << 5) - hash + AUMID.charCodeAt(i)) | 0;
      }
      destListFile = Math.abs(hash).toString(16).padStart(8, '0') + '.autorel';
    } catch {  }
    if (destListFile) {
      const customDestListValue = path.join(destListDir, destListFile);
      _reg(['DELETE', regKey, '/v', 'CustomDestList', '/f']);
      const cdlResult = _reg(['ADD', regKey, '/v', 'CustomDestList', '/t', 'REG_SZ', '/d', customDestListValue, '/f']);
      if (cdlResult.ok) {
        console.log('[main] AUMID CustomDestList registered:', customDestListValue);
      }
    }
  }

  if (iconUriValue) {
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

  const startMenuShortcut = _ensureStartMenuShortcut(
    AUMID,
    APP_DISPLAY_NAME,
    process.execPath,
    iconUriValue
  );
  _probeLog('after-reg-section');
  if (startMenuShortcut) {
    console.log('[main] Start Menu shortcut ensured:', startMenuShortcut);
  }

  const verifyResult = _reg(['QUERY', regKey]);
  if (verifyResult.ok && verifyResult.output) {
    console.log('[main] AUMID registry verification:\n' + verifyResult.output.trim());
  } else {
    console.warn('[main] AUMID registry verification FAILED — values may not be set');
  }

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

  if (_shell32) {
    try {
      const SHChangeNotify = _shell32.func(
        'void SHChangeNotify(int32 wEventId, int32 uFlags, void *dwItem1, void *dwItem2)'
      );
      _probeLog('before-shchangenotify');
      SHChangeNotify(0x08000000, 0x0000, null, null);
      _probeLog('after-shchangenotify');
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

  function _updateAumidIconIco(isDark) {
    if (process.env.CARMINIUM_MEM_PROBE) return;
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
        } catch (e) {  }
      }
      console.log('[main] AUMID IconUri updated to', isDark ? 'dark' : 'light', '->', stableIcoPath);
    } catch (e) {
      console.warn('[main] Failed to update AUMID IconUri:', e.message);
    }
  }

  _updateAumidIconIco(nativeTheme.shouldUseDarkColors);

  nativeTheme.on('updated', () => {
    _updateAumidIconIco(nativeTheme.shouldUseDarkColors);
  });
  }
}

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

let mainWindow = null;
let settings = null;
let library = null;
let player = null;
let coverServer = null;
let bridge = null;
let smtc = null;
let discordRpc = null;
let thumbar = null;
let wasapi = null;


function _getMainWindow() {
  return mainWindow;
}


function _loadAppIcon(isDark) {
  const primary = isDark ? 'icon-dark.png' : 'icon.png';
  const fallback = isDark ? 'icon.png' : 'icon-dark.png';
  for (const name of [primary, fallback]) {
    const iconPath = path.join(__dirname, '..', 'build', name);
    try {
      if (fs.existsSync(iconPath)) return nativeImage.createFromPath(iconPath);
    } catch {  }
  }
  return null;
}

function createMainWindow() {
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

  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  const indexPath = path.join(__dirname, '..', 'web', 'index.html');
  mainWindow.loadFile(indexPath);

  mainWindow.webContents.on('did-fail-load', (_e, errorCode, errorDescription, validatedURL) => {
    console.error('[main] 页面加载失败:', errorCode, errorDescription, validatedURL);
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    _pushMaximizedState();
  });

  mainWindow.on('maximize', () => _pushMaximizedState());
  mainWindow.on('unmaximize', () => _pushMaximizedState());

  mainWindow.on('enter-full-screen', () => _pushFullscreenState(true));
  mainWindow.on('leave-full-screen', () => _pushFullscreenState(false));

  mainWindow.on('blur', () => {
    if (wasapi && player && !player.isPlaying) wasapi.suspendDecoders();
    mainWindow.webContents.send('bridge:event', 'app:visibility', 'background');
  });
  mainWindow.on('focus', () => {
    if (wasapi) wasapi.resumeDecoders();
    mainWindow.webContents.send('bridge:event', 'app:visibility', 'foreground');
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (bridge && bridge.isFloatingWindowUrl(url)) {
      return { action: 'allow', overrideBrowserWindowOptions: bridge.floatingWindowOptions() };
    }
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('did-create-window', (child, details) => {
    if (bridge) bridge.adoptFloatingWindow(child, details);
  });

  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'F12' && input.type === 'keyDown') {
      if (mainWindow.webContents.isDevToolsOpened()) {
        mainWindow.webContents.closeDevTools();
      } else {
        mainWindow.webContents.openDevTools({ mode: 'detach' });
      }
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    if (bridge) bridge.close();
  });

  return mainWindow;
}


function _pushMaximizedState() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    const isMaximized = mainWindow.isMaximized();
    mainWindow.webContents.executeJavaScript(
      'window.__updateMaximizedState && window.__updateMaximizedState(' + isMaximized + ')'
    ).catch(() => {  });
  }
}

function _pushFullscreenState(isFullscreen) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.executeJavaScript(
      'window.__updateFullscreenState && window.__updateFullscreenState(' + isFullscreen + ')'
    ).catch(() => {  });
  }
}


function restorePlaybackState() {
  const state = settings.get('playback_state', {});
  if (!state || !state.track_id) return;

  const trackId = state.track_id;
  const positionMs = parseInt(state.position_ms, 10) || 0;
  const wasPlaying = !!state.was_playing;

  const track = library.getTrack(trackId);
  if (!track) return;

  if (track.source !== 'subsonic' && track.path) {
    if (!fs.existsSync(track.path)) return;
  }

  player.restoreState(track, positionMs, wasPlaying);
}

function savePlaybackState() {
  if (!player) return;
  const state = player.getPersistentState();
  if (state && state.track_id) {
    settings.set('playback_state', state);
  }
}


async function initializeApp() {
  try {
    const memMgr = getMemoryManager();
    memMgr.setOptimizationLevel(_memOptLevel);
    memMgr.start();

    const { AppSettings } = require('./settings');
    const { MusicLibrary } = require('./library');
    const { MusicPlayer } = require('./player');
    const { CoverHTTPServer } = require('./cover-server');
    const { Bridge } = require('./bridge');
    const { SmtcController } = require('./smtc');
    const { DiscordRpcController } = require('./discord_rpc');
    const { ThumbarController } = require('./thumbar');

    let NativeRenderer = null;
    try {
      ({ NativeRenderer } = require('./wasapi'));
    } catch (e) {
      console.warn('[main] Native audio module not available:', e.message);
    }

    settings = new AppSettings();
    library = new MusicLibrary(settings);

    library.backfillMetadata()
      .then((n) => { if (n > 0 && bridge) bridge._emitLibraryUpdated(); })
      .catch(e => console.warn('[main] metadata backfill failed:', e.message));

    try {
      wasapi = NativeRenderer ? new NativeRenderer() : null;
    } catch (e) {
      console.warn('[main] Native renderer not available:', e.message);
      wasapi = null;
    }

    player = new MusicPlayer(settings, library, wasapi);
    coverServer = new CoverHTTPServer(library);
    await coverServer.start();

    player.setMediaBaseUrl(coverServer.baseUrl);

    const vol = settings.get('volume', 80);
    player.setVolume(parseInt(vol, 10) || 80);

    bridge = new Bridge(library, player, settings, coverServer, wasapi);
    bridge.registerIpcHandlers();

    smtc = new SmtcController(player, library, settings);
    smtc.setBridge(bridge);

    thumbar = new ThumbarController(player, settings);
    thumbar.setBridge(bridge);

    discordRpc = new DiscordRpcController(player, settings);
    discordRpc.setBridge(bridge);
    discordRpc.start();

    createMainWindow();
    bridge.setMainWindow(mainWindow);
    smtc.setMainWindow(mainWindow);
    if (thumbar) thumbar.setWindow(mainWindow);

    {
      const APP_TITLE = 'Project Carminium';
      let _titleTimer = null;

      function _formatTime(ms) {
        const totalSec = Math.floor((ms || 0) / 1000);
        const h = Math.floor(totalSec / 3600);
        const m = Math.floor((totalSec % 3600) / 60);
        const s = totalSec % 60;
        if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
        return `${m}:${String(s).padStart(2, '0')}`;
      }

      function _updateWindowTitle() {
        if (!mainWindow || mainWindow.isDestroyed()) return;
        const track = player.currentTrack;
        if (!track || player.state === 'stopped') {
          mainWindow.setTitle(APP_TITLE);
          return;
        }
        const pos = _formatTime(player.position);
        const title = track.title || '';
        const artist = track.artist || track.album_artist || '';
        let songInfo = title;
        if (artist) songInfo = `${title} - ${artist}`;
        mainWindow.setTitle(`${pos} ${songInfo} | ${APP_TITLE}`);
      }

      player.on('track_changed', _updateWindowTitle);
      player.on('state_changed', _updateWindowTitle);
      player.on('position_changed', () => {
        if (_titleTimer) return;
        _titleTimer = setTimeout(() => {
          _titleTimer = null;
          _updateWindowTitle();
        }, 1000);
      });
    }

    nativeTheme.on('updated', () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.setIcon(_loadAppIcon(nativeTheme.shouldUseDarkColors));
      }
    });

    bridge.startAutoRefresh();

    bridge.once('renderer-ready', () => {
      try {
        player.emit('audio_control', JSON.stringify({
          action: 'set_output_sink',
          nullSink: player.isExclusive,
        }));
      } catch {  }
      restorePlaybackState();
    });
  } catch (err) {
    console.error('[main] 初始化失败:', err);
    try { dialog.showErrorBox('Carminium 启动失败', String(err && err.stack || err)); } catch {  }
    app.quit();
  }
}


function shutdown() {
  try {
    const { getInstance: getMemoryManager } = require('./memory_manager');
    getMemoryManager().stop();
  } catch {  }
  try {
    if (player) player.stop();
  } catch {  }
  savePlaybackState();
  try {
    if (discordRpc) discordRpc.stop();
  } catch {  }
  try {
    if (thumbar) thumbar.dispose();
  } catch {  }
  try {
    if (bridge) bridge.close();
  } catch {  }
  try {
    if (coverServer) coverServer.stop();
  } catch {  }
  try {
    if (library) library.close();
  } catch {  }
  try {
    if (player) player.close();
  } catch {  }
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
    } catch {  }
  }
}


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
    if (thumbar) thumbar.setWindow(mainWindow);
  }
});

app.on('web-contents-created', (_e, contents) => {
  contents.on('will-navigate', (event, url) => {
    const parsed = new URL(url);
    const allowed = parsed.protocol === 'file:';
    if (!allowed) event.preventDefault();
  });
});

global.__bootDone = true;
