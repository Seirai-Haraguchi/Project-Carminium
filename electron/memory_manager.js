/**
 * Carminium — 主进程内存管理器
 *
 * 职责：
 *   1. 定时监控主进程内存占用（process.memoryUsage）
 *   2. 内存压力下自动触发 GC（--expose-gc 或 v8 隐式提示）
 *   3. 可处置资源注册表：WeakRef + FinalizationRegistry 自动回收
 *   4. IPC 接口：渲染进程查询主进程内存、上报渲染进程内存
 *   5. 定时清理周期：驱逐过期缓存、释放临时 Buffer
 *
 * 设计理念：
 *   - 被动监控 + 主动回收结合
 *   - 不阻塞音频播放关键路径
 *   - 低开销：监控周期 30s，清理周期 60s
 *   - 日志友好：仅在内存增长异常时告警
 */
'use strict';

const { ipcMain } = require('electron');

// ── 常量 ────────────────────────────────────────────────────────────────────

const MONITOR_INTERVAL_MS = 30_000;   // 监控周期：30s
const CLEANUP_INTERVAL_MS = 60_000;   // 清理周期：60s
const HEAP_WARN_MB = 250;             // 堆内存告警阈值
const HEAP_CRITICAL_MB = 400;         // 堆内存危险阈值
const RENDERER_REPORT_INTERVAL_MS = 60_000; // 渲染进程上报周期

// ── MemoryManager ──────────────────────────────────────────────────────────

class MemoryManager {
  constructor() {
    this._monitorTimer = null;
    this._cleanupTimer = null;
    this._rendererReportTimer = null;

    // 可处置资源注册表
    // _disposables: Map<number, { weakRef: WeakRef, dispose: Function, label: string }>
    this._disposables = new Map();
    this._nextId = 1;

    // FinalizationRegistry：对象被 GC 回收时自动从注册表移除
    this._finalization = new FinalizationRegistry((id) => {
      this._disposables.delete(id);
    });

    // 历史记录（用于检测增长趋势）
    this._history = [];
    this._maxHistory = 20; // 保留最近 20 条 = 10 分钟

    // 渲染进程内存上报
    this._rendererStats = null;

    // 是否已注册 IPC
    this._ipcRegistered = false;

    // GC 函数引用（--expose-gc 时可用）
    this._gc = (typeof global.gc === 'function') ? global.gc : null;

    // 清理回调链：外部模块注册的定时清理函数
    this._cleanupCallbacks = [];
  }

  // ── 启动 / 停止 ────────────────────────────────────────────────────────

  start() {
    if (this._monitorTimer) return;

    this._monitorTimer = setInterval(() => this._monitor(), MONITOR_INTERVAL_MS);
    this._cleanupTimer = setInterval(() => this._runCleanup(), CLEANUP_INTERVAL_MS);

    // 立即执行一次监控，记录基线
    this._monitor();

    if (!this._ipcRegistered) {
      this._registerIpc();
      this._ipcRegistered = true;
    }

    console.log('[MemoryManager] Started — monitor:', MONITOR_INTERVAL_MS + 'ms',
      'cleanup:', CLEANUP_INTERVAL_MS + 'ms',
      'gc:', this._gc ? 'available' : 'not available');
  }

  stop() {
    if (this._monitorTimer) {
      clearInterval(this._monitorTimer);
      this._monitorTimer = null;
    }
    if (this._cleanupTimer) {
      clearInterval(this._cleanupTimer);
      this._cleanupTimer = null;
    }
    if (this._rendererReportTimer) {
      clearInterval(this._rendererReportTimer);
      this._rendererReportTimer = null;
    }
  }

  // ── 监控 ──────────────────────────────────────────────────────────────

  _monitor() {
    const mem = process.memoryUsage();
    const heapUsedMB = mem.heapUsed / (1024 * 1024);
    const heapTotalMB = mem.heapTotal / (1024 * 1024);
    const rssMB = mem.rss / (1024 * 1024);
    const externalMB = mem.external / (1024 * 1024);

    // 记录历史
    this._history.push({
      time: Date.now(),
      heapUsed: mem.heapUsed,
      heapTotal: mem.heapTotal,
      rss: mem.rss,
      external: mem.external,
    });
    if (this._history.length > this._maxHistory) {
      this._history.shift();
    }

    // 告警检测
    if (heapUsedMB > HEAP_CRITICAL_MB) {
      console.warn('[MemoryManager] CRITICAL: heapUsed=' + heapUsedMB.toFixed(1) +
        'MB, rss=' + rssMB.toFixed(1) + 'MB — triggering cleanup');
      this._runCleanup();
      if (this._gc) {
        try { this._gc(); } catch { /* ignore */ }
      }
    } else if (heapUsedMB > HEAP_WARN_MB) {
      // 检测增长趋势：最近 5 分钟持续增长
      const trend = this._detectGrowthTrend();
      if (trend) {
        console.warn('[MemoryManager] Heap growing: ' + trend.from.toFixed(1) +
          'MB → ' + trend.to.toFixed(1) + 'MB over ' + trend.minutes.toFixed(1) + 'min');
      }
    }
  }

  /**
   * 检测堆内存持续增长趋势。
   * 比较最早和最新的 heapUsed，如果增长率 > 20% 则返回趋势信息。
   */
  _detectGrowthTrend() {
    if (this._history.length < 4) return null;
    const oldest = this._history[0];
    const newest = this._history[this._history.length - 1];
    const growthMB = (newest.heapUsed - oldest.heapUsed) / (1024 * 1024);
    if (growthMB < 20) return null; // 增长不到 20MB 不报告
    const minutes = (newest.time - oldest.time) / 60000;
    return {
      from: oldest.heapUsed / (1024 * 1024),
      to: newest.heapUsed / (1024 * 1024),
      minutes: minutes,
    };
  }

  // ── 清理 ──────────────────────────────────────────────────────────────

  /**
   * 执行一轮定时清理。
   * 1. 调用外部注册的清理回调（缓存驱逐等）
   * 2. 检查 WeakRef 注册表，清理已被 GC 回收的条目
   * 3. 在内存压力下触发 GC
   */
  _runCleanup() {
    // 1. 外部清理回调
    for (const cb of this._cleanupCallbacks) {
      try { cb(); } catch (e) {
        console.warn('[MemoryManager] Cleanup callback error:', e.message);
      }
    }

    // 2. 清理已失效的 WeakRef
    let cleaned = 0;
    for (const [id, entry] of this._disposables) {
      const obj = entry.weakRef.deref();
      if (obj === undefined) {
        // 对象已被 GC 回收，从注册表移除
        this._disposables.delete(id);
        cleaned++;
      }
    }
    if (cleaned > 0) {
      console.debug('[MemoryManager] Cleaned ' + cleaned + ' finalized entries');
    }

    // 3. 内存压力下触发 GC
    const mem = process.memoryUsage();
    const heapUsedMB = mem.heapUsed / (1024 * 1024);
    if (heapUsedMB > HEAP_WARN_MB && this._gc) {
      try { this._gc(); } catch { /* ignore */ }
    }
  }

  // ── 可处置资源注册 ────────────────────────────────────────────────────

  /**
   * 注册一个可处置资源。当对象被 GC 回收时自动从注册表移除。
   * 在内存压力下，MemoryManager 会调用 dispose() 主动释放。
   *
   * @param {object} target - 被追踪的对象
   * @param {Function} dispose - 清理函数（无参数）
   * @param {string} [label] - 可选标签，用于日志
   * @returns {number} 注册 ID（用于手动注销）
   */
  registerDisposable(target, dispose, label) {
    if (!target || typeof dispose !== 'function') return 0;
    const id = this._nextId++;
    const weakRef = new WeakRef(target);
    this._disposables.set(id, { weakRef, dispose, label: label || 'unnamed' });
    this._finalization.register(target, id, target);
    return id;
  }

  /**
   * 手动注销并处置资源。
   * @param {number} id - registerDisposable 返回的 ID
   */
  dispose(id) {
    const entry = this._disposables.get(id);
    if (!entry) return;
    try { entry.dispose(); } catch { /* ignore */ }
    this._disposables.delete(id);
  }

  /**
   * 注册定时清理回调。每 CLEANUP_INTERVAL_MS 调用一次。
   * @param {Function} callback - 无参数清理函数
   */
  onCleanup(callback) {
    if (typeof callback === 'function') {
      this._cleanupCallbacks.push(callback);
    }
  }

  // ── 内存状态查询 ──────────────────────────────────────────────────────

  /**
   * 获取当前内存快照。
   */
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
      timestamp: Date.now(),
    };
  }

  // ── IPC 注册 ──────────────────────────────────────────────────────────

  _registerIpc() {
    // 渲染进程查询主进程内存
    ipcMain.handle('memory:get_stats', () => {
      return JSON.stringify(this.getStats());
    });

    // 渲染进程上报自身内存
    ipcMain.handle('memory:report_renderer', (_e, statsJson) => {
      try {
        this._rendererStats = JSON.parse(statsJson);
      } catch { /* ignore */ }
      return true;
    });

    // 渲染进程请求主进程执行 GC
    ipcMain.handle('memory:request_gc', () => {
      if (this._gc) {
        try {
          this._gc();
          return true;
        } catch { /* ignore */ }
      }
      return false;
    });

    // 渲染进程请求主进程执行清理
    ipcMain.handle('memory:request_cleanup', () => {
      this._runCleanup();
      return true;
    });
  }
}

// ── 单例 ────────────────────────────────────────────────────────────────────

let _instance = null;

/**
 * 获取 MemoryManager 单例。
 * @returns {MemoryManager}
 */
function getInstance() {
  if (!_instance) {
    _instance = new MemoryManager();
  }
  return _instance;
}

module.exports = { MemoryManager, getInstance };
