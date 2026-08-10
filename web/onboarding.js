/**
 * Carminium — 新手引导（Onboarding）
 *
 * 完全复用主程序既有组件：settings-row / settings-group-header / toggle /
 * md-dropdown / btn-filled / btn-outlined / btn-text。
 * 渲染到 #page-container 内（与设置页相同），标题栏和窗口三大键始终可见。
 *
 *   1. 欢迎      — 应用介绍
 *   2. 语言      — 选择界面语言
 *   3. 媒体库    — 添加本地文件夹 / 流媒体库
 *   4. 个性化    — 主题与配色方案
 *   5. 音频      — 输出与音效设置
 *   6. 自动化    — 播放过渡与行为
 *   7. 开始使用  — 完成并进入主界面
 *
 * 完成后写入 onboarding_complete=true，不再显示。
 * 设置页可通过 App.onboarding.restart() 重新启动引导。
 */
(function () {
  'use strict';

  window.App = window.App || {};
  const ob = {};
  window.App.onboarding = ob;

  function _t(key, vars) {
    return window.App && App.i18n ? App.i18n.t(key, vars) : key;
  }
  function _esc(s) {
    if (App.utils && App.utils.esc) return App.utils.esc(s);
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // ── 步骤定义 ──────────────────────────────────────────────────────────
  var STEPS = [
    { id: 'welcome',      icon: 'rocket_launch' },
    { id: 'language',     icon: 'translate' },
    { id: 'library',      icon: 'folder_open' },
    { id: 'personalize',  icon: 'palette' },
    { id: 'audio',        icon: 'headphones' },
    { id: 'automation',   icon: 'tune' },
    { id: 'start',        icon: 'play_circle' },
  ];

  // 每种语言以原生文字 + 国旗 emoji 显示
  // 一个中国原则：简体中文和繁体中文均使用中华人民共和国国旗 🇨🇳
  // Windows 的 Segoe UI Emoji 不渲染国旗 emoji，故在 style.css 注册本地
  // Noto Color Emoji 国旗子集（'Noto Color Emoji Flags'，unicode-range 触发式加载，
  // 见 --ui-font 末尾），仅国旗区段 693KB，替代原远程全表（20MB+）
  var LANGUAGES = [
    { value: 'zh-CN', flag: '🇨🇳', native: '简体中文',    english: 'Simplified Chinese' },
    { value: 'zh-TW', flag: '🇨🇳', native: '繁體中文',    english: 'Traditional Chinese' },
    { value: 'ja',    flag: '🇯🇵', native: '日本語',      english: 'Japanese' },
    { value: 'en',    flag: '🇬🇧', native: 'English',     english: 'English' },
    { value: 'ru',    flag: '🇷🇺', native: 'Русский',     english: 'Russian' },
  ];

  var COLOR_SCHEMES = [
    { value: 'tonal_spot' }, { value: 'fidelity' }, { value: 'monochrome' },
    { value: 'neutral' }, { value: 'vibrant' }, { value: 'expressive' },
    { value: 'content' }, { value: 'rainbow' }, { value: 'fruit_salad' },
  ];

  var THEMES = [
    { value: 'system' }, { value: 'light' }, { value: 'dark' },
  ];

  // ── 运行时状态 ─────────────────────────────────────────────────────────
  var _container = null;   // #page-container
  var _page = null;        // .onboarding-page inside container
  var _current = 0;
  var _settings = null;
  var _libraryCount = 0;
  var _isRestart = false;

  // ── 入口：检查是否需要显示 ──────────────────────────────────────────────
  ob.checkAndStart = function (settings) {
    if (settings && !settings.onboarding_complete) {
      _settings = settings;
      _isRestart = false;
      start();
      return true;
    }
    return false;
  };

  // ── 外部からの再実行用（設定ページから呼び出し） ─────────────────────
  ob.restart = function () {
    if (_page) return;
    _isRestart = true;
    App.utils.call('get_settings').then(function (res) {
      try { _settings = JSON.parse(res); } catch (e) { _settings = {}; }
      start();
    }).catch(function () { _settings = {}; start(); });
  };

  // ── 启动引导 ───────────────────────────────────────────────────────────
  function start() {
    if (_page) return;
    _current = 0;
    _libraryCount = (_settings && _settings.music_folders ? _settings.music_folders.length : 0)
      + (_settings && _settings.subsonic_servers ? _settings.subsonic_servers.length : 0);

    _container = document.getElementById('page-container');
    if (!_container) return;

    // 布局：与设置页一致 — 隐藏侧栏 + 播放器，保留标题栏（窗口三大键）
    document.body.classList.remove('settings-active');
    document.body.classList.add('onboarding-active');
    App.state.currentPage = 'onboarding';

    _container.innerHTML =
      '<div class="onboarding-page">' +
        '<div class="onboarding-progress" id="ob-progress"></div>' +
        '<header class="onboarding-header">' +
          '<div class="onboarding-header-left">' +
            '<div class="onboarding-header-text">' +
              '<h1 class="onboarding-title" id="ob-title"></h1>' +
              '<p class="onboarding-subtitle" id="ob-subtitle"></p>' +
            '</div>' +
          '</div>' +
        '</header>' +
        '<div class="onboarding-scroll">' +
          '<div class="onboarding-content" id="ob-content"></div>' +
        '</div>' +
        '<div class="onboarding-actions" id="ob-actions"></div>' +
      '</div>';

    _page = _container.querySelector('.onboarding-page');

    _renderProgress();
    _renderStep();
  }

  // ── 进度条（M3 线性进度指示器） ───────────────────────────────────────
  function _renderProgress() {
    var el = _container.querySelector('#ob-progress');
    if (!el) return;
    el.innerHTML = STEPS.map(function (s, i) {
      var cls = i < _current ? 'done' : (i === _current ? 'current' : '');
      return '<span class="onboarding-progress-dot ' + cls + '"></span>';
    }).join('');
  }

  // ── 步骤内容路由 ───────────────────────────────────────────────────────
  function _renderStep() {
    _renderProgress();
    // 离开欢迎页时停止打字动画
    _stopTyping();
    var content = _container.querySelector('#ob-content');
    var actions = _container.querySelector('#ob-actions');
    var titleEl = _container.querySelector('#ob-title');
    var subEl = _container.querySelector('#ob-subtitle');
    if (!content || !actions) return;

    var step = STEPS[_current];
    content.innerHTML = '';
    content.classList.remove('onboarding-content--enter');
    actions.innerHTML = '';

    switch (step.id) {
      case 'welcome':     _renderWelcome(content, actions, titleEl, subEl); break;
      case 'language':    _renderLanguage(content, actions, titleEl, subEl); break;
      case 'library':     _renderLibrary(content, actions, titleEl, subEl); break;
      case 'personalize': _renderPersonalize(content, actions, titleEl, subEl); break;
      case 'audio':       _renderAudio(content, actions, titleEl, subEl); break;
      case 'automation':  _renderAutomation(content, actions, titleEl, subEl); break;
      case 'start':       _renderStart(content, actions, titleEl, subEl); break;
    }

    // 进入动画
    void content.offsetWidth;
    content.classList.add('onboarding-content--enter');

    if (App.i18n && App.i18n.applyToDOM) App.i18n.applyToDOM(_container);
  }

  // ── 底部操作栏 ─────────────────────────────────────────────────────────
  function _buildActions(opts) {
    opts = opts || {};
    var html = '<div class="onboarding-actions-left">';
    if (opts.skip !== false) {
      html += '<button class="btn-text" id="ob-skip" type="button">' +
        _t('onboarding.skip') + '</button>';
    }
    html += '</div>';
    html += '<div class="onboarding-actions-right">';
    if (opts.back !== false && _current > 0) {
      html += '<button class="btn-outlined" id="ob-back" type="button">' +
        '<span class="material-symbols-rounded">arrow_back</span>' +
        '<span>' + _t('onboarding.back') + '</span></button>';
    }
    if (opts.next) {
      html += '<button class="btn-filled" id="ob-next" type="button">' +
        '<span>' + _t('onboarding.next') + '</span>' +
        '<span class="material-symbols-rounded">arrow_forward</span></button>';
    }
    if (opts.finish) {
      html += '<button class="btn-filled" id="ob-finish" type="button">' +
        '<span class="material-symbols-rounded">play_arrow</span>' +
        '<span>' + _t('onboarding.start.finish') + '</span></button>';
    }
    html += '</div>';
    return html;
  }

  function _wireActions() {
    var back = _container.querySelector('#ob-back');
    if (back) back.addEventListener('click', _prev);
    var next = _container.querySelector('#ob-next');
    if (next) next.addEventListener('click', _next);
    var finish = _container.querySelector('#ob-finish');
    if (finish) finish.addEventListener('click', _finish);
    var skip = _container.querySelector('#ob-skip');
    if (skip) skip.addEventListener('click', _finish);
  }

  function _next() { if (_current < STEPS.length - 1) { _current++; _renderStep(); } }
  function _prev() { if (_current > 0) { _current--; _renderStep(); } }

  // ── 完成 ───────────────────────────────────────────────────────────────
  function _finish() {
    App.utils.call('save_settings', JSON.stringify({ onboarding_complete: true })).then(function () {
      _close();
    }).catch(function () { _close(); });
  }

  function _close() {
    _stopTyping();
    if (!_page) return;
    document.body.classList.remove('onboarding-active');
    var wasRestart = _isRestart;
    _page = null;
    _container = null;
    _isRestart = false;
    // 初回 → your_mix；再実行 → settings
    if (window.App && App.navigate) {
      App.navigate(wasRestart ? 'settings' : 'your_mix');
    }
  }

  // ── 即时保存设置字段 ───────────────────────────────────────────────────
  function _save(patch, applyFn) {
    if (_settings) Object.assign(_settings, patch);
    return App.utils.call('save_settings', JSON.stringify(patch)).then(function () {
      if (applyFn) applyFn();
    });
  }

  // ── 标题/副标题 ────────────────────────────────────────────────────────
  function _setTitle(titleKey, subKey, titleEl, subEl) {
    if (titleKey) {
      titleEl.textContent = _t(titleKey);
      titleEl.setAttribute('data-i18n', titleKey);
      titleEl.style.display = '';
    } else {
      titleEl.style.display = 'none';
    }
    if (subKey) {
      subEl.textContent = _t(subKey);
      subEl.setAttribute('data-i18n', subKey);
      subEl.style.display = '';
    } else {
      subEl.textContent = '';
      subEl.style.display = 'none';
    }
  }

  // ── 下拉菜单绑定（复用 settings.js 的 .md-dropdown 组件模式） ──────────
  function _bindDropdown(content, bind, options, currentValue, onSelect) {
    var dropdown = content.querySelector('.md-dropdown[data-bind="' + bind + '"]');
    if (!dropdown) return;
    var trigger = dropdown.querySelector('.md-dropdown-trigger');
    var valueEl = dropdown.querySelector('.md-dropdown-value');
    var menu = dropdown.querySelector('.md-dropdown-menu');

    function findLabel(val) {
      var match = options.find(function (o) { return o.value === val; });
      return match ? match.label : (options[0] ? options[0].label : '—');
    }

    valueEl.textContent = findLabel(currentValue);
    _refreshSelectedItem(menu, currentValue);

    if (trigger._obSelectHandler) {
      trigger.removeEventListener('click', trigger._obSelectHandler);
    }
    trigger._obSelectHandler = function (e) {
      e.stopPropagation();
      var isOpen = menu.classList.contains('open');
      // 关闭其他菜单
      document.querySelectorAll('.md-dropdown-menu.open').forEach(function (m) {
        m.classList.remove('open');
        var t = m.parentElement.querySelector('.md-dropdown-trigger');
        if (t) t.setAttribute('aria-expanded', 'false');
      });
      if (isOpen) return;
      // 定位
      var rect = trigger.getBoundingClientRect();
      var menuWidth = Math.max(rect.width, 200);
      menu.style.top = (rect.bottom + 4) + 'px';
      menu.style.right = (window.innerWidth - rect.right) + 'px';
      menu.style.width = menuWidth + 'px';
      menu.classList.add('open');
      trigger.setAttribute('aria-expanded', 'true');
    };
    trigger.addEventListener('click', trigger._obSelectHandler);

    menu.querySelectorAll('.md-dropdown-item').forEach(function (item) {
      item.removeEventListener('click', item._obItemHandler);
      item._obItemHandler = function (e) {
        e.stopPropagation();
        var val = this.dataset.value;
        valueEl.textContent = findLabel(val);
        menu.classList.remove('open');
        trigger.setAttribute('aria-expanded', 'false');
        _refreshSelectedItem(menu, val);
        if (onSelect) onSelect(val);
      };
      item.addEventListener('click', item._obItemHandler);
    });
  }

  function _refreshSelectedItem(menu, value) {
    menu.querySelectorAll('.md-dropdown-item').forEach(function (item) {
      item.classList.toggle('selected', item.dataset.value === value);
    });
  }

  // ── 开关行绑定 ─────────────────────────────────────────────────────────
  function _bindToggleRows(content, toggles) {
    content.querySelectorAll('.settings-row input[type="checkbox"]').forEach(function (input) {
      input.addEventListener('change', function () {
        var bind = this.dataset.bind;
        var val = this.checked;
        var entry = toggles.find(function (t) { return t.bind === bind; });
        var patch = {};
        patch[bind] = val;
        _save(patch, function () {
          if (entry && entry.apply) entry.apply(val);
        });
      });
    });
  }

  function _obUncheck(content, bind) {
    var el = content.querySelector('input[type="checkbox"][data-bind="' + bind + '"]');
    if (el) el.checked = false;
    if (_settings) _settings[bind] = false;
  }

  // ====================================================================
  // 步骤 1：欢迎 — 五语言"欢迎使用"打字特效
  // ====================================================================

  // 五种语言的欢迎语 + 对应的"下一步"按钮文字
  var WELCOME_LANGS = [
    { welcome: '欢迎使用',     next: '下一步' },
    { welcome: '歡迎使用',     next: '下一步' },
    { welcome: 'ようこそ',     next: '次へ' },
    { welcome: 'Welcome',      next: 'Next' },
    { welcome: 'Добро пожаловать', next: 'Далее' },
  ];
  var _typingTimer = null;

  function _renderWelcome(content, actions, titleEl, subEl) {
    _setTitle('', '', titleEl, subEl);

    content.innerHTML =
      '<div class="onboarding-welcome">' +
        '<h1 class="onboarding-display"><span class="ob-typing-text"></span><span class="ob-typing-cursor"></span></h1>' +
      '</div>';

    actions.innerHTML = _buildActions({ back: false, skip: false, next: true });
    _wireActions();

    _startTyping();
  }

  function _startTyping() {
    var textEl = _container.querySelector('.ob-typing-text');
    var nextBtn = _container.querySelector('#ob-next');
    if (!textEl) return;

    var langIdx = 0;
    var charIdx = 0;

    function getLangNext(idx) { return WELCOME_LANGS[idx].next; }
    if (nextBtn) nextBtn.querySelector('span').textContent = getLangNext(0);

    function typeChar() {
      var entry = WELCOME_LANGS[langIdx];
      var text = entry.welcome;
      charIdx++;
      textEl.textContent = text.slice(0, charIdx);
      if (charIdx < text.length) {
        _typingTimer = setTimeout(typeChar, 130);
      } else {
        // 打字完成 → 停留 1.5s → 擦除
        _typingTimer = setTimeout(eraseChar, 1500);
      }
    }

    function eraseChar() {
      var entry = WELCOME_LANGS[langIdx];
      var text = entry.welcome;
      charIdx--;
      textEl.textContent = text.slice(0, Math.max(0, charIdx));
      if (charIdx > 0) {
        _typingTimer = setTimeout(eraseChar, 60);
      } else {
        // 切换到下一种语言
        langIdx = (langIdx + 1) % WELCOME_LANGS.length;
        if (nextBtn) nextBtn.querySelector('span').textContent = getLangNext(langIdx);
        _typingTimer = setTimeout(typeChar, 300);
      }
    }

    _typingTimer = setTimeout(typeChar, 400);
  }

  function _stopTyping() {
    if (_typingTimer) {
      clearTimeout(_typingTimer);
      _typingTimer = null;
    }
  }

  // ====================================================================
  // 步骤 2：语言 — 复用 folder-row 卡片列表，每种语言以原生文字展示
  // ====================================================================
  function _renderLanguage(content, actions, titleEl, subEl) {
    _setTitle('onboarding.language.title', 'onboarding.language.subtitle', titleEl, subEl);

    var current = (_settings && _settings.language) || 'zh-CN';

    var itemsHtml = LANGUAGES.map(function (l) {
      var selected = l.value === current;
      return '' +
        '<div class="folder-row ob-lang-row' + (selected ? ' ob-lang-row--selected' : '') + '" data-lang="' + l.value + '" style="cursor:pointer;' + (selected ? 'border-color:var(--md-primary);' : '') + '">' +
          '<span class="folder-icon-badge ob-lang-flag' + (selected ? '" style="background:var(--md-primary-container);' : '') + '">' +
            l.flag +
          '</span>' +
          '<div class="folder-info">' +
            '<p class="folder-path">' + l.native + '</p>' +
            '<div class="folder-meta">' +
              '<span class="folder-chip">' + l.english + '</span>' +
            '</div>' +
          '</div>' +
          (selected ? '<span class="material-symbols-rounded" style="font-size:20px;color:var(--md-primary);flex-shrink:0;">check_circle</span>' : '') +
        '</div>';
    }).join('');

    content.innerHTML = '<div class="folder-list">' + itemsHtml + '</div>';

    actions.innerHTML = _buildActions({ next: true });
    _wireActions();

    content.querySelectorAll('.ob-lang-row').forEach(function (row) {
      row.addEventListener('click', function () {
        var val = this.dataset.lang;
        _save({ language: val }, function () {
          if (App.i18n) App.i18n.init(val);
        }).then(function () {
          _renderStep();
        });
      });
    });
  }

  // ====================================================================
  // 步骤 3：媒体库
  // ====================================================================
  function _renderLibrary(content, actions, titleEl, subEl) {
    _setTitle('onboarding.library.title', 'onboarding.library.subtitle', titleEl, subEl);

    content.innerHTML =
      '<div class="settings-group-header" data-i18n="onboarding.library.addLibrary">' + _t('onboarding.library.addLibrary') + '</div>' +
      '<div class="settings-section-body">' +
        '<div class="settings-row" id="ob-add-folder" style="cursor:pointer;">' +
          '<div style="display:flex;align-items:center;gap:16px;">' +
            '<span class="material-symbols-rounded" style="font-size:24px;color:var(--md-primary);flex-shrink:0;">create_new_folder</span>' +
            '<div>' +
              '<p class="settings-row-label" data-i18n="onboarding.library.addLocal">' + _t('onboarding.library.addLocal') + '</p>' +
              '<p class="settings-row-sub" data-i18n="onboarding.library.addLocalSub">' + _t('onboarding.library.addLocalSub') + '</p>' +
            '</div>' +
          '</div>' +
          '<span class="material-symbols-rounded" style="color:var(--md-on-surface-variant);">chevron_right</span>' +
        '</div>' +
        '<div class="settings-row" id="ob-add-subsonic" style="cursor:pointer;">' +
          '<div style="display:flex;align-items:center;gap:16px;">' +
            '<span class="material-symbols-rounded" style="font-size:24px;color:var(--md-primary);flex-shrink:0;">cloud</span>' +
            '<div>' +
              '<p class="settings-row-label" data-i18n="onboarding.library.addSubsonic">' + _t('onboarding.library.addSubsonic') + '</p>' +
              '<p class="settings-row-sub" data-i18n="onboarding.library.addSubsonicSub">' + _t('onboarding.library.addSubsonicSub') + '</p>' +
            '</div>' +
          '</div>' +
          '<span class="material-symbols-rounded" style="color:var(--md-on-surface-variant);">chevron_right</span>' +
        '</div>' +
      '</div>' +
      '<div class="settings-group-header" data-i18n="onboarding.library.current">' + _t('onboarding.library.current') + '</div>' +
      '<div class="folder-list" id="ob-library-list"></div>';

    actions.innerHTML = _buildActions({ next: true });
    _wireActions();

    _refreshLibraryList();

    content.querySelector('#ob-add-folder').addEventListener('click', function () {
      App.utils.call('open_folder_dialog').then(function (path) {
        if (!path) return;
        _setLibraryStatus(_t('onboarding.library.scanning'));
        App.utils.call('add_folder', path).then(function () {
          _libraryCount++;
          _refreshLibraryList();
        }).catch(function () { _refreshLibraryList(); });
      });
    });

    content.querySelector('#ob-add-subsonic').addEventListener('click', function () {
      if (App.pages && App.pages.folders && App.pages.folders.promptAddSubsonic) {
        App.pages.folders.promptAddSubsonic();
      }
      setTimeout(_refreshLibraryList, 1500);
    });
  }

  function _setLibraryStatus(text) {
    var list = _container.querySelector('#ob-library-list');
    if (list) {
      list.innerHTML =
        '<div class="empty-state">' +
          '<span class="material-symbols-rounded empty-icon ob-library-spin">sync</span>' +
          '<h2 class="empty-title">' + _esc(text) + '</h2>' +
        '</div>';
    }
  }

  function _refreshLibraryList() {
    var list = _container.querySelector('#ob-library-list');
    if (!list) return;
    App.utils.call('get_folders').then(function (res) {
      var folders = [];
      try { folders = JSON.parse(res) || []; } catch (e) {}
      App.utils.call('get_subsonic_servers').then(function (sres) {
        var servers = [];
        try { servers = JSON.parse(sres) || []; } catch (e) {}
        _libraryCount = folders.length + servers.length;
        if (App.state) {
          App.state.allFolders = folders;
          App.state.allSubsonicServers = servers;
        }
        _renderLibraryList(list, folders, servers);
      });
    });
  }

  function _renderLibraryList(list, folders, servers) {
    if (!folders.length && !servers.length) {
      list.innerHTML =
        '<div class="empty-state">' +
          '<span class="material-symbols-rounded empty-icon">folder_open</span>' +
          '<h2 class="empty-title" data-i18n="onboarding.library.empty">' + _t('onboarding.library.empty') + '</h2>' +
        '</div>';
      if (App.i18n && App.i18n.applyToDOM) App.i18n.applyToDOM(list);
      return;
    }
    var html = '';
    folders.forEach(function (f) {
      var scanDate = App.utils.formatDate ? App.utils.formatDate(f.last_scan) : '';
      html +=
        '<div class="folder-row">' +
          '<span class="folder-icon-badge"><span class="material-symbols-rounded folder-icon">folder</span></span>' +
          '<div class="folder-info">' +
            '<p class="folder-path" title="' + _esc(f.path) + '">' + _esc(f.path) + '</p>' +
            '<div class="folder-meta">' +
              '<span class="folder-chip"><span class="material-symbols-rounded">music_note</span>' + _t('music.trackCount', { count: f.track_count || 0 }) + '</span>' +
              '<span class="folder-chip"><span class="material-symbols-rounded">schedule</span>' + _t('folders.lastScan', { date: scanDate }) + '</span>' +
            '</div>' +
          '</div>' +
        '</div>';
    });
    servers.forEach(function (s) {
      var lastSync = s.last_sync ? (App.utils.formatDate ? App.utils.formatDate(s.last_sync) : '') : _t('folders.notSynced');
      var protocolLabel = s.protocol_mode === 'opensubsonic' ? 'OpenSubsonic' : 'Subsonic';
      html +=
        '<div class="folder-row subsonic-server-row">' +
          '<span class="folder-icon-badge folder-icon-badge--cloud"><span class="material-symbols-rounded folder-icon">cloud</span></span>' +
          '<div class="folder-info">' +
            '<p class="folder-path" title="' + _esc(s.name) + '">' + _esc(s.name) + '</p>' +
            '<div class="folder-meta">' +
              '<span class="folder-chip folder-chip--url" title="' + _esc(s.server_url) + '"><span class="material-symbols-rounded">language</span>' + _esc(s.server_url) + '</span>' +
              '<span class="folder-chip"><span class="material-symbols-rounded">music_note</span>' + _t('music.trackCount', { count: s.track_count || 0 }) + '</span>' +
              '<span class="folder-chip"><span class="material-symbols-rounded">api</span>' + protocolLabel + '</span>' +
              '<span class="folder-chip"><span class="material-symbols-rounded">sync</span>' + _t('folders.lastSync', { date: lastSync }) + '</span>' +
            '</div>' +
          '</div>' +
        '</div>';
    });
    list.innerHTML = html;
    if (App.i18n && App.i18n.applyToDOM) App.i18n.applyToDOM(list);
  }

  // ====================================================================
  // 步骤 4：个性化（复用 .md-dropdown 下拉选择组件）
  // ====================================================================
  function _renderPersonalize(content, actions, titleEl, subEl) {
    _setTitle('onboarding.personalize.title', 'onboarding.personalize.subtitle', titleEl, subEl);

    var theme = (_settings && _settings.theme) || 'system';
    var scheme = (_settings && _settings.color_scheme) || 'tonal_spot';

    var themeOptsHtml = THEMES.map(function (t) {
      return '<div class="md-dropdown-item" data-value="' + t.value + '" role="menuitem">' +
        _t('settings.theme.' + t.value) + '</div>';
    }).join('');

    var schemeOptsHtml = COLOR_SCHEMES.map(function (c) {
      return '<div class="md-dropdown-item" data-value="' + c.value + '" role="menuitem">' +
        _t('settings.colorScheme.' + c.value) + '</div>';
    }).join('');

    content.innerHTML =
      '<div class="settings-group-header" data-i18n="settings.group.global">' + _t('settings.group.global') + '</div>' +
      '<div class="settings-section-body">' +
        '<div class="settings-row" data-bind="theme">' +
          '<div>' +
            '<p class="settings-row-label" data-i18n="settings.theme.label">' + _t('settings.theme.label') + '</p>' +
            '<p class="settings-row-sub" data-i18n="settings.theme.sub">' + _t('settings.theme.sub') + '</p>' +
          '</div>' +
          '<div class="md-dropdown" data-bind="theme">' +
            '<button class="md-dropdown-trigger" type="button" aria-haspopup="true" aria-expanded="false">' +
              '<span class="md-dropdown-value">—</span>' +
              '<span class="material-symbols-rounded md-dropdown-arrow">arrow_drop_down</span>' +
            '</button>' +
            '<div class="md-dropdown-menu" role="menu">' + themeOptsHtml + '</div>' +
          '</div>' +
        '</div>' +
        '<div class="settings-row" data-bind="color_scheme">' +
          '<div>' +
            '<p class="settings-row-label" data-i18n="settings.colorScheme.label">' + _t('settings.colorScheme.label') + '</p>' +
            '<p class="settings-row-sub" data-i18n="settings.colorScheme.sub">' + _t('settings.colorScheme.sub') + '</p>' +
          '</div>' +
          '<div class="md-dropdown" data-bind="color_scheme">' +
            '<button class="md-dropdown-trigger" type="button" aria-haspopup="true" aria-expanded="false">' +
              '<span class="md-dropdown-value">—</span>' +
              '<span class="material-symbols-rounded md-dropdown-arrow">arrow_drop_down</span>' +
            '</button>' +
            '<div class="md-dropdown-menu" role="menu">' + schemeOptsHtml + '</div>' +
          '</div>' +
        '</div>' +
      '</div>';

    actions.innerHTML = _buildActions({ next: true });
    _wireActions();

    _bindDropdown(content, 'theme', THEMES.map(function (t) {
      return { value: t.value, label: _t('settings.theme.' + t.value) };
    }), theme, function (val) {
      _save({ theme: val }, function () { _applyTheme(val); });
    });

    _bindDropdown(content, 'color_scheme', COLOR_SCHEMES.map(function (c) {
      return { value: c.value, label: _t('settings.colorScheme.' + c.value) };
    }), scheme, function (val) {
      _save({ color_scheme: val }, function () { _applyColorScheme(val); });
    });
  }

  function _applyTheme(val) {
    if (val === 'system') {
      var isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
    } else {
      document.documentElement.setAttribute('data-theme', val);
    }
    if (App.state && App.state.currentDominantRgb && App.utils.applyDynamicTheme) {
      App.utils.applyDynamicTheme(App.state.currentDominantRgb);
    }
  }

  function _applyColorScheme(val) {
    if (!App.state) return;
    App.state.colorScheme = val || 'tonal_spot';
    if (App.state.currentDominantRgb && App.utils.applyDynamicTheme) {
      App.utils.applyDynamicTheme(App.state.currentDominantRgb, App.state.colorScheme);
    }
  }

  // ====================================================================
  // 步骤 5：音频设置
  // ====================================================================
  function _renderAudio(content, actions, titleEl, subEl) {
    _setTitle('onboarding.audio.title', 'onboarding.audio.subtitle', titleEl, subEl);

    var toggles = [
      { bind: 'wasapi_exclusive',    key: 'settings.wasapiExclusive', apply: function (v) { _applyWasapiExclusive(v); } },
      { bind: 'eq_enabled',          key: 'settings.eq',              apply: function (v) { var ae = window.__audioEngine; if (ae) ae.setEqEnabled(v); } },
      { bind: 'dynamic_bass',        key: 'settings.dynamicBass',     apply: function (v) { var ae = window.__audioEngine; if (ae) ae.setDynamicBass(v); } },
      { bind: 'compressor_enabled',  key: 'settings.compressor',      apply: function (v) { var ae = window.__audioEngine; if (ae) ae.setCompressorEnabled(v); } },
      { bind: 'vocal_enhance',       key: 'settings.vocalEnhance',    apply: function (v) { var ae = window.__audioEngine; if (ae) ae.setVocalEnhance(v); } },
    ];

    var rowsHtml = toggles.map(function (t) {
      var checked = _settings && _settings[t.bind] ? ' checked' : '';
      return '' +
        '<div class="settings-row" data-bind="' + t.bind + '">' +
          '<div>' +
            '<p class="settings-row-label" data-i18n="' + t.key + '.label">' + _t(t.key + '.label') + '</p>' +
            '<p class="settings-row-sub" data-i18n="' + t.key + '.sub">' + _t(t.key + '.sub') + '</p>' +
          '</div>' +
          '<label class="toggle">' +
            '<input type="checkbox" data-bind="' + t.bind + '"' + checked + '>' +
            '<div class="toggle-track"></div>' +
            '<div class="toggle-thumb"></div>' +
          '</label>' +
        '</div>';
    }).join('');

    content.innerHTML =
      '<div class="settings-group-header" data-i18n="settings.group.audio">' + _t('settings.group.audio') + '</div>' +
      '<div class="settings-section-body">' + rowsHtml + '</div>';

    actions.innerHTML = _buildActions({ next: true });
    _wireActions();

    _bindToggleRows(content, toggles);
  }

  function _applyWasapiExclusive(enabled) {
    App.utils.call('set_wasapi_exclusive', !!enabled).catch(function () { /* ignore */ });
  }

  // ====================================================================
  // 步骤 6：自动化与行为
  // ====================================================================
  function _renderAutomation(content, actions, titleEl, subEl) {
    _setTitle('onboarding.automation.title', 'onboarding.automation.subtitle', titleEl, subEl);

    var toggles = [
      { bind: 'shuffle',     key: 'settings.shuffle',     apply: function (v) { App.backend.set_shuffle(v); } },
      { bind: 'automix',     key: 'settings.automix',     apply: function (v) {
          App.utils.call('set_automix', v);
          if (v) { _obUncheck(content, 'gapless'); App.utils.call('set_gapless', false); }
        } },
      { bind: 'gapless',     key: 'settings.gapless',     apply: function (v) {
          App.utils.call('set_gapless', v);
          if (v) { _obUncheck(content, 'automix'); App.utils.call('set_automix', false); }
        } },
      { bind: 'smtc_lyrics', key: 'settings.smtcLyrics',  apply: function () {} },
    ];

    var rowsHtml = toggles.map(function (t) {
      var checked = _settings && _settings[t.bind] ? ' checked' : '';
      return '' +
        '<div class="settings-row" data-bind="' + t.bind + '">' +
          '<div>' +
            '<p class="settings-row-label" data-i18n="' + t.key + '.label">' + _t(t.key + '.label') + '</p>' +
            '<p class="settings-row-sub" data-i18n="' + t.key + '.sub">' + _t(t.key + '.sub') + '</p>' +
          '</div>' +
          '<label class="toggle">' +
            '<input type="checkbox" data-bind="' + t.bind + '"' + checked + '>' +
            '<div class="toggle-track"></div>' +
            '<div class="toggle-thumb"></div>' +
          '</label>' +
        '</div>';
    }).join('');

    content.innerHTML =
      '<div class="settings-group-header" data-i18n="settings.group.automation">' + _t('settings.group.automation') + '</div>' +
      '<div class="settings-section-body">' + rowsHtml + '</div>';

    actions.innerHTML = _buildActions({ next: true });
    _wireActions();

    _bindToggleRows(content, toggles);
  }

  // ====================================================================
  // 步骤 7：开始使用
  // ====================================================================
  function _renderStart(content, actions, titleEl, subEl) {
    _setTitle('onboarding.start.title', 'onboarding.start.subtitle', titleEl, subEl);

    var lang = (_settings && _settings.language) || 'zh-CN';
    var langLabel = (LANGUAGES.find(function (l) { return l.value === lang; }) || {}).label || lang;
    var theme = (_settings && _settings.theme) || 'system';
    var scheme = (_settings && _settings.color_scheme) || 'tonal_spot';

    content.innerHTML =
      '<div class="settings-group-header" data-i18n="onboarding.start.summary">' + _t('onboarding.start.summary') + '</div>' +
      '<div class="settings-section-body">' +
        _summaryRow('translate', 'onboarding.step.language', langLabel) +
        _summaryRow('folder_open', 'onboarding.step.library', _t('onboarding.library.added', { count: _libraryCount })) +
        _summaryRow('palette', 'onboarding.step.personalize', _t('settings.theme.' + theme) + ' · ' + _t('settings.colorScheme.' + scheme)) +
      '</div>';

    actions.innerHTML = _buildActions({ back: true, skip: false, finish: true });
    _wireActions();
  }

  function _summaryRow(icon, labelKey, value) {
    return '' +
      '<div class="settings-row">' +
        '<div style="display:flex;align-items:center;gap:14px;min-width:0;">' +
          '<span class="material-symbols-rounded" style="font-size:20px;color:var(--md-primary);flex-shrink:0;">' + icon + '</span>' +
          '<span class="settings-row-label" style="flex-shrink:0;" data-i18n="' + labelKey + '">' + _t(labelKey) + '</span>' +
        '</div>' +
        '<span class="settings-row-sub" style="font-weight:600;color:var(--md-on-surface);text-align:right;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + _esc(value) + '</span>' +
      '</div>';
  }

})();
