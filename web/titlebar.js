(function () {
  'use strict';

  var App = window.App || (window.App = {});



  var ICON_SVG = {
    back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 6l-6 6 6 6"/></svg>',
  };

  var MDL2 = {
    minimize: '\uE921',
    maximize: '\uE922',
    restore:  '\uE923',
    close:    '\uE8BB',
  };

  var _platform = (window.__electronAPI && window.__electronAPI.platform) || 'win32';
  var _isWin = _platform === 'win32';

  var TRAFFIC_SVG = {
    close:    '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M3 3l6 6M9 3l-6 6"/></svg>',
    minimize: '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M2.5 6h7"/></svg>',
    maximize: '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 4.5v4a.5.5 0 0 0 .5.5h4a.5.5 0 0 0 .5-.5v-4a.5.5 0 0 0-.5-.5h-4a.5.5 0 0 0-.5.5z"/><path d="M5 3h4a.5.5 0 0 1 .5.5v4"/></svg>',
    restore:  '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 5v3a.5.5 0 0 0 .5.5h3a.5.5 0 0 0 .5-.5v-3a.5.5 0 0 0-.5-.5h-3a.5.5 0 0 0-.5.5z"/><path d="M5 2.5h3a.5.5 0 0 1 .5.5v3"/></svg>',
  };

  function _applyIcons() {
    _setSvg('title-bar-back-icon', ICON_SVG.back);

    if (_isWin) {
      ['title-bar-min-icon', 'title-bar-max-icon', 'title-bar-close-icon'].forEach(function (id) {
        var el = document.getElementById(id);
        if (el) el.style.fontFamily = '"Segoe Fluent Icons", sans-serif';
      });
      _setGlyph('title-bar-min-icon', MDL2.minimize);
      _setGlyph('title-bar-close-icon', MDL2.close);

      var isMax = document.body.classList.contains('window-maximized');
      _setGlyph('title-bar-max-icon', isMax ? MDL2.restore : MDL2.maximize);
    } else {
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


  function _getLogoSrc() {
    var isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    return isDark ? 'logo-dark.svg' : 'logo.svg';
  }

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

  function init() {
    document.body.classList.add('platform-' + _platform);
    if (!_isWin) document.body.classList.add('platform-non-win');

    if (!_isWin) _rearrangeTrafficLights();

    _applyIcons();
    _bindMiniWindowButton();
    _bindWindowControls();
    _bindBackButton();
    _bindDoubleClick();
    _loadVersionInfo();
    _loadLogo();
    _watchThemeChange();
  }

  function _rearrangeTrafficLights() {
    var leftContainer = document.querySelector('.title-bar-left');
    if (!leftContainer) return;

    var closeBtn = document.getElementById('title-bar-close');
    var minBtn = document.getElementById('title-bar-min');
    var maxBtn = document.getElementById('title-bar-max');
    if (!closeBtn || !minBtn || !maxBtn) return;

    var group = document.createElement('div');
    group.className = 'traffic-light-group';
    group.appendChild(closeBtn);
    group.appendChild(minBtn);
    group.appendChild(maxBtn);

    leftContainer.insertBefore(group, leftContainer.firstChild);
  }


  function _bindMiniWindowButton() {
    var miniBtn = document.getElementById('title-bar-mini');
    if (!miniBtn) return;
    miniBtn.addEventListener('click', function () {
      if (window.__electronAPI) {
        window.__electronAPI.invoke('toggle_floating_window');
      }
    });
  }


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


  function _bindDoubleClick() {
    var titleBar = document.getElementById('title-bar');
    if (!titleBar) return;

    titleBar.addEventListener('dblclick', function (e) {
      if (e.target.closest('.title-bar-btn')) return;
      if (window.__electronAPI) {
        window.__electronAPI.invoke('maximize_window');
      }
    });
  }


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


  function _updateBackButton() {
    var backBtn = document.getElementById('title-bar-back');
    if (!backBtn) return;

    var history = App.navHistory || [];
    var canGoBack = history.length > 1;
    if (App.state && App.state.currentPage === 'settings') canGoBack = true;
    backBtn.disabled = !canGoBack;
    backBtn.style.opacity = canGoBack ? '' : '0.4';
    backBtn.style.pointerEvents = canGoBack ? '' : 'none';
  }


  window.__updateMaximizedState = function (isMaximized) {
    document.body.classList.toggle('window-maximized', !!isMaximized);
    if (_isWin) {
      _setGlyph('title-bar-max-icon', isMaximized ? MDL2.restore : MDL2.maximize);
    } else {
      _setSvg('title-bar-max-icon', isMaximized ? TRAFFIC_SVG.restore : TRAFFIC_SVG.maximize);
    }
  };


  window.__updateFullscreenState = function (isFullscreen) {
    document.body.classList.toggle('window-fullscreen', !!isFullscreen);
  };


  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  App.titlebar = {
    init: init,
    updateBackButton: _updateBackButton,
    toggleTrafficLights: function () {
      var isOn = document.body.classList.toggle('platform-non-win');
      if (isOn) {
        if (!document.querySelector('.traffic-light-group')) {
          _rearrangeTrafficLights();
        }
      } else {
        var group = document.querySelector('.traffic-light-group');
        if (group) {
          var right = document.querySelector('.title-bar-right');
          if (right) {
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
      _applyIcons();
      return isOn;
    },
  };
})();
