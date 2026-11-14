(function () {
  'use strict';

  window.App = window.App || {};
  const page = {};
  window.App.pages.albums = page;

  let allAlbums = [];
  let filterStr = '';
  let searchText = '';
  let sortMode = 'az';

  let _vl = null;
  let _albumCoverObserver = null;

  // Album cards can be numerous. Keep cover URLs out of <img src> until the
  // card is close to the viewport, and release the decoded image when it is
  // far away again. This avoids decoding hundreds of full-size covers while
  // keeping scrolling smooth and letting the browser HTTP cache serve them
  // immediately when they come back into view.
  function _resetAlbumCoverObserver() {
    if (_albumCoverObserver) {
      _albumCoverObserver.disconnect();
      _albumCoverObserver = null;
    }
  }

  function _observeAlbumCovers(grid) {
    _resetAlbumCoverObserver();
    const images = grid.querySelectorAll('img[data-cover-src]');
    if (!images.length) return;

    function load(img) {
      if (img.hasAttribute('src') || !img.dataset.coverSrc) return;
      img.src = img.dataset.coverSrc;
    }

    if (typeof IntersectionObserver === 'undefined') {
      images.forEach(load);
      return;
    }

    const scrollRoot = document.getElementById('content-pane');
    _albumCoverObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        const img = entry.target;
        if (entry.isIntersecting) {
          load(img);
        } else if (img.hasAttribute('src')) {
          // Removing src releases the decoded bitmap. The HTTP cache means
          // revisiting the card does not normally download the cover again.
          img.removeAttribute('src');
        }
      });
    }, { root: scrollRoot || null, rootMargin: '600px 0px' });

    images.forEach(function (img) { _albumCoverObserver.observe(img); });
  }

  // 详情页的心形按钮：事件回来时按 App.state 重绘，避免乐观更新与实际状态分叉。
  let _likeBtnEl = null;
  let _currentAlbum = null;

  function _paintAlbumLikeBtn(btn, liked) {
    if (!btn) return;
    btn.classList.toggle('liked', !!liked);
    btn.setAttribute('aria-pressed', String(!!liked));
    var label = App.i18n.t(liked ? 'liked.unlikeAlbum' : 'liked.likeAlbum');
    btn.title = label;
    btn.setAttribute('aria-label', label);
    var icon = btn.querySelector('.material-symbols-rounded');
    if (icon) icon.textContent = liked ? 'favorite' : 'favorite_border';
  }

  page.onLikedAlbumsChanged = function () {
    if (_likeBtnEl && _currentAlbum) {
      _paintAlbumLikeBtn(_likeBtnEl, !!_likedKeyOf(_currentAlbum));
    }
  };

  /**
   * 智能分组后一张专辑可能由多个 (album, album_artist) 自然键拼成，
   * 播放/喜爱/曲目筛选都必须按「全部 keys」判定，不能只看主键。
   */
  function _albumKeys(album) {
    return (album && album.album_keys && album.album_keys.length)
      ? album.album_keys
      : [{ album: album ? album.album : '', album_artist: album ? album.album_artist : '' }];
  }

  function _albumKeyId(album, albumArtist) {
    return String(album || '') + '\u0000' + String(albumArtist || '');
  }

  function _albumMatches(album, target) {
    if (!album || !target) return false;
    if (album.album !== target.album) return false;
    if (album.album_artist === target.album_artist) return true;
    return _albumKeys(album).some(function (k) {
      return k.album === target.album && k.album_artist === target.album_artist;
    });
  }

  /** 合并专辑里任意一个自然键被喜爱，整张就算已喜爱。 */
  function _likedKeyOf(album) {
    var keys = _albumKeys(album);
    for (var i = 0; i < keys.length; i++) {
      if (App.isAlbumLiked(keys[i].album, keys[i].album_artist)) return keys[i];
    }
    return null;
  }

  /** 卡片/详情里那一行艺人：多艺人时主艺人 + 「等 N 位」。 */
  function _artistLabel(album) {
    var names = (album.album_artists && album.album_artists.length)
      ? album.album_artists
      : [album.album_artist];
    var primary = album.album_artist || names[0];
    if (names.length > 1) {
      return App.i18n.t('albums.multiArtist', { artist: primary, count: names.length, more: names.length - 1 });
    }
    return primary;
  }

  const SORT_OPTIONS = [
    { key: 'az', label: 'A-Z', icon: 'sort_by_alpha' },
    { key: 'za', label: 'Z-A', icon: 'sort_by_alpha' },
    { key: 'artist', labelKey: 'music.sortArtist', icon: 'person' },
    { key: 'year', labelKey: 'music.sortYear', icon: 'calendar_today' },
  ];

  page.render = function (container, params) {
    _resetAlbumCoverObserver();
    _likeBtnEl = null;
    _currentAlbum = null;
    container.innerHTML = `
      <div class="page-top">
        <div class="page-header">
          <div class="page-header-left">
            <h1 class="page-title" data-i18n="albums.title">专辑</h1>
            <p class="page-subtitle" id="album-count" data-i18n="common.loading">加载中…</p>
          </div>
          <div class="md-select" id="sort-select">
            <div class="md-select-trigger" tabindex="0" role="button" aria-haspopup="listbox" aria-expanded="false">
              <span class="material-symbols-rounded md-select-icon">${SORT_OPTIONS.find(o => o.key === sortMode).icon}</span>
              <span class="md-select-label">${App.i18n.t(SORT_OPTIONS.find(o => o.key === sortMode).labelKey || '') || SORT_OPTIONS.find(o => o.key === sortMode).label}</span>
              <span class="material-symbols-rounded md-select-arrow">arrow_drop_down</span>
            </div>
            <div class="md-select-menu mdx md-seglist" role="listbox">
              ${SORT_OPTIONS.map(opt => `
                <div class="md-select-option ${opt.key === sortMode ? 'selected' : ''}" role="option" data-value="${opt.key}" aria-selected="${opt.key === sortMode}">
                  <span class="material-symbols-rounded md-select-option-icon">${opt.icon}</span>
                  <span class="md-select-option-text">${opt.labelKey ? App.i18n.t(opt.labelKey) : opt.label}</span>
                  ${opt.key === sortMode ? '<span class="material-symbols-rounded md-select-check">check</span>' : ''}
                </div>
              `).join('')}
            </div>
          </div>
        </div>
        <div class="search-bar">
          <span class="material-symbols-rounded">search</span>
          <input type="text" id="album-search" data-i18n-placeholder="albums.searchPlaceholder" placeholder="搜索专辑或艺术家…" data-i18n-aria-label="common.search" aria-label="搜索专辑">
        </div>
      </div>
      <div class="album-grid az-grid" id="album-grid"></div>
    `;

    const searchInput = document.getElementById('album-search');
    searchInput.value = searchText;

    var _searchDebounceTimer = null;
    searchInput.addEventListener('input', function (e) {
      searchText = e.target.value;
      filterStr = searchText.trim().toLowerCase();
      if (_searchDebounceTimer) clearTimeout(_searchDebounceTimer);
      _searchDebounceTimer = setTimeout(function () {
        _searchDebounceTimer = null;
        _renderGrid(container);
      }, 180);
    });

    _setupSortDropdown(container);

    allAlbums = (App.state && App.state.allAlbums) ? App.state.allAlbums : [];
    if (params && params.album && params.album_artist) {
      const target = allAlbums.find(function (a) {
        return _albumMatches(a, params);
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

          const opt = SORT_OPTIONS.find(o => o.key === sortMode);
          if (opt) {
            select.querySelector('.md-select-icon').textContent = opt.icon;
            select.querySelector('.md-select-label').textContent = opt.labelKey ? App.i18n.t(opt.labelKey) : opt.label;
          }

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

          const ka = App.utils.itemSortKey(a, 'sort_key', 'album');
          const kb = App.utils.itemSortKey(b, 'sort_key', 'album');
          return ka.localeCompare(kb);
        });
        break;
      case 'year':
        sorted.sort((a, b) => {
          const ya = a.year || 0;
          const yb = b.year || 0;
          if (ya !== yb) return yb - ya;

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
        return album.album_artist || album.artist || App.i18n.t('common.unknownArtist');
      case 'year':
        return album.year ? String(album.year) : App.i18n.t('music.unknownYear');
      case 'za':

        return App.utils.itemSortLetter(album, 'sort_key', 'album');
      case 'az':
      default:
        return App.utils.itemSortLetter(album, 'sort_key', 'album');
    }
  }

  function _groupAlbums(list) {

    if (sortMode === 'az' || sortMode === 'za') {
      return App.utils.groupByLetter(list, a => a.album || '');
    }

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

  function _openLetterIndex() {
    const grid = document.getElementById('album-grid');
    const az = window.App && App.azIndex;
    if (!grid || !az) return;
    const heads = grid.querySelectorAll('.az-grid-header');
    const letters = [];
    heads.forEach(function (h) { if (h.dataset.letter != null) letters.push(h.dataset.letter); });
    if (!az.isAlphabetical(letters)) return;
    az.open({
      host: grid,
      letters: letters,
      onPick: function (letter) {
        const target = Array.prototype.find.call(
          grid.querySelectorAll('.az-grid-header'),
          function (h) { return h.dataset.letter === letter; }
        );
        if (target) az.scrollTo(az.offsetOf(target));
      },
    });
  }

  function _renderGrid(container) {
    const grid = document.getElementById('album-grid');
    if (!grid) return;

    // Detach the previous observer before replacing the grid contents. This
    // also prevents it from retaining detached image elements after search or
    // sorting changes.
    _resetAlbumCoverObserver();
    if (window.App.azIndex) App.azIndex.reset();

    if (_vl) { _vl.destroy(); _vl = null; }

    let list = filterStr ? allAlbums.filter(a => App.utils.matchItem(filterStr, a, [
      { text: 'album', key: 'sort_key' },
      { text: 'album_artist', key: 'album_artist_sort_key' },
      { text: 'album_artists_text' },
    ])) : allAlbums;

    list = _sortAlbums(list);

    const countEl = document.getElementById('album-count');
    if (countEl) {
      countEl.textContent = filterStr ? App.i18n.t('albums.filteredCount', { shown: list.length, total: allAlbums.length }) : App.i18n.t('albums.count', { count: allAlbums.length });
    }

    if (list.length === 0) {
      grid.style.display = 'block';
      grid.innerHTML = `
        <div class="empty-state">
          <span class="material-symbols-rounded empty-icon">album</span>
          <h2 class="empty-title" data-i18n="common.noResults">无结果</h2>
        </div>
      `;
      return;
    }

    grid.style.display = 'grid';
    grid.classList.add('album-grid');
    grid.innerHTML = '';
    const frag = document.createDocumentFragment();

    const groups = filterStr ? [{ letter: '', items: list }] : _groupAlbums(list);

    const canIndex = !filterStr && window.App.azIndex &&
      App.azIndex.isAlphabetical(groups.map(g => g.letter));

    groups.forEach(group => {
      if (!filterStr) {
        const header = document.createElement('div');
        header.className = 'az-grid-header';
        header.dataset.letter = group.letter;
        header.innerHTML = `<span class="az-section-letter">${group.letter}</span>`;
        if (canIndex) {
          header.classList.add('az-header-action');
          header.addEventListener('click', _openLetterIndex);
        }
        frag.appendChild(header);
      }
      group.items.forEach(album => {
        const card = document.createElement('div');
        card.className = 'album-card';

        let coverHtml = '';
        if (album.cover_track_id) {
          // 256px is sufficient for the responsive card (minimum column is
          // 156px) and uses a quarter of the decoded bitmap memory of 512px.
          coverHtml = `<img data-cover-src="${window.coverUrl(album.cover_track_id, 256)}" alt="" width="256" height="256" loading="lazy" decoding="async" fetchpriority="low">`;
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
            <p class="album-meta">${App.utils.esc(_artistLabel(album))} · ${album.year || '?'} · ${App.i18n.t('albums.trackCountShort', { count: album.track_count })}</p>
          </div>
        `;

        card._albumData = album;
        card.addEventListener('click', () => _renderDetail(container, album));
        frag.appendChild(card);
      });
    });
    grid.appendChild(frag);
    _observeAlbumCovers(grid);
  }

  function _renderDetail(container, album) {

    _resetAlbumCoverObserver();

    App.scrollMemory.save('albums');

    // 标题下面那一行＝艺人（着色）。库里确实有这个艺人时才做成可点的，
    // 否则退化成纯文本——点了跳去艺术家页却是「列表」，比不能点更糟。
    // 智能分组把多张同名片拼成一张时，主艺人后面跟一句「等 N 位」。
    const albumArtist = album.album_artist || '';
    const artistKnown = !!albumArtist &&
      (App.state.allArtists || []).some(function (a) { return a.name === albumArtist; });
    const artistCount = (album.album_artists && album.album_artists.length) || 1;
    const moreHtml = artistCount > 1
      ? '<span class="detail-byline-more">' + App.i18n.t('albums.andMoreArtists', { count: artistCount, more: artistCount - 1 }) + '</span>'
      : '';
    const artistHtml = !albumArtist ? '' :
      (artistKnown
        ? '<button type="button" class="detail-byline-btn" id="detail-artist-link">' + App.utils.esc(albumArtist) + '</button>' + moreHtml
        : '<span class="detail-byline-text">' + App.utils.esc(albumArtist) + '</span>' + moreHtml);

    container.innerHTML = `
      <div class="detail-header">
        <div class="detail-cover" id="detail-cover">
          <div class="detail-cover-blur" id="detail-cover-blur"></div>
          <div class="detail-cover-shape s1"></div>
          <div class="detail-cover-shape s2"></div>
          <div class="detail-cover-shape s3"></div>
          <div class="detail-cover-main" id="detail-cover-main"></div>
        </div>
        <div class="detail-cover-gradient"></div>
        <div class="detail-meta detail-meta-stacked">
          <h1 class="detail-name">${App.utils.esc(album.album)}</h1>
          ${artistHtml ? '<p class="detail-byline">' + artistHtml + '</p>' : ''}
          <p class="detail-meta-line">${album.year || App.i18n.t('music.unknownYear')} · ${App.i18n.t('albums.trackCountShort', { count: album.track_count })}</p>
          <div class="detail-actions">
            <button class="detail-play-btn" id="btn-play-album">
              <span class="material-symbols-rounded">play_arrow</span><span data-i18n="albums.play">播放</span>
            </button>
            <button class="detail-icon-btn" id="btn-like-album" aria-pressed="false">
              <span class="material-symbols-rounded">favorite_border</span>
            </button>
          </div>
        </div>
      </div>
      <ul class="track-list" id="album-track-list"></ul>
    `;

    if (App.i18n && App.i18n.applyToDOM) App.i18n.applyToDOM(container);

    const coverUrl = album.cover_track_id ? window.coverUrl(album.cover_track_id, 512) : null;
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

    const allTracks = (App.state && App.state.allTracks) ? App.state.allTracks : [];
    const keySet = new Set(_albumKeys(album).map(function (k) {
      return _albumKeyId(k.album, k.album_artist);
    }));
    const tracks = allTracks.filter(function (t) {
      return keySet.has(_albumKeyId(t.album, t.album_artist || t.artist));
    }).sort(function (a, b) {
      const da = (a.disc_number || 0), db = (b.disc_number || 0);
      if (da !== db) return da - db;
      return (a.track_number || 0) - (b.track_number || 0);
    });

    const ul = document.getElementById('album-track-list');
    const frag = document.createDocumentFragment();

    tracks.forEach((track, i) => {

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

    const artistLink = document.getElementById('detail-artist-link');
    if (artistLink) {
      artistLink.addEventListener('click', function () {
        App.navigate('artists', { artist: albumArtist });
      });
    }

    const likeBtn = document.getElementById('btn-like-album');
    _likeBtnEl = likeBtn;
    _currentAlbum = album;
    _paintAlbumLikeBtn(likeBtn, !!_likedKeyOf(album));
    if (likeBtn) {
      likeBtn.addEventListener('click', () => {
        // 乐观更新：liked_albums_changed 事件回来后再校准一次。
        // 合并专辑里已经有一个键被喜爱时，点一下要撤掉「那个」键，不能又插新键。
        const next = !likeBtn.classList.contains('liked');
        const liked = _likedKeyOf(album);
        const target = liked || { album: album.album, album_artist: album.album_artist };
        _paintAlbumLikeBtn(likeBtn, next);
        App.backend.toggle_liked_album(target.album, target.album_artist);
      });
    }
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
