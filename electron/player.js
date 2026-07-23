/**
 * Carminium — 音乐播放器
 * 管理播放队列、随机和循环模式。
 *
 * 通常モード: 前端 Web Audio API が音声レンダリングを担当。
 * 排他モード: WASAPI COM 直接呼び出しで排他モード再生（ffmpeg デコード）。
 * 本モジュールはキュー管理と状態調整を担当し、EventEmitter 経由で信号を転送する。
 */
'use strict';

const { EventEmitter } = require('events');
const crypto = require('crypto');

class MusicPlayer extends EventEmitter {
  constructor(settings = null, library = null, wasapi = null) {
    super();

    this._settings = settings;
    this._library = library;

    // WASAPI 排他モードレンダラー（null の場合は排他モード無効）
    this._bass = wasapi;

    // 前端播放模式（Electron 版本始终为前端播放）
    this._frontend_playback = true;
    this._fe_state = 'stopped';
    this._fe_position = 0;
    this._fe_duration = 0;
    this._fe_volume = 80;

    // 排他モードフラグ
    this._exclusive = false;

    this._original_queue = [];
    this._queue = [];
    this._current_index = -1;
    this._shuffle = false;
    this._repeat = 'off'; // "off" | "all" | "one"
    this._shuffle_history = [];
    this._liked_tracks = new Set();
    this._media_base_url = '';

    // 从库中加载已持久化的喜爱曲目
    if (library) {
      try {
        this._liked_tracks = library.getLikedTrackIds();
      } catch {
        // ignore
      }
    }

    // AutoMix 接管状态
    this._automix_active = false;

    // WASAPI 排他モードのイベントハンドリング
    if (this._bass) {
      this._bass.onPositionTick = (pos) => {
        this._fe_position = pos;
        this.emit('position_changed', pos);
      };
      this._bass.onEnded = () => {
        if (this._automix_active) {
          this.emit('automix_takeover');
          return;
        }
        this.nextTrack();
      };
      this._bass.on('state_changed', (state) => {
        this._fe_state = state;
        this.emit('state_changed', state);
      });
    }
  }

  // ── 前端播放模式辅助 ──────────────────────────────────────────────────────

  _emitPlayCommand(action, track = null, positionMs = null, autoPlay = false) {
    const cmd = { action };
    if (track !== null) cmd.track = track;
    if (positionMs !== null) cmd.position_ms = positionMs;
    if (autoPlay) cmd.auto_play = true;
    this.emit('play_command', JSON.stringify(cmd));
  }

  /** 独占モード回退時に設定を同期し、フロントエンド UI を更新 */
  _fallbackToShared() {
    this._exclusive = false;
    this._frontend_playback = true;
    if (this._settings) {
      this._settings.set('wasapi_exclusive', false);
    }
    // settings_changed を発行してフロントエンド UI を同期
    this.emit('settings_changed', JSON.stringify(this._settings.all()));
  }

  reportPlaybackState(state, positionMs) {
    this._fe_state = state;
    this._fe_position = Math.max(0, parseInt(positionMs, 10) || 0);
    this.emit('state_changed', state);
    this.emit('position_changed', this._fe_position);
  }

  reportDuration(durationMs) {
    this._fe_duration = Math.max(0, parseInt(durationMs, 10) || 0);
    this.emit('duration_changed', this._fe_duration);
  }

  reportEnded() {
    if (this._automix_active) {
      this.emit('automix_takeover');
      return;
    }
    this.nextTrack();
  }

  reportVolume(volume) {
    this._fe_volume = Math.max(0, Math.min(100, parseInt(volume, 10) || 0));
  }

  reportPosition(positionMs) {
    this._fe_position = Math.max(0, parseInt(positionMs, 10) || 0);
    this.emit('position_changed', this._fe_position);
  }

  // ── Queue management ──────────────────────────────────────────────────────

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
  }

  appendQueue(track) {
    if (!this._queue.length) {
      this.playTracks([track]);
      return;
    }
    this._queue.push(track);
    this._original_queue.push(track);
    this._emitQueueChanged();
  }

  removeFromQueue(index) {
    if (index < 0 || index >= this._queue.length) return;
    if (index === this._current_index) return;
    const removed = this._queue.splice(index, 1)[0];
    if (index < this._current_index) this._current_index--;

    try {
      const origIdx = this._original_queue.findIndex((t) => t.id === removed.id);
      if (origIdx >= 0) this._original_queue.splice(origIdx, 1);
    } catch {
      // ignore
    }

    // Update shuffle history
    this._shuffle_history = this._shuffle_history
      .filter((h) => h !== index)
      .map((h) => (h > index ? h - 1 : h));

    this._emitQueueChanged();
  }

  getQueue() {
    return [...this._queue];
  }

  get current_index() {
    return this._current_index;
  }

  _emitQueueChanged() {
    const data = {
      queue: this._queue,
      current_index: this._current_index,
    };
    this.emit('queue_changed', JSON.stringify(data));
  }

  setMediaBaseUrl(url) {
    this._media_base_url = url || '';
  }

  _resolvePlayablePath(track) {
    if (track.source !== 'subsonic') return track.path || '';
    const p = track.path || '';
    if (!p.startsWith('subsonic://')) return p;
    const parts = p.slice('subsonic://'.length).split('/', 1);
    if (parts.length !== 2) return p;
    const [serverId, subsonicId] = parts;
    if (!this._media_base_url) return p;
    return `${this._media_base_url}/subsonic/stream/${serverId}/${subsonicId}`;
  }

  _playAt(index) {
    if (index < 0 || index >= this._queue.length) return;
    this._current_index = index;
    if (this._shuffle) {
      if (!this._shuffle_history.length || this._shuffle_history[this._shuffle_history.length - 1] !== index) {
        this._shuffle_history.push(index);
      }
    }
    const track = this._queue[index];
    this._fe_position = 0;
    this._fe_state = 'stopped';

    // 排他モード時は WASAPI で直接レンダリング
    if (this._exclusive && this._bass) {
      this._playExclusive(track);
      return;
    }

    this._emitPlayCommand('load', track, null, true);
    this.emit('track_changed', JSON.stringify(track));
    this.emit('liked_changed', this.isCurrentLiked);
    this._emitQueueChanged();
  }

  /**
   * WASAPI 排他モードでトラックを再生する
   */
  async _playExclusive(track) {
    if (!this._bass || !track) return;
    // 同時実行を防止
    if (this._exclusivePending) {
      console.warn('[player] WASAPI exclusive playback already in progress, queuing');
      this._exclusivePendingTrack = track;
      return;
    }
    this._exclusivePending = true;
    try {
      const filePath = track.path;
      if (!filePath || track.source === 'subsonic') {
        // ローカルファイル以外はフロントエンド再生にフォールバック
        this._fallbackToShared();
        this._emitPlayCommand('load', track, null, true);
        this.emit('track_changed', JSON.stringify(track));
        this.emit('liked_changed', this.isCurrentLiked);
        this._emitQueueChanged();
        return;
      }

      // 排他モードを初期化（初回のみ）
      if (!this._bass._initialized) {
        await this._bass.init(0, 0, 0);
      }
      // ファイルパスを保存（seek 時に使用）
      this._bass._currentFilePath = filePath;

      // トラック変更通知
      this.emit('state_changed', 'loading');
      this.emit('track_changed', JSON.stringify(track));
      this.emit('liked_changed', this.isCurrentLiked);
      this._emitQueueChanged();

      // WASAPI でファイルをデコード＆再生
      const info = await this._bass.playFile(filePath);
      this._fe_duration = info.durationMs;
      this.emit('duration_changed', this._fe_duration);

      // 再生開始
      await this._bass.play();
      // 音量を同期
      this._bass.setVolume(this._fe_volume / 100);
    } catch (e) {
      console.error('[player] WASAPI exclusive playback failed:', e);
      // フォールバック: フロントエンド再生
      this._fallbackToShared();
      this._emitPlayCommand('load', track, null, true);
      this.emit('track_changed', JSON.stringify(track));
      this.emit('liked_changed', this.isCurrentLiked);
      this._emitQueueChanged();
    } finally {
      this._exclusivePending = false;
      // キューされたトラックがあれば再生
      if (this._exclusivePendingTrack) {
        const pendingTrack = this._exclusivePendingTrack;
        this._exclusivePendingTrack = null;
        this._playExclusive(pendingTrack);
      }
    }
  }

  // ── Playback control ──────────────────────────────────────────────────────

  play() {
    if (this._exclusive && this._bass) {
      this._bass.play();
      return;
    }
    this._emitPlayCommand('play');
  }

  pause() {
    if (this._exclusive && this._bass) {
      this._bass.pause();
      return;
    }
    this._emitPlayCommand('pause');
  }

  stop() {
    if (this._exclusive && this._bass) {
      this._bass.stop();
      return;
    }
    this._emitPlayCommand('stop');
    this._fe_state = 'stopped';
    this._fe_position = 0;
  }

  nextTrack() {
    if (!this._queue.length) return;
    if (this._repeat === 'one') {
      if (this._exclusive && this._bass) {
        this._bass.seek(0);
        this._bass.play();
      } else {
        this._emitPlayCommand('seek', null, 0);
        this._emitPlayCommand('play');
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
        if (this._exclusive && this._bass) {
          this._bass.stop();
        } else {
          this._emitPlayCommand('stop');
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
      if (this._exclusive && this._bass) {
        this._bass.seek(0);
      } else {
        this._emitPlayCommand('seek', null, 0);
      }
      return;
    }
    if (this._shuffle && this._shuffle_history.length > 1) {
      this._shuffle_history.pop();
      const prevIdx = this._shuffle_history[this._shuffle_history.length - 1];
      this._current_index = prevIdx;
      const track = this._queue[prevIdx];
      this._fe_position = 0;
      if (this._exclusive && this._bass) {
        this._playExclusive(track);
      } else {
        this._emitPlayCommand('load', track, null, true);
      }
      this.emit('track_changed', JSON.stringify(track));
      return;
    }
    let prv = this._current_index - 1;
    if (prv < 0) {
      if (this._repeat === 'all') {
        prv = this._queue.length - 1;
      } else {
        if (this._exclusive && this._bass) {
          this._bass.seek(0);
        } else {
          this._emitPlayCommand('seek', null, 0);
        }
        return;
      }
    }
    this._playAt(prv);
  }

  seek(positionMs) {
    if (this._exclusive && this._bass) {
      this._bass.seek(positionMs);
      return;
    }
    this._fe_position = Math.max(0, parseInt(positionMs, 10) || 0);
    this._emitPlayCommand('seek', null, parseInt(positionMs, 10));
  }

  setVolume(level) {
    level = Math.max(0, Math.min(100, level));
    this._fe_volume = level;
    if (this._exclusive && this._bass) {
      this._bass.setVolume(level / 100);
    }
    this.emit('volume_changed', level);
  }

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
  }

  getAudioDevices() {
    if (this._bass) {
      try {
        const { WasapiRenderer } = require('./wasapi');
        const devices = WasapiRenderer.enumerateDevices();
        const defaultId = devices.length > 0 ? devices[0].id : '';
        return JSON.stringify({ devices, default_id: defaultId });
      } catch (e) {
        console.error('[player] Failed to enumerate WASAPI devices:', e);
      }
    }
    return JSON.stringify({ devices: [], default_id: '' });
  }

  setOutputDevice(deviceId) {
    // 排他モードではデバイス切り替えは再初期化が必要
    this._settings.set('audio_output_device', deviceId || '');
  }

  /**
   * WASAPI 排他モードを有効/無効にする
   * 切換後、現在のトラックを新しいモードで再読み込みする。
   */
  async setExclusiveMode(enabled) {
    if (!this._bass && enabled) {
      console.warn('[player] WASAPI renderer not available');
      return false;
    }
    if (this._exclusive === enabled) return true;

    // 現在のトラックと位置を保存
    const currentTrack = this.currentTrack;
    const savedPosition = this._fe_position;
    const wasPlaying = this._fe_state === 'playing' || this._fe_state === 'paused';

    // 現在のモードで再生を停止
    if (this._exclusive && this._bass) {
      // 独占→共有：WASAPI を停止
      this._bass.stop();
    } else {
      // 共有→独占：フロントエンドを停止
      this._emitPlayCommand('stop');
    }
    this._fe_state = 'stopped';
    this._fe_position = 0;

    this._exclusive = enabled;
    this._frontend_playback = !enabled;

    if (this._settings) {
      this._settings.set('wasapi_exclusive', enabled);
    }

    if (enabled) {
      // 独占モードへ切換：WASAPI 初期化
      try {
        if (!this._bass._initialized) {
          await this._bass.init(0, 0, 0);
        }
        // 音量を同期
        this._bass.setVolume(this._fe_volume / 100);
      } catch (e) {
        console.error('[player] Failed to initialize WASAPI exclusive mode:', e);
        this._exclusive = false;
        this._frontend_playback = true;
        return false;
      }
    }

    // 現在のトラックを新しいモードで再読み込み
    if (currentTrack) {
      if (enabled) {
        // 独占モードでトラックをロード
        try {
          await this._playExclusive(currentTrack);
          // 位置を復元
          if (savedPosition > 0) {
            this._bass.seek(savedPosition);
          }
          if (!wasPlaying) {
            this._bass.pause();
          }
        } catch (e) {
          console.error('[player] Failed to reload track in exclusive mode:', e);
        }
      } else {
        // 共有モードでトラックをロード
        this._emitPlayCommand('load', currentTrack, savedPosition, wasPlaying);
        this.emit('track_changed', JSON.stringify(currentTrack));
        this.emit('liked_changed', this.isCurrentLiked);
        this._emitQueueChanged();
      }
    }

    return true;
  }

  // ── Liked ─────────────────────────────────────────────────────────────────

  /**
   * 从数据库重新加载喜爱曲目集合（删除源后清理内存状态）
   */
  reloadLikedTracks() {
    if (this._library) {
      try {
        this._liked_tracks = this._library.getLikedTrackIds();
      } catch {
        // ignore
      }
    }
  }

  toggleLiked() {
    if (!this.currentTrack) return;
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
      try { this._library.setLiked(trackId, liked); } catch { /* ignore */ }
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

  // ── AutoMix 接管接口 ──────────────────────────────────────────────────────

  setAutomixActive(active) {
    this._automix_active = active;
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
      this.emit('lyrics_changed', trackId);
      return current;
    }
    return null;
  }

  // ── Shuffle helpers ───────────────────────────────────────────────────────

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

  // ── State accessors ───────────────────────────────────────────────────────

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
  get frontendPlayback() { return this._frontend_playback; }

  // ── State persistence ─────────────────────────────────────────────────────

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
    this._emitPlayCommand('load', track, Math.max(0, parseInt(positionMs, 10) || 0), autoPlay);
    this.emit('track_changed', JSON.stringify(track));
    this.emit('liked_changed', this.isCurrentLiked);
    this._emitQueueChanged();
  }

  close() {
    if (this._bass) {
      try { this._bass.close(); } catch { /* ignore */ }
    }
  }
}

module.exports = { MusicPlayer };
