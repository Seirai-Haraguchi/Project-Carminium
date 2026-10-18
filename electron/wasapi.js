'use strict';

const koffi = require('koffi');
const { execSync, execFile } = require('child_process');
const { EventEmitter } = require('events');
const fs = require('fs');
const path = require('path');
const { DecoderPool } = require('./decoder_pool');

const SHARE_SHARED = 0;
const SHARE_EXCLUSIVE = 1;

const IS_WIN = process.platform === 'win32';
const IS_MAC = process.platform === 'darwin';
const PLATFORM_SUBDIR = IS_WIN ? 'win32' : (process.platform === 'linux' ? 'linux' : (IS_MAC ? 'darwin' : process.platform));
const LIB_NAME = IS_WIN ? 'carminium_audio.dll' : (IS_MAC ? 'carminium_audio.dylib' : 'carminium_audio.so');
const FFMPEG_NAME = IS_WIN ? 'ffmpeg.exe' : 'ffmpeg';
const FFPROBE_NAME = IS_WIN ? 'ffprobe.exe' : 'ffprobe';

function _resolveRealPath(p) {
  if (!p) return p;

  if (p.includes('.asar')) {
    return p.replace(/\.asar([\\/])/, '.asar.unpacked$1');
  }
  return p;
}

let _lib = null;
let _f = {};
let _nativeInitFailed = false;

function _loadDll() {
  if (_lib) return true;

  const candidates = [

    path.join(__dirname, 'bin', PLATFORM_SUBDIR, LIB_NAME),

    path.join(__dirname, 'bin', LIB_NAME),

    path.join(__dirname, '..', 'native', 'zig-out', 'bin', LIB_NAME),
  ];

  if (!IS_WIN) {
    candidates.push(path.join(__dirname, '..', 'native', 'zig-out', 'lib', LIB_NAME));
  }

  if (process.resourcesPath) {
    candidates.push(path.join(process.resourcesPath, LIB_NAME));
    candidates.push(path.join(process.resourcesPath, 'electron', 'bin', PLATFORM_SUBDIR, LIB_NAME));
  }
  let libPath = null;
  for (const c of candidates) {

    const realPath = _resolveRealPath(c);
    if (fs.existsSync(realPath)) { libPath = realPath; break; }
  }
  if (!libPath) {
    console.error('[wasapi] Native library not found:', LIB_NAME, '. Searched:',
      candidates.map((candidate) => _resolveRealPath(candidate)));
    return false;
  }

  try {
    _lib = koffi.load(libPath);
  } catch (e) {
    console.error('[wasapi] Failed to load native library', LIB_NAME, ':', e.message);
    return false;
  }

  const decls = [
    ['ca_init',                      'int32  ca_init(int32 share_mode, int32 device_index, uint32 sample_rate, uint16 channels)'],
    ['ca_start',                     'int32  ca_start()'],
    ['ca_stop',                      'int32  ca_stop()'],
    ['ca_push_pcm',                  'int32  ca_push_pcm(uint8 *data, uint32 len)'],
    ['ca_set_volume',                'void   ca_set_volume(float vol)'],
    ['ca_get_consumed_frames',       'uint64 ca_get_consumed_frames()'],
    ['ca_get_buffered_bytes',        'uint32 ca_get_buffered_bytes()'],
    ['ca_clear_buffer',              'void   ca_clear_buffer()'],
    ['ca_get_sample_rate',           'uint32 ca_get_sample_rate()'],
    ['ca_get_channels',              'uint16 ca_get_channels()'],
    ['ca_get_bits_per_sample',       'uint16 ca_get_bits_per_sample()'],
    ['ca_get_share_mode',            'int32  ca_get_share_mode()'],
    ['ca_is_playing',                'int32  ca_is_playing()'],
    ['ca_close',                     'void   ca_close()'],
    ['ca_enumerate_devices',         'char * ca_enumerate_devices()'],
    ['ca_free_string',               'void   ca_free_string(void *str)'],
  ];

  try {
    for (const [name, sig] of decls) {
      _f[name] = _lib.func(sig);
    }
  } catch (e) {
    console.error('[wasapi] Failed to declare native function:', e.message);
    _lib = null;
    _f = {};
    return false;
  }

  return true;
}

let _ffmpegPath = null, _ffprobePath = null;

function _findFFmpeg() {
  if (_ffmpegPath !== null) return _ffmpegPath;
  const bundled = path.join(__dirname, 'bin', PLATFORM_SUBDIR, FFMPEG_NAME);
  const bundledReal = _resolveRealPath(bundled);
  if (fs.existsSync(bundledReal)) { _ffmpegPath = bundledReal; return _ffmpegPath; }
  const bundledFlat = path.join(__dirname, 'bin', FFMPEG_NAME);
  const bundledFlatReal = _resolveRealPath(bundledFlat);
  if (fs.existsSync(bundledFlatReal)) { _ffmpegPath = bundledFlatReal; return _ffmpegPath; }
  const devBin = path.join(__dirname, '..', 'bin', PLATFORM_SUBDIR, FFMPEG_NAME);
  if (fs.existsSync(devBin)) { _ffmpegPath = _resolveRealPath(devBin); return _ffmpegPath; }
  const devBinFlat = path.join(__dirname, '..', 'bin', FFMPEG_NAME);
  if (fs.existsSync(devBinFlat)) { _ffmpegPath = _resolveRealPath(devBinFlat); return _ffmpegPath; }
  try {
    execSync(IS_WIN ? 'ffmpeg -version' : 'ffmpeg -version 2>/dev/null',
      { stdio: 'ignore', timeout: 5000 });
    _ffmpegPath = 'ffmpeg';
    return _ffmpegPath;
  } catch {  }

  const locations = IS_WIN
    ? [
        'C:\\ffmpeg\\bin\\ffmpeg.exe',
        'C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe',
        'C:\\Program Files (x86)\\ffmpeg\\bin\\ffmpeg.exe',
        path.join(process.env.LOCALAPPDATA || '', 'ffmpeg', 'bin', 'ffmpeg.exe'),
      ]
    : [
        '/usr/bin/ffmpeg',
        '/usr/local/bin/ffmpeg',
        '/opt/ffmpeg/bin/ffmpeg',
        path.join(process.env.HOME || '', '.local', 'bin', 'ffmpeg'),
        '/snap/bin/ffmpeg',
      ];
  for (const loc of locations) {
    if (fs.existsSync(loc)) { _ffmpegPath = loc; return _ffmpegPath; }
  }
  _ffmpegPath = false;
  return _ffmpegPath;
}

function _findFFprobe() {
  if (_ffprobePath !== null) return _ffprobePath;
  const bundled = path.join(__dirname, 'bin', PLATFORM_SUBDIR, FFPROBE_NAME);
  const bundledReal = _resolveRealPath(bundled);
  if (fs.existsSync(bundledReal)) { _ffprobePath = bundledReal; return _ffprobePath; }
  const bundledFlat = path.join(__dirname, 'bin', FFPROBE_NAME);
  const bundledFlatReal = _resolveRealPath(bundledFlat);
  if (fs.existsSync(bundledFlatReal)) { _ffprobePath = bundledFlatReal; return _ffprobePath; }
  const devBin = path.join(__dirname, '..', 'bin', PLATFORM_SUBDIR, FFPROBE_NAME);
  if (fs.existsSync(devBin)) { _ffprobePath = _resolveRealPath(devBin); return _ffprobePath; }
  const devBinFlat = path.join(__dirname, '..', 'bin', FFPROBE_NAME);
  if (fs.existsSync(devBinFlat)) { _ffprobePath = _resolveRealPath(devBinFlat); return _ffprobePath; }
  try {
    execSync(IS_WIN ? 'ffprobe -version' : 'ffprobe -version 2>/dev/null',
      { stdio: 'ignore', timeout: 5000 });
    _ffprobePath = 'ffprobe';
    return _ffprobePath;
  } catch {  }
  const ff = _findFFmpeg();
  if (ff && ff !== 'ffmpeg') {
    const probePath = path.join(path.dirname(ff), FFPROBE_NAME);
    if (fs.existsSync(probePath)) { _ffprobePath = probePath; return _ffprobePath; }
  }

  if (!IS_WIN) {
    const linuxLocations = [
      '/usr/bin/ffprobe',
      '/usr/local/bin/ffprobe',
      '/opt/ffmpeg/bin/ffprobe',
      path.join(process.env.HOME || '', '.local', 'bin', 'ffprobe'),
      '/snap/bin/ffprobe',
    ];
    for (const loc of linuxLocations) {
      if (fs.existsSync(loc)) { _ffprobePath = loc; return _ffprobePath; }
    }
  }
  _ffprobePath = false;
  return _ffprobePath;
}

class NativeRenderer extends EventEmitter {
  constructor() {
    super();
    this._initialized = false;
    this._playing = false;
    this._paused = false;
    this._volume = 1.0;

    this._sampleRate = 0;
    this._channels = 0;
    this._bytesPerFrame = 0;
    this._durationMs = 0;
    this._shareMode = SHARE_SHARED;

    this._currentFilePath = null;

    this._decoder = null;
    this._ffmpegDataStarted = false;

    this._seekOffsetMs = 0;

    this._resumePositionMs = null;

    this._nextDurationMs = 0;
    this._nextFilePath = null;

    this._nextReady = false;

    this._webAudioEnabled = false;

    this._webAudioBrowserDecode = false;

    this.sendPcmToRenderer = null;
    this.sendFfmpegState = null;

    this._drainTimer = null;

    this.PREROLL_MS = 800;
    this.PREROLL_TIMEOUT_MS = 3000;
    this._prerollTimer = null;

    this._dummyMode = false;
  }

  static enumerateDevices() {
    if (_nativeInitFailed) return [];
    if (!_loadDll()) return [];
    try {
      const json = _f.ca_enumerate_devices();
      if (!json) return [];
      const parsed = JSON.parse(json);
      const devices = (parsed.devices || []).map((d) => ({
        id: String(d.index),
        name: d.name,
        index: d.index,
      }));
      return devices;
    } catch (e) {
      console.error('[wasapi] enumerateDevices failed:', e);
      return [];
    }
  }

  static resetNativeInitFailed() {
    if (_nativeInitFailed) {
      _nativeInitFailed = false;
      console.log('[wasapi] Native init failure flag reset — will retry on next init()');
    }
  }

  async init(opts = {}) {
    if (!_loadDll()) throw new Error('carminium_audio native library not loaded: ' + LIB_NAME);
    if (this._initialized) await this.close();

    if (_nativeInitFailed) {
      this._enterDummyMode(opts);
      return {
        sampleRate: this._sampleRate,
        channels: this._channels,
        bitsPerSample: 32,
        shareMode: this._shareMode,
      };
    }

    const shareMode = (IS_WIN && opts.shareMode === SHARE_EXCLUSIVE) ? SHARE_EXCLUSIVE : SHARE_SHARED;
    const deviceIndex = opts.deviceIndex != null ? opts.deviceIndex : -1;
    const sampleRate = opts.sampleRate || 0;
    const channels = opts.channels || 2;

    const result = _f.ca_init(shareMode, deviceIndex, sampleRate, channels);
    if (result !== 0) {

      if (shareMode === SHARE_EXCLUSIVE) {
        console.warn('[wasapi] Exclusive mode init failed (ca_init=' + result + '), falling back to shared');
        const retry = _f.ca_init(SHARE_SHARED, deviceIndex, sampleRate, channels);
        if (retry !== 0) {

          console.error('[wasapi] ca_init failed (miniaudio error ' + retry +
            ') — entering dummy mode (no audio device available)');
          _nativeInitFailed = true;
          this._enterDummyMode(opts);
          return {
            sampleRate: this._sampleRate,
            channels: this._channels,
            bitsPerSample: 32,
            shareMode: this._shareMode,
          };
        }
      } else {

        console.error('[wasapi] ca_init failed (miniaudio error ' + result +
          ') — entering dummy mode (no audio device available)');
        _nativeInitFailed = true;
        this._enterDummyMode(opts);
        return {
          sampleRate: this._sampleRate,
          channels: this._channels,
          bitsPerSample: 32,
          shareMode: this._shareMode,
        };
      }
    }

    this._shareMode      = _f.ca_get_share_mode();
    this._sampleRate     = _f.ca_get_sample_rate();
    this._channels       = _f.ca_get_channels();
    this._bytesPerFrame  = (this._channels * 32) / 8;
    this._initialized    = true;
    this._seekOffsetMs   = 0;

    _f.ca_set_volume(1.0);

    const modeStr = this._shareMode === SHARE_EXCLUSIVE ? 'exclusive' : 'shared';
    console.log(`[wasapi] Initialized ${modeStr} mode: ` +
                `${this._sampleRate}Hz, ${this._channels}ch, f32`);

    const ff = _findFFmpeg();
    if (ff) {
      if (!this._decoder) this._decoder = new DecoderPool(ff);
      this._decoder.configure(this._sampleRate, this._channels);
    }

    return {
      sampleRate: this._sampleRate,
      channels: this._channels,
      bitsPerSample: 32,
      shareMode: this._shareMode,
    };
  }

  _enterDummyMode(opts = {}) {
    this._dummyMode = true;
    this._initialized = true;
    this._playing = false;
    this._paused = false;
    this._volume = 1.0;
    this._shareMode = SHARE_SHARED;

    this._sampleRate = opts.sampleRate || 44100;
    this._channels = opts.channels || 2;
    this._bytesPerFrame = (this._channels * 32) / 8;
    this._seekOffsetMs = 0;

    const ff = _findFFmpeg();
    if (ff) {
      if (!this._decoder) this._decoder = new DecoderPool(ff);
      this._decoder.configure(this._sampleRate, this._channels);
    }

    console.warn('[wasapi] Dummy mode active: sampleRate=' + this._sampleRate +
      ', channels=' + this._channels + ' — audio output disabled');
  }

  async playFile(filePath) {
    if (!this._initialized) throw new Error('Renderer not initialized');
    if (!filePath) throw new Error('No file path');

    if (!this._decoder) throw new Error('ffmpeg not found (required for audio decoding)');

    this._currentFilePath = filePath;
    this._webAudioBrowserDecode = false;
    this._decoder.stopSlot('main');
    this._decoder.stopSlot('next');
    this._stopDrainTimer();
    this._nextFilePath = null;
    this._nextDurationMs = 0;
    this._seekOffsetMs = 0;
    this._resumePositionMs = null;
    if (!this._dummyMode) _f.ca_clear_buffer();

    this._durationMs = await this._probeDuration(filePath);

    const _this = this;
    this._ffmpegDataStarted = false;
    this._decoder.start('main', filePath, 0,
       (fa) => {
        if (!_this._ffmpegDataStarted) _this._ffmpegDataStarted = true;
        if (_this.sendPcmToRenderer) _this.sendPcmToRenderer('main', fa);
      },
       () => {
        if (_this.sendFfmpegState) _this.sendFfmpegState('main', true);
      },
       () => {
        if (_this.sendFfmpegState) _this.sendFfmpegState('main', true);
      }
    );

    const maxWaitMs = 2000;
    const startT = Date.now();

    await new Promise((resolve) => {
      const check = () => {
        if (this._ffmpegDataStarted) { resolve(); return; }
        if (!this._decoder.isSlotActive('main')) { resolve(); return; }
        if (Date.now() - startT > maxWaitMs) { resolve(); return; }
        setTimeout(check, 20);
      };
      check();
    });

    return { durationMs: this._durationMs };
  }

  _spawnFFmpeg(filePath, seekSec) {

  }

  async _probeDuration(filePath) {
    const probe = _findFFprobe();
    if (!probe) return 0;
    return new Promise((resolve) => {
      const args = [
        '-v', 'quiet',
        '-show_entries', 'format=duration',
        '-of', 'csv=p=0',
        filePath,
      ];
      const child = execFile(probe, args, { timeout: 10000 }, (err, stdout) => {
        if (err) { resolve(0); return; }
        const seconds = parseFloat(stdout.trim());
        resolve(isNaN(seconds) ? 0 : Math.round(seconds * 1000));
      });

      setTimeout(() => { try { child.kill(); } catch {} }, 10500);
    });
  }

  _onPcmData(chunk, channel) {

    if (chunk instanceof Float32Array && this.sendPcmToRenderer) {
      this.sendPcmToRenderer(channel, chunk);
    }
  }

  pushProcessedPcm(float32ArrayOrBuffer) {
    if (!this._initialized) return -1;

    if (this._dummyMode) return 0;

    let buf;
    if (Buffer.isBuffer(float32ArrayOrBuffer)) {
      buf = float32ArrayOrBuffer;
    } else if (float32ArrayOrBuffer instanceof Float32Array) {
      buf = Buffer.from(float32ArrayOrBuffer.buffer, float32ArrayOrBuffer.byteOffset, float32ArrayOrBuffer.byteLength);
    } else if (ArrayBuffer.isView(float32ArrayOrBuffer)) {
      buf = Buffer.from(float32ArrayOrBuffer.buffer, float32ArrayOrBuffer.byteOffset, float32ArrayOrBuffer.byteLength);
    } else {
      return -1;
    }

    const result = _f.ca_push_pcm(buf, buf.length);
    if (result !== 0) {
      if (result === -2) {
        this._pushOverflowCount = (this._pushOverflowCount || 0) + 1;
        if (this._pushOverflowCount % 100 === 1) {
          console.warn(`[wasapi] ca_push_pcm buffer full (overflow #${this._pushOverflowCount}), len=${buf.length}`);
        }
      } else {
        console.error('[wasapi] ca_push_pcm failed:', result, 'len=', buf.length);
      }
    }
    return result;
  }

  _startDrainTimer() {
    if (this._drainTimer) return;

  }

  _stopDrainTimer() {
    if (this._drainTimer) {
      clearInterval(this._drainTimer);
      this._drainTimer = null;
    }
  }

  pauseStdout(channel) {
    if (this._decoder) this._decoder.pauseStdout(channel);
  }

  resumeStdout(channel) {
    if (this._decoder) this._decoder.resumeStdout(channel);
  }

  _startWithPreroll() {
    this._cancelPreroll();
    if (!this._initialized) return;

    if (this._dummyMode) return;

    const targetBytes = Math.max(1, Math.round(
      this._sampleRate * this._bytesPerFrame * (this.PREROLL_MS / 1000)
    ));

    const tryStart = () => {
      const r = _f.ca_start();
      if (r !== 0) {
        console.error('[wasapi] ca_start failed:', r);
      }
    };

    let buffered = 0;
    try { buffered = _f.ca_get_buffered_bytes(); } catch {  }
    if (buffered >= targetBytes) {
      tryStart();
      return;
    }

    const startT = Date.now();
    console.log('[wasapi] preroll: waiting for buffer', Math.round(buffered / (this._bytesPerFrame * this._sampleRate / 1000)) + 'ms /', this.PREROLL_MS + 'ms');
    this._prerollTimer = setInterval(() => {
      if (!this._initialized) { this._cancelPreroll(); return; }
      let level = 0;
      try { level = _f.ca_get_buffered_bytes(); } catch {  }
      if (level >= targetBytes || Date.now() - startT > this.PREROLL_TIMEOUT_MS) {
        const waitedMs = Date.now() - startT;
        this._cancelPreroll();
        if (level < targetBytes) {
          console.warn('[wasapi] preroll timeout after', waitedMs + 'ms, starting anyway (level:',
            Math.round(level / (this._bytesPerFrame * this._sampleRate / 1000)) + 'ms)');
        } else {
          console.log('[wasapi] preroll complete in', waitedMs + 'ms');
        }
        tryStart();
      }
    }, 30);
  }

  _cancelPreroll() {
    if (this._prerollTimer) {
      clearInterval(this._prerollTimer);
      this._prerollTimer = null;
    }
  }

  _startFromPosition(positionMs) {
    this._resumePositionMs = null;
    if (!this._currentFilePath || this._webAudioBrowserDecode || !this._decoder) return;
    if (this._decoder.isSlotActive('main')) return;
    const seekSec = Math.max(0, (positionMs || 0) / 1000);
    this._seekOffsetMs = Math.round(seekSec * 1000);
    this._ffmpegDataStarted = false;
    const _this = this;
    this._decoder.start('main', this._currentFilePath, seekSec,
      (fa) => {
        if (!_this._ffmpegDataStarted) _this._ffmpegDataStarted = true;
        if (_this.sendPcmToRenderer) _this.sendPcmToRenderer('main', fa);
      },
      () => { if (_this.sendFfmpegState) _this.sendFfmpegState('main', true); },
      () => { if (_this.sendFfmpegState) _this.sendFfmpegState('main', true); }
    );
  }

  async play() {
    if (!this._initialized) throw new Error('Not initialized');

    this._startFromPosition(this._resumePositionMs);

    this._playing = true;
    this._paused = false;
    this.emit('state_changed', 'playing');
    this._startWithPreroll();
  }

  async pause() {
    if (!this._playing) return;
    this._cancelPreroll();
    if (!this._dummyMode) _f.ca_stop();

    this._resumePositionMs = this._currentPositionMs();

    if (this._decoder) {
      this._decoder.stopSlot('main');
      this._decoder.stopSlot('next');
    }
    this._playing = false;
    this._paused = true;
    this.emit('state_changed', 'paused');
  }

  suspendDecoders() {
    if (this._playing) return;
    if (this._decoder && (this._decoder.isSlotActive('main') || this._decoder.isSlotActive('next'))) {
      this._resumePositionMs = this._currentPositionMs();
      this._decoder.stopSlot('main');
      this._decoder.stopSlot('next');
    }
  }

  resumeDecoders() {

  }

  async stop() {
    this._cancelPreroll();
    if (!this._dummyMode) _f.ca_stop();
    this._playing = false;
    this._paused = false;
    this._resumePositionMs = null;
    this._stopDrainTimer();
    if (this._decoder) {
      this._decoder.stopSlot('main');
      this._decoder.stopSlot('next');
    }
    this._nextFilePath = null;
    this._seekOffsetMs = 0;
    if (!this._dummyMode) _f.ca_clear_buffer();
    this.emit('state_changed', 'stopped');
  }

  async seek(positionMs) {
    if (!this._initialized) return;
    const seekSec = Math.max(0, positionMs / 1000);
    const wasPlaying = this._playing;

    this._cancelPreroll();
    if (!this._dummyMode) _f.ca_stop();
    if (this._decoder) this._decoder.stopSlot('main');
    if (!this._dummyMode) _f.ca_clear_buffer();
    this._seekOffsetMs = Math.round(seekSec * 1000);

    if (this._currentFilePath && !this._webAudioBrowserDecode && this._decoder) {
      const _this = this;
      this._ffmpegDataStarted = false;
      this._decoder.start('main', this._currentFilePath, seekSec,
        (fa) => {
          if (!_this._ffmpegDataStarted) _this._ffmpegDataStarted = true;
          if (_this.sendPcmToRenderer) _this.sendPcmToRenderer('main', fa);
        },
        () => { if (_this.sendFfmpegState) _this.sendFfmpegState('main', true); },
        () => { if (_this.sendFfmpegState) _this.sendFfmpegState('main', true); }
      );
    }

    if (wasPlaying) {
      this._startWithPreroll();
    } else {
      this._paused = true;
    }
  }

  async setVolume(level) {

    this._volume = Math.max(0, Math.min(1, level));
  }

  setWebAudioEnabled(enabled) {
    this._webAudioEnabled = !!enabled;
    console.log('[wasapi] Web Audio mode:', enabled ? 'enabled' : 'disabled');
  }

  async setupForBrowserDecode(filePath) {
    if (!this._initialized) throw new Error('Renderer not initialized');
    if (!filePath) throw new Error('No file path');

    this._currentFilePath = filePath;
    if (this._decoder) {
      this._decoder.stopSlot('main');
      this._decoder.stopSlot('next');
    }
    this._stopDrainTimer();
    this._nextFilePath = null;
    this._nextDurationMs = 0;
    this._seekOffsetMs = 0;
    if (!this._dummyMode) _f.ca_clear_buffer();

    this._durationMs = await this._probeDuration(filePath);

    this._webAudioBrowserDecode = true;
    console.log('[wasapi] setupForBrowserDecode:', filePath, 'duration=', this._durationMs);
    return { durationMs: this._durationMs };
  }

  async preloadNext(filePath, seekMsOrOpts = 0) {
    if (!this._initialized) throw new Error('Renderer not initialized');
    if (!filePath) throw new Error('No file path');

    let skipFFmpeg = false;
    if (typeof seekMsOrOpts === 'object') {
      skipFFmpeg = !!seekMsOrOpts.skipFFmpeg;
    }

    if (this._decoder) this._decoder.stopSlot('next');
    this._nextFilePath = filePath;
    this._nextReady = false;

    this._nextDurationMs = await this._probeDuration(filePath);

    if (skipFFmpeg) {
      console.log('[wasapi] preloadNext (skipFFmpeg):', filePath);
      return { durationMs: this._nextDurationMs };
    }

    if (!this._decoder) throw new Error('ffmpeg not found');

    const _this = this;
    this._decoder.start('next', filePath, 0,
       (fa) => {
        if (_this.sendPcmToRenderer) _this.sendPcmToRenderer('next', fa);
      },
       () => {
        _this._nextReady = true;
        if (_this.sendFfmpegState) _this.sendFfmpegState('next', true);
      },
       () => {
        _this._nextReady = true;
        if (_this.sendFfmpegState) _this.sendFfmpegState('next', true);
      }
    );

    const maxWaitMs = 2000;
    const startT = Date.now();

    await new Promise((resolve) => {
      const check = () => {
        if (this._nextReady || !this._decoder.isSlotActive('next')) { resolve(); return; }
        if (Date.now() - startT > maxWaitMs) { resolve(); return; }
        setTimeout(check, 20);
      };
      check();
    });

    console.log('[wasapi] preloadNext complete:', filePath);
    return { durationMs: this._nextDurationMs };
  }

  promoteNextToCurrent() {
    if (!this._nextFilePath && !this._nextReady) {
      console.warn('[wasapi] promoteNextToCurrent: no next track to promote');
      return;
    }

    this._currentFilePath = this._nextFilePath;
    this._durationMs = this._nextDurationMs;
    this._seekOffsetMs = 0;
    this._nextFilePath = null;
    this._nextDurationMs = 0;
    this._nextReady = false;

    if (this._decoder) {
      const _this = this;
      const promoted = this._decoder.promoteNextToMain(
         (fa) => {
          if (_this.sendPcmToRenderer) _this.sendPcmToRenderer('main', fa);
        },
         () => {
          if (_this.sendFfmpegState) _this.sendFfmpegState('main', true);
        },
         () => {
          if (_this.sendFfmpegState) _this.sendFfmpegState('main', true);
        }
      );
      this._webAudioBrowserDecode = !promoted;
    } else {
      this._webAudioBrowserDecode = true;
    }

    console.log('[wasapi] Promoted next to current:', this._currentFilePath,
      'duration:', this._durationMs + 'ms');
  }

  _spawnNextFfmpeg(filePath, seekSec = 0) {

  }

  _killNextFfmpeg() {

  }

  _killFFmpeg() {

  }

  cancelPreloadNext() {
    if (this._decoder) this._decoder.stopSlot('next');
    this._nextFilePath = null;
    this._nextDurationMs = 0;
    this._nextReady = false;
  }

  getBufferLatencyMs() {
    if (!this._initialized) return 0;
    if (this._dummyMode) return 0;
    try {
      const bytes = _f.ca_get_buffered_bytes();
      if (bytes <= 0) return 0;
      return Math.round(bytes * 1000 / (this._sampleRate * this._bytesPerFrame));
    } catch {
      return 0;
    }
  }

  _currentPositionMs() {
    if (!this._initialized) return this._seekOffsetMs;
    if (this._dummyMode) return this._seekOffsetMs;
    try {
      const frames = _f.ca_get_consumed_frames();
      return this._seekOffsetMs + Math.round(frames * 1000 / this._sampleRate);
    } catch {
      return this._seekOffsetMs;
    }
  }

  getRemainingMs() {
    const pos = this._currentPositionMs();
    return Math.max(0, this._durationMs - pos);
  }

  hasNextPreloaded() {
    return !!this._nextFilePath;
  }

  async getPosition() {

    return this._seekOffsetMs;
  }

  getDuration() {
    return this._durationMs;
  }

  get isPlaying() {
    return this._playing;
  }

  get isExclusive() {
    return this._shareMode === SHARE_EXCLUSIVE;
  }

  get shareMode() {
    return this._shareMode;
  }

  get isInitialized() {
    return this._initialized;
  }

  get isDummyMode() {
    return this._dummyMode;
  }

  set setGaplessEnabled(_) {  }
  get gaplessEnabled() { return false; }
  set setCrossfadeEnabled(_) {  }
  get crossfadeEnabled() { return false; }
  setCrossfadeDuration() {  }
  get crossfadeDurationMs() { return 4000; }

  setTempo() {  }
  setPitch() {  }
  setRate() {  }
  get tempo() { return 1.0; }
  get pitch() { return 1.0; }
  get rate() { return 1.0; }

  async close() {
    this._cancelPreroll();
    this._stopDrainTimer();
    if (this._decoder) {
      this._decoder.stopSlot('main');
      this._decoder.stopSlot('next');
    }
    this._nextFilePath = null;

    if (this._initialized) {
      if (!this._dummyMode) {
        try { _f.ca_close(); } catch {  }
      }
      this._initialized = false;
    }
    this._playing = false;
    this._paused = false;
    this._seekOffsetMs = 0;

    this._dummyMode = false;
  }
}

module.exports = {
  NativeRenderer,
  WasapiRenderer: NativeRenderer,
  SHARE_SHARED,
  SHARE_EXCLUSIVE,
  findFFmpeg: _findFFmpeg,
  findFFprobe: _findFFprobe,
};
