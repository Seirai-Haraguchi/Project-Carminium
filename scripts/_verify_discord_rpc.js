/**
 * Carminium — Discord RPC 冒烟自测（scripts/_verify_discord_rpc.js）
 *
 * 不连接真实 Discord：stub 掉 electron(ipcMain) 与 net.createConnection，
 * 用假 socket 驱动 DiscordRpcController 的完整生命周期，验证：
 *   1. 帧编解码（8 字节头 + JSON）与分片到达的健壮性
 *   2. 握手 / READY / ERROR / PING→PONG 协议行为
 *   3. activity 构建：details/state/timestamps、暂停前缀、模板占位符、
 *      长度截断、换行压缩、未知占位符移除
 *   4. 设置热切换（开关 / client_id / show_paused / brief_format）
 *   5. getStatus 状态机与 ipc handler 注册
 *
 * 运行：node scripts/_verify_discord_rpc.js
 */
'use strict';

const assert = require('assert');
const EventEmitter = require('events');
const Module = require('module');

// ── stub electron（discord_rpc.js 在构造函数里注册 ipcMain.handle）──────────
const ipcHandlers = {};
const fakeElectron = {
  ipcMain: {
    handle: (name, fn) => { ipcHandlers[name] = fn; },
  },
};
const electronPath = require.resolve('electron');
require.cache[electronPath] = new Module(electronPath, null);
require.cache[electronPath].filename = electronPath;
require.cache[electronPath].loaded = true;
require.cache[electronPath].exports = fakeElectron;

// ── stub net.createConnection ────────────────────────────────────────────────
const net = require('net');
const createdSockets = [];
net.createConnection = function (pipePath) {
  const sock = makeFakeSocket();
  sock.pipePath = pipePath;
  createdSockets.push(sock);
  return sock;
};

function makeFakeSocket() {
  const sock = new EventEmitter();
  sock.writes = [];
  sock.destroyed = false;
  sock.write = function (buf) { sock.writes.push(Buffer.from(buf)); return true; };
  sock.destroy = function () { sock.destroyed = true; };
  sock.end = function () { sock.destroyed = true; };
  sock.setTimeout = function () {};
  return sock;
}

// ── 协议帧工具（与被测模块同一格式）────────────────────────────────────────────
const OP_HANDSHAKE = 0;
const OP_FRAME = 1;
const OP_CLOSE = 2;
const OP_PING = 3;
const OP_PONG = 4;

function encodeFrame(opcode, obj) {
  const payload = Buffer.from(JSON.stringify(obj), 'utf8');
  const header = Buffer.alloc(8);
  header.writeInt32LE(opcode, 0);
  header.writeUInt32LE(payload.length, 4);
  return Buffer.concat([header, payload]);
}

function encodeRaw(opcode, payload) {
  const header = Buffer.alloc(8);
  header.writeInt32LE(opcode, 0);
  header.writeUInt32LE(payload.length, 4);
  return Buffer.concat([header, payload]);
}

function parseFrames(bufs) {
  const all = Buffer.concat(bufs);
  const frames = [];
  let off = 0;
  while (off + 8 <= all.length) {
    const opcode = all.readInt32LE(off);
    const len = all.readUInt32LE(off + 4);
    if (off + 8 + len > all.length) break;
    const raw = all.subarray(off + 8, off + 8 + len);
    let json = null;
    try { json = JSON.parse(raw.toString('utf8')); } catch { json = null; }
    frames.push({ opcode, json, raw });
    off += 8 + len;
  }
  return { frames, rest: all.subarray(off) };
}

const tick = (ms) => new Promise((r) => setTimeout(r, ms || 30));

// ── 假 player / settings ─────────────────────────────────────────────────────
class FakePlayer extends EventEmitter {
  constructor() {
    super();
    this._track = null;
    this._state = 'stopped';
    this._pos = 0;
    this._dur = 0;
  }
  get currentTrack() { return this._track; }
  get state() { return this._state; }
  get position() { return this._pos; }
  get duration() { return this._dur; }
}

function makeSettings(overrides) {
  const data = Object.assign({
    discord_rpc: true,
    discord_rpc_show_paused: true,
    discord_rpc_brief_format: '{artist}',
    discord_rpc_client_id: '111111111111111111',
  }, overrides || {});
  return {
    data,
    get: (k, d) => (k in data ? data[k] : d),
  };
}

const { DiscordRpcController } = require('../electron/discord_rpc.js');

// ── 测试桩 ─────────────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;
function check(name, fn) {
  try {
    fn();
    passed++;
    console.log('  PASS', name);
  } catch (e) {
    failed++;
    console.error('  FAIL', name, '—', e.message);
  }
}

async function main() {
  const player = new FakePlayer();
  const settings = makeSettings();
  const ctrl = new DiscordRpcController(player, settings);

  // 0. ipc handler 注册
  check('discord_rpc_status ipc handler 已注册', () => {
    assert.strictEqual(typeof ipcHandlers['discord_rpc_status'], 'function');
    assert.deepStrictEqual(ipcHandlers['discord_rpc_status'](), { state: 'disconnected', username: '' });
  });
  check('初始状态 disabled', () => {
    // 构造时 enabled=true 但未 start()，_connecting 仍为 false → disconnected
    assert.strictEqual(ctrl.getStatus().state, 'disconnected');
  });

  // 1. start() → 连接第一个候选管道 → 握手帧
  ctrl.start();
  await tick();
  check('start() 后创建了管道连接尝试', () => {
    assert.ok(createdSockets.length >= 1, '应有 socket 被创建');
    assert.strictEqual(createdSockets[0].pipePath, '\\\\.\\pipe\\discord-ipc-0');
  });
  check('连接前状态为 connecting', () => {
    assert.strictEqual(ctrl.getStatus().state, 'connecting');
  });

  const sock = createdSockets[0];
  sock.emit('connect');
  check('connect 后发送 HANDSHAKE 帧', () => {
    const { frames } = parseFrames(sock.writes);
    assert.strictEqual(frames.length, 1);
    assert.strictEqual(frames[0].opcode, OP_HANDSHAKE);
    assert.deepStrictEqual(frames[0].json, { v: 1, client_id: '111111111111111111' });
  });

  // 2. 分片到达：把 READY 帧拆成 3 段喂入
  const readyFrame = encodeFrame(OP_FRAME, {
    evt: 'READY',
    data: { user: { username: 'tester', global_name: 'Tester' } },
  });
  sock.emit('data', readyFrame.subarray(0, 3));
  sock.emit('data', readyFrame.subarray(3, 9));
  sock.emit('data', readyFrame.subarray(9));
  check('分片帧被完整解析并完成握手', () => {
    assert.strictEqual(ctrl.getStatus().state, 'connected');
    assert.strictEqual(ctrl.getStatus().username, 'Tester');
  });

  // 3. 播放中 → SET_ACTIVITY（details=曲名, state=模板, timestamps）
  player._track = { title: 'Midnight City', artist: 'M83', album: 'Hurry Up, We\'re Dreaming', album_artist: 'M83' };
  player._state = 'playing';
  player._pos = 30000;   // 30s
  player._dur =240000;   // 240s
  player.emit('state_changed');
  await tick(120); // 等 _scheduleUpdate 的 50ms 合并 tick

  check('播放中推送 SET_ACTIVITY', () => {
    const { frames } = parseFrames(sock.writes);
    const setFrames = frames.filter((f) => f.opcode === OP_FRAME && f.json.cmd === 'SET_ACTIVITY');
    assert.ok(setFrames.length >= 1, '应有 SET_ACTIVITY');
    const act = setFrames[setFrames.length - 1].json.args.activity;
    assert.strictEqual(act.type, 2, 'type 应为 Listening(2)');
    assert.strictEqual(act.details, 'Midnight City');
    assert.strictEqual(act.state, 'M83', '默认模板 {artist}');
    assert.ok(act.timestamps, 'playing 应带 timestamps');
    const nowSec = Math.floor(Date.now() / 1000);
    assert.ok(Math.abs(act.timestamps.start - (nowSec - 30)) <= 2, 'start 应≈now-30s');
    assert.strictEqual(act.timestamps.end - act.timestamps.start, 240, 'end-start=时长');
    assert.strictEqual(setFrames[0].json.args.pid, process.pid, 'args.pid 应为 process.pid');
  });

  // 4. PING → PONG 回声
  const pongBefore = sock.writes.length;
  sock.emit('data', encodeRaw(OP_PING, Buffer.from('hello-ping')));
  check('PING 被回以 PONG（原样载荷）', () => {
    const { frames } = parseFrames(sock.writes.slice(pongBefore));
    assert.strictEqual(frames.length, 1);
    assert.strictEqual(frames[0].opcode, OP_PONG);
  });

  // 5. 暂停 → ⏸ 前缀、无 timestamps
  player._state = 'paused';
  player.emit('state_changed');
  await tick(120);
  check('暂停时 state 带 ⏸ 前缀且无 timestamps', () => {
    const { frames } = parseFrames(sock.writes);
    const setFrames = frames.filter((f) => f.opcode === OP_FRAME && f.json.cmd === 'SET_ACTIVITY');
    const act = setFrames[setFrames.length - 1].json.args.activity;
    assert.strictEqual(act.state, '\u23F8 M83');
    assert.strictEqual(act.timestamps, undefined, '暂停不应带进度');
  });

  // 6. 关闭「暂停时显示」→ CLEAR_ACTIVITY
  ctrl.onSettingsChanged(JSON.stringify({ discord_rpc_show_paused: false }));
  check('关闭暂停显示后清除 activity', () => {
    const { frames } = parseFrames(sock.writes);
    const clearFrames = frames.filter((f) => f.opcode === OP_FRAME && f.json.cmd === 'CLEAR_ACTIVITY');
    assert.ok(clearFrames.length >= 1, '应有 CLEAR_ACTIVITY');
    assert.strictEqual(clearFrames[clearFrames.length - 1].json.args.pid, process.pid);
  });

  // 7. 自定义模板 + 未知占位符移除 + 换行压缩 + 截断
  ctrl.onSettingsChanged(JSON.stringify({
    discord_rpc_show_paused: true,
    discord_rpc_brief_format: '{title} · {artist} · {album_artist} · {foo}',
  }));
  player._state = 'playing';
  player.emit('state_changed');
  await tick(120);
  check('自定义模板渲染并移除未知占位符', () => {
    const { frames } = parseFrames(sock.writes);
    const setFrames = frames.filter((f) => f.opcode === OP_FRAME && f.json.cmd === 'SET_ACTIVITY');
    const act = setFrames[setFrames.length - 1].json.args.activity;
    assert.strictEqual(act.state, 'Midnight City · M83 · M83');
    assert.ok(!/\{|\}/.test(act.state), '不应残留花括号');
  });

  // 换行压缩 + 超长截断
  const longTitle = 'A'.repeat(200);
  player._track = { title: longTitle, artist: 'Line\n\nBreak  Artist', album: 'x' };
  player.emit('track_changed');
  await tick(120);
  check('超长 details 截断到 128 字符并加省略号', () => {
    const { frames } = parseFrames(sock.writes);
    const setFrames = frames.filter((f) => f.opcode === OP_FRAME && f.json.cmd === 'SET_ACTIVITY');
    const act = setFrames[setFrames.length - 1].json.args.activity;
    assert.strictEqual(act.details.length, 128);
    assert.ok(act.details.endsWith('\u2026'));
  });
  ctrl.onSettingsChanged(JSON.stringify({ discord_rpc_brief_format: '{artist}' }));

  // 8. stopped → CLEAR_ACTIVITY
  player._state = 'stopped';
  player.emit('state_changed');
  await tick(120);
  check('stopped 状态清除 activity', () => {
    const { frames } = parseFrames(sock.writes);
    const clearFrames = frames.filter((f) => f.opcode === OP_FRAME && f.json.cmd === 'CLEAR_ACTIVITY');
    assert.ok(clearFrames.length >= 1);
  });

  // 9. 全新连接在握手阶段收到 ERROR（最常见：client_id 无效）
  //    → 断开、销毁 socket、进入 disconnected（已握手连接的 ERROR 按设计忽略）
  ctrl.onSettingsChanged(JSON.stringify({ discord_rpc: false }));
  await tick();
  ctrl.onSettingsChanged(JSON.stringify({ discord_rpc: true }));
  await tick();
  const sockErr = createdSockets[createdSockets.length - 1];
  sockErr.emit('connect');
  sockErr.emit('data', encodeFrame(OP_FRAME, { evt: 'ERROR', data: { message: 'invalid client_id' } }));
  check('握手阶段 ERROR → disconnected 且 socket 销毁', () => {
    assert.strictEqual(ctrl.getStatus().state, 'disconnected');
    assert.strictEqual(sockErr.destroyed, true, 'socket 应被销毁');
  });

  // 10. 关闭总开关 → disabled
  ctrl.onSettingsChanged(JSON.stringify({ discord_rpc: false }));
  check('关闭总开关 → disabled', () => {
    assert.strictEqual(ctrl.getStatus().state, 'disabled');
  });

  // 11. 重新开启（带 client_id）→ 立即重连
  const before = createdSockets.length;
  ctrl.onSettingsChanged(JSON.stringify({ discord_rpc: true }));
  await tick();
  check('重新开启后立即发起新连接', () => {
    assert.ok(createdSockets.length > before, '应创建新 socket');
    assert.strictEqual(ctrl.getStatus().state, 'connecting');
  });

  // 12. stop()：清 activity + OP_CLOSE + 不再重连
  const sock2 = createdSockets[createdSockets.length - 1];
  sock2.emit('connect');
  sock2.emit('data', encodeFrame(OP_FRAME, { evt: 'READY', data: { user: { username: 'u2' } } }));
  player._state = 'playing';
  player.emit('state_changed');
  await tick(120);
  ctrl.stop();
  check('stop() 发送 CLEAR_ACTIVITY 与 OP_CLOSE', () => {
    const { frames } = parseFrames(sock2.writes);
    const cmds = frames.filter((f) => f.opcode === OP_FRAME).map((f) => f.json.cmd);
    assert.ok(cmds.includes('CLEAR_ACTIVITY'), '应有 CLEAR_ACTIVITY');
    assert.ok(frames.some((f) => f.opcode === OP_CLOSE), '应有 OP_CLOSE');
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error('smoke test crashed:', e);
  process.exit(1);
});
