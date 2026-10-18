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
    colorScheme: 'tonal_spot',
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

    return { save: save, restore: restore, scheduleRestore: scheduleRestore };
  })();

  App.refreshLibraryCache = function () {
    return Promise.all([

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
      return App.state;
    });
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

            if (s.language !== undefined && App.i18n && App.i18n.getLang() !== s.language) {
              App.i18n.init(s.language);
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

        return App.utils.call('get_queue').then(function(qres) {
          const qstate = JSON.parse(qres);
          App.state.queue = qstate.queue || [];
          App.state.currentQueueIndex = qstate.current_index;
          App.nowPlaying.updateQueue(App.state.queue, App.state.currentQueueIndex);
        });
      });
    });
  }

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

      App.state.monetSource = settings.monet_source || 'album_cover';
      if (App.state.monetSource === 'system_wallpaper') {
        _refreshMonetFromSystem();
      }

      _applyUiFont(settings.ui_font || '');

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

  function _onTrackChanged(trackJson) {
    const track = JSON.parse(trackJson);
    App.state.currentTrack = track;

    App.nowPlaying.clearTransitionPoint();

    if (window.MemoryManager) {
      window.MemoryManager.fireTrackChangeCleanup();
    }

    if (_gaplessSwitchPending || _crossfadeSwitchPending) {
      _gaplessSwitchPending = false;
      _crossfadeSwitchPending = false;
      _skipNextTrackGlitch = false;
      requestAnimationFrame(function () {
        App.nowPlaying.updateTrack(track);

        _updateListPlayState();
      });
      return;
    }

    App.nowPlaying.updateTrack(track);

    if (_skipNextTrackGlitch) {
      _skipNextTrackGlitch = false;
    } else if (_audioEngine && _audioEngine._isPlaying) {

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

  function _positionPlaylistsSubmenu() {
    if (!playlistsNavBtn || !playlistsSubmenu) return;
    const rect = playlistsNavBtn.getBoundingClientRect();

    const navDrawer = document.getElementById('nav-drawer');
    const navRect = navDrawer ? navDrawer.getBoundingClientRect() : { right: 80 };
    const submenuWidth = 240;
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
    const frag = document.createDocumentFragment();

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

    var divider = document.createElement('div');
    divider.className = 'nav-submenu-divider';
    frag.appendChild(divider);

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

  Object.defineProperty(App, 'currentAnalysis', {
    get: function () { return _currentTrackAnalysis; }
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
      App.nowPlaying.setTrackInfoHidden(true);
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
              _analyzeCurrentTrack(cmd.filePath, cmd.trackId, cmd.title, cmd.artist, cmd.durationMs);
            }
            break;
          case 'play_streaming':

            _audioEngine.playStreaming(cmd.durationMs, cmd.seekOffsetMs, cmd.paused);

            _applyTrackLoudness(cmd.filePath, cmd.trackId);

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

            _audioEngine.setNextInfo(cmd.filePath, cmd.durationMs, cmd.forceStreaming);

            _prefetchTrackLoudness(cmd.filePath, cmd.trackId);

            if (_audioEngine._crossfadeEnabled) {
              _analyzeNextTrack(cmd.filePath, cmd.trackId, cmd.title, cmd.artist, cmd.durationMs);
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

  var _trackAnalyzer = null;
  var _transitionPlanner = null;
  var _currentTrackAnalysis = null;
  var _nextTrackAnalysis = null;
  var _currentAnalysisToken = 0;
  var _nextAnalysisToken = 0;
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

  function _analyzeCurrentTrack(filePath, trackId, title, artist, durationMs) {
    if (!_trackAnalyzer) return;

    if (filePath && (filePath.indexOf('http://') === 0 || filePath.indexOf('https://') === 0)) {
      ++_currentAnalysisToken;
      _currentTrackAnalysis = null;
      _maybeComputePlan();
      return;
    }
    var token = ++_currentAnalysisToken;
    _currentTrackAnalysis = null;

    if (trackId && window.__electronAPI && window.__electronAPI.invoke) {
      window.__electronAPI.invoke('get_track_analysis', trackId).then(function (cached) {
        if (token !== _currentAnalysisToken) return;
        if (cached) {
          _currentTrackAnalysis = cached;
          console.log('[app] Current track analysis loaded from cache:', title);
          _maybeComputePlan();
          return;
        }

        _performSpectrumAnalysis(filePath, trackId, title, artist, durationMs, token, true);
      }).catch(function () {
        if (token !== _currentAnalysisToken) return;
        _performSpectrumAnalysis(filePath, trackId, title, artist, durationMs, token, true);
      });
    } else {
      _performSpectrumAnalysis(filePath, trackId, title, artist, durationMs, token, true);
    }
  }

  function _analyzeNextTrack(filePath, trackId, title, artist, durationMs) {
    if (!_trackAnalyzer) return;

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
        if (token !== _nextAnalysisToken) return;
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

  function _performSpectrumAnalysis(filePath, trackId, title, artist, durationMs, token, isCurrent) {

    var spectrumPromise = _trackAnalyzer.analyze(
      { title: title, artist: artist, duration_ms: durationMs },
      filePath
    );

    var osuPromise = Promise.resolve(null);
    if (title && window.__electronAPI && window.__electronAPI.invoke) {
      osuPromise = window.__electronAPI.invoke('search_osu_beatmap', title, artist, durationMs)
        .catch(function () { return null; });
    }

    Promise.all([spectrumPromise, osuPromise]).then(function (results) {

      var currentToken = isCurrent ? _currentAnalysisToken : _nextAnalysisToken;
      if (token !== currentToken) return;

      var spectrum = results[0];
      var osu = results[1];

      if (!spectrum && !osu) {
        console.log('[app] Analysis failed for:', title, '(no spectrum or osu data)');
        if (isCurrent) _currentTrackAnalysis = null;
        else _nextTrackAnalysis = null;
        _maybeComputePlan();
        return;
      }

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

        if (osu.bpm > 0) {
          analysis.bpm = osu.bpm;
        }
      }
      analysis.trackId = trackId;

      currentToken = isCurrent ? _currentAnalysisToken : _nextAnalysisToken;
      if (token !== currentToken) return;

      if (isCurrent) {
        _currentTrackAnalysis = analysis;
      } else {
        _nextTrackAnalysis = analysis;
      }

      console.log('[app] Analysis complete for', (isCurrent ? 'current' : 'next') + ':', title,
        'BPM=' + analysis.bpm, 'source=' + analysis.source);

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

  function _maybeComputePlan() {
    if (!_transitionPlanner || !_audioEngine) return;
    if (!_audioEngine._crossfadeEnabled) return;

    var plan = _transitionPlanner.plan(
      _currentTrackAnalysis || null,
      _nextTrackAnalysis || null,
      {
        crossfadeDurationMs: _audioEngine._crossfadeDurationMs,
        radicalTransitions: !!_audioEngine._radicalTransitions
      }
    );

    _audioEngine.setTransitionPlan(plan);

    var curDuration = _audioEngine._currentDurationMs ||
      (_currentTrackAnalysis && _currentTrackAnalysis.durationMs) || 0;
    if (plan.transitionStartMs >= 0 && curDuration > 0) {
      App.nowPlaying.setTransitionPoint(plan.transitionStartMs, curDuration);
    } else {
      App.nowPlaying.clearTransitionPoint();
    }

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
