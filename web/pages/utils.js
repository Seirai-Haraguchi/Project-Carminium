(function () {
  'use strict';

  window.App = window.App || {};

  const utils = {};
  window.App.utils = utils;


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

  utils.formatDate = function (ts) {
    if (!ts) return '—';
    return new Date(ts * 1000).toLocaleDateString('zh-CN', {
      year: 'numeric', month: 'long', day: 'numeric',
    });
  };


  utils.hashColor = function (str) {
    if (!str) return 'hsl(240, 40%, 60%)';
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    const hue = ((hash % 360) + 360) % 360;
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
    const width = canvas.width = 64;
    const height = canvas.height = 64;

    ctx.drawImage(imgEl, 0, 0, width, height);
    try {
      const data = ctx.getImageData(0, 0, width, height).data;
      let maxScore = -1;
      let bestPixel = [128, 128, 128];

      for (let i = 0; i < data.length; i += 4) {
        const r = data[i], g = data[i+1], b = data[i+2], a = data[i+3];
        if (a < 128) continue;
        const [h, s, l] = rgbToHsl(r, g, b);
        
        if (l < 10 || l > 90) continue;
        
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

  // ── 日语字段字体 ──────────────────────────────────────────────
  // 规则与「日语歌词字体」一致：字体族取 lyrics_jp_font（留空则用默认日文
  // 字体栈），判定依据是假名区段。实现方式是把该字体族注册成一个只覆盖假名
  // 区段的 @font-face，挂在 --ui-font 之前：含假名的字符自动落到日语字体，
  // 其余字符继续走界面字体，不需要逐个 DOM 打标记。
  var JP_UI_FAMILY = 'Carminium JP UI';
  var JP_UI_DEFAULT_STACK = ['Yu Gothic UI', 'Yu Gothic', 'Hiragino Kaku Gothic ProN', 'Meiryo', 'MS PGothic'];
  var JP_UI_UNICODE_RANGE = 'U+3040-309F, U+30A0-30FF, U+31F0-31FF, U+FF66-FF9D';
  var _jpUiEnabled = false;
  var _jpUiFont = '';
  var _jpUiStyleEl = null;

  function _splitFontFamilies(list) {
    return String(list || '')
      .split(',')
      .map(function (f) { return f.trim().replace(/^['"]+|['"]+$/g, '').trim(); })
      .filter(Boolean);
  }

  // enabled / fontList 传 null/undefined 表示「保持原值」，便于只更新其中一项
  utils.applyJpUiFont = function (enabled, fontList) {
    if (enabled !== undefined && enabled !== null) _jpUiEnabled = !!enabled;
    if (fontList !== undefined && fontList !== null) _jpUiFont = String(fontList);
    var root = document.documentElement;
    if (!root) return;

    if (!_jpUiStyleEl) {
      _jpUiStyleEl = document.createElement('style');
      _jpUiStyleEl.id = 'jp-ui-font-face';
      (document.head || root).appendChild(_jpUiStyleEl);
    }

    root.classList.toggle('jp-ui-font', _jpUiEnabled);
    if (!_jpUiEnabled) {
      _jpUiStyleEl.textContent = '';
      return;
    }

    var families = _splitFontFamilies(_jpUiFont);
    if (!families.length) families = JP_UI_DEFAULT_STACK;
    var src = families.map(function (f) {
      return "local('" + f.replace(/[\\']/g, '') + "')";
    }).join(', ');
    _jpUiStyleEl.textContent =
      '@font-face { font-family: "' + JP_UI_FAMILY + '"; font-style: normal;' +
      ' font-weight: 100 900; src: ' + src + ';' +
      ' unicode-range: ' + JP_UI_UNICODE_RANGE + '; }';
  };

  // 取色规范版本：'2021'（Material You 原始规范）或 '2025'（Material 3 Expressive）。
  // 2021 沿用原先的 HSL 近似实现以保持既有观感；2025 走 HCT 精确实现
  // （web/color/color_spec.js），两者可随时切换。
  utils.applyDynamicTheme = function(rgb, scheme, spec) {
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
        '--md-primary-vd', '--md-on-primary-vd', '--md-primary-container-vd', '--md-on-primary-container-vd',
        '--md-secondary-vd', '--md-on-secondary-vd', '--md-secondary-container-vd', '--md-on-secondary-container-vd',
        '--md-tertiary-vd', '--md-on-tertiary-vd', '--md-tertiary-container-vd', '--md-on-tertiary-container-vd',
        '--md-background-vd', '--md-surface-vd', '--md-surface-dim-vd', '--md-surface-bright-vd',
        '--md-surface-container-lowest-vd', '--md-surface-container-low-vd', '--md-surface-container-vd',
        '--md-surface-container-high-vd', '--md-surface-container-highest-vd',
        '--md-outline-variant-vd',
      ];
      for (var pi = 0; pi < props.length; pi++) root.style.removeProperty(props[pi]);
      return;
    }

    var schemeName = scheme || (window.App && App.state && App.state.colorScheme) || 'tonal_spot';
    var specVersion = spec ||
      (window.App && App.state && App.state.colorSpec) || '2021';

    if (specVersion === '2025' && window.AppColorSpec) {
      var isDarkTheme = root.getAttribute('data-theme') === 'dark';
      var roles = AppColorSpec.generate(rgb,
        { variant: schemeName, isDark: isDarkTheme, spec: '2025' });
      AppColorSpec.apply(roles, root, '');
      // -vd 是"强制深色"的并行令牌（侧栏/底栏等固定深色区域）
      var rolesDark = isDarkTheme ? roles : AppColorSpec.generate(rgb,
        { variant: schemeName, isDark: true, spec: '2025' });
      AppColorSpec.apply(rolesDark, root, '-vd');
      return;
    }

    var sc = COLOR_SCHEMES[schemeName] || COLOR_SCHEMES.tonal_spot;

    var isDark = root.getAttribute('data-theme') === 'dark';
    var hsl = rgbToHsl(rgb[0], rgb[1], rgb[2]);
    var h = hsl[0], s = hsl[1];

    var h1 = (h + sc.h1 + 360) % 360;
    var h2 = (h + sc.h2 + 360) % 360;
    var h3 = (h + sc.h3 + 360) % 360;

    var sat = _chroma(sc.chroma, s);
    var sat2 = Math.max(sc.sMin, Math.round(sat * sc.sScale));
    var sat3 = Math.max(sc.tMin, Math.round(sat * sc.tScale));

    root.style.setProperty('--md-primary', 'hsl(' + h1 + ', ' + sat + '%, ' + (isDark ? 80 : 40) + '%)');
    root.style.setProperty('--md-on-primary', 'hsl(' + h1 + ', ' + sat + '%, ' + (isDark ? 20 : 100) + '%)');
    root.style.setProperty('--md-primary-container', 'hsl(' + h1 + ', ' + sat + '%, ' + (isDark ? 20 : 92) + '%)');
    root.style.setProperty('--md-on-primary-container', 'hsl(' + h1 + ', ' + sat + '%, ' + (isDark ? 92 : 10) + '%)');

    root.style.setProperty('--md-secondary', 'hsl(' + h2 + ', ' + sat2 + '%, ' + (isDark ? 75 : 37) + '%)');
    root.style.setProperty('--md-on-secondary', 'hsl(' + h2 + ', ' + sat2 + '%, ' + (isDark ? 18 : 100) + '%)');
    root.style.setProperty('--md-secondary-container', 'hsl(' + h2 + ', ' + sat2 + '%, ' + (isDark ? 22 : 90) + '%)');
    root.style.setProperty('--md-on-secondary-container', 'hsl(' + h2 + ', ' + sat2 + '%, ' + (isDark ? 90 : 12) + '%)');

    root.style.setProperty('--md-tertiary', 'hsl(' + h3 + ', ' + sat3 + '%, ' + (isDark ? 78 : 36) + '%)');
    root.style.setProperty('--md-on-tertiary', 'hsl(' + h3 + ', ' + sat3 + '%, ' + (isDark ? 20 : 100) + '%)');
    root.style.setProperty('--md-tertiary-container', 'hsl(' + h3 + ', ' + sat3 + '%, ' + (isDark ? 24 : 88) + '%)');
    root.style.setProperty('--md-on-tertiary-container', 'hsl(' + h3 + ', ' + sat3 + '%, ' + (isDark ? 86 : 14) + '%)');

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

    root.style.setProperty('--md-outline-variant', 'hsl(' + h1 + ', ' + Math.max(0, bgSat - 2) + '%, ' + (isDark ? 22 : 88) + '%)');

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
  };


  var _KANA_MAP = (function () {
    var pairs = [
      ["きゃ","kya"],["きゅ","kyu"],["きょ","kyo"],["しゃ","sha"],["しゅ","shu"],["しょ","sho"],
      ["ちゃ","cha"],["ちゅ","chu"],["ちょ","cho"],["にゃ","nya"],["にゅ","nyu"],["にょ","nyo"],
      ["ひゃ","hya"],["ひゅ","hyu"],["ひょ","hyo"],["みゃ","mya"],["みゅ","myu"],["みょ","myo"],
      ["りゃ","rya"],["りゅ","ryu"],["りょ","ryo"],["ぎゃ","gya"],["ぎゅ","gyu"],["ぎょ","gyo"],
      ["じゃ","ja"],["じゅ","ju"],["じょ","jo"],["びゃ","bya"],["びゅ","byu"],["びょ","byo"],
      ["ぴゃ","pya"],["ぴゅ","pyu"],["ぴょ","pyo"],
      ["キャ","kya"],["キュ","kyu"],["キョ","kyo"],["シャ","sha"],["シュ","shu"],["ショ","sho"],
      ["チャ","cha"],["チュ","chu"],["チョ","cho"],["ニャ","nya"],["ニュ","nyu"],["ニョ","nyo"],
      ["ヒャ","hya"],["ヒュ","hyu"],["ヒョ","hyo"],["ミャ","mya"],["ミュ","myu"],["ミョ","myo"],
      ["リャ","rya"],["リュ","ryu"],["リョ","ryo"],["ギャ","gya"],["ギュ","gyu"],["ギョ","gyo"],
      ["ジャ","ja"],["ジュ","ju"],["ジョ","jo"],["ビャ","bya"],["ビュ","byu"],["ビョ","byo"],
      ["ピャ","pya"],["ピュ","pyu"],["ピョ","pyo"],
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

  var _PINYIN_TABLE = null;

  utils.sortKey = function (text) {
    if (!text) return 'zzz';
    var s = String(text).trim();
    if (!s) return 'zzz';

    s = s.replace(_KANA_RE, function (m) { return _KANA_MAP[m] || m; });
    s = s.toLowerCase();
    return s;
  };

  utils.itemSortKey = function (item, sortKeyField, field) {
    if (!item || typeof item !== 'object') {
      return utils.sortKey(String(item || ''));
    }
    if (sortKeyField && item[sortKeyField]) {
      return item[sortKeyField];
    }
    return utils.sortKey(item[field] || '');
  };

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

  utils.sortLetter = function (textOrItem) {
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

  utils.groupByLetter = function (items, keyFn) {
    var groups = [];
    var current = null;
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      var letter;
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


  utils.normalizeForSearch = function (text) {
    if (!text) return '';
    var s = String(text).trim();
    if (!s) return '';
    s = s.replace(_KANA_RE, function (m) { return _KANA_MAP[m] || m; });
    s = s.toLowerCase();
    s = s.replace(/[^a-z0-9]/g, '');
    return s;
  };

  var _searchQueryCache = {};

  utils.matchTrack = function (query, track) {
    if (!query || !track) return false;

    var normQuery = _searchQueryCache[query];
    if (normQuery === undefined) {
      normQuery = utils.normalizeForSearch(query);
      _searchQueryCache[query] = normQuery;
    }

    var fields = [
      { text: 'title',  key: 'sort_key',         textVal: track.title,  keyVal: track.sort_key },
      { text: 'artist', key: 'artist_sort_key',  textVal: track.artist, keyVal: track.artist_sort_key },
      { text: 'album',  key: 'album_sort_key',   textVal: track.album,  keyVal: track.album_sort_key },
      { text: 'alias_title', key: 'alias_sort_key', textVal: track.alias_title, keyVal: track.alias_sort_key },
    ];

    for (var i = 0; i < fields.length; i++) {
      var f = fields[i];

      if (f.textVal && f.textVal.toLowerCase().includes(query)) return true;

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

      if (textVal && textVal.toLowerCase().includes(query)) return true;

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

  utils.initial = function (str) {
    if (!str) return '?';
    return str.trim()[0].toUpperCase();
  };

  utils.trackRow = function (track, index, onClick, showMiniCover, playIndex, coverSize) {
    const playIdx = (typeof playIndex === 'number') ? playIndex : (index - 1);
    const li = document.createElement('li');
    li.className = 'track-row';
    li.dataset.trackId = track.id;
    li._trackData = track;

    if (App.state.currentTrack && App.state.currentTrack.id === track.id) {
      li.classList.add('playing');
    }

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

    const dur = document.createElement('div');
    dur.className = 'track-duration';
    dur.textContent = utils.formatDuration(track.duration_ms);

    li.appendChild(numCell);
    li.appendChild(body);
    li.appendChild(dur);

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
      App.selection.clear();
      onClick(track, playIdx);
    });

    li.setAttribute('draggable', 'true');
    li.addEventListener('dragstart', function (e) {
      if (!App.selection.isSelected(track.id)) {
        App.selection.selectOnly(track, li);
      }
      var ids = App.selection.getSelectedIds();
      if (ids.length === 0) ids = [track.id];
      e.dataTransfer.setData('text/plain', JSON.stringify(ids));
      e.dataTransfer.effectAllowed = 'copy';
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

  utils.selection = App.selection = {
    _selectedIds: new Set(),
    _lastClickedLi: null,
    _activeList: null,

    clear: function () {
      this._selectedIds.clear();
      this._lastClickedLi = null;
      this._activeList = null;
      document.querySelectorAll('.track-row.selected').forEach(function (el) {
        el.classList.remove('selected');
      });
    },

    isSelected: function (trackId) {
      return this._selectedIds.has(trackId);
    },

    size: function () {
      return this._selectedIds.size;
    },

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

    selectOnly: function (track, li) {
      this.clear();
      var ul = li.parentElement;
      this._activeList = ul;
      this._selectedIds.add(track.id);
      li.classList.add('selected');
      this._lastClickedLi = li;
    },

    getSelectedIds: function () {
      return Array.from(this._selectedIds);
    },

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


  function _esc(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
  utils.esc = _esc;


  utils.isLRC = function (text) {
    return /\[\d{2}:\d{2}(?:[\.:]\d{2,3})?\]/.test(text);
  };

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


  utils.processLyricsCredits = function (lyricsText, filterWordsStr) {
    var empty = { lyrics: lyricsText || '', credits: '' };
    if (!lyricsText) return empty;

    if (!filterWordsStr) {
      filterWordsStr = '作词,作曲,编曲,和声,对唱,配唱制作人,钢琴,吉他,鼓,贝斯,制作人,制作,混音,混音师,混音室,母带,录音,录音师,录音室,监制,策划,发行,词曲,填词,谱曲,OP,ED,SP';
    }

    var words = filterWordsStr
      .split(/[,，]/)
      .map(function (w) { return w.trim(); })
      .filter(function (w) { return w.length > 0; })
      .sort(function (a, b) { return b.length - a.length; });

    if (words.length === 0) return empty;

    var escaped = words.map(function (w) {
      return w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    });
    var creditRegex = new RegExp('^\\s*(' + escaped.join('|') + ')\\s*[：:]', 'g');

    var lines = lyricsText.split('\n');
    var creditNames = [];
    var normalLines = [];
    var creditPhase = true;

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      var trimmed = line.trim();

      if (!trimmed) {
        if (!creditPhase) normalLines.push(line);
        continue;
      }

      var timeMatch = trimmed.match(/\[(\d{2}):(\d{2})(?:[\.:](\d{2,3}))?\]/);
      var textContent = trimmed;
      if (timeMatch) {
        textContent = trimmed.substring(timeMatch.index + timeMatch[0].length).trim();
      }

      var plainContent = textContent.replace(/<\d{2}:\d{2}[\.:]\d{2,3}>/g, '');

      if (!timeMatch && /^\[[a-zA-Z]+:/.test(trimmed)) {
        if (!creditPhase) normalLines.push(line);
        continue;
      }

      if (!plainContent) {
        if (!creditPhase) normalLines.push(line);
        continue;
      }

      creditRegex.lastIndex = 0;
      var matches = [];
      var cm;
      while ((cm = creditRegex.exec(plainContent)) !== null) {
        matches.push({ index: cm.index, end: cm.index + cm[0].length });
      }

      if (matches.length > 0 && creditPhase) {
        for (var j = 0; j < matches.length; j++) {
          var valStart = matches[j].end;
          var valEnd = (j + 1 < matches.length) ? matches[j + 1].index : plainContent.length;
          var value = plainContent.substring(valStart, valEnd).trim();
          value = value.replace(/[、,，\/\s]+$/, '');
          if (value) {
            var nameList = value
              .split(/[、,，\/]/)
              .map(function (n) { return n.trim(); })
              .filter(function (n) { return n.length > 0; });
            creditNames = creditNames.concat(nameList);
          }
        }
        continue;
      }

      creditPhase = false;
      normalLines.push(line);
    }

    if (creditNames.length === 0) return empty;

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

  utils.parseLRC = function (lrcText) {
    if (!lrcText || typeof lrcText !== 'string') return [];
    var lines = lrcText.split('\n');
    var entries = [];
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
        // 行首标记：[s:歌手名]（对唱）、[bg]（和声）——AMLL TTML 转换产物
        var singer = '';
        var isBg = false;
        var tagM;
        while ((tagM = /^\[(?:s:([^\]]*)|bg)\]\s*/.exec(rawText)) !== null) {
          if (tagM[0].charAt(1) === 'b') {
            isBg = true;
          } else {
            singer = tagM[1] || '';
          }
          rawText = rawText.substring(tagM[0].length);
        }
        var parsed = _parseLRCWords(rawText);
        for (var t = 0; t < times.length; t++) {
          var entry = { time: times[t], text: parsed.text };
          if (parsed.words) entry.words = parsed.words;
          if (singer) entry.singer = singer;
          if (isBg) entry.isBg = true;
          entries.push(entry);
        }
      }
    }

    entries.sort(function (a, b) { return a.time - b.time; });

    var grouped = [];
    var k = 0;
    while (k < entries.length) {
      var cluster = [entries[k]];
      var j = k + 1;
      while (j < entries.length && Math.abs(entries[j].time - entries[k].time) <= 30) {
        cluster.push(entries[j]);
        j++;
      }
      // 和声行（[bg]）不参与主/音译/翻译的配对，挂在同时间戳的主行上
      var nonBg = [];
      var bgList = [];
      for (var ci = 0; ci < cluster.length; ci++) {
        if (cluster[ci].isBg) bgList.push(cluster[ci]);
        else nonBg.push(cluster[ci]);
      }
      var allBg = nonBg.length === 0;
      if (allBg) {
        // 全为和声的簇：第一行作主体，其余照常走翻译/音译配对，不再挂 bgLines
        nonBg = cluster;
        bgList = [];
      }
      var head = nonBg[0];
      var item = { time: head.time, text: head.text };
      if (head.words) item.words = head.words;
      if (head.singer) item.singer = head.singer;
      if (allBg) item.isBg = true;
      if (nonBg.length >= 3) {
        item.romaji = nonBg[1].text;
        if (nonBg[1].words) item.romajiWords = nonBg[1].words;
        item.translation = nonBg[2].text;
        if (nonBg[2].words) item.translationWords = nonBg[2].words;
      } else if (nonBg.length === 2) {
        item.translation = nonBg[1].text;
        if (nonBg[1].words) item.translationWords = nonBg[1].words;
      }
      if (bgList.length > 0) {
        item.bgLines = [];
        for (var bi = 0; bi < bgList.length; bi++) {
          var bgEntry = bgList[bi];
          var bgItem = { text: bgEntry.text };
          if (bgEntry.words) bgItem.words = bgEntry.words;
          if (bgEntry.singer) bgItem.singer = bgEntry.singer;
          item.bgLines.push(bgItem);
        }
      }
      grouped.push(item);
      k = j;
    }
    return grouped;
  };


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


  utils.squeezeIcon = function (iconEl, newText) {
    if (!iconEl || !iconEl.animate) {
      if (iconEl) iconEl.textContent = newText;
      return;
    }
    if (iconEl._squeezeAnim) iconEl._squeezeAnim.cancel();
    if (iconEl._squeezeTimer) clearTimeout(iconEl._squeezeTimer);

    var DURATION = 320;
    var SWAP_MS  = 110;

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

  utils.bloomButton = function (btnEl) {
    if (!btnEl || !btnEl.animate) return;
    if (btnEl._bloomAnim) btnEl._bloomAnim.cancel();

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


  utils.call = function (method, ...args) {
    return new Promise(function (resolve) {
      App.backend[method](...args, resolve);
    });
  };

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
      setTimeout(function () { confirmBtn.focus(); }, 50);
    });
  };

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


  var _lyricsScrollRafs = (typeof WeakMap !== 'undefined') ? new WeakMap() : null;

  utils.animateLyricsScroll = function (wrapEl, targetTop, lineGapMs) {
    if (!wrapEl) return;
    utils.cancelLyricsScroll(wrapEl);

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

  utils.cancelLyricsScroll = function (wrapEl) {
    if (!wrapEl || !_lyricsScrollRafs) return;
    var prev = _lyricsScrollRafs.get(wrapEl);
    if (prev) cancelAnimationFrame(prev);
    _lyricsScrollRafs.delete(wrapEl);
  };

  utils.cascadeLyricLines = function (lines, activeIdx, prevIdx) {
    if (!lines || !lines.length) return;
    var i, line, d;
    for (i = 0; i < lines.length; i++) {
      line = lines[i];
      if (line.classList.contains('np-lyrics-static')) continue;
      d = Math.abs(i - activeIdx);
      var delay = Math.min(d * 18, 90);
      if (line._cascDelay !== delay) {
        line._cascDelay = delay;
        line.style.transitionDelay = delay + 'ms';
        line.style.setProperty('--lyrics-lift-delay', delay + 'ms');
      }

      line.classList.remove('np-lyrics-lift');
      if (d <= 3) {
        void line.offsetWidth;
        line.classList.add('np-lyrics-lift');
      }
    }
  };

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
      }, 400);
    }, 3000);
  };

})();
