/**
 * sync-version.js
 *
 * 将 version.json 中的自定义版本号转换为 semver 兼容格式，
 * 并同步写入 package.json，以便 electron-builder 能正常构建。
 *
 * 自定义版本号格式: MAJOR.MINOR.PATCH.DEV-BUILDDATE
 *   例: 0.6.0.1-20260808
 *       0.6        → 中版本 (major.minor)
 *       .0         → 小版本 (patch)
 *       .1         → 开发版标识 (dev)
 *       -20260808  → 构建日期 (build date)
 *
 * 转换后的 semver: MAJOR.MINOR.PATCH-dev.BUILDDATE
 *   例: 0.6.0-1.20260808
 */

const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const versionJsonPath = path.join(rootDir, 'version.json');
const packageJsonPath = path.join(rootDir, 'package.json');

function convertToSemver(rawVersion) {
  // 匹配 "0.6.0.1-20260808" 或 "0.6.0.1" 这样的格式
  const match = rawVersion.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)(?:-(.+))?$/);
  if (!match) {
    throw new Error(
      `版本号 "${rawVersion}" 不符合自定义格式 MAJOR.MINOR.PATCH.DEV[-BUILDDATE]，无法转换为 semver。`
    );
  }

  const [, major, minor, patch, dev, buildDate] = match;
  const prereleaseParts = [dev];
  if (buildDate) {
    prereleaseParts.push(buildDate);
  }

  return `${major}.${minor}.${patch}-${prereleaseParts.join('.')}`;
}

function main() {
  // 读取 version.json
  const versionData = JSON.parse(fs.readFileSync(versionJsonPath, 'utf-8'));
  const rawVersion = versionData.version;

  const semverVersion = convertToSemver(rawVersion);
  console.log(`[sync-version] 自定义版本: ${rawVersion}`);
  console.log(`[sync-version] semver 版本: ${semverVersion}`);

  // 读取 package.json，更新 version 字段
  const packageData = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
  packageData.version = semverVersion;

  fs.writeFileSync(packageJsonPath, JSON.stringify(packageData, null, 2) + '\n', 'utf-8');
  console.log(`[sync-version] 已将 semver 版本写入 package.json`);
}

main();
