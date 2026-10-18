'use strict';

const https = require('https');
const http = require('http');
const { URL } = require('url');

const SEARCH_TIMEOUT_MS = 5000;
const DOWNLOAD_TIMEOUT_MS = 5000;
const DURATION_MATCH_TOLERANCE_MS = 3000;

class OsuBeatmapProvider {
  async search(title, artist, durationMs) {
    if (!title) return null;

    try {
      const query = this._buildQuery(title, artist);
      console.log('[OsuBeatmapProvider] Searching:', query);

      const searchResults = await this._searchBeatmaps(query);
      if (!searchResults || searchResults.length === 0) {
        console.log('[OsuBeatmapProvider] No search results');
        return null;
      }

      const matched = this._matchByDuration(searchResults, durationMs);
      if (!matched) {
        console.log('[OsuBeatmapProvider] No duration match found');
        return null;
      }

      console.log('[OsuBeatmapProvider] Matched beatmap:', matched.sid, matched.bid);

      const osuContent = await this._downloadOsuFile(matched.bid);
      if (!osuContent) {
        console.log('[OsuBeatmapProvider] Failed to download .osu file');
        return null;
      }

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


  _buildQuery(title, artist) {
    let cleanTitle = title
      .replace(/\(.*?\)/g, '')
      .replace(/\[.*?\]/g, '')
      .replace(/\s*(TV Size|Full Version|Short Ver\.?)\s*/gi, '')
      .trim();

    if (artist) {
      let cleanArtist = artist.split(/\s*(feat\.|ft\.|vs\.|with)\s*/i)[0].trim();
      return cleanTitle + ' ' + cleanArtist;
    }
    return cleanTitle;
  }

  async _searchBeatmaps(query) {
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
        continue;
      }
    }

    return null;
  }

  _extractBeatmapList(data) {
    if (!data) return [];

    if (data.data) {
      if (Array.isArray(data.data)) return data.data.map(this._normalizeBeatmap);
      if (data.data.results && Array.isArray(data.data.results)) return data.data.results.map(this._normalizeBeatmap);
      if (data.data.bid && data.data.sid) return [this._normalizeBeatmap(data.data)];
    }

    if (data.results && Array.isArray(data.results)) return data.results.map(this._normalizeBeatmap);

    if (Array.isArray(data)) return data.map(this._normalizeBeatmap);

    if (data.beatmaps && Array.isArray(data.beatmaps)) return data.beatmaps.map(this._normalizeBeatmap);

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

  _normalizeBeatmap(raw) {
    const bid = raw.bid || raw.beatmap_id || raw.id || raw.beatmapId;
    const sid = raw.sid || raw.beatmapset_id || raw.beatmapSetId || raw.set_id || raw.setParentId;
    let length = raw.length || raw.total_length || raw.hit_length || raw.time;
    if (typeof length === 'string') {
      const parts = length.split(':');
      if (parts.length === 2) {
        length = parseInt(parts[0], 10) * 60 + parseFloat(parts[1]);
      }
    }
    if (typeof length === 'number' && length < 10000) {
      length = length * 1000;
    }
    return {
      bid: bid,
      sid: sid,
      lengthMs: length || 0,
      title: raw.title || '',
      artist: raw.artist || '',
    };
  }


  _matchByDuration(beatmaps, targetDurationMs) {
    if (!targetDurationMs || targetDurationMs <= 0) {
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

    if (bestMatch && bestDiff <= DURATION_MATCH_TOLERANCE_MS) {
      return bestMatch;
    }

    if (bestMatch && bestDiff <= 5000) {
      console.log('[OsuBeatmapProvider] Loose match with diff:', bestDiff, 'ms');
      return bestMatch;
    }

    return null;
  }


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


  _parseTimingPoints(content) {
    if (!content || typeof content !== 'string') return null;

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
        if (baseBeatLength === 0 && beatLength > 0) {
          baseBeatLength = beatLength;
          baseBPM = Math.round(60000 / beatLength);
        }
        timingPoints.push({ time, beatLength, uninherited: true, effects });
      } else {
        timingPoints.push({ time, beatLength, uninherited: false, effects });
      }
    }

    if (baseBPM <= 0) return null;

    const kiaiSections = this._extractKiaiSections(timingPoints);

    return {
      bpm: baseBPM,
      beatLengthMs: baseBeatLength,
      kiaiSections: kiaiSections,
    };
  }

  _extractKiaiSections(timingPoints) {
    const sections = [];
    let kiaiStart = null;

    const sorted = [...timingPoints].sort((a, b) => a.time - b.time);

    for (const tp of sorted) {
      const hasKiai = (tp.effects & 1) !== 0;

      if (hasKiai && kiaiStart === null) {
        kiaiStart = tp.time;
      } else if (!hasKiai && kiaiStart !== null) {
        sections.push({ startMs: Math.round(kiaiStart), endMs: Math.round(tp.time) });
        kiaiStart = null;
      }
    }

    if (kiaiStart !== null) {
      sections.push({ startMs: Math.round(kiaiStart), endMs: -1 });
    }

    return sections;
  }


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
