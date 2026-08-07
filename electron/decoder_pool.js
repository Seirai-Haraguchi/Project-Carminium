/**
 * Carminium — 统一解码池 (Unified FFmpeg Process Manager)
 *
 * 将所有 FFmpeg 子进程收敛到集中管理的双槽位池。
 * 每个槽位对应最多 1 个 FFmpeg 进程，统一生命周期管理，杜绝孤儿进程。
 * 配合 Electron --in-process-gpu 标志，任务管理器视图下所有处理
 * 收敛为单一应用进程组。
 *
 * 槽位:
 *   'main' — 当前曲目持续解码
 *   'next' — Gapless/Crossfade 下一曲预加载解码
 */
'use strict';

const { spawn } = require('child_process');

class DecoderPool {
  /**
   * @param {string} ffmpegPath - ffmpeg 可执行文件路径
   */
  constructor(ffmpegPath) {
    this._ffmpegPath = ffmpegPath;
    this._sampleRate = 44100;
    this._channels = 2;

    // 槽位: { proc, onData, pendingBuf, finished }
    this._slots = { main: null, next: null };

    // 活跃进程引用计数（用于 shutdown 检测）
    this._activeCount = 0;
  }

  /** 设置输出格式参数 */
  configure(sampleRate, channels) {
    this._sampleRate = sampleRate;
    this._channels = channels;
  }

  // ── 槽位操作 ────────────────────────────────────────────────────────

  /**
   * 在指定槽位启动 FFmpeg 解码。
   * 同一槽位已有进程时先自动终止。
   *
   * @param {'main'|'next'} slot
   * @param {string} filePath
   * @param {number} seekSec
   * @param {Function} onPcmData - (float32Array) => void
   * @param {Function} [onFinished] - () => void, FFmpeg 正常结束时回调
   * @param {Function} [onError] - (err) => void
   */
  start(slot, filePath, seekSec, onPcmData, onFinished, onError) {
    this._killSlot(slot);

    const args = [];
    if (seekSec > 0) args.push('-ss', String(seekSec));
    args.push(
      '-i', filePath,
      '-f', 'f32le',
      '-ar', String(this._sampleRate),
      '-ac', String(this._channels),
      '-loglevel', 'quiet',
      'pipe:1'
    );

    const proc = spawn(this._ffmpegPath, args, { windowsHide: true });
    const pendingBuf = { buf: Buffer.alloc(0) };

    const onData = (chunk) => {
      let buf = chunk;
      if (pendingBuf.buf.length > 0) {
        buf = Buffer.concat([pendingBuf.buf, chunk]);
      }
      const sampleBytes = 4;
      const alignedLen = Math.floor(buf.length / sampleBytes) * sampleBytes;
      pendingBuf.buf = alignedLen < buf.length ? buf.slice(alignedLen) : Buffer.alloc(0);
      if (alignedLen > 0) {
        const fa = new Float32Array(buf.buffer, buf.byteOffset, alignedLen / 4);
        onPcmData(new Float32Array(fa));
      }
    };

    proc.stdout.on('data', onData);
    proc.stderr.on('data', () => {});

    proc.on('close', () => {
      this._slots[slot] = null;
      this._activeCount--;
      if (onFinished) onFinished();
    });

    proc.on('error', (e) => {
      console.error('[decoder_pool] ffmpeg error (' + slot + '):', e.message);
      this._slots[slot] = null;
      this._activeCount--;
      if (onError) onError(e);
      else if (onFinished) onFinished();
    });

    this._slots[slot] = { proc, onData, pendingBuf };
    this._activeCount++;
  }

  /**
   * 终止指定槽位的 FFmpeg 进程。
   * @param {'main'|'next'} slot
   */
  stopSlot(slot) {
    this._killSlot(slot);
  }

  /**
   * 将 'next' 槽位的进程提升为 'main' 槽位。
   * 用于 Gapless/Crossfade 完成后，将预加载的进程切换为主进程。
   * 提升后原 'main' 槽位被终止，'next' 槽位清空。
   *
   * @param {Function} onPcmData - 新的 main 槽位 PCM 回调
   * @param {Function} [onFinished] - 新的 main 槽位结束回调
   * @param {Function} [onError] - 新的 main 槽位错误回调
   * @returns {boolean} 是否成功提升（next 槽位有活跃进程时返回 true）
   */
  promoteNextToMain(onPcmData, onFinished, onError) {
    const nextSlot = this._slots.next;
    if (!nextSlot) return false;

    // 终止旧的 main 槽位
    this._killSlot('main');

    // 将 next 槽位移到 main 槽位，更换回调
    const proc = nextSlot.proc;
    proc.stdout.removeAllListeners('data');
    proc.stdout.on('data', (chunk) => {
      let buf = chunk;
      if (nextSlot.pendingBuf.buf.length > 0) {
        buf = Buffer.concat([nextSlot.pendingBuf.buf, chunk]);
      }
      const sampleBytes = 4;
      const alignedLen = Math.floor(buf.length / sampleBytes) * sampleBytes;
      nextSlot.pendingBuf.buf = alignedLen < buf.length ? buf.slice(alignedLen) : Buffer.alloc(0);
      if (alignedLen > 0) {
        const fa = new Float32Array(buf.buffer, buf.byteOffset, alignedLen / 4);
        onPcmData(new Float32Array(fa));
      }
    });

    proc.removeAllListeners('close');
    proc.on('close', () => {
      this._slots.main = null;
      this._activeCount--;
      if (onFinished) onFinished();
    });

    proc.removeAllListeners('error');
    proc.on('error', (e) => {
      console.error('[decoder_pool] ffmpeg error (main, promoted):', e.message);
      this._slots.main = null;
      this._activeCount--;
      if (onError) onError(e);
      else if (onFinished) onFinished();
    });

    this._slots.main = { proc, onData: nextSlot.onData, pendingBuf: nextSlot.pendingBuf };
    this._slots.next = null;
    return true;
  }

  // ── 背压控制 ────────────────────────────────────────────────────────

  pauseStdout(slot) {
    const s = this._slots[slot];
    if (s && s.proc && s.proc.stdout && !s.proc.stdout.isPaused()) {
      try { s.proc.stdout.pause(); } catch (_) {}
    }
  }

  resumeStdout(slot) {
    const s = this._slots[slot];
    if (s && s.proc && s.proc.stdout && s.proc.stdout.isPaused()) {
      try { s.proc.stdout.resume(); } catch (_) {}
    }
  }

  // ── 状态查询 ────────────────────────────────────────────────────────

  isSlotActive(slot) {
    return this._slots[slot] !== null;
  }

  get activeCount() {
    return this._activeCount;
  }

  // ── 生命周期 ────────────────────────────────────────────────────────

  /** 终止所有槽位并清理 */
  stopAll() {
    this._killSlot('main');
    this._killSlot('next');
  }

  // ── 内部 ────────────────────────────────────────────────────────────

  _killSlot(slot) {
    const s = this._slots[slot];
    if (!s) return;
    try {
      if (s.onData) s.proc.stdout.removeListener('data', s.onData);
      s.proc.removeAllListeners('close');
      s.proc.removeAllListeners('error');
    } catch (_) {}
    try { s.proc.kill('SIGKILL'); } catch (_) {}
    this._slots[slot] = null;
    this._activeCount = Math.max(0, this._activeCount - 1);
  }
}

module.exports = { DecoderPool };
