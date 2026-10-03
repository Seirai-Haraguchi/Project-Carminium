/**
 * Carminium — Your Mix（主页）
 * 包含：每日合集（基于艺人/流派/专辑）、探索、相似类型新推荐、最近播放前十首、听歌统计
 * 每日合集使用 Apple Music 风格抽象图形作为封面，不再从专辑图取图。
 */
(function () {
  'use strict';

  window.App = window.App || {};
  const page = {};
  window.App.pages = window.App.pages || {};
  window.App.pages.your_mix = page;

  let _historyTracks = [];
  let _stats = null;
  let _mixes = [];
  let _exploreData = null;
  let _recommendations = [];
  // Hero 是否已消费探索卡（探索只有一张，独占一整节太空 → 优先放进 Hero）
  let _heroTookExplore = false;
  // Hero 已放进「相似类型新推荐」的卡片数，该 rail 从此索引续，避免整节重复
  let _heroTookRecs = 0;
  // Hero 保底用了第一个 daily mix（探索+推荐都空时），该 rail 从索引 1 续
  let _heroTookLeadMix = false;

  // ── Apple Music 风格抽象图形生成器 ──────────────────────────────────────
  // 基于合集名称 + 类型生成确定性的渐变 + 几何图形 + 文字
  // 每种类型有独特的配色方案和图形模式

  var _mixPalettes = {
    artist: [
      ['#FF6B6B', '#FF8E53', '#FECA57'],  // 暖橙红
      ['#5B7FFF', '#3B5BDB', '#7B68EE'],  // 蓝紫
      ['#00B894', '#00CEC9', '#55EFC4'],  // 青绿
      ['#E84393', '#FD79A8', '#FDCB6E'],  // 粉金
      ['#6C5CE7', '#A29BFE', '#74B9FF'],  // 薰衣草
    ],
    genre: [
      ['#0984E3', '#74B9FF', '#A8E6FF'],  // 海蓝
      ['#00B894', '#55EFC4', '#B8E994'],  // 森林绿
      ['#E17055', '#FDCB6E', '#FFEAA7'],  // 日落
      ['#6C5CE7', '#A29BFE', '#DFE6FD'],  // 梦幻紫
      ['#E84393', '#FD79A8', '#FDCB6E'],  // 粉桃
    ],
    album: [
      ['#2D3436', '#636E72', '#B2BEC3'],  // 暗灰
      ['#6C5CE7', '#341F97', '#5F27CD'],  // 深紫
      ['#0A3D62', '#3C6E91', '#82CCDD'],  // 深海
      ['#B71540', '#C44569', '#F8BBD0'],  // 酒红
      ['#0F2027', '#203A43', '#2C5364'],  // 墨绿
    ],
    explore: [
      ['#FF6B6B', '#7B2FF8', '#F107A3'],  // 霓虹
      ['#00F5A0', '#00D9F5', '#3A47D5'],  // 极光
      ['#FC5C7D', '#6A82FB', '#05E1FF'],  // 渐变蓝
      ['#F7971E', '#FFD200', '#FFE066'],  // 阳光
    ],
    recommend: [
      ['#11998E', '#38EF7D'],              // 翡翠
      ['#4776E6', '#8E54E9'],              // 皇家蓝紫
      ['#E44D26', '#F5A623'],              // 火焰
      ['#1A2980', '#26D0CE'],              // 深海青
    ],
  };

  function _hashString(str) {
    var hash = 0;
    if (!str) return hash;
    for (var i = 0; i < str.length; i++) {
      hash = str.charCodeAt(i) + ((hash << 5) - hash);
      hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash);
  }

  function _getPalette(type, seed) {
    var palettes = _mixPalettes[type] || _mixPalettes.artist;
    return palettes[seed % palettes.length];
  }

  /**
   * 生成 Apple Music 风格抽象图形 SVG 字符串
   * @param {string} name - 合集名称
   * @param {string} type - artist / genre / album / explore / recommend
   * @returns {string} SVG 字符串（含渐变背景 + 几何图形 + 文字）
   */
  function _generateAbstractArt(name, type) {
    var seed = _hashString(name + type);
    var palette = _getPalette(type, seed);
    var c1 = palette[0];
    var c2 = palette.length > 1 ? palette[1] : palette[0];
    var c3 = palette.length > 2 ? palette[2] : palette[1] || palette[0];

    // 随机选择几何模式（基于 seed）
    var mode = seed % 4;
    var shapes = '';

    if (mode === 0) {
      // 模式 0：大圆 + 小圆叠加
      var cx = 60 + (seed % 40);
      var cy = 40 + (seed % 50);
      var r = 35 + (seed % 25);
      shapes += '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="rgba(255,255,255,0.12)" />';
      shapes += '<circle cx="' + ((cx + 50) % 160) + '" cy="' + ((cy + 60) % 160) + '" r="' + (r * 0.6) + '" fill="rgba(255,255,255,0.08)" />';
      shapes += '<circle cx="' + ((cx + 100) % 160) + '" cy="' + ((cy + 30) % 160) + '" r="' + (r * 0.35) + '" fill="' + c3 + '" opacity="0.3" />';
    } else if (mode === 1) {
      // 模式 1：波浪线条
      var offset = seed % 40;
      for (var i = 0; i < 5; i++) {
        var y = 20 + i * 28 + offset;
        shapes += '<path d="M0,' + y + ' Q40,' + (y - 15) + ' 80,' + y + ' T160,' + y + '" stroke="rgba(255,255,255,' + (0.06 + i * 0.03) + ')" stroke-width="' + (6 - i) + '" fill="none" />';
      }
    } else if (mode === 2) {
      // 模式 2：三角形组合
      var tx = (seed % 60) + 20;
      var ty = (seed % 40) + 20;
      shapes += '<polygon points="' + tx + ',' + ty + ' ' + (tx + 70) + ',' + (ty + 50) + ' ' + (tx - 20) + ',' + (ty + 60) + '" fill="rgba(255,255,255,0.1)" />';
      shapes += '<polygon points="' + (tx + 40) + ',' + (ty + 70) + ' ' + (tx + 100) + ',' + (ty + 20) + ' ' + (tx + 120) + ',' + (ty + 90) + '" fill="' + c3 + '" opacity="0.15" />';
    } else {
      // 模式 3：渐变光斑 + 弧线
      shapes += '<defs><radialGradient id="rg' + seed + '" cx="70%" cy="30%" r="60%"><stop offset="0%" stop-color="rgba(255,255,255,0.2)"/><stop offset="100%" stop-color="transparent"/></radialGradient></defs>';
      shapes += '<rect x="0" y="0" width="160" height="160" fill="url(#rg' + seed + ')" />';
      shapes += '<path d="M0,' + (80 + seed % 30) + ' Q80,' + (40 + seed % 40) + ' 160,' + (90 + seed % 20) + '" stroke="rgba(255,255,255,0.15)" stroke-width="20" fill="none" stroke-linecap="round" />';
    }

    // 不再在 SVG 内烤文字 —— 标题由卡片浮层（.ym-card-name）统一渲染，
    // 烤死会造成「深爵士 / 深夜爵士」双行重复。
    // 唯一 ID 防止冲突
    var gid = 'amg' + seed;

    return '<svg viewBox="0 0 160 160" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:100%;display:block;">' +
      '<defs>' +
        '<linearGradient id="' + gid + '" x1="0" y1="0" x2="1" y2="1">' +
          '<stop offset="0%" stop-color="' + c1 + '"/>' +
          '<stop offset="50%" stop-color="' + c2 + '"/>' +
          '<stop offset="100%" stop-color="' + c3 + '"/>' +
        '</linearGradient>' +
      '</defs>' +
      '<rect width="160" height="160" fill="url(#' + gid + ')"/>' +
      shapes +
    '</svg>';
  }

  // ── 渲染主入口 ───────────────────────────────────────────────────────────

  page.render = function (container, params) {
    // 如果有 mix_detail 参数，渲染合集详情页
    if (params && params.mix_detail) {
      _renderMixDetail(container, params);
      return;
    }

    container.innerHTML = `
      <div class="ym-page">
        <div class="page-sticky-header">
          <div class="page-header">
            <div class="page-header-left">
              <h1 class="page-title" id="ym-greeting"></h1>
              <p class="page-subtitle" id="ym-subtitle"></p>
            </div>
          </div>
        </div>

        <!-- 区块标题**不复用任何私有样式** —— 直接用全局
             .section-heading / .section-title / .section-count
             （与专辑页 / 所有音乐页同名同档）。
             旧的自造 21px 标题 + 强调色短棒已删除：全站 section 标题是
             13px uppercase 的 quiet label，探新没有理由长成另一副样子。 -->

        <!-- 精选：1 张大卡 + 小卡，同一套 .album-grid 流式栅格 -->
        <section class="ym-section" id="ym-hero-section">
          <div class="section-heading">
            <span class="section-title" data-i18n="yourMix.featured">今日精选</span>
            <span class="section-count" data-i18n="yourMix.featuredDesc"></span>
          </div>
          <div class="ym-hero" id="ym-hero"></div>
        </section>

        <!-- 每日合集 -->
        <section class="ym-section" id="ym-daily-mix-section">
          <div class="section-heading">
            <span class="section-title" data-i18n="yourMix.dailyMix"></span>
            <span class="section-count" data-i18n="yourMix.dailyMixDesc"></span>
          </div>
          ${_railHTML('ym-mix-rail')}
        </section>

        <!-- 探索 -->
        <section class="ym-section" id="ym-explore-section">
          <div class="section-heading">
            <span class="section-title" data-i18n="yourMix.explore"></span>
            <span class="section-count" data-i18n="yourMix.exploreDesc"></span>
          </div>
          ${_railHTML('ym-explore-rail')}
        </section>

        <!-- 相似类型新推荐 -->
        <section class="ym-section" id="ym-recommend-section">
          <div class="section-heading">
            <span class="section-title" data-i18n="yourMix.similarRecommend"></span>
            <span class="section-count" data-i18n="yourMix.similarRecommendDesc"></span>
          </div>
          ${_railHTML('ym-recommend-rail')}
        </section>

        <!-- 最近播放：复用全局 .track-row 列表行，不另造卡片 -->
        <section class="ym-section" id="ym-recent-section">
          <div class="section-heading">
            <span class="section-title" data-i18n="yourMix.recentPlays"></span>
            <span class="section-count" data-i18n="yourMix.recentPlaysDesc"></span>
          </div>
          <ul class="track-list ym-recent-list" id="ym-recent-list"></ul>
        </section>

        <!-- 听歌统计 -->
        <section class="ym-section" id="ym-stats-section">
          <div class="section-heading">
            <span class="section-title" data-i18n="yourMix.stats"></span>
            <span class="section-count" data-i18n="yourMix.statsDesc"></span>
          </div>
          <div class="ym-stats-wrap" id="ym-stats-container"></div>
        </section>
      </div>
    `;

    // 绑定 3 条横向轨道的翻页行为（最近播放是列表，不进 rail）
    ['ym-mix-rail', 'ym-explore-rail', 'ym-recommend-rail'].forEach(_initRail);

    _renderGreeting();
    _loadData();
  };

  // ── 问候语 ─────────────────────────────────────────────────────────────────
  // 标题就是 .page-header-left 的 .page-title + .page-subtitle（与其他页同构）。
  // 副标题放一句随时段变化的说明，主标题只放问候语本身。

  var _greetingBound = false;

  /** 当前时段的问候文案 key */
  function _greetingKey() {
    var h = new Date().getHours();
    if (h >= 5 && h < 9)   return 'yourMix.greetMorning';
    if (h >= 9 && h < 12)  return 'yourMix.greetForenoon';
    if (h >= 12 && h < 14) return 'yourMix.greetNoon';
    if (h >= 14 && h < 18) return 'yourMix.greetAfternoon';
    if (h >= 18 && h < 23) return 'yourMix.greetEvening';
    if (h >= 23)           return 'yourMix.greetLate';
    return 'yourMix.greetLateNight';   // 0:00–4:59
  }

  /** 当前时段对应的副标题 key */
  function _greetingSubKey() {
    var h = new Date().getHours();
    if (h >= 5 && h < 12)  return 'yourMix.greetSubMorning';
    if (h >= 12 && h < 18) return 'yourMix.greetSubAfternoon';
    if (h >= 18 && h < 23) return 'yourMix.greetSubEvening';
    return 'yourMix.greetSubNight';
  }

  /** 把问候语写进标题（复用 .page-title / .page-subtitle） */
  function _renderGreeting() {
    var el = document.getElementById('ym-greeting');
    if (!el) return;
    el.textContent = App.i18n.t(_greetingKey());

    var sub = document.getElementById('ym-subtitle');
    if (sub) sub.textContent = App.i18n.t(_greetingSubKey());

    if (_greetingBound) return;
    _greetingBound = true;
  }

  /** 横向卡片轨骨架：轨道 + 左右翻页箭头 */
  function _railHTML(railId) {
    return `
      <div class="ym-rail-wrap" data-rail-wrap>
        <div class="ym-rail" id="${railId}"></div>
        <button class="ym-rail-btn ym-rail-btn--prev" type="button" tabindex="-1"
                aria-label="${App.i18n.t('yourMix.scrollPrev')}">
          <span class="material-symbols-rounded">chevron_right</span>
        </button>
        <button class="ym-rail-btn ym-rail-btn--next" type="button" tabindex="-1"
                aria-label="${App.i18n.t('yourMix.scrollNext')}">
          <span class="material-symbols-rounded">chevron_right</span>
        </button>
      </div>
    `;
  }

  /**
   * 绑定一条横向轨道的翻页行为。
   * 箭头仅在「可滚动」时可见（首尾自动禁用），滚动中同步按钮态。
   */
  function _initRail(railId) {
    var rail = document.getElementById(railId);
    if (!rail) return;
    var wrap = rail.closest('[data-rail-wrap]');
    if (!wrap) return;
    var prev = wrap.querySelector('.ym-rail-btn--prev');
    var next = wrap.querySelector('.ym-rail-btn--next');

    function step() {
      // 一屏 ≈ 4 张卡（196 + 16 gap），让翻页有「翻页」感而非微移
      return Math.max(rail.clientWidth * 0.82, 320);
    }

    function sync() {
      var max = rail.scrollWidth - rail.clientWidth;
      // 1px 容差：fractional 布局下末尾 scrollLeft 可能差不到 1px
      var over = max > 1;
      var atStart = rail.scrollLeft <= 1;
      var atEnd = rail.scrollLeft >= max - 1;
      prev.classList.toggle('can-scroll', over && !atStart);
      next.classList.toggle('can-scroll', over && !atEnd);
      wrap.classList.toggle('has-more', over && !atEnd);
    }

    prev.addEventListener('click', function () { rail.scrollLeft -= step(); });
    next.addEventListener('click', function () { rail.scrollLeft += step(); });
    rail.addEventListener('scroll', sync, { passive: true });
    // 字体/封面异步加载会改变 scrollWidth → 尺寸变化时重算
    if (window.ResizeObserver) {
      var ro = new ResizeObserver(sync);
      ro.observe(rail);
    }
    // 内容注入后同步一次
    requestAnimationFrame(sync);
    rail._ymSync = sync;
  }

  /** 卡片列表注入后刷新所属轨道的箭头态 */
  function _syncRail(railId) {
    var rail = document.getElementById(railId);
    if (rail && rail._ymSync) rail._ymSync();
  }

  function _loadData() {
    // 并行加载历史记录、统计数据、每日合集、探索、推荐
    Promise.all([
      App.utils.call('get_play_history', 500),
      App.utils.call('get_play_stats'),
      App.utils.call('get_daily_mixes'),
      App.utils.call('get_explore_tracks'),
      App.utils.call('get_similar_recommendations'),
    ]).then(function (results) {
      _historyTracks = JSON.parse(results[0]);
      _stats = JSON.parse(results[1]);
      _mixes = JSON.parse(results[2]);
      _exploreData = JSON.parse(results[3]);
      _recommendations = JSON.parse(results[4]);
      // Hero 优先：它决定哪些卡片已被消费（探索 / 推荐），须先于各 rail 渲染
      if (!_renderHero()) {
        _showEmpty('ym-hero', 'auto_awesome', 'yourMix.emptyTitle', 'yourMix.emptyHistory');
      }
      _renderDailyMix();
      _renderExplore();
      _renderRecommendations();
      _renderRecent();
      _renderStats();
      _tintAll();
    }).catch(function (err) {
      console.error('[your_mix] load failed:', err);
    });
  }

  /**
   * Material You「内容取色」：让每张卡从自己的封面长出强调色。
   * 必须在所有卡片注入后统一调用（rail 内的 img 可能还在加载，
   * card_color 内部对未完成的 img 挂 load 监听）。
   */
  function _tintAll() {
    if (!window.CardColor) return;
    var isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    ['ym-hero', 'ym-mix-rail', 'ym-explore-rail', 'ym-recommend-rail'].forEach(function (id) {
      window.CardColor.tintCards(document.getElementById(id), isDark);
    });
  }

  // ── 每日合集 ───────────────────────────────────────────────────────────────

  var _mixTypeConfig = {
    artist:  { icon: 'person', label: 'yourMix.typeArtist' },
    genre:   { icon: 'graphic_eq', label: 'yourMix.typeGenre' },
    album:   { icon: 'album', label: 'yourMix.typeAlbum' },
    explore: { icon: 'auto_awesome', label: 'yourMix.exploreBadge' },
    recommend: { icon: 'insights', label: 'yourMix.recommendBadge' },
  };

  // 取合集中第一个有封面的曲目
  function _firstCoverTrack(tracks) {
    if (!tracks) return null;
    for (var i = 0; i < tracks.length; i++) {
      if (tracks[i].has_cover) return tracks[i];
    }
    return null;
  }

  // 从曲目列表中按专辑去重，取最多 N 张不同专辑的封面曲目
  function _distinctAlbumCoverTracks(tracks, max) {
    if (!tracks) return [];
    var seen = {};
    var result = [];
    for (var i = 0; i < tracks.length && result.length < (max || 4); i++) {
      var t = tracks[i];
      if (!t.has_cover) continue;
      var key = t.album || ('id_' + t.id);
      if (seen[key]) continue;
      seen[key] = true;
      result.push(t);
    }
    return result;
  }

  // 生成拼贴封面（2×2 多专辑图布局）
  // 取合集内最多4张不同专辑的封面，裁切拼成几何网格。
  // artType：无可用封面时的抽象图形配色类型（genre / recommend / explore）。
  function _buildGenreMosaicCover(mix, size, artType) {
    var fallbackSVG = _generateAbstractArt(mix.name || '', artType || 'genre');
    if (!mix.tracks || !window.coverUrl) return fallbackSVG;

    var coverTracks = _distinctAlbumCoverTracks(mix.tracks, 4);
    if (coverTracks.length === 0) return fallbackSVG;

    var sz = size || 256;
    // 单张图片失败：隐藏该 cell，其余 cell 自动撑满 grid
    var onError = 'onerror="this.parentElement.style.display=\'none\'"';
    var html = '<div class="ym-mosaic-cover">';

    if (coverTracks.length === 1) {
      // 只有一张：直接铺满，失败则回退到抽象图形
      html += '<div class="ym-mosaic-cell m1"><img src="' + window.coverUrl(coverTracks[0].id, sz) + '" alt="" loading="lazy" onerror="this.outerHTML=this.closest(\'.ym-mosaic-wrapper\').dataset.fb" ></div>';
    } else if (coverTracks.length === 2) {
      // 两张：左右各半
      html += '<div class="ym-mosaic-cell m2-l"><img src="' + window.coverUrl(coverTracks[0].id, sz) + '" alt="" loading="lazy" ' + onError + '></div>';
      html += '<div class="ym-mosaic-cell m2-r"><img src="' + window.coverUrl(coverTracks[1].id, sz) + '" alt="" loading="lazy" ' + onError + '></div>';
    } else if (coverTracks.length === 3) {
      // 三张：左侧大图 + 右侧上下两张
      html += '<div class="ym-mosaic-cell m3-l"><img src="' + window.coverUrl(coverTracks[0].id, sz) + '" alt="" loading="lazy" ' + onError + '></div>';
      html += '<div class="ym-mosaic-cell m3-tr"><img src="' + window.coverUrl(coverTracks[1].id, sz) + '" alt="" loading="lazy" ' + onError + '></div>';
      html += '<div class="ym-mosaic-cell m3-br"><img src="' + window.coverUrl(coverTracks[2].id, sz) + '" alt="" loading="lazy" ' + onError + '></div>';
    } else {
      // 四张：2×2 网格
      for (var i = 0; i < 4; i++) {
        html += '<div class="ym-mosaic-cell m4-' + ['tl','tr','bl','br'][i] + '"><img src="' + window.coverUrl(coverTracks[i].id, sz) + '" alt="" loading="lazy" ' + onError + '></div>';
      }
    }

    html += '</div>';
    return '<div class="ym-mosaic-wrapper" data-fb="' + fallbackSVG.replace(/"/g, '&quot;') + '">' + html + '</div>';
  }

  // 生成每日合集卡片/详情页封面 HTML（仅用于 daily mix：artist/genre/album）
  // artist → 艺人头像；album → 取合集中第一个有封面的曲目封面
  // genre → 多专辑封面几何裁切拼贴；无封面或加载失败时回退到抽象图形 SVG
  function _buildMixCoverHTML(mix, artType, size) {
    var fallbackSVG = _generateAbstractArt(mix.name || '', artType || mix.type);
    // artist：优先用艺人头像
    if (mix.type === 'artist' && mix.name && window.artistImageUrl) {
      var aurl = window.artistImageUrl(mix.name);
      if (aurl) {
        return '<img src="' + aurl + '" alt="" loading="lazy" onerror="this.outerHTML=this.dataset.fb" data-fb="' + fallbackSVG.replace(/"/g, '&quot;') + '">';
      }
    }
    // genre：多专辑封面几何拼贴
    if (mix.type === 'genre') {
      return _buildGenreMosaicCover(mix, size);
    }
    // album：取第一个有封面的曲目
    if (mix.tracks && mix.tracks.length > 0) {
      var coverTrack = _firstCoverTrack(mix.tracks);
      if (coverTrack && window.coverUrl) {
        var curl = window.coverUrl(coverTrack.id, size || 512);
        return '<img src="' + curl + '" alt="" loading="lazy" onerror="this.outerHTML=this.dataset.fb" data-fb="' + fallbackSVG.replace(/"/g, '&quot;') + '">';
      }
    }
    // 回退：抽象图形
    return fallbackSVG;
  }

  function _renderDailyMix() {
    var rail = document.getElementById('ym-mix-rail');
    if (rail) rail.innerHTML = '';

    if (!_mixes || _mixes.length === 0) {
      _hideSection('ym-daily-mix-section');
      _syncRail('ym-mix-rail');
      return;
    }

    // Hero 保底那张 daily mix 不再重复
    _mixes.slice(_heroTookLeadMix ? 1 : 0).forEach(function (mix) {
      rail.appendChild(_buildMixCard(_mixPick(mix)));
    });
    if (_heroTookLeadMix && _mixes.length === 1) {
      // 只有一张且已被 Hero 用掉 → 整节无内容，隐藏
      _hideSection('ym-daily-mix-section');
    }
    _syncRail('ym-mix-rail');
  }

  /**
   * Hero 精选区：1 张大卡（占 2×2）+ 最多 4 张小卡。
   * 内容分配原则 —— 每张卡只出现一次，不与下方 rail 整节重复：
   *   大卡 ← 探索卡（「你没听过的」，最该被看见）；没有则让第一个推荐上大字
   *   小卡 ← 推荐的第 2~5 个（余下的留给「相似类型新推荐」rail）
   * 探索 + 推荐都空时，只拿第一个 daily mix 当大卡且**不补位小卡** ——
   * 补位会让同一批卡在下方「每日合集」rail 里整节再来一遍。
   * @returns {boolean} 是否渲染出卡片（false = 全空，交给调用方显示引导空态）
   */
  function _renderHero() {
    var host = document.getElementById('ym-hero');
    if (!host) return false;
    host.innerHTML = '';

    var recs = _recommendations || [];
    var picks = [];

    if (_exploreData && _exploreData.tracks && _exploreData.tracks.length) {
      var exName = _exploreData.title || App.i18n.t('yourMix.explore');
      picks.push({
        type: 'explore',
        name: exName,
        tracks: _exploreData.tracks,
        coverHTML: _buildGenreMosaicCover(
          { name: exName, type: 'explore', tracks: _exploreData.tracks }, 512, 'explore'),
        mix: { type: 'explore', name: exName, tracks: _exploreData.tracks }
      });
    }
    var recPickCount = 0;
    for (var i = 0; i < recs.length; i++) {
      picks.push(_recommendPick(recs[i]));
      recPickCount++;
    }

    if (!picks.length) {
      // 保底：只用一个 daily mix 撑大卡位
      if (_mixes && _mixes.length) {
        picks.push(_mixPick(_mixes[0]));
        _heroTookLeadMix = true;
      } else {
        return false;
      }
    }

    var lead = picks[0];
    var small = picks.slice(1, 5);

    host.appendChild(_buildMixCard(lead, { lead: true }));
    small.forEach(function (p) { host.appendChild(_buildMixCard(p)); });
    _heroTookExplore = lead.type === 'explore';
    // Hero 用掉的推荐数（不含 daily mix 保底那张），该 rail 从此索引续
    _heroTookRecs = Math.min(4, Math.max(0, recPickCount - (_heroTookExplore ? 0 : 1)));
    // 列数 / 稀疏 / 独占这三种情况**全部由 CSS 栅格处理**
    // （auto-fill 收拢 + `.ym-card--lead:only-child`），JS 不再切状态类。

    return true;
  }

  function _mixPick(m) {
    return {
      type: m.type,
      name: m.name,
      tracks: m.tracks || [],
      coverHTML: _buildMixCoverHTML(m, m.type, 512),
      mix: m
    };
  }

  /**
   * 推荐 / 探索卡的封面。
   * 这些合集没有自己的封面资源，但曲目里有真实封面 ——
   * 用 genre 拼贴（同 _buildGenreMosaicCover）而不是抽象图形 SVG。
   * 理由（Material You）：整页卡片都该有真实内容，UI 才能从内容取色；
   * 抽象图形是「无色可取」的兜底，混在真封面里会割裂。
   */
  function _recommendPick(r) {
    var fakeMix = { name: r.name, type: 'genre', tracks: r.tracks || [] };
    return {
      type: 'recommend',
      name: r.name,
      tracks: r.tracks || [],
      coverHTML: _buildGenreMosaicCover(fakeMix, 512, 'recommend'),
      mix: { type: 'genre', name: r.name, tracks: r.tracks || [] }
    };
  }

  function _hideSection(id) {
    var el = document.getElementById(id);
    if (el) el.style.display = 'none';
  }

  function _showEmpty(containerId, icon, titleKey, subKey) {
    var host = document.getElementById(containerId);
    if (!host) return;
    host.innerHTML = _emptyMixHTML(icon, titleKey, subKey);
  }

  /** 构建一张通用卡片（Hero / 每日合集 / 探索 / 推荐 共用） */
  function _buildMixCard(pick, opts) {
    opts = opts || {};
    var tracks = pick.tracks || [];
    var cfg = _mixTypeConfig[pick.type] || { icon: 'auto_awesome', label: 'yourMix.exploreBadge' };

    // 底色 / 圆角 / hover 起落 / 按下形变**全部来自 .album-card**（专辑页同一套）。
    // 探新只挂两个变量：--ym-card-w（rail 固定宽）与卡级取色 --ym-a*。
    var card = document.createElement('article');
    card.className = 'album-card ym-card'
      + (opts.lead ? ' ym-card--lead' : '')
      + (opts.wide ? ' ym-card--wide' : '');
    card.tabIndex = 0;
    card.setAttribute('role', 'button');

    card.innerHTML = `
      <div class="album-cover ym-card-art">
        ${pick.coverHTML}
        <span class="ym-card-badge">
          <span class="material-symbols-rounded">${cfg.icon}</span>
          ${App.i18n.t(cfg.label)}
        </span>
        <button class="ym-card-play" type="button" tabindex="-1" aria-label="${App.i18n.t('yourMix.play')}">
          <span class="material-symbols-rounded">play_arrow</span>
        </button>
      </div>
      <div class="album-info ym-card-text">
        <p class="album-name ym-card-name">${App.utils.esc(pick.name)}</p>
        <p class="album-meta ym-card-meta">${App.i18n.t('music.trackCount', { count: tracks.length })}</p>
      </div>
    `;

    var play = function (e) {
      e.stopPropagation();
      if (tracks.length > 0) App.backend.play_from_list(JSON.stringify(tracks), 0);
    };
    card.querySelector('.ym-card-play').addEventListener('click', play);

    var open = function () {
      if (!pick.mix) return;
      App.navigate('your_mix', { mix_detail: true, mix: JSON.stringify(pick.mix) });
    };
    card.addEventListener('click', open);
    card.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
    });

    return card;
  }

  function _emptyMixHTML(icon, titleKey, subKey) {
    // 复用全站 `.empty-state`（专辑页 / 搜索无结果 / 歌单空 用的是同一套），
    // 不另造 `.ym-empty-section`，也不另造图标类 ——
    // 结构固定为 `.empty-icon + .empty-title + .empty-sub`，
    // 与 albums.js:257 / history.js:103 / playlists.js:394 逐字同构。
    // 图标尺寸的收敛交给 CSS 的 `.ym-hero > .empty-state .empty-icon`
    //（Hero 位只有卡片宽，72px 图标会溢出卡片比例）。
    return `
      <div class="empty-state">
        <span class="material-symbols-rounded empty-icon">${icon || 'auto_awesome'}</span>
        <h2 class="empty-title">${App.i18n.t(titleKey || 'yourMix.emptyMix')}</h2>
        <p class="empty-sub">${App.i18n.t(subKey || 'yourMix.emptyMixHint')}</p>
      </div>
    `;
  }

  // ── 探索 ───────────────────────────────────────────────────────────────────

  function _renderExplore() {
    var rail = document.getElementById('ym-explore-rail');
    if (!rail) return;
    rail.innerHTML = '';

    // 探索只有一张卡，独占一整节太空 —— 它已被放进 Hero 大卡位，这里不再重复
    if (_heroTookExplore) {
      _hideSection('ym-explore-section');
      _syncRail('ym-explore-rail');
      return;
    }
    if (!_exploreData || !_exploreData.tracks || _exploreData.tracks.length === 0) {
      _hideSection('ym-explore-section');
      _syncRail('ym-explore-rail');
      return;
    }

    // Hero 没能取到探索卡（理论上不会），退化为一张通栏卡
    var exName = _exploreData.title || App.i18n.t('yourMix.explore');
    rail.appendChild(_buildMixCard({
      type: 'explore',
      name: exName,
      tracks: _exploreData.tracks,
      coverHTML: _buildGenreMosaicCover(
        { name: exName, type: 'explore', tracks: _exploreData.tracks }, 512, 'explore'),
      mix: { type: 'explore', name: exName, tracks: _exploreData.tracks }
    }, { wide: true }));
    _syncRail('ym-explore-rail');
  }

  // ── 相似类型新推荐 ─────────────────────────────────────────────────────────

  function _renderRecommendations() {
    var rail = document.getElementById('ym-recommend-rail');
    if (!rail) return;
    rail.innerHTML = '';

    // Hero 已经展示过前几张，这里从续接索引开始，避免整节重复
    var rest = (_recommendations || []).slice(_heroTookRecs);
    if (rest.length === 0) {
      _hideSection('ym-recommend-section');
      _syncRail('ym-recommend-rail');
      return;
    }

    rest.forEach(function (rec) {
      rail.appendChild(_buildMixCard(_recommendPick(rec)));
    });
    _syncRail('ym-recommend-rail');
  }

  // ── 合集详情视图 ───────────────────────────────────────────────────────────

  function _renderMixDetail(container, params) {
    var mix;
    try {
      mix = JSON.parse(params.mix);
    } catch (e) {
      container.innerHTML = '<div class="empty-state">'
        + '<span class="material-symbols-rounded empty-icon">error</span>'
        + '<h2 class="empty-title">' + App.i18n.t('common.error') + '</h2>'
        + '</div>';
      return;
    }

    var tracks = mix.tracks || [];
    var cfg = _mixTypeConfig[mix.type] || { icon: 'auto_awesome', label: 'yourMix.exploreBadge' };
    var artType = mix.type === 'explore' ? 'explore' : (mix.type === 'genre' ? 'recommend' : mix.type);
    // daily mix（artist/genre/album）用真实图片，explore/recommend 用抽象图形
    var isDailyMix = (mix.type === 'artist' || mix.type === 'genre' || mix.type === 'album');
    var coverHTML = isDailyMix ? _buildMixCoverHTML(mix, artType, 512) : _generateAbstractArt(mix.name || '', artType);

    container.innerHTML = `
      <div class="ym-mix-detail-page">
        <div class="ym-mix-detail-header">
          <div class="ym-mix-detail-cover">
            ${coverHTML}
          </div>
          <div class="ym-mix-detail-meta">
            <span class="ym-mix-detail-badge">
              <span class="material-symbols-rounded">${cfg.icon}</span>
              ${App.i18n.t(cfg.label)}
            </span>
            <h1 class="ym-mix-detail-title">${App.utils.esc(mix.name)}</h1>
            <p class="ym-mix-detail-sub">${App.i18n.t('music.trackCount', { count: tracks.length })}</p>
            <div class="ym-mix-detail-actions">
              <button class="detail-play-btn" id="ym-mix-detail-play">
                <span class="material-symbols-rounded">play_arrow</span>${App.i18n.t('yourMix.play')}
              </button>
              <button class="detail-play-btn tonal" id="ym-mix-detail-shuffle">
                <span class="material-symbols-rounded">shuffle</span>${App.i18n.t('yourMix.shuffle')}
              </button>
            </div>
          </div>
        </div>
        <div class="playlist-search-wrapper">
          <div class="search-bar">
            <span class="material-symbols-rounded">search</span>
            <input type="text" id="ym-mix-detail-search" placeholder="${App.i18n.t('common.search')}" aria-label="${App.i18n.t('common.search')}">
          </div>
        </div>
        <ul class="track-list az-list" id="ym-mix-detail-list"></ul>
      </div>
    `;

    var searchInput = document.getElementById('ym-mix-detail-search');
    var filterStr = '';
    // 防抖：每敲一个字符都会全量过滤 + 重建列表 DOM。
    var _searchDebounceTimer = null;
    searchInput.addEventListener('input', function (e) {
      filterStr = e.target.value.trim().toLowerCase();
      if (_searchDebounceTimer) clearTimeout(_searchDebounceTimer);
      _searchDebounceTimer = setTimeout(function () {
        _searchDebounceTimer = null;
        _renderDetailList(tracks, filterStr);
      }, 180);
    });

    document.getElementById('ym-mix-detail-play').addEventListener('click', function () {
      if (tracks.length > 0) {
        App.backend.play_from_list(JSON.stringify(tracks), 0);
      }
    });

    document.getElementById('ym-mix-detail-shuffle').addEventListener('click', function () {
      if (tracks.length > 0) {
        var shuffled = tracks.slice();
        for (var i = shuffled.length - 1; i > 0; i--) {
          var j = Math.floor(Math.random() * (i + 1));
          var tmp = shuffled[i]; shuffled[i] = shuffled[j]; shuffled[j] = tmp;
        }
        App.backend.play_from_list(JSON.stringify(shuffled), 0);
      }
    });

    _renderDetailList(tracks, '');
  }

  function _renderDetailList(tracks, filterStr) {
    var ul = document.getElementById('ym-mix-detail-list');
    if (!ul) return;
    ul.innerHTML = '';

    var list = filterStr ? tracks.filter(function (t) { return App.utils.matchTrack(filterStr, t); }) : tracks;

    if (list.length === 0) {
      ul.innerHTML = '<div class="empty-state"><span class="material-symbols-rounded empty-icon">search_off</span><h2 class="empty-title">' + App.i18n.t('common.noResults') + '</h2></div>';
      return;
    }

    var frag = document.createDocumentFragment();
    list.forEach(function (track, i) {
      var li = App.utils.trackRow(track, i + 1, function (clickedTrack, idx) {
        App.backend.play_from_list(JSON.stringify(list), list.indexOf(clickedTrack));
      }, true);
      frag.appendChild(li);
    });
    ul.appendChild(frag);
  }

  // ── 最近播放 ───────────────────────────────────────────────────────────────

  function _renderRecent() {
    var host = document.getElementById('ym-recent-list');
    if (!host) return;
    host.innerHTML = '';

    var recent = _historyTracks.slice(0, 10);
    if (recent.length === 0) {
      _hideSection('ym-recent-section');
      return;
    }

    // 直接用项目既有的 .track-row 列表行（App.utils.trackRow）——
    // 「最近播放 10 首」本质是曲目列表，不是卡片墙，不该另造一套卡片样式。
    var frag = document.createDocumentFragment();
    recent.forEach(function (track, i) {
      frag.appendChild(App.utils.trackRow(track, i + 1, function (clicked, idx) {
        App.backend.play_from_list(JSON.stringify(recent), idx);
      }, true));
    });
    host.appendChild(frag);
  }

  // ── 听歌统计 ───────────────────────────────────────────────────────────────

  function _renderStats() {
    var container = document.getElementById('ym-stats-container');
    if (!container) return;
    container.innerHTML = '';

    if (!_stats || _stats.totalPlays === 0) {
      // 整个统计节没有内容 → 隐藏（Hero 的空态已给出引导，不必再堆一个）
      _hideSection('ym-stats-section');
      return;
    }

    // 统计概览卡片
    var overview = document.createElement('div');
    overview.className = 'ym-stats-overview';

    var totalHours = (_stats.totalDurationMs / 3600000).toFixed(1);
    overview.innerHTML = `
      <div class="ym-stat-card">
        <div class="ym-stat-head">
          <span class="material-symbols-rounded ym-stat-icon">play_circle</span>
          <span class="ym-stat-label">${App.i18n.t('yourMix.totalPlays')}</span>
        </div>
        <div class="ym-stat-value">${_stats.totalPlays}</div>
      </div>
      <div class="ym-stat-card">
        <div class="ym-stat-head">
          <span class="material-symbols-rounded ym-stat-icon">music_note</span>
          <span class="ym-stat-label">${App.i18n.t('yourMix.uniqueTracks')}</span>
        </div>
        <div class="ym-stat-value">${_stats.uniqueTracks}</div>
      </div>
      <div class="ym-stat-card">
        <div class="ym-stat-head">
          <span class="material-symbols-rounded ym-stat-icon">schedule</span>
          <span class="ym-stat-label">${App.i18n.t('yourMix.totalListenTime')}</span>
        </div>
        <div class="ym-stat-value">${totalHours}<span class="ym-stat-unit">${App.i18n.t('yourMix.hours')}</span></div>
      </div>
    `;
    container.appendChild(overview);

    // 7 天活跃度图表
    if (_stats.dailyActivity && _stats.dailyActivity.length > 0) {
      var chartCard = document.createElement('div');
      chartCard.className = 'ym-stats-chart-card';
      chartCard.innerHTML = _buildActivityChart(_stats.dailyActivity);
      container.appendChild(chartCard);
    }

    // Top 艺术家 & Top 专辑
    var listsRow = document.createElement('div');
    listsRow.className = 'ym-stats-lists';

    // Top 艺术家
    if (_stats.topArtists && _stats.topArtists.length > 0) {
      listsRow.appendChild(_buildTopList(
        App.i18n.t('yourMix.topArtists'),
        _stats.topArtists.map(function (a) {
          return { name: a.name, sub: App.i18n.t('yourMix.playCount', { count: a.play_count }), count: a.play_count };
        }),
        'person'
      ));
    }

    // Top 专辑
    if (_stats.topAlbums && _stats.topAlbums.length > 0) {
      listsRow.appendChild(_buildTopList(
        App.i18n.t('yourMix.topAlbums'),
        _stats.topAlbums.map(function (a) {
          return { name: a.name, sub: App.i18n.t('yourMix.playCount', { count: a.play_count }), count: a.play_count };
        }),
        'album'
      ));
    }

    if (listsRow.children.length > 0) {
      container.appendChild(listsRow);
    }
  }

  function _buildActivityChart(dailyActivity) {
    // 生成最近 7 天的完整日期列表，补齐缺失天数（count = 0）
    var dayMap = {};
    dailyActivity.forEach(function (d) { dayMap[d.day] = d.count; });

    var fullData = [];
    var now = new Date();
    for (var i = 6; i >= 0; i--) {
      var dt = new Date(now);
      dt.setDate(dt.getDate() - i);
      var y = dt.getFullYear();
      var m = String(dt.getMonth() + 1).padStart(2, '0');
      var dd = String(dt.getDate()).padStart(2, '0');
      var dayKey = y + '-' + m + '-' + dd;
      fullData.push({ day: dayKey, count: dayMap[dayKey] || 0 });
    }

    var maxCount = Math.max.apply(null, fullData.map(function (d) { return d.count; }));
    if (maxCount === 0) maxCount = 1;

    var bars = fullData.map(function (d) {
      var heightPct = Math.max(4, (d.count / maxCount) * 100);
      var dayLabel = d.day;
      // 取月-日
      var parts = dayLabel.split('-');
      if (parts.length >= 3) {
        dayLabel = parts[1] + '/' + parts[2];
      }
      return `
        <div class="ym-chart-bar-wrap">
          <div class="ym-chart-bar-area">
            <div class="ym-chart-bar" style="height:${heightPct}%" title="${d.day}: ${d.count}">
              <span class="ym-chart-bar-count">${d.count}</span>
            </div>
          </div>
          <span class="ym-chart-bar-label">${dayLabel}</span>
        </div>
      `;
    }).join('');

    return `
      <h3 class="ym-stats-subtitle">${App.i18n.t('yourMix.weeklyActivity')}</h3>
      <div class="ym-chart">${bars}</div>
    `;
  }

  function _buildTopList(title, items, icon) {
    var div = document.createElement('div');
    div.className = 'ym-top-list';

    var maxCount = Math.max.apply(null, items.map(function (i) { return i.count; }));
    if (maxCount === 0) maxCount = 1;

    var listHTML = items.map(function (item, idx) {
      var barPct = (item.count / maxCount) * 100;
      return `
        <div class="ym-top-item">
          <span class="ym-top-rank">${idx + 1}</span>
          <div class="ym-top-item-body">
            <div class="ym-top-item-header">
              <span class="ym-top-item-name">${App.utils.esc(item.name)}</span>
              <span class="ym-top-item-sub">${App.utils.esc(item.sub)}</span>
            </div>
            <div class="ym-top-item-bar-bg">
              <div class="ym-top-item-bar" style="width:${barPct}%"></div>
            </div>
          </div>
        </div>
      `;
    }).join('');

    div.innerHTML = `
      <h3 class="ym-stats-subtitle">${App.utils.esc(title)}</h3>
      <div class="ym-top-list-body">${listHTML}</div>
    `;
    return div;
  }

  // ── 播放状态更新 ─────────────────────────────────────────────────────────────

  page.updatePlayState = function () {
    var currentId = App.state.currentTrack ? App.state.currentTrack.id : null;

    // 最近播放是 .track-row 列表（复用全局样式）
    var list = document.getElementById('ym-recent-list');
    if (list) {
      Array.from(list.children).forEach(function (li) {
        if (li.dataset.trackId === currentId) {
          li.classList.add('playing');
        } else {
          li.classList.remove('playing');
        }
      });
    }

    // 合集详情页也要更新播放状态
    var detailList = document.getElementById('ym-mix-detail-list');
    if (detailList) {
      Array.from(detailList.children).forEach(function (li) {
        if (li.dataset.trackId === currentId) {
          li.classList.add('playing');
        } else {
          li.classList.remove('playing');
        }
      });
    }
  };

  page.onHistoryChanged = function () {
    if (document.getElementById('ym-mix-rail')) {
      _loadData();
    }
  };

})();