(function () {
  'use strict';

  const DEFAULT_MAX_BYTES = 24 * 1024 * 1024;

  class AudioBufferCache {
    constructor(maxBytes) {
      this._maxBytes = maxBytes || DEFAULT_MAX_BYTES;
      this._currentBytes = 0;
      this._map = new Map();
    }

    get(key) {
      const entry = this._map.get(key);
      if (!entry) return null;

      this._map.delete(key);
      this._map.set(key, entry);
      return entry.buffer;
    }

    set(key, buffer) {
      const existing = this._map.get(key);
      if (existing) {
        this._currentBytes -= existing.bytes;
        this._map.delete(key);
      }

      const bytes = buffer.length * buffer.numberOfChannels * 4;

      if (bytes > this._maxBytes) return;

      while (this._currentBytes + bytes > this._maxBytes && this._map.size > 0) {
        this._evictOldest();
      }

      this._map.set(key, { buffer, bytes });
      this._currentBytes += bytes;
    }

    has(key) {
      return this._map.has(key);
    }

    delete(key) {
      const entry = this._map.get(key);
      if (entry) {
        this._currentBytes -= entry.bytes;
        this._map.delete(key);
      }
    }

    clear() {
      this._map.clear();
      this._currentBytes = 0;
    }

    shrinkTo(targetBytes) {
      while (this._currentBytes > targetBytes && this._map.size > 0) {
        this._evictOldest();
      }
    }

    get stats() {
      return {
        entries: this._map.size,
        bytes: this._currentBytes,
        maxBytes: this._maxBytes,
      };
    }

    _evictOldest() {
      const firstKey = this._map.keys().next().value;
      if (firstKey === undefined) return;
      const entry = this._map.get(firstKey);
      if (entry) {
        this._currentBytes -= entry.bytes;
      }
      this._map.delete(firstKey);
    }
  }

  window.AudioBufferCache = AudioBufferCache;
})();
