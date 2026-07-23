/**
 * Carminium — Windows System Media Transport Controls 集成
 *
 * Electron 版本中，SMTC 由 Chromium 内置的 navigator.mediaSession API 提供。
 * 本模块在主进程中：
 * 1. 监听 Player 事件，通过 IPC 转发到渲染进程更新 navigator.mediaSession
 * 2. 接收渲染进程的媒体按钮事件，转发到 Player
 * 3. 支持控制中心歌词模式（将当前歌词行作为标题显示）
 */
'use strict';

class SmtcController {
  constructor(player, library = null, settings = null) {
    this._player = player;
    this._library = library;
    this._settings = settings;
    this._mainWindow = null;

    // 控制中心歌词状态
    this._lyricsEntries = [];
    this._currentLyricIdx = -1;
    this._smtcLyricsOn = false;
    if (settings) {
      this._smtcLyricsOn = !!settings.get('smtc_lyrics', false);
    }

    // ── Player → SMTC 信号连接 ──
    player.on('track_changed', (trackJson) => this._onTrackChanged(trackJson));
    player.on('state_changed', (state) => this._onStateChanged(state));
    player.on('position_changed', (pos) => this._onPositionChanged(pos));
    player.on('duration_changed', (dur) => this._onDurationChanged(dur));
    player.on('shuffle_changed', (enabled) => this._onShuffleChanged(enabled));
    player.on('repeat_changed', (mode) => this._onRepeatChanged(mode));
    player.on('lyrics_changed', (trackId) => this._onLyricsChanged(trackId));
  }

  setMainWindow(win) {
    this._mainWindow = win;
    if (win) {
      // 窗口加载完成后推送初始 SMTC 状态
      if (win.webContents.isLoading()) {
        win.webContents.once('did-finish-load', () => this._sendInitialState());
      } else {
        this._sendInitialState();
      }
    }
  }

  /**
   * 向渲染进程推送当前播放状态（用于窗口加载后的初始化）
   */
  async _sendInitialState() {
    const track = this._player.currentTrack;
    if (track) {
      await this._updateTrack(null);
    }
    // 推送当前播放状态
    this._onStateChanged(this._player.state);
    this._onPositionChanged(this._player.position);
    this._onDurationChanged(this._player.duration);
    this._onShuffleChanged(this._player.shuffle);
    this._onRepeatChanged(this._player.repeat);
  }

  setBridge(bridge) {
    // Bridge 的 settings_changed 事件
    bridge.on('settings_changed', (settingsJson) => {
      this._onSettingsChanged(settingsJson);
    });
  }

  _sendToRenderer(channel, data) {
    if (this._mainWindow && !this._mainWindow.isDestroyed()) {
      this._mainWindow.webContents.send(channel, data);
    }
  }

  // ── Settings ─────────────────────────────────────────────────────────────

  _onSettingsChanged(settingsJson) {
    let data;
    try {
      data = JSON.parse(settingsJson);
    } catch {
      return;
    }
    if ('smtc_lyrics' in data) {
      this._smtcLyricsOn = !!data['smtc_lyrics'];
      this._currentLyricIdx = -1;
      this._updateTrack(null);
    }
  }

  // ── 歌词更新处理 ─────────────────────────────────────────────────────────

  _onLyricsChanged(_trackId) {
    this._currentLyricIdx = -1;
    this._updateTrack(null);
  }

  // ── Player 事件处理 ──────────────────────────────────────────────────────

  _onTrackChanged(trackJson) {
    this._updateTrack(trackJson);
  }

  _onStateChanged(state) {
    const statusMap = {
      'playing': 'playing',
      'paused': 'paused',
      'stopped': 'none',
    };
    this._sendToRenderer('smtc:state', statusMap[state] || 'none');
  }

  _onPositionChanged(pos) {
    this._sendToRenderer('smtc:position', { position: pos, duration: this._player.duration });
    // 控制中心歌词模式：按播放位置更新标题
    this._updateLyricTitle(pos);
  }

  _onDurationChanged(dur) {
    this._sendToRenderer('smtc:duration', dur);
  }

  _onShuffleChanged(enabled) {
    this._sendToRenderer('smtc:shuffle', enabled);
  }

  _onRepeatChanged(mode) {
    const repeatMap = {
      'off': 'none',
      'all': 'sequence',
      'one': 'repeatone',
    };
    this._sendToRenderer('smtc:repeat', repeatMap[mode] || 'none');
  }

  // ── 封面数据 ─────────────────────────────────────────────────────────────

  async _loadCoverDataUrl(track) {
    if (!this._library) return null;
    const trackId = track.id || '';
    if (!trackId) return null;

    if (track.source === 'subsonic') {
      try {
        const data = await this._library.getSubsonicCoverData(trackId);
        if (data) return 'data:image/jpeg;base64,' + Buffer.from(data).toString('base64');
      } catch {
        return null;
      }
      return null;
    }

    try {
      const data = this._library.getCoverData(trackId);
      if (data) return 'data:image/jpeg;base64,' + Buffer.from(data).toString('base64');
    } catch {
      return null;
    }
    return null;
  }

  // ── 曲目更新 ─────────────────────────────────────────────────────────────

  async _updateTrack(_trackJson) {
    const track = this._player.currentTrack;
    if (!track) return;

    const title = String(track.title || '未知曲目');
    const artist = String(track.artist || '未知艺术家');
    const album = String(track.album || '');

    // 控制中心歌词模式
    if (this._smtcLyricsOn) {
      const lrcText = String(track.lyrics || '');
      this._lyricsEntries = parseLrcOriginalLines(lrcText);
      this._currentLyricIdx = -1;

      if (this._lyricsEntries.length > 0) {
        this._updateLyricTitle(this._player.position);
      } else {
        // 无歌词：歌名位置回退显示歌名
        this._sendToRenderer('smtc:metadata', {
          title,
          artist: `${title} - ${artist}`,
          album,
          albumArtist: String(track.album_artist || track.artist || ''),
          artwork: null,
        });
      }
    } else {
      this._lyricsEntries = [];
      this._currentLyricIdx = -1;

      // 获取封面
      const artwork = await this._loadCoverDataUrl(track);

      this._sendToRenderer('smtc:metadata', {
        title,
        artist,
        album,
        albumArtist: String(track.album_artist || track.artist || ''),
        artwork,
      });
    }

    // 更新时间轴
    this._onDurationChanged(this._player.duration);
    this._onPositionChanged(this._player.position);
    this._onShuffleChanged(this._player.shuffle);
    this._onRepeatChanged(this._player.repeat);
  }

  // ── 控制中心歌词：按播放位置更新标题 ───────────────────────────────────

  _updateLyricTitle(positionMs) {
    if (!this._smtcLyricsOn || this._lyricsEntries.length === 0) return;

    let idx = -1;
    for (let i = 0; i < this._lyricsEntries.length; i++) {
      if (positionMs >= this._lyricsEntries[i][0]) {
        idx = i;
      } else {
        break;
      }
    }
    if (idx < 0) idx = 0;
    if (idx === this._currentLyricIdx) return;

    this._currentLyricIdx = idx;
    const text = this._lyricsEntries[idx][1];
    if (!text) return;

    this._sendToRenderer('smtc:lyric_title', text);
  }
}

// ── LRC 解析（与前端 parseLRC 分组逻辑一致）─────────────────────────────────

const LRC_TIME_REGEX = /\[(\d{2}):(\d{2})[.:](\d{2,3})\]/g;
const WORD_TIME_REGEX = /<\d{2}:\d{2}[.:]\d{2,3}>/g;

function parseLrcOriginalLines(lrcText) {
  if (!lrcText) return [];
  const entries = [];
  for (const line of lrcText.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const times = [];
    let lastIdx = 0;
    LRC_TIME_REGEX.lastIndex = 0;
    let m;
    while ((m = LRC_TIME_REGEX.exec(trimmed)) !== null) {
      const mm = parseInt(m[1], 10);
      const ss = parseInt(m[2], 10);
      let cs = parseInt(m[3], 10);
      if (m[3].length === 2) cs *= 10;
      times.push(mm * 60000 + ss * 1000 + cs);
      lastIdx = m.index + m[0].length;
    }
    if (times.length === 0) continue;

    const rawText = trimmed.slice(lastIdx).trim();
    const plainText = rawText.replace(WORD_TIME_REGEX, '');
    for (const t of times) {
      entries.push([t, plainText]);
    }
  }
  entries.sort((a, b) => a[0] - b[0]);

  // 同时间戳分组（≤30ms），只取每组的第一个非空文本（原文）
  const result = [];
  let k = 0;
  while (k < entries.length) {
    let j = k + 1;
    while (j < entries.length && Math.abs(entries[j][0] - entries[k][0]) <= 30) {
      j++;
    }
    const text = entries[k][1];
    if (text) {
      result.push([entries[k][0], text]);
    }
    k = j;
  }
  return result;
}

module.exports = { SmtcController, parseLrcOriginalLines };
