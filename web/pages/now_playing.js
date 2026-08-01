/**
 * Carminium — 右侧正在播放面板逻辑
 * 挂载到 window.App.nowPlaying
 */
(function () {
  'use strict';

  window.App = window.App || {};
  const np = {};
  window.App.nowPlaying = np;

  // DOM
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
    btnShuffle: document.getElementById('btn-shuffle'),
    btnRepeat: document.getElementById('btn-repeat'),
    btnQueue: document.getElementById('btn-queue'),
    btnFullscreen: document.getElementById('btn-fullscreen'),
    btnMoreDropdown: document.getElementById('btn-more-dropdown'),
    dropdownMenu: document.getElementById('split-dropdown-menu'),
    btnFloating: document.getElementById('btn-floating'),
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
    timeCur: document.getElementById('np-time-cur'),
    timeDur: document.getElementById('np-time-dur'),
    btnLike: document.getElementById('btn-like'),
    btnAudioMode: document.getElementById('btn-audio-mode'),
    audioModeLabel: document.getElementById('audio-mode-label'),
    queueList: document.getElementById('np-queue-list'),
    pivotTabs: document.querySelectorAll('.np-pivot-tab'),
    pivotIndicator: document.getElementById('np-pivot-indicator'),
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
    miniProgressBar: document.getElementById('mini-progress-bar'),
    miniProgressTrackFill: document.getElementById('mini-progress-track-fill'),
    miniProgressThumb: document.getElementById('mini-progress-thumb'),
    miniTimeCur: document.getElementById('mini-time-cur'),
    miniTimeDur: document.getElementById('mini-time-dur'),
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
    bgDefs: document.querySelector('.np-bg-defs'),
    // 歌词功能区
    lyricsToolbar: document.getElementById('np-lyrics-toolbar'),
    lyricsSearchBtn: document.getElementById('np-lyrics-search-btn'),
    lyricsTransBtn: document.getElementById('np-lyrics-trans-btn'),
    lyricsRomajiBtn: document.getElementById('np-lyrics-romaji-btn'),
    lyricsSearchOverlay: document.getElementById('np-lyrics-search-overlay'),
    lyricsSearchInput: document.getElementById('np-lyrics-search-input'),
    lyricsSearchClose: document.getElementById('np-lyrics-search-close'),
    lyricsSearchResults: document.getElementById('np-lyrics-search-results'),
    // 歌词设置面板
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
    // 歌词来源标记
    lyricsSource: document.getElementById('np-lyrics-source'),
    lyricsSourceLabel: document.getElementById('np-lyrics-source-label'),
    lyricsSourceArrow: document.getElementById('np-lyrics-source-arrow'),
    lyricsSourceDropdown: document.getElementById('np-lyrics-source-dropdown'),
    lyricsSourceOptions: document.querySelectorAll('.np-lyrics-source-option'),
  };

  let duration = 0;
  let isSeeking = false;
  let lyricsData = [];
  let lastLyricsIdx = -1;
  let lyricsRaf = null;
  let lyricFontSettings = {
    lyrics_font: "",
    lyrics_jp_font: "",
    lyrics_jp_use_distinct: true,
  };
  let progressiveBlurEnabled = false;
  let lyricsCentered = false;
  let lyricsFontSize = 16;
  let circularCover = false;
  let waveProgress = true;
  let lyricsCreditFilters = '';

  // デフォルト復元ビュー：'side' | 'fullscreen'
  let _npDefaultView = 'side';

  // 歌词功能区状态
  let lyricsShowTranslation = true;
  let lyricsShowRomaji = true;
  let lyricsSearchGen = 0;
  let lyricsSearchDebounce = null;
  // 自动搜索代次：切歌或用户手动应用时递增，使旧的自动搜索回调失效
  let _autoSearchGen = 0;

  // 歌词时间偏移（ms）：正值=歌词延后，负值=歌词提前。仅当前会话有效。
  let lyricsTimeOffset = 0;

  // 歌词来源：'embedded' | 'ncm' | 'qqmusic' | 'lrclib' | 'amll' | 'subsonic' | null
  let lyricsSource = null;
  // 搜索路径在调用 apply_lyrics / apply_lyrics_temporary 前暂存来源，
  // lyrics_changed 事件到达时由 np.updateLyrics 消费
  let _pendingLyricsSource = null;
  // 歌词搜索平台：用户选择的网络搜索源（'ncm' | 'qqmusic' | 'lrclib' | 'amll'）
  // 切歌时保持不变，仅用户手动切换词源时更新
  let lyricsSearchSource = 'ncm';
  // 是否有内嵌歌词（用于控制 EMBEDDED 选项可见性）
  let _hasEmbeddedLyrics = false;

  // 氛围背景：双封面层交叉淡入淡出，_bgActiveA 标记当前可见层
  let _bgActiveA = true;
  // 切歌代次：防止快速切歌时旧封面预加载覆盖新封面
  let _bgGen = 0;

  // AutoMix 过渡期间隐藏曲目信息（文字崩坏动画）
  let _trackInfoHidden = false;
  let _glitchAnimId = null;           // requestAnimationFrame 句柄
  let _glitchGen = 0;                 // 动画代数：每次启动新动画时递增，旧帧检测到代数过期即停止覆写
  let _glitchDuration = 700;          // 崩坏动画时长（ms）
  let _glitchOrderCache = {};         // 文本 → 随机排列索引缓存（避免闪烁）
  let _needsGlitchRestore = false;    // updateTrack 后是否需要启动恢复动画
  let _preserveHiddenState = false;   // updateTrack 中保留 _trackInfoHidden 不重置

  // 视频背景（Canvas）
  var _videoBg = null;
  var _videoBgEnabled = false;
  var _videoBgGen = 0;

  // ── BPM + 频谱 联合驱动背景流动（极光效果） ──
  // BPM 提供节拍时序（什么时候该脉动），频谱分析提供实际能量（脉动多强）。
  // 两者相乘：bpmPulse * spectrumEnergy = 精确节拍形状 × 真实音频响应。
  // - BPM 缺失时：只用频谱分析（纯能量驱动）
  // - 频谱缺失时：只用 BPM（机械节拍，无动态强度）
  // - 两者都有：节拍精确 + 强度真实 = 活的极光
  var _beatRafId = 0;            // RAF 句柄
  var _beatBpm = 0;              // 当前曲 BPM
  var _beatIntervalMs = 500;     // 一拍间隔（ms），默认 120 BPM
  var _beatLastPos = -1;         // 上一帧播放位置（检测切歌）
  var _beatPulse = 0;            // 最终脉冲值（0-1，平滑后）
  // 频谱平滑值
  var _beatSpecBass = 0;
  var _beatSpecMid = 0;
  var _beatSpecTreble = 0;
  // 本地位置推算：用 AudioContext.currentTime 在 250ms tick 之间做高精度插值
  var _beatLocalBaseTime = 0;    // 上次 position_changed 时的 AudioContext.currentTime
  var _beatLocalBasePos = 0;     // 上次 position_changed 时的播放位置

  /**
   * 更新本地位置基准（由 position_changed 信号驱动）。
   */
  function _beatUpdatePosition(ms) {
    var engine = App.audioEngine;
    var now = engine && engine._ctx ? engine._ctx.currentTime : 0;
    _beatLocalBaseTime = now;
    _beatLocalBasePos = ms;
  }

  /**
   * 获取高精度当前播放位置。
   * 后端 250ms tick 太粗，用 AudioContext.currentTime 在 tick 之间做线性插值。
   */
  function _beatGetPrecisePosition() {
    var engine = App.audioEngine;
    if (!engine || !engine._ctx) return _beatLocalBasePos;
    var elapsed = (engine._ctx.currentTime - _beatLocalBaseTime) * 1000;
    return _beatLocalBasePos + elapsed;
  }

  // 高精度播放位置（全窗口视图 BPM 相位对齐等で使用）
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
      pane.style.removeProperty('--beat-blur');
      pane.style.removeProperty('--beat-scale');
      pane.style.removeProperty('--beat-sat');
      pane.style.removeProperty('--beat-bright');
      pane.style.removeProperty('--beat-opacity');
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

    // 视频背景激活时不做极光效果
    if (pane.classList.contains('video-active')) {
      _beatRafId = requestAnimationFrame(_beatLoopTick);
      return;
    }

    // ── 1. BPM 节拍形状（时序） ──
    var analysis = App.currentAnalysis;
    var bpm = analysis && analysis.bpm ? analysis.bpm : 0;
    if (bpm !== _beatBpm) {
      _beatBpm = bpm;
      _beatIntervalMs = bpm > 0 ? (60000 / bpm) : 500;
    }

    var pos = _beatGetPrecisePosition();
    if (_beatLastPos >= 0 && (_beatLastPos > pos + 100 || pos - _beatLastPos > 5000)) {
      _beatPulse = 0;
    }
    _beatLastPos = pos;

    // BPM 节拍形状：节拍开始=1，余弦衰减到 0
    var bpmPulse;
    if (bpm > 0) {
      var beatPhase = (pos % _beatIntervalMs) / _beatIntervalMs;
      bpmPulse = Math.max(0, Math.cos(beatPhase * Math.PI));
      bpmPulse = Math.pow(bpmPulse, 0.6);
    } else {
      // 无 BPM：基础呼吸（给频谱一个最低底色）
      var breathPhase = (Date.now() % 3000) / 3000;
      bpmPulse = 0.3 + (Math.sin(breathPhase * Math.PI * 2) + 1) * 0.15;
    }

    // ── 2. 频谱实时能量（强度） ──
    var engine = App.audioEngine;
    var beat = engine ? engine.getBeatData() : null;
    var specBass = 0, specMid = 0, specTreble = 0;
    if (beat) {
      // 指数平滑：attack 快、release 慢
      var aR = 0.4, rR = 0.1;
      _beatSpecBass = _beatSpecBass + (beat.bass - _beatSpecBass) * (beat.bass > _beatSpecBass ? aR : rR);
      _beatSpecMid = _beatSpecMid + (beat.mid - _beatSpecMid) * (beat.mid > _beatSpecMid ? aR * 0.8 : rR * 1.2);
      _beatSpecTreble = _beatSpecTreble + (beat.treble - _beatSpecTreble) * (beat.treble > _beatSpecTreble ? aR * 0.6 : rR * 1.5);
      specBass = _beatSpecBass;
      specMid = _beatSpecMid;
      specTreble = _beatSpecTreble;
    }

    // ── 3. 联合脉冲 = 频谱独立响应 + BPM 节拍强化 ──
    // 加法叠加，不是纯乘法：
    //   - 频谱能量可独立贡献（鼓声来了就响应，不被 BPM 衰减期压制）
    //   - BPM 节拍点提供额外强化（节拍上的鼓声更强）
    //   - 两者都没有时退化为呼吸底色
    var combinedPulse;
    if (beat && beat.level > 0.01) {
      // 频谱能量独立贡献（bass 权重最高）
      var specEnergy = specBass * 0.7 + specMid * 0.2 + specTreble * 0.1;
      // 频谱独立响应：0-0.55（即使不在节拍点，鼓声也能驱动脉动）
      var specContribution = specEnergy * 0.55;
      // BPM 节拍强化：节拍点上的能量额外放大 0-0.45
      var beatContribution = bpmPulse * (0.3 + specEnergy * 0.5) * 0.45;
      combinedPulse = Math.min(1, specContribution + beatContribution);
    } else {
      // 无频谱：纯 BPM 驱动（0.5 倍衰减，避免太机械）
      combinedPulse = bpmPulse * 0.5;
    }

    // 平滑最终脉冲值
    var smoothRate = combinedPulse > _beatPulse ? 0.5 : 0.1;
    _beatPulse = _beatPulse + (combinedPulse - _beatPulse) * smoothRate;

    // ── 4. 分频段驱动 CSS ──
    // bass 驱动模糊 + 缩放（鼓点脉动）
    var blur = 120 - _beatPulse * 48;
    var scale = 1.28 + _beatPulse * 0.08;
    // mid 驱动饱和度（人声/吉他色彩涌动）
    var sat = 1.6 + specMid * 0.6 + _beatPulse * 0.2;
    // treble 驱动亮度（高频微光）
    var bright = 1.05 + specTreble * 0.2 + _beatPulse * 0.05;
    // 联合脉冲驱动透明度
    var opacity = 0.85 + _beatPulse * 0.1;

    pane.style.setProperty('--beat-blur', blur.toFixed(1) + 'px');
    pane.style.setProperty('--beat-scale', scale.toFixed(4));
    pane.style.setProperty('--beat-sat', sat.toFixed(3));
    pane.style.setProperty('--beat-bright', bright.toFixed(3));
    pane.style.setProperty('--beat-opacity', opacity.toFixed(3));

    _beatRafId = requestAnimationFrame(_beatLoopTick);
  }

  // 读取歌词字体设置（失败时静默使用默认值）
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
        _videoBgEnabled = !!s.video_background;
        if (_videoBg) _videoBg.setEnabled(_videoBgEnabled);
        _applyLyricsLayout();
        _applyCircularCoverClass();
        _applyWaveProgressClass();
        // 同步到 popup 控件
        if (els.lyricsBlurToggle) els.lyricsBlurToggle.checked = progressiveBlurEnabled;
        if (els.lyricsCenterToggle) els.lyricsCenterToggle.checked = lyricsCentered;
        if (els.lyricsJpFontToggle) els.lyricsJpFontToggle.checked = lyricFontSettings.lyrics_jp_use_distinct !== false;
        if (els.lyricsFontSizeSlider) els.lyricsFontSizeSlider.value = lyricsFontSize;
        if (els.lyricsFontSizeValue) els.lyricsFontSizeValue.textContent = lyricsFontSize + 'px';
        // 设置变更后如果已有歌词，重新渲染以应用字体
        if (App.state && App.state.currentTrack) {
          _renderLyrics(App.state.currentTrack);
        }
      } catch (e) {
        // 保持默认
      }
    });
  }

  // ── 氛围背景：封面交叉淡入淡出 ──────────────────────────────
  // url      封面图地址（有封面时）
  // fallback 无封面时使用的纯色（哈希色）；两者皆空表示无曲目，淡出全部封面层
  function _setBgCover(url, fallbackColor) {
    if (!els.bgCoverA || !els.bgCoverB) return;
    var gen = ++_bgGen;
    var next = _bgActiveA ? els.bgCoverB : els.bgCoverA;
    var prev = _bgActiveA ? els.bgCoverA : els.bgCoverB;

    function reveal() {
      // 已有更新的曲目请求，丢弃这次过期的加载结果
      if (gen !== _bgGen) return;
      next.classList.add('active');
      prev.classList.remove('active');
      _bgActiveA = !_bgActiveA;
    }

    if (url) {
      // 预加载，加载完成后再切换，避免背景空白闪烁
      var img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = function () {
        if (gen !== _bgGen) return;
        next.style.backgroundImage = 'url("' + url + '")';
        next.style.backgroundColor = '';
        reveal();
      };
      img.onerror = function () {
        if (gen !== _bgGen) return;
        next.style.backgroundImage = '';
        next.style.backgroundColor = fallbackColor || 'var(--md-surface-container-low)';
        reveal();
      };
      img.src = url;
    } else if (fallbackColor) {
      next.style.backgroundImage = '';
      next.style.backgroundColor = fallbackColor;
      reveal();
    } else {
      // 无曲目：淡出所有封面层，仅保留遮罩底色
      els.bgCoverA.classList.remove('active');
      els.bgCoverB.classList.remove('active');
      _bgActiveA = true;
    }
  }

  // 播放/暂停时联动流体动画，暂停时静止以节能
  function _setBgMotionPlaying(playing) {
    if (!els.bgCovers) return;
    if (playing) {
      els.bgCovers.classList.remove('paused');
      if (els.bgDefs && els.bgDefs.unpauseAnimations) {
        try { els.bgDefs.unpauseAnimations(); } catch (e) { /* ignore */ }
      }
    } else {
      els.bgCovers.classList.add('paused');
      if (els.bgDefs && els.bgDefs.pauseAnimations) {
        try { els.bgDefs.pauseAnimations(); } catch (e) { /* ignore */ }
      }
    }
  }

  np.init = function () {
    _loadLyricFontSettings();

    // 视频背景初始化
    var bgEl = document.querySelector('.np-bg');
    if (bgEl && window.VideoBackground) {
      _videoBg = new window.VideoBackground(bgEl);
      _videoBg.setEnabled(_videoBgEnabled);
    }
    // 播放/暂停
    els.btnPlay.addEventListener('click', function () {
      if (App.state.playbackState === 'playing') {
        App.backend.pause();
      } else {
        App.backend.play();
      }
    });

    els.btnPrev.addEventListener('click', () => App.backend.prev_track());
    els.btnNext.addEventListener('click', () => App.backend.next_track());

    // 模式切换
    els.btnShuffle.addEventListener('click', function () {
      App.backend.set_shuffle(!App.state.shuffle);
    });

    els.btnRepeat.addEventListener('click', function () {
      let mode = 'off';
      if (App.state.repeat === 'off') mode = 'all';
      else if (App.state.repeat === 'all') mode = 'one';
      App.backend.set_repeat(mode);
    });

    // Pivot タブ切り替え
    els.pivotTabs.forEach(function (tab) {
      tab.addEventListener('click', function () {
        var target = tab.getAttribute('data-tab');
        switchTab(target);
      });
    });
    // インジケーター初期位置
    requestAnimationFrame(function () {
      updatePivotIndicator();
    });
    window.addEventListener('resize', updatePivotIndicator);

    // Split button — 全屏播放
    els.btnFullscreen.addEventListener('click', function () {
      _toggleFullscreen();
    });

    // Split button — 下拉菜单开关
    els.btnMoreDropdown.addEventListener('click', function (e) {
      e.stopPropagation();
      const isOpen = els.dropdownMenu.style.display !== 'none';
      if (isOpen) {
        _closeDropdown();
      } else {
        _openDropdown();
      }
    });

    // 点击下拉菜单外部关闭
    document.addEventListener('click', function (e) {
      if (!e.target.closest('.split-button')) {
        _closeDropdown();
      }
    });

    // 浮动窗口
    els.btnFloating.addEventListener('click', function () {
      _closeDropdown();
      App.backend.toggle_floating_window();
    });

    // 全屏视图（影院模式：10秒无操作自动隐藏播放控制区）
    els.btnTheater.addEventListener('click', function () {
      _closeDropdown();
      _toggleTheater();
    });

    // 收折播放界面
    els.btnCollapse.addEventListener('click', function () {
      _closeDropdown();
      _toggleCollapse();
    });

    // Escape 键退出影院模式
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        var pane = document.getElementById('now-playing-pane');
        if (pane && pane.classList.contains('theater')) {
          _exitTheater();
        }
      }
    });

    // Mini Player controls
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
    // 底栏还原侧边按钮
    if (els.miniBtnExpand) {
      els.miniBtnExpand.addEventListener('click', function () {
        _toggleCollapse();
      });
    }

    // Mini Player 顶部进度条：点击跳转
    // Mini Player 居中进度条（复用正在播放页进度条样式）：点击跳转
    if (els.miniProgressBar) {
      els.miniProgressBar.addEventListener('click', function (e) {
        if (!duration) return;
        var rect = els.miniProgressBar.getBoundingClientRect();
        var pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        if (els.miniProgressTrackFill) els.miniProgressTrackFill.style.width = (pct * 100) + '%';
        if (els.miniProgressThumb) els.miniProgressThumb.style.left = (pct * 100) + '%';
        App.backend.seek(Math.floor(pct * duration));
      });
    }

    // 进度条拖拽
    els.barWrap.addEventListener('mousedown', function (e) {
      if (!duration) return;
      isSeeking = true;
      _updateSeek(e);
      document.addEventListener('mousemove', _onSeekMove);
      document.addEventListener('mouseup', _onSeekUp);
    });

    // 音量 (合并了 UI 切割和后端更新逻辑)
    els.sliderVol.addEventListener('input', function (e) {
      const val = parseInt(e.target.value, 10);
      App.backend.set_volume(val);

      // 更新 M3 Expressive 分离式滑块的 CSS 变量
      const max = parseInt(e.target.max, 10) || 100;
      const percentage = (val / max) * 100;
      e.target.style.setProperty('--volume-val', `${percentage}%`);
    });

    // 收藏
    els.btnLike.addEventListener('click', function () {
      App.backend.toggle_liked();
    });
    // 底栏歌名右侧的爱心按钮：与侧边收藏共用同一状态
    if (els.miniBtnLike) {
      els.miniBtnLike.addEventListener('click', function () {
        App.backend.toggle_liked();
      });
    }

    // 音频模式切换（excl/shrd 文字状态）
    if (els.btnAudioMode) {
      els.btnAudioMode.addEventListener('click', function () {
        var currentOn = els.btnAudioMode.classList.contains('active');
        np.openAudioModeDialog(!currentOn);
      });
    }

    // ── 歌词功能区 ──
    // 搜索歌词
    if (els.lyricsSearchBtn) {
      els.lyricsSearchBtn.addEventListener('click', function () {
        _openLyricsSearch();
      });
    }
    // 翻译显隐
    if (els.lyricsTransBtn) {
      els.lyricsTransBtn.addEventListener('click', function () {
        lyricsShowTranslation = !lyricsShowTranslation;
        els.lyricsTransBtn.classList.toggle('active', lyricsShowTranslation);
        els.lyricsWrap.classList.toggle('hide-translation', !lyricsShowTranslation);
      });
    }
    // 罗马音显隐
    if (els.lyricsRomajiBtn) {
      els.lyricsRomajiBtn.addEventListener('click', function () {
        lyricsShowRomaji = !lyricsShowRomaji;
        els.lyricsRomajiBtn.classList.toggle('active', lyricsShowRomaji);
        els.lyricsWrap.classList.toggle('hide-romaji', !lyricsShowRomaji);
      });
    }
    // 搜索面板关闭
    if (els.lyricsSearchClose) {
      els.lyricsSearchClose.addEventListener('click', function () {
        _closeLyricsSearch();
      });
    }
    // 搜索面板点击背景关闭
    if (els.lyricsSearchOverlay) {
      els.lyricsSearchOverlay.addEventListener('click', function (e) {
        if (e.target === els.lyricsSearchOverlay) {
          _closeLyricsSearch();
        }
      });
    }
    // 搜索输入
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

    // ── 歌词设置面板 ──
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
    // offset -200ms
    if (els.lyricsOffsetDec) {
      els.lyricsOffsetDec.addEventListener('click', function () {
        lyricsTimeOffset -= 200;
        if (lyricsTimeOffset < -10000) lyricsTimeOffset = -10000;
        _updateOffsetDisplay();
      });
    }
    // offset +200ms
    if (els.lyricsOffsetInc) {
      els.lyricsOffsetInc.addEventListener('click', function () {
        lyricsTimeOffset += 200;
        if (lyricsTimeOffset > 10000) lyricsTimeOffset = 10000;
        _updateOffsetDisplay();
      });
    }
    // 字体大小滑块
    if (els.lyricsFontSizeSlider) {
      els.lyricsFontSizeSlider.addEventListener('input', function () {
        var val = parseInt(els.lyricsFontSizeSlider.value, 10);
        lyricsFontSize = val;
        if (els.lyricsFontSizeValue) els.lyricsFontSizeValue.textContent = val + 'px';
        _applyLyricsLayout();
        // 同步到持久化设置
        App.utils.call('save_settings', JSON.stringify({ lyrics_font_size: val }));
      });
    }
    // 渐进模糊
    if (els.lyricsBlurToggle) {
      els.lyricsBlurToggle.addEventListener('change', function () {
        var enabled = els.lyricsBlurToggle.checked;
        progressiveBlurEnabled = enabled;
        var wrap = document.getElementById('np-lyrics-wrap');
        if (wrap) wrap.classList.toggle('progressive-blur', enabled);
        App.utils.call('save_settings', JSON.stringify({ lyrics_progressive_blur: enabled }));
      });
    }
    // 居中排版
    if (els.lyricsCenterToggle) {
      els.lyricsCenterToggle.addEventListener('change', function () {
        var enabled = els.lyricsCenterToggle.checked;
        lyricsCentered = enabled;
        _applyLyricsLayout();
        App.utils.call('save_settings', JSON.stringify({ lyrics_center: enabled }));
      });
    }
    // 日文独立字体
    if (els.lyricsJpFontToggle) {
      els.lyricsJpFontToggle.addEventListener('change', function () {
        var enabled = els.lyricsJpFontToggle.checked;
        lyricFontSettings.lyrics_jp_use_distinct = enabled;
        App.utils.call('save_settings', JSON.stringify({ lyrics_jp_use_distinct: enabled }));
        // 重新渲染歌词以应用字体变更
        if (App.state && App.state.currentTrack) {
          _renderLyrics(App.state.currentTrack);
        }
      });
    }

    // ── 词源选择器 ──
    if (els.lyricsSource) {
      els.lyricsSource.addEventListener('click', function (e) {
        // 点击选项时不触发 toggle（由选项自身的 handler 处理）
        if (e.target.closest('.np-lyrics-source-option')) return;
        e.stopPropagation();
        _toggleSourceDropdown();
      });
    }
    // 点击外部关闭下拉菜单
    document.addEventListener('click', function (e) {
      if (els.lyricsSource && els.lyricsSource.classList.contains('dropdown-open')) {
        if (!e.target.closest('.np-lyrics-source')) {
          _closeSourceDropdown();
        }
      }
    });
    // 选项点击
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
    }

    function _openLyricsSettings() {
      if (!els.lyricsSettingsPopup) return;
      els.lyricsSettingsPopup.classList.remove('closing');
      els.lyricsSettingsPopup.style.display = '';
      // 同步当前设置到 popup 控件
      if (els.lyricsFontSizeSlider) els.lyricsFontSizeSlider.value = lyricsFontSize;
      if (els.lyricsFontSizeValue) els.lyricsFontSizeValue.textContent = lyricsFontSize + 'px';
      if (els.lyricsBlurToggle) els.lyricsBlurToggle.checked = !!progressiveBlurEnabled;
      if (els.lyricsCenterToggle) els.lyricsCenterToggle.checked = !!lyricsCentered;
      if (els.lyricsJpFontToggle) els.lyricsJpFontToggle.checked = lyricFontSettings.lyrics_jp_use_distinct !== false;
      _updateOffsetDisplay();
      // 让工具栏保持可见
      if (els.lyricsToolbar) els.lyricsToolbar.classList.add('always-visible');
    }

    function _closeLyricsSettings() {
      if (!els.lyricsSettingsPopup) return;
      els.lyricsSettingsPopup.classList.add('closing');
      // 等动画结束后隐藏
      setTimeout(function () {
        if (els.lyricsSettingsPopup) {
          els.lyricsSettingsPopup.style.display = 'none';
          els.lyricsSettingsPopup.classList.remove('closing');
        }
      }, 150);
      // 恢复工具栏自动隐藏
      if (els.lyricsToolbar) els.lyricsToolbar.classList.remove('always-visible');
    }

    function _updateSeek(e) {
      const rect = els.barWrap.getBoundingClientRect();
      let pct = (e.clientX - rect.left) / rect.width;
      pct = Math.max(0, Math.min(1, pct));
      els.barFill.style.width = (pct * 100) + '%';
      els.barThumb.style.left = (pct * 100) + '%';
      els.timeCur.textContent = App.utils.formatDuration(pct * duration);
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

  // ── 切歌飞出/飞入动画 ────────────────────────────────────────────────
  // 真实换曲时：专辑图与歌名（歌手/专辑行随行）先向上加速平移飞出，
  // 内容替换后自下方回弹飞入。代际守卫防止快速连切时旧动画覆写新内容。
  var _flyGen = 0;
  var _FLY_OUT_EASE = 'cubic-bezier(0.3, 0, 0.8, 0.15)';   // 离场：加速
  var _FLY_IN_EASE = 'cubic-bezier(0.3, 1.25, 0.44, 1)';   // 入场：回弹过冲

  function _flyItems() {
    return [
      // 侧栏信息组
      { el: els.cover, delay: 0 },
      { el: els.title, delay: 60 },
      { el: els.artist, delay: 100 },
      { el: els.album, delay: 130 },
      // 面板迷你信息条（歌词页标签下可见）
      { el: els.miniInfoCover, delay: 0 },
      { el: els.miniInfoTitle, delay: 60 },
      { el: els.miniInfoArtist, delay: 100 },
      // 底栏组
      { el: els.miniCover, delay: 0 },
      { el: els.miniTitle, delay: 60 },
      { el: els.miniArtist, delay: 100 }
    ].filter(function (it) { return !!it.el; });
  }

  function _playTrackFly(track) {
    var myGen = ++_flyGen;
    var items = _flyItems();

    // Phase 1: 飞出（上抛 + 渐隐）
    var outAnims = items.map(function (it) {
      return it.el.animate([
        { transform: 'translateY(0)', opacity: 1 },
        { transform: 'translateY(-32%)', opacity: 0 }
      ], { duration: 170, delay: Math.round(it.delay * 0.4), easing: _FLY_OUT_EASE, fill: 'forwards' });
    });

    Promise.all(outAnims.map(function (a) { return a.finished.catch(function () {}); })).then(function () {
      if (myGen !== _flyGen) return; // 已被更新的切歌接管
      // Phase 2: 替换内容
      _applyTrack(track);
      // Phase 3: 飞入（自下方回弹进入，延迟期间保持隐藏）
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
    // 仅在真实换曲时播放飞行动画：同一曲刷新、停止/恢复、
    // AutoMix 神秘态（文字崩坏）期间直接应用，避免互相打架
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
    // AutoMix 过渡期间：记录是否之前处于隐藏状态
    var wasHidden = _trackInfoHidden;
    if (_preserveHiddenState) {
      _preserveHiddenState = false;
    } else {
      _trackInfoHidden = false;
    }
    // 递增代数：使正在运行的崩坏动画帧失效，防止旧曲名覆写新曲名
    _glitchGen++;

    if (!track) {
      els.title.textContent = App.i18n.t('common.notPlaying');
      els.artist.textContent = '—';
      els.album.textContent = '';
      els.coverImg.style.display = 'none';
      els.coverIcon.style.display = '';
      els.cover.style.background = 'var(--md-surface-container)';
      els.coverIcon.style.color = 'var(--md-on-surface-variant)';
      if (els.miniProgressTrackFill) els.miniProgressTrackFill.style.width = '0%';
      if (els.miniProgressThumb) els.miniProgressThumb.style.left = '0%';
      if (els.miniTimeCur) els.miniTimeCur.textContent = '0:00';
      if (els.miniTimeDur) els.miniTimeDur.textContent = '0:00';
      _setBgCover(null, null);
      if (_videoBg) _videoBg.clear();
      // 取消 pin 上一曲的封面
      if (window.CoverCache && np._lastTrackId) {
        window.CoverCache.unpin(np._lastTrackId);
      }
      np._lastTrackId = null;
      lyricsSource = null;
      _hasEmbeddedLyrics = false;
      _updateEmbeddedOptionVisibility();
      _updateLyricsSourceBadge(true);
      return;
    }

    // 同一曲不重复加载封面，避免 AutoMix 切换时闪白
    const isSameTrack = np._lastTrackId === track.id;
    // Pin 当前曲目封面，防止内存清理时被回收；切歌时 unpin 上一曲
    if (window.CoverCache) {
      if (!isSameTrack && np._lastTrackId) {
        window.CoverCache.unpin(np._lastTrackId);
      }
      window.CoverCache.pin(track.id);
    }
    np._lastTrackId = track.id;

    // 新曲：重置悬浮播放栏进度条
    if (!isSameTrack && els.miniProgressTrackFill) els.miniProgressTrackFill.style.width = '0%';
    if (!isSameTrack && els.miniProgressThumb) els.miniProgressThumb.style.left = '0%';

    els.title.textContent = track.title || App.i18n.t('common.unknownTrack');
    els.artist.textContent = track.artist || App.i18n.t('common.unknownArtist');
    els.album.textContent = track.album || '';
    
    if (track.has_cover) {
      if (!isSameTrack || els.coverImg.style.display === 'none') {
        // 先设置 onload/onerror 再设置 src，避免缓存图片的 load 事件丢失
        els.coverImg.onload = function() {
          // 莫奈取色来源：系统壁纸模式下不提取封面颜色，保持系统强调色主题
          if (App.state.monetSource !== 'system_wallpaper') {
            const rgb = App.utils.extractDominantColor(els.coverImg);
            App.utils.applyDynamicTheme(rgb);
            App.state.currentDominantRgb = rgb;
          } else {
            // 系统壁纸模式：保持系统强调色主题
          }
          // 图片加载完成后再清除背景，避免闪白
          els.cover.style.background = '';
        };
        els.coverImg.onerror = function() {
          // 封面加载失败（Subsonic 服务器错误等）：回退到占位色
          els.coverImg.style.display = 'none';
          els.coverIcon.style.display = '';
          els.cover.style.background = App.utils.hashColor(track.album || track.title);
          els.coverIcon.style.color = 'rgba(255,255,255,0.9)';
          App.utils.applyDynamicTheme(null);
          App.state.currentDominantRgb = null;
          _setBgCover(null, App.utils.hashColor(track.album || track.title));
        };
        App.utils.loadCover(els.coverImg, track.id);
      }
      els.coverImg.style.display = '';
      els.coverIcon.style.display = 'none';
      _setBgCover(window.coverUrl ? window.coverUrl(track.id) : null, null);
    } else {
      els.coverImg.style.display = 'none';
      els.coverIcon.style.display = '';
      els.cover.style.background = App.utils.hashColor(track.album || track.title);
      els.coverIcon.style.color = 'rgba(255,255,255,0.9)';
      App.utils.applyDynamicTheme(null);
      App.state.currentDominantRgb = null;
      _setBgCover(null, App.utils.hashColor(track.album || track.title));
    }
    els.btnLike.classList.remove('liked');
    els.btnLike.querySelector('.material-symbols-rounded').classList.remove('icon-filled');

    // Mini player sync
    if (!track) {
      els.miniTitle.textContent = App.i18n.t('common.notPlaying');
      els.miniArtist.textContent = '—';
      els.miniCoverImg.style.display = 'none';
      els.miniCoverIcon.style.display = '';
    } else {
      els.miniTitle.textContent = track.title || App.i18n.t('common.unknownTrack');
      els.miniArtist.textContent = track.artist || App.i18n.t('common.unknownArtist');
      if (track.has_cover) {
        if (!isSameTrack || els.miniCoverImg.style.display === 'none') {
          els.miniCoverImg.onerror = function() {
            els.miniCoverImg.style.display = 'none';
            els.miniCoverIcon.style.display = '';
          };
          App.utils.loadCover(els.miniCoverImg, track.id);
        }
        els.miniCoverImg.style.display = '';
        els.miniCoverIcon.style.display = 'none';
      } else {
        els.miniCoverImg.style.display = 'none';
        els.miniCoverIcon.style.display = '';
      }
    }

    // Mini info bar sync (Pivot 非 info タブ時)
    if (!track) {
      if (els.miniInfo) {
        els.miniInfoTitle.textContent = App.i18n.t('common.notPlaying');
        els.miniInfoArtist.textContent = '—';
        els.miniInfoCoverImg.style.display = 'none';
        els.miniInfoCoverIcon.style.display = '';
      }
    } else {
      if (els.miniInfo) {
        els.miniInfoTitle.textContent = track.title || App.i18n.t('common.unknownTrack');
        els.miniInfoArtist.textContent = track.artist || App.i18n.t('common.unknownArtist');
        if (track.has_cover) {
          if (!isSameTrack || els.miniInfoCoverImg.style.display === 'none') {
            els.miniInfoCoverImg.onerror = function() {
              els.miniInfoCoverImg.style.display = 'none';
              els.miniInfoCoverIcon.style.display = '';
            };
            App.utils.loadCover(els.miniInfoCoverImg, track.id);
          }
          els.miniInfoCoverImg.style.display = '';
          els.miniInfoCoverIcon.style.display = 'none';
        } else {
          els.miniInfoCoverImg.style.display = 'none';
          els.miniInfoCoverIcon.style.display = '';
        }
      }
    }

    // ── 视频背景 ──
    if (_videoBg) {
      if (track.source !== 'subsonic') {
        var vgen = ++_videoBgGen;
        App.utils.call('find_video_for_track', track.id).then(function (result) {
          if (vgen !== _videoBgGen) return; // 过期请求
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

    // ── 歌词 ──
    // 切歌时清除暂存的歌词来源（防止上一曲的 _pendingLyricsSource 误判到新曲）
    _pendingLyricsSource = null;
    // 确定歌词来源：有歌词视为 Embedded，无歌词等待自动搜索
    if (track.lyrics) {
      lyricsSource = 'embedded';
      _hasEmbeddedLyrics = true;
    } else {
      lyricsSource = null;
      // 异步检查是否有内嵌歌词（控制 EMBEDDED 选项可见性）
      _hasEmbeddedLyrics = false;
      _checkEmbeddedLyrics(track);
    }
    _updateEmbeddedOptionVisibility();
    _renderLyrics(track);

    // 如果刚从隐藏状态恢复（或被标记需要恢复），启动文字崩坏恢复动画
    if (wasHidden || _needsGlitchRestore) {
      _needsGlitchRestore = false;
      _animateGlitch(false);
      _setMysteryVisuals(false);
    }
  }

  function _renderLyrics(track) {
    lyricsData = [];
    lastLyricsIdx = -1;
    lyricsTimeOffset = 0;  // 切歌时重置偏移

    if (!els.lyrics) return;
    els.lyrics.innerHTML = '';
    App.utils.cancelLyricsScroll(els.lyricsWrap);
    els.lyricsWrap.scrollTop = 0;

    if (!track || !track.lyrics) {
      if (track && !track.lyrics) {
        // 有曲目但无歌词 → 自动搜索
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

    // 日文检测与字体应用
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
      var frag = document.createDocumentFragment();
      for (var i = 0; i < lyricsData.length; i++) {
        var line = lyricsData[i];
        var lineHasJp = /[\u3040-\u309F\u30A0-\u30FF]/.test(line.text);
        var div = document.createElement('div');
        div.className = 'np-lyrics-line';
        _applyLineFont(div, lineHasJp && useJpDistinct, baseFont, jpFont);
        if (line.words && line.words.length) {
          _appendWords(div, line.words);
        } else {
          div.textContent = line.text;
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
      els.lyrics.appendChild(frag);

      // 追加制作信息（独立样式）
      if (creditsText) {
        els.lyrics.appendChild(_buildCreditsElement(creditsText));
      }
    } else {
      // 纯文本歌词（无时间戳）—— 静态显示
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

      // 追加制作信息（独立样式）
      if (creditsText) {
        els.lyrics.appendChild(_buildCreditsElement(creditsText));
      }
    }

    // 更新翻译/罗马音按钮可见性
    _updateLyricsToggleVisibility();
    _updateLyricsSourceBadge();
  }

  /**
   * 构建制作信息的独立 DOM 元素（小字、底部显示）
   */
  function _buildCreditsElement(text) {
    var el = document.createElement('div');
    el.className = 'np-lyrics-credits';
    el.textContent = text;
    return el;
  }

  // 根据设置应用字体；translation/romaji 永远用标准字体
  function _applyLineFont(el, isJpLine, baseFont, jpFont) {
    if (isJpLine && jpFont) {
      el.style.fontFamily = jpFont;
    } else if (baseFont) {
      el.style.fontFamily = baseFont;
    }
  }

  function _appendWords(container, words) {
    for (var i = 0; i < words.length; i++) {
      var span = document.createElement('span');
      span.className = 'np-lyrics-word';
      span.textContent = words[i].text;
      span.dataset.time = String(words[i].start);
      span.dataset.end = String(words[i].end);
      container.appendChild(span);
    }
  }

  // 歌词渐进模糊：根据距离当前行的距离计算模糊量
  // 距离 0 → blur 0px，距离 1 → blur 1.5px，距离 2 → blur 3px，
  // 距离 3 → blur 4.5px，距离 ≥4 → blur 6px（封顶）
  function _applyProgressiveBlurToLines(activeIdx) {
    if (!progressiveBlurEnabled) return;
    var lines = els.lyricsWrap.querySelectorAll('.np-lyrics-line');
    for (var j = 0; j < lines.length; j++) {
      var distance = Math.abs(j - activeIdx);
      var blurPx = 0;
      if (distance === 0) {
        blurPx = 0;
      } else if (distance === 1) {
        blurPx = 1.5;
      } else if (distance === 2) {
        blurPx = 3;
      } else if (distance === 3) {
        blurPx = 4.5;
      } else {
        blurPx = 6;
      }
      lines[j].style.filter = blurPx > 0 ? 'blur(' + blurPx + 'px)' : '';
    }
  }

  // 供 settings.js 调用：开关切换时重新应用/清除模糊
  np.refreshProgressiveBlur = function (enabled) {
    progressiveBlurEnabled = !!enabled;
    var wrap = document.getElementById('np-lyrics-wrap');
    if (wrap) wrap.classList.toggle('progressive-blur', progressiveBlurEnabled);
    if (!progressiveBlurEnabled) {
      // 清除所有行上的内联 filter
      var lines = els.lyricsWrap.querySelectorAll('.np-lyrics-line');
      for (var j = 0; j < lines.length; j++) {
        lines[j].style.filter = '';
      }
    } else if (lastLyricsIdx >= 0) {
      _applyProgressiveBlurToLines(lastLyricsIdx);
    }
    // 同步到 popup 控件
    if (els.lyricsBlurToggle) els.lyricsBlurToggle.checked = progressiveBlurEnabled;
  };

  // 供 settings.js 调用：切换歌词居中排版
  np.refreshLyricsCenter = function (enabled) {
    lyricsCentered = !!enabled;
    _applyLyricsLayout();
    if (els.lyricsCenterToggle) els.lyricsCenterToggle.checked = lyricsCentered;
  };

  // 供 settings.js 调用：切换歌词字体大小
  np.refreshLyricsFontSize = function (val) {
    lyricsFontSize = parseInt(val, 10) || 16;
    _applyLyricsLayout();
    if (els.lyricsFontSizeSlider) els.lyricsFontSizeSlider.value = lyricsFontSize;
    if (els.lyricsFontSizeValue) els.lyricsFontSizeValue.textContent = lyricsFontSize + 'px';
  };

  // 供 settings.js 调用：切换歌词自定义字体（立即重新渲染歌词）
  // font    基础歌词字体（undefined 表示不修改）
  // jpFont  日文独立字体（undefined 表示不修改）
  np.refreshLyricsFont = function (font, jpFont) {
    if (font !== undefined) lyricFontSettings.lyrics_font = font || '';
    if (jpFont !== undefined) lyricFontSettings.lyrics_jp_font = jpFont || '';
    if (App.state && App.state.currentTrack) {
      _renderLyrics(App.state.currentTrack);
    }
  };

  // 供 settings.js 调用：切换日文独立字体开关
  np.refreshLyricsJpDistinct = function (enabled) {
    lyricFontSettings.lyrics_jp_use_distinct = !!enabled;
    if (els.lyricsJpFontToggle) els.lyricsJpFontToggle.checked = lyricFontSettings.lyrics_jp_use_distinct !== false;
    if (App.state && App.state.currentTrack) {
      _renderLyrics(App.state.currentTrack);
    }
  };

  // 供 settings.js 调用：切换圆形专辑图
  np.refreshCircularCover = function (enabled) {
    circularCover = !!enabled;
    _applyCircularCoverClass();
  };

  // 供 settings.js 调用：更新歌词制作信息筛选词
  np.refreshLyricsCreditFilters = function (val) {
    lyricsCreditFilters = val || '';
    if (App.state && App.state.currentTrack) {
      _renderLyrics(App.state.currentTrack);
    }
  };

  // 供 settings.js 调用：切换视频背景
  np.refreshVideoBackground = function (enabled) {
    _videoBgEnabled = !!enabled;
    if (!_videoBg) return;
    _videoBg.setEnabled(_videoBgEnabled);
    // 刚启用且有当前曲目：尝试加载视频
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

  // 供 settings.js 调用：切换波浪进度条
  np.refreshWaveProgress = function (enabled) {
    waveProgress = !!enabled;
    _applyWaveProgressClass();
  };

  // 应用波浪进度条 class
  function _applyWaveProgressClass() {
    if (els.barFill) {
      els.barFill.classList.toggle('flat', !waveProgress);
    }
    if (els.miniProgressTrackFill) {
      els.miniProgressTrackFill.classList.toggle('flat', !waveProgress);
    }
  }

  // 应用圆形专辑图 class
  function _applyCircularCoverClass() {
    if (els.cover) {
      els.cover.classList.toggle('circular', circularCover);
    }
  }

  // 应用居中排版和字体大小到歌词容器
  function _applyLyricsLayout() {
    if (!els.lyrics) return;
    els.lyrics.classList.toggle('lyrics-centered', lyricsCentered);
    els.lyrics.style.setProperty('--lyrics-font-size', lyricsFontSize + 'px');
  }

  function _updateLyrics(posMs) {
    if (lyricsData.length === 0 || !els.lyricsWrap) return;

    // 应用时间偏移：正值=歌词延后（从播放位置减去偏移），负值=歌词提前
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

    var lines = els.lyricsWrap.querySelectorAll('.np-lyrics-line');
    if (idx !== lastLyricsIdx) {
      var prevLyricsIdx = lastLyricsIdx;
      lastLyricsIdx = idx;
      for (var j = 0; j < lines.length; j++) {
        lines[j].classList.remove('active', 'past');
        if (j < idx) lines[j].classList.add('past');
      }
      if (lines[idx]) lines[idx].classList.add('active');

      // 渐进模糊
      _applyProgressiveBlurToLines(idx);

      // 行级联：各行按与激活行的距离陆续过渡，并带纵向错位回弹
      App.utils.cascadeLyricLines(lines, idx, prevLyricsIdx);

      // 滚动到当前行偏上的位置而非居中（全屏/影院模式下偏下定位）
      var activeLine = lines[idx];
      if (activeLine) {
        var pane = document.getElementById('now-playing-pane');
        var factor = (pane && pane.classList.contains('fullscreen')) ? 0.23 : 0.22;
        var target = activeLine.offsetTop - els.lyricsWrap.clientHeight * factor + activeLine.clientHeight / 2;
        App.utils.animateLyricsScroll(els.lyricsWrap, target);
      }
    }

    // 当前行内逐字高亮：未激活的字较浅，已激活/正在激活的字更亮
    if (lines[idx]) {
      var words = lines[idx].querySelectorAll('.np-lyrics-word');
      for (var w = 0; w < words.length; w++) {
        var word = words[w];
        var start = parseInt(word.dataset.time, 10);
        var end = parseInt(word.dataset.end, 10);
        word.classList.remove('active', 'past');
        if (adjustedPos >= end) {
          word.classList.add('past');
        } else if (adjustedPos >= start) {
          word.classList.add('active');
        }
      }
    }
  }

  np.updateState = function (state) {
    if (state === 'loading') {
      // 加载中：显示封面旋转指示器 + 播放按钮显示 hourglass 图标
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
    // 视频背景播放状态同步
    if (_videoBg) _videoBg.setPlaying(state === 'playing');
  };

  np.updateDuration = function (ms) {
    duration = ms;
    els.timeDur.textContent = App.utils.formatDuration(ms);
  };

np.updatePosition = function (ms) {
// 更新鼓点驱动的本地位置基准（用于 AudioContext.currentTime 插值）
_beatUpdatePosition(ms);
if (isSeeking || !duration) return;
// position 上报可能短暂超过 duration（曲目末尾、切歌时序差），
// clamp 到 [0, duration] 避免显示 5:53/4:57 这种荒谬的时间
var clampedMs = Math.max(0, Math.min(ms, duration));
const pct = Math.max(0, Math.min(1, clampedMs / duration));
els.barFill.style.width = (pct * 100) + '%';
els.barThumb.style.left = (pct * 100) + '%';
els.timeCur.textContent = App.utils.formatDuration(clampedMs);
// 悬浮播放栏居中进度条（复用正在播放页进度条样式）
if (els.miniProgressTrackFill) els.miniProgressTrackFill.style.width = (pct * 100) + '%';
if (els.miniProgressThumb) els.miniProgressThumb.style.left = (pct * 100) + '%';
if (els.miniTimeCur) els.miniTimeCur.textContent = App.utils.formatDuration(clampedMs);
if (els.miniTimeDur && duration) els.miniTimeDur.textContent = App.utils.formatDuration(duration);
// 过渡标记固定在过渡点位置，不跟随进度
_updateLyrics(clampedMs);
// 视频背景进度同步（MV 类型：保持与音乐同一进度）
if (_videoBg) _videoBg.updatePosition(clampedMs);
};

  // ── AutoMix 过渡：文字崩坏动画 ────────────────────────────────────────

  np.setTrackInfoHidden = function (hidden) {
    if (hidden && !_trackInfoHidden) {
      _trackInfoHidden = true;
      _animateGlitch(true);
      _setMysteryVisuals(true);
    } else if (!hidden && _trackInfoHidden) {
      _trackInfoHidden = false;
      _needsGlitchRestore = true;
      // 恢复封面/歌词/背景（updateTrack 会检测 _needsGlitchRestore 启动动画）
      if (App.state.currentTrack) {
        _preserveHiddenState = true;  // 保留隐藏状态，以便后续 setTrackInfoHidden 能正确触发过渡
        np.updateTrack(App.state.currentTrack);
      }
    }
  };

  // 文字崩坏：根据进度将字符逐个替换为 ?（保留空格）
  // progress: 0 = 原文，1 = 全 ?
  function _glitchText(original, progress) {
    if (!original || progress <= 0) return original;
    var chars = original.split('');
    var len = chars.length;

    // 生成或获取随机排列（只替换非空格字符）
    if (!_glitchOrderCache[original]) {
      var indices = [];
      for (var i = 0; i < len; i++) {
        if (chars[i] !== ' ') indices.push(i);
      }
      // Fisher-Yates shuffle
      for (var j = indices.length - 1; j > 0; j--) {
        var r = Math.floor(Math.random() * (j + 1));
        var tmp = indices[j]; indices[j] = indices[r]; indices[r] = tmp;
      }
      _glitchOrderCache[original] = indices;
    }
    var order = _glitchOrderCache[original];

    if (progress >= 1) {
      var full = chars.slice();
      for (var k = 0; k < order.length; k++) full[order[k]] = '?';
      return full.join('');
    }

    var numReplace = Math.floor(progress * order.length);
    var result = chars.slice();
    for (var m = 0; m < numReplace; m++) result[order[m]] = '?';
    return result.join('');
  }

  // 启动文字崩坏/恢复动画
  // toHidden=true: 原文 → ???;  toHidden=false: ??? → 原文
  function _animateGlitch(toHidden) {
    if (_glitchAnimId) {
      cancelAnimationFrame(_glitchAnimId);
      _glitchAnimId = null;
    }

    // 递增代数：旧动画的 pending 帧会检测到代数过期而停止覆写 DOM
    var myGen = ++_glitchGen;

    var track = App.state.currentTrack;
    if (!track) return;

    var title = track.title || App.i18n.t('common.unknownTrack');
    var artist = track.artist || App.i18n.t('common.unknownArtist');
    var album = track.album || '';
    var startTime = performance.now();

    function step(now) {
      // 代数过期 → 新的 updateTrack 或动画已接管，停止覆写
      if (myGen !== _glitchGen) { _glitchAnimId = null; return; }

      var elapsed = now - startTime;
      var rawProgress = Math.min(elapsed / _glitchDuration, 1);
      // easeInOutQuad
      var eased = rawProgress < 0.5
        ? 2 * rawProgress * rawProgress
        : 1 - Math.pow(-2 * rawProgress + 2, 2) / 2;
      // p: 0 = 原文，1 = 全 ?
      var p = toHidden ? eased : 1 - eased;

      var gt = _glitchText(title, p);
      var ga = _glitchText(artist, p);
      var gal = _glitchText(album, p);

      els.title.textContent = gt;
      els.artist.textContent = ga;
      els.album.textContent = gal;
      els.miniTitle.textContent = gt;
      els.miniArtist.textContent = ga;
      if (els.miniInfo) {
        els.miniInfoTitle.textContent = gt;
        els.miniInfoArtist.textContent = ga;
      }

      if (rawProgress < 1) {
        _glitchAnimId = requestAnimationFrame(step);
      } else {
        _glitchAnimId = null;
      }
    }
    _glitchAnimId = requestAnimationFrame(step);
  }

  // 封面/歌词/背景的视觉过渡（CSS transition 平滑过渡）
  function _setMysteryVisuals(toHidden) {
    var dur = _glitchDuration + 'ms';
    if (toHidden) {
      // 封面：blur + 淡出
      els.coverImg.style.transition = 'opacity ' + dur + ', filter ' + dur;
      els.coverImg.style.opacity = '0';
      els.coverImg.style.filter = 'blur(12px)';
      // 歌词：blur + 淡出
      els.lyricsWrap.style.transition = 'filter ' + dur + ', opacity ' + dur;
      els.lyricsWrap.style.filter = 'blur(8px)';
      els.lyricsWrap.style.opacity = '0.15';
      // 氛围背景：淡出
      _setBgCover(null, null);
      if (_videoBg) _videoBg.clear();
      // 清空歌词数据，防止过渡期间滚动
      lyricsData = [];
      lastLyricsIdx = -1;
    } else {
      // 恢复：移除 blur/opacity（CSS transition 淡入）
      els.coverImg.style.transition = 'opacity ' + dur + ', filter ' + dur;
      els.coverImg.style.opacity = '';
      els.coverImg.style.filter = '';
      els.lyricsWrap.style.transition = 'filter ' + dur + ', opacity ' + dur;
      els.lyricsWrap.style.filter = '';
      els.lyricsWrap.style.opacity = '';
      // 动画结束后清理 transition
      setTimeout(function () {
        els.coverImg.style.transition = '';
        els.lyricsWrap.style.transition = '';
      }, _glitchDuration + 50);
    }
  }

  // ── AutoMix 过渡标记 ──────────────────────────────────────────────────
  var _transitionPointMs = -1;

  /**
   * 设置过渡点标记位置并显示。
   * @param {number} transitionStartMs - 过渡开始位置(ms)，-1 表示清除
   * @param {number} [dur] - 当前曲时长(ms)，用于计算百分比
   */
  np.setTransitionPoint = function (transitionStartMs, dur) {
    if (!els.transitionMarker) return;
    if (transitionStartMs < 0 || !dur || dur <= 0) {
      np.clearTransitionPoint();
      return;
    }
    _transitionPointMs = transitionStartMs;
    // 仅记录过渡点位置，不显示文字（过渡开始时由 showTransition 显示）
  };

  /**
   * 清除过渡点标记。
   */
  np.clearTransitionPoint = function () {
    if (!els.transitionMarker) return;
    _transitionPointMs = -1;
    els.transitionMarker.classList.remove('visible');
  };

  np.showTransition = function (active) {
    if (!els.transitionMarker) return;
    if (active) {
      els.transitionMarker.classList.add('visible');
    } else {
      els.transitionMarker.classList.remove('visible');
    }
  };

  np.updateVolume = function (vol) {
    els.sliderVol.value = vol;
    els.labelVol.textContent = vol;
    
    // 确保通过后端初始加载或外部快捷键修改音量时，UI分离轨道也能同步更新
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
  };

  np.updateModes = function (shuffle, repeat) {
    if (shuffle) {
      els.btnShuffle.classList.add('active');
    } else {
      els.btnShuffle.classList.remove('active');
    }

    els.btnRepeat.classList.remove('active');
    els.btnRepeat.querySelector('.material-symbols-rounded').textContent = 'repeat';
    if (repeat === 'all') {
      els.btnRepeat.classList.add('active');
    } else if (repeat === 'one') {
      els.btnRepeat.classList.add('active');
      els.btnRepeat.querySelector('.material-symbols-rounded').textContent = 'repeat_one';
    }
  };

  np.updateLiked = function (liked) {
    if (liked) {
      els.btnLike.classList.add('liked');
      els.btnLike.querySelector('.material-symbols-rounded').classList.add('icon-filled');
      if (els.miniBtnLike) {
        els.miniBtnLike.classList.add('liked');
        els.miniBtnLike.querySelector('.material-symbols-rounded').classList.add('icon-filled');
      }
    } else {
      els.btnLike.classList.remove('liked');
      els.btnLike.querySelector('.material-symbols-rounded').classList.remove('icon-filled');
      if (els.miniBtnLike) {
        els.miniBtnLike.classList.remove('liked');
        els.miniBtnLike.querySelector('.material-symbols-rounded').classList.remove('icon-filled');
      }
    }
  };

  // ── 歌词增量更新（不触发 glitch 动画 / 不重新加载封面）──────────────────────
  // 由 app.js _onLyricsChanged 调用，处理以下场景：
  //   1. 用户手动从网络指定歌词（apply_lyrics → lyrics_changed）
  //   2. 无内嵌歌词时自动搜索（apply_lyrics_temporary → lyrics_changed）
  //   3. 外部更新（如其他窗口修改歌词）
  // _pendingLyricsSource 用于区分来源：搜索路径在调用 apply_* 前设置该值，
  // 此处消费；未设置时默认 'embedded'（有歌词）或 null（无歌词）。
  np.updateLyrics = function (trackId, lyrics) {
    var track = App.state.currentTrack;
    if (!track || track.id !== trackId) return; // 非当前曲目，忽略

    track.lyrics = lyrics;

    // 确定歌词来源
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

  // ── 音频模式（独占/共享）──────────────────────────────────────────────────
  // 正在播放页右下角文字状态按钮：excl（独占）/ shrd（共享）。
  np.updateAudioMode = function (exclusive) {
    if (!els.btnAudioMode || !els.audioModeLabel) return;
    if (exclusive) {
      els.btnAudioMode.classList.add('active');
      els.audioModeLabel.textContent = 'excl';
      els.btnAudioMode.setAttribute('title', App.i18n.t('np.exclusiveMode'));
    } else {
      els.btnAudioMode.classList.remove('active');
      els.audioModeLabel.textContent = 'shrd';
      els.btnAudioMode.setAttribute('title', App.i18n.t('np.sharedMode'));
    }
  };

  // 弹 dialog 确认后切换；供正在播放页按钮与设置页入口共用。
  np.openAudioModeDialog = function (targetOn) {
    App.utils.confirmExclusiveSwitch(targetOn).then(function (ok) {
      if (!ok) return;
      App.utils.call('set_wasapi_exclusive', targetOn).then(function (actual) {
        var actualOn = (actual === 'wasapi_exclusive');
        // 同步独占模式标志到 App.state
        App.state.isExclusive = actualOn;
        np.updateAudioMode(actualOn);
        // settings_changed 事件会同步设置页开关；回退时按钮自动改回 shrd。
        if (actualOn !== targetOn) {
          // 回退提示
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

  np.updateQueue = function (queue, currentIndex) {
    if (!queue || queue.length === 0) {
      els.queueList.innerHTML = '';
      return;
    }

    els.queueList.innerHTML = '';
    for (let i = 0; i < queue.length; i++) {
      const track = queue[i];
      const li = document.createElement('li');
      li.className = 'np-queue-item';
      if (i === currentIndex) {
        li.classList.add('current');
      }
      li.dataset.index = i;

      let coverHtml = '';
      if (track.has_cover) {
        coverHtml = `<img src="${window.coverUrl(track.id)}" alt="">`;
      } else {
        const bg = App.utils.hashColor(track.album || track.title);
        coverHtml = `<div class="np-queue-cover" style="background:${bg}">${App.utils.initial(track.album || track.title)}</div>`;
      }

      li.innerHTML = `
        <div class="np-queue-cover-wrap">${coverHtml}</div>
        <div class="np-queue-info">
          <div class="np-queue-title">${App.utils.esc(track.title || App.i18n.t('common.unknownTrack'))}</div>
          <div class="np-queue-artist">${App.utils.esc(track.artist || App.i18n.t('common.unknownArtist'))}</div>
        </div>
        <div class="np-queue-duration">${App.utils.formatDuration(track.duration_ms)}</div>
        <button class="icon-btn np-queue-remove" title="${App.i18n.t('np.removeFromQueue')}" data-index="${i}">
          <span class="material-symbols-rounded" style="font-size:18px">close</span>
        </button>
      `;

      li.addEventListener('click', function (e) {
        if (e.target.closest('.np-queue-remove')) return;
        App.backend.play_queue_at(i);
      });

      var removeBtn = li.querySelector('.np-queue-remove');
      removeBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        App.backend.remove_from_queue(i);
      });
      App.utils.setupAvoidance(removeBtn);

      els.queueList.appendChild(li);
    }
  };

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

    // ── デフォルト全画面表示モードで全画面解除時は直接底欄へ ──
    if (!enteringFullscreen && _npDefaultView === 'fullscreen') {
      _toggleCollapse();
      return;
    }

    // 退出全窗口视图时同步退出影院模式
    if (!enteringFullscreen && pane.classList.contains('theater')) {
      _exitTheater();
    }
    // 添加过渡类，CSS 动画驱动
    pane.classList.add('fs-transitioning');

    pane.classList.toggle('fullscreen', enteringFullscreen);
    document.body.classList.toggle('np-fullscreen', enteringFullscreen);
    if (_videoBg) _videoBg.onFullscreenChange();

    // 全屏时左侧始终保留音乐信息，右侧展示歌词或待播列表。
    if (enteringFullscreen) {
      const activeTab = document.querySelector('.np-pivot-tab.active');
      const activeTabName = activeTab ? activeTab.getAttribute('data-tab') : 'lyrics';
      switchTab(activeTabName === 'info' ? 'lyrics' : activeTabName);
      // 启动鼓点驱动背景流动
      _startBeatLoop();
    } else {
      const activeTab = document.querySelector('.np-pivot-tab.active');
      switchTab(activeTab ? activeTab.getAttribute('data-tab') : 'info');
      // 停止鼓点驱动
      _stopBeatLoop();
    }

    // 过渡结束后清理
    setTimeout(function () {
      pane.classList.remove('fs-transitioning');
    }, 320);
  }

  // ── 全屏视图（影院模式）───────────────────────────────────────────
  // 在全窗口视图基础上进入更沉浸的全屏体验：
  // 10秒内无鼠标移动/触摸/按键时自动隐藏播放控制区域（顶栏、标签页、控制按钮、音量等）。
  // 任意输入恢复控制区域显示并重新计时。
  var _theaterIdleTimer = null;
  var _theaterIdleDelay = 10000; // 10秒

  function _toggleTheater() {
    var pane = document.getElementById('now-playing-pane');
    if (!pane) return;

    var isTheater = pane.classList.contains('theater');
    if (isTheater) {
      // 退出影院模式（保留全窗口视图）
      _exitTheater();
    } else {
      // 进入影院模式：先确保全窗口视图已激活
      if (!pane.classList.contains('fullscreen')) {
        pane.classList.add('fullscreen');
        document.body.classList.add('np-fullscreen');
        var activeTab = document.querySelector('.np-pivot-tab.active');
        var activeTabName = activeTab ? activeTab.getAttribute('data-tab') : 'lyrics';
        switchTab(activeTabName === 'info' ? 'lyrics' : activeTabName);
        _startBeatLoop();
      }
      pane.classList.add('theater');
      _startTheaterIdleTimer();
      if (_videoBg) _videoBg.onFullscreenChange();
      // 绑定交互监听
      document.addEventListener('mousemove', _onTheaterActivity);
      document.addEventListener('touchstart', _onTheaterActivity);
      document.addEventListener('keydown', _onTheaterActivity);
      // 调用后端进入 OS 全屏（隐藏标题栏/任务栏）
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
    // 调用后端退出 OS 全屏
    if (App.backend && App.backend.toggle_fullscreen) {
      App.backend.toggle_fullscreen();
    }
  }

  function _onTheaterActivity() {
    var pane = document.getElementById('now-playing-pane');
    if (!pane || !pane.classList.contains('theater')) return;
    // 恢复控制区域显示
    pane.classList.remove('controls-hidden');
    // 重置计时器
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
    // 影院模式中は先に影院モードを解除する
    if (pane.classList.contains('theater')) {
      _exitTheater();
    }

    // ── デフォルト全画面表示モード ──
    if (_npDefaultView === 'fullscreen') {
      _toggleCollapseFullscreenDefault(pane);
      return;
    }

// 全屏表示中なら先に全屏を解除する
if (pane.classList.contains('fullscreen')) {
pane.classList.remove('fullscreen');
document.body.classList.remove('np-fullscreen');
const activeTab = document.querySelector('.np-pivot-tab.active');
switchTab(activeTab ? activeTab.getAttribute('data-tab') : 'info');
if (_videoBg) _videoBg.onFullscreenChange();
}

    var isCollapsed = pane.classList.contains('collapsed');
    var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    _clearExpandTimers();

    var content = document.querySelector('.content-pane');

    // ── FLIP：在 grid 切换前记录旧尺寸，切换后立刻反向缩放并动画 ──
    function _flipContent(firstRect, contentEl, reducedMotion) {
      if (!contentEl || !firstRect || reducedMotion) return;
      // grid 已在此函数被调用前切换，同步读取新尺寸
      var lastRect = contentEl.getBoundingClientRect();
      var scaleX = firstRect.width / lastRect.width;
      if (Math.abs(scaleX - 1) < 0.01) return;
      // Invert：施加反向缩放，让元素看起来还在旧尺寸
      contentEl.style.transformOrigin = 'left center';
      contentEl.style.transform = 'scaleX(' + scaleX + ')';
      contentEl.style.willChange = 'transform';
      contentEl.offsetHeight; // 强制 reflow，确保 Invert 状态已绘制
      // Play：粗暴缩放到目标尺寸
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
      // ── 展开（底栏 → 侧边播放器）：底栏下沉 → grid 瞬切 + FLIP + 侧边面板淡入 ──
      document.body.classList.add('player-expanding');
      var mp = els.miniPlayer;

      // 记录旧尺寸（grid 切换前）
      var firstRect = content ? content.getBoundingClientRect() : null;

      // Phase 1: 底栏下沉（CSS 动画驱动，120ms）
      if (mp && !reduced) {
        mp.classList.add('mini-leaving');
      }

      // Phase 2 (120ms后): grid 瞬切 + FLIP + 面板淡入
      _expandTimers.push(setTimeout(function () {
        pane.classList.remove('collapsed');
        document.body.classList.remove('player-collapsed');
        pane.classList.add('expanding');
        _flipContent(firstRect, content, reduced);

        // 移除底栏 leaving 类（此时 body 已无 player-collapsed，底栏自然 display:none）
        if (mp && mp.classList.contains('mini-leaving')) {
          mp.classList.remove('mini-leaving');
        }
      }, 120));

      // Phase 3 (340ms后): 清理
      _expandTimers.push(setTimeout(function () {
        document.body.classList.remove('player-expanding');
        pane.classList.remove('expanding');
      }, 340));
    } else {
      // ── 收折（侧边播放器 → 底栏）：侧边面板淡出 → grid 瞬切 + FLIP + 底栏上滑 ──
      document.body.classList.add('player-collapsing');
      pane.classList.add('collapsing');
      var mp2 = els.miniPlayer;

      // 记录旧尺寸（grid 切换前）
      var firstRect2 = content ? content.getBoundingClientRect() : null;

      // Phase 1: 侧边面板快速淡出（120ms，CSS 动画驱动）

      // Phase 2 (120ms后): grid 瞬切 + FLIP + 底栏上滑
      _expandTimers.push(setTimeout(function () {
        pane.classList.add('collapsed');
        document.body.classList.add('player-collapsed');
        _flipContent(firstRect2, content, reduced);

        // 底栏上滑（CSS 动画驱动，220ms）
        if (mp2 && !reduced) {
          mp2.classList.add('mini-entering');
        }
      }, 120));

      // Phase 3 (360ms后): 清理
      _expandTimers.push(setTimeout(function () {
        document.body.classList.remove('player-collapsing');
        pane.classList.remove('collapsing');
        if (mp2 && mp2.classList.contains('mini-entering')) {
          mp2.classList.remove('mini-entering');
        }
      }, 360));
    }
  }

  // ── デフォルト全画面表示モード専用の折りたたみ/展開 ──
  function _toggleCollapseFullscreenDefault(pane) {
    var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    _clearExpandTimers();
    // 残留アニメーションクラスを清算（快速点击时的卡死防止）
    pane.classList.remove('expanding', 'collapsing', 'fs-transitioning');

    if (pane.classList.contains('collapsed')) {
      // ── 展開（底欄 → 直接全画面） ──
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
        // fs-transitioning 使用（fs-expand 动画：scale + fade，专为全窗口设计）
        pane.classList.add('fs-transitioning');

        if (mp && mp.classList.contains('mini-leaving')) {
          mp.classList.remove('mini-leaving');
        }

        // 全画面タブ設定：info パネルは全画面で常にアクティブ
        const activeTab = document.querySelector('.np-pivot-tab.active');
        const activeTabName = activeTab ? activeTab.getAttribute('data-tab') : 'lyrics';
        switchTab(activeTabName === 'info' ? 'lyrics' : activeTabName);
        _startBeatLoop();
        if (_videoBg) _videoBg.onFullscreenChange();
      }, 120));

      // fs-expand 动画 300ms + 120ms 延迟 = 440ms
      _expandTimers.push(setTimeout(function () {
        document.body.classList.remove('player-expanding');
        pane.classList.remove('fs-transitioning');
      }, 440));
    } else {
      // ── 收折（全画面 → 直接底欄） ──
      if (pane.classList.contains('theater')) {
        _exitTheater();
      }

      document.body.classList.add('player-collapsing');
      // collapsing でフェードアウト（fullscreen は残したまま → position:fixed を維持）
      pane.classList.add('collapsing');

      // switchTab は fullscreen がまだ残っている状態で呼ぶ
      const activeTab = document.querySelector('.np-pivot-tab.active');
      switchTab(activeTab ? activeTab.getAttribute('data-tab') : 'info');
      _stopBeatLoop();
      if (_videoBg) _videoBg.onFullscreenChange();

      var mp2 = els.miniPlayer;

      // Phase 2 (120ms): フェードアウト完了後 → collapsed に切り替え
      _expandTimers.push(setTimeout(function () {
        pane.classList.remove('fullscreen');
        document.body.classList.remove('np-fullscreen');
        pane.classList.add('collapsed');
        document.body.classList.add('player-collapsed');

        if (mp2 && !reduced) {
          mp2.classList.add('mini-entering');
        }
      }, 120));

      // Phase 3 (360ms): 清理
      _expandTimers.push(setTimeout(function () {
        document.body.classList.remove('player-collapsing');
        pane.classList.remove('collapsing');
        if (mp2 && mp2.classList.contains('mini-entering')) {
          mp2.classList.remove('mini-entering');
        }
      }, 360));
    }
  }

  // ── Pivot helpers ────────────────────────────────────────────────────────
  function switchTab(tabName) {
    // タブの active 切り替え
    els.pivotTabs.forEach(function (tab) {
      var isActive = tab.getAttribute('data-tab') === tabName;
      tab.classList.toggle('active', isActive);
      tab.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });
    // パネルの active 切り替え
    const pane = document.getElementById('now-playing-pane');
    const isFullscreen = pane && pane.classList.contains('fullscreen');
    els.panels.forEach(function (panel) {
      const isInfoPanel = panel.getAttribute('data-panel') === 'info';
      // 全屏模式下信息面板始终激活（左栏固定显示）
      panel.classList.toggle('active', (isFullscreen && isInfoPanel) || panel.getAttribute('data-panel') === tabName);
    });
    // ミニ情報バーの表示切り替え
    if (els.miniInfo) {
      if (tabName === 'info' || isFullscreen) {
        els.miniInfo.style.display = 'none';
      } else {
        els.miniInfo.style.display = 'flex';
      }
    }
    // インジケーター位置更新
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

  // ── 歌词功能区：搜索 / 翻译 / 罗马音 ────────────────────────────────────────

// 更新歌词来源标记的显示
// 词源按钮始终显示：有歌词时显示来源，无歌词时显示当前搜索平台
function _updateLyricsSourceBadge() {
  if (!els.lyricsSource) return;
  var labels = {
    'embedded': 'EMBEDDED',
    'ncm': 'NETEASE CLOUD MUSIC',
    'qqmusic': 'QQ MUSIC',
    'lrclib': 'LRCLIB',
    'amll': 'AMLLDB',
    'subsonic': 'EMBEDDED(SUBSONIC)',
  };
  // 有歌词来源时显示对应标签；否则显示当前搜索平台的标签
  var displaySource = lyricsSource || lyricsSearchSource;
  var label = labels[displaySource] || labels[lyricsSearchSource] || 'SELECT SOURCE';
  els.lyricsSource.style.display = '';
  if (els.lyricsSourceLabel) {
    els.lyricsSourceLabel.textContent = label;
  }
  // 同步下拉菜单选中状态
  _updateSourceDropdownActive();
}

  // 更新下拉菜单中的选项高亮状态
  function _updateSourceDropdownActive() {
    if (!els.lyricsSourceOptions) return;
    // 有歌词来源时高亮对应项；无歌词时高亮当前搜索平台
    var activeSource = lyricsSource || lyricsSearchSource;
    // subsonic 来源映射到 EMBEDDED 选项
    if (activeSource === 'subsonic') activeSource = 'embedded';
    els.lyricsSourceOptions.forEach(function (opt) {
      var source = opt.getAttribute('data-source');
      opt.classList.toggle('active', source === activeSource);
    });
  }

  // 更新 EMBEDDED 选项可见性（仅有内嵌歌词时显示）
  function _updateEmbeddedOptionVisibility() {
    if (!els.lyricsSourceOptions) return;
    els.lyricsSourceOptions.forEach(function (opt) {
      if (opt.getAttribute('data-source') === 'embedded') {
        opt.hidden = !_hasEmbeddedLyrics;
      }
    });
  }

  // ── 词源选择器交互 ──

  function _toggleSourceDropdown() {
    if (!els.lyricsSource) return;
    els.lyricsSource.classList.toggle('dropdown-open');
  }

  function _closeSourceDropdown() {
    if (!els.lyricsSource) return;
    els.lyricsSource.classList.remove('dropdown-open');
  }

  // 用户从下拉菜单选择词源
  function _selectLyricsSource(source) {
    if (source === 'embedded') {
      // EMBEDDED：从音频文件中提取内嵌歌词
      _loadEmbeddedLyrics();
      return;
    }

    // 网络源：更新搜索平台并触发搜索
    lyricsSearchSource = source;
    _updateSourceDropdownActive();

    var track = App.state.currentTrack;
    if (!track) return;

    // 显示搜索中状态
    if (els.lyrics) {
      els.lyrics.innerHTML =
        '<div class="np-lyrics-placeholder lyrics-searching">' +
          '<span class="material-symbols-rounded">progress_activity</span>' +
          '<p>' + App.i18n.t('np.searchingLyrics') + '</p>' +
        '</div>';
    }

    // 增加代次使正在进行的自动搜索失效
    _autoSearchGen++;
    var gen = _autoSearchGen;
    var title = (track.title || '').trim();
    var artist = (track.artist || '').trim();
    var query = artist ? (artist + ' ' + title) : title;
    if (!query) {
      _showAutoSearchFailed();
      return;
    }

    // 对于 AMLLDB，使用 "artist - title" 格式的查询
    if (source === 'amll') {
      query = artist ? (artist + ' - ' + title) : title;
    }

    _searchLyricsBySource(track, gen, query, source);
  }

  // 从音频文件中加载内嵌歌词
  function _loadEmbeddedLyrics() {
    var track = App.state.currentTrack;
    if (!track) return;

    // 显示加载中状态
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
        // 临时应用内嵌歌词（不持久化）
        _pendingLyricsSource = 'embedded';
        App.utils.call('apply_lyrics_temporary', track.id, res);
      } else {
        // 无内嵌歌词
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

  // 异步检查曲目是否有内嵌歌词（用于控制 EMBEDDED 选项可见性）
  function _checkEmbeddedLyrics(track) {
    if (!track || !track.id) return;
    // Subsonic 曲目不支持内嵌歌词提取
    if (track.source === 'subsonic') return;
    App.utils.call('get_embedded_lyrics', track.id).then(function (res) {
      // 确保仍然是当前曲目
      if (!App.state.currentTrack || App.state.currentTrack.id !== track.id) return;
      _hasEmbeddedLyrics = !!(res && res.trim());
      _updateEmbeddedOptionVisibility();
    });
  }

  // 根据已渲染歌词内容更新翻译/罗马音按钮的可见性
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

  // 打开歌词搜索面板
  function _openLyricsSearch() {
    if (!els.lyricsSearchOverlay) return;
    // 关闭设置面板（如果打开的话）
    if (els.lyricsSettingsPopup && els.lyricsSettingsPopup.style.display !== 'none') {
      _closeLyricsSettings();
    }
    els.lyricsSearchOverlay.style.display = '';
    requestAnimationFrame(function () {
      els.lyricsSearchOverlay.classList.add('open');
    });
    // 预填当前曲目信息
    var track = App.state.currentTrack;
    if (track) {
      var query = (track.title || '') + ' ' + (track.artist || '');
      els.lyricsSearchInput.value = query.trim();
    } else {
      els.lyricsSearchInput.value = '';
    }
    els.lyricsSearchInput.focus();
    els.lyricsSearchInput.select();
    // 预填后自动搜索
    if (els.lyricsSearchInput.value) {
      _performLyricsSearch(els.lyricsSearchInput.value.trim());
    }
  }

  // 关闭歌词搜索面板
  function _closeLyricsSearch() {
    if (!els.lyricsSearchOverlay) return;
    els.lyricsSearchOverlay.classList.remove('open');
    setTimeout(function () {
      els.lyricsSearchOverlay.style.display = 'none';
      if (els.lyricsSearchResults) els.lyricsSearchResults.innerHTML = '';
      if (els.lyricsSearchInput) els.lyricsSearchInput.value = '';
    }, 250);
    lyricsSearchGen++; // 使正在进行的搜索失效
  }

  // 显示搜索状态提示
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

  // 执行歌词搜索
  function _performLyricsSearch(query) {
    if (!query) {
      if (els.lyricsSearchResults) els.lyricsSearchResults.innerHTML = '';
      return;
    }
    var gen = ++lyricsSearchGen;
    _showSearchStatus('loading', App.i18n.t('np.lyricsSearchLoading'));
    App.utils.call('search_lyrics', query, lyricsSearchSource).then(function (res) {
      if (gen !== lyricsSearchGen) return; // 已过期
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

  // 渲染搜索结果列表
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

  // 获取歌词并应用到当前曲目（用户手动指定 → 持久化）
  function _fetchAndApplyLyrics(songId) {
    // 使任何正在进行的自动搜索失效，防止覆盖用户选择
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
      // 用户手动选择 → 持久化到数据库
      // 后端 apply_lyrics → updateTrackLyrics → lyrics_changed 事件
      // 前端通过 _onLyricsChanged → np.updateLyrics 增量更新歌词显示
      _pendingLyricsSource = lyricsSearchSource;
      App.utils.call('apply_lyrics', track.id, data.lyrics).then(function () {
        _closeLyricsSearch();
      });
    });
  }

  // ── 自动搜索（元数据无歌词时自动触发）────────────────────────────────────

  // 检查指定曲目是否仍为当前播放曲目
  function _isStillCurrentTrack(track) {
    return App.state.currentTrack &&
           App.state.currentTrack.id === track.id;
  }

  // 自动搜索歌词：从搜索结果中选择最佳匹配，临时应用（不持久化）
  // 搜索词用 "artist title" 格式（有 artist 时），提高搜索精度
  function _autoSearchLyrics(track) {
    var gen = ++_autoSearchGen;
    var title = (track.title || '').trim();
    var artist = (track.artist || '').trim();
    var query = artist ? (artist + ' ' + title) : title;
    if (!query) {
      _showAutoSearchFailed();
      return;
    }

    // Subsonic 曲目优先走 Subsonic 接口（getLyricsBySongId / getLyrics）
    if (track.source === 'subsonic' && track.id &&
        String(track.id).indexOf('s') === 0) {
      App.utils.call('get_subsonic_lyrics', track.id).then(function (res) {
        if (gen !== _autoSearchGen || !_isStillCurrentTrack(track)) return;
        var data;
        try { data = JSON.parse(res); } catch (e) { data = null; }
        if (data && data.lyrics) {
          // 设置来源标记，lyrics_changed 事件到达时由 np.updateLyrics 消费
          _pendingLyricsSource = 'subsonic';
          App.utils.call('apply_lyrics_temporary', track.id, data.lyrics).then(function () {
            // lyrics_changed 事件已触发 np.updateLyrics，此处无需手动渲染
            // 仅需检查搜索代次是否过期
            if (gen !== _autoSearchGen || !_isStillCurrentTrack(track)) return;
          });
          return;
        }
        // Subsonic 无歌词：回退到用户选择的搜索源
        var fallbackQuery = query;
        if (lyricsSearchSource === 'amll' && artist) {
          fallbackQuery = artist + ' - ' + title;
        }
        _searchLyricsBySource(track, gen, fallbackQuery, lyricsSearchSource);
      });
      return;
    }

    // 对于 AMLLDB，使用 "artist - title" 格式的查询
    if (lyricsSearchSource === 'amll' && artist) {
      query = artist + ' - ' + title;
    }
    _searchLyricsBySource(track, gen, query, lyricsSearchSource);
  }

  // 归一化字符串：小写、去除括号内容与 feat. 后缀，用于标题/艺术家比较
  function _normStr(s) {
    if (!s) return '';
    s = s.toLowerCase().trim();
    // 去除 (xxx) （xxx） [xxx] 【xxx】 等括号内容
    s = s.replace(/[\(（\[【].*?[\)）\]】]/g, '');
    // 去除 feat./ft. 及之后内容
    s = s.replace(/\s*(feat|ft)\..*/i, '');
    // 去除多余空白
    s = s.replace(/\s+/g, ' ').trim();
    return s;
  }

  // 从网易云搜索结果中选择与当前曲目最匹配的歌曲
  // 评分维度：歌名匹配（最重要）> 艺术家匹配 > 时长接近度
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

      // 歌名匹配（核心指标）
      if (sTitle && tTitle) {
        if (sTitle === tTitle) {
          score += 100;
        } else if (sTitle.indexOf(tTitle) >= 0 || tTitle.indexOf(sTitle) >= 0) {
          score += 60;
        }
      }

      // 艺术家匹配
      if (tArtist && sArtist) {
        if (sArtist === tArtist) {
          score += 50;
        } else if (sArtist.indexOf(tArtist) >= 0 || tArtist.indexOf(sArtist) >= 0) {
          score += 30;
        }
      }

      // 时长接近度（毫秒级）
      if (tDur && sDur) {
        var dDiff = Math.abs(tDur - sDur);
        if (dDiff < 3000) score += 25;
        else if (dDiff < 8000) score += 12;
        else if (dDiff < 15000) score += 5;
      }

      // 同分时略微偏向搜索排序靠前的结果
      score -= i * 0.5;

      if (score > bestScore) {
        bestScore = score;
        best = s;
      }
    }

    return best;
  }

  // 多平台歌词搜索 + 临时应用
  // track   当前曲目
  // gen     搜索代次（用于失效检测）
  // query   搜索词
  // source  搜索平台：'ncm' | 'qqmusic' | 'lrclib' | 'amll'
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

      // 从搜索结果中选择最佳匹配（而非盲目取第一个）
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

        // 临时应用（不持久化到数据库）
        // 设置来源标记，lyrics_changed 事件到达时由 np.updateLyrics 消费
        _pendingLyricsSource = source;
        App.utils.call('apply_lyrics_temporary', track.id, lrcData.lyrics).then(function () {
          // lyrics_changed 事件已触发 np.updateLyrics，此处无需手动渲染
          if (gen !== _autoSearchGen || !_isStillCurrentTrack(track)) return;
        });
      });
    });
  }

  // 自动搜索失败时显示占位符
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

  // ── 加载状态（Subsonic 等网络音频）──────────────────────────────────────────

  /**
   * 设置曲目加载状态（用于 Subsonic 等网络音频加载时的 UI 反馈）
   * @param {boolean} loading - true=加载中，false=加载完成
   */
  np.setTrackLoading = function (loading) {
    if (els.cover) {
      if (loading) {
        // 在封面上显示加载指示器
        if (!els.cover.querySelector('.np-cover-loading')) {
          var loader = document.createElement('div');
          loader.className = 'np-cover-loading';
          loader.innerHTML = '<span class="material-symbols-rounded">progress_activity</span>';
          els.cover.appendChild(loader);
        }
      } else {
        // 移除加载指示器
        var loader = els.cover.querySelector('.np-cover-loading');
        if (loader) {
          loader.remove();
        }
      }
    }
  };

  // ── デフォルト復元ビュー設定変更 ─────────────────────────────────────────
  /**
   * 設定ページから呼ばれる：動的に _npDefaultView を更新
   * @param {string} val - 'side' | 'fullscreen'
   */
  np.setDefaultView = function (val) {
    _npDefaultView = val || 'side';
  };

  // ── 语言变更：刷新动态文本 ───────────────────────────────────────────────
  np.onLanguageChanged = function () {
    var track = App.state.currentTrack;
    if (!track) {
      els.title.textContent = App.i18n.t('common.notPlaying');
      els.miniTitle.textContent = App.i18n.t('common.notPlaying');
      if (els.miniInfo) els.miniInfoTitle.textContent = App.i18n.t('common.notPlaying');
    } else {
      els.title.textContent = track.title || App.i18n.t('common.unknownTrack');
      els.artist.textContent = track.artist || App.i18n.t('common.unknownArtist');
      els.miniTitle.textContent = track.title || App.i18n.t('common.unknownTrack');
      els.miniArtist.textContent = track.artist || App.i18n.t('common.unknownArtist');
      if (els.miniInfo) {
        els.miniInfoTitle.textContent = track.title || App.i18n.t('common.unknownTrack');
        els.miniInfoArtist.textContent = track.artist || App.i18n.t('common.unknownArtist');
      }
    }
    // 刷新音频模式按钮 title
    np.updateAudioMode(App.state.isExclusive);
    // 刷新队列中的动态文本
    if (App.state.queue && App.state.queue.length > 0) {
      np.updateQueue(App.state.queue, App.state.currentQueueIndex);
    }
    // 重新渲染歌词占位符（如果有）
    if (track && !track.lyrics) {
      _renderLyrics(track);
    }
  };

})();
