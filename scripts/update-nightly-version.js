
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const rootDir = path.resolve(__dirname, '..');
const versionJsonPath = path.join(rootDir, 'version.json');

const now = new Date();
const utc8 = new Date(now.getTime() + 8 * 60 * 60 * 1000);
const dateStr = utc8.getFullYear().toString() +
  String(utc8.getMonth() + 1).padStart(2, '0') +
  String(utc8.getDate()).padStart(2, '0');

const data = JSON.parse(fs.readFileSync(versionJsonPath, 'utf-8'));
const oldVersion = data.version;
const prefix = oldVersion.replace(/-\d+$/, '');
const newVersion = prefix + '-' + dateStr;

const versionChanged = oldVersion !== newVersion;

if (versionChanged) {
  data.version = newVersion;
  fs.writeFileSync(versionJsonPath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
  console.log(`[nightly] Updated version: ${oldVersion} -> ${newVersion}`);
} else {
  console.log(`[nightly] Version already up to date: ${oldVersion}`);
}

const packagePath = path.join(rootDir, 'package.json');
const packageBefore = JSON.parse(fs.readFileSync(packagePath, 'utf-8'));
execSync('node scripts/sync-version.js', { cwd: rootDir, stdio: 'inherit' });
const packageAfter = JSON.parse(fs.readFileSync(packagePath, 'utf-8'));
const packageChanged = packageBefore.version !== packageAfter.version;
const changed = versionChanged || packageChanged;
if (packageChanged && !versionChanged) {
  console.log(`[nightly] Repaired stale package.json version: ${packageBefore.version} -> ${packageAfter.version}`);
}

console.log(`NIGHTLY_VERSION=${newVersion}`);
console.log(`NIGHTLY_DATE=${dateStr}`);
console.log(`NIGHTLY_CHANGED=${changed}`);
