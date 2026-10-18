'use strict';

const { contextBridge, ipcRenderer, webUtils } = require('electron');


contextBridge.exposeInMainWorld('__electronAPI', {
  getPathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file) || '';
    } catch {
      return '';
    }
  },

  invoke: (method, ...args) => ipcRenderer.invoke(method, ...args),

  onBridgeEvent: (callback) => {
    const handler = (_e, data) => callback(data.event, data.payload);
    ipcRenderer.on('bridge:event', handler);
    return () => ipcRenderer.removeListener('bridge:event', handler);
  },

  onSmtc: (channel, callback) => {
    const fullChannel = 'smtc:' + channel;
    const handler = (_e, data) => callback(data);
    ipcRenderer.on(fullChannel, handler);
    return () => ipcRenderer.removeListener(fullChannel, handler);
  },


  onAudioPcmMain: (callback) => {
    const handler = (_e, data) => callback(
      data instanceof Float32Array ? data : new Float32Array(data)
    );
    ipcRenderer.on('audio_pcm_main', handler);
    return () => ipcRenderer.removeListener('audio_pcm_main', handler);
  },

  onAudioPcmNext: (callback) => {
    const handler = (_e, data) => callback(
      data instanceof Float32Array ? data : new Float32Array(data)
    );
    ipcRenderer.on('audio_pcm_next', handler);
    return () => ipcRenderer.removeListener('audio_pcm_next', handler);
  },

  onAudioFfmpegState: (callback) => {
    const handler = (_e, channel, finished) => callback(channel, finished);
    ipcRenderer.on('audio_ffmpeg_state', handler);
    return () => ipcRenderer.removeListener('audio_ffmpeg_state', handler);
  },

  onAudioControl: (callback) => {
    const handler = (_e, json) => callback(json);
    ipcRenderer.on('audio_control', handler);
    return () => ipcRenderer.removeListener('audio_control', handler);
  },

  onAudioLatency: (callback) => {
    const handler = (_e, latencyMs) => callback(latencyMs);
    ipcRenderer.on('audio_latency', handler);
    return () => ipcRenderer.removeListener('audio_latency', handler);
  },

  sendAudioOutput: (arrayBuffer) => ipcRenderer.send('audio_output', arrayBuffer),

  sendAudioEnded: () => ipcRenderer.send('audio_ended'),

  sendAudioPositionTick: (ms) => ipcRenderer.send('audio_position_tick', ms),

  sendAudioCrossfadeComplete: (positionMs) => ipcRenderer.send('audio_crossfade_complete', positionMs),

  sendAudioCrossfadeStart: () => ipcRenderer.send('audio_crossfade_start'),

  sendAudioGaplessSwitch: () => ipcRenderer.send('audio_gapless_switch'),


  requestDecodeAudioFile: (filePath) => ipcRenderer.send('decode_audio_file', filePath),

  onAudioFileDecoded: (callback) => {
    const handler = (_e, filePath, arrayBuffer) => callback(filePath, arrayBuffer);
    ipcRenderer.on('audio_file_decoded', handler);
    return () => ipcRenderer.removeListener('audio_file_decoded', handler);
  },

  onAudioFileDecodeError: (callback) => {
    const handler = (_e, filePath, error) => callback(filePath, error);
    ipcRenderer.on('audio_file_decode_error', handler);
    return () => ipcRenderer.removeListener('audio_file_decode_error', handler);
  },

  isElectron: true,

  platform: process.platform,
});

