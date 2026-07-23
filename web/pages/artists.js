/**
 * Carminium — 艺术家页
 */
(function () {
  'use strict';

  window.App = window.App || {};
  const page = {};
  window.App.pages.artists = page;

  let allArtists = [];
  let filterStr = '';
  let searchText = '';
  let sortMode = 'az'; // 'az', 'za', 'albums', 'tracks'

  // 排序选项配置
  const SORT_OPTIONS = [
    { key: 'az', label: 'A-Z', icon: 'sort_by_alpha' },
    { key: 'za', label: 'Z-A', icon: 'sort_by_alpha' },
    { key: 'albums', label: '专辑', icon: 'album' },
    { key: 'tracks', label: '曲目', icon: 'music_note' },
  ];

  page.render = function (container, params) {
    container.innerHTML = `
      <div class="page-sticky-header">
        <div class="page-header">
          <div class="page-header-left">
            <h1 class="page-title">艺术家</h1>
            <p class="page-subtitle" id="artist-count">加载中…</p>
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
          <input type="text" id="artist-search" placeholder="搜索艺术家…" aria-label="搜索艺术家">
        </div>
      </div>
      <div class="artist-list az-list" id="artist-list"></div>
    `;

    const searchInput = document.getElementById('artist-search');
    searchInput.value = searchText;
    searchInput.addEventListener('input', function (e) {
      searchText = e.target.value;
      filterStr = searchText.trim().toLowerCase();
      _renderList(container);
    });

    // 排序下拉菜单事件
    _setupSortDropdown(container);

    // 从前端缓存读取（启动时已拉取，library_updated 时刷新）
    allArtists = (App.state && App.state.allArtists) ? App.state.allArtists : [];
    if (params && params.artist) {
      const target = allArtists.find(function (a) { return a.name === params.artist; });
      if (target) {
        _renderDetail(container, target);
        return;
      }
    }
    _renderList(container);
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
          _renderList(container);
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

  function _sortArtists(list) {
    const sorted = list.slice();
    switch (sortMode) {
      case 'az':
        sorted.sort((a, b) => {
          const ka = App.utils.itemSortKey(a, 'sort_key', 'name');
          const kb = App.utils.itemSortKey(b, 'sort_key', 'name');
          return ka.localeCompare(kb);
        });
        break;
      case 'za':
        sorted.sort((a, b) => {
          const ka = App.utils.itemSortKey(a, 'sort_key', 'name');
          const kb = App.utils.itemSortKey(b, 'sort_key', 'name');
          return kb.localeCompare(ka);
        });
        break;
      case 'albums':
        sorted.sort((a, b) => {
          const ca = b.album_count || 0;
          const cb = a.album_count || 0;
          if (ca !== cb) return ca - cb; // 专辑数降序
          // 同数量按名字排序
          const ka = App.utils.itemSortKey(a, 'sort_key', 'name');
          const kb = App.utils.itemSortKey(b, 'sort_key', 'name');
          return ka.localeCompare(kb);
        });
        break;
      case 'tracks':
        sorted.sort((a, b) => {
          const ca = b.track_count || 0;
          const cb = a.track_count || 0;
          if (ca !== cb) return ca - cb; // 曲目数降序
          // 同数量按名字排序
          const ka = App.utils.itemSortKey(a, 'sort_key', 'name');
          const kb = App.utils.itemSortKey(b, 'sort_key', 'name');
          return ka.localeCompare(kb);
        });
        break;
    }
    return sorted;
  }

  function _getArtistGroupKey(artist) {
    switch (sortMode) {
      case 'albums':
        {
          const count = artist.album_count || 0;
          if (count >= 10) return '10+';
          if (count >= 5) return '5-9';
          if (count >= 2) return '2-4';
          return '1';
        }
      case 'tracks':
        {
          const count = artist.track_count || 0;
          if (count >= 50) return '50+';
          if (count >= 20) return '20-49';
          if (count >= 10) return '10-19';
          return '1-9';
        }
      case 'za':
        return App.utils.itemSortLetter(artist, 'sort_key', 'name');
      case 'az':
      default:
        return App.utils.itemSortLetter(artist, 'sort_key', 'name');
    }
  }

  function _groupArtists(list) {
    // A-Z 和 Z-A 使用原有的 groupByLetter
    if (sortMode === 'az' || sortMode === 'za') {
      return App.utils.groupByLetter(list, a => a.name || '');
    }
    // 其他排序模式按对应字段分组
    const groups = [];
    let current = null;
    for (let i = 0; i < list.length; i++) {
      const artist = list[i];
      const key = _getArtistGroupKey(artist);
      if (!current || current.letter !== key) {
        current = { letter: key, items: [] };
        groups.push(current);
      }
      current.items.push(artist);
    }
    return groups;
  }

  function _renderList(container) {
    const listEl = document.getElementById('artist-list');
    if (!listEl) return;

    let list = filterStr ? allArtists.filter(a => {
      return a.name && a.name.toLowerCase().includes(filterStr);
    }) : allArtists;

    // 应用排序
    list = _sortArtists(list);

    const countEl = document.getElementById('artist-count');
    if (countEl) {
      countEl.textContent = filterStr ? `${list.length} / ${allArtists.length} 位艺术家` : `${allArtists.length} 位艺术家`;
    }

    if (list.length === 0) {
      listEl.innerHTML = `
        <div class="empty-state">
          <span class="material-symbols-rounded empty-icon">person</span>
          <h2 class="empty-title">无结果</h2>
        </div>
      `;
      return;
    }

    listEl.innerHTML = '';
    const frag = document.createDocumentFragment();

    // 根据排序模式生成分组
    const groups = filterStr ? [{ letter: '', items: list }] : _groupArtists(list);

    groups.forEach(group => {
      if (!filterStr) {
        const header = document.createElement('div');
        header.className = 'az-section-header';
        header.innerHTML = `<span class="az-section-letter">${group.letter}</span>`;
        frag.appendChild(header);
      }
      group.items.forEach(artist => {
        const row = document.createElement('div');
        row.className = 'artist-row';
        
        let avatarHtml = '';
        if (artist.cover_track_id) {
          avatarHtml = `<img src="${window.coverUrl(artist.cover_track_id)}" alt="头像" loading="lazy">`;
        } else {
          avatarHtml = App.utils.initial(artist.name);
        }
        
        const bg = App.utils.hashColor(artist.name);

        row.innerHTML = `
          <div class="artist-avatar" style="${!artist.cover_track_id ? 'background:'+bg+';color:#fff;' : ''}">${avatarHtml}</div>
          <div class="artist-info">
            <p class="artist-name">${App.utils.esc(artist.name)}</p>
            <p class="artist-meta">${artist.album_count} 张专辑 · ${artist.track_count} 首曲目</p>
          </div>
          <span class="material-symbols-rounded artist-chevron">chevron_right</span>
        `;

        row.addEventListener('click', () => _renderDetail(container, artist));
        frag.appendChild(row);
      });
    });
    listEl.appendChild(frag);
  }

  // 艺人详情页状态
  let _allArtistAlbums = [];  // 当前艺人所有专辑（含 tracks）

  function _renderDetail(container, artist) {
    // 保存列表滚动位置，以便返回时恢复
    App.scrollMemory.save('artists');
    container.innerHTML = `
      <div class="detail-header">
        <button class="back-btn" id="btn-back" aria-label="返回艺术家列表" title="返回艺术家列表">
          <span class="material-symbols-rounded">arrow_back</span>
        </button>
        <div class="detail-cover" id="detail-cover">
          <div class="detail-cover-blur" id="detail-cover-blur"></div>
          <div class="detail-cover-shape s1"></div>
          <div class="detail-cover-shape s2"></div>
          <div class="detail-cover-shape s3"></div>
          <div class="detail-cover-main" id="detail-avatar"></div>
        </div>
        <div class="detail-cover-gradient"></div>
        <div class="detail-meta">
          <p class="detail-type">艺术家</p>
          <h1 class="detail-name">${App.utils.esc(artist.name)}</h1>
          <p class="detail-sub">${artist.album_count} 张专辑 · ${artist.track_count} 首曲目</p>
          <div class="detail-actions">
            <button class="detail-play-btn" id="btn-play-artist">
              <span class="material-symbols-rounded">play_arrow</span>播放全部
            </button>
          </div>
        </div>
      </div>
      <div class="artist-albums-scroll" id="artist-albums-scroll"></div>
    `;

    document.getElementById('btn-back').addEventListener('click', () => {
      page.render(container);
      App.scrollMemory.restore('artists');
    });

    const blurEl = document.getElementById('detail-cover-blur');
    const mainEl = document.getElementById('detail-avatar');
    const shapes = document.querySelectorAll('.detail-cover-shape');

    // 先以纯色占位
    const placeholderColor = App.utils.hashColor(artist.name);
    const initial = App.utils.initial(artist.name);
    blurEl.style.background = placeholderColor;
    mainEl.style.background = placeholderColor;
    mainEl.innerHTML = `<span style="font-size:48px; color:#fff; font-weight:700;">${initial}</span>`;
    shapes.forEach(s => { s.style.background = placeholderColor; });

    // 从前端 allTracks 缓存过滤艺术家曲目
    const allTracks = (App.state && App.state.allTracks) ? App.state.allTracks : [];
    const tracks = allTracks.filter(function (t) {
      var names = t.artists || [t.artist || '未知艺术家'];
      return names.indexOf(artist.name) >= 0;
    }).sort(function (a, b) {
      const aa = (a.album || '').toLowerCase(), ab = (b.album || '').toLowerCase();
      if (aa !== ab) return aa < ab ? -1 : 1;
      const da = (a.disc_number || 0), db = (b.disc_number || 0);
      if (da !== db) return da - db;
      return (a.track_number || 0) - (b.track_number || 0);
    });

    // ── 多封面拼贴 ──
    var coverTracks = [];
    for (var t = 0; t < tracks.length; t++) {
      if (tracks[t].has_cover) coverTracks.push(tracks[t]);
    }

    if (coverTracks.length >= 1) {
      var coverCount = Math.min(coverTracks.length, 4);
      var blurUrls = [];
      for (var b = 0; b < coverCount; b++) {
        blurUrls.push('url(' + window.coverUrl(coverTracks[b].id) + ')');
      }
      blurEl.style.background = '';
      blurEl.style.backgroundImage = blurUrls.join(', ');
      if (coverCount === 2) {
        blurEl.style.backgroundSize = '50% 100%, 50% 100%';
        blurEl.style.backgroundPosition = '0 0, 100% 0';
      } else if (coverCount === 3) {
        blurEl.style.backgroundSize = '50% 50%, 50% 50%, 100% 50%';
        blurEl.style.backgroundPosition = '0 0, 100% 0, 0 100%';
      } else {
        blurEl.style.backgroundSize = '50% 50%, 50% 50%, 50% 50%, 50% 50%';
        blurEl.style.backgroundPosition = '0 0, 100% 0, 0 100%, 100% 100%';
      }
      blurEl.style.backgroundRepeat = 'no-repeat';
      mainEl.style.background = '';
      mainEl.style.backgroundImage = 'url(' + window.coverUrl(coverTracks[0].id) + ')';
      mainEl.innerHTML = '';
      if (shapes.length >= 1 && coverTracks.length >= 2) {
        shapes[0].style.background = '';
        shapes[0].style.backgroundImage = 'url(' + window.coverUrl(coverTracks[1].id) + ')';
      } else if (shapes.length >= 1 && coverTracks.length === 1) {
        shapes[0].style.background = '';
        shapes[0].style.backgroundImage = 'url(' + window.coverUrl(coverTracks[0].id) + ')';
      }
      if (shapes.length >= 2 && coverTracks.length >= 3) {
        shapes[1].style.background = '';
        shapes[1].style.backgroundImage = 'url(' + window.coverUrl(coverTracks[2].id) + ')';
      } else if (shapes.length >= 2 && coverTracks.length >= 1) {
        shapes[1].style.background = '';
        shapes[1].style.backgroundImage = 'url(' + window.coverUrl(coverTracks[0].id) + ')';
      }
      if (shapes.length >= 3 && coverTracks.length >= 4) {
        shapes[2].style.background = '';
        shapes[2].style.backgroundImage = 'url(' + window.coverUrl(coverTracks[3].id) + ')';
      } else if (shapes.length >= 3 && coverTracks.length >= 1) {
        shapes[2].style.background = '';
        shapes[2].style.backgroundImage = 'url(' + window.coverUrl(coverTracks[0].id) + ')';
      }
    }

    // ── 按专辑分组 ──
    var albumMap = {};
    var albumOrder = [];
    for (var i = 0; i < tracks.length; i++) {
      var al = tracks[i].album || '未知专辑';
      if (!albumMap[al]) { albumMap[al] = []; albumOrder.push(al); }
      albumMap[al].push(tracks[i]);
    }

    _allArtistAlbums = albumOrder.map(function (alName) {
      var alTracks = albumMap[alName];
      var coverTrack = null;
      for (var j = 0; j < alTracks.length; j++) {
        if (alTracks[j].has_cover) { coverTrack = alTracks[j]; break; }
      }
      return {
        name: alName,
        tracks: alTracks,
        cover_track_id: coverTrack ? coverTrack.id : null,
        track_count: alTracks.length,
        year: alTracks[0] ? alTracks[0].year : null,
      };
    });

    // ── 渲染：每个专辑一行，左侧封面+信息，右侧曲目 ──
    _renderAlbumsWithTracks(container);

    // ── 播放全部 ──
    document.getElementById('btn-play-artist').addEventListener('click', function () {
      App.backend.play_from_list(JSON.stringify(tracks), 0);
    });
  }

  // 渲染：专辑与曲目交错排列（每行：左专辑 | 右该专辑曲目）
  function _renderAlbumsWithTracks(container) {
    var scrollEl = document.getElementById('artist-albums-scroll');
    if (!scrollEl) return;
    scrollEl.innerHTML = '';

    if (_allArtistAlbums.length === 0) {
      scrollEl.innerHTML =
        '<div class="artist-album-empty">暂无曲目</div>';
      return;
    }

    var frag = document.createDocumentFragment();

    _allArtistAlbums.forEach(function (album) {
      // ── 专辑行容器 ──
      var row = document.createElement('div');
      row.className = 'artist-album-row';

      // 左侧：封面 + 专辑名 + 年份
      var coverHtml = '';
      if (album.cover_track_id) {
        coverHtml = '<img src="' + window.coverUrl(album.cover_track_id) + '" alt="" loading="lazy">';
      } else {
        var bg = App.utils.hashColor(album.name);
        coverHtml = '<div class="artist-album-cover-placeholder" style="background:' + bg + '">' +
          '<span>' + App.utils.initial(album.name) + '</span></div>';
      }

      // 复用 .album-card 结构：封面 + 专辑名 + 年份（去掉歌手）
      var yearText = album.year ? album.year + ' · ' + album.track_count + ' 首' : album.track_count + ' 首';
      row.innerHTML =
        '<div class="artist-album-side">' +
          '<div class="album-card artist-album-card-flat">' +
            '<div class="album-cover">' + coverHtml + '</div>' +
            '<div class="album-info">' +
              '<p class="album-name">' + App.utils.esc(album.name) + '</p>' +
              '<p class="album-meta">' + yearText + '</p>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<ul class="track-list artist-album-track-list"></ul>';

      // 右侧：该专辑的曲目列表
      var trackList = row.querySelector('.artist-album-track-list');
      var trackFrag = document.createDocumentFragment();

      album.tracks.forEach(function (track, idx) {
        // 显示专辑内歌曲序号（track_number），无时 fallback 到连续序号
        var displayNum = track.track_number || (idx + 1);
        var li = App.utils.trackRow(track, displayNum, function (clickedTrack, clickIdx) {
          App.backend.play_from_list(JSON.stringify(album.tracks), clickIdx);
        }, false, idx);
        trackFrag.appendChild(li);
      });
      trackList.appendChild(trackFrag);

      frag.appendChild(row);
    });

    scrollEl.appendChild(frag);
  }

  page.updatePlayState = function () {
    const currentId = App.state.currentTrack ? App.state.currentTrack.id : null;
    // 每个专辑都有自己的 track-list，全部遍历
    const lists = document.querySelectorAll('.artist-album-track-list');
    lists.forEach(function (list) {
      Array.from(list.children).forEach(li => {
        if (li.dataset.trackId === currentId) {
          li.classList.add('playing');
        } else {
          li.classList.remove('playing');
        }
      });
    });
  };

})();
