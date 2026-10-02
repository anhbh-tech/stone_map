// KIT-19: pet Queen trên ô mặt THẬT của mẫu (kit/templates/queen_mask.png, đỏ = ô mặt), ép bảng mã chung Queen + Starry, 0 API.
//   node tools/pet_kit19.mjs [--src ảnh.png] [--face x0,y0,x1,y1] [--max-new 2] [--upscale lanczos]   (~1 phút, Real-ESRGAN ~40 s)
// 1. ảnh 1254 px (requirements/Mẫu Queen.png) → phóng ×4 (lib/kit/upscale.js) → hộp mặt (--face, px ảnh vào) đặt vừa ô đỏ → petMap
//    (KIT-17) trong ô đỏ của mask 3543 px (lấy mẫu gần nhất), noOverlap (viên pet không chồng nhau: khe vật lý ≥ −0.05 = ngưỡng QC;
//    dán một phần như sản phẩm thật: Queen thật 266 viên / 16 % phủ trong hộp mặt, không lấp kín). Chạy 3 lần cùng ảnh phóng: tự do (mọi mã tròn catalog, ≤ 13 mã limitCodes),
//    ép bảng chung + max-new mã mới, ép bảng chung + 0 mã mới → ΔE76 đích↔catalog từng cách (fitPalette, lib/kit/pet.js).
// 2. bảng chung = productPalette() (kit/templates/product_queen_starry_palette.json của KIT-18; chưa có → hợp mã costume ∪ starry).
// 3. giáp ô mặt / cổ áo: viên pet có khe vật lý < 0.15 mm với viên trang phục (chain ∪ print, mọi shape) → thu về 2.8 mm, vẫn sát → bỏ.
// 4. ra outputs/kit/kit19/: pet.design.json (stonemap-design/1, layer pet), pet.svg (stonemap-svg/1), zoom_*.jpg, overview.jpg, report.json.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePng } from '../lib/png.js';
import { petMap, codeModel, limitCodes, lab, productPalette, keepOut } from '../lib/kit/pet.js';
import { upscale4, lanczos } from '../lib/kit/upscale.js';
import { loadCatalog as kitCatalog, entryOf } from '../lib/kit/catalog.js';
import { readKitSvg } from '../lib/kit/svgio.js';
import { renderMap, over } from '../lib/kit/render.js';
import { loadCatalog, assignSymbols, refOf } from '../lib/stonemap/catalog.js';
import { newDesign, validate, counts } from '../lib/stonemap/design.js';
import { writeSvg } from '../lib/stonemap/svg.js';
import { edgeGap } from '../lib/stonemap/geom.js';
import { runQc } from '../lib/stonemap/qc/index.js';
import { pixelIO } from '../lib/pixels.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2), flag = (n) => { const i = args.indexOf(n); return i >= 0 ? args.splice(i, 2)[1] : null; };
const REQ = process.env.KIT_REQ || path.join(process.cwd(), 'requirements'), TPL = path.join(ROOT, 'kit', 'templates'), OUT = path.join(ROOT, 'outputs', 'kit', 'kit19');
const SRC = flag('--src') || path.join(REQ, 'Mẫu Queen.png'), maxNew = +(flag('--max-new') ?? 2), upForce = flag('--upscale');
const MM = 300, MAP = 3543, GAP = 0.15, MAX_CODES = 13, HARD_MAX = 15;
const py = process.env.PEARL_VENV_PY || [path.join(ROOT, '.venv', 'bin', 'python'), path.join(process.cwd(), '.venv', 'bin', 'python')].find((f) => fs.existsSync(f)) || 'python3';
const io = pixelIO(py, path.join(ROOT, 'tools', 'pixels.py'));
const petCodesOf = (dd) => new Set(dd.layers.at(-1).stones.map((s) => s.code));
const r2 = (v) => Math.round(v * 100) / 100, r4 = (v) => Math.round(v * 1e4) / 1e4;
fs.mkdirSync(OUT, { recursive: true });
const t0 = Date.now();

// ── ảnh + mask ô mặt (đỏ: R ≥ 128, G < 128, B < 128; mask 3543 px → lưới ảnh vào, gần nhất)
const img = decodePng(fs.readFileSync(SRC)), qm = decodePng(fs.readFileSync(path.join(TPL, 'queen_mask.png')));
const red = (x, y) => { const j = (y * qm.w + x) * 4; return qm.data[j] >= 128 && qm.data[j + 1] < 128 && qm.data[j + 2] < 128; };
const up = await upscale4(img, { force: upForce === 'lanczos' ? 'lanczos' : undefined }), W = up.img.w, H = up.img.h, k = W / img.w;
const mask = new Uint8Array(W * H);
let maskN = 0, bx0 = W, by0 = H, bx1 = 0, by1 = 0;
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (red(Math.min(qm.w - 1, Math.floor(((x + 0.5) * qm.w) / W)), Math.min(qm.h - 1, Math.floor(((y + 0.5) * qm.h) / H)))) {
  mask[y * W + x] = 1; maskN++; bx0 = Math.min(bx0, x); bx1 = Math.max(bx1, x); by0 = Math.min(by0, y); by1 = Math.max(by1, y); }
const mmPerPx = MM / W, toMm = (s) => ({ x_mm: s.x * mmPerPx, y_mm: s.y * mmPerPx });
// Mẫu Queen.png KHÔNG cùng khung với Trang phục Queen.png (mẫu trang phục to và thấp hơn) → đặt mặt pet vào ô như đơn thật: hộp mặt
// (px ảnh vào, mũi → má, trán → cằm) co giãn vừa hộp ô đỏ (contain, giữ tỉ lệ), tâm trùng tâm ô; ngoài ô = ảnh trang phục (Lanczos ×4).
const FACE = (flag('--face') || '348,306,850,697').split(',').map(Number), fs4 = FACE.map((v) => v * k);
const scl = Math.min((bx1 - bx0) / (fs4[2] - fs4[0]), (by1 - by0) / (fs4[3] - fs4[1])), cs = [(fs4[0] + fs4[2]) / 2, (fs4[1] + fs4[3]) / 2], ct = [(bx0 + bx1) / 2, (by0 + by1) / 2];
const costumeImg = lanczos(decodePng(fs.readFileSync(path.join(REQ, 'Trang phục Queen.png'))), W / 1254), work = { w: W, h: H, data: new Uint8Array(W * H * 4) };
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const j = (y * W + x) * 4;
  if (!mask[y * W + x]) { work.data.set(costumeImg.data.subarray(j, j + 4), j); continue; }
  const u = cs[0] + (x - ct[0]) / scl, v = cs[1] + (y - ct[1]) / scl, x0 = Math.floor(u), y0 = Math.floor(v), a = u - x0, b = v - y0;
  for (let c = 0; c < 4; c++) { const at = (xx, yy) => up.img.data[(Math.min(H - 1, Math.max(0, yy)) * W + Math.min(W - 1, Math.max(0, xx))) * 4 + c];
    work.data[j + c] = Math.round((1 - a) * (1 - b) * at(x0, y0) + a * (1 - b) * at(x0 + 1, y0) + (1 - a) * b * at(x0, y0 + 1) + a * b * at(x0 + 1, y0 + 1)); }
}

// ── mã: bom = mọi mã đá tròn của catalog; bảng chung
const kcat = kitCatalog(), bom = Object.values(kcat.codes).filter((e) => e.kind === 'stone').map((e) => ({ code: e.code, physMm: e.physMm, lab: lab([1, 3, 5].map((i) => parseInt(e.fill.slice(i, i + 2), 16))) }));
const pal = productPalette(TPL), model = codeModel(['snowman', 'dachshund']), base = { canvasWmm: MM, mask, model, bom, noOverlap: true, minGapMm: -0.05 };
const free = petMap(work, base), freeSt = limitCodes(free.stones, bom, MAX_CODES, HARD_MAX);
const forced = petMap(work, { ...base, palette: { codes: pal.codes, maxNew } });
const forced0 = petMap(work, { ...base, palette: { codes: pal.codes, maxNew: 0 } });

// ── giáp trang phục: viên costume (chain ∪ print, mọi shape) dạng stonemap
const scat = loadCatalog(), costumeDocs = ['chain', 'print'].map((v) => readKitSvg(fs.readFileSync(path.join(TPL, `queen_costume_${v}.svg`), 'utf8')));
const costume = costumeDocs.flatMap((d, vi) => d.stones.map((s) => { const e = scat.codes[s.code];
  return { id: `${vi}:${s.id}`, code: s.code, shape: e.shape, x_mm: s.x / (MAP / MM), y_mm: s.y / (MAP / MM), phys_mm: e.physMm, ref_mm: e.refMm, rot_deg: s.rot || 0 }; }));
const byCode = new Map(bom.map((b) => [b.code, b])), kept = new Set([...forced.work.palette.base, ...forced.work.palette.added]);
const L28 = bom.filter((b) => b.physMm === 2.8 && kept.has(b.code)), de = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const shrink = (s) => { const L = byCode.get(s.code).lab, c = L28.reduce((a, b) => (de(L, b.lab) < de(L, a.lab) ? b : a)); return { ...s, code: c.code, phys_mm: 2.8, ref_mm: refOf(2.8, scat), shrunkFrom: s.code }; };
const petMm = forced.stones.map((s) => ({ ...toMm(s), code: s.code, shape: 'round', phys_mm: s.physMm, ref_mm: refOf(s.physMm, scat), rot_deg: 0 }));
const ko = keepOut(petMm, costume, { gapMm: GAP, cat: scat, shrink });
let minGap = Infinity, tight = 0;
for (const s of ko.stones) for (const o of costume) if (Math.hypot(o.x_mm - s.x_mm, o.y_mm - s.y_mm) < (o.phys_mm + s.phys_mm) / 2 + 1) { const g = edgeGap(s, o, scat); minGap = Math.min(minGap, g); if (g < GAP - 1e-9) tight++; }

// ── stonemap-design/1 (layer pet); ký hiệu: giữ chữ của mã chung đã có trong costume
const d = newDesign({ id: 'kit19:queen-pet', w_mm: MM, h_mm: MM, catalogVersion: scat.version, layers: ['pet'] });
d.layers[0].stones = ko.stones.map((s, i) => ({ id: `PET${String(i + 1).padStart(5, '0')}`, layer: 'pet', code: s.code, shape: 'round', x_mm: r4(s.x_mm), y_mm: r4(s.y_mm),
  phys_mm: s.phys_mm, ref_mm: s.ref_mm, rot_deg: 0, locked: false, source: s.shrunkFrom ? `kit19:pet shrink ${s.shrunkFrom}` : 'kit19:pet' }));
const cnt = counts(d), fixed = Object.fromEntries(costumeDocs[0].palette.map((p) => [p.code, p.symbol]));
d.symbols = assignSymbols(cnt.byCode, scat, fixed);
d.meta = { template: 'queen', mask: 'kit/templates/queen_mask.png (đỏ)', source: path.basename(SRC), palette: { from: pal.from, base: pal.codes, added: forced.work.palette.added }, keepOut: { gapMm: GAP, against: 'queen_costume_chain.svg ∪ queen_costume_print.svg' } };
const errs = validate(d);
if (errs.length) throw new Error(`pet.design.json không hợp lệ: ${errs.slice(0, 5).join('; ')}`);
fs.writeFileSync(path.join(OUT, 'pet.design.json'), JSON.stringify(d, null, 1) + '\n');
fs.writeFileSync(path.join(OUT, 'pet.svg'), writeSvg(d, { cat: scat }));
// QC: pet riêng + pet ghép costume chain (chồng / khe khác layer)
const qcPet = await runQc(d, {}, { only: ['overlap', 'gap', 'code-count', 'catalog', 'symbols'] });
const both = newDesign({ id: 'kit19:queen+pet', w_mm: MM, h_mm: MM, catalogVersion: scat.version, layers: ['costume', 'pet'] });
both.layers[0].stones = costume.filter((s) => s.id.startsWith('0:')).map((s) => ({ ...s, layer: 'costume', locked: true, source: 'queen_costume_chain.svg' }));
both.layers[1].stones = d.layers[0].stones;
const qcBoth = await runQc(both, {}, { only: ['overlap', 'gap'] });

// ── nền Starry trong ô mặt? (bg phủ cả 300 mm; ghép sản phẩm phải bỏ bg trong ô mặt)
const starry = readKitSvg(fs.readFileSync(path.join(TPL, 'starry_background.svg'), 'utf8')).stones;
const starryInFace = starry.filter((s) => red(Math.min(qm.w - 1, Math.round(s.x)), Math.min(qm.h - 1, Math.round(s.y)))).length;

// ── ảnh: ảnh phóng | costume + pet (cỡ vật lý, kiểu _3); zoom ở 3 chỗ giáp (đáy ô mặt = cổ áo, đỉnh = vương miện, mép trái) + giữa mặt
const sc = W / MAP, palR = { codes: Object.fromEntries([...costumeDocs[0].palette.map((p) => [p.code, { fill: p.rgb, edge: p.edge, text: p.text, fontPx: p.fontPx }]),
  ...[...petCodesOf(d)].map((c) => [c, { fill: kcat.codes[c].fill, edge: kcat.codes[c].edge, text: kcat.codes[c].text, fontPx: kcat.codes[c].fontPx }])]) };
const costumePhys = costumeDocs[0].stones.map((s) => { const e = entryOf(s.code, kcat); return e.shape ? { ...s, wMm: e.physW, hMm: e.physH, dMm: e.physMm } : { ...s, dMm: e.physMm }; });
const petPhys = d.layers[0].stones.map((s) => ({ x: (s.x_mm * MAP) / MM, y: (s.y_mm * MAP) / MM, dMm: s.phys_mm, code: s.code }));
const mock = over(work, renderMap({ px: MAP, stones: [...costumePhys, ...petPhys] }, palR, { style: 'clean', scale: sc, marginMm: 0, closeMm: 0 }));
const crop = (im, x, y, S) => { const o = new Uint8Array(S * S * 4); for (let v = 0; v < S; v++) for (let u = 0; u < S; u++) { const sx = Math.min(im.w - 1, Math.max(0, Math.round(x - S / 2 + u))), sy = Math.min(im.h - 1, Math.max(0, Math.round(y - S / 2 + v))); o.set(im.data.subarray((sy * im.w + sx) * 4, (sy * im.w + sx) * 4 + 4), (v * S + u) * 4); } return { w: S, h: S, data: o }; };
const row = (ims) => { const Wr = ims.reduce((a, m) => a + m.w + 8, -8), Hr = Math.max(...ims.map((m) => m.h)), o = new Uint8Array(Wr * Hr * 4).fill(255); let ox = 0; for (const m of ims) { for (let y = 0; y < m.h; y++) o.set(m.data.subarray(y * m.w * 4, (y + 1) * m.w * 4), (y * Wr + ox) * 4); ox += m.w + 8; } return { w: Wr, h: Hr, data: o }; };
const cx = Math.round((bx0 + bx1) / 2), cy = Math.round((by0 + by1) / 2), colY = (dir) => { for (let y = dir > 0 ? by1 : by0; y >= by0 && y <= by1; y -= dir) if (mask[y * W + cx]) return y; return cy; };
const rowX = () => { for (let x = bx0; x <= bx1; x++) if (mask[cy * W + x]) return x; return cx; };
const S = Math.round((36 * W) / MM), spots = { collar: [cx, colY(1)], crown: [cx, colY(-1)], side: [rowX(), cy], face: [cx, cy] }, files = {};
for (const [n, [x, y]] of Object.entries(spots)) { const z = row([crop(work, x, y, S), crop(mock, x, y, S)]); files[`zoom_${n}`] = path.join(OUT, await io.write(path.join(OUT, `zoom_${n}`), z.w, z.h, z.data)); }
const B = Math.max(bx1 - bx0, by1 - by0) + 2 * Math.round(W / 60), ovFull = row([crop(work, cx, cy, B), crop(mock, cx, cy, B)]);
const f = Math.max(1, Math.round(ovFull.w / 2400)), ov = { w: Math.floor(ovFull.w / f), h: Math.floor(ovFull.h / f), data: null };
ov.data = new Uint8Array(ov.w * ov.h * 4); for (let y = 0; y < ov.h; y++) for (let x = 0; x < ov.w; x++) ov.data.set(ovFull.data.subarray(((y * f) * ovFull.w + x * f) * 4, ((y * f) * ovFull.w + x * f) * 4 + 4), (y * ov.w + x) * 4);
files.overview = path.join(OUT, await io.write(path.join(OUT, 'overview'), ov.w, ov.h, ov.data));

// ── báo cáo
const codesOf = (st) => new Set(st.map((s) => s.code)), petCodes = codesOf(d.layers[0].stones), product = new Set([...pal.codes, ...petCodes]);
const newCodes = [...petCodes].filter((c) => !pal.codes.includes(c));
const report = {
  source: SRC, place: { faceBoxSrcPx: FACE, scale: +scl.toFixed(4), note: 'hộp mặt ảnh vào → hộp ô đỏ (contain), tâm trùng tâm; ngoài ô = Trang phục Queen.png' }, ms: Date.now() - t0, upscale: { method: up.method, ms: up.ms, error: up.error }, workPx: [W, H],
  mask: { file: 'kit/templates/queen_mask.png', redPx: maskN, areaMm2: Math.round(maskN * mmPerPx ** 2), boxMm: [bx0, by0, bx1, by1].map((v) => r2(v * mmPerPx)) },
  palette: { from: pal.from, codes: pal.codes, n: pal.codes.length, inPetBom: forced.work.palette.base, maxNew },
  deltaE76: { note: 'TB ΔE76 màu đích (ảnh + phần dư k-NN; viên to = màu ảnh) ↔ catalog của mã gán, cùng luật cỡ (fitPalette)',
    free: forced.work.palette.deFree, forced: forced.work.palette.deForced, forced0: forced0.work.palette.deForced, petMapModel: forced.work.palette.deModel,
    freeCodes: forced.work.palette.freeCodes, changedStones: forced.work.palette.changed, resized: forced.work.palette.resized },
  free: { stones: freeSt.length, codes: codesOf(freeSt).size, note: `tự do = mọi mã tròn catalog, limitCodes ${MAX_CODES}/${HARD_MAX}` },
  pet: { detected: forced.work.detected, stones: d.layers[0].stones.length, codes: petCodes.size, newCodes, byCode: cnt.byCode, sizes: Object.fromEntries(Object.entries(d.layers[0].stones.reduce((a, s) => ((a[s.phys_mm] = (a[s.phys_mm] || 0) + 1), a), {})).sort((a, b) => a[0] - b[0])) },
  product: { codes: product.size, ideal13: product.size <= MAX_CODES, cap15: product.size <= HARD_MAX, list: [...product] },
  keepOut: { gapMm: GAP, costumeStones: costume.length, dropped: ko.dropped, shrunk: ko.shrunk, minGapMm: r4(minGap), tightPairs: tight },
  qc: Object.fromEntries([['pet', qcPet], ['costumeChain+pet', qcBoth]].map(([n, q]) => [n, Object.fromEntries(q.checks.map((c) => [c.id, { status: c.status, msg: c.findings.map((x) => x.msg) }]))])),
  starryStonesInFace: starryInFace, symbols: d.symbols, files: { design: path.join(OUT, 'pet.design.json'), svg: path.join(OUT, 'pet.svg'), ...files },
};
fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 1) + '\n');
console.log(`ô mặt ${report.mask.areaMm2} mm² · pet ${report.pet.stones} viên ${JSON.stringify(report.pet.sizes)} ${report.pet.codes} mã (mới ${newCodes.join(',') || '0'}) · sản phẩm ${product.size} mã (bảng ${pal.codes.length})`);
console.log(`ΔE76 tự do ${report.deltaE76.free} → ép +${maxNew} ${report.deltaE76.forced} (ép +0 ${report.deltaE76.forced0}); giáp costume: bỏ ${ko.dropped}, thu ${ko.shrunk}, khe min ${report.keepOut.minGapMm} mm, cặp < ${GAP} ${tight}`);
console.log(`QC pet: ${qcPet.checks.map((c) => `${c.id} ${c.status}`).join(', ')} | costume+pet: ${qcBoth.checks.map((c) => `${c.id} ${c.status}`).join(', ')} · starry trong ô mặt ${starryInFace} · phóng ${up.method} ${(up.ms / 1000).toFixed(1)}s · ${(report.ms / 1000).toFixed(1)}s`);
console.log(Object.values(report.files).join('\n'));
