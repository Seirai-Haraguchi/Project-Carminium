(function () {
  'use strict';

  window.App = window.App || {};
  const page = {};
  window.App.pages.settings = page;

  let _lastSettings = null;

  function _t(key) { return window.App && App.i18n ? App.i18n.t(key) : key; }

  function _buildSections() {
    var sections = [
    {

      id: 'general',
      titleKey: 'settings.section.general',
      icon: 'settings',
      groups: [
        {
          titleKey: 'settings.group.language',
          rows: [
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

      id: 'appearance',
      titleKey: 'settings.section.appearance',
      icon: 'palette',
      groups: [
        {
          titleKey: 'settings.group.theme',
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
          ],
        },
        {
          titleKey: 'settings.group.nowPlaying',
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
              bind: 'show_quality',
              label: _t('settings.showQuality.label'),
              sub: _t('settings.showQuality.sub'),
              onChange: function (checked) {
                if (App.nowPlaying && App.nowPlaying.setQualityEnabled) {
                  App.nowPlaying.setQualityEnabled(checked);
                }
              },
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
            {

              type: 'np_secondary',
              bind: 'np_secondary_actions',
              label: _t('settings.npSecondary.label'),
              sub: _t('settings.npSecondary.sub'),
            },
          ],
        },
        {
          titleKey: 'settings.group.font',
          rows: [
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
      ],
    },
    {

      id: 'playback',
      titleKey: 'settings.section.playback',
      icon: 'headphones',
      groups: [
        {
          titleKey: 'settings.group.playbackBehavior',
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

          titleKey: 'settings.group.audioOutput',
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
          ],
        },
        {
          titleKey: 'settings.group.soundEffects',
          rows: [
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
              bind: 'volume_normalization',
              label: _t('settings.volumeNormalization.label'),
              sub: _t('settings.volumeNormalization.sub'),
              onChange: function (checked) {
                var ae = window.__audioEngine;
                if (ae) ae.setNormalizationEnabled(checked);
              },
            },
            {
              type: 'select',
              bind: 'volume_normalization_target',
              label: _t('settings.volumeNormalizationTarget.label'),
              sub: _t('settings.volumeNormalizationTarget.sub'),
              options: [
                { value: '-23', label: '-23 LUFS · ' + _t('settings.volumeNormalizationTarget.broadcast') },
                { value: '-18', label: '-18 LUFS · ReplayGain' },
                { value: '-16', label: '-16 LUFS · ' + _t('settings.volumeNormalizationTarget.mobile') },
                { value: '-14', label: '-14 LUFS · ' + _t('settings.volumeNormalizationTarget.streaming') },
              ],
              onApply: function (val) {
                var ae = window.__audioEngine;
                if (ae) ae.setNormalizationTarget(val);
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
      ],
    },
    {

      id: 'lyrics',
      titleKey: 'settings.section.lyrics',
      icon: 'lyrics',
      groups: [
        {
          titleKey: 'settings.group.font',
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
          ],
        },
        {
          titleKey: 'settings.group.lyricsLayout',
          rows: [
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
          ],
        },
        {
          titleKey: 'settings.group.lyricsCredit',
          rows: [
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

      id: 'shortcuts',
      titleKey: 'settings.section.shortcuts',
      icon: 'sports_esports',
      groups: [
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

      id: 'services',
      titleKey: 'settings.section.services',
      icon: 'cloud',
      groups: [
        {
          titleKey: 'settings.group.systemIntegration',
          rows: [
            {
              type: 'toggle',
              bind: 'smtc_lyrics',
              label: _t('settings.smtcLyrics.label'),
              sub: _t('settings.smtcLyrics.sub'),
            },
            {
              type: 'toggle',
              bind: 'taskbar_thumb_controls',
              label: _t('settings.thumbar.label'),
              sub: _t('settings.thumbar.sub'),
            },
          ],
        },
        {
          titleKey: 'settings.group.discordRpc',
          rows: [
            {
              type: 'toggle',
              bind: 'discord_rpc',
              label: _t('settings.discordRpc.label'),
              sub: _t('settings.discordRpc.sub'),
              onChange: function (checked) { _onDiscordRpcToggle(checked); },
            },
            {
              type: 'action',
              bind: 'discord_rpc_get_id',
              label: _t('settings.discordRpc.getId.label'),
              sub: _t('settings.discordRpc.getId.sub'),
              buttonText: _t('settings.discordRpc.getId.action'),
              buttonIcon: 'open_in_new',
              onAction: function () {
                App.utils.call('open_external', 'https://discord.com/developers/applications');
              },
            },
            {
              type: 'text',
              bind: 'discord_rpc_client_id',
              label: _t('settings.discordRpc.clientId.label'),
              sub: _t('settings.discordRpc.clientId.sub'),
              placeholder: _t('settings.discordRpc.clientId.placeholder'),
            },
            {

              type: 'discord_status',
              bind: 'discord_rpc_status',
              label: _t('settings.discordRpc.status.label'),
            },
            {
              type: 'toggle',
              bind: 'discord_rpc_show_paused',
              label: _t('settings.discordRpc.showPaused.label'),
              sub: _t('settings.discordRpc.showPaused.sub'),
            },
            {
              type: 'text',
              bind: 'discord_rpc_brief_format',
              label: _t('settings.discordRpc.briefFormat.label'),
              sub: _t('settings.discordRpc.briefFormat.sub'),
              placeholder: _t('settings.discordRpc.briefFormat.placeholder'),
            },
          ],
        },
        {
          titleKey: 'settings.group.externalApps',
          rows: [
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

      id: 'other',
      titleKey: 'settings.section.other',
      icon: 'tune',
      groups: [
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

      id: 'about',
      titleKey: 'settings.section.about',
      icon: 'info',
      isPage: true,
    },
  ];

    if (_isDebugMode()) {
      sections.push(_buildDebugSection());
    }

    return sections;
  }

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

  var _activeSectionId = 'appearance';

  page.render = function (container) {

    if (_memoryRefreshTimer) {
      clearInterval(_memoryRefreshTimer);
      _memoryRefreshTimer = null;
    }
    page.container = container;

    _renderPageContent();

    App.utils.call('get_settings').then(function (res) {
      if (!page.container || !page.container.querySelector('#settings-nav')) return;
      _lastSettings = JSON.parse(res);
      _bindActiveSection();
    });
  };

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

    if (App.i18n && App.i18n.applyToDOM) App.i18n.applyToDOM(page.container);

    _bindNav();
    _activateSection(_activeSectionId);
  }

  function _renderNavItems() {

    return '<div class="md-seglist settings-nav-list" role="tablist">' +
      _buildSections().map(function (section) {
        return '' +
          '<button class="settings-nav-item" type="button" role="tab" data-section="' + section.id + '">' +
            '<span class="material-symbols-rounded settings-nav-icon">' + (section.icon || 'tune') + '</span>' +
            '<span class="settings-nav-label" data-i18n="' + section.titleKey + '">' + _t(section.titleKey) + '</span>' +
          '</button>';
      }).join('') +
    '</div>';
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

    page.container.querySelectorAll('.settings-nav-item').forEach(function (item) {
      var active = item.dataset.section === id;
      item.classList.toggle('active', active);
      item.setAttribute('aria-selected', active ? 'true' : 'false');
    });

    var contentEl = page.container.querySelector('#settings-content');
    if (!contentEl) return;

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
      : _renderRows(section.rows || []);
  }

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

  var _memoryRefreshTimer = null;

  function _bindMemoryInfo() {
    var statsEl = page.container.querySelector('#memory-stats-display');
    var cleanupBtn = page.container.querySelector('#memory-cleanup-btn');
    if (!statsEl) return;

    _refreshMemoryStats(statsEl);

    if (_memoryRefreshTimer) clearInterval(_memoryRefreshTimer);
    _memoryRefreshTimer = setInterval(function () {
      var el = page.container && page.container.querySelector('#memory-stats-display');
      if (el) _refreshMemoryStats(el);
    }, 5000);

    if (cleanupBtn) {
      cleanupBtn.addEventListener('click', function () {
        cleanupBtn.disabled = true;
        if (window.MemoryManager) {
          window.MemoryManager.emergencyCleanup();
        }

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

    var rendererStats = window.MemoryManager ? window.MemoryManager.getStats() : null;

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

  var STANDALONE_ROW_TYPES = { eq: 1, memory_info: 1, np_secondary: 1 };

  function _renderRows(rows) {
    var html = '';
    var run = [];
    function flush() {
      if (!run.length) return;
      html += '<div class="md-seglist">' + run.join('') + '</div>';
      run = [];
    }

    rows.forEach(function (row) {
      if (STANDALONE_ROW_TYPES[row.type]) {
        flush();
        html += _renderRow(row);
        return;
      }
      run.push(_renderRow(row));
    });
    flush();

    return html;
  }

  function _renderGroup(group) {
    return '<div class="settings-group-header" data-i18n="' + group.titleKey + '">' + _t(group.titleKey) + '</div>' +
      _renderRows(group.rows);
  }

  var ROW_ICONS = {

    language: 'language',
    artist_separators: 'call_split',
    theme: 'contrast',
    color_scheme: 'palette',
    monet_source: 'wallpaper',
    ui_font: 'text_fields',
    circular_cover: 'album',
    wave_progress: 'graphic_eq',
    show_quality: 'equalizer',
    video_background: 'movie',
    np_default_view: 'view_agenda',

    wasapi_exclusive: 'speaker',
    audio_output_device: 'headphones',
    eq_enabled: 'graphic_eq',
    eq_bands: 'equalizer',
    dynamic_bass: 'piano',
    compressor_enabled: 'compress',

    volume_normalization: 'graphic_eq',
    volume_normalization_target: 'equalizer',
    hearing_protection: 'hearing',
    vocal_enhance: 'mic',
    guitar_friendly: 'music_note',
    vbe_enabled: 'auto_awesome',
    shuffle: 'shuffle',
    resume_playback: 'play_circle',
    automix: 'auto_awesome',
    radical_transitions: 'bolt',
    gapless: 'link',

    lyrics_font: 'lyrics',
    lyrics_jp_font: 'translate',
    lyrics_jp_use_distinct: 'translate',
    lyrics_progressive_blur: 'blur_on',
    lyrics_center: 'format_align_center',
    lyrics_font_size: 'format_size',
    lyrics_credit_filters: 'filter_alt',

    smtc_lyrics: 'subtitles',
    gamepad_button_layout: 'sports_esports',
    tag_editor_path: 'edit_note',

    play_pause: 'play_pause',
    next_track: 'skip_next',
    prev_track: 'skip_previous',
    volume_up: 'volume_up',
    volume_down: 'volume_down',
    toggle_like: 'favorite',
    toggle_mute: 'volume_off',

    memory_optimization: 'memory',
    _debug_show_platform: 'memory',
    _debug_toggle_traffic: 'api',
    _debug_test_confirm: 'help',
    _debug_test_toast: 'notifications',
    _debug_test_alert: 'warning',
    _debug_ipc_devices: 'speaker',
    _debug_ipc_settings: 'settings',
    _debug_reload: 'refresh',
    _debug_lock: 'lock',
  };

  function _rowIcon(row) {
    if (row.icon) return row.icon;
    if (row.type === 'shortcut' && row.action) return ROW_ICONS[row.action] || '';
    return ROW_ICONS[row.bind] || '';
  }

  function _rowIconHtml(row) {
    return '';
  }

  function _rowHeadingHtml(row) {
    return '<p class="settings-row-label">' + row.label + '</p>' +
      (row.sub ? '<p class="settings-row-sub">' + row.sub + '</p>' : '');
  }

  function _rowBodyHtml(row, innerHtml) {
    var inner = innerHtml || '';
    if (row.type === 'text' || row.type === 'file_picker') {
      return '<div class="settings-row-body">' +
        '<div class="settings-row-heading">' + _rowHeadingHtml(row) + '</div>' +
        inner +
      '</div>';
    }
    return '<div class="settings-row-body">' + _rowHeadingHtml(row) + inner + '</div>';
  }

  function _renderRow(row) {
    if (row.type === 'memory_info') {
      return '' +
        '<div class="settings-row settings-row-full settings-memory-info" data-bind="' + row.bind + '">' +
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
      var optsHtml = row.options.map(function (o) {
        return '<div class="md-dropdown-item" data-value="' + o.value + '" role="menuitem">' + o.label + '</div>';
      }).join('');
      return `
        <div class="settings-row" data-bind="${row.bind}">
          ${_rowIconHtml(row)}
          ${_rowBodyHtml(row)}
          <div class="settings-row-trailing">
            <div class="md-dropdown md-select-dropdown" data-bind="${row.bind}">
              <button class="md-dropdown-trigger" type="button" aria-haspopup="true" aria-expanded="false">
                <span class="md-dropdown-value">—</span>
                <span class="material-symbols-rounded md-dropdown-arrow">arrow_drop_down</span>
              </button>
              <div class="md-dropdown-menu" role="menu">${optsHtml}</div>
            </div>
          </div>
        </div>
      `;
    }
    if (row.type === 'toggle') {
      const disabledAttr = row.disabled ? 'disabled' : '';
      return `
        <div class="settings-row" data-bind="${row.bind}">
          ${_rowIconHtml(row)}
          ${_rowBodyHtml(row)}
          <div class="settings-row-trailing">
            <label class="toggle">
              <input type="checkbox" data-bind="${row.bind}" ${disabledAttr}>
              <div class="toggle-track"></div>
              <div class="toggle-thumb"></div>
            </label>
          </div>
        </div>
      `;
    }
    if (row.type === 'text') {
      var textInputHtml = '<input type="text" class="settings-font-input" data-bind="' + row.bind +
        '" placeholder="' + (row.placeholder || '') + '">';
      return `
        <div class="settings-row settings-row-text" data-bind="${row.bind}">
          ${_rowIconHtml(row)}
          ${_rowBodyHtml(row, textInputHtml)}
        </div>
      `;
    }
    if (row.type === 'file_picker') {
      var pickerHtml = '<div class="settings-file-picker-control">' +
        '<input type="text" class="settings-font-input" data-bind="' + row.bind +
          '" placeholder="' + (row.placeholder || '') + '">' +
        '<button class="md-text-btn settings-file-picker-btn" type="button" data-bind="' + row.bind + '">' +
          '<span class="material-symbols-rounded">folder_open</span>' +
          '<span>' + (row.pickLabel || '浏览') + '</span>' +
        '</button>' +
      '</div>';
      return `
        <div class="settings-row settings-row-text settings-row-file-picker" data-bind="${row.bind}">
          ${_rowIconHtml(row)}
          ${_rowBodyHtml(row, pickerHtml)}
        </div>
      `;
    }
    if (row.type === 'device_select') {
      const defaultLabel = App.utils.esc(row.placeholder || _t('settings.outputDevice.default'));
      return `
        <div class="settings-row" data-bind="${row.bind}">
          ${_rowIconHtml(row)}
          ${_rowBodyHtml(row)}
          <div class="settings-row-trailing">
            <div class="md-dropdown" data-bind="${row.bind}">
              <button class="md-dropdown-trigger" type="button" aria-haspopup="true" aria-expanded="false">
                <span class="md-dropdown-value" data-default="${defaultLabel}">${defaultLabel}</span>
                <span class="material-symbols-rounded md-dropdown-arrow">arrow_drop_down</span>
              </button>
              <div class="md-dropdown-menu" role="menu"></div>
            </div>
          </div>
        </div>
      `;
    }
    if (row.type === 'shortcut') {
      return `
        <div class="settings-row settings-row-shortcut" data-bind="${row.bind}" data-action="${row.action}">
          ${_rowIconHtml(row)}
          ${_rowBodyHtml(row)}
          <div class="settings-row-trailing">
            <button class="settings-shortcut-value" type="button" data-action="${row.action}" data-default="${_t('shortcut.notSet')}">
              <span class="settings-shortcut-keys">${_t('shortcut.notSet')}</span>
              <span class="material-symbols-rounded settings-shortcut-edit">edit</span>
            </button>
          </div>
        </div>
      `;
    }
    if (row.type === 'slider') {
      return `
        <div class="settings-row settings-row-slider" data-bind="${row.bind}">
          ${_rowIconHtml(row)}
          ${_rowBodyHtml(row)}
          <div class="settings-row-trailing">
            <div class="settings-slider-control">
              <input type="range" class="settings-slider" data-bind="${row.bind}"
                     min="${row.min}" max="${row.max}" step="${row.step || 1}">
              <span class="settings-slider-value" data-bind="${row.bind}">${row.min}</span>
            </div>
          </div>
        </div>
      `;
    }
    if (row.type === 'eq') {
      var eqFreqLabels = ['25', '40', '63', '100', '160', '250', '400', '630', '1k', '1.6k', '2.5k', '4k', '6.3k', '10k', '16k', '20k'];
      var slidersHtml = eqFreqLabels.map(function (label, i) {
        return `
          <div class="settings-eq-band">
            <span class="settings-eq-band-value" data-band="${i}">0</span>
            <div class="settings-eq-slider-wrap">
              <input type="range" class="settings-eq-slider" data-band="${i}" min="-12" max="12" step="1">
            </div>
            <span class="settings-eq-band-label">${label}</span>
          </div>
        `;
      }).join('');
      return `
        <div class="settings-row-full settings-eq-fullwidth" data-bind="${row.bind}">
          <div class="settings-eq-bands">
            ${slidersHtml}
          </div>
        </div>
      `;
    }
    if (row.type === 'discord_status') {

      return `
        <div class="settings-row" data-bind="${row.bind}">
          ${_rowIconHtml(row)}
          <div class="settings-row-body">
            <p class="settings-row-label">${row.label}</p>
            <p class="settings-row-sub" id="discord-rpc-status-text">${_t('common.loading')}</p>
          </div>
          <div class="settings-row-trailing">
            <span class="settings-discord-dot" id="discord-rpc-status-dot" data-state="disabled"></span>
          </div>
        </div>
      `;
    }
    if (row.type === 'action') {
      return `
        <div class="settings-row settings-row-action" data-bind="${row.bind || '_action'}">
          ${_rowIconHtml(row)}
          ${_rowBodyHtml(row)}
          <div class="settings-row-trailing">
            <button class="btn-outlined settings-action-btn" type="button" data-action-key="${row.bind || '_action'}">
              <span class="material-symbols-rounded">${row.buttonIcon || 'play_arrow'}</span>
              <span>${row.buttonText || ''}</span>
            </button>
          </div>
        </div>
      `;
    }
    if (row.type === 'np_secondary') {

      return `
        <div class="settings-row-full settings-np-secondary" data-bind="${row.bind}">
          <div class="settings-np-secondary-head">
            <p class="settings-row-label">${row.label}</p>
            <p class="settings-row-sub">${row.sub}</p>
          </div>
          <div class="settings-np-secondary-chips" id="np-secondary-chips"></div>
          <div class="settings-np-secondary-foot">
            <span class="settings-np-secondary-count" id="np-secondary-count"></span>
            <button class="btn-outlined settings-action-btn" type="button" id="np-secondary-edit-btn">
              <span class="material-symbols-rounded">edit</span>
              <span>${_t('settings.npSecondary.edit')}</span>
            </button>
          </div>
        </div>
      `;
    }
    return '';
  }

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

              var prevChecked = !checked;
              App.utils.confirmExclusiveSwitch(checked).then(function (ok) {
                if (!ok) {
                  if (el.checked !== prevChecked) el.checked = prevChecked;
                  return;
                }
                App.utils.call('set_wasapi_exclusive', checked).then(function (actual) {
                  var actualOn = (actual === 'wasapi_exclusive');

                  if (window.App && App.state) {
                    App.state.isExclusive = actualOn;
                  }
                  if (el.checked !== actualOn) el.checked = actualOn;
                  if (row.onChange) row.onChange(actualOn);

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
      } else if (row.type === 'np_secondary') {
        _bindNpSecondaryRow(row, settings[row.bind]);
      } else if (row.type === 'discord_status') {
        _bindDiscordStatusRow();
      } else if (row.type === 'action') {
        const btn = document.querySelector(`.settings-action-btn[data-action-key="${row.bind || '_action'}"]`);
        if (btn && row.onAction) {
          btn.removeEventListener('click', btn._actionHandler);
          btn._actionHandler = function () { row.onAction(); };
          btn.addEventListener('click', btn._actionHandler);
        }
      }
    });

    if (typeof settings.wasapi_exclusive !== 'undefined') {
      _applyWasapiExclusive(!!settings.wasapi_exclusive);
    }
  }

  function _renderDiscordStatus(status) {
    if (!page.container) return;
    var textEl = page.container.querySelector('#discord-rpc-status-text');
    var dotEl = page.container.querySelector('#discord-rpc-status-dot');
    if (!textEl || !dotEl) return;
    var state = (status && status.state) || 'disabled';
    var text;
    if (state === 'connected') {
      var name = (status && status.username) || '';
      text = _t('settings.discordRpc.status.connected').replace('{name}', name);

      if (!name) text = text.replace(/[：:]\s*$/, '');
    } else if (state === 'connecting') {
      text = _t('settings.discordRpc.status.connecting');
    } else if (state === 'disabled') {
      text = _t('settings.discordRpc.status.disabled');
    } else {
      text = _t('settings.discordRpc.status.disconnected');
    }
    textEl.textContent = text;
    dotEl.setAttribute('data-state', state);
  }

  function _bindDiscordStatusRow() {
    App.utils.call('discord_rpc_status').then(function (res) {
      _renderDiscordStatus(res);
    }).catch(function () {  });
  }

  function _onDiscordRpcToggle(checked) {
    if (!checked) return;
    var clientId = (_lastSettings && _lastSettings.discord_rpc_client_id) || '';
    if (!String(clientId).trim()) {
      App.utils.toast(_t('settings.discordRpc.needClientId'));
    }
  }

  if (window.__bridge && window.__bridge.on) {
    window.__bridge.on('discord_status', function (payload) {
      _renderDiscordStatus(payload);
    });
  }

  var NP_SECONDARY_MAX = 5;
  var NP_SECONDARY_DEFAULT = ['shuffle', 'repeat', 'like', 'audio_mode'];
  var NP_SECONDARY_CANDIDATES = [
    { id: 'shuffle', icon: 'shuffle', labelKey: 'settings.npSecondary.shuffle' },
    { id: 'repeat', icon: 'repeat', labelKey: 'settings.npSecondary.repeat' },
    { id: 'like', icon: 'favorite', labelKey: 'settings.npSecondary.like' },
    { id: 'audio_mode', icon: 'speaker', labelKey: 'settings.npSecondary.audioMode' },
    { id: 'seek_back_5', icon: 'replay', labelKey: 'settings.npSecondary.seekBack5', rotate: true },
    { id: 'seek_fwd_5', icon: 'forward', labelKey: 'settings.npSecondary.seekFwd5' },
    { id: 'seek_back_30', icon: 'replay', labelKey: 'settings.npSecondary.seekBack30', rotate: true },
    { id: 'seek_fwd_30', icon: 'forward', labelKey: 'settings.npSecondary.seekFwd30' },
    { id: 'audio_settings', icon: 'graphic_eq', labelKey: 'settings.npSecondary.audioSettings' },
    { id: 'mute', icon: 'volume_up', labelKey: 'settings.npSecondary.mute' },
    { id: 'floating', icon: 'picture_in_picture', labelKey: 'settings.npSecondary.floating' },
    { id: 'fullscreen', icon: 'fullscreen', labelKey: 'settings.npSecondary.fullscreen' },
  ];
  function _npCandidate(id) {
    for (var i = 0; i < NP_SECONDARY_CANDIDATES.length; i++) {
      if (NP_SECONDARY_CANDIDATES[i].id === id) return NP_SECONDARY_CANDIDATES[i];
    }
    return null;
  }
  function _npNormalize(list) {
    var out = [], seen = {};
    (Array.isArray(list) ? list : []).forEach(function (id) {
      if (!_npCandidate(id) || seen[id]) return;
      if (out.length >= NP_SECONDARY_MAX) return;
      seen[id] = 1; out.push(id);
    });
    return out;
  }

  function _npCurrentList() {
    var raw = (_lastSettings && _lastSettings.np_secondary_actions) || [];
    var norm = _npNormalize(raw);
    return norm.length ? norm : NP_SECONDARY_DEFAULT.slice();
  }

  function _npChipHtml(id) {
    var c = _npCandidate(id);
    var label = _t(c.labelKey);
    var iconStyle = c.rotate ? ' style="transform:rotate(180deg)"' : '';
    return '<span class="md-chip settings-np-chip" data-id="' + id + '">' +
      '<span class="material-symbols-rounded"' + iconStyle + '>' + c.icon + '</span>' +
      '<span class="settings-np-chip-label">' + label + '</span>' +
    '</span>';
  }

  function _npRefreshCard() {
    var chipsEl = page.container && page.container.querySelector('#np-secondary-chips');
    var countEl = page.container && page.container.querySelector('#np-secondary-count');
    if (!chipsEl) return;
    var list = _npCurrentList();
    chipsEl.innerHTML = list.map(function (id) { return _npChipHtml(id); }).join('');
    if (countEl) {
      countEl.textContent = _t('settings.npSecondary.count')
        .replace('{n}', String(list.length)).replace('{max}', String(NP_SECONDARY_MAX));
    }
  }

  function _bindNpSecondaryRow(row, value) {
    _npRefreshCard();
    var editBtn = page.container && page.container.querySelector('#np-secondary-edit-btn');
    if (editBtn) {
      editBtn.removeEventListener('click', editBtn._npHandler);
      editBtn._npHandler = function () { _openNpSecondaryEditor(); };
      editBtn.addEventListener('click', editBtn._npHandler);
    }
  }

  var _npEditorEl = null;
  function _closeNpEditor() {
    if (!_npEditorEl) return;
    var el = _npEditorEl;
    _npEditorEl = null;
    el.classList.remove('open');
    el.classList.add('closing');

    el.style.pointerEvents = 'none';
    document.removeEventListener('keydown', el._keyHandler);
    setTimeout(function () {
      if (el.parentNode) el.parentNode.removeChild(el);
    }, 200);
  }

  function _openNpSecondaryEditor() {
    if (_npEditorEl) return;
    var selected = _npCurrentList().slice();

    var overlay = document.createElement('div');
    overlay.className = 'cmd-dialog-overlay';
    overlay.innerHTML =
      '<div class="cmd-dialog np-actions-editor">' +
        '<div class="cmd-dialog-title">' + _t('settings.npSecondary.title') + '</div>' +
        '<div class="cmd-dialog-body np-actions-editor-body">' +
          '<p class="np-actions-editor-hint">' + _t('settings.npSecondary.hint')
            .replace('{max}', String(NP_SECONDARY_MAX)) + '</p>' +
          '<div class="np-actions-editor-grid md-seglist" id="np-actions-editor-grid"></div>' +
        '</div>' +
        '<div class="cmd-dialog-actions np-actions-editor-actions">' +
          '<span class="np-actions-editor-count" id="np-actions-editor-count"></span>' +
          '<button class="cmd-dialog-btn np-actions-editor-reset" type="button" id="np-actions-editor-reset">' +
            _t('settings.npSecondary.reset') + '</button>' +
          '<button class="cmd-dialog-btn np-actions-editor-cancel" type="button" id="np-actions-editor-cancel">' +
            _t('common.cancel') + '</button>' +
          '<button class="cmd-dialog-btn cmd-dialog-btn--confirm" type="button" id="np-actions-editor-save">' +
            _t('common.save') + '</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);
    _npEditorEl = overlay;
    requestAnimationFrame(function () { overlay.classList.add('open'); });

    var gridEl = overlay.querySelector('#np-actions-editor-grid');
    var countEl = overlay.querySelector('#np-actions-editor-count');

    function renderGrid() {
      gridEl.innerHTML = NP_SECONDARY_CANDIDATES.map(function (c) {
        var on = selected.indexOf(c.id) !== -1;
        var atMax = selected.length >= NP_SECONDARY_MAX;
        var disabled = !on && atMax;
        var iconStyle = c.rotate ? ' style="transform:rotate(180deg)"' : '';
        return '<button class="settings-row np-actions-editor-item' + (on ? ' selected' : '') +
          (disabled ? ' disabled' : '') + '" type="button" data-id="' + c.id +
          '" role="option" aria-selected="' + (on ? 'true' : 'false') + '"' +
          (disabled ? ' aria-disabled="true"' : '') + '>' +
          '<span class="material-symbols-rounded settings-row-icon np-actions-editor-item-icon"' + iconStyle + '>' + c.icon + '</span>' +
          '<span class="settings-row-body"><span class="settings-row-label np-actions-editor-item-label">' + _t(c.labelKey) + '</span></span>' +
          '<span class="settings-row-trailing np-actions-editor-check">' +
            '<span class="material-symbols-rounded">' + (on ? 'check_circle' : 'circle') + '</span>' +
          '</span>' +
        '</button>';
      }).join('');
      countEl.textContent = selected.length + ' / ' + NP_SECONDARY_MAX;
    }

    gridEl.addEventListener('click', function (e) {
      var item = e.target.closest('.np-actions-editor-item');
      if (!item) return;
      var id = item.dataset.id;
      var idx = selected.indexOf(id);
      if (idx !== -1) {
        selected.splice(idx, 1);
      } else {

        if (selected.length >= NP_SECONDARY_MAX) {
          App.utils.toast(_t('settings.npSecondary.limit'));
          return;
        }
        selected.push(id);
      }
      renderGrid();
    });

    overlay.querySelector('#np-actions-editor-reset').addEventListener('click', function () {
      selected = NP_SECONDARY_DEFAULT.slice();
      renderGrid();
    });

    overlay.querySelector('#np-actions-editor-save').addEventListener('click', function () {
      App.utils.call('save_settings', JSON.stringify({ np_secondary_actions: selected }));

      if (_lastSettings) _lastSettings.np_secondary_actions = selected.slice();
      _npRefreshCard();
      if (App.nowPlaying && App.nowPlaying.renderSecondaryActions) {
        App.nowPlaying.renderSecondaryActions(selected);
      }
      _closeNpEditor();
    });

    overlay.querySelector('#np-actions-editor-cancel').addEventListener('click', _closeNpEditor);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) _closeNpEditor(); });
    overlay._keyHandler = function (e) { if (e.key === 'Escape') _closeNpEditor(); };
    document.addEventListener('keydown', overlay._keyHandler);

    renderGrid();
  }

  page.applyWasapiExclusive = function (checked) {
    _applyWasapiExclusive(checked);
  };

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

    var disabledBinds = ['audio_output_device'];
    disabledBinds.forEach(function (b) {
      var row = document.querySelector('.settings-row[data-bind="' + b + '"]');
      if (!row) return;
      row.classList.toggle('settings-row-disabled', checked);

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

  function _bindFilePickerRow(row, currentValue) {
    const rowEl = document.querySelector(`.settings-row-file-picker[data-bind="${row.bind}"]`);
    if (!rowEl) return;
    const input = rowEl.querySelector('input[type="text"]');
    const btn = rowEl.querySelector('.settings-file-picker-btn');
    if (!input || !btn) return;

    input.value = currentValue || '';

    input.removeEventListener('change', input._pickerChangeHandler);
    input._pickerChangeHandler = function () {
      const val = this.value.trim();
      App.utils.call('save_settings', JSON.stringify({ [row.bind]: val }));
      if (App.state) App.state.tagEditorPath = val;
      if (row.onApply) row.onApply(val);
    };
    input.addEventListener('change', input._pickerChangeHandler);

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
      var rect = trigger.getBoundingClientRect();
      var rightOffset = window.innerWidth - rect.right;
      menu.style.top = rect.bottom + 'px';
      menu.style.right = rightOffset + 'px';
      menu.style.width = rect.width + 'px';
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

  document.addEventListener('click', function () {
    _closeAllDropdowns();
  });

  window.addEventListener('resize', function () {
    document.querySelectorAll('.md-dropdown-menu.open').forEach(function (menu) {
      const dropdown = menu.parentElement;
      const trigger = dropdown.querySelector('.md-dropdown-trigger');
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      const rightOffset = window.innerWidth - rect.right;

      if (rect.top < 0 || rect.bottom > window.innerHeight || rect.right < 0 || rect.left > window.innerWidth) {
        menu.classList.remove('open');
        trigger.setAttribute('aria-expanded', 'false');
        return;
      }
      menu.style.top = rect.bottom + 'px';
      menu.style.right = rightOffset + 'px';
      menu.style.width = rect.width + 'px';
    });
  });

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

  function _bindSliderRow(row, currentValue) {
    const slider = document.querySelector(`input[type="range"][data-bind="${row.bind}"]`);
    const valueLabel = document.querySelector(`.settings-slider-value[data-bind="${row.bind}"]`);
    if (!slider) return;

    var val = parseInt(currentValue, 10);
    if (isNaN(val)) val = parseInt(row.min, 10) || 0;
    slider.value = val;
    _updateSliderUI(slider, valueLabel, val, row);

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

      var ae0 = window.__audioEngine;
      if (ae0) ae0.setEqBand(bandIdx, bandVal);

      slider.removeEventListener('input', slider._eqInputHandler);
      slider.removeEventListener('change', slider._eqChangeHandler);

      slider._eqInputHandler = function () {
        var v = parseInt(this.value, 10);
        _updateEqSliderUI(this, v);

        var ae = window.__audioEngine;
        if (ae) ae.setEqBand(bandIdx, v);
      };
      slider._eqChangeHandler = function () {

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

    var band = slider.closest ? slider.closest('.settings-eq-band') : null;
    var valueEl = band ? band.querySelector('.settings-eq-band-value') : null;
    if (valueEl) {
      valueEl.textContent = (val > 0 ? '+' : '') + val;
      valueEl.dataset.zero = val === 0 ? 'true' : 'false';
    }
  }

  function _updateSliderUI(slider, valueLabel, val, row) {
    var unit = row.unit || '';
    if (valueLabel) valueLabel.textContent = val + unit;
    var min = parseFloat(slider.min) || 0;
    var max = parseFloat(slider.max) || 100;
    var pct = ((val - min) / (max - min)) * 100;
    slider.style.setProperty('--slider-val', pct + '%');
  }

  function _applyProgressiveBlur(enabled) {
    var wrap = document.getElementById('np-lyrics-wrap');
    if (wrap) {
      wrap.classList.toggle('progressive-blur', !!enabled);
    }

    if (window.App && App.nowPlaying && App.nowPlaying.refreshProgressiveBlur) {
      App.nowPlaying.refreshProgressiveBlur(enabled);
    }
  }

  function _applyLyricsCenter(enabled) {
    if (window.App && App.nowPlaying && App.nowPlaying.refreshLyricsCenter) {
      App.nowPlaying.refreshLyricsCenter(enabled);
    }
  }

  function _applyLyricsFontSize(val) {
    if (window.App && App.nowPlaying && App.nowPlaying.refreshLyricsFontSize) {
      App.nowPlaying.refreshLyricsFontSize(val);
    }
  }

  function _applyCircularCover(enabled) {
    if (window.App && App.nowPlaying && App.nowPlaying.refreshCircularCover) {
      App.nowPlaying.refreshCircularCover(enabled);
    }
  }

  function _applyVideoBackground(enabled) {
    if (window.App && App.nowPlaying && App.nowPlaying.refreshVideoBackground) {
      App.nowPlaying.refreshVideoBackground(enabled);
    }
  }

  function _applyWaveProgress(enabled) {
    if (window.App && App.nowPlaying && App.nowPlaying.refreshWaveProgress) {
      App.nowPlaying.refreshWaveProgress(enabled);
    }
  }

  function _applyUiFont(val) {
    var root = document.documentElement;
    if (val && val.trim()) {
      root.style.setProperty('--ui-font', val.trim());
    } else {
      root.style.removeProperty('--ui-font');
    }
  }

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

  function _applyLanguage(val) {
    if (window.App && App.i18n) {
      App.i18n.init(val || 'zh-CN');
    } else {
      document.documentElement.setAttribute('lang', val || 'zh-CN');
    }
  }

  function _applyColorScheme(val) {
    if (!window.App) return;
    App.state.colorScheme = val || 'tonal_spot';

    if (App.state.currentDominantRgb) {
      App.utils.applyDynamicTheme(App.state.currentDominantRgb, App.state.colorScheme);
    }
  }

  function _applyMonetSource(val) {
    if (!window.App) return;
    App.state.monetSource = val || 'album_cover';

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

  function _bindSelectRow(row, currentValue) {
    var dropdown = document.querySelector('.md-dropdown[data-bind="' + row.bind + '"]');
    if (!dropdown) return;
    var trigger = dropdown.querySelector('.md-dropdown-trigger');
    var valueEl = dropdown.querySelector('.md-dropdown-value');
    var menu = dropdown.querySelector('.md-dropdown-menu');

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
      var rightOffset = window.innerWidth - rect.right;
      menu.style.top = rect.bottom + 'px';
      menu.style.right = rightOffset + 'px';
      menu.style.width = rect.width + 'px';
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
