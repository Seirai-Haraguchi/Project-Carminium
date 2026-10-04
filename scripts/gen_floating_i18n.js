/**
 * 为浮动窗口生成精简的 i18n 字典。
 *
 * 背景：web/i18n.js 包含 5 种语言 × 全部文案（~209KB 源码）。浮动窗只需要
 * 三十来个键，却要为整个文件付出解析 + 常驻 V8 堆的代价。
 *
 * 本脚本从 web/i18n.js 里把浮动窗用到的键抽出来，生成 web/floating_i18n.js：
 *   · 只含需要的键（体积 ~6KB）
 *   · 暴露与 App.i18n 兼容的 t / init / getLang / applyToDOM / onChange
 *
 * ⚠️ 在 web/floating.html 里新增 data-i18n 键、或页面脚本里新增 t('...') 之后，
 *    必须重跑本脚本，否则新键会退化成显示键名本身。
 *
 * 用法：node scripts/gen_floating_i18n.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'web', 'i18n.js');
const OUT = path.join(ROOT, 'web', 'floating_i18n.js');

/** 浮动窗用到的键（改这里 + 重跑） */
const KEYS = [
  // 通用
  'common.nowPlaying', 'common.notPlaying', 'common.unknownTrack',
  'common.unknownArtist', 'common.cancel', 'common.confirm', 'common.close',
  // 正在播放面板
  'np.tab.info', 'np.tab.queue', 'np.tab.lyrics', 'np.noLyrics', 'np.progress',
  'np.prev', 'np.next', 'np.playPause', 'np.shuffle', 'np.repeat', 'np.like',
  'np.audioMode', 'np.mute', 'np.volume', 'np.exclusiveMode', 'np.sharedMode',
  'np.removeFromQueue', 'np.dragToReorder',
  // 浮动窗窗口按钮
  'floating.dock', 'floating.albumCover',
  'title.minimize', 'title.close',
  // 独占模式切换确认
  'audio.switchExclusiveTitle', 'audio.switchExclusiveBody', 'audio.switchExclusiveConfirm',
  'audio.switchSharedTitle', 'audio.switchSharedBody', 'audio.switchSharedConfirm',
];

function readStrings() {
  const src = fs.readFileSync(SRC, 'utf8');
  const startMark = 'var STRINGS = {';
  const start = src.indexOf(startMark);
  if (start < 0) throw new Error('未在 i18n.js 中找到 STRINGS 定义');

  // STRINGS 的收尾是列 0 的 `};` —— 内层对象收尾都带缩进，故首次匹配即正确
  const endRel = src.indexOf('\n};\n', start);
  if (endRel < 0) throw new Error('未找到 STRINGS 的结束位置');

  const literal = src.slice(start + 'var STRINGS = '.length, endRel + 3);
  // eslint-disable-next-line no-eval
  return eval('(' + literal.slice(0, -1) + ')');
}

function readSupported() {
  const src = fs.readFileSync(SRC, 'utf8');
  const m = src.match(/var SUPPORTED = (\[[^\]]*\]);/);
  if (!m) throw new Error('未找到 SUPPORTED 定义');
  // eslint-disable-next-line no-eval
  return eval(m[1]);
}

function build() {
  const STRINGS = readStrings();
  const SUPPORTED = readSupported();

  const out = {};
  const missing = [];
  for (const lang of SUPPORTED) {
    const dict = STRINGS[lang];
    if (!dict) { missing.push(lang + ' (整语言缺失)'); continue; }
    out[lang] = {};
    for (const key of KEYS) {
      if (dict[key] !== undefined) out[lang][key] = dict[key];
      else missing.push(lang + ':' + key);
    }
  }
  if (missing.length) {
    console.warn('[gen-floating-i18n] 缺失键（将回退到 zh-CN）:', missing.join(', '));
  }

  const bundled = SUPPORTED.filter((l) => out[l]);
  const json = JSON.stringify(out, null, 2).replace(/^/gm, '  ').trim();

  const content = `/**
 * Carminium — 浮动窗口精简 i18n（自动生成，请勿手改）
 *
 * ⚠️ 由 scripts/gen_floating_i18n.js 生成。新增键后重跑：
 *      node scripts/gen_floating_i18n.js
 *
 * 只包含浮动窗用到的键（${KEYS.length} 个 × ${bundled.length} 语言），
 * 用于替换 209KB 的完整 i18n.js。API 与 App.i18n 兼容。
 */
(function () {
  'use strict';

  window.App = window.App || {};

  var SUPPORTED = ${JSON.stringify(bundled)};
  var DEFAULT_LANG = 'zh-CN';
  var _currentLang = DEFAULT_LANG;
  var _listeners = [];

  var STRINGS = ${json};

  /** 翻译键 → 当前语言文本；缺失时回退 zh-CN，再回退到键本身 */
  function t(key, params) {
    var dict = STRINGS[_currentLang] || STRINGS[DEFAULT_LANG];
    var text = dict[key];
    if (text === undefined) text = STRINGS[DEFAULT_LANG][key];
    if (text === undefined) return key;
    if (params) {
      for (var k in params) {
        if (Object.prototype.hasOwnProperty.call(params, k)) {
          text = text.split('{' + k + '}').join(params[k]);
        }
      }
    }
    return text;
  }

  function init(lang) {
    if (SUPPORTED.indexOf(lang) === -1) lang = DEFAULT_LANG;
    var changed = _currentLang !== lang;
    _currentLang = lang;
    document.documentElement.setAttribute('lang', lang);
    if (changed) {
      applyToDOM();
      for (var i = 0; i < _listeners.length; i++) {
        try { _listeners[i](lang); } catch (e) { /* ignore */ }
      }
    }
  }

  function getLang() { return _currentLang; }

  function onChange(fn) {
    _listeners.push(fn);
    return function () {
      var i = _listeners.indexOf(fn);
      if (i >= 0) _listeners.splice(i, 1);
    };
  }

  function applyToDOM(root) {
    var scope = root || document;
    scope.querySelectorAll('[data-i18n]').forEach(function (el) {
      var k = el.getAttribute('data-i18n');
      if (k) el.textContent = t(k);
    });
    scope.querySelectorAll('[data-i18n-title]').forEach(function (el) {
      var k = el.getAttribute('data-i18n-title');
      if (k) el.setAttribute('title', t(k));
    });
    scope.querySelectorAll('[data-i18n-aria-label]').forEach(function (el) {
      var k = el.getAttribute('data-i18n-aria-label');
      if (k) el.setAttribute('aria-label', t(k));
    });
    scope.querySelectorAll('[data-i18n-alt]').forEach(function (el) {
      var k = el.getAttribute('data-i18n-alt');
      if (k) el.setAttribute('alt', t(k));
    });
  }

  window.App.i18n = {
    t: t,
    init: init,
    getLang: getLang,
    applyToDOM: applyToDOM,
    onChange: onChange,
    supported: SUPPORTED,
    defaultLang: DEFAULT_LANG,
  };
})();
`;

  fs.writeFileSync(OUT, content, 'utf8');
  console.log('[gen-floating-i18n] 写入', path.relative(ROOT, OUT),
    '(' + Buffer.byteLength(content, 'utf8') + ' bytes, ' + KEYS.length + ' 键 × ' + bundled.length + ' 语言)');
}

build();
