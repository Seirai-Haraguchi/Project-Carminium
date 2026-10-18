(function () {
  'use strict';

  window.App = window.App || {};

  var LETTER_RE = /^([A-Z]|#)$/;
  var LAYOUT_KEYS = { ArrowLeft: 1, ArrowRight: 1, ArrowUp: 1, ArrowDown: 1, Home: 1, End: 1 };

  var _state = null;
  var _paneRef = null;

  function _t(key, fallback) {
    var v = (window.App && App.i18n && App.i18n.t) ? App.i18n.t(key) : null;
    return (v && v !== key) ? v : fallback;
  }

  function _pane(host) {
    if (host && host.closest) {
      var p = host.closest('.content-pane');
      if (p) return p;
    }
    return document.getElementById('content-pane');
  }

  function _stickyHeight(pane) {
    if (!pane) return 0;
    var el = pane.querySelector('.page-sticky-header');
    return el ? el.offsetHeight : 0;
  }

  function _fit(panel, pane) {
    if (!panel || !panel.isConnected) return;
    var top = pane && panel.offsetParent === pane ? panel.offsetTop : _stickyHeight(pane);
    var h = (pane ? pane.clientHeight : window.innerHeight) - top;
    panel.style.minHeight = (h > 0 ? h : 0) + 'px';
  }

  function _buildPanel(letters) {
    var present = {};
    (letters || []).forEach(function (l) { present[l] = true; });

    var order = [];
    if (present['#']) order.push('#');
    for (var i = 0; i < 26; i++) order.push(String.fromCharCode(65 + i));

    var panel = document.createElement('div');
    panel.className = 'az-index-panel';
    panel.setAttribute('role', 'group');
    panel.setAttribute('aria-label', _t('azIndex.title', '按字母浏览'));

    var grid = document.createElement('div');
    grid.className = 'az-index-grid';

    var cells = [];
    order.forEach(function (letter) {
      var has = !!present[letter];
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'az-index-key';
      btn.dataset.letter = letter;
      btn.textContent = letter;
      if (has) {
        btn.addEventListener('click', function () { _pick(letter); });
        btn.dataset.enabled = '1';
      } else {
        btn.disabled = true;
        btn.setAttribute('aria-disabled', 'true');
        btn.setAttribute('title', _t('azIndex.noItems', '该字母下暂无内容'));
      }
      grid.appendChild(btn);
      cells.push(btn);
    });

    panel.appendChild(grid);

    panel.addEventListener('click', function (e) {
      if (!e.target.closest('.az-index-key')) close();
    });

    panel._cells = cells;
    return panel;
  }

  function _teardown() {
    var s = _state;
    if (!s) return null;
    s.finished = true;
    _state = null;
    if (s.onKeydown) document.removeEventListener('keydown', s.onKeydown, true);
    if (s.onResize) window.removeEventListener('resize', s.onResize);
    if (s.onExitEnd && s.panel) s.panel.removeEventListener('animationend', s.onExitEnd);
    if (s.exitTimer) { clearTimeout(s.exitTimer); s.exitTimer = null; }
    if (s.panel && s.panel.parentNode) s.panel.parentNode.removeChild(s.panel);
    if (s.host) s.host.style.display = s.prevDisplay || '';
    return s;
  }

  function _dismiss(opts) {
    var o = opts || {};
    var s = _state;
    if (!s) { if (o.done) o.done(); return; }
    if (s.exiting) return;
    s.exiting = true;

    var finish = function () {
      if (s.finished) return;
      var restore = !!o.restore && s.pane && s.host && document.contains(s.host);
      _teardown();

      if (restore) s.pane.scrollTop = s.scrollTop;
      if (o.done) o.done();
    };

    var onEnd = function (e) {
      if (e.target === s.panel && e.animationName === 'az-index-out') finish();
    };
    s.onExitEnd = onEnd;
    s.panel.addEventListener('animationend', onEnd);
    s.panel.classList.add('az-index-panel--out');

    s.exitTimer = setTimeout(finish, 400);
  }

  function _pick(letter) {
    var s = _state;
    if (!s || s.exiting) return;
    var cb = s.onPick;
    _dismiss({ done: function () { if (cb) cb(letter); } });
  }

  function close() {
    if (!_state || _state.exiting) return;
    _dismiss({ restore: true });
  }

  function reset() {
    _teardown();
  }

  function open(opts) {
    if (!opts || !opts.host || !opts.host.parentNode) return null;
    if (!isAlphabetical(opts.letters)) return null;
    if (_state) _teardown();

    var host = opts.host;
    var pane = _pane(host);
    _paneRef = pane;

    var panel = _buildPanel(opts.letters);

    _state = {
      host: host,
      pane: pane,
      panel: panel,
      onPick: opts.onPick || null,
      scrollTop: pane ? pane.scrollTop : 0,
      prevDisplay: host.style.display,
      onKeydown: null,
    };

    host.parentNode.insertBefore(panel, host);
    host.style.display = 'none';

    var onKeydown = function (e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        close();
      } else if (LAYOUT_KEYS[e.key] && panel.contains(document.activeElement)) {

        _moveFocus(panel, e);
      }
    };
    _state.onKeydown = onKeydown;
    document.addEventListener('keydown', onKeydown, true);

    _fit(panel, pane);
    var onResize = function () { _fit(panel, pane); };
    _state.onResize = onResize;
    window.addEventListener('resize', onResize);

    var firstEnabled = _firstEnabled(panel);
    if (firstEnabled) {
      try { firstEnabled.focus({ preventScroll: true }); }
      catch (e2) { firstEnabled.focus(); }
    }
    return panel;
  }

  function _firstEnabled(panel) {
    var cells = panel._cells || [];
    for (var i = 0; i < cells.length; i++) {
      if (!cells[i].disabled) return cells[i];
    }
    return null;
  }

  function _nearestEnabled(panel, idx, step) {
    var cells = panel._cells || [];
    while (idx >= 0 && idx < cells.length && cells[idx].disabled) idx += step;
    return (idx >= 0 && idx < cells.length) ? idx : -1;
  }

  function _moveFocus(panel, e) {
    var cells = panel._cells || [];
    if (!cells.length) return;
    var cur = cells.indexOf(document.activeElement);
    if (cur < 0) cur = cells.indexOf(_firstEnabled(panel));
    if (cur < 0) return;

    var cols = cells.length;
    var top = cells[0].offsetTop;
    for (var i = 1; i < cells.length; i++) {
      if (cells[i].offsetTop !== top) { cols = i; break; }
    }

    var next = cur;
    switch (e.key) {
      case 'ArrowLeft':  next = _nearestEnabled(panel, cur - 1, -1); break;
      case 'ArrowRight': next = _nearestEnabled(panel, cur + 1, 1); break;
      case 'ArrowUp':    next = _nearestEnabled(panel, cur - cols, -cols); break;
      case 'ArrowDown':  next = _nearestEnabled(panel, cur + cols, cols); break;
      case 'Home':       next = cells.indexOf(_firstEnabled(panel)); break;
      case 'End':        next = _nearestEnabled(panel, cells.length - 1, -1); break;
    }
    e.preventDefault();
    if (next < 0 || next === cur) return;
    cells[next].focus();
  }

  function isAlphabetical(letters) {
    if (!letters || letters.length < 2) return false;
    for (var i = 0; i < letters.length; i++) {
      if (!LETTER_RE.test(String(letters[i]))) return false;
    }
    return true;
  }

  function _currentPane() {
    return _paneRef || document.getElementById('content-pane');
  }

  function offsetOf(el) {
    var pane = _currentPane();
    if (!pane || !el) return 0;
    return el.getBoundingClientRect().top - pane.getBoundingClientRect().top + pane.scrollTop;
  }

  function scrollTo(top) {
    var pane = _currentPane();
    if (!pane) return;
    pane.scrollTop = Math.max(0, top - _stickyHeight(pane));
  }

  window.App.azIndex = {
    open: open,
    close: close,
    reset: reset,
    isAlphabetical: isAlphabetical,
    scrollTo: scrollTo,
    offsetOf: offsetOf,
  };
})();
