'use strict';

const assert = require('node:assert/strict');
const Planner = require('../../web/automix_planner.js');
const Stretch = require('../../web/time_stretch.js');

function sine(seconds, hz, sr) {
  const out = new Float32Array(Math.round(seconds * sr) * 2);
  for (let i = 0; i < out.length / 2; i++) out[i * 2] = out[i * 2 + 1] = Math.sin(2 * Math.PI * hz * i / sr);
  return out;
}
function frequency(pcm, sr) {
  let crossings = 0;
  for (let i = 2; i < pcm.length; i += 2) if (pcm[i - 2] <= 0 && pcm[i] > 0) crossings++;
  return crossings / (pcm.length / 2 / sr);
}
function profile(id, bpm) {
  const times = Array.from({ length: 96 }, (_, i) => i * 60000 / bpm);
  return {
    trackId: id, title: id, durationMs: 60000,
    tempo: { primary: bpm, confidence: 0.95, candidates: [{ bpm, weight: 1 }] },
    beats: { timesMs: times, beatsPerBar: 4, phraseBeats: 16, confidence: 0.95, phraseConfidence: 0.95, meterConfidence: 0.95 },
    flags: { keyUsable: false, vocalConfidence: 0.2, transientConfidence: 0.5 },
    frames: { hopMs: 1000, rmsDb: Array(60).fill(-12), vocal: Array(60).fill(0.1), lowRatio: Array(60).fill(0.2), transient: Array(60).fill(0.2) },
    segments: [{ startMs: 0, endMs: 10000, type: 'intro', confidence: 0.8 }, { startMs: 10000, endMs: 60000, type: 'verse', confidence: 0.8 }],
  };
}

const input = sine(4, 440, 48000);
const stretched = Stretch.stretchInterleaved(input, 2, 1.10);
assert(Math.abs(stretched.length / 2 - input.length / 2 / 1.10) < 2000, 'WSOLA duration target');
assert(Math.abs(frequency(stretched, 48000) - 440) < 8, 'WSOLA pitch stability');

const plan = Planner.plan(profile('a', 100), profile('b', 110), { nextStreaming: false });
assert(plan.v >= 5, 'planner version upgraded');
assert(plan.tempoProcessor === 'soundtouch-wsola' || plan.ratio === 1, 'explicit tempo processor contract');
assert(plan.crossfadeDurationMs <= 44000, '44 second supported maximum');
assert(plan.reason && plan.reason.topCandidates && plan.reason.topCandidates.length > 1, 'multiple candidates compared');
assert(!plan.reason.rejectedCandidates.some((x) => x.why.includes('rate_capability_exceeded')), 'old 3% rejection removed');
console.log(JSON.stringify({ pass: true, strategy: plan.strategy, ratio: plan.ratio, durationMs: plan.durationMs, pitchHz: frequency(stretched, 48000), outputFrames: stretched.length / 2 }, null, 2));
