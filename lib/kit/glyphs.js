// Bộ chữ ký hiệu (Arial Bold như file SVG mẫu) nướng sẵn thành mask alpha ở 100px → kit/glyphs.json, để render.js
// vẽ chữ không cần font/thư viện. Nướng lại (cần rsvg-convert): node lib/kit/glyphs.js
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { decodePng } from '../png.js';

export const GLYPH_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'kit', 'glyphs.json');
export const CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
// Bề rộng chữ (advance, đơn vị font /2048) của Arial Bold. SVG mẫu đặt text x = tâm − advancePx/2 với
// advancePx = advance·fontPx/2048 làm tròn 1/64 px (như FreeType), y = tâm + 0.36·fontPx.
export const ADVANCE = { ...Object.fromEntries([...'0123456789'].map((c) => [c, 1139])),
  A: 1479, B: 1479, C: 1479, D: 1479, E: 1366, F: 1251, G: 1593, H: 1479, I: 569, J: 1139, K: 1479, L: 1251, M: 1706,
  N: 1479, O: 1593, P: 1366, Q: 1593, R: 1479, S: 1366, T: 1251, U: 1479, V: 1366, W: 1933, X: 1366, Y: 1366, Z: 1251 };
export const advancePx = (ch, fontPx) => Math.round((ADVANCE[ch] * fontPx * 64) / 2048) / 64;
export const BASELINE = 0.36;
const EM = 100, CELL = 160, OX = 30, OY = 120;

export function bakeGlyphs(rsvg = 'rsvg-convert') {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${CELL * CHARS.length}" height="${CELL}">` +
    [...CHARS].map((c, i) => `<text x="${i * CELL + OX}" y="${OY}" font-family="Arial" font-weight="700" font-size="${EM}px" fill="#000">${c}</text>`).join('') + '</svg>';
  const img = decodePng(execFileSync(rsvg, ['-f', 'png'], { input: svg, maxBuffer: 1 << 26 }));
  const glyphs = {};
  [...CHARS].forEach((c, i) => {
    let x0 = CELL, y0 = CELL, x1 = -1, y1 = -1;
    for (let y = 0; y < CELL; y++) for (let x = 0; x < CELL; x++) if (img.data[(y * img.w + i * CELL + x) * 4 + 3]) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    const w = x1 - x0 + 1, h = y1 - y0 + 1, a = Buffer.alloc(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) a[y * w + x] = img.data[((y0 + y) * img.w + i * CELL + x0 + x) * 4 + 3];
    glyphs[c] = { x: x0 - OX, y: y0 - OY, w, h, a: zlib.deflateSync(a, { level: 9 }).toString('base64') };
  });
  return { font: 'Arial Bold', em: EM, advance: ADVANCE, baseline: BASELINE, glyphs };
}

let cache;
// → { em, glyphs: {c: {x, y, w, h, a: Uint8Array}} } (x, y = góc trên-trái của mask so với gốc chữ trên baseline, ở cỡ em)
export function loadGlyphs(file = GLYPH_FILE) {
  if (cache) return cache;
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const g of Object.values(j.glyphs)) g.a = new Uint8Array(zlib.inflateSync(Buffer.from(g.a, 'base64')));
  return (cache = j);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  fs.mkdirSync(path.dirname(GLYPH_FILE), { recursive: true });
  fs.writeFileSync(GLYPH_FILE, JSON.stringify(bakeGlyphs()) + '\n');
  console.log(`ghi ${GLYPH_FILE} (${fs.statSync(GLYPH_FILE).size} byte)`);
}
