/**
 * Carminium — Your Mix（主页）
 * 包含：每日合集（基于艺人/流派/专辑）、最近播放前十首、听歌统计
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

  page.render = function (container) {
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
              <h1 class="page-title ym-title"><span>YOUR</span><span>MIX</span></h1>
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
    // 并行加载历史记录、统计数据和每日合集
    Promise.all([
      App.utils.call('get_play_history', 500),
      App.utils.call('get_play_stats'),
      App.utils.call('get_daily_mixes'),
    ]).then(function (results) {
      _historyTracks = JSON.parse(results[0]);
      _stats = JSON.parse(results[1]);
      _mixes = JSON.parse(results[2]);
      _renderDailyMix();
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

    // 封面：取第一首有封面的曲目
    var coverTrack = tracks.find(function (t) { return t.has_cover; }) || tracks[0];

    var bgStyle = '';
    var coverHTML = '';
    if (coverTrack && coverTrack.has_cover) {
      coverHTML = '<img src="' + window.coverUrl(coverTrack.id) + '" alt="" loading="lazy">';
    } else {
      bgStyle = ' style="background:' + App.utils.hashColor(coverTrack ? (coverTrack.album || coverTrack.title || mix.name) : mix.name) + '"';
      coverHTML = '<span class="ym-mix-cover-letter">' + App.utils.initial(coverTrack ? (coverTrack.album || coverTrack.title) : mix.name) + '</span>';
    }

    card.innerHTML = `
      <div class="ym-mix-cover"${bgStyle}>
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
    cover.addEventListener('click', playHandler);

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
  //
  // 行为：
  //   - 未播放：低振幅匀速漂移
  //   - 播放中且有 BPM：相位按 bpm 推进，每拍一次"攻击→衰减"的振幅/辉光脉冲
  //   - 播放中但无 BPM：缓慢呼吸
  // 颜色取自 --md-primary / --md-tertiary / --md-secondary，
  // 这些变量随封面主色动态更新，天然获得"氛围色"。

  var _waveRaf = 0;
  var _bpmCache = {};    // trackId -> bpm（0 = 无数据）
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
        var env = Math.sin((x / W) * Math.PI); // 两端收敛为 0，中间振幅最大
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

    // 减少动态效果偏好：只画一帧静态波形
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      draw(buildWave(2, 0));
      return;
    }

    function frame(ts) {
      // 页面已切走（元素被移除）→ 自动停止
      if (!document.getElementById('ym-wave-svg')) { _waveRaf = 0; return; }
      if (!st.last) st.last = ts;
      var dt = Math.min(0.05, (ts - st.last) / 1000);
      st.last = ts;

      var playing = App.state.playbackState === 'playing';
      var bpm = playing ? _currentBpm() : 0;

      var targetAmp, targetGlow, speed;
      if (playing && bpm > 0) {
        st.beatPhase += dt * bpm / 60;
        var pulse = Math.pow(1 - (st.beatPhase % 1), 2.4); // 拍点攻击→衰减
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
      var k = Math.min(1, dt * 9); // 平滑趋近目标值
      st.amp += (targetAmp - st.amp) * k;
      st.glow += (targetGlow - st.glow) * k;

      draw(buildWave(st.amp, st.phase));

      // 插画随节拍轻微脉冲
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

    // 更新最近播放列表高亮
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
  };

  // 历史变化时刷新（若当前在 Your Mix 页）
  page.onHistoryChanged = function () {
    if (document.getElementById('ym-mix-grid')) {
      _loadData();
    }
  };

})();
