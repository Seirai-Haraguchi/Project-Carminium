(function () {
  'use strict';

  const App = window.App = window.App || {};

  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const l = (max + min) / 2;
    let h = 0, s = 0;
    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) h = ((g - b) / d + (g < b ? 6 : 0));
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
    }
    return [h, s * 100, l * 100];
  }

  function hsl(h, s, l) {
    return 'hsl(' + ((h % 360) + 360) % 360 + ', ' + s + '%, ' + l + '%)';
  }

  function _tonalRamp(h, s, l, isDark) {

    const sat = Math.max(35, Math.min(s, 82));
    const lightCover = l > 52;
    return {
      accent:      hsl(h, sat, isDark ? 78 : 42),
      onAccent:    hsl(h, sat, isDark ? 18 : 100),
      container:   hsl(h, sat, lightCover ? 26 : 34),
      onContainer: hsl(h, sat, 96),
    };
  }

  function extractDominant(img) {
    try {
      const N = 16;
      const cv = document.createElement('canvas');
      cv.width = N; cv.height = N;
      const ctx = cv.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, N, N);
      const data = ctx.getImageData(0, 0, N, N).data;

      const buckets = new Map();
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] < 128) continue;
        const key = (data[i] >> 4) * 256 + (data[i + 1] >> 4) * 16 + (data[i + 2] >> 4);
        let b = buckets.get(key);
        if (!b) { b = [0, 0, 0, 0]; buckets.set(key, b); }
        b[0] += data[i]; b[1] += data[i + 1]; b[2] += data[i + 2]; b[3]++;
      }
      if (buckets.size === 0) return null;

      let best = null, bestScore = -1;
      buckets.forEach(function (b) {
        const r = b[0] / b[3], g = b[1] / b[3], bl = b[2] / b[3];
        const [, s, l] = rgbToHsl(r, g, bl);

        const lumPenalty = (l < 12 || l > 92) ? 0.25 : 1;
        const score = b[3] * lumPenalty;
        if (score > bestScore) { bestScore = score; best = [r, g, bl]; }
      });
      return best;
    } catch (e) {
      return null;
    }
  }

  const _cache = new Map();
  const _pending = new Map();
  const _tinted = new Set();

  function applyCardColor(url, card, isDark) {
    if (!url || !card) return;

    const paint = function (rgb) {
      if (!rgb) return;

      card.dataset.ymRgb = JSON.stringify(rgb);
      _paint(card, rgb, isDark);
    };

    if (_cache.has(url)) { paint(_cache.get(url)); return; }
    if (_pending.has(url)) { _pending.get(url).push(paint); return; }

    _pending.set(url, [paint]);
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    img.onload = function () {
      const rgb = extractDominant(img);
      if (rgb) _cache.set(url, rgb);
      const cbs = _pending.get(url) || [];
      _pending.delete(url);
      cbs.forEach(function (cb) { cb(rgb); });
    };
    img.onerror = function () {
      const cbs = _pending.get(url) || [];
      _pending.delete(url);
      cbs.forEach(function (cb) { cb(null); });
    };
    img.src = url;
  }

  function tintCards(root, isDark) {
    if (!root) return;
    root.querySelectorAll('.ym-card').forEach(function (card) {
      _tinted.add(card);
      if (card.dataset.ymTinted === '1') return;
      card.dataset.ymTinted = '1';

      const mosaic = card.querySelector('.ym-mosaic-cover');
      if (mosaic) { _tintMosaic(card, mosaic, isDark); return; }

      const img = card.querySelector('.ym-card-art img');
      if (img) {
        if (img.complete && img.naturalWidth > 0) {
          applyCardColor(img.currentSrc || img.src, card, isDark);
        } else {
          img.addEventListener('load', function () {
            applyCardColor(img.currentSrc || img.src, card, isDark);
          }, { once: true });

        }
        return;
      }

      const svg = card.querySelector('.ym-card-art svg');
      const stop = svg && svg.querySelector('stop[stop-color]');
      if (stop) {
        const c = stop.getAttribute('stop-color');
        if (c && c[0] === '#') {
          const rgb = [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
          card.dataset.ymRgb = JSON.stringify(rgb);
          _paint(card, rgb, isDark);
        }
      }
    });
  }

  function _tintMosaic(card, mosaic, isDark) {
    const imgs = Array.from(mosaic.querySelectorAll('img'));
    if (imgs.length === 0) return;

    let left = imgs.length;
    const got = [];

    const finish = function () {
      if (got.length === 0) return;
      const avg = [
        got.reduce((s, c) => s + c[0], 0) / got.length,
        got.reduce((s, c) => s + c[1], 0) / got.length,
        got.reduce((s, c) => s + c[2], 0) / got.length,
      ].map(Math.round);
      card.dataset.ymRgb = JSON.stringify(avg);

      let maxL = 0;
      got.forEach(function (c) {
        const l = rgbToHsl(c[0], c[1], c[2])[2];
        if (l > maxL) maxL = l;
      });
      card.dataset.ymCovL = maxL.toFixed(1);
      _paint(card, avg, isDark, maxL);
    };

    imgs.forEach(function (img) {
      const handle = function (ok) {
        if (ok) {
          const c = _dominantFromImg(img);
          if (c) got.push(c);
        }
        if (--left === 0) finish();
      };
      if (img.complete && img.naturalWidth > 0) {
        handle(true);
      } else {
        img.addEventListener('load', function () { handle(true); }, { once: true });
        img.addEventListener('error', function () { handle(false); }, { once: true });
      }
    });
  }

  function _dominantFromImg(img) {
    if (!img.naturalWidth) return null;
    try {
      const N = 12;
      const cv = document.createElement('canvas');
      cv.width = N; cv.height = N;
      const ctx = cv.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, N, N);
      const data = ctx.getImageData(0, 0, N, N).data;
      let r = 0, g = 0, b = 0, n = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] < 128) continue;
        r += data[i]; g += data[i + 1]; b += data[i + 2]; n++;
      }
      return n ? [r / n, g / n, b / n] : null;
    } catch (e) {
      return null;
    }
  }

  function _paint(card, rgb, isDark, coverL) {
    const [h, s, l] = rgbToHsl(rgb[0], rgb[1], rgb[2]);
    const r = _tonalRamp(h, s, coverL !== undefined ? coverL : l, isDark);
    const st = card.style;
    st.setProperty('--ym-a', r.accent);
    st.setProperty('--ym-on-a', r.onAccent);
    st.setProperty('--ym-a-container', r.container);
    st.setProperty('--ym-on-a-container', r.onContainer);
    card.classList.add('ym-card--tonal');
  }

  function _watchTheme() {
    const root = document.documentElement;
    if (window.MutationObserver && !root.__ymThemeWatch) {
      const mo = new MutationObserver(function () {
        if (!window.CardColor) return;
        window.CardColor.retint();
      });
      mo.observe(root, { attributes: true, attributeFilter: ['data-theme'] });
      root.__ymThemeWatch = true;
    }
  }

  function retint() {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    _tinted.forEach(function (card) {
      if (!card.isConnected) { _tinted.delete(card); return; }
      const src = card.dataset.ymRgb;
      if (src) {
        const covL = card.dataset.ymCovL ? parseFloat(card.dataset.ymCovL) : undefined;
        try { _paint(card, JSON.parse(src), isDark, covL); } catch (e) {  }
      }
    });
  }

  function invalidate() {
    _cache.clear();
  }

  window.CardColor = { tintCards: tintCards, retint: retint, invalidate: invalidate, rgbToHsl: rgbToHsl };
  _watchTheme();
  void App;
})();
