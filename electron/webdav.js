/**
 * Carminium — WebDAV 客户端
 *
 * 实现 WebDAV 协议的子集，用于浏览远程音乐库并流式播放音频文件。
 * 认证方式：HTTP Basic Auth
 *
 * 主要操作：
 *   - PROPFIND：列出目录内容（Depth: 1）
 *   - GET：下载文件 / 流式播放
 *   - HEAD：获取文件元数据（大小、MIME）
 */
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

// ── HTTP 请求辅助 ────────────────────────────────────────────────────────────

function _makeAuthHeader(username, password) {
  return 'Basic ' + Buffer.from(`${username}:${password}`, 'utf-8').toString('base64');
}

function _joinUrl(base, href) {
  if (!href) return base;
  // 绝对 URL
  if (href.startsWith('http://') || href.startsWith('https://')) {
    return href;
  }
  // 相对路径
  const baseParts = base.split('/');
  // 去掉末尾空段
  while (baseParts.length > 3 && baseParts[baseParts.length - 1] === '') {
    baseParts.pop();
  }
  if (href.startsWith('/')) {
    // 绝对路径
    const u = new URL(base);
    return u.protocol + '//' + u.host + href;
  }
  // 相对路径
  const lastSlash = base.lastIndexOf('/');
  if (lastSlash > 7) {
    return base.slice(0, lastSlash + 1) + href;
  }
  return base + '/' + href;
}

/**
 * 发送 HTTP 请求并返回响应。
 * @param {string} method - HTTP 方法 (GET, HEAD, PROPFIND)
 * @param {string} urlStr - 完整 URL
 * @param {object} opts - { headers, body, timeout, maxRedirects }
 * @returns {Promise<{body: Buffer, statusCode: number, headers: object}>}
 */
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
          // 处理重定向
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

// ── WebDAV 客户端 ───────────────────────────────────────────────────────────

class WebDAVClient {
  /**
   * @param {string} serverUrl - WebDAV 服务器根 URL（如 https://nas.local:5006/Music）
   * @param {string} username
   * @param {string} password
   * @param {number} timeout - seconds
   */
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

  /**
   * 测试连接：发送 PROPFIND Depth:0 请求检查根路径是否可访问。
   * @returns {Promise<{ok: boolean, version?: string, error?: string}>}
   */
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

  /**
   * 列出指定目录下的文件和子目录。
   * @param {string} dirPath - 相对于服务器根的路径（以 / 开头，或空字符串表示根）
   * @returns {Promise<Array<{href: string, displayName: string, isCollection: boolean, size: number, contentType: string}>>}
   */
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

  /**
   * 递归扫描整个目录树，收集所有支持的音频文件。
   * @param {string} rootPath - 扫描根路径（相对于服务器根，或空字符串）
   * @param {function} progressCb - 进度回调 ({ dirs_scanned, files_found, current_path })
   * @returns {Promise<Array<{path: string, href: string, size: number, contentType: string, displayName: string}>>}
   */
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
        // 跳过根目录自身
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
        } catch { /* ignore */ }
      }
    }

    return results;
  }

  /**
   * 构建文件下载 URL。
   * @param {string} relativePath - 相对于服务器根的路径
   * @returns {string} 完整 URL
   */
  buildFileUrl(relativePath) {
    return this._buildPathUrl(relativePath);
  }

  /**
   * 获取认证头（供代理使用）。
   * @returns {object}
   */
  getAuthHeaders() {
    return this._authHeaders();
  }

  _buildPathUrl(relativePath) {
    let p = relativePath || '';
    if (p && !p.startsWith('/')) p = '/' + p;
    // URL 编码路径段，但保留 /
    const encoded = p.split('/').map(encodeURIComponent).join('/');
    return this._base + encoded;
  }
}

// ── XML 解析 ────────────────────────────────────────────────────────────────

const PROPFIND_ALLPROP_BODY = `<?xml version="1.0" encoding="utf-8"?>
<D:propfind xmlns:D="DAV:">
  <D:allprop/>
</D:propfind>`;

/**
 * 从 PROPFIND multistatus 响应中解析文件列表。
 * 不依赖外部 XML 解析库，使用正则 + 简单状态机。
 */
function _parseMultiStatus(body, baseUrl) {
  const xml = body.toString('utf-8');
  const entries = [];

  // 匹配 <D:response> ... </D:response> 或 <response> ... </response>
  const responseRegex = /<(?:D:)?response[^>]*>([\s\S]*?)<\/(?:D:)?response>/gi;
  let match;

  while ((match = responseRegex.exec(xml)) !== null) {
    const block = match[1];

    // 提取 href
    const hrefMatch = block.match(/<(?:D:)?href[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<(?:\/)?(?:D:)?href>/i);
    if (!hrefMatch) continue;
    const href = hrefMatch[1].trim();

    // 提取 displayname
    const nameMatch = block.match(/<(?:D:)?displayname[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<(?:\/)?(?:D:)?displayname>/i);
    const displayName = nameMatch ? nameMatch[1].trim() : _basenameFromHref(href);

    // 检测 collection（目录）
    const isCollection = /<(?:D:)?collection\s*\/>/i.test(block);

    // 提取大小
    let size = 0;
    const sizeMatch = block.match(/<(?:D:)?getcontentlength[^>]*>(\d+)</i);
    if (sizeMatch) size = parseInt(sizeMatch[1], 10);

    // 提取 MIME
    let contentType = '';
    const mimeMatch = block.match(/<(?:D:)?getcontenttype[^>]*>([^<]+)</i);
    if (mimeMatch) contentType = mimeMatch[1].trim();

    // 计算相对路径
    const fullUrl = _joinUrl(baseUrl, href);
    let relativePath = fullUrl;
    if (fullUrl.startsWith(baseUrl)) {
      relativePath = decodeURIComponent(fullUrl.slice(baseUrl.length));
    } else {
      // 可能是不同端口/主机，用 href 最后一段路径
      try {
        const u = new URL(fullUrl);
        relativePath = decodeURIComponent(u.pathname);
      } catch {
        relativePath = decodeURIComponent(href);
      }
    }

    // 判断是否为根目录自身
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

// ── 并发辅助 ────────────────────────────────────────────────────────────────

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

// ── 同步到本地库 ────────────────────────────────────────────────────────────

/**
 * 使用 music-metadata 解析远程文件的元数据。
 * 因为 WebDAV 文件是远程的，需要先下载到临时目录再解析。
 * 为节省带宽，仅下载文件头部（足够解析元数据即可）。
 *
 * @param {WebDAVClient} client
 * @param {{path, href, size, contentType, displayName}} file
 * @returns {Promise<object>} 元数据对象
 */
async function _fetchAndParseMetadata(client, file) {
  const fs = require('fs');
  const path = require('path');
  const os = require('os');

  // 下载文件到临时目录
  const tmpDir = path.join(os.tmpdir(), 'carminium-webdav');
  try { fs.mkdirSync(tmpDir, { recursive: true }); } catch { /* ignore */ }

  // 生成安全的临时文件名
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

    // 使用 music-metadata 解析
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
      lyrics: null, // WebDAV 暂不提取歌词
      file_size: file.size || body.length,
    };
  } finally {
    try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
  }
}

/**
 * 扫描 WebDAV 服务器并将曲目写入 library.tracks 表。
 * @param {WebDAVClient} client
   * @param {MusicLibrary} library
   * @param {number} serverId
   * @param {object} options - { progressCb, libraryChangedCb, libraryChangedInterval }
   * @returns {Promise<object>} 统计信息
   */
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
    } catch { /* ignore */ }
  }

  function maybeLibraryChanged(force = false) {
    if (!libraryChangedCb) return;
    if (!force && stats.tracks - lastLibChangeTracks < libraryChangedInterval) return;
    lastLibChangeTracks = stats.tracks;
    try { libraryChangedCb(); } catch { /* ignore */ }
  }

  // 1) 扫描所有音频文件
  const files = await client.scanMusicFiles('', (s) => {
    notify({ phase: 'scanning', current_path: s.current_path || '', dirs_scanned: s.dirs_scanned, files_found: s.files_found });
  });

  if (files.length === 0) {
    stats.error = 'WebDAV 服务器上未找到音频文件';
    return stats;
  }

  // 2) 并发解析元数据并写入数据库
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
      // 元数据解析失败时仍写入基本记录
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

  // 3) 增量清理：删除已不存在的曲目
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
