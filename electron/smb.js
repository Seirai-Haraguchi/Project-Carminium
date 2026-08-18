/**
 * Carminium — SMB / NAS 客户端
 *
 * 通过 Windows WNetAddConnection2 API 或 Linux mount.cifs 挂载 SMB 共享，
 * 然后将其作为本地文件系统路径访问。
 *
 * Windows: 使用 koffi FFI 调用 mpr.dll 的 WNetAddConnection2W
 * Linux:   使用 child_process 调用 mount -t cifs
 *
 * 挂载后，SMB 共享的行为与本地文件夹完全一致：
 *   - 扫描：复用 library.scanFolder
 *   - 流式播放：复用 cover-server 的 /media/ 端点
 *   - 封面提取：复用 library 的本地封面提取逻辑
 *
 * 这意味着 SMB 曲目在数据库中存储为 source='smb'，
 * path 为挂载点下的本地路径（如 Z:\Music\song.flac），
 * 但 folder_id 指向一个虚拟的 SMB 文件夹条目。
 */
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

// ── Windows FFI (koffi) ─────────────────────────────────────────────────────

let _koffi = null;
let _mprLib = null;
let _WNetAddConnection2 = null;
let _WNetCancelConnection2 = null;

function _initFFI() {
  if (_koffi !== null) return;
  try {
    _koffi = require('koffi');
    // mpr.dll 包含 WNet* 函数
    _mprLib = _koffi.load('mpr.dll');

    // NETRESOURCEW 结构体
    const NETRESOURCEW = _koffi.struct('NETRESOURCEW', {
      dwScope: 'uint32',
      dwType: 'uint32',
      dwDisplayType: 'uint32',
      dwUsage: 'uint32',
      lpLocalName: 'uint16 *',  // wchar_t*
      lpRemoteName: 'uint16 *', // wchar_t*
      lpComment: 'uint16 *',    // wchar_t*
      lpProvider: 'uint16 *',   // wchar_t*
    });

    // DWORD WNetAddConnection2W(
    //   NETRESOURCEW *lpNetResource,
    //   LPCWSTR      lpPassword,
    //   LPCWSTR      lpUserName,
    //   DWORD        dwFlags
    // );
    _WNetAddConnection2 = _mprLib.func('WNetAddConnection2W', 'uint32', [
      _koffi.pointer(NETRESOURCEW),
      'uint16 *',
      'uint16 *',
      'uint32',
    ]);

    // DWORD WNetCancelConnection2W(
    //   LPCWSTR lpName,
    //   DWORD   dwFlags,
    //   BOOL    fForce
    // );
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

/**
 * Windows 错误码 → 可读消息
 */
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

// ── SMB 客户端 ──────────────────────────────────────────────────────────────

class SMBClient {
  /**
   * @param {string} host - SMB 服务器地址（如 192.168.1.100 或 nas.local）
   * @param {string} shareName - 共享名（如 Music）
   * @param {string} username
   * @param {string} password
   * @param {string} domain - 域名/工作组（可选）
   * @param {number} timeout - seconds
   */
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

  /**
   * 远程路径 \\host\share
   */
  get remotePath() {
    const host = this._host.replace(/^\\\\/, '');
    const share = this._shareName.replace(/^[\\/]+/, '').replace(/[\\/]+$/, '');
    return `\\\\${host}\\${share}`;
  }

  /**
   * 测试连接：尝试临时挂载并立即断开。
   * @returns {Promise<{ok: boolean, version?: string, error?: string}>}
   */
  async ping() {
    try {
      if (process.platform === 'win32') {
        // Windows: 使用临时驱动器盘符测试
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
        // Linux: 尝试临时挂载
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

  /**
   * 挂载 SMB 共享到本地路径/驱动器。
   * Windows: 挂载到临时驱动器盘符
   * Linux: 挂载到临时目录
   * @returns {Promise<{ok: boolean, mountPoint: string, error?: string}>}
   */
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

  /**
   * 断开 SMB 共享。
   */
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

  /**
   * 获取挂载点路径（连接后可用）。
   */
  get mountPoint() {
    return this._mountPoint;
  }

  get connected() {
    return this._connected;
  }
}

// ── Windows 辅助函数 ────────────────────────────────────────────────────────

function _findFreeDriveLetter() {
  // 从 Z: 往前找，跳过已用的
  const used = new Set();
  try {
    const drives = execSync('wmic logicaldisk get name', { encoding: 'utf-8' });
    for (const m of drives.match(/[A-Z]:/g) || []) {
      used.add(m[0]);
    }
  } catch {
    // 回退：检查 A-Z
    for (let c = 65; c <= 90; c++) {
      const letter = String.fromCharCode(c);
      const drive = letter + ':';
      if (fs.existsSync(drive + '\\')) used.add(letter);
    }
  }

  // 优先从 Z: 往前找（避开 A: B: C: D:）
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
    // FFI 不可用时回退到 net use 命令
    return _windowsConnectCmd(remotePath, username, password, domain, localDrive);
  }

  try {
    const NETRESOURCEW = _koffi.get('NETRESOURCEW');
    const nr = {
      dwScope: 0,          // RESOURCE_GLOBALNET
      dwType: 1,           // RESOURCETYPE_DISK
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
      0  // no flags
    );

    // 释放编码的字符串
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
    // 使用 /persistent:no 避免重启后自动重连
    const cmd = `net use ${localDrive} "${remotePath}" "${password}" /user:"${user}" /persistent:no`;
    execSync(cmd, { stdio: 'pipe', timeout: 15000 });
    return 0;
  } catch (e) {
    // 解析 net use 错误
    const stderr = e.stderr ? e.stderr.toString() : '';
    const m = stderr.match(/error (\d+)/i);
    if (m) return parseInt(m[1], 10);
    return 1208; // generic extended error
  }
}

function _windowsDisconnect(localDrive) {
  try {
    execSync(`net use ${localDrive} /delete /yes`, { stdio: 'pipe', timeout: 10000 });
  } catch {
    // 尝试 FFI
    _initFFI();
    if (_koffi && _koffi !== false && _WNetCancelConnection2) {
      try {
        _WNetCancelConnection2(_koffi.encode(localDrive, 'uint16'), 0, 1);
      } catch { /* ignore */ }
    }
  }
}

// ── Linux 辅助函数 ──────────────────────────────────────────────────────────

function _linuxMount(remotePath, mountPoint, username, password, domain) {
  return new Promise((resolve) => {
    // Linux SMB 路径需要从 \\host\share 转换为 //host/share
    const linuxPath = remotePath.replace(/\\\\/g, '/').replace(/\\/g, '/');

    // 创建凭据文件
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
      // 清理凭据文件
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
  } catch { /* ignore */ }
}

// ── 同步到本地库 ────────────────────────────────────────────────────────────

/**
 * 挂载 SMB 共享后，使用 MusicLibrary 的本地扫描功能扫描挂载点。
 * SMB 曲目在数据库中存储为 source='smb'，path 为挂载点下的本地路径。
 *
 * @param {SMBClient} client
   * @param {MusicLibrary} library
   * @param {number} serverId
   * @param {object} options - { progressCb, libraryChangedCb }
   * @returns {Promise<object>} 统计信息
   */
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

  // 1) 确保已连接
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

  // 2) 在 library 中注册 SMB 文件夹
  const folderPath = mountPoint;
  library.addFolder(folderPath);

  // 3) 标记该文件夹下的曲目为 SMB 来源
  // 使用 library 的扫描功能，然后更新来源标记
  if (progressCb) {
    try { progressCb({ phase: 'scanning', current_path: folderPath }); } catch {}
  }

  try {
    await library.scanFolder(folderPath);
  } catch (e) {
    stats.warnings.push(`扫描失败: ${e}`);
  }

  // 4) 将扫描到的曲目标记为 SMB 来源
  const fid = library._folderId(folderPath);
  if (fid !== null) {
    library.markTracksAsSmb(fid, serverId);
  }

  // 5) 统计曲目数
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
