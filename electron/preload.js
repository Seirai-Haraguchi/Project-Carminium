/**
 * Carminium — Electron Preload Script
 * 通过 contextBridge 安全地暴露 IPC API 到渲染进程。
 * 为前端提供后端 API 兼容层。
 */
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// ── 暴露 Electron API 到渲染进程 ──────────────────────────────────────────

contextBridge.exposeInMainWorld('__electronAPI', {
  /**
   * 调用主进程的 IPC handler（invoke/handle 模式）。
   * @param {string} method - 方法名
   * @param {...any} args - 参数
   * @returns {Promise<any>}
   */
  invoke: (method, ...args) => ipcRenderer.invoke(method, ...args),

  /**
   * 监听来自主进程的 Bridge 事件。
   * @param {function(event: string, payload: any)} callback
   * @returns {function} 取消监听函数
   */
  onBridgeEvent: (callback) => {
    const handler = (_e, data) => callback(data.event, data.payload);
    ipcRenderer.on('bridge:event', handler);
    return () => ipcRenderer.removeListener('bridge:event', handler);
  },

  /**
   * 监听 SMTC 相关的 IPC 消息。
   * @param {string} channel - smtc 子频道（metadata/state/position/duration/shuffle/repeat/lyric_title）
   * @param {function(data: any)} callback
   * @returns {function} 取消监听函数
   */
  onSmtc: (channel, callback) => {
    const fullChannel = 'smtc:' + channel;
    const handler = (_e, data) => callback(data);
    ipcRenderer.on(fullChannel, handler);
    return () => ipcRenderer.removeListener(fullChannel, handler);
  },

  /**
   * 监听窗口震动事件。
   * @param {function()} callback
   * @returns {function} 取消监听函数
   */
  onBeatShake: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('beat_shake', handler);
    return () => ipcRenderer.removeListener('beat_shake', handler);
  },

  /**
   * 判断是否运行在 Electron 环境中。
   */
  isElectron: true,
});

// ── 兼容层说明 ───────────────────────────────────────────────────────────
// 前端 bridge.js 检测到 __electronAPI 后会创建 window.pywebview.api Proxy，
// 将方法调用转发到 ipcRenderer.invoke。
// 注意：contextBridge 不允许直接暴露 Proxy 对象，
// 因此由 bridge.js 在检测到 __electronAPI 后自行创建。
