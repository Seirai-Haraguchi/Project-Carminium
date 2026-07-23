/**
 * Carminium — 喜爱的音乐页
 */
(function () {
  'use strict';

  window.App = window.App || {};
  const page = {};
  window.App.pages.liked = page;

  let allLiked = [];
  let filterStr = '';
  let searchText = '';

  page.render = function (container) {
    container.innerHTML = `
      <div class="page-sticky-header">
        <div class="page-header">
          <div class="page-header-left">
            <h1 class="page-title">喜爱的音乐</h1>
            <p class="page-subtitle" id="liked-count">加载中…</p>
          </div>
          <div class="page-actions">
            <button class="btn-filled" id="btn-play-liked">
              <span class="material-symbols-rounded">play_arrow</span>全部播放
            </button>
          </div>
        </div>
        <div class="search-bar">
          <span class="material-symbols-rounded">search</span>
          <input type="text" id="liked-search" placeholder="搜索喜爱的曲目…" aria-label="搜索喜爱">
        </div>
      </div>
      <ul class="track-list az-list" id="liked-list"></ul>
    `;

    const searchInput = document.getElementById('liked-search');
    searchInput.value = searchText;
    searchInput.addEventListener('input', function (e) {
      searchText = e.target.value;
      filterStr = searchText.trim().toLowerCase();
      _renderList();
    });

    document.getElementById('btn-play-liked').addEventListener('click', function () {
      if (allLiked.length > 0) {
        App.backend.play_from_list(JSON.stringify(allLiked), 0);
      }
    });

    _loadLiked();
  };

  function _loadLiked() {
    App.utils.call('get_liked_tracks').then(function (res) {
      allLiked = JSON.parse(res);
      _renderList();
    });
  }

  function _renderList() {
    const ul = document.getElementById('liked-list');
    if (!ul) return;
    ul.innerHTML = '';

    const list = filterStr ? allLiked.filter(t => {
      const q = filterStr;
      return (t.title && t.title.toLowerCase().includes(q)) ||
             (t.artist && t.artist.toLowerCase().includes(q)) ||
             (t.album && t.album.toLowerCase().includes(q));
    }) : allLiked;

    const countEl = document.getElementById('liked-count');
    if (countEl) {
      countEl.textContent = list.length === 0
        ? (filterStr ? '无结果' : '暂未收藏任何曲目')
        : `${list.length} 首曲目`;
    }

    if (list.length === 0) {
      ul.innerHTML = `
        <div class="empty-state">
          <span class="material-symbols-rounded empty-icon">favorite_border</span>
          <h2 class="empty-title">${filterStr ? '无结果' : '暂未收藏任何曲目'}</h2>
        </div>
      `;
      return;
    }

    const frag = document.createDocumentFragment();
    list.forEach((track, i) => {
      const li = App.utils.trackRow(track, i + 1, function (clickedTrack, idx) {
        App.backend.play_from_list(JSON.stringify(list), list.indexOf(clickedTrack));
      }, true);
      frag.appendChild(li);
    });
    ul.appendChild(frag);
  }

  page.updatePlayState = function () {
    const list = document.getElementById('liked-list');
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

  // 喜爱列表变化时刷新（若当前在喜爱页）
  page.onLikedTracksChanged = function (jsonStr) {
    try {
      allLiked = JSON.parse(jsonStr);
    } catch (e) {
      return;
    }
    if (document.getElementById('liked-list')) {
      _renderList();
    }
  };

})();
