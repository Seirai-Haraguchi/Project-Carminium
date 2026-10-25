'use strict';

const fs = require('fs');
const path = require('path');

// 所有落盘的「缓存」子目录，相对缓存根目录。迁移时逐项处理。
// 注意：track_loudness.json / track_quality.json 属于分析结果（元数据），
// 并非可丢弃缓存，仍保留在应用数据目录，不随缓存目录迁移。
const CACHE_SUBDIRS = ['cover_cache', 'subsonic_covers', 'carminium-artist-images'];

// 默认缓存根目录＝应用数据目录（userData），与历史行为保持一致。
function defaultCacheDir(settings) {
  if (settings && settings.dataDir) return settings.dataDir;
  try {
    const { app } = require('electron');
    if (app && app.getPath) return app.getPath('userData');
  } catch (e) {  }
  return process.cwd();
}

// 解析当前生效的缓存根目录：用户指定了 cache_dir 则用它，否则用默认。
function resolveCacheDir(settings) {
  let custom = '';
  if (settings && typeof settings.get === 'function') {
    custom = settings.get('cache_dir', '') || '';
  }
  if (custom && String(custom).trim()) {
    return path.resolve(String(custom).trim());
  }
  return defaultCacheDir(settings);
}

// 递归统计目录下的文件数与总字节数（用于进度分母）。
async function _statDir(dir) {
  let files = 0;
  let bytes = 0;
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop();
    let entries;
    try {
      entries = await fs.promises.readdir(cur, { withFileTypes: true });
    } catch (e) {
      continue;
    }
    for (const ent of entries) {
      const p = path.join(cur, ent.name);
      if (ent.isDirectory()) {
        stack.push(p);
      } else if (ent.isFile()) {
        files += 1;
        try {
          bytes += (await fs.promises.stat(p)).size;
        } catch (e) {  }
      }
    }
  }
  return { files, bytes };
}

// 递归复制目录，每复制完一个文件回调一次（回调收到该文件字节数）。
async function _copyDirWithProgress(src, dst, onFile) {
  await fs.promises.mkdir(dst, { recursive: true });
  const entries = await fs.promises.readdir(src, { withFileTypes: true });
  for (const ent of entries) {
    const s = path.join(src, ent.name);
    const d = path.join(dst, ent.name);
    if (ent.isDirectory()) {
      await _copyDirWithProgress(s, d, onFile);
    } else if (ent.isFile()) {
      let size = 0;
      try {
        size = (await fs.promises.stat(s)).size;
      } catch (e) {  }
      await fs.promises.copyFile(s, d);
      if (typeof onFile === 'function') onFile(size);
    }
  }
}

// 把旧缓存根下已存在的缓存子目录迁移到新根。目标已存在同名字目录时跳过不覆盖。
// onProgress({ phase, current, doneBytes, totalBytes, doneFiles, totalFiles, moved, skipped, percent })
//   phase: 'start' | 'progress' | 'done'；percent 按字节数计算（0~100，整数，已节流）。
async function migrateCache(oldDir, newDir, onProgress) {
  const oldAbs = path.resolve(oldDir || '');
  const newAbs = path.resolve(newDir || '');
  if (!oldAbs || !newAbs || oldAbs === newAbs) {
    return { moved: [], skipped: [], same: true };
  }

  const moved = [];
  const skipped = [];
  const tasks = [];
  for (const sub of CACHE_SUBDIRS) {
    const src = path.join(oldAbs, sub);
    if (!fs.existsSync(src)) continue;
    const dst = path.join(newAbs, sub);
    if (fs.existsSync(dst)) {
      skipped.push(sub);
      continue;
    }
    tasks.push({ sub, src, dst });
  }
  if (tasks.length === 0) {
    return { moved, skipped, same: false };
  }

  // 先统计总量作为进度分母。
  let totalBytes = 0;
  let totalFiles = 0;
  const planned = [];
  for (const t of tasks) {
    const st = await _statDir(t.src);
    planned.push({ ...t, files: st.files, bytes: st.bytes });
    totalBytes += st.bytes;
    totalFiles += st.files;
  }

  let doneBytes = 0;
  let doneFiles = 0;
  let lastPercent = -1;
  const emit = (phase, current) => {
    if (typeof onProgress !== 'function') return;
    const percent = totalBytes > 0 ? Math.min(100, Math.round((doneBytes / totalBytes) * 100)) : 0;
    if (phase === 'progress' && percent === lastPercent) return;
    lastPercent = percent;
    onProgress({
      phase,
      current: current || '',
      doneBytes, totalBytes, doneFiles, totalFiles,
      moved: moved.slice(),
      skipped: skipped.slice(),
      percent,
    });
  };

  emit('start');

  for (const t of planned) {
    try {
      await fs.promises.mkdir(newAbs, { recursive: true });
      try {
        await fs.promises.rename(t.src, t.dst);
        doneBytes += t.bytes;
        doneFiles += t.files;
        moved.push(t.sub);
        emit('progress', t.sub);
      } catch (e) {
        if (e && e.code === 'EXDEV') {
          // 跨卷：逐文件复制，实时回调进度。
          await _copyDirWithProgress(t.src, t.dst, (size) => {
            doneBytes += size || 0;
            doneFiles += 1;
            emit('progress', t.sub);
          });
          await fs.promises.rm(t.src, { recursive: true, force: true });
          moved.push(t.sub);
        } else {
          throw e;
        }
      }
    } catch (e) {
      skipped.push(t.sub);
      emit('progress', t.sub);
    }
  }

  emit('done');
  return { moved, skipped, same: false };
}

module.exports = { CACHE_SUBDIRS, defaultCacheDir, resolveCacheDir, migrateCache };
