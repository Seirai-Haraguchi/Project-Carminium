'use strict';

const net = require('net');
const path = require('path');
const { ipcMain } = require('electron');

const OP_HANDSHAKE = 0;
const OP_FRAME = 1;
const OP_CLOSE = 2;
const OP_PING = 3;
const OP_PONG = 4;

const ACTIVITY_TYPE_LISTENING = 2;

const CONNECT_TIMEOUT_MS = 800;
const HANDSHAKE_TIMEOUT_MS = 3000;
const RECONNECT_DELAY_MS = 15000;
const HANDSHAKE_ERR_RETRY_MS = 30000;

const MAX_FIELD_LEN = 128;

const PAUSE_PREFIX = '\u23F8 ';

const DEFAULT_BRIEF_FORMAT = '{artist}';

class DiscordRpcController {
  constructor(player, settings) {
    this._player = player;
    this._settings = settings;
    this._bridge = null;

    this._socket = null;
    this._connected = false;
    this._handshaked = false;
    this._connecting = false;
    this._closed = false;
    this._gen = 0;

    this._enabled = !!settings.get('discord_rpc', false);
    this._showPaused = settings.get('discord_rpc_show_paused', true) !== false;
    this._briefFormat = String(settings.get('discord_rpc_brief_format', DEFAULT_BRIEF_FORMAT) || DEFAULT_BRIEF_FORMAT);
    this._clientId = String(settings.get('discord_rpc_client_id', '') || '').trim();
    this._username = '';

    this._retryTimer = null;
    this._handshakeTimer = null;
    this._updateTimer = null;

    this._nonce = 0;
    this._lastPushedStatus = '';

    ipcMain.handle('discord_rpc_status', () => this.getStatus());

    player.on('track_changed', () => this._scheduleUpdate());
    player.on('state_changed', () => this._scheduleUpdate());
  }

  setBridge(bridge) {
    this._bridge = bridge;
    if (bridge && typeof bridge.on === 'function') {
      bridge.on('settings_changed', (settingsJson) => this.onSettingsChanged(settingsJson));
    }
  }


  start() {
    if (this._enabled && this._clientId) {
      this._connect();
    } else {
      this._setStatus(this._enabled ? 'disconnected' : 'disabled');
    }
  }

  stop() {
    this._closed = true;
    this._clearRetry();
    this._clearHandshakeTimer();
    if (this._updateTimer) {
      clearTimeout(this._updateTimer);
      this._updateTimer = null;
    }
    if (this._connected) {
      try { this._clearActivity(); } catch {  }
      try { this._sendFrame(OP_CLOSE, {}); } catch {  }
    }
    const sock = this._socket;
    this._socket = null;
    this._connected = false;
    this._handshaked = false;
    if (sock) {
      try { sock.end(); } catch {  }
      const t = setTimeout(() => { try { sock.destroy(); } catch {  } }, 150);
      if (t.unref) t.unref();
    }
  }


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
        this._clearRetry();
        this._clearActivity();
        this._destroySocket();
        this._setStatus('disabled');
        return;
      }
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
          this._connect();
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
    if (this._bridge && typeof this._bridge._emit === 'function') {
      this._bridge._emit('discord_status', status);
    }
  }


  _ipcPaths() {
    const paths = [];
    if (process.platform === 'win32') {
      for (let i = 0; i < 10; i++) {
        paths.push('\\\\.\\pipe\\discord-ipc-' + i);
      }
      return paths;
    }
    const bases = [];
    const xdg = process.env.XDG_RUNTIME_DIR;
    if (xdg) {
      bases.push(xdg);
      bases.push(path.join(xdg, 'app', 'com.discordapp.Discord'));
    }
    bases.push('/tmp');
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
    this._destroySocket();
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
      if (ok) return;
    }

    if (gen !== this._gen) return;
    this._connecting = false;
    this._setStatus('disconnected');
    this._scheduleRetry(RECONNECT_DELAY_MS);
  }

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
          try { sock.destroy(); } catch {  }
          done(false);
          return;
        }
        sock.setTimeout(0);
        this._socket = sock;
        this._wireSocket(sock, gen);
        this._sendFrame(OP_HANDSHAKE, { v: 1, client_id: this._clientId });
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
        try { sock.destroy(); } catch {  }
        done(false);
      });
      sock.once('timeout', () => {
        try { sock.destroy(); } catch {  }
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
      while (buffer.length >= 8) {
        const opcode = buffer.readInt32LE(0);
        const length = buffer.readUInt32LE(4);
        if (buffer.length < 8 + length) break;
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
      console.warn('[discord-rpc] socket error:', e.message);
    });
  }

  _onFrame(opcode, payload, gen) {
    if (gen !== this._gen) return;
    if (opcode === OP_PING) {
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
      this._pushActivity();
    } else if (json.evt === 'ERROR') {
      const msg = (json.data && json.data.message) || 'unknown error';
      console.warn('[discord-rpc] protocol error:', msg);
      if (!this._handshaked) {
        this._clearHandshakeTimer();
        this._connecting = false;
        this._destroySocket();
        this._setStatus('disconnected');
        this._scheduleRetry(HANDSHAKE_ERR_RETRY_MS);
      }
    }
  }

  _onClose(gen) {
    if (gen !== this._gen) return;
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
      try { sock.destroy(); } catch {  }
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


  _scheduleUpdate() {
    if (this._updateTimer) return;
    this._updateTimer = setTimeout(() => {
      this._updateTimer = null;
      this._pushActivity();
    }, 50);
    if (this._updateTimer.unref) this._updateTimer.unref();
  }

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
      state: _truncate(state === 'paused' ? PAUSE_PREFIX + brief : brief),
    };

    if (isPlaying) {
      const ts = this._timestamps();
      if (ts) activity.timestamps = ts;
    }
    return activity;
  }

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


function _cleanText(s) {
  return String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
}

function _applyTemplate(fmt, vars) {
  let out = String(fmt || '');
  out = out.replace(/\{title\}/g, vars.title)
    .replace(/\{artist\}/g, vars.artist)
    .replace(/\{album\}/g, vars.album)
    .replace(/\{album_artist\}/g, vars.album_artist);
  out = out.replace(/\{[a-z_]+\}/gi, '');
  out = out.replace(/[\s\u00b7\u2013\u2014|/-]+$/, '');
  return out;
}

function _truncate(s) {
  const str = String(s || '');
  return str.length > MAX_FIELD_LEN ? str.slice(0, MAX_FIELD_LEN - 1) + '\u2026' : str;
}

module.exports = { DiscordRpcController };
