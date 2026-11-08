(function () {
  'use strict';

  var api = window.__electronAPI;

  var wrapper = document.getElementById('tl-wrapper');
  var container = document.getElementById('tl-container');
  var coverWrap = document.getElementById('tl-cover-wrap');
  var coverImg = document.getElementById('tl-cover');
  var coverFallback = document.getElementById('tl-cover-fallback');
  var lyricColumn = document.getElementById('tl-lyric-column');
  var songTitle = document.getElementById('tl-song-title');
  var songArtist = document.getElementById('tl-song-artist');

  var layout = { anchor: 'left', maxWidth: 400, height: 48, isLight: false };
  var config = {
    colorMode: 'taskbar',
    showBackground: false,
    doubleLine: true,
    showCover: true,
    wordByWord: true,
    fontSize: 14,
    fontWeight: 400,
    fontFamily: '',
  };
  var track = null;
  var items = [];
  var lastItemsSignature = '';

  var clock = { position: 0, at: performance.now(), playing: false };

  var hovered = false;
  var hoverLeaveTimer = null;
  var collapseTimer = null;
  var CONTROLS_COLLAPSE_MS = 450;

  var widthRaf = 0;
  var lastReportedWidth = 0;
  var lastLayoutSig = '';
  var LYRIC_WIDTH_GUARD = 8;
  var fittedFontSize = 14;

  var rafId = 0;
  var currentMsCache = 0;

  // 字体异步加载后文本宽度会变，只靠渲染时机测一次会把长行误判为不溢出。
  var resizeObserver = typeof ResizeObserver === 'function'
    ? new ResizeObserver(function () {
      updateOverflow();
      scheduleContentWidthReport();
    })
    : null;

  function observeLine(line) {
    if (!resizeObserver) return;
    var scroll = line.firstChild;
    if (!scroll) return;
    resizeObserver.observe(scroll);
    if (scroll.firstChild) resizeObserver.observe(scroll.firstChild);
  }

  function unobserveLine(line) {
    if (!resizeObserver) return;
    var scroll = line.firstChild;
    if (!scroll) return;
    resizeObserver.unobserve(scroll);
    if (scroll.firstChild) resizeObserver.unobserve(scroll.firstChild);
  }

  function nowMs() {
    return clock.position + (clock.playing ? performance.now() - clock.at : 0);
  }

  function effectiveTheme() {
    var mode = config.colorMode;
    if (mode === 'light') return 'light';
    if (mode === 'dark') return 'dark';
    if (mode === 'taskbarInverse') return layout.isLight ? 'dark' : 'light';
    return layout.isLight ? 'light' : 'dark';
  }

  function applyLayout() {
    wrapper.style.height = layout.height + 'px';
    container.dataset.align = layout.anchor;
    container.dataset.theme = effectiveTheme();
    container.classList.toggle('shows-background', !!config.showBackground);

    var lineUnits = config.doubleLine ? 1.82 : 1;
    var requested = config.fontSize * 1.4 * lineUnits;
    var inset = Math.min(4, Math.max(1, (layout.height - requested) / 2));
    var fontSize = Math.min(config.fontSize, (layout.height - inset * 2) / (1.4 * lineUnits));
    fittedFontSize = fontSize;

    container.style.setProperty('--tbl-vertical-inset', inset.toFixed(2) + 'px');
    container.style.setProperty('--tbl-font-size', fontSize.toFixed(2) + 'px');
    container.style.lineHeight = '1.4';
    container.style.fontWeight = String(config.fontWeight);
    container.style.fontFamily = config.fontFamily || '';
    songArtist.hidden = !config.doubleLine;

    applyTextAnchor();
  }

  function applyTextAnchor() {
    var scrolls = lyricColumn.querySelectorAll('.scroll-wrapper');
    for (var i = 0; i < scrolls.length; i++) {
      scrolls[i].dataset.anchor = layout.anchor;
    }
  }

  function applyCover() {
    coverWrap.hidden = !config.showCover;
    if (!config.showCover) return;

    if (track && track.cover) {
      if (coverImg.getAttribute('src') !== track.cover) coverImg.src = track.cover;
      coverImg.hidden = false;
      coverFallback.hidden = true;
    } else {
      coverImg.hidden = true;
      coverFallback.hidden = false;
    }
  }

  coverImg.addEventListener('error', function () {
    coverImg.hidden = true;
    coverFallback.hidden = false;
  });

  // key 不包含 role：同一句歌词从副行升为主行时要复用同一个节点，
  // 否则会变成两行整体淡出淡入，而不是连续上移。
  function itemKey(item) {
    return (item.start || 0) + ':' + (item.text || '');
  }

  function itemsSignature(list) {
    var parts = [];
    for (var i = 0; i < list.length; i++) {
      var item = list[i];
      parts.push(item.role + '|' + (item.start || 0) + '|' + (item.text || '') +
        '|' + (item.words ? item.words.length : 0));
    }
    return parts.join('||') + (config.wordByWord ? '|w' : '|p');
  }

  function buildContent(line, item) {
    var scroll = line.firstChild;
    var content = scroll.firstChild;
    scroll.dataset.anchor = layout.anchor;
    content.innerHTML = '';
    line.__words = null;

    if (config.wordByWord && item.words && item.words.length) {
      var spans = [];
      for (var i = 0; i < item.words.length; i++) {
        var span = document.createElement('span');
        span.className = 'tb-word';
        span.textContent = item.words[i].text || '';
        content.appendChild(span);
        spans.push(span);
      }
      line.__words = { spans: spans, words: item.words };
    } else {
      content.textContent = item.text || '';
    }

    line.__item = item;
    line.dataset.role = item.role;
    line.__sig = itemsSignature([item]);
  }

  function createLine(item) {
    var line = document.createElement('div');
    line.className = 'lyric-line';
    line.dataset.role = item.role;
    line.innerHTML = '<div class="scroll-wrapper"><div class="scroll-content"></div></div>';
    buildContent(line, item);
    return line;
  }

  function updateLine(line, item) {
    var sig = itemsSignature([item]);
    if (line.__sig === sig) {
      line.__item = item;
      return;
    }
    buildContent(line, item);
  }

  function renderItems(nextItems) {
    var signature = itemsSignature(nextItems);
    if (signature === lastItemsSignature) {
      items = nextItems;
      return;
    }
    lastItemsSignature = signature;
    items = nextItems;

    var oldEls = {};
    var firstTops = {};
    var children = lyricColumn.children;
    for (var i = 0; i < children.length; i++) {
      var child = children[i];
      var key = child.dataset.key;
      if (!key || child.classList.contains('line-leave-active')) continue;
      oldEls[key] = child;
      firstTops[key] = child.offsetTop;
    }

    var used = {};
    var orderedKeys = [];

    for (var n = 0; n < nextItems.length; n++) {
      var item = nextItems[n];
      var itemId = itemKey(item);
      orderedKeys.push(itemId);
      var el = oldEls[itemId];
      if (el) {
        used[itemId] = true;
        updateLine(el, item);
      } else {
        el = createLine(item);
        el.dataset.key = itemId;
        el.classList.add('line-enter-from');
        observeLine(el);
      }
      lyricColumn.appendChild(el);
    }

    for (var oldKey in oldEls) {
      if (used[oldKey]) continue;
      var stale = oldEls[oldKey];
      if (!stale.parentNode) continue;
      stale.classList.add('line-leave-active', 'line-leave-to');
      unobserveLine(stale);
      (function (node) {
        setTimeout(function () {
          if (node.parentNode) node.parentNode.removeChild(node);
        }, 420);
      })(stale);
    }

    for (var k = 0; k < orderedKeys.length; k++) {
      var key2 = orderedKeys[k];
      var survivor = oldEls[key2];
      if (!survivor) continue;
      var first = firstTops[key2];
      if (first == null) continue;
      var delta = first - survivor.offsetTop;
      if (Math.abs(delta) < 1) continue;
      survivor.style.transition = 'none';
      survivor.style.transform = 'translateY(' + delta + 'px)';
      // 强制提交起始帧，否则下一帧清空 transform 时浏览器会当作没有变化，动画直接跳过。
      survivor.getBoundingClientRect();
      (function (node) {
        requestAnimationFrame(function () {
          node.style.transition = '';
          node.style.transform = '';
        });
      })(survivor);
    }

    var entering = lyricColumn.querySelectorAll('.line-enter-from');
    for (var e = 0; e < entering.length; e++) {
      (function (node) {
        requestAnimationFrame(function () {
          requestAnimationFrame(function () {
            node.classList.remove('line-enter-from');
          });
        });
      })(entering[e]);
    }

    applyTextAnchor();
    updateOverflow();
    scheduleContentWidthReport();
  }

  function updateOverflow() {
    var lines = lyricColumn.children;
    for (var i = 0; i < lines.length; i++) {
      var scroll = lines[i].firstChild;
      var content = scroll && scroll.firstChild;
      if (!content) continue;
      var overflow = content.scrollWidth - scroll.clientWidth;
      scroll.__overflow = overflow > 1 ? overflow : 0;
      scroll.classList.toggle('is-overflow', overflow > 1);
    }
  }

  function wordProgress(word, item, ms) {
    var start = Number(word.start) || 0;
    var end = Number(word.end) || 0;
    if (!(end > start)) {
      end = item.end > start ? item.end : start + 1;
    }
    if (ms <= start) return 0;
    if (ms >= end) return 1;
    return (ms - start) / (end - start);
  }

  // 溢出时让正在演唱的词停在可视区偏左位置，而不是按时间线性滚动：
  // 每个词的长度不同，线性滚动会和实际唱到的位置脱节。
  function lineScrollOffset(line, item, ms, scroll, content) {
    var overflow = scroll.__overflow || 0;
    if (overflow <= 1) return 0;

    var words = line.__words && line.__words.words;
    if (words && words.length) {
      var idx = -1;
      for (var i = 0; i < words.length; i++) {
        if (ms >= (Number(words[i].start) || 0)) idx = i;
        else break;
      }
      if (idx < 0) return 0;
      var span = line.__words.spans[idx];
      if (!span) return 0;
      var center = span.offsetLeft - content.offsetLeft + span.offsetWidth / 2;
      var target = center - scroll.clientWidth * 0.45;
      if (target <= 0) return 0;
      return -Math.min(overflow, target);
    }

    if (!(item.end > item.start)) return 0;
    var p = (ms - item.start) / (item.end - item.start);
    p = p < 0 ? 0 : (p > 1 ? 1 : p);
    return -overflow * p;
  }

  // 只有逐字高亮或长行滚动才需要逐帧刷新，暂停 / 静态时停掉 rAF。
  function needsTick() {
    if (!clock.playing) return false;
    var lines = lyricColumn.children;
    for (var i = 0; i < lines.length; i++) {
      if (lines[i].__words) return true;
      var scroll = lines[i].firstChild;
      if (scroll && (scroll.__overflow || 0) > 1) return true;
    }
    return false;
  }

  function scheduleTick() {
    if (rafId || !needsTick()) return;
    rafId = requestAnimationFrame(tick);
  }

  function tick() {
    rafId = 0;
    if (!needsTick()) return;
    currentMsCache = nowMs();
    var ms = currentMsCache;

    var lines = lyricColumn.children;
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      var item = line.__item;
      if (!item) continue;

      var scroll = line.firstChild;
      var content = scroll && scroll.firstChild;
      if (!content) continue;

      var overflow = scroll.__overflow || 0;
      if (overflow > 1) {
        var offset = lineScrollOffset(line, item, ms, scroll, content);
        if (content.__offset === undefined || Math.abs(content.__offset - offset) > 0.05) {
          content.__offset = offset;
          content.style.transform = 'translateX(' + offset.toFixed(2) + 'px)';
        }
      } else if (content.__offset) {
        content.__offset = 0;
        content.style.transform = '';
      }

      if (line.__words) {
        var words = line.__words.words;
        var spans = line.__words.spans;
        for (var w = 0; w < words.length; w++) {
          var progress = wordProgress(words[w], item, ms);
          var pct = (progress * 100).toFixed(1) + '%';
          if (spans[w].__p !== pct) {
            spans[w].__p = pct;
            spans[w].style.setProperty('--p', pct);
          }
        }
      }
    }

    if (needsTick()) rafId = requestAnimationFrame(tick);
  }

  function report(width) {
    var w = Math.round(width);
    if (!(w > 0) || w === lastReportedWidth) return;
    lastReportedWidth = w;
    if (api && typeof api.taskbarLyricsSend === 'function') {
      api.taskbarLyricsSend('content_width', w);
    }
  }

  // 切行时字号还在过渡动画中，直接读 scrollWidth 会低估目标宽度导致窗口抖动。
  function measureTargetTextWidth(element) {
    var line = element.closest ? element.closest('.lyric-line') : null;
    if (!line) return element.scrollWidth;
    var currentFontSize = parseFloat(getComputedStyle(line).fontSize);
    var targetFontSize = line.dataset.role === 'secondary'
      ? fittedFontSize * 0.82
      : fittedFontSize;
    if (!Number.isFinite(currentFontSize) || currentFontSize <= 0) return element.scrollWidth;
    return element.scrollWidth * (targetFontSize / currentFontSize);
  }

  function reportContentWidth() {
    widthRaf = 0;
    if (hovered || collapseTimer !== null) {
      report(layout.maxWidth);
      return;
    }

    var wrapperStyle = getComputedStyle(wrapper);
    var horizontalPadding =
      (parseFloat(wrapperStyle.paddingLeft) || 0) + (parseFloat(wrapperStyle.paddingRight) || 0);
    var coverWidth = config.showCover ? (coverWrap.offsetWidth || 0) : 0;

    var lyricArea = container.querySelector('.lyric-area');
    var lyricStyle = lyricArea ? getComputedStyle(lyricArea) : null;
    var lyricMargins = lyricStyle
      ? (parseFloat(lyricStyle.marginLeft) || 0) + (parseFloat(lyricStyle.marginRight) || 0)
      : 0;

    var maxText = 0;
    var contents = lyricColumn.querySelectorAll('.scroll-content');
    for (var i = 0; i < contents.length; i++) {
      var textWidth = measureTargetTextWidth(contents[i]);
      if (textWidth > maxText) maxText = textWidth;
    }

    var fixed = horizontalPadding + coverWidth + lyricMargins;
    var available = Math.max(0, layout.maxWidth - fixed);
    var textWidth = Math.min(maxText + LYRIC_WIDTH_GUARD, available);
    report(Math.min(layout.maxWidth, fixed + textWidth));
  }

  function scheduleContentWidthReport() {
    if (widthRaf) return;
    widthRaf = requestAnimationFrame(reportContentWidth);
  }

  function setHovered(next) {
    if (hoverLeaveTimer !== null) {
      clearTimeout(hoverLeaveTimer);
      hoverLeaveTimer = null;
    }
    if (collapseTimer !== null) {
      clearTimeout(collapseTimer);
      collapseTimer = null;
    }

    if (next) {
      hovered = true;
      container.classList.add('is-hovered');
      scheduleContentWidthReport();
      return;
    }

    hoverLeaveTimer = setTimeout(function () {
      hoverLeaveTimer = null;
      hovered = false;
      container.classList.remove('is-hovered');
      collapseTimer = setTimeout(function () {
        collapseTimer = null;
        scheduleContentWidthReport();
      }, CONTROLS_COLLAPSE_MS);
    }, 40);
  }

  function applyState(msg) {
    if (!msg) return;

    if (msg.layout) {
      layout.anchor = msg.layout.anchor === 'right' ? 'right' : 'left';
      layout.maxWidth = Number(msg.layout.maxWidth) || 400;
      layout.height = Number(msg.layout.height) || 48;
      layout.isLight = !!msg.layout.isLight;
    }
    if (msg.config) {
      if (msg.config.colorMode) config.colorMode = msg.config.colorMode;
      if (msg.config.showBackground !== undefined) config.showBackground = !!msg.config.showBackground;
      if (msg.config.doubleLine !== undefined) config.doubleLine = !!msg.config.doubleLine;
      if (msg.config.showCover !== undefined) config.showCover = !!msg.config.showCover;
      if (msg.config.wordByWord !== undefined) config.wordByWord = !!msg.config.wordByWord;
      if (msg.config.fontSize) config.fontSize = Number(msg.config.fontSize) || 14;
      if (msg.config.fontWeight) config.fontWeight = Number(msg.config.fontWeight) || 400;
      if (msg.config.fontFamily !== undefined) config.fontFamily = String(msg.config.fontFamily || '');
    }

    track = msg.track || null;
    clock.position = Number(msg.position) || 0;
    clock.at = performance.now();
    clock.playing = !!msg.playing;
    container.dataset.playing = clock.playing ? 'true' : 'false';

    var layoutSig = [
      config.colorMode,
      config.showBackground,
      config.doubleLine,
      config.showCover,
      config.wordByWord,
      config.fontSize,
      config.fontWeight,
      config.fontFamily,
      layout.maxWidth,
      layout.height,
    ].join('|');
    if (layoutSig !== lastLayoutSig) {
      lastLayoutSig = layoutSig;
      lastReportedWidth = 0;
    }

    songTitle.textContent = track ? (track.title || '') : '';
    songArtist.textContent = track ? (track.artist || '') : '';

    applyLayout();
    applyCover();
    renderItems(msg.items || []);
    scheduleTick();
    scheduleContentWidthReport();
  }

  function applyPosition(msg) {
    clock.position = Number(msg.position) || 0;
    clock.at = performance.now();
    clock.playing = !!msg.playing;
    container.dataset.playing = clock.playing ? 'true' : 'false';
    scheduleTick();
  }

  // 窗口刚显示时若恰好压在光标下方，Chromium 会直接派发 mouseenter，
  // 之后窗口移到任务栏也不会补发 mouseleave，悬停态会一直卡住。
  // 因此只在光标真正移动进入窗口后才展开。
  wrapper.addEventListener('mousemove', function () { setHovered(true); });
  wrapper.addEventListener('mouseleave', function () { setHovered(false); });
  wrapper.addEventListener('dblclick', function () {
    if (api && typeof api.taskbarLyricsSend === 'function') {
      api.taskbarLyricsSend('focus_main');
    }
  });

  var buttons = container.querySelectorAll('.control-btn');
  for (var i = 0; i < buttons.length; i++) {
    buttons[i].addEventListener('click', function (event) {
      event.stopPropagation();
      var cmd = this.dataset.cmd;
      if (api && typeof api.taskbarLyricsSend === 'function') {
        api.taskbarLyricsSend('command', cmd);
      }
    });
    buttons[i].addEventListener('dblclick', function (event) {
      event.stopPropagation();
    });
  }

  window.addEventListener('resize', function () {
    updateOverflow();
    scheduleContentWidthReport();
  });

  if (api && typeof api.onTaskbarLyrics === 'function') {
    api.onTaskbarLyrics(function (msg) {
      if (!msg) return;
      if (msg.type === 'position') applyPosition(msg);
      else applyState(msg);
    });
  }

  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(function () {
      updateOverflow();
      scheduleContentWidthReport();
    });
  }

  rafId = requestAnimationFrame(tick);
})();
