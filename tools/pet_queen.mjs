// KIT-17: chạy luồng thú cưng (lib/kit/pet.js runPet, 0 API) trên phần MẶT thú cưng của Queen.
//   node tools/pet_queen.mjs [--src ảnh.png] [--mask mask.png | --bbox x0,y0,x1,y1] [--opt '{"upscale":"lanczos"}']
// Mặc định: requirements/Mẫu Queen.png (1254 px = 300 mm, 4.18 px/mm → phóng ×4 Real-ESRGAN, thiếu binary thì Lanczos);
// mask = --mask (cùng khung ảnh vào) hoặc bbox tạm quanh đầu corgi (tai → cằm, đo tay trên ảnh 1254 px). Ô mặt thật của mẫu
// (kit/templates/queen_mask.png) KHÔNG cùng khung với Mẫu Queen.png → dùng tools/pet_kit19.mjs (đặt mặt vào ô, ép bảng mã, khe trang phục).
// Mã: k-NN học từ stones của Snowman + Dachshund, chọn trong mã TRÒN của catalog cùng size, rồi giới hạn ≤ 13 mã (spec).
// Ra outputs/kit/kit17/: queen_pet_zoom.jpg (ảnh phóng | đá kiểu _3, 3 chỗ: mắt, mũi, tai), queen_pet_overview.jpg, report.json.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePng, encodePng } from '../lib/png.js';
import { runPet, codeModel, limitCodes, lab } from '../lib/kit/pet.js';
import { loadCatalog } from '../lib/kit/catalog.js';
import { renderMap, over } from '../lib/kit/render.js';
import { pixelIO } from '../lib/pixels.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2), flag = (n) => { const i = args.indexOf(n); return i >= 0 ? args.splice(i, 2)[1] : null; };
const REQ = process.env.KIT_REQ || path.join(process.cwd(), 'requirements'), OUT = path.join(ROOT, 'outputs', 'kit', 'kit17');
const SRC = flag('--src') || path.join(REQ, 'Mẫu Queen.png'), opt = JSON.parse(flag('--opt') || '{}');
const maskFile = flag('--mask');
const BBOX = (flag('--bbox') || '330,150,940,720').split(',').map(Number); // px ảnh 1254: tai trái → tai phải, đỉnh tai → cằm
const py = process.env.PEARL_VENV_PY || [path.join(ROOT, '.venv', 'bin', 'python'), path.join(process.cwd(), '.venv', 'bin', 'python')].find((f) => fs.existsSync(f)) || 'python3';
const io = pixelIO(py, path.join(ROOT, 'tools', 'pixels.py'));
fs.mkdirSync(OUT, { recursive: true });

const img = decodePng(fs.readFileSync(SRC)), t0 = Date.now();
const mask = new Uint8Array(img.w * img.h);
let maskFrom;
if (maskFile) {
  const m = decodePng(fs.readFileSync(maskFile));
  if (m.w !== img.w || m.h !== img.h) throw new Error(`mask ${m.w}×${m.h} ≠ ảnh ${img.w}×${img.h}`);
  for (let j = 0; j < mask.length; j++) mask[j] = m.data[j * 4 + 3] >= 128 && m.data[j * 4] >= 128 ? 1 : 0;
  maskFrom = maskFile;
} else {
  const s = img.w / 1254, [x0, y0, x1, y1] = BBOX.map((v) => v * s);
  for (let y = Math.floor(y0); y < y1; y++) for (let x = Math.floor(x0); x < x1; x++) mask[y * img.w + x] = 1;
  maskFrom = { bbox: BBOX, note: 'bbox tạm (ô mặt thật: tools/pet_kit19.mjs)' };
}
const cat = loadCatalog(), bom = Object.values(cat.codes).filter((e) => e.kind === 'stone').map((e) => ({ code: e.code, physMm: e.physMm, lab: lab([1, 3, 5].map((i) => parseInt(e.fill.slice(i, i + 2), 16))) }));
const r = await runPet(img, { canvasWmm: 300, mask, model: codeModel(['snowman', 'dachshund']), bom, ...opt });
const stones = limitCodes(r.stones, bom, 13), work = r.img, k = work.w / img.w;
const counts = {}, sizes = {};
for (const s of stones) { counts[s.code] = (counts[s.code] || 0) + 1; sizes[s.physMm] = (sizes[s.physMm] || 0) + 1; }

// mockup kiểu _3: đá cỡ vật lý, màu catalog, trên ảnh làm việc (đã phóng); map px = 11.81 px/mm → scale = px ảnh làm việc / 3543
const scale = work.w / 3543, mp = 3543 / work.w;
const pal = { codes: Object.fromEntries(Object.keys(counts).map((c) => [c, { fill: cat.codes[c].fill, edge: cat.codes[c].edge, text: cat.codes[c].text, fontPx: cat.codes[c].fontPx }])) };
const layer = renderMap({ px: 3543, stones: stones.map((s) => ({ x: s.x * k * mp, y: s.y * k * mp, dMm: s.physMm, code: s.code })) }, pal, { style: 'clean', scale, marginMm: 0, closeMm: 0 });
const mock = over(work, layer);
const crop = (im, x, y, S) => { const out = new Uint8Array(S * S * 4); for (let v = 0; v < S; v++) for (let u = 0; u < S; u++) { const sx = Math.min(im.w - 1, Math.max(0, x - S / 2 + u)), sy = Math.min(im.h - 1, Math.max(0, y - S / 2 + v)); out.set(im.data.subarray((sy * im.w + sx) * 4, (sy * im.w + sx) * 4 + 4), (v * S + u) * 4); } return { w: S, h: S, data: out }; };
const row = (ims) => { const W = ims.reduce((a, m) => a + m.w + 8, -8), H = Math.max(...ims.map((m) => m.h)), out = new Uint8Array(W * H * 4).fill(255); let ox = 0; for (const m of ims) { for (let y = 0; y < m.h; y++) out.set(m.data.subarray(y * m.w * 4, (y + 1) * m.w * 4), (y * W + ox) * 4); ox += m.w + 8; } return { w: W, h: H, data: out }; };
const col = (ims) => { const W = Math.max(...ims.map((m) => m.w)), H = ims.reduce((a, m) => a + m.h + 8, -8), out = new Uint8Array(W * H * 4).fill(255); let oy = 0; for (const m of ims) { for (let y = 0; y < m.h; y++) out.set(m.data.subarray(y * m.w * 4, (y + 1) * m.w * 4), ((oy + y) * W) * 4); oy += m.h + 8; } return { w: W, h: H, data: out }; };
// chỗ zoom (px ảnh 1254): mắt phải corgi, mũi, tai trái
const spots = [[590, 400], [380, 500], [400, 250]].map(([x, y]) => [x * (img.w / 1254) * k, y * (img.w / 1254) * k]), S = Math.round(36 * work.w / 300); // ô 36 mm
const zoom = col(spots.map(([x, y]) => row([crop(work, Math.round(x), Math.round(y), S), crop(mock, Math.round(x), Math.round(y), S)])));
const files = { zoom: path.join(OUT, await io.write(path.join(OUT, 'queen_pet_zoom'), zoom.w, zoom.h, zoom.data)) };
const [bx0, by0, bx1, by1] = BBOX.map((v) => Math.round(v * (img.w / 1254) * k)), cw = bx1 - bx0, ch = by1 - by0;
const ov = row([crop(work, bx0 + cw / 2, by0 + ch / 2, Math.max(cw, ch)), crop(mock, bx0 + cw / 2, by0 + ch / 2, Math.max(cw, ch))].map((m) => m));
files.overview = path.join(OUT, await io.write(path.join(OUT, 'queen_pet_overview'), ov.w, ov.h, ov.data));
const report = { source: SRC, maskFrom, ms: Date.now() - t0, upscale: r.upscale, workPx: [work.w, work.h], stones: stones.length, detected: r.work.detected, sizesPhysMm: sizes,
  codes: Object.keys(counts).length, bom: Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([code, n]) => ({ code, n, physMm: cat.codes[code].physMm, hex: cat.codes[code].fill, name: cat.codes[code].name })), files };
fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 1) + '\n');
fs.writeFileSync(path.join(OUT, 'queen_pet_stones.json'), JSON.stringify(stones.map((s) => ({ x: +s.x.toFixed(2), y: +s.y.toFixed(2), physMm: s.physMm, code: s.code })), null, 0) + '\n');
console.log(`Queen mặt thú cưng: ${stones.length} viên ${JSON.stringify(sizes)}, ${report.codes} mã, phóng ${r.upscale?.method || 'không'} ${r.upscale ? (r.upscale.ms / 1000).toFixed(1) + 's' : ''}, tổng ${(report.ms / 1000).toFixed(1)}s`);
console.log('  BOM', report.bom.map((b) => `${b.code}×${b.n}`).join(' '));
console.log(Object.values(files).join('\n'));
