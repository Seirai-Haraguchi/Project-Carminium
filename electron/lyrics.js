'use strict';

const https = require('https');
const http = require('http');
const { URL } = require('url');
const _qrcDecrypt = require('./qrc_decrypt');

const NETEASE_BASE = 'https://music.163.com';
const SEARCH_URL = NETEASE_BASE + '/api/search/get';
const LYRIC_URL = NETEASE_BASE + '/api/song/lyric';
const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
    'AppleWebKit/537.36 (KHTML, like Gecko) ' +
    'Chrome/120.0.0.0 Safari/537.36',
  'Referer': NETEASE_BASE,
};
const TIMEOUT = 8000;

const TIME_RE = /\[(\d{2}):(\d{2})(?:[\.:](\d{2,3}))?\]/g;

const _fetchCache = new Map();


function _request(urlStr, { method = 'GET', body = null, headers = null, json = false } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const lib = url.protocol === 'https:' ? https : http;
    const opts = {
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search,
      method,
      headers: headers ? { ...headers } : { ...HEADERS },
    };
    if (body) {
      opts.headers['Content-Type'] = json
        ? 'application/json'
        : 'application/x-www-form-urlencoded';
      opts.headers['Content-Length'] = Buffer.byteLength(body);
    }
    const req = lib.request(opts, (resp) => {
      // 用 Buffer 累积再统一转 utf8，避免多字节字符被 chunk 边界截断成乱码
      const chunks = [];
      resp.on('data', (chunk) => chunks.push(chunk));
      resp.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    });
    req.on('error', reject);
    req.setTimeout(TIMEOUT, () => {
      req.destroy(new Error('timeout'));
    });
    if (body) req.write(body);
    req.end();
  });
}


async function search(query) {
  if (!query || !query.trim()) {
    return JSON.stringify({ songs: [], error: null });
  }
  try {
    const body = new URLSearchParams({
      s: query,
      type: '1',
      limit: '20',
      offset: '0',
    }).toString();
    const raw = await _request(SEARCH_URL, { method: 'POST', body });
    const result = JSON.parse(raw);
    const songs = (result.result?.songs || []).map((s) => ({
      id: s.id,
      name: s.name || '',
      artist: (s.artists || []).map((a) => a.name || '').join(', '),
      album: s.album?.name || '',
      duration: s.duration || 0,
    }));
    return JSON.stringify({ songs, error: null });
  } catch (e) {
    return JSON.stringify({ songs: [], error: String(e) });
  }
}

async function fetchLyrics(songId) {
  try {
    const sid = String(songId);
    const url = LYRIC_URL + '?id=' + sid + '&lv=1&kv=1&tv=-1&yv=-1';
    const raw = await _request(url);
    const result = JSON.parse(raw);

    const lrc = result.lrc?.lyric || '';
    const tlyric = result.tlyric?.lyric || '';
    const romalrc = result.romalrc?.lyric || '';
    const yrclrc = result.yrc?.lyric || '';

    const originalLrc = yrclrc.trim() ? _yrcToEnhancedLrc(yrclrc) : lrc;
    const combined = _combineLrc(originalLrc, romalrc, tlyric);

    return JSON.stringify({
      lyrics: combined,
      has_translation: !!tlyric.trim(),
      has_romaji: !!romalrc.trim(),
      error: null,
    });
  } catch (e) {
    return JSON.stringify({
      lyrics: '',
      has_translation: false,
      has_romaji: false,
      error: String(e),
    });
  }
}


const QQ_SEARCH_URL = 'https://c.y.qq.com/soso/fcgi-bin/client_search_cp';
const QQ_LYRIC_URL = 'https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg';
const QQ_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
    'AppleWebKit/537.36 (KHTML, like Gecko) ' +
    'Chrome/120.0.0.0 Safari/537.36',
  'Referer': 'https://y.qq.com/',
};

async function searchQQMusic(query) {
  if (!query || !query.trim()) {
    return JSON.stringify({ songs: [], error: null });
  }
  try {
    const url = QQ_SEARCH_URL + '?w=' + encodeURIComponent(query) + '&format=json&p=1&n=20';
    const raw = await _request(url, { headers: QQ_HEADERS });
    const jsonStr = raw.replace(/^callback\(/, '').replace(/\);?$/, '');
    const result = JSON.parse(jsonStr);
    const list = result?.data?.song?.list || [];
    const songs = list.map((s) => ({
      id: s.songmid,
      name: s.songname || '',
      artist: (s.singer || []).map((a) => a.name || '').join(', '),
      album: s.albumname || '',
      duration: (s.interval || 0) * 1000,
    }));
    return JSON.stringify({ songs, error: null });
  } catch (e) {
    return JSON.stringify({ songs: [], error: String(e) });
  }
}

async function fetchQQMusicLyrics(songMid) {
  try {
    const qrcResult = await _fetchQQMusicLyricsQrc(songMid);
    if (qrcResult) return qrcResult;
  } catch (e) {
  }
  return _fetchQQMusicLyricsLegacy(songMid);
}


const QQ_MUSICU_URL = 'https://u.y.qq.com/cgi-bin/musicu.fcg';

async function _fetchQQMusicLyricsQrc(songMid) {
  const mid = String(songMid);
  const body = JSON.stringify({
    comm: { ct: 19, cv: 1859, uin: '0' },
    req: {
      module: 'music.musichallSong.PlayLyricInfo',
      method: 'GetPlayLyricInfo',
      param: { songMID: mid, trans: 1, roma: 1, qrc: 1 },
    },
  });
  const raw = await _request(QQ_MUSICU_URL, {
    method: 'POST',
    body,
    headers: QQ_HEADERS,
    json: true,
  });
  const result = JSON.parse(raw);
  const data =
    (result.req && result.req.data) || (result.req_1 && result.req_1.data);
  if (!data || !data.lyric) return null;

  const lyric = _decodeQqLyricField(data.lyric);
  const trans = _decodeQqLyricField(data.trans);
  const roma = _decodeQqLyricField(data.roma);

  const originalLrc = _isQrc(lyric) ? _qrcToEnhancedLrc(lyric) : lyric;
  if (!originalLrc.trim()) return null;
  const romaLrc = roma ? (_isQrc(roma) ? _qrcToEnhancedLrc(roma) : roma) : '';

  const combined = _combineLrc(originalLrc, romaLrc, trans);

  return JSON.stringify({
    lyrics: combined,
    has_translation: !!trans.trim(),
    has_romaji: !!roma.trim(),
    error: null,
  });
}

async function _fetchQQMusicLyricsLegacy(songMid) {
  try {
    const mid = String(songMid);
    const url = QQ_LYRIC_URL + '?songmid=' + mid + '&format=json&pcachetime=' + Date.now();
    const raw = await _request(url, { headers: QQ_HEADERS });
    const jsonStr = raw.replace(/^callback\(/, '').replace(/\);?$/, '');
    const result = JSON.parse(jsonStr);

    if (result.retcode !== 0) {
      return JSON.stringify({
        lyrics: '',
        has_translation: false,
        has_romaji: false,
        error: 'retcode=' + result.retcode,
      });
    }

    const lrc = result.lyric ? Buffer.from(result.lyric, 'base64').toString('utf-8') : '';
    const trans = result.trans ? Buffer.from(result.trans, 'base64').toString('utf-8') : '';
    const combined = _combineLrc(lrc, '', trans);

    return JSON.stringify({
      lyrics: combined,
      has_translation: !!trans.trim(),
      has_romaji: false,
      error: null,
    });
  } catch (e) {
    return JSON.stringify({
      lyrics: '',
      has_translation: false,
      has_romaji: false,
      error: String(e),
    });
  }
}


function _decodeQqLyricField(raw) {
  if (!raw) return '';
  const text = String(raw).trim();
  if (!text) return '';

  if (text.length % 2 === 0 && /^[0-9a-fA-F]+$/.test(text)) {
    return _extractQrcContent(_qrcDecrypt.decryptQqLyric(Buffer.from(text, 'hex')));
  }

  const buf = Buffer.from(text, 'base64');
  const asText = buf.toString('utf-8');
  if (/^\[ti:|^\[\d{2}:\d{2}|^\[\d+,\d+\]/m.test(asText)) {
    return asText;
  }
  return _extractQrcContent(_qrcDecrypt.decryptQqLyric(buf));
}

function _extractQrcContent(text) {
  if (!text) return '';
  if (text.indexOf('<') !== 0 && text.indexOf('LyricContent') === -1) return text;
  const m = text.match(/LyricContent="([\s\S]*?)"/);
  if (!m) return text;
  return m[1]
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(parseInt(n, 10)))
    .replace(/&amp;/g, '&');
}

function _isQrc(text) {
  return /^\[\d+,\d+\]/m.test(text || '');
}

function _qrcToEnhancedLrc(qrcText) {
  if (!qrcText || !qrcText.trim()) return '';

  let offset = 0;
  const om = qrcText.match(/\[offset:\s*(-?\d+)\]/i);
  if (om) offset = parseInt(om[1], 10) || 0;

  const lines = qrcText.split('\n');
  const outLines = [];
  const headerRe = /^\[(\d+),(\d+)\]/;
  const wordRe = /([^()\r\n]*)\((\d+),(\d+)(?:,\d+)?\)/g;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const hMatch = line.match(headerRe);
    if (!hMatch) continue;

    const lineStart = Math.max(0, parseInt(hMatch[1], 10) - offset);
    const lineDur = parseInt(hMatch[2], 10) || 0;
    const lineEnd = lineStart + lineDur;

    const content = line.substring(hMatch[0].length);
    wordRe.lastIndex = 0;
    let wMatch;
    const words = [];
    while ((wMatch = wordRe.exec(content)) !== null) {
      words.push({
        start: Math.max(0, parseInt(wMatch[2], 10) - offset),
        text: wMatch[1] || '',
      });
    }
    if (words.length === 0) continue;

    let lrcLine = _formatTime(lineStart);
    for (let w = 0; w < words.length; w++) {
      lrcLine += _formatWordTime(words[w].start) + words[w].text;
    }
    lrcLine += _formatWordTime(lineEnd);
    outLines.push(lrcLine);
  }

  return outLines.join('\n');
}


const LRCLIB_BASE = 'https://lrclib.net/api';

async function searchLrclib(query) {
  if (!query || !query.trim()) {
    return JSON.stringify({ songs: [], error: null });
  }
  try {
    const url = LRCLIB_BASE + '/search?q=' + encodeURIComponent(query);
    const raw = await _request(url, {
      headers: {
        'User-Agent': 'Carminium/1.0 (https://github.com/ProjectCarminium)',
        'Accept': 'application/json',
      },
    });
    const results = JSON.parse(raw);
    if (!Array.isArray(results)) {
      return JSON.stringify({ songs: [], error: null });
    }
    const songs = results.map((r) => {
      const songId = String(r.id);
      if (r.syncedLyrics || r.plainLyrics) {
        _fetchCache.set('lrclib:' + songId, {
          lyrics: r.syncedLyrics || r.plainLyrics || '',
          has_translation: false,
          has_romaji: false,
        });
      }
      return {
        id: songId,
        name: r.trackName || '',
        artist: r.artistName || '',
        album: r.albumName || '',
        duration: (r.duration || 0) * 1000,
      };
    });
    return JSON.stringify({ songs, error: null });
  } catch (e) {
    return JSON.stringify({ songs: [], error: String(e) });
  }
}

async function fetchLrclibLyrics(songId) {
  try {
    const cached = _fetchCache.get('lrclib:' + String(songId));
    if (cached) {
      _fetchCache.delete('lrclib:' + String(songId));
      return JSON.stringify({ ...cached, error: null });
    }
    const url = LRCLIB_BASE + '/get/' + encodeURIComponent(songId);
    const raw = await _request(url, {
      headers: {
        'User-Agent': 'Carminium/1.0 (https://github.com/ProjectCarminium)',
        'Accept': 'application/json',
      },
    });
    const r = JSON.parse(raw);
    return JSON.stringify({
      lyrics: r.syncedLyrics || r.plainLyrics || '',
      has_translation: false,
      has_romaji: false,
      error: null,
    });
  } catch (e) {
    return JSON.stringify({
      lyrics: '',
      has_translation: false,
      has_romaji: false,
      error: String(e),
    });
  }
}


// ─── AMLL TTML DB（amll-dev/amll-ttml-db，AMLLDB）───────────────────────────
// 仓库按平台 ID 索引歌词：ncm-lyrics/<id>.ttml、qq-lyrics/<id>.ttml、
// apple-lyrics/<id>.ttml、spotify-lyrics/<id>.ttml；每个平台文件夹下有
// index.jsonl（逐行 JSON：id + metadata[musicName/artists/album] 等）。
// 检索 = 下载 index.jsonl 建本地索引（内存缓存 24h）；取词 = 按平台 ID 直取 TTML。
// 主链路 jsDelivr CDN（国内可达），回退 raw.githubusercontent，ncm 另有官方镜像站。

const AMLLDB_PLATFORMS = ['ncm', 'qq', 'apple', 'spotify'];
const AMLLDB_URL_JSDELIVR = 'https://cdn.jsdelivr.net/gh/amll-dev/amll-ttml-db@main/';
const AMLLDB_URL_RAW =
  'https://raw.githubusercontent.com/amll-dev/amll-ttml-db/main/';
const AMLLDB_URL_NCM_MIRROR = 'https://amll-ttml-db.stevexmh.net/ncm/';
const AMLLDB_INDEX_TTL = 24 * 3600 * 1000;
const AMLLDB_INDEX_FAIL_TTL = 10 * 60 * 1000;
const AMLLDB_UA = 'Carminium/1.0 (https://github.com/ProjectCarminium)';

const _amllIndex = { entries: null, loadedAt: 0, failedAt: 0, loading: null };

function _amllRequest(urlStr, accept) {
  return _request(urlStr, {
    headers: { 'User-Agent': AMLLDB_UA, 'Accept': accept || 'text/plain, */*' },
  });
}

async function _amllFetchTTML(platform, id) {
  const tries = [];
  if (platform === 'ncm') {
    tries.push(AMLLDB_URL_NCM_MIRROR + encodeURIComponent(id));
  }
  tries.push(
    AMLLDB_URL_JSDELIVR + platform + '-lyrics/' + encodeURIComponent(id) + '.ttml',
    AMLLDB_URL_RAW + platform + '-lyrics/' + encodeURIComponent(id) + '.ttml',
  );
  for (const url of tries) {
    try {
      const raw = await _amllRequest(url, 'application/xml, text/xml, text/plain, */*');
      if (raw && raw.indexOf('<tt') >= 0) return raw;
    } catch (e) {
      // 换下一个镜像
    }
  }
  return '';
}

async function _amllFetchIndex(platform) {
  const urls = [
    AMLLDB_URL_JSDELIVR + platform + '-lyrics/index.jsonl',
    AMLLDB_URL_RAW + platform + '-lyrics/index.jsonl',
  ];
  for (const url of urls) {
    try {
      const raw = await _amllRequest(url, 'application/x-ndjson, */*');
      if (raw) return raw;
    } catch (e) {
      // 换下一个源
    }
  }
  return '';
}

async function _loadAmllIndex() {
  const now = Date.now();
  if (_amllIndex.entries && now - _amllIndex.loadedAt < AMLLDB_INDEX_TTL) {
    return _amllIndex.entries;
  }
  if (_amllIndex.failedAt && now - _amllIndex.failedAt < AMLLDB_INDEX_FAIL_TTL) {
    return null;
  }
  if (!_amllIndex.loading) {
    _amllIndex.loading = (async () => {
      const entries = [];
      for (const platform of AMLLDB_PLATFORMS) {
        try {
          const raw = await _amllFetchIndex(platform);
          if (!raw) continue;
          for (const line of raw.split('\n')) {
            const s = line.trim();
            if (!s) continue;
            try {
              const o = JSON.parse(s);
              const md = {};
              for (const kv of o.metadata || []) md[kv[0]] = kv[1];
              const id = String(o.id || (md[platform + 'MusicId'] || [])[0] || '');
              if (!id) continue;
              entries.push({
                platform,
                id,
                name: (md.musicName || [])[0] || '',
                artists: md.artists || [],
                album: (md.album || [])[0] || '',
              });
            } catch (e) {
              // 单行坏数据忽略
            }
          }
        } catch (e) {
          // 单个平台拉取失败不阻塞其它平台
        }
      }
      if (entries.length > 0) {
        _amllIndex.entries = entries;
        _amllIndex.loadedAt = Date.now();
        _amllIndex.failedAt = 0;
      } else {
        _amllIndex.failedAt = Date.now();
      }
      _amllIndex.loading = null;
      return entries.length > 0 ? entries : null;
    })();
  }
  return _amllIndex.loading;
}

function _normAmll(s) {
  if (!s) return '';
  return s
    .toLowerCase()
    .replace(/[·・、，。！？：“”‘’”"（）()【】\[\]{}\-_/\\|《》<>`~!@#$%^&*+=?;:,'.\u3000]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const AMLLDB_PLATFORM_BONUS = { ncm: 6, qq: 3, apple: 1, spotify: 0 };

function _amllScoreTokens(hay, tokens) {
  // hay 中每个 token 被 query token 命中的比例（hay 为空返回 0）
  const hayTokens = hay.split(' ').filter((t) => t.length >= 2);
  if (hayTokens.length === 0) return 0;
  let hit = 0;
  for (const t of hayTokens) {
    if (tokens.indexOf(t) >= 0) hit++;
  }
  return hit / hayTokens.length;
}

async function searchAMLldb(query) {
  if (!query || !query.trim()) {
    return JSON.stringify({ songs: [], error: null });
  }
  try {
    const entries = await _loadAmllIndex();
    if (!entries) {
      return JSON.stringify({ songs: [], error: 'AMLL TTML DB index unavailable' });
    }
    const nq = _normAmll(query);
    if (!nq) return JSON.stringify({ songs: [], error: null });
    const qTokens = nq.split(' ');

    const scored = [];
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      const name = _normAmll(e.name);
      if (!name) continue;
      const artist = _normAmll(e.artists.join(' '));
      const album = _normAmll(e.album || '');

      let score = 0;
      if (name === nq) {
        score += 120;
      } else if (nq.indexOf(name) >= 0) {
        score += 80;
      } else if (name.indexOf(nq) >= 0) {
        score += 40;
      } else {
        score += _amllScoreTokens(name, qTokens) * 60;
      }
      if (score <= 0) continue;

      if (artist) {
        if (nq.indexOf(artist) >= 0) {
          score += 50;
        } else {
          score += _amllScoreTokens(artist, qTokens) * 30;
        }
      }
      if (album && nq.indexOf(album) >= 0) score += 10;

      score += AMLLDB_PLATFORM_BONUS[e.platform] || 0;
      score -= i * 0.001;
      scored.push({ e, score });
    }

    scored.sort((a, b) => b.score - a.score);
    const songs = scored.slice(0, 20).map(({ e }) => ({
      id: e.platform + ':' + e.id,
      name: e.name,
      artist: e.artists.join(', '),
      album: e.album,
      duration: 0,
    }));
    return JSON.stringify({ songs, error: null });
  } catch (e) {
    return JSON.stringify({ songs: [], error: String(e) });
  }
}

async function fetchAMLldbLyrics(songId) {
  try {
    const sid = String(songId);
    const colonIdx = sid.indexOf(':');
    const platform = colonIdx > 0 ? sid.slice(0, colonIdx) : '';
    const pid = colonIdx > 0 ? sid.slice(colonIdx + 1) : '';
    if (AMLLDB_PLATFORMS.indexOf(platform) < 0 || !pid) {
      return JSON.stringify({
        lyrics: '',
        has_translation: false,
        has_romaji: false,
        error: 'invalid AMLLDB id',
      });
    }
    const cached = _fetchCache.get('amll:' + sid);
    if (cached) {
      _fetchCache.delete('amll:' + sid);
      return JSON.stringify({ ...cached, error: null });
    }
    const ttml = await _amllFetchTTML(platform, pid);
    if (!ttml) {
      return JSON.stringify({
        lyrics: '',
        has_translation: false,
        has_romaji: false,
        error: 'not found',
      });
    }
    const conv = _ttmlToEnhancedLrc(ttml);
    return JSON.stringify({
      lyrics: conv.lrc,
      has_translation: conv.hasTranslation,
      has_romaji: conv.hasRoman,
      error: null,
    });
  } catch (e) {
    return JSON.stringify({
      lyrics: '',
      has_translation: false,
      has_romaji: false,
      error: String(e),
    });
  }
}

function _ttmlTimeToMs(timeStr) {
  if (!timeStr) return 0;
  const parts = timeStr.split(':');
  if (parts.length === 3) {
    const h = parseInt(parts[0], 10) || 0;
    const m = parseInt(parts[1], 10) || 0;
    const s = parseFloat(parts[2]) || 0;
    return h * 3600000 + m * 60000 + s * 1000;
  } else if (parts.length === 2) {
    const m = parseInt(parts[0], 10) || 0;
    const s = parseFloat(parts[1]) || 0;
    return m * 60000 + s * 1000;
  }
  return 0;
}

function _spanAttr(attrs, name) {
  const m = attrs.match(new RegExp('(?:^|\\s)' + name + '="([^"]*)"'));
  return m ? m[1] : '';
}

function _spanText(xml) {
  return (xml || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(parseInt(n, 10)));
}

// 提取顶层 <span> 节点（考虑嵌套），返回 [{ attrs, inner, gapBefore }]
// gapBefore = 该 span 与上一个 span 之间的原文——AMLL DB 有两种空格写法：
// 写在 span 内（<span> beat</span>）或写在 span 之间（</span> <span>），后者靠它保留
function _extractSpans(xml) {
  const spans = [];
  let prevEnd = 0;
  let idx = 0;
  while (idx < xml.length) {
    const openIdx = xml.indexOf('<span', idx);
    if (openIdx < 0) break;
    const tagEnd = xml.indexOf('>', openIdx);
    if (tagEnd < 0) break;
    const attrs = xml.slice(openIdx, tagEnd + 1);
    const gapBefore = xml.slice(prevEnd, openIdx);
    if (attrs.charAt(attrs.length - 2) === '/') {
      spans.push({ attrs, inner: '', gapBefore });
      idx = tagEnd + 1;
      prevEnd = idx;
      continue;
    }
    let depth = 1;
    let pos = tagEnd + 1;
    let closeIdx = -1;
    while (pos < xml.length) {
      const nextOpen = xml.indexOf('<span', pos);
      const nextClose = xml.indexOf('</span>', pos);
      if (nextClose < 0) break;
      if (nextOpen >= 0 && nextOpen < nextClose) {
        depth++;
        pos = xml.indexOf('>', nextOpen) + 1;
      } else {
        depth--;
        if (depth === 0) {
          closeIdx = nextClose;
          break;
        }
        pos = nextClose + 7;
      }
    }
    const inner = closeIdx >= 0 ? xml.slice(tagEnd + 1, closeIdx) : '';
    spans.push({ attrs, inner, gapBefore });
    idx = closeIdx >= 0 ? closeIdx + 7 : tagEnd + 1;
    prevEnd = idx;
  }
  return spans;
}

// 间隙里只保留真正的空格类字符（换行/缩进等格式化空白不算词间空格）
function _gapSpaces(gap) {
  return (gap || '').replace(/[^\t \u00a0]/g, '');
}

function _wordsToLrcLine(beginMs, words, endMs, prefix) {
  // prefix（[s:..]/[bg]）必须放在时间戳之后，否则会被 LRC 解析器当作头部丢弃
  let line = _formatTime(beginMs) + (prefix || '');
  for (const w of words) {
    line += _formatWordTime(w.t) + w.text;
  }
  line += _formatWordTime(endMs || beginMs);
  return line;
}

// 解析 <ttm:agent> 定义：xml:id → 显示名（full > abbreviated > role > xml:id）
function _parseTtmlAgents(ttmlText) {
  const agents = {};
  if (!ttmlText) return agents;
  const agentRe = /<ttm:agent\b([^>]*?)(?:\/>|>([\s\S]*?)<\/ttm:agent>)/gi;
  let m;
  while ((m = agentRe.exec(ttmlText)) !== null) {
    const attrs = m[1] || '';
    const inner = m[2] || '';
    const idM = attrs.match(/xml:id="([^"]*)"/);
    if (!idM) continue;
    let name = '';
    let bestRank = 0;
    const nameRe = /<ttm:name\b([^>]*)>([\s\S]*?)<\/ttm:name>/gi;
    let nm;
    while ((nm = nameRe.exec(inner)) !== null) {
      const type = ((nm[1].match(/type="([^"]*)"/) || [])[1]) || '';
      const text = _spanText(nm[2]).trim();
      if (!text) continue;
      const rank = type === 'full' ? 4 : type === 'abbreviated' ? 3 : type === 'role' ? 2 : 1;
      if (rank > bestRank) {
        bestRank = rank;
        name = text;
      }
    }
    if (!name) name = idM[1];
    agents[idM[1]] = name.replace(/[\[\]]/g, '');
  }
  return agents;
}

function _agentTag(agentIds, agents, multiAgent) {
  if (!multiAgent || !agentIds || !agentIds.length) return '';
  const name = agents[agentIds[0]];
  return name ? '[s:' + name + ']' : '';
}

function _trimEdgeWordSpace(words) {
  // 行首/行尾空白去掉（TTML 常在句首词带格式空格），行中保留（英文词间距）
  while (words.length > 0 && words[0].text.replace(/^\s+/, '') === '') {
    words.shift();
  }
  while (words.length > 0 && words[words.length - 1].text.replace(/\s+$/, '') === '') {
    words.pop();
  }
  if (words.length > 0) {
    words[0].text = words[0].text.replace(/^\s+/, '');
    words[words.length - 1].text = words[words.length - 1].text.replace(/\s+$/, '');
  }
}

// AMLL TTML → 增强 LRC
// - 逐词 <mm:ss.xx>；ttm:role="x-bg" 背景人声 → [bg] 标记行（含内嵌翻译/音译）
// - 对唱：解析 ttm:agent 定义，多歌手时行首加 [s:歌手名]
// - x-translation / x-roman → 同时间戳的翻译/音译行
function _ttmlToEnhancedLrc(ttmlText) {
  const result = { lrc: '', hasTranslation: false, hasRoman: false, isDuet: false };
  if (!ttmlText) return result;
  const agents = _parseTtmlAgents(ttmlText);

  // 统计全文档引用的 agent，≥2 才视为对唱（避免单歌手文件出现无意义标签）
  const seenAgents = new Set();
  const refRe = /\sttm:agent="([^"]*)"/g;
  let refM;
  while ((refM = refRe.exec(ttmlText)) !== null) {
    const ids = refM[1].trim().split(/\s+/).filter(Boolean);
    for (const id of ids) seenAgents.add(id);
  }
  const multiAgent = seenAgents.size >= 2;
  result.isDuet = multiAgent;

  const outLines = [];
  const pRegex = /<p\b([^>]*)>([\s\S]*?)<\/p>/gi;
  let match;
  while ((match = pRegex.exec(ttmlText)) !== null) {
    const attrs = match[1];
    const beginMs = _ttmlTimeToMs(_spanAttr(attrs, 'begin'));
    const endMs = _ttmlTimeToMs(_spanAttr(attrs, 'end')) || beginMs;
    const pAgentIds = _spanAttr(attrs, 'ttm:agent').trim().split(/\s+/).filter(Boolean);
    const singerTag = _agentTag(pAgentIds, agents, multiAgent);

    const words = [];
    const bgLines = [];
    let transText = '';
    let romanText = '';
    for (const sp of _extractSpans(match[2])) {
      const role = _spanAttr(sp.attrs, 'ttm:role');
      if (role.indexOf('x-translation') >= 0) {
        transText = _spanText(sp.inner).trim();
        if (transText) result.hasTranslation = true;
      } else if (role.indexOf('x-roman') >= 0) {
        romanText = _spanText(sp.inner).trim();
        if (romanText) result.hasRoman = true;
      } else if (role.indexOf('x-bg') >= 0) {
        // 背景人声：内部可嵌套逐词 span 与 bg 专属翻译/音译
        const bgBegin = _ttmlTimeToMs(_spanAttr(sp.attrs, 'begin')) || beginMs;
        const bgEnd = _ttmlTimeToMs(_spanAttr(sp.attrs, 'end')) || endMs;
        const bgAgentIds = _spanAttr(sp.attrs, 'ttm:agent').trim().split(/\s+/).filter(Boolean);
        const bgSingerTag = _agentTag(bgAgentIds, agents, multiAgent);
        const bgTag = '[bg]' + bgSingerTag;
        const bgWords = [];
        let bgTrans = '';
        let bgRoman = '';
        for (const bsp of _extractSpans(sp.inner)) {
          const bRole = _spanAttr(bsp.attrs, 'ttm:role');
          if (bRole.indexOf('x-translation') >= 0) {
            bgTrans = _spanText(bsp.inner).trim();
            if (bgTrans) result.hasTranslation = true;
          } else if (bRole.indexOf('x-roman') >= 0) {
            bgRoman = _spanText(bsp.inner).trim();
            if (bgRoman) result.hasRoman = true;
          } else {
            const t = _gapSpaces(bsp.gapBefore) + _spanText(bsp.inner);
            // 不 trim：词间空格可能写在 span 内或 span 之间，trim 会吞掉单词间距
            if (t !== '') {
              bgWords.push({
                t: _ttmlTimeToMs(_spanAttr(bsp.attrs, 'begin')) || bgBegin,
                text: t,
              });
            }
          }
        }
        _trimEdgeWordSpace(bgWords);
        if (bgWords.length > 0) {
          bgLines.push(_wordsToLrcLine(bgBegin, bgWords, bgEnd, bgTag));
        } else {
          const plain = _spanText(sp.inner).trim();
          if (plain) bgLines.push(_formatTime(bgBegin) + bgTag + plain);
        }
        if (bgRoman) bgLines.push(_formatTime(bgBegin) + bgTag + bgRoman);
        if (bgTrans) bgLines.push(_formatTime(bgBegin) + bgTag + bgTrans);
      } else {
        // 逐词 span（无 role 或非特殊 role）；不 trim，保留 span 内/span 之间的词间空格
        const t = _gapSpaces(sp.gapBefore) + _spanText(sp.inner);
        if (t !== '') {
          words.push({
            t: _ttmlTimeToMs(_spanAttr(sp.attrs, 'begin')) ||
              (words.length > 0 ? words[words.length - 1].t : beginMs),
            text: t,
          });
        }
      }
    }

    _trimEdgeWordSpace(words);

    if (words.length > 0) {
      outLines.push(_wordsToLrcLine(beginMs, words, endMs, singerTag));
    } else {
      // 无逐词信息的行：整行纯文本（剔除翻译/音译后）
      const plain = _spanText(match[2]).trim();
      if (plain && plain !== transText && plain !== romanText) {
        outLines.push(_formatTime(beginMs) + singerTag + plain);
      }
    }
    if (romanText) outLines.push(_formatTime(beginMs) + romanText);
    if (transText) outLines.push(_formatTime(beginMs) + transText);
    for (const bl of bgLines) outLines.push(bl);
  }
  result.lrc = outLines.join('\n');
  return result;
}


async function searchLyrics(query, source) {
  switch (source) {
    case 'ncm':
      return search(query);
    case 'qqmusic':
      return searchQQMusic(query);
    case 'lrclib':
      return searchLrclib(query);
    case 'amll':
      return searchAMLldb(query);
    default:
      return JSON.stringify({ songs: [], error: 'Unknown source: ' + source });
  }
}

async function fetchLyricsById(songId, source) {
  switch (source) {
    case 'ncm':
      return fetchLyrics(songId);
    case 'qqmusic':
      return fetchQQMusicLyrics(songId);
    case 'lrclib':
      return fetchLrclibLyrics(songId);
    case 'amll':
      return fetchAMLldbLyrics(songId);
    default:
      return JSON.stringify({
        lyrics: '',
        has_translation: false,
        has_romaji: false,
        error: 'Unknown source: ' + source,
      });
  }
}


function _formatWordTime(ms) {
  if (!isFinite(ms) || ms < 0) ms = 0;
  var totalSec = ms / 1000.0;
  var mm = Math.floor(totalSec / 60);
  var ss = totalSec % 60;
  var ssStr = ss.toFixed(2).padStart(5, '0');
  return '<' + String(mm).padStart(2, '0') + ':' + ssStr + '>';
}

function _yrcToEnhancedLrc(yrcText) {
  if (!yrcText || !yrcText.trim()) return '';

  var trimmed = yrcText.trim();

  if (trimmed.charAt(0) === '[' && trimmed.indexOf('"t"') >= 0) {
    try {
      var parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed) && parsed.length > 0 && parsed[0].t !== undefined) {
        return _yrcJsonToEnhancedLrc(parsed);
      }
    } catch (e) {
    }
  }

  return _yrcTextToEnhancedLrc(trimmed);
}

function _yrcTextToEnhancedLrc(yrcText) {
  var textLines = yrcText.split('\n');
  var outLines = [];

  var headerRe = /^\[(\d+),(\d+)\]/;
  var wordRe = /\((\d+),(\d+),\d*\)([^(\r\n]*)/g;

  for (var i = 0; i < textLines.length; i++) {
    var line = textLines[i].trim();
    if (!line) continue;

    var hMatch = line.match(headerRe);
    if (!hMatch) continue;

    var lineStart = parseInt(hMatch[1], 10);
    var lineDur = parseInt(hMatch[2], 10);
    var lineEnd = lineStart + lineDur;

    var content = line.substring(hMatch[0].length);
    wordRe.lastIndex = 0;
    var wMatch;
    var words = [];
    while ((wMatch = wordRe.exec(content)) !== null) {
      words.push({
        start: parseInt(wMatch[1], 10),
        text: wMatch[3] || '',
      });
    }

    if (words.length === 0) continue;

    var lrcLine = _formatTime(lineStart);
    for (var w = 0; w < words.length; w++) {
      lrcLine += _formatWordTime(words[w].start) + words[w].text;
    }
    lrcLine += _formatWordTime(lineEnd);
    outLines.push(lrcLine);
  }

  return outLines.join('\n');
}

function _yrcJsonToEnhancedLrc(yrcData) {
  if (!Array.isArray(yrcData)) return '';
  var outLines = [];

  for (var i = 0; i < yrcData.length; i++) {
    var lineObj = yrcData[i];
    var lineStart = parseInt(lineObj.t, 10);
    if (!isFinite(lineStart) || lineStart < 0) lineStart = 0;

    var wordArr = lineObj.c;
    if (!Array.isArray(wordArr) || wordArr.length === 0) continue;

    var lrcLine = _formatTime(lineStart);
    var lineEnd = lineStart;

    for (var w = 0; w < wordArr.length; w++) {
      var wordObj = wordArr[w];
      var offset = parseInt(wordObj.li, 10) || 0;
      var wordStart = lineStart + offset;
      var text = wordObj.tx || '';
      lrcLine += _formatWordTime(wordStart) + text;

      var dur = parseInt(wordObj.or, 10) || 0;
      if (dur > 0) {
        lineEnd = Math.max(lineEnd, wordStart + dur);
      } else {
        lineEnd = Math.max(lineEnd, wordStart);
      }
    }

    lrcLine += _formatWordTime(lineEnd);
    outLines.push(lrcLine);
  }

  return outLines.join('\n');
}


function _parseLrc(lrcText) {
  if (!lrcText) return [];
  const entries = [];
  const WORD_TIME_RE = /<\d{2}:\d{2}[\.:]\d{2,3}>/g;
  for (const line of lrcText.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const times = [];
    let lastIdx = 0;
    TIME_RE.lastIndex = 0;
    let m;
    while ((m = TIME_RE.exec(trimmed)) !== null) {
      const mm = parseInt(m[1], 10);
      const ss = parseInt(m[2], 10);
      let cs = 0;
      if (m[3] !== undefined) {
        cs = parseInt(m[3], 10);
        if (m[3].length === 2) cs *= 10;
      }
      times.push(mm * 60000 + ss * 1000 + cs);
      lastIdx = m.index + m[0].length;
    }
    if (times.length > 0) {
      const rawText = trimmed.slice(lastIdx).trim();
      const plainText = rawText.replace(WORD_TIME_RE, '');
      for (const t of times) {
        entries.push([t, plainText, rawText]);
      }
    }
  }
  entries.sort((a, b) => a[0] - b[0]);
  return entries;
}

function _findClosest(entries, targetTime, tolerance = 1000) {
  let best = null;
  let bestDiff = tolerance;
  for (const entry of entries) {
    const t = entry[0];
    const text = entry[1];
    const diff = Math.abs(t - targetTime);
    if (diff <= bestDiff) {
      bestDiff = diff;
      best = text;
    }
  }
  return best;
}

function _findClosestRaw(entries, targetTime, tolerance = 1000) {
  let best = null;
  let bestDiff = tolerance;
  for (const entry of entries) {
    const t = entry[0];
    const rawText = entry[2];
    const diff = Math.abs(t - targetTime);
    if (diff <= bestDiff) {
      bestDiff = diff;
      best = rawText;
    }
  }
  return best;
}

function _formatTime(ms) {
  const totalSec = ms / 1000.0;
  const mm = Math.floor(totalSec / 60);
  const ss = totalSec % 60;
  const ssStr = ss.toFixed(2).padStart(5, '0');
  return `[${String(mm).padStart(2, '0')}:${ssStr}]`;
}

function _combineLrc(original, romaji, translation) {
  const origEntries = _parseLrc(original);
  if (origEntries.length === 0) return original;

  const romajiEntries = romaji ? _parseLrc(romaji) : [];
  const transEntries = translation ? _parseLrc(translation) : [];

  const lines = [];
  for (const entry of origEntries) {
    const timeMs = entry[0];
    const plainText = entry[1];
    const rawText = entry[2];
    if (!plainText) continue;
    lines.push(`${_formatTime(timeMs)}${rawText}`);

    const romajiText = romajiEntries.length > 0 ? _findClosestRaw(romajiEntries, timeMs) : null;
    let transText = transEntries.length > 0 ? _findClosest(transEntries, timeMs) : null;
    if (transText && transText.indexOf('QQ音乐享有本翻译作品') !== -1) transText = null;

    if (romajiText && transText) {
      lines.push(`${_formatTime(timeMs)}${romajiText}`);
      lines.push(`${_formatTime(timeMs)}${transText}`);
    } else if (transText) {
      lines.push(`${_formatTime(timeMs)}${transText}`);
    } else if (romajiText) {
      lines.push(`${_formatTime(timeMs)}${romajiText}`);
      lines.push(`${_formatTime(timeMs)}`);
    }
  }
  return lines.join('\n');
}

module.exports = {
  search,
  fetchLyrics,
  searchLyrics,
  fetchLyricsById,
  searchQQMusic,
  fetchQQMusicLyrics,
  searchLrclib,
  fetchLrclibLyrics,
  searchAMLldb,
  fetchAMLldbLyrics,
  ttmlToEnhancedLrc: _ttmlToEnhancedLrc,
};
