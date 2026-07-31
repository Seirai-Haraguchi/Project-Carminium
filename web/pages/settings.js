/**
 * Carminium — 设置页（单页连续布局）
 *
 * 所有分类自上而下依次排列，标题区不切换，滚动浏览全部设置项。
 * 分类：
 *   1. 外观与视觉    — 主题、配色、歌词与文字
 *   2. 音频和库      — 输出设备、歌手分隔等
 *   3. 自动化与控制  — 启动行为、快捷键
 *   4. 实验性        — 窗口随鼓点震动等效果
 *   5. 关于          — 跳转独立关于页
 */
(function () {
  'use strict';

  window.App = window.App || {};
  const page = {};
  window.App.pages.settings = page;

  let _lastSettings = null;

  // ── 分类定义 ─────────────────────────────────────────────────────────────
  // 每个分类对应一个设置入口；rows 是该分类下的设置项。
  // type: 'select' | 'toggle' | 'text' | 'device_select'
  // bind: settings.json 里的字段名
  // 使用函数以便在渲染时实时解析 i18n 翻译
  function _t(key) { return window.App && App.i18n ? App.i18n.t(key) : key; }

  function _buildSections() {
    return [
    {
      id: 'appearance',
      titleKey: 'settings.section.appearance',
      icon: 'palette',
      groups: [
        {
          titleKey: 'settings.group.global',
          rows: [
            {
              type: 'select',
              bind: 'theme',
              label: _t('settings.theme.label'),
              sub: _t('settings.theme.sub'),
              options: [
                { value: 'system', label: _t('settings.theme.system') },
                { value: 'light', label: _t('settings.theme.light') },
                { value: 'dark', label: _t('settings.theme.dark') },
              ],
              onApply: function (val) { _applyTheme(val); },
            },
            {
              type: 'select',
              bind: 'color_scheme',
              label: _t('settings.colorScheme.label'),
              sub: _t('settings.colorScheme.sub'),
              options: [
                { value: 'tonal_spot', label: _t('settings.colorScheme.tonal_spot') },
                { value: 'fidelity', label: _t('settings.colorScheme.fidelity') },
                { value: 'monochrome', label: _t('settings.colorScheme.monochrome') },
                { value: 'neutral', label: _t('settings.colorScheme.neutral') },
                { value: 'vibrant', label: _t('settings.colorScheme.vibrant') },
                { value: 'expressive', label: _t('settings.colorScheme.expressive') },
                { value: 'content', label: _t('settings.colorScheme.content') },
                { value: 'rainbow', label: _t('settings.colorScheme.rainbow') },
                { value: 'fruit_salad', label: _t('settings.colorScheme.fruit_salad') },
              ],
              onApply: function (val) { _applyColorScheme(val); },
            },
            {
              type: 'select',
              bind: 'monet_source',
              label: _t('settings.monetSource.label'),
              sub: _t('settings.monetSource.sub'),
              options: [
                { value: 'album_cover', label: _t('settings.monetSource.album_cover') },
                { value: 'system_wallpaper', label: _t('settings.monetSource.system_wallpaper') },
              ],
              onApply: function (val) { _applyMonetSource(val); },
            },
            {
              type: 'select',
              bind: 'language',
              label: _t('settings.language.label'),
              sub: _t('settings.language.sub'),
              options: [
                { value: 'zh-CN', label: '简体中文' },
                { value: 'zh-TW', label: '繁體中文' },
                { value: 'ja', label: '日本語' },
                { value: 'en', label: 'English' },
                { value: 'ru', label: 'Русский' },
              ],
              onApply: function (val) { _applyLanguage(val); },
            },
            {
              type: 'text',
              bind: 'ui_font',
              label: _t('settings.uiFont.label'),
              sub: _t('settings.uiFont.sub'),
              placeholder: 'Google Sans Flex, Noto Sans SC, sans-serif',
              onApply: function (val) { _applyUiFont(val); },
            },
          ],
        },
        {
          titleKey: 'settings.group.playback',
          rows: [
            {
              type: 'toggle',
              bind: 'circular_cover',
              label: _t('settings.circularCover.label'),
              sub: _t('settings.circularCover.sub'),
              onChange: function (checked) { _applyCircularCover(checked); },
            },
            {
              type: 'toggle',
              bind: 'wave_progress',
              label: _t('settings.waveProgress.label'),
              sub: _t('settings.waveProgress.sub'),
              onChange: function (checked) { _applyWaveProgress(checked); },
            },
            {
              type: 'toggle',
              bind: 'video_background',
              label: _t('settings.videoBackground.label'),
              sub: _t('settings.videoBackground.sub'),
              onChange: function (checked) { _applyVideoBackground(checked); },
            },
          ],
        },
        {
          titleKey: 'settings.group.lyrics',
          rows: [
            {
              type: 'text',
              bind: 'lyrics_font',
              label: _t('settings.lyricsFont.label'),
              sub: _t('settings.lyricsFont.sub'),
              placeholder: 'Google Sans Flex, Noto Sans SC, sans-serif',
              onApply: function (val) { _applyLyricsFont(val); },
            },
            {
              type: 'text',
              bind: 'lyrics_jp_font',
              label: _t('settings.lyricsJpFont.label'),
              sub: _t('settings.lyricsJpFont.sub'),
              placeholder: 'Yu Gothic UI, Hiragino Kaku Gothic ProN, Meiryo, sans-serif',
              onApply: function (val) { _applyLyricsJpFont(val); },
            },
            {
              type: 'toggle',
              bind: 'lyrics_jp_use_distinct',
              label: _t('settings.lyricsJpDistinct.label'),
              sub: _t('settings.lyricsJpDistinct.sub'),
              onChange: function (checked) { _applyLyricsJpDistinct(checked); },
            },
            {
              type: 'toggle',
              bind: 'lyrics_progressive_blur',
              label: _t('settings.lyricsBlur.label'),
              sub: _t('settings.lyricsBlur.sub'),
              onChange: function (checked) { _applyProgressiveBlur(checked); },
            },
            {
              type: 'toggle',
              bind: 'lyrics_center',
              label: _t('settings.lyricsCenter.label'),
              sub: _t('settings.lyricsCenter.sub'),
              onChange: function (checked) { _applyLyricsCenter(checked); },
            },
            {
              type: 'slider',
              bind: 'lyrics_font_size',
              label: _t('settings.lyricsFontSize.label'),
              sub: _t('settings.lyricsFontSize.sub'),
              min: 12,
              max: 28,
              step: 1,
              unit: 'px',
              onChange: function (val) { _applyLyricsFontSize(val); },
            },
            {
              type: 'text',
              bind: 'lyrics_credit_filters',
              label: _t('settings.lyricsCreditFilters.label'),
              sub: _t('settings.lyricsCreditFilters.sub'),
              placeholder: '作词,作曲,编曲,制作人,混音,母带,录音',
              onApply: function (val) { _applyLyricsCreditFilters(val); },
            },
          ],
        },
      ],
    },
    {
      id: 'audio_library',
      titleKey: 'settings.section.audio',
      icon: 'headphones',
      groups: [
        {
          titleKey: 'settings.group.audio',
          rows: [
            {
              type: 'toggle',
              bind: 'wasapi_exclusive',
              label: _t('settings.wasapiExclusive.label'),
              sub: _t('settings.wasapiExclusive.sub'),
              hotToggle: 'wasapi_exclusive',
              onChange: function (actualOn) { _applyWasapiExclusive(actualOn); },
            },
            {
              type: 'notice',
              bind: 'wasapi_exclusive_notice',
              showWhen: 'wasapi_exclusive',
              icon: 'priority_high',
              title: _t('settings.wasapiNotice.title'),
              items: [
                _t('settings.wasapiNotice.item1'),
                _t('settings.wasapiNotice.item2'),
                _t('settings.wasapiNotice.item3'),
                _t('settings.wasapiNotice.item4'),
              ],
            },
            {
              type: 'select',
              bind: 'audio_api',
              label: _t('settings.audioApi.label'),
              sub: _t('settings.audioApi.sub'),
              options: [
                { value: 'wasapi', label: 'WASAPI' },
                { value: 'directsound', label: 'DirectSound' },
                { value: 'waveout', label: 'WaveOut' },
              ],
              onApply: function (val) { _promptRestart(_t('settings.restartTitle'), _t('settings.restartBody')); },
            },
            {
              type: 'device_select',
              bind: 'audio_output_device',
              label: _t('settings.outputDevice.label'),
              sub: _t('settings.outputDevice.sub'),
              placeholder: _t('settings.outputDevice.default'),
            },
            {
              type: 'toggle',
              bind: 'eq_enabled',
              label: _t('settings.eq.label'),
              sub: _t('settings.eq.sub'),
              onChange: function (checked) {
                var ae = window.__audioEngine;
                if (ae) ae.setEqEnabled(checked);
              },
            },
            {
              type: 'eq',
              bind: 'eq_bands',
              label: _t('settings.eqBands.label'),
              sub: _t('settings.eqBands.sub'),
            },
            {
              type: 'toggle',
              bind: 'dynamic_bass',
              label: _t('settings.dynamicBass.label'),
              sub: _t('settings.dynamicBass.sub'),
              onChange: function (checked) {
                var ae = window.__audioEngine;
                if (ae) ae.setDynamicBass(checked);
              },
            },
            {
              type: 'toggle',
              bind: 'compressor_enabled',
              label: _t('settings.compressor.label'),
              sub: _t('settings.compressor.sub'),
              onChange: function (checked) {
                var ae = window.__audioEngine;
                if (ae) ae.setCompressorEnabled(checked);
              },
            },
            {
              type: 'toggle',
              bind: 'vocal_enhance',
              label: _t('settings.vocalEnhance.label'),
              sub: _t('settings.vocalEnhance.sub'),
              onChange: function (checked) {
                var ae = window.__audioEngine;
                if (ae) ae.setVocalEnhance(checked);
              },
            },
            {
              type: 'toggle',
              bind: 'guitar_friendly',
              label: _t('settings.guitarFriendly.label'),
              sub: _t('settings.guitarFriendly.sub'),
              onChange: function (checked) {
                var ae = window.__audioEngine;
                if (ae) ae.setGuitarFriendly(checked);
              },
            },
          ],
        },
        {
          titleKey: 'settings.group.library',
          rows: [
            {
              type: 'text',
              bind: 'artist_separators',
              label: _t('settings.artistSeparators.label'),
              sub: _t('settings.artistSeparators.sub'),
              placeholder: ';',
              onApply: function () { App.refreshLibraryCache(); },
            },
          ],
        },
      ],
    },
    {
      id: 'automation_controls',
      titleKey: 'settings.section.automation',
      icon: 'tune',
      groups: [
        {
          titleKey: 'settings.group.automation',
          rows: [
            {
              type: 'toggle',
              bind: 'shuffle',
              label: _t('settings.shuffle.label'),
              sub: _t('settings.shuffle.sub'),
              onChange: function (checked) { App.backend.set_shuffle(checked); },
            },
            {
              type: 'toggle',
              bind: 'resume_playback',
              label: _t('settings.resumePlayback.label'),
              sub: _t('settings.resumePlayback.sub'),
              disabled: true,
            },
            {
              type: 'toggle',
              bind: 'automix',
              label: _t('settings.automix.label'),
              sub: _t('settings.automix.sub'),
              onChange: function (checked) {
                App.utils.call('set_automix', checked);
                if (checked) {
                  App.utils.call('set_gapless', false);
                  var gaplessEl = document.querySelector('input[type="checkbox"][data-bind="gapless"]');
                  if (gaplessEl) gaplessEl.checked = false;
                }
              },
            },
            {
              type: 'toggle',
              bind: 'gapless',
              label: _t('settings.gapless.label'),
              sub: _t('settings.gapless.sub'),
              onChange: function (checked) {
                App.utils.call('set_gapless', checked);
                if (checked) {
                  App.utils.call('set_automix', false);
                  var automixEl = document.querySelector('input[type="checkbox"][data-bind="automix"]');
                  if (automixEl) automixEl.checked = false;
                }
              },
            },
          ],
        },
        {
          titleKey: 'settings.group.controlCenter',
          rows: [
            {
              type: 'toggle',
              bind: 'smtc_lyrics',
              label: _t('settings.smtcLyrics.label'),
              sub: _t('settings.smtcLyrics.sub'),
            },
          ],
        },
        {
          titleKey: 'settings.group.shortcuts',
          rows: [
            { type: 'shortcut', bind: 'shortcuts', action: 'play_pause', label: _t('shortcut.play_pause'), sub: _t('shortcut.play_pause.sub') },
            { type: 'shortcut', bind: 'shortcuts', action: 'next_track', label: _t('shortcut.next_track'), sub: _t('shortcut.next_track.sub') },
            { type: 'shortcut', bind: 'shortcuts', action: 'prev_track', label: _t('shortcut.prev_track'), sub: _t('shortcut.prev_track.sub') },
            { type: 'shortcut', bind: 'shortcuts', action: 'volume_up', label: _t('shortcut.volume_up'), sub: _t('shortcut.volume_up.sub') },
            { type: 'shortcut', bind: 'shortcuts', action: 'volume_down', label: _t('shortcut.volume_down'), sub: _t('shortcut.volume_down.sub') },
            { type: 'shortcut', bind: 'shortcuts', action: 'toggle_like', label: _t('shortcut.toggle_like'), sub: _t('shortcut.toggle_like.sub') },
            { type: 'shortcut', bind: 'shortcuts', action: 'toggle_mute', label: _t('shortcut.toggle_mute'), sub: _t('shortcut.toggle_mute.sub') },
          ],
        },
        {
          titleKey: 'settings.group.gamepad',
          rows: [
            {
              type: 'select',
              bind: 'gamepad_button_layout',
              label: _t('settings.gamepadLayout.label'),
              sub: _t('settings.gamepadLayout.sub'),
              options: [
                { value: 'eastern', label: _t('settings.gamepadLayout.eastern') },
                { value: 'western', label: _t('settings.gamepadLayout.western') },
              ],
              onApply: function (val) {
                if (App.gamepad && App.gamepad.setButtonLayout) {
                  App.gamepad.setButtonLayout(val);
                }
              },
            },
          ],
        },
      ],
    },
    {
      id: 'experimental',
      titleKey: 'settings.section.experimental',
      icon: 'science',
      rows: [
        {
          type: 'toggle',
          bind: 'window_beat_shake',
          label: _t('settings.windowBeatShake.label'),
          sub: _t('settings.windowBeatShake.sub'),
        },
      ],
    },
    {
      id: 'system',
      titleKey: 'settings.section.system',
      icon: 'memory',
      rows: [
        {
          type: 'memory_info',
          bind: '_memory_info',
        },
      ],
    },
    {
      id: 'about',
      titleKey: 'settings.section.about',
      icon: 'info',
      isPage: true,
    },
  ];
  }

  // ── 渲染 ─────────────────────────────────────────────────────────────────
  page.render = function (container) {
    page.container = container;
    _renderSinglePage();
  };

  // ── 单页连续布局 ─────────────────────────────────────────────────────────
  // 所有分类自上而下依次渲染，不做选项卡切换。
  function _renderSinglePage() {
    var container = page.container;
    container.innerHTML = '' +
      '<div class="settings-single">' +
        '<div class="page-sticky-header">' +
          '<div class="page-header">' +
            '<div class="page-header-left">' +
              '<h1 class="page-title" data-i18n="page.settings.title">' + _t('page.settings.title') + '</h1>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div class="settings-sections" id="settings-sections">' +
          _renderAllSections() +
        '</div>' +
      '</div>';

    _bindAllSections();
  }

  function _renderAllSections() {
    var sections = _buildSections();
    return sections.map(function (section) {
      return section.isPage ? _renderPageSection(section) : _renderSection(section);
    }).join('');
  }

  function _renderSectionHeader(section) {
    return '' +
      '<div class="settings-section-header" data-section="' + section.id + '">' +
        '<h2 class="settings-section-title" data-i18n="' + section.titleKey + '">' + _t(section.titleKey) + '</h2>' +
      '</div>';
  }

  function _renderSection(section) {
    var bodyHtml = section.groups
      ? section.groups.map(_renderGroup).join('')
      : (section.rows && section.rows.length
          ? section.rows.map(_renderRow).join('')
          : _renderEmptyHint());

    return '' +
      '<section class="settings-section" data-section="' + section.id + '">' +
        _renderSectionHeader(section) +
        '<div class="settings-section-body">' + bodyHtml + '</div>' +
      '</section>';
  }

  function _renderPageSection(section) {
    var bodyHtml = '' +
      '<div class="settings-row settings-row-link" data-navigate="' + section.id + '">' +
        '<div>' +
          '<p class="settings-row-label" data-i18n="settings.about.label">' + _t('settings.about.label') + '</p>' +
          '<p class="settings-row-sub" data-i18n="settings.about.sub">' + _t('settings.about.sub') + '</p>' +
        '</div>' +
        '<span class="material-symbols-rounded settings-row-link-arrow">chevron_right</span>' +
      '</div>';

    return '' +
      '<section class="settings-section" data-section="' + section.id + '">' +
        _renderSectionHeader(section) +
        '<div class="settings-section-body">' + bodyHtml + '</div>' +
      '</section>';
  }

  // ── 事件绑定：一次性绑定所有分类 ───────────────────────────────────────
  function _bindAllSections() {
    // 先用缓存设置绑定，再用最新设置重新绑定
    if (_lastSettings) {
      _buildSections().forEach(function (section) {
        if (section.isPage) return;
        _bindSectionRows(section, _lastSettings);
      });
    }

    // 关于页导航行
    page.container.querySelectorAll('.settings-row-link[data-navigate]').forEach(function (row) {
      row.addEventListener('click', function () {
        var target = this.dataset.navigate;
        if (App.navigate) App.navigate(target);
      });
    });

    // 加载最新设置后重新绑定所有分类
    App.utils.call('get_settings').then(function (res) {
      var settings = JSON.parse(res);
      _lastSettings = settings;
      _buildSections().forEach(function (section) {
        if (section.isPage) return;
        _bindSectionRows(section, settings);
      });
    });

    // ── 内存信息面板绑定 ──
    _bindMemoryInfo();
  }

  // ── 内存信息面板 ─────────────────────────────────────────────────────────
  var _memoryRefreshTimer = null;

  function _bindMemoryInfo() {
    var statsEl = page.container.querySelector('#memory-stats-display');
    var cleanupBtn = page.container.querySelector('#memory-cleanup-btn');
    if (!statsEl) return;

    // 立即加载一次
    _refreshMemoryStats(statsEl);

    // 定时刷新（每 5 秒）
    if (_memoryRefreshTimer) clearInterval(_memoryRefreshTimer);
    _memoryRefreshTimer = setInterval(function () {
      _refreshMemoryStats(statsEl);
    }, 5000);

    // 清理按钮
    if (cleanupBtn) {
      cleanupBtn.addEventListener('click', function () {
        cleanupBtn.disabled = true;
        if (window.MemoryManager) {
          window.MemoryManager.emergencyCleanup();
        }
        // 请求主进程也执行清理
        if (window.__electronAPI && window.__electronAPI.invoke) {
          window.__electronAPI.invoke('memory:request_cleanup').catch(function () {});
          window.__electronAPI.invoke('memory:request_gc').catch(function () {});
        }
        setTimeout(function () {
          cleanupBtn.disabled = false;
          _refreshMemoryStats(statsEl);
        }, 500);
      });
    }

    // 页面离开时停止刷新
    var origNavigate = App.navigate;
    if (!App._memoryNavWrapped) {
      App._memoryNavWrapped = true;
      App.navigate = function () {
        if (_memoryRefreshTimer) {
          clearInterval(_memoryRefreshTimer);
          _memoryRefreshTimer = null;
        }
        return origNavigate.apply(this, arguments);
      };
    }
  }

  function _refreshMemoryStats(statsEl) {
    if (!statsEl) return;

    // 渲染进程内存
    var rendererStats = window.MemoryManager ? window.MemoryManager.getStats() : null;

    // 主进程内存
    if (window.__electronAPI && window.__electronAPI.invoke) {
      window.__electronAPI.invoke('memory:get_stats').then(function (res) {
        try {
          var mainStats = JSON.parse(res);
          statsEl.innerHTML = _formatMemoryStats(mainStats, rendererStats);
        } catch (e) {
          statsEl.innerHTML = '<p class="settings-row-sub">内存数据解析失败</p>';
        }
      }).catch(function () {
        statsEl.innerHTML = '<p class="settings-row-sub">无法获取内存数据</p>';
      });
    } else {
      statsEl.innerHTML = _formatMemoryStats(null, rendererStats);
    }
  }

  function _formatBytes(bytes) {
    if (!bytes || bytes <= 0) return '0 B';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
  }

  function _formatMemoryStats(main, renderer) {
    var html = '<div class="settings-memory-grid">';

    // 主进程
    if (main && main.main) {
      var m = main.main;
      html += '<div class="settings-memory-item">' +
        '<span class="settings-memory-label">主进程 RSS</span>' +
        '<span class="settings-memory-value">' + _formatBytes(m.rss) + '</span>' +
        '</div>';
      html += '<div class="settings-memory-item">' +
        '<span class="settings-memory-label">主进程堆使用</span>' +
        '<span class="settings-memory-value">' + _formatBytes(m.heapUsed) + '</span>' +
        '</div>';
      html += '<div class="settings-memory-item">' +
        '<span class="settings-memory-label">主进程堆总量</span>' +
        '<span class="settings-memory-value">' + _formatBytes(m.heapTotal) + '</span>' +
        '</div>';
    }

    // 渲染进程
    if (renderer) {
      if (renderer.jsHeapUsed !== undefined) {
        html += '<div class="settings-memory-item">' +
          '<span class="settings-memory-label">渲染进程 JS 堆</span>' +
          '<span class="settings-memory-value">' + _formatBytes(renderer.jsHeapUsed) +
          ' / ' + _formatBytes(renderer.jsHeapTotal) + '</span>' +
          '</div>';
      }
      if (renderer.blobUrls !== undefined) {
        html += '<div class="settings-memory-item">' +
          '<span class="settings-memory-label">Blob URL 追踪</span>' +
          '<span class="settings-memory-value">' + renderer.blobUrls + '</span>' +
          '</div>';
      }
      if (renderer.totalTrackedListeners !== undefined) {
        html += '<div class="settings-memory-item">' +
          '<span class="settings-memory-label">追踪监听器</span>' +
          '<span class="settings-memory-value">' + renderer.totalTrackedListeners +
          ' (' + renderer.trackedElements + ' 元素)</span>' +
          '</div>';
      }
      if (renderer.audioBufferCache) {
        html += '<div class="settings-memory-item">' +
          '<span class="settings-memory-label">音频缓冲缓存</span>' +
          '<span class="settings-memory-value">' + _formatBytes(renderer.audioBufferCache.bytes) +
          ' (' + renderer.audioBufferCache.entries + ' 条)</span>' +
          '</div>';
      }
      if (renderer.coverCache) {
        html += '<div class="settings-memory-item">' +
          '<span class="settings-memory-label">封面缓存</span>' +
          '<span class="settings-memory-value">' + renderer.coverCache.cached +
          ' / ' + renderer.coverCache.maxPool + '</span>' +
          '</div>';
      }
    }

    html += '</div>';
    return html;
  }

  // ── 渲染辅助 ─────────────────────────────────────────────────────────────
  function _renderGroup(group) {
    const rowsHtml = group.rows.map(_renderRow).join('');
    return `
      <div class="settings-group-header" data-i18n="${group.titleKey}">${_t(group.titleKey)}</div>
      ${rowsHtml}
    `;
  }

  function _renderEmptyHint() {
    return `
      <div class="settings-row settings-row-empty">
        <p class="settings-row-sub">` + _t('settings.about.emptyHint') + `</p>
      </div>
    `;
  }

  function _renderRow(row) {
    if (row.type === 'memory_info') {
      return '' +
        '<div class="settings-row settings-memory-info" data-bind="' + row.bind + '">' +
          '<div class="settings-memory-stats" id="memory-stats-display">' +
            '<p class="settings-row-sub">加载中…</p>' +
          '</div>' +
          '<button class="md-text-btn settings-memory-cleanup-btn" id="memory-cleanup-btn" type="button">' +
            '<span class="material-symbols-rounded">cleanup</span>' +
            '<span>立即清理</span>' +
          '</button>' +
        '</div>';
    }
    if (row.type === 'notice') {
      var itemsHtml = (row.items || []).map(function (it) {
        return '<li class="settings-notice-item">' + it + '</li>';
      }).join('');
      return `
        <div class="settings-row settings-notice" data-bind="${row.bind}" data-show-when="${row.showWhen || ''}" style="display:none">
          <div class="settings-notice-icon"><span class="material-symbols-rounded">${row.icon || 'info'}</span></div>
          <div class="settings-notice-body">
            <p class="settings-notice-title">${row.title || ''}</p>
            <ul class="settings-notice-list">${itemsHtml}</ul>
          </div>
        </div>
      `;
    }
    if (row.type === 'select') {
      var defaultLabel = '';
      var optsHtml = row.options.map(function (o) {
        return '<div class="md-dropdown-item" data-value="' + o.value + '" role="menuitem">' + o.label + '</div>';
      }).join('');
      return `
        <div class="settings-row" data-bind="${row.bind}">
          <div>
            <p class="settings-row-label">${row.label}</p>
            <p class="settings-row-sub">${row.sub || ''}</p>
          </div>
          <div class="md-dropdown md-select-dropdown" data-bind="${row.bind}">
            <button class="md-dropdown-trigger" type="button" aria-haspopup="true" aria-expanded="false">
              <span class="md-dropdown-value">—</span>
              <span class="material-symbols-rounded md-dropdown-arrow">arrow_drop_down</span>
            </button>
            <div class="md-dropdown-menu" role="menu">${optsHtml}</div>
          </div>
        </div>
      `;
    }
    if (row.type === 'toggle') {
      const disabledAttr = row.disabled ? 'disabled' : '';
      return `
        <div class="settings-row" data-bind="${row.bind}">
          <div>
            <p class="settings-row-label">${row.label}</p>
            <p class="settings-row-sub">${row.sub || ''}</p>
          </div>
          <label class="toggle">
            <input type="checkbox" data-bind="${row.bind}" ${disabledAttr}>
            <div class="toggle-track"></div>
            <div class="toggle-thumb"></div>
          </label>
        </div>
      `;
    }
    if (row.type === 'text') {
      return `
        <div class="settings-row settings-row-text" data-bind="${row.bind}">
          <div>
            <p class="settings-row-label">${row.label}</p>
            <p class="settings-row-sub">${row.sub || ''}</p>
          </div>
          <input type="text" class="settings-font-input" data-bind="${row.bind}"
                 placeholder="${row.placeholder || ''}">
        </div>
      `;
    }
    if (row.type === 'device_select') {
      const defaultLabel = App.utils.esc(row.placeholder || _t('settings.outputDevice.default'));
      return `
        <div class="settings-row" data-bind="${row.bind}">
          <div>
            <p class="settings-row-label">${row.label}</p>
            <p class="settings-row-sub">${row.sub || ''}</p>
          </div>
          <div class="md-dropdown" data-bind="${row.bind}">
            <button class="md-dropdown-trigger" type="button" aria-haspopup="true" aria-expanded="false">
              <span class="md-dropdown-value" data-default="${defaultLabel}">${defaultLabel}</span>
              <span class="material-symbols-rounded md-dropdown-arrow">arrow_drop_down</span>
            </button>
            <div class="md-dropdown-menu" role="menu"></div>
          </div>
        </div>
      `;
    }
    if (row.type === 'shortcut') {
      return `
        <div class="settings-row settings-row-shortcut" data-bind="${row.bind}" data-action="${row.action}">
          <div>
            <p class="settings-row-label">${row.label}</p>
            <p class="settings-row-sub">${row.sub || ''}</p>
          </div>
      <button class="settings-shortcut-value" type="button" data-action="${row.action}" data-default="${_t('shortcut.notSet')}">
        <span class="settings-shortcut-keys">${_t('shortcut.notSet')}</span>
            <span class="material-symbols-rounded settings-shortcut-edit">edit</span>
          </button>
        </div>
      `;
    }
    if (row.type === 'slider') {
      return `
        <div class="settings-row settings-row-slider" data-bind="${row.bind}">
          <div>
            <p class="settings-row-label">${row.label}</p>
            <p class="settings-row-sub">${row.sub || ''}</p>
          </div>
          <div class="settings-slider-control">
            <input type="range" class="settings-slider" data-bind="${row.bind}"
                   min="${row.min}" max="${row.max}" step="${row.step || 1}">
            <span class="settings-slider-value" data-bind="${row.bind}">${row.min}</span>
          </div>
        </div>
      `;
    }
    if (row.type === 'eq') {
      var eqFreqLabels = ['25', '40', '63', '100', '160', '250', '400', '630', '1k', '1.6k', '2.5k', '4k', '6.3k', '10k', '16k', '20k'];
      var slidersHtml = eqFreqLabels.map(function (label, i) {
        return `
          <div class="settings-eq-band">
            <div class="settings-eq-slider-wrap">
              <input type="range" class="settings-eq-slider" data-band="${i}" min="-12" max="12" step="1">
            </div>
            <span class="settings-eq-band-label">${label}</span>
          </div>
        `;
      }).join('');
      return `
        <div class="settings-eq-fullwidth" data-bind="${row.bind}">
          <div class="settings-eq-bands">
            ${slidersHtml}
          </div>
        </div>
      `;
    }
    return '';
  }

  // ── 事件绑定 ─────────────────────────────────────────────────────────────
  function _bindSectionRows(section, settings) {
    const allRows = section.groups
      ? section.groups.reduce(function (acc, g) { return acc.concat(g.rows); }, [])
      : (section.rows || []);
    allRows.forEach(function (row) {
      if (row.type === 'select') {
        _bindSelectRow(row, settings[row.bind]);
      } else if (row.type === 'toggle') {
        const el = document.querySelector(`input[type="checkbox"][data-bind="${row.bind}"]`);
        if (!el) return;
        el.checked = !!settings[row.bind];
        if (!row.disabled) {
          el.removeEventListener('change', el._settingsChangeHandler);
          el._settingsChangeHandler = function () {
            const checked = this.checked;
            if (row.hotToggle === 'wasapi_exclusive') {
              // 独占模式：弹 dialog 确认后再热切换（后端负责保存设置、发送 settings_changed）。
              // 取消时回滚开关到原状态；回退到共享时同步开关为关。
              var prevChecked = !checked;
              App.utils.confirmExclusiveSwitch(checked).then(function (ok) {
                if (!ok) {
                  if (el.checked !== prevChecked) el.checked = prevChecked;
                  return;
                }
                App.utils.call('set_wasapi_exclusive', checked).then(function (actual) {
                  var actualOn = (actual === 'wasapi_exclusive');
                  // 同步独占模式标志到 App.state
                  if (window.App && App.state) {
                    App.state.isExclusive = actualOn;
                  }
                  if (el.checked !== actualOn) el.checked = actualOn;
                  if (row.onChange) row.onChange(actualOn);
                  // 同步正在播放页文字按钮
                  if (window.App && App.pages && App.pages.now_playing) {
                    App.pages.now_playing.updateAudioMode(actualOn);
                  }
                });
              });
            } else {
              App.utils.call('save_settings', JSON.stringify({ [row.bind]: checked }));
              if (row.onChange) row.onChange(checked);
            }
          };
          el.addEventListener('change', el._settingsChangeHandler);
        }
      } else if (row.type === 'text') {
        const el = document.querySelector(`input[type="text"][data-bind="${row.bind}"]`);
        if (!el) return;
        el.value = settings[row.bind] || '';
        // 避免重复绑定
        el.removeEventListener('change', el._settingsChangeHandler);
        el._settingsChangeHandler = function () {
          const val = this.value;
          App.utils.call('save_settings', JSON.stringify({ [row.bind]: val }));
          if (row.onApply) row.onApply(val);
        };
        el.addEventListener('change', el._settingsChangeHandler);
      } else if (row.type === 'device_select') {
        _bindDeviceSelectRow(row, settings[row.bind] || '');
      } else if (row.type === 'shortcut') {
        _bindShortcutRow(row, settings[row.bind] || {});
      } else if (row.type === 'slider') {
        _bindSliderRow(row, settings[row.bind]);
      } else if (row.type === 'eq') {
        _bindEqRow(row, settings[row.bind] || []);
      }
    });

    // WASAPI 独占模式：初始绑定后刷新依赖项的禁用/可见状态
    if (typeof settings.wasapi_exclusive !== 'undefined') {
      _applyWasapiExclusive(!!settings.wasapi_exclusive);
    }
  }

  // ── WASAPI 独占模式：切换依赖项状态 ────────────────────────────────────
  // 启用独占模式后，音频处理 API 选择与输出设备选择不再生效，需禁用；
  // 同时显示/隐藏「不可用功能」提示框。
  // 注意：AutoMix 在共享模式下由前端 Web Audio API 实现，不禁用。
  page.applyWasapiExclusive = function (checked) {
    _applyWasapiExclusive(checked);
  };

  function _applyWasapiExclusive(checked) {
    var notice = document.querySelector('.settings-notice[data-show-when="wasapi_exclusive"]');
    if (notice) notice.style.display = checked ? '' : 'none';

    // 独占模式下禁用音频 API 选择和输出设备选择（AutoMix 始终可用）
    var disabledBinds = ['audio_api', 'audio_output_device'];
    disabledBinds.forEach(function (b) {
      var row = document.querySelector('.settings-row[data-bind="' + b + '"]');
      if (!row) return;
      row.classList.toggle('settings-row-disabled', checked);
      // 禁用下拉触发器
      var trigger = row.querySelector('.md-dropdown-trigger');
      if (trigger) {
        if (checked) {
          trigger.setAttribute('disabled', 'disabled');
          trigger.setAttribute('aria-disabled', 'true');
        } else {
          trigger.removeAttribute('disabled');
          trigger.removeAttribute('aria-disabled');
        }
      }
    });
  }

  // ── 重启提示（用于 audio_api 等需重启生效的设置）────────────────────────
  function _promptRestart(title, body) {
    App.utils.confirmDialog({
      title: title,
      body: body,
      confirmText: _t('settings.restartConfirm'),
      cancelText: _t('settings.restartCancel'),
    }).then(function (ok) {
      if (ok && App.backend && App.backend.restart_app) {
        App.backend.restart_app();
      }
    });
  }

  function _displayShortcut(keysSpan, combo) {
    keysSpan.textContent = combo || keysSpan.parentElement.dataset.default || _t('shortcut.notSet');
    keysSpan.parentElement.classList.toggle('settings-shortcut-empty', !combo);
  }

  function _bindShortcutRow(row, shortcuts) {
    const btn = document.querySelector(`.settings-shortcut-value[data-action="${row.action}"]`);
    if (!btn) return;
    const keysSpan = btn.querySelector('.settings-shortcut-keys');
    const currentCombo = shortcuts[row.action] || '';
    _displayShortcut(keysSpan, currentCombo);

    // 避免重复绑定
    btn.removeEventListener('click', btn._shortcutClickHandler);
    btn._shortcutClickHandler = function () {
      if (btn.classList.contains('settings-shortcut-recording')) return;
      _startRecordingShortcut(btn, keysSpan, row);
    };
    btn.addEventListener('click', btn._shortcutClickHandler);
  }

  function _startRecordingShortcut(btn, keysSpan, row) {
    const originalText = keysSpan.textContent;
    btn.classList.add('settings-shortcut-recording');
    keysSpan.textContent = _t('shortcut.pressKeys');

    function onKeyDown(e) {
      e.preventDefault();
      e.stopPropagation();

      if (e.key === 'Escape') {
        finishRecording();
        _displayShortcut(keysSpan, originalText === _t('shortcut.notSet') ? '' : originalText);
        return;
      }
      if (e.key === 'Backspace' || e.key === 'Delete') {
        finishRecording();
        _saveShortcut(row.action, '');
        _displayShortcut(keysSpan, '');
        return;
      }

      // 纯修饰键按下时不结束录制，只更新预览（等用户按下非修饰键组成完整组合键）
      // 媒体键例外：它们是独立快捷键，无需修饰键
      const MOD_KEY_NAMES = ['Control', 'Alt', 'Shift', 'Meta'];
      if (MOD_KEY_NAMES.includes(e.key)) {
        const preview = App.shortcuts.formatKeyCombo(e);
        keysSpan.textContent = preview ? preview + '…' : _t('shortcut.pressKeys');
        return;
      }

      const combo = App.shortcuts.formatKeyCombo(e);
      if (!combo) return;

      finishRecording();
      _saveShortcut(row.action, combo);
      _displayShortcut(keysSpan, combo);
    }

    function onBlur() {
      finishRecording();
      _displayShortcut(keysSpan, originalText === _t('shortcut.notSet') ? '' : originalText);
    }

    function finishRecording() {
      document.removeEventListener('keydown', onKeyDown, true);
      btn.removeEventListener('blur', onBlur);
      btn.classList.remove('settings-shortcut-recording');
    }

    document.addEventListener('keydown', onKeyDown, true);
    btn.addEventListener('blur', onBlur, { once: true });
    setTimeout(() => btn.focus(), 0);
  }

  function _saveShortcut(action, combo) {
    App.utils.call('get_settings').then(function (res) {
      const settings = JSON.parse(res);
      const shortcuts = Object.assign({}, settings.shortcuts || {});
      if (combo) {
        shortcuts[action] = combo;
      } else {
        delete shortcuts[action];
      }
      App.utils.call('save_settings', JSON.stringify({ shortcuts: shortcuts })).then(function () {
        if (App.shortcuts && App.shortcuts.reload) App.shortcuts.reload();
      });
    });
  }

  // ── 设备下拉菜单绑定 ─────────────────────────────────────────────────────
  function _bindDeviceSelectRow(row, currentValue) {
    const dropdown = document.querySelector(`.md-dropdown[data-bind="${row.bind}"]`);
    if (!dropdown) return;
    const trigger = dropdown.querySelector('.md-dropdown-trigger');
    const valueEl = dropdown.querySelector('.md-dropdown-value');
    const menu = dropdown.querySelector('.md-dropdown-menu');
    const defaultLabel = valueEl.dataset.default || _t('settings.outputDevice.default');

    function updateDisplay(value, label) {
      valueEl.textContent = label || defaultLabel;
      dropdown.dataset.value = value;
    }

    function positionMenu() {
      const rect = trigger.getBoundingClientRect();
      const menuWidth = Math.max(rect.width, 260);
      const rightOffset = window.innerWidth - rect.right;
      menu.style.top = (rect.bottom + 4) + 'px';
      menu.style.right = rightOffset + 'px';
      menu.style.width = menuWidth + 'px';
    }

    function closeMenu() {
      menu.classList.remove('open');
      trigger.setAttribute('aria-expanded', 'false');
    }

    function openMenu() {
      document.querySelectorAll('.md-dropdown-menu.open').forEach(function (m) {
        if (m !== menu) {
          m.classList.remove('open');
          const t = m.parentElement.querySelector('.md-dropdown-trigger');
          if (t) t.setAttribute('aria-expanded', 'false');
        }
      });
      positionMenu();
      menu.classList.add('open');
      trigger.setAttribute('aria-expanded', 'true');
    }

    // 避免重复绑定：移除上一次的 click handler
    if (trigger._deviceSelectClickHandler) {
      trigger.removeEventListener('click', trigger._deviceSelectClickHandler);
    }
    trigger._deviceSelectClickHandler = function (e) {
      e.stopPropagation();
      if (menu.classList.contains('open')) {
        closeMenu();
      } else {
        openMenu();
      }
    };
    trigger.addEventListener('click', trigger._deviceSelectClickHandler);

    // 音频设备由原生 DLL (Zig + miniaudio) 枚举，统一走 get_audio_devices / set_output_device
    function _populateQtDevices() {
      App.utils.call('get_audio_devices').then(function (res) {
        var data = JSON.parse(res);
        var devices = data.devices || [];
        _renderDeviceMenu(devices.map(function (d) {
          return { id: d.id, label: d.name || d.description || ('Device ' + (d.index || '')) };
        }), currentValue, function (devId) {
          App.utils.call('set_output_device', devId);
          App.utils.call('save_settings', JSON.stringify({ [row.bind]: devId }));
        });
      });
    }

    function _renderDeviceMenu(devices, currentVal, onSelect) {
      menu.innerHTML = '';

      var defaultItem = document.createElement('div');
      defaultItem.className = 'md-dropdown-item' + (!currentVal ? ' selected' : '');
      defaultItem.textContent = defaultLabel;
      defaultItem.dataset.value = '';
      defaultItem.setAttribute('role', 'menuitem');
      defaultItem.addEventListener('click', function (e) {
        e.stopPropagation();
        updateDisplay('', defaultLabel);
        closeMenu();
        onSelect('');
        _refreshSelectedItem(menu, '');
      });
      menu.appendChild(defaultItem);

      devices.forEach(function (dev) {
        var item = document.createElement('div');
        item.className = 'md-dropdown-item' + (currentVal === dev.id ? ' selected' : '');
        item.textContent = dev.label;
        item.dataset.value = dev.id;
        item.setAttribute('role', 'menuitem');
        item.title = dev.label;
        item.addEventListener('click', function (e) {
          e.stopPropagation();
          updateDisplay(dev.id, dev.label);
          closeMenu();
          onSelect(dev.id);
          _refreshSelectedItem(menu, dev.id);
        });
        menu.appendChild(item);
      });

      if (!currentVal) {
        updateDisplay('', defaultLabel);
      } else {
        var match = devices.find(function (d) { return d.id === currentVal; });
        updateDisplay(currentVal, match ? match.label : defaultLabel);
      }
    }

    _populateQtDevices();
  }

  function _refreshSelectedItem(menu, value) {
    menu.querySelectorAll('.md-dropdown-item').forEach(function (item) {
      item.classList.toggle('selected', item.dataset.value === value);
    });
  }

  // ── 点击外部关闭所有设备下拉菜单 ─────────────────────────────────────────
  document.addEventListener('click', function () {
    _closeAllDropdowns();
  });

  // ── 窗口大小或布局变化时重新定位或关闭下拉菜单 ───────────────────────────
  window.addEventListener('resize', function () {
    document.querySelectorAll('.md-dropdown-menu.open').forEach(function (menu) {
      const dropdown = menu.parentElement;
      const trigger = dropdown.querySelector('.md-dropdown-trigger');
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      const menuWidth = Math.max(rect.width, 260);
      const rightOffset = window.innerWidth - rect.right;
      // 触发器已不可见或移出视口则关闭
      if (rect.top < 0 || rect.bottom > window.innerHeight || rect.right < 0 || rect.left > window.innerWidth) {
        menu.classList.remove('open');
        trigger.setAttribute('aria-expanded', 'false');
        return;
      }
      menu.style.top = (rect.bottom + 4) + 'px';
      menu.style.right = rightOffset + 'px';
      menu.style.width = menuWidth + 'px';
    });
  });

  // 监听 body class 变化（如右侧正在播放栏展开/收起），关闭所有下拉菜单
  if (typeof MutationObserver !== 'undefined') {
    const bodyObserver = new MutationObserver(function () {
      _closeAllDropdowns();
    });
    bodyObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] });
  }

  function _closeAllDropdowns() {
    document.querySelectorAll('.md-dropdown-menu.open').forEach(function (menu) {
      menu.classList.remove('open');
      const trigger = menu.parentElement.querySelector('.md-dropdown-trigger');
      if (trigger) trigger.setAttribute('aria-expanded', 'false');
    });
  }

  // ── 主题切换 ─────────────────────────────────────────────────────────────
  function _applyTheme(val) {
    if (val === 'system') {
      const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
    } else {
      document.documentElement.setAttribute('data-theme', val);
    }
    if (App.state && App.state.currentDominantRgb) {
      App.utils.applyDynamicTheme(App.state.currentDominantRgb);
    }
  }

  // ── 阻尼滑块行绑定 ──────────────────────────────────────────────
  function _bindSliderRow(row, currentValue) {
    const slider = document.querySelector(`input[type="range"][data-bind="${row.bind}"]`);
    const valueLabel = document.querySelector(`.settings-slider-value[data-bind="${row.bind}"]`);
    if (!slider) return;

    var val = parseInt(currentValue, 10);
    if (isNaN(val)) val = parseInt(row.min, 10) || 0;
    slider.value = val;
    _updateSliderUI(slider, valueLabel, val, row);

    // 避免重复绑定
    slider.removeEventListener('input', slider._sliderInputHandler);
    slider.removeEventListener('change', slider._sliderChangeHandler);

    slider._sliderInputHandler = function () {
      var v = parseInt(this.value, 10);
      _updateSliderUI(this, valueLabel, v, row);
      if (row.onChange) row.onChange(v);
    };
    slider._sliderChangeHandler = function () {
      var v = parseInt(this.value, 10);
      App.utils.call('save_settings', JSON.stringify({ [row.bind]: v }));
    };
    slider.addEventListener('input', slider._sliderInputHandler);
    slider.addEventListener('change', slider._sliderChangeHandler);
  }

  function _bindEqRow(row, bands) {
    var sliders = document.querySelectorAll('.settings-eq-slider');
    if (!sliders.length) return;
    
    sliders.forEach(function (slider) {
      var bandIdx = parseInt(slider.dataset.band, 10);
      var bandVal = Array.isArray(bands) && bandIdx < bands.length ? bands[bandIdx] : 0;
      slider.value = bandVal;
      _updateEqSliderUI(slider, bandVal);
      // 将初始频段值应用到 AudioEngine
      var ae0 = window.__audioEngine;
      if (ae0) ae0.setEqBand(bandIdx, bandVal);

      slider.removeEventListener('input', slider._eqInputHandler);
      slider.removeEventListener('change', slider._eqChangeHandler);

      slider._eqInputHandler = function () {
        var v = parseInt(this.value, 10);
        _updateEqSliderUI(this, v);
        // 实时调用 AudioEngine（每次拖动时查找，避免初始化时机问题）
        var ae = window.__audioEngine;
        if (ae) ae.setEqBand(bandIdx, v);
      };
      slider._eqChangeHandler = function () {
        // 保存所有频段值
        var allSliders = document.querySelectorAll('.settings-eq-slider');
        var newBands = [];
        allSliders.forEach(function (s) {
          newBands.push(parseInt(s.value, 10));
        });
        App.utils.call('save_settings', JSON.stringify({ eq_bands: newBands }));
      };
      slider.addEventListener('input', slider._eqInputHandler);
      slider.addEventListener('change', slider._eqChangeHandler);
    });
  }

  function _updateEqSliderUI(slider, val) {
    var min = parseFloat(slider.min) || -12;
    var max = parseFloat(slider.max) || 12;
    var pct = ((val - min) / (max - min)) * 100;
    slider.style.setProperty('--slider-val', pct + '%');
  }

  function _updateSliderUI(slider, valueLabel, val, row) {
    var unit = row.unit || '';
    if (valueLabel) valueLabel.textContent = val + unit;
    var min = parseFloat(slider.min) || 0;
    var max = parseFloat(slider.max) || 100;
    var pct = ((val - min) / (max - min)) * 100;
    slider.style.setProperty('--slider-val', pct + '%');
  }

  // ── 歌词渐进模糊 ────────────────────────────────────────────────────
  function _applyProgressiveBlur(enabled) {
    var wrap = document.getElementById('np-lyrics-wrap');
    if (wrap) {
      wrap.classList.toggle('progressive-blur', !!enabled);
    }
    // 通知 nowPlaying 重新计算模糊
    if (window.App && App.nowPlaying && App.nowPlaying.refreshProgressiveBlur) {
      App.nowPlaying.refreshProgressiveBlur(enabled);
    }
  }

  // ── 歌词居中排版 ────────────────────────────────────────────────────
  function _applyLyricsCenter(enabled) {
    if (window.App && App.nowPlaying && App.nowPlaying.refreshLyricsCenter) {
      App.nowPlaying.refreshLyricsCenter(enabled);
    }
  }

  // ── 歌词字体大小 ────────────────────────────────────────────────────
  function _applyLyricsFontSize(val) {
    if (window.App && App.nowPlaying && App.nowPlaying.refreshLyricsFontSize) {
      App.nowPlaying.refreshLyricsFontSize(val);
    }
  }

  // ── 圆形专辑图 ────────────────────────────────────────────────────
  function _applyCircularCover(enabled) {
    if (window.App && App.nowPlaying && App.nowPlaying.refreshCircularCover) {
      App.nowPlaying.refreshCircularCover(enabled);
    }
  }

  // ── 视频背景 ─────────────────────────────────────────────────────
  function _applyVideoBackground(enabled) {
    if (window.App && App.nowPlaying && App.nowPlaying.refreshVideoBackground) {
      App.nowPlaying.refreshVideoBackground(enabled);
    }
  }

  // ── 波浪进度条 ─────────────────────────────────────────────────────
  function _applyWaveProgress(enabled) {
    if (window.App && App.nowPlaying && App.nowPlaying.refreshWaveProgress) {
      App.nowPlaying.refreshWaveProgress(enabled);
    }
  }

  // ── 界面字体 ─────────────────────────────────────────────────────
  function _applyUiFont(val) {
    var root = document.documentElement;
    if (val && val.trim()) {
      root.style.setProperty('--ui-font', val.trim());
    } else {
      root.style.removeProperty('--ui-font');
    }
  }

  // ── 歌词自定义字体（立即应用）─────────────────────────────────────
  function _applyLyricsFont(val) {
    if (window.App && App.nowPlaying && App.nowPlaying.refreshLyricsFont) {
      App.nowPlaying.refreshLyricsFont(val, undefined);
    }
  }

  function _applyLyricsJpFont(val) {
    if (window.App && App.nowPlaying && App.nowPlaying.refreshLyricsFont) {
      App.nowPlaying.refreshLyricsFont(undefined, val);
    }
  }

  function _applyLyricsJpDistinct(enabled) {
    if (window.App && App.nowPlaying && App.nowPlaying.refreshLyricsJpDistinct) {
      App.nowPlaying.refreshLyricsJpDistinct(enabled);
    }
  }

  function _applyLyricsCreditFilters(val) {
    if (window.App && App.nowPlaying && App.nowPlaying.refreshLyricsCreditFilters) {
      App.nowPlaying.refreshLyricsCreditFilters(val);
    }
  }

  // ── 界面语言 ─────────────────────────────────────────────────────
  function _applyLanguage(val) {
    if (window.App && App.i18n) {
      App.i18n.init(val || 'zh-CN');
    } else {
      document.documentElement.setAttribute('lang', val || 'zh-CN');
    }
  }

  // ── 配色方案 ────────────────────────────────────────────────────
  function _applyColorScheme(val) {
    if (!window.App) return;
    App.state.colorScheme = val || 'tonal_spot';
    // 使用当前主色重新应用主题
    if (App.state.currentDominantRgb) {
      App.utils.applyDynamicTheme(App.state.currentDominantRgb, App.state.colorScheme);
    }
  }

  // ── 莫奈取色来源 ────────────────────────────────────────────────
  function _applyMonetSource(val) {
    if (!window.App) return;
    App.state.monetSource = val || 'album_cover';
    // 切换后立即刷新主题（settings_changed 也会触发，但这里提供即时反馈）
    if (val === 'system_wallpaper') {
      _refreshMonetFromSystem();
    } else if (App.state.currentDominantRgb) {
      App.utils.applyDynamicTheme(App.state.currentDominantRgb, App.state.colorScheme);
    }
  }

  function _refreshMonetFromSystem() {
    if (!window.App || !window.__electronAPI || !window.__electronAPI.invoke) {
      _monetFallback();
      return;
    }
    window.__electronAPI.invoke('get_system_accent_color').then(function (rgb) {
      if (rgb && Array.isArray(rgb) && rgb.length === 3) {
        App.state.currentDominantRgb = rgb;
        App.utils.applyDynamicTheme(rgb, App.state.colorScheme);
      } else {
        _monetFallback();
      }
    }).catch(function () {
      _monetFallback();
    });
  }

  function _monetFallback() {
    var fallback = [103, 80, 164];
    App.state.currentDominantRgb = fallback;
    App.utils.applyDynamicTheme(fallback, App.state.colorScheme);
  }

  // ── Material 下拉选择行绑定（select 类型）──────────────────────────
  function _bindSelectRow(row, currentValue) {
    var dropdown = document.querySelector('.md-dropdown[data-bind="' + row.bind + '"]');
    if (!dropdown) return;
    var trigger = dropdown.querySelector('.md-dropdown-trigger');
    var valueEl = dropdown.querySelector('.md-dropdown-value');
    var menu = dropdown.querySelector('.md-dropdown-menu');

    // 查找当前值对应的 label
    function findLabel(val) {
      var match = row.options.find(function (o) { return o.value === val; });
      return match ? match.label : (row.options[0] ? row.options[0].label : '—');
    }
    function findValue(val) {
      var match = row.options.find(function (o) { return o.value === val; });
      return match ? match.value : (row.options[0] ? row.options[0].value : '');
    }

    var currentVal = findValue(currentValue);
    valueEl.textContent = findLabel(currentVal);
    _refreshSelectedItem(menu, currentVal);

    function positionMenu() {
      var rect = trigger.getBoundingClientRect();
      var menuWidth = Math.max(rect.width, 200);
      var rightOffset = window.innerWidth - rect.right;
      menu.style.top = (rect.bottom + 4) + 'px';
      menu.style.right = rightOffset + 'px';
      menu.style.width = menuWidth + 'px';
    }
    function closeMenu() {
      menu.classList.remove('open');
      trigger.setAttribute('aria-expanded', 'false');
    }
    function openMenu() {
      document.querySelectorAll('.md-dropdown-menu.open').forEach(function (m) {
        if (m !== menu) {
          m.classList.remove('open');
          var t = m.parentElement.querySelector('.md-dropdown-trigger');
          if (t) t.setAttribute('aria-expanded', 'false');
        }
      });
      positionMenu();
      menu.classList.add('open');
      trigger.setAttribute('aria-expanded', 'true');
    }

    if (trigger._selectClickHandler) {
      trigger.removeEventListener('click', trigger._selectClickHandler);
    }
    trigger._selectClickHandler = function (e) {
      e.stopPropagation();
      if (menu.classList.contains('open')) closeMenu(); else openMenu();
    };
    trigger.addEventListener('click', trigger._selectClickHandler);

    // 绑定菜单项点击
    menu.querySelectorAll('.md-dropdown-item').forEach(function (item) {
      item.removeEventListener('click', item._selectItemClickHandler);
      item._selectItemClickHandler = function (e) {
        e.stopPropagation();
        var val = this.dataset.value;
        valueEl.textContent = findLabel(val);
        closeMenu();
        _refreshSelectedItem(menu, val);
        App.utils.call('save_settings', JSON.stringify({ [row.bind]: val }));
        if (row.onApply) row.onApply(val);
      };
      item.addEventListener('click', item._selectItemClickHandler);
    });
  }

})();
