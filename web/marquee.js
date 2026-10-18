(function (global) {
  'use strict';

  var SPEED = 60;
  var HOLD_HEAD = 1200;
  var MIN_SCROLL = 600;
  var MIN_OVERFLOW = 2;

  var reduce = false;
  try {
    reduce = !!(global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches);
  } catch (e) {  }

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
    if (cw <= 0) {
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
    if (sig === st.sig && st.anim) return;
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

  if (document.fonts && document.fonts.ready && document.fonts.ready.then) {
    document.fonts.ready.then(function () {
      global.Marquee.refreshAll();
    }).catch(function () {});
  }
})(window);
