/**
 * OutputCaptureProcessor
 *
 * 捕获 Web Audio API 图的最终混合输出，累积到 ~100ms 块后
 * 通过 MessagePort 发送到主线程（renderer → main → DLL → WASAPI）。
 *
 * 输入：来自 Web Audio 图的 planar Float32 音频
 * 输出：静音（fill 0）— 必须 connect(destination) 以保持音频图活跃，
 *       但输出静音避免与 DLL → WASAPI 产生双重声音。
 * 副作用：通过 port.postMessage 发送 interleaved f32 ArrayBuffer
 */
class OutputCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();

    // 目标 ~100ms 的累积缓冲（44100Hz × 2ch × 0.1s = 4410 samples）
    // 块越小 → DLL 环形缓冲水位锯齿越小、单块转发阻塞影响越小，
    // 对 gapless 切歌瞬间的欠载更友好。IPC 频率 10/s，开销可忽略。
    this._accum = new Float32Array(4410 * 2); // interleaved stereo
    this._accumPos = 0;
    this._channels = 2;

    // 主线程 → 处理器 控制消息
    this.port.onmessage = (e) => this._onControl(e.data);
  }

  _onControl(msg) {
    if (msg.type === 'clear') {
      this._accumPos = 0;
    }
  }

  process(inputs, outputs /* , parameters */) {
    const input = inputs[0];
    const output = outputs[0];

    // 捕获输入音频 → 累积 → 发送到主线程（IPC → DLL → WASAPI）
    if (input && input.length > 0 && input[0].length > 0) {
      const frames = input[0].length;
      const ch = Math.min(input.length, this._channels);
      const L = input[0];
      const R = ch >= 2 ? input[1] : input[0]; // mono → 复制左声道

      for (let i = 0; i < frames; i++) {
        this._accum[this._accumPos++] = L[i];
        this._accum[this._accumPos++] = R[i];

        // 累积满 → 发送
        if (this._accumPos >= this._accum.length) {
          const copy = new ArrayBuffer(this._accum.byteLength);
          new Float32Array(copy).set(this._accum);
          this.port.postMessage(copy, [copy]); // transferable
          this._accumPos = 0;
        }
      }
    }

    // 输出静音：实际音频由 DLL → WASAPI 负责，
    // 此处仅保持音频图活跃使 process() 被持续调用。
    if (output && output.length > 0) {
      for (let ch = 0; ch < output.length; ch++) {
        output[ch].fill(0);
      }
    }

    return true;
  }
}

registerProcessor('output-capture-processor', OutputCaptureProcessor);
