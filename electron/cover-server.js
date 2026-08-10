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
  return 'video/mp4'; // fallback
}

// ── 封面尺寸缩放（按需；依赖 sharp，不可用时回退原始分辨率）──────────
// 目的是按前端请求的 ?size=N 返回对应尺寸的 JPEG，避免下载/解码超大原图，
// 从而显著降低内存与带宽占用。
let _sharpModule = undefined;
function _getSharp() {
  if (_sharpModule === undefined) {
    try {
      _sharpModule = require('sharp');
      // libvips 默认操作缓存可达 ~50MB（驻留主进程 RSS），封面缩放是低频小图操作，
      // 收紧缓存并串行化并发，换取常驻内存大幅下降，功能与输出质量不受影响
      _sharpModule.cache({ memory: 8, files: 0, items: 30 });
      _sharpModule.concurrency(1);
    } catch (e) {
      _sharpModule = null;
      console.warn('[cover-server] sharp 不可用，封面将按原始分辨率返回：', e && e.message);
    }
  }
  return _sharpModule;
}

// 缩放结果缓存（按 track_id + 尺寸），避免对热门曲目重复解码
// 2026-08：从 300 降至 80，每张缩略图 ~10-50KB，80 张 ≈ 0.8-4MB
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
  if (!sharp) return buffer; // 无 sharp：回退原图

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

  /** 清空封面缩放缓存（内存压力时调用） */
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
      } else if (pathname.startsWith('/artist-image/')) {
        const name = decodeURIComponent(pathname.slice('/artist-image/'.length));
        this._handleArtistImage(req, res, name, method);
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
    const size = _parseSizeFromUrl(req.url);
    const data = this._library.getCoverData(trackId);
    if (data) {
      // 本地封面：按请求尺寸缩放后返回（sharp 不可用时回退原图）
      this._sendResizedCover(req, res, trackId, data, size, method);
      return;
    }
    // 本地无封面：若为 Subsonic 曲目，代理到 Subsonic getCoverArt
    if (trackId.startsWith('s') && trackId.includes('_')) {
      this._proxySubsonicCoverForTrack(req, res, trackId, method, size);
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
        // 封面按 trackId+size 寻址且内容稳定：允许 Chromium HTTP 缓存命中，
        // 避免同一封面跨页面/跨会话反复拉取与解码（no-store 会强制每次全量重取）
        'Cache-Control': 'private, max-age=300',
        'Access-Control-Allow-Origin': '*',
      };
      this._sendHeaders(res, 200, headers);
      if (method !== 'HEAD') res.end(out);
    } catch (e) {
      // 兜底：直接返回原图
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

    // 1) 本地缓存命中（按请求尺寸）
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

    // 2) 缓存未命中：代理获取
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

      // 3) 写入缓存（按请求尺寸）
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
    // 以前は fs.openSync + fs.readSync のループで同期的に読み出していたが、
    // これがメインプロセスのイベントループを長時間ブロックし、
    // 特に大きな FLAC ファイルの Range リクエスト時に
    // audio_output IPC の処理が滞って WASAPI バッファアンダーラン →
    // 「なんだか分からないけど止まる」原因になっていた。
    // createReadStream は I/O を libuv スレッドプールに逃がすため、
    // メインスレッドをブロックしない。
    const stream = fs.createReadStream(filePath, {
      start,
      end: start + length - 1, // createReadStream の end は inclusive
      highWaterMark: 256 * 1024, // 256KB（旧 chunkSize と同等）
    });
    stream.on('error', (err) => {
      console.error('[cover-server] stream error:', err.message);
      try { res.destroy(); } catch { /* ignore */ }
    });
    // res がクライアント側から切断された場合はストリームも停止
    res.on('close', () => {
      try { stream.destroy(); } catch { /* ignore */ }
    });
    stream.pipe(res);
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
    const size = _parseSizeFromUrl(req.url);
    this._proxySubsonicCover(req, res, serverId, coverId, method, size);
  }

  async _proxySubsonicCover(req, res, serverId, coverId, method, size) {
    // 1) 本地缓存命中（按请求尺寸）
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

    // 2) 缓存未命中：代理获取
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

  // ── 艺人头像（免 key 在线抓取 + 磁盘缓存）────────────────────────────
  // 来源链（任一失败自动下探）：
  //   1) iTunes Search（musicArtist，Apple CDN，覆盖好）
  //   2) Deezer Search（artist → picture_xl 1000x1000，免 key）
  //   3) TheAudioDB（公开测试 key 123 → strArtistThumb，免注册）
  //   4) Wikipedia REST 摘要图（免 key，小众艺人兜底）
  //   5) MusicBrainz → image 关系（古典/小众艺人终极兜底）
  // 命中后缓存到 userData/artist_images，后续直接从磁盘返回。

  _getArtistImageCacheDir() {
    if (this._artistImgCacheDir) return this._artistImgCacheDir;
    let base = null;
    try {
      const electron = require('electron');
      if (electron && electron.app && electron.app.getPath) {
        base = electron.app.getPath('userData');
      }
    } catch (e) { /* 测试环境无 electron */ }
    if (!base) base = os.tmpdir();
    const dir = path.join(base, 'carminium-artist-images');
    try { fs.mkdirSync(dir, { recursive: true }); } catch (e) { /* ignore */ }
    this._artistImgCacheDir = dir;
    return dir;
  }

  async _handleArtistImage(req, res, name, method) {
    const norm = (name || '').trim();
    if (!norm) { this._sendError(res, 400); return; }

    const key = crypto.createHash('md5').update(norm.toLowerCase()).digest('hex');
    const dir = this._getArtistImageCacheDir();
    const cacheFile = path.join(dir, key + '.jpg');

    if (!this._artistInflight) this._artistInflight = {};

    // 1) 磁盘缓存命中
    if (fs.existsSync(cacheFile)) {
      try {
        const data = fs.readFileSync(cacheFile);
        this._sendImage(res, data, method);
        return;
      } catch (e) { /* 读取失败则重新抓取 */ }
    }

    // 并发去重：同一艺人同时只抓一次（后台预热与详情页请求共用）
    if (this._artistInflight[key]) {
      try {
        const buf = await this._artistInflight[key];
        if (buf) { this._sendImage(res, buf, method); return; }
      } catch (e) { /* fallthrough → 404 */ }
      this._sendError(res, 404);
      return;
    }

    this._artistInflight[key] = (async () => {
      let img = null;
      try { img = await this._fetchArtistImage(norm); } catch (e) {
        console.error('[artist-image] fetch failed:', e && e.message);
      }
      if (img && img.buffer && (img.contentType || '').startsWith('image/')) {
        try { fs.writeFileSync(cacheFile, img.buffer); } catch (e) { /* ignore */ }
        return img.buffer;
      }
      return null;
    })();

    try {
      const buf = await this._artistInflight[key];
      if (buf) { this._sendImage(res, buf, method); return; }
    } catch (e) { /* ignore */ }
    finally {
      delete this._artistInflight[key];
    }
    this._sendError(res, 404);
  }

  async _fetchArtistImage(name, timeoutMs = 15000) {
    const q = encodeURIComponent(name);

    // 1) iTunes Search（musicArtist）→ 600x600（Apple CDN，覆盖好）
    try {
      const search = await this._httpJson(
        'https://itunes.apple.com/search?entity=musicArtist&limit=1&term=' + q
      );
      if (search && search.results && search.results[0] && search.results[0].artworkUrl100) {
        let art = search.results[0].artworkUrl100.replace(/100x100bb(\.\w+)?$/, '600x600bb$1');
        const img = await this._httpGet(art, 0, timeoutMs);
        if (img && img.contentType && img.contentType.startsWith('image/')) return img;
      }
    } catch (e) { /* 尝试下一来源 */ }

    // 2) Deezer Search（artist）→ picture_xl 1000x1000（免 key）
    try {
      const dz = await this._httpJson('https://api.deezer.com/search/artist/?q=' + q + '&limit=1');
      const art = dz && dz.data && dz.data[0] && (dz.data[0].picture_xl || dz.data[0].picture_big);
      if (art) {
        const img = await this._httpGet(art, 0, timeoutMs);
        if (img && img.contentType && img.contentType.startsWith('image/')) return img;
      }
    } catch (e) { /* 尝试下一来源 */ }

    // 3) TheAudioDB（公开测试 key 123，免注册）→ strArtistThumb
    try {
      const adb = await this._httpJson('https://www.theaudiodb.com/api/v1/json/123/search.php?s=' + q);
      const art = adb && adb.artists && adb.artists[0] && adb.artists[0].strArtistThumb;
      if (art) {
        const img = await this._httpGet(art, 0, timeoutMs);
        if (img && img.contentType && img.contentType.startsWith('image/')) return img;
      }
    } catch (e) { /* 尝试下一来源 */ }

    // 4) Wikipedia REST 摘要图（兜底）
    try {
      const summary = await this._httpJson(
        'https://en.wikipedia.org/api/rest_v1/page/summary/' + encodeURIComponent(name)
      );
      if (summary && summary.thumbnail && summary.thumbnail.source) {
        const img = await this._httpGet(summary.thumbnail.source, 0, timeoutMs);
        if (img && img.contentType && img.contentType.startsWith('image/')) return img;
      }
    } catch (e) { /* 尝试下一来源 */ }

    // 5) MusicBrainz → 直接 image 关系（古典/小众艺人终极兜底）
    try {
      const mb = await this._httpJson('https://musicbrainz.org/ws/2/artist/?query=artist:' + q + '&fmt=json');
      const id = mb && mb.artists && mb.artists[0] && mb.artists[0].id;
      if (id) {
        const detail = await this._httpJson('https://musicbrainz.org/ws/2/artist/' + id + '?inc=url-rels&fmt=json');
        const rel = detail && detail.relations && detail.relations.find(function (r) { return r.type === 'image'; });
        const art = rel && rel.url && rel.url.resource;
        if (art) {
          const img = await this._httpGet(art, 0, timeoutMs);
          if (img && img.contentType && img.contentType.startsWith('image/')) return img;
        }
      }
    } catch (e) { /* 放弃 */ }

    return null;
  }

  // ── 后台预热（本地库慢慢缓存）─────────────────────────────────────────────
  // 由渲染进程在启动/库更新时调用：传入全部艺人名，主进程在后台以并发队列
  // 逐个抓取并落盘。并发路数 = CPU 线程数（封顶 8）。已缓存或已入队的自动跳过，
  // 因此可反复调用、幂等。
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
      if (this._prefetchSet.has(key)) continue;           // 本会话已处理/已入队
      const cacheFile = path.join(dir, key + '.jpg');
      if (fs.existsSync(cacheFile)) { this._prefetchSet.add(key); continue; }  // 已缓存
      this._prefetchSet.add(key);
      this._prefetchQueue.push({ name: norm, cacheFile: cacheFile });
      added++;
    }

    if (added > 0) this._pumpPrefetch();
    return { queued: added, pending: this._prefetchQueue.length, concurrency: this._prefetchConcurrency() };
  }

  // 并发路数：按 CPU 线程数决定，封顶 8（避免过多并发连接挤占前台）
  _prefetchConcurrency() {
    const threads = (typeof os.cpus === 'function' && os.cpus().length) || 1;
    return Math.max(1, Math.min(threads, 8));
  }

  // 泵式并发：在并发上限内持续从队列领取任务；每个 worker 抓完一个后歇 1500ms 再领下一个
  _pumpPrefetch() {
    const N = this._prefetchConcurrency();
    while (this._prefetchActive < N && this._prefetchQueue.length > 0) {
      const item = this._prefetchQueue.shift();
      this._prefetchActive++;
      // 后台抓取用更短的每源超时（6s），整条链路最坏约 30s，避免单艺人在墙后长期占队列
      this._fetchArtistImage(item.name, 6000)
        .then((img) => {
          if (img && img.buffer && (img.contentType || '').startsWith('image/')) {
            try { fs.writeFileSync(item.cacheFile, img.buffer); } catch (e) { /* ignore */ }
          }
        })
        .catch(() => { /* 抓取失败则跳过，留待下次启动重试 */ })
        .then(() => {
          this._prefetchActive--;
          // 慢慢来：每个 worker 抓完一个后间隔 1500ms 再领下一个，不挤占前台网络/CPU
          setTimeout(() => this._pumpPrefetch(), 1500);
        });
    }
  }

  _httpJson(urlStr) {
    return this._httpGet(urlStr).then(({ buffer }) => JSON.parse(buffer.toString('utf-8')));
  }

  _httpGet(urlStr, redirects = 0, timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
      if (redirects > 5) { reject(new Error('too many redirects')); return; }
      const lib = urlStr.startsWith('https:') ? https : http;
      const req = lib.get(urlStr, {
        headers: { 'User-Agent': 'Carminium/1.0' },
      }, (resp) => {
        const status = resp.statusCode;
        if (status >= 300 && status < 400 && resp.headers.location) {
          resp.resume();
          const next = new URL(resp.headers.location, urlStr).toString();
          resolve(this._httpGet(next, redirects + 1));
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
