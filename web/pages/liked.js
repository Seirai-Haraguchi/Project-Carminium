(function () {
  'use strict';

  window.App = window.App || {};
  const page = {};
  window.App.pages.liked = page;

  // 喜爱分三类：曲目 / 专辑 / 艺人。曲目走后端全量拉取，专辑与艺人直接用
  // App.state（启动时加载 + liked_*_changed 事件刷新），切换 tab 无需再请求。
  const TABS = [
    { key: 'tracks', labelKey: 'liked.tabTracks', searchKey: 'liked.searchPlaceholder' },
    { key: 'albums', labelKey: 'liked.tabAlbums', searchKey: 'liked.searchAlbums' },
    { key: 'artists', labelKey: 'liked.tabArtists', searchKey: 'liked.searchArtists' },
  ];

  let allLiked = [];
  let filterStr = '';
  let searchText = '';
  let activeTab = 'tracks';

  page.render = function (container) {
    container.innerHTML = `
      <div class="page-sticky-header">
        <div class="page-header">
          <div class="page-header-left">
            <h1 class="page-title" data-i18n="liked.title">喜爱的音乐</h1>
            <p class="page-subtitle" id="liked-count" data-i18n="common.loading">加载中…</p>
          </div>
          <div class="page-actions">
            <button class="btn-filled" id="btn-play-liked">
              <span class="material-symbols-rounded">play_arrow</span><span data-i18n="music.playAll">全部播放</span>
            </button>
          </div>
        </div>
        <div class="np-pivot liked-pivot" role="tablist" id="liked-pivot">
          ${TABS.map(function (t) {
            return `<button class="np-pivot-tab${t.key === activeTab ? ' active' : ''}" role="tab"
              aria-selected="${t.key === activeTab}" data-tab="${t.key}" data-i18n="${t.labelKey}">${App.i18n.t(t.labelKey)}</button>`;
          }).join('')}
        </div>
        <div class="search-bar">
          <span class="material-symbols-rounded">search</span>
          <input type="text" id="liked-search" data-i18n-placeholder="${_tabMeta().searchKey}"
            placeholder="${App.i18n.t(_tabMeta().searchKey)}" data-i18n-aria-label="common.search" aria-label="搜索喜爱">
        </div>
      </div>
      <ul class="track-list az-list liked-panel" id="liked-list" data-panel="tracks"></ul>
      <div class="album-grid liked-panel" id="liked-album-grid" data-panel="albums" hidden></div>
      <div class="artist-list liked-panel" id="liked-artist-list" data-panel="artists" hidden></div>
    `;

    const searchInput = document.getElementById('liked-search');
    searchInput.value = searchText;
    var _searchDebounceTimer = null;
    searchInput.addEventListener('input', function (e) {
      searchText = e.target.value;
      filterStr = searchText.trim().toLowerCase();
      if (_searchDebounceTimer) clearTimeout(_searchDebounceTimer);
      _searchDebounceTimer = setTimeout(function () {
        _searchDebounceTimer = null;
        _renderActive();
      }, 180);
    });

    document.getElementById('liked-pivot').addEventListener('click', function (e) {
      const btn = e.target.closest('.np-pivot-tab');
      if (!btn || btn.dataset.tab === activeTab) return;
      activeTab = btn.dataset.tab;
      _syncPivot();
      _renderActive();
    });

    document.getElementById('btn-play-liked').addEventListener('click', function () {
      const list = _queueForActiveTab();
      if (list.length > 0) App.backend.play_from_list(JSON.stringify(list), 0);
    });

    _syncPivot();
    _renderActive();
    _loadLiked();
  };

  function _tabMeta() {
    return TABS.find(function (t) { return t.key === activeTab; }) || TABS[0];
  }

  function _syncPivot() {
    const pivot = document.getElementById('liked-pivot');
    if (pivot) {
      Array.prototype.forEach.call(pivot.querySelectorAll('.np-pivot-tab'), function (btn) {
        const on = btn.dataset.tab === activeTab;
        btn.classList.toggle('active', on);
        btn.setAttribute('aria-selected', String(on));
      });
    }
    const input = document.getElementById('liked-search');
    if (input) {
      const key = _tabMeta().searchKey;
      input.setAttribute('placeholder', App.i18n.t(key));
      input.setAttribute('data-i18n-placeholder', key);
    }
  }

  function _loadLiked() {
    App.utils.call('get_liked_tracks').then(function (res) {
      allLiked = JSON.parse(res);
      if (activeTab === 'tracks') _renderActive();
      else _renderCount();
    }).catch(function () {  });
  }

  // ── 三类数据的取用 ───────────────────────────────────────────
  function _likedAlbums() {
    return (App.state && App.state.likedAlbums) || [];
  }

  function _likedArtists() {
    return (App.state && App.state.likedArtists) || [];
  }

  function _albumKey(album, albumArtist) {
    return String(album || '') + '\u0000' + String(albumArtist || '');
  }

  function _tracksForAlbums(albums) {
    const all = (App.state && App.state.allTracks) || [];
    const keys = new Set(albums.map(function (a) {
      return _albumKey(a.album, a.album_artist);
    }));
    return all.filter(function (t) {
      return keys.has(_albumKey(t.album, t.album_artist || t.artist));
    });
  }

  function _tracksForArtists(artists) {
    const all = (App.state && App.state.allTracks) || [];
    const names = new Set(artists.map(function (a) { return a.name; }));
    return all.filter(function (t) {
      const list = (t.artists && t.artists.length) ? t.artists : [t.artist || ''];
      return list.some(function (n) { return names.has(n); });
    });
  }

  function _queueForActiveTab() {
    if (activeTab === 'albums') return _tracksForAlbums(_likedAlbums());
    if (activeTab === 'artists') return _tracksForArtists(_likedArtists());
    return filterStr ? allLiked.filter(function (t) { return App.utils.matchTrack(filterStr, t); }) : allLiked;
  }

  // ── 渲染 ─────────────────────────────────────────────────────
  function _renderActive() {
    const panels = document.querySelectorAll('.liked-panel');
    Array.prototype.forEach.call(panels, function (p) {
      p.hidden = p.dataset.panel !== activeTab;
    });
    if (activeTab === 'albums') _renderAlbums();
    else if (activeTab === 'artists') _renderArtists();
    else _renderTracks();
  }

  function _renderCount() {
    const el = document.getElementById('liked-count');
    if (!el) return;
    const filtered = !!filterStr;
    let total = 0;
    let key = 'music.trackCount';
    if (activeTab === 'albums') { total = _likedAlbums().length; key = 'albums.count'; }
    else if (activeTab === 'artists') { total = _likedArtists().length; key = 'artists.count'; }
    else total = allLiked.length;

    if (total === 0) {
      el.textContent = filtered ? App.i18n.t('common.noResults') : App.i18n.t(_emptyKey());
    } else {
      el.textContent = App.i18n.t(key, { count: total });
    }
  }

  function _emptyKey() {
    if (activeTab === 'albums') return 'liked.emptyAlbums';
    if (activeTab === 'artists') return 'liked.emptyArtists';
    return 'liked.empty';
  }

  function _renderEmpty(host, icon) {
    host.innerHTML = `
      <div class="empty-state">
        <span class="material-symbols-rounded empty-icon">${icon}</span>
        <h2 class="empty-title">${filterStr ? App.i18n.t('common.noResults') : App.i18n.t(_emptyKey())}</h2>
      </div>
    `;
  }

  function _renderTracks() {
    const ul = document.getElementById('liked-list');
    if (!ul) return;
    ul.innerHTML = '';

    const list = filterStr ? allLiked.filter(function (t) { return App.utils.matchTrack(filterStr, t); }) : allLiked;
    _renderCount();

    if (list.length === 0) {
      _renderEmpty(ul, 'favorite_border');
      return;
    }

    const frag = document.createDocumentFragment();
    list.forEach(function (track, i) {
      const li = App.utils.trackRow(track, i + 1, function (clickedTrack) {
        App.backend.play_from_list(JSON.stringify(list), list.indexOf(clickedTrack));
      }, true);
      frag.appendChild(li);
    });
    ul.appendChild(frag);
  }

  function _renderAlbums() {
    const grid = document.getElementById('liked-album-grid');
    if (!grid) return;
    grid.innerHTML = '';

    let list = _likedAlbums();
    if (filterStr) {
      list = list.filter(function (a) {
        return App.utils.matchItem(filterStr, a, [
          { text: 'album', key: 'sort_key' },
          { text: 'album_artist', key: 'album_artist_sort_key' },
        ]);
      });
    }
    _renderCount();

    if (list.length === 0) {
      _renderEmpty(grid, 'album');
      return;
    }

    const frag = document.createDocumentFragment();
    list.forEach(function (album) {
      const card = document.createElement('div');
      card.className = 'album-card';

      let coverHtml;
      if (album.cover_track_id) {
        coverHtml = `<img src="${window.coverUrl(album.cover_track_id, 512)}" alt="" loading="lazy">`;
      } else {
        const bg = App.utils.hashColor(album.album);
        coverHtml = `
          <div style="width:100%; height:100%; background:${bg}; display:flex; align-items:center; justify-content:center;">
            <span class="album-cover-letter">${App.utils.initial(album.album)}</span>
          </div>
        `;
      }

      card.innerHTML = `
        <div class="album-cover">
          ${coverHtml}
          <button class="liked-remove-btn" title="${App.i18n.t('liked.unlikeAlbum')}" aria-label="${App.i18n.t('liked.unlikeAlbum')}">
            <span class="material-symbols-rounded">favorite</span>
          </button>
        </div>
        <div class="album-info">
          <p class="album-name">${App.utils.esc(album.album)}</p>
          <p class="album-meta">${App.utils.esc(album.album_artist)} · ${album.year || '?'} · ${App.i18n.t('albums.trackCountShort', { count: album.track_count })}</p>
        </div>
      `;

      card.addEventListener('click', function () {
        App.navigate('albums', { album: album.album, album_artist: album.album_artist });
      });
      card.querySelector('.liked-remove-btn').addEventListener('click', function (e) {
        e.stopPropagation();
        App.backend.toggle_liked_album(album.album, album.album_artist);
      });
      frag.appendChild(card);
    });
    grid.appendChild(frag);
  }

  function _renderArtists() {
    const host = document.getElementById('liked-artist-list');
    if (!host) return;
    host.innerHTML = '';

    let list = _likedArtists();
    if (filterStr) {
      list = list.filter(function (a) {
        return App.utils.matchItem(filterStr, a, [{ text: 'name', key: 'sort_key' }]);
      });
    }
    _renderCount();

    if (list.length === 0) {
      _renderEmpty(host, 'person');
      return;
    }

    const frag = document.createDocumentFragment();
    list.forEach(function (artist) {
      const row = document.createElement('div');
      row.className = 'artist-row';
      const name = artist.name || '';
      const bg = App.utils.hashColor(name);
      row.innerHTML = `
        <div class="artist-avatar" style="background:${bg};color:#fff;">
          <span style="font-size:20px;font-weight:700;color:#fff;">${App.utils.initial(name)}</span>
        </div>
        <div class="artist-info">
          <p class="artist-name">${App.utils.esc(name)}</p>
          <p class="artist-meta">${App.i18n.t('artists.albumCount', { count: artist.album_count })} · ${App.i18n.t('music.trackCount', { count: artist.track_count })}</p>
        </div>
        <button class="liked-remove-btn" title="${App.i18n.t('liked.unlikeArtist')}" aria-label="${App.i18n.t('liked.unlikeArtist')}">
          <span class="material-symbols-rounded">favorite</span>
        </button>
        <span class="material-symbols-rounded artist-chevron">chevron_right</span>
      `;

      const avEl = row.querySelector('.artist-avatar');
      const url = window.artistImageUrl ? window.artistImageUrl(name, artist.override_at || '') : null;
      if (url && avEl) {
        const probe = new Image();
        probe.onload = function () {
          avEl.style.background = '';
          avEl.style.backgroundImage = 'url(' + url + ')';
          avEl.style.backgroundSize = 'cover';
          avEl.style.backgroundPosition = 'center';
          avEl.innerHTML = '';
        };
        probe.src = url;
      }

      row.addEventListener('click', function () {
        App.navigate('artists', { artist: name });
      });
      row.querySelector('.liked-remove-btn').addEventListener('click', function (e) {
        e.stopPropagation();
        App.backend.toggle_liked_artist(name);
      });
      frag.appendChild(row);
    });
    host.appendChild(frag);
  }

  // ── 播放态与事件 ─────────────────────────────────────────────
  page.updatePlayState = function () {
    const list = document.getElementById('liked-list');
    if (!list) return;
    const currentId = App.state.currentTrack ? App.state.currentTrack.id : null;
    Array.from(list.children).forEach(function (li) {
      if (li.dataset.trackId === currentId) li.classList.add('playing');
      else li.classList.remove('playing');
    });
  };

  page.onLikedTracksChanged = function (jsonStr) {
    try {
      allLiked = JSON.parse(jsonStr);
    } catch (e) {
      return;
    }
    if (document.getElementById('liked-list') && activeTab === 'tracks') _renderActive();
  };

  page.onLikedArtistsChanged = function () {
    if (!document.getElementById('liked-artist-list')) return;
    if (activeTab === 'artists') _renderActive();
    else _renderCount();
  };

  page.onLikedAlbumsChanged = function () {
    if (!document.getElementById('liked-album-grid')) return;
    if (activeTab === 'albums') _renderActive();
    else _renderCount();
  };

})();
