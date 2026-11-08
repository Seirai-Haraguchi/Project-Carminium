(function () {
  'use strict';

  const App = window.App || {};
  window.App = App;

  App.state = {
    currentPage: 'your_mix',
    currentTrack: null,
    playbackState: 'stopped',
    shuffle: false,
    repeat: 'off',
    queue: [],
    currentQueueIndex: -1,
    allTracks: [],
    allAlbums: [],
    allArtists: [],
    allFolders: [],
    allSubsonicServers: [],
    allRemoteServers: [],
    likedArtists: [],
    likedAlbums: [],
    colorScheme: 'tonal_spot',
    colorSpec: '2021',
    monetSource: 'album_cover',
    isExclusive: false,
    tagEditorPath: '',
  };

  App.scrollMemory = (function () {
    var _memory = {};
    var _pendingPage = null;

    function _container() {
      return document.getElementById('content-pane');
    }

    function save(pageId) {
      if (!pageId) return;
      var c = _container();
      if (c) _memory[pageId] = c.scrollTop;
    }

    function restore(pageId) {
      var c = _container();
      if (!c) return;
      c.scrollTop = _memory[pageId] || 0;
    }

    function scheduleRestore(pageId) {
      _pendingPage = pageId;
      var c = _container();
      if (!c) return;
      var target = _memory[pageId] || 0;

      if (!target) {
        c.scrollTop = 0;
        _pendingPage = null;
        return;
      }

      var attempts = 0;
      var MAX = 40;
      function step() {
        if (_pendingPage !== pageId) return;
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

    function forget(pageId) { delete _memory[pageId]; }

    return { save: save, restore: restore, scheduleRestore: scheduleRestore, forget: forget };
  })();

  App.refreshLibraryCache = function () {
    return Promise.all([

      App.utils.call('get_library').then(function (raw) { return JSON.parse(raw); }),
      App.utils.call('get_albums').then(function (raw) { return JSON.parse(raw); }),
      App.utils.call('get_artists').then(function (raw) { return JSON.parse(raw); }),
      App.utils.call('get_folders').then(function (raw) { return JSON.parse(raw); }),
      App.utils.call('get_subsonic_servers').then(function (raw) { return JSON.parse(raw); }),
      App.utils.call('get_remote_servers').then(function (raw) { return JSON.parse(raw); }).catch(function () { return []; }),
      App.utils.call('get_liked_artists').then(function (raw) { return JSON.parse(raw); }).catch(function () { return []; }),
      App.utils.call('get_liked_albums').then(function (raw) { return JSON.parse(raw); }).catch(function () { return []; }),
    ]).then(function (results) {
      function replaceArrayInPlace(key, next) {
        var current = App.state[key];
        if (Array.isArray(current) && Array.isArray(next) && current !== next) {
          current.length = 0;
          for (var i = 0; i < next.length; i++) current.push(next[i]);

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

      if (results[5]) {
        replaceArrayInPlace('allRemoteServers', results[5]);

        var subsonicOnly = results[5].filter(function (s) { return s.type === 'subsonic'; });
        replaceArrayInPlace('allSubsonicServers', subsonicOnly);
      }
      if (results[6]) replaceArrayInPlace('likedArtists', results[6]);
      if (results[7]) replaceArrayInPlace('likedAlbums', results[7]);
      return App.state;
    });
  };

  // 喜爱艺人 / 专辑的本地判定（同步，供详情页按钮首帧就用正确状态）。
  // 后端事件把 App.state 刷新后这些判定自然跟着变。
  function _setLikedArray(key, next) {
    var cur = App.state[key];
    if (!Array.isArray(cur) || !Array.isArray(next)) { App.state[key] = next; return; }
    cur.length = 0;
    for (var i = 0; i < next.length; i++) cur.push(next[i]);
  }

  App.isArtistLiked = function (name) {
    var list = App.state.likedArtists || [];
    var n = String(name || '');
    for (var i = 0; i < list.length; i++) {
      if (list[i].name === n) return true;
    }
    return false;
  };

  App.isAlbumLiked = function (album, albumArtist) {
    var list = App.state.likedAlbums || [];
    var a = String(album || '');
    var ar = String(albumArtist || '');
    for (var i = 0; i < list.length; i++) {
      if (list[i].album === a && String(list[i].album_artist || '') === ar) return true;
    }
    return false;
  };

  App.prefetchArtistImages = function () {
    const list = (App.state && App.state.allArtists) || [];
    if (!list.length) return;
    const names = list.map(function (a) { return a && a.name; }).filter(Boolean);
    if (names.length && window.__electronAPI && window.__electronAPI.invoke) {
      window.__electronAPI.invoke('prefetch_artist_images', JSON.stringify(names)).catch(function () {  });
    }
  };

  App.prefetchArtistAliases = function () {
    const list = (App.state && App.state.allArtists) || [];
    if (!list.length) return;
    const names = list.map(function (a) { return a && a.name; }).filter(Boolean);
    if (names.length && window.__electronAPI && window.__electronAPI.invoke) {
      window.__electronAPI.invoke('prefetch_artist_aliases', JSON.stringify(names)).catch(function () {  });
    }
  };

  function initBridge() {
    if (!window.__waitForPywebview) {
      console.error('[app] bridge.js missing');
      _showFatalError('bridge.js 未加载');
      return;
    }

    window.__waitForPywebview(function () {

      window.pywebview.api.get_cover_base_url().then(function (url) {
        window.__coverBase = url || '';

        var uiSync = window.uiSync;

        uiSync.markHighFreq('position_changed');

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

        uiSync.on('playlists_changed', function (json) {
          try { App.state.allPlaylists = JSON.parse(json); } catch (e) {}
          if (App.playlists && App.playlists.refresh) {
            App.playlists.refresh();
          }

          if (App.state.currentPage === 'music' && App.pages.music && App.pages.music.onPlaylistsChanged) {
            App.pages.music.onPlaylistsChanged();
          }

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

        uiSync.on('liked_artists_changed', function (json) {
          var next;
          try { next = JSON.parse(json); } catch (e) { return; }
          _setLikedArray('likedArtists', next);
          if (App.state.currentPage === 'liked' && App.pages.liked && App.pages.liked.onLikedArtistsChanged) {
            App.pages.liked.onLikedArtistsChanged();
          }
          if (App.state.currentPage === 'artists' && App.pages.artists && App.pages.artists.onLikedArtistsChanged) {
            App.pages.artists.onLikedArtistsChanged();
          }
        });

        uiSync.on('liked_albums_changed', function (json) {
          var next;
          try { next = JSON.parse(json); } catch (e) { return; }
          _setLikedArray('likedAlbums', next);
          if (App.state.currentPage === 'liked' && App.pages.liked && App.pages.liked.onLikedAlbumsChanged) {
            App.pages.liked.onLikedAlbumsChanged();
          }
          if (App.state.currentPage === 'albums' && App.pages.albums && App.pages.albums.onLikedAlbumsChanged) {
            App.pages.albums.onLikedAlbumsChanged();
          }
        });

        uiSync.on('subsonic_servers_changed', function (json) {
          try { App.state.allSubsonicServers = JSON.parse(json); } catch (e) {}
          if (App.pages.folders && App.pages.folders.onSubsonicServersUpdated) {
            App.pages.folders.onSubsonicServersUpdated(json);
          }

          if (App.state.currentPage === 'music' && App.pages.music && App.pages.music.onServersChanged) {
            App.pages.music.onServersChanged();
          }
        });

        uiSync.on('remote_servers_changed', function (json) {
          try {
            var servers = JSON.parse(json);
            App.state.allRemoteServers = servers;

            App.state.allSubsonicServers = servers.filter(function (s) { return s.type === 'subsonic'; });
          } catch (e) {}
          if (App.pages.folders && App.pages.folders.onRemoteServersUpdated) {
            App.pages.folders.onRemoteServersUpdated(json);
          }
          if (App.state.currentPage === 'music' && App.pages.music && App.pages.music.onServersChanged) {
            App.pages.music.onServersChanged();
          }
        });

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

        window.__bridge.on('subsonic_sync_progress', function (json) {
          try {
            var data = JSON.parse(json);
            console.log('[subsonic] 同步进度:', data);
            if (App.pages.folders && App.pages.folders.onSubsonicSyncProgress) {
              App.pages.folders.onSubsonicSyncProgress(data);
            }
          } catch (e) {  }
        });

        App.backend.bpm_analyzed.connect(function () {

        });

        App.backend.playback_error.connect(function (errJson) {
          try {
            var err = JSON.parse(errJson);
            if (err.type === 'no_audio_device' && App.utils && App.utils.toast) {
              App.utils.toast(App.i18n ? App.i18n.t('audio.noDeviceToast') : err.message);
            }
          } catch (e) {  }
        });

        uiSync.on('library_updated', function (json) {

          if (App.pages.music && App.pages.music.releaseLibraryViewMemory) {
            App.pages.music.releaseLibraryViewMemory();
          }
          App.refreshLibraryCache().then(function () {
            App.prefetchArtistImages();
            App.prefetchArtistAliases();
            var _c = document.getElementById('page-container');
            if (App.state.currentPage === 'music') App.pages.music.render(_c);
            if (App.state.currentPage === 'your_mix' && App.pages.your_mix) App.pages.your_mix.render(_c);
            if (App.i18n && App.i18n.applyToDOM) App.i18n.applyToDOM(_c);
            if (App.pages.folders.onFoldersUpdated) App.pages.folders.onFoldersUpdated(null);
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

        // 扫描状态（来自工作线程）：只记录状态，数据由 get_library 等按需拉取
        uiSync.on('library_scan_status', function (json) {
          try {
            var s = typeof json === 'string' ? JSON.parse(json) : json;
            App.state.libraryScanStatus = s || null;
            if (s && s.phase) {
              console.log('[library] scan', s.phase, s.folder || '',
                s.phase === 'scanning' ? (s.scanned + '/' + s.total) : '');
            }
            if (App.pages.folders.onScanStatus) App.pages.folders.onScanStatus(s);
          } catch (e) {  }
        });

        uiSync.on('settings_changed', function (sjson) {
          try {
            var s = JSON.parse(sjson);

            if (s.wasapi_exclusive !== undefined) {
              App.state.isExclusive = !!s.wasapi_exclusive;
            }
            if (App.nowPlaying && App.nowPlaying.updateAudioMode) {
              App.nowPlaying.updateAudioMode(!!s.wasapi_exclusive);
            }

            if (s.ui_font !== undefined) {
              _applyUiFont(s.ui_font || '');
            }

            if (s.ui_jp_font !== undefined || s.lyrics_jp_font !== undefined) {
              if (App.utils && App.utils.applyJpUiFont) {
                App.utils.applyJpUiFont(!!s.ui_jp_font, s.lyrics_jp_font || '');
              }
            }

            if (s.mini_player_lyrics !== undefined && App.nowPlaying &&
                App.nowPlaying.refreshMiniLyrics) {
              App.nowPlaying.refreshMiniLyrics(s.mini_player_lyrics !== false);
            }

            if (s.np_background_mode !== undefined && App.nowPlaying &&
                App.nowPlaying.refreshBackgroundMode) {
              App.nowPlaying.refreshBackgroundMode(s.np_background_mode);
            }

            if (s.language !== undefined && App.i18n && App.i18n.getLang() !== s.language) {
              App.i18n.init(s.language);
            }

            if (s.color_spec !== undefined) {
              App.state.colorSpec = s.color_spec || '2021';
              if (App.state.currentDominantRgb) {
                App.utils.applyDynamicTheme(App.state.currentDominantRgb, App.state.colorScheme);
              }
            }

            if (s.monet_source !== undefined) {
              App.state.monetSource = s.monet_source;

              if (s.monet_source === 'system_wallpaper') {
                _refreshMonetFromSystem();
              } else if (App.state.currentDominantRgb) {

                App.utils.applyDynamicTheme(App.state.currentDominantRgb, App.state.colorScheme);
              }
            }

            if (s.gamepad_button_layout !== undefined && App.gamepad && App.gamepad.setButtonLayout) {
              App.gamepad.setButtonLayout(s.gamepad_button_layout);
            }

            if (s.np_default_view !== undefined && App.nowPlaying) {
              App.nowPlaying.setDefaultView(s.np_default_view);
            }

            if (s.show_quality !== undefined && App.nowPlaying && App.nowPlaying.setQualityEnabled) {
              App.nowPlaying.setQualityEnabled(!!s.show_quality);
            }

            if (s.tag_editor_path !== undefined) {
              App.state.tagEditorPath = s.tag_editor_path || '';
            }

            if (s.np_secondary_actions !== undefined && App.nowPlaying && App.nowPlaying.renderSecondaryActions) {
              App.nowPlaying.renderSecondaryActions(s.np_secondary_actions);
            }

            if (s.volume_normalization !== undefined || s.volume_normalization_target !== undefined) {
              if (_audioEngine) {
                if (s.volume_normalization !== undefined) {
                  _audioEngine.setNormalizationEnabled(!!s.volume_normalization);
                }
                if (s.volume_normalization_target !== undefined) {
                  _audioEngine.setNormalizationTarget(s.volume_normalization_target);
                }
              }

              if (s.volume_normalization && _currentPlaybackFile &&
                  _audioEngine && !_audioEngine._trackLoudness) {
                _applyTrackLoudness(_currentPlaybackFile, _currentPlaybackTrackId);
              }
            }
          } catch (e) {  }
        });

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
        _wireSignal('liked_artists_changed');
        _wireSignal('liked_albums_changed');
        _wireSignal('subsonic_servers_changed');
        _wireSignal('remote_servers_changed');
        _wireSignal('library_updated');
        _wireSignal('folders_updated');
        _wireSignal('library_scan_status');
        _wireSignal('settings_changed');

        if (window.__bridge && window.__bridge.on) {
          window.__bridge.on('loudness_ready', _onLoudnessReady);
          window.__bridge.on('quality_ready', _onQualityReady);
        }

        App.nowPlaying.init();

        _initTheme();
        _loadShortcuts();

        if (App.playlists && App.playlists.refresh) {
          App.playlists.refresh();
        }

        App.refreshLibraryCache().then(function () {
          App.prefetchArtistImages();
          App.prefetchArtistAliases();
          return _fetchInitialState();
        }).then(function () {

          App.utils.call('get_settings').then(function (res) {
            var settings = null;
            try { settings = JSON.parse(res); } catch (e) {  }
            if (App.onboarding && App.onboarding.checkAndStart && settings && App.onboarding.checkAndStart(settings)) {
              return;
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

  var _playerStateReady = false;

  function _fetchInitialState() {
    return App.utils.call('get_player_state').then(function(res) {
      const state = JSON.parse(res);
      App.state.currentTrack = state.current_track;
      App.state.playbackState = state.state || 'stopped';
      App.state.shuffle = state.shuffle;
      App.state.repeat = state.repeat;

      App.state.isExclusive = !!state.wasapi_exclusive;

      App.nowPlaying.updateTrack(App.state.currentTrack);
      App.nowPlaying.updateVolume(state.volume);
      App.nowPlaying.updateModes(state.shuffle, state.repeat);
      App.nowPlaying.updateState(App.state.playbackState);

      App.nowPlaying.updateDuration(state.duration);
      App.nowPlaying.updatePosition(state.position);

      return App.utils.call('is_current_liked').then(function(liked) {
        App.state.currentLiked = liked;
        App.nowPlaying.updateLiked(liked);

        return App.utils.call('get_queue').then(function (qres) {
          const qstate = JSON.parse(qres);
          App.state.queue = qstate.queue || [];
          App.state.currentQueueIndex = qstate.current_index;
          App.nowPlaying.updateQueue(App.state.queue, App.state.currentQueueIndex);
          _playerStateReady = true;
        });
      });
    });
  }

  var _resyncToken = 0;
  var _lastResyncAt = 0;

  /**
   * 回到前台时的权威状态对齐。
   *
   * 窗口在后台时 rAF 被挂起、定时器被节流，曲目可能已经自动推进了好几首，
   * 界面却还停在离开时那一首（甚至被更晚到达的旧事件盖回去）。这里直接向
   * 主进程要一次快照，把播放器状态与界面强制对齐，顺便收回可能卡住的过渡蒙层。
   */
  function _resyncPlaybackState() {
    if (!App.utils || typeof App.utils.call !== 'function') return;
    if (!window.__bridgeReady || !_playerStateReady) return;

    // blur/focus 与 visibilitychange 会几乎同时触发，合并成一次请求。
    var now = Date.now();
    if (now - _lastResyncAt < 500) return;
    _lastResyncAt = now;

    var token = ++_resyncToken;

    App.utils.call('get_player_state').then(function (res) {
      if (token !== _resyncToken) return;
      var state;
      try { state = JSON.parse(res); } catch (e) { return; }
      if (!state) return;

      var track = state.current_track || null;
      var prev = App.state.currentTrack;
      var prevState = App.state.playbackState;
      var changed = (track && track.id) !== (prev && prev.id);

      _cancelPendingTrackApply();

      App.state.currentTrack = track;
      App.state.playbackState = state.state || 'stopped';
      App.state.shuffle = !!state.shuffle;
      App.state.repeat = state.repeat || 'off';

      // 过渡蒙层是成对的（start 藏 / complete 收），后台收不到 complete 就会卡住。
      if (App.nowPlaying.showTransition) App.nowPlaying.showTransition(false);
      if (App.nowPlaying.setTrackInfoHidden) App.nowPlaying.setTrackInfoHidden(false);

      // 只在界面确实显示着另一首时才重绘：updateTrack 会重建歌词 DOM，
      // 每次切回前台都重绘会把当前歌词行和滚动位置打回开头。
      var targetId = track ? track.id : null;
      var displayedId = App.nowPlaying._lastTrackId;
      var pendingId = App.nowPlaying.pendingTrackId ? App.nowPlaying.pendingTrackId() : null;
      if (targetId !== displayedId && targetId !== pendingId) {
        App.nowPlaying.updateTrack(track);
      }
      App.nowPlaying.updateModes(App.state.shuffle, App.state.repeat);
      if (App.state.playbackState !== prevState) {
        App.nowPlaying.updateState(App.state.playbackState);
      }
      if (state.duration > 0) App.nowPlaying.updateDuration(state.duration);

      // 播放中的位置由渲染侧每 100ms 上报，主进程那份在后台是滞后的，
      // 别用它把刚恢复的进度往回拽。
      if (App.state.playbackState !== 'playing' && App.state.playbackState !== 'loading') {
        App.nowPlaying.updatePosition(state.position || 0);
      }

      if (changed) {
        _syncAutoMixCurrent(track);
        _updateListPlayState();
        App.utils.call('is_current_liked').then(function (liked) {
          if (token !== _resyncToken) return;
          App.state.currentLiked = liked;
          App.nowPlaying.updateLiked(liked);
        }).catch(function () {});
      }

      return App.utils.call('get_queue').then(function (qres) {
        if (token !== _resyncToken) return;
        var qstate;
        try { qstate = JSON.parse(qres); } catch (e) { return; }
        App.state.queue = qstate.queue || [];
        App.state.currentQueueIndex = qstate.current_index;
        App.nowPlaying.updateQueue(App.state.queue, App.state.currentQueueIndex);
      });
    }).catch(function (e) {
      console.warn('[app] 回前台状态对齐失败:', e);
    });
  }

  window.__onAppForeground = _resyncPlaybackState;

  function _applyUiFont(val) {
    var root = document.documentElement;
    if (val && val.trim()) {
      root.style.setProperty('--ui-font', val.trim());
    } else {
      root.style.removeProperty('--ui-font');
    }
  }

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
      } catch (e) {  }
    }
    notify();
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

      App.state.colorScheme = settings.color_scheme || 'tonal_spot';
      App.state.colorSpec = settings.color_spec || '2021';
      if (App.state.currentDominantRgb) {
        App.utils.applyDynamicTheme(App.state.currentDominantRgb, App.state.colorScheme);
      }

      App.state.monetSource = settings.monet_source || 'album_cover';
      if (App.state.monetSource === 'system_wallpaper') {
        _refreshMonetFromSystem();
      }

      _applyUiFont(settings.ui_font || '');
      if (App.utils && App.utils.applyJpUiFont) {
        App.utils.applyJpUiFont(!!settings.ui_jp_font, settings.lyrics_jp_font || '');
      }

      if (App.i18n && settings.language) {
        App.i18n.init(settings.language);
      }

      App.state.isExclusive = !!settings.wasapi_exclusive;

      if (App.nowPlaying && App.nowPlaying.updateAudioMode) {
        App.nowPlaying.updateAudioMode(!!settings.wasapi_exclusive);
      }

      if (App.nowPlaying && App.nowPlaying.renderSecondaryActions &&
          settings.np_secondary_actions !== undefined) {
        App.nowPlaying.renderSecondaryActions(settings.np_secondary_actions);
      }

      App.state.tagEditorPath = settings.tag_editor_path || '';
    });

    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', e => {
      App.utils.call('get_settings').then(function (res) {
        if (JSON.parse(res).theme === 'system') {
          document.documentElement.setAttribute('data-theme', e.matches ? 'dark' : 'light');
          if (App.state.currentDominantRgb) App.utils.applyDynamicTheme(App.state.currentDominantRgb);
        }
      });
    });

    _watchThemeForIconSync();
  }

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
    var fallback = [103, 80, 164];
    App.state.currentDominantRgb = fallback;
    App.utils.applyDynamicTheme(fallback, App.state.colorScheme);
  }

  // 过渡态隐藏的兜底时长：引擎没发 complete（中止）时，超过这个时间必须自行恢复
  function _crossfadeGuardMs() {
    var ms = 0;
    try {
      if (_audioEngine && _audioEngine._getEffectiveCrossfadeMs) {
        ms = _audioEngine._getEffectiveCrossfadeMs() || 0;
      }
    } catch (e) { ms = 0; }
    return Math.max(2000, ms + 2500);
  }

  var _pendingTrackApply = null;
  var _pendingTrackApplyRaf = 0;

  function _cancelPendingTrackApply() {
    if (_pendingTrackApplyRaf) {
      cancelAnimationFrame(_pendingTrackApplyRaf);
      _pendingTrackApplyRaf = 0;
    }
    _pendingTrackApply = null;
  }

  function _flushPendingTrackApply() {
    if (_pendingTrackApplyRaf) {
      cancelAnimationFrame(_pendingTrackApplyRaf);
      _pendingTrackApplyRaf = 0;
    }
    var track = _pendingTrackApply;
    _pendingTrackApply = null;
    if (!track) return;
    App.nowPlaying.updateTrack(track);
    _updateListPlayState();
  }

  // 交叉淡化/无缝推进后的重绘推迟到下一帧，避免和过渡动画抢同一帧。
  // 但后台没有帧：以前这里直接 rAF，回调会一直挂到回前台才跑，用的还是
  // 挂起那一刻的旧曲目，正好把已经生效的新曲目盖回去。所以只保留最新一首，
  // 后台（无帧）则直接同步落。
  function _applyTrackSoon(track) {
    _pendingTrackApply = track;
    if (document.hidden || window.__appFrozen) {
      _flushPendingTrackApply();
      return;
    }
    if (_pendingTrackApplyRaf) return;
    _pendingTrackApplyRaf = requestAnimationFrame(_flushPendingTrackApply);
  }

  function _onTrackChanged(trackJson) {
    const track = JSON.parse(trackJson);
    App.state.currentTrack = track;

    // 🔴 必须在 gapless/crossfade 的提前 return 之前：自动推进也只有这一条通知。
    _syncAutoMixCurrent(track);

    App.nowPlaying.clearTransitionPoint();

    if (window.MemoryManager) {
      window.MemoryManager.fireTrackChangeCleanup();
    }

    if (_gaplessSwitchPending || _crossfadeSwitchPending) {
      _gaplessSwitchPending = false;
      _crossfadeSwitchPending = false;
      _skipNextTrackGlitch = false;
      _applyTrackSoon(track);
      return;
    }

    _cancelPendingTrackApply();
    App.nowPlaying.updateTrack(track);

    if (_skipNextTrackGlitch) {
      _skipNextTrackGlitch = false;
    } else if (_audioEngine && _audioEngine._isPlaying && !document.hidden && !window.__appFrozen) {
      // 后台看不见这层「mystery」过渡，而且它的收回计时器在后台会被节流到
      // 很晚，回来时界面可能还是空的。后台直接跳过这段动画。
      App.nowPlaying.setTrackInfoHidden(true, { guardMs: 1600 });
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
    if (App.state.currentPage === 'search' && App.pages.search.updatePlayState) {
      App.pages.search.updatePlayState();
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

  function _onLyricsChanged(json) {
    var data;
    try { data = JSON.parse(json); } catch (e) {
      console.error('[app] lyrics_changed parse error:', e);
      return;
    }
    if (!data || !data.trackId) return;

    if (!App.state.currentTrack || App.state.currentTrack.id !== data.trackId) return;
    App.state.currentTrack.lyrics = data.lyrics;
    if (App.nowPlaying.updateLyrics) {
      App.nowPlaying.updateLyrics(data.trackId, data.lyrics);
    }
  }

  App.navHistory = [];
  App.navHistorySuppress = false;

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

    if (!App.navHistorySuppress) {
      App.navHistory.push(pageId);
      if (App.navHistory.length > 20) App.navHistory.shift();
    }

    if (App.selection) App.selection.clear();

    if (pageId === 'settings') {
      document.body.classList.add('settings-active');
    } else {
      document.body.classList.remove('settings-active');
    }

    if (window.MemoryManager) {
      window.MemoryManager.fireNavigationCleanup();
    }

    const container = document.getElementById('page-container');

    App.scrollMemory.save(App.state.currentPage);

    const oldPage = document.querySelector('.nav-item.active');
    if (oldPage) oldPage.classList.remove('active');

    const newPage = document.querySelector(`.nav-item[data-page="${pageId}"]`);
    if (newPage) newPage.classList.add('active');

    App.state.currentPage = pageId;
    App.state.currentPageParams = params;

    const useInternalTransition = pageId === 'about';
    container.classList.remove('page-enter');

    setTimeout(() => {
      if (App.pages[pageId] && App.pages[pageId].render) {
        App.pages[pageId].render(container, params);

        if (App.i18n && App.i18n.applyToDOM) App.i18n.applyToDOM(container);

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

    if (App.titlebar && App.titlebar.updateBackButton) App.titlebar.updateBackButton();
  }

  App.navigate = navigate;

  if (App.i18n && App.i18n.onChange) {
    App.i18n.onChange(function () {

      var page = App.state.currentPage;
      var container = document.getElementById('page-container');
      if (page && App.pages[page] && App.pages[page].render && container) {

        App.scrollMemory.save(page);
        App.pages[page].render(container, App.state.currentPageParams || undefined);

        if (App.i18n && App.i18n.applyToDOM) App.i18n.applyToDOM(container);
        App.scrollMemory.scheduleRestore(page);
      }

      if (App.nowPlaying && App.nowPlaying.onLanguageChanged) {
        App.nowPlaying.onLanguageChanged();
      }
    });
  }

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

  let _pressedKeys = new Set();
  let _lastKeyDownTime = 0;
  const KEY_COMBO_TIMEOUT = 500;

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

    const mediaKeys = ['MediaTrackNext', 'MediaTrackPrevious', 'MediaPlayPause', 'MediaStop', 'VolumeUp', 'VolumeDown', 'VolumeMute'];
    if (mediaKeys.includes(key)) {

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

    if (_pressedKeys.has('Control') || _pressedKeys.has('Ctrl')) parts.push('Ctrl');
    if (_pressedKeys.has('Alt')) parts.push('Alt');
    if (_pressedKeys.has('Shift')) parts.push('Shift');
    if (_pressedKeys.has('Meta')) parts.push('Meta');

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

    const tag = e.target.tagName;
    const isEditable = tag === 'INPUT' || tag === 'TEXTAREA' || e.target.isContentEditable;
    if (isEditable) return;

    const now = Date.now();

    if (now - _lastKeyDownTime > KEY_COMBO_TIMEOUT) {
      _pressedKeys.clear();
    }
    _lastKeyDownTime = now;

    let keyName = e.key;
    if (keyName === 'Control') keyName = 'Ctrl';
    if (keyName.length === 1) keyName = keyName.toLowerCase();
    if (keyName === ' ') keyName = 'Space';

    _pressedKeys.add(keyName);

    if (e.ctrlKey) _pressedKeys.add('Ctrl');
    if (e.altKey) _pressedKeys.add('Alt');
    if (e.shiftKey) _pressedKeys.add('Shift');
    if (e.metaKey) _pressedKeys.add('Meta');

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

  document.querySelectorAll('.nav-item').forEach(el => {
    el.addEventListener('click', function () {
      const pageId = this.dataset.page;
      if (pageId) {
        navigate(pageId);
      }
    });
  });

  const titleBarSettings = document.getElementById('title-bar-settings');
  if (titleBarSettings) {
    titleBarSettings.addEventListener('click', function () {
      navigate('settings');
    });
  }

  const playlistsNavBtn = document.getElementById('nav-playlists');
  const playlistsSubmenu = document.getElementById('nav-playlists-submenu');
  const playlistsListEl = document.getElementById('nav-playlists-list');
  const playlistAddBtn = document.getElementById('nav-playlist-add');
  const playlistImportBtn = document.getElementById('nav-playlist-import');

  function _positionPlaylistsSubmenu() {
    if (!playlistsNavBtn || !playlistsSubmenu) return;
    const rect = playlistsNavBtn.getBoundingClientRect();

    const navDrawer = document.getElementById('nav-drawer');
    const navRect = navDrawer ? navDrawer.getBoundingClientRect() : { right: 80 };
    const submenuWidth = playlistsSubmenu.offsetWidth || 320;
    const viewportWidth = window.innerWidth;
    let left = navRect.right + 4;

    if (left + submenuWidth > viewportWidth - 8) {
      left = Math.max(8, viewportWidth - submenuWidth - 8);
    }
    playlistsSubmenu.style.left = left + 'px';

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

    playlistsListEl.innerHTML = '';
    var t = App.i18n ? App.i18n.t.bind(App.i18n) : function (k) { return k; };
    var all = playlists || [];

    function _groupTitle(label) {
      var el = document.createElement('div');
      el.className = 'nav-submenu-group-title';
      var name = document.createElement('span');
      name.className = 'nav-submenu-group-label';
      name.textContent = label;
      el.appendChild(name);
      return el;
    }

    function _groupList() {
      var el = document.createElement('div');
      el.className = 'md-seglist nav-submenu-group-list';
      return el;
    }

    // 一组 = 小标题 + 一个分段列表；组之间不画分隔线（靠小标题分段）
    function _appendGroup(label, build) {
      playlistsListEl.appendChild(_groupTitle(label));
      var list = _groupList();
      build(list);
      playlistsListEl.appendChild(list);
    }

    function _emptyItem() {
      var el = document.createElement('div');
      el.className = 'nav-submenu-empty';
      el.innerHTML = '<span class="material-symbols-rounded">queue_music</span><p>' +
        App.utils.esc(t('empty.noPlaylists')) + '</p>';
      return el;
    }

    function _playlistItem(pl, isRemote) {
      var item = document.createElement('button');
      item.type = 'button';
      item.className = 'nav-submenu-item';

      var iconHtml;
      if (isRemote && pl.cover_art_id && pl.server_id && window.__coverBase) {
        iconHtml = '<img class="nav-submenu-item-cover" src="' + window.__coverBase + '/subsonic/cover/' +
          pl.server_id + '/' + encodeURIComponent(pl.cover_art_id) + '" alt="" loading="lazy"' +
          ' onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'inline-flex\'">' +
          '<span class="material-symbols-rounded nav-submenu-item-icon" style="display:none">cloud</span>';
      } else {
        iconHtml = '<span class="material-symbols-rounded nav-submenu-item-icon">' +
          (isRemote ? 'cloud' : 'playlist_play') + '</span>';
      }

      item.innerHTML = iconHtml +
        '<span class="nav-submenu-item-name">' + App.utils.esc(pl.name) + '</span>' +
        '<span class="nav-submenu-item-count">' + (pl.track_count || 0) + '</span>';

      item.addEventListener('click', function () {
        _closePlaylistsSubmenu();
        navigate('playlists', { playlist_id: pl.id, playlist_name: pl.name, source: pl.source, server_id: pl.server_id, remote_id: pl.remote_id, server_name: pl.server_name, cover_art_id: pl.cover_art_id, owner: pl.owner, owner_email: pl.owner_email });
      });

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
            } catch (e) {  }
          });
        } catch (err) {
          console.warn('[playlists] drop parse error:', err);
        }
      });

      return item;
    }

    // ① 探新 / 每日合集：独立成卡，不挂在任何分类标题下
    (function () {
      var featureList = _groupList();
      var feature = document.createElement('button');
      feature.type = 'button';
      feature.className = 'nav-submenu-feature';
      feature.innerHTML =
        '<span class="nav-submenu-feature-icon material-symbols-rounded">auto_awesome</span>' +
        '<span class="nav-submenu-feature-body">' +
          '<span class="nav-submenu-feature-title">' + App.utils.esc(t('yourMix.title')) + '</span>' +
          '<span class="nav-submenu-feature-sub">' + App.utils.esc(t('yourMix.featured')) + '</span>' +
        '</span>' +
        '<span class="material-symbols-rounded nav-submenu-feature-chevron">chevron_right</span>';
      feature.addEventListener('click', function () {
        _closePlaylistsSubmenu();
        navigate('your_mix');
      });
      featureList.appendChild(feature);
      playlistsListEl.appendChild(featureList);
    })();

    // ② 本地歌单 / ③ 各远程服务器的歌单
    var locals = [];
    var remotesByServer = new Map();
    all.forEach(function (pl) {
      if (pl.source === 'subsonic') {
        var key = pl.server_id || pl.server_name || 'remote';
        if (!remotesByServer.has(key)) {
          remotesByServer.set(key, { name: pl.server_name || t('playlist.remote'), items: [] });
        }
        remotesByServer.get(key).items.push(pl);
      } else {
        locals.push(pl);
      }
    });

    _appendGroup(t('nav.localPlaylists'), function (list) {
      if (locals.length === 0) {
        list.appendChild(_emptyItem());
        return;
      }
      locals.forEach(function (pl) { list.appendChild(_playlistItem(pl, false)); });
    });

    remotesByServer.forEach(function (group) {
      _appendGroup(group.name, function (list) {
        group.items.forEach(function (pl) { list.appendChild(_playlistItem(pl, true)); });
      });
    });
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

  if (playlistImportBtn) {
    playlistImportBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      _promptImportSubsonicPlaylists();
    });
  }

  function _promptCreatePlaylist() {

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

  document.addEventListener('click', function (e) {
    if (!_isPlaylistsSubmenuOpen()) return;
    if (playlistsSubmenu && playlistsSubmenu.contains(e.target)) return;
    if (playlistsNavBtn && playlistsNavBtn.contains(e.target)) return;
    _closePlaylistsSubmenu();
  });

  window.addEventListener('resize', function () {
    if (_isPlaylistsSubmenuOpen()) _positionPlaylistsSubmenu();
  });

  let _resizingTimer = null;
  window.addEventListener('resize', function () {
    document.body.classList.add('is-resizing');
    if (_resizingTimer) clearTimeout(_resizingTimer);
    _resizingTimer = setTimeout(function () {
      document.body.classList.remove('is-resizing');
    }, 120);
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && _isPlaylistsSubmenuOpen()) {
      _closePlaylistsSubmenu();
    }
  });

  var _audioEngine = null;

  Object.defineProperty(App, 'audioEngine', {
    get: function () { return _audioEngine; }
  });

  var _skipNextTrackGlitch = false;
  var _gaplessSwitchPending = false;
  var _crossfadeSwitchPending = false;

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

    _audioEngine.setNullSink(!!App.state.isExclusive);

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

      if (window.__electronAPI && window.__electronAPI.sendAudioCrossfadeStart) {
        window.__electronAPI.sendAudioCrossfadeStart();
      }
      App.nowPlaying.showTransition(true);
      App.nowPlaying.setTrackInfoHidden(true, { guardMs: _crossfadeGuardMs() });
    };
    // 过渡被中止（seek / stop / next 被丢弃）时引擎不会再发 complete，
    // 这里必须把“过渡态隐藏”收回来，否则歌词/封面会永久停在蒙层里。
    _audioEngine.onCrossfadeCancel = function () {
      App.nowPlaying.showTransition(false);
      App.nowPlaying.setTrackInfoHidden(false);
    };
    _audioEngine.onCrossfadeComplete = function (positionMs) {
      _skipNextTrackGlitch = true;

      App.nowPlaying.clearTransitionPoint();
      App.nowPlaying.setTrackInfoHidden(false);

      _crossfadeSwitchPending = true;
      window.__electronAPI.sendAudioCrossfadeComplete(positionMs);

      setTimeout(function () { _crossfadeSwitchPending = false; }, 2000);
    };
    _audioEngine.onStreamEnded = function () {

      window.__electronAPI.sendAudioEnded();
    };
    _audioEngine.onGaplessSwitch = function () {

      _skipNextTrackGlitch = true;
      _gaplessSwitchPending = true;
      window.__electronAPI.sendAudioGaplessSwitch();

      setTimeout(function () { _gaplessSwitchPending = false; }, 2000);
    };

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

    window.__electronAPI.onAudioLatency(function (ms) {
      if (_audioEngine) _audioEngine.setDllBufferLatency(ms);
    });

    window.__setDllBufferLatency = function (ms) {
      if (_audioEngine) _audioEngine.setDllBufferLatency(ms);
    };

    window.__handleAudioControl = function (json) {
      try {
        var cmd = typeof json === 'string' ? JSON.parse(json) : json;
        switch (cmd.action) {
          case 'release_context':

            return _audioEngine.releaseContext();
          case 'set_output_sink':

            _audioEngine.setNullSink(!!cmd.nullSink);
            break;
          case 'init':

            if (typeof cmd.nullSink === 'boolean') _audioEngine.setNullSink(cmd.nullSink);
            return (cmd.rebuild
              ? _audioEngine.recreateContext()
              : _audioEngine.init(cmd.sampleRate, cmd.channels)
            ).then(function (info) {
              console.log('[app] AudioEngine initialized:', info);

              _syncAudioEffects();
            }).catch(function (e) {
              console.error('[app] AudioEngine init failed:', e);
            });
          case 'play':

            _audioEngine.playCurrent(cmd.filePath, cmd.durationMs, cmd.seekOffsetMs, cmd.paused);

            _applyTrackLoudness(cmd.filePath, cmd.trackId);

            if (_audioEngine._crossfadeEnabled) {
              _analyzeCurrentTrack(cmd);
            }
            break;
          case 'play_streaming':

            _audioEngine.playStreaming(cmd.durationMs, cmd.seekOffsetMs, cmd.paused);

            _applyTrackLoudness(cmd.filePath, cmd.trackId);

            if (_audioEngine._crossfadeEnabled) {
              _analyzeCurrentTrack(cmd);
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
          case 'set_crossfade':
            _audioEngine.setCrossfadeEnabled(cmd.enabled);

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

            _audioEngine.setNextInfo(cmd.filePath, cmd.durationMs,
              cmd.forceStreaming, cmd.nextStartOffsetMs);

            _prefetchTrackLoudness(cmd.filePath, cmd.trackId);

            if (_audioEngine._crossfadeEnabled) {
              _analyzeNextTrack(cmd);
            }
            break;
          case 'set_transition_plan':

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

    var ea = window.__electronAPI;
    if (ea && ea.invoke) {
      ea.invoke('get_automix').then(function (enabled) {
        _audioEngine.setCrossfadeEnabled(!!enabled);
        console.log('[app] Synced AutoMix:', enabled);
      }).catch(function (e) { console.warn('[app] get_automix failed:', e); });
      ea.invoke('get_radical_transitions').then(function (enabled) {
        _audioEngine.setRadicalTransitionsEnabled(!!enabled);
      }).catch(function (e) { console.warn('[app] get_radical_transitions failed:', e); });
      ea.invoke('get_crossfade_duration').then(function (ms) {
        _audioEngine.setCrossfadeDuration(parseInt(ms, 10) || 4000);
        console.log('[app] Synced crossfade duration:', ms);
      }).catch(function (e) { console.warn('[app] get_crossfade_duration failed:', e); });
    }

    window.__audioEngine = _audioEngine;

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

    if (ea && ea.invoke) {
      ea.invoke('get_settings').then(function (res) {
        if (_audioEngine) _audioEngine._settingsCache = JSON.parse(res);
      }).catch(function () {});
    }

    if (ea && ea.invoke) {
      ea.invoke('renderer_ready', true).catch(function (e) {
        console.warn('[app] renderer_ready failed:', e);
      });
    }
  }

  var _currentPlaybackFile = '';
  var _currentPlaybackTrackId = '';
  var _loudnessToken = 0;

  function _applyTrackLoudness(filePath, trackId) {
    if (!_audioEngine) return;
    var token = ++_loudnessToken;
    _currentPlaybackFile = filePath || '';
    _currentPlaybackTrackId = trackId || '';

    _audioEngine.setTrackLoudness(null);

    if (!filePath) return;

    if (!_audioEngine._normEnabled) return;
    var ea = window.__electronAPI;
    if (!ea || !ea.invoke) return;

    ea.invoke('get_track_loudness', trackId || '', filePath).then(function (res) {
      if (token !== _loudnessToken) return;
      if (!res || res.pending || res.unsupported) return;
      if (typeof res.integratedLufs !== 'number') return;
      _audioEngine.setTrackLoudness(res);
    }).catch(function () {  });
  }

  function _prefetchTrackLoudness(filePath, trackId) {
    if (!_audioEngine || !_audioEngine._normEnabled || !filePath) return;
    var ea = window.__electronAPI;
    if (!ea || !ea.invoke) return;
    ea.invoke('get_track_loudness', trackId || '', filePath).catch(function () {});
  }

  function _onLoudnessReady(payload) {
    if (!_audioEngine || !payload) return;
    if (!_currentPlaybackFile) return;
    if (payload.filePath !== _currentPlaybackFile) return;
    if (typeof payload.integratedLufs !== 'number') return;
    _audioEngine.setTrackLoudness(payload);
  }

  function _onQualityReady(payload) {
    if (!payload || !App.nowPlaying || !App.nowPlaying.onQualityReady) return;
    App.nowPlaying.onQualityReady(payload);
  }

  /* ================= AutoMix 分析/规划 ================= */

  var _planner = null;
  var _profileClient = null;
  var _currentProfile = null;
  var _nextProfile = null;
  var _currentProfileId = '';
  var _nextProfileId = '';
  var _lastPlan = null;
  var _currentProfileToken = 0;
  var _nextProfileToken = 0;
  // 队列元数据：判断「同专辑、按原顺序」只靠档案里的音频特征不够，
  // 必须先知道这两首在专辑里的位置。
  var _currentTrackMeta = null;
  var _nextTrackMeta = null;

  function _initAutoMixAnalysis() {
    _planner = window.AutoMixPlanner || null;
    _profileClient = (window.App && window.App.profileClient) || null;
    if (!_planner) console.error('[app] AutoMixPlanner 未加载');
    console.log('[app] AutoMix initialized',
      'planner=' + !!_planner,
      'profileClient=' + !!_profileClient);
  }

  /** 把 audio_control 的载荷包成 profile 客户端需要的 track 形状 */
  function _profileTrack(cmd) {
    return {
      id: cmd.trackId || '',
      title: cmd.title || '',
      artist: cmd.artist || '',
      album: cmd.album || '',
      albumArtist: cmd.albumArtist || '',
      trackNumber: cmd.trackNumber || 0,
      discNumber: cmd.discNumber || 0,
      duration_ms: cmd.durationMs || 0,
      filePath: cmd.filePath || '',
      path: cmd.filePath || '',
      file_size: cmd.fileSize || 0,
      suffix: cmd.suffix || '',
      source: cmd.source || 'local',
    };
  }

  function _trackMetaOf(track) {
    return {
      album: String(track.album || '').trim(),
      albumArtist: String(track.albumArtist || '').trim(),
      trackNumber: Number(track.trackNumber) || 0,
      discNumber: Number(track.discNumber) || 0,
    };
  }

  /** 队列里的 track（library.db 行，snake_case）→ profile 客户端期望的形状 */
  function _profileTrackFromQueue(track) {
    var path = track.path || track.filePath || '';
    return {
      id: track.id || '',
      title: track.title || '',
      artist: track.artist || track.album_artist || '',
      album: track.album || '',
      albumArtist: track.album_artist || '',
      trackNumber: track.track_number || 0,
      discNumber: track.disc_number || 0,
      duration_ms: track.duration_ms || 0,
      filePath: path,
      path: path,
      file_size: track.file_size || 0,
      suffix: track.suffix || '',
      source: track.source || 'local',
    };
  }

  /** 同专辑、同碟（或紧邻下一碟）、轨号紧接：才考虑「保留原文件过渡」。 */
  function _isAlbumSequence(cur, next) {
    return !!(_planner && _planner.isAlbumSequence && _planner.isAlbumSequence(cur, next));
  }

  /** 取（或重取）当前曲档案；token 变化即作废更早的请求 */
  function _ensureCurrentProfile(track) {
    _currentProfile = null;
    var token = ++_currentProfileToken;
    _profileClient.ensure(track, { priority: 2 }).then(function (profile) {
      if (token !== _currentProfileToken) return;
      _currentProfile = profile;
      if (profile) {
        console.log('[app] current profile:', track.title,
          'bpm=' + profile.tempo.primary, 'conf=' + profile.tempo.confidence,
          'beats=' + profile.beats.timesMs.length, 'segs=' + profile.segments.length,
          'cost=' + profile.costMs + 'ms');
      }
      _maybeComputePlan();
    });
  }

  function _analyzeCurrentTrack(cmd) {
    if (!_planner || !_profileClient) return;
    var track = _profileTrack(cmd);
    if (!track.id) return;
    if (track.id !== _currentProfileId) {
      // 换歌了：上一对（A,B）的方案必须立即作废，
      // 否则在旧 plan 的 exitMs 上会按上一首的时间轴触发淡变。
      _nextProfile = null;
      _nextProfileId = '';
      _nextTrackMeta = null;
      _audioEngine.setTransitionPlan(null);
      App.nowPlaying.clearTransitionPoint();
      _onTrackSwitchedCurrent(track.id);
    }
    _currentTrackMeta = _trackMetaOf(track);
    _currentProfileId = track.id;
    _ensureCurrentProfile(track);
  }

  /**
   * 自动推进（交叉淡化完成 / 无缝切换）之后唯一能纠正 current 的时刻。
   *
   * 播放器在这种推进里只发 track_changed，不会再发 audio_control.play，
   * 所以 _currentTrackMeta/_currentProfile 会一直停在**上一首**：
   * 下一对就被判成「专辑 A 第 1 轨 → 第 3 轨」，连号判定失配，
   * 整张专辑只有第一次（用户手点的那次）是 gapless，之后全走交叉淡化。
   *
   * 预载那首刚变成当前时直接把它的档案搬过来，既省一次分析，
   * 也避免"新 current 分析还没回来、plan 已经按旧 profile 算完"的竞态。
   */
  function _syncAutoMixCurrent(track) {
    if (!_planner || !_profileClient || !track) return;
    var t = _profileTrackFromQueue(track);
    if (!t.id) return;
    if (t.id === _currentProfileId) {
      _currentTrackMeta = _trackMetaOf(t);
      return;
    }
    var promoted = (t.id === _nextProfileId) ? _nextProfile : null;
    _nextProfile = null;
    _nextProfileId = '';
    _nextTrackMeta = null;
    _nextProfileToken++;              // 作废还没回来的 next 分析
    _currentProfileId = t.id;
    _currentTrackMeta = _trackMetaOf(t);
    if (promoted) {
      _currentProfile = promoted;
      _currentProfileToken++;         // 作废旧 current 的 in-flight 分析
      console.log('[app] AutoMix current promoted:', t.title);
      _maybeComputePlan();
      return;
    }
    _ensureCurrentProfile(t);
  }


  function _analyzeNextTrack(cmd) {
    if (!_planner || !_profileClient) return;
    var track = _profileTrack(cmd);
    if (!track.id) return;
    if (track.id !== _nextProfileId) {
      // 下一首换了：旧计划（尤其 gaplessFallback）必须立刻失效，
      // 不能等新档案回来才覆盖，否则新 buffer 会按旧计划切换。
      _audioEngine.setTransitionPlan(null);
      App.nowPlaying.clearTransitionPoint();
    }
    _nextProfileId = track.id;
    _nextTrackMeta = _trackMetaOf(track);
    _nextProfile = null;
    // 专辑连续曲只依赖元数据。不等分析（新专辑可能要好几百毫秒）就先把
    // seamless 计划交给引擎，否则自然结束时引擎手里还没有计划，会滑进
    // 交叉淡化分支——正好毁掉原过渡。
    if (_isAlbumSequence(_currentTrackMeta, _nextTrackMeta)) _maybeComputePlan();
    var token = ++_nextProfileToken;
    _profileClient.ensure(track, { priority: 1 }).then(function (profile) {
      if (token !== _nextProfileToken) return;
      _nextProfile = profile;
      if (profile) {
        console.log('[app] next profile:', track.title,
          'bpm=' + profile.tempo.primary, 'conf=' + profile.tempo.confidence,
          'cost=' + profile.costMs + 'ms');
      }
      _maybeComputePlan();
    });
  }

  /** 曲目切换时丢掉过期任务，避免为已经不会播放的歌烧 CPU */
  function _onTrackSwitchedCurrent(trackId) {
    if (_profileClient && typeof _profileClient.cancelPending === 'function') {
      _profileClient.cancelPending(trackId);
    }
  }

  function _maybeComputePlan() {
    if (!_audioEngine || !_audioEngine._crossfadeEnabled || !_planner) return;

    // 两侧都还没档案时也给一个可执行的回落方案，保证引擎行为确定。
    var plan = _planner.plan(_currentProfile, _nextProfile, {
      fallbackDurationMs: _audioEngine._crossfadeDurationMs,
      radical: !!_audioEngine._radicalTransitions,
      // 下一首是流式时没有 playbackRate/resample，只能规划 ratio=1。
      nextStreaming: !!_audioEngine._nextIsStreaming,
      // 同专辑按原顺序播放（专辑同名 + 碟/轨连号）＝作者设计好的连续曲，
      // 直接让位给自然结束的无缝切换，不做任何重叠。不看边界留白。
      albumSequence: _isAlbumSequence(_currentTrackMeta, _nextTrackMeta),
    });
    _lastPlan = plan;
    _audioEngine.setTransitionPlan(plan);
    console.log('[app] AutoMix plan:', _planner.describe(plan),
      'conf=' + plan.confidence, 'resolved=' + !!(_currentProfile && _nextProfile));

    var curDuration = _audioEngine._currentDurationMs ||
      (_currentProfile && _currentProfile.durationMs) || 0;
    if (plan.transitionStartMs >= 0 && curDuration > 0) {
      App.nowPlaying.setTransitionPoint(plan.transitionStartMs, curDuration);
    } else {
      App.nowPlaying.clearTransitionPoint();
    }
    if (window.__electronAPI && window.__electronAPI.invoke) {
      window.__electronAPI.invoke('set_transition_plan', plan).catch(function () {  });
    }
  }

  /* 调试出口：设置页/控制台可以查看当前档案与最近一次规划的理由 */
  App.automix = {
    lastPlan: function () { return _lastPlan; },
    profiles: function () { return { current: _currentProfile, next: _nextProfile }; },
    stats: function () { return _profileClient ? _profileClient.profileStats() : Promise.resolve(null); },
    describe: function () { return (_planner && _lastPlan) ? _planner.describe(_lastPlan) : ''; },
  };

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

    serverSelect.dispatchEvent(new Event('change'));
  }

  var DROP_AUDIO_EXT = ['.mp3', '.flac', '.ogg', '.wav', '.m4a', '.aac', '.opus', '.wma'];
  var _dropHintEl = null;
  var _dropEnterCount = 0;

  function _isFileDrag(e) {
    var dt = e.dataTransfer;

    if (!dt || !dt.types) return false;
    for (var i = 0; i < dt.types.length; i++) {
      if (dt.types[i] === 'Files') return true;
    }
    return false;
  }

  function _isAudioPath(p) {
    if (!p) return false;
    var dot = p.lastIndexOf('.');
    if (dot < 0) return false;
    return DROP_AUDIO_EXT.indexOf(p.slice(dot).toLowerCase()) >= 0;
  }

  function _ensureDropHint() {
    if (_dropHintEl && _dropHintEl.isConnected) return _dropHintEl;
    var el = document.createElement('div');
    el.className = 'drop-hint';
    el.id = 'drop-hint';
    el.setAttribute('aria-hidden', 'true');
    el.innerHTML =
      '<div class="drop-hint-card">' +
        '<span class="material-symbols-rounded drop-hint-icon">music_note</span>' +
        '<span class="drop-hint-text"></span>' +
      '</div>';
    document.body.appendChild(el);
    _dropHintEl = el;
    return el;
  }

  function _showDropHint(on) {
    var el = _ensureDropHint();
    if (on) {
      var txt = el.querySelector('.drop-hint-text');
      if (txt) txt.textContent = App.i18n ? App.i18n.t('drop.hint') : '松开以播放';
    }
    el.classList.toggle('visible', !!on);
  }

  function _initFileDrop() {
    if (!window.__electronAPI || !window.__electronAPI.getPathForFile) return;

    window.addEventListener('dragenter', function (e) {
      if (!_isFileDrag(e)) return;
      e.preventDefault();
      _dropEnterCount++;
      _showDropHint(true);
    }, true);

    window.addEventListener('dragover', function (e) {
      if (!_isFileDrag(e)) return;

      e.preventDefault();
      try { e.dataTransfer.dropEffect = 'copy'; } catch (err) {  }
    });

    window.addEventListener('dragleave', function (e) {
      if (!_isFileDrag(e)) return;
      _dropEnterCount = Math.max(0, _dropEnterCount - 1);

      if (_dropEnterCount === 0 || !e.relatedTarget) {
        _dropEnterCount = 0;
        _showDropHint(false);
      }
    }, true);

    window.addEventListener('drop', function (e) {
      if (!_isFileDrag(e)) return;
      e.preventDefault();
      e.stopPropagation();
      _dropEnterCount = 0;
      _showDropHint(false);

      var files = e.dataTransfer.files;
      if (!files || files.length === 0) return;
      var paths = [];
      var hasAudio = false;
      for (var i = 0; i < files.length; i++) {
        var f = files[i];
        var p = '';
        try { p = window.__electronAPI.getPathForFile(f) || ''; } catch (err) { p = ''; }
        if (!p && f.path) p = f.path;
        if (!p) continue;
        if (_isAudioPath(p) || _isAudioPath(f.name || '')) hasAudio = true;
        paths.push(p);
      }

      if (!hasAudio || paths.length === 0) return;

      App.backend.play_dropped_files(paths).then(function (res) {
        var data = null;
        try { data = JSON.parse(res); } catch (err) { data = null; }
        if (!data || !data.count) {
          if (App.utils && App.utils.toast) {
            App.utils.toast(App.i18n ? App.i18n.t('drop.unsupported') : '无法播放该文件');
          }
        }
      }).catch(function (err) {
        console.error('[app] play_dropped_files failed:', err);
      });
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    _initFileDrop();
    _initAudioEngine();
    _initAutoMixAnalysis();

    if (window.MemoryManager) {
      window.MemoryManager.start();
    }
    initBridge();
  });

})();
