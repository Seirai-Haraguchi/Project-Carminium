'use strict';
/*
 * Electron 冒烟测试（CDP 手写驱动）：
 *  1. 用临时 userData 副本启动应用（不动用户真实设置/DB/音频设备）
 *  2. 检查新模块是否加载
 *  3. 走真实链路：App.profileClient.ensure() → 主进程 worker_thread → ffmpeg → profile → SQLite
 *  4. 用两个真实 profile 跑规划器
 *  5. 无音频设备（null sink）下真实播放并触发一次 EQ 交叉淡变，检查时钟与切歌
 *
 * 用法: NODE_PATH=<workbuddy ws> node scripts/bench/smoke_electron.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const WS = require('ws');

const ROOT = path.resolve(__dirname, '..', '..');
const ELECTRON = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe');
const SRC_DATA = path.join(process.env.APPDATA, 'Project Carminium');
const PORT = 9337;
const MUSIC = 'j:\\Users\\rezen\\Music';

const TRACK_A = { id: 'smoke_a', title: 'Blossom', file: path.join(MUSIC, 'PIKASONIC - Blossom.flac'), dur: 180000 };
const TRACK_B = { id: 'smoke_b', title: 'Otona', file: path.join(MUSIC, 'PIKASONIC - Otona !.flac'), dur: 120000 };

function prepareUserData() {
  const dir = path.join(os.tmpdir(), 'carminium-smoke');
  if (process.env.SMOKE_KEEP !== '1') fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  for (const f of ['settings.json', 'library.db', 'library.db-wal', 'library.db-shm']) {
    const src = path.join(SRC_DATA, f);
    const dst = path.join(dir, f);
    // SMOKE_KEEP=1 时要保留上一轮写入的 library.db（里面已经有 track_profiles），否则测不到缓存命中
    if (process.env.SMOKE_KEEP === '1' && fs.existsSync(dst)) continue;
    if (fs.existsSync(src)) fs.copyFileSync(src, dst);
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

function httpJson(url) {
  return fetch(url).then((r) => r.json());
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function connect() {
  for (let i = 0; i < 120; i++) {
    try {
      const list = await httpJson(`http://localhost:${PORT}/json/list`);
      const page = list.find((t) => t.type === 'page' && /index\.html/.test(t.url));
      if (page && page.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch {  }
    await sleep(500);
  }
  throw new Error('CDP target not found');
}

class CDP {
  constructor(url) {
    this.ws = new WS(url, { perMessageDeflate: false });
    this.id = 0;
    this.pending = new Map();
    this.logs = [];
    this.ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else resolve(msg.result);
      } else if (msg.method === 'Runtime.consoleAPICalled') {
        const text = (msg.params.args || []).map((a) => a.value != null ? String(a.value) : (a.description || '')).join(' ');
        this.logs.push('[' + msg.params.type + '] ' + text);
      } else if (msg.method === 'Runtime.exceptionThrown') {
        const d = msg.params.exceptionDetails || {};
        this.logs.push('[exception] ' + (d.exception && d.exception.description || d.text));
      }
    });
    this.ws.on('error', (e) => { this.logs.push('[ws error] ' + e.message); });
  }
  ready() {
    return new Promise((resolve, reject) => {
      this.ws.on('open', resolve);
      this.ws.on('error', reject);
    });
  }
  send(method, params) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params: params || {} }));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error('CDP timeout: ' + method));
        }
      }, 120000);
    });
  }
  async eval(expression) {
    const r = await this.send('Runtime.evaluate', {
      expression, returnByValue: true, awaitPromise: true, allowUnsafeEvalBlockedByCSP: true,
    });
    if (r.exceptionDetails) {
      throw new Error('eval exception: ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text));
    }
    return r.result && r.result.value;
  }
  close() { try { this.ws.close(); } catch {  } }
}

function pageScript() {
  const A = TRACK_A, B = TRACK_B;
  return `(async () => {
    const out = { steps: [] };
    const t = (k, v) => { out.steps.push(k); out[k] = v; };
    t('modules', {
      app: !!window.App,
      client: !!(window.App && window.App.profileClient),
      automixPlanner: !!window.AutoMixPlanner,
      engine: !!window.__audioEngine,
    });

    const mk = (o) => ({ id: o.id, title: o.title, filePath: o.file, path: o.file,
      duration_ms: o.dur, file_size: 1, suffix: 'flac' });
    const A = ${JSON.stringify(A)}, B = ${JSON.stringify(B)};

    const p1 = await window.App.profileClient.ensure(mk(A));
    const p2 = await window.App.profileClient.ensure(mk(B));
    t('profiles', {
      a: p1 ? { bpm: p1.tempo.primary, conf: p1.tempo.confidence, beats: p1.beats.timesMs.length, segs: p1.segments.length, cost: p1.costMs, edges: p1.edges } : null,
      b: p2 ? { bpm: p2.tempo.primary, conf: p2.tempo.confidence, beats: p2.beats.timesMs.length, cost: p2.costMs, edges: p2.edges } : null,
    });
    t('albumSequenceRule', {
      adjacent: window.AutoMixPlanner.isAlbumSequence(
        { album: 'X', albumArtist: 'Y', trackNumber: 1, discNumber: 1 },
        { album: 'X', albumArtist: 'Y', trackNumber: 2, discNumber: 1 }),
      wrongOrder: window.AutoMixPlanner.isAlbumSequence(
        { album: 'X', albumArtist: 'Y', trackNumber: 1, discNumber: 1 },
        { album: 'X', albumArtist: 'Y', trackNumber: 3, discNumber: 1 }),
      otherAlbum: window.AutoMixPlanner.isAlbumSequence(
        { album: 'X', albumArtist: 'Y', trackNumber: 1, discNumber: 1 },
        { album: 'Z', albumArtist: 'Y', trackNumber: 2, discNumber: 1 }),
    });

    if (p1 && p2) {
      const plan = window.AutoMixPlanner.plan(p1, p2, { fallbackDurationMs: 5000 });
      t('plan', {
        strategy: plan.strategy, exit: plan.exitMs, entry: plan.entryMs,
        dur: plan.durationMs, bars: plan.bars, ratio: plan.ratio,
        score: plan.score, conf: plan.confidence,
      });
      t('describe', window.AutoMixPlanner.describe(plan));

      window.__audioEngine.setTransitionPlan(plan);
      const snap = window.__audioEngine.getPlaybackSnapshot();
      t('engineAcceptedPlan', { strategy: snap.planStrategy, exitMs: snap.planExitMs });
    }

    // 再取一次（内存命中）
    const p1b = await window.App.profileClient.ensure(mk(A));
    t('memCacheSame', !!p1b);
    t('stats', await window.App.profileClient.profileStats());

    // 设置页只应保留一个 AutoMix 开关，不再有旧 AutoMix v2 / Gapless。
    window.App.navigate('settings');
    let playbackNav = null;
    for (let i = 0; i < 30 && !playbackNav; i++) {
      await new Promise(r => setTimeout(r, 100));
      playbackNav = document.querySelector('.settings-nav-item[data-section="playback"]');
    }
    if (playbackNav) playbackNav.click();
    let automixRow = null;
    for (let i = 0; i < 30 && !automixRow; i++) {
      await new Promise(r => setTimeout(r, 100));
      automixRow = document.querySelector('.settings-row[data-bind="automix"]');
    }
    t('settingsUI', {
      automixRow: !!automixRow,
      label: automixRow ? (automixRow.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 60) : '',
      legacyV2: !!document.querySelector('.settings-row[data-bind="automix_v2"]'),
      legacyGapless: !!document.querySelector('.settings-row[data-bind="gapless"]'),
      hasOldBrand: /AutoTransmit|AutoMix v2|Gapless/i.test(automixRow ? automixRow.textContent : ''),
    });
    window.App.navigate('music');
    return out;
  })()`;
}

function audioScript() {
  const A = TRACK_A, B = TRACK_B;
  return `(async () => {
    const out = { events: [] };
    const ae = window.__audioEngine;
    ae.setNullSink(true);
    await ae.recreateContext();
    ae.setVolume(0);
    // 探针环境没有真实消费端，主进程上报的 DLL 缓冲延迟会一直涨，
    // 把 getCurrentPositionMs() 压到 0（真实播放时它只有几十毫秒）。
    ae.setDllBufferLatency(0);
    const _lat = setInterval(() => ae.setDllBufferLatency(0), 200);
    ae.setCrossfadeEnabled(true);
    ae.setUserRate(1);

    let started = 0, completed = 0, ended = 0;
    ae.onCrossfadeStart = () => { started++; out.events.push('xfade_start@' + Math.round(ae.getCurrentPositionMs())); };
    ae.onCrossfadeComplete = (p) => { completed++; out.events.push('xfade_done@' + Math.round(p)); };
    ae.onEnded = () => { ended++; };

    async function waitNextBuffer() {
      for (let i = 0; i < 100 && !ae._nextBuffer; i++) await new Promise(r => setTimeout(r, 100));
      return !!ae._nextBuffer;
    }
    async function runPhase(fromFile, fromDur, toFile, toDur, plan, maxMs) {
      await ae.playCurrent(fromFile, fromDur, 0, false);
      await ae.setNextInfo(toFile, toDur, false);
      const ready = await waitNextBuffer();
      ae.setTransitionPlan(plan);
      const startedAt = completed;
      let washKinds = {};
      const before = ae.getPlaybackSnapshot();
      const probe = setInterval(() => {
        if (ae._currentWash) washKinds[ae._currentWash.kind || 'unknown'] = 1;
      }, 80);
      for (let i = 0; i < Math.ceil(maxMs / 100) && completed === startedAt; i++) {
        await new Promise(r => setTimeout(r, 100));
      }
      clearInterval(probe);
      const after = ae.getPlaybackSnapshot();
      return { ready, before, after, washKinds: Object.keys(washKinds) };
    }

    const markStart = Date.now();
    // 阶段 1：v3 structure-blend（eq:null）→ 必须是普通 deck 淡化，不能出现旧 wash
    const p1 = await runPhase(${JSON.stringify(A.file)}, ${A.dur}, ${JSON.stringify(B.file)}, ${B.dur}, {
      v: 3, engine: 'smoke-v3', strategy: 'structure-blend',
      exitMs: 6000, entryMs: 12000, durationMs: 4000, bars: 2, ratio: 1, semitones: 0,
      transitionStartMs: 6000, crossfadeDurationMs: 4000, nextStartOffsetMs: 12000,
      bpmCurrent: 130, bpmNext: 130, bpmTempoAdjust: 1, tempoRampMs: 0,
      eq: null,
    }, 16000);
    out.plainFade = {
      nextReady: p1.ready, wash: p1.washKinds,
      before: { pos: p1.before.positionMs }, after: { pos: p1.after.positionMs },
      file: (ae._currentFilePath || '').slice(-20),
      switched: /Otona/.test(ae._currentFilePath || ''),
      positionOk: p1.after.positionMs >= 12000 - 600 && p1.after.positionMs <= 12000 + 12000,
      noWash: p1.washKinds.length === 0,
    };

    // 阶段 2：v3 eq-swap（含独立低频 shelf）→ 实际建立 EQ 链
    const p2 = await runPhase(${JSON.stringify(B.file)}, ${B.dur}, ${JSON.stringify(A.file)}, ${A.dur}, {
      v: 3, engine: 'smoke-v3', strategy: 'eq-swap',
      exitMs: 6000, entryMs: 1000, durationMs: 4000, bars: 2, ratio: 1, semitones: 0,
      transitionStartMs: 6000, crossfadeDurationMs: 4000, nextStartOffsetMs: 1000,
      bpmCurrent: 130, bpmNext: 130, bpmTempoAdjust: 1, tempoRampMs: 0,
      eq: { enabled: true, aHighpassHz: 220, bLowpassHz: 4200, swapAt: 0.5, bassSwap: true, curve: 'equal-power' },
    }, 16000);
    out.eqSwap = {
      nextReady: p2.ready, wash: p2.washKinds,
      before: { pos: p2.before.positionMs }, after: { pos: p2.after.positionMs },
      file: (ae._currentFilePath || '').slice(-20),
      switched: /Blossom/.test(ae._currentFilePath || ''),
      hasEq: p2.washKinds.indexOf('eq') >= 0,
    };

    // 阶段 3：AutoMix 条件式无缝兜底（本地双 buffer，计划明确无重叠）
    let gaplessCount = 0;
    ae.onGaplessSwitch = function () { gaplessCount++; };
    await ae.playCurrent(${JSON.stringify(A.file)}, ${A.dur}, 0, false);
    await ae.setNextInfo(${JSON.stringify(B.file)}, ${B.dur}, false);
    const gaplessNextReady = await waitNextBuffer();
    await ae.seek(${A.dur - 4000});
    ae.setTransitionPlan({
      v: 3, engine: 'carminium-automix', strategy: 'hard-cut', gaplessFallback: true,
      exitMs: ${A.dur}, entryMs: 0, durationMs: 0, bars: 0, ratio: 1, semitones: 0,
      transitionStartMs: -1, crossfadeDurationMs: 0, nextStartOffsetMs: 0,
      bpmCurrent: 130, bpmNext: 130, bpmTempoAdjust: 1, tempoRampMs: 0,
      eq: null,
    });
    for (let i = 0; i < 80 && gaplessCount === 0; i++) await new Promise(r => setTimeout(r, 100));
    out.gaplessFallback = {
      nextReady: gaplessNextReady,
      switches: gaplessCount,
      file: (ae._currentFilePath || '').slice(-20),
      switched: /Otona/.test(ae._currentFilePath || ''),
      executionMode: ae.getPlaybackSnapshot().executionMode,
    };

    // 阶段 4：专辑连续曲（seamless）→ 计划刻意不重叠，仍必须在自然结束点真无缝
    let albumCount = 0;
    const albumXfadeBefore = started;
    ae.onGaplessSwitch = function () { albumCount++; };
    await ae.playCurrent(${JSON.stringify(A.file)}, ${A.dur}, 0, false);
    await ae.setNextInfo(${JSON.stringify(B.file)}, ${B.dur}, false);
    const albumNextReady = await waitNextBuffer();
    await ae.seek(${A.dur - 4000});
    ae.setTransitionPlan({
      v: 4, engine: 'carminium-automix', strategy: 'album-sequence', seamless: true,
      gaplessFallback: false, preserveOriginal: true,
      exitMs: -1, entryMs: 0, durationMs: 0, bars: 0, ratio: 1, semitones: 0,
      transitionStartMs: -1, crossfadeDurationMs: 0, nextStartOffsetMs: 0,
      bpmCurrent: 130, bpmNext: 130, bpmTempoAdjust: 1, tempoRampMs: 0,
      eq: null,
    });
    for (let i = 0; i < 80 && albumCount === 0; i++) await new Promise(r => setTimeout(r, 100));
    out.albumSequence = {
      nextReady: albumNextReady,
      switches: albumCount,
      file: (ae._currentFilePath || '').slice(-20),
      switched: /Otona/.test(ae._currentFilePath || ''),
      executionMode: ae.getPlaybackSnapshot().executionMode,
      transitions: started - albumXfadeBefore,
      xfadeCompleted: completed - albumXfadeBefore,
    };

    out.ctxState = ae._ctx ? ae._ctx.state : 'none';
    out.tl = ae._ctx ? { cursor: Math.round(ae._tlCursor * 1000), pos: Math.round(ae._tlPos) } : null;
    out.isPlaying = ae._isPlaying;
    out.started = started; out.completed = completed; out.ended = ended;
    out.elapsedMs = Date.now() - markStart;
    clearInterval(_lat);
    out.latencyMs = ae._currentLatencyMs();
    ae.stop();
    return out;
  })()`;
}

(async () => {
  const userDataDir = prepareUserData();
  const env = Object.assign({}, process.env);
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.NODE_OPTIONS;

  const child = spawn(ELECTRON, [
    '.', `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDataDir}`,
    '--no-sandbox', '--disable-gpu', '--disable-gpu-compositing', '--disable-software-rasterizer',
    // 探针里没有用户手势，Chromium 会挂起 AudioContext（currentTime 不走 → 进度不动）
    '--autoplay-policy=no-user-gesture-required',
  ], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });

  const logPath = path.join(__dirname, 'smoke_electron.log');
  const logStream = fs.createWriteStream(logPath, { flags: 'w' });
  child.stdout.pipe(logStream);
  child.stderr.pipe(logStream);

  let cdp = null;
  try {
    const url = await connect();
    cdp = new CDP(url);
    await cdp.ready();
    await cdp.send('Runtime.enable');
    await sleep(2500);   // 等 App 初始化

    const basic = await cdp.eval(pageScript());
    console.log('=== 基础链路 ===');
    console.log(JSON.stringify(basic, null, 2));

    const audio = await cdp.eval(audioScript());
    console.log('=== 真实播放 + EQ 交叉淡变（null sink, volume 0） ===');
    console.log(JSON.stringify(audio, null, 2));

    const errors = cdp.logs.filter((l) => /exception|\[error\]/i.test(l));
    console.log('=== 控制台异常 ===');
    console.log(errors.length ? errors.slice(0, 20).join('\n') : '(none)');
  } catch (e) {
    console.log('SMOKE FAILED: ' + e.message);
    if (cdp) console.log(cdp.logs.slice(-40).join('\n'));
  } finally {
    if (cdp) cdp.close();
    try { child.kill(); } catch {  }
    logStream.end();
    await sleep(800);
  }
})();
