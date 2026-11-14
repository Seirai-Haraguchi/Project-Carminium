'use strict';

const path = require('path');
const fs = require('fs');
const sharp = require('sharp');

const OUT_DIR = path.join(__dirname, '..', 'build', 'thumbar');
const SIZE = 32;
const VIEWBOX = 24;
const GLYPH_BOX = 24;
const RASTER = SIZE * 8;

const GLYPHS = {
  prev: 'M6 6h2v12H6zm3.5 6 8.5 6V6z',
  play: 'M8 5v14l11-7z',
  pause: 'M6 19h4V5H6v14zm8-14v14h4V5h-4z',
  next: 'M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z',
  like: 'M16.5 3c-1.74 0-3.41.81-4.5 2.09C10.91 3.81 9.24 3 7.5 3 4.42 3 2 5.42 2 8.5c0 3.78 ' +
    '3.4 6.86 8.55 11.54L12 21.35l1.45-1.32C18.6 15.36 22 12.28 22 8.5 22 5.42 19.58 3 16.5 3zm-4.4 ' +
    '15.55l-.1.1-.1-.1C7.14 14.24 4 11.39 4 8.5 4 6.5 5.5 5 7.5 5c1.54 0 3.04.99 3.57 2.36h1.87C13.46 ' +
    '5.99 14.96 5 16.5 5c2 0 3.5 1.5 3.5 3.5 0 2.89-3.14 5.74-7.9 10.05z',
  liked: 'M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 ' +
    '2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z',
};

const VARIANTS = {
  dark: '#FFFFFF',
  light: '#1B1B1B',
};

function buildSvg(glyph, color) {
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${RASTER}" height="${RASTER}" ` +
    `viewBox="0 0 ${VIEWBOX} ${VIEWBOX}">` +
    `<path fill="${color}" d="${glyph}"/></svg>`
  );
}

function alphaBBox(data, width, height) {
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const a = data[(y * width + x) * 4 + 3];
      if (a > 16) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  return { left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

async function renderGlyph(glyph, color) {
  const { data, info } = await sharp(buildSvg(glyph, color), { density: 288 })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const box = alphaBBox(data, info.width, info.height);
  if (!box) throw new Error('图标渲染为空');

  const glyphBuf = await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
    .extract(box)
    .resize(GLYPH_BOX, GLYPH_BOX, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png({ compressionLevel: 9 })
    .toBuffer();

  const meta = await sharp(glyphBuf).metadata();
  const left = Math.round((SIZE - meta.width) / 2);
  const top = Math.round((SIZE - meta.height) / 2);

  return sharp({
    create: { width: SIZE, height: SIZE, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([{ input: glyphBuf, left, top }])
    .png({ compressionLevel: 9 })
    .toBuffer();
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  for (const [name, glyph] of Object.entries(GLYPHS)) {
    for (const [variant, color] of Object.entries(VARIANTS)) {
      const out = path.join(OUT_DIR, `${name}_${variant}.png`);
      const buf = await renderGlyph(glyph, color);
      fs.writeFileSync(out, buf);
      console.log(`[gen-thumbar] ${path.relative(process.cwd(), out)} (${buf.length}B)`);
    }
  }
}

main().catch((e) => {
  console.error('[gen-thumbar] 生成失败:', e);
  process.exit(1);
});
