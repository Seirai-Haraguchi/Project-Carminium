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
      // 从容器同步滚动位置：调用方常在换数据前把 scrollTop 归零，
      // 若沿用缓存的 _scrollTop 会与容器实际值不一致，
      // 造成首帧按旧位置计算偏移表 → 行错位。这里以容器为准。
      this._scrollTop = this._scrollContainer.scrollTop || 0;
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
     * 列表容器元素（调用方可用它判断实例是否仍挂在当前 DOM 上）。
     * 页面切换会重建容器，复用逻辑据此决定 setItems 还是重建实例。
     */
    get container() {
      return this._container;
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
        // 动态高度模式：缓存每项高度和累计偏移。
        //
        // ⚠️ 高度来源必须是 `estimatedItemHeight`（即调用方给的统一行高），
        //    **不是** `getHeight(item)`。这是一个刻意的行为对齐：
        //
        // 原实现写的是 `this._heightCache.length < n`，但 _heightCache 是
        // {heights, offsets} 对象，.length 恒为 undefined，`undefined < n`
        // 恒为 false → 条件只在首次（_heightCache 为 null）成立，而那次
        // 填入的也全是 `_estimatedItemHeight`，从未调用过 getHeight。
        // 结果：动态行高列表（music / artists 的分组表头）实际上一直按
        // 统一行高布局，表头拿到的也是行高而非它自己的 HEADER_HEIGHT。
        //
        // 若改成真正调用 getHeight，表头高度会从 56 变成 32，整份偏移表
        // 随之变化 → 所有行的 y 坐标与优化前不同，属于视觉回归。
        // 因此这里保持"按估算高度填充"，只把失效的缓存判定修好：
        // 条目数变化时必须重算，否则复用实例后会沿用上一次的偏移表。
        //
        // 数组按容量复用，避免每次 setItems 都重新分配 n×2 个元素。
        var cache = this._heightCache;
        if (!cache || cache.count !== n || cache.heights.length < n) {
          cache = this._heightCache = { heights: new Array(n), offsets: new Array(n), count: n };
        }
        cache.count = n;
        var heights = cache.heights;
        var offsets = cache.offsets;
        var eh = this._estimatedItemHeight;
        var acc = 0;
        for (var i = 0; i < n; i++) {
          heights[i] = eh;
          offsets[i] = acc;
          acc += eh;
        }
        this._totalHeight = acc;
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
      var v = this._heightCache.offsets[index];
      return v === undefined ? 0 : v;
    }

    /**
     * 获取第 index 项的高度。
     */
    _getHeightAt(index) {
      if (!this._heightCache) return this._itemHeight;
      var v = this._heightCache.heights[index];
      return v === undefined ? this._estimatedItemHeight : v;
    }

    /**
     * 二分查找：给定 scrollTop，找到第一个可见项的index。
     */
    _findStartIndex(scrollTop) {
      if (!this._heightCache) {
        return Math.floor(scrollTop / this._itemHeight);
      }
      var offsets = this._heightCache.offsets;
      var n = this._items.length;
      // 防御：offsets 长度必须以当前条目数为准（见 _computeHeights 的 count 字段）
      var hi = (offsets.length < n ? offsets.length : n) - 1;
      if (hi < 0) return 0;
      var lo = 0;
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
      // index → node 映射：原实现对每个位置线性扫描 _activeNodes 找匹配，
      // 是 O(可视项数 × 活动节点数)。可视区 ~40 项、缓冲后 ~60 节点时，
      // 单次渲染要 2400 次比较；快速滚动时每帧都跑，直接体现为掉帧。
      // 这里一次建成 Map，后续查找 O(1)。
      var byIndex = new Map();
      for (var j = 0; j < this._activeNodes.length; j++) {
        byIndex.set(this._activeNodes[j].index, this._activeNodes[j].el);
      }

      // 按顺序补齐缺失的 index
      var offsetTop = this._getOffset(startIndex);
      this._content.style.transform = 'translateY(' + offsetTop + 'px)';

      var currentY = 0;
      var frag = document.createDocumentFragment();
      var created = 0;
      for (var k = startIndex; k < endIndex; k++) {
        var itemHeight = this._getHeightAt(k);
        var existing = byIndex.get(k);
        if (existing === undefined) {
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
          frag.appendChild(el);
          this._activeNodes.push({ el: el, index: k });
          created++;
        } else {
          // 复用已有节点，仅在偏移/高度真的变化时写样式，
          // 避免每次滚动都触发无谓的样式失效与重排
          if (existing.style.top !== currentY + 'px') {
            existing.style.top = currentY + 'px';
          }
          if (existing.style.height !== itemHeight + 'px') {
            existing.style.height = itemHeight + 'px';
          }
        }
        currentY += itemHeight;
      }
      // 批量插入：单次 reflow 代替逐个 appendChild
      if (created > 0) this._content.appendChild(frag);
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
