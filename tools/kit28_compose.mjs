// KIT-28: ghép đủ 3 layer sản phẩm Queen — nền Starry + trang phục Queen (KIT-27) + pet — cho 1 ảnh pet × 1 phương án bảng mã, 0 API.
//   node tools/kit28_compose.mjs --pet <tên> --src <ảnh pet> --face x0,y0,x1,y1 [--opt P13|P14] [--costume <dir kit20>] [--upscale lanczos]
// Layer lấy từ MẪU, không đọc ngược từ ảnh phẳng: kit/templates/queen_mask.png (đen = nền, trắng = trang phục, đỏ = ô mặt).
//   nền       = kit/templates/starry_background.svg (KIT-18, phủ cả 300 mm) → giữ viên tâm trong vùng đen, mã lại theo bảng chung
//               (bản ghi màu outputs/kit/product_palette/collect_starry.json, stoneCost như kit20), rồi bỏ viên sát trang phục / pet (< 0.15 mm)
//   trang phục = <costume>/queen.svg của tools/kit20.mjs (P13 = KIT-27 13 mã; P14 = cùng chạy với --force-codes 13 mã + Q114 đỏ 8 mm),
//               khoá, ưu tiên cao nhất
//   pet       = như tools/pet_kit19.mjs: hộp mặt (--face, px ảnh vào) co vừa ô đỏ, petMap (KIT-17) trong ô đỏ, ép bảng chung + tối đa
//               (15 − số mã bảng) mã mới (P13 → 2, P14 → 1), keepOut 0.15 mm với trang phục (viên to sát → 2.8 mm, vẫn sát → bỏ)
// Ra outputs/kit/kit28/<pet>_<opt>/: map.svg (stonemap-svg/1, 3 layer), map.kit.svg (pearl-kit-map/1), review.svg (ký hiệu trên ảnh ghép),
//   mockup.png (viên cỡ vật lý trên ảnh ghép, 1772 px), face.png (zoom ô mặt: ảnh | viên), bom.json, qc.json, report.json.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { decodePng, encodePng } from '../lib/png.js';
import { petMap, codeModel, lab as labP, keepOut } from '../lib/kit/pet.js';
import { upscale4, lanczos } from '../lib/kit/upscale.js';
import { loadCatalog as kitCatalog, entryOf } from '../lib/kit/catalog.js';
import { lab } from '../lib/kit/select.js';
import { stoneCost } from '../lib/kit/palette.js';
import { readKitSvg, writeKitSvg } from '../lib/kit/svgio.js';
import { renderMap, over } from '../lib/kit/render.js';
import { loadCatalog, assignSymbols, refOf } from '../lib/stonemap/catalog.js';
import { newDesign, validate, counts } from '../lib/stonemap/design.js';
import { writeSvg } from '../lib/stonemap/svg.js';
import { edgeGap } from '../lib/stonemap/geom.js';
import { runQc } from '../lib/stonemap/qc/index.js';
import { pixelIO } from '../lib/pixels.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2), flag = (n, d = null) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const REQ = process.env.KIT_REQ || path.join(os.homedir(), 'pearl_compare', 'requirements'), TPL = path.join(ROOT, 'kit', 'templates');
const PET = flag('--pet', 'corgi'), SRC = flag('--src', path.join(REQ, 'Mẫu Queen.png')), OPT = flag('--opt', 'P13'), upForce = flag('--upscale');
const COST = path.resolve(ROOT, flag('--costume', `outputs/kit/kit28/costume_${OPT}`)), OUT = path.join(ROOT, 'outputs', 'kit', 'kit28', `${PET}_${OPT}${flag('--tag', '')}`);
// --big-max-de N: viên pet ≥ 5 mm mà mã ép lệch màu ẢNH > N ΔE76 (mũi đen → Q114 đỏ 8 mm khi bảng có đỏ to) → mã nhỏ hơn rẻ nhất trong bảng (ΔE + 2/mm)
const bigMaxDE = flag('--big-max-de') ? +flag('--big-max-de') : null;
const MM = 300, MAP = 3543, GAP = 0.15, HARD_MAX = 15, KPX = MAP / MM;
const py = process.env.PEARL_VENV_PY || [path.join(ROOT, '.venv', 'bin', 'python'), path.join(os.homedir(), 'pearl_compare', '.venv', 'bin', 'python')].find((f) => fs.existsSync(f)) || 'python3';
const io = pixelIO(py, path.join(ROOT, 'tools', 'pixels.py'));
const r2 = (v) => Math.round(v * 100) / 100, r4 = (v) => Math.round(v * 1e4) / 1e4, hex2 = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const tally = (a, f) => a.reduce((m, x) => { const k = f(x); m[k] = (m[k] || 0) + 1; return m; }, {});
fs.mkdirSync(OUT, { recursive: true });
const t0 = Date.now();

// ── bảng mã chung (trang phục ∪ nền) = palette của lần chạy kit20; pet được thêm ≤ 15 − |bảng|
const costRep = JSON.parse(fs.readFileSync(path.join(COST, 'report.json'), 'utf8')), codes = costRep.palette.codes.map(String), maxNew = Math.max(0, HARD_MAX - codes.length);
const kcat = kitCatalog(), scat = loadCatalog();

// ── mask 3543 px: lớp theo màu
const qm = decodePng(fs.readFileSync(path.join(TPL, 'queen_mask.png')));
const cls = (x, y) => { const xi = Math.min(qm.w - 1, Math.max(0, Math.round(x))), yi = Math.min(qm.h - 1, Math.max(0, Math.round(y))), j = (yi * qm.w + xi) * 4, [r, g, b] = [qm.data[j], qm.data[j + 1], qm.data[j + 2]];
  return r >= 128 && g < 128 && b < 128 ? 'face' : r >= 128 && g >= 128 && b >= 128 ? 'costume' : 'bg'; };

// ── trang phục KIT-27 (khoá)
const cDoc = readKitSvg(fs.readFileSync(path.join(COST, 'queen.svg'), 'utf8'));
const costume = cDoc.stones.map((s) => { const e = scat.codes[s.code];
  return { id: `C:${s.id}`, code: s.code, shape: e.shape, x_mm: s.x / KPX, y_mm: s.y / KPX, phys_mm: e.physMm, ref_mm: e.refMm, rot_deg: s.rot || 0, kit: s }; });
const costumeWhere = tally(costume, (s) => cls(s.x_mm * KPX, s.y_mm * KPX));

// ── ảnh làm việc W = 5016 px (= Trang phục Queen.png ×4 như KIT-19): đen ← BG.png, trắng ← trang phục, đỏ ← mặt pet
const W = 1254 * 4, H = W, mask = new Uint8Array(W * H), at = (x, y) => cls(((x + 0.5) * MAP) / W - 0.5, ((y + 0.5) * MAP) / H - 0.5);
let maskN = 0, bx0 = W, by0 = H, bx1 = 0, by1 = 0;
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (at(x, y) === 'face') { mask[y * W + x] = 1; maskN++; bx0 = Math.min(bx0, x); bx1 = Math.max(bx1, x); by0 = Math.min(by0, y); by1 = Math.max(by1, y); }
const img = decodePng(fs.readFileSync(SRC));
// ảnh nhỏ (1254 px, như Mẫu Queen.png) → phóng ×4 (KIT-17); ảnh cut v3 (≥ 2000 px) đã đủ px (hộp mặt ~900 px → ô ~1400 px) → lấy mẫu thẳng
const up = img.w < 2000 ? await upscale4(img, { force: upForce === 'lanczos' ? 'lanczos' : undefined }) : { img, method: 'none', ms: 0 }, k = up.img.w / img.w;
const FACE = (flag('--face') || '348,306,850,697').split(',').map(Number), fs4 = FACE.map((v) => v * k);
const scl = Math.min((bx1 - bx0) / (fs4[2] - fs4[0]), (by1 - by0) / (fs4[3] - fs4[1])), cs = [(fs4[0] + fs4[2]) / 2, (fs4[1] + fs4[3]) / 2], ct = [(bx0 + bx1) / 2, (by0 + by1) / 2];
const costumeImg = lanczos(decodePng(fs.readFileSync(path.join(REQ, 'Trang phục Queen.png'))), W / 1254), bgImg = lanczos(decodePng(fs.readFileSync(path.join(REQ, 'BG.png'))), W / 1254);
const work = { w: W, h: H, data: new Uint8Array(W * H * 4) }, UW = up.img.w, UH = up.img.h;
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const j = (y * W + x) * 4;
  if (!mask[y * W + x]) { work.data.set((at(x, y) === 'bg' ? bgImg : costumeImg).data.subarray(j, j + 4), j); work.data[j + 3] = 255; continue; }
  const u = cs[0] + (x - ct[0]) / scl, v = cs[1] + (y - ct[1]) / scl, x0 = Math.floor(u), y0 = Math.floor(v), a = u - x0, b = v - y0;
  for (let c = 0; c < 3; c++) { const g = (xx, yy) => up.img.data[(Math.min(UH - 1, Math.max(0, yy)) * UW + Math.min(UW - 1, Math.max(0, xx))) * 4 + c];
    work.data[j + c] = Math.round((1 - a) * (1 - b) * g(x0, y0) + a * (1 - b) * g(x0 + 1, y0) + (1 - a) * b * g(x0, y0 + 1) + a * b * g(x0 + 1, y0 + 1)); }
  work.data[j + 3] = 255;
}

// ── pet: petMap trong ô đỏ, ép bảng chung + maxNew; ΔE76 tự do / ép +maxNew / ép +0 (fitPalette)
const bom = Object.values(kcat.codes).filter((e) => e.kind === 'stone').map((e) => ({ code: e.code, physMm: e.physMm, lab: labP(hex2(e.fill)) }));
const model = codeModel(['snowman', 'dachshund']), base = { canvasWmm: MM, mask, model, bom, noOverlap: true, minGapMm: -0.05 };
const forced = petMap(work, { ...base, palette: { codes, maxNew } }), forced0 = petMap(work, { ...base, palette: { codes, maxNew: 0 } });
const byCode = new Map(bom.map((b) => [b.code, b])), kept = new Set([...forced.work.palette.base, ...forced.work.palette.added]);
const L28 = bom.filter((b) => b.physMm === 2.8 && kept.has(b.code)), de = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const shrink = (s) => { const L = byCode.get(s.code).lab, c = L28.reduce((a, b) => (de(L, b.lab) < de(L, a.lab) ? b : a)); return { ...s, code: c.code, phys_mm: 2.8, ref_mm: refOf(2.8, scat), shrunkFrom: s.code }; };
const mmPerPx = MM / W, guard = [];
if (bigMaxDE) for (const s of forced.stones) {
  if (s.physMm < 5 || de(s.lab, byCode.get(s.code).lab) <= bigMaxDE) continue;
  // trong ngưỡng: rẻ nhất (ΔE + 2/mm); không mã nào trong ngưỡng (bảng không có đen) → 2.8 mm gần màu nhất (vết nhỏ nhất trên nền in)
  const cand = bom.filter((b) => kept.has(b.code) && b.physMm < s.physMm), ok = cand.filter((b) => de(s.lab, b.lab) <= bigMaxDE);
  const c = ok.length ? ok.reduce((a, b) => (de(s.lab, b.lab) + 2 * (s.physMm - b.physMm) < de(s.lab, a.lab) + 2 * (s.physMm - a.physMm) ? b : a))
    : cand.filter((b) => b.physMm === 2.8).reduce((a, b) => (de(s.lab, b.lab) < de(s.lab, a.lab) ? b : a));
  guard.push({ from: `${s.code}/${s.physMm}`, to: `${c.code}/${c.physMm}`, dE: [r2(de(s.lab, byCode.get(s.code).lab)), r2(de(s.lab, c.lab))] });
  s.free ??= s.code; s.code = c.code; s.physMm = c.physMm;
}
const petMm = forced.stones.map((s) => ({ x_mm: s.x * mmPerPx, y_mm: s.y * mmPerPx, code: s.code, free: s.free, shape: 'round', phys_mm: s.physMm, ref_mm: refOf(s.physMm, scat), rot_deg: 0 }));
const koPet = keepOut(petMm, costume, { gapMm: GAP, cat: scat, shrink });
const pet = koPet.stones;

// ── nền Starry: tâm trong vùng đen, mã lại theo bảng chung, bỏ viên sát trang phục / pet
const sDoc = readKitSvg(fs.readFileSync(path.join(TPL, 'starry_background.svg'), 'utf8'));
const recS = JSON.parse(fs.readFileSync(path.join(ROOT, 'outputs', 'kit', 'product_palette', 'collect_starry.json'), 'utf8')).records;
if (recS.length !== sDoc.stones.length) throw new Error(`collect_starry.json ${recS.length} bản ghi ≠ starry_background.svg ${sDoc.stones.length} viên`);
const NOCROSS = { crossPenalty: 1e4, shapeToRound: 60, shapeWhitePenalty: 1e4 };
const cheapest = (r, list) => list.reduce((a, c) => { const e = entryOf(c, kcat); if (!e) return a; const [v, , d] = stoneCost(r, e, lab(hex2(e.fill)), NOCROSS); return v < a.v ? { v, d, c } : a; }, { v: Infinity, d: 0, c: null });
// thứ tự bản ghi = thứ tự viên svg? kiểm: mã rẻ nhất trong bảng riêng của Starry = mã svg
const own = sDoc.palette.map((p) => p.code), agree = recS.filter((r, i) => cheapest(r, own).c === sDoc.stones[i].code).length;
const sRe = sDoc.stones.map((s, i) => { const b = cheapest(recS[i], codes); return { s, code: b.c, d: b.d }; });
const sWhere = tally(sRe, (x) => cls(x.s.x, x.s.y)), sBg = sRe.filter((x) => cls(x.s.x, x.s.y) === 'bg' && x.code);
const sMm = sBg.map((x, i) => ({ id: `S${i}`, code: x.code, shape: 'round', x_mm: x.s.x / KPX, y_mm: x.s.y / KPX, phys_mm: entryOf(x.code, kcat).physMm, ref_mm: refOf(entryOf(x.code, kcat).physMm, scat), rot_deg: 0, d: x.d }));
const koS = keepOut(sMm, [...costume, ...pet], { gapMm: GAP, cat: scat });
const starry = koS.stones, starryDE = r2(sRe.reduce((a, x) => a + x.d, 0) / sRe.length);

// ── khe nhỏ nhất pet ↔ trang phục / nền (cặp gần)
const minGapOf = (A, B) => { let m = Infinity, n = 0; const cell = 12, grid = new Map(), key = (x, y) => `${Math.floor(x / cell)},${Math.floor(y / cell)}`;
  for (const o of B) { const kk = key(o.x_mm, o.y_mm); (grid.get(kk) || grid.set(kk, []).get(kk)).push(o); }
  for (const s of A) { const gx = Math.floor(s.x_mm / cell), gy = Math.floor(s.y_mm / cell);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) for (const o of grid.get(`${gx + dx},${gy + dy}`) || [])
      if (Math.hypot(o.x_mm - s.x_mm, o.y_mm - s.y_mm) < (o.phys_mm + s.phys_mm) / 2 + 1) { const g = edgeGap(s, o, scat); m = Math.min(m, g); if (g < GAP - 1e-9) n++; } }
  return { minGapMm: Number.isFinite(m) ? r4(m) : null, pairsBelowGap: n }; };

// ── pet tràn ô mặt: tâm ngoài ô đỏ; đĩa vật lý chạm ngoài ô (16 điểm trên vành) + độ tràn lớn nhất (mm)
const ring = (s, r) => Array.from({ length: 16 }, (_, q) => [s.x_mm + r * Math.cos((q * Math.PI) / 8), s.y_mm + r * Math.sin((q * Math.PI) / 8)]);
let petCentreOut = 0, petDiscOut = 0, overflowMax = 0;
for (const s of pet) {
  if (cls(s.x_mm * KPX, s.y_mm * KPX) !== 'face') petCentreOut++;
  const outAt = (r) => ring(s, r).some(([x, y]) => cls(x * KPX, y * KPX) !== 'face');
  if (outAt(s.phys_mm / 2)) { petDiscOut++; let lo = 0, hi = s.phys_mm / 2; for (let it = 0; it < 12; it++) { const m = (lo + hi) / 2; if (outAt(m)) hi = m; else lo = m; } overflowMax = Math.max(overflowMax, s.phys_mm / 2 - lo); }
}

// ── stonemap-design/1: 3 layer; ký hiệu giữ chữ trang phục
const d = newDesign({ id: `kit28:${PET}:${OPT}`, w_mm: MM, h_mm: MM, catalogVersion: scat.version, layers: ['bg', 'costume', 'pet'] });
d.layers[0].stones = starry.map((s, i) => ({ id: `BG${String(i + 1).padStart(5, '0')}`, layer: 'bg', code: s.code, shape: 'round', x_mm: r4(s.x_mm), y_mm: r4(s.y_mm), phys_mm: s.phys_mm, ref_mm: s.ref_mm, rot_deg: 0, locked: true, source: 'starry_background.svg' }));
d.layers[1].stones = costume.map((s, i) => ({ id: `CO${String(i + 1).padStart(5, '0')}`, layer: 'costume', code: s.code, shape: s.shape, x_mm: r4(s.x_mm), y_mm: r4(s.y_mm), phys_mm: s.phys_mm, ref_mm: s.ref_mm, rot_deg: r4(s.rot_deg), locked: true, source: path.relative(ROOT, path.join(COST, 'queen.svg')) }));
d.layers[2].stones = pet.map((s, i) => ({ id: `PET${String(i + 1).padStart(5, '0')}`, layer: 'pet', code: s.code, shape: 'round', x_mm: r4(s.x_mm), y_mm: r4(s.y_mm), phys_mm: s.phys_mm, ref_mm: s.ref_mm, rot_deg: 0, locked: false, source: s.shrunkFrom ? `kit28:pet shrink ${s.shrunkFrom}` : 'kit28:pet' }));
const cnt = counts(d), fixedSym = Object.fromEntries(cDoc.palette.map((p) => [p.code, p.symbol]));
d.symbols = assignSymbols(cnt.byCode, scat, fixedSym);
d.meta = { option: OPT, palette: codes, maxNewPet: maxNew, petAdded: forced.work.palette.added, source: path.basename(SRC), faceBoxSrcPx: FACE, mask: 'kit/templates/queen_mask.png' };
const errs = validate(d);
if (errs.length) throw new Error(`design không hợp lệ: ${errs.slice(0, 5).join('; ')}`);
fs.writeFileSync(path.join(OUT, 'map.svg'), writeSvg(d, { cat: scat }));
const qc = await runQc(d, {}, { only: ['overlap', 'gap', 'code-count', 'catalog', 'symbols'] });
const qcOut = Object.fromEntries(qc.checks.map((c) => [c.id, { status: c.status, findings: c.findings.length, byLevel: tally(c.findings, (f) => f.level), msg: c.findings.slice(0, 5).map((f) => f.msg),
  ...(c.id === 'overlap' && { pairs: c.findings.flatMap((f) => f.data?.pairs || []).slice(0, 20) }) }]));
fs.writeFileSync(path.join(OUT, 'qc.json'), JSON.stringify({ design: d.id, checks: qcOut }, null, 1) + '\n');

// ── BOM: mỗi mã × layer
const layerOf = { bg: 'bg', costume: 'costume', pet: 'pet' }, bomRows = Object.entries(cnt.byCode).map(([c, n]) => {
  const e = entryOf(c, kcat), per = Object.fromEntries(Object.keys(layerOf).map((l) => [l, cnt.byLayer[l].byCode[c] || 0]));
  return { code: c, symbol: d.symbols[c], name: e.name, kind: e.kind, shape: e.shape || 'round', physMm: e.shape ? `${e.physW}x${e.physH}` : e.physMm, fill: e.fill, total: n, ...per,
    origin: codes.includes(c) ? 'shared' : 'pet-new' };
}).sort((a, b) => b.total - a.total);
const bomOut = { design: d.id, option: OPT, codes: bomRows.length, stones: cnt.total, byLayer: Object.fromEntries(Object.entries(cnt.byLayer).map(([l, v]) => [l, { stones: v.total, codes: v.codes }])), rows: bomRows };
fs.writeFileSync(path.join(OUT, 'bom.json'), JSON.stringify(bomOut, null, 1) + '\n');

// ── pearl-kit-map/1 (cùng toạ độ px 3543) + review.svg (ký hiệu trên ảnh ghép)
const cPal = Object.fromEntries(cDoc.palette.map((p) => [p.code, p]));
const palK = Object.fromEntries(Object.keys(cnt.byCode).map((c) => { const e = entryOf(c, kcat); return [c, { ...(cPal[c] || { code: c, rgb: e.fill, dMm: refOf(e.physMm, scat), edge: e.edge, text: e.text }), symbol: d.symbols[c] }]; }));
const kitStones = [
  ...starry.map((s, i) => ({ id: `BG${i + 1}`, symbol: d.symbols[s.code], code: s.code, x: s.x_mm * KPX, y: s.y_mm * KPX, dMm: s.ref_mm, layer: 'background' })),
  ...cDoc.stones.map((s) => ({ ...s, symbol: d.symbols[s.code], layer: 'costume' })),
  ...pet.map((s, i) => ({ id: `PET${i + 1}`, symbol: d.symbols[s.code], code: s.code, x: s.x_mm * KPX, y: s.y_mm * KPX, dMm: s.ref_mm, layer: 'pet' })),
];
fs.writeFileSync(path.join(OUT, 'map.kit.svg'), writeKitSvg({ canvas: { widthMm: MM, heightMm: MM, pxPerMm: 11.81 }, params: { mode: `kit-28 ${OPT}` }, source: { name: `${path.basename(SRC)} + Trang phục Queen + BG` },
  createdAt: new Date().toISOString(), palette: Object.values(palK), layers: [{ id: 'background', name: 'Nền Starry' }, { id: 'costume', name: 'Trang phục Queen' }, { id: 'pet', name: 'Pet' }], stones: kitStones }));
const small = (im, f) => { const w = Math.floor(im.w / f), h = Math.floor(im.h / f), o = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const acc = [0, 0, 0, 0]; let n = 0;
    for (let v = 0; v < f; v++) for (let u = 0; u < f; u++) { const j = ((y * f + v) * im.w + x * f + u) * 4; for (let c = 0; c < 4; c++) acc[c] += im.data[j + c]; n++; }
    for (let c = 0; c < 4; c++) o[(y * w + x) * 4 + c] = Math.round(acc[c] / n); }
  return { w, h, data: o }; };
const resizeTo = (im, w) => { const o = new Uint8Array(w * w * 4); for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) { const sx = Math.min(im.w - 1, Math.floor(((x + 0.5) * im.w) / w)), sy = Math.min(im.h - 1, Math.floor(((y + 0.5) * im.h) / w)); o.set(im.data.subarray((sy * im.w + sx) * 4, (sy * im.w + sx) * 4 + 4), (y * w + x) * 4); } return { w, h: w, data: o }; };
const bgFile = await io.write(path.join(OUT, 'work'), MAP, MAP, resizeTo(work, MAP).data);
execFileSync(process.execPath, [path.join(ROOT, 'tools', 'kit_review_overlay.mjs'), path.join(OUT, 'map.kit.svg'), path.join(OUT, bgFile), path.join(OUT, 'review.svg')], { stdio: 'ignore' });

// ── mockup: viên cỡ vật lý (kiểu _3) trên ảnh ghép, 1772 px; face.png = zoom ô mặt (ảnh | viên)
const sc = W / MAP, palR = { codes: Object.fromEntries(Object.keys(cnt.byCode).map((c) => { const e = entryOf(c, kcat); return [c, { fill: e.fill, edge: e.edge, text: e.text, fontPx: e.fontPx }]; })) };
const phys = (s) => { const e = entryOf(s.code, kcat); return e.shape ? { x: s.x_mm * KPX, y: s.y_mm * KPX, code: s.code, rot: s.rot_deg, shape: e.shape, wMm: e.physW, hMm: e.physH, dMm: e.physMm } : { x: s.x_mm * KPX, y: s.y_mm * KPX, code: s.code, dMm: e.physMm }; };
const mock = over(work, renderMap({ px: MAP, stones: [...starry, ...costume, ...pet].map(phys) }, palR, { style: 'clean', scale: sc, marginMm: 0, closeMm: 0 }));
const m2 = small(mock, 3);
fs.writeFileSync(path.join(OUT, 'mockup.png'), encodePng(m2.w, m2.h, m2.data));
const crop = (im, x, y, S) => { const o = new Uint8Array(S * S * 4); for (let v = 0; v < S; v++) for (let u = 0; u < S; u++) { const sx = Math.min(im.w - 1, Math.max(0, Math.round(x - S / 2 + u))), sy = Math.min(im.h - 1, Math.max(0, Math.round(y - S / 2 + v))); o.set(im.data.subarray((sy * im.w + sx) * 4, (sy * im.w + sx) * 4 + 4), (v * S + u) * 4); } return { w: S, h: S, data: o }; };
const B = Math.max(bx1 - bx0, by1 - by0) + Math.round(W / 30), fc = [crop(work, (bx0 + bx1) / 2, (by0 + by1) / 2, B), crop(mock, (bx0 + bx1) / 2, (by0 + by1) / 2, B)].map((m) => small(m, 2));
const face = { w: fc[0].w * 2 + 8, h: fc[0].h, data: new Uint8Array((fc[0].w * 2 + 8) * fc[0].h * 4).fill(255) };
for (let y = 0; y < face.h; y++) fc.forEach((m, i) => face.data.set(m.data.subarray(y * m.w * 4, (y + 1) * m.w * 4), (y * face.w + i * (m.w + 8)) * 4));
fs.writeFileSync(path.join(OUT, 'face.png'), encodePng(face.w, face.h, face.data));

// ── báo cáo
const petCodes = [...new Set(pet.map((s) => s.code))], usedC = new Set(costume.map((s) => s.code)), usedS = new Set(starry.map((s) => s.code));
const merged = tally(pet.filter((s) => s.free && s.free !== s.code), (s) => `${s.free}→${s.code}`);
const report = {
  pet: PET, option: OPT, source: SRC, ms: Date.now() - t0, upscale: { method: up.method, ms: up.ms }, place: { faceBoxSrcPx: FACE, scale: +scl.toFixed(4) },
  palette: { shared: codes, n: codes.length, maxNewPet: maxNew, petAdded: forced.work.palette.added, product: bomRows.length, productCap: HARD_MAX },
  layers: {
    background: { svgStones: sDoc.stones.length, where: sWhere, inBg: sBg.length, droppedNearCostumeOrPet: koS.dropped, kept: starry.length, codes: [...usedS], recodeOrderCheck: `${agree}/${recS.length}`, meanDE00: starryDE },
    costume: { stones: costume.length, where: costumeWhere, codes: [...usedC], file: path.join(COST, 'queen.svg') },
    pet: { detected: forced.work.detected, beforeKeepOut: petMm.length, dropped: koPet.dropped, shrunk: koPet.shrunk, stones: pet.length, codes: petCodes, byCode: tally(pet, (s) => s.code), sizes: tally(pet, (s) => s.phys_mm) },
  },
  bigGuard: bigMaxDE ? { maxDE: bigMaxDE, changed: guard } : null,
  petCodes: { shared: petCodes.filter((c) => codes.includes(c)).map((c) => ({ code: c, from: [usedC.has(c) && 'costume', usedS.has(c) && 'background'].filter(Boolean).join('+') || 'palette-only', n: pet.filter((s) => s.code === c).length })),
    new: petCodes.filter((c) => !codes.includes(c)), mergedFreeToForced: merged, changedStones: forced.work.palette.changed, resized: forced.work.palette.resized },
  deltaE76: { free: forced.work.palette.deFree, forced: forced.work.palette.deForced, forced0: forced0.work.palette.deForced, freeCodes: forced.work.palette.freeCodes },
  seam: { petCentreOutsideSlot: petCentreOut, petDiscCrossingSlot: petDiscOut, petOverflowMaxMm: r2(overflowMax), costumeCentresInSlot: costumeWhere.face || 0,
    petVsCostume: minGapOf(pet, costume), petVsBackground: minGapOf(pet, starry), backgroundVsCostume: minGapOf(starry, costume) },
  qc: Object.fromEntries(Object.entries(qcOut).map(([k2, v]) => [k2, { status: v.status, findings: v.findings, msg: v.msg.slice(0, 2) }])),
  stones: { total: cnt.total, background: starry.length, costume: costume.length, pet: pet.length },
  files: Object.fromEntries(['map.svg', 'map.kit.svg', 'review.svg', 'mockup.png', 'face.png', 'bom.json', 'qc.json'].map((f) => [f, path.join(OUT, f)])),
};
fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 1) + '\n');
console.log(`${PET} ${OPT}: bảng ${codes.length} + pet mới [${report.petCodes.new.join(' ')}] = ${bomRows.length} mã · viên nền ${starry.length} trang phục ${costume.length} pet ${pet.length}`);
console.log(`ΔE76 pet tự do ${report.deltaE76.free} · ép +${maxNew} ${report.deltaE76.forced} · ép +0 ${report.deltaE76.forced0} · pet keepOut bỏ ${koPet.dropped} thu ${koPet.shrunk} · tràn ô ${petDiscOut} (max ${r2(overflowMax)} mm)`);
console.log(`QC: ${Object.entries(qcOut).map(([k2, v]) => `${k2} ${v.status}`).join(', ')} · ${(report.ms / 1000).toFixed(0)} s`);
