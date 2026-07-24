/**
 * Carminium — 音乐播放器
 * 管理播放队列、随机和循环模式。
 *
 * 常にネイティブレンダラー (Zig + miniaudio + SoundTouch) で音声を再生。
 * 共有モード / 排他モードは設定で切り替え。デコードは ffmpeg が担当。
 * 本モジュールはキュー管理と状態調整を担当し、EventEmitter 経由で信号を転送する。
 */
'use strict';

const { EventEmitter } = require('events');
const { SHARE_SHARED, SHARE_EXCLUSIVE } = require('./wasapi');

class MusicPlayer extends EventEmitter {
  constructor(settings = null, library = null, renderer = null) {
    super();

    this._settings = settings;
    this._library = library;

    // ネイティブオーディオレンダラー（null の場合は再生不可）
    this._renderer = renderer;

    this._fe_state = 'stopped';
    this._fe_position = 0;
    this._fe_duration = 0;
    this._fe_volume = 80;

    // 排他モードフラグ（設定から復元）
    this._exclusive = settings ? !!settings.get('wasapi_exclusive', false) : false;

    // _playNative の同時実行抑制用トークン（monotonic）
    this._nativePlayToken = 0;

    // SoundTouch パラメータ（レンダラーと同期）
    this._tempo = 1.0;
    this._pitch = 1.0;
    this._rate = 1.0;

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

    // AutoMix
    this._automix_active = false;
    this._automixEnabled = settings ? !!settings.get('automix', false) : false;
    this._crossfadeDurationMs = settings ? parseInt(settings.get('crossfade_duration', 4000), 10) || 4000 : 4000;

    // Gapless
    this._gaplessEnabled = settings ? !!settings.get('gapless', false) : false;

    // ネイティブレンダラーのイベントハンドリング
    if (this._renderer) {
      // Gapless と AutoMix は相互排他: 両方有効なら AutoMix 優先
      if (this._automixEnabled && this._gaplessEnabled) {
        this._gaplessEnabled = false;
        if (settings) settings.set('gapless', false);
      }
      this._renderer.setCrossfadeEnabled(this._automixEnabled);
      this._renderer.setCrossfadeDuration(this._crossfadeDurationMs);
      this._renderer.setGaplessEnabled(this._gaplessEnabled);

      this._renderer.onPositionTick = (pos) => {
        this._fe_position = pos;
        this.emit('position_changed', pos);
      };
      this._renderer.onEnded = () => {
        if (this._automix_active) {
          this.emit('automix_takeover');
          return;
        }
        this.nextTrack();
      };
      this._renderer.onCrossfadeComplete = () => {
        this._onCrossfadeComplete();
      };
      this._renderer.on('state_changed', (state) => {
        this._fe_state = state;
        this.emit('state_changed', state);
      });
      this._renderer.on('position_changed', (pos) => {
        this._fe_position = pos;
        this.emit('position_changed', pos);
      });
    }
  }

  // ── 内部ヘルパー ──────────────────────────────────────────────────────────

  /** 設定から現在の出力デバイスインデックスを取得 */
  _getDeviceIndex() {
    const devId = this._settings ? this._settings.get('audio_output_device', '') : '';
    const idx = parseInt(devId, 10);
    return isNaN(idx) ? -1 : idx;
  }

  /** 排他モード回退時に設定を同期し、UI を更新 */
  _fallbackToShared() {
    this._exclusive = false;
    if (this._settings) {
      this._settings.set('wasapi_exclusive', false);
    }
    this.emit('settings_changed', JSON.stringify(this._settings.all()));
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

    this._playNative(track);
  }

  /**
   * ネイティブレンダラーでトラックを再生する
   *
   * 同時実行の抑制には monotonic なトークンを使う。古い呼び出しは await 後に
   * トークンが無効化されていれば早期リターンし、新しい呼び出しが支配する。
   * これにより「2曲が交互に再生される」競合を防ぐ。
   */
  async _playNative(track) {
    if (!this._renderer || !track) return;
    const myToken = ++this._nativePlayToken;

    const filePath = this._resolvePlayablePath(track);
    if (!filePath) {
      console.error('[player] No playable path for track:', track.id);
      return;
    }

    // 前の再生を確実に停止（音声スレッド + ffmpeg + バッファ）
    try {
      if (this._renderer.isInitialized) {
        this._renderer.stop();
      }
    } catch { /* ignore */ }

    try {
      // レンダラー未初期化なら初期化
      if (!this._renderer.isInitialized) {
        const shareMode = this._exclusive ? SHARE_EXCLUSIVE : SHARE_SHARED;
        await this._renderer.init({
          shareMode,
          deviceIndex: this._getDeviceIndex(),
        });
        if (myToken !== this._nativePlayToken) return; // より新しい呼び出しが勝った
      }
      this._renderer._currentFilePath = filePath;

      // トラック変更通知
      this.emit('state_changed', 'loading');
      this.emit('track_changed', JSON.stringify(track));
      this.emit('liked_changed', this.isCurrentLiked);
      this._emitQueueChanged();

      // ネイティブレンダラーでファイルをデコード＆再生
      const info = await this._renderer.playFile(filePath);
      if (myToken !== this._nativePlayToken) return; // より新しい呼び出しが勝った

      this._fe_duration = info.durationMs;
      this.emit('duration_changed', this._fe_duration);

      // 再生開始
      await this._renderer.play();
      if (myToken !== this._nativePlayToken) return; // より新しい呼び出しが勝った
      // 音量を同期
      this._renderer.setVolume(this._fe_volume / 100);

      // AutoMix / Gapless: 有効なら次曲をプリロード
      if (this._automixEnabled || this._gaplessEnabled) {
        this._preloadNextTrack();
      }
    } catch (e) {
      if (myToken !== this._nativePlayToken) return; // もう無効
      console.error('[player] Native playback failed:', e);
      // 排他モードの場合は共有モードにフォールバックして再試行
      if (this._exclusive) {
        console.warn('[player] Falling back to shared mode');
        this._fallbackToShared();
        try {
          await this._renderer.close();
          if (myToken !== this._nativePlayToken) return;
          await this._renderer.init({
            shareMode: SHARE_SHARED,
            deviceIndex: this._getDeviceIndex(),
          });
          if (myToken !== this._nativePlayToken) return;
          this._renderer._currentFilePath = this._resolvePlayablePath(track);
          const info = await this._renderer.playFile(this._renderer._currentFilePath);
          if (myToken !== this._nativePlayToken) return;
          this._fe_duration = info.durationMs;
          this.emit('duration_changed', this._fe_duration);
          await this._renderer.play();
          if (myToken !== this._nativePlayToken) return;
          this._renderer.setVolume(this._fe_volume / 100);

          // AutoMix / Gapless: 有効なら次曲をプリロード
          if (this._automixEnabled || this._gaplessEnabled) {
            this._preloadNextTrack();
          }
        } catch (e2) {
          if (myToken !== this._nativePlayToken) return;
          console.error('[player] Shared mode also failed:', e2);
        }
      }
    }
  }

  // ── AutoMix ───────────────────────────────────────────────────────────────

  /** 次のトラックを取得（キューから、シャッフル/リピートを考慮） */
  _getNextTrackForPreload() {
    if (!this._queue.length || this._current_index < 0) return null;

    // リピート1曲の場合、同じ曲
    if (this._repeat === 'one') {
      return this._queue[this._current_index];
    }

    // 次のインデックスを計算
    const nextIdx = this._current_index + 1;
    if (nextIdx < this._queue.length) {
      return this._queue[nextIdx];
    }

    // リピート all なら最初に戻る
    if (this._repeat === 'all' && this._queue.length > 1) {
      return this._queue[0];
    }

    return null;
  }

  /** 次曲をプリロードする（非同期、エラーは無視） */
  async _preloadNextTrack() {
    if (!this._renderer) return;
    if (!this._automixEnabled && !this._gaplessEnabled) return;
    if (!this._renderer.isInitialized) return;
    if (this._renderer._nextFilePath) return;

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

    const mode = this._gaplessEnabled ? 'Gapless' : 'AutoMix';
    console.log(`[player] ${mode}: preloading next track:`, nextTrack.title || nextTrack.id);
    try {
      await this._renderer.preloadNext(filePath);
      console.log(`[player] ${mode}: preload complete`);
    } catch (e) {
      console.warn('[player] preloadNext failed:', e.message);
    }
  }

  /** クロスフェード完了時の処理 */
  _onCrossfadeComplete() {
    // 次のトラックに移動
    if (this._repeat !== 'one') {
      this._current_index += 1;
      if (this._current_index >= this._queue.length) {
        if (this._repeat === 'all') {
          this._current_index = 0;
        } else {
          // キューの終端に達した
          this._fe_state = 'stopped';
          this.emit('state_changed', 'stopped');
          return;
        }
      }
    }

    // 現在のトラックを更新して通知
    const track = this._queue[this._current_index];
    if (!track) return;

    this._fe_position = 0;
    this._fe_duration = this._renderer._durationMs;
    this.emit('track_changed', JSON.stringify(track));
    this.emit('liked_changed', this.isCurrentLiked);
    this.emit('duration_changed', this._fe_duration);
    this._emitQueueChanged();

    // シャッフル履歴に追加
    if (this._shuffle && this._current_index >= 0) {
      if (!this._shuffle_history.length ||
          this._shuffle_history[this._shuffle_history.length - 1] !== this._current_index) {
        this._shuffle_history.push(this._current_index);
      }
    }

    // さらに次の曲をプリロード
    if (this._automixEnabled || this._gaplessEnabled) {
      this._preloadNextTrack();
    }
  }

  setAutomixEnabled(enabled) {
    this._automixEnabled = !!enabled;
    // AutoMix と Gapless は相互排他
    if (this._automixEnabled && this._gaplessEnabled) {
      this._gaplessEnabled = false;
      if (this._settings) this._settings.set('gapless', false);
      if (this._renderer) this._renderer.setGaplessEnabled(false);
    }
    if (this._renderer) {
      this._renderer.setCrossfadeEnabled(this._automixEnabled);
    }
    if (this._settings) {
      this._settings.set('automix', this._automixEnabled);
    }
    // 有効にした直後ならプリロードを試みる
    if (this._automixEnabled && this._fe_state === 'playing') {
      this._preloadNextTrack();
    }
  }

  get automixEnabled() {
    return this._automixEnabled;
  }

  setCrossfadeDuration(ms) {
    this._crossfadeDurationMs = Math.max(500, Math.min(15000, parseInt(ms, 10) || 4000));
    if (this._renderer) {
      this._renderer.setCrossfadeDuration(this._crossfadeDurationMs);
    }
    if (this._settings) {
      this._settings.set('crossfade_duration', this._crossfadeDurationMs);
    }
  }

  get crossfadeDurationMs() {
    return this._crossfadeDurationMs;
  }

  // ── Gapless ───────────────────────────────────────────────────────────────

  setGaplessEnabled(enabled) {
    this._gaplessEnabled = !!enabled;
    // Gapless と AutoMix は相互排他
    if (this._gaplessEnabled && this._automixEnabled) {
      this._automixEnabled = false;
      if (this._settings) this._settings.set('automix', false);
      if (this._renderer) this._renderer.setCrossfadeEnabled(false);
    }
    if (this._renderer) {
      this._renderer.setGaplessEnabled(this._gaplessEnabled);
    }
    if (this._settings) {
      this._settings.set('gapless', this._gaplessEnabled);
    }
    // 有効にした直後ならプリロードを試みる
    if (this._gaplessEnabled && this._fe_state === 'playing') {
      this._preloadNextTrack();
    }
  }

  get gaplessEnabled() {
    return this._gaplessEnabled;
  }

  // ── Playback control ──────────────────────────────────────────────────────

  play() {
    if (this._renderer) {
      this._renderer.play();
      return;
    }
  }

  pause() {
    if (this._renderer) {
      this._renderer.pause();
      return;
    }
  }

  stop() {
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
      if (this._renderer) {
        this._renderer.seek(0);
        this._renderer.play();
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
      if (this._renderer) {
        this._renderer.seek(0);
      }
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
        if (this._renderer) {
          this._renderer.seek(0);
        }
        return;
      }
    }
    this._playAt(prv);
  }

  seek(positionMs) {
    if (this._renderer) {
      this._renderer.seek(positionMs);
      return;
    }
    this._fe_position = Math.max(0, parseInt(positionMs, 10) || 0);
  }

  setVolume(level) {
    level = Math.max(0, Math.min(100, level));
    this._fe_volume = level;
    if (this._renderer) {
      this._renderer.setVolume(level / 100);
    }
    this.emit('volume_changed', level);
  }

  // ── SoundTouch パラメータ ──────────────────────────────────────────────────

  setTempo(tempo) {
    this._tempo = Math.max(0.25, Math.min(4.0, parseFloat(tempo) || 1.0));
    if (this._renderer) {
      this._renderer.setTempo(this._tempo);
    }
    // tempo/pitch/rate がすべて 1.0 でなければ AutoMix / Gapless 非対応
    const stActive = (this._tempo !== 1.0 || this._pitch !== 1.0 || this._rate !== 1.0);
    if (this._automixEnabled) {
      if (this._renderer) this._renderer.setCrossfadeEnabled(!stActive);
    }
    if (this._gaplessEnabled) {
      if (this._renderer) this._renderer.setGaplessEnabled(!stActive);
    }
  }

  setPitch(pitch) {
    this._pitch = Math.max(0.25, Math.min(4.0, parseFloat(pitch) || 1.0));
    if (this._renderer) {
      this._renderer.setPitch(this._pitch);
    }
    const stActive = (this._tempo !== 1.0 || this._pitch !== 1.0 || this._rate !== 1.0);
    if (this._automixEnabled) {
      if (this._renderer) this._renderer.setCrossfadeEnabled(!stActive);
    }
    if (this._gaplessEnabled) {
      if (this._renderer) this._renderer.setGaplessEnabled(!stActive);
    }
  }

  setRate(rate) {
    this._rate = Math.max(0.25, Math.min(4.0, parseFloat(rate) || 1.0));
    if (this._renderer) {
      this._renderer.setRate(this._rate);
    }
    const stActive = (this._tempo !== 1.0 || this._pitch !== 1.0 || this._rate !== 1.0);
    if (this._automixEnabled) {
      if (this._renderer) this._renderer.setCrossfadeEnabled(!stActive);
    }
    if (this._gaplessEnabled) {
      if (this._renderer) this._renderer.setGaplessEnabled(!stActive);
    }
  }

  get tempo() { return this._renderer ? this._renderer.tempo : 1.0; }
  get pitch() { return this._renderer ? this._renderer.pitch : 1.0; }
  get rate() { return this._renderer ? this._renderer.rate : 1.0; }

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
    // デバイス切り替えは再初期化が必要
    if (this._renderer && this._renderer.isInitialized) {
      this._reinitRenderer();
    }
  }

  /**
   * レンダラーを再初期化し、現在のトラックを再読み込みする
   */
  async _reinitRenderer() {
    if (!this._renderer) return;

    const currentTrack = this.currentTrack;
    const savedPosition = this._fe_position;
    const wasPlaying = this._fe_state === 'playing';

    try {
      await this._renderer.close();
      const shareMode = this._exclusive ? SHARE_EXCLUSIVE : SHARE_SHARED;
      await this._renderer.init({
        shareMode,
        deviceIndex: this._getDeviceIndex(),
      });

      if (currentTrack) {
        const filePath = this._resolvePlayablePath(currentTrack);
        this._renderer._currentFilePath = filePath;
        const info = await this._renderer.playFile(filePath);
        this._fe_duration = info.durationMs;
        this.emit('duration_changed', this._fe_duration);

        if (savedPosition > 0) {
          this._renderer.seek(savedPosition);
        }
        if (wasPlaying) {
          await this._renderer.play();
          this._renderer.setVolume(this._fe_volume / 100);
        }
      }
    } catch (e) {
      console.error('[player] Renderer reinit failed:', e);
    }
  }

  /**
   * WASAPI 排他モードを有効/無効にする
   * 切換後、現在のトラックを新しいモードで再読み込みする。
   */
  async setExclusiveMode(enabled) {
    if (!this._renderer && enabled) {
      console.warn('[player] Native renderer not available');
      return false;
    }
    if (this._exclusive === enabled) return true;

    // 現在のトラックと位置を保存
    const currentTrack = this.currentTrack;
    const savedPosition = this._fe_position;
    const wasPlaying = this._fe_state === 'playing' || this._fe_state === 'paused';

    // 再生を停止
    if (this._renderer) {
      this._renderer.stop();
    }
    this._fe_state = 'stopped';
    this._fe_position = 0;

    this._exclusive = enabled;

    if (this._settings) {
      this._settings.set('wasapi_exclusive', enabled);
    }

    // レンダラーを再初期化
    try {
      if (this._renderer.isInitialized) {
        await this._renderer.close();
      }
      const shareMode = enabled ? SHARE_EXCLUSIVE : SHARE_SHARED;
      await this._renderer.init({
        shareMode,
        deviceIndex: this._getDeviceIndex(),
      });
      this._renderer.setVolume(this._fe_volume / 100);
    } catch (e) {
      console.error('[player] Failed to initialize renderer:', e);
      if (enabled) {
        // 排他モード失敗 → 共有モードにフォールバック
        this._fallbackToShared();
        try {
          await this._renderer.init({
            shareMode: SHARE_SHARED,
            deviceIndex: this._getDeviceIndex(),
          });
        } catch (e2) {
          console.error('[player] Shared mode fallback also failed:', e2);
        }
        return false;
      }
    }

    // 現在のトラックを新しいモードで再読み込み
    if (currentTrack) {
      try {
        const filePath = this._resolvePlayablePath(currentTrack);
        this._renderer._currentFilePath = filePath;
        const info = await this._renderer.playFile(filePath);
        this._fe_duration = info.durationMs;
        this.emit('duration_changed', this._fe_duration);

        if (savedPosition > 0) {
          this._renderer.seek(savedPosition);
        }
        if (wasPlaying) {
          await this._renderer.play();
          this._renderer.setVolume(this._fe_volume / 100);
        } else {
          this._fe_state = 'paused';
        }
      } catch (e) {
        console.error('[player] Failed to reload track:', e);
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
  get frontendPlayback() { return false; }

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

    // ネイティブレンダラーで復元
    this._playNative(track).then(() => {
      if (this._renderer && this._renderer.isInitialized) {
        if (this._fe_position > 0) {
          this._renderer.seek(this._fe_position);
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
      try { this._renderer.close(); } catch { /* ignore */ }
    }
  }
}

module.exports = { MusicPlayer };
