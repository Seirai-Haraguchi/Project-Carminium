/**
 * Carminium — Bridge (Electron 架构)
 * IPC Bridge：Main↔Renderer 通信中枢。
 * 接收 Player 信号并通过 IPC 转发到渲染进程（Main→Renderer），
 * 暴露 IPC handler 供渲染进程调用（Renderer→Main）。
 */
'use strict';

const { EventEmitter } = require('events');
const { ipcMain, dialog, app, shell, BrowserWindow, net, nativeImage } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

// ── 智能过渡分析模块 ──────────────────────────────────────────────────────────
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

    // ── 智能过渡分析：缓存 + osu! 谱面提供器 ──
    this._analysisCache = AnalysisCache ? new AnalysisCache() : null;
    this._osuProvider = OsuBeatmapProvider ? new OsuBeatmapProvider() : null;
    this._currentTransitionPlan = null;
    if (this._analysisCache) {
      console.log('[bridge] AnalysisCache initialized');
    }
    if (this._osuProvider) {
      console.log('[bridge] OsuBeatmapProvider initialized');
    }

    // ── 接入主进程内存管理器 ──
    // 注册定时清理回高与紧急清理回调
    try {
      const { getInstance: getMemoryManager } = require('./memory_manager');
      const memMgr = getMemoryManager();
      memMgr.onCleanup(() => {
        // AnalysisCache 内部有 debounce 保存，这里只检查是否需要 flush
        if (this._analysisCache && this._analysisCache._dirty) {
          try { this._analysisCache.flush(); } catch (e) {
            console.warn('[bridge] AnalysisCache flush during cleanup failed:', e.message);
          }
        }
      });
      // 紧急清理：清空封面缩放缓存 + 封面原始数据缓存 + 轨道 JSON 缓存
      // 这些缓存均有磁盘后备，清空后仅性能略降（重新读磁盘/重新序列化），不影响功能
      memMgr.onEmergencyCleanup(() => {
        // cover-server 的缩放结果缓存
        if (this._coverServer && typeof this._coverServer.clearResizeCache === 'function') {
          try { this._coverServer.clearResizeCache(); } catch (e) { /* ignore */ }
        }
        // library 的封面原始数据缓存
        if (this._lib && this._lib._coverDataCache) {
          try { this._lib._coverDataCache.clear(); } catch (e) { /* ignore */ }
        }
        // 轨道 JSON 缓存（大库下可达 5-20MB）
        this._allTracksJson = null;
        this._allTracksJsonDirty = true;
        this._foldersJson = null;
        this._foldersJsonDirty = true;
      });
    } catch (e) {
      console.warn('[bridge] Memory manager integration failed:', e.message);
    }

    // ── 转发 player 信号 → Renderer 事件 ──
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
// Native audio device unavailable (dummy mode) — notify renderer to show toast
player.on('playback_error', (errJson) => this._emit('playback_error', errJson));
    // 独占モード回退時に player から settings_changed が発行される → 転送
    player.on('settings_changed', (settingsJson) => {
      this.emit('settings_changed', settingsJson);
      this._emit('settings_changed', settingsJson);
    });

    // ── Audio PCM 中継: wasapi → Renderer ──
    const renderer = player._renderer;
    if (renderer) {
      renderer.sendPcmToRenderer = (channel, float32Array) => {
        this._sendAudioPcm(channel, float32Array);
      };
      renderer.sendFfmpegState = (channel, finished) => {
        this._sendFfmpegState(channel, finished);
      };
    }

    // ── AudioEngine 制御イベント: Player → Renderer ──
    // 用 executeJavaScript 直接调用渲染进程的全局函数，最可靠
    player.on('audio_control', (json) => {
      // json 已经是 JSON 字符串，直接嵌入 JS 即可
      const js = 'if (window.__handleAudioControl) { window.__handleAudioControl(' + json + '); }';
      if (this._mainWindow && !this._mainWindow.isDestroyed()) {
        this._mainWindow.webContents.executeJavaScript(js).catch(() => {});
      }
      if (this._floatingWindow && !this._floatingWindow.isDestroyed()) {
        this._floatingWindow.webContents.executeJavaScript(js).catch(() => {});
      }
    });
  }

  setMainWindow(win) {
    this._mainWindow = win;
  }

  // ── library_updated / folders_updated の debounce + キャッシュ ──
  //
  // 問題：FileWatcher 発火 / Subsonic 同期進行中 / フォルダ追加削除などで
  // library_updated が短時間に連続発火すると、そのたびに getAllTracks() を
  // 同期実行して JSON.stringify するため、メインプロセスが長時間ブロックされる。
  // その間 audio_output IPC も処理できず WASAPI バッファアンダーラン →
  // 音切れ + UI フリーズ（いわゆる「なんだか分からないけど止まる」）。
  //
  // 対策：
  //   1. 複数回の変更要求を 500ms の debounce で 1 回にまとめる
  //   2. getAllTracks() の結果 JSON をキャッシュし、dirty フラグで再計算を管理
  //   3. これにより Subsonic 同期中の 20 曲ごとの libraryChangedCb が
  //      何十回も重い計算を走らせるのを防ぐ
  //
  // 注意：1 回の計算自体は依然として同期ブロックするが、頻度が劇的に下がるため
  // 再生中の音切れリスクは実用上ほぼ解消する。

  _LIBRARY_UPDATED_DEBOUNCE_MS = 500;
  _allTracksJson = null;
  _allTracksJsonDirty = true;
  _foldersJson = null;
  _foldersJsonDirty = true;
  _libraryUpdatedTimer = null;
  _libraryUpdatedPending = false;

  _getAllTracksJsonCached() {
    if (this._allTracksJsonDirty) {
      this._allTracksJson = _dump(this._lib.getAllTracks());
      this._allTracksJsonDirty = false;
    }
    return this._allTracksJson;
  }

  _getFoldersJsonCached() {
    if (this._foldersJsonDirty) {
      this._foldersJson = _dump(this._lib.getFolders());
      this._foldersJsonDirty = false;
    }
    return this._foldersJson;
  }

  /**
   * library_updated / folders_updated を debounce 付きで送信。
   * 短時間に複数回のライブラリ変更があっても 1 回にまとめて送信する。
   */
  _emitLibraryUpdated() {
    this._allTracksJsonDirty = true;
    this._foldersJsonDirty = true;
    this._libraryUpdatedPending = true;
    if (this._libraryUpdatedTimer) return;
    this._libraryUpdatedTimer = setTimeout(() => {
      this._libraryUpdatedTimer = null;
      if (!this._libraryUpdatedPending) return;
      this._libraryUpdatedPending = false;
      // debounce 収束後に 1 回だけ重い計算を実行
      const tracksJson = this._getAllTracksJsonCached();
      const foldersJson = this._getFoldersJsonCached();
      this._emit('library_updated', tracksJson);
      this._emit('folders_updated', foldersJson);
    }, this._LIBRARY_UPDATED_DEBOUNCE_MS);
    if (this._libraryUpdatedTimer.unref) this._libraryUpdatedTimer.unref();
  }

  // ── Audio PCM 中継メソッド ────────────────────────────────────────────

  _sendAudioPcm(channel, float32Array) {
    // Float32Array 视图直接发送：structured clone 只序列化视图的字节范围，
    // 无需 buffer.slice 再做一次全量拷贝（44.1kHz 立体声 f32 ≈ 352KB/s 的持续流量，
    // 每次省一次拷贝可显著降低主进程 external/arrayBuffers 的分配churn）。
    const ipcChannel = channel === 'main' ? 'audio_pcm_main' : 'audio_pcm_next';
    // PCM データは主窗口にのみ送信（浮動窗口は音声データを使用せず、
    // 不要な IPC 転送と structured clone によるメモリ無駄遣いを避ける）
    if (this._mainWindow && !this._mainWindow.isDestroyed()) {
      this._mainWindow.webContents.send(ipcChannel, float32Array);
    }
  }

  _sendFfmpegState(channel, finished) {
    if (this._mainWindow && !this._mainWindow.isDestroyed()) {
      this._mainWindow.webContents.send('audio_ffmpeg_state', channel, finished);
    }
    if (this._floatingWindow && !this._floatingWindow.isDestroyed()) {
      this._floatingWindow.webContents.send('audio_ffmpeg_state', channel, finished);
    }
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
    // ── Audio Output: Renderer (AudioEngine) → Main (miniaudio) ──
    ipcMain.on('audio_output', (_e, arrayBuffer) => {
      const renderer = this._player._renderer;
      if (renderer && renderer.isInitialized) {
        const result = renderer.pushProcessedPcm(new Float32Array(arrayBuffer));
        if (result !== 0 && result !== -2) {
          console.error('[bridge] audio_output push failed:', result);
        }
        // 查询 DLL 环形缓冲延迟，发送到渲染进程用于位置修正
        const latencyMs = renderer.getBufferLatencyMs();
        // 使用 webContents.send（可靠）代替 executeJavaScript（异步且可能丢失）
        if (this._mainWindow && !this._mainWindow.isDestroyed()) {
          this._mainWindow.webContents.send('audio_latency', latencyMs);
        }
        if (this._floatingWindow && !this._floatingWindow.isDestroyed()) {
          this._floatingWindow.webContents.send('audio_latency', latencyMs);
        }
      }
    });

    // ── AudioEngine events (Renderer → Main) ──
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

    // ── FFmpeg 背压控制 (Renderer → Main) ──
    // 渲染进程 StreamingPCMProcessor 的 ring buffer 水位过高/过低时，
    // 暂停/恢复 FFmpeg stdout，防止 buffer 无限扩容又不丢数据
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

    // ── Web Audio API: 文件解码 IPC ──
    // 渲染进程请求读取音频文件，主进程读取后以 ArrayBuffer 形式返回
    // 支持本地文件路径和 HTTP URL（Subsonic 流媒体）
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
          // Subsonic 等流媒体：通过 HTTP 获取
          const resp = await net.fetch(filePath);
          if (!resp.ok) {
            sendErr(`HTTP ${resp.status}: ${resp.statusText}`);
            return;
          }
          const buf = await resp.arrayBuffer();
          sendOk(buf);
        } else {
          // 本地文件
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
      // 新文件夹纳入 FileWatcher 监控
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
      // 停止监控已移除的文件夹
      if (this._libraryWatcher) this._libraryWatcher.syncFolders();
      this._player.reloadLikedTracks();
      this._emitLibraryUpdated();
      this._emitLikedTracksChanged();
    });

    ipcMain.handle('rescan_folder', (_e, folderPath) => {
      const folderInfo = this._lib.rescanFolder(folderPath);
      const resolvedPath = folderInfo.path || folderPath;
      // 使用增量同步（syncFolderIncremental）而非全量扫描（scanFolder），
      // 仅对真正新增/消失的曲目做写库，保留仍存在曲目的
      // liked_tracks / play_history / playlist_tracks 关联数据。
      this._scanFolderAsync(resolvedPath, true);
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

    // ── 音频设备 ──
    ipcMain.handle('get_audio_devices', () => this._player.getAudioDevices());
    ipcMain.handle('set_output_device', (_e, deviceId) => {
      this._player.setOutputDevice(deviceId);
      this._settings.set('audio_output_device', deviceId);
    });

    // ── SoundTouch: tempo / pitch / rate ──
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

    // ── AutoMix / クロスフェード ──
    ipcMain.handle('set_automix', (_e, enabled) => {
      this._player.setAutomixEnabled(!!enabled);
    });
    ipcMain.handle('get_automix', () => this._player.automixEnabled);
    ipcMain.handle('set_crossfade_duration', (_e, ms) => {
      this._player.setCrossfadeDuration(parseInt(ms, 10));
    });
    ipcMain.handle('get_crossfade_duration', () => this._player.crossfadeDurationMs);

    // ── 莫奈取色：系统强调色 ──
    // 注意：非同期で実行し、メインプロセスのイベントループをブロックしない
    ipcMain.handle('get_system_accent_color', async () => _getSystemAccentColor());

    // ── Gapless ──
    ipcMain.handle('set_gapless', (_e, enabled) => {
      this._player.setGaplessEnabled(!!enabled);
    });
    ipcMain.handle('get_gapless', () => this._player.gaplessEnabled);

    // ── 智能过渡：分析缓存 + osu! 谱面 ──

    /**
     * 获取缓存的音轨分析结果。
     * @param {string} trackId - 音轨 ID
     * @returns {object|null} 分析结果，或 null（未缓存）
     */
    ipcMain.handle('get_track_analysis', (_e, trackId) => {
      if (!this._analysisCache || !trackId) return null;
      try {
        return this._analysisCache.get(trackId);
      } catch (e) {
        console.warn('[bridge] get_track_analysis error:', e.message);
        return null;
      }
    });

    /**
     * 保存音轨分析结果到磁盘缓存。
     * @param {string} trackId - 音轨 ID
     * @param {object} analysis - 分析结果
     */
    ipcMain.handle('save_track_analysis', (_e, trackId, analysis) => {
      if (!this._analysisCache || !trackId || !analysis) return;
      try {
        this._analysisCache.set(trackId, analysis);
      } catch (e) {
        console.warn('[bridge] save_track_analysis error:', e.message);
      }
    });

    /**
     * 搜索 osu! 谱面数据（通过 sayobot API）。
     * @param {string} title - 歌曲标题
     * @param {string} artist - 艺术家
     * @param {number} durationMs - 音频时长（ms），用于匹配
     * @returns {object|null} { bpm, beatLengthMs, kiaiSections, source, beatmapId, beatmapSetId }
     */
    ipcMain.handle('search_osu_beatmap', async (_e, title, artist, durationMs) => {
      if (!this._osuProvider || !title) return null;
      try {
        return await this._osuProvider.search(title, artist, durationMs);
      } catch (e) {
        console.warn('[bridge] search_osu_beatmap error:', e.message);
        return null;
      }
    });

    /**
     * 接收渲染进程计算的过渡方案。
     * 主进程存储方案用于可能的 FFmpeg seek 调整和日志记录。
     * @param {object} plan - TransitionPlanner 生成的过渡方案
     */
    ipcMain.handle('set_transition_plan', (_e, plan) => {
      this._currentTransitionPlan = plan || null;
      if (plan) {
        console.log('[bridge] Transition plan received: start=' + plan.transitionStartMs +
          'ms, duration=' + plan.crossfadeDurationMs + 'ms, confidence=' + plan.confidence);
      }
      return true;
    });

    // ── Cover/Media URL ──
    ipcMain.handle('get_cover_base_url', () => this._coverServer.baseUrl);
    ipcMain.handle('get_media_base_url', () => this._coverServer.mediaBaseUrl);

    // ── 艺人头像后台预热（本地库慢慢缓存）──
    // 渲染进程传入全部艺人名（JSON 数组），主进程以节流队列逐个抓取并落盘。
    // 立即返回（不等待整条队列），抓取在后台异步进行。
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

    // ── Video Background: 查找同名视频文件 ──
    /**
     * 查找与指定音轨同名的视频文件（MV / 短视频背景）。
     * 在音轨所在目录下搜索同名但不同扩展名的视频文件。
     * @param {string} trackId - 音轨 ID
     * @returns {{path: string, url: string}|null} 视频文件路径和可访问的 HTTP URL，未找到返回 null
     */
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
          // base64url 编码路径，用于 /video/ 端点
          const b64 = Buffer.from(videoPath, 'utf-8').toString('base64')
            .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
          const url = this._coverServer.baseUrl + '/video/' + b64;
          return { path: videoPath, url: url };
        }
      }
      return null;
    });

    // ── 歌词搜索 ──
    ipcMain.handle('search_netease_lyrics', async (_e, query) => {
      const { search } = require('./lyrics');
      return search(query);
    });
    ipcMain.handle('fetch_netease_lyrics', async (_e, songId) => {
      const { fetchLyrics } = require('./lyrics');
      return fetchLyrics(songId);
    });
    // 多平台统一歌词搜索
    ipcMain.handle('search_lyrics', async (_e, query, source) => {
      const { searchLyrics } = require('./lyrics');
      return searchLyrics(query, source);
    });
    ipcMain.handle('fetch_lyrics', async (_e, songId, source) => {
      const { fetchLyricsById } = require('./lyrics');
      return fetchLyricsById(songId, source);
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
    ipcMain.handle('get_play_stats', () => {
      return _dump(this._lib.getPlayStats());
    });
    ipcMain.handle('get_daily_mixes', () => {
      return _dump(this._lib.getDailyMixes());
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
    ipcMain.handle('get_all_playlist_track_ids', () => {
      return _dump(this._lib.getAllPlaylistTrackIds());
    });

    // ── 添加曲目到远程歌单（同步到 Subsonic 服务器）──
    ipcMain.handle('add_tracks_to_remote_playlist', async (_e, playlistId, trackIdsJson) => {
      const trackIds = JSON.parse(trackIdsJson || '[]');
      if (trackIds.length === 0) return _dump({ error: '没有曲目' });

      const info = this._lib.getPlaylistRemoteInfo(playlistId);
      if (!info || info.source !== 'subsonic' || !info.server_id || !info.remote_id) {
        return _dump({ error: '不是远程歌单或信息缺失' });
      }

      const cfg = this._lib.getSubsonicServer(info.server_id);
      if (!cfg) return _dump({ error: '服务器不存在' });

      // 将本地 track ID 映射为 Subsonic 服务器端 ID
      const { subsonicIds, skipped } = this._lib.getSubsonicTrackIds(trackIds, info.server_id);
      if (subsonicIds.length === 0) {
        return _dump({ error: '所选曲目均不属于该 Subsonic 服务器，无法添加到远程歌单', skipped: trackIds.length });
      }

      const { SubsonicClient } = require('./subsonic');
      const client = new SubsonicClient(cfg.server_url, cfg.username, cfg.password, cfg.protocol_mode || 'subsonic', 30.0);

      try {
        // 推送到远程服务器
        await client.updatePlaylist(info.remote_id, { songIdsToAdd: subsonicIds });
        // 同时更新本地数据库
        const added = this._lib.addTracksToPlaylist(parseInt(playlistId, 10), trackIds);
        this._emitPlaylistsChanged();
        return _dump({ added, skipped: skipped.length, total: trackIds.length });
      } catch (e) {
        return _dump({ error: String(e.message || e) });
      }
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

    // ── Cover colors ──
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

    // ── Remote Playlists (Subsonic) ───────────────────────────────
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
          // 先将远程曲目写入本地数据库，否则 playlist_tracks 的 INSERT OR IGNORE 会静默跳过
          this._lib.upsertSubsonicTracksBatch(serverId, remotePlaylist.tracks);
          const trackIds = remotePlaylist.tracks.map((track) => subsonicTrackId(serverId, track.id));
          this._lib.replacePlaylistTracks(playlist.id, trackIds);
          // 异步获取 owner 的 email（用于 Gravatar 头像），失败不阻塞导入
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
        // 先将远程曲目写入本地数据库
        this._lib.upsertSubsonicTracksBatch(info.server_id, remotePlaylist.tracks);
        const trackIds = remotePlaylist.tracks.map((track) => subsonicTrackId(info.server_id, track.id));
        const added = this._lib.replacePlaylistTracks(playlistId, trackIds);
        // 同步时也刷新 owner email
        if (remotePlaylist.owner) {
          client.getUser(remotePlaylist.owner).then((user) => {
            if (user.email) {
              this._lib.updatePlaylistOwnerEmail(playlistId, user.email);
              this._emitPlaylistsChanged();
            }
          }).catch(() => { /* 非关键，静默忽略 */ });
        }
        this._emitPlaylistsChanged();
        return _dump({ ok: true, trackCount: added, name: remotePlaylist.name });
      } catch (e) {
        return _dump({ ok: false, error: String(e) });
      }
    });

    // ── Lyrics ──
    ipcMain.handle('apply_lyrics', (_e, trackId, lyrics) => {
      this._lib.updateLyrics(trackId, lyrics);
      this._player.updateTrackLyrics(trackId, lyrics);
      // lyrics_changed event is emitted by updateTrackLyrics — no need to
      // emit track_changed here (would trigger glitch animation + play history)
      return _dump({ success: true });
    });

    ipcMain.handle('apply_lyrics_temporary', (_e, trackId, lyrics) => {
      this._player.updateTrackLyrics(trackId, lyrics);
      return _dump({ success: true });
    });

    // 从音频文件中提取内嵌歌词
    ipcMain.handle('get_embedded_lyrics', async (_e, trackId) => {
      const lyrics = await this._lib.getEmbeddedLyrics(trackId);
      return lyrics || '';
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
        tempo: this._player.tempo,
        pitch: this._player.pitch,
        rate: this._player.rate,
      });
    });

    // ── Renderer 就绪信号 ──
    // AudioEngine 初始化完成后渲染进程调用此 handler，
    // 主进程据此延迟恢复播放状态，避免 audio_control 事件在窗口就绪前丢失。
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

    // ── Settings ──
    ipcMain.handle('get_settings', () => _dump(this._settings.all()));

    ipcMain.handle('save_settings', (_e, dataJson) => {
      const data = JSON.parse(dataJson);
      this._settings.update(data);
      const settingsJson = _dump(this._settings.all());
      this.emit('settings_changed', settingsJson);
      this._emit('settings_changed', settingsJson);
      // 自动刷新相关设置变更时，重启 FileWatcher / 远程定期同步
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
    // 根据当前主题（亮/暗）同步窗口图标，使任务栏/Alt-Tab 图标随系统暗色模式变化
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
        } catch { /* 尝试下一套 */ }
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

    // ── 外部音乐标签编辑应用 ──
    // 弹出文件选择对话框，让用户挑选外部标签编辑器可执行文件
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

    // 使用外部标签编辑器打开指定音频文件（支持单个或多个文件）
    // 参数：filePath 或 filePaths 数组
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

  _scanFolderAsync(folderPath, useIncremental = false) {
    setImmediate(async () => {
      try {
        if (useIncremental) {
          await this._lib.syncFolderIncremental(folderPath);
        } else {
          await this._lib.scanFolder(folderPath);
        }
      } catch (e) {
        console.error('[scan] 后台扫描失败:', e);
      }
      try {
        this._emitLibraryUpdated();
      } catch (e) {
        console.error('[scan] 推送更新失败:', e);
      }
    });
  }

  // ── 库自动刷新：本地 FileWatcher + 远程定期 re-sync ──

  /**
   * 启动库自动刷新。可重复调用（先停后启，用于设置变更后重启）。
   * 本地：FileWatcher 监控各库文件夹，分层增量扫描后经 onChanged 推送更新。
   * 远程：定期调用 _syncSubsonicServer（自带防重入）刷新本地缓存数据库。
   */
  startAutoRefresh() {
    this.stopAutoRefresh();
    try {
      const { LibraryWatcher, RemoteSyncScheduler } = require('./auto_refresh');
      this._libraryWatcher = new LibraryWatcher(this._lib, this._settings, {
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
      try { this._libraryWatcher.stop(); } catch { /* ignore */ }
      this._libraryWatcher = null;
    }
    if (this._remoteSyncScheduler) {
      try { this._remoteSyncScheduler.stop(); } catch { /* ignore */ }
      this._remoteSyncScheduler = null;
    }
  }

  /**
   * FileWatcher 分层扫描检测到库内容变动后的推送。
   * 复用前端已监听的 library_updated / folders_updated 事件，无需前端改动。
   */
  _onAutoRefreshChanged(folderPath, stats) {
    try {
      if (stats.removed > 0) {
        // 有曲目被移除：同步清理播放器内存中的收藏状态
        this._player.reloadLikedTracks();
        this._emitLikedTracksChanged();
        this._emitPlaylistsChanged();
      }
      this._emitLibraryUpdated();
    } catch (e) {
      console.error('[auto-refresh] 推送库更新失败:', e.message || e);
    }
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
        try { this._lib.updateSubsonicServerLastSync(serverId); } catch { /* ignore */ }

        this._emitSubsonicServersChanged();
        this._emitLibraryUpdated();
        this._emit('subsonic_sync_result', _dump({ ok: true, server_id: serverId, stats }));

        // ── 同步远程歌单 ──────────────────────────────────────────────
        // 常规同步只处理 artist/album/track，歌单需额外拉取并持久化。
        // 作为后台任务运行，不阻塞 cover prefetch / finally 清理。
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
                        try { this._lib.updatePlaylistOwnerEmail(playlist.id, user.email); } catch { /* ignore */ }
                      }
                    }).catch(() => {});
                  }
                } catch (e) {
                  stats.warnings.push('歌单同步失败(' + pl.id + '): ' + (e && e.message ? e.message : e));
                }
              }
            }

            // 清理服务器上已不存在的远程歌单
            const localPLs = this._lib.listRemotePlaylists(serverId);
            for (const lp of localPLs) {
              if (!serverPLIds.has(String(lp.remote_id))) {
                try { this._lib.deletePlaylist(lp.id); } catch { /* ignore */ }
              }
            }

            this._emitPlaylistsChanged();
          } catch (e) {
            // playlist sync failure is non-fatal — server and track data are already updated
            console.warn('[subsonic] 远程歌单同步失败:', e);
          }
        });

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

  // ── 电台 ICY 元数据管理 ──────────────────────────────────────────────────

  close() {
    this._closeFloatingWindow();
    // 停止库自动刷新（FileWatcher / 远程定期同步）
    this.stopAutoRefresh();
    // 保留中の library_updated debounce タイマーを破棄
    if (this._libraryUpdatedTimer) {
      clearTimeout(this._libraryUpdatedTimer);
      this._libraryUpdatedTimer = null;
    }
    this._libraryUpdatedPending = false;
    // 刷新分析缓存到磁盘（确保退出时不丢失）
    if (this._analysisCache) {
      try { this._analysisCache.flush(); } catch (e) {
        console.warn('[bridge] AnalysisCache flush failed:', e.message);
      }
    }
  }
}

// ── 系统强调色读取 ──
// 从 Windows 注册表读取 DWM 个性色，用于莫奈取色「系统壁纸」来源。
// 非同期 execFile で実行し、メインプロセスのイベントループをブロックしない。
// （以前は execSync で reg query を同期実行していたため、起動直後や
//   設定画面の更新時にメインスレッドが最大 3 秒ブロックされ、
//   その間 audio_output IPC も処理できず WASAPI バッファアンダーラン →
//   「なんだか分からないけど止まる」原因の一つだった）
async function _getSystemAccentColor() {
  const { execFile } = require('child_process');

  /**
   * @param {string} cmd
   * @param {string[]} args
   * @returns {Promise<string>} stdout
   */
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
    // Windows DWM accent color: HKCU\SOFTWARE\Microsoft\Windows\DWM
    // AccentColor 为 ARGB DWORD，格式: 0xAARRGGBB
    const output = await run('reg', [
      'query', 'HKCU\\SOFTWARE\\Microsoft\\Windows\\DWM', '/v', 'AccentColor',
    ]);
    const match = output.match(/AccentColor\s+REG_DWORD\s+0x([0-9a-fA-F]{8})/);
    if (match) {
      const argb = parseInt(match[1], 16);
      const r = (argb >> 16) & 0xff;
      const g = (argb >> 8) & 0xff;
      const b = argb & 0xff;
      // 忽略透明度过低的颜色（未设置个性色时 A=0）
      const a = (argb >> 24) & 0xff;
      if (a > 0 && (r > 0 || g > 0 || b > 0)) {
        return [r, g, b];
      }
    }
    // 回退：ColorPrevalence 关闭时，读取 Start/Taskbar accent
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
