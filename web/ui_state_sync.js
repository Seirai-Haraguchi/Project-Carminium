/**
 * UIStateSync — UI 状态批量同步层
 *
 * 职责：把 backend 事件接收（IPC handler）和 DOM 更新（UI 操作）解耦。
 *
 * 架构分层：
 *   ┌─────────────────────────────────────────────────────────────┐
 *   │ PlaybackCore                                                │
 *   │   AudioEngine (renderer 主线程, Web Audio API)               │
 *   │   AudioWorklet 线程 (StreamingPCMProcessor, OutputCapture)  │
 *   │   Native DLL 线程 (WASAPI)                                   │
 *   │   FFmpeg 进程                                                 │
 *   │   → 这些是“播放线程”，PCM 数据流不经过 UIStateSync           │
 *   └───────────────┬─────────────────────────────────────────────┘
 *                   │ backend signal (IPC)
 *                   ▼
 *   ┌─────────────────────────────────────────────────────────────┐
 *   │ UIStateSync (本模块)                                         │
 *   │   事件入队 (O(1)，不阻塞 IPC 接收)                            │
 *   │   RAF 批量 flush → 调用 UI handler                            │
 *   └───────────────┬─────────────────────────────────────────────┘
 *                   │ callback
 *                   ▼
 *   ┌─────────────────────────────────────────────────────────────┐
 *   │ UI Layer (app.js / now_playing.js / pages/*)                │
 *   │   DOM 更新、列表重渲染                                        │
 *   └─────────────────────────────────────────────────────────────┘
 *
 * 关键原则：
 *   1. backend 事件接收 → 入队（O(1)，IPC handler 立即返回）
 *      → PCM 转发 IPC 不会被 DOM 重渲染阻塞 → 不断音
 *   2. DOM 更新统一在 RAF 中批量执行
 *      → 多个连续事件合并到一帧，避免重复重渲染
 *   3. 高频事件（position_changed）合并到最新值
 *      → 250ms 一次的 tick 之间若有多次入队，只渲染最新位置
 *   4. 低频事件按 FIFO 顺序处理
 *      → track_changed / queue_changed 等保持时序
 *   5. flush 顺序：先低频，后高频
 *      → 保证高频 handler (position) 读到的 state 是最新的（track/duration 已更新）
 *
 * 使用：
 *   // 1. 标记高频事件
 *   window.uiSync.markHighFreq('position_changed');
 *   // 2. 注册处理器
 *   window.uiSync.on('track_changed', function (trackJson) { ... });
 *   // 3. 信号入队
 *   App.backend.track_changed.connect(function (p) {
 *     window.uiSync.enqueue('track_changed', p);
 *   });
 *
 * 例外：
 *   - 浮窗 (floating.js) 独立窗口，不走 uiSync，直接处理
 *   - AudioEngine 内部回调 (onPositionTick / onCrossfadeStart 等) 是
 *     AudioEngine → main → renderer 的另一条路径，不经 backend signal
 */
(function () {
  'use strict';

  class UIStateSync {
    constructor() {
      /** @type {Map<string, Function>} 事件处理器（event → handler） */
      this._handlers = new Map();

      /**
       * 高频事件状态：合并到最新值。
       * @type {Map<string, {payload: any, dirty: boolean}>}
       */
      this._highFreqSlots = new Map();

      /** @type {Set<string>} 标记为高频的事件集合 */
      this._highFreqEvents = new Set();

      /** @type {Array<{event: string, payload: any}>} 低频事件 FIFO 队列 */
      this._queue = [];

      /** @type {boolean} RAF 已调度标志 */
      this._rafScheduled = false;

      /** @type {number} RAF 句柄（用于取消） */
      this._rafHandle = 0;

      // 绑定 _flush 的 this，避免每次 RAF 创建新闭包
      this._flushBound = this._flush.bind(this);

      /** @type {number} 统计：累计 flush 次数（调试用） */
      this._flushCount = 0;
    }

    /**
     * 标记某事件为高频（合并到最新值）。
     * 默认所有事件都是低频（FIFO）。
     * @param {string} event
     */
    markHighFreq(event) {
      this._highFreqEvents.add(event);
      if (!this._highFreqSlots.has(event)) {
        this._highFreqSlots.set(event, { payload: undefined, dirty: false });
      }
    }

    /**
     * 注册事件处理器。同一事件重复注册会覆盖。
     * @param {string} event
     * @param {Function} handler - 接收 payload，不返回值
     */
    on(event, handler) {
      if (typeof handler !== 'function') {
        console.warn('[ui_state_sync] handler is not function for', event);
        return;
      }
      this._handlers.set(event, handler);
    }

    /**
     * 取消注册。
     * @param {string} event
     */
    off(event) {
      this._handlers.delete(event);
    }

    /**
     * 入队事件。高频事件合并，低频事件入 FIFO 队列。
     * 入队操作是 O(1)，IPC handler 调用后立即返回，不阻塞 PCM 转发。
     * @param {string} event
     * @param {*} payload
     */
    enqueue(event, payload) {
      if (this._highFreqEvents.has(event)) {
        const slot = this._highFreqSlots.get(event);
        slot.payload = payload;
        slot.dirty = true;
      } else {
        this._queue.push({ event: event, payload: payload });
      }
      this._scheduleFlush();
    }

    /**
     * 立即处理所有挂起的事件（绕过 RAF）。
     * 用于应用关闭、热重载、调试等需要立即刷新的场景。
     */
    flushNow() {
      if (this._rafScheduled) {
        cancelAnimationFrame(this._rafHandle);
        this._rafScheduled = false;
      }
      this._flush();
    }

    /**
     * 清空队列，丢弃所有挂起的事件。
     * 用于页面切换、错误恢复等场景，避免旧事件污染新状态。
     */
    clear() {
      if (this._rafScheduled) {
        cancelAnimationFrame(this._rafHandle);
        this._rafScheduled = false;
      }
      this._queue.length = 0;
      this._highFreqSlots.forEach(function (slot) {
        slot.payload = undefined;
        slot.dirty = false;
      });
    }

    /**
     * 调度 RAF flush。同一帧内多次 enqueue 只调度一次。
     */
    _scheduleFlush() {
      if (this._rafScheduled) return;
      this._rafScheduled = true;
      this._rafHandle = requestAnimationFrame(this._flushBound);
    }

    /**
     * 批量 flush：
     *   1. 先处理低频队列（FIFO）
     *   2. 后处理高频事件（合并值）
     *
     * 顺序原因：低频事件可能修改 App.state（如 track_changed 切换当前曲目、
     * duration_changed 更新时长），高频事件（如 position_changed）依赖最新的
     * state 计算 UI 显示，必须在低频之后处理。
     *
     * 错误隔离：单个 handler 抛异常不影响其他 handler，避免一次错误
     * 让整帧的事件全部丢失。
     */
    _flush() {
      this._rafScheduled = false;
      this._rafHandle = 0;
      this._flushCount++;

      // ── 1. 低频事件 FIFO 处理 ──
      // 取出当前队列快照，处理过程中新入队的事件会在下一帧 flush
      var queue = this._queue;
      this._queue = [];

      for (var i = 0; i < queue.length; i++) {
        var item = queue[i];
        var handler = this._handlers.get(item.event);
        if (!handler) continue;
        try {
          handler(item.payload);
        } catch (e) {
          console.error('[ui_state_sync] handler error for', item.event, e);
        }
      }

      // ── 2. 高频事件合并处理 ──
      // 遍历所有高频 slot，dirty 的才处理
      var self = this;
      this._highFreqSlots.forEach(function (slot, event) {
        if (!slot.dirty) return;
        // 先清除 dirty，再调用 handler。
        // 若 handler 内部再次 enqueue 同一事件，下一帧会处理新值。
        slot.dirty = false;
        var payload = slot.payload;
        var handler = self._handlers.get(event);
        if (!handler) return;
        try {
          handler(payload);
        } catch (e) {
          console.error('[ui_state_sync] handler error for', event, e);
        }
      });
    }

    /**
     * 调试接口：返回当前队列状态。
     * @returns {{queueLength: number, highFreqDirty: string[], handlers: string[]}}
     */
    debug() {
      var dirty = [];
      this._highFreqSlots.forEach(function (slot, event) {
        if (slot.dirty) dirty.push(event);
      });
      var handlers = [];
      this._handlers.forEach(function (_, event) {
        handlers.push(event);
      });
      return {
        queueLength: this._queue.length,
        highFreqDirty: dirty,
        handlers: handlers,
        flushCount: this._flushCount,
      };
    }
  }

  // 暴露到全局
  window.UIStateSync = UIStateSync;
  // 全局单例，所有模块共享
  window.uiSync = new UIStateSync();
})();
