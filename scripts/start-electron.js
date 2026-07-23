/**
 * 启动脚本：清除 ELECTRON_RUN_AS_NODE 环境变量后启动 Electron。
 * 某些 IDE 环境会设置此变量，导致 Electron 以纯 Node.js 模式运行。
 */
'use strict';

delete process.env.ELECTRON_RUN_AS_NODE;

const { spawn } = require('child_process');
const electronPath = require('electron');

const args = process.argv.slice(2);
const child = spawn(electronPath, args, {
  stdio: 'inherit',
  env: process.env,
  cwd: process.cwd(),
});

child.on('close', (code) => {
  process.exit(code);
});
