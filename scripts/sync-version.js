
const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const versionJsonPath = path.join(rootDir, 'version.json');
const packageJsonPath = path.join(rootDir, 'package.json');

function convertToSemver(rawVersion) {
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
  const versionData = JSON.parse(fs.readFileSync(versionJsonPath, 'utf-8'));
  const rawVersion = versionData.version;

  const semverVersion = convertToSemver(rawVersion);
  console.log(`[sync-version] 自定义版本: ${rawVersion}`);
  console.log(`[sync-version] semver 版本: ${semverVersion}`);

  const packageData = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
  packageData.version = semverVersion;

  fs.writeFileSync(packageJsonPath, JSON.stringify(packageData, null, 2) + '\n', 'utf-8');
  console.log(`[sync-version] 已将 semver 版本写入 package.json`);
}

main();
