/**
 * Carminium — ネイティブオーディオレンダラー (Zig + miniaudio + SoundTouch)
 *
 * native/carminium_audio.zig が生成した carminium_audio.dll を koffi 経由で呼び出す。
 * DLL 側は miniaudio (WASAPI 共有/排他モード) で直接出力し、SoundTouch で
 * tempo/pitch/rate をリアルタイム処理し、ロックフリー SPSC リングバッファで
 * PCM を受け取る。デコード（ffmpeg）は JS 側が担当。
 *
 * アーキテクチャ:
 *   JS (ffmpeg decode, f32le PCM) → ca_push_pcm() → DLL 入力リングバッファ
 *     → dataCallback: SoundTouch (tempo/pitch) → WASAPI 出力
 *
 * 依存:
 *   - koffi (npm) — FFI ライブラリ
 *   - carminium_audio.dll — Zig + miniaudio + SoundTouch でビルドした DLL
 *   - ffmpeg (electron/bin/ffmpeg.exe またはシステム PATH)
 */
'use strict';

const koffi = require('koffi');
const { spawn, execSync } = require('child_process');
const { EventEmitter } = require('events');
const fs = require('fs');
const path = require('path');

// ── 共有モード定数 ──────────────────────────────────────────────────────────

const SHARE_SHARED = 0;
const SHARE_EXCLUSIVE = 1;

// ── DLL ロード ─────────────────────────────────────────────────────────────────

let _lib = null;
let _f = {};

function _loadDll() {
  if (_lib) return true;

  const candidates = [
    path.join(__dirname, 'bin', 'carminium_audio.dll'),
    path.join(__dirname, '..', 'native', 'zig-out', 'bin', 'carminium_audio.dll'),
  ];
  let dllPath = null;
  for (const c of candidates) {
    if (fs.existsSync(c)) { dllPath = c; break; }
  }
  if (!dllPath) {
    console.error('[wasapi] carminium_audio.dll not found. Searched:', candidates);
    return false;
  }

  try {
    _lib = koffi.load(dllPath);
  } catch (e) {
    console.error('[wasapi] Failed to load carminium_audio.dll:', e.message);
    return false;
  }

  // すべての関数を一括で宣言。1つでも失敗したら _lib をリセットして完全失敗扱いにする。
  // これにより、部分ロード状態（一部関数が undefined）を防ぐ。
  const decls = [
    ['ca_init',                      'int32  ca_init(int32 share_mode, int32 device_index, uint32 sample_rate, uint16 channels)'],
    ['ca_start',                     'int32  ca_start()'],
    ['ca_stop',                      'int32  ca_stop()'],
    ['ca_push_pcm',                  'int32  ca_push_pcm(uint8 *data, uint32 len)'],
    ['ca_set_volume',                'void   ca_set_volume(float vol)'],
    ['ca_set_tempo',                 'void   ca_set_tempo(float tempo)'],
    ['ca_set_pitch',                 'void   ca_set_pitch(float pitch)'],
    ['ca_set_rate',                  'void   ca_set_rate(float rate)'],
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
    // AutoMix / クロスフェード
    ['ca_push_next_pcm',             'int32  ca_push_next_pcm(uint8 *data, uint32 len)'],
    ['ca_clear_next_buffer',         'void   ca_clear_next_buffer()'],
    ['ca_get_next_buffered_bytes',   'uint32 ca_get_next_buffered_bytes()'],
    ['ca_start_crossfade',           'int32  ca_start_crossfade(uint32 duration_ms)'],
    ['ca_is_crossfading',            'int32  ca_is_crossfading()'],
    ['ca_check_crossfade_completed', 'int32  ca_check_crossfade_completed()'],
    // Gapless
    ['ca_set_gapless_enabled',       'void   ca_set_gapless_enabled(int32 enabled)'],
    ['ca_get_gapless_enabled',       'int32  ca_get_gapless_enabled()'],
    ['ca_gapless_switch',            'int32  ca_gapless_switch()'],
  ];

  try {
    for (const [name, sig] of decls) {
      _f[name] = _lib.func(sig);
    }
  } catch (e) {
    console.error('[wasapi] Failed to declare DLL function:', e.message);
    _lib = null;
    _f = {};
    return false;
  }

  return true;
}

// ── ffmpeg / ffprobe 探索 ─────────────────────────────────────────────────────

let _ffmpegPath = null, _ffprobePath = null;

function _findFFmpeg() {
  if (_ffmpegPath !== null) return _ffmpegPath;
  const bundled = path.join(__dirname, 'bin', 'ffmpeg.exe');
  if (fs.existsSync(bundled)) { _ffmpegPath = bundled; return _ffmpegPath; }
  const devBin = path.join(__dirname, '..', 'bin', 'ffmpeg.exe');
  if (fs.existsSync(devBin)) { _ffmpegPath = devBin; return _ffmpegPath; }
  try {
    execSync('ffmpeg -version', { stdio: 'ignore', timeout: 5000 });
    _ffmpegPath = 'ffmpeg';
    return _ffmpegPath;
  } catch { /* not in PATH */ }
  const locations = [
    'C:\\ffmpeg\\bin\\ffmpeg.exe',
    'C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe',
    'C:\\Program Files (x86)\\ffmpeg\\bin\\ffmpeg.exe',
    path.join(process.env.LOCALAPPDATA || '', 'ffmpeg', 'bin', 'ffmpeg.exe'),
  ];
  for (const loc of locations) {
    if (fs.existsSync(loc)) { _ffmpegPath = loc; return _ffmpegPath; }
  }
  _ffmpegPath = false;
  return _ffmpegPath;
}

function _findFFprobe() {
  if (_ffprobePath !== null) return _ffprobePath;
  const bundled = path.join(__dirname, 'bin', 'ffprobe.exe');
  if (fs.existsSync(bundled)) { _ffprobePath = bundled; return _ffprobePath; }
  const devBin = path.join(__dirname, '..', 'bin', 'ffprobe.exe');
  if (fs.existsSync(devBin)) { _ffprobePath = devBin; return _ffprobePath; }
  try {
    execSync('ffprobe -version', { stdio: 'ignore', timeout: 5000 });
    _ffprobePath = 'ffprobe';
    return _ffprobePath;
  } catch { /* not in PATH */ }
  const ff = _findFFmpeg();
  if (ff && ff !== 'ffmpeg') {
    const probePath = path.join(path.dirname(ff), 'ffprobe.exe');
    if (fs.existsSync(probePath)) { _ffprobePath = probePath; return _ffprobePath; }
  }
  _ffprobePath = false;
  return _ffprobePath;
}

// ── NativeRenderer クラス ─────────────────────────────────────────────────────

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

    // PCM 受け渡し
    this._ffmpegProc = null;
    this._ffmpegFinished = false;
    this._pendingChunks = [];
    this._pendingBytes = 0;
    this._drainTimer = null;
    this._endCheckTimer = null;

    // 位置追跡
    this._seekOffsetMs = 0;
    this._posTimer = null;

    // SoundTouch パラメータ
    this._tempo = 1.0;
    this._pitch = 1.0;
    this._rate = 1.0;

    // AutoMix / クロスフェード
    this._nextFfmpegProc = null;
    this._nextFfmpegFinished = false;
    this._nextPendingChunks = [];
    this._nextPendingBytes = 0;
    this._nextDrainTimer = null;
    this._nextDurationMs = 0;
    this._nextFilePath = null;
    this._crossfadeDurationMs = 4000; // デフォルト 4 秒
    this._crossfadeEnabled = false;
    this._cfCheckTimer = null;

    // Gapless
    this._gaplessEnabled = false;

    // コールバック（player.js が設定）
    this.onPositionTick = null;
    this.onEnded = null;
    this.onCrossfadeComplete = null; // クロスフェード完了時コールバック
  }

  // ── デバイス列挙 ──────────────────────────────────────────────────────────

  static enumerateDevices() {
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

  // ── 初期化 ────────────────────────────────────────────────────────────────

  /**
   * デバイスを初期化する。
   * @param {object} opts
   * @param {number} opts.shareMode - 0=共有, 1=排他 (デフォルト: 共有)
   * @param {number} opts.deviceIndex - デバイスインデックス (-1=デフォルト)
   * @param {number} opts.sampleRate - サンプルレート (0=デバイスネイティブ)
   * @param {number} opts.channels - チャンネル数 (0=2)
   */
  async init(opts = {}) {
    if (!_loadDll()) throw new Error('carminium_audio.dll not loaded');
    if (this._initialized) await this.close();

    const shareMode = opts.shareMode === SHARE_EXCLUSIVE ? SHARE_EXCLUSIVE : SHARE_SHARED;
    const deviceIndex = opts.deviceIndex != null ? opts.deviceIndex : -1;
    const sampleRate = opts.sampleRate || 0;
    const channels = opts.channels || 2;

    const result = _f.ca_init(shareMode, deviceIndex, sampleRate, channels);
    if (result !== 0) {
      let msg;
      switch (result) {
        case -1: msg = 'already initialized'; break;
        case -3: msg = 'miniaudio context init failed'; break;
        case -4: msg = 'SoundTouch init failed'; break;
        default:
          if (shareMode === SHARE_EXCLUSIVE) {
            msg = `miniaudio error ${result} (exclusive mode unavailable — ` +
                  `device may be in use or exclusive mode disabled in Windows settings)`;
          } else {
            msg = `miniaudio error ${result}`;
          }
      }
      throw new Error(`ca_init failed: ${msg}`);
    }

    this._shareMode      = _f.ca_get_share_mode();
    this._sampleRate     = _f.ca_get_sample_rate();
    this._channels       = _f.ca_get_channels();
    this._bytesPerFrame  = (this._channels * 32) / 8;  // 常に f32
    this._initialized    = true;
    this._seekOffsetMs   = 0;

    // 音量・SoundTouch パラメータを DLL 側に反映
    _f.ca_set_volume(this._volume);
    _f.ca_set_tempo(this._tempo);
    _f.ca_set_pitch(this._pitch);
    _f.ca_set_rate(this._rate);
    _f.ca_set_gapless_enabled(this._gaplessEnabled ? 1 : 0);

    const modeStr = this._shareMode === SHARE_EXCLUSIVE ? 'exclusive' : 'shared';
    console.log(`[wasapi] Initialized ${modeStr} mode: ` +
                `${this._sampleRate}Hz, ${this._channels}ch, f32`);

    return {
      sampleRate: this._sampleRate,
      channels: this._channels,
      bitsPerSample: 32,
      shareMode: this._shareMode,
    };
  }

  // ── ファイル再生 ──────────────────────────────────────────────────────────

  async playFile(filePath) {
    if (!this._initialized) throw new Error('Renderer not initialized');
    if (!filePath) throw new Error('No file path');

    const ff = _findFFmpeg();
    if (!ff) throw new Error('ffmpeg not found (required for audio decoding)');

    this._currentFilePath = filePath;
    this._killFFmpeg();
    this._killNextFfmpeg();
    this._stopDrainTimer();
    this._stopNextDrainTimer();
    this._stopEndCheck();
    this._stopCrossfadeCheck();
    this._pendingChunks = [];
    this._pendingBytes = 0;
    this._nextPendingChunks = [];
    this._nextPendingBytes = 0;
    this._nextFilePath = null;
    this._nextDurationMs = 0;
    this._seekOffsetMs = 0;
    _f.ca_clear_buffer();
    _f.ca_clear_next_buffer();

    this._durationMs = await this._probeDuration(filePath);

    this._spawnFFmpeg(filePath, 0);

    // プリバッファ：ring buffer に一定量の PCM が溜まるまで待ってから再生開始
    // これにより起動直後のアンダーラン（途切れ）を防ぐ。
    // 目標：目標 500ms 分または最大 2 秒待ち。
    const targetMs = 500;
    const bytesPerMs = (this._sampleRate * this._channels * 4) / 1000;
    const targetBytes = Math.min(targetMs * bytesPerMs, 2 * 1024 * 1024); // 最大 2MB
    const maxWaitMs = 2000;
    const startT = Date.now();

    await new Promise((resolve) => {
      const check = () => {
        const buffered = _f.ca_get_buffered_bytes();
        if (buffered >= targetBytes) {
          resolve();
          return;
        }
        if (Date.now() - startT > maxWaitMs) {
          // タイムアウト：そのまま再生開始
          resolve();
          return;
        }
        if (this._ffmpegFinished && this._pendingBytes === 0) {
          // ffmpeg が既に終了している（短いファイルなど）
          resolve();
          return;
        }
        setTimeout(check, 20);
      };
      check();
    });

    return { durationMs: this._durationMs };
  }

  _spawnFFmpeg(filePath, seekSec) {
    const ff = _findFFmpeg();
    if (!ff) return;

    // PCM は常に f32le (SoundTouch 要件)
    const args = [];
    if (seekSec > 0) {
      args.push('-ss', String(seekSec));
    }
    args.push(
      '-i', filePath,
      '-f', 'f32le',
      '-ar', String(this._sampleRate),
      '-ac', String(this._channels),
      '-loglevel', 'quiet',
      'pipe:1'
    );

    this._ffmpegFinished = false;
    this._ffmpegProc = spawn(ff, args, { windowsHide: true });

    this._ffmpegProc.stdout.on('data', (chunk) => this._onPcmData(chunk));
    this._ffmpegProc.stderr.on('data', () => { /* ignore */ });

    this._ffmpegProc.on('close', () => {
      this._ffmpegFinished = true;
      this._ffmpegProc = null;
      this._checkEnded();
    });
    this._ffmpegProc.on('error', (e) => {
      console.error('[wasapi] ffmpeg error:', e.message);
      this._ffmpegFinished = true;
      this._ffmpegProc = null;
    });
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

  // ── PCM データ受け渡し ──────────────────────────────────────────────────────

  _onPcmData(chunk) {
    if (this._pendingBytes === 0) {
      const r = _f.ca_push_pcm(chunk, chunk.length);
      if (r === 0) return;
    }
    this._pendingChunks.push(chunk);
    this._pendingBytes += chunk.length;
    this._startDrainTimer();
  }

  _startDrainTimer() {
    if (this._drainTimer) return;
    // 20ms 間隔でドレイン。5ms だと Node.js のイベントループが圧迫され UI が卡死する。
    this._drainTimer = setInterval(() => this._drainPending(), 20);
  }

  _stopDrainTimer() {
    if (this._drainTimer) {
      clearInterval(this._drainTimer);
      this._drainTimer = null;
    }
  }

  _drainPending() {
    while (this._pendingChunks.length > 0) {
      const chunk = this._pendingChunks[0];
      const r = _f.ca_push_pcm(chunk, chunk.length);
      if (r === 0) {
        this._pendingChunks.shift();
        this._pendingBytes -= chunk.length;
      } else if (r === -2) {
        return;
      } else {
        this._pendingChunks.shift();
        this._pendingBytes -= chunk.length;
      }
    }
    this._stopDrainTimer();
    this._checkEnded();
  }

  // ── 再生制御 ──────────────────────────────────────────────────────────────

  async play() {
    if (!this._initialized) throw new Error('Not initialized');
    const r = _f.ca_start();
    if (r !== 0) throw new Error(`ca_start failed: ${r}`);
    this._playing = true;
    this._paused = false;
    this._startPositionTimer();
    if (this._pendingBytes > 0) this._startDrainTimer();
    this.emit('state_changed', 'playing');
  }

  async pause() {
    if (!this._playing) return;
    _f.ca_stop();
    this._playing = false;
    this._paused = true;
    this._stopPositionTimer();
    this.emit('state_changed', 'paused');
  }

  async stop() {
    _f.ca_stop();
    this._playing = false;
    this._paused = false;
    this._stopPositionTimer();
    this._stopDrainTimer();
    this._stopEndCheck();
    this._stopCrossfadeCheck();
    this._killFFmpeg();
    this._killNextFfmpeg();
    this._pendingChunks = [];
    this._pendingBytes = 0;
    this._nextPendingChunks = [];
    this._nextPendingBytes = 0;
    this._nextFilePath = null;
    this._seekOffsetMs = 0;
    _f.ca_clear_buffer();
    _f.ca_clear_next_buffer();
    this.emit('state_changed', 'stopped');
  }

  async seek(positionMs) {
    if (!this._initialized) return;
    const seekSec = Math.max(0, positionMs / 1000);
    const wasPlaying = this._playing;

    _f.ca_stop();
    this._stopDrainTimer();
    this._stopEndCheck();
    this._killFFmpeg();
    this._pendingChunks = [];
    this._pendingBytes = 0;

    _f.ca_clear_buffer();
    this._seekOffsetMs = Math.round(seekSec * 1000);

    if (this._currentFilePath) {
      this._spawnFFmpeg(this._currentFilePath, seekSec);
    }

    if (wasPlaying) {
      const r = _f.ca_start();
      if (r === 0) {
        this._playing = true;
        this._startPositionTimer();
        if (this._pendingBytes > 0) this._startDrainTimer();
      }
    } else {
      this._paused = true;
    }

    this.emit('position_changed', this._seekOffsetMs);
  }

  async setVolume(level) {
    this._volume = Math.max(0, Math.min(1, level));
    if (this._initialized) {
      _f.ca_set_volume(this._volume);
    }
  }

  // ── SoundTouch パラメータ ──────────────────────────────────────────────────

  /**
   * tempo 設定 (1.0 = 原速)。リアルタイム反映。
   * tempo はピッチを変えずに再生速度を変更する。
   */
  setTempo(tempo) {
    this._tempo = Math.max(0.25, Math.min(4.0, tempo));
    if (this._initialized) {
      _f.ca_set_tempo(this._tempo);
    }
  }

  /**
   * pitch 設定 (1.0 = 原調)。
   * pitch は速度を変えずに音高を変更する。
   */
  setPitch(pitch) {
    this._pitch = Math.max(0.25, Math.min(4.0, pitch));
    if (this._initialized) {
      _f.ca_set_pitch(this._pitch);
    }
  }

  /**
   * rate 設定 (1.0 = 原速原調)。
   * rate はテープ風エフェクト（速度とピッチが連動）。
   */
  setRate(rate) {
    this._rate = Math.max(0.25, Math.min(4.0, rate));
    if (this._initialized) {
      _f.ca_set_rate(this._rate);
    }
  }

  get tempo() { return this._tempo; }
  get pitch() { return this._pitch; }
  get rate() { return this._rate; }

  // ── AutoMix / クロスフェード ──────────────────────────────────────────────

  setCrossfadeEnabled(enabled) {
    this._crossfadeEnabled = !!enabled;
    // AutoMix と Gapless は相互排他
    if (this._crossfadeEnabled && this._gaplessEnabled) {
      this._gaplessEnabled = false;
      if (this._initialized) {
        _f.ca_set_gapless_enabled(0);
      }
    }
  }

  get crossfadeEnabled() {
    return this._crossfadeEnabled;
  }

  setCrossfadeDuration(ms) {
    this._crossfadeDurationMs = Math.max(500, Math.min(15000, ms | 0));
  }

  get crossfadeDurationMs() {
    return this._crossfadeDurationMs;
  }

  /**
   * 次曲をプリロードする（AutoMix 用）。
   * ffmpeg でデコードを開始し、DLL のプリロードバッファに PCM を供給する。
   */
  async preloadNext(filePath) {
    if (!this._initialized) throw new Error('Renderer not initialized');
    if (!filePath) throw new Error('No file path');

    const ff = _findFFmpeg();
    if (!ff) throw new Error('ffmpeg not found');

    this._killNextFfmpeg();
    this._stopNextDrainTimer();
    this._nextPendingChunks = [];
    this._nextPendingBytes = 0;
    this._nextFilePath = filePath;
    _f.ca_clear_next_buffer();

    this._nextDurationMs = await this._probeDuration(filePath);

    this._spawnNextFfmpeg(filePath);

    // プリバッファ：次曲バッファに一定量溜まるまで待つ（オプション）
    const targetBytes = Math.min(
      (this._sampleRate * this._channels * 4) / 1000 * 500, // 500ms 分
      2 * 1024 * 1024
    );
    const maxWaitMs = 2000;
    const startT = Date.now();

    await new Promise((resolve) => {
      const check = () => {
        const buffered = _f.ca_get_next_buffered_bytes();
        if (buffered >= targetBytes) { resolve(); return; }
        if (Date.now() - startT > maxWaitMs) { resolve(); return; }
        if (this._nextFfmpegFinished && this._nextPendingBytes === 0) {
          resolve(); return;
        }
        setTimeout(check, 20);
      };
      check();
    });

    // Gapless モード時は、切り替え完了検知を開始する
    // （DLL 側で自動的にバッファ切り替えが行われるため、ポーリングで検知）
    if (this._gaplessEnabled) {
      this._startCrossfadeCheck();
    }

    return { durationMs: this._nextDurationMs };
  }

  _spawnNextFfmpeg(filePath) {
    const ff = _findFFmpeg();
    if (!ff) return;

    const args = [
      '-i', filePath,
      '-f', 'f32le',
      '-ar', String(this._sampleRate),
      '-ac', String(this._channels),
      '-loglevel', 'quiet',
      'pipe:1'
    ];

    this._nextFfmpegFinished = false;
    this._nextFfmpegProc = spawn(ff, args, { windowsHide: true });

    this._nextFfmpegProc.stdout.on('data', (chunk) => this._onNextPcmData(chunk));
    this._nextFfmpegProc.stderr.on('data', () => { /* ignore */ });

    this._nextFfmpegProc.on('close', () => {
      this._nextFfmpegFinished = true;
      this._nextFfmpegProc = null;
    });
    this._nextFfmpegProc.on('error', (e) => {
      console.error('[wasapi] next ffmpeg error:', e.message);
      this._nextFfmpegFinished = true;
      this._nextFfmpegProc = null;
    });
  }

  _killNextFfmpeg() {
    if (this._nextFfmpegProc) {
      try { this._nextFfmpegProc.kill('SIGKILL'); } catch { /* ignore */ }
      this._nextFfmpegProc = null;
    }
    this._nextFfmpegFinished = false;
  }

  _onNextPcmData(chunk) {
    if (this._nextPendingBytes === 0) {
      const r = _f.ca_push_next_pcm(chunk, chunk.length);
      if (r === 0) return;
    }
    this._nextPendingChunks.push(chunk);
    this._nextPendingBytes += chunk.length;
    this._startNextDrainTimer();
  }

  _startNextDrainTimer() {
    if (this._nextDrainTimer) return;
    this._nextDrainTimer = setInterval(() => this._drainNextPending(), 20);
  }

  _stopNextDrainTimer() {
    if (this._nextDrainTimer) {
      clearInterval(this._nextDrainTimer);
      this._nextDrainTimer = null;
    }
  }

  _drainNextPending() {
    while (this._nextPendingChunks.length > 0) {
      const chunk = this._nextPendingChunks[0];
      const r = _f.ca_push_next_pcm(chunk, chunk.length);
      if (r === 0) {
        this._nextPendingChunks.shift();
        this._nextPendingBytes -= chunk.length;
      } else if (r === -2) {
        return;
      } else {
        this._nextPendingChunks.shift();
        this._nextPendingBytes -= chunk.length;
      }
    }
    this._stopNextDrainTimer();
  }

  /**
   * クロスフェードを開始する。
   * 呼び出し後、DLL 内部でクロスフェードが実行され、完了すると
   * onCrossfadeComplete コールバックが呼ばれる。
   */
  startCrossfade(durationMs) {
    if (!this._initialized) return -1;
    const dur = durationMs != null ? durationMs : this._crossfadeDurationMs;
    const r = _f.ca_start_crossfade(dur);
    if (r !== 0) {
      console.warn('[wasapi] ca_start_crossfade failed:', r);
      return r;
    }
    this._startCrossfadeCheck();
    return 0;
  }

  _startCrossfadeCheck() {
    this._stopCrossfadeCheck();
    this._cfCheckTimer = setInterval(() => {
      const completed = _f.ca_check_crossfade_completed();
      if (completed) {
        this._stopCrossfadeCheck();
        // クロスフェード完了: メインバッファが入れ替わっているので
        // 次曲用の ffmpeg とバッファを後始末、新しいトラックの状態に更新
        this._onCrossfadeComplete();
      }
    }, 20);
  }

  _stopCrossfadeCheck() {
    if (this._cfCheckTimer) {
      clearInterval(this._cfCheckTimer);
      this._cfCheckTimer = null;
    }
  }

  _onCrossfadeComplete() {
    // 旧メイン（前曲）の ffmpeg 等を後始末
    this._killFFmpeg();
    this._stopDrainTimer();
    this._pendingChunks = [];
    this._pendingBytes = 0;

    // 次曲だったものがメインに昇格
    this._currentFilePath = this._nextFilePath;
    this._durationMs = this._nextDurationMs;
    this._seekOffsetMs = 0;
    this._ffmpegProc = this._nextFfmpegProc;
    this._ffmpegFinished = this._nextFfmpegFinished;
    this._pendingChunks = this._nextPendingChunks;
    this._pendingBytes = this._nextPendingBytes;
    this._drainTimer = this._nextDrainTimer;

    // 次曲関連をリセット
    this._nextFfmpegProc = null;
    this._nextFfmpegFinished = false;
    this._nextPendingChunks = [];
    this._nextPendingBytes = 0;
    this._nextDrainTimer = null;
    this._nextFilePath = null;
    this._nextDurationMs = 0;

    if (this._pendingBytes > 0) this._startDrainTimer();

    // Gapless モードで自動切り替えされた場合も、完了イベントを発行
    this.emit('crossfade_complete');
    if (this.onCrossfadeComplete) this.onCrossfadeComplete();
  }

  /** 現在の残り時間（ミリ秒）を取得 */
  getRemainingMs() {
    const pos = this._currentPositionMs();
    return Math.max(0, this._durationMs - pos);
  }

  /** 次曲がプリロードされているか */
  hasNextPreloaded() {
    return !!this._nextFilePath && _f.ca_get_next_buffered_bytes() > 0;
  }

  // ── Gapless ───────────────────────────────────────────────────────────────

  setGaplessEnabled(enabled) {
    this._gaplessEnabled = !!enabled;
    if (this._initialized) {
      _f.ca_set_gapless_enabled(this._gaplessEnabled ? 1 : 0);
    }
    // Gapless と AutoMix は相互排他
    if (this._gaplessEnabled && this._crossfadeEnabled) {
      this._crossfadeEnabled = false;
      if (this._initialized) {
        // クロスフェード中なら中止することはできないが、次回からは無効になる
      }
    }
  }

  get gaplessEnabled() {
    return this._gaplessEnabled;
  }

  /**
   * 手動で Gapless 切り替えを実行する
   * 戻り値: 0 = 成功、-1 = 未初期化、-2 = 次バッファが空
   */
  gaplessSwitch() {
    if (!this._initialized) return -1;
    const r = _f.ca_gapless_switch();
    if (r === 0) {
      this._startCrossfadeCheck(); // 完了チェックを開始（フラグは共有）
    }
    return r;
  }

  // ── 終了検出 ──────────────────────────────────────────────────────────────

  _checkEnded() {
    if (!this._playing) return;

    // AutoMix: バッファ残量がクロスフェード時間分を下回ったらフェード開始
    // ffmpeg が動いていてもチェックする（曲の終盤でバッファ残量が減ってくるため）
    if (this._crossfadeEnabled && this._nextFilePath &&
        _f.ca_is_crossfading() === 0) {
      const buffered = _f.ca_get_buffered_bytes();
      const bytesPerMs = (this._sampleRate * this._channels * 4) / 1000;
      const crossfadeBytes = this._crossfadeDurationMs * bytesPerMs;
      if (buffered <= crossfadeBytes) {
        console.log('[wasapi] AutoMix: starting crossfade, buffered:', buffered,
          'bytes, threshold:', crossfadeBytes, 'bytes');
        this.startCrossfade(this._crossfadeDurationMs);
        return;
      }
    }

    // 以下は通常の終了判定（ffmpeg 終了かつバッファ空）
    if (!this._ffmpegFinished || this._pendingBytes > 0) return;

    if (_f.ca_get_buffered_bytes() === 0) {
      this._fireEnded();
      return;
    }
    if (this._endCheckTimer) return;
    this._endCheckTimer = setInterval(() => {
      if (!this._playing) {
        this._stopEndCheck();
        return;
      }
      if (_f.ca_get_buffered_bytes() === 0) {
        this._stopEndCheck();
        this._fireEnded();
      }
    }, 20);
  }

  _stopEndCheck() {
    if (this._endCheckTimer) {
      clearInterval(this._endCheckTimer);
      this._endCheckTimer = null;
    }
  }

  _fireEnded() {
    this._playing = false;
    this._stopPositionTimer();
    _f.ca_stop();
    this.emit('state_changed', 'stopped');
    if (this.onEnded) this.onEnded();
  }

  // ── 位置情報 ──────────────────────────────────────────────────────────────

  _startPositionTimer() {
    this._stopPositionTimer();
    this._posTimer = setInterval(() => {
      if (!this._playing) return;
      const posMs = this._currentPositionMs();
      if (this.onPositionTick) this.onPositionTick(posMs);
      // AutoMix / 終了判定も定期的にチェック
      this._checkEnded();
    }, 100);
  }

  _stopPositionTimer() {
    if (this._posTimer) {
      clearInterval(this._posTimer);
      this._posTimer = null;
    }
  }

  _currentPositionMs() {
    if (!this._sampleRate) return this._seekOffsetMs;
    const frames = Number(_f.ca_get_consumed_frames());
    // tempo 適用時、消費フレーム数は入力側（原速）のフレーム数。
    // 出力位置 = 入力消費フレーム / sample_rate で原速基準の位置が得られる。
    return this._seekOffsetMs + Math.round(frames * 1000 / this._sampleRate);
  }

  async getPosition() {
    return this._currentPositionMs();
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

  // ── ffmpeg 管理 ────────────────────────────────────────────────────────────

  _killFFmpeg() {
    if (this._ffmpegProc) {
      try { this._ffmpegProc.kill('SIGKILL'); } catch { /* ignore */ }
      this._ffmpegProc = null;
    }
    this._ffmpegFinished = false;
  }

  // ── クリーンアップ ──────────────────────────────────────────────────────────

  async close() {
    this._stopPositionTimer();
    this._stopDrainTimer();
    this._stopEndCheck();
    this._stopCrossfadeCheck();
    this._killFFmpeg();
    this._killNextFfmpeg();
    this._pendingChunks = [];
    this._pendingBytes = 0;
    this._nextPendingChunks = [];
    this._nextPendingBytes = 0;
    this._nextFilePath = null;

    if (this._initialized) {
      try { _f.ca_close(); } catch { /* ignore */ }
      this._initialized = false;
    }
    this._playing = false;
    this._paused = false;
    this._seekOffsetMs = 0;
  }
}

module.exports = { NativeRenderer, WasapiRenderer: NativeRenderer, SHARE_SHARED, SHARE_EXCLUSIVE };
