'use strict';

/**
 * Packaged playback smoke test.
 *
 * Startup-only smoke tests pass even when playing a track is impossible. This
 * one drives the REAL renderer through CDP: injects a local audio file into
 * the queue and asserts playbackState becomes 'playing'. Run against an
 * already started packaged app with --remote-debugging-port=<CDP_PORT>.
 *
 * Usage: node scripts/ci-playback-smoke.js <absolute-path-to-audio-file>
 */

const port = Number(process.env.CDP_PORT || '9333');
const file = process.argv[2];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function findPage() {
  for (let i = 0; i < 40; i += 1) {
    try {
      const list = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json());
      const page = list.find((t) => t.type === 'page' && t.url.includes('index.html'));
      if (page) return page;
    } catch { /* not up yet */ }
    await sleep(1000);
  }
  throw new Error('main window never appeared on CDP port ' + port);
}

(async () => {
  if (!file) throw new Error('usage: node ci-playback-smoke.js <audio-file>');
  const page = await findPage();
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

  let nextId = 0;
  const pending = new Map();
  const errors = [];
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
    if (m.method === 'Runtime.exceptionThrown') {
      errors.push('EXCEPTION ' + ((m.params.exceptionDetails.exception || {}).description || m.params.exceptionDetails.text || ''));
    } else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      errors.push('CONSOLE ' + m.params.args.map((a) => a.value || a.description || '').join(' '));
    }
  };
  const send = (method, params) => new Promise((res) => {
    const id = ++nextId;
    pending.set(id, res);
    ws.send(JSON.stringify({ id, method, params }));
  });
  await send('Runtime.enable');

  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', {
      expression, awaitPromise: true, returnByValue: true, userGesture: true,
    });
    if (r.result && r.result.exceptionDetails) {
      throw new Error('page threw: ' + JSON.stringify(r.result.exceptionDetails).slice(0, 500));
    }
    return r.result && r.result.result ? r.result.result.value : undefined;
  };

  // The CI runner has an empty library, so hand the player a synthetic track
  // pointing at a real, decodable local file.
  const track = {
    id: 'ci-playback-smoke',
    path: file,
    title: 'CI Playback Smoke',
    artist: 'CI',
    duration_ms: 30000,
    suffix: '.wav',
    source: 'local',
  };
  const expression = 'window.__electronAPI.invoke("play_from_list", ' +
    JSON.stringify(JSON.stringify([track])) + ', 0)';
  await evaluate(expression);

  // Sample a few times: startup on CI runners is slower, and a state can be
  // observed before the play event has been applied by the renderer.
  let state;
  for (let i = 0; i < 5; i += 1) {
    await sleep(1200);
    state = await evaluate('App.state.playbackState');
    if (state === 'playing') break;
  }
  const title = await evaluate('App.state.currentTrack && App.state.currentTrack.title');
  console.log('playbackState =', state, '| currentTrack =', title);
  if (errors.length) console.log('page errors:', errors.slice(0, 6));
  ws.close();

  if (state !== 'playing') {
    console.error('FAIL: packaged app never entered playing state');
    process.exit(1);
  }
  console.log('PASS: packaged app actually started playback');
})().catch((e) => {
  console.error('FAIL:', e.stack || e.message);
  process.exit(1);
});
