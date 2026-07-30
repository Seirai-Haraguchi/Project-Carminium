/**
 * AudioBufferCache — AudioBuffer LRU 缓存
 *
 * 缓存已解码的 AudioBuffer，避免重复解码。
 * 用于预加载和即时播放场景。
 *
 * 容量策略：按 AudioBuffer 实际占用内存计算（sampleRate × channels × length × 4 bytes），
 * 上限约 500MB。超出时淘汰最久未使用的条目。
 */
(function () {
  'use strict';

  const DEFAULT_MAX_BYTES = 500 * 1024 * 1024; // 500MB

  class AudioBufferCache {
    /**
     * @param {number} maxBytes - 最大缓存字节数
     */
    constructor(maxBytes) {
      this._maxBytes = maxBytes || DEFAULT_MAX_BYTES;
      this._currentBytes = 0;
      // Map<key, { buffer: AudioBuffer, bytes: number }>
      // 利用 Map 的插入顺序实现 LRU（最近访问的移到末尾）
      this._map = new Map();
    }

    /**
     * 获取缓存的 AudioBuffer
     * @param {string} key - 唯一标识（通常是文件路径或 subsonic:// URL）
     * @returns {AudioBuffer|null}
     */
    get(key) {
      const entry = this._map.get(key);
      if (!entry) return null;

      // 移到末尾（最近使用）
      this._map.delete(key);
      this._map.set(key, entry);
      return entry.buffer;
    }

    /**
     * 存入 AudioBuffer
     * @param {string} key
     * @param {AudioBuffer} buffer
     */
    set(key, buffer) {
      // 如果已存在，先删除旧条目
      const existing = this._map.get(key);
      if (existing) {
        this._currentBytes -= existing.bytes;
        this._map.delete(key);
      }

      const bytes = buffer.length * buffer.numberOfChannels * 4; // f32 = 4 bytes

      // 单条超过总容量则不缓存
      if (bytes > this._maxBytes) return;

      // 淘汰直到有足够空间
      while (this._currentBytes + bytes > this._maxBytes && this._map.size > 0) {
        this._evictOldest();
      }

      this._map.set(key, { buffer, bytes });
      this._currentBytes += bytes;
    }

    /**
     * 检查是否已缓存
     */
    has(key) {
      return this._map.has(key);
    }

    /**
     * 删除指定条目
     */
    delete(key) {
      const entry = this._map.get(key);
      if (entry) {
        this._currentBytes -= entry.bytes;
        this._map.delete(key);
      }
    }

    /**
     * 清空缓存
     */
    clear() {
      this._map.clear();
      this._currentBytes = 0;
    }

    /**
     * 当前缓存统计
     */
    get stats() {
      return {
        entries: this._map.size,
        bytes: this._currentBytes,
        maxBytes: this._maxBytes,
      };
    }

    _evictOldest() {
      // Map 迭代按插入顺序，第一个是最旧的
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
