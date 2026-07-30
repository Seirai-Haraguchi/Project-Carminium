/**
 * Carminium — 手柄控制器支持
 *
 * 支持 DualSense (PS5) / DualShock 4 (PS4) / Xbox 手柄
 * - 自动检测手柄类型
 * - 使用 SVG 渲染对应手柄的真实按钮图标
 * - 标题栏/全窗口视图中间显示按钮提示（如 ○ 确认 ✖ 返回）
 * - 全向空间焦点导航（8 方向，摇杆 + D-Pad）
 * - 窗口失焦时自动停止接收手柄输入
 * - DualSense/DualShock 触摸板支持
 *
 * 按钮约定：
 *   PlayStation (亚洲惯例): ○=确认, ✖=取消
 *   Xbox (西方惯例): A=确认, B=取消
 */
(function () {
  'use strict';

  var App = window.App || (window.App = {});

  // ── 手柄类型 ──────────────────────────────────────────────────
  var GamepadType = {
    DUALSENSE: 'dualsense',  // PS5
    DUALSHOCK: 'dualshock',  // PS4
    XBOX: 'xbox',            // Xbox One / Series
    GENERIC: 'generic',      // 其他通用手柄
  };

  // ── 标准按钮索引（Gamepad API 标准）────────────────────────────
  //  0: 底部面键 (Cross/A)    1: 右侧面键 (Circle/B)
  //  2: 左侧面键 (Square/X)   3: 顶部面键 (Triangle/Y)
  //  4: LB/L1                 5: RB/R1
  //  6: LT/L2                 7: RT/R2
  //  8: Share/View            9: Options/Menu
  // 10: L3                    11: R3
  // 12: D-Pad Up             13: D-Pad Down
  // 14: D-Pad Left           15: D-Pad Right
  // 16: Guide/PS
  // 17: Touchpad (DualSense/DualShock only)

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

  // ── SVG 按钮图标库 ─────────────────────────────────────────────

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

  // 按钮图标集合：每种手柄类型的 SVG 生成函数
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
  };

  // ── 按钮索引映射 ──────────────────────────────────────────────
  var BUTTON_MAP = {};
  BUTTON_MAP[GamepadType.DUALSENSE] = BUTTON_MAP[GamepadType.DUALSHOCK] = {
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
  BUTTON_MAP[GamepadType.XBOX] = BUTTON_MAP[GamepadType.GENERIC] = {
    confirm: BTN.FACE_BOTTOM,
    cancel: BTN.FACE_RIGHT,
    play: BTN.FACE_LEFT,
    like: BTN.FACE_TOP,
    prev: BTN.LB,
    next: BTN.RB,
    vol_down: BTN.LT,
    vol_up: BTN.RT,
    menu: BTN.OPTIONS,
    touchpad: -1, // Xbox 无触摸板
  };

  // ── 音效系统（Web Audio API 合成）──────────────────────────────
  var _audioCtx = null;

  function _getAudioCtx() {
    if (!_audioCtx) {
      try {
        _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      } catch (e) { return null; }
    }
    return _audioCtx;
  }

  /**
   * 播放一个简短的合成音。
   * @param {number} freq - 频率 Hz
   * @param {number} duration - 持续时间 秒
   * @param {number} volume - 音量 0~1
   * @param {string} type - 波形 'sine'|'square'|'triangle'
   */
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

  /** 焦点移动音：短促高音 tick */
  function _sndNav()    { _playBeep(2400, 0.025, 0.04, 'square'); }

  /** 确认/按下音：双音 click */
  function _sndConfirm() {
    _playBeep(700, 0.05, 0.08, 'sine');
    setTimeout(function () { _playBeep(1100, 0.04, 0.06, 'sine'); }, 25);
  }

  /** 取消/返回音：低沉短音 */
  function _sndCancel()  { _playBeep(380, 0.08, 0.07, 'sine'); }

  /** 边界音：无可聚焦目标 */
  function _sndBoundary() { _playBeep(200, 0.06, 0.05, 'sine'); }

  // ── 内部状态 ──────────────────────────────────────────────────
  var _activeGamepad = null;
  var _activeType = null;
  var _prevButtonState = [];
  var _pollHandle = null;
  var _focusIndex = -1;
  var _focusElements = [];
  var _lastStickDir = null;       // 上次摇杆方向（防重复触发）
  var _windowFocused = true;      // 窗口是否处于焦点状态
  var _navCooldown = 0;           // 导航冷却时间戳（ms），防止过快连发

  // 导航冷却时间（ms）：一次导航后在此期间忽略新的摇杆/D-Pad 导航
  // 同时也作为持续推送时的重复间隔
  var NAV_COOLDOWN_MS = 200;
  // 左摇杆导航阈值（0~1）：必须推过此值才触发
  var STICK_NAV_THRESHOLD = 0.5;
  // 右摇杆滚动阈值
  var STICK_SCROLL_THRESHOLD = 0.15;
  // 右摇杆滚动速度系数（px/frame per unit，线性比例）
  var STICK_SCROLL_SPEED = 35;

  // ── 手柄类型检测 ──────────────────────────────────────────────

  function _detectType(id) {
    id = (id || '').toLowerCase();
    if (id.indexOf('dualsense') >= 0) return GamepadType.DUALSENSE;
    if (id.indexOf('dualshock') >= 0) return GamepadType.DUALSHOCK;
    if (id.indexOf('054c') >= 0) return GamepadType.DUALSHOCK;
    if (id.indexOf('xbox') >= 0 || id.indexOf('045e') >= 0) return GamepadType.XBOX;
    return GamepadType.GENERIC;
  }

  // ── 窗口焦点检测 ──────────────────────────────────────────────

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

  // ── 标题栏 / 全窗口视图提示 ────────────────────────────────────

  /**
   * 获取当前上下文对应的按钮提示列表。
   */
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
      // 全窗口视图：触摸板退出全窗口
      var hints = [
        { iconKey: 'cancel', labelKey: 'gamepad.back' },
        { iconKey: 'play', labelKey: 'gamepad.playPause' },
        { iconKey: 'like', labelKey: 'gamepad.like' },
        { iconKey: 'prev', labelKey: 'gamepad.prevTrack' },
        { iconKey: 'next', labelKey: 'gamepad.nextTrack' },
      ];
      // DualSense/DualShock 有触摸板
      if (_activeType === GamepadType.DUALSENSE || _activeType === GamepadType.DUALSHOCK) {
        hints.unshift({ iconKey: 'touchpad', labelKey: 'gamepad.touchpad' });
      }
      return hints;
    }
    return [
      { iconKey: 'confirm', labelKey: 'gamepad.confirm' },
      { iconKey: 'cancel', labelKey: 'gamepad.back' },
      { iconKey: 'play', labelKey: 'gamepad.playPause' },
      { iconKey: 'like', labelKey: 'gamepad.like' },
      { iconKey: 'prev', labelKey: 'gamepad.prevTrack' },
      { iconKey: 'next', labelKey: 'gamepad.nextTrack' },
    ];
  }

  /**
   * 渲染按钮提示到所有提示容器。
   */
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

    var icons = ICON_SETS[_activeType];
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

  // ── 手柄连接/断开 ──────────────────────────────────────────────

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

  // ── 轮询手柄状态 ───────────────────────────────────────────────

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
    // 窗口失焦时停止处理输入
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

    var map = BUTTON_MAP[_activeType];
    if (!map) return;

    // 按钮边沿检测
    var buttons = gp.buttons;
    for (var b = 0; b < buttons.length; b++) {
      var pressed = buttons[b] ? buttons[b].pressed : false;
      var wasPressed = _prevButtonState[b] || false;
      if (pressed && !wasPressed) {
        _onButtonDown(b, map);
      }
      _prevButtonState[b] = pressed;
    }

    // 左摇杆：全向焦点导航
    if (gp.axes && gp.axes.length >= 2) {
      _processLeftStick(gp.axes[0], gp.axes[1]);
    }
    // 右摇杆：翻页/滚动
    if (gp.axes && gp.axes.length >= 4) {
      _processRightStick(gp.axes[2], gp.axes[3]);
    }
  }

  // ── 按钮按下处理 ───────────────────────────────────────────────

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
    // 触摸板（仅 DualSense/DualShock）
    if (map.touchpad >= 0 && buttonIndex === map.touchpad) { _actionTouchpad(); return; }
    // D-Pad 全向导航（受冷却时间保护）
    if (Date.now() >= _navCooldown) {
      if (buttonIndex === BTN.DPAD_UP) { _spatialNavigate(0, -1); _navCooldown = Date.now() + NAV_COOLDOWN_MS; return; }
      if (buttonIndex === BTN.DPAD_DOWN) { _spatialNavigate(0, 1); _navCooldown = Date.now() + NAV_COOLDOWN_MS; return; }
      if (buttonIndex === BTN.DPAD_LEFT) { _spatialNavigate(-1, 0); _navCooldown = Date.now() + NAV_COOLDOWN_MS; return; }
      if (buttonIndex === BTN.DPAD_RIGHT) { _spatialNavigate(1, 0); _navCooldown = Date.now() + NAV_COOLDOWN_MS; return; }
    }
  }

  // ── 摇杆全向处理 ──────────────────────────────────────────────

  /**
   * 处理左摇杆输入，支持 8 方向（含斜向）。
   * - 方向变化时立即触发（受冷却时间保护）
   * - 同方向持续推送时，每 NAV_COOLDOWN_MS 重复触发一次
   *   （类似键盘按住时的重复行为）
   * - 摇杆回中后重置状态
   */
  function _processLeftStick(x, y) {
    var magnitude = Math.sqrt(x * x + y * y);

    if (magnitude < STICK_NAV_THRESHOLD) {
      _lastStickDir = null;
      return;
    }

    // 冷却期内不触发新导航
    if (Date.now() < _navCooldown) return;

    // 计算角度（0-360 度，从正右方逆时针）
    var angle = Math.atan2(-y, x) * 180 / Math.PI;
    if (angle < 0) angle += 360;

    // 将角度量化为 8 方向
    var dir;
    if (angle >= 337.5 || angle < 22.5) dir = 'right';
    else if (angle < 67.5) dir = 'up-right';
    else if (angle < 112.5) dir = 'up';
    else if (angle < 157.5) dir = 'up-left';
    else if (angle < 202.5) dir = 'left';
    else if (angle < 247.5) dir = 'down-left';
    else if (angle < 292.5) dir = 'down';
    else dir = 'down-right';

    // 同方向持续推送也允许重复触发（冷却到期后）
    // 方向变化时也允许触发
    // 只有同方向且冷却未到期才跳过
    _lastStickDir = dir;

    // 将方向转为 (dx, dy) 向量
    var dx = 0, dy = 0;
    if (dir.indexOf('right') >= 0) dx = 1;
    if (dir.indexOf('left') >= 0) dx = -1;
    if (dir.indexOf('up') >= 0) dy = -1;
    if (dir.indexOf('down') >= 0) dy = 1;

    _spatialNavigate(dx, dy);
    _navCooldown = Date.now() + NAV_COOLDOWN_MS;
  }

  /**
   * 处理右摇杆输入：用于翻页/滚动。
   * 持续按住摇杆时，每帧根据摇杆偏移量滚动内容区域。
   * Y轴上下滚动，X轴左右滚动（如适用）。
   */
  function _processRightStick(x, y) {
    if (Math.abs(y) < STICK_SCROLL_THRESHOLD && Math.abs(x) < STICK_SCROLL_THRESHOLD) return;

    // 找到当前可滚动容器
    var scrollTarget = _findScrollTarget();
    if (!scrollTarget) return;

    // Y轴滚动（上下翻页）：线性比例，推得越远滚得越快
    if (Math.abs(y) > STICK_SCROLL_THRESHOLD) {
      var scrollAmount = Math.round(y * STICK_SCROLL_SPEED);
      scrollTarget.scrollTop += scrollAmount;
    }
    // X轴滚动（左右）
    if (Math.abs(x) > STICK_SCROLL_THRESHOLD && scrollTarget.scrollWidth > scrollTarget.clientWidth) {
      var scrollAmountX = Math.round(x * STICK_SCROLL_SPEED);
      scrollTarget.scrollLeft += scrollAmountX;
    }
  }

  /**
   * 查找当前应该滚动的容器。
   * 优先级：全窗口视图歌词 > 内容区 > 当前焦点元素的最近可滚动祖先。
   */
  function _findScrollTarget() {
    // 全窗口视图时优先滚动歌词面板
    if (document.body.classList.contains('np-fullscreen')) {
      var lyricsPanel = document.querySelector('.np-panel--lyrics .np-lyrics-wrap');
      if (lyricsPanel) return lyricsPanel;
      var queuePanel = document.querySelector('.np-panel--queue .np-queue-list');
      if (queuePanel) return queuePanel;
    }
    // 内容区
    var contentPane = document.getElementById('content-pane');
    if (contentPane && contentPane.scrollHeight > contentPane.clientHeight) {
      return contentPane;
    }
    // 当前焦点元素的最近可滚动祖先
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

  // ── 空间焦点导航系统（全向） ──────────────────────────────────

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

  /**
   * 全向空间导航：在 (dx, dy) 方向上寻找最近的可聚焦元素。
   * dx, dy ∈ {-1, 0, 1}，支持斜向组合（如 dx=1, dy=-1 = 右上）。
   *
   * 算法：
   * 1. 获取当前焦点元素中心（或视口中心作为原点）
   * 2. 对每个候选元素，计算从原点到候选的方向向量
   * 3. 用点积衡量方向对齐度（>0.2 才考虑）
   * 4. 得分 = 对齐度 / (距离 + 1)，选最高分
   */
  function _spatialNavigate(dx, dy) {
    _focusElements = _getFocusableElements();
    if (_focusElements.length === 0) return;

    // 如果没有当前焦点，选第一个元素
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

    // 归一化方向向量
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

      // 点积：候选方向与导航方向的对齐度
      var dot = nvx * ndx + nvy * ndy;
      if (dot <= 0.05) continue; // 降低阈值，更宽松地匹配

      // 得分：对齐度优先，距离近的加分
      var score = dot * 100 - dist * 0.05;

      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }

    // 区域回退：如果空间导航没找到候选，且当前在侧边栏，
    // 尝试聚焦内容区的第一个元素
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

  // ── 动作实现 ──────────────────────────────────────────────────

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
    // 关闭上下文菜单
    var cmOverlay = document.querySelector('.context-menu-layer.open');
    if (cmOverlay && App.contextMenu && App.contextMenu.hide) {
      _sndCancel();
      App.contextMenu.hide();
      return;
    }
    // 关闭对话框
    var dialog = document.querySelector('.cmd-dialog-overlay[style*="flex"]');
    if (dialog) {
      var closeBtn = dialog.querySelector('.cmd-dialog-btn--cancel, .cmd-dialog-close');
      if (closeBtn) { _sndCancel(); closeBtn.click(); return; }
    }
    // 全窗口视图中：退出全窗口
    if (document.body.classList.contains('np-fullscreen')) {
      var fsBtn = document.getElementById('btn-fullscreen');
      if (fsBtn) { _sndCancel(); fsBtn.click(); return; }
    }
    // 退出全屏（影院模式）
    if (document.body.classList.contains('window-fullscreen')) {
      _sndCancel();
      if (window.__electronAPI) {
        window.__electronAPI.invoke('maximize_window');
      }
      return;
    }
    // 导航返回
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
    // 触摸板：切换全窗口视图
    var fsBtn = document.getElementById('btn-fullscreen');
    if (fsBtn) {
      fsBtn.click();
    }
  }

  // ── 导航变化时刷新 ────────────────────────────────────────────

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

  // ── 初始化 ────────────────────────────────────────────────────

  function init() {
    // 监听手柄连接/断开
    window.addEventListener('gamepadconnected', _onGamepadConnected);
    window.addEventListener('gamepaddisconnected', _onGamepadDisconnected);

    // 窗口焦点检测：失焦时停止接收手柄输入
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

    // 检查是否已有手柄连接
    var pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (var i = 0; i < pads.length; i++) {
      if (pads[i]) {
        _onGamepadConnected({ gamepad: pads[i] });
        break;
      }
    }

    // 劫持 App.navigate 以在导航后刷新焦点列表
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

    // 监听语言变化
    if (App.i18n && App.i18n.onChange) {
      App.i18n.onChange(function () {
        _renderHints();
      });
    }

    // 监听全窗口视图状态变化
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
  }

  // ── 导出 ──────────────────────────────────────────────────────
  App.gamepad = {
    init: init,
    getType: function () { return _activeType; },
    isConnected: function () { return !!_activeGamepad; },
    isFocused: function () { return _windowFocused; },
    refreshHints: _renderHints,
  };

  // DOM Ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
