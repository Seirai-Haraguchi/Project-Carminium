/**
 * Carminium — 歌词搜索提供者（网易云音乐）
 * 从网易云音乐搜索歌曲并获取歌词（含翻译和罗马音）。
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

// ── HTTP 辅助 ────────────────────────────────────────────────────────────────

function _request(urlStr, { method = 'GET', body = null } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const lib = url.protocol === 'https:' ? https : http;
    const opts = {
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search,
      method,
      headers: { ...HEADERS },
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

// ── 公开 API ──────────────────────────────────────────────────────────────────

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

module.exports = { search, fetchLyrics };
