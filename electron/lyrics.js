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
      let data = '';
      resp.on('data', (chunk) => (data += chunk));
      resp.on('end', () => resolve(data));
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


const AMLLDB_RAW_BASE =
  'https://raw.githubusercontent.com/Steve-xmh/amll-ttml-db/main/raw/';

function _normalizeAmllFilename(str) {
  return str
    .replace(/[/\\:*?"<>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
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

function _msToLrcTime(ms) {
  const totalSec = ms / 1000.0;
  const mm = Math.floor(totalSec / 60);
  const ss = totalSec % 60;
  const ssStr = ss.toFixed(2).padStart(5, '0');
  return '[' + String(mm).padStart(2, '0') + ':' + ssStr + ']';
}

function _ttmlToLrc(ttmlText) {
  if (!ttmlText) return '';
  const lines = [];
  const pRegex = /<p\s+[^>]*?begin="([^"]*)"[^>]*>([\s\S]*?)<\/p>/gi;
  let match;
  while ((match = pRegex.exec(ttmlText)) !== null) {
    const beginMs = _ttmlTimeToMs(match[1]);
    const text = match[2]
      .replace(/<br\s*\/?>(?:\s*<\/br>)?/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .trim();
    if (text) {
      const subLines = text.split('\n');
      for (const sl of subLines) {
        const trimmed = sl.trim();
        if (trimmed) {
          lines.push(_msToLrcTime(beginMs) + trimmed);
        }
      }
    }
  }
  return lines.join('\n');
}

async function searchAMLldb(query) {
  if (!query || !query.trim()) {
    return JSON.stringify({ songs: [], error: null });
  }
  try {
    const filename = _normalizeAmllFilename(query) + '.ttml';
    const url = AMLLDB_RAW_BASE + encodeURIComponent(filename);

    const raw = await _request(url, {
      headers: {
        'User-Agent': 'Carminium/1.0 (https://github.com/ProjectCarminium)',
        'Accept': 'text/plain, */*',
      },
    });

    if (!raw || raw.length < 10 || raw.indexOf('<tt') < 0) {
      return JSON.stringify({ songs: [], error: null });
    }

    const lrc = _ttmlToLrc(raw);
    if (!lrc) {
      return JSON.stringify({ songs: [], error: null });
    }

    let artist = '';
    let title = query.trim();
    const dashIdx = query.indexOf(' - ');
    if (dashIdx > 0) {
      artist = query.substring(0, dashIdx).trim();
      title = query.substring(dashIdx + 3).trim();
    }

    const songId = filename;
    _fetchCache.set('amll:' + songId, {
      lyrics: lrc,
      has_translation: false,
      has_romaji: false,
    });

    const songs = [{
      id: songId,
      name: title,
      artist: artist,
      album: '',
      duration: 0,
    }];
    return JSON.stringify({ songs, error: null });
  } catch (e) {
    return JSON.stringify({ songs: [], error: null });
  }
}

async function fetchAMLldbLyrics(filename) {
  try {
    const cached = _fetchCache.get('amll:' + String(filename));
    if (cached) {
      _fetchCache.delete('amll:' + String(filename));
      return JSON.stringify({ ...cached, error: null });
    }
    const url = AMLLDB_RAW_BASE + encodeURIComponent(String(filename));
    const raw = await _request(url, {
      headers: {
        'User-Agent': 'Carminium/1.0 (https://github.com/ProjectCarminium)',
        'Accept': 'text/plain, */*',
      },
    });
    if (!raw || raw.indexOf('<tt') < 0) {
      return JSON.stringify({
        lyrics: '',
        has_translation: false,
        has_romaji: false,
        error: 'not found',
      });
    }
    const lrc = _ttmlToLrc(raw);
    return JSON.stringify({
      lyrics: lrc,
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
  ttmlToLrc: _ttmlToLrc,
};
