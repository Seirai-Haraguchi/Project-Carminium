/**
 * Carminium — 关于页
 *
 * 复用设置页的分组列表与分隔线语言，版本卡片可展开查看版权与许可证。
 */
(function () {
  'use strict';

  window.App = window.App || {};
  var page = {};
  window.App.pages.about = page;

  // GitHub 仓库地址
  var GITHUB_REPO = 'https://github.com/Seirai-Haraguchi/Project-Carminium';
  var GITHUB_ISSUES = 'https://github.com/Seirai-Haraguchi/Project-Carminium/issues';
  var GITHUB_RELEASES = 'https://github.com/Seirai-Haraguchi/Project-Carminium/releases';

  // ── Chevron SVG ─────────────────────────────────────────────────────────────
  var CHEVRON_SVG = '<svg class="about-chevron" viewBox="0 0 24 24" width="20" height="20">' +
    '<path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z" fill="currentColor"/></svg>';

  page.render = function (container) {
    // 清除其他页面的 A-Z 跳转栏
    var oldBar = document.querySelector('.az-jump-bar-wrapper');
    if (oldBar && oldBar.parentNode) oldBar.parentNode.removeChild(oldBar);

    container.innerHTML =
      '<div class="settings-view settings-view-enter-right about-page">' +
        '<div class="page-header">' +
          '<div class="page-header-left page-header-left--right">' +
            '<button class="back-btn" id="about-back-btn" data-i18n-title="common.back" data-i18n-aria-label="common.back" title="返回" aria-label="返回">' +
              '<span class="material-symbols-rounded">arrow_back</span>' +
            '</button>' +
            '<h1 class="page-title" data-i18n="page.about.title">关于</h1>' +
          '</div>' +
        '</div>' +

        _renderAboutBody() +
      '</div>';

    _bindEvents(container);
    _initLogoTheme(container);
    _loadAppInfo();

    // Apply i18n to dynamically created DOM
    if (App.i18n && App.i18n.applyToDOM) {
      App.i18n.applyToDOM(container);
    }
  };

  // 内嵌渲染（在设置页右栏中显示，无页头/返回按钮）
  page.renderInto = function (container) {
    container.innerHTML =
      '<div class="about-page about-page-inline">' +
        _renderAboutBody() +
      '</div>';

    _bindEventsInline(container);
    _initLogoTheme(container);
    _loadAppInfo();

    if (App.i18n && App.i18n.applyToDOM) {
      App.i18n.applyToDOM(container);
    }
  };

  // 生成关于页主体内容（版本信息 + 操作），供 render / renderInto 复用
  function _renderAboutBody() {
    return '' +
      // ── 版本信息 ──
      '<div class="settings-group">' +
        '<div class="settings-group-header" data-i18n="about.versionInfo">版本信息</div>' +
        '<div class="settings-row about-version-card" id="about-version-card">' +
          '<div class="about-version-left">' +
            '<img class="about-app-icon" src="logo.svg" alt="">' +
            '<p class="settings-row-label">Carminium</p>' +
          '</div>' +
          '<div class="about-version-right">' +
            '<span class="settings-row-sub" id="about-version-text" data-i18n="common.loading">加载中…</span>' +
            CHEVRON_SVG +
          '</div>' +
        '</div>' +
        '<div class="about-version-expander" id="about-version-expander">' +
          '<div class="about-version-expander-inner">' +
            '<p class="about-copyright">COPYRIGHT © 2025–2026 Seirai Haraguchi</p>' +
            '<p class="about-license" data-i18n="about.license">本程序根据 GNU General Public License v3.0 获得许可</p>' +
            '<div class="about-links">' +
              '<a class="btn-filled" href="' + GITHUB_REPO + '" target="_blank" rel="noopener noreferrer">' +
                '<span data-i18n="about.githubRepo">GitHub 仓库</span>' +
                '<span class="material-symbols-rounded">open_in_new</span>' +
              '</a>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>' +

      // ── 操作 ──
      '<div class="settings-group">' +
        '<div class="settings-group-header" data-i18n="about.actions">操作</div>' +
        '<div class="settings-row about-action-row" id="about-release">' +
          '<div><p class="settings-row-label" data-i18n="about.viewRelease">查看 Release</p></div>' +
          CHEVRON_SVG +
        '</div>' +
        '<div class="settings-row about-action-row" id="about-feedback">' +
          '<div><p class="settings-row-label" data-i18n="about.feedback">问题反馈</p></div>' +
          CHEVRON_SVG +
        '</div>' +
      '</div>';
  }

  // ── 事件绑定 ─────────────────────────────────────────────────────────────────
  function _bindEvents(container) {
    // 返回按钮
    var backBtn = container.querySelector('#about-back-btn');
    if (backBtn) {
      backBtn.addEventListener('click', function () {
        var view = container.querySelector('.settings-view');
        function goBack() {
          if (App.goBack) App.goBack();
        }
        if (!view) { goBack(); return; }
        view.classList.remove('settings-view-enter-right');
        view.classList.add('settings-view-exit-right');
        setTimeout(goBack, 150);
      });
    }

    // 版本卡片：点击展开/收起
    var versionCard = container.querySelector('#about-version-card');
    var versionExpander = container.querySelector('#about-version-expander');
    if (versionCard && versionExpander) {
      versionCard.addEventListener('click', function () {
        var isActive = versionExpander.classList.toggle('active');
        versionCard.classList.toggle('expanded', isActive);
      });
    }

    // 查看 Release
    var release = container.querySelector('#about-release');
    if (release) {
      release.addEventListener('click', function () {
        window.open(GITHUB_RELEASES, '_blank');
      });
    }

    // 问题反馈
    var feedback = container.querySelector('#about-feedback');
    if (feedback) {
      feedback.addEventListener('click', function () {
        window.open(GITHUB_ISSUES, '_blank');
      });
    }

    // Logo连击彩蛋
    _initLogoEasterEgg(container);
  }

  // 内嵌渲染时的事件绑定（无返回按钮）
  function _bindEventsInline(container) {
    // 版本卡片：点击展开/收起
    var versionCard = container.querySelector('#about-version-card');
    var versionExpander = container.querySelector('#about-version-expander');
    if (versionCard && versionExpander) {
      versionCard.addEventListener('click', function () {
        var isActive = versionExpander.classList.toggle('active');
        versionCard.classList.toggle('expanded', isActive);
      });
    }

    // 查看 Release
    var release = container.querySelector('#about-release');
    if (release) {
      release.addEventListener('click', function () {
        window.open(GITHUB_RELEASES, '_blank');
      });
    }

    // 问题反馈
    var feedback = container.querySelector('#about-feedback');
    if (feedback) {
      feedback.addEventListener('click', function () {
        window.open(GITHUB_ISSUES, '_blank');
      });
    }

    // Logo连击彩蛋
    _initLogoEasterEgg(container);
  }

  // ── 加载版本信息 ─────────────────────────────────────────────────────────────
  function _loadAppInfo() {
    if (!App.utils || !App.utils.call) return;
    App.utils.call('get_app_info').then(function (res) {
      var info;
      try { info = JSON.parse(res); } catch (e) { return; }
      var el = document.getElementById('about-version-text');
      if (el) {
        var ver = info.version || '0.0.0';
        var text = ver;
        if (info.codename) text += ' (Codename ' + info.codename + ')';
        el.textContent = text;
      }
    });
  }

  // ── Logo 随主题（亮/暗）切换 ─────────────────────────────────────────────────
  var _logoThemeObserver = null;

  function _initLogoTheme(container) {
    var logo = container.querySelector('.about-app-icon');
    if (!logo) return;

    // 离开上一页时断开旧观察者，避免泄漏
    if (_logoThemeObserver) {
      _logoThemeObserver.disconnect();
      _logoThemeObserver = null;
    }

    function apply() {
      var isDark = document.documentElement.getAttribute('data-theme') === 'dark';
      logo.src = isDark ? 'logo-dark.svg' : 'logo.svg';
    }

    apply(); // 立即应用当前主题
    if (typeof MutationObserver !== 'undefined') {
      _logoThemeObserver = new MutationObserver(apply);
      _logoThemeObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['data-theme'],
      });
    }
  }

  // ── Logo连击彩蛋：解锁调试选项卡 ────────────────────────────────────────────
  var _logoClickCount = 0;
  var _logoClickTimer = null;

  function _initLogoEasterEgg(container) {
    var logo = container.querySelector('.about-app-icon');
    if (!logo) return;

    logo.addEventListener('click', function (e) {
      e.stopPropagation(); // 防止触发版本卡片展开

      _logoClickCount++;

      // 重置计时器
      if (_logoClickTimer) {
        clearTimeout(_logoClickTimer);
      }

      // 3秒内没有继续点击则重置计数
      _logoClickTimer = setTimeout(function () {
        _logoClickCount = 0;
      }, 3000);

      // 连击 7 次解锁调试选项卡
      var threshold = 7;
      if (_logoClickCount >= threshold) {
        _logoClickCount = 0;
        clearTimeout(_logoClickTimer);
        _unlockDebugMode(container);
      }
    });
  }

  function _unlockDebugMode(container) {
    // 持久化标记
    try { sessionStorage.setItem('carminium_debug', '1'); } catch (e) { /* ignore */ }

    // Toast 提示
    if (App.utils && App.utils.toast) {
      App.utils.toast(App.i18n ? App.i18n.t('about.debugUnlocked') : 'Debug mode unlocked');
    }

    // 自动跳转到设置页调试选项卡
    setTimeout(function () {
      if (App.navigate) {
        App.navigate('settings');
        // 等待设置页渲染后切换到 debug 分类
        setTimeout(function () {
          if (App.pages && App.pages.settings && App.pages.settings.activateSection) {
            App.pages.settings.activateSection('debug');
          }
        }, 200);
      }
    }, 800);
  }

})();
