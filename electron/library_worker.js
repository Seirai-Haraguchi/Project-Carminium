'use strict';

// 音乐库工作线程：承载「扫描/增量同步」与「长列表（tracks/albums/artists）计算」，
// 让主进程不被这些 CPU/IO 密集任务阻塞。通过 postMessage 与主进程通信：
//   入: { id, type, ... }  type ∈ scan_folder | dump | set_separators
//   出: { id, ok, result | error } 与 { type: 'scan_status', ... }
// 数据库使用独立的 better-sqlite3 连接（WAL 模式支持多连接并发读写）。

const { parentPort, workerData } = require('worker_threads');

const DATA_DIR = workerData && workerData.dataDir;
let _separators = (workerData && workerData.separators) || ';';

let _lib = null;
function _getLib() {
  if (_lib) return _lib;
  const { MusicLibrary } = require('./library');
  _lib = new MusicLibrary({
    dataDir: DATA_DIR,
    get: (key, def) => (key === 'artist_separators' ? _separators : def),
  });
  return _lib;
}

function _post(msg) {
  try { parentPort.postMessage(msg); } catch {  }
}

async function _handle(msg) {
  const { id, type } = msg;
  try {
    if (type === 'set_separators') {
      _separators = msg.value || ';';
      _post({ id, ok: true, result: true });
      return;
    }

    if (type === 'scan_folder') {
      const lib = _getLib();
      _post({
        type: 'scan_status',
        folder: msg.folderPath,
        phase: 'start',
        incremental: !!msg.incremental,
      });
      const onProgress = (p) => _post({
        type: 'scan_status',
        folder: msg.folderPath,
        incremental: !!msg.incremental,
        ...p,
      });
      const res = msg.incremental
        ? await lib.syncFolderIncremental(msg.folderPath, {
            sizeCheckPaths: msg.sizeCheckPaths || null,
            onProgress,
          })
        : await lib.scanFolder(msg.folderPath, { onProgress });
      // 主进程侧还会写库（收藏/歌单/远程同步等），worker 的去重缓存每次扫描后作废
      lib._invalidateDedupCache();
      _post({
        type: 'scan_status',
        folder: msg.folderPath,
        phase: 'done',
        incremental: !!msg.incremental,
        ...(res || {}),
      });
      _post({ id, ok: true, result: res || null });
      return;
    }

    if (type === 'dump') {
      const lib = _getLib();
      // 每次导出前重建去重信息，保证反映主进程侧最近的写库结果
      lib._invalidateDedupCache();
      let json;
      if (msg.what === 'albums') json = JSON.stringify(lib.getAlbums());
      else if (msg.what === 'artists') json = JSON.stringify(lib.getArtists());
      else json = JSON.stringify(lib.getAllTracks());
      _post({ id, ok: true, result: json });
      return;
    }

    _post({ id, ok: false, error: 'unknown command: ' + type });
  } catch (e) {
    _post({ id, ok: false, error: (e && e.message) || String(e) });
    if (msg && msg.type === 'scan_folder') {
      _post({
        type: 'scan_status',
        folder: msg.folderPath,
        phase: 'error',
        error: (e && e.message) || String(e),
      });
    }
  }
}

// 扫描命令串行化（同一时刻只跑一个扫描），dump 等读命令可与扫描并发（WAL 快照读）
let _scanChain = Promise.resolve();

parentPort.on('message', (msg) => {
  if (!msg || typeof msg !== 'object') return;
  if (msg.type === 'scan_folder') {
    _scanChain = _scanChain.then(() => _handle(msg)).catch(() => {  });
  } else {
    _handle(msg);
  }
});
