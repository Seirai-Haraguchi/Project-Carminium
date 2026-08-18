/**
 * Carminium — 主应用外壳与路由
 */
(function () {
  'use strict';

  const App = window.App || {};
  window.App = App;

  App.state = {
    currentPage: 'your_mix',
    currentTrack: null,
    playbackState: 'stopped', // playing, paused, stopped
    shuffle: false,
    repeat: 'off',
    queue: [],
    currentQueueIndex: -1,
    allTracks: [],       // 全量曲目缓存，启动时拉取，library_updated 时刷新
    allAlbums: [],       // 全量专辑缓存
    allArtists: [],      // 全量艺术家缓存
    allFolders: [],      // 全量文件夹缓存
    allSubsonicServers: [], // 全量 Subsonic 服务器缓存（兼容旧代码）
    allRemoteServers: [],   // 全量远程服务器缓存（Subsonic + WebDAV + SMB）
    colorScheme: 'tonal_spot', // Material You 配色方案
    monetSource: 'album_cover', // 莫奈取色来源: "album_cover" | "system_wallpaper"
    isExclusive: false,  // WASAPI 独占模式标志（由 settings_changed 同步）
    tagEditorPath: '',   // 外部音乐标签编辑应用路径（由 settings_changed 同步）
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
      // Parse at the IPC boundary so the large raw JSON string can be
      // released as soon as its corresponding result is consumed, instead
      // of retaining all raw payloads while the other responses parse.
      App.utils.call('get_library').then(function (raw) { return JSON.parse(raw); }),
      App.utils.call('get_albums').then(function (raw) { return JSON.parse(raw); }),
      App.utils.call('get_artists').then(function (raw) { return JSON.parse(raw); }),
      App.utils.call('get_folders').then(function (raw) { return JSON.parse(raw); }),
      App.utils.call('get_subsonic_servers').then(function (raw) { return JSON.parse(raw); }),
      App.utils.call('get_remote_servers').then(function (raw) { return JSON.parse(raw); }).catch(function () { return []; }),
    ]).then(function (results) {
      function replaceArrayInPlace(key, next) {
        var current = App.state[key];
        if (Array.isArray(current) && Array.isArray(next) && current !== next) {
          current.length = 0;
          for (var i = 0; i < next.length; i++) current.push(next[i]);
          // Keep page modules pointing at the same live array, while allowing
          // the parsed response array to be collected after this callback.
          App.state[key] = current;
        } else {
          App.state[key] = next;
        }
      }
      replaceArrayInPlace('allTracks', results[0]);
      replaceArrayInPlace('allAlbums', results[1]);
      replaceArrayInPlace('allArtists', results[2]);
      replaceArrayInPlace('allFolders', results[3]);
      replaceArrayInPlace('allSubsonicServers', results[4]);
      // allRemoteServers 可能不存在（如果 get_remote_servers 不可用），安全处理
      if (results[5]) {
        replaceArrayInPlace('allRemoteServers', results[5]);
        // 同步更新 allSubsonicServers 为远程服务器中 subsonic 类型的子集（兼容旧代码）
        var subsonicOnly = results[5].filter(function (s) { return s.type === 'subsonic'; });
        replaceArrayInPlace('allSubsonicServers', subsonicOnly);
      }
      return App.state;
    });
  };

  // 后台预热艺人头像本地缓存：把全部艺人名发给主进程，由它节流抓取并落盘。
  // 已缓存/已入队的自动跳过，可反复调用、幂等。详情页打开时命中磁盘缓存即瞬间出图。
  App.prefetchArtistImages = function () {
    const list = (App.state && App.state.allArtists) || [];
    if (!list.length) return;
    const names = list.map(function (a) { return a && a.name; }).filter(Boolean);
    if (names.length && window.__electronAPI && window.__electronAPI.invoke) {
      window.__electronAPI.invoke('prefetch_artist_images', JSON.stringify(names)).catch(function () { /* ignore */ });
    }
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

        // ── UI 状态同步层 ──────────────────────────────────────────────
        // 所有 backend 信号先入队到 uiSync，下一帧 RAF 批量 flush 才执行 DOM 更新。
        // 这样 IPC handler O(1) 返回，不阻塞 PCM 转发 IPC → 大队列渲染时播放不断音。
        // 详见 ui_state_sync.js。
        var uiSync = window.uiSync;

        // position_changed 是高频事件（250ms tick），合并到最新值
        uiSync.markHighFreq('position_changed');

        // 注册处理器（DOM 更新逻辑，在 RAF 中执行）
        uiSync.on('track_changed', _onTrackChanged);
        uiSync.on('playback_state_changed', _onStateChanged);
        uiSync.on('position_changed', _onPositionChanged);
        uiSync.on('duration_changed', _onDurationChanged);
        uiSync.on('volume_changed', _onVolumeChanged);
        uiSync.on('shuffle_changed', _onShuffleChanged);
        uiSync.on('repeat_changed', _onRepeatChanged);
        uiSync.on('queue_changed', _onQueueChanged);
        uiSync.on('liked_changed', _onLikedChanged);
        uiSync.on('lyrics_changed', _onLyricsChanged);

        // 歌单 / 历史 / 喜爱列表变化
        uiSync.on('playlists_changed', function (json) {
          try { App.state.allPlaylists = JSON.parse(json); } catch (e) {}
          if (App.playlists && App.playlists.refresh) {
            App.playlists.refresh();
          }
          // 若当前在歌单详情页，刷新当前歌单内容
          if (App.state.currentPage === 'playlists' && App.pages.playlists && App.pages.playlists.onPlaylistsChanged) {
            App.pages.playlists.onPlaylistsChanged(json);
          }
        });
        uiSync.on('history_changed', function (json) {
          if (App.state.currentPage === 'history' && App.pages.history && App.pages.history.onHistoryChanged) {
            App.pages.history.onHistoryChanged(json);
          }
          if (App.state.currentPage === 'your_mix' && App.pages.your_mix && App.pages.your_mix.onHistoryChanged) {
            App.pages.your_mix.onHistoryChanged(json);
          }
        });
        uiSync.on('liked_tracks_changed', function (json) {
          if (App.state.currentPage === 'liked' && App.pages.liked && App.pages.liked.onLikedTracksChanged) {
            App.pages.liked.onLikedTracksChanged(json);
          }
        });

        // Subsonic 服务器列表变化（添加/删除/同步完成）
        uiSync.on('subsonic_servers_changed', function (json) {
          try { App.state.allSubsonicServers = JSON.parse(json); } catch (e) {}
          if (App.pages.folders && App.pages.folders.onSubsonicServersUpdated) {
            App.pages.folders.onSubsonicServersUpdated(json);
          }
        });

        // 统一远程服务器列表变化（Subsonic + WebDAV + SMB）
        uiSync.on('remote_servers_changed', function (json) {
          try {
            var servers = JSON.parse(json);
            App.state.allRemoteServers = servers;
            // 同步更新 allSubsonicServers 为 subsonic 类型的子集（兼容旧代码）
            App.state.allSubsonicServers = servers.filter(function (s) { return s.type === 'subsonic'; });
          } catch (e) {}
          if (App.pages.folders && App.pages.folders.onRemoteServersUpdated) {
            App.pages.folders.onRemoteServersUpdated(json);
          }
        });

        // Subsonic 异步同步结果（成功/失败）—— 低频、独立逻辑，仍走 __bridge.on
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
        // no-op handler，无需走 uiSync（不触发 DOM 更新）
        App.backend.bpm_analyzed.connect(function () {
          /* AutoMix 变速过渡依赖前端 Web Audio API，已随前端模式一并移除 */
        });

        // 播放错误：无音频设备时通知用户
        App.backend.playback_error.connect(function (errJson) {
          try {
            var err = JSON.parse(errJson);
            if (err.type === 'no_audio_device' && App.utils && App.utils.toast) {
              App.utils.toast(App.i18n ? App.i18n.t('audio.noDeviceToast') : err.message);
            }
          } catch (e) { /* ignore */ }
        });

        uiSync.on('library_updated', function (json) {
          // 刷新前端全量缓存，然后重渲染当前页
          if (App.pages.music && App.pages.music.releaseLibraryViewMemory) {
            App.pages.music.releaseLibraryViewMemory();
          }
          App.refreshLibraryCache().then(function () {
            App.prefetchArtistImages();   // 新艺人入队，后台慢慢预热本地头像缓存
            var _c = document.getElementById('page-container');
            if (App.state.currentPage === 'music') App.pages.music.render(_c);
            if (App.state.currentPage === 'your_mix' && App.pages.your_mix) App.pages.your_mix.render(_c);
            if (App.i18n && App.i18n.applyToDOM) App.i18n.applyToDOM(_c);
            if (App.pages.folders.onFoldersUpdated) App.pages.folders.onFoldersUpdated(json);
          });
        });
        uiSync.on('folders_updated', function (json) {
          if (App.pages.music && App.pages.music.releaseLibraryViewMemory) {
            App.pages.music.releaseLibraryViewMemory();
          }
          App.refreshLibraryCache().then(function () {
            if (App.pages.folders.onFoldersUpdated) {
              App.pages.folders.onFoldersUpdated(json);
            }
          });
        });

        // 设置变更：同步正在播放页音频模式按钮（excl/shrd）
        uiSync.on('settings_changed', function (sjson) {
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
            // 语言变更
            if (s.language !== undefined && App.i18n && App.i18n.getLang() !== s.language) {
              App.i18n.init(s.language);
            }
            // 莫奈取色来源变更
            if (s.monet_source !== undefined) {
              App.state.monetSource = s.monet_source;
              // 切换到系统壁纸时立即获取系统强调色
              if (s.monet_source === 'system_wallpaper') {
                _refreshMonetFromSystem();
              } else if (App.state.currentDominantRgb) {
                // 切换到封面取色时，用当前缓存的主色重新应用
                App.utils.applyDynamicTheme(App.state.currentDominantRgb, App.state.colorScheme);
              }
            }
            // 手柄按钮布局变更
            if (s.gamepad_button_layout !== undefined && App.gamepad && App.gamepad.setButtonLayout) {
              App.gamepad.setButtonLayout(s.gamepad_button_layout);
            }
            // デフォルト復元ビュー変更
            if (s.np_default_view !== undefined && App.nowPlaying) {
              App.nowPlaying.setDefaultView(s.np_default_view);
            }
            // 外部音乐标签编辑应用路径变更
            if (s.tag_editor_path !== undefined) {
              App.state.tagEditorPath = s.tag_editor_path || '';
            }
          } catch (e) { /* ignore */ }
        });

        // 信号 → 入队（IPC handler O(1) 返回，不阻塞 PCM 转发）
        // 高频事件（position_changed）合并，低频事件 FIFO
        function _wireSignal(signalName) {
          App.backend[signalName].connect(function (payload) {
            uiSync.enqueue(signalName, payload);
          });
        }
        _wireSignal('track_changed');
        _wireSignal('playback_state_changed');
        _wireSignal('position_changed');
        _wireSignal('duration_changed');
        _wireSignal('volume_changed');
        _wireSignal('shuffle_changed');
        _wireSignal('repeat_changed');
        _wireSignal('queue_changed');
        _wireSignal('liked_changed');
        _wireSignal('lyrics_changed');
        _wireSignal('playlists_changed');
        _wireSignal('history_changed');
        _wireSignal('liked_tracks_changed');
        _wireSignal('subsonic_servers_changed');
        _wireSignal('remote_servers_changed');
        _wireSignal('library_updated');
        _wireSignal('folders_updated');
        _wireSignal('settings_changed');

        // 初始化 UI
        App.nowPlaying.init();

        // 获取初始状态并渲染
        _initTheme();
        _loadShortcuts();
        // 拉取歌单列表（填充侧边栏飞出菜单），不阻塞首页渲染
        if (App.playlists && App.playlists.refresh) {
          App.playlists.refresh();
        }
        // 先拉取全量缓存，再拉取播放状态，最后渲染首页（按当前模式进入对应默认页）
        App.refreshLibraryCache().then(function () {
          App.prefetchArtistImages();   // 启动后后台慢慢预热本地艺人头像缓存
          return _fetchInitialState();
        }).then(function () {
          // 首次启动：未完成新手引导时进入引导流程，否则直接进入主界面
          App.utils.call('get_settings').then(function (res) {
            var settings = null;
            try { settings = JSON.parse(res); } catch (e) { /* ignore */ }
            if (App.onboarding && App.onboarding.checkAndStart && settings && App.onboarding.checkAndStart(settings)) {
              return;  // 引导完成后会自行 navigate('your_mix')
            }
            navigate('your_mix');
          }).catch(function () { navigate('your_mix'); });
        }).catch(function (err) {
          console.error('[app] 初始化失败:', err);
          _showFatalError(App.i18n ? App.i18n.t('error.initFailed', { message: (err && err.message ? err.message : String(err)) }) : ('初始化失败：' + (err && err.message ? err.message : String(err))));
        });
      }).catch(function (err) {
        console.error('[app] get_cover_base_url 失败:', err);
        _showFatalError(App.i18n ? App.i18n.t('error.backendFailed') : '无法连接后端服务');
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

  /**
   * 监听 data-theme 变化，将当前主题（light/dark）通知主进程，
   * 使窗口/任务栏图标随系统暗色模式（或手动主题覆盖）自动切换。
   * 用 MutationObserver 统一覆盖所有修改 data-theme 的代码路径
   * （系统主题实时变化、设置中的手动覆盖等）。
   */
  function _watchThemeForIconSync() {
    var lastTheme = null;
    function notify() {
      var theme = document.documentElement.getAttribute('data-theme');
      if (theme === lastTheme) return;
      lastTheme = theme;
      try {
        if (window.__electronAPI && window.__electronAPI.invoke) {
          window.__electronAPI.invoke('set_window_icon_theme', theme).catch(function () {});
        }
      } catch (e) { /* ignore */ }
    }
    notify(); // 同步初始主题
    if (typeof MutationObserver !== 'undefined') {
      var observer = new MutationObserver(notify);
      observer.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['data-theme'],
      });
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

      // 加载莫奈取色来源
      App.state.monetSource = settings.monet_source || 'album_cover';
      if (App.state.monetSource === 'system_wallpaper') {
        _refreshMonetFromSystem();
      }

      // 应用界面字体
      _applyUiFont(settings.ui_font || '');

      // 初始化界面语言
      if (App.i18n && settings.language) {
        App.i18n.init(settings.language);
      }

      // 同步独占模式标志到 App.state
      App.state.isExclusive = !!settings.wasapi_exclusive;

      // 同步正在播放页音频模式按钮（excl/shrd）
      if (App.nowPlaying && App.nowPlaying.updateAudioMode) {
        App.nowPlaying.updateAudioMode(!!settings.wasapi_exclusive);
      }

      // 同步外部音乐标签编辑应用路径到 App.state
      App.state.tagEditorPath = settings.tag_editor_path || '';
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

    // 将主题同步到主进程，使窗口/任务栏图标随暗色模式自动变化
    _watchThemeForIconSync();
  }

  /**
   * 从系统壁纸/强调色获取主色并应用动态主题。
   * 通过 IPC 获取 Windows 系统强调色，回退到 MD3 基准蓝紫色调。
   */
  function _refreshMonetFromSystem() {
    if (!window.__electronAPI || !window.__electronAPI.invoke) {
      _applyMonetFallback();
      return;
    }
    window.__electronAPI.invoke('get_system_accent_color').then(function (rgb) {
      if (rgb && Array.isArray(rgb) && rgb.length === 3) {
        App.state.currentDominantRgb = rgb;
        App.utils.applyDynamicTheme(rgb, App.state.colorScheme);
      } else {
        _applyMonetFallback();
      }
    }).catch(function () {
      _applyMonetFallback();
    });
  }

  function _applyMonetFallback() {
    var fallback = [103, 80, 164];  // #6750A4, MD3 baseline primary
    App.state.currentDominantRgb = fallback;
    App.utils.applyDynamicTheme(fallback, App.state.colorScheme);
  }

  // ── 2. Signal Handlers ───────────────────────────────────────────────────

  function _onTrackChanged(trackJson) {
    const track = JSON.parse(trackJson);
    App.state.currentTrack = track;
    // 清除旧曲的过渡点标记（新曲的标记在分析完成后由 _maybeComputePlan 设置）
    App.nowPlaying.clearTransitionPoint();

    // ── 内存管理：触发切歌清理 ──
    if (window.MemoryManager) {
      window.MemoryManager.fireTrackChangeCleanup();
    }

    // gapless 切换：延迟 updateTrack 到 requestAnimationFrame，
    // 让事件循环先处理 OutputCaptureWorklet 积压的 PCM 消息。
    // 否则 updateTrack 的同步 DOM 操作会阻塞主线程，
    // 导致 WASAPI DLL 缓冲区欠载 → 顿卡。
    if (_gaplessSwitchPending || _crossfadeSwitchPending) {
      _gaplessSwitchPending = false;
      _crossfadeSwitchPending = false;
      _skipNextTrackGlitch = false; // gapless/crossfade 不需要 glitch 动画
      requestAnimationFrame(function () {
        App.nowPlaying.updateTrack(track);
        // 列表高亮也延迟，减少同一帧的同步工作量
        _updateListPlayState();
      });
      return;
    }

    App.nowPlaying.updateTrack(track);

    // 非 crossfade 切歌：触发文字崩坏过渡动画
    // crossfade 已通过 onCrossfadeStart/Complete 处理过渡，跳过
    if (_skipNextTrackGlitch) {
      _skipNextTrackGlitch = false;
    } else if (_audioEngine && _audioEngine._isPlaying) {
      // 仅在已有曲目播放时触发（排除首次加载）
      App.nowPlaying.setTrackInfoHidden(true);
      setTimeout(function () {
        App.nowPlaying.setTrackInfoHidden(false);
      }, 800);
    }

    _updateListPlayState();
  }

  function _updateListPlayState() {
    if (App.state.currentPage === 'your_mix' && App.pages.your_mix.updatePlayState) {
      App.pages.your_mix.updatePlayState();
    }
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

  // 歌词变更（手动指定 / 自动搜索 / 外部更新）
  // 后端 apply_lyrics / apply_lyrics_temporary 均通过此事件通知前端，
  // 携带 {trackId, lyrics} JSON。前端据此增量更新歌词显示，不触发 glitch 动画。
  function _onLyricsChanged(json) {
    var data;
    try { data = JSON.parse(json); } catch (e) {
      console.error('[app] lyrics_changed parse error:', e);
      return;
    }
    if (!data || !data.trackId) return;
    // 仅处理当前播放曲目的歌词变更
    if (!App.state.currentTrack || App.state.currentTrack.id !== data.trackId) return;
    App.state.currentTrack.lyrics = data.lyrics;
    if (App.nowPlaying.updateLyrics) {
      App.nowPlaying.updateLyrics(data.trackId, data.lyrics);
    }
  }

  // ── 3. 路由与导航 ────────────────────────────────────────────────────────

  // 导航历史（供标题栏返回按钮使用）
  App.navHistory = [];
  App.navHistorySuppress = false;

  // 返回上一页（供标题栏返回按钮调用）
  App.goBack = function () {
    if (App.navHistory.length > 1) {
      App.navHistory.pop();
      var prevPage = App.navHistory[App.navHistory.length - 1];
      if (prevPage) {
        App.navHistorySuppress = true;
        navigate(prevPage);
        App.navHistorySuppress = false;
      }
    } else {
      navigate('your_mix');
    }
    if (App.titlebar && App.titlebar.updateBackButton) App.titlebar.updateBackButton();
  };

  function navigate(pageId, params) {
    // 记录导航历史
    if (!App.navHistorySuppress) {
      App.navHistory.push(pageId);
      if (App.navHistory.length > 20) App.navHistory.shift();
    }

    // 清除曲目多选状态
    if (App.selection) App.selection.clear();

    // ── 设置页特殊布局：隐藏侧边栏 + 禁用侧边播放器 ──
    if (pageId === 'settings') {
      document.body.classList.add('settings-active');
    } else {
      document.body.classList.remove('settings-active');
    }

    // ── 内存管理：触发页面导航清理 ──
    if (window.MemoryManager) {
      window.MemoryManager.fireNavigationCleanup();
    }

    const container = document.getElementById('page-container');

    // 保存当前页面的滚动位置，以便返回时恢复
    App.scrollMemory.save(App.state.currentPage);

    const oldPage = document.querySelector('.nav-item.active');
    if (oldPage) oldPage.classList.remove('active');

    const newPage = document.querySelector(`.nav-item[data-page="${pageId}"]`);
    if (newPage) newPage.classList.add('active');

    App.state.currentPage = pageId;
    App.state.currentPageParams = params;

    // 触发动画；about 使用内部平移动画，不再叠加 page-enter
    const useInternalTransition = pageId === 'about';
    container.classList.remove('page-enter');
    // void container.offsetWidth; // trigger reflow
    setTimeout(() => {
      if (App.pages[pageId] && App.pages[pageId].render) {
        App.pages[pageId].render(container, params);
        // 对动态插入的 DOM 应用 i18n 翻译（data-i18n 等属性）
        if (App.i18n && App.i18n.applyToDOM) App.i18n.applyToDOM(container);
        // 恢复新页面的滚动位置（异步页面会在数据加载后逐步恢复）
        App.scrollMemory.scheduleRestore(pageId);
        setTimeout(() => {
          if (App.pages[pageId].updatePlayState) App.pages[pageId].updatePlayState();
        }, 50);
      } else {
        container.innerHTML = `<h2>${App.i18n.t('error.pageNotFound')}</h2>`;
      }
      if (!useInternalTransition) {
        container.classList.add('page-enter');
      }
    }, 10);

    // 更新标题栏返回按钮状态
    if (App.titlebar && App.titlebar.updateBackButton) App.titlebar.updateBackButton();
  }

  App.navigate = navigate;

  // ── 3.4 语言变更：重新渲染当前页面 ───────────────────────────────────────
  if (App.i18n && App.i18n.onChange) {
    App.i18n.onChange(function () {
      // 重新渲染当前页面（各页面 render 内部会读取最新翻译）
      var page = App.state.currentPage;
      var container = document.getElementById('page-container');
      if (page && App.pages[page] && App.pages[page].render && container) {
        // 保存滚动位置，渲染后恢复
        App.scrollMemory.save(page);
        App.pages[page].render(container, App.state.currentPageParams || undefined);
        // 对重新渲染的 DOM 应用 i18n 翻译
        if (App.i18n && App.i18n.applyToDOM) App.i18n.applyToDOM(container);
        App.scrollMemory.scheduleRestore(page);
      }
      // 通知正在播放面板刷新动态文本
      if (App.nowPlaying && App.nowPlaying.onLanguageChanged) {
        App.nowPlaying.onLanguageChanged();
      }
    });
  }

  // ── 3.5 全局快捷键 ───────────────────────────────────────────────────────

  const SHORTCUT_ACTIONS = {
    play_pause: { label: () => App.i18n.t('shortcut.play_pause'), handler: () => {
      if (!App.backend) return;
      if (App.state.playbackState === 'playing') App.backend.pause();
      else App.backend.play();
    }},
    next_track: { label: () => App.i18n.t('shortcut.next_track'), handler: () => App.backend && App.backend.next_track && App.backend.next_track() },
    prev_track: { label: () => App.i18n.t('shortcut.prev_track'), handler: () => App.backend && App.backend.prev_track && App.backend.prev_track() },
    volume_up: { label: () => App.i18n.t('shortcut.volume_up'), handler: () => App.backend && App.backend.set_volume && _adjustVolume(5) },
    volume_down: { label: () => App.i18n.t('shortcut.volume_down'), handler: () => App.backend && App.backend.set_volume && _adjustVolume(-5) },
    toggle_like: { label: () => App.i18n.t('shortcut.toggle_like'), handler: () => App.backend && App.backend.toggle_liked && App.backend.toggle_liked() },
    toggle_mute: { label: () => App.i18n.t('shortcut.toggle_mute'), handler: () => App.backend && App.backend.set_volume && _toggleMute() },
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

  // 标题栏设置按钮
  const titleBarSettings = document.getElementById('title-bar-settings');
  if (titleBarSettings) {
    titleBarSettings.addEventListener('click', function () {
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
    
    // 清空并重建列表
    playlistsListEl.innerHTML = '';
    const frag = document.createDocumentFragment();

    // ── 每日合集入口 ──
    var mixHeader = document.createElement('div');
    mixHeader.className = 'nav-submenu-section-header';
    mixHeader.innerHTML = '<span class="material-symbols-rounded" style="font-size:14px">auto_awesome</span><span>' + (App.i18n ? App.i18n.t('yourMix.dailyMix') : '每日合集') + '</span>';
    frag.appendChild(mixHeader);

    var mixItem = document.createElement('button');
    mixItem.className = 'nav-submenu-item nav-submenu-item--mix';
    mixItem.type = 'button';
    mixItem.innerHTML = `
      <span class="material-symbols-rounded nav-submenu-item-icon">auto_awesome</span>
      <span class="nav-submenu-item-name">${App.i18n ? App.i18n.t('nav.yourMix') : '探新'}</span>
      <span class="material-symbols-rounded nav-submenu-item-chevron">chevron_right</span>
    `;
    mixItem.addEventListener('click', function () {
      _closePlaylistsSubmenu();
      navigate('your_mix');
    });
    frag.appendChild(mixItem);

    // 分隔线
    var divider = document.createElement('div');
    divider.className = 'nav-submenu-divider';
    frag.appendChild(divider);

    // 歌单标题
    var plHeader = document.createElement('div');
    plHeader.className = 'nav-submenu-section-header';
    plHeader.innerHTML = '<span class="material-symbols-rounded" style="font-size:14px">queue_music</span><span>' + (App.i18n ? App.i18n.t('nav.playlists') : '歌单') + '</span>';
    frag.appendChild(plHeader);

    if (!playlists || playlists.length === 0) {
      var empty = document.createElement('div');
      empty.className = 'nav-submenu-empty';
      empty.innerHTML = '<span class="material-symbols-rounded">queue_music</span><p>' + (App.i18n ? App.i18n.t('empty.noPlaylists') : '暂无歌单') + '</p>';
      frag.appendChild(empty);
    } else {
      playlists.forEach(pl => {
        const isRemote = pl.source === 'subsonic';
        const item = document.createElement('button');
        item.className = 'nav-submenu-item';
        item.type = 'button';
        var iconHtml;
        if (isRemote && pl.cover_art_id && pl.server_id && window.__coverBase) {
          iconHtml = '<img class="nav-submenu-item-cover" src="' + window.__coverBase + '/subsonic/cover/' + pl.server_id + '/' + encodeURIComponent(pl.cover_art_id) + '" alt="" loading="lazy" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'inline-flex\'"><span class="material-symbols-rounded nav-submenu-item-icon" style="display:none">cloud</span>';
        } else {
          iconHtml = '<span class="material-symbols-rounded nav-submenu-item-icon">' + (isRemote ? 'cloud' : 'playlist_play') + '</span>';
        }
        item.innerHTML = `
          ${iconHtml}
          <span class="nav-submenu-item-name">${App.utils.esc(pl.name)}</span>
          ${isRemote ? '<span class="playlist-mini-badge">☁</span>' : ''}
          <span class="nav-submenu-item-count">${pl.track_count || 0}</span>
        `;
      item.addEventListener('click', function () {
        _closePlaylistsSubmenu();
        navigate('playlists', { playlist_id: pl.id, playlist_name: pl.name, source: pl.source, server_id: pl.server_id, remote_id: pl.remote_id, server_name: pl.server_name, cover_art_id: pl.cover_art_id, owner: pl.owner, owner_email: pl.owner_email });
      });
      // 拖拽放入歌单（本地和远程都支持）
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
        } catch (err) {
          console.warn('[playlists] drop parse error:', err);
        }
      });
      frag.appendChild(item);
    });
    }
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
  if (playlistsSubmenu) {
    const header = playlistsSubmenu.querySelector('.nav-submenu-header');
    if (header && !header.querySelector('.nav-submenu-import')) {
      const importBtn = document.createElement('button');
      importBtn.className = 'nav-submenu-import';
      importBtn.id = 'nav-playlist-import';
      importBtn.innerHTML = '<span class="material-symbols-rounded">cloud_download</span>';
      importBtn.title = '\u4ece Subsonic \u670d\u52a1\u5668\u5bfc\u5165\u6b4c\u5355';
      importBtn.setAttribute('aria-label', '\u4ece Subsonic \u670d\u52a1\u5668\u5bfc\u5165\u6b4c\u5355');
      importBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        _promptImportSubsonicPlaylists();
      });
      header.appendChild(importBtn);
    }
  }

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

  // ── 4.7 窗口尺寸调整：拖拽期间禁用过渡，直接定格最终布局 ───────────────
  // 主内容区（及整棵文档）在 resize 期间给 <body> 添加 .is-resizing，
  // CSS 内全局禁用 transition（见 style.css），松手 120ms 后移除，
  // 使窗口缩放时各区域直接切到最终尺寸，而非跟着过渡“追”窗口导致滞后/抖动。
  let _resizingTimer = null;
  window.addEventListener('resize', function () {
    document.body.classList.add('is-resizing');
    if (_resizingTimer) clearTimeout(_resizingTimer);
    _resizingTimer = setTimeout(function () {
      document.body.classList.remove('is-resizing');
    }, 120);
  });
  // Esc 关闭
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && _isPlaylistsSubmenuOpen()) {
      _closePlaylistsSubmenu();
    }
  });

  // ── 5. AudioEngine（Web Audio API）──────────────────────────────────────
  // Web Audio API で音频解码・混音（Gapless / AutoMix / 音量）を行い、
  // 合成済み PCM を OutputCaptureWorklet → DLL (WASAPI) に転送する。

  var _audioEngine = null;

  // 暴露 audioEngine 供外部组件使用（频谱分析等）
  Object.defineProperty(App, 'audioEngine', {
    get: function () { return _audioEngine; }
  });

  // 暴露当前曲目分析数据（含 BPM）供外部组件使用
  Object.defineProperty(App, 'currentAnalysis', {
    get: function () { return _currentTrackAnalysis; }
  });
  var _skipNextTrackGlitch = false;  // crossfade 已处理过渡动画时跳过 glitch
  var _gaplessSwitchPending = false; // gapless 切换待处理：延迟 updateTrack 避免阻塞音频管线
  var _crossfadeSwitchPending = false; // crossfade 切换待处理：延迟 updateTrack 避免阻塞音频管线

  function _initAudioEngine() {
    if (!window.AudioEngine) {
      console.error('[app] AudioEngine class not found');
      return;
    }
    if (!window.__electronAPI) {
      console.warn('[app] __electronAPI not available, skip AudioEngine init');
      return;
    }

    _audioEngine = new window.AudioEngine();

    // ── AudioEngine → Main (IPC) ──
    _audioEngine.onOutput = function (arrayBuffer) {
      window.__electronAPI.sendAudioOutput(arrayBuffer);
    };
    _audioEngine.onEnded = function () {
      window.__electronAPI.sendAudioEnded();
    };
    _audioEngine.onPositionTick = function (ms) {
      window.__electronAPI.sendAudioPositionTick(ms);
    };
    _audioEngine.onCrossfadeStart = function () {
      // 通知 main 进程：crossfade 已启动（next 源开始淡入）
      // player.js 据此设置 _inCrossfade 标志，避免过渡期内清理 next（如 setRepeat）
      if (window.__electronAPI && window.__electronAPI.sendAudioCrossfadeStart) {
        window.__electronAPI.sendAudioCrossfadeStart();
      }
      App.nowPlaying.showTransition(true);
      App.nowPlaying.setTrackInfoHidden(true);
    };
    _audioEngine.onCrossfadeComplete = function (positionMs) {
      _skipNextTrackGlitch = true;  // crossfade 已完成过渡动画，跳过后续 glitch
      // 清除过渡标记（旧曲的过渡点已失效，新曲的标记由后续分析设置）
      App.nowPlaying.clearTransitionPoint();
      App.nowPlaying.setTrackInfoHidden(false);
      // 延迟 updateTrack 到 requestAnimationFrame，让事件循环先处理音频管线，
      // 避免同步 DOM 操作阻塞主线程导致 WASAPI 缓冲区欠载 → 顿卡。
      _crossfadeSwitchPending = true;
      window.__electronAPI.sendAudioCrossfadeComplete(positionMs);
      // 安全超时：如果 track_changed 未到达，2 秒后清除标志
      setTimeout(function () { _crossfadeSwitchPending = false; }, 2000);
    };
    _audioEngine.onStreamEnded = function () {
      // FFmpeg 流式播放结束（WMA/APE 等格式）
      window.__electronAPI.sendAudioEnded();
    };
    _audioEngine.onGaplessSwitch = function () {
      // 无缝切换完成，通知 player.js 推进队列索引
      // 跳过 glitch 动画（gapless 应无缝，不需要文字崩坏过渡）
      // 标记 pending：_onTrackChanged 会延迟 updateTrack 到 rAF，
      // 让事件循环先处理 OutputCaptureWorklet 的 PCM 消息，避免音频管线阻塞瞬断
      _skipNextTrackGlitch = true;
      _gaplessSwitchPending = true;
      window.__electronAPI.sendAudioGaplessSwitch();
      // 安全超时：如果 track_changed 未到达（队列末尾停止等场景），2 秒后清除标志
      setTimeout(function () { _gaplessSwitchPending = false; }, 2000);
    };

    // ── Main → AudioEngine: 文件解码结果（IPC 监听） ──
    // 注册 IPC 监听器，将主进程的文件解码结果转发到 AudioEngine
    if (window.__electronAPI.onAudioFileDecoded) {
      window.__electronAPI.onAudioFileDecoded(function (filePath, arrayBuffer) {
        if (_audioEngine) _audioEngine.onFileLoaded(filePath, arrayBuffer);
      });
    }
    if (window.__electronAPI.onAudioFileDecodeError) {
      window.__electronAPI.onAudioFileDecodeError(function (filePath, error) {
        if (_audioEngine) _audioEngine.onFileLoadError(filePath, error);
      });
    }

    // ── Main → AudioEngine: DLL 缓冲延迟 (via reliable IPC channel) ──
    window.__electronAPI.onAudioLatency(function (ms) {
      if (_audioEngine) _audioEngine.setDllBufferLatency(ms);
    });
    // 保留旧全局函数作为后备
    window.__setDllBufferLatency = function (ms) {
      if (_audioEngine) _audioEngine.setDllBufferLatency(ms);
    };

    // ── Main → AudioEngine: audio_control (via executeJavaScript) ──
    window.__handleAudioControl = function (json) {
      try {
        var cmd = typeof json === 'string' ? JSON.parse(json) : json;
        switch (cmd.action) {
          case 'init':
            _audioEngine.init(cmd.sampleRate, cmd.channels).then(function (info) {
              console.log('[app] AudioEngine initialized:', info);
              // 同步音频效果设置到 AudioEngine
              _syncAudioEffects();
            }).catch(function (e) {
              console.error('[app] AudioEngine init failed:', e);
            });
            break;
          case 'play':
            // Web Audio 引擎需要 filePath 来加载并解码文件
            // cmd.paused: 模式切替中の一時停止トラック(未定義 = 通常再生)
            _audioEngine.playCurrent(cmd.filePath, cmd.durationMs, cmd.seekOffsetMs, cmd.paused);
            // 智能过渡：仅 AutoMix(crossfade) 模式需要分析，gapless 不需要
            if (_audioEngine._crossfadeEnabled) {
              _analyzeCurrentTrack(cmd.filePath, cmd.trackId, cmd.title, cmd.artist, cmd.durationMs);
            }
            break;
          case 'play_streaming':
            // FFmpeg 格式：设置流式 PCM 工作节点，等待 FFmpeg PCM 数据
            _audioEngine.playStreaming(cmd.durationMs, cmd.seekOffsetMs, cmd.paused);
            // 智能过渡：仅 AutoMix 模式需要分析
            if (_audioEngine._crossfadeEnabled) {
              _analyzeCurrentTrack(cmd.filePath, cmd.trackId, cmd.title, cmd.artist, cmd.durationMs);
            }
            break;
          case 'stop':
            _audioEngine.stop();
            break;
          case 'pause':
            _audioEngine.pause();
            break;
          case 'resume':
            _audioEngine.resume();
            break;
          case 'seek':
            _audioEngine.seek(cmd.positionMs, cmd.durationMs);
            break;
          case 'set_volume':
            _audioEngine.setVolume(cmd.level);
            break;
          case 'set_gapless':
            _audioEngine.setGaplessEnabled(cmd.enabled);
            break;
          case 'set_crossfade':
            _audioEngine.setCrossfadeEnabled(cmd.enabled);
            // AutoMix 关闭时清除过渡点标记
            if (!cmd.enabled) {
              App.nowPlaying.clearTransitionPoint();
            }
            break;
          case 'set_radical_transitions':
            _audioEngine.setRadicalTransitionsEnabled(cmd.enabled);
            _maybeComputePlan();
            break;
          case 'set_crossfade_duration':
            _audioEngine.setCrossfadeDuration(cmd.ms);
            break;
          case 'set_rate':
            _audioEngine.setUserRate(cmd.value);
            break;
          case 'set_next_info':
            // 次曲信息：filePath + durationMs + forceStreaming
            _audioEngine.setNextInfo(cmd.filePath, cmd.durationMs, cmd.forceStreaming);
            // 智能过渡：仅 AutoMix 模式需要分析下一曲，gapless 不需要
            if (_audioEngine._crossfadeEnabled) {
              _analyzeNextTrack(cmd.filePath, cmd.trackId, cmd.title, cmd.artist, cmd.durationMs);
            }
            break;
          case 'set_transition_plan':
            // 智能过渡方案：主进程根据两曲分析结果计算后下发
            _audioEngine.setTransitionPlan(cmd.plan);
            break;
          case 'clear_next':
            _audioEngine.clearNextState();
            break;
        }
      } catch (e) {
        console.error('[app] audio_control error:', e);
      }
    };

    // ── Main → AudioEngine: FFmpeg PCM 数据（流式播放 WMA/APE）──
    window.__electronAPI.onAudioPcmMain(function (float32Array) {
      _audioEngine.pushMainPcm(float32Array);
    });
    window.__electronAPI.onAudioPcmNext(function (float32Array) {
      _audioEngine.pushNextPcm(float32Array);
    });
    window.__electronAPI.onAudioFfmpegState(function (channel, finished) {
      if (channel === 'main') _audioEngine.setMainFfmpegFinished(finished);
      else _audioEngine.setNextFfmpegFinished(finished);
    });

    console.log('[app] AudioEngine bridge connected');

    // ── 补偿：同步当前 AutoMix/Gapless 状态 ──
    var ea = window.__electronAPI;
    if (ea && ea.invoke) {
      ea.invoke('get_automix').then(function (enabled) {
        _audioEngine.setCrossfadeEnabled(!!enabled);
        console.log('[app] Synced automix (crossfade):', enabled);
      }).catch(function (e) { console.warn('[app] get_automix failed:', e); });
      ea.invoke('get_radical_transitions').then(function (enabled) {
        _audioEngine.setRadicalTransitionsEnabled(!!enabled);
      }).catch(function (e) { console.warn('[app] get_radical_transitions failed:', e); });
      ea.invoke('get_gapless').then(function (enabled) {
        _audioEngine.setGaplessEnabled(!!enabled);
        console.log('[app] Synced gapless:', enabled);
      }).catch(function (e) { console.warn('[app] get_gapless failed:', e); });
      ea.invoke('get_crossfade_duration').then(function (ms) {
        _audioEngine.setCrossfadeDuration(parseInt(ms, 10) || 4000);
        console.log('[app] Synced crossfade duration:', ms);
      }).catch(function (e) { console.warn('[app] get_crossfade_duration failed:', e); });
    }

    // Expose for debugging
    window.__audioEngine = _audioEngine;

    // ── 同步音频效果设置（EQ / 低音补偿 / 压限器）到 AudioEngine ──
    // AudioEngine init() 完成后调用，将保存的效果设置应用到效果链
    function _syncAudioEffects() {
      var ea2 = window.__electronAPI;
      if (!ea2 || !ea2.invoke || !_audioEngine) return;
      ea2.invoke('get_settings').then(function (res) {
        var settings = JSON.parse(res);
        _audioEngine.applyAudioSettings(settings);
      }).catch(function (e) {
        console.warn('[app] _syncAudioEffects failed:', e);
      });
    }

    // 预缓存设置：在 AudioEngine init() 完成前就获取设置，
    // 这样 init() 内部可以直接同步应用，无需等待 IPC
    if (ea && ea.invoke) {
      ea.invoke('get_settings').then(function (res) {
        if (_audioEngine) _audioEngine._settingsCache = JSON.parse(res);
      }).catch(function () {});
    }

    // 通知主进程：AudioEngine 已就绪（传递 true 表示 Web Audio 模式已启用）
    if (ea && ea.invoke) {
      ea.invoke('renderer_ready', true).catch(function (e) {
        console.warn('[app] renderer_ready failed:', e);
      });
    }
  }

  // ── AutoMix 智能分析 ──
  var _trackAnalyzer = null;
  var _transitionPlanner = null;
  var _currentTrackAnalysis = null;
  var _nextTrackAnalysis = null;
  var _currentAnalysisToken = 0;      // 当前曲分析代际令牌（防止过期结果覆盖）
  var _nextAnalysisToken = 0;         // 下一曲分析代际令牌（独立追踪）
  var _analysisPendingTimer = null;

  function _initAutoMixAnalysis() {
    if (!window.TrackAnalyzer || !window.TransitionPlanner) {
      console.warn('[app] TrackAnalyzer or TransitionPlanner not loaded, AutoMix analysis disabled');
      return;
    }
    _trackAnalyzer = new window.TrackAnalyzer(_audioEngine);
    _transitionPlanner = new window.TransitionPlanner();
    console.log('[app] AutoMix analysis initialized');
  }

  /**
   * 触发当前曲分析。在 audio_control:play / play_streaming 时调用。
   * 使用单调递增 token 防止过期异步结果覆盖新数据。
   */
  function _analyzeCurrentTrack(filePath, trackId, title, artist, durationMs) {
    if (!_trackAnalyzer) return;
    // Subsonic 流媒体不支持频谱分析，跳过
    if (filePath && (filePath.indexOf('http://') === 0 || filePath.indexOf('https://') === 0)) {
      ++_currentAnalysisToken;
      _currentTrackAnalysis = null;
      _maybeComputePlan();
      return;
    }
    var token = ++_currentAnalysisToken;
    _currentTrackAnalysis = null;

    // 1. 先从主进程缓存获取
    if (trackId && window.__electronAPI && window.__electronAPI.invoke) {
      window.__electronAPI.invoke('get_track_analysis', trackId).then(function (cached) {
        if (token !== _currentAnalysisToken) return; // 过期
        if (cached) {
          _currentTrackAnalysis = cached;
          console.log('[app] Current track analysis loaded from cache:', title);
          _maybeComputePlan();
          return;
        }
        // 2. 缓存无 → 频谱分析 + osu! 数据
        _performSpectrumAnalysis(filePath, trackId, title, artist, durationMs, token, true);
      }).catch(function () {
        if (token !== _currentAnalysisToken) return;
        _performSpectrumAnalysis(filePath, trackId, title, artist, durationMs, token, true);
      });
    } else {
      _performSpectrumAnalysis(filePath, trackId, title, artist, durationMs, token, true);
    }
  }

  /**
   * 触发下一曲分析。在 audio_control:set_next_info 时调用。
   * 使用独立的 token 追踪，避免快速更换下一曲时旧结果覆盖新数据。
   */
  function _analyzeNextTrack(filePath, trackId, title, artist, durationMs) {
    if (!_trackAnalyzer) return;
    // Subsonic 流媒体不支持频谱分析，跳过
    if (filePath && (filePath.indexOf('http://') === 0 || filePath.indexOf('https://') === 0)) {
      ++_nextAnalysisToken;
      _nextTrackAnalysis = null;
      _maybeComputePlan();
      return;
    }
    var token = ++_nextAnalysisToken;
    _nextTrackAnalysis = null;

    if (trackId && window.__electronAPI && window.__electronAPI.invoke) {
      window.__electronAPI.invoke('get_track_analysis', trackId).then(function (cached) {
        if (token !== _nextAnalysisToken) return; // 过期
        if (cached) {
          _nextTrackAnalysis = cached;
          console.log('[app] Next track analysis loaded from cache:', title);
          _maybeComputePlan();
          return;
        }
        _performSpectrumAnalysis(filePath, trackId, title, artist, durationMs, token, false);
      }).catch(function () {
        if (token !== _nextAnalysisToken) return;
        _performSpectrumAnalysis(filePath, trackId, title, artist, durationMs, token, false);
      });
    } else {
      _performSpectrumAnalysis(filePath, trackId, title, artist, durationMs, token, false);
    }
  }

  /**
   * 执行频谱分析 + osu! 数据获取。
   * 频谱分析在 renderer 进程进行，osu! 数据通过 IPC 从主进程获取。
   * 两者并行执行，完成后合并结果。
   */
  function _performSpectrumAnalysis(filePath, trackId, title, artist, durationMs, token, isCurrent) {
    // 频谱分析（异步，非阻塞）
    var spectrumPromise = _trackAnalyzer.analyze(
      { title: title, artist: artist, duration_ms: durationMs },
      filePath
    );

    // osu! 数据获取（并行）
    var osuPromise = Promise.resolve(null);
    if (title && window.__electronAPI && window.__electronAPI.invoke) {
      osuPromise = window.__electronAPI.invoke('search_osu_beatmap', title, artist, durationMs)
        .catch(function () { return null; });
    }

    // 等待两者完成
    Promise.all([spectrumPromise, osuPromise]).then(function (results) {
      // 过期检查：使用对应的 token
      var currentToken = isCurrent ? _currentAnalysisToken : _nextAnalysisToken;
      if (token !== currentToken) return; // 过期

      var spectrum = results[0];
      var osu = results[1];

      if (!spectrum && !osu) {
        console.log('[app] Analysis failed for:', title, '(no spectrum or osu data)');
        if (isCurrent) _currentTrackAnalysis = null;
        else _nextTrackAnalysis = null;
        _maybeComputePlan();
        return;
      }

      // 合并频谱和 osu 数据
      var analysis = spectrum || {
        bpm: 0,
        energy: null,
        introEndMs: 0,
        outroStartMs: 0,
        climaxMs: 0,
        durationMs: durationMs || 0,
        analyzedAt: Date.now(),
        source: 'osu',
      };
      if (osu) {
        analysis.osu = osu;
        // osu! BPM 优先
        if (osu.bpm > 0) {
          analysis.bpm = osu.bpm;
        }
      }
      analysis.trackId = trackId;

      // 再次检查 token（防止在合并期间被 invalidate）
      currentToken = isCurrent ? _currentAnalysisToken : _nextAnalysisToken;
      if (token !== currentToken) return;

      if (isCurrent) {
        _currentTrackAnalysis = analysis;
      } else {
        _nextTrackAnalysis = analysis;
      }

      console.log('[app] Analysis complete for', (isCurrent ? 'current' : 'next') + ':', title,
        'BPM=' + analysis.bpm, 'source=' + analysis.source);

      // 缓存到主进程（异步，不阻塞）
      if (trackId && window.__electronAPI && window.__electronAPI.invoke) {
        window.__electronAPI.invoke('save_track_analysis', trackId, analysis).catch(function () {});
      }

      _maybeComputePlan();
    }).catch(function (e) {
      console.error('[app] Analysis error:', e);
      var currentToken = isCurrent ? _currentAnalysisToken : _nextAnalysisToken;
      if (token !== currentToken) return;
      if (isCurrent) _currentTrackAnalysis = null;
      else _nextTrackAnalysis = null;
      _maybeComputePlan();
    });
  }

  /**
   * 当分析数据就绪时，计算过渡方案。
   * Subsonic 流媒体也参与过渡：频谱分析不可用时回退到固定时长方案。
   */
  function _maybeComputePlan() {
    if (!_transitionPlanner || !_audioEngine) return;
    if (!_audioEngine._crossfadeEnabled) return; // AutoMix 未启用时不计算

    // 分析数据缺失时仍生成方案（fallback / partial）
    // Subsonic（HTTP URL）的频谱分析不可用，TrackAnalyzer 返回 null，
    // TransitionPlanner 会回退到 _fallbackPlan（固定时长交叉淡化）。
    var plan = _transitionPlanner.plan(
      _currentTrackAnalysis || null,
      _nextTrackAnalysis || null,
      {
        crossfadeDurationMs: _audioEngine._crossfadeDurationMs,
        radicalTransitions: !!_audioEngine._radicalTransitions
      }
    );

    _audioEngine.setTransitionPlan(plan);

    // 通知 UI 显示过渡点标记
    var curDuration = _audioEngine._currentDurationMs ||
      (_currentTrackAnalysis && _currentTrackAnalysis.durationMs) || 0;
    if (plan.transitionStartMs >= 0 && curDuration > 0) {
      App.nowPlaying.setTransitionPoint(plan.transitionStartMs, curDuration);
    } else {
      App.nowPlaying.clearTransitionPoint();
    }

    // 通知主进程
    if (window.__electronAPI && window.__electronAPI.invoke) {
      window.__electronAPI.invoke('set_transition_plan', plan).catch(function () {});
    }
  }

  function _promptImportSubsonicPlaylists() {
    _closePlaylistsSubmenu();
    var servers = (App.state && App.state.allSubsonicServers) ? App.state.allSubsonicServers : [];
    if (servers.length === 0) {
      App.utils.toast(App.i18n.t('subsonic.noServerAdded'));
      return;
    }
    var overlay = document.createElement('div');
    overlay.className = 'cmd-dialog-overlay';
    var dlg = document.createElement('div');
    dlg.className = 'cmd-dialog subsonic-import-dialog';
    dlg.style.maxWidth = '600px';
    var serverOptions = servers.map(function(s) {
      return '<option value="' + s.id + '">' + App.utils.esc(s.name) + ' (' + s.server_url + ')</option>';
    }).join('');
    dlg.innerHTML = ''
      + '<div class="cmd-dialog-title">' + App.i18n.t('playlist.importFromServer') + '</div>'
      + '<div class="cmd-dialog-body">'
      + '  <div class="cmd-text-field">'
      + '    <select id="ss-server-select" class="cmd-text-field__input" style="padding: 10px 12px;">' + serverOptions + '</select>'
      + '    <label class="cmd-text-field__label">' + App.i18n.t('playlist.selectServer') + '</label>'
      + '  </div>'
      + '  <div id="ss-playlists-container" style="min-height: 200px; max-height: 400px; overflow-y: auto; margin-top: 16px;">'
      + '    <div style="display: flex; align-items: center; justify-content: center; padding: 40px; color: var(--md-on-surface-variant);">'
      + '      <span class="material-symbols-rounded" style="margin-right: 8px;">sync</span>'
      + '      <span>' + App.i18n.t('playlist.selectPlaylists') + '</span>'
      + '    </div>'
      + '  </div>'
      + '</div>'
      + '<div class="cmd-dialog-actions">'
      + '  <button class="cmd-dialog-btn cmd-dialog-btn--cancel">' + App.i18n.t('common.cancel') + '</button>'
      + '  <button class="cmd-dialog-btn cmd-dialog-btn--confirm" id="btn-import-playlists" disabled>' + App.i18n.t('playlist.importSelected') + '</button>'
      + '</div>';
    overlay.appendChild(dlg);
    document.body.appendChild(overlay);
    requestAnimationFrame(function() { overlay.classList.add('open'); });

    var serverSelect = dlg.querySelector('#ss-server-select');
    var playlistsContainer = dlg.querySelector('#ss-playlists-container');
    var importBtn = dlg.querySelector('#btn-import-playlists');
    var cancelBtn = dlg.querySelector('.cmd-dialog-btn--cancel');
    var selectedPlaylists = {};

    function close() {
      overlay.classList.remove('open');
      setTimeout(function() { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); }, 180);
    }
    cancelBtn.addEventListener('click', close);
    overlay.addEventListener('click', function(e) { if (e.target === overlay) close(); });

    serverSelect.addEventListener('change', function() {
      var serverId = parseInt(serverSelect.value);
      playlistsContainer.innerHTML = ''
        + '<div style="display: flex; align-items: center; justify-content: center; padding: 40px; color: var(--md-on-surface-variant);">'
        + '  <span class="material-symbols-rounded" style="margin-right: 8px; animation: spin 1s linear infinite;">sync</span>'
        + '  <span>' + App.i18n.t('playlist.fetchingPlaylists') + '</span>'
        + '</div>';
      App.utils.call('fetch_subsonic_playlists', serverId).then(function(res) {
        var data = JSON.parse(res);
        if (data.error) {
          playlistsContainer.innerHTML = ''
            + '<div style="display: flex; align-items: center; justify-content: center; padding: 40px; color: var(--md-error);">'
            + '  <span class="material-symbols-rounded" style="margin-right: 8px;">error</span>'
            + '  <span>' + App.utils.esc(data.error) + '</span>'
            + '</div>';
          return;
        }
        var fetchedPlaylists = data.playlists || [];
        selectedPlaylists = {};
        importBtn.disabled = true;
        if (fetchedPlaylists.length === 0) {
          playlistsContainer.innerHTML = ''
            + '<div style="display: flex; align-items: center; justify-content: center; padding: 40px; color: var(--md-on-surface-variant);">'
            + '  <span class="material-symbols-rounded" style="margin-right: 8px;">playlist_play</span>'
            + '  <span>' + App.i18n.t('playlist.noPlaylistsOnServer') + '</span>'
            + '</div>';
          return;
        }
        playlistsContainer.innerHTML = '<div class="playlist-select-list" style="padding: 8px;"></div>';
        var list = playlistsContainer.querySelector('.playlist-select-list');
        fetchedPlaylists.forEach(function(pl) {
          var label = document.createElement('label');
          label.className = 'playlist-select-item';
          label.style.cssText = 'display: flex; align-items: center; padding: 12px; cursor: pointer; border-radius: 8px; transition: background 120ms;';
          var checkbox = document.createElement('input');
          checkbox.type = 'checkbox';
          checkbox.style.cssText = 'margin-right: 12px; width: 18px; height: 18px;';
          var info = document.createElement('div');
          info.style.cssText = 'flex: 1; min-width: 0;';
          info.innerHTML = ''
            + '<div style="font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">' + App.utils.esc(pl.name) + '</div>'
            + '<div style="font-size: 12px; color: var(--md-on-surface-variant); margin-top: 2px;">'
            + App.i18n.t('albums.trackCountShort', { count: pl.song_count || 0 }) + ' · ' + (pl.owner || App.i18n.t('common.unknown')) + ' · ' + (pl.public ? App.i18n.t('playlist.public') : App.i18n.t('playlist.private'))
            + '</div>';
          label.appendChild(checkbox);
          label.appendChild(info);
          checkbox.addEventListener('change', function() {
            if (checkbox.checked) {
              selectedPlaylists[pl.id] = true;
              label.style.background = 'var(--md-state-hover)';
            } else {
              delete selectedPlaylists[pl.id];
              label.style.background = '';
            }
            var count = Object.keys(selectedPlaylists).length;
            importBtn.disabled = count === 0;
          });
          label.addEventListener('mouseover', function() { if (!checkbox.checked) label.style.background = 'var(--md-state-hover)'; });
          label.addEventListener('mouseout', function() { if (!checkbox.checked) label.style.background = ''; });
          list.appendChild(label);
        });
      }).catch(function(err) {
        playlistsContainer.innerHTML = ''
          + '<div style="display: flex; align-items: center; justify-content: center; padding: 40px; color: var(--md-error);">'
          + '  <span class="material-symbols-rounded" style="margin-right: 8px;">error</span>'
          + '  <span>' + App.utils.esc(String(err)) + '</span>'
          + '</div>';
      });
    });

    importBtn.addEventListener('click', function() {
      var serverId = parseInt(serverSelect.value);
      var playlistIds = Object.keys(selectedPlaylists);
      console.log('[import] selected playlist IDs:', playlistIds);
      importBtn.disabled = true;
      importBtn.textContent = App.i18n.t('playlist.importing');
      App.utils.call('import_subsonic_playlists', serverId, JSON.stringify(playlistIds)).then(function(res) {
        var data = JSON.parse(res);
        console.log('[import] result:', data);
        if (data.error) {
          App.utils.toast(App.i18n.t('playlist.importFailed', { error: data.error }));
          importBtn.disabled = false;
          importBtn.textContent = App.i18n.t('playlist.importSelected');
          return;
        }
        var errors = (data.results || []).filter(function(r) { return r.status === 'error'; });
        if (errors.length > 0) {
          App.utils.toast(App.i18n.t('playlist.importResultErrors', { imported: data.imported, skipped: data.skipped, errors: errors.length, firstError: errors[0].error }));
        } else {
          App.utils.toast(App.i18n.t('playlist.importResult', { imported: data.imported, skipped: data.skipped }));
        }
        close();
        if (App.playlists && App.playlists.refresh) App.playlists.refresh();
      }).catch(function(err) {
        App.utils.toast(App.i18n.t('playlist.importFailed', { error: String(err) }));
        importBtn.disabled = false;
        importBtn.textContent = App.i18n.t('playlist.importSelected');
      });
    });

    if (!document.getElementById('spin-style')) {
      var style = document.createElement('style');
      style.id = 'spin-style';
      style.textContent = '@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }';
      document.head.appendChild(style);
    }

    // 对话框打开时自动加载第一个服务器的歌单列表
    serverSelect.dispatchEvent(new Event('change'));
  }

  // 启动
  document.addEventListener('DOMContentLoaded', function () {
    _initAudioEngine();
    _initAutoMixAnalysis();
    // ── 启动渲染进程内存管理器 ──
    if (window.MemoryManager) {
      window.MemoryManager.start();
    }
    initBridge();
  });

})();
