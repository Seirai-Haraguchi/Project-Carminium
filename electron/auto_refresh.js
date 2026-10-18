'use strict';

const fs = require('fs');
const path = require('path');
const { SUPPORTED_EXT } = require('./library');

const MAX_BATCH_MS = 15000;

class LibraryWatcher {
  constructor(library, settings, callbacks = {}) {
    this._lib = library;
    this._settings = settings;
    this._onChanged = callbacks.onChanged || (() => {});
    // 扫描走外部注入的函数（工作线程）；未注入时退回主进程内同步扫描
    this._scanFn = callbacks.scan || ((p, opts) => this._lib.syncFolderIncremental(p, opts));
    this._watchers = new Map();
    this._pending = new Map();
    this._scanState = new Map();
    this._pollTimer = null;
    this._startupTimers = [];
    this._closed = false;
  }

  get _enabled() {
    return this._settings.get('library_auto_watch', true) !== false;
  }

  start() {
    if (!this._enabled) {
      console.log('[auto-refresh] 本地库自动刷新已禁用（library_auto_watch=false）');
      return;
    }
    this.syncFolders();

    let delay = 3000;
    for (const f of this._lib.getFolders()) {
      const t = setTimeout(() => {
        if (!this._closed) this._checkFolder(f.path, { reason: 'startup' });
      }, delay);
      this._startupTimers.push(t);
      delay += 2000;
    }

    const pollMin = parseInt(this._settings.get('library_watch_poll_minutes', 10), 10) || 0;
    if (pollMin > 0) {
      this._pollTimer = setInterval(() => {
        if (this._closed) return;
        for (const f of this._lib.getFolders()) {
          this._checkFolder(f.path, { reason: 'poll' });
        }
      }, pollMin * 60 * 1000);
      if (this._pollTimer.unref) this._pollTimer.unref();
    }
    console.log(`[auto-refresh] FileWatcher 已启动（轮询兜底: ${pollMin > 0 ? pollMin + ' 分钟' : '关闭'}）`);
  }

  stop() {
    this._closed = true;
    if (this._pollTimer) { clearInterval(this._pollTimer); this._pollTimer = null; }
    for (const t of this._startupTimers) clearTimeout(t);
    this._startupTimers = [];
    for (const folderPath of Array.from(this._watchers.keys())) this._unwatch(folderPath);
    for (const p of this._pending.values()) {
      clearTimeout(p.timer);
      if (p.maxTimer) clearTimeout(p.maxTimer);
    }
    this._pending.clear();
  }

  syncFolders() {
    if (!this._enabled || this._closed) return;
    const wanted = new Set(this._lib.getFolders().map((f) => f.path));
    for (const folderPath of Array.from(this._watchers.keys())) {
      if (!wanted.has(folderPath)) this._unwatch(folderPath);
    }
    for (const folderPath of wanted) {
      if (!this._watchers.has(folderPath)) this._watch(folderPath);
    }
  }

  _watch(folderPath) {
    if (!fs.existsSync(folderPath)) return;
    const watchers = [];
    const onEvent = (_eventType, filename) => this._onFsEvent(folderPath, filename);
    try {
      const w = fs.watch(folderPath, { recursive: true }, onEvent);
      w.on('error', (e) => {
        console.warn(`[auto-refresh] watcher 错误，停止监控: ${folderPath}:`, e.message);
        this._unwatch(folderPath);
      });
      watchers.push(w);
    } catch (e) {
      console.warn(`[auto-refresh] recursive watch 不可用，退化为逐目录监控: ${folderPath}:`, e.message);
      for (const dir of this._collectDirs(folderPath)) {
        try {
          const w = fs.watch(dir, onEvent);
          w.on('error', () => {  });
          watchers.push(w);
        } catch {  }
      }
    }
    if (watchers.length > 0) {
      this._watchers.set(folderPath, watchers);
      console.log(`[auto-refresh] 正在监控: ${folderPath}（${watchers.length} 个 watcher）`);
    }
  }

  _collectDirs(root) {
    const dirs = [root];
    const stack = [root];
    while (stack.length > 0) {
      const dir = stack.pop();
      let entries;
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const sub = path.join(dir, entry.name);
          dirs.push(sub);
          stack.push(sub);
        }
      }
    }
    return dirs;
  }

  _unwatch(folderPath) {
    const ws = this._watchers.get(folderPath);
    if (ws) {
      for (const w of ws) { try { w.close(); } catch {  } }
      this._watchers.delete(folderPath);
    }
    const p = this._pending.get(folderPath);
    if (p) {
      clearTimeout(p.timer);
      if (p.maxTimer) clearTimeout(p.maxTimer);
      this._pending.delete(folderPath);
    }
  }

  _onFsEvent(folderPath, filename) {
    if (this._closed || !filename) return;
    const debounceMs = parseInt(this._settings.get('library_watch_debounce_ms', 3000), 10) || 3000;
    let p = this._pending.get(folderPath);
    if (!p) {
      p = { changedFiles: new Set(), timer: null, maxTimer: null };
      this._pending.set(folderPath, p);
      p.maxTimer = setTimeout(() => this._flush(folderPath), MAX_BATCH_MS);
      if (p.maxTimer.unref) p.maxTimer.unref();
    }
    p.changedFiles.add(String(filename));
    clearTimeout(p.timer);
    p.timer = setTimeout(() => this._flush(folderPath), debounceMs);
    if (p.timer.unref) p.timer.unref();
  }

  _flush(folderPath) {
    const p = this._pending.get(folderPath);
    if (!p) return;
    clearTimeout(p.timer);
    if (p.maxTimer) clearTimeout(p.maxTimer);
    this._pending.delete(folderPath);

    const sizeCheckPaths = [];
    for (const rel of p.changedFiles) {
      if (SUPPORTED_EXT.has(path.extname(rel).toLowerCase())) {
        sizeCheckPaths.push(path.resolve(folderPath, rel));
      }
    }
    this._checkFolder(folderPath, { reason: 'watch', sizeCheckPaths });
  }

  async _checkFolder(folderPath, { reason, sizeCheckPaths = null } = {}) {
    if (this._closed) return;
    const state = this._scanState.get(folderPath);
    if (state && state.running) {
      state.queued = { reason, sizeCheckPaths };
      return;
    }
    this._scanState.set(folderPath, { running: true, queued: null });
    try {
      const stats = await this._scanFn(folderPath, { sizeCheckPaths });
      if (stats && stats.changed) {
        console.log(
          `[auto-refresh] (${reason}) ${folderPath}: ` +
          `新增 ${stats.added} / 移除 ${stats.removed} / 更新 ${stats.updated} / 共 ${stats.total}`
        );
        this._onChanged(folderPath, stats);
      } else if (stats && stats.skipped) {
        console.log(`[auto-refresh] (${reason}) ${folderPath}: 跳过（目录不可用或疑似驱动器异常）`);
      }
    } catch (e) {
      console.error(`[auto-refresh] 分层扫描失败: ${folderPath}:`, e.message || e);
    } finally {
      const st = this._scanState.get(folderPath);
      this._scanState.delete(folderPath);
      if (st && st.queued && !this._closed) this._checkFolder(folderPath, st.queued);
    }
  }
}

class RemoteSyncScheduler {
  constructor(library, settings, syncFn) {
    this._lib = library;
    this._settings = settings;
    this._syncFn = syncFn;
    this._timer = null;
    this._startupTimer = null;
    this._closed = false;
  }

  get _enabled() {
    return this._settings.get('subsonic_auto_sync', true) !== false;
  }

  get _intervalMin() {
    return parseInt(this._settings.get('subsonic_sync_interval_minutes', 30), 10) || 0;
  }

  start() {
    if (!this._enabled) {
      console.log('[auto-refresh] 远程库定期 re-sync 已禁用（subsonic_auto_sync=false）');
      return;
    }
    const intervalMin = this._intervalMin;
    if (intervalMin <= 0) {
      console.log('[auto-refresh] 远程库定期 re-sync 间隔为 0，不启用');
      return;
    }

    this._startupTimer = setTimeout(() => {
      if (this._closed) return;
      const cutoff = Date.now() / 1000 - intervalMin * 60;
      for (const srv of this._lib.getSubsonicServers()) {
        if (!srv.last_sync || srv.last_sync < cutoff) this._safeSync(srv.id, 'startup-stale');
      }
    }, 15000);
    if (this._startupTimer.unref) this._startupTimer.unref();

    this._timer = setInterval(() => {
      if (this._closed) return;
      for (const srv of this._lib.getSubsonicServers()) this._safeSync(srv.id, 'interval');
    }, intervalMin * 60 * 1000);
    if (this._timer.unref) this._timer.unref();
    console.log(`[auto-refresh] 远程库定期 re-sync 已启动（每 ${intervalMin} 分钟）`);
  }

  stop() {
    this._closed = true;
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
    if (this._startupTimer) { clearTimeout(this._startupTimer); this._startupTimer = null; }
  }

  _safeSync(serverId, reason) {
    try {
      const result = this._syncFn(serverId);
      let msg = null;
      try { msg = (typeof result === 'string') ? JSON.parse(result) : result; } catch {  }
      if (msg && msg.ok === false) {
        console.log(`[auto-refresh] 远程库 #${serverId} (${reason}) 跳过: ${msg.error}`);
      } else {
        console.log(`[auto-refresh] 远程库 #${serverId} (${reason}) re-sync 已开始`);
      }
    } catch (e) {
      console.error(`[auto-refresh] 远程库 #${serverId} (${reason}) 触发失败:`, e.message || e);
    }
  }
}

module.exports = { LibraryWatcher, RemoteSyncScheduler };
