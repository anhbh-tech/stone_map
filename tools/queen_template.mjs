// KIT-16: mẫu trang phục Queen CỐ ĐỊNH, map 1 lần (0 gọi API): trang phục không đổi giữa các đơn → map kỹ 1 lần, captain duyệt,
// mỗi đơn (KIT-17) chỉ map ô mặt thú cưng rồi ghép với đá trang phục của mẫu.
//   node tools/queen_template.mjs [--rebuild-mask] [--rebuild-big] [--border chain|print|both]   (~1–2 phút)
// Nguồn: requirements/Trang phục Queen.png (Lanczos → 3543 px = 300 mm). Mẫu (commit, sửa tay được) trong kit/templates/:
//   queen_mask.png  3 vùng: đen = nền caro (không đá), trắng = trang phục (dán kín), đỏ = ô mặt thú cưng (đổi mỗi đơn)
//   queen_big.json  viên to / hình lạ đã duyệt [{ id, x_mm, y_mm, code, shape round|heart|marquise|teardrop, rot_deg, phys_mm, … }]
//                   sửa tay (mã / vị trí / góc / border / ring) rồi chạy lại lệnh trên; --rebuild-big làm lại từ DETECT + VLM có sẵn
//   queen_costume_<border>.svg  đá trang phục (pearl-kit-map/1), queen_template.json  mô tả + đường dẫn cho KIT-17
// Viên to lần đầu: DETECT tầng KIT-12a + VLM có sẵn (outputs/kit-vlm/tiers queen-big / queen-mid tầng 1–2, outputs/kit-vlm/objects/
// queen-stones.json có hình) → mapCostume KIT-14 (tim X, cánh marquise M xoay theo trục, viên tròn cỡ gần nhất). Phần còn lại:
// mapCostume Potts + lấp kín; viền hạt vàng li ti 2 biến thể: chain (chuỗi 2.8 bước 3.0 mm) / print (dải để in).
// Ra outputs/kit/queen_template/: overlay_big.svg + .png (đánh số viên to), <border>/{queen.svg, bom.csv, mockup_*, zoom_*}, report.json.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mapCostume, upscale, docFlip } from '../lib/kit/select.js';
import { loadCatalog, checkDesign, entryOf } from '../lib/kit/catalog.js';
import { normalizeDoc, writeKitSvg } from '../lib/kit/svgio.js';
import { renderMap, over } from '../lib/kit/render.js';
import { stonePoly } from '../lib/kit/shapes.js';
import { shrinkOnWhite, grid, crop } from '../lib/kit/build.js';
import { pixelIO } from '../lib/pixels.js';
import { encodePng, decodePng } from '../lib/png.js';
import { backgroundMask } from '../lib/kit/detect.js';
import { boxPx } from '../lib/kit/vlm.js';
import { stoneRecords, remapBig } from '../lib/kit/palette.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2), flag = (n) => { const i = args.indexOf(n); return i >= 0 ? args.splice(i, 2)[1] : null; };
const NAME = flag('--name') || 'queen', borderArg = flag('--border') || 'both', opt = { goldWL: 0, ...JSON.parse(flag('--opt') || '{}') }; // goldWL 0: vàng 2.8 = L16 cùng màu Z16 4 mm (WL 1 → L17 #B9A06D xỉn)
const REQ = process.env.KIT_REQ || path.join(process.cwd(), 'requirements');
const SRC = path.resolve(flag('--src') || path.join(REQ, 'Trang phục Queen.png'));
const VLM = path.join(ROOT, 'outputs', 'kit-vlm');
const TPL = path.join(ROOT, 'kit', 'templates'), OUT = path.join(ROOT, 'outputs', 'kit', `${NAME}_template`);
const F = { mask: path.join(TPL, `${NAME}_mask.png`), big: path.join(TPL, `${NAME}_big.json`), meta: path.join(TPL, `${NAME}_template.json`) };
const py = process.env.PEARL_VENV_PY || [path.join(ROOT, '.venv', 'bin', 'python'), path.join(process.cwd(), '.venv', 'bin', 'python')].find((f) => fs.existsSync(f)) || 'python3';
const io = pixelIO(py, path.join(ROOT, 'tools', 'pixels.py'));
fs.mkdirSync(TPL, { recursive: true }); fs.mkdirSync(OUT, { recursive: true });
const t0 = Date.now(), MM = 300;
const img0 = await io.read(SRC);
const img = img0.w !== 3543 ? upscale(img0, 3543, Math.round((3543 * img0.h) / img0.w)) : img0, W = img.w, H = img.h, ppm = W / MM, N = W * H;
// ảnh hiển thị (mockup / zoom / overlay): alpha phủ lên nền trắng (RGB dưới alpha 0 là rác)
const view = { w: W, h: H, data: Uint8Array.from(img.data) };
for (let j = 0; j < N; j++) { const a = view.data[j * 4 + 3] / 255; for (let c = 0; c < 3; c++) view.data[j * 4 + c] = Math.round(view.data[j * 4 + c] * a + 255 * (1 - a)); view.data[j * 4 + 3] = 255; }
const cat = loadCatalog();
const r1 = (v) => Math.round(v * 10) / 10;

// ── 1. mask 3 vùng. Ô mặt = phần NỀN trong elip giữa đáy vương miện và đáy cổ áo (trang phục không bị cắt; sửa tay PNG được)
const LBL = { bg: 0, costume: 1, face: 2 }, COL = [[0, 0, 0], [255, 255, 255], [255, 0, 0]];
let zone, face;
if (fs.existsSync(F.mask) && !args.includes('--rebuild-mask')) {
  const m = decodePng(fs.readFileSync(F.mask));
  if (m.w !== W || m.h !== H) throw new Error(`${F.mask} ${m.w}×${m.h} ≠ ${W}×${H}`);
  zone = new Uint8Array(N);
  for (let j = 0; j < N; j++) { const r = m.data[j * 4], g = m.data[j * 4 + 1]; zone[j] = r >= 128 && g < 128 ? 2 : r >= 128 ? 1 : 0; }
} else {
  const bg = backgroundMask(img).bg, f = 4, w = Math.ceil(W / f), h = Math.ceil(H / f), sm = new Uint8Array(w * h), lab = new Int32Array(w * h).fill(-1), comps = [];
  for (let y = 0; y < H; y += f) for (let x = 0; x < W; x += f) if (!bg[y * W + x]) sm[(y / f) * w + x / f] = 1;
  for (let s = 0; s < sm.length; s++) {
    if (!sm[s] || lab[s] >= 0) continue;
    const c = { id: comps.length, n: 0, x0: w, y0: h, x1: 0, y1: 0 }, q = [s];
    lab[s] = c.id;
    while (q.length) { const p = q.pop(), x = p % w, y = (p / w) | 0; c.n++; c.x0 = Math.min(c.x0, x); c.x1 = Math.max(c.x1, x); c.y0 = Math.min(c.y0, y); c.y1 = Math.max(c.y1, y);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const X = x + dx, Y = y + dy; if (X >= 0 && Y >= 0 && X < w && Y < h && sm[Y * w + X] && lab[Y * w + X] < 0) { lab[Y * w + X] = c.id; q.push(Y * w + X); } } }
    comps.push(c);
  }
  // vương miện = mảng to nhất nằm hẳn trong nửa trên; thân = mảng to nhất
  const body = [...comps].sort((a, b) => b.n - a.n)[0], crown = comps.filter((c) => c !== body && c.y1 < h * 0.45).sort((a, b) => b.n - a.n)[0];
  if (!crown) throw new Error('không thấy vương miện (mảng trang phục to ở nửa trên)');
  // đáy cổ áo: cột trong bề ngang vương miện, điểm thân cao nhất (y nhỏ nhất) dưới vương miện; đáy U = lớn nhất trong 40 % giữa
  const cx = (crown.x0 + crown.x1) / 2, cw = crown.x1 - crown.x0, top = [];
  for (let x = Math.round(cx - 0.2 * cw); x <= Math.round(cx + 0.2 * cw); x++) for (let y = crown.y1 + 1; y < h; y++) if (lab[y * w + x] === body.id) { top.push(y); break; }
  const neckY = Math.max(...top), yTop = crown.y1 - 0.15 * (crown.y1 - crown.y0), ry = (neckY - yTop) / 2 + 2, rx = 0.5 * cw, cy = (yTop + neckY) / 2;
  face = { cx: cx * f, cy: cy * f, rx: rx * f, ry: ry * f };
  zone = new Uint8Array(N);
  for (let y = 0, j = 0; y < H; y++) for (let x = 0; x < W; x++, j++) zone[j] = !bg[j] ? 1 : ((x - face.cx) / face.rx) ** 2 + ((y - face.cy) / face.ry) ** 2 <= 1 ? 2 : 0;
  const rgba = new Uint8Array(N * 4);
  for (let j = 0; j < N; j++) { const c = COL[zone[j]]; rgba[j * 4] = c[0]; rgba[j * 4 + 1] = c[1]; rgba[j * 4 + 2] = c[2]; rgba[j * 4 + 3] = 255; }
  fs.writeFileSync(F.mask, encodePng(W, H, rgba, { 'pearl-kit-template-mask': 'black=background red=pet-face white=costume' }, { rgb: true }));
}
const fgMask = Uint8Array.from(zone, (v) => (v === 1 ? 1 : 0));
const zoneN = [0, 0, 0];
let fb = [W, H, 0, 0];
for (let y = 0, j = 0; y < H; y++) for (let x = 0; x < W; x++, j++) { zoneN[zone[j]]++; if (zone[j] === 2) fb = [Math.min(fb[0], x), Math.min(fb[1], y), Math.max(fb[2], x), Math.max(fb[3], y)]; }
const faceBoxMm = zoneN[2] ? fb.map((v) => r1(v / ppm)) : null;

// ── 2. viên to: queen_big.json (đã duyệt) hoặc làm lại từ DETECT + VLM có sẵn
function vlmItems() {
  const items = [], seen = [], files = [];
  const push = (it, b, file) => { const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2, rr = Math.max(b.x1 - b.x0, b.y1 - b.y0) / 2;
    if (seen.some((q) => Math.hypot(cx - q[0], cy - q[1]) < 0.5 * Math.max(rr, q[2]))) return;
    seen.push([cx, cy, rr]); items.push({ ...it, bbox: [b.x0 / img0.w, b.y0 / img0.h, b.x1 / img0.w, b.y1 / img0.h], file }); };
  // hình lạ trước (KIT-12c 'stones': marquise / tim / giọt có hình) để thắng khi trùng tâm với box tầng
  const sf = path.join(VLM, 'objects', `${NAME}-stones.json`), so = fs.existsSync(sf) ? JSON.parse(fs.readFileSync(sf, 'utf8')) : null;
  const shaped = (so?.data?.stones || []).filter((s) => ['heart', 'marquise', 'teardrop'].includes(s.shape));
  for (const s of shaped) { const b = boxPx(s.box_2d, so.area); if (b) push({ material: s.material, color: s.color, shape: s.shape, tier: 1 }, b, path.basename(sf)); }
  if (so) files.push(sf);
  const dir = path.join(VLM, 'tiers'), all = fs.existsSync(dir) ? fs.readdirSync(dir) : [], pick = (re) => all.filter((f) => re.test(f)).sort((a, b) => a.length - b.length || a.localeCompare(b));
  const big = pick(new RegExp(`^${NAME}-big(@[^-]+)?\\.json$`))[0], mids = new Map();
  for (const f of pick(new RegExp(`^${NAME}-mid(@[^-]+)?-(\\d+)\\.json$`))) { const i = /-(\d+)\.json$/.exec(f)[1]; if (!mids.has(i)) mids.set(i, f); }
  for (const [tier, f] of [...(big ? [[1, big]] : []), ...[...mids.values()].map((f) => [2, f])]) {
    const o = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    files.push(path.join(dir, f));
    for (const st of o.data?.stones || []) { const b = boxPx(st.box_2d, o.area); if (b) push({ material: st.material, color: st.color, vlmMm: st.diameter_mm, tier }, b, f); }
  }
  return { items, files, shaped: shaped.length };
}
let big, bigFrom;
if (fs.existsSync(F.big) && !args.includes('--rebuild-big')) { big = JSON.parse(fs.readFileSync(F.big, 'utf8')); bigFrom = F.big; }
else {
  const v = vlmItems();
  if (!v.items.length) throw new Error(`không có kết quả VLM trong ${VLM} (tiers/${NAME}-big*.json, objects/${NAME}-stones.json); KIT-16 không gọi API mới`);
  const r = mapCostume(img, { canvasMm: MM, cat, fgMask, bigObjects: v.items, ...opt }); // đủ lấp: mã viên to tầng 2 chọn chung ngân sách với hạt 2.8 (lần chạy mẫu ép đúng các mã này)
  // tâm = chỗ viên thật được đặt (sau xê dịch), không phải tâm vật
  const at = new Map(r.placed.filter((p) => p.from === 'big').map((p) => [p.bigId, p])), objId = new Map(r.objects.map((b, i) => [i, b.id]));
  // vật tầng 2 bị thu về 2.8 (ngân sách mã) không còn là viên to: bỏ, để DETECT / lấp lo
  const list = r.big.list.map((b, i) => ({ ...b, ...(at.get(objId.get(i)) && { x: at.get(objId.get(i)).x, y: at.get(objId.get(i)).y }) }))
    .filter((b) => b.code && (b.shape || entryOf(b.code, cat).kind === 'pearl' || entryOf(b.code, cat).physMm >= 4)).sort((a, b) => a.y - b.y || a.x - b.x);
  big = { schema: 'pearl-kit-template-big/1', source: path.basename(SRC), canvasMm: MM, note: 'tâm mm từ góc trên-trái; keep_mm = hình vẽ trên ảnh (w × h theo trục viên, đo viền vàng quanh đó; phần vẽ thừa quanh viên được lấp 2.8); border/ring: true|false ép, bỏ trống = tự đo',
    from: { vlm: v.files.map((f) => path.relative(ROOT, f)), detect: 'KIT-12a bigObjects', apiCalls: 0 },
    stones: list.map((b, i) => { const e = entryOf(b.code, cat), sh = b.shape || 'round';
      // tròn: hình vẽ = elip DETECT (trục ngắn × dài, góc theo trục dài), không lớn hơn box VLM
      const ax = [Math.min(b.axesMm[1], b.boxMm), Math.min(b.axesMm[0], 1.2 * b.boxMm)].map((v) => r1(Math.max(e.physMm, v))), ell = sh === 'round' && ax[1] / ax[0] >= 1.15;
      return { id: i + 1, x_mm: r1(b.x / ppm), y_mm: r1(b.y / ppm), code: b.code, shape: sh, rot_deg: sh !== 'round' ? b.rotDeg : ell ? Math.round(b.thDeg - 90) : 0, phys_mm: e.physMm,
        ...(e.shape && { w_mm: e.physW, h_mm: e.physH }), keep_mm: sh === 'round' ? (ell ? ax : [ax[0], ax[0]]) : b.drawnMm.map(r1),
        name: e.name, hex: e.fill, mat: b.mat, src: b.src, tier: b.vlm?.tier, vlm: b.vlm ? `${b.vlm.material}/${b.vlm.color}` : undefined }; }) };
  fs.writeFileSync(F.big, JSON.stringify(big, null, 1) + '\n');
  bigFrom = `rebuilt (${v.items.length} VLM items, ${v.shaped} shaped; DETECT ${r.big.objects} objects)`;
}
for (const s of big.stones) { const e = entryOf(s.code, cat); if (!e) throw new Error(`${F.big} #${s.id}: mã ${s.code} không có trong catalog`); if ((e.shape || 'round') !== s.shape) throw new Error(`#${s.id}: ${s.code} là ${e.shape || 'round'}, không phải ${s.shape}`); }
// KIT-18 bảng mã chung sản phẩm (tools/product_palette.mjs): mã chỉ trong pool; viên to đổi về mã pool (remapBig), không lớp → bỏ (lấp lưới)
const palArg = flag('--palette'), palFile = palArg === 'none' ? null : path.resolve(palArg || path.join(TPL, 'product_queen_starry_palette.json'));
const palette = palFile && fs.existsSync(palFile) ? JSON.parse(fs.readFileSync(palFile, 'utf8')) : null, codePool = palette?.codes || null;
const remap = codePool ? remapBig(big.stones, codePool, cat) : big.stones.map((s) => ({ id: s.id, from: s.code, to: s.code }));
const bigFixed = big.stones.map((s, i) => ({ id: s.id, x: s.x_mm * ppm, y: s.y_mm * ppm, code: remap[i].to, rotDeg: s.rot_deg || 0, keepMm: s.keep_mm, border: s.border, ring: s.ring })).filter((b) => b.code);
// --collect <file>: chỉ chạy biến thể chain, ghi viên (lớp + màu mục tiêu, trước chọn mã) cho tools/product_palette.mjs rồi thoát
const collect = flag('--collect');
if (collect) {
  let recs = null;
  const r = mapCostume(img, { canvasMm: MM, cat, fgMask, bigFixed, border: 'chain', ...(codePool && { codePool }), ...opt, onStones: (pl) => { recs = stoneRecords(pl, cat, { layer: NAME, gwl: opt.goldWL ?? 1 }); } });
  fs.writeFileSync(collect, JSON.stringify({ layer: NAME, codes: r.doc.palette.map((p) => p.code), codeCost: r.codeCost, coverage: r.coverage, stones: r.placed.length, records: recs }));
  console.log(`collect ${NAME}: ${recs.length} viên, ${r.doc.palette.length} mã → ${collect}`);
  process.exit(0);
}

// ── overlay đánh số viên to (SVG trên ảnh, mở được trong trình duyệt; PNG ½ cỡ)
const inputFile = await io.write(path.join(OUT, 'input_upscaled'), W, H, view.data);
const geomOf = (s) => { const e = entryOf(s.code, cat); return { x: s.x_mm * ppm, y: s.y_mm * ppm, shape: e.shape || 'round', rot: s.rot_deg || 0, w: e.physW ?? e.physMm, h: e.physH ?? e.physMm }; };
const ptsOf = (P) => P.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
const ov = [`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`, `<image xlink:href="${inputFile}" width="${W}" height="${H}" opacity="0.55"/>`];
for (const s of big.stones) {
  const g = geomOf(s), [kw, kh] = s.keep_mm || [g.w, g.h];
  ov.push(`<polygon points="${ptsOf(stonePoly({ ...g, shape: g.shape }, ppm, kw, kh))}" fill="none" stroke="#00b7ff" stroke-width="3" stroke-dasharray="8 6"/>`);
  ov.push(`<polygon points="${ptsOf(stonePoly(g, ppm, g.w, g.h))}" fill="${entryOf(s.code, cat).fill}" fill-opacity="0.8" stroke="#000" stroke-width="3"/>`);
  const fs_ = Math.max(26, Math.min(48, 2.2 * g.h * ppm / 3)), lx = g.x + (Math.max(kw, kh) / 2 + 1) * ppm;
  ov.push(`<text x="${lx.toFixed(0)}" y="${(g.y + fs_ / 3).toFixed(0)}" font-family="Helvetica,Arial,sans-serif" font-weight="700" font-size="${fs_.toFixed(0)}" fill="#fff" stroke="#000" stroke-width="6" paint-order="stroke">${s.id}</text>`);
}
ov.push('</svg>');
const files = { mask: F.mask, big: F.big, overlaySvg: path.join(OUT, 'overlay_big.svg'), overlayPng: path.join(OUT, 'overlay_big.png') };
fs.writeFileSync(files.overlaySvg, ov.join('\n') + '\n');
execFileSync('rsvg-convert', ['-w', String(Math.round(W / 2)), '-o', files.overlayPng, files.overlaySvg], { cwd: OUT });

// ── 3. phần còn lại: mapCostume Potts + lấp kín, viền vàng li ti theo biến thể
const variants = borderArg === 'both' ? ['chain', 'print'] : [borderArg];
const report = { source: SRC, upscaled: [img0.w, W], mask: { file: F.mask, legend: 'black=background red=pet-face white=costume', areaMm2: { background: Math.round(zoneN[0] / ppm ** 2), costume: Math.round(zoneN[1] / ppm ** 2), face: Math.round(zoneN[2] / ppm ** 2) }, faceBoxMm, ...(face && { faceEllipseMm: Object.fromEntries(Object.entries(face).map(([k, v]) => [k, r1(v / ppm)])) }) },
  big: { file: F.big, from: bigFrom, n: big.stones.length, byShape: {}, byCode: {} }, variants: {}, apiCalls: 0 };
if (codePool) report.palette = { file: path.relative(ROOT, palFile), codes: codePool, remapped: remap.filter((m) => m.to !== m.from) };
for (const s of big.stones) { report.big.byShape[s.shape] = (report.big.byShape[s.shape] || 0) + 1; report.big.byCode[s.code] = (report.big.byCode[s.code] || 0) + 1; }
const meta = { schema: 'pearl-kit-template/1', name: NAME, source: path.basename(SRC), canvasMm: MM, widthPx: W, heightPx: H, pxPerMm: +ppm.toFixed(4),
  mask: { file: path.basename(F.mask), legend: { background: '#000000', costume: '#FFFFFF', petFace: '#FF0000' }, petFaceBoxMm: faceBoxMm },
  big: path.basename(F.big), costume: {}, rebuild: 'node tools/queen_template.mjs' };
const pmZoom = [];
for (const v of variants) {
  const r = mapCostume(img, { canvasMm: MM, cat, fgMask, bigFixed, border: v, ...(codePool && { codePool }), ...opt }), dir = path.join(OUT, v);
  fs.mkdirSync(dir, { recursive: true });
  const doc = normalizeDoc({ ...r.doc, source: { name: `${path.basename(SRC)} (upscale ${img0.w}→${W})`, widthPx: W, heightPx: H }, createdAt: new Date().toISOString(),
    template: { name: NAME, border: v, mask: path.basename(F.mask), big: path.basename(F.big) },
    stats: { stones: r.doc.stones.length, coveragePct: Math.round(r.coverage * 1000) / 10, codes: r.doc.palette.length } });
  const check = checkDesign(doc, cat), svg = writeKitSvg(doc), tplSvg = path.join(TPL, `${NAME}_costume_${v}.svg`);
  fs.writeFileSync(path.join(dir, `${NAME}.svg`), svg); fs.writeFileSync(tplSvg, svg);
  meta.costume[v] = { svg: path.basename(tplSvg), stones: doc.stones.length, codes: doc.palette.length };
  const bom = doc.bom.map((b) => { const e = entryOf(b.code, cat); return { symbol: b.symbol, code: b.code, kind: e.kind, shape: e.shape || 'round', physMm: e.shape ? `${e.physW}x${e.physH}` : e.physMm, refMm: e.shape ? `${e.refW}x${e.refH}` : e.refMm, hex: e.fill, family: e.family, name: e.name, count: b.count }; });
  fs.writeFileSync(path.join(dir, 'bom.csv'), ['symbol,code,kind,shape,physical_mm,reference_mm,hex,family,name,count', ...bom.map((b) => [b.symbol, b.code, b.kind, b.shape, b.physMm, b.refMm, b.hex, b.family, `"${String(b.name || '').replace(/"/g, '""')}"`, b.count].join(','))].join('\n') + '\n');
  // mockup sạch = cỡ vật lý (viên hình: w × h vật lý), ký hiệu = cỡ reference
  const pal = { codes: Object.fromEntries(doc.palette.map((p) => [p.code, { fill: p.rgb, edge: p.edge, text: p.text, fontPx: p.fontPx, symbol: p.symbol }])) }, disc = { marginMm: 0, closeMm: 0 };
  const phys = doc.stones.map((s) => { const e = entryOf(s.code, cat); return e.shape ? { ...s, wMm: e.physW, hMm: e.physH, dMm: e.physMm } : { ...s, dMm: e.physMm }; });
  const mClean = over(view, renderMap({ px: W, stones: phys }, pal, { style: 'clean', ...disc })), mSym = over(view, renderMap({ px: W, stones: doc.stones }, pal, { style: 'symbols', ...disc }));
  const out = { svg: path.join(dir, `${NAME}.svg`), bom: path.join(dir, 'bom.csv') };
  for (const [n, im] of [['mockup_clean', mClean], ['mockup_symbols', mSym]]) out[n] = path.join(dir, await io.write(path.join(dir, n), im.w, im.h, im.data));
  const ovw = grid([view, mClean, mSym].map((im) => shrinkOnWhite(im, 4)), 3);
  out.overview = path.join(dir, await io.write(path.join(dir, 'overview'), ovw.w, ovw.h, ovw.data));
  // zoom: tim, cánh marquise, viền vàng (viên có viền, không phải tim), cổ ngọc trai (ngọc dày nhất ngay dưới ô mặt)
  const S = big.stones.map((s) => ({ ...s, g: geomOf(s) })), heart = S.filter((s) => s.shape === 'heart').sort((a, b) => b.g.h - a.g.h)[0];
  const marq = S.filter((s) => s.shape === 'marquise').sort((a, b) => b.g.h - a.g.h)[0];
  const bd = r.borders.map((b) => S.find((s) => s.id === b.fid)).filter((s) => s && s !== heart && s.shape === 'round').sort((a, b) => b.g.w - a.g.w)[0] || (r.borders[0] && S.find((s) => s.id === r.borders[0].fid));
  // cổ ngọc trai: ô 25 mm (bước 5 mm) nhiều ngọc trai nhất, tâm dưới đáy ô mặt
  let pc = null, best = 0;
  const pearls = r.placed.filter((s) => s.mat === 'pearl');
  for (let y = 12.5; y < MM - 12.5; y += 5) for (let x = 12.5; x < MM - 12.5; x += 5) {
    if (faceBoxMm && y < faceBoxMm[3]) continue;
    const n = pearls.filter((s) => Math.abs(s.x / ppm - x) < 12.5 && Math.abs(s.y / ppm - y) < 12.5).length;
    if (n > best) { best = n; pc = [x * ppm, y * ppm]; }
  }
  const hearts = S.filter((s) => s.shape === 'heart' && s !== heart);
  const Z = [['heart', heart && [heart.g.x, heart.g.y, 34]], ...hearts.map((h, i) => [`heart_${i + 2}`, [h.g.x, h.g.y, 34]]), ['marquise', marq && [marq.g.x, marq.g.y, 30]], ['border', bd && [bd.g.x, bd.g.y, 26]], ['pearl_collar', pc && [pc[0], pc[1], 30]]];
  for (const [name, z] of Z) {
    if (!z) continue;
    const [zx, zy, mm] = z, s = Math.min(W, H, Math.round(mm * ppm)), x0 = Math.max(0, Math.min(W - s, Math.round(zx - s / 2))), y0 = Math.max(0, Math.min(H - s, Math.round(zy - s / 2)));
    const parts = [view, mClean, mSym].map((im) => crop(im, x0, y0, s, s)), k = 2, ZW = 3 * s * k + 16, ZH = s * k, buf = new Uint8Array(ZW * ZH * 4).fill(255);
    parts.forEach((pt, q) => { for (let y = 0; y < ZH; y++) for (let x = 0; x < s * k; x++) { const sj = (Math.floor(y / k) * s + Math.floor(x / k)) * 4, dj = (y * ZW + q * (s * k + 8) + x) * 4; for (let c = 0; c < 3; c++) buf[dj + c] = pt.data[sj + c]; } });
    out[`zoom_${name}`] = path.join(dir, await io.write(path.join(dir, `zoom_${name}`), ZW, ZH, buf));
    if (v === variants[0]) pmZoom.push(name);
  }
  const sizes = {};
  for (const s of doc.stones) { const e = entryOf(s.code, cat), k = e.shape ? `${e.shape} ${e.physW}x${e.physH}` : e.physMm; sizes[k] = (sizes[k] || 0) + 1; }
  const flip = docFlip(doc.stones, cat, img, ppm);
  const bigPlaced = bigFixed.map((s) => { const t = r.placed.find((p) => p.from === 'big' && objOfFid(r, p.bigId) === s.id); return { id: s.id, code: t?.code, ok: t?.code === s.code, overlap: r.objects.find((b) => b.fid === s.id)?.flags.includes('overlap') || false }; });
  report.variants[v] = { check: check.ok ? 'ok' : check.errors.slice(0, 10), stones: doc.stones.length, codes: doc.palette.length, sizes, coveragePct: +(100 * r.coverage).toFixed(1), coverageOutsideKeepOutPct: +(100 * r.coverageNoGems).toFixed(1),
    flipDocPct: { all: +(100 * flip.all).toFixed(1), similar: +(100 * flip.similar).toFixed(1) }, flip: r.flip, from: r.from, materials: r.materials, dropped: r.dropped, lostNoCode: r.lost,
    big: { n: big.stones.length, inPalette: bigFixed.length, placedAsListed: bigPlaced.filter((b) => b.ok).length, overlap: bigPlaced.filter((b) => b.overlap).map((b) => b.id) },
    borders: r.borders, rings: r.rings, palette: doc.palette.map((p) => ({ symbol: p.symbol, code: p.code })), files: out };
}
function objOfFid(r, bigId) { return r.objects.find((b) => b.id === bigId)?.fid; }
fs.writeFileSync(F.meta, JSON.stringify(meta, null, 1) + '\n');
report.files = { ...files, template: F.meta, input: path.join(OUT, inputFile) };
report.ms = Date.now() - t0;
fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 1) + '\n');
console.log(`mask: costume ${report.mask.areaMm2.costume} mm², face ${report.mask.areaMm2.face} mm² box ${JSON.stringify(faceBoxMm)} · big ${big.stones.length} (${bigFrom}) ${JSON.stringify(report.big.byShape)}`);
for (const [v, x] of Object.entries(report.variants)) console.log(`${v}: ${x.stones} stones, ${x.codes} codes, coverage ${x.coveragePct}% (${x.coverageOutsideKeepOutPct}% outside keep-out), flip ${x.flipDocPct.all}% / similar ${x.flipDocPct.similar}%, big ${x.big.placedAsListed}/${x.big.inPalette} (of ${x.big.n} listed) overlap ${x.big.overlap.length}, borders ${x.borders.length} (${x.borders.reduce((a, b) => a + b.n, 0)} stones), check ${x.check === 'ok' ? 'ok' : JSON.stringify(x.check)}`);
console.log(`${OUT} · ${((Date.now() - t0) / 1000).toFixed(0)} s · 0 API calls`);
