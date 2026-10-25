'use strict';
/*
 * Electron 探针：测两件在纯 Node 里测不到的事
 *  A) Chromium decodeAudioData 的真实耗时与内存（整曲解码）
 *  B) 现有交叉淡变 DSP 图在 OfflineAudioContext 里的实时因子
 *     （普通双流 / 加 wash 链 / 再加 expansion 卷积混响+回声+10 个碎片源）
 * 用法: node_modules/.bin/electron scripts/bench/electron_probe/main.js
 */
const { app, BrowserWindow } = require('electron');
const path = require('path');

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false,
    width: 400,
    height: 300,
    webPreferences: { nodeIntegration: true, contextIsolation: false, backgroundThrottling: false },
  });
  await win.loadFile(path.join(__dirname, 'page.html'));

  try {
    const res = await win.webContents.executeJavaScript('runBench()', true);
    console.log('BENCH_RESULT ' + JSON.stringify(res, null, 2));
  } catch (e) {
    console.log('BENCH_ERROR ' + (e && e.message));
  }
  app.exit(0);
});
