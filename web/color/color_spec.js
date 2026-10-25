// Material Color Utilities 的配色规范实现（phone 平台、contrastLevel 0）。
// 结构对齐官方 @material/material-color-utilities@0.4.0：
//   - 调色板：2021 一套固定色度；2025 重定义 tonal_spot / neutral / vibrant /
//     expressive，其余变体（fidelity / content / monochrome / rainbow /
//     fruit_salad）按官方 maybeFallbackSpecVersion 回退 2021。
//   - tone 解析：还原官方 DynamicColor.getTone —— 初始 tone → 对比度修正
//     （ContrastCurve 在 contrast 0 取 normal 值）→ ToneDeltaPair 约束 →
//     背景色 50-59 "尴尬区"规避。2021 / 2025 两套 pair 语义分别移植。
//   - fidelity / content 的三级色来自 TemperatureCache（补色 / 类比色）并经
//     DislikeAnalyzer 规避"脏黄绿"。
//
// 与官方基准（golden.json）对齐到逐位一致；改这里之前先跑
// material-color-utilities 的对照测试。
(function () {
  'use strict';

  var C = window.AppColor;
  if (!C) {
    if (window.console) console.warn('[color_spec] 需要先加载 color/hct.js');
    return;
  }

  var VARIANTS = ['tonal_spot', 'fidelity', 'monochrome', 'neutral', 'vibrant',
    'expressive', 'content', 'rainbow', 'fruit_salad'];

  // 2025 的调色板 / 色调规范只覆盖这四个变体，官方 DynamicScheme
  // 的 maybeFallbackSpecVersion 会把其余变体降回 2021。
  var FALLBACK_2021 = {
    fidelity: 1, content: 1, monochrome: 1, rainbow: 1, fruit_salad: 1,
  };

  function pal(hue, chroma) { return new C.TonalPalette(hue, chroma); }
  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
  function sanitize(d) { return C.sanitizeDegrees(d); }
  function isFidelity(v) { return v === 'fidelity' || v === 'content'; }

  // ── DislikeAnalyzer（官方移植）────────────────────────────────────
  function isDisliked(h) {
    var hue = Math.round(h.hue), chroma = Math.round(h.chroma), tone = Math.round(h.tone);
    return hue >= 90 && hue <= 111 && chroma > 16 && tone < 65;
  }

  function fixIfDisliked(h) {
    return isDisliked(h) ? C.hctFrom(h.hue, h.chroma, 70) : h;
  }

  // ── TemperatureCache（官方移植，只保留补色与类比色）───────────────
  function isBetween(angle, a, b) {
    return a < b ? (a <= angle && angle <= b) : (a <= angle || angle <= b);
  }

  function TemperatureCache(input) {
    this.input = input;   // { hue, chroma, tone, rgb }
    this._byHue = null;
    this._range = null;
    this._inputRelTemp = -1;
    this._complement = null;
  }

  // 同色度、同 tone、360 个色相的 HCT 序列（官方 hctsByHue）。
  TemperatureCache.prototype.hctsByHue = function () {
    if (this._byHue) return this._byHue;
    var arr = [];
    for (var hue = 0; hue <= 360; hue++) {
      arr.push(C.hctFrom(hue, this.input.chroma, this.input.tone));
    }
    this._byHue = arr;
    return arr;
  };

  TemperatureCache.prototype.temp = function (h) { return C.rawTemperature(h.rgb); };

  TemperatureCache.prototype._rangeInfo = function () {
    if (this._range) return this._range;
    var hcts = this.hctsByHue();
    var coldest = null, warmest = null;
    for (var i = 0; i < hcts.length; i++) {
      var t = this.temp(hcts[i]);
      if (!coldest || t < coldest.t) coldest = { h: hcts[i], t: t };
      if (!warmest || t > warmest.t) warmest = { h: hcts[i], t: t };
    }
    var ti = this.temp(this.input);
    if (ti < coldest.t) coldest = { h: this.input, t: ti };
    if (ti > warmest.t) warmest = { h: this.input, t: ti };
    this._range = { coldest: coldest, warmest: warmest };
    return this._range;
  };

  TemperatureCache.prototype.relTemp = function (h) {
    var r = this._rangeInfo();
    var range = r.warmest.t - r.coldest.t;
    if (range === 0) return 0.5;
    return (this.temp(h) - r.coldest.t) / range;
  };

  TemperatureCache.prototype.inputRelTemp = function () {
    if (this._inputRelTemp < 0) this._inputRelTemp = this.relTemp(this.input);
    return this._inputRelTemp;
  };

  // 官方 complement：在冷/暖另一半里找相对温度互为补数的色相。
  TemperatureCache.prototype.complement = function () {
    if (this._complement) return this._complement;
    var r = this._rangeInfo();
    var range = r.warmest.t - r.coldest.t;
    var coldestHue = r.coldest.h.hue, warmestHue = r.warmest.h.hue;
    var startIsCW = isBetween(this.input.hue, coldestHue, warmestHue);
    var startHue = startIsCW ? warmestHue : coldestHue;
    var endHue = startIsCW ? coldestHue : warmestHue;
    var hcts = this.hctsByHue();
    var answer = hcts[Math.round(this.input.hue)];
    var smallestError = 1000;
    var complementRelTemp = 1 - this.inputRelTemp();
    for (var addend = 0; addend <= 360; addend++) {
      var hue = sanitize(startHue + addend);
      if (!isBetween(hue, startHue, endHue)) continue;
      var possible = hcts[Math.round(hue)];
      var relTemp = (this.temp(possible) - r.coldest.t) / range;
      var err = Math.abs(complementRelTemp - relTemp);
      if (err < smallestError) { smallestError = err; answer = possible; }
    }
    this._complement = answer;
    return answer;
  };

  // 官方 analogous：按温度等距取一圈类比色（content 三级色用 [2]）。
  TemperatureCache.prototype.analogous = function (count, divisions) {
    var hcts = this.hctsByHue();
    var startHue = Math.round(this.input.hue);
    var startHct = hcts[startHue];
    var lastTemp = this.relTemp(startHct);
    var allColors = [startHct];

    var absoluteTotalTempDelta = 0;
    for (var i = 0; i < 360; i++) {
      var hue = (startHue + i) % 360;
      var t = this.relTemp(hcts[hue]);
      absoluteTotalTempDelta += Math.abs(t - lastTemp);
      lastTemp = t;
    }
    var hueAddend = 1;
    var tempStep = absoluteTotalTempDelta / divisions;
    var totalTempDelta = 0;
    lastTemp = this.relTemp(startHct);
    while (allColors.length < divisions) {
      var h = (startHue + hueAddend) % 360;
      var hct = hcts[h];
      var temp = this.relTemp(hct);
      totalTempDelta += Math.abs(temp - lastTemp);

      var desired = allColors.length * tempStep;
      var indexSatisfied = totalTempDelta >= desired;
      var indexAddend = 1;
      while (indexSatisfied && allColors.length < divisions) {
        allColors.push(hct);
        desired = (allColors.length + indexAddend) * tempStep;
        indexSatisfied = totalTempDelta >= desired;
        indexAddend++;
      }
      lastTemp = temp;
      hueAddend++;
      if (hueAddend > 360) {
        while (allColors.length < divisions) allColors.push(hct);
        break;
      }
    }

    var answers = [this.input];
    var increaseHueCount = Math.floor((count - 1) / 2);
    for (var a = 1; a < increaseHueCount + 1; a++) {
      var idx = 0 - a;
      while (idx < 0) idx += allColors.length;
      if (idx >= allColors.length) idx = idx % allColors.length;
      answers.unshift(allColors[idx]);
    }
    var decreaseHueCount = count - increaseHueCount - 1;
    for (var b = 1; b < decreaseHueCount + 1; b++) {
      var idx2 = b;
      if (idx2 >= allColors.length) idx2 = idx2 % allColors.length;
      answers.push(allColors[idx2]);
    }
    return answers;
  };

  // 官方 ColorSpec2021.findDesiredChromaByTone（fidelity 次级容器用）。
  function findDesiredChromaByTone2021(hue, chroma, tone, byDecreasing) {
    var answer = tone;
    var closest = C.hctFrom(hue, chroma, tone);
    if (closest.chroma < chroma) {
      var chromaPeak = closest.chroma;
      while (closest.chroma < chroma) {
        answer += byDecreasing ? -1 : 1;
        var potential = C.hctFrom(hue, chroma, answer);
        if (chromaPeak > potential.chroma) break;
        if (Math.abs(potential.chroma - chroma) < 0.4) break;
        if (Math.abs(potential.chroma - chroma) < Math.abs(closest.chroma - chroma)) {
          closest = potential;
        }
        chromaPeak = Math.max(chromaPeak, potential.chroma);
      }
    }
    return answer;
  }

  // ── 调色板 ────────────────────────────────────────────────────────
  // seed：{ hue, chroma, tone }（正向 CAM16 值 + L*）。
  function buildPalettes(spec, variant, seed, isDark) {
    var hue = seed.hue;
    var ch = seed.chroma;
    var s = sanitize;
    var v2025 = spec === '2025' && !FALLBACK_2021[variant];

    switch (variant) {
      case 'monochrome':
        return { primary: pal(hue, 0), secondary: pal(hue, 0), tertiary: pal(hue, 0),
          neutral: pal(hue, 0), neutralVariant: pal(hue, 0) };

      case 'neutral':
        return {
          primary: pal(hue, v2025 ? (C.isBlue(hue) ? 12 : 8) : 12),
          secondary: pal(hue, v2025 ? (C.isBlue(hue) ? 6 : 4) : 8),
          tertiary: pal(v2025 ? C.rotatedHue(hue, [0, 38, 105, 161, 204, 278, 333, 360],
            [-32, 26, 10, -39, 24, -15, -32]) : hue, v2025 ? 20 : 16),
          neutral: pal(hue, v2025 ? 1.4 : 2),
          neutralVariant: pal(hue, v2025 ? 1.4 * 2.2 : 2),
        };

      case 'vibrant': {
        var base = [0, 38, 105, 140, 333, 360];
        var shift = [-14, 10, -14, 10, -14];
        if (v2025) {
          var nHueV = C.rotatedHue(hue, base, shift);
          return {
            primary: pal(hue, 74),
            secondary: pal(C.rotatedHue(hue, base, shift), 56),
            tertiary: pal(C.rotatedHue(hue, [0, 38, 71, 105, 140, 161, 253, 333, 360],
              [-72, 35, 24, -24, 62, 50, 62, -72]), 56),
            neutral: pal(nHueV, 28),
            neutralVariant: pal(nHueV, 28 * 1.29),
          };
        }
        return {
          primary: pal(hue, 200),
          secondary: pal(C.rotatedHue(hue, [0, 41, 61, 101, 131, 181, 251, 301, 360],
            [18, 15, 10, 12, 15, 18, 15, 12, 12]), 24),
          tertiary: pal(C.rotatedHue(hue, [0, 41, 61, 101, 131, 181, 251, 301, 360],
            [35, 30, 20, 25, 30, 35, 30, 25, 25]), 32),
          neutral: pal(hue, 10),
          neutralVariant: pal(hue, 12),
        };
      }

      case 'expressive': {
        if (v2025) {
          var eBp = [0, 105, 140, 204, 253, 278, 300, 333, 360];
          var nHueE = C.rotatedHue(hue, [0, 71, 124, 253, 278, 300, 360],
            [10, 0, 10, 0, 10, 0]);
          var nChromaE = isDark ? (C.isYellow(nHueE) ? 6 : 14) : 18;
          return {
            primary: pal(hue, isDark ? 36 : 48),
            secondary: pal(C.rotatedHue(hue, eBp,
              [-160, 155, -100, 96, -96, -156, -165, -160]), isDark ? 16 : 24),
            tertiary: pal(C.rotatedHue(hue, eBp,
              [-165, 160, -105, 101, -101, -160, -170, -165]), 48),
            neutral: pal(nHueE, nChromaE),
            neutralVariant: pal(nHueE, nChromaE * (C.isYellow(nHueE) ? 1.6 : 2.3)),
          };
        }
        return {
          primary: pal(s(hue + 240), 40),
          secondary: pal(C.rotatedHue(hue, [0, 21, 51, 121, 151, 191, 271, 321, 360],
            [45, 95, 45, 20, 45, 90, 45, 45, 45]), 24),
          tertiary: pal(C.rotatedHue(hue, [0, 21, 51, 121, 151, 191, 271, 321, 360],
            [120, 120, 20, 45, 20, 15, 20, 120, 120]), 32),
          neutral: pal(s(hue + 15), 8),
          neutralVariant: pal(s(hue + 15), 12),
        };
      }

      case 'tonal_spot':
        return v2025 ? {
          primary: pal(hue, isDark ? 26 : 32),
          secondary: pal(hue, 16),
          tertiary: pal(C.rotatedHue(hue, [0, 20, 71, 161, 333, 360],
            [-40, 48, -32, 40, -32]), 28),
          neutral: pal(hue, 5),
          neutralVariant: pal(hue, 5 * 1.7),
        } : {
          primary: pal(hue, 36),
          secondary: pal(hue, 16),
          tertiary: pal(s(hue + 60), 24),
          neutral: pal(hue, 6),
          neutralVariant: pal(hue, 8),
        };

      case 'fidelity':
      case 'content': {
        // 官方：fidelity 三级色 = 补色，content = 色温类比第 3 色；
        // 都要过 DislikeAnalyzer。
        var cache = new TemperatureCache(
          { hue: hue, chroma: ch, tone: seed.tone, rgb: seed.rgb });
        var third = variant === 'fidelity'
          ? fixIfDisliked(cache.complement())
          : fixIfDisliked(cache.analogous(3, 6)[2]);
        return {
          primary: pal(hue, ch),
          secondary: pal(hue, Math.max(ch - 32, ch * 0.5)),
          tertiary: pal(third.hue, third.chroma),
          neutral: pal(hue, ch / 8),
          neutralVariant: pal(hue, ch / 8 + 4),
        };
      }

      case 'rainbow':
        return {
          primary: pal(hue, 48),
          secondary: pal(hue, 16),
          tertiary: pal(s(hue + 60), 24),
          neutral: pal(hue, 0),
          neutralVariant: pal(hue, 0),
        };

      case 'fruit_salad':
        return {
          primary: pal(s(hue - 50), 48),
          secondary: pal(s(hue - 50), 36),
          tertiary: pal(hue, 36),
          neutral: pal(hue, 10),
          neutralVariant: pal(hue, 16),
        };
    }

    return buildPalettes(spec, 'tonal_spot', seed, isDark);
  }

  // ── 表面色中性色度放大（2025 新增）─────────────────────────────────
  function surfaceMult(role, variant, isDark, neutralHue) {
    var y = C.isYellow(neutralHue);
    var v = variant;
    switch (role) {
      case 'surfaceDim':
        if (isDark) return 1;
        if (v === 'neutral') return 2.5;
        if (v === 'tonal_spot') return 1.7;
        if (v === 'expressive') return y ? 2.7 : 1.75;
        if (v === 'vibrant') return 1.36;
        return 1;
      case 'surfaceBright':
        if (!isDark) return 1;
        if (v === 'neutral') return 2.5;
        if (v === 'tonal_spot') return 1.7;
        if (v === 'expressive') return y ? 2.7 : 1.75;
        if (v === 'vibrant') return 1.36;
        return 1;
      case 'surfaceContainerLow':
        if (v === 'neutral') return 1.3;
        if (v === 'tonal_spot') return 1.25;
        if (v === 'expressive') return y ? 1.3 : 1.15;
        if (v === 'vibrant') return 1.08;
        return 1;
      case 'surfaceContainer':
        if (v === 'neutral') return 1.6;
        if (v === 'tonal_spot') return 1.4;
        if (v === 'expressive') return y ? 1.6 : 1.3;
        if (v === 'vibrant') return 1.15;
        return 1;
      case 'surfaceContainerHigh':
        if (v === 'neutral') return 1.9;
        if (v === 'tonal_spot') return 1.5;
        if (v === 'expressive') return y ? 1.95 : 1.45;
        if (v === 'vibrant') return 1.22;
        return 1;
      case 'surfaceContainerHighest':
        if (v === 'neutral') return 2.2;
        if (v === 'tonal_spot') return 1.7;
        if (v === 'expressive') return y ? 2.3 : 1.6;
        if (v === 'vibrant') return 1.29;
        return 1;
      default:
        return 1;
    }
  }

  // outlineVariant 的前景色度放大（2025）。
  function foregroundMult(variant, isDark, neutralHue) {
    if (variant === 'neutral') return 2.2;
    if (variant === 'tonal_spot') return 1.7;
    if (variant === 'expressive') {
      return C.isYellow(neutralHue) ? (isDark ? 3.0 : 2.3) : 1.6;
    }
    return 1;
  }

  function tMaxC(p, lo, hi) { return p.maxTone(lo === undefined ? 0 : lo, hi === undefined ? 100 : hi); }
  function tMinC(p, lo, hi) { return p.minTone(lo === undefined ? 0 : lo, hi === undefined ? 100 : hi); }

  // ── 角色定义与 tone 解析 ──────────────────────────────────────────
  // def：{ palette, init(), isBg, bg, curve:[lo,normal,med,hi], mult, pair }
  // curve 在 contrastLevel 0 时取 [1]（normal）。
  function buildRoles(ctx) {
    var spec = ctx.spec, variant = ctx.variant, P = ctx.P, seed = ctx.seed;
    var isDark = ctx.isDark, v2025 = ctx.v2025;
    var R = {};
    var y = C.isYellow(P.neutral.hue);
    var vibrant = variant === 'vibrant';
    var cPri = C.isCyan(P.primary.hue);
    var cTer = C.isCyan(P.tertiary.hue);
    var mono = variant === 'monochrome';
    var fidelity = isFidelity(variant);

    function getCurve(dc) {
      switch (dc) {
        case 1.5: return [1.5, 1.5, 3, 5.5];
        case 3: return [3, 3, 4.5, 7];
        case 4.5: return [4.5, 4.5, 7, 11];
        case 6: return [6, 6, 7, 11];
        case 7: return [7, 7, 11, 21];
        case 9: return [9, 9, 11, 21];
        case 11: return [11, 11, 21, 21];
        case 21: return [21, 21, 21, 21];
        default: return [dc, dc, 7, 21];
      }
    }

    // fidelity 的三个容器初始 tone（官方原始 tone 函数值）
    var fRaw = null;
    if (fidelity) {
      var proposed = C.hctFrom(P.tertiary.hue, P.tertiary.chroma, seed.tone);
      fRaw = {
        primaryContainer: seed.tone,
        secondaryContainer: findDesiredChromaByTone2021(
          P.secondary.hue, P.secondary.chroma, isDark ? 30 : 90, !isDark),
        tertiaryContainer: fixIfDisliked(proposed).tone,
      };
    }

    // ── 表面阶梯 ──
    if (!v2025) {
      R.surface = { palette: 'neutral', init: function () { return isDark ? 6 : 98; }, isBg: true };
      R.surfaceDim = { palette: 'neutral', init: function () { return isDark ? 6 : 87; }, isBg: true };
      R.surfaceBright = { palette: 'neutral', init: function () { return isDark ? 24 : 98; }, isBg: true };
      R.surfaceContainerLowest = { palette: 'neutral', init: function () { return isDark ? 4 : 100; }, isBg: true };
      R.surfaceContainerLow = { palette: 'neutral', init: function () { return isDark ? 10 : 96; }, isBg: true };
      R.surfaceContainer = { palette: 'neutral', init: function () { return isDark ? 12 : 94; }, isBg: true };
      R.surfaceContainerHigh = { palette: 'neutral', init: function () { return isDark ? 17 : 92; }, isBg: true };
      R.surfaceContainerHighest = { palette: 'neutral', init: function () { return isDark ? 22 : 90; }, isBg: true };
      R.background = { palette: 'neutral', init: function () { return isDark ? 6 : 98; }, isBg: true };
      R.outlineVariant = {
        palette: 'neutralVariant',
        init: function () { return isDark ? 30 : 80; },
        bg: 'highestSurface', curve: [1, 1, 3, 4.5],
      };
    } else {
      R.surface = { palette: 'neutral', init: function () {
        return isDark ? 4 : (y ? 99 : (vibrant ? 97 : 98)); }, isBg: true };
      R.surfaceDim = { palette: 'neutral', init: function () {
        return isDark ? 4 : (y ? 90 : (vibrant ? 85 : 87)); }, isBg: true, mult: 'surfaceDim' };
      R.surfaceBright = { palette: 'neutral', init: function () {
        return isDark ? 18 : (y ? 99 : (vibrant ? 97 : 98)); }, isBg: true, mult: 'surfaceBright' };
      R.surfaceContainerLowest = { palette: 'neutral', init: function () {
        return isDark ? 0 : 100; }, isBg: true };
      R.surfaceContainerLow = { palette: 'neutral', init: function () {
        return isDark ? 6 : (y ? 98 : (vibrant ? 95 : 96)); }, isBg: true, mult: 'surfaceContainerLow' };
      R.surfaceContainer = { palette: 'neutral', init: function () {
        return isDark ? 9 : (y ? 96 : (vibrant ? 92 : 94)); }, isBg: true, mult: 'surfaceContainer' };
      R.surfaceContainerHigh = { palette: 'neutral', init: function () {
        return isDark ? 12 : (y ? 94 : (vibrant ? 90 : 92)); }, isBg: true, mult: 'surfaceContainerHigh' };
      R.surfaceContainerHighest = { palette: 'neutral', init: function () {
        return isDark ? 15 : (y ? 92 : (vibrant ? 88 : 90)); }, isBg: true, mult: 'surfaceContainerHighest' };
      // 2025 的 background 直接克隆 surface。
      R.background = { palette: 'neutral', init: function () {
        return isDark ? 4 : (y ? 99 : (vibrant ? 97 : 98)); }, isBg: true };
      R.outlineVariant = {
        palette: 'neutral', mult: 'fg',
        init: function () { return ctx.toneOf('highestSurface'); },
        bg: 'highestSurface', curve: getCurve(1.5),
      };
    }

    // ── 主色组 ──
    if (!v2025) {
      var pairP = { a: 'primaryContainer', b: 'primary', delta: 10, polarity: 'nearer', stayTogether: false };
      var pairQ = { a: 'secondaryContainer', b: 'secondary', delta: 10, polarity: 'nearer', stayTogether: false };
      var pairT = { a: 'tertiaryContainer', b: 'tertiary', delta: 10, polarity: 'nearer', stayTogether: false };
      R.primary = { palette: 'primary', init: function () {
        return mono ? (isDark ? 100 : 0) : (isDark ? 80 : 40); },
        isBg: true, bg: 'highestSurface', curve: [3, 4.5, 7, 7], pair: pairP };
      R.primaryContainer = { palette: 'primary', init: function () {
        if (fidelity) return fRaw.primaryContainer;
        if (mono) return isDark ? 85 : 25;
        return isDark ? 30 : 90; },
        isBg: true, bg: 'highestSurface', curve: [1, 1, 3, 4.5], pair: pairP };
      R.onPrimary = { palette: 'primary', init: function () {
        return mono ? (isDark ? 10 : 90) : (isDark ? 20 : 100); },
        bg: 'primary', curve: [4.5, 7, 11, 21] };
      R.onPrimaryContainer = { palette: 'primary', init: function () {
        if (fidelity) return C.foregroundTone(fRaw.primaryContainer, 4.5);
        if (mono) return isDark ? 0 : 100;
        return isDark ? 90 : 30; },
        bg: 'primaryContainer', curve: [3, 4.5, 7, 11] };

      R.secondary = { palette: 'secondary', init: function () {
        return isDark ? 80 : 40; },
        isBg: true, bg: 'highestSurface', curve: [3, 4.5, 7, 7], pair: pairQ };
      R.secondaryContainer = { palette: 'secondary', init: function () {
        if (fidelity) return fRaw.secondaryContainer;
        if (mono) return isDark ? 30 : 85;
        return isDark ? 30 : 90; },
        isBg: true, bg: 'highestSurface', curve: [1, 1, 3, 4.5], pair: pairQ };
      R.onSecondary = { palette: 'secondary', init: function () {
        return mono ? (isDark ? 10 : 100) : (isDark ? 20 : 100); },
        bg: 'secondary', curve: [4.5, 7, 11, 21] };
      R.onSecondaryContainer = { palette: 'secondary', init: function () {
        if (mono) return isDark ? 90 : 10;
        if (fidelity) return C.foregroundTone(fRaw.secondaryContainer, 4.5);
        return isDark ? 90 : 30; },
        bg: 'secondaryContainer', curve: [3, 4.5, 7, 11] };

      R.tertiary = { palette: 'tertiary', init: function () {
        return mono ? (isDark ? 90 : 25) : (isDark ? 80 : 40); },
        isBg: true, bg: 'highestSurface', curve: [3, 4.5, 7, 7], pair: pairT };
      R.tertiaryContainer = { palette: 'tertiary', init: function () {
        if (mono) return isDark ? 60 : 49;
        if (fidelity) return fRaw.tertiaryContainer;
        return isDark ? 30 : 90; },
        isBg: true, bg: 'highestSurface', curve: [1, 1, 3, 4.5], pair: pairT };
      R.onTertiary = { palette: 'tertiary', init: function () {
        return mono ? (isDark ? 10 : 90) : (isDark ? 20 : 100); },
        bg: 'tertiary', curve: [4.5, 7, 11, 21] };
      R.onTertiaryContainer = { palette: 'tertiary', init: function () {
        if (mono) return isDark ? 0 : 100;
        if (fidelity) return C.foregroundTone(fRaw.tertiaryContainer, 4.5);
        return isDark ? 90 : 30; },
        bg: 'tertiaryContainer', curve: [3, 4.5, 7, 11] };
    } else {
      var pairP5 = { a: 'primaryContainer', b: 'primary', delta: 5,
        polarity: 'relative_lighter', stayTogether: true, constraint: 'farther' };
      var pairQ5 = { a: 'secondaryContainer', b: 'secondary', delta: 5,
        polarity: 'relative_lighter', stayTogether: true, constraint: 'farther' };
      var pairT5 = { a: 'tertiaryContainer', b: 'tertiary', delta: 5,
        polarity: 'relative_lighter', stayTogether: true, constraint: 'farther' };

      R.primary = { palette: 'primary', init: function () {
        if (variant === 'neutral') return isDark ? 80 : 40;
        if (variant === 'tonal_spot') return isDark ? 80 : tMaxC(P.primary);
        if (variant === 'expressive') {
          return tMaxC(P.primary, 0,
            C.isYellow(P.primary.hue) ? 25 : (cPri ? 88 : 98));
        }
        return tMaxC(P.primary, 0, cPri ? 88 : 98); },
        isBg: true, bg: 'highestSurface', curve: getCurve(4.5), pair: pairP5 };
      R.primaryContainer = { palette: 'primary', init: function () {
        if (variant === 'neutral') return isDark ? 30 : 90;
        if (variant === 'tonal_spot') {
          return isDark ? tMinC(P.primary, 35, 93) : tMaxC(P.primary, 0, 90);
        }
        if (variant === 'expressive') {
          return isDark ? tMaxC(P.primary, 30, 93)
            : tMaxC(P.primary, 78, cPri ? 88 : 90);
        }
        return isDark ? tMinC(P.primary, 66, 93)
          : tMaxC(P.primary, 66, cPri ? 88 : 93); },
        isBg: true, bg: 'highestSurface' };
      R.onPrimary = { palette: 'primary', init: function () {
        return ctx.toneOf('primary'); }, bg: 'primary', curve: getCurve(6) };
      R.onPrimaryContainer = { palette: 'primary', init: function () {
        return ctx.toneOf('primaryContainer'); }, bg: 'primaryContainer', curve: getCurve(6) };

      R.secondary = { palette: 'secondary', init: function () {
        if (variant === 'neutral') {
          return isDark ? tMinC(P.secondary, 0, 98) : tMaxC(P.secondary);
        }
        if (vibrant) return tMaxC(P.secondary, 0, isDark ? 90 : 98);
        return isDark ? 80 : tMaxC(P.secondary); },
        isBg: true, bg: 'highestSurface', curve: getCurve(4.5), pair: pairQ5 };
      R.secondaryContainer = { palette: 'secondary', init: function () {
        if (vibrant) {
          return isDark ? tMinC(P.secondary, 30, 40) : tMaxC(P.secondary, 84, 90);
        }
        if (variant === 'expressive') {
          return isDark ? 15 : tMaxC(P.secondary, 90, 95);
        }
        return isDark ? 25 : 90; },
        isBg: true, bg: 'highestSurface' };
      R.onSecondary = { palette: 'secondary', init: function () {
        return ctx.toneOf('secondary'); }, bg: 'secondary', curve: getCurve(6) };
      R.onSecondaryContainer = { palette: 'secondary', init: function () {
        return ctx.toneOf('secondaryContainer'); }, bg: 'secondaryContainer', curve: getCurve(6) };

      R.tertiary = { palette: 'tertiary', init: function () {
        if (variant === 'expressive' || vibrant) {
          return tMaxC(P.tertiary, 0, cTer ? 88 : (isDark ? 98 : 100));
        }
        return isDark ? tMaxC(P.tertiary, 0, 98) : tMaxC(P.tertiary); },
        isBg: true, bg: 'highestSurface', curve: getCurve(4.5), pair: pairT5 };
      R.tertiaryContainer = { palette: 'tertiary', init: function () {
        if (variant === 'neutral') {
          return isDark ? tMaxC(P.tertiary, 0, 93) : tMaxC(P.tertiary, 0, 96);
        }
        if (variant === 'tonal_spot') {
          return tMaxC(P.tertiary, 0, isDark ? 93 : 100);
        }
        if (variant === 'expressive') {
          return tMaxC(P.tertiary, 75, cTer ? 88 : (isDark ? 93 : 100));
        }
        return isDark ? tMaxC(P.tertiary, 0, 93) : tMaxC(P.tertiary, 72, 100); },
        isBg: true, bg: 'highestSurface' };
      R.onTertiary = { palette: 'tertiary', init: function () {
        return ctx.toneOf('tertiary'); }, bg: 'tertiary', curve: getCurve(6) };
      R.onTertiaryContainer = { palette: 'tertiary', init: function () {
        return ctx.toneOf('tertiaryContainer'); }, bg: 'tertiaryContainer', curve: getCurve(6) };
    }

    return R;
  }

  // ── 主流程 ────────────────────────────────────────────────────────
  var _cache = new Map();
  var MAX_CACHE = 64;

  function generate(seedRgb, opts) {
    opts = opts || {};
    var spec = opts.spec === '2021' ? '2021' : '2025';
    var variant = VARIANTS.indexOf(opts.variant) >= 0 ? opts.variant : 'tonal_spot';
    var isDark = !!opts.isDark;
    var key = seedRgb[0] + ',' + seedRgb[1] + ',' + seedRgb[2] + '|' + variant + '|' +
      (isDark ? 1 : 0) + '|' + spec;
    var hit = _cache.get(key);
    if (hit) return hit;

    var cam = C.fromRgb(seedRgb);
    var tone = C.lstarFromRgb(seedRgb);
    // 官方的 sourceColorHct = Hct.fromInt(seed)，其 hue/chroma 是"正向 CAM16 →
    // 求解器往返"之后的再求解值，与正向值有细微差别，调色板必须用往返值。
    var rt = C.hctFrom(cam.hue, cam.chroma, tone);
    var seed = { hue: rt.hue, chroma: rt.chroma, tone: tone, rgb: rt.rgb };
    var v2025 = spec === '2025' && !FALLBACK_2021[variant];
    var P = buildPalettes(spec, variant, seed, isDark);
    var ctx = { spec: spec, variant: variant, P: P, seed: seed, isDark: isDark, v2025: v2025 };
    var R = buildRoles(ctx);
    ctx.R = R;

    // tone 解析（官方 DynamicColor.getTone 的两种 spec 委托）
    var memo = Object.create(null);
    ctx.toneOf = function (name) {
      if (name === 'highestSurface') {
        if (memo._hs === undefined) {
          memo._hs = isDark ? ctx.toneOf('surfaceBright') : ctx.toneOf('surfaceDim');
        }
        return memo._hs;
      }
      if (memo[name] !== undefined) return memo[name];
      var def = R[name];
      var t = def.pair
        ? (v2025 ? resolvePair2025(name, def, ctx, memo) : resolvePair2021(name, def, ctx, memo))
        : resolveSolo(name, def, ctx, memo);
      memo[name] = t;
      return t;
    };

    // 带色度放大的取色
    var scaled = Object.create(null);
    function hexOf(def, tone) {
      var p = P[def.palette];
      var m = 1;
      if (def.mult === 'fg') m = foregroundMult(variant, isDark, P.neutral.hue);
      else if (def.mult) m = surfaceMult(def.mult, variant, isDark, P.neutral.hue);
      if (m === 1) return C.hex(p.at(tone).rgb);
      var k = def.palette + ':' + m.toFixed(4);
      if (!scaled[k]) scaled[k] = new C.TonalPalette(p.hue, p.chroma * m);
      return C.hex(scaled[k].at(tone).rgb);
    }

    var OUTPUT = ['background', 'surface', 'surfaceDim', 'surfaceBright',
      'surfaceContainerLowest', 'surfaceContainerLow', 'surfaceContainer',
      'surfaceContainerHigh', 'surfaceContainerHighest', 'outlineVariant',
      'primary', 'onPrimary', 'primaryContainer', 'onPrimaryContainer',
      'secondary', 'onSecondary', 'secondaryContainer', 'onSecondaryContainer',
      'tertiary', 'onTertiary', 'tertiaryContainer', 'onTertiaryContainer'];

    var roles = {};
    for (var i = 0; i < OUTPUT.length; i++) {
      var name = OUTPUT[i];
      roles[name] = hexOf(R[name], ctx.toneOf(name));
    }

    _cache.set(key, roles);
    if (_cache.size > MAX_CACHE) _cache.delete(_cache.keys().next().value);
    return roles;
  }

  // 无 pair 的角色：初始 tone → 对比度修正 → 背景尴尬区规避。
  function resolveSolo(name, def, ctx, memo) {
    var answer = def.init();
    var hasContrast = def.bg !== undefined && def.curve !== undefined;
    var bgTone, desired;
    if (hasContrast) {
      bgTone = ctx.toneOf(def.bg);
      desired = def.curve[1];
      if (C.ratioOfTones(bgTone, answer) < desired) {
        answer = C.foregroundTone(bgTone, desired);
      }
    }
    if (def.isBg) {
      if (ctx.v2025) {
        // 2025：避开 50-56 与 57-64 的边界，直接分两段钳制。
        answer = answer >= 57 ? clamp(answer, 65, 100) : clamp(answer, 0, 49);
      } else if (50 <= answer && answer < 60) {
        // 2021：能以 49 满足对比就用 49，否则 60。
        answer = hasContrast && C.ratioOfTones(49, bgTone) >= desired ? 49 : 60;
      }
    }
    return answer;
  }

  // 2021 的 ToneDeltaPair：nearer/farther 双方先各自按对比度求tone，
  // 不满足 delta 时扩展 farther、再收缩 nearer；最后规避尴尬区。
  function resolvePair2021(name, def, ctx, memo) {
    var pair = def.pair;
    var aIsNearer = pair.polarity === 'nearer' ||
      (pair.polarity === 'lighter' && !ctx.isDark) ||
      (pair.polarity === 'darker' && ctx.isDark);
    var nearerName = aIsNearer ? pair.a : pair.b;
    var fartherName = aIsNearer ? pair.b : pair.a;
    var amNearer = name === nearerName;
    var expansionDir = ctx.isDark ? 1 : -1;
    var R = ctx.R;

    var nTone = R[nearerName].init();
    var fTone = R[fartherName].init();

    var nDef = R[nearerName], fDef = R[fartherName];
    if (nDef.curve && fDef.curve) {
      var bgTone = ctx.toneOf(def.bg);
      var nContrast = nDef.curve[1];
      var fContrast = fDef.curve[1];
      if (C.ratioOfTones(bgTone, nTone) < nContrast) nTone = C.foregroundTone(bgTone, nContrast);
      if (C.ratioOfTones(bgTone, fTone) < fContrast) fTone = C.foregroundTone(bgTone, fContrast);
    }

    if ((fTone - nTone) * expansionDir < pair.delta) {
      fTone = clamp(nTone + pair.delta * expansionDir, 0, 100);
      if ((fTone - nTone) * expansionDir < pair.delta) {
        nTone = clamp(fTone - pair.delta * expansionDir, 0, 100);
      }
    }

    // 避开 50-59 的"尴尬区"。
    if (50 <= nTone && nTone < 60) {
      if (expansionDir > 0) {
        nTone = 60;
        fTone = Math.max(fTone, nTone + pair.delta * expansionDir);
      } else {
        nTone = 49;
        fTone = Math.min(fTone, nTone + pair.delta * expansionDir);
      }
    } else if (50 <= fTone && fTone < 60) {
      if (pair.stayTogether) {
        if (expansionDir > 0) {
          nTone = 60;
          fTone = Math.max(fTone, nTone + pair.delta * expansionDir);
        } else {
          nTone = 49;
          fTone = Math.min(fTone, nTone + pair.delta * expansionDir);
        }
      } else {
        fTone = expansionDir > 0 ? 60 : 49;
      }
    }

    return amNearer ? nTone : fTone;
  }

  // 2025 的 ToneDeltaPair：exact / nearer / farther 三种约束，
  // 参照方取完整解析后的 tone，之后做对比度修正与尴尬区钳制。
  function resolvePair2025(name, def, ctx, memo) {
    var pair = def.pair;
    var absoluteDelta = pair.polarity === 'darker' ||
        (pair.polarity === 'relative_lighter' && ctx.isDark) ||
        (pair.polarity === 'relative_darker' && !ctx.isDark)
      ? -pair.delta : pair.delta;
    var amRoleA = name === pair.a;
    var selfName = amRoleA ? pair.a : pair.b;
    var refName = amRoleA ? pair.b : pair.a;
    var R = ctx.R;

    var selfTone = R[selfName].init();
    var refTone = ctx.toneOf(refName);
    var relativeDelta = absoluteDelta * (amRoleA ? 1 : -1);

    if (pair.constraint === 'exact') {
      selfTone = clamp(refTone + relativeDelta, 0, 100);
    } else if (pair.constraint === 'nearer') {
      if (relativeDelta > 0) {
        selfTone = clamp(clamp(selfTone, refTone, refTone + relativeDelta), 0, 100);
      } else {
        selfTone = clamp(clamp(selfTone, refTone + relativeDelta, refTone), 0, 100);
      }
    } else if (pair.constraint === 'farther') {
      if (relativeDelta > 0) {
        selfTone = clamp(selfTone, refTone + relativeDelta, 100);
      } else {
        selfTone = clamp(selfTone, 0, refTone + relativeDelta);
      }
    }

    if (def.bg !== undefined && def.curve !== undefined) {
      var bgTone = ctx.toneOf(def.bg);
      var desired = def.curve[1];
      if (C.ratioOfTones(bgTone, selfTone) < desired) {
        selfTone = C.foregroundTone(bgTone, desired);
      }
    }

    if (def.isBg) {
      selfTone = selfTone >= 57 ? clamp(selfTone, 65, 100) : clamp(selfTone, 0, 49);
    }
    return selfTone;
  }

  // role → 项目里的 --md-* 令牌
  var CSS_VAR = {
    background: '--md-background',
    surface: '--md-surface',
    surfaceDim: '--md-surface-dim',
    surfaceBright: '--md-surface-bright',
    surfaceContainerLowest: '--md-surface-container-lowest',
    surfaceContainerLow: '--md-surface-container-low',
    surfaceContainer: '--md-surface-container',
    surfaceContainerHigh: '--md-surface-container-high',
    surfaceContainerHighest: '--md-surface-container-highest',
    outlineVariant: '--md-outline-variant',
    primary: '--md-primary',
    onPrimary: '--md-on-primary',
    primaryContainer: '--md-primary-container',
    onPrimaryContainer: '--md-on-primary-container',
    secondary: '--md-secondary',
    onSecondary: '--md-on-secondary',
    secondaryContainer: '--md-secondary-container',
    onSecondaryContainer: '--md-on-secondary-container',
    tertiary: '--md-tertiary',
    onTertiary: '--md-on-tertiary',
    tertiaryContainer: '--md-tertiary-container',
    onTertiaryContainer: '--md-on-tertiary-container',
  };

  function apply(roles, root, suffix) {
    suffix = suffix || '';
    for (var role in CSS_VAR) {
      var v = roles[role];
      if (v) root.style.setProperty(CSS_VAR[role] + suffix, v);
    }
  }

  window.AppColorSpec = {
    VARIANTS: VARIANTS,
    generate: generate,
    apply: apply,
    CSS_VAR: CSS_VAR,
  };
})();
