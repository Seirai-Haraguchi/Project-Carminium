'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT_MD = path.join(ROOT, '代码注释.md');
const APPLY = process.argv.includes('--apply');
const VERBOSE = process.argv.includes('--verbose');

let acorn = null;
try {
  acorn = require('acorn');
} catch (e) {
  acorn = null;
}

const LICENSE_RE = /copyright|\blicen[cs]e\b|\bspdx\b|\bmit\b|\bapache\b|\(c\)|all\s+rights\s+reserved|@license|\bauthors?\b|\bwarrant/i;
const DIRECTIVE_RE = /^\s*[#@]?\s*(sourceMappingURL|sourceURL)\s*=/;
const PURE_RE = /^\s*[#@]__[A-Za-z_]+__\s*$/;

function isPreserved(text, startLine) {
  const t = text.trim();
  if (DIRECTIVE_RE.test(t)) return true;
  if (PURE_RE.test(t)) return true;
  if (t.startsWith('!')) return true;
  if (startLine <= 60 && LICENSE_RE.test(t)) return true;
  return false;
}

function lineStarts(src) {
  const starts = [0];
  for (let i = 0; i < src.length; i++) {
    if (src.charCodeAt(i) === 10) starts.push(i + 1);
  }
  return starts;
}

function lineOf(starts, offset) {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

function findTagEnd(src, i) {
  let j = i;
  let quote = null;
  while (j < src.length) {
    const c = src[j];
    if (quote) {
      if (c === quote) quote = null;
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === '>') {
      return j + 1;
    }
    j++;
  }
  return src.length;
}

function cssScan(src, offset) {
  const out = [];
  const n = src.length;
  let i = 0;
  while (i < n) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '*') {
      let e = src.indexOf('*/', i + 2);
      if (e === -1) e = n - 2;
      const end = e + 2;
      out.push({ start: i + offset, end: end + offset, kind: 'block', head: '/*' });
      i = end;
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n) {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === c) { j++; break; }
        if (src.charCodeAt(j) === 10) break;
        j++;
      }
      i = j;
      continue;
    }
    i++;
  }
  return out;
}

function cScan(src, offset, opts) {
  const out = [];
  const n = src.length;
  let i = 0;
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '/' && d === '/') {
      let j = i + 2;
      while (j < n) {
        if (src.charCodeAt(j) === 10) {
          if (src.charCodeAt(j - 1) === 92) { j++; continue; }
          break;
        }
        j++;
      }
      out.push({ start: i + offset, end: j + offset, kind: 'line', head: '//' });
      i = j;
      continue;
    }
    if (c === '/' && d === '*') {
      let e = src.indexOf('*/', i + 2);
      if (e === -1) e = n - 2;
      const end = e + 2;
      out.push({ start: i + offset, end: end + offset, kind: 'block', head: '/*' });
      i = end;
      continue;
    }
    if (opts && opts.rawStrings && c === 'R' && d === '"') {
      const open = src.indexOf('(', i + 2);
      if (open !== -1) {
        const delim = src.slice(i + 2, open);
        const closer = ')' + delim + '"';
        let e = src.indexOf(closer, open);
        if (e === -1) e = n - closer.length;
        i = e + closer.length;
        continue;
      }
    }
    if (opts && opts.zigLineStrings && c === '\\' && d === '\\') {
      let j = i + 2;
      while (j < n && src.charCodeAt(j) !== 10) j++;
      i = j;
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n) {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === c) { j++; break; }
        if (src.charCodeAt(j) === 10) break;
        j++;
      }
      i = j;
      continue;
    }
    i++;
  }
  return out;
}

function htmlScan(src) {
  const out = [];
  const lower = src.toLowerCase();
  const n = src.length;
  let i = 0;
  while (i < n) {
    if (src.startsWith('<!--', i)) {
      let e = src.indexOf('-->', i + 4);
      if (e === -1) e = n - 3;
      const end = e + 3;
      out.push({ start: i, end, kind: 'block', head: '<!--' });
      i = end;
      continue;
    }
    if (lower.startsWith('<script', i)) {
      const gt = findTagEnd(src, i);
      const tagText = src.slice(i, gt);
      const tm = /type\s*=\s*["']?([^"'\s>]+)/i.exec(tagText);
      const type = tm ? tm[1].toLowerCase() : '';
      const isJs = type === '' || type.indexOf('javascript') !== -1 || type === 'module' || type === 'text/babel';
      let close = lower.indexOf('</script', gt);
      if (close === -1) close = n;
      if (isJs) {
        const body = src.slice(gt, close);
        out.push(...extractJs(body, gt, true));
      }
      let after = close === n ? n : lower.indexOf('>', close);
      i = after === -1 ? n : after + 1;
      continue;
    }
    if (lower.startsWith('<style', i)) {
      const gt = findTagEnd(src, i);
      let close = lower.indexOf('</style', gt);
      if (close === -1) close = n;
      out.push(...cssScan(src.slice(gt, close), gt));
      let after = close === n ? n : lower.indexOf('>', close);
      i = after === -1 ? n : after + 1;
      continue;
    }
    i++;
  }
  return out;
}

function jsCommentsFallback(src, offset) {
  const out = [];
  const n = src.length;
  const REGEX_BEFORE = /[({[,;:=!&|?+\-*%~^<>]/;
  const REGEX_KEYWORDS = /^(return|typeof|instanceof|in|of|new|delete|void|case|do|else|yield|await|throw)$/;
  let i = 0;
  let prevToken = '';
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '/' && d === '/') {
      let j = i + 2;
      while (j < n && src.charCodeAt(j) !== 10) j++;
      out.push({ start: i + offset, end: j + offset, kind: 'line', head: '//' });
      i = j;
      continue;
    }
    if (c === '/' && d === '*') {
      let e = src.indexOf('*/', i + 2);
      if (e === -1) e = n - 2;
      const end = e + 2;
      out.push({ start: i + offset, end: end + offset, kind: 'block', head: '/*' });
      i = end;
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n) {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === c) { j++; break; }
        if (src.charCodeAt(j) === 10) break;
        j++;
      }
      prevToken = 'str';
      i = j;
      continue;
    }
    if (c === '`') {
      let j = i + 1;
      let depth = 0;
      while (j < n) {
        if (src[j] === '\\') { j += 2; continue; }
        if (depth === 0 && src[j] === '`') { j++; break; }
        if (src[j] === '$' && src[j + 1] === '{') { depth++; j += 2; continue; }
        if (depth > 0 && src[j] === '}') { depth--; j++; continue; }
        j++;
      }
      prevToken = 'str';
      i = j;
      continue;
    }
    if (c === '/' && prevToken !== 'str' && prevToken !== 'name' && prevToken !== 'num') {
      const prevChar = prevToken;
      const wordMatch = /([A-Za-z_$][A-Za-z0-9_$]*)\s*$/.exec(src.slice(Math.max(0, i - 40), i));
      const kw = wordMatch ? wordMatch[1] : '';
      const canRegex = prevChar === '' || REGEX_BEFORE.test(prevChar) || REGEX_KEYWORDS.test(kw);
      if (canRegex) {
        let j = i + 1;
        let inClass = false;
        while (j < n) {
          const ch = src[j];
          if (ch === '\\') { j += 2; continue; }
          if (ch === '[') inClass = true;
          else if (ch === ']') inClass = false;
          else if (ch === '/' && !inClass) { j++; break; }
          else if (ch.charCodeAt(0) === 10) break;
          j++;
        }
        while (j < n && /[a-z]/.test(src[j])) j++;
        prevToken = 'regex';
        i = j;
        continue;
      }
    }
    if (/[A-Za-z0-9_$]/.test(c)) {
      prevToken = /[0-9]/.test(c) && !/[A-Za-z_$]/.test(src[i - 1] || '') ? 'num' : 'name';
      i++;
      continue;
    }
    if (!/\s/.test(c)) prevToken = c;
    i++;
  }
  return out;
}

function extractJs(src, offset, allowFallback) {
  if (!acorn) return jsCommentsFallback(src, offset);
  const base = {
    ecmaVersion: 'latest',
    allowHashBang: true,
    allowReturnOutsideFunction: true,
    allowAwaitOutsideFunction: true,
    allowImportExportEverywhere: true,
    allowSuperOutsideMethod: true,
    allowNewTargetOutsideFunction: true,
  };
  for (const sourceType of ['module', 'script']) {
    const out = [];
    const opts = Object.assign({}, base, {
      sourceType,
      onComment(block, text, start, end) {
        out.push({ start: start + offset, end: end + offset, kind: block ? 'block' : 'line', head: block ? '/*' : '//' });
      },
    });
    try {
      acorn.parse(src, opts);
      return out;
    } catch (e) {
      continue;
    }
  }
  if (allowFallback) return jsCommentsFallback(src, offset);
  return null;
}

function parseSourceType(src) {
  for (const sourceType of ['module', 'script']) {
    try {
      acorn.parse(src, {
        ecmaVersion: 'latest',
        sourceType,
        allowHashBang: true,
        allowReturnOutsideFunction: true,
        allowAwaitOutsideFunction: true,
        allowImportExportEverywhere: true,
      });
      return sourceType;
    } catch (e) {
      continue;
    }
  }
  return null;
}

function astKey(src, sourceType) {
  const ast = acorn.parse(src, {
    ecmaVersion: 'latest',
    sourceType,
    allowHashBang: true,
    allowReturnOutsideFunction: true,
    allowAwaitOutsideFunction: true,
    allowImportExportEverywhere: true,
  });
  return JSON.stringify(ast, (k, v) => (k === 'start' || k === 'end' || k === 'loc' || k === 'range' ? undefined : v));
}

function applyRemoval(src, ranges) {
  const mask = new Uint8Array(src.length);
  for (const r of ranges) {
    for (let i = r.start; i < r.end && i < src.length; i++) mask[i] = 1;
  }
  const raw = src.split('\n');
  const out = [];
  let pos = 0;
  for (const rawLine of raw) {
    const crlf = rawLine.endsWith('\r');
    const line = crlf ? rawLine.slice(0, -1) : rawLine;
    const start = pos;
    const end = pos + line.length;
    let covered = end > start;
    for (let i = start; i < end && covered; i++) {
      if (!mask[i]) covered = false;
    }
    pos = start + rawLine.length + 1;
    if (covered) continue;
    let s = '';
    let touched = false;
    for (let i = start; i < end; i++) {
      if (mask[i]) touched = true;
      else s += src[i];
    }
    if (touched) {
      s = s.replace(/[ \t]+$/, '');
      if (s.trim() === '') continue;
    }
    out.push(s + (crlf ? '\r' : ''));
  }
  return out.join('\n');
}

function collectFiles() {
  const files = [];
  const walk = (dir) => {
    const abs = path.join(ROOT, dir);
    if (!fs.existsSync(abs)) return;
    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
      const rel = dir + '/' + entry.name;
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
        walk(rel);
      } else if (entry.name.endsWith('.js')) {
        files.push(rel);
      }
    }
  };
  walk('web');
  walk('electron');
  walk('scripts');
  for (const rel of ['web/style.css', 'web/floating.css']) {
    if (fs.existsSync(path.join(ROOT, rel))) files.push(rel);
  }
  for (const rel of ['web/index.html', 'web/floating.html']) {
    if (fs.existsSync(path.join(ROOT, rel))) files.push(rel);
  }
  for (const rel of [
    'native/build.zig',
    'native/carminium_audio.zig',
    'native/soundtouch_wrapper.cpp',
    'native/soundtouch_wrapper.h',
  ]) {
    if (fs.existsSync(path.join(ROOT, rel))) files.push(rel);
  }
  return files;
}

function kindOf(rel) {
  if (rel.endsWith('.js')) return 'js';
  if (rel.endsWith('.css')) return 'css';
  if (rel.endsWith('.html')) return 'html';
  if (rel.endsWith('.zig')) return 'zig';
  return 'c';
}

function extractFor(rel, src) {
  const kind = kindOf(rel);
  if (kind === 'js') return { comments: extractJs(src, 0, false), usedFallback: false };
  if (kind === 'css') return { comments: cssScan(src, 0), usedFallback: false };
  if (kind === 'html') return { comments: htmlScan(src), usedFallback: false };
  if (kind === 'zig') return { comments: cScan(src, 0, { zigLineStrings: true, rawStrings: false }), usedFallback: false };
  return { comments: cScan(src, 0, { zigLineStrings: false, rawStrings: true }), usedFallback: false };
}

function langOf(rel) {
  if (rel.endsWith('.css')) return 'css';
  if (rel.endsWith('.html')) return 'html';
  if (rel.endsWith('.zig')) return 'zig';
  if (rel.endsWith('.cpp') || rel.endsWith('.h')) return 'cpp';
  return 'js';
}

function main() {
  if (!acorn) {
    console.log('[warn] acorn 不可用，JS 走内置词法回退（准确性较低）。建议 NODE_PATH 指向含 acorn 的目录后重跑。');
  }
  const files = collectFiles();
  const report = [];
  const mdParts = [];
  let totalRemoved = 0;
  let totalKept = 0;

  for (const rel of files.sort()) {
    const abs = path.join(ROOT, rel);
    const src = fs.readFileSync(abs, 'utf8');
    const starts = lineStarts(src);
    const res = extractFor(rel, src);
    if (!res.comments) {
      report.push({ rel, error: 'parse-failed' });
      continue;
    }
    const comments = res.comments.slice();
    const removed = [];
    const kept = [];
    for (const c of comments) {
      const text = src.slice(c.start, c.end);
      const ln = lineOf(starts, c.start);
      c.line = ln;
      c.text = text;
      if (isPreserved(text, ln)) kept.push(c);
      else removed.push(c);
    }
    const stripped = applyRemoval(src, removed);

    let verify = 'ok';
    if (kindOf(rel) === 'js' && acorn) {
      const st = parseSourceType(src);
      if (st) {
        const st2 = parseSourceType(stripped);
        if (!st2) verify = 'post-parse-failed';
        else if (astKey(src, st) !== astKey(stripped, st2)) verify = 'ast-mismatch';
      } else {
        verify = 'unparsed';
      }
    }

    totalRemoved += removed.length;
    totalKept += kept.length;
    report.push({ rel, removed: removed.length, kept: kept.length, verify, kind: kindOf(rel) });

    if (APPLY && verify === 'ok') {
      if (stripped !== src) fs.writeFileSync(abs, stripped, 'utf8');
    }

    if (removed.length) {
      const lang = langOf(rel);
      const lines = [];
      lines.push('');
      lines.push('## `' + rel + '`');
      lines.push('');
      lines.push('共 ' + removed.length + ' 条' + (kept.length ? '（保留 ' + kept.length + ' 条版权/指令头）' : ''));
      lines.push('');
      for (const c of removed) {
        const body = c.text;
        const endLine = lineOf(starts, Math.max(c.start, c.end - 1));
        const label = endLine > c.line ? 'L' + c.line + '–L' + endLine : 'L' + c.line;
        const fence = body.indexOf('```') !== -1 ? '~~~~' : '```';
        if (body.indexOf('\n') === -1) {
          lines.push('- **' + label + '**  `' + body.trim().replace(/\|/g, '\\|') + '`');
        } else {
          lines.push('- **' + label + '**');
          lines.push('');
          lines.push('  ' + fence + lang);
          for (const l of body.split('\n')) lines.push('  ' + l);
          lines.push('  ' + fence);
          lines.push('');
        }
      }
      mdParts.push(lines.join('\n'));
    }
  }

  const bad = report.filter((r) => r.error || (r.verify && r.verify !== 'ok'));
  const parseFail = report.filter((r) => r.error === 'parse-failed');

  if (APPLY) {
    const header = [];
    header.push('# 代码注释存档');
    header.push('');
    header.push('> 本项目源码已剥离全部注释，注释原文按文件 + 行号归档于此文件。');
    header.push('> 生成脚本：`scripts/strip_comments.js`（`node scripts/strip_comments.js --apply`）。');
    header.push('> 此文件已被 `.gitignore` 忽略，不入库。');
    header.push('');
    header.push('- 剥离文件数：' + report.length);
    header.push('- 移除注释：' + totalRemoved + ' 条');
    header.push('- 保留版权/指令头：' + totalKept + ' 条');
    header.push('');
    header.push('---');
    fs.writeFileSync(OUT_MD, header.join('\n') + mdParts.join('\n') + '\n', 'utf8');
  }

  console.log('模式: ' + (APPLY ? 'APPLY（已写入）' : 'DRY-RUN（未写入）'));
  console.log('文件数: ' + report.length + ' | 移除注释: ' + totalRemoved + ' | 保留: ' + totalKept);
  if (parseFail.length) console.log('解析失败（已跳过）: ' + parseFail.map((r) => r.rel).join(', '));
  if (bad.length && VERBOSE) {
    for (const r of bad) console.log('  [CHECK] ' + r.rel + ': ' + (r.error || r.verify));
  }
  const nonOk = report.filter((r) => r.verify && r.verify !== 'ok');
  if (nonOk.length) console.log('校验异常: ' + nonOk.map((r) => r.rel + '(' + r.verify + ')').join(', '));
  else console.log('校验: 全部通过（AST 等价 / 语法有效）');
  if (APPLY) console.log('已生成: ' + OUT_MD);
}

main();
