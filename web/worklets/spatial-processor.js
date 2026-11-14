/*
 * 缓冲区路径的多声道空间化节点：N 声道进、立体声出。
 *
 * 流式解码那条路已经把空间化做在 streaming-pcm-processor 内部了；
 * 这个节点只服务 AudioBufferSourceNode（decodeAudioData 出来的 5.1/7.1 缓冲）。
 */
class SpatialProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const opt = (options && options.processorOptions) || {};
    this._engine = new SpatialCore.SpatialEngine({
      sampleRate: opt.sampleRate || sampleRate,
      channels: opt.channels || 0,
      layout: opt.layout || '',
      params: opt.params || {},
    });
    this._planar = [];
    for (let c = 0; c < this._engine.channels; c++) this._planar.push(new Float32Array(128));
    this._outL = new Float32Array(128);
    this._outR = new Float32Array(128);

    this.port.onmessage = (e) => {
      const msg = e.data || {};
      if (msg.type === 'params') this._engine.setParams(msg.params);
      else if (msg.type === 'reset') this._engine.reset();
    };
  }

  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];
    if (!output || output.length < 2) return true;

    const frames = output[0].length;
    const nch = input ? input.length : 0;

    if (!nch) {
      for (let c = 0; c < output.length; c++) output[c].fill(0);
      return true;
    }

    // 声道数比建节点时少（或输入不足）：按现有声道数降级处理
    if (nch !== this._engine.channels) {
      this._engine.configure(nch, this._engine.layoutName, true);
      this._planar = [];
      for (let c = 0; c < nch; c++) this._planar.push(new Float32Array(128));
    }

    const n = Math.min(frames, 128);
    for (let c = 0; c < nch; c++) this._planar[c].set(input[c].subarray ? input[c].subarray(0, n) : input[c], 0);

    if (this._engine.active) this._engine.process(this._planar, n, this._outL, this._outR);
    else this._engine.downmixBypass(this._planar, n, this._outL, this._outR, nch);

    const L = output[0], R = output[1];
    for (let i = 0; i < n; i++) { L[i] = this._outL[i]; R[i] = this._outR[i]; }
    for (let i = n; i < frames; i++) { L[i] = 0; R[i] = 0; }

    return true;
  }
}

registerProcessor('spatial-processor', SpatialProcessor);
