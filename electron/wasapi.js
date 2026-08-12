/**
 * Carminium — ネイティブオーディオレンダラー (Zig + miniaudio)
 *
 * native/carminium_audio.zig が生成したネイティブライブラリ
 * （Windows: .dll / Linux: .so / macOS: .dylib）を koffi 経由で呼び出す。
 * ネイティブ側は miniaudio（Windows: WASAPI / Linux: PulseAudio または ALSA / macOS: CoreAudio）で直接出力。
 *
 * アーキテクチャ:
 *   FFmpeg (デコード) → IPC → Renderer (Web Audio API 合成)
 *                                         ↓
 *   Renderer (合成済み PCM) → IPC → ca_push_pcm() → native.so/.dll/.dylib → オーディオデバイス
 *
 * このモジュールは FFmpeg のデコードと miniaudio への PCM 出力のみを担当する。
 * Gapless/AutoMix/音量の合成はすべてレンダラー側の Web Audio API で行われる。
 */
'use strict';

const koffi = require('koffi');
const { execSync, execFile } = require('child_process');
const { EventEmitter } = require('events');
const fs = require('fs');
const path = require('path');
const { DecoderPool } = require('./decoder_pool');

const SHARE_SHARED = 0;
const SHARE_EXCLUSIVE = 1;

// プラットフォーム別ファイル名・サブディレクトリ
const IS_WIN = process.platform === 'win32';
const IS_MAC = process.platform === 'darwin';
const PLATFORM_SUBDIR = IS_WIN ? 'win32' : (process.platform === 'linux' ? 'linux' : (IS_MAC ? 'darwin' : process.platform));
const LIB_NAME = IS_WIN ? 'carminium_audio.dll' : (IS_MAC ? 'carminium_audio.dylib' : 'carminium_audio.so');
const FFMPEG_NAME = IS_WIN ? 'ffmpeg.exe' : 'ffmpeg';
const FFPROBE_NAME = IS_WIN ? 'ffprobe.exe' : 'ffprobe';

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
    // 最優先：プラットフォーム別サブディレクトリ（Win/Linux 両方のバイナリを共存可能に）
    path.join(__dirname, 'bin', PLATFORM_SUBDIR, LIB_NAME),
    // 互換：electron/bin 直下（従来構成）
    path.join(__dirname, 'bin', LIB_NAME),
    // 開発環境：native/zig-out 配下
    path.join(__dirname, '..', 'native', 'zig-out', 'bin', LIB_NAME),
  ];
  // Linux: デベロッパー環境でビルドした zig-out/lib からも探す
  if (!IS_WIN) {
    candidates.push(path.join(__dirname, '..', 'native', 'zig-out', 'lib', LIB_NAME));
  }
  // Linux packages may place native assets in resources/ rather than beside
  // electron/ inside the asar. Keep this location as a final packaged-app
  // fallback so AppImage/deb layouts remain loadable.
  if (process.resourcesPath) {
    candidates.push(path.join(process.resourcesPath, LIB_NAME));
    candidates.push(path.join(process.resourcesPath, 'electron', 'bin', PLATFORM_SUBDIR, LIB_NAME));
  }
  let libPath = null;
  for (const c of candidates) {
    // electron-builder unpacks native assets next to app.asar. Resolve the
    // real path before checking existence; app.asar/electron/... itself is
    // only a virtual path and therefore does not exist on disk.
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
  } catch { /* not in PATH */ }
  // プラットフォーム別追加探索パス
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
  } catch { /* not in PATH */ }
  const ff = _findFFmpeg();
  if (ff && ff !== 'ffmpeg') {
    const probePath = path.join(path.dirname(ff), FFPROBE_NAME);
    if (fs.existsSync(probePath)) { _ffprobePath = probePath; return _ffprobePath; }
  }
  // Linux 追加 PATH
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

    // 统一解码池管理所有 FFmpeg 子进程（最多 2 槽位：main + next）
    this._decoder = null;
    this._ffmpegDataStarted = false;

    this._seekOffsetMs = 0;
    // 暂停时记录的位置（恢复播放时从该处重新解码）
    this._resumePositionMs = null;

    // 次曲メタデータ
    this._nextDurationMs = 0;
    this._nextFilePath = null;
    // gapless 预加载完毕后标记（promoteNextToCurrent 使用）
    this._nextReady = false;

    // Web Audio API 模式标志：当为 true 时，浏览器可解码的格式不启动 FFmpeg
    this._webAudioEnabled = false;
    // 当前曲目是否使用浏览器解码（无 FFmpeg 进程）
    this._webAudioBrowserDecode = false;

    // レンダラーに PCM を送るためのコールバック
    // Bridge が設定する
    this.sendPcmToRenderer = null;    // (channel: 'main'|'next', float32Array) => void
    this.sendFfmpegState = null;      // (channel: 'main'|'next', finished: bool) => void

    this._drainTimer = null;

    // ── Pre-roll（起動前バッファリング）──
    // WASAPI デバイスを開始する前に DLL リングバッファへ一定量の PCM を蓄える。
    // 蓄積後は push 速度 = 消費速度で水位が PREROLL_MS 付近に保たれるため、
    // 切歌瞬間のレンダラー主スレッドブロック（UI 更新・decodeAudioData・GC）
    // による PCM 転送遅延をバッファが吸収し、欠載による音切れを防ぐ。
    // 位置表示は getBufferLatencyMs → AudioEngine 側の遅延補正で自動補正される。
    this.PREROLL_MS = 800;          // 目標水位（ミリ秒）
    this.PREROLL_TIMEOUT_MS = 3000; // 水位が貯まらなくても強制開始する上限
    this._prerollTimer = null;
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
    if (!_loadDll()) throw new Error('carminium_audio native library not loaded: ' + LIB_NAME);
    if (this._initialized) await this.close();

    // Linux/macOS: PulseAudio/ALSA/CoreAudio don't support WASAPI exclusive mode.
    // Force shared mode on non-Windows; ignore the shareMode option.
    const shareMode = (IS_WIN && opts.shareMode === SHARE_EXCLUSIVE) ? SHARE_EXCLUSIVE : SHARE_SHARED;
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

    // 配置统一解码池
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

  // ── FFmpeg デコード ──────────────────────────────────────────────────────

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
    _f.ca_clear_buffer();

    this._durationMs = await this._probeDuration(filePath);

    const _this = this;
    this._ffmpegDataStarted = false;
    this._decoder.start('main', filePath, 0,
      /* onPcmData */ (fa) => {
        if (!_this._ffmpegDataStarted) _this._ffmpegDataStarted = true;
        if (_this.sendPcmToRenderer) _this.sendPcmToRenderer('main', fa);
      },
      /* onFinished */ () => {
        if (_this.sendFfmpegState) _this.sendFfmpegState('main', true);
      },
      /* onError */ () => {
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
    // 已废弃：FFmpeg 子进程管理已收敛到 DecoderPool。
    // 使用 this._decoder.start('main', ...) 替代。
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
    // DecoderPool 已将 PCM 字节对齐并转为 Float32Array，直接转发即可。
    if (chunk instanceof Float32Array && this.sendPcmToRenderer) {
      this.sendPcmToRenderer(channel, chunk);
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

  // ── FFmpeg stdout 背压控制 ─────────────────────────────────────────────
  // 当渲染进程 StreamingPCMProcessor 的 ring buffer 水位过高时，
  // 暂停 FFmpeg stdout 的 data 事件，阻止 PCM 继续产出。
  // FFmpeg 管道缓冲区满后会自然阻塞，不丢弃任何数据。

  pauseStdout(channel) {
    if (this._decoder) this._decoder.pauseStdout(channel);
  }

  resumeStdout(channel) {
    if (this._decoder) this._decoder.resumeStdout(channel);
  }

  // ── 再生制御 ──────────────────────────────────────────────────────────────

  /**
   * Pre-roll 対応の再生開始。
   * 水位が目標に達していれば即座に ca_start、
   * 足りなければポーリングで水位を待ってから開始する。
   * タイムアウト時は無音デッドロック防止のため強制開始。
   */
  _startWithPreroll() {
    this._cancelPreroll();
    if (!this._initialized) return;

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
    try { buffered = _f.ca_get_buffered_bytes(); } catch { /* ignore */ }
    if (buffered >= targetBytes) {
      tryStart();
      return;
    }

    const startT = Date.now();
    console.log('[wasapi] preroll: waiting for buffer', Math.round(buffered / (this._bytesPerFrame * this._sampleRate / 1000)) + 'ms /', this.PREROLL_MS + 'ms');
    this._prerollTimer = setInterval(() => {
      if (!this._initialized) { this._cancelPreroll(); return; }
      let level = 0;
      try { level = _f.ca_get_buffered_bytes(); } catch { /* ignore */ }
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

  /**
   * 从指定位置（毫秒）重建 main 槽位解码进程。
   * 暂停/后台释放进程后，恢复播放时调用。
   * 已有活跃进程（如 seek 刚启动）则不重建。
   */
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
    // 暂停时进程已释放，从记录的位置重新解码恢复
    this._startFromPosition(this._resumePositionMs);
    // 先に状態を playing にして UI を即応させる。
    // DLL 側の実際の出力開始は pre-roll 完了後（位置は遅延補正で正しく表示される）。
    this._playing = true;
    this._paused = false;
    this.emit('state_changed', 'playing');
    this._startWithPreroll();
  }

  async pause() {
    if (!this._playing) return;
    this._cancelPreroll();
    _f.ca_stop();
    // 记录暂停位置，供 play() 恢复时从该处重新解码
    this._resumePositionMs = this._currentPositionMs();
    // 终止 FFmpeg 子进程 → 释放其占用的内存
    if (this._decoder) {
      this._decoder.stopSlot('main');
      this._decoder.stopSlot('next');
    }
    this._playing = false;
    this._paused = true;
    this.emit('state_changed', 'paused');
  }

  /**
   * 释放空闲解码进程（窗口失焦/后台时调用，真正释放内存）。
   * 播放中不释放（会断音）；未播放时进程通常已在 pause() 释放，此处兜底。
   */
  suspendDecoders() {
    if (this._playing) return;
    if (this._decoder && (this._decoder.isSlotActive('main') || this._decoder.isSlotActive('next'))) {
      this._resumePositionMs = this._currentPositionMs();
      this._decoder.stopSlot('main');
      this._decoder.stopSlot('next');
    }
  }

  /**
   * 窗口聚焦时调用。解码进程的重建由 play() 驱动（仅在恢复播放时创建），
   * 聚焦本身不重建进程，避免暂停态下无谓占用内存。
   */
  resumeDecoders() {
    /* no-op：进程重建由 play() 负责 */
  }

  async stop() {
    this._cancelPreroll();
    _f.ca_stop();
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
    _f.ca_clear_buffer();
    this.emit('state_changed', 'stopped');
  }

  async seek(positionMs) {
    if (!this._initialized) return;
    const seekSec = Math.max(0, positionMs / 1000);
    const wasPlaying = this._playing;

    this._cancelPreroll();
    _f.ca_stop();
    if (this._decoder) this._decoder.stopSlot('main');
    _f.ca_clear_buffer();
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
    if (this._decoder) {
      this._decoder.stopSlot('main');
      this._decoder.stopSlot('next');
    }
    this._stopDrainTimer();
    this._nextFilePath = null;
    this._nextDurationMs = 0;
    this._seekOffsetMs = 0;
    _f.ca_clear_buffer();

    this._durationMs = await this._probeDuration(filePath);

    this._webAudioBrowserDecode = true;
    console.log('[wasapi] setupForBrowserDecode:', filePath, 'duration=', this._durationMs);
    return { durationMs: this._durationMs };
  }

  // ── 次曲プリロード ──────────────────────────────────────────────────────

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
      /* onPcmData */ (fa) => {
        if (_this.sendPcmToRenderer) _this.sendPcmToRenderer('next', fa);
      },
      /* onFinished */ () => {
        _this._nextReady = true;
        if (_this.sendFfmpegState) _this.sendFfmpegState('next', true);
      },
      /* onError */ () => {
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
    if (!this._nextFilePath && !this._nextReady) {
      console.warn('[wasapi] promoteNextToCurrent: no next track to promote');
      return;
    }

    // 更新元数据
    this._currentFilePath = this._nextFilePath;
    this._durationMs = this._nextDurationMs;
    this._seekOffsetMs = 0;
    this._nextFilePath = null;
    this._nextDurationMs = 0;
    this._nextReady = false;

    if (this._decoder) {
      const _this = this;
      const promoted = this._decoder.promoteNextToMain(
        /* onPcmData */ (fa) => {
          if (_this.sendPcmToRenderer) _this.sendPcmToRenderer('main', fa);
        },
        /* onFinished */ () => {
          if (_this.sendFfmpegState) _this.sendFfmpegState('main', true);
        },
        /* onError */ () => {
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
    // 已废弃：使用 this._decoder.start('next', ...) 替代。
  }

  _killNextFfmpeg() {
    // 已废弃：使用 this._decoder.stopSlot('next') 替代。
  }

  _killFFmpeg() {
    // 已废弃：使用 this._decoder.stopSlot('main') 替代。
  }

  /** 次曲プリロードをキャンセルする（キュー変更時に使用） */
  cancelPreloadNext() {
    if (this._decoder) this._decoder.stopSlot('next');
    this._nextFilePath = null;
    this._nextDurationMs = 0;
    this._nextReady = false;
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

  _currentPositionMs() {
    if (!this._initialized) return this._seekOffsetMs;
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

  async close() {
    this._cancelPreroll();
    this._stopDrainTimer();
    if (this._decoder) {
      this._decoder.stopSlot('main');
      this._decoder.stopSlot('next');
    }
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
