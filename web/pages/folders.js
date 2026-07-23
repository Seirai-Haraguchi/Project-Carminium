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
            <h1 class="page-title">媒体库</h1>
            <p class="page-subtitle" id="folder-count">添加本地音乐文件夹以构建您的媒体库。</p>
          </div>
          <div class="page-actions">
            <button class="btn-filled" id="btn-add-folder">
              <span class="material-symbols-rounded">create_new_folder</span>添加本地文件夹
            </button>
            <button class="btn-outlined" id="btn-add-subsonic">
              <span class="material-symbols-rounded">cloud</span>添加流媒体库
            </button>
          </div>
        </div>
        <div class="search-bar">
          <span class="material-symbols-rounded">search</span>
          <input type="text" id="folder-search" placeholder="搜索本地文件夹路径…" aria-label="搜索本地文件夹">
        </div>
      </div>
      <div class="library-section-header">
        <h2 class="library-section-title">
          <span class="material-symbols-rounded">folder</span>本地文件夹
        </h2>
        <p class="library-section-subtitle" id="local-folder-count"></p>
      </div>
      <div class="folder-list" id="folder-list"></div>
      <div class="library-section-header">
        <h2 class="library-section-title">
          <span class="material-symbols-rounded">cloud</span>流媒体库
        </h2>
        <p class="library-section-subtitle" id="streaming-count"></p>
      </div>
      <div class="subsonic-section" id="subsonic-section"></div>
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
              <h2 class="empty-title">扫描中</h2>
              <p class="empty-sub">正在扫描 ${App.utils.esc(path)}</p>
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
    _renderSubsonicServers();
  };

  function _loadFolders() {
    // 从前端缓存读取（启动时已拉取，folders_updated 时刷新）
    allFolders = (App.state && App.state.allFolders) ? App.state.allFolders : [];
    _renderList();
  }

  function _renderList() {
    const listEl = document.getElementById('folder-list');
    if (!listEl) return;

    const list = filterStr ? allFolders.filter(f => {
      return f.path && f.path.toLowerCase().includes(filterStr);
    }) : allFolders;

    const countEl = document.getElementById('folder-count');
    const localCountEl = document.getElementById('local-folder-count');
    if (countEl) {
      countEl.textContent = filterStr
        ? `${list.length} / ${allFolders.length} 个本地文件夹`
        : (allFolders.length === 0 ? '添加本地音乐文件夹以构建您的媒体库。' : `${allFolders.length} 个本地文件夹`);
    }
    if (localCountEl) {
      localCountEl.textContent = filterStr
        ? `${list.length} / ${allFolders.length} 个`
        : `${allFolders.length} 个本地文件夹`;
    }

    if (list.length === 0) {
      listEl.innerHTML = `
        <div class="empty-state">
          <span class="material-symbols-rounded empty-icon">folder_open</span>
          <h2 class="empty-title">${filterStr ? '无结果' : '未添加本地文件夹'}</h2>
        </div>
      `;
      return;
    }

    listEl.innerHTML = '';
    const frag = document.createDocumentFragment();

    list.forEach(folder => {
      const row = document.createElement('div');
      row.className = 'folder-row';
      
      const scanDate = App.utils.formatDate(folder.last_scan);

      row.innerHTML = `
        <span class="material-symbols-rounded folder-icon">folder</span>
        <div class="folder-info">
          <p class="folder-path" title="${App.utils.esc(folder.path)}">${App.utils.esc(folder.path)}</p>
          <p class="folder-meta">${folder.track_count} 首曲目 · 上次扫描：${scanDate}</p>
        </div>
        <div class="folder-actions">
          <button class="icon-btn btn-rescan" aria-label="重新扫描" title="重新扫描">
            <span class="material-symbols-rounded">sync</span>
          </button>
          <button class="icon-btn btn-remove" aria-label="移除" title="移除文件夹" style="color:var(--md-error)">
            <span class="material-symbols-rounded">delete</span>
          </button>
        </div>
      `;

      row.querySelector('.btn-rescan').addEventListener('click', function () {
        const btn = this;
        const icon = btn.querySelector('.material-symbols-rounded');
        icon.style.animation = 'pulse 1s infinite';
        btn.disabled = true;
        // rescan_folder 立即返回（扫描在后台线程执行），
        // folders_updated 事件会在扫描完成后触发 onFoldersUpdated 刷新列表
        App.utils.call('rescan_folder', folder.path).catch(function () {
          icon.style.animation = '';
          btn.disabled = false;
        });
      });

      row.querySelector('.btn-remove').addEventListener('click', function () {
        if (confirm(`确定要从库中移除此文件夹吗？\n${folder.path}\n\n注意：这不会删除您硬盘上的物理文件。`)) {
          App.utils.call('remove_folder', folder.path).then(() => _loadFolders());
        }
      });

      frag.appendChild(row);
    });
    listEl.appendChild(frag);
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
    if (document.getElementById('subsonic-section')) {
      _renderSubsonicServers();
    }
  };

  function _renderSubsonicServers() {
    const sectionEl = document.getElementById('subsonic-section');
    if (!sectionEl) return;
    const servers = (App.state && App.state.allSubsonicServers) ? App.state.allSubsonicServers : [];

    if (servers.length === 0) {
      sectionEl.innerHTML = '';
      return;
    }

    const streamingCountEl = document.getElementById('streaming-count');
    if (streamingCountEl) {
      streamingCountEl.textContent = `${servers.length} 个流媒体库`;
    }

    sectionEl.innerHTML = `
      <div class="subsonic-server-list" id="subsonic-server-list"></div>
    `;

    const listEl = document.getElementById('subsonic-server-list');
    const frag = document.createDocumentFragment();
    servers.forEach(srv => {
      const row = document.createElement('div');
      row.className = 'folder-row subsonic-server-row';
      row.setAttribute('data-server-id', srv.id);
      const lastSync = srv.last_sync ? App.utils.formatDate(srv.last_sync) : '未同步';
      const protocolLabel = srv.protocol_mode === 'opensubsonic' ? 'OpenSubsonic' : 'Subsonic';
      const pending = _pendingSync[srv.id];
      const isSyncing = !!pending;
      const metaHtml = isSyncing
        ? _formatSyncingMeta(pending.lastStats)
        : `${App.utils.esc(srv.server_url)} · ${srv.track_count || 0} 首曲目`
          + ` · ${protocolLabel} · 上次同步：${lastSync}`;
      row.innerHTML = `
        <span class="material-symbols-rounded folder-icon">cloud</span>
        <div class="folder-info">
          <p class="folder-path" title="${App.utils.esc(srv.name + ' — ' + srv.server_url)}">${App.utils.esc(srv.name)}</p>
          <p class="folder-meta">${metaHtml}</p>
        </div>
        <div class="folder-actions">
          <button class="icon-btn btn-subsonic-sync" data-server-id="${srv.id}" aria-label="同步" title="同步"${isSyncing ? ' disabled' : ''}>
            <span class="material-symbols-rounded"${isSyncing ? ' style="animation:pulse 1s infinite"' : ''}>sync</span>
          </button>
          <button class="icon-btn btn-subsonic-edit" data-server-id="${srv.id}" aria-label="编辑" title="编辑服务器信息">
            <span class="material-symbols-rounded">edit</span>
          </button>
          <button class="icon-btn btn-subsonic-remove" data-server-id="${srv.id}" aria-label="移除" title="移除" style="color:var(--md-error)">
            <span class="material-symbols-rounded">delete</span>
          </button>
        </div>
      `;
      frag.appendChild(row);

      // 同步中：更新 _pendingSync 引用到新 DOM，后续 progress 事件能继续更新
      if (isSyncing) {
        pending.icon = row.querySelector('.btn-subsonic-sync .material-symbols-rounded');
        pending.metaEl = row.querySelector('.folder-meta');
      }
    });
    listEl.appendChild(frag);

    listEl.querySelectorAll('.btn-subsonic-sync').forEach(btn => {
      btn.addEventListener('click', function () {
        if (this.disabled) return;
        const sid = parseInt(this.getAttribute('data-server-id'), 10);
        _syncServer(sid, this);
      });
    });
    listEl.querySelectorAll('.btn-subsonic-edit').forEach(btn => {
      btn.addEventListener('click', function () {
        const sid = parseInt(this.getAttribute('data-server-id'), 10);
        const srv = servers.find(s => s.id === sid);
        if (srv) _promptEditSubsonic(srv);
      });
    });
    listEl.querySelectorAll('.btn-subsonic-remove').forEach(btn => {
      btn.addEventListener('click', function () {
        const sid = parseInt(this.getAttribute('data-server-id'), 10);
        const srv = servers.find(s => s.id === sid);
        const name = srv ? srv.name : '';
        App.utils.confirmDialog({
          title: '移除 Subsonic 服务器',
          body: `确定要移除服务器「${name}」吗？已同步的曲目索引与缓存的封面也会被删除。`,
          confirmText: '移除',
          cancelText: '取消',
        }).then(function (ok) {
          if (ok) App.utils.call('remove_subsonic_server', sid);
        });
      });
    });
  }

  // 构造同步中状态的 meta 行 HTML
  function _formatSyncingMeta(lastStats) {
    if (!lastStats) {
      return '<span style="color:var(--md-primary)">同步中…（后台运行，UI 可正常操作）</span>';
    }
    return '<span style="color:var(--md-primary)">同步中… 已索引 '
      + (lastStats.tracks || 0) + ' 首 / '
      + (lastStats.albums || 0) + ' 张专辑</span>';
  }

  function _syncServer(serverId, btn) {
    // 查找服务器名称
    var servers = (App.state && App.state.allSubsonicServers) ? App.state.allSubsonicServers : [];
    var srv = servers.find(function (s) { return s.id === serverId; });
    var serverName = srv ? srv.name : '';
    // 使用全屏遮罩展示同步进度
    _startSyncWithOverlay(serverId, serverName);
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
    _renderSubsonicServers();

    if (data.ok) {
      var stats = data.stats || {};
      var msg = '同步完成：' + (stats.artists || 0) + ' 艺术家 · '
        + (stats.albums || 0) + ' 专辑 · ' + (stats.tracks || 0) + ' 曲目';
      console.log('[subsonic]', msg);
      if (stats.tracks === 0) {
        var warns = (stats.warnings || []).slice(0, 3).join('\n');
        alert('同步完成但未获取到曲目。\n' + msg + (warns ? '\n\n诊断信息:\n' + warns : ''));
      } else {
        // 建议用户重启程序以避免潜在的缓存/状态不一致问题
        App.utils.confirmDialog({
          title: '同步完成',
          body: msg + '\n\n建议重启程序以确保所有更改生效，避免潜在的缓存不一致问题。',
          confirmText: '重启程序',
          cancelText: '稍后',
        }).then(function (ok) {
          if (ok) App.utils.call('restart_app');
        });
      }
    } else {
      var err = data.error || '未知错误';
      var warns2 = (data.warnings || []).slice(0, 5).join('\n');
      alert('同步失败：' + err + (warns2 ? '\n\n诊断信息:\n' + warns2 : ''));
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
    'artists': '正在获取艺术家列表',
    'albums': '正在获取专辑详情',
    'tracks': '正在索引曲目',
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
        '<button class="btn-filled" id="so-restart">重启程序</button>';
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
        var label = _PHASE_LABELS[phase] || '正在同步';
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
          titleEl.textContent = '同步完成';
          var t = stats.tracks || 0;
          phaseTextEl.textContent = (t === 0)
            ? '未获取到曲目，请检查服务器配置或内容。'
            : '已索引 ' + t + ' 首曲目';
          barFill.style.width = '100%';
          currentEl.style.display = 'none';
          // 建议用户重启程序以避免潜在的缓存/状态不一致问题
          var restartHint = document.createElement('p');
          restartHint.className = 'sync-restart-hint';
          restartHint.textContent = '建议重启程序以确保所有更改生效。';
          actionsEl.parentNode.insertBefore(restartHint, actionsEl);
          showDoneWithRestart('完成');
        } else {
          var err = data.error || '未知错误';
          titleEl.textContent = '同步失败';
          bodyEl.style.display = 'none';
          var errBox = document.createElement('div');
          errBox.className = 'sync-overlay-error';
          var warns = (data.warnings || []).slice(0, 5).join('\n');
          errBox.textContent = err + (warns ? '\n\n诊断信息:\n' + warns : '');
          actionsEl.parentNode.insertBefore(errBox, actionsEl);
          showDoneButton('关闭');
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
            error: data.error || '同步启动失败',
          });
        }
        // data.ok=true：后台同步已启动，等待 progress/result 事件
      } catch (e) { /* ignore */ }
    }).catch(function (err) {
      if (_syncOverlay && _syncOverlay.serverId === serverId) {
        _syncOverlay.onResult({
          ok: false,
          server_id: serverId,
          error: '同步请求失败：' + (err && err.message ? err.message : err),
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
      <div class="cmd-dialog-title">添加 Subsonic 服务器</div>
      <div class="cmd-dialog-body">
        <div class="cmd-text-field" style="margin-bottom:12px;">
          <input type="text" id="ss-name" class="cmd-text-field__input" placeholder=" " autocomplete="off">
          <label class="cmd-text-field__label">名称</label>
        </div>
        <div class="cmd-text-field" style="margin-bottom:12px;">
          <input type="text" id="ss-url" class="cmd-text-field__input" placeholder=" " autocomplete="off">
          <label class="cmd-text-field__label">服务器地址</label>
        </div>
        <div class="cmd-text-field" style="margin-bottom:12px;">
          <input type="text" id="ss-user" class="cmd-text-field__input" placeholder=" " autocomplete="off">
          <label class="cmd-text-field__label">用户名</label>
        </div>
        <div class="cmd-text-field" style="margin-bottom:12px;">
          <input type="password" id="ss-pass" class="cmd-text-field__input" placeholder=" " autocomplete="off">
          <label class="cmd-text-field__label">密码</label>
        </div>
        <div class="cmd-text-field">
          <select id="ss-protocol" class="cmd-text-field__input">
            <option value="subsonic">Subsonic 1.16</option>
            <option value="opensubsonic">OpenSubsonic</option>
          </select>
          <label class="cmd-text-field__label">协议</label>
        </div>
      </div>
      <div class="cmd-dialog-actions">
        <button class="cmd-dialog-btn cmd-dialog-btn--cancel">取消</button>
        <button class="cmd-dialog-btn" id="ss-btn-test">测试</button>
        <button class="cmd-dialog-btn cmd-dialog-btn--confirm">添加</button>
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
      if (!d.name) { nameInput.focus(); return '请填写名称'; }
      if (!d.url) { dlg.querySelector('#ss-url').focus(); return '请填写服务器地址'; }
      if (!d.user) { dlg.querySelector('#ss-user').focus(); return '请填写用户名'; }
      if (!d.pass) { dlg.querySelector('#ss-pass').focus(); return '请填写密码'; }
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
          alert('添加失败，请检查网络或服务器配置');
        }
      }).catch(function (err) {
        console.error('[subsonic] 添加服务器失败:', err);
        adding = false;
        confirmBtn.disabled = false;
        alert('添加失败，请检查网络或服务器配置');
      });
    }

    function test() {
      if (adding) return;
      const d = collect();
      const err = validate(d);
      if (err) { alert(err); return; }
      const testBtn = dlg.querySelector('#ss-btn-test');
      const origText = testBtn.textContent;
      testBtn.textContent = '测试中…';
      testBtn.disabled = true;
      // 先添加，再测试，再根据结果决定是否保留
      App.utils.call('add_subsonic_server', d.name, d.url, d.user, d.pass, d.protocol).then(function (res) {
        let srvId = null;
        try { srvId = JSON.parse(res).id; } catch (e) { /* ignore */ }
        if (!srvId) {
          testBtn.textContent = origText;
          testBtn.disabled = false;
          alert('添加失败');
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
            alert('连接成功\n服务器版本：' + ver + osFlag);
            close();
            App.utils.call('sync_subsonic_server', srvId);
          } else {
            const errMsg = (data && data.error) ? data.error : '未知错误';
            alert('连接失败：' + errMsg + '\n\n服务器配置已保留，您可以稍后修复后再同步。');
            close();
            _renderSubsonicServers();
          }
        });
      }).catch(function (err) {
        console.error('[subsonic] 测试服务器失败:', err);
        testBtn.textContent = origText;
        testBtn.disabled = false;
        alert('测试失败，请检查网络连接');
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
      <div class="cmd-dialog-title">编辑 Subsonic 服务器</div>
      <div class="cmd-dialog-body">
        <div class="cmd-text-field" style="margin-bottom:12px;">
          <input type="text" id="ss-name" class="cmd-text-field__input" placeholder=" " autocomplete="off" value="${App.utils.esc(srv.name)}">
          <label class="cmd-text-field__label">名称</label>
        </div>
        <div class="cmd-text-field" style="margin-bottom:12px;">
          <input type="text" id="ss-url" class="cmd-text-field__input" placeholder=" " autocomplete="off" value="${App.utils.esc(srv.server_url)}">
          <label class="cmd-text-field__label">服务器地址</label>
        </div>
        <div class="cmd-text-field" style="margin-bottom:12px;">
          <input type="text" id="ss-user" class="cmd-text-field__input" placeholder=" " autocomplete="off" value="${App.utils.esc(srv.username)}">
          <label class="cmd-text-field__label">用户名</label>
        </div>
        <div class="cmd-text-field" style="margin-bottom:12px;">
          <input type="password" id="ss-pass" class="cmd-text-field__input" placeholder=" " autocomplete="off">
          <label class="cmd-text-field__label">密码（留空保持不变）</label>
        </div>
        <div class="cmd-text-field">
          <select id="ss-protocol" class="cmd-text-field__input">
            <option value="subsonic"${srv.protocol_mode !== 'opensubsonic' ? ' selected' : ''}>Subsonic 1.16</option>
            <option value="opensubsonic"${srv.protocol_mode === 'opensubsonic' ? ' selected' : ''}>OpenSubsonic</option>
          </select>
          <label class="cmd-text-field__label">协议</label>
        </div>
      </div>
      <div class="cmd-dialog-actions">
        <button class="cmd-dialog-btn cmd-dialog-btn--cancel">取消</button>
        <button class="cmd-dialog-btn" id="ss-btn-test">测试</button>
        <button class="cmd-dialog-btn cmd-dialog-btn--confirm">保存</button>
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
      if (!d.name) { nameInput.focus(); return '请填写名称'; }
      if (!d.url) { dlg.querySelector('#ss-url').focus(); return '请填写服务器地址'; }
      if (!d.user) { dlg.querySelector('#ss-user').focus(); return '请填写用户名'; }
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
        close();
        // subsonic_servers_changed 事件会自动刷新列表
      }).catch(function (err) {
        console.error('[subsonic] 更新服务器失败:', err);
        saving = false;
        confirmBtn.disabled = false;
        alert('保存失败，请检查输入');
      });
    }

    function test() {
      if (saving) return;
      const d = collect();
      const err = validate(d);
      if (err) { alert(err); return; }
      const testBtn = dlg.querySelector('#ss-btn-test');
      const origText = testBtn.textContent;
      testBtn.textContent = '测试中…';
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
          alert('连接成功\n服务器版本：' + ver + osFlag);
          close();
        } else {
          const errMsg = (data && data.error) ? data.error : '未知错误';
          alert('连接失败：' + errMsg + '\n\n配置已保存，您可以稍后修复后再同步。');
          close();
        }
      }).catch(function (err) {
        console.error('[subsonic] 测试服务器失败:', err);
        testBtn.textContent = origText;
        testBtn.disabled = false;
        alert('测试失败，请检查网络连接');
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
