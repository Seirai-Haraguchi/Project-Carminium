#!/usr/bin/env node
/**
 * update-nightly-version.js
 *
 * 更新 version.json 中的日期为当天 (UTC+8 北京时间)，
 * 并同步到 package.json (semver 格式)。
 *
 * 用法:
 *   node scripts/update-nightly-version.js
 *
 * 输出 (最后一行, 供 CI 解析):
 *   NIGHTLY_VERSION=0.6.6.1-20260810
 *   NIGHTLY_DATE=20260810
 *   NIGHTLY_CHANGED=true
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const rootDir = path.resolve(__dirname, '..');
const versionJsonPath = path.join(rootDir, 'version.json');

// 计算当天日期 (UTC+8 北京时间)
const now = new Date();
const utc8 = new Date(now.getTime() + 8 * 60 * 60 * 1000);
const dateStr = utc8.getFullYear().toString() +
  String(utc8.getMonth() + 1).padStart(2, '0') +
  String(utc8.getDate()).padStart(2, '0');

// 读取并更新 version.json
const data = JSON.parse(fs.readFileSync(versionJsonPath, 'utf-8'));
const oldVersion = data.version;
const prefix = oldVersion.replace(/-\d+$/, '');
const newVersion = prefix + '-' + dateStr;

const changed = oldVersion !== newVersion;

if (changed) {
  data.version = newVersion;
  fs.writeFileSync(versionJsonPath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
  console.log(`[nightly] Updated version: ${oldVersion} -> ${newVersion}`);

  // 同步到 package.json (semver 格式)
  execSync('node scripts/sync-version.js', { cwd: rootDir, stdio: 'inherit' });
} else {
  console.log(`[nightly] Version already up to date: ${oldVersion}`);
}

// 输出供 CI 解析的信息
console.log(`NIGHTLY_VERSION=${newVersion}`);
console.log(`NIGHTLY_DATE=${dateStr}`);
console.log(`NIGHTLY_CHANGED=${changed}`);
