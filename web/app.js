/**
 * Carminium — 主应用外壳与路由
 */
(function () {
  'use strict';

  const App = window.App || {};
  window.App = App;

  App.state = {
    currentPage: 'music',
    currentTrack: null,
    playbackState: 'stopped', // playing, paused, stopped
    shuffle: false,
    repeat: 'off',
    queue: [],
    currentQueueIndex: -1,
    isMobileView: false,
    allTracks: [],       // 全量曲目缓存，启动时拉取，library_updated 时刷新
    allAlbums: [],       // 全量专辑缓存
    allArtists: [],      // 全量艺术家缓存
    allFolders: [],      // 全量文件夹缓存
    allSubsonicServers: [], // 全量 Subsonic 服务器缓存
    colorScheme: 'tonal_spot', // Material You 配色方案
    isExclusive: false,  // WASAPI 独占模式标志（由 settings_changed 同步）
  };

  // ── 0.5 滚动位置记忆 ──────────────────────────────────────────────────────
  // 在页面间切换时自动保存/恢复滚动位置，避免用户二次滚动。
  // 对于异步加载内容的页面（history / liked / playlists），scheduleRestore
  // 会在多帧内反复尝试，直到内容高度足够容纳目标位置或超时。
  App.scrollMemory = (function () {
    var _memory = {};        // pageId → scrollTop
    var _pendingPage = null; // 正在等待恢复的页面（用于取消过时的重试）

    function _container() {
      return document.getElementById('content-pane');
    }

    /** 保存指定页面的当前滚动位置 */
    function save(pageId) {
      if (!pageId) return;
      var c = _container();
      if (c) _memory[pageId] = c.scrollTop;
    }

    /** 立即恢复指定页面的滚动位置（适用于同步渲染的页面） */
    function restore(pageId) {
      var c = _container();
      if (!c) return;
      c.scrollTop = _memory[pageId] || 0;
    }

    /**
     * 调度滚动位置恢复。对于异步加载内容的页面（history/liked/playlists），
     * 会在多帧内反复尝试设置 scrollTop，直到内容高度足够或超时。
     * 若用户在此期间导航到其他页面，旧的重试会被自动取消。
     */
    function scheduleRestore(pageId) {
      _pendingPage = pageId;
      var c = _container();
      if (!c) return;
      var target = _memory[pageId] || 0;

      if (!target) {                 // 无记录或顶部 → 直接置顶
        c.scrollTop = 0;
        _pendingPage = null;
        return;
      }

      var attempts = 0;
      var MAX = 40;                  // ~660ms @60fps，足以覆盖后端异步查询
      function step() {
        if (_pendingPage !== pageId) return;   // 已被新导航取消
        c = _container();
        if (!c) return;
        c.scrollTop = target;
        if (Math.abs(c.scrollTop - target) < 3 || attempts >= MAX) {
          _pendingPage = null;
          return;
        }
        attempts++;
        requestAnimationFrame(step);
      }
      requestAnimationFrame(step);
    }

    return { save: save, restore: restore, scheduleRestore: scheduleRestore };
  })();

  // ── 0. 全量数据缓存（供各页面本地过滤/搜索使用）──────────────────────────
  // 启动时拉取一次，library_updated/folders_updated 事件触发刷新。
  // 这样所有列表页的搜索、专辑/艺术家详情的曲目过滤都在前端完成，
  // 无需每次进入页面都调后端。

  App.refreshLibraryCache = function () {
    return Promise.all([
      App.utils.call('get_library'),
      App.utils.call('get_albums'),
      App.utils.call('get_artists'),
      App.utils.call('get_folders'),
      App.utils.call('get_subsonic_servers'),
    ]).then(function (results) {
      App.state.allTracks = JSON.parse(results[0]);
      App.state.allAlbums = JSON.parse(results[1]);
      App.state.allArtists = JSON.parse(results[2]);
      App.state.allFolders = JSON.parse(results[3]);
      App.state.allSubsonicServers = JSON.parse(results[4]);
      return App.state;
    });
  };

  // ── 1. 初始化 Bridge ──────────────────────────────────────────────────────
  // bridge.js 已在 HTML 中先于 app.js 加载，并定义了 App.backend Proxy 与
  // window.__bridge 事件分发器。此处仅需等待后端 API 就绪、初始化
  // cover base URL，并注册信号回调（由 Proxy 兼容旧语法）。

  function initBridge() {
    if (!window.__waitForPywebview) {
      console.error('[app] bridge.js missing');
      _showFatalError('bridge.js 未加载');
      return;
    }

    window.__waitForPywebview(function () {
      // 获取 cover HTTP server base URL（用于 window.coverUrl）
      window.pywebview.api.get_cover_base_url().then(function (url) {
        window.__coverBase = url || '';

        // Connect Signals（Proxy 将 .signal_name.connect(cb) 路由到 __bridge.on）
        App.backend.track_changed.connect(_onTrackChanged);
        App.backend.playback_state_changed.connect(_onStateChanged);
        App.backend.position_changed.connect(_onPositionChanged);
        App.backend.duration_changed.connect(_onDurationChanged);
        App.backend.volume_changed.connect(_onVolumeChanged);
        App.backend.shuffle_changed.connect(_onShuffleChanged);
        App.backend.repeat_changed.connect(_onRepeatChanged);
        App.backend.queue_changed.connect(_onQueueChanged);
        App.backend.liked_changed.connect(_onLikedChanged);

        // 歌单 / 历史 / 喜爱列表变化
        App.backend.playlists_changed.connect(function (json) {
          try { App.state.allPlaylists = JSON.parse(json); } catch (e) {}
          if (App.playlists && App.playlists.refresh) {
            App.playlists.refresh();
          }
          // 若当前在歌单详情页，刷新当前歌单内容
          if (App.state.currentPage === 'playlists' && App.pages.playlists && App.pages.playlists.onPlaylistsChanged) {
            App.pages.playlists.onPlaylistsChanged(json);
          }
        });
        App.backend.history_changed.connect(function (json) {
          if (App.state.currentPage === 'history' && App.pages.history && App.pages.history.onHistoryChanged) {
            App.pages.history.onHistoryChanged(json);
          }
        });
        App.backend.liked_tracks_changed.connect(function (json) {
          if (App.state.currentPage === 'liked' && App.pages.liked && App.pages.liked.onLikedTracksChanged) {
            App.pages.liked.onLikedTracksChanged(json);
          }
        });

        // Subsonic 服务器列表变化（添加/删除/同步完成）
        App.backend.subsonic_servers_changed.connect(function (json) {
          try { App.state.allSubsonicServers = JSON.parse(json); } catch (e) {}
          if (App.pages.folders && App.pages.folders.onSubsonicServersUpdated) {
            App.pages.folders.onSubsonicServersUpdated(json);
          }
        });

        // Subsonic 异步同步结果（成功/失败）
        window.__bridge.on('subsonic_sync_result', function (json) {
          try {
            var data = JSON.parse(json);
            if (App.pages.folders && App.pages.folders.onSubsonicSyncResult) {
              App.pages.folders.onSubsonicSyncResult(data);
            }
          } catch (e) {
            console.error('[app] subsonic_sync_result parse error:', e);
          }
        });

        // Subsonic 同步进度（开始/阶段/实时计数）
        window.__bridge.on('subsonic_sync_progress', function (json) {
          try {
            var data = JSON.parse(json);
            console.log('[subsonic] 同步进度:', data);
            if (App.pages.folders && App.pages.folders.onSubsonicSyncProgress) {
              App.pages.folders.onSubsonicSyncProgress(data);
            }
          } catch (e) { /* ignore */ }
        });

        // BPM 分析完成：目前仅作元数据存储，前端音频播放器已移除
        App.backend.bpm_analyzed.connect(function (json) {
          /* AutoMix 变速过渡依赖前端 Web Audio API，已随前端模式一并移除 */
        });

        App.backend.library_updated.connect(function (json) {
          // 刷新前端全量缓存，然后重渲染当前页
          App.refreshLibraryCache().then(function () {
            if (App.state.currentPage === 'music') App.pages.music.render(document.getElementById('page-container'));
            if (App.pages.folders.onFoldersUpdated) App.pages.folders.onFoldersUpdated(json);
          });
        });
        App.backend.folders_updated.connect(function (json) {
          App.refreshLibraryCache().then(function () {
            if (App.pages.folders.onFoldersUpdated) {
              App.pages.folders.onFoldersUpdated(json);
            }
          });
        });

        // 设置变更：同步正在播放页音频模式按钮（excl/shrd）
        App.backend.settings_changed.connect(function (sjson) {
          try {
            var s = JSON.parse(sjson);
            // 同步独占模式标志到 App.state
            if (s.wasapi_exclusive !== undefined) {
              App.state.isExclusive = !!s.wasapi_exclusive;
            }
            if (App.nowPlaying && App.nowPlaying.updateAudioMode) {
              App.nowPlaying.updateAudioMode(!!s.wasapi_exclusive);
            }
            // 界面字体变更
            if (s.ui_font !== undefined) {
              _applyUiFont(s.ui_font || '');
            }
            // AutoMix / gapless / BeatShake 依赖前端 Web Audio API，已随前端模式一并移除
          } catch (e) { /* ignore */ }
        });

        // 初始化 UI
        App.nowPlaying.init();

        // 获取初始状态并渲染
        _initTheme();
        _loadShortcuts();
        // 拉取歌单列表（填充侧边栏飞出菜单），不阻塞首页渲染
        if (App.playlists && App.playlists.refresh) {
          App.playlists.refresh();
        }
        // 先拉取全量缓存，再拉取播放状态，最后渲染首页
        App.refreshLibraryCache().then(function () {
          return _fetchInitialState();
        }).then(function () {
          navigate('music');
        }).catch(function (err) {
          console.error('[app] 初始化失败:', err);
          _showFatalError('初始化失败：' + (err && err.message ? err.message : String(err)));
        });
      }).catch(function (err) {
        console.error('[app] get_cover_base_url 失败:', err);
        _showFatalError('无法连接后端服务');
      });
    }, 15000);
  }

  function _showFatalError(msg) {
    var splash = document.getElementById('splash');
    if (splash) {
      splash.innerHTML =
        '<span class="material-symbols-rounded splash-icon" style="color:var(--md-error)">error</span>' +
        '<p class="splash-text">' + msg + '</p>' +
        '<p style="font-size:12px;color:var(--md-on-surface-variant);margin-top:8px">请检查后端是否正常运行</p>';
    }
  }

  function _fetchInitialState() {
    return App.utils.call('get_player_state').then(function(res) {
      const state = JSON.parse(res);
      App.state.currentTrack = state.current_track;
      App.state.playbackState = state.state || 'stopped';
      App.state.shuffle = state.shuffle;
      App.state.repeat = state.repeat;
      // 同步独占模式标志
      App.state.isExclusive = !!state.wasapi_exclusive;

      App.nowPlaying.updateTrack(App.state.currentTrack);
      App.nowPlaying.updateVolume(state.volume);
      App.nowPlaying.updateModes(state.shuffle, state.repeat);
      App.nowPlaying.updateState(App.state.playbackState);

      // 音频由原生 DLL (Zig + miniaudio) 渲染，position/duration 均由后端上报
      App.nowPlaying.updateDuration(state.duration);
      App.nowPlaying.updatePosition(state.position);

      return App.utils.call('is_current_liked').then(function(liked) {
        App.state.currentLiked = liked;
        App.nowPlaying.updateLiked(liked);

        return App.utils.call('get_queue').then(function(qres) {
          const qstate = JSON.parse(qres);
          App.state.queue = qstate.queue || [];
          App.state.currentQueueIndex = qstate.current_index;
          App.nowPlaying.updateQueue(App.state.queue, App.state.currentQueueIndex);
        });
      });
    });
  }

  // 应用界面字体：非空时覆盖 --ui-font，为空时回退 CSS 默认
  function _applyUiFont(val) {
    var root = document.documentElement;
    if (val && val.trim()) {
      root.style.setProperty('--ui-font', val.trim());
    } else {
      root.style.removeProperty('--ui-font');
    }
  }

  function _initTheme() {
    App.utils.call('get_settings').then(function (res) {
      const settings = JSON.parse(res);
      const val = settings.theme || 'system';
      if (val === 'system') {
        const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
      } else {
        document.documentElement.setAttribute('data-theme', val);
      }
      if (App.state.currentDominantRgb) App.utils.applyDynamicTheme(App.state.currentDominantRgb);

      // 加载配色方案
      App.state.colorScheme = settings.color_scheme || 'tonal_spot';

      // 应用界面字体
      _applyUiFont(settings.ui_font || '');

      // 同步独占模式标志到 App.state
      App.state.isExclusive = !!settings.wasapi_exclusive;

      // 同步正在播放页音频模式按钮（excl/shrd）
      if (App.nowPlaying && App.nowPlaying.updateAudioMode) {
        App.nowPlaying.updateAudioMode(!!settings.wasapi_exclusive);
      }

      // AutoMix / gapless / BeatShake / setSinkId 依赖前端 Web Audio API，已随前端模式一并移除
    });

    // 监听系统主题变化
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', e => {
      App.utils.call('get_settings').then(function (res) {
        if (JSON.parse(res).theme === 'system') {
          document.documentElement.setAttribute('data-theme', e.matches ? 'dark' : 'light');
          if (App.state.currentDominantRgb) App.utils.applyDynamicTheme(App.state.currentDominantRgb);
        }
      });
    });
  }

  // ── 2. Signal Handlers ───────────────────────────────────────────────────

  function _onTrackChanged(trackJson) {
    const track = JSON.parse(trackJson);
    App.state.currentTrack = track;
    App.nowPlaying.updateTrack(track);
    
    // 通知各个列表页更新播放高亮
    if (App.state.currentPage === 'music' && App.pages.music.updatePlayState) {
      App.pages.music.updatePlayState();
    }
    if (App.state.currentPage === 'albums' && App.pages.albums.updatePlayState) {
      App.pages.albums.updatePlayState();
    }
    if (App.state.currentPage === 'artists' && App.pages.artists.updatePlayState) {
      App.pages.artists.updatePlayState();
    }
  }

  function _onStateChanged(state) {
    App.state.playbackState = state;
    App.nowPlaying.updateState(state);
  }

  function _onPositionChanged(ms) {
    // position/duration 均由原生 DLL (Zig + miniaudio) 通过后端上报
    App.nowPlaying.updatePosition(ms);
  }

  function _onDurationChanged(ms) {
    App.nowPlaying.updateDuration(ms);
  }

  function _onVolumeChanged(vol) {
    App.nowPlaying.updateVolume(vol);
  }

  function _onShuffleChanged(enabled) {
    App.state.shuffle = enabled;
    App.nowPlaying.updateModes(enabled, App.state.repeat);
  }

  function _onRepeatChanged(mode) {
    App.state.repeat = mode;
    App.nowPlaying.updateModes(App.state.shuffle, mode);
  }

  function _onQueueChanged(queueJson) {
    const data = JSON.parse(queueJson);
    App.state.queue = data.queue || [];
    App.state.currentQueueIndex = data.current_index;
    App.nowPlaying.updateQueue(App.state.queue, App.state.currentQueueIndex);
  }

  function _onLikedChanged(liked) {
    App.state.currentLiked = liked;
    App.nowPlaying.updateLiked(liked);
  }

  // ── 3. 路由与导航 ────────────────────────────────────────────────────────

  function navigate(pageId, params) {
    // 清除曲目多选状态
    if (App.selection) App.selection.clear();
    const container = document.getElementById('page-container');

    // 保存当前页面的滚动位置，以便返回时恢复
    App.scrollMemory.save(App.state.currentPage);

    const oldPage = document.querySelector('.nav-item.active');
    if (oldPage) oldPage.classList.remove('active');

    const newPage = document.querySelector(`.nav-item[data-page="${pageId}"]`);
    if (newPage) newPage.classList.add('active');

    App.state.currentPage = pageId;

    // 触发动画；settings / about 使用内部平移动画，不再叠加 page-enter
    const useInternalTransition = pageId === 'settings' || pageId === 'about';
    container.classList.remove('page-enter');
    // void container.offsetWidth; // trigger reflow
    setTimeout(() => {
      if (App.pages[pageId] && App.pages[pageId].render) {
        App.pages[pageId].render(container, params);
        // 恢复新页面的滚动位置（异步页面会在数据加载后逐步恢复）
        App.scrollMemory.scheduleRestore(pageId);
        setTimeout(() => {
          if (App.pages[pageId].updatePlayState) App.pages[pageId].updatePlayState();
        }, 50);
      } else {
        container.innerHTML = `<h2>页面未找到或未实现</h2>`;
      }
      if (!useInternalTransition) {
        container.classList.add('page-enter');
      }
    }, 10);
  }

  App.navigate = navigate;

  // ── 3.5 全局快捷键 ───────────────────────────────────────────────────────

  const SHORTCUT_ACTIONS = {
    play_pause: { label: '播放 / 暂停', handler: () => {
      if (!App.backend) return;
      if (App.state.playbackState === 'playing') App.backend.pause();
      else App.backend.play();
    }},
    next_track: { label: '下一首', handler: () => App.backend && App.backend.next_track && App.backend.next_track() },
    prev_track: { label: '上一首', handler: () => App.backend && App.backend.prev_track && App.backend.prev_track() },
    volume_up: { label: '音量加', handler: () => App.backend && App.backend.set_volume && _adjustVolume(5) },
    volume_down: { label: '音量减', handler: () => App.backend && App.backend.set_volume && _adjustVolume(-5) },
    toggle_like: { label: '喜欢 / 取消喜欢', handler: () => App.backend && App.backend.toggle_liked && App.backend.toggle_liked() },
    toggle_mute: { label: '静音', handler: () => App.backend && App.backend.set_volume && _toggleMute() },
  };

  let _shortcutConfig = {};
  let _lastVolumeBeforeMute = null;

  // 用于跟踪当前按下的修饰键
  let _pressedKeys = new Set();
  let _lastKeyDownTime = 0;
  const KEY_COMBO_TIMEOUT = 500; // 组合键超时时间（毫秒）

  function _adjustVolume(delta) {
    App.utils.call('get_player_state').then(function (res) {
      const state = JSON.parse(res);
      const newVol = Math.max(0, Math.min(100, (state.volume || 80) + delta));
      App.backend.set_volume(newVol);
    });
  }

  function _toggleMute() {
    App.utils.call('get_player_state').then(function (res) {
      const state = JSON.parse(res);
      const current = state.volume || 0;
      if (current > 0) {
        _lastVolumeBeforeMute = current;
        App.backend.set_volume(0);
      } else {
        App.backend.set_volume(_lastVolumeBeforeMute || 80);
      }
    });
  }

  function _formatKeyCombo(e) {
    const parts = [];
    if (e.ctrlKey) parts.push('Ctrl');
    if (e.altKey) parts.push('Alt');
    if (e.shiftKey) parts.push('Shift');
    if (e.metaKey) parts.push('Meta');

    let key = e.key;
    // 媒体键保持原名
    const mediaKeys = ['MediaTrackNext', 'MediaTrackPrevious', 'MediaPlayPause', 'MediaStop', 'VolumeUp', 'VolumeDown', 'VolumeMute'];
    if (mediaKeys.includes(key)) {
      // key already correct
    } else if (key.length === 1) {
      key = key.toLowerCase();
    } else if (key === ' ') {
      key = 'Space';
    }

    if (!mediaKeys.includes(key) && key !== 'Control' && key !== 'Alt' && key !== 'Shift' && key !== 'Meta') {
      parts.push(key);
    } else if (mediaKeys.includes(key)) {
      return key;
    }
    return parts.join('+');
  }

  function _getComboFromPressedKeys() {
    const parts = [];
    // 修饰键按固定顺序添加
    if (_pressedKeys.has('Control') || _pressedKeys.has('Ctrl')) parts.push('Ctrl');
    if (_pressedKeys.has('Alt')) parts.push('Alt');
    if (_pressedKeys.has('Shift')) parts.push('Shift');
    if (_pressedKeys.has('Meta')) parts.push('Meta');

    // 添加非修饰键（只取第一个非修饰键作为主体键）
    const modifierKeys = ['Control', 'Ctrl', 'Alt', 'Shift', 'Meta'];
    const mainKeys = Array.from(_pressedKeys).filter(k => !modifierKeys.includes(k));
    if (mainKeys.length > 0) {
      parts.push(mainKeys[0]);
    }

    return parts.join('+');
  }

  function _loadShortcuts() {
    App.utils.call('get_settings').then(function (res) {
      const settings = JSON.parse(res);
      _shortcutConfig = settings.shortcuts || {};
    });
  }

  function _checkShortcut(combo) {
    if (!combo) return false;
    for (const actionId in _shortcutConfig) {
      if (_shortcutConfig[actionId] === combo) {
        const action = SHORTCUT_ACTIONS[actionId];
        if (action) {
          action.handler();
          return true;
        }
      }
    }
    return false;
  }

  function _onKeyDown(e) {
    if (!App.backend) return;
    // 在文本输入框内不触发全局快捷键
    const tag = e.target.tagName;
    const isEditable = tag === 'INPUT' || tag === 'TEXTAREA' || e.target.isContentEditable;
    if (isEditable) return;

    const now = Date.now();
    // 如果距离上次按键太久，重置按键状态
    if (now - _lastKeyDownTime > KEY_COMBO_TIMEOUT) {
      _pressedKeys.clear();
    }
    _lastKeyDownTime = now;

    // 记录当前按键
    let keyName = e.key;
    if (keyName === 'Control') keyName = 'Ctrl';
    if (keyName.length === 1) keyName = keyName.toLowerCase();
    if (keyName === ' ') keyName = 'Space';

    _pressedKeys.add(keyName);

    // 同时记录修饰键状态（确保即使 key 事件顺序不同也能正确识别）
    if (e.ctrlKey) _pressedKeys.add('Ctrl');
    if (e.altKey) _pressedKeys.add('Alt');
    if (e.shiftKey) _pressedKeys.add('Shift');
    if (e.metaKey) _pressedKeys.add('Meta');

    // 构建组合键并检查
    const combo = _getComboFromPressedKeys();
    if (_checkShortcut(combo)) {
      e.preventDefault();
      _pressedKeys.clear();
    }
  }

  function _onKeyUp(e) {
    let keyName = e.key;
    if (keyName === 'Control') keyName = 'Ctrl';
    if (keyName.length === 1) keyName = keyName.toLowerCase();
    if (keyName === ' ') keyName = 'Space';

    _pressedKeys.delete(keyName);

    // 同时清除修饰键
    if (!e.ctrlKey) _pressedKeys.delete('Ctrl');
    if (!e.altKey) _pressedKeys.delete('Alt');
    if (!e.shiftKey) _pressedKeys.delete('Shift');
    if (!e.metaKey) _pressedKeys.delete('Meta');
  }

  document.addEventListener('keydown', _onKeyDown);
  document.addEventListener('keyup', _onKeyUp);
  App.shortcuts = {
    actions: SHORTCUT_ACTIONS,
    formatKeyCombo: _formatKeyCombo,
    reload: _loadShortcuts,
    getConfig: () => _shortcutConfig,
  };

  // ── 4. 绑定侧边栏 ────────────────────────────────────────────────────────

  document.querySelectorAll('.nav-item').forEach(el => {
    el.addEventListener('click', function () {
      const pageId = this.dataset.page;
      if (pageId) {
        navigate(pageId);
      }
    });
  });

  // 移动端设置 FAB
  const mobileSettingsFab = document.getElementById('mobile-settings-fab');
  if (mobileSettingsFab) {
    mobileSettingsFab.addEventListener('click', function () {
      navigate('settings');
    });
  }

  // ── 4.5 歌单副菜单 ────────────────────────────────────────────────────────

  const playlistsNavBtn = document.getElementById('nav-playlists');
  const playlistsSubmenu = document.getElementById('nav-playlists-submenu');
  const playlistsListEl = document.getElementById('nav-playlists-list');
  const playlistAddBtn = document.getElementById('nav-playlist-add');

  function _positionPlaylistsSubmenu() {
    if (!playlistsNavBtn || !playlistsSubmenu) return;
    const rect = playlistsNavBtn.getBoundingClientRect();
    // 飞出到 nav-drawer 右侧，垂直对齐按钮中心
    const navDrawer = document.getElementById('nav-drawer');
    const navRect = navDrawer ? navDrawer.getBoundingClientRect() : { right: 80 };
    const submenuWidth = 240;
    const viewportWidth = window.innerWidth;
    let left = navRect.right + 4;
    // 若右侧空间不足，则贴右边
    if (left + submenuWidth > viewportWidth - 8) {
      left = Math.max(8, viewportWidth - submenuWidth - 8);
    }
    playlistsSubmenu.style.left = left + 'px';
    // 垂直：尽量对齐按钮，但不超过视口
    const submenuHeight = playlistsSubmenu.offsetHeight || 320;
    let top = rect.top + rect.height / 2 - 24;
    if (top + submenuHeight > window.innerHeight - 8) {
      top = window.innerHeight - submenuHeight - 8;
    }
    if (top < 8) top = 8;
    playlistsSubmenu.style.top = top + 'px';
  }

  function _openPlaylistsSubmenu() {
    if (!playlistsSubmenu) return;
    playlistsSubmenu.hidden = false;
    if (playlistsNavBtn) playlistsNavBtn.setAttribute('aria-expanded', 'true');
    _positionPlaylistsSubmenu();
    // 等下一帧测量高度后再定位一次
    requestAnimationFrame(_positionPlaylistsSubmenu);
  }

  function _closePlaylistsSubmenu() {
    if (!playlistsSubmenu) return;
    playlistsSubmenu.hidden = true;
    if (playlistsNavBtn) playlistsNavBtn.setAttribute('aria-expanded', 'false');
  }

  function _isPlaylistsSubmenuOpen() {
    return playlistsSubmenu && !playlistsSubmenu.hidden;
  }

  function _renderPlaylistsSubmenu(playlists) {
    if (!playlistsListEl) return;
    if (!playlists || playlists.length === 0) {
      playlistsListEl.innerHTML = `
        <div class="nav-submenu-empty">
          <span class="material-symbols-rounded">queue_music</span>
          <p>暂无歌单</p>
        </div>
      `;
      return;
    }
    playlistsListEl.innerHTML = '';
    const frag = document.createDocumentFragment();
    playlists.forEach(pl => {
      const item = document.createElement('button');
      item.className = 'nav-submenu-item';
      item.type = 'button';
      item.innerHTML = `
        <span class="material-symbols-rounded nav-submenu-item-icon">playlist_play</span>
        <span class="nav-submenu-item-name">${App.utils.esc(pl.name)}</span>
        <span class="nav-submenu-item-count">${pl.track_count || 0}</span>
      `;
      item.addEventListener('click', function () {
        _closePlaylistsSubmenu();
        navigate('playlists', { playlist_id: pl.id, playlist_name: pl.name });
      });
      // 拖拽放入歌单
      item.addEventListener('dragover', function (e) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        item.classList.add('drag-over');
      });
      item.addEventListener('dragleave', function () {
        item.classList.remove('drag-over');
      });
      item.addEventListener('drop', function (e) {
        e.preventDefault();
        item.classList.remove('drag-over');
        // 取消自动关闭定时器
        if (App._dragCloseTimer) { clearTimeout(App._dragCloseTimer); App._dragCloseTimer = null; }
        if (App._dragOpenedSubmenu) {
          if (App.playlists && App.playlists.closeSubmenu) App.playlists.closeSubmenu();
          App._dragOpenedSubmenu = false;
        }
        var raw = e.dataTransfer.getData('text/plain');
        if (!raw) return;
        try {
          var ids = JSON.parse(raw);
          if (!Array.isArray(ids) || ids.length === 0) return;
          App.utils.call('add_tracks_to_playlist', pl.id, JSON.stringify(ids)).then(function (res) {
            try {
              var r = JSON.parse(res);
              App.utils.toast((r.added || 0) + ' 首曲目已添加到「' + pl.name + '」');
            } catch (e) { /* ignore */ }
          });
        } catch (err) {
          console.warn('[playlists] drop parse error:', err);
        }
      });
      frag.appendChild(item);
    });
    playlistsListEl.appendChild(frag);
  }

  App.playlists = App.playlists || {};
  App.playlists.refresh = function () {
    return App.utils.call('get_playlists').then(function (res) {
      const list = JSON.parse(res);
      App.state.allPlaylists = list;
      _renderPlaylistsSubmenu(list);
      return list;
    });
  };
  App.playlists.openSubmenu = _openPlaylistsSubmenu;
  App.playlists.closeSubmenu = _closePlaylistsSubmenu;
  App.playlists.toggleSubmenu = function () {
    if (_isPlaylistsSubmenuOpen()) _closePlaylistsSubmenu();
    else _openPlaylistsSubmenu();
  };

  if (playlistsNavBtn) {
    playlistsNavBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      App.playlists.toggleSubmenu();
    });
  }

  if (playlistAddBtn) {
    playlistAddBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      _promptCreatePlaylist();
    });
  }

  function _promptCreatePlaylist() {
    // 关闭副菜单，避免其 document-click 监听器与 dialog 交互产生干扰
    _closePlaylistsSubmenu();

    const overlay = document.createElement('div');
    overlay.className = 'cmd-dialog-overlay';
    const dlg = document.createElement('div');
    dlg.className = 'cmd-dialog';
    dlg.innerHTML = `
      <div class="cmd-dialog-title">新建歌单</div>
      <div class="cmd-dialog-body">
        <div class="cmd-text-field">
          <input type="text" id="new-playlist-input" class="cmd-text-field__input" placeholder=" " autocomplete="off">
          <label class="cmd-text-field__label">歌单名称</label>
        </div>
      </div>
      <div class="cmd-dialog-actions">
        <button class="cmd-dialog-btn cmd-dialog-btn--cancel">取消</button>
        <button class="cmd-dialog-btn cmd-dialog-btn--confirm">创建</button>
      </div>
    `;
    overlay.appendChild(dlg);
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('open'));

    const input = dlg.querySelector('#new-playlist-input');
    const confirmBtn = dlg.querySelector('.cmd-dialog-btn--confirm');
    // 延迟聚焦：等 dialog 淡入动画启动后再 focus，
    // 否则在 opacity:0 容器内某些浏览器会丢失焦点导致输入无响应
    setTimeout(() => input.focus(), 50);

    let done = false;
    let creating = false;
    function close() {
      if (done) return;
      done = true;
      overlay.classList.remove('open');
      setTimeout(() => {
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      }, 180);
    }

    function create() {
      if (creating) return;
      const name = (input.value || '').trim();
      if (!name) {
        input.focus();
        return;
      }
      creating = true;
      confirmBtn.disabled = true;
      App.utils.call('create_playlist', name).then(function (res) {
        const pl = JSON.parse(res);
        close();
        App.playlists.refresh().then(function () {
          navigate('playlists', { playlist_id: pl.id, playlist_name: pl.name });
        });
      }).catch(function (err) {
        console.error('[playlist] 创建歌单失败:', err);
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

  // 点击外部关闭副菜单
  document.addEventListener('click', function (e) {
    if (!_isPlaylistsSubmenuOpen()) return;
    if (playlistsSubmenu && playlistsSubmenu.contains(e.target)) return;
    if (playlistsNavBtn && playlistsNavBtn.contains(e.target)) return;
    _closePlaylistsSubmenu();
  });
  // 滚动或窗口大小变化时重新定位
  window.addEventListener('resize', function () {
    if (_isPlaylistsSubmenuOpen()) _positionPlaylistsSubmenu();
  });
  // Esc 关闭
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && _isPlaylistsSubmenuOpen()) {
      _closePlaylistsSubmenu();
    }
  });

  // 启动
  document.addEventListener('DOMContentLoaded', initBridge);

})();
