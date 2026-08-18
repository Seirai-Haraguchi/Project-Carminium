/**
 * Carminium — Floating Player Window
 * サイドバーの正在播放と完全一致の動作
 */
(function () {
  'use strict';

  var backend = null;
  var currentTrack = null;
  var currentState = 'stopped';
  var currentVolume = 80;
  var currentShuffle = false;
  var currentRepeat = 'off';
  var currentLiked = false;
  var duration = 0;
  var isSeeking = false;
  var currentDominantRgb = null;
  var lyricsData = [];
  var lastLyricsIdx = -1;
  var lyricFontSettings = {
    lyrics_font: "",
    lyrics_jp_font: "",
    lyrics_jp_use_distinct: true,
  };
  var progressiveBlurEnabled = false;
  var lyricsCentered = false;
  var lyricsFontSize = 16;
  var circularCover = false;
  var waveProgress = true;
  var lyricsCreditFilters = '';

  // ── DOM elements (サイドバーと同一 ID) ────────────────────────────────────
  var els = {
    cover: document.getElementById('np-cover'),
    coverImg: document.getElementById('np-cover-img'),
    coverIcon: document.getElementById('np-cover-icon'),
    title: document.getElementById('np-title'),
    artist: document.getElementById('np-artist'),
    album: document.getElementById('np-album'),
    timeCur: document.getElementById('np-time-cur'),
    timeDur: document.getElementById('np-time-dur'),
    barFill: document.getElementById('np-progress-fill'),
    barThumb: document.getElementById('np-progress-thumb'),
    barWrap: document.getElementById('np-progress-bar'),
    btnPlay: document.getElementById('btn-play-pause'),
    iconPlay: document.getElementById('play-icon'),
    btnPrev: document.getElementById('btn-prev'),
    btnNext: document.getElementById('btn-next'),
    btnShuffle: document.getElementById('btn-shuffle'),
    btnRepeat: document.getElementById('btn-repeat'),
    btnLike: document.getElementById('btn-like'),
    btnAudioMode: document.getElementById('btn-audio-mode'),
    audioModeLabel: document.getElementById('audio-mode-label'),
    btnDock: document.getElementById('btn-dock'),
    btnMinimize: document.getElementById('btn-minimize'),
    btnClose: document.getElementById('btn-close'),
    titlebar: document.getElementById('floating-titlebar'),
    btnMute: document.getElementById('btn-mute'),
    iconVol: document.getElementById('vol-icon'),
    volSlider: document.getElementById('volume-slider'),
    volLabel: document.getElementById('vol-label'),
    queueList: document.getElementById('np-queue-list'),
    pivotTabs: document.querySelectorAll('.np-pivot-tab'),
    pivotIndicator: document.getElementById('np-pivot-indicator'),
    panels: document.querySelectorAll('.np-panel'),
    miniInfo: document.getElementById('np-mini-info'),
    miniCover: document.getElementById('np-mini-cover'),
    miniCoverImg: document.getElementById('np-mini-cover-img'),
    miniCoverIcon: document.getElementById('np-mini-cover-icon'),
    miniTitle: document.getElementById('np-mini-title'),
    miniArtist: document.getElementById('np-mini-artist'),
    lyricsWrap: document.getElementById('np-lyrics-wrap'),
    lyrics: document.getElementById('np-lyrics'),
    currentTab: 'info',
  };

  // ── Helpers ────────────────────────────────────────────────────────────────
  function fmtTime(ms) {
    if (!ms || ms <= 0) return '0:00';
    var totalSec = Math.floor(ms / 1000);
    var m = Math.floor(totalSec / 60);
    var s = totalSec % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  function getRepeatIcon(mode) {
    switch (mode) {
      case 'one': return 'repeat_one';
      case 'all': return 'repeat';
      default: return 'repeat';
    }
  }

  // ── Seek bar ───────────────────────────────────────────────────────────────
  function _updateSeek(e) {
    var rect = els.barWrap.getBoundingClientRect();
    var pct = (e.clientX - rect.left) / rect.width;
    pct = Math.max(0, Math.min(1, pct));
    els.barFill.style.width = (pct * 100) + '%';
    els.barThumb.style.left = (pct * 100) + '%';
    els.timeCur.textContent = fmtTime(pct * duration);
    // 剩余时间显示为负值
    els.timeDur.textContent = '-' + fmtTime(duration - pct * duration);
  }
  function _onSeekMove(e) { _updateSeek(e); }
  function _onSeekUp(e) {
    isSeeking = false;
    document.removeEventListener('mousemove', _onSeekMove);
    document.removeEventListener('mouseup', _onSeekUp);
    if (!duration) return;
    var rect = els.barWrap.getBoundingClientRect();
    var pct = (e.clientX - rect.left) / rect.width;
    pct = Math.max(0, Math.min(1, pct));
    backend.seek(Math.floor(pct * duration));
  }

  // ── Pivot ──────────────────────────────────────────────────────────────────
  function switchTab(tabName) {
    els.currentTab = tabName;
    els.pivotTabs.forEach(function (tab) {
      var isActive = tab.getAttribute('data-tab') === tabName;
      tab.classList.toggle('active', isActive);
      tab.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });
    els.panels.forEach(function (panel) {
      panel.classList.toggle('active', panel.getAttribute('data-panel') === tabName);
    });
    // ミニ情報バーの表示切り替え
    if (els.miniInfo) {
      if (tabName === 'info') {
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

  // ── Queue ──────────────────────────────────────────────────────────────────
  var _draggedQueueItem = null;

  function updateQueue(queue, currentIndex) {
    if (!els.queueList) return;
    els.queueList.innerHTML = '';
    if (!queue || queue.length === 0) return;

    for (var i = 0; i < queue.length; i++) {
      var track = queue[i];
      var li = document.createElement('div');
      li.className = 'np-queue-item' + (i === currentIndex ? ' current' : '');
      li.dataset.index = i;
      li.draggable = true;
      li.innerHTML =
        '<button class="np-queue-drag" aria-label="' + (App.i18n.t('np.dragToReorder') || '') + '">' +
          '<span class="np-queue-drag-icon"></span>' +
        '</button>' +
        '<div class="np-queue-cover-wrap">' +
          '<div class="np-queue-cover">' +
            (track.has_cover
              ? '<img src="' + window.coverUrl(track.id, 128) + '" alt="">'
              : '<span class="material-symbols-rounded">music_note</span>') +
          '</div>' +
        '</div>' +
        '<div class="np-queue-info">' +
          '<div class="np-queue-title">' + (track.title || App.i18n.t('common.unknownTrack')) + '</div>' +
          '<div class="np-queue-artist">' + (track.artist || App.i18n.t('common.unknownArtist')) + '</div>' +
        '</div>' +
        '<div class="np-queue-duration">' + fmtTime(track.duration_ms) + '</div>' +
        '<button class="np-queue-remove" data-index="' + i + '" aria-label="' + App.i18n.t('np.removeFromQueue') + '">' +
          '<span class="material-symbols-rounded">close</span>' +
        '</button>';

      (function (idx) {
        li.addEventListener('click', function (e) {
          if (e.target.closest('.np-queue-remove')) return;
          if (e.target.closest('.np-queue-drag')) return;
          backend.play_queue_at(idx);
        });
        var removeBtn = li.querySelector('.np-queue-remove');
        if (removeBtn) {
          removeBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            backend.remove_from_queue(idx);
          });
          App.utils.setupAvoidance(removeBtn);
        }
      })(i);

      els.queueList.appendChild(li);
    }

    _setupQueueDragAndDrop();
  }

  function _setupQueueDragAndDrop() {
    var items = els.queueList.querySelectorAll('.np-queue-item');
    items.forEach(function (item) {
      item.addEventListener('dragstart', function (e) {
        _draggedQueueItem = item;
        item.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', item.dataset.index);
      });

      item.addEventListener('dragend', function () {
        item.classList.remove('dragging');
        _draggedQueueItem = null;
        var allItems = els.queueList.querySelectorAll('.np-queue-item');
        allItems.forEach(function (it) {
          it.classList.remove('drag-over-top', 'drag-over-bottom');
        });
      });

      item.addEventListener('dragover', function (e) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (_draggedQueueItem === item) return;

        var rect = item.getBoundingClientRect();
        var midpoint = rect.top + rect.height / 2;
        var allItems = els.queueList.querySelectorAll('.np-queue-item');
        allItems.forEach(function (it) {
          it.classList.remove('drag-over-top', 'drag-over-bottom');
        });

        if (e.clientY < midpoint) {
          item.classList.add('drag-over-top');
        } else {
          item.classList.add('drag-over-bottom');
        }
      });

      item.addEventListener('dragleave', function () {
        item.classList.remove('drag-over-top', 'drag-over-bottom');
      });

      item.addEventListener('drop', function (e) {
        e.preventDefault();
        if (!_draggedQueueItem || _draggedQueueItem === item) return;

        var fromIndex = parseInt(_draggedQueueItem.dataset.index, 10);
        var rect = item.getBoundingClientRect();
        var midpoint = rect.top + rect.height / 2;
        var toIndex = parseInt(item.dataset.index, 10);

        if (e.clientY >= midpoint) {
          toIndex = toIndex + 1;
          if (toIndex > els.queueList.children.length - 1) {
            toIndex = els.queueList.children.length - 1;
          }
        }

        if (fromIndex < toIndex) {
          toIndex = toIndex - 1;
        }

        if (fromIndex !== toIndex) {
          backend.reorder_queue(fromIndex, toIndex);
        }
      });
    });

    els.queueList.addEventListener('dragover', function (e) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    });
    els.queueList.addEventListener('drop', function (e) {
      e.preventDefault();
      if (!_draggedQueueItem) return;
      var targetItem = e.target.closest('.np-queue-item');
      if (targetItem) return;

      var fromIndex = parseInt(_draggedQueueItem.dataset.index, 10);
      var toIndex = els.queueList.children.length - 1;
      if (fromIndex !== toIndex) {
        backend.reorder_queue(fromIndex, toIndex);
      }
    });
  }

  // ── Update functions ───────────────────────────────────────────────────────
  function updateTrack(track) {
    currentTrack = track;
    duration = track ? track.duration_ms : 0;

    if (!track) {
      els.title.textContent = App.i18n.t('common.notPlaying');
      els.artist.textContent = '—';
      els.album.textContent = '';
      els.coverImg.style.display = 'none';
      els.coverIcon.style.display = '';
      els.cover.style.background = 'var(--md-surface-container)';
      els.coverIcon.style.color = 'var(--md-on-surface-variant)';
      els.barFill.style.width = '0%';
      els.barThumb.style.left = '0%';
els.timeCur.textContent = '0:00';
els.timeDur.textContent = '-0:00';
      App.utils.applyDynamicTheme(null);
      currentDominantRgb = null;
      // ミニ情報バーも更新
      if (els.miniInfo) {
        els.miniTitle.textContent = App.i18n.t('common.notPlaying');
        els.miniArtist.textContent = '—';
        els.miniCoverImg.style.display = 'none';
        els.miniCoverIcon.style.display = '';
      }
      return;
    }

    els.title.textContent = track.title || App.i18n.t('common.unknownTrack');
    els.artist.textContent = track.artist || App.i18n.t('common.unknownArtist');
    els.album.textContent = track.album || '';

    if (track.has_cover) {
      App.utils.loadCover(els.coverImg, track.id, 512);
      els.coverImg.onload = function () {
        var rgb = App.utils.extractDominantColor(els.coverImg);
        App.utils.applyDynamicTheme(rgb);
        currentDominantRgb = rgb;
      };
      els.coverImg.style.display = '';
      els.coverIcon.style.display = 'none';
      els.cover.style.background = '';
      // ミニ情報バーのカバーも更新
      if (els.miniCoverImg) {
        App.utils.loadCover(els.miniCoverImg, track.id, 128);
        els.miniCoverImg.style.display = '';
        els.miniCoverIcon.style.display = 'none';
      }
    } else {
      els.coverImg.style.display = 'none';
      els.coverIcon.style.display = '';
      els.cover.style.background = App.utils.hashColor(track.album || track.title);
      els.coverIcon.style.color = 'rgba(255,255,255,0.9)';
      App.utils.applyDynamicTheme(null);
      currentDominantRgb = null;
      // ミニ情報バーのカバーも更新
      if (els.miniCoverImg) {
        els.miniCoverImg.style.display = 'none';
        els.miniCoverIcon.style.display = '';
      }
    }

    // ミニ情報バーのテキスト更新
    if (els.miniInfo) {
      els.miniTitle.textContent = track.title || App.i18n.t('common.unknownTrack');
      els.miniArtist.textContent = track.artist || App.i18n.t('common.unknownArtist');
    }

    // 歌词
    renderLyrics(track);
  }

  function renderLyrics(track) {
    lyricsData = [];
    lastLyricsIdx = -1;

    if (!els.lyrics) return;
    els.lyrics.innerHTML = '';
    App.utils.cancelLyricsScroll(els.lyricsWrap);
    els.lyricsWrap.scrollTop = 0;

    if (!track || !track.lyrics) {
      els.lyrics.innerHTML =
        '<div class="np-lyrics-placeholder">' +
          '<span class="material-symbols-rounded">lyrics</span>' +
          '<p>' + App.i18n.t('np.noLyrics') + '</p>' +
        '</div>';
      return;
    }

    var hasJapanese = /[\u3040-\u309F\u30A0-\u30FF]/.test(track.lyrics);
    var useJpDistinct = lyricFontSettings.lyrics_jp_use_distinct !== false;
    var jpFont = lyricFontSettings.lyrics_jp_font || "";
    var baseFont = lyricFontSettings.lyrics_font || "";

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
      var staticLines = App.utils.parseStaticLyrics(processedLyrics);
      if (staticLines.length === 0) {
        els.lyrics.innerHTML =
          '<div class="np-lyrics-placeholder">' +
            '<span class="material-symbols-rounded">lyrics</span>' +
            '<p>' + App.i18n.t('np.noLyrics') + '</p>' +
          '</div>';
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

  function updateLyrics(posMs) {
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

      var activeLine = lines[idx];
      if (activeLine) {
        var target = activeLine.offsetTop - els.lyricsWrap.clientHeight * 0.22 + activeLine.clientHeight / 2;
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
        if (posMs >= end) {
          word.classList.add('past');
        } else if (posMs >= start) {
          word.classList.add('active');
        }
      }
    }
  }

  function updateState(state) {
    currentState = state;
    if (state === 'playing') {
      App.utils.squeezeIcon(els.iconPlay, 'pause');
      App.utils.bloomButton(els.btnPlay);
      els.btnPlay.classList.add('playing');
      els.cover.classList.add('playing');
      els.barFill.classList.add('playing');
    } else {
      App.utils.squeezeIcon(els.iconPlay, 'play_arrow');
      App.utils.bloomButton(els.btnPlay);
      els.btnPlay.classList.remove('playing');
      els.cover.classList.remove('playing');
      els.barFill.classList.remove('playing');
    }
  }

function updatePosition(posMs) {
if (isSeeking) return;
els.timeCur.textContent = fmtTime(posMs);
if (duration) {
var pct = (posMs / duration) * 100;
els.barFill.style.width = Math.min(pct, 100) + '%';
els.barThumb.style.left = Math.min(pct, 100) + '%';
// 剩余时间显示为负值
els.timeDur.textContent = '-' + fmtTime(duration - posMs);
}
updateLyrics(posMs);
}

function updateDuration(durMs) {
duration = durMs;
// 显示剩余时间为负值（新曲位置为 0，剩余 = 总时长）
els.timeDur.textContent = '-' + fmtTime(durMs);
if (currentTrack) currentTrack.duration = durMs;
}

  function updateVolume(vol) {
    currentVolume = vol;
    els.volSlider.value = vol;
    els.volLabel.textContent = vol;
    var pct = vol;
    els.volSlider.style.setProperty('--volume-val', pct + '%');
    _updateVolIcon(vol);
  }

  function updateShuffle(enabled) {
    currentShuffle = enabled;
    if (enabled) {
      els.btnShuffle.classList.add('active');
    } else {
      els.btnShuffle.classList.remove('active');
    }
  }

  function updateRepeat(mode) {
    currentRepeat = mode;
    var icon = els.btnRepeat.querySelector('.material-symbols-rounded');
    if (icon) icon.textContent = getRepeatIcon(mode);
    if (mode !== 'off') {
      els.btnRepeat.classList.add('active');
    } else {
      els.btnRepeat.classList.remove('active');
    }
  }

  function updateLiked(liked) {
    currentLiked = liked;
    if (liked) {
      els.btnLike.classList.add('liked');
      var icon = els.btnLike.querySelector('.material-symbols-rounded');
      if (icon) icon.classList.add('icon-filled');
    } else {
      els.btnLike.classList.remove('liked');
      var icon2 = els.btnLike.querySelector('.material-symbols-rounded');
      if (icon2) icon2.classList.remove('icon-filled');
    }
  }

  function _updateVolIcon(vol) {
    if (vol === 0) {
      els.iconVol.textContent = 'volume_off';
    } else if (vol < 33) {
      els.iconVol.textContent = 'volume_mute';
    } else if (vol < 66) {
      els.iconVol.textContent = 'volume_down';
    } else {
      els.iconVol.textContent = 'volume_up';
    }
  }

  // ── Theme sync ────────────────────────────────────────────────────────────
  function applyTheme(val) {
    if (val === 'system') {
      var isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
    } else {
      document.documentElement.setAttribute('data-theme', val);
    }
  }

  // 应用界面字体：非空时覆盖 --ui-font，为空时回退 CSS 默认
  function applyUiFont(val) {
    var root = document.documentElement;
    if (val && val.trim()) {
      root.style.setProperty('--ui-font', val.trim());
    } else {
      root.style.removeProperty('--ui-font');
    }
  }

  function applyLyricFontSettings(settings) {
    lyricFontSettings = {
      lyrics_font: settings.lyrics_font || "",
      lyrics_jp_font: settings.lyrics_jp_font || "",
      lyrics_jp_use_distinct: settings.lyrics_jp_use_distinct !== false,
    };
    progressiveBlurEnabled = !!settings.lyrics_progressive_blur;
    var wrap = document.getElementById('np-lyrics-wrap');
    if (wrap) wrap.classList.toggle('progressive-blur', progressiveBlurEnabled);
    lyricsCentered = !!settings.lyrics_center;
    lyricsFontSize = parseInt(settings.lyrics_font_size, 10) || 16;
    circularCover = !!settings.circular_cover;
    waveProgress = settings.wave_progress !== false;
    lyricsCreditFilters = settings.lyrics_credit_filters || '';
    _applyLyricsLayout();
    _applyCircularCoverClass();
    _applyWaveProgressClass();
    if (currentTrack) {
      renderLyrics(currentTrack);
    }
  }

  // 歌词渐进模糊：根据距离当前行的距离计算模糊量
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

  // 应用居中排版和字体大小到歌词容器
  function _applyLyricsLayout() {
    if (!els.lyrics) return;
    els.lyrics.classList.toggle('lyrics-centered', lyricsCentered);
    els.lyrics.style.setProperty('--lyrics-font-size', lyricsFontSize + 'px');
  }

  // 应用圆形专辑图 class
  function _applyCircularCoverClass() {
    if (els.cover) {
      els.cover.classList.toggle('circular', circularCover);
    }
  }

  // 应用波浪进度条 class
  function _applyWaveProgressClass() {
    if (els.barFill) {
      els.barFill.classList.toggle('flat', !waveProgress);
    }
  }

  function initThemeAndFonts() {
    backend.get_settings(function (json) {
      var settings = JSON.parse(json);
      var val = settings.theme || 'system';
      applyTheme(val);
      applyLyricFontSettings(settings);
      applyUiFont(settings.ui_font || '');
      _updateAudioMode(!!settings.wasapi_exclusive);
      // Initialize i18n
      if (App.i18n) {
        App.i18n.init(settings.language || 'zh-CN');
      }
      if (val === 'system') {
        window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function (e) {
          applyTheme('system');
          if (currentDominantRgb) {
            App.utils.applyDynamicTheme(currentDominantRgb);
          }
        });
      }
    });
  }

  // ── Init ───────────────────────────────────────────────────────────────────
  function init() {
    // テーマと字体設定の同期
    initThemeAndFonts();
    // Play / Pause
    els.btnPlay.addEventListener('click', function () {
      if (currentState === 'playing') {
        backend.pause();
      } else {
        backend.play();
      }
    });

    els.btnPrev.addEventListener('click', function () { backend.prev_track(); });
    els.btnNext.addEventListener('click', function () { backend.next_track(); });

    // Shuffle
    els.btnShuffle.addEventListener('click', function () {
      backend.set_shuffle(!currentShuffle);
    });

    // Repeat
    els.btnRepeat.addEventListener('click', function () {
      var modes = ['off', 'all', 'one'];
      var idx = modes.indexOf(currentRepeat);
      var next = modes[(idx + 1) % modes.length];
      backend.set_repeat(next);
    });

    // Like
    els.btnLike.addEventListener('click', function () {
      backend.toggle_liked();
    });

    // 音频模式切换（excl/shrd 文字状态）
    if (els.btnAudioMode) {
      els.btnAudioMode.addEventListener('click', function () {
        var currentOn = els.btnAudioMode.classList.contains('active');
        var targetOn = !currentOn;
        App.utils.confirmExclusiveSwitch(targetOn).then(function (ok) {
          if (!ok) return;
          App.utils.call('set_wasapi_exclusive', targetOn).then(function (actual) {
            _updateAudioMode(actual === 'wasapi_exclusive');
          });
        });
      });
    }

    // Dock back
    els.btnDock.addEventListener('click', function () {
      backend.close_floating_window();
    });

    // Minimize
    els.btnMinimize.addEventListener('click', function () {
      if (window.pywebview && window.pywebview.api) window.pywebview.api.minimize_window();
    });

    // Close
    els.btnClose.addEventListener('click', function () {
      if (window.pywebview && window.pywebview.api) window.pywebview.api.close_window();
    });

    // Volume
    els.volSlider.addEventListener('input', function (e) {
      var val = parseInt(e.target.value, 10);
      backend.set_volume(val);
    });
    els.btnMute.addEventListener('click', function () {
      if (currentVolume === 0) {
        backend.set_volume(80);
      } else {
        backend.set_volume(0);
      }
    });

    // Progress bar — ドラッグ対応
    els.barWrap.addEventListener('mousedown', function (e) {
      if (!duration) return;
      isSeeking = true;
      _updateSeek(e);
      document.addEventListener('mousemove', _onSeekMove);
      document.addEventListener('mouseup', _onSeekUp);
    });

    // Pivot
    els.pivotTabs.forEach(function (tab) {
      tab.addEventListener('click', function () {
        var target = tab.getAttribute('data-tab');
        switchTab(target);
      });
    });
    requestAnimationFrame(function () {
      updatePivotIndicator();
    });

    // ── Window drag ──
    // 由 .pywebview-drag-region CSS 类标记可拖拽区域
    // （floating.html 的 titlebar label），无需 JS 介入。
    window.addEventListener('resize', updatePivotIndicator);

    // Get initial state
    backend.get_player_state(function (json) {
      var state = JSON.parse(json);
      if (state.current_track) {
        updateTrack(state.current_track);
        updateDuration(state.duration);
        updatePosition(state.position);
      }
      updateState(state.state || 'stopped');
      updateVolume(state.volume);
      updateShuffle(state.shuffle);
      updateRepeat(state.repeat);

      backend.is_current_liked(function (liked) {
        updateLiked(liked);
      });

      backend.get_queue(function (qjson) {
        var qstate = JSON.parse(qjson);
        updateQueue(qstate.queue, qstate.current_index);
      });
    });
  }

  // ── Bridge 接続 ──────────────────────────────────────────────────────────
  // bridge.js 已先于 floating.js 加载，定义了 App.backend Proxy 与
  // window.__bridge 事件分发器。此处等待后端 API 就绪后初始化 cover
  // base URL，注册信号回调并调用 init()。
  function onBridgeReady() {
    backend = App.backend;

    backend.track_changed.connect(function (json) {
      updateTrack(JSON.parse(json));
    });
    backend.playback_state_changed.connect(function (state) {
      updateState(state);
    });
    backend.position_changed.connect(function (pos) {
      updatePosition(pos);
    });
    backend.duration_changed.connect(function (dur) {
      updateDuration(dur);
    });
    backend.volume_changed.connect(function (vol) {
      updateVolume(vol);
    });
    backend.shuffle_changed.connect(function (enabled) {
      updateShuffle(enabled);
    });
    backend.repeat_changed.connect(function (mode) {
      updateRepeat(mode);
    });
    backend.liked_changed.connect(function (liked) {
      updateLiked(liked);
    });
    // 歌词变更（手动指定 / 自动搜索 / 外部更新）
    backend.lyrics_changed.connect(function (json) {
      var data;
      try { data = JSON.parse(json); } catch (e) { return; }
      if (!data || !data.trackId) return;
      if (currentTrack && currentTrack.id === data.trackId) {
        currentTrack.lyrics = data.lyrics;
        renderLyrics(currentTrack);
      }
    });
    backend.queue_changed.connect(function (qjson) {
      var qstate = JSON.parse(qjson);
      updateQueue(qstate.queue, qstate.current_index);
    });
    backend.settings_changed.connect(function (sjson) {
      var settings = JSON.parse(sjson);
      applyLyricFontSettings(settings);
      applyTheme(settings.theme || 'system');
      applyUiFont(settings.ui_font || '');
      _updateAudioMode(!!settings.wasapi_exclusive);
      // Update language on settings change (only if actually changed)
      if (App.i18n && settings.language && App.i18n.getLang() !== settings.language) {
        App.i18n.init(settings.language);
      }
    });

    init();
  }

  function _updateAudioMode(exclusive) {
    if (!els.btnAudioMode || !els.audioModeLabel) return;
    var _t = App.i18n ? App.i18n.t : function(k) { return k; };
    if (exclusive) {
      els.btnAudioMode.classList.add('active');
      els.audioModeLabel.textContent = 'excl';
      els.btnAudioMode.setAttribute('title', _t('np.exclusiveMode'));
    } else {
      els.btnAudioMode.classList.remove('active');
      els.audioModeLabel.textContent = 'shrd';
      els.btnAudioMode.setAttribute('title', _t('np.sharedMode'));
    }
  }

  // ── Language change handler ────────────────────────────────────────────
  function onLanguageChanged() {
    // Update dynamic text elements
    if (!currentTrack) {
      els.title.textContent = App.i18n.t('common.notPlaying');
      if (els.miniInfo) {
        els.miniTitle.textContent = App.i18n.t('common.notPlaying');
      }
    } else {
      els.title.textContent = currentTrack.title || App.i18n.t('common.unknownTrack');
      els.artist.textContent = currentTrack.artist || App.i18n.t('common.unknownArtist');
      if (els.miniInfo) {
        els.miniTitle.textContent = currentTrack.title || App.i18n.t('common.unknownTrack');
        els.miniArtist.textContent = currentTrack.artist || App.i18n.t('common.unknownArtist');
      }
    }
    // Re-render lyrics placeholder if no lyrics
    if (els.lyrics && (!currentTrack || !currentTrack.lyrics)) {
      var placeholder = els.lyrics.querySelector('.np-lyrics-placeholder p');
      if (placeholder) placeholder.textContent = App.i18n.t('np.noLyrics');
    }
    // Update audio mode title
    _updateAudioMode(els.btnAudioMode && els.btnAudioMode.classList.contains('active'));
    // Update queue remove button aria-labels
    if (els.queueList) {
      var removeBtns = els.queueList.querySelectorAll('.np-queue-remove');
      removeBtns.forEach(function (btn) {
        btn.setAttribute('aria-label', App.i18n.t('np.removeFromQueue'));
      });
    }
  }

  if (window.__waitForPywebview) {
    window.__waitForPywebview(function () {
      window.pywebview.api.get_cover_base_url().then(function (url) {
        window.__coverBase = url || '';
        onBridgeReady();
      });
    });
  }

  // Register i18n language change listener
  if (window.App && App.i18n && App.i18n.onChange) {
    App.i18n.onChange(function () {
      onLanguageChanged();
    });
  }
})();