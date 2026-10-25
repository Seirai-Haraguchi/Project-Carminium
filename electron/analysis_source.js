'use strict';
/*
 * 分析用的 PCM 取帧（主进程侧）。
 *
 * 为什么不复用 DecoderPool：DecoderPool 的两个槽位是给播放用的（main/next），
 * 生命周期与播放强绑；分析是短时、可排队、可丢弃的独立任务，混进播放槽会互相踢掉。
 * 所以这里开独立短进程，但仍然遵守"全部经过 FFmpeg、不自己做解码"的约束。
 *
 * 输出格式固定：单声道 / 22050Hz / f32le —— 与 web/analysis/frontend.js 的假设一致。
 *
 * ⚠️ 实测教训：按 45s 分块读（每块一个 ffmpeg 进程）时，613s 的曲子要 7.4s，
 * 其中绝大部分是进程启动/IO 开销（每块 ≈500ms），而 DSP 只占 176ms。
 * 所以主路径改成**单进程流式解码**：一次启动，边解边喂分析器。
 */
const { spawn } = require('child_process');

const SR = 22050;
const CHUNK_SEC = 45;
const MAX_SEC = 20 * 60;

class AnalysisSource {
  constructor(ffmpegPath) {
    this._ffmpeg = ffmpegPath;
    this._chain = Promise.resolve();
    this._inflight = 0;
    this.lastPath = '';
  }

  get busy() { return this._inflight > 0; }

  /**
   * 单进程流式解码。onSamples 必须是同步的（内部直接喂给分析器）。
   * @returns {Promise<{fedSamples:number, aborted:boolean}>}
   */
  stream(filePath, onSamples, opts) {
    opts = opts || {};
    const maxSec = Math.max(1, Math.min(MAX_SEC, opts.maxSec || MAX_SEC));
    const self = this;
    const job = () => this._stream(filePath, onSamples, maxSec);
    const p = this._chain.then(job, job);
    this._chain = p.then(() => {  }, () => {  });
    return p;
  }

  _stream(filePath, onSamples, maxSec) {
    return new Promise((resolve, reject) => {
      if (!filePath) return reject(new Error('no path'));
      this.lastPath = filePath;

      const args = [
        '-i', filePath,
        '-t', String(maxSec),
        '-ac', '1',
        '-ar', String(SR),
        '-f', 'f32le',
        '-loglevel', 'error',
        'pipe:1',
      ];

      let proc;
      try {
        proc = spawn(this._ffmpeg, args, { windowsHide: true });
      } catch (e) {
        return reject(e);
      }
      this._inflight++;

      let fed = 0;
      let residue = Buffer.alloc(0);
      let aborted = false;
      let settled = false;

      const finish = (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this._inflight--;
        if (err) reject(err);
        else resolve({ fedSamples: fed, aborted: aborted });
      };

      const timer = setTimeout(() => {
        aborted = true;
        try { proc.kill('SIGKILL'); } catch {  }
        finish(new Error('analysis decode timeout'));
      }, 120000);

      proc.stdout.on('data', (buf) => {
        if (aborted) return;
        try {
          let b = buf;
          if (residue.length) {
            b = Buffer.concat([residue, buf]);
            residue = Buffer.alloc(0);
          }
          const usable = Math.floor(b.length / 4) * 4;
          if (usable < b.length) residue = b.subarray(usable);

          if (usable > 0) {
            let f32;
            if (b.byteOffset % 4 === 0) {
              f32 = new Float32Array(b.buffer, b.byteOffset, usable / 4);
            } else {
              f32 = new Float32Array(usable / 4);
              for (let i = 0; i < f32.length; i++) f32[i] = b.readFloatLE(i * 4);
            }
            onSamples(f32);
            fed += f32.length;
          }
        } catch (e) {
          aborted = true;
          try { proc.kill('SIGKILL'); } catch {  }
          finish(e);
        }
      });

      proc.stderr.on('data', () => {});
      proc.on('error', (e) => finish(e));
      proc.on('close', () => {
        if (!settled && fed === 0) return finish(new Error('no audio decoded'));
        finish(null);
      });
    });
  }

  /**
   * 兼容旧接口：读一段 PCM。分析主路径已改用 stream()。
   */
  read(filePath, startMs, durMs) {
    const acc = [];
    return this.stream(filePath, (f32) => { acc.push(f32); }, {
      maxSec: Math.max(1, (durMs || CHUNK_SEC * 1000) / 1000),
    }).then(({ fedSamples }) => {
      const out = new Float32Array(fedSamples);
      let off = 0;
      for (const a of acc) { out.set(a, off); off += a.length; }
      return out;
    });
  }
}

module.exports = { AnalysisSource, SR, CHUNK_SEC };
