class StreamingPCMProcessor extends AudioWorkletProcessor {
  constructor() {
    super();

    this._initialCapacity = 352800;
    this._buf = new Float32Array(this._initialCapacity);
    this._writePos = 0;
    this._readPos = 0;
    this._ended = false;

    this._highWatermark = 352800 * 5;
    this._lowWatermark = 352800 * 2;
    this._flowPaused = false;

    this._consumedFrames = 0;
    this._baseline = 0;
    this._reportInterval = 0;

    this._paused = false;

    this.port.onmessage = (e) => this._onMessage(e.data);
  }

  _onMessage(data) {
    switch (data.type) {
      case 'pcm': {
        const samples = new Float32Array(data.samples);
        this._append(samples);
        break;
      }
      case 'clear': {
        if (this._buf.length > this._initialCapacity) {
          this._buf = new Float32Array(this._initialCapacity);
        }
        this._readPos = 0;
        this._writePos = 0;
        this._ended = false;
        this._consumedFrames = 0;
        this._baseline = 0;
        this._reportInterval = 0;
        this._paused = false;
        this._flowPaused = false;
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
    }
  }

  _append(data) {
    const needed = data.length;
    const free = this._buf.length - this._writePos;

    if (needed > free) {
      const unread = this._writePos - this._readPos;
      if (unread > 0) {
        this._buf.copyWithin(0, this._readPos, this._writePos);
      }
      this._writePos = unread;
      this._readPos = 0;

      if (needed > this._buf.length - this._writePos) {
        const newCap = Math.max(this._buf.length * 2, this._writePos + needed);
        const newBuf = new Float32Array(newCap);
        newBuf.set(this._buf.subarray(0, this._writePos));
        this._buf = newBuf;
      }
    }

    this._buf.set(data, this._writePos);
    this._writePos += needed;

    const unreadAfter = this._writePos - this._readPos;
    if (!this._flowPaused && unreadAfter > this._highWatermark) {
      this._flowPaused = true;
      this.port.postMessage({ type: 'flow_pause' });
    }
  }

  process(inputs, outputs ) {
    const output = outputs[0];
    if (!output || output.length < 2) return true;

    const L = output[0];
    const R = output[1];
    const frames = L.length;

    if (this._paused) {
      for (let i = 0; i < frames; i++) {
        L[i] = 0;
        R[i] = 0;
      }
      return true;
    }

    const available = this._writePos - this._readPos;
    const readableFrames = Math.min(available >> 1, frames);

    let pos = this._readPos;
    for (let i = 0; i < readableFrames; i++) {
      L[i] = this._buf[pos++];
      R[i] = this._buf[pos++];
    }
    for (let i = readableFrames; i < frames; i++) {
      L[i] = 0;
      R[i] = 0;
    }
    this._readPos = pos;

    this._consumedFrames += readableFrames;
    this._reportInterval += readableFrames;

    if (this._reportInterval >= 2205) {
      this.port.postMessage({ type: 'position', consumedFrames: this._consumedFrames - this._baseline });
      this._reportInterval = 0;
    }

    if (this._ended && (this._writePos - this._readPos) === 0) {
      this.port.postMessage({ type: 'ended' });
      this._ended = false;
    }

    if (this._flowPaused && (this._writePos - this._readPos) < this._lowWatermark) {
      this._flowPaused = false;
      this.port.postMessage({ type: 'flow_resume' });
    }

    return true;
  }
}

registerProcessor('streaming-pcm-processor', StreamingPCMProcessor);
