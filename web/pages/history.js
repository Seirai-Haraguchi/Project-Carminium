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
            <h1 class="page-title" data-i18n="history.title">播放历史</h1>
            <p class="page-subtitle" id="history-count" data-i18n="common.loading">加载中…</p>
          </div>
          <div class="page-actions">
            <button class="btn-filled" id="btn-play-history">
              <span class="material-symbols-rounded">play_arrow</span><span data-i18n="music.playAll">全部播放</span>
            </button>
            <button class="btn-outlined" id="btn-clear-history" data-i18n-title="history.clear">
              <span class="material-symbols-rounded">delete_sweep</span><span data-i18n="history.clear">清空</span>
            </button>
          </div>
        </div>
        <div class="search-bar">
          <span class="material-symbols-rounded">search</span>
          <input type="text" id="history-search" data-i18n-placeholder="history.searchPlaceholder" placeholder="搜索历史曲目…" data-i18n-aria-label="common.search" aria-label="搜索历史">
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
        title: App.i18n.t('history.clearTitle'),
        body: App.i18n.t('history.clearBody'),
        confirmText: App.i18n.t('history.clear'),
        cancelText: App.i18n.t('common.cancel'),
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
        ? (filterStr ? App.i18n.t('common.noResults') : App.i18n.t('history.empty'))
        : App.i18n.t('music.trackCount', { count: list.length });
    }

    if (list.length === 0) {
      ul.innerHTML = `
        <div class="empty-state">
          <span class="material-symbols-rounded empty-icon">history</span>
          <h2 class="empty-title">${filterStr ? App.i18n.t('common.noResults') : App.i18n.t('history.empty')}</h2>
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
