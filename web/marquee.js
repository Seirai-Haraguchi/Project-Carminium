/**
 * Carminium — 过长标题跑马灯（Marquee）
 *
 * 自包含模块（无 bridge/utils 依赖），主窗 index.html 与浮动窗 floating.html 共用。
 *
 * 行为（AOSP TextView marquee 经典时序，一个循环）：
 *   ① 开头停顿 HOLD_HEAD(1200ms) → ② 向左滚到整段文字完全移出
 *   → ③ 瞬时移到右侧外缘、再匀速滚回起点 → ④ 到起点即下一轮 ①（先停顿再滚）
 * 滚动期间元素两侧用 mask 渐变透明（不硬切边缘）。
 *
 * 结构：绑定后元素内容被包进 <span class="mq-inner">，滚动只动内层 transform，
 *       外层容器保持 overflow:hidden；因此外部对容器做 opacity / transform 动画互不干扰。
 *
 * API：
 *   Marquee.bind(el)           绑定（把现有文本包进 .mq-inner）
 *   Marquee.setText(el, text)  绑定 + 设置文本（文本未变不会重启动画）
 *   Marquee.refresh(el)        重测单个元素（布局变化后）
 *   Marquee.refreshAll()       重测全部
 */
(function (global) {
  'use strict';

  var SPEED = 60;         // 滚动速度（px/s）：AOSP Marquee 约每帧 1px @60fps
  var HOLD_HEAD = 1200;   // 每轮开始前的停顿（ms）：AOSP 经典 1200ms，先让用户读到开头
  var MIN_SCROLL = 600;   // 单段（滚出 / 滚入）最短时长（ms）
  var MIN_OVERFLOW = 2;   // 溢出小于该值视为不溢出（px）

  var reduce = false;
  try {
    reduce = !!(global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches);
  } catch (e) { /* 老环境忽略 */ }

  var states = new Map();
  var mo = null;
  var ro = null;

  function padX(el) {
    var cs;
    try { cs = global.getComputedStyle(el); } catch (e) { return 0; }
    return (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
  }

  function stop(st) {
    if (st.anim) {
      try { st.anim.cancel(); } catch (e) {}
      st.anim = null;
    }
    if (st.inner) st.inner.style.transform = '';
  }

  // 确保包裹结构存在（外部直接改 textContent 会摧毁内层，这里可自愈）
  function ensure(st) {
    var el = st.el;
    if (st.inner && st.inner.parentNode === el && el.childNodes.length === 1) return st.inner;
    var text = el.textContent || '';
    var inner = document.createElement('span');
    inner.className = 'mq-inner';
    inner.textContent = text;
    el.textContent = '';
    el.appendChild(inner);
    el.classList.add('mq');
    st.inner = inner;
    st.text = text;
    st.sig = null;
    return inner;
  }

  // 兜底：外部若绕过 setText 直接写 textContent，重新包装并重测
  function watch(st) {
    if (!global.MutationObserver) return;
    if (!mo) {
      mo = new MutationObserver(function (records) {
        var seen = [];
        for (var i = 0; i < records.length; i++) {
          var t = records[i].target;
          var el = t && t.nodeType === 1 ? t : (t && t.parentNode);
          var s = el ? states.get(el) : null;
          if (!s || seen.indexOf(s) >= 0) continue;
          seen.push(s);
          if (s.inner && s.inner.parentNode === s.el && s.el.childNodes.length === 1) continue;
          ensure(s);
          measure(s);
        }
      });
    }
    mo.observe(st.el, { childList: true, characterData: true, subtree: true });
  }

  // 元素尺寸变化（含 display:none → 显示、全屏重排）时重测
  function track(st) {
    if (!global.ResizeObserver) return;
    if (!ro) {
      ro = new ResizeObserver(function (entries) {
        for (var i = 0; i < entries.length; i++) {
          var s = states.get(entries[i].target);
          if (!s) continue;
          if (s.rt) continue;
          s.rt = true;
          requestAnimationFrame(function (state) {
            return function () {
              state.rt = false;
              measure(state);
            };
          }(s));
        }
      });
    }
    ro.observe(st.el);
  }

  // AOSP 经典时序：停顿 → 整段滚出左侧（x: 0 → -textW）→ 瞬移到右缘外（x: +containerW）
  // → 匀速滚回起点（x: +containerW → 0）→ 到起点即回到停顿段，无缝进入下一轮。
  // 两段位移都是「文字完全不可见」的边界，所以跳变看不见。
  function start(st, textW, contW) {
    stop(st);
    var outMs = Math.max(MIN_SCROLL, Math.round(textW / SPEED * 1000));
    var inMs = Math.max(MIN_SCROLL, Math.round(contW / SPEED * 1000));
    var total = HOLD_HEAD + outMs + inMs;
    var p1 = HOLD_HEAD / total;
    var p2 = (HOLD_HEAD + outMs) / total;
    try {
      st.anim = st.inner.animate([
        { transform: 'translateX(0px)', offset: 0 },
        { transform: 'translateX(0px)', offset: p1 },
        { transform: 'translateX(' + (-textW) + 'px)', offset: p2 },
        { transform: 'translateX(' + contW + 'px)', offset: p2 },
        { transform: 'translateX(0px)', offset: 1 }
      ], {
        duration: total,
        iterations: Infinity,
        easing: 'linear'
      });
    } catch (e) {
      st.anim = null;
    }
  }

  function measure(st) {
    if (!st.inner) return;
    var el = st.el;

    if (reduce) {
      stop(st);
      el.classList.remove('mq-rolling');
      st.sig = null;
      return;
    }

    var cw = el.clientWidth - padX(el);
    if (cw <= 0) {           // 隐藏 / 未布局：等 ResizeObserver 唤醒
      stop(st);
      el.classList.remove('mq-rolling');
      st.sig = null;
      return;
    }

    var textW = st.inner.offsetWidth;
    var overflow = textW - cw;
    if (overflow <= MIN_OVERFLOW) {
      stop(st);
      el.classList.remove('mq-rolling');
      st.sig = 'none';
      return;
    }

    el.classList.add('mq-rolling');
    var sig = cw + ':' + textW + ':' + st.text;
    if (sig === st.sig && st.anim) return;  // 尺寸/文本没变，别打断正在进行的循环
    st.sig = sig;
    start(st, textW, cw);
  }

  function bind(el) {
    if (!el) return null;
    var st = states.get(el);
    if (!st) {
      st = { el: el, inner: null, anim: null, text: null, sig: null, rt: false };
      states.set(el, st);
      ensure(st);
      watch(st);
      track(st);
    } else {
      ensure(st);
    }
    return st;
  }

  function setText(el, text) {
    if (!el) return;
    var st = states.get(el) || bind(el);
    var val = text == null ? '' : String(text);
    if (st.text !== val) {
      ensure(st);
      st.text = val;
      st.inner.textContent = val;
      st.sig = null;
    }
    measure(st);
  }

  global.Marquee = {
    bind: bind,
    setText: setText,
    refresh: function (el) {
      var st = states.get(el);
      if (!st) return;
      ensure(st);
      measure(st);
    },
    refreshAll: function () { states.forEach(measure); }
  };

  // 字体到位后重新测量（自托管字体的度量与回退字体不同）
  if (document.fonts && document.fonts.ready && document.fonts.ready.then) {
    document.fonts.ready.then(function () {
      global.Marquee.refreshAll();
    }).catch(function () {});
  }
})(window);
