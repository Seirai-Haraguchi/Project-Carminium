/**
 * Carminium — 右键悬浮菜单
 */
(function () {
  'use strict';

  window.App = window.App || {};
  const cm = {};
  window.App.contextMenu = cm;

  let overlayEl;
  let menuContainer;
  let submenuEl;       // 「添加到歌单」子菜单
  let submenuTimer = null;
  let submenuGeneration = 0; // 防止过期的异步回调

  function init() {
    overlayEl = document.createElement('div');
    overlayEl.className = 'context-menu-layer';
    overlayEl.style.display = 'none';

    menuContainer = document.createElement('div');
    menuContainer.className = 'context-menu-container';
    overlayEl.appendChild(menuContainer);

    // 子菜单容器（添加到歌单）
    submenuEl = document.createElement('div');
    submenuEl.className = 'context-submenu';
    submenuEl.style.display = 'none';
    overlayEl.appendChild(submenuEl);

    document.body.appendChild(overlayEl);

    // 点击空白处关闭
    overlayEl.addEventListener('mousedown', function(e) {
      if (e.target === overlayEl) {
        hide();
      }
    });

    // 拦截全局右键菜单
    document.addEventListener('contextmenu', function(e) {
      // 优先检测专辑卡片
      const albumCard = e.target.closest('.album-card');
      if (albumCard && albumCard._albumData) {
        e.preventDefault();
        showAlbum(e.clientX, e.clientY, albumCard._albumData);
        return;
      }
      const trackRow = e.target.closest('.track-row');
      if (trackRow && trackRow._trackData) {
        e.preventDefault();
        // 如果右键的曲目不在当前选中集中，清除选中并仅选中此曲目
        if (!App.selection || !App.selection.isSelected(trackRow._trackData.id)) {
          if (App.selection) App.selection.selectOnly(trackRow._trackData, trackRow);
        }
        show(e.clientX, e.clientY, trackRow._trackData);
      } else {
        // 如果不是针对歌曲，阻止默认的 qwebengine 菜单
        e.preventDefault();
        hide();
      }
    });

    // 子菜单 hover 保持：鼠标移入子菜单时取消隐藏定时器
    submenuEl.addEventListener('mouseenter', function () {
      if (submenuTimer) { clearTimeout(submenuTimer); submenuTimer = null; }
    });
    submenuEl.addEventListener('mouseleave', function () {
      submenuTimer = setTimeout(function () {
        _hideSubmenu();
      }, 300);
    });
  }

  function hide() {
    overlayEl.classList.remove('open');
    _hideSubmenu();
    setTimeout(function () {
      if (!overlayEl.classList.contains('open')) {
        overlayEl.style.display = 'none';
      }
    }, 180);
  }

  function _hideSubmenu() {
    submenuGeneration++; // 使任何待处理的异步显示无效
    if (submenuEl) {
      submenuEl.style.display = 'none';
      submenuEl.innerHTML = '';
    }
  }

  /**
   * 构建「打开歌手」子菜单（多歌手时）
   * @param {Array} artists  歌手名数组
   */
  function _showArtistSubmenu(artists) {
    _hideSubmenu();
    var gen = ++submenuGeneration;
    if (!artists || artists.length === 0) return;

    var frag = document.createDocumentFragment();

    // 标题行：「从创作者中选择一个：」
    var header = document.createElement('div');
    header.className = 'context-submenu-header';
    header.textContent = App.i18n.t('cm.chooseArtist');
    frag.appendChild(header);

    // 歌手列表
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
      frag.appendChild(item);
    });

    submenuEl.innerHTML = '';
    submenuEl.appendChild(frag);
    submenuEl.style.display = 'block';

    // 定位：主菜单右侧
    var rect = menuContainer.getBoundingClientRect();
    var subRect = submenuEl.getBoundingClientRect();
    var posX = rect.right + 4;
    var posY = rect.top;
    if (posX + subRect.width > window.innerWidth - 8) {
      posX = rect.left - subRect.width - 4;
    }
    if (posX < 8) posX = 8;
    if (posY + subRect.height > window.innerHeight - 8) {
      posY = window.innerHeight - subRect.height - 8;
    }
    if (posY < 8) posY = 8;
    submenuEl.style.left = posX + 'px';
    submenuEl.style.top = posY + 'px';
  }

  /**
   * 构建「添加到歌单」子菜单
   * @param {Array} tracks  要添加的曲目数组
   */
  function _showPlaylistSubmenu(tracks) {
    _hideSubmenu();
    var gen = ++submenuGeneration;

    // 异步获取歌单列表
    App.utils.call('get_playlists').then(function (res) {
      if (gen !== submenuGeneration) return; // 过期回调
      var playlists = JSON.parse(res);
      var frag = document.createDocumentFragment();

      // 歌单列表
      if (playlists.length === 0) {
        var empty = document.createElement('div');
        empty.className = 'context-submenu-empty';
        empty.textContent = App.i18n.t('cm.noPlaylists');
        frag.appendChild(empty);
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
              } catch (e) { /* ignore */ }
            });
            hide();
          });
          frag.appendChild(item);
        });
      }

      // 分隔线 + 新建歌单
      var divider = document.createElement('div');
      divider.className = 'context-submenu-divider';
      frag.appendChild(divider);

      var createItem = document.createElement('div');
      createItem.className = 'context-submenu-item context-submenu-create';
      createItem.innerHTML =
        '<span class="material-symbols-rounded context-submenu-item-icon">add</span>' +
        '<span class="context-submenu-item-name">' + App.i18n.t('cm.newPlaylist') + '</span>';
      createItem.addEventListener('click', function () {
        hide();
        _promptCreatePlaylistAndAdd(tracks);
      });
      frag.appendChild(createItem);

      submenuEl.innerHTML = '';
      submenuEl.appendChild(frag);
      submenuEl.style.display = 'block';

      // 定位：主菜单右侧
      var rect = menuContainer.getBoundingClientRect();
      var subRect = submenuEl.getBoundingClientRect();
      var posX = rect.right + 4;
      var posY = rect.top;
      // 如果右侧空间不足，放到主菜单左侧
      if (posX + subRect.width > window.innerWidth - 8) {
        posX = rect.left - subRect.width - 4;
      }
      if (posX < 8) posX = 8;
      if (posY + subRect.height > window.innerHeight - 8) {
        posY = window.innerHeight - subRect.height - 8;
      }
      if (posY < 8) posY = 8;
      submenuEl.style.left = posX + 'px';
      submenuEl.style.top = posY + 'px';
    });
  }

  /**
   * 新建歌单并将曲目添加进去
   */
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

  function show(x, y, track) {
    menuContainer.innerHTML = '';
    _hideSubmenu();

    // 获取所有选中曲目（如果右键的曲目在选中集中）
    var selectedTracks = [];
    if (App.selection && App.selection.isSelected(track.id)) {
      selectedTracks = App.selection.getSelectedTracks();
    }
    if (selectedTracks.length === 0) {
      selectedTracks = [track];
    }
    var isMulti = selectedTracks.length > 1;

    // 1. 顶部卡片 (歌曲信息)
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

    // 2. 底部功能列表
    const list = document.createElement('div');
    list.className = 'context-menu-list';

    // 多歌手信息（仅单曲时有意义）
    var trackArtists = (!isMulti && track.artists) ? track.artists : null;
    if (!trackArtists && !isMulti && track.artist) {
      trackArtists = [track.artist];
    }
    var hasMultipleArtists = trackArtists && trackArtists.length > 1;

    const items = [
      { id: 'play', icon: 'play_arrow', text: isMulti ? App.i18n.t('cm.playSelected') : App.i18n.t('cm.play'), color: 'var(--md-primary)' },
      { id: 'play_next', icon: 'queue_play_next', text: isMulti ? App.i18n.t('cm.playNextSelected') : App.i18n.t('cm.playNext') },
      { id: 'add_queue', icon: 'playlist_play', text: isMulti ? App.i18n.t('cm.addToQueueSelected') : App.i18n.t('cm.addToQueue') },
      { id: 'add_to_playlist', icon: 'playlist_add', text: App.i18n.t('cm.addToPlaylist'), hasSubmenu: true },
    ];

    // 单曲时显示「打开专辑」和「打开歌手」
    if (!isMulti) {
      if (track.album) {
        items.push({ id: 'open_album', icon: 'album', text: App.i18n.t('cm.openAlbum', { name: track.album }) });
      }
      if (trackArtists && trackArtists.length > 0) {
        if (hasMultipleArtists) {
          // 多歌手：显示二级菜单
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

    // 仅在已设置外部标签编辑应用时显示该项
    if (App.state && App.state.tagEditorPath) {
      items.push({ id: 'tag_editor', icon: 'edit_note', text: App.i18n.t('cm.editTags') });
    }
    items.push({ id: 'info', icon: 'info', text: App.i18n.t('cm.fileInfo'), color: 'var(--md-tertiary)' });

    items.forEach(item => {
      const el = document.createElement('div');
      el.className = 'context-menu-item';
      if (item.hasSubmenu) el.classList.add('has-submenu');

      const iconColorStyle = item.color ? `style="color:${item.color}"` : '';
      const arrowHtml = item.hasSubmenu
        ? '<span class="material-symbols-rounded context-submenu-arrow">chevron_right</span>'
        : '';

      el.innerHTML = `
        <span class="material-symbols-rounded" ${iconColorStyle}>${item.icon}</span>
        <span class="context-menu-text">${App.utils.esc(item.text)}</span>
        ${arrowHtml}
      `;

      // 子菜单 hover 处理
      if (item.hasSubmenu) {
        el.addEventListener('mouseenter', function () {
          if (submenuTimer) { clearTimeout(submenuTimer); submenuTimer = null; }
          // 等待下一帧再显示，确保菜单已渲染
          requestAnimationFrame(function () {
            if (item.submenuType === 'artist') {
              _showArtistSubmenu(trackArtists);
            } else {
              _showPlaylistSubmenu(selectedTracks);
            }
          });
        });
        el.addEventListener('mouseleave', function () {
          // 延迟隐藏子菜单，让用户有时间移入子菜单
          submenuTimer = setTimeout(function () {
            _hideSubmenu();
          }, 300);
        });
      } else {
        // 非 submenu 项 hover 时隐藏子菜单
        el.addEventListener('mouseenter', function () {
          if (submenuTimer) { clearTimeout(submenuTimer); submenuTimer = null; }
          _hideSubmenu();
        });
      }

      el.addEventListener('click', () => {
        if (item.hasSubmenu) return; // 子菜单项不触发 click
        hide();
        if (item.id === 'play') {
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
          // 单歌手直接导航（多歌手走 submenu）
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
            } catch (e) { /* ignore */ }
          });
        } else if (item.id === 'info') {
          if (isMulti) {
            var info = App.i18n.t('cm.infoSelectedTitle') + '\n' +
                       App.i18n.t('cm.infoCount', { count: selectedTracks.length }) + '\n' +
                       App.i18n.t('cm.infoTotalDuration', { duration: App.utils.formatDuration(selectedTracks.reduce(function (s, t) { return s + (t.duration_ms || 0); }, 0)) });
            alert(info);
          } else {
            var _t = App.i18n.t;
            var unknown = _t('common.unknown');
            var sizeMB = track.file_size ? (track.file_size / (1024 * 1024)).toFixed(2) + ' MB' : unknown;
            var bitrateStr = track.bitrate ? Math.round(track.bitrate/1000) + ' kbps' : unknown;
            var info = _t('cm.infoTitle') + '\n' +
                       _t('cm.infoFieldTitle', { value: track.title || unknown }) + '\n' +
                       _t('cm.infoFieldArtist', { value: track.artist || unknown }) + '\n' +
                       _t('cm.infoFieldAlbum', { value: track.album || unknown }) + '\n' +
                       _t('cm.infoFieldBitrate', { value: bitrateStr }) + '\n' +
                       _t('cm.infoFieldSize', { value: sizeMB }) + '\n' +
                       _t('cm.infoFieldPath', { value: track.path });
            alert(info);
          }
        }
      });
      list.appendChild(el);
    });

    menuContainer.appendChild(header);
    menuContainer.appendChild(list);

    overlayEl.style.display = 'block';
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        overlayEl.classList.add('open');
      });
    });

    // 调整位置以防超出屏幕边界
    const rect = menuContainer.getBoundingClientRect();
    let posX = x;
    let posY = y;
    if (posX + rect.width > window.innerWidth) posX = window.innerWidth - rect.width - 16;
    if (posY + rect.height > window.innerHeight) posY = window.innerHeight - rect.height - 16;

    menuContainer.style.left = posX + 'px';
    menuContainer.style.top = posY + 'px';
  }

  /**
   * 从前端缓存中获取专辑的曲目列表
   * @param {Object} album  专辑对象
   * @returns {Array} 曲目数组（已排序）
   */
  function _getAlbumTracks(album) {
    var allTracks = (App.state && App.state.allTracks) ? App.state.allTracks : [];
    return allTracks.filter(function (t) {
      if (t.album !== album.album) return false;
      var tArtist = t.album_artist || t.artist;
      return tArtist === album.album_artist;
    }).sort(function (a, b) {
      var da = (a.disc_number || 0), db = (b.disc_number || 0);
      if (da !== db) return da - db;
      return (a.track_number || 0) - (b.track_number || 0);
    });
  }

  /**
   * 显示专辑右键菜单
   * @param {number} x
   * @param {number} y
   * @param {Object} album  专辑对象
   */
  function showAlbum(x, y, album) {
    menuContainer.innerHTML = '';
    _hideSubmenu();

    // 获取专辑曲目
    var tracks = _getAlbumTracks(album);

    // 1. 顶部卡片（专辑信息）
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

    header.innerHTML =
      coverHtml +
      '<div class="context-menu-info">' +
        '<div class="context-menu-title">' + App.utils.esc(albumName) + '</div>' +
        '<div class="context-menu-artist">' + App.utils.esc(albumArtist) + '</div>' +
      '</div>';

    // 2. 底部功能列表
    var list = document.createElement('div');
    list.className = 'context-menu-list';

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

      // 子菜单 hover 处理
      if (item.hasSubmenu) {
        el.addEventListener('mouseenter', function () {
          if (submenuTimer) { clearTimeout(submenuTimer); submenuTimer = null; }
          requestAnimationFrame(function () {
            _showPlaylistSubmenu(tracks);
          });
        });
        el.addEventListener('mouseleave', function () {
          submenuTimer = setTimeout(function () {
            _hideSubmenu();
          }, 300);
        });
      } else {
        el.addEventListener('mouseenter', function () {
          if (submenuTimer) { clearTimeout(submenuTimer); submenuTimer = null; }
          _hideSubmenu();
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

    menuContainer.appendChild(header);
    menuContainer.appendChild(list);

    overlayEl.style.display = 'block';
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        overlayEl.classList.add('open');
      });
    });

    // 调整位置以防超出屏幕边界
    var rect = menuContainer.getBoundingClientRect();
    var posX = x;
    var posY = y;
    if (posX + rect.width > window.innerWidth) posX = window.innerWidth - rect.width - 16;
    if (posY + rect.height > window.innerHeight) posY = window.innerHeight - rect.height - 16;
    if (posX < 8) posX = 8;
    if (posY < 8) posY = 8;

    menuContainer.style.left = posX + 'px';
    menuContainer.style.top = posY + 'px';
  }

  cm.init = init;
  cm.hide = hide;
  cm.showAlbum = showAlbum;
  document.addEventListener('DOMContentLoaded', init);

})();
