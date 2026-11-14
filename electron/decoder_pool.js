'use strict';

const { spawn } = require('child_process');

class DecoderPool {
  constructor(ffmpegPath, resolvePath) {
    this._ffmpegPath = ffmpegPath;
    // Re-resolve before every spawn: in portable builds the unpack directory
    // can be deleted underneath a running instance.
    this._resolvePath = typeof resolvePath === 'function' ? resolvePath : null;
    this._sampleRate = 44100;
    this._channels = 2;

    this._slots = { main: null, next: null };

    this._activeCount = 0;
  }

  configure(sampleRate, channels) {
    this._sampleRate = sampleRate;
    this._channels = channels;
  }


  /**
   * @param {object} [opts]
   *   opts.channels  该轨真实声道数（多声道空间化时不再强制 -ac 2）
   *   opts.layout    ffmpeg 认识的布局名（如 '5.1' / '7.1' / '5.1.2'），
   *                  用 aformat 强制成规范声道顺序，渲染侧才能按角色解码
   *
   * 对齐单位必须跟声道数走：按 4 字节对齐会让多声道帧被劈开，
   * 反交织之后每个声道都错位。
   */
  start(slot, filePath, seekSec, onPcmData, onFinished, onError, opts) {
    this._killSlot(slot);

    const channels = (opts && opts.channels > 0) ? opts.channels : this._channels;
    const layout = (opts && opts.layout) || '';

    const args = [];
    if (seekSec > 0) args.push('-ss', String(seekSec));
    args.push('-i', filePath);
    if (layout) {
      args.push('-af', `aformat=sample_fmts=flt:channel_layouts=${layout}`);
    } else if (channels !== this._channels) {
      args.push('-af', 'aformat=sample_fmts=flt');
    }
    args.push(
      '-f', 'f32le',
      '-ar', String(this._sampleRate),
      '-ac', String(channels),
      '-loglevel', 'quiet',
      'pipe:1'
    );

    let bin = this._ffmpegPath;
    if (this._resolvePath) {
      try { bin = this._resolvePath() || bin; } catch { /* keep last known path */ }
    }
    if (!bin) {
      // Do not call onFinished(): that would look like a completed track and
      // silently skip to the next one. Surface a real error instead.
      console.error('[decoder_pool] FFmpeg binary unavailable — cannot decode', filePath);
      if (onError) onError(new Error('FFmpeg binary unavailable'));
      return;
    }
    const proc = spawn(bin, args, { windowsHide: true });
    const pendingBuf = { buf: Buffer.alloc(0) };
    const frameBytes = Math.max(4, channels * 4);

    const onData = (chunk) => {
      let buf = chunk;
      if (pendingBuf.buf.length > 0) {
        buf = Buffer.concat([pendingBuf.buf, chunk]);
      }
      const alignedLen = Math.floor(buf.length / frameBytes) * frameBytes;
      pendingBuf.buf = alignedLen < buf.length ? buf.slice(alignedLen) : Buffer.alloc(0);
      if (alignedLen > 0) {
        onPcmData(new Float32Array(buf.buffer, buf.byteOffset, alignedLen / 4));
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

    this._slots[slot] = { proc, onData, pendingBuf, channels, frameBytes };
    this._activeCount++;
  }

  stopSlot(slot) {
    this._killSlot(slot);
  }

  promoteNextToMain(onPcmData, onFinished, onError) {
    const nextSlot = this._slots.next;
    if (!nextSlot) return false;

    this._killSlot('main');

    const proc = nextSlot.proc;
    const frameBytes = nextSlot.frameBytes || 4;
    proc.stdout.removeAllListeners('data');
    proc.stdout.on('data', (chunk) => {
      let buf = chunk;
      if (nextSlot.pendingBuf.buf.length > 0) {
        buf = Buffer.concat([nextSlot.pendingBuf.buf, chunk]);
      }
      const alignedLen = Math.floor(buf.length / frameBytes) * frameBytes;
      nextSlot.pendingBuf.buf = alignedLen < buf.length ? buf.slice(alignedLen) : Buffer.alloc(0);
      if (alignedLen > 0) {
        onPcmData(new Float32Array(buf.buffer, buf.byteOffset, alignedLen / 4));
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

    this._slots.main = { proc, onData: nextSlot.onData, pendingBuf: nextSlot.pendingBuf, channels: nextSlot.channels, frameBytes };
    this._slots.next = null;
    return true;
  }


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


  isSlotActive(slot) {
    return this._slots[slot] !== null;
  }

  get activeCount() {
    return this._activeCount;
  }


  stopAll() {
    this._killSlot('main');
    this._killSlot('next');
  }


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
