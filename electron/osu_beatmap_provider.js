/**
 * OsuBeatmapProvider — osu! 谱面数据提供器
 *
 * 通过 sayobot.cn API 根据歌曲元数据（标题、艺术家）搜索 beatmap，
 * 匹配音频时长后下载 .osu 文件，解析 TimingPoints 提取 BPM 和高潮段（Kiai）。
 *
 * 设计原则：
 *   - 所有网络操作有超时保护（5s），超时或失败时返回 null
 *   - 不影响主流程：失败时 TransitionPlanner 回退到频谱分析
 *   - 无需 API key，使用 sayobot 公开 API
 *   - 结果缓存由 AnalysisCache 统一管理
 *
 * .osu 文件 TimingPoints 格式：
 *   time,beatLength,meter,sampleSet,sampleIndex,volume,uninherited,effects
 *   - uninherited=1: BPM = 60000 / beatLength
 *   - effects & 1: Kiai 段落（高潮）
 */
'use strict';

const https = require('https');
const http = require('http');
const { URL } = require('url');

const SEARCH_TIMEOUT_MS = 5000;
const DOWNLOAD_TIMEOUT_MS = 5000;
const DURATION_MATCH_TOLERANCE_MS = 3000; // 时长匹配容差 ±3 秒

class OsuBeatmapProvider {
  /**
   * 搜索并解析 beatmap 数据。
   * @param {string} title - 歌曲标题
   * @param {string} artist - 艺术家
   * @param {number} durationMs - 音频时长（ms），用于匹配
   * @returns {Promise<object|null>} { bpm, beatLengthMs, kiaiSections, source } 或 null
   */
  async search(title, artist, durationMs) {
    if (!title) return null;

    try {
      const query = this._buildQuery(title, artist);
      console.log('[OsuBeatmapProvider] Searching:', query);

      // 1. 搜索 beatmap sets
      const searchResults = await this._searchBeatmaps(query);
      if (!searchResults || searchResults.length === 0) {
        console.log('[OsuBeatmapProvider] No search results');
        return null;
      }

      // 2. 匹配时长
      const matched = this._matchByDuration(searchResults, durationMs);
      if (!matched) {
        console.log('[OsuBeatmapProvider] No duration match found');
        return null;
      }

      console.log('[OsuBeatmapProvider] Matched beatmap:', matched.sid, matched.bid);

      // 3. 下载 .osu 文件
      const osuContent = await this._downloadOsuFile(matched.bid);
      if (!osuContent) {
        console.log('[OsuBeatmapProvider] Failed to download .osu file');
        return null;
      }

      // 4. 解析 TimingPoints
      const parsed = this._parseTimingPoints(osuContent);
      if (!parsed || parsed.bpm <= 0) {
        console.log('[OsuBeatmapProvider] Failed to parse TimingPoints');
        return null;
      }

      console.log('[OsuBeatmapProvider] Parsed: BPM=' + parsed.bpm +
        ', Kiai sections=' + (parsed.kiaiSections ? parsed.kiaiSections.length : 0));

      return {
        bpm: parsed.bpm,
        beatLengthMs: parsed.beatLengthMs,
        kiaiSections: parsed.kiaiSections || [],
        source: 'sayobot',
        beatmapId: matched.bid,
        beatmapSetId: matched.sid,
      };
    } catch (e) {
      console.warn('[OsuBeatmapProvider] Search failed:', e.message);
      return null;
    }
  }

  // ── 搜索 ──────────────────────────────────────────────────────────────

  _buildQuery(title, artist) {
    // 清理常见后缀和括号内容
    let cleanTitle = title
      .replace(/\(.*?\)/g, '')
      .replace(/\[.*?\]/g, '')
      .replace(/\s*(TV Size|Full Version|Short Ver\.?)\s*/gi, '')
      .trim();

    if (artist) {
      // 去掉 "feat." 后面的内容
      let cleanArtist = artist.split(/\s*(feat\.|ft\.|vs\.|with)\s*/i)[0].trim();
      return cleanTitle + ' ' + cleanArtist;
    }
    return cleanTitle;
  }

  /**
   * 调用 sayobot 搜索 API。
   * 尝试多个端点格式，第一个成功即返回。
   */
  async _searchBeatmaps(query) {
    // 尝试 sayobot API（多种可能的端点格式）
    const endpoints = [
      'https://api.sayobot.cn/beatmap/search?query=' + encodeURIComponent(query) + '&mode=0&limit=10',
      'https://sayobot.cn/api/beatmap/search?q=' + encodeURIComponent(query) + '&limit=10',
    ];

    for (const url of endpoints) {
      try {
        const data = await this._fetchJson(url, SEARCH_TIMEOUT_MS);
        if (data && this._extractBeatmapList(data).length > 0) {
          return this._extractBeatmapList(data);
        }
      } catch (e) {
        // 继续尝试下一个端点
        continue;
      }
    }

    return null;
  }

  /**
   * 从 API 响应中提取 beatmap 列表。
   * 兼容多种可能的响应格式。
   */
  _extractBeatmapList(data) {
    if (!data) return [];

    // 格式1: { data: { results: [...] } } 或 { data: [...] }
    if (data.data) {
      if (Array.isArray(data.data)) return data.data.map(this._normalizeBeatmap);
      if (data.data.results && Array.isArray(data.data.results)) return data.data.results.map(this._normalizeBeatmap);
      if (data.data.bid && data.data.sid) return [this._normalizeBeatmap(data.data)];
    }

    // 格式2: { results: [...] }
    if (data.results && Array.isArray(data.results)) return data.results.map(this._normalizeBeatmap);

    // 格式3: 直接是数组
    if (Array.isArray(data)) return data.map(this._normalizeBeatmap);

    // 格式4: { beatmaps: [...] }
    if (data.beatmaps && Array.isArray(data.beatmaps)) return data.beatmaps.map(this._normalizeBeatmap);

    // 格式5: { sets: [{ difficulties: [...] }] }
    if (data.sets && Array.isArray(data.sets)) {
      const all = [];
      for (const set of data.sets) {
        if (set.difficulties) {
          for (const diff of set.difficulties) {
            all.push(this._normalizeBeatmap({ ...diff, sid: set.sid || set.id }));
          }
        }
      }
      return all;
    }

    return [];
  }

  /**
   * 将各种格式的 beatmap 数据统一为 { bid, sid, length, title, artist } 结构。
   */
  _normalizeBeatmap(raw) {
    const bid = raw.bid || raw.beatmap_id || raw.id || raw.beatmapId;
    const sid = raw.sid || raw.beatmapset_id || raw.beatmapSetId || raw.set_id || raw.setParentId;
    // length 可能是秒数或毫秒
    let length = raw.length || raw.total_length || raw.hit_length || raw.time;
    if (typeof length === 'string') {
      // 格式 "1:23" → 秒
      const parts = length.split(':');
      if (parts.length === 2) {
        length = parseInt(parts[0], 10) * 60 + parseFloat(parts[1]);
      }
    }
    if (typeof length === 'number' && length < 10000) {
      length = length * 1000; // 秒 → 毫秒
    }
    return {
      bid: bid,
      sid: sid,
      lengthMs: length || 0,
      title: raw.title || '',
      artist: raw.artist || '',
    };
  }

  // ── 时长匹配 ──────────────────────────────────────────────────────────

  _matchByDuration(beatmaps, targetDurationMs) {
    if (!targetDurationMs || targetDurationMs <= 0) {
      // 无目标时长，返回第一个
      return beatmaps[0] || null;
    }

    let bestMatch = null;
    let bestDiff = Infinity;

    for (const bm of beatmaps) {
      if (!bm.lengthMs || bm.lengthMs <= 0) continue;
      const diff = Math.abs(bm.lengthMs - targetDurationMs);
      if (diff < bestDiff) {
        bestDiff = diff;
        bestMatch = bm;
      }
    }

    // 检查容差
    if (bestMatch && bestDiff <= DURATION_MATCH_TOLERANCE_MS) {
      return bestMatch;
    }

    // 如果没有精确匹配，放宽到 5 秒
    if (bestMatch && bestDiff <= 5000) {
      console.log('[OsuBeatmapProvider] Loose match with diff:', bestDiff, 'ms');
      return bestMatch;
    }

    return null;
  }

  // ── 下载 .osu 文件 ─────────────────────────────────────────────────────

  async _downloadOsuFile(bid) {
    if (!bid) return null;

    const endpoints = [
      'https://api.sayobot.cn/beatmap/download/' + bid + '?dryRun=1',
      'https://sayobot.cn/osu/' + bid,
    ];

    for (const url of endpoints) {
      try {
        const content = await this._fetchText(url, DOWNLOAD_TIMEOUT_MS);
        if (content && content.includes('[TimingPoints]')) {
          return content;
        }
      } catch {
        continue;
      }
    }

    return null;
  }

  // ── .osu 文件解析 ──────────────────────────────────────────────────────

  /**
   * 解析 .osu 文件的 TimingPoints 段落。
   * 格式：time,beatLength,meter,sampleSet,sampleIndex,volume,uninherited,effects
   *
   * 提取：
   *   - BPM（从第一个 uninherited timing point）
   *   - Kiai 段落（effects 位 0 = Kiai）
   */
  _parseTimingPoints(content) {
    if (!content || typeof content !== 'string') return null;

    // 提取 [TimingPoints] 段落
    const tpStart = content.indexOf('[TimingPoints]');
    if (tpStart < 0) return null;

    const tpEnd = content.indexOf('[', tpStart + 14);
    const tpSection = tpEnd > 0
      ? content.substring(tpStart + 14, tpEnd)
      : content.substring(tpStart + 14);

    const lines = tpSection.split('\n');
    const timingPoints = [];
    let baseBPM = 0;
    let baseBeatLength = 0;

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('[')) continue;

      const parts = trimmed.split(',');
      if (parts.length < 2) continue;

      const time = parseFloat(parts[0]);
      const beatLength = parseFloat(parts[1]);
      const uninherited = parts.length >= 7 ? parseInt(parts[6], 10) : 1;
      const effects = parts.length >= 8 ? parseInt(parts[7], 10) : 0;

      if (isNaN(time) || isNaN(beatLength)) continue;

      if (uninherited === 1 || uninherited === undefined) {
        // 非 inherited 点：beatLength = ms per beat
        if (baseBeatLength === 0 && beatLength > 0) {
          baseBeatLength = beatLength;
          baseBPM = Math.round(60000 / beatLength);
        }
        timingPoints.push({ time, beatLength, uninherited: true, effects });
      } else {
        // inherited 点：记录 Kiai 标志
        timingPoints.push({ time, beatLength, uninherited: false, effects });
      }
    }

    if (baseBPM <= 0) return null;

    // 提取 Kiai 段落
    const kiaiSections = this._extractKiaiSections(timingPoints);

    return {
      bpm: baseBPM,
      beatLengthMs: baseBeatLength,
      kiaiSections: kiaiSections,
    };
  }

  /**
   * 从 timing points 中提取 Kiai 段落。
   * Kiai 标志在 effects 字段的 bit 0。
   */
  _extractKiaiSections(timingPoints) {
    const sections = [];
    let kiaiStart = null;

    // 按 time 排序
    const sorted = [...timingPoints].sort((a, b) => a.time - b.time);

    for (const tp of sorted) {
      const hasKiai = (tp.effects & 1) !== 0;

      if (hasKiai && kiaiStart === null) {
        // Kiai 开始
        kiaiStart = tp.time;
      } else if (!hasKiai && kiaiStart !== null) {
        // Kiai 结束
        sections.push({ startMs: Math.round(kiaiStart), endMs: Math.round(tp.time) });
        kiaiStart = null;
      }
    }

    // 如果 Kiai 持续到最后
    if (kiaiStart !== null) {
      sections.push({ startMs: Math.round(kiaiStart), endMs: -1 });
    }

    return sections;
  }

  // ── HTTP 工具 ──────────────────────────────────────────────────────────

  _fetchJson(url, timeoutMs) {
    return new Promise((resolve, reject) => {
      const parsed = new URL(url);
      const lib = parsed.protocol === 'https:' ? https : http;

      const req = lib.get(url, {
        headers: {
          'User-Agent': 'Carminium/0.4.1',
          'Accept': 'application/json',
        },
        timeout: timeoutMs,
      }, (res) => {
        // 处理重定向
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          this._fetchJson(res.headers.location, timeoutMs).then(resolve).catch(reject);
          return;
        }

        if (res.statusCode !== 200) {
          reject(new Error('HTTP ' + res.statusCode));
          return;
        }

        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            reject(new Error('JSON parse failed: ' + e.message));
          }
        });
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });

      req.on('error', reject);
    });
  }

  _fetchText(url, timeoutMs) {
    return new Promise((resolve, reject) => {
      const parsed = new URL(url);
      const lib = parsed.protocol === 'https:' ? https : http;

      const req = lib.get(url, {
        headers: {
          'User-Agent': 'Carminium/0.4.1',
          'Accept': 'text/plain, */*',
        },
        timeout: timeoutMs,
      }, (res) => {
        // 处理重定向
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          this._fetchText(res.headers.location, timeoutMs).then(resolve).catch(reject);
          return;
        }

        if (res.statusCode !== 200) {
          reject(new Error('HTTP ' + res.statusCode));
          return;
        }

        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => resolve(body));
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });

      req.on('error', reject);
    });
  }
}

module.exports = { OsuBeatmapProvider };
