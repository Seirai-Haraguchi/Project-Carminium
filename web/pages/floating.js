/**
 * Carminium — 浮动窗口（正在播放小窗）
 *
 * 设计目标
 *  1) 设计语言与主窗口「正在播放」面板一致：同一套 .np-* 结构 + M3 令牌，
 *     样式在 web/floating.css，与 index.html 的 .now-playing-pane 同源。
 *  2) 内存占用压到极低。三条主线：
 *     · 不加载 style.css / i18n.js / pages/utils.js / bridge.js（≈600KB 源码），
 *       改为 floating.css + floating_i18n.js + 本文件。
 *     · 不建 SMTC 静音心跳、不接音频链路（浮动窗不合成音频，不参与 AudioContext 重建）。
 *     · 懒渲染 + 限量：队列与歌词只在对应标签页激活后才建 DOM；队列超过
 *       300 条只渲染当前曲目附近的窗口，避免几千条 DOM 节点常驻。
 *
 * 本文件不依赖 window.App.utils（那会牵进整份页面工具集），所需能力就地实现。
 */
(function () {
  'use strict';

  // ==========================================================================
  // 内联后端桥（替代 web/bridge.js 的浮动窗所需子集）
  // ==========================================================================
  var api = window.__electronAPI;

  var _handlers = {};
  function on(ev, cb) {
    (Object.prototype.hasOwnProperty.call(_handlers, ev) ? _handlers[ev] : (_handlers[ev] = [])).push(cb);
  }
  function dispatch(ev, payload) {
    var list = _handlers[ev];
    if (!list) return;
    for (var i = 0; i < list.length; i++) {
      try { list[i](payload); } catch (e) { console.error('[floating] handler error', ev, e); }
    }
  }
  function invoke(method) {
    if (!api || typeof api.invoke !== 'function') return Promise.resolve(undefined);
    return api.invoke.apply(api, arguments);
  }

  var _coverBase = '';
  function coverUrl(trackId, size) {
    var url = _coverBase + '/cover/' + trackId;
    if (size) url += '?size=' + encodeURIComponent(String(size));
    return url;
  }

  // ==========================================================================
  // 状态
  // ==========================================================================
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
  var lyricLines = null;      // 复用：避免每帧 querySelectorAll
  var activeWords = null;     // 当前行的逐字节点（复用）
  var lastLyricsIdx = -1;

  var lyricFontSettings = { lyrics_font: '', lyrics_jp_font: '', lyrics_jp_use_distinct: false };
  var progressiveBlurEnabled = false;
  var lyricsCentered = false;
  var lyricsFontSize = 16;
  var circularCover = false;
  var waveProgress = true;
  var lyricsCreditFilters = '';
  var colorScheme = 'tonal_spot';

  // 懒渲染标记
  var lyricsRendered = false;
  var queueRendered = false;
  var queueData = null;
  var queueIndex = 0;

  /** 队列最多渲染的条目数（长队列下避免几万 DOM 节点） */
  var QUEUE_RENDER_LIMIT = 300;
  /** 渲染窗口从当前曲目前多少条开始 */
  var QUEUE_LEAD = 20;

  // ==========================================================================
  // DOM
  // ==========================================================================
  var $ = function (id) { return document.getElementById(id); };
  var els = {
    titlebar: document.querySelector('.floating-titlebar'),
    cover: $('np-cover'),
    coverImg: $('np-cover-img'),
    coverIcon: $('np-cover-icon'),
    title: $('np-title'),
    artist: $('np-artist'),
    album: $('np-album'),
    timeCur: $('np-time-cur'),
    timeDur: $('np-time-dur'),
    barWrap: $('np-progress-bar'),
    barFill: $('np-progress-fill'),
    barThumb: $('np-progress-thumb'),
    btnPlay: $('btn-play-pause'),
    iconPlay: $('play-icon'),
    btnPrev: $('btn-prev'),
    btnNext: $('btn-next'),
    btnShuffle: $('btn-shuffle'),
    btnRepeat: $('btn-repeat'),
    btnLike: $('btn-like'),
    btnAudioMode: $('btn-audio-mode'),
    audioModeLabel: $('audio-mode-label'),
    btnDock: $('btn-dock'),
    btnMinimize: $('btn-minimize'),
    btnClose: $('btn-close'),
    btnMute: $('btn-mute'),
    iconVol: $('vol-icon'),
    volSlider: $('volume-slider'),
    volLabel: $('vol-label'),
    queueList: $('np-queue-list'),
    pivotTabs: document.querySelectorAll('.np-pivot-tab'),
    panels: document.querySelectorAll('.np-panel'),
    miniInfo: $('np-mini-info'),
    miniCoverImg: $('np-mini-cover-img'),
    miniCoverIcon: $('np-mini-cover-icon'),
    miniTitle: $('np-mini-title'),
    miniArtist: $('np-mini-artist'),
    lyricsWrap: $('np-lyrics-wrap'),
    lyrics: $('np-lyrics'),
  };

  var currentTab = 'info';

  // ==========================================================================
  // 基础工具
  // ==========================================================================
  function fmtTime(ms) {
    if (!ms || ms <= 0) return '0:00';
    var totalSec = Math.floor(ms / 1000);
    return Math.floor(totalSec / 60) + ':' + ('0' + (totalSec % 60)).slice(-2);
  }

  function escapeHtml(s) {
    return String(s === undefined || s === null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function hashColor(str) {
    if (!str) return 'hsl(240, 40%, 60%)';
    var hash = 0;
    for (var i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
    var hue = ((hash % 360) + 360) % 360;
    var dark = document.documentElement.getAttribute('data-theme') === 'dark';
    return dark ? 'hsl(' + hue + ', 45%, 35%)' : 'hsl(' + hue + ', 55%, 60%)';
  }

  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    var max = Math.max(r, g, b), min = Math.min(r, g, b);
    var h, s, l = (max + min) / 2;
    if (max === min) { h = s = 0; }
    else {
      var d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h /= 6;
    }
    return [h * 360, s * 100, l * 100];
  }

  // ==========================================================================
  // Material You 取色（applyDynamicTheme 的精简版）
  //   与 pages/utils.js 保持一致，但去掉视频背景用的 -vd 变体（浮动窗没有视频背景），
  //   并在取色时复用同一张 canvas（原来每首歌都新建一张 64×64 canvas）。
  // ==========================================================================
  var COLOR_SCHEMES = {
    tonal_spot: { h1: 0,   h2: 25,  h3: -30, chroma: 'moderate', sScale: 0.65, tScale: 0.72, sMin: 22, tMin: 25, bgSat: { d: 12, l: 14 } },
    fidelity:   { h1: 0,   h2: 20,  h3: -25, chroma: 'faithful', sScale: 0.80, tScale: 0.88, sMin: 25, tMin: 28, bgSat: { d: 14, l: 16 } },
    monochrome: { h1: 0,   h2: 0,   h3: 0,   chroma: 'mono',     sScale: 0,    tScale: 0,    sMin: 0,  tMin: 0,  bgSat: { d: 0,  l: 0 } },
    neutral:    { h1: 0,   h2: 0,   h3: 0,   chroma: 'low',      sScale: 0.60, tScale: 0.60, sMin: 3,  tMin: 3,  bgSat: { d: 4,  l: 5 } },
    vibrant:    { h1: 0,   h2: 25,  h3: -30, chroma: 'high',     sScale: 0.80, tScale: 0.88, sMin: 40, tMin: 35, bgSat: { d: 16, l: 18 } },
    expressive: { h1: 15,  h2: 50,  h3: -55, chroma: 'high',     sScale: 0.80, tScale: 0.85, sMin: 38, tMin: 35, bgSat: { d: 14, l: 16 } },
    content:    { h1: 0,   h2: 25,  h3: -30, chroma: 'exact',    sScale: 0.70, tScale: 0.78, sMin: 20, tMin: 20, bgSat: { d: 12, l: 14 } },
    rainbow:    { h1: 0,   h2: 120, h3: 240, chroma: 'moderate', sScale: 0.80, tScale: 0.80, sMin: 25, tMin: 25, bgSat: { d: 12, l: 14 } },
    fruit_salad:{ h1: -10, h2: 40,  h3: 80,  chroma: 'high',     sScale: 0.82, tScale: 0.70, sMin: 38, tMin: 32, bgSat: { d: 14, l: 16 } },
  };

  function _chroma(strategy, s) {
    switch (strategy) {
      case 'moderate': return Math.max(35, Math.min(s, 82));
      case 'faithful': return Math.max(28, Math.min(s + 5, 88));
      case 'mono':     return 0;
      case 'low':      return Math.max(4, Math.min(Math.round(s * 0.12), 8));
      case 'high':     return Math.max(60, Math.min(s + 18, 100));
      case 'exact':    return Math.max(20, Math.min(s, 100));
      default:         return Math.max(35, Math.min(s, 82));
    }
  }

  var _THEME_PROPS = [
    '--md-primary', '--md-on-primary', '--md-primary-container', '--md-on-primary-container',
    '--md-secondary', '--md-on-secondary', '--md-secondary-container', '--md-on-secondary-container',
    '--md-background', '--md-surface', '--md-surface-container-lowest',
    '--md-surface-container-low', '--md-surface-container',
    '--md-surface-container-high', '--md-surface-container-highest', '--md-outline-variant',
  ];

  function applyDynamicTheme(rgb, scheme) {
    var root = document.documentElement;
    if (!rgb) {
      for (var pi = 0; pi < _THEME_PROPS.length; pi++) root.style.removeProperty(_THEME_PROPS[pi]);
      return;
    }
    var sc = COLOR_SCHEMES[scheme || colorScheme] || COLOR_SCHEMES.tonal_spot;
    var isDark = root.getAttribute('data-theme') === 'dark';
    var hsl = rgbToHsl(rgb[0], rgb[1], rgb[2]);
    var h = hsl[0], s = hsl[1];

    var h1 = (h + sc.h1 + 360) % 360;
    var h2 = (h + sc.h2 + 360) % 360;
    var sat = _chroma(sc.chroma, s);
    var sat2 = Math.max(sc.sMin, Math.round(sat * sc.sScale));

    root.style.setProperty('--md-primary', 'hsl(' + h1 + ', ' + sat + '%, ' + (isDark ? 80 : 40) + '%)');
    root.style.setProperty('--md-on-primary', 'hsl(' + h1 + ', ' + sat + '%, ' + (isDark ? 20 : 100) + '%)');
    root.style.setProperty('--md-primary-container', 'hsl(' + h1 + ', ' + sat + '%, ' + (isDark ? 20 : 92) + '%)');
    root.style.setProperty('--md-on-primary-container', 'hsl(' + h1 + ', ' + sat + '%, ' + (isDark ? 92 : 10) + '%)');

    root.style.setProperty('--md-secondary', 'hsl(' + h2 + ', ' + sat2 + '%, ' + (isDark ? 75 : 37) + '%)');
    root.style.setProperty('--md-on-secondary', 'hsl(' + h2 + ', ' + sat2 + '%, ' + (isDark ? 18 : 100) + '%)');
    root.style.setProperty('--md-secondary-container', 'hsl(' + h2 + ', ' + sat2 + '%, ' + (isDark ? 22 : 90) + '%)');
    root.style.setProperty('--md-on-secondary-container', 'hsl(' + h2 + ', ' + sat2 + '%, ' + (isDark ? 90 : 12) + '%)');

    var bgSat = isDark ? sc.bgSat.d : sc.bgSat.l;
    root.style.setProperty('--md-background', 'hsl(' + h1 + ', ' + bgSat + '%, ' + (isDark ? 6 : 98) + '%)');
    root.style.setProperty('--md-surface', 'hsl(' + h1 + ', ' + bgSat + '%, ' + (isDark ? 6 : 98) + '%)');
    root.style.setProperty('--md-surface-container-lowest', 'hsl(' + h1 + ', ' + Math.max(0, bgSat - 4) + '%, ' + (isDark ? 4 : 100) + '%)');
    root.style.setProperty('--md-surface-container-low', 'hsl(' + h1 + ', ' + Math.max(0, bgSat - 2) + '%, ' + (isDark ? 10 : 96) + '%)');
    root.style.setProperty('--md-surface-container', 'hsl(' + h1 + ', ' + bgSat + '%, ' + (isDark ? 12 : 93) + '%)');
    root.style.setProperty('--md-surface-container-high', 'hsl(' + h1 + ', ' + (bgSat + 2) + '%, ' + (isDark ? 17 : 90) + '%)');
    root.style.setProperty('--md-surface-container-highest', 'hsl(' + h1 + ', ' + (bgSat + 4) + '%, ' + (isDark ? 22 : 88) + '%)');
    root.style.setProperty('--md-outline-variant', 'hsl(' + h1 + ', ' + Math.max(0, bgSat - 2) + '%, ' + (isDark ? 22 : 88) + '%)');
  }

  var _palCanvas = null;
  var _palCtx = null;
  function extractDominantColor(imgEl) {
    if (!_palCanvas) {
      _palCanvas = document.createElement('canvas');
      _palCanvas.width = 64;
      _palCanvas.height = 64;
      _palCtx = _palCanvas.getContext('2d', { willReadFrequently: true });
    }
    if (!_palCtx) return null;
    _palCtx.clearRect(0, 0, 64, 64);
    _palCtx.drawImage(imgEl, 0, 0, 64, 64);
    try {
      var data = _palCtx.getImageData(0, 0, 64, 64).data;
      var maxScore = -1;
      var best = [128, 128, 128];
      for (var i = 0; i < data.length; i += 4) {
        if (data[i + 3] < 128) continue;
        var hsl = rgbToHsl(data[i], data[i + 1], data[i + 2]);
        if (hsl[2] < 10 || hsl[2] > 90) continue;
        var score = hsl[1] - Math.abs(hsl[2] - 50) * 0.5;
        if (score > maxScore) { maxScore = score; best = [data[i], data[i + 1], data[i + 2]]; }
      }
      return best;
    } catch (e) {
      return null;   // CORS 污染等
    }
  }

  function applyCoverTheme(imgEl) {
    if (!imgEl || !imgEl.naturalWidth) return;
    var rgb = extractDominantColor(imgEl);
    currentDominantRgb = rgb;
    applyDynamicTheme(rgb);
  }

  // ==========================================================================
  // 歌词解析（与 pages/utils.js 同算法，去掉页面无关部分）
  // ==========================================================================
  function isLRC(text) {
    return /\[\d{2}:\d{2}(?:[\.:]\d{2,3})?\]/.test(text);
  }

  function parseStaticLyrics(text) {
    if (!text) return [];
    var parts = text.split('\n');
    var out = [];
    for (var i = 0; i < parts.length; i++) {
      var t = parts[i].trim();
      if (t) out.push(t);
    }
    return out;
  }

  function _parseLRCWords(text) {
    var re = /<(\d{2}):(\d{2})[\.:](\d{2,3})>([^<]*)/g;
    var segs = [];
    var m;
    while ((m = re.exec(text)) !== null) {
      var cs = parseInt(m[3], 10);
      if (m[3].length === 2) cs *= 10;
      segs.push({ time: parseInt(m[1], 10) * 60000 + parseInt(m[2], 10) * 1000 + cs, text: m[4] });
    }
    if (segs.length === 0) return { text: text };
    var words = [];
    for (var i = 0; i < segs.length; i++) {
      var seg = segs[i];
      if (seg.text === '' && i === segs.length - 1) {
        if (words.length > 0) words[words.length - 1].end = seg.time;
        continue;
      }
      words.push({
        start: seg.time,
        end: (i + 1 < segs.length) ? segs[i + 1].time : seg.time,
        text: seg.text,
      });
    }
    var plain = '';
    for (var j = 0; j < words.length; j++) plain += words[j].text;
    return { text: plain, words: words };
  }

  function parseLRC(text) {
    if (!text) return [];
    var lines = text.split('\n');
    var entries = [];
    var timeRe = /\[(\d{2}):(\d{2})(?:[\.:](\d{2,3}))?\]/g;

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (!line) continue;
      var m, lastIdx = 0, times = [];
      timeRe.lastIndex = 0;
      while ((m = timeRe.exec(line)) !== null) {
        var cs = 0;
        if (m[3] !== undefined) { cs = parseInt(m[3], 10); if (m[3].length === 2) cs *= 10; }
        times.push(parseInt(m[1], 10) * 60000 + parseInt(m[2], 10) * 1000 + cs);
        lastIdx = m.index + m[0].length;
      }
      if (times.length === 0) continue;
      var parsed = _parseLRCWords(line.substring(lastIdx).trim());
      for (var t = 0; t < times.length; t++) {
        var entry = { time: times[t], text: parsed.text };
        if (parsed.words) entry.words = parsed.words;
        entries.push(entry);
      }
    }

    entries.sort(function (a, b) { return a.time - b.time; });

    var grouped = [];
    var k = 0;
    while (k < entries.length) {
      var cluster = [entries[k]];
      var j = k + 1;
      while (j < entries.length && Math.abs(entries[j].time - entries[k].time) <= 30) {
        cluster.push(entries[j]); j++;
      }
      var item = { time: entries[k].time, text: cluster[0].text };
      if (cluster[0].words) item.words = cluster[0].words;
      if (cluster.length >= 3) {
        item.romaji = cluster[1].text;
        if (cluster[1].words) item.romajiWords = cluster[1].words;
        item.translation = cluster[2].text;
        if (cluster[2].words) item.translationWords = cluster[2].words;
      } else if (cluster.length === 2) {
        item.translation = cluster[1].text;
        if (cluster[1].words) item.translationWords = cluster[1].words;
      }
      grouped.push(item);
      k = j;
    }
    return grouped;
  }

  /** 抽取「作词/作曲/制作人」等制作信息，返回 { lyrics, credits } */
  function processLyricsCredits(text, filterStr) {
    var empty = { lyrics: text || '', credits: '' };
    if (!text) return empty;
    if (!filterStr) filterStr = '作词,作曲,编曲,和声,对唱,配唱制作人,钢琴,吉他,鼓,贝斯,制作人,制作,混音,混音师,混音室,母带,录音,录音师,录音室,监制,策划,发行,词曲,填词,谱曲,OP,ED,SP';

    var words = filterStr.split(/[,，]/)
      .map(function (w) { return w.trim(); })
      .filter(function (w) { return w.length > 0; })
      .sort(function (a, b) { return b.length - a.length; });
    if (words.length === 0) return empty;

    var escaped = words.map(function (w) { return w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); });
    var re = new RegExp('^\\s*(' + escaped.join('|') + ')\\s*[：:]', 'g');

    var lines = text.split('\n');
    var names = [];
    var normal = [];
    var phase = true;

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      var trimmed = line.trim();
      if (!trimmed) { if (!phase) normal.push(line); continue; }

      var tm = trimmed.match(/\[(\d{2}):(\d{2})(?:[\.:](\d{2,3}))?\]/);
      var content = tm ? trimmed.substring(tm.index + tm[0].length).trim() : trimmed;
      var plain = content.replace(/<\d{2}:\d{2}[\.:]\d{2,3}>/g, '');

      if (!tm && /^\[[a-zA-Z]+:/.test(trimmed)) { if (!phase) normal.push(line); continue; }
      if (!plain) { if (!phase) normal.push(line); continue; }

      re.lastIndex = 0;
      var matches = [];
      var cm;
      while ((cm = re.exec(plain)) !== null) matches.push({ index: cm.index, end: cm.index + cm[0].length });

      if (matches.length > 0 && phase) {
        for (var j = 0; j < matches.length; j++) {
          var valEnd = (j + 1 < matches.length) ? matches[j + 1].index : plain.length;
          var value = plain.substring(matches[j].end, valEnd).trim().replace(/[、,，\/\s]+$/, '');
          if (!value) continue;
          var parts = value.split(/[、,，\/]/);
          for (var n = 0; n < parts.length; n++) {
            var nm = parts[n].trim();
            if (nm) names.push(nm);
          }
        }
        continue;
      }

      phase = false;
      normal.push(line);
    }

    if (names.length === 0) return empty;

    var seen = {};
    var uniq = [];
    for (var q = 0; q < names.length; q++) {
      if (!seen[names[q]]) { seen[names[q]] = true; uniq.push(names[q]); }
    }
    return { lyrics: normal.join('\n'), credits: 'Written By：' + uniq.join('、') };
  }

  // ==========================================================================
  // 微交互（与 App.utils 版本同参数）
  // ==========================================================================
  function squeezeIcon(iconEl, newText) {
    if (!iconEl) return;
    if (!iconEl.animate) { iconEl.textContent = newText; return; }
    if (iconEl._squeezeAnim) iconEl._squeezeAnim.cancel();
    if (iconEl._squeezeTimer) clearTimeout(iconEl._squeezeTimer);
    iconEl._squeezeAnim = iconEl.animate(
      [{ transform: 'scaleX(1)' }, { transform: 'scaleX(0.12)' }, { transform: 'scaleX(1.12)' }, { transform: 'scaleX(1)' }],
      { duration: 320, easing: 'cubic-bezier(0.2, 0, 0, 1)' }
    );
    iconEl._squeezeTimer = setTimeout(function () { iconEl.textContent = newText; }, 110);
  }

  function bloomButton(btnEl) {
    if (!btnEl || !btnEl.animate) return;
    if (btnEl._bloomAnim) btnEl._bloomAnim.cancel();
    var isFlexBasis = btnEl.classList.contains('np-play-pill');
    var prop = isFlexBasis ? 'flexBasis' : 'width';
    var base = isFlexBasis ? 96 : 88;
    var k0 = {}, k1 = {}, k2 = {};
    k0[prop] = base + 'px'; k1[prop] = (base + 14) + 'px'; k2[prop] = base + 'px';
    btnEl._bloomAnim = btnEl.animate([k0, k1, k2], { duration: 320, easing: 'cubic-bezier(0.2, 0, 0, 1)' });
  }

  // ==========================================================================
  // 歌词滚动（弹性滚动 + 行级联，同 pages/utils.js 的参数）
  // ==========================================================================
  var _scrollRaf = 0;

  function cancelLyricsScroll() {
    if (_scrollRaf) { cancelAnimationFrame(_scrollRaf); _scrollRaf = 0; }
  }

  function animateLyricsScroll(wrapEl, targetTop, lineGapMs) {
    cancelLyricsScroll();
    var start = wrapEl.scrollTop;
    var dist = targetTop - start;
    if (Math.abs(dist) < 2) { wrapEl.scrollTop = targetTop; return; }
    var absDist = Math.abs(dist);
    var dur = Math.max(50, Math.min(175, 50 + absDist * 0.25));
    if (typeof lineGapMs === 'number' && isFinite(lineGapMs)) {
      dur = Math.max(50, Math.min(175, 50 + Math.max(0, lineGapMs) * 0.1));
    }
    var c1 = absDist > 300 ? 0.60 : 0.78;
    var c3 = c1 + 1;
    var t0 = performance.now();
    function frame(now) {
      var t = Math.min((now - t0) / dur, 1);
      var e = 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
      wrapEl.scrollTop = start + dist * e;
      _scrollRaf = t < 1 ? requestAnimationFrame(frame) : 0;
    }
    _scrollRaf = requestAnimationFrame(frame);
  }

  function cascadeLyricLines(lines, activeIdx) {
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (line.classList.contains('np-lyrics-static')) continue;
      var d = Math.abs(i - activeIdx);
      var delay = Math.min(d * 18, 90);
      line.style.transitionDelay = delay + 'ms';
      line.style.setProperty('--lyrics-lift-delay', delay + 'ms');
      line.classList.remove('np-lyrics-lift');
      if (d <= 3) {
        void line.offsetWidth;   // 强制一次布局读取，保证动画能重播
        line.classList.add('np-lyrics-lift');
      }
    }
  }

  function applyProgressiveBlur(lines, activeIdx) {
    if (!progressiveBlurEnabled) return;
    for (var i = 0; i < lines.length; i++) {
      var d = Math.abs(i - activeIdx);
      var blurPx = d === 0 ? 0 : d === 1 ? 1.5 : d === 2 ? 3 : d === 3 ? 4.5 : 6;
      var line = lines[i];
      if (line._blurPx !== blurPx) {
        line._blurPx = blurPx;
        line.style.filter = blurPx > 0 ? 'blur(' + blurPx + 'px)' : '';
      }
    }
  }

  // ==========================================================================
  // Pivot
  // ==========================================================================
  function switchTab(name) {
    currentTab = name;
    for (var i = 0; i < els.pivotTabs.length; i++) {
      var tab = els.pivotTabs[i];
      var active = tab.getAttribute('data-tab') === name;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', active ? 'true' : 'false');
    }
    for (var j = 0; j < els.panels.length; j++) {
      els.panels[j].classList.toggle('active', els.panels[j].getAttribute('data-panel') === name);
    }
    els.miniInfo.style.display = (name === 'info') ? 'none' : 'flex';

    // 懒渲染：只有真正切到该标签页时才建 DOM
    if (name === 'queue' && !queueRendered) renderQueue();
    if (name === 'lyrics' && !lyricsRendered && currentTrack) renderLyrics(currentTrack);
  }

  // ==========================================================================
  // 队列
  // ==========================================================================
  var _draggedItem = null;

  function renderQueue() {
    var queue = queueData || [];
    var currentIndex = queueIndex;
    var list = els.queueList;
    list.textContent = '';
    queueRendered = true;

    if (queue.length === 0) return;

    // 渲染窗口：以当前曲目为锚点，最多 QUEUE_RENDER_LIMIT 条
    var total = queue.length;
    var start = 0;
    if (total > QUEUE_RENDER_LIMIT) {
      start = Math.max(0, Math.min(currentIndex - QUEUE_LEAD, total - QUEUE_RENDER_LIMIT));
    }
    var end = Math.min(total, start + QUEUE_RENDER_LIMIT);

    var frag = document.createDocumentFragment();

    if (start > 0) {
      var head = document.createElement('div');
      head.className = 'np-queue-more';
      head.textContent = '前面还有 ' + start + ' 首';
      frag.appendChild(head);
    }

    for (var i = start; i < end; i++) {
      frag.appendChild(buildQueueItem(queue[i], i, i === currentIndex));
    }

    if (end < total) {
      var foot = document.createElement('div');
      foot.className = 'np-queue-more';
      foot.textContent = '后面还有 ' + (total - end) + ' 首';
      frag.appendChild(foot);
    }

    list.appendChild(frag);
  }

  function buildQueueItem(track, index, isCurrent) {
    var li = document.createElement('div');
    li.className = 'np-queue-item' + (isCurrent ? ' current' : '');
    li.dataset.index = index;
    li.draggable = true;

    var drag = document.createElement('button');
    drag.className = 'np-queue-drag';
    drag.setAttribute('aria-label', App.i18n.t('np.dragToReorder'));
    drag.innerHTML = '<span class="np-queue-drag-icon"></span>';

    var coverWrap = document.createElement('div');
    coverWrap.className = 'np-queue-cover-wrap';
    var coverBox = document.createElement('div');
    coverBox.className = 'np-queue-cover';
    if (track.has_cover) {
      var img = document.createElement('img');
      img.loading = 'lazy';
      img.decoding = 'async';
      img.alt = '';
      img.src = coverUrl(track.id, 128);
      coverBox.appendChild(img);
    } else {
      coverBox.innerHTML = '<span class="material-symbols-rounded">music_note</span>';
    }
    coverWrap.appendChild(coverBox);

    var info = document.createElement('div');
    info.className = 'np-queue-info';
    var pTitle = document.createElement('div');
    pTitle.className = 'np-queue-title';
    pTitle.textContent = track.title || App.i18n.t('common.unknownTrack');
    var pArtist = document.createElement('div');
    pArtist.className = 'np-queue-artist';
    pArtist.textContent = track.artist || App.i18n.t('common.unknownArtist');
    info.appendChild(pTitle);
    info.appendChild(pArtist);

    var dur = document.createElement('div');
    dur.className = 'np-queue-duration';
    dur.textContent = fmtTime(track.duration_ms);

    var remove = document.createElement('button');
    remove.className = 'np-queue-remove icon-btn';
    remove.style.cssText = 'width:32px;height:32px';
    remove.setAttribute('aria-label', App.i18n.t('np.removeFromQueue'));
    remove.innerHTML = '<span class="material-symbols-rounded" style="font-size:18px">close</span>';

    li.appendChild(drag);
    li.appendChild(coverWrap);
    li.appendChild(info);
    li.appendChild(dur);
    li.appendChild(remove);

    li.addEventListener('click', function (e) {
      if (e.target.closest('.np-queue-remove') || e.target.closest('.np-queue-drag')) return;
      invoke('play_queue_at', index);
    });
    remove.addEventListener('click', function (e) {
      e.stopPropagation();
      invoke('remove_from_queue', index);
    });
    _wireQueueDrag(li);
    return li;
  }

  function _itemEls() {
    return Array.prototype.slice.call(els.queueList.querySelectorAll('.np-queue-item'));
  }

  function _clearDropMarks() {
    var items = _itemEls();
    for (var i = 0; i < items.length; i++) items[i].classList.remove('drag-over-top', 'drag-over-bottom');
  }

  function _wireQueueDrag(item) {
    item.addEventListener('dragstart', function (e) {
      _draggedItem = item;
      item.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', item.dataset.index);
    });
    item.addEventListener('dragend', function () {
      item.classList.remove('dragging');
      _draggedItem = null;
      _clearDropMarks();
    });
    item.addEventListener('dragover', function (e) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (_draggedItem === item) return;
      var rect = item.getBoundingClientRect();
      _clearDropMarks();
      item.classList.add(e.clientY < rect.top + rect.height / 2 ? 'drag-over-top' : 'drag-over-bottom');
    });
    item.addEventListener('dragleave', function () {
      item.classList.remove('drag-over-top', 'drag-over-bottom');
    });
    item.addEventListener('drop', function (e) {
      e.preventDefault();
      if (!_draggedItem || _draggedItem === item) return;
      _dropOn(item, e.clientY);
    });
  }

  /**
   * 把「拖到某一条的上/下半区」翻译成绝对索引的 reorder：
   * 渲染窗口可能只是队列的一段，所以索引要用 dataset.index（绝对值），
   * 不能用 DOM 位置。语义与主窗口 now_playing.js 一致。
   */
  function _dropOn(targetItem, clientY) {
    var items = _itemEls();
    var rect = targetItem.getBoundingClientRect();
    var pos = items.indexOf(targetItem);
    if (clientY >= rect.top + rect.height / 2) pos += 1;

    var lastAbs = Number(items[items.length - 1].dataset.index);
    var toAbs = (pos < items.length) ? Number(items[pos].dataset.index) : (lastAbs + 1);

    var fromAbs = Number(_draggedItem.dataset.index);
    if (fromAbs < toAbs) toAbs -= 1;
    if (fromAbs !== toAbs) invoke('reorder_queue', fromAbs, toAbs);
  }

  // ==========================================================================
  // 歌词渲染
  // ==========================================================================
  function renderLyrics(track) {
    lyricsData = [];
    lyricLines = null;
    activeWords = null;
    lastLyricsIdx = -1;
    lyricsRendered = true;

    els.lyrics.textContent = '';
    cancelLyricsScroll();
    els.lyricsWrap.scrollTop = 0;

    if (!track || !track.lyrics) {
      els.lyrics.innerHTML = '<div class="np-lyrics-placeholder">' +
        '<span class="material-symbols-rounded">lyrics</span>' +
        '<p>' + escapeHtml(App.i18n.t('np.noLyrics')) + '</p></div>';
      return;
    }

    var hasJapanese = /[\u3040-\u309F\u30A0-\u30FF]/.test(track.lyrics);
    var useJpDistinct = lyricFontSettings.lyrics_jp_use_distinct !== false;
    var jpFont = lyricFontSettings.lyrics_jp_font || '';
    var baseFont = lyricFontSettings.lyrics_font || '';

    els.lyrics.classList.toggle('jp', hasJapanese && useJpDistinct);

    var res = processLyricsCredits(track.lyrics, lyricsCreditFilters);
    var frag = document.createDocumentFragment();
    var count = 0;

    if (isLRC(res.lyrics)) {
      lyricsData = parseLRC(res.lyrics);
      if (lyricsData.length === 0) { _renderNoLyrics(); return; }
      for (var i = 0; i < lyricsData.length; i++) {
        var line = lyricsData[i];
        var div = document.createElement('div');
        div.className = 'np-lyrics-line';
        _applyLineFont(div, /[\u3040-\u309F\u30A0-\u30FF]/.test(line.text) && useJpDistinct, baseFont, jpFont);
        if (line.words && line.words.length) _appendWords(div, line.words);
        else div.textContent = line.text;

        if (line.romaji) {
          var ro = document.createElement('span');
          ro.className = 'np-lyrics-romaji';
          _applyLineFont(ro, false, baseFont, jpFont);
          if (line.romajiWords && line.romajiWords.length) _appendWords(ro, line.romajiWords);
          else ro.textContent = line.romaji;
          div.appendChild(ro);
        }
        if (line.translation) {
          var tr = document.createElement('span');
          tr.className = 'np-lyrics-trans';
          _applyLineFont(tr, false, baseFont, jpFont);
          if (line.translationWords && line.translationWords.length) _appendWords(tr, line.translationWords);
          else tr.textContent = line.translation;
          div.appendChild(tr);
        }
        frag.appendChild(div);
        count++;
      }
    } else {
      var statics = parseStaticLyrics(res.lyrics);
      if (statics.length === 0) { _renderNoLyrics(); return; }
      for (var s = 0; s < statics.length; s++) {
        var d2 = document.createElement('div');
        d2.className = 'np-lyrics-line np-lyrics-static';
        _applyLineFont(d2, /[\u3040-\u309F\u30A0-\u30FF]/.test(statics[s]) && useJpDistinct, baseFont, jpFont);
        d2.textContent = statics[s];
        frag.appendChild(d2);
        count++;
      }
    }

    if (res.credits) {
      var cr = document.createElement('div');
      cr.className = 'np-lyrics-credits';
      cr.textContent = res.credits;
      frag.appendChild(cr);
    }

    els.lyrics.appendChild(frag);
    lyricLines = els.lyrics.querySelectorAll('.np-lyrics-line');
    // 立即对齐当前进度，避免切歌后要等下一个 position tick 才高亮
    updateLyrics(_lastPos);
  }

  function _renderNoLyrics() {
    els.lyrics.textContent = '';
    els.lyrics.innerHTML = '<div class="np-lyrics-placeholder">' +
      '<span class="material-symbols-rounded">lyrics</span>' +
      '<p>' + escapeHtml(App.i18n.t('np.noLyrics')) + '</p></div>';
  }

  function _applyLineFont(el, isJpLine, baseFont, jpFont) {
    if (isJpLine && jpFont) el.style.fontFamily = jpFont;
    else if (baseFont) el.style.fontFamily = baseFont;
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

  var _lastPos = 0;

  function updateLyrics(posMs) {
    if (!lyricLines || lyricLines.length === 0) return;

    var idx = -1;
    for (var i = 0; i < lyricsData.length; i++) {
      if (posMs >= lyricsData[i].time) idx = i;
      else break;
    }
    if (idx < 0) idx = 0;

    if (idx !== lastLyricsIdx) {
      lastLyricsIdx = idx;
      for (var j = 0; j < lyricLines.length; j++) {
        var st = j < idx ? 2 : (j === idx ? 1 : 0);
        if (lyricLines[j]._st === st) continue;
        lyricLines[j]._st = st;
        lyricLines[j].classList.toggle('active', st === 1);
        lyricLines[j].classList.toggle('past', st === 2);
      }
      applyProgressiveBlur(lyricLines, idx);
      cascadeLyricLines(lyricLines, idx);

      var activeLine = lyricLines[idx];
      if (activeLine) {
        activeWords = activeLine.querySelectorAll('.np-lyrics-word');
        var target = activeLine.offsetTop - els.lyricsWrap.clientHeight * 0.22 + activeLine.clientHeight / 2;
        animateLyricsScroll(els.lyricsWrap, target);
      } else {
        activeWords = null;
      }
    }

    // 逐字高亮：只在状态真的变化时写 DOM
    if (activeWords) {
      for (var w = 0; w < activeWords.length; w++) {
        var word = activeWords[w];
        var ws = parseInt(word.dataset.time, 10);
        var we = parseInt(word.dataset.end, 10);
        var wst = posMs >= we ? 2 : (posMs >= ws ? 1 : 0);
        if (word._st === wst) continue;
        word._st = wst;
        word.classList.toggle('active', wst === 1);
        word.classList.toggle('past', wst === 2);
      }
    }
  }

  // ==========================================================================
  // 曲目 / 状态
  // ==========================================================================
  var _lastCurSec = -1;
  var _lastDurSec = -1;

  function updateTrack(track) {
    currentTrack = track;
    duration = track ? (track.duration_ms || 0) : 0;

    // 换歌 → 歌词与主题重建
    lyricsData = [];
    lyricLines = null;
    activeWords = null;
    lastLyricsIdx = -1;
    lyricsRendered = false;

    if (!track) {
      els.title.textContent = App.i18n.t('common.notPlaying');
      els.artist.textContent = '—';
      els.album.textContent = '';
      els.coverImg.removeAttribute('src');
      els.coverImg.style.display = 'none';
      els.coverIcon.style.display = '';
      els.cover.style.background = 'var(--md-surface-container)';
      els.coverIcon.style.color = 'var(--md-on-surface-variant)';
      setBarPct(0);
      els.timeCur.textContent = '0:00';
      els.timeDur.textContent = '-0:00';
      _lastCurSec = 0; _lastDurSec = 0;
      applyDynamicTheme(null);
      currentDominantRgb = null;
      els.miniTitle.textContent = App.i18n.t('common.notPlaying');
      els.miniArtist.textContent = '—';
      els.miniCoverImg.removeAttribute('src');
      els.miniCoverImg.style.display = 'none';
      els.miniCoverIcon.style.display = '';
      if (currentTab === 'queue') renderQueue();
      return;
    }

    els.title.textContent = track.title || App.i18n.t('common.unknownTrack');
    els.artist.textContent = track.artist || App.i18n.t('common.unknownArtist');
    els.album.textContent = track.album || '';
    els.miniTitle.textContent = els.title.textContent;
    els.miniArtist.textContent = els.artist.textContent;

    if (track.has_cover) {
      els.coverImg.crossOrigin = 'anonymous';
      els.coverImg.onload = function () { applyCoverTheme(els.coverImg); };
      els.coverImg.src = coverUrl(track.id, 512);
      els.coverImg.style.display = '';
      els.coverIcon.style.display = 'none';
      els.cover.style.background = '';

      els.miniCoverImg.src = coverUrl(track.id, 128);
      els.miniCoverImg.style.display = '';
      els.miniCoverIcon.style.display = 'none';
    } else {
      els.coverImg.onload = null;
      els.coverImg.removeAttribute('src');
      els.coverImg.style.display = 'none';
      els.coverIcon.style.display = '';
      els.cover.style.background = hashColor(track.album || track.title);
      els.coverIcon.style.color = 'rgba(255,255,255,0.9)';
      applyDynamicTheme(null);
      currentDominantRgb = null;

      els.miniCoverImg.removeAttribute('src');
      els.miniCoverImg.style.display = 'none';
      els.miniCoverIcon.style.display = '';
    }

    // 歌词标签页当前可见时同步重建（否则等切过去再建，省掉整份歌词 DOM）
    if (currentTab === 'lyrics') renderLyrics(track);

    // 队列：当前曲目高亮位置变了，重开时重建
    queueRendered = false;
    if (currentTab === 'queue') renderQueue();
  }

  function setBarPct(pct) {
    pct = Math.max(0, Math.min(100, pct));
    els.barFill.style.width = pct + '%';
    els.barThumb.style.left = pct + '%';
    els.barWrap.style.setProperty('--progress-val', pct + '%');
    els.barWrap.setAttribute('aria-valuenow', String(Math.round(pct)));
  }

  // position 事件可能高于帧率，用 rAF 合并到每帧一次写入，避免样式抖动
  var _pendingPos = -1;
  var _posRaf = 0;

  function onPosition(posMs) {
    _pendingPos = posMs;
    if (!_posRaf) _posRaf = requestAnimationFrame(_flushPosition);
  }

  function _flushPosition() {
    _posRaf = 0;
    if (isSeeking) return;
    var posMs = _pendingPos;
    if (posMs < 0) return;
    _lastPos = posMs;
    updatePosition(posMs);
  }

  function updatePosition(posMs) {
    var curSec = Math.floor(posMs / 1000);
    if (curSec !== _lastCurSec) {
      _lastCurSec = curSec;
      els.timeCur.textContent = fmtTime(posMs);
    }
    if (duration) {
      var pct = Math.min((posMs / duration) * 100, 100);
      setBarPct(pct);
      var durSec = Math.floor((duration - posMs) / 1000);
      if (durSec !== _lastDurSec) {
        _lastDurSec = durSec;
        els.timeDur.textContent = '-' + fmtTime(duration - posMs);
      }
    }
    updateLyrics(posMs);
  }

  function updateDuration(durMs) {
    duration = durMs;
    _lastDurSec = -1;
    els.timeDur.textContent = '-' + fmtTime(durMs);
  }

  function updateState(state) {
    currentState = state;
    var playing = state === 'playing';
    squeezeIcon(els.iconPlay, playing ? 'pause' : 'play_arrow');
    bloomButton(els.btnPlay);
    els.btnPlay.classList.toggle('playing', playing);
    els.cover.classList.toggle('playing', playing);
    els.barFill.classList.toggle('playing', playing);
  }

  function updateVolume(vol) {
    currentVolume = vol;
    els.volSlider.value = vol;
    els.volLabel.textContent = vol;
    els.volSlider.style.setProperty('--volume-val', vol + '%');
    els.iconVol.textContent = vol === 0 ? 'volume_off'
      : vol < 33 ? 'volume_mute'
      : vol < 66 ? 'volume_down'
      : 'volume_up';
  }

  function updateShuffle(enabled) {
    currentShuffle = enabled;
    els.btnShuffle.classList.toggle('active', enabled);
  }

  function updateRepeat(mode) {
    currentRepeat = mode;
    var icon = els.btnRepeat.querySelector('.material-symbols-rounded');
    if (icon) icon.textContent = mode === 'one' ? 'repeat_one' : 'repeat';
    els.btnRepeat.classList.toggle('active', mode !== 'off');
  }

  function updateLiked(liked) {
    currentLiked = liked;
    els.btnLike.classList.toggle('liked', liked);
    var icon = els.btnLike.querySelector('.material-symbols-rounded');
    if (icon) icon.classList.toggle('icon-filled', liked);
  }

  function _updateAudioMode(exclusive) {
    els.btnAudioMode.classList.toggle('active', !!exclusive);
    els.audioModeLabel.textContent = exclusive ? 'excl' : 'shrd';
    els.btnAudioMode.setAttribute('title',
      App.i18n.t(exclusive ? 'np.exclusiveMode' : 'np.sharedMode'));
  }

  // ==========================================================================
  // 主题 / 字体
  // ==========================================================================
  var _mqDark = null;

  function applyTheme(val) {
    var theme = val;
    if (val === 'system') {
      theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    document.documentElement.setAttribute('data-theme', theme);
  }

  function applyUiFont(val) {
    var root = document.documentElement;
    if (val && val.trim()) root.style.setProperty('--ui-font', val.trim());
    else root.style.removeProperty('--ui-font');
  }

  function applySettings(settings) {
    applyTheme(settings.theme || 'system');
    applyUiFont(settings.ui_font || '');
    colorScheme = settings.color_scheme || 'tonal_spot';

    lyricFontSettings = {
      lyrics_font: settings.lyrics_font || '',
      lyrics_jp_font: settings.lyrics_jp_font || '',
      lyrics_jp_use_distinct: settings.lyrics_jp_use_distinct !== false,
    };
    progressiveBlurEnabled = !!settings.lyrics_progressive_blur;
    els.lyricsWrap.classList.toggle('progressive-blur', progressiveBlurEnabled);
    lyricsCentered = !!settings.lyrics_center;
    lyricsFontSize = parseInt(settings.lyrics_font_size, 10) || 16;
    circularCover = !!settings.circular_cover;
    waveProgress = settings.wave_progress !== false;
    lyricsCreditFilters = settings.lyrics_credit_filters || '';

    els.lyrics.classList.toggle('lyrics-centered', lyricsCentered);
    els.lyrics.style.setProperty('--lyrics-font-size', lyricsFontSize + 'px');
    els.cover.classList.toggle('circular', circularCover);
    els.barFill.classList.toggle('flat', !waveProgress);

    _updateAudioMode(!!settings.wasapi_exclusive);

    if (App.i18n.getLang() !== (settings.language || 'zh-CN')) {
      App.i18n.init(settings.language || 'zh-CN');
      onLanguageChanged();
    }

    if (currentDominantRgb) applyDynamicTheme(currentDominantRgb);

    // 字体/排版变化 → 重建当前可见的歌词
    if (currentTrack && lyricsRendered) renderLyrics(currentTrack);
  }

  function onLanguageChanged() {
    if (!currentTrack) {
      els.title.textContent = App.i18n.t('common.notPlaying');
      els.miniTitle.textContent = App.i18n.t('common.notPlaying');
    } else {
      els.title.textContent = currentTrack.title || App.i18n.t('common.unknownTrack');
      els.artist.textContent = currentTrack.artist || App.i18n.t('common.unknownArtist');
      els.miniTitle.textContent = els.title.textContent;
      els.miniArtist.textContent = els.artist.textContent;
    }
    _updateAudioMode(els.btnAudioMode.classList.contains('active'));
    if (lyricsRendered && currentTrack) renderLyrics(currentTrack);
    if (queueRendered) renderQueue();
  }

  // ==========================================================================
  // 确认对话框（M3）
  // ==========================================================================
  function confirmDialog(o) {
    return new Promise(function (resolve) {
      var overlay = document.createElement('div');
      overlay.className = 'np-dialog-overlay';
      var dlg = document.createElement('div');
      dlg.className = 'np-dialog';
      dlg.innerHTML =
        '<div class="np-dialog-title"></div><div class="np-dialog-body"></div>' +
        '<div class="np-dialog-actions">' +
          '<button class="np-dialog-btn np-dialog-btn--cancel"></button>' +
          '<button class="np-dialog-btn np-dialog-btn--confirm"></button>' +
        '</div>';
      dlg.querySelector('.np-dialog-title').textContent = o.title || '';
      dlg.querySelector('.np-dialog-body').textContent = o.body || '';
      var cancelBtn = dlg.querySelector('.np-dialog-btn--cancel');
      var confirmBtn = dlg.querySelector('.np-dialog-btn--confirm');
      cancelBtn.textContent = o.cancelText || App.i18n.t('common.cancel');
      confirmBtn.textContent = o.confirmText || App.i18n.t('common.confirm');
      overlay.appendChild(dlg);
      document.body.appendChild(overlay);
      requestAnimationFrame(function () { overlay.classList.add('open'); });

      var done = false;
      function close(result) {
        if (done) return;
        done = true;
        overlay.classList.remove('open');
        document.removeEventListener('keydown', onKey);
        setTimeout(function () {
          if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
          resolve(result);
        }, 180);
      }
      function onKey(e) {
        if (e.key === 'Escape') close(false);
        else if (e.key === 'Enter') close(true);
      }
      cancelBtn.addEventListener('click', function () { close(false); });
      confirmBtn.addEventListener('click', function () { close(true); });
      overlay.addEventListener('click', function (e) { if (e.target === overlay) close(false); });
      document.addEventListener('keydown', onKey);
      setTimeout(function () { confirmBtn.focus(); }, 50);
    });
  }

  function confirmExclusiveSwitch(targetOn) {
    if (targetOn) {
      return confirmDialog({
        title: App.i18n.t('audio.switchExclusiveTitle'),
        body: App.i18n.t('audio.switchExclusiveBody'),
        confirmText: App.i18n.t('audio.switchExclusiveConfirm'),
      });
    }
    return confirmDialog({
      title: App.i18n.t('audio.switchSharedTitle'),
      body: App.i18n.t('audio.switchSharedBody'),
      confirmText: App.i18n.t('audio.switchSharedConfirm'),
    });
  }

  // ==========================================================================
  // 进度条拖动
  // ==========================================================================
  function _seekPct(clientX) {
    var rect = els.barWrap.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  }

  function _onSeekMove(e) {
    if (!duration) return;
    var pct = _seekPct(e.clientX);
    setBarPct(pct * 100);
    els.timeCur.textContent = fmtTime(pct * duration);
    els.timeDur.textContent = '-' + fmtTime(duration - pct * duration);
  }

  function _onSeekUp(e) {
    isSeeking = false;
    document.removeEventListener('mousemove', _onSeekMove);
    document.removeEventListener('mouseup', _onSeekUp);
    if (!duration) return;
    var ms = Math.floor(_seekPct(e.clientX) * duration);
    _lastPos = ms;
    invoke('seek', ms);
  }

  // ==========================================================================
  // 事件绑定
  // ==========================================================================
  function bindUI() {
    els.btnPlay.addEventListener('click', function () {
      invoke(currentState === 'playing' ? 'pause' : 'play');
    });
    els.btnPrev.addEventListener('click', function () { invoke('prev_track'); });
    els.btnNext.addEventListener('click', function () { invoke('next_track'); });

    els.btnShuffle.addEventListener('click', function () { invoke('set_shuffle', !currentShuffle); });

    els.btnRepeat.addEventListener('click', function () {
      var modes = ['off', 'all', 'one'];
      invoke('set_repeat', modes[(modes.indexOf(currentRepeat) + 1) % modes.length]);
    });

    els.btnLike.addEventListener('click', function () { invoke('toggle_liked'); });

    els.btnAudioMode.addEventListener('click', function () {
      var target = !els.btnAudioMode.classList.contains('active');
      confirmExclusiveSwitch(target).then(function (ok) {
        if (!ok) return;
        return invoke('set_wasapi_exclusive', target);
      }).then(function (actual) {
        if (actual !== undefined) _updateAudioMode(actual === 'wasapi_exclusive');
      });
    });

    els.btnDock.addEventListener('click', function () { invoke('close_floating_window'); });
    els.btnMinimize.addEventListener('click', function () { invoke('minimize_window'); });
    els.btnClose.addEventListener('click', function () { invoke('close_window'); });

    els.volSlider.addEventListener('input', function (e) {
      invoke('set_volume', parseInt(e.target.value, 10));
    });
    els.btnMute.addEventListener('click', function () {
      invoke('set_volume', currentVolume === 0 ? 80 : 0);
    });

    els.barWrap.addEventListener('mousedown', function (e) {
      if (!duration) return;
      isSeeking = true;
      _onSeekMove(e);
      document.addEventListener('mousemove', _onSeekMove);
      document.addEventListener('mouseup', _onSeekUp);
    });

    for (var i = 0; i < els.pivotTabs.length; i++) {
      (function (tab) {
        tab.addEventListener('click', function () { switchTab(tab.getAttribute('data-tab')); });
      })(els.pivotTabs[i]);
    }
  }

  // ==========================================================================
  // 后端事件
  // ==========================================================================
  function wireEvents() {
    on('track_changed', function (json) {
      var t;
      try { t = JSON.parse(json); } catch (e) { return; }
      // 队列索引会随换歌变化，队列可见时重建
      updateTrack(t);
    });
    on('playback_state_changed', updateState);
    on('position_changed', onPosition);
    on('duration_changed', updateDuration);
    on('volume_changed', updateVolume);
    on('shuffle_changed', updateShuffle);
    on('repeat_changed', updateRepeat);
    on('liked_changed', updateLiked);

    on('queue_changed', function (qjson) {
      var q;
      try { q = JSON.parse(qjson); } catch (e) { return; }
      queueData = q.queue || [];
      queueIndex = q.current_index || 0;
      if (currentTab === 'queue') renderQueue();
      else queueRendered = false;
    });

    on('lyrics_changed', function (json) {
      if (!currentTrack) return;
      var data;
      try { data = JSON.parse(json); } catch (e) { return; }
      if (!data || !data.trackId || data.trackId !== currentTrack.id) return;
      currentTrack.lyrics = data.lyrics;
      lyricsRendered = false;
      if (currentTab === 'lyrics') renderLyrics(currentTrack);
    });

    on('settings_changed', function (sjson) {
      var s;
      try { s = JSON.parse(sjson); } catch (e) { return; }
      applySettings(s);
    });
  }

  // ==========================================================================
  // 启动
  // ==========================================================================
  function boot() {
    if (!api) {
      console.error('[floating] __electronAPI 不可用，浮动窗无法工作');
      return;
    }
    api.onBridgeEvent(dispatch);
    wireEvents();
    bindUI();

    invoke('get_cover_base_url').then(function (url) {
      _coverBase = url || '';
      return invoke('get_settings');
    }).then(function (json) {
      var settings = {};
      try { settings = JSON.parse(json) || {}; } catch (e) { /* ignore */ }
      App.i18n.init(settings.language || 'zh-CN');
      App.i18n.applyToDOM();
      applySettings(settings);
      // 语言变更后补齐动态文本
      onLanguageChanged();
      return invoke('get_player_state');
    }).then(function (json) {
      var state = {};
      try { state = JSON.parse(json) || {}; } catch (e) { /* ignore */ }
      if (state.current_track) {
        updateTrack(state.current_track);
        if (state.duration) updateDuration(state.duration);
        if (state.position) { _lastPos = state.position; updatePosition(state.position); }
      }
      updateState(state.state || 'stopped');
      updateVolume(state.volume === undefined ? 80 : state.volume);
      updateShuffle(!!state.shuffle);
      updateRepeat(state.repeat || 'off');
      return invoke('is_current_liked');
    }).then(function (liked) {
      updateLiked(!!liked);
      return invoke('get_queue');
    }).then(function (qjson) {
      var q = {};
      try { q = JSON.parse(qjson) || {}; } catch (e) { /* ignore */ }
      queueData = q.queue || [];
      queueIndex = q.current_index || 0;
    }).catch(function (e) {
      console.error('[floating] 初始化失败', e);
    });
  }

  // 跟随系统主题变化（仅在 theme=system 时生效）
  _mqDark = window.matchMedia('(prefers-color-scheme: dark)');
  _mqDark.addEventListener('change', function () {
    invoke('get_settings').then(function (json) {
      var s = {};
      try { s = JSON.parse(json) || {}; } catch (e) { return; }
      if ((s.theme || 'system') === 'system') {
        applyTheme('system');
        if (currentDominantRgb) applyDynamicTheme(currentDominantRgb);
      }
    });
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
