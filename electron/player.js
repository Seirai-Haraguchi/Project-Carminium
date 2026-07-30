/**
 * Carminium - 音乐播放器
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

    // Web Audio API 模式标志
    this._webAudioEnabled = false;

    // ネイティブレンダラーのイベントハンドリング
    if (this._renderer) {
      // Gapless と AutoMix は相互排他: 両方有効なら AutoMix 優先
      if (this._automixEnabled && this._gaplessEnabled) {
        this._gaplessEnabled = false;
        if (settings) settings.set('gapless', false);
      }

      // DLL state tracking (play/pause/stop)
      this._renderer.on('state_changed', (state) => {
        this._fe_state = state;
        this.emit('state_changed', state);
      });

      // AudioEngine control: renderer に初期設定を送る
      this.emit('audio_control', JSON.stringify({ action: 'set_gapless', enabled: this._gaplessEnabled }));
      this.emit('audio_control', JSON.stringify({ action: 'set_crossfade', enabled: this._automixEnabled }));
      this.emit('audio_control', JSON.stringify({ action: 'set_crossfade_duration', ms: this._crossfadeDurationMs }));
    }
  }

  // ── 内部ヘルパー ──────────────────────────────────────────────────────────

  /** 設定から現在の出力デバイスインデックスを取得 */
  _getDeviceIndex() {
    const devId = this._settings ? this._settings.get('audio_output_device', '') : '';
    const idx = parseInt(devId, 10);
    return isNaN(idx) ? -1 : idx;
  }

  // ── AudioEngine 制御ヘルパー ──────────────────────────────────────────────
  // これらのヘルパーは setExclusiveMode / _reinitRenderer / _playNative で
  // 共通して使われる audio_control 送信ロジックを一元化し、
  // 将来のアクション追加や送信方式の変更(例: executeJavaScript → IPC)を
  // 簡単にするための拡張ポイントでもある。

  /**
   * audio_control アクションを1つ送信する。
   * @param {string} action - 'play' | 'stop' | 'seek' | ...
   * @param {object} [params] - 追加パラメータ(省略可)
   */
  _emitAudioControl(action, params) {
    const payload = params ? { action, ...params } : { action };
    this.emit('audio_control', JSON.stringify(payload));
  }

  /**
   * AudioEngine を完全に停止させる(stop + clear_next)。
   * レンダラー(WASAPI DLL)を再初期化する前に必ず呼ぶ。
   * そうしないと AudioEngine の古いソース/ストリーミングノードが
   * 生き続け、PCM ルーティング不整合やサイレント状態に陥る。
   */
  _stopAudioEngine() {
    this._emitAudioControl('stop');
    this._emitAudioControl('clear_next');
  }

  /**
   * WASAPI レンダラーを指定モードで(再)初期化し、結果を AudioEngine に通知する。
   * @param {boolean} exclusive - true=排他, false=共有
   * @returns {Promise<boolean>} 成功時に true、失敗時に false
   */
  async _reinitRendererWithMode(exclusive) {
    if (!this._renderer) return false;

    // レンダラーが初期化済みなら一旦閉じる
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

    // 独占模式自动回退检测：wasapi.js init() 失败时会自动重试共享模式
    if (shareMode === SHARE_EXCLUSIVE && initInfo.shareMode !== SHARE_EXCLUSIVE) {
      this._fallbackToShared();
    }

    // AudioEngine に新しいサンプリングレート/チャンネル数を通知
    // (AudioEngine の init() は最初の1回のみ AudioContext を生成するが、
    //  この通知は設計上のプロトコル整合性を保つために必ず送信する)
    this._emitAudioControl('init', {
      sampleRate: this._renderer._sampleRate,
      channels: this._renderer._channels,
    });
    // 音量を AudioEngine に同期(DLL 側は常に 1.0)
    this._emitAudioControl('set_volume', { level: this._fe_volume / 100 });

    return true;
  }

  /** 排他モード回退時に設定を同期し、UI を更新 */
  _fallbackToShared() {
    this._exclusive = false;
    if (this._settings) {
      this._settings.set('wasapi_exclusive', false);
    }
    this.emit('settings_changed', JSON.stringify(this._settings.all()));
  }

  /**
   * Web Audio API 模式を有効/無効にする。
   * 有効時、ブラウザでデコード可能な形式は FFmpeg を使用しない。
   */
  setWebAudioEnabled(enabled) {
    this._webAudioEnabled = !!enabled;
    if (this._renderer) {
      this._renderer.setWebAudioEnabled(enabled);
    }
    console.log('[player] Web Audio mode:', enabled ? 'enabled' : 'disabled');
  }

  /**
   * 指定されたトラックが FFmpeg デコードを必要とするかどうか。
   * Web Audio 模式が無効、または形式が wma/ape 等の場合は true。
   */
  _needsFFmpegForTrack(track) {
    if (!this._webAudioEnabled) return true;
    const path = this._resolvePlayablePath(track);
    if (!path) return true;
    // 远程 URL（Subsonic 等）总是使用 FFmpeg 流式播放：
    // 浏览器解码需要把整个文件通过 IPC 传到渲染进程再 decodeAudioData()，
    // 会阻塞渲染进程主线程，导致 UI 冻结。FFmpeg 在独立进程解码，不影响 UI。
    if (path.startsWith('http://') || path.startsWith('https://')) return true;
    // 拡張子で判定
    const ext = path.split('.').pop().toLowerCase();
    const browserDecodable = ['mp3', 'wav', 'ogg', 'oga', 'opus', 'm4a', 'aac', 'flac', 'mp4', 'weba', 'webm'];
    return !browserDecodable.includes(ext);
  }

  // ── AudioEngine IPC handlers (Renderer → Main) ────────────────────────────

  _handleAudioPositionTick(ms) {
    this._fe_position = ms;
    this.emit('position_changed', ms);
  }

  _handleAudioEnded() {
    if (this._automix_active) {
      this.emit('automix_takeover');
      return;
    }
    this.nextTrack();
  }

  _handleAudioCrossfadeComplete(positionMs) {
    this._onCrossfadeComplete(positionMs);
  }

  /**
   * Web Audio API 模式：无缝切换完成后的处理。
   * AudioEngine 已在 renderer 侧完成 next → current 的内部状态迁移。
   * ここではキューインデックスの advancement とイベント通知のみ行う。
   *
   * Streaming gapless の場合、FFmpeg プロセスの promoteNextToCurrent() が必要。
   * Buffer gapless の場合、promoteNextToCurrent() は no-op（FFmpeg プロセス不存在）。
   */
  _handleGaplessSwitch() {
    // Streaming gapless: promote FFmpeg process from next → main
    if (this._renderer && this._renderer.promoteNextToCurrent) {
      this._renderer.promoteNextToCurrent();
    }

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

    const track = this._queue[this._current_index];
    if (!track) return;

    // AudioEngine が内部で next → current に移行済みなので、
    // position は 0 に近い（seekOffsetMs = 0）
    this._fe_position = 0;
    this._fe_duration = this._resolveDuration(
      this._renderer ? this._renderer._durationMs : 0,
      track
    );

    this.emit('track_changed', JSON.stringify(track));
    this.emit('liked_changed', this.isCurrentLiked);
    this.emit('duration_changed', this._fe_duration);
    this.emit('position_changed', 0);
    this._emitQueueChanged();

    // シャッフル履歴
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

    // 次曲がプリロード済みならキャンセルして、新しく挿入した曲をプリロードする。
    // これを行わないと AutoMix/Gapless が古いプリロード曲に切り替わってしまう。
    if (this._renderer && this._renderer.hasNextPreloaded()) {
      this._renderer.cancelPreloadNext();
      this.emit('audio_control', JSON.stringify({ action: 'clear_next' }));
    }
    if (this._automixEnabled || this._gaplessEnabled) {
      this._preloadNextTrack();
    }
  }

  appendQueue(track) {
    if (!this._queue.length) {
      this.playTracks([track]);
      return;
    }
    // 追加前に次曲が存在しなかった場合、プリロードが必要
    const needsPreload = (this._current_index === this._queue.length - 1);
    this._queue.push(track);
    this._original_queue.push(track);
    this._emitQueueChanged();

    if (needsPreload && (this._automixEnabled || this._gaplessEnabled)) {
      this._preloadNextTrack();
    }
  }

  removeFromQueue(index) {
    if (index < 0 || index >= this._queue.length) return;
    if (index === this._current_index) return;

    // 削除対象がプリロード済みの次曲かどうかを splice 前に判定
    const wasPreloadedNext = (index === this._current_index + 1);

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

    // プリロード済みの次曲が削除された場合、キャンセルして新しい次曲をプリロード
    if (wasPreloadedNext && this._renderer && this._renderer.hasNextPreloaded()) {
      this._renderer.cancelPreloadNext();
      this.emit('audio_control', JSON.stringify({ action: 'clear_next' }));
    }
    if (wasPreloadedNext && (this._automixEnabled || this._gaplessEnabled)) {
      this._preloadNextTrack();
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
    const parts = p.slice('subsonic://'.length).split('/');
    if (parts.length < 2) return p;
    const serverId = parts[0];
    const subsonicId = parts.slice(1).join('/');
    if (!this._media_base_url) return p;
    return `${this._media_base_url}/subsonic/stream/${serverId}/${subsonicId}`;
  }

  /**
   * 再生位置のフォールバックを解決。
   * ffprobe が HTTP ストリームで失敗した場合 (probeMs=0)、
   * トラックのメタデータ長をフォールバックとして使用。
   */
  _resolveDuration(probeMs, track) {
    if (probeMs > 0) return probeMs;
    if (track && track.duration_ms > 0) return track.duration_ms;
    return 0;
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

    // AudioEngine に停止を通知（リングバッファクリア + 次曲状態クリア）
    this.emit('audio_control', JSON.stringify({ action: 'stop' }));
    this.emit('audio_control', JSON.stringify({ action: 'clear_next' }));

    try {
      // レンダラー未初期化なら初期化
      if (!this._renderer.isInitialized) {
        const shareMode = this._exclusive ? SHARE_EXCLUSIVE : SHARE_SHARED;
        const initInfo = await this._renderer.init({
          shareMode,
          deviceIndex: this._getDeviceIndex(),
          sampleRate: 44100,
          channels: 2,
        });
        if (myToken !== this._nativePlayToken) return;
        // 独占模式自动回退检测：wasapi.js init() 失败时会自动重试共享模式
        if (shareMode === SHARE_EXCLUSIVE && initInfo.shareMode !== SHARE_EXCLUSIVE) {
          this._fallbackToShared();
        }
        // AudioEngine に初期化パラメータを通知
        this.emit('audio_control', JSON.stringify({
          action: 'init',
          sampleRate: this._renderer._sampleRate,
          channels: this._renderer._channels,
        }));
      }
      this._renderer._currentFilePath = filePath;

      // トラック変更通知
      this.emit('state_changed', 'loading');
      this.emit('track_changed', JSON.stringify(track));
      this.emit('liked_changed', this.isCurrentLiked);
      this._emitQueueChanged();

      // Web Audio 模式：浏览器可解码的格式使用 setupForBrowserDecode()
      const needsFFmpeg = this._needsFFmpegForTrack(track);
      let info;
      if (this._webAudioEnabled && !needsFFmpeg) {
        // 浏览器解码路径：不启动 FFmpeg，由 Web Audio API 处理
        info = await this._renderer.setupForBrowserDecode(filePath);
      } else {
        // FFmpeg 解码路径：传统方式
        info = await this._renderer.playFile(filePath);
      }
      if (myToken !== this._nativePlayToken) return; // より新しい呼び出しが勝った

      const durationMs = this._resolveDuration(info.durationMs, track);
      if (!info.durationMs && durationMs > 0) {
        console.log('[player] Using metadata duration fallback:', durationMs, 'ms for', track.title);
      }

      this._fe_duration = durationMs;
      this.emit('duration_changed', this._fe_duration);

      // AudioEngine に再生開始を通知
      this.emit('audio_control', JSON.stringify({
        action: 'play',
        filePath: filePath,
        durationMs: durationMs,
        seekOffsetMs: 0,
        trackId: track.id || '',
        title: track.title || '',
        artist: track.artist || track.album_artist || '',
      }));

      // 再生開始
      await this._renderer.play();
      if (myToken !== this._nativePlayToken) return; // より新しい呼び出しが勝った
      // 音量を AudioEngine に同期
      this.emit('audio_control', JSON.stringify({ action: 'set_volume', level: this._fe_volume / 100 }));

      // Web Audio 模式：浏览器可解码格式使用 playStreaming 通知 AudioEngine
      // FFmpeg 格式需要 AudioEngine 创建 streaming node 来接收 PCM 数据
      if (this._webAudioEnabled && needsFFmpeg) {
        this.emit('audio_control', JSON.stringify({
          action: 'play_streaming',
          durationMs: durationMs,
          seekOffsetMs: 0,
          filePath: filePath,
          trackId: track.id || '',
          title: track.title || '',
          artist: track.artist || track.album_artist || '',
        }));
      }

      // AutoMix / Gapless: 有効なら次曲をプリロード
      if (this._automixEnabled || this._gaplessEnabled) {
        this._preloadNextTrack();
      }
    } catch (e) {
      if (myToken !== this._nativePlayToken) return; // もう無効
      console.error('[player] Native playback failed:', e);
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

    // リピート all なら最初に戻る（単曲キューの場合も自身に戻る）
    if (this._repeat === 'all') {
      return this._queue[0];
    }

    return null;
  }

  /** 次曲をプリロードする（非同期、エラーは無視） */
  async _preloadNextTrack() {
    console.log('[player] _preloadNextTrack called:',
      'renderer:', !!this._renderer,
      'automixEnabled:', this._automixEnabled,
      'gaplessEnabled:', this._gaplessEnabled,
      'initialized:', !!this._renderer?.isInitialized,
      'nextFilePath:', !!this._renderer?._nextFilePath);
    if (!this._renderer) return;
    if (!this._automixEnabled && !this._gaplessEnabled) return;
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

    // 決定：次曲に FFmpeg を起動するかどうか
    // - 現在曲が FFmpeg 流式の場合：次曲の形式に関わらず FFmpeg を起動する
    //   （ストリーム→ストリーム过渡のため、次曲 PCM も 'next' チャンネルに必要）
    // - 現在曲が Buffer の場合：次曲がブラウザデコード可能なら FFmpeg 不要
    const currentNeedsFFmpeg = this._webAudioEnabled && currentTrack && this._needsFFmpegForTrack(currentTrack);
    const nextNeedsFFmpeg = this._webAudioEnabled && this._needsFFmpegForTrack(nextTrack);
    const skipFFmpeg = this._webAudioEnabled && !currentNeedsFFmpeg && !nextNeedsFFmpeg;

    // forceStreaming: 現在曲がストリームの場合、次曲がローカルファイルでも
    // FFmpeg PCM として 'next' チャンネルで処理するよう AudioEngine に指示
    const forceStreaming = currentNeedsFFmpeg;

    const mode = this._gaplessEnabled ? 'Gapless' : 'AutoMix';
    console.log(`[player] ${mode}: preloading next track:`, nextTrack.title || nextTrack.id,
      'skipFFmpeg:', skipFFmpeg, 'forceStreaming:', forceStreaming);

    // ── 先用元数据时长发送 set_next_info，让 AudioEngine 立即开始解码 buffer ──
    // 旧实现先 await preloadNext()（含 ffprobe + FFmpeg 启动）再发送 set_next_info，
    // 导致 AudioEngine 解码延迟启动，过渡触发点到达时下一曲可能尚未就绪。
    // 现在 set_next_info 与 preloadNext 并行执行，大幅缩短下一曲就绪时间。
    const metaDurationMs = this._resolveDuration(0, nextTrack);
    this.emit('audio_control', JSON.stringify({
      action: 'set_next_info',
      filePath: filePath,
      durationMs: metaDurationMs,
      forceStreaming: forceStreaming,
      trackId: nextTrack.id || '',
      title: nextTrack.title || '',
      artist: nextTrack.artist || nextTrack.album_artist || '',
    }));
    console.log(`[player] ${mode}: set_next_info sent early (duration=${metaDurationMs}ms from metadata)`);

    // ── 并行执行 renderer 预加载（ffprobe + FFmpeg 启动）──
    // 如果 ffprobe 返回了更精确的时长，补发更新
    try {
      const info = await this._renderer.preloadNext(filePath, { skipFFmpeg });
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
        }));
        console.log(`[player] ${mode}: set_next_info updated (duration=${probedMs}ms from ffprobe)`);
      }
    } catch (e) {
      console.warn('[player] preloadNext failed:', e.message, '- AudioEngine already notified');
    }
  }

  /** クロスフェード完了時の処理 */
  _onCrossfadeComplete(mixerPositionMs) {
    // wasapi.js 側で next ffmpeg を main ffmpeg に昇格させる。
    // これを行わないと、crossfade 後の新曲の PCM データが 'next' channel に
    // 送られ続け、AudioEngine の mainRing が枯渇して静音死锁になる。
    if (this._renderer && this._renderer.promoteNextToCurrent) {
      this._renderer.promoteNextToCurrent();
    }

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

    // クロスフェード完了後の位置を通知
    const seekOffset = (mixerPositionMs != null) ? mixerPositionMs : (this._renderer ? (this._renderer._seekOffsetMs || 0) : 0);
    this._fe_position = seekOffset;
    // promoteNextToCurrent() の呼び出しにより、_durationMs は新曲の値に更新済み
    // ffprobe が HTTP ストリームで失敗した場合、メタデータからフォールバック
    this._fe_duration = this._resolveDuration(this._renderer._durationMs, track);
    this.emit('track_changed', JSON.stringify(track));
    this.emit('liked_changed', this.isCurrentLiked);
    this.emit('duration_changed', this._fe_duration);
    // 即座に位置を通知（100ms タイマーを待たずに UI/歌詞を正しい位置に合わせる）
    this.emit('position_changed', seekOffset);
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
      this.emit('audio_control', JSON.stringify({ action: 'set_gapless', enabled: false }));
    }
    this.emit('audio_control', JSON.stringify({ action: 'set_crossfade', enabled: this._automixEnabled }));
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
    this.emit('audio_control', JSON.stringify({ action: 'set_crossfade_duration', ms: this._crossfadeDurationMs }));
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
      this.emit('audio_control', JSON.stringify({ action: 'set_crossfade', enabled: false }));
    }
    this.emit('audio_control', JSON.stringify({ action: 'set_gapless', enabled: this._gaplessEnabled }));
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
      // AudioEngine に再生再開を通知（_posTimer / _pumpTimer 再開）
      this.emit('audio_control', JSON.stringify({ action: 'resume' }));
      this._renderer.play();
      return;
    }
  }

  pause() {
    if (this._renderer) {
      // AudioEngine に暂停を通知（_posTimer / _pumpTimer 停止）
      this.emit('audio_control', JSON.stringify({ action: 'pause' }));
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
      const track = this.currentTrack;
      if (this._webAudioEnabled && track && this._needsFFmpegForTrack(track)) {
        // FFmpeg 流式模式：seek(0) 无效，需要重新建立流
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
      // 通知 AudioEngine 清空 ring buffer 并更新位置
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

  // ── SoundTouch パラメータ ──────────────────────────────────────────────────

  setTempo(tempo) {
    this._tempo = Math.max(0.25, Math.min(4.0, parseFloat(tempo) || 1.0));
    // tempo/pitch/rate がすべて 1.0 でなければ AutoMix / Gapless 非対応
    const stActive = (this._tempo !== 1.0 || this._pitch !== 1.0 || this._rate !== 1.0);
    if (this._automixEnabled) {
      this.emit('audio_control', JSON.stringify({ action: 'set_crossfade', enabled: !stActive }));
    }
    if (this._gaplessEnabled) {
      this.emit('audio_control', JSON.stringify({ action: 'set_gapless', enabled: !stActive }));
    }
  }

  setPitch(pitch) {
    this._pitch = Math.max(0.25, Math.min(4.0, parseFloat(pitch) || 1.0));
    const stActive = (this._tempo !== 1.0 || this._pitch !== 1.0 || this._rate !== 1.0);
    if (this._automixEnabled) {
      this.emit('audio_control', JSON.stringify({ action: 'set_crossfade', enabled: !stActive }));
    }
    if (this._gaplessEnabled) {
      this.emit('audio_control', JSON.stringify({ action: 'set_gapless', enabled: !stActive }));
    }
  }

  setRate(rate) {
    this._rate = Math.max(0.25, Math.min(4.0, parseFloat(rate) || 1.0));
    const stActive = (this._tempo !== 1.0 || this._pitch !== 1.0 || this._rate !== 1.0);
    if (this._automixEnabled) {
      this.emit('audio_control', JSON.stringify({ action: 'set_crossfade', enabled: !stActive }));
    }
    if (this._gaplessEnabled) {
      this.emit('audio_control', JSON.stringify({ action: 'set_gapless', enabled: !stActive }));
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
   * レンダラーを再初期化し、現在のトラックを再読み込みする。
   * デバイス切り替え時に呼ばれる。
   *
   * 設計上の注意:
   * - AudioEngine を先に停止(stop + clear_next)してから DLL を再初期化する。
   *   逆にすると古いソースノードが生き続け、PCM ルーティング不整合で
   *   サイレント状態に陥る(切替後に音が出ない主原因)。
   * - seek 位置は play/play_streaming の seekOffsetMs に統合する。
   *   buffer モードでは _loadAndDecode 完了前に別途 seek を送ると
   *   _currentBuffer が null で早期リターンされ、seek が失われる。
   * - paused トラックは再再生せず paused 状態を維持する。
   */
  async _reinitRenderer() {
    if (!this._renderer) return;

    const currentTrack = this.currentTrack;
    const savedPosition = this._fe_position;
    const wasPlaying = this._fe_state === 'playing';
    const wasPaused = this._fe_state === 'paused';

    // 1. AudioEngine を先に完全停止(古いソース/ストリーミングノードを破棄)
    this._stopAudioEngine();

    try {
      // 2. WASAPI レンダラーを再初期化(現在のモードを維持)
      const ok = await this._reinitRendererWithMode(this._exclusive);
      if (!ok) return;

      // 3. 現在のトラックを新しいモードで再読み込み
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

        // 4. AudioEngine に再生開始を通知(seek 位置と paused フラグを統合)
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
          // FFmpeg ストリーミング: FFmpeg を seek 位置から再起動
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

        // 5. WASAPI デバイスを開始(playing のみ)
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

  /**
   * WASAPI 排他モードを有効/無効にする。
   * 切替後、現在のトラックを新しいモードで再読み込みする。
   *
   * 修正履歴:
   * - AudioEngine への stop+clear_next 通知を先に行わないと、DLL 再初期化中に
   *   古いソースノードが生き続け PCM ルーティング不整合 → サイレント状態。
   * - init() に sampleRate:44100 を渡さないと DLL がデバイスネイティブレート
   *   (例: 48000Hz) で初期化され、AudioEngine(44100Hz 固定)と不一致 → 音質崩れ。
   * - seek を別途 emit すると buffer モードで _currentBuffer 未ロード時に
   *   早期リターンで seek が失われる → play の seekOffsetMs に統合。
   * - wasPlaying に 'paused' を含めると一時停止中のトラックが再再生される。
   * - トラック再読み込み失敗時に true を返すと UI が誤ったモードを表示する。
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
    const wasPlaying = this._fe_state === 'playing';
    const wasPaused = this._fe_state === 'paused';

    // 1. AudioEngine を先に完全停止(古いソース/ストリーミングノードを破棄)
    //    これを renderer.stop() の前に行うのが重要:
    //    さもないと DLL 再初期化中に AudioEngine が古いノードで動き続け、
    //    PCM ルーティング不整合でサイレント状態に陥る
    this._stopAudioEngine();

    // 2. レンダラー(WASAPI DLL + FFmpeg)を停止
    if (this._renderer) {
      try { this._renderer.stop(); } catch { /* ignore */ }
    }
    this._fe_state = 'stopped';
    this._fe_position = 0;

    // 新モードを適用(失敗時にロールバックできるよう旧値を保存)
    const prevExclusive = this._exclusive;
    this._exclusive = enabled;
    if (this._settings) {
      this._settings.set('wasapi_exclusive', enabled);
    }

    // 3. レンダラーを新しいモードで再初期化
    try {
      const ok = await this._reinitRendererWithMode(enabled);
      if (!ok) {
        // _reinitRendererWithMode が false を返した場合(レンダラー null 等)
        // 旧モードへロールバックして整合性を保つ
        this._exclusive = prevExclusive;
        if (this._settings) { this._settings.set('wasapi_exclusive', prevExclusive); }
        return false;
      }
    } catch (e) {
      console.error('[player] Failed to initialize renderer:', e);
      // ハード失敗(例: デバイス抜け等)時にフラグを旧値に戻す
      this._exclusive = prevExclusive;
      if (this._settings) { this._settings.set('wasapi_exclusive', prevExclusive); }
      return false;
    }

    // 4. 現在のトラックを新しいモードで再読み込み
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

        // 5. AudioEngine に再生開始を通知(seek 位置と paused フラグを統合)
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
          // FFmpeg ストリーミング: seek 位置から FFmpeg を再起動
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

        // 6. WASAPI デバイスを開始(playing のみ)
        if (wasPlaying) {
          await this._renderer.play();
        } else if (wasPaused) {
          this._fe_state = 'paused';
        }
      } catch (e) {
        console.error('[player] Failed to reload track:', e);
        // トラック再読み込み失敗時は false を返し、UI が実際の状態を反映できるようにする
        return false;
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
      this.emit('lyrics_changed', JSON.stringify({ trackId, lyrics }));
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
          // AudioEngine にも seek を通知
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
      try { this._renderer.close(); } catch { /* ignore */ }
    }
  }
}

module.exports = { MusicPlayer };
