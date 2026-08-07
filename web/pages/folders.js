/**
 * Carminium — 文件夹页（媒体库管理）
 */
(function () {
  'use strict';

  window.App = window.App || {};
  const page = {};
  window.App.pages.folders = page;

  let allFolders = [];
  let filterStr = '';
  let searchText = '';

page.render = function (container) {
container.innerHTML = `
      <div class="page-sticky-header">
        <div class="page-header">
          <div class="page-header-left">
            <h1 class="page-title" data-i18n="folders.title">媒体库</h1>
            <p class="page-subtitle" id="library-count" data-i18n="folders.hint">添加本地音乐文件夹以构建您的媒体库。</p>
          </div>
          <div class="page-actions">
            <button class="btn-filled" id="btn-add-folder">
              <span class="material-symbols-rounded">create_new_folder</span><span data-i18n="folders.addLocal">添加本地文件夹</span>
            </button>
            <button class="btn-outlined" id="btn-add-subsonic">
              <span class="material-symbols-rounded">cloud</span><span data-i18n="folders.addSubsonic">添加流媒体库</span>
            </button>
          </div>
        </div>
        <div class="search-bar">
          <span class="material-symbols-rounded">search</span>
          <input type="text" id="folder-search" data-i18n-placeholder="folders.searchPlaceholder" placeholder="搜索文件夹或流媒体库…" data-i18n-aria-label="common.search" aria-label="搜索">
        </div>
      </div>
      <div class="folder-list" id="folder-list"></div>
    `;

    const searchInput = document.getElementById('folder-search');
    searchInput.value = searchText;
    searchInput.addEventListener('input', function (e) {
      searchText = e.target.value;
      filterStr = searchText.trim().toLowerCase();
      _renderList();
    });

    document.getElementById('btn-add-folder').addEventListener('click', function () {
      App.utils.call('open_folder_dialog').then(function (path) {
        if (path) {
          // 显示扫描中状态，直到收到 folders_updated 事件（后台扫描完成）
          document.getElementById('folder-list').innerHTML = `
            <div class="empty-state">
              <span class="material-symbols-rounded empty-icon" style="animation: pulse 2s infinite;">sync</span>
              <h2 class="empty-title" data-i18n="folders.scanning">扫描中</h2>
              <p class="empty-sub">${App.i18n.t('folders.scanningPath')} ${App.utils.esc(path)}</p>
            </div>
          `;
          // add_folder 立即返回（扫描在后台线程执行），
          // folders_updated 事件会在扫描完成后触发 onFoldersUpdated 刷新列表
          App.utils.call('add_folder', path).catch(function (err) {
            _loadFolders();  // 出错时恢复列表
          });
        }
      });
    });

    document.getElementById('btn-add-subsonic').addEventListener('click', function () {
      _promptAddSubsonic();
    });

    _loadFolders();
    _renderList();
  };

  function _loadFolders() {
    // 从前端缓存读取（启动时已拉取，folders_updated 时刷新）
    allFolders = (App.state && App.state.allFolders) ? App.state.allFolders : [];
    _renderList();
  }

  function _renderList() {
    const listEl = document.getElementById('folder-list');
    if (!listEl) return;

    const servers = (App.state && App.state.allSubsonicServers) ? App.state.allSubsonicServers : [];

    // 本地文件夹 + 流媒体库混排（图标已区分类型），本地在前
    let entries = [];
    allFolders.forEach(f => entries.push({ kind: 'folder', data: f }));
    servers.forEach(s => entries.push({ kind: 'server', data: s }));

    if (filterStr) {
      entries = entries.filter(e => {
        if (e.kind === 'folder') {
          return e.data.path && e.data.path.toLowerCase().includes(filterStr);
        }
        const s = e.data;
        return (s.name && s.name.toLowerCase().includes(filterStr)) ||
               (s.server_url && s.server_url.toLowerCase().includes(filterStr));
      });
    }

    // 页副标题：合并计数（过滤时显示 命中/总数）
    const countEl = document.getElementById('library-count');
    const total = allFolders.length + servers.length;
    if (countEl) {
      countEl.textContent = filterStr
        ? App.i18n.t('folders.filteredShort', { shown: entries.length, total: total })
        : (total === 0 ? App.i18n.t('folders.hint') : App.i18n.t('folders.sourceCount', { count: total }));
    }

    if (entries.length === 0) {
      listEl.innerHTML = `
        <div class="empty-state">
          <span class="material-symbols-rounded empty-icon">folder_open</span>
          <h2 class="empty-title">${filterStr ? App.i18n.t('common.noResults') : App.i18n.t('folders.empty')}</h2>
        </div>
      `;
      return;
    }

    listEl.innerHTML = '';
    const frag = document.createDocumentFragment();
    entries.forEach(e => {
      const row = e.kind === 'folder' ? _buildFolderRow(e.data) : _buildServerRow(e.data);
      if (row) frag.appendChild(row);
    });
    listEl.appendChild(frag);
    // 对动态插入的 DOM 应用 i18n 翻译
    if (App.i18n && App.i18n.applyToDOM) App.i18n.applyToDOM(listEl);
  }

  // 构建单个本地文件夹行（DOM 元素）
  function _buildFolderRow(folder) {
    const row = document.createElement('div');
    row.className = 'folder-row';

    const scanDate = App.utils.formatDate(folder.last_scan);
    row.innerHTML = `
      <span class="folder-icon-badge"><span class="material-symbols-rounded folder-icon">folder</span></span>
      <div class="folder-info">
        <p class="folder-path" title="${App.utils.esc(folder.path)}">${App.utils.esc(folder.path)}</p>
        <div class="folder-meta">
          <span class="folder-chip"><span class="material-symbols-rounded">music_note</span>${App.i18n.t('music.trackCount', { count: folder.track_count })}</span>
          <span class="folder-chip"><span class="material-symbols-rounded">schedule</span>${App.i18n.t('folders.lastScan', { date: scanDate })}</span>
        </div>
      </div>
      <div class="folder-actions">
        <button class="icon-btn btn-rescan" data-i18n-aria-label="folders.rescan" data-i18n-title="folders.rescan">
          <span class="material-symbols-rounded">sync</span>
        </button>
        <button class="icon-btn btn-remove" data-i18n-aria-label="folders.remove" data-i18n-title="folders.removeFolder" style="color:var(--md-error)">
          <span class="material-symbols-rounded">delete</span>
        </button>
      </div>
    `;

    row.querySelector('.btn-rescan').addEventListener('click', function () {
      const btn = this;
      const icon = btn.querySelector('.material-symbols-rounded');
      icon.style.animation = 'pulse 1s infinite';
      btn.disabled = true;
      App.utils.call('rescan_folder', folder.path).catch(function () {
        icon.style.animation = '';
        btn.disabled = false;
      });
    });
    row.querySelector('.btn-remove').addEventListener('click', function () {
      if (confirm(App.i18n.t('folders.removeConfirm', { path: folder.path }))) {
        App.utils.call('remove_folder', folder.path).then(() => _loadFolders());
      }
    });
    return row;
  }

  // 构建单个流媒体库（Subsonic 服务器）行（DOM 元素）
  function _buildServerRow(srv) {
    const row = document.createElement('div');
    row.className = 'folder-row subsonic-server-row';
    row.setAttribute('data-server-id', srv.id);

    const lastSync = srv.last_sync ? App.utils.formatDate(srv.last_sync) : App.i18n.t('folders.notSynced');
    const protocolLabel = srv.protocol_mode === 'opensubsonic' ? 'OpenSubsonic' : 'Subsonic';
    const pending = _pendingSync[srv.id];
    const isSyncing = !!pending;
    const metaHtml = isSyncing
      ? _formatSyncingMeta(pending.lastStats)
      : `<span class="folder-chip folder-chip--url" title="${App.utils.esc(srv.server_url)}"><span class="material-symbols-rounded">language</span>${App.utils.esc(srv.server_url)}</span>`
        + `<span class="folder-chip"><span class="material-symbols-rounded">music_note</span>${App.i18n.t('music.trackCount', { count: srv.track_count || 0 })}</span>`
        + `<span class="folder-chip"><span class="material-symbols-rounded">api</span>${protocolLabel}</span>`
        + `<span class="folder-chip"><span class="material-symbols-rounded">sync</span>${App.i18n.t('folders.lastSync', { date: lastSync })}</span>`;

    row.innerHTML = `
      <span class="folder-icon-badge folder-icon-badge--cloud"><span class="material-symbols-rounded folder-icon">cloud</span></span>
      <div class="folder-info">
        <p class="folder-path" title="${App.utils.esc(srv.name + ' — ' + srv.server_url)}">${App.utils.esc(srv.name)}</p>
        <div class="folder-meta">${metaHtml}</div>
      </div>
      <div class="folder-actions">
        <button class="icon-btn btn-subsonic-sync" data-server-id="${srv.id}" data-i18n-aria-label="folders.sync" data-i18n-title="folders.sync"${isSyncing ? ' disabled' : ''}>
          <span class="material-symbols-rounded"${isSyncing ? ' style="animation:pulse 1s infinite"' : ''}>sync</span>
        </button>
        <button class="icon-btn btn-subsonic-edit" data-server-id="${srv.id}" data-i18n-aria-label="folders.edit" data-i18n-title="folders.editServer">
          <span class="material-symbols-rounded">edit</span>
        </button>
        <button class="icon-btn btn-subsonic-remove" data-server-id="${srv.id}" data-i18n-aria-label="folders.remove" data-i18n-title="folders.remove" style="color:var(--md-error)">
          <span class="material-symbols-rounded">delete</span>
        </button>
      </div>
    `;

    // 同步中：更新 _pendingSync 引用到新 DOM，后续 progress 事件能继续更新
    if (isSyncing) {
      pending.icon = row.querySelector('.btn-subsonic-sync .material-symbols-rounded');
      pending.metaEl = row.querySelector('.folder-meta');
    }

    // 绑定事件
    row.querySelector('.btn-subsonic-sync').addEventListener('click', function () {
      if (this.disabled) return;
      _startSyncWithOverlay(srv.id, srv.name);
    });
    row.querySelector('.btn-subsonic-edit').addEventListener('click', function () {
      _promptEditSubsonic(srv);
    });
    row.querySelector('.btn-subsonic-remove').addEventListener('click', function () {
      App.utils.confirmDialog({
        title: App.i18n.t('folders.removeServerTitle'),
        body: App.i18n.t('folders.removeServerBody', { name: srv.name }),
        confirmText: App.i18n.t('folders.remove'),
        cancelText: App.i18n.t('common.cancel'),
      }).then(function (ok) {
        if (ok) App.utils.call('remove_subsonic_server', srv.id);
      });
    });

    return row;
  }

  // Handle signal push
  page.onFoldersUpdated = function (jsonStr) {
    // app.js 已在 folders_updated 时刷新 App.state.allFolders 缓存
    if (document.getElementById('folder-list')) {
      allFolders = (App.state && App.state.allFolders) ? App.state.allFolders : (jsonStr ? JSON.parse(jsonStr) : []);
      _renderList();  // _renderList 会重建 DOM，rescan 按钮的 loading 状态自然清除
    }
  };

  // ── Subsonic 服务器列表渲染 ───────────────────────────────────────────────
  page.onSubsonicServersUpdated = function (/* jsonStr */) {
    // 本地文件夹与流媒体库混排，服务器变化直接重渲染整张列表
    if (document.getElementById('folder-list')) {
      _renderList();
    }
  };

  // 构造同步中状态的 meta 行 HTML
  function _formatSyncingMeta(lastStats) {
    if (!lastStats) {
      return '<span style="color:var(--md-primary)">' + App.i18n.t('folders.syncingBg') + '</span>';
    }
    return '<span style="color:var(--md-primary)">' + App.i18n.t('folders.syncingProgress', { tracks: lastStats.tracks || 0, albums: lastStats.albums || 0 }) + '</span>';
  }

  // 当前正在等待同步结果的 server_id → {lastStats: {tracks, albums, artists} | null}
  var _pendingSync = {};

  // 由 app.js 的 subsonic_sync_result 信号订阅调用
  page.onSubsonicSyncResult = function (data) {
    // 全屏同步遮罩优先接管（添加服务器后的同步流程）
    if (_syncOverlay && data && _syncOverlay.serverId === data.server_id) {
      _syncOverlay.onResult(data);
      return;
    }
    if (!_pendingSync[data.server_id]) return;
    delete _pendingSync[data.server_id];
    // 重新渲染恢复正常显示（last_sync、track_count 由 subsonic_servers_changed 更新）
    _renderList();

    if (data.ok) {
      var stats = data.stats || {};
      var msg = App.i18n.t('folders.syncComplete', { artists: stats.artists || 0, albums: stats.albums || 0, tracks: stats.tracks || 0 });
      console.log('[subsonic]', msg);
      if (stats.tracks === 0) {
        var warns = (stats.warnings || []).slice(0, 3).join('\n');
        alert(App.i18n.t('folders.syncNoTracks') + '\n' + msg + (warns ? '\n\n' + App.i18n.t('folders.diagnostics') + ':\n' + warns : ''));
      } else {
        // 建议用户重启程序以避免潜在的缓存/状态不一致问题
        App.utils.confirmDialog({
          title: App.i18n.t('folders.syncCompleteTitle'),
          body: msg + '\n\n' + App.i18n.t('folders.restartHint'),
          confirmText: App.i18n.t('folders.restartApp'),
          cancelText: App.i18n.t('folders.later'),
        }).then(function (ok) {
          if (ok) App.utils.call('restart_app');
        });
      }
    } else {
      var err = data.error || App.i18n.t('folders.unknownError');
      var warns2 = (data.warnings || []).slice(0, 5).join('\n');
      alert(App.i18n.t('folders.syncFailed', { error: err }) + (warns2 ? '\n\n' + App.i18n.t('folders.diagnostics') + ':\n' + warns2 : ''));
    }
  };

  // 由 app.js 的 subsonic_sync_progress 信号订阅调用（实时进度）
  page.onSubsonicSyncProgress = function (data) {
    if (!data || data.server_id == null) return;
    // 全屏同步遮罩优先处理
    if (_syncOverlay && _syncOverlay.serverId === data.server_id) {
      _syncOverlay.onProgress(data);
    }
    var pending = _pendingSync[data.server_id];
    if (!pending) return;
    if (data.stage === 'progress') {
      pending.lastStats = {
        tracks: data.tracks || 0,
        albums: data.albums || 0,
        artists: data.artists || 0,
      };
      // 更新当前 DOM（如果 folders 页可见）
      var row = document.querySelector(
        '.subsonic-server-row[data-server-id="' + data.server_id + '"]'
      );
      var metaEl = row ? row.querySelector('.folder-meta') : null;
      if (metaEl) {
        metaEl.innerHTML = _formatSyncingMeta(pending.lastStats);
      }
    }
  };

  // ── 添加服务器后的全屏同步遮罩 ────────────────────────────────────────────
  // 当前全屏同步遮罩实例：{ serverId, onProgress, onResult, close } 或 null
  var _syncOverlay = null;

  // 阶段文案映射
  var _PHASE_LABELS = {
    'artists': App.i18n.t('folders.phaseArtists'),
    'albums': App.i18n.t('folders.phaseAlbums'),
    'tracks': App.i18n.t('folders.phaseTracks'),
  };

  function _showSyncOverlay(serverId, serverName) {
    // 若已存在遮罩则先移除
    if (_syncOverlay) { _syncOverlay.close(); }

    var overlay = document.createElement('div');
    overlay.className = 'sync-overlay';
    overlay.innerHTML = `
      <div class="sync-overlay-card">
        <div class="sync-overlay-head">
          <h2 class="sync-overlay-title" id="so-title">正在同步</h2>
          <p class="sync-overlay-server" id="so-server">${App.utils.esc(serverName || '')}</p>
        </div>
        <div class="sync-overlay-body" id="so-body">
          <div class="sync-progress-track">
            <div class="sync-progress-bar" id="so-bar-wrap">
              <div class="sync-progress-fill" id="so-bar-fill" style="width:0%"></div>
            </div>
            <p class="sync-progress-label" id="so-phase-text">正在连接服务器…</p>
          </div>
          <p class="sync-current-item" id="so-current"></p>
        </div>
        <div class="sync-overlay-actions" id="so-actions"></div>
      </div>
    `;
    document.body.appendChild(overlay);
    requestAnimationFrame(function () { overlay.classList.add('open'); });

    var titleEl = overlay.querySelector('#so-title');
    var bodyEl = overlay.querySelector('#so-body');
    var phaseTextEl = overlay.querySelector('#so-phase-text');
    var barWrap = overlay.querySelector('#so-bar-wrap');
    var barFill = overlay.querySelector('#so-bar-fill');
    var currentEl = overlay.querySelector('#so-current');
    var actionsEl = overlay.querySelector('#so-actions');

    var finished = false;

    function setProgress(done, total) {
      if (total > 0) {
        barWrap.style.display = '';
        var pct = Math.min(100, Math.round((done / total) * 100));
        barFill.style.width = pct + '%';
      }
    }

    function setCurrentItem(artist, album) {
      var text = '';
      if (album && artist) text = artist + ' — ' + album;
      else if (album) text = album;
      else if (artist) text = artist;
      if (text) {
        currentEl.style.display = '';
        currentEl.textContent = text;
      } else {
        currentEl.style.display = 'none';
      }
    }

    function showDoneButton(label) {
      actionsEl.innerHTML = '<button class="btn-filled" id="so-done">' + label + '</button>';
      overlay.querySelector('#so-done').addEventListener('click', close);
    }

    function showDoneWithRestart(label) {
      actionsEl.innerHTML =
        '<button class="btn-outlined" id="so-done">' + label + '</button>' +
        '<button class="btn-filled" id="so-restart">' + App.i18n.t('folders.restartApp') + '</button>';
      overlay.querySelector('#so-done').addEventListener('click', close);
      overlay.querySelector('#so-restart').addEventListener('click', function () {
        App.utils.call('restart_app');
      });
    }

    var api = {
      serverId: serverId,
      onProgress: function (data) {
        if (finished) return;
        var phase = data.phase || 'tracks';
        var label = _PHASE_LABELS[phase] || App.i18n.t('folders.syncing');
        var done = data.done || 0;
        var total = data.total || 0;

        if (phase === 'artists') done = data.artists || done;
        if (phase === 'tracks') done = data.albums || done;

        setProgress(done, total);
        phaseTextEl.textContent = label + (total > 0 ? '  ' + done + ' / ' + total : '…');
        setCurrentItem(data.current_artist || '', data.current_album || '');
      },
      onResult: function (data) {
        if (finished) return;
        finished = true;
        if (data.ok) {
          var stats = data.stats || {};
          titleEl.textContent = App.i18n.t('folders.syncCompleteTitle');
          var t = stats.tracks || 0;
          phaseTextEl.textContent = (t === 0)
            ? App.i18n.t('folders.syncNoTracksHint')
            : App.i18n.t('folders.indexedTracks', { count: t });
          barFill.style.width = '100%';
          currentEl.style.display = 'none';
          // 建议用户重启程序以避免潜在的缓存/状态不一致问题
          var restartHint = document.createElement('p');
          restartHint.className = 'sync-restart-hint';
          restartHint.textContent = App.i18n.t('folders.restartHintShort');
          actionsEl.parentNode.insertBefore(restartHint, actionsEl);
          showDoneWithRestart(App.i18n.t('folders.done'));
        } else {
          var err = data.error || App.i18n.t('folders.unknownError');
          titleEl.textContent = App.i18n.t('folders.syncFailedTitle');
          bodyEl.style.display = 'none';
          var errBox = document.createElement('div');
          errBox.className = 'sync-overlay-error';
          var warns = (data.warnings || []).slice(0, 5).join('\n');
          errBox.textContent = err + (warns ? '\n\n' + App.i18n.t('folders.diagnostics') + ':\n' + warns : '');
          actionsEl.parentNode.insertBefore(errBox, actionsEl);
          showDoneButton(App.i18n.t('common.close'));
        }
      },
      close: close,
    };

    function close() {
      if (_syncOverlay === api) _syncOverlay = null;
      overlay.classList.remove('open');
      setTimeout(function () {
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      }, 200);
    }


    _syncOverlay = api;
    return api;
  }

  // 启动后台同步并显示全屏遮罩
  function _startSyncWithOverlay(serverId, serverName) {
    _showSyncOverlay(serverId, serverName);
    App.utils.call('sync_subsonic_server', serverId).then(function (syncRes) {
      try {
        var data = JSON.parse(syncRes);
        if (!data.ok && _syncOverlay && _syncOverlay.serverId === serverId) {
          // 立即失败（如重复同步、服务器不存在）
          _syncOverlay.onResult({
            ok: false,
            server_id: serverId,
            error: data.error || App.i18n.t('folders.syncStartFailed'),
          });
        }
        // data.ok=true：后台同步已启动，等待 progress/result 事件
      } catch (e) { /* ignore */ }
    }).catch(function (err) {
      if (_syncOverlay && _syncOverlay.serverId === serverId) {
        _syncOverlay.onResult({
          ok: false,
          server_id: serverId,
          error: App.i18n.t('folders.syncRequestFailed', { error: (err && err.message ? err.message : err) }),
        });
      }
    });
  }

  // ── 添加 Subsonic 服务器对话框 ────────────────────────────────────────────
  function _promptAddSubsonic() {
    const overlay = document.createElement('div');
    overlay.className = 'cmd-dialog-overlay';
    const dlg = document.createElement('div');
    dlg.className = 'cmd-dialog subsonic-add-dialog';
    dlg.innerHTML = `
      <div class="cmd-dialog-title">${App.i18n.t('folders.addServerTitle')}</div>
      <div class="cmd-dialog-body">
        <div class="cmd-text-field" style="margin-bottom:12px;">
          <input type="text" id="ss-name" class="cmd-text-field__input" placeholder=" " autocomplete="off">
          <label class="cmd-text-field__label">${App.i18n.t('folders.serverName')}</label>
        </div>
        <div class="cmd-text-field" style="margin-bottom:12px;">
          <input type="text" id="ss-url" class="cmd-text-field__input" placeholder=" " autocomplete="off">
          <label class="cmd-text-field__label">${App.i18n.t('folders.serverUrl')}</label>
        </div>
        <div class="cmd-text-field" style="margin-bottom:12px;">
          <input type="text" id="ss-user" class="cmd-text-field__input" placeholder=" " autocomplete="off">
          <label class="cmd-text-field__label">${App.i18n.t('folders.username')}</label>
        </div>
        <div class="cmd-text-field" style="margin-bottom:12px;">
          <input type="password" id="ss-pass" class="cmd-text-field__input" placeholder=" " autocomplete="off">
          <label class="cmd-text-field__label">${App.i18n.t('folders.password')}</label>
        </div>
        <div class="cmd-text-field">
          <select id="ss-protocol" class="cmd-text-field__input">
            <option value="subsonic">Subsonic 1.16</option>
            <option value="opensubsonic">OpenSubsonic</option>
          </select>
          <label class="cmd-text-field__label">${App.i18n.t('folders.protocol')}</label>
        </div>
      </div>
      <div class="cmd-dialog-actions">
        <button class="cmd-dialog-btn cmd-dialog-btn--cancel">${App.i18n.t('common.cancel')}</button>
        <button class="cmd-dialog-btn" id="ss-btn-test">${App.i18n.t('folders.test')}</button>
        <button class="cmd-dialog-btn cmd-dialog-btn--confirm">${App.i18n.t('folders.add')}</button>
      </div>
    `;
    overlay.appendChild(dlg);
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('open'));

    const nameInput = dlg.querySelector('#ss-name');
    setTimeout(() => nameInput.focus(), 50);

    let done = false;
    let adding = false;
    function close() {
      if (done) return;
      done = true;
      overlay.classList.remove('open');
      setTimeout(() => {
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      }, 180);
    }

    function collect() {
      const name = (nameInput.value || '').trim();
      const url = (dlg.querySelector('#ss-url').value || '').trim();
      const user = (dlg.querySelector('#ss-user').value || '').trim();
      const pass = dlg.querySelector('#ss-pass').value || '';
      const protocol = dlg.querySelector('#ss-protocol').value || 'subsonic';
      return { name: name, url: url, user: user, pass: pass, protocol: protocol };
    }

    function validate(d) {
      if (!d.name) { nameInput.focus(); return App.i18n.t('folders.errName'); }
      if (!d.url) { dlg.querySelector('#ss-url').focus(); return App.i18n.t('folders.errUrl'); }
      if (!d.user) { dlg.querySelector('#ss-user').focus(); return App.i18n.t('folders.errUser'); }
      if (!d.pass) { dlg.querySelector('#ss-pass').focus(); return App.i18n.t('folders.errPass'); }
      return null;
    }

    function add() {
      if (adding) return;
      const d = collect();
      const err = validate(d);
      if (err) { alert(err); return; }
      adding = true;
      const confirmBtn = dlg.querySelector('.cmd-dialog-btn--confirm');
      confirmBtn.disabled = true;
      App.utils.call('add_subsonic_server', d.name, d.url, d.user, d.pass, d.protocol).then(function (res) {
        var srvId = null;
        try { srvId = JSON.parse(res).id; } catch (e) { /* ignore */ }
        close();
        if (srvId) {
          // 显示全屏同步遮罩，展示进度与结果
          _startSyncWithOverlay(srvId, d.name);
        } else {
          alert(App.i18n.t('folders.addFailed'));
        }
      }).catch(function (err) {
        console.error('[subsonic] 添加服务器失败:', err);
        adding = false;
        confirmBtn.disabled = false;
        alert(App.i18n.t('folders.addFailed'));
      });
    }

    function test() {
      if (adding) return;
      const d = collect();
      const err = validate(d);
      if (err) { alert(err); return; }
      const testBtn = dlg.querySelector('#ss-btn-test');
      const origText = testBtn.textContent;
      testBtn.textContent = App.i18n.t('folders.testing');
      testBtn.disabled = true;
      // 先添加，再测试，再根据结果决定是否保留
      App.utils.call('add_subsonic_server', d.name, d.url, d.user, d.pass, d.protocol).then(function (res) {
        let srvId = null;
        try { srvId = JSON.parse(res).id; } catch (e) { /* ignore */ }
        if (!srvId) {
          testBtn.textContent = origText;
          testBtn.disabled = false;
          alert(App.i18n.t('folders.addFailedShort'));
          return;
        }
        App.utils.call('test_subsonic_server', srvId).then(function (testRes) {
          testBtn.textContent = origText;
          testBtn.disabled = false;
          let data;
          try { data = JSON.parse(testRes); } catch (e) { data = null; }
          if (data && data.ok) {
            const ver = data.version || '';
            const osFlag = data.openSubsonic ? ' (OpenSubsonic)' : '';
            alert(App.i18n.t('folders.connectSuccess', { version: ver, osFlag: osFlag }));
            close();
            App.utils.call('sync_subsonic_server', srvId);
          } else {
            const errMsg = (data && data.error) ? data.error : App.i18n.t('folders.unknownError');
            alert(App.i18n.t('folders.connectFailed', { error: errMsg }));
            close();
            _renderList();
          }
        });
      }).catch(function (err) {
        console.error('[subsonic] 测试服务器失败:', err);
        testBtn.textContent = origText;
        testBtn.disabled = false;
        alert(App.i18n.t('folders.testFailed'));
      });
    }

    dlg.querySelector('.cmd-dialog-btn--cancel').addEventListener('click', close);
    dlg.querySelector('.cmd-dialog-btn--confirm').addEventListener('click', add);
    dlg.querySelector('#ss-btn-test').addEventListener('click', test);
    [nameInput, dlg.querySelector('#ss-url'), dlg.querySelector('#ss-user'), dlg.querySelector('#ss-pass')].forEach(inp => {
      inp.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') add();
        else if (e.key === 'Escape') close();
      });
    });
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) close();
    });
  }

  // ── 编辑 Subsonic 服务器对话框 ────────────────────────────────────────────
  function _promptEditSubsonic(srv) {
    const overlay = document.createElement('div');
    overlay.className = 'cmd-dialog-overlay';
    const dlg = document.createElement('div');
    dlg.className = 'cmd-dialog subsonic-add-dialog';
    dlg.innerHTML = `
      <div class="cmd-dialog-title">${App.i18n.t('folders.editServerTitle')}</div>
      <div class="cmd-dialog-body">
        <div class="cmd-text-field" style="margin-bottom:12px;">
          <input type="text" id="ss-name" class="cmd-text-field__input" placeholder=" " autocomplete="off" value="${App.utils.esc(srv.name)}">
          <label class="cmd-text-field__label">${App.i18n.t('folders.serverName')}</label>
        </div>
        <div class="cmd-text-field" style="margin-bottom:12px;">
          <input type="text" id="ss-url" class="cmd-text-field__input" placeholder=" " autocomplete="off" value="${App.utils.esc(srv.server_url)}">
          <label class="cmd-text-field__label">${App.i18n.t('folders.serverUrl')}</label>
        </div>
        <div class="cmd-text-field" style="margin-bottom:12px;">
          <input type="text" id="ss-user" class="cmd-text-field__input" placeholder=" " autocomplete="off" value="${App.utils.esc(srv.username)}">
          <label class="cmd-text-field__label">${App.i18n.t('folders.username')}</label>
        </div>
        <div class="cmd-text-field" style="margin-bottom:12px;">
          <input type="password" id="ss-pass" class="cmd-text-field__input" placeholder=" " autocomplete="off">
          <label class="cmd-text-field__label">${App.i18n.t('folders.passwordOptional')}</label>
        </div>
        <div class="cmd-text-field">
          <select id="ss-protocol" class="cmd-text-field__input">
            <option value="subsonic"${srv.protocol_mode !== 'opensubsonic' ? ' selected' : ''}>Subsonic 1.16</option>
            <option value="opensubsonic"${srv.protocol_mode === 'opensubsonic' ? ' selected' : ''}>OpenSubsonic</option>
          </select>
          <label class="cmd-text-field__label">${App.i18n.t('folders.protocol')}</label>
        </div>
      </div>
      <div class="cmd-dialog-actions">
        <button class="cmd-dialog-btn cmd-dialog-btn--cancel">${App.i18n.t('common.cancel')}</button>
        <button class="cmd-dialog-btn" id="ss-btn-test">${App.i18n.t('folders.test')}</button>
        <button class="cmd-dialog-btn cmd-dialog-btn--confirm">${App.i18n.t('common.confirm')}</button>
      </div>
    `;
    overlay.appendChild(dlg);
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('open'));

    const nameInput = dlg.querySelector('#ss-name');
    setTimeout(() => nameInput.focus(), 50);

    let done = false;
    let saving = false;
    function close() {
      if (done) return;
      done = true;
      overlay.classList.remove('open');
      setTimeout(() => {
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      }, 180);
    }

    function collect() {
      const name = (nameInput.value || '').trim();
      const url = (dlg.querySelector('#ss-url').value || '').trim();
      const user = (dlg.querySelector('#ss-user').value || '').trim();
      const pass = dlg.querySelector('#ss-pass').value || '';
      const protocol = dlg.querySelector('#ss-protocol').value || 'subsonic';
      return { name: name, url: url, user: user, pass: pass, protocol: protocol };
    }

    function validate(d) {
      if (!d.name) { nameInput.focus(); return App.i18n.t('folders.errName'); }
      if (!d.url) { dlg.querySelector('#ss-url').focus(); return App.i18n.t('folders.errUrl'); }
      if (!d.user) { dlg.querySelector('#ss-user').focus(); return App.i18n.t('folders.errUser'); }
      return null;
    }

    function save() {
      if (saving) return;
      const d = collect();
      const err = validate(d);
      if (err) { alert(err); return; }
      saving = true;
      const confirmBtn = dlg.querySelector('.cmd-dialog-btn--confirm');
      confirmBtn.disabled = true;
      // 密码留空时不更新密码字段
      App.utils.call('update_subsonic_server', srv.id, d.name, d.url, d.user, d.pass, d.protocol).then(function (res) {
        // 保存成功提示，短暂反馈后关闭
        confirmBtn.textContent = App.i18n.t('folders.saved');
        confirmBtn.classList.add('cmd-dialog-btn--confirm');
        setTimeout(function () {
          close();
          // subsonic_servers_changed 事件会自动刷新列表
        }, 600);
      }).catch(function (err) {
        console.error('[subsonic] 更新服务器失败:', err);
        saving = false;
        confirmBtn.disabled = false;
        alert(App.i18n.t('folders.saveFailed'));
      });
    }

    function test() {
      if (saving) return;
      const d = collect();
      const err = validate(d);
      if (err) { alert(err); return; }
      const testBtn = dlg.querySelector('#ss-btn-test');
      const origText = testBtn.textContent;
      testBtn.textContent = App.i18n.t('folders.testing');
      testBtn.disabled = true;
      // 先保存配置（含可能的密码修改），再测试连接
      App.utils.call('update_subsonic_server', srv.id, d.name, d.url, d.user, d.pass, d.protocol).then(function () {
        return App.utils.call('test_subsonic_server', srv.id);
      }).then(function (testRes) {
        testBtn.textContent = origText;
        testBtn.disabled = false;
        let data;
        try { data = JSON.parse(testRes); } catch (e) { data = null; }
        if (data && data.ok) {
          const ver = data.version || '';
          const osFlag = data.openSubsonic ? ' (OpenSubsonic)' : '';
          alert(App.i18n.t('folders.connectSuccess', { version: ver, osFlag: osFlag }));
          close();
        } else {
          const errMsg = (data && data.error) ? data.error : App.i18n.t('folders.unknownError');
            alert(App.i18n.t('folders.connectFailedSaved', { error: errMsg }));
          close();
        }
      }).catch(function (err) {
        console.error('[subsonic] 测试服务器失败:', err);
        testBtn.textContent = origText;
        testBtn.disabled = false;
        alert(App.i18n.t('folders.testFailed'));
      });
    }

    dlg.querySelector('.cmd-dialog-btn--cancel').addEventListener('click', close);
    dlg.querySelector('.cmd-dialog-btn--confirm').addEventListener('click', save);
    dlg.querySelector('#ss-btn-test').addEventListener('click', test);
    [nameInput, dlg.querySelector('#ss-url'), dlg.querySelector('#ss-user'), dlg.querySelector('#ss-pass')].forEach(inp => {
      inp.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') save();
        else if (e.key === 'Escape') close();
      });
    });
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) close();
    });
  }

})();
