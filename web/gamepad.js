(function () {
  'use strict';

  var App = window.App || (window.App = {});

  var GamepadType = {
    DUALSENSE: 'dualsense',
    DUALSHOCK: 'dualshock',
    XBOX: 'xbox',
    GENERIC: 'generic',
  };


  var BTN = {
    FACE_BOTTOM: 0,
    FACE_RIGHT: 1,
    FACE_LEFT: 2,
    FACE_TOP: 3,
    LB: 4,
    RB: 5,
    LT: 6,
    RT: 7,
    SHARE: 8,
    OPTIONS: 9,
    L3: 10,
    R3: 11,
    DPAD_UP: 12,
    DPAD_DOWN: 13,
    DPAD_LEFT: 14,
    DPAD_RIGHT: 15,
    GUIDE: 16,
    TOUCHPAD: 17,
  };


  function _psCircle(size) {
    return '<svg viewBox="0 0 24 24" width="' + size + '" height="' + size + '">'
      + '<circle cx="12" cy="12" r="11" fill="#E8431A"/>'
      + '<circle cx="12" cy="12" r="6.5" fill="none" stroke="#fff" stroke-width="2.2"/>'
      + '</svg>';
  }

  function _psCross(size) {
    return '<svg viewBox="0 0 24 24" width="' + size + '" height="' + size + '">'
      + '<circle cx="12" cy="12" r="11" fill="#2A6DD0"/>'
      + '<path d="M8 8 L16 16 M16 8 L8 16" stroke="#fff" stroke-width="2.5" stroke-linecap="round"/>'
      + '</svg>';
  }

  function _psSquare(size) {
    return '<svg viewBox="0 0 24 24" width="' + size + '" height="' + size + '">'
      + '<circle cx="12" cy="12" r="11" fill="#C0CA33"/>'
      + '<rect x="6.5" y="6.5" width="11" height="11" fill="none" stroke="#fff" stroke-width="2.2" rx="1"/>'
      + '</svg>';
  }

  function _psTriangle(size) {
    return '<svg viewBox="0 0 24 24" width="' + size + '" height="' + size + '">'
      + '<circle cx="12" cy="12" r="11" fill="#7B8C53"/>'
      + '<path d="M12 6.5 L18 17 L6 17 Z" fill="none" stroke="#fff" stroke-width="2.2" stroke-linejoin="round"/>'
      + '</svg>';
  }

  function _psL1(size) {
    return '<svg viewBox="0 0 28 18" width="' + (size * 1.3) + '" height="' + (size * 0.82) + '">'
      + '<rect x="0.5" y="0.5" width="27" height="17" rx="4" fill="#3D3D3D" stroke="#777" stroke-width="0.8"/>'
      + '<text x="14" y="13" text-anchor="middle" font-size="10" font-weight="700" fill="#ddd" font-family="Arial,sans-serif">L1</text>'
      + '</svg>';
  }

  function _psR1(size) {
    return '<svg viewBox="0 0 28 18" width="' + (size * 1.3) + '" height="' + (size * 0.82) + '">'
      + '<rect x="0.5" y="0.5" width="27" height="17" rx="4" fill="#3D3D3D" stroke="#777" stroke-width="0.8"/>'
      + '<text x="14" y="13" text-anchor="middle" font-size="10" font-weight="700" fill="#ddd" font-family="Arial,sans-serif">R1</text>'
      + '</svg>';
  }

  function _psDpad(size) {
    return '<svg viewBox="0 0 24 24" width="' + size + '" height="' + size + '">'
      + '<path d="M10 2 H14 V10 H22 V14 H14 V22 H10 V14 H2 V10 H10 Z" fill="#555" stroke="#888" stroke-width="0.8"/>'
      + '</svg>';
  }

  function _psOptions(size) {
    return '<svg viewBox="0 0 28 18" width="' + (size * 1.3) + '" height="' + (size * 0.82) + '">'
      + '<rect x="0.5" y="0.5" width="27" height="17" rx="4" fill="#3D3D3D" stroke="#777" stroke-width="0.8"/>'
      + '<text x="14" y="13" text-anchor="middle" font-size="8" font-weight="600" fill="#ddd" font-family="Arial,sans-serif">OPT</text>'
      + '</svg>';
  }

  function _psL3(size) {
    return '<svg viewBox="0 0 24 24" width="' + size + '" height="' + size + '">'
      + '<circle cx="12" cy="12" r="11" fill="#444" stroke="#777" stroke-width="0.8"/>'
      + '<text x="12" y="16" text-anchor="middle" font-size="9" font-weight="700" fill="#ddd" font-family="Arial,sans-serif">L3</text>'
      + '</svg>';
  }

  function _psR3(size) {
    return '<svg viewBox="0 0 24 24" width="' + size + '" height="' + size + '">'
      + '<circle cx="12" cy="12" r="11" fill="#444" stroke="#777" stroke-width="0.8"/>'
      + '<text x="12" y="16" text-anchor="middle" font-size="9" font-weight="700" fill="#ddd" font-family="Arial,sans-serif">R3</text>'
      + '</svg>';
  }

  function _psTouchpad(size) {
    return '<svg viewBox="0 0 28 18" width="' + (size * 1.3) + '" height="' + (size * 0.82) + '">'
      + '<rect x="0.5" y="0.5" width="27" height="17" rx="4" fill="#3D3D3D" stroke="#777" stroke-width="0.8"/>'
      + '<rect x="4" y="3" width="20" height="12" rx="2" fill="none" stroke="#aaa" stroke-width="0.8"/>'
      + '</svg>';
  }

  function _xboxA(size) {
    return '<svg viewBox="0 0 24 24" width="' + size + '" height="' + size + '">'
      + '<circle cx="12" cy="12" r="11" fill="#5BB04B"/>'
      + '<text x="12" y="17" text-anchor="middle" font-size="13" font-weight="700" fill="#fff" font-family="Arial,sans-serif">A</text>'
      + '</svg>';
  }

  function _xboxB(size) {
    return '<svg viewBox="0 0 24 24" width="' + size + '" height="' + size + '">'
      + '<circle cx="12" cy="12" r="11" fill="#E0463E"/>'
      + '<text x="12" y="17" text-anchor="middle" font-size="13" font-weight="700" fill="#fff" font-family="Arial,sans-serif">B</text>'
      + '</svg>';
  }

  function _xboxX(size) {
    return '<svg viewBox="0 0 24 24" width="' + size + '" height="' + size + '">'
      + '<circle cx="12" cy="12" r="11" fill="#2A8DD4"/>'
      + '<text x="12" y="17" text-anchor="middle" font-size="13" font-weight="700" fill="#fff" font-family="Arial,sans-serif">X</text>'
      + '</svg>';
  }

  function _xboxY(size) {
    return '<svg viewBox="0 0 24 24" width="' + size + '" height="' + size + '">'
      + '<circle cx="12" cy="12" r="11" fill="#E0A030"/>'
      + '<text x="12" y="17" text-anchor="middle" font-size="13" font-weight="700" fill="#fff" font-family="Arial,sans-serif">Y</text>'
      + '</svg>';
  }

  function _xboxLB(size) {
    return '<svg viewBox="0 0 28 18" width="' + (size * 1.3) + '" height="' + (size * 0.82) + '">'
      + '<rect x="0.5" y="0.5" width="27" height="17" rx="4" fill="#2D2D2D" stroke="#888" stroke-width="0.8"/>'
      + '<text x="14" y="13" text-anchor="middle" font-size="10" font-weight="700" fill="#ddd" font-family="Arial,sans-serif">LB</text>'
      + '</svg>';
  }

  function _xboxRB(size) {
    return '<svg viewBox="0 0 28 18" width="' + (size * 1.3) + '" height="' + (size * 0.82) + '">'
      + '<rect x="0.5" y="0.5" width="27" height="17" rx="4" fill="#2D2D2D" stroke="#888" stroke-width="0.8"/>'
      + '<text x="14" y="13" text-anchor="middle" font-size="10" font-weight="700" fill="#ddd" font-family="Arial,sans-serif">RB</text>'
      + '</svg>';
  }

  function _xboxDpad(size) {
    return '<svg viewBox="0 0 24 24" width="' + size + '" height="' + size + '">'
      + '<path d="M10 2 H14 V10 H22 V14 H14 V22 H10 V14 H2 V10 H10 Z" fill="#555" stroke="#888" stroke-width="0.8"/>'
      + '</svg>';
  }

  function _xboxMenu(size) {
    return '<svg viewBox="0 0 28 18" width="' + (size * 1.3) + '" height="' + (size * 0.82) + '">'
      + '<rect x="0.5" y="0.5" width="27" height="17" rx="4" fill="#2D2D2D" stroke="#888" stroke-width="0.8"/>'
      + '<text x="14" y="13" text-anchor="middle" font-size="8" font-weight="600" fill="#ddd" font-family="Arial,sans-serif">≡</text>'
      + '</svg>';
  }

  function _xboxL3(size) {
    return '<svg viewBox="0 0 24 24" width="' + size + '" height="' + size + '">'
      + '<circle cx="12" cy="12" r="11" fill="#3D3D3D" stroke="#888" stroke-width="0.8"/>'
      + '<text x="12" y="16" text-anchor="middle" font-size="9" font-weight="700" fill="#ddd" font-family="Arial,sans-serif">LS</text>'
      + '</svg>';
  }

  function _xboxR3(size) {
    return '<svg viewBox="0 0 24 24" width="' + size + '" height="' + size + '">'
      + '<circle cx="12" cy="12" r="11" fill="#3D3D3D" stroke="#888" stroke-width="0.8"/>'
      + '<text x="12" y="16" text-anchor="middle" font-size="9" font-weight="700" fill="#ddd" font-family="Arial,sans-serif">RS</text>'
      + '</svg>';
  }

  function _genericA(size) {
    return '<svg viewBox="0 0 24 24" width="' + size + '" height="' + size + '">'
      + '<circle cx="12" cy="12" r="11" fill="#666" stroke="#999" stroke-width="0.8"/>'
      + '<text x="12" y="17" text-anchor="middle" font-size="13" font-weight="700" fill="#fff" font-family="Arial,sans-serif">A</text>'
      + '</svg>';
  }
  function _genericB(size) {
    return '<svg viewBox="0 0 24 24" width="' + size + '" height="' + size + '">'
      + '<circle cx="12" cy="12" r="11" fill="#666" stroke="#999" stroke-width="0.8"/>'
      + '<text x="12" y="17" text-anchor="middle" font-size="13" font-weight="700" fill="#fff" font-family="Arial,sans-serif">B</text>'
      + '</svg>';
  }
  function _genericX(size) {
    return '<svg viewBox="0 0 24 24" width="' + size + '" height="' + size + '">'
      + '<circle cx="12" cy="12" r="11" fill="#666" stroke="#999" stroke-width="0.8"/>'
      + '<text x="12" y="17" text-anchor="middle" font-size="13" font-weight="700" fill="#fff" font-family="Arial,sans-serif">X</text>'
      + '</svg>';
  }
  function _genericY(size) {
    return '<svg viewBox="0 0 24 24" width="' + size + '" height="' + size + '">'
      + '<circle cx="12" cy="12" r="11" fill="#666" stroke="#999" stroke-width="0.8"/>'
      + '<text x="12" y="17" text-anchor="middle" font-size="13" font-weight="700" fill="#fff" font-family="Arial,sans-serif">Y</text>'
      + '</svg>';
  }
  function _genericLB(size) {
    return '<svg viewBox="0 0 28 18" width="' + (size * 1.3) + '" height="' + (size * 0.82) + '">'
      + '<rect x="0.5" y="0.5" width="27" height="17" rx="4" fill="#555" stroke="#888" stroke-width="0.8"/>'
      + '<text x="14" y="13" text-anchor="middle" font-size="10" font-weight="700" fill="#ddd" font-family="Arial,sans-serif">LB</text>'
      + '</svg>';
  }
  function _genericRB(size) {
    return '<svg viewBox="0 0 28 18" width="' + (size * 1.3) + '" height="' + (size * 0.82) + '">'
      + '<rect x="0.5" y="0.5" width="27" height="17" rx="4" fill="#555" stroke="#888" stroke-width="0.8"/>'
      + '<text x="14" y="13" text-anchor="middle" font-size="10" font-weight="700" fill="#ddd" font-family="Arial,sans-serif">RB</text>'
      + '</svg>';
  }
  function _genericDpad(size) {
    return '<svg viewBox="0 0 24 24" width="' + size + '" height="' + size + '">'
      + '<path d="M10 2 H14 V10 H22 V14 H14 V22 H10 V14 H2 V10 H10 Z" fill="#666" stroke="#999" stroke-width="0.8"/>'
      + '</svg>';
  }
  function _genericMenu(size) {
    return '<svg viewBox="0 0 28 18" width="' + (size * 1.3) + '" height="' + (size * 0.82) + '">'
      + '<rect x="0.5" y="0.5" width="27" height="17" rx="4" fill="#555" stroke="#888" stroke-width="0.8"/>'
      + '<text x="14" y="13" text-anchor="middle" font-size="8" font-weight="600" fill="#ddd" font-family="Arial,sans-serif">≡</text>'
      + '</svg>';
  }
  function _genericL3(size) {
    return '<svg viewBox="0 0 24 24" width="' + size + '" height="' + size + '">'
      + '<circle cx="12" cy="12" r="11" fill="#555" stroke="#888" stroke-width="0.8"/>'
      + '<text x="12" y="16" text-anchor="middle" font-size="9" font-weight="700" fill="#ddd" font-family="Arial,sans-serif">L3</text>'
      + '</svg>';
  }
  function _genericR3(size) {
    return '<svg viewBox="0 0 24 24" width="' + size + '" height="' + size + '">'
      + '<circle cx="12" cy="12" r="11" fill="#555" stroke="#888" stroke-width="0.8"/>'
      + '<text x="12" y="16" text-anchor="middle" font-size="9" font-weight="700" fill="#ddd" font-family="Arial,sans-serif">R3</text>'
      + '</svg>';
  }

  var ICON_SETS = {};
  ICON_SETS[GamepadType.DUALSENSE] = ICON_SETS[GamepadType.DUALSHOCK] = {
    confirm: _psCircle,
    cancel: _psCross,
    play: _psSquare,
    like: _psTriangle,
    prev: _psL1,
    next: _psR1,
    dpad: _psDpad,
    menu: _psOptions,
    touchpad: _psTouchpad,
    l3: _psL3,
    r3: _psR3,
  };
  ICON_SETS[GamepadType.XBOX] = {
    confirm: _xboxA,
    cancel: _xboxB,
    play: _xboxX,
    like: _xboxY,
    prev: _xboxLB,
    next: _xboxRB,
    dpad: _xboxDpad,
    menu: _xboxMenu,
    l3: _xboxL3,
    r3: _xboxR3,
  };
  ICON_SETS[GamepadType.GENERIC] = {
    confirm: _genericA,
    cancel: _genericB,
    play: _genericX,
    like: _genericY,
    prev: _genericLB,
    next: _genericRB,
    dpad: _genericDpad,
    menu: _genericMenu,
    l3: _genericL3,
    r3: _genericR3,
  };

  function _getIconSet() {
    var base = ICON_SETS[_activeType];
    if (!base) return null;
    if (_buttonLayout !== 'western') return base;
    var swapped = Object.assign({}, base);
    swapped.confirm = base.cancel;
    swapped.cancel = base.confirm;
    return swapped;
  }

  var BUTTON_MAP_EASTERN = {};
  BUTTON_MAP_EASTERN[GamepadType.DUALSENSE] = BUTTON_MAP_EASTERN[GamepadType.DUALSHOCK] = {
    confirm: BTN.FACE_RIGHT,
    cancel: BTN.FACE_BOTTOM,
    play: BTN.FACE_LEFT,
    like: BTN.FACE_TOP,
    prev: BTN.LB,
    next: BTN.RB,
    vol_down: BTN.LT,
    vol_up: BTN.RT,
    menu: BTN.OPTIONS,
    touchpad: BTN.TOUCHPAD,
  };
  BUTTON_MAP_EASTERN[GamepadType.XBOX] = BUTTON_MAP_EASTERN[GamepadType.GENERIC] = {
    confirm: BTN.FACE_RIGHT,
    cancel: BTN.FACE_BOTTOM,
    play: BTN.FACE_LEFT,
    like: BTN.FACE_TOP,
    prev: BTN.LB,
    next: BTN.RB,
    vol_down: BTN.LT,
    vol_up: BTN.RT,
    menu: BTN.OPTIONS,
    touchpad: -1,
  };

  var BUTTON_MAP_WESTERN = {};
  Object.keys(BUTTON_MAP_EASTERN).forEach(function (type) {
    var m = Object.assign({}, BUTTON_MAP_EASTERN[type]);
    m.confirm = BUTTON_MAP_EASTERN[type].cancel;
    m.cancel = BUTTON_MAP_EASTERN[type].confirm;
    BUTTON_MAP_WESTERN[type] = m;
  });

  var _buttonLayout = 'eastern';

  function _getButtonMap() {
    return (_buttonLayout === 'western') ? BUTTON_MAP_WESTERN : BUTTON_MAP_EASTERN;
  }

  var _audioCtx = null;

  function _getAudioCtx() {
    if (!_audioCtx) {
      try {
        _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      } catch (e) { return null; }
    }
    return _audioCtx;
  }

  function _playBeep(freq, duration, volume, type) {
    var ctx = _getAudioCtx();
    if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume();

    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    osc.type = type || 'sine';
    osc.frequency.value = freq;

    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(volume, ctx.currentTime + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + duration);
  }

  function _sndNav()    { _playBeep(2400, 0.025, 0.04, 'square'); }

  function _sndConfirm() {
    _playBeep(700, 0.05, 0.08, 'sine');
    setTimeout(function () { _playBeep(1100, 0.04, 0.06, 'sine'); }, 25);
  }

  function _sndCancel()  { _playBeep(380, 0.08, 0.07, 'sine'); }

  function _sndBoundary() { _playBeep(200, 0.06, 0.05, 'sine'); }

  var _activeGamepad = null;
  var _activeType = null;
  var _prevButtonState = [];
  var _pollHandle = null;
  var _focusIndex = -1;
  var _focusElements = [];
  var _lastStickDir = null;
  var _windowFocused = true;
  var _navCooldown = 0;

  var NAV_COOLDOWN_MS = 200;
  var STICK_NAV_THRESHOLD = 0.5;
  var STICK_SCROLL_THRESHOLD = 0.15;
  var STICK_SCROLL_SPEED = 35;

  var _cursorX = window.innerWidth / 2;
  var _cursorY = window.innerHeight / 2;
  var _touchpadState = {
    active: false,
    startX: 0,
    startY: 0,
    lastX: 0,
    lastY: 0,
    startTime: 0,
    isClick: false,
  };
  var TOUCHPAD_SENSITIVITY = 1.5;
  var TOUCHPAD_CLICK_TIME = 150;
  var _cursorEl = null;


  function _getCursorEl() {
    if (_cursorEl) return _cursorEl;
    _cursorEl = document.createElement('div');
    _cursorEl.id = 'gamepad-cursor';
    _cursorEl.style.cssText =
      'position:fixed;' +
      'width:20px;' +
      'height:20px;' +
      'border-radius:50%;' +
      'background:rgba(255,255,255,0.9);' +
      'border:2px solid rgba(0,0,0,0.5);' +
      'box-shadow:0 2px 8px rgba(0,0,0,0.3);' +
      'pointer-events:none;' +
      'z-index:999999;' +
      'transform:translate(-50%,-50%);' +
      'transition:opacity 0.2s;' +
      'opacity:0;';
    document.body.appendChild(_cursorEl);
    return _cursorEl;
  }

  function _showCursor(show) {
    var cursor = _getCursorEl();
    cursor.style.opacity = show ? '1' : '0';
  }

  function _updateCursorPosition(x, y) {
    _cursorX = Math.max(10, Math.min(window.innerWidth - 10, x));
    _cursorY = Math.max(10, Math.min(window.innerHeight - 10, y));
    var cursor = _getCursorEl();
    cursor.style.left = _cursorX + 'px';
    cursor.style.top = _cursorY + 'px';
  }

  function _onTouchpadStart(x, y) {
    _touchpadState.active = true;
    _touchpadState.startX = x;
    _touchpadState.startY = y;
    _touchpadState.lastX = x;
    _touchpadState.lastY = y;
    _touchpadState.startTime = Date.now();
    _touchpadState.isClick = true;
    _showCursor(true);
  }

  function _onTouchpadMove(x, y) {
    if (!_touchpadState.active) return;

    var dx = (x - _touchpadState.lastX) * window.innerWidth * TOUCHPAD_SENSITIVITY;
    var dy = (y - _touchpadState.lastY) * window.innerHeight * TOUCHPAD_SENSITIVITY;

    _updateCursorPosition(_cursorX + dx, _cursorY + dy);

    _touchpadState.lastX = x;
    _touchpadState.lastY = y;

    var moveDist = Math.sqrt(
      Math.pow(x - _touchpadState.startX, 2) +
      Math.pow(y - _touchpadState.startY, 2)
    );
    if (moveDist > 0.05) {
      _touchpadState.isClick = false;
    }
  }

  function _onTouchpadEnd() {
    if (!_touchpadState.active) return;

    var duration = Date.now() - _touchpadState.startTime;

    if (_touchpadState.isClick && duration < TOUCHPAD_CLICK_TIME) {
      _simulateClickAtCursor();
    }

    _touchpadState.active = false;
    setTimeout(function () {
      if (!_touchpadState.active) {
        _showCursor(false);
      }
    }, 2000);
  }

  function _simulateClickAtCursor() {
    var el = document.elementFromPoint(_cursorX, _cursorY);
    if (!el) return;

    var mousedown = new MouseEvent('mousedown', {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: _cursorX,
      clientY: _cursorY,
      button: 0,
      buttons: 1,
    });
    var mouseup = new MouseEvent('mouseup', {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: _cursorX,
      clientY: _cursorY,
      button: 0,
      buttons: 0,
    });
    var click = new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: _cursorX,
      clientY: _cursorY,
      button: 0,
      buttons: 0,
    });

    el.dispatchEvent(mousedown);
    el.dispatchEvent(mouseup);
    el.dispatchEvent(click);

    var cursor = _getCursorEl();
    cursor.style.transform = 'translate(-50%,-50%) scale(0.8)';
    setTimeout(function () {
      cursor.style.transform = 'translate(-50%,-50%) scale(1)';
    }, 100);

    _sndConfirm();
  }


  function _detectType(id) {
    id = (id || '').toLowerCase();
    if (id.indexOf('dualsense') >= 0) return GamepadType.DUALSENSE;
    if (id.indexOf('dualshock') >= 0) return GamepadType.DUALSHOCK;
    if (id.indexOf('054c') >= 0) return GamepadType.DUALSHOCK;
    if (id.indexOf('xbox') >= 0 || id.indexOf('045e') >= 0) return GamepadType.XBOX;
    return GamepadType.GENERIC;
  }


  function _onWindowFocus() {
    _windowFocused = true;
    if (_activeGamepad) _startPolling();
  }

  function _onWindowBlur() {
    _windowFocused = false;
    _stopPolling();
    _clearFocus();
    _lastStickDir = null;
  }


  function _getContextHints() {
    var isFullscreen = document.body.classList.contains('np-fullscreen');
    var dialog = document.querySelector('.cmd-dialog-overlay[style*="flex"]');
    if (dialog || document.querySelector('.context-menu-layer.open')) {
      return [
        { iconKey: 'confirm', labelKey: 'common.confirm' },
        { iconKey: 'cancel', labelKey: 'common.cancel' },
      ];
    }
    if (isFullscreen) {
      var hints = [
        { iconKey: 'cancel', labelKey: 'gamepad.back' },
        { iconKey: 'play', labelKey: 'gamepad.playPause' },
        { iconKey: 'like', labelKey: 'gamepad.like' },
        { iconKey: 'prev', labelKey: 'gamepad.prevTrack' },
        { iconKey: 'next', labelKey: 'gamepad.nextTrack' },
      ];
      if (_activeType === GamepadType.DUALSENSE || _activeType === GamepadType.DUALSHOCK) {
        hints.unshift({ iconKey: 'touchpad', labelKey: 'gamepad.cursor' });
      }
      hints.push({ iconKey: 'l3', labelKey: 'gamepad.contextMenu' });
      return hints;
    }
    var hints = [
      { iconKey: 'confirm', labelKey: 'gamepad.confirm' },
      { iconKey: 'cancel', labelKey: 'gamepad.back' },
      { iconKey: 'play', labelKey: 'gamepad.playPause' },
      { iconKey: 'like', labelKey: 'gamepad.like' },
      { iconKey: 'prev', labelKey: 'gamepad.prevTrack' },
      { iconKey: 'next', labelKey: 'gamepad.nextTrack' },
    ];
    if (_activeType === GamepadType.DUALSENSE || _activeType === GamepadType.DUALSHOCK) {
      hints.push({ iconKey: 'touchpad', labelKey: 'gamepad.cursor' });
    }
    hints.push({ iconKey: 'l3', labelKey: 'gamepad.contextMenu' });
    return hints;
  }

  function _renderHints() {
    var containers = [
      document.getElementById('title-bar-gamepad-hints'),
      document.getElementById('np-gamepad-hints'),
    ];

    if (!_activeGamepad || !_activeType) {
      containers.forEach(function (c) {
        if (!c) return;
        c.style.display = 'none';
        c.innerHTML = '';
      });
      return;
    }

    var icons = _getIconSet();
    if (!icons) return;
    var hints = _getContextHints();
    var size = 16;
    var html = '';
    hints.forEach(function (hint) {
      var iconFn = icons[hint.iconKey];
      if (!iconFn) return;
      var label = (App.i18n && App.i18n.t) ? App.i18n.t(hint.labelKey) : hint.labelKey;
      html += '<span class="gp-hint">'
        + '<span class="gp-hint-icon">' + iconFn(size) + '</span>'
        + '<span class="gp-hint-label">' + label + '</span>'
        + '</span>';
    });

    containers.forEach(function (c) {
      if (!c) return;
      c.innerHTML = html;
      c.style.display = '';
    });
  }


  function _onGamepadConnected(e) {
    var gp = e.gamepad;
    var type = _detectType(gp.id);
    _activeGamepad = gp;
    _activeType = type;
    _prevButtonState = new Array(gp.buttons.length).fill(false);
    document.body.classList.add('gamepad-connected');
    document.body.setAttribute('data-gamepad-type', type);
    _renderHints();
    if (_windowFocused) _startPolling();
    console.log('[gamepad] 已连接:', gp.id, '→', type);
  }

  function _onGamepadDisconnected(e) {
    var gp = e.gamepad;
    if (_activeGamepad && _activeGamepad.index === gp.index) {
      _activeGamepad = null;
      _activeType = null;
      _prevButtonState = [];
      document.body.classList.remove('gamepad-connected');
      document.body.removeAttribute('data-gamepad-type');
      _renderHints();
      _stopPolling();
      _clearFocus();
      console.log('[gamepad] 已断开:', gp.id);
    }
  }


  function _startPolling() {
    if (_pollHandle) return;
    _pollHandle = requestAnimationFrame(_poll);
  }

  function _stopPolling() {
    if (_pollHandle) {
      cancelAnimationFrame(_pollHandle);
      _pollHandle = null;
    }
  }

  function _poll() {
    _pollHandle = requestAnimationFrame(_poll);
    if (!_windowFocused) return;
    if (!_activeGamepad) return;

    var pads = navigator.getGamepads ? navigator.getGamepads() : [];
    var gp = null;
    for (var i = 0; i < pads.length; i++) {
      if (pads[i] && pads[i].index === _activeGamepad.index) {
        gp = pads[i];
        break;
      }
    }
    if (!gp) return;
    _activeGamepad = gp;

    var map = _getButtonMap()[_activeType];
    if (!map) return;

    var buttons = gp.buttons;
    for (var b = 0; b < buttons.length; b++) {
      var pressed = buttons[b] ? buttons[b].pressed : false;
      var wasPressed = _prevButtonState[b] || false;
      if (pressed && !wasPressed) {
        _onButtonDown(b, map);
      }
      _prevButtonState[b] = pressed;
    }

    if (gp.axes && gp.axes.length >= 2) {
      _processLeftStick(gp.axes[0], gp.axes[1]);
    }
    if (gp.axes && gp.axes.length >= 4) {
      _processRightStick(gp.axes[2], gp.axes[3]);
    }

    _processTouchpad(gp);
  }

  function _processTouchpad(gp) {
    if (_activeType !== GamepadType.DUALSENSE && _activeType !== GamepadType.DUALSHOCK) {
      return;
    }

    var touchpadBtn = gp.buttons && gp.buttons[BTN.TOUCHPAD];
    var isPressed = touchpadBtn && touchpadBtn.pressed;
    
    var touchpadData = gp.touchpad;
    
    if (isPressed !== _touchpadState._lastLoggedPressed) {
      console.log('[gamepad] Touchpad button state:', isPressed, 'touchpadData:', touchpadData ? 'available' : 'none');
      _touchpadState._lastLoggedPressed = isPressed;
    }

    if (isPressed && !_touchpadState.active) {
      var x = 0.5, y = 0.5;
      if (touchpadData && touchpadData.length >= 2) {
        x = touchpadData[0];
        y = touchpadData[1];
      }
      _onTouchpadStart(x, y);
    }

    if (_touchpadState.active) {
      var x = _touchpadState.lastX;
      var y = _touchpadState.lastY;

      if (touchpadData && touchpadData.length >= 2) {
        x = touchpadData[0];
        y = touchpadData[1];
      }

      _onTouchpadMove(x, y);

      if (!isPressed) {
        _onTouchpadEnd();
      }
    }
  }


  function _onButtonDown(buttonIndex, map) {
    if (buttonIndex === map.confirm) { _actionConfirm(); return; }
    if (buttonIndex === map.cancel) { _actionCancel(); return; }
    if (buttonIndex === map.play) { _actionPlayPause(); return; }
    if (buttonIndex === map.like) { _actionToggleLike(); return; }
    if (buttonIndex === map.prev) { _actionPrevTrack(); return; }
    if (buttonIndex === map.next) { _actionNextTrack(); return; }
    if (buttonIndex === map.vol_down) { _actionVolumeDown(); return; }
    if (buttonIndex === map.vol_up) { _actionVolumeUp(); return; }
    if (buttonIndex === map.menu) { _actionMenu(); return; }
    if (buttonIndex === BTN.L3) { _actionRightClick(); return; }
    if (buttonIndex === BTN.R3) { _actionRightClick(); return; }
    if (Date.now() >= _navCooldown) {
      if (buttonIndex === BTN.DPAD_UP) { _spatialNavigate(0, -1); _navCooldown = Date.now() + NAV_COOLDOWN_MS; return; }
      if (buttonIndex === BTN.DPAD_DOWN) { _spatialNavigate(0, 1); _navCooldown = Date.now() + NAV_COOLDOWN_MS; return; }
      if (buttonIndex === BTN.DPAD_LEFT) { _spatialNavigate(-1, 0); _navCooldown = Date.now() + NAV_COOLDOWN_MS; return; }
      if (buttonIndex === BTN.DPAD_RIGHT) { _spatialNavigate(1, 0); _navCooldown = Date.now() + NAV_COOLDOWN_MS; return; }
    }
  }


  function _processLeftStick(x, y) {
    var magnitude = Math.sqrt(x * x + y * y);

    if (magnitude < STICK_NAV_THRESHOLD) {
      _lastStickDir = null;
      return;
    }

    if (Date.now() < _navCooldown) return;

    var angle = Math.atan2(-y, x) * 180 / Math.PI;
    if (angle < 0) angle += 360;

    var dir;
    if (angle >= 337.5 || angle < 22.5) dir = 'right';
    else if (angle < 67.5) dir = 'up-right';
    else if (angle < 112.5) dir = 'up';
    else if (angle < 157.5) dir = 'up-left';
    else if (angle < 202.5) dir = 'left';
    else if (angle < 247.5) dir = 'down-left';
    else if (angle < 292.5) dir = 'down';
    else dir = 'down-right';

    _lastStickDir = dir;

    var dx = 0, dy = 0;
    if (dir.indexOf('right') >= 0) dx = 1;
    if (dir.indexOf('left') >= 0) dx = -1;
    if (dir.indexOf('up') >= 0) dy = -1;
    if (dir.indexOf('down') >= 0) dy = 1;

    _spatialNavigate(dx, dy);
    _navCooldown = Date.now() + NAV_COOLDOWN_MS;
  }

  function _processRightStick(x, y) {
    if (Math.abs(y) < STICK_SCROLL_THRESHOLD && Math.abs(x) < STICK_SCROLL_THRESHOLD) return;

    var scrollTarget = _findScrollTarget();
    if (!scrollTarget) return;

    if (Math.abs(y) > STICK_SCROLL_THRESHOLD) {
      var scrollAmount = Math.round(y * STICK_SCROLL_SPEED);
      scrollTarget.scrollTop += scrollAmount;
    }
    if (Math.abs(x) > STICK_SCROLL_THRESHOLD && scrollTarget.scrollWidth > scrollTarget.clientWidth) {
      var scrollAmountX = Math.round(x * STICK_SCROLL_SPEED);
      scrollTarget.scrollLeft += scrollAmountX;
    }
  }

  function _findScrollTarget() {
    if (document.body.classList.contains('np-fullscreen')) {
      var lyricsPanel = document.querySelector('.np-panel--lyrics .np-lyrics-wrap');
      if (lyricsPanel) return lyricsPanel;
      var queuePanel = document.querySelector('.np-panel--queue .np-queue-list');
      if (queuePanel) return queuePanel;
    }
    var contentPane = document.getElementById('content-pane');
    if (contentPane && contentPane.scrollHeight > contentPane.clientHeight) {
      return contentPane;
    }
    if (_focusIndex >= 0 && _focusElements[_focusIndex]) {
      var el = _focusElements[_focusIndex];
      var parent = el.parentElement;
      while (parent && parent !== document.body) {
        if (parent.scrollHeight > parent.clientHeight &&
            getComputedStyle(parent).overflowY !== 'visible') {
          return parent;
        }
        parent = parent.parentElement;
      }
    }
    return contentPane || document.documentElement;
  }


  function _getFocusableElements() {
    var selectors = [
      '.track-row',
      '.album-card',
      '.artist-card',
      '.folder-item',
      '.playlist-item',
      '.nav-item',
      '.np-queue-item',
      '.search-result-item',
      '.settings-row',
      '.np-control-pill',
      '.np-play-pill',
      '.np-secondary-btn',
      '.np-audio-mode-btn',
      '.icon-btn',
      '.mini-btn',
      '.mini-btn-play',
      '.split-btn-main',
      '.split-btn-dropdown',
      '.np-collapse-btn',
      '.np-pivot-tab',
      '.np-lyrics-tool-btn',
      '.np-lyrics-source',
      'button:not([disabled])',
      '[role="tab"]',
    ];
    var selector = selectors.join(', ');
    var elements = [];
    var all = document.querySelectorAll(selector);
    all.forEach(function (el) {
      var rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        if (!el.closest('.title-bar')) {
          elements.push(el);
        }
      }
    });
    return elements;
  }

  function _applyFocus() {
    document.querySelectorAll('.gp-focused').forEach(function (el) {
      el.classList.remove('gp-focused');
    });
    if (_focusIndex >= 0 && _focusIndex < _focusElements.length) {
      var el = _focusElements[_focusIndex];
      if (el) {
        el.classList.add('gp-focused');
        el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    }
  }

  function _clearFocus() {
    document.querySelectorAll('.gp-focused').forEach(function (el) {
      el.classList.remove('gp-focused');
    });
    _focusIndex = -1;
    _focusElements = [];
  }

  function _spatialNavigate(dx, dy) {
    _focusElements = _getFocusableElements();
    if (_focusElements.length === 0) return;

    if (_focusIndex < 0) {
      _focusIndex = 0;
      _applyFocus();
      return;
    }

    var currentEl = _focusElements[_focusIndex];
    if (!currentEl) {
      _focusIndex = 0;
      _applyFocus();
      return;
    }

    var curRect = currentEl.getBoundingClientRect();
    var originX = curRect.left + curRect.width / 2;
    var originY = curRect.top + curRect.height / 2;

    var dlen = Math.sqrt(dx * dx + dy * dy);
    if (dlen === 0) return;
    var ndx = dx / dlen;
    var ndy = dy / dlen;

    var bestIdx = -1;
    var bestScore = -Infinity;

    for (var i = 0; i < _focusElements.length; i++) {
      if (i === _focusIndex) continue;
      var el = _focusElements[i];
      var rect = el.getBoundingClientRect();
      var cx = rect.left + rect.width / 2;
      var cy = rect.top + rect.height / 2;

      var vx = cx - originX;
      var vy = cy - originY;
      var dist = Math.sqrt(vx * vx + vy * vy);
      if (dist < 2) continue;

      var nvx = vx / dist;
      var nvy = vy / dist;

      var dot = nvx * ndx + nvy * ndy;
      if (dot <= 0.05) continue;

      var score = dot * 100 - dist * 0.05;

      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }

    if (bestIdx < 0) {
      var isSidebar = currentEl.closest('#nav-drawer') ||
                       currentEl.classList.contains('nav-item');
      if (isSidebar && dx !== 0) {
        var contentPane = document.getElementById('content-pane');
        if (contentPane) {
          for (var j = 0; j < _focusElements.length; j++) {
            var cel = _focusElements[j];
            if (cel.closest('#content-pane') &&
                cel.getBoundingClientRect().width > 0) {
              _focusIndex = j;
              _applyFocus();
              _sndNav();
              return;
            }
          }
        }
      }
      _sndBoundary();
      return;
    }

    if (bestIdx >= 0) {
      _focusIndex = bestIdx;
      _applyFocus();
      _sndNav();
    }
  }


  function _actionConfirm() {
    if (_focusIndex >= 0 && _focusElements[_focusIndex]) {
      var el = _focusElements[_focusIndex];
      el.classList.add('gp-pressed');
      setTimeout(function () { el.classList.remove('gp-pressed'); }, 150);
      _sndConfirm();
      el.click();
      return;
    }
    if (App.state && App.state.currentTrack) {
      _sndConfirm();
      _actionPlayPause();
    }
  }

  function _actionCancel() {
    var cmOverlay = document.querySelector('.context-menu-layer.open');
    if (cmOverlay && App.contextMenu && App.contextMenu.hide) {
      _sndCancel();
      App.contextMenu.hide();
      return;
    }
    var dialog = document.querySelector('.cmd-dialog-overlay[style*="flex"]');
    if (dialog) {
      var closeBtn = dialog.querySelector('.cmd-dialog-btn--cancel, .cmd-dialog-close');
      if (closeBtn) { _sndCancel(); closeBtn.click(); return; }
    }
    if (document.body.classList.contains('np-fullscreen')) {
      var fsBtn = document.getElementById('btn-fullscreen');
      if (fsBtn) { _sndCancel(); fsBtn.click(); return; }
    }
    if (document.body.classList.contains('window-fullscreen')) {
      _sndCancel();
      if (window.__electronAPI) {
        window.__electronAPI.invoke('maximize_window');
      }
      return;
    }
    var backBtn = document.getElementById('title-bar-back');
    if (backBtn && !backBtn.disabled) {
      _sndCancel();
      backBtn.click();
    } else {
      _sndBoundary();
    }
  }

  function _actionPlayPause() {
    if (App.backend) {
      if (App.state.playbackState === 'playing') {
        if (App.backend.pause) App.backend.pause();
      } else {
        if (App.backend.play) App.backend.play();
      }
    }
  }

  function _actionToggleLike() {
    if (App.backend && App.backend.toggle_liked) {
      App.backend.toggle_liked();
    }
  }

  function _actionPrevTrack() {
    if (App.backend && App.backend.prev_track) {
      App.backend.prev_track();
    }
  }

  function _actionNextTrack() {
    if (App.backend && App.backend.next_track) {
      App.backend.next_track();
    }
  }

  function _actionVolumeDown() {
    if (!App.backend || !App.backend.set_volume) return;
    App.utils.call('get_player_state').then(function (res) {
      var state = JSON.parse(res);
      var newVol = Math.max(0, (state.volume || 80) - 5);
      App.backend.set_volume(newVol);
    });
  }

  function _actionVolumeUp() {
    if (!App.backend || !App.backend.set_volume) return;
    App.utils.call('get_player_state').then(function (res) {
      var state = JSON.parse(res);
      var newVol = Math.min(100, (state.volume || 80) + 5);
      App.backend.set_volume(newVol);
    });
  }

  function _actionMenu() {
    _actionPlayPause();
  }

  function _actionTouchpad() {
    var fsBtn = document.getElementById('btn-fullscreen');
    if (fsBtn) {
      fsBtn.click();
    }
  }

  function _actionRightClick() {
    if (_focusIndex >= 0 && _focusElements[_focusIndex]) {
      var el = _focusElements[_focusIndex];
      _simulateContextMenu(el);
    } else {
      _simulateContextMenuAtCursor();
    }
  }

  function _simulateContextMenu(el) {
    if (!el) return;
    var rect = el.getBoundingClientRect();
    var x = rect.left + rect.width / 2;
    var y = rect.top + rect.height / 2;
    _dispatchContextMenu(x, y, el);
  }

  function _simulateContextMenuAtCursor() {
    var x = _cursorX || window.innerWidth / 2;
    var y = _cursorY || window.innerHeight / 2;
    var el = document.elementFromPoint(x, y);
    _dispatchContextMenu(x, y, el);
  }

  function _dispatchContextMenu(x, y, target) {
    target = target || document.elementFromPoint(x, y) || document.body;
    var event = new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: x,
      clientY: y,
      screenX: x,
      screenY: y,
      button: 2,
      buttons: 2,
    });
    target.dispatchEvent(event);
    _sndConfirm();
  }


  function _onNavigateOrRender() {
    requestAnimationFrame(function () {
      _focusElements = _getFocusableElements();
      if (_focusIndex >= _focusElements.length) {
        _focusIndex = -1;
        document.querySelectorAll('.gp-focused').forEach(function (el) {
          el.classList.remove('gp-focused');
        });
      }
      _renderHints();
    });
  }


  function init() {
    window.addEventListener('gamepadconnected', _onGamepadConnected);
    window.addEventListener('gamepaddisconnected', _onGamepadDisconnected);

    _windowFocused = document.hasFocus();
    window.addEventListener('focus', _onWindowFocus);
    window.addEventListener('blur', _onWindowBlur);
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) {
        _onWindowBlur();
      } else {
        _onWindowFocus();
      }
    });

    var pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (var i = 0; i < pads.length; i++) {
      if (pads[i]) {
        _onGamepadConnected({ gamepad: pads[i] });
        break;
      }
    }

    if (App.navigate) {
      var _origNavigate = App.navigate;
      if (!_origNavigate._gpHooked) {
        App.navigate = function (pageId, params) {
          var result = _origNavigate.apply(this, arguments);
          _onNavigateOrRender();
          return result;
        };
        App.navigate._gpHooked = true;
      }
    } else {
      var checkInterval = setInterval(function () {
        if (App.navigate && !App.navigate._gpHooked) {
          var _origNav = App.navigate;
          App.navigate = function (pageId, params) {
            var result = _origNav.apply(this, arguments);
            _onNavigateOrRender();
            return result;
          };
          App.navigate._gpHooked = true;
          clearInterval(checkInterval);
        }
      }, 200);
      setTimeout(function () { clearInterval(checkInterval); }, 10000);
    }

    if (App.i18n && App.i18n.onChange) {
      App.i18n.onChange(function () {
        _renderHints();
      });
    }

    var npPane = document.getElementById('now-playing-pane');
    if (npPane) {
      var observer = new MutationObserver(function (mutations) {
        mutations.forEach(function (m) {
          if (m.attributeName === 'class') {
            _renderHints();
          }
        });
      });
      observer.observe(npPane, { attributes: true, attributeFilter: ['class'] });
    }

    console.log('[gamepad] 模块已初始化');

    if (App.utils && App.utils.call) {
      App.utils.call('get_settings').then(function (res) {
        try {
          var s = JSON.parse(res);
          if (s.gamepad_button_layout) {
            _buttonLayout = s.gamepad_button_layout;
            _renderHints();
            console.log('[gamepad] 初始按钮布局:', _buttonLayout);
          }
        } catch (e) {  }
      });
    }
  }

  App.gamepad = {
    init: init,
    getType: function () { return _activeType; },
    isConnected: function () { return !!_activeGamepad; },
    isFocused: function () { return _windowFocused; },
    refreshHints: _renderHints,
    setButtonLayout: function (layout) {
      _buttonLayout = (layout === 'western') ? 'western' : 'eastern';
      _renderHints();
      console.log('[gamepad] 按钮布局已切换:', _buttonLayout);
    },
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
