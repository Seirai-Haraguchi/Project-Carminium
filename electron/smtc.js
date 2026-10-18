'use strict';

class SmtcController {
  constructor(player, library = null, settings = null) {
    this._player = player;
    this._library = library;
    this._settings = settings;
    this._mainWindow = null;

    this._lyricsEntries = [];
    this._currentLyricIdx = -1;
    this._smtcLyricsOn = false;
    if (settings) {
      this._smtcLyricsOn = !!settings.get('smtc_lyrics', false);
    }

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
      if (win.webContents.isLoading()) {
        win.webContents.once('did-finish-load', () => this._sendInitialState());
      } else {
        this._sendInitialState();
      }
    }
  }

  async _sendInitialState() {
    const track = this._player.currentTrack;
    if (track) {
      await this._updateTrack(null);
    }
    this._onStateChanged(this._player.state);
    this._onPositionChanged(this._player.position);
    this._onDurationChanged(this._player.duration);
    this._onShuffleChanged(this._player.shuffle);
    this._onRepeatChanged(this._player.repeat);
  }

  setBridge(bridge) {
    bridge.on('settings_changed', (settingsJson) => {
      this._onSettingsChanged(settingsJson);
    });

  }

  _sendToRenderer(channel, data) {
    if (this._mainWindow && !this._mainWindow.isDestroyed()) {
      this._mainWindow.webContents.send(channel, data);
    }
  }


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


  _onLyricsChanged(_trackId) {
    this._currentLyricIdx = -1;
    this._updateTrack(null);
  }


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
      const r = await this._library.getCoverDataAsync(trackId);
      const data = r ? r.data : null;
      if (data) return 'data:image/jpeg;base64,' + Buffer.from(data).toString('base64');
    } catch {
      return null;
    }
    return null;
  }


  async _updateTrack(_trackJson) {
    const track = this._player.currentTrack;
    if (!track) return;

    const title = String(track.title || '未知曲目');
    const artist = String(track.artist || '未知艺术家');
    const album = String(track.album || '');

    const artwork = await this._loadCoverDataUrl(track);

    if (this._smtcLyricsOn) {
      const lrcText = String(track.lyrics || '');
      this._lyricsEntries = parseLrcOriginalLines(lrcText);
      this._currentLyricIdx = -1;

      this._sendToRenderer('smtc:metadata', {
        title,
        artist: `${title} - ${artist}`,
        album,
        albumArtist: String(track.album_artist || track.artist || ''),
        artwork,
      });

      if (this._lyricsEntries.length > 0) {
        this._updateLyricTitle(this._player.position);
      }
    } else {
      this._lyricsEntries = [];
      this._currentLyricIdx = -1;

      this._sendToRenderer('smtc:metadata', {
        title,
        artist,
        album,
        albumArtist: String(track.album_artist || track.artist || ''),
        artwork,
      });
    }

    this._onDurationChanged(this._player.duration);
    this._onPositionChanged(this._player.position);
    this._onShuffleChanged(this._player.shuffle);
    this._onRepeatChanged(this._player.repeat);
  }


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


const LRC_TIME_REGEX = /\[(\d{2}):(\d{2})(?:[.:](\d{2,3}))?\]/g;
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
      let cs = 0;
      if (m[3] !== undefined) {
        cs = parseInt(m[3], 10);
        if (m[3].length === 2) cs *= 10;
      }
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
