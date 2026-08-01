/**
 * Carminium — 音乐页（所有曲目）
 */
(function () {
  'use strict';

  window.App = window.App || {};
  const page = {};
  window.App.pages = window.App.pages || {};
  window.App.pages.music = page;

  let allTracks = [];
  let filterStr = '';
  let searchText = '';
  let sortMode = 'az'; // 'az', 'za', 'artist', 'album', 'year'

  // ── 虚拟滚动实例 & 扁平化渲染数据 ──
  let _vl = null;
  // _flatList: [{ type: 'header'|'row', track?, letter?, listIndex? }]
  let _flatList = [];
  // 当前渲染用的过滤+排序后曲目数组（用于 play_from_list）
  let _renderedTracks = [];
  const ROW_HEIGHT = 56;
  const HEADER_HEIGHT = 32;

  // 排序选项配置
  const SORT_OPTIONS = [
    { key: 'az', label: 'A-Z', icon: 'sort_by_alpha' },
    { key: 'za', label: 'Z-A', icon: 'sort_by_alpha' },
    { key: 'artist', labelKey: 'music.sortArtist', icon: 'person' },
    { key: 'album', labelKey: 'music.sortAlbum', icon: 'album' },
    { key: 'year', labelKey: 'music.sortYear', icon: 'calendar_today' },
  ];

  // 从 App.state.allTracks 读取缓存（启动时已拉取，library_updated 时刷新）
  function _loadFromCache() {
    allTracks = (App.state && App.state.allTracks) ? App.state.allTracks : [];
  }

  page.render = function (container) {
    container.innerHTML = `
      <div class="page-sticky-header">
        <div class="page-header">
          <div class="page-header-left">
            <h1 class="page-title" data-i18n="music.title">所有音乐</h1>
            <p class="page-subtitle" id="music-count" data-i18n="common.loading">加载中…</p>
          </div>
          <div class="page-header-right">
            <div class="md-select" id="sort-select">
              <div class="md-select-trigger" tabindex="0" role="button" aria-haspopup="listbox" aria-expanded="false">
                <span class="material-symbols-rounded md-select-icon">${SORT_OPTIONS.find(o => o.key === sortMode).icon}</span>
                <span class="md-select-label">${App.i18n.t(SORT_OPTIONS.find(o => o.key === sortMode).labelKey || '') || SORT_OPTIONS.find(o => o.key === sortMode).label}</span>
                <span class="material-symbols-rounded md-select-arrow">arrow_drop_down</span>
              </div>
              <div class="md-select-menu" role="listbox">
                ${SORT_OPTIONS.map(opt => `
                  <div class="md-select-option ${opt.key === sortMode ? 'selected' : ''}" role="option" data-value="${opt.key}" aria-selected="${opt.key === sortMode}">
                    <span class="material-symbols-rounded md-select-option-icon">${opt.icon}</span>
                    <span class="md-select-option-text">${opt.labelKey ? App.i18n.t(opt.labelKey) : opt.label}</span>
                    ${opt.key === sortMode ? '<span class="material-symbols-rounded md-select-check">check</span>' : ''}
                  </div>
                `).join('')}
              </div>
            </div>
            <button class="btn-filled" id="btn-play-all">
              <span class="material-symbols-rounded">play_arrow</span><span data-i18n="music.playAll">全部播放</span>
            </button>
          </div>
        </div>
        <div class="search-bar">
          <span class="material-symbols-rounded">search</span>
          <input type="text" id="music-search" data-i18n-placeholder="music.searchPlaceholder" placeholder="搜索本地歌曲、艺术家或专辑…" data-i18n-aria-label="common.search" aria-label="搜索">
        </div>
      </div>
      <ul class="track-list az-list vl-track-list" id="music-list"></ul>
    `;

    const searchInput = document.getElementById('music-search');
    searchInput.value = searchText;
    searchInput.addEventListener('input', function (e) {
      searchText = e.target.value;
      filterStr = searchText.trim().toLowerCase();
      _renderList();
    });

    document.getElementById('btn-play-all').addEventListener('click', function () {
      if (allTracks.length > 0) {
        App.backend.play_from_list(JSON.stringify(allTracks), 0);
      }
    });

    // 排序选择器事件
    _setupSortSelect();

    // 从前端缓存读取（启动时已拉取，library_updated 时刷新）
    _loadFromCache();
    document.getElementById('music-count').textContent = App.i18n.t('music.trackCount', { count: allTracks.length });
    _renderList();
  };

  function _setupSortSelect() {
    const select = document.getElementById('sort-select');
    if (!select) return;
    const trigger = select.querySelector('.md-select-trigger');
    const menu = select.querySelector('.md-select-menu');

    function toggleMenu() {
      const expanded = menu.classList.toggle('open');
      trigger.setAttribute('aria-expanded', expanded);
    }

    function closeMenu() {
      menu.classList.remove('open');
      trigger.setAttribute('aria-expanded', 'false');
    }

    trigger.addEventListener('click', toggleMenu);
    trigger.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggleMenu();
      } else if (e.key === 'Escape') {
        closeMenu();
      }
    });

    menu.querySelectorAll('.md-select-option').forEach(option => {
      option.addEventListener('click', function () {
        const newSort = this.dataset.value;
        if (newSort && newSort !== sortMode) {
          sortMode = newSort;
          // 更新触发器显示
          const opt = SORT_OPTIONS.find(o => o.key === sortMode);
          if (opt) {
            select.querySelector('.md-select-icon').textContent = opt.icon;
            select.querySelector('.md-select-label').textContent = opt.label;
          }
          // 更新选项选中状态
          menu.querySelectorAll('.md-select-option').forEach(o => {
            o.classList.remove('selected');
            o.setAttribute('aria-selected', 'false');
            const check = o.querySelector('.md-select-check');
            if (check) check.remove();
          });
          this.classList.add('selected');
          this.setAttribute('aria-selected', 'true');
          const checkSpan = document.createElement('span');
          checkSpan.className = 'material-symbols-rounded md-select-check';
          checkSpan.textContent = 'check';
          this.appendChild(checkSpan);
          // 重新渲染
          _renderList();
        }
        closeMenu();
      });
    });

    document.addEventListener('click', function (e) {
      if (!select.contains(e.target)) {
        closeMenu();
      }
    });
  }

  page.updatePlayState = function () {
    const list = document.getElementById('music-list');
    if (!list) return;
    const currentId = App.state.currentTrack ? App.state.currentTrack.id : null;
    // 虚拟滚动：只更新当前可见的 .vl-track-row-wrapper 元素
    const rows = list.querySelectorAll('.vl-track-row-wrapper, [data-track-id]');
    rows.forEach(li => {
      if (li.dataset.trackId === currentId) {
        li.classList.add('playing');
      } else {
        li.classList.remove('playing');
      }
    });
  };

  function _sortTracks(list) {
    const sorted = list.slice();
    switch (sortMode) {
      case 'az':
        sorted.sort((a, b) => {
          const ka = App.utils.itemSortKey(a, 'sort_key', 'title');
          const kb = App.utils.itemSortKey(b, 'sort_key', 'title');
          return ka.localeCompare(kb);
        });
        break;
      case 'za':
        sorted.sort((a, b) => {
          const ka = App.utils.itemSortKey(a, 'sort_key', 'title');
          const kb = App.utils.itemSortKey(b, 'sort_key', 'title');
          return kb.localeCompare(ka);
        });
        break;
      case 'artist':
        sorted.sort((a, b) => {
          const aa = App.utils.itemSortKey(a, 'artist_sort_key', 'artist');
          const ab = App.utils.itemSortKey(b, 'artist_sort_key', 'artist');
          if (aa !== ab) return aa.localeCompare(ab);
          const ka = App.utils.itemSortKey(a, 'sort_key', 'title');
          const kb = App.utils.itemSortKey(b, 'sort_key', 'title');
          return ka.localeCompare(kb);
        });
        break;
      case 'album':
        sorted.sort((a, b) => {
          const aa = App.utils.itemSortKey(a, 'album_sort_key', 'album');
          const ab = App.utils.itemSortKey(b, 'album_sort_key', 'album');
          if (aa !== ab) return aa.localeCompare(ab);
          const da = (a.disc_number || 0) - (b.disc_number || 0);
          if (da !== 0) return da;
          return (a.track_number || 0) - (b.track_number || 0);
        });
        break;
      case 'year':
        sorted.sort((a, b) => {
          const ya = a.year || 0;
          const yb = b.year || 0;
          if (ya !== yb) return yb - ya;
          const ka = App.utils.itemSortKey(a, 'sort_key', 'title');
          const kb = App.utils.itemSortKey(b, 'sort_key', 'title');
          return ka.localeCompare(kb);
        });
        break;
    }
    return sorted;
  }

  function _getGroupKey(track) {
    switch (sortMode) {
      case 'artist': return track.artist || App.i18n.t('common.unknownArtist');
      case 'album': return track.album || App.i18n.t('common.unknownAlbum');
      case 'year': return track.year ? String(track.year) : App.i18n.t('music.unknownYear');
      default: return App.utils.itemSortLetter(track, 'sort_key', 'title');
    }
  }

  function _groupTracks(list) {
    const groups = [];
    let current = null;
    for (let i = 0; i < list.length; i++) {
      const track = list[i];
      const key = _getGroupKey(track);
      if (!current || current.letter !== key) {
        current = { letter: key, items: [] };
        groups.push(current);
      }
      current.items.push(track);
    }
    return groups;
  }

  function _renderList() {
    const ul = document.getElementById('music-list');
    if (!ul) return;

    let list = filterStr ? allTracks.filter(t => {
      const q = filterStr;
      return (t.title && t.title.toLowerCase().includes(q)) ||
             (t.artist && t.artist.toLowerCase().includes(q)) ||
             (t.album && t.album.toLowerCase().includes(q));
    }) : allTracks;

    // 应用排序
    list = _sortTracks(list);

    if (list.length === 0) {
      // 销毁虚拟列表，显示空状态
      if (_vl) { _vl.destroy(); _vl = null; }
      _flatList = [];
      _renderedTracks = [];
      ul.classList.remove('az-list');
      ul.innerHTML = `
        <div class="empty-state">
          <span class="material-symbols-rounded empty-icon">music_off</span>
          <h2 class="empty-title" data-i18n="common.noResults">无结果</h2>
        </div>
      `;
      return;
    }

    // 有搜索词时不显示分组表头
    const showGroup = !filterStr;
    const groups = showGroup ? _groupTracks(list) : [{ letter: '', items: list }];

    // ── 扁平化为虚拟列表的渲染数据 ──
    // _flatList: [{ type: 'header'|'row', track?, letter?, displayNum? }]
    _flatList = [];
    _renderedTracks = list;
    let counter = 0;
    groups.forEach(group => {
      if (showGroup) {
        _flatList.push({ type: 'header', letter: group.letter });
      }
      group.items.forEach(track => {
        counter++;
        _flatList.push({ type: 'row', track: track, displayNum: counter });
      });
    });

    // ── 销毁旧实例，清空容器 ──
    if (_vl) { _vl.destroy(); _vl = null; }
    ul.classList.add('az-list');
    ul.innerHTML = '';

    // ── 创建虚拟列表 ──
    // 动态高度：表头 32px，曲目行 56px
    _vl = new window.VirtualList({
      container: ul,
      scrollContainer: document.getElementById('content-pane'),
      items: _flatList,
      itemHeight: ROW_HEIGHT,
      estimatedItemHeight: ROW_HEIGHT,
      getHeight: function (item) {
        return item.type === 'header' ? HEADER_HEIGHT : ROW_HEIGHT;
      },
      bufferSize: 8,
      renderItem: function (item, index, el) {
        // 复用 DOM：根据 type 切换 className 和内容
        if (item.type === 'header') {
          el.className = 'az-section-header vl-item';
          el.innerHTML = '<span class="az-section-letter">' + item.letter + '</span>';
          el.removeAttribute('data-track-id');
        } else {
          // 曲目行：用 trackRow 构建并替换 el 内容
          // 注意：trackRow 返回 <li>，但我们复用 <div> 容器，把 li 内容搬进来
          const track = item.track;
          const displayNum = item.displayNum;
          const li = App.utils.trackRow(track, displayNum, function (clickedTrack, idx) {
            // 在过滤+排序后的列表中找到点击项的实际播放索引
            const playIdx = _renderedTracks.indexOf(clickedTrack);
            App.backend.play_from_list(JSON.stringify(_renderedTracks), playIdx);
          }, true);

          // 把 li 的内容搬到 el（保留事件：trackRow 已给 li 加监听，所以直接用 li 替换）
          el.className = 'vl-track-row-wrapper';
          el.innerHTML = '';
          // 把 li 作为子元素插入（保留所有事件绑定）
          el.appendChild(li);
          el.dataset.trackId = track.id;
        }
      },
    });
  }

})();
