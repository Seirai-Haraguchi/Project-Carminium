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
              '<p class="about-copyright">Project Carminium, Version <span id="about-detail-version">…</span></p>' +
              '<p class="about-copyright"><span data-i18n="about.buildLabel">构建版本</span>: <span id="about-detail-build">…</span></p>' +
              '<p class="about-copyright">© 2026 Seirai Haraguchi, YUNOFACTORY. All rights reserved.</p>' +
              '<p class="about-copyright">"Carminium" is an Open-Source Software.</p>' +
              '<p class="about-copyright">Made with ❤ by Seirai Haraguchi.</p>' +
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
          '<div class="settings-row about-action-row" id="about-check-update">' +
            '<div class="settings-row-body">' +
              '<p class="settings-row-label" data-i18n="about.checkUpdate">检查更新</p>' +
              '<p class="settings-row-sub about-update-sub" id="about-update-sub" hidden></p>' +
            '</div>' +
            '<div class="settings-row-trailing">' + CHEVRON_SVG + '</div>' +
          '</div>' +
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

    _bindUpdateRow(container);

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

    _bindUpdateRow(container);

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
      var verEl = document.getElementById('about-detail-version');
      if (verEl) verEl.textContent = info.version || '0.0.0';
      var buildEl = document.getElementById('about-detail-build');
      if (buildEl) buildEl.textContent = info.build !== undefined && info.build !== '' ? info.build : 'N/A';
    });
  }

  // ── 检查更新 ────────────────────────────────────────────────
  var _updateChecking = false;
  var _lastUpdateResult = null;

  function _t(key, params) {
    if (App.i18n && App.i18n.t) {
      var s = App.i18n.t(key, params);
      if (s != null) return s;
    }
    return key;
  }

  function _setUpdateStatus(sub, text, isAvailable) {
    if (!sub) return;
    if (!text) {
      sub.hidden = true;
      sub.textContent = '';
      sub.classList.remove('is-available');
      return;
    }
    sub.hidden = false;
    sub.textContent = text;
    sub.classList.toggle('is-available', !!isAvailable);
  }

  function _paintUpdateStatus(sub) {
    var res = _lastUpdateResult;
    if (!res || !sub) return;
    if (res.hasUpdate) {
      _setUpdateStatus(sub, _t('about.update.available', { version: res.latest }), true);
    } else if (res.ok) {
      _setUpdateStatus(sub, _t('about.update.upToDate'), false);
    }
  }

  function _bindUpdateRow(container) {
    var row = container.querySelector('#about-check-update');
    if (!row) return;
    var sub = container.querySelector('#about-update-sub');

    // 从设置页切来切去时保留上次结果，别让状态凭空消失
    if (_updateChecking) {
      _setUpdateStatus(sub, _t('about.update.checking'), false);
      row.classList.add('is-busy');
    } else {
      _paintUpdateStatus(sub);
    }

    row.addEventListener('click', function () {
      _runUpdateCheck(row, sub);
    });
  }

  function _runUpdateCheck(row, sub) {
    if (_updateChecking) return;
    if (!App.utils || !App.utils.call) return;

    _updateChecking = true;
    row.classList.add('is-busy');
    _setUpdateStatus(sub, _t('about.update.checking'), false);

    App.utils.call('check_for_update').then(function (raw) {
      var res = null;
      try { res = JSON.parse(raw); } catch (e) { res = null; }
      if (!res || typeof res !== 'object') res = { ok: false, error: 'parse' };
      return res;
    }, function () {
      return { ok: false, error: 'network' };
    }).then(function (res) {
      _updateChecking = false;

      // 检查期间可能已经重新渲染过（切页/切语言），这里一律认当前挂着的那个节点，
      // 别把结果画到已经被替换掉的旧 sub 上。
      var liveRow = document.getElementById('about-check-update');
      var liveSub = document.getElementById('about-update-sub');
      if (liveRow) liveRow.classList.remove('is-busy');

      if (res.ok) {
        _lastUpdateResult = res;
        if (res.hasUpdate) {
          _setUpdateStatus(liveSub, _t('about.update.available', { version: res.latest }), true);
          if (liveSub && liveSub.isConnected) _showUpdateDialog(res);
        } else {
          _setUpdateStatus(liveSub, _t('about.update.upToDate'), false);
          if (liveSub && liveSub.isConnected && App.utils && App.utils.toast) {
            App.utils.toast(_t('about.update.upToDateToast', { version: res.current }));
          }
        }
        return;
      }

      if (res.error === 'no_release') {
        _setUpdateStatus(liveSub, _t('about.update.noRelease'), false);
        return;
      }
      _setUpdateStatus(liveSub, _t('about.update.failed'), false);
      if (liveSub && liveSub.isConnected && App.utils && App.utils.toast) {
        App.utils.toast(_t('about.update.failedToast'));
      }
    });
  }

  function _formatUpdateDate(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    try {
      return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    } catch (e) {
      return d.toISOString().slice(0, 10);
    }
  }

  function _metaLine(label, value) {
    var row = document.createElement('div');
    row.className = 'about-update-meta';
    var l = document.createElement('span');
    l.className = 'about-update-meta-label';
    l.textContent = label;
    var v = document.createElement('span');
    v.className = 'about-update-meta-value';
    v.textContent = value;
    row.appendChild(l);
    row.appendChild(v);
    return row;
  }

  function _showUpdateDialog(info) {
    var dlg = document.createElement('div');
    dlg.className = 'cmd-dialog';
    dlg.style.maxWidth = '560px';

    var titleEl = document.createElement('div');
    titleEl.className = 'cmd-dialog-title';
    titleEl.textContent = _t('about.update.dialogTitle');

    var body = document.createElement('div');
    body.className = 'cmd-dialog-body';
    body.appendChild(_metaLine(_t('about.update.dialogCurrent'), info.current || '—'));
    body.appendChild(_metaLine(_t('about.update.dialogLatest'), info.latest || '—'));
    if (info.name && info.name !== info.latest) {
      body.appendChild(_metaLine(_t('about.update.dialogName'), info.name));
    }
    var published = _formatUpdateDate(info.publishedAt);
    if (published) {
      body.appendChild(_metaLine(_t('about.update.dialogPublished'), published));
    }

    var notes = document.createElement('div');
    notes.className = 'about-update-notes';
    var text = (info.notes || '').trim();
    if (text) {
      notes.textContent = text;
    } else {
      notes.textContent = _t('about.update.notesEmpty');
      notes.classList.add('is-empty');
    }
    body.appendChild(notes);

    var actions = document.createElement('div');
    actions.className = 'cmd-dialog-actions';
    var laterBtn = document.createElement('button');
    laterBtn.className = 'cmd-dialog-btn cmd-dialog-btn--cancel';
    laterBtn.textContent = _t('about.update.later');
    var openBtn = document.createElement('button');
    openBtn.className = 'cmd-dialog-btn cmd-dialog-btn--confirm';
    openBtn.textContent = _t('about.update.download');
    actions.appendChild(laterBtn);
    actions.appendChild(openBtn);

    dlg.appendChild(titleEl);
    dlg.appendChild(body);
    dlg.appendChild(actions);

    var close = _mountDialog(dlg);
    laterBtn.addEventListener('click', close);
    openBtn.addEventListener('click', function () {
      window.open(info.downloadUrl || info.url || GITHUB_RELEASES, '_blank');
      close();
    });
  }

  // 统一挂载：遮罩 + 开合动画 + Esc/点遮罩关闭 + 焦点进对话框
  function _mountDialog(dlg) {
    var overlay = document.createElement('div');
    overlay.className = 'cmd-dialog-overlay';
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
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) close();
    });
    document.addEventListener('keydown', onKey);
    // 焦点进对话框即可，别落在按钮上：只读文本块不需要那个 focus ring 抢视线
    // （全局 `[tabindex]:focus-visible` 会给容器画圈，这里显式关掉）
    dlg.setAttribute('tabindex', '-1');
    dlg.style.outline = 'none';
    setTimeout(function () { dlg.focus(); }, 50);
    return close;
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

      var dlg = document.createElement('div');
      dlg.className = 'cmd-dialog';
      dlg.style.maxWidth = '560px';

      var titleEl = document.createElement('div');
      titleEl.className = 'cmd-dialog-title';
      titleEl.textContent = App.i18n ? App.i18n.t('about.diagnostic') : '诊断信息';

      var bodyWrap = document.createElement('div');
      bodyWrap.className = 'cmd-dialog-body';

      var textarea = document.createElement('textarea');
      textarea.className = 'md-textarea md-textarea--mono';
      textarea.readOnly = true;
      textarea.spellcheck = false;
      textarea.rows = 9;
      textarea.value = text;

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

      var close = _mountDialog(dlg);
      closeBtn.addEventListener('click', close);
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
