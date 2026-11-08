'use strict';

/**
 * Portable (NSIS) builds unpack into a deterministic %TEMP% directory keyed by
 * the exe path, so every launch of the same file shares one directory. When a
 * second instance is started, requestSingleInstanceLock() makes that process
 * quit and its NSIS wrapper deletes the shared unpack directory -- including
 * ffmpeg.exe / ffprobe.exe / icudtl.dat that the FIRST, still-running instance
 * needs. Playback then silently does nothing instead of reporting an error.
 *
 * Mirror the two decoder binaries into userData on the first healthy launch.
 * The mirror lives outside the NSIS temp directory, so it survives that wipe
 * and playback can keep working (or recover on the next spawn).
 */

const fs = require('fs');
const path = require('path');

const IS_WIN = process.platform === 'win32';
const SUBDIR = IS_WIN ? 'win32' : (process.platform === 'linux' ? 'linux' : 'darwin');
const EXE = (name) => IS_WIN ? name + '.exe' : name;
const NAMES = [EXE('ffmpeg'), EXE('ffprobe')];

let _dir = null;

function mirrorDir() {
  if (_dir !== null) return _dir;
  try {
    const { app } = require('electron');
    _dir = (app && typeof app.getPath === 'function')
      ? path.join(app.getPath('userData'), 'bin', SUBDIR)
      : null;
  } catch {
    _dir = null;
  }
  return _dir;
}

function bundledDir() {
  let dir = path.join(__dirname, 'bin', SUBDIR);
  if (dir.includes('.asar')) {
    dir = dir.replace(/\.asar([\\/])/, '.asar.unpacked$1');
  }
  return dir;
}

/** Return the mirrored binary path if it is complete, otherwise null. */
function mirrored(name) {
  const dir = mirrorDir();
  if (!dir) return null;
  const target = path.join(dir, name);
  try {
    if (fs.statSync(target).size > 1024 * 1024) return target;
  } catch { /* not mirrored yet */ }
  return null;
}

function isPackaged() {
  return __dirname.includes('.asar');
}

let _started = false;

/** Idempotent, fire-and-forget background mirror. Never blocks startup. */
function ensureMirror() {
  if (_started) return;
  _started = true;
  if (!isPackaged()) return;
  const dir = mirrorDir();
  if (!dir) return;

  const source = bundledDir();
  (async () => {
    try {
      await fs.promises.mkdir(dir, { recursive: true });
      for (const name of NAMES) {
        const from = path.join(source, name);
        const to = path.join(dir, name);
        let size;
        try { size = (await fs.promises.stat(from)).size; } catch { continue; }
        if (size <= 1024 * 1024) continue;
        try {
          if ((await fs.promises.stat(to)).size === size) continue;
        } catch { /* missing */ }
        const tmp = to + '.part-' + process.pid;
        await fs.promises.copyFile(from, tmp);
        await fs.promises.rename(tmp, to);
        console.log('[bin_mirror] mirrored', name, Math.round(size / 1048576) + 'MB');
      }
    } catch (e) {
      console.warn('[bin_mirror] mirror failed:', e.message);
    }
  })();
}

module.exports = { mirrorDir, bundledDir, mirrored, ensureMirror, isPackaged, NAMES };
