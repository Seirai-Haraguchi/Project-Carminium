/**
 * StreamingPCMProcessor
 *
 * 将外部 FFmpeg 解码的 PCM 数据注入 Web Audio 图。
 * 用于浏览器无法解码的格式（WMA、APE 等）。
 *
 * 主线程通过 port.postMessage 注入 PCM（planar f32），
 * 处理器内部维护环形缓冲区，在 process() 中消费并输出。
 *
 * 输入：无（自身作为音源）
 * 输出：stereo planar Float32（Web Audio 标准格式）
 */
class StreamingPCMProcessor extends AudioWorkletProcessor {
  constructor() {
    super();

    // 环形缓冲区：~4 秒 stereo（44100 × 2 × 4 = 352800 samples）
    this._buf = new Float32Array(352800);
    this._writePos = 0;
    this._readPos = 0;
    this._ended = false;

    // 已消费帧数追踪（用于精确位置计算）
    // process() 每次被 AudioContext 调用都会计数，无论是否有真实音频数据
    this._consumedFrames = 0;
    this._baseline = 0;  // 基线偏移：首次推送 PCM 前的静音帧数
    this._reportInterval = 0;

    this.port.onmessage = (e) => this._onMessage(e.data);
  }

  _onMessage(data) {
    switch (data.type) {
      case 'pcm': {
        // data.samples: interleaved f32 ArrayBuffer（transferable）
        const samples = new Float32Array(data.samples);
        this._append(samples);
        break;
      }
      case 'clear': {
        this._readPos = this._writePos;
        this._ended = false;
        this._consumedFrames = 0;
        this._baseline = 0;
        this._reportInterval = 0;
        break;
      }
      case 'baseline': {
        this._baseline = this._consumedFrames;
        this._reportInterval = 0;
        break;
      }
      case 'end': {
        this._ended = true;
        break;
      }
    }
  }

  _append(data) {
    const needed = data.length;
    const free = this._buf.length - this._writePos;

    if (needed > free) {
      // 压缩：将未读数据移到缓冲区开头
      const unread = this._writePos - this._readPos;
      if (unread > 0) {
        this._buf.copyWithin(0, this._readPos, this._writePos);
      }
      this._writePos = unread;
      this._readPos = 0;

      // 仍然放不下 → 扩容
      if (needed > this._buf.length - this._writePos) {
        const newCap = Math.max(this._buf.length * 2, this._writePos + needed);
        const newBuf = new Float32Array(newCap);
        newBuf.set(this._buf.subarray(0, this._writePos));
        this._buf = newBuf;
      }
    }

    this._buf.set(data, this._writePos);
    this._writePos += needed;
  }

  process(inputs, outputs /* , parameters */) {
    const output = outputs[0];
    if (!output || output.length < 2) return true;

    const L = output[0];
    const R = output[1];
    const frames = L.length;
    const available = this._writePos - this._readPos;
    // 可读的真实帧数（stereo samples → frames）
    const readableFrames = Math.min(available >> 1, frames);

    let pos = this._readPos;
    // 写入真实数据
    for (let i = 0; i < readableFrames; i++) {
      L[i] = this._buf[pos++];
      R[i] = this._buf[pos++];
    }
    // 剩余部分填静音（buffer underrun）
    for (let i = readableFrames; i < frames; i++) {
      L[i] = 0;
      R[i] = 0;
    }
    this._readPos = pos;

    // 只统计真实消费的帧数，underrun 期间不前进位置
    // 这样 Subsonic 等网络流式播放在网络抖动/缓冲区空缺时
    // 进度条不会超前乱跑（位置暂停，等真实音频到达后继续）
    this._consumedFrames += readableFrames;
    this._reportInterval += readableFrames;
    // 每 ~250ms（11025 frames @ 44100Hz）上报一次已消费帧数
    if (this._reportInterval >= 11025) {
      this.port.postMessage({ type: 'position', consumedFrames: this._consumedFrames - this._baseline });
      this._reportInterval = 0;
    }

    // 所有数据已消费且已标记结束 → 通知主线程
    if (this._ended && (this._writePos - this._readPos) === 0) {
      this.port.postMessage({ type: 'ended' });
      this._ended = false; // 防止重复发送
    }

    return true;
  }
}

registerProcessor('streaming-pcm-processor', StreamingPCMProcessor);
