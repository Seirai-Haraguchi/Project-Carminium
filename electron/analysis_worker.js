'use strict';
/*
 * 分析线程（worker_threads）：ffmpeg 分块取 PCM → 增量特征 → TrackProfile。
 *
 * 为什么放主进程而不是渲染进程的 Web Worker：
 * 1) 窗口用 loadFile() 加载（file:// 源），`new Worker('...')` 会被 CORS 拦掉；
 * 2) 解码与分析都在主进程侧，渲染进程只发一个「给我 profile」的 IPC，不搬运几十 MB PCM；
 * 3) 这个线程崩了/卡了也不影响 UI 与音频线程。
 *
 * 内存：ffmpeg 一次只吐 45 秒单声道 f32（≈4MB），分析器增量处理，峰值不随曲长增长。
 */
const { parentPort } = require('worker_threads');
const path = require('path');

const { AnalysisSource, SR, CHUNK_SEC } = require('./analysis_source');
const FE = require(path.join(__dirname, '..', 'web', 'analysis', 'frontend.js'));
const PIPE = require(path.join(__dirname, '..', 'web', 'analysis', 'analyzer.js'));

let source = null;

async function run(msg) {
  const { id, filePath, meta, ffmpegPath, maxMs } = msg;
  if (!source || source._ffmpeg !== ffmpegPath) source = new AnalysisSource(ffmpegPath);

  const t0 = Date.now();
  const analyzer = new PIPE.Analyzer(meta || {});
  const limitSec = Math.min((maxMs || 20 * 60 * 1000) / 1000, 20 * 60);

  // 单进程流式：一次 ffmpeg，边解边喂（实测比"每 45s 起一个进程"快 5–10 倍）
  const { fedSamples } = await source.stream(filePath, (f32) => analyzer.push(f32), { maxSec: limitSec });
  if (!fedSamples) throw new Error('no audio decoded');

  // limitMs 传给 finish：实解时长触到上限说明文件被截断，
  // 尾部静音证据作废（profile.edges.tailKnown=false）。
  const profile = analyzer.finish({ limitMs: limitSec * 1000 });
  profile.sampleRate = SR;
  profile.dspMs = profile.costMs;
  profile.costMs = Date.now() - t0;      // 整条链路（解码 + 特征 + 汇总），缓存预算按这个算
  return profile;
}

parentPort.on('message', async (msg) => {
  if (!msg || msg.type !== 'analyze') return;
  try {
    const profile = await run(msg);
    parentPort.postMessage({ id: msg.id, profile: profile });
  } catch (e) {
    parentPort.postMessage({ id: msg.id, error: (e && e.message) || String(e) });
  }
});

// 让主线程知道线程已就绪
parentPort.postMessage({ id: '__ready' });
