/**
 * Carminium — Bridge (Electron 架构)
 * IPC Bridge：Main↔Renderer 通信中枢。
 * 接收 Player 信号并通过 IPC 转发到渲染进程（Main→Renderer），
 * 暴露 IPC handler 供渲染进程调用（Renderer→Main）。
 */
'use strict';

const { EventEmitter } = require('events');
const { ipcMain, dialog, app, shell, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

// 后台同步状态：记录正在同步的 server_id，防止重复触发
const _syncingServers = new Set();

function _dump(obj) {
  return JSON.stringify(obj, null, undefined);
}

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
    this._floatingClosedCallback = null;

    // ── 转发 player 信号 → Renderer 事件 ──
    player.on('track_changed', (trackJson) => this._onTrackChanged(trackJson));
    player.on('state_changed', (state) => this._emit('playback_state_changed', state));
    player.on('position_changed', (pos) => this._emit('position_changed', pos));
    player.on('duration_changed', (dur) => this._emit('duration_changed', dur));
    player.on('volume_changed', (vol) => this._emit('volume_changed', vol));
    player.on('shuffle_changed', (enabled) => this._emit('shuffle_changed', enabled));
    player.on('repeat_changed', (mode) => this._emit('repeat_changed', mode));
    player.on('queue_changed', (queueJson) => this._emit('queue_changed', queueJson));
    player.on('liked_changed', (liked) => this._emit('liked_changed', liked));
    player.on('play_command', (cmdJson) => this._emit('play_command', cmdJson));
    player.on('lyrics_changed', (trackId) => this._emit('lyrics_changed', trackId));
    player.on('automix_takeover', () => this._emit('automix_takeover'));
    // 独占モード回退時に player から settings_changed が発行される → 転送
    player.on('settings_changed', (settingsJson) => {
      this.emit('settings_changed', settingsJson);
      this._emit('settings_changed', settingsJson);
    });
  }

  setMainWindow(win) {
    this._mainWindow = win;
  }

  _emit(event, payload) {
    // 发送到主窗口
    if (this._mainWindow && !this._mainWindow.isDestroyed()) {
      this._mainWindow.webContents.send('bridge:event', { event, payload });
    }
    // 发送到浮动窗口（如果存在）
    if (this._floatingWindow && !this._floatingWindow.isDestroyed()) {
      this._floatingWindow.webContents.send('bridge:event', { event, payload });
    }
    // 同时 emit 给内部消费者（SMTC 等）
    this.emit(event, payload);
  }

  emitFloatingWindowClosed() {
    this._emit('floating_window_closed');
  }

  setFloatingClosedCallback(cb) {
    this._floatingClosedCallback = cb;
  }

  // ── Player signal handlers ───────────────────────────────────────────────

  _onTrackChanged(trackJson) {
    try {
      const track = JSON.parse(trackJson);
      const tid = track && track.id ? track.id : null;
      if (tid) {
        this._lib.addPlayHistory(tid);
        this._emitHistoryChanged();
      }
    } catch {
      // ignore
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

  // ── 注册 IPC handlers ────────────────────────────────────────────────────

  registerIpcHandlers() {
    // ── Library ──
    ipcMain.handle('get_library', () => _dump(this._lib.getAllTracks()));
    ipcMain.handle('get_albums', () => _dump(this._lib.getAlbums()));
    ipcMain.handle('get_artists', () => _dump(this._lib.getArtists()));
    ipcMain.handle('get_folders', () => _dump(this._lib.getFolders()));
    ipcMain.handle('get_album_tracks', (_e, albumJson) => {
      const data = JSON.parse(albumJson);
      return _dump(this._lib.getAlbumTracks(data.album || '', data.album_artist || null));
    });
    ipcMain.handle('get_artist_tracks', (_e, artist) => _dump(this._lib.getArtistTracks(artist)));
    ipcMain.handle('search_tracks', (_e, query) => _dump(this._lib.searchTracks(query)));

    // ── Folder management ──
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
      this._player.reloadLikedTracks();
      this._emit('library_updated', _dump(this._lib.getAllTracks()));
      this._emit('folders_updated', _dump(this._lib.getFolders()));
      this._emitLikedTracksChanged();
    });

    ipcMain.handle('rescan_folder', (_e, folderPath) => {
      const folderInfo = this._lib.rescanFolder(folderPath);
      const resolvedPath = folderInfo.path || folderPath;
      this._scanFolderAsync(resolvedPath);
      return _dump(folderInfo);
    });

    // ── Playback ──
    ipcMain.handle('play_track', (_e, trackId) => {
      const track = this._lib.getTrack(trackId);
      if (track) this._player.playTracks([track]);
    });

    ipcMain.handle('play_from_list', (_e, tracksJson, index) => {
      const tracks = JSON.parse(tracksJson);
      this._player.playTracks(tracks, index);
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

    // ── 音频设备（Electron 版本由前端 Web Audio API 处理）──
    ipcMain.handle('get_audio_devices', () => this._player.getAudioDevices());
    ipcMain.handle('set_output_device', (_e, deviceId) => {
      this._player.setOutputDevice(deviceId);
      this._settings.set('audio_output_device', deviceId);
    });

    // ── 前端播放模式：状态报告与媒体 URL ──
    ipcMain.handle('report_playback_state', (_e, state, positionMs) => {
      this._player.reportPlaybackState(state, positionMs);
    });
    ipcMain.handle('report_duration', (_e, durationMs) => {
      this._player.reportDuration(durationMs);
    });
    ipcMain.handle('report_ended', () => this._player.reportEnded());
    ipcMain.handle('report_volume', (_e, volume) => {
      this._player.reportVolume(volume);
      this._settings.set('volume', volume);
    });
    ipcMain.handle('report_position', (_e, positionMs) => {
      this._player.reportPosition(positionMs);
    });

    // ── Cover/Media URL ──
    ipcMain.handle('get_cover_base_url', () => this._coverServer.baseUrl);
    ipcMain.handle('get_media_base_url', () => this._coverServer.mediaBaseUrl);

    // ── 歌词搜索 ──
    ipcMain.handle('search_netease_lyrics', async (_e, query) => {
      const { search } = require('./lyrics');
      return search(query);
    });
    ipcMain.handle('fetch_netease_lyrics', async (_e, songId) => {
      const { fetchLyrics } = require('./lyrics');
      return fetchLyrics(songId);
    });

    // ── Queue ──
    ipcMain.handle('add_next', (_e, trackJson) => {
      const track = JSON.parse(trackJson);
      this._player.addNext(track);
    });
    ipcMain.handle('append_queue', (_e, trackJson) => {
      const track = JSON.parse(trackJson);
      this._player.appendQueue(track);
    });
    ipcMain.handle('remove_from_queue', (_e, index) => this._player.removeFromQueue(index));
    ipcMain.handle('play_queue_at', (_e, index) => {
      const queue = this._player.getQueue();
      if (queue && index >= 0 && index < queue.length) {
        this._player.playTracks(queue, index);
      }
    });

    // ── AutoMix ──
    ipcMain.handle('peek_next_track', () => {
      const nxt = this._player.peekNextTrack();
      return nxt ? _dump(nxt) : '{}';
    });
    ipcMain.handle('advance_to_next', () => this._player.advanceToNext());

    // ── BeatShake ──
    ipcMain.handle('trigger_beat_shake', () => {
      // Electron 版本：窗口震动由前端 CSS animation 实现
      if (this._mainWindow && !this._mainWindow.isDestroyed()) {
        this._mainWindow.webContents.send('beat_shake');
      }
      if (this._floatingWindow && !this._floatingWindow.isDestroyed()) {
        this._floatingWindow.webContents.send('beat_shake');
      }
    });

    // ── Liked ──
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

    // ── Play history ──
    ipcMain.handle('get_play_history', (_e, limit) => {
      return _dump(this._lib.getPlayHistory(parseInt(limit, 10) || 200));
    });
    ipcMain.handle('clear_play_history', () => {
      this._lib.clearPlayHistory();
      this._emitHistoryChanged();
    });

    // ── Playlists ──
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

    // ── Subsonic ──
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
      this._emit('library_updated', _dump(this._lib.getAllTracks()));
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

    // ── Lyrics ──
    ipcMain.handle('apply_lyrics', (_e, trackId, lyrics) => {
      this._lib.updateLyrics(trackId, lyrics);
      const updatedTrack = this._player.updateTrackLyrics(trackId, lyrics);
      if (updatedTrack) {
        this._emit('track_changed', _dump(updatedTrack));
      }
      return _dump({ success: true });
    });

    ipcMain.handle('apply_lyrics_temporary', (_e, trackId, lyrics) => {
      this._player.updateTrackLyrics(trackId, lyrics);
      return _dump({ success: true });
    });

    // ── Player state ──
    ipcMain.handle('get_player_state', () => {
      return _dump({
        current_track: this._player.currentTrack,
        state: this._player.state,
        position: this._player.position,
        duration: this._player.duration,
        volume: this._player.volume,
        shuffle: this._player.shuffle,
        repeat: this._player.repeat,
        frontend_playback: this._player.frontendPlayback,
      });
    });

    ipcMain.handle('get_queue', () => {
      return _dump({
        queue: this._player.getQueue(),
        current_index: this._player.current_index,
      });
    });

    // ── Settings ──
    ipcMain.handle('get_settings', () => _dump(this._settings.all()));

    ipcMain.handle('save_settings', (_e, dataJson) => {
      const data = JSON.parse(dataJson);
      this._settings.update(data);
      const settingsJson = _dump(this._settings.all());
      this.emit('settings_changed', settingsJson);
      this._emit('settings_changed', settingsJson);
    });

    ipcMain.handle('set_wasapi_exclusive', async (_e, enabled) => {
      const success = await this._player.setExclusiveMode(!!enabled);
      const settingsJson = _dump(this._settings.all());
      this.emit('settings_changed', settingsJson);
      this._emit('settings_changed', settingsJson);
      // 前端期望 'wasapi_exclusive' 表示独占模式已激活
      return (success && this._player.isExclusive) ? 'wasapi_exclusive' : 'shared';
    });

    // ── App ──
    ipcMain.handle('toggle_floating_window', () => this._toggleFloatingWindow());
    ipcMain.handle('close_floating_window', () => this._closeFloatingWindow());
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

    // ── App Info ──
    ipcMain.handle('get_app_info', () => {
      let versionData = {};
      try {
        const versionPath = path.join(app.getAppPath(), 'version.json');
        if (fs.existsSync(versionPath)) {
          versionData = JSON.parse(fs.readFileSync(versionPath, 'utf-8'));
        }
      } catch {
        // ignore
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
  }

  // ── 文件夹扫描（后台异步）──

  _scanFolderAsync(folderPath) {
    setImmediate(async () => {
      try {
        await this._lib.scanFolder(folderPath);
      } catch (e) {
        console.error('[scan] 后台扫描失败:', e);
      }
      try {
        this._emit('library_updated', _dump(this._lib.getAllTracks()));
        this._emit('folders_updated', _dump(this._lib.getFolders()));
      } catch (e) {
        console.error('[scan] 推送更新失败:', e);
      }
    });
  }

  // ── Subsonic 同步（后台异步）──

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
          this._emit('library_updated', _dump(this._lib.getAllTracks()));
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
        try { this._lib.updateSubsonicServerLastSync(serverId); } catch { /* ignore */ }

        this._emitSubsonicServersChanged();
        this._emit('library_updated', _dump(this._lib.getAllTracks()));
        this._emit('subsonic_sync_result', _dump({ ok: true, server_id: serverId, stats }));

        // 后台预缓存封面
        if (pendingCovers.length > 0) {
          setImmediate(async () => {
            try {
              await prefetchCovers(client, this._lib, serverId, pendingCovers);
            } catch { /* ignore */ }
          });
        }
      } finally {
        _syncingServers.delete(serverId);
      }
    });

    return _dump({ ok: true, started: true, message: '同步已开始' });
  }

  // ── 浮动窗口 ──

  _toggleFloatingWindow() {
    if (this._floatingWindow) {
      this._closeFloatingWindow();
    } else {
      this._createFloatingWindow();
    }
  }

  _createFloatingWindow() {
    const floatingPath = path.join(__dirname, '..', 'web', 'floating.html');
    this._floatingWindow = new BrowserWindow({
      width: 360,
      height: 768,
      resizable: false,
      frame: false,
      alwaysOnTop: true,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    this._floatingWindow.loadFile(floatingPath);
    this._floatingWindow.on('closed', () => {
      this._floatingWindow = null;
      this.emitFloatingWindowClosed();
      if (this._floatingClosedCallback) {
        try { this._floatingClosedCallback(); } catch { /* ignore */ }
      }
    });
  }

  _closeFloatingWindow() {
    if (this._floatingWindow) {
      this._floatingWindow.close();
    }
  }

  close() {
    this._closeFloatingWindow();
  }
}

module.exports = { Bridge };
