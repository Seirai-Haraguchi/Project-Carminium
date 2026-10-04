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

  // ── Cover ───────────────────────────────────────────────────────────────

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
      // 本地封面：按请求尺寸缩放后返回（sharp 不可用时回退原图）
      this._sendResizedCover(req, res, trackId, data, size, method);
      return;
    }
    // 本地无封面：若为 Subsonic 曲目，代理到 Subsonic getCoverArt
    if (trackId.startsWith('s') && trackId.includes('_')) {
      this._proxySubsonicCoverForTrack(req, res, trackId, method, size);
      return;
    }
    // WebDAV 曲目：尝试从远程文件提取封面（异步代理 + 缓存）
    if (trackId.startsWith('w') && trackId.includes('_')) {
      this._proxyWebDAVCoverForTrack(req, res, trackId, method, size);
      return;
    }
    // SMB 曲目：有本地路径（挂载点），使用 library 的本地封面提取
    // SMB trackId 不以 s/w 开头，而是使用 trackId() 生成的 hash
    // 因此 getCoverDataAsync 已经在上面处理了
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

  // ── WebDAV 封面代理 ────────────────────────────────────────────────────

  /**
   * WebDAV 曲目封面：尝试从远程音频文件中提取内嵌封面图。
   * 策略：
   *   1) 先检查本地是否已缓存封面数据（library.getCoverData）
   *   2) 缓存未命中：下载远程文件头部 → 提取封面 → 缓存 → 返回
   *   3) 提取失败：返回 404
   *
   * trackId 格式: w<serverId>_<hash>
   */
  async _proxyWebDAVCoverForTrack(req, res, trackId, method, size) {
    // 1) 检查本地缓存（之前提取过并写入 library 的封面数据）
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

    // 2) 从数据库获取曲目信息
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

    // 3) 解析相对路径
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

      // 下载整个文件到临时目录（需要完整文件才能解析封面）
      const fs = require('fs');
      const os = require('os');
      const tmpDir = path.join(os.tmpdir(), 'carminium-webdav-covers');
      try { fs.mkdirSync(tmpDir, { recursive: true }); } catch { /* ignore */ }

      const safeName = (track.title || trackId).replace(/[^a-zA-Z0-9._-]/g, '_');
      const tmpFile = path.join(tmpDir, `cover_${trackId}_${Date.now()}_${safeName}.tmp`);

      try {
        // 下载文件
        const { body, statusCode } = await this._httpGetBuffer(fileUrl, authHeaders, 120.0);
        if (statusCode >= 400 || !body || body.length === 0) {
          this._sendError(res, 404);
          return;
        }

        fs.writeFileSync(tmpFile, body);

        // 使用 music-metadata 异步提取封面
        const coverData = await this._extractCoverAsync(tmpFile);
        if (coverData) {
          // 缓存到 library
          try {
            this._library.storeCoverData(trackId, coverData);
          } catch { /* ignore */ }

          // 返回缩放后的封面
          this._sendResizedCover(req, res, trackId, coverData, size, method);
        } else {
          this._sendError(res, 404);
        }
      } finally {
        try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
      }
    } catch (e) {
      console.warn('[cover-server] WebDAV cover extraction failed:', e && e.message);
      this._sendError(res, 404);
    }
  }

  /**
   * 下载远程文件到 Buffer（用于封面提取）。
   */
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

  /**
   * 从本地文件异步提取内嵌封面图（使用 music-metadata）。
   * @returns {Promise<Buffer|null>} JPEG 封面数据或 null
   */
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
        // 返回 JPEG 或原始格式数据
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

  // ── Media（支持 Range 请求）────────────────────────────────────────────

  _resolveTrackPath(trackId) {
    const track = this._library.getTrack(trackId);
    if (!track) return null;
    // Subsonic 和 WebDAV 曲目没有本地路径
    if (track.source === 'subsonic') return null;
    if (track.source === 'webdav') return null;
    // SMB 曲目有本地路径（挂载点路径），直接使用
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
      // WebDAV 曲目：代理到 WebDAV 服务器
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

  // ── WebDAV 流式代理 ────────────────────────────────────────────────────

  _handleWebDAVStream(req, res, raw, method) {
    // raw 格式: <server_id>/<relative_path>
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

    // track.path 格式: webdav://<serverId><relativePath>
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

  /**
   * 通用 HTTP GET 流式代理：将远程 HTTP 资源流式转发给客户端。
   * 支持 Range 请求透传和超时处理。
   */
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
        // 透传 Range 请求头
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
        try { res.end(); } catch { /* ignore */ }
      });
    });

    proxyReq.on('error', () => {
      try { this._sendError(res, 502, errorLabel || 'Stream failed'); } catch { /* ignore */ }
    });
    proxyReq.setTimeout(120000, () => {
      proxyReq.destroy(new Error('timeout'));
    });
    proxyReq.end();
  }

  // ── 艺人头像（免 key 在线抓取 + 磁盘缓存）────────────────────────────
  // 分层并行竞速（层内同时发起、任一命中即用；层间下探）：
  //   第 1 层）网易云音乐（CJK 权威）+ iTunes Search（覆盖好）
  //   第 2 层）Deezer Search + TheAudioDB
  //   第 3 层）Wikipedia REST 摘要图 + MusicBrainz image 关系
  // 统一取 ~500px 头像规格（30-150KB）；命中/miss 都落盘（miss 为负缓存，
  // TTL 7 天，期内直接 404 不再重爬）。
  // 缓存目录 userData/artist_images。

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

  /** 负缓存：记录"全部来源都无图"的艺人（TTL 内直接 404，不再重爬六源） */
  _artistMissFresh(cacheFile, ttlMs = 7 * 24 * 3600 * 1000) {
    try {
      const st = fs.statSync(cacheFile + '.miss');
      return Date.now() - st.mtimeMs < ttlMs;
    } catch (e) { return false; }
  }

  /** 落盘：命中写 jpg 并清掉 miss 标记；miss 写 .miss 时间戳 */
  _artistCacheStore(cacheFile, img) {
    try {
      if (img && img.buffer && (img.contentType || '').startsWith('image/')) {
        fs.writeFileSync(cacheFile, img.buffer);
        try { fs.unlinkSync(cacheFile + '.miss'); } catch (e) { /* 无 miss 文件 */ }
      } else {
        fs.writeFileSync(cacheFile + '.miss', String(Date.now()));
      }
    } catch (e) { /* ignore */ }
  }

  async _handleArtistImage(req, res, name, method) {
    await this._handleArtistImageCommon(req, res, name, method, '.jpg', (n) => this._fetchArtistImage(n));
  }

  /** 横版艺人头图（Apple Music 式横幅）：独立缓存 .wide.jpg，按需抓取、不参与后台预热 */
  async _handleArtistBanner(req, res, name, method) {
    await this._handleArtistImageCommon(req, res, name, method, '.wide.jpg', (n) => this._fetchArtistBanner(n));
  }

  /**
   * 艺人简介（纯文本）：独立缓存 .bio.txt，按需抓取、不参与后台预热。
   * 命中 200 text/plain；确认无简介 404（负缓存期内直接 404）。
   */
  async _handleArtistBio(req, res, name, method) {
    const norm = (name || '').trim();
    if (!norm) { this._sendError(res, 400); return; }

    const key = crypto.createHash('md5').update(norm.toLowerCase()).digest('hex');
    const cacheFile = path.join(this._getArtistImageCacheDir(), key + '.bio.txt');

    if (!this._artistInflight) this._artistInflight = {};

    // 1) 磁盘缓存命中
    if (fs.existsSync(cacheFile)) {
      try {
        const text = fs.readFileSync(cacheFile, 'utf-8');
        if (text) { this._sendImage(res, Buffer.from(text, 'utf-8'), method, 'text/plain; charset=utf-8'); return; }
      } catch (e) { /* 读取失败则重新抓取 */ }
    }

    // 2) 负缓存命中：TTL 内已知无简介，直接 404
    if (this._artistMissFresh(cacheFile)) {
      this._sendError(res, 404);
      return;
    }

    // 3) 并发去重（inflight 键与头像/横幅按类型隔离）
    const inflightKey = 'bio:' + key;
    if (this._artistInflight[inflightKey]) {
      try {
        const buf = await this._artistInflight[inflightKey];
        if (buf) { this._sendImage(res, buf, method, 'text/plain; charset=utf-8'); return; }
      } catch (e) { /* fallthrough → 404 */ }
      this._sendError(res, 404);
      return;
    }

    this._artistInflight[inflightKey] = (async () => {
      let text = null;
      try {
        text = await this._fetchArtistBio(norm);
      } catch (e) {
        // 瞬时故障：不写负缓存，下次请求重试
        console.error('[artist-bio] fetch failed:', e && e.message);
      }
      try {
        if (text) {
          fs.writeFileSync(cacheFile, text, 'utf-8');
          try { fs.unlinkSync(cacheFile + '.miss'); } catch (e) { /* 无 miss 文件 */ }
        } else {
          fs.writeFileSync(cacheFile + '.miss', String(Date.now()));
        }
      } catch (e) { /* ignore */ }
      return text ? Buffer.from(text, 'utf-8') : null;
    })();

    try {
      const buf = await this._artistInflight[inflightKey];
      if (buf) { this._sendImage(res, buf, method, 'text/plain; charset=utf-8'); return; }
    } catch (e) { /* ignore */ }
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

    // 1) 磁盘缓存命中
    if (fs.existsSync(cacheFile)) {
      try {
        const data = fs.readFileSync(cacheFile);
        this._sendImage(res, data, method);
        return;
      } catch (e) { /* 读取失败则重新抓取 */ }
    }

    // 2) 负缓存命中：TTL 内已知无图，直接 404（避免每次滚动都重爬六源）
    if (this._artistMissFresh(cacheFile)) {
      this._sendError(res, 404);
      return;
    }

    // 并发去重：同一艺人同一类型（头像/横幅）同时只抓一次；
    // inflight 键按 ext 区分，避免头像与横幅并发时互相串图
    const inflightKey = ext + ':' + key;
    if (this._artistInflight[inflightKey]) {
      try {
        const buf = await this._artistInflight[inflightKey];
        if (buf) { this._sendImage(res, buf, method); return; }
      } catch (e) { /* fallthrough → 404 */ }
      this._sendError(res, 404);
      return;
    }

    this._artistInflight[inflightKey] = (async () => {
      let img = null;
      try {
        img = await fetchFn(norm);
        this._artistCacheStore(cacheFile, img); // 命中写图 / 确认 miss 写负缓存
      } catch (e) {
        // 瞬时故障（限流/断网）：不写负缓存，下次请求重试
        console.error('[artist-image] fetch failed:', e && e.message);
      }
      return (img && img.buffer && (img.contentType || '').startsWith('image/')) ? img.buffer : null;
    })();

    try {
      const buf = await this._artistInflight[inflightKey];
      if (buf) { this._sendImage(res, buf, method); return; }
    } catch (e) { /* ignore */ }
    finally {
      delete this._artistInflight[inflightKey];
    }
    this._sendError(res, 404);
  }

  /**
   * 抓取艺人头像：分层并行竞速。
   * 层内多个源同时发起、任一命中即返回（命中延迟 ≈ 最快源，而非串行叠加）；
   * 层内全部落空才下探下一层。每源超时 timeoutMs，全 miss 最坏 ≈ 3 × timeoutMs。
   *
   * 返回值语义（供负缓存决策）：
   *   - 返回 img：命中
   *   - 返回 null：确认无图（至少一源明确回应"查无此人"且无任何源报错）
   *   - throw：瞬时故障（限流/断网），调用方不得写负缓存
   * opts.skipNetease：后台预热置 true——网易云搜索接口限流严格，
   * 只把配额留给前台按需请求。
   */
  async _fetchArtistImage(name, timeoutMs = 6000, opts = {}) {
    const q = encodeURIComponent(name);

    // 网易云音乐（免 key）：POST 搜索艺人（type=100）→ img/img1v1Url
    // （126.net CDN，?param= 控制尺寸；头像场景 500y500 足够，约 30-150KB，
    // 比 1024y1024 的 1.7MB 快一个数量级。方图只用于 208px 头像，不铺横幅）
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
      // 限流时 HTTP 仍是 200 但 body code=405（"操作频繁"）——必须当作错误
      // 抛出，否则会被误判成"查无此人"并毒化负缓存
      if (!ne || ne.code !== 200) throw new Error('netease code ' + (ne && ne.code));
      const a = ne.result && ne.result.artists && ne.result.artists[0];
      let art = a && (a.img || a.img1v1Url || a.picUrl);
      if (art) {
        // 已有 param= 则替换尺寸；裸 URL 则追加（CDN 支持任意图 URL 缩放）
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

    // iTunes Search（musicArtist）→ 600x600（Apple CDN，覆盖好）
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

    // Deezer Search（artist）→ picture_big 500x500（免 key）
    const fromDeezer = async () => {
      const dz = await this._httpJson('https://api.deezer.com/search/artist/?q=' + q + '&limit=1', null, timeoutMs);
      const art = dz && dz.data && dz.data[0] && (dz.data[0].picture_big || dz.data[0].picture_xl);
      if (art) {
        const img = await this._httpGet(art, 0, timeoutMs);
        if (img && img.contentType && img.contentType.startsWith('image/')) return img;
      }
      return null;
    };

    // TheAudioDB（公开测试 key 123，免注册）→ strArtistThumb
    const fromAudiodb = async () => {
      const adb = await this._httpJson('https://www.theaudiodb.com/api/v1/json/123/search.php?s=' + q, null, timeoutMs);
      const art = adb && adb.artists && adb.artists[0] && adb.artists[0].strArtistThumb;
      if (art) {
        const img = await this._httpGet(art, 0, timeoutMs);
        if (img && img.contentType && img.contentType.startsWith('image/')) return img;
      }
      return null;
    };

    // Wikipedia REST 摘要图（免 key，小众艺人兜底）
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

    // MusicBrainz → image 关系（古典/小众艺人终极兜底）
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

    // 分层竞速 + 瞬时故障跟踪：任一源因限流/网络抛错（sawError）时，
    // 即使全部落空也不确认 miss（防止把限流误判成"查无此人"毒化负缓存）。
    let sawError = false;
    const wrap = (fn) => async () => {
      try {
        return await fn();
      } catch (e) {
        sawError = true;
        throw e;
      }
    };

    // 第 1 层：网易云 + iTunes 并行（覆盖 95% 艺人；预热时跳过网易云省配额）；
    // 第 2 层：TheAudioDB + Deezer；第 3 层：MusicBrainz + Wikipedia（墙内
    // Wikipedia 基本必超时，放最后只给全 miss 兜底）。
    // 总预算 2.5 × timeoutMs：超过后不再下探，直接按已有结果收尾。
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
      } catch (e) { /* 下探下一层 */ }
    }
    if (sawError) throw new Error('transient sources'); // 有源报错：不确认 miss，防毒化负缓存
    return null; // 确认无图：所有下探均干净落空
  }

  /**
   * 抓取横版艺人头图（Apple Music 式横幅用）。只走 TheAudioDB：
   * strArtistFanart/2/3 为 1280x720 横版剧照，strArtistBanner 为横幅条，
   * 其余源（网易云/iTunes/Deezer）只有方形头像，对横幅无意义。
   * 独立于 _fetchArtistImage：banner 按需抓取，不进后台预热（TheAudioDB
   * 公共测试 key 限流严格，避免全库预热打爆配额）。
   */
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

  /**
   * 抓取艺人简介（纯文本，≤2000 字符）。分层取源，国内优先：
   *   第 0 源 百度百科 openapi（国内直连快、简中、覆盖中日西艺人）；
   *   第 1 源 网易云：search type=100 → id → /api/artist/desc/{id}（限流凶，命中靠运气）；
   *   第 2 源 TheAudioDB strBiography*（动态匹配语言字段，CN → EN → 其他）；
   *   第 3 源 Wikipedia REST 摘要（zh → en，墙内常超时，仅兜底）。
   * 返回值语义与头像抓取一致：null=确认无简介，throw=瞬时故障（不写负缓存）。
   */
  async _fetchArtistBio(name, timeoutMs = 6000) {
    let sawError = false;
    const q = encodeURIComponent(name);

    // 百度百科 openapi（免 key）：abstract 为简中摘要，覆盖华语/欧美/日本艺人
    try {
      const bk = await this._httpJson(
        'https://baike.baidu.com/api/openapi/BaikeLemmaCardApi?scope=103&format=json&appid=379020&bk_length=600&bk_key=' + q,
        { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Carminium/1.0' },
        timeoutMs
      );
      if (bk && bk.errCode) {
        // 明确查无词条（如多义词接口失败）：干净落空
      } else if (bk && (bk.abstract || bk.desc)) {
        const txt = String(bk.abstract || bk.desc || '').trim();
        if (txt.length > 40) return this._cleanBioText(txt);
      }
    } catch (e) { sawError = true; }

    // 网易云：搜索拿艺人 id，再拉取 desc（briefDesc 简中为主，introduction 为分段长文）
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
      // 限流时 HTTP 200 但 body code=405 —— 必须当错误抛，防毒化负缓存
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

    // TheAudioDB：search.php 与横幅/头像同源，一次响应含全部 strBiography* 字段
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

    // Wikipedia 摘要（zh → en）
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

    if (sawError) throw new Error('transient sources'); // 有源报错：不确认 miss，防毒化负缓存
    return null; // 确认无简介
  }

  /** 简介清洗：去 HTML 标签/实体、压缩空行、超长时按段落/句号截断到 ~2000 字符 */
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

  // ── 艺人别名（供"用别名搜到这个人"）────────────────────────────────────
  // 数据源：网易云 artist.alias（译名/别名，国内直连快）为主，TheAudioDB
  // strArtistAlias（存在时）为辅。缓存 <md5>.alias.json = {name, aliases}，
  // 无别名写 .miss 负缓存。后台预热并发压到 2、间隔 500ms（网易云搜索限流严）。

  /** 抓取艺人别名：返回去重后的别名字符串数组；null=确认无别名；throw=瞬时故障 */
  async _fetchArtistAliases(name, timeoutMs = 7000) {
    let sawError = false;
    let raw = [];
    const MB_UA = { 'User-Agent': 'Carminium/1.0 (desktop music player)' };

    // MusicBrainz aliases（直连可用，译名/别名数据最全，含中日韩英）。
    // 注意：搜索词不带引号（带引号对部分名失效）；MB 政策限速 ~1 req/s。
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

    // 网易云：search type=100 的 artist 对象自带 alias[]（译名/别名）。
    // 该搜索接口限流凶（405 频发），失败仅忽略——MB 已是主力。
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
    } catch (e) { /* 网易云限流常见：不置 sawError，MB 已是主力 */ }

    // TheAudioDB：strArtistAlias（逗号/分号分隔），字段不存在则跳过
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
    if (sawError) throw new Error('transient sources'); // 防瞬时故障被误判成"无别名"
    return null;
  }

  /** 别名清洗：去重、剔除与本名相同的项、封顶 20 条 */
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

  /** 别名索引：aliasLower → Set(artistName)，惰性扫描缓存目录构建；写新文件后置空重建 */
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
        } catch (e) { /* 跳过损坏文件 */ }
      }
    } catch (e) { /* 目录不可读：返回空索引 */ }
    this._aliasIndex = idx;
    return idx;
  }

  /** 别名搜索：返回命中别名的艺人名列表（≤50，按索引序） */
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

  /**
   * 单艺人别名（详情页显示用）：GET /artist-aliases/NAME → JSON {name, aliases}。
   * 与预热共用 <md5>.alias.json 缓存与 .miss 负缓存；命中后置空搜索索引。
   */
  async _handleArtistAliases(req, res, name, method) {
    const norm = (name || '').trim();
    if (!norm) { this._sendError(res, 400); return; }

    const key = crypto.createHash('md5').update(norm.toLowerCase()).digest('hex');
    const cacheFile = path.join(this._getArtistImageCacheDir(), key + '.alias.json');
    const sendJson = (obj) => this._sendImage(
      res, Buffer.from(JSON.stringify(obj), 'utf-8'), method, 'application/json; charset=utf-8'
    );

    if (!this._artistInflight) this._artistInflight = {};

    // 1) 磁盘缓存命中
    if (fs.existsSync(cacheFile)) {
      try {
        const obj = JSON.parse(fs.readFileSync(cacheFile, 'utf-8'));
        if (obj && Array.isArray(obj.aliases)) { sendJson(obj); return; }
      } catch (e) { /* 读取失败则重新抓取 */ }
    }

    // 2) 负缓存命中：TTL 内已知无别名，直接返回空集
    if (this._artistMissFresh(cacheFile)) { sendJson({ name: norm, aliases: [] }); return; }

    // 3) 并发去重
    const inflightKey = 'alias:' + key;
    if (this._artistInflight[inflightKey]) {
      try {
        const buf = await this._artistInflight[inflightKey];
        if (buf) { sendJson(JSON.parse(buf.toString('utf-8'))); return; }
      } catch (e) { /* fallthrough */ }
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
          try { fs.unlinkSync(cacheFile + '.miss'); } catch (e) { /* 无 */ }
          this._aliasIndex = null;
        } else {
          fs.writeFileSync(cacheFile + '.miss', String(Date.now()));
        }
      } catch (e) { /* ignore */ }
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

  // 后台预热别名（幂等）：并发 1 + 1100ms 间隔——MusicBrainz 政策要求
  // 平均 ≤1 req/s，每艺人消耗 2 请求（search + lookup），宁慢勿封
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
              try { fs.unlinkSync(item.cacheFile + '.miss'); } catch (e) { /* 无 */ }
              this._aliasIndex = null; // 索引置空，下次搜索重建
            } else {
              fs.writeFileSync(item.cacheFile + '.miss', String(Date.now()));
            }
          } catch (e) { /* ignore */ }
        })
        .catch(() => { /* 瞬时故障：留待下次启动重试 */ })
        .then(() => {
          this._aliasPrefetchActive--;
          setTimeout(() => this._pumpAliasPrefetch(), 1100);
        });
    }
  }

  /** 竞速：任一 promise 成功且结果非空即 resolve；全部失败/为空则 reject */
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
      if (this._artistMissFresh(cacheFile)) { this._prefetchSet.add(key); continue; }  // 负缓存期内，跳过
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

  // 泵式并发：在并发上限内持续从队列领取任务；每张图只有几十 KB，
  // worker 间隔 250ms 即可（原 1500ms 是为 MB 级大图设计的）
  _pumpPrefetch() {
    const N = this._prefetchConcurrency();
    while (this._prefetchActive < N && this._prefetchQueue.length > 0) {
      const item = this._prefetchQueue.shift();
      this._prefetchActive++;
      // 后台预热：短超时 + 跳过网易云（限流严格，配额留给前台按需请求）
      this._fetchArtistImage(item.name, 5000, { skipNetease: true })
        .then((img) => {
          // 预热只写命中、不写 miss：跳过了网易云就无法确认"真没图"，
          // 只有网易云有图的小众艺人若被写成负缓存会被错杀 7 天。
          // miss 由前台按需请求（含网易云）确认后落盘。
          if (img) this._artistCacheStore(item.cacheFile, img);
        })
        .catch(() => { /* 抓取失败则跳过，留待下次启动重试 */ })
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

  /** POST application/x-www-form-urlencoded 并解析 JSON（网易云搜索接口需要） */
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
