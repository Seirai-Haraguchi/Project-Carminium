/**
 * Carminium — 本地 Cover & Media HTTP Server
 * 在 127.0.0.1 随机端口监听：
 *   /cover/<track_id>                → JPEG 封面图片（本地曲目）
 *   /media/<track_id>                → 音频文件（支持 Range 请求）
 *   /subsonic/cover/<server_id>/<id> → Subsonic getCoverArt 代理
 *   /subsonic/stream/<server_id>/<id>→ Subsonic stream 代理
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

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
  return 'video/mp4'; // fallback
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

  // ── Cover ───────────────────────────────────────────────────────────────

  _handleCover(req, res, trackId, method) {
    const data = this._library.getCoverData(trackId);
    if (data) {
      const headers = {
        'Content-Type': 'image/jpeg',
        'Content-Length': data.length,
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Access-Control-Allow-Origin': '*',
      };
      if (method === 'HEAD') {
        this._sendHeaders(res, 200, headers);
      } else {
        this._sendHeaders(res, 200, headers);
        res.end(data);
      }
      return;
    }
    // 本地无封面：若为 Subsonic 曲目，代理到 Subsonic getCoverArt
    if (trackId.startsWith('s') && trackId.includes('_')) {
      this._proxySubsonicCoverForTrack(req, res, trackId, method);
      return;
    }
    this._sendError(res, 404);
  }

  async _proxySubsonicCoverForTrack(req, res, trackId, method) {
    const rest = trackId.slice(1); // 去掉前导 s
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

    // 1) 本地缓存命中
    const cached = this._library.readSubsonicCoverCache(serverId, coverId);
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

    // 2) 缓存未命中：代理获取
    const cfg = this._library.getSubsonicServer(serverId);
    if (!cfg) {
      this._sendError(res, 404);
      return;
    }

    try {
      const { proxyRequest } = require('./subsonic');
      const { body, contentType } = await proxyRequest(
        cfg.server_url, cfg.username, cfg.password,
        'getCoverArt', { id: coverId, size: 300 },
        cfg.protocol_mode || 'subsonic', 30.0
      );

      // 3) 写入缓存
      if (body && (contentType || '').startsWith('image/')) {
        this._library.writeSubsonicCoverCache(serverId, coverId, body);
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

  // ── Media（支持 Range 请求）────────────────────────────────────────────

  _resolveTrackPath(trackId) {
    const track = this._library.getTrack(trackId);
    if (!track) return null;
    if (track.source === 'subsonic') return null;
    const filePath = track.path || '';
    if (!filePath || !fs.existsSync(filePath)) return null;
    return filePath;
  }

  _handleMedia(req, res, trackId, method) {
    const filePath = this._resolveTrackPath(trackId);
    if (!filePath) {
      // Subsonic 曲目：代理到 stream 端点
      const track = this._library.getTrack(trackId);
      if (track && track.source === 'subsonic') {
        this._proxySubsonicStreamForTrack(req, res, track, method);
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

    // 解析 Range 头
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
      // 无 Range 头：返回完整文件
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
    const chunkSize = 256 * 1024; // 256KB
    let remaining = length;
    let pos = start;
    const fd = fs.openSync(filePath, 'r');

    function sendChunk() {
      if (remaining <= 0) {
        fs.closeSync(fd);
        res.end();
        return;
      }
      const toRead = Math.min(chunkSize, remaining);
      const buf = Buffer.alloc(toRead);
      const bytesRead = fs.readSync(fd, buf, 0, toRead, pos);
      if (bytesRead === 0) {
        fs.closeSync(fd);
        res.end();
        return;
      }
      res.write(buf.slice(0, bytesRead));
      pos += bytesRead;
      remaining -= bytesRead;
      sendChunk();
    }
    sendChunk();
  }

  // ── Video（支持 Range 请求）────────────────────────────────────────────

  /**
   * 将 base64url 编码的文件路径解码为原始路径。
   * @param {string} encoded - base64url 编码的路径
   * @returns {string|null} 解码后的文件路径，失败返回 null
   */
  _decodeVideoPath(encoded) {
    try {
      // base64url → base64
      let b64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
      // 补齐 padding
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

    // 解析 Range 头（与 /media/ 端点逻辑一致）
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

  // ── Subsonic 流式代理（封面 / 流式）────────────────────────────────────

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
    this._proxySubsonicCover(req, res, serverId, coverId, method);
  }

  async _proxySubsonicCover(req, res, serverId, coverId, method) {
    // 1) 本地缓存命中
    const cached = this._library.readSubsonicCoverCache(serverId, coverId);
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

    // 2) 缓存未命中：代理获取
    const cfg = this._library.getSubsonicServer(serverId);
    if (!cfg) {
      this._sendError(res, 404);
      return;
    }

    try {
      const { proxyRequest } = require('./subsonic');
      const { body, contentType } = await proxyRequest(
        cfg.server_url, cfg.username, cfg.password,
        'getCoverArt', { id: coverId, size: 300 },
        cfg.protocol_mode || 'subsonic', 30.0
      );

      if (body && (contentType || '').startsWith('image/')) {
        this._library.writeSubsonicCoverCache(serverId, coverId, body);
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

    // 使用 Node.js http/https 模块流式转发
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
        try { res.end(); } catch { /* ignore */ }
      });
    });

    proxyReq.on('error', () => {
      try { this._sendError(res, 502, 'Subsonic stream failed'); } catch { /* ignore */ }
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
        try { res.end(); } catch { /* ignore */ }
      });
    });

    proxyReq.on('error', () => {
      try { this._sendError(res, 502, 'Subsonic stream failed'); } catch { /* ignore */ }
    });
    proxyReq.setTimeout(120000, () => {
      proxyReq.destroy(new Error('timeout'));
    });
    proxyReq.end();
  }
}

module.exports = { CoverHTTPServer };
