/**
 * Carminium — 播放历史页
 */
(function () {
  'use strict';

  window.App = window.App || {};
  const page = {};
  window.App.pages.history = page;

  let allHistory = [];
  let filterStr = '';
  let searchText = '';

  page.render = function (container) {
    container.innerHTML = `
      <div class="page-sticky-header">
        <div class="page-header">
          <div class="page-header-left">
            <h1 class="page-title">播放历史</h1>
            <p class="page-subtitle" id="history-count">加载中…</p>
          </div>
          <div class="page-actions">
            <button class="btn-filled" id="btn-play-history">
              <span class="material-symbols-rounded">play_arrow</span>全部播放
            </button>
            <button class="btn-outlined" id="btn-clear-history" title="清空历史">
              <span class="material-symbols-rounded">delete_sweep</span>清空
            </button>
          </div>
        </div>
        <div class="search-bar">
          <span class="material-symbols-rounded">search</span>
          <input type="text" id="history-search" placeholder="搜索历史曲目…" aria-label="搜索历史">
        </div>
      </div>
      <ul class="track-list az-list" id="history-list"></ul>
    `;

    const searchInput = document.getElementById('history-search');
    searchInput.value = searchText;
    searchInput.addEventListener('input', function (e) {
      searchText = e.target.value;
      filterStr = searchText.trim().toLowerCase();
      _renderList();
    });

    document.getElementById('btn-play-history').addEventListener('click', function () {
      if (allHistory.length > 0) {
        App.backend.play_from_list(JSON.stringify(allHistory), 0);
      }
    });

    document.getElementById('btn-clear-history').addEventListener('click', function () {
      if (allHistory.length === 0) return;
      App.utils.confirmDialog({
        title: '清空播放历史',
        body: '将清除全部播放历史记录，此操作不可撤销。是否继续？',
        confirmText: '清空',
        cancelText: '取消',
      }).then(function (ok) {
        if (ok) {
          App.utils.call('clear_play_history').then(function () {
            allHistory = [];
            _renderList();
          });
        }
      });
    });

    _loadHistory();
  };

  function _loadHistory() {
    App.utils.call('get_play_history', 200).then(function (res) {
      allHistory = JSON.parse(res);
      _renderList();
    });
  }

  function _renderList() {
    const ul = document.getElementById('history-list');
    if (!ul) return;
    ul.innerHTML = '';

    const list = filterStr ? allHistory.filter(t => {
      const q = filterStr;
      return (t.title && t.title.toLowerCase().includes(q)) ||
             (t.artist && t.artist.toLowerCase().includes(q)) ||
             (t.album && t.album.toLowerCase().includes(q));
    }) : allHistory;

    const countEl = document.getElementById('history-count');
    if (countEl) {
      countEl.textContent = list.length === 0
        ? (filterStr ? '无结果' : '暂无播放历史')
        : `${list.length} 首曲目`;
    }

    if (list.length === 0) {
      ul.innerHTML = `
        <div class="empty-state">
          <span class="material-symbols-rounded empty-icon">history</span>
          <h2 class="empty-title">${filterStr ? '无结果' : '暂无播放历史'}</h2>
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
    const list = document.getElementById('history-list');
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

  // 历史变化时刷新（若当前在历史页）
  page.onHistoryChanged = function (jsonStr) {
    try {
      allHistory = JSON.parse(jsonStr);
    } catch (e) {
      return;
    }
    if (document.getElementById('history-list')) {
      _renderList();
    }
  };

})();
