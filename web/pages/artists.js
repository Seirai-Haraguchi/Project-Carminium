(function () {
  'use strict';

  window.App = window.App || {};
  const page = {};
  window.App.pages.artists = page;

  let allArtists = [];
  let filterStr = '';
  let searchText = '';
  let sortMode = 'az';

  let _aliasMatchNames = null;
  let _aliasMatchQuery = '';
  let _aliasFetchTimer = null;
  let _aliasFetchSeq = 0;

  let _vl = null;

  let _flatList = [];
  const ROW_HEIGHT = 64;

  const _avatarProbeCache = new Map();

  // 用户换过头像的艺人：name → 版本号。加在 URL 上破除 HTTP 缓存
  // （cover-server 对这些端点给了 max-age，不加版本会看到旧图）。
  // 表放在 window 上，your_mix 等页面的 artistImageUrl() 调用也能吃到新版本。
  const _imageVersion = window.__artistImageVersions || Object.create(null);
  window.__artistImageVersions = _imageVersion;

  // 后端会为「有自定义头像」的艺人带出 override_at，用它当版本号，
  // 重启后也能拿到带版本的 URL（否则会命中旧自动头像的 24h 缓存）。
  function _seedImageVersion(artist) {
    if (!artist || !artist.name || !artist.override_at) return;
    if (!_imageVersion[artist.name]) _imageVersion[artist.name] = artist.override_at;
  }

  function _imageUrl(name) {
    if (!window.artistImageUrl || !name) return null;
    return window.artistImageUrl(name, _imageVersion[name] || '');
  }

  function _bannerUrl(name) {
    if (!name || typeof window.__coverBase !== 'string') return null;
    let url = window.__coverBase + '/artist-banner/' + encodeURIComponent(name);
    if (_imageVersion[name]) url += '?v=' + encodeURIComponent(String(_imageVersion[name]));
    return url;
  }

  function _avatarProbeState(name, url) {
    const v = _avatarProbeCache.get(name);
    if (v === 'ok') return 'ok';
    if (v === 'miss') return 'miss';
    return 'unknown';
  }

  function _applyAvatar(avEl, name, url) {
    if (!avEl || avEl.dataset.artist !== name) return;
    avEl.style.background = '';
    avEl.style.backgroundImage = 'url(' + url + ')';
    avEl.style.backgroundSize = 'cover';
    avEl.style.backgroundPosition = 'center';
    avEl.innerHTML = '';
  }
  const HEADER_HEIGHT = 32;

  const SORT_OPTIONS = [
    { key: 'az', label: 'A-Z', icon: 'sort_by_alpha' },
    { key: 'za', label: 'Z-A', icon: 'sort_by_alpha' },
    { key: 'albums', labelKey: 'artists.sortAlbums', icon: 'album' },
    { key: 'tracks', labelKey: 'artists.sortTracks', icon: 'music_note' },
  ];

  page.render = function (container, params) {
    container.innerHTML = `
      <div class="page-sticky-header">
        <div class="page-header">
          <div class="page-header-left">
            <h1 class="page-title" data-i18n="artists.title">艺术家</h1>
            <p class="page-subtitle" id="artist-count" data-i18n="common.loading">加载中…</p>
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
          <input type="text" id="artist-search" data-i18n-placeholder="artists.searchPlaceholder" placeholder="搜索艺术家…" data-i18n-aria-label="artists.searchPlaceholder" aria-label="搜索艺术家">
        </div>
      </div>
      <div class="artist-list az-list vl-artist-list" id="artist-list"></div>
    `;

    const searchInput = document.getElementById('artist-search');
    searchInput.value = searchText;

    var _searchDebounceTimer = null;
    searchInput.addEventListener('input', function (e) {
      searchText = e.target.value;
      filterStr = searchText.trim().toLowerCase();
      if (_searchDebounceTimer) clearTimeout(_searchDebounceTimer);
      _searchDebounceTimer = setTimeout(function () {
        _searchDebounceTimer = null;
        _renderList(container);
      }, 180);
    });

    _setupSortDropdown(container);

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
          if (ca !== cb) return ca - cb;

          const ka = App.utils.itemSortKey(a, 'sort_key', 'name');
          const kb = App.utils.itemSortKey(b, 'sort_key', 'name');
          return ka.localeCompare(kb);
        });
        break;
      case 'tracks':
        sorted.sort((a, b) => {
          const ca = b.track_count || 0;
          const cb = a.track_count || 0;
          if (ca !== cb) return ca - cb;

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

    if (sortMode === 'az' || sortMode === 'za') {
      return App.utils.groupByLetter(list, a => a.name || '');
    }

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

  var _azCache = { src: null, list: [] };
  function _azLetters() {
    if (_azCache.src === _flatList) return _azCache.list;
    var out = [];
    for (var i = 0; i < _flatList.length; i++) {
      if (_flatList[i].type === 'header') out.push(_flatList[i].letter);
    }
    _azCache = { src: _flatList, list: out };
    return out;
  }

  function _openLetterIndex() {
    var listEl = document.getElementById('artist-list');
    var az = window.App && App.azIndex;
    if (!listEl || !az) return;
    var letters = _azLetters();
    if (!az.isAlphabetical(letters)) return;
    az.open({
      host: listEl,
      letters: letters,
      onPick: function (letter) {
        for (var i = 0; i < _flatList.length; i++) {
          var item = _flatList[i];
          if (item.type === 'header' && item.letter === letter) {

            az.scrollTo(az.offsetOf(listEl) + i * ROW_HEIGHT);
            return;
          }
        }
      },
    });
  }

  function _renderList(container) {
    const listEl = document.getElementById('artist-list');
    if (!listEl) return;

    if (window.App.azIndex) App.azIndex.reset();

    let list = filterStr ? allArtists.filter(a => App.utils.matchItem(filterStr, a, [
      { text: 'name', key: 'sort_key' },
    ])) : allArtists;

    if (filterStr) {
      if (_aliasMatchQuery !== filterStr) {

        _aliasMatchNames = null;
        _aliasMatchQuery = filterStr;
        const seq = ++_aliasFetchSeq;
        const q = filterStr;
        if (_aliasFetchTimer) clearTimeout(_aliasFetchTimer);
        _aliasFetchTimer = setTimeout(function () {
          if (typeof window.__coverBase !== 'string') return;
          fetch(window.__coverBase + '/artist-alias-search/' + encodeURIComponent(q))
            .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
            .then(function (names) {
              if (seq !== _aliasFetchSeq) return;
              _aliasMatchNames = new Set((names || []).map(function (n) { return String(n).toLowerCase(); }));
              if (filterStr === q) _renderList(container);
            })
            .catch(function () {  });
        }, 250);
      }
      if (_aliasMatchNames && _aliasMatchNames.size) {
        const have = {};
        list.forEach(function (a) { have[a.name || ''] = true; });
        allArtists.forEach(function (a) {
          const n = a.name || '';
          if (!have[n] && _aliasMatchNames.has(n.toLowerCase())) list.push(a);
        });
      }
    } else {

      _aliasMatchNames = null;
      _aliasMatchQuery = '';
      _aliasFetchSeq++;
      if (_aliasFetchTimer) { clearTimeout(_aliasFetchTimer); _aliasFetchTimer = null; }
    }

    list = _sortArtists(list);

    const countEl = document.getElementById('artist-count');
    if (countEl) {
      countEl.textContent = filterStr ? App.i18n.t('artists.filteredCount', { shown: list.length, total: allArtists.length }) : App.i18n.t('artists.count', { count: allArtists.length });
    }

    if (list.length === 0) {
      if (_vl) { _vl.destroy(); _vl = null; }
      _flatList = [];
      listEl.innerHTML = `
        <div class="empty-state">
          <span class="material-symbols-rounded empty-icon">person</span>
          <h2 class="empty-title" data-i18n="common.noResults">无结果</h2>
        </div>
      `;
      return;
    }

    const groups = filterStr ? [{ letter: '', items: list }] : _groupArtists(list);

    _flatList = [];
    groups.forEach(group => {
      if (!filterStr) {
        _flatList.push({ type: 'header', letter: group.letter });
      }
      group.items.forEach(artist => {
        _flatList.push({ type: 'row', artist: artist });
      });
    });

    const canReuse = _vl && _vl.container === listEl;
    if (!canReuse && _vl) { _vl.destroy(); _vl = null; }
    if (!canReuse) listEl.innerHTML = '';

    const scRoll = document.getElementById('content-pane');
    if (scRoll) scRoll.scrollTop = 0;

    if (canReuse) {
      _vl.setItems(_flatList);
      return;
    }

    _vl = new window.VirtualList({
      container: listEl,
      scrollContainer: document.getElementById('content-pane'),
      items: _flatList,
      itemHeight: ROW_HEIGHT,
      estimatedItemHeight: ROW_HEIGHT,
      getHeight: function (item) {
        return item.type === 'header' ? HEADER_HEIGHT : ROW_HEIGHT;
      },
      bufferSize: 8,
      renderItem: function (item, index, el) {
        if (item.type === 'header') {
          el.className = 'az-section-header vl-item';
          el.innerHTML = '<span class="az-section-letter">' + item.letter + '</span>';
          if (window.App.azIndex && App.azIndex.isAlphabetical(_azLetters())) {
            el.classList.add('az-header-action');
            el.onclick = _openLetterIndex;
          } else {
            el.onclick = null;
          }
        } else {
          const artist = item.artist;
          el.className = 'artist-row vl-item';

          const name = artist.name || '';
          const bg = App.utils.hashColor(name);
          _seedImageVersion(artist);

          el.innerHTML =
            '<div class="artist-avatar" data-artist="' + App.utils.esc(name) + '" style="background:' + bg + ';color:#fff;">' +
              '<span style="font-size:20px;font-weight:700;color:#fff;">' + App.utils.initial(name) + '</span>' +
            '</div>' +
            '<div class="artist-info">' +
              '<p class="artist-name">' + App.utils.esc(name) + '</p>' +
              '<p class="artist-meta">' + App.i18n.t('artists.albumCount', { count: artist.album_count }) + ' · ' +
              App.i18n.t('music.trackCount', { count: artist.track_count }) + '</p>' +
            '</div>' +
            '<span class="material-symbols-rounded artist-chevron">chevron_right</span>';

          const url = _imageUrl(name);
          const avEl = el.querySelector('.artist-avatar');
          if (url && avEl) {
            const state = _avatarProbeState(name, url);
            if (state === 'ok') {

              _applyAvatar(avEl, name, url);
            } else if (state === 'miss') {

            } else {
              const probe = new Image();
              probe.onload = function () {
                _avatarProbeCache.set(name, 'ok');

                if (avEl.dataset.artist !== name) return;
                _applyAvatar(avEl, name, url);
              };
              probe.onerror = function () { _avatarProbeCache.set(name, 'miss'); };
              probe.src = url;
            }
          }

          el.onclick = function () { _renderDetail(container, artist); };
        }
      },
    });
  }

  let _allArtistAlbums = [];
  let _allArtistTracks = [];
  let _currentArtistName = '';

  function _renderDetail(container, artist) {

    App.scrollMemory.save('artists');
    container.innerHTML = `
      <div class="detail-header">
        <div class="detail-cover" id="detail-cover">
          <div class="detail-cover-blur" id="detail-cover-blur"></div>
          <div class="detail-cover-shape s1"></div>
          <div class="detail-cover-shape s2"></div>
          <div class="detail-cover-shape s3"></div>
          <div class="detail-cover-main" id="detail-avatar"></div>
        </div>
        <div class="detail-cover-gradient"></div>
        <div class="detail-meta">
          <p class="detail-type" data-i18n="artists.title">艺术家</p>
          <h1 class="detail-name">${App.utils.esc(artist.name)}</h1>
          <p class="detail-sub">${App.i18n.t('artists.albumCount', { count: artist.album_count })} · ${App.i18n.t('music.trackCount', { count: artist.track_count })}</p>
          <p class="detail-alias" id="detail-alias" hidden></p>
          <div class="detail-actions">
            <button class="detail-play-btn" id="btn-play-artist">
              <span class="material-symbols-rounded">play_arrow</span><span data-i18n="artists.playAll">播放全部</span>
            </button>
            <button class="detail-play-btn tonal" id="btn-edit-artist">
              <span class="material-symbols-rounded">edit</span><span data-i18n="artists.editInfo">编辑信息</span>
            </button>
          </div>
        </div>
      </div>
      <div class="artist-detail-body" id="artist-detail-body">
        <div class="np-pivot artist-pivot" role="tablist">
          <button class="np-pivot-tab active" data-tab="songs" role="tab" aria-selected="true" data-i18n="artists.songs">歌曲</button>
          <button class="np-pivot-tab" data-tab="albums" role="tab" aria-selected="false" data-i18n="artists.albums">专辑</button>
          <button class="np-pivot-tab" data-tab="about" role="tab" aria-selected="false" data-i18n="artists.about" id="artist-about-tab" style="display:none">简介</button>
        </div>
        <div class="artist-panel active" data-panel="songs" id="artist-panel-songs">
          <ul class="track-list" id="artist-songs-list"></ul>
        </div>
        <div class="artist-panel" data-panel="albums" id="artist-panel-albums" hidden>
          <div class="album-grid artist-album-grid" id="artist-album-grid"></div>
        </div>
        <div class="artist-panel" data-panel="about" id="artist-panel-about" hidden>
          <p class="artist-bio-text" id="artist-bio-text"></p>
        </div>
      </div>
    `;

    if (App.i18n && App.i18n.applyToDOM) App.i18n.applyToDOM(container);

    const blurEl = document.getElementById('detail-cover-blur');
    const mainEl = document.getElementById('detail-avatar');
    const headerEl = container.querySelector('.detail-header');

    const placeholderColor = App.utils.hashColor(artist.name);
    const initial = App.utils.initial(artist.name);
    blurEl.style.background = placeholderColor;
    mainEl.style.background = placeholderColor;
    mainEl.innerHTML = `<span style="font-size:48px; color:#fff; font-weight:700;">${initial}</span>`;

    const allTracks = (App.state && App.state.allTracks) ? App.state.allTracks : [];
    const tracks = allTracks.filter(function (t) {
      var names = t.artists || [t.artist || App.i18n.t('common.unknownArtist')];
      return names.indexOf(artist.name) >= 0;
    }).sort(function (a, b) {
      const aa = (a.album || '').toLowerCase(), ab = (b.album || '').toLowerCase();
      if (aa !== ab) return aa < ab ? -1 : 1;
      const da = (a.disc_number || 0), db = (b.disc_number || 0);
      if (da !== db) return da - db;
      return (a.track_number || 0) - (b.track_number || 0);
    });
    _allArtistTracks = tracks;
    _currentArtistName = artist.name;

    var albumMap = {};
    var albumOrder = [];
    for (var i = 0; i < tracks.length; i++) {
      var al = tracks[i].album || App.i18n.t('common.unknownAlbum');
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

    _renderSongsPanel();
    _renderAlbumsPanel();
    _setupPivot();

    document.getElementById('btn-play-artist').addEventListener('click', function () {
      App.backend.play_from_list(JSON.stringify(tracks), 0);
    });
    var editBtn = document.getElementById('btn-edit-artist');
    if (editBtn) editBtn.addEventListener('click', function () { _openEditDialog(artist); });

    var heroApplied = false;
    var applyHero = function (url) {
      if (heroApplied) {

        if (!url) return;
        var imgEl = headerEl.querySelector('.detail-hero-img');
        if (imgEl) imgEl.style.backgroundImage = 'url(' + url + ')';
        return;
      }
      heroApplied = true;
      headerEl.classList.add('hero');
      var heroImg = document.createElement('div');
      heroImg.className = 'detail-hero-img';
      // 只用 background-color 长写：background 简写会连带把 CSS 里的
      // background-size:cover / background-repeat:no-repeat 重置为默认值，
      // 导致横幅图按原始尺寸平铺。
      heroImg.style.backgroundColor = placeholderColor;
      if (url) heroImg.style.backgroundImage = 'url(' + url + ')';
      headerEl.insertBefore(heroImg, headerEl.firstChild);
    };

    _seedImageVersion(artist);
    var aUrl = _imageUrl(artist.name);
    var bUrl = _bannerUrl(artist.name);

    var applyArtistColor = function (imgEl) {
      if (!imgEl || !App.utils.extractDominantColor) return;
      try {
        var rgb = App.utils.extractDominantColor(imgEl);
        if (rgb) headerEl.style.setProperty('--artist-rgb', rgb.join(', '));
      } catch (e) {  }
    };

    if (bUrl) {
      var bProbe = new Image();
      bProbe.crossOrigin = 'anonymous';
      bProbe.onload = function () {
        if (bProbe.naturalWidth >= bProbe.naturalHeight) applyHero(bUrl);
        applyArtistColor(bProbe);
      };
      bProbe.onerror = function () {  };
      bProbe.src = bUrl;
    }

    if (aUrl) {
      var probe = new Image();
      probe.crossOrigin = 'anonymous';
      probe.onload = function () {
        applyArtistColor(probe);
        mainEl.style.background = '';
        mainEl.style.backgroundImage = 'url(' + aUrl + ')';
        mainEl.style.backgroundSize = 'cover';
        mainEl.style.backgroundPosition = 'center';
        mainEl.innerHTML = '';
        if (blurEl) {
          blurEl.style.background = '';
          blurEl.style.backgroundImage = 'url(' + aUrl + ')';
          blurEl.style.backgroundSize = 'cover';
          blurEl.style.backgroundPosition = 'center';
          blurEl.style.backgroundRepeat = 'no-repeat';
        }
      };
      probe.onerror = function () {

      };
      probe.src = aUrl;
    }

    _refreshArtistMeta(artist);
  }

  function _paintAliasChips(aliases) {
    var el = document.getElementById('detail-alias');
    if (!el || !el.isConnected) return;
    var list = Array.isArray(aliases) ? aliases : [];
    if (!list.length) {
      el.innerHTML = '';
      el.hidden = true;
      return;
    }
    el.innerHTML = list.map(function (a) {
      return '<span class="alias-chip">' + App.utils.esc(String(a)) + '</span>';
    }).join('');
    el.hidden = false;
  }

  function _paintBio(text) {
    var tab = document.getElementById('artist-about-tab');
    var el = document.getElementById('artist-bio-text');
    if (!el || !el.isConnected) return;
    var t = String(text || '').trim();
    if (!t) {
      el.textContent = '';
      // 「简介」页签正被打开时不要把它藏掉，否则面板会空白无退路
      if (tab && !tab.classList.contains('active')) tab.style.display = 'none';
      return;
    }
    el.textContent = t;
    if (tab) tab.style.display = '';
  }

  // 别名 chips 与「简介」页签的内容都来自 cover-server（优先返回用户覆盖层）。
  // 抽出来是为了编辑保存后能就地刷新，不必整页重绘丢掉滚动与页签状态。
  // bust=true 时给 URL 挂时间戳，避开编辑器刚打开页面时那次请求留下的缓存。
  function _refreshArtistMeta(artist, bust) {
    if (!artist || !artist.name || typeof window.__coverBase !== 'string') return;
    var q = bust ? ('?v=' + Date.now()) : '';
    var base = window.__coverBase;
    var enc = encodeURIComponent(artist.name);

    if (document.getElementById('detail-alias')) {
      fetch(base + '/artist-aliases/' + enc + q)
        .then(function (r) {
          if (!r.ok) throw new Error('HTTP ' + r.status);
          return r.json();
        })
        .then(function (obj) { _paintAliasChips((obj && obj.aliases) || []); })
        .catch(function () {  });
    }

    if (document.getElementById('artist-bio-text')) {
      fetch(base + '/artist-bio/' + enc + q)
        .then(function (r) {
          if (!r.ok) throw new Error('HTTP ' + r.status);
          return r.text();
        })
        .then(function (text) { _paintBio(text); })
        .catch(function () { _paintBio(''); });
    }
  }

  // 换/清头像后就地刷新详情页的方图、模糊底与横幅，不必整页重绘。
  function _refreshArtistImages(name) {
    var headerEl = document.querySelector('.detail-header');
    var mainEl = document.getElementById('detail-avatar');
    var blurEl = document.getElementById('detail-cover-blur');
    if (!headerEl || !mainEl) return;
    var placeholderColor = App.utils.hashColor(name);
    var url = _imageUrl(name);

    if (!url) return;
    var probe = new Image();
    probe.crossOrigin = 'anonymous';
    probe.onload = function () {
      if (!mainEl.isConnected) return;
      if (App.utils.extractDominantColor) {
        try {
          var rgb = App.utils.extractDominantColor(probe);
          if (rgb) headerEl.style.setProperty('--artist-rgb', rgb.join(', '));
        } catch (e) {  }
      }
      mainEl.style.background = '';
      mainEl.style.backgroundImage = 'url(' + url + ')';
      mainEl.style.backgroundSize = 'cover';
      mainEl.style.backgroundPosition = 'center';
      mainEl.innerHTML = '';
      if (blurEl) {
        blurEl.style.background = '';
        blurEl.style.backgroundImage = 'url(' + url + ')';
        blurEl.style.backgroundSize = 'cover';
        blurEl.style.backgroundPosition = 'center';
        blurEl.style.backgroundRepeat = 'no-repeat';
      }
      var heroImg = headerEl.querySelector('.detail-hero-img');
      if (heroImg && probe.naturalWidth >= probe.naturalHeight) {
        heroImg.style.backgroundImage = 'url(' + url + ')';
      }
    };
    probe.onerror = function () {
      // 用户把自定义图删了、自动源又没有：退回首字母占位
      if (!mainEl.isConnected) return;
      mainEl.style.backgroundImage = '';
      mainEl.style.background = placeholderColor;
      mainEl.innerHTML = '<span style="font-size:48px; color:#fff; font-weight:700;">' +
        App.utils.initial(name) + '</span>';
      if (blurEl) {
        blurEl.style.backgroundImage = '';
        blurEl.style.background = placeholderColor;
      }
      var heroImg = headerEl.querySelector('.detail-hero-img');
      if (heroImg) heroImg.style.backgroundImage = '';
    };
    probe.src = url;
  }

  function _setupPivot() {
    var tabs = document.querySelectorAll('.artist-pivot .np-pivot-tab');
    var panels = document.querySelectorAll('.artist-detail-body .artist-panel');
    tabs.forEach(function (tab) {
      tab.addEventListener('click', function () {
        var target = tab.getAttribute('data-tab');
        tabs.forEach(function (t) {
          var isActive = t.getAttribute('data-tab') === target;
          t.classList.toggle('active', isActive);
          t.setAttribute('aria-selected', isActive ? 'true' : 'false');
        });
        panels.forEach(function (panel) {
          var show = panel.getAttribute('data-panel') === target;
          panel.classList.toggle('active', show);
          panel.hidden = !show;
        });
      });
    });
  }

  // ── 编辑艺人信息 ────────────────────────────────────────────────────
  // 自动抓取是「逐层试探、命中即止」：首选来源张冠李戴时整页信息都错。
  // 这里除了允许手写覆盖，还把各来源的候选摊开让用户自己挑
  // （封面会带上它对应的艺人名，选错人一眼就能看出来）。
  // 覆盖层存在 library.db 的 artist_overrides 表，字段为 NULL 表示继续自动获取。

  var SOURCE_LABEL_KEYS = {
    netease: 'artists.src.netease',
    itunes: 'artists.src.itunes',
    deezer: 'artists.src.deezer',
    audiodb: 'artists.src.audiodb',
    wikipedia: 'artists.src.wikipedia',
    musicbrainz: 'artists.src.musicbrainz',
    kugou: 'artists.src.kugou',
    baike: 'artists.src.baike',
  };

  function _sourceLabel(src) {
    var key = SOURCE_LABEL_KEYS[src];
    return key ? App.i18n.t(key) : String(src || '');
  }

  function _openEditDialog(artist) {
    if (!artist || !artist.name) return;
    var name = artist.name;

    // 别名/简介的「自动值」直接取详情页已渲染的内容：这两个端点在冷缓存时要打
    // MusicBrainz / 网易云等外部源，自己再请求一次会让弹窗卡好几秒才出现。
    var pageAliases = Array.prototype.map.call(
      document.querySelectorAll('#detail-alias .alias-chip'),
      function (el) { return el.textContent.trim(); }
    ).filter(Boolean);
    var bioEl = document.getElementById('artist-bio-text');
    var pageBio = bioEl ? bioEl.textContent.trim() : '';

    App.utils.call('get_artist_override', name).then(function (raw) {
      var ov = null;
      try { ov = JSON.parse(raw); } catch (e) { ov = null; }
      _buildEditDialog(artist, ov, pageAliases, pageBio);
    }).catch(function (err) {
      // 读不到覆盖记录时宁可不开：否则弹窗会把「已自定义」当成「自动」，
      // 一保存就把用户之前的修正抹掉。
      App.utils.toast(String((err && err.message) || err));
    });
  }

  function _buildEditDialog(artist, ov, pageAliases, pageBio) {
    var name = artist.name;
    var base = window.__coverBase || '';
    var t = function (k, p) { return App.i18n.t(k, p); };
    var esc = function (v) { return App.utils.esc(String(v == null ? '' : v)); };

    var customAliases = !!(ov && Array.isArray(ov.aliases));
    var customBio = !!(ov && typeof ov.bio === 'string');

    var state = {
      tab: 'image',
      // 别名/简介的「自动值」＝打开弹窗时页面上显示的内容
      autoAliases: customAliases ? [] : pageAliases.slice(),
      customAliases: customAliases,
      aliasList: customAliases ? ov.aliases.slice() : pageAliases.slice(),
      autoBio: customBio ? '' : (pageBio || ''),
      customBio: customBio,
      bio: customBio ? (ov.bio || '') : (pageBio || ''),
      customImage: !!(ov && ov.image_path),
      imageId: '',       // 已应用的候选 id（用户点过才有）
      cand: null,        // 网络候选（异步到达）
      candDone: false,
    };

    var overlay = document.createElement('div');
    overlay.className = 'cmd-dialog-overlay';
    var dlg = document.createElement('div');
    dlg.className = 'cmd-dialog artist-edit';
    dlg.innerHTML = `
      <div class="cmd-dialog-title">${t('artists.editTitle')}</div>
      <div class="md-segbar ae-seg" role="tablist">
        <button type="button" class="md-segbar-btn" data-tab="image" role="tab" aria-selected="true">${t('artists.editTabImage')}</button>
        <button type="button" class="md-segbar-btn" data-tab="alias" role="tab" aria-selected="false">${t('artists.editTabAlias')}</button>
        <button type="button" class="md-segbar-btn" data-tab="bio" role="tab" aria-selected="false">${t('artists.editTabBio')}</button>
      </div>
      <div class="artist-edit-body">
        <div class="ae-panel active" data-panel="image">
          <div class="ae-current">
            <div class="ae-avatar" id="ae-avatar"></div>
            <div class="ae-current-text">
              <p class="ae-current-name">${esc(name)}</p>
              <p class="ae-current-sub" id="ae-img-state"></p>
            </div>
            <div class="ae-current-actions">
              <button type="button" class="ae-text-btn" id="ae-pick-local">${t('artists.editPickLocal')}</button>
              <button type="button" class="ae-text-btn" id="ae-clear-img">${t('artists.editRemoveImage')}</button>
            </div>
          </div>
          <div class="settings-group-header">${t('artists.editNetwork')}</div>
          <div class="ae-grid" id="ae-grid"></div>
          <p class="ae-empty" id="ae-img-empty" hidden></p>
          <p class="artist-edit-hint">${t('artists.editImageHint')}</p>
        </div>

        <div class="ae-panel" data-panel="alias">
          <div class="artist-edit-field">
            <div class="artist-edit-label-row">
              <span class="artist-edit-label">${t('artists.editTabAlias')}</span>
              <button type="button" class="ae-text-btn" id="ae-alias-reset">${t('artists.editResetAuto')}</button>
            </div>
            <div class="ae-chips" id="ae-chips"></div>
            <input type="text" id="ae-alias-input" class="settings-font-input ae-input"
                   placeholder="${t('artists.editAliasPlaceholder')}">
            <p class="artist-edit-hint" id="ae-alias-hint"></p>
          </div>
          <div class="settings-group-header">${t('artists.editNetwork')}</div>
          <div class="md-seglist" id="ae-alias-cands"></div>
        </div>

        <div class="ae-panel" data-panel="bio">
          <div class="artist-edit-field">
            <div class="artist-edit-label-row">
              <span class="artist-edit-label">${t('artists.editTabBio')}</span>
              <button type="button" class="ae-text-btn" id="ae-bio-reset">${t('artists.editResetAuto')}</button>
            </div>
            <textarea id="ae-bio" class="ae-textarea" rows="8"
                      placeholder="${t('artists.editBioPlaceholder')}"></textarea>
            <p class="artist-edit-hint" id="ae-bio-hint"></p>
          </div>
          <div class="settings-group-header">${t('artists.editNetwork')}</div>
          <div class="md-seglist" id="ae-bio-cands"></div>
        </div>
      </div>
      <p class="artist-edit-status" id="ae-status" role="status" hidden></p>
      <div class="cmd-dialog-actions">
        <button class="cmd-dialog-btn cmd-dialog-btn--cancel">${t('common.cancel')}</button>
        <button class="cmd-dialog-btn cmd-dialog-btn--confirm">${t('common.save')}</button>
      </div>
    `;
    overlay.appendChild(dlg);
    document.body.appendChild(overlay);
    requestAnimationFrame(function () { overlay.classList.add('open'); });

    var $ = function (sel) { return dlg.querySelector(sel); };
    var avatarEl = $('#ae-avatar');
    var imgStateEl = $('#ae-img-state');
    var gridEl = $('#ae-grid');
    var imgEmptyEl = $('#ae-img-empty');
    var chipsEl = $('#ae-chips');
    var aliasInput = $('#ae-alias-input');
    var aliasHint = $('#ae-alias-hint');
    var aliasReset = $('#ae-alias-reset');
    var aliasCandsEl = $('#ae-alias-cands');
    var bioEl = $('#ae-bio');
    var bioHint = $('#ae-bio-hint');
    var bioReset = $('#ae-bio-reset');
    var bioCandsEl = $('#ae-bio-cands');
    var statusEl = $('#ae-status');

    var closed = false;

    // 对话框 overlay 的层级高于 toast，反馈只能写在框内
    var statusTimer = null;
    function flashStatus(msg) {
      if (!msg) return;
      statusEl.textContent = msg;
      statusEl.hidden = false;
      if (statusTimer) clearTimeout(statusTimer);
      statusTimer = setTimeout(function () {
        statusEl.hidden = true;
        statusEl.textContent = '';
      }, 2600);
    }

    function emptyHint(text) {
      var p = document.createElement('p');
      p.className = 'ae-empty';
      p.innerHTML = '<span class="material-symbols-rounded">search</span><span>' + esc(text) + '</span>';
      // 网络抖一下就「没有结果」太被动，给个重试入口
      var retry = document.createElement('button');
      retry.type = 'button';
      retry.className = 'ae-text-btn';
      retry.textContent = t('artists.editRetry');
      retry.addEventListener('click', function () { loadCandidates(); });
      p.appendChild(retry);
      return p;
    }
    function loadingHint() {
      var p = document.createElement('p');
      p.className = 'ae-empty';
      p.innerHTML = '<span class="material-symbols-rounded">search</span><span>' + esc(t('artists.editSearching')) + '</span>';
      return p;
    }

    // ── 页签 ──────────────────────────────────────────────────────
    var tabBtns = Array.prototype.slice.call(dlg.querySelectorAll('.ae-seg .md-segbar-btn'));
    var panels = Array.prototype.slice.call(dlg.querySelectorAll('.ae-panel'));
    tabBtns.forEach(function (btn) {
      btn.addEventListener('click', function () {
        var tab = btn.dataset.tab;
        state.tab = tab;
        tabBtns.forEach(function (b) { b.setAttribute('aria-selected', String(b === btn)); });
        panels.forEach(function (p) { p.classList.toggle('active', p.dataset.panel === tab); });
        dlg.querySelector('.artist-edit-body').scrollTop = 0;
      });
    });

    // ── 图片 ──────────────────────────────────────────────────────
    function paintAvatar() {
      var url = _imageUrl(name);
      avatarEl.style.backgroundImage = '';
      avatarEl.textContent = App.utils.initial(name);
      if (!url) return;
      var probe = new Image();
      probe.onload = function () {
        avatarEl.style.backgroundImage = 'url(' + url + ')';
        avatarEl.textContent = '';
      };
      probe.src = url;
    }

    function paintImageState() {
      imgStateEl.textContent = state.customImage
        ? t('artists.editSrcCustom')
        : (state.imageId ? t('artists.editSrcCustom') : '');
      if (!imgStateEl.textContent) {
        var has = !!_imageUrl(name);
        imgStateEl.textContent = has ? t('artists.editSrcAuto') : t('artists.editSrcNone');
      }
    }

    function syncImageSelection() {
      Array.prototype.forEach.call(gridEl.querySelectorAll('.ae-thumb'), function (btn) {
        var on = btn.dataset.id === state.imageId;
        btn.setAttribute('aria-selected', String(on));
        var old = btn.querySelector('.ae-thumb-check');
        if (on && !old) {
          var span = document.createElement('span');
          span.className = 'ae-thumb-check';
          span.innerHTML = '<span class="material-symbols-rounded">check</span>';
          btn.appendChild(span);
        } else if (!on && old) {
          old.remove();
        }
      });
    }

    function renderImageCandidates() {
      var list = (state.cand && state.cand.images) || [];
      gridEl.innerHTML = '';
      if (!state.candDone) {
        imgEmptyEl.hidden = true;
        gridEl.appendChild(loadingHint());
        return;
      }
      if (!list.length) {
        imgEmptyEl.hidden = true;
        gridEl.appendChild(emptyHint(t('artists.editNoCandidates')));
        return;
      }
      imgEmptyEl.hidden = true;
      list.forEach(function (c) {
        var cell = document.createElement('div');
        cell.className = 'ae-cell';
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'ae-thumb';
        btn.dataset.id = c.id;
        btn.style.backgroundImage = 'url(' + base + c.url + ')';
        btn.setAttribute('aria-selected', String(c.id === state.imageId));
        var label = _sourceLabel(c.source) + (c.artistName ? ' · ' + c.artistName : '');
        btn.setAttribute('aria-label', label);
        if (c.id === state.imageId) {
          var chk = document.createElement('span');
          chk.className = 'ae-thumb-check';
          chk.innerHTML = '<span class="material-symbols-rounded">check</span>';
          btn.appendChild(chk);
        }
        btn.addEventListener('click', function () { applyCandidateImage(c); });
        var nameCap = document.createElement('span');
        nameCap.className = 'ae-src-name';
        nameCap.textContent = c.artistName || _sourceLabel(c.source);
        nameCap.title = label;
        var srcCap = document.createElement('span');
        srcCap.className = 'ae-src';
        srcCap.textContent = _sourceLabel(c.source);
        cell.appendChild(btn);
        cell.appendChild(nameCap);
        cell.appendChild(srcCap);
        gridEl.appendChild(cell);
      });
    }

    function onImageApplied(version, imageId, isCustom) {
      if (!version) return;
      _imageVersion[name] = version;
      _avatarProbeCache.delete(name);
      state.imageId = imageId || '';
      state.customImage = !!isCustom;
      paintAvatar();
      paintImageState();
      syncImageSelection();
      _refreshArtistImages(name);
    }

    function applyCandidateImage(c) {
      App.utils.call('apply_artist_image_candidate', name, c.id).then(function (raw) {
        var res = {};
        try { res = JSON.parse(raw) || {}; } catch (e) {  }
        if (!res.ok) { flashStatus(t('artists.editSaveFailed')); return; }
        onImageApplied(res.version, c.id, true);
        flashStatus(t('artists.editImageChanged'));
      });
    }

    $('#ae-pick-local').addEventListener('click', function () {
      App.utils.call('pick_artist_image', name).then(function (raw) {
        var res = {};
        try { res = JSON.parse(raw) || {}; } catch (e) {  }
        if (res.canceled) return;
        if (!res.ok) { flashStatus(t('artists.editSaveFailed')); return; }
        onImageApplied(res.version, '', true);
        flashStatus(t('artists.editImageChanged'));
      });
    });

    $('#ae-clear-img').addEventListener('click', function () {
      App.utils.call('clear_artist_image', name).then(function (raw) {
        var res = {};
        try { res = JSON.parse(raw) || {}; } catch (e) {  }
        if (!res.ok) { flashStatus(t('artists.editSaveFailed')); return; }
        onImageApplied(res.version, '', false);
        flashStatus(t('artists.editImageCleared'));
      });
    });

    // ── 别名 ──────────────────────────────────────────────────────
    function paintChips() {
      chipsEl.innerHTML = state.aliasList.map(function (a, i) {
        return '<span class="ae-chip">' + esc(a) +
          '<button type="button" class="ae-chip-x" data-i="' + i + '" aria-label="' + esc(t('artists.editRemoveAlias')) + '">' +
          '<span class="material-symbols-rounded">close</span></button></span>';
      }).join('');
      chipsEl.hidden = state.aliasList.length === 0;
      aliasHint.textContent = state.customAliases ? t('artists.editAliasCustom') : t('artists.editAliasAuto');
      aliasReset.hidden = !state.customAliases;
    }

    function addAlias(raw) {
      var v = String(raw || '').replace(/\s+/g, ' ').trim();
      if (!v) return;
      var lower = v.toLowerCase();
      if (state.aliasList.some(function (a) { return String(a).toLowerCase() === lower; })) return;
      state.aliasList.push(v);
      state.customAliases = true;
      paintChips();
    }

    chipsEl.addEventListener('click', function (e) {
      var btn = e.target.closest('.ae-chip-x');
      if (!btn) return;
      var i = parseInt(btn.dataset.i, 10);
      if (!isFinite(i)) return;
      state.aliasList.splice(i, 1);
      state.customAliases = true;
      paintChips();
    });

    aliasInput.addEventListener('keydown', function (e) {
      if (e.isComposing || e.keyCode === 229) return;
      if (e.key === 'Enter' || e.key === ',' || e.key === '，' || e.key === '、') {
        e.preventDefault();
        addAlias(aliasInput.value);
        aliasInput.value = '';
      } else if (e.key === 'Backspace' && !aliasInput.value && state.aliasList.length) {
        state.aliasList.pop();
        state.customAliases = true;
        paintChips();
      }
    });
    aliasInput.addEventListener('blur', function () {
      if (aliasInput.value.trim()) { addAlias(aliasInput.value); aliasInput.value = ''; }
    });

    aliasReset.addEventListener('click', function () {
      state.customAliases = false;
      state.aliasList = state.autoAliases.slice();
      paintChips();
    });

    function renderAliasCandidates() {
      aliasCandsEl.innerHTML = '';
      if (!state.candDone) { aliasCandsEl.appendChild(loadingHint()); return; }
      var groups = (state.cand && state.cand.aliasGroups) || [];
      if (!groups.length) { aliasCandsEl.appendChild(emptyHint(t('artists.editNoCandidates'))); return; }
      groups.forEach(function (g) {
        var row = document.createElement('button');
        row.type = 'button';
        row.className = 'settings-row md-row-btn';
        row.innerHTML =
          '<span class="settings-row-body">' +
            '<span class="settings-row-label">' + esc(_sourceLabel(g.source)) + '</span>' +
            '<span class="settings-row-sub">' + esc(g.aliases.join(' · ')) + '</span>' +
          '</span>' +
          '<span class="settings-row-trailing">' +
            '<span class="material-symbols-rounded">chevron_right</span>' +
          '</span>';
        row.addEventListener('click', function () {
          state.customAliases = true;
          state.aliasList = g.aliases.slice();
          paintChips();
          flashStatus(t('artists.editApplied'));
        });
        aliasCandsEl.appendChild(row);
      });
    }

    // ── 介绍 ──────────────────────────────────────────────────────
    function paintBioHint() {
      bioHint.textContent = state.customBio ? t('artists.editBioCustom') : t('artists.editBioAuto');
      bioReset.hidden = !state.customBio;
    }
    // 只在这里写 textarea.value：输入过程中再赋值会打断中文输入法的组合状态
    function paintBio() {
      bioEl.value = state.bio;
      paintBioHint();
    }

    bioEl.addEventListener('input', function () {
      state.bio = bioEl.value;
      state.customBio = state.bio.trim() !== state.autoBio.trim();
      paintBioHint();
    });
    bioReset.addEventListener('click', function () {
      state.customBio = false;
      state.bio = state.autoBio;
      paintBio();
    });

    function renderBioCandidates() {
      bioCandsEl.innerHTML = '';
      if (!state.candDone) { bioCandsEl.appendChild(loadingHint()); return; }
      var bios = (state.cand && state.cand.bios) || [];
      if (!bios.length) { bioCandsEl.appendChild(emptyHint(t('artists.editNoCandidates'))); return; }
      bios.forEach(function (b) {
        var snippet = b.text.length > 76 ? b.text.slice(0, 76) + '…' : b.text;
        var row = document.createElement('button');
        row.type = 'button';
        row.className = 'settings-row md-row-btn';
        row.innerHTML =
          '<span class="settings-row-body">' +
            '<span class="settings-row-label">' + esc(_sourceLabel(b.source)) + '</span>' +
            '<span class="settings-row-sub">' + esc(snippet) + '</span>' +
          '</span>' +
          '<span class="settings-row-trailing">' +
            '<span class="material-symbols-rounded">chevron_right</span>' +
          '</span>';
        row.addEventListener('click', function () {
          state.customBio = true;
          state.bio = b.text;
          paintBio();
          flashStatus(t('artists.editApplied'));
        });
        bioCandsEl.appendChild(row);
      });
    }

    // ── 首屏 ──────────────────────────────────────────────────────
    paintAvatar();
    paintImageState();
    paintChips();
    paintBio();
    renderImageCandidates();
    renderAliasCandidates();
    renderBioCandidates();

    function paintAllCandidates() {
      renderImageCandidates();
      renderAliasCandidates();
      renderBioCandidates();
    }

    function loadCandidates() {
      if (!base) {
        state.candDone = true;
        paintAllCandidates();
        return;
      }
      state.candDone = false;
      state.cand = null;
      paintAllCandidates();
      fetch(base + '/artist-candidates/' + encodeURIComponent(name))
        .then(function (r) {
          if (!r.ok) throw new Error('HTTP ' + r.status);
          return r.json();
        })
        .then(function (data) {
          if (closed) return;
          state.cand = data || null;
          state.candDone = true;
          paintAllCandidates();
        })
        .catch(function () {
          if (closed) return;
          state.cand = null;
          state.candDone = true;
          paintAllCandidates();
        });
    }

    loadCandidates();

    function close() {
      if (closed) return;
      closed = true;
      overlay.classList.remove('open');
      document.removeEventListener('keydown', onKey);
      setTimeout(function () {
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      }, 180);
    }

    function save() {
      var patch = {
        aliases: state.customAliases ? state.aliasList : null,
        bio: state.customBio ? state.bio : null,
      };
      App.utils.call('save_artist_override', name, JSON.stringify(patch)).then(function (raw) {
        var res = {};
        try { res = JSON.parse(raw) || {}; } catch (e) {  }
        if (!res.ok) { flashStatus(t('artists.editSaveFailed')); return; }
        close();
        App.utils.toast(t('artists.editSaved'));

        // 先用对话框里的结果就地画一遍：自动值那条路还得回服务端取，
        // 直接等请求会有一段「保存了却看不到变化」的空窗。
        _paintAliasChips(state.customAliases ? state.aliasList : state.autoAliases);
        _paintBio(state.customBio ? state.bio : state.autoBio);
        _refreshArtistMeta(artist, true);
      });
    }

    function onKey(e) {
      if (e.key === 'Escape') close();
      else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save();
    }

    dlg.querySelector('.cmd-dialog-btn--cancel').addEventListener('click', close);
    dlg.querySelector('.cmd-dialog-btn--confirm').addEventListener('click', save);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });
    document.addEventListener('keydown', onKey);
  }

  function _renderSongsPanel() {
    var listEl = document.getElementById('artist-songs-list');
    if (!listEl) return;

    listEl.innerHTML = '';

    if (_allArtistTracks.length === 0) {
      listEl.innerHTML =
        '<div class="artist-album-empty">' + App.i18n.t('artists.noTracks') + '</div>';
      return;
    }

    var frag = document.createDocumentFragment();
    _allArtistTracks.forEach(function (track, i) {
      var li = App.utils.trackRow(track, i + 1, function (clickedTrack, idx) {
        App.backend.play_from_list(JSON.stringify(_allArtistTracks), idx);
      }, true, i);
      frag.appendChild(li);
    });
    listEl.appendChild(frag);
  }

  function _renderAlbumsPanel() {
    var gridEl = document.getElementById('artist-album-grid');
    if (!gridEl) return;
    gridEl.innerHTML = '';

    if (_allArtistAlbums.length === 0) {
      gridEl.innerHTML =
        '<div class="artist-album-empty">' + App.i18n.t('artists.noTracks') + '</div>';
      return;
    }

    var frag = document.createDocumentFragment();
    _allArtistAlbums.forEach(function (album) {
      var card = document.createElement('div');
      card.className = 'album-card';

      var coverHtml = '';
      if (album.cover_track_id) {
        coverHtml = '<img src="' + window.coverUrl(album.cover_track_id, 512) + '" alt="" loading="lazy">';
      } else {
        var bg = App.utils.hashColor(album.name);
        coverHtml =
          '<div style="width:100%; height:100%; background:' + bg + '; display:flex; align-items:center; justify-content:center;">' +
            '<span class="album-cover-letter">' + App.utils.initial(album.name) + '</span>' +
          '</div>';
      }

      card.innerHTML =
        '<div class="album-cover">' + coverHtml + '</div>' +
        '<div class="album-info">' +
          '<p class="album-name">' + App.utils.esc(album.name) + '</p>' +
          '<p class="album-meta">' + (album.year || '?') + ' · ' + App.i18n.t('albums.trackCountShort', { count: album.track_count }) + '</p>' +
        '</div>';

      card.addEventListener('click', function () {
        App.navigate('albums', { album: album.name, album_artist: _currentArtistName });
      });
      frag.appendChild(card);
    });
    gridEl.appendChild(frag);
  }

  page.updatePlayState = function () {

    var list = document.getElementById('artist-songs-list');
    if (!list) return;
    var currentId = App.state.currentTrack ? App.state.currentTrack.id : null;
    Array.prototype.forEach.call(list.children, function (li) {
      if (li.dataset.trackId === currentId) {
        li.classList.add('playing');
      } else {
        li.classList.remove('playing');
      }
    });
  };

})();
