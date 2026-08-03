/**
 * Carminium — Subsonic / OpenSubsonic API 客户端
 *
 * 实现 Subsonic API 1.16 与 OpenSubsonic 扩展的子集。
 * 认证方式：salt + token-md5
 */
'use strict';

const crypto = require('crypto');
const https = require('https');
const http = require('http');
const zlib = require('zlib');
const { URL } = require('url');
const os = require('os');

const CLIENT_NAME = 'Carminium';

// Subsonic API error code → 含义
const ERROR_CODES = {
  0: 'generic error',
  10: 'missing required parameter',
  20: 'incompatible Subsonic protocol version',
  30: 'wrong username or password',
  40: 'token authentication not supported for this user',
  41: 'user not authorized for this operation',
  50: 'trial period over',
  60: 'requested data not found',
  70: 'requested method not available',
};

class SubsonicError extends Error {
  constructor(code, message) {
    super(code !== null && code !== undefined ? `[${code}] ${message}` : message);
    this.code = code;
    this.message = message;
  }
}

// ── HTTP 请求辅助 ────────────────────────────────────────────────────────────

function _decompressBody(body, encoding) {
  if (!encoding) return body;
  const enc = encoding.toLowerCase().trim();
  try {
    if (enc.includes('gzip')) return zlib.gunzipSync(body);
    if (enc.includes('deflate')) {
      try { return zlib.inflateSync(body); }
      catch { return zlib.inflateRawSync(body); }
    }
    if (enc.includes('br')) return zlib.brotliDecompressSync(body);
  } catch (e) {
    throw new SubsonicError(null, `解压响应失败 (encoding=${enc}): ${e}`);
  }
  return body;
}

async function _httpRequest(urlStr, timeout, maxRedirects = 5) {
  let currentUrl = urlStr;
  for (let redirect = 0; redirect <= maxRedirects; redirect++) {
    const url = new URL(currentUrl);
    const lib = url.protocol === 'https:' ? https : http;
    const tlsOpts = url.protocol === 'https:' ? {
      rejectUnauthorized: false,
    } : {};
    const result = await new Promise((resolve, reject) => {
      const req = lib.request(
        {
          hostname: url.hostname,
          port: url.port || (url.protocol === 'https:' ? 443 : 80),
          path: url.pathname + url.search,
          method: 'GET',
          headers: {
            Accept: 'application/json',
            'Accept-Encoding': 'identity',
            'User-Agent': `${CLIENT_NAME}/1.0`,
          },
          ...tlsOpts,
        },
        (resp) => {
          const chunks = [];
          resp.on('data', (chunk) => chunks.push(chunk));
          resp.on('end', () => {
            resolve({
              body: Buffer.concat(chunks),
              statusCode: resp.statusCode,
              headers: resp.headers,
            });
          });
        }
      );
      req.on('error', reject);
      req.setTimeout(Math.round(timeout * 1000), () => {
        req.destroy(new Error('timeout'));
      });
      req.end();
    });
    const { body, statusCode, headers } = result;
    // Follow redirects (301, 302, 303, 307, 308)
    if ([301, 302, 303, 307, 308].includes(statusCode) && headers.location) {
      let newUrl = headers.location;
      if (newUrl.startsWith('/')) {
        newUrl = url.protocol + '//' + url.host + newUrl;
      } else if (!newUrl.startsWith('http://') && !newUrl.startsWith('https://')) {
        newUrl = new URL(newUrl, currentUrl).href;
      }
      console.warn('[subsonic] Redirecting', statusCode, 'to', newUrl.substring(0, 80));
      currentUrl = newUrl;
      continue;
    }
    return { body, statusCode, headers };
  }
  throw new Error('too many redirects');
}

async function _httpRequestBinary(urlStr, timeout, maxRedirects = 5) {
  let currentUrl = urlStr;
  for (let redirect = 0; redirect <= maxRedirects; redirect++) {
    const url = new URL(currentUrl);
    const lib = url.protocol === 'https:' ? https : http;
    const tlsOpts = url.protocol === 'https:' ? {
      rejectUnauthorized: false,
    } : {};
    const result = await new Promise((resolve, reject) => {
      const req = lib.request(
        {
          hostname: url.hostname,
          port: url.port || (url.protocol === 'https:' ? 443 : 80),
          path: url.pathname + url.search,
          method: 'GET',
          headers: {
            'Accept-Encoding': 'identity',
            'User-Agent': `${CLIENT_NAME}/1.0`,
          },
          ...tlsOpts,
        },
        (resp) => {
          const chunks = [];
          resp.on('data', (chunk) => chunks.push(chunk));
          resp.on('end', () => {
            resolve({
              body: Buffer.concat(chunks),
              statusCode: resp.statusCode,
              headers: resp.headers,
            });
          });
        }
      );
      req.on('error', reject);
      req.setTimeout(Math.round(timeout * 1000), () => {
        req.destroy(new Error('timeout'));
      });
      req.end();
    });
    const { body, statusCode, headers } = result;
    // Follow redirects (301, 302, 303, 307, 308)
    if ([301, 302, 303, 307, 308].includes(statusCode) && headers.location) {
      let newUrl = headers.location;
      if (newUrl.startsWith('/')) {
        newUrl = url.protocol + '//' + url.host + newUrl;
      } else if (!newUrl.startsWith('http://') && !newUrl.startsWith('https://')) {
        newUrl = new URL(newUrl, currentUrl).href;
      }
      console.warn('[subsonic] Binary redirecting', statusCode, 'to', newUrl.substring(0, 80));
      currentUrl = newUrl;
      continue;
    }
    return { body, statusCode, headers };
  }
  throw new Error('too many redirects');
}

// ── SubsonicClient ───────────────────────────────────────────────────────────

class SubsonicClient {
  /**
   * @param {string} serverUrl
   * @param {string} username
   * @param {string} password
   * @param {string} protocolMode - "subsonic" | "opensubsonic"
   * @param {number} timeout - seconds
   */
  constructor(serverUrl, username, password, protocolMode = 'subsonic', timeout = 20.0) {
    let base = serverUrl.replace(/\/+$/, '');
    if (!base.startsWith('http://') && !base.startsWith('https://')) {
      base = 'http://' + base;
    }
    if (base.endsWith('/rest')) {
      this._base = base;
    } else {
      this._base = base + '/rest';
    }
    this._username = username;
    this._password = password;
    this._protocolMode = protocolMode === 'opensubsonic' ? 'opensubsonic' : 'subsonic';
    this._timeout = timeout;
    this._apiVersion = '1.16.1';
    this._downgradedToHttp = false;
    this._usePlainPassword = false;
  }

  _makeAuthParams() {
    const params = {
      u: this._username,
      v: this._apiVersion,
      c: CLIENT_NAME,
      f: this._protocolMode === 'opensubsonic' ? 'openSubsonic' : 'json',
    };
    if (this._usePlainPassword) {
      // 降级：使用明文密码（某些旧服务器不支持 token 认证）
      params.p = this._password;
    } else {
      const salt = Array.from(crypto.randomBytes(6), (b) =>
        'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'[b % 62]
      ).join('');
      const token = crypto
        .createHash('md5')
        .update(this._password + salt, 'utf-8')
        .digest('hex');
      params.t = token;
      params.s = salt;
    }
    return params;
  }

  _buildUrl(endpoint, params = null) {
    const allParams = this._makeAuthParams();
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        if (v === null || v === undefined) continue;
        if (Array.isArray(v)) {
          allParams[k] = v.map(String);
        } else {
          allParams[k] = typeof v === 'boolean' ? (v ? 'true' : 'false') : String(v);
        }
      }
    }
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(allParams)) {
      if (Array.isArray(v)) {
        for (const item of v) qs.append(k, item);
      } else {
        qs.append(k, v);
      }
    }
    return `${this._base}/${endpoint}.view?${qs.toString()}`;
  }

  async _request(endpoint, params = null) {
    let url = this._buildUrl(endpoint, params);
    // 如果之前已降级到 HTTP，直接使用 HTTP
    if (this._downgradedToHttp && url.startsWith('https://')) {
      url = 'http://' + url.slice(8);
    }
    let lastError = null;

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const { body, statusCode, headers } = await _httpRequest(url, this._timeout);
        if (statusCode >= 400) {
          // 尝试解析响应体中的 Subsonic 错误信息
          let errBody = '';
          try { errBody = body.toString('utf-8').slice(0, 500); } catch {}
          console.error('[subsonic] HTTP', statusCode, 'for', endpoint, '- body:', errBody);
          // 403/401 可能是认证方式不兼容，尝试降级到明文密码
          if ((statusCode === 403 || statusCode === 401) && !this._usePlainPassword) {
            this._usePlainPassword = true;
            console.warn('[subsonic] Auth failed (' + statusCode + '), retrying with plain password');
            url = this._buildUrl(endpoint, params);
            if (this._downgradedToHttp && url.startsWith('https://')) {
              url = 'http://' + url.slice(8);
            }
            attempt = -1;
            continue;
          }
          // 尝试解析 JSON 错误
          try {
            const parsed = JSON.parse(body.toString('utf-8'));
            const response = parsed['subsonic-response'] || parsed;
            if (response.error) {
              throw new SubsonicError(response.error.code, response.error.message || ERROR_CODES[response.error.code] || 'unknown error');
            }
          } catch (parseErr) {
            if (parseErr instanceof SubsonicError) throw parseErr;
          }
          throw new SubsonicError(statusCode, `HTTP ${statusCode}: ${errBody.slice(0, 200)}`);
        }
        if (!body || body.length === 0) {
          console.error('[subsonic] Empty response for', endpoint, '- status:', statusCode, 'headers:', JSON.stringify(headers), 'url:', url.substring(0, 100));
          throw new SubsonicError(null, `空响应 (status=${statusCode}, content-type=${headers['content-type'] || 'none'})`);
        }

        let data = body;
        const contentEncoding = headers['content-encoding'];
        if (contentEncoding) {
          data = _decompressBody(data, contentEncoding);
        }

        // 去除 UTF-8 BOM
        if (data[0] === 0xef && data[1] === 0xbb && data[2] === 0xbf) {
          data = data.slice(3);
        }

        let parsed;
        try {
          parsed = JSON.parse(data.toString('utf-8'));
        } catch (e) {
          const snippet = data.slice(0, 200).toString('utf-8');
          throw new SubsonicError(
            null,
            `非 JSON 响应 (Content-Encoding=${contentEncoding}, len=${data.length}): ${snippet}`
          );
        }

        const response = parsed['subsonic-response'] || parsed;
        if (response.status !== 'ok') {
          const err = response.error || {};
          const code = err.code;
          const msg = err.message || ERROR_CODES[code] || 'unknown error';
          throw new SubsonicError(code, msg);
        }
        return response;
      } catch (e) {
        if (e instanceof SubsonicError) throw e;
        lastError = e;
        // 连接失败时（包括 TLS 揦手失败、连接被拒绝等），自动降级 HTTPS → HTTP
        const isConnError = /TLS|socket|ECONNRESET|ECONNREFUSED|EPROTO|disconnected|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH/i.test(e.message || '');
        if (url.startsWith('https://') && isConnError && !this._downgradedToHttp) {
          this._downgradedToHttp = true;
          url = 'http://' + url.slice(8);
          console.warn('[subsonic] HTTPS connection failed, falling back to HTTP:', e.message);
          attempt = -1;
          continue;
        }
        if (attempt < 2) {
          await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
          continue;
        }
        throw new SubsonicError(null, `网络错误: ${e.message || e}`);
      }
    }
    throw new SubsonicError(null, `网络错误: ${lastError?.message || '未知错误'}`);
  }

  // ── 公开 API ────────────────────────────────────────────────────────────

  async ping() {
    return this._request('ping');
  }

  async getArtists() {
    const resp = await this._request('getArtists');
    const artistsRoot = resp.artists || {};
    let indexes = artistsRoot.index || [];
    if (!Array.isArray(indexes)) indexes = [indexes];
    const artists = [];
    for (const idx of indexes) {
      if (!idx || typeof idx !== 'object') continue;
      let artistList = idx.artist || idx.artists || [];
      if (!Array.isArray(artistList)) artistList = [artistList];
      for (const a of artistList) {
        if (!a || typeof a !== 'object') continue;
        artists.push({
          id: a.id,
          name: a.name || '未知艺术家',
          cover_art_id: a.coverArt || a.artistImageUrl,
          album_count: parseInt(a.albumCount || '0', 10),
        });
      }
    }
    return artists;
  }

  async getAlbumList(ltype = 'newest', size = 100, offset = 0) {
    const params = {
      type: ltype,
      size: Math.max(1, Math.min(500, parseInt(size, 10))),
      offset: parseInt(offset, 10),
    };
    const resp = await this._request('getAlbumList2', params);
    const albumsRaw = resp.albumList2?.album || [];
    return albumsRaw.map((a) => this._parseAlbum(a));
  }

  async getAlbum(albumId) {
    const resp = await this._request('getAlbum', { id: albumId });
    const albumRaw = resp.album || {};
    const album = this._parseAlbum(albumRaw);
    const songsRaw = albumRaw.song || albumRaw.songs || [];
    album.tracks = songsRaw.map((s) => this._parseSong(s));
    return album;
  }

  async getArtist(artistId) {
    const resp = await this._request('getArtist', { id: artistId });
    const artistRaw = resp.artist || {};
    const albumsRaw = artistRaw.album || artistRaw.albums || [];
    return {
      id: artistRaw.id,
      name: artistRaw.name || '未知艺术家',
      cover_art_id: artistRaw.coverArt,
      albums: albumsRaw.map((a) => this._parseAlbum(a)),
    };
  }

  async search3(query, artistCount = 20, albumCount = 30, songCount = 50) {
    const params = {
      query,
      artistCount: Math.max(0, parseInt(artistCount, 10)),
      albumCount: Math.max(0, parseInt(albumCount, 10)),
      songCount: Math.max(0, parseInt(songCount, 10)),
    };
    const resp = await this._request('search3', params);
    const result = resp.searchResult3 || {};
    return {
      artists: (result.artist || []).map((a) => ({
        id: a.id,
        name: a.name || '未知艺术家',
        cover_art_id: a.coverArt || a.artistImageUrl,
        album_count: parseInt(a.albumCount || '0', 10),
      })),
      albums: (result.album || []).map((a) => this._parseAlbum(a)),
      songs: (result.song || []).map((s) => this._parseSong(s)),
    };
  }

  async getPlaylists() {
    const resp = await this._request('getPlaylists');
    const playlistsRaw = resp.playlists?.playlist || [];
    return playlistsRaw.map((p) => ({
      id: p.id,
      name: p.name || '未命名',
      song_count: parseInt(p.songCount || '0', 10),
      duration: parseInt(p.duration || '0', 10) * 1000,
      owner: p.owner,
      public: !!p.public,
      created: p.created,
      changed: p.changed,
      cover_art_id: p.coverArt || null,
      comment: p.comment || null,
    }));
  }

  async getPlaylist(playlistId) {
    let resp;
    try {
      resp = await this._request('getPlaylist', { id: playlistId });
    } catch (e) {
      // 空响应时，尝试不带 f=json 参数（某些服务器对此端点有 bug）
      if (/空响应/.test(e.message || '')) {
        console.warn('[subsonic] getPlaylist returned empty, retrying without f=json');
        const url = this._buildUrl('getPlaylist', { id: playlistId });
        let httpUrl = url;
        if (this._downgradedToHttp && httpUrl.startsWith('https://')) {
          httpUrl = 'http://' + httpUrl.slice(8);
        }
        // 去掉 f=json 参数，让服务器返回默认格式
        httpUrl = httpUrl.replace(/&f=[^&]*/, '');
        const { body, statusCode, headers } = await _httpRequest(httpUrl, this._timeout);
        if (!body || body.length === 0) {
          throw new SubsonicError(null, `getPlaylist 空响应 (status=${statusCode})`);
        }
        let data = body;
        const contentEncoding = headers['content-encoding'];
        if (contentEncoding) {
          data = _decompressBody(data, contentEncoding);
        }
        const text = data.toString('utf-8').trim();
        // 尝试 JSON 解析
        try {
          const parsed = JSON.parse(text);
          resp = parsed['subsonic-response'] || parsed;
        } catch {
          // 如果是 XML，用正则提取基本字段
          console.warn('[subsonic] getPlaylist returned XML, parsing manually');
          const nameMatch = text.match(/<playlist[^>]*name="([^"]*)"/);
          const entries = text.match(/<entry[^>]*>/g) || [];
          resp = {
            playlist: {
              id: playlistId,
              name: nameMatch ? nameMatch[1] : '未命名',
              entry: entries.map(e => {
                const get = (k) => { const m = e.match(new RegExp(`${k}="([^"]*)"`)); return m ? m[1] : null; };
                return {
                  id: get('id'),
                  title: get('title'),
                  artist: get('artist'),
                  album: get('album'),
                  duration: get('duration'),
                  track: get('track'),
                  discNumber: get('discNumber'),
                  year: get('year'),
                  coverArt: get('coverArt'),
                  genre: get('genre'),
                  size: get('size'),
                  suffix: get('suffix'),
                  bitRate: get('bitRate'),
                  albumArtist: get('albumArtist'),
                };
              }),
            },
          };
        }
      } else {
        throw e;
      }
    }
    const pl = resp.playlist || {};
    return {
      id: pl.id,
      name: pl.name || '未命名',
      song_count: parseInt(pl.songCount || '0', 10),
      duration: parseInt(pl.duration || '0', 10) * 1000,
      cover_art_id: pl.coverArt || null,
      changed: pl.changed || null,
      owner: pl.owner || null,
      tracks: (pl.entry || []).map((s) => this._parseSong(s)),
    };
  }

  /**
   * 获取用户信息（包含 email，用于 Gravatar 头像）。
   * Subsonic API: getUser
   * @param {string} username - 用户名（不传则查当前用户）
   * @returns {Promise<{username, email, adminRole, ...}>}
   */
  async getUser(username) {
    const params = {};
    if (username) params.username = username;
    const resp = await this._request('getUser', params);
    const user = resp.user || {};
    return {
      username: user.username || username || this._username,
      email: user.email || null,
      adminRole: !!user.adminRole,
      settingsRole: !!user.settingsRole,
      streamRole: !!user.streamRole,
      downloadRole: !!user.downloadRole,
      uploadRole: !!user.uploadRole,
      playlistRole: !!user.playlistRole,
      coverArtRole: !!user.coverArtRole,
      commentRole: !!user.commentRole,
      podcastRole: !!user.podcastRole,
    };
  }

  async star(trackId = null, albumId = null, artistId = null) {
    const params = {};
    if (trackId) params.id = trackId;
    if (albumId) params.albumId = albumId;
    if (artistId) params.artistId = artistId;
    return this._request('star', params);
  }

  async unstar(trackId = null, albumId = null, artistId = null) {
    const params = {};
    if (trackId) params.id = trackId;
    if (albumId) params.albumId = albumId;
    if (artistId) params.artistId = artistId;
    return this._request('unstar', params);
  }

  /**
   * 创建远程歌单。
   * Subsonic API: createPlaylist
   * @param {string} name - 歌单名
   * @param {string[]} [songIds] - 初始曲目 Subsonic ID 列表
   * @returns {Promise<object>}
   */
  async createPlaylist(name, songIds = []) {
    const params = { name };
    if (songIds.length > 0) params.songId = songIds;
    return this._request('createPlaylist', params);
  }

  /**
   * 更新远程歌单（添加/移除曲目、改名等）。
   * Subsonic API: updatePlaylist
   * @param {string} playlistId - 远程歌单 ID
   * @param {object} opts
   * @param {string} [opts.name] - 新名称
   * @param {string} [opts.comment] - 备注
   * @param {boolean} [opts.public] - 是否公开
   * @param {string[]} [opts.songIdsToAdd] - 要添加的 Subsonic 曲目 ID
   * @param {number[]} [opts.songIndexesToRemove] - 要移除的曲目索引
   * @returns {Promise<object>}
   */
  async updatePlaylist(playlistId, opts = {}) {
    const params = { playlistId };
    if (opts.name) params.name = opts.name;
    if (opts.comment !== undefined) params.comment = opts.comment;
    if (opts.public !== undefined) params.public = !!opts.public;
    if (opts.songIdsToAdd && opts.songIdsToAdd.length > 0) {
      params.songIdToAdd = opts.songIdsToAdd;
    }
    if (opts.songIndexesToRemove && opts.songIndexesToRemove.length > 0) {
      params.songIndexToRemove = opts.songIndexesToRemove;
    }
    return this._request('updatePlaylist', params);
  }

  coverArtUrl(coverId, size = 300) {
    return this._buildUrl('getCoverArt', { id: coverId, size: parseInt(size, 10) });
  }

  streamUrl(trackId, maxBitRate = 0) {
    return this._buildUrl('stream', { id: trackId, maxBitRate: parseInt(maxBitRate, 10) });
  }

  async fetchCover(coverId, size = 300) {
    let url = this._buildUrl('getCoverArt', { id: coverId, size: parseInt(size, 10) });
    if (this._downgradedToHttp && url.startsWith('https://')) {
      url = 'http://' + url.slice(8);
    }
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const { body, statusCode } = await _httpRequestBinary(url, this._timeout);
        if (statusCode >= 400) return null;
        return body;
      } catch (e) {
        if (url.startsWith("https://") && /ECONNREFUSED|ECONNRESET|EPROTO|TLS|disconnected|ETIMEDOUT/i.test(e.message || "") && !this._downgradedToHttp) {
          this._downgradedToHttp = true;
          url = "http://" + url.slice(8);
          console.warn("[subsonic] fetchCover: HTTPS failed, falling back to HTTP:", e.message);
          attempt = -1;
          continue;
        }
        if (attempt < 2) {
          await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
          continue;
        }
        return null;
      }
    }
    return null;
  }

  // ── 歌词 ────────────────────────────────────────────────────────────────

  async getLyricsBySongId(songId) {
    if (!songId) return null;
    let resp;
    try {
      resp = await this._request('getLyricsBySongId', { id: songId });
    } catch (e) {
      if (e instanceof SubsonicError) return null;
      throw e;
    }
    const lyricsList = resp.lyricsList || {};

    // 1) 同步 structured lyrics
    let structured = lyricsList.structuredLyrics || [];
    if (!Array.isArray(structured)) structured = [structured];
    for (const entry of structured) {
      if (!entry.synced) continue;
      let lines = entry.line || [];
      if (!Array.isArray(lines)) lines = [lines];
      const lrcLines = [];
      for (const ln of lines) {
        const start = ln.start;
        if (start === null || start === undefined) continue;
        const value = ln.value || '';
        const ms = parseInt(start, 10);
        const mm = Math.floor(ms / 60000);
        const ss = (ms % 60000) / 1000.0;
        lrcLines.push(`[${String(mm).padStart(2, '0')}:${ss.toFixed(2).padStart(5, '0')}]${value}`);
      }
      if (lrcLines.length > 0) return lrcLines.join('\n');
    }

    // 2) plain lyrics
    let plain = lyricsList.plainLyrics || [];
    if (!Array.isArray(plain)) plain = [plain];
    for (const entry of plain) {
      if (entry.value) return entry.value;
    }

    // 3) 老式字段兼容
    const lyrics = resp.lyrics || {};
    if (typeof lyrics === 'object') {
      const value = lyrics.value || lyrics.Content;
      if (value) return value;
    }
    return null;
  }

  async getLyrics(artist, title) {
    if (!artist || !title) return null;
    let resp;
    try {
      resp = await this._request('getLyrics', { artist, title });
    } catch (e) {
      if (e instanceof SubsonicError) return null;
      throw e;
    }
    const lyrics = resp.lyrics || {};
    if (typeof lyrics === 'object') {
      const value = lyrics.value || lyrics.Content;
      if (value) return value;
    }
    return null;
  }

  // ── 解析辅助 ────────────────────────────────────────────────────────────

  _parseAlbum(a) {
    return {
      id: a.id,
      name: a.name || '未知专辑',
      artist: a.artist || a.albumArtist,
      cover_art_id: a.coverArt,
      song_count: parseInt(a.songCount || '0', 10),
      duration: parseInt(a.duration || '0', 10) * 1000,
      year: parseInt(a.year || '0', 10) || null,
      genre: a.genre,
      created: a.created,
    };
  }

  _parseSong(s) {
    return {
      id: s.id,
      title: s.title || s.name || '未知曲目',
      artist: s.artist,
      album: s.album,
      album_artist: s.albumArtist,
      track_number: parseInt(s.track || '0', 10) || null,
      disc_number: parseInt(s.discNumber || '0', 10) || null,
      year: parseInt(s.year || '0', 10) || null,
      duration_ms: parseInt(s.duration || '0', 10) * 1000,
      cover_art_id: s.coverArt,
      genre: s.genre,
      size: parseInt(s.size || '0', 10),
      suffix: s.suffix,
      bit_rate: parseInt(s.bitRate || '0', 10),
      path: s.path,
    };
  }
}

// ── 代理请求（供 CoverServer 调用）────────────────────────────────────────────

async function proxyRequest(serverUrl, username, password, endpoint, params = null, protocolMode = 'subsonic', timeout = 30.0) {
  const client = new SubsonicClient(serverUrl, username, password, protocolMode, timeout);
  let url = client._buildUrl(endpoint, params);
  if (client._downgradedToHttp && url.startsWith("https://")) {
    url = "http://" + url.slice(8);
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const { body, statusCode, headers } = await _httpRequestBinary(url, timeout);
      if (statusCode >= 400) {
        throw new SubsonicError(statusCode, `HTTP ${statusCode}`);
      }
      return {
        body,
        contentType: headers['content-type'] || 'application/octet-stream',
        headers: {
          'Content-Length': String(body.length),
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Access-Control-Allow-Origin': '*',
        },
      };
    } catch (e) {
      if (e instanceof SubsonicError) throw e;
      if (url.startsWith("https://") && /ECONNREFUSED|ECONNRESET|EPROTO|TLS|disconnected|ETIMEDOUT/i.test(e.message || "") && !client._downgradedToHttp) {
        client._downgradedToHttp = true;
        url = "http://" + url.slice(8);
        console.warn("[subsonic] proxyRequest: HTTPS failed, falling back to HTTP:", e.message);
        attempt = -1;
        continue;
      }
      if (attempt < 2) {
        await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
        continue;
      }
      throw new SubsonicError(null, `网络错误: ${e.message || e}`);
    }
  }
  throw new SubsonicError(null, '网络错误: 未知错误');
}

// ── 同步辅助 ──────────────────────────────────────────────────────────────────

/**
 * 并发执行任务，限制并发数。
 */
async function _mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let idx = 0;
  async function worker() {
    while (idx < items.length) {
      const i = idx++;
      results[i] = await fn(items[i], i);
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

/**
 * 拉取 Subsonic 服务器全量曲目并增量写入 library.tracks 表。
 */
async function syncServerToLibrary(client, library, serverId, options = {}) {
  const {
    prefetchCovers = false,
    progressCb = null,
    libraryChangedCb = null,
    libraryChangedInterval = 20,
    maxWorkers = 0,
  } = options;

  const stats = {
    artists: 0,
    albums: 0,
    tracks: 0,
    covers: 0,
    pending_covers: [],
    warnings: [],
  };

  const seenCoverIds = new Set();
  let lastLibChangeTracks = 0;

  function notify(extra = {}) {
    if (!progressCb) return;
    try {
      progressCb({
        artists: stats.artists,
        albums: stats.albums,
        tracks: stats.tracks,
        ...extra,
      });
    } catch {
      // ignore
    }
  }

  function maybeLibraryChanged(force = false) {
    if (!libraryChangedCb) return;
    if (!force && stats.tracks - lastLibChangeTracks < libraryChangedInterval) return;
    lastLibChangeTracks = stats.tracks;
    try {
      libraryChangedCb();
    } catch {
      // ignore
    }
  }

  // 1) 不再全删重建！
  // 旧实现调用 library.deleteSubsonicTracks(serverId) 会级联删除
  // liked_tracks / play_history / playlist_tracks，导致每次同步后
  // 「喜欢的音乐」「播放历史」「Your Mix」全部清零。
  // 现在改为增量 upsert + 同步后清理已消失的曲目（deleteStaleSubsonicTracks）。
  // 收集服务器端仍存在的 subsonic_id，用于后续增量清理。
  const liveSubIds = new Set();

  // 2) 拉取艺术家列表
  const artists = await client.getArtists();
  if (!artists || artists.length === 0) {
    stats.error = '服务器返回空艺术家列表（库可能为空或权限不足）';
    return stats;
  }

  const concurrency = maxWorkers > 0 ? maxWorkers : os.cpus().length;

  // 阶段1: 并发获取所有艺术家的专辑列表
  const allAlbums = [];
  await _mapLimit(artists, concurrency, async (artist) => {
    try {
      const detail = await client.getArtist(artist.id);
      const albums = detail.albums || [];
      allAlbums.push(...albums);
      stats.artists++;
      notify({ phase: 'artists', current_artist: artist.name || '', total: artists.length });
    } catch (e) {
      stats.warnings.push(`getArtist(${artist.id}) 失败: ${e}`);
    }
  });

  if (allAlbums.length === 0) {
    stats.error = '服务器返回空专辑列表';
    return stats;
  }

  // 阶段2: 并发获取所有专辑的详细信息（含曲目）
  const albumDetails = [];
  let albumsDone = 0;
  await _mapLimit(allAlbums, concurrency, async (album) => {
    try {
      const detail = await client.getAlbum(album.id);
      if (detail.tracks && detail.tracks.length > 0) {
        albumDetails.push(detail);
      }
      albumsDone++;
      notify({
        phase: 'albums',
        current_album: album.name || '',
        current_artist: album.artist || '',
        total: allAlbums.length,
        done: albumsDone,
      });
    } catch (e) {
      stats.warnings.push(`getAlbum(${album.id}) 失败: ${e}`);
    }
  });

  // 阶段3: 串行写入数据库
  for (const albumDetail of albumDetails) {
    const songs = albumDetail.tracks || [];
    const albumCoverId = albumDetail.cover_art_id;

    // 回填专辑 cover_art_id
    if (albumCoverId) {
      for (const song of songs) {
        if (!song.cover_art_id) song.cover_art_id = albumCoverId;
      }
    }

    // 收集服务器端仍存在的 subsonic_id（用于后续增量清理）
    for (const song of songs) {
      if (song.id) liveSubIds.add(song.id);
    }

    try {
      const numSongs = library.upsertSubsonicTracksBatch(serverId, songs);
      stats.albums++;
      stats.tracks += numSongs;
    } catch (e) {
      stats.warnings.push(`upsert 失败(${albumDetail.id}): ${e}`);
    }

    if (albumCoverId && !seenCoverIds.has(albumCoverId)) {
      seenCoverIds.add(albumCoverId);
      stats.pending_covers.push(albumCoverId);
    }

    notify({
      phase: 'tracks',
      current_album: albumDetail.name || '',
      current_artist: albumDetail.artist || '',
      total: albumDetails.length,
    });

    maybeLibraryChanged(true);
  }

  // 最后强制发一次
  maybeLibraryChanged(true);

  // 2b) 增量清理：删除服务器端已不存在但本地仍残留的曲目
  // （仅删除真正消失的曲目，保留仍存在曲目的收藏/历史/歌单关联）
  try {
    const removed = library.deleteStaleSubsonicTracks(serverId, liveSubIds);
    if (removed > 0) {
      stats.warnings.push(`增量清理：移除 ${removed} 首已不存在的曲目`);
    }
  } catch (e) {
    stats.warnings.push(`增量清理失败: ${e}`);
  }

  // 3) 预缓存封面
  if (prefetchCovers) {
    try {
      stats.covers = await prefetchCoversFn(client, library, serverId, stats.pending_covers, concurrency);
    } catch (e) {
      stats.warnings.push(`封面预缓存失败: ${e}`);
    }
  }

  return stats;
}

async function prefetchCoversFn(client, library, serverId, coverIds, maxWorkers = 0) {
  if (!coverIds || coverIds.length === 0) return 0;
  const concurrency = maxWorkers > 0 ? maxWorkers : os.cpus().length;

  const needFetch = coverIds.filter(
    (cid) => library.readSubsonicCoverCache(serverId, cid) === null
  );
  if (needFetch.length === 0) return 0;

  let cachedCount = 0;
  await _mapLimit(needFetch, concurrency, async (coverId) => {
    const body = await client.fetchCover(coverId, 300);
    if (body && body.length > 0) {
      library.writeSubsonicCoverCache(serverId, coverId, body);
      cachedCount++;
    }
  });
  return cachedCount;
}

module.exports = {
  SubsonicError,
  SubsonicClient,
  proxyRequest,
  syncServerToLibrary,
  prefetchCovers: prefetchCoversFn,
};
