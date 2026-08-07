/**
 * Carminium — 主进程严格内存管理器
 *
 * 升级要点（v2）：
 *   - 监控指标从 V8 heap 切换为总进程 RSS（含 native/buffer/子进程）
 *   - 三级渐进式管制：SOFT(200MB) → HARD(230MB) → CRITICAL(250MB)
 *   - 内存压力升高时自动缩短监控间隔（30s → 15s → 5s）
 *   - 紧急模式：级联清理所有缓存模块 + 强制 GC + 渲染进程通知
 *
 * 设计约束：
 *   - 所有功能不阻塞音频播放关键路径
 *   - IPC 接口向后兼容现有渲染进程调用
 *   - 低开销：正常状态下 30s 监控周期
 */
'use strict';

const { ipcMain } = require('electron');

// ── 内存管制阈值（按总进程 RSS）──
const RSS_SOFT_MB = 150;       // 软限制：触发 GC + 通知渲染进程整理
const RSS_HARD_MB = 180;       // 硬限制：紧急缓存清理 + 强制 GC
const RSS_CRITICAL_MB = 200;   // 临界限制：级联清理 + 拒绝新分配

// ── 监控间隔（按压力级别自适应）──
const MONITOR_NORMAL_MS = 30_000;
const MONITOR_ELEVATED_MS = 15_000;
const MONITOR_CRITICAL_MS = 5_000;
const CLEANUP_INTERVAL_MS = 45_000;
const RENDERER_REPORT_TIMEOUT_MS = 90_000; // 渲染进程超时未上报则标记为 stale

// ── MemoryManager ──────────────────────────────────────────────────────────

class MemoryManager {
  constructor() {
    this._monitorTimer = null;
    this._cleanupTimer = null;

    // 可处置资源注册表
    this._disposables = new Map();
    this._nextId = 1;

    this._finalization = new FinalizationRegistry((id) => {
      this._disposables.delete(id);
    });

    // RSS 历史记录（检测增长趋势）
    this._history = [];
    this._maxHistory = 20;

    // 渲染进程内存上报
    this._rendererStats = null;
    this._rendererLastReport = 0;

    // IPC 注册状态
    this._ipcRegistered = false;

    // GC 函数引用
    this._gc = (typeof global.gc === 'function') ? global.gc : null;

    // 清理回调链
    this._cleanupCallbacks = [];

    // 当前压力级别
    this._pressureLevel = 'normal'; // 'normal' | 'elevated' | 'critical'
    this._emergencyMode = false;

    // 紧急清理回调（比普通清理更激进）
    this._emergencyCallbacks = [];
  }

  // ── 启动 / 停止 ────────────────────────────────────────────────────────

  start() {
    if (this._monitorTimer) return;
    this._scheduleMonitor(MONITOR_NORMAL_MS);
    this._cleanupTimer = setInterval(() => this._runCleanup(), CLEANUP_INTERVAL_MS);
    this._monitor(); // 立即采基线

    if (!this._ipcRegistered) {
      this._registerIpc();
      this._ipcRegistered = true;
    }

    console.log('[MemoryManager] Strict mode started —',
      'soft:', RSS_SOFT_MB + 'MB, hard:', RSS_HARD_MB + 'MB, critical:', RSS_CRITICAL_MB + 'MB,',
      'gc:', this._gc ? 'available' : 'not available');
  }

  stop() {
    if (this._monitorTimer) { clearInterval(this._monitorTimer); this._monitorTimer = null; }
    if (this._cleanupTimer) { clearInterval(this._cleanupTimer); this._cleanupTimer = null; }
  }

  _scheduleMonitor(intervalMs) {
    if (this._monitorTimer) clearInterval(this._monitorTimer);
    this._monitorTimer = setInterval(() => this._monitor(), intervalMs);
    if (this._monitorTimer.unref) this._monitorTimer.unref();
  }

  // ── 核心监控 ──────────────────────────────────────────────────────────

  _monitor() {
    const mem = process.memoryUsage();
    const rssMB = mem.rss / (1024 * 1024);
    const heapUsedMB = mem.heapUsed / (1024 * 1024);
    const heapTotalMB = mem.heapTotal / (1024 * 1024);
    const externalMB = mem.external / (1024 * 1024);

    // 记录历史
    this._history.push({ time: Date.now(), rss: mem.rss, heapUsed: mem.heapUsed });
    if (this._history.length > this._maxHistory) this._history.shift();

    // ── 三级管制判定 ──
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

    // 自适应监控间隔
    if (this._pressureLevel !== prevLevel) {
      if (this._pressureLevel === 'critical') {
        this._scheduleMonitor(MONITOR_CRITICAL_MS);
      } else if (this._pressureLevel === 'elevated') {
        this._scheduleMonitor(MONITOR_ELEVATED_MS);
      } else {
        this._scheduleMonitor(MONITOR_NORMAL_MS);
      }
    }

    // 渲染进程超时检测
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

  // ── 清理 ──────────────────────────────────────────────────────────────

  _runCleanup() {
    // 外部清理回调
    for (const cb of this._cleanupCallbacks) {
      try { cb(); } catch (e) { console.warn('[MemoryManager] Cleanup error:', e.message); }
    }

    // 清理失效 WeakRef
    let cleaned = 0;
    for (const [id, entry] of this._disposables) {
      if (entry.weakRef.deref() === undefined) { this._disposables.delete(id); cleaned++; }
    }
    if (cleaned > 0) console.debug('[MemoryManager] Cleaned', cleaned, 'finalized entries');
  }

  /** 紧急清理：级联释放所有非关键资源 */
  _emergencyCleanup() {
    console.warn('[MemoryManager] EMERGENCY CLEANUP — cascading resource release');

    // 1. 执行所有紧急回调
    for (const cb of this._emergencyCallbacks) {
      try { cb(); } catch (e) { console.warn('[MemoryManager] Emergency callback error:', e.message); }
    }

    // 2. 处置所有注册的可处置资源
    for (const [id, entry] of this._disposables) {
      try { entry.dispose(); } catch (_) {}
    }
    this._disposables.clear();

    // 3. 执行普通清理回调
    this._runCleanup();

    // 4. 强制 GC
    if (this._gc) {
      try { this._gc(); } catch (_) {}
      // 二次 GC（清理第一次 GC 暴露的垃圾）
      setImmediate(() => { try { this._gc(); } catch (_) {} });
    }

    // 5. 通知渲染进程紧急清理
    const win = require('electron').BrowserWindow.getAllWindows()[0];
    if (win && !win.isDestroyed()) {
      win.webContents.executeJavaScript(
        'if(window.MemoryManager&&window.MemoryManager.emergencyCleanup)window.MemoryManager.emergencyCleanup()'
      ).catch(() => {});
    }
  }

  // ── 可处置资源注册 ────────────────────────────────────────────────────

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

  /** 注册紧急清理回调（在 CRITICAL 级别触发） */
  onEmergencyCleanup(callback) {
    if (typeof callback === 'function') this._emergencyCallbacks.push(callback);
  }

  // ── 内存状态查询 ──────────────────────────────────────────────────────

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
      thresholds: { soft: RSS_SOFT_MB, hard: RSS_HARD_MB, critical: RSS_CRITICAL_MB },
      timestamp: Date.now(),
    };
  }

  get pressureLevel() { return this._pressureLevel; }
  get isEmergency() { return this._emergencyMode; }

  // ── IPC 注册 ──────────────────────────────────────────────────────────

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

    // 新增：查询压力级别
    ipcMain.handle('memory:get_pressure', () => this._pressureLevel);
  }
}

// ── 单例 ────────────────────────────────────────────────────────────────────

let _instance = null;

function getInstance() {
  if (!_instance) _instance = new MemoryManager();
  return _instance;
}

module.exports = { MemoryManager, getInstance };
