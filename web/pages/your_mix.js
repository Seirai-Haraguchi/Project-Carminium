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

    // 文字：合集名称首词（截短显示）
    var displayName = name || '';
    var words = displayName.split(/\s+/);
    var displayText = words.length > 1 ? words.slice(0, 2).join(' ') : displayName.substring(0, 12);
    if (displayText.length > 14) displayText = displayText.substring(0, 14) + '…';

    // 文字大小根据长度调整
    var fontSize = displayText.length > 8 ? 11 : (displayText.length > 4 ? 14 : 18);
    var fontWeight = displayText.length > 8 ? 600 : 700;

    // 唯一 ID 防止冲突
    var gid = 'amg' + seed;

    var svg = '<svg viewBox="0 0 160 160" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:100%;display:block;">' +
      '<defs>' +
        '<linearGradient id="' + gid + '" x1="0" y1="0" x2="1" y2="1">' +
          '<stop offset="0%" stop-color="' + c1 + '"/>' +
          '<stop offset="50%" stop-color="' + c2 + '"/>' +
          '<stop offset="100%" stop-color="' + c3 + '"/>' +
        '</linearGradient>' +
      '</defs>' +
      '<rect width="160" height="160" fill="url(#' + gid + ')"/>' +
      shapes +
      // 底部渐变遮罩增强文字可读性
      '<rect x="0" y="100" width="160" height="60" fill="rgba(0,0,0,0.25)"/>' +
      '<text x="12" y="140" fill="white" font-family="Noto Sans SC, Roboto, sans-serif" font-size="' + fontSize + '" font-weight="' + fontWeight + '" style="text-shadow:0 1px 4px rgba(0,0,0,0.3);">' +
        _escapeXml(displayText) +
      '</text>' +
    '</svg>';

    return svg;
  }

  function _escapeXml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
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
          <div class="page-header ym-header">
            <div class="page-header-left ym-header-left">
              <div class="ym-wave">
                <svg class="ym-wave-svg" id="ym-wave-svg" viewBox="0 0 320 28" preserveAspectRatio="none" aria-hidden="true">
                  <defs>
                    <linearGradient id="ym-wave-grad" x1="0" y1="0" x2="1" y2="0">
                      <stop offset="0"    style="stop-color:var(--md-primary);stop-opacity:0"/>
                      <stop offset="0.18" style="stop-color:var(--md-primary);stop-opacity:1"/>
                      <stop offset="0.82" style="stop-color:var(--md-tertiary);stop-opacity:1"/>
                      <stop offset="1"    style="stop-color:var(--md-tertiary);stop-opacity:0"/>
                    </linearGradient>
                    <linearGradient id="ym-wave-fill-grad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0" style="stop-color:var(--md-primary);stop-opacity:0.14"/>
                      <stop offset="1" style="stop-color:var(--md-primary);stop-opacity:0"/>
                    </linearGradient>
                    <filter id="ym-wave-blur" x="-25%" y="-120%" width="150%" height="340%">
                      <feGaussianBlur stdDeviation="2.2"/>
                    </filter>
                  </defs>
                  <path id="ym-wave-fill" fill="url(#ym-wave-fill-grad)" stroke="none"/>
                  <path id="ym-wave-glow" fill="none" stroke="url(#ym-wave-grad)" stroke-width="3.5" stroke-linecap="round" filter="url(#ym-wave-blur)" opacity="0.22"/>
                  <path id="ym-wave-main" fill="none" stroke="url(#ym-wave-grad)" stroke-width="2" stroke-linecap="round"/>
                </svg>
              </div>
              <h1 class="page-title ym-title">${App.i18n.t('yourMix.title')}</h1>
            </div>
            <div class="ym-header-art" aria-hidden="true">
              <span class="material-symbols-rounded ym-art-icon ym-art-disc">album</span>
              <span class="material-symbols-rounded ym-art-icon ym-art-note">music_note</span>
              <span class="material-symbols-rounded ym-art-icon ym-art-spark">auto_awesome</span>
            </div>
          </div>
        </div>

        <!-- 每日合集 -->
        <section class="ym-section" id="ym-daily-mix-section">
          <div class="ym-section-header">
            <h2 class="ym-section-title" data-i18n="yourMix.dailyMix">每日合集</h2>
            <span class="ym-section-desc" data-i18n="yourMix.dailyMixDesc">基于你的收听历史自动生成</span>
          </div>
          <div class="ym-mix-grid" id="ym-mix-grid"></div>
        </section>

        <!-- 探索 -->
        <section class="ym-section" id="ym-explore-section">
          <div class="ym-section-header">
            <h2 class="ym-section-title" data-i18n="yourMix.explore">探索</h2>
            <span class="ym-section-desc" data-i18n="yourMix.exploreDesc">发现你尚未听过的曲目</span>
          </div>
          <div class="ym-mix-grid" id="ym-explore-grid"></div>
        </section>

        <!-- 相似类型新推荐 -->
        <section class="ym-section" id="ym-recommend-section">
          <div class="ym-section-header">
            <h2 class="ym-section-title" data-i18n="yourMix.similarRecommend">相似类型新推荐</h2>
            <span class="ym-section-desc" data-i18n="yourMix.similarRecommendDesc">基于你喜欢的流派推荐新曲目</span>
          </div>
          <div class="ym-mix-grid" id="ym-recommend-grid"></div>
        </section>

        <!-- 最近播放前十首 -->
        <section class="ym-section" id="ym-recent-section">
          <div class="ym-section-header">
            <h2 class="ym-section-title" data-i18n="yourMix.recentPlays">最近播放</h2>
            <span class="ym-section-desc" data-i18n="yourMix.recentPlaysDesc">最近播放的 10 首曲目</span>
          </div>
          <ul class="track-list az-list ym-recent-list" id="ym-recent-list"></ul>
        </section>

        <!-- 听歌统计 -->
        <section class="ym-section" id="ym-stats-section">
          <div class="ym-section-header">
            <h2 class="ym-section-title" data-i18n="yourMix.stats">听歌统计</h2>
            <span class="ym-section-desc" data-i18n="yourMix.statsDesc">你的收听数据概览</span>
          </div>
          <div class="ym-stats-container" id="ym-stats-container"></div>
        </section>
      </div>
    `;

    _loadData();
    _startWave();
  };

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
      _renderDailyMix();
      _renderExplore();
      _renderRecommendations();
      _renderRecent();
      _renderStats();
    }).catch(function (err) {
      console.error('[your_mix] load failed:', err);
    });
  }

  // ── 每日合集 ───────────────────────────────────────────────────────────────

  var _mixTypeConfig = {
    artist: { icon: 'person', label: 'yourMix.typeArtist' },
    genre:  { icon: 'graphic_eq', label: 'yourMix.typeGenre' },
    album:  { icon: 'album', label: 'yourMix.typeAlbum' },
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

  // 生成流派合集的几何裁切拼贴封面（2×2 多专辑图布局）
  // 取流派内最多4张不同专辑的封面，裁切拼成 Apple Music 风格的几何网格
  function _buildGenreMosaicCover(mix, size) {
    var fallbackSVG = _generateAbstractArt(mix.name || '', 'genre');
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
    var grid = document.getElementById('ym-mix-grid');
    if (!grid) return;
    grid.innerHTML = '';

    if (!_mixes || _mixes.length === 0) {
      grid.innerHTML = _emptyMixHTML();
      return;
    }

    _mixes.forEach(function (mix, idx) {
      var card = _buildMixCard(mix, idx);
      grid.appendChild(card);
    });
  }

  function _buildMixCard(mix, index) {
    var tracks = mix.tracks;
    var card = document.createElement('div');
    card.className = 'ym-mix-card ym-mix-' + mix.type;

    var cfg = _mixTypeConfig[mix.type] || _mixTypeConfig.artist;

    // 封面：艺人头像 / 专辑封面，无图时回退抽象图形
    var coverHTML = _buildMixCoverHTML(mix, mix.type, 512);

    card.innerHTML = `
      <div class="ym-mix-cover ym-mix-cover-art">
        ${coverHTML}
        <div class="ym-mix-overlay">
          <button class="ym-mix-play-btn" type="button" aria-label="${App.i18n.t('yourMix.play')}">
            <span class="material-symbols-rounded">play_arrow</span>
          </button>
        </div>
      </div>
      <div class="ym-mix-info">
        <span class="ym-mix-type-badge">
          <span class="material-symbols-rounded ym-mix-type-icon">${cfg.icon}</span>
          ${App.i18n.t(cfg.label)}
        </span>
        <p class="ym-mix-name">${App.utils.esc(mix.name)}</p>
        <p class="ym-mix-meta">${App.i18n.t('music.trackCount', { count: tracks.length })}</p>
      </div>
    `;

    // 点击播放
    var playBtn = card.querySelector('.ym-mix-play-btn');
    var cover = card.querySelector('.ym-mix-cover');
    var playHandler = function (e) {
      e.stopPropagation();
      if (tracks.length > 0) {
        App.backend.play_from_list(JSON.stringify(tracks), 0);
      }
    };
    playBtn.addEventListener('click', playHandler);

    // 点击卡片打开合集详情视图
    card.addEventListener('click', function () {
      App.navigate('your_mix', { mix_detail: true, mix: JSON.stringify(mix) });
    });

    return card;
  }

  function _emptyMixHTML() {
    return `
      <div class="ym-empty-section">
        <span class="material-symbols-rounded ym-empty-icon">auto_awesome</span>
        <p>${App.i18n.t('yourMix.emptyMix')}</p>
      </div>
    `;
  }

  // ── 探索 ───────────────────────────────────────────────────────────────────

  function _renderExplore() {
    var grid = document.getElementById('ym-explore-grid');
    if (!grid) return;
    grid.innerHTML = '';

    if (!_exploreData || !_exploreData.tracks || _exploreData.tracks.length === 0) {
      grid.innerHTML = `
        <div class="ym-empty-section">
          <span class="material-symbols-rounded ym-empty-icon">auto_awesome</span>
          <p>${App.i18n.t('yourMix.emptyExplore')}</p>
        </div>
      `;
      return;
    }

    var card = _buildExploreCard(_exploreData);
    grid.appendChild(card);
  }

  function _buildExploreCard(data) {
    var tracks = data.tracks;
    var card = document.createElement('div');
    card.className = 'ym-mix-card ym-mix-explore';

    var coverHTML = _generateAbstractArt(data.title || 'Explore', 'explore');

    card.innerHTML = `
      <div class="ym-mix-cover ym-mix-cover-art">
        ${coverHTML}
        <div class="ym-mix-overlay">
          <button class="ym-mix-play-btn" type="button" aria-label="${App.i18n.t('yourMix.play')}">
            <span class="material-symbols-rounded">play_arrow</span>
          </button>
        </div>
      </div>
      <div class="ym-mix-info">
        <span class="ym-mix-type-badge">
          <span class="material-symbols-rounded ym-mix-type-icon">auto_awesome</span>
          ${App.i18n.t('yourMix.exploreBadge')}
        </span>
        <p class="ym-mix-name">${App.utils.esc(data.title || App.i18n.t('yourMix.explore'))}</p>
        <p class="ym-mix-meta">${App.i18n.t('music.trackCount', { count: tracks.length })}</p>
      </div>
    `;

    var playBtn = card.querySelector('.ym-mix-play-btn');
    var playHandler = function (e) {
      e.stopPropagation();
      if (tracks.length > 0) {
        App.backend.play_from_list(JSON.stringify(tracks), 0);
      }
    };
    playBtn.addEventListener('click', playHandler);

    card.addEventListener('click', function () {
      var mixData = {
        type: 'explore',
        name: data.title || App.i18n.t('yourMix.explore'),
        tracks: tracks,
      };
      App.navigate('your_mix', { mix_detail: true, mix: JSON.stringify(mixData) });
    });

    return card;
  }

  // ── 相似类型新推荐 ─────────────────────────────────────────────────────────

  function _renderRecommendations() {
    var grid = document.getElementById('ym-recommend-grid');
    if (!grid) return;
    grid.innerHTML = '';

    if (!_recommendations || _recommendations.length === 0) {
      grid.innerHTML = `
        <div class="ym-empty-section">
          <span class="material-symbols-rounded ym-empty-icon">insights</span>
          <p>${App.i18n.t('yourMix.emptyRecommend')}</p>
        </div>
      `;
      return;
    }

    _recommendations.forEach(function (rec, idx) {
      var card = _buildRecommendCard(rec, idx);
      grid.appendChild(card);
    });
  }

  function _buildRecommendCard(rec, index) {
    var tracks = rec.tracks;
    var card = document.createElement('div');
    card.className = 'ym-mix-card ym-mix-recommend';

    var coverHTML = _generateAbstractArt(rec.name, 'recommend');

    card.innerHTML = `
      <div class="ym-mix-cover ym-mix-cover-art">
        ${coverHTML}
        <div class="ym-mix-overlay">
          <button class="ym-mix-play-btn" type="button" aria-label="${App.i18n.t('yourMix.play')}">
            <span class="material-symbols-rounded">play_arrow</span>
          </button>
        </div>
      </div>
      <div class="ym-mix-info">
        <span class="ym-mix-type-badge">
          <span class="material-symbols-rounded ym-mix-type-icon">insights</span>
          ${App.i18n.t('yourMix.recommendBadge')}
        </span>
        <p class="ym-mix-name">${App.utils.esc(rec.name)}</p>
        <p class="ym-mix-meta">${App.i18n.t('music.trackCount', { count: tracks.length })}</p>
      </div>
    `;

    var playBtn = card.querySelector('.ym-mix-play-btn');
    var playHandler = function (e) {
      e.stopPropagation();
      if (tracks.length > 0) {
        App.backend.play_from_list(JSON.stringify(tracks), 0);
      }
    };
    playBtn.addEventListener('click', playHandler);

    card.addEventListener('click', function () {
      var mixData = {
        type: 'genre',
        name: rec.name,
        tracks: tracks,
      };
      App.navigate('your_mix', { mix_detail: true, mix: JSON.stringify(mixData) });
    });

    return card;
  }

  // ── 合集详情视图 ───────────────────────────────────────────────────────────

  function _renderMixDetail(container, params) {
    var mix;
    try {
      mix = JSON.parse(params.mix);
    } catch (e) {
      container.innerHTML = '<div class="empty-state"><p>' + App.i18n.t('common.error') + '</p></div>';
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
        <div class="playlist-search-wrapper" style="padding: 0 12px 12px;">
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
    searchInput.addEventListener('input', function (e) {
      filterStr = e.target.value.trim().toLowerCase();
      _renderDetailList(tracks, filterStr);
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

  // ── 最近播放前十首 ─────────────────────────────────────────────────────────

  function _renderRecent() {
    var ul = document.getElementById('ym-recent-list');
    if (!ul) return;
    ul.innerHTML = '';

    var recent = _historyTracks.slice(0, 10);

    if (recent.length === 0) {
      ul.innerHTML = `
        <div class="ym-empty-section">
          <span class="material-symbols-rounded ym-empty-icon">history</span>
          <p>${App.i18n.t('yourMix.emptyRecent')}</p>
        </div>
      `;
      return;
    }

    var frag = document.createDocumentFragment();
    recent.forEach(function (track, idx) {
      var li = App.utils.trackRow(track, idx + 1, function (clickedTrack, playIdx) {
        App.backend.play_from_list(JSON.stringify(recent), playIdx);
      }, true);
      frag.appendChild(li);
    });
    ul.appendChild(frag);
  }

  // ── 听歌统计 ───────────────────────────────────────────────────────────────

  function _renderStats() {
    var container = document.getElementById('ym-stats-container');
    if (!container) return;
    container.innerHTML = '';

    if (!_stats) return;

    // 统计概览卡片
    var overview = document.createElement('div');
    overview.className = 'ym-stats-overview';

    var totalHours = (_stats.totalDurationMs / 3600000).toFixed(1);
    overview.innerHTML = `
      <div class="ym-stat-card">
        <span class="material-symbols-rounded ym-stat-icon">play_circle</span>
        <div class="ym-stat-value">${_stats.totalPlays}</div>
        <div class="ym-stat-label">${App.i18n.t('yourMix.totalPlays')}</div>
      </div>
      <div class="ym-stat-card">
        <span class="material-symbols-rounded ym-stat-icon">music_note</span>
        <div class="ym-stat-value">${_stats.uniqueTracks}</div>
        <div class="ym-stat-label">${App.i18n.t('yourMix.uniqueTracks')}</div>
      </div>
      <div class="ym-stat-card">
        <span class="material-symbols-rounded ym-stat-icon">schedule</span>
        <div class="ym-stat-value">${totalHours}<span class="ym-stat-unit">${App.i18n.t('yourMix.hours')}</span></div>
        <div class="ym-stat-label">${App.i18n.t('yourMix.totalListenTime')}</div>
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

    // 无统计数据时
    if (_stats.totalPlays === 0) {
      container.innerHTML = `
        <div class="ym-empty-section">
          <span class="material-symbols-rounded ym-empty-icon">insights</span>
          <p>${App.i18n.t('yourMix.emptyStats')}</p>
        </div>
      `;
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

  // ── 头部音浪（渐变 / 发光 / BPM 律动 / 氛围色）─────────────────────────────

  var _waveRaf = 0;
  var _bpmCache = {};
  var _bpmPending = {};

  function _currentBpm() {
    var t = App.state.currentTrack;
    if (!t || !t.id) return 0;
    if (_bpmCache[t.id] !== undefined) return _bpmCache[t.id];
    if (!_bpmPending[t.id] && window.__electronAPI && window.__electronAPI.invoke) {
      _bpmPending[t.id] = true;
      window.__electronAPI.invoke('get_track_analysis', t.id).then(function (a) {
        _bpmCache[t.id] = (a && a.bpm > 0) ? a.bpm : 0;
      }).catch(function () { _bpmCache[t.id] = 0; });
    }
    return 0;
  }

  function _stopWave() {
    if (_waveRaf) { cancelAnimationFrame(_waveRaf); _waveRaf = 0; }
  }

  function _startWave() {
    _stopWave();
    var svg = document.getElementById('ym-wave-svg');
    if (!svg) return;
    var mainPath = document.getElementById('ym-wave-main');
    var glowPath = document.getElementById('ym-wave-glow');
    var fillPath = document.getElementById('ym-wave-fill');
    var artEl = document.querySelector('.ym-header-art');

    var W = 320, H = 28, MID = 12;
    var st = { phase: 0, beatPhase: 0, breath: 0, amp: 1.6, glow: 0.22, last: 0 };

    function buildWave(amp, phase) {
      var d = '';
      for (var x = 0; x <= W; x += 8) {
        var env = Math.sin((x / W) * Math.PI);
        var y = MID + (Math.sin(x * 0.045 + phase) * 0.72 +
                       Math.sin(x * 0.021 - phase * 0.62) * 0.28) * amp * env;
        d += (x === 0 ? 'M' : 'L') + x.toFixed(1) + ' ' + y.toFixed(2);
      }
      return d;
    }

    function draw(d) {
      mainPath.setAttribute('d', d);
      glowPath.setAttribute('d', d);
      glowPath.setAttribute('opacity', st.glow.toFixed(3));
      fillPath.setAttribute('d', d + 'L' + W + ' ' + H + 'L0 ' + H + 'Z');
    }

    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      draw(buildWave(2, 0));
      return;
    }

    function frame(ts) {
      if (!document.getElementById('ym-wave-svg')) { _waveRaf = 0; return; }
      if (!st.last) st.last = ts;
      var dt = Math.min(0.05, (ts - st.last) / 1000);
      st.last = ts;

      var playing = App.state.playbackState === 'playing';
      var bpm = playing ? _currentBpm() : 0;

      var targetAmp, targetGlow, speed;
      if (playing && bpm > 0) {
        st.beatPhase += dt * bpm / 60;
        var pulse = Math.pow(1 - (st.beatPhase % 1), 2.4);
        targetAmp = 1.8 + pulse * 4.0;
        targetGlow = 0.22 + pulse * 0.33;
        speed = 2.4;
      } else if (playing) {
        st.breath += dt;
        targetAmp = 2.2 + Math.sin(st.breath * Math.PI / 1.4) * 1.0;
        targetGlow = 0.3;
        speed = 1.8;
      } else {
        targetAmp = 1.6;
        targetGlow = 0.22;
        speed = 1.0;
      }
      st.phase += dt * speed;
      var k = Math.min(1, dt * 9);
      st.amp += (targetAmp - st.amp) * k;
      st.glow += (targetGlow - st.glow) * k;

      draw(buildWave(st.amp, st.phase));

      if (artEl) {
        var pulseAmt = playing ? Math.max(0, (st.amp - 1.8) / 4.0) : 0;
        artEl.style.transform = 'scale(' + (1 + Math.min(1, pulseAmt) * 0.05).toFixed(3) + ')';
      }

      _waveRaf = requestAnimationFrame(frame);
    }
    _waveRaf = requestAnimationFrame(frame);
  }

  // ── 播放状态更新 ─────────────────────────────────────────────────────────────

  page.updatePlayState = function () {
    var currentId = App.state.currentTrack ? App.state.currentTrack.id : null;

    var ul = document.getElementById('ym-recent-list');
    if (ul) {
      Array.from(ul.children).forEach(function (li) {
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
    if (document.getElementById('ym-mix-grid')) {
      _loadData();
    }
  };

})();