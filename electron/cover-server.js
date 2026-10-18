'use strict';

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const AUDIO_MIME_OVERRIDES = {
  '.mp3': 'audio/mpeg',
  '.flac': 'audio/flac',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.wma': 'audio/x-ms-wma',
  '.aiff': 'audio/aiff',
  '.aif': 'audio/aiff',
};

const VIDEO_MIME_OVERRIDES = {
  '.mp4':  'video/mp4',
  '.m4v':  'video/mp4',
  '.webm': 'video/webm',
  '.mkv':  'video/x-matroska',
  '.mov':  'video/quicktime',
  '.avi':  'video/x-msvideo',
  '.flv':  'video/x-flv',
  '.wmv':  'video/x-ms-wmv',
  '.mpg':  'video/mpeg',
  '.mpeg': 'video/mpeg',
  '.ts':   'video/mp2t',
};

function audioMime(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (AUDIO_MIME_OVERRIDES[ext]) return AUDIO_MIME_OVERRIDES[ext];
  return 'application/octet-stream';
}

function videoMime(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (VIDEO_MIME_OVERRIDES[ext]) return VIDEO_MIME_OVERRIDES[ext];
  return 'video/mp4';
}

let _sharpModule = undefined;
function _getSharp() {
  if (_sharpModule === undefined) {
    try {
      _sharpModule = require('sharp');
      _sharpModule.cache({ memory: 8, files: 0, items: 30 });
      _sharpModule.concurrency(1);
    } catch (e) {
      _sharpModule = null;
      console.warn('[cover-server] sharp 不可用，封面将按原始分辨率返回：', e && e.message);
    }
  }
  return _sharpModule;
}

const _resizeCache = new Map();
const RESIZE_CACHE_MAX = 80;

function _parseSizeFromUrl(reqUrl) {
  try {
    const u = new URL(reqUrl, 'http://127.0.0.1');
    const s = u.searchParams.get('size');
    return s || null;
  } catch (e) {
    return null;
  }
}

async function _resizeCover(buffer, keyId, sizeStr) {
  if (!sizeStr || sizeStr === 'max' || sizeStr === 'original' || sizeStr === 'default') {
    return buffer;
  }
  const n = parseInt(sizeStr, 10);
  if (!isFinite(n) || n <= 0) return buffer;

  const cacheKey = keyId + ':' + n;
  const cached = _resizeCache.get(cacheKey);
  if (cached) return cached;

  const sharp = _getSharp();
  if (!sharp) return buffer;

  try {
    const out = await sharp(buffer, { failOn: 'none' })
      .resize(n, n, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 85, mozjpeg: true })
      .toBuffer();
    if (out && out.length > 0) {
      if (_resizeCache.size >= RESIZE_CACHE_MAX) {
        const first = _resizeCache.keys().next().value;
        if (first !== undefined) _resizeCache.delete(first);
      }
      _resizeCache.set(cacheKey, out);
      return out;
    }
  } catch (e) {
    console.warn('[cover-server] 封面缩放失败:', keyId, e && e.message);
  }
  return buffer;
}

class CoverHTTPServer {
  constructor(library) {
    this._library = library;
    this._server = null;
    this._port = 0;
  }

  start() {
    return new Promise((resolve, reject) => {
      this._server = http.createServer((req, res) => this._handle(req, res));
      this._server.listen(0, '127.0.0.1', () => {
        this._port = this._server.address().port;
        resolve();
      });
      this._server.once('error', reject);
    });
  }

  stop() {
    if (this._server) {
      this._server.close();
      this._server = null;
    }
  }

  clearResizeCache() {
    _resizeCache.clear();
  }

  get baseUrl() {
    return `http://127.0.0.1:${this._port}`;
  }

  get mediaBaseUrl() {
    return this.baseUrl;
  }

  _handle(req, res) {
    const url = new URL(req.url, `http://127.0.0.1:${this._port}`);
    const pathname = url.pathname;
    const method = req.method;

    try {
      if (pathname.startsWith('/cover/')) {
        const trackId = decodeURIComponent(pathname.slice('/cover/'.length));
        this._handleCover(req, res, trackId, method);
      } else if (pathname.startsWith('/media/')) {
        const trackId = decodeURIComponent(pathname.slice('/media/'.length));
        this._handleMedia(req, res, trackId, method);
      } else if (pathname.startsWith('/video/')) {
        const encodedPath = pathname.slice('/video/'.length);
        this._handleVideo(req, res, encodedPath, method);
      } else if (pathname.startsWith('/subsonic/cover/')) {
        const raw = decodeURIComponent(pathname.slice('/subsonic/cover/'.length));
        this._handleSubsonicCover(req, res, raw, method);
      } else if (pathname.startsWith('/subsonic/stream/')) {
        const raw = decodeURIComponent(pathname.slice('/subsonic/stream/'.length));
        this._handleSubsonicStream(req, res, raw, method);
      } else if (pathname.startsWith('/webdav/stream/')) {
        const raw = decodeURIComponent(pathname.slice('/webdav/stream/'.length));
        this._handleWebDAVStream(req, res, raw, method);
      } else if (pathname.startsWith('/artist-image/')) {
        const name = decodeURIComponent(pathname.slice('/artist-image/'.length));
        this._handleArtistImage(req, res, name, method);
      } else if (pathname.startsWith('/artist-banner/')) {
        const name = decodeURIComponent(pathname.slice('/artist-banner/'.length));
        this._handleArtistBanner(req, res, name, method);
      } else if (pathname.startsWith('/artist-bio/')) {
        const name = decodeURIComponent(pathname.slice('/artist-bio/'.length));
        this._handleArtistBio(req, res, name, method);
      } else if (pathname.startsWith('/artist-alias-search/')) {
        this._handleArtistAliasSearch(req, res, pathname.slice('/artist-alias-search/'.length), method);
      } else if (pathname.startsWith('/artist-aliases/')) {
        const name = decodeURIComponent(pathname.slice('/artist-aliases/'.length));
        this._handleArtistAliases(req, res, name, method);
      } else {
        this._sendError(res, 404);
      }
    } catch (e) {
      this._sendError(res, 500);
    }
  }

  _sendError(res, code, message) {
    const msg = message || http.STATUS_CODES[code] || 'Error';
    res.writeHead(code, { 'Content-Type': 'text/plain' });
    res.end(msg);
  }

  _sendHeaders(res, code, headers) {
    res.writeHead(code, headers);
  }


  async _handleCover(req, res, trackId, method) {
    const size = _parseSizeFromUrl(req.url);
    let data = null;
    try {
      const r = await this._library.getCoverDataAsync(trackId);
      data = r ? r.data : null;
    } catch {
      data = null;
    }
    if (data) {
      this._sendResizedCover(req, res, trackId, data, size, method);
      return;
    }
    if (trackId.startsWith('s') && trackId.includes('_')) {
      this._proxySubsonicCoverForTrack(req, res, trackId, method, size);
      return;
    }
    if (trackId.startsWith('w') && trackId.includes('_')) {
      this._proxyWebDAVCoverForTrack(req, res, trackId, method, size);
      return;
    }
    this._sendError(res, 404);
  }

  async _sendResizedCover(req, res, trackId, data, size, method) {
    try {
      const out = await _resizeCover(data, trackId, size);
      const headers = {
        'Content-Type': 'image/jpeg',
        'Content-Length': out.length,
        'Cache-Control': 'private, max-age=300',
        'Access-Control-Allow-Origin': '*',
      };
      this._sendHeaders(res, 200, headers);
      if (method !== 'HEAD') res.end(out);
    } catch (e) {
      try {
        const headers = {
          'Content-Type': 'image/jpeg',
          'Content-Length': data.length,
          'Cache-Control': 'private, max-age=300',
          'Access-Control-Allow-Origin': '*',
        };
        this._sendHeaders(res, 200, headers);
        if (method !== 'HEAD') res.end(data);
      } catch (e2) {
        this._sendError(res, 500);
      }
    }
  }

  async _proxySubsonicCoverForTrack(req, res, trackId, method, size) {
    const rest = trackId.slice(1);
    const underscoreIdx = rest.indexOf('_');
    if (underscoreIdx < 0) {
      this._sendError(res, 404);
      return;
    }
    const sidStr = rest.slice(0, underscoreIdx);
    const subId = rest.slice(underscoreIdx + 1);
    let serverId;
    try {
      serverId = parseInt(sidStr, 10);
    } catch {
      this._sendError(res, 404);
      return;
    }

    let coverId = this._library.getSubsonicCoverIdForTrack(trackId);
    if (!coverId) coverId = this._library.getSubsonicAlbumCoverIdForTrack(trackId);
    if (!coverId) coverId = subId;
    if (!coverId) {
      this._sendError(res, 404);
      return;
    }

    const cached = this._library.readSubsonicCoverCache(serverId, coverId, size);
    if (cached) {
      const headers = {
        'Content-Type': 'image/jpeg',
        'Content-Length': cached.length,
        'Cache-Control': 'public, max-age=86400',
        'Access-Control-Allow-Origin': '*',
      };
      if (method === 'HEAD') {
        this._sendHeaders(res, 200, headers);
      } else {
        this._sendHeaders(res, 200, headers);
        res.end(cached);
      }
      return;
    }

    const cfg = this._library.getSubsonicServer(serverId);
    if (!cfg) {
      this._sendError(res, 404);
      return;
    }

    const reqSize = (size && size !== 'max' && size !== 'original') ? parseInt(size, 10) : 300;

    try {
      const { proxyRequest } = require('./subsonic');
      const { body, contentType } = await proxyRequest(
        cfg.server_url, cfg.username, cfg.password,
        'getCoverArt', { id: coverId, size: reqSize },
        cfg.protocol_mode || 'subsonic', 30.0
      );

      if (body && (contentType || '').startsWith('image/')) {
        this._library.writeSubsonicCoverCache(serverId, coverId, body, size);
      }

      const headers = {
        'Content-Type': contentType || 'image/jpeg',
        'Content-Length': body.length,
        'Cache-Control': 'public, max-age=86400',
        'Access-Control-Allow-Origin': '*',
      };
      if (method === 'HEAD') {
        this._sendHeaders(res, 200, headers);
      } else {
        this._sendHeaders(res, 200, headers);
        res.end(body);
      }
    } catch {
      this._sendError(res, 502);
    }
  }


  async _proxyWebDAVCoverForTrack(req, res, trackId, method, size) {
    let cached = null;
    try {
      const r = await this._library.getCoverDataAsync(trackId);
      cached = r ? r.data : null;
    } catch {
      cached = null;
    }
    if (cached) {
      this._sendResizedCover(req, res, trackId, cached, size, method);
      return;
    }

    const track = this._library.getTrack(trackId);
    if (!track || track.source !== 'webdav') {
      this._sendError(res, 404);
      return;
    }

    const serverId = track.server_id;
    if (serverId === null || serverId === undefined) {
      this._sendError(res, 404);
      return;
    }

    const cfg = this._library.getWebDAVServer(parseInt(serverId, 10));
    if (!cfg) {
      this._sendError(res, 404);
      return;
    }

    let relativePath = track.path || '';
    const prefix = `webdav://${parseInt(serverId, 10)}`;
    if (relativePath.startsWith(prefix)) {
      relativePath = relativePath.slice(prefix.length);
    }

    try {
      const { WebDAVClient } = require('./webdav');
      const client = new WebDAVClient(cfg.server_url, cfg.username, cfg.password, 60.0);
      const fileUrl = client.buildFileUrl(relativePath);
      const authHeaders = client.getAuthHeaders();

      const fs = require('fs');
      const os = require('os');
      const tmpDir = path.join(os.tmpdir(), 'carminium-webdav-covers');
      try { fs.mkdirSync(tmpDir, { recursive: true }); } catch {  }

      const safeName = (track.title || trackId).replace(/[^a-zA-Z0-9._-]/g, '_');
      const tmpFile = path.join(tmpDir, `cover_${trackId}_${Date.now()}_${safeName}.tmp`);

      try {
        const { body, statusCode } = await this._httpGetBuffer(fileUrl, authHeaders, 120.0);
        if (statusCode >= 400 || !body || body.length === 0) {
          this._sendError(res, 404);
          return;
        }

        fs.writeFileSync(tmpFile, body);

        const coverData = await this._extractCoverAsync(tmpFile);
        if (coverData) {
          try {
            this._library.storeCoverData(trackId, coverData);
          } catch {  }

          this._sendResizedCover(req, res, trackId, coverData, size, method);
        } else {
          this._sendError(res, 404);
        }
      } finally {
        try { fs.unlinkSync(tmpFile); } catch {  }
      }
    } catch (e) {
      console.warn('[cover-server] WebDAV cover extraction failed:', e && e.message);
      this._sendError(res, 404);
    }
  }

  _httpGetBuffer(url, authHeaders, timeoutSec) {
    return new Promise((resolve, reject) => {
      const lib = url.startsWith('https:') ? https : http;
      const urlObj = new URL(url);
      const tlsOpts = urlObj.protocol === 'https:' ? { rejectUnauthorized: false } : {};

      const req = lib.request({
        hostname: urlObj.hostname,
        port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
        path: urlObj.pathname + urlObj.search,
        method: 'GET',
        headers: {
          'User-Agent': 'Carminium/1.0',
          'Accept-Encoding': 'identity',
          'Connection': 'close',
          ...authHeaders,
        },
        ...tlsOpts,
      }, (resp) => {
        if ([301, 302, 303, 307, 308].includes(resp.statusCode) && resp.headers.location) {
          resp.resume();
          let newUrl = resp.headers.location;
          if (newUrl.startsWith('/')) {
            newUrl = urlObj.protocol + '//' + urlObj.host + newUrl;
          }
          this._httpGetBuffer(newUrl, authHeaders, timeoutSec).then(resolve, reject);
          return;
        }
        const chunks = [];
        resp.on('data', (chunk) => chunks.push(chunk));
        resp.on('end', () => {
          resolve({ body: Buffer.concat(chunks), statusCode: resp.statusCode, headers: resp.headers });
        });
      });
      req.on('error', reject);
      req.setTimeout(Math.round(timeoutSec * 1000), () => {
        req.destroy(new Error('timeout'));
      });
      req.end();
    });
  }

  async _extractCoverAsync(filePath) {
    try {
      const mm = require('music-metadata');
      let parseFile = mm.parseFile || null;
      if (!parseFile && typeof mm.loadMusicMetadata === 'function') {
        const api = await mm.loadMusicMetadata();
        parseFile = api.parseFile;
      }
      if (!parseFile) return null;

      const metadata = await parseFile(filePath);
      const common = metadata.common;
      if (common.picture && common.picture.length > 0) {
        const pic = common.picture[0];
        if (pic.data && pic.data.length > 0) {
          return Buffer.from(pic.data);
        }
      }
      return null;
    } catch (e) {
      console.warn('[cover-server] cover extraction failed:', e && e.message);
      return null;
    }
  }


  _resolveTrackPath(trackId) {
    const track = this._library.getTrack(trackId);
    if (!track) return null;
    if (track.source === 'subsonic') return null;
    if (track.source === 'webdav') return null;
    const filePath = track.path || '';
    if (!filePath || !fs.existsSync(filePath)) return null;
    return filePath;
  }

  _handleMedia(req, res, trackId, method) {
    const filePath = this._resolveTrackPath(trackId);
    if (!filePath) {
      const track = this._library.getTrack(trackId);
      if (track && track.source === 'subsonic') {
        this._proxySubsonicStreamForTrack(req, res, track, method);
        return;
      }
      if (track && track.source === 'webdav') {
        this._proxyWebDAVStreamForTrack(req, res, track, method);
        return;
      }
      this._sendError(res, 404);
      return;
    }

    const stat = fs.statSync(filePath);
    const fileSize = stat.size;
    const mime = audioMime(filePath);

    if (method === 'HEAD') {
      this._sendHeaders(res, 200, {
        'Content-Type': mime,
        'Content-Length': fileSize,
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Access-Control-Allow-Origin': '*',
      });
      return;
    }

    const rangeHeader = req.headers['range'];
    if (rangeHeader && rangeHeader.startsWith('bytes=')) {
      try {
        const rangeSpec = rangeHeader.slice(6);
        const dashIdx = rangeSpec.indexOf('-');
        const startStr = rangeSpec.slice(0, dashIdx);
        const endStr = rangeSpec.slice(dashIdx + 1);
        let start = startStr ? parseInt(startStr, 10) : 0;
        let end = endStr ? parseInt(endStr, 10) : fileSize - 1;
        end = Math.min(end, fileSize - 1);
        if (start > end || start >= fileSize) {
          this._sendError(res, 416, 'Requested Range Not Satisfiable');
          return;
        }
        const length = end - start + 1;
        this._sendHeaders(res, 206, {
          'Content-Type': mime,
          'Content-Length': length,
          'Content-Range': `bytes ${start}-${end}/${fileSize}`,
          'Accept-Ranges': 'bytes',
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Access-Control-Allow-Origin': '*',
        });
        this._sendFileRange(res, filePath, start, length);
      } catch {
        this._sendError(res, 400, 'Bad Range Request');
      }
    } else {
      this._sendHeaders(res, 200, {
        'Content-Type': mime,
        'Content-Length': fileSize,
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Access-Control-Allow-Origin': '*',
      });
      this._sendFileRange(res, filePath, 0, fileSize);
    }
  }

  _sendFileRange(res, filePath, start, length) {
    const stream = fs.createReadStream(filePath, {
      start,
      end: start + length - 1,
      highWaterMark: 256 * 1024,
    });
    stream.on('error', (err) => {
      console.error('[cover-server] stream error:', err.message);
      try { res.destroy(); } catch {  }
    });
    res.on('close', () => {
      try { stream.destroy(); } catch {  }
    });
    stream.pipe(res);
  }


  _decodeVideoPath(encoded) {
    try {
      let b64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
      while (b64.length % 4) b64 += '=';
      return Buffer.from(b64, 'base64').toString('utf-8');
    } catch {
      return null;
    }
  }

  _handleVideo(req, res, encodedPath, method) {
    const filePath = this._decodeVideoPath(encodedPath);
    if (!filePath || !fs.existsSync(filePath)) {
      this._sendError(res, 404);
      return;
    }

    const stat = fs.statSync(filePath);
    const fileSize = stat.size;
    const mime = videoMime(filePath);

    if (method === 'HEAD') {
      this._sendHeaders(res, 200, {
        'Content-Type': mime,
        'Content-Length': fileSize,
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Access-Control-Allow-Origin': '*',
      });
      return;
    }

    const rangeHeader = req.headers['range'];
    if (rangeHeader && rangeHeader.startsWith('bytes=')) {
      try {
        const rangeSpec = rangeHeader.slice(6);
        const dashIdx = rangeSpec.indexOf('-');
        const startStr = rangeSpec.slice(0, dashIdx);
        const endStr = rangeSpec.slice(dashIdx + 1);
        let start = startStr ? parseInt(startStr, 10) : 0;
        let end = endStr ? parseInt(endStr, 10) : fileSize - 1;
        end = Math.min(end, fileSize - 1);
        if (start > end || start >= fileSize) {
          this._sendError(res, 416, 'Requested Range Not Satisfiable');
          return;
        }
        const length = end - start + 1;
        this._sendHeaders(res, 206, {
          'Content-Type': mime,
          'Content-Length': length,
          'Content-Range': `bytes ${start}-${end}/${fileSize}`,
          'Accept-Ranges': 'bytes',
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Access-Control-Allow-Origin': '*',
        });
        this._sendFileRange(res, filePath, start, length);
      } catch {
        this._sendError(res, 400, 'Bad Range Request');
      }
    } else {
      this._sendHeaders(res, 200, {
        'Content-Type': mime,
        'Content-Length': fileSize,
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Access-Control-Allow-Origin': '*',
      });
      this._sendFileRange(res, filePath, 0, fileSize);
    }
  }


  _parseSubsonicPath(raw) {
    raw = raw.split('?')[0];
    const slashIdx = raw.indexOf('/');
    if (slashIdx < 0) return null;
    const sidStr = raw.slice(0, slashIdx);
    const subsonicId = raw.slice(slashIdx + 1);
    let serverId;
    try {
      serverId = parseInt(sidStr, 10);
    } catch {
      return null;
    }
    if (!subsonicId) return null;
    return [serverId, subsonicId];
  }

  _handleSubsonicCover(req, res, raw, method) {
    const parsed = this._parseSubsonicPath(raw);
    if (!parsed) {
      this._sendError(res, 404);
      return;
    }
    const [serverId, coverId] = parsed;
    const size = _parseSizeFromUrl(req.url);
    this._proxySubsonicCover(req, res, serverId, coverId, method, size);
  }

  async _proxySubsonicCover(req, res, serverId, coverId, method, size) {
    const cached = this._library.readSubsonicCoverCache(serverId, coverId, size);
    if (cached) {
      const headers = {
        'Content-Type': 'image/jpeg',
        'Content-Length': cached.length,
        'Cache-Control': 'public, max-age=86400',
        'Access-Control-Allow-Origin': '*',
      };
      if (method === 'HEAD') {
        this._sendHeaders(res, 200, headers);
      } else {
        this._sendHeaders(res, 200, headers);
        res.end(cached);
      }
      return;
    }

    const cfg = this._library.getSubsonicServer(serverId);
    if (!cfg) {
      this._sendError(res, 404);
      return;
    }

    const reqSize = (size && size !== 'max' && size !== 'original') ? parseInt(size, 10) : 300;

    try {
      const { proxyRequest } = require('./subsonic');
      const { body, contentType } = await proxyRequest(
        cfg.server_url, cfg.username, cfg.password,
        'getCoverArt', { id: coverId, size: reqSize },
        cfg.protocol_mode || 'subsonic', 30.0
      );

      if (body && (contentType || '').startsWith('image/')) {
        this._library.writeSubsonicCoverCache(serverId, coverId, body, size);
      }

      const headers = {
        'Content-Type': contentType || 'image/jpeg',
        'Content-Length': body.length,
        'Cache-Control': 'public, max-age=86400',
        'Access-Control-Allow-Origin': '*',
      };
      if (method === 'HEAD') {
        this._sendHeaders(res, 200, headers);
      } else {
        this._sendHeaders(res, 200, headers);
        res.end(body);
      }
    } catch {
      this._sendError(res, 502);
    }
  }

  _handleSubsonicStream(req, res, raw, method) {
    const parsed = this._parseSubsonicPath(raw);
    if (!parsed) {
      this._sendError(res, 404);
      return;
    }
    const [serverId, subsonicId] = parsed;

    const cfg = this._library.getSubsonicServer(serverId);
    if (!cfg) {
      this._sendError(res, 404);
      return;
    }

    const { SubsonicClient } = require('./subsonic');
    const client = new SubsonicClient(
      cfg.server_url, cfg.username, cfg.password,
      cfg.protocol_mode || 'subsonic', 120.0
    );
    const streamUrl = client._buildUrl('stream', { id: subsonicId, maxBitRate: 0 });

    const lib = streamUrl.startsWith('https:') ? require('https') : require('http');
    const proxyReq = lib.request(streamUrl, {
      headers: {
        'User-Agent': 'Carminium/1.0',
        'Accept-Encoding': 'identity',
        'Connection': 'close',
      },
    }, (upstream) => {
      const contentType = upstream.headers['content-type'] || 'audio/mpeg';
      const contentLength = upstream.headers['content-length'];

      const headers = {
        'Content-Type': contentType,
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Access-Control-Allow-Origin': '*',
      };
      if (contentLength) headers['Content-Length'] = contentLength;

      if (method === 'HEAD') {
        this._sendHeaders(res, upstream.statusCode >= 400 ? 502 : 200, headers);
        upstream.destroy();
        return;
      }

      if (upstream.statusCode >= 400) {
        this._sendError(res, 502, 'Subsonic stream failed');
        upstream.destroy();
        return;
      }

      this._sendHeaders(res, 200, headers);
      upstream.on('data', (chunk) => {
        if (!res.write(chunk)) {
          upstream.pause();
          res.once('drain', () => upstream.resume());
        }
      });
      upstream.on('end', () => res.end());
      upstream.on('error', () => {
        try { res.end(); } catch {  }
      });
    });

    proxyReq.on('error', () => {
      try { this._sendError(res, 502, 'Subsonic stream failed'); } catch {  }
    });
    proxyReq.setTimeout(120000, () => {
      proxyReq.destroy(new Error('timeout'));
    });
    proxyReq.end();
  }

  async _proxySubsonicStreamForTrack(req, res, track, method) {
    const serverId = track.server_id;
    const subsonicId = track.subsonic_id;
    if (serverId === null || serverId === undefined || !subsonicId) {
      this._sendError(res, 404);
      return;
    }

    const cfg = this._library.getSubsonicServer(parseInt(serverId, 10));
    if (!cfg) {
      this._sendError(res, 404);
      return;
    }

    const { SubsonicClient } = require('./subsonic');
    const client = new SubsonicClient(
      cfg.server_url, cfg.username, cfg.password,
      cfg.protocol_mode || 'subsonic', 120.0
    );
    const streamUrl = client._buildUrl('stream', { id: subsonicId, maxBitRate: 0 });

    const lib = streamUrl.startsWith('https:') ? require('https') : require('http');
    const proxyReq = lib.request(streamUrl, {
      headers: {
        'User-Agent': 'Carminium/1.0',
        'Accept-Encoding': 'identity',
        'Connection': 'close',
      },
    }, (upstream) => {
      const contentType = upstream.headers['content-type'] || 'audio/mpeg';
      const contentLength = upstream.headers['content-length'];

      const headers = {
        'Content-Type': contentType,
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Access-Control-Allow-Origin': '*',
      };
      if (contentLength) headers['Content-Length'] = contentLength;

      if (method === 'HEAD') {
        this._sendHeaders(res, upstream.statusCode >= 400 ? 502 : 200, headers);
        upstream.destroy();
        return;
      }

      if (upstream.statusCode >= 400) {
        this._sendError(res, 502, 'Subsonic stream failed');
        upstream.destroy();
        return;
      }

      this._sendHeaders(res, 200, headers);
      upstream.on('data', (chunk) => {
        if (!res.write(chunk)) {
          upstream.pause();
          res.once('drain', () => upstream.resume());
        }
      });
      upstream.on('end', () => res.end());
      upstream.on('error', () => {
        try { res.end(); } catch {  }
      });
    });

    proxyReq.on('error', () => {
      try { this._sendError(res, 502, 'Subsonic stream failed'); } catch {  }
    });
    proxyReq.setTimeout(120000, () => {
      proxyReq.destroy(new Error('timeout'));
    });
    proxyReq.end();
  }


  _handleWebDAVStream(req, res, raw, method) {
    const slashIdx = raw.indexOf('/');
    if (slashIdx < 0) {
      this._sendError(res, 404);
      return;
    }
    const sidStr = raw.slice(0, slashIdx);
    const relativePath = raw.slice(slashIdx + 1);
    let serverId;
    try { serverId = parseInt(sidStr, 10); } catch {
      this._sendError(res, 404);
      return;
    }

    const cfg = this._library.getWebDAVServer(serverId);
    if (!cfg) {
      this._sendError(res, 404);
      return;
    }

    const { WebDAVClient } = require('./webdav');
    const client = new WebDAVClient(cfg.server_url, cfg.username, cfg.password, 120.0);
    const fileUrl = client.buildFileUrl('/' + relativePath);
    const authHeaders = client.getAuthHeaders();

    this._proxyHttpGet(req, res, fileUrl, authHeaders, method, 'WebDAV stream failed');
  }

  async _proxyWebDAVStreamForTrack(req, res, track, method) {
    const serverId = track.server_id;
    if (serverId === null || serverId === undefined) {
      this._sendError(res, 404);
      return;
    }

    const cfg = this._library.getWebDAVServer(parseInt(serverId, 10));
    if (!cfg) {
      this._sendError(res, 404);
      return;
    }

    let relativePath = track.path || '';
    const prefix = `webdav://${parseInt(serverId, 10)}`;
    if (relativePath.startsWith(prefix)) {
      relativePath = relativePath.slice(prefix.length);
    }

    const { WebDAVClient } = require('./webdav');
    const client = new WebDAVClient(cfg.server_url, cfg.username, cfg.password, 120.0);
    const fileUrl = client.buildFileUrl(relativePath);
    const authHeaders = client.getAuthHeaders();

    this._proxyHttpGet(req, res, fileUrl, authHeaders, method, 'WebDAV stream failed');
  }

  _proxyHttpGet(req, res, url, authHeaders, method, errorLabel) {
    const lib = url.startsWith('https:') ? require('https') : require('http');
    const urlObj = new URL(url);
    const tlsOpts = urlObj.protocol === 'https:' ? { rejectUnauthorized: false } : {};

    const proxyReq = lib.request({
      hostname: urlObj.hostname,
      port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method: method === 'HEAD' ? 'HEAD' : 'GET',
      headers: {
        'User-Agent': 'Carminium/1.0',
        'Accept-Encoding': 'identity',
        'Connection': 'close',
        ...authHeaders,
        ...(req.headers['range'] ? { 'Range': req.headers['range'] } : {}),
      },
      ...tlsOpts,
    }, (upstream) => {
      const contentType = upstream.headers['content-type'] || 'audio/mpeg';
      const contentLength = upstream.headers['content-length'];
      const contentRange = upstream.headers['content-range'];
      const acceptRanges = upstream.headers['accept-ranges'];

      const headers = {
        'Content-Type': contentType,
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Access-Control-Allow-Origin': '*',
      };
      if (contentLength) headers['Content-Length'] = contentLength;
      if (contentRange) headers['Content-Range'] = contentRange;
      if (acceptRanges) headers['Accept-Ranges'] = acceptRanges;

      const statusCode = upstream.statusCode >= 400 ? 502 : upstream.statusCode;

      if (method === 'HEAD') {
        this._sendHeaders(res, statusCode, headers);
        upstream.destroy();
        return;
      }

      if (upstream.statusCode >= 400) {
        this._sendError(res, 502, errorLabel || 'Stream failed');
        upstream.destroy();
        return;
      }

      this._sendHeaders(res, statusCode, headers);
      upstream.on('data', (chunk) => {
        if (!res.write(chunk)) {
          upstream.pause();
          res.once('drain', () => upstream.resume());
        }
      });
      upstream.on('end', () => res.end());
      upstream.on('error', () => {
        try { res.end(); } catch {  }
      });
    });

    proxyReq.on('error', () => {
      try { this._sendError(res, 502, errorLabel || 'Stream failed'); } catch {  }
    });
    proxyReq.setTimeout(120000, () => {
      proxyReq.destroy(new Error('timeout'));
    });
    proxyReq.end();
  }


  _getArtistImageCacheDir() {
    if (this._artistImgCacheDir) return this._artistImgCacheDir;
    let base = null;
    try {
      const electron = require('electron');
      if (electron && electron.app && electron.app.getPath) {
        base = electron.app.getPath('userData');
      }
    } catch (e) {  }
    if (!base) base = os.tmpdir();
    const dir = path.join(base, 'carminium-artist-images');
    try { fs.mkdirSync(dir, { recursive: true }); } catch (e) {  }
    this._artistImgCacheDir = dir;
    return dir;
  }

  _artistMissFresh(cacheFile, ttlMs = 7 * 24 * 3600 * 1000) {
    try {
      const st = fs.statSync(cacheFile + '.miss');
      return Date.now() - st.mtimeMs < ttlMs;
    } catch (e) { return false; }
  }

  _artistCacheStore(cacheFile, img) {
    try {
      if (img && img.buffer && (img.contentType || '').startsWith('image/')) {
        fs.writeFileSync(cacheFile, img.buffer);
        try { fs.unlinkSync(cacheFile + '.miss'); } catch (e) {  }
      } else {
        fs.writeFileSync(cacheFile + '.miss', String(Date.now()));
      }
    } catch (e) {  }
  }

  async _handleArtistImage(req, res, name, method) {
    await this._handleArtistImageCommon(req, res, name, method, '.jpg', (n) => this._fetchArtistImage(n));
  }

  async _handleArtistBanner(req, res, name, method) {
    await this._handleArtistImageCommon(req, res, name, method, '.wide.jpg', (n) => this._fetchArtistBanner(n));
  }

  async _handleArtistBio(req, res, name, method) {
    const norm = (name || '').trim();
    if (!norm) { this._sendError(res, 400); return; }

    const key = crypto.createHash('md5').update(norm.toLowerCase()).digest('hex');
    const cacheFile = path.join(this._getArtistImageCacheDir(), key + '.bio.txt');

    if (!this._artistInflight) this._artistInflight = {};

    if (fs.existsSync(cacheFile)) {
      try {
        const text = fs.readFileSync(cacheFile, 'utf-8');
        if (text) { this._sendImage(res, Buffer.from(text, 'utf-8'), method, 'text/plain; charset=utf-8'); return; }
      } catch (e) {  }
    }

    if (this._artistMissFresh(cacheFile)) {
      this._sendError(res, 404);
      return;
    }

    const inflightKey = 'bio:' + key;
    if (this._artistInflight[inflightKey]) {
      try {
        const buf = await this._artistInflight[inflightKey];
        if (buf) { this._sendImage(res, buf, method, 'text/plain; charset=utf-8'); return; }
      } catch (e) {  }
      this._sendError(res, 404);
      return;
    }

    this._artistInflight[inflightKey] = (async () => {
      let text = null;
      try {
        text = await this._fetchArtistBio(norm);
      } catch (e) {
        console.error('[artist-bio] fetch failed:', e && e.message);
      }
      try {
        if (text) {
          fs.writeFileSync(cacheFile, text, 'utf-8');
          try { fs.unlinkSync(cacheFile + '.miss'); } catch (e) {  }
        } else {
          fs.writeFileSync(cacheFile + '.miss', String(Date.now()));
        }
      } catch (e) {  }
      return text ? Buffer.from(text, 'utf-8') : null;
    })();

    try {
      const buf = await this._artistInflight[inflightKey];
      if (buf) { this._sendImage(res, buf, method, 'text/plain; charset=utf-8'); return; }
    } catch (e) {  }
    finally {
      delete this._artistInflight[inflightKey];
    }
    this._sendError(res, 404);
  }

  async _handleArtistImageCommon(req, res, name, method, ext, fetchFn) {
    const norm = (name || '').trim();
    if (!norm) { this._sendError(res, 400); return; }

    const key = crypto.createHash('md5').update(norm.toLowerCase()).digest('hex');
    const dir = this._getArtistImageCacheDir();
    const cacheFile = path.join(dir, key + ext);

    if (!this._artistInflight) this._artistInflight = {};

    if (fs.existsSync(cacheFile)) {
      try {
        const data = fs.readFileSync(cacheFile);
        this._sendImage(res, data, method);
        return;
      } catch (e) {  }
    }

    if (this._artistMissFresh(cacheFile)) {
      this._sendError(res, 404);
      return;
    }

    const inflightKey = ext + ':' + key;
    if (this._artistInflight[inflightKey]) {
      try {
        const buf = await this._artistInflight[inflightKey];
        if (buf) { this._sendImage(res, buf, method); return; }
      } catch (e) {  }
      this._sendError(res, 404);
      return;
    }

    this._artistInflight[inflightKey] = (async () => {
      let img = null;
      try {
        img = await fetchFn(norm);
        this._artistCacheStore(cacheFile, img);
      } catch (e) {
        console.error('[artist-image] fetch failed:', e && e.message);
      }
      return (img && img.buffer && (img.contentType || '').startsWith('image/')) ? img.buffer : null;
    })();

    try {
      const buf = await this._artistInflight[inflightKey];
      if (buf) { this._sendImage(res, buf, method); return; }
    } catch (e) {  }
    finally {
      delete this._artistInflight[inflightKey];
    }
    this._sendError(res, 404);
  }

  async _fetchArtistImage(name, timeoutMs = 6000, opts = {}) {
    const q = encodeURIComponent(name);

    const fromNetease = async () => {
      const ne = await this._httpPostFormJson(
        'https://music.163.com/api/search/get/web',
        { s: name, type: 100, offset: 0, total: 'true', limit: 1 },
        {
          'Referer': 'https://music.163.com/',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Carminium/1.0',
        },
        timeoutMs
      );
      if (!ne || ne.code !== 200) throw new Error('netease code ' + (ne && ne.code));
      const a = ne.result && ne.result.artists && ne.result.artists[0];
      let art = a && (a.img || a.img1v1Url || a.picUrl);
      if (art) {
        if (/([?&])param=\d+y\d+/.test(art)) {
          art = art.replace(/([?&])param=\d+y\d+/, '$1param=500y500');
        } else {
          art += '?param=500y500';
        }
        const img = await this._httpGet(art, 0, timeoutMs);
        if (img && img.contentType && img.contentType.startsWith('image/')) return img;
      }
      return null;
    };

    const fromItunes = async () => {
      const search = await this._httpJson(
        'https://itunes.apple.com/search?entity=musicArtist&limit=1&term=' + q,
        null, timeoutMs
      );
      if (search && search.results && search.results[0] && search.results[0].artworkUrl100) {
        const art = search.results[0].artworkUrl100.replace(/100x100bb(\.\w+)?$/, '600x600bb$1');
        const img = await this._httpGet(art, 0, timeoutMs);
        if (img && img.contentType && img.contentType.startsWith('image/')) return img;
      }
      return null;
    };

    const fromDeezer = async () => {
      const dz = await this._httpJson('https://api.deezer.com/search/artist/?q=' + q + '&limit=1', null, timeoutMs);
      const art = dz && dz.data && dz.data[0] && (dz.data[0].picture_big || dz.data[0].picture_xl);
      if (art) {
        const img = await this._httpGet(art, 0, timeoutMs);
        if (img && img.contentType && img.contentType.startsWith('image/')) return img;
      }
      return null;
    };

    const fromAudiodb = async () => {
      const adb = await this._httpJson('https://www.theaudiodb.com/api/v1/json/123/search.php?s=' + q, null, timeoutMs);
      const art = adb && adb.artists && adb.artists[0] && adb.artists[0].strArtistThumb;
      if (art) {
        const img = await this._httpGet(art, 0, timeoutMs);
        if (img && img.contentType && img.contentType.startsWith('image/')) return img;
      }
      return null;
    };

    const fromWikipedia = async () => {
      const summary = await this._httpJson(
        'https://en.wikipedia.org/api/rest_v1/page/summary/' + encodeURIComponent(name),
        null, timeoutMs
      );
      if (summary && summary.thumbnail && summary.thumbnail.source) {
        const img = await this._httpGet(summary.thumbnail.source, 0, timeoutMs);
        if (img && img.contentType && img.contentType.startsWith('image/')) return img;
      }
      return null;
    };

    const fromMusicbrainz = async () => {
      const mb = await this._httpJson('https://musicbrainz.org/ws/2/artist/?query=artist:' + q + '&fmt=json', null, timeoutMs);
      const id = mb && mb.artists && mb.artists[0] && mb.artists[0].id;
      if (id) {
        const detail = await this._httpJson('https://musicbrainz.org/ws/2/artist/' + id + '?inc=url-rels&fmt=json', null, timeoutMs);
        const rel = detail && detail.relations && detail.relations.find(function (r) { return r.type === 'image'; });
        const art = rel && rel.url && rel.url.resource;
        if (art) {
          const img = await this._httpGet(art, 0, timeoutMs);
          if (img && img.contentType && img.contentType.startsWith('image/')) return img;
        }
      }
      return null;
    };

    let sawError = false;
    const wrap = (fn) => async () => {
      try {
        return await fn();
      } catch (e) {
        sawError = true;
        throw e;
      }
    };

    const tiers = [
      opts.skipNetease ? [wrap(fromItunes)] : [wrap(fromNetease), wrap(fromItunes)],
      [wrap(fromAudiodb), wrap(fromDeezer)],
      [wrap(fromMusicbrainz), wrap(fromWikipedia)],
    ];
    const budget = timeoutMs * 2.5;
    const t0 = Date.now();
    for (let t = 0; t < tiers.length; t++) {
      if (t > 0 && Date.now() - t0 > budget) break;
      try {
        const img = await this._firstSuccess(tiers[t].map((fn) => fn()));
        if (img) return img;
      } catch (e) {  }
    }
    if (sawError) throw new Error('transient sources');
    return null;
  }

  async _fetchArtistBanner(name, timeoutMs = 6000) {
    const adb = await this._httpJson(
      'https://www.theaudiodb.com/api/v1/json/123/search.php?s=' + encodeURIComponent(name),
      null, timeoutMs
    );
    const a = adb && adb.artists && adb.artists[0];
    const art = a && (a.strArtistFanart || a.strArtistFanart2 || a.strArtistFanart3 || a.strArtistBanner);
    if (!art) return null;
    const img = await this._httpGet(art, 0, timeoutMs);
    if (img && img.contentType && img.contentType.startsWith('image/')) return img;
    return null;
  }

  async _fetchArtistBio(name, timeoutMs = 6000) {
    let sawError = false;
    const q = encodeURIComponent(name);

    try {
      const bk = await this._httpJson(
        'https://baike.baidu.com/api/openapi/BaikeLemmaCardApi?scope=103&format=json&appid=379020&bk_length=600&bk_key=' + q,
        { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Carminium/1.0' },
        timeoutMs
      );
      if (bk && bk.errCode) {
      } else if (bk && (bk.abstract || bk.desc)) {
        const txt = String(bk.abstract || bk.desc || '').trim();
        if (txt.length > 40) return this._cleanBioText(txt);
      }
    } catch (e) { sawError = true; }

    try {
      const ne = await this._httpPostFormJson(
        'https://music.163.com/api/search/get/web',
        { s: name, type: 100, offset: 0, total: 'true', limit: 1 },
        {
          'Referer': 'https://music.163.com/',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Carminium/1.0',
        },
        timeoutMs
      );
      if (!ne || ne.code !== 200) throw new Error('netease code ' + (ne && ne.code));
      const a = ne.result && ne.result.artists && ne.result.artists[0];
      const id = a && a.id;
      if (id) {
        const desc = await this._httpJson('https://music.163.com/api/artist/desc/' + id, null, timeoutMs);
        if (desc && desc.code && desc.code !== 200) throw new Error('netease desc code ' + desc.code);
        if (desc) {
          let txt = (typeof desc.briefDesc === 'string' ? desc.briefDesc : '').trim();
          if (!txt && Array.isArray(desc.introduction)) {
            txt = desc.introduction
              .map((x) => (x && typeof x.txt === 'string' ? x.txt : ''))
              .filter((s) => s.trim())
              .join('\n\n')
              .trim();
          }
          if (txt && txt.length > 40) return this._cleanBioText(txt);
        }
      }
    } catch (e) { sawError = true; }

    try {
      const adb = await this._httpJson(
        'https://www.theaudiodb.com/api/v1/json/123/search.php?s=' + q,
        null, timeoutMs
      );
      const a = adb && adb.artists && adb.artists[0];
      if (a) {
        const rank = (k) => {
          const suf = k.slice('strBiography'.length).toUpperCase();
          const pref = ['CN', 'ZH', 'EN'];
          const i = pref.indexOf(suf);
          return i === -1 ? pref.length : i;
        };
        const keys = Object.keys(a)
          .filter((k) => /^strBiography/.test(k) && typeof a[k] === 'string' && a[k].trim().length > 40)
          .sort((x, y) => rank(x) - rank(y));
        if (keys.length > 0) return this._cleanBioText(a[keys[0]]);
      }
    } catch (e) { sawError = true; }

    for (const lang of ['zh', 'en']) {
      try {
        const sum = await this._httpJson(
          'https://' + lang + '.wikipedia.org/api/rest_v1/page/summary/' + q,
          null, timeoutMs
        );
        if (sum && sum.type === 'standard' && sum.extract && sum.extract.trim().length > 40) {
          return this._cleanBioText(sum.extract);
        }
      } catch (e) { sawError = true; }
    }

    if (sawError) throw new Error('transient sources');
    return null;
  }

  _cleanBioText(raw) {
    let t = String(raw || '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li)>/gi, '\n\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#0?39;/g, "'")
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&nbsp;/g, ' ')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    if (t.length > 2000) {
      t = t.slice(0, 2000);
      const cut = Math.max(t.lastIndexOf('\n'), t.lastIndexOf('。'), t.lastIndexOf('. '));
      if (cut > 800) t = t.slice(0, cut + 1);
      t = t.trimEnd() + '…';
    }
    return t;
  }


  async _fetchArtistAliases(name, timeoutMs = 7000) {
    let sawError = false;
    let raw = [];
    const MB_UA = { 'User-Agent': 'Carminium/1.0 (desktop music player)' };

    try {
      const s = await this._httpJson(
        'https://musicbrainz.org/ws/2/artist/?query=' + encodeURIComponent(name) + '&fmt=json&limit=1',
        MB_UA, timeoutMs
      );
      const id = s && s.artists && s.artists[0] && s.artists[0].id;
      if (id) {
        const d = await this._httpJson(
          'https://musicbrainz.org/ws/2/artist/' + id + '?inc=aliases&fmt=json',
          MB_UA, timeoutMs
        );
        if (d && Array.isArray(d.aliases)) {
          raw = raw.concat(d.aliases.map((a) => a && a.name).filter(Boolean));
        }
      }
    } catch (e) { sawError = true; }

    try {
      const ne = await this._httpPostFormJson(
        'https://music.163.com/api/search/get/web',
        { s: name, type: 100, offset: 0, total: 'true', limit: 1 },
        {
          'Referer': 'https://music.163.com/',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Carminium/1.0',
        },
        timeoutMs
      );
      if (!ne || ne.code !== 200) throw new Error('netease code ' + (ne && ne.code));
      const a = ne.result && ne.result.artists && ne.result.artists[0];
      if (a && Array.isArray(a.alias)) raw = raw.concat(a.alias);
    } catch (e) {  }

    try {
      const adb = await this._httpJson(
        'https://www.theaudiodb.com/api/v1/json/123/search.php?s=' + encodeURIComponent(name),
        null, timeoutMs
      );
      const a = adb && adb.artists && adb.artists[0];
      if (a && typeof a.strArtistAlias === 'string' && a.strArtistAlias.trim()) {
        raw = raw.concat(a.strArtistAlias.split(/[,;、|]+/));
      }
    } catch (e) { sawError = true; }

    const aliases = this._cleanAliases(name, raw);
    if (aliases.length > 0) return aliases;
    if (sawError) throw new Error('transient sources');
    return null;
  }

  _cleanAliases(name, arr) {
    const norm = String(name || '').trim().toLowerCase();
    const out = [];
    const seen = new Set();
    for (const item of (Array.isArray(arr) ? arr : [])) {
      const s = String(item || '').replace(/\s+/g, ' ').trim();
      if (!s) continue;
      const k = s.toLowerCase();
      if (k === norm || seen.has(k)) continue;
      seen.add(k);
      out.push(s);
      if (out.length >= 20) break;
    }
    return out;
  }

  _getAliasIndex() {
    if (this._aliasIndex) return this._aliasIndex;
    const idx = new Map();
    try {
      const dir = this._getArtistImageCacheDir();
      const files = fs.readdirSync(dir).filter((f) => f.endsWith('.alias.json'));
      for (const f of files) {
        try {
          const obj = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8'));
          const name = obj && obj.name;
          const als = obj && obj.aliases;
          if (!name || !Array.isArray(als)) continue;
          for (const al of als) {
            const k = String(al).trim().toLowerCase();
            if (!k) continue;
            if (!idx.has(k)) idx.set(k, new Set());
            idx.get(k).add(name);
          }
        } catch (e) {  }
      }
    } catch (e) {  }
    this._aliasIndex = idx;
    return idx;
  }

  _handleArtistAliasSearch(req, res, query, method) {
    const qStr = decodeURIComponent(query || '').trim().toLowerCase();
    if (!qStr) {
      this._sendImage(res, Buffer.from('[]', 'utf-8'), method, 'application/json; charset=utf-8');
      return;
    }
    const idx = this._getAliasIndex();
    const names = [];
    const seen = new Set();
    for (const [alias, set] of idx) {
      if (!alias.includes(qStr)) continue;
      for (const n of set) {
        if (!seen.has(n)) { seen.add(n); names.push(n); }
        if (names.length >= 50) break;
      }
      if (names.length >= 50) break;
    }
    this._sendImage(res, Buffer.from(JSON.stringify(names), 'utf-8'), method, 'application/json; charset=utf-8');
  }

  async _handleArtistAliases(req, res, name, method) {
    const norm = (name || '').trim();
    if (!norm) { this._sendError(res, 400); return; }

    const key = crypto.createHash('md5').update(norm.toLowerCase()).digest('hex');
    const cacheFile = path.join(this._getArtistImageCacheDir(), key + '.alias.json');
    const sendJson = (obj) => this._sendImage(
      res, Buffer.from(JSON.stringify(obj), 'utf-8'), method, 'application/json; charset=utf-8'
    );

    if (!this._artistInflight) this._artistInflight = {};

    if (fs.existsSync(cacheFile)) {
      try {
        const obj = JSON.parse(fs.readFileSync(cacheFile, 'utf-8'));
        if (obj && Array.isArray(obj.aliases)) { sendJson(obj); return; }
      } catch (e) {  }
    }

    if (this._artistMissFresh(cacheFile)) { sendJson({ name: norm, aliases: [] }); return; }

    const inflightKey = 'alias:' + key;
    if (this._artistInflight[inflightKey]) {
      try {
        const buf = await this._artistInflight[inflightKey];
        if (buf) { sendJson(JSON.parse(buf.toString('utf-8'))); return; }
      } catch (e) {  }
      sendJson({ name: norm, aliases: [] });
      return;
    }

    this._artistInflight[inflightKey] = (async () => {
      let aliases = null;
      try {
        aliases = await this._fetchArtistAliases(norm);
      } catch (e) {
        console.error('[artist-alias] fetch failed:', e && e.message);
      }
      try {
        if (aliases && aliases.length) {
          fs.writeFileSync(cacheFile, JSON.stringify({ name: norm, aliases: aliases }), 'utf-8');
          try { fs.unlinkSync(cacheFile + '.miss'); } catch (e) {  }
          this._aliasIndex = null;
        } else {
          fs.writeFileSync(cacheFile + '.miss', String(Date.now()));
        }
      } catch (e) {  }
      return JSON.stringify({ name: norm, aliases: aliases || [] });
    })();

    try {
      const jsonStr = await this._artistInflight[inflightKey];
      sendJson(JSON.parse(jsonStr));
    } catch (e) {
      sendJson({ name: norm, aliases: [] });
    }
    finally {
      delete this._artistInflight[inflightKey];
    }
  }

  prefetchArtistAliases(names) {
    if (!Array.isArray(names) || names.length === 0) return { queued: 0 };
    if (!this._aliasPrefetchSet) this._aliasPrefetchSet = new Set();
    if (!this._aliasPrefetchQueue) this._aliasPrefetchQueue = [];
    if (this._aliasPrefetchActive == null) this._aliasPrefetchActive = 0;

    const dir = this._getArtistImageCacheDir();
    let added = 0;
    for (let i = 0; i < names.length; i++) {
      const norm = (names[i] || '').trim();
      if (!norm) continue;
      const key = crypto.createHash('md5').update(norm.toLowerCase()).digest('hex');
      if (this._aliasPrefetchSet.has(key)) continue;
      const cacheFile = path.join(dir, key + '.alias.json');
      if (fs.existsSync(cacheFile)) { this._aliasPrefetchSet.add(key); continue; }
      if (this._artistMissFresh(cacheFile)) { this._aliasPrefetchSet.add(key); continue; }
      this._aliasPrefetchSet.add(key);
      this._aliasPrefetchQueue.push({ name: norm, cacheFile: cacheFile });
      added++;
    }
    if (added > 0) this._pumpAliasPrefetch();
    return { queued: added, pending: this._aliasPrefetchQueue.length };
  }

  _pumpAliasPrefetch() {
    while (this._aliasPrefetchActive < 1 && this._aliasPrefetchQueue.length > 0) {
      const item = this._aliasPrefetchQueue.shift();
      this._aliasPrefetchActive++;
      this._fetchArtistAliases(item.name)
        .then((aliases) => {
          try {
            if (aliases && aliases.length) {
              fs.writeFileSync(item.cacheFile, JSON.stringify({ name: item.name, aliases: aliases }), 'utf-8');
              try { fs.unlinkSync(item.cacheFile + '.miss'); } catch (e) {  }
              this._aliasIndex = null;
            } else {
              fs.writeFileSync(item.cacheFile + '.miss', String(Date.now()));
            }
          } catch (e) {  }
        })
        .catch(() => {  })
        .then(() => {
          this._aliasPrefetchActive--;
          setTimeout(() => this._pumpAliasPrefetch(), 1100);
        });
    }
  }

  _firstSuccess(promises) {
    return new Promise((resolve, reject) => {
      let pending = promises.length;
      if (pending === 0) { reject(new Error('empty')); return; }
      let settled = false;
      promises.forEach((p) => {
        Promise.resolve(p).then(
          (v) => {
            if (settled) return;
            if (v) { settled = true; resolve(v); return; }
            if (--pending === 0) reject(new Error('all empty'));
          },
          () => {
            if (settled) return;
            if (--pending === 0) reject(new Error('all failed'));
          }
        );
      });
    });
  }

  prefetchArtistImages(names) {
    if (!Array.isArray(names) || names.length === 0) return { queued: 0 };
    if (!this._prefetchSet) this._prefetchSet = new Set();
    if (!this._prefetchQueue) this._prefetchQueue = [];
    if (this._prefetchActive == null) this._prefetchActive = 0;

    const dir = this._getArtistImageCacheDir();
    let added = 0;
    for (let i = 0; i < names.length; i++) {
      const norm = (names[i] || '').trim();
      if (!norm) continue;
      const key = crypto.createHash('md5').update(norm.toLowerCase()).digest('hex');
      if (this._prefetchSet.has(key)) continue;
      const cacheFile = path.join(dir, key + '.jpg');
      if (fs.existsSync(cacheFile)) { this._prefetchSet.add(key); continue; }
      if (this._artistMissFresh(cacheFile)) { this._prefetchSet.add(key); continue; }
      this._prefetchSet.add(key);
      this._prefetchQueue.push({ name: norm, cacheFile: cacheFile });
      added++;
    }

    if (added > 0) this._pumpPrefetch();
    return { queued: added, pending: this._prefetchQueue.length, concurrency: this._prefetchConcurrency() };
  }

  _prefetchConcurrency() {
    const threads = (typeof os.cpus === 'function' && os.cpus().length) || 1;
    return Math.max(1, Math.min(threads, 8));
  }

  _pumpPrefetch() {
    const N = this._prefetchConcurrency();
    while (this._prefetchActive < N && this._prefetchQueue.length > 0) {
      const item = this._prefetchQueue.shift();
      this._prefetchActive++;
      this._fetchArtistImage(item.name, 5000, { skipNetease: true })
        .then((img) => {
          if (img) this._artistCacheStore(item.cacheFile, img);
        })
        .catch(() => {  })
        .then(() => {
          this._prefetchActive--;
          setTimeout(() => this._pumpPrefetch(), 250);
        });
    }
  }

  _httpJson(urlStr, extraHeaders, timeoutMs = 15000) {
    return this._httpGet(urlStr, 0, timeoutMs, extraHeaders)
      .then(({ buffer }) => JSON.parse(buffer.toString('utf-8')));
  }

  _httpPostFormJson(urlStr, params, extraHeaders, timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
      const lib = urlStr.startsWith('https:') ? https : http;
      const body = Object.keys(params)
        .map((k) => encodeURIComponent(k) + '=' + encodeURIComponent(params[k]))
        .join('&');
      const req = lib.request(urlStr, {
        method: 'POST',
        headers: Object.assign({
          'User-Agent': 'Carminium/1.0',
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(body),
        }, extraHeaders || {}),
      }, (resp) => {
        const status = resp.statusCode;
        if (status !== 200) {
          resp.resume();
          reject(new Error('HTTP ' + status));
          return;
        }
        const chunks = [];
        resp.on('data', (c) => chunks.push(c));
        resp.on('end', () => {
          try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf-8'))); }
          catch (e) { reject(e); }
        });
      });
      req.on('error', reject);
      req.setTimeout(timeoutMs, () => req.destroy(new Error('timeout')));
      req.write(body);
      req.end();
    });
  }

  _httpGet(urlStr, redirects = 0, timeoutMs = 15000, extraHeaders) {
    return new Promise((resolve, reject) => {
      if (redirects > 5) { reject(new Error('too many redirects')); return; }
      const lib = urlStr.startsWith('https:') ? https : http;
      const req = lib.get(urlStr, {
        headers: Object.assign({ 'User-Agent': 'Carminium/1.0' }, extraHeaders || {}),
      }, (resp) => {
        const status = resp.statusCode;
        if (status >= 300 && status < 400 && resp.headers.location) {
          resp.resume();
          const next = new URL(resp.headers.location, urlStr).toString();
          resolve(this._httpGet(next, redirects + 1, timeoutMs, extraHeaders));
          return;
        }
        if (status !== 200) {
          resp.resume();
          reject(new Error('HTTP ' + status));
          return;
        }
        const chunks = [];
        resp.on('data', (c) => chunks.push(c));
        resp.on('end', () => resolve({
          buffer: Buffer.concat(chunks),
          contentType: resp.headers['content-type'] || 'image/jpeg',
        }));
      });
      req.on('error', reject);
      req.setTimeout(timeoutMs, () => req.destroy(new Error('timeout')));
    });
  }

  _sendImage(res, buffer, method, contentType = 'image/jpeg') {
    const headers = {
      'Content-Type': contentType,
      'Content-Length': buffer.length,
      'Cache-Control': 'public, max-age=86400',
      'Access-Control-Allow-Origin': '*',
    };
    this._sendHeaders(res, 200, headers);
    if (method !== 'HEAD') res.end(buffer);
  }
}

module.exports = { CoverHTTPServer };
