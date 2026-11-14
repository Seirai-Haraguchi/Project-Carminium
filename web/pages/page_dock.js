(function () {
  'use strict';

  window.App = window.App || {};

  /* ═══════════════════════════════════════════════════════════════════
     底部悬浮搜索框（page dock）
     ──────────────────────────────────────────────────────────────────
     凡是带搜索框的内容页（所有音乐 / 专辑 / 艺术家 / 媒体库 / 历史 /
     喜爱 / 搜索 / 探新 / 歌单详情），标题区一起滚出内容区顶边之后，
     搜索框（连同它上面的筛选指示）改挂到内容区底部浮动；滚回去就原位还回。

     做法：
       · 标题区**不再吸顶**（`.page-top` 只是普通块），所以它会真的滚出去；
       · 到阈值时把 `.search-bar` 与其兄弟筛选指示（`.music-filter-chips` /
         `.search-scope` / `.np-pivot`）搬进 `.page-dock`，并各自留一个等高的
         “洞”占位 —— 元素离流不能让下面的内容往上跳一截；
       · dock 本身不是卡片，是内容区下缘一层自下而上的渐隐（内容沉进去的
         那种内阴影），见 style.css 末尾；
       · 返回时按洞插回原位、删洞，配一小段上浮/下落的淡变。

     🔴 dock 是 `position: sticky; bottom: 0` 挂在 `#page-container` 末尾的
     普通流内元素，宽/左右/圆角全部由布局自己给。**别用 fixed + JS 算
     left/width/bottom**：那样要靠 getBoundingClientRect 换算视口坐标，播放
     面板收放、窗口缩放时对不上，整条会飘到播放面板上（真机踩过）。
     ═══════════════════════════════════════════════════════════════════ */

  var BAR_SEL = '.search-bar';
  /* 页首那块“标题区”：列表页统一 .page-header；探新/歌单详情各自一套。 */
  var TITLE_SEL = '.page-header, .ym-mix-detail-header, .detail-header';
  /* 搜索框的“筛选指示”：原位都排在搜索框上面（间距由各自 padding 决定）。
     🔴 `.np-pivot`（歌曲/专辑/艺术家 那排视图切换标签）**不在其中** —— 那是
     页面级导航，不跟着沉底（用户："标签页不该跟着沉底"）。 */
  var CHIP_SEL = '.music-filter-chips, .search-scope';

  var OUT_GAP = 4;     /* 标题底边越过内容区顶边这么多 → 判定已滚出 */
  var BACK_GAP = 10;   /* 回滞：回到这个距离才还原，免得贴着阈值来回闪 */
  /* 进/退场：只做小幅位移 + 淡变，慢慢来。别做长距离飞行 —— 跨半屏冲下来
     会显得很生硬（限宽 720 与左右留白都在样式表里，这里不管）。 */
  var IN_MS = 420;
  var OUT_MS = 300;
  var IN_SHIFT = 18;   /* 进场从下方 18px 浮上来 */
  var OUT_SHIFT = 10;  /* 退场往上飘 10px 再消失 */
  var EASE_IN = 'cubic-bezier(0.22, 0.68, 0.24, 1)';
  var EASE_OUT = 'cubic-bezier(0.4, 0, 0.5, 1)';

  var dock = null;
  var state = null;
  var docked = false;
  var frame = 0;
  var scanFrame = 0;
  var motionQuery = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;

  function _motionOff() {
    return !!(motionQuery && motionQuery.matches);
  }


  /* dock 必须是 #page-container 的最后一个子节点：sticky 要有父盒高度才能
     “贴住下缘”。页面重绘会把整棵子树换掉，所以每次 _scan 都要重新认。 */
  function _ensureDock() {
    var page = document.getElementById('page-container');
    if (!page) return null;
    if (dock && dock.parentNode === page && page.lastChild === dock) return dock;
    if (!dock) {
      dock = document.createElement('div');
      dock.className = 'page-dock';
    }
    page.appendChild(dock);
    return dock;
  }

  /* 把元素挪进新父节点时保住焦点与光标位置 —— appendChild 会先移除，
     Chrome 随即 blur，正在打字的输入框会静默失焦。 */
  function _move(el, parent) {
    var active = document.activeElement;
    var had = !!active && (active === el || el.contains(active));
    var selStart = had && typeof active.selectionStart === 'number' ? active.selectionStart : null;
    var selEnd = had && typeof active.selectionEnd === 'number' ? active.selectionEnd : null;

    parent.appendChild(el);

    if (had) {
      try { active.focus({ preventScroll: true }); } catch (e) { }
      if (selStart !== null) {
        try { active.setSelectionRange(selStart, selEnd); } catch (e) { }
      }
    }
  }

  /* 留洞：元素离流后占位，保证下方内容不跳。高度取 margin box。 */
  function _stash(el) {
    var cs = window.getComputedStyle(el);
    var h = el.offsetHeight + (parseFloat(cs.marginTop) || 0) + (parseFloat(cs.marginBottom) || 0);
    var hole = document.createElement('div');
    hole.className = 'page-dock-hole';
    hole.style.height = h + 'px';
    el.parentNode.insertBefore(hole, el);
    state.holes.push({ el: el, hole: hole });
    return hole;
  }

  function _chipsOf(bar) {
    var out = [];
    var parent = bar.parentNode;
    if (!parent || !parent.children) return out;
    for (var i = 0; i < parent.children.length; i++) {
      var el = parent.children[i];
      if (el !== bar && el.matches && el.matches(CHIP_SEL)) out.push(el);
    }
    return out;
  }

  function _dock() {
    if (docked || !state) return;
    var s = state;
    docked = true;

    var d = _ensureDock();
    if (!d) { docked = false; return; }
    s.holes = [];
    /* 🔴 只搬筛选指示 + 搜索框，**标题区不动**：整块页首沉底被用户否掉
       （"不是整个页首沉底"），底部就留这一条，别看页面头空着就想补标题。 */
    s.chips.forEach(function (chip) {
      _stash(chip);
      _move(chip, d);
    });
    _stash(s.bar);
    _move(s.bar, d);

    d.classList.add('is-docked');
    _flyIn();
  }

  /* 进场：从下往上轻轻浮上来 + 淡入。只走 translate，不做 scale ——
     原位/悬浮态宽度本就不同，硬缩会把字拉变形。 */
  function _flyIn() {
    if (!dock || _motionOff() || typeof dock.animate !== 'function') return;
    if (dock.getAnimations) dock.getAnimations().forEach(function (a) { a.cancel(); });
    dock.animate([
      { transform: 'translateY(' + IN_SHIFT + 'px)', opacity: 0 },
      { transform: 'translateY(0)', opacity: 1 }
    ], { duration: IN_MS, easing: EASE_IN, fill: 'none' });
  }

  /* 退场：先把当前形态整份克隆下来当"影子"，真节点立刻回原位（不留空档），
     影子在原地轻轻往上飘一点再淡掉 —— 不飞长距离，免得生硬。 */
  function _makeGhost() {
    if (!dock || !state) return null;
    var pane = state.pane;
    var dr = dock.getBoundingClientRect();
    var pr = pane.getBoundingClientRect();
    var g = dock.cloneNode(true);
    var live = dock.querySelectorAll('input');
    var copy = g.querySelectorAll('input');
    for (var i = 0; i < copy.length && i < live.length; i++) copy[i].value = live[i].value;

    g.classList.remove('is-docked', 'is-hidden');
    g.classList.add('page-dock-ghost');
    /* 钉在内容区自身坐标系里（跟着滚动走），不用视口坐标 */
    g.style.top = (dr.top - pr.top + pane.scrollTop) + 'px';
    pane.appendChild(g);
    return g;
  }

  function _flyOut(ghost) {
    if (!ghost || typeof ghost.animate !== 'function') return;
    var anim = ghost.animate([
      { transform: 'translateY(0)', opacity: 1 },
      { transform: 'translateY(-' + OUT_SHIFT + 'px)', opacity: 0 }
    ], { duration: OUT_MS, easing: EASE_OUT, fill: 'forwards' });
    function kill() { if (ghost.parentNode) ghost.parentNode.removeChild(ghost); }
    anim.onfinish = kill;
    anim.oncancel = kill;
    setTimeout(kill, 700); /* 动画被打断时的兜底，别把影子留在页面上 */
  }

  function _undock(silent) {
    if (!docked) return;
    docked = false;

    /* 影子必须在撤掉 is-docked（display: none）之前拍下来 */
    var ghost = (!silent && state && !_motionOff()) ? _makeGhost() : null;
    if (dock) {
      if (dock.getAnimations) dock.getAnimations().forEach(function (a) { a.cancel(); });
      dock.classList.remove('is-docked');
    }
    if (!state) return;

    state.holes.forEach(function (item) {
      var hole = item.hole;
      if (!hole || !hole.parentNode) return;
      hole.parentNode.insertBefore(item.el, hole);
      hole.parentNode.removeChild(hole);
    });
    state.holes = [];

    if (ghost) _flyOut(ghost);
  }

  function _teardown() {
    _undock(true); /* 页面要换掉了，别给旧节点放退场动画 */
    if (dock) {
      /* 剩下的都是页面重绘后被带离文档的孤儿（洞已经没了），直接扔掉 */
      while (dock.firstChild) dock.removeChild(dock.firstChild);
    }
    state = null;
  }

  function _evaluate() {
    frame = 0;
    if (!state || !state.bar.isConnected) return; /* 页面已重绘，等 _scan 重新认 */
    var pr = state.pane.getBoundingClientRect();
    if (pr.width < 80 || pr.height < 80) return; /* 全窗口视图/切页把内容区藏了 */

    var bottom = state.title.getBoundingClientRect().bottom;
    if (window.__dockDbg) window.__dockDbg.push('ev d=' + docked + ' b=' + Math.round(bottom) + '/' + Math.round(pr.top));
    if (!docked && bottom <= pr.top - OUT_GAP) _dock();
    else if (docked && bottom >= pr.top + BACK_GAP) _undock();
  }

  /* rAF 驱动之外挂一个 50ms 兜底：无头截图/窗口被遮挡时 BeginFrame 会停，
     只靠 rAF 的话还原判定可能永远不跑（真机上是滚动必出帧，无所谓，但
     兜底让两边的时序都可靠）。谁先跑都行，frame 归零后另一方直接跳过。 */
  function _schedule() {
    if (frame) return;
    frame = requestAnimationFrame(function () { frame = 0; _evaluate(); });
    setTimeout(function () {
      if (!frame) return;
      cancelAnimationFrame(frame);
      frame = 0;
      _evaluate();
    }, 50);
  }

  function _scan() {
    scanFrame = 0;
    var pane = document.getElementById('content-pane');
    var page = document.getElementById('page-container');
    if (!pane || !page) return _teardown();

    var bar = page.querySelector(BAR_SEL);
    var title = page.querySelector(TITLE_SEL);
    if (!bar || !title) return _teardown();
    if (state && state.bar === bar && state.title === title) return;

    _teardown();
    state = { pane: pane, page: page, bar: bar, title: title, chips: _chipsOf(bar), holes: [] };
    _evaluate();
  }

  function _scheduleScan() {
    if (scanFrame) return;
    scanFrame = requestAnimationFrame(_scan);
  }

  function init() {
    var pane = document.getElementById('content-pane');
    if (!pane) return;

    pane.addEventListener('scroll', _schedule, { passive: true });
    window.addEventListener('resize', _schedule);

    /* 每次翻页/换语言都会重绘 #page-container（连同 dock 一起被换掉），
       重绘完要重新认一遍页面结构并把 dock 挂回去 */
    var page = document.getElementById('page-container');
    if (page && typeof MutationObserver !== 'undefined') {
      new MutationObserver(_scheduleScan).observe(page, { childList: true });
    }

    _scan();
  }

  App.pageDock = { refresh: _scheduleScan };

  init();

})();
