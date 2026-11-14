'use strict';

/*
 * Small allocation-bounded WSOLA processor used by AutoMix's offline/worker
 * path.  It is deliberately independent of WebAudio so it can also be used by
 * the benchmark harness. `tempo` is output speed relative to the source:
 * 1.10 consumes 10% more source per output second, without resampling pitch.
 * Stereo correlation is used for the overlap search, so the channels never
 * choose independent splice points.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.AutoMixTimeStretch = api;
})(typeof self !== 'undefined' ? self : this, function () {
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function hann(i, n) { return 0.5 - 0.5 * Math.cos(2 * Math.PI * i / Math.max(1, n - 1)); }

  function stretchInterleaved(input, channels, tempo, options) {
    if (!(input && input.length) || !(channels > 0)) return new Float32Array(0);
    tempo = clamp(Number(tempo) || 1, 0.5, 1.5);
    options = options || {};
    var window = options.windowFrames || 2048;
    var overlap = options.overlapFrames || Math.round(window * 0.5);
    var hopOut = Math.max(1, window - overlap);
    var hopIn = Math.max(1, Math.round(hopOut * tempo));
    var search = options.searchFrames || Math.round(window * 0.12);
    var frames = Math.floor(input.length / channels);
    var outputFrames = Math.max(1, Math.round(frames / tempo));
    var out = new Float32Array((outputFrames + window) * channels);
    var norm = new Float32Array(outputFrames + window);
    var outPos = 0, inPos = 0, first = true;
    while (outPos < outputFrames && inPos < frames) {
      var best = clamp(inPos, 0, Math.max(0, frames - window));
      if (!first) {
        var expected = clamp(inPos, 0, Math.max(0, frames - window));
        var from = Math.max(0, expected - search), to = Math.min(frames - window, expected + search);
        var bestScore = -Infinity;
        for (var p = from; p <= to; p += 1) {
          var score = 0;
          for (var j = 0; j < overlap; j += 8) {
            var a = outPos + j, b = p + j;
            if (a >= outputFrames + window || b >= frames) break;
            for (var ch = 0; ch < channels; ch++) {
              score += out[a * channels + ch] * input[b * channels + ch];
            }
          }
          if (score > bestScore) { bestScore = score; best = p; }
        }
      }
      var count = Math.min(window, frames - best, out.length / channels - outPos);
      for (var i = 0; i < count; i++) {
        var w = first ? 1 : hann(i < overlap ? i : overlap, overlap);
        norm[outPos + i] += w;
        for (var c = 0; c < channels; c++) out[(outPos + i) * channels + c] += input[(best + i) * channels + c] * w;
      }
      first = false;
      outPos += hopOut;
      inPos = best + hopIn;
    }
    var result = new Float32Array(outputFrames * channels);
    for (var f = 0; f < outputFrames; f++) {
      var n = norm[f] || 1;
      for (var cc = 0; cc < channels; cc++) result[f * channels + cc] = out[f * channels + cc] / n;
    }
    return result;
  }

  return { stretchInterleaved: stretchInterleaved, algorithm: 'wsola-stereo-coherent-v1' };
});
