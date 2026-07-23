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
  var GITHUB_REPO = 'https://github.com/koenaki-seirai/carminium';
  var GITHUB_ISSUES = 'https://github.com/koenaki-seirai/carminium/issues';
  var GITHUB_RELEASES = 'https://github.com/koenaki-seirai/carminium/releases';

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
            '<button class="back-btn" id="about-back-btn" title="返回" aria-label="返回">' +
              '<span class="material-symbols-rounded">arrow_back</span>' +
            '</button>' +
            '<h1 class="page-title">关于</h1>' +
          '</div>' +
        '</div>' +

        // ── 版本信息 ──
        '<div class="settings-group">' +
          '<div class="settings-group-header">版本信息</div>' +
          '<div class="settings-row about-version-card" id="about-version-card">' +
            '<div class="about-version-left">' +
              '<img class="about-app-icon" src="logo.svg" alt="">' +
              '<p class="settings-row-label">Carminium</p>' +
            '</div>' +
            '<div class="about-version-right">' +
              '<span class="settings-row-sub" id="about-version-text">加载中…</span>' +
              CHEVRON_SVG +
            '</div>' +
          '</div>' +
          '<div class="about-version-expander" id="about-version-expander">' +
            '<div class="about-version-expander-inner">' +
              '<p class="about-copyright">COPYRIGHT © 2025–2026 Seirai Haraguchi</p>' +
              '<p class="about-license">本程序根据 GNU General Public License v3.0 获得许可</p>' +
              '<div class="about-links">' +
                '<a class="btn-filled" href="' + GITHUB_REPO + '" target="_blank" rel="noopener noreferrer">' +
                  '<span>GitHub 仓库</span>' +
                  '<span class="material-symbols-rounded">open_in_new</span>' +
                '</a>' +
              '</div>' +
            '</div>' +
          '</div>' +
        '</div>' +

        // ── 操作 ──
        '<div class="settings-group">' +
          '<div class="settings-group-header">操作</div>' +
          '<div class="settings-row about-action-row" id="about-release">' +
            '<div><p class="settings-row-label">查看 Release</p></div>' +
            CHEVRON_SVG +
          '</div>' +
          '<div class="settings-row about-action-row" id="about-feedback">' +
            '<div><p class="settings-row-label">问题反馈</p></div>' +
            CHEVRON_SVG +
          '</div>' +
        '</div>' +
      '</div>';

    _bindEvents(container);
    _loadAppInfo();
  };

  // ── 事件绑定 ─────────────────────────────────────────────────────────────────
  function _bindEvents(container) {
    // 返回按钮
    var backBtn = container.querySelector('#about-back-btn');
    if (backBtn) {
      backBtn.addEventListener('click', function () {
        var view = container.querySelector('.settings-view');
        function goBack() {
          if (App.navigate) App.navigate('settings');
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

  // ── Logo连击彩蛋：测试模式 ────────────────────────────────────────────────────
  var _logoClickCount = 0;
  var _logoClickTimer = null;
  var _testModeActive = false;

  function _initLogoEasterEgg(container) {
    var logo = container.querySelector('.about-app-icon');
    if (!logo) return;

    logo.addEventListener('click', function (e) {
      e.stopPropagation(); // 防止触发版本卡片展开

      if (_testModeActive) return;

      _logoClickCount++;

      // 重置计时器
      if (_logoClickTimer) {
        clearTimeout(_logoClickTimer);
      }

      // 5秒内没有继续点击则重置计数
      _logoClickTimer = setTimeout(function () {
        _logoClickCount = 0;
      }, 5000);

      // 连击15次触发测试模式
      if (_logoClickCount >= 15) {
        _logoClickCount = 0;
        clearTimeout(_logoClickTimer);
        _enterTestMode(container);
      }
    });
  }

  function _enterTestMode(container) {
    _testModeActive = true;

    // 创建测试遮罩
    var overlay = document.createElement('div');
    overlay.id = 'about-test-overlay';
    overlay.className = 'about-test-overlay';
    overlay.innerHTML =
      '<div class="about-test-card">' +
        '<div class="about-test-header">' +
          '<span class="material-symbols-rounded about-test-icon">bug_report</span>' +
          '<h3 class="about-test-title">测试模式已激活</h3>' +
        '</div>' +
        '<p class="about-test-desc">5秒后自动关闭并返回正常页面</p>' +
        '<div class="about-test-progress">' +
          '<div class="about-test-progress-bar"></div>' +
        '</div>' +
        '<button class="about-test-close" id="about-test-close">立即关闭</button>' +
      '</div>';

    container.appendChild(overlay);

    // 强制重绘以触发过渡动画
    overlay.offsetHeight;
    overlay.classList.add('active');

    // 进度条动画
    var progressBar = overlay.querySelector('.about-test-progress-bar');
    if (progressBar) {
      progressBar.style.animation = 'about-test-progress 5s linear forwards';
    }

    // 5秒后自动关闭
    var autoCloseTimer = setTimeout(function () {
      _exitTestMode(container);
    }, 5000);

    // 立即关闭按钮
    var closeBtn = overlay.querySelector('#about-test-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', function () {
        clearTimeout(autoCloseTimer);
        _exitTestMode(container);
      });
    }
  }

  function _exitTestMode(container) {
    var overlay = container.querySelector('#about-test-overlay');
    if (!overlay) return;

    overlay.classList.remove('active');

    setTimeout(function () {
      if (overlay && overlay.parentNode) {
        overlay.parentNode.removeChild(overlay);
      }
      _testModeActive = false;
    }, 300);
  }

})();
