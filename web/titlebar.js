/**
 * Carminium — 自绘标题栏逻辑
 *
 * 功能：
 * - 窗口控制按钮（最小化 / 最大化还原 / 关闭）
 * - 返回按钮（导航回上一页）
 * - 版本号与开发代号注入
 * - 最大化状态同步（双击标题栏切换最大化）
 * - Segoe Fluent Icons / MDL2 Assets 图标自动检测
 * - Logo SVG 运行时加载 + Material You 重新着色
 */
(function () {
  'use strict';

  var App = window.App || (window.App = {});

  // ── 导航历史（用于返回按钮）─────────────────────────────────
  var _navHistory = [];

  // 记录原始 navigate 函数，用于劫持以跟踪历史
  var _originalNavigate = null;

  // ── 图标字体检测与码点表 ─────────────────────────────────────
  //
  // Segoe Fluent Icons 和 Segoe MDL2 Assets 的大部分码点相同，
  // 但 ChromeMaximize / ChromeRestore 的码点不同，需要根据
  // 实际可用字体选择正确的码点。
  //
  // 通用码点（两种字体一致）：
  //   ChromeBack      \uE72B
  //   ChromeMinimize  \uE921
  //   ChromeClose     \uE8BB
  //
  // 差异码点：
  //                  Fluent       MDL2
  //   ChromeMaximize  \uE922      \uE940
  //   ChromeRestore   \uE923      \uE73F

  var _iconFont = null; // 'fluent' | 'mdl2' | null

  /**
   * 通过 Canvas 测量检测系统是否安装了 Segoe Fluent Icons 或
   * Segoe MDL2 Assets 字体。
   */
  function _detectIconFont() {
    try {
      var canvas = document.createElement('canvas');
      var ctx = canvas.getContext('2d');
      var testChar = '\uE921'; // ChromeMinimize — 两种字体都有

      ctx.font = '72px sans-serif';
      var defaultW = ctx.measureText(testChar).width;

      ctx.font = '72px "Segoe Fluent Icons"';
      var fluentW = ctx.measureText(testChar).width;

      if (fluentW !== defaultW) return 'fluent';

      ctx.font = '72px "Segoe MDL2 Assets"';
      var mdl2W = ctx.measureText(testChar).width;

      if (mdl2W !== defaultW) return 'mdl2';
    } catch (e) { /* ignore */ }
    return null;
  }

  /**
   * 返回当前应使用的图标码点集合。
   */
  function _getIcons() {
    var maximize, restore;
    if (_iconFont === 'fluent') {
      maximize = '\uE922';
      restore = '\uE923';
    } else {
      // MDL2 或降级 — 使用 MDL2 码点
      maximize = '\uE940';
      restore = '\uE73F';
    }
    return {
      back: '\uE72B',
      minimize: '\uE921',
      maximize: maximize,
      restore: restore,
      close: '\uE8BB',
    };
  }

  /**
   * 将所有标题栏图标 span 填入正确的码点。
   */
  function _applyIcons() {
    var icons = _getIcons();
    _setIcon('title-bar-back-icon', icons.back);
    _setIcon('title-bar-min-icon', icons.minimize);
    _setIcon('title-bar-close-icon', icons.close);

    // 最大化/还原图标取决于当前窗口状态
    var isMax = document.body.classList.contains('window-maximized');
    _setIcon('title-bar-max-icon', isMax ? icons.restore : icons.maximize);
  }

  function _setIcon(id, glyph) {
    var el = document.getElementById(id);
    if (el) el.textContent = glyph;
  }

  // ── Logo SVG 加载 + Material You 重新着色 ────────────────────

  /**
   * 根据当前主题返回应加载的 SVG 文件路径。
   */
  function _getLogoSrc() {
    var isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    return isDark ? 'logo-dark.svg' : 'logo.svg';
  }

  /**
   * 解析 SVG 文本，识别背景色和 Logo 主色，用 Material You 重新着色。
   *
   * 策略：
   * 1. 解析 SVG 为 DOM
   * 2. 遍历所有元素的 fill / stroke 颜色
   * 3. 中性色（白/黑/灰，低饱和度）= 背景色 → 设为 none（透明）
   * 4. 有彩色（高饱和度，如红/蓝/绿）= Logo 主色 → 设为 currentColor
   * 5. 无显式 fill 但有路径数据的元素 → 补上 fill="currentColor"
   * 6. 保持 SVG 根元素的 fill="none" 不变（不污染背景）
   */
  function _recolorSvg(svgText) {
    var parser = new DOMParser();
    var doc = parser.parseFromString(svgText, 'image/svg+xml');
    var svg = doc.querySelector('svg');
    if (!svg) return svgText;

    // 移除 width / height 属性，让 CSS 控制
    svg.removeAttribute('width');
    svg.removeAttribute('height');

    var allEls = svg.querySelectorAll('*');
    allEls.forEach(function (el) {
      var fill = el.getAttribute('fill');

      if (fill && fill !== 'none' && fill !== 'currentColor') {
        if (_isNeutralColor(fill)) {
          // 中性色 = 背景 → 透明
          el.setAttribute('fill', 'none');
        } else {
          // 有彩色 = Logo 主色 → Material You 着色
          el.setAttribute('fill', 'currentColor');
        }
      } else if ((!fill || fill === 'none') && el.getAttribute('d') &&
                 el.tagName.toLowerCase() !== 'rect') {
        // 路径无显式 fill 或继承了 none → 补上 currentColor
        el.setAttribute('fill', 'currentColor');
      }

      // stroke 同理
      var stroke = el.getAttribute('stroke');
      if (stroke && stroke !== 'none' && stroke !== 'currentColor') {
        if (_isNeutralColor(stroke)) {
          el.setAttribute('stroke', 'none');
        } else {
          el.setAttribute('stroke', 'currentColor');
        }
      }
    });

    // 保持根元素 fill="none"，不覆盖
    // 序列化回 HTML 字符串
    var serializer = new XMLSerializer();
    return serializer.serializeToString(svg);
  }

  /**
   * 判断颜色是否为中性色（白/黑/灰）。
   * 中性色的 HSL 饱和度很低（<15%），或明度极高/极低。
   *
   * @param {string} color - CSS 颜色值（hex、rgb()、命名颜色）
   * @returns {boolean}
   */
  function _isNeutralColor(color) {
    if (!color) return true;
    color = color.trim().toLowerCase();

    // 常见中性命名颜色
    var namedNeutrals = ['white', 'black', 'transparent',
                          'gray', 'grey', 'silver', 'dimgray', 'dimgrey',
                          'darkgray', 'darkgrey', 'lightgray', 'lightgrey',
                          'gainsboro', 'whitesmoke', 'snow',
                          'black', 'ivory', 'seashell'];
    if (namedNeutrals.indexOf(color) >= 0) return true;

    // 解析为 RGB 再转 HSL
    var rgb = _parseColor(color);
    if (!rgb) return false;

    var hsl = _rgbToHsl(rgb[0], rgb[1], rgb[2]);
    // 饱和度 < 15% 或明度 > 92% 或明度 < 8% → 中性色
    return hsl[1] < 15 || hsl[2] > 92 || hsl[2] < 8;
  }

  /**
   * 将 CSS 颜色字符串解析为 [r, g, b]（0-255）。
   * 支持 #hex、rgb()、rgba()。
   */
  function _parseColor(color) {
    color = color.trim().toLowerCase();

    // #hex
    var hexMatch = color.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/);
    if (hexMatch) {
      var hex = hexMatch[1];
      if (hex.length === 3) {
        return [
          parseInt(hex[0] + hex[0], 16),
          parseInt(hex[1] + hex[1], 16),
          parseInt(hex[2] + hex[2], 16),
        ];
      }
      return [
        parseInt(hex.substr(0, 2), 16),
        parseInt(hex.substr(2, 2), 16),
        parseInt(hex.substr(4, 2), 16),
      ];
    }

    // rgb() / rgba()
    var rgbMatch = color.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
    if (rgbMatch) {
      return [
        parseInt(rgbMatch[1], 10),
        parseInt(rgbMatch[2], 10),
        parseInt(rgbMatch[3], 10),
      ];
    }

    return null;
  }

  /**
   * RGB → HSL 转换，返回 [h(0-360), s(0-100), l(0-100)]。
   */
  function _rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    var max = Math.max(r, g, b), min = Math.min(r, g, b);
    var h = 0, s = 0, l = (max + min) / 2;

    if (max !== min) {
      var d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      switch (max) {
        case r: h = (g - b) / d + (g < b ? 6 : 0); break;
        case g: h = (b - r) / d + 2; break;
        case b: h = (r - g) / d + 4; break;
      }
      h *= 60;
    }

    return [Math.round(h), Math.round(s * 100), Math.round(l * 100)];
  }

  /**
   * 加载 Logo SVG 并注入到标题栏，应用 Material You 着色。
   */
  function _loadLogo() {
    var container = document.getElementById('title-bar-logo');
    if (!container) return;

    var src = _getLogoSrc();

    fetch(src)
      .then(function (res) { return res.text(); })
      .then(function (svgText) {
        var recolored = _recolorSvg(svgText);
        container.innerHTML = recolored;
      })
      .catch(function (e) {
        console.warn('[titlebar] 加载 logo 失败:', src, e);
      });
  }

  /**
   * 监听主题变化，自动切换 logo 并重新着色。
   */
  function _watchThemeChange() {
    var observer = new MutationObserver(function (mutations) {
      mutations.forEach(function (m) {
        if (m.attributeName === 'data-theme') {
          _loadLogo();
        }
      });
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  }

  /**
   * 初始化标题栏
   */
  function init() {
    _iconFont = _detectIconFont();
    _applyIcons();
    _bindWindowControls();
    _bindBackButton();
    _bindDoubleClick();
    _loadVersionInfo();
    _hookNavigation();
    _loadLogo();
    _watchThemeChange();
  }

  // ── 窗口控制按钮 ─────────────────────────────────────────────

  function _bindWindowControls() {
    var minBtn = document.getElementById('title-bar-min');
    var maxBtn = document.getElementById('title-bar-max');
    var closeBtn = document.getElementById('title-bar-close');

    if (minBtn) {
      minBtn.addEventListener('click', function () {
        if (window.__electronAPI) {
          window.__electronAPI.invoke('minimize_window');
        }
      });
    }

    if (maxBtn) {
      maxBtn.addEventListener('click', function () {
        if (window.__electronAPI) {
          window.__electronAPI.invoke('maximize_window');
        }
      });
    }

    if (closeBtn) {
      closeBtn.addEventListener('click', function () {
        if (window.__electronAPI) {
          window.__electronAPI.invoke('close_window');
        }
      });
    }
  }

  // ── 返回按钮 ─────────────────────────────────────────────────

  function _bindBackButton() {
    var backBtn = document.getElementById('title-bar-back');
    if (!backBtn) return;

    backBtn.addEventListener('click', function () {
      if (_navHistory.length > 1) {
        _navHistory.pop(); // 弹出当前页
        var prevPage = _navHistory[_navHistory.length - 1];
        if (prevPage && App.navigate) {
          // 不再压入历史（避免循环）
          _navHistory._suppressPush = true;
          App.navigate(prevPage);
          _navHistory._suppressPush = false;
        }
      } else {
        // 无历史可返回：回到音乐页
        if (App.navigate) App.navigate('music');
      }
      _updateBackButton();
    });
  }

  // ── 双击标题栏切换最大化 ─────────────────────────────────────

  function _bindDoubleClick() {
    var titleBar = document.getElementById('title-bar');
    if (!titleBar) return;

    titleBar.addEventListener('dblclick', function (e) {
      // 排除按钮区域
      if (e.target.closest('.title-bar-btn')) return;
      if (window.__electronAPI) {
        window.__electronAPI.invoke('maximize_window');
      }
    });
  }

  // ── 版本号与开发代号 ─────────────────────────────────────────

  function _loadVersionInfo() {
    var versionEl = document.getElementById('title-bar-version');
    var codenameEl = document.getElementById('title-bar-codename');

    if (!versionEl && !codenameEl) return;

    if (App.utils && App.utils.call) {
      App.utils.call('get_app_info').then(function (res) {
        var info;
        try { info = JSON.parse(res); } catch (e) { return; }

        if (versionEl && info.version) {
          versionEl.textContent = '' + info.version;
        }
        if (codenameEl && info.codename) {
          codenameEl.textContent = info.codename;
        }
      });
    }
  }

  // ── 导航历史跟踪 ─────────────────────────────────────────────

  function _hookNavigation() {
    // 等 App.navigate 可用后再劫持
    var checkInterval = setInterval(function () {
      if (App.navigate && !App.navigate._hooked) {
        _originalNavigate = App.navigate;
        App.navigate = function (pageId, params) {
          if (!_navHistory._suppressPush) {
            _navHistory.push(pageId);
            if (_navHistory.length > 20) _navHistory.shift();
          }
          _updateBackButton();
          return _originalNavigate.apply(this, arguments);
        };
        App.navigate._hooked = true;
        clearInterval(checkInterval);
      }
    }, 100);

    // 超时清理
    setTimeout(function () { clearInterval(checkInterval); }, 10000);
  }

  // ── 返回按钮状态更新 ─────────────────────────────────────────

  function _updateBackButton() {
    var backBtn = document.getElementById('title-bar-back');
    if (!backBtn) return;

    var canGoBack = _navHistory.length > 1;
    backBtn.disabled = !canGoBack;
    backBtn.style.opacity = canGoBack ? '' : '0.4';
    backBtn.style.pointerEvents = canGoBack ? '' : 'none';
  }

  // ── 最大化状态同步（由主进程推送）────────────────────────────

  window.__updateMaximizedState = function (isMaximized) {
    document.body.classList.toggle('window-maximized', !!isMaximized);
    var icons = _getIcons();
    _setIcon('title-bar-max-icon', isMaximized ? icons.restore : icons.maximize);
  };

  // ── 全屏状态同步（由主进程推送）───────────────────────────────

  window.__updateFullscreenState = function (isFullscreen) {
    document.body.classList.toggle('window-fullscreen', !!isFullscreen);
  };

  // ── DOM Ready ────────────────────────────────────────────────

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  App.titlebar = { init: init };
})();
