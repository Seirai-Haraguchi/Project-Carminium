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
  let _heroTookExplore = false;
  let _heroTookRecs = 0;
  let _heroTookLeadMix = false;


  var _mixPalettes = {
    artist: [
      ['#FF6B6B', '#FF8E53', '#FECA57'],
      ['#5B7FFF', '#3B5BDB', '#7B68EE'],
      ['#00B894', '#00CEC9', '#55EFC4'],
      ['#E84393', '#FD79A8', '#FDCB6E'],
      ['#6C5CE7', '#A29BFE', '#74B9FF'],
    ],
    genre: [
      ['#0984E3', '#74B9FF', '#A8E6FF'],
      ['#00B894', '#55EFC4', '#B8E994'],
      ['#E17055', '#FDCB6E', '#FFEAA7'],
      ['#6C5CE7', '#A29BFE', '#DFE6FD'],
      ['#E84393', '#FD79A8', '#FDCB6E'],
    ],
    album: [
      ['#2D3436', '#636E72', '#B2BEC3'],
      ['#6C5CE7', '#341F97', '#5F27CD'],
      ['#0A3D62', '#3C6E91', '#82CCDD'],
      ['#B71540', '#C44569', '#F8BBD0'],
      ['#0F2027', '#203A43', '#2C5364'],
    ],
    explore: [
      ['#FF6B6B', '#7B2FF8', '#F107A3'],
      ['#00F5A0', '#00D9F5', '#3A47D5'],
      ['#FC5C7D', '#6A82FB', '#05E1FF'],
      ['#F7971E', '#FFD200', '#FFE066'],
    ],
    recommend: [
      ['#11998E', '#38EF7D'],
      ['#4776E6', '#8E54E9'],
      ['#E44D26', '#F5A623'],
      ['#1A2980', '#26D0CE'],
    ],
  };

  function _hashString(str) {
    var hash = 0;
    if (!str) return hash;
    for (var i = 0; i < str.length; i++) {
      hash = str.charCodeAt(i) + ((hash << 5) - hash);
      hash = hash & hash;
    }
    return Math.abs(hash);
  }

  function _getPalette(type, seed) {
    var palettes = _mixPalettes[type] || _mixPalettes.artist;
    return palettes[seed % palettes.length];
  }

  function _generateAbstractArt(name, type) {
    var seed = _hashString(name + type);
    var palette = _getPalette(type, seed);
    var c1 = palette[0];
    var c2 = palette.length > 1 ? palette[1] : palette[0];
    var c3 = palette.length > 2 ? palette[2] : palette[1] || palette[0];

    var mode = seed % 4;
    var shapes = '';

    if (mode === 0) {
      var cx = 60 + (seed % 40);
      var cy = 40 + (seed % 50);
      var r = 35 + (seed % 25);
      shapes += '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="rgba(255,255,255,0.12)" />';
      shapes += '<circle cx="' + ((cx + 50) % 160) + '" cy="' + ((cy + 60) % 160) + '" r="' + (r * 0.6) + '" fill="rgba(255,255,255,0.08)" />';
      shapes += '<circle cx="' + ((cx + 100) % 160) + '" cy="' + ((cy + 30) % 160) + '" r="' + (r * 0.35) + '" fill="' + c3 + '" opacity="0.3" />';
    } else if (mode === 1) {
      var offset = seed % 40;
      for (var i = 0; i < 5; i++) {
        var y = 20 + i * 28 + offset;
        shapes += '<path d="M0,' + y + ' Q40,' + (y - 15) + ' 80,' + y + ' T160,' + y + '" stroke="rgba(255,255,255,' + (0.06 + i * 0.03) + ')" stroke-width="' + (6 - i) + '" fill="none" />';
      }
    } else if (mode === 2) {
      var tx = (seed % 60) + 20;
      var ty = (seed % 40) + 20;
      shapes += '<polygon points="' + tx + ',' + ty + ' ' + (tx + 70) + ',' + (ty + 50) + ' ' + (tx - 20) + ',' + (ty + 60) + '" fill="rgba(255,255,255,0.1)" />';
      shapes += '<polygon points="' + (tx + 40) + ',' + (ty + 70) + ' ' + (tx + 100) + ',' + (ty + 20) + ' ' + (tx + 120) + ',' + (ty + 90) + '" fill="' + c3 + '" opacity="0.15" />';
    } else {
      shapes += '<defs><radialGradient id="rg' + seed + '" cx="70%" cy="30%" r="60%"><stop offset="0%" stop-color="rgba(255,255,255,0.2)"/><stop offset="100%" stop-color="transparent"/></radialGradient></defs>';
      shapes += '<rect x="0" y="0" width="160" height="160" fill="url(#rg' + seed + ')" />';
      shapes += '<path d="M0,' + (80 + seed % 30) + ' Q80,' + (40 + seed % 40) + ' 160,' + (90 + seed % 20) + '" stroke="rgba(255,255,255,0.15)" stroke-width="20" fill="none" stroke-linecap="round" />';
    }

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


  page.render = function (container, params) {
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

    ['ym-mix-rail', 'ym-explore-rail', 'ym-recommend-rail'].forEach(_initRail);

    _renderGreeting();
    _loadData();
  };


  var _greetingBound = false;

  function _greetingKey() {
    var h = new Date().getHours();
    if (h >= 5 && h < 9)   return 'yourMix.greetMorning';
    if (h >= 9 && h < 12)  return 'yourMix.greetForenoon';
    if (h >= 12 && h < 14) return 'yourMix.greetNoon';
    if (h >= 14 && h < 18) return 'yourMix.greetAfternoon';
    if (h >= 18 && h < 23) return 'yourMix.greetEvening';
    if (h >= 23)           return 'yourMix.greetLate';
    return 'yourMix.greetLateNight';
  }

  function _greetingSubKey() {
    var h = new Date().getHours();
    if (h >= 5 && h < 12)  return 'yourMix.greetSubMorning';
    if (h >= 12 && h < 18) return 'yourMix.greetSubAfternoon';
    if (h >= 18 && h < 23) return 'yourMix.greetSubEvening';
    return 'yourMix.greetSubNight';
  }

  function _renderGreeting() {
    var el = document.getElementById('ym-greeting');
    if (!el) return;
    el.textContent = App.i18n.t(_greetingKey());

    var sub = document.getElementById('ym-subtitle');
    if (sub) sub.textContent = App.i18n.t(_greetingSubKey());

    if (_greetingBound) return;
    _greetingBound = true;
  }

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

  function _initRail(railId) {
    var rail = document.getElementById(railId);
    if (!rail) return;
    var wrap = rail.closest('[data-rail-wrap]');
    if (!wrap) return;
    var prev = wrap.querySelector('.ym-rail-btn--prev');
    var next = wrap.querySelector('.ym-rail-btn--next');

    function step() {
      return Math.max(rail.clientWidth * 0.82, 320);
    }

    function sync() {
      var max = rail.scrollWidth - rail.clientWidth;
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
    if (window.ResizeObserver) {
      var ro = new ResizeObserver(sync);
      ro.observe(rail);
    }
    requestAnimationFrame(sync);
    rail._ymSync = sync;
  }

  function _syncRail(railId) {
    var rail = document.getElementById(railId);
    if (rail && rail._ymSync) rail._ymSync();
  }

  function _loadData() {
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

  function _tintAll() {
    if (!window.CardColor) return;
    var isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    ['ym-hero', 'ym-mix-rail', 'ym-explore-rail', 'ym-recommend-rail'].forEach(function (id) {
      window.CardColor.tintCards(document.getElementById(id), isDark);
    });
  }


  var _mixTypeConfig = {
    artist:  { icon: 'person', label: 'yourMix.typeArtist' },
    genre:   { icon: 'graphic_eq', label: 'yourMix.typeGenre' },
    album:   { icon: 'album', label: 'yourMix.typeAlbum' },
    explore: { icon: 'auto_awesome', label: 'yourMix.exploreBadge' },
    recommend: { icon: 'insights', label: 'yourMix.recommendBadge' },
  };

  function _firstCoverTrack(tracks) {
    if (!tracks) return null;
    for (var i = 0; i < tracks.length; i++) {
      if (tracks[i].has_cover) return tracks[i];
    }
    return null;
  }

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

  function _buildGenreMosaicCover(mix, size, artType) {
    var fallbackSVG = _generateAbstractArt(mix.name || '', artType || 'genre');
    if (!mix.tracks || !window.coverUrl) return fallbackSVG;

    var coverTracks = _distinctAlbumCoverTracks(mix.tracks, 4);
    if (coverTracks.length === 0) return fallbackSVG;

    var sz = size || 256;
    var onError = 'onerror="this.parentElement.style.display=\'none\'"';
    var html = '<div class="ym-mosaic-cover">';

    if (coverTracks.length === 1) {
      html += '<div class="ym-mosaic-cell m1"><img src="' + window.coverUrl(coverTracks[0].id, sz) + '" alt="" loading="lazy" onerror="this.outerHTML=this.closest(\'.ym-mosaic-wrapper\').dataset.fb" ></div>';
    } else if (coverTracks.length === 2) {
      html += '<div class="ym-mosaic-cell m2-l"><img src="' + window.coverUrl(coverTracks[0].id, sz) + '" alt="" loading="lazy" ' + onError + '></div>';
      html += '<div class="ym-mosaic-cell m2-r"><img src="' + window.coverUrl(coverTracks[1].id, sz) + '" alt="" loading="lazy" ' + onError + '></div>';
    } else if (coverTracks.length === 3) {
      html += '<div class="ym-mosaic-cell m3-l"><img src="' + window.coverUrl(coverTracks[0].id, sz) + '" alt="" loading="lazy" ' + onError + '></div>';
      html += '<div class="ym-mosaic-cell m3-tr"><img src="' + window.coverUrl(coverTracks[1].id, sz) + '" alt="" loading="lazy" ' + onError + '></div>';
      html += '<div class="ym-mosaic-cell m3-br"><img src="' + window.coverUrl(coverTracks[2].id, sz) + '" alt="" loading="lazy" ' + onError + '></div>';
    } else {
      for (var i = 0; i < 4; i++) {
        html += '<div class="ym-mosaic-cell m4-' + ['tl','tr','bl','br'][i] + '"><img src="' + window.coverUrl(coverTracks[i].id, sz) + '" alt="" loading="lazy" ' + onError + '></div>';
      }
    }

    html += '</div>';
    return '<div class="ym-mosaic-wrapper" data-fb="' + fallbackSVG.replace(/"/g, '&quot;') + '">' + html + '</div>';
  }

  function _buildMixCoverHTML(mix, artType, size) {
    var fallbackSVG = _generateAbstractArt(mix.name || '', artType || mix.type);
    if (mix.type === 'artist' && mix.name && window.artistImageUrl) {
      var aurl = window.artistImageUrl(mix.name);
      if (aurl) {
        return '<img src="' + aurl + '" alt="" loading="lazy" onerror="this.outerHTML=this.dataset.fb" data-fb="' + fallbackSVG.replace(/"/g, '&quot;') + '">';
      }
    }
    if (mix.type === 'genre') {
      return _buildGenreMosaicCover(mix, size);
    }
    if (mix.tracks && mix.tracks.length > 0) {
      var coverTrack = _firstCoverTrack(mix.tracks);
      if (coverTrack && window.coverUrl) {
        var curl = window.coverUrl(coverTrack.id, size || 512);
        return '<img src="' + curl + '" alt="" loading="lazy" onerror="this.outerHTML=this.dataset.fb" data-fb="' + fallbackSVG.replace(/"/g, '&quot;') + '">';
      }
    }
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

    _mixes.slice(_heroTookLeadMix ? 1 : 0).forEach(function (mix) {
      rail.appendChild(_buildMixCard(_mixPick(mix)));
    });
    if (_heroTookLeadMix && _mixes.length === 1) {
      _hideSection('ym-daily-mix-section');
    }
    _syncRail('ym-mix-rail');
  }

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
    _heroTookRecs = Math.min(4, Math.max(0, recPickCount - (_heroTookExplore ? 0 : 1)));

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

  function _buildMixCard(pick, opts) {
    opts = opts || {};
    var tracks = pick.tracks || [];
    var cfg = _mixTypeConfig[pick.type] || { icon: 'auto_awesome', label: 'yourMix.exploreBadge' };

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
    return `
      <div class="empty-state">
        <span class="material-symbols-rounded empty-icon">${icon || 'auto_awesome'}</span>
        <h2 class="empty-title">${App.i18n.t(titleKey || 'yourMix.emptyMix')}</h2>
        <p class="empty-sub">${App.i18n.t(subKey || 'yourMix.emptyMixHint')}</p>
      </div>
    `;
  }


  function _renderExplore() {
    var rail = document.getElementById('ym-explore-rail');
    if (!rail) return;
    rail.innerHTML = '';

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


  function _renderRecommendations() {
    var rail = document.getElementById('ym-recommend-rail');
    if (!rail) return;
    rail.innerHTML = '';

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


  function _renderRecent() {
    var host = document.getElementById('ym-recent-list');
    if (!host) return;
    host.innerHTML = '';

    var recent = _historyTracks.slice(0, 10);
    if (recent.length === 0) {
      _hideSection('ym-recent-section');
      return;
    }

    var frag = document.createDocumentFragment();
    recent.forEach(function (track, i) {
      frag.appendChild(App.utils.trackRow(track, i + 1, function (clicked, idx) {
        App.backend.play_from_list(JSON.stringify(recent), idx);
      }, true));
    });
    host.appendChild(frag);
  }


  function _renderStats() {
    var container = document.getElementById('ym-stats-container');
    if (!container) return;
    container.innerHTML = '';

    if (!_stats || _stats.totalPlays === 0) {
      _hideSection('ym-stats-section');
      return;
    }

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

    if (_stats.dailyActivity && _stats.dailyActivity.length > 0) {
      var chartCard = document.createElement('div');
      chartCard.className = 'ym-stats-chart-card';
      chartCard.innerHTML = _buildActivityChart(_stats.dailyActivity);
      container.appendChild(chartCard);
    }

    var listsRow = document.createElement('div');
    listsRow.className = 'ym-stats-lists';

    if (_stats.topArtists && _stats.topArtists.length > 0) {
      listsRow.appendChild(_buildTopList(
        App.i18n.t('yourMix.topArtists'),
        _stats.topArtists.map(function (a) {
          return { name: a.name, sub: App.i18n.t('yourMix.playCount', { count: a.play_count }), count: a.play_count };
        }),
        'person'
      ));
    }

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


  page.updatePlayState = function () {
    var currentId = App.state.currentTrack ? App.state.currentTrack.id : null;

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