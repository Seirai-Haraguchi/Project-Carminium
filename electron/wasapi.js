/**
 * Carminium — ネイティブオーディオレンダラー (Zig + miniaudio)
 *
 * native/carminium_audio.zig が生成した carminium_audio.dll を koffi 経由で呼び出す。
 * DLL 側は miniaudio (WASAPI 共有/排他モード) で直接出力。
 *
 * アーキテクチャ:
 *   FFmpeg (デコード) → IPC → Renderer (Web Audio API 合成)
 *                                         ↓
 *   Renderer (合成済み PCM) → IPC → ca_push_pcm() → DLL → WASAPI
 *
 * このモジュールは FFmpeg のデコードと miniaudio への PCM 出力のみを担当する。
 * Gapless/AutoMix/音量の合成はすべてレンダラー側の Web Audio API で行われる。
 */
'use strict';

const koffi = require('koffi');
const { spawn, execSync, execFile } = require('child_process');
const { EventEmitter } = require('events');
const fs = require('fs');
const path = require('path');

const SHARE_SHARED = 0;
const SHARE_EXCLUSIVE = 1;

// asar パッケージ内のパスを実際のファイルシステム上のパス（app.asar.unpacked）に変換する。
// koffi.load() や child_process.spawn() は Electron のパッチ済み fs を経由しないため、
// asar 内のパスをそのまま渡すと実ファイルが見つからず失敗する。
function _resolveRealPath(p) {
  if (!p) return p;
  // 文字列として ".asar" を含む場合、app.asar.unpacked へ置換
  if (p.includes('.asar')) {
    return p.replace(/\.asar([\\/])/, '.asar.unpacked$1');
  }
  return p;
}

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
    if (fs.existsSync(c)) { dllPath = _resolveRealPath(c); break; }
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
    console.error('[wasapi] Failed to declare DLL function:', e.message);
    _lib = null;
    _f = {};
    return false;
  }

  return true;
}

let _ffmpegPath = null, _ffprobePath = null;

function _findFFmpeg() {
  if (_ffmpegPath !== null) return _ffmpegPath;
  const bundled = path.join(__dirname, 'bin', 'ffmpeg.exe');
  if (fs.existsSync(bundled)) { _ffmpegPath = _resolveRealPath(bundled); return _ffmpegPath; }
  const devBin = path.join(__dirname, '..', 'bin', 'ffmpeg.exe');
  if (fs.existsSync(devBin)) { _ffmpegPath = _resolveRealPath(devBin); return _ffmpegPath; }
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
  if (fs.existsSync(bundled)) { _ffprobePath = _resolveRealPath(bundled); return _ffprobePath; }
  const devBin = path.join(__dirname, '..', 'bin', 'ffprobe.exe');
  if (fs.existsSync(devBin)) { _ffprobePath = _resolveRealPath(devBin); return _ffprobePath; }
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

    this._ffmpegProc = null;
    this._ffmpegFinished = false;
    this._ffmpegDataStarted = false;
    // サンプル境界に揃っていない残りバイト
    this._pendingBuf = Buffer.alloc(0);

    this._seekOffsetMs = 0;

    // 次曲 FFmpeg
    this._nextFfmpegProc = null;
    this._nextFfmpegFinished = false;
    this._nextPendingBuf = Buffer.alloc(0);
    this._nextDurationMs = 0;
    this._nextFilePath = null;
    // crossfade/gapless 完成后，next ffmpeg 被提升为 main ffmpeg
    // 此时其 PCM 数据和 close 事件应路由到 'main' channel
    this._nextPromoted = false;

    // Web Audio API 模式标志：当为 true 时，浏览器可解码的格式不启动 FFmpeg
    this._webAudioEnabled = false;
    // 当前曲目是否使用浏览器解码（无 FFmpeg 进程）
    this._webAudioBrowserDecode = false;

    // レンダラーに PCM を送るためのコールバック
    // Bridge が設定する
    this.sendPcmToRenderer = null;    // (channel: 'main'|'next', float32Array) => void
    this.sendFfmpegState = null;      // (channel: 'main'|'next', finished: bool) => void

    this._drainTimer = null;
  }

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

  async init(opts = {}) {
    if (!_loadDll()) throw new Error('carminium_audio.dll not loaded');
    if (this._initialized) await this.close();

    const shareMode = opts.shareMode === SHARE_EXCLUSIVE ? SHARE_EXCLUSIVE : SHARE_SHARED;
    const deviceIndex = opts.deviceIndex != null ? opts.deviceIndex : -1;
    const sampleRate = opts.sampleRate || 0;
    const channels = opts.channels || 2;

    const result = _f.ca_init(shareMode, deviceIndex, sampleRate, channels);
    if (result !== 0) {
      // 独占模式失败 → 自动回退到共享模式
      if (shareMode === SHARE_EXCLUSIVE) {
        console.warn('[wasapi] Exclusive mode init failed (ca_init=' + result + '), falling back to shared');
        const retry = _f.ca_init(SHARE_SHARED, deviceIndex, sampleRate, channels);
        if (retry !== 0) {
          throw new Error(`ca_init failed: miniaudio error ${retry}`);
        }
      } else {
        throw new Error(`ca_init failed: miniaudio error ${result}`);
      }
    }

    this._shareMode      = _f.ca_get_share_mode();
    this._sampleRate     = _f.ca_get_sample_rate();
    this._channels       = _f.ca_get_channels();
    this._bytesPerFrame  = (this._channels * 32) / 8;
    this._initialized    = true;
    this._seekOffsetMs   = 0;

    // 音量は DLL 側では 1.0 固定（Web Audio API 側で制御）
    _f.ca_set_volume(1.0);

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

  // ── FFmpeg デコード ──────────────────────────────────────────────────────

  async playFile(filePath) {
    if (!this._initialized) throw new Error('Renderer not initialized');
    if (!filePath) throw new Error('No file path');

    const ff = _findFFmpeg();
    if (!ff) throw new Error('ffmpeg not found (required for audio decoding)');

    this._currentFilePath = filePath;
    this._webAudioBrowserDecode = false; // FFmpeg 解码路径
    this._killFFmpeg();
    this._killNextFfmpeg();
    this._stopDrainTimer();
    this._pendingBuf = Buffer.alloc(0);
    this._nextPendingBuf = Buffer.alloc(0);
    this._nextFilePath = null;
    this._nextDurationMs = 0;
    this._seekOffsetMs = 0;
    _f.ca_clear_buffer();

    this._durationMs = await this._probeDuration(filePath);

    this._spawnFFmpeg(filePath, 0);

    // FFmpeg が最初の PCM データを出力したら即座に戻る
    // （PCM は _onPcmData でレンダラーに送られ、_pendingStreamingPcm にバッファされる）
    // 以前は _ffmpegFinished か 2s タイムアウトを待っていたが、
    // これにより余分な PCM がバッファに蓄積し再生遅延の原因になっていた
    const maxWaitMs = 2000;
    const startT = Date.now();

    await new Promise((resolve) => {
      const check = () => {
        if (this._ffmpegDataStarted || this._ffmpegFinished) { resolve(); return; }
        if (Date.now() - startT > maxWaitMs) { resolve(); return; }
        setTimeout(check, 20);
      };
      check();
    });

    return { durationMs: this._durationMs };
  }

  _spawnFFmpeg(filePath, seekSec) {
    const ff = _findFFmpeg();
    if (!ff) return;

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
    this._ffmpegDataStarted = false;
    this._ffmpegProc = spawn(ff, args, { windowsHide: true });

    this._ffmpegProc.stdout.on('data', (chunk) => this._onPcmData(chunk, 'main'));
    this._ffmpegProc.stderr.on('data', () => { /* ignore */ });

    this._ffmpegProc.on('close', () => {
      this._ffmpegFinished = true;
      this._ffmpegProc = null;
      if (this.sendFfmpegState) this.sendFfmpegState('main', true);
    });
    this._ffmpegProc.on('error', (e) => {
      console.error('[wasapi] ffmpeg error:', e.message);
      this._ffmpegFinished = true;
      this._ffmpegProc = null;
      if (this.sendFfmpegState) this.sendFfmpegState('main', true);
    });
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
      // 进程级超时保底
      setTimeout(() => { try { child.kill(); } catch {} }, 10500);
    });
  }

  // ── PCM 受信 → レンダラーに転送 ──────────────────────────────────────────

  _onPcmData(chunk, channel) {
    // next track 被提升为 current 后，其 PCM 数据路由到 'main' channel
    if (channel === 'next' && this._nextPromoted) {
      channel = 'main';
    }

    // 标记 FFmpeg 已开始产出数据（用于 playFile() 提前返回）
    if (channel === 'main' && !this._ffmpegDataStarted) {
      this._ffmpegDataStarted = true;
    }

    let buf = chunk;
    const pendingBuf = channel === 'main' ? this._pendingBuf : this._nextPendingBuf;

    if (pendingBuf.length > 0) {
      buf = Buffer.concat([pendingBuf, chunk]);
    }

    const sampleBytes = 4;
    const alignedLen = Math.floor(buf.length / sampleBytes) * sampleBytes;
    const remainder = buf.length - alignedLen;

    // 残りを保存
    if (channel === 'main') {
      this._pendingBuf = remainder > 0 ? buf.slice(alignedLen) : Buffer.alloc(0);
    } else {
      this._nextPendingBuf = remainder > 0 ? buf.slice(alignedLen) : Buffer.alloc(0);
    }

    if (alignedLen === 0) return;

    // Float32Array ビューを作成してレンダラーに送信
    const floatArray = new Float32Array(buf.buffer, buf.byteOffset, alignedLen / 4);

    if (this.sendPcmToRenderer) {
      this.sendPcmToRenderer(channel, new Float32Array(floatArray));
    }
  }

  // ── レンダラーから合成済み PCM を受信 → DLL にプッシュ ───────────────

  pushProcessedPcm(float32ArrayOrBuffer) {
    if (!this._initialized) return -1;

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

  // ── ドレインタイマー（DLL バッファの補充チェック）───────────────────────

  _startDrainTimer() {
    if (this._drainTimer) return;
    // ドレインタイマーは不要。レンダラー側の ScriptProcessorNode が
    // 自動的にクロック駆動でデータを送ってくる。
    // ただし、DLL バッファが枯渇しそうな場合はログを出す程度。
  }

  _stopDrainTimer() {
    if (this._drainTimer) {
      clearInterval(this._drainTimer);
      this._drainTimer = null;
    }
  }

  // ── 再生制御 ──────────────────────────────────────────────────────────────

  async play() {
    if (!this._initialized) throw new Error('Not initialized');
    const r = _f.ca_start();
    if (r !== 0) throw new Error(`ca_start failed: ${r}`);
    this._playing = true;
    this._paused = false;
    this.emit('state_changed', 'playing');
  }

  async pause() {
    if (!this._playing) return;
    _f.ca_stop();
    this._playing = false;
    this._paused = true;
    this.emit('state_changed', 'paused');
  }

  async stop() {
    _f.ca_stop();
    this._playing = false;
    this._paused = false;
    this._stopDrainTimer();
    this._killFFmpeg();
    this._killNextFfmpeg();
    this._nextFilePath = null;
    this._seekOffsetMs = 0;
    _f.ca_clear_buffer();
    this.emit('state_changed', 'stopped');
  }

  async seek(positionMs) {
    if (!this._initialized) return;
    const seekSec = Math.max(0, positionMs / 1000);
    const wasPlaying = this._playing;

    _f.ca_stop();
    this._killFFmpeg();
    this._pendingBuf = Buffer.alloc(0);
    _f.ca_clear_buffer();
    this._seekOffsetMs = Math.round(seekSec * 1000);

    // Web Audio 模式：浏览器可解码格式不启动 FFmpeg
    // AudioEngine 会处理 seek，DLL 只需清除缓冲区
    if (this._currentFilePath && !this._webAudioBrowserDecode) {
      this._spawnFFmpeg(this._currentFilePath, seekSec);
    }

    if (wasPlaying) {
      const r = _f.ca_start();
      if (r === 0) {
        this._playing = true;
      }
    } else {
      this._paused = true;
    }
  }

  async setVolume(level) {
    // 音量は Web Audio API 側で制御。DLL は常に 1.0。
    this._volume = Math.max(0, Math.min(1, level));
  }

  // ── Web Audio API モード ──────────────────────────────────────────────────

  /**
   * Web Audio API 模式を有効/無効にする。
   * 有効時、ブラウザでデコード可能な形式のファイルは FFmpeg を起動しない。
   */
  setWebAudioEnabled(enabled) {
    this._webAudioEnabled = !!enabled;
    console.log('[wasapi] Web Audio mode:', enabled ? 'enabled' : 'disabled');
  }

  /**
   * ブラウザデコード用にファイルを設定（FFmpeg を起動しない）。
   * Web Audio API 側で decodeAudioData を使用してデコードする。
   *
   * @param {string} filePath - 音频文件路径
   * @returns {Promise<{durationMs: number}>}
   */
  async setupForBrowserDecode(filePath) {
    if (!this._initialized) throw new Error('Renderer not initialized');
    if (!filePath) throw new Error('No file path');

    this._currentFilePath = filePath;
    this._killFFmpeg();
    this._killNextFfmpeg();
    this._stopDrainTimer();
    this._pendingBuf = Buffer.alloc(0);
    this._nextPendingBuf = Buffer.alloc(0);
    this._nextFilePath = null;
    this._nextDurationMs = 0;
    this._seekOffsetMs = 0;
    _f.ca_clear_buffer();

    // ffprobe で長さを取得（失敗しても 0 を返すだけ）
    this._durationMs = await this._probeDuration(filePath);

    // FFmpeg は起動しない。Web Audio API 側でデコード＆再生。
    this._webAudioBrowserDecode = true;
    console.log('[wasapi] setupForBrowserDecode:', filePath, 'duration=', this._durationMs);
    return { durationMs: this._durationMs };
  }

  // ── 次曲プリロード ──────────────────────────────────────────────────────

  async preloadNext(filePath, seekMsOrOpts = 0) {
    if (!this._initialized) throw new Error('Renderer not initialized');
    if (!filePath) throw new Error('No file path');

    // 支持调用方式：preloadNext(filePath, {skipFFmpeg})
    let skipFFmpeg = false;
    if (typeof seekMsOrOpts === 'object') {
      skipFFmpeg = !!seekMsOrOpts.skipFFmpeg;
    }

    this._killNextFfmpeg();
    this._nextPendingBuf = Buffer.alloc(0);
    this._nextFilePath = filePath;

    this._nextDurationMs = await this._probeDuration(filePath);

    // Web Audio 模式：浏览器可解码的格式不启动 FFmpeg
    if (skipFFmpeg) {
      console.log('[wasapi] preloadNext (skipFFmpeg):', filePath);
      return { durationMs: this._nextDurationMs };
    }

    const ff = _findFFmpeg();
    if (!ff) throw new Error('ffmpeg not found');

    this._spawnNextFfmpeg(filePath, 0);

    // 少し待ってデータが出始めたら返す
    const maxWaitMs = 2000;
    const startT = Date.now();

    await new Promise((resolve) => {
      const check = () => {
        if (this._nextFfmpegFinished) { resolve(); return; }
        if (Date.now() - startT > maxWaitMs) { resolve(); return; }
        setTimeout(check, 20);
      };
      check();
    });

    console.log('[wasapi] preloadNext complete:', filePath);
    return { durationMs: this._nextDurationMs };
  }

  /**
   * Crossfade/Gapless 完成后，将 next track 提升为 current track。
   *
   * AudioEngine 的 _finishMix() 已把 nextRing 的剩余数据复制到 mainRing，
   * 但 wasapi.js 侧的 next ffmpeg 进程仍在运行。如果不提升，后续 PCM 数据
   * 仍会进入 'next' channel（被 AudioEngine 忽略），导致 mainRing 枯竭后静音死锁。
   *
   * 提升后：
   * - next ffmpeg 进程变为 main ffmpeg 进程
   * - 后续 PCM 数据通过 'main' channel 发送
   * - close 事件通过 'main' channel 通知
   * - 元数据（filePath, durationMs）更新为新曲目
   */
  promoteNextToCurrent() {
    if (!this._nextFilePath && !this._nextPromoted) {
      console.warn('[wasapi] promoteNextToCurrent: no next track to promote');
      return;
    }

    // 杀死旧 main ffmpeg（通常已结束）
    this._killFFmpeg();

    // 把 next 的 pending 数据移到 main
    this._pendingBuf = this._nextPendingBuf;
    this._nextPendingBuf = Buffer.alloc(0);

    // 把 next ffmpeg 进程变为 main
    const proc = this._nextFfmpegProc;
    this._ffmpegProc = proc;
    this._ffmpegFinished = this._nextFfmpegFinished;
    this._nextFfmpegProc = null;
    this._nextFfmpegFinished = false;

    // 更新元数据
    this._currentFilePath = this._nextFilePath;
    this._durationMs = this._nextDurationMs;
    this._seekOffsetMs = 0;
    this._nextFilePath = null;
    this._nextDurationMs = 0;
    this._nextPromoted = false;
    // 提升后的浏览器解码标志：无 FFmpeg 进程意味着次曲是浏览器解码的
    this._webAudioBrowserDecode = !proc;

    // 关键：将提升后的进程的事件监听器从 'next' 语义切换为 'main' 语义。
    // 旧实现依赖 _nextPromoted 标志做运行时路由，但该标志会在下次
    // _killNextFfmpeg() 时被重置为 false，导致 PCM 数据误入 'next' 通道、
    // mainRing 枯竭后静音死锁。直接重新绑定监听器彻底消除该隐患。
    if (proc) {
      proc.stdout.removeAllListeners('data');
      proc.stdout.on('data', (chunk) => this._onPcmData(chunk, 'main'));

      proc.removeAllListeners('close');
      proc.on('close', () => {
        this._ffmpegFinished = true;
        this._ffmpegProc = null;
        if (this.sendFfmpegState) this.sendFfmpegState('main', true);
      });

      proc.removeAllListeners('error');
      proc.on('error', (e) => {
        console.error('[wasapi] ffmpeg error (promoted):', e.message);
        this._ffmpegFinished = true;
        this._ffmpegProc = null;
        if (this.sendFfmpegState) this.sendFfmpegState('main', true);
      });
    }

    console.log('[wasapi] Promoted next to current:', this._currentFilePath,
      'duration:', this._durationMs + 'ms',
      'ffmpeg running:', !!this._ffmpegProc);
  }

  _spawnNextFfmpeg(filePath, seekSec = 0) {
    const ff = _findFFmpeg();
    if (!ff) return;

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

    this._nextFfmpegFinished = false;
    this._nextFfmpegProc = spawn(ff, args, { windowsHide: true });

    this._nextFfmpegProc.stdout.on('data', (chunk) => this._onPcmData(chunk, 'next'));
    this._nextFfmpegProc.stderr.on('data', () => { /* ignore */ });

    this._nextFfmpegProc.on('close', () => {
      this._nextFfmpegFinished = true;
      this._nextFfmpegProc = null;
      if (this._nextPromoted) {
        // 已提升为 current，通知 main channel
        this._ffmpegFinished = true;
        if (this.sendFfmpegState) this.sendFfmpegState('main', true);
      } else {
        if (this.sendFfmpegState) this.sendFfmpegState('next', true);
      }
    });
    this._nextFfmpegProc.on('error', (e) => {
      console.error('[wasapi] next ffmpeg error:', e.message);
      this._nextFfmpegFinished = true;
      this._nextFfmpegProc = null;
      if (this._nextPromoted) {
        this._ffmpegFinished = true;
        if (this.sendFfmpegState) this.sendFfmpegState('main', true);
      } else {
        if (this.sendFfmpegState) this.sendFfmpegState('next', true);
      }
    });
  }

  _killNextFfmpeg() {
    this._nextPromoted = false;
    if (this._nextFfmpegProc) {
      try {
        this._nextFfmpegProc.removeAllListeners('close');
        this._nextFfmpegProc.removeAllListeners('error');
        if (this._nextFfmpegProc.stdout) this._nextFfmpegProc.stdout.removeAllListeners('data');
      } catch { /* ignore */ }
      try { this._nextFfmpegProc.kill('SIGKILL'); } catch { /* ignore */ }
      this._nextFfmpegProc = null;
    }
    this._nextFfmpegFinished = false;
    this._nextPendingBuf = Buffer.alloc(0);
  }

  /**
   * 获取 DLL 环形缓冲区的延迟（毫秒）。
   * 已推送到 DLL 但尚未被 WASAPI 消费的音频时长。
   * 用于渲染进程修正位置追踪（歌词/进度条同步）。
   */
  getBufferLatencyMs() {
    if (!this._initialized) return 0;
    try {
      const bytes = _f.ca_get_buffered_bytes();
      if (bytes <= 0) return 0;
      return Math.round(bytes * 1000 / (this._sampleRate * this._bytesPerFrame));
    } catch {
      return 0;
    }
  }

  getRemainingMs() {
    const pos = this._currentPositionMs();
    return Math.max(0, this._durationMs - pos);
  }

  hasNextPreloaded() {
    return !!this._nextFilePath;
  }

  /** 次曲プリロードをキャンセルする（キュー変更時に使用） */
  cancelPreloadNext() {
    this._killNextFfmpeg();
    this._nextFilePath = null;
    this._nextDurationMs = 0;
  }

  // ── 状態アクセサ ──────────────────────────────────────────────────────────

  async getPosition() {
    // 位置追跡はレンダラー側の AudioEngine で行う
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

  // ── 互換性プロパティ（player.js からの参照用） ─────────────────────────

  set setGaplessEnabled(_) { /* Web Audio API 側で管理 */ }
  get gaplessEnabled() { return false; }
  set setCrossfadeEnabled(_) { /* Web Audio API 側で管理 */ }
  get crossfadeEnabled() { return false; }
  setCrossfadeDuration() { /* Web Audio API 側で管理 */ }
  get crossfadeDurationMs() { return 4000; }

  setTempo() { /* SoundTouch は別途対応 */ }
  setPitch() { /* SoundTouch は別途対応 */ }
  setRate() { /* SoundTouch は別途対応 */ }
  get tempo() { return 1.0; }
  get pitch() { return 1.0; }
  get rate() { return 1.0; }

  _killFFmpeg() {
    if (this._ffmpegProc) {
      // 移除回调防止异步 close 事件覆盖后续 promoteNextToCurrent 的状态
      try {
        this._ffmpegProc.removeAllListeners('close');
        this._ffmpegProc.removeAllListeners('error');
        if (this._ffmpegProc.stdout) this._ffmpegProc.stdout.removeAllListeners('data');
      } catch { /* ignore */ }
      try { this._ffmpegProc.kill('SIGKILL'); } catch { /* ignore */ }
      this._ffmpegProc = null;
    }
    this._ffmpegFinished = false;
    this._pendingBuf = Buffer.alloc(0);
  }

  async close() {
    this._stopDrainTimer();
    this._killFFmpeg();
    this._killNextFfmpeg();
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
