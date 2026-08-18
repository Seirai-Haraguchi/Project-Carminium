/**
 * Carminium — 通用工具函数
 * 供所有页面模块调用，挂载到 window.App.utils
 */
(function () {
  'use strict';

  window.App = window.App || {};

  const utils = {};
  window.App.utils = utils;

  // ── 时间格式化 ─────────────────────────────────────────────────────────────

  /**
   * 将毫秒格式化为 M:SS 或 H:MM:SS
   * @param {number} ms
   * @returns {string}
   */
  utils.formatDuration = function (ms) {
    if (!ms || ms <= 0) return '0:00';
    const totalSec = Math.floor(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    if (h > 0) {
      return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }
    return `${m}:${String(s).padStart(2, '0')}`;
  };

  /**
   * 将 Unix 时间戳格式化为本地日期字符串
   * @param {number} ts  Unix seconds
   * @returns {string}
   */
  utils.formatDate = function (ts) {
    if (!ts) return '—';
    return new Date(ts * 1000).toLocaleDateString('zh-CN', {
      year: 'numeric', month: 'long', day: 'numeric',
    });
  };

  // ── 颜色与主题工具 ──────────────────────────────────────────────────────────

  /**
   * 根据字符串生成一致的 HSL 背景色
   * @param {string} str
   * @returns {string}  CSS color string
   */
  utils.hashColor = function (str) {
    if (!str) return 'hsl(240, 40%, 60%)';
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    const hue = ((hash % 360) + 360) % 360;
    // Use document theme to decide lightness
    const dark = document.documentElement.getAttribute('data-theme') === 'dark';
    return dark
      ? `hsl(${hue}, 45%, 35%)`
      : `hsl(${hue}, 55%, 60%)`;
  };

  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h, s, l = (max + min) / 2;
    if (max === min) {
      h = s = 0;
    } else {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      switch (max) {
        case r: h = (g - b) / d + (g < b ? 6 : 0); break;
        case g: h = (b - r) / d + 2; break;
        case b: h = (r - g) / d + 4; break;
      }
      h /= 6;
    }
    return [h * 360, s * 100, l * 100];
  }

  /**
   * 统一加载封面图片到 img 元素。
   * 必须在设置 src 之前声明 crossOrigin='anonymous'，否则跨域图片
   * 会让 canvas 受污染，extractDominantColor 的 getImageData 抛 SecurityError。
   * cover_server 已返回 Access-Control-Allow-Origin: *，前端配合即可。
   * @param {HTMLImageElement} imgEl
   * @param {string} trackId
   */
  // size: 目标分辨率（px）或 'max'；列表行缩略图默认 128 以最小化内存占用。
  utils.loadCover = function (imgEl, trackId, size) {
    if (window.CoverCache) {
      var cached = window.CoverCache.getCached(trackId, size);
      if (cached) {
        imgEl.dataset.coverCache = '1';
        imgEl.src = cached;
        return;
      }
      window.CoverCache.attachImage(imgEl, trackId, {
        size: size,
        onError: function () { imgEl.removeAttribute('src'); },
      });
    } else {
      imgEl.crossOrigin = 'anonymous';
      imgEl.src = window.coverUrl(trackId, size);
    }
  };

  utils.extractDominantColor = function(imgEl) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    // Scale down for speed
    const width = canvas.width = 64;
    const height = canvas.height = 64;

    ctx.drawImage(imgEl, 0, 0, width, height);
    try {
      const data = ctx.getImageData(0, 0, width, height).data;
      let maxScore = -1;
      let bestPixel = [128, 128, 128]; // fallback

      for (let i = 0; i < data.length; i += 4) {
        const r = data[i], g = data[i+1], b = data[i+2], a = data[i+3];
        if (a < 128) continue;
        const [h, s, l] = rgbToHsl(r, g, b);
        
        // Ignore very dark/light or desaturated colors
        if (l < 10 || l > 90) continue;
        
        // Score heavily favors saturation and moderate lightness
        const score = s - Math.abs(l - 50) * 0.5;
        if (score > maxScore) {
          maxScore = score;
          bestPixel = [r, g, b];
        }
      }
      return bestPixel;
    } catch (e) {
      console.warn('Cannot extract color', e);
      return null;
    }
  };

  // ── Material You 配色方案 ──────────────────────────────────────────────────
  //
  // 每个方案定义从源色生成调色板的策略：
  //   h1/h2/h3     — primary/secondary/tertiary 的色相偏移（度）
  //   chroma       — 主色饱和度策略：'moderate'|'faithful'|'mono'|'low'|'high'|'exact'
  //   sScale/tScale— secondary/tertiary 饱和度相对 primary 的倍率
  //   sMin/tMin    — secondary/tertiary 饱和度下限
  //   bgSat        — 背景表面饱和度 {dark, light}
  //
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

  utils.COLOR_SCHEMES = COLOR_SCHEMES;
  utils.colorSchemeNames = {
    tonal_spot: 'Tonal Spot',
    fidelity: 'Fidelity',
    monochrome: 'Monochrome',
    neutral: 'Neutral',
    vibrant: 'Vibrant',
    expressive: 'Expressive',
    content: 'Content',
    rainbow: 'Rainbow',
    fruit_salad: 'Fruit Salad',
  };

  /**
   * 根据策略计算饱和度
   * @param {string} strategy  'moderate'|'faithful'|'mono'|'low'|'high'|'exact'
   * @param {number} s         源色饱和度 (0-100)
   * @returns {number}
   */
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

  utils.applyDynamicTheme = function(rgb, scheme) {
    var root = document.documentElement;
    if (!rgb) {
      var props = [
        '--md-primary', '--md-on-primary', '--md-primary-container', '--md-on-primary-container',
        '--md-secondary', '--md-on-secondary', '--md-secondary-container', '--md-on-secondary-container',
        '--md-tertiary', '--md-on-tertiary', '--md-tertiary-container', '--md-on-tertiary-container',
        '--md-background', '--md-surface', '--md-surface-dim', '--md-surface-bright',
        '--md-surface-container-lowest', '--md-surface-container-low', '--md-surface-container',
        '--md-surface-container-high', '--md-surface-container-highest',
        '--md-outline-variant',
        '--bg-tint-1', '--bg-tint-2', '--bg-tint-3',
        // 视频背景暗色变体
        '--md-primary-vd', '--md-on-primary-vd', '--md-primary-container-vd', '--md-on-primary-container-vd',
        '--md-secondary-vd', '--md-on-secondary-vd', '--md-secondary-container-vd', '--md-on-secondary-container-vd',
        '--md-tertiary-vd', '--md-on-tertiary-vd', '--md-tertiary-container-vd', '--md-on-tertiary-container-vd',
        '--md-background-vd', '--md-surface-vd', '--md-surface-dim-vd', '--md-surface-bright-vd',
        '--md-surface-container-lowest-vd', '--md-surface-container-low-vd', '--md-surface-container-vd',
        '--md-surface-container-high-vd', '--md-surface-container-highest-vd',
        '--md-outline-variant-vd',
        '--bg-tint-1-vd', '--bg-tint-2-vd', '--bg-tint-3-vd',
      ];
      for (var pi = 0; pi < props.length; pi++) root.style.removeProperty(props[pi]);
      return;
    }

    // 获取配色方案（优先使用参数，其次从 App.state 读取，默认 tonal_spot）
    var schemeName = scheme || (window.App && App.state && App.state.colorScheme) || 'tonal_spot';
    var sc = COLOR_SCHEMES[schemeName] || COLOR_SCHEMES.tonal_spot;

    var isDark = root.getAttribute('data-theme') === 'dark';
    var hsl = rgbToHsl(rgb[0], rgb[1], rgb[2]);
    var h = hsl[0], s = hsl[1];

    // ── 色相计算 ──
    var h1 = (h + sc.h1 + 360) % 360;
    var h2 = (h + sc.h2 + 360) % 360;
    var h3 = (h + sc.h3 + 360) % 360;

    // ── 饱和度计算 ──
    var sat = _chroma(sc.chroma, s);
    var sat2 = Math.max(sc.sMin, Math.round(sat * sc.sScale));
    var sat3 = Math.max(sc.tMin, Math.round(sat * sc.tScale));

    // ── Primary ──
    root.style.setProperty('--md-primary', 'hsl(' + h1 + ', ' + sat + '%, ' + (isDark ? 80 : 40) + '%)');
    root.style.setProperty('--md-on-primary', 'hsl(' + h1 + ', ' + sat + '%, ' + (isDark ? 20 : 100) + '%)');
    root.style.setProperty('--md-primary-container', 'hsl(' + h1 + ', ' + sat + '%, ' + (isDark ? 20 : 92) + '%)');
    root.style.setProperty('--md-on-primary-container', 'hsl(' + h1 + ', ' + sat + '%, ' + (isDark ? 92 : 10) + '%)');

    // ── Secondary ──
    root.style.setProperty('--md-secondary', 'hsl(' + h2 + ', ' + sat2 + '%, ' + (isDark ? 75 : 37) + '%)');
    root.style.setProperty('--md-on-secondary', 'hsl(' + h2 + ', ' + sat2 + '%, ' + (isDark ? 18 : 100) + '%)');
    root.style.setProperty('--md-secondary-container', 'hsl(' + h2 + ', ' + sat2 + '%, ' + (isDark ? 22 : 90) + '%)');
    root.style.setProperty('--md-on-secondary-container', 'hsl(' + h2 + ', ' + sat2 + '%, ' + (isDark ? 90 : 12) + '%)');

    // ── Tertiary ──
    root.style.setProperty('--md-tertiary', 'hsl(' + h3 + ', ' + sat3 + '%, ' + (isDark ? 78 : 36) + '%)');
    root.style.setProperty('--md-on-tertiary', 'hsl(' + h3 + ', ' + sat3 + '%, ' + (isDark ? 20 : 100) + '%)');
    root.style.setProperty('--md-tertiary-container', 'hsl(' + h3 + ', ' + sat3 + '%, ' + (isDark ? 24 : 88) + '%)');
    root.style.setProperty('--md-on-tertiary-container', 'hsl(' + h3 + ', ' + sat3 + '%, ' + (isDark ? 86 : 14) + '%)');

    // ── Surface 色调 ──
    var bgSat = isDark ? sc.bgSat.d : sc.bgSat.l;
    root.style.setProperty('--md-background', 'hsl(' + h1 + ', ' + bgSat + '%, ' + (isDark ? 6 : 98) + '%)');
    root.style.setProperty('--md-surface', 'hsl(' + h1 + ', ' + bgSat + '%, ' + (isDark ? 6 : 98) + '%)');
    root.style.setProperty('--md-surface-dim', 'hsl(' + h1 + ', ' + Math.max(0, bgSat - 2) + '%, ' + (isDark ? 6 : 87) + '%)');
    root.style.setProperty('--md-surface-bright', 'hsl(' + h1 + ', ' + bgSat + '%, ' + (isDark ? 24 : 100) + '%)');
    root.style.setProperty('--md-surface-container-lowest', 'hsl(' + h1 + ', ' + Math.max(0, bgSat - 4) + '%, ' + (isDark ? 4 : 100) + '%)');
    root.style.setProperty('--md-surface-container-low', 'hsl(' + h1 + ', ' + Math.max(0, bgSat - 2) + '%, ' + (isDark ? 10 : 96) + '%)');
    root.style.setProperty('--md-surface-container', 'hsl(' + h1 + ', ' + bgSat + '%, ' + (isDark ? 12 : 93) + '%)');
    root.style.setProperty('--md-surface-container-high', 'hsl(' + h1 + ', ' + (bgSat + 2) + '%, ' + (isDark ? 17 : 90) + '%)');
    root.style.setProperty('--md-surface-container-highest', 'hsl(' + h1 + ', ' + (bgSat + 4) + '%, ' + (isDark ? 22 : 88) + '%)');

    // ── Outline variant ──
    root.style.setProperty('--md-outline-variant', 'hsl(' + h1 + ', ' + Math.max(0, bgSat - 2) + '%, ' + (isDark ? 22 : 88) + '%)');

    // ── 背景氛围渐变 ──
    root.style.setProperty('--bg-tint-1', 'hsla(' + h1 + ', ' + Math.min(sat + 8, 100) + '%, ' + (isDark ? 28 : 92) + '%, 0.5)');
    root.style.setProperty('--bg-tint-2', 'hsla(' + h2 + ', ' + Math.min(sat2 + 10, 100) + '%, ' + (isDark ? 22 : 92) + '%, 0.35)');
    root.style.setProperty('--bg-tint-3', 'hsla(' + h3 + ', ' + Math.min(sat3 + 10, 100) + '%, ' + (isDark ? 18 : 94) + '%, 0.25)');

    // ── 视频背景暗色变体（始终暗色模式，用于全窗口视图视频背景可读性）──
    // 色相/饱和度与主配色一致，亮度固定为暗色模式值
    var vdBgSat = sc.bgSat.d;

    root.style.setProperty('--md-primary-vd', 'hsl(' + h1 + ', ' + sat + '%, 80%)');
    root.style.setProperty('--md-on-primary-vd', 'hsl(' + h1 + ', ' + sat + '%, 20%)');
    root.style.setProperty('--md-primary-container-vd', 'hsl(' + h1 + ', ' + sat + '%, 20%)');
    root.style.setProperty('--md-on-primary-container-vd', 'hsl(' + h1 + ', ' + sat + '%, 92%)');

    root.style.setProperty('--md-secondary-vd', 'hsl(' + h2 + ', ' + sat2 + '%, 75%)');
    root.style.setProperty('--md-on-secondary-vd', 'hsl(' + h2 + ', ' + sat2 + '%, 18%)');
    root.style.setProperty('--md-secondary-container-vd', 'hsl(' + h2 + ', ' + sat2 + '%, 22%)');
    root.style.setProperty('--md-on-secondary-container-vd', 'hsl(' + h2 + ', ' + sat2 + '%, 90%)');

    root.style.setProperty('--md-tertiary-vd', 'hsl(' + h3 + ', ' + sat3 + '%, 78%)');
    root.style.setProperty('--md-on-tertiary-vd', 'hsl(' + h3 + ', ' + sat3 + '%, 20%)');
    root.style.setProperty('--md-tertiary-container-vd', 'hsl(' + h3 + ', ' + sat3 + '%, 24%)');
    root.style.setProperty('--md-on-tertiary-container-vd', 'hsl(' + h3 + ', ' + sat3 + '%, 86%)');

    root.style.setProperty('--md-background-vd', 'hsl(' + h1 + ', ' + vdBgSat + '%, 6%)');
    root.style.setProperty('--md-surface-vd', 'hsl(' + h1 + ', ' + vdBgSat + '%, 6%)');
    root.style.setProperty('--md-surface-dim-vd', 'hsl(' + h1 + ', ' + Math.max(0, vdBgSat - 2) + '%, 6%)');
    root.style.setProperty('--md-surface-bright-vd', 'hsl(' + h1 + ', ' + vdBgSat + '%, 24%)');
    root.style.setProperty('--md-surface-container-lowest-vd', 'hsl(' + h1 + ', ' + Math.max(0, vdBgSat - 4) + '%, 4%)');
    root.style.setProperty('--md-surface-container-low-vd', 'hsl(' + h1 + ', ' + Math.max(0, vdBgSat - 2) + '%, 10%)');
    root.style.setProperty('--md-surface-container-vd', 'hsl(' + h1 + ', ' + vdBgSat + '%, 12%)');
    root.style.setProperty('--md-surface-container-high-vd', 'hsl(' + h1 + ', ' + (vdBgSat + 2) + '%, 17%)');
    root.style.setProperty('--md-surface-container-highest-vd', 'hsl(' + h1 + ', ' + (vdBgSat + 4) + '%, 22%)');

    root.style.setProperty('--md-outline-variant-vd', 'hsl(' + h1 + ', ' + Math.max(0, vdBgSat - 2) + '%, 22%)');

    root.style.setProperty('--bg-tint-1-vd', 'hsla(' + h1 + ', ' + Math.min(sat + 8, 100) + '%, 28%, 0.5)');
    root.style.setProperty('--bg-tint-2-vd', 'hsla(' + h2 + ', ' + Math.min(sat2 + 10, 100) + '%, 22%, 0.35)');
    root.style.setProperty('--bg-tint-3-vd', 'hsla(' + h3 + ', ' + Math.min(sat3 + 10, 100) + '%, 18%, 0.25)');
  };

  // ── A-Z 分组工具 ───────────────────────────────────────────────────────────

  /**
   * 假名→罗马音 转换表（Hepburn 式）
   * 用于前端 A-Z 分组首字母提取，与后端 sortkey.js 保持一致
   */
  var _KANA_MAP = (function () {
    var pairs = [
      // yōon
      ["きゃ","kya"],["きゅ","kyu"],["きょ","kyo"],["しゃ","sha"],["しゅ","shu"],["しょ","sho"],
      ["ちゃ","cha"],["ちゅ","chu"],["ちょ","cho"],["にゃ","nya"],["にゅ","nyu"],["にょ","nyo"],
      ["ひゃ","hya"],["ひゅ","hyu"],["ひょ","hyo"],["みゃ","mya"],["みゅ","myu"],["みょ","myo"],
      ["りゃ","rya"],["りゅ","ryu"],["りょ","ryo"],["ぎゃ","gya"],["ぎゅ","gyu"],["ぎょ","gyo"],
      ["じゃ","ja"],["じゅ","ju"],["じょ","jo"],["びゃ","bya"],["びゅ","byu"],["びょ","byo"],
      ["ぴゃ","pya"],["ぴゅ","pyu"],["ぴょ","pyo"],
      // 片假名 yōon
      ["キャ","kya"],["キュ","kyu"],["キョ","kyo"],["シャ","sha"],["シュ","shu"],["ショ","sho"],
      ["チャ","cha"],["チュ","chu"],["チョ","cho"],["ニャ","nya"],["ニュ","nyu"],["ニョ","nyo"],
      ["ヒャ","hya"],["ヒュ","hyu"],["ヒョ","hyo"],["ミャ","mya"],["ミュ","myu"],["ミョ","myo"],
      ["リャ","rya"],["リュ","ryu"],["リョ","ryo"],["ギャ","gya"],["ギュ","gyu"],["ギョ","gyo"],
      ["ジャ","ja"],["ジュ","ju"],["ジョ","jo"],["ビャ","bya"],["ビュ","byu"],["ビョ","byo"],
      ["ピャ","pya"],["ピュ","pyu"],["ピョ","pyo"],
      // 基本音
      ["あ","a"],["い","i"],["う","u"],["え","e"],["お","o"],
      ["か","ka"],["き","ki"],["く","ku"],["け","ke"],["こ","ko"],
      ["さ","sa"],["し","shi"],["す","su"],["せ","se"],["そ","so"],
      ["た","ta"],["ち","chi"],["つ","tsu"],["て","te"],["と","to"],
      ["な","na"],["に","ni"],["ぬ","nu"],["ね","ne"],["の","no"],
      ["は","ha"],["ひ","hi"],["ふ","fu"],["へ","he"],["ほ","ho"],
      ["ま","ma"],["み","mi"],["む","mu"],["め","me"],["も","mo"],
      ["や","ya"],["ゆ","yu"],["よ","yo"],
      ["ら","ra"],["り","ri"],["る","ru"],["れ","re"],["ろ","ro"],
      ["わ","wa"],["を","wo"],["ん","n"],
      ["が","ga"],["ぎ","gi"],["ぐ","gu"],["げ","ge"],["ご","go"],
      ["ざ","za"],["じ","ji"],["ず","zu"],["ぜ","ze"],["ぞ","zo"],
      ["だ","da"],["ぢ","ji"],["づ","zu"],["で","de"],["ど","do"],
      ["ば","ba"],["び","bi"],["ぶ","bu"],["べ","be"],["ぼ","bo"],
      ["ぱ","pa"],["ぴ","pi"],["ぷ","pu"],["ぺ","pe"],["ぽ","po"],
      // 片假名基本
      ["ア","a"],["イ","i"],["ウ","u"],["エ","e"],["オ","o"],
      ["カ","ka"],["キ","ki"],["ク","ku"],["ケ","ke"],["コ","ko"],
      ["サ","sa"],["シ","shi"],["ス","su"],["セ","se"],["ソ","so"],
      ["タ","ta"],["チ","chi"],["ツ","tsu"],["テ","te"],["ト","to"],
      ["ナ","na"],["ニ","ni"],["ヌ","nu"],["ネ","ne"],["ノ","no"],
      ["ハ","ha"],["ヒ","hi"],["フ","fu"],["ヘ","he"],["ホ","ho"],
      ["マ","ma"],["ミ","mi"],["ム","mu"],["メ","me"],["モ","mo"],
      ["ヤ","ya"],["ユ","yu"],["ヨ","yo"],
      ["ラ","ra"],["リ","ri"],["ル","ru"],["レ","re"],["ロ","ro"],
      ["ワ","wa"],["ヲ","wo"],["ン","n"],
      ["ガ","ga"],["ギ","gi"],["グ","gu"],["ゲ","ge"],["ゴ","go"],
      ["ザ","za"],["ジ","ji"],["ズ","zu"],["ゼ","ze"],["ゾ","zo"],
      ["ダ","da"],["ヂ","ji"],["ヅ","zu"],["デ","de"],["ド","do"],
      ["バ","ba"],["ビ","bi"],["ブ","bu"],["ベ","be"],["ボ","bo"],
      ["パ","pa"],["ピ","pi"],["プ","pu"],["ペ","pe"],["ポ","po"],
      // 小文字
      ["ゃ","ya"],["ゅ","yu"],["ょ","yo"],["ャ","ya"],["ュ","yu"],["ョ","yo"],
      ["ぁ","a"],["ぃ","i"],["ぅ","u"],["ぇ","e"],["ぉ","o"],
      ["ァ","a"],["ィ","i"],["ゥ","u"],["ェ","e"],["ォ","o"],
      ["っ",""],["ッ",""],["ー","-"],["ヴ","vu"],
    ];
    var m = {};
    for (var i = 0; i < pairs.length; i++) m[pairs[i][0]] = pairs[i][1];
    return m;
  })();

  var _KANA_RE = new RegExp(Object.keys(_KANA_MAP).join('|'), 'g');
  var _CJK_RE = /[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/g;

  /**
   * 前端拼音映射表（常见汉字，体积控制在合理范围）
   * 对于未收录的汉字，回退到 Unicode 编码排序
   */
  var _PINYIN_TABLE = null; // 懒加载

  /**
   * 生成排序键：假名→罗马音，CJK 保持 Unicode 排序，拉丁转小写
   * 注意：前端的排序键主要用于 A-Z 分组首字母提取。
   * 精确排序已由后端 sortkey.js 完成。
   * @param {string} text
   * @returns {string}
   */
  utils.sortKey = function (text) {
    if (!text) return 'zzz';
    var s = String(text).trim();
    if (!s) return 'zzz';

    // 1. 假名 → 罗马音
    s = s.replace(_KANA_RE, function (m) { return _KANA_MAP[m] || m; });
    // 2. 转小写
    s = s.toLowerCase();
    // 3. 提取首字母用于分组
    return s;
  };

  /**
   * 从对象中获取预计算的排序键。
   * 优先使用后端计算的 sort_key / <field>_sort_key，
   * 回退到前端 sortKey()（仅假名转换，不含拼音）。
   * @param {object} item  曲目/专辑/艺术家对象
   * @param {string} sortKeyField  预计算排序键的字段名（如 'sort_key', 'artist_sort_key'）
   * @param {string} field  原始文本字段名（用于回退）
   * @returns {string}
   */
  utils.itemSortKey = function (item, sortKeyField, field) {
    if (!item || typeof item !== 'object') {
      return utils.sortKey(String(item || ''));
    }
    if (sortKeyField && item[sortKeyField]) {
      return item[sortKeyField];
    }
    return utils.sortKey(item[field] || '');
  };

  /**
   * 从对象中获取排序首字母（用于 A-Z 分组表头）。
   * 优先使用后端 sort_letter，回退到从排序键提取首字母。
   * @param {object} item  曲目/专辑/艺术家对象
   * @param {string} sortKeyField  预计算排序键的字段名
   * @param {string} field  原始文本字段名（用于回退）
   * @returns {string}  'A'-'Z' 或 '#'
   */
  utils.itemSortLetter = function (item, sortKeyField, field) {
    if (!item || typeof item !== 'object') {
      return utils.sortLetter(item);
    }
    if (item.sort_letter && (sortKeyField === 'sort_key' || !sortKeyField)) {
      return item.sort_letter;
    }
    var sk = utils.itemSortKey(item, sortKeyField, field);
    if (!sk || sk === 'zzz') return '#';
    var first = sk.charAt(0);
    if (first >= '0' && first <= '9') return '#';
    if (first >= 'a' && first <= 'z') return first.toUpperCase();
    return '#';
  };

  /**
   * 获取排序首字母（用于 A-Z 分组表头）
   * 优先使用后端返回的 sort_letter 字段，回退到前端假名转换
   * @param {string|object} textOrItem  字符串或包含 sort_letter 的对象
   * @returns {string}  'A'-'Z' 或 '#'
   */
  utils.sortLetter = function (textOrItem) {
    // 如果传入对象且包含 sort_letter，直接使用
    if (textOrItem && typeof textOrItem === 'object' && textOrItem.sort_letter) {
      return textOrItem.sort_letter;
    }
    var text = (typeof textOrItem === 'object') ? '' : textOrItem;
    var key = utils.sortKey(text);
    if (!key || key === 'zzz') return '#';
    var first = key.charAt(0);
    if (first >= '0' && first <= '9') return '#';
    if (first >= 'a' && first <= 'z') return first.toUpperCase();
    return '#';
  };

  /**
   * 将已排序的列表按首字母分组
   * @param {Array} items  已排序的数组（每个 item 可含 sort_letter 字段）
   * @param {Function} keyFn  从 item 提取用于分组的字符串（回退用）
   * @returns {Array<{letter:string, items:Array}>}
   */
  utils.groupByLetter = function (items, keyFn) {
    var groups = [];
    var current = null;
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      var letter;
      // 优先使用后端 sort_letter
      if (item && typeof item === 'object' && item.sort_letter) {
        letter = item.sort_letter;
      } else {
        letter = utils.sortLetter(keyFn ? keyFn(item) : item);
      }
      if (!current || current.letter !== letter) {
        current = { letter: letter, items: [] };
        groups.push(current);
      }
      current.items.push(item);
    }
    return groups;
  };

  // ── 搜索匹配工具（罗马音/拼音搜索支持）─────────────────────────────────────

  /**
   * 将字符串归一化为搜索键：假名→罗马音、转小写、去非字母数字。
   * 与后端 sortkey.js 的 makeSortKey 逻辑一致（前端不含拼音，拼音通过 sort_key 字段覆盖）。
   * @param {string} text
   * @returns {string}
   */
  utils.normalizeForSearch = function (text) {
    if (!text) return '';
    var s = String(text).trim();
    if (!s) return '';
    // 1. 假名 → 罗马音
    s = s.replace(_KANA_RE, function (m) { return _KANA_MAP[m] || m; });
    // 2. 转小写
    s = s.toLowerCase();
    // 3. 去非字母数字
    s = s.replace(/[^a-z0-9]/g, '');
    return s;
  };

  /**
   * 搜索词缓存（避免对同一查询词重复归一化）
   */
  var _searchQueryCache = {};

  /**
   * 检查曲目是否匹配搜索词。
   *
   * 匹配策略（双重匹配，缺一不可）：
   * A. 原始文本直接 includes — 保证输入本字（中文/日文原文）一定能搜到
   * B. 归一化匹配 — 支持罗马音搜日文、拼音搜中文
   *    - 后端预计算的 sort_key（包含假名→罗马音 + 汉字→拼音）
   *    - 前端实时归一化（假名→罗马音，覆盖没有 sort_key 的场景）
   *
   * @param {string} query  搜索词（已 trim + toLowerCase）
   * @param {object} track  曲目对象
   * @returns {boolean}
   */
  utils.matchTrack = function (query, track) {
    if (!query || !track) return false;

    // 归一化搜索词（假名转罗马音，去非字母数字）
    var normQuery = _searchQueryCache[query];
    if (normQuery === undefined) {
      normQuery = utils.normalizeForSearch(query);
      _searchQueryCache[query] = normQuery;
    }

    var fields = [
      { text: 'title',  key: 'sort_key',         textVal: track.title,  keyVal: track.sort_key },
      { text: 'artist', key: 'artist_sort_key',  textVal: track.artist, keyVal: track.artist_sort_key },
      { text: 'album',  key: 'album_sort_key',   textVal: track.album,  keyVal: track.album_sort_key },
    ];

    for (var i = 0; i < fields.length; i++) {
      var f = fields[i];

      // A. 原始文本直接匹配（保证本字搜索可用）
      if (f.textVal && f.textVal.toLowerCase().includes(query)) return true;

      // B. 归一化匹配（罗马音/拼音）
      if (normQuery) {
        if (f.keyVal) {
          if (f.keyVal.includes(normQuery)) return true;
        } else if (f.textVal) {
          if (utils.normalizeForSearch(f.textVal).includes(normQuery)) return true;
        }
      }
    }

    return false;
  };

  /**
   * 检查专辑/艺术家是否匹配搜索词。
   * 支持原始文本匹配（保证本字搜索）+ sort_key 匹配（假名/拼音）。
   * @param {string} query  搜索词（已 trim + toLowerCase）
   * @param {object} item  专辑或艺术家对象
   * @param {Array<{text:string, key:string}>} fields  要匹配的字段配置
   *   例如：[{text:'album', key:'sort_key'}, {text:'album_artist', key:'album_artist_sort_key'}]
   * @returns {boolean}
   */
  utils.matchItem = function (query, item, fields) {
    if (!query || !item) return false;

    var normQuery = _searchQueryCache[query];
    if (normQuery === undefined) {
      normQuery = utils.normalizeForSearch(query);
      _searchQueryCache[query] = normQuery;
    }

    for (var i = 0; i < fields.length; i++) {
      var f = fields[i];
      var textVal = item[f.text];
      var keyVal = item[f.key];

      // A. 原始文本直接匹配（保证本字搜索可用）
      if (textVal && textVal.toLowerCase().includes(query)) return true;

      // B. 归一化匹配（罗马音/拼音）
      if (normQuery) {
        if (keyVal) {
          if (keyVal.includes(normQuery)) return true;
        } else if (textVal) {
          if (utils.normalizeForSearch(textVal).includes(normQuery)) return true;
        }
      }
    }
    return false;
  };

  // ── DOM 构建工具 ───────────────────────────────────────────────────────────

  /**
   * 创建带有封面的迷你封面 div（用于曲目列表）
   * @param {object} track
   * @returns {HTMLElement}
   */
  utils.miniCover = function (track, size) {
    const div = document.createElement('div');
    div.className = 'track-mini-cover';
    if (track.has_cover) {
      const img = document.createElement('img');
      utils.loadCover(img, track.id, size);
      img.alt = '';
      img.loading = 'lazy';
      img.onerror = function () {
        div.innerHTML = `<span class="placeholder-letter">${utils.initial(track.album || track.title)}</span>`;
      };
      div.appendChild(img);
    } else {
      div.style.background = utils.hashColor(track.album || track.title || '');
      div.innerHTML = `<span class="placeholder-letter" style="color:rgba(255,255,255,0.9)">${utils.initial(track.album || track.title)}</span>`;
    }
    return div;
  };

  /**
   * 取字符串首字母（支持中文）
   * @param {string} str
   * @returns {string}
   */
  utils.initial = function (str) {
    if (!str) return '?';
    return str.trim()[0].toUpperCase();
  };

  /**
   * 创建一个曲目行 <li> 元素
   * @param {object}   track
   * @param {number}   index  1-based display number (e.g. metadata track number)
   * @param {Function} onClick  called as onClick(track, playIndex)
   * @param {boolean}  showMiniCover  use cover instead of number
   * @param {number}   [playIndex]  0-based playback position in the queue; defaults to index - 1
   * @returns {HTMLLIElement}
   */
  utils.trackRow = function (track, index, onClick, showMiniCover, playIndex, coverSize) {
    // playIndex が指定されなければ表示番号から推測する（従来互換）
    const playIdx = (typeof playIndex === 'number') ? playIndex : (index - 1);
    const li = document.createElement('li');
    li.className = 'track-row';
    li.dataset.trackId = track.id;
    li._trackData = track; // attach object for context menu

    if (App.state.currentTrack && App.state.currentTrack.id === track.id) {
      li.classList.add('playing');
    }

    // Number / cover cell
    const numCell = document.createElement('div');
    numCell.className = 'track-num';
    if (showMiniCover) {
      numCell.appendChild(utils.miniCover(track, coverSize || 128));
    } else {
      numCell.innerHTML = `
        <span class="track-num-text">${index}</span>
        <span class="material-symbols-rounded track-playing-icon icon-sm">graphic_eq</span>
      `;
    }

    // Body
    const body = document.createElement('div');
    body.className = 'track-body';
    const artist = track.artist || App.i18n.t('common.unknownArtist');
    const artists = track.artists || [artist];
    const firstArtist = artists[0];
    const album  = track.album  || '';
    const albumArtist = track.album_artist || artist;
    body.innerHTML = `
      <p class="track-title">${_esc(track.title || track.path || App.i18n.t('common.unknownTrack'))}</p>
      <p class="track-artist-album">
        <span class="track-link track-artist-link" data-artist="${_esc(firstArtist)}">${_esc(artist)}</span>
        ${album ? '<span class="track-link-sep"> · </span><span class="track-link track-album-link" data-album="' + _esc(album) + '" data-album-artist="' + _esc(albumArtist) + '">' + _esc(album) + '</span>' : ''}
      </p>
    `;

    const artistLink = body.querySelector('.track-artist-link');
    if (artistLink) {
      artistLink.addEventListener('click', function (e) {
        e.stopPropagation();
        if (App.navigate) App.navigate('artists', { artist: this.dataset.artist });
      });
    }
    const albumLink = body.querySelector('.track-album-link');
    if (albumLink) {
      albumLink.addEventListener('click', function (e) {
        e.stopPropagation();
        if (App.navigate) App.navigate('albums', { album: this.dataset.album, album_artist: this.dataset.albumArtist });
      });
    }

    // Duration
    const dur = document.createElement('div');
    dur.className = 'track-duration';
    dur.textContent = utils.formatDuration(track.duration_ms);

    li.appendChild(numCell);
    li.appendChild(body);
    li.appendChild(dur);

    // ── 多选 & 拖拽支持 ──────────────────────────────────────────
    // 阻止 Shift+click 的默认文本选中
    li.addEventListener('mousedown', function (e) {
      if (e.shiftKey) e.preventDefault();
    });

    li.addEventListener('click', function (e) {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        e.stopPropagation();
        App.selection.toggle(track, li);
        return;
      }
      if (e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        App.selection.selectRange(track, li);
        return;
      }
      // 普通点击：清除选中并播放
      App.selection.clear();
      onClick(track, playIdx);
    });

    // 拖拽到歌单
    li.setAttribute('draggable', 'true');
    li.addEventListener('dragstart', function (e) {
      // 如果拖拽的曲目不在当前选中集中，仅选中它
      if (!App.selection.isSelected(track.id)) {
        App.selection.selectOnly(track, li);
      }
      var ids = App.selection.getSelectedIds();
      if (ids.length === 0) ids = [track.id];
      e.dataTransfer.setData('text/plain', JSON.stringify(ids));
      e.dataTransfer.effectAllowed = 'copy';
      // 自动打开歌单副菜单，供用户拖入
      if (App.playlists && App.playlists.openSubmenu) {
        App.playlists.openSubmenu();
        App._dragOpenedSubmenu = true;
      }
    });
    li.addEventListener('dragend', function () {
      if (App._dragOpenedSubmenu) {
        var t = setTimeout(function () {
          if (App.playlists && App.playlists.closeSubmenu) {
            App.playlists.closeSubmenu();
          }
          App._dragOpenedSubmenu = false;
        }, 200);
        App._dragCloseTimer = t;
      }
    });

    return li;
  };

  // ── 全局选择管理器 ───────────────────────────────────────────────────────
  // 管理 .track-row 的多选状态（Ctrl/Shift），供右键菜单和拖拽使用。
  utils.selection = App.selection = {
    _selectedIds: new Set(),
    _lastClickedLi: null,
    _activeList: null,

    /** 清除所有选中 */
    clear: function () {
      this._selectedIds.clear();
      this._lastClickedLi = null;
      this._activeList = null;
      document.querySelectorAll('.track-row.selected').forEach(function (el) {
        el.classList.remove('selected');
      });
    },

    /** 检查某曲目是否已选中 */
    isSelected: function (trackId) {
      return this._selectedIds.has(trackId);
    },

    /** 当前选中数量 */
    size: function () {
      return this._selectedIds.size;
    },

    /** Ctrl+click：切换选中 */
    toggle: function (track, li) {
      var ul = li.parentElement;
      if (this._activeList !== ul) {
        this.clear();
        this._activeList = ul;
      }
      if (this._selectedIds.has(track.id)) {
        this._selectedIds.delete(track.id);
        li.classList.remove('selected');
      } else {
        this._selectedIds.add(track.id);
        li.classList.add('selected');
      }
      this._lastClickedLi = li;
    },

    /** Shift+click：范围选中 */
    selectRange: function (track, li) {
      var ul = li.parentElement;
      if (!ul) return;
      if (this._activeList !== ul) {
        this.clear();
        this._activeList = ul;
      }
      var rows = Array.prototype.filter.call(ul.children, function (r) {
        return r._trackData;
      });
      var startIdx = -1, endIdx = -1;
      if (this._lastClickedLi && this._lastClickedLi.parentElement === ul) {
        startIdx = rows.indexOf(this._lastClickedLi);
      }
      endIdx = rows.indexOf(li);
      if (startIdx === -1) startIdx = endIdx;
      if (startIdx > endIdx) { var tmp = startIdx; startIdx = endIdx; endIdx = tmp; }
      for (var i = startIdx; i <= endIdx; i++) {
        var row = rows[i];
        if (row && row._trackData) {
          this._selectedIds.add(row._trackData.id);
          row.classList.add('selected');
        }
      }
    },

    /** 仅选中一个曲目（拖拽时使用） */
    selectOnly: function (track, li) {
      this.clear();
      var ul = li.parentElement;
      this._activeList = ul;
      this._selectedIds.add(track.id);
      li.classList.add('selected');
      this._lastClickedLi = li;
    },

    /** 获取选中曲目的 ID 数组 */
    getSelectedIds: function () {
      return Array.from(this._selectedIds);
    },

    /** 获取选中曲目的对象数组（按 DOM 顺序） */
    getSelectedTracks: function () {
      var tracks = [];
      if (!this._activeList) return tracks;
      var rows = this._activeList.children;
      for (var i = 0; i < rows.length; i++) {
        if (rows[i]._trackData && this._selectedIds.has(rows[i]._trackData.id)) {
          tracks.push(rows[i]._trackData);
        }
      }
      return tracks;
    },
  };

  // ── Escape HTML ────────────────────────────────────────────────────────────

  function _esc(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
  utils.esc = _esc;

  // ── LRC utilities ─────────────────────────────────────────────

  /**
   * 检测文本是否包含 LRC 时间戳
   */
  utils.isLRC = function (text) {
    // 小数部分（.xx / .xxx）可选；缺失时按 .000 处理
    return /\[\d{2}:\d{2}(?:[\.:]\d{2,3})?\]/.test(text);
  };

  /**
   * 将纯文本歌词（无时间戳）按换行拆分为段落
   */
  utils.parseStaticLyrics = function (text) {
    if (!text) return [];
    var lines = [];
    var parts = text.split('\n');
    for (var i = 0; i < parts.length; i++) {
      var t = parts[i].trim();
      if (t) lines.push(t);
    }
    return lines.length > 0 ? lines : [];
  };

  // ── Lyrics credit extractor ────────────────────────────────────

  /**
   * 从歌词开头提取制作信息（作词/作曲/制作人等），返回处理后的歌词和提取的 credits。
   *
   * @param {string} lyricsText  原始歌词文本（LRC 或纯文本）
   * @param {string} filterWordsStr  逗号分隔的筛选词，如 "作词,作曲,制作人"
   * @returns {{ lyrics: string, credits: string }} 处理后的歌词文本 + credits 文本（无 credits 时为空串）
   */
  utils.processLyricsCredits = function (lyricsText, filterWordsStr) {
    var empty = { lyrics: lyricsText || '', credits: '' };
    if (!lyricsText) return empty;

    // 如果未传入筛选词，使用内置默认值
    if (!filterWordsStr) {
      filterWordsStr = '作词,作曲,编曲,和声,对唱,配唱制作人,钢琴,吉他,鼓,贝斯,制作人,制作,混音,混音师,混音室,母带,录音,录音师,录音室,监制,策划,发行,词曲,填词,谱曲,OP,ED,SP';
    }

    // 解析筛选词，按长度降序排列（避免"制作"匹配到"制作人"的情况）
    var words = filterWordsStr
      .split(/[,，]/)
      .map(function (w) { return w.trim(); })
      .filter(function (w) { return w.length > 0; })
      .sort(function (a, b) { return b.length - a.length; });

    if (words.length === 0) return empty;

    // 转义正则特殊字符
    var escaped = words.map(function (w) {
      return w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    });
    // 匹配 "关键词:值" 或 "关键词：值"，允许关键词前后有空白
    // 增强 LRC（逐字歌词）剥离 <mm:ss.xx> 标签后，行首可能残留空白，故 ^ 后加 \s*
    var creditRegex = new RegExp('^\\s*(' + escaped.join('|') + ')\\s*[：:]', 'g');

    var lines = lyricsText.split('\n');
    var creditNames = [];
    var normalLines = [];
    var creditPhase = true;

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      var trimmed = line.trim();

      // 空行
      if (!trimmed) {
        if (!creditPhase) normalLines.push(line);
        continue;
      }

      // 提取时间戳（仅用于判断是否是 LRC 行，不用于 credits 时间戳）
      // 小数部分可选
      var timeMatch = trimmed.match(/\[(\d{2}):(\d{2})(?:[\.:](\d{2,3}))?\]/);
      var textContent = trimmed;
      if (timeMatch) {
        textContent = trimmed.substring(timeMatch.index + timeMatch[0].length).trim();
      }

      // 增强 LRC（逐字时间戳）行内嵌 <mm:ss.xx> 标签，会插在「关键词」与「：」之间，
      // 导致普通正则无法命中。统一剥离这些标签，还原纯文本用于 credits 判定与取值。
      var plainContent = textContent.replace(/<\d{2}:\d{2}[\.:]\d{2,3}>/g, '');

      // LRC 元数据行（如 [ti:...]、[ar:...]）— 不结束 creditPhase
      if (!timeMatch && /^\[[a-zA-Z]+:/.test(trimmed)) {
        if (!creditPhase) normalLines.push(line);
        continue;
      }

      // 纯时间戳行（无文本内容，或仅剩逐字标签）
      if (!plainContent) {
        if (!creditPhase) normalLines.push(line);
        continue;
      }

      // 检查是否包含 credit 关键词
      creditRegex.lastIndex = 0;
      var matches = [];
      var cm;
      while ((cm = creditRegex.exec(plainContent)) !== null) {
        matches.push({ index: cm.index, end: cm.index + cm[0].length });
      }

      if (matches.length > 0 && creditPhase) {
        // 提取每个关键词后面的值
        for (var j = 0; j < matches.length; j++) {
          var valStart = matches[j].end;
          var valEnd = (j + 1 < matches.length) ? matches[j + 1].index : plainContent.length;
          var value = plainContent.substring(valStart, valEnd).trim();
          // 去除尾部分隔符
          value = value.replace(/[、,，\/\s]+$/, '');
          if (value) {
            var nameList = value
              .split(/[、,，\/]/)
              .map(function (n) { return n.trim(); })
              .filter(function (n) { return n.length > 0; });
            creditNames = creditNames.concat(nameList);
          }
        }
        // 跳过此行（不加入 normalLines）
        continue;
      }

      // 非 credit 行 → 退出 creditPhase
      creditPhase = false;
      normalLines.push(line);
    }

    // 没有提取到任何 credit → 原样返回
    if (creditNames.length === 0) return empty;

    // 去重（保持顺序）
    var seen = {};
    var uniqueNames = [];
    for (var k = 0; k < creditNames.length; k++) {
      if (!seen[creditNames[k]]) {
        seen[creditNames[k]] = true;
        uniqueNames.push(creditNames[k]);
      }
    }

    return {
      lyrics: normalLines.join('\n'),
      credits: 'Written By：' + uniqueNames.join('、'),
    };
  };

  // ── LRC parser ───────────────────────────────────────────────

  /**
   * 解析增强 LRC 行内逐字时间戳
   * @param {string} text 去掉行首 [mm:ss.xx] 后的文本
   * @returns {{text:string, words:Array<{start:number,end:number,text:string}>|undefined}}
   */
  function _parseLRCWords(text) {
    var wordRegex = /<(\d{2}):(\d{2})[\.:](\d{2,3})>([^<]*)/g;
    var segments = [];
    var match;
    wordRegex.lastIndex = 0;
    while ((match = wordRegex.exec(text)) !== null) {
      var wm = parseInt(match[1], 10);
      var ws = parseInt(match[2], 10);
      var wcs = parseInt(match[3], 10);
      if (match[3].length === 2) wcs *= 10;
      segments.push({
        time: wm * 60000 + ws * 1000 + wcs,
        text: match[4],
      });
    }
    if (segments.length === 0) {
      return { text: text };
    }

    var words = [];
    for (var i = 0; i < segments.length; i++) {
      var seg = segments[i];
      // 行尾单独的时间标签作为整行结束标记，不生成空字
      if (seg.text === '' && i === segments.length - 1) {
        if (words.length > 0) {
          words[words.length - 1].end = seg.time;
        }
        continue;
      }
      words.push({
        start: seg.time,
        end: (i + 1 < segments.length) ? segments[i + 1].time : seg.time,
        text: seg.text,
      });
    }

    var plain = words.map(function (w) { return w.text; }).join('');
    return { text: plain, words: words };
  }

  /**
   * 解析 LRC 歌词文本为带时间戳的数组
   * 同时间戳的多行自动配对：1行=原文、2行=原文+翻译、3行=原文+罗马音+翻译
   * 支持增强 LRC（逐字时间戳）与普通行级 LRC 混排
   * @param {string} lrcText
   * @returns {Array<{time:number, text:string, words?:Array, romaji?:string, romajiWords?:Array, translation?:string, translationWords?:Array}>}
   */
  utils.parseLRC = function (lrcText) {
    if (!lrcText || typeof lrcText !== 'string') return [];
    var lines = lrcText.split('\n');
    var entries = [];
    // 小数部分（.xx / .xxx）可选；缺失时按 .000 处理
    var timeRegex = /\[(\d{2}):(\d{2})(?:[\.:](\d{2,3}))?\]/g;

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (!line) continue;

      var match;
      var lastIdx = 0;
      var times = [];
      timeRegex.lastIndex = 0;

      while ((match = timeRegex.exec(line)) !== null) {
        var m = parseInt(match[1], 10);
        var s = parseInt(match[2], 10);
        var cs = 0;
        if (match[3] !== undefined) {
          cs = parseInt(match[3], 10);
          if (match[3].length === 2) cs *= 10;
        }
        times.push(m * 60000 + s * 1000 + cs);
        lastIdx = match.index + match[0].length;
      }

      if (times.length > 0) {
        var rawText = line.substring(lastIdx).trim();
        var parsed = _parseLRCWords(rawText);
        for (var t = 0; t < times.length; t++) {
          var entry = { time: times[t], text: parsed.text };
          if (parsed.words) entry.words = parsed.words;
          entries.push(entry);
        }
      }
    }

    // 按时间排序
    entries.sort(function (a, b) { return a.time - b.time; });

    // 同时间戳分组（差距 ≤ 30ms）
    // 1行: text のみ
    // 2行: text + translation
    // 3行: text + romaji + translation
    var grouped = [];
    var k = 0;
    while (k < entries.length) {
      var cluster = [entries[k]];
      var j = k + 1;
      while (j < entries.length && Math.abs(entries[j].time - entries[k].time) <= 30) {
        cluster.push(entries[j]);
        j++;
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
  };

  // ── Cursor avoidance ────────────────────────────────────────

  /**
   * 为按钮添加光标避让效果：鼠标靠近时按钮自动远离
   * @param {HTMLElement} btn
   * @param {number}      threshold  触发距离（px），默认 42
   */
  utils.setupAvoidance = function (btn, threshold) {
    if (!btn) return;
    threshold = threshold || 42;
    var rafId = null;

    btn.addEventListener('mousemove', function (e) {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(function () {
        var rect = btn.getBoundingClientRect();
        var cx = rect.left + rect.width / 2;
        var cy = rect.top + rect.height / 2;
        var dx = e.clientX - cx;
        var dy = e.clientY - cy;
        var dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < threshold) {
          var strength = (threshold - dist) / threshold;
          var moveX = -dx * strength * 0.7;
          var moveY = -dy * strength * 0.7;
          btn.style.transform = 'translate(' + moveX + 'px, ' + moveY + 'px)';
        } else {
          btn.style.transform = '';
        }
      });
    });

    btn.addEventListener('mouseleave', function () {
      if (rafId) cancelAnimationFrame(rafId);
      btn.style.transform = '';
    });
  };

  // ── Play/Pause icon squeeze animation ─────────────────────────────────────

  /**
   * 播放/暂停图标切换动画：图标水平挤压 → 文字替换 → 弹回
   * @param {HTMLElement} iconEl   图标 <span> 元素
   * @param {string}      newText  替换后的文字 ('pause' | 'play_arrow')
   */
  utils.squeezeIcon = function (iconEl, newText) {
    if (!iconEl || !iconEl.animate) {
      if (iconEl) iconEl.textContent = newText;
      return;
    }
    // 取消上一次未完成的动画
    if (iconEl._squeezeAnim) iconEl._squeezeAnim.cancel();
    if (iconEl._squeezeTimer) clearTimeout(iconEl._squeezeTimer);

    var DURATION = 320;
    var SWAP_MS  = 110;   // 挤压到最窄时替换文字

    var anim = iconEl.animate([
      { transform: 'scaleX(1)'    },
      { transform: 'scaleX(0.12)' },
      { transform: 'scaleX(1.12)' },
      { transform: 'scaleX(1)'    }
    ], {
      duration: DURATION,
      easing: 'cubic-bezier(0.2, 0, 0, 1)'
    });

    iconEl._squeezeTimer = setTimeout(function () {
      iconEl.textContent = newText;
    }, SWAP_MS);

    iconEl._squeezeAnim = anim;
  };

  /**
   * 播放按钮 bloom 动画：按钮短暂变宽推开两侧按钮再回弹
   * 与圆角变化同步，营造形变推挤的弹性感
   * @param {HTMLElement} btnEl  按钮元素
   */
  utils.bloomButton = function (btnEl) {
    if (!btnEl || !btnEl.animate) return;
    if (btnEl._bloomAnim) btnEl._bloomAnim.cancel();

    // 检测按钮类型以确定动画属性和基准尺寸
    var isFlexBasis = btnEl.classList.contains('np-play-pill');
    var prop  = isFlexBasis ? 'flexBasis' : 'width';
    var base  = isFlexBasis ? 96 : 88;
    var peak  = base + 14;

    var k0 = {}, k1 = {}, k2 = {};
    k0[prop] = base + 'px';
    k1[prop] = peak + 'px';
    k2[prop] = base + 'px';

    btnEl._bloomAnim = btnEl.animate([k0, k1, k2], {
      duration: 320,
      easing: 'cubic-bezier(0.2, 0, 0, 1)'
    });
  };

  // 点击空白处清除选中
  document.addEventListener('mousedown', function (e) {
    if (e.target.closest('.track-row')) return;
    if (e.target.closest('.context-menu-container')) return;
    if (e.target.closest('.context-submenu')) return;
    if (e.target.closest('.cmd-dialog')) return;
    if (e.target.closest('.nav-submenu')) return;
    if (App.selection && App.selection.size() > 0) {
      App.selection.clear();
    }
  });

  // ── Backend call helper ────────────────────────────────────────────────────

  /**
   * 调用后端 slot 并返回 Promise，用于支持异步写法
   * @param {string}    method   backend method name
   * @param {...*}      args     arguments (last is treated as callback by Qt)
   * @returns {Promise<*>}
   */
  utils.call = function (method, ...args) {
    return new Promise(function (resolve) {
      App.backend[method](...args, resolve);
    });
  };

  // ── 确认对话框 ──────────────────────────────────────────────────────────────
  /**
   * 轻量 Material 风格确认对话框，返回 Promise<boolean>（true=确认）。
   * @param {object} opts {title, body, confirmText, cancelText}
   */
  utils.confirmDialog = function (opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      var overlay = document.createElement('div');
      overlay.className = 'cmd-dialog-overlay';
      var dlg = document.createElement('div');
      dlg.className = 'cmd-dialog';
      var titleEl = document.createElement('div');
      titleEl.className = 'cmd-dialog-title';
      titleEl.textContent = opts.title || '';
      var bodyEl = document.createElement('div');
      bodyEl.className = 'cmd-dialog-body';
      bodyEl.textContent = opts.body || '';
      var actions = document.createElement('div');
      actions.className = 'cmd-dialog-actions';
      var cancelBtn = document.createElement('button');
      cancelBtn.className = 'cmd-dialog-btn cmd-dialog-btn--cancel';
      cancelBtn.textContent = opts.cancelText || App.i18n.t('common.cancel');
      var confirmBtn = document.createElement('button');
      confirmBtn.className = 'cmd-dialog-btn cmd-dialog-btn--confirm';
      confirmBtn.textContent = opts.confirmText || App.i18n.t('common.confirm');
      actions.appendChild(cancelBtn);
      actions.appendChild(confirmBtn);
      dlg.appendChild(titleEl);
      dlg.appendChild(bodyEl);
      dlg.appendChild(actions);
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
      overlay.addEventListener('click', function (e) {
        if (e.target === overlay) close(false);
      });
      document.addEventListener('keydown', onKey);
      // 自动聚焦确认按钮以便回车确认
      setTimeout(function () { confirmBtn.focus(); }, 50);
    });
  };

  // ── 独占模式切换确认 ─────────────────────────────────────────────────────────
  /**
   * 弹出 WASAPI 独占模式切换确认对话框。
   * @param {boolean} targetOn  目标状态（true=切到独占）
   * @returns {Promise<boolean>} 用户是否确认
   */
  utils.confirmExclusiveSwitch = function (targetOn) {
    if (targetOn) {
      return utils.confirmDialog({
        title: App.i18n.t('audio.switchExclusiveTitle'),
        body: App.i18n.t('audio.switchExclusiveBody'),
        confirmText: App.i18n.t('audio.switchExclusiveConfirm'),
        cancelText: App.i18n.t('common.cancel'),
      });
    }
    return utils.confirmDialog({
      title: App.i18n.t('audio.switchSharedTitle'),
      body: App.i18n.t('audio.switchSharedBody'),
      confirmText: App.i18n.t('audio.switchSharedConfirm'),
      cancelText: App.i18n.t('common.cancel'),
    });
  };

  // ── 歌词滚动动画 ──────────────────────────────────────────────────────────
  // 目标：快速、自然、行与行之间陆续跟进的"拉行"感。
  // - animateLyricsScroll：rAF 自定义缓动滚动，只有很轻的过冲收尾，
  //   保留 Apple Music 风格的柔和弹性，同时避免明显的来回弹跳。
  //   若传入歌词行间隔，动画时长随间隔增加而增加，短句更快跟进。
  // - cascadeLyricLines：按与激活行的距离设置递增 transition-delay，
  //   让各行状态变化（透明度/颜色/模糊）以激活行为中心向外波纹式扩散，
  //   形成"一行跟着一行"的级联感。纯 CSS 延迟，无 reflow / 无位移硬切。

  var _lyricsScrollRafs = (typeof WeakMap !== 'undefined') ? new WeakMap() : null;

  /**
   * 弹性滚动歌词容器到目标位置（替代原生 behavior:'smooth'）
   * @param {HTMLElement} wrapEl  滚动容器
   * @param {number} targetTop    目标 scrollTop
   * @param {number} [lineGapMs]  当前行与上一行的时间间隔（毫秒）
   */
  utils.animateLyricsScroll = function (wrapEl, targetTop, lineGapMs) {
    if (!wrapEl) return;
    utils.cancelLyricsScroll(wrapEl);

    var start = wrapEl.scrollTop;
    var dist = targetTop - start;
    if (Math.abs(dist) < 2) { wrapEl.scrollTop = targetTop; return; }

    var absDist = Math.abs(dist);
    // 没有歌词时间信息时按滚动距离兜底，同样限制在 50~175ms。
    var dur = Math.max(50, Math.min(175, 50 + absDist * 0.25));
    if (typeof lineGapMs === 'number' && isFinite(lineGapMs)) {
      // 50~175ms：歌词间隔越小，滚动越快；长间隔保留舒缓的跟随感。
      dur = Math.max(50, Math.min(175, 50 + Math.max(0, lineGapMs) * 0.1));
    }
    // 可感知但克制的过冲：距离越大过冲越小，避免长距离跳动。
    // 相比原来的 1.0 / 1.25，峰值回弹约为 1.3%~2.2%。
    var c1 = absDist > 300 ? 0.60 : 0.78;
    var c3 = c1 + 1;
    var t0 = performance.now();

    var frame = function (now) {
      var t = Math.min((now - t0) / dur, 1);
      var e = 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
      wrapEl.scrollTop = start + dist * e;
      if (t < 1) {
        var raf = requestAnimationFrame(frame);
        if (_lyricsScrollRafs) _lyricsScrollRafs.set(wrapEl, raf);
      } else if (_lyricsScrollRafs) {
        _lyricsScrollRafs.delete(wrapEl);
      }
    };
    var first = requestAnimationFrame(frame);
    if (_lyricsScrollRafs) _lyricsScrollRafs.set(wrapEl, first);
  };

  /** 取消进行中的歌词弹性滚动（切歌/重渲染时调用） */
  utils.cancelLyricsScroll = function (wrapEl) {
    if (!wrapEl || !_lyricsScrollRafs) return;
    var prev = _lyricsScrollRafs.get(wrapEl);
    if (prev) cancelAnimationFrame(prev);
    _lyricsScrollRafs.delete(wrapEl);
  };

  /**
   * 歌词行级联：以激活行为中心，按行距设置递增 transition-delay，
   * 让各行状态（透明度/颜色/模糊/字重）变化以波纹式向外扩散，
   * 形成"一行跟着一行往下走"的级联拖尾感。纯 CSS 延迟，无 reflow。
   * @param {NodeList|Array} lines  .np-lyrics-line 列表
   * @param {number} activeIdx      当前激活行索引
   * @param {number} prevIdx        上一激活行索引（保留参数兼容，当前未使用）
   */
  utils.cascadeLyricLines = function (lines, activeIdx, prevIdx) {
    if (!lines || !lines.length) return;
    var i, line, d;
    for (i = 0; i < lines.length; i++) {
      line = lines[i];
      if (line.classList.contains('np-lyrics-static')) continue;
      d = Math.abs(i - activeIdx);
      // 近处行几乎立刻过渡，远处行递增延迟，封顶 90ms 保持紧凑
      var delay = Math.min(d * 18, 90);
      line.style.transitionDelay = delay + 'ms';
      line.style.setProperty('--lyrics-lift-delay', delay + 'ms');

      // 只对当前行附近触发上提，避免长歌词列表每次切行都创建大量动画。
      line.classList.remove('np-lyrics-lift');
      if (d <= 3) {
        // 强制读取一次布局，确保同一行再次切换时动画能够重新开始。
        void line.offsetWidth;
        line.classList.add('np-lyrics-lift');
      }
    }
  };

  // ── Toast 轻提示 ──────────────────────────────────────────────────────────
  /**
   * 底部短暂浮层提示，3 秒后自动消失。
   * @param {string} msg  提示文本
   */
  utils.toast = function (msg) {
    if (!msg) return;
    var existing = document.querySelector('.toast-snackbar');
    if (existing) existing.remove();
    var el = document.createElement('div');
    el.className = 'toast-snackbar';
    el.textContent = msg;
    document.body.appendChild(el);
    requestAnimationFrame(function () { el.classList.add('show'); });
    setTimeout(function () {
      el.classList.remove('show');
      setTimeout(function () {
        if (el.parentNode) el.parentNode.removeChild(el);
      }, 250);
    }, 3000);
  };

})();
