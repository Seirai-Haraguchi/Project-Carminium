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

  // 排序选项配置
  const SORT_OPTIONS = [
    { key: 'az', label: 'A-Z', icon: 'sort_by_alpha' },
    { key: 'za', label: 'Z-A', icon: 'sort_by_alpha' },
    { key: 'artist', label: '歌手', icon: 'person' },
    { key: 'album', label: '专辑', icon: 'album' },
    { key: 'year', label: '发行年份', icon: 'calendar_today' },
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
            <h1 class="page-title">所有音乐</h1>
            <p class="page-subtitle" id="music-count">加载中…</p>
          </div>
          <div class="page-header-right">
            <div class="md-select" id="sort-select">
              <div class="md-select-trigger" tabindex="0" role="button" aria-haspopup="listbox" aria-expanded="false">
                <span class="material-symbols-rounded md-select-icon">${SORT_OPTIONS.find(o => o.key === sortMode).icon}</span>
                <span class="md-select-label">${SORT_OPTIONS.find(o => o.key === sortMode).label}</span>
                <span class="material-symbols-rounded md-select-arrow">arrow_drop_down</span>
              </div>
              <div class="md-select-menu" role="listbox">
                ${SORT_OPTIONS.map(opt => `
                  <div class="md-select-option ${opt.key === sortMode ? 'selected' : ''}" role="option" data-value="${opt.key}" aria-selected="${opt.key === sortMode}">
                    <span class="material-symbols-rounded md-select-option-icon">${opt.icon}</span>
                    <span class="md-select-option-text">${opt.label}</span>
                    ${opt.key === sortMode ? '<span class="material-symbols-rounded md-select-check">check</span>' : ''}
                  </div>
                `).join('')}
              </div>
            </div>
            <button class="btn-filled" id="btn-play-all">
              <span class="material-symbols-rounded">play_arrow</span>全部播放
            </button>
          </div>
        </div>
        <div class="search-bar">
          <span class="material-symbols-rounded">search</span>
          <input type="text" id="music-search" placeholder="搜索本地歌曲、艺术家或专辑…" aria-label="搜索">
        </div>
      </div>
      <ul class="track-list az-list" id="music-list"></ul>
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
    document.getElementById('music-count').textContent = `${allTracks.length} 首曲目`;
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
    Array.from(list.children).forEach(li => {
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
      case 'artist': return track.artist || '未知艺术家';
      case 'album': return track.album || '未知专辑';
      case 'year': return track.year ? String(track.year) : '未知年份';
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
    ul.innerHTML = '';

    let list = filterStr ? allTracks.filter(t => {
      const q = filterStr;
      return (t.title && t.title.toLowerCase().includes(q)) ||
             (t.artist && t.artist.toLowerCase().includes(q)) ||
             (t.album && t.album.toLowerCase().includes(q));
    }) : allTracks;

    // 应用排序
    list = _sortTracks(list);

    if (list.length === 0) {
      ul.innerHTML = `
        <div class="empty-state">
          <span class="material-symbols-rounded empty-icon">music_off</span>
          <h2 class="empty-title">无结果</h2>
        </div>
      `;
      return;
    }

    // 有搜索词时不显示分组表头
    const showGroup = !filterStr;
    const groups = showGroup ? _groupTracks(list) : [{ letter: '', items: list }];

    const fragment = document.createDocumentFragment();
    let counter = 0;
    groups.forEach(group => {
      if (showGroup) {
        const header = document.createElement('li');
        header.className = 'az-section-header';
        header.innerHTML = `<span class="az-section-letter">${group.letter}</span>`;
        fragment.appendChild(header);
      }
      group.items.forEach((track) => {
        counter++;
        const li = App.utils.trackRow(track, counter, function (clickedTrack, idx) {
          App.backend.play_from_list(JSON.stringify(list), list.indexOf(clickedTrack));
        }, true /* show mini cover instead of number */);
        fragment.appendChild(li);
      });
    });
    ul.appendChild(fragment);
  }

})();
