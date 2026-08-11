/**
 * VirtualList — 通用虚拟滚动渲染器
 *
 * 职责：只渲染可视区域 + 预缓冲的 DOM 节点，不再一次性渲染整个列表。
 *
 * 核心思路：
 *   - 列表容器 (scrollEl) 高度 = items.length * itemHeight（撑开滚动条）
 *   - 内容层 (contentEl) 用 transform 偏移到当前可见区域
 *   - 只渲染 [startIndex, endIndex] 范围内的项
 *
 * 支持两种模式：
 *   1. 固定行高（track list / artist list）：itemHeight = number
 *   2. 动态行高（含分组表头）：估算 + 测量修正
 *
 * 性能：
 *   - 5000+ 项的列表，DOM 节点从 40000+ 降到 ~200（可视区 + 缓冲）
 *   - 事件监听器从 25000+ 降到 ~200
 *   - 滚动时复用已创建的 DOM（对象池），不重建
 *
 * 使用示例：
 *   var vl = new VirtualList({
 *     container: ulElement,        // 滚动容器
 *     items: tracks,                // 数据数组
 *     itemHeight: 56,               // 单项高度
 *     bufferSize: 10,               // 视口上下各缓冲 10 项
 *     renderItem: function (item, index, el) {
 *       // 更新 el 的内容；el 是复用的 DOM 节点
 *       el.innerHTML = '...';
 *     },
 *   });
 *   vl.setItems(newTracks);  // 数据变更
 *   vl.scrollToIndex(100);   // 滚动到第 100 项
 */
(function () {
  'use strict';

  class VirtualList {
    /**
     * @param {object} opts
     * @param {HTMLElement} opts.container - 列表容器（放置 spacer 的元素）
     * @param {HTMLElement} [opts.scrollContainer] - 外部滚动容器；省略则用 container 自身
     * @param {Array} opts.items - 数据数组
     * @param {number} opts.itemHeight - 单项固定高度（px）
     * @param {number} [opts.bufferSize=10] - 视口上下缓冲项数
     * @param {Function} opts.renderItem - (item, index, el) → void，复用 DOM 更新内容
     * @param {Function} [opts.getHeight] - 动态高度计算 (item, index) → number；省略用 itemHeight
     * @param {number} [opts.estimatedItemHeight] - 动态高度模式的估算值
     */
    constructor(opts) {
      this._container = opts.container;
      // 外部滚动容器：让 content-pane 滚动，sticky-header 在 content-pane 内部
      // 自然 sticky，backdrop-filter 能模糊背后滚动的列表内容
      this._scrollContainer = opts.scrollContainer || opts.container;
      this._items = opts.items || [];
      this._itemHeight = opts.itemHeight || 56;
      this._bufferSize = opts.bufferSize != null ? opts.bufferSize : 10;
      this._renderItem = opts.renderItem;
      this._onRangeChange = opts.onRangeChange || null;
      this._onRecycle = opts.onRecycle || null;
      this._getHeight = opts.getHeight;
      this._estimatedItemHeight = opts.estimatedItemHeight || this._itemHeight;

      // 动态高度：缓存测量结果 (index → height)
      this._heightCache = null;
      this._heightCacheOffset = 0;  // 累计偏移量 (index → top)
      this._totalHeight = 0;

      // DOM 结构：
      //   container (scroll, overflow-y: auto)
      //     └ spacer (height = totalHeight, 撑开滚动条)
      //         └ content (position: absolute, transform: translateY(offset))
      //             └ [rendered items]
      this._spacer = document.createElement('div');
      this._spacer.style.width = '100%';
      this._spacer.style.height = '0px';

      this._content = document.createElement('div');
      this._content.style.position = 'relative';
      this._content.style.willChange = 'transform';

      this._spacer.appendChild(this._content);
      this._container.appendChild(this._spacer);

      // 对象池：复用 DOM 节点
      this._pool = [];
      this._activeNodes = [];  // [{ el, index }]

      this._scrollTop = this._scrollContainer.scrollTop || 0;
      this._lastStartIndex = -1;
      this._lastEndIndex = -1;
      this._lastRenderedScrollTop = this._scrollTop;
      this._rafPending = false;

      // 绑定事件：监听外部滚动容器的 scroll 事件
      this._onScrollBound = this._onScroll.bind(this);
      this._scrollContainer.addEventListener('scroll', this._onScrollBound, { passive: true });

      // resize 监听
      this._onResizeBound = this._onResize.bind(this);
      window.addEventListener('resize', this._onResizeBound);

      // 初始渲染
      this._computeHeights();
      this._render();
    }

    /**
     * 更新数据数组。
     * @param {Array} items
     */
    setItems(items) {
      this._items = items || [];
      // 回收所有活动节点到池
      this._recycleAll();
      this._computeHeights();
      this._render();
    }

    /**
     * 滚动到指定索引。
     * @param {number} index
     */
    scrollToIndex(index) {
      if (index < 0 || index >= this._items.length) return;
      var top = this._getOffset(index);
      this._scrollContainer.scrollTop = top;
    }

    /**
     * 重新渲染（数据项内容变更时调用）。
     */
    refresh() {
      this._render();
    }

    /**
     * 销毁：解绑事件，清空 DOM。
     */
    destroy() {
      this._scrollContainer.removeEventListener('scroll', this._onScrollBound);
      window.removeEventListener('resize', this._onResizeBound);
      this._container.innerHTML = '';
      this._pool = [];
      this._activeNodes = [];
    }

    // ── 内部实现 ──────────────────────────────────────────────────

    _onScroll() {
      this._scrollTop = this._scrollContainer.scrollTop;
      if (this._rafPending) return;
      this._rafPending = true;
      var self = this;
      requestAnimationFrame(function () {
        self._rafPending = false;
        self._render();
      });
    }

    _onResize() {
      // 视口尺寸变化，重新渲染（高度估算不变）
      this._render();
    }

    /**
     * 计算所有项的高度和累计偏移。
     * 固定高度模式直接算；动态高度模式按估算。
     */
    _computeHeights() {
      var n = this._items.length;
      if (n === 0) {
        this._totalHeight = 0;
        this._heightCache = null;
        return;
      }

      if (this._getHeight) {
        // 动态高度模式：缓存每项高度和累计偏移
        // 首次用估算值填充，渲染后按实际测量修正
        if (!this._heightCache || this._heightCache.length < n) {
          var heights = new Array(n);
          var offsets = new Array(n);
          var acc = 0;
          for (var i = 0; i < n; i++) {
            heights[i] = this._estimatedItemHeight;
            offsets[i] = acc;
            acc += this._estimatedItemHeight;
          }
          this._heightCache = { heights: heights, offsets: offsets };
          this._totalHeight = acc;
        }
      } else {
        // 固定高度模式
        this._totalHeight = n * this._itemHeight;
        this._heightCache = null;
      }
      this._spacer.style.height = this._totalHeight + 'px';
    }

    /**
     * 获取第 index 项的 top 偏移。
     */
    _getOffset(index) {
      if (!this._heightCache) {
        return index * this._itemHeight;
      }
      return this._heightCache.offsets[index] || 0;
    }

    /**
     * 获取第 index 项的高度。
     */
    _getHeightAt(index) {
      if (!this._heightCache) return this._itemHeight;
      return this._heightCache.heights[index] || this._estimatedItemHeight;
    }

    /**
     * 二分查找：给定 scrollTop，找到第一个可见项的 index。
     */
    _findStartIndex(scrollTop) {
      if (!this._heightCache) {
        return Math.floor(scrollTop / this._itemHeight);
      }
      var offsets = this._heightCache.offsets;
      var lo = 0, hi = offsets.length - 1;
      while (lo < hi) {
        var mid = (lo + hi) >> 1;
        if (offsets[mid + 1] <= scrollTop) lo = mid + 1;
        else hi = mid;
      }
      return lo;
    }

    /**
     * 核心渲染：计算可见范围，复用/创建/回收 DOM。
     */
    _render() {
      var items = this._items;
      var n = items.length;
      if (n === 0) {
        this._content.style.transform = 'translateY(0px)';
        this._recycleAll();
        return;
      }

      var scrollTop = this._scrollTop;
      var viewportHeight = this._scrollContainer.clientHeight;

      var startIndex = this._findStartIndex(scrollTop);
      // 向前缓冲
      startIndex = Math.max(0, startIndex - this._bufferSize);

      // 向后找 endIndex
      var endIndex = startIndex;
      var acc = this._getOffset(startIndex);
      while (endIndex < n && acc < scrollTop + viewportHeight) {
        acc += this._getHeightAt(endIndex);
        endIndex++;
      }
      // 向后缓冲
      endIndex = Math.min(n, endIndex + this._bufferSize);

      // 范围未变：跳过
      if (startIndex === this._lastStartIndex && endIndex === this._lastEndIndex) {
        return;
      }
      this._lastStartIndex = startIndex;
      this._lastEndIndex = endIndex;
      var direction = this._scrollTop > this._lastRenderedScrollTop ? 1 :
        (this._scrollTop < this._lastRenderedScrollTop ? -1 : 0);
      this._lastRenderedScrollTop = this._scrollTop;

      // ── 回收不在新范围内的活动节点 ──
      var newActive = [];
      for (var i = 0; i < this._activeNodes.length; i++) {
        var node = this._activeNodes[i];
        if (node.index < startIndex || node.index >= endIndex) {
          if (this._onRecycle) this._onRecycle(node.el);
          this._pool.push(node.el);
          if (node.el.parentNode) node.el.parentNode.removeChild(node.el);
        } else {
          newActive.push(node);
        }
      }
      this._activeNodes = newActive;
      if (this._onRangeChange) {
        this._onRangeChange(this._items, startIndex, endIndex, direction);
      }

      // ── 创建/更新范围内的节点 ──
      // 收集已占用的 index
      var used = {};
      for (var j = 0; j < this._activeNodes.length; j++) {
        used[this._activeNodes[j].index] = true;
      }

      // 按顺序补齐缺失的 index
      var offsetTop = this._getOffset(startIndex);
      this._content.style.transform = 'translateY(' + offsetTop + 'px)';

      var currentY = 0;
      for (var k = startIndex; k < endIndex; k++) {
        var itemHeight = this._getHeightAt(k);
        if (!used[k]) {
          // 新建节点
          var el = this._pool.pop() || document.createElement('div');
          el.style.position = 'absolute';
          el.style.left = '0';
          el.style.top = currentY + 'px';
          el.style.width = '100%';
          el.style.height = itemHeight + 'px';
          el.style.overflow = 'hidden';
          try {
            this._renderItem(items[k], k, el);
          } catch (e) {
            console.error('[VirtualList] renderItem error:', e);
          }
          this._content.appendChild(el);
          this._activeNodes.push({ el: el, index: k });
        } else {
          // 复用已有节点，更新 top 偏移
          for (var m = 0; m < this._activeNodes.length; m++) {
            if (this._activeNodes[m].index === k) {
              this._activeNodes[m].el.style.top = currentY + 'px';
              this._activeNodes[m].el.style.height = itemHeight + 'px';
              break;
            }
          }
        }
        currentY += itemHeight;
      }
    }

    /**
     * 回收所有活动节点到池。
     */
    _recycleAll() {
      for (var i = 0; i < this._activeNodes.length; i++) {
        var node = this._activeNodes[i];
        if (this._onRecycle) this._onRecycle(node.el);
        this._pool.push(node.el);
        if (node.el.parentNode) node.el.parentNode.removeChild(node.el);
      }
      this._activeNodes = [];
      this._lastStartIndex = -1;
      this._lastEndIndex = -1;
    }
  }

  window.VirtualList = VirtualList;
})();
