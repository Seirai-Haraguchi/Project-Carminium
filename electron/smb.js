'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { exec, execSync } = require('child_process');

const SUPPORTED_AUDIO_EXT = new Set([
  '.mp3', '.flac', '.ogg', '.wav', '.m4a', '.aac', '.opus', '.wma',
]);

class SMBError extends Error {
  constructor(code, message) {
    super(code !== null && code !== undefined ? `[${code}] ${message}` : message);
    this.code = code;
    this.message = message;
  }
}


let _koffi = null;
let _mprLib = null;
let _WNetAddConnection2 = null;
let _WNetCancelConnection2 = null;

function _initFFI() {
  if (_koffi !== null) return;
  try {
    _koffi = require('koffi');
    _mprLib = _koffi.load('mpr.dll');

    const NETRESOURCEW = _koffi.struct('NETRESOURCEW', {
      dwScope: 'uint32',
      dwType: 'uint32',
      dwDisplayType: 'uint32',
      dwUsage: 'uint32',
      lpLocalName: 'uint16 *',
      lpRemoteName: 'uint16 *',
      lpComment: 'uint16 *',
      lpProvider: 'uint16 *',
    });

    _WNetAddConnection2 = _mprLib.func('WNetAddConnection2W', 'uint32', [
      _koffi.pointer(NETRESOURCEW),
      'uint16 *',
      'uint16 *',
      'uint32',
    ]);

    _WNetCancelConnection2 = _mprLib.func('WNetCancelConnection2W', 'uint32', [
      'uint16 *',
      'uint32',
      'int32',
    ]);
  } catch (e) {
    _koffi = false;
    console.warn('[smb] koffi FFI 初始化失败:', e && e.message);
  }
}

const WN_ERRORS = {
  67: '网络名不存在',
  53: '网络路径未找到',
  1219: '已存在到该资源的连接，需要先断开',
  1326: '用户名或密码错误',
  2202: '凭据冲突',
  2250: '该网络连接不存在',
  1203: '没有网络提供程序接受给定的网络路径',
  1205: '无法打开网络连接配置文件',
  1208: '发生扩展错误',
  1222: '网络未连接或已启动',
  1231: '无法访问网络位置',
};

function _wnError(code) {
  return WN_ERRORS[code] || `Windows 网络错误 ${code}`;
}


class SMBClient {
  constructor(host, shareName, username, password, domain = '', timeout = 30.0) {
    this._host = host;
    this._shareName = shareName;
    this._username = username || '';
    this._password = password || '';
    this._domain = domain || '';
    this._timeout = timeout;
    this._mountPoint = null;
    this._driveLetter = null;
    this._connected = false;
  }

  get remotePath() {
    const host = this._host.replace(/^\\\\/, '');
    const share = this._shareName.replace(/^[\\/]+/, '').replace(/[\\/]+$/, '');
    return `\\\\${host}\\${share}`;
  }

  async ping() {
    try {
      if (process.platform === 'win32') {
        const drive = _findFreeDriveLetter();
        if (!drive) {
          return { ok: false, error: '没有可用的驱动器盘符' };
        }
        const result = _windowsConnect(this.remotePath, this._username, this._password, this._domain, drive);
        if (result === 0) {
          _windowsDisconnect(drive);
          return { ok: true, version: 'SMB/CIFS' };
        }
        return { ok: false, error: _wnError(result) };
      } else if (process.platform === 'linux') {
        const tmpMount = path.join(os.tmpdir(), `carminium_smb_test_${Date.now()}`);
        try { fs.mkdirSync(tmpMount, { recursive: true }); } catch {}
        const result = await _linuxMount(this.remotePath, tmpMount, this._username, this._password, this._domain);
        if (result.ok) {
          _linuxUnmount(tmpMount);
          return { ok: true, version: 'SMB/CIFS' };
        }
        return { ok: false, error: result.error };
      } else {
        return { ok: false, error: '当前平台不支持 SMB 连接' };
      }
    } catch (e) {
      return { ok: false, error: e.message || String(e) };
    }
  }

  async connect() {
    if (this._connected) return { ok: true, mountPoint: this._mountPoint };

    if (process.platform === 'win32') {
      const drive = _findFreeDriveLetter();
      if (!drive) {
        return { ok: false, error: '没有可用的驱动器盘符' };
      }
      const result = _windowsConnect(this.remotePath, this._username, this._password, this._domain, drive);
      if (result !== 0) {
        return { ok: false, error: _wnError(result) };
      }
      this._driveLetter = drive;
      this._mountPoint = drive + '\\';
      this._connected = true;
      return { ok: true, mountPoint: this._mountPoint };
    } else if (process.platform === 'linux') {
      const tmpMount = path.join(os.tmpdir(), `carminium_smb_${Date.now()}`);
      try { fs.mkdirSync(tmpMount, { recursive: true }); } catch {}
      const result = await _linuxMount(this.remotePath, tmpMount, this._username, this._password, this._domain);
      if (!result.ok) {
        try { fs.rmdirSync(tmpMount); } catch {}
        return { ok: false, error: result.error };
      }
      this._mountPoint = tmpMount;
      this._connected = true;
      return { ok: true, mountPoint: this._mountPoint };
    } else {
      return { ok: false, error: '当前平台不支持 SMB 连接' };
    }
  }

  async disconnect() {
    if (!this._connected) return;

    if (process.platform === 'win32' && this._driveLetter) {
      _windowsDisconnect(this._driveLetter);
      this._driveLetter = null;
    } else if (process.platform === 'linux' && this._mountPoint) {
      _linuxUnmount(this._mountPoint);
      try { fs.rmdirSync(this._mountPoint); } catch {}
    }

    this._mountPoint = null;
    this._connected = false;
  }

  get mountPoint() {
    return this._mountPoint;
  }

  get connected() {
    return this._connected;
  }
}


function _findFreeDriveLetter() {
  const used = new Set();
  try {
    const drives = execSync('wmic logicaldisk get name', { encoding: 'utf-8' });
    for (const m of drives.match(/[A-Z]:/g) || []) {
      used.add(m[0]);
    }
  } catch {
    for (let c = 65; c <= 90; c++) {
      const letter = String.fromCharCode(c);
      const drive = letter + ':';
      if (fs.existsSync(drive + '\\')) used.add(letter);
    }
  }

  for (let c = 90; c >= 69; c--) {
    const letter = String.fromCharCode(c);
    if (!used.has(letter)) {
      return letter + ':';
    }
  }
  return null;
}

function _windowsConnect(remotePath, username, password, domain, localDrive) {
  _initFFI();
  if (!_koffi || _koffi === false || !_WNetAddConnection2) {
    return _windowsConnectCmd(remotePath, username, password, domain, localDrive);
  }

  try {
    const NETRESOURCEW = _koffi.get('NETRESOURCEW');
    const nr = {
      dwScope: 0,
      dwType: 1,
      dwDisplayType: 0,
      dwUsage: 0,
      lpLocalName: _koffi.encode(localDrive, 'uint16'),
      lpRemoteName: _koffi.encode(remotePath, 'uint16'),
      lpComment: null,
      lpProvider: null,
    };

    const user = domain ? `${domain}\\${username}` : username;
    const result = _WNetAddConnection2(
      nr,
      _koffi.encode(password, 'uint16'),
      _koffi.encode(user, 'uint16'),
      0
    );

    _koffi.free(nr.lpLocalName);
    _koffi.free(nr.lpRemoteName);

    return result;
  } catch (e) {
    console.warn('[smb] FFI WNetAddConnection2 失败，回退到 net use:', e && e.message);
    return _windowsConnectCmd(remotePath, username, password, domain, localDrive);
  }
}

function _windowsConnectCmd(remotePath, username, password, domain, localDrive) {
  try {
    const user = domain ? `${domain}\\${username}` : username;
    const cmd = `net use ${localDrive} "${remotePath}" "${password}" /user:"${user}" /persistent:no`;
    execSync(cmd, { stdio: 'pipe', timeout: 15000 });
    return 0;
  } catch (e) {
    const stderr = e.stderr ? e.stderr.toString() : '';
    const m = stderr.match(/error (\d+)/i);
    if (m) return parseInt(m[1], 10);
    return 1208;
  }
}

function _windowsDisconnect(localDrive) {
  try {
    execSync(`net use ${localDrive} /delete /yes`, { stdio: 'pipe', timeout: 10000 });
  } catch {
    _initFFI();
    if (_koffi && _koffi !== false && _WNetCancelConnection2) {
      try {
        _WNetCancelConnection2(_koffi.encode(localDrive, 'uint16'), 0, 1);
      } catch {  }
    }
  }
}


function _linuxMount(remotePath, mountPoint, username, password, domain) {
  return new Promise((resolve) => {
    const linuxPath = remotePath.replace(/\\\\/g, '/').replace(/\\/g, '/');

    const credFile = path.join(os.tmpdir(), `carminium_smb_cred_${Date.now()}`);
    const credContent = `username=${username}\npassword=${password}\n${domain ? `domain=${domain}\n` : ''}`;
    try {
      fs.writeFileSync(credFile, credContent, { mode: 0o600 });
    } catch (e) {
      resolve({ ok: false, error: `无法创建凭据文件: ${e.message}` });
      return;
    }

    const cmd = `mount -t cifs "${linuxPath}" "${mountPoint}" -o credentials="${credFile}",uid=${process.getuid()},gid=${process.getgid()},iocharset=utf8`;
    exec(cmd, { timeout: 15000 }, (err, stdout, stderr) => {
      try { fs.unlinkSync(credFile); } catch {}

      if (err) {
        resolve({ ok: false, error: stderr || err.message || 'mount 失败' });
      } else {
        resolve({ ok: true });
      }
    });
  });
}

function _linuxUnmount(mountPoint) {
  try {
    execSync(`umount "${mountPoint}"`, { stdio: 'pipe', timeout: 10000 });
  } catch {  }
}


async function syncServerToLibrary(client, library, serverId, options = {}) {
  const {
    progressCb = null,
    libraryChangedCb = null,
  } = options;

  const stats = {
    tracks: 0,
    covers: 0,
    warnings: [],
  };

  if (!client.connected) {
    const connResult = await client.connect();
    if (!connResult.ok) {
      stats.error = connResult.error || 'SMB 连接失败';
      return stats;
    }
  }

  const mountPoint = client.mountPoint;
  if (!mountPoint || !fs.existsSync(mountPoint)) {
    stats.error = '挂载点不存在或无法访问';
    return stats;
  }

  const folderPath = mountPoint;
  library.addFolder(folderPath);

  if (progressCb) {
    try { progressCb({ phase: 'scanning', current_path: folderPath }); } catch {}
  }

  try {
    await library.scanFolder(folderPath);
  } catch (e) {
    stats.warnings.push(`扫描失败: ${e}`);
  }

  const fid = library._folderId(folderPath);
  if (fid !== null) {
    library.markTracksAsSmb(fid, serverId);
  }

  const tracks = library.getTracksByFolder(fid);
  stats.tracks = tracks.length;

  if (libraryChangedCb) {
    try { libraryChangedCb(); } catch {}
  }

  if (progressCb) {
    try { progressCb({ phase: 'done', tracks: stats.tracks }); } catch {}
  }

  return stats;
}

module.exports = {
  SMBError,
  SMBClient,
  syncServerToLibrary,
  SUPPORTED_AUDIO_EXT,
};
