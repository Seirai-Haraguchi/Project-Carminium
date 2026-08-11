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

  // ── 排除筛选状态 ──
  let _excludedArtists = new Set();       // 艺术家名
  let _excludedAlbums  = new Set();       // key: "album|||album_artist"
  let _excludedServers = new Set();       // server_id (string)
  let _excludedUsernames = new Set();     // subsonic username
  let _excludedPlaylists = new Set();     // playlist_id (string)
  let _playlistTrackMap = null;           // { playlistId: Set(trackId) } 懒加载
  let _filterStateLoaded = false;          // 标记是否已从设置加载过筛选状态

  // ── 虚拟滚动实例 & 扁平化渲染数据 ──
  let _vl = null;
  let _flatList = [];
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

  // 筛选分类配置
  const FILTER_CATEGORIES = [
    { key: 'artist',   labelKey: 'music.excludeArtist',   icon: 'person' },
    { key: 'album',    labelKey: 'music.excludeAlbum',    icon: 'album' },
    { key: 'server',   labelKey: 'music.excludeServer',   icon: 'cloud' },
    { key: 'username', labelKey: 'music.excludeUsername', icon: 'alternate_email' },
    { key: 'playlist', labelKey: 'music.excludePlaylist', icon: 'playlist_play' },
  ];

  function _loadFromCache() {
    allTracks = (App.state && App.state.allTracks) ? App.state.allTracks : [];
  }

  // ── 筛选状态持久化 ──
  function _saveFilterState() {
    var state = {
      artists: Array.from(_excludedArtists),
      albums: Array.from(_excludedAlbums),
      servers: Array.from(_excludedServers),
      usernames: Array.from(_excludedUsernames),
      playlists: Array.from(_excludedPlaylists),
    };
    try {
      App.utils.call('save_settings', JSON.stringify({ music_filter_state: state }));
    } catch (e) { /* ignore */ }
  }

  function _loadFilterState() {
    if (_filterStateLoaded) return Promise.resolve();
    _filterStateLoaded = true;
    return App.utils.call('get_settings').then(function (res) {
      try {
        var settings = JSON.parse(res);
        var raw = settings.music_filter_state;
        if (!raw) return;
        if (raw.artists) _excludedArtists = new Set(raw.artists);
        if (raw.albums) _excludedAlbums = new Set(raw.albums);
        if (raw.servers) _excludedServers = new Set(raw.servers);
        if (raw.usernames) _excludedUsernames = new Set(raw.usernames);
        if (raw.playlists) _excludedPlaylists = new Set(raw.playlists);
      } catch (e) { /* ignore */ }
    }).catch(function () { /* ignore */ });
  }

  // ── 分类数据获取 ──
  function _getArtistList() {
    const set = new Set();
    allTracks.forEach(t => {
      if (t.artist) (t.artists || [t.artist]).forEach(a => set.add(a));
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }

  function _getAlbumList() {
    const map = new Map();
    allTracks.forEach(t => {
      if (t.album) {
        const aa = t.album_artist || t.artist || '';
        const key = t.album + '|||' + aa;
        if (!map.has(key)) map.set(key, { album: t.album, album_artist: aa });
      }
    });
    return Array.from(map.values()).sort((a, b) => a.album.localeCompare(b.album));
  }

  function _getServerList() {
    const servers = (App.state && App.state.allSubsonicServers) ? App.state.allSubsonicServers : [];
    return servers.map(s => ({ id: String(s.id), name: s.name, username: s.username || '' }));
  }

  function _getUsernameList() {
    const servers = _getServerList();
    const set = new Set();
    servers.forEach(s => { if (s.username) set.add(s.username); });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }

  function _getPlaylistList() {
    const playlists = (App.state && App.state.allPlaylists) ? App.state.allPlaylists : [];
    return playlists.map(p => ({ id: String(p.id), name: p.name, track_count: p.track_count || 0 }));
  }

  // ── 懒加载歌单曲目映射 ──
  function _ensurePlaylistTrackMap() {
    if (_playlistTrackMap) return Promise.resolve(_playlistTrackMap);
    return App.utils.call('get_all_playlist_track_ids').then(function (res) {
      const raw = JSON.parse(res);
      _playlistTrackMap = {};
      for (const k in raw) {
        _playlistTrackMap[k] = new Set(raw[k]);
      }
      return _playlistTrackMap;
    });
  }

  // ── 判断曲目是否被排除 ──
  function _isExcluded(track) {
    if (_excludedArtists.size > 0 && track.artist) {
      const artists = track.artists || [track.artist];
      for (const a of artists) {
        if (_excludedArtists.has(a)) return true;
      }
    }
    if (_excludedAlbums.size > 0 && track.album) {
      const aa = track.album_artist || track.artist || '';
      const key = track.album + '|||' + aa;
      if (_excludedAlbums.has(key)) return true;
    }
    if (_excludedServers.size > 0 && track.source === 'subsonic' && track.server_id != null) {
      if (_excludedServers.has(String(track.server_id))) return true;
    }
    if (_excludedUsernames.size > 0 && track.source === 'subsonic' && track.server_id != null) {
      const servers = _getServerList();
      const srv = servers.find(s => s.id === String(track.server_id));
      if (srv && srv.username && _excludedUsernames.has(srv.username)) return true;
    }
    if (_excludedPlaylists.size > 0 && _playlistTrackMap && track.id) {
      for (const pid of _excludedPlaylists) {
        const set = _playlistTrackMap[pid];
        if (set && set.has(track.id)) return true;
      }
    }
    return false;
  }

  function _hasExclusions() {
    return _excludedArtists.size > 0 || _excludedAlbums.size > 0 ||
           _excludedServers.size > 0 || _excludedUsernames.size > 0 ||
           _excludedPlaylists.size > 0;
  }

  // ── 页面渲染 ──
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
          <button class="icon-btn music-filter-btn" id="btn-music-filter" data-i18n-title="music.filter" data-i18n-aria-label="music.filter" title="筛选">
            <span class="material-symbols-rounded">filter_alt</span>
          </button>
        </div>
        <div class="music-filter-chips" id="music-filter-chips"></div>
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
      if (_renderedTracks.length > 0) {
        App.backend.play_from_list(JSON.stringify(_renderedTracks), 0);
      }
    });

    document.getElementById('btn-music-filter').addEventListener('click', function () {
      _openFilterDialog();
    });

    _setupSortSelect();
    _loadFromCache();
    _updateCount();
    _renderFilterChips();
    _renderList();

    // 异步加载持久化筛选状态，加载后重新渲染
    _loadFilterState().then(function () {
      _updateCount();
      _renderFilterChips();
      _renderList();
    });
  };

  // ════════════════════════════════════════════════════════════════
  //  筛选 Dialog
  // ════════════════════════════════════════════════════════════════

  function _openFilterDialog() {
    // 先确保歌单数据加载
    _ensurePlaylistTrackMap().then(function () {
      _buildFilterDialog();
    }).catch(function () {
      _buildFilterDialog();
    });
  }

  function _buildFilterDialog() {
    // 移除已有的
    _closeFilterDialog();

    let activeCategory = 'artist';
    let dialogSearchText = '';
    let _lastCheckedIdx = -1; // shift 多选：上次勾选的索引

    // ── 创建 overlay ──
    const overlay = document.createElement('div');
    overlay.className = 'mf-dialog-overlay';
    overlay.id = 'mf-dialog-overlay';

    overlay.innerHTML = `
      <div class="mf-dialog" role="dialog" aria-modal="true">
        <div class="mf-dialog-header">
          <h2 class="mf-dialog-title" data-i18n="music.filter">${App.i18n.t('music.filter')}</h2>
          <button class="icon-btn" id="mf-dialog-close">
            <span class="material-symbols-rounded">close</span>
          </button>
        </div>

        <div class="mf-dialog-search">
          <span class="material-symbols-rounded">search</span>
          <input type="text" id="mf-dialog-search-input" data-i18n-placeholder="music.searchFilterItems" placeholder="搜索排除项…">
        </div>

        <div class="mf-dialog-body">
          <div class="mf-category-tabs" id="mf-category-tabs">
            ${FILTER_CATEGORIES.map(cat => {
              const count = _getCategoryCount(cat.key);
              return `
                <button class="mf-category-tab ${cat.key === activeCategory ? 'active' : ''}" data-category="${cat.key}">
                  <span class="material-symbols-rounded">${cat.icon}</span>
                  <span class="mf-category-tab-label">${App.i18n.t(cat.labelKey)}</span>
                  ${count > 0 ? `<span class="mf-category-tab-badge">${count}</span>` : ''}
                </button>
              `;
            }).join('')}
          </div>
          <div class="mf-category-content" id="mf-category-content">
            <!-- 动态填充 -->
          </div>
        </div>

        <div class="mf-dialog-footer">
          <button class="cmd-dialog-btn cmd-dialog-btn--cancel" id="mf-dialog-clear" data-i18n="music.clearFilters">${App.i18n.t('music.clearFilters')}</button>
          <button class="cmd-dialog-btn cmd-dialog-btn--confirm" id="mf-dialog-apply" data-i18n="common.confirm">${App.i18n.t('common.confirm')}</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);
    requestAnimationFrame(function () { overlay.classList.add('open'); });

    // ── 渲染分类内容 ──
    function renderContent() {
      const contentEl = overlay.querySelector('#mf-category-content');
      const items = _getCategoryItems(activeCategory);
      const q = dialogSearchText.trim().toLowerCase();

      const filtered = q ? items.filter(item => item.label.toLowerCase().includes(q)) : items;

      if (filtered.length === 0) {
        contentEl.innerHTML = `
          <div class="mf-empty">
            <span class="material-symbols-rounded">search_off</span>
            <span data-i18n="common.noResults">${App.i18n.t('common.noResults')}</span>
          </div>
        `;
        return;
      }

      contentEl.innerHTML = filtered.map(item => {
        const checked = _isItemExcluded(activeCategory, item.value);
        return `
          <label class="mf-check-item ${checked ? 'checked' : ''}">
            <input type="checkbox" value="${App.utils.esc(item.value)}" ${checked ? 'checked' : ''}>
            <span class="mf-check-item-icon material-symbols-rounded">${item.icon || 'circle'}</span>
            <span class="mf-check-item-label">${App.utils.esc(item.label)}</span>
            ${item.sub ? `<span class="mf-check-item-sub">${App.utils.esc(item.sub)}</span>` : ''}
          </label>
        `;
      }).join('');

      // 绑定 checkbox 事件（支持 shift 多选）
      const checkboxes = Array.from(contentEl.querySelectorAll('.mf-check-item input[type="checkbox"]'));
      let _shiftActive = false;

      checkboxes.forEach(function (cb, idx) {
        cb.addEventListener('click', function (e) {
          if (e.shiftKey && _lastCheckedIdx >= 0 && _lastCheckedIdx !== idx) {
            _shiftActive = true;
            // cb.checked 此时已是 toggle 后的新状态
            var targetChecked = cb.checked;
            var start = Math.min(_lastCheckedIdx, idx);
            var end = Math.max(_lastCheckedIdx, idx);
            for (var i = start; i <= end; i++) {
              var item = checkboxes[i];
              item.checked = targetChecked;
              var label = item.closest('.mf-check-item');
              if (targetChecked) {
                label.classList.add('checked');
                _setItemExcluded(activeCategory, item.value, true);
              } else {
                label.classList.remove('checked');
                _setItemExcluded(activeCategory, item.value, false);
              }
            }
            _updateTabBadges();
          }
          _lastCheckedIdx = idx;
        });

        cb.addEventListener('change', function () {
          if (_shiftActive) {
            _shiftActive = false;
            return; // shift 范围已在 click 中处理
          }
          var label = this.closest('.mf-check-item');
          if (this.checked) {
            label.classList.add('checked');
            _setItemExcluded(activeCategory, this.value, true);
          } else {
            label.classList.remove('checked');
            _setItemExcluded(activeCategory, this.value, false);
          }
          _updateTabBadges();
        });
      });
    }

    function _updateTabBadges() {
      overlay.querySelectorAll('.mf-category-tab').forEach(tab => {
        const cat = tab.dataset.category;
        const count = _getCategoryCount(cat);
        let badge = tab.querySelector('.mf-category-tab-badge');
        if (count > 0) {
          if (!badge) {
            badge = document.createElement('span');
            badge.className = 'mf-category-tab-badge';
            tab.appendChild(badge);
          }
          badge.textContent = count;
        } else if (badge) {
          badge.remove();
        }
      });
    }

    // ── 分类切换 ──
    overlay.querySelectorAll('.mf-category-tab').forEach(tab => {
      tab.addEventListener('click', function () {
        activeCategory = this.dataset.category;
        _lastCheckedIdx = -1;
        overlay.querySelectorAll('.mf-category-tab').forEach(t => t.classList.remove('active'));
        this.classList.add('active');
        dialogSearchText = '';
        const searchInput = overlay.querySelector('#mf-dialog-search-input');
        if (searchInput) searchInput.value = '';
        renderContent();
      });
    });

    // ── 搜索 ──
    overlay.querySelector('#mf-dialog-search-input').addEventListener('input', function (e) {
      dialogSearchText = e.target.value;
      _lastCheckedIdx = -1;
      renderContent();
    });

    // 统一的关闭+应用函数
    function _applyAndClose() {
      _closeFilterDialog();
      _saveFilterState();
      _updateCount();
      _renderFilterChips();
      _renderList();
      document.removeEventListener('keydown', onKeydown);
    }

    // ── 关闭按钮 ──
    overlay.querySelector('#mf-dialog-close').addEventListener('click', _applyAndClose);

    // ── 清除全部 ──
    overlay.querySelector('#mf-dialog-clear').addEventListener('click', function () {
      _excludedArtists.clear();
      _excludedAlbums.clear();
      _excludedServers.clear();
      _excludedUsernames.clear();
      _excludedPlaylists.clear();
      _saveFilterState();
      renderContent();
      _updateTabBadges();
    });

    // ── 应用按钮 ──
    overlay.querySelector('#mf-dialog-apply').addEventListener('click', _applyAndClose);

    // ── 点击 overlay 背景关闭 ──
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) _applyAndClose();
    });

    // ── ESC 关闭 ──
    function onKeydown(e) {
      if (e.key === 'Escape') _applyAndClose();
    }
    document.addEventListener('keydown', onKeydown);

    // 初次渲染
    renderContent();

    // 聚焦搜索框
    setTimeout(function () {
      const si = overlay.querySelector('#mf-dialog-search-input');
      if (si) si.focus();
    }, 100);
  }

  function _closeFilterDialog() {
    const overlay = document.getElementById('mf-dialog-overlay');
    if (overlay) {
      overlay.classList.remove('open');
      setTimeout(function () { overlay.remove(); }, 200);
    }
  }

  // ── 获取分类下所有可选项 ──
  function _getCategoryItems(category) {
    switch (category) {
      case 'artist': {
        return _getArtistList().map(a => ({ value: a, label: a, icon: 'person' }));
      }
      case 'album': {
        return _getAlbumList().map(a => ({
          value: a.album + '|||' + a.album_artist,
          label: a.album,
          sub: a.album_artist || '',
          icon: 'album',
        }));
      }
      case 'server': {
        return _getServerList().map(s => ({
          value: s.id,
          label: s.name,
          sub: s.username || '',
          icon: 'cloud',
        }));
      }
      case 'username': {
        return _getUsernameList().map(u => ({ value: u, label: u, icon: 'alternate_email' }));
      }
      case 'playlist': {
        return _getPlaylistList().map(p => ({
          value: p.id,
          label: p.name,
          sub: p.track_count + ' ' + App.i18n.t('music.tracks'),
          icon: 'playlist_play',
        }));
      }
    }
    return [];
  }

  // ── 判断项是否被排除 ──
  function _isItemExcluded(category, value) {
    switch (category) {
      case 'artist':   return _excludedArtists.has(value);
      case 'album':    return _excludedAlbums.has(value);
      case 'server':   return _excludedServers.has(value);
      case 'username': return _excludedUsernames.has(value);
      case 'playlist': return _excludedPlaylists.has(value);
    }
    return false;
  }

  // ── 设置项排除状态 ──
  function _setItemExcluded(category, value, excluded) {
    const set = _getCategorySet(category);
    if (excluded) set.add(value);
    else set.delete(value);
  }

  function _getCategorySet(category) {
    switch (category) {
      case 'artist':   return _excludedArtists;
      case 'album':    return _excludedAlbums;
      case 'server':   return _excludedServers;
      case 'username': return _excludedUsernames;
      case 'playlist': return _excludedPlaylists;
    }
    return new Set();
  }

  function _getCategoryCount(category) {
    return _getCategorySet(category).size;
  }

  // ── 渲染筛选 chips ──
  function _renderFilterChips() {
    const container = document.getElementById('music-filter-chips');
    if (!container) return;

    if (!_hasExclusions()) {
      container.innerHTML = '';
      container.style.display = 'none';
      return;
    }

    container.style.display = 'flex';
    const chips = [];

    _excludedArtists.forEach(artist => {
      chips.push({ type: 'artist', value: artist, label: artist, icon: 'person' });
    });
    _excludedAlbums.forEach(key => {
      const parts = key.split('|||');
      chips.push({ type: 'album', value: key, label: parts[0] + (parts[1] ? ' — ' + parts[1] : ''), icon: 'album' });
    });
    _excludedServers.forEach(sid => {
      const srv = _getServerList().find(s => s.id === sid);
      chips.push({ type: 'server', value: sid, label: srv ? srv.name : sid, icon: 'cloud' });
    });
    _excludedUsernames.forEach(u => {
      chips.push({ type: 'username', value: u, label: u, icon: 'alternate_email' });
    });
    _excludedPlaylists.forEach(pid => {
      const pl = _getPlaylistList().find(p => p.id === pid);
      chips.push({ type: 'playlist', value: pid, label: pl ? pl.name : pid, icon: 'playlist_play' });
    });

    container.style.display = 'flex';

    if (chips.length > 3) {
      // 超过3个：显示前3个 chip + 汇总文字
      const visible = chips.slice(0, 3);
      container.innerHTML = visible.map(chip => `
        <div class="chip music-filter-chip" data-type="${chip.type}" data-value="${App.utils.esc(chip.value)}">
          <span class="material-symbols-rounded" style="font-size:16px;">${chip.icon}</span>
          <span>${App.utils.esc(chip.label)}</span>
          <span class="material-symbols-rounded music-filter-chip-remove" style="font-size:16px;cursor:pointer;">close</span>
        </div>
      `).join('') + `
        <span class="music-filter-summary">${App.i18n.t('music.filterSummary', { count: chips.length })}</span>
      `;
    } else {
      container.innerHTML = chips.map(chip => `
        <div class="chip music-filter-chip" data-type="${chip.type}" data-value="${App.utils.esc(chip.value)}">
          <span class="material-symbols-rounded" style="font-size:16px;">${chip.icon}</span>
          <span>${App.utils.esc(chip.label)}</span>
          <span class="material-symbols-rounded music-filter-chip-remove" style="font-size:16px;cursor:pointer;">close</span>
        </div>
      `).join('');
    }

    container.querySelectorAll('.music-filter-chip-remove').forEach(function (removeBtn) {
      removeBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        const chip = this.closest('.music-filter-chip');
        if (!chip) return;
        const type = chip.dataset.type;
        const value = chip.dataset.value;
        _setItemExcluded(type, value, false);
        _saveFilterState();
        _updateCount();
        _renderFilterChips();
        _renderList();
      });
    });
  }

  function _updateCount() {
    const countEl = document.getElementById('music-count');
    if (!countEl) return;
    if (_hasExclusions()) {
      const filtered = allTracks.filter(t => !_isExcluded(t));
      countEl.textContent = App.i18n.t('music.trackCount', { count: filtered.length }) +
        ' / ' + App.i18n.t('music.trackCount', { count: allTracks.length });
    } else {
      countEl.textContent = App.i18n.t('music.trackCount', { count: allTracks.length });
    }
  }

  // ── 排序选择器 ──
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
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleMenu(); }
      else if (e.key === 'Escape') { closeMenu(); }
    });

    menu.querySelectorAll('.md-select-option').forEach(option => {
      option.addEventListener('click', function () {
        const newSort = this.dataset.value;
        if (newSort && newSort !== sortMode) {
          sortMode = newSort;
          const opt = SORT_OPTIONS.find(o => o.key === sortMode);
          if (opt) {
            select.querySelector('.md-select-icon').textContent = opt.icon;
            select.querySelector('.md-select-label').textContent = opt.label;
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
          _renderList();
        }
        closeMenu();
      });
    });

    document.addEventListener('click', function (e) {
      if (!select.contains(e.target)) closeMenu();
    });
  }

  page.updatePlayState = function () {
    const list = document.getElementById('music-list');
    if (!list) return;
    const currentId = App.state.currentTrack ? App.state.currentTrack.id : null;
    const rows = list.querySelectorAll('.vl-track-row-wrapper, [data-track-id]');
    rows.forEach(li => {
      if (li.dataset.trackId === currentId) li.classList.add('playing');
      else li.classList.remove('playing');
    });
  };

  // Release the virtual-list wrapper objects before a library refresh. The
  // shared track array is repopulated by App.refreshLibraryCache(), and the
  // visible page is rendered again after that completes.
  page.releaseLibraryViewMemory = function () {
    if (_vl) { _vl.destroy(); _vl = null; }
    if (window.CoverCache && window.CoverCache.clearViewport) {
      window.CoverCache.clearViewport();
    }
    _flatList = [];
    _renderedTracks = [];
  };

  function _sortTracks(list) {
    // Callers already own a filtered/copy array. Sorting it in place avoids
    // retaining a second full reference array for large libraries.
    const sorted = list;
    switch (sortMode) {
      case 'az':
        sorted.sort((a, b) => App.utils.itemSortKey(a, 'sort_key', 'title').localeCompare(App.utils.itemSortKey(b, 'sort_key', 'title')));
        break;
      case 'za':
        sorted.sort((a, b) => App.utils.itemSortKey(b, 'sort_key', 'title').localeCompare(App.utils.itemSortKey(a, 'sort_key', 'title')));
        break;
      case 'artist':
        sorted.sort((a, b) => {
          const aa = App.utils.itemSortKey(a, 'artist_sort_key', 'artist');
          const ab = App.utils.itemSortKey(b, 'artist_sort_key', 'artist');
          if (aa !== ab) return aa.localeCompare(ab);
          return App.utils.itemSortKey(a, 'sort_key', 'title').localeCompare(App.utils.itemSortKey(b, 'sort_key', 'title'));
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
          const ya = a.year || 0, yb = b.year || 0;
          if (ya !== yb) return yb - ya;
          return App.utils.itemSortKey(a, 'sort_key', 'title').localeCompare(App.utils.itemSortKey(b, 'sort_key', 'title'));
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

    // 1. 排除筛选
    let list = _hasExclusions() ? allTracks.filter(t => !_isExcluded(t)) : allTracks.slice();

    // 2. 搜索词过滤
    if (filterStr) {
      list = list.filter(t => {
        const q = filterStr;
        return (t.title && t.title.toLowerCase().includes(q)) ||
               (t.artist && t.artist.toLowerCase().includes(q)) ||
               (t.album && t.album.toLowerCase().includes(q));
      });
    }

    // 3. 排序
    list = _sortTracks(list);

    if (list.length === 0) {
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
      if (App.i18n && App.i18n.applyToDOM) App.i18n.applyToDOM(ul);
      return;
    }

    const showGroup = !filterStr && !_hasExclusions();

    _flatList = [];
    _renderedTracks = list;
    let counter = 0;
    let previousGroupKey = null;
    list.forEach(function (track) {
      if (showGroup) {
        const groupKey = _getGroupKey(track);
        if (groupKey !== previousGroupKey) {
          _flatList.push({ type: 'header', letter: groupKey });
          previousGroupKey = groupKey;
        }
      }
      counter++;
      _flatList.push({ type: 'row', track: track, displayNum: counter });
    });

    if (_vl) { _vl.destroy(); _vl = null; }
    ul.classList.add('az-list');
    ul.innerHTML = '';

    // 重置滚动位置，避免新 VL 渲染顶部位移但视口仍在下方导致空白
    var scrollContainer = document.getElementById('content-pane');
    if (scrollContainer) scrollContainer.scrollTop = 0;

    _vl = new window.VirtualList({
      container: ul,
      scrollContainer: document.getElementById('content-pane'),
      items: _flatList,
      itemHeight: ROW_HEIGHT,
      estimatedItemHeight: ROW_HEIGHT,
      getHeight: function (item) { return item.type === 'header' ? HEADER_HEIGHT : ROW_HEIGHT; },
      bufferSize: 8,
      onRangeChange: function (items, startIndex, endIndex, direction) {
        if (window.CoverCache && window.CoverCache.updateViewport) {
          window.CoverCache.updateViewport(items, startIndex, endIndex, direction, 128);
        }
      },
      onRecycle: function (el) {
        if (window.CoverCache && window.CoverCache.releaseElement) {
          window.CoverCache.releaseElement(el);
        }
      },
      renderItem: function (item, index, el) {
        if (item.type === 'header') {
          el.className = 'az-section-header vl-item';
          el.innerHTML = '<span class="az-section-letter">' + item.letter + '</span>';
          el.removeAttribute('data-track-id');
        } else {
          const track = item.track;
          const displayNum = item.displayNum;
          const li = App.utils.trackRow(track, displayNum, function (clickedTrack, idx) {
            const playIdx = _renderedTracks.indexOf(clickedTrack);
            App.backend.play_from_list(JSON.stringify(_renderedTracks), playIdx);
          }, true);
          el.className = 'vl-track-row-wrapper';
          el.innerHTML = '';
          el.appendChild(li);
          el.dataset.trackId = track.id;
        }
      },
    });
  }

})();
