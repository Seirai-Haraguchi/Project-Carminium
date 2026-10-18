'use strict';

const { ipcMain } = require('electron');

const _THRESHOLDS = {
  off:        { soft: 300, hard: 400, critical: 500 },
  normal:     { soft: 200, hard: 280, critical: 350 },
  aggressive: { soft: 150, hard: 200, critical: 260 },
};

let RSS_SOFT_MB = 200;
let RSS_HARD_MB = 280;
let RSS_CRITICAL_MB = 350;

const MONITOR_NORMAL_MS = 20_000;
const MONITOR_ELEVATED_MS = 10_000;
const MONITOR_CRITICAL_MS = 5_000;
const CLEANUP_INTERVAL_MS = 30_000;
const RENDERER_REPORT_TIMEOUT_MS = 90_000;


class MemoryManager {
  constructor() {
    this._monitorTimer = null;
    this._cleanupTimer = null;

    this._disposables = new Map();
    this._nextId = 1;

    this._finalization = new FinalizationRegistry((id) => {
      this._disposables.delete(id);
    });

    this._history = [];
    this._maxHistory = 20;

    this._rendererStats = null;
    this._rendererLastReport = 0;

    this._ipcRegistered = false;

    this._gc = (typeof global.gc === 'function') ? global.gc : null;

    this._cleanupCallbacks = [];

    this._pressureLevel = 'normal';
    this._emergencyMode = false;

    this._emergencyCallbacks = [];

    this._killCount = 0;
  }


  start() {
    if (this._monitorTimer) return;
    this._scheduleMonitor(MONITOR_NORMAL_MS);
    this._cleanupTimer = setInterval(() => this._runCleanup(), CLEANUP_INTERVAL_MS);
    this._monitor();
    this._startMetricsProbe();

    if (!this._ipcRegistered) {
      this._registerIpc();
      this._ipcRegistered = true;
    }

    console.log('[MemoryManager] Strict mode v3 started —',
      'soft:', RSS_SOFT_MB + 'MB, hard:', RSS_HARD_MB + 'MB, critical:', RSS_CRITICAL_MB + 'MB,',
      'gc:', this._gc ? 'available' : 'not available');
  }

  stop() {
    if (this._monitorTimer) { clearInterval(this._monitorTimer); this._monitorTimer = null; }
    if (this._cleanupTimer) { clearInterval(this._cleanupTimer); this._cleanupTimer = null; }
  }

  _startMetricsProbe() {
    const probePath = process.env.CARMINIUM_MEM_PROBE;
    if (!probePath) return;
    const fsMod = require('fs');
    try { fsMod.writeFileSync(probePath, 'ts_ms,type,pid,rss_mb,cpu\n'); } catch (_) { return; }
    const timer = setInterval(() => {
      try {
        const { app } = require('electron');
        const rows = [];
        const ts = Date.now();
        for (const m of app.getAppMetrics()) {
          const rssMB = ((m.memory && m.memory.workingSetSize) || 0) / 1024;
          const cpu = (m.cpu && m.cpu.percentCPUUsage) || 0;
          rows.push(`${ts},${m.type},${m.pid},${rssMB.toFixed(2)},${cpu.toFixed(1)}`);
        }
        if (rows.length) fsMod.appendFileSync(probePath, rows.join('\n') + '\n');
      } catch (_) {  }
    }, 500);
    if (timer.unref) timer.unref();
    this._probeTimer = timer;
    console.log('[MemoryManager] Metrics probe enabled ->', probePath);
  }

  _scheduleMonitor(intervalMs) {
    if (this._monitorTimer) clearInterval(this._monitorTimer);
    this._monitorTimer = setInterval(() => this._monitor(), intervalMs);
    if (this._monitorTimer.unref) this._monitorTimer.unref();
  }


  _monitor() {
    const mem = process.memoryUsage();
    const rssMB = mem.rss / (1024 * 1024);
    const heapUsedMB = mem.heapUsed / (1024 * 1024);
    const heapTotalMB = mem.heapTotal / (1024 * 1024);
    const externalMB = mem.external / (1024 * 1024);

    this._history.push({ time: Date.now(), rss: mem.rss, heapUsed: mem.heapUsed });
    if (this._history.length > this._maxHistory) this._history.shift();

    const prevLevel = this._pressureLevel;

    if (rssMB >= RSS_CRITICAL_MB) {
      this._pressureLevel = 'critical';
      if (!this._emergencyMode) {
        console.warn('[MemoryManager] CRITICAL: rss=' + rssMB.toFixed(1) + 'MB — entering emergency mode');
        this._emergencyMode = true;
        this._emergencyCleanup();
      }
      if (this._gc) { try { this._gc(); } catch (_) {} }
    } else if (rssMB >= RSS_HARD_MB) {
      this._pressureLevel = 'elevated';
      if (prevLevel !== 'critical' && prevLevel !== 'elevated') {
        console.warn('[MemoryManager] HARD pressure: rss=' + rssMB.toFixed(1) + 'MB — aggressive cleanup');
      }
      this._runCleanup();
      if (this._gc) { try { this._gc(); } catch (_) {} }
      this._emergencyMode = false;
    } else if (rssMB >= RSS_SOFT_MB) {
      this._pressureLevel = 'elevated';
      this._emergencyMode = false;
      const trend = this._detectGrowthTrend();
      if (trend) {
        console.warn('[MemoryManager] RSS growing: ' + trend.from.toFixed(1) +
          'MB → ' + trend.to.toFixed(1) + 'MB over ' + trend.minutes.toFixed(1) + 'min');
      }
    } else {
      if (this._pressureLevel !== 'normal' || this._emergencyMode) {
        console.log('[MemoryManager] Pressure normalized: rss=' + rssMB.toFixed(1) + 'MB');
      }
      this._pressureLevel = 'normal';
      this._emergencyMode = false;
    }

    if (this._pressureLevel !== prevLevel) {
      if (this._pressureLevel === 'critical') {
        this._scheduleMonitor(MONITOR_CRITICAL_MS);
      } else if (this._pressureLevel === 'elevated') {
        this._scheduleMonitor(MONITOR_ELEVATED_MS);
      } else {
        this._scheduleMonitor(MONITOR_NORMAL_MS);
      }
    }

    if (this._rendererLastReport && (Date.now() - this._rendererLastReport) > RENDERER_REPORT_TIMEOUT_MS) {
      this._rendererStats = null;
    }
  }

  _detectGrowthTrend() {
    if (this._history.length < 4) return null;
    const oldest = this._history[0];
    const newest = this._history[this._history.length - 1];
    const growthMB = (newest.rss - oldest.rss) / (1024 * 1024);
    if (growthMB < 15) return null;
    return {
      from: oldest.rss / (1024 * 1024),
      to: newest.rss / (1024 * 1024),
      minutes: (newest.time - oldest.time) / 60000,
    };
  }


  _runCleanup() {
    for (const cb of this._cleanupCallbacks) {
      try { cb(); } catch (e) { console.warn('[MemoryManager] Cleanup error:', e.message); }
    }

    let cleaned = 0;
    for (const [id, entry] of this._disposables) {
      if (entry.weakRef.deref() === undefined) { this._disposables.delete(id); cleaned++; }
    }
    if (cleaned > 0) console.debug('[MemoryManager] Cleaned', cleaned, 'finalized entries');
  }

  _emergencyCleanup() {
    this._killCount++;
    console.warn('[MemoryManager] EMERGENCY CLEANUP — cascading resource release');

    for (const cb of this._emergencyCallbacks) {
      try { cb(); } catch (e) { console.warn('[MemoryManager] Emergency callback error:', e.message); }
    }

    for (const [id, entry] of this._disposables) {
      try { entry.dispose(); } catch (_) {}
    }
    this._disposables.clear();

    this._runCleanup();

    if (this._gc) {
      try { this._gc(); } catch (_) {}
      setImmediate(() => { try { this._gc(); } catch (_) {} });
    }

    const win = require('electron').BrowserWindow.getAllWindows()[0];
    if (win && !win.isDestroyed()) {
      win.webContents.executeJavaScript(
        'if(window.MemoryManager&&window.MemoryManager.emergencyCleanup)window.MemoryManager.emergencyCleanup()'
      ).catch(() => {});
    }
  }


  registerDisposable(target, dispose, label) {
    if (!target || typeof dispose !== 'function') return 0;
    const id = this._nextId++;
    this._disposables.set(id, {
      weakRef: new WeakRef(target), dispose, label: label || 'unnamed'
    });
    this._finalization.register(target, id, target);
    return id;
  }

  dispose(id) {
    const entry = this._disposables.get(id);
    if (!entry) return;
    try { entry.dispose(); } catch (_) {}
    this._disposables.delete(id);
  }

  onCleanup(callback) {
    if (typeof callback === 'function') this._cleanupCallbacks.push(callback);
  }

  onEmergencyCleanup(callback) {
    if (typeof callback === 'function') this._emergencyCallbacks.push(callback);
  }

  setOptimizationLevel(level) {
    const t = _THRESHOLDS[level] || _THRESHOLDS.normal;
    RSS_SOFT_MB = t.soft;
    RSS_HARD_MB = t.hard;
    RSS_CRITICAL_MB = t.critical;
    console.log('[MemoryManager] Thresholds updated for level:', level,
      '— soft:', RSS_SOFT_MB + 'MB, hard:', RSS_HARD_MB + 'MB, critical:', RSS_CRITICAL_MB + 'MB');
  }


  getStats() {
    const mem = process.memoryUsage();
    return {
      main: {
        heapUsed: mem.heapUsed,
        heapTotal: mem.heapTotal,
        rss: mem.rss,
        external: mem.external,
        arrayBuffers: mem.arrayBuffers,
        heapUsedMB: +(mem.heapUsed / (1024 * 1024)).toFixed(2),
        rssMB: +(mem.rss / (1024 * 1024)).toFixed(2),
      },
      renderer: this._rendererStats,
      disposables: this._disposables.size,
      pressureLevel: this._pressureLevel,
      emergencyMode: this._emergencyMode,
      killCount: this._killCount,
      thresholds: { soft: RSS_SOFT_MB, hard: RSS_HARD_MB, critical: RSS_CRITICAL_MB },
      timestamp: Date.now(),
    };
  }

  get killCount() { return this._killCount; }

  get pressureLevel() { return this._pressureLevel; }
  get isEmergency() { return this._emergencyMode; }


  _registerIpc() {
    ipcMain.handle('memory:get_stats', () => JSON.stringify(this.getStats()));

    ipcMain.handle('memory:report_renderer', (_e, statsJson) => {
      try {
        this._rendererStats = JSON.parse(statsJson);
        this._rendererLastReport = Date.now();
      } catch (_) {}
      return true;
    });

    ipcMain.handle('memory:request_gc', () => {
      if (this._gc) { try { this._gc(); return true; } catch (_) {} }
      return false;
    });

    ipcMain.handle('memory:request_cleanup', () => {
      this._runCleanup();
      return true;
    });

    ipcMain.handle('memory:get_pressure', () => this._pressureLevel);
  }
}


let _instance = null;

function getInstance() {
  if (!_instance) _instance = new MemoryManager();
  return _instance;
}

module.exports = { MemoryManager, getInstance };
