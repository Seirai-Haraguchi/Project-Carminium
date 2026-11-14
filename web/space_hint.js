(function () {
  'use strict';

  window.App = window.App || {};

  /* ═══════════════════════════════════════════════════════════════════
     窗口空间提示（space hint）
     ──────────────────────────────────────────────────────────────────
     窗口被拖到「内容已经挤了，但还没撞上锁定尺寸」的区间时，
     整个窗口压一层蒙版，再在窗口对应边浮出一张提示卡，箭头指向需要
     扩展的方向：
       宽不足 → 窗口右缘中段，箭头向右
       高不足 → 窗口下缘中点，箭头向下
     锁定尺寸（960×520）以下由 Electron 直接拦住，本模块只管这段
     "能缩但难受" 的区间。提示不拦截任何交互（pointer-events: none）。

     阈值按**当前视图**取，不是一个全局数——窗口宽度够不够，取决于此刻
     屏幕上是哪套布局（这个数不该拿窗口尺寸硬套）：
       · 列表页：左侧 96 导航栏 + 右侧 340 播放面板，内容区只剩 620 就挤了
       · 设置页：播放面板收起、自带 248 抽屉
       · 全窗口视图：grid-template-columns 自己写了最小列宽（见 style.css
         .now-playing-pane.fullscreen 的 minmax），duo = 280 + 360 + gap/内边距，
         solo / lyrics 单列只要 280 / 360，比列表页宽松得多
     ═══════════════════════════════════════════════════════════════════ */

  var LIMITS = {
    /* 导航 96 + 播放面板 340 + 内容区 620 + 边距 */
    page:     { width: 1080, height: 660 },
    /* 设置抽屉 248 + 内容区 760 + 边距 */
    settings: { width: 1020, height: 600 },
    /* .fullscreen 双栏 minmax(280) + minmax(360) + gap 12 + padding 24 ≈ 676，
       留点余量 */
    npDuo:    { width: 740, height: 560 },
    /* .np-content-solo：中间一列 minmax(280, 360)，两侧 1fr */
    npSolo:   { width: 620, height: 560 },
    /* .np-content-lyrics：中间一列 minmax(360, 480) */
    npLyrics: { width: 620, height: 540 },
  };

  /* 回滞：已经亮出来的提示必须等窗口真正越过阈值这么多像素才收，
     否则贴着阈值左右拖时会一直闪。 */
  var HYSTERESIS = 16;

  var AXES = ['x', 'y'];
  var AXIS_DESC_KEY = { x: 'spaceHint.width', y: 'spaceHint.height' };

  var ARROW_SVG =
    '<svg viewBox="0 0 24 24" width="34" height="34" fill="none" ' +
    'stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M3.5 12h13.5" />' +
    '<path d="M11.5 6l6 6-6 6" />' +
    '</svg>';

  var layer = null;
  var anchors = {};
  var activeAxis = null;
  var frame = 0;
  var overrideLimits = null;

  function viewLimits() {
    if (overrideLimits) return overrideLimits;

    var body = document.body.classList;
    if (body.contains('settings-active')) return LIMITS.settings;

    /* 全窗口/影院视图：判据直接看播放面板是不是 fullscreen（两种模式都会加这个类） */
    var pane = document.getElementById('now-playing-pane');
    if (pane && pane.classList.contains('fullscreen')) {
      if (pane.classList.contains('np-content-solo')) return LIMITS.npSolo;
      if (pane.classList.contains('np-content-lyrics')) return LIMITS.npLyrics;
      return LIMITS.npDuo;
    }

    return LIMITS.page;
  }

  function build() {
    if (layer) return;

    layer = document.createElement('div');
    layer.className = 'space-hint-layer';
    layer.setAttribute('aria-live', 'polite');

    /* 先压一层蒙版（整个窗口），提示卡浮在它上面 */
    var scrim = document.createElement('div');
    scrim.className = 'space-hint-scrim';
    layer.appendChild(scrim);

    AXES.forEach(function (axis) {
      var anchor = document.createElement('div');
      anchor.className = 'space-hint-anchor';
      anchor.setAttribute('data-axis', axis);

      var card = document.createElement('div');
      card.className = 'space-hint';
      card.innerHTML =
        '<p class="space-hint-head">' +
          '<span class="space-hint-title" data-i18n="spaceHint.title"></span>' +
          '<span class="space-hint-arrow" aria-hidden="true">' + ARROW_SVG + '</span>' +
        '</p>' +
        '<p class="space-hint-desc" data-i18n="' + AXIS_DESC_KEY[axis] + '"></p>';

      anchor.appendChild(card);
      layer.appendChild(anchor);
      anchors[axis] = anchor;
    });

    document.body.appendChild(layer);
    if (App.i18n && App.i18n.applyToDOM) App.i18n.applyToDOM(layer);
  }

  function setAxis(axis) {
    if (axis === activeAxis) return;
    activeAxis = axis;
    layer.classList.toggle('is-active', !!axis);
    AXES.forEach(function (a) {
      anchors[a].classList.toggle('is-visible', a === axis);
    });
  }

  function hiddenContext() {
    /* 只躲引导层——它自己就是一层全屏遮罩，盖上去只会两层面糊在一起。
       全窗口/全屏播放视图不再躲：判断的是窗口，跟当前页面无关，玩家面板和
       播放页一样会被压暗，卡就压在整个窗口的边上。 */
    return document.body.classList.contains('onboarding-active');
  }

  function apply() {
    build();

    if (hiddenContext()) {
      setAxis(null);
      return;
    }

    var limits = viewLimits();
    var width = window.innerWidth;
    var height = window.innerHeight;
    var shortX = width < limits.width;
    var shortY = height < limits.height;

    if (activeAxis === 'x' && width < limits.width + HYSTERESIS) shortX = true;
    if (activeAxis === 'y' && height < limits.height + HYSTERESIS) shortY = true;

    var axis = null;
    if (shortX && shortY) {
      /* 两个方向都挤：先指出缺口相对更大的那个，一次只摆一张卡 */
      var dx = (limits.width - width) / limits.width;
      var dy = (limits.height - height) / limits.height;
      axis = dx >= dy ? 'x' : 'y';
    } else if (shortX) {
      axis = 'x';
    } else if (shortY) {
      axis = 'y';
    }

    setAxis(axis);
  }

  function schedule() {
    if (frame) return;
    frame = requestAnimationFrame(function () {
      frame = 0;
      apply();
    });
  }

  function init() {
    build();

    window.addEventListener('resize', schedule);

    /* 进设置页 / 切全窗口视图 / 切 solo·duo·lyrics 都只改 class，尺寸不变，
       所以除了 resize 还要盯 body 和播放面板的 class */
    var mo = new MutationObserver(schedule);
    mo.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    var pane = document.getElementById('now-playing-pane');
    if (pane) mo.observe(pane, { attributes: true, attributeFilter: ['class'] });

    apply();
  }

  App.spaceHint = {
    refresh: schedule,
    limits: function () {
      return viewLimits();
    },
    /* 传 null 回到按当前视图取默认值 */
    setLimits: function (limits) {
      overrideLimits = limits && limits.width && limits.height ? limits : null;
      schedule();
    },
  };

  init();

})();
