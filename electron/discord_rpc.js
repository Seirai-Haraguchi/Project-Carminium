/**
 * Carminium — Discord Rich Presence 集成
 *
 * 通过 Discord 的本地 IPC 通道（Windows 命名管道 / Unix socket）把当前播放状态
 * 推送到 Discord 客户端，在用户资料页显示「正在收听」。
 *
 * 协议（v1，详见 https://discord.com/developers/docs/topics/rpc ）：
 *   帧格式 = int32LE opcode + uint32LE length + JSON payload
 *   opcode: 0=HANDSHAKE  1=FRAME  2=CLOSE  3=PING  4=PONG
 *   握手   → { v: 1, client_id }                响应 { evt: 'READY', data: { user } }
 *   设置   → { cmd: 'SET_ACTIVITY', args: { pid, activity }, nonce }
 *   清除   → { cmd: 'CLEAR_ACTIVITY', args: { pid }, nonce }
 *
 * activity 结构（只发纯文本字段，不依赖 Discord 应用内注册的图片资源）：
 *   type 2      = Listening（Discord 显示 "LISTENING TO"）
 *   details     = 曲名
 *   state       = 简略状态（用户模板，默认 {artist}）
 *   timestamps  = 播放中时的 start/end（epoch 秒），Discord 客户端自行渲染进度条
 *
 * 设计要点：
 *   - 不引入第三方依赖（discord-rpc 等），协议本身足够简单；
 *   - Discord 未启动时按间隔重试，打开开关时立即连接；
 *   - 连接状态通过 bridge 'discord_status' 事件推送给设置页；
 *   - position_changed 不需要订阅：timestamps 是绝对 epoch 秒，
 *     进度条由 Discord 客户端自行推进；
 *   - 连接代数（_gen）：旧 socket 的 close/帧一律忽略，避免重连竞争。
 */
'use strict';

const net = require('net');
const path = require('path');
const { ipcMain } = require('electron');

// ── 协议常量 ────────────────────────────────────────────────────────────────
const OP_HANDSHAKE = 0;
const OP_FRAME = 1;
const OP_CLOSE = 2;
const OP_PING = 3;
const OP_PONG = 4;

// activity type：2 = Listening（"LISTENING TO"）
const ACTIVITY_TYPE_LISTENING = 2;

const CONNECT_TIMEOUT_MS = 800;    // 单个管道连接的 TCP 层超时
const HANDSHAKE_TIMEOUT_MS = 3000; // 握手响应超时
const RECONNECT_DELAY_MS = 15000;  // 掉线 / 找不到管道后的重试间隔
const HANDSHAKE_ERR_RETRY_MS = 30000; // 握手被拒（如 client_id 无效）后的重试间隔

// Discord 字段长度上限（details / state 各 128）
const MAX_FIELD_LEN = 128;

// 暂停标记（语言中立的符号，Discord UI 语言由客户端决定）
const PAUSE_PREFIX = '\u23F8 '; // '⏸ '

const DEFAULT_BRIEF_FORMAT = '{artist}';

class DiscordRpcController {
  /**
   * @param {import('./player')} player
   * @param {import('./settings')} settings
   */
  constructor(player, settings) {
    this._player = player;
    this._settings = settings;
    this._bridge = null;

    // 连接状态
    this._socket = null;
    this._connected = false;   // TCP 已连上
    this._handshaked = false;  // 收到 READY
    this._connecting = false;  // _connect() 正在进行（含等待握手）
    this._closed = false;      // stop() 已调用，不再重连
    this._gen = 0;             // 连接代数：旧 socket 的事件据此忽略

    // 配置（设置变更时由 onSettingsChanged 更新）
    this._enabled = !!settings.get('discord_rpc', false);
    this._showPaused = settings.get('discord_rpc_show_paused', true) !== false;
    this._briefFormat = String(settings.get('discord_rpc_brief_format', DEFAULT_BRIEF_FORMAT) || DEFAULT_BRIEF_FORMAT);
    this._clientId = String(settings.get('discord_rpc_client_id', '') || '').trim();
    this._username = '';

    // 定时器
    this._retryTimer = null;
    this._handshakeTimer = null;
    this._updateTimer = null;

    this._nonce = 0;
    this._lastPushedStatus = '';

    // 渲染进程查询连接状态
    ipcMain.handle('discord_rpc_status', () => this.getStatus());

    // ── Player 事件 ──
    // 只需要 track_changed / state_changed：
    // 切歌 → 重建 activity；播放/暂停/停止 → 切换 timestamps 或清除。
    player.on('track_changed', () => this._scheduleUpdate());
    player.on('state_changed', () => this._scheduleUpdate());
  }

  setBridge(bridge) {
    this._bridge = bridge;
    // 订阅设置变更（save_settings / 独占回退都会经 bridge 转发）
    if (bridge && typeof bridge.on === 'function') {
      bridge.on('settings_changed', (settingsJson) => this.onSettingsChanged(settingsJson));
    }
  }

  // ── 生命周期 ─────────────────────────────────────────────────────────────

  /** 启用开关打开且已填写 client_id 时立即连接；否则待命。 */
  start() {
    if (this._enabled && this._clientId) {
      this._connect();
    } else {
      this._setStatus(this._enabled ? 'disconnected' : 'disabled');
    }
  }

  /** 应用退出：清除 Discord 上的状态并断开。 */
  stop() {
    this._closed = true;
    this._clearRetry();
    this._clearHandshakeTimer();
    if (this._updateTimer) {
      clearTimeout(this._updateTimer);
      this._updateTimer = null;
    }
    if (this._connected) {
      try { this._clearActivity(); } catch { /* ignore */ }
      try { this._sendFrame(OP_CLOSE, {}); } catch { /* ignore */ }
    }
    // 给管道写入一点 flush 时间再销毁（退出时 Discord 需要收到 CLEAR 才会移除状态）
    const sock = this._socket;
    this._socket = null;
    this._connected = false;
    this._handshaked = false;
    if (sock) {
      try { sock.end(); } catch { /* ignore */ }
      const t = setTimeout(() => { try { sock.destroy(); } catch { /* ignore */ } }, 150);
      if (t.unref) t.unref();
    }
  }

  // ── 设置变更 ─────────────────────────────────────────────────────────────

  /**
   * bridge 的 settings_changed 事件（与 SmtcController 同一模式）。
   * @param {string} settingsJson
   */
  onSettingsChanged(settingsJson) {
    let data;
    try {
      data = JSON.parse(settingsJson);
    } catch {
      return;
    }

    if ('discord_rpc' in data) {
      const on = !!data['discord_rpc'];
      this._enabled = on;
      if (!on) {
        // 关闭：清除状态并断开（_onClose 看到 _enabled=false 不会重连）
        this._clearRetry();
        this._clearActivity();
        this._destroySocket();
        this._setStatus('disabled');
        return;
      }
      // 开启：立即尝试连接（无 client_id 时停留在 disconnected）
      if (this._clientId) {
        this._connect();
      } else {
        this._setStatus('disconnected');
      }
    }

    if ('discord_rpc_client_id' in data) {
      this._clientId = String(data['discord_rpc_client_id'] || '').trim();
      if (this._enabled) {
        if (this._clientId) {
          this._connect(); // ID 变化：用新 ID 重连
        } else {
          this._clearRetry();
          this._clearActivity();
          this._destroySocket();
          this._setStatus('disconnected');
        }
      }
    }

    if ('discord_rpc_show_paused' in data) {
      this._showPaused = data['discord_rpc_show_paused'] !== false;
      this._pushActivity();
    }

    if ('discord_rpc_brief_format' in data) {
      this._briefFormat = String(data['discord_rpc_brief_format'] || DEFAULT_BRIEF_FORMAT);
      this._pushActivity();
    }
  }

  // ── 连接状态 ─────────────────────────────────────────────────────────────

  /** @returns {{ state: 'disabled'|'disconnected'|'connecting'|'connected', username: string }} */
  getStatus() {
    let state = 'disabled';
    if (this._enabled) {
      if (this._connected && this._handshaked) state = 'connected';
      else if (this._connecting) state = 'connecting';
      else state = 'disconnected';
    }
    return { state, username: this._username || '' };
  }

  _setStatus(state) {
    const status = this.getStatus();
    const key = status.state + '|' + status.username;
    if (key === this._lastPushedStatus) return;
    this._lastPushedStatus = key;
    // 推送给设置页（bridge._emit → 主窗口 bridge:event → __bridge.dispatch）
    if (this._bridge && typeof this._bridge._emit === 'function') {
      this._bridge._emit('discord_status', status);
    }
  }

  // ── 管道发现与连接 ───────────────────────────────────────────────────────

  /** Discord IPC 通道候选路径（按优先级）。 */
  _ipcPaths() {
    const paths = [];
    if (process.platform === 'win32') {
      for (let i = 0; i < 10; i++) {
        paths.push('\\\\.\\pipe\\discord-ipc-' + i);
      }
      return paths;
    }
    // Linux / macOS：Discord 按安装形式把 socket 放在不同基目录
    const bases = [];
    const xdg = process.env.XDG_RUNTIME_DIR;
    if (xdg) {
      bases.push(xdg);                                                // 原生构建
      bases.push(path.join(xdg, 'app', 'com.discordapp.Discord'));    // Flatpak
    }
    bases.push('/tmp');                                               // Snap / 兜底
    for (const base of bases) {
      for (let i = 0; i < 10; i++) {
        paths.push(path.join(base, 'discord-ipc-' + i));
      }
    }
    return paths;
  }

  async _connect() {
    if (this._closed || !this._enabled || !this._clientId) return;
    this._clearRetry();
    this._destroySocket(); // 断开旧连接（其 close 事件因代数不匹配被忽略）
    const gen = ++this._gen;
    this._connecting = true;
    this._setStatus('connecting');

    const paths = this._ipcPaths();
    for (const p of paths) {
      if (gen !== this._gen || this._closed || !this._enabled || !this._clientId) {
        if (gen === this._gen) this._connecting = false;
        return;
      }
      const ok = await this._tryConnect(p, gen);
      if (ok) return; // 握手结果异步处理（READY / ERROR），_connecting 保持到那时
    }

    if (gen !== this._gen) return;
    // 所有候选管道都连不上（Discord 大概率没启动）
    this._connecting = false;
    this._setStatus('disconnected');
    this._scheduleRetry(RECONNECT_DELAY_MS);
  }

  /**
   * 尝试连接单个管道。resolve(true) 仅表示 TCP 层连上（握手另行异步判定）。
   * @returns {Promise<boolean>}
   */
  _tryConnect(pipePath, gen) {
    return new Promise((resolve) => {
      let settled = false;
      const done = (v) => {
        if (settled) return;
        settled = true;
        resolve(v);
      };

      let sock;
      try {
        sock = net.createConnection(pipePath);
      } catch {
        done(false);
        return;
      }
      sock.once('connect', () => {
        if (gen !== this._gen) {
          // 已有更新的连接尝试，放弃这个
          try { sock.destroy(); } catch { /* ignore */ }
          done(false);
          return;
        }
        sock.setTimeout(0);
        this._socket = sock;
        this._wireSocket(sock, gen);
        // 握手
        this._sendFrame(OP_HANDSHAKE, { v: 1, client_id: this._clientId });
        // 握手超时保险：Discord 收了连接但迟迟不响应 READY
        this._clearHandshakeTimer();
        this._handshakeTimer = setTimeout(() => {
          if (this._handshaked || gen !== this._gen) return;
          console.warn('[discord-rpc] handshake timeout:', pipePath);
          this._connecting = false;
          this._destroySocket();
          this._setStatus('disconnected');
          this._scheduleRetry(RECONNECT_DELAY_MS);
        }, HANDSHAKE_TIMEOUT_MS);
        if (this._handshakeTimer.unref) this._handshakeTimer.unref();
        done(true);
      });
      sock.once('error', () => {
        // ENOENT / EACCES 等：该管道不存在，试下一个
        try { sock.destroy(); } catch { /* ignore */ }
        done(false);
      });
      sock.once('timeout', () => {
        try { sock.destroy(); } catch { /* ignore */ }
        done(false);
      });
      sock.setTimeout(CONNECT_TIMEOUT_MS);
    });
  }

  _wireSocket(sock, gen) {
    let buffer = Buffer.alloc(0);
    sock.on('data', (chunk) => {
      if (gen !== this._gen || this._socket !== sock) return;
      buffer = buffer.length ? Buffer.concat([buffer, chunk]) : chunk;
      // 逐帧解析：8 字节头 + JSON
      while (buffer.length >= 8) {
        const opcode = buffer.readInt32LE(0);
        const length = buffer.readUInt32LE(4);
        if (buffer.length < 8 + length) break; // 等后续数据
        const payload = buffer.subarray(8, 8 + length);
        buffer = buffer.subarray(8 + length);
        try {
          this._onFrame(opcode, payload, gen);
        } catch (e) {
          console.warn('[discord-rpc] frame handler error:', e.message);
        }
      }
    });
    sock.on('close', () => this._onClose(gen));
    sock.on('error', (e) => {
      // 'close' 紧随其后，统一在 _onClose 处理
      console.warn('[discord-rpc] socket error:', e.message);
    });
  }

  _onFrame(opcode, payload, gen) {
    if (gen !== this._gen) return;
    if (opcode === OP_PING) {
      // Discord 发 PING → 回 PONG（原样回声）
      this._sendRaw(OP_PONG, payload);
      return;
    }
    if (opcode !== OP_FRAME) return;

    let json;
    try {
      json = JSON.parse(payload.toString('utf8'));
    } catch {
      return;
    }

    if (json.evt === 'READY') {
      this._clearHandshakeTimer();
      this._handshaked = true;
      this._connected = true;
      this._connecting = false;
      const user = (json.data && json.data.user) || {};
      this._username = String(user.global_name || user.username || '');
      console.log('[discord-rpc] connected as', this._username || '(unknown)');
      this._setStatus('connected');
      // 连上后立即推送当前状态
      this._pushActivity();
    } else if (json.evt === 'ERROR') {
      const msg = (json.data && json.data.message) || 'unknown error';
      console.warn('[discord-rpc] protocol error:', msg);
      if (!this._handshaked) {
        // 握手阶段被拒（最常见：client_id 无效）
        this._clearHandshakeTimer();
        this._connecting = false;
        this._destroySocket();
        this._setStatus('disconnected');
        this._scheduleRetry(HANDSHAKE_ERR_RETRY_MS);
      }
    }
    // 其余事件（ACTIVITY_UPDATE 等）无需处理
  }

  _onClose(gen) {
    if (gen !== this._gen) return; // 旧连接的 close，忽略
    this._socket = null;
    this._connected = false;
    this._handshaked = false;
    this._connecting = false;
    if (this._closed || !this._enabled) return;
    this._setStatus('disconnected');
    this._scheduleRetry(RECONNECT_DELAY_MS);
  }

  _destroySocket() {
    const sock = this._socket;
    this._socket = null;
    this._connected = false;
    this._handshaked = false;
    if (sock) {
      try { sock.destroy(); } catch { /* ignore */ }
    }
  }

  _scheduleRetry(ms) {
    this._clearRetry();
    this._retryTimer = setTimeout(() => {
      this._retryTimer = null;
      this._connect();
    }, ms);
    if (this._retryTimer.unref) this._retryTimer.unref();
  }

  _clearRetry() {
    if (this._retryTimer) {
      clearTimeout(this._retryTimer);
      this._retryTimer = null;
    }
  }

  _clearHandshakeTimer() {
    if (this._handshakeTimer) {
      clearTimeout(this._handshakeTimer);
      this._handshakeTimer = null;
    }
  }

  // ── 帧收发 ───────────────────────────────────────────────────────────────

  _sendFrame(opcode, obj) {
    this._sendRaw(opcode, Buffer.from(JSON.stringify(obj), 'utf8'));
  }

  _sendRaw(opcode, payload) {
    const sock = this._socket;
    if (!sock || sock.destroyed) return;
    const header = Buffer.alloc(8);
    header.writeInt32LE(opcode, 0);
    header.writeUInt32LE(payload.length, 4);
    try {
      sock.write(Buffer.concat([header, payload]));
    } catch (e) {
      console.warn('[discord-rpc] write failed:', e.message);
    }
  }

  // ── Activity 构建与推送 ───────────────────────────────────────────────────

  /** 切歌 / 状态变化可能连续到来，合并到同一 tick 只推一次。 */
  _scheduleUpdate() {
    if (this._updateTimer) return;
    this._updateTimer = setTimeout(() => {
      this._updateTimer = null;
      this._pushActivity();
    }, 50);
    if (this._updateTimer.unref) this._updateTimer.unref();
  }

  /**
   * 根据当前曲目与播放状态构建 activity；无内容可显示时返回 null（调用方清除）。
   * @returns {object|null}
   */
  _buildActivity() {
    if (!this._enabled) return null;
    const track = this._player.currentTrack;
    if (!track) return null;

    const state = this._player.state;
    if (state === 'stopped') return null;

    const isPlaying = state === 'playing';
    const isLoading = state === 'loading';
    if (!isPlaying && !isLoading && state !== 'paused') return null;
    if (state === 'paused' && !this._showPaused) return null;

    const title = _cleanText(track.title) || 'Unknown Track';
    const artist = _cleanText(track.artist) || 'Unknown Artist';
    const album = _cleanText(track.album) || 'Unknown Album';
    const albumArtist = _cleanText(track.album_artist) || artist;

    const brief = _cleanText(_applyTemplate(this._briefFormat, {
      title, artist, album, album_artist: albumArtist,
    })) || artist;

    const activity = {
      type: ACTIVITY_TYPE_LISTENING,
      details: _truncate(title),
      // 暂停时加 ⏸ 前缀；loading 是切歌过渡态，不加标记避免闪烁
      state: _truncate(state === 'paused' ? PAUSE_PREFIX + brief : brief),
    };

    if (isPlaying) {
      const ts = this._timestamps();
      if (ts) activity.timestamps = ts;
    }
    return activity;
  }

  /** 播放中的绝对时间戳（epoch 秒），进度条由 Discord 客户端渲染。 */
  _timestamps() {
    const pos = this._player.position || 0;
    const dur = this._player.duration || 0;
    if (dur <= 0) return null;
    const nowSec = Math.floor(Date.now() / 1000);
    const start = nowSec - Math.floor(pos / 1000);
    const end = start + Math.floor(dur / 1000);
    return { start, end };
  }

  _pushActivity() {
    if (!this._connected || !this._handshaked) return;
    const activity = this._buildActivity();
    if (!activity) {
      this._clearActivity();
      return;
    }
    this._sendFrame(OP_FRAME, {
      cmd: 'SET_ACTIVITY',
      args: { pid: process.pid, activity },
      nonce: String(++this._nonce),
    });
  }

  _clearActivity() {
    if (!this._connected || !this._handshaked) return;
    this._sendFrame(OP_FRAME, {
      cmd: 'CLEAR_ACTIVITY',
      args: { pid: process.pid },
      nonce: String(++this._nonce),
    });
  }
}

// ── 文本工具 ────────────────────────────────────────────────────────────────

/** Discord 文本字段不允许换行；压缩空白并去首尾。 */
function _cleanText(s) {
  return String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
}

/** 替换 {title} {artist} {album} {album_artist}；未识别的占位符移除。 */
function _applyTemplate(fmt, vars) {
  let out = String(fmt || '');
  out = out.replace(/\{title\}/g, vars.title)
    .replace(/\{artist\}/g, vars.artist)
    .replace(/\{album\}/g, vars.album)
    .replace(/\{album_artist\}/g, vars.album_artist);
  out = out.replace(/\{[a-z_]+\}/gi, '');
  // 未知占位符移除后尾部可能留下悬空分隔符（"A · B · {typo}" → "A · B ·" → "A · B"）。
  // 代价：曲名/歌手自身以这些字符结尾时也会被修掉——对状态行而言可接受。
  out = out.replace(/[\s\u00b7\u2013\u2014|/-]+$/, '');
  return out;
}

function _truncate(s) {
  const str = String(s || '');
  return str.length > MAX_FIELD_LEN ? str.slice(0, MAX_FIELD_LEN - 1) + '\u2026' : str;
}

module.exports = { DiscordRpcController };
