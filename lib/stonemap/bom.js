// BOM sản phẩm: ký hiệu → mã → thông tin catalog → số viên theo layer + tổng (+10 % dự phòng).
//   bomOf(design, cat) → { catalogVersion, layers, rows: [{ symbol, code, series, kind, shape, phys_mm, phys_w_mm, phys_h_mm, ref_mm, color_name, color_hex,
//     byLayer, total, count_with_10pct_spare }], totals }
//   bomCsv(bom) → CSV cột theo map_generator RUN.md §3.2 (+ shape, w/h vật lý, 1 cột / layer), dòng TOTAL cuối.
//   legendSvg(bom) → bảng ký hiệu · mã · size · màu · số lượng (+10 %); legendPng(bom, file) → PNG qua rsvg-convert (false nếu không có).
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { counts } from './design.js';

export const spare = (n) => Math.ceil(n * 1.1);

export function bomOf(d, cat) {
  const c = counts(d), layers = d.layers.map((l) => l.id);
  const rows = Object.keys(c.byCode).map((code) => {
    const e = cat.codes[code] || {}, ph = d.layers.flatMap((l) => l.stones).find((s) => s.code === code);
    const k = e.physMm ? ph.phys_mm / e.physMm : 1;
    return { symbol: d.symbols[code] ?? '', code, series: e.series ?? null, kind: e.kind ?? null, shape: e.shape ?? ph.shape,
      phys_mm: ph.phys_mm, phys_w_mm: e.physW ? e.physW * k : null, phys_h_mm: e.physH ? e.physH * k : null, ref_mm: ph.ref_mm,
      color_name: e.name || null, color_hex: e.fill ?? null,
      byLayer: Object.fromEntries(layers.map((l) => [l, c.byLayer[l].byCode[code] || 0])), total: c.byCode[code], count_with_10pct_spare: spare(c.byCode[code]) };
  }).sort((a, b) => (a.kind === 'pearl') - (b.kind === 'pearl') || a.symbol.length - b.symbol.length || a.symbol.localeCompare(b.symbol, 'en', { numeric: true }));
  return { catalogVersion: d.catalogVersion, layers, rows,
    totals: { ...Object.fromEntries(layers.map((l) => [l, c.byLayer[l].total])), total: c.total, count_with_10pct_spare: rows.reduce((a, r) => a + r.count_with_10pct_spare, 0), codes: c.codes } };
}

const cell = (v) => (v == null ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
export function bomCsv(b) {
  const head = ['symbol', 'stone_code', 'series', 'kind', 'shape', 'physical_mm', 'phys_w_mm', 'phys_h_mm', 'reference_mm', 'color_name', 'hex', ...b.layers, 'count', 'count_with_10pct_spare'];
  const lines = [head.join(',')];
  for (const r of b.rows) lines.push([r.symbol, r.code, r.series, r.kind, r.shape, r.phys_mm, r.phys_w_mm, r.phys_h_mm, r.ref_mm, r.color_name, r.color_hex, ...b.layers.map((l) => r.byLayer[l]), r.total, r.count_with_10pct_spare].map(cell).join(','));
  lines.push(['TOTAL', `${b.totals.codes} codes`, '', '', '', '', '', '', '', '', '', ...b.layers.map((l) => b.totals[l]), b.totals.total, b.totals.count_with_10pct_spare].map(cell).join(','));
  return lines.join('\n') + '\n';
}

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const textOn = (hex) => { const [r, g, b] = [1, 3, 5].map((i) => parseInt((hex || '#BBBBBB').slice(i, i + 2), 16)); return 0.299 * r + 0.587 * g + 0.114 * b > 145 ? '#111111' : '#FFFFFF'; };
export const sizeText = (r) => (r.shape === 'round' ? `${r.phys_mm} mm` : `${r.phys_w_mm}×${r.phys_h_mm} mm ${r.shape}`);

export function legendSvg(b, { title = 'Ký hiệu · mã · size · màu · số lượng (+10 %)' } = {}) {
  const RH = 46, X = [24, 96, 196, 380, 470, 720, 830], W = 960, H = 90 + RH * (b.rows.length + 1) + 20, fs = 20;
  const out = [`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`, `<rect width="${W}" height="${H}" fill="#FFFFFF"/>`,
    `<text x="24" y="34" font-family="Arial" font-weight="700" font-size="24" fill="#222">${esc(title)}</text>`];
  const head = ['Ký hiệu', 'Mã', 'Size (vật lý)', 'Màu', '', 'Số viên', '+10 %'];
  out.push(head.map((h, i) => `<text x="${X[i]}" y="74" font-family="Arial" font-weight="700" font-size="${fs - 2}" fill="#555">${esc(h)}</text>`).join(''));
  b.rows.forEach((r, n) => {
    const y = 90 + n * RH, cy = y + RH / 2, fill = r.color_hex || '#BBBBBB', pearl = r.kind === 'pearl';
    out.push(`<rect x="12" y="${y}" width="${W - 24}" height="${RH}" fill="${n % 2 ? '#F6F6F6' : '#FFFFFF'}"/>`,
      `<circle cx="${X[0] + 22}" cy="${cy}" r="18" fill="${fill}" stroke="${pearl ? '#999' : '#333'}" stroke-width="1.5"/>`,
      `<text x="${X[0] + 22}" y="${cy + 7}" text-anchor="middle" font-family="Arial" font-weight="700" font-size="${r.symbol.length > 1 ? 15 : 20}" fill="${textOn(fill)}">${esc(r.symbol)}</text>`,
      `<text x="${X[1]}" y="${cy + 7}" font-family="Arial" font-weight="700" font-size="${fs}" fill="#222">${esc(r.code)}</text>`,
      `<text x="${X[2]}" y="${cy + 7}" font-family="Arial" font-size="${fs}" fill="#222">${esc(sizeText(r))}</text>`,
      `<rect x="${X[3]}" y="${cy - 14}" width="70" height="28" rx="4" fill="${fill}" stroke="#666"/>`,
      `<text x="${X[4]}" y="${cy + 7}" font-family="Arial" font-size="${fs - 2}" fill="#222">${esc(r.color_name || '')} ${esc(r.color_hex || '')}</text>`,
      `<text x="${X[5] + 80}" y="${cy + 7}" text-anchor="end" font-family="Arial" font-size="${fs}" fill="#222">${r.total}</text>`,
      `<text x="${X[6] + 90}" y="${cy + 7}" text-anchor="end" font-family="Arial" font-weight="700" font-size="${fs}" fill="#222">${r.count_with_10pct_spare}</text>`);
  });
  const ty = 90 + b.rows.length * RH + RH / 2 + 7;
  out.push(`<line x1="12" y1="${ty - RH / 2 - 7}" x2="${W - 12}" y2="${ty - RH / 2 - 7}" stroke="#333"/>`,
    `<text x="${X[0]}" y="${ty}" font-family="Arial" font-weight="700" font-size="${fs}" fill="#222">Tổng: ${b.totals.codes} mã</text>`,
    `<text x="${X[5] + 80}" y="${ty}" text-anchor="end" font-family="Arial" font-weight="700" font-size="${fs}" fill="#222">${b.totals.total}</text>`,
    `<text x="${X[6] + 90}" y="${ty}" text-anchor="end" font-family="Arial" font-weight="700" font-size="${fs}" fill="#222">${b.totals.count_with_10pct_spare}</text>`, '</svg>');
  return out.join('\n');
}

export function legendPng(b, file, opts) {
  const svg = legendSvg(b, opts);
  try { fs.writeFileSync(file, execFileSync('rsvg-convert', ['-f', 'png'], { input: svg, maxBuffer: 1 << 26 })); return true; } catch { return false; }
}
