'use strict';
/*
 * 真实 Subsonic 分析链路冒烟（Electron 主进程 + worker_thread + ffmpeg）。
 * 不打印流 URL/凭据。用法：
 *   NODE_PATH=<workbuddy ws> node scripts/bench/smoke_subsonic.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const WS = require('ws');
const Database = require('better-sqlite3');

const ROOT = path.resolve(__dirname, '..', '..');
const ELECTRON = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe');
const PORT = 9338;
const SRC_DATA = path.join(process.env.APPDATA, 'Project Carminium');

function sourceTrack() {
  const db = new Database(path.join(SRC_DATA, 'library.db'), { readonly: true });
  try {
    const cfg = db.prepare('select * from subsonic_sources order by id limit 1').get();
    const tr = db.prepare("select * from tracks where source='subsonic' order by duration_ms desc limit 1").get();
    if (!cfg || !tr) throw new Error('no subsonic track');
    const { SubsonicClient } = require(path.join(ROOT, 'electron', 'subsonic.js'));
    const client = new SubsonicClient(cfg.server_url, cfg.username, cfg.password,
      cfg.protocol_mode || 'subsonic', 60);
    return {
      track: tr,
      url: client._buildUrl('stream', { id: tr.subsonic_id, maxBitRate: 0 }),
      server: cfg.name,
    };
  } finally { db.close(); }
}

function prep() {
  const dir = path.join(os.tmpdir(), 'carminium-smoke-subsonic');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  for (const f of ['settings.json', 'library.db', 'library.db-wal', 'library.db-shm']) {
    const src = path.join(SRC_DATA, f);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(dir, f));
  }
  const sp = path.join(dir, 'settings.json');
  let s = {};
  try { s = JSON.parse(fs.readFileSync(sp, 'utf8')); } catch {  }
  s.volume = 0;
  s.wasapi_exclusive = false;
  s.automix = true;
  s.resume_playback = false;
  s.onboarding_complete = true;
  fs.writeFileSync(sp, JSON.stringify(s, null, 2));
  return dir;
}

class CDP {
  constructor(url) {
    this.ws = new WS(url, { perMessageDeflate: false });
    this.id = 0; this.pending = new Map(); this.logs = [];
    this.ws.on('message', (raw) => {
      let m; try { m = JSON.parse(raw.toString()); } catch { return; }
      if (m.id && this.pending.has(m.id)) {
        const p = this.pending.get(m.id); this.pending.delete(m.id);
        if (m.error) p.reject(new Error(JSON.stringify(m.error))); else p.resolve(m.result);
      } else if (m.method === 'Runtime.exceptionThrown') {
        const d = m.params.exceptionDetails || {};
        this.logs.push((d.exception && d.exception.description) || d.text || 'exception');
      }
    });
  }
  ready() { return new Promise((res, rej) => { this.ws.on('open', res); this.ws.on('error', rej); }); }
  send(method, params) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      this.pending.set(id, { resolve: res, reject: rej });
      this.ws.send(JSON.stringify({ id, method, params: params || {} }));
      setTimeout(() => { if (this.pending.delete(id)) rej(new Error('CDP timeout')); }, 120000);
    });
  }
  async eval(expression) {
    const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text);
    return r.result && r.result.value;
  }
}

(async () => {
  const src = sourceTrack();
  const userData = prep();
  const env = Object.assign({}, process.env);
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.NODE_OPTIONS;
  const child = spawn(ELECTRON, ['.', `--remote-debugging-port=${PORT}`, `--user-data-dir=${userData}`,
    '--no-sandbox', '--disable-gpu', '--disable-gpu-compositing', '--disable-software-rasterizer'],
    { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  const logPath = path.join(__dirname, 'smoke_subsonic.log');
  const log = fs.createWriteStream(logPath, { flags: 'w' });
  child.stdout.pipe(log); child.stderr.pipe(log);
  let cdp;
  try {
    let wsUrl = null;
    for (let i = 0; i < 120 && !wsUrl; i++) {
      try {
        const list = await fetch(`http://localhost:${PORT}/json/list`).then((r) => r.json());
        const page = list.find((t) => t.type === 'page' && /index\.html/.test(t.url));
        if (page) wsUrl = page.webSocketDebuggerUrl;
      } catch {  }
      if (!wsUrl) await new Promise((r) => setTimeout(r, 500));
    }
    if (!wsUrl) throw new Error('CDP target not found');
    cdp = new CDP(wsUrl);
    await cdp.ready();
    await cdp.send('Runtime.enable');
    await new Promise((r) => setTimeout(r, 2500));
    const payload = JSON.stringify({
      id: 'smoke_' + src.track.id, title: src.track.title, filePath: src.url, path: src.url,
      duration_ms: src.track.duration_ms, file_size: src.track.file_size,
      suffix: src.track.suffix, source: 'subsonic',
    });
    const result = await cdp.eval(`(async()=>{
      const t = ${payload};
      const p = await window.App.profileClient.ensure(t, { force: true });
      return p ? {
        ok: true, v: p.v, durationMs: p.durationMs, bpm: p.tempo.primary,
        confidence: p.tempo.confidence, beats: p.beats.timesMs.length,
        segments: p.segments.length, lowRatio: p.frames && p.frames.lowRatio.length,
        transient: p.frames && p.frames.transient.length,
        entries: p.mixPoints.entries.length, exits: p.mixPoints.exits.length
      } : { ok: false, stats: await window.App.profileClient.profileStats() };
    })()`);
    const out = {
      server: src.server, title: src.track.title, result,
      stats: await cdp.eval('window.App.profileClient.profileStats()'),
      exceptions: cdp.logs.slice(0, 10),
    };
    fs.writeFileSync(path.join(__dirname, 'smoke_subsonic_result.json'), JSON.stringify(out, null, 2));
    console.log(JSON.stringify(out, null, 2));
    if (!result.ok) process.exitCode = 1;
  } catch (e) {
    console.error('SMOKE FAILED:', e.message);
    process.exitCode = 1;
  } finally {
    if (cdp) { try { cdp.ws.close(); } catch {  } }
    try { child.kill(); } catch {  }
    log.end();
    await new Promise((r) => setTimeout(r, 800));
  }
})();
