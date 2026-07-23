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
    transitionMarker: document.getElementById('np-transition-marker'),
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
    miniPlayer: document.getElementById('mini-player'),
    miniCoverImg: document.getElementById('mini-cover-img'),
    miniCoverIcon: document.getElementById('mini-cover-icon'),
    miniTitle: document.getElementById('mini-title'),
    miniArtist: document.getElementById('mini-artist'),
    miniBtnPlay: document.getElementById('mini-btn-play'),
    miniPlayIcon: document.getElementById('mini-play-icon'),
    miniBtnPrev: document.getElementById('mini-btn-prev'),
    miniBtnNext: document.getElementById('mini-btn-next'),
    miniBtnExpand: document.getElementById('mini-btn-expand'),
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
    // 歌词来源标记
    lyricsSource: document.getElementById('np-lyrics-source'),
    lyricsSourceLabel: document.getElementById('np-lyrics-source-label'),
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

  // 歌词功能区状态
  let lyricsShowTranslation = true;
  let lyricsShowRomaji = true;
  let lyricsSearchGen = 0;
  let lyricsSearchDebounce = null;
  // 自动搜索代次：切歌或用户手动应用时递增，使旧的自动搜索回调失效
  let _autoSearchGen = 0;

  // 歌词来源：'embedded' | 'ncm' | 'subsonic' | null
  let lyricsSource = null;
  // 手动应用歌词后，track_changed 到达前暂存来源
  let _pendingLyricsSource = null;

  // 氛围背景：双封面层交叉淡入淡出，_bgActiveA 标记当前可见层
  let _bgActiveA = true;
  // 切歌代次：防止快速切歌时旧封面预加载覆盖新封面
  let _bgGen = 0;

  // AutoMix 过渡期间隐藏曲目信息（文字崩坏动画）
  let _trackInfoHidden = false;
  let _glitchAnimId = null;           // requestAnimationFrame 句柄
  let _glitchDuration = 700;          // 崩坏动画时长（ms）
  let _glitchOrderCache = {};         // 文本 → 随机排列索引缓存（避免闪烁）
  let _needsGlitchRestore = false;    // updateTrack 后是否需要启动恢复动画

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
        _applyLyricsLayout();
        _applyCircularCoverClass();
        _applyWaveProgressClass();
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
    els.miniBtnExpand.addEventListener('click', function () {
      _toggleCollapse();
    });

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

  np.updateTrack = function (track) {
    // AutoMix 过渡期间：记录是否之前处于隐藏状态
    var wasHidden = _trackInfoHidden;
    _trackInfoHidden = false;

    if (!track) {
      els.title.textContent = '未在播放';
      els.artist.textContent = '—';
      els.album.textContent = '';
      els.coverImg.style.display = 'none';
      els.coverIcon.style.display = '';
      els.cover.style.background = 'var(--md-surface-container)';
      els.coverIcon.style.color = 'var(--md-on-surface-variant)';
      _setBgCover(null, null);
      np._lastTrackId = null;
      lyricsSource = null;
      _updateLyricsSourceBadge(true);
      return;
    }

    // 同一曲不重复加载封面，避免 AutoMix 切换时闪白
    const isSameTrack = np._lastTrackId === track.id;
    np._lastTrackId = track.id;

    els.title.textContent = track.title || '未知曲目';
    els.artist.textContent = track.artist || '未知艺术家';
    els.album.textContent = track.album || '';
    
    if (track.has_cover) {
      if (!isSameTrack || els.coverImg.style.display === 'none') {
        // 先设置 onload/onerror 再设置 src，避免缓存图片的 load 事件丢失
        els.coverImg.onload = function() {
          const rgb = App.utils.extractDominantColor(els.coverImg);
          App.utils.applyDynamicTheme(rgb);
          App.state.currentDominantRgb = rgb;
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
      els.miniTitle.textContent = '未在播放';
      els.miniArtist.textContent = '—';
      els.miniCoverImg.style.display = 'none';
      els.miniCoverIcon.style.display = '';
    } else {
      els.miniTitle.textContent = track.title || '未知曲目';
      els.miniArtist.textContent = track.artist || '未知艺术家';
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
        els.miniInfoTitle.textContent = '未在播放';
        els.miniInfoArtist.textContent = '—';
        els.miniInfoCoverImg.style.display = 'none';
        els.miniInfoCoverIcon.style.display = '';
      }
    } else {
      if (els.miniInfo) {
        els.miniInfoTitle.textContent = track.title || '未知曲目';
        els.miniInfoArtist.textContent = track.artist || '未知艺术家';
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

    // ── 歌词 ──
    // 确定歌词来源：手动应用暂存的来源优先，否则有歌词视为 Embedded
    if (_pendingLyricsSource) {
      lyricsSource = _pendingLyricsSource;
      _pendingLyricsSource = null;
    } else if (track.lyrics) {
      lyricsSource = 'embedded';
    } else {
      lyricsSource = null;
    }
    _renderLyrics(track);

    // 如果刚从隐藏状态恢复（或被标记需要恢复），启动文字崩坏恢复动画
    if (wasHidden || _needsGlitchRestore) {
      _needsGlitchRestore = false;
      _animateGlitch(false);
      _setMysteryVisuals(false);
    }
  };

  function _renderLyrics(track) {
    lyricsData = [];
    lastLyricsIdx = -1;

    if (!els.lyrics) return;
    els.lyrics.innerHTML = '';
    els.lyricsWrap.scrollTop = 0;

    if (!track || !track.lyrics) {
      if (track && !track.lyrics) {
        // 有曲目但无歌词 → 自动搜索
        els.lyrics.innerHTML =
          '<div class="np-lyrics-placeholder lyrics-searching">' +
            '<span class="material-symbols-rounded">progress_activity</span>' +
            '<p>正在搜索歌词…</p>' +
          '</div>';
        _autoSearchLyrics(track);
      } else {
        els.lyrics.innerHTML =
          '<div class="np-lyrics-placeholder">' +
            '<span class="material-symbols-rounded">lyrics</span>' +
            '<p>暂无歌词</p>' +
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

    if (App.utils.isLRC(track.lyrics)) {
      lyricsData = App.utils.parseLRC(track.lyrics);
      if (lyricsData.length === 0) {
        els.lyrics.innerHTML =
          '<div class="np-lyrics-placeholder">' +
            '<span class="material-symbols-rounded">lyrics</span>' +
            '<p>暂无歌词</p>' +
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
    } else {
      // 纯文本歌词（无时间戳）—— 静态显示
      var staticLines = App.utils.parseStaticLyrics(track.lyrics);
      if (staticLines.length === 0) {
        els.lyrics.innerHTML =
          '<div class="np-lyrics-placeholder">' +
            '<span class="material-symbols-rounded">lyrics</span>' +
            '<p>暂无歌词</p>' +
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
    }

    // 更新翻译/罗马音按钮可见性
    _updateLyricsToggleVisibility();
    _updateLyricsSourceBadge();
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
  };

  // 供 settings.js 调用：切换歌词居中排版
  np.refreshLyricsCenter = function (enabled) {
    lyricsCentered = !!enabled;
    _applyLyricsLayout();
  };

  // 供 settings.js 调用：切换歌词字体大小
  np.refreshLyricsFontSize = function (val) {
    lyricsFontSize = parseInt(val, 10) || 16;
    _applyLyricsLayout();
  };

  // 供 settings.js 调用：切换圆形专辑图
  np.refreshCircularCover = function (enabled) {
    circularCover = !!enabled;
    _applyCircularCoverClass();
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

    var idx = -1;
    for (var i = 0; i < lyricsData.length; i++) {
      if (posMs >= lyricsData[i].time) {
        idx = i;
      } else {
        break;
      }
    }
    if (idx < 0) idx = 0;

    var lines = els.lyricsWrap.querySelectorAll('.np-lyrics-line');
    if (idx !== lastLyricsIdx) {
      lastLyricsIdx = idx;
      for (var j = 0; j < lines.length; j++) {
        lines[j].classList.remove('active', 'past');
        if (j < idx) lines[j].classList.add('past');
      }
      if (lines[idx]) lines[idx].classList.add('active');

      // 渐进模糊
      _applyProgressiveBlurToLines(idx);

      // 滚动到当前行偏上的位置而非居中（全屏/影院模式下偏下定位）
      var activeLine = lines[idx];
      if (activeLine) {
        var pane = document.getElementById('now-playing-pane');
        var factor = (pane && pane.classList.contains('fullscreen')) ? 0.27 : 0.22;
        var target = activeLine.offsetTop - els.lyricsWrap.clientHeight * factor + activeLine.clientHeight / 2;
        els.lyricsWrap.scrollTo({ top: target, behavior: 'smooth' });
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
        if (posMs >= end) {
          word.classList.add('past');
        } else if (posMs >= start) {
          word.classList.add('active');
        }
      }
    }
  }

  np.updateState = function (state) {
    if (state === 'playing') {
      App.utils.squeezeIcon(els.iconPlay, 'pause');
      App.utils.squeezeIcon(els.miniPlayIcon, 'pause');
      App.utils.bloomButton(els.btnPlay);
      App.utils.bloomButton(els.miniBtnPlay);
      els.btnPlay.classList.add('playing');
      els.cover.classList.add('playing');
      els.barFill.classList.add('playing');
      els.miniBtnPlay.classList.add('playing');
      _setBgMotionPlaying(true);
    } else {
      App.utils.squeezeIcon(els.iconPlay, 'play_arrow');
      App.utils.squeezeIcon(els.miniPlayIcon, 'play_arrow');
      App.utils.bloomButton(els.btnPlay);
      App.utils.bloomButton(els.miniBtnPlay);
      els.btnPlay.classList.remove('playing');
      els.cover.classList.remove('playing');
      els.barFill.classList.remove('playing');
      els.miniBtnPlay.classList.remove('playing');
      _setBgMotionPlaying(false);
    }
  };

  np.updateDuration = function (ms) {
    duration = ms;
    els.timeDur.textContent = App.utils.formatDuration(ms);
  };

  np.updatePosition = function (ms) {
    if (isSeeking || !duration) return;
    const pct = Math.max(0, Math.min(1, ms / duration));
    els.barFill.style.width = (pct * 100) + '%';
    els.barThumb.style.left = (pct * 100) + '%';
    els.timeCur.textContent = App.utils.formatDuration(ms);
    // 过渡标记跟随进度
    if (els.transitionMarker && els.transitionMarker.classList.contains('visible')) {
      els.transitionMarker.style.left = (pct * 100) + '%';
    }
    _updateLyrics(ms);
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

    var track = App.state.currentTrack;
    if (!track) return;

    var title = track.title || '未知曲目';
    var artist = track.artist || '未知艺术家';
    var album = track.album || '';
    var startTime = performance.now();

    function step(now) {
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
  np.showTransition = function (active) {
    if (!els.transitionMarker) return;
    if (active) {
      els.transitionMarker.classList.add('visible');
      // 隐藏普通 thumb，用过渡标记替代
      els.barThumb.style.opacity = '0';
    } else {
      els.transitionMarker.classList.remove('visible');
      els.barThumb.style.opacity = '';
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
    } else {
      els.btnLike.classList.remove('liked');
      els.btnLike.querySelector('.material-symbols-rounded').classList.remove('icon-filled');
    }
  };

  // ── 音频模式（独占/共享）──────────────────────────────────────────────────
  // 正在播放页右下角文字状态按钮：excl（独占）/ shrd（共享）。
  np.updateAudioMode = function (exclusive) {
    if (!els.btnAudioMode || !els.audioModeLabel) return;
    if (exclusive) {
      els.btnAudioMode.classList.add('active');
      els.audioModeLabel.textContent = 'excl';
      els.btnAudioMode.setAttribute('title', 'WASAPI 独占模式（点击切回共享）');
    } else {
      els.btnAudioMode.classList.remove('active');
      els.audioModeLabel.textContent = 'shrd';
      els.btnAudioMode.setAttribute('title', '共享模式（点击切换独占）');
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
            title: '已切回共享模式',
            body: '独占模式暂不可用（可能输出设备被占用），已自动回退共享模式。',
            confirmText: '知道了',
            cancelText: '关闭',
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
          <div class="np-queue-title">${App.utils.esc(track.title || '未知曲目')}</div>
          <div class="np-queue-artist">${App.utils.esc(track.artist || '未知艺术家')}</div>
        </div>
        <div class="np-queue-duration">${App.utils.formatDuration(track.duration_ms)}</div>
        <button class="icon-btn np-queue-remove" title="从队列移除" data-index="${i}">
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
    // 退出全窗口视图时同步退出影院模式
    if (!enteringFullscreen && pane.classList.contains('theater')) {
      _exitTheater();
    }
    pane.classList.toggle('fullscreen', enteringFullscreen);

    // 全屏时左侧始终保留音乐信息，右侧展示歌词或待播列表。
    if (enteringFullscreen) {
      const activeTab = document.querySelector('.np-pivot-tab.active');
      const activeTabName = activeTab ? activeTab.getAttribute('data-tab') : 'lyrics';
      switchTab(activeTabName === 'info' ? 'lyrics' : activeTabName);
    } else {
      const activeTab = document.querySelector('.np-pivot-tab.active');
      switchTab(activeTab ? activeTab.getAttribute('data-tab') : 'info');
    }
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
        var activeTab = document.querySelector('.np-pivot-tab.active');
        var activeTabName = activeTab ? activeTab.getAttribute('data-tab') : 'lyrics';
        switchTab(activeTabName === 'info' ? 'lyrics' : activeTabName);
      }
      pane.classList.add('theater');
      _startTheaterIdleTimer();
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
    // 全屏表示中なら先に全屏を解除する
    if (pane.classList.contains('fullscreen')) {
      pane.classList.remove('fullscreen');
      const activeTab = document.querySelector('.np-pivot-tab.active');
      switchTab(activeTab ? activeTab.getAttribute('data-tab') : 'info');
    }

    var isCollapsed = pane.classList.contains('collapsed');

    if (isCollapsed) {
      // ── 展开动画 ──
      _clearExpandTimers();
      document.body.classList.add('player-expanding');
      pane.classList.add('expanding');

      // Phase 2 (150ms后): 触发 grid 列宽过渡 = 右侧背景探出
      _expandTimers.push(setTimeout(function () {
        pane.classList.remove('collapsed');
        document.body.classList.remove('player-collapsed');
      }, 150));

      // Phase 3 (600ms后): 清理动画类
      _expandTimers.push(setTimeout(function () {
        document.body.classList.remove('player-expanding');
        pane.classList.remove('expanding');
      }, 600));
    } else {
      // ── 收折动画 ──
      _clearExpandTimers();
      document.body.classList.add('player-collapsing');
      pane.classList.add('collapsing');

      // Phase 2 (180ms后): 触发 grid 列宽过渡 = 背景收起
      _expandTimers.push(setTimeout(function () {
        pane.classList.add('collapsed');
        document.body.classList.add('player-collapsed');
      }, 180));

      // Phase 3 (500ms后): 清理动画类
      _expandTimers.push(setTimeout(function () {
        document.body.classList.remove('player-collapsing');
        pane.classList.remove('collapsing');
      }, 500));
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
  // forceHide=true 时强制隐藏（用于歌词解析为空等占位场景）
  function _updateLyricsSourceBadge(forceHide) {
    if (!els.lyricsSource) return;
    var labels = {
      'embedded': 'EMBEDDED',
      'ncm': 'NETEASE CLOUD MUSIC',
      'subsonic': 'EMBEDDED(SUBSONIC)',
    };
    if (!forceHide && lyricsSource && labels[lyricsSource]) {
      els.lyricsSource.style.display = '';
      if (els.lyricsSourceLabel) {
        els.lyricsSourceLabel.textContent = labels[lyricsSource];
      }
    } else {
      els.lyricsSource.style.display = 'none';
    }
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
    _showSearchStatus('loading', '搜索中…');
    App.utils.call('search_netease_lyrics', query).then(function (res) {
      if (gen !== lyricsSearchGen) return; // 已过期
      try {
        var data = JSON.parse(res);
      } catch (e) {
        _showSearchStatus('error', '解析响应失败');
        return;
      }
      if (data.error) {
        _showSearchStatus('error', '搜索失败：' + data.error);
        return;
      }
      if (!data.songs || data.songs.length === 0) {
        _showSearchStatus('empty', '未找到匹配歌曲');
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
      _showSearchStatus('error', '没有正在播放的曲目');
      return;
    }
    _showSearchStatus('loading', '获取歌词中…');
    App.utils.call('fetch_netease_lyrics', songId).then(function (res) {
      try {
        var data = JSON.parse(res);
      } catch (e) {
        _showSearchStatus('error', '解析响应失败');
        return;
      }
      if (data.error) {
        _showSearchStatus('error', '获取失败：' + data.error);
        return;
      }
      if (!data.lyrics) {
        _showSearchStatus('empty', '该歌曲暂无歌词');
        return;
      }
      // 用户手动选择 → 持久化到数据库（后端会保存并发送 track_changed 事件）
      _pendingLyricsSource = 'ncm';
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
          App.utils.call('apply_lyrics_temporary', track.id, data.lyrics).then(function () {
            if (gen !== _autoSearchGen || !_isStillCurrentTrack(track)) return;
            track.lyrics = data.lyrics;
            if (App.state.currentTrack && App.state.currentTrack.id === track.id) {
              App.state.currentTrack.lyrics = data.lyrics;
            }
            lyricsSource = 'subsonic';
            _renderLyrics(track);
          });
          return;
        }
        // Subsonic 无歌词：回退网易云搜索
        _searchNeteaseLyrics(track, gen, query);
      });
      return;
    }

    _searchNeteaseLyrics(track, gen, query);
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

  // 网易云歌词搜索 + 临时应用
  function _searchNeteaseLyrics(track, gen, query) {
    App.utils.call('search_netease_lyrics', query).then(function (res) {
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
      App.utils.call('fetch_netease_lyrics', songId).then(function (lrcRes) {
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
        App.utils.call('apply_lyrics_temporary', track.id, lrcData.lyrics).then(function () {
          if (gen !== _autoSearchGen || !_isStillCurrentTrack(track)) return;

          // 更新前端状态并重新渲染
          track.lyrics = lrcData.lyrics;
          if (App.state.currentTrack && App.state.currentTrack.id === track.id) {
            App.state.currentTrack.lyrics = lrcData.lyrics;
          }
          lyricsSource = 'ncm';
          _renderLyrics(track);
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
        '<p>暂无歌词</p>' +
        '<p class="np-lyrics-placeholder-hint">点击右下角搜索按钮手动查找</p>' +
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

})();
