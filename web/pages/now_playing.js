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
    btnMore: document.getElementById('np-more-btn'),
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
    // 必须限定在 #now-playing-pane 内：艺人详情页、添加流媒体库对话框也用 .np-pivot-tab，
    // 全文档查询会把它们的标签一起纳入 toggle 列表（互踩 active），见 _activePivotTab 的注释。
    pivotTabs: document.querySelectorAll('#now-playing-pane .np-pivot-tab'),
    pivotIndicator: document.getElementById('np-pivot-indicator'),
    contentSegs: document.querySelectorAll('.np-content-seg'),
    panels: document.querySelectorAll('#now-playing-pane .np-panels .np-panel'),
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
    lyricsSettingsBtn: document.getElementById('np-lyrics-settings-btn'),
    lyricsSettingsPopup: document.getElementById('np-lyrics-settings-popup'),
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

  // 歌词字号滑块：把当前值换算成轨道填充比例（复用设置页 .settings-slider 的 --slider-val）
  function _syncFontSizeSlider() {
    var slider = els.lyricsFontSizeSlider;
    if (!slider) return;
    var min = parseFloat(slider.min) || 12;
    var max = parseFloat(slider.max) || 28;
    var val = parseFloat(slider.value);
    if (isNaN(val)) val = min;
    var pct = max > min ? ((val - min) / (max - min)) * 100 : 0;
    slider.style.setProperty('--slider-val', pct + '%');
  }

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
  // 退出间奏时"紧接着的那一行"的下标：只有它自己才该用间奏塌缩后的临时行高，
  // 拖动进度条越过间奏时激活的是更靠后的行，不能再套这个旧值。
  let _interludeExitNextIdx = -1;
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
  var _beatPulse = 0;
  var _beatSpecBass = 0;
  var _beatSpecMid = 0;
  var _beatSpecTreble = 0;
  var _beatLocalBaseTime = 0;
  var _beatLocalBasePos = 0;
  var _beatLastTickT = 0;
  var _beatIdleMs = 0;
  var _beatBaseBass = 0;

  // 背景律动＝频谱包络（可视化式），不是按 BPM 相位打拍子。
  // 低频推整体缩放，中高频推光泽层；两段都走"快起慢落"的时间基包络，
  // 时间基保证 60/120Hz 下同一段音乐的起伏完全一致（不随帧率变快变慢）。
  var BEAT_ATTACK_MS = 40;
  var BEAT_RELEASE_MS = 120;   // 释放太快会闪、太慢会糊成一片；120ms 跟得上鼓点又不会抖
  var BEAT_IDLE_MS = 1200;   // 连续这么久没拿到频谱 → 退化为极缓呼吸，别让背景彻底死掉

  function _beatEnv(cur, target, dt, attackMs, releaseMs) {
    var tau = target > cur ? attackMs : releaseMs;
    return cur + (target - cur) * (1 - Math.exp(-dt / tau));
  }

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

  // 背景律动的两个自定义属性只作用在 .np-bg-covers 及其内部（scale / opacity）。
  // 之前写在 #now-playing-pane 上：自定义属性会被整个子树继承，等于每帧让歌词、
  // 队列、控件那几千个节点全部样式失效重算，并且把背景组每帧拖进一次全屏重合成。
  // 现在写到真正消费它的那个元素上，再限制到 30Hz + 变化阈值，避免无意义的重合成。
  var _beatBgEl = null;
  var _beatLastWriteT = 0;
  var _beatLastScale = -1;
  var _beatLastSurge = -1;
  var _beatLastGlow = -1;

  var _beatGlowEl = null;

  function _beatTargetEl() {
    if (!_beatBgEl || !_beatBgEl.isConnected) _beatBgEl = document.querySelector('.np-bg-covers');
    if (!_beatGlowEl || !_beatGlowEl.isConnected) _beatGlowEl = document.querySelector('.np-bg');
    return _beatBgEl;
  }

  function _beatWritePulse(scale, surge, glow) {
    var el = _beatTargetEl();
    if (!el) return;
    var t = performance.now();
    if (t - _beatLastWriteT < 33) return;                       // 30Hz 上限
    if (Math.abs(scale - _beatLastScale) < 0.002 &&
        Math.abs(surge - _beatLastSurge) < 0.004 &&
        Math.abs(glow - _beatLastGlow) < 0.004) return;          // 无可见变化就不写
    _beatLastWriteT = t;
    _beatLastScale = scale;
    _beatLastSurge = surge;
    _beatLastGlow = glow;
    el.style.setProperty('--beat-scale', scale.toFixed(4));
    el.style.setProperty('--beat-surge', surge.toFixed(3));
    // 柔光层挂在 .np-bg 上（mask 的兄弟/上层），不进 covers 子树
    if (_beatGlowEl) _beatGlowEl.style.setProperty('--beat-glow', glow.toFixed(3));
  }

  function _startBeatLoop() {
    if (_beatRafId) return;
    _beatPulse = 0;
    _beatSpecBass = 0;
    _beatSpecMid = 0;
    _beatSpecTreble = 0;
    _beatLastTickT = 0;
    _beatIdleMs = 0;
    _beatLastWriteT = 0;
    _beatLastScale = -1;
    _beatLastSurge = -1;
    _beatLastGlow = -1;
    _beatBgEl = null;
    _beatGlowEl = null;
    if (!_fluidPalette) _applyFluidColors(null);   // 无封面曲目也要有流体（主题色兜底）
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
    if (_beatBgEl) {
      _beatBgEl.style.removeProperty('--beat-scale');
      _beatBgEl.style.removeProperty('--beat-surge');
    }
    if (_beatGlowEl) _beatGlowEl.style.removeProperty('--beat-glow');
    _beatLastScale = -1;
    _beatLastSurge = -1;
    _beatLastGlow = -1;
    _beatLastTickT = 0;
    _beatIdleMs = 0;
    _beatBaseBass = 0;
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

    // 帧间隔按真实时间取：丢帧或高刷都不会改变包络的时间常数
    var nowT = performance.now();
    var dt = _beatLastTickT ? (nowT - _beatLastTickT) : 16.7;
    if (dt > 64) dt = 64;             // 长时间挂起后不要一步跳到底
    _beatLastTickT = nowT;

    var engine = App.audioEngine;
    var st = App.state.playbackState;
    var playing = (st === 'playing' || st === 'loading');
    var beat = (engine && playing) ? engine.getBeatData() : null;
    var hasData = !!(beat && beat.level > 0.004);
    _beatIdleMs = hasData ? 0 : (_beatIdleMs + dt);

    var tBass, tMid, tTreb;
    if (hasData) {
      tBass = beat.bass;
      tMid = beat.mid;
      tTreb = beat.treble;
    } else if (playing && _beatIdleMs > BEAT_IDLE_MS) {
      // 在播但拿不到频谱时留一点呼吸，免得背景彻底变成一张静止图；
      // 暂停/停止则老老实实回到 1.0（relBass 走不到这里就是 0）。
      tBass = 0.30;
      tMid = 0.10;
      tTreb = 0.06;
    } else {
      tBass = 0; tMid = 0; tTreb = 0;
    }

    // 三段各自包络：越往上越"轻"，起得更快、落得更慢，接近频谱条的手感
    _beatSpecBass = _beatEnv(_beatSpecBass, tBass, dt, BEAT_ATTACK_MS, BEAT_RELEASE_MS);
    _beatSpecMid = _beatEnv(_beatSpecMid, tMid, dt, BEAT_ATTACK_MS * 0.8, BEAT_RELEASE_MS * 1.3);
    _beatSpecTreble = _beatEnv(_beatSpecTreble, tTreb, dt, BEAT_ATTACK_MS * 0.9, BEAT_RELEASE_MS * 1.7);

    var midN = Math.min(1, Math.max(0, (_beatSpecMid - 0.02) / 0.35));
    var trebN = Math.min(1, Math.max(0, _beatSpecTreble / 0.35));

    // 用"比自己的慢基线高出多少"驱动，而不是绝对能量：
    // 低频绝对值的起伏只有 0.5~0.75，直接映射到透明度只摆动 0.09，肉眼看不出来；
    // 相对突出量能把每个鼓点拉到满量程，像可视化里柱子相对静音线的高度。
    var relBass = 0;
    if (hasData) {
      _beatBaseBass = _beatEnv(_beatBaseBass, _beatSpecBass, dt, 1100, 1100);
      relBass = Math.min(1, Math.max(0, (_beatSpecBass - _beatBaseBass * 0.95) / 0.30));
    } else if (playing && _beatIdleMs > BEAT_IDLE_MS) {
      var breath = 0.5 + 0.5 * Math.sin(nowT / 1400);
      relBass = 0.15 + breath * 0.18;
    }

    _beatPulse = _beatEnv(_beatPulse, relBass, dt, 24, 55);

    var scale = 1 + _beatPulse * 0.11;
    var surge = Math.min(0.6, midN * 0.32 + trebN * 0.42);
    var glow = _beatPulse * 0.36;

    _beatWritePulse(scale, surge, glow);
    _drawFluid(nowT, _beatPulse);

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
        _syncFontSizeSlider();
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
  var BG_BLUR_CACHE_LIMIT = 2;
  var _bgBlurSourceCache = new Map();

  function _clearBgBlurSourceCache() {
    _bgBlurSourceCache.clear();
  }

  // ── 背景流体的运行时状态与循环（参考 AMLL 的 bg-render 思路）────────────
  // AMLL 用 WebGL：调色板 + mesh 控制点位移 + 音量推拉 + 周边暗角。这里等价地用
  // 一块 120×72 的 canvas 每帧重绘几个色团（放大到全屏即天然模糊），
  // 好处是色团真的在游动，而不是整张静态图平移/旋转。
  var FLUID_W = 120, FLUID_H = 72;
  var _fluidCanvasEl = null;
  var _fluidCtx = null;
  var _fluidPalette = null;
  var _fluidRaw = null;        // 封面原始取色（未按主题映射），切主题时用它重算
  var _fluidBlobs = [];
  var _fluidLastDraw = 0;
  var _fluidRafId = 0;
  var _fluidHostEl = null;     // .np-bg（判断是否处于视频背景模式）

  // 流体不依赖律动循环的启停（那个只在全窗口 + 播放时跑）。
  // 单独一条 rAF：只有全窗口才真正绘制，退出就自动停。
  function _startFluidLoop() {
    if (_fluidRafId) return;
    var loop = function () {
      _fluidRafId = 0;
      var pane = document.getElementById('now-playing-pane');
      if (!pane || !pane.classList.contains('fullscreen')) return;
      // 视频背景期间不画流体（画了也被 CSS 隐藏，白烧 CPU；视频解码本来就吃资源）
      if (!_fluidHostEl || !_fluidHostEl.isConnected) _fluidHostEl = pane.querySelector('.np-bg');
      if (!(_fluidHostEl && _fluidHostEl.classList.contains('video-active'))) {
        _drawFluid(performance.now(), _beatPulse);
      }
      _fluidRafId = requestAnimationFrame(loop);
    };
    _fluidRafId = requestAnimationFrame(loop);
  }

  function _fluidInitCanvas() {
    if (_fluidCanvasEl && _fluidCanvasEl.isConnected) return;
    _fluidCanvasEl = document.getElementById('np-bg-fluid-canvas');
    if (!_fluidCanvasEl) { _fluidCtx = null; return; }
    _fluidCanvasEl.width = FLUID_W;
    _fluidCanvasEl.height = FLUID_H;
    _fluidCtx = _fluidCanvasEl.getContext('2d');
  }

  // 没有封面时用主题色兜底：无封面曲目也该有律动，而不是一片死背景
  function _defaultFluidPalette() {
    try {
      var cs = getComputedStyle(document.documentElement);
      var pick = function (k, fb) { var v = cs.getPropertyValue(k).trim(); return v || fb; };
      return [pick('--md-primary', '#7c6fb0'), pick('--md-tertiary', '#4a6b8a'),
              pick('--md-secondary', '#8a5f6e'), pick('--md-primary-container', '#8f83c0'),
              pick('--md-surface-tint', '#5a6b7a')];
    } catch (e) {
      return ['#7c6fb0', '#4a6b8a', '#8a5f6e', '#8f83c0', '#5a6b7a'];
    }
  }

  // ── 封面取色（同色相家族）──────────────────────────────────────────
  // 早期版本按「面积 × 饱和度」直接挑 5 个差异大的色。真实封面上这会挑进肤色之类的
  // 边缘色：亮青蓝的封面配出一大片粉红，蓝+粉在 lighter 叠加下发灰，整片背景发脏。
  // 现在先算面积加权的主色相，只保留 ±50° 内的同族色，不足的名额用主色明暗变体补，
  // 保证背景和封面是同一个色系里出来的。
  function _toHsv(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    var mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn, h = 0;
    if (d > 0.0001) {
      if (mx === r) h = ((g - b) / d) % 6;
      else if (mx === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
      if (h < 0) h += 360;
    }
    return [h, mx > 0 ? d / mx : 0, mx];
  }

  function _toRgb(h, s, v) {
    var c = v * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = v - c;
    var r = 0, g = 0, b = 0;
    if (h < 60) { r = c; g = x; }
    else if (h < 120) { r = x; g = c; }
    else if (h < 180) { g = c; b = x; }
    else if (h < 240) { g = x; b = c; }
    else if (h < 300) { r = x; b = c; }
    else { r = c; b = x; }
    return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
  }

  function _extractFluidColors(img) {
    try {
      var N = 24;
      var c = document.createElement('canvas');
      c.width = N; c.height = N;
      var ctx = c.getContext('2d');
      if (!ctx) return null;
      ctx.drawImage(img, 0, 0, N, N);
      var d = ctx.getImageData(0, 0, N, N).data;
      var map = {}, key, i;
      var lumSum = 0, lumN = 0;
      for (i = 0; i < d.length; i += 4) {
        if (d[i + 3] < 160) continue;
        lumSum += (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;
        lumN++;
        var r = d[i], g = d[i + 1], b = d[i + 2];
        var mx = Math.max(r, g, b), mn = Math.min(r, g, b);
        if (mx < 18 || mn > 242) continue;        // 纯黑/纯白不做色块
        key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
        var e = map[key];
        if (!e) e = map[key] = { r: 0, g: 0, b: 0, n: 0 };
        e.r += r; e.g += g; e.b += b; e.n++;
      }

      var buckets = [];
      for (key in map) {
        var e2 = map[key];
        var rr = e2.r / e2.n, gg = e2.g / e2.n, bb = e2.b / e2.n;
        var hsv = _toHsv(rr, gg, bb);
        buckets.push({ r: rr, g: gg, b: bb, n: e2.n, h: hsv[0], s: hsv[1], v: hsv[2] });
      }
      // 封面整体亮度：白底/蓝天封面在暗色主题下会整片透亮，压暗厚度要跟着它走
      _coverLum = lumN ? Math.min(1, lumSum / lumN) : 0.5;
      if (!buckets.length) return null;

      // 面积加权的主色相（用 sin/cos 平均，避开 0/360 环绕）
      var hx = 0, hy = 0, wsum = 0;
      for (i = 0; i < buckets.length; i++) {
        var bk = buckets[i];
        if (bk.s < 0.1) continue;                 // 近灰的色相没有意义
        var w = bk.n * (0.25 + bk.s);
        var rad = bk.h * Math.PI / 180;
        hx += Math.cos(rad) * w;
        hy += Math.sin(rad) * w;
        wsum += w;
      }
      var baseH = wsum > 0 ? (Math.atan2(hy, hx) * 180 / Math.PI + 360) % 360 : 215;

      buckets.sort(function (a, b) { return b.n - a.n; });
      var picked = [];
      for (i = 0; i < buckets.length && picked.length < 3; i++) {
        var c1 = buckets[i];
        if (c1.s < 0.08) continue;                // 灰白只用于明暗，不单独成团
        var dh = Math.abs(c1.h - baseH);
        if (dh > 180) dh = 360 - dh;
        if (dh > 50) continue;                    // 只在主色相 ±50° 内取色
        var dup = false;
        for (var m = 0; m < picked.length; m++) {
          var dr = c1.r - picked[m].r, dg = c1.g - picked[m].g, db = c1.b - picked[m].b;
          if (dr * dr + dg * dg + db * db < 1200) { dup = true; break; }
        }
        if (!dup) picked.push(c1);
      }

      // 主色的明暗变体补齐（同色相，只动明度/饱和度）
      var hs = _toHsv(
        picked.length ? picked[0].r : buckets[0].r,
        picked.length ? picked[0].g : buckets[0].g,
        picked.length ? picked[0].b : buckets[0].b
      );
      var variants = [[0.0, 1.15], [-0.10, 1.45], [0.08, 0.75], [-0.16, 0.95]];
      for (i = 0; i < variants.length && picked.length < 5; i++) {
        var vv = Math.min(1, Math.max(0.12, hs[2] + variants[i][0]));
        var ss = Math.min(1, Math.max(0.18, hs[1] * variants[i][1]));
        var rgb3 = _toRgb(hs[0], ss, vv);
        picked.push({ r: rgb3[0], g: rgb3[1], b: rgb3[2], n: 1 });
      }

      // 这里只输出封面原始色，明度/饱和度按主题映射放到 _refreshBgColors：
      // 暗色要压暗、亮色要提亮，取色阶段做死了就没法跟着主题变。
      return picked.slice(0, 5).map(function (c2) {
        return 'rgb(' + Math.round(c2.r) + ',' + Math.round(c2.g) + ',' + Math.round(c2.b) + ')';
      });
    } catch (e3) {
      return null;
    }
  }

  // ── 背景明/暗参数 ──────────────────────────────────────────────────
  // 这几层（scrim / mask / 流体 / grade）原先一律按暗色写死：全部压暗、明度压到中灰。
  // 亮色模式下那会是一整块深色板；而暗色模式下中灰底又偏亮。所以统一按主题取参数：
  //   暗色：色团明度 0.20~0.34（深）、scrim 0.64 压得住、底实色极深；
  //   亮色：色团明度 0.78~0.90 且低饱和（白底上的淡彩雾）、scrim 换白纱、底实色近白。
  function _bgIsDark() {
    return document.documentElement.getAttribute('data-theme') !== 'light';
  }

  function _bgParams() {
    if (_bgIsDark()) {
      var lum = (_coverLum === null ? 0.5 : _coverLum);
      return {
        fluidVHigh: 0.34, fluidVLow: 0.20, fluidSMin: 0.44, fluidSGain: 1.1, fluidAlpha: 0.40,
        // 白底封面本身接近 230，固定 alpha 压不住 → 亮度越高压得越实
        scrimOpacity: 0.56 + lum * 0.34,
        maskMix: 0.55, maskAdd: 0,
        tintAlpha: 0.12,
        deepMix: 0.34, deepAdd: 0, deepAlphaA: 0.62, deepAlphaB: 0.90,
        fluidBase: 0.14, fluidGain: 0.60,
        vigMid: 'rgb(176,176,184)', vigEdge: 'rgb(64,64,72)',
      };
    }
    var lumL = (_coverLum === null ? 0.5 : _coverLum);
    return {
      fluidVHigh: 0.90, fluidVLow: 0.78, fluidSMin: 0.24, fluidSGain: 0.85, fluidAlpha: 0.48,
      scrimOpacity: 0.60 + lumL * 0.24,
      maskMix: 0.30, maskAdd: 176,
      tintAlpha: 0.10,
      deepMix: 0.28, deepAdd: 180, deepAlphaA: 0.46, deepAlphaB: 0.70,
      fluidBase: 0.26, fluidGain: 0.46,
      // 亮色下暗角不能压暗：它乘在白底上会直接变成灰雾，所以两端都接近白
      vigMid: 'rgb(248,248,250)', vigEdge: 'rgb(236,238,241)',
    };
  }

  var _bgFluidAlpha = 0.4;
  var _coverLum = null;        // 封面平均亮度 0..1（scrim 厚度自适应用）
  var _bgVigMid = 'rgb(176,176,184)';
  var _bgVigEdge = 'rgb(64,64,72)';

  function _parseRgb(str) {
    var m = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(str || '');
    return m ? [+m[1], +m[2], +m[3]] : null;
  }

  // 把封面主色按主题压/提成底色，并写好各层需要的变量
  function _applyBgTone(primary) {
    var host = document.querySelector('.np-bg');
    if (!host) return;
    var p = _bgParams();
    var c = _parseRgb(primary);
    if (!c) {
      ['--bg-mask-color', '--bg-tint', '--bg-deep-a', '--bg-deep-b', '--bg-scrim-color']
        .forEach(function (k) { host.style.removeProperty(k); });
      return;
    }
    var mix = function (k, add) {
      return 'rgb(' + Math.round(c[0] * k + add) + ',' + Math.round(c[1] * k + add) + ',' +
                      Math.round(c[2] * k + add) + ')';
    };
    var base = mix(p.maskMix, p.maskAdd);
    host.style.setProperty('--bg-mask-color', base);
    host.style.setProperty('--bg-scrim-color', base);
    host.style.setProperty('--bg-scrim-opacity', String(p.scrimOpacity));
    host.style.setProperty('--bg-tint', 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + p.tintAlpha + ')');
    // 控制区实色：暗色取主色深版，亮色取主色浅版 —— 都是"取色的结果"，不是固定灰
    var deep = mix(p.deepMix, p.deepAdd);
    host.style.setProperty('--bg-deep-a', deep.replace('rgb(', 'rgba(').replace(')', ',' + p.deepAlphaA + ')'));
    host.style.setProperty('--bg-deep-b', deep.replace('rgb(', 'rgba(').replace(')', ',' + p.deepAlphaB + ')'));
    host.style.setProperty('--fluid-base', String(p.fluidBase));
    host.style.setProperty('--fluid-gain', String(p.fluidGain));
    _bgFluidAlpha = p.fluidAlpha;
    _bgVigMid = p.vigMid;
    _bgVigEdge = p.vigEdge;
  }

  // 按当前主题把"原始取色 → 实际用色"重算一遍（换歌、切主题都走这里）
  function _refreshBgColors() {
    var p = _bgParams();
    var raw = (_fluidRaw && _fluidRaw.length) ? _fluidRaw : _defaultFluidPalette();
    _fluidPalette = raw.slice(0, 5).map(function (str, k) {
      var c = _parseRgb(str);
      if (!c) return str;
      var hv = _toHsv(c[0], c[1], c[2]);
      // 明度沿索引递减，色团之间才有深浅层次，不会糊成一坨
      var vv = p.fluidVHigh - (p.fluidVHigh - p.fluidVLow) * Math.min(k, 4) / 4;
      var ss = Math.min(0.92, Math.max(p.fluidSMin, hv[1] * p.fluidSGain));
      var out = _toRgb(hv[0], ss, vv);
      return 'rgb(' + out[0] + ',' + out[1] + ',' + out[2] + ')';
    });
    for (var i = 0; i < _fluidBlobs.length; i++) {
      if (_fluidPalette[i]) _fluidBlobs[i].color = _fluidPalette[i];
    }
    _applyBgTone(_fluidPalette[0]);
    _fluidLastDraw = 0;   // 强制下一帧重绘，切主题不用等
  }

  function _applyFluidColors(colors) {
    _fluidInitCanvas();
    if (!_fluidCtx) return;
    _fluidRaw = (colors && colors.length) ? colors.slice(0, 5) : null;
    if (!_fluidRaw) _coverLum = null;   // 无封面：不沿用上一首的亮度
    _fluidBlobs = [];
    _refreshBgColors();
    // 固定的初始布局与相位（换歌只换颜色，不换构图，避免每次布局乱跳）
    var seeds = [
      [0.22, 0.24, 0.62, 0.00], [0.80, 0.28, 0.58, 1.7],
      [0.42, 0.82, 0.60, 3.1], [0.62, 0.52, 0.46, 4.4],
      [0.10, 0.72, 0.42, 5.6]
    ];
    for (var i = 0; i < _fluidPalette.length; i++) {
      var sd = seeds[i % seeds.length];
      _fluidBlobs.push({
        color: _fluidPalette[i],
        x0: sd[0], y0: sd[1], r0: sd[2],
        p0: sd[3],
        p1: sd[3] * 1.7 + 0.6,
        p2: sd[3] * 0.6 + 2.2,
      });
    }
    _fluidLastDraw = 0;
    _startFluidLoop();
  }

  // 切主题时重算配色（封面没变，只是映射参数变了）
  function _watchBgTheme() {
    if (typeof MutationObserver === 'undefined') return;
    var last = document.documentElement.getAttribute('data-theme');
    var ob = new MutationObserver(function () {
      var t = document.documentElement.getAttribute('data-theme');
      if (t === last) return;
      last = t;
      try { _refreshBgColors(); } catch (e) { /* 取色不可用时保持原样 */ }
    });
    ob.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  }

  function _clearFluid() {
    _fluidPalette = null;
    _fluidRaw = null;
    _fluidBlobs = [];
    if (_fluidCtx) _fluidCtx.clearRect(0, 0, FLUID_W, FLUID_H);
  }

  // energy: 0..1（低频相对强度）。AMLL 用 u_volume 缩放整体 UV，这里让半径跟着涨。
  function _drawFluid(t, energy) {
    if (!_fluidCtx || !_fluidBlobs.length) return;
    if (t - _fluidLastDraw < 33) return;          // 30Hz 足够，省 CPU
    _fluidLastDraw = t;

    var w = FLUID_W, h = FLUID_H;
    var ctx = _fluidCtx;
    ctx.clearRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'source-over';

    var s = t / 1000;
    for (var i = 0; i < _fluidBlobs.length; i++) {
      var b = _fluidBlobs[i];
      var x = w * (b.x0 + Math.sin(s / 7.3 + b.p0) * 0.14 + Math.sin(s / 3.1 + b.p1) * 0.05);
      var y = h * (b.y0 + Math.cos(s / 8.9 + b.p1) * 0.13 + Math.sin(s / 4.2 + b.p2) * 0.05);
      var r = Math.max(w, h) * b.r0 * (1 + Math.sin(s / 6.1 + b.p2) * 0.12 + energy * 0.22);
      var g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, b.color);
      g.addColorStop(0.55, b.color);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.globalAlpha = _bgFluidAlpha;
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }
    ctx.globalAlpha = 1;

    // 周边压暗（AMLL mesh.frag 里的 vignette），让颜色往中心聚
    ctx.globalCompositeOperation = 'multiply';
    var vg = ctx.createRadialGradient(w * 0.5, h * 0.45, 0, w * 0.5, h * 0.45, Math.max(w, h) * 0.72);
    vg.addColorStop(0, 'rgb(255,255,255)');
    vg.addColorStop(0.5, _bgVigMid);
    vg.addColorStop(1, _bgVigEdge);
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, w, h);

    // 下半部淡出：让 .np-bg-mask 的实色露出来，下部保持"固定遮罩"的稳定观感
    ctx.globalCompositeOperation = 'destination-out';
    var fade = ctx.createLinearGradient(0, h * 0.42, 0, h);
    fade.addColorStop(0, 'rgba(0,0,0,0)');
    fade.addColorStop(1, 'rgba(0,0,0,0.9)');
    ctx.fillStyle = fade;
    ctx.fillRect(0, h * 0.42, w, h * 0.58);

    ctx.globalCompositeOperation = 'source-over';
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
          var pal = _extractFluidColors(img);
          if (!nw || !nh) { resolve({ base: url, surge: url, colors: pal }); return; }
          var scale = Math.min(1, BG_BLUR_SOURCE_MAX / Math.max(nw, nh));
          var w = Math.max(1, Math.round(nw * scale));
          var h = Math.max(1, Math.round(nh * scale));
          var src = document.createElement('canvas');
          src.width = w;
          src.height = h;
          var sctx = src.getContext('2d');
          if (!sctx) { resolve({ base: url, surge: url, colors: pal }); return; }
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
          var result = (base && surge)
            ? { base: base, surge: surge, colors: pal }
            : { base: url, surge: url, colors: pal };
          if (_bgBlurSourceCache.size >= BG_BLUR_CACHE_LIMIT) {
            _bgBlurSourceCache.delete(_bgBlurSourceCache.keys().next().value);
          }
          _bgBlurSourceCache.set(url, result);
          resolve(result);
        } catch (e) {
          resolve({ base: url, surge: url, colors: null });
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
          if (bgUrls.colors) _applyFluidColors(bgUrls.colors);
          next.style.setProperty('--cover-image-base', 'url("' + bgUrls.base + '")');
          next.style.setProperty('--cover-image-surge', 'url("' + bgUrls.surge + '")');
          next.style.removeProperty('--cover-color');
        } else {
          next.style.removeProperty('--cover-image-base');
          next.style.removeProperty('--cover-image-surge');
          next.style.setProperty('--cover-color', fallbackColor || 'var(--md-surface-container-low)');
          _applyFluidColors(null);   // 无封面：流体退回主题色，不留上一首的颜色
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

  // 倍速的唯一写入口：封面滚轮/双击、更多菜单的倍速子菜单都走这里
  function _applyPlaybackRate(rate) {
    var next = Math.max(0.5, Math.min(2.0, Math.round((parseFloat(rate) || 1) * 100) / 100));
    var changed = Math.abs(next - _coverRate) >= 0.001;
    _coverRate = next;
    var engine = App.audioEngine;
    if (engine) engine.setUserRate(next);
    App.backend.set_rate(next);
    if (changed) _showRateBadge(next);
    return next;
  }

  np.getPlaybackRate = function () { return _coverRate; };
  np.setPlaybackRate = function (rate) { return _applyPlaybackRate(rate); };
  np.isLiked = function () { return !!_isLiked; };

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
      if (_coverRate !== 1.0) _applyPlaybackRate(1.0);
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

    if (els.btnMore) {
      els.btnMore.addEventListener('click', function (e) {
        e.stopPropagation();
        var track = App.state && App.state.currentTrack;
        if (!track) {
          App.utils.toast(App.i18n.t('np.noTrackPlaying'));
          return;
        }
        if (!App.contextMenu || !App.contextMenu.showNowPlaying) return;
        var r = els.btnMore.getBoundingClientRect();
        els.btnMore.setAttribute('aria-expanded', 'true');
        App.contextMenu.showNowPlaying(
          { left: r.left, right: r.right, top: r.top, bottom: r.bottom }, track);
      });
      document.addEventListener('context-menu-closed', function () {
        els.btnMore.setAttribute('aria-expanded', 'false');
      });
    }

    els.pivotTabs.forEach(function (tab) {
      tab.addEventListener('click', function () {
        var target = tab.getAttribute('data-tab');
        switchTab(target);
      });
    });
    requestAnimationFrame(function () {
      updatePivotIndicator();
    });
    var _npResizeRaf = 0;
    window.addEventListener('resize', function () {
      if (_npResizeRaf) return;
      _npResizeRaf = requestAnimationFrame(function () {
        _npResizeRaf = 0;
        updatePivotIndicator();
        _resyncLyricsScroll();
      });
    });

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
      // 用户自己想滚动（滚轮 / 触摸拖动）时立刻停掉自动滚动，否则 raf 每帧覆写
      // scrollTop，手感和位置都会被抢回去。
      els.lyricsWrap.addEventListener('wheel', _cancelLyricsScrollAnim, { passive: true });
      els.lyricsWrap.addEventListener('touchmove', _cancelLyricsScrollAnim, { passive: true });
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
        _syncFontSizeSlider();
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
      _syncFontSizeSlider();
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
  var _flyPendingTrack = null;
  var _flyOutAnims = [];
  var _FLY_OUT_EASE = 'cubic-bezier(0.3, 0, 0.8, 0.15)';
  var _FLY_IN_EASE = 'cubic-bezier(0.3, 1.25, 0.44, 1)';

  function _cancelFlyOutAnims(list) {
    var target = list || _flyOutAnims;
    for (var i = 0; i < target.length; i++) {
      try { target[i].cancel(); } catch (e) {  }
    }
    if (target === _flyOutAnims) _flyOutAnims = [];
  }

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
    // 动画期间可能又换了歌：记下最新那首，收尾时按它重绘，
    // 避免用发起动画时的旧曲目把界面盖回去。
    _flyPendingTrack = track;
    var items = _flyItems();

    var outAnims = items.map(function (it) {
      return it.el.animate([
        { transform: 'translateY(0)', opacity: 1 },
        { transform: 'translateY(-32%)', opacity: 0 }
      ], { duration: 170, delay: Math.round(it.delay * 0.4), easing: _FLY_OUT_EASE, fill: 'forwards' });
    });
    _flyOutAnims = outAnims;

    Promise.all(outAnims.map(function (a) { return a.finished.catch(function () {}); })).then(function () {
      if (myGen !== _flyGen) {
        // 已经被更新的一次重绘接管：把这段淡出收掉，否则 forwards 会把
        // 元素永久停在 opacity 0，看着就是一块空白。
        _cancelFlyOutAnims(outAnims);
        return;
      }
      var target = _flyPendingTrack || track;
      _flyPendingTrack = null;
      _applyTrack(target);
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
    // 页面不可见时没有帧，Web Animations 的 finished 不会 resolve，
    // 曲目信息就会一直停在旧的那首。后台直接落内容，不做飞入动画。
    var canAnimate = !document.hidden && !window.__appFrozen;
    if (isNewTrack && !mystery && !reduced && canAnimate) {
      _playTrackFly(track);
    } else {
      _applyTrack(track);
    }
  };

  // 正在做飞入动画、但还没落到 DOM 上的曲目：回前台对齐时用它避免重复重绘。
  np.pendingTrackId = function () {
    return _flyPendingTrack ? _flyPendingTrack.id : null;
  };

  function _applyTrack(track) {
    // 直接落内容就作废还在路上的飞入动画，否则它的收尾会用旧曲目盖回来。
    _flyGen++;
    _flyPendingTrack = null;
    _cancelFlyOutAnims();
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
    _interludeExitNextIdx = -1;
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
    // 单行宽度上限（em）：超了就按空格折行，见 _appendLineBody
    var lyricMaxEm = _lyricMaxEm();

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
        _appendLineBody(div, line, lyricMaxEm, baseFont, jpFont);
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
        _appendLineBody(div, { text: staticLines[i] }, lyricMaxEm, baseFont, jpFont);
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

  // ─── 长句按空格折行 ─────────────────────────────────────────────────────
  // 歌词面板宽度固定，一行塞太多字会顶到边、剩下的被 CSS 在任意字间断开。
  // 歌词原文本身就用空格分句，所以超过行宽上限时直接"空格→换行"，
  // 翻译/音译按同样的行数跟着拆开，保证每一句下面是自己那半句。
  const LYRIC_LINE_FILL = 0.8;       // 行宽上限 = 内容宽度 × 0.8
  const LYRIC_WIDTH_FALLBACK = 400;  // 面板未布局（display:none）时的兜底内容宽度
  const LYRIC_EM_SPACE = 0.28;
  const LYRIC_EM_HALF = 0.55;
  const LYRIC_ONE_PER_LINE_MAX = 3;  // 分句数 ≤ 3 时每句独占一行

  function _lyricContentWidth() {
    if (!els.lyrics) return 0;
    var cs = getComputedStyle(els.lyrics);
    var w = els.lyrics.clientWidth -
      (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0);
    return w > 80 ? w : 0;
  }

  function _lyricMaxEm() {
    var px = _lyricContentWidth() || LYRIC_WIDTH_FALLBACK;
    var fs = lyricsFontSize > 0 ? lyricsFontSize : 16;
    return (px * LYRIC_LINE_FILL) / fs;
  }

  // 单字符宽度估算（em）：全角 1、空格 0.28、其余按半角
  function _charEm(code) {
    if (code === 32 || code === 9) return LYRIC_EM_SPACE;
    if (code === 0x3000) return 1;
    if ((code >= 0x1100 && code <= 0x115f) ||
        (code >= 0x2e80 && code <= 0x303e) ||
        (code >= 0x3041 && code <= 0x33ff) ||
        (code >= 0x3400 && code <= 0x4dbf) ||
        (code >= 0x4e00 && code <= 0x9fff) ||
        (code >= 0xa000 && code <= 0xa4cf) ||
        (code >= 0xac00 && code <= 0xd7a3) ||
        (code >= 0xf900 && code <= 0xfaff) ||
        (code >= 0xfe30 && code <= 0xfe4f) ||
        (code >= 0xff00 && code <= 0xff60) ||
        (code >= 0xffe0 && code <= 0xffe6)) return 1;
    return LYRIC_EM_HALF;
  }

  function _textEm(s) {
    var em = 0;
    for (var i = 0; i < s.length; i++) {
      var code = s.charCodeAt(i);
      if (code >= 0xd800 && code <= 0xdbff && i + 1 < s.length) { i++; em += 1; continue; }
      em += _charEm(code);
    }
    return em;
  }

  // 需要几行、每行几句（返回每行占的分句数）；不需要折行时返回 null
  function _planLineBreaks(ems, maxEm) {
    var n = ems.length;
    if (n < 2 || !(maxEm > 0)) return null;

    var cum = [];
    var total = 0;
    for (var i = 0; i < n; i++) {
      total += ems[i] + (i > 0 ? LYRIC_EM_SPACE : 0);
      cum.push(total);
    }
    if (total <= maxEm) return null;

    var counts = [];
    var oneEach = function () {
      for (var j = 0; j < n; j++) counts.push(1);
      return counts;
    };
    if (n <= LYRIC_ONE_PER_LINE_MAX) return oneEach();

    // 分句多（英文长句）时按宽度均衡分组：断点取最接近目标宽度的那个，
    // 否则会拆出"前一行塞满、后一行只剩一个词"的碎行。
    var lines = Math.ceil(total / maxEm);
    if (lines >= n) return oneEach();
    var target = total / lines;
    var start = 0;
    var startPos = 0;
    for (var line = 0; line < lines; line++) {
      var linesLeft = lines - line - 1;
      var maxEnd = n - linesLeft;        // 这一行最晚只能占到 maxEnd - 1
      var want = startPos + target;
      var best = start;
      var bestDiff = Infinity;
      for (var e = start; e < maxEnd; e++) {
        var diff = Math.abs(cum[e] - want);
        if (diff < bestDiff) { bestDiff = diff; best = e; }
      }
      counts.push(best - start + 1);
      startPos = cum[best] + LYRIC_EM_SPACE;
      start = best + 1;
    }
    if (start < n) counts[counts.length - 1] += n - start;
    return counts.length >= 2 ? counts : null;
  }

  // 逐词数组按词间空白切成 [{ from, to, em }]；纯空白词只当分隔符
  function _wordRuns(words) {
    var runs = [];
    var cur = null;
    var pendingBreak = false;
    for (var i = 0; i < words.length; i++) {
      var text = words[i].text || '';
      var core = text.replace(/\s+/g, '');
      if (!core) {
        if (runs.length) pendingBreak = true;
        continue;
      }
      if (!cur || pendingBreak || /^\s/.test(text)) {
        cur = { from: i, to: i + 1, em: 0 };
        runs.push(cur);
      } else {
        cur.to = i + 1;
      }
      pendingBreak = /\s$/.test(text);
      cur.em += _textEm(core);
    }
    return runs;
  }

  function _runWords(words, from, to) {
    var out = [];
    for (var i = from; i < to; i++) {
      var w = words[i];
      var text = w.text || '';
      if (i === from) text = text.replace(/^\s+/, '');
      if (i === to - 1) text = text.replace(/\s+$/, '');
      if (!text) continue;
      out.push({ start: w.start, end: w.end, text: text });
    }
    if (!out.length) {
      for (var j = from; j < to; j++) out.push(words[j]);
    }
    return out;
  }

  function _splitPhraseText(text) {
    var raw = String(text == null ? '' : text).split(/[\s\u3000]+/);
    var out = [];
    for (var i = 0; i < raw.length; i++) if (raw[i]) out.push(raw[i]);
    return out;
  }

  // 每行占原句的字符比例，翻译/音译按它分配
  function _groupRatios(groups) {
    var lens = [];
    var total = 0;
    for (var i = 0; i < groups.length; i++) {
      var s = groups[i].text;
      if (s === undefined) {
        s = '';
        for (var w = 0; w < groups[i].words.length; w++) s += groups[i].words[w].text;
      }
      var n = _segmentGraphemes(s.replace(/\s+/g, '')).length;
      if (n < 1) n = 1;
      lens.push(n);
      total += n;
    }
    var out = [];
    for (var j = 0; j < lens.length; j++) out.push(lens[j] / total);
    return out;
  }

  // 把翻译/音译拆成 ratios.length 段。只能按**已有空格**分：
  // 词数不够分就整段保留（宁可它自己按 CSS 换行，也不硬按字数切开）。
  function _splitAuxText(text, ratios) {
    var s = String(text == null ? '' : text).trim();
    if (!s) return null;
    var toks = _splitPhraseText(s);
    if (toks.length < ratios.length) return [s];
    return _distributeAuxTokens(toks, ratios);
  }

  function _distributeAuxTokens(tokens, ratios) {
    var k = ratios.length;
    var out = [];
    var i;
    // 词数不够分：一句一个（比例分配在这种情况下会把词全堆在第一行）
    if (tokens.length <= k) {
      for (i = 0; i < k; i++) out.push(tokens[i] || '');
      return out;
    }
    var total = 0;
    for (i = 0; i < tokens.length; i++) total += tokens[i].length;
    var gi = 0;
    var acc = 0;
    var bucket = [];
    for (i = 0; i < tokens.length; i++) {
      bucket.push(tokens[i]);
      acc += tokens[i].length;
      var linesLeft = k - 1 - gi;
      var tokensLeft = tokens.length - 1 - i;
      if (linesLeft <= 0) continue;
      var reach = acc >= total * ratios[gi];
      // 剩下的词刚好够后面每行一个时，必须立刻收尾
      if (tokensLeft >= linesLeft && (reach || tokensLeft <= linesLeft)) {
        out.push(bucket.join(' '));
        bucket = [];
        acc = 0;
        gi++;
      }
    }
    if (bucket.length) out.push(bucket.join(' '));
    while (out.length < k) out.push('');
    return out;
  }

  // 把翻译/音译拆成 ratios.length 段：只能按**已有空格**分，
  // 词数不够就整段保留（宁可它自己按 CSS 换行，也不按字数硬切）
  function _splitAuxText(text, ratios) {
    var s = String(text == null ? '' : text).trim();
    if (!s) return null;
    var toks = _splitPhraseText(s);
    if (toks.length < ratios.length) return [s];
    return _distributeAuxTokens(toks, ratios);
  }

  function _appendAuxSpan(host, cls, text, words, baseFont, jpFont) {
    if (!text) return;
    var el = document.createElement('span');
    el.className = cls;
    _applyLineFont(el, false, baseFont, jpFont);
    if (words && words.length) _appendWords(el, words);
    else el.textContent = text;
    host.appendChild(el);
  }

  // 一行歌词的正文：按需把一句拆成多个 .np-lyrics-phrase 块（原文一组、
  // 音译一组、翻译一组，各自按自己的空格换行）。
  function _appendLineBody(div, line, maxEm, baseFont, jpFont) {
    var words = (line.words && line.words.length) ? line.words : null;
    var runs = null;
    var phrases = null;
    var ems = [];
    var i;

    if (words) {
      runs = _wordRuns(words);
      for (i = 0; i < runs.length; i++) ems.push(runs[i].em);
    } else {
      phrases = _splitPhraseText(line.text);
      for (i = 0; i < phrases.length; i++) ems.push(_textEm(phrases[i]));
    }

    var counts = _planLineBreaks(ems, maxEm);
    var groups = [];
    if (!counts) {
      groups.push(words ? { words: words } : { text: line.text });
    } else {
      var cursor = 0;
      for (i = 0; i < counts.length; i++) {
        if (words) {
          var from = runs[cursor].from;
          var to = runs[cursor + counts[i] - 1].to;
          groups.push({ words: _runWords(words, from, to) });
        } else {
          groups.push({ text: phrases.slice(cursor, cursor + counts[i]).join(' ') });
        }
        cursor += counts[i];
      }
    }

    var multi = groups.length > 1;
    // 逐词行原本只有一个"末词"，拆句后每句都有自己的末词：
    // 其 end 还停在整句结尾，会让这句最后一个字一路填色到下一句唱完
    if (multi && words) {
      for (i = 0; i < groups.length - 1; i++) {
        var gWords = groups[i].words;
        var nextStart = groups[i + 1].words.length ? groups[i + 1].words[0].start : null;
        if (nextStart !== null && gWords.length) {
          var lastWord = gWords[gWords.length - 1];
          if (lastWord.end > nextStart) lastWord.end = nextStart;
        }
      }
    }
    var ratios = multi ? _groupRatios(groups) : null;
    var romajiParts = multi ? _splitAuxText(line.romaji, ratios) : null;
    var transParts = multi ? _splitAuxText(line.translation, ratios) : null;

    if (!multi) {
      if (words) _appendWords(div, line.words);
      else div.textContent = line.text;
      _appendAuxSpan(div, 'np-lyrics-romaji', line.romaji, line.romajiWords, baseFont, jpFont);
      _appendAuxSpan(div, 'np-lyrics-trans', line.translation, line.translationWords, baseFont, jpFont);
    } else {
      // 原文每句一块，各占一行
      for (i = 0; i < groups.length; i++) {
        var host = document.createElement('div');
        host.className = 'np-lyrics-phrase';
        if (groups[i].words) _appendWords(host, groups[i].words);
        else host.textContent = groups[i].text;
        div.appendChild(host);
      }
      // 音译、翻译各自成组整体下移，行数与原句一致（不插在原文行之间）
      for (i = 0; i < groups.length; i++) {
        if (romajiParts && romajiParts[i]) {
          _appendAuxSpan(div, 'np-lyrics-romaji', romajiParts[i], null, baseFont, jpFont);
        }
      }
      for (i = 0; i < groups.length; i++) {
        if (transParts && transParts[i]) {
          _appendAuxSpan(div, 'np-lyrics-trans', transParts[i], null, baseFont, jpFont);
        }
      }
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

  // 词级 active/past 的判定每帧都要跑一次（updatePosition 是逐帧的）。
  // 旧写法每帧都 querySelectorAll + 无脑 remove/add class：即使状态没变也会让
  // 整组词的样式失效重算，和逐字 RAF 的 inline 写入互相打断。
  // 这里把词元素、时间戳、当前状态都缓存在行元素上，只在状态真的翻转时才写 class。
  function _lineWordEls(lineEl) {
    var words = lineEl._wordEls;
    if (!words) {
      words = lineEl.querySelectorAll('.np-lyrics-word');
      for (var i = 0; i < words.length; i++) {
        var w = words[i];
        w._wStart = parseInt(w.dataset.time, 10) || 0;
        w._wEnd = parseInt(w.dataset.end, 10) || 0;
        w._wState = -1;
      }
      lineEl._wordEls = words;
    }
    return words;
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
    App.utils.animateLyricsScroll(els.lyricsWrap, target, { instant: _lyricsIsDiscontinuousJump(target) });
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
    // 目标位置取真实布局（offsetTop），不是"索引 × 固定行高" —— 换行/多行/不同间距都算得准。
    // 每次切换只测一次，动画期间目标固定不变，不会因重新测量而抖动。
    var target = lineTop - els.lyricsWrap.clientHeight * factor + lineEl.clientHeight / 2;
    App.utils.animateLyricsScroll(els.lyricsWrap, target, { instant: _lyricsIsDiscontinuousJump(target) });
  }

  // Seek / 跳转 / 手动滚远后重新对齐：位移超过一屏就属于"非连续定位"，
  // 直接落点，不套普通换行动画（否则会变成一段扫过几十行的长距离滚动）。
  function _lyricsIsDiscontinuousJump(target) {
    var h = els.lyricsWrap.clientHeight;
    if (!h) return false;
    return Math.abs(target - els.lyricsWrap.scrollTop) > h * 1.2;
  }

  function _schedulePostCollapseScroll(lineEl, lineIdx, prevIdx) {
    var el = _interludeExitEl;
    if (!el) { _doActivationScroll(lineEl, lineIdx, prevIdx); return; }

    // 只有"间奏后紧邻的那一行"才知道塌缩后的真实行位置；其它行（比如 seek 跳远）
    // 必须用元素当前 offsetTop，否则会把歌词滚到间奏附近、当前行跑到视口外。
    var useCollapsedTop = lineIdx === _interludeExitNextIdx &&
      typeof _interludeExitLineTop === 'number';
    var finalLineTop = useCollapsedTop ? _interludeExitLineTop - _interludeExitHeight : undefined;
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
      _interludeExitNextIdx = -1;
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
      _interludeExitNextIdx = _nextLineIdx;
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
      var agWords = _lineWordEls(agLine);
      for (var aw = 0; aw < agWords.length; aw++) {
        var aWord = agWords[aw];
        var st = adjustedPos >= aWord._wEnd ? 2
          : (adjustedPos >= aWord._wStart ? 1 : 0);
        if (aWord._wState === st) continue;
        aWord._wState = st;
        aWord.classList.toggle('past', st === 2);
        aWord.classList.toggle('active', st === 1);
      }
    }

    // 同唱组内所有含词行同时做逐词渐进动画
    var wantLines = [];
    for (var wgi = 0; wgi < activeGroup.length; wgi++) {
      var wgLine = lines[activeGroup[wgi]];
      if (wgLine && _lineWordEls(wgLine).length) wantLines.push(wgLine);
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


  // 过渡态隐藏（切歌 glitch / 交叉淡化）是成对发生的：start 时藏、complete 时收。
  // 一旦引擎侧没有发 complete（seek、stop、next 被丢弃），恢复事件就永远不来，
  // 歌词会一直停在 opacity .15 + blur(8px)、封面 opacity 0 —— 看起来就是"板块空白"。
  // 所以每次隐藏都挂一个兜底计时器，超时强制收回。
  var _trackInfoHideTimer = 0;

  function _clearTrackInfoHideTimer() {
    if (_trackInfoHideTimer) {
      clearTimeout(_trackInfoHideTimer);
      _trackInfoHideTimer = 0;
    }
  }

  np.setTrackInfoHidden = function (hidden, opts) {
    if (hidden) {
      var guardMs = (opts && opts.guardMs > 0) ? opts.guardMs : 2000;
      _clearTrackInfoHideTimer();
      _trackInfoHideTimer = setTimeout(function () {
        _trackInfoHideTimer = 0;
        if (_trackInfoHidden) np.setTrackInfoHidden(false);
      }, guardMs);
      if (!_trackInfoHidden) {
        _trackInfoHidden = true;
        _animateGlitch(true);
        _setMysteryVisuals(true);
      }
      return;
    }

    _clearTrackInfoHideTimer();
    if (_trackInfoHidden) {
      _trackInfoHidden = false;
      _needsGlitchRestore = true;
      if (App.state.currentTrack) {
        _preserveHiddenState = true;
        np.updateTrack(App.state.currentTrack);
      } else {
        // 没有曲目可重绘时也要把蒙层收掉，否则会留在空白态
        _needsGlitchRestore = false;
        _animateGlitch(false);
        _setMysteryVisuals(false);
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
  function _cancelLyricsScrollAnim() {
    if (els.lyricsWrap) App.utils.cancelLyricsScroll(els.lyricsWrap);
  }
  function _onLyricsPress(e) {
    // 按下即冻结：否则待点击的那一行会在动画里继续移动，click 落点会漂到别的行上。
    _cancelLyricsScrollAnim();
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
    // The VirtualList cell only owns the 2px segment gap; the inner row carries
    // the surface / shape morph / state layer (same as .vl-track-row-wrapper).
    el.className = 'vl-queue-row-wrapper vl-item';
    el.onclick = null;
    el.draggable = false;

    const row = document.createElement('div');
    row.className = 'np-queue-item' + (index === currentIndex ? ' current' : '');
    row.dataset.index = index;
    row.draggable = true;

    let coverHtml;
    if (track.has_cover) {
      coverHtml = `<img loading="lazy" decoding="async" src="${window.coverUrl(track.id, 128)}" alt="">`;
    } else {
      const bg = App.utils.hashColor(track.album || track.title);
      coverHtml = `<div class="np-queue-cover" style="background:${bg}">${App.utils.initial(track.album || track.title)}</div>`;
    }

    row.innerHTML = `
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
    el.innerHTML = '';
    el.appendChild(row);
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
    els.dropdownMenu.style.display = 'flex';
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
      const activeTab = _activePivotTab();
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
      _resyncLyricsScroll();
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

  // 动画真正跑完再撤动画类：固定 delay 在主线程忙/掉帧时会中途掐断动画，
  // transform/opacity 从中间值直接跳到终态，看起来就是"闪一下"。
  // 用 animationend 收尾，另留兜底 timeout（prefers-reduced-motion 下动画被关掉，不派发事件）。
  function _afterPaneAnimation(pane, name, fallbackMs, done) {
    var finished = false;
    function finish() {
      if (finished) return;
      finished = true;
      pane.removeEventListener('animationend', onEnd);
      done();
    }
    function onEnd(e) {
      if (e.target === pane && e.animationName === name) finish();
    }
    pane.addEventListener('animationend', onEnd);
    _expandTimers.push(setTimeout(finish, fallbackMs));
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
const activeTab = _activePivotTab();
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

        _afterPaneAnimation(pane, 'np-slide-in', 700, function () {
          document.body.classList.remove('player-expanding');
          pane.classList.remove('expanding');
          _resyncLyricsScroll();
        });
      }, 120));
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

  // 面板从隐藏（display:none，clientHeight=0）重新显示时，之前所有 scrollTop 写入都被丢弃，
  // 高亮行会跑到视口外、看起来像"歌词没显示"。这里按当前播放位置重新对齐一次。
  function _resyncLyricsScroll() {
    var wrap = els.lyricsWrap;
    if (!wrap || !lyricsData.length || !wrap.clientHeight) return;
    var panel = wrap.closest('.np-panel--lyrics');
    if (panel && window.getComputedStyle(panel).display === 'none') return;
    lastLyricsIdx = -1;
    lastGroupIdx = -1;
    if (_activeInterlude) _activeInterlude = null;  // 强制重排间奏滚动
    _updateLyrics(_lastKnownPositionMs > 0 ? _lastKnownPositionMs : 0);
  }

  // 🔴 不能用 document.querySelector('.np-pivot-tab.active')：#content-pane 在 DOM 里排在
  // #now-playing-pane 之前，艺人页 / 添加流媒体库对话框里的 .np-pivot-tab 会先被命中。
  // 于是进全屏时读到的是艺人页的 data-tab="songs"，switchTab 找不到同名标签 →
  // 本组标签全部掉 active、三个面板全部掉 active —— 表现为「右栏一片空白 + 标签都没选中」。
  function _activePivotTab() {
    for (var i = 0; i < els.pivotTabs.length; i++) {
      if (els.pivotTabs[i].classList.contains('active')) return els.pivotTabs[i];
    }
    return null;
  }

  function switchTab(tabName, forceFullscreen) {
    // 只接受本组真实存在的标签，其余（脏值 / 别处标签名）一律回落到音乐信息，
    // 保证任何一条路径都不会把三块面板全部关掉。
    var known = false;
    els.pivotTabs.forEach(function (tab) {
      if (tab.getAttribute('data-tab') === tabName) known = true;
    });
    if (!known) tabName = 'info';
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
    requestAnimationFrame(_resyncLyricsScroll);
  }

  function updatePivotIndicator() {
    if (!els.pivotIndicator) return;
    var activeTab = _activePivotTab();
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
      var activeTab = _activePivotTab();
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

  // ── 歌词搜索：独立 dialog（挂 body，不进播放面板） ──────────────
  // 播放面板是 overflow:hidden + clip-path 的容器，浮层留在里面会被裁掉；
  // 结果列表统一走其它场景那套 .md-seglist + .settings-row 的 M3E 列表。
  var _lyricsSearchEls = null;   // { overlay, input, list, onKeydown }

  function _buildLyricsSearchDialog() {
    var t = function (k) { return App.i18n.t(k); };
    var esc = function (v) { return App.utils.esc(String(v == null ? '' : v)); };

    var overlay = document.createElement('div');
    overlay.className = 'cmd-dialog-overlay np-lyrics-search-overlay';
    overlay.id = 'np-lyrics-search-overlay';
    overlay.innerHTML =
      '<div class="cmd-dialog np-lyrics-search-dialog" role="dialog" aria-modal="true">' +
        '<div class="cmd-dialog-title">' + esc(t('np.searchLyrics')) + '</div>' +
        '<div class="mf-dialog-search">' +
          '<span class="material-symbols-rounded">search</span>' +
          '<input type="text" id="np-lyrics-search-input" autocomplete="off" spellcheck="false"' +
                 ' placeholder="' + esc(t('np.searchPlaceholder')) + '">' +
        '</div>' +
        '<div class="np-lyrics-search-list" id="np-lyrics-search-results"></div>' +
        '<div class="cmd-dialog-actions">' +
          '<button type="button" class="cmd-dialog-btn" id="np-lyrics-search-cancel">' + esc(t('common.close')) + '</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);
    return overlay;
  }

  function _openLyricsSearch() {
    if (_lyricsSearchEls) return;
    if (els.lyricsSettingsPopup && els.lyricsSettingsPopup.style.display !== 'none') {
      _closeLyricsSettings();
    }

    var overlay = _buildLyricsSearchDialog();
    var input = overlay.querySelector('#np-lyrics-search-input');
    var list = overlay.querySelector('#np-lyrics-search-results');

    function close() { _closeLyricsSearch(); }

    overlay.querySelector('#np-lyrics-search-cancel').addEventListener('click', close);
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) close();
    });

    input.addEventListener('input', function () {
      if (lyricsSearchDebounce) clearTimeout(lyricsSearchDebounce);
      lyricsSearchDebounce = setTimeout(function () {
        _performLyricsSearch(input.value.trim());
      }, 400);
    });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (lyricsSearchDebounce) clearTimeout(lyricsSearchDebounce);
        _performLyricsSearch(input.value.trim());
      } else if (e.key === 'Escape') {
        e.stopPropagation();
        close();
      }
    });

    // 捕获阶段拦 ESC：全局那份会顺手退出剧场模式，别让它跟着响应
    var onKeydown = function (e) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
      }
    };
    document.addEventListener('keydown', onKeydown, true);

    _lyricsSearchEls = { overlay: overlay, input: input, list: list, onKeydown: onKeydown };

    requestAnimationFrame(function () { overlay.classList.add('open'); });

    var track = App.state.currentTrack;
    var query = track ? ((track.title || '') + ' ' + (track.artist || '')).trim() : '';
    input.value = query;
    // 等开窗动效起帧再聚焦，否则 select() 会被 scale 过渡吃掉
    setTimeout(function () {
      if (!_lyricsSearchEls) return;
      input.focus();
      input.select();
    }, 80);
    if (query) _performLyricsSearch(query);
  }

  function _closeLyricsSearch() {
    if (!_lyricsSearchEls) return;
    var ref = _lyricsSearchEls;
    _lyricsSearchEls = null;
    lyricsSearchGen++;
    if (lyricsSearchDebounce) {
      clearTimeout(lyricsSearchDebounce);
      lyricsSearchDebounce = null;
    }
    if (ref.onKeydown) document.removeEventListener('keydown', ref.onKeydown, true);
    ref.overlay.classList.remove('open');
    setTimeout(function () { ref.overlay.remove(); }, 200);
  }

  function _showSearchStatus(type, message) {
    if (!_lyricsSearchEls) return;
    var icon = type === 'loading' ? 'progress_activity' :
               type === 'error' ? 'error' :
               type === 'empty' ? 'search_off' : 'info';
    _lyricsSearchEls.list.innerHTML =
      '<div class="np-lyrics-search-state ' + type + '">' +
        '<span class="material-symbols-rounded">' + icon + '</span>' +
        '<span>' + App.utils.esc(message) + '</span>' +
      '</div>';
  }

  function _performLyricsSearch(query) {
    if (!_lyricsSearchEls) return;
    if (!query) {
      _lyricsSearchEls.list.innerHTML = '';
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
    if (!_lyricsSearchEls) return;
    var listEl = document.createElement('div');
    listEl.className = 'md-seglist';

    for (var i = 0; i < songs.length; i++) {
      var song = songs[i];
      var sub = App.utils.esc(song.artist || '');
      if (song.album) sub += (sub ? ' · ' : '') + App.utils.esc(song.album);

      var row = document.createElement('button');
      row.type = 'button';
      row.className = 'settings-row md-row-btn';
      row.innerHTML =
        '<span class="settings-row-body">' +
          '<span class="settings-row-label">' + App.utils.esc(song.name || '') + '</span>' +
          (sub ? '<span class="settings-row-sub">' + sub + '</span>' : '') +
        '</span>' +
        '<span class="settings-row-trailing">' +
          '<span class="material-symbols-rounded">chevron_right</span>' +
        '</span>';
      (function (songId) {
        row.addEventListener('click', function () {
          _fetchAndApplyLyrics(songId);
        });
      })(song.id);
      listEl.appendChild(row);
    }

    _lyricsSearchEls.list.innerHTML = '';
    _lyricsSearchEls.list.appendChild(listEl);
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


  // 启动即初始化一次流体（不依赖播放流程；有封面时随后会被真实取色覆盖）
  setTimeout(function () {
    try {
      if (!_fluidPalette) _applyFluidColors(null);
      _startFluidLoop();
      _watchBgTheme();   // 切明/暗主题时重算整套背景配色
    } catch (e) { /* 取色/绘制不可用时静默降级为纯底色 */ }
  }, 0);
})();
