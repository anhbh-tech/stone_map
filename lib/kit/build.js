// KIT-1: đọc 3 bản đồ đá mẫu → kit/<layer>.json + kit/palette.json, render lại (kiểu _3 sạch và kiểu _1 có ký hiệu),
// ghép trang phục lên nền, so với ảnh _1/_3 gốc → outputs/kit/ (ảnh + compare.json). Không gọi API nào.
//   node lib/kit/build.js            (KIT_SRC = thư mục "FIle Map đá", PEARL_VENV_PY = python có OpenCV để đọc JPEG)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseKitSvg, buildPalette, PX_PER_MM } from './svg.js';
import { renderMap, over, hex } from './render.js';
import { encodePng } from '../png.js';
import { pixelIO } from '../pixels.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const LAYERS = {
  starry: 'Starry Night Pearl Diamond Painting Kit - Royal Arch',
  king: 'Royal King Pearl Diamond Painting Kit - Navy Gold Regalia',
  queen: 'Royal Queen Pearl Diamond Painting Kit - Red Gold Regalia',
};

// Ghi JSON 1 viên / dòng (diff đọc được).
export function mapJson(map) {
  const { stones, ...head } = map;
  return `${JSON.stringify(head).slice(0, -1)},"stones":[\n${stones.map((s) => JSON.stringify(s)).join(',\n')}\n]}\n`;
}

export function importMaps(src) {
  const parsed = Object.entries(LAYERS).map(([layer, f]) => parseKitSvg(fs.readFileSync(path.join(src, `${f}_reference_symbols_only.svg`), 'utf8'), layer));
  return { parsed, palette: buildPalette(parsed) };
}

// Ảnh gốc → {w,h,data,mask}: mask = alpha ≥ 128, ảnh không alpha thì = khác màu nền (góc trên-trái) > 12.
async function readSource(io, file) {
  const img = await io.read(file), d = img.data, N = img.w * img.h, mask = new Uint8Array(N);
  let hasAlpha = false;
  for (let j = 0; j < N; j++) if (d[j * 4 + 3] < 255) { hasAlpha = true; break; }
  const bg = [d[0], d[1], d[2]];
  for (let j = 0; j < N; j++) mask[j] = hasAlpha ? d[j * 4 + 3] >= 128 : Math.max(...[0, 1, 2].map((c) => Math.abs(d[j * 4 + c] - bg[c]))) > 12;
  return { ...img, mask, hasAlpha, bg };
}

const r1 = (v, n = 2) => Math.round(v * 10 ** n) / 10 ** n;
// Số liệu ours ↔ gốc: IoU vùng đá, sai khác màu trung bình trong vùng chung, màu từng viên (trung bình đĩa 0.5r).
export function compareImages(ours, orig, stones, { discOnly = false, palette } = {}) {
  const N = ours.w * ours.h, a = ours.data, b = orig.data;
  let inter = 0, uni = 0, oo = 0, go = 0, sum = 0, n = 0, big = 0;
  const inDisc = discOnly ? new Uint8Array(N) : null;
  if (discOnly) for (const s of stones) {
    const r = (s.dMm * PX_PER_MM) / 2 * 0.95;
    for (let y = Math.floor(s.y - r); y <= Math.ceil(s.y + r); y++) for (let x = Math.floor(s.x - r); x <= Math.ceil(s.x + r); x++)
      if (x >= 0 && y >= 0 && x < ours.w && y < ours.h && Math.hypot(x + 0.5 - s.x, y + 0.5 - s.y) <= r) inDisc[y * ours.w + x] = 1;
  }
  for (let j = 0; j < N; j++) {
    const p = a[j * 4 + 3] >= 128, q = orig.mask[j];
    if (p && q) inter++; if (p || q) uni++; if (p && !q) oo++; if (q && !p) go++;
    if (p && q && (!discOnly || inDisc[j])) {
      let m = 0, t = 0;
      for (let c = 0; c < 3; c++) { const e = Math.abs(a[j * 4 + c] - b[j * 4 + c]); t += e; if (e > m) m = e; }
      sum += t / 3; n++; if (m > 40) big++;
    }
  }
  const fillDE = [];
  const stoneDE = stones.map((s) => {
    const r = (s.dMm * PX_PER_MM) / 4, A = [0, 0, 0], B = [0, 0, 0];
    let k = 0;
    for (let y = Math.floor(s.y - r); y <= Math.ceil(s.y + r); y++) for (let x = Math.floor(s.x - r); x <= Math.ceil(s.x + r); x++) {
      if (x < 0 || y < 0 || x >= ours.w || y >= ours.h || Math.hypot(x + 0.5 - s.x, y + 0.5 - s.y) > r) continue;
      const j = (y * ours.w + x) * 4; k++;
      for (let c = 0; c < 3; c++) { A[c] += a[j + c]; B[c] += b[j + c]; }
    }
    if (palette && k) { const f = hex(palette.codes[s.code].fill); fillDE.push(Math.hypot(...B.map((v, c) => v / k - f[c]))); }
    return k ? Math.hypot(...A.map((v, c) => (v - B[c]) / k)) : 0;
  }).sort((x, y) => x - y);
  fillDE.sort((x, y) => x - y);
  const qq = (arr, f) => r1(arr[Math.min(arr.length - 1, Math.floor(f * arr.length))], 1);
  const q = (f) => qq(stoneDE, f);
  return {
    maskIoU: r1(inter / uni, 4), oursOnlyPct: r1((100 * oo) / N), origOnlyPct: r1((100 * go) / N),
    meanAbsDiff: r1(sum / n), pctPixelsDiffOver40: r1((100 * big) / n), comparedPx: n,
    stoneMeanRgbDist: { median: q(0.5), p90: q(0.9), max: q(1) },
    ...(palette && { paletteFillVsOrigRgbDist: { median: qq(fillDE, 0.5), p90: qq(fillDE, 0.9), max: qq(fillDE, 1) } }),
  };
}

// Thu nhỏ theo hệ số nguyên (box), trộn lên nền trắng → RGB đục.
export function shrinkOnWhite(img, f) {
  const W = Math.floor(img.w / f), H = Math.floor(img.h / f), out = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const acc = [0, 0, 0];
    for (let v = 0; v < f; v++) for (let u = 0; u < f; u++) {
      const j = ((y * f + v) * img.w + x * f + u) * 4, al = img.data[j + 3] / 255;
      for (let c = 0; c < 3; c++) acc[c] += img.data[j + c] * al + 255 * (1 - al);
    }
    const o = (y * W + x) * 4;
    for (let c = 0; c < 3; c++) out[o + c] = Math.round(acc[c] / (f * f));
    out[o + 3] = 255;
  }
  return { w: W, h: H, data: out };
}

// Ghép các ảnh cùng cỡ thành lưới cols cột, khe 8px xám.
export function grid(imgs, cols) {
  const w = imgs[0].w, h = imgs[0].h, g = 8, rows = Math.ceil(imgs.length / cols);
  const W = cols * w + (cols + 1) * g, H = rows * h + (rows + 1) * g, out = new Uint8Array(W * H * 4).fill(96);
  imgs.forEach((im, i) => {
    const ox = g + (i % cols) * (w + g), oy = g + Math.floor(i / cols) * (h + g);
    for (let y = 0; y < h; y++) out.set(im.data.subarray(y * w * 4, (y + 1) * w * 4), ((oy + y) * W + ox) * 4);
  });
  return { w: W, h: H, data: out };
}

export function crop(img, x0, y0, w, h) {
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) out.set(img.data.subarray(((y0 + y) * img.w + x0) * 4, ((y0 + y) * img.w + x0 + w) * 4), y * w * 4);
  return { w, h, data: out };
}

const save = (file, img, opts = {}) => fs.writeFileSync(file, encodePng(img.w, img.h, img.data, {}, { compact: true, ...opts }));

async function main() {
  const src = process.env.KIT_SRC || path.join(process.cwd(), 'requirements', 'FIle Map đá');
  const out = process.env.KIT_OUT || path.join(ROOT, 'outputs', 'kit');
  const io = pixelIO(process.env.PEARL_VENV_PY || path.join(ROOT, '.venv', 'bin', 'python'), path.join(ROOT, 'tools', 'pixels.py'));
  fs.mkdirSync(out, { recursive: true });
  const { parsed, palette } = importMaps(src);
  fs.mkdirSync(path.join(ROOT, 'kit'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'kit', 'palette.json'), JSON.stringify(palette, null, 1) + '\n');
  for (const { map } of parsed) fs.writeFileSync(path.join(ROOT, 'kit', `${map.layer}.json`), mapJson(map));
  console.log(`kit/: palette ${Object.keys(palette.codes).length} mã; ${parsed.map((p) => `${p.map.layer} ${p.map.stones.length}`).join(', ')}`);

  const report = { field: { marginMm: 0.8, closeMm: 3 }, layers: {} }, R = {};
  for (const { map } of parsed) {
    const t0 = Date.now();
    const clean = renderMap(map, palette, { style: 'clean' }), sym = renderMap(map, palette, { style: 'symbols' });
    save(path.join(out, `${map.layer}_clean.png`), clean); save(path.join(out, `${map.layer}_symbols.png`), sym);
    R[map.layer] = { clean, sym };
    const base = path.join(src, LAYERS[map.layer]);
    const pick = (n) => [`${base}_${n}.png`, `${base}_${n}.jpg`].find((f) => fs.existsSync(f));
    const o3 = await readSource(io, pick(3)), o1 = await readSource(io, pick(1));
    report.layers[map.layer] = {
      stones: map.stones.length,
      sources: { _3: { file: path.basename(pick(3)), alpha: o3.hasAlpha, bg: o3.bg }, _1: { file: path.basename(pick(1)), alpha: o1.hasAlpha, bg: o1.bg } },
      cleanVs3: compareImages(clean, o3, map.stones, { palette }),
      symbolsVs1: compareImages(sym, o1, map.stones),
      symbolsVs1InDiscs: compareImages(sym, o1, map.stones, { discOnly: true }),
    };
    const f = 3, ims = [o3, clean, o1, sym].map((im) => shrinkOnWhite(im, f));
    save(path.join(out, `${map.layer}_compare.png`), grid(ims, 2), { rgb: true });
    // Chi tiết 1:1 quanh viên lớn nhất ở giữa ảnh.
    const big = [...map.stones].sort((a, b) => b.dMm - a.dMm || Math.hypot(a.x - 1771, a.y - 1771) - Math.hypot(b.x - 1771, b.y - 1771))[0];
    const S = 360, x0 = Math.max(0, Math.min(map.px - S, Math.round(big.x - S / 2))), y0 = Math.max(0, Math.min(map.px - S, Math.round(big.y - S / 2)));
    save(path.join(out, `${map.layer}_detail.png`), grid([o3, clean, o1, sym].map((im) => shrinkOnWhite(crop(im, x0, y0, S, S), 1)), 4), { rgb: true });
    report.layers[map.layer].detailAt = { x0, y0, size: S };
    console.log(`${map.layer}: ${((Date.now() - t0) / 1000).toFixed(1)}s`, JSON.stringify(report.layers[map.layer].cleanVs3));
  }
  // Trang phục đè lên nền (chưa có đầu pet) + số viên trang phục chồng lên viên nền.
  for (const k of ['king', 'queen']) {
    save(path.join(out, `${k}_on_starry.png`), over(R.starry.clean, R[k].clean), { rgb: true });
    save(path.join(out, `${k}_on_starry_symbols.png`), over(R.starry.sym, R[k].sym), { rgb: true });
    const bg = parsed.find((p) => p.map.layer === 'starry').map.stones, top = parsed.find((p) => p.map.layer === k).map.stones;
    const cell = 60, buckets = new Map();
    for (const s of bg) { const key = `${Math.floor(s.x / cell)},${Math.floor(s.y / cell)}`; (buckets.get(key) || buckets.set(key, []).get(key)).push(s); }
    let overlap = 0;
    for (const s of top) {
      const cx = Math.floor(s.x / cell), cy = Math.floor(s.y / cell);
      let hit = false;
      for (let dy = -1; dy <= 1 && !hit; dy++) for (let dx = -1; dx <= 1 && !hit; dx++)
        for (const b of buckets.get(`${cx + dx},${cy + dy}`) || []) if (Math.hypot(b.x - s.x, b.y - s.y) < ((b.dMm + s.dMm) / 2) * PX_PER_MM) { hit = true; break; }
      if (hit) overlap++;
    }
    report[`${k}OverStarry`] = { stonesOverlappingStarry: overlap, of: top.length };
  }
  fs.writeFileSync(path.join(out, 'compare.json'), JSON.stringify(report, null, 1) + '\n');
  console.log(JSON.stringify(report, null, 1));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch((e) => { console.error(e); process.exit(1); });
