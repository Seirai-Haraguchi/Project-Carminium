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

  // ── Audio PCM IPC（Web Audio API ↔ Main） ──────────────────────────────

  /**
   * 监听来自主进程的主音轨 PCM 数据。
   * @param {function(Float32Array)} callback
   * @returns {function} 取消监听函数
   */
  onAudioPcmMain: (callback) => {
    const handler = (_e, data) => callback(new Float32Array(data));
    ipcRenderer.on('audio_pcm_main', handler);
    return () => ipcRenderer.removeListener('audio_pcm_main', handler);
  },

  /**
   * 监听来自主进程的次音轨 PCM 数据。
   * @param {function(Float32Array)} callback
   * @returns {function} 取消监听函数
   */
  onAudioPcmNext: (callback) => {
    const handler = (_e, data) => callback(new Float32Array(data));
    ipcRenderer.on('audio_pcm_next', handler);
    return () => ipcRenderer.removeListener('audio_pcm_next', handler);
  },

  /**
   * 监听来自主进程的 FFmpeg 状态变化（main/next 完了通知）。
   * @param {function(channel: string, finished: boolean)} callback
   * @returns {function} 取消监听函数
   */
  onAudioFfmpegState: (callback) => {
    const handler = (_e, channel, finished) => callback(channel, finished);
    ipcRenderer.on('audio_ffmpeg_state', handler);
    return () => ipcRenderer.removeListener('audio_ffmpeg_state', handler);
  },

  /**
   * 监听来自主进程的 audio_control 消息（直接 IPC，不经过 bridge event）。
   * @param {function(json: string)} callback
   * @returns {function} 取消监听函数
   */
  onAudioControl: (callback) => {
    const handler = (_e, json) => callback(json);
    ipcRenderer.on('audio_control', handler);
    return () => ipcRenderer.removeListener('audio_control', handler);
  },

  /**
   * 监听来自主进程的 DLL 缓冲延迟值（ms），用于播放位置补偿。
   * @param {function(latencyMs: number)} callback
   * @returns {function} 取消监听函数
   */
  onAudioLatency: (callback) => {
    const handler = (_e, latencyMs) => callback(latencyMs);
    ipcRenderer.on('audio_latency', handler);
    return () => ipcRenderer.removeListener('audio_latency', handler);
  },

  /**
   * 将 AudioEngine 合成的 PCM 数据发送到主进程。
   * @param {ArrayBuffer} arrayBuffer - interleaved f32 PCM
   */
  sendAudioOutput: (arrayBuffer) => ipcRenderer.send('audio_output', arrayBuffer),

  /**
   * 通知主进程：当前曲目播放完毕。
   */
  sendAudioEnded: () => ipcRenderer.send('audio_ended'),

  /**
   * 通知主进程：播放位置更新。
   * @param {number} ms - 当前位置（毫秒）
   */
  sendAudioPositionTick: (ms) => ipcRenderer.send('audio_position_tick', ms),

  /**
   * 通知主进程：AutoMix / Gapless 过渡完成。
   * @param {number} positionMs - 过渡完成后的播放位置（ms）
   */
  sendAudioCrossfadeComplete: (positionMs) => ipcRenderer.send('audio_crossfade_complete', positionMs),

  /**
   * 通知主进程：AutoMix crossfade 已启动（next 源开始淡入）。
   * player.js 据此设置 _inCrossfade 标志，避免在过渡期内打断（如 setRepeat 清理 next）。
   */
  sendAudioCrossfadeStart: () => ipcRenderer.send('audio_crossfade_start'),

  /**
   * 通知主进程：无缝切换完成（Web Audio API 模式）。
   * player.js 据此推进队列索引，无需 promoteNextToCurrent。
   */
  sendAudioGaplessSwitch: () => ipcRenderer.send('audio_gapless_switch'),

  // ── Web Audio API: 文件解码 IPC ──────────────────────────────────────────

  /**
   * 请求主进程读取音频文件并返回 ArrayBuffer，供渲染进程 decodeAudioData 使用。
   * @param {string} filePath - 音频文件路径
   */
  requestDecodeAudioFile: (filePath) => ipcRenderer.send('decode_audio_file', filePath),

  /**
   * 监听来自主进程的已解码音频文件数据。
   * @param {function(filePath: string, arrayBuffer: ArrayBuffer)} callback
   * @returns {function} 取消监听函数
   */
  onAudioFileDecoded: (callback) => {
    const handler = (_e, filePath, arrayBuffer) => callback(filePath, arrayBuffer);
    ipcRenderer.on('audio_file_decoded', handler);
    return () => ipcRenderer.removeListener('audio_file_decoded', handler);
  },

  /**
   * 监听来自主进程的音频文件解码错误。
   * @param {function(filePath: string, error: string)} callback
   * @returns {function} 取消监听函数
   */
  onAudioFileDecodeError: (callback) => {
    const handler = (_e, filePath, error) => callback(filePath, error);
    ipcRenderer.on('audio_file_decode_error', handler);
    return () => ipcRenderer.removeListener('audio_file_decode_error', handler);
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
