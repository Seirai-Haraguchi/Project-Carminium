'use strict';
/*
 * 端到端验收：主进程分析服务（worker_thread + ffmpeg 分块）→ TrackProfile。
 * 不依赖 Electron / SQLite（store=null），只验证真实链路。
 * 用法: node scripts/bench/verify_service.js
 */
const path = require('path');
const fs = require('fs');
const http = require('http');

const ROOT = path.resolve(__dirname, '..', '..');
const { AnalysisService } = require(path.join(ROOT, 'electron', 'analysis_service.js'));
const PIPE = require(path.join(ROOT, 'web', 'analysis', 'analyzer.js'));

const FFMPEG = path.join(ROOT, 'electron', 'bin', 'win32', 'ffmpeg.exe');
const FILES = [
  ['HOYO-MiX - 垂泪之时 Lacrimosa.mp3', 65],
  ['PIKASONIC - Blossom.flac', 180],
  ["Red (Taylor's Version)\\Taylor Swift - All Too Well (10 Minute Version) (Taylor's Version) (From The Vault).mp3", 613],
].map(([rel, sec]) => ({ file: path.join('j:\\Users\\rezen\\Music', rel), sec }));

(async () => {
  const svc = new AnalysisService({
    store: null,
    ffmpegPath: FFMPEG,
    version: PIPE.PROFILE_VERSION,
    log: (m) => console.log('[svc] ' + m),
  });
  console.log('available:', svc.available);

  let failures = 0;
  for (const f of FILES) {
    if (!fs.existsSync(f.file)) { console.log('SKIP', f.file); continue; }
    const t0 = Date.now();
    const p = await svc.analyze('bench_' + f.sec, f.file, {
      title: path.basename(f.file), durationMs: f.sec * 1000, hash: 'bench',
    });
    const wall = Date.now() - t0;
    if (!p) { console.log('FAILED', f.file); failures++; continue; }
    if (p.v !== PIPE.PROFILE_VERSION || !Array.isArray(p.frames.lowRatio) || !Array.isArray(p.frames.transient)) failures++;
    console.log(
      `${String(Math.round(p.durationMs / 1000)).padStart(4)}s  wall=${String(wall).padStart(5)}ms  ` +
      `inner=${String(p.costMs).padStart(4)}ms  v=${p.v} bpm=${p.tempo.primary} conf=${p.tempo.confidence}  ` +
      `beats=${p.beats.timesMs.length} bar=${p.beats.beatsPerBar} phrase=${p.beats.phraseBeats}  ` +
      `segs=${p.segments.length} exits=${p.mixPoints.exits.length} entries=${p.mixPoints.entries.length}  ` +
      `key=${p.key.name}(${p.key.confidence}) low=${p.frames.lowRatio[Math.floor(p.frames.lowRatio.length / 2)]}  ` +
      `json=${Math.round(JSON.stringify(p).length / 1024)}KB`
    );
  }

  // HTTP 流式输入：验证 ffmpeg 能从可播 URL 分析，而不是只接受本地路径。
  // 这不是 Subsonic 鉴权链路，后者仍需真实服务器复测。
  const httpFile = FILES.find((f) => fs.existsSync(f.file) && f.sec === 180);
  if (httpFile) {
    const server = http.createServer((req, res) => {
      const stat = fs.statSync(httpFile.file);
      const range = /bytes=(\d+)-(\d*)/.exec(req.headers.range || '');
      if (range) {
        const start = Number(range[1]);
        const end = range[2] ? Number(range[2]) : stat.size - 1;
        res.writeHead(206, {
          'Content-Range': `bytes ${start}-${end}/${stat.size}`,
          'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1,
        });
        fs.createReadStream(httpFile.file, { start, end }).pipe(res);
      } else {
        res.writeHead(200, { 'Content-Length': stat.size, 'Content-Type': 'audio/flac' });
        fs.createReadStream(httpFile.file).pipe(res);
      }
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const port = server.address().port;
    const url = `http://127.0.0.1:${port}/stream.flac`;
    try {
      const p = await svc.analyze('bench_http', url, {
        title: 'http-stream', durationMs: httpFile.sec * 1000, hash: 'bench_http',
      });
      if (!p || p.v !== 3 || !p.beats.timesMs.length) {
        failures++;
        console.log('HTTP FAILED', url);
      } else {
        console.log(`HTTP OK  bpm=${p.tempo.primary} conf=${p.tempo.confidence} beats=${p.beats.timesMs.length} ` +
          `entryCandidates=${p.mixPoints.entries.length}`);
      }
    } finally {
      server.close();
    }
  }

  console.log('stats:', JSON.stringify(svc.stats()));
  console.log(failures ? `FAIL ${failures} 项` : 'PASS 本地 + HTTP 分析与 profile v3');
  svc.dispose();
  setTimeout(() => process.exit(failures ? 1 : 0), 300);
})();
