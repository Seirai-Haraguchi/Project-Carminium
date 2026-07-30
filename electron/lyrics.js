/**
 * Carminium — 歌词搜索提供者（多平台）
 * 支持网易云音乐、QQ音乐、lrclib、AMLLDB。
 */
'use strict';

const https = require('https');
const http = require('http');
const { URL } = require('url');

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
const TIMEOUT = 8000; // ms

const TIME_RE = /\[(\d{2}):(\d{2})[\.:](\d{2,3})\]/g;

// 搜索结果缓存：用于 lrclib/AMLLDB 等在搜索时已返回歌词的平台
// key: `${source}:${songId}` → { lyrics, has_translation, has_romaji }
const _fetchCache = new Map();

// ── HTTP 辅助 ────────────────────────────────────────────────────────────────

function _request(urlStr, { method = 'GET', body = null, headers = null } = {}) {
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
      opts.headers['Content-Type'] = 'application/x-www-form-urlencoded';
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

// ── 网易云音乐 ────────────────────────────────────────────────────────────────

/**
 * 搜索网易云音乐歌曲，返回 JSON 字符串。
 * @param {string} query
 * @returns {Promise<string>}
 */
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

/**
 * 获取歌曲歌词（含翻译和罗马音），返回 JSON 字符串。
 * @param {number|string} songId
 * @returns {Promise<string>}
 */
async function fetchLyrics(songId) {
  try {
    const sid = String(songId);
    const url = LYRIC_URL + '?id=' + sid + '&lv=1&kv=1&tv=-1';
    const raw = await _request(url);
    const result = JSON.parse(raw);

    const lrc = result.lrc?.lyric || '';
    const tlyric = result.tlyric?.lyric || '';
    const romalrc = result.romalrc?.lyric || '';
    const combined = _combineLrc(lrc, romalrc, tlyric);

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

// ── QQ音乐 ────────────────────────────────────────────────────────────────────

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
    // QQ音乐可能返回 JSONP 包装，去除 callback
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
    // QQ音乐通常没有罗马音
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

// ── lrclib ────────────────────────────────────────────────────────────────────

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
      // 缓存歌词供 fetch 步骤使用
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
    // 先检查缓存
    const cached = _fetchCache.get('lrclib:' + String(songId));
    if (cached) {
      _fetchCache.delete('lrclib:' + String(songId));
      return JSON.stringify({ ...cached, error: null });
    }
    // 缓存未命中：通过 get 接口获取
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

// ── AMLLDB (AMLL TTML Database) ────────────────────────────────────────────────

const AMLLDB_RAW_BASE =
  'https://raw.githubusercontent.com/Steve-xmh/amll-ttml-db/main/raw/';

/**
 * 规范化文件名：去除文件系统非法字符
 */
function _normalizeAmllFilename(str) {
  return str
    .replace(/[/\\:*?"<>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 将 TTML 时间格式转换为毫秒
 * 支持 HH:MM:SS.mmm / HH:MM:SS.mm / HH:MM:SS
 */
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

/**
 * 将毫秒转换为 LRC 时间戳 [MM:SS.xx]
 */
function _msToLrcTime(ms) {
  const totalSec = ms / 1000.0;
  const mm = Math.floor(totalSec / 60);
  const ss = totalSec % 60;
  const ssStr = ss.toFixed(2).padStart(5, '0');
  return '[' + String(mm).padStart(2, '0') + ':' + ssStr + ']';
}

/**
 * 将 TTML 格式歌词转换为 LRC 格式
 * 提取 <p> 标签的 begin 时间和文本内容
 */
function _ttmlToLrc(ttmlText) {
  if (!ttmlText) return '';
  const lines = [];
  // 匹配 <p begin="..." end="...">text</p>（含跨行）
  const pRegex = /<p\s+[^>]*?begin="([^"]*)"[^>]*>([\s\S]*?)<\/p>/gi;
  let match;
  while ((match = pRegex.exec(ttmlText)) !== null) {
    const beginMs = _ttmlTimeToMs(match[1]);
    // 去除内部所有标签（如 <span>），保留纯文本
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
      // 处理多行文本
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
    // AMLLDB 无搜索 API，直接构造文件名尝试获取
    // 文件名格式：{artist} - {title}.ttml
    const filename = _normalizeAmllFilename(query) + '.ttml';
    const url = AMLLDB_RAW_BASE + encodeURIComponent(filename);

    const raw = await _request(url, {
      headers: {
        'User-Agent': 'Carminium/1.0 (https://github.com/ProjectCarminium)',
        'Accept': 'text/plain, */*',
      },
    });

    // 如果返回内容包含 TTML 标签，说明找到了
    if (!raw || raw.length < 10 || raw.indexOf('<tt') < 0) {
      return JSON.stringify({ songs: [], error: null });
    }

    const lrc = _ttmlToLrc(raw);
    if (!lrc) {
      return JSON.stringify({ songs: [], error: null });
    }

    // 解析 artist 和 title（从 query 中按 " - " 分割）
    let artist = '';
    let title = query.trim();
    const dashIdx = query.indexOf(' - ');
    if (dashIdx > 0) {
      artist = query.substring(0, dashIdx).trim();
      title = query.substring(dashIdx + 3).trim();
    }

    const songId = filename;
    // 缓存歌词
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
    // 404 等错误视为未找到
    return JSON.stringify({ songs: [], error: null });
  }
}

async function fetchAMLldbLyrics(filename) {
  try {
    // 先检查缓存
    const cached = _fetchCache.get('amll:' + String(filename));
    if (cached) {
      _fetchCache.delete('amll:' + String(filename));
      return JSON.stringify({ ...cached, error: null });
    }
    // 缓存未命中：重新获取
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

// ── 统一 API ──────────────────────────────────────────────────────────────────

/**
 * 统一歌词搜索接口。根据 source 分发到对应平台。
 * @param {string} query - 搜索关键词
 * @param {string} source - 'ncm' | 'qqmusic' | 'lrclib' | 'amll'
 * @returns {Promise<string>} JSON 字符串 { songs: [...], error: null }
 */
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

/**
 * 统一歌词获取接口。根据 source 分发到对应平台。
 * @param {string|number} songId - 平台特定的歌曲 ID
 * @param {string} source - 'ncm' | 'qqmusic' | 'lrclib' | 'amll'
 * @returns {Promise<string>} JSON 字符串 { lyrics, has_translation, has_romaji, error }
 */
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

// ── LRC 合并逻辑 ──────────────────────────────────────────────────────────────

function _parseLrc(lrcText) {
  if (!lrcText) return [];
  const entries = [];
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
      let cs = parseInt(m[3], 10);
      if (m[3].length === 2) cs *= 10;
      times.push(mm * 60000 + ss * 1000 + cs);
      lastIdx = m.index + m[0].length;
    }
    if (times.length > 0) {
      const text = trimmed.slice(lastIdx).trim();
      for (const t of times) {
        entries.push([t, text]);
      }
    }
  }
  entries.sort((a, b) => a[0] - b[0]);
  return entries;
}

function _findClosest(entries, targetTime, tolerance = 1000) {
  let best = null;
  let bestDiff = tolerance;
  for (const [t, text] of entries) {
    const diff = Math.abs(t - targetTime);
    if (diff <= bestDiff) {
      bestDiff = diff;
      best = text;
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
  for (const [timeMs, text] of origEntries) {
    if (!text) continue;
    lines.push(`${_formatTime(timeMs)}${text}`);

    const romajiText = romajiEntries.length > 0 ? _findClosest(romajiEntries, timeMs) : null;
    const transText = transEntries.length > 0 ? _findClosest(transEntries, timeMs) : null;

    if (romajiText && transText) {
      lines.push(`${_formatTime(timeMs)}${romajiText}`);
      lines.push(`${_formatTime(timeMs)}${transText}`);
    } else if (transText) {
      lines.push(`${_formatTime(timeMs)}${transText}`);
    } else if (romajiText) {
      lines.push(`${_formatTime(timeMs)}${romajiText}`);
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
