(function () {
  'use strict';

  window.App = window.App || {};
  const cm = {};
  window.App.contextMenu = cm;

  let overlayEl;
  let menuContainer;
  let submenuEl;
  let submenuGeneration = 0;

  const SUBMENU_HIDE_DELAY = 380;
  const SUBMENU_GRACE = 320;
  const SUBMENU_HARD_CAP = 1800;
  let submenuTickTimer = null;
  let submenuAnchor = null;
  let submenuArmTime = 0;
  let submenuDeadline = 0;
  const lastMouse = { x: 0, y: 0 };

  document.addEventListener('mousemove', function (e) {
    lastMouse.x = e.clientX;
    lastMouse.y = e.clientY;
  }, { passive: true, capture: true });

  function _signTri(p1, p2, p3) {
    return (p1.x - p3.x) * (p2.y - p3.y) - (p2.x - p3.x) * (p1.y - p3.y);
  }

  function _pointInTriangle(p, a, b, c) {
    var d1 = _signTri(p, a, b), d2 = _signTri(p, b, c), d3 = _signTri(p, c, a);
    var hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
    var hasPos = d1 > 0 || d2 > 0 || d3 > 0;
    return !(hasNeg && hasPos);
  }

  function _pointerTowardSubmenu() {
    if (!submenuAnchor || !submenuEl || submenuEl.style.display === 'none') return false;
    var r = submenuEl.getBoundingClientRect();
    var menuR = menuContainer.getBoundingClientRect();
    if (r.width === 0 || menuR.width === 0) return false;
    var submenuRight = (r.left + r.right) / 2 >= (menuR.left + menuR.right) / 2;
    var edgeX = submenuRight ? r.left : r.right;
    return _pointInTriangle(lastMouse, submenuAnchor,
      { x: edgeX, y: r.top }, { x: edgeX, y: r.bottom });
  }

  function _cancelSubmenuHide() {
    if (submenuTickTimer) { clearTimeout(submenuTickTimer); submenuTickTimer = null; }
    submenuAnchor = null;
  }

  function _armSubmenuHide() {
    if (submenuTickTimer) { clearTimeout(submenuTickTimer); submenuTickTimer = null; }
    submenuAnchor = { x: lastMouse.x, y: lastMouse.y };
    submenuArmTime = performance.now();
    submenuDeadline = submenuArmTime + SUBMENU_HIDE_DELAY;
    submenuTickTimer = setTimeout(_submenuHideTick, 110);
  }

  function _submenuHideTick() {
    submenuTickTimer = null;
    var now = performance.now();
    if (now >= submenuDeadline) { _hideSubmenu(); return; }
    if (_pointerTowardSubmenu()) {
      submenuDeadline = Math.min(submenuDeadline + SUBMENU_GRACE, submenuArmTime + SUBMENU_HARD_CAP);
    }
    submenuTickTimer = setTimeout(_submenuHideTick, 110);
  }

  function init() {
    overlayEl = document.createElement('div');
    overlayEl.className = 'context-menu-layer';
    overlayEl.style.display = 'none';

    menuContainer = document.createElement('div');
    menuContainer.className = 'context-menu-container mdx';
    overlayEl.appendChild(menuContainer);

    submenuEl = document.createElement('div');
    submenuEl.className = 'context-submenu mdx';
    submenuEl.style.display = 'none';
    overlayEl.appendChild(submenuEl);

    document.body.appendChild(overlayEl);

    overlayEl.addEventListener('mousedown', function(e) {
      if (e.target === overlayEl) {
        hide();
      }
    });

    document.addEventListener('contextmenu', function(e) {
      lastMouse.x = e.clientX;
      lastMouse.y = e.clientY;
      var coverEl = e.target.closest('#np-cover, #np-cover-img');
      if (coverEl) {
        var track = App.state && App.state.currentTrack;
        if (track && track.has_cover) {
          e.preventDefault();
          showCover(e.clientX, e.clientY, track);
          return;
        }
      }
      const albumCard = e.target.closest('.album-card');
      if (albumCard && albumCard._albumData) {
        e.preventDefault();
        showAlbum(e.clientX, e.clientY, albumCard._albumData);
        return;
      }
      const trackRow = e.target.closest('.track-row');
      if (trackRow && trackRow._trackData) {
        e.preventDefault();
        if (!App.selection || !App.selection.isSelected(trackRow._trackData.id)) {
          if (App.selection) App.selection.selectOnly(trackRow._trackData, trackRow);
        }
        show(e.clientX, e.clientY, trackRow._trackData);
      } else {
        e.preventDefault();
        hide();
      }
    });

    submenuEl.addEventListener('mouseenter', function () {
      _cancelSubmenuHide();
    });
    submenuEl.addEventListener('mouseleave', function () {
      _armSubmenuHide();
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && overlayEl.classList.contains('open')) hide();
    });
  }

  function hide() {
    overlayEl.classList.remove('open');
    _hideSubmenu();
    document.dispatchEvent(new CustomEvent('context-menu-closed'));
    setTimeout(function () {
      if (!overlayEl.classList.contains('open')) {
        overlayEl.style.display = 'none';
      }
    }, 180);
  }

  function _hideSubmenu() {
    _cancelSubmenuHide();
    submenuGeneration++;
    if (submenuEl) {
      submenuEl.style.display = 'none';
      submenuEl.innerHTML = '';
    }
  }

  // ── 菜单取色：从封面抽主色 → 写 --mdx-tint，供 .mdx 光晕混色 ──
  var _tintCache = new Map();
  var _tintPending = new Map();

  function _tintHsl(rgb) {
    var r = rgb[0] / 255, g = rgb[1] / 255, b = rgb[2] / 255;
    var max = Math.max(r, g, b), min = Math.min(r, g, b);
    var l = (max + min) / 2;
    var h = 0, s = 0;
    if (max !== min) {
      var d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
    }
    s = Math.max(42, Math.min(Math.round(s * 100), 80));
    l = Math.max(46, Math.min(Math.round(l * 100), 66));
    return 'hsl(' + Math.round(h) + ', ' + s + '%, ' + l + '%)';
  }

  function _menuTint(el, url) {
    if (!el) return;
    if (el._tintUrl === url) return;
    el._tintUrl = url;
    el.style.removeProperty('--mdx-tint');
    if (!url) return;
    if (_tintCache.has(url)) {
      var cached = _tintCache.get(url);
      if (cached) el.style.setProperty('--mdx-tint', cached);
      return;
    }
    if (_tintPending.has(url)) { _tintPending.get(url).push(el); return; }
    _tintPending.set(url, [el]);
    var img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    img.onload = function () {
      var rgb = null;
      try { rgb = App.utils.extractDominantColor(img); } catch (e) { rgb = null; }
      var hsl = rgb ? _tintHsl(rgb) : '';
      _tintCache.set(url, hsl);
      (_tintPending.get(url) || []).forEach(function (node) {
        if (node && hsl) node.style.setProperty('--mdx-tint', hsl);
      });
      _tintPending.delete(url);
    };
    img.onerror = function () {
      _tintCache.set(url, '');
      _tintPending.delete(url);
    };
    img.src = url;
  }

  // ── 选项型子菜单（倍速 / 播放顺序）：单选，当前项带勾 ──
  function _positionSubmenu(itemEl) {
    // 🔴 用 offset 尺寸而不是 getBoundingClientRect：子菜单入场是 scale(0.96) 动画，
    //    rect 拿到的是缩放后的值，会让贴边判断差几个像素。
    var rect = menuContainer.getBoundingClientRect();
    var subW = submenuEl.offsetWidth;
    var subH = submenuEl.offsetHeight;
    var posX = rect.right + 4;
    var posY = (itemEl ? itemEl.getBoundingClientRect().top : rect.top) - 6;
    if (posX + subW > window.innerWidth - 8) {
      posX = rect.left - subW - 4;
    }
    if (posX < 8) posX = 8;
    if (posY + subH > window.innerHeight - 8) {
      posY = window.innerHeight - subH - 8;
    }
    if (posY < 8) posY = 8;
    submenuEl.style.left = posX + 'px';
    submenuEl.style.top = posY + 'px';
    // 子菜单入场缩放的 origin 跟随它在主菜单的哪一侧
    submenuEl.style.transformOrigin = (posX >= rect.right) ? '0 0' : '100% 0';
  }

  function _showChoiceSubmenu(itemEl, config) {
    _hideSubmenu();
    ++submenuGeneration;

    var list = document.createElement('div');
    list.className = 'md-seglist context-submenu-list';

    (config.options || []).forEach(function (opt) {
      var checked = opt.value === config.current;
      var item = document.createElement('div');
      item.className = 'context-submenu-item' + (checked ? ' is-checked' : '');
      item.innerHTML =
        '<span class="material-symbols-rounded context-submenu-item-icon">' + opt.icon + '</span>' +
        '<span class="context-submenu-item-name">' + App.utils.esc(opt.label) + '</span>' +
        (checked ? '<span class="material-symbols-rounded context-submenu-item-check">check</span>' : '');
      item.addEventListener('click', function () {
        hide();
        config.onSelect(opt.value);
      });
      list.appendChild(item);
    });

    submenuEl.innerHTML = '';
    submenuEl.appendChild(list);
    submenuEl.style.display = 'flex';
    _cancelSubmenuHide();
    _positionSubmenu(itemEl);
  }

  var NP_RATES = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

  function _formatRate(rate) {
    var v = Math.round((parseFloat(rate) || 1) * 100) / 100;
    return (v % 1 === 0 ? v.toFixed(1) : String(v)) + '×';
  }

  function _repeatLabel(mode) {
    if (mode === 'one') return App.i18n.t('cm.orderOne');
    if (mode === 'all') return App.i18n.t('cm.orderAll');
    return App.i18n.t('cm.orderOff');
  }

  function _showSpeedSubmenu(itemEl) {
    var cur = (App.nowPlaying && App.nowPlaying.getPlaybackRate)
      ? App.nowPlaying.getPlaybackRate() : 1;
    _showChoiceSubmenu(itemEl, {
      current: Math.round(cur * 100) / 100,
      options: NP_RATES.map(function (r) {
        return { value: r, label: _formatRate(r), icon: 'speed' };
      }),
      onSelect: function (rate) {
        if (App.nowPlaying && App.nowPlaying.setPlaybackRate) {
          App.nowPlaying.setPlaybackRate(rate);
        }
      },
    });
  }

  function _showOrderSubmenu(itemEl) {
    _showChoiceSubmenu(itemEl, {
      current: (App.state && App.state.repeat) || 'off',
      options: [
        { value: 'off', label: App.i18n.t('cm.orderOff'), icon: 'format_list_numbered' },
        { value: 'all', label: App.i18n.t('cm.orderAll'), icon: 'repeat' },
        { value: 'one', label: App.i18n.t('cm.orderOne'), icon: 'repeat_one' },
      ],
      onSelect: function (mode) { App.backend.set_repeat(mode); },
    });
  }

  function _showArtistSubmenu(artists, itemEl) {
    _hideSubmenu();
    var gen = ++submenuGeneration;
    if (!artists || artists.length === 0) return;

    var header = document.createElement('div');
    header.className = 'context-submenu-header';
    header.textContent = App.i18n.t('cm.chooseArtist');

    var list = document.createElement('div');
    list.className = 'md-seglist context-submenu-list';

    artists.forEach(function (name) {
      var item = document.createElement('div');
      item.className = 'context-submenu-item';
      item.innerHTML =
        '<span class="material-symbols-rounded context-submenu-item-icon">person</span>' +
        '<span class="context-submenu-item-name">' + App.utils.esc(name) + '</span>';
      item.addEventListener('click', function () {
        hide();
        if (App.navigate) {
          App.navigate('artists', { artist: name });
        }
      });
      list.appendChild(item);
    });

    submenuEl.innerHTML = '';
    submenuEl.appendChild(header);
    submenuEl.appendChild(list);
    submenuEl.style.display = 'flex';
    _cancelSubmenuHide();
    _positionSubmenu(itemEl);
  }

  function _showPlaylistSubmenu(tracks, itemEl) {
    _hideSubmenu();
    var gen = ++submenuGeneration;

    App.utils.call('get_playlists').then(function (res) {
      if (gen !== submenuGeneration) return;
      var playlists = JSON.parse(res);
      var list = document.createElement('div');
      list.className = 'md-seglist context-submenu-list';

      if (playlists.length === 0) {
        var empty = document.createElement('div');
        empty.className = 'context-submenu-empty';
        empty.textContent = App.i18n.t('cm.noPlaylists');
        list.appendChild(empty);
      } else {
        playlists.forEach(function (pl) {
          var item = document.createElement('div');
          item.className = 'context-submenu-item';
          var isRemote = pl.source === 'subsonic';
          var badge = isRemote ? ' <span class="material-symbols-rounded" style="font-size:13px;opacity:0.6;vertical-align:middle;">cloud</span>' : '';
          item.innerHTML =
            '<span class="material-symbols-rounded context-submenu-item-icon">' + (isRemote ? 'cloud' : 'playlist_play') + '</span>' +
            '<span class="context-submenu-item-name">' + App.utils.esc(pl.name) + badge + '</span>' +
            '<span class="context-submenu-item-count">' + (pl.track_count || 0) + '</span>';
          item.addEventListener('click', function () {
            var ids = tracks.map(function (t) { return t.id; });
            var method = isRemote ? 'add_tracks_to_remote_playlist' : 'add_tracks_to_playlist';
            App.utils.call(method, pl.id, JSON.stringify(ids)).then(function (res) {
              try {
                var r = JSON.parse(res);
                if (r.error) {
                  App.utils.toast(r.error);
                } else {
                  App.utils.toast(App.i18n.t('playlist.tracksAdded', { count: r.added || 0, name: pl.name }));
                  if (r.skipped > 0) {
                    App.utils.toast(App.i18n.t('playlist.tracksSkipped', { count: r.skipped }));
                  }
                }
              } catch (e) {  }
            });
            hide();
          });
          list.appendChild(item);
        });
      }

      var createItem = document.createElement('div');
      createItem.className = 'context-submenu-item context-submenu-create';
      createItem.innerHTML =
        '<span class="material-symbols-rounded context-submenu-item-icon">add</span>' +
        '<span class="context-submenu-item-name">' + App.i18n.t('cm.newPlaylist') + '</span>';
      createItem.addEventListener('click', function () {
        hide();
        _promptCreatePlaylistAndAdd(tracks);
      });
      list.appendChild(createItem);

      submenuEl.innerHTML = '';
      submenuEl.appendChild(list);
      submenuEl.style.display = 'flex';
      if (submenuTickTimer) _cancelSubmenuHide();
      _positionSubmenu(itemEl);
    });
  }

  function _promptCreatePlaylistAndAdd(tracks) {
    var overlay = document.createElement('div');
    overlay.className = 'cmd-dialog-overlay';
    var dlg = document.createElement('div');
    dlg.className = 'cmd-dialog';
    dlg.innerHTML =
      '<div class="cmd-dialog-title">' + App.i18n.t('playlist.newTitle') + '</div>' +
      '<div class="cmd-dialog-body">' +
        '<div class="cmd-text-field">' +
          '<input type="text" id="cm-new-pl-input" class="cmd-text-field__input" placeholder=" " autocomplete="off">' +
          '<label class="cmd-text-field__label">' + App.i18n.t('cm.playlistName') + '</label>' +
        '</div>' +
      '</div>' +
      '<div class="cmd-dialog-actions">' +
        '<button class="cmd-dialog-btn cmd-dialog-btn--cancel">' + App.i18n.t('common.cancel') + '</button>' +
        '<button class="cmd-dialog-btn cmd-dialog-btn--confirm">' + App.i18n.t('cm.createAndAdd') + '</button>' +
      '</div>';
    overlay.appendChild(dlg);
    document.body.appendChild(overlay);
    requestAnimationFrame(function () { overlay.classList.add('open'); });

    var input = dlg.querySelector('#cm-new-pl-input');
    var confirmBtn = dlg.querySelector('.cmd-dialog-btn--confirm');
    setTimeout(function () { input.focus(); }, 50);

    var done = false;
    var creating = false;
    function close() {
      if (done) return;
      done = true;
      overlay.classList.remove('open');
      setTimeout(function () {
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      }, 180);
    }

    function create() {
      if (creating) return;
      var name = (input.value || '').trim();
      if (!name) { input.focus(); return; }
      creating = true;
      confirmBtn.disabled = true;
      var ids = tracks.map(function (t) { return t.id; });
      App.utils.call('create_playlist', name).then(function (res) {
        var pl = JSON.parse(res);
        return App.utils.call('add_tracks_to_playlist', pl.id, JSON.stringify(ids));
      }).then(function () {
        close();
        App.utils.toast(App.i18n.t('playlist.createdAdded', { name: name, count: ids.length }));
      }).catch(function (err) {
        console.error('[context_menu] 创建歌单失败:', err);
        creating = false;
        confirmBtn.disabled = false;
        input.focus();
      });
    }

    dlg.querySelector('.cmd-dialog-btn--cancel').addEventListener('click', close);
    confirmBtn.addEventListener('click', create);
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') create();
      else if (e.key === 'Escape') close();
    });
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) close();
    });
  }

  function show(x, y, track, opts) {
    opts = opts || {};
    var isNp = opts.mode === 'nowPlaying';
    menuContainer.innerHTML = '';
    _hideSubmenu();

    var selectedTracks = [];
    if (!isNp && App.selection && App.selection.isSelected(track.id)) {
      selectedTracks = App.selection.getSelectedTracks();
    }
    if (selectedTracks.length === 0) {
      selectedTracks = [track];
    }
    var isMulti = selectedTracks.length > 1;

    const header = document.createElement('div');
    header.className = 'context-menu-header';

    let coverHtml = '';
    if (track.has_cover) {
      coverHtml = `<img src="${window.coverUrl(track.id, 128)}" alt="Cover">`;
    } else {
      const bg = App.utils.hashColor(track.album || track.title);
      coverHtml = `<div class="cm-cover-placeholder" style="background:${bg}">${App.utils.initial(track.album || track.title)}</div>`;
    }

    const title = track.title || App.i18n.t('common.unknownTrack');
    const artist = track.artist || App.i18n.t('common.unknownArtist');

    var headerInfo;
    if (isMulti) {
      headerInfo =
        '<div class="context-menu-info">' +
          '<div class="context-menu-title">' + App.i18n.t('cm.selectedCount', { count: selectedTracks.length }) + '</div>' +
          '<div class="context-menu-artist">' + App.utils.esc(title) + App.i18n.t('cm.andMore') + '</div>' +
        '</div>';
    } else {
      headerInfo =
        '<div class="context-menu-info">' +
          '<div class="context-menu-title">' + App.utils.esc(title) + '</div>' +
          '<div class="context-menu-artist">' + App.utils.esc(artist) + '</div>' +
        '</div>';
    }

    header.innerHTML = `
      ${coverHtml}
      ${headerInfo}
      <button class="icon-btn" title="${App.i18n.t('cm.copyInfo')}">
        <span class="material-symbols-rounded" style="font-size:20px; color:var(--md-primary)">content_copy</span>
      </button>
    `;

    header.querySelector('.icon-btn').addEventListener('click', () => {
      if (isMulti) {
        var lines = selectedTracks.map(function (t) {
          return (t.title || App.i18n.t('common.unknown')) + ' - ' + (t.artist || App.i18n.t('common.unknown'));
        });
        navigator.clipboard.writeText(lines.join('\n'));
      } else {
        navigator.clipboard.writeText(`${title} - ${artist}`);
      }
      hide();
    });

    const list = document.createElement('div');
    list.className = 'context-menu-list md-seglist';

    var trackArtists = (!isMulti && track.artists) ? track.artists : null;
    if (!trackArtists && !isMulti && track.artist) {
      trackArtists = [track.artist];
    }
    var hasMultipleArtists = trackArtists && trackArtists.length > 1;

    var hasExternal = selectedTracks.some(function (t) { return !!(t && t.external); });

    const items = [];

    // 正在播放页的「更多」菜单：曲目信息/播放/插播/加队列一律不出现在这里
    // （这些操作在该页已有常驻控件），改为播放控制类条目。
    if (isNp) {
      var npRate = (App.nowPlaying && App.nowPlaying.getPlaybackRate)
        ? App.nowPlaying.getPlaybackRate() : 1;
      items.push({
        id: 'playback_speed', icon: 'speed',
        text: App.i18n.t('cm.playbackSpeed'),
        value: _formatRate(npRate),
        hasSubmenu: true, submenuType: 'speed',
      });
      items.push({
        id: 'play_order', icon: 'repeat',
        text: App.i18n.t('cm.playOrder'),
        value: _repeatLabel(App.state ? App.state.repeat : 'off'),
        hasSubmenu: true, submenuType: 'order',
      });
      items.push({
        id: 'shuffle', icon: 'shuffle', text: App.i18n.t('np.shuffle'),
        checked: !!(App.state && App.state.shuffle),
      });
      items.push({
        id: 'like', icon: 'favorite', text: App.i18n.t('np.like'),
        checked: !!(App.nowPlaying && App.nowPlaying.isLiked && App.nowPlaying.isLiked()),
      });
    } else {
      items.push(
        { id: 'play', icon: 'play_arrow', text: isMulti ? App.i18n.t('cm.playSelected') : App.i18n.t('cm.play'), color: 'var(--md-primary)' },
        { id: 'play_next', icon: 'queue_play_next', text: isMulti ? App.i18n.t('cm.playNextSelected') : App.i18n.t('cm.playNext') },
        { id: 'add_queue', icon: 'playlist_play', text: isMulti ? App.i18n.t('cm.addToQueueSelected') : App.i18n.t('cm.addToQueue') },
      );
    }

    if (!hasExternal) {
      items.push({ id: 'add_to_playlist', icon: 'playlist_add', text: App.i18n.t('cm.addToPlaylist'), hasSubmenu: true });
    }

    if (!isMulti && !hasExternal) {
      if (track.album) {
        items.push({ id: 'open_album', icon: 'album', text: App.i18n.t('cm.openAlbum', { name: track.album }) });
      }
      if (trackArtists && trackArtists.length > 0) {
        if (hasMultipleArtists) {
          items.push({ id: 'open_artist', icon: 'person', text: App.i18n.t('cm.openArtist', { name: trackArtists.join(' / ') }), hasSubmenu: true, submenuType: 'artist' });
        } else {
          items.push({ id: 'open_artist', icon: 'person', text: App.i18n.t('cm.openArtist', { name: trackArtists[0] }) });
        }
      }
    }

    items.push(
      { id: 'copy_path', icon: 'content_copy', text: isMulti ? App.i18n.t('cm.copyPathSelected') : App.i18n.t('cm.copyPath') },
      { id: 'explorer', icon: 'folder_open', text: App.i18n.t('cm.showInExplorer') },
    );

    if (App.state && App.state.tagEditorPath) {
      items.push({ id: 'tag_editor', icon: 'edit_note', text: App.i18n.t('cm.editTags') });
    }
    if (!isNp) {
      items.push({ id: 'info', icon: 'info', text: App.i18n.t('cm.fileInfo'), color: 'var(--md-tertiary)' });
    }

    function runItem(item) {
      if (item.hasSubmenu) return;
      hide();

    if (item.id === 'shuffle') {
      App.backend.set_shuffle(!(App.state && App.state.shuffle));
    } else if (item.id === 'like') {
      App.backend.toggle_liked();
    } else if (item.id === 'play') {
      App.backend.play_from_list(JSON.stringify(selectedTracks), 0);
    } else if (item.id === 'play_next') {
      selectedTracks.forEach(function (t) {
        App.backend.add_next(JSON.stringify(t));
      });
    } else if (item.id === 'add_queue') {
      selectedTracks.forEach(function (t) {
        App.backend.append_queue(JSON.stringify(t));
      });
    } else if (item.id === 'open_album') {
      if (App.navigate) {
        App.navigate('albums', { album: track.album, album_artist: track.album_artist || track.artist || '' });
      }
    } else if (item.id === 'open_artist') {
      if (App.navigate && trackArtists && trackArtists.length === 1) {
        App.navigate('artists', { artist: trackArtists[0] });
      }
    } else if (item.id === 'copy_path') {
      if (isMulti) {
        var paths = selectedTracks.map(function (t) { return t.path; });
        navigator.clipboard.writeText(paths.join('\n'));
      } else {
        navigator.clipboard.writeText(track.path);
      }
    } else if (item.id === 'explorer') {
      App.backend.show_in_explorer(track.path);
    } else if (item.id === 'tag_editor') {
      var filePaths = selectedTracks.map(function (t) { return t.path; }).filter(Boolean);
      App.utils.call('open_in_tag_editor', filePaths).then(function (res) {
        try {
          var r = JSON.parse(res);
          if (r && r.error) {
            App.utils.toast(App.i18n.t('cm.tagEditorFailed'));
          }
        } catch (e) {  }
      });
    } else if (item.id === 'info') {
      var _t = App.i18n.t;
      var unknown = _t('common.unknown');
      if (isMulti) {
        App.utils.infoDialog({
          title: _t('cm.fileInfo'),
          rows: [
            _t('cm.infoCount', { count: selectedTracks.length }),
            _t('cm.infoTotalDuration', { duration: App.utils.formatDuration(selectedTracks.reduce(function (s, t) { return s + (t.duration_ms || 0); }, 0)) })
          ]
        });
      } else {
        var sizeMB = track.file_size ? (track.file_size / (1024 * 1024)).toFixed(2) + ' MB' : unknown;
        var bitrateStr = track.bitrate ? Math.round(track.bitrate / 1000) + ' kbps' : unknown;
        App.utils.infoDialog({
          title: _t('cm.fileInfo'),
          rows: [
            { label: _t('cm.infoLabelTitle'), value: track.title || unknown },
            { label: _t('cm.infoLabelArtist'), value: track.artist || unknown },
            { label: _t('cm.infoLabelAlbum'), value: track.album || unknown },
            { label: _t('cm.infoLabelBitrate'), value: bitrateStr },
            { label: _t('cm.infoLabelSize'), value: sizeMB },
            { label: _t('cm.infoLabelPath'), value: track.path || unknown, path: true }
          ]
        });
      }
    }
    }

    // 立即播放 / 下一首播放 / 添加到队列 → 方形平铺一组
    var QUICK_IDS = { play: 1, play_next: 1, add_queue: 1 };
    var quick = document.createElement('div');
    quick.className = 'context-menu-quick';
    items.forEach(function (item) {
      if (!QUICK_IDS[item.id]) return;
      var tile = document.createElement('button');
      tile.type = 'button';
      tile.className = 'context-menu-quick-item' + (item.color ? ' is-primary' : '');
      tile.title = item.text;
      tile.innerHTML =
        '<span class="material-symbols-rounded">' + item.icon + '</span>' +
        '<span class="context-menu-quick-label">' + App.utils.esc(item.text) + '</span>';
      tile.addEventListener('click', function () { runItem(item); });
      quick.appendChild(tile);
    });
    if (quick.childElementCount > 0) list.appendChild(quick);

    items.forEach(function (item) {
      if (QUICK_IDS[item.id]) return;
      const el = document.createElement('div');
      el.className = 'context-menu-item';
      if (item.hasSubmenu) el.classList.add('has-submenu');

      const arrowHtml = item.hasSubmenu
        ? '<span class="material-symbols-rounded context-submenu-arrow">chevron_right</span>'
        : '';

      const valueHtml = item.value != null
        ? '<span class="context-menu-value">' + App.utils.esc(item.value) + '</span>'
        : '';

      // 开关类条目（随机播放 / 收藏）用尾随勾选表示当前状态
      const checkHtml = (!item.hasSubmenu && item.checked)
        ? '<span class="material-symbols-rounded context-menu-check">check</span>'
        : '';

      el.innerHTML =
        '<span class="material-symbols-rounded">' + item.icon + '</span>' +
        '<span class="context-menu-text">' + App.utils.esc(item.text) + '</span>' +
        valueHtml +
        checkHtml +
        arrowHtml;

      if (item.hasSubmenu) {
        el.addEventListener('mouseenter', function () {
          _cancelSubmenuHide();
          requestAnimationFrame(function () {
            if (item.submenuType === 'artist') {
              _showArtistSubmenu(trackArtists, el);
            } else if (item.submenuType === 'speed') {
              _showSpeedSubmenu(el);
            } else if (item.submenuType === 'order') {
              _showOrderSubmenu(el);
            } else {
              _showPlaylistSubmenu(selectedTracks, el);
            }
          });
        });
        el.addEventListener('mouseleave', function () {
          _armSubmenuHide();
        });
      } else {
        el.addEventListener('mouseenter', function () {
          _armSubmenuHide();
        });
      }

      el.addEventListener('click', function () { runItem(item); });
      list.appendChild(el);
    });

    // 正在播放页的入口就在曲目信息旁，再放一遍封面/标题纯属重复
    if (!isNp) list.insertBefore(header, list.firstChild);
    menuContainer.appendChild(list);
    _menuTint(menuContainer, track.has_cover ? window.coverUrl(track.id, 128) : '');

    overlayEl.style.display = 'block';
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        overlayEl.classList.add('open');
      });
    });

    const rect = menuContainer.getBoundingClientRect();
    // 🔴 定位必须用 offset 尺寸：容器入场是 scale(0.96) → 1 的动画，
    //    getBoundingClientRect 量到的是缩放后的尺寸，贴底时会溢出几像素。
    const posW = menuContainer.offsetWidth || rect.width;
    const posH = menuContainer.offsetHeight || rect.height;
    let posX = x;
    let posY = y;

    if (opts.anchorRect) {
      // 以按钮为锚：贴右边缘、向上展开（按钮在页面下半部）
      posX = opts.anchorRect.right - posW;
      posY = opts.anchorRect.top - posH - 8;
      if (posY < 12) posY = opts.anchorRect.bottom + 8;
      if (posX < 12) posX = 12;
    }

    if (posX + posW > window.innerWidth - 12) posX = window.innerWidth - posW - 12;
    if (posY + posH > window.innerHeight - 12) posY = window.innerHeight - posH - 12;
    if (posY < 12) posY = 12;

    menuContainer.style.left = posX + 'px';
    menuContainer.style.top = posY + 'px';

    // 入场缩放从「触发点 / 按钮」这一侧长出来（M3 菜单的 origin 跟随锚点）
    var originX = opts.anchorRect
      ? (opts.anchorRect.left + opts.anchorRect.right) / 2
      : x;
    var originY = opts.anchorRect ? opts.anchorRect.bottom : y;
    _setMenuOrigin(posX, posY, posW, posH, originX, originY);
  }

  // 把 transform-origin 换算成容器内的像素坐标（越界时贴边）
  function _setMenuOrigin(posX, posY, w, h, ax, ay) {
    var ox = Math.max(0, Math.min(w, ax - posX));
    var oy = Math.max(0, Math.min(h, ay - posY));
    menuContainer.style.transformOrigin = ox + 'px ' + oy + 'px';
  }

  function _getAlbumTracks(album) {
    var allTracks = (App.state && App.state.allTracks) ? App.state.allTracks : [];
    // 智能分组后一张卡片可能是多个 (album, album_artist) 自然键拼起来的，
    // 这里必须按全部 keys 过滤，否则菜单里只列出主艺人的那几首。
    var keys = (album.album_keys && album.album_keys.length)
      ? album.album_keys
      : [{ album: album.album, album_artist: album.album_artist }];
    var set = new Set(keys.map(function (k) {
      return String(k.album || '') + '\u0000' + String(k.album_artist || '');
    }));
    return allTracks.filter(function (t) {
      return set.has(String(t.album || '') + '\u0000' + String(t.album_artist || t.artist || ''));
    }).sort(function (a, b) {
      var da = (a.disc_number || 0), db = (b.disc_number || 0);
      if (da !== db) return da - db;
      return (a.track_number || 0) - (b.track_number || 0);
    });
  }

  function showAlbum(x, y, album) {
    menuContainer.innerHTML = '';
    _hideSubmenu();

    var tracks = _getAlbumTracks(album);

    var header = document.createElement('div');
    header.className = 'context-menu-header';

    var coverHtml = '';
    if (album.cover_track_id) {
      coverHtml = '<img src="' + window.coverUrl(album.cover_track_id, 128) + '" alt="Cover">';
    } else {
      var bg = App.utils.hashColor(album.album || '');
      coverHtml = '<div class="cm-cover-placeholder" style="background:' + bg + '">' + App.utils.initial(album.album || '') + '</div>';
    }

    var albumName = album.album || App.i18n.t('common.unknownAlbum');
    var albumArtist = album.album_artist || App.i18n.t('common.unknownArtist');
    // 合并出来的专辑：主艺人 + 「等 N 位」，别只写主艺人让人以为菜单漏了曲子。
    var artistCount = (album.album_artists && album.album_artists.length) || 1;
    if (artistCount > 1 && album.album_artist) {
      albumArtist = App.i18n.t('albums.multiArtist', { artist: album.album_artist, count: artistCount, more: artistCount - 1 });
    }

    header.innerHTML =
      coverHtml +
      '<div class="context-menu-info">' +
        '<div class="context-menu-title">' + App.utils.esc(albumName) + '</div>' +
        '<div class="context-menu-artist">' + App.utils.esc(albumArtist) + '</div>' +
      '</div>';

    var list = document.createElement('div');
    list.className = 'context-menu-list md-seglist';

    var items = [
      { id: 'album_play', icon: 'play_arrow', text: App.i18n.t('cm.playAlbum'), color: 'var(--md-primary)' },
      { id: 'album_add_to_playlist', icon: 'playlist_add', text: App.i18n.t('cm.addAlbumToPlaylist'), hasSubmenu: true },
      { id: 'album_open_artist', icon: 'person', text: App.i18n.t('cm.openArtist', { name: albumArtist }) },
    ];

    items.forEach(function (item) {
      var el = document.createElement('div');
      el.className = 'context-menu-item';
      if (item.hasSubmenu) el.classList.add('has-submenu');

      var iconColorStyle = item.color ? 'style="color:' + item.color + '"' : '';
      var arrowHtml = item.hasSubmenu
        ? '<span class="material-symbols-rounded context-submenu-arrow">chevron_right</span>'
        : '';

      el.innerHTML =
        '<span class="material-symbols-rounded" ' + iconColorStyle + '>' + item.icon + '</span>' +
        '<span class="context-menu-text">' + App.utils.esc(item.text) + '</span>' +
        arrowHtml;

      if (item.hasSubmenu) {
        el.addEventListener('mouseenter', function () {
          _cancelSubmenuHide();
          requestAnimationFrame(function () {
            _showPlaylistSubmenu(tracks, el);
          });
        });
        el.addEventListener('mouseleave', function () {
          _armSubmenuHide();
        });
      } else {
        el.addEventListener('mouseenter', function () {
          _armSubmenuHide();
        });
      }

      el.addEventListener('click', function () {
        if (item.hasSubmenu) return;
        hide();
        if (item.id === 'album_play') {
          if (tracks.length > 0) {
            App.backend.play_from_list(JSON.stringify(tracks), 0);
          }
        } else if (item.id === 'album_open_artist') {
          if (App.navigate) {
            App.navigate('artists', { artist: album.album_artist || album.artist || '' });
          }
        }
      });
      list.appendChild(el);
    });

    list.insertBefore(header, list.firstChild);
    menuContainer.appendChild(list);
    _menuTint(menuContainer, album.cover_track_id ? window.coverUrl(album.cover_track_id, 128) : '');

    overlayEl.style.display = 'block';
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        overlayEl.classList.add('open');
      });
    });

    var rect = menuContainer.getBoundingClientRect();
    var posX = x;
    var posY = y;
    if (posX + rect.width > window.innerWidth - 12) posX = window.innerWidth - rect.width - 12;
    if (posY + rect.height > window.innerHeight - 12) posY = window.innerHeight - rect.height - 12;
    if (posX < 12) posX = 12;
    if (posY < 12) posY = 12;

    menuContainer.style.left = posX + 'px';
    menuContainer.style.top = posY + 'px';
    _setMenuOrigin(posX, posY, menuContainer.offsetWidth, menuContainer.offsetHeight, x, y);
  }

  function showCover(x, y, track) {
    menuContainer.innerHTML = '';
    _hideSubmenu();

    var coverUrl = window.coverUrl(track.id, 800);

    var list = document.createElement('div');
    list.className = 'context-menu-list md-seglist';

    var items = [
      { id: 'copy_cover', icon: 'content_copy', text: App.i18n.t('cm.copyCover') },
      { id: 'open_cover_browser', icon: 'open_in_new', text: App.i18n.t('cm.openCoverInBrowser') },
    ];

    items.forEach(function (item) {
      var el = document.createElement('div');
      el.className = 'context-menu-item';

      var iconColorStyle = item.color ? 'style="color:' + item.color + '"' : '';
      el.innerHTML =
        '<span class="material-symbols-rounded" ' + iconColorStyle + '>' + item.icon + '</span>' +
        '<span class="context-menu-text">' + App.utils.esc(item.text) + '</span>';

      el.addEventListener('mouseenter', function () {
        _armSubmenuHide();
      });

      el.addEventListener('click', function () {
        hide();
        if (item.id === 'copy_cover') {
          _copyCoverToClipboard(coverUrl);
        } else if (item.id === 'open_cover_browser') {
          window.open(coverUrl, '_blank');
        }
      });
      list.appendChild(el);
    });

    menuContainer.appendChild(list);
    _menuTint(menuContainer, window.coverUrl(track.id, 128));

    overlayEl.style.display = 'block';
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        overlayEl.classList.add('open');
      });
    });

    var rect = menuContainer.getBoundingClientRect();
    var posX = x;
    var posY = y;
    if (posX + rect.width > window.innerWidth) posX = window.innerWidth - rect.width - 16;
    if (posY + rect.height > window.innerHeight) posY = window.innerHeight - rect.height - 16;
    if (posX < 8) posX = 8;
    if (posY < 8) posY = 8;

    menuContainer.style.left = posX + 'px';
    menuContainer.style.top = posY + 'px';
    _setMenuOrigin(posX, posY, menuContainer.offsetWidth, menuContainer.offsetHeight, x, y);
  }

  function _copyCoverToClipboard(url) {
    fetch(url)
      .then(function (res) { return res.blob(); })
      .then(function (blob) {
        if (!navigator.clipboard || !navigator.clipboard.write) {
          App.utils.toast(App.i18n.t('cm.copyCoverUnsupported'));
          return;
        }
        var mime = blob.type || 'image/png';
        if (mime !== 'image/png' && mime !== 'image/jpeg' && mime !== 'image/webp') {
          mime = 'image/png';
        }
        var itemData = {};
        itemData[mime] = blob;
        var clipboardItem = new ClipboardItem(itemData);
        navigator.clipboard.write([clipboardItem]).then(function () {
          App.utils.toast(App.i18n.t('cm.copyCoverSuccess'));
        }).catch(function () {
          App.utils.toast(App.i18n.t('cm.copyCoverFailed'));
        });
      })
      .catch(function () {
        App.utils.toast(App.i18n.t('cm.copyCoverFailed'));
      });
  }

  cm.init = init;
  cm.hide = hide;
  cm.showAlbum = showAlbum;
  // 正在播放页「更多」入口：去掉播放类条目，换成播放控制类
  cm.showNowPlaying = function (anchorRect, track) {
    if (!track) return;
    show(0, 0, track, { mode: 'nowPlaying', anchorRect: anchorRect });
  };
  document.addEventListener('DOMContentLoaded', init);

})();
