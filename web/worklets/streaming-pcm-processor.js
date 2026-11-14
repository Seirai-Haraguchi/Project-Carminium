class StreamingPCMProcessor extends AudioWorkletProcessor {
  /**
   * @param {{processorOptions?: {
   *   channels?: number,
   *   layout?: string,
   *   spatial?: boolean,
   *   params?: object,
   *   sampleRate?: number,
   * }}} options
   *
   * channels <= 2 时行为与旧版完全一致（交织立体声直接搬）；> 2 时按真实声道数
   * 反交织，再交给 SpatialCore 做空间化下混。
   */
  constructor(options) {
    super();

    const opt = (options && options.processorOptions) || {};
    this._channels = Math.max(1, Math.min(12, opt.channels || 2));
    this._layout = opt.layout || '';
    this._sr = opt.sampleRate || sampleRate;

    // 帧容量（每帧 channels 个 float）
    this._initialFrames = 44100 * 2;
    this._buf = new Float32Array(this._initialFrames * this._channels);
    this._writePos = 0;   // 以样本计
    this._readPos = 0;

    this._highWater = 44100 * 4 * this._channels;
    this._lowWater = 44100 * 2 * this._channels;

    this._ended = false;
    this._flowPaused = false;
    this._paused = false;

    this._consumedFrames = 0;
    this._baseline = 0;
    this._reportInterval = 0;

    this._spatial = null;
    this._planar = null;
    this._outL = new Float32Array(128);
    this._outR = new Float32Array(128);

    if (this._channels > 2 && typeof SpatialCore !== 'undefined') {
      this._spatial = new SpatialCore.SpatialEngine({
        sampleRate: this._sr,
        channels: this._channels,
        layout: this._layout,
        params: opt.params || {},
      });
      this._planar = [];
      for (let c = 0; c < this._channels; c++) this._planar.push(new Float32Array(128));
    }

    this.port.onmessage = (e) => this._onMessage(e.data);
  }

  _onMessage(data) {
    switch (data.type) {
      case 'pcm': {
        this._append(new Float32Array(data.samples));
        break;
      }
      case 'clear': {
        // 只在缓冲异常膨胀（> 8 秒）时才回收：每轨都重新分配 2MB 会在
        // 音频线程上留下一次 GC 抖动，而稳态本来就维持在高水位附近。
        const base = this._initialFrames * this._channels;
        if (this._buf.length > base * 4) this._buf = new Float32Array(base);
        this._readPos = 0;
        this._writePos = 0;
        this._ended = false;
        this._consumedFrames = 0;
        this._baseline = 0;
        this._reportInterval = 0;
        this._paused = false;
        this._flowPaused = false;
        if (this._spatial) this._spatial.reset();
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
      case 'pause': {
        this._paused = true;
        break;
      }
      case 'resume': {
        this._paused = false;
        break;
      }
      case 'stats': {
        // 诊断用：外部可以问到这个节点到底在干什么
        this.port.postMessage({
          type: 'stats',
          channels: this._channels,
          layout: this._layout,
          hasSpatial: !!this._spatial,
          active: this._spatial ? !!this._spatial.active : false,
          writePos: this._writePos,
          readPos: this._readPos,
          lastPeak: this._lastPeak || 0,
        });
        break;
      }
      case 'params': {
        if (!this._spatial || !data.params) break;
        this._spatial.setParams(data.params);
        break;
      }
    }
  }

  _append(data) {
    const needed = data.length;

    if (this._writePos + needed > this._buf.length) {
      // 先把未读数据搬到头部
      const unread = this._writePos - this._readPos;
      if (this._readPos > 0) {
        this._buf.copyWithin(0, this._readPos, this._writePos);
        this._writePos = unread;
        this._readPos = 0;
      }
      if (needed > this._buf.length - this._writePos) {
        let newCap = this._buf.length * 2;
        while (newCap < this._writePos + needed) newCap *= 2;
        newCap = Math.ceil(newCap / this._channels) * this._channels;
        const newBuf = new Float32Array(newCap);
        newBuf.set(this._buf.subarray(0, this._writePos));
        this._buf = newBuf;
      }
    }

    this._buf.set(data, this._writePos);
    this._writePos += needed;

    if (!this._flowPaused && (this._writePos - this._readPos) > this._highWater) {
      this._flowPaused = true;
      this.port.postMessage({ type: 'flow_pause' });
    }
  }

  process(inputs, outputs) {
    const output = outputs[0];
    if (!output || output.length < 2) return true;

    const L = output[0];
    const R = output[1];
    const frames = L.length;
    const ch = this._channels;

    if (this._paused) {
      for (let i = 0; i < frames; i++) { L[i] = 0; R[i] = 0; }
      return true;
    }

    const availableFrames = Math.floor((this._writePos - this._readPos) / ch);
    // 空间化路径按 128 帧量子走，多出来的下个量子再取
    const readable = ch === 2 ? Math.min(availableFrames, frames) : Math.min(availableFrames, frames, 128);

    if (ch === 2) {
      let pos = this._readPos;
      for (let i = 0; i < readable; i++) {
        L[i] = this._buf[pos++];
        R[i] = this._buf[pos++];
      }
      for (let i = readable; i < frames; i++) { L[i] = 0; R[i] = 0; }
      this._readPos = pos;
    } else {
      // 反交织 → 空间化（或标准下混）→ 立体声
      const planar = this._planar;
      const spatial = this._spatial;
      const useSpatial = !!(spatial && spatial.active);

      let pos = this._readPos;
      for (let i = 0; i < readable; i++) {
        for (let c = 0; c < ch; c++) planar[c][i] = this._buf[pos++];
      }
      this._readPos = pos;

      // 欠载 / 流末尾（readable = 0）不调用引擎：0 帧没有意义，
      // 而且引擎里 _adapt 要除以帧数。输出走下面的清零分支即可。
      if (readable > 0) {
        if (useSpatial) spatial.process(planar, readable, this._outL, this._outR);
        else if (spatial) spatial.downmixBypass(planar, readable, this._outL, this._outR, ch);
        else for (let i = 0; i < readable; i++) { this._outL[i] = 0; this._outR[i] = 0; }
        for (let i = 0; i < readable; i++) { L[i] = this._outL[i]; R[i] = this._outR[i]; }
      }
      for (let i = readable; i < frames; i++) { L[i] = 0; R[i] = 0; }
      let lp = 0;
      for (let i = 0; i < readable; i++) lp = Math.max(lp, Math.abs(L[i]), Math.abs(R[i]));
      this._lastPeak = lp;
    }

    this._consumedFrames += readable;
    this._reportInterval += readable;

    if (this._reportInterval >= 2205) {
      this.port.postMessage({ type: 'position', consumedFrames: this._consumedFrames - this._baseline });
      this._reportInterval = 0;
    }

    if (this._ended && (this._writePos - this._readPos) === 0) {
      this.port.postMessage({ type: 'ended' });
      this._ended = false;
    }

    if (this._flowPaused && (this._writePos - this._readPos) < this._lowWater) {
      this._flowPaused = false;
      this.port.postMessage({ type: 'flow_resume' });
    }

    return true;
  }
}

// 旁路（空间化关闭）走 SpatialCore.downmixBypass：由声道角色决定系数，
// 与 ffmpeg 默认 -ac 2 同口径，A/B 才有可比性。

registerProcessor('streaming-pcm-processor', StreamingPCMProcessor);
