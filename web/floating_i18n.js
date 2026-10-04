/**
 * Carminium — 浮动窗口精简 i18n（自动生成，请勿手改）
 *
 * ⚠️ 由 scripts/gen_floating_i18n.js 生成。新增键后重跑：
 *      node scripts/gen_floating_i18n.js
 *
 * 只包含浮动窗用到的键（35 个 × 5 语言），
 * 用于替换 209KB 的完整 i18n.js。API 与 App.i18n 兼容。
 */
(function () {
  'use strict';

  window.App = window.App || {};

  var SUPPORTED = ["zh-CN","zh-TW","ja","en","ru"];
  var DEFAULT_LANG = 'zh-CN';
  var _currentLang = DEFAULT_LANG;
  var _listeners = [];

  var STRINGS = {
    "zh-CN": {
      "common.nowPlaying": "正在播放",
      "common.notPlaying": "未在播放",
      "common.unknownTrack": "未知曲目",
      "common.unknownArtist": "未知艺术家",
      "common.cancel": "取消",
      "common.confirm": "确认",
      "common.close": "关闭",
      "np.tab.info": "音乐信息",
      "np.tab.queue": "接下来播放",
      "np.tab.lyrics": "歌词",
      "np.noLyrics": "暂无歌词",
      "np.progress": "播放进度",
      "np.prev": "上一首",
      "np.next": "下一首",
      "np.playPause": "播放/暂停",
      "np.shuffle": "随机播放",
      "np.repeat": "循环播放",
      "np.like": "收藏",
      "np.audioMode": "音频模式",
      "np.mute": "静音",
      "np.volume": "音量",
      "np.exclusiveMode": "WASAPI 独占模式（点击切回共享）",
      "np.sharedMode": "共享模式（点击切换独占）",
      "np.removeFromQueue": "从队列移除",
      "np.dragToReorder": "拖动排序",
      "floating.dock": "还原到侧边栏",
      "floating.albumCover": "专辑封面",
      "title.minimize": "最小化",
      "title.close": "关闭",
      "audio.switchExclusiveTitle": "切换到 WASAPI 独占模式",
      "audio.switchExclusiveBody": "独占模式将直接占用输出设备，绕过 Windows 音频引擎以获得更低延迟与位完美输出。期间以下功能将不可用：播放中切换输出设备、音频处理 API 选择、系统音量合成器单独控制、其他应用同时发声。是否继续？",
      "audio.switchExclusiveConfirm": "切换",
      "audio.switchSharedTitle": "切回共享模式",
      "audio.switchSharedBody": "将恢复使用 Windows 音频引擎的共享模式播放，重新启用输出设备切换等功能。是否继续？",
      "audio.switchSharedConfirm": "切回"
    },
    "zh-TW": {
      "common.nowPlaying": "正在播放",
      "common.notPlaying": "未在播放",
      "common.unknownTrack": "未知曲目",
      "common.unknownArtist": "未知藝術家",
      "common.cancel": "取消",
      "common.confirm": "確認",
      "common.close": "關閉",
      "np.tab.info": "音樂資訊",
      "np.tab.queue": "接下來播放",
      "np.tab.lyrics": "歌詞",
      "np.noLyrics": "暫無歌詞",
      "np.progress": "播放進度",
      "np.prev": "上一首",
      "np.next": "下一首",
      "np.playPause": "播放/暫停",
      "np.shuffle": "隨機播放",
      "np.repeat": "循環播放",
      "np.like": "收藏",
      "np.audioMode": "音訊模式",
      "np.mute": "靜音",
      "np.volume": "音量",
      "np.exclusiveMode": "WASAPI 獨佔模式（點擊切回共享）",
      "np.sharedMode": "共享模式（點擊切換獨佔）",
      "np.removeFromQueue": "從佇列移除",
      "np.dragToReorder": "拖動排序",
      "floating.dock": "還原到側邊欄",
      "floating.albumCover": "專輯封面",
      "title.minimize": "最小化",
      "title.close": "關閉",
      "audio.switchExclusiveTitle": "切換到 WASAPI 獨佔模式",
      "audio.switchExclusiveBody": "獨佔模式將直接佔用輸出裝置，繞過 Windows 音訊引擎以獲得更低延遲與位元完美輸出。期間以下功能將不可用：播放中切換輸出裝置、音訊處理 API 選擇、系統音量合成器單獨控制、其他應用同時發聲。是否繼續？",
      "audio.switchExclusiveConfirm": "切換",
      "audio.switchSharedTitle": "切回共享模式",
      "audio.switchSharedBody": "將恢復使用 Windows 音訊引擎的共享模式播放，重新啟用輸出裝置切換等功能。是否繼續？",
      "audio.switchSharedConfirm": "切回"
    },
    "ja": {
      "common.nowPlaying": "再生中",
      "common.notPlaying": "再生していません",
      "common.unknownTrack": "不明なトラック",
      "common.unknownArtist": "不明なアーティスト",
      "common.cancel": "キャンセル",
      "common.confirm": "確認",
      "common.close": "閉じる",
      "np.tab.info": "音楽情報",
      "np.tab.queue": "次に再生",
      "np.tab.lyrics": "歌詞",
      "np.noLyrics": "歌詞がありません",
      "np.progress": "再生進捗",
      "np.prev": "前の曲",
      "np.next": "次の曲",
      "np.playPause": "再生/一時停止",
      "np.shuffle": "シャッフル再生",
      "np.repeat": "リピート再生",
      "np.like": "お気に入り",
      "np.audioMode": "オーディオモード",
      "np.mute": "ミュート",
      "np.volume": "音量",
      "np.exclusiveMode": "WASAPI 排他モード（クリックで共有に切替）",
      "np.sharedMode": "共有モード（クリックで排他に切替）",
      "np.removeFromQueue": "キューから削除",
      "np.dragToReorder": "ドラッグで並べ替え",
      "floating.dock": "サイドバーに戻す",
      "floating.albumCover": "アルバムカバー",
      "title.minimize": "最小化",
      "title.close": "閉じる",
      "audio.switchExclusiveTitle": "WASAPI 排他モードに切替",
      "audio.switchExclusiveBody": "排他モードは出力デバイスを直接占有し、Windows オーディオエンジンをバイパスして低遅延・ビットパーフェクト出力を実現します。以下の機能は使用不可になります：再生中の出力デバイス切替、オーディオ処理 API 選択、システムボリュームミキサーの個別制御、他アプリの同時発音。続行しますか？",
      "audio.switchExclusiveConfirm": "切替",
      "audio.switchSharedTitle": "共有モードに切替",
      "audio.switchSharedBody": "Windows オーディオエンジンの共有モードに戻り、出力デバイス切替などの機能を再び有効にします。続行しますか？",
      "audio.switchSharedConfirm": "切替"
    },
    "en": {
      "common.nowPlaying": "Now Playing",
      "common.notPlaying": "Not playing",
      "common.unknownTrack": "Unknown track",
      "common.unknownArtist": "Unknown artist",
      "common.cancel": "Cancel",
      "common.confirm": "Confirm",
      "common.close": "Close",
      "np.tab.info": "Track Info",
      "np.tab.queue": "Up Next",
      "np.tab.lyrics": "Lyrics",
      "np.noLyrics": "No lyrics",
      "np.progress": "Playback progress",
      "np.prev": "Previous",
      "np.next": "Next",
      "np.playPause": "Play/Pause",
      "np.shuffle": "Shuffle",
      "np.repeat": "Repeat",
      "np.like": "Like",
      "np.audioMode": "Audio Mode",
      "np.mute": "Mute",
      "np.volume": "Volume",
      "np.exclusiveMode": "WASAPI Exclusive (click to switch to Shared)",
      "np.sharedMode": "Shared mode (click to switch to Exclusive)",
      "np.removeFromQueue": "Remove from queue",
      "np.dragToReorder": "Drag to reorder",
      "floating.dock": "Restore to sidebar",
      "floating.albumCover": "Album cover",
      "title.minimize": "Minimize",
      "title.close": "Close",
      "audio.switchExclusiveTitle": "Switch to WASAPI Exclusive Mode",
      "audio.switchExclusiveBody": "Exclusive mode will directly occupy the output device, bypassing the Windows audio engine for lower latency and bit-perfect output. The following features will be unavailable: switching output device during playback, audio API selection, system volume mixer per-app control, other apps playing audio simultaneously. Continue?",
      "audio.switchExclusiveConfirm": "Switch",
      "audio.switchSharedTitle": "Switch Back to Shared Mode",
      "audio.switchSharedBody": "This will restore shared mode playback using the Windows audio engine, re-enabling output device switching and other features. Continue?",
      "audio.switchSharedConfirm": "Switch Back"
    },
    "ru": {
      "common.nowPlaying": "Сейчас воспроизводится",
      "common.notPlaying": "Не воспроизводится",
      "common.unknownTrack": "Неизвестный трек",
      "common.unknownArtist": "Неизвестный исполнитель",
      "common.cancel": "Отмена",
      "common.confirm": "Подтвердить",
      "common.close": "Закрыть",
      "np.tab.info": "Информация о треке",
      "np.tab.queue": "Далее в очереди",
      "np.tab.lyrics": "Текст песни",
      "np.noLyrics": "Нет текста песни",
      "np.progress": "Прогресс воспроизведения",
      "np.prev": "Предыдущий",
      "np.next": "Следующий",
      "np.playPause": "Воспроизведение/Пауза",
      "np.shuffle": "Случайный порядок",
      "np.repeat": "Повтор",
      "np.like": "В избранное",
      "np.audioMode": "Аудио режим",
      "np.mute": "Без звука",
      "np.volume": "Громкость",
      "np.exclusiveMode": "WASAPI Exclusive (нажмите для переключения на Shared)",
      "np.sharedMode": "Shared режим (нажмите для переключения на Exclusive)",
      "np.removeFromQueue": "Убрать из очереди",
      "np.dragToReorder": "Перетащите для изменения порядка",
      "floating.dock": "Вернуть на боковую панель",
      "floating.albumCover": "Обложка альбома",
      "title.minimize": "Свернуть",
      "title.close": "Закрыть",
      "audio.switchExclusiveTitle": "Переключить на WASAPI Exclusive",
      "audio.switchExclusiveBody": "Exclusive режим напрямую займёт устройство вывода, минуя аудиодвижок Windows, для более низкой задержки и бит-идеального вывода. Следующие функции будут недоступны: переключение устройства вывода во время воспроизведения, выбор API обработки звука, индивидуальная регулировка громкости в микшере Windows, одновременное воспроизведение звука другими приложениями. Продолжить?",
      "audio.switchExclusiveConfirm": "Переключить",
      "audio.switchSharedTitle": "Переключить обратно на Shared",
      "audio.switchSharedBody": "Будет восстановлен режим Shared с использованием аудиодвижка Windows, снова будут доступны переключение устройства вывода и другие функции. Продолжить?",
      "audio.switchSharedConfirm": "Переключить"
    }
  };

  /** 翻译键 → 当前语言文本；缺失时回退 zh-CN，再回退到键本身 */
  function t(key, params) {
    var dict = STRINGS[_currentLang] || STRINGS[DEFAULT_LANG];
    var text = dict[key];
    if (text === undefined) text = STRINGS[DEFAULT_LANG][key];
    if (text === undefined) return key;
    if (params) {
      for (var k in params) {
        if (Object.prototype.hasOwnProperty.call(params, k)) {
          text = text.split('{' + k + '}').join(params[k]);
        }
      }
    }
    return text;
  }

  function init(lang) {
    if (SUPPORTED.indexOf(lang) === -1) lang = DEFAULT_LANG;
    var changed = _currentLang !== lang;
    _currentLang = lang;
    document.documentElement.setAttribute('lang', lang);
    if (changed) {
      applyToDOM();
      for (var i = 0; i < _listeners.length; i++) {
        try { _listeners[i](lang); } catch (e) { /* ignore */ }
      }
    }
  }

  function getLang() { return _currentLang; }

  function onChange(fn) {
    _listeners.push(fn);
    return function () {
      var i = _listeners.indexOf(fn);
      if (i >= 0) _listeners.splice(i, 1);
    };
  }

  function applyToDOM(root) {
    var scope = root || document;
    scope.querySelectorAll('[data-i18n]').forEach(function (el) {
      var k = el.getAttribute('data-i18n');
      if (k) el.textContent = t(k);
    });
    scope.querySelectorAll('[data-i18n-title]').forEach(function (el) {
      var k = el.getAttribute('data-i18n-title');
      if (k) el.setAttribute('title', t(k));
    });
    scope.querySelectorAll('[data-i18n-aria-label]').forEach(function (el) {
      var k = el.getAttribute('data-i18n-aria-label');
      if (k) el.setAttribute('aria-label', t(k));
    });
    scope.querySelectorAll('[data-i18n-alt]').forEach(function (el) {
      var k = el.getAttribute('data-i18n-alt');
      if (k) el.setAttribute('alt', t(k));
    });
  }

  window.App.i18n = {
    t: t,
    init: init,
    getLang: getLang,
    applyToDOM: applyToDOM,
    onChange: onChange,
    supported: SUPPORTED,
    defaultLang: DEFAULT_LANG,
  };
})();
