class OutputCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();

    this._accum = new Float32Array(4410 * 2);
    this._accumPos = 0;
    this._channels = 2;

    this.port.onmessage = (e) => this._onControl(e.data);
  }

  _onControl(msg) {
    if (msg.type === 'clear') {
      this._accumPos = 0;
    }
  }

  process(inputs, outputs ) {
    const input = inputs[0];
    const output = outputs[0];

    if (input && input.length > 0 && input[0].length > 0) {
      const frames = input[0].length;
      const ch = Math.min(input.length, this._channels);
      const L = input[0];
      const R = ch >= 2 ? input[1] : input[0];

      for (let i = 0; i < frames; i++) {
        this._accum[this._accumPos++] = L[i];
        this._accum[this._accumPos++] = R[i];

        if (this._accumPos >= this._accum.length) {
          const copy = new ArrayBuffer(this._accum.byteLength);
          new Float32Array(copy).set(this._accum);
          this.port.postMessage(copy, [copy]);
          this._accumPos = 0;
        }
      }
    }

    if (output && output.length > 0) {
      for (let ch = 0; ch < output.length; ch++) {
        output[ch].fill(0);
      }
    }

    return true;
  }
}

registerProcessor('output-capture-processor', OutputCaptureProcessor);
