/**
 * Carminium — 自绘标题栏逻辑
 *
 * 功能：
 * - 窗口控制按钮（最小化 / 最大化还原 / 关闭）
 * - 返回按钮（导航回上一页）
 * - 版本号注入
 * - 最大化状态同步（双击标题栏切换最大化）
 * - 标题栏图标：三大金刚键用 Segoe Fluent Icons 系统字体（码点 U+E921/E922/E923/E8BB）；返回键用内联 SVG
 * - Logo SVG 运行时加载 + Material You 重新着色
 */
(function () {
  'use strict';

  var App = window.App || (window.App = {});

  // ── 导航历史：由 app.js 的 navigate() 直接管理，titlebar 只读取状态 ──

  // ── 标题栏图标 ───────────────────────────────────────────────
  //
  // 三大金刚键（最小化 / 最大化还原 / 关闭）使用 Segoe Fluent Icons 系统字体。
  // 码点以用户确认表为准（U+E921/E922/E923/E8BB），无检测、无备选；
  // 字体直写，不依赖 canvas 或备选码点。
  // 返回键沿用内联 SVG（跨平台一致，不依赖系统字体）。

  var ICON_SVG = {
    back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 6l-6 6 6 6"/></svg>',
  };

  // Segoe Fluent Icons 码点（用户确认：U+E921/E922/E923/E8BB）
  var MDL2 = {
    minimize: '\uE921',    // ChromeMinimize
    maximize: '\uE922',    // ChromeMaximize
    restore:  '\uE923',    // ChromeRestore
    close:    '\uE8BB',    // ChromeClose
  };

  function _applyIcons() {
    // 返回键：内联 SVG
    _setSvg('title-bar-back-icon', ICON_SVG.back);

    // 三大金刚键：MDL2 字体 + 码点（直写，无检测/无备选）
    ['title-bar-min-icon', 'title-bar-max-icon', 'title-bar-close-icon'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.style.fontFamily = '"Segoe Fluent Icons", sans-serif';
    });
    _setGlyph('title-bar-min-icon', MDL2.minimize);
    _setGlyph('title-bar-close-icon', MDL2.close);

    var isMax = document.body.classList.contains('window-maximized');
    _setGlyph('title-bar-max-icon', isMax ? MDL2.restore : MDL2.maximize);
  }

  function _setGlyph(id, code) {
    var el = document.getElementById(id);
    if (el) el.textContent = code;
  }

  function _setSvg(id, svg) {
    var el = document.getElementById(id);
    if (el) el.innerHTML = svg;
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
   * 加载 Logo SVG 并注入到标题栏。
   * 保留 SVG 原有品牌色，仅由 CSS（见 style.css）随明暗主题做轻微亮度/饱和度微调，
   * 不再做逐色重着色，避免脆弱逻辑。
   */
  function _loadLogo() {
    var container = document.getElementById('title-bar-logo');
    if (!container) return;

    var src = _getLogoSrc();

    fetch(src)
      .then(function (res) { return res.text(); })
      .then(function (svgText) {
        container.innerHTML = svgText;
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
    _applyIcons();
    _bindWindowControls();
    _bindBackButton();
    _bindDoubleClick();
    _loadVersionInfo();
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
      if (App.goBack) {
        App.goBack();
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

  // ── 版本号 ────────────────────────────────────────────────────

  function _loadVersionInfo() {
    var versionEl = document.getElementById('title-bar-version');

    if (!versionEl) return;

    if (App.utils && App.utils.call) {
      App.utils.call('get_app_info').then(function (res) {
        var info;
        try { info = JSON.parse(res); } catch (e) { return; }

        if (versionEl && info.version) {
          versionEl.textContent = '' + info.version;
        }
      });
    }
  }

  // ── DOM Ready ────────────────────────────────────────────────

  function _updateBackButton() {
    var backBtn = document.getElementById('title-bar-back');
    if (!backBtn) return;

    var history = App.navHistory || [];
    var canGoBack = history.length > 1;
    // 设置页始终启用返回按钮（作为退出设置入口）
    if (App.state && App.state.currentPage === 'settings') canGoBack = true;
    backBtn.disabled = !canGoBack;
    backBtn.style.opacity = canGoBack ? '' : '0.4';
    backBtn.style.pointerEvents = canGoBack ? '' : 'none';
  }

  // ── 最大化状态同步（由主进程推送）────────────────────────────

  window.__updateMaximizedState = function (isMaximized) {
    document.body.classList.toggle('window-maximized', !!isMaximized);
    // 切换最大化 / 还原 MDL2 码点
    _setGlyph('title-bar-max-icon', isMaximized ? MDL2.restore : MDL2.maximize);
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

  App.titlebar = { init: init, updateBackButton: _updateBackButton };
})();
