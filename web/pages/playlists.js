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
      name: params.playlist_name || '歌单',
    };
    _renderDetail(container, currentPlaylist);
  };

  function _renderEmpty(container) {
    container.innerHTML = `
      <div class="empty-state" style="margin-top: 120px;">
        <span class="material-symbols-rounded empty-icon">queue_music</span>
        <h2 class="empty-title">未选择歌单</h2>
        <p class="empty-sub">从左侧「歌单」按钮中选择一个歌单</p>
      </div>
    `;
  }

  function _renderDetail(container, playlist) {
    container.innerHTML = `
      <div class="page-sticky-header">
        <div class="page-header">
          <div class="page-header-left">
            <button class="back-btn" id="btn-back" aria-label="返回" title="返回">
              <span class="material-symbols-rounded">arrow_back</span>
            </button>
            <h1 class="page-title">${App.utils.esc(playlist.name)}</h1>
            <p class="page-subtitle" id="playlist-count">加载中…</p>
          </div>
          <div class="page-actions">
            <button class="btn-filled" id="btn-play-playlist">
              <span class="material-symbols-rounded">play_arrow</span>播放
            </button>
            <button class="btn-outlined" id="btn-rename-playlist" title="重命名">
              <span class="material-symbols-rounded">edit</span>重命名
            </button>
            <button class="btn-outlined" id="btn-delete-playlist" title="删除歌单" style="color:var(--md-error)">
              <span class="material-symbols-rounded">delete</span>删除
            </button>
          </div>
        </div>
        <div class="search-bar">
          <span class="material-symbols-rounded">search</span>
          <input type="text" id="playlist-search" placeholder="搜索歌单曲目…" aria-label="搜索歌单">
        </div>
      </div>
      <ul class="track-list az-list" id="playlist-track-list"></ul>
    `;

    document.getElementById('btn-back').addEventListener('click', function () {
      // 返回上一页（音乐页）
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

    document.getElementById('btn-rename-playlist').addEventListener('click', function () {
      _promptRename(playlist);
    });

    document.getElementById('btn-delete-playlist').addEventListener('click', function () {
      App.utils.confirmDialog({
        title: '删除歌单',
        body: `将删除歌单「${playlist.name}」，歌单内的曲目不会被删除。此操作不可撤销。是否继续？`,
        confirmText: '删除',
        cancelText: '取消',
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

  function _promptRename(playlist) {
    // 简易内联输入对话框
    const overlay = document.createElement('div');
    overlay.className = 'cmd-dialog-overlay';
    const dlg = document.createElement('div');
    dlg.className = 'cmd-dialog';
    dlg.innerHTML = `
      <div class="cmd-dialog-title">重命名歌单</div>
      <div class="cmd-dialog-body" style="padding:0 24px 12px;">
        <input type="text" id="rename-input" class="settings-font-input" style="width:100%; box-sizing:border-box; padding:10px 12px;" value="${App.utils.esc(playlist.name)}">
      </div>
      <div class="cmd-dialog-actions">
        <button class="cmd-dialog-btn cmd-dialog-btn--cancel">取消</button>
        <button class="cmd-dialog-btn cmd-dialog-btn--confirm">保存</button>
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
        ? (filterStr ? '无结果' : '歌单为空')
        : `${list.length} 首曲目`;
    }

    if (list.length === 0) {
      ul.innerHTML = `
        <div class="empty-state">
          <span class="material-symbols-rounded empty-icon">queue_music</span>
          <h2 class="empty-title">${filterStr ? '无结果' : '歌单为空'}</h2>
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
      removeBtn.title = '从歌单移除';
      removeBtn.setAttribute('aria-label', '从歌单移除');
      removeBtn.innerHTML = '<span class="material-symbols-rounded">playlist_remove</span>';
      removeBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        App.utils.call('remove_from_playlist', currentPlaylist.id, track.id).then(function () {
          _loadTracks(currentPlaylist.id);
        });
      });
      li.appendChild(removeBtn);
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
    // 若名称被修改，同步更新标题
    const updated = lists.find(p => p.id === currentPlaylist.id);
    if (updated && updated.name !== currentPlaylist.name) {
      currentPlaylist.name = updated.name;
      const titleEl = document.querySelector('.page-title');
      if (titleEl) titleEl.textContent = updated.name;
    }
    _loadTracks(currentPlaylist.id);
  };

})();
