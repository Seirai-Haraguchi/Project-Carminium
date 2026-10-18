'use strict';

const { EventEmitter } = require('events');
const { ipcMain, dialog, app, shell, BrowserWindow, net, nativeImage } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

let AnalysisCache = null;
let OsuBeatmapProvider = null;
try {
  ({ AnalysisCache } = require('./analysis_cache'));
} catch (e) {
  console.warn('[bridge] AnalysisCache module not available:', e.message);
}
try {
  ({ OsuBeatmapProvider } = require('./osu_beatmap_provider'));
} catch (e) {
  console.warn('[bridge] OsuBeatmapProvider module not available:', e.message);
}

let LoudnessAnalyzer = null;
try {
  ({ LoudnessAnalyzer } = require('./loudness'));
} catch (e) {
  console.warn('[bridge] LoudnessAnalyzer module not available:', e.message);
}

let AudioQualityProbe = null;
let _qualityClassifyFromSuffix = null;
let _qualityClassifyFromPath = null;
try {
  ({
    AudioQualityProbe,
    classifyFromSuffix: _qualityClassifyFromSuffix,
    classifyFromPath: _qualityClassifyFromPath,
  } = require('./audio_quality'));
} catch (e) {
  console.warn('[bridge] AudioQualityProbe module not available:', e.message);
}

const { LibraryWorkerHost } = require('./library_worker_host');

const _syncingServers = new Set();
const _syncingWebDAVServers = new Set();
const _syncingSMBServers = new Set();

function _dump(obj) {
  return JSON.stringify(obj, null, undefined);
}

const FLOATING_EVENTS = new Set([
  'track_changed',
  'playback_state_changed',
  'position_changed',
  'duration_changed',
  'volume_changed',
  'shuffle_changed',
  'repeat_changed',
  'queue_changed',
  'liked_changed',
  'lyrics_changed',
  'settings_changed',
]);

class Bridge extends EventEmitter {
  constructor(library, player, settings, coverServer, bass = null) {
    super();
    this._lib = library;
    this._player = player;
    this._settings = settings;
    this._coverServer = coverServer;
    this._bass = bass;
    this._mainWindow = null;
    this._floatingWindow = null;
    this._floatingOpening = false;
    this._floatingClosedCallback = null;

    // 库工作线程：扫描 + 长列表计算都在这里跑，主进程只中转状态
    this._scanWorker = new LibraryWorkerHost(settings, (status) => {
      try { this._emit('library_scan_status', _dump(status)); } catch {  }
    });

    this._analysisCache = AnalysisCache ? new AnalysisCache() : null;
    this._osuProvider = OsuBeatmapProvider ? new OsuBeatmapProvider() : null;
    this._currentTransitionPlan = null;
    if (this._analysisCache) {
      console.log('[bridge] AnalysisCache initialized');
    }
    if (this._osuProvider) {
      console.log('[bridge] OsuBeatmapProvider initialized');
    }

    this._loudness = LoudnessAnalyzer ? new LoudnessAnalyzer() : null;
    if (this._loudness) {
      this._loudness.setResultHandler((key, entry, filePath) => {

        this._emit('loudness_ready', {
          key: key,
          filePath: filePath || '',
          integratedLufs: entry.i,
          peakDb: entry.peak,
        });
      });
      console.log('[bridge] LoudnessAnalyzer initialized');
    }

    this._quality = AudioQualityProbe ? new AudioQualityProbe() : null;
    if (this._quality) {
      this._quality.setResultHandler((key, entry, ctx) => {
        this._emit('quality_ready', {
          key: key,
          trackId: (ctx && ctx.trackId) || '',
          filePath: (ctx && ctx.filePath) || '',
          quality: entry.q,
          codec: entry.codec || '',
          sampleRate: entry.sr || 0,
          bitsPerSample: entry.bits || 0,
          bitrate: entry.br || 0,
        });
      });
      console.log('[bridge] AudioQualityProbe initialized');
    }

    try {
      const { getInstance: getMemoryManager } = require('./memory_manager');
      const memMgr = getMemoryManager();
      memMgr.onCleanup(() => {

        if (this._analysisCache && this._analysisCache._dirty) {
          try { this._analysisCache.flush(); } catch (e) {
            console.warn('[bridge] AnalysisCache flush during cleanup failed:', e.message);
          }
        }
      });

      memMgr.onEmergencyCleanup(() => {

        if (this._coverServer && typeof this._coverServer.clearResizeCache === 'function') {
          try { this._coverServer.clearResizeCache(); } catch (e) {  }
        }

        if (this._lib && this._lib._coverDataCache) {
          try {
            this._lib._coverDataCache.clear();
            this._lib._coverDataCacheBytes = 0;
          } catch (e) {  }
        }

        this._allTracksJson = null;
        this._allTracksJsonDirty = true;
        this._foldersJson = null;
        this._foldersJsonDirty = true;
      });
    } catch (e) {
      console.warn('[bridge] Memory manager integration failed:', e.message);
    }

    player.on('track_changed', (trackJson) => {
      this._onTrackChanged(trackJson);
    });
    player.on('state_changed', (state) => this._emit('playback_state_changed', state));
    player.on('position_changed', (pos) => this._emit('position_changed', pos));
    player.on('duration_changed', (dur) => this._emit('duration_changed', dur));
    player.on('volume_changed', (vol) => this._emit('volume_changed', vol));
    player.on('shuffle_changed', (enabled) => this._emit('shuffle_changed', enabled));
    player.on('repeat_changed', (mode) => this._emit('repeat_changed', mode));
    player.on('queue_changed', (queueJson) => this._emit('queue_changed', queueJson));
    player.on('liked_changed', (liked) => this._emit('liked_changed', liked));
    player.on('lyrics_changed', (trackId) => this._emit('lyrics_changed', trackId));
    player.on('automix_takeover', () => this._emit('automix_takeover'));
player.on('playback_error', (errJson) => this._emit('playback_error', errJson));

    player.on('settings_changed', (settingsJson) => {
      this.emit('settings_changed', settingsJson);
      this._emit('settings_changed', settingsJson);
    });

    const renderer = player._renderer;
    if (renderer) {
      renderer.sendPcmToRenderer = (channel, float32Array) => {
        this._sendAudioPcm(channel, float32Array);
      };
      renderer.sendFfmpegState = (channel, finished) => {
        this._sendFfmpegState(channel, finished);
      };
    }

    player.on('audio_control', (json) => {

      const js = 'if (window.__handleAudioControl) { window.__handleAudioControl(' + json + '); }';
      if (this._mainWindow && !this._mainWindow.isDestroyed()) {
        this._mainWindow.webContents.executeJavaScript(js).catch(() => {});
      }
    });

    player.on('audio_control_await', (json, done) => {
      const js = '(window.__handleAudioControl ? window.__handleAudioControl(' + json + ') : null)';
      const win = this._mainWindow;
      if (!win || win.isDestroyed()) { done(undefined); return; }
      win.webContents.executeJavaScript(js, true)
        .then((v) => done(v))
        .catch((e) => {
          console.warn('[bridge] audio_control_await failed:', (e && e.message) || e);
          done(undefined);
        });
    });
  }

  setMainWindow(win) {
    this._mainWindow = win;
  }

  _LIBRARY_UPDATED_DEBOUNCE_MS = 500;
  _allTracksJson = null;
  _allTracksJsonDirty = true;
  _foldersJson = null;
  _foldersJsonDirty = true;
  _albumsJson = null;
  _albumsJsonDirty = true;
  _artistsJson = null;
  _artistsJsonDirty = true;
  _libraryUpdatedTimer = null;
  _libraryUpdatedPending = false;
  _tracksDumpInflight = null;
  _albumsDumpInflight = null;
  _artistsDumpInflight = null;

  // 库导出（tracks/albums/artists）在工作线程里计算，避免长列表排序/装饰阻塞主进程。
  // 工作线程失败时回退到主线程同步计算，保证功能可用。
  async _dumpWithFallback(dumpFn, fallbackFn, onSuccess) {
    try {
      const json = await dumpFn();
      onSuccess(json);
      return json;
    } catch (e) {
      console.warn('[bridge] 工作线程导出失败，回退主线程计算:', (e && e.message) || e);
      return _dump(fallbackFn());
    }
  }

  async _getTracksJsonAsync() {
    if (!this._allTracksJsonDirty && this._allTracksJson) return this._allTracksJson;
    if (this._tracksDumpInflight) return this._tracksDumpInflight;
    this._tracksDumpInflight = this._dumpWithFallback(
      () => this._scanWorker.dumpTracks(),
      () => this._lib.getAllTracks(),
      (json) => { this._allTracksJson = json; this._allTracksJsonDirty = false; }
    ).finally(() => { this._tracksDumpInflight = null; });
    return this._tracksDumpInflight;
  }

  async _getAlbumsJsonAsync() {
    if (!this._albumsJsonDirty && this._albumsJson) return this._albumsJson;
    if (this._albumsDumpInflight) return this._albumsDumpInflight;
    this._albumsDumpInflight = this._dumpWithFallback(
      () => this._scanWorker.dumpAlbums(),
      () => this._lib.getAlbums(),
      (json) => { this._albumsJson = json; this._albumsJsonDirty = false; }
    ).finally(() => { this._albumsDumpInflight = null; });
    return this._albumsDumpInflight;
  }

  async _getArtistsJsonAsync() {
    if (!this._artistsJsonDirty && this._artistsJson) return this._artistsJson;
    if (this._artistsDumpInflight) return this._artistsDumpInflight;
    this._artistsDumpInflight = this._dumpWithFallback(
      () => this._scanWorker.dumpArtists(),
      () => this._lib.getArtists(),
      (json) => { this._artistsJson = json; this._artistsJsonDirty = false; }
    ).finally(() => { this._artistsDumpInflight = null; });
    return this._artistsDumpInflight;
  }

  _getFoldersJsonCached() {
    if (this._foldersJsonDirty) {
      this._foldersJson = _dump(this._lib.getFolders());
      this._foldersJsonDirty = false;
    }
    return this._foldersJson;
  }

  _emitLibraryUpdated() {
    this._allTracksJsonDirty = true;
    this._foldersJsonDirty = true;
    this._albumsJsonDirty = true;
    this._artistsJsonDirty = true;
    this._libraryUpdatedPending = true;
    if (this._libraryUpdatedTimer) return;
    this._libraryUpdatedTimer = setTimeout(() => {
      this._libraryUpdatedTimer = null;
      if (!this._libraryUpdatedPending) return;
      this._libraryUpdatedPending = false;

      // 只发轻量状态通知，不再在主线程上现算整库 JSON；
      // 前端收到后按需调用 get_library / get_albums / get_artists 拉取
      this._emit('library_updated', _dump({ changed: true }));
      const foldersJson = this._getFoldersJsonCached();
      this._emit('folders_updated', foldersJson);
    }, this._LIBRARY_UPDATED_DEBOUNCE_MS);
    if (this._libraryUpdatedTimer.unref) this._libraryUpdatedTimer.unref();
  }

  _sendAudioPcm(channel, float32Array) {

    const ipcChannel = channel === 'main' ? 'audio_pcm_main' : 'audio_pcm_next';

    if (this._mainWindow && !this._mainWindow.isDestroyed()) {
      this._mainWindow.webContents.send(ipcChannel, float32Array);
    }
  }

  _sendFfmpegState(channel, finished) {

    if (this._mainWindow && !this._mainWindow.isDestroyed()) {
      this._mainWindow.webContents.send('audio_ffmpeg_state', channel, finished);
    }
  }

  _emit(event, payload) {

    if (this._mainWindow && !this._mainWindow.isDestroyed()) {
      this._mainWindow.webContents.send('bridge:event', { event, payload });
    }

    if (this._floatingWindow && !this._floatingWindow.isDestroyed() && FLOATING_EVENTS.has(event)) {
      this._floatingWindow.webContents.send('bridge:event', { event, payload });
    }

    this.emit(event, payload);
  }

  emitFloatingWindowClosed() {
    this._emit('floating_window_closed');
  }

  setFloatingClosedCallback(cb) {
    this._floatingClosedCallback = cb;
  }

  _hydrateTrackLyrics(tracks) {
    if (!Array.isArray(tracks)) return;
    let need = null;
    for (const t of tracks) {
      if (t && t.id && t.lyrics === undefined) {
        (need || (need = [])).push(t.id);
      }
    }
    if (!need) return;
    let map;
    try {
      map = this._lib.getLyricsByIds(need);
    } catch {
      return;
    }
    for (const t of tracks) {
      if (t && t.id && t.lyrics === undefined) {
        const v = map.get(t.id);

        t.lyrics = v;
      }
    }
  }

  _onTrackChanged(trackJson) {
    try {
      const track = JSON.parse(trackJson);
      const tid = track && track.id ? track.id : null;
      if (track && track.external) {

        this._lib.addExternalPlayHistory(track);
        this._emitHistoryChanged();
      } else if (tid) {
        this._lib.addPlayHistory(tid);
        this._emitHistoryChanged();
      }
    } catch {

    }
    this._emit('track_changed', trackJson);
  }

  _emitPlaylistsChanged() {
    const payload = _dump(this._lib.getPlaylists());
    this.emit('playlists_changed', payload);
    this._emit('playlists_changed', payload);
  }

  _emitHistoryChanged() {
    const payload = _dump(this._lib.getPlayHistory());
    this.emit('history_changed', payload);
    this._emit('history_changed', payload);
  }

  _emitLikedTracksChanged() {
    const payload = _dump(this._lib.getLikedTracks());
    this.emit('liked_tracks_changed', payload);
    this._emit('liked_tracks_changed', payload);
  }

  _emitSubsonicServersChanged() {
    const payload = _dump(this._lib.getSubsonicServers());
    this.emit('subsonic_servers_changed', payload);
    this._emit('subsonic_servers_changed', payload);
  }

  _emitRemoteServersChanged() {
    const payload = _dump(this._lib.getAllRemoteServers());
    this.emit('remote_servers_changed', payload);
    this._emit('remote_servers_changed', payload);

    this._emitSubsonicServersChanged();
  }

  registerIpcHandlers() {

    ipcMain.on('audio_output', (_e, arrayBuffer) => {
      const renderer = this._player._renderer;
      if (renderer && renderer.isInitialized) {
        const result = renderer.pushProcessedPcm(new Float32Array(arrayBuffer));
        if (result !== 0 && result !== -2) {
          console.error('[bridge] audio_output push failed:', result);
        }

        const latencyMs = renderer.getBufferLatencyMs();

        if (this._mainWindow && !this._mainWindow.isDestroyed()) {
          this._mainWindow.webContents.send('audio_latency', latencyMs);
        }
      }
    });

    ipcMain.on('audio_ended', () => {
      this._player._handleAudioEnded();
    });
    ipcMain.on('audio_position_tick', (_e, ms) => {
      this._player._handleAudioPositionTick(ms);
    });
    ipcMain.on('audio_crossfade_complete', (_e, positionMs) => {
      this._player._handleAudioCrossfadeComplete(positionMs);
    });
    ipcMain.on('audio_crossfade_start', () => {
      this._player._handleAudioCrossfadeStart();
    });
    ipcMain.on('audio_gapless_switch', () => {
      this._player._handleGaplessSwitch();
    });

    ipcMain.handle('ffmpeg_flow_control', (_e, opts) => {
      const renderer = this._player._renderer;
      if (!renderer || !opts) return false;
      if (opts.pause) {
        renderer.pauseStdout(opts.channel || 'main');
      } else {
        renderer.resumeStdout(opts.channel || 'main');
      }
      return true;
    });

    ipcMain.on('decode_audio_file', async (_e, filePath) => {
      if (!filePath) return;

      const sendOk = (ab) => {
        if (this._mainWindow && !this._mainWindow.isDestroyed()) {
          this._mainWindow.webContents.send('audio_file_decoded', filePath, ab);
        }
      };
      const sendErr = (msg) => {
        console.error('[bridge] decode_audio_file error:', filePath, msg);
        if (this._mainWindow && !this._mainWindow.isDestroyed()) {
          this._mainWindow.webContents.send('audio_file_decode_error', filePath, msg);
        }
      };

      try {
        if (filePath.startsWith('http://') || filePath.startsWith('https://')) {

          const resp = await net.fetch(filePath);
          if (!resp.ok) {
            sendErr(`HTTP ${resp.status}: ${resp.statusText}`);
            return;
          }
          const buf = await resp.arrayBuffer();
          sendOk(buf);
        } else {

          fs.readFile(filePath, (err, data) => {
            if (err) {
              sendErr(err.message);
              return;
            }
            const ab = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
            sendOk(ab);
          });
        }
      } catch (e) {
        sendErr(e.message);
      }
    });

    ipcMain.handle('get_library', () => this._getTracksJsonAsync());
    ipcMain.handle('get_albums', () => this._getAlbumsJsonAsync());
    ipcMain.handle('get_artists', () => this._getArtistsJsonAsync());
    ipcMain.handle('get_folders', () => this._getFoldersJsonCached());
    ipcMain.handle('get_album_tracks', (_e, albumJson) => {
      const data = JSON.parse(albumJson);
      return _dump(this._lib.getAlbumTracks(data.album || '', data.album_artist || null));
    });
    ipcMain.handle('get_artist_tracks', (_e, artist) => _dump(this._lib.getArtistTracks(artist)));
    ipcMain.handle('search_tracks', (_e, query) => _dump(this._lib.searchTracks(query)));

    ipcMain.handle('open_folder_dialog', () => {
      const result = dialog.showOpenDialogSync(this._mainWindow, {
        title: '选择音乐文件夹',
        properties: ['openDirectory'],
      });
      return (result && result.length > 0) ? result[0] : '';
    });

    ipcMain.handle('add_folder', (_e, folderPath) => {
      if (!folderPath) return _dump({ error: 'no path' });
      const folder = this._lib.addFolder(folderPath);
      const resolvedPath = folder.path || folderPath;
      const folders = this._settings.get('music_folders', []);
      if (!folders.includes(resolvedPath)) {
        folders.push(resolvedPath);
        this._settings.set('music_folders', folders);
      }
      this._scanFolderAsync(resolvedPath);

      if (this._libraryWatcher) this._libraryWatcher.syncFolders();
      return _dump(folder);
    });

    ipcMain.handle('remove_folder', (_e, folderPath) => {
      this._lib.removeFolder(folderPath);
      const folders = this._settings.get('music_folders', []);
      const idx = folders.indexOf(folderPath);
      if (idx >= 0) {
        folders.splice(idx, 1);
        this._settings.set('music_folders', folders);
      }

      if (this._libraryWatcher) this._libraryWatcher.syncFolders();
      this._player.reloadLikedTracks();
      this._emitLibraryUpdated();
      this._emitLikedTracksChanged();
    });

    ipcMain.handle('rescan_folder', (_e, folderPath) => {
      const folderInfo = this._lib.rescanFolder(folderPath);
      const resolvedPath = folderInfo.path || folderPath;

      this._scanFolderAsync(resolvedPath, true);
      return _dump(folderInfo);
    });

    ipcMain.handle('play_track', (_e, trackId) => {
      const track = this._lib.getTrack(trackId);
      if (track) this._player.playTracks([track]);
    });

    ipcMain.handle('play_from_list', (_e, tracksJson, index) => {
      const tracks = JSON.parse(tracksJson);

      this._hydrateTrackLyrics(tracks);
      this._player.playTracks(tracks, index);
    });

    ipcMain.handle('play_dropped_files', async (_e, paths) => {
      let list = paths;
      if (typeof list === 'string') {
        try { list = JSON.parse(list); } catch { list = []; }
      }
      if (!Array.isArray(list) || list.length === 0) return _dump({ count: 0, external: 0 });
      let tracks = [];
      try {
        tracks = await this._lib.resolveDroppedFiles(list);
      } catch (e) {
        console.warn('[bridge] play_dropped_files resolve failed:', (e && e.message) || e);
        return _dump({ count: 0, external: 0, error: 'resolve_failed' });
      }
      if (tracks.length === 0) return _dump({ count: 0, external: 0 });
      this._player.playTracks(tracks, 0);
      return _dump({
        count: tracks.length,
        external: tracks.filter((t) => t.external).length,
      });
    });

    ipcMain.handle('play', () => this._player.play());
    ipcMain.handle('pause', () => this._player.pause());
    ipcMain.handle('next_track', () => this._player.nextTrack());
    ipcMain.handle('prev_track', () => this._player.prevTrack());
    ipcMain.handle('seek', (_e, positionMs) => this._player.seek(positionMs));

    ipcMain.handle('set_volume', (_e, level) => {
      this._player.setVolume(level);
      this._settings.set('volume', level);
    });

    ipcMain.handle('set_shuffle', (_e, enabled) => {
      this._player.setShuffle(enabled);
      this._settings.set('shuffle', enabled);
    });

    ipcMain.handle('set_repeat', (_e, mode) => {
      this._player.setRepeat(mode);
      this._settings.set('repeat', mode);
    });

    ipcMain.handle('get_audio_devices', () => this._player.getAudioDevices());
    ipcMain.handle('set_output_device', (_e, deviceId) => {
      this._player.setOutputDevice(deviceId);
      this._settings.set('audio_output_device', deviceId);
    });

    ipcMain.handle('set_tempo', (_e, tempo) => {
      this._player.setTempo(parseFloat(tempo));
    });
    ipcMain.handle('set_pitch', (_e, pitch) => {
      this._player.setPitch(parseFloat(pitch));
    });
    ipcMain.handle('set_rate', (_e, rate) => {
      this._player.setRate(parseFloat(rate));
    });
    ipcMain.handle('get_tempo', () => this._player.tempo);
    ipcMain.handle('get_pitch', () => this._player.pitch);
    ipcMain.handle('get_rate', () => this._player.rate);

    ipcMain.handle('set_automix', (_e, enabled) => {
      this._player.setAutomixEnabled(!!enabled);
    });
    ipcMain.handle('get_automix', () => this._player.automixEnabled);
    ipcMain.handle('set_radical_transitions', (_e, enabled) => {
      this._player.setRadicalTransitionsEnabled(!!enabled);
    });
    ipcMain.handle('get_radical_transitions', () => this._player.radicalTransitionsEnabled);
    ipcMain.handle('set_crossfade_duration', (_e, ms) => {
      this._player.setCrossfadeDuration(parseInt(ms, 10));
    });
    ipcMain.handle('get_crossfade_duration', () => this._player.crossfadeDurationMs);

    ipcMain.handle('get_system_accent_color', async () => _getSystemAccentColor());

    ipcMain.handle('set_gapless', (_e, enabled) => {
      this._player.setGaplessEnabled(!!enabled);
    });
    ipcMain.handle('get_gapless', () => this._player.gaplessEnabled);

    ipcMain.handle('get_track_analysis', (_e, trackId) => {
      if (!this._analysisCache || !trackId) return null;
      try {
        return this._analysisCache.get(trackId);
      } catch (e) {
        console.warn('[bridge] get_track_analysis error:', e.message);
        return null;
      }
    });

    ipcMain.handle('save_track_analysis', (_e, trackId, analysis) => {
      if (!this._analysisCache || !trackId || !analysis) return;
      try {
        this._analysisCache.set(trackId, analysis);
      } catch (e) {
        console.warn('[bridge] save_track_analysis error:', e.message);
      }
    });

    ipcMain.handle('get_track_loudness', async (_e, trackId, filePath) => {
      if (!this._loudness) return null;
      try {
        const key = LoudnessAnalyzer.keyFor(trackId, filePath);
        const cached = this._loudness.get(key);
        if (cached) {

          return cached.unsupported
            ? { key: key, unsupported: true }
            : { key: key, integratedLufs: cached.i, peakDb: cached.peak };
        }

        this._loudness.request(key, filePath).catch(() => {});
        const settled = this._loudness.get(key);
        if (settled) {
          return settled.unsupported
            ? { key: key, unsupported: true }
            : { key: key, integratedLufs: settled.i, peakDb: settled.peak };
        }
        return { key: key, pending: true };
      } catch (e) {
        console.warn('[bridge] get_track_loudness error:', e.message);
        return null;
      }
    });

    ipcMain.handle('analyze_track_loudness', async (_e, trackId, filePath) => {
      if (!this._loudness) return null;
      try {
        const key = LoudnessAnalyzer.keyFor(trackId, filePath);
        const entry = await this._loudness.request(key, filePath);
        if (!entry || entry.unsupported) return null;
        return { integratedLufs: entry.i, peakDb: entry.peak, key: key };
      } catch (e) {
        console.warn('[bridge] analyze_track_loudness error:', e.message);
        return null;
      }
    });

    ipcMain.handle('get_track_quality', async (_e, trackId, filePath, suffix) => {
      try {
        const id = trackId || '';
        const p = filePath || '';

        // 流媒体（Subsonic / WebDAV / HTTP）不探测，用服务器给的 suffix 兜底
        const isStream = !p
          || /^(subsonic|webdav|smb):\/\//i.test(p)
          || /^https?:\/\//i.test(p);
        if (isStream) {
          const q = _qualityClassifyFromSuffix ? _qualityClassifyFromSuffix(suffix) : null;
          return q ? { key: '', quality: q, stream: true } : { key: '', unsupported: true };
        }

        const key = AudioQualityProbe
          ? AudioQualityProbe.keyFor(id, p)
          : (id || p);
        if (!this._quality) {
          const q = _qualityClassifyFromPath ? _qualityClassifyFromPath(p) : null;
          return q ? { key: key, quality: q } : { key: key, unsupported: true };
        }

        const cached = this._quality.get(key);
        if (cached) {
          return cached.unsupported
            ? { key: key, unsupported: true }
            : {
              key: key,
              quality: cached.q,
              codec: cached.codec || '',
              sampleRate: cached.sr || 0,
              bitsPerSample: cached.bits || 0,
              bitrate: cached.br || 0,
            };
        }

        this._quality.request(key, p, { trackId: id, filePath: p }).catch(() => {});
        return { key: key, pending: true };
      } catch (e) {
        console.warn('[bridge] get_track_quality error:', e.message);
        return null;
      }
    });

    ipcMain.handle('search_osu_beatmap', async (_e, title, artist, durationMs) => {
      if (!this._osuProvider || !title) return null;
      try {
        return await this._osuProvider.search(title, artist, durationMs);
      } catch (e) {
        console.warn('[bridge] search_osu_beatmap error:', e.message);
        return null;
      }
    });

    ipcMain.handle('set_transition_plan', (_e, plan) => {
      this._currentTransitionPlan = plan || null;
      if (plan) {
        console.log('[bridge] Transition plan received: start=' + plan.transitionStartMs +
          'ms, duration=' + plan.crossfadeDurationMs + 'ms, confidence=' + plan.confidence);
      }
      return true;
    });

    ipcMain.handle('get_cover_base_url', () => this._coverServer.baseUrl);
    ipcMain.handle('get_media_base_url', () => this._coverServer.mediaBaseUrl);

    ipcMain.handle('prefetch_artist_images', (_e, namesJson) => {
      try {
        const names = JSON.parse(namesJson || '[]');
        if (this._coverServer && typeof this._coverServer.prefetchArtistImages === 'function') {
          return this._coverServer.prefetchArtistImages(names);
        }
        return { queued: 0, error: 'cover server unavailable' };
      } catch (e) {
        return { queued: 0, error: e && e.message };
      }
    });

    ipcMain.handle('prefetch_artist_aliases', (_e, namesJson) => {
      try {
        const names = JSON.parse(namesJson || '[]');
        if (this._coverServer && typeof this._coverServer.prefetchArtistAliases === 'function') {
          return this._coverServer.prefetchArtistAliases(names);
        }
        return { queued: 0, error: 'cover server unavailable' };
      } catch (e) {
        return { queued: 0, error: e && e.message };
      }
    });

    ipcMain.handle('find_video_for_track', (_e, trackId) => {
      const track = this._lib.getTrack(trackId);
      if (!track || track.source === 'subsonic') return null;
      const trackPath = track.path;
      if (!trackPath) return null;

      const dir = path.dirname(trackPath);
      const baseName = path.basename(trackPath, path.extname(trackPath));

      const VIDEO_EXTS = ['.mp4', '.m4v', '.webm', '.mkv', '.mov', '.avi', '.flv', '.wmv', '.mpg', '.mpeg', '.ts'];

      for (const vext of VIDEO_EXTS) {
        const videoPath = path.join(dir, baseName + vext);
        if (fs.existsSync(videoPath)) {

          const b64 = Buffer.from(videoPath, 'utf-8').toString('base64')
            .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
          const url = this._coverServer.baseUrl + '/video/' + b64;
          return { path: videoPath, url: url };
        }
      }
      return null;
    });

    ipcMain.handle('search_netease_lyrics', async (_e, query) => {
      const { search } = require('./lyrics');
      return search(query);
    });
    ipcMain.handle('fetch_netease_lyrics', async (_e, songId) => {
      const { fetchLyrics } = require('./lyrics');
      return fetchLyrics(songId);
    });

    ipcMain.handle('search_lyrics', async (_e, query, source) => {
      const { searchLyrics } = require('./lyrics');
      return searchLyrics(query, source);
    });
    ipcMain.handle('fetch_lyrics', async (_e, songId, source) => {
      const { fetchLyricsById } = require('./lyrics');
      return fetchLyricsById(songId, source);
    });

    ipcMain.handle('add_next', (_e, trackJson) => {
      const track = JSON.parse(trackJson);
      this._player.addNext(track);
    });
    ipcMain.handle('append_queue', (_e, trackJson) => {
      const track = JSON.parse(trackJson);
      this._player.appendQueue(track);
    });
    ipcMain.handle('remove_from_queue', (_e, index) => this._player.removeFromQueue(index));
    ipcMain.handle('reorder_queue', (_e, fromIndex, toIndex) => this._player.reorderQueue(fromIndex, toIndex));
    ipcMain.handle('play_queue_at', (_e, index) => {
      const queue = this._player.getQueue();
      if (queue && index >= 0 && index < queue.length) {
        this._player.playTracks(queue, index);
      }
    });

    ipcMain.handle('peek_next_track', () => {
      const nxt = this._player.peekNextTrack();
      return nxt ? _dump(nxt) : '{}';
    });
    ipcMain.handle('advance_to_next', () => this._player.advanceToNext());

    ipcMain.handle('toggle_liked', () => {
      this._player.toggleLiked();
      this._emitLikedTracksChanged();
    });
    ipcMain.handle('is_current_liked', () => this._player.isCurrentLiked);
    ipcMain.handle('toggle_liked_track', (_e, trackId) => {
      const newState = this._player.toggleLikedTrack(trackId);
      this._emitLikedTracksChanged();
      return newState;
    });
    ipcMain.handle('is_track_liked', (_e, trackId) => this._player.isTrackLiked(trackId));
    ipcMain.handle('get_liked_tracks', () => _dump(this._lib.getLikedTracks()));

    ipcMain.handle('get_play_history', (_e, limit) => {
      return _dump(this._lib.getPlayHistory(parseInt(limit, 10) || 200));
    });
    ipcMain.handle('clear_play_history', () => {
      this._lib.clearPlayHistory();
      this._emitHistoryChanged();
    });
    ipcMain.handle('get_play_stats', () => {
      return _dump(this._lib.getPlayStats());
    });
    ipcMain.handle('get_daily_mixes', () => {
      return _dump(this._lib.getDailyMixes());
    });
    ipcMain.handle('get_explore_tracks', () => {
      return _dump(this._lib.getExploreTracks());
    });
    ipcMain.handle('get_similar_recommendations', () => {
      return _dump(this._lib.getSimilarRecommendations());
    });

    ipcMain.handle('get_playlists', () => _dump(this._lib.getPlaylists()));
    ipcMain.handle('create_playlist', (_e, name) => {
      const playlist = this._lib.createPlaylist(name);
      this._emitPlaylistsChanged();
      return _dump(playlist);
    });
    ipcMain.handle('rename_playlist', (_e, playlistId, name) => {
      this._lib.renamePlaylist(parseInt(playlistId, 10), name);
      this._emitPlaylistsChanged();
    });
    ipcMain.handle('delete_playlist', (_e, playlistId) => {
      this._lib.deletePlaylist(parseInt(playlistId, 10));
      this._emitPlaylistsChanged();
    });
    ipcMain.handle('add_to_playlist', (_e, playlistId, trackId) => {
      this._lib.addToPlaylist(parseInt(playlistId, 10), trackId);
      this._emitPlaylistsChanged();
    });
    ipcMain.handle('add_tracks_to_playlist', (_e, playlistId, trackIdsJson) => {
      const trackIds = JSON.parse(trackIdsJson);
      const added = this._lib.addTracksToPlaylist(parseInt(playlistId, 10), trackIds);
      this._emitPlaylistsChanged();
      return _dump({ added });
    });
    ipcMain.handle('remove_from_playlist', (_e, playlistId, trackId) => {
      this._lib.removeFromPlaylist(parseInt(playlistId, 10), trackId);
      this._emitPlaylistsChanged();
    });
    ipcMain.handle('get_playlist_tracks', (_e, playlistId) => {
      return _dump(this._lib.getPlaylistTracks(parseInt(playlistId, 10)));
    });
    ipcMain.handle('get_all_playlist_track_ids', () => {
      return _dump(this._lib.getAllPlaylistTrackIds());
    });

    ipcMain.handle('add_tracks_to_remote_playlist', async (_e, playlistId, trackIdsJson) => {
      const trackIds = JSON.parse(trackIdsJson || '[]');
      if (trackIds.length === 0) return _dump({ error: '没有曲目' });

      const info = this._lib.getPlaylistRemoteInfo(playlistId);
      if (!info || info.source !== 'subsonic' || !info.server_id || !info.remote_id) {
        return _dump({ error: '不是远程歌单或信息缺失' });
      }

      const cfg = this._lib.getSubsonicServer(info.server_id);
      if (!cfg) return _dump({ error: '服务器不存在' });

      const { subsonicIds, skipped } = this._lib.getSubsonicTrackIds(trackIds, info.server_id);
      if (subsonicIds.length === 0) {
        return _dump({ error: '所选曲目均不属于该 Subsonic 服务器，无法添加到远程歌单', skipped: trackIds.length });
      }

      const { SubsonicClient } = require('./subsonic');
      const client = new SubsonicClient(cfg.server_url, cfg.username, cfg.password, cfg.protocol_mode || 'subsonic', 30.0);

      try {

        await client.updatePlaylist(info.remote_id, { songIdsToAdd: subsonicIds });

        const added = this._lib.addTracksToPlaylist(parseInt(playlistId, 10), trackIds);
        this._emitPlaylistsChanged();
        return _dump({ added, skipped: skipped.length, total: trackIds.length });
      } catch (e) {
        return _dump({ error: String(e.message || e) });
      }
    });

    ipcMain.handle('get_subsonic_servers', () => _dump(this._lib.getSubsonicServers()));

    ipcMain.handle('add_subsonic_server', (_e, name, serverUrl, username, password, protocolMode) => {
      const server = this._lib.addSubsonicServer(name, serverUrl, username, password, protocolMode || 'subsonic');
      this._emitSubsonicServersChanged();
      return _dump(server);
    });

    ipcMain.handle('remove_subsonic_server', (_e, serverId) => {
      this._lib.removeSubsonicServer(parseInt(serverId, 10));
      this._player.reloadLikedTracks();
      this._emitSubsonicServersChanged();
      this._emitLibraryUpdated();
      this._emitLikedTracksChanged();
    });

    ipcMain.handle('update_subsonic_server', (_e, serverId, name, serverUrl, username, password, protocolMode) => {
      const updated = this._lib.updateSubsonicServer(
        parseInt(serverId, 10), name, serverUrl, username, password, protocolMode
      );
      this._emitSubsonicServersChanged();
      return _dump(updated);
    });

    ipcMain.handle('test_subsonic_server', async (_e, serverId) => {
      const { SubsonicClient, SubsonicError } = require('./subsonic');
      const cfg = this._lib.getSubsonicServer(parseInt(serverId, 10));
      if (!cfg) return _dump({ ok: false, error: '服务器不存在' });
      const client = new SubsonicClient(
        cfg.server_url, cfg.username, cfg.password, cfg.protocol_mode || 'subsonic'
      );
      try {
        const resp = await client.ping();
        return _dump({
          ok: true,
          version: resp.version,
          server: cfg.name,
          openSubsonic: resp.openSubsonic || false,
        });
      } catch (e) {
        if (e instanceof SubsonicError) {
          return _dump({ ok: false, error: e.message, code: e.code });
        }
        return _dump({ ok: false, error: String(e) });
      }
    });

    ipcMain.handle('sync_subsonic_server', (_e, serverId) => {
      return this._syncSubsonicServer(parseInt(serverId, 10));
    });

    ipcMain.handle('get_remote_servers', () => _dump(this._lib.getAllRemoteServers()));

    ipcMain.handle('get_webdav_servers', () => _dump(this._lib.getWebDAVServers()));

    ipcMain.handle('add_webdav_server', (_e, name, serverUrl, username, password) => {
      const server = this._lib.addWebDAVServer(name, serverUrl, username, password);
      this._emitRemoteServersChanged();
      return _dump(server);
    });

    ipcMain.handle('remove_webdav_server', (_e, serverId) => {
      this._lib.removeWebDAVServer(parseInt(serverId, 10));
      this._player.reloadLikedTracks();
      this._emitRemoteServersChanged();
      this._emitLibraryUpdated();
      this._emitLikedTracksChanged();
    });

    ipcMain.handle('update_webdav_server', (_e, serverId, name, serverUrl, username, password) => {
      const updated = this._lib.updateWebDAVServer(
        parseInt(serverId, 10), name, serverUrl, username, password
      );
      this._emitRemoteServersChanged();
      return _dump(updated);
    });

    ipcMain.handle('test_webdav_server', async (_e, serverId) => {
      const { WebDAVClient } = require('./webdav');
      const cfg = this._lib.getWebDAVServer(parseInt(serverId, 10));
      if (!cfg) return _dump({ ok: false, error: '服务器不存在' });
      const client = new WebDAVClient(cfg.server_url, cfg.username, cfg.password, 20.0);
      try {
        const result = await client.ping();
        return _dump(result);
      } catch (e) {
        return _dump({ ok: false, error: String(e) });
      }
    });

    ipcMain.handle('sync_webdav_server', (_e, serverId) => {
      return this._syncWebDAVServer(parseInt(serverId, 10));
    });

    ipcMain.handle('get_smb_servers', () => _dump(this._lib.getSMBServers()));

    ipcMain.handle('add_smb_server', (_e, name, host, shareName, username, password, domain) => {
      const server = this._lib.addSMBServer(name, host, shareName, username, password, domain || '');
      this._emitRemoteServersChanged();
      return _dump(server);
    });

    ipcMain.handle('remove_smb_server', (_e, serverId) => {
      this._lib.removeSMBServer(parseInt(serverId, 10));
      this._player.reloadLikedTracks();
      this._emitRemoteServersChanged();
      this._emitLibraryUpdated();
      this._emitLikedTracksChanged();
    });

    ipcMain.handle('update_smb_server', (_e, serverId, name, host, shareName, username, password, domain) => {
      const updated = this._lib.updateSMBServer(
        parseInt(serverId, 10), name, host, shareName, username, password, domain
      );
      this._emitRemoteServersChanged();
      return _dump(updated);
    });

    ipcMain.handle('test_smb_server', async (_e, serverId) => {
      const { SMBClient } = require('./smb');
      const cfg = this._lib.getSMBServer(parseInt(serverId, 10));
      if (!cfg) return _dump({ ok: false, error: '服务器不存在' });
      const client = new SMBClient(cfg.host, cfg.share_name, cfg.username, cfg.password, cfg.domain || '', 20.0);
      try {
        const result = await client.ping();
        return _dump(result);
      } catch (e) {
        return _dump({ ok: false, error: String(e) });
      }
    });

    ipcMain.handle('sync_smb_server', (_e, serverId) => {
      return this._syncSMBServer(parseInt(serverId, 10));
    });

    ipcMain.handle('store_cover_colors', (_e, trackId, colorsJson) => {
      try {
        this._lib.storeCoverColors(trackId, colorsJson);
        return _dump({ ok: true });
      } catch (e) {
        return _dump({ error: String(e) });
      }
    });

    ipcMain.handle('get_cover_colors', (_e, trackIdsJson) => {
      try {
        const trackIds = JSON.parse(trackIdsJson || '[]');
        const result = this._lib.getBatchCoverColors(trackIds);
        return _dump(result);
      } catch (e) {
        return _dump({});
      }
    });

    ipcMain.handle('subsonic_browse', async (_e, serverId, endpoint, paramsJson) => {
      const { SubsonicClient, SubsonicError } = require('./subsonic');
      const cfg = this._lib.getSubsonicServer(parseInt(serverId, 10));
      if (!cfg) return _dump({ error: '服务器不存在' });
      const client = new SubsonicClient(
        cfg.server_url, cfg.username, cfg.password, cfg.protocol_mode || 'subsonic'
      );
      const params = paramsJson ? JSON.parse(paramsJson) : {};
      try {
        let result;
        if (endpoint === 'artists') result = await client.getArtists();
        else if (endpoint === 'albums') result = await client.getAlbumList(params.type || 'newest', parseInt(params.size || 100), parseInt(params.offset || 0));
        else if (endpoint === 'album') result = await client.getAlbum(params.id || '');
        else if (endpoint === 'artist') result = await client.getArtist(params.id || '');
        else if (endpoint === 'search') result = await client.search3(params.query || '', parseInt(params.artist_count || 20), parseInt(params.album_count || 30), parseInt(params.song_count || 50));
        else if (endpoint === 'playlists') result = await client.getPlaylists();
        else if (endpoint === 'playlist') result = await client.getPlaylist(params.id || '');
        else return _dump({ error: `未知 endpoint: ${endpoint}` });
        return _dump(result);
      } catch (e) {
        if (e instanceof SubsonicError) return _dump({ error: e.message, code: e.code });
        return _dump({ error: String(e) });
      }
    });

    ipcMain.handle('get_subsonic_lyrics', async (_e, trackId) => {
      const { SubsonicClient } = require('./subsonic');
      const track = this._lib.getTrack(trackId);
      if (!track) return _dump({ lyrics: null, error: '曲目不存在' });
      if (track.source !== 'subsonic') return _dump({ lyrics: null, error: '非 Subsonic 曲目' });

      const cfg = this._lib.getSubsonicServerForTrack(trackId);
      if (!cfg) return _dump({ lyrics: null, error: '服务器配置不存在' });

      let client;
      try {
        client = new SubsonicClient(cfg.server_url, cfg.username, cfg.password, cfg.protocol_mode || 'subsonic', 15.0);
      } catch (e) {
        return _dump({ lyrics: null, error: `客户端初始化失败: ${e}` });
      }

      const subsonicId = track.subsonic_id || '';
      let lyrics = null;

      if (subsonicId) {
        try { lyrics = await client.getLyricsBySongId(subsonicId); } catch { lyrics = null; }
      }
      if (!lyrics) {
        try { lyrics = await client.getLyrics(track.artist || '', track.title || ''); } catch { lyrics = null; }
      }

      if (lyrics) return _dump({ lyrics, error: null });
      return _dump({ lyrics: null, error: '服务器未返回歌词' });
    });

    ipcMain.handle('fetch_subsonic_playlists', async (_e, serverId) => {
      const { SubsonicClient } = require('./subsonic');
      const cfg = this._lib.getSubsonicServer(parseInt(serverId, 10));
      if (!cfg) return _dump({ error: '服务器不存在' });
      const client = new SubsonicClient(cfg.server_url, cfg.username, cfg.password, cfg.protocol_mode || 'subsonic', 30.0);
      try {
        const playlists = await client.getPlaylists();
        return _dump({ playlists, error: null });
      } catch (e) {
        return _dump({ error: e.message || String(e) });
      }
    });

    ipcMain.handle('import_subsonic_playlists', async (_e, serverId, playlistIdsJson) => {
      const { SubsonicClient } = require('./subsonic');
      const { subsonicTrackId } = require('./library');
      const cfg = this._lib.getSubsonicServer(parseInt(serverId, 10));
      if (!cfg) return _dump({ error: '服务器不存在' });
      const playlistIds = JSON.parse(playlistIdsJson || '[]');
      const client = new SubsonicClient(cfg.server_url, cfg.username, cfg.password, cfg.protocol_mode || 'subsonic', 60.0);
      const results = [];
      let imported = 0;
      let skipped = 0;
      for (const remoteId of playlistIds) {
        try {
          const existing = this._lib.findRemotePlaylist(serverId, remoteId);
          if (existing) {
            skipped++;
            results.push({ remoteId, status: 'skipped', error: '已导入' });
            continue;
          }
          const remotePlaylist = await client.getPlaylist(remoteId);
          const playlist = this._lib.importRemotePlaylist(serverId, remoteId, remotePlaylist.name, remotePlaylist.changed, remotePlaylist.cover_art_id, remotePlaylist.owner);

          this._lib.upsertSubsonicTracksBatch(serverId, remotePlaylist.tracks);
          const trackIds = remotePlaylist.tracks.map((track) => subsonicTrackId(serverId, track.id));
          this._lib.replacePlaylistTracks(playlist.id, trackIds);

          if (remotePlaylist.owner) {
            client.getUser(remotePlaylist.owner).then((user) => {
              if (user.email) {
                this._lib.updatePlaylistOwnerEmail(playlist.id, user.email);
                this._emitPlaylistsChanged();
              }
            }).catch((e) => {
              console.warn('[import_subsonic_playlists] getUser failed for', remotePlaylist.owner, ':', e.message);
            });
          }
          imported++;
          results.push({ remoteId, status: 'ok', playlist });
        } catch (e) {
          console.error('[import_subsonic_playlists] Failed for', remoteId, ':', e);
          results.push({ remoteId, status: 'error', error: String(e.message || e) });
        }
      }
      this._emitPlaylistsChanged();
      return _dump({ imported, skipped, results });
    });

    ipcMain.handle('sync_remote_playlist', async (_e, playlistId) => {
      const { SubsonicClient } = require('./subsonic');
      const { subsonicTrackId } = require('./library');
      const info = this._lib.getPlaylistRemoteInfo(playlistId);
      if (!info || info.source !== 'subsonic' || !info.server_id || !info.remote_id) {
        return _dump({ error: '不是远程歌单或信息缺失' });
      }
      const cfg = this._lib.getSubsonicServer(info.server_id);
      if (!cfg) return _dump({ error: '服务器不存在' });
      const client = new SubsonicClient(cfg.server_url, cfg.username, cfg.password, cfg.protocol_mode || 'subsonic', 60.0);
      try {
        const remotePlaylist = await client.getPlaylist(info.remote_id);
        this._lib.updateRemotePlaylist(playlistId, remotePlaylist.name, remotePlaylist.changed, remotePlaylist.cover_art_id, remotePlaylist.owner);

        this._lib.upsertSubsonicTracksBatch(info.server_id, remotePlaylist.tracks);
        const trackIds = remotePlaylist.tracks.map((track) => subsonicTrackId(info.server_id, track.id));
        const added = this._lib.replacePlaylistTracks(playlistId, trackIds);

        if (remotePlaylist.owner) {
          client.getUser(remotePlaylist.owner).then((user) => {
            if (user.email) {
              this._lib.updatePlaylistOwnerEmail(playlistId, user.email);
              this._emitPlaylistsChanged();
            }
          }).catch(() => {  });
        }
        this._emitPlaylistsChanged();
        return _dump({ ok: true, trackCount: added, name: remotePlaylist.name });
      } catch (e) {
        return _dump({ ok: false, error: String(e) });
      }
    });

    ipcMain.handle('apply_lyrics', (_e, trackId, lyrics) => {
      this._lib.updateLyrics(trackId, lyrics);
      this._player.updateTrackLyrics(trackId, lyrics);

      return _dump({ success: true });
    });

    ipcMain.handle('apply_lyrics_temporary', (_e, trackId, lyrics) => {
      this._player.updateTrackLyrics(trackId, lyrics);
      return _dump({ success: true });
    });

    ipcMain.handle('get_embedded_lyrics', async (_e, trackId) => {
      const lyrics = await this._lib.getEmbeddedLyrics(trackId);
      return lyrics || '';
    });

    ipcMain.handle('get_player_state', () => {
      return _dump({
        current_track: this._player.currentTrack,
        state: this._player.state,
        position: this._player.position,
        duration: this._player.duration,
        volume: this._player.volume,
        shuffle: this._player.shuffle,
        repeat: this._player.repeat,
        tempo: this._player.tempo,
        pitch: this._player.pitch,
        rate: this._player.rate,
      });
    });

    ipcMain.handle('renderer_ready', (_e, webAudioEnabled) => {
      if (webAudioEnabled) {
        this._player.setWebAudioEnabled(true);
      }
      this.emit('renderer-ready');
      return true;
    });

    ipcMain.handle('get_queue', () => {
      return _dump({
        queue: this._player.getQueue(),
        current_index: this._player.current_index,
      });
    });

    ipcMain.handle('get_settings', () => _dump(this._settings.all()));

    ipcMain.handle('save_settings', (_e, dataJson) => {
      const data = JSON.parse(dataJson);
      this._settings.update(data);
      const settingsJson = _dump(this._settings.all());
      this.emit('settings_changed', settingsJson);
      this._emit('settings_changed', settingsJson);

      const AUTO_REFRESH_KEYS = [
        'library_auto_watch', 'library_watch_poll_minutes', 'library_watch_debounce_ms',
        'subsonic_auto_sync', 'subsonic_sync_interval_minutes',
      ];
      if (AUTO_REFRESH_KEYS.some((k) => k in data)) this.startAutoRefresh();
    });

    ipcMain.handle('set_wasapi_exclusive', async (_e, enabled) => {
      const success = await this._player.setExclusiveMode(!!enabled);
      const settingsJson = _dump(this._settings.all());
      this.emit('settings_changed', settingsJson);
      this._emit('settings_changed', settingsJson);

      return (success && this._player.isExclusive) ? 'wasapi_exclusive' : 'shared';
    });

    ipcMain.handle('toggle_floating_window', () => this._toggleFloatingWindow());
    ipcMain.handle('close_floating_window', () => this._closeFloatingWindow());

    ipcMain.handle('open_external', (_e, url) => {
      let parsed;
      try {
        parsed = new URL(url);
      } catch {
        return false;
      }
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
      shell.openExternal(url);
      return true;
    });
    ipcMain.handle('minimize_window', (e) => {
      const win = BrowserWindow.fromWebContents(e.sender);
      if (win && !win.isDestroyed()) win.minimize();
    });
    ipcMain.handle('maximize_window', (e) => {
      const win = BrowserWindow.fromWebContents(e.sender);
      if (win && !win.isDestroyed()) {
        if (win.isMaximized()) {
          win.unmaximize();
        } else {
          win.maximize();
        }
      }
    });
    ipcMain.handle('close_window', (e) => {
      const win = BrowserWindow.fromWebContents(e.sender);
      if (win && !win.isDestroyed()) win.close();
    });

    ipcMain.handle('set_window_icon_theme', (_e, theme) => {
      const win = this._mainWindow;
      if (!win || win.isDestroyed()) return;
      const isDark = theme === 'dark';
      const names = isDark ? ['icon-dark.png', 'icon.png'] : ['icon.png', 'icon-dark.png'];
      let img = null;
      for (const name of names) {
        const iconPath = path.join(__dirname, '..', 'build', name);
        try {
          if (fs.existsSync(iconPath)) { img = nativeImage.createFromPath(iconPath); break; }
        } catch {  }
      }
      if (img) win.setIcon(img);
    });

    ipcMain.handle('toggle_fullscreen', () => {
      if (this._mainWindow && !this._mainWindow.isDestroyed()) {
        this._mainWindow.setFullScreen(!this._mainWindow.isFullScreen());
      }
    });
    ipcMain.handle('quit_app', () => app.quit());
    ipcMain.handle('restart_app', () => {
      app.relaunch();
      app.exit();
    });
    ipcMain.handle('show_in_explorer', (_e, filePath) => {
      shell.showItemInFolder(filePath);
    });

    ipcMain.handle('pick_tag_editor_path', () => {
      const filters = process.platform === 'win32'
        ? [{ name: '可执行文件', extensions: ['exe', 'bat', 'cmd'] }, { name: '所有文件', extensions: ['*'] }]
        : [{ name: '所有文件', extensions: ['*'] }];
      const result = dialog.showOpenDialogSync(this._mainWindow, {
        title: '选择音乐标签编辑应用',
        properties: ['openFile'],
        filters: filters,
      });
      return (result && result.length > 0) ? result[0] : '';
    });

    ipcMain.handle('open_in_tag_editor', (_e, filePathOrPaths) => {
      const exePath = this._settings.get('tag_editor_path', '');
      if (!exePath) {
        return _dump({ error: 'no_tag_editor_path' });
      }
      if (!fs.existsSync(exePath)) {
        return _dump({ error: 'exe_not_found' });
      }
      const paths = Array.isArray(filePathOrPaths)
        ? filePathOrPaths.filter(Boolean)
        : [filePathOrPaths].filter(Boolean);
      if (paths.length === 0) {
        return _dump({ error: 'no_file' });
      }
      try {
        const child = spawn(exePath, paths, {
          detached: true,
          stdio: 'ignore',
          windowsHide: false,
        });
        child.on('error', (err) => {
          console.error('[tag_editor] 启动失败:', err.message);
        });
        child.unref();
        return _dump({ ok: true });
      } catch (e) {
        console.error('[tag_editor] 启动异常:', e);
        return _dump({ error: 'launch_failed', message: e.message });
      }
    });

    ipcMain.handle('get_app_info', () => {
      let versionData = {};
      try {
        const versionPath = path.join(app.getAppPath(), 'version.json');
        if (fs.existsSync(versionPath)) {
          versionData = JSON.parse(fs.readFileSync(versionPath, 'utf-8'));
        }
      } catch {

      }

      return _dump({
        version: versionData.version || '0.0.0',
        build: versionData.build || 0,
        codename: versionData.codename || '',
        diagnostic: {
          electron_version: process.versions.electron,
          chrome_version: process.versions.chrome,
          node_version: process.versions.node,
          platform: process.platform,
          arch: process.arch,
        },
      });
    });

    ipcMain.handle('get_diagnostic_info', () => {
      const os = require('os');
      const mem = process.memoryUsage();
      let killCount = 0;
      try {
        const { getInstance } = require('./memory_manager');
        killCount = getInstance().killCount;
      } catch {  }

      let deviceVendor = '';
      try {
        if (process.platform === 'win32') {
          const { execSync } = require('child_process');
          const out = execSync(
            'wmic computersystem get manufacturer /value',
            { encoding: 'utf8', timeout: 3000, windowsHide: true }
          ).trim();
          const m = out.match(/Manufacturer=(.+)/);
          if (m) deviceVendor = m[1].trim();
        }
      } catch {  }

      const fmtMB = (bytes) => (bytes / (1024 * 1024)).toFixed(1) + ' MB';

      return _dump({
        SystemOsVersion: os.type() + ' ' + os.release() + (process.platform === 'win32' ? ' (' + os.version() + ')' : ''),
        SystemOsArch: process.platform + '-' + process.arch,
        SystemDeviceName: os.hostname(),
        SystemDeviceVendor: deviceVendor || 'N/A',
        AppRoot: app.getAppPath(),
        AppCurrentDirectory: process.cwd(),
        AppCurrentMemoryUsage: 'RSS: ' + fmtMB(mem.rss) + ' | Heap: ' + fmtMB(mem.heapUsed) + ' / ' + fmtMB(mem.heapTotal) + ' | External: ' + fmtMB(mem.external),
        DiagnosticMemoryKillCount: String(killCount),
      });
    });
  }

  _scanFolderAsync(folderPath, useIncremental = false) {
    setImmediate(() => {
      const run = useIncremental
        ? this._scanWorker.syncIncremental(folderPath)
        : this._scanWorker.scanFolder(folderPath);
      run
        .then((res) => {
          if (res) console.log('[scan] 扫描完成:', folderPath, JSON.stringify(res));
        })
        .catch((e) => {
          console.error('[scan] 后台扫描失败:', (e && e.message) || e);
        })
        .finally(() => {
          try {
            this._emitLibraryUpdated();
          } catch (e) {
            console.error('[scan] 推送更新失败:', e);
          }
        });
    });
  }

  startAutoRefresh() {
    this.stopAutoRefresh();
    try {
      const { LibraryWatcher, RemoteSyncScheduler } = require('./auto_refresh');
      this._libraryWatcher = new LibraryWatcher(this._lib, this._settings, {
        scan: (folderPath, opts) => this._scanWorker.syncIncremental(
          folderPath, (opts && opts.sizeCheckPaths) || null
        ),
        onChanged: (folderPath, stats) => this._onAutoRefreshChanged(folderPath, stats),
      });
      this._remoteSyncScheduler = new RemoteSyncScheduler(
        this._lib, this._settings, (serverId) => this._syncSubsonicServer(serverId)
      );
      this._libraryWatcher.start();
      this._remoteSyncScheduler.start();
    } catch (e) {
      console.error('[auto-refresh] 启动失败:', e.message || e);
    }
  }

  stopAutoRefresh() {
    if (this._libraryWatcher) {
      try { this._libraryWatcher.stop(); } catch {  }
      this._libraryWatcher = null;
    }
    if (this._remoteSyncScheduler) {
      try { this._remoteSyncScheduler.stop(); } catch {  }
      this._remoteSyncScheduler = null;
    }
  }

  _onAutoRefreshChanged(folderPath, stats) {
    try {
      if (stats.removed > 0) {

        this._player.reloadLikedTracks();
        this._emitLikedTracksChanged();
        this._emitPlaylistsChanged();
      }
      this._emitLibraryUpdated();
    } catch (e) {
      console.error('[auto-refresh] 推送库更新失败:', e.message || e);
    }
  }

  _syncSubsonicServer(serverId) {
    if (_syncingServers.has(serverId)) {
      return _dump({ ok: false, error: '该服务器正在同步中，请稍候' });
    }
    _syncingServers.add(serverId);

    setImmediate(async () => {
      const { SubsonicClient, SubsonicError, syncServerToLibrary, prefetchCovers } = require('./subsonic');
      try {
        const cfg = this._lib.getSubsonicServer(serverId);
        if (!cfg) {
          this._emit('subsonic_sync_result', _dump({ ok: false, server_id: serverId, error: '服务器不存在' }));
          return;
        }

        this._emit('subsonic_sync_progress', _dump({ server_id: serverId, stage: 'start' }));

        const client = new SubsonicClient(
          cfg.server_url, cfg.username, cfg.password,
          cfg.protocol_mode || 'subsonic', 60.0
        );

        let lastEmitTracks = 0;
        let lastEmitPhase = '';

        const progressCb = (s) => {
          const cur = parseInt(s.tracks || 0);
          const phase = s.phase || 'tracks';
          if (phase !== lastEmitPhase) {
            lastEmitPhase = phase;
            lastEmitTracks = cur;
            this._emit('subsonic_sync_progress', _dump({
              server_id: serverId, stage: 'progress', phase,
              artists: s.artists || 0, albums: s.albums || 0, tracks: cur,
              total: s.total || 0, done: s.done || 0,
              current_artist: s.current_artist || '', current_album: s.current_album || '',
            }));
            return;
          }
          if (phase === 'tracks') {
            if (cur - lastEmitTracks >= 5 || cur === 1) {
              lastEmitTracks = cur;
              this._emit('subsonic_sync_progress', _dump({
                server_id: serverId, stage: 'progress', phase,
                artists: s.artists || 0, albums: s.albums || 0, tracks: cur,
                total: s.total || 0, done: s.done || 0,
                current_artist: s.current_artist || '', current_album: s.current_album || '',
              }));
            }
          } else {
            this._emit('subsonic_sync_progress', _dump({
              server_id: serverId, stage: 'progress', phase,
              artists: s.artists || 0, albums: s.albums || 0, tracks: cur,
              total: s.total || 0, done: s.done || 0,
              current_artist: s.current_artist || '', current_album: s.current_album || '',
            }));
          }
        };

        const libraryChangedCb = () => {
          this._emitLibraryUpdated();
        };

        let stats;
        try {
          stats = await syncServerToLibrary(client, this._lib, serverId, {
            prefetchCovers: false,
            progressCb,
            libraryChangedCb,
            libraryChangedInterval: 20,
          });
        } catch (e) {
          if (e instanceof SubsonicError) {
            this._emit('subsonic_sync_result', _dump({ ok: false, server_id: serverId, error: e.message, code: e.code }));
          } else {
            this._emit('subsonic_sync_result', _dump({ ok: false, server_id: serverId, error: `同步异常: ${e}` }));
          }
          return;
        }

        if (stats.error) {
          this._emit('subsonic_sync_result', _dump({ ok: false, server_id: serverId, error: stats.error, warnings: stats.warnings || [] }));
          return;
        }

        const pendingCovers = stats.pending_covers || [];
        try { this._lib.updateSubsonicServerLastSync(serverId); } catch {  }

        this._emitSubsonicServersChanged();
        this._emitLibraryUpdated();
        this._emit('subsonic_sync_result', _dump({ ok: true, server_id: serverId, stats }));

        setImmediate(async () => {
          try {
            const { subsonicTrackId } = require('./library');
            const playlists = await client.getPlaylists();
            const serverPLIds = new Set();
            if (playlists && playlists.length > 0) {
              for (const pl of playlists) {
                try {
                  const remotePL = await client.getPlaylist(pl.id);
                  if (!remotePL || !remotePL.tracks) continue;
                  serverPLIds.add(String(pl.id));

                  const existing = this._lib.findRemotePlaylist(serverId, pl.id);
                  let playlist;
                  if (existing) {
                    this._lib.updateRemotePlaylist(existing.id, remotePL.name, remotePL.changed, remotePL.cover_art_id, remotePL.owner);
                    playlist = existing;
                  } else {
                    playlist = this._lib.importRemotePlaylist(serverId, pl.id, remotePL.name, remotePL.changed, remotePL.cover_art_id, remotePL.owner);
                  }

                  this._lib.upsertSubsonicTracksBatch(serverId, remotePL.tracks);
                  const trackIds = remotePL.tracks.map((track) => subsonicTrackId(serverId, track.id));
                  this._lib.replacePlaylistTracks(playlist.id, trackIds);

                  if (remotePL.owner) {
                    client.getUser(remotePL.owner).then((user) => {
                      if (user && user.email) {
                        try { this._lib.updatePlaylistOwnerEmail(playlist.id, user.email); } catch {  }
                      }
                    }).catch(() => {});
                  }
                } catch (e) {
                  stats.warnings.push('歌单同步失败(' + pl.id + '): ' + (e && e.message ? e.message : e));
                }
              }
            }

            const localPLs = this._lib.listRemotePlaylists(serverId);
            for (const lp of localPLs) {
              if (!serverPLIds.has(String(lp.remote_id))) {
                try { this._lib.deletePlaylist(lp.id); } catch {  }
              }
            }

            this._emitPlaylistsChanged();
          } catch (e) {

            console.warn('[subsonic] 远程歌单同步失败:', e);
          }
        });

        if (pendingCovers.length > 0) {
          setImmediate(async () => {
            try {
              await prefetchCovers(client, this._lib, serverId, pendingCovers);
            } catch {  }
          });
        }
      } finally {
        _syncingServers.delete(serverId);
      }
    });

    return _dump({ ok: true, started: true, message: '同步已开始' });
  }

  _syncWebDAVServer(serverId) {
    if (_syncingWebDAVServers.has(serverId)) {
      return _dump({ ok: false, error: '该服务器正在同步中，请稍候' });
    }
    _syncingWebDAVServers.add(serverId);

    setImmediate(async () => {
      const { WebDAVClient, WebDAVError, syncServerToLibrary } = require('./webdav');
      try {
        const cfg = this._lib.getWebDAVServer(serverId);
        if (!cfg) {
          this._emit('subsonic_sync_result', _dump({ ok: false, server_id: serverId, error: '服务器不存在' }));
          return;
        }

        this._emit('subsonic_sync_progress', _dump({ server_id: serverId, stage: 'start' }));

        const client = new WebDAVClient(cfg.server_url, cfg.username, cfg.password, 60.0);

        let lastEmitTracks = 0;

        const progressCb = (s) => {
          const cur = parseInt(s.tracks || 0);
          if (cur - lastEmitTracks >= 5 || cur === 1 || s.phase !== 'tracks') {
            lastEmitTracks = cur;
            this._emit('subsonic_sync_progress', _dump({
              server_id: serverId, stage: 'progress', phase: s.phase || 'tracks',
              tracks: cur,
              current_file: s.current_file || s.current_path || '',
            }));
          }
        };

        const libraryChangedCb = () => {
          this._emitLibraryUpdated();
        };

        let stats;
        try {
          stats = await syncServerToLibrary(client, this._lib, serverId, {
            progressCb,
            libraryChangedCb,
            libraryChangedInterval: 10,
          });
        } catch (e) {
          if (e instanceof WebDAVError) {
            this._emit('subsonic_sync_result', _dump({ ok: false, server_id: serverId, error: e.message, code: e.code }));
          } else {
            this._emit('subsonic_sync_result', _dump({ ok: false, server_id: serverId, error: `同步异常: ${e}` }));
          }
          return;
        }

        if (stats.error) {
          this._emit('subsonic_sync_result', _dump({ ok: false, server_id: serverId, error: stats.error, warnings: stats.warnings || [] }));
          return;
        }

        try { this._lib.updateWebDAVServerLastSync(serverId); } catch {  }

        this._emitRemoteServersChanged();
        this._emitLibraryUpdated();
        this._emit('subsonic_sync_result', _dump({ ok: true, server_id: serverId, stats }));
      } finally {
        _syncingWebDAVServers.delete(serverId);
      }
    });

    return _dump({ ok: true, started: true, message: '同步已开始' });
  }

  _syncSMBServer(serverId) {
    if (_syncingSMBServers.has(serverId)) {
      return _dump({ ok: false, error: '该服务器正在同步中，请稍候' });
    }
    _syncingSMBServers.add(serverId);

    setImmediate(async () => {
      const { SMBClient, SMBError, syncServerToLibrary } = require('./smb');
      let client = null;
      try {
        const cfg = this._lib.getSMBServer(serverId);
        if (!cfg) {
          this._emit('subsonic_sync_result', _dump({ ok: false, server_id: serverId, error: '服务器不存在' }));
          return;
        }

        this._emit('subsonic_sync_progress', _dump({ server_id: serverId, stage: 'start' }));

        client = new SMBClient(cfg.host, cfg.share_name, cfg.username, cfg.password, cfg.domain || '', 60.0);

        const progressCb = (s) => {
          this._emit('subsonic_sync_progress', _dump({
            server_id: serverId, stage: 'progress', phase: s.phase || 'scanning',
            tracks: s.tracks || 0,
            current_path: s.current_path || '',
          }));
        };

        const libraryChangedCb = () => {
          this._emitLibraryUpdated();
        };

        let stats;
        try {
          stats = await syncServerToLibrary(client, this._lib, serverId, {
            progressCb,
            libraryChangedCb,
          });
        } catch (e) {
          if (e instanceof SMBError) {
            this._emit('subsonic_sync_result', _dump({ ok: false, server_id: serverId, error: e.message, code: e.code }));
          } else {
            this._emit('subsonic_sync_result', _dump({ ok: false, server_id: serverId, error: `同步异常: ${e}` }));
          }
          return;
        }

        if (stats.error) {
          this._emit('subsonic_sync_result', _dump({ ok: false, server_id: serverId, error: stats.error, warnings: stats.warnings || [] }));
          return;
        }

        try { this._lib.updateSMBServerLastSync(serverId); } catch {  }

        if (client && client.connected) {
          try { await client.disconnect(); } catch {  }
        }

        this._emitRemoteServersChanged();
        this._emitLibraryUpdated();
        this._emit('subsonic_sync_result', _dump({ ok: true, server_id: serverId, stats }));
      } finally {

        if (client && client.connected) {
          try { await client.disconnect(); } catch {  }
        }
        _syncingSMBServers.delete(serverId);
      }
    });

    return _dump({ ok: true, started: true, message: '同步已开始' });
  }

  _toggleFloatingWindow() {
    if (this._floatingWindow) {
      this._closeFloatingWindow();
    } else {
      this._createFloatingWindow();
    }
  }

  isFloatingWindowUrl(url) {
    return /(^|[\\/])floating\.html([?#]|$)/.test(String(url || ''));
  }

  floatingWindowOptions() {

    let bg = '#191C20';
    try {
      const theme = this._settings.all().theme || 'system';
      let dark = true;
      if (theme === 'dark') dark = true;
      else if (theme === 'light') dark = false;
      else {
        const { nativeTheme } = require('electron');
        dark = nativeTheme.shouldUseDarkColors !== false;
      }
      bg = dark ? '#191C20' : '#F0F4F9';
    } catch {  }

    return {
      width: 360,
      height: 760,
      minWidth: 320,
      minHeight: 420,
      resizable: true,
      frame: false,
      alwaysOnTop: true,
      show: false,
      backgroundColor: bg,
      autoHideMenuBar: true,
      title: 'Project Carminium',
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
      },
    };
  }

  adoptFloatingWindow(child, details) {
    if (!child || child.isDestroyed()) return;
    if (details && details.url && !this.isFloatingWindowUrl(details.url)) return;

    if (this._floatingWindow && !this._floatingWindow.isDestroyed() && this._floatingWindow !== child) {
      try { child.close(); } catch {  }
      return;
    }

    this._floatingOpening = false;
    this._floatingWindow = child;
    child.once('ready-to-show', () => {
      if (!child.isDestroyed()) child.show();
    });
    child.on('closed', () => {
      this._floatingWindow = null;
      this._floatingOpening = false;
      this.emitFloatingWindowClosed();
      if (this._floatingClosedCallback) {
        try { this._floatingClosedCallback(); } catch {  }
      }
    });
  }

  _createFloatingWindow() {
    const win = this._mainWindow;
    if (!win || win.isDestroyed()) return;
    if (this._floatingWindow || this._floatingOpening) return;
    this._floatingOpening = true;

    win.webContents
      .executeJavaScript(
        "(function(){try{window.open('floating.html','carminium-floating','width=360,height=760');return 'ok';}catch(e){return 'ERR:'+(e&&e.message);}})()"
      )
      .then((r) => {
        if (r && r !== 'ok') { this._floatingOpening = false; console.warn('[bridge] floating open returned', r); }
      })
      .catch((e) => {
        this._floatingOpening = false;
        console.warn('[bridge] floating open failed:', (e && e.message) || e);
      });
  }

  _closeFloatingWindow() {
    if (this._floatingWindow) {
      this._floatingWindow.close();
    }
  }

  close() {
    this._closeFloatingWindow();

    this.stopAutoRefresh();

    if (this._scanWorker) {
      try { this._scanWorker.stop(); } catch {  }
      this._scanWorker = null;
    }

    if (this._libraryUpdatedTimer) {
      clearTimeout(this._libraryUpdatedTimer);
      this._libraryUpdatedTimer = null;
    }
    this._libraryUpdatedPending = false;

    if (this._analysisCache) {
      try { this._analysisCache.flush(); } catch (e) {
        console.warn('[bridge] AnalysisCache flush failed:', e.message);
      }
    }

    if (this._loudness) {
      try { this._loudness.flush(); } catch (e) {
        console.warn('[bridge] Loudness flush failed:', e.message);
      }
    }

    if (this._quality) {
      try { this._quality.flush(); } catch (e) {
        console.warn('[bridge] Quality flush failed:', e.message);
      }
    }
  }
}

async function _getSystemAccentColor() {
  const { execFile } = require('child_process');

  const run = (cmd, args) => new Promise((resolve, reject) => {
    execFile(cmd, args, {
      encoding: 'utf8',
      timeout: 3000,
      windowsHide: true,
    }, (err, stdout) => {
      if (err) reject(err);
      else resolve(stdout || '');
    });
  });

  try {

    const output = await run('reg', [
      'query', 'HKCU\\SOFTWARE\\Microsoft\\Windows\\DWM', '/v', 'AccentColor',
    ]);
    const match = output.match(/AccentColor\s+REG_DWORD\s+0x([0-9a-fA-F]{8})/);
    if (match) {
      const argb = parseInt(match[1], 16);
      const r = (argb >> 16) & 0xff;
      const g = (argb >> 8) & 0xff;
      const b = argb & 0xff;

      const a = (argb >> 24) & 0xff;
      if (a > 0 && (r > 0 || g > 0 || b > 0)) {
        return [r, g, b];
      }
    }

    const output2 = await run('reg', [
      'query',
      'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Accent',
      '/v', 'AccentColorMenu',
    ]);
    const match2 = output2.match(/AccentColorMenu\s+REG_DWORD\s+0x([0-9a-fA-F]{8})/);
    if (match2) {
      const argb = parseInt(match2[1], 16);
      const r = (argb >> 16) & 0xff;
      const g = (argb >> 8) & 0xff;
      const b = argb & 0xff;
      if (r > 0 || g > 0 || b > 0) {
        return [r, g, b];
      }
    }
  } catch (e) {
    console.warn('[bridge] Failed to read system accent color:', e.message);
  }
  return null;
}

module.exports = { Bridge };
