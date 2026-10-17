/**
 * 生成 Windows 任务栏缩略图工具栏（Thumbnail Toolbar）按钮图标
 *
 * 用法： node scripts/gen_thumbar_icons.js
 * 依赖： sharp（已用作项目依赖，仅构建期使用）
 *
 * 图标源文件就是本文件里的 SVG 路径（Material Design filled 风格，24×24 视框），
 * 渲染为 32×32 PNG（24px 字形居中，四周留 4px），输出两份配色：
 *
 *   *_dark.png  —— 系统暗色模式下使用（白色字形）
 *   *_light.png —— 系统亮色模式下使用（深色字形）
 *
 * 命名与 build/icon.png（亮色）/ build/icon-dark.png（暗色）保持一致，
 * 由 electron/thumbar.js 按 nativeTheme.shouldUseDarkColors 选取。
 * 改图标只需改 GLYPHS 后重跑本脚本。
 */
'use strict';

const path = require('path');
const fs = require('fs');
const sharp = require('sharp');

const OUT_DIR = path.join(__dirname, '..', 'build', 'thumbar');
const SIZE = 32;
const PADDING = 2;   // 24px 字形居中于 32px 画布（内边距越小，按钮里的图标越大）

// Material Design filled 图标路径（viewBox 0 0 24 24）
const GLYPHS = {
  prev: 'M6 6h2v12H6zm3.5 6 8.5 6V6z',
  play: 'M8 5v14l11-7z',
  pause: 'M6 19h4V5H6v14zm8-14v14h4V5h-4z',
  next: 'M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z',
  // 未收藏：描边心形（favorite_border）
  like: 'M16.5 3c-1.74 0-3.41.81-4.5 2.09C10.91 3.81 9.24 3 7.5 3 4.42 3 2 5.42 2 8.5c0 3.78 ' +
    '3.4 6.86 8.55 11.54L12 21.35l1.45-1.32C18.6 15.36 22 12.28 22 8.5 22 5.42 19.58 3 16.5 3zm-4.4 ' +
    '15.55l-.1.1-.1-.1C7.14 14.24 4 11.39 4 8.5 4 6.5 5.5 5 7.5 5c1.54 0 3.04.99 3.57 2.36h1.87C13.46 ' +
    '5.99 14.96 5 16.5 5c2 0 3.5 1.5 3.5 3.5 0 2.89-3.14 5.74-7.9 10.05z',
  // 已收藏：实心心形（favorite）
  liked: 'M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 ' +
    '2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z',
};

const VARIANTS = {
  dark: '#FFFFFF',   // 系统暗色 → 白色字形
  light: '#1B1B1B',  // 系统亮色 → 深色字形
};

function buildSvg(glyph, color) {
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" ` +
    `viewBox="0 0 ${SIZE} ${SIZE}">` +
    `<g transform="translate(${PADDING} ${PADDING})">` +
    `<path fill="${color}" d="${glyph}"/>` +
    `</g></svg>`
  );
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  for (const [name, glyph] of Object.entries(GLYPHS)) {
    for (const [variant, color] of Object.entries(VARIANTS)) {
      const out = path.join(OUT_DIR, `${name}_${variant}.png`);
      await sharp(buildSvg(glyph, color), { density: 288 })
        .resize(SIZE, SIZE)
        .png({ compressionLevel: 9 })
        .toFile(out);
      console.log(`[gen-thumbar] ${path.relative(process.cwd(), out)} (${fs.statSync(out).size}B)`);
    }
  }
}

main().catch((e) => {
  console.error('[gen-thumbar] 生成失败:', e);
  process.exit(1);
});
