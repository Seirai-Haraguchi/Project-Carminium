/**
 * Carminium — 探新页「内容取色」（Material You 的核心）
 *
 * Material You 的灵魂不是固定配色，而是**UI 从内容里长出来**：
 * 每张卡的强调色来自它自己的封面，这样一屏里每张卡都"有自己的颜色"。
 *
 * 与 utils.applyDynamicTheme（全局面板主题，从当前播放封面取色）不同，
 * 这里做的是**卡级**取色：只影响该卡自己的 CSS 变量，不污染全局。
 *
 * 复用 cover_cache.js 的中位切割思路（_extractColors），
 * 但只取 1 个主色 + 算 M3 需要的 tonal 色阶，比全量 16 色便宜得多。
 */
(function () {
  'use strict';

  const window = window;
  const document = document;
  const App = window.App = window.App || {};

  // ── HSL 工具（与 utils.rgbToHsl 同一套算法，保证色相一致）───────────────
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

  /**
   * M3 色阶：把一个种子色展开成该卡需要的完整角色色。
   *
   * 关键：**明度必须跟着封面的实际明度走，不能只看全局主题**。
   * 卡片封面有深有浅，徽章底色若一律用同一档，浅封面上就压不住。
   * 所以这里取种子的**明度**做判断，分两档：
   *   浅封面 → 徽章底压深一点（26%），保证白字对比
   *   深封面 → 徽章底可略亮（34%），融进画面不突兀
   */
  function _tonalRamp(h, s, l, isDark) {
    // chroma 收敛到 Material You 的区间（动态主题用 moderate: 35–82）
    const sat = Math.max(35, Math.min(s, 82));
    const lightCover = l > 52;                 // 种子偏亮 → 封面整体偏亮
    return {
      accent:      hsl(h, sat, isDark ? 78 : 42),       // 播放按钮实心色
      onAccent:    hsl(h, sat, isDark ? 18 : 100),
      container:   hsl(h, sat, lightCover ? 26 : 34),   // 徽章底
      onContainer: hsl(h, sat, 96),
    };
  }

  /**
   * 从封面图提取主色。
   * 采样 16×16（256px），只统计有透明度的像素；
   * 用「出现频次最多的量化色桶」而非简单平均 —— 平均会把互补色混成脏灰。
   */
  function extractDominant(img) {
    try {
      const N = 16;
      const cv = document.createElement('canvas');
      cv.width = N; cv.height = N;
      const ctx = cv.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, N, N);
      const data = ctx.getImageData(0, 0, N, N).data;

      // 量化到 4×4×4 = 64 个桶，取像素数最多且亮度不极端的桶
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
        // 频次为主，但惩罚过暗/过亮（接近黑白的封面取色没有信息量）
        const lumPenalty = (l < 12 || l > 92) ? 0.25 : 1;
        const score = b[3] * lumPenalty;
        if (score > bestScore) { bestScore = score; best = [r, g, bl]; }
      });
      return best;
    } catch (e) {
      return null;
    }
  }

  const _cache = new Map();   // url → rgb[]
  const _pending = new Map(); // url → [callback]
  const _tinted = new Set();  // 已染色的卡片（主题切换时重算）

  /**
   * 确保某张卡片的封面主色已就绪，然后把它写进卡片的 CSS 变量。
   * 同一 URL 只取色一次（多张卡共用同一封面时省掉重复 canvas 读取）。
   *
   * @param {string}   url    封面地址
   * @param {Element}  card   目标卡片（变量写在它自己身上，不污染全局）
   * @param {boolean}  isDark 当前是否深色主题
   */
  function applyCardColor(url, card, isDark) {
    if (!url || !card) return;

    const paint = function (rgb) {
      if (!rgb) return;
      // 存下原始 rgb，主题切换时据此重算色阶（明度档位随 isDark 变化）
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

  /**
   * 扫描一个容器内的所有卡片，为每张卡绑定其封面的主色。
   * 三种封面形态：
   *   1. 拼贴（.ym-mosaic-cover，4 格）→ 4 张取色后求平均，代表整张卡
   *   2. 单图（img）→ 直接取色
   *   3. 抽象图形 SVG → 读渐变首个 stop-color
   * @param {Element} root  容器（rail 或 hero）
   * @param {boolean} isDark
   */
  function tintCards(root, isDark) {
    if (!root) return;
    root.querySelectorAll('.ym-card').forEach(function (card) {
      _tinted.add(card);
      if (card.dataset.ymTinted === '1') return;
      card.dataset.ymTinted = '1';

      // 1) 拼贴封面：多图聚合
      const mosaic = card.querySelector('.ym-mosaic-cover');
      if (mosaic) { _tintMosaic(card, mosaic, isDark); return; }

      // 2) 单图封面
      const img = card.querySelector('.ym-card-art img');
      if (img) {
        if (img.complete && img.naturalWidth > 0) {
          applyCardColor(img.currentSrc || img.src, card, isDark);
        } else {
          img.addEventListener('load', function () {
            applyCardColor(img.currentSrc || img.src, card, isDark);
          }, { once: true });
          // 加载失败 → 回退到全局 primary（CSS 默认值即是）
        }
        return;
      }

      // 3) 抽象图形 SVG：读渐变的第一个 stop-color
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

  /**
   * 拼贴封面取色：4 格各自取色后求平均。
   * 用平均而不是取第一格 —— 拼贴本身是多色的，单格不能代表整张卡。
   * 任一格失败不影响其余；全部失败则回退（不染色）。
   */
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
      // 明度用**各格最亮者**而不是平均：文字压在整张拼贴上，
      // 只要有一格够亮，遮罩就必须按那一格的亮度来定，否则那格上白字读不清。
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

  /** 从已在 DOM 中的 <img> 直接取主色（拼贴用，省掉新建 Image 的开销） */
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

  /**
   * 把一组 rgb 写进卡片的 tonal 变量（取色与主题切换共用）。
   * @param {number} [coverL] 封面实际明度（拼贴传「最亮格」明度）；缺省用种子自身明度
   */
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

  /**
   * 主题切换：色阶明度档位不同，必须重算。
   * 直接监听 <html data-theme>，调用方无需配合。
   */
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

  /** 主题切换后重算所有已染色卡片 */
  function retint() {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    _tinted.forEach(function (card) {
      if (!card.isConnected) { _tinted.delete(card); return; }
      const src = card.dataset.ymRgb;
      if (src) {
        const covL = card.dataset.ymCovL ? parseFloat(card.dataset.ymCovL) : undefined;
        try { _paint(card, JSON.parse(src), isDark, covL); } catch (e) { /* ignore */ }
      }
    });
  }

  // 主题切换后需重算（明度档位不同）
  function invalidate() {
    _cache.clear();
  }

  window.CardColor = { tintCards: tintCards, retint: retint, invalidate: invalidate, rgbToHsl: rgbToHsl };
  _watchTheme();
  void App;
})();
