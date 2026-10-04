// KIT-27 soát theo tile (captain msg 022, 0 API): chia ảnh thành lưới tile ~30 mm (chồng 10 %), mỗi tile 1 ảnh đôi
// ảnh gốc | overlay ký hiệu (review.svg) có thước mm tuyệt đối, + kiểm tra tự động theo viên (tools/kit27_audit.py) gom theo tile
// và xếp hạng tile nghi ngờ. Soát bằng mắt ghi vào <out>/tile_audit.json (tools/kit27_audit.mjs không tự sinh phần đó).
//   node tools/kit27_audit.mjs --svg outputs/kit/kit27/queen.svg --review outputs/kit/kit27/review.svg \
//     [--bg outputs/kit/queen_template/input_upscaled.jpg] [--mask kit/templates/queen_mask.png] [--seg outputs/kit/kit20/seg_sam_all.json] \
//     [--fill outputs/kit/kit27/fill_regions.json] [--out outputs/kit/kit27] [--tile 30] [--overlap 0.1] [--px 600] [--no-png]
// ra: <out>/tiles/<id>.png, <out>/tiles/index.json (tile, khung mm, số lỗi tự động theo loại, điểm nghi ngờ), <out>/auto_audit.json
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { readKitSvg } from '../lib/kit/svgio.js';
import { entryOf } from '../lib/kit/catalog.js';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const args = process.argv.slice(2), flag = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const OUT = path.resolve(ROOT, flag('--out', 'outputs/kit/kit27'));
const SVG = path.resolve(ROOT, flag('--svg', path.join(OUT, 'queen.svg'))), REV = path.resolve(ROOT, flag('--review', path.join(OUT, 'review.svg')));
const BG = path.resolve(ROOT, flag('--bg', 'outputs/kit/queen_template/input_upscaled.jpg')), MASK = path.resolve(ROOT, flag('--mask', 'kit/templates/queen_mask.png'));
const SEG = path.resolve(ROOT, flag('--seg', 'outputs/kit/kit20/seg_sam_all.json')), FILL = path.resolve(ROOT, flag('--fill', path.join(OUT, 'fill_regions.json')));
const TILE = +flag('--tile', 30), OVL = +flag('--overlap', 0.1), PX = +flag('--px', 600);
const PY = process.env.PEARL_KIT20_PY || path.join(process.env.HOME, '.cache/kit20/venv/bin/python');
// điểm nghi ngờ / tile: trọng số theo loại × mức (high 3, med 2, low 1)
const WT = { bigMiss: 3, shapeMis: 3, outside: 3, fillHole: 2, labelIncons: 1, colorDE: 0.5, emptyLarge: 0.5 }, SEV = { high: 3, med: 2, low: 1 };

const doc = readKitSvg(fs.readFileSync(SVG, 'utf8')), k = doc.canvas.pxPerMm, W = doc.canvas.widthPx;
const physOf = (s) => { const m = /_S([\d.]+)(?:x([\d.]+))?$/.exec(s.group || ''); return m ? (m[2] ? Math.sqrt(+m[1] * +m[2]) : +m[1]) : s.dMm; };
const stones = doc.stones.map((s) => ({ id: s.id, code: s.code, x: s.x, y: s.y, shape: s.shape || 'round', wMm: s.wMm, hMm: s.hMm, physMm: +physOf(s).toFixed(2) }));
const seg = JSON.parse(fs.readFileSync(SEG, 'utf8')).instances.map((o) => ({ x: o.x, y: o.y, dMm: o.dMm, shape: o.shape, solidity: o.solidity, score: o.score, ellIoU: o.ellIoU }));
const fill = fs.existsSync(FILL) ? JSON.parse(fs.readFileSync(FILL, 'utf8')).regions.filter((r) => r.enabled !== false && r.polygon?.length >= 3).map((r) => ({ id: r.id, physMm: r.physMm, polygon: r.polygon })) : [];
fs.mkdirSync(path.join(OUT, 'tiles'), { recursive: true });
const tmp = path.join(OUT, 'tiles', '_in.json'), itemsF = path.join(OUT, 'tiles', '_items.json');
fs.writeFileSync(tmp, JSON.stringify({ ppm: k, stones, seg, fill, palette: doc.palette.map((p) => ({ ...p, physMm: entryOf(p.code)?.physMm, shape: entryOf(p.code)?.shape || 'round', kind: entryOf(p.code)?.kind })), params: { dE: 15, dEHigh: 25, gapMm: 0.15 } }));
console.log('auto:', execFileSync(PY, [path.join(ROOT, 'tools', 'kit27_audit.py'), tmp, BG, MASK, itemsF], { encoding: 'utf8' }).trim());
const auto = JSON.parse(fs.readFileSync(itemsF, 'utf8'));
fs.rmSync(tmp); fs.rmSync(itemsF);

// lưới tile trên khung bao các viên (± 2 mm), bước = tile × (1 − chồng)
const xs = stones.map((s) => s.x / k), ys = stones.map((s) => s.y / k), step = TILE * (1 - OVL);
const x0 = Math.max(0, Math.min(...xs) - 2), y0 = Math.max(0, Math.min(...ys) - 2), x1 = Math.min(300, Math.max(...xs) + 2), y1 = Math.min(300, Math.max(...ys) + 2);
const nx = Math.max(1, Math.ceil((x1 - x0 - TILE) / step) + 1), ny = Math.max(1, Math.ceil((y1 - y0 - TILE) / step) + 1);
const tiles = [];
for (let r = 0; r < ny; r++) for (let c = 0; c < nx; c++) {
  const bx = Math.min(x0 + c * step, 300 - TILE), by = Math.min(y0 + r * step, 300 - TILE), box = [bx, by, TILE, TILE].map((v) => +v.toFixed(2));
  const inB = (x, y) => x / k >= bx && x / k < bx + TILE && y / k >= by && y / k < by + TILE;
  const st = stones.filter((s) => inB(s.x, s.y));
  if (st.length < 3) continue;
  const its = auto.items.filter((i) => inB(i.x, i.y)).map((i) => ({ ...i, xMm: +(i.x / k).toFixed(1), yMm: +(i.y / k).toFixed(1), x: undefined, y: undefined }));
  const by_ = {}; for (const i of its) by_[i.type] = (by_[i.type] || 0) + 1;
  const score = +its.reduce((a, i) => a + (WT[i.type] || 1) * SEV[i.sev], 0).toFixed(1);
  tiles.push({ id: `r${String(r).padStart(2, '0')}c${String(c).padStart(2, '0')}`, boxMm: box, stones: st.length, densityPerCm2: +(st.length / (TILE * TILE / 100)).toFixed(1), auto: by_, score, items: its });
}
const rank = [...tiles].sort((a, b) => b.score - a.score).map((t) => t.id);
tiles.forEach((t) => { t.rank = rank.indexOf(t.id) + 1; t.file = `tiles/${t.id}.png`; });

// ảnh đôi: trái = ảnh gốc, phải = overlay ký hiệu; thước mm tuyệt đối mỗi 5 mm
if (!args.includes('--no-png')) {
  const rv = fs.readFileSync(REV, 'utf8'), inner = rv.slice(rv.indexOf('>', rv.indexOf('<svg')) + 1, rv.lastIndexOf('</svg>')).replace(/<title>[\s\S]*?<\/title>/, '');
  const L = 44, T = 26, G = 12, Wt = L + 2 * PX + G, Ht = T + PX, f = PX / TILE;
  for (const t of tiles) {
    const [bx, by] = t.boxMm, vb = `${(bx * k).toFixed(1)} ${(by * k).toFixed(1)} ${(TILE * k).toFixed(1)} ${(TILE * k).toFixed(1)}`;
    let ticks = '';
    for (let v = Math.ceil(bx / 5) * 5; v <= bx + TILE; v += 5) for (const ox of [L, L + PX + G]) { const X = ox + (v - bx) * f; ticks += `<line x1="${X}" y1="${T - 7}" x2="${X}" y2="${T}" stroke="#000"/><text x="${X}" y="${T - 10}" font-size="11" text-anchor="middle">${v}</text>`; }
    for (let v = Math.ceil(by / 5) * 5; v <= by + TILE; v += 5) { const Y = T + (v - by) * f; ticks += `<line x1="${L - 7}" y1="${Y}" x2="${L}" y2="${Y}" stroke="#000"/><text x="${L - 9}" y="${Y + 4}" font-size="11" text-anchor="end">${v}</text>`; }
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${Wt}" height="${Ht}" viewBox="0 0 ${Wt} ${Ht}"><rect width="${Wt}" height="${Ht}" fill="#fff"/>`
      + `<text x="4" y="12" font-size="11" font-family="Arial">${t.id}</text><g font-family="Arial">${ticks}</g>`
      + `<svg x="${L + PX + G}" y="${T}" width="${PX}" height="${PX}" viewBox="${vb}" preserveAspectRatio="none">${inner}</svg>`
      + `<svg x="${L}" y="${T}" width="${PX}" height="${PX}" viewBox="${vb}" preserveAspectRatio="none"><use href="#source-image" xlink:href="#source-image"/></svg></svg>`;
    const f_ = path.join(OUT, 'tiles', `${t.id}.svg`);
    fs.writeFileSync(f_, svg);
    execFileSync('rsvg-convert', ['-o', path.join(OUT, t.file), f_]);
    fs.rmSync(f_);
  }
}
const totals = {}; for (const i of auto.items) { totals[i.type] ||= { high: 0, med: 0, low: 0 }; totals[i.type][i.sev]++; }
const index = { schema: 'pearl-kit-tiles/1', svg: path.relative(ROOT, SVG), tileMm: TILE, overlap: OVL, px: PX, n: tiles.length, totals, rank, tiles };
fs.writeFileSync(path.join(OUT, 'tiles', 'index.json'), JSON.stringify(index, null, 1));
fs.writeFileSync(path.join(OUT, 'auto_audit.json'), JSON.stringify({ svg: index.svg, totals, items: auto.items.map((i) => ({ ...i, xMm: +(i.x / k).toFixed(1), yMm: +(i.y / k).toFixed(1) })) }, null, 1));
console.log(`${tiles.length} tile ${TILE} mm (lưới ${nx}×${ny}), tổng lỗi tự động ${JSON.stringify(totals)}; top: ${rank.slice(0, 8).map((id) => `${id}:${tiles.find((t) => t.id === id).score}`).join(' ')}`);
