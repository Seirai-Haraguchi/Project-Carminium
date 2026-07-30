/**
 * Carminium — VideoBackground (Canvas)
 *
 * 在正在播放页面的氛围背景层中，以同名视频文件作为动态背景。
 * 通过 <video> 元素解码视频帧，使用 Canvas 以 object-fit:cover 方式绘制，
 * 在视频上方叠加半透明黑色遮罩以保证内容可读性。
 *
 * 视频分类：
 *   duration > 30s → MV（保持与音乐播放同一进度，支持 seek 同步）
 *   duration ≤ 30s → 短视频（自动循环，不追踪进度）
 * 两种类型在视频时长不足歌曲时长时均自动循环，直至歌曲结束。
 *
 * 架构：
 *   - <video> 元素隐藏，仅作为 Canvas 绘制源
 *   - <canvas> 元素全屏覆盖背景区域，以 rAF 逐帧绘制
 *   - <div> 半透明遮罩叠在 Canvas 之上
 *   - 通过 CSS class .video-active 控制层叠显隐
 *
 * 可维护性：
 *   - 单一类管理全部状态，对外接口清晰（load/clear/setPlaying/onFullscreenChange）
 *   - 代次令牌防止异步竞态
 *   - ResizeObserver 自动适配分辨率
 *   - destroy() 保证资源完整释放
 */
(function () {
  'use strict';

  window.VideoBackground = VideoBackground;

  /** 视频类型判定阈值（秒） */
  var VIDEO_TYPE_THRESHOLD_SEC = 30;

  /**
   * @param {HTMLElement} bgElement — .np-bg 容器元素
   */
  function VideoBackground(bgElement) {
    this._bg = bgElement;

    // ── 隐藏的视频源元素 ──
    var video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.crossOrigin = 'anonymous';
    video.style.display = 'none';
    video.setAttribute('aria-hidden', 'true');
    document.body.appendChild(video);
    this._video = video;

    // ── 可见 Canvas ──
    var canvas = document.createElement('canvas');
    canvas.className = 'np-bg-video';
    this._canvas = canvas;
    this._ctx = canvas.getContext('2d');

    // ── 半透明遮罩 ──
    var overlay = document.createElement('div');
    overlay.className = 'np-bg-video-overlay';
    this._overlay = overlay;

    // 插入到 .np-bg 最前方（最底层）
    bgElement.insertBefore(overlay, bgElement.firstChild);
    bgElement.insertBefore(canvas, bgElement.firstChild);

    // ── 状态 ──
    this._enabled = false;     // 功能是否被用户启用
    this._active = false;      // 是否有视频正在显示
    this._videoType = null;     // 'mv' | 'short' | null
    this._songDurationMs = 0;
    this._isPlaying = false;
    this._rafId = null;
    this._gen = 0;              // 异步代次，防止竞态
    this._currentVideoUrl = null;

    // ── 事件绑定 ──
    this._onResize = this._onResize.bind(this);
    this._render = this._render.bind(this);
    this._onMetadataLoaded = this._onMetadataLoaded.bind(this);
    this._onVideoError = this._onVideoError.bind(this);

    video.addEventListener('loadedmetadata', this._onMetadataLoaded);
    video.addEventListener('error', this._onVideoError);

    // ── 尺寸监听 ──
    this._resizeObserver = new ResizeObserver(this._onResize);
    this._resizeObserver.observe(bgElement);
  }

  VideoBackground.prototype = {
    constructor: VideoBackground,

    // ── 公开接口 ──────────────────────────────────────────────────

    /**
     * 启用/禁用视频背景功能。
     */
    setEnabled: function (enabled) {
      this._enabled = !!enabled;
      if (!this._enabled) this.clear();
    },

    /**
     * 当前是否有视频正在显示。
     */
    getActive: function () { return this._active; },

    /**
     * 获取当前视频类型。
     */
    getVideoType: function () { return this._videoType; },

    /**
     * 加载视频并以 Canvas 渲染为背景。
     * @param {string} videoUrl  — 视频文件的 HTTP URL
     * @param {number} songDurationMs — 当前歌曲时长（ms）
     */
    load: function (videoUrl, songDurationMs) {
      // 递增代次：使任何进行中的异步操作失效
      this._gen++;

      // 清除上一个视频
      this._resetVideo();

      if (!this._enabled || !videoUrl) {
        this.clear();
        return;
      }

      this._songDurationMs = songDurationMs || 0;
      this._currentVideoUrl = videoUrl;

      // 设置源并加载
      this._video.src = videoUrl;
      this._video.load();
    },

    /**
     * 清除视频背景，回退到封面氛围背景。
     */
    clear: function () {
      this._gen++;
      this._resetVideo();
      this._active = false;
      this._videoType = null;
      this._currentVideoUrl = null;
      this._bg.classList.remove('video-active');
      this._stopRender();
    },

    /**
     * 同步播放/暂停状态。
     * @param {boolean} playing
     */
    setPlaying: function (playing) {
      this._isPlaying = !!playing;
      if (!this._active) return;

      var visible = this._isVisible();
      if (this._isPlaying && visible) {
        var p = this._video.play();
        if (p && typeof p.then === 'function') {
          p.catch(function () { /* autoplay 被阻止，忽略 */ });
        }
        this._startRender();
      } else {
        this._video.pause();
        this._stopRender();
      }
    },

    /**
     * 同步视频进度与音乐播放进度（仅 MV 类型）。
     * MV：视频 currentTime = 歌曲位置（秒），超出视频时长时取模循环。
     * 短视频：不处理，保持自动循环。
     * @param {number} positionMs — 音乐当前播放位置（毫秒）
     */
    updatePosition: function (positionMs) {
      if (!this._active || this._videoType !== 'mv') return;

      var video = this._video;
      var videoDuration = video.duration;
      if (!isFinite(videoDuration) || videoDuration <= 0) return;

      var targetSec = positionMs / 1000;

      // 目标超出视频时长：取模循环
      if (targetSec >= videoDuration) {
        targetSec = targetSec % videoDuration;
      }

      // 偏差超过 1.5 秒时才 seek（处理拖拽进度条/跳转，避免频繁 seek 导致卡顿）
      var diff = Math.abs(video.currentTime - targetSec);
      if (diff > 1.5) {
        try { video.currentTime = targetSec; } catch (e) { /* seek 失败，忽略 */ }
      }
    },

    /**
     * 全屏状态变化时调用，控制视频播放/暂停以节省资源。
     */
    onFullscreenChange: function () {
      if (!this._active) return;
      var visible = this._isVisible();
      if (visible && this._isPlaying) {
        var p = this._video.play();
        if (p && typeof p.then === 'function') {
          p.catch(function () { /* ignore */ });
        }
        this._startRender();
      } else {
        this._video.pause();
        this._stopRender();
      }
    },

    /**
     * 销毁实例，释放所有资源。
     */
    destroy: function () {
      this._gen++;
      this._stopRender();
      this._resetVideo();
      if (this._resizeObserver) {
        this._resizeObserver.disconnect();
        this._resizeObserver = null;
      }
      var video = this._video;
      video.removeEventListener('loadedmetadata', this._onMetadataLoaded);
      video.removeEventListener('error', this._onVideoError);
      if (video.parentNode) video.parentNode.removeChild(video);
      if (this._canvas.parentNode) this._canvas.parentNode.removeChild(this._canvas);
      if (this._overlay.parentNode) this._overlay.parentNode.removeChild(this._overlay);
      this._bg.classList.remove('video-active');
    },

    // ── 内部方法 ──────────────────────────────────────────────────

    /**
     * 视频元数据加载完成：判定类型、设置循环、激活显示。
     */
    _onMetadataLoaded: function () {
      var videoDuration = this._video.duration;
      if (!isFinite(videoDuration) || videoDuration <= 0) return;

      // 视频分类
      this._videoType = videoDuration > VIDEO_TYPE_THRESHOLD_SEC ? 'mv' : 'short';

      // 循环判定
      var songDurationSec = this._songDurationMs / 1000;
      if (this._videoType === 'mv') {
        // MV：始终循环，由位置同步保证进度一致
        this._video.loop = true;
      } else {
        // 短视频：视频时长 < 歌曲时长时循环
        this._video.loop = (songDurationSec > 0 && videoDuration < songDurationSec);
      }

      // 激活
      this._active = true;
      this._bg.classList.add('video-active');
      this._onResize();

      // 同步播放状态
      if (this._isPlaying && this._isVisible()) {
        var p = this._video.play();
        if (p && typeof p.then === 'function') {
          p.catch(function () { /* ignore */ });
        }
        this._startRender();
      }
    },

    /**
     * 视频加载失败：清除并回退。
     */
    _onVideoError: function () {
      console.warn('[VideoBackground] Video load error:', this._currentVideoUrl);
      this.clear();
    },

    /**
     * 重置视频元素（清除 src、停止渲染）。
     */
    _resetVideo: function () {
      this._stopRender();
      var video = this._video;
      if (video.src || video.getAttribute('src')) {
        video.removeAttribute('src');
        video.load();
      }
      video.loop = false;
    },

    /**
     * 检查背景层当前是否可见（在全窗口视图中且未收折）。
     */
    _isVisible: function () {
      var pane = document.getElementById('now-playing-pane');
      if (!pane) return false;
      return pane.classList.contains('fullscreen') &&
             !pane.classList.contains('collapsed');
    },

    /**
     * 响应容器尺寸变化，更新 Canvas 分辨率。
     */
    _onResize: function () {
      if (!this._active) return;
      var rect = this._bg.getBoundingClientRect();
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      var w = Math.floor(rect.width * dpr);
      var h = Math.floor(rect.height * dpr);
      if (w > 0 && h > 0) {
        this._canvas.width = w;
        this._canvas.height = h;
      }
    },

    /**
     * Canvas 逐帧渲染循环：以 object-fit:cover 方式绘制视频帧。
     */
    _render: function () {
      if (!this._active || !this._isPlaying) {
        this._rafId = null;
        return;
      }

      var video = this._video;
      // readyState >= 2 (HAVE_CURRENT_DATA) 时才有可绘制的帧
      if (video.readyState >= 2) {
        var ctx = this._ctx;
        var cw = this._canvas.width;
        var ch = this._canvas.height;
        var vw = video.videoWidth;
        var vh = video.videoHeight;

        if (vw > 0 && vh > 0 && cw > 0 && ch > 0) {
          // Cover-fit：取较大缩放比，保证铺满
          var scale = Math.max(cw / vw, ch / vh);
          var dw = vw * scale;
          var dh = vh * scale;
          var dx = (cw - dw) / 2;
          var dy = (ch - dh) / 2;
          ctx.drawImage(video, dx, dy, dw, dh);
        }
      }

      this._rafId = requestAnimationFrame(this._render);
    },

    _startRender: function () {
      if (this._rafId !== null) return;
      this._rafId = requestAnimationFrame(this._render);
    },

    _stopRender: function () {
      if (this._rafId !== null) {
        cancelAnimationFrame(this._rafId);
        this._rafId = null;
      }
    },
  };
})();
