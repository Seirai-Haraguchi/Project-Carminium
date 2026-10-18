(function () {
  'use strict';

  class UIStateSync {
    constructor() {
      this._handlers = new Map();

      this._highFreqSlots = new Map();

      this._highFreqEvents = new Set();

      this._queue = [];

      this._rafScheduled = false;

      this._rafHandle = 0;

      this._flushBound = this._flush.bind(this);

      this._flushCount = 0;
    }

    markHighFreq(event) {
      this._highFreqEvents.add(event);
      if (!this._highFreqSlots.has(event)) {
        this._highFreqSlots.set(event, { payload: undefined, dirty: false });
      }
    }

    on(event, handler) {
      if (typeof handler !== 'function') {
        console.warn('[ui_state_sync] handler is not function for', event);
        return;
      }
      this._handlers.set(event, handler);
    }

    off(event) {
      this._handlers.delete(event);
    }

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

    flushNow() {
      if (this._rafScheduled) {
        cancelAnimationFrame(this._rafHandle);
        this._rafScheduled = false;
      }
      this._flush();
    }

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

    _scheduleFlush() {
      if (this._rafScheduled) return;
      this._rafScheduled = true;
      this._rafHandle = requestAnimationFrame(this._flushBound);
    }

    _flush() {
      this._rafScheduled = false;
      this._rafHandle = 0;
      this._flushCount++;

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

      var self = this;
      this._highFreqSlots.forEach(function (slot, event) {
        if (!slot.dirty) return;
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

  window.UIStateSync = UIStateSync;
  window.uiSync = new UIStateSync();
})();
