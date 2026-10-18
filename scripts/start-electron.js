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
