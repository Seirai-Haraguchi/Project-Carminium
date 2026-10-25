'use strict';
/*
 * 分析 Worker：渲染进程里的后台线程。主线程只负责取 PCM 分块并转发，计算全在这里。
 * 与主线程的协议：
 *   ← { type:'start', id, meta }
 *   ← { type:'chunk', id, samples: ArrayBuffer }   （transfer，避免拷贝）
 *   ← { type:'end', id }
 *   ← { type:'cancel', id }
 *   → { type:'done', id, profile }
 *   → { type:'error', id, message }
 */
/* global importScripts, AnalyzerPipeline */
importScripts('frontend.js', 'rhythm.js', 'analyzer.js');

var jobs = new Map();

self.onmessage = function (e) {
  var m = e.data;
  if (!m || !m.type) return;

  try {
    if (m.type === 'start') {
      jobs.set(m.id, new AnalyzerPipeline.Analyzer(m.meta || {}));
      return;
    }
    if (m.type === 'cancel') {
      jobs.delete(m.id);
      return;
    }
    if (m.type === 'chunk') {
      var job = jobs.get(m.id);
      if (!job) return;
      job.push(new Float32Array(m.samples));
      return;
    }
    if (m.type === 'end') {
      var j = jobs.get(m.id);
      if (!j) return;
      jobs.delete(m.id);
      var profile = j.finish();
      self.postMessage({ type: 'done', id: m.id, profile: profile });
      return;
    }
  } catch (err) {
    jobs.delete(m.id);
    self.postMessage({ type: 'error', id: m.id, message: (err && err.message) || String(err) });
  }
};
