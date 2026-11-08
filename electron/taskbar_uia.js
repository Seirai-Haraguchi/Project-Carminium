'use strict';

// Windows 11 的任务栏由 XAML 渲染，旧的 ReBarWindow32 矩形已经不能代表图标实际位置。
// 这里通过 UI Automation 读取任务栏内容元素的外接矩形，拿到真实的图标区域。

const IS_WIN = process.platform === 'win32';

const BRIDGE_CLASS = 'Windows.UI.Composition.DesktopWindowContentBridge';
const TREE_SCOPE_DESCENDANTS = 4;
const CACHE_TTL_MS = 3000;

const CLSID_CUIAUTOMATION = {
  Data1: 0xff48dba4, Data2: 0x60ef, Data3: 0x4201,
  Data4: [0xaa, 0x87, 0x54, 0x10, 0x3e, 0xef, 0x59, 0x4e],
};
const IID_IUIAUTOMATION = {
  Data1: 0x30cbe57d, Data2: 0xd9d0, Data3: 0x452a,
  Data4: [0xab, 0x13, 0x7a, 0xc5, 0xac, 0x48, 0x25, 0xee],
};

let _api = null;
let _automation = 0n;
let _comInitialized = false;
let _failed = false;
let _cache = null;

function _load() {
  if (_api || _failed) return _api;
  if (!IS_WIN) {
    _failed = true;
    return null;
  }
  try {
    const koffi = require('koffi');
    const GUID = koffi.struct('TL_GUID', {
      Data1: 'uint32', Data2: 'uint16', Data3: 'uint16', Data4: 'uint8[8]',
    });
    const ole32 = koffi.load('ole32.dll');
    const user32 = koffi.load('user32.dll');

    _api = {
      koffi,
      CoInitializeEx: ole32.func('int32 CoInitializeEx(void *reserved, uint32 coinit)'),
      CoUninitialize: ole32.func('void CoUninitialize()'),
      CoCreateInstance: ole32.func('int32 CoCreateInstance(TL_GUID *rclsid, void *outer, uint32 ctx, TL_GUID *riid, void *out)'),
      FindWindowExW: user32.func('uintptr FindWindowExW(uintptr parent, uintptr after, str16 cls, str16 title)'),
      clsid: CLSID_CUIAUTOMATION,
      iid: IID_IUIAUTOMATION,
      proto: {
        createTrueCondition: koffi.proto('int32 CreateTrueCondition(void *self, void *out)'),
        elementFromHandle: koffi.proto('int32 ElementFromHandle(void *self, uintptr hwnd, void *out)'),
        findAll: koffi.proto('int32 FindAll(void *self, int32 scope, void *cond, void *out)'),
        getLength: koffi.proto('int32 GetLength(void *self, void *out)'),
        getElement: koffi.proto('int32 GetElement(void *self, int32 index, void *out)'),
        getRect: koffi.proto('int32 GetRect(void *self, void *out)'),
        release: koffi.proto('uint32 Release(void *self)'),
      },
    };
    void GUID;
  } catch (e) {
    _failed = true;
    console.warn('[taskbar-lyrics] UIAutomation 初始化失败:', e.message);
    return null;
  }
  return _api;
}

function _vtCall(obj, index, proto, ...args) {
  const api = _api;
  const vtable = api.koffi.decode(obj, 'void*');
  const fn = api.koffi.decode(vtable + BigInt(index * 8), 'void*');
  return api.koffi.call(fn, proto, obj, ...args);
}

function _release(obj) {
  if (!obj) return;
  try { _vtCall(obj, 2, _api.proto.release); } catch {  }
}

function _ensureAutomation() {
  const api = _load();
  if (!api) return 0n;
  if (_automation) return _automation;

  try {
    // 主线程可能已经初始化过 COM，返回 RPC_E_CHANGED_MODE 时沿用现有 apartment。
    const hr = api.CoInitializeEx(null, 2);
    _comInitialized = hr === 0 || hr === 1;
  } catch {
    _comInitialized = false;
  }

  const out = Buffer.alloc(8);
  try {
    const hr = api.CoCreateInstance(api.clsid, null, 1, api.iid, out);
    if (hr !== 0) {
      _failed = true;
      return 0n;
    }
    _automation = out.readBigUInt64LE(0);
  } catch (e) {
    _failed = true;
    console.warn('[taskbar-lyrics] 无法创建 UIAutomation 实例:', e.message);
    return 0n;
  }
  return _automation;
}

/**
 * 读取任务栏图标区域的外接矩形（物理像素）。
 * @param {number} taskbarHwnd Shell_TrayWnd 句柄
 * @param {number} taskbarWidth 任务栏宽度（物理像素）
 * @param {number} trayLeft 托盘区域左边界（物理像素）
 * @returns {{left:number,right:number,top:number,bottom:number}|null}
 */
function scanContentBounds(taskbarHwnd, taskbarWidth, trayLeft) {
  const api = _load();
  if (!api || !taskbarHwnd || taskbarWidth <= 0) return null;

  const cacheKey = `${taskbarHwnd}:${taskbarWidth}:${trayLeft}`;
  if (_cache && _cache.key === cacheKey && Date.now() - _cache.at < CACHE_TTL_MS) {
    return _cache.bounds;
  }

  const automation = _ensureAutomation();
  if (!automation) return null;

  const bridge = Number(api.FindWindowExW(taskbarHwnd, 0, BRIDGE_CLASS, null));
  if (!bridge) return null;

  let el = 0n;
  let cond = 0n;
  let arr = 0n;
  try {
    const elOut = Buffer.alloc(8);
    if (_vtCall(automation, 6, api.proto.elementFromHandle, bridge, elOut) !== 0) return null;
    el = elOut.readBigUInt64LE(0);
    if (!el) return null;

    const condOut = Buffer.alloc(8);
    if (_vtCall(automation, 21, api.proto.createTrueCondition, condOut) !== 0) return null;
    cond = condOut.readBigUInt64LE(0);

    const arrOut = Buffer.alloc(8);
    if (_vtCall(el, 6, api.proto.findAll, TREE_SCOPE_DESCENDANTS, cond, arrOut) !== 0) return null;
    arr = arrOut.readBigUInt64LE(0);
    if (!arr) return null;

    const lenBuf = Buffer.alloc(4);
    if (_vtCall(arr, 3, api.proto.getLength, lenBuf) !== 0) return null;
    const len = lenBuf.readInt32LE(0);
    if (len <= 0) return null;

    let left = 0;
    let right = 0;
    let top = 0;
    let bottom = 0;
    let found = false;

    for (let i = 0; i < len; i++) {
      const eOut = Buffer.alloc(8);
      if (_vtCall(arr, 4, api.proto.getElement, i, eOut) !== 0) continue;
      const e = eOut.readBigUInt64LE(0);
      if (!e) continue;

      const rb = Buffer.alloc(16);
      const hr = _vtCall(e, 43, api.proto.getRect, rb);
      _release(e);
      if (hr !== 0) continue;

      const x = rb.readInt32LE(0);
      const y = rb.readInt32LE(4);
      const x2 = rb.readInt32LE(8);
      const y2 = rb.readInt32LE(12);
      const w = x2 - x;
      if (w <= 0 || y2 <= y) continue;
      if (x >= trayLeft) continue;
      if (w > taskbarWidth * 0.8) continue;

      left = found ? Math.min(left, x) : x;
      right = found ? Math.max(right, x2) : x2;
      top = found ? Math.min(top, y) : y;
      bottom = found ? Math.max(bottom, y2) : y2;
      found = true;
    }

    const bounds = found && right > left ? { left, right, top, bottom } : null;
    _cache = { key: cacheKey, at: Date.now(), bounds };
    return bounds;
  } catch (e) {
    _failed = true;
    console.warn('[taskbar-lyrics] UIAutomation 扫描失败:', e.message);
    return null;
  } finally {
    _release(arr);
    _release(cond);
    _release(el);
  }
}

function dispose() {
  _release(_automation);
  _automation = 0n;
  _cache = null;
  if (_comInitialized && _api) {
    try { _api.CoUninitialize(); } catch {  }
  }
  _comInitialized = false;
}

module.exports = { scanContentBounds, dispose };
