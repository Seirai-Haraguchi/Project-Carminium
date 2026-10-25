'use strict';

const { EventEmitter } = require('events');
const { SHARE_SHARED, SHARE_EXCLUSIVE } = require('./wasapi');

const IS_WIN = process.platform === 'win32';

function _stripLyricsForQueue(track) {
  if (!track || track.lyrics === undefined) return track;
  const out = {};
  for (const k in track) {
    if (k !== 'lyrics') out[k] = track[k];
  }
  return out;
}

class MusicPlayer extends EventEmitter {
  constructor(settings = null, library = null, renderer = null) {
    super();

    this._settings = settings;
    this._library = library;

    this._renderer = renderer;

    this._fe_state = 'stopped';
    this._fe_position = 0;
    this._fe_duration = 0;
    this._fe_volume = 80;

    this._exclusive = IS_WIN && settings ? !!settings.get('wasapi_exclusive', false) : false;

    this._nativePlayToken = 0;

    this._dummyModeNotified = false;

    this._tempo = 1.0;
    this._pitch = 1.0;
    this._rate = 1.0;

    this._original_queue = [];
    this._queue = [];
    this._current_index = -1;
    this._shuffle = false;
    this._repeat = 'off';
    this._shuffle_history = [];
    this._liked_tracks = new Set();
    this._media_base_url = '';

    if (library) {
      try {
        this._liked_tracks = library.getLikedTrackIds();
      } catch {
      }
    }

    // AutoMix 是唯一过渡模式；无可执行淡变时由引擎按条件使用无缝切换。
    this._automixEnabled = settings ? !!settings.get('automix', false) : false;
    this._radicalTransitions = settings ? !!settings.get('radical_transitions', false) : false;
    this._crossfadeDurationMs = settings ? parseInt(settings.get('crossfade_duration', 4000), 10) || 4000 : 4000;

    this._inCrossfade = false;

    // 规划器确定流媒体 next 的非零入轨点后，预滚解码必须从该位置开始。
    // 0 表示从文件头预滚（本地 buffer 的 entry 由渲染侧 source.start(offset) 实现）。
    this._plannedNextEntryMs = 0;
    this._lastAppliedNextEntryMs = -1;
    this._applyPlanInFlight = false;

    this._webAudioEnabled = false;

    this._preloadDelayTimer = null;
    this._queueChangedDelayTimer = null;

    if (this._renderer) {
      this._renderer.on('state_changed', (state) => {
        this._fe_state = state;
        this.emit('state_changed', state);
      });

      this.emit('audio_control', JSON.stringify({ action: 'set_crossfade', enabled: this._automixEnabled }));
      this.emit('audio_control', JSON.stringify({ action: 'set_radical_transitions', enabled: this._radicalTransitions }));
      this.emit('audio_control', JSON.stringify({ action: 'set_crossfade_duration', ms: this._crossfadeDurationMs }));
      this.emit('audio_control', JSON.stringify({ action: 'set_output_sink', nullSink: this._exclusive }));
    }
  }


  _getDeviceIndex() {
    const devId = this._settings ? this._settings.get('audio_output_device', '') : '';
    const idx = parseInt(devId, 10);
    return isNaN(idx) ? -1 : idx;
  }


  _emitAudioControl(action, params) {
    const payload = params ? { action, ...params } : { action };
    this.emit('audio_control', JSON.stringify(payload));
  }

  _invokeAudioControl(action, params) {
    const payload = params ? { action, ...params } : { action };
    const json = JSON.stringify(payload);
    return new Promise((resolve) => {
      let settled = false;
      const done = (v) => { if (!settled) { settled = true; resolve(v); } };
      this.emit('audio_control_await', json, done);
      const t = setTimeout(() => done(undefined), 4000);
      if (t.unref) t.unref();
    });
  }

  _stopAudioEngine() {
    this._emitAudioControl('stop');
    this._emitAudioControl('clear_next');
  }

  async _reinitRendererWithMode(exclusive) {
    if (!this._renderer) return false;

    await this._releaseAudioContext();

    if (this._renderer.isInitialized) {
      await this._renderer.close();
    }

    const shareMode = exclusive ? SHARE_EXCLUSIVE : SHARE_SHARED;
    const initInfo = await this._renderer.init({
      shareMode,
      deviceIndex: this._getDeviceIndex(),
      sampleRate: 44100,
      channels: 2,
    });

    if (shareMode === SHARE_EXCLUSIVE && initInfo.shareMode !== SHARE_EXCLUSIVE) {
      this._fallbackToShared();
    }

    const effectiveExclusive = exclusive && initInfo.shareMode === SHARE_EXCLUSIVE;
    this._emitAudioControl('init', {
      sampleRate: this._renderer._sampleRate,
      channels: this._renderer._channels,
      rebuild: true,
      nullSink: effectiveExclusive,
    });
    this._emitAudioControl('set_volume', { level: this._fe_volume / 100 });

    return true;
  }

  _releaseAudioContext() {
    return this._invokeAudioControl('release_context');
  }

  _fallbackToShared() {
    this._exclusive = false;
    if (this._settings) {
      this._settings.set('wasapi_exclusive', false);
    }
    this._emitAudioControl('set_output_sink', { nullSink: false });
    this.emit('settings_changed', JSON.stringify(this._settings.all()));
  }

  setWebAudioEnabled(enabled) {
    this._webAudioEnabled = !!enabled;
    if (this._renderer) {
      this._renderer.setWebAudioEnabled(enabled);
    }
    console.log('[player] Web Audio mode:', enabled ? 'enabled' : 'disabled');
  }

  _needsFFmpegForTrack(track) {
    if (!this._webAudioEnabled) return true;
    const path = this._resolvePlayablePath(track);
    if (!path) return true;
    if (path.startsWith('http://') || path.startsWith('https://')) return true;
    const ext = path.split('.').pop().toLowerCase();
    const browserDecodable = ['mp3', 'wav', 'ogg', 'oga', 'opus', 'm4a', 'aac', 'flac', 'mp4', 'weba', 'webm'];
    return !browserDecodable.includes(ext);
  }


  _handleAudioPositionTick(ms) {
    this._fe_position = ms;
    this.emit('position_changed', ms);
  }

  _handleAudioEnded() {
    this.nextTrack();
  }

  _handleAudioCrossfadeComplete(positionMs) {
    this._inCrossfade = false;
    this._onCrossfadeComplete(positionMs);
  }

  _handleAudioCrossfadeStart() {
    this._inCrossfade = true;
  }

  _handleGaplessSwitch() {
    this._inCrossfade = false;
    if (this._renderer && this._renderer.promoteNextToCurrent) {
      this._renderer.promoteNextToCurrent();
    }

    if (this._repeat !== 'one') {
      this._current_index += 1;
      if (this._current_index >= this._queue.length) {
        if (this._repeat === 'all') {
          this._current_index = 0;
        } else {
          this._fe_state = 'stopped';
          this.emit('state_changed', 'stopped');
          return;
        }
      }
    }

    const track = this._queue[this._current_index];
    if (!track) return;

    this._fe_position = 0;
    this._fe_duration = this._resolveDuration(
      this._renderer ? this._renderer._durationMs : 0,
      track
    );

    this.emit('track_changed', JSON.stringify(track));
    this.emit('liked_changed', this.isCurrentLiked);
    this.emit('duration_changed', this._fe_duration);
    this.emit('position_changed', 0);
    this._emitQueueChangedDelayed(400);

    if (this._shuffle && this._current_index >= 0) {
      if (!this._shuffle_history.length ||
          this._shuffle_history[this._shuffle_history.length - 1] !== this._current_index) {
        this._shuffle_history.push(this._current_index);
      }
    }

    this._schedulePreloadNext(1200);
  }


  playTracks(tracks, startIndex = 0) {
    this._original_queue = [...tracks];
    this._queue = [...tracks];
    this._shuffle_history = [];

    if (this._shuffle && this._queue.length > 1) {
      const chosen = this._queue.splice(startIndex, 1)[0];
      this._shuffleArray(this._queue);
      this._queue.unshift(chosen);
      startIndex = 0;
    }

    this._playAt(startIndex);
    this._emitQueueChanged();
  }

  addNext(track) {
    if (!this._queue.length || this._current_index < 0) {
      this.playTracks([track]);
      return;
    }
    const insertPos = this._current_index + 1;
    this._queue.splice(insertPos, 0, track);

    try {
      const origIdx = this._original_queue.findIndex(
        (t) => t.id === this._queue[this._current_index].id
      );
      if (origIdx >= 0) this._original_queue.splice(origIdx + 1, 0, track);
      else this._original_queue.push(track);
    } catch {
      this._original_queue.push(track);
    }

    this._emitQueueChanged();

    if (this._renderer && this._renderer.hasNextPreloaded()) {
      this._renderer.cancelPreloadNext();
      this.emit('audio_control', JSON.stringify({ action: 'clear_next' }));
    }
    if (this._automixEnabled) {
      this._preloadNextTrack();
    }
  }

  appendQueue(track) {
    if (!this._queue.length) {
      this.playTracks([track]);
      return;
    }
    const needsPreload = (this._current_index === this._queue.length - 1);
    this._queue.push(track);
    this._original_queue.push(track);
    this._emitQueueChanged();

    if (needsPreload && this._automixEnabled) {
      this._preloadNextTrack();
    }
  }

  removeFromQueue(index) {
    if (index < 0 || index >= this._queue.length) return;
    if (index === this._current_index) return;

    const wasPreloadedNext = (index === this._current_index + 1);

    const removed = this._queue.splice(index, 1)[0];
    if (index < this._current_index) this._current_index--;

    try {
      const origIdx = this._original_queue.findIndex((t) => t.id === removed.id);
      if (origIdx >= 0) this._original_queue.splice(origIdx, 1);
    } catch {
    }

    this._shuffle_history = this._shuffle_history
      .filter((h) => h !== index)
      .map((h) => (h > index ? h - 1 : h));

    this._emitQueueChanged();

    if (wasPreloadedNext && this._renderer && this._renderer.hasNextPreloaded()) {
      this._renderer.cancelPreloadNext();
      this.emit('audio_control', JSON.stringify({ action: 'clear_next' }));
    }
    if (wasPreloadedNext && this._automixEnabled) {
      this._preloadNextTrack();
    }
  }

  reorderQueue(fromIndex, toIndex) {
    if (fromIndex < 0 || fromIndex >= this._queue.length) return;
    if (toIndex < 0 || toIndex >= this._queue.length) return;
    if (fromIndex === toIndex) return;
    if (fromIndex === this._current_index) return;

    const moved = this._queue.splice(fromIndex, 1)[0];
    this._queue.splice(toIndex, 0, moved);

    try {
      const origIdx = this._original_queue.findIndex((t) => t.id === moved.id);
      if (origIdx >= 0) {
        const origMoved = this._original_queue.splice(origIdx, 1)[0];
        let origTo = origIdx;
        if (toIndex > fromIndex) {
          origTo = Math.min(origIdx + (toIndex - fromIndex), this._original_queue.length);
        } else {
          origTo = Math.max(0, origIdx - (fromIndex - toIndex));
        }
        this._original_queue.splice(Math.min(origTo, this._original_queue.length), 0, origMoved);
      }
    } catch {
    }

    if (fromIndex < this._current_index && toIndex >= this._current_index) {
      this._current_index--;
    } else if (fromIndex > this._current_index && toIndex <= this._current_index) {
      this._current_index++;
    }

    this._shuffle_history = this._shuffle_history.map((h) => {
      if (h === fromIndex) return toIndex;
      if (fromIndex < h && toIndex >= h) return h - 1;
      if (fromIndex > h && toIndex <= h) return h + 1;
      return h;
    });

    this._emitQueueChanged();

    if (toIndex === this._current_index + 1 || fromIndex === this._current_index + 1) {
      if (this._renderer && this._renderer.hasNextPreloaded()) {
        this._renderer.cancelPreloadNext();
        this.emit('audio_control', JSON.stringify({ action: 'clear_next' }));
      }
      if (this._automixEnabled) {
        this._preloadNextTrack();
      }
    }
  }

  getQueue() {
    return [...this._queue];
  }

  get current_index() {
    return this._current_index;
  }

  _emitQueueChanged() {
    const data = {
      queue: this._queue.map(_stripLyricsForQueue),
      current_index: this._current_index,
    };
    this.emit('queue_changed', JSON.stringify(data));
  }

  _emitQueueChangedDelayed(delayMs) {
    if (this._queueChangedDelayTimer) clearTimeout(this._queueChangedDelayTimer);
    this._queueChangedDelayTimer = setTimeout(() => {
      this._queueChangedDelayTimer = null;
      this._emitQueueChanged();
    }, delayMs);
  }

  _schedulePreloadNext(delayMs) {
    if (this._preloadDelayTimer) {
      clearTimeout(this._preloadDelayTimer);
      this._preloadDelayTimer = null;
    }
    this._preloadDelayTimer = setTimeout(() => {
      this._preloadDelayTimer = null;
      if (this._fe_state !== 'playing') return;
      if (this._automixEnabled) {
        this._preloadNextTrack();
      }
    }, delayMs);
  }

  _cancelScheduledPreload() {
    if (this._preloadDelayTimer) {
      clearTimeout(this._preloadDelayTimer);
      this._preloadDelayTimer = null;
    }
  }

  setMediaBaseUrl(url) {
    this._media_base_url = url || '';
  }

  _resolvePlayablePath(track) {
    if (track.source === 'subsonic' && this._library) {
      const localTrack = this._library.findLocalTrackForSubsonic(track);
      if (localTrack && localTrack.path) {
        return localTrack.path;
      }
    }
    if (track.source === 'webdav' && this._library) {
      const localTrack = this._library.findLocalTrackForSubsonic(track);
      if (localTrack && localTrack.path) {
        return localTrack.path;
      }
    }
    if (track.source === 'smb') {
      return track.path || '';
    }
    if (track.source !== 'subsonic' && track.source !== 'webdav') return track.path || '';

    if (track.source === 'subsonic') {
      const p = track.path || '';
      if (!p.startsWith('subsonic://')) return p;
      const parts = p.slice('subsonic://'.length).split('/');
      if (parts.length < 2) return p;
      const serverId = parts[0];
      const subsonicId = parts.slice(1).join('/');
      if (!this._media_base_url) return p;
      return `${this._media_base_url}/subsonic/stream/${serverId}/${subsonicId}`;
    }

    if (track.source === 'webdav') {
      const p = track.path || '';
      const prefix = 'webdav://';
      if (!p.startsWith(prefix)) return p;
      const rest = p.slice(prefix.length);
      const match = rest.match(/^(\d+)(.*)/);
      if (!match) return p;
      const serverId = match[1];
      const relativePath = match[2];
      if (!this._media_base_url) return p;
      return `${this._media_base_url}/webdav/stream/${serverId}${relativePath}`;
    }

    return track.path || '';
  }

  _resolveDuration(probeMs, track) {
    if (probeMs > 0) return probeMs;
    if (track && track.duration_ms > 0) return track.duration_ms;
    return 0;
  }

  _playAt(index) {
    if (index < 0 || index >= this._queue.length) return;
    this._cancelScheduledPreload();
    this._current_index = index;
    if (this._shuffle) {
      if (!this._shuffle_history.length || this._shuffle_history[this._shuffle_history.length - 1] !== index) {
        this._shuffle_history.push(index);
      }
    }
    const track = this._queue[index];
    this._fe_position = 0;
    this._fe_state = 'stopped';

    this._playNative(track);
  }

  async _playNative(track) {
    if (!this._renderer || !track) return;
    const myToken = ++this._nativePlayToken;
    this._cancelScheduledPreload();
    this._inCrossfade = false;
    this._plannedNextEntryMs = 0;
    this._lastAppliedNextEntryMs = -1;

    const filePath = this._resolvePlayablePath(track);
    if (!filePath) {
      console.error('[player] No playable path for track:', track.id);
      return;
    }

    try {
      if (this._renderer.isInitialized) {
        this._renderer.stop();
      }
    } catch {  }

    this.emit('audio_control', JSON.stringify({ action: 'stop' }));
    this.emit('audio_control', JSON.stringify({ action: 'clear_next' }));

    try {
      if (!this._renderer.isInitialized) {
        const shareMode = this._exclusive ? SHARE_EXCLUSIVE : SHARE_SHARED;
        const initInfo = await this._renderer.init({
          shareMode,
          deviceIndex: this._getDeviceIndex(),
          sampleRate: 44100,
          channels: 2,
        });
        if (myToken !== this._nativePlayToken) return;
        if (shareMode === SHARE_EXCLUSIVE && initInfo.shareMode !== SHARE_EXCLUSIVE) {
          this._fallbackToShared();
        }
        this.emit('audio_control', JSON.stringify({
          action: 'init',
          sampleRate: this._renderer._sampleRate,
          channels: this._renderer._channels,
          nullSink: initInfo.shareMode === SHARE_EXCLUSIVE,
        }));
        if (this._renderer.isDummyMode && !this._dummyModeNotified) {
          this._dummyModeNotified = true;
          this.emit('playback_error', JSON.stringify({
            type: 'no_audio_device',
            message: 'No audio output device found. Playback continues without sound.',
          }));
        }
      }
      this._renderer._currentFilePath = filePath;

      this.emit('state_changed', 'loading');
      this.emit('track_changed', JSON.stringify(track));
      this.emit('liked_changed', this.isCurrentLiked);
      this._emitQueueChanged();

      const needsFFmpeg = this._needsFFmpegForTrack(track);
      let info;
      if (this._webAudioEnabled && !needsFFmpeg) {
        info = await this._renderer.setupForBrowserDecode(filePath);
      } else {
        info = await this._renderer.playFile(filePath);
      }
      if (myToken !== this._nativePlayToken) return;

      const durationMs = this._resolveDuration(info.durationMs, track);
      if (!info.durationMs && durationMs > 0) {
        console.log('[player] Using metadata duration fallback:', durationMs, 'ms for', track.title);
      }

      this._fe_duration = durationMs;
      this.emit('duration_changed', this._fe_duration);

      this.emit('audio_control', JSON.stringify({
        action: 'play',
        filePath: filePath,
        durationMs: durationMs,
        seekOffsetMs: 0,
        trackId: track.id || '',
        title: track.title || '',
        artist: track.artist || track.album_artist || '',
        album: track.album || '',
        albumArtist: track.album_artist || '',
        trackNumber: track.track_number || 0,
        discNumber: track.disc_number || 0,
        fileSize: track.file_size || 0,
        suffix: track.suffix || '',
        source: track.source || 'local',
      }));

      await this._renderer.play();
      if (myToken !== this._nativePlayToken) return;
      this.emit('audio_control', JSON.stringify({ action: 'set_volume', level: this._fe_volume / 100 }));

      if (this._webAudioEnabled && needsFFmpeg) {
        this.emit('audio_control', JSON.stringify({
          action: 'play_streaming',
          durationMs: durationMs,
          seekOffsetMs: 0,
          filePath: filePath,
          trackId: track.id || '',
          title: track.title || '',
          artist: track.artist || track.album_artist || '',
          album: track.album || '',
          albumArtist: track.album_artist || '',
          trackNumber: track.track_number || 0,
          discNumber: track.disc_number || 0,
          fileSize: track.file_size || 0,
          suffix: track.suffix || '',
          source: track.source || 'local',
        }));
      }

      if (this._automixEnabled) {
        this._preloadNextTrack();
      }
    } catch (e) {
      if (myToken !== this._nativePlayToken) return;
      console.error('[player] Native playback failed:', e);
    }
  }


  _getNextTrackForPreload() {
    if (!this._queue.length || this._current_index < 0) return null;

    if (this._repeat === 'one') {
      return this._queue[this._current_index];
    }

    const nextIdx = this._current_index + 1;
    if (nextIdx < this._queue.length) {
      return this._queue[nextIdx];
    }

    if (this._repeat === 'all') {
      return this._queue[0];
    }

    return null;
  }

  async _preloadNextTrack() {
    console.log('[player] _preloadNextTrack called:',
      'renderer:', !!this._renderer,
      'automixEnabled:', this._automixEnabled,
      'initialized:', !!this._renderer?.isInitialized,
      'nextFilePath:', !!this._renderer?._nextFilePath);
    if (!this._renderer) return;
    if (!this._automixEnabled) return;
    if (!this._renderer.isInitialized) return;
    if (this._renderer._nextFilePath) return;

    const currentTrack = this._queue[this._current_index];
    const nextTrack = this._getNextTrackForPreload();
    if (!nextTrack) {
      console.log('[player] preload: no next track for preload');
      return;
    }

    const filePath = this._resolvePlayablePath(nextTrack);
    if (!filePath) return;

    if (this._tempo !== 1.0 || this._pitch !== 1.0 || this._rate !== 1.0) {
      return;
    }

    const currentNeedsFFmpeg = this._webAudioEnabled && currentTrack && this._needsFFmpegForTrack(currentTrack);
    const nextNeedsFFmpeg = this._webAudioEnabled && this._needsFFmpegForTrack(nextTrack);
    const skipFFmpeg = this._webAudioEnabled && !currentNeedsFFmpeg && !nextNeedsFFmpeg;

    const forceStreaming = currentNeedsFFmpeg;
    const nextStartOffsetMs = nextNeedsFFmpeg ? Math.max(0, this._plannedNextEntryMs || 0) : 0;

    const mode = 'AutoMix';
    console.log(`[player] ${mode}: preloading next track:`, nextTrack.title || nextTrack.id,
      'skipFFmpeg:', skipFFmpeg, 'forceStreaming:', forceStreaming);

    const metaDurationMs = this._resolveDuration(0, nextTrack);
    this.emit('audio_control', JSON.stringify({
      action: 'set_next_info',
      filePath: filePath,
      durationMs: metaDurationMs,
      forceStreaming: forceStreaming,
      trackId: nextTrack.id || '',
      title: nextTrack.title || '',
      artist: nextTrack.artist || nextTrack.album_artist || '',
      album: nextTrack.album || '',
      albumArtist: nextTrack.album_artist || '',
      trackNumber: nextTrack.track_number || 0,
      discNumber: nextTrack.disc_number || 0,
      fileSize: nextTrack.file_size || 0,
      suffix: nextTrack.suffix || '',
      source: nextTrack.source || 'local',
      nextStartOffsetMs: nextStartOffsetMs,
    }));
    this._lastAppliedNextEntryMs = nextStartOffsetMs;
    console.log(`[player] ${mode}: set_next_info sent early (duration=${metaDurationMs}ms from metadata`,
      'nextOffset=' + nextStartOffsetMs + 'ms)');

    try {
      const info = await this._renderer.preloadNext(filePath, { skipFFmpeg, seekMs: nextStartOffsetMs });
      const probedMs = this._resolveDuration(info.durationMs, nextTrack);
      if (probedMs > 0 && probedMs !== metaDurationMs) {
        this.emit('audio_control', JSON.stringify({
          action: 'set_next_info',
          filePath: filePath,
          durationMs: probedMs,
          forceStreaming: forceStreaming,
          trackId: nextTrack.id || '',
          title: nextTrack.title || '',
          artist: nextTrack.artist || nextTrack.album_artist || '',
          album: nextTrack.album || '',
          albumArtist: nextTrack.album_artist || '',
          trackNumber: nextTrack.track_number || 0,
          discNumber: nextTrack.disc_number || 0,
          fileSize: nextTrack.file_size || 0,
          suffix: nextTrack.suffix || '',
          source: nextTrack.source || 'local',
          nextStartOffsetMs: nextStartOffsetMs,
        }));
        console.log(`[player] ${mode}: set_next_info updated (duration=${probedMs}ms from ffprobe)`);
      }
    } catch (e) {
      console.warn('[player] preloadNext failed:', e.message, '- AudioEngine already notified');
    }
  }

  /**
   * 规划器可能在首次预滚之后才算出非零 entry。流媒体的 PCM 无法在渲染侧
   * "跳过"已解码的数据而不破坏时间轴，因此必须清掉旧预滚、让 FFmpeg 从
   * entry 重新解码。仅处理需要 FFmpeg 的 next；本地 buffer 由入轨偏移处理。
   */
  async applyTransitionPlan(plan) {
    const entryMs = plan ? Math.max(0, Number(plan.nextStartOffsetMs || plan.entryMs) || 0) : 0;
    const previousEntry = this._lastAppliedNextEntryMs;
    this._plannedNextEntryMs = entryMs;
    if (!this._renderer || !plan) return false;
    if (!this._webAudioEnabled || !this._renderer.isInitialized) return false;
    if (this._inCrossfade) return false;
    if (!this._renderer._nextFilePath) return false;
    if (previousEntry === entryMs) return false;
    // 正常只处理非零 entry；但若先前预滚在 12s、新计划退回 0，
    // 必须把解码器也拉回 0，否则计划写 0、实际从 12s 进入。
    const resetToZero = entryMs === 0 && previousEntry > 0;
    if (entryMs <= 0 && !resetToZero) return false;
    if (this._applyPlanInFlight) return false;

    const nextTrack = this._getNextTrackForPreload();
    if (!nextTrack || !this._needsFFmpegForTrack(nextTrack)) return false;
    const filePath = this._resolvePlayablePath(nextTrack);
    if (!filePath) return false;

    this._applyPlanInFlight = true;
    this._lastAppliedNextEntryMs = entryMs;
    try {
      // 先让渲染端丢弃 0 起点预滚，再重建 next 信息与解码器。
      this.emit('audio_control', JSON.stringify({ action: 'clear_next' }));
      this.emit('audio_control', JSON.stringify({
        action: 'set_next_info',
        filePath: filePath,
        durationMs: this._resolveDuration(0, nextTrack),
        forceStreaming: true,
        trackId: nextTrack.id || '',
        title: nextTrack.title || '',
        artist: nextTrack.artist || nextTrack.album_artist || '',
        album: nextTrack.album || '',
        albumArtist: nextTrack.album_artist || '',
        trackNumber: nextTrack.track_number || 0,
        discNumber: nextTrack.disc_number || 0,
        fileSize: nextTrack.file_size || 0,
        suffix: nextTrack.suffix || '',
        source: nextTrack.source || 'local',
        nextStartOffsetMs: entryMs,
      }));
      await this._renderer.preloadNext(filePath, { skipFFmpeg: false, seekMs: entryMs });
      console.log('[player] streaming next re-preloaded at entry', entryMs + 'ms:', filePath);
      return true;
    } catch (e) {
      this._lastAppliedNextEntryMs = -1;
      console.warn('[player] applyTransitionPlan re-preload failed:', e.message);
      return false;
    } finally {
      this._applyPlanInFlight = false;
    }
  }

  _onCrossfadeComplete(mixerPositionMs) {
    if (this._renderer && this._renderer.promoteNextToCurrent) {
      this._renderer.promoteNextToCurrent();
    }

    if (this._repeat !== 'one') {
      this._current_index += 1;
      if (this._current_index >= this._queue.length) {
        if (this._repeat === 'all') {
          this._current_index = 0;
        } else {
          this._fe_state = 'stopped';
          this.emit('state_changed', 'stopped');
          return;
        }
      }
    }

    const track = this._queue[this._current_index];
    if (!track) return;

    const seekOffset = (mixerPositionMs != null) ? mixerPositionMs : (this._renderer ? (this._renderer._seekOffsetMs || 0) : 0);
    this._fe_position = seekOffset;
    this._fe_duration = this._resolveDuration(this._renderer._durationMs, track);
    this.emit('track_changed', JSON.stringify(track));
    this.emit('liked_changed', this.isCurrentLiked);
    this.emit('duration_changed', this._fe_duration);
    this.emit('position_changed', seekOffset);
    this._emitQueueChangedDelayed(400);

    if (this._shuffle && this._current_index >= 0) {
      if (!this._shuffle_history.length ||
          this._shuffle_history[this._shuffle_history.length - 1] !== this._current_index) {
        this._shuffle_history.push(this._current_index);
      }
    }

    this._schedulePreloadNext(1200);
  }

  setAutomixEnabled(enabled) {
    this._automixEnabled = !!enabled;
    this.emit('audio_control', JSON.stringify({ action: 'set_crossfade', enabled: this._automixEnabled }));
    if (this._settings) {
      this._settings.set('automix', this._automixEnabled);
    }
    if (this._automixEnabled && this._fe_state === 'playing') {
      this._preloadNextTrack();
    }
  }

  get automixEnabled() {
    return this._automixEnabled;
  }

  setRadicalTransitionsEnabled(enabled) {
    this._radicalTransitions = !!enabled;
    if (this._settings) this._settings.set('radical_transitions', this._radicalTransitions);
    this.emit('audio_control', JSON.stringify({ action: 'set_radical_transitions', enabled: this._radicalTransitions }));
    if (this._radicalTransitions && !this._automixEnabled) this.setAutomixEnabled(true);
    if (this._automixEnabled && this._fe_state === 'playing') this._preloadNextTrack();
  }

  get radicalTransitionsEnabled() {
    return this._radicalTransitions;
  }

  setCrossfadeDuration(ms) {
    this._crossfadeDurationMs = Math.max(500, Math.min(15000, parseInt(ms, 10) || 4000));
    this.emit('audio_control', JSON.stringify({ action: 'set_crossfade_duration', ms: this._crossfadeDurationMs }));
    if (this._settings) {
      this._settings.set('crossfade_duration', this._crossfadeDurationMs);
    }
  }

  get crossfadeDurationMs() {
    return this._crossfadeDurationMs;
  }


  play() {
    if (this._renderer && this._renderer.isInitialized) {
      this.emit('audio_control', JSON.stringify({ action: 'resume' }));
      this._renderer.play();
      return;
    }
  }

  pause() {
    if (this._renderer) {
      this.emit('audio_control', JSON.stringify({ action: 'pause' }));
      this._renderer.pause();
      return;
    }
  }

  stop() {
    this._inCrossfade = false;
    this._cancelScheduledPreload();
    if (this._renderer) {
      this._renderer.stop();
      return;
    }
    this._fe_state = 'stopped';
    this._fe_position = 0;
  }

  nextTrack() {
    if (!this._queue.length) return;
    if (this._repeat === 'one') {
      const track = this.currentTrack;
      if (this._webAudioEnabled && track && this._needsFFmpegForTrack(track)) {
        if (this._renderer) {
          this._renderer.stop();
        }
        this.emit('audio_control', JSON.stringify({ action: 'stop' }));
        this._fe_position = 0;
        this._fe_state = 'stopped';
        this._playNative(track);
      } else {
        this._fe_position = 0;
        this.seek(0);
      }
      return;
    }
    let nxt = this._current_index + 1;
    if (nxt >= this._queue.length) {
      if (this._repeat === 'all') {
        nxt = 0;
        if (this._shuffle) {
          this._reshuffleKeepCurrent();
          nxt = 0;
        }
      } else {
        if (this._renderer) {
          this._renderer.stop();
        }
        this._fe_state = 'stopped';
        return;
      }
    }
    this._playAt(nxt);
  }

  prevTrack() {
    if (!this._queue.length) return;
    const curPos = this._fe_position;
    if (curPos > 3000) {
      this._fe_position = 0;
      this.seek(0);
      return;
    }
    if (this._shuffle && this._shuffle_history.length > 1) {
      this._shuffle_history.pop();
      const prevIdx = this._shuffle_history[this._shuffle_history.length - 1];
      this._current_index = prevIdx;
      const track = this._queue[prevIdx];
      this._fe_position = 0;
      this._playNative(track);
      this.emit('track_changed', JSON.stringify(track));
      return;
    }
    let prv = this._current_index - 1;
    if (prv < 0) {
      if (this._repeat === 'all') {
        prv = this._queue.length - 1;
      } else {
        this._fe_position = 0;
        this.seek(0);
        return;
      }
    }
    this._playAt(prv);
  }

  seek(positionMs) {
    if (this._renderer) {
      this._renderer.seek(positionMs);
      this.emit('audio_control', JSON.stringify({
        action: 'seek',
        positionMs: Math.max(0, parseInt(positionMs, 10) || 0),
        durationMs: this._fe_duration || 0,
      }));
      return;
    }
    this._fe_position = Math.max(0, parseInt(positionMs, 10) || 0);
  }

  setVolume(level) {
    level = Math.max(0, Math.min(100, level));
    this._fe_volume = level;
    this.emit('audio_control', JSON.stringify({ action: 'set_volume', level: level / 100 }));
    this.emit('volume_changed', level);
  }


  setTempo(tempo) {
    this._tempo = Math.max(0.25, Math.min(4.0, parseFloat(tempo) || 1.0));
    const stActive = (this._tempo !== 1.0 || this._pitch !== 1.0 || this._rate !== 1.0);
    if (this._automixEnabled) {
      this.emit('audio_control', JSON.stringify({ action: 'set_crossfade', enabled: !stActive }));
    }
  }

  setPitch(pitch) {
    this._pitch = Math.max(0.25, Math.min(4.0, parseFloat(pitch) || 1.0));
    const stActive = (this._tempo !== 1.0 || this._pitch !== 1.0 || this._rate !== 1.0);
    if (this._automixEnabled) {
      this.emit('audio_control', JSON.stringify({ action: 'set_crossfade', enabled: !stActive }));
    }
  }

  setRate(rate) {
    this._rate = Math.max(0.25, Math.min(4.0, parseFloat(rate) || 1.0));
    const stActive = (this._tempo !== 1.0 || this._pitch !== 1.0 || this._rate !== 1.0);
    if (this._automixEnabled) {
      this.emit('audio_control', JSON.stringify({ action: 'set_crossfade', enabled: !stActive }));
    }
    this.emit('audio_control', JSON.stringify({ action: 'set_rate', value: this._rate }));
  }

  get tempo() { return this._renderer ? this._renderer.tempo : 1.0; }
  get pitch() { return this._renderer ? this._renderer.pitch : 1.0; }
  get rate() { return this._rate; }

  get isPlaying() { return this._fe_state === 'playing'; }

  setShuffle(enabled) {
    if (this._shuffle === enabled) return;
    this._shuffle = enabled;
    if (enabled) {
      this._shuffleToCurrent();
    } else {
      this._restoreOriginalOrder();
    }
    this.emit('shuffle_changed', enabled);
    this._emitQueueChanged();
  }

  setRepeat(mode) {
    if (!['off', 'all', 'one'].includes(mode)) return;
    if (this._repeat === mode) return;
    this._repeat = mode;
    this.emit('repeat_changed', mode);

    if (this._inCrossfade) {
      console.log('[player] setRepeat during crossfade, skip next reload');
      return;
    }

    this._cancelScheduledPreload();

    this._emitAudioControl('clear_next');

    if (this._renderer && this._renderer.cancelPreloadNext) {
      try { this._renderer.cancelPreloadNext(); } catch (_) {}
    }

    this._preloadNextTrack().catch(e => {
      console.warn('[player] setRepeat: re-preload failed:', e.message);
    });
  }

  getAudioDevices() {
    if (this._renderer) {
      try {
        const { NativeRenderer } = require('./wasapi');
        const devices = NativeRenderer.enumerateDevices();
        const defaultId = devices.length > 0 ? devices[0].id : '';
        return JSON.stringify({ devices, default_id: defaultId });
      } catch (e) {
        console.error('[player] Failed to enumerate audio devices:', e);
      }
    }
    return JSON.stringify({ devices: [], default_id: '' });
  }

  setOutputDevice(deviceId) {
    this._settings.set('audio_output_device', deviceId || '');
    if (this._renderer && this._renderer.isDummyMode) {
      const { NativeRenderer } = require('./wasapi');
      NativeRenderer.resetNativeInitFailed();
      this._dummyModeNotified = false;
    }
    if (this._renderer && this._renderer.isInitialized) {
      this._reinitRenderer();
    }
  }

  async _reinitRenderer() {
    if (!this._renderer) return;

    const currentTrack = this.currentTrack;
    const savedPosition = this._fe_position;
    const wasPlaying = this._fe_state === 'playing';
    const wasPaused = this._fe_state === 'paused';

    this._stopAudioEngine();

    try {
      const ok = await this._reinitRendererWithMode(this._exclusive);
      if (!ok) return;

      if (currentTrack) {
        const seekOffset = savedPosition > 0 ? savedPosition : 0;
        const filePath = this._resolvePlayablePath(currentTrack);
        this._renderer._currentFilePath = filePath;

        const needsFFmpeg = this._needsFFmpegForTrack(currentTrack);
        let info;
        if (this._webAudioEnabled && !needsFFmpeg) {
          info = await this._renderer.setupForBrowserDecode(filePath);
        } else {
          info = await this._renderer.playFile(filePath);
        }
        this._fe_duration = this._resolveDuration(info.durationMs, currentTrack);
        this.emit('duration_changed', this._fe_duration);

        this._emitAudioControl('play', {
          filePath,
          durationMs: this._fe_duration,
          seekOffsetMs: seekOffset,
          paused: !wasPlaying,
          trackId: currentTrack.id || '',
          title: currentTrack.title || '',
          artist: currentTrack.artist || currentTrack.album_artist || '',
        });
        if (this._webAudioEnabled && needsFFmpeg) {
          if (seekOffset > 0) {
            this._renderer.seek(seekOffset);
          }
          this._emitAudioControl('play_streaming', {
            durationMs: this._fe_duration,
            seekOffsetMs: seekOffset,
            paused: !wasPlaying,
            filePath,
            trackId: currentTrack.id || '',
            title: currentTrack.title || '',
            artist: currentTrack.artist || currentTrack.album_artist || '',
          });
        }

        if (wasPlaying) {
          await this._renderer.play();
        } else if (wasPaused) {
          this._fe_state = 'paused';
        }
      }
    } catch (e) {
      console.error('[player] Renderer reinit failed:', e);
    }
  }

  async setExclusiveMode(enabled) {
    if (!IS_WIN && enabled) {
      console.warn('[player] Exclusive mode is not supported on this platform');
      return false;
    }
    if (!this._renderer && enabled) {
      console.warn('[player] Native renderer not available');
      return false;
    }
    if (this._exclusive === enabled) return true;

    const currentTrack = this.currentTrack;
    const savedPosition = this._fe_position;
    const wasPlaying = this._fe_state === 'playing';
    const wasPaused = this._fe_state === 'paused';

    this._stopAudioEngine();

    if (this._renderer) {
      try { this._renderer.stop(); } catch {  }
    }
    this._fe_state = 'stopped';
    this._fe_position = 0;

    const prevExclusive = this._exclusive;
    this._exclusive = enabled;
    if (this._settings) {
      this._settings.set('wasapi_exclusive', enabled);
    }

    try {
      const ok = await this._reinitRendererWithMode(enabled);
      if (!ok) {
        this._exclusive = prevExclusive;
        if (this._settings) { this._settings.set('wasapi_exclusive', prevExclusive); }
        return false;
      }
    } catch (e) {
      console.error('[player] Failed to initialize renderer:', e);
      this._exclusive = prevExclusive;
      if (this._settings) { this._settings.set('wasapi_exclusive', prevExclusive); }
      return false;
    }

    if (currentTrack) {
      try {
        const seekOffset = savedPosition > 0 ? savedPosition : 0;
        const filePath = this._resolvePlayablePath(currentTrack);
        this._renderer._currentFilePath = filePath;

        const needsFFmpeg = this._needsFFmpegForTrack(currentTrack);
        let info;
        if (this._webAudioEnabled && !needsFFmpeg) {
          info = await this._renderer.setupForBrowserDecode(filePath);
        } else {
          info = await this._renderer.playFile(filePath);
        }
        this._fe_duration = this._resolveDuration(info.durationMs, currentTrack);
        this.emit('duration_changed', this._fe_duration);

        this._emitAudioControl('play', {
          filePath,
          durationMs: this._fe_duration,
          seekOffsetMs: seekOffset,
          paused: !wasPlaying,
          trackId: currentTrack.id || '',
          title: currentTrack.title || '',
          artist: currentTrack.artist || currentTrack.album_artist || '',
        });
        if (this._webAudioEnabled && needsFFmpeg) {
          if (seekOffset > 0) {
            this._renderer.seek(seekOffset);
          }
          this._emitAudioControl('play_streaming', {
            durationMs: this._fe_duration,
            seekOffsetMs: seekOffset,
            paused: !wasPlaying,
            filePath,
            trackId: currentTrack.id || '',
            title: currentTrack.title || '',
            artist: currentTrack.artist || currentTrack.album_artist || '',
          });
        }

        if (wasPlaying) {
          await this._renderer.play();
        } else if (wasPaused) {
          this._fe_state = 'paused';
        }
      } catch (e) {
        console.error('[player] Failed to reload track:', e);
        return false;
      }
    }

    return true;
  }


  reloadLikedTracks() {
    if (this._library) {
      try {
        this._liked_tracks = this._library.getLikedTrackIds();
      } catch {
      }
    }
  }

  toggleLiked() {
    if (!this.currentTrack) return;
    if (this.currentTrack.external) return;
    const trackId = this.currentTrack.id || '';
    if (!trackId) return;
    const newState = !this._liked_tracks.has(trackId);
    this._setLiked(trackId, newState);
    this.emit('liked_changed', newState);
  }

  toggleLikedTrack(trackId) {
    if (!trackId) return false;
    const newState = !this._liked_tracks.has(trackId);
    this._setLiked(trackId, newState);
    if (this.currentTrack && this.currentTrack.id === trackId) {
      this.emit('liked_changed', newState);
    }
    return newState;
  }

  _setLiked(trackId, liked) {
    if (liked) this._liked_tracks.add(trackId);
    else this._liked_tracks.delete(trackId);
    if (this._library) {
      try { this._library.setLiked(trackId, liked); } catch {  }
    }
  }

  isTrackLiked(trackId) {
    return this._liked_tracks.has(trackId);
  }

  get isCurrentLiked() {
    if (!this.currentTrack) return false;
    const trackId = this.currentTrack.id || '';
    return this._liked_tracks.has(trackId);
  }


  peekNextTrack() {
    if (!this._queue.length) return null;
    if (this._repeat === 'one') return this.currentTrack;
    const nxt = this._current_index + 1;
    if (nxt >= this._queue.length) {
      if (this._repeat === 'all') return this._queue[0] || null;
      return null;
    }
    return this._queue[nxt];
  }

  advanceToNext() {
    if (!this._queue.length) return '{}';
    if (this._repeat === 'one') {
      const track = this.currentTrack;
      if (!track) return '{}';
      this._fe_position = 0;
      this.emit('track_changed', JSON.stringify(track));
      this.emit('liked_changed', this.isCurrentLiked);
      return JSON.stringify(track);
    }
    let nxt = this._current_index + 1;
    if (nxt >= this._queue.length) {
      if (this._repeat === 'all') {
        nxt = 0;
        if (this._shuffle) {
          this._reshuffleKeepCurrent();
          nxt = 0;
        }
      } else {
        return '{}';
      }
    }
    this._current_index = nxt;
    if (this._shuffle) {
      if (!this._shuffle_history.length || this._shuffle_history[this._shuffle_history.length - 1] !== nxt) {
        this._shuffle_history.push(nxt);
      }
    }
    const track = this._queue[nxt];
    this._fe_position = 0;
    this.emit('track_changed', JSON.stringify(track));
    this.emit('liked_changed', this.isCurrentLiked);
    this._emitQueueChanged();
    return JSON.stringify(track);
  }

  updateTrackLyrics(trackId, lyrics) {
    for (const track of this._queue) {
      if (track.id === trackId) track.lyrics = lyrics;
    }
    for (const track of this._original_queue) {
      if (track.id === trackId) track.lyrics = lyrics;
    }
    const current = this.currentTrack;
    if (current && current.id === trackId) {
      this.emit('lyrics_changed', JSON.stringify({ trackId, lyrics }));
      return current;
    }
    return null;
  }


  _shuffleArray(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
  }

  _shuffleToCurrent() {
    if (!this._original_queue.length || this._current_index < 0) return;
    const currentTrack = this._queue[this._current_index];
    const remaining = this._original_queue.filter((t) => t.id !== currentTrack.id);
    this._shuffleArray(remaining);
    this._queue = [currentTrack, ...remaining];
    this._current_index = 0;
    this._shuffle_history = [0];
  }

  _restoreOriginalOrder() {
    if (!this._original_queue.length || this._current_index < 0) return;
    const currentTrack = this._queue[this._current_index];
    this._queue = [...this._original_queue];
    for (let i = 0; i < this._queue.length; i++) {
      if (this._queue[i].id === currentTrack.id) {
        this._current_index = i;
        break;
      }
    }
    this._shuffle_history = [];
  }

  _reshuffleKeepCurrent() {
    if (this._queue.length <= 1) return;
    const currentTrack = this._queue[this._current_index];
    const remaining = this._queue.filter((t) => t.id !== currentTrack.id);
    this._shuffleArray(remaining);
    this._queue = [currentTrack, ...remaining];
    this._current_index = 0;
    this._shuffle_history = [0];
  }


  get currentTrack() {
    if (this._current_index >= 0 && this._current_index < this._queue.length) {
      return this._queue[this._current_index];
    }
    return null;
  }

  get position() { return this._fe_position; }
  get duration() { return this._fe_duration; }
  get volume() { return this._fe_volume; }
  get state() { return this._fe_state; }
  get shuffle() { return this._shuffle; }
  get repeat() { return this._repeat; }
  get isExclusive() { return this._exclusive; }
  get frontendPlayback() { return false; }


  getPersistentState() {
    const track = this.currentTrack;
    if (!track) return {};
    return {
      track_id: track.id || '',
      position_ms: Math.max(0, this._fe_position - 1000),
      was_playing: this.state === 'playing',
    };
  }

  restoreState(track, positionMs, autoPlay = false) {
    if (!track) return;
    this._queue = [track];
    this._original_queue = [track];
    this._current_index = 0;
    this._shuffle_history = [];

    this._fe_position = Math.max(0, parseInt(positionMs, 10) || 0);
    this._fe_state = autoPlay ? 'playing' : 'paused';

    this._playNative(track).then(() => {
      if (this._renderer && this._renderer.isInitialized) {
        if (this._fe_position > 0) {
          this._renderer.seek(this._fe_position);
          this.emit('audio_control', JSON.stringify({
            action: 'seek',
            positionMs: this._fe_position,
            durationMs: this._fe_duration || 0,
          }));
        }
        if (!autoPlay) {
          this._renderer.pause();
        }
      }
    });

    this.emit('track_changed', JSON.stringify(track));
    this.emit('liked_changed', this.isCurrentLiked);
    this._emitQueueChanged();
  }

  close() {
    if (this._renderer) {
      try { this._renderer.close(); } catch {  }
    }
  }
}

module.exports = { MusicPlayer };
