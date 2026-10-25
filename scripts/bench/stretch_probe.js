'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { performance } = require('node:perf_hooks');

const ROOT = path.resolve(__dirname, '..', '..');
const FFMPEG = path.join(ROOT, 'electron', 'bin', 'win32', 'ffmpeg.exe');
const OUTPUT = path.join(__dirname, 'stretch_probe_result.json');
const SAMPLE_RATE = 48000;
const CHANNELS = 2;
const SOURCE_SECONDS = 30;
const SYNTHETIC_SECONDS = 4;
const RATIOS = [0.97, 1.03, 0.90, 1.10];
const SAMPLES = [
  { id: 'blossom', path: 'j:/Users/rezen/Music/PIKASONIC - Blossom.flac' },
  { id: 'breed', path: 'j:/Users/rezen/Music/Nirvana - Breed.mp3' },
];

function round(value, digits = 6) {
  const scale = 10 ** digits;
  return Math.round((value + Number.EPSILON) * scale) / scale;
}

function runFfmpeg(args) {
  const started = performance.now();
  const result = spawnSync(FFMPEG, [
    '-hide_banner', '-loglevel', 'error', '-nostdin',
    ...args,
    '-map', '0:a:0', '-vn', '-sn', '-dn',
    '-ac', String(CHANNELS), '-ar', String(SAMPLE_RATE),
    '-c:a', 'pcm_f32le', '-f', 'wav', 'pipe:1',
  ], {
    encoding: null,
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
  });
  const wallSeconds = (performance.now() - started) / 1000;
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`ffmpeg exited ${result.status}: ${result.stderr.toString('utf8')}`);
  }
  return { wav: result.stdout, wallSeconds };
}

function decodeAndMeasure(wav, wallSeconds, expectedDuration) {
  if (wav.toString('ascii', 0, 4) !== 'RIFF' || wav.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('Expected RIFF/WAVE output');
  }

  let format;
  let dataOffset;
  let dataSize;
  for (let offset = 12; offset + 8 <= wav.length;) {
    const id = wav.toString('ascii', offset, offset + 4);
    const size = wav.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === 'data' && (size === 0xFFFFFFFF || body + size > wav.length)) {
      dataOffset = body;
      dataSize = wav.length - body;
      break;
    }
    if (body + size > wav.length) throw new Error(`Truncated WAV chunk: ${id}`);
    if (id === 'fmt ') {
      format = {
        encoding: wav.readUInt16LE(body),
        channels: wav.readUInt16LE(body + 2),
        sampleRate: wav.readUInt32LE(body + 4),
        blockAlign: wav.readUInt16LE(body + 12),
        bitsPerSample: wav.readUInt16LE(body + 14),
      };
    } else if (id === 'data') {
      dataOffset = body;
      dataSize = size;
    }
    offset = body + size + (size % 2);
  }

  if (!format || dataOffset === undefined) throw new Error('Missing WAV fmt or data chunk');
  if (![3, 65534].includes(format.encoding) || format.bitsPerSample !== 32) {
    throw new Error(`Expected 32-bit float PCM, got format ${format.encoding}/${format.bitsPerSample}`);
  }
  if (format.channels !== CHANNELS || format.sampleRate !== SAMPLE_RATE) {
    throw new Error('Unexpected output channel count or sample rate');
  }

  const frames = Math.floor(dataSize / format.blockAlign);
  const sampleCount = frames * format.channels;
  const samples = new Float32Array(sampleCount);
  let peak = 0;
  let squareSum = 0;
  let nonFiniteCount = 0;
  let silentCount = 0;
  let nearSilentCount = 0;
  let fullScaleCount = 0;

  for (let index = 0; index < sampleCount; index += 1) {
    const value = wav.readFloatLE(dataOffset + index * 4);
    samples[index] = value;
    if (!Number.isFinite(value)) {
      nonFiniteCount += 1;
      continue;
    }
    const magnitude = Math.abs(value);
    peak = Math.max(peak, magnitude);
    squareSum += value * value;
    if (magnitude <= 1e-6) silentCount += 1;
    if (magnitude <= 1e-4) nearSilentCount += 1;
    if (magnitude >= 1) fullScaleCount += 1;
  }

  const duration = frames / format.sampleRate;
  const finiteCount = sampleCount - nonFiniteCount;
  const metrics = {
    wall_seconds: round(wallSeconds),
    relative_real_time_cost: round(wallSeconds / expectedDuration),
    real_time_speed_x: round(expectedDuration / wallSeconds),
    wall_per_output_second: round(wallSeconds / duration),
    output_duration_seconds: round(duration),
    expected_duration_seconds: round(expectedDuration),
    duration_error_seconds: round(duration - expectedDuration),
    absolute_duration_error_seconds: round(Math.abs(duration - expectedDuration)),
    output_frames: frames,
    sample_rate: format.sampleRate,
    channels: format.channels,
    peak: round(peak),
    rms: round(finiteCount ? Math.sqrt(squareSum / finiteCount) : 0),
    silence_sample_ratio: round(sampleCount ? silentCount / sampleCount : 0),
    near_silence_sample_ratio: round(sampleCount ? nearSilentCount / sampleCount : 0),
    full_scale_sample_ratio: round(sampleCount ? fullScaleCount / sampleCount : 0),
    non_finite_sample_count: nonFiniteCount,
  };
  return { metrics, samples };
}

function estimateZeroCrossingFrequency(samples, channels, sampleRate) {
  const frames = Math.floor(samples.length / channels);
  const start = Math.floor(frames * 0.2);
  const end = Math.floor(frames * 0.8);
  const crossings = [];
  for (let frame = start + 1; frame < end; frame += 1) {
    const previous = samples[(frame - 1) * channels];
    const current = samples[frame * channels];
    if (previous <= 0 && current > 0 && current !== previous) {
      const fraction = -previous / (current - previous);
      crossings.push((frame - 1 + fraction) / sampleRate);
    }
  }
  if (crossings.length < 2) throw new Error('Not enough positive zero crossings');
  return (crossings.length - 1) / (crossings.at(-1) - crossings[0]);
}

function sourceArgs(sample, seconds) {
  if (sample.synthetic) {
    return ['-f', 'lavfi', '-i', `sine=frequency=220:sample_rate=${SAMPLE_RATE}:duration=${seconds}`];
  }
  return ['-ss', '0', '-t', String(seconds), '-i', sample.path];
}

function measure(sample, seconds, filter, expectedDuration) {
  const { wav, wallSeconds } = runFfmpeg([
    ...sourceArgs(sample, seconds), '-af', filter,
  ]);
  return decodeAndMeasure(wav, wallSeconds, expectedDuration);
}

function realSampleRuns(sample) {
  const baselineResult = measure(sample, SOURCE_SECONDS, 'anull', SOURCE_SECONDS);
  const runs = [];
  for (const ratio of RATIOS) {
    const resamplingExpected = SOURCE_SECONDS / ratio;
    const resampling = measure(
      sample,
      SOURCE_SECONDS,
      `asetrate=${SAMPLE_RATE}*${ratio},aresample=${SAMPLE_RATE}`,
      resamplingExpected,
    );
    runs.push({
      method: 'playbackRate_resampling_proxy',
      ratio,
      playback_rate: ratio,
      actual_content_speed_ratio: ratio,
      filter: `asetrate=${SAMPLE_RATE}*${ratio},aresample=${SAMPLE_RATE}`,
      expected_pitch_hz_for_220hz_input: round(220 * ratio, 3),
      metrics: resampling.metrics,
    });

    // This is the requested mapping. FFmpeg defines atempo as the actual speed,
    // so its expected duration is SOURCE_SECONDS * ratio, not / ratio.
    const atempo = 1 / ratio;
    const atempoExpected = SOURCE_SECONDS / atempo;
    const stretched = measure(sample, SOURCE_SECONDS, `atempo=${atempo}`, atempoExpected);
    runs.push({
      method: 'ffmpeg_atempo',
      ratio,
      atempo_parameter: round(atempo, 9),
      requested_parameter_rule: '1/ratio',
      actual_content_speed_ratio: round(atempo, 9),
      atempo_required_for_content_speed_ratio: ratio,
      filter: `atempo=${atempo}`,
      expected_pitch_hz_for_220hz_input: 220,
      metrics: stretched.metrics,
      comparison_with_playbackRate_ratio: {
        requested_assumption_verified: false,
        playbackRate_target_duration_seconds: round(resamplingExpected),
        duration_minus_playbackRate_target_seconds: round(
          stretched.metrics.output_duration_seconds - resamplingExpected,
        ),
        note: 'atempo=1/ratio produces speed 1/ratio; use atempo=ratio to match playbackRate=ratio.',
      },
    });
  }
  return {
    id: sample.id,
    path: sample.path,
    trim: { start_seconds: 0, requested_duration_seconds: SOURCE_SECONDS },
    baseline: baselineResult.metrics,
    runs,
  };
}

function syntheticRuns() {
  const sample = { id: 'synthetic_220hz', synthetic: true };
  const baselineResult = measure(sample, SYNTHETIC_SECONDS, 'anull', SYNTHETIC_SECONDS);
  const baselineFrequency = estimateZeroCrossingFrequency(
    baselineResult.samples, CHANNELS, SAMPLE_RATE,
  );
  const runs = [];
  for (const ratio of RATIOS) {
    const resamplingExpected = SYNTHETIC_SECONDS / ratio;
    const resampling = measure(
      sample,
      SYNTHETIC_SECONDS,
      `asetrate=${SAMPLE_RATE}*${ratio},aresample=${SAMPLE_RATE}`,
      resamplingExpected,
    );
    const resamplingFrequency = estimateZeroCrossingFrequency(
      resampling.samples, CHANNELS, SAMPLE_RATE,
    );
    runs.push({
      method: 'resampling',
      ratio,
      expected_frequency_hz: round(220 * ratio),
      positive_zero_crossing_frequency_hz: round(resamplingFrequency, 3),
      frequency_error_hz: round(resamplingFrequency - 220 * ratio, 3),
      output_duration_seconds: resampling.metrics.output_duration_seconds,
      non_finite_sample_count: resampling.metrics.non_finite_sample_count,
    });

    const atempo = 1 / ratio;
    const atempoExpected = SYNTHETIC_SECONDS / atempo;
    const stretched = measure(sample, SYNTHETIC_SECONDS, `atempo=${atempo}`, atempoExpected);
    const stretchedFrequency = estimateZeroCrossingFrequency(
      stretched.samples, CHANNELS, SAMPLE_RATE,
    );
    runs.push({
      method: 'ffmpeg_atempo',
      ratio,
      atempo_parameter: round(atempo, 9),
      expected_frequency_hz: 220,
      positive_zero_crossing_frequency_hz: round(stretchedFrequency, 3),
      frequency_error_hz: round(stretchedFrequency - 220, 3),
      output_duration_seconds: stretched.metrics.output_duration_seconds,
      duration_error_seconds: stretched.metrics.duration_error_seconds,
      non_finite_sample_count: stretched.metrics.non_finite_sample_count,
    });
  }
  return {
    generator: `ffmpeg lavfi sine=frequency=220:sample_rate=${SAMPLE_RATE}:duration=${SYNTHETIC_SECONDS}`,
    baseline_frequency_hz: round(baselineFrequency, 3),
    analysis: 'Positive-going zero crossings over the middle 60% of channel 0; edge regions excluded.',
    runs,
  };
}

function assertEnvironment() {
  if (!fs.existsSync(FFMPEG)) throw new Error(`Missing ffmpeg: ${FFMPEG}`);
  for (const sample of SAMPLES) {
    if (!fs.existsSync(sample.path)) throw new Error(`Missing local sample: ${sample.path}`);
  }
}

function main() {
  assertEnvironment();
  const versionResult = spawnSync(FFMPEG, ['-version'], { encoding: 'utf8', windowsHide: true });
  if (versionResult.status !== 0) throw new Error('Unable to read ffmpeg version');

  const samples = SAMPLES.map(realSampleRuns);
  const synthetic = syntheticRuns();
  const realRuns = samples.flatMap((sample) => sample.runs);
  const atempoRuns = realRuns.filter((run) => run.method === 'ffmpeg_atempo');
  const resamplingRuns = realRuns.filter((run) => run.method === 'playbackRate_resampling_proxy');
  const syntheticAtempo = synthetic.runs.filter((run) => run.method === 'ffmpeg_atempo');
  const syntheticResampling = synthetic.runs.filter((run) => run.method === 'resampling');
  const max = (values) => Math.max(...values);

  const result = {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    runtime: {
      node: process.version,
      node_path: process.execPath,
      platform: process.platform,
      arch: process.arch,
      ffmpeg_path: FFMPEG,
      ffmpeg_version: versionResult.stdout.split(/\r?\n/)[0],
    },
    configuration: {
      ratios: RATIOS,
      source_seconds: SOURCE_SECONDS,
      output_sample_rate: SAMPLE_RATE,
      output_channels: CHANNELS,
      output_pcm: '32-bit float WAV analyzed in memory',
      timing: 'One ffmpeg process per case; includes process startup, decode, filter and WAV encode; excludes PCM analysis.',
      relative_real_time_cost_definition: 'wall_seconds / expected_output_duration_seconds',
    },
    ratio_semantics: {
      ratio: 'playbackRate/content-speed multiplier for the resampling proxy',
      playbackRate_output_duration: 'source_duration / ratio',
      requested_atempo_parameter: '1 / ratio',
      verified_atempo_behavior: 'atempo is the content-speed multiplier; output duration is source_duration / atempo = source_duration * ratio',
      correction_for_matching_playbackRate: 'atempo = ratio',
    },
    samples,
    synthetic_220hz: synthetic,
    summary: {
      real_case_count: realRuns.length,
      all_real_outputs_finite: realRuns.every((run) => run.metrics.non_finite_sample_count === 0),
      max_absolute_duration_error_seconds: {
        playbackRate_resampling_proxy: round(max(resamplingRuns.map(
          (run) => run.metrics.absolute_duration_error_seconds,
        ))),
        ffmpeg_atempo_against_atempo_1_over_ratio_expectation: round(max(atempoRuns.map(
          (run) => run.metrics.absolute_duration_error_seconds,
        ))),
      },
      max_absolute_mapping_error_seconds_against_playbackRate_target: round(max(atempoRuns.map(
        (run) => Math.abs(run.comparison_with_playbackRate_ratio.duration_minus_playbackRate_target_seconds),
      ))),
      max_wall_seconds: {
        playbackRate_resampling_proxy: round(max(resamplingRuns.map((run) => run.metrics.wall_seconds))),
        ffmpeg_atempo: round(max(atempoRuns.map((run) => run.metrics.wall_seconds))),
      },
      synthetic_220hz_max_absolute_frequency_error_hz: {
        ffmpeg_atempo_vs_220hz: round(max(syntheticAtempo.map(
          (run) => Math.abs(run.frequency_error_hz),
        )), 3),
        resampling_vs_220hz_times_ratio: round(max(syntheticResampling.map(
          (run) => Math.abs(run.frequency_error_hz),
        )), 3),
      },
      recommendation: 'Do not directly integrate into the product from this probe alone. atempo passed basic signal and synthetic-pitch checks, but listening artifacts, implementation lineage, product latency and seek/transition behavior remain unvalidated.',
    },
    limitations: [
      'FFmpeg atempo is evaluated only as FFmpeg atempo. Its implementation was not inspected or verified as WSOLA, and it is not claimed to equal a validated WSOLA implementation.',
      'No listening test was performed. Real-music audible artifacts and subjective pitch-preservation quality are unverified.',
      'The playbackRate cases are ideal resampling proxies, not measurements of Electron/HTMLMediaElement. Browser pitch behavior also depends on preservePitch settings; no product playback path was run or modified.',
      'The requested atempo=1/ratio mapping does not produce content speed ratio when ratio means playbackRate. Mapping mismatch is reported separately from codec/filter duration accuracy.',
      'Single-run wall-clock measurements include process startup and decoding, so they are not product in-process latency or statistically stable performance benchmarks.',
      'The synthetic zero-crossing test verifies narrowband pitch behavior for a steady 220Hz sine, not complex-music transient or timbre quality.',
      'No product integration, seek accuracy, gapless playback, transition behavior, memory use or long-running stability was tested.',
    ],
  };

  fs.writeFileSync(OUTPUT, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({
    output: OUTPUT,
    real_case_count: result.summary.real_case_count,
    all_real_outputs_finite: result.summary.all_real_outputs_finite,
    max_absolute_duration_error_seconds: result.summary.max_absolute_duration_error_seconds,
    max_absolute_mapping_error_seconds: result.summary.max_absolute_mapping_error_seconds_against_playbackRate_target,
    synthetic_220hz_max_absolute_frequency_error_hz: result.summary.synthetic_220hz_max_absolute_frequency_error_hz,
  }, null, 2));
}

main();
