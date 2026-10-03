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

  // ── 别名搜索（"用别名搜到这个人"）──
  // 本名匹配在前端同步完成；别名命中由 cover-server 的别名索引异步返回，
  // 防抖 250ms + 序号防陈旧，命中后并入结果列表重渲染。
  let _aliasMatchNames = null;  // Set<艺人名小写>：别名命中的艺人
  let _aliasMatchQuery = '';    // _aliasMatchNames 对应的 filterStr
  let _aliasFetchTimer = null;
  let _aliasFetchSeq = 0;

  // ── 虚拟滚动实例 ──
  let _vl = null;
  // _flatList: [{ type:'header', letter } | { type:'row', artist }]
  let _flatList = [];
  const ROW_HEIGHT = 64; // 艺术家行比曲目行稍高（头像 + padding）

  // ── 艺人头像探测结果缓存 ──
  // 原实现每次行被渲染都 new Image() 探测一次。长列表来回滚动时，
  // 同一艺人被反复探测 → 每次都产生一次图片请求/解码与 promise 回调。
  // 服务端对 /artist-image/ 返回 max-age=86400，Chromium HTTP 缓存本身能挡住
  // 网络往返，但解码与 JS 回调仍重复发生。这里按艺人名缓存结论：
  //   'ok'   → 已确认在线有图，直接贴图
  //   'miss' → 已确认无图，永久保持纯色 + 首字母（不再发探测）
  // 键为艺人名；艺人名即缓存键，与服务端 md5(lower(name)) 一致。
  const _avatarProbeCache = new Map();

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

  // 排序选项配置
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
    // 防抖：每敲一个字符都会触发「过滤全量艺人 + 排序 + 重建扁平列表」，
    // 与music 页同理。180ms 静默后才渲染，交互体感与原生搜索框一致。
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
            select.querySelector('.md-select-label').textContent = opt.labelKey ? App.i18n.t(opt.labelKey) : opt.label;
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

    let list = filterStr ? allArtists.filter(a => App.utils.matchItem(filterStr, a, [
      { text: 'name', key: 'sort_key' },
    ])) : allArtists;

    // ── 别名命中合并 ──
    if (filterStr) {
      if (_aliasMatchQuery !== filterStr) {
        // 新查询：重置别名命中并发起防抖检索
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
              if (seq !== _aliasFetchSeq) return;  // 输入已变化，丢弃陈旧结果
              _aliasMatchNames = new Set((names || []).map(function (n) { return String(n).toLowerCase(); }));
              if (filterStr === q) _renderList(container);  // 仍在同一查询：并入重渲染
            })
            .catch(function () { /* 别名服务不可用：仅本名搜索 */ });
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
      // 清空搜索：复位别名状态
      _aliasMatchNames = null;
      _aliasMatchQuery = '';
      _aliasFetchSeq++;
      if (_aliasFetchTimer) { clearTimeout(_aliasFetchTimer); _aliasFetchTimer = null; }
    }

    // 应用排序
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

    // 根据排序模式生成分组
    const groups = filterStr ? [{ letter: '', items: list }] : _groupArtists(list);

    // ── 扁平化为虚拟列表的渲染数据 ──
    _flatList = [];
    groups.forEach(group => {
      if (!filterStr) {
        _flatList.push({ type: 'header', letter: group.letter });
      }
      group.items.forEach(artist => {
        _flatList.push({ type: 'row', artist: artist });
      });
    });

    // ── 销毁旧实例，清空容器 ──
    // 复用策略与 music 页一致：优先 setItems 复用节点池，避免搜索/排序时
    // 反复重建 spacer/content 并丢弃约 60 个已建节点。
    // ⚠️ 必须校验 container 身份：离开页面再回来时列表元素是新的，
    // 旧实例挂在已脱离文档的节点上，直接 setItems 会让列表渲染到旧容器里
    // （表现为新列表空白 / content 层缺失）。
    const canReuse = _vl && _vl.container === listEl;
    if (!canReuse && _vl) { _vl.destroy(); _vl = null; }
    if (!canReuse) listEl.innerHTML = '';

    // 重置滚动位置（与原实现一致：换数据即回到顶部）
    const scRoll = document.getElementById('content-pane');
    if (scRoll) scRoll.scrollTop = 0;

    if (canReuse) {
      _vl.setItems(_flatList);
      return;
    }

    // ── 创建虚拟列表 ──
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
        } else {
          const artist = item.artist;
          el.className = 'artist-row vl-item';

          const name = artist.name || '';
          const bg = App.utils.hashColor(name);

          // 头像先落纯色 + 首字母占位，在线写真探测成功后再替换
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

          const url = (window.artistImageUrl && name) ? window.artistImageUrl(name) : null;
          const avEl = el.querySelector('.artist-avatar');
          if (url && avEl) {
            const state = _avatarProbeState(name, url);
            if (state === 'ok') {
              // 已确认在线有图：直接贴图，跳过一次 Image 探测往返
              _applyAvatar(avEl, name, url);
            } else if (state === 'miss') {
              // 已确认无图：保持纯色 + 首字母，不再发起探测
            } else {
              const probe = new Image();
              probe.onload = function () {
                _avatarProbeCache.set(name, 'ok');
                // 行可能已被回收给别的艺术家，只有仍是同一人才替换
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

  // 艺人详情页状态
  let _allArtistAlbums = [];  // 当前艺人所有专辑（含 tracks）
  let _allArtistTracks = [];  // 当前艺人全部曲目（含 tracks）
  let _currentArtistName = '';  // 当前艺人名（供专辑点击跳转使用）

  function _renderDetail(container, artist) {
    // 保存列表滚动位置，以便返回时恢复
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

    // 对动态插入的 DOM 应用 i18n 翻译
    if (App.i18n && App.i18n.applyToDOM) App.i18n.applyToDOM(container);

    const blurEl = document.getElementById('detail-cover-blur');
    const mainEl = document.getElementById('detail-avatar');
    const headerEl = container.querySelector('.detail-header');

    // 占位：纯色 + 首字母（在线头像加载前/失败后的干净状态，不使用专辑封面）
    const placeholderColor = App.utils.hashColor(artist.name);
    const initial = App.utils.initial(artist.name);
    blurEl.style.background = placeholderColor;
    mainEl.style.background = placeholderColor;
    mainEl.innerHTML = `<span style="font-size:48px; color:#fff; font-weight:700;">${initial}</span>`;

    // 从前端 allTracks 缓存过滤艺术家曲目
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
    _allArtistTracks = tracks;  // 供下方歌曲预览使用（模块级，跨函数可见）
    _currentArtistName = artist.name;  // 供专辑点击跳转使用

    // ── 按专辑分组 ──
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

    // ── 渲染：pivot 两页（歌曲 / 专辑）──
    _renderSongsPanel();
    _renderAlbumsPanel();
    _setupPivot();

    // ── 播放全部 ──
    document.getElementById('btn-play-artist').addEventListener('click', function () {
      App.backend.play_from_list(JSON.stringify(tracks), 0);
    });

    // ── Apple Music 式横幅头图（hero）──
    // 只在拿到真正的横版艺人图（/artist-banner/，TheAudioDB Fanart 1280x720）时触发；
    // 方形头像绝不放大铺横幅（居中裁切会切掉头部/人脸），保持原紧凑头部。
    var heroApplied = false;
    var applyHero = function (url) {
      if (heroApplied) {
        // 已是 hero：新的横版源到达时原地升级替换背景
        if (!url) return;
        var imgEl = headerEl.querySelector('.detail-hero-img');
        if (imgEl) imgEl.style.backgroundImage = 'url(' + url + ')';
        return;
      }
      heroApplied = true;
      headerEl.classList.add('hero');
      var heroImg = document.createElement('div');
      heroImg.className = 'detail-hero-img';
      heroImg.style.background = placeholderColor; // 加载期兜底底色
      if (url) heroImg.style.backgroundImage = 'url(' + url + ')';
      headerEl.insertBefore(heroImg, headerEl.firstChild);
    };

    var aUrl = (window.artistImageUrl && artist.name) ? window.artistImageUrl(artist.name) : null;
    var bUrl = (artist.name && typeof window.__coverBase === 'string')
      ? window.__coverBase + '/artist-banner/' + encodeURIComponent(artist.name)
      : null;

    // ── 主色提取（别名 chips 晕染用）：从横版图/头像提取主色写入 --artist-rgb ──
    // crossOrigin='anonymous' 必须在 src 之前设置，否则 canvas 被污染、
    // extractDominantColor 的 getImageData 抛 SecurityError（cover-server 已带 ACAO:*）。
    var applyArtistColor = function (imgEl) {
      if (!imgEl || !App.utils.extractDominantColor) return;
      try {
        var rgb = App.utils.extractDominantColor(imgEl);
        if (rgb) headerEl.style.setProperty('--artist-rgb', rgb.join(', '));
      } catch (e) { /* 提取失败：chips 用中性兜底色 */ }
    };

    // 横版源探测（本地缓存命中时几乎即时；未缓存走 TheAudioDB 抓取）。
    // 加横纵比保险：宽必须明显大于高，防止异常方图混入导致裁人。
    if (bUrl) {
      var bProbe = new Image();
      bProbe.crossOrigin = 'anonymous';
      bProbe.onload = function () {
        if (bProbe.naturalWidth >= bProbe.naturalHeight) applyHero(bUrl);
        applyArtistColor(bProbe);
      };
      bProbe.onerror = function () { /* 无横版图：保持方形头部 */ };
      bProbe.src = bUrl;
    }

    // 头像探测：仅用于原方形头部（环境光晕 + 圆形头像），不参与 hero
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
        // 抓取失败：保留纯色 + 首字母占位，不使用任何专辑封面
      };
      probe.src = aUrl;
    }

    // ── 艺人别名（显示在头部；数据源 MusicBrainz/网易云，cover-server 落盘缓存）──
    var aliasEl = document.getElementById('detail-alias');
    if (aliasEl && artist.name && typeof window.__coverBase === 'string') {
      fetch(window.__coverBase + '/artist-aliases/' + encodeURIComponent(artist.name))
        .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
        .then(function (obj) {
          var aliases = (obj && obj.aliases) || [];
          if (!aliases.length || !aliasEl.isConnected) return;
          aliasEl.innerHTML = aliases.map(function (a) {
            return '<span class="alias-chip">' + App.utils.esc(String(a)) + '</span>';
          }).join('');
          aliasEl.hidden = false;
        })
        .catch(function () { /* 无别名：保持隐藏 */ });
    }

    // ── 艺人简介（在线获取；cover-server 落盘缓存，百度百科 → 网易云 → TheAudioDB → Wikipedia）──
    // 页签默认隐藏，抓到简介才显示；无简介/失败则保持隐藏，不打扰界面
    var aboutTab = document.getElementById('artist-about-tab');
    var bioEl = document.getElementById('artist-bio-text');
    if (bioEl && artist.name && typeof window.__coverBase === 'string') {
      fetch(window.__coverBase + '/artist-bio/' + encodeURIComponent(artist.name))
        .then(function (r) {
          if (!r.ok) throw new Error('HTTP ' + r.status);
          return r.text();
        })
        .then(function (text) {
          if (!text || !text.trim()) throw new Error('empty');
          // 页面可能已被切换/重渲染，只在元素仍连接时填充
          if (!bioEl.isConnected) return;
          bioEl.textContent = text.trim();
          if (aboutTab) aboutTab.style.display = '';
        })
        .catch(function () { /* 无简介：页签保持隐藏 */ });
    }
  }

  // ── Pivot（复用正在播放页面的 .np-pivot pill 样式）──
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

  // 歌曲页签：该艺人全部曲目（复用 .track-list / trackRow 样式）
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

  // 专辑页签：该艺人专辑网格（复用 .album-grid / .album-card 样式）
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
    // 歌曲页签的曲目列表更新播放态
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
