/**
 * Carminium — 专辑页
 */
(function () {
  'use strict';

  window.App = window.App || {};
  const page = {};
  window.App.pages.albums = page;

  let allAlbums = [];
  let filterStr = '';
  let searchText = '';
  let sortMode = 'az'; // 'az', 'za', 'artist', 'year'

  // 排序选项配置
  const SORT_OPTIONS = [
    { key: 'az', label: 'A-Z', icon: 'sort_by_alpha' },
    { key: 'za', label: 'Z-A', icon: 'sort_by_alpha' },
    { key: 'artist', label: '歌手', icon: 'person' },
    { key: 'year', label: '发行年份', icon: 'calendar_today' },
  ];

  page.render = function (container, params) {
    container.innerHTML = `
      <div class="page-sticky-header">
        <div class="page-header">
          <div class="page-header-left">
            <h1 class="page-title">专辑</h1>
            <p class="page-subtitle" id="album-count">加载中…</p>
          </div>
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
        </div>
        <div class="search-bar">
          <span class="material-symbols-rounded">search</span>
          <input type="text" id="album-search" placeholder="搜索专辑或艺术家…" aria-label="搜索专辑">
        </div>
      </div>
      <div class="album-grid az-grid" id="album-grid"></div>
    `;

    const searchInput = document.getElementById('album-search');
    searchInput.value = searchText;
    searchInput.addEventListener('input', function (e) {
      searchText = e.target.value;
      filterStr = searchText.trim().toLowerCase();
      _renderGrid(container);
    });

    // 排序下拉菜单事件
    _setupSortDropdown(container);

    // 从前端缓存读取（启动时已拉取，library_updated 时刷新）
    allAlbums = (App.state && App.state.allAlbums) ? App.state.allAlbums : [];
    if (params && params.album && params.album_artist) {
      const target = allAlbums.find(function (a) {
        return a.album === params.album && a.album_artist === params.album_artist;
      });
      if (target) {
        _renderDetail(container, target);
        return;
      }
    }
    _renderGrid(container);
  };

  function _setupSortDropdown(container) {
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
          _renderGrid(container);
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

  function _sortAlbums(list) {
    const sorted = list.slice();
    switch (sortMode) {
      case 'az':
        sorted.sort((a, b) => {
          const ka = App.utils.itemSortKey(a, 'sort_key', 'album');
          const kb = App.utils.itemSortKey(b, 'sort_key', 'album');
          return ka.localeCompare(kb);
        });
        break;
      case 'za':
        sorted.sort((a, b) => {
          const ka = App.utils.itemSortKey(a, 'sort_key', 'album');
          const kb = App.utils.itemSortKey(b, 'sort_key', 'album');
          return kb.localeCompare(ka);
        });
        break;
      case 'artist':
        sorted.sort((a, b) => {
          const aa = App.utils.itemSortKey(a, 'album_artist_sort_key', 'album_artist');
          const ab = App.utils.itemSortKey(b, 'album_artist_sort_key', 'album_artist');
          if (aa !== ab) return aa.localeCompare(ab);
          // 同歌手按专辑名排序
          const ka = App.utils.itemSortKey(a, 'sort_key', 'album');
          const kb = App.utils.itemSortKey(b, 'sort_key', 'album');
          return ka.localeCompare(kb);
        });
        break;
      case 'year':
        sorted.sort((a, b) => {
          const ya = a.year || 0;
          const yb = b.year || 0;
          if (ya !== yb) return yb - ya; // 年份降序（最新的在前）
          // 同年按专辑名排序
          const ka = App.utils.itemSortKey(a, 'sort_key', 'album');
          const kb = App.utils.itemSortKey(b, 'sort_key', 'album');
          return ka.localeCompare(kb);
        });
        break;
    }
    return sorted;
  }

  function _getAlbumGroupKey(album) {
    switch (sortMode) {
      case 'artist':
        return album.album_artist || album.artist || '未知艺术家';
      case 'year':
        return album.year ? String(album.year) : '未知年份';
      case 'za':
        // Z-A 排序时，按首字母分组但显示为 Z-A 顺序
        return App.utils.itemSortLetter(album, 'sort_key', 'album');
      case 'az':
      default:
        return App.utils.itemSortLetter(album, 'sort_key', 'album');
    }
  }

  function _groupAlbums(list) {
    // A-Z 和 Z-A 使用原有的 groupByLetter
    if (sortMode === 'az' || sortMode === 'za') {
      return App.utils.groupByLetter(list, a => a.album || '');
    }
    // 其他排序模式按对应字段分组
    const groups = [];
    let current = null;
    for (let i = 0; i < list.length; i++) {
      const album = list[i];
      const key = _getAlbumGroupKey(album);
      if (!current || current.letter !== key) {
        current = { letter: key, items: [] };
        groups.push(current);
      }
      current.items.push(album);
    }
    return groups;
  }

  function _renderGrid(container) {
    const grid = document.getElementById('album-grid');
    if (!grid) return;

    let list = filterStr ? allAlbums.filter(a => {
      const q = filterStr;
      return (a.album && a.album.toLowerCase().includes(q)) ||
             (a.album_artist && a.album_artist.toLowerCase().includes(q));
    }) : allAlbums;

    // 应用排序
    list = _sortAlbums(list);

    const countEl = document.getElementById('album-count');
    if (countEl) {
      countEl.textContent = filterStr ? `${list.length} / ${allAlbums.length} 张专辑` : `${allAlbums.length} 张专辑`;
    }

    if (list.length === 0) {
      grid.style.display = 'block';
      grid.innerHTML = `
        <div class="empty-state">
          <span class="material-symbols-rounded empty-icon">album</span>
          <h2 class="empty-title">无结果</h2>
        </div>
      `;
      return;
    }

    grid.style.display = 'grid';
    grid.innerHTML = '';
    const frag = document.createDocumentFragment();

    // 根据排序模式生成分组
    const groups = filterStr ? [{ letter: '', items: list }] : _groupAlbums(list);

    groups.forEach(group => {
      if (!filterStr) {
        const header = document.createElement('div');
        header.className = 'az-grid-header';
        header.innerHTML = `<span class="az-section-letter">${group.letter}</span>`;
        frag.appendChild(header);
      }
      group.items.forEach(album => {
        const card = document.createElement('div');
        card.className = 'album-card';
        
        let coverHtml = '';
        if (album.cover_track_id) {
          coverHtml = `<img src="${window.coverUrl(album.cover_track_id)}" alt="封面" loading="lazy">`;
        } else {
          const bg = App.utils.hashColor(album.album);
          coverHtml = `
            <div style="width:100%; height:100%; background:${bg}; display:flex; align-items:center; justify-content:center;">
              <span class="album-cover-letter">${App.utils.initial(album.album)}</span>
            </div>
          `;
        }

        card.innerHTML = `
          <div class="album-cover">${coverHtml}</div>
          <div class="album-info">
            <p class="album-name">${App.utils.esc(album.album)}</p>
            <p class="album-meta">${App.utils.esc(album.album_artist)} · ${album.year || '?'} · ${album.track_count} 首</p>
          </div>
        `;

        card.addEventListener('click', () => _renderDetail(container, album));
        frag.appendChild(card);
      });
    });
    grid.appendChild(frag);
  }

  function _renderDetail(container, album) {
    // 保存列表滚动位置，以便返回时恢复
    App.scrollMemory.save('albums');
    // 渲染专辑详情页
    container.innerHTML = `
      <div class="detail-header">
        <button class="back-btn" id="btn-back" aria-label="返回专辑列表" title="返回专辑列表">
          <span class="material-symbols-rounded">arrow_back</span>
        </button>
        <div class="detail-cover" id="detail-cover">
          <div class="detail-cover-blur" id="detail-cover-blur"></div>
          <div class="detail-cover-shape s1"></div>
          <div class="detail-cover-shape s2"></div>
          <div class="detail-cover-shape s3"></div>
          <div class="detail-cover-main" id="detail-cover-main"></div>
        </div>
        <div class="detail-cover-gradient"></div>
        <div class="detail-meta">
          <p class="detail-type">专辑</p>
          <h1 class="detail-name">${App.utils.esc(album.album)}</h1>
          <p class="detail-sub">${App.utils.esc(album.album_artist)} · ${album.year || '未知年份'} · ${album.track_count} 首</p>
          <div class="detail-actions">
            <button class="detail-play-btn" id="btn-play-album">
              <span class="material-symbols-rounded">play_arrow</span>播放
            </button>
          </div>
        </div>
      </div>
      <ul class="track-list" id="album-track-list"></ul>
    `;

    document.getElementById('btn-back').addEventListener('click', () => {
      page.render(container);
      App.scrollMemory.restore('albums');
    });

    const coverUrl = album.cover_track_id ? window.coverUrl(album.cover_track_id) : null;
    const blurEl = document.getElementById('detail-cover-blur');
    const mainEl = document.getElementById('detail-cover-main');
    const shapes = document.querySelectorAll('.detail-cover-shape');

    if (coverUrl) {
      blurEl.style.backgroundImage = `url(${coverUrl})`;
      mainEl.style.backgroundImage = `url(${coverUrl})`;
      mainEl.innerHTML = '';
      shapes.forEach(s => { s.style.backgroundImage = `url(${coverUrl})`; });
    } else {
      const color = App.utils.hashColor(album.album);
      const initial = App.utils.initial(album.album);
      blurEl.style.background = color;
      mainEl.style.background = color;
      mainEl.innerHTML = `<span class="album-cover-letter" style="font-size:40px">${initial}</span>`;
      shapes.forEach(s => { s.style.background = color; });
    }

    // 从前端 allTracks 缓存过滤专辑曲目（按 album + album_artist 匹配，
    // 按 disc_number / track_number 排序，与后端 get_album_tracks 行为一致）
    const allTracks = (App.state && App.state.allTracks) ? App.state.allTracks : [];
    const tracks = allTracks.filter(function (t) {
      if (t.album !== album.album) return false;
      const tArtist = t.album_artist || t.artist;
      return tArtist === album.album_artist;
    }).sort(function (a, b) {
      const da = (a.disc_number || 0), db = (b.disc_number || 0);
      if (da !== db) return da - db;
      return (a.track_number || 0) - (b.track_number || 0);
    });

    const ul = document.getElementById('album-track-list');
    const frag = document.createDocumentFragment();

    tracks.forEach((track, i) => {
      // 表示番号はメタデータの曲番号、再生位置はリスト内の実際の並び順(0-based)を使用する。
      // 両者が異なる場合でも、クリックした行が正しく再生されるようにする。
      const displayNum = track.track_number || (i + 1);
      const li = App.utils.trackRow(track, displayNum, function (clickedTrack, idx) {
        App.backend.play_from_list(JSON.stringify(tracks), idx);
      }, false, i);
      frag.appendChild(li);
    });
    ul.appendChild(frag);

    document.getElementById('btn-play-album').addEventListener('click', () => {
      App.backend.play_from_list(JSON.stringify(tracks), 0);
    });
  }

  page.updatePlayState = function () {
    const list = document.getElementById('album-track-list');
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

})();
