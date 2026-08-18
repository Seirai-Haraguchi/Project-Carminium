/**
 * Carminium — 设置（普通页面，左右分栏）
 *
 * 设置以普通页面形式呈现，填满页面容器：
 * 左侧导航列出所有分类，右侧内容区显示当前分类的设置项。
 * 由 App.navigate('settings') 触发，与其他页面一致。
 * 分类：
 *   1. 外观与视觉    — 主题、配色、歌词与文字
 *   2. 音频和库      — 输出设备、歌手分隔等
 *   3. 自动化与控制  — 启动行为、快捷键
 *   4. 实验性        — 实验性功能
 *   5. 系统与内存    — 内存信息面板
 *   6. 关于          — 在右栏内嵌渲染关于页内容
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
    var sections = [
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
                { value: 'zh-CN', label: '简体中文(Simplified Chinese)' },
                { value: 'zh-TW', label: '繁體中文(Traditional Chinese,Taiwan)' },
                { value: 'ja', label: '日本語(Japanese)' },
                { value: 'en', label: 'English(English)' },
                { value: 'ru', label: 'Русский(Russian)' },
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
            {
              type: 'select',
              bind: 'np_default_view',
              label: _t('settings.npDefaultView.label'),
              sub: _t('settings.npDefaultView.sub'),
              options: [
                { value: 'side', label: _t('settings.npDefaultView.side') },
                { value: 'fullscreen', label: _t('settings.npDefaultView.fullscreen') },
              ],
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
              bind: 'hearing_protection',
              label: _t('settings.hearingProtection.label'),
              sub: _t('settings.hearingProtection.sub'),
              onChange: function (checked) {
                var ae = window.__audioEngine;
                if (ae) ae.setHearingProtection(checked);
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
            {
              type: 'toggle',
              bind: 'vbe_enabled',
              label: _t('settings.vbe.label'),
              sub: _t('settings.vbe.sub'),
              onChange: function (checked) {
                var ae = window.__audioEngine;
                if (ae) ae.setVirtualBass(checked);
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
            {
              type: 'file_picker',
              bind: 'tag_editor_path',
              label: _t('settings.tagEditorPath.label'),
              sub: _t('settings.tagEditorPath.sub'),
              placeholder: _t('settings.tagEditorPath.placeholder'),
              pickLabel: _t('settings.tagEditorPath.pick'),
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
              bind: 'radical_transitions',
              label: _t('settings.radicalTransitions.label'),
              sub: _t('settings.radicalTransitions.sub'),
              onChange: function (checked) {
                App.utils.call('set_radical_transitions', checked);
                if (checked) {
                  App.utils.call('set_automix', true);
                  var automixEl = document.querySelector('input[type="checkbox"][data-bind="automix"]');
                  if (automixEl) automixEl.checked = true;
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
        {
          titleKey: 'settings.group.setup',
          rows: [
            {
              type: 'action',
              label: _t('settings.onboarding.label'),
              sub: _t('settings.onboarding.sub'),
              buttonText: _t('settings.onboarding.action'),
              buttonIcon: 'rocket_launch',
              onAction: function () {
                if (App.onboarding && App.onboarding.restart) {
                  App.onboarding.restart();
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
      rows: [],
    },
    {
      id: 'system',
      titleKey: 'settings.section.system',
      icon: 'memory',
      groups: [
        {
          titleKey: 'settings.group.memoryOpt',
          rows: [
            {
              type: 'select',
              bind: 'memory_optimization',
              label: _t('settings.memoryOpt.label'),
              sub: _t('settings.memoryOpt.sub'),
              options: [
                { value: 'off', label: _t('settings.memoryOpt.off') },
                { value: 'normal', label: _t('settings.memoryOpt.normal') },
                { value: 'aggressive', label: _t('settings.memoryOpt.aggressive') },
              ],
              onApply: function (val) {
                _promptRestart(
                  _t('settings.memoryOpt.restartTitle'),
                  _t('settings.memoryOpt.restartBody')
                );
              },
            },
          ],
        },
        {
          titleKey: 'settings.group.memoryInfo',
          rows: [
            {
              type: 'memory_info',
              bind: '_memory_info',
            },
          ],
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

    // 调试选项卡（仅当 localStorage 中有标记时显示）
    if (_isDebugMode()) {
      sections.push(_buildDebugSection());
    }

    return sections;
  }

  // ── 调试选项卡 ─────────────────────────────────────────────────────────
  function _isDebugMode() {
    try { return sessionStorage.getItem('carminium_debug') === '1'; } catch (e) { return false; }
  }

  function _buildDebugSection() {
    var platform = (window.__electronAPI && window.__electronAPI.platform) || 'unknown';

    return {
      id: 'debug',
      titleKey: 'settings.section.debug',
      icon: 'bug_report',
      groups: [
        {
          titleKey: 'settings.debug.group.platform',
          rows: [
            {
              type: 'action',
              bind: '_debug_show_platform',
              label: _t('settings.debug.showPlatform'),
              sub: _t('settings.debug.showPlatformSub'),
              buttonText: _t('settings.debug.showBtn'),
              buttonIcon: 'info',
              onAction: function () {
                App.utils.call('get_app_info').then(function (res) {
                  var info = JSON.parse(res);
                  var d = info.diagnostic || {};
                  alert([
                    'Platform: ' + d.platform,
                    'Arch: ' + d.arch,
                    'Electron: ' + d.electron_version,
                    'Chrome: ' + d.chrome_version,
                    'Node: ' + d.node_version,
                    'App Version: ' + info.version,
                    'Codename: ' + (info.codename || 'N/A'),
                  ].join('\n'));
                });
              },
            },
            {
              type: 'action',
              bind: '_debug_toggle_traffic',
              label: _t('settings.debug.toggleTraffic'),
              sub: _t('settings.debug.toggleTrafficSub'),
              buttonText: _t('settings.debug.toggleBtn'),
              buttonIcon: 'traffic',
              onAction: function () {
                document.body.classList.toggle('platform-non-win');
                App.utils.toast(document.body.classList.contains('platform-non-win')
                  ? _t('settings.debug.trafficOn')
                  : _t('settings.debug.trafficOff'));
              },
            },
          ],
        },
        {
          titleKey: 'settings.debug.group.dialogs',
          rows: [
            {
              type: 'action',
              bind: '_debug_test_confirm',
              label: _t('settings.debug.testConfirm'),
              sub: _t('settings.debug.testConfirmSub'),
              buttonText: _t('settings.debug.testBtn'),
              buttonIcon: 'help',
              onAction: function () {
                App.utils.confirmDialog({
                  title: _t('settings.debug.testConfirm'),
                  body: _t('settings.debug.testConfirmBody'),
                  confirmText: _t('common.confirm'),
                  cancelText: _t('common.cancel'),
                }).then(function (ok) {
                  App.utils.toast(ok ? 'Confirmed' : 'Cancelled');
                });
              },
            },
            {
              type: 'action',
              bind: '_debug_test_toast',
              label: _t('settings.debug.testToast'),
              sub: _t('settings.debug.testToastSub'),
              buttonText: _t('settings.debug.testBtn'),
              buttonIcon: 'notifications',
              onAction: function () {
                App.utils.toast('Toast test - ' + new Date().toLocaleTimeString());
              },
            },
            {
              type: 'action',
              bind: '_debug_test_alert',
              label: _t('settings.debug.testAlert'),
              sub: _t('settings.debug.testAlertSub'),
              buttonText: _t('settings.debug.testBtn'),
              buttonIcon: 'warning',
              onAction: function () {
                alert(_t('settings.debug.testAlertBody'));
              },
            },
          ],
        },
        {
          titleKey: 'settings.debug.group.system',
          rows: [
            {
              type: 'action',
              bind: '_debug_ipc_devices',
              label: _t('settings.debug.listDevices'),
              sub: _t('settings.debug.listDevicesSub'),
              buttonText: _t('settings.debug.showBtn'),
              buttonIcon: 'speaker',
              onAction: function () {
                App.utils.call('get_audio_devices').then(function (res) {
                  var devices = JSON.parse(res || '[]');
                  if (!devices.length) { App.utils.toast('No devices'); return; }
                  alert(devices.map(function (d) {
                    return (d.name || d.id) + (d.index != null ? ' [index=' + d.index + ']' : '');
                  }).join('\n'));
                });
              },
            },
            {
              type: 'action',
              bind: '_debug_ipc_settings',
              label: _t('settings.debug.dumpSettings'),
              sub: _t('settings.debug.dumpSettingsSub'),
              buttonText: _t('settings.debug.showBtn'),
              buttonIcon: 'settings',
              onAction: function () {
                App.utils.call('get_settings').then(function (res) {
                  alert(JSON.stringify(JSON.parse(res), null, 2));
                });
              },
            },
            {
              type: 'action',
              bind: '_debug_reload',
              label: _t('settings.debug.reloadPage'),
              sub: _t('settings.debug.reloadPageSub'),
              buttonText: _t('settings.debug.reloadBtn'),
              buttonIcon: 'refresh',
              onAction: function () { window.location.reload(); },
            },
          ],
        },
        {
          titleKey: 'settings.debug.group.controls',
          rows: [
            {
              type: 'action',
              bind: '_debug_lock',
              label: _t('settings.debug.lockDebug'),
              sub: _t('settings.debug.lockDebugSub'),
              buttonText: _t('settings.debug.lockBtn'),
              buttonIcon: 'lock',
              onAction: function () {
                try { sessionStorage.removeItem('carminium_debug'); } catch (e) {}
                App.utils.toast(_t('settings.debug.lockedMsg'));
                setTimeout(function () { window.location.reload(); }, 1000);
              },
            },
          ],
        },
      ],
    };
  }

  // ── 普通页面渲染 ─────────────────────────────────────────────────────────
  // 设置以普通页面呈现：左侧导航 + 右侧内容，填满页面容器。
  // 由 App.navigate('settings') 触发，与其他页面一致。
  var _activeSectionId = 'appearance';

  page.render = function (container) {
    // 清理上一次渲染的资源
    if (_memoryRefreshTimer) {
      clearInterval(_memoryRefreshTimer);
      _memoryRefreshTimer = null;
    }
    page.container = container;

    _renderPageContent();

    // 加载最新设置后重新绑定当前分类
    App.utils.call('get_settings').then(function (res) {
      if (!page.container || !page.container.querySelector('#settings-nav')) return;
      _lastSettings = JSON.parse(res);
      _bindActiveSection();
    });
  };

  // 构建/重建页面内容（渲染时与语言切换时复用）
  function _renderPageContent() {
    if (!page.container) return;
    page.container.innerHTML = '' +
      '<div class="settings-page">' +
        '<nav class="settings-nav" id="settings-nav">' +
          '<div class="settings-nav-header">' +
            '<span class="settings-nav-header-title" data-i18n="page.settings.title">' + _t('page.settings.title') + '</span>' +
          '</div>' +
          _renderNavItems() +
        '</nav>' +
        '<div class="settings-content" id="settings-content"></div>' +
      '</div>';

    // 对动态插入的 DOM 应用 i18n
    if (App.i18n && App.i18n.applyToDOM) App.i18n.applyToDOM(page.container);

    _bindNav();
    _activateSection(_activeSectionId);
  }

  function _renderNavItems() {
    return _buildSections().map(function (section) {
      return '' +
        '<button class="settings-nav-item" type="button" data-section="' + section.id + '">' +
          '<span class="material-symbols-rounded settings-nav-icon">' + (section.icon || 'tune') + '</span>' +
          '<span class="settings-nav-label" data-i18n="' + section.titleKey + '">' + _t(section.titleKey) + '</span>' +
        '</button>';
    }).join('');
  }

  function _bindNav() {
    page.container.querySelectorAll('.settings-nav-item').forEach(function (item) {
      item.addEventListener('click', function () {
        _activateSection(this.dataset.section);
      });
    });
  }

  function _findSection(id) {
    var sections = _buildSections();
    for (var i = 0; i < sections.length; i++) {
      if (sections[i].id === id) return sections[i];
    }
    return null;
  }

  function _activateSection(id) {
    var section = _findSection(id);
    if (!section) return;

    _activeSectionId = id;

    // 导航高亮
    page.container.querySelectorAll('.settings-nav-item').forEach(function (item) {
      var active = item.dataset.section === id;
      item.classList.toggle('active', active);
      item.setAttribute('aria-selected', active ? 'true' : 'false');
    });

    // 右侧内容区
    var contentEl = page.container.querySelector('#settings-content');
    if (!contentEl) return;

    // 「关于」：在右栏内嵌渲染关于页内容（不跳转独立页面）
    if (section.isPage) {
      contentEl.innerHTML = '';
      if (App.pages.about && App.pages.about.renderInto) {
        App.pages.about.renderInto(contentEl);
      } else if (App.pages.about && App.pages.about.render) {
        App.pages.about.render(contentEl);
      }
      return;
    }

    contentEl.innerHTML = '' +
      '<div class="settings-section" data-section="' + section.id + '">' +
        '<div class="settings-section-body">' + _renderSectionBody(section) + '</div>' +
      '</div>';

    _bindActiveSection();
  }

  function _renderSectionBody(section) {
    return section.groups
      ? section.groups.map(_renderGroup).join('')
      : (section.rows && section.rows.length
          ? section.rows.map(_renderRow).join('')
          : _renderEmptyHint());
  }

  // 绑定当前分类的所有行（设置未加载时仅渲染占位，加载后由 get_settings 回调再次调用）
  function _bindActiveSection() {
    var section = _findSection(_activeSectionId);
    if (!section || section.isPage) return;
    if (_lastSettings) {
      _bindSectionRows(section, _lastSettings);
    }
    if (section.id === 'system') {
      _bindMemoryInfo();
    }
  }

  // ── 内存信息面板 ─────────────────────────────────────────────────────────
  var _memoryRefreshTimer = null;

  function _bindMemoryInfo() {
    var statsEl = page.container.querySelector('#memory-stats-display');
    var cleanupBtn = page.container.querySelector('#memory-cleanup-btn');
    if (!statsEl) return;

    // 立即加载一次
    _refreshMemoryStats(statsEl);

    // 定时刷新（每 5 秒）；分栏布局下切换分类会移除元素，需每次重新查询
    if (_memoryRefreshTimer) clearInterval(_memoryRefreshTimer);
    _memoryRefreshTimer = setInterval(function () {
      var el = page.container && page.container.querySelector('#memory-stats-display');
      if (el) _refreshMemoryStats(el);
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
            '<span class="material-symbols-rounded">cleaning_services</span>' +
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
    if (row.type === 'file_picker') {
      return `
        <div class="settings-row settings-row-text settings-row-file-picker" data-bind="${row.bind}">
          <div>
            <p class="settings-row-label">${row.label}</p>
            <p class="settings-row-sub">${row.sub || ''}</p>
          </div>
          <div class="settings-file-picker-control">
            <input type="text" class="settings-font-input" data-bind="${row.bind}"
                   placeholder="${row.placeholder || ''}">
            <button class="md-text-btn settings-file-picker-btn" type="button"
                    data-bind="${row.bind}">
              <span class="material-symbols-rounded">folder_open</span>
              <span>${row.pickLabel || '浏览'}</span>
            </button>
          </div>
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
    if (row.type === 'action') {
      return `
        <div class="settings-row settings-row-action" data-bind="${row.bind || '_action'}">
          <div>
            <p class="settings-row-label">${row.label}</p>
            <p class="settings-row-sub">${row.sub || ''}</p>
          </div>
          <button class="btn-outlined settings-action-btn" type="button" data-action-key="${row.bind || '_action'}">
            <span class="material-symbols-rounded">${row.buttonIcon || 'play_arrow'}</span>
            <span>${row.buttonText || ''}</span>
          </button>
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
      } else if (row.type === 'file_picker') {
        _bindFilePickerRow(row, settings[row.bind] || '');
      } else if (row.type === 'device_select') {
        _bindDeviceSelectRow(row, settings[row.bind] || '');
      } else if (row.type === 'shortcut') {
        _bindShortcutRow(row, settings[row.bind] || {});
      } else if (row.type === 'slider') {
        _bindSliderRow(row, settings[row.bind]);
      } else if (row.type === 'eq') {
        _bindEqRow(row, settings[row.bind] || []);
      } else if (row.type === 'action') {
        const btn = document.querySelector(`.settings-action-btn[data-action-key="${row.bind || '_action'}"]`);
        if (btn && row.onAction) {
          btn.removeEventListener('click', btn._actionHandler);
          btn._actionHandler = function () { row.onAction(); };
          btn.addEventListener('click', btn._actionHandler);
        }
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

  // 暴露分类切换，供 about.js 彩蛋跳转使用
  page.activateSection = function (id) {
    if (page.container) {
      _renderPageContent();
      _activateSection(id);
    } else if (App.navigate) {
      App.navigate('settings');
      setTimeout(function () { _activateSection(id); }, 200);
    }
  };

  function _applyWasapiExclusive(checked) {
    var notice = document.querySelector('.settings-notice[data-show-when="wasapi_exclusive"]');
    if (notice) notice.style.display = checked ? '' : 'none';

    // 独占模式下禁用音频 API 选择和输出设备选择（AutoMix 始终可用）
    var disabledBinds = ['audio_output_device'];
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

  // ── 重启提示（用于需重启生效的设置）────────────────────────
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

  // ── 文件选择器行绑定（用于标签编辑器等可执行文件路径）──────────────────────
  function _bindFilePickerRow(row, currentValue) {
    const rowEl = document.querySelector(`.settings-row-file-picker[data-bind="${row.bind}"]`);
    if (!rowEl) return;
    const input = rowEl.querySelector('input[type="text"]');
    const btn = rowEl.querySelector('.settings-file-picker-btn');
    if (!input || !btn) return;

    input.value = currentValue || '';

    // 文本框直接编辑（失焦或回车时保存）
    input.removeEventListener('change', input._pickerChangeHandler);
    input._pickerChangeHandler = function () {
      const val = this.value.trim();
      App.utils.call('save_settings', JSON.stringify({ [row.bind]: val }));
      if (App.state) App.state.tagEditorPath = val;
      if (row.onApply) row.onApply(val);
    };
    input.addEventListener('change', input._pickerChangeHandler);

    // 浏览按钮：弹出文件选择对话框
    btn.removeEventListener('click', btn._pickerClickHandler);
    btn._pickerClickHandler = function () {
      App.utils.call('pick_tag_editor_path').then(function (picked) {
        if (!picked) return;
        input.value = picked;
        App.utils.call('save_settings', JSON.stringify({ [row.bind]: picked }));
        if (App.state) App.state.tagEditorPath = picked;
        if (row.onApply) row.onApply(picked);
      });
    };
    btn.addEventListener('click', btn._pickerClickHandler);
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

  // 语言切换时由 app.js 统一重新渲染当前页面，无需在此额外处理

})();
