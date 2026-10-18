'use strict';

const { spawn } = require('child_process');

class DecoderPool {
  constructor(ffmpegPath) {
    this._ffmpegPath = ffmpegPath;
    this._sampleRate = 44100;
    this._channels = 2;

    this._slots = { main: null, next: null };

    this._activeCount = 0;
  }

  configure(sampleRate, channels) {
    this._sampleRate = sampleRate;
    this._channels = channels;
  }


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

    this._slots[slot] = { proc, onData, pendingBuf };
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

    this._slots.main = { proc, onData: nextSlot.onData, pendingBuf: nextSlot.pendingBuf };
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
