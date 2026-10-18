(function () {
  'use strict';

  window.App = window.App || {};
  var page = {};
  window.App.pages.about = page;

  var GITHUB_REPO = 'https://github.com/Seirai-Haraguchi/Project-Carminium';
  var GITHUB_ISSUES = 'https://github.com/Seirai-Haraguchi/Project-Carminium/issues';
  var GITHUB_RELEASES = 'https://github.com/Seirai-Haraguchi/Project-Carminium/releases';

  var CHEVRON_SVG = '<svg class="about-chevron" viewBox="0 0 24 24" width="20" height="20">' +
    '<path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z" fill="currentColor"/></svg>';

  page.render = function (container) {
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

    if (App.i18n && App.i18n.applyToDOM) {
      App.i18n.applyToDOM(container);
    }
  };

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

  function _renderAboutBody() {
    return '' +
      '<div class="settings-group">' +
        '<div class="settings-group-header" data-i18n="about.versionInfo">版本信息</div>' +
        '<div class="md-seglist">' +
          '<div class="settings-row about-version-card" id="about-version-card">' +
            '<img class="about-app-icon" src="logo.svg" alt="">' +
            '<div class="settings-row-body">' +
              '<p class="settings-row-label">Carminium</p>' +
              '<span class="settings-row-sub" id="about-version-text" data-i18n="common.loading">加载中…</span>' +
            '</div>' +
            '<div class="settings-row-trailing">' + CHEVRON_SVG + '</div>' +
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
      '</div>' +

      '<div class="settings-group">' +
        '<div class="settings-group-header" data-i18n="about.actions">操作</div>' +
        '<div class="md-seglist">' +
          '<div class="settings-row about-action-row" id="about-release">' +
            '<div class="settings-row-body"><p class="settings-row-label" data-i18n="about.viewRelease">查看 Release</p></div>' +
            '<div class="settings-row-trailing">' + CHEVRON_SVG + '</div>' +
          '</div>' +
          '<div class="settings-row about-action-row" id="about-feedback">' +
            '<div class="settings-row-body"><p class="settings-row-label" data-i18n="about.feedback">问题反馈</p></div>' +
            '<div class="settings-row-trailing">' + CHEVRON_SVG + '</div>' +
          '</div>' +
          '<div class="settings-row about-action-row" id="about-diagnostic">' +
            '<div class="settings-row-body"><p class="settings-row-label" data-i18n="about.diagnostic">诊断信息</p></div>' +
            '<div class="settings-row-trailing">' + CHEVRON_SVG + '</div>' +
          '</div>' +
        '</div>' +
      '</div>';
  }

  function _bindEvents(container) {
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

    var versionCard = container.querySelector('#about-version-card');
    var versionExpander = container.querySelector('#about-version-expander');
    if (versionCard && versionExpander) {
      versionCard.addEventListener('click', function () {
        var isActive = versionExpander.classList.toggle('active');
        versionCard.classList.toggle('expanded', isActive);
      });
    }

    var release = container.querySelector('#about-release');
    if (release) {
      release.addEventListener('click', function () {
        window.open(GITHUB_RELEASES, '_blank');
      });
    }

    var feedback = container.querySelector('#about-feedback');
    if (feedback) {
      feedback.addEventListener('click', function () {
        window.open(GITHUB_ISSUES, '_blank');
      });
    }

    var diag = container.querySelector('#about-diagnostic');
    if (diag) {
      diag.addEventListener('click', function () {
        _showDiagnosticDialog();
      });
    }

    _initLogoEasterEgg(container);
  }

  function _bindEventsInline(container) {
    var versionCard = container.querySelector('#about-version-card');
    var versionExpander = container.querySelector('#about-version-expander');
    if (versionCard && versionExpander) {
      versionCard.addEventListener('click', function () {
        var isActive = versionExpander.classList.toggle('active');
        versionCard.classList.toggle('expanded', isActive);
      });
    }

    var release = container.querySelector('#about-release');
    if (release) {
      release.addEventListener('click', function () {
        window.open(GITHUB_RELEASES, '_blank');
      });
    }

    var feedback = container.querySelector('#about-feedback');
    if (feedback) {
      feedback.addEventListener('click', function () {
        window.open(GITHUB_ISSUES, '_blank');
      });
    }

    var diag = container.querySelector('#about-diagnostic');
    if (diag) {
      diag.addEventListener('click', function () {
        _showDiagnosticDialog();
      });
    }

    _initLogoEasterEgg(container);
  }

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

  function _showDiagnosticDialog() {
    if (!App.utils || !App.utils.call) return;
    App.utils.call('get_diagnostic_info').then(function (res) {
      var info;
      try { info = JSON.parse(res); } catch (e) { return; }

      var lines = [];
      var keys = [
        'SystemOsVersion', 'SystemOsArch', 'SystemDeviceName', 'SystemDeviceVendor',
        'AppRoot', 'AppCurrentDirectory', 'AppCurrentMemoryUsage', 'DiagnosticMemoryKillCount'
      ];
      for (var i = 0; i < keys.length; i++) {
        lines.push(keys[i] + ': ' + (info[keys[i]] !== undefined ? info[keys[i]] : 'N/A'));
      }
      var text = lines.join('\n');

      var overlay = document.createElement('div');
      overlay.className = 'cmd-dialog-overlay';
      var dlg = document.createElement('div');
      dlg.className = 'cmd-dialog';
      dlg.style.maxWidth = '560px';

      var titleEl = document.createElement('div');
      titleEl.className = 'cmd-dialog-title';
      titleEl.textContent = App.i18n ? App.i18n.t('about.diagnostic') : '诊断信息';

      var bodyWrap = document.createElement('div');
      bodyWrap.style.padding = '0 24px';

      var textarea = document.createElement('textarea');
      textarea.readOnly = true;
      textarea.value = text;
      textarea.style.width = '100%';
      textarea.style.minHeight = '240px';
      textarea.style.padding = '12px';
      textarea.style.border = '1px solid var(--md-outline-variant)';
      textarea.style.borderRadius = '8px';
      textarea.style.background = 'var(--md-surface-container-high)';
      textarea.style.color = 'var(--md-on-surface)';
      textarea.style.fontFamily = 'monospace';
      textarea.style.fontSize = '13px';
      textarea.style.lineHeight = '1.6';
      textarea.style.resize = 'vertical';
      textarea.style.userSelect = 'text';
      textarea.spellcheck = false;

      bodyWrap.appendChild(textarea);

      var actions = document.createElement('div');
      actions.className = 'cmd-dialog-actions';
      var closeBtn = document.createElement('button');
      closeBtn.className = 'cmd-dialog-btn cmd-dialog-btn--confirm';
      closeBtn.textContent = App.i18n ? App.i18n.t('common.close') : '关闭';
      actions.appendChild(closeBtn);

      dlg.appendChild(titleEl);
      dlg.appendChild(bodyWrap);
      dlg.appendChild(actions);
      overlay.appendChild(dlg);
      document.body.appendChild(overlay);
      requestAnimationFrame(function () { overlay.classList.add('open'); });

      var done = false;
      function close() {
        if (done) return;
        done = true;
        overlay.classList.remove('open');
        document.removeEventListener('keydown', onKey);
        setTimeout(function () {
          if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
        }, 180);
      }
      function onKey(e) {
        if (e.key === 'Escape') close();
      }
      closeBtn.addEventListener('click', close);
      overlay.addEventListener('click', function (e) {
        if (e.target === overlay) close();
      });
      document.addEventListener('keydown', onKey);
      setTimeout(function () { closeBtn.focus(); }, 50);
    });
  }

  var _logoThemeObserver = null;

  function _initLogoTheme(container) {
    var logo = container.querySelector('.about-app-icon');
    if (!logo) return;

    if (_logoThemeObserver) {
      _logoThemeObserver.disconnect();
      _logoThemeObserver = null;
    }

    function apply() {
      var isDark = document.documentElement.getAttribute('data-theme') === 'dark';
      logo.src = isDark ? 'logo-dark.svg' : 'logo.svg';
    }

    apply();
    if (typeof MutationObserver !== 'undefined') {
      _logoThemeObserver = new MutationObserver(apply);
      _logoThemeObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['data-theme'],
      });
    }
  }

  var _logoClickCount = 0;
  var _logoClickTimer = null;

  function _initLogoEasterEgg(container) {
    var logo = container.querySelector('.about-app-icon');
    if (!logo) return;

    logo.addEventListener('click', function (e) {
      e.stopPropagation();

      _logoClickCount++;

      if (_logoClickTimer) {
        clearTimeout(_logoClickTimer);
      }

      _logoClickTimer = setTimeout(function () {
        _logoClickCount = 0;
      }, 3000);

      var threshold = 7;
      if (_logoClickCount >= threshold) {
        _logoClickCount = 0;
        clearTimeout(_logoClickTimer);
        _unlockDebugMode(container);
      }
    });
  }

  function _unlockDebugMode(container) {
    try { sessionStorage.setItem('carminium_debug', '1'); } catch (e) {  }

    if (App.utils && App.utils.toast) {
      App.utils.toast(App.i18n ? App.i18n.t('about.debugUnlocked') : 'Debug mode unlocked');
    }

    setTimeout(function () {
      if (App.navigate) {
        App.navigate('settings');
        setTimeout(function () {
          if (App.pages && App.pages.settings && App.pages.settings.activateSection) {
            App.pages.settings.activateSection('debug');
          }
        }, 200);
      }
    }, 800);
  }

})();
