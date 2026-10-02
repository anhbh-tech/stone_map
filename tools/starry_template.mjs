// KIT-16b: mẫu NỀN Starry cố định, ĐÍNH KÍN (captain 2026-10-02, không còn partial 31 % của KIT-11), map 1 lần, 0 gọi API.
//   node tools/starry_template.mjs [--max-codes 13] [--share queen|none] [--opt '{…}']   (~1 phút)
// Nguồn requirements/BG.png (tranh phẳng, không nền caro → cả khung 300 mm là vùng đá; _3.jpg là ảnh mockup của cùng tranh).
// mapCostume không DETECT (detect: false): lưới lục giác 2.8 mm khe 0.15 phủ kín → mã ≤ maxCodes (Potts/ICM trên viên chạm nhau).
// --share queen (mặc định): mã của kit/templates/queen_costume_chain.svg rẻ hơn preferDE (3) ΔE00 khi chọn → nền dùng chung mã
// với trang phục khi gần màu; report ghi số mã nền / trang phục / chung / hợp (ngân sách cả sản phẩm lý tưởng 13, trần 15).
// Ra kit/templates/starry_{mask.png, background.svg, template.json} + outputs/kit/starry_template/{overview, mockup_*, zoom_*, bom.csv, report.json}.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mapCostume, upscale, docFlip, lab } from '../lib/kit/select.js';
import { de2000 } from '../lib/kit/place.js';
import { loadCatalog, checkDesign, entryOf } from '../lib/kit/catalog.js';
import { normalizeDoc, writeKitSvg, readKitSvg } from '../lib/kit/svgio.js';
import { renderMap, over } from '../lib/kit/render.js';
import { shrinkOnWhite, grid, crop } from '../lib/kit/build.js';
import { pixelIO } from '../lib/pixels.js';
import { encodePng } from '../lib/png.js';
import { backgroundMask } from '../lib/kit/detect.js';
import { stoneRecords } from '../lib/kit/palette.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2), flag = (n) => { const i = args.indexOf(n); return i >= 0 ? args.splice(i, 2)[1] : null; };
const NAME = 'starry', share = flag('--share') || 'queen', maxCodes = +(flag('--max-codes') || 13), opt = JSON.parse(flag('--opt') || '{}');
const REQ = process.env.KIT_REQ || path.join(process.cwd(), 'requirements');
const SRC = path.resolve(flag('--src') || path.join(REQ, 'BG.png'));
const TPL = path.join(ROOT, 'kit', 'templates'), OUT = path.join(ROOT, 'outputs', 'kit', `${NAME}_template`);
const py = process.env.PEARL_VENV_PY || [path.join(ROOT, '.venv', 'bin', 'python'), path.join(process.cwd(), '.venv', 'bin', 'python')].find((f) => fs.existsSync(f)) || 'python3';
const io = pixelIO(py, path.join(ROOT, 'tools', 'pixels.py'));
fs.mkdirSync(TPL, { recursive: true }); fs.mkdirSync(OUT, { recursive: true });
const t0 = Date.now(), MM = 300, cat = loadCatalog();
const img0 = await io.read(SRC);
const img = img0.w !== 3543 ? upscale(img0, 3543, Math.round((3543 * img0.h) / img0.w)) : img0, W = img.w, H = img.h, ppm = W / MM, N = W * H;

// vùng đá = mọi điểm không phải nền caro / alpha (BG.png: cả khung). Mask: trắng = đá nền, đen = không đá
const bg = backgroundMask(img).bg, fgMask = Uint8Array.from(bg, (v) => 1 - v);
const fgN = fgMask.reduce((a, v) => a + v, 0), rgba = new Uint8Array(N * 4);
for (let j = 0; j < N; j++) { const v = fgMask[j] ? 255 : 0; rgba[j * 4] = rgba[j * 4 + 1] = rgba[j * 4 + 2] = v; rgba[j * 4 + 3] = 255; }
const F = { mask: path.join(TPL, `${NAME}_mask.png`), svg: path.join(TPL, `${NAME}_background.svg`), meta: path.join(TPL, `${NAME}_template.json`) };
fs.writeFileSync(F.mask, encodePng(W, H, rgba, { 'pearl-kit-template-mask': 'white=background stones black=none' }, { rgb: true }));

// mã trang phục để dùng chung
const shareSvg = share === 'none' ? null : path.join(TPL, `${share}_costume_chain.svg`);
const costumeCodes = shareSvg && fs.existsSync(shareSvg) ? readKitSvg(fs.readFileSync(shareSvg, 'utf8')).palette.map((p) => p.code) : [];
// KIT-18 bảng mã chung sản phẩm (tools/product_palette.mjs): có file thì mã chỉ trong pool (thay --share / --max-codes)
const palArg = flag('--palette'), palFile = palArg === 'none' ? null : path.resolve(palArg || path.join(TPL, 'product_queen_starry_palette.json'));
const palette = palFile && fs.existsSync(palFile) ? JSON.parse(fs.readFileSync(palFile, 'utf8')) : null, codePool = palette?.codes || null;
const collect = flag('--collect');
let recs = null;
const r = mapCostume(img, { canvasMm: MM, cat, fgMask, detect: false, oneMaterial: true, smoothGems: false, gemRings: false, chains: false, maxCodes, ...(costumeCodes.length && !codePool && { preferCodes: costumeCodes }), ...(codePool && { codePool }), ...opt,
  ...(collect && { onStones: (pl) => { recs = stoneRecords(pl, cat, { layer: NAME, one: true, gwl: opt.goldWL ?? 1 }); } }) });
// --collect <file>: ghi viên (lớp + màu mục tiêu, trước chọn mã) cho tools/product_palette.mjs rồi thoát
if (collect) {
  fs.writeFileSync(collect, JSON.stringify({ layer: NAME, codes: r.doc.palette.map((p) => p.code), codeCost: r.codeCost, coverage: r.coverage, stones: r.placed.length, records: recs }));
  console.log(`collect ${NAME}: ${recs.length} viên, ${r.doc.palette.length} mã → ${collect}`);
  process.exit(0);
}
const doc = normalizeDoc({ ...r.doc, mode: 'kit-16 background (full drill)', source: { name: `${path.basename(SRC)} (upscale ${img0.w}→${W})`, widthPx: W, heightPx: H }, createdAt: new Date().toISOString(),
  template: { name: NAME, layer: 'background', mask: path.basename(F.mask) }, stats: { stones: r.doc.stones.length, coveragePct: Math.round(r.coverage * 1000) / 10, codes: r.doc.palette.length } });
const check = checkDesign(doc, cat), svg = writeKitSvg(doc);
fs.writeFileSync(F.svg, svg); fs.writeFileSync(path.join(OUT, `${NAME}.svg`), svg);
const bom = doc.bom.map((b) => { const e = entryOf(b.code, cat); return { symbol: b.symbol, code: b.code, kind: e.kind, physMm: e.physMm, refMm: e.refMm, hex: e.fill, family: e.family, name: e.name, count: b.count, sharedWith: costumeCodes.includes(b.code) ? share : '' }; });
fs.writeFileSync(path.join(OUT, 'bom.csv'), ['symbol,code,kind,physical_mm,reference_mm,hex,family,name,count,shared_with', ...bom.map((b) => [b.symbol, b.code, b.kind, b.physMm, b.refMm, b.hex, b.family, `"${String(b.name || '').replace(/"/g, '""')}"`, b.count, b.sharedWith].join(','))].join('\n') + '\n');

// mockup + ΔE00 ô 3 mm (màu TB ô) mockup sạch vs ảnh
const pal = { codes: Object.fromEntries(doc.palette.map((p) => [p.code, { fill: p.rgb, edge: p.edge, text: p.text, fontPx: p.fontPx, symbol: p.symbol }])) }, disc = { marginMm: 0, closeMm: 0 };
const mClean = over(img, renderMap({ px: W, stones: doc.stones.map((s) => ({ ...s, dMm: entryOf(s.code, cat).physMm })) }, pal, { style: 'clean', ...disc })), mSym = over(img, renderMap({ px: W, stones: doc.stones }, pal, { style: 'symbols', ...disc }));
const files = { svg: F.svg, mask: F.mask, bom: path.join(OUT, 'bom.csv') };
for (const [n, im] of [['mockup_clean', mClean], ['mockup_symbols', mSym]]) files[n] = path.join(OUT, await io.write(path.join(OUT, n), im.w, im.h, im.data));
const ov = grid([img, mClean, mSym].map((im) => shrinkOnWhite(im, 4)), 3);
files.overview = path.join(OUT, await io.write(path.join(OUT, 'overview'), ov.w, ov.h, ov.data));
const blk = Math.round(3 * ppm);
let bs = 0, bn = 0;
for (let by = 0; by + blk <= H; by += blk) for (let bx = 0; bx + blk <= W; bx += blk) {
  const A = [0, 0, 0], B = [0, 0, 0];
  for (let y = by; y < by + blk; y++) for (let x = bx; x < bx + blk; x++) { const j = (y * W + x) * 4; for (let c = 0; c < 3; c++) { A[c] += img.data[j + c]; B[c] += mClean.data[j + c]; } }
  bs += de2000(lab(A.map((v) => v / blk / blk)), lab(B.map((v) => v / blk / blk))); bn++;
}
// zoom 2 vùng: trăng (ô 40 mm sáng vàng nhất) và xoáy giữa tranh (ô nhiều mã khác nhau nhất trong dải giữa)
const cellMm = 40, cells = [];
for (let y = cellMm / 2; y <= MM - cellMm / 2; y += 10) for (let x = cellMm / 2; x <= MM - cellMm / 2; x += 10) {
  const st = doc.stones.filter((s) => Math.abs(s.x / ppm - x) < cellMm / 2 && Math.abs(s.y / ppm - y) < cellMm / 2);
  const yellow = st.filter((s) => { const [L, a, b] = lab(entryOf(s.code, cat).fill.match(/\w\w/g).map((h) => parseInt(h, 16))); return b > 40 && L > 60; }).length;
  cells.push({ x, y, yellow, codes: new Set(st.map((s) => s.code)).size });
}
const moon = [...cells].sort((a, b) => b.yellow - a.yellow)[0], swirl = [...cells].filter((c) => c.y > 90 && c.y < 210 && Math.hypot(c.x - moon.x, c.y - moon.y) > 60).sort((a, b) => b.codes - a.codes)[0];
for (const [name, z] of [['moon', moon], ['swirl', swirl]]) {
  const s = Math.round(cellMm * ppm), x0 = Math.max(0, Math.min(W - s, Math.round(z.x * ppm - s / 2))), y0 = Math.max(0, Math.min(H - s, Math.round(z.y * ppm - s / 2)));
  const parts = [img, mClean, mSym].map((im) => crop(im, x0, y0, s, s)), ZW = 3 * s + 16, buf = new Uint8Array(ZW * s * 4).fill(255);
  parts.forEach((pt, q) => { for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) { const sj = (y * s + x) * 4, dj = (y * ZW + q * (s + 8) + x) * 4; for (let c = 0; c < 3; c++) buf[dj + c] = pt.data[sj + c]; } });
  files[`zoom_${name}`] = path.join(OUT, await io.write(path.join(OUT, `zoom_${name}`), ZW, s, buf));
}
const bgCodes = doc.palette.map((p) => p.code), shared = bgCodes.filter((c) => costumeCodes.includes(c)), union = new Set([...bgCodes, ...costumeCodes]);
const flip = docFlip(doc.stones, cat, img, ppm);
const report = { source: SRC, upscaled: [img0.w, W], areaMm2: Math.round(fgN / ppm ** 2), check: check.ok ? 'ok' : check.errors.slice(0, 10), stones: doc.stones.length, coveragePct: +(100 * r.coverage).toFixed(1),
  codes: bgCodes.length, palette: doc.palette.map((p) => ({ symbol: p.symbol, code: p.code, count: doc.bom.find((b) => b.code === p.code)?.count })),
  budget: { background: bgCodes.length, costume: costumeCodes.length, costumeFrom: shareSvg && path.relative(ROOT, shareSvg), shared, union: union.size, productTarget: 13, productHard: 15, note: 'pet thêm mã riêng; tổng sản phẩm = hợp các lớp' },
  ...(codePool && { productPalette: { file: path.relative(ROOT, palFile), codes: codePool } }),
  flipDocPct: { all: +(100 * flip.all).toFixed(1), similar: +(100 * flip.similar).toFixed(1) }, deltaE00Block3mm: +(bs / bn).toFixed(2), codeCost: +r.codeCost.toFixed(2), geom: r.geom, files, ms: Date.now() - t0, apiCalls: 0 };
fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 1) + '\n');
fs.writeFileSync(F.meta, JSON.stringify({ schema: 'pearl-kit-template/1', name: NAME, layer: 'background', source: path.basename(SRC), canvasMm: MM, widthPx: W, heightPx: H, pxPerMm: +ppm.toFixed(4),
  mask: { file: path.basename(F.mask), legend: { stones: '#FFFFFF', none: '#000000' } }, svg: path.basename(F.svg), stones: doc.stones.length, codes: bgCodes, sharedWith: { [share]: shared }, rebuild: 'node tools/starry_template.mjs' }, null, 1) + '\n');
console.log(`starry: ${doc.stones.length} stones, ${bgCodes.length} codes, coverage ${report.coveragePct}% of ${report.areaMm2} mm², flip ${report.flipDocPct.all}% / similar ${report.flipDocPct.similar}%, ΔE00 3 mm ${report.deltaE00Block3mm}, check ${report.check === 'ok' ? 'ok' : JSON.stringify(report.check)}`);
console.log(`budget: background ${bgCodes.length} + costume ${costumeCodes.length}, shared ${shared.length} [${shared}] → union ${union.size} · ${OUT} · ${((Date.now() - t0) / 1000).toFixed(0)} s · 0 API calls`);
