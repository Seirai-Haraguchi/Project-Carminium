(function () {
  'use strict';

  window.VideoBackground = VideoBackground;

  var VIDEO_TYPE_THRESHOLD_SEC = 30;

  function VideoBackground(bgElement) {
    this._bg = bgElement;

    var video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.crossOrigin = 'anonymous';
    video.style.display = 'none';
    video.setAttribute('aria-hidden', 'true');
    document.body.appendChild(video);
    this._video = video;

    var canvas = document.createElement('canvas');
    canvas.className = 'np-bg-video';
    this._canvas = canvas;
    this._ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });

    var overlay = document.createElement('div');
    overlay.className = 'np-bg-video-overlay';
    this._overlay = overlay;

    bgElement.insertBefore(overlay, bgElement.firstChild);
    bgElement.insertBefore(canvas, bgElement.firstChild);

    this._enabled = false;
    this._active = false;
    this._videoType = null;
    this._songDurationMs = 0;
    this._isPlaying = false;
    this._rafId = null;
    this._videoFrameCallbackId = null;
    this._useVideoFrameCallback = typeof video.requestVideoFrameCallback === 'function';
    this._gen = 0;
    this._currentVideoUrl = null;

    this._onResize = this._onResize.bind(this);
    this._render = this._render.bind(this);
    this._onMetadataLoaded = this._onMetadataLoaded.bind(this);
    this._onVideoError = this._onVideoError.bind(this);

    video.addEventListener('loadedmetadata', this._onMetadataLoaded);
    video.addEventListener('error', this._onVideoError);

    this._resizeObserver = new ResizeObserver(this._onResize);
    this._resizeObserver.observe(bgElement);
  }

  VideoBackground.prototype = {
    constructor: VideoBackground,


    setEnabled: function (enabled) {
      this._enabled = !!enabled;
      if (!this._enabled) this.clear();
    },

    getActive: function () { return this._active; },

    getVideoType: function () { return this._videoType; },

    load: function (videoUrl, songDurationMs) {
      this._gen++;

      this._resetVideo();

      if (!this._enabled || !videoUrl) {
        this.clear();
        return;
      }

      this._songDurationMs = songDurationMs || 0;
      this._currentVideoUrl = videoUrl;

      this._video.src = videoUrl;
      this._video.load();
    },

    clear: function () {
      this._gen++;
      this._resetVideo();
      this._active = false;
      this._videoType = null;
      this._currentVideoUrl = null;
      this._bg.classList.remove('video-active');
      this._releaseCanvasSurface();
      this._stopRender();
    },

    setPlaying: function (playing) {
      this._isPlaying = !!playing;
      if (!this._active) return;

      var visible = this._isVisible();
      if (this._isPlaying && visible) {
        this._restoreCanvasSurface();
        var p = this._video.play();
        if (p && typeof p.then === 'function') {
          p.catch(function () {  });
        }
        this._startRender();
      } else {
        this._video.pause();
        this._stopRender();
        if (!visible) this._releaseCanvasSurface();
      }
    },

    updatePosition: function (positionMs) {
      if (!this._active || this._videoType !== 'mv') return;

      var video = this._video;
      var videoDuration = video.duration;
      if (!isFinite(videoDuration) || videoDuration <= 0) return;

      var targetSec = positionMs / 1000;

      if (targetSec >= videoDuration) {
        targetSec = targetSec % videoDuration;
      }

      var diff = Math.abs(video.currentTime - targetSec);
      if (diff > 1.5) {
        try { video.currentTime = targetSec; } catch (e) {  }
      }
    },

    onFullscreenChange: function () {
      if (!this._active) return;
      var visible = this._isVisible();
      if (visible && this._isPlaying) {
        this._restoreCanvasSurface();
        var p = this._video.play();
        if (p && typeof p.then === 'function') {
          p.catch(function () {  });
        }
        this._startRender();
      } else {
        this._video.pause();
        this._stopRender();
        if (!visible) this._releaseCanvasSurface();
      }
    },

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


    _onMetadataLoaded: function () {
      var videoDuration = this._video.duration;
      if (!isFinite(videoDuration) || videoDuration <= 0) return;

      this._videoType = videoDuration > VIDEO_TYPE_THRESHOLD_SEC ? 'mv' : 'short';

      var songDurationSec = this._songDurationMs / 1000;
      if (this._videoType === 'mv') {
        this._video.loop = true;
      } else {
        this._video.loop = (songDurationSec > 0 && videoDuration < songDurationSec);
      }

      this._active = true;
      this._bg.classList.add('video-active');
      this._onResize();

      if (this._isPlaying && this._isVisible()) {
        var p = this._video.play();
        if (p && typeof p.then === 'function') {
          p.catch(function () {  });
        }
        this._startRender();
      }
    },

    _onVideoError: function () {
      console.warn('[VideoBackground] Video load error:', this._currentVideoUrl);
      this.clear();
    },

    _resetVideo: function () {
      this._stopRender();
      var video = this._video;
      if (video.src || video.getAttribute('src')) {
        video.removeAttribute('src');
        video.load();
      }
      video.loop = false;
    },

    _isVisible: function () {
      var pane = document.getElementById('now-playing-pane');
      if (!pane) return false;
      return pane.classList.contains('fullscreen') &&
             !pane.classList.contains('collapsed');
    },

    _onResize: function () {
      if (!this._active) return;
      var rect = this._bg.getBoundingClientRect();
      var dpr = 1;
      var w = Math.floor(rect.width * dpr);
      var h = Math.floor(rect.height * dpr);
      if (w > 0 && h > 0) {
        this._canvas.width = w;
        this._canvas.height = h;
      }
    },

    _releaseCanvasSurface: function () {
      if (this._canvas.width !== 1 || this._canvas.height !== 1) {
        this._canvas.width = 1;
        this._canvas.height = 1;
      }
    },

    _restoreCanvasSurface: function () {
      if (this._active) this._onResize();
    },

    _render: function () {
      if (!this._active || !this._isPlaying) {
        this._rafId = null;
        this._videoFrameCallbackId = null;
        return;
      }

      var video = this._video;
      if (video.readyState >= 2) {
        var ctx = this._ctx;
        var cw = this._canvas.width;
        var ch = this._canvas.height;
        var vw = video.videoWidth;
        var vh = video.videoHeight;

        if (vw > 0 && vh > 0 && cw > 0 && ch > 0) {
          var scale = Math.max(cw / vw, ch / vh);
          var dw = vw * scale;
          var dh = vh * scale;
          var dx = (cw - dw) / 2;
          var dy = (ch - dh) / 2;
          ctx.drawImage(video, dx, dy, dw, dh);
        }
      }

      if (this._useVideoFrameCallback) {
        this._videoFrameCallbackId = video.requestVideoFrameCallback(this._render);
      } else {
        this._rafId = requestAnimationFrame(this._render);
      }
    },

    _startRender: function () {
      if (this._rafId !== null || this._videoFrameCallbackId !== null) return;
      if (this._useVideoFrameCallback) {
        this._videoFrameCallbackId = this._video.requestVideoFrameCallback(this._render);
      } else {
        this._rafId = requestAnimationFrame(this._render);
      }
    },

    _stopRender: function () {
      if (this._rafId !== null) {
        cancelAnimationFrame(this._rafId);
        this._rafId = null;
      }
      if (this._videoFrameCallbackId !== null) {
        if (typeof this._video.cancelVideoFrameCallback === 'function') {
          this._video.cancelVideoFrameCallback(this._videoFrameCallbackId);
        }
        this._videoFrameCallbackId = null;
      }
    },
  };
})();
