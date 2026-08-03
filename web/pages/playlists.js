/**
 * Carminium — 歌单详情页
 * 通过 navigate('playlists', {playlist_id: X, playlist_name: 'xxx'}) 进入。
 * 歌单列表由侧边栏的飞出副菜单提供，本页只负责展示单个歌单内容。
 */
(function () {
  'use strict';

  window.App = window.App || {};
  const page = {};
  window.App.pages.playlists = page;

  let currentPlaylist = null;
  let tracks = [];
  let filterStr = '';
  let searchText = '';

  page.render = function (container, params) {
    if (!params || !params.playlist_id) {
      _renderEmpty(container);
      return;
    }
currentPlaylist = {
id: parseInt(params.playlist_id, 10),
name: params.playlist_name || App.i18n.t('playlist.local'),
source: params.source || 'local',
server_id: params.server_id || null,
remote_id: params.remote_id || null,
server_name: params.server_name || null,
cover_art_id: params.cover_art_id || null,
owner: params.owner || null,
owner_email: params.owner_email || null,
};
    _renderDetail(container, currentPlaylist);
  };

  function _renderEmpty(container) {
    container.innerHTML = `
      <div class="empty-state" style="margin-top: 120px;">
        <span class="material-symbols-rounded empty-icon">queue_music</span>
        <h2 class="empty-title">${App.i18n.t('empty.noPlaylists')}</h2>
        <p class="empty-sub">${App.i18n.t('empty.selectPlaylist')}</p>
      </div>
    `;
  }

  /**
   * 渲染创建者信息（有 Gravatar 才显示头像）。
   * 创建人和服务器名同行显示：创建人 · 服务器
   */
  function _renderOwnerInfo(playlist) {
    const isRemote = playlist.source === 'subsonic';
    const owner = playlist.owner;
    const email = playlist.owner_email || '';
    const serverName = (isRemote && playlist.server_name) ? playlist.server_name : null;

    // 组装文字部分：创建人 · 服务器
    var textParts = [];
    if (owner) textParts.push(App.utils.esc(owner));
    if (serverName) textParts.push(App.utils.esc(serverName));
    if (textParts.length === 0) return '';
    var textHtml = textParts.join(' &middot; ');

    // 有 email 才显示 Gravatar 头像，否则只显示文字
    if (email) {
      var hash = _md5(email.toLowerCase().trim());
      var gravatarUrl = 'https://www.gravatar.com/avatar/' + hash + '?d=404&s=48';
      return '<div class="playlist-owner">' +
        '<div class="playlist-owner-avatar-wrap">' +
        '<img class="playlist-owner-avatar" src="' + gravatarUrl + '" alt="" loading="lazy"' +
        ' onerror="this.parentElement.style.display=\'none\'">' +
        '</div>' +
        '<span class="playlist-owner-name">' + textHtml + '</span>' +
        '</div>';
    }

    // 无头像：只显示文字
    return '<p class="detail-sub playlist-owner-text">' + textHtml + '</p>';
  }

  /**
   * 简易 MD5 哈希（用于 Gravatar URL）。
   */
  function _md5(str) {
    function _rl(n, c) { return (n << c) | (n >>> (32 - c)); }
    function _add(a, b) { return (a + b) & 0xFFFFFFFF; }
    function _cmn(a, b, c, d, x, s, t) { return _add(_add(b, _add(_add(a, d), _add(x, t))), _rl(s, c), b); }
    function _ff(a, b, c, d, x, s, t) { return _cmn((b & c) | (~b & d), a, b, x, s, t); }
    function _gg(a, b, c, d, x, s, t) { return _cmn((b & d) | (c & ~d), a, b, x, s, t); }
    function _hh(a, b, c, d, x, s, t) { return _cmn(b ^ c ^ d, a, b, x, s, t); }
    function _ii(a, b, c, d, x, s, t) { return _cmn(c ^ (b | ~d), a, b, x, s, t); }
    function _btol(s) {
      var n = s.length, bl = [];
      for (var i = 0; i < n; i += 2) bl.push(parseInt(s.substr(i, 2), 16));
      return bl;
    }
    var x = _btol(_hexstr(str)), len = str.length;
    x[len >> 5] |= 0x80 << (len % 32);
    x[(((len + 64) >>> 9) << 4) + 14] = len;
    var a = 1732584193, b = -271733879, c = -1732584194, d = 271733878;
    for (var i = 0; i < x.length; i += 16) {
      var oa = a, ob = b, oc = c, od = d;
      a = _ff(a, b, c, d, x[i], 7, -680876936); d = _ff(d, a, b, c, x[i+1], 12, -389564586); c = _ff(c, d, a, b, x[i+2], 17, 606105819); b = _ff(b, c, d, a, x[i+3], 22, -1044525330);
      a = _ff(a, b, c, d, x[i+4], 7, -176418897); d = _ff(d, a, b, c, x[i+5], 12, 1200080426); c = _ff(c, d, a, b, x[i+6], 17, -1473231341); b = _ff(b, c, d, a, x[i+7], 22, -45705983);
      a = _ff(a, b, c, d, x[i+8], 7, 1770035416); d = _ff(d, a, b, c, x[i+9], 12, -1958414417); c = _ff(c, d, a, b, x[i+10], 17, -42063); b = _ff(b, c, d, a, x[i+11], 22, -1990404162);
      a = _ff(a, b, c, d, x[i+12], 7, 1804603682); d = _ff(d, a, b, c, x[i+13], 12, -40341101); c = _ff(c, d, a, b, x[i+14], 17, -1502002290); b = _ff(b, c, d, a, x[i+15], 22, 1236535329);
      a = _gg(a, b, c, d, x[i+1], 5, -165796510); d = _gg(d, a, b, c, x[i+6], 9, -1069501632); c = _gg(c, d, a, b, x[i+11], 14, 643717713); b = _gg(b, c, d, a, x[i], 20, -373897724);
      a = _gg(a, b, c, d, x[i+5], 5, -701558691); d = _gg(d, a, b, c, x[i+10], 9, 38016083); c = _gg(c, d, a, b, x[i+15], 14, -660478335); b = _gg(b, c, d, a, x[i+4], 20, -405537848);
      a = _gg(a, b, c, d, x[i+9], 5, 568446438); d = _gg(d, a, b, c, x[i+14], 9, -1019803690); c = _gg(c, d, a, b, x[i+3], 14, -187363961); b = _gg(b, c, d, a, x[i+8], 20, 1163531501);
      a = _gg(a, b, c, d, x[i+13], 5, -1444681467); d = _gg(d, a, b, c, x[i+2], 9, -51403784); c = _gg(c, d, a, b, x[i+7], 14, 1735328473); b = _gg(b, c, d, a, x[i+12], 20, -1926607734);
      a = _hh(a, b, c, d, x[i+5], 4, -378558); d = _hh(d, a, b, c, x[i+8], 11, -2022574463); c = _hh(c, d, a, b, x[i+11], 16, 1839030562); b = _hh(b, c, d, a, x[i+14], 23, -35309556);
      a = _hh(a, b, c, d, x[i+1], 4, -1530992060); d = _hh(d, a, b, c, x[i+4], 11, 1272893353); c = _hh(c, d, a, b, x[i+7], 16, -155497632); b = _hh(b, c, d, a, x[i+10], 23, -1094730640);
      a = _hh(a, b, c, d, x[i+13], 4, 681279174); d = _hh(d, a, b, c, x[i], 11, -358537222); c = _hh(c, d, a, b, x[i+3], 16, -722521979); b = _hh(b, c, d, a, x[i+6], 23, 76029189);
      a = _hh(a, b, c, d, x[i+9], 4, -640364487); d = _hh(d, a, b, c, x[i+12], 11, -421815835); c = _hh(c, d, a, b, x[i+15], 16, 530742520); b = _hh(b, c, d, a, x[i+2], 23, -995338651);
      a = _ii(a, b, c, d, x[i], 6, -198630844); d = _ii(d, a, b, c, x[i+7], 10, 1126898145); c = _ii(c, d, a, b, x[i+14], 15, -1416354905); b = _ii(b, c, d, a, x[i+5], 21, -57434055);
      a = _ii(a, b, c, d, x[i+12], 6, 1700485571); d = _ii(d, a, b, c, x[i+3], 10, -1894986606); c = _ii(c, d, a, b, x[i+10], 15, -1051523); b = _ii(b, c, d, a, x[i+1], 21, -2054922799);
      a = _ii(a, b, c, d, x[i+8], 6, 1873313359); d = _ii(d, a, b, c, x[i+15], 10, -30611744); c = _ii(c, d, a, b, x[i+6], 15, -1565486093); b = _ii(b, c, d, a, x[i+13], 21, 145523017);
      a = _ii(a, b, c, d, x[i+4], 6, -1120210379); d = _ii(d, a, b, c, x[i+11], 10, -780684273); c = _ii(c, d, a, b, x[i+2], 15, 721050079); b = _ii(b, c, d, a, x[i+9], 21, -1019803690);
      a = _ii(a, b, c, d, x[i+16-len] || 0, 6, 568446438); d = _ii(d, a, b, c, x[i+3], 10, -1416354905); c = _ii(c, d, a, b, x[i+10], 15, 165796510); b = _ii(b, c, d, a, x[i+1], 21, -1544107033);
      a = _ii(a, b, c, d, x[i+8-len] || 0, 6, -187363961); d = _ii(d, a, b, c, x[i+15], 10, 1770035416); c = _ii(c, d, a, b, x[i+6], 15, -1958414417); b = _ii(b, c, d, a, x[i+13], 21, -42063);
      a = _add(a, oa); b = _add(b, ob); c = _add(c, oc); d = _add(d, od);
    }
    function _tohex(n) {
      var h = (n >>> 0).toString(16);
      return '00000000'.slice(h.length) + h;
    }
    return _tohex(a) + _tohex(b) + _tohex(c) + _tohex(d);
  }

  function _hexstr(str) {
    var hex = '';
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      if (c < 128) {
        hex += (c < 16 ? '0' : '') + c.toString(16);
      } else if (c < 2048) {
        hex += ((c >> 6) | 192).toString(16) + ((c & 63) | 128).toString(16);
      } else {
        hex += ((c >> 12) | 224).toString(16) + (((c >> 6) & 63) | 128).toString(16) + ((c & 63) | 128).toString(16);
      }
    }
    return hex + '80';
  }

  function _renderDetail(container, playlist) {
    const isRemote = playlist.source === 'subsonic';

    // 确定封面 URL
    let coverUrl = null;
    if (isRemote && playlist.cover_art_id && playlist.server_id && window.__coverBase) {
      coverUrl = window.__coverBase + '/subsonic/cover/' + playlist.server_id + '/' + encodeURIComponent(playlist.cover_art_id);
    }

    // 始终使用英雄式布局
    container.innerHTML = `
      <div class="detail-header playlist-detail-header">
        <button class="back-btn" id="btn-back" data-i18n-aria-label="common.back" data-i18n-title="common.back" aria-label="${App.i18n.t('common.back')}" title="${App.i18n.t('common.back')}">
          <span class="material-symbols-rounded">arrow_back</span>
        </button>
        <div class="detail-cover playlist-detail-cover">
          <div class="detail-cover-blur" id="pl-cover-blur"></div>
          <div class="detail-cover-main" id="pl-cover-main" style="border-radius: 16px;"></div>
        </div>
        <div class="detail-cover-gradient"></div>
        <div class="detail-meta">
          <p class="detail-type">${isRemote ? App.i18n.t('playlist.remote') : App.i18n.t('playlist.local')}</p>
          <h1 class="detail-name">${App.utils.esc(playlist.name)}</h1>
          <p class="detail-sub" id="playlist-count">${App.i18n.t('common.loading')}</p>
          ${_renderOwnerInfo(playlist)}
          <div class="detail-actions">
            <button class="detail-play-btn" id="btn-play-playlist">
              <span class="material-symbols-rounded">play_arrow</span>${App.i18n.t('playlist.play')}
            </button>
            ${isRemote ? `
              <button class="detail-play-btn" id="btn-sync-playlist" title="${App.i18n.t('playlist.syncRemote')}" style="background: var(--md-surface-container); color: var(--md-on-surface);">
                <span class="material-symbols-rounded">sync</span>${App.i18n.t('playlist.sync')}
              </button>
            ` : `
              <button class="detail-play-btn" id="btn-rename-playlist" title="${App.i18n.t('playlist.rename')}" style="background: var(--md-surface-container); color: var(--md-on-surface);">
                <span class="material-symbols-rounded">edit</span>${App.i18n.t('playlist.rename')}
              </button>
              <button class="detail-play-btn" id="btn-delete-playlist" title="${App.i18n.t('playlist.deleteTitle')}" style="background: var(--md-surface-container); color: var(--md-error);">
                <span class="material-symbols-rounded">delete</span>${App.i18n.t('playlist.delete')}
              </button>
            `}
          </div>
        </div>
      </div>
      <div class="playlist-search-wrapper" style="padding: 0 28px 12px;">
        <div class="search-bar">
          <span class="material-symbols-rounded">search</span>
          <input type="text" id="playlist-search" data-i18n-placeholder="playlist.searchPlaceholder" placeholder="${App.i18n.t('playlist.searchPlaceholder')}" aria-label="${App.i18n.t('common.search')}">
        </div>
      </div>
      <ul class="track-list az-list" id="playlist-track-list"></ul>
    `;

    // 对动态插入的 DOM 应用 i18n 翻译
    if (App.i18n && App.i18n.applyToDOM) App.i18n.applyToDOM(container);

    // 设置封面：有封面用封面，无封面用渐变占位符
    const blurEl = document.getElementById('pl-cover-blur');
    const mainEl = document.getElementById('pl-cover-main');
    if (coverUrl) {
      if (blurEl) blurEl.style.backgroundImage = `url(${coverUrl})`;
      if (mainEl) {
        mainEl.style.backgroundImage = `url(${coverUrl})`;
        mainEl.innerHTML = `<img src="${coverUrl}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:16px;" loading="lazy" onerror="this.style.display='none'">`;
      }
    } else {
      // 无封面：使用基于歌单名的渐变色占位符
      const hashColor = App.utils.hashColor(playlist.name);
      if (blurEl) blurEl.style.background = hashColor;
      if (mainEl) {
        mainEl.style.background = hashColor;
        mainEl.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;width:100%;height:100%;background:linear-gradient(135deg, rgba(255,255,255,0.15), rgba(0,0,0,0.15));"><span class="material-symbols-rounded" style="font-size:48px;color:rgba(255,255,255,0.8);">queue_music</span></div>';
      }
    }

    document.getElementById('btn-back').addEventListener('click', function () {
      App.navigate('music');
    });

    const searchInput = document.getElementById('playlist-search');
    searchInput.value = searchText;
    searchInput.addEventListener('input', function (e) {
      searchText = e.target.value;
      filterStr = searchText.trim().toLowerCase();
      _renderList();
    });

    document.getElementById('btn-play-playlist').addEventListener('click', function () {
      if (tracks.length > 0) {
        App.backend.play_from_list(JSON.stringify(tracks), 0);
      }
    });

    if (isRemote) {
      document.getElementById('btn-sync-playlist').addEventListener('click', function () {
        _syncRemotePlaylist(playlist.id);
      });
      _syncRemotePlaylist(playlist.id);
    } else {
      document.getElementById('btn-rename-playlist').addEventListener('click', function () {
        _promptRename(playlist);
      });

      document.getElementById('btn-delete-playlist').addEventListener('click', function () {
        App.utils.confirmDialog({
          title: App.i18n.t('playlist.deleteTitle'),
          body: App.i18n.t('playlist.deleteBody', { name: playlist.name }),
          confirmText: App.i18n.t('playlist.delete'),
          cancelText: App.i18n.t('common.cancel'),
        }).then(function (ok) {
          if (ok) {
            App.utils.call('delete_playlist', playlist.id).then(function () {
              App.navigate('music');
            });
          }
        });
      });

      _loadTracks(playlist.id);
    }
  }

  function _syncRemotePlaylist(playlistId) {
    const syncBtn = document.getElementById('btn-sync-playlist');
    if (syncBtn) {
      syncBtn.disabled = true;
      const icon = syncBtn.querySelector('.material-symbols-rounded');
      if (icon) icon.textContent = 'sync_disabled';
    }
    App.utils.call('sync_remote_playlist', playlistId).then(function (res) {
      const data = JSON.parse(res);
      if (syncBtn) {
        syncBtn.disabled = false;
        const icon = syncBtn.querySelector('.material-symbols-rounded');
        if (icon) icon.textContent = 'sync';
      }
      if (data.ok) {
        App.utils.toast(App.i18n.t('playlist.syncedTrackCount', { name: data.name || '', count: data.trackCount }));
        _loadTracks(playlistId);
      } else {
        App.utils.toast(App.i18n.t('playlist.syncFailed') + '：' + (data.error || App.i18n.t('common.unknown')));
        _loadTracks(playlistId);
      }
    }).catch(function (err) {
      if (syncBtn) {
        syncBtn.disabled = false;
        const icon = syncBtn.querySelector('.material-symbols-rounded');
        if (icon) icon.textContent = 'sync';
      }
      App.utils.toast(App.i18n.t('playlist.syncFailed') + '：' + String(err));
      _loadTracks(playlistId);
    });
  }

  function _promptRename(playlist) {
    // 简易内联输入对话框
    const overlay = document.createElement('div');
    overlay.className = 'cmd-dialog-overlay';
    const dlg = document.createElement('div');
    dlg.className = 'cmd-dialog';
    dlg.innerHTML = `
      <div class="cmd-dialog-title">${App.i18n.t('playlist.renameTitle')}</div>
      <div class="cmd-dialog-body" style="padding:0 24px 12px;">
        <input type="text" id="rename-input" class="settings-font-input" style="width:100%; box-sizing:border-box; padding:10px 12px;" value="${App.utils.esc(playlist.name)}">
      </div>
      <div class="cmd-dialog-actions">
        <button class="cmd-dialog-btn cmd-dialog-btn--cancel">${App.i18n.t('common.cancel')}</button>
        <button class="cmd-dialog-btn cmd-dialog-btn--confirm">${App.i18n.t('common.save')}</button>
      </div>
    `;
    overlay.appendChild(dlg);
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('open'));

    const input = dlg.querySelector('#rename-input');
    input.focus();
    input.select();

    let done = false;
    function close() {
      if (done) return;
      done = true;
      overlay.classList.remove('open');
      setTimeout(() => {
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      }, 180);
    }

    dlg.querySelector('.cmd-dialog-btn--cancel').addEventListener('click', close);
    dlg.querySelector('.cmd-dialog-btn--confirm').addEventListener('click', function () {
      const name = (input.value || '').trim();
      if (!name) return;
      App.utils.call('rename_playlist', playlist.id, name).then(function () {
        currentPlaylist.name = name;
        close();
        // 重新渲染当前页
        const container = document.getElementById('page-container');
        if (container) _renderDetail(container, currentPlaylist);
      });
    });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') dlg.querySelector('.cmd-dialog-btn--confirm').click();
      else if (e.key === 'Escape') close();
    });
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) close();
    });
  }

  function _loadTracks(playlistId) {
    App.utils.call('get_playlist_tracks', playlistId).then(function (res) {
      tracks = JSON.parse(res);
      // 本地歌单：尝试从第一个有封面的曲目设置封面
      if (currentPlaylist && currentPlaylist.source !== 'subsonic') {
        const trackWithCover = tracks.find(t => t.has_cover);
        if (trackWithCover && window.coverUrl) {
          const trackCoverUrl = window.coverUrl(trackWithCover.id);
          const blurEl = document.getElementById('pl-cover-blur');
          const mainEl = document.getElementById('pl-cover-main');
          if (blurEl && !blurEl.querySelector('img')) {
            blurEl.style.background = '';
            blurEl.style.backgroundImage = `url(${trackCoverUrl})`;
          }
          if (mainEl && !mainEl.querySelector('img')) {
            mainEl.style.background = '';
            mainEl.style.backgroundImage = `url(${trackCoverUrl})`;
            mainEl.innerHTML = `<img src="${trackCoverUrl}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:16px;" loading="lazy" onerror="this.style.display='none'">`;
          }
        }
      }
      _renderList();
    });
  }

  function _renderList() {
    const ul = document.getElementById('playlist-track-list');
    if (!ul) return;
    ul.innerHTML = '';

    const list = filterStr ? tracks.filter(t => {
      const q = filterStr;
      return (t.title && t.title.toLowerCase().includes(q)) ||
             (t.artist && t.artist.toLowerCase().includes(q)) ||
             (t.album && t.album.toLowerCase().includes(q));
    }) : tracks;

    const countEl = document.getElementById('playlist-count');
    if (countEl) {
      countEl.textContent = list.length === 0
        ? (filterStr ? App.i18n.t('common.noResults') : App.i18n.t('empty.playlistEmpty'))
        : `${list.length} 首曲目`;
    }

    if (list.length === 0) {
      ul.innerHTML = `
        <div class="empty-state">
          <span class="material-symbols-rounded empty-icon">queue_music</span>
          <h2 class="empty-title">${filterStr ? App.i18n.t('common.noResults') : App.i18n.t('empty.playlistEmpty')}</h2>
        </div>
      `;
      return;
    }

    const frag = document.createDocumentFragment();
    list.forEach((track, i) => {
      const li = App.utils.trackRow(track, i + 1, function (clickedTrack, idx) {
        App.backend.play_from_list(JSON.stringify(list), list.indexOf(clickedTrack));
      }, true);
      // 添加"从歌单移除"按钮（右键菜单中也可提供）
      const removeBtn = document.createElement('button');
      removeBtn.className = 'track-action-btn';
removeBtn.title = App.i18n.t('playlist.removeFromPlaylist');
        removeBtn.setAttribute('aria-label', App.i18n.t('playlist.removeFromPlaylist'));
      removeBtn.innerHTML = '<span class="material-symbols-rounded">playlist_remove</span>';
      removeBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        App.utils.call('remove_from_playlist', currentPlaylist.id, track.id).then(function () {
          _loadTracks(currentPlaylist.id);
        });
      });
      if (!currentPlaylist || currentPlaylist.source !== 'subsonic') {
      li.appendChild(removeBtn);
    }
      frag.appendChild(li);
    });
    ul.appendChild(frag);
  }

  page.updatePlayState = function () {
    const list = document.getElementById('playlist-track-list');
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

  // 歌单列表变化（增删/重命名）时，若当前歌单仍存在则刷新，否则返回音乐页
  page.onPlaylistsChanged = function (jsonStr) {
    let lists = [];
    try { lists = JSON.parse(jsonStr); } catch (e) { return; }
    if (!currentPlaylist) return;
    const stillExists = lists.some(p => p.id === currentPlaylist.id);
    if (!stillExists) {
      App.navigate('music');
      return;
    }
    // 同步名称、owner、owner_email 等元数据变更
    const updated = lists.find(p => p.id === currentPlaylist.id);
    if (updated) {
      let needReRender = false;
      if (updated.name !== currentPlaylist.name) {
        currentPlaylist.name = updated.name;
        const titleEl = document.querySelector('.page-title, .detail-name');
        if (titleEl) titleEl.textContent = updated.name;
      }
      if (updated.owner !== currentPlaylist.owner) {
        currentPlaylist.owner = updated.owner;
        needReRender = true;
      }
      if (updated.owner_email !== currentPlaylist.owner_email) {
        currentPlaylist.owner_email = updated.owner_email;
        needReRender = true;
      }
      if (needReRender) {
        const container = document.getElementById('page-container');
        if (container) _renderDetail(container, currentPlaylist);
      }
    }
    _loadTracks(currentPlaylist.id);
  };

})();
