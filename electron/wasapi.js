/**
 * Carminium — WASAPI Exclusive Mode Renderer (Native Windows COM)
 *
 * 通过 koffi 直接调用 Windows WASAPI COM 接口实现独占模式音频输出，
 * 使用 ffmpeg 子进程解码音频文件为原始 PCM 数据。
 *
 * 架构:
 *   ffmpeg (decode) → PCM ring buffer → WASAPI (exclusive output)
 *
 * 依赖:
 *   - koffi (npm) — FFI 库，调用 ole32.dll / kernel32.dll
 *   - ffmpeg (内置 electron/bin/ffmpeg.exe，或系统 PATH)
 *
 * COM 接口调用原理:
 *   COM 对象的首字段是指向 vtable 的指针，
 *   vtable 是按声明顺序排列的函数指针数组。
 *   koffi 可以将 vtable 解码为带可调用字段的结构体。
 */
'use strict';

const koffi = require('koffi');
const { spawn, execSync } = require('child_process');
const { EventEmitter } = require('events');
const fs = require('fs');
const path = require('path');

// ── 常量 ──────────────────────────────────────────────────────────────────────

const COINIT_MULTITHREADED = 0x0;
const CLSCTX_ALL = 0x17;
const AUDCLNT_SHAREMODE_EXCLUSIVE = 1;
const AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM = 0x80000000;
const AUDCLNT_BUFFERFLAGS_SILENT = 0x2;
const WAVE_FORMAT_PCM = 1;
const WAVE_FORMAT_IEEE_FLOAT = 3;
const eRender = 0;
const eConsole = 0;
const DEVICE_STATE_ACTIVE = 0x1;

// ── GUID 定义 ──────────────────────────────────────────────────────────────────

const GUID = koffi.pack('GUID', {
  Data1: 'uint32',
  Data2: 'uint16',
  Data3: 'uint16',
  Data4: koffi.array('uint8', 8),
});

function _makeGuid(d1, d2, d3, b0, b1, b2, b3, b4, b5, b6, b7) {
  const ptr = koffi.alloc(GUID, 1);
  koffi.encode(ptr, GUID, {
    Data1: d1, Data2: d2, Data3: d3,
    Data4: [b0, b1, b2, b3, b4, b5, b6, b7],
  });
  return ptr;
}

// CLSID_MMDeviceEnumerator  {BCDE0395-E52F-467C-8E3D-C4579291692E}
const CLSID_MMDeviceEnumerator = _makeGuid(
  0xBCDE0395, 0xE52F, 0x467C, 0x8E, 0x3D, 0xC4, 0x57, 0x92, 0x91, 0x69, 0x2E
);
// IID_IMMDeviceEnumerator   {A95664D2-9614-4F35-A746-DE8DB63617E6}
const IID_IMMDeviceEnumerator = _makeGuid(
  0xA95664D2, 0x9614, 0x4F35, 0xA7, 0x46, 0xDE, 0x8D, 0xB6, 0x36, 0x17, 0xE6
);
// IID_IAudioClient          {1CB9AD4C-DBFA-4C32-B178-C2F568A703B2}
const IID_IAudioClient = _makeGuid(
  0x1CB9AD4C, 0xDBFA, 0x4C32, 0xB1, 0x78, 0xC2, 0xF5, 0x68, 0xA7, 0x03, 0xB2
);
// IID_IAudioRenderClient    {F294ACFC-3146-4483-A7BF-ADD077C4EAC9}
const IID_IAudioRenderClient = _makeGuid(
  0xF294ACFC, 0x3146, 0x4483, 0xA7, 0xBF, 0xAD, 0xD0, 0x77, 0xC4, 0xEA, 0xC9
);

// ── WAVEFORMATEX ──────────────────────────────────────────────────────────────

const WAVEFORMATEX = koffi.pack('WAVEFORMATEX', {
  wFormatTag: 'uint16',
  nChannels: 'uint16',
  nSamplesPerSec: 'uint32',
  nAvgBytesPerSec: 'uint32',
  nBlockAlign: 'uint16',
  wBitsPerSample: 'uint16',
  cbSize: 'uint16',
});

function _makeWaveFormat(tag, channels, sampleRate, bitsPerSample) {
  const ptr = koffi.alloc(WAVEFORMATEX, 1);
  koffi.encode(ptr, WAVEFORMATEX, {
    wFormatTag: tag,
    nChannels: channels,
    nSamplesPerSec: sampleRate,
    nAvgBytesPerSec: sampleRate * channels * (bitsPerSample / 8),
    nBlockAlign: channels * (bitsPerSample / 8),
    wBitsPerSample: bitsPerSample,
    cbSize: 0,
  });
  return ptr;
}

// ── COM vtable 函数类型 ─────────────────────────────────────────────────────

// koffi 3.x: 用 koffi.proto() 定义函数类型，用 koffi.call(ptr, type, ...) 调用
// COM vtable 是函数指针数组，通过读取原始指针 + koffi.call 调用

function P(name, sig) { return koffi.proto(sig.replace('f(', name + '(')); }

// 指针大小（64位系统 = 8字节）
const _ptrSize = 8;

/** 从 vtable 读取第 index 个函数指针 (返回 bigint 地址) */
function _getVtblFnPtr(pInterface, index) {
  const pVtbl = koffi.decode(pInterface, 'void *');
  const offset = BigInt(pVtbl) + BigInt(_ptrSize * index);
  return koffi.decode(offset, 'void *');
}

// ── IMMDeviceEnumerator 函数类型 (8 methods, indices 0-7) ──
const FT_Enum_Enum = P('vt_Enum_Enum', 'int32 f(void *this, int32 df, uint32 mask, void **pp)');
const FT_Enum_Def = P('vt_Enum_Def', 'int32 f(void *this, int32 df, int32 role, void **pp)');

// ── IMMDevice 函数类型 (6 methods, indices 0-5) ──
const FT_Dev_Activate = P('vt_Dev_Activate', 'int32 f(void *this, void *iid, uint32 ctx, void *params, void **pp)');
const FT_Dev_GetId = P('vt_Dev_GetId', 'int32 f(void *this, void **ppstr)');

// ── IMMDeviceCollection 函数类型 (5 methods, indices 0-4) ──
const FT_DC_GetCount = P('vt_DC_GetCnt', 'int32 f(void *this, uint32 *pc)');
const FT_DC_Item = P('vt_DC_Item', 'int32 f(void *this, uint32 n, void **pp)');

// ── IAudioClient 函数类型 (15 methods, indices 0-14) ──
const FT_AC_Init = P('vt_AC_Init', 'int32 f(void *this, int32 share, uint32 flags, uint64 bufDur, uint64 periodicity, void *pFormat, void *pGuid)');
const FT_AC_GetBuf = P('vt_AC_GetBuf', 'int32 f(void *this, uint32 *pNum)');
const FT_AC_GetPad = P('vt_AC_GetPad', 'int32 f(void *this, uint32 *pPad)');
const FT_AC_IsFmt = P('vt_AC_IsFmt', 'int32 f(void *this, int32 share, void *pFormat, void **ppClosest)');
const FT_AC_Start = P('vt_AC_Start', 'int32 f(void *this)');
const FT_AC_Stop = P('vt_AC_Stop', 'int32 f(void *this)');
const FT_AC_Reset = P('vt_AC_Reset', 'int32 f(void *this)');
const FT_AC_SetEvt = P('vt_AC_SetEvt', 'int32 f(void *this, void *hEvt)');
const FT_AC_GetSvc = P('vt_AC_GetSvc', 'int32 f(void *this, void *iid, void **pp)');
const FT_AC_GetDevPer = P('vt_AC_GetDevPer', 'int32 f(void *this, uint64 *pDef, uint64 *pMin)');
const FT_AC_GetMixFmt = P('vt_AC_GetMixFmt', 'int32 f(void *this, void **pp)');

// ── IAudioRenderClient 函数类型 (5 methods, indices 0-4) ──
const FT_RC_GetBuf = P('vt_RC_GetBuf', 'int32 f(void *this, uint32 numFrames, void **ppData)');
const FT_RC_RelBuf = P('vt_RC_RelBuf', 'int32 f(void *this, uint32 numWritten, uint32 flags)');

// ── 通用 COM vtable 索引 ──
const VT_QI = 0;         // QueryInterface (所有 COM 接口的第一个方法)
const VT_RELEASE = 2;

// QueryInterface 函数类型（IUnknown 方法 0）
const FT_QI = P('vt_QI', 'int32 f(void *this, void *iid, void **pp)');

// ── DLL 加载 ──────────────────────────────────────────────────────────────────

let _ole32 = null, _kernel32 = null, _msvcrt = null;
let _CoInitializeEx, _CoCreateInstance, _CoUninitialize, _CoTaskMemFree;
let _CreateEventW, _CloseHandle, _WaitForSingleObject;
let _memcpy;

try {
  _ole32 = koffi.load('ole32.dll');
  _CoInitializeEx = _ole32.func('int32 CoInitializeEx(void *pv, uint32 coInit)');
  _CoCreateInstance = _ole32.func('int32 CoCreateInstance(void *clsid, void *pUnk, uint32 ctx, void *iid, void **ppv)');
  _CoUninitialize = _ole32.func('void CoUninitialize()');
  _CoTaskMemFree = _ole32.func('void CoTaskMemFree(void *pv)');
} catch (e) { console.error('[wasapi] ole32.dll load failed:', e.message); }

try {
  _kernel32 = koffi.load('kernel32.dll');
  _CreateEventW = _kernel32.func('void *CreateEventW(void *attr, int32 manual, int32 init, void *name)');
  _CloseHandle = _kernel32.func('int32 CloseHandle(void *h)');
  _WaitForSingleObject = _kernel32.func('uint32 WaitForSingleObject(void *h, uint32 ms)');
} catch (e) { console.error('[wasapi] kernel32.dll load failed:', e.message); }

try {
  _msvcrt = koffi.load('msvcrt.dll');
  _memcpy = _msvcrt.func('void *memcpy(void *dst, const void *src, uintptr_t n)');
} catch (e) { console.error('[wasapi] msvcrt.dll load failed:', e.message); }

// ── COM 辅助函数 ──────────────────────────────────────────────────────────────

/** 释放 COM 接口（调用 vtable 中第 3 个方法 Release） */
function _release(pInterface) {
  if (!pInterface) return;
  try {
    const fnPtr = _getVtblFnPtr(pInterface, VT_RELEASE);
    const ft = koffi.proto('uint32 vt_Rel_Inst(void *this)');
    koffi.call(fnPtr, ft, pInterface);
  } catch { /* ignore */ }
}

/** 检查 HRESULT */
function _checkHr(hr, msg) {
  if (hr !== 0) {
    throw new Error(`${msg} failed: HRESULT 0x${(hr >>> 0).toString(16)}`);
  }
}

// ── ffmpeg 辅助 ───────────────────────────────────────────────────────────────

let _ffmpegPath = null;
let _ffprobePath = null;

function _findFFmpeg() {
  if (_ffmpegPath !== null) return _ffmpegPath;
  // 1. 内置 ffmpeg（electron/bin/ffmpeg.exe）
  const bundled = path.join(__dirname, 'bin', 'ffmpeg.exe');
  if (fs.existsSync(bundled)) {
    _ffmpegPath = bundled;
    return _ffmpegPath;
  }
  // 2. 开发模式：项目根目录 bin/
  const devBin = path.join(__dirname, '..', 'bin', 'ffmpeg.exe');
  if (fs.existsSync(devBin)) {
    _ffmpegPath = devBin;
    return _ffmpegPath;
  }
  // 3. 系统 PATH
  try {
    execSync('ffmpeg -version', { stdio: 'ignore', timeout: 5000 });
    _ffmpegPath = 'ffmpeg';
    return _ffmpegPath;
  } catch { /* not in PATH */ }
  // 4. 常见安装路径
  const locations = [
    'C:\\ffmpeg\\bin\\ffmpeg.exe',
    'C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe',
    'C:\\Program Files (x86)\\ffmpeg\\bin\\ffmpeg.exe',
    path.join(process.env.LOCALAPPDATA || '', 'ffmpeg', 'bin', 'ffmpeg.exe'),
  ];
  for (const loc of locations) {
    if (fs.existsSync(loc)) {
      _ffmpegPath = loc;
      return _ffmpegPath;
    }
  }
  _ffmpegPath = false;
  return _ffmpegPath;
}

function _findFFprobe() {
  if (_ffprobePath !== null) return _ffprobePath;
  // 1. 内置 ffprobe（electron/bin/ffprobe.exe）
  const bundled = path.join(__dirname, 'bin', 'ffprobe.exe');
  if (fs.existsSync(bundled)) {
    _ffprobePath = bundled;
    return _ffprobePath;
  }
  const devBin = path.join(__dirname, '..', 'bin', 'ffprobe.exe');
  if (fs.existsSync(devBin)) {
    _ffprobePath = devBin;
    return _ffprobePath;
  }
  // 2. 系统 PATH
  try {
    execSync('ffprobe -version', { stdio: 'ignore', timeout: 5000 });
    _ffprobePath = 'ffprobe';
    return _ffprobePath;
  } catch { /* not in PATH */ }
  // 3. 同目录查找（跟随 ffmpeg）
  const ff = _findFFmpeg();
  if (ff && ff !== 'ffmpeg') {
    const dir = path.dirname(ff);
    const probePath = path.join(dir, 'ffprobe.exe');
    if (fs.existsSync(probePath)) {
      _ffprobePath = probePath;
      return _ffprobePath;
    }
  }
  _ffprobePath = false;
  return _ffprobePath;
}

// ── WasapiRenderer 类 ─────────────────────────────────────────────────────────

class WasapiRenderer extends EventEmitter {
  constructor() {
    super();
    this._initialized = false;
    this._comInitialized = false;
    this._pEnum = null;       // IMMDeviceEnumerator
    this._pDevice = null;     // IMMDevice
    this._pAudioClient = null;// IAudioClient
    this._pRenderClient = null;// IAudioRenderClient
    this._hEvent = null;      // 事件句柄

    this._sampleRate = 0;
    this._channels = 0;
    this._bitsPerSample = 0;
    this._bytesPerFrame = 0;
    this._bufferFrames = 0;
    this._durationMs = 0;

    this._playing = false;
    this._paused = false;
    this._volume = 1.0;

    // PCM 缓冲队列
    this._pcmQueue = [];
    this._pcmQueueBytes = 0;
    this._ffmpegProc = null;
    this._ffmpegFinished = false;

    // 位置追踪
    this._framesConsumed = 0;
    this._feedTimer = null;

    this.onPositionTick = null;
    this.onEnded = null;
  }

  // ── 设备枚举 ─────────────────────────────────────────────────────────────

  static enumerateDevices() {
    if (!_ole32) return [];
    let comInit = false;
    try {
      _CoInitializeEx(null, COINIT_MULTITHREADED);
      comInit = true;
    } catch { /* already initialized */ }

    try {
      // 创建枚举器
      const ppEnum = koffi.alloc('void *', 1);
      let hr = _CoCreateInstance(CLSID_MMDeviceEnumerator, null, CLSCTX_ALL,
        IID_IMMDeviceEnumerator, ppEnum);
      if (hr !== 0) return [];

      const pEnum = koffi.decode(ppEnum, 'void *');

      // 枚举活跃渲染设备 (EnumAudioEndpoints = vtable index 3)
      const ppCollection = koffi.alloc('void *', 1);
      hr = koffi.call(_getVtblFnPtr(pEnum, 3), FT_Enum_Enum, pEnum, eRender, DEVICE_STATE_ACTIVE, ppCollection);
      if (hr !== 0) { _release(pEnum); return []; }

      const pCollection = koffi.decode(ppCollection, 'void *');

      // 获取设备数量 (GetCount = vtable index 3)
      const pCount = koffi.alloc('uint32', 1);
      koffi.call(_getVtblFnPtr(pCollection, 3), FT_DC_GetCount, pCollection, pCount);
      const count = koffi.decode(pCount, 'uint32');

      const devices = [];
      for (let i = 0; i < count; i++) {
        const ppDevice = koffi.alloc('void *', 1);
        hr = koffi.call(_getVtblFnPtr(pCollection, 4), FT_DC_Item, pCollection, i, ppDevice);
        if (hr !== 0) continue;
        const pDevice = koffi.decode(ppDevice, 'void *');

        // 获取设备 ID (GetId = vtable index 5)
        const ppId = koffi.alloc('void *', 1);
        hr = koffi.call(_getVtblFnPtr(pDevice, 5), FT_Dev_GetId, pDevice, ppId);
        let devId = `dev_${i}`;
        let devName = `Audio Device ${i + 1}`;
        if (hr === 0) {
          const pIdStr = koffi.decode(ppId, 'void *');
          try {
            // 读取宽字符串
            const idBuf = Buffer.from(koffi.decode(pIdStr, koffi.array('uint16', 256)));
            devId = idBuf.toString('utf16le').split('\0')[0] || `dev_${i}`;
          } catch { /* use fallback */ }
          _CoTaskMemFree(pIdStr);
        }

        // 第一个设备为默认设备
        if (i === 0) devName = `${devName} (Default)`;
        devices.push({ id: devId, name: devName, index: i, type: 0, flags: 1 });

        _release(pDevice);
      }

      _release(pCollection);
      _release(pEnum);
      return devices;
    } catch (e) {
      console.error('[wasapi] enumerateDevices failed:', e);
      return [];
    } finally {
      if (comInit) { try { _CoUninitialize(); } catch { /* ignore */ } }
    }
  }

  // ── 初始化 ───────────────────────────────────────────────────────────────

  async init(sampleRate = 0, channels = 0, bitsPerSample = 0) {
    if (!_ole32 || !_kernel32) throw new Error('WASAPI DLLs not loaded');
    if (this._initialized) await this.close();

    // COM 初始化
    try {
      _CoInitializeEx(null, COINIT_MULTITHREADED);
      this._comInitialized = true;
    } catch { /* already initialized on this thread */ }

    // 创建设备枚举器
    const ppEnum = koffi.alloc('void *', 1);
    let hr = _CoCreateInstance(CLSID_MMDeviceEnumerator, null, CLSCTX_ALL,
      IID_IMMDeviceEnumerator, ppEnum);
    _checkHr(hr, 'CoCreateInstance(MMDeviceEnumerator)');
    this._pEnum = koffi.decode(ppEnum, 'void *');

    // 获取默认渲染端点 (GetDefaultAudioEndpoint = vtable index 4)
    const ppDevice = koffi.alloc('void *', 1);
    hr = koffi.call(_getVtblFnPtr(this._pEnum, 4), FT_Enum_Def, this._pEnum, eRender, eConsole, ppDevice);
    _checkHr(hr, 'GetDefaultAudioEndpoint');
    this._pDevice = koffi.decode(ppDevice, 'void *');

    // 激活 IAudioClient (Activate = vtable index 3)
    const ppAudioClient = koffi.alloc('void *', 1);
    hr = koffi.call(_getVtblFnPtr(this._pDevice, 3), FT_Dev_Activate, this._pDevice, IID_IAudioClient, CLSCTX_ALL, null, ppAudioClient);
    _checkHr(hr, 'IMMDevice::Activate');
    this._pAudioClient = koffi.decode(ppAudioClient, 'void *');

    // 获取设备原生格式 (GetMixFormat = vtable index 8)
    // GetMixFormat 返回设备支持的格式（共享模式下音频引擎使用的格式）
    const ppMixFmt = koffi.alloc('void *', 1);
    hr = koffi.call(_getVtblFnPtr(this._pAudioClient, 8), FT_AC_GetMixFmt, this._pAudioClient, ppMixFmt);
    _checkHr(hr, 'IAudioClient::GetMixFormat');
    const pMixFmtPtr = koffi.decode(ppMixFmt, 'void *');

    // 解析 WAVEFORMATEX
    const wfxData = koffi.decode(pMixFmtPtr, WAVEFORMATEX);
    this._sampleRate = wfxData.nSamplesPerSec;
    this._channels = wfxData.nChannels;
    this._bitsPerSample = wfxData.wBitsPerSample;
    this._bytesPerFrame = (this._channels * this._bitsPerSample) / 8;

    console.log(`[wasapi] Device mix format: ${this._sampleRate}Hz, ${this._channels}ch, ${this._bitsPerSample}bit, tag=${wfxData.wFormatTag}`);

    // 初始化 AudioClient
    // 独占模式下 hnsBufferDuration 和 hnsPeriodicity 必须相同
    // Initialize 失败后 IAudioClient 对象不可用，必须释放并重新激活

    const _initDurations = [
      [0, 0],             // 系统默认（最可靠）
      [3000000, 3000000], // 300ms
      [5000000, 5000000], // 500ms
      [10000000, 10000000], // 1s
    ];

    let initOk = false;
    let lastHr = 0;
    for (const [bufDur, period] of _initDurations) {
      // 每次重试前重新激活 IAudioClient（上一次 Initialize 失败后对象已失效）
      if (this._pAudioClient) {
        _release(this._pAudioClient);
        this._pAudioClient = null;
      }
      const ppAC = koffi.alloc('void *', 1);
      hr = koffi.call(_getVtblFnPtr(this._pDevice, 3), FT_Dev_Activate,
        this._pDevice, IID_IAudioClient, CLSCTX_ALL, null, ppAC);
      _checkHr(hr, 'IMMDevice::Activate');
      this._pAudioClient = koffi.decode(ppAC, 'void *');

      // 重新获取 mix format（因为 IAudioClient 是新的）
      const ppMix2 = koffi.alloc('void *', 1);
      hr = koffi.call(_getVtblFnPtr(this._pAudioClient, 8), FT_AC_GetMixFmt, this._pAudioClient, ppMix2);
      _checkHr(hr, 'IAudioClient::GetMixFormat (retry)');
      const pMix2 = koffi.decode(ppMix2, 'void *');

      if (bufDur === 0) {
        // 让系统选择默认缓冲周期
        hr = koffi.call(_getVtblFnPtr(this._pAudioClient, 3), FT_AC_Init,
          this._pAudioClient, AUDCLNT_SHAREMODE_EXCLUSIVE, 0, 0, 0,
          pMix2, null);
      } else {
        hr = koffi.call(_getVtblFnPtr(this._pAudioClient, 3), FT_AC_Init,
          this._pAudioClient, AUDCLNT_SHAREMODE_EXCLUSIVE, 0, bufDur, period,
          pMix2, null);
      }
      lastHr = hr;
      if (hr === 0) { initOk = true; break; }
      console.warn(`[wasapi] Initialize failed with bufDur=${bufDur}: HRESULT 0x${(hr >>> 0).toString(16)}`);
      _CoTaskMemFree(pMix2);
    }
    if (!initOk) {
      _checkHr(lastHr, 'IAudioClient::Initialize');
    }

    // 获取缓冲区大小 (GetBufferSize = vtable index 4)
    const pBufSize = koffi.alloc('uint32', 1);
    hr = koffi.call(_getVtblFnPtr(this._pAudioClient, 4), FT_AC_GetBuf, this._pAudioClient, pBufSize);
    _checkHr(hr, 'IAudioClient::GetBufferSize');
    this._bufferFrames = koffi.decode(pBufSize, 'uint32');

    // 获取 IAudioRenderClient (GetService = vtable index 14)
    // 注意：GetService 在某些情况下可能返回 E_NOINTERFACE，作为回退尝试 QueryInterface
    const ppRenderClient = koffi.alloc('void *', 1);
    hr = koffi.call(_getVtblFnPtr(this._pAudioClient, 14), FT_AC_GetSvc, this._pAudioClient, IID_IAudioRenderClient, ppRenderClient);

    // 如果 GetService 失败，尝试使用 QueryInterface (vtable index 0)
    if (hr !== 0) {
      console.warn(`[wasapi] GetService returned 0x${(hr >>> 0).toString(16)}, trying QueryInterface`);
      // QueryInterface = vtable index 0
      hr = koffi.call(_getVtblFnPtr(this._pAudioClient, 0), FT_QI, this._pAudioClient, IID_IAudioRenderClient, ppRenderClient);
    }

    _checkHr(hr, 'IAudioClient::GetService(IAudioRenderClient)');
    this._pRenderClient = koffi.decode(ppRenderClient, 'void *');

    // 创建事件句柄（用于 WASAPI 通知）(SetEventHandle = vtable index 13)
    this._hEvent = _CreateEventW(null, 0, 0, null);
    if (this._hEvent) {
      try {
        koffi.call(_getVtblFnPtr(this._pAudioClient, 13), FT_AC_SetEvt, this._pAudioClient, this._hEvent);
      } catch { /* event handle optional */ }
    }

    this._initialized = true;
    return {
      sampleRate: this._sampleRate,
      channels: this._channels,
      bitsPerSample: this._bitsPerSample,
    };
  }

  // ── 文件播放 ──────────────────────────────────────────────────────────────

  async playFile(filePath) {
    if (!this._initialized) throw new Error('WASAPI not initialized');
    if (!filePath) throw new Error('No file path');

    const ff = _findFFmpeg();
    if (!ff) throw new Error('ffmpeg not found (required for audio decoding in exclusive mode)');

    // 保存当前文件路径（供 seek 使用）
    this._currentFilePath = filePath;

    // 清理旧的 ffmpeg 进程
    this._killFFmpeg();

    // 停止位置计时器
    this._stopPositionTimer();

    // 获取时长
    this._durationMs = await this._probeDuration(filePath);

    // 确定 ffmpeg 输出格式
    const fmtArg = this._bitsPerSample === 32 ? 'f32le' : 's16le';

    // 启动 ffmpeg 解码
    this._ffmpegFinished = false;
    this._pcmQueue = [];
    this._pcmQueueBytes = 0;
    this._framesConsumed = 0;

    const args = [
      '-i', filePath,
      '-f', fmtArg,
      '-ar', String(this._sampleRate),
      '-ac', String(this._channels),
      '-loglevel', 'quiet',
      'pipe:1',
    ];

    this._ffmpegProc = spawn(ff, args, { windowsHide: true });

    this._ffmpegProc.stdout.on('data', (chunk) => {
      this._pcmQueue.push(chunk);
      this._pcmQueueBytes += chunk.length;
    });

    this._ffmpegProc.stderr.on('data', () => { /* ignore stderr */ });

    this._ffmpegProc.on('close', (code) => {
      this._ffmpegFinished = true;
      this._ffmpegProc = null;
    });

    this._ffmpegProc.on('error', (e) => {
      console.error('[wasapi] ffmpeg error:', e);
      this._ffmpegFinished = true;
      this._ffmpegProc = null;
    });

    return { durationMs: this._durationMs };
  }

  async _probeDuration(filePath) {
    const probe = _findFFprobe();
    if (!probe) return 0;
    try {
      const output = execSync(
        `"${probe}" -v quiet -show_entries format=duration -of csv=p=0 "${filePath}"`,
        { encoding: 'utf8', timeout: 10000, windowsHide: true }
      ).trim();
      const seconds = parseFloat(output);
      return isNaN(seconds) ? 0 : Math.round(seconds * 1000);
    } catch {
      return 0;
    }
  }

  // ── 播放控制 ──────────────────────────────────────────────────────────────

  async play() {
    if (!this._initialized) throw new Error('Not initialized');
    if (!this._pAudioClient) throw new Error('No audio client');

    // Start = vtable index 10
    if (this._paused) {
      // 从暂停恢复
      this._paused = false;
      _checkHr(koffi.call(_getVtblFnPtr(this._pAudioClient, 10), FT_AC_Start, this._pAudioClient), 'IAudioClient::Start');
      this._playing = true;
      this._startFeedLoop();
      this._startPositionTimer();
      this.emit('state_changed', 'playing');
      return;
    }

    // 从头开始播放
    _checkHr(koffi.call(_getVtblFnPtr(this._pAudioClient, 10), FT_AC_Start, this._pAudioClient), 'IAudioClient::Start');
    this._playing = true;
    this._startFeedLoop();
    this._startPositionTimer();
    this.emit('state_changed', 'playing');
  }

  async pause() {
    if (!this._playing) return;
    // Stop = vtable index 11
    try { koffi.call(_getVtblFnPtr(this._pAudioClient, 11), FT_AC_Stop, this._pAudioClient); } catch { /* ignore */ }
    this._playing = false;
    this._paused = true;
    this._stopFeedLoop();
    this._stopPositionTimer();
    this.emit('state_changed', 'paused');
  }

  async stop() {
    this._playing = false;
    this._paused = false;
    this._stopFeedLoop();
    this._stopPositionTimer();
    this._killFFmpeg();
    this._pcmQueue = [];
    this._pcmQueueBytes = 0;
    this._framesConsumed = 0;

    if (this._pAudioClient) {
      try {
        // Stop = vtable index 11, Reset = vtable index 12
        koffi.call(_getVtblFnPtr(this._pAudioClient, 11), FT_AC_Stop, this._pAudioClient);
        koffi.call(_getVtblFnPtr(this._pAudioClient, 12), FT_AC_Reset, this._pAudioClient);
      } catch { /* ignore */ }
    }
    this.emit('state_changed', 'stopped');
  }

  async seek(positionMs) {
    if (!this._initialized) return;
    const seekSec = Math.max(0, positionMs / 1000);

    // 停止当前 feed loop
    const wasPlaying = this._playing;
    this._stopFeedLoop();

    // 重置 WASAPI 缓冲 (Stop = index 11, Reset = index 12)
    if (this._pAudioClient) {
      try {
        koffi.call(_getVtblFnPtr(this._pAudioClient, 11), FT_AC_Stop, this._pAudioClient);
        koffi.call(_getVtblFnPtr(this._pAudioClient, 12), FT_AC_Reset, this._pAudioClient);
      } catch { /* ignore */ }
    }

    // 杀掉旧 ffmpeg
    this._killFFmpeg();
    this._pcmQueue = [];
    this._pcmQueueBytes = 0;

    // 更新位置
    this._framesConsumed = Math.round(seekSec * this._sampleRate);

    // 重新启动 ffmpeg 从指定位置开始
    if (this._currentFilePath) {
      const ff = _findFFmpeg();
      if (ff) {
        const fmtArg = this._bitsPerSample === 32 ? 'f32le' : 's16le';
        const args = [
          '-ss', String(seekSec),
          '-i', this._currentFilePath,
          '-f', fmtArg,
          '-ar', String(this._sampleRate),
          '-ac', String(this._channels),
          '-loglevel', 'quiet',
          'pipe:1',
        ];
        this._ffmpegFinished = false;
        this._ffmpegProc = spawn(ff, args, { windowsHide: true });
        this._ffmpegProc.stdout.on('data', (chunk) => {
          this._pcmQueue.push(chunk);
          this._pcmQueueBytes += chunk.length;
        });
        this._ffmpegProc.on('close', () => {
          this._ffmpegFinished = true;
          this._ffmpegProc = null;
        });
        this._ffmpegProc.on('error', () => {
          this._ffmpegFinished = true;
          this._ffmpegProc = null;
        });
      }
    }

    // 恢复播放 (Start = vtable index 10)
    if (wasPlaying) {
      try {
        koffi.call(_getVtblFnPtr(this._pAudioClient, 10), FT_AC_Start, this._pAudioClient);
      } catch { /* ignore */ }
      this._playing = true;
      this._startFeedLoop();
      this._startPositionTimer();
    }

    this.emit('position_changed', positionMs);
  }

  async setVolume(level) {
    this._volume = Math.max(0, Math.min(1, level));
  }

  // ── 位置信息 ──────────────────────────────────────────────────────────────

  async getPosition() {
    return Math.round(this._framesConsumed / this._sampleRate * 1000);
  }

  getDuration() {
    return this._durationMs;
  }

  get isPlaying() {
    return this._playing;
  }

  // ── 内部：Feed Loop ─────────────────────────────────────────────────────────

  _startFeedLoop() {
    this._stopFeedLoop();
    // 10ms 间隔，足够及时地填充 WASAPI 缓冲
    this._feedTimer = setInterval(() => this._feedData(), 10);
  }

  _stopFeedLoop() {
    if (this._feedTimer) {
      clearInterval(this._feedTimer);
      this._feedTimer = null;
    }
  }

  _feedData() {
    if (!this._playing || !this._pRenderClient || !this._pAudioClient) return;

    try {
      // 获取当前缓冲区填充量 (GetCurrentPadding = vtable index 6)
      const pPadding = koffi.alloc('uint32', 1);
      const hr = koffi.call(_getVtblFnPtr(this._pAudioClient, 6), FT_AC_GetPad, this._pAudioClient, pPadding);
      if (hr !== 0) return;
      const padding = koffi.decode(pPadding, 'uint32');

      const framesAvailable = this._bufferFrames - padding;
      if (framesAvailable <= 0) {
        // 检查是否播放结束
        this._checkEnded();
        return;
      }

      // 从队列读取 PCM 数据
      const bytesNeeded = framesAvailable * this._bytesPerFrame;
      const pcmData = this._readFromQueue(bytesNeeded);

      if (pcmData.length === 0) {
        // 没有数据可用
        this._checkEnded();
        return;
      }

      // 应用音量
      if (this._volume < 1.0) {
        this._applyVolume(pcmData);
      }

      // 实际写入的帧数
      const framesToWrite = Math.floor(pcmData.length / this._bytesPerFrame);
      if (framesToWrite === 0) {
        this._checkEnded();
        return;
      }

      // 获取 WASAPI 缓冲区 (GetBuffer = vtable index 3)
      const ppData = koffi.alloc('void *', 1);
      const hr2 = koffi.call(_getVtblFnPtr(this._pRenderClient, 3), FT_RC_GetBuf, this._pRenderClient, framesToWrite, ppData);
      if (hr2 !== 0) return;

      const pData = koffi.decode(ppData, 'void *');
      if (!pData) return;

      // 将 PCM 数据复制到 WASAPI 缓冲区
      const bytesToCopy = framesToWrite * this._bytesPerFrame;
      // 使用 koffi.encode 写入数据
      const byteArrType = koffi.array('uint8', bytesToCopy);
      koffi.encode(pData, byteArrType, pcmData.slice(0, bytesToCopy));

      // 释放缓冲区 (ReleaseBuffer = vtable index 4)
      koffi.call(_getVtblFnPtr(this._pRenderClient, 4), FT_RC_RelBuf, this._pRenderClient, framesToWrite, 0);

      // 更新位置
      this._framesConsumed += framesToWrite;
    } catch (e) {
      // 设备失效等错误
      console.error('[wasapi] feed error:', e.message);
    }
  }

  _checkEnded() {
    if (this._ffmpegFinished && this._pcmQueueBytes === 0 && this._playing) {
      this._playing = false;
      this._stopFeedLoop();
      this._stopPositionTimer();
      this.emit('state_changed', 'stopped');
      if (this.onEnded) this.onEnded();
    }
  }

  _readFromQueue(bytesNeeded) {
    if (this._pcmQueueBytes === 0) return Buffer.alloc(0);

    const result = Buffer.alloc(bytesNeeded);
    let offset = 0;

    while (offset < bytesNeeded && this._pcmQueue.length > 0) {
      const chunk = this._pcmQueue[0];
      const remaining = bytesNeeded - offset;

      if (chunk.length <= remaining) {
        chunk.copy(result, offset);
        offset += chunk.length;
        this._pcmQueue.shift();
        this._pcmQueueBytes -= chunk.length;
      } else {
        chunk.copy(result, offset, 0, remaining);
        this._pcmQueue[0] = chunk.slice(remaining);
        this._pcmQueueBytes -= remaining;
        offset = bytesNeeded;
      }
    }

    return result.slice(0, offset);
  }

  _applyVolume(buf) {
    if (this._bitsPerSample === 32) {
      // 32-bit float
      const view = new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.length / 4));
      for (let i = 0; i < view.length; i++) {
        view[i] *= this._volume;
      }
    } else if (this._bitsPerSample === 16) {
      // 16-bit signed
      const view = new Int16Array(buf.buffer, buf.byteOffset, Math.floor(buf.length / 2));
      for (let i = 0; i < view.length; i++) {
        view[i] = Math.round(view[i] * this._volume);
      }
    }
  }

  // ── 内部：位置计时器 ─────────────────────────────────────────────────────────

  _startPositionTimer() {
    this._stopPositionTimer();
    this._posTimer = setInterval(() => {
      if (!this._playing) return;
      if (this.onPositionTick) {
        this.onPositionTick(Math.round(this._framesConsumed / this._sampleRate * 1000));
      }
    }, 100);
  }

  _stopPositionTimer() {
    if (this._posTimer) {
      clearInterval(this._posTimer);
      this._posTimer = null;
    }
  }

  // ── 内部：ffmpeg 管理 ────────────────────────────────────────────────────────

  _killFFmpeg() {
    if (this._ffmpegProc) {
      try {
        this._ffmpegProc.kill('SIGKILL');
      } catch { /* ignore */ }
      this._ffmpegProc = null;
    }
    this._ffmpegFinished = false;
  }

  // ── 清理 ─────────────────────────────────────────────────────────────────

  async close() {
    this._stopFeedLoop();
    this._stopPositionTimer();
    this._killFFmpeg();
    this._pcmQueue = [];
    this._pcmQueueBytes = 0;

    if (this._pRenderClient) {
      _release(this._pRenderClient);
      this._pRenderClient = null;
    }
    if (this._pAudioClient) {
      try {
        // Stop = vtable index 11
        koffi.call(_getVtblFnPtr(this._pAudioClient, 11), FT_AC_Stop, this._pAudioClient);
      } catch { /* ignore */ }
      _release(this._pAudioClient);
      this._pAudioClient = null;
    }
    if (this._pDevice) {
      _release(this._pDevice);
      this._pDevice = null;
    }
    if (this._pEnum) {
      _release(this._pEnum);
      this._pEnum = null;
    }
    if (this._hEvent) {
      try { _CloseHandle(this._hEvent); } catch { /* ignore */ }
      this._hEvent = null;
    }

    this._playing = false;
    this._paused = false;
    this._initialized = false;

    if (this._comInitialized) {
      try { _CoUninitialize(); } catch { /* ignore */ }
      this._comInitialized = false;
    }
  }
}

module.exports = { WasapiRenderer };
