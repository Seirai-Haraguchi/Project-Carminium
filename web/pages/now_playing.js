(function () {
  'use strict';

  window.App = window.App || {};
  const np = {};
  window.App.nowPlaying = np;

  const els = {
    cover: document.getElementById('np-cover'),
    coverImg: document.getElementById('np-cover-img'),
    coverIcon: document.getElementById('np-cover-icon'),
    title: document.getElementById('np-title'),
    artist: document.getElementById('np-artist'),
    album: document.getElementById('np-album'),
    btnPlay: document.getElementById('btn-play-pause'),
    iconPlay: document.getElementById('play-icon'),
    btnPrev: document.getElementById('btn-prev'),
    btnNext: document.getElementById('btn-next'),
    btnQueue: document.getElementById('btn-queue'),
    btnFullscreen: document.getElementById('btn-fullscreen'),
    btnMoreDropdown: document.getElementById('btn-more-dropdown'),
    dropdownMenu: document.getElementById('split-dropdown-menu'),
    btnTheater: document.getElementById('btn-theater'),
    btnCollapse: document.getElementById('btn-collapse'),
    btnMute: document.getElementById('btn-mute'),
    iconVol: document.getElementById('vol-icon'),
    sliderVol: document.getElementById('volume-slider'),
    labelVol: document.getElementById('vol-label'),
    barWrap: document.getElementById('np-progress-bar'),
    barFill: document.getElementById('np-progress-fill'),
    barThumb: document.getElementById('np-progress-thumb'),
    transitionMarker: document.getElementById('np-transition-label'),
    qualityLabel: document.getElementById('np-quality-label'),
    timeRow: document.querySelector('.np-time-row'),
    timeCur: document.getElementById('np-time-cur'),
    timeDur: document.getElementById('np-time-dur'),
    btnLike: null,
    btnAudioMode: null,
    queueList: document.getElementById('np-queue-list'),
    pivotTabs: document.querySelectorAll('.np-pivot-tab'),
    pivotIndicator: document.getElementById('np-pivot-indicator'),
    contentSegs: document.querySelectorAll('.np-content-seg'),
    panels: document.querySelectorAll('.np-panels .np-panel'),
    miniInfo: document.getElementById('np-mini-info'),
    miniInfoCover: document.getElementById('np-mini-cover'),
    miniInfoCoverImg: document.getElementById('np-mini-cover-img'),
    miniInfoCoverIcon: document.getElementById('np-mini-cover-icon'),
    miniInfoTitle: document.getElementById('np-mini-title'),
    miniInfoArtist: document.getElementById('np-mini-artist'),
    miniCover: document.querySelector('#mini-player .mini-player-cover'),
    miniBtnLike: document.getElementById('mini-btn-like'),
    miniProgressInline: document.getElementById('mini-player-progress-inline'),
    miniProgressSlot: document.getElementById('mini-progress-slot'),
    miniLrc: document.getElementById('mini-lrc'),
    miniProgressBar: document.getElementById('mini-progress-bar'),
    miniProgressTrackFill: document.getElementById('mini-progress-track-fill'),
    miniProgressThumb: document.getElementById('mini-progress-thumb'),
    miniTimeCur: document.getElementById('mini-time-cur'),
    miniTimeDur: document.getElementById('mini-time-dur'),
    miniTimeRem: document.getElementById('mini-time-rem'),
    miniTimeJoinedCur: document.getElementById('mini-time-joined-cur'),
    miniTimeJoinedRem: document.getElementById('mini-time-joined-rem'),
    miniCoverImg: document.getElementById('mini-cover-img'),
    miniCoverIcon: document.getElementById('mini-cover-icon'),
    miniTitle: document.getElementById('mini-title'),
    miniArtist: document.getElementById('mini-artist'),
    miniBtnPlay: document.getElementById('mini-btn-play'),
    miniPlayIcon: document.getElementById('mini-play-icon'),
    miniBtnPrev: document.getElementById('mini-btn-prev'),
    miniBtnNext: document.getElementById('mini-btn-next'),
    miniBtnExpand: document.getElementById('mini-btn-expand'),
    miniPlayer: document.getElementById('mini-player'),
    lyricsWrap: document.getElementById('np-lyrics-wrap'),
    lyrics: document.getElementById('np-lyrics'),
    bgCovers: document.getElementById('np-bg-covers'),
    bgCoverA: document.getElementById('np-bg-cover-a'),
    bgCoverB: document.getElementById('np-bg-cover-b'),
    lyricsToolbar: document.getElementById('np-lyrics-toolbar'),
    lyricsSearchBtn: document.getElementById('np-lyrics-search-btn'),
    lyricsTransBtn: document.getElementById('np-lyrics-trans-btn'),
    lyricsRomajiBtn: document.getElementById('np-lyrics-romaji-btn'),
    lyricsSearchOverlay: document.getElementById('np-lyrics-search-overlay'),
    lyricsSearchInput: document.getElementById('np-lyrics-search-input'),
    lyricsSearchClose: document.getElementById('np-lyrics-search-close'),
    lyricsSearchResults: document.getElementById('np-lyrics-search-results'),
    lyricsSettingsBtn: document.getElementById('np-lyrics-settings-btn'),
    lyricsSettingsPopup: document.getElementById('np-lyrics-settings-popup'),
    lyricsSettingsClose: document.getElementById('np-lyrics-settings-close'),
    lyricsOffsetDec: document.getElementById('np-lyrics-offset-dec'),
    lyricsOffsetInc: document.getElementById('np-lyrics-offset-inc'),
    lyricsOffsetValue: document.getElementById('np-lyrics-offset-value'),
    lyricsFontSizeSlider: document.getElementById('np-lyrics-font-size-slider'),
    lyricsFontSizeValue: document.getElementById('np-lyrics-font-size-value'),
    lyricsBlurToggle: document.getElementById('np-lyrics-blur-toggle'),
    lyricsCenterToggle: document.getElementById('np-lyrics-center-toggle'),
    lyricsJpFontToggle: document.getElementById('np-lyrics-jp-font-toggle'),
    lyricsSource: document.getElementById('np-lyrics-source'),
    lyricsSourceLabel: document.getElementById('np-lyrics-source-label'),
    lyricsSourceArrow: document.getElementById('np-lyrics-source-arrow'),
    lyricsSourceDropdown: document.getElementById('np-lyrics-source-dropdown'),
    lyricsSourceOptions: document.querySelectorAll('.np-lyrics-source-option'),
    secondaryControls: document.getElementById('np-secondary-controls'),
  };

  function _setTitle(el, text) {
    if (!el) return;
    if (window.Marquee) window.Marquee.setText(el, text == null ? '' : text);
    else el.textContent = text == null ? '' : text;
  }

  const NP_SECONDARY_MAX = 5;
  const NP_SECONDARY_DEFAULT = ['shuffle', 'repeat', 'like', 'audio_mode'];

  const NP_SECONDARY_ACTIONS = {
    shuffle: {
      id: 'shuffle', icon: 'shuffle', titleKey: 'np.shuffle', ariaKey: 'np.shuffle',
      onClick: function () { App.backend.set_shuffle(!App.state.shuffle); },
      isActive: function () { return !!App.state.shuffle; },
    },
    repeat: {
      id: 'repeat', icon: 'repeat', titleKey: 'np.repeat', ariaKey: 'np.repeat',
      onClick: function () {
        var mode = 'off';
        if (App.state.repeat === 'off') mode = 'all';
        else if (App.state.repeat === 'all') mode = 'one';
        App.backend.set_repeat(mode);
      },
      isActive: function () { return App.state.repeat === 'all' || App.state.repeat === 'one'; },
    },
    like: {
      id: 'like', icon: 'favorite', titleKey: 'np.like', ariaKey: 'np.like',
      onClick: function () { App.backend.toggle_liked(); },
      isLiked: function () { return !!_isLiked; },
    },
    audio_mode: {
      id: 'audio_mode', variant: 'audio_mode',
      icon: 'speaker', titleKey: 'np.audioMode', ariaKey: 'np.audioMode',
      onClick: function () {
        var btn = els.secondaryControls.querySelector('[data-action="audio_mode"]');
        var currentOn = btn ? btn.classList.contains('active') : false;
        np.openAudioModeDialog(!currentOn);
      },
      isActive: function () { return !!App.state.isExclusive; },
    },
    seek_back_5: {
      id: 'seek_back_5', icon: 'replay', titleKey: 'np.seekBack5', ariaKey: 'np.seekBack5',
      onClick: function () { _seekBy(-5); },
      rotate180: true,
      labels: '5',
    },
    seek_fwd_5: {
      id: 'seek_fwd_5', icon: 'forward', titleKey: 'np.seekFwd5', ariaKey: 'np.seekFwd5',
      onClick: function () { _seekBy(5); },
      labels: '5',
    },
    seek_back_30: {
      id: 'seek_back_30', icon: 'replay', titleKey: 'np.seekBack30', ariaKey: 'np.seekBack30',
      onClick: function () { _seekBy(-30); },
      rotate180: true, labels: '30',
    },
    seek_fwd_30: {
      id: 'seek_fwd_30', icon: 'forward', titleKey: 'np.seekFwd30', ariaKey: 'np.seekFwd30',
      onClick: function () { _seekBy(30); },
      labels: '30',
    },
    audio_settings: {
      id: 'audio_settings', icon: 'graphic_eq', titleKey: 'np.audioSettings', ariaKey: 'np.audioSettings',
      onClick: function () { _openAudioSettings(); },
    },
    mute: {
      id: 'mute', icon: 'volume_up', titleKey: 'np.mute', ariaKey: 'np.mute',
      onClick: function () { _toggleMuteFromNp(); },
      isMuted: function () { return _isMuted; },
    },
    floating: {
      id: 'floating', icon: 'picture_in_picture', titleKey: 'np.floating', ariaKey: 'np.floating',
      onClick: function () { App.backend.toggle_floating_window(); },
    },
    fullscreen: {
      id: 'fullscreen', icon: 'fullscreen', titleKey: 'np.fullView', ariaKey: 'np.fullView',
      onClick: function () { _toggleFullscreen(); },
    },
  };

let duration = 0;
let isSeeking = false;
let lyricsData = [];
let lastLyricsIdx = -1;
// 同唱分组：时间区间重叠的行（主唱+和声/对唱叠唱）归入同组，同时点亮
let lineGroups = [];
let groupOfLine = [];
// 滚动以组为单位：组内行推进不滚动，整组亮完滚到下一组锚点
let lastGroupIdx = -1;
let _lyricsTrackId = null;
let _lastKnownPositionMs = 0;
let _lyricLineEls = null;
  let lyricsRaf = null;

  const INTERLUDE_MIN_GAP = 4000;
  const INTERLUDE_END_LEAD = 250;
  const IL_BREATHE_TARGET = 1500;
  const IL_ENTRANCE = 2000;
  const IL_ENTRANCE_DELAY = 500;
  const IL_ENTRANCE_FADE = 500;
  const IL_EXIT = 750;
  const IL_EXIT_FADE = 375;
  let interludes = [];
  let _activeInterlude = null;
  let _interludeExiting = false;
  let _interludeExitEl = null;
  let _interludeExitHeight = 0;
  let _interludeExitLineTop = null;
  let _interludeScrollTimer = 0;
  let _ilRafId = 0;
  let lyricFontSettings = {
    lyrics_font: "",
    lyrics_jp_font: "",
    lyrics_jp_use_distinct: true,
  };
  let progressiveBlurEnabled = false;
  let lyricsCentered = false;
  // 对唱歌词（≥2 个歌手）：强制左右分侧，暂停居中排版设置
  let _lyricsIsDuet = false;
  let lyricsFontSize = 16;
  let circularCover = false;
  let waveProgress = true;
  let lyricsCreditFilters = '';
  // 正在播放页背景模式：'cover' = 专辑图混色模糊，'solid' = 纯色（与其他页面一致）
  let npBackgroundMode = 'cover';


  let _npDefaultView = 'side';

  let _secondaryActionIds = NP_SECONDARY_DEFAULT.slice();
  let _isLiked = false;
  let _isMuted = false;
  let _secondaryControlsBound = false;

  let _npContentMode = 'duo';

  let lyricsShowTranslation = true;
  let lyricsShowRomaji = true;
  let lyricsSearchGen = 0;
  let lyricsSearchDebounce = null;
  let _autoSearchGen = 0;

  let lyricsTimeOffset = 0;

  let lyricsSource = null;
  let _pendingLyricsSource = null;
  let lyricsSearchSource = 'ncm';
  let _hasEmbeddedLyrics = false;

  let _bgActiveA = true;
  let _bgGen = 0;

  let _trackInfoHidden = false;
  let _glitchDuration = 700;
  let _glitchCleanupTimer = null;
  let _needsGlitchRestore = false;
  let _preserveHiddenState = false;

  var _videoBg = null;
  var _videoBgEnabled = false;
  var _videoBgGen = 0;

  var _beatRafId = 0;
  var _beatBpm = 0;
  var _beatIntervalMs = 500;
  var _beatLastPos = -1;
  var _beatPulse = 0;
  var _beatSpecBass = 0;
  var _beatSpecMid = 0;
  var _beatSpecTreble = 0;
  var _beatLocalBaseTime = 0;
  var _beatLocalBasePos = 0;

  function _beatUpdatePosition(ms) {
    var engine = App.audioEngine;
    var now = engine && engine._ctx ? engine._ctx.currentTime : 0;
    if (!isSeeking && App.state.playbackState === 'playing' && _beatLocalBaseTime > 0) {
      var interpolated = _beatLocalBasePos + (now - _beatLocalBaseTime) * 1000;
      if (ms < interpolated && interpolated - ms < 200) {
        return;
      }
    }
    _beatLocalBaseTime = now;
    _beatLocalBasePos = ms;
  }

  function _beatGetPrecisePosition() {
    var engine = App.audioEngine;
    if (!engine || !engine._ctx) return _beatLocalBasePos;
    var rate = (engine._currentSource && engine._currentSource.playbackRate)
      ? engine._currentSource.playbackRate.value : 1.0;
    var elapsed = (engine._ctx.currentTime - _beatLocalBaseTime) * 1000 * rate;
    return _beatLocalBasePos + elapsed;
  }

  np.getPrecisePosition = _beatGetPrecisePosition;

  function _startBeatLoop() {
    if (_beatRafId) return;
    _beatBpm = 0;
    _beatLastPos = -1;
    _beatPulse = 0;
    _beatSpecBass = 0;
    _beatSpecMid = 0;
    _beatSpecTreble = 0;
    _beatRafId = requestAnimationFrame(_beatLoopTick);
  }

  function _stopBeatLoop() {
    if (_beatRafId) {
      cancelAnimationFrame(_beatRafId);
      _beatRafId = 0;
    }
    var pane = document.getElementById('now-playing-pane');
    if (pane) {
      pane.style.removeProperty('--beat-scale');
      pane.style.removeProperty('--beat-surge');
    }
    _beatBpm = 0;
    _beatPulse = 0;
    _beatSpecBass = 0;
    _beatSpecMid = 0;
    _beatSpecTreble = 0;
  }

  function _beatLoopTick() {
    _beatRafId = 0;

    var pane = document.getElementById('now-playing-pane');
    if (!pane || !pane.classList.contains('fullscreen')) {
      _stopBeatLoop();
      return;
    }

    if (window.__appFrozen) {
      _beatRafId = requestAnimationFrame(_beatLoopTick);
      return;
    }

    if (pane.classList.contains('video-active')) {
      _beatRafId = requestAnimationFrame(_beatLoopTick);
      return;
    }

    var profiles = App.automix && App.automix.profiles ? App.automix.profiles() : null;
    var currentProfile = profiles && profiles.current;
    var bpm = currentProfile && currentProfile.tempo ? currentProfile.tempo.primary : 0;
    if (bpm !== _beatBpm) {
      _beatBpm = bpm;
      _beatIntervalMs = bpm > 0 ? (60000 / bpm) : 500;
    }

    var pos = _beatGetPrecisePosition();
    if (_beatLastPos >= 0 && (_beatLastPos > pos + 100 || pos - _beatLastPos > 5000)) {
      _beatPulse = 0;
    }
    _beatLastPos = pos;

    var bpmPulse;
    if (bpm > 0) {
      var beatPhase = (pos % _beatIntervalMs) / _beatIntervalMs;
      bpmPulse = Math.max(0, Math.cos(beatPhase * Math.PI));
      bpmPulse = Math.pow(bpmPulse, 0.6);
    } else {
      var breathPhase = (Date.now() % 3000) / 3000;
      bpmPulse = 0.3 + (Math.sin(breathPhase * Math.PI * 2) + 1) * 0.15;
    }

    var engine = App.audioEngine;
    var beat = engine ? engine.getBeatData() : null;
    var specBass = 0, specMid = 0, specTreble = 0;
    if (beat) {
      var aR = 0.42, rR = 0.04;
      _beatSpecBass = _beatSpecBass + (beat.bass - _beatSpecBass) * (beat.bass > _beatSpecBass ? aR : rR);
      _beatSpecMid = _beatSpecMid + (beat.mid - _beatSpecMid) * (beat.mid > _beatSpecMid ? aR * 0.8 : rR * 1.5);
      _beatSpecTreble = _beatSpecTreble + (beat.treble - _beatSpecTreble) * (beat.treble > _beatSpecTreble ? aR * 0.6 : rR * 2.0);
      specBass = _beatSpecBass;
      specMid = _beatSpecMid;
      specTreble = _beatSpecTreble;
    }

    var combinedPulse;
    if (beat && beat.level > 0.01) {
      var specEnergy = specBass * 0.7 + specMid * 0.2 + specTreble * 0.1;
      var specContribution = specEnergy * 0.55;
      var beatContribution = bpmPulse * (0.3 + specEnergy * 0.5) * 0.45;
      combinedPulse = Math.min(1, specContribution + beatContribution);
    } else {
      combinedPulse = bpmPulse * 0.5;
    }

    var smoothRate = combinedPulse > _beatPulse ? 0.5 : 0.05;
    _beatPulse = _beatPulse + (combinedPulse - _beatPulse) * smoothRate;

    var scale = 1 + _beatPulse * 0.07;
    var surge = Math.min(0.9, specMid * 0.75 + specTreble * 0.45 + _beatPulse * 0.25);

    pane.style.setProperty('--beat-scale', scale.toFixed(4));
    pane.style.setProperty('--beat-surge', surge.toFixed(3));

    _beatRafId = requestAnimationFrame(_beatLoopTick);
  }

  function _loadLyricFontSettings() {
    if (!App.utils.call) return;
    App.utils.call('get_settings').then(function (res) {
      try {
        const s = JSON.parse(res);
        lyricFontSettings = {
          lyrics_font: s.lyrics_font || "",
          lyrics_jp_font: s.lyrics_jp_font || "",
          lyrics_jp_use_distinct: s.lyrics_jp_use_distinct !== false,
        };
        progressiveBlurEnabled = !!s.lyrics_progressive_blur;
        var wrap = document.getElementById('np-lyrics-wrap');
        if (wrap) wrap.classList.toggle('progressive-blur', progressiveBlurEnabled);
        lyricsCentered = !!s.lyrics_center;
        lyricsFontSize = parseInt(s.lyrics_font_size, 10) || 16;
        circularCover = !!s.circular_cover;
        waveProgress = s.wave_progress !== false;
        lyricsCreditFilters = s.lyrics_credit_filters || '';
        _npDefaultView = s.np_default_view || 'side';
        if (s.np_content_mode) setContentMode(s.np_content_mode, false);
        _videoBgEnabled = !!s.video_background;
        if (_videoBg) _videoBg.setEnabled(_videoBgEnabled);
        _miniLyricsEnabled = s.mini_player_lyrics !== false;
        npBackgroundMode = s.np_background_mode === 'solid' ? 'solid' : 'cover';
        _applyBackgroundModeClass();
        _applyLyricsLayout();
        _applyCircularCoverClass();
        _applyWaveProgressClass();
        if (els.lyricsBlurToggle) els.lyricsBlurToggle.checked = progressiveBlurEnabled;
        if (els.lyricsCenterToggle) els.lyricsCenterToggle.checked = lyricsCentered;
        if (els.lyricsJpFontToggle) els.lyricsJpFontToggle.checked = lyricFontSettings.lyrics_jp_use_distinct !== false;
        if (els.lyricsFontSizeSlider) els.lyricsFontSizeSlider.value = lyricsFontSize;
        if (els.lyricsFontSizeValue) els.lyricsFontSizeValue.textContent = lyricsFontSize + 'px';
        if (App.state && App.state.currentTrack) {
          _renderLyrics(App.state.currentTrack);
        }
      } catch (e) {
      }
    });
  }

  var BG_BLUR_SOURCE_MAX = 192;
  var BG_BAKE_BLUR = 8;
  var BG_BAKE_JPEG_QUALITY = 0.7;
  var BG_BLUR_CACHE_LIMIT = 8;
  var _bgBlurSourceCache = new Map();

  function _clearBgBlurSourceCache() {
    _bgBlurSourceCache.clear();
  }

  function _buildBgBlurSource(url) {
    var cached = _bgBlurSourceCache.get(url);
    if (cached) return Promise.resolve(cached);
    return new Promise(function (resolve) {
      var img = new Image();
      img.crossOrigin = 'anonymous';
      img.decoding = 'async';
      img.onload = function () {
        try {
          var nw = img.naturalWidth || img.width;
          var nh = img.naturalHeight || img.height;
          if (!nw || !nh) { resolve({ base: url, surge: url }); return; }
          var scale = Math.min(1, BG_BLUR_SOURCE_MAX / Math.max(nw, nh));
          var w = Math.max(1, Math.round(nw * scale));
          var h = Math.max(1, Math.round(nh * scale));
          var src = document.createElement('canvas');
          src.width = w;
          src.height = h;
          var sctx = src.getContext('2d');
          if (!sctx) { resolve({ base: url, surge: url }); return; }
          sctx.imageSmoothingEnabled = true;
          sctx.imageSmoothingQuality = 'low';
          sctx.drawImage(img, 0, 0, w, h);
          var pad = Math.ceil(BG_BAKE_BLUR * 3);
          function bake(filter) {
            var c = document.createElement('canvas');
            c.width = w;
            c.height = h;
            var ctx = c.getContext('2d');
            if (!ctx) return null;
            ctx.filter = filter;
            ctx.drawImage(src, -pad, -pad, w + pad * 2, h + pad * 2);
            return c.toDataURL('image/jpeg', BG_BAKE_JPEG_QUALITY);
          }
          var base = bake('blur(' + BG_BAKE_BLUR + 'px) saturate(1.6) brightness(1.05)');
          var surge = bake('blur(' + BG_BAKE_BLUR + 'px) saturate(2.5) brightness(1.28)');
          var result = (base && surge) ? { base: base, surge: surge } : { base: url, surge: url };
          if (_bgBlurSourceCache.size >= BG_BLUR_CACHE_LIMIT) {
            _bgBlurSourceCache.delete(_bgBlurSourceCache.keys().next().value);
          }
          _bgBlurSourceCache.set(url, result);
          resolve(result);
        } catch (e) {
          resolve({ base: url, surge: url });
        }
      };
      img.onerror = function () { resolve(null); };
      img.src = url;
    });
  }

  var _bgFadeClearTimer = null;
  function _markBgFading(next, prev) {
    if (_bgFadeClearTimer) { clearTimeout(_bgFadeClearTimer); _bgFadeClearTimer = null; }
    next.classList.add('fading');
    prev.classList.add('fading');
    var done = function () {
      next.classList.remove('fading');
      prev.classList.remove('fading');
      next.removeEventListener('transitionend', onEnd);
      if (_bgFadeClearTimer) { clearTimeout(_bgFadeClearTimer); _bgFadeClearTimer = null; }
    };
    var onEnd = function (e) { if (e.propertyName === 'opacity') done(); };
    next.addEventListener('transitionend', onEnd);
    _bgFadeClearTimer = setTimeout(done, 1800);
  }

  function _setBgCover(url, fallbackColor) {
    if (!els.bgCoverA || !els.bgCoverB) return;
    var gen = ++_bgGen;
    var next = _bgActiveA ? els.bgCoverB : els.bgCoverA;
    var prev = _bgActiveA ? els.bgCoverA : els.bgCoverB;

    function reveal() {
      if (gen !== _bgGen) return;
      _markBgFading(next, prev);
      next.classList.add('active');
      prev.classList.remove('active');
      _bgActiveA = !_bgActiveA;
    }

    if (url) {
      _buildBgBlurSource(url).then(function (bgUrls) {
        if (gen !== _bgGen) return;
        if (bgUrls) {
          next.style.setProperty('--cover-image-base', 'url("' + bgUrls.base + '")');
          next.style.setProperty('--cover-image-surge', 'url("' + bgUrls.surge + '")');
          next.style.removeProperty('--cover-color');
        } else {
          next.style.removeProperty('--cover-image-base');
          next.style.removeProperty('--cover-image-surge');
          next.style.setProperty('--cover-color', fallbackColor || 'var(--md-surface-container-low)');
        }
        reveal();
      });
    } else if (fallbackColor) {
      next.style.removeProperty('--cover-image-base');
      next.style.removeProperty('--cover-image-surge');
      next.style.setProperty('--cover-color', fallbackColor);
      reveal();
    } else {
      els.bgCoverA.classList.remove('active');
      els.bgCoverB.classList.remove('active');
      _bgActiveA = true;
    }
  }

  function _setBgMotionPlaying(playing) {
    if (!els.bgCovers) return;
    if (playing) {
      els.bgCovers.classList.remove('paused');
    } else {
      els.bgCovers.classList.add('paused');
    }
  }

  var _coverRate = 1.0;
  var _rateBadgeTimer = null;

  function _showRateBadge(rate) {
    var badge = document.getElementById('np-cover-rate');
    if (!badge) return;
    badge.textContent = String(Math.round(rate * 100) / 100) + '×';
    badge.classList.add('show');
    if (_rateBadgeTimer) clearTimeout(_rateBadgeTimer);
    _rateBadgeTimer = setTimeout(function () {
      badge.classList.remove('show');
    }, rate === 1.0 ? 800 : 1500);
  }

  function _adjustCoverRate(delta) {
    var next = Math.max(0.5, Math.min(2.0, Math.round((_coverRate + delta) * 100) / 100));
    if (Math.abs(next - _coverRate) < 0.001) {
      _showRateBadge(next);
      return;
    }
    _coverRate = next;
    var engine = App.audioEngine;
    if (engine) engine.setUserRate(next);
    App.backend.set_rate(next);
    _showRateBadge(next);
  }

  function _initCoverRateControl() {
    var cover = els.cover;
    if (!cover) return;

    cover.addEventListener('wheel', function (e) {
      e.preventDefault();
      var step = e.shiftKey ? 0.01 : 0.05;
      _adjustCoverRate(e.deltaY < 0 ? step : -step);
    }, { passive: false });

    var touchY = 0, accum = 0;
    var TOUCH_THRESHOLD = 24;
    cover.addEventListener('touchstart', function (e) {
      if (e.touches.length === 1) { touchY = e.touches[0].clientY; accum = 0; }
    }, { passive: true });
    cover.addEventListener('touchmove', function (e) {
      if (e.touches.length !== 1) return;
      e.preventDefault();
      var dy = touchY - e.touches[0].clientY;
      touchY = e.touches[0].clientY;
      accum += dy;
      while (accum >= TOUCH_THRESHOLD) { _adjustCoverRate(0.05); accum -= TOUCH_THRESHOLD; }
      while (accum <= -TOUCH_THRESHOLD) { _adjustCoverRate(-0.05); accum += TOUCH_THRESHOLD; }
    }, { passive: false });

    cover.addEventListener('dblclick', function () {
      if (_coverRate !== 1.0) {
        _coverRate = 1.0;
        var engine = App.audioEngine;
        if (engine) engine.setUserRate(1.0);
        App.backend.set_rate(1.0);
        _showRateBadge(1.0);
      }
    });
  }

  np.init = function () {
    _loadLyricFontSettings();

    // 音质标识的文字随界面语言变化
    if (!_qualityI18nBound && App.i18n && App.i18n.onChange) {
      _qualityI18nBound = true;
      App.i18n.onChange(function () { _renderQuality(); });
    }

    if (window.Marquee) {
      window.Marquee.bind(els.title);
      window.Marquee.bind(els.miniTitle);
      if (els.miniInfoTitle) window.Marquee.bind(els.miniInfoTitle);
    }

    var bgEl = document.querySelector('.np-bg');
    if (bgEl && window.VideoBackground) {
      _videoBg = new window.VideoBackground(bgEl);
      _videoBg.setEnabled(_videoBgEnabled);
    }
    _initCoverRateControl();
    els.btnPlay.addEventListener('click', function () {
      if (App.state.playbackState === 'playing') {
        App.backend.pause();
      } else {
        App.backend.play();
      }
    });

    els.btnPrev.addEventListener('click', () => App.backend.prev_track());
    els.btnNext.addEventListener('click', () => App.backend.next_track());

    _bindSecondaryControls();
    np.renderSecondaryActions(_secondaryActionIds);

    els.pivotTabs.forEach(function (tab) {
      tab.addEventListener('click', function () {
        var target = tab.getAttribute('data-tab');
        switchTab(target);
      });
    });
    requestAnimationFrame(function () {
      updatePivotIndicator();
    });
    window.addEventListener('resize', updatePivotIndicator);

    els.contentSegs.forEach(function (seg) {
      seg.addEventListener('click', function () {
        setContentMode(seg.getAttribute('data-mode'));
      });
    });

    els.btnFullscreen.addEventListener('click', function () {
      _toggleFullscreen();
    });

    els.btnMoreDropdown.addEventListener('click', function (e) {
      e.stopPropagation();
      const isOpen = els.dropdownMenu.style.display !== 'none';
      if (isOpen) {
        _closeDropdown();
      } else {
        _openDropdown();
      }
    });

    document.addEventListener('click', function (e) {
      if (!e.target.closest('.split-button')) {
        _closeDropdown();
      }
    });

    els.btnTheater.addEventListener('click', function () {
      _closeDropdown();
      _toggleTheater();
    });

    els.btnCollapse.addEventListener('click', function () {
      _closeDropdown();
      _toggleCollapse();
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        var pane = document.getElementById('now-playing-pane');
        if (pane && pane.classList.contains('theater')) {
          _exitTheater();
        }
      }
    });

    els.miniBtnPlay.addEventListener('click', function () {
      if (App.state.playbackState === 'playing') {
        App.backend.pause();
      } else {
        App.backend.play();
      }
    });
    els.miniBtnPrev.addEventListener('click', function () {
      App.backend.prev_track();
    });
    els.miniBtnNext.addEventListener('click', function () {
      App.backend.next_track();
    });
    if (els.miniBtnExpand) {
      els.miniBtnExpand.addEventListener('click', function () {
        _toggleCollapse();
      });
    }

    if (typeof MutationObserver !== 'undefined' && document.body) {
      new MutationObserver(function () {
        _miniLrcResync();
      }).observe(document.body, { attributes: true, attributeFilter: ['class'] });
    }

    if (els.miniProgressBar) {
      els.miniProgressBar.addEventListener('click', function (e) {
        if (!duration) return;
        var rect = els.miniProgressBar.getBoundingClientRect();
        var pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        if (els.miniProgressTrackFill) els.miniProgressTrackFill.style.width = (pct * 100) + '%';
        if (els.miniProgressThumb) els.miniProgressThumb.style.left = (pct * 100) + '%';
        if (els.miniProgressBar) els.miniProgressBar.style.setProperty('--progress-val', (pct * 100) + '%');
        App.backend.seek(Math.floor(pct * duration));
      });
    }

    els.barWrap.addEventListener('mousedown', function (e) {
      if (!duration) return;
      isSeeking = true;
      _updateSeek(e);
      document.addEventListener('mousemove', _onSeekMove);
      document.addEventListener('mouseup', _onSeekUp);
    });

    els.sliderVol.addEventListener('input', function (e) {
      const val = parseInt(e.target.value, 10);
      App.backend.set_volume(val);

      const max = parseInt(e.target.max, 10) || 100;
      const percentage = (val / max) * 100;
      e.target.style.setProperty('--volume-val', `${percentage}%`);
    });

    if (els.miniBtnLike) {
      els.miniBtnLike.addEventListener('click', function () {
        App.backend.toggle_liked();
      });
    }

    if (els.lyricsSearchBtn) {
      els.lyricsSearchBtn.addEventListener('click', function () {
        _openLyricsSearch();
      });
    }
    if (els.lyricsTransBtn) {
      els.lyricsTransBtn.addEventListener('click', function () {
        lyricsShowTranslation = !lyricsShowTranslation;
        els.lyricsTransBtn.classList.toggle('active', lyricsShowTranslation);
        els.lyricsWrap.classList.toggle('hide-translation', !lyricsShowTranslation);
      });
    }
    if (els.lyricsRomajiBtn) {
      els.lyricsRomajiBtn.addEventListener('click', function () {
        lyricsShowRomaji = !lyricsShowRomaji;
        els.lyricsRomajiBtn.classList.toggle('active', lyricsShowRomaji);
        els.lyricsWrap.classList.toggle('hide-romaji', !lyricsShowRomaji);
      });
    }
    if (els.lyricsWrap) {
      els.lyricsWrap.addEventListener('mousedown', _onLyricsPress);
      els.lyricsWrap.addEventListener('touchstart', _onLyricsPress, { passive: true });
      els.lyricsWrap.addEventListener('click', _onLyricsClick);
    }
    if (els.lyricsSearchClose) {
      els.lyricsSearchClose.addEventListener('click', function () {
        _closeLyricsSearch();
      });
    }
    if (els.lyricsSearchOverlay) {
      els.lyricsSearchOverlay.addEventListener('click', function (e) {
        if (e.target === els.lyricsSearchOverlay) {
          _closeLyricsSearch();
        }
      });
    }
    if (els.lyricsSearchInput) {
      els.lyricsSearchInput.addEventListener('input', function () {
        if (lyricsSearchDebounce) clearTimeout(lyricsSearchDebounce);
        lyricsSearchDebounce = setTimeout(function () {
          _performLyricsSearch(els.lyricsSearchInput.value.trim());
        }, 400);
      });
      els.lyricsSearchInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          if (lyricsSearchDebounce) clearTimeout(lyricsSearchDebounce);
          _performLyricsSearch(els.lyricsSearchInput.value.trim());
        } else if (e.key === 'Escape') {
          _closeLyricsSearch();
        }
      });
    }

    if (els.lyricsSettingsBtn) {
      els.lyricsSettingsBtn.addEventListener('click', function () {
        if (els.lyricsSettingsPopup && els.lyricsSettingsPopup.style.display !== 'none') {
          _closeLyricsSettings();
        } else {
          _openLyricsSettings();
        }
      });
    }
    if (els.lyricsSettingsClose) {
      els.lyricsSettingsClose.addEventListener('click', function () {
        _closeLyricsSettings();
      });
    }
    if (els.lyricsOffsetDec) {
      els.lyricsOffsetDec.addEventListener('click', function () {
        lyricsTimeOffset -= 200;
        if (lyricsTimeOffset < -10000) lyricsTimeOffset = -10000;
        _updateOffsetDisplay();
      });
    }
    if (els.lyricsOffsetInc) {
      els.lyricsOffsetInc.addEventListener('click', function () {
        lyricsTimeOffset += 200;
        if (lyricsTimeOffset > 10000) lyricsTimeOffset = 10000;
        _updateOffsetDisplay();
      });
    }
    if (els.lyricsFontSizeSlider) {
      els.lyricsFontSizeSlider.addEventListener('input', function () {
        var val = parseInt(els.lyricsFontSizeSlider.value, 10);
        lyricsFontSize = val;
        if (els.lyricsFontSizeValue) els.lyricsFontSizeValue.textContent = val + 'px';
        _applyLyricsLayout();
        App.utils.call('save_settings', JSON.stringify({ lyrics_font_size: val }));
      });
    }
    if (els.lyricsBlurToggle) {
      els.lyricsBlurToggle.addEventListener('change', function () {
        var enabled = els.lyricsBlurToggle.checked;
        progressiveBlurEnabled = enabled;
        var wrap = document.getElementById('np-lyrics-wrap');
        if (wrap) wrap.classList.toggle('progressive-blur', enabled);
        App.utils.call('save_settings', JSON.stringify({ lyrics_progressive_blur: enabled }));
      });
    }
    if (els.lyricsCenterToggle) {
      els.lyricsCenterToggle.addEventListener('change', function () {
        var enabled = els.lyricsCenterToggle.checked;
        lyricsCentered = enabled;
        _applyLyricsLayout();
        App.utils.call('save_settings', JSON.stringify({ lyrics_center: enabled }));
      });
    }
    if (els.lyricsJpFontToggle) {
      els.lyricsJpFontToggle.addEventListener('change', function () {
        var enabled = els.lyricsJpFontToggle.checked;
        lyricFontSettings.lyrics_jp_use_distinct = enabled;
        App.utils.call('save_settings', JSON.stringify({ lyrics_jp_use_distinct: enabled }));
        if (App.state && App.state.currentTrack) {
          _renderLyrics(App.state.currentTrack);
        }
      });
    }

    if (els.lyricsSource) {
      els.lyricsSource.addEventListener('click', function (e) {
        if (e.target.closest('.np-lyrics-source-option')) return;
        e.stopPropagation();
        _toggleSourceDropdown();
      });
    }
    document.addEventListener('click', function (e) {
      if (els.lyricsSource && els.lyricsSource.classList.contains('dropdown-open')) {
        if (!e.target.closest('.np-lyrics-source')) {
          _closeSourceDropdown();
        }
      }
    });
    if (els.lyricsSourceOptions) {
      els.lyricsSourceOptions.forEach(function (opt) {
        opt.addEventListener('click', function (e) {
          e.stopPropagation();
          var source = opt.getAttribute('data-source');
          _selectLyricsSource(source);
          _closeSourceDropdown();
        });
      });
    }

    function _updateOffsetDisplay() {
      if (els.lyricsOffsetValue) {
        var v = lyricsTimeOffset;
        els.lyricsOffsetValue.textContent = (v > 0 ? '+' : '') + v + 'ms';
      }
      _refreshLyricTimeLabels();
    }

    function _openLyricsSettings() {
      if (!els.lyricsSettingsPopup) return;
      els.lyricsSettingsPopup.classList.remove('closing');
      els.lyricsSettingsPopup.style.display = '';
      if (els.lyricsFontSizeSlider) els.lyricsFontSizeSlider.value = lyricsFontSize;
      if (els.lyricsFontSizeValue) els.lyricsFontSizeValue.textContent = lyricsFontSize + 'px';
      if (els.lyricsBlurToggle) els.lyricsBlurToggle.checked = !!progressiveBlurEnabled;
      if (els.lyricsCenterToggle) els.lyricsCenterToggle.checked = !!lyricsCentered;
      if (els.lyricsJpFontToggle) els.lyricsJpFontToggle.checked = lyricFontSettings.lyrics_jp_use_distinct !== false;
      _updateOffsetDisplay();
      if (els.lyricsToolbar) els.lyricsToolbar.classList.add('always-visible');
    }

    function _closeLyricsSettings() {
      if (!els.lyricsSettingsPopup) return;
      els.lyricsSettingsPopup.classList.add('closing');
      setTimeout(function () {
        if (els.lyricsSettingsPopup) {
          els.lyricsSettingsPopup.style.display = 'none';
          els.lyricsSettingsPopup.classList.remove('closing');
        }
      }, 150);
      if (els.lyricsToolbar) els.lyricsToolbar.classList.remove('always-visible');
    }

    function _updateSeek(e) {
      const rect = els.barWrap.getBoundingClientRect();
      let pct = (e.clientX - rect.left) / rect.width;
      pct = Math.max(0, Math.min(1, pct));
      els.barFill.style.width = (pct * 100) + '%';
      els.barThumb.style.left = (pct * 100) + '%';
      els.barWrap.style.setProperty('--progress-val', (pct * 100) + '%');
      els.timeCur.textContent = App.utils.formatDuration(pct * duration);
      els.timeDur.textContent = '-' + App.utils.formatDuration(duration - pct * duration);
    }
    function _onSeekMove(e) { _updateSeek(e); }
    function _onSeekUp(e) {
      document.removeEventListener('mousemove', _onSeekMove);
      document.removeEventListener('mouseup', _onSeekUp);
      isSeeking = false;
      const rect = els.barWrap.getBoundingClientRect();
      let pct = (e.clientX - rect.left) / rect.width;
      pct = Math.max(0, Math.min(1, pct));
      App.backend.seek(Math.floor(pct * duration));
    }
  };

  var _flyGen = 0;
  var _FLY_OUT_EASE = 'cubic-bezier(0.3, 0, 0.8, 0.15)';
  var _FLY_IN_EASE = 'cubic-bezier(0.3, 1.25, 0.44, 1)';

  function _flyItems() {
    return [
      { el: els.cover, delay: 0 },
      { el: els.title, delay: 60 },
      { el: els.artist, delay: 100 },
      { el: els.album, delay: 130 },
      { el: els.miniInfoCover, delay: 0 },
      { el: els.miniInfoTitle, delay: 60 },
      { el: els.miniInfoArtist, delay: 100 },
      { el: els.miniCover, delay: 0 },
      { el: els.miniTitle, delay: 60 },
      { el: els.miniArtist, delay: 100 }
    ].filter(function (it) { return !!it.el; });
  }

  function _playTrackFly(track) {
    var myGen = ++_flyGen;
    var items = _flyItems();

    var outAnims = items.map(function (it) {
      return it.el.animate([
        { transform: 'translateY(0)', opacity: 1 },
        { transform: 'translateY(-32%)', opacity: 0 }
      ], { duration: 170, delay: Math.round(it.delay * 0.4), easing: _FLY_OUT_EASE, fill: 'forwards' });
    });

    Promise.all(outAnims.map(function (a) { return a.finished.catch(function () {}); })).then(function () {
      if (myGen !== _flyGen) return;
      _applyTrack(track);
      items.forEach(function (it) {
        it.el.getAnimations().forEach(function (a) { a.cancel(); });
        it.el.animate([
          { transform: 'translateY(46%)', opacity: 0 },
          { transform: 'translateY(0)', opacity: 1 }
        ], { duration: 430, delay: it.delay, easing: _FLY_IN_EASE, fill: 'backwards' });
      });
    });
  }

  np.updateTrack = function (track) {
    var prevId = np._lastTrackId;
    var isNewTrack = !!track && prevId != null && track.id !== prevId;
    var mystery = _preserveHiddenState || _trackInfoHidden;
    var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (isNewTrack && !mystery && !reduced) {
      _playTrackFly(track);
    } else {
      _applyTrack(track);
    }
  };

  function _applyTrack(track) {
    var wasHidden = _trackInfoHidden;
    if (_preserveHiddenState) {
      _preserveHiddenState = false;
    } else {
      _trackInfoHidden = false;
    }
    if (!track) {
      _setTitle(els.title, App.i18n.t('common.notPlaying'));
      els.artist.textContent = '—';
      els.album.textContent = '';
      els.coverImg.style.display = 'none';
      els.coverIcon.style.display = '';
      els.cover.style.background = 'var(--md-surface-container)';
      els.coverIcon.style.color = 'var(--md-on-surface-variant)';
      if (els.miniProgressTrackFill) els.miniProgressTrackFill.style.width = '0%';
      if (els.miniProgressThumb) els.miniProgressThumb.style.left = '0%';
      if (els.miniProgressBar) els.miniProgressBar.style.setProperty('--progress-val', '0%');
      _setMiniTime('0:00', '0:00');
      _setBgCover(null, null);
      if (_videoBg) _videoBg.clear();
      if (window.CoverCache && np._lastTrackId) {
        window.CoverCache.unpin(np._lastTrackId);
      }
      np._lastTrackId = null;
      lyricsSource = null;
      _hasEmbeddedLyrics = false;
      _updateEmbeddedOptionVisibility();
      _updateLyricsSourceBadge(true);
      _requestQuality(null);
      return;
    }

    if (!_trackInfoHidden && !_needsGlitchRestore) {
      els.title.style.opacity = '1';
      els.artist.style.opacity = '1';
      els.album.style.opacity = '1';
      if (els.miniTitle) els.miniTitle.style.opacity = '1';
      if (els.miniArtist) els.miniArtist.style.opacity = '1';
      if (els.miniInfo) {
        els.miniInfoTitle.style.opacity = '1';
        els.miniInfoArtist.style.opacity = '1';
      }
    }

    const isSameTrack = np._lastTrackId === track.id;
    if (window.CoverCache) {
      if (!isSameTrack && np._lastTrackId) {
        window.CoverCache.unpin(np._lastTrackId);
      }
      window.CoverCache.pin(track.id);
    }
    np._lastTrackId = track.id;

    if (!isSameTrack && els.miniProgressTrackFill) els.miniProgressTrackFill.style.width = '0%';
    if (!isSameTrack && els.miniProgressThumb) els.miniProgressThumb.style.left = '0%';
    if (!isSameTrack && els.miniProgressBar) els.miniProgressBar.style.setProperty('--progress-val', '0%');

    _setTitle(els.title, track.title || App.i18n.t('common.unknownTrack'));
    els.artist.textContent = track.artist || App.i18n.t('common.unknownArtist');
    els.album.textContent = track.album || '';
    
    if (track.has_cover) {
      if (!isSameTrack || els.coverImg.style.display === 'none') {
        els.coverImg.onload = function() {
          if (App.state.monetSource !== 'system_wallpaper') {
            const rgb = App.utils.extractDominantColor(els.coverImg);
            App.utils.applyDynamicTheme(rgb);
            App.state.currentDominantRgb = rgb;
          } else {
          }
          els.cover.style.background = '';
        };
        els.coverImg.onerror = function() {
          els.coverImg.style.display = 'none';
          els.coverIcon.style.display = '';
          els.cover.style.background = App.utils.hashColor(track.album || track.title);
          els.coverIcon.style.color = 'rgba(255,255,255,0.9)';
          App.utils.applyDynamicTheme(null);
          App.state.currentDominantRgb = null;
          _setBgCover(null, App.utils.hashColor(track.album || track.title));
        };
        App.utils.loadCover(els.coverImg, track.id, 800);
      }
      els.coverImg.style.display = '';
      els.coverIcon.style.display = 'none';
      _setBgCover(window.coverUrl ? window.coverUrl(track.id, 384) : null, null);
    } else {
      els.coverImg.style.display = 'none';
      els.coverIcon.style.display = '';
      els.cover.style.background = App.utils.hashColor(track.album || track.title);
      els.coverIcon.style.color = 'rgba(255,255,255,0.9)';
      App.utils.applyDynamicTheme(null);
      App.state.currentDominantRgb = null;
      _setBgCover(null, App.utils.hashColor(track.album || track.title));
    }
    _isLiked = false;
    _syncSecondaryActions();

    if (!track) {
      _setTitle(els.miniTitle, App.i18n.t('common.notPlaying'));
      els.miniArtist.textContent = '—';
      els.miniCoverImg.style.display = 'none';
      els.miniCoverIcon.style.display = '';
    } else {
      _setTitle(els.miniTitle, track.title || App.i18n.t('common.unknownTrack'));
      els.miniArtist.textContent = track.artist || App.i18n.t('common.unknownArtist');
      if (track.has_cover) {
        if (!isSameTrack || els.miniCoverImg.style.display === 'none') {
          els.miniCoverImg.onerror = function() {
            els.miniCoverImg.style.display = 'none';
            els.miniCoverIcon.style.display = '';
          };
          App.utils.loadCover(els.miniCoverImg, track.id, 128);
        }
        els.miniCoverImg.style.display = '';
        els.miniCoverIcon.style.display = 'none';
      } else {
        els.miniCoverImg.style.display = 'none';
        els.miniCoverIcon.style.display = '';
      }
    }

    if (!track) {
      if (els.miniInfo) {
        _setTitle(els.miniInfoTitle, App.i18n.t('common.notPlaying'));
        els.miniInfoArtist.textContent = '—';
        els.miniInfoCoverImg.style.display = 'none';
        els.miniInfoCoverIcon.style.display = '';
      }
    } else {
      if (els.miniInfo) {
        _setTitle(els.miniInfoTitle, track.title || App.i18n.t('common.unknownTrack'));
        els.miniInfoArtist.textContent = track.artist || App.i18n.t('common.unknownArtist');
        if (track.has_cover) {
          if (!isSameTrack || els.miniInfoCoverImg.style.display === 'none') {
            els.miniInfoCoverImg.onerror = function() {
              els.miniInfoCoverImg.style.display = 'none';
              els.miniInfoCoverIcon.style.display = '';
            };
            App.utils.loadCover(els.miniInfoCoverImg, track.id, 128);
          }
          els.miniInfoCoverImg.style.display = '';
          els.miniInfoCoverIcon.style.display = 'none';
        } else {
          els.miniInfoCoverImg.style.display = 'none';
          els.miniInfoCoverIcon.style.display = '';
        }
      }
    }

    if (_videoBg) {
      if (track.source !== 'subsonic') {
        var vgen = ++_videoBgGen;
        App.utils.call('find_video_for_track', track.id).then(function (result) {
          if (vgen !== _videoBgGen) return;
          if (result && result.url) {
            _videoBg.load(result.url, track.duration_ms);
          } else {
            _videoBg.clear();
          }
        });
      } else {
        _videoBg.clear();
      }
    }

    _pendingLyricsSource = null;
    if (track.lyrics) {
      lyricsSource = 'embedded';
      _hasEmbeddedLyrics = true;
    } else {
      lyricsSource = null;
      _hasEmbeddedLyrics = false;
      _checkEmbeddedLyrics(track);
    }
    _updateEmbeddedOptionVisibility();
    _renderLyrics(track);

    if (wasHidden || _needsGlitchRestore) {
      _needsGlitchRestore = false;
      _animateGlitch(false);
      _setMysteryVisuals(false);
    }

    _requestQuality(track);
  }

  function _buildInterludeEl(start, end, lineIdx, nextStart) {
    var el = document.createElement('div');
    el.className = 'np-lyrics-interlude';
    var dotsWrap = document.createElement('div');
    dotsWrap.className = 'np-il-dots';
    var dots = [];
    for (var d = 0; d < 3; d++) {
      var dot = document.createElement('span');
      dot.className = 'np-il-dot';
      dotsWrap.appendChild(dot);
      dots.push(dot);
    }
    el.appendChild(dotsWrap);
    if (isFinite(nextStart)) el.dataset.nextTime = String(nextStart);
    return { start: start, end: end, nextStart: nextStart, lineIdx: lineIdx, el: el, wrap: dotsWrap, dots: dots };
  }

  function _getLyricLineEls() {
    if (!_lyricLineEls) {
      _lyricLineEls = els.lyricsWrap
        ? els.lyricsWrap.querySelectorAll('.np-lyrics-line')
        : [];
    }
    return _lyricLineEls;
  }

  function _renderLyrics(track) {
    lyricsData = [];
    lastLyricsIdx = -1;
    lastGroupIdx = -1;
    _lyricLineEls = null;
    _miniLrcClear();
    lyricsTimeOffset = 0;
    _lyricsTrackId = track ? track.id : null;
    interludes = [];
    _activeInterlude = null;
    _interludeExiting = false;
    _interludeExitEl = null;
    _interludeExitHeight = 0;
    _interludeExitLineTop = null;
    if (_interludeScrollTimer) { clearTimeout(_interludeScrollTimer); _interludeScrollTimer = 0; }
    _stopInterludeRaf();
    _clearWordAnim();
    _lyricsIsDuet = false;
    lineGroups = [];
    groupOfLine = [];
    _applyLyricsLayout();

    if (!els.lyrics) return;
    els.lyrics.innerHTML = '';
    App.utils.cancelLyricsScroll(els.lyricsWrap);
    els.lyricsWrap.scrollTop = 0;

    if (!track || !track.lyrics) {
      if (track && !track.lyrics) {
        els.lyrics.innerHTML =
          '<div class="np-lyrics-placeholder lyrics-searching">' +
            '<span class="material-symbols-rounded">progress_activity</span>' +
            '<p>' + App.i18n.t('np.searchingLyrics') + '</p>' +
          '</div>';
        _autoSearchLyrics(track);
      } else {
        els.lyrics.innerHTML =
          '<div class="np-lyrics-placeholder">' +
            '<span class="material-symbols-rounded">lyrics</span>' +
            '<p>' + App.i18n.t('np.noLyrics') + '</p>' +
          '</div>';
      }
      _updateLyricsToggleVisibility();
      _updateLyricsSourceBadge();
      return;
    }

    const hasJapanese = /[\u3040-\u309F\u30A0-\u30FF]/.test(track.lyrics);
    const useJpDistinct = lyricFontSettings.lyrics_jp_use_distinct !== false;
    const jpFont = lyricFontSettings.lyrics_jp_font || "";
    const baseFont = lyricFontSettings.lyrics_font || "";

    if (hasJapanese && useJpDistinct) {
      els.lyrics.classList.add('jp');
    } else {
      els.lyrics.classList.remove('jp');
    }

    var result = App.utils.processLyricsCredits(track.lyrics, lyricsCreditFilters);
    var processedLyrics = result.lyrics;
    var creditsText = result.credits;

    if (App.utils.isLRC(track.lyrics)) {
      lyricsData = App.utils.parseLRC(processedLyrics);
      if (lyricsData.length === 0) {
        els.lyrics.innerHTML =
          '<div class="np-lyrics-placeholder">' +
            '<span class="material-symbols-rounded">lyrics</span>' +
            '<p>' + App.i18n.t('np.noLyrics') + '</p>' +
          '</div>';
        _updateLyricsSourceBadge(true);
        return;
      }
      var rawEntries = lyricsData;
      var displayLines = [];
      var hasWordSync = false;
      for (var p = 0; p < rawEntries.length; p++) {
        var e = rawEntries[p];
        if (e.text !== '') {
          displayLines.push(e);
          if (e.words && e.words.length) hasWordSync = true;
        }
      }
      if (displayLines.length === 0) {
        els.lyrics.innerHTML =
          '<div class="np-lyrics-placeholder">' +
            '<span class="material-symbols-rounded">lyrics</span>' +
            '<p>' + App.i18n.t('np.noLyrics') + '</p>' +
          '</div>';
        _updateLyricsSourceBadge(true);
        return;
      }
      var trackDurMs = track.duration_ms || 0;

      var introEnd = Math.max(0, displayLines[0].time - INTERLUDE_END_LEAD);
      if (introEnd >= INTERLUDE_MIN_GAP) {
        interludes.push(_buildInterludeEl(0, introEnd, -1, displayLines[0].time));
      }

      var dispIdx = -1;
      for (var j = 0; j < rawEntries.length; j++) {
        var re = rawEntries[j];
        if (re.text === '') {
          if (!hasWordSync) {
            var nextT = (j + 1 < rawEntries.length) ? rawEntries[j + 1].time : (trackDurMs || re.time);
            var emEnd = Math.max(re.time, nextT - INTERLUDE_END_LEAD);
            if (emEnd - re.time >= INTERLUDE_MIN_GAP) {
              interludes.push(_buildInterludeEl(re.time, emEnd, dispIdx, nextT));
            }
          }
          continue;
        }
        dispIdx++;
        if (hasWordSync && re.words && re.words.length) {
          var lineEnd = re.words[re.words.length - 1].end;
          var nextC = null;
          for (var m = j + 1; m < rawEntries.length; m++) {
            if (rawEntries[m].text !== '') { nextC = rawEntries[m]; break; }
          }
          if (nextC) {
            var gapEnd = Math.max(lineEnd, nextC.time - INTERLUDE_END_LEAD);
            if (gapEnd - lineEnd >= INTERLUDE_MIN_GAP) {
              interludes.push(_buildInterludeEl(lineEnd, gapEnd, dispIdx, nextC.time));
            }
          } else if (trackDurMs > 0 && trackDurMs - lineEnd >= INTERLUDE_MIN_GAP) {
            interludes.push(_buildInterludeEl(lineEnd, trackDurMs, dispIdx, Infinity));
          }
        }
      }

      interludes.sort(function (a, b) { return a.start - b.start; });
      lyricsData = displayLines;

      // 对唱：按歌手首次出现顺序分侧，奇数序歌手右对齐
      var singerOrder = [];
      for (var so = 0; so < lyricsData.length; so++) {
        var sName = lyricsData[so].singer;
        if (sName && singerOrder.indexOf(sName) < 0) singerOrder.push(sName);
      }
      if (singerOrder.length >= 2) _lyricsIsDuet = true;

      // 同唱分组：下一行开始时间早于当前行结束时间（末词 end）→ 重叠，归入同组
      lineGroups = [];
      var groupEnd = -1;
      for (var li = 0; li < lyricsData.length; li++) {
        var ld = lyricsData[li];
        var ldEnd = (ld.words && ld.words.length)
          ? ld.words[ld.words.length - 1].end
          : ((li + 1 < lyricsData.length) ? lyricsData[li + 1].time : (trackDurMs || ld.time));
        if (li > 0 && ld.time < groupEnd) {
          lineGroups[lineGroups.length - 1].push(li);
        } else {
          lineGroups.push([li]);
          groupEnd = -1;
        }
        if (ldEnd > groupEnd) groupEnd = ldEnd;
      }
      groupOfLine = new Array(lyricsData.length);
      for (var lg = 0; lg < lineGroups.length; lg++) {
        for (var lgj = 0; lgj < lineGroups[lg].length; lgj++) {
          groupOfLine[lineGroups[lg][lgj]] = lg;
        }
      }

      var frag = document.createDocumentFragment();
      var ilCursor = 0;
      var flushInterludesBefore = function (time) {
        while (ilCursor < interludes.length && interludes[ilCursor].end <= time + 1) {
          frag.appendChild(interludes[ilCursor].el);
          ilCursor++;
        }
      };

      for (var i = 0; i < lyricsData.length; i++) {
        var line = lyricsData[i];
        flushInterludesBefore(line.time);
        var lineHasJp = /[\u3040-\u309F\u30A0-\u30FF]/.test(line.text);
        var div = document.createElement('div');
        div.className = 'np-lyrics-line';
        if (line.isBg) div.classList.add('np-lyrics-bg-line');
        div.dataset.time = String(line.time);
        div.dataset.timeLabel = _formatSeekTarget(line.time);
        _applyLineFont(div, lineHasJp && useJpDistinct, baseFont, jpFont);
        // v1/v2 等 agent id 兜底名不显示（仅用于分侧），有真实歌手名才渲染标签
        if (line.singer && !/^v\d+$/i.test(line.singer)) {
          var singerEl = document.createElement('span');
          singerEl.className = 'np-lyrics-singer';
          singerEl.textContent = line.singer;
          div.appendChild(singerEl);
          if (_lyricsIsDuet && singerOrder.indexOf(line.singer) % 2 === 1) {
            div.classList.add('np-lyrics-align-right');
          }
        } else if (line.singer && _lyricsIsDuet &&
                   singerOrder.indexOf(line.singer) % 2 === 1) {
          div.classList.add('np-lyrics-align-right');
        }
        if (line.words && line.words.length) {
          _appendWords(div, line.words);
        } else {
          div.textContent = line.text;
        }
        if (line.bgLines && line.bgLines.length) {
          for (var bgi = 0; bgi < line.bgLines.length; bgi++) {
            var bgLine = line.bgLines[bgi];
            var bgEl = document.createElement('span');
            bgEl.className = 'np-lyrics-bg';
            if (bgLine.singer && !/^v\d+$/i.test(bgLine.singer)) {
              var bgSingerEl = document.createElement('span');
              bgSingerEl.className = 'np-lyrics-singer';
              bgSingerEl.textContent = bgLine.singer;
              bgEl.appendChild(bgSingerEl);
            }
            if (bgLine.words && bgLine.words.length) {
              _appendWords(bgEl, bgLine.words);
            } else {
              bgEl.textContent = bgLine.text;
            }
            div.appendChild(bgEl);
          }
        }
        if (line.romaji) {
          var romaji = document.createElement('span');
          romaji.className = 'np-lyrics-romaji';
          _applyLineFont(romaji, false, baseFont, jpFont);
          if (line.romajiWords && line.romajiWords.length) {
            _appendWords(romaji, line.romajiWords);
          } else {
            romaji.textContent = line.romaji;
          }
          div.appendChild(romaji);
        }
        if (line.translation) {
          var trans = document.createElement('span');
          trans.className = 'np-lyrics-trans';
          _applyLineFont(trans, false, baseFont, jpFont);
          if (line.translationWords && line.translationWords.length) {
            _appendWords(trans, line.translationWords);
          } else {
            trans.textContent = line.translation;
          }
          div.appendChild(trans);
        }
        frag.appendChild(div);
      }
      while (ilCursor < interludes.length) { frag.appendChild(interludes[ilCursor].el); ilCursor++; }

      els.lyrics.appendChild(frag);
      _applyLyricsLayout();

      if (creditsText) {
        els.lyrics.appendChild(_buildCreditsElement(creditsText));
      }
    } else {
      var staticLines = App.utils.parseStaticLyrics(processedLyrics);
      if (staticLines.length === 0) {
        els.lyrics.innerHTML =
          '<div class="np-lyrics-placeholder">' +
            '<span class="material-symbols-rounded">lyrics</span>' +
            '<p>' + App.i18n.t('np.noLyrics') + '</p>' +
          '</div>';
        _updateLyricsSourceBadge(true);
        return;
      }
      var frag = document.createDocumentFragment();
      for (var i = 0; i < staticLines.length; i++) {
        var lineHasJp = /[\u3040-\u309F\u30A0-\u30FF]/.test(staticLines[i]);
        var div = document.createElement('div');
        div.className = 'np-lyrics-line np-lyrics-static';
        _applyLineFont(div, lineHasJp && useJpDistinct, baseFont, jpFont);
        div.textContent = staticLines[i];
        frag.appendChild(div);
      }
      els.lyrics.appendChild(frag);

      if (creditsText) {
        els.lyrics.appendChild(_buildCreditsElement(creditsText));
      }
    }

    _updateLyricsToggleVisibility();
    _updateLyricsSourceBadge();

    if (lyricsData.length > 0 && _lastKnownPositionMs > 0) {
      _updateLyrics(_lastKnownPositionMs);
    }
  }

  function _buildCreditsElement(text) {
    var el = document.createElement('div');
    el.className = 'np-lyrics-credits';
    el.textContent = text;
    return el;
  }

  function _applyLineFont(el, isJpLine, baseFont, jpFont) {
    if (isJpLine && jpFont) {
      el.style.fontFamily = jpFont;
    } else if (baseFont) {
      el.style.fontFamily = baseFont;
    }
  }

  var _graphemeSegmenter = (typeof Intl !== 'undefined' && Intl.Segmenter)
    ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    : null;
  function _segmentGraphemes(text) {
    if (_graphemeSegmenter) {
      var out = [];
      var it = _graphemeSegmenter.segment(text)[Symbol.iterator]();
      var step;
      while (!(step = it.next()).done) out.push(step.value.segment);
      return out;
    }
    return Array.from(text);
  }

  function _appendWords(container, words) {
    for (var i = 0; i < words.length; i++) {
      var raw = words[i].text;
      var m = raw.match(/^(\s*)([\s\S]*?)(\s*)$/);
      var lead = m[1], core = m[2], trail = m[3];
      if (!core) {
        container.appendChild(document.createTextNode(raw));
        continue;
      }
      if (lead) container.appendChild(document.createTextNode(lead));
      var span = document.createElement('span');
      span.className = 'np-lyrics-word';
      span.dataset.time = String(words[i].start);
      span.dataset.end = String(words[i].end);
      var clusters = _segmentGraphemes(core);
      for (var c = 0; c < clusters.length; c++) {
        var g = clusters[c];
        if (/^\s+$/.test(g) && span.lastChild) {
          span.lastChild.textContent += g;
          continue;
        }
        var cs = document.createElement('span');
        cs.className = 'np-lyrics-char';
        cs.textContent = g;
        span.appendChild(cs);
      }
      container.appendChild(span);
      if (trail) container.appendChild(document.createTextNode(trail));
    }
  }

  const WL_MIN_CHAR_LIFT_MS = 120;
  const WL_EMPHASIS_MIN_MS = 1000;
  let _wordAnimLines = [];
  let _wordRafId = 0;

  function _wlProgress(pos, start, end) {
    if (pos <= start) return 0;
    if (end <= start || pos >= end) return 1;
    return (pos - start) / (end - start);
  }

  function _wlBezSample(t, c1, c2) {
    var u = 1 - t;
    return 3 * u * u * t * c1 + 3 * u * t * t * c2 + t * t * t;
  }
  function _wlBezier(x, cx1, cy1, cx2, cy2) {
    x = Math.max(0, Math.min(1, x));
    var lo = 0, hi = 1, t = x;
    for (var i = 0; i < 20; i++) {
      var cx = _wlBezSample(t, cx1, cx2);
      if (Math.abs(cx - x) < 1e-6) break;
      if (cx < x) lo = t; else hi = t;
      t = (lo + hi) / 2;
    }
    return _wlBezSample(t, cy1, cy2);
  }

  function _wlWave(p) {
    p = Math.max(0, Math.min(1, p));
    if (p <= 0 || p >= 1) return 0;
    return p < 0.5
      ? _wlBezier(p / 0.5, 0.2, 0.4, 0.58, 1)
      : 1 - _wlBezier((p - 0.5) / 0.5, 0.3, 0, 0.58, 1);
  }

  function _wlEmphasisAmount(durMs, isLast) {
    var d = Math.max(WL_EMPHASIS_MIN_MS, durMs);
    var a = d / 2000;
    a = a > 1 ? Math.sqrt(a) : Math.pow(a, 3);
    a *= 0.6;
    if (isLast) a *= 1.6;
    return Math.min(1.2, a);
  }
  function _wlEmphasisBlur(durMs, isLast) {
    var d = Math.max(WL_EMPHASIS_MIN_MS, durMs);
    var b = d / 3000;
    b = b > 1 ? Math.sqrt(b) : Math.pow(b, 3);
    b *= 0.5;
    if (isLast) b *= 1.5;
    return Math.min(0.8, b);
  }

  function _prepareWordLine(lineEl) {
    var data = { words: [], fontSize: 16, liftDist: 1, feather: 6 };
    var wordEls = lineEl.querySelectorAll('.np-lyrics-word');
    if (!wordEls.length) { lineEl._wl = data; return; }
    var fs = parseFloat(getComputedStyle(wordEls[0]).fontSize);
    if (fs > 0) data.fontSize = fs;
    data.liftDist = Math.max(0.75, Math.min(1.15, data.fontSize * 0.07));
    data.feather = Math.max(4, Math.min(7, data.fontSize * 0.45));

    for (var i = 0; i < wordEls.length; i++) {
      var wEl = wordEls[i];
      var wStart = parseInt(wEl.dataset.time, 10) || 0;
      var wEnd = parseInt(wEl.dataset.end, 10) || 0;
      var wDur = Math.max(0, wEnd - wStart);
      var charEls = wEl.querySelectorAll('.np-lyrics-char');
      if (!charEls.length) continue;

      var widths = [];
      var total = 0;
      for (var c = 0; c < charEls.length; c++) {
        var w = charEls[c].getBoundingClientRect().width;
        if (!(w > 0)) w = data.fontSize * 0.5;
        widths.push(w);
        total += w;
      }
      if (total <= 0) total = 1;

      var wholeLift = false;
      var cum = 0;
      var cTimes = [];
      for (var c2 = 0; c2 < widths.length; c2++) {
        var cs = wStart + wDur * (cum / total);
        cum += widths[c2];
        var ce = wStart + wDur * (cum / total);
        cTimes.push({ start: cs, end: ce });
        if (ce - cs < WL_MIN_CHAR_LIFT_MS) wholeLift = true;
      }

      var isLast = i === wordEls.length - 1;
      var eligible = wDur > WL_EMPHASIS_MIN_MS;
      var amount = eligible ? _wlEmphasisAmount(wDur, isLast) : 0;
      var blur = eligible ? _wlEmphasisBlur(wDur, isLast) : 0;
      var durEff = Math.max(WL_EMPHASIS_MIN_MS, wDur);
      if (isLast) durEff *= 1.2;

      var chars = [];
      for (var c3 = 0; c3 < charEls.length; c3++) {
        var delay = durEff / 2.5 / charEls.length * c3;
        chars.push({
          el: charEls[c3],
          width: widths[c3],
          start: cTimes[c3].start,
          end: cTimes[c3].end,
          liftStart: wholeLift ? wStart : cTimes[c3].start,
          liftEnd: wholeLift ? wEnd : cTimes[c3].end,
          empStart: eligible ? wStart + delay : 0,
          empEnd: eligible ? wStart + delay + durEff : 0,
          _t: '',
          _s: '',
          _fo: '',
          _fe: ''
        });
      }
      data.words.push({ amount: amount, blur: blur, chars: chars });
    }
    lineEl._wl = data;
  }

  function _renderWordLine(lineEl, pos) {
    var data = lineEl._wl;
    if (!data) return;
    var fs = data.fontSize;
    for (var i = 0; i < data.words.length; i++) {
      var word = data.words[i];
      var n = word.chars.length;
      for (var c = 0; c < n; c++) {
        var ch = word.chars[c];

        var p = _wlProgress(pos, ch.start, ch.end);
        var filled = p * ch.width;
        var fo = Math.max(0, filled - data.feather * 0.35) / ch.width * 100;
        var fe = Math.min(ch.width, filled + data.feather * 0.65) / ch.width * 100;
        if (p >= 1) { fo = 100; fe = 100; }
        else if (p <= 0) { fo = 0; fe = 0; }
        var foStr = fo.toFixed(2) + '%';
        var feStr = fe.toFixed(2) + '%';
        if (foStr !== ch._fo) { ch.el.style.setProperty('--fo', foStr); ch._fo = foStr; }
        if (feStr !== ch._fe) { ch.el.style.setProperty('--fe', feStr); ch._fe = feStr; }

        var lp = _wlProgress(pos, ch.liftStart, ch.liftEnd);
        var lift = -data.liftDist * (1 - Math.pow(1 - lp, 3));

        var tx = 0, ty = 0, scale = 1, glow = 0, glowR = 0;
        if (word.amount > 0 || word.blur > 0) {
          var ep = _wlProgress(pos, ch.empStart, ch.empEnd);
          var wave = _wlWave(ep);
          if (wave > 0) {
            scale = 1 + 0.1 * word.amount * wave;
            tx = -wave * 0.03 * word.amount * fs * (n / 2 - c);
            ty = -fs * 0.025 * word.amount * wave;
            if (word.blur > 0) {
              glow = Math.max(0, Math.min(1, word.blur * wave));
              glowR = fs * Math.min(0.3, word.blur * 0.3);
            }
          }
          if (ep > 0 && ep < 1) {
            ty += -fs * 0.05 * Math.sin(Math.PI * ep);
          }
        }

        var t = 'translate3d(' + tx.toFixed(2) + 'px,' + (lift + ty).toFixed(2) + 'px,0)';
        if (scale > 1.0001) t += ' scale(' + scale.toFixed(4) + ')';
        if (t !== ch._t) { ch.el.style.transform = t; ch._t = t; }
        var s = glow > 0.001
          ? '0 0 ' + glowR.toFixed(1) + 'px rgba(255,255,255,' + glow.toFixed(3) + ')'
          : '';
        if (s !== ch._s) { ch.el.style.textShadow = s; ch._s = s; }
      }
    }
  }

  function _teardownWordLine(lineEl) {
    lineEl.classList.remove('word-sync');
    var data = lineEl._wl;
    if (data) {
      for (var i = 0; i < data.words.length; i++) {
        var chars = data.words[i].chars;
        for (var c = 0; c < chars.length; c++) {
          var el = chars[c].el;
          el.style.transform = '';
          el.style.textShadow = '';
          el.style.removeProperty('--fo');
          el.style.removeProperty('--fe');
        }
      }
    }
    lineEl._wl = null;
  }

  function _clearWordAnim() {
    for (var i = 0; i < _wordAnimLines.length; i++) {
      _teardownWordLine(_wordAnimLines[i]);
    }
    _wordAnimLines = [];
    _stopWordRaf();
  }

  function _startWordRaf() {
    if (_wordRafId) return;
    var tick = function () {
      _wordRafId = 0;
      if (!_wordAnimLines.length) return;
      if (window.__appFrozen) { _wordRafId = requestAnimationFrame(tick); return; }
      if (App.state.playbackState === 'playing') {
        var pos = _beatGetPrecisePosition() - lyricsTimeOffset;
        for (var i = 0; i < _wordAnimLines.length; i++) {
          if (_wordAnimLines[i]._wl) _renderWordLine(_wordAnimLines[i], pos);
        }
        if (_miniLrcWordLine && _miniLrcWordLine._wl) _renderWordLine(_miniLrcWordLine, pos);
      }
      _wordRafId = requestAnimationFrame(tick);
    };
    _wordRafId = requestAnimationFrame(tick);
  }

  function _stopWordRaf() {
    if (_wordRafId) { cancelAnimationFrame(_wordRafId); _wordRafId = 0; }
  }

  var MINI_LRC_OUT_MS = 200;
  var _miniLrcIdx = -2;
  var _miniLrcSwap = null;
  var _miniLrcWordLine = null;
  var _miniLrcOutTimer = 0;
  // 间奏态：当前处于（已唱完这一句 → 下一句开始）之间的空白段，
  // 底栏让位给进度条，而不是把上一句凝固住
  var _miniLrcInGap = false;
  var _miniLrcGapTimer = 0;

  function _setMiniTime(curLabel, remLabel) {
    if (els.miniTimeCur) els.miniTimeCur.textContent = curLabel;
    if (els.miniTimeRem) els.miniTimeRem.textContent = remLabel;
    if (els.miniTimeJoinedCur) els.miniTimeJoinedCur.textContent = curLabel;
    if (els.miniTimeJoinedRem) els.miniTimeJoinedRem.textContent = remLabel;
  }

  function _markMiniOverflow(el) {
    if (!el) return;
    el.classList.toggle('is-overflow', el.scrollWidth > el.clientWidth + 1);
  }

  var _miniLrcOverflowTimer = 0;
  var _miniLrcOverflowToken = 0;
  function _scheduleMiniOverflowCheck(lineEl, transEl) {
    var token = ++_miniLrcOverflowToken;
    if (_miniLrcOverflowTimer) clearTimeout(_miniLrcOverflowTimer);
    _miniLrcOverflowTimer = setTimeout(function () {
      _miniLrcOverflowTimer = 0;
      if (token !== _miniLrcOverflowToken) return;
      if (!lineEl || !lineEl.isConnected) return;
      _markMiniOverflow(lineEl);
      _markMiniOverflow(transEl);
    }, 330);
  }

  var MINI_LRC_CAP = 0.54;
  function _miniLrcAvailWidth() {
    if (!els.miniPlayer) return 0;
    var baseW = els.miniPlayer.clientWidth - 32;
    if (baseW <= 0) return 0;
    var timeW = els.miniTimeDur ? els.miniTimeDur.offsetWidth : 0;
    return baseW * MINI_LRC_CAP - timeW - 10 - 16;
  }

  function _applyMiniLrcWide(contentW) {
    if (!els.miniPlayer) return;
    var avail = _miniLrcAvailWidth();
    var wide = avail > 0 && contentW > avail + 2;
    els.miniPlayer.classList.toggle('mini-lrc-wide', wide);
  }

  function _fitMiniLrcWidth(swap) {
    if (!els.miniProgressSlot || !swap) return false;
    var w = 0;
    for (var i = 0; i < swap.children.length; i++) {
      w = Math.max(w, swap.children[i].scrollWidth);
    }
    if (w <= 0) return false;
    _applyMiniLrcWide(w + 4);
    var slot = els.miniProgressSlot;
    var prev = parseFloat(slot.style.getPropertyValue('--mini-lrc-w')) || 0;
    var instant = !prev;
    if (instant) slot.style.transition = 'none';
    slot.style.setProperty('--mini-lrc-w', (w + 4) + 'px');
    if (instant) {
      slot.offsetWidth;
      slot.style.transition = '';
      return false;
    }
    return (w + 4) > prev + 0.5;
  }

  function _miniLrcClear() {
    _miniLrcInGap = false;
    if (_miniLrcGapTimer) { clearTimeout(_miniLrcGapTimer); _miniLrcGapTimer = 0; }
    if (_miniLrcSwap || _miniLrcWordLine || _miniLrcIdx !== -2 || els.miniLrc && els.miniLrc.firstChild) {
      if (_miniLrcWordLine) _teardownWordLine(_miniLrcWordLine);
      _miniLrcSwap = null;
      _miniLrcWordLine = null;
      _miniLrcIdx = -2;
      _miniLrcOverflowToken++;
      if (_miniLrcOverflowTimer) { clearTimeout(_miniLrcOverflowTimer); _miniLrcOverflowTimer = 0; }
      if (els.miniLrc) els.miniLrc.innerHTML = '';
      if (els.miniProgressSlot) {
        els.miniProgressSlot.classList.remove('has-lyric');
        els.miniProgressSlot.style.removeProperty('--mini-lrc-w');
      }
      if (els.miniProgressInline) els.miniProgressInline.classList.remove('lrc-mode');
      if (els.miniPlayer) els.miniPlayer.classList.remove('mini-lrc-wide');
    }
  }

  // 底栏歌词开关（设置页「在底栏进度条的位置上显示歌词」）
  var _miniLyricsEnabled = true;

  function _miniLrcVisible() {
    if (!_miniLyricsEnabled) return false;
    return !!(document.body && document.body.classList.contains('player-collapsed'));
  }

  var _miniLrcResizeTimer = 0;
  window.addEventListener('resize', function () {
    if (!_miniLrcSwap) return;
    if (_miniLrcResizeTimer) clearTimeout(_miniLrcResizeTimer);
    _miniLrcResizeTimer = setTimeout(function () {
      _miniLrcResizeTimer = 0;
      if (!_miniLrcSwap) return;
      _fitMiniLrcWidth(_miniLrcSwap);
      _markMiniOverflow(_miniLrcSwap.querySelector('.mini-lrc-line'));
      _markMiniOverflow(_miniLrcSwap.querySelector('.mini-lrc-trans'));
    }, 180);
  });

  var _miniLrcWasVisible = false;
  function _miniLrcResync() {
    var vis = _miniLrcVisible();
    if (!vis) {
      _miniLrcWasVisible = false;
      if (_miniLrcIdx !== -2) _miniLrcClear();
      return;
    }
    if (_miniLrcWasVisible && _miniLrcIdx !== -2) return;
    _miniLrcWasVisible = true;
    if (lyricsData.length === 0) return;
    var pos = _lastKnownPositionMs - lyricsTimeOffset;
    var idx = -1;
    for (var i = 0; i < lyricsData.length; i++) {
      if (pos >= lyricsData[i].time) idx = i; else break;
    }
    if (idx < 0) idx = 0;
    _updateMiniLyric(pos, idx);
  }

  // 底栏的间奏判定：区间一直延到下一句真正开始（nextStart）为止，
  // 这样「间奏收尾 250ms」那段空白也不会把上一句重新顶出来
  function _miniLrcGapAt(pos) {
    for (var k = 0; k < interludes.length; k++) {
      var il = interludes[k];
      if (pos < il.start) break;
      var stop = isFinite(il.nextStart) ? il.nextStart : il.end;
      if (pos < stop) return il;
    }
    return null;
  }

  // 进间奏：底栏让位给进度条，旧歌词由 CSS 过渡淡出后再移除
  function _miniLrcEnterGap() {
    if (_miniLrcInGap) return;
    _miniLrcInGap = true;
    var old = _miniLrcSwap;
    if (_miniLrcWordLine) _teardownWordLine(_miniLrcWordLine);
    _miniLrcSwap = null;
    _miniLrcWordLine = null;
    _miniLrcIdx = -2;
    _miniLrcOverflowToken++;
    if (_miniLrcOverflowTimer) { clearTimeout(_miniLrcOverflowTimer); _miniLrcOverflowTimer = 0; }
    if (els.miniProgressSlot) els.miniProgressSlot.classList.remove('has-lyric');
    if (els.miniProgressInline) els.miniProgressInline.classList.remove('lrc-mode');
    if (els.miniPlayer) els.miniPlayer.classList.remove('mini-lrc-wide');
    if (_miniLrcGapTimer) clearTimeout(_miniLrcGapTimer);
    _miniLrcGapTimer = setTimeout(function () {
      _miniLrcGapTimer = 0;
      if (old && old.parentNode) old.parentNode.removeChild(old);
      if (els.miniProgressSlot && !_miniLrcSwap) {
        els.miniProgressSlot.style.removeProperty('--mini-lrc-w');
      }
    }, MINI_LRC_OUT_MS + 40);
  }

  function _updateMiniLyric(pos, idx) {
    if (!els.miniLrc) return;
    if (!_miniLrcVisible()) { _miniLrcClear(); return; }

    // 间奏段：不凝固上一句，回到进度条态
    if (_miniLrcGapAt(pos)) { _miniLrcEnterGap(); return; }
    _miniLrcInGap = false;

    var line = lyricsData[idx];
    if (!line) { _miniLrcClear(); return; }

    if (idx === _miniLrcIdx && _miniLrcSwap) {
      if (App.state.playbackState !== 'playing' && _miniLrcWordLine) {
        _renderWordLine(_miniLrcWordLine, pos);
      }
      return;
    }
    _miniLrcIdx = idx;

    if (els.miniProgressInline) els.miniProgressInline.classList.add('lrc-mode');

    var swap = document.createElement('div');
    swap.className = 'mini-lrc-swap';
    if (line.translation) swap.classList.add('has-trans');

    var lineEl = document.createElement('div');
    lineEl.className = 'mini-lrc-line';
    var jp = /[\u3040-\u309F\u30A0-\u30FF]/.test(line.text);
    var baseFont = lyricFontSettings.lyrics_font || '';
    var jpFont = lyricFontSettings.lyrics_jp_use_distinct !== false
      ? (lyricFontSettings.lyrics_jp_font || '') : '';
    if (jp && jpFont) lineEl.style.fontFamily = jpFont;
    else if (baseFont) lineEl.style.fontFamily = baseFont;

    if (line.words && line.words.length) {
      _appendWords(lineEl, line.words);
    } else {
      lineEl.textContent = line.text;
      lineEl.style.color = 'transparent';
      lineEl.style.backgroundImage =
        'linear-gradient(to right, var(--wc) 0%, var(--wc) 100%)';
      lineEl.style.webkitBackgroundClip = 'text';
      lineEl.style.backgroundClip = 'text';
    }
    swap.appendChild(lineEl);

    var transEl = null;
    if (line.translation) {
      transEl = document.createElement('div');
      transEl.className = 'mini-lrc-trans';
      transEl.textContent = line.translation;
      if (baseFont) transEl.style.fontFamily = baseFont;
      swap.appendChild(transEl);
    }

    var old = _miniLrcSwap;
    els.miniLrc.appendChild(swap);
    swap.classList.add('is-in');

    var wordLine = lineEl.querySelector('.np-lyrics-word') ? lineEl : null;
    if (wordLine) {
      _prepareWordLine(wordLine);
      _renderWordLine(wordLine, pos);
    }
    var grew = _fitMiniLrcWidth(swap);
    if (!grew) {
      _markMiniOverflow(lineEl);
      _markMiniOverflow(transEl);
    }
    _scheduleMiniOverflowCheck(lineEl, transEl);

    _miniLrcSwap = swap;
    _miniLrcWordLine = wordLine;

    if (old) {
      old.classList.remove('is-in');
      old.classList.add('is-out');
      if (_miniLrcOutTimer) clearTimeout(_miniLrcOutTimer);
      _miniLrcOutTimer = setTimeout(function () {
        _miniLrcOutTimer = 0;
        if (old.parentNode) old.parentNode.removeChild(old);
      }, MINI_LRC_OUT_MS + 40);
    }

    if (els.miniProgressSlot) els.miniProgressSlot.classList.add('has-lyric');
    if (els.miniProgressInline) els.miniProgressInline.classList.add('lrc-mode');
  }

  function _blurForDistance(d) {
    if (d <= 0) return 0;
    if (d === 1) return 1.5;
    if (d === 2) return 3;
    if (d === 3) return 4.5;
    return 6;
  }
  function _applyProgressiveBlurToLines(activeIdx) {
    if (!progressiveBlurEnabled) return;
    var lines = _getLyricLineEls();
    for (var j = 0; j < lines.length; j++) {
      var blurPx = _blurForDistance(Math.abs(j - activeIdx));
      if (lines[j]._blurPx === blurPx) continue;
      lines[j]._blurPx = blurPx;
      lines[j].style.filter = blurPx > 0 ? 'blur(' + blurPx + 'px)' : '';
    }
  }

  np.refreshProgressiveBlur = function (enabled) {
    progressiveBlurEnabled = !!enabled;
    var wrap = document.getElementById('np-lyrics-wrap');
    if (wrap) wrap.classList.toggle('progressive-blur', progressiveBlurEnabled);
    if (!progressiveBlurEnabled) {
      var lines = _getLyricLineEls();
      for (var j = 0; j < lines.length; j++) {
        lines[j].style.filter = '';
        lines[j]._blurPx = null;
      }
    } else if (lastLyricsIdx >= 0) {
      _applyProgressiveBlurToLines(lastLyricsIdx);
    }
    if (els.lyricsBlurToggle) els.lyricsBlurToggle.checked = progressiveBlurEnabled;
  };

  np.refreshLyricsCenter = function (enabled) {
    lyricsCentered = !!enabled;
    _applyLyricsLayout();
    if (els.lyricsCenterToggle) els.lyricsCenterToggle.checked = lyricsCentered;
  };

  np.refreshLyricsFontSize = function (val) {
    lyricsFontSize = parseInt(val, 10) || 16;
    _applyLyricsLayout();
    if (els.lyricsFontSizeSlider) els.lyricsFontSizeSlider.value = lyricsFontSize;
    if (els.lyricsFontSizeValue) els.lyricsFontSizeValue.textContent = lyricsFontSize + 'px';
  };

  np.refreshLyricsFont = function (font, jpFont) {
    if (font !== undefined) lyricFontSettings.lyrics_font = font || '';
    if (jpFont !== undefined) lyricFontSettings.lyrics_jp_font = jpFont || '';
    if (App.state && App.state.currentTrack) {
      _renderLyrics(App.state.currentTrack);
    }
  };

  np.refreshLyricsJpDistinct = function (enabled) {
    lyricFontSettings.lyrics_jp_use_distinct = !!enabled;
    if (els.lyricsJpFontToggle) els.lyricsJpFontToggle.checked = lyricFontSettings.lyrics_jp_use_distinct !== false;
    if (App.state && App.state.currentTrack) {
      _renderLyrics(App.state.currentTrack);
    }
  };

  np.refreshCircularCover = function (enabled) {
    circularCover = !!enabled;
    _applyCircularCoverClass();
  };

  np.refreshLyricsCreditFilters = function (val) {
    lyricsCreditFilters = val || '';
    if (App.state && App.state.currentTrack) {
      _renderLyrics(App.state.currentTrack);
    }
  };

  np.refreshVideoBackground = function (enabled) {
    _videoBgEnabled = !!enabled;
    if (!_videoBg) return;
    _videoBg.setEnabled(_videoBgEnabled);
    if (_videoBgEnabled && App.state && App.state.currentTrack) {
      var track = App.state.currentTrack;
      if (track.source !== 'subsonic') {
        var vgen = ++_videoBgGen;
        App.utils.call('find_video_for_track', track.id).then(function (result) {
          if (vgen !== _videoBgGen) return;
          if (result && result.url) {
            _videoBg.load(result.url, track.duration_ms);
          } else {
            _videoBg.clear();
          }
        });
      }
    }
  };

  np.refreshWaveProgress = function (enabled) {
    waveProgress = !!enabled;
    _applyWaveProgressClass();
  };

  // 底栏歌词开关：关闭后进度条位置始终显示进度条本身
  np.refreshMiniLyrics = function (enabled) {
    var next = enabled !== false;
    if (next === _miniLyricsEnabled) return;
    _miniLyricsEnabled = next;
    if (!_miniLyricsEnabled) {
      _miniLrcClear();
      _miniLrcWasVisible = false;
    } else {
      _miniLrcResync();
    }
  };

  np.refreshBackgroundMode = function (mode) {
    var next = mode === 'solid' ? 'solid' : 'cover';
    if (next === npBackgroundMode) return;
    npBackgroundMode = next;
    _applyBackgroundModeClass();
  };

  function _applyBackgroundModeClass() {
    var pane = document.querySelector('.now-playing-pane');
    if (!pane) return;
    pane.classList.toggle('np-bg-solid', npBackgroundMode === 'solid');
  }

  function _applyWaveProgressClass() {
    if (els.barFill) {
      els.barFill.classList.toggle('flat', !waveProgress);
    }
    if (els.miniProgressTrackFill) {
      els.miniProgressTrackFill.classList.toggle('flat', !waveProgress);
    }
  }

  function _applyCircularCoverClass() {
    if (els.cover) {
      els.cover.classList.toggle('circular', circularCover);
    }
  }

  function _applyLyricsLayout() {
    if (!els.lyrics) return;
    els.lyrics.classList.toggle('lyrics-centered', lyricsCentered && !_lyricsIsDuet);
    els.lyrics.style.setProperty('--lyrics-font-size', lyricsFontSize + 'px');
    // 对唱歌词强制左右分侧排版，居中排版开关禁用
    if (els.lyricsCenterToggle) els.lyricsCenterToggle.disabled = _lyricsIsDuet;
  }


  function _findInterlude(adjustedPos) {
    for (var k = 0; k < interludes.length; k++) {
      var il = interludes[k];
      if (adjustedPos >= il.start && adjustedPos < il.end) return il;
    }
    return null;
  }

  function _resetInterludeEl(il) {
    il.el.classList.remove('active');
    il.wrap.style.transform = '';
    for (var d = 0; d < il.dots.length; d++) il.dots[d].style.opacity = '';
  }

  function _enterInterlude(il, lines) {
    if (_activeInterlude && _activeInterlude !== il) _resetInterludeEl(_activeInterlude);
    _activeInterlude = il;
    il.wrap.style.transform = '';
    _clearWordAnim();

    for (var j = 0; j < lines.length; j++) {
      lines[j].classList.remove('active', 'past');
      if (j <= il.lineIdx) lines[j].classList.add('past');
    }
    il.el.classList.add('active');

    var focusIdx = Math.max(0, Math.min(il.lineIdx + 1, lines.length - 1));
    _applyProgressiveBlurToLines(focusIdx);
    App.utils.cascadeLyricLines(lines, focusIdx, lastLyricsIdx);

    var pane = document.getElementById('now-playing-pane');
    var factor = (pane && pane.classList.contains('fullscreen')) ? 0.23 : 0.22;
    var target = il.el.offsetTop - els.lyricsWrap.clientHeight * factor + il.el.clientHeight / 2;
    App.utils.animateLyricsScroll(els.lyricsWrap, target, il.nextStart - il.start);
  }

  function _ilEaseOutExpo(p) {
    if (p <= 0) return 0;
    if (p >= 1) return 1;
    return 1 - Math.pow(2, -10 * p);
  }

  function _ilEaseInOutBack(p) {
    p = Math.max(0, Math.min(1, p));
    var f = 1.70158 * 1.525;
    return p < 0.5
      ? Math.pow(2 * p, 2) * ((f + 1) * 2 * p - f) / 2
      : (Math.pow(2 * p - 2, 2) * ((f + 1) * (p * 2 - 2) + f) + 2) / 2;
  }

  function _renderInterludeFrame(il, adjustedPos) {
    var dur = il.end - il.start;
    var t = adjustedPos - il.start;
    if (dur <= 0 || t < 0 || t > dur) return;
    var remaining = dur - t;

    var breathe = dur / Math.ceil(dur / IL_BREATHE_TARGET);
    var scale = Math.sin(1.5 * Math.PI - (t / breathe) * 2) / 20 + 1;
    var globalOpacity = 1;

    if (t < IL_ENTRANCE) {
      scale *= _ilEaseOutExpo(t / IL_ENTRANCE);
    }
    if (t < IL_ENTRANCE_DELAY) {
      globalOpacity = 0;
    } else if (t < IL_ENTRANCE_DELAY + IL_ENTRANCE_FADE) {
      globalOpacity *= (t - IL_ENTRANCE_DELAY) / IL_ENTRANCE_FADE;
    }

    if (remaining < IL_EXIT) {
      scale *= 1 - _ilEaseInOutBack((IL_EXIT - remaining) / IL_EXIT / 2);
    }
    if (remaining < IL_EXIT_FADE) {
      globalOpacity *= Math.max(0, Math.min(1, remaining / IL_EXIT_FADE));
    }

    scale = Math.max(0, scale) * 0.82;
    var dotsDur = Math.max(1, dur - IL_EXIT);

    il.wrap.style.transform = 'scale(' + scale.toFixed(4) + ')';
    for (var d = 0; d < 3; d++) {
      var dotOpacity = Math.max(0.25, Math.min(1, ((t - (dotsDur / 3 * d)) * 3 / dotsDur) * 0.75));
      il.dots[d].style.opacity = Math.max(0, Math.min(1, globalOpacity * dotOpacity)).toFixed(3);
    }
  }

  function _exitInterlude(il) {
    _resetInterludeEl(il);
  }

  function _startInterludeRaf() {
    if (_ilRafId) return;
    var tick = function () {
      _ilRafId = 0;
      var il = _activeInterlude;
      if (!il) return;
      if (App.state.playbackState === 'playing') {
        var pos = _beatGetPrecisePosition() - lyricsTimeOffset;
        if (pos >= il.start && pos < il.end) {
          _renderInterludeFrame(il, pos);
        }
      }
      _ilRafId = requestAnimationFrame(tick);
    };
    _ilRafId = requestAnimationFrame(tick);
  }

  function _stopInterludeRaf() {
    if (_ilRafId) { cancelAnimationFrame(_ilRafId); _ilRafId = 0; }
  }

  function _doActivationScroll(lineEl, lineIdx, prevIdx, lineTopOverride) {
    if (!lineEl) return;
    var pane = document.getElementById('now-playing-pane');
    var factor = (pane && pane.classList.contains('fullscreen')) ? 0.23 : 0.22;
    var lineTop = typeof lineTopOverride === 'number' ? lineTopOverride : lineEl.offsetTop;
    var target = lineTop - els.lyricsWrap.clientHeight * factor + lineEl.clientHeight / 2;
    var lineGapMs = null;
    if (lineIdx >= 0 && lyricsData[lineIdx]) {
      var fromIdx = prevIdx >= 0 && lyricsData[prevIdx] ? prevIdx : lineIdx - 1;
      if (fromIdx >= 0 && lyricsData[fromIdx]) {
        lineGapMs = Math.abs(lyricsData[lineIdx].time - lyricsData[fromIdx].time);
      }
    }
    App.utils.animateLyricsScroll(els.lyricsWrap, target, lineGapMs);
  }

  function _schedulePostCollapseScroll(lineEl, lineIdx, prevIdx) {
    var el = _interludeExitEl;
    if (!el) { _doActivationScroll(lineEl, lineIdx, prevIdx); return; }

    var finalLineTop = typeof _interludeExitLineTop === 'number'
      ? _interludeExitLineTop - _interludeExitHeight
      : null;
    _doActivationScroll(lineEl, lineIdx, prevIdx, finalLineTop);

    var done = false;
    var run = function () {
      if (done) return;
      done = true;
      if (_interludeScrollTimer) { clearTimeout(_interludeScrollTimer); _interludeScrollTimer = 0; }
      _interludeExiting = false;
      _interludeExitEl = null;
      _interludeExitHeight = 0;
      _interludeExitLineTop = null;
    };
    el.addEventListener('transitionend', function (e) {
      if (e.target === el && e.propertyName === 'grid-template-rows') run();
    }, { once: true });
    if (_interludeScrollTimer) clearTimeout(_interludeScrollTimer);
    _interludeScrollTimer = setTimeout(run, 240);
  }

  function _updateLyrics(posMs) {
    if (lyricsData.length === 0 || !els.lyricsWrap) return;

    var adjustedPos = posMs - lyricsTimeOffset;

    var idx = -1;
    for (var i = 0; i < lyricsData.length; i++) {
      if (adjustedPos >= lyricsData[i].time) {
        idx = i;
      } else {
        break;
      }
    }
    if (idx < 0) idx = 0;

    _updateMiniLyric(adjustedPos, idx);

    var lines = _getLyricLineEls();

    var il = _findInterlude(adjustedPos);
    if (il) {
      if (_activeInterlude !== il) {
        _enterInterlude(il, lines);
        _renderInterludeFrame(il, adjustedPos);
        _startInterludeRaf();
      }
      return;
    }
    if (_activeInterlude) {
      _stopInterludeRaf();
      _interludeExitEl = _activeInterlude.el;
      _interludeExitHeight = _interludeExitEl.offsetHeight;
      var _nextLineIdx = _activeInterlude.lineIdx + 1;
      _interludeExitLineTop = (_nextLineIdx >= 0 && _nextLineIdx < lines.length && lines[_nextLineIdx])
        ? lines[_nextLineIdx].offsetTop : null;
      _exitInterlude(_activeInterlude);
      _interludeExiting = true;
      _activeInterlude = null;
      lastLyricsIdx = -1;
      lastGroupIdx = -1;
    }
    for (var k2 = 0; k2 < interludes.length; k2++) {
      if (adjustedPos >= interludes[k2].end && adjustedPos < interludes[k2].nextStart) return;
    }

    var groupIdx = (groupOfLine && groupOfLine[idx] !== undefined) ? groupOfLine[idx] : idx;
    var activeGroup = lineGroups[groupIdx] || [idx];
    var groupAnchor = activeGroup[0];
    var groupChanged = groupIdx !== lastGroupIdx;
    var prevGroupIdx = lastGroupIdx;

    if (idx !== lastLyricsIdx || groupChanged) {
      lastLyricsIdx = idx;
      for (var j = 0; j < lines.length; j++) {
        var jg = (groupOfLine && groupOfLine[j] !== undefined) ? groupOfLine[j] : j;
        lines[j].classList.remove('active', 'past');
        if (jg < groupIdx) lines[j].classList.add('past');
        else if (jg === groupIdx) lines[j].classList.add('active');
        lines[j].classList.toggle('np-near', j >= idx - 4 && j <= idx + 4);
      }

      _applyProgressiveBlurToLines(idx);
    }

    if (groupChanged) {
      // 滚动以组为单位：高亮在组内推进时不滚动，整组结束后一次性滚到下一组锚点（组首行）
      lastGroupIdx = groupIdx;
      App.utils.cascadeLyricLines(lines, groupAnchor, -1);
      var anchorLine = lines[groupAnchor];
      if (anchorLine) {
        var prevAnchor = (prevGroupIdx >= 0 && lineGroups[prevGroupIdx])
          ? lineGroups[prevGroupIdx][0] : -1;
        if (_interludeExiting) {
          _schedulePostCollapseScroll(anchorLine, groupAnchor, prevAnchor);
        } else {
          _doActivationScroll(anchorLine, groupAnchor, prevAnchor);
        }
      }
    }

    // 同唱组内所有行一起点亮：词级 active/past 高亮
    for (var agi = 0; agi < activeGroup.length; agi++) {
      var agLine = lines[activeGroup[agi]];
      if (!agLine) continue;
      var agWords = agLine.querySelectorAll('.np-lyrics-word');
      for (var aw = 0; aw < agWords.length; aw++) {
        var aWord = agWords[aw];
        var aStart = parseInt(aWord.dataset.time, 10);
        var aEnd = parseInt(aWord.dataset.end, 10);
        aWord.classList.remove('active', 'past');
        if (adjustedPos >= aEnd) {
          aWord.classList.add('past');
        } else if (adjustedPos >= aStart) {
          aWord.classList.add('active');
        }
      }
    }

    // 同唱组内所有含词行同时做逐词渐进动画
    var wantLines = [];
    for (var wgi = 0; wgi < activeGroup.length; wgi++) {
      var wgLine = lines[activeGroup[wgi]];
      if (wgLine && wgLine.querySelector('.np-lyrics-word')) wantLines.push(wgLine);
    }
    for (var oi = _wordAnimLines.length - 1; oi >= 0; oi--) {
      if (wantLines.indexOf(_wordAnimLines[oi]) < 0) {
        _teardownWordLine(_wordAnimLines[oi]);
        _wordAnimLines.splice(oi, 1);
      }
    }
    for (var wi = 0; wi < wantLines.length; wi++) {
      if (_wordAnimLines.indexOf(wantLines[wi]) < 0) {
        wantLines[wi].classList.add('word-sync');
        _prepareWordLine(wantLines[wi]);
        _renderWordLine(wantLines[wi], adjustedPos);
        _wordAnimLines.push(wantLines[wi]);
      }
    }
    if (_wordAnimLines.length) {
      if (App.state.playbackState !== 'playing') {
        for (var ri = 0; ri < _wordAnimLines.length; ri++) {
          if (_wordAnimLines[ri]._wl) _renderWordLine(_wordAnimLines[ri], adjustedPos);
        }
      }
      _startWordRaf();
    }
  }

  np.updateState = function (state) {
    if (state === 'loading') {
      np.setTrackLoading(true);
      App.utils.squeezeIcon(els.iconPlay, 'hourglass_top');
      App.utils.squeezeIcon(els.miniPlayIcon, 'hourglass_top');
      els.btnPlay.classList.remove('playing');
      els.cover.classList.remove('playing');
      els.barFill.classList.remove('playing');
      if (els.miniProgressTrackFill) els.miniProgressTrackFill.classList.remove('playing');
      els.miniBtnPlay.classList.remove('playing');
      _setBgMotionPlaying(false);
    } else if (state === 'playing') {
      np.setTrackLoading(false);
      App.utils.squeezeIcon(els.iconPlay, 'pause');
      App.utils.squeezeIcon(els.miniPlayIcon, 'pause');
      App.utils.bloomButton(els.btnPlay);
      App.utils.bloomButton(els.miniBtnPlay);
      els.btnPlay.classList.add('playing');
      els.cover.classList.add('playing');
      els.barFill.classList.add('playing');
      if (els.miniProgressTrackFill) els.miniProgressTrackFill.classList.add('playing');
      els.miniBtnPlay.classList.add('playing');
      _setBgMotionPlaying(true);
    } else {
      np.setTrackLoading(false);
      App.utils.squeezeIcon(els.iconPlay, 'play_arrow');
      App.utils.squeezeIcon(els.miniPlayIcon, 'play_arrow');
      App.utils.bloomButton(els.btnPlay);
      App.utils.bloomButton(els.miniBtnPlay);
      els.btnPlay.classList.remove('playing');
      els.cover.classList.remove('playing');
      els.barFill.classList.remove('playing');
      if (els.miniProgressTrackFill) els.miniProgressTrackFill.classList.remove('playing');
      els.miniBtnPlay.classList.remove('playing');
      _setBgMotionPlaying(false);
    }
    if (_videoBg) _videoBg.setPlaying(state === 'playing');
  };

  np.updateDuration = function (ms) {
    duration = ms;
    els.timeDur.textContent = '-' + App.utils.formatDuration(ms);
  };

np.updatePosition = function (ms) {
_beatUpdatePosition(ms);
_lastKnownPositionMs = ms;
if (isSeeking || !duration) return;
var clampedMs = Math.max(0, Math.min(ms, duration));
const pct = Math.max(0, Math.min(1, clampedMs / duration));
els.barFill.style.width = (pct * 100) + '%';
els.barThumb.style.left = (pct * 100) + '%';
els.barWrap.style.setProperty('--progress-val', (pct * 100) + '%');
els.timeCur.textContent = App.utils.formatDuration(clampedMs);
var remaining = duration - clampedMs;
els.timeDur.textContent = '-' + App.utils.formatDuration(remaining);
if (els.miniProgressTrackFill) els.miniProgressTrackFill.style.width = (pct * 100) + '%';
if (els.miniProgressThumb) els.miniProgressThumb.style.left = (pct * 100) + '%';
if (els.miniProgressBar) els.miniProgressBar.style.setProperty('--progress-val', (pct * 100) + '%');
if (els.miniTimeCur || els.miniTimeJoinedCur) {
  _setMiniTime(App.utils.formatDuration(clampedMs), '-' + App.utils.formatDuration(remaining));
}
if (_lyricsTrackId && App.state.currentTrack && _lyricsTrackId === App.state.currentTrack.id) {
_updateLyrics(clampedMs);
}
if (_videoBg) _videoBg.updatePosition(clampedMs);
};


  np.setTrackInfoHidden = function (hidden) {
    if (hidden && !_trackInfoHidden) {
      _trackInfoHidden = true;
      _animateGlitch(true);
      _setMysteryVisuals(true);
    } else if (!hidden && _trackInfoHidden) {
      _trackInfoHidden = false;
      _needsGlitchRestore = true;
      if (App.state.currentTrack) {
        _preserveHiddenState = true;
        np.updateTrack(App.state.currentTrack);
      }
    }
  };

  function _animateGlitch(toHidden) {
    var dur = _glitchDuration;
    var ease = 'cubic-bezier(0.4, 0, 0.2, 1)';

    var targets = [
      els.title, els.artist, els.album,
      els.miniTitle, els.miniArtist
    ];
    if (els.miniInfo) {
      targets.push(els.miniInfoTitle, els.miniInfoArtist);
    }

    targets.forEach(function (t) {
      if (!t) return;
      t.style.transition = 'opacity ' + dur + 'ms ' + ease;
      t.style.opacity = toHidden ? '0' : '1';
    });

    if (_glitchCleanupTimer) clearTimeout(_glitchCleanupTimer);
    _glitchCleanupTimer = setTimeout(function () {
      targets.forEach(function (t) {
        if (t) t.style.transition = '';
      });
      _glitchCleanupTimer = null;
    }, dur + 60);
  }

  function _setMysteryVisuals(toHidden) {
    var dur = _glitchDuration + 'ms';
    if (toHidden) {
      els.coverImg.style.transition = 'opacity ' + dur + ', filter ' + dur;
      els.coverImg.style.opacity = '0';
      els.coverImg.style.filter = 'blur(12px)';
      els.lyricsWrap.style.transition = 'filter ' + dur + ', opacity ' + dur;
      els.lyricsWrap.style.filter = 'blur(8px)';
      els.lyricsWrap.style.opacity = '0.15';
      _setBgCover(null, null);
      if (_videoBg) _videoBg.clear();
      lyricsData = [];
      lastLyricsIdx = -1;
      lastGroupIdx = -1;
      _miniLrcClear();
    } else {
      els.coverImg.style.transition = 'opacity ' + dur + ', filter ' + dur;
      els.coverImg.style.opacity = '';
      els.coverImg.style.filter = '';
      els.lyricsWrap.style.transition = 'filter ' + dur + ', opacity ' + dur;
      els.lyricsWrap.style.filter = '';
      els.lyricsWrap.style.opacity = '';
      setTimeout(function () {
        els.coverImg.style.transition = '';
        els.lyricsWrap.style.transition = '';
      }, _glitchDuration + 50);
    }
  }

  var _transitionPointMs = -1;

  np.setTransitionPoint = function (transitionStartMs, dur) {
    if (!els.transitionMarker) return;
    if (transitionStartMs < 0 || !dur || dur <= 0) {
      np.clearTransitionPoint();
      return;
    }
    _transitionPointMs = transitionStartMs;
  };

  np.clearTransitionPoint = function () {
    if (!els.transitionMarker) return;
    _transitionPointMs = -1;
    els.transitionMarker.classList.remove('visible');
    if (els.timeRow) els.timeRow.classList.remove('is-transitioning');
  };

  np.showTransition = function (active) {
    if (!els.transitionMarker) return;
    if (active) {
      els.transitionMarker.classList.add('visible');
      if (els.timeRow) els.timeRow.classList.add('is-transitioning');
    } else {
      els.transitionMarker.classList.remove('visible');
      if (els.timeRow) els.timeRow.classList.remove('is-transitioning');
    }
  };

  // ── 音质标识（标准 / 无损 / 高解析度无损 / Dolby Atmos）────────────────
  // 显示位置＝进度条下方两个时间数字之间（与「过渡」共用同一格，互斥显示）。
  // 本地文件由主进程 ffprobe 探测并缓存；流媒体用服务器返回的 suffix 兜底。
  var _qualityEnabled = true;
  var _qualityInfo = null;
  var _qualityToken = 0;
  var _qualityTrackId = '';
  var _qualityFilePath = '';
  var _qualityI18nBound = false;

  var QUALITY_I18N = {
    standard: 'np.quality.standard',
    lossless: 'np.quality.lossless',
    hires: 'np.quality.hires',
    atmos: 'np.quality.atmos',
  };

  function _qualityText(q) {
    var key = QUALITY_I18N[q];
    return key ? App.i18n.t(key) : '';
  }

  // Dolby 双 D 标志（Material Symbols 里没有该图标，只能内联 SVG）。
  // 几何取自 Simple Icons 的 dolby 图标（`M2 5v14h20V5z` 方框内挖空的两个 D），
  // 这里只保留那两个 D 的轮廓作为实心形，即 2019 起的无框双 D。宽高比 16:10 ✓
  var DOLBY_ICON_SVG =
    '<svg class="np-quality-icon" viewBox="4 7 16 10" aria-hidden="true" focusable="false">' +
      '<path fill="currentColor" d="' +
        'M4 7H6C8.86 7.09 11.1 9.33 11 12C11.1 14.67 8.86 16.91 6 17H4Z' +
        'M20 7H18C15.14 7.09 12.9 9.33 13 12C12.9 14.67 15.14 16.91 18 17H20Z' +
      '"/>' +
    '</svg>';

  function _qualityDetail(info) {
    var parts = [];
    if (info.codec) parts.push(String(info.codec).toUpperCase());
    var sr = Number(info.sampleRate) || 0;
    if (sr >= 1000) {
      var khz = sr / 1000;
      parts.push((khz % 1 === 0 ? String(khz) : khz.toFixed(1)) + ' kHz');
    }
    var bits = Number(info.bitsPerSample) || 0;
    if (bits > 0) parts.push(bits + '-bit');
    var br = Number(info.bitrate) || 0;
    if (br > 0) parts.push(Math.round(br / 1000) + ' kbps');
    return parts.join(' · ');
  }

  function _renderQuality() {
    if (!els.qualityLabel) return;
    var label = els.qualityLabel;
    var q = (_qualityEnabled && _qualityInfo && _qualityInfo.quality) ? _qualityInfo.quality : '';
    var text = q ? _qualityText(q) : '';
    var detail = (text && q) ? _qualityDetail(_qualityInfo) : '';
    var wantAtmos = (text && q === 'atmos');

    // 只有「图标 + 文案」组合变化时才重建 DOM，避免重复刷 innerHTML 造成闪烁
    var sig = (wantAtmos ? 'a|' : 't|') + text;
    if (label._qualitySig !== sig) {
      label._qualitySig = sig;
      label.innerHTML = (wantAtmos ? DOLBY_ICON_SVG : '') + '<span class="np-quality-text"></span>';
      var span = label.querySelector('.np-quality-text');
      if (span) span.textContent = text;
    }

    label.title = (text && detail) ? (text + ' · ' + detail) : '';
    if (text) label.classList.add('visible');
    else label.classList.remove('visible');
  }

  function _requestQuality(track) {
    var token = ++_qualityToken;
    var nextId = (track && track.id) ? String(track.id) : '';
    var nextPath = (track && track.path) ? String(track.path) : '';
    var sameTrack = (nextId === _qualityTrackId && nextPath === _qualityFilePath);
    _qualityTrackId = nextId;
    _qualityFilePath = nextPath;

    // 换曲时立刻清掉：否则上一首的音质会残留到新曲目探测结果返回为止
    if (!sameTrack) {
      _qualityInfo = null;
      _renderQuality();
    }

    if (!_qualityEnabled || !track) {
      _qualityInfo = null;
      _renderQuality();
      return;
    }
    if (!App.utils || !App.utils.call) {
      _renderQuality();
      return;
    }

    App.utils.call('get_track_quality', _qualityTrackId, _qualityFilePath, track.suffix || '')
      .then(function (res) {
        if (token !== _qualityToken) return;
        if (!res || res.pending || res.unsupported || !res.quality) return;
        _qualityInfo = res;
        _renderQuality();
      })
      .catch(function () {});
  }

  np.onQualityReady = function (payload) {
    if (!payload || !payload.quality || !_qualityEnabled) return;
    var byId = !!payload.trackId && payload.trackId === _qualityTrackId;
    var byPath = !!payload.filePath && payload.filePath === _qualityFilePath;
    if (!byId && !byPath) return;
    _qualityInfo = payload;
    _renderQuality();
  };

  np.setQualityEnabled = function (enabled) {
    var on = !!enabled;
    if (_qualityEnabled === on) return;
    _qualityEnabled = on;
    if (!on) {
      _qualityToken++;
      _qualityInfo = null;
      _renderQuality();
      return;
    }
    _requestQuality(App.state && App.state.currentTrack);
  };

  function _normalizeActionIds(list) {
    var out = [];
    var seen = {};
    (Array.isArray(list) ? list : []).forEach(function (id) {
      if (typeof id !== 'string') return;
      if (!NP_SECONDARY_ACTIONS[id]) return;
      if (seen[id]) return;
      if (out.length >= NP_SECONDARY_MAX) return;
      seen[id] = 1;
      out.push(id);
    });
    return out;
  }

  function _actionButtonHtml(action) {
    var title = App.i18n.t(action.titleKey);
    var aria = App.i18n.t(action.ariaKey || action.titleKey);
    if (action.variant === 'audio_mode') {
      return '<button class="np-audio-mode-btn np-secondary-btn" type="button" data-action="' + action.id +
        '" aria-label="' + aria + '" title="' + title + '">' +
        '<span class="np-audio-mode-label">shrd</span>' +
      '</button>';
    }
    var iconStyle = action.rotate180 ? ' style="transform:rotate(180deg)"' : '';
    var badge = action.labels
      ? '<span class="np-secondary-badge">' + action.labels + '</span>'
      : '';
    return '<button class="icon-btn np-secondary-btn" type="button" data-action="' + action.id +
      '" aria-label="' + aria + '" title="' + title + '">' +
      '<span class="material-symbols-rounded"' + iconStyle + '>' + action.icon + '</span>' +
      badge +
    '</button>';
  }

  function _ensureSecondaryControls() {
    if (els.secondaryControls && els.secondaryControls.isConnected) return els.secondaryControls;
    els.secondaryControls = document.getElementById('np-secondary-controls');
    _secondaryControlsBound = false;
    return els.secondaryControls;
  }

  np.renderSecondaryActions = function (ids) {
    var host = _ensureSecondaryControls();
    if (!host) return;
    if (!_secondaryControlsBound) _bindSecondaryControls();
    if (ids !== undefined && ids !== null) {
      var norm = _normalizeActionIds(ids);
      _secondaryActionIds = norm.length ? norm : NP_SECONDARY_DEFAULT.slice();
    }
    var html = _secondaryActionIds.map(function (id) {
      return _actionButtonHtml(NP_SECONDARY_ACTIONS[id]);
    }).join('');
    host.innerHTML = html;
    _syncSecondaryActions();
  };

  np.getSecondaryActions = function () {
    return _secondaryActionIds.slice();
  };
  np.NP_SECONDARY_ACTIONS = NP_SECONDARY_ACTIONS;
  np.NP_SECONDARY_MAX = NP_SECONDARY_MAX;

  function _syncSecondaryActions() {
    var host = _ensureSecondaryControls();
    if (!host) return;
    var externalTrack = !!(App.state.currentTrack && App.state.currentTrack.external);
    if (els.miniBtnLike) els.miniBtnLike.disabled = externalTrack;
    host.querySelectorAll('[data-action]').forEach(function (btn) {
      var action = NP_SECONDARY_ACTIONS[btn.dataset.action];
      if (!action) return;

      if (action.variant === 'audio_mode') {
        var label = btn.querySelector('.np-audio-mode-label');
        var on = action.isActive ? action.isActive() : false;
        if (label) label.textContent = on ? 'excl' : 'shrd';
        btn.classList.toggle('active', on);
        var t = App.i18n.t(on ? 'np.exclusiveMode' : 'np.sharedMode');
        btn.setAttribute('title', t);
        return;
      }

      var iconEl = btn.querySelector('.material-symbols-rounded');
      if (action.id === 'repeat') {
        var rep = App.state.repeat;
        if (iconEl) iconEl.textContent = (rep === 'one') ? 'repeat_one' : 'repeat';
      } else if (action.id === 'mute') {
        var muted = action.isMuted ? action.isMuted() : false;
        if (iconEl) iconEl.textContent = muted ? 'volume_off' : 'volume_up';
      }

      if (action.isLiked) {
        var liked = action.isLiked();
        btn.classList.toggle('liked', liked);
        btn.classList.toggle('active', false);
        if (iconEl) iconEl.classList.toggle('icon-filled', liked);
        if (action.id === 'like') btn.disabled = externalTrack;
      } else if (action.isActive) {
        btn.classList.toggle('active', action.isActive());
      }
    });
  }

  function _bindSecondaryControls() {
    var host = _ensureSecondaryControls();
    if (!host || _secondaryControlsBound) return;
    _secondaryControlsBound = true;
    host.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-action]');
      if (!btn || !host.contains(btn)) return;
      var action = NP_SECONDARY_ACTIONS[btn.dataset.action];
      if (action && action.onClick) action.onClick();
    });
  }

  function _seekBy(seconds) {
    if (!duration) return;
    var target = _lastKnownPositionMs + seconds * 1000;
    target = Math.max(0, Math.min(duration, target));
    App.backend.seek(Math.floor(target));
    if (App.utils && App.utils.toast) {
      var sign = seconds > 0 ? '+' : '−';
      App.utils.toast(sign + Math.abs(seconds) + 's');
    }
  }

  let _lyricPress = null;
  function _onLyricsPress(e) {
    _lyricPress = { x: e.clientX, y: e.clientY };
  }
  function _formatSeekTarget(lyricMs) {
    if (!App.utils || !App.utils.formatDuration) return '';
    var pos = Math.max(0, Math.min(duration || Infinity, lyricMs + lyricsTimeOffset));
    return App.utils.formatDuration(pos);
  }
  function _refreshLyricTimeLabels() {
    if (!els.lyricsWrap) return;
    var lines = els.lyricsWrap.querySelectorAll('.np-lyrics-line[data-time]');
    for (var i = 0; i < lines.length; i++) {
      lines[i].dataset.timeLabel = _formatSeekTarget(parseInt(lines[i].dataset.time, 10));
    }
  }
  function _onLyricsClick(e) {
    if (_lyricPress &&
        (Math.abs(e.clientX - _lyricPress.x) > 6 || Math.abs(e.clientY - _lyricPress.y) > 6)) {
      _lyricPress = null;
      return;
    }
    _lyricPress = null;
    if (!duration) return;

    var target = null;
    var word = e.target.closest ? e.target.closest('.np-lyrics-word') : null;
    var line = e.target.closest ? e.target.closest('.np-lyrics-line') : null;
    var interlude = e.target.closest ? e.target.closest('.np-lyrics-interlude') : null;
    if (word) {
      target = parseInt(word.dataset.time, 10);
    } else if (line) {
      target = parseInt(line.dataset.time, 10);
    } else if (interlude) {
      target = parseInt(interlude.dataset.nextTime, 10);
    }
    if (target === null || isNaN(target)) return;

    var pos = target + lyricsTimeOffset;
    pos = Math.max(0, Math.min(duration, pos));
    if (Math.abs(pos - _lastKnownPositionMs) < 400) return;

    App.backend.seek(Math.floor(pos));
    _updateLyrics(pos);
    if (App.utils && App.utils.toast) {
      App.utils.toast(App.utils.formatDuration(pos));
    }
  }

  function _toggleMuteFromNp() {
    App.utils.call('get_player_state').then(function (res) {
      var st = JSON.parse(res);
      var cur = st.volume || 0;
      if (cur > 0) {
        _lastVolumeBeforeMute = cur;
        App.backend.set_volume(0);
      } else {
        App.backend.set_volume(_lastVolumeBeforeMute || 80);
      }
    });
  }
  let _lastVolumeBeforeMute = 80;

  function _openAudioSettings() {
    if (App.navigate) App.navigate('settings');
    if (App.pages && App.pages.settings && App.pages.settings.activateSection) {
      App.pages.settings.activateSection('playback');
    }
  }

  np.updateVolume = function (vol) {
    els.sliderVol.value = vol;
    els.labelVol.textContent = vol;
    
    const max = parseInt(els.sliderVol.max, 10) || 100;
    const percentage = (vol / max) * 100;
    els.sliderVol.style.setProperty('--volume-val', `${percentage}%`);

    if (vol === 0) {
      els.iconVol.textContent = 'volume_off';
    } else if (vol < 50) {
      els.iconVol.textContent = 'volume_down';
    } else {
      els.iconVol.textContent = 'volume_up';
    }

    _isMuted = (vol === 0);
    _syncSecondaryActions();
  };

  np.updateModes = function (shuffle, repeat) {
    _syncSecondaryActions();
  };

  np.updateLiked = function (liked) {
    _isLiked = !!liked;
    _syncSecondaryActions();
    if (liked) {
      if (els.miniBtnLike) {
        els.miniBtnLike.classList.add('liked');
        els.miniBtnLike.querySelector('.material-symbols-rounded').classList.add('icon-filled');
      }
    } else {
      if (els.miniBtnLike) {
        els.miniBtnLike.classList.remove('liked');
        els.miniBtnLike.querySelector('.material-symbols-rounded').classList.remove('icon-filled');
      }
    }
  };

  np.updateLyrics = function (trackId, lyrics) {
    var track = App.state.currentTrack;
    if (!track || track.id !== trackId) return;

    track.lyrics = lyrics;

    if (_pendingLyricsSource) {
      lyricsSource = _pendingLyricsSource;
      _pendingLyricsSource = null;
    } else if (lyrics) {
      lyricsSource = 'embedded';
    } else {
      lyricsSource = null;
    }

    _renderLyrics(track);
  };

  np.updateAudioMode = function (exclusive) {
    _syncSecondaryActions();
  };

  np.openAudioModeDialog = function (targetOn) {
    App.utils.confirmExclusiveSwitch(targetOn).then(function (ok) {
      if (!ok) return;
      App.utils.call('set_wasapi_exclusive', targetOn).then(function (actual) {
        var actualOn = (actual === 'wasapi_exclusive');
        App.state.isExclusive = actualOn;
        np.updateAudioMode(actualOn);
        if (actualOn !== targetOn) {
          App.utils.confirmDialog({
            title: App.i18n.t('audio.fallbackTitle'),
            body: App.i18n.t('audio.fallbackBody'),
            confirmText: App.i18n.t('common.ok'),
            cancelText: App.i18n.t('common.close'),
          });
        }
      });
    });
  };


  const QUEUE_ROW_HEIGHT = 56;
  let _queueVL = null;

  function _renderQueueItem(el, track, index, currentIndex) {
    el.className = 'np-queue-item' + (index === currentIndex ? ' current' : '');
    el.dataset.index = index;
    el.draggable = true;

    let coverHtml;
    if (track.has_cover) {
      coverHtml = `<img loading="lazy" decoding="async" src="${window.coverUrl(track.id, 128)}" alt="">`;
    } else {
      const bg = App.utils.hashColor(track.album || track.title);
      coverHtml = `<div class="np-queue-cover" style="background:${bg}">${App.utils.initial(track.album || track.title)}</div>`;
    }

    el.innerHTML = `
      <button class="np-queue-drag" aria-label="${App.i18n.t('np.dragToReorder') || ''}">
        <span class="np-queue-drag-icon"></span>
      </button>
      <div class="np-queue-cover-wrap">${coverHtml}</div>
      <div class="np-queue-info">
        <div class="np-queue-title">${App.utils.esc(track.title || App.i18n.t('common.unknownTrack'))}</div>
        <div class="np-queue-artist">${App.utils.esc(track.artist || App.i18n.t('common.unknownArtist'))}</div>
      </div>
      <div class="np-queue-duration">${App.utils.formatDuration(track.duration_ms)}</div>
      <button class="icon-btn np-queue-remove" title="${App.i18n.t('np.removeFromQueue')}">
        <span class="material-symbols-rounded" style="font-size:18px">close</span>
      </button>
    `;
  }

  np.updateQueue = function (queue, currentIndex) {
    const list = els.queueList;
    if (!list) return;

    if (!queue || queue.length === 0) {
      if (_queueVL) { _queueVL.destroy(); _queueVL = null; }
      list.innerHTML = '';
      return;
    }

    _queueData = queue;
    _queueCurrentIndex = currentIndex;

    if (_queueVL && _queueVL.container === list) {
      _queueVL.setItems(queue);
      _queueVL.refresh();
    } else {
      if (_queueVL) { _queueVL.destroy(); _queueVL = null; }
      list.innerHTML = '';
      list.classList.add('np-queue-vl');
      _queueVL = new window.VirtualList({
        container: list,
        items: queue,
        itemHeight: QUEUE_ROW_HEIGHT,
        estimatedItemHeight: QUEUE_ROW_HEIGHT,
        bufferSize: 8,
        onRangeChange: function (items, startIndex, endIndex, direction) {
          if (window.CoverCache && window.CoverCache.updateViewport) {
            window.CoverCache.updateViewport(
              items.map(function (t) { return { track: t }; }),
              startIndex, endIndex, direction, 128
            );
          }
        },
        onRecycle: function (el) {
          if (window.CoverCache && window.CoverCache.releaseElement) {
            window.CoverCache.releaseElement(el);
          }
        },
        renderItem: function (track, index, el) {
          el.classList.add('vl-item');
          _renderQueueItem(el, track, index, _queueCurrentIndex);
        },
      });
    }

    _bindQueueDelegation();
  };

  let _queueData = [];
  let _queueCurrentIndex = 0;
  let _queueDelegationBound = false;
  var _draggedQueueItem = null;

  function _bindQueueDelegation() {
    if (_queueDelegationBound) return;
    const list = els.queueList;
    if (!list) return;
    _queueDelegationBound = true;

    list.addEventListener('click', function (e) {
      const item = e.target.closest('.np-queue-item');
      if (!item) return;
      const index = parseInt(item.dataset.index, 10);
      if (e.target.closest('.np-queue-remove')) {
        e.stopPropagation();
        App.backend.remove_from_queue(index);
        return;
      }
      if (e.target.closest('.np-queue-drag')) return;
      App.backend.play_queue_at(index);
    });

    list.addEventListener('dragstart', function (e) {
      const item = e.target.closest('.np-queue-item');
      if (!item) return;
      _draggedQueueItem = item;
      item.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', item.dataset.index);
    });

    list.addEventListener('dragend', function () {
      if (_draggedQueueItem) _draggedQueueItem.classList.remove('dragging');
      _draggedQueueItem = null;
      list.querySelectorAll('.np-queue-item').forEach(function (it) {
        it.classList.remove('drag-over-top', 'drag-over-bottom');
      });
    });

    list.addEventListener('dragover', function (e) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const item = e.target.closest('.np-queue-item');
      list.querySelectorAll('.np-queue-item').forEach(function (it) {
        if (it !== item) it.classList.remove('drag-over-top', 'drag-over-bottom');
      });
      if (!item || item === _draggedQueueItem) return;
      const rect = item.getBoundingClientRect();
      const mid = rect.top + rect.height / 2;
      item.classList.remove('drag-over-top', 'drag-over-bottom');
      item.classList.add(e.clientY < mid ? 'drag-over-top' : 'drag-over-bottom');
    });

    list.addEventListener('dragleave', function (e) {
      const item = e.target.closest('.np-queue-item');
      if (item) item.classList.remove('drag-over-top', 'drag-over-bottom');
    });

    list.addEventListener('drop', function (e) {
      e.preventDefault();
      if (!_draggedQueueItem) return;
      const fromIndex = parseInt(_draggedQueueItem.dataset.index, 10);
      const targetItem = e.target.closest('.np-queue-item');

      let toIndex;
      if (targetItem) {
        toIndex = parseInt(targetItem.dataset.index, 10);
        const rect = targetItem.getBoundingClientRect();
        const mid = rect.top + rect.height / 2;
        if (e.clientY >= mid) toIndex += 1;
      } else {
        toIndex = _queueData.length;
      }
      if (fromIndex < toIndex) toIndex -= 1;
      if (fromIndex !== toIndex) App.backend.reorder_queue(fromIndex, toIndex);
      _draggedQueueItem.classList.remove('dragging');
      _draggedQueueItem = null;
    });
  }

  function _openDropdown() {
    els.dropdownMenu.style.display = 'block';
    els.btnMoreDropdown.classList.add('active');
  }

  function _closeDropdown() {
    els.dropdownMenu.style.display = 'none';
    els.btnMoreDropdown.classList.remove('active');
  }

  function _toggleFullscreen() {
    const pane = document.getElementById('now-playing-pane');
    if (!pane) return;
    const enteringFullscreen = !pane.classList.contains('fullscreen');

    if (!enteringFullscreen && _npDefaultView === 'fullscreen') {
      _toggleCollapse();
      return;
    }

    if (!enteringFullscreen && pane.classList.contains('theater')) {
      _exitTheater();
    }
    pane.classList.add('fs-transitioning');

    pane.classList.toggle('fullscreen', enteringFullscreen);
    document.body.classList.toggle('np-fullscreen', enteringFullscreen);
    if (_videoBg) _videoBg.onFullscreenChange();

    if (enteringFullscreen) {
      _applyContentModePanels(true);
      _startBeatLoop();
      requestAnimationFrame(function () {
        _applyContentModePanels(true);
      });
    } else {
      const activeTab = document.querySelector('.np-pivot-tab.active');
      switchTab(activeTab ? activeTab.getAttribute('data-tab') : 'info', false);
      _stopBeatLoop();
      requestAnimationFrame(function () {
        var anyActive = false;
        els.panels.forEach(function (p) { if (p.classList.contains('active')) anyActive = true; });
        if (!anyActive) {
          switchTab('info', false);
        }
      });
    }

    setTimeout(function () {
      pane.classList.remove('fs-transitioning');
      if (enteringFullscreen) {
        _applyContentModePanels(true);
      } else {
        var anyActive = false;
        els.panels.forEach(function (p) { if (p.classList.contains('active')) anyActive = true; });
        if (!anyActive) switchTab('info', false);
      }
    }, 320);
  }

  var _theaterIdleTimer = null;
  var _theaterIdleDelay = 10000;

  function _toggleTheater() {
    var pane = document.getElementById('now-playing-pane');
    if (!pane) return;

    var isTheater = pane.classList.contains('theater');
    if (isTheater) {
      _exitTheater();
    } else {
      if (!pane.classList.contains('fullscreen')) {
        pane.classList.add('fullscreen');
        document.body.classList.add('np-fullscreen');
        _applyContentModePanels(true);
        _startBeatLoop();
      }
      pane.classList.add('theater');
      _startTheaterIdleTimer();
      if (_videoBg) _videoBg.onFullscreenChange();
      document.addEventListener('mousemove', _onTheaterActivity);
      document.addEventListener('touchstart', _onTheaterActivity);
      document.addEventListener('keydown', _onTheaterActivity);
      if (App.backend && App.backend.toggle_fullscreen) {
        App.backend.toggle_fullscreen();
      }
    }
  }

  function _exitTheater() {
    var pane = document.getElementById('now-playing-pane');
    if (!pane) return;
    pane.classList.remove('theater', 'controls-hidden');
    _stopTheaterIdleTimer();
    if (_videoBg) _videoBg.onFullscreenChange();
    document.removeEventListener('mousemove', _onTheaterActivity);
    document.removeEventListener('touchstart', _onTheaterActivity);
    document.removeEventListener('keydown', _onTheaterActivity);
    if (App.backend && App.backend.toggle_fullscreen) {
      App.backend.toggle_fullscreen();
    }
  }

  function _onTheaterActivity() {
    var pane = document.getElementById('now-playing-pane');
    if (!pane || !pane.classList.contains('theater')) return;
    pane.classList.remove('controls-hidden');
    _startTheaterIdleTimer();
  }

  function _startTheaterIdleTimer() {
    _stopTheaterIdleTimer();
    _theaterIdleTimer = setTimeout(function () {
      var pane = document.getElementById('now-playing-pane');
      if (pane && pane.classList.contains('theater')) {
        pane.classList.add('controls-hidden');
      }
    }, _theaterIdleDelay);
  }

  function _stopTheaterIdleTimer() {
    if (_theaterIdleTimer) {
      clearTimeout(_theaterIdleTimer);
      _theaterIdleTimer = null;
    }
  }

  var _expandTimers = [];

  function _clearExpandTimers() {
    _expandTimers.forEach(function (t) { clearTimeout(t); });
    _expandTimers = [];
  }

  function _toggleCollapse() {
    const pane = document.getElementById('now-playing-pane');
    if (!pane) return;
    if (document.body.classList.contains('settings-active')) return;
    if (pane.classList.contains('theater')) {
      _exitTheater();
    }

    if (_npDefaultView === 'fullscreen') {
      _toggleCollapseFullscreenDefault(pane);
      return;
    }

if (pane.classList.contains('fullscreen')) {
pane.classList.remove('fullscreen');
document.body.classList.remove('np-fullscreen');
const activeTab = document.querySelector('.np-pivot-tab.active');
switchTab(activeTab ? activeTab.getAttribute('data-tab') : 'info', false);
if (_videoBg) _videoBg.onFullscreenChange();
}

    var isCollapsed = pane.classList.contains('collapsed');
    var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    _clearExpandTimers();

    var content = document.querySelector('.content-pane');

    function _flipContent(firstRect, contentEl, reducedMotion) {
      if (!contentEl || !firstRect || reducedMotion) return;
      var lastRect = contentEl.getBoundingClientRect();
      var scaleX = firstRect.width / lastRect.width;
      if (Math.abs(scaleX - 1) < 0.01) return;
      contentEl.style.transformOrigin = 'left center';
      contentEl.style.transform = 'scaleX(' + scaleX + ')';
      contentEl.style.willChange = 'transform';
      contentEl.offsetHeight;
      var flip = contentEl.animate([
        { transform: 'scaleX(' + scaleX + ')' },
        { transform: 'scaleX(1)' }
      ], { duration: 200, easing: 'cubic-bezier(0.05, 0.7, 0.1, 1)', fill: 'none' });
      flip.onfinish = function () {
        contentEl.style.transform = '';
        contentEl.style.transformOrigin = '';
        contentEl.style.willChange = '';
      };
    }

    if (isCollapsed) {
      document.body.classList.add('player-expanding');
      var mp = els.miniPlayer;

      var firstRect = content ? content.getBoundingClientRect() : null;

      if (mp && !reduced) {
        mp.classList.add('mini-leaving');
      }

      _expandTimers.push(setTimeout(function () {
        pane.classList.remove('collapsed');
        document.body.classList.remove('player-collapsed');
        pane.classList.add('expanding');
        _flipContent(firstRect, content, reduced);

        if (mp && mp.classList.contains('mini-leaving')) {
          mp.classList.remove('mini-leaving');
        }
      }, 120));

      _expandTimers.push(setTimeout(function () {
        document.body.classList.remove('player-expanding');
        pane.classList.remove('expanding');
      }, 340));
    } else {
      document.body.classList.add('player-collapsing');
      pane.classList.add('collapsing');
      var mp2 = els.miniPlayer;

      var firstRect2 = content ? content.getBoundingClientRect() : null;


      _expandTimers.push(setTimeout(function () {
        pane.classList.add('collapsed');
        document.body.classList.add('player-collapsed');
        _flipContent(firstRect2, content, reduced);

        if (mp2 && !reduced) {
          mp2.classList.add('mini-entering');
        }
      }, 120));

      _expandTimers.push(setTimeout(function () {
        document.body.classList.remove('player-collapsing');
        pane.classList.remove('collapsing');
        if (mp2 && mp2.classList.contains('mini-entering')) {
          mp2.classList.remove('mini-entering');
        }
      }, 360));
    }
  }

  function _toggleCollapseFullscreenDefault(pane) {
    var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    _clearExpandTimers();
    pane.classList.remove('expanding', 'collapsing', 'fs-transitioning');

    if (pane.classList.contains('collapsed')) {
      document.body.classList.add('player-expanding');
      var mp = els.miniPlayer;

      if (mp && !reduced) {
        mp.classList.add('mini-leaving');
      }

      _expandTimers.push(setTimeout(function () {
        pane.classList.remove('collapsed');
        document.body.classList.remove('player-collapsed');
        pane.classList.add('fullscreen');
        document.body.classList.add('np-fullscreen');
        pane.classList.add('fs-transitioning');

        if (mp && mp.classList.contains('mini-leaving')) {
          mp.classList.remove('mini-leaving');
        }

        _applyContentModePanels(true);
        _startBeatLoop();
        if (_videoBg) _videoBg.onFullscreenChange();
        requestAnimationFrame(function () {
          _applyContentModePanels(true);
        });
      }, 120));

      _expandTimers.push(setTimeout(function () {
        document.body.classList.remove('player-expanding');
        pane.classList.remove('fs-transitioning');
        _applyContentModePanels(true);
      }, 440));
    } else {
      if (pane.classList.contains('theater')) {
        _exitTheater();
      }

      document.body.classList.add('player-collapsing');
      pane.classList.add('collapsing');

      _applyContentModePanels(true);
      _stopBeatLoop();
      if (_videoBg) _videoBg.onFullscreenChange();

      var mp2 = els.miniPlayer;

      _expandTimers.push(setTimeout(function () {
        pane.classList.remove('fullscreen');
        document.body.classList.remove('np-fullscreen');
        pane.classList.add('collapsed');
        document.body.classList.add('player-collapsed');

        if (mp2 && !reduced) {
          mp2.classList.add('mini-entering');
        }
      }, 120));

      _expandTimers.push(setTimeout(function () {
        document.body.classList.remove('player-collapsing');
        pane.classList.remove('collapsing');
        if (mp2 && mp2.classList.contains('mini-entering')) {
          mp2.classList.remove('mini-entering');
        }
      }, 360));
    }
  }

  function switchTab(tabName, forceFullscreen) {
    els.pivotTabs.forEach(function (tab) {
      var isActive = tab.getAttribute('data-tab') === tabName;
      tab.classList.toggle('active', isActive);
      tab.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });
    const pane = document.getElementById('now-playing-pane');
    const isFullscreen = forceFullscreen !== undefined ? forceFullscreen : (pane && pane.classList.contains('fullscreen'));
    els.panels.forEach(function (panel) {
      const isInfoPanel = panel.getAttribute('data-panel') === 'info';
      panel.classList.toggle('active', (isFullscreen && isInfoPanel) || panel.getAttribute('data-panel') === tabName);
    });
    if (els.miniInfo) {
      if (tabName === 'info' || isFullscreen) {
        els.miniInfo.style.display = 'none';
      } else {
        els.miniInfo.style.display = 'flex';
      }
    }
    updatePivotIndicator();
  }

  function updatePivotIndicator() {
    if (!els.pivotIndicator) return;
    var activeTab = document.querySelector('.np-pivot-tab.active');
    if (!activeTab) return;
    var parentRect = activeTab.parentElement.getBoundingClientRect();
    var tabRect = activeTab.getBoundingClientRect();
    els.pivotIndicator.style.left = (tabRect.left - parentRect.left) + 'px';
    els.pivotIndicator.style.width = tabRect.width + 'px';
  }

  function _captureContentFlip() {
    var pane = document.getElementById('now-playing-pane');
    if (!pane || !pane.classList.contains('fullscreen')) return null;
    if (pane.classList.contains('fs-transitioning')) return null;
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return null;
    var candidates = [
      pane.querySelector('.np-panel--info.active'),
      pane.querySelector('.np-panel--lyrics.active'),
      pane.querySelector('.np-panel--queue.active'),
      pane.querySelector('.np-pivot'),
      pane.querySelector('.np-main-controls'),
      pane.querySelector('.np-secondary-controls'),
      pane.querySelector('.np-volume')
    ];
    var before = new Map();
    candidates.forEach(function (el) {
      if (el && window.getComputedStyle(el).display !== 'none') before.set(el, el.getBoundingClientRect());
    });
    return { candidates: candidates, before: before };
  }

  function _playContentFlip(state) {
    if (!state) return;
    var EASE = 'cubic-bezier(0.05, 0.7, 0.1, 1)';
    state.candidates.forEach(function (el) {
      if (!el) return;
      var visibleNow = window.getComputedStyle(el).display !== 'none';
      var firstRect = state.before.get(el);
      if (!firstRect) {
        if (visibleNow) {
          el.animate([
            { opacity: 0, transform: 'translateY(14px)' },
            { opacity: 1, transform: 'translateY(0)' }
          ], { duration: 200, delay: 50, easing: EASE, fill: 'backwards' });
        }
        return;
      }
      if (!visibleNow) return;
      var last = el.getBoundingClientRect();
      var dx = firstRect.left - last.left;
      var dy = firstRect.top - last.top;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
      el.style.willChange = 'transform';
      var anim = el.animate([
        { transform: 'translate(' + dx + 'px, ' + dy + 'px)' },
        { transform: 'translate(0px, 0px)' }
      ], { duration: 260, easing: EASE, fill: 'none' });
      anim.onfinish = function () { el.style.willChange = ''; };
    });
  }

  function setContentMode(mode, persist) {
    if (mode !== 'solo' && mode !== 'lyrics') mode = 'duo';
    var changed = mode !== _npContentMode;
    var pane = document.getElementById('now-playing-pane');
    var flipState = changed ? _captureContentFlip() : null;
    _npContentMode = mode;
    if (pane) {
      pane.classList.remove('np-content-solo', 'np-content-duo', 'np-content-lyrics');
      pane.classList.add('np-content-' + mode);
    }
    els.contentSegs.forEach(function (seg) {
      var isActive = seg.getAttribute('data-mode') === mode;
      seg.classList.toggle('active', isActive);
      seg.setAttribute('aria-checked', isActive ? 'true' : 'false');
    });
    if (pane && pane.classList.contains('fullscreen')) {
      _applyContentModePanels(true);
    }
    if (flipState) _playContentFlip(flipState);
    if (persist !== false) {
      App.utils.call('save_settings', JSON.stringify({ np_content_mode: mode }));
    }
  }

  function _applyContentModePanels(forceFullscreen) {
    var pane = document.getElementById('now-playing-pane');
    var isFullscreen = forceFullscreen !== undefined ? forceFullscreen : (pane && pane.classList.contains('fullscreen'));
    if (!isFullscreen) return;
    if (_npContentMode === 'solo') {
      switchTab('info', true);
    } else if (_npContentMode === 'lyrics') {
      switchTab('lyrics', true);
    } else {
      var activeTab = document.querySelector('.np-pivot-tab.active');
      var tabName = activeTab ? activeTab.getAttribute('data-tab') : 'lyrics';
      switchTab(tabName === 'info' ? 'lyrics' : tabName, true);
    }
  }


function _updateLyricsSourceBadge() {
  if (!els.lyricsSource) return;
  var labels = {
    'embedded': 'EMBEDDED',
    'ncm': 'NETEASE CLOUD MUSIC',
    'qqmusic': 'QQ MUSIC',
    'lrclib': 'LRCLIB',
    'amll': 'AMLL TTML DB',
    'subsonic': 'EMBEDDED(SUBSONIC)',
  };
  var displaySource = lyricsSource || lyricsSearchSource;
  var label = labels[displaySource] || labels[lyricsSearchSource] || 'SELECT SOURCE';
  els.lyricsSource.style.display = '';
  if (els.lyricsSourceLabel) {
    els.lyricsSourceLabel.textContent = label;
  }
  _updateSourceDropdownActive();
}

  function _updateSourceDropdownActive() {
    if (!els.lyricsSourceOptions) return;
    var activeSource = lyricsSource || lyricsSearchSource;
    if (activeSource === 'subsonic') activeSource = 'embedded';
    els.lyricsSourceOptions.forEach(function (opt) {
      var source = opt.getAttribute('data-source');
      opt.classList.toggle('active', source === activeSource);
    });
  }

  function _updateEmbeddedOptionVisibility() {
    if (!els.lyricsSourceOptions) return;
    els.lyricsSourceOptions.forEach(function (opt) {
      if (opt.getAttribute('data-source') === 'embedded') {
        opt.hidden = !_hasEmbeddedLyrics;
      }
    });
  }


  function _toggleSourceDropdown() {
    if (!els.lyricsSource) return;
    els.lyricsSource.classList.toggle('dropdown-open');
  }

  function _closeSourceDropdown() {
    if (!els.lyricsSource) return;
    els.lyricsSource.classList.remove('dropdown-open');
  }

  function _selectLyricsSource(source) {
    if (source === 'embedded') {
      _loadEmbeddedLyrics();
      return;
    }

    lyricsSearchSource = source;
    _updateSourceDropdownActive();

    var track = App.state.currentTrack;
    if (!track) return;

    if (els.lyrics) {
      els.lyrics.innerHTML =
        '<div class="np-lyrics-placeholder lyrics-searching">' +
          '<span class="material-symbols-rounded">progress_activity</span>' +
          '<p>' + App.i18n.t('np.searchingLyrics') + '</p>' +
        '</div>';
    }

    _autoSearchGen++;
    var gen = _autoSearchGen;
    var title = (track.title || '').trim();
    var artist = (track.artist || '').trim();
    var query = artist ? (artist + ' ' + title) : title;
    if (!query) {
      _showAutoSearchFailed();
      return;
    }

    _searchLyricsBySource(track, gen, query, source);
  }

  function _loadEmbeddedLyrics() {
    var track = App.state.currentTrack;
    if (!track) return;

    if (els.lyrics) {
      els.lyrics.innerHTML =
        '<div class="np-lyrics-placeholder lyrics-searching">' +
          '<span class="material-symbols-rounded">progress_activity</span>' +
          '<p>' + App.i18n.t('np.loadingEmbeddedLyrics') + '</p>' +
        '</div>';
    }

    App.utils.call('get_embedded_lyrics', track.id).then(function (res) {
      if (!App.state.currentTrack || App.state.currentTrack.id !== track.id) return;

      if (res && res.trim()) {
        _pendingLyricsSource = 'embedded';
        App.utils.call('apply_lyrics_temporary', track.id, res);
      } else {
        if (els.lyrics) {
          els.lyrics.innerHTML =
            '<div class="np-lyrics-placeholder">' +
              '<span class="material-symbols-rounded">lyrics</span>' +
              '<p>' + App.i18n.t('np.noEmbeddedLyrics') + '</p>' +
            '</div>';
        }
        _updateLyricsSourceBadge(true);
      }
    });
  }

  function _checkEmbeddedLyrics(track) {
    if (!track || !track.id) return;
    if (track.source === 'subsonic') return;
    App.utils.call('get_embedded_lyrics', track.id).then(function (res) {
      if (!App.state.currentTrack || App.state.currentTrack.id !== track.id) return;
      _hasEmbeddedLyrics = !!(res && res.trim());
      _updateEmbeddedOptionVisibility();
    });
  }

  function _updateLyricsToggleVisibility() {
    if (!els.lyrics) return;
    var hasTrans = els.lyrics.querySelectorAll('.np-lyrics-trans').length > 0;
    var hasRomaji = els.lyrics.querySelectorAll('.np-lyrics-romaji').length > 0;
    if (els.lyricsTransBtn) {
      els.lyricsTransBtn.style.display = hasTrans ? '' : 'none';
    }
    if (els.lyricsRomajiBtn) {
      els.lyricsRomajiBtn.style.display = hasRomaji ? '' : 'none';
    }
  }

  function _openLyricsSearch() {
    if (!els.lyricsSearchOverlay) return;
    if (els.lyricsSettingsPopup && els.lyricsSettingsPopup.style.display !== 'none') {
      _closeLyricsSettings();
    }
    els.lyricsSearchOverlay.style.display = '';
    requestAnimationFrame(function () {
      els.lyricsSearchOverlay.classList.add('open');
    });
    var track = App.state.currentTrack;
    if (track) {
      var query = (track.title || '') + ' ' + (track.artist || '');
      els.lyricsSearchInput.value = query.trim();
    } else {
      els.lyricsSearchInput.value = '';
    }
    els.lyricsSearchInput.focus();
    els.lyricsSearchInput.select();
    if (els.lyricsSearchInput.value) {
      _performLyricsSearch(els.lyricsSearchInput.value.trim());
    }
  }

  function _closeLyricsSearch() {
    if (!els.lyricsSearchOverlay) return;
    els.lyricsSearchOverlay.classList.remove('open');
    setTimeout(function () {
      els.lyricsSearchOverlay.style.display = 'none';
      if (els.lyricsSearchResults) els.lyricsSearchResults.innerHTML = '';
      if (els.lyricsSearchInput) els.lyricsSearchInput.value = '';
    }, 250);
    lyricsSearchGen++;
  }

  function _showSearchStatus(type, message) {
    if (!els.lyricsSearchResults) return;
    var icon = type === 'loading' ? 'progress_activity' :
               type === 'error' ? 'error' :
               type === 'empty' ? 'search_off' : 'info';
    els.lyricsSearchResults.innerHTML =
      '<div class="np-lyrics-search-status ' + type + '">' +
        '<span class="material-symbols-rounded">' + icon + '</span>' +
        '<p>' + App.utils.esc(message) + '</p>' +
      '</div>';
  }

  function _performLyricsSearch(query) {
    if (!query) {
      if (els.lyricsSearchResults) els.lyricsSearchResults.innerHTML = '';
      return;
    }
    var gen = ++lyricsSearchGen;
    _showSearchStatus('loading', App.i18n.t('np.lyricsSearchLoading'));
    App.utils.call('search_lyrics', query, lyricsSearchSource).then(function (res) {
      if (gen !== lyricsSearchGen) return;
      try {
        var data = JSON.parse(res);
      } catch (e) {
        _showSearchStatus('error', App.i18n.t('np.lyricsParseError'));
        return;
      }
      if (data.error) {
        _showSearchStatus('error', App.i18n.t('np.lyricsSearchFailed', { error: data.error }));
        return;
      }
      if (!data.songs || data.songs.length === 0) {
        _showSearchStatus('empty', App.i18n.t('np.lyricsNoMatch'));
        return;
      }
      _renderSearchResults(data.songs);
    });
  }

  function _renderSearchResults(songs) {
    var frag = document.createDocumentFragment();
    for (var i = 0; i < songs.length; i++) {
      var song = songs[i];
      var btn = document.createElement('button');
      btn.className = 'np-lyrics-result';
      btn.innerHTML =
        '<div class="np-lyrics-result-icon">' +
          '<span class="material-symbols-rounded">music_note</span>' +
        '</div>' +
        '<div class="np-lyrics-result-info">' +
          '<div class="np-lyrics-result-name">' + App.utils.esc(song.name || '') + '</div>' +
          '<div class="np-lyrics-result-meta">' + App.utils.esc(song.artist || '') +
            (song.album ? ' · ' + App.utils.esc(song.album) : '') + '</div>' +
        '</div>' +
        '<div class="np-lyrics-result-arrow">' +
          '<span class="material-symbols-rounded">arrow_forward</span>' +
        '</div>';
      (function (songId) {
        btn.addEventListener('click', function () {
          _fetchAndApplyLyrics(songId);
        });
      })(song.id);
      frag.appendChild(btn);
    }
    els.lyricsSearchResults.innerHTML = '';
    els.lyricsSearchResults.appendChild(frag);
  }

  function _fetchAndApplyLyrics(songId) {
    _autoSearchGen++;
    var track = App.state.currentTrack;
    if (!track) {
      _showSearchStatus('error', App.i18n.t('np.noTrackPlaying'));
      return;
    }
    _showSearchStatus('loading', App.i18n.t('np.lyricsFetching'));
    App.utils.call('fetch_lyrics', songId, lyricsSearchSource).then(function (res) {
      try {
        var data = JSON.parse(res);
      } catch (e) {
        _showSearchStatus('error', App.i18n.t('np.lyricsParseError'));
        return;
      }
      if (data.error) {
        _showSearchStatus('error', App.i18n.t('np.lyricsFetchFailed', { error: data.error }));
        return;
      }
      if (!data.lyrics) {
        _showSearchStatus('empty', App.i18n.t('np.lyricsNotFound'));
        return;
      }
      _pendingLyricsSource = lyricsSearchSource;
      App.utils.call('apply_lyrics', track.id, data.lyrics).then(function () {
        _closeLyricsSearch();
      });
    });
  }


  function _isStillCurrentTrack(track) {
    return App.state.currentTrack &&
           App.state.currentTrack.id === track.id;
  }

  function _autoSearchLyrics(track) {
    var gen = ++_autoSearchGen;
    var title = (track.title || '').trim();
    var artist = (track.artist || '').trim();
    var query = artist ? (artist + ' ' + title) : title;
    if (!query) {
      _showAutoSearchFailed();
      return;
    }

    if (track.source === 'subsonic' && track.id &&
        String(track.id).indexOf('s') === 0) {
      App.utils.call('get_subsonic_lyrics', track.id).then(function (res) {
        if (gen !== _autoSearchGen || !_isStillCurrentTrack(track)) return;
        var data;
        try { data = JSON.parse(res); } catch (e) { data = null; }
        if (data && data.lyrics) {
          _pendingLyricsSource = 'subsonic';
          App.utils.call('apply_lyrics_temporary', track.id, data.lyrics).then(function () {
            if (gen !== _autoSearchGen || !_isStillCurrentTrack(track)) return;
          });
          return;
        }
        var fallbackQuery = query;
        _searchLyricsBySource(track, gen, fallbackQuery, lyricsSearchSource);
      });
      return;
    }

    _searchLyricsBySource(track, gen, query, lyricsSearchSource);
  }

  function _normStr(s) {
    if (!s) return '';
    s = s.toLowerCase().trim();
    s = s.replace(/[\(（\[【].*?[\)）\]】]/g, '');
    s = s.replace(/\s*(feat|ft)\..*/i, '');
    s = s.replace(/\s+/g, ' ').trim();
    return s;
  }

  function _pickBestSong(songs, track) {
    var tTitle = _normStr(track.title || '');
    var tArtist = _normStr(track.artist || '');
    var tDur = track.duration_ms || 0;

    var best = songs[0];
    var bestScore = -Infinity;

    for (var i = 0; i < songs.length; i++) {
      var s = songs[i];
      var sTitle = _normStr(s.name || '');
      var sArtist = _normStr(s.artist || '');
      var sDur = s.duration || 0;

      var score = 0;

      if (sTitle && tTitle) {
        if (sTitle === tTitle) {
          score += 100;
        } else if (sTitle.indexOf(tTitle) >= 0 || tTitle.indexOf(sTitle) >= 0) {
          score += 60;
        }
      }

      if (tArtist && sArtist) {
        if (sArtist === tArtist) {
          score += 50;
        } else if (sArtist.indexOf(tArtist) >= 0 || tArtist.indexOf(sArtist) >= 0) {
          score += 30;
        }
      }

      if (tDur && sDur) {
        var dDiff = Math.abs(tDur - sDur);
        if (dDiff < 3000) score += 25;
        else if (dDiff < 8000) score += 12;
        else if (dDiff < 15000) score += 5;
      }

      score -= i * 0.5;

      if (score > bestScore) {
        bestScore = score;
        best = s;
      }
    }

    return best;
  }

  function _searchLyricsBySource(track, gen, query, source) {
    App.utils.call('search_lyrics', query, source).then(function (res) {
      if (gen !== _autoSearchGen || !_isStillCurrentTrack(track)) return;

      try {
        var data = JSON.parse(res);
      } catch (e) {
        _showAutoSearchFailed();
        return;
      }
      if (data.error || !data.songs || data.songs.length === 0) {
        _showAutoSearchFailed();
        return;
      }

      var bestSong = _pickBestSong(data.songs, track);
      var songId = bestSong.id;
      App.utils.call('fetch_lyrics', songId, source).then(function (lrcRes) {
        if (gen !== _autoSearchGen || !_isStillCurrentTrack(track)) return;

        try {
          var lrcData = JSON.parse(lrcRes);
        } catch (e) {
          _showAutoSearchFailed();
          return;
        }
        if (lrcData.error || !lrcData.lyrics) {
          _showAutoSearchFailed();
          return;
        }

        _pendingLyricsSource = source;
        App.utils.call('apply_lyrics_temporary', track.id, lrcData.lyrics).then(function () {
          if (gen !== _autoSearchGen || !_isStillCurrentTrack(track)) return;
        });
      });
    });
  }

  function _showAutoSearchFailed() {
    if (!els.lyrics) return;
    els.lyrics.innerHTML =
      '<div class="np-lyrics-placeholder">' +
        '<span class="material-symbols-rounded">lyrics</span>' +
        '<p>' + App.i18n.t('np.noLyrics') + '</p>' +
        '<p class="np-lyrics-placeholder-hint">' + App.i18n.t('np.lyricsSearchHint') + '</p>' +
      '</div>';
    _updateLyricsSourceBadge(true);
  }


  np.setTrackLoading = function (loading) {
    if (els.cover) {
      if (loading) {
        if (!els.cover.querySelector('.np-cover-loading')) {
          var loader = document.createElement('div');
          loader.className = 'np-cover-loading';
          loader.innerHTML = '<span class="material-symbols-rounded">progress_activity</span>';
          els.cover.appendChild(loader);
        }
      } else {
        var loader = els.cover.querySelector('.np-cover-loading');
        if (loader) {
          loader.remove();
        }
      }
    }
  };

  np.clearBackgroundBlurCache = function () {
    _clearBgBlurSourceCache();
  };

  np.setDefaultView = function (val) {
    _npDefaultView = val || 'side';
  };

  np.onLanguageChanged = function () {
    var track = App.state.currentTrack;
    if (!track) {
      _setTitle(els.title, App.i18n.t('common.notPlaying'));
      _setTitle(els.miniTitle, App.i18n.t('common.notPlaying'));
      if (els.miniInfo) _setTitle(els.miniInfoTitle, App.i18n.t('common.notPlaying'));
    } else {
      _setTitle(els.title, track.title || App.i18n.t('common.unknownTrack'));
      els.artist.textContent = track.artist || App.i18n.t('common.unknownArtist');
      _setTitle(els.miniTitle, track.title || App.i18n.t('common.unknownTrack'));
      els.miniArtist.textContent = track.artist || App.i18n.t('common.unknownArtist');
      if (els.miniInfo) {
        _setTitle(els.miniInfoTitle, track.title || App.i18n.t('common.unknownTrack'));
        els.miniInfoArtist.textContent = track.artist || App.i18n.t('common.unknownArtist');
      }
    }
    np.updateAudioMode(App.state.isExclusive);
    if (App.state.queue && App.state.queue.length > 0) {
      np.updateQueue(App.state.queue, App.state.currentQueueIndex);
    }
    if (track && !track.lyrics) {
      _renderLyrics(track);
    }
  };

})();
