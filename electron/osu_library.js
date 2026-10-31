'use strict';

/**
 * osu! 曲库解析。
 *
 * osu! 的 Songs 目录结构：
 *   <osu root>/Songs/<beatmapsetID> <Artist> - <Title>/
 *     Artist - Title (Mapper) [Difficulty].osu
 *     audio.mp3            ← 由 .osu 的 General/AudioFilename 指定
 *     bg.jpg               ← 由 .osu 的 Events 段指定，常是谱面集唯一一张图
 *
 * 同一个谱面集里多个难度共用一个音频，所以按音频路径去重，元数据取该音频的
 * 第一份 .osu（标题/艺术家/谱师/背景图）。
 */

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

const AUDIO_EXT = new Set(['.mp3', '.flac', '.ogg', '.wav', '.m4a', '.aac', '.opus']);
const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.bmp']);
const OSU_HEAD_BYTES = 64 * 1024;
const PARALLEL = 16;

function isDir(p) {
  try { return fs.statSync(p).isDirectory(); } catch { return false; }
}

function isFile(p) {
  try { return fs.statSync(p).isFile(); } catch { return false; }
}

function decode(buf) {
  let text = buf.toString('utf8');
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  return text;
}

/** 读 .osu 的头部（元数据与 Events 都在文件前部），拿不到 [Events] 时再全读 */
async function readOsuText(filePath) {
  let fh;
  try {
    fh = await fsp.open(filePath, 'r');
    const buf = Buffer.allocUnsafe(OSU_HEAD_BYTES);
    const { bytesRead } = await fh.read(buf, 0, OSU_HEAD_BYTES, 0);
    const head = decode(buf.subarray(0, bytesRead));
    if (head.includes('[Events]')) return head;
  } catch {
    return null;
  } finally {
    try { if (fh) await fh.close(); } catch { }
  }
  try {
    return decode(await fsp.readFile(filePath));
  } catch {
    return null;
  }
}

const SECTION_RE = /^\[(.+)\]$/;

/**
 * 解析单个 .osu 文件，返回谱面元数据（解析失败返回 null）
 */
function parseOsuText(text) {
  if (!text) return null;
  const kv = Object.create(null);
  let background = null;
  let section = '';

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('//')) continue;

    const sec = SECTION_RE.exec(line);
    if (sec) { section = sec[1].trim(); continue; }

    if (section === 'General' || section === 'Metadata') {
      const idx = line.indexOf(':');
      if (idx <= 0) continue;
      const key = line.slice(0, idx).trim();
      const value = line.slice(idx + 1).trim();
      if (key && kv[key] === undefined) kv[key] = value;
    } else if (section === 'Events' && !background) {
      const m = /^0\s*,\s*0\s*,\s*"([^"]+)"/.exec(line);
      if (m) background = m[1];
    }
  }

  const title = kv.TitleUnicode || kv.Title;
  const artist = kv.ArtistUnicode || kv.Artist;
  if (!title && !artist) return null;

  return {
    title: title || null,
    titleAscii: (kv.Title && kv.Title !== title) ? kv.Title : null,
    artist: artist || null,
    artistAscii: (kv.Artist && kv.Artist !== artist) ? kv.Artist : null,
    creator: kv.Creator || null,
    version: kv.Version || null,
    source: kv.Source || null,
    audioFilename: kv.AudioFilename || null,
    background: background || null,
    beatmapSetId: kv.BeatmapSetID || null,
  };
}

/**
 * 从用户选中的目录定位 Songs 目录：
 * 选中 osu! 安装目录 → 用其 Songs 子目录；选中 Songs 本身 → 原样返回。
 */
function resolveSongsDir(root) {
  if (!root) return null;
  const sub = path.join(root, 'Songs');
  if (isDir(sub)) return sub;
  return isDir(root) ? root : null;
}

function listEntries(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

/** 目录里的第一张图（osu 谱面集通常只有背景图这一张） */
function firstImageIn(dir, preferred) {
  if (preferred) {
    const abs = path.join(dir, preferred);
    if (isFile(abs) && IMAGE_EXT.has(path.extname(abs).toLowerCase())) return abs;
  }
  const images = [];
  for (const entry of listEntries(dir)) {
    if (!entry.isFile()) continue;
    if (IMAGE_EXT.has(path.extname(entry.name).toLowerCase())) images.push(entry.name);
  }
  if (images.length === 0) return null;
  const prio = /^(bg|background|cover|jacket|folder)/i;
  images.sort((a, b) => (prio.test(a) ? 0 : 1) - (prio.test(b) ? 0 : 1));
  return path.join(dir, images[0]);
}

async function collectBeatmapSet(setDir) {
  const entries = listEntries(setDir);
  const osuFiles = entries
    .filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.osu'))
    .map((e) => path.join(setDir, e.name));
  if (osuFiles.length === 0) return [];

  // 一个谱面集里多难度共用音频，按音频归并；元数据用该音频的第一份 .osu
  const byAudio = new Map();
  for (const osuPath of osuFiles) {
    const meta = parseOsuText(await readOsuText(osuPath));
    if (!meta) continue;

    let audioPath = null;
    if (meta.audioFilename) {
      const candidate = path.join(setDir, meta.audioFilename);
      if (isFile(candidate)) audioPath = candidate;
    }
    if (!audioPath) {
      for (const entry of entries) {
        if (entry.isFile() && AUDIO_EXT.has(path.extname(entry.name).toLowerCase())) {
          audioPath = path.join(setDir, entry.name);
          break;
        }
      }
    }
    if (!audioPath) continue;
    if (byAudio.has(audioPath)) continue;

    const coverPath = firstImageIn(setDir, meta.background);
    byAudio.set(audioPath, {
      title: meta.title,
      alias_title: meta.titleAscii || meta.artistAscii || null,
      artist: meta.artist,
      album: (meta.artist && meta.title) ? `${meta.artist} - ${meta.title}` : (meta.title || null),
      album_artist: meta.artist,
      creator: meta.creator,
      version: meta.version,
      genre: 'osu!',
      coverPath: coverPath || null,
    });
  }
  return Array.from(byAudio.entries());
}

/**
 * 扫描 Songs 目录，返回 Map<音频绝对路径, osu 元数据>
 */
async function collectTracks(root, opts = {}) {
  const songsDir = resolveSongsDir(root);
  const result = new Map();
  if (!songsDir) return result;

  const setDirs = [];
  for (const entry of listEntries(songsDir)) {
    if (entry.isDirectory()) setDirs.push(path.join(songsDir, entry.name));
  }

  const onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : null;
  let cursor = 0;
  let done = 0;

  const worker = async () => {
    for (;;) {
      const i = cursor++;
      if (i >= setDirs.length) return;
      let pairs = [];
      try {
        pairs = await collectBeatmapSet(setDirs[i]);
      } catch { pairs = []; }
      for (const [audioPath, meta] of pairs) {
        if (!result.has(audioPath)) result.set(audioPath, meta);
      }
      done++;
      if (onProgress && (done & 31) === 0) {
        try { onProgress({ done, total: setDirs.length }); } catch { }
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(PARALLEL, setDirs.length || 1) }, worker));
  return result;
}

/**
 * 目录是否像 osu! 曲库：有 Songs 且有谱面集（前 20 个目录里能找到 .osu）
 */
function looksLikeOsu(root) {
  const songsDir = resolveSongsDir(root);
  if (!songsDir) return false;
  if (path.basename(songsDir).toLowerCase() !== 'songs') return false;

  let checked = 0;
  for (const entry of listEntries(songsDir)) {
    if (!entry.isDirectory()) continue;
    if (++checked > 20) break;
    const dir = path.join(songsDir, entry.name);
    if (listEntries(dir).some((e) => e.isFile() && e.name.toLowerCase().endsWith('.osu'))) {
      return true;
    }
  }
  return false;
}

module.exports = {
  resolveSongsDir,
  looksLikeOsu,
  collectTracks,
  parseOsuText,
  firstImageIn,
  IMAGE_EXT,
};
