// Bản soát ký hiệu: ảnh gốc làm nền (không che), mỗi viên = viền mảnh theo cỡ vẽ + ký hiệu ở tâm.
// Captain tự đối chứng ký hiệu với hạt vẽ bên dưới (không thay bằng viên giả lập).
// node tools/kit_review_overlay.mjs <map.svg> <ảnh nguồn> <out.svg>
import fs from 'node:fs';
import path from 'node:path';
import { readKitSvg } from '../lib/kit/svgio.js';

const [mapFile, imgFile, outFile] = process.argv.slice(2);
if (!outFile) { console.error('dùng: node tools/kit_review_overlay.mjs <map.svg> <ảnh> <out.svg>'); process.exit(1); }
const d = readKitSvg(fs.readFileSync(mapFile, 'utf8'));
const W = d.canvas.widthPx, H = d.canvas.heightPx, k = d.canvas.pxPerMm;
const pal = Object.fromEntries(d.palette.map((p) => [p.code, p]));
const mime = /\.png$/i.test(imgFile) ? 'image/png' : 'image/jpeg';
const href = `data:${mime};base64,${fs.readFileSync(imgFile).toString('base64')}`;
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

const shapeEl = (s, col) => {
  const st = `data-id="${s.id}" data-shape="${s.shape || 'round'}" data-mm="${s.shape && s.shape !== 'round' ? `${s.wMm}x${s.hMm}` : s.dMm}" fill="none" stroke="${col}" stroke-width="${(0.12 * k).toFixed(2)}"`;
  if (!s.shape || s.shape === 'round') return `<circle cx="${s.x}" cy="${s.y}" r="${((s.dMm * k) / 2).toFixed(2)}" ${st}/>`;
  const rx = ((s.wMm || s.dMm / 2) * k) / 2, ry = ((s.hMm || s.dMm) * k) / 2;
  return `<ellipse cx="${s.x}" cy="${s.y}" rx="${rx.toFixed(2)}" ry="${ry.toFixed(2)}" transform="rotate(${s.rot || 0} ${s.x} ${s.y})" ${st} stroke-dasharray="${(0.5 * k).toFixed(1)} ${(0.3 * k).toFixed(1)}"/>`;
};

const byCode = {};
for (const s of d.stones) (byCode[s.code] ||= []).push(s);
const groups = Object.entries(byCode).map(([code, ss]) => {
  const p = pal[code] || {}, col = p.rgb || '#ff00ff';
  const fs_ = (s) => Math.max(0.9 * k, Math.min(0.55 * Math.min(s.wMm || s.dMm, s.dMm) * k, 4 * k));
  const body = ss.map((s) => `${shapeEl(s, col)}<text x="${s.x}" y="${s.y}" font-size="${fs_(s).toFixed(1)}">${esc(s.symbol)}</text>`).join('');
  return `<g id="code-${code}" data-code="${code}" data-symbol="${esc(p.symbol || '')}" data-count="${ss.length}">${body}</g>`;
});

const legend = d.palette.map((p, i) => `<text x="${(4 * k).toFixed(0)}" y="${((6 + i * 4) * k).toFixed(0)}" font-size="${(3 * k).toFixed(0)}" class="lg">${esc(p.symbol)} = ${p.code} · ${(byCode[p.code] || []).length}</text>`).join('');
const out = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="300mm" height="300mm" viewBox="0 0 ${W} ${H}">
<title>Soát ký hiệu — ${path.basename(mapFile)} (${d.stones.length} viên, ${d.palette.length} mã)</title>
<style>text{font-family:Arial,Helvetica,sans-serif;font-weight:700;text-anchor:middle;dominant-baseline:central;fill:#000;stroke:#fff;stroke-width:${(0.18 * k).toFixed(2)};paint-order:stroke}.lg{text-anchor:start}</style>
<g id="source-image"><image href="${href}" x="0" y="0" width="${W}" height="${H}" preserveAspectRatio="none"/></g>
<g id="stones">${groups.join('\n')}</g>
<g id="legend">${legend}</g>
</svg>
`;
fs.writeFileSync(outFile, out);
console.log(`${outFile}: ${d.stones.length} viên, ${d.palette.length} mã`);
