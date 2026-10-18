'use strict';

const https = require('https');
const http = require('http');
const { URL } = require('url');

const CLIENT_NAME = 'Carminium-WebDAV';

const SUPPORTED_AUDIO_EXT = new Set([
  '.mp3', '.flac', '.ogg', '.wav', '.m4a', '.aac', '.opus', '.wma',
]);

class WebDAVError extends Error {
  constructor(code, message) {
    super(code !== null && code !== undefined ? `[${code}] ${message}` : message);
    this.code = code;
    this.message = message;
  }
}


function _makeAuthHeader(username, password) {
  return 'Basic ' + Buffer.from(`${username}:${password}`, 'utf-8').toString('base64');
}

function _joinUrl(base, href) {
  if (!href) return base;
  if (href.startsWith('http://') || href.startsWith('https://')) {
    return href;
  }
  const baseParts = base.split('/');
  while (baseParts.length > 3 && baseParts[baseParts.length - 1] === '') {
    baseParts.pop();
  }
  if (href.startsWith('/')) {
    const u = new URL(base);
    return u.protocol + '//' + u.host + href;
  }
  const lastSlash = base.lastIndexOf('/');
  if (lastSlash > 7) {
    return base.slice(0, lastSlash + 1) + href;
  }
  return base + '/' + href;
}

function _httpRequest(method, urlStr, opts = {}) {
  const {
    headers = {},
    body = null,
    timeout = 30.0,
    maxRedirects = 5,
  } = opts;

  return new Promise((resolve, reject) => {
    let currentUrl = urlStr;

    function attempt(redirect) {
      if (redirect > maxRedirects) {
        reject(new WebDAVError(null, 'too many redirects'));
        return;
      }

      const url = new URL(currentUrl);
      const lib = url.protocol === 'https:' ? https : http;
      const tlsOpts = url.protocol === 'https:' ? { rejectUnauthorized: false } : {};

      const req = lib.request(
        {
          hostname: url.hostname,
          port: url.port || (url.protocol === 'https:' ? 443 : 80),
          path: url.pathname + url.search,
          method: method,
          headers: {
            'User-Agent': `${CLIENT_NAME}/1.0`,
            ...headers,
          },
          ...tlsOpts,
        },
        (resp) => {
          if ([301, 302, 303, 307, 308].includes(resp.statusCode) && resp.headers.location) {
            resp.resume();
            let newUrl = resp.headers.location;
            if (newUrl.startsWith('/')) {
              newUrl = url.protocol + '//' + url.host + newUrl;
            } else if (!newUrl.startsWith('http://') && !newUrl.startsWith('https://')) {
              newUrl = new URL(newUrl, currentUrl).href;
            }
            currentUrl = newUrl;
            attempt(redirect + 1);
            return;
          }

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

      if (body) {
        req.write(body);
      }
      req.end();
    }

    attempt(0);
  });
}


class WebDAVClient {
  constructor(serverUrl, username, password, timeout = 30.0) {
    let base = serverUrl.replace(/\/+$/, '');
    if (!base.startsWith('http://') && !base.startsWith('https://')) {
      base = 'http://' + base;
    }
    this._base = base;
    this._username = username || '';
    this._password = password || '';
    this._timeout = timeout;
  }

  _authHeaders() {
    const headers = {};
    if (this._username) {
      headers['Authorization'] = _makeAuthHeader(this._username, this._password);
    }
    return headers;
  }

  async ping() {
    try {
      const { statusCode, headers } = await _httpRequest('PROPFIND', this._base, {
        headers: {
          ...this._authHeaders(),
          'Depth': '0',
          'Content-Type': 'application/xml; charset=utf-8',
        },
        body: PROPFIND_ALLPROP_BODY,
        timeout: this._timeout,
      });

      if (statusCode === 207) {
        const server = headers['dav'] || headers['DAV'] || '';
        return { ok: true, version: server || 'WebDAV' };
      }
      if (statusCode === 401 || statusCode === 403) {
        return { ok: false, error: `认证失败 (HTTP ${statusCode})` };
      }
      if (statusCode === 404) {
        return { ok: false, error: '路径不存在 (HTTP 404)' };
      }
      return { ok: false, error: `HTTP ${statusCode}` };
    } catch (e) {
      return { ok: false, error: e.message || String(e) };
    }
  }

  async listDirectory(dirPath = '') {
    const url = this._buildPathUrl(dirPath);
    const { body, statusCode } = await _httpRequest('PROPFIND', url, {
      headers: {
        ...this._authHeaders(),
        'Depth': '1',
        'Content-Type': 'application/xml; charset=utf-8',
      },
      body: PROPFIND_ALLPROP_BODY,
      timeout: this._timeout,
    });

    if (statusCode !== 207) {
      let errBody = '';
      try { errBody = body.toString('utf-8').slice(0, 200); } catch {}
      throw new WebDAVError(statusCode, `PROPFIND 失败 (HTTP ${statusCode}): ${errBody}`);
    }

    return _parseMultiStatus(body, this._base);
  }

  async scanMusicFiles(rootPath = '', progressCb = null) {
    const results = [];
    const queue = [rootPath];
    let dirsScanned = 0;

    while (queue.length > 0) {
      const dirPath = queue.shift();
      let entries;
      try {
        entries = await this.listDirectory(dirPath);
      } catch (e) {
        console.warn(`[webdav] listDirectory 失败: ${dirPath}`, e.message || e);
        continue;
      }

      for (const entry of entries) {
        if (entry.isRoot) continue;

        if (entry.isCollection) {
          queue.push(entry.relativePath);
        } else {
          const ext = _getExt(entry.displayName);
          if (SUPPORTED_AUDIO_EXT.has(ext)) {
            results.push({
              path: entry.relativePath,
              href: entry.href,
              size: entry.size || 0,
              contentType: entry.contentType || '',
              displayName: entry.displayName,
            });
          }
        }
      }

      dirsScanned++;
      if (progressCb) {
        try {
          progressCb({
            dirs_scanned: dirsScanned,
            files_found: results.length,
            current_path: dirPath,
          });
        } catch {  }
      }
    }

    return results;
  }

  buildFileUrl(relativePath) {
    return this._buildPathUrl(relativePath);
  }

  getAuthHeaders() {
    return this._authHeaders();
  }

  _buildPathUrl(relativePath) {
    let p = relativePath || '';
    if (p && !p.startsWith('/')) p = '/' + p;
    const encoded = p.split('/').map(encodeURIComponent).join('/');
    return this._base + encoded;
  }
}


const PROPFIND_ALLPROP_BODY = `<?xml version="1.0" encoding="utf-8"?>
<D:propfind xmlns:D="DAV:">
  <D:allprop/>
</D:propfind>`;

function _parseMultiStatus(body, baseUrl) {
  const xml = body.toString('utf-8');
  const entries = [];

  const responseRegex = /<(?:D:)?response[^>]*>([\s\S]*?)<\/(?:D:)?response>/gi;
  let match;

  while ((match = responseRegex.exec(xml)) !== null) {
    const block = match[1];

    const hrefMatch = block.match(/<(?:D:)?href[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<(?:\/)?(?:D:)?href>/i);
    if (!hrefMatch) continue;
    const href = hrefMatch[1].trim();

    const nameMatch = block.match(/<(?:D:)?displayname[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<(?:\/)?(?:D:)?displayname>/i);
    const displayName = nameMatch ? nameMatch[1].trim() : _basenameFromHref(href);

    const isCollection = /<(?:D:)?collection\s*\/>/i.test(block);

    let size = 0;
    const sizeMatch = block.match(/<(?:D:)?getcontentlength[^>]*>(\d+)</i);
    if (sizeMatch) size = parseInt(sizeMatch[1], 10);

    let contentType = '';
    const mimeMatch = block.match(/<(?:D:)?getcontenttype[^>]*>([^<]+)</i);
    if (mimeMatch) contentType = mimeMatch[1].trim();

    const fullUrl = _joinUrl(baseUrl, href);
    let relativePath = fullUrl;
    if (fullUrl.startsWith(baseUrl)) {
      relativePath = decodeURIComponent(fullUrl.slice(baseUrl.length));
    } else {
      try {
        const u = new URL(fullUrl);
        relativePath = decodeURIComponent(u.pathname);
      } catch {
        relativePath = decodeURIComponent(href);
      }
    }

    const isRoot = relativePath === '' || relativePath === '/';

    entries.push({
      href: fullUrl,
      relativePath: relativePath,
      displayName: displayName,
      isCollection: isCollection,
      size: size,
      contentType: contentType,
      isRoot: isRoot,
    });
  }

  return entries;
}

function _basenameFromHref(href) {
  let h = href.replace(/\/$/, '');
  const idx = h.lastIndexOf('/');
  if (idx >= 0) h = h.slice(idx + 1);
  try { return decodeURIComponent(h); } catch { return h; }
}

function _getExt(name) {
  const idx = name.lastIndexOf('.');
  if (idx < 0) return '';
  return name.slice(idx).toLowerCase();
}


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


async function _fetchAndParseMetadata(client, file) {
  const fs = require('fs');
  const path = require('path');
  const os = require('os');

  const tmpDir = path.join(os.tmpdir(), 'carminium-webdav');
  try { fs.mkdirSync(tmpDir, { recursive: true }); } catch {  }

  const safeName = file.displayName.replace(/[^a-zA-Z0-9._-]/g, '_');
  const tmpFile = path.join(tmpDir, `wdf_${Date.now()}_${safeName}`);

  try {
    const fileUrl = client.buildFileUrl(file.path);
    const authHeaders = client.getAuthHeaders();

    const { body, statusCode } = await _httpRequest('GET', fileUrl, {
      headers: authHeaders,
      timeout: 120.0,
    });

    if (statusCode >= 400) {
      throw new WebDAVError(statusCode, `下载失败 (HTTP ${statusCode})`);
    }

    fs.writeFileSync(tmpFile, body);

    const mm = require('music-metadata');
    let parseFile = mm.parseFile || null;
    if (!parseFile && typeof mm.loadMusicMetadata === 'function') {
      const api = await mm.loadMusicMetadata();
      parseFile = api.parseFile;
    }
    if (!parseFile) throw new Error('music-metadata parseFile unavailable');

    const metadata = await parseFile(tmpFile);
    const common = metadata.common;

    return {
      title: common.title || file.displayName.replace(/\.[^.]+$/, ''),
      artist: common.artist || null,
      album: common.album || null,
      album_artist: common.albumartist || null,
      year: common.year || null,
      track_number: common.track?.no || null,
      disc_number: common.disk?.no || null,
      duration_ms: metadata.format.duration ? Math.round(metadata.format.duration * 1000) : 0,
      has_cover: !!(common.picture && common.picture.length > 0),
      genre: (common.genre && common.genre.length > 0) ? common.genre[0] : null,
      lyrics: null,
      file_size: file.size || body.length,
    };
  } finally {
    try { fs.unlinkSync(tmpFile); } catch {  }
  }
}

async function syncServerToLibrary(client, library, serverId, options = {}) {
  const {
    progressCb = null,
    libraryChangedCb = null,
    libraryChangedInterval = 20,
  } = options;

  const stats = {
    tracks: 0,
    covers: 0,
    warnings: [],
  };

  let lastLibChangeTracks = 0;

  function notify(extra = {}) {
    if (!progressCb) return;
    try {
      progressCb({
        tracks: stats.tracks,
        ...extra,
      });
    } catch {  }
  }

  function maybeLibraryChanged(force = false) {
    if (!libraryChangedCb) return;
    if (!force && stats.tracks - lastLibChangeTracks < libraryChangedInterval) return;
    lastLibChangeTracks = stats.tracks;
    try { libraryChangedCb(); } catch {  }
  }

  const files = await client.scanMusicFiles('', (s) => {
    notify({ phase: 'scanning', current_path: s.current_path || '', dirs_scanned: s.dirs_scanned, files_found: s.files_found });
  });

  if (files.length === 0) {
    stats.error = 'WebDAV 服务器上未找到音频文件';
    return stats;
  }

  const livePaths = new Set();

  for (const file of files) {
    livePaths.add(file.path);

    try {
      const meta = await _fetchAndParseMetadata(client, file);
      library.upsertWebDAVTrack(serverId, file.path, file.href, meta);
      stats.tracks++;
      notify({ phase: 'tracks', current_file: file.displayName || '' });
      maybeLibraryChanged();
    } catch (e) {
      try {
        library.upsertWebDAVTrack(serverId, file.path, file.href, {
          title: file.displayName.replace(/\.[^.]+$/, ''),
          artist: null,
          album: null,
          album_artist: null,
          year: null,
          track_number: null,
          disc_number: null,
          duration_ms: 0,
          has_cover: false,
          genre: null,
          lyrics: null,
          file_size: file.size || 0,
        });
        stats.tracks++;
      } catch (e2) {
        stats.warnings.push(`写入失败(${file.path}): ${e2}`);
      }
    }
  }

  maybeLibraryChanged(true);

  try {
    const removed = library.deleteStaleWebDAVTracks(serverId, livePaths);
    if (removed > 0) {
      stats.warnings.push(`增量清理：移除 ${removed} 首已不存在的曲目`);
    }
  } catch (e) {
    stats.warnings.push(`增量清理失败: ${e}`);
  }

  return stats;
}

module.exports = {
  WebDAVError,
  WebDAVClient,
  syncServerToLibrary,
  SUPPORTED_AUDIO_EXT,
};
