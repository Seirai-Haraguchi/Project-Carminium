(function () {
  'use strict';

  var api = window.__electronAPI;
  var handlers = {};
  function on(name, fn) { (handlers[name] || (handlers[name] = [])).push(fn); }
  function dispatch(name, payload) {
    var list = handlers[name] || [];
    for (var i = 0; i < list.length; i++) {
      try { list[i](payload); } catch (e) { console.error('[mini]', name, e); }
    }
  }
  function invoke(name) {
    if (!api || typeof api.invoke !== 'function') return Promise.resolve(undefined);
    return api.invoke.apply(api, arguments);
  }
  function parse(json, fallback) {
    if (json && typeof json === 'object') return json;
    try { return JSON.parse(json) || fallback; } catch (e) { return fallback; }
  }

  var $ = function (id) { return document.getElementById(id); };
  var els = {
    root: document.querySelector('.floating-root'),
    cover: $('np-cover'),
    coverImg: $('np-cover-img'), coverIcon: $('np-cover-icon'),
    tint: $('mini-tint'),
    title: $('np-title'), artist: $('np-artist'),
    play: $('btn-play-pause'), playIcon: $('play-icon'),
    bar: $('np-progress-bar'), fill: $('np-progress-fill'), track: document.querySelector('.mini-progress-track'), thumb: $('np-progress-thumb'),
    cur: $('np-time-cur'), dur: $('np-time-dur')
  };
  var coverBase = '';
  var track = null;
  var duration = 0;
  var position = 0;
  var state = 'stopped';
  var seeking = false;
  var pendingPos = -1;
  var posRaf = 0;
  var lastCurSec = -1;
  var lastDurSec = -1;

  function fmtTime(ms) {
    var sec = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
    return Math.floor(sec / 60) + ':' + ('0' + sec % 60).slice(-2);
  }
  function setTitle(text) {
    if (window.Marquee) window.Marquee.setText(els.title, text || '');
    else els.title.textContent = text || '';
  }
  function setBar(pct) {
    pct = Math.max(0, Math.min(100, pct || 0));
    els.bar.style.setProperty('--progress-val', pct + '%');
    els.fill.style.width = pct + '%';
    els.thumb.style.left = pct + '%';
    els.bar.setAttribute('aria-valuenow', String(Math.round(pct)));
    els.bar.setAttribute('aria-valuetext', fmtTime(position) + ' / ' + fmtTime(duration));
  }
  function updatePosition(ms) {
    position = Math.max(0, Number(ms) || 0);
    var curSec = Math.floor(position / 1000);
    if (curSec !== lastCurSec) {
      lastCurSec = curSec;
      els.cur.textContent = fmtTime(position);
    }
    var remaining = Math.max(0, duration - position);
    var durSec = Math.floor(remaining / 1000);
    if (durSec !== lastDurSec) {
      lastDurSec = durSec;
      els.dur.textContent = '-' + fmtTime(remaining);
    }
    setBar(duration ? position / duration * 100 : 0);
  }
  function updateDuration(ms) {
    duration = Math.max(0, Number(ms) || 0);
    lastDurSec = -1;
    updatePosition(position);
  }
  var FLY_OUT_EASE = 'cubic-bezier(0.3, 0, 0.8, 0.15)';
  var FLY_IN_EASE = 'cubic-bezier(0.3, 1.25, 0.44, 1)';
  var flyGen = 0;
  function flyItems() {
    return [
      { el: els.cover, delay: 0 },
      { el: els.title, delay: 60 },
      { el: els.artist, delay: 100 }
    ].filter(function (it) { return !!it.el; });
  }
  function setTintFromImage(img) {
    var utils = window.opener && window.opener.App && window.opener.App.utils;
    var rgb = null;
    try { rgb = utils && typeof utils.extractDominantColor === 'function' ? utils.extractDominantColor(img) : null; }
    catch (e) { rgb = null; }
    els.tint.style.background = Array.isArray(rgb)
      ? 'rgba(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ',0.18)'
      : 'transparent';
  }
  function applyTrack(next) {
    track = next || null;
    var lastTrackId = track ? track.id : null;
    duration = track ? Number(track.duration_ms) || 0 : 0;
    position = 0;
    lastCurSec = lastDurSec = -1;
    setTitle(track ? (track.title || App.i18n.t('common.unknownTrack')) : App.i18n.t('common.notPlaying'));
    els.artist.textContent = track ? (track.artist || App.i18n.t('common.unknownArtist')) : '—';
    els.coverImg.hidden = true;
    els.coverImg.removeAttribute('src');
    els.coverIcon.hidden = false;
    els.tint.style.background = 'transparent';
    if (track && track.has_cover) {
      els.coverImg.onload = function () { els.coverImg.hidden = false; els.coverIcon.hidden = true; setTintFromImage(els.coverImg); };
      els.coverImg.onerror = function () { els.coverImg.hidden = true; els.coverIcon.hidden = false; els.tint.style.background = 'transparent'; };
      els.coverImg.crossOrigin = 'anonymous';
      els.coverImg.src = coverBase + '/cover/' + encodeURIComponent(track.id) + '?size=1024';
    }
    syncMainStyle();
    updatePosition(0);
    return lastTrackId;
  }
  function playTrackFly(next) {
    var myGen = ++flyGen;
    var items = flyItems();
    var outAnims = items.map(function (it) {
      return it.el.animate([
        { transform: 'translateY(0)', opacity: 1 },
        { transform: 'translateY(-32%)', opacity: 0 }
      ], { duration: 170, delay: Math.round(it.delay * 0.4), easing: FLY_OUT_EASE, fill: 'forwards' });
    });
    Promise.all(outAnims.map(function (a) { return a.finished.catch(function () {}); })).then(function () {
      if (myGen !== flyGen) return;
      applyTrack(next);
      items.forEach(function (it) {
        it.el.getAnimations().forEach(function (a) { a.cancel(); });
        it.el.animate([
          { transform: 'translateY(46%)', opacity: 0 },
          { transform: 'translateY(0)', opacity: 1 }
        ], { duration: 430, delay: it.delay, easing: FLY_IN_EASE, fill: 'backwards' });
      });
    });
  }
  function updateTrack(next) {
    var isNewTrack = !!next && track && next.id != null && next.id !== track.id;
    var reduced = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    if (isNewTrack && !reduced) playTrackFly(next);
    else applyTrack(next);
  }
  function updateState(next) {
    state = next || 'stopped';
    var playing = state === 'playing';
    els.playIcon.textContent = playing ? 'pause' : 'play_arrow';
    els.play.classList.toggle('playing', playing);
    els.fill.classList.toggle('playing', playing);
  }

  var SYNC_TOKENS = [
    '--md-primary', '--md-on-primary', '--md-sys-state-hover-state-layer-opacity',
    '--md-sys-shape-corner-large', '--md-sys-shape-corner-extra-large',
    '--pressed-morph-shape', '--motion-effects-fast', '--motion-spatial-fast',
    '--ui-font'
  ];
  function fitScale() {
    if (!els.root) return;
    var s = Math.min(window.innerWidth / 540, window.innerHeight / 246);
    els.root.style.transform = 'scale(' + s.toFixed(4) + ')';
  }

  function syncMainStyle() {
    var op = window.opener;
    var r = op && op.document ? op.document.documentElement : null;
    if (!r) return;
    var cs = op.getComputedStyle(r);
    var root = document.documentElement;
    for (var i = 0; i < SYNC_TOKENS.length; i++) {
      var v = cs.getPropertyValue(SYNC_TOKENS[i]).trim();
      if (v) root.style.setProperty(SYNC_TOKENS[i], v);
      else root.style.removeProperty(SYNC_TOKENS[i]);
    }
    // 日语 UI 字体 @font-face 与开关（含假名字段自动落到日文字体）
    var jpOn = r.classList.contains('jp-ui-font');
    root.classList.toggle('jp-ui-font', jpOn);
    var srcEl = op.document.getElementById('jp-ui-font-face');
    var mine = document.getElementById('jp-ui-font-face');
    if (srcEl) {
      if (!mine) {
        mine = document.createElement('style');
        mine.id = 'jp-ui-font-face';
        document.head.appendChild(mine);
      }
      mine.textContent = srcEl.textContent;
    } else if (mine) {
      mine.textContent = '';
    }
  }

  function applySettings(settings) {
    var lang = settings.language || 'zh-CN';
    if (App.i18n.getLang() !== lang) App.i18n.init(lang);
    App.i18n.applyToDOM();
    syncMainStyle();
    if (track) setTitle(track.title || App.i18n.t('common.unknownTrack'));
    else setTitle(App.i18n.t('common.notPlaying'));
  }

  function seekRatio(event) {
    var rect = els.bar.getBoundingClientRect();
    return Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
  }
  function previewSeek(event) {
    if (!duration) return;
    var ms = seekRatio(event) * duration;
    position = ms;
    lastCurSec = lastDurSec = -1;
    updatePosition(ms);
  }
  function bindUI() {
    els.play.addEventListener('click', function () { invoke(state === 'playing' ? 'pause' : 'play'); });
    $('btn-prev').addEventListener('click', function () { invoke('prev_track'); });
    $('btn-next').addEventListener('click', function () { invoke('next_track'); });
    $('btn-close').addEventListener('click', function () { invoke('close_floating_window'); });

    els.bar.addEventListener('pointerdown', function (event) {
      if (!duration || event.button !== 0) return;
      event.preventDefault();
      seeking = true;
      els.bar.setPointerCapture(event.pointerId);
      previewSeek(event);
    });
    els.bar.addEventListener('pointermove', function (event) { if (seeking) previewSeek(event); });
    els.bar.addEventListener('pointerup', function (event) {
      if (!seeking) return;
      previewSeek(event);
      seeking = false;
      if (els.bar.hasPointerCapture(event.pointerId)) els.bar.releasePointerCapture(event.pointerId);
      invoke('seek', Math.floor(position));
    });
    els.bar.addEventListener('pointercancel', function () { seeking = false; updatePosition(position); });
    els.bar.addEventListener('keydown', function (event) {
      if (!duration) return;
      var next = position;
      if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') next -= 5000;
      else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') next += 5000;
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = duration;
      else return;
      event.preventDefault();
      position = Math.max(0, Math.min(duration, next));
      updatePosition(position);
      invoke('seek', Math.floor(position));
    });
  }
  function flushPosition() {
    posRaf = 0;
    if (!seeking && pendingPos >= 0) updatePosition(pendingPos);
  }
  function wireEvents() {
    on('track_changed', function (json) { updateTrack(parse(json, null)); });
    on('playback_state_changed', updateState);
    on('position_changed', function (ms) {
      pendingPos = Number(ms) || 0;
      if (!posRaf) posRaf = requestAnimationFrame(flushPosition);
    });
    on('duration_changed', updateDuration);
    on('settings_changed', function (json) { applySettings(parse(json, {})); });
  }

  function boot() {
    if (!api) { console.error('[mini] __electronAPI 不可用'); return; }
    api.onBridgeEvent(dispatch);
    wireEvents();
    bindUI();
    if (window.Marquee) window.Marquee.bind(els.title);
    syncMainStyle();
    fitScale();
    window.addEventListener('resize', fitScale);
    if (window.MutationObserver && window.opener && window.opener.document) {
      var watch = new MutationObserver(syncMainStyle);
      watch.observe(window.opener.document.documentElement, { attributes: true, childList: true, subtree: true });
      window.addEventListener('unload', function () { watch.disconnect(); });
    }
    invoke('get_cover_base_url').then(function (url) {
      coverBase = url || '';
      return invoke('get_settings');
    }).then(function (json) {
      applySettings(parse(json, {}));
      return invoke('get_player_state');
    }).then(function (json) {
      var player = parse(json, {});
      updateTrack(player.current_track || null);
      if (player.duration) updateDuration(player.duration);
      if (player.position) updatePosition(player.position);
      updateState(player.state || 'stopped');
    }).catch(function (e) { console.error('[mini] 初始化失败', e); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
