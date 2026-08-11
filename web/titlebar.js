/**
 * Carminium — 自绘标题栏逻辑
 *
 * 功能：
 * - 窗口控制按钮（最小化 / 最大化还原 / 关闭）
 * - 返回按钮（导航回上一页）
 * - 版本号注入
 * - 最大化状态同步（双击标题栏切换最大化）
 * - 标题栏图标：
 *   Windows: 三大金刚键用 Segoe Fluent Icons 系统字体（码点 U+E921/E922/E923/E8BB）
 *   Linux/macOS: macOS 风格红绿灯按钮（圆点 + hover 图标）
 * - 返回键用内联 SVG
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

  // ── 平台检测 ───────────────────────────────────────────────
  var _platform = (window.__electronAPI && window.__electronAPI.platform) || 'win32';
  var _isWin = _platform === 'win32';

  // 红绿灯 SVG 图标（hover 时显示）
  var TRAFFIC_SVG = {
    close:    '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M3 3l6 6M9 3l-6 6"/></svg>',
    minimize: '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M2.5 6h7"/></svg>',
    maximize: '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 4.5v4a.5.5 0 0 0 .5.5h4a.5.5 0 0 0 .5-.5v-4a.5.5 0 0 0-.5-.5h-4a.5.5 0 0 0-.5.5z"/><path d="M5 3h4a.5.5 0 0 1 .5.5v4"/></svg>',
    restore:  '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 5v3a.5.5 0 0 0 .5.5h3a.5.5 0 0 0 .5-.5v-3a.5.5 0 0 0-.5-.5h-3a.5.5 0 0 0-.5.5z"/><path d="M5 2.5h3a.5.5 0 0 1 .5.5v3"/></svg>',
  };

  function _applyIcons() {
    // 返回键：内联 SVG
    _setSvg('title-bar-back-icon', ICON_SVG.back);

    if (_isWin) {
      // Windows: 三大金刚键用 Segoe Fluent Icons 字体
      ['title-bar-min-icon', 'title-bar-max-icon', 'title-bar-close-icon'].forEach(function (id) {
        var el = document.getElementById(id);
        if (el) el.style.fontFamily = '"Segoe Fluent Icons", sans-serif';
      });
      _setGlyph('title-bar-min-icon', MDL2.minimize);
      _setGlyph('title-bar-close-icon', MDL2.close);

      var isMax = document.body.classList.contains('window-maximized');
      _setGlyph('title-bar-max-icon', isMax ? MDL2.restore : MDL2.maximize);
    } else {
      // Linux/macOS: 红绿灯按钮，hover 时显示 SVG 图标
      _setSvg('title-bar-close-icon', TRAFFIC_SVG.close);
      _setSvg('title-bar-min-icon', TRAFFIC_SVG.minimize);
      var isMax2 = document.body.classList.contains('window-maximized');
      _setSvg('title-bar-max-icon', isMax2 ? TRAFFIC_SVG.restore : TRAFFIC_SVG.maximize);
    }
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
    // 平台 class 注入
    document.body.classList.add('platform-' + _platform);
    if (!_isWin) document.body.classList.add('platform-non-win');

    // 非 Windows: 将三大金刚键移到左侧（macOS 风格）
    if (!_isWin) _rearrangeTrafficLights();

    _applyIcons();
    _bindWindowControls();
    _bindBackButton();
    _bindDoubleClick();
    _loadVersionInfo();
    _loadLogo();
    _watchThemeChange();
  }

  /**
   * 将 close/min/max 按钮移到标题栏左侧，按 macOS 顺序排列（close, min, max）。
   * 包裹在 .traffic-light 容器中以便 CSS 样式化。
   */
  function _rearrangeTrafficLights() {
    var leftContainer = document.querySelector('.title-bar-left');
    if (!leftContainer) return;

    var closeBtn = document.getElementById('title-bar-close');
    var minBtn = document.getElementById('title-bar-min');
    var maxBtn = document.getElementById('title-bar-max');
    if (!closeBtn || !minBtn || !maxBtn) return;

    // 创建红绿灯容器
    var group = document.createElement('div');
    group.className = 'traffic-light-group';
    group.appendChild(closeBtn);
    group.appendChild(minBtn);
    group.appendChild(maxBtn);

    // 插入到 .title-bar-left 的最前面
    leftContainer.insertBefore(group, leftContainer.firstChild);
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
    // 切换最大化 / 还原图标
    if (_isWin) {
      _setGlyph('title-bar-max-icon', isMaximized ? MDL2.restore : MDL2.maximize);
    } else {
      _setSvg('title-bar-max-icon', isMaximized ? TRAFFIC_SVG.restore : TRAFFIC_SVG.maximize);
    }
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

  // 暴露红绿灯切换（供调试选项卡使用）
  App.titlebar = {
    init: init,
    updateBackButton: _updateBackButton,
    toggleTrafficLights: function () {
      var isOn = document.body.classList.toggle('platform-non-win');
      if (isOn) {
        // 如果按钮还在右侧，移到左侧
        if (!document.querySelector('.traffic-light-group')) {
          _rearrangeTrafficLights();
        }
      } else {
        // 恢复：把按钮放回右侧
        var group = document.querySelector('.traffic-light-group');
        if (group) {
          var right = document.querySelector('.title-bar-right');
          if (right) {
            // 顺序：settings, min, max, close
            var settings = right.querySelector('.title-bar-settings');
            var min = group.querySelector('#title-bar-min');
            var max = group.querySelector('#title-bar-max');
            var close = group.querySelector('#title-bar-close');
            if (settings) right.insertBefore(min, settings.nextSibling);
            if (min) right.insertBefore(max, min.nextSibling);
            if (max) right.insertBefore(close, max.nextSibling);
            group.remove();
          }
        }
      }
      // 重新应用图标
      _applyIcons();
      return isOn;
    },
  };
})();
