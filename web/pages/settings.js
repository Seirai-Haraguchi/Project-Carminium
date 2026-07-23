/**
 * Carminium — 设置页（Pivot 选项卡布局）
 *
 * 顶部标题 + 水平选项卡栏，点击选项卡切换内容区。
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

  let _currentSectionId = 'appearance';
  let _lastSettings = null;

  // ── 分类定义 ─────────────────────────────────────────────────────────────
  // 每个分类对应一个设置入口；rows 是该分类下的设置项。
  // type: 'select' | 'toggle' | 'text' | 'device_select'
  // bind: settings.json 里的字段名
  const SECTIONS = [
    {
      id: 'appearance',
      title: '外观与视觉',
      sub: '主题、播放界面、歌词与文字',
      icon: 'palette',
      groups: [
        {
          title: '全局',
          rows: [
            {
              type: 'select',
              bind: 'theme',
              label: '深色模式',
              sub: '跟随系统或强制指定应用主题',
              options: [
                { value: 'system', label: '跟随系统' },
                { value: 'light', label: '浅色模式' },
                { value: 'dark', label: '深色模式' },
              ],
              onApply: function (val) { _applyTheme(val); },
            },
            {
              type: 'select',
              bind: 'color_scheme',
              label: '配色方案',
              sub: '从封面提取主色时的调色板生成策略',
              options: [
                { value: 'tonal_spot', label: '调性点染' },
                { value: 'fidelity', label: '本色求真' },
                { value: 'monochrome', label: '水墨 monochrome' },
                { value: 'neutral', label: '中和淡雅' },
                { value: 'vibrant', label: '鲜明生动' },
                { value: 'expressive', label: '恣意挥洒' },
                { value: 'content', label: '内容取色' },
                { value: 'rainbow', label: '虹彩纷呈' },
                { value: 'fruit_salad', label: '果色缤纷' },
              ],
              onApply: function (val) { _applyColorScheme(val); },
            },
            {
              type: 'text',
              bind: 'ui_font',
              label: '界面字体',
              sub: '自定义应用界面字体族，逗号分隔的 fallback 顺序，留空使用默认',
              placeholder: 'Google Sans Flex, Noto Sans SC, sans-serif',
              onApply: function (val) { _applyUiFont(val); },
            },
          ],
        },
        {
          title: '播放',
          rows: [
            {
              type: 'toggle',
              bind: 'circular_cover',
              label: '圆形专辑图',
              sub: '播放界面中的专辑图以圆形显示',
              onChange: function (checked) { _applyCircularCover(checked); },
            },
            {
              type: 'toggle',
              bind: 'wave_progress',
              label: '波浪进度条',
              sub: '开启时进度条以波浪形态流动，关闭则为平面进度条（其实波浪进度条感觉看着挺像某个碱性乳白色液体里面的某个成分的说）',
              onChange: function (checked) { _applyWaveProgress(checked); },
            },
          ],
        },
        {
          title: '歌词',
          rows: [
            {
              type: 'text',
              bind: 'lyrics_font',
              label: '标准歌词字体',
              sub: '逗号分隔的 fallback 顺序，例如 \'Google Sans Flex, Noto Sans SC, sans-serif\'',
              placeholder: 'Google Sans Flex, Noto Sans SC, sans-serif',
            },
            {
              type: 'text',
              bind: 'lyrics_jp_font',
              label: '日文歌词字体',
              sub: '检测到假名时启用，例如 \'Yu Gothic UI, Hiragino Kaku Gothic ProN, Meiryo, sans-serif\'',
              placeholder: 'Yu Gothic UI, Hiragino Kaku Gothic ProN, Meiryo, sans-serif',
            },
            {
              type: 'toggle',
              bind: 'lyrics_jp_use_distinct',
              label: '日文歌词独立字体',
              sub: '检测到日文歌词时切换到独立字体（关闭则始终使用标准字体）',
            },
            {
              type: 'toggle',
              bind: 'lyrics_progressive_blur',
              label: '歌词渐进模糊',
              sub: '离当前播放行越远的歌词越模糊，当前行完全清晰',
              onChange: function (checked) { _applyProgressiveBlur(checked); },
            },
            {
              type: 'toggle',
              bind: 'lyrics_center',
              label: '歌词居中排版',
              sub: '歌词文字居中显示，关闭则左对齐',
              onChange: function (checked) { _applyLyricsCenter(checked); },
            },
            {
              type: 'slider',
              bind: 'lyrics_font_size',
              label: '歌词字体大小',
              sub: '调整歌词文字大小',
              min: 12,
              max: 28,
              step: 1,
              unit: 'px',
              onChange: function (val) { _applyLyricsFontSize(val); },
            },
          ],
        },
      ],
    },
    {
      id: 'audio_library',
      title: '音频和库',
      sub: '输出设备、歌手分隔与元数据',
      icon: 'headphones',
      groups: [
        {
          title: '音频',
          rows: [
            {
              type: 'toggle',
              bind: 'wasapi_exclusive',
              label: 'WASAPI 独占模式',
              sub: '绕过 Windows 音频引擎直接占用设备播放，更低延迟、位完美输出。即时切换，无需重启',
              hotToggle: 'wasapi_exclusive',
              onChange: function (actualOn) { _applyWasapiExclusive(actualOn); },
            },
            {
              type: 'notice',
              bind: 'wasapi_exclusive_notice',
              showWhen: 'wasapi_exclusive',
              icon: 'priority_high',
              title: '独占模式下不可用的功能',
              items: [
                '播放中切换输出设备（需先关闭独占模式再切换）',
                '音频处理 API 选择（独占模式绕过 Windows 音频引擎，此选项不生效）',
                'Windows 音量合成器对本应用单独音量的控制（音量仍可在应用内调节）',
                '其他应用同时发声（设备被本进程独占）',
              ],
            },
            {
              type: 'select',
              bind: 'audio_api',
              label: '音频处理 API',
              sub: '更改后需要重启应用生效',
              options: [
                { value: 'wasapi', label: 'WASAPI' },
                { value: 'directsound', label: 'DirectSound' },
                { value: 'waveout', label: 'WaveOut' },
              ],
              onApply: function (val) { _promptRestart('音频处理 API', '切换音频处理 API 需要重启应用才能生效，是否立即重启？'); },
            },
            {
              type: 'device_select',
              bind: 'audio_output_device',
              label: '输出设备',
              sub: '选择当前使用的音频播放设备',
              placeholder: '系统默认设备',
            },
          ],
        },
        {
          title: '音乐库',
          rows: [
            {
              type: 'text',
              bind: 'artist_separators',
              label: '歌手分隔符',
              sub: '每个字符均为一个分隔符；同时自动识别 feat. / ft. / vs. / with',
              placeholder: ';',
              onApply: function () { App.refreshLibraryCache(); },
            },
          ],
        },
      ],
    },
    {
      id: 'automation_controls',
      title: '自动化与控制',
      sub: '启动行为、快捷键与媒体键',
      icon: 'tune',
      groups: [
        {
          title: '自动化',
          rows: [
            {
              type: 'toggle',
              bind: 'shuffle',
              label: '默认随机播放',
              sub: '启动应用时默认开启随机模式',
              onChange: function (checked) { App.backend.set_shuffle(checked); },
            },
            {
              type: 'toggle',
              bind: 'resume_playback',
              label: '记忆播放状态',
              sub: '下次启动时恢复当前的播放队列和进度',
              disabled: true,
            },
            {
              type: 'toggle',
              bind: 'automix',
              label: 'AutoTransmit 智能混音',
              sub: '在上一首末尾（最后一行歌词）交叉淡化过渡到下一首。仅在共享模式下可用',
              onChange: function (checked) {
                if (checked) {
                  // 与无间隙播放互斥：开启 AutoMix 时强制关闭 gapless
                  App.utils.call('save_settings', JSON.stringify({ gapless: false }));
                  if (App.audioPlayer && App.audioPlayer.setGaplessEnabled) {
                    App.audioPlayer.setGaplessEnabled(false);
                  }
                  var gaplessEl = document.querySelector('input[type="checkbox"][data-bind="gapless"]');
                  if (gaplessEl) gaplessEl.checked = false;
                }
              },
            },
            {
              type: 'toggle',
              bind: 'gapless',
              label: '无间隙播放',
              sub: '在上一首末尾预加载下一曲，自然结束时立即切换，避免切换间的加载停顿。与 AutoTransmit 互斥',
              onChange: function (checked) {
                if (checked) {
                  // 与 AutoTransmit 互斥：开启 gapless 时强制关闭 automix
                  App.utils.call('save_settings', JSON.stringify({ automix: false }));
                  if (App.audioPlayer && App.audioPlayer.setAutomixEnabled) {
                    App.audioPlayer.setAutomixEnabled(false);
                  }
                  var automixEl = document.querySelector('input[type="checkbox"][data-bind="automix"]');
                  if (automixEl) automixEl.checked = false;
                }
              },
            },
          ],
        },
        {
          title: '控制中心',
          rows: [
            {
              type: 'toggle',
              bind: 'smtc_lyrics',
              label: '控制中心歌词',
              sub: '在 Windows 媒体控制中心（SMTC）的歌名位置显示当前歌词行，歌手位置显示「歌名 - 歌手」',
            },
          ],
        },
        {
          title: '快捷键',
          rows: [
            { type: 'shortcut', bind: 'shortcuts', action: 'play_pause', label: '播放 / 暂停', sub: '切换当前播放状态' },
            { type: 'shortcut', bind: 'shortcuts', action: 'next_track', label: '下一首', sub: '跳到队列中的下一首' },
            { type: 'shortcut', bind: 'shortcuts', action: 'prev_track', label: '上一首', sub: '跳到队列中的上一首' },
            { type: 'shortcut', bind: 'shortcuts', action: 'volume_up', label: '音量加', sub: '每次增加 5%' },
            { type: 'shortcut', bind: 'shortcuts', action: 'volume_down', label: '音量减', sub: '每次减少 5%' },
            { type: 'shortcut', bind: 'shortcuts', action: 'toggle_like', label: '喜欢 / 取消喜欢', sub: '为当前曲目标记喜欢' },
            { type: 'shortcut', bind: 'shortcuts', action: 'toggle_mute', label: '静音', sub: '切换静音状态' },
          ],
        },
      ],
    },
    {
      id: 'experimental',
      title: '实验性',
      sub: '窗口随鼓点震动等效果',
      icon: 'science',
      rows: [
        {
          type: 'toggle',
          bind: 'window_beat_shake',
          label: '窗口随鼓点震动',
          sub: '播放时根据音乐能量 onset 轻微震动主窗口',
        },
      ],
    },
    {
      id: 'about',
      title: '关于',
      sub: '应用信息与版本',
      icon: 'info',
      isPage: true,
    },
  ];

  // ── 渲染 ─────────────────────────────────────────────────────────────────
  page.render = function (container) {
    page.container = container;
    _renderPivot();
  };

  // ── Pivot 选项卡布局 ─────────────────────────────────────────────────────
  function _renderPivot() {
    var container = page.container;
    container.innerHTML = '' +
      '<div class="settings-pivot">' +
        '<div class="page-sticky-header">' +
          '<div class="page-header">' +
            '<div class="page-header-left">' +
              '<h1 class="page-title">设置</h1>' +
            '</div>' +
          '</div>' +
          '<div class="settings-tabs" id="settings-tabs" role="tablist">' +
            _renderTabs() +
          '</div>' +
        '</div>' +
        '<section class="settings-pane" id="settings-pane"></section>' +
      '</div>';

    _bindTabs();
    _showSection(_currentSectionId);
  }

  function _renderTabs() {
    return SECTIONS.map(function (section) {
      var active = section.id === _currentSectionId ? ' active' : '';
      return '' +
        '<button class="settings-tab' + active + '" data-section="' + section.id + '" role="tab" type="button">' +
          '<span class="material-symbols-rounded settings-tab-icon">' + (section.icon || 'settings') + '</span>' +
          '<span class="settings-tab-label">' + section.title + '</span>' +
        '</button>';
    }).join('');
  }

  function _bindTabs() {
    var container = page.container;
    container.querySelectorAll('.settings-tab').forEach(function (tab) {
      tab.addEventListener('click', function () {
        var sectionId = this.dataset.section;
        var section = SECTIONS.find(function (s) { return s.id === sectionId; });
        if (!section) return;

        if (section.isPage) {
          if (App.navigate) App.navigate(sectionId);
          return;
        }

        _showSection(sectionId);
      });
    });
  }

  // ── 内容区：显示指定分类的内容 ───────────────────────────────────────────
  function _showSection(sectionId) {
    var section = SECTIONS.find(function (s) { return s.id === sectionId; });
    if (!section) return;
    _currentSectionId = sectionId;

    // 更新选项卡激活态
    var tabs = page.container.querySelectorAll('.settings-tab');
    tabs.forEach(function (tab) {
      tab.classList.toggle('active', tab.dataset.section === sectionId);
    });

    // 滚动激活的选项卡到可视区域
    var activeTab = page.container.querySelector('.settings-tab.active');
    if (activeTab) {
      activeTab.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
    }

    var paneEl = page.container.querySelector('#settings-pane');
    if (!paneEl) return;

    var bodyHtml = section.groups
      ? section.groups.map(_renderGroup).join('')
      : (section.rows && section.rows.length
          ? section.rows.map(_renderRow).join('')
          : _renderEmptyHint());

    paneEl.innerHTML =
      '<div class="settings-group" data-section="' + section.id + '">' +
        bodyHtml +
      '</div>';

    if (_lastSettings) {
      _bindSectionRows(section, _lastSettings);
    }

    App.utils.call('get_settings').then(function (res) {
      var settings = JSON.parse(res);
      _lastSettings = settings;
      _bindSectionRows(section, settings);
    });
  }

  // ── 渲染辅助 ─────────────────────────────────────────────────────────────
  function _renderGroup(group) {
    const rowsHtml = group.rows.map(_renderRow).join('');
    return `
      <div class="settings-group-header">${group.title}</div>
      ${rowsHtml}
    `;
  }

  function _renderEmptyHint() {
    return `
      <div class="settings-row settings-row-empty">
        <p class="settings-row-sub">暂无可配置项</p>
      </div>
    `;
  }

  function _renderRow(row) {
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
      const defaultLabel = App.utils.esc(row.placeholder || '请选择');
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
          <button class="settings-shortcut-value" type="button" data-action="${row.action}" data-default="未设置">
            <span class="settings-shortcut-keys">未设置</span>
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
      confirmText: '重启应用',
      cancelText: '稍后',
    }).then(function (ok) {
      if (ok && App.backend && App.backend.restart_app) {
        App.backend.restart_app();
      }
    });
  }

  function _displayShortcut(keysSpan, combo) {
    keysSpan.textContent = combo || keysSpan.parentElement.dataset.default || '未设置';
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
    keysSpan.textContent = '按快捷键…';

    function onKeyDown(e) {
      e.preventDefault();
      e.stopPropagation();

      if (e.key === 'Escape') {
        finishRecording();
        _displayShortcut(keysSpan, originalText === '未设置' ? '' : originalText);
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
        keysSpan.textContent = preview ? preview + '…' : '按快捷键…';
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
      _displayShortcut(keysSpan, originalText === '未设置' ? '' : originalText);
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
    const defaultLabel = valueEl.dataset.default || '系统默认设备';

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

    // 共享模式：使用 Web Audio API 的设备枚举（setSinkId）
    // 独占模式：使用 WASAPI 后端的设备列表（set_output_device）
    var isExclusive = _lastSettings && _lastSettings.wasapi_exclusive;
    var canUseWebAudio = !isExclusive && App.audioPlayer
      && App.audioPlayer.enumerateOutputDevices
      && App.audioPlayer.isSinkIdSupported
      && App.audioPlayer.isSinkIdSupported();

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

    if (canUseWebAudio) {
      // 共享模式：Web Audio API 设备
      App.audioPlayer.enumerateOutputDevices().then(function (devices) {
        var webDevices = devices.map(function (d) {
          return { id: d.deviceId, label: d.label || '音频设备' };
        });
        _renderDeviceMenu(webDevices, currentValue, function (devId) {
          App.audioPlayer.setSinkId(devId).catch(function (e) {
            console.warn('[settings] setSinkId 失败:', e);
          });
          App.utils.call('save_settings', JSON.stringify({ [row.bind]: devId }));
        });
        // 初始化时也应用已保存的设备
        if (currentValue) {
          App.audioPlayer.setSinkId(currentValue).catch(function (e) {
            console.warn('[settings] 恢复输出设备失败:', e);
          });
        }
      }).catch(function () {
        _populateQtDevices();
      });
    } else {
      _populateQtDevices();
    }
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

  // ── 配色方案 ────────────────────────────────────────────────────
  function _applyColorScheme(val) {
    if (!window.App) return;
    App.state.colorScheme = val || 'tonal_spot';
    // 使用当前主色重新应用主题
    if (App.state.currentDominantRgb) {
      App.utils.applyDynamicTheme(App.state.currentDominantRgb, App.state.colorScheme);
    }
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
