(function () {
  'use strict';

  class VirtualList {
    constructor(opts) {
      this._container = opts.container;
      this._scrollContainer = opts.scrollContainer || opts.container;
      this._items = opts.items || [];
      this._itemHeight = opts.itemHeight || 56;
      this._bufferSize = opts.bufferSize != null ? opts.bufferSize : 10;
      this._renderItem = opts.renderItem;
      this._onRangeChange = opts.onRangeChange || null;
      this._onRecycle = opts.onRecycle || null;
      this._getHeight = opts.getHeight;
      this._estimatedItemHeight = opts.estimatedItemHeight || this._itemHeight;

      this._heightCache = null;
      this._heightCacheOffset = 0;
      this._totalHeight = 0;

      this._spacer = document.createElement('div');
      this._spacer.style.width = '100%';
      this._spacer.style.height = '0px';

      this._content = document.createElement('div');
      this._content.style.position = 'relative';
      this._content.style.willChange = 'transform';

      this._spacer.appendChild(this._content);
      this._container.appendChild(this._spacer);

      this._pool = [];
      this._activeNodes = [];

      this._scrollTop = this._scrollContainer.scrollTop || 0;
      this._lastStartIndex = -1;
      this._lastEndIndex = -1;
      this._lastRenderedScrollTop = this._scrollTop;
      this._rafPending = false;

      this._onScrollBound = this._onScroll.bind(this);
      this._scrollContainer.addEventListener('scroll', this._onScrollBound, { passive: true });

      this._onResizeBound = this._onResize.bind(this);
      window.addEventListener('resize', this._onResizeBound);

      this._computeHeights();
      this._render();
    }

    setItems(items) {
      this._items = items || [];
      this._scrollTop = this._scrollContainer.scrollTop || 0;
      this._recycleAll();
      this._computeHeights();
      this._render();
    }

    scrollToIndex(index) {
      if (index < 0 || index >= this._items.length) return;
      var top = this._getOffset(index);
      this._scrollContainer.scrollTop = top;
    }

    refresh() {
      this._render();
    }

    get container() {
      return this._container;
    }

    destroy() {
      this._scrollContainer.removeEventListener('scroll', this._onScrollBound);
      window.removeEventListener('resize', this._onResizeBound);
      this._container.innerHTML = '';
      this._pool = [];
      this._activeNodes = [];
    }


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
      this._render();
    }

    _computeHeights() {
      var n = this._items.length;
      if (n === 0) {
        this._totalHeight = 0;
        this._heightCache = null;
        return;
      }

      if (this._getHeight) {
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
        this._totalHeight = n * this._itemHeight;
        this._heightCache = null;
      }
      this._spacer.style.height = this._totalHeight + 'px';
    }

    _getOffset(index) {
      if (!this._heightCache) {
        return index * this._itemHeight;
      }
      var v = this._heightCache.offsets[index];
      return v === undefined ? 0 : v;
    }

    _getHeightAt(index) {
      if (!this._heightCache) return this._itemHeight;
      var v = this._heightCache.heights[index];
      return v === undefined ? this._estimatedItemHeight : v;
    }

    _findStartIndex(scrollTop) {
      if (!this._heightCache) {
        return Math.floor(scrollTop / this._itemHeight);
      }
      var offsets = this._heightCache.offsets;
      var n = this._items.length;
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
      startIndex = Math.max(0, startIndex - this._bufferSize);

      var endIndex = startIndex;
      var acc = this._getOffset(startIndex);
      while (endIndex < n && acc < scrollTop + viewportHeight) {
        acc += this._getHeightAt(endIndex);
        endIndex++;
      }
      endIndex = Math.min(n, endIndex + this._bufferSize);

      if (startIndex === this._lastStartIndex && endIndex === this._lastEndIndex) {
        return;
      }
      this._lastStartIndex = startIndex;
      this._lastEndIndex = endIndex;
      var direction = this._scrollTop > this._lastRenderedScrollTop ? 1 :
        (this._scrollTop < this._lastRenderedScrollTop ? -1 : 0);
      this._lastRenderedScrollTop = this._scrollTop;

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

      var byIndex = new Map();
      for (var j = 0; j < this._activeNodes.length; j++) {
        byIndex.set(this._activeNodes[j].index, this._activeNodes[j].el);
      }

      var offsetTop = this._getOffset(startIndex);
      this._content.style.transform = 'translateY(' + offsetTop + 'px)';

      var currentY = 0;
      var frag = document.createDocumentFragment();
      var created = 0;
      for (var k = startIndex; k < endIndex; k++) {
        var itemHeight = this._getHeightAt(k);
        var existing = byIndex.get(k);
        if (existing === undefined) {
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
          if (existing.style.top !== currentY + 'px') {
            existing.style.top = currentY + 'px';
          }
          if (existing.style.height !== itemHeight + 'px') {
            existing.style.height = itemHeight + 'px';
          }
        }
        currentY += itemHeight;
      }
      if (created > 0) this._content.appendChild(frag);
    }

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
