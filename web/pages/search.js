(function () {
  'use strict';

  window.App = window.App || {};
  const page = {};
  window.App.pages = window.App.pages || {};
  window.App.pages.search = page;

  // 「全部」之外的四个分栏即结果页签；顺序即展示顺序。
  const SCOPES = [
    { id: 'all',       key: 'search.all' },
    { id: 'tracks',    key: 'search.music' },
    { id: 'albums',    key: 'search.albums' },
    { id: 'artists',   key: 'search.artists' },
    { id: 'playlists', key: 'search.playlists' },
  ];

  // 「全部」页里每个分栏只给预览条数，剩下的走「查看全部」。
  const PREVIEW = { tracks: 6, albums: 8, artists: 6, playlists: 6 };
  // 单栏全量结果的上限：静态行不虚拟化，上千行会明显卡顿。
  const TRACK_LIMIT = 300;

  let query = '';
  let scope = 'all';
  // 记住带 q 的参数对象本体：i18n 切换时 app.js 会把同一个 params 再传一次，
  // 靠引用相等即可区分「新的一次跳转」和「同一页的重渲染」，不会把用户
  // 后来输入的内容冲掉，也不会漏掉再次从主页带同一个词进来。
  let _lastParams = null;
  let _debounceTimer = null;

  function _esc(v) { return App.utils.esc(v == null ? '' : String(v)); }

  page.render = function (container, params) {
    if (params && typeof params.q === 'string' && params !== _lastParams) {
      _lastParams = params;
      query = params.q;
      scope = 'all';
      if (App.scrollMemory && App.scrollMemory.forget) App.scrollMemory.forget('search');
    }
    if (params && params.scope && SCOPES.some(function (s) { return s.id === params.scope; })) {
      scope = params.scope;
    }

    container.innerHTML = `
      <div class="search-page">
        <div class="page-sticky-header">
          <div class="page-header">
            <div class="page-header-left">
              <h1 class="page-title" data-i18n="search.title">搜索</h1>
              <p class="page-subtitle" id="search-subtitle"></p>
            </div>
          </div>
          <!-- 搜索框复用全局 .search-bar，只加一个 --hero 变体把高度抬到 52。 -->
          <div class="search-bar search-bar--hero">
            <span class="material-symbols-rounded">search</span>
            <input type="text" id="search-input" autocomplete="off" spellcheck="false"
                   enterkeyhint="search"
                   data-i18n-placeholder="search.placeholder"
                   placeholder="搜索音乐、专辑、艺术家或歌单…"
                   data-i18n-aria-label="common.search" aria-label="搜索">
            <button class="icon-btn search-clear" id="search-clear" type="button"
                    data-i18n-title="search.clear" data-i18n-aria-label="search.clear" title="清除">
              <span class="material-symbols-rounded">close</span>
            </button>
          </div>
          <div class="search-scope" id="search-scope" role="tablist">
            ${SCOPES.map(function (s) {
              const on = s.id === scope;
              return '<button class="chip search-scope-chip' + (on ? ' active' : '') + '"' +
                ' type="button" role="tab" data-scope="' + s.id + '"' +
                ' aria-selected="' + (on ? 'true' : 'false') + '">' +
                _esc(App.i18n.t(s.key)) + '</button>';
            }).join('')}
          </div>
        </div>
        <div class="search-body" id="search-body"></div>
      </div>
    `;

    const input = document.getElementById('search-input');
    const clearBtn = document.getElementById('search-clear');

    function syncClear() {
      if (clearBtn) clearBtn.style.display = input.value ? 'inline-flex' : 'none';
    }

    input.value = query;
    syncClear();

    input.addEventListener('input', function () {
      query = input.value;
      syncClear();
      if (_debounceTimer) clearTimeout(_debounceTimer);
      _debounceTimer = setTimeout(function () {
        _debounceTimer = null;
        _renderResults();
      }, 160);
    });

    input.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && input.value) {
        e.preventDefault();
        input.value = '';
        query = '';
        syncClear();
        _renderResults();
      } else if (e.key === 'Escape') {
        /* 输入已空再按 Esc = 退出搜索页。搜索不在侧边栏里，键盘也要能走出去。 */
        if (App.goBack) App.goBack();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (_debounceTimer) { clearTimeout(_debounceTimer); _debounceTimer = null; }
        _renderResults();
      }
    });

    if (clearBtn) {
      clearBtn.addEventListener('click', function () {
        input.value = '';
        query = '';
        syncClear();
        input.focus();
        _renderResults();
      });
    }

    document.getElementById('search-scope').addEventListener('click', function (e) {
      const btn = e.target.closest('.search-scope-chip');
      if (!btn) return;
      _setScope(btn.dataset.scope, false);
    });

    _renderResults();

    // 进来就能打字：搜索页不自动聚焦等于要用户多点一次。
    input.focus();
    try { input.setSelectionRange(input.value.length, input.value.length); } catch (err) {  }
  };

  page.updatePlayState = function () {
    const body = document.getElementById('search-body');
    if (!body) return;
    const id = App.state && App.state.currentTrack ? App.state.currentTrack.id : null;
    body.querySelectorAll('.track-row').forEach(function (row) {
      row.classList.toggle('playing', row.dataset.trackId === id);
    });
  };

  function _setScope(id, toTop) {
    if (!SCOPES.some(function (s) { return s.id === id; })) return;
    scope = id;
    const wrap = document.getElementById('search-scope');
    if (wrap) {
      wrap.querySelectorAll('.search-scope-chip').forEach(function (btn) {
        const on = btn.dataset.scope === id;
        btn.classList.toggle('active', on);
        btn.setAttribute('aria-selected', on ? 'true' : 'false');
      });
    }
    _renderResults();
    if (toTop) {
      const pane = document.getElementById('content-pane');
      if (pane) pane.scrollTop = 0;
    }
  }

  function _renderResults() {
    const body = document.getElementById('search-body');
    if (!body) return;

    const q = query.trim().toLowerCase();
    const res = _search(q);
    _updateSubtitle(res, q);

    if (!q) {
      body.innerHTML = '';
      body.appendChild(_hint());
      return;
    }
    if (!res.total) {
      body.innerHTML = '';
      body.appendChild(_noResults());
      return;
    }

    if (scope === 'all') {
      body.innerHTML = '';
      const plan = [
        { id: 'tracks',    titleKey: 'search.songs',     list: res.tracks },
        { id: 'albums',    titleKey: 'search.albums',    list: res.albums },
        { id: 'artists',   titleKey: 'search.artists',   list: res.artists },
        { id: 'playlists', titleKey: 'search.playlists', list: res.playlists },
      ];
      plan.forEach(function (p) {
        if (!p.list.length) return;
        const limit = PREVIEW[p.id];
        const content = _contentFor(p.id, p.list, limit);
        if (!content) return;
        body.appendChild(_section(p.titleKey, p.list.length > limit ? p.id : null, content));
      });
      return;
    }

    const list = res[scope] || [];
    if (!list.length) {
      body.innerHTML = '';
      body.appendChild(_noResults());
      return;
    }

    body.innerHTML = '';
    if (scope === 'tracks') {
      body.appendChild(_tracksScope(list));
      if (list.length > TRACK_LIMIT) {
        const note = document.createElement('p');
        note.className = 'search-note';
        note.textContent = App.i18n.t('search.truncated', { count: TRACK_LIMIT });
        body.appendChild(note);
      }
      return;
    }

    const content = _contentFor(scope, list, null);
    if (content) body.appendChild(content);
  }

  // 单栏「音乐」：给个区块头 + 全部播放，否则满屏只有行、没有可操作的入口。
  function _tracksScope(list) {
    const shown = list.slice(0, TRACK_LIMIT);
    const sec = document.createElement('section');
    sec.className = 'search-section';

    const head = document.createElement('div');
    head.className = 'section-heading';
    head.innerHTML = '<span class="section-title">' + _esc(App.i18n.t('search.songs')) + '</span>';

    const right = document.createElement('div');
    right.className = 'search-section-actions';

    const playAll = document.createElement('button');
    playAll.type = 'button';
    playAll.className = 'search-see-all';
    playAll.innerHTML = '<span class="material-symbols-rounded">play_arrow</span>' +
      '<span>' + _esc(App.i18n.t('music.playAll')) + '</span>';
    playAll.addEventListener('click', function () {
      if (shown.length && App.backend && App.backend.play_from_list) {
        App.backend.play_from_list(JSON.stringify(shown), 0);
      }
    });
    right.appendChild(playAll);

    head.appendChild(right);
    sec.appendChild(head);
    sec.appendChild(_trackList(shown));
    return sec;
  }

  function _contentFor(id, list, limit) {
    switch (id) {
      case 'tracks':    return _trackList(list, limit);
      case 'albums':    return _albumGrid(list, limit);
      case 'artists':   return _artistList(list, limit);
      case 'playlists': return _playlistGrid(list, limit);
    }
    return null;
  }

  function _updateSubtitle(res, q) {
    const el = document.getElementById('search-subtitle');
    if (!el) return;
    if (!q) { el.textContent = ''; return; }
    const n = scope === 'all' ? res.total : (res[scope] || []).length;
    // 0 结果时由空状态就地说清楚，副标题再报一次「0」是冗余。
    el.textContent = n ? App.i18n.t('search.count', { count: n }) : '';
  }

  /* ---------------- 检索 ---------------- */

  function _search(q) {
    const out = { tracks: [], albums: [], artists: [], playlists: [], total: 0 };
    if (!q) return out;

    const allTracks = (App.state && App.state.allTracks) || [];
    const allAlbums = (App.state && App.state.allAlbums) || [];
    const allArtists = (App.state && App.state.allArtists) || [];
    const allPlaylists = (App.state && App.state.allPlaylists) || [];

    out.tracks = _prefixFirst(
      allTracks.filter(function (t) { return App.utils.matchTrack(q, t); }),
      function (t) { return t.title || ''; }, q
    );

    out.albums = _prefixFirst(
      allAlbums.filter(function (a) {
        return App.utils.matchItem(q, a, [
          { text: 'album', key: 'sort_key' },
          { text: 'album_artist', key: 'album_artist_sort_key' },
        ]);
      }),
      function (a) { return a.album || ''; }, q
    );

    out.artists = _prefixFirst(
      allArtists.filter(function (a) {
        return App.utils.matchItem(q, a, [{ text: 'name', key: 'sort_key' }]);
      }),
      function (a) { return a.name || ''; }, q
    );

    out.playlists = _prefixFirst(
      allPlaylists.filter(function (p) {
        return App.utils.matchItem(q, p, [{ text: 'name' }]);
      }),
      function (p) { return p.name || ''; }, q
    );

    out.total = out.tracks.length + out.albums.length + out.artists.length + out.playlists.length;
    return out;
  }

  // 前缀命中的排在前面，其余按名称排 —— 搜「abi」时 Abbey 不该排在 Zabi 后面。
  function _prefixFirst(list, textOf, q) {
    return list.slice().sort(function (a, b) {
      const at = String(textOf(a) || '').toLowerCase();
      const bt = String(textOf(b) || '').toLowerCase();
      const ap = at.indexOf(q) === 0 ? 0 : 1;
      const bp = bt.indexOf(q) === 0 ? 0 : 1;
      if (ap !== bp) return ap - bp;
      return at.localeCompare(bt);
    });
  }

  /* ---------------- 组件 ---------------- */

  function _section(titleKey, moreScope, content) {
    const sec = document.createElement('section');
    sec.className = 'search-section';

    const head = document.createElement('div');
    head.className = 'section-heading';
    head.innerHTML = '<span class="section-title">' + _esc(App.i18n.t(titleKey)) + '</span>';

    const right = document.createElement('div');
    right.className = 'search-section-actions';

    if (moreScope) {
      const more = document.createElement('button');
      more.type = 'button';
      more.className = 'search-see-all';
      more.innerHTML = '<span>' + _esc(App.i18n.t('search.seeAll')) + '</span>' +
        '<span class="material-symbols-rounded">chevron_right</span>';
      more.addEventListener('click', function () { _setScope(moreScope, true); });
      right.appendChild(more);
    }

    head.appendChild(right);
    sec.appendChild(head);
    sec.appendChild(content);
    return sec;
  }

  function _trackList(list, limit) {
    const ul = document.createElement('ul');
    ul.className = 'track-list search-track-list';
    const shown = limit ? list.slice(0, limit) : list;

    shown.forEach(function (track, i) {
      const li = App.utils.trackRow(track, i + 1, function () {
        if (App.backend && App.backend.play_from_list) {
          App.backend.play_from_list(JSON.stringify(shown), i);
        }
      }, true, i);
      ul.appendChild(li);
    });
    return ul;
  }

  function _albumGrid(list, limit) {
    const grid = document.createElement('div');
    grid.className = 'album-grid search-album-grid';
    const shown = limit ? list.slice(0, limit) : list;

    shown.forEach(function (album) {
      const card = document.createElement('div');
      card.className = 'album-card';

      let cover;
      if (album.cover_track_id && window.coverUrl) {
        cover = '<img src="' + window.coverUrl(album.cover_track_id, 512) + '" alt="" loading="lazy">';
      } else {
        cover = '<div class="search-cover-fallback" style="background:' +
          App.utils.hashColor(album.album || '') + '">' +
          '<span class="album-cover-letter">' + App.utils.initial(album.album || '') + '</span></div>';
      }

      const artist = album.album_artist || album.artist || '';
      card.innerHTML =
        '<div class="album-cover">' + cover + '</div>' +
        '<div class="album-info">' +
          '<p class="album-name">' + _esc(album.album) + '</p>' +
          '<p class="album-meta">' + _esc(artist) +
            (album.year ? ' · ' + _esc(album.year) : '') + '</p>' +
        '</div>';

      card.addEventListener('click', function () {
        App.navigate('albums', { album: album.album, album_artist: artist });
      });
      grid.appendChild(card);
    });
    return grid;
  }

  function _artistList(list, limit) {
    const wrap = document.createElement('div');
    wrap.className = 'search-artist-list';
    const shown = limit ? list.slice(0, limit) : list;

    shown.forEach(function (artist) {
      const name = artist.name || '';
      const row = document.createElement('div');
      row.className = 'artist-row';
      row.innerHTML =
        '<div class="artist-avatar" style="background:' + App.utils.hashColor(name) + '">' +
          '<span class="search-avatar-initial">' + App.utils.initial(name) + '</span>' +
        '</div>' +
        '<div class="artist-info">' +
          '<p class="artist-name">' + _esc(name) + '</p>' +
          '<p class="artist-meta">' +
            _esc(App.i18n.t('artists.albumCount', { count: artist.album_count || 0 })) + ' · ' +
            _esc(App.i18n.t('music.trackCount', { count: artist.track_count || 0 })) +
          '</p>' +
        '</div>' +
        '<span class="material-symbols-rounded artist-chevron">chevron_right</span>';

      // 头像走和艺术家页同一个接口；没有图就让首字母底色顶着，不占位不留白。
      if (window.artistImageUrl) {
        const src = window.artistImageUrl(name, '');
        if (src) {
          const img = document.createElement('img');
          img.alt = '';
          img.loading = 'lazy';
          img.addEventListener('error', function () { img.remove(); });
          img.src = src;
          const av = row.querySelector('.artist-avatar');
          if (av) av.appendChild(img);
        }
      }

      row.addEventListener('click', function () { App.navigate('artists', { artist: name }); });
      wrap.appendChild(row);
    });
    return wrap;
  }

  function _playlistGrid(list, limit) {
    const grid = document.createElement('div');
    grid.className = 'album-grid search-album-grid';
    const shown = limit ? list.slice(0, limit) : list;

    shown.forEach(function (pl) {
      const isRemote = pl.source === 'subsonic';
      const card = document.createElement('div');
      card.className = 'album-card';

      let cover;
      if (isRemote && pl.cover_art_id && pl.server_id && window.__coverBase) {
        cover = '<img src="' + window.__coverBase + '/subsonic/cover/' + pl.server_id + '/' +
          encodeURIComponent(pl.cover_art_id) + '?size=512" alt="" loading="lazy">';
      } else {
        cover = '<div class="search-cover-fallback" style="background:' +
          App.utils.hashColor(pl.name || '') + '">' +
          '<span class="material-symbols-rounded">queue_music</span></div>';
      }

      const source = isRemote ? (pl.server_name || App.i18n.t('playlist.remote')) : '';

      card.innerHTML =
        '<div class="album-cover">' + cover + '</div>' +
        '<div class="album-info">' +
          '<p class="album-name">' + _esc(pl.name) + '</p>' +
          '<p class="album-meta">' + _esc(App.i18n.t('music.trackCount', { count: pl.track_count || 0 })) +
            (source ? ' · ' + _esc(source) : '') + '</p>' +
        '</div>';

      card.addEventListener('click', function () {
        App.navigate('playlists', {
          playlist_id: pl.id,
          playlist_name: pl.name,
          source: pl.source,
          server_id: pl.server_id,
          remote_id: pl.remote_id,
          server_name: pl.server_name,
          cover_art_id: pl.cover_art_id,
          owner: pl.owner,
          owner_email: pl.owner_email,
        });
      });
      grid.appendChild(card);
    });
    return grid;
  }

  function _hint() {
    const el = document.createElement('div');
    el.className = 'empty-state search-empty';
    el.innerHTML =
      '<span class="material-symbols-rounded empty-icon">search</span>' +
      '<h2 class="empty-title">' + _esc(App.i18n.t('search.emptyTitle')) + '</h2>' +
      '<p class="empty-sub">' + _esc(App.i18n.t('search.emptyHint')) + '</p>';
    return el;
  }

  function _noResults() {
    const el = document.createElement('div');
    el.className = 'empty-state search-empty';
    el.innerHTML =
      '<span class="material-symbols-rounded empty-icon">search_off</span>' +
      '<h2 class="empty-title">' + _esc(App.i18n.t('search.noResults', { query: query.trim() })) + '</h2>' +
      '<p class="empty-sub">' + _esc(App.i18n.t('search.emptyHint')) + '</p>';
    return el;
  }
})();
