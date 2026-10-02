// KIT-11: map thử nền Starry theo spec sản xuất (partial drill) từ ảnh _3.jpg — không dùng SVG cũ làm đáp án.
//   node tools/map_starry.mjs [--opt '{"maxCodes":10,"target":0.315}'] [--mask vùng.png]   (~15 s, không gọi API)
// Ra outputs/kit/starry_v2/: starry_v2.svg (pearl-kit-map/1, qua checkDesign), bom.csv + bom.json, report.json,
// mockup_clean.jpg (ảnh in + đá kiểu _3, cỡ vật lý), mockup_symbols.jpg (ảnh in + đĩa ký hiệu kiểu _1, cỡ reference),
// region.jpg (vùng dán đá sáng, vùng in tối), overview.jpg (4 ảnh thu 1/4).
// --mask: PNG cùng cỡ ảnh (alpha ≥ 128 hoặc trắng = dán đá) — chỗ nhận regionMask của KIT-10.
// KIT-12b: --costume (mapCostume, mặc định ảnh 'Trang phục King.png'), --upscale (Lanczos tới 3543 px + unsharp),
//   --zoom 'x,y,mm;…' (zoom_N.jpg: ảnh | clean | ký hiệu; mặc định 2 đá quý to nhất), --big viên.json (viên to KIT-12a),
//   --compare cũ.svg (lật mã của SVG khác trên cùng ảnh, để so trước/sau). report.json thêm ΔE00 mockup vs ảnh, flip, rings, gems.
// KIT_REQ = thư mục requirements; PEARL_VENV_PY = python có OpenCV (đọc JPEG), mặc định ./.venv.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mapStarry, mapCostume, upscale, docFlip, trainRegion, trainColor, realGeom, REAL, lab } from '../lib/kit/select.js';
import { de2000 } from '../lib/kit/place.js';
import { loadCatalog, checkDesign } from '../lib/kit/catalog.js';
import { normalizeDoc, writeKitSvg, readKitSvg } from '../lib/kit/svgio.js';
import { renderMap, stoneField, over } from '../lib/kit/render.js';
import { shrinkOnWhite, grid, crop } from '../lib/kit/build.js';
import { pixelIO } from '../lib/pixels.js';
import { decodePng } from '../lib/png.js';
import { backgroundMask } from '../lib/kit/detect.js';
import { boxPx } from '../lib/kit/vlm.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2), flag = (n) => { const i = args.indexOf(n); return i >= 0 ? args.splice(i, 2)[1] : null; };
const opt = JSON.parse(flag('--opt') || '{}'), maskFile = flag('--mask'), srcArg = flag('--src'), outName = flag('--out'), noBg = args.includes('--no-bg');
const costume = args.includes('--costume'), doUp = args.includes('--upscale'), zoomArg = flag('--zoom'), bigFile = flag('--big'), cmpSvg = flag('--compare'), vlmDir = flag('--vlm'), vlmName = flag('--vlm-name');
const REQ = process.env.KIT_REQ || path.join(process.cwd(), 'requirements');
const py = process.env.PEARL_VENV_PY || [path.join(ROOT, '.venv', 'bin', 'python'), path.join(process.cwd(), '.venv', 'bin', 'python')].find((f) => fs.existsSync(f)) || 'python3';
const io = pixelIO(py, path.join(ROOT, 'tools', 'pixels.py'));
const OUT = path.join(ROOT, 'outputs', 'kit', outName || 'starry_v2');
const SRC = srcArg ? path.resolve(srcArg) : costume ? path.join(REQ, 'Trang phục King.png') : path.join(REQ, 'FIle Map đá', 'Starry Night Pearl Diamond Painting Kit - Royal Arch_3.jpg');
fs.mkdirSync(OUT, { recursive: true });

const t0 = Date.now();
const img0 = await io.read(SRC);
// --upscale: Lanczos tới 3543 px (300 mm × 11.81 px/mm như file thật) + unsharp
const img = doUp && img0.w !== 3543 ? upscale(img0, 3543, Math.round((3543 * img0.h) / img0.w)) : img0;
const cat = loadCatalog();
let regionMask = null;
if (maskFile) {
  const m = decodePng(fs.readFileSync(maskFile));
  if (m.w !== img.w || m.h !== img.h) throw new Error(`mask ${m.w}×${m.h} ≠ ảnh ${img.w}×${img.h}`);
  regionMask = new Uint8Array(m.w * m.h);
  for (let j = 0; j < regionMask.length; j++) regionMask[j] = m.data[j * 4 + 3] >= 128 && m.data[j * 4] >= 128 ? 1 : 0;
}
const region = regionMask || costume ? null : trainRegion({ reqDir: REQ, decode: (f) => decodePng(fs.readFileSync(f)) });
const color = trainColor();
// Nền (caro giả trong suốt vẽ chết / alpha / nền phẳng, KIT-7) không bao giờ có đá; --no-bg tắt
const excludeMask = noBg ? null : backgroundMask(img).bg;
// --vlm <dir>: kết quả KIT-13 có sẵn (tools/vlm_tiers.mjs big + mid, 0 gọi mới) → vật to [{bbox tỉ lệ ảnh, material, color, tier}].
// Tầng 1 ưu tiên <name>-big.json (thinking mặc định) rồi <name>-big@*.json; tầng 2 <name>-mid[@tag]-<i>.json; mục trùng tâm bỏ.
function loadVlm(dir, name) {
  const files = fs.readdirSync(dir), pick = (re) => files.filter((f) => re.test(f)).sort((a, b) => a.length - b.length || a.localeCompare(b));
  const big = pick(new RegExp(`^${name}-big(@[^-]+)?\\.json$`))[0], mids = new Map();
  for (const f of pick(new RegExp(`^${name}-mid(@[^-]+)?-(\\d+)\\.json$`))) { const i = /-(\d+)\.json$/.exec(f)[1]; if (!mids.has(i)) mids.set(i, f); }
  const items = [];
  for (const [tier, f] of [...(big ? [[1, big]] : []), ...[...mids.values()].map((f) => [2, f])]) {
    const o = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    for (const st of o.data?.stones || []) {
      const b = boxPx(st.box_2d, o.area); if (!b) continue;
      const it = { bbox: [b.x0 / img0.w, b.y0 / img0.h, b.x1 / img0.w, b.y1 / img0.h], material: st.material, color: st.color, vlmMm: st.diameter_mm, tier, file: f };
      const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2, rr = Math.max(b.x1 - b.x0, b.y1 - b.y0) / 2;
      if (items.some((q) => Math.hypot(cx - q.cx, cy - q.cy) < 0.5 * Math.max(rr, q.rr))) continue;
      items.push({ ...it, cx, cy, rr });
    }
  }
  return { items: items.map(({ cx, cy, rr, ...it }) => it), files: [big, ...mids.values()].filter(Boolean) };
}
const vlmName0 = vlmName || (/king/i.test(path.basename(SRC)) ? 'king' : /queen/i.test(path.basename(SRC)) ? 'queen' : path.basename(SRC).replace(/\.[^.]+$/, '').toLowerCase());
const vlm = vlmDir ? loadVlm(path.resolve(vlmDir), vlmName0) : null;
if (vlm && !vlm.items.length) throw new Error(`--vlm ${vlmDir}: không có ${vlmName0}-big*.json / ${vlmName0}-mid*-<i>.json`);
let r;
if (costume) {
  // trang phục: mọi điểm không phải nền (hoặc --mask) được dán kín; --big = JSON [{x, y, physMm, code}] viên to của KIT-12a
  const fgMask = regionMask || Uint8Array.from(excludeMask || new Uint8Array(img.w * img.h), (v) => 1 - v);
  r = mapCostume(img, { canvasMm: 300, cat, fgMask, color: opt.colorModel ? color : null, bigStones: bigFile ? JSON.parse(fs.readFileSync(bigFile, 'utf8')) : [], bigObjects: vlm?.items || null, ...opt });
} else r = mapStarry(img, { canvasMm: 300, cat, region, color: opt.noColorModel ? null : color, regionMask, excludeMask, ...opt });
const doc = normalizeDoc({ ...r.doc, source: { name: path.basename(SRC) + (img !== img0 ? ` (upscale ${img0.w}→${img.w})` : ''), widthPx: img.w, heightPx: img.h }, createdAt: new Date().toISOString(),
  stats: { stones: r.doc.stones.length, coveragePct: Math.round(r.coverage * 1000) / 10, codes: r.doc.palette.length } });
const check = checkDesign(doc, cat);
fs.writeFileSync(path.join(OUT, 'starry_v2.svg'), writeKitSvg(doc));

// BOM: ký hiệu · mã · loại · cỡ vật lý / vẽ · màu catalog · tên màu · số viên
const bom = doc.bom.map((b) => { const e = cat.codes[b.code]; return { symbol: b.symbol, code: b.code, kind: e.kind, physMm: e.physMm, refMm: e.refMm, hex: e.fill, family: e.family, name: e.name, count: b.count }; });
fs.writeFileSync(path.join(OUT, 'bom.json'), JSON.stringify(bom, null, 1) + '\n');
fs.writeFileSync(path.join(OUT, 'bom.csv'), ['symbol,code,kind,physical_mm,reference_mm,hex,family,name,count', ...bom.map((b) => [b.symbol, b.code, b.kind, b.physMm, b.refMm, b.hex, b.family, `"${String(b.name || '').replace(/"/g, '""')}"`, b.count].join(','))].join('\n') + '\n');

// Mockup: ảnh in (_3) + đá. Sạch: hạt ngọc cỡ vật lý (KIT-1 renderMap 'clean', chỉ đĩa, không lấp khe); ký hiệu: đĩa cỡ reference.
const pal = { codes: Object.fromEntries(doc.palette.map((p) => [p.code, { fill: p.rgb, edge: p.edge, text: p.text, fontPx: p.fontPx, symbol: p.symbol }])) };
const physOfCode = (c) => cat.codes[c].physMm;
const disc = { marginMm: 0, closeMm: 0 };
const mClean = over(img, renderMap({ px: img.w, stones: doc.stones.map((s) => ({ ...s, dMm: physOfCode(s.code) })) }, pal, { style: 'clean', ...disc }));
const mSym = over(img, renderMap({ px: img.w, stones: doc.stones }, pal, { style: 'symbols', ...disc }));
const field = stoneField({ px: img.w, stones: doc.stones.map((s) => ({ ...s, dMm: physOfCode(s.code) })) });
const reg = { w: img.w, h: img.h, data: Uint8Array.from(img.data) };
for (let j = 0; j < field.alpha.length; j++) { const a = field.alpha[j], f = 0.28 + 0.72 * a; for (let c = 0; c < 3; c++) reg.data[j * 4 + c] = Math.round(reg.data[j * 4 + c] * f); }
const files = {};
for (const [name, im] of [['mockup_clean', mClean], ['mockup_symbols', mSym], ['region', reg]]) files[name] = path.join(OUT, await io.write(path.join(OUT, name), im.w, im.h, im.data));
const ov = grid([img, reg, mClean, mSym].map((im) => shrinkOnWhite(im, 4)), 2);
files.overview = path.join(OUT, await io.write(path.join(OUT, 'overview'), ov.w, ov.h, ov.data));
files.svg = path.join(OUT, 'starry_v2.svg'); files.bom = path.join(OUT, 'bom.csv');
if (img !== img0) files.input = path.join(OUT, await io.write(path.join(OUT, 'input_upscaled'), img.w, img.h, img.data));

// ΔE00 mockup sạch vs ảnh (lưới 4 px): trên phần không phải nền, và riêng điểm có đá
const de = { fg: [0, 0], stones: [0, 0] };
for (let y = 2; y < img.h; y += 4) for (let x = 2; x < img.w; x += 4) {
  const j = y * img.w + x;
  if (excludeMask && excludeMask[j]) continue;
  const a = img.data.subarray(j * 4, j * 4 + 3), b = mClean.data.subarray(j * 4, j * 4 + 3), v = de2000(lab([...a]), lab([...b]));
  de.fg[0] += v; de.fg[1]++;
  if (field.alpha[j] > 0.5) { de.stones[0] += v; de.stones[1]++; }
}
// … và trên ô 3 mm (màu TB ô, ô ≥ 90 % không phải nền): so màu tổng thể, không phạt bóng hạt lệch tâm vài px
const blk = Math.round(3 * (img.w / 300));
let bs = 0, bn = 0;
for (let by = 0; by + blk <= img.h; by += blk) for (let bx = 0; bx + blk <= img.w; bx += blk) {
  const A = [0, 0, 0], B = [0, 0, 0];
  let n = 0, nb = 0;
  for (let y = by; y < by + blk; y++) for (let x = bx; x < bx + blk; x++) { const j = y * img.w + x; if (excludeMask && excludeMask[j]) { nb++; continue; } n++; for (let c = 0; c < 3; c++) { A[c] += img.data[j * 4 + c]; B[c] += mClean.data[j * 4 + c]; } }
  if (n < 0.9 * blk * blk) continue;
  bs += de2000(lab(A.map((v) => v / n)), lab(B.map((v) => v / n))); bn++;
}
// lật mã trên SVG xuất (và --compare <svg cũ> để so trước/sau), cùng định nghĩa: cạnh chạm, cùng cỡ vật lý + vật liệu theo mã
const flipDoc = { now: docFlip(doc.stones, cat, img, img.w / 300), ...(cmpSvg ? { compare: { file: cmpSvg, ...docFlip(readKitSvg(fs.readFileSync(cmpSvg, 'utf8')).stones, cat, img, img.w / 300) } } : {}) };
// mỗi vật VLM: số viên bản đồ có tâm trong vật → 1 = đúng, ≥ 2 = bị chẻ, 0 = trống. 'box' = định nghĩa KIT-13 eval (bán kính box/2
// quanh tâm box; box VLM ≈ 1.4–1.6 × vật nên đếm cả viền / hạt quanh vật); 'object' = bán kính min(box, trục ngắn DETECT)/2 quanh tâm vật
const objOf = new Map((r.big?.list || []).filter((b) => b.hint !== undefined).map((b) => [b.hint, b]));
const perObj = (items, stones, mode) => {
  const res = items.map((it, i) => { const [x0, y0, x1, y1] = [it.bbox[0] * img.w, it.bbox[1] * img.h, it.bbox[2] * img.w, it.bbox[3] * img.h], ob = mode === 'object' ? objOf.get(i) : null;
    const R = Math.min(x1 - x0, y1 - y0) / 2 * (ob ? Math.min(1, (ob.axesMm[1] * img.w) / 300 / Math.min(x1 - x0, y1 - y0)) : 1), cx = ob ? ob.x : (x0 + x1) / 2, cy = ob ? ob.y : (y0 + y1) / 2;
    const q = stones.filter((t) => Math.hypot(t.x - cx, t.y - cy) < R); return { tier: it.tier, n: q.length }; });
  const sum = (t) => { const z = res.filter((x) => !t || x.tier === t); return { items: z.length, one: z.filter((x) => x.n === 1).length, fragmented: z.filter((x) => x.n >= 2).length, empty: z.filter((x) => !x.n).length, stonesInside: z.reduce((a, x) => a + x.n, 0) }; };
  return { tier1: sum(1), tier2: sum(2) };
};
const cmpStones = cmpSvg ? (() => { const d = readKitSvg(fs.readFileSync(cmpSvg, 'utf8')), S = d.canvas.widthPx / img.w; return d.stones.map((t) => ({ ...t, x: t.x / S, y: t.y / S })); })() : null;
const vlmCheck = vlm ? { files: vlm.files, ...Object.fromEntries(['object', 'box'].map((m) => [m, { now: perObj(vlm.items, doc.stones, m), ...(cmpStones && { compare: perObj(vlm.items, cmpStones, m) }) }])) } : null;
// ký hiệu ngọc trai = cỡ đủ chữ số ("10", không phải "1")
const pearlSym = doc.palette.filter((p) => cat.codes[p.code]?.kind === 'pearl').map((p) => ({ code: p.code, symbol: p.symbol, ok: p.symbol === String(cat.codes[p.code].physMm) }));
const deltaE = { fg: +(de.fg[0] / Math.max(1, de.fg[1])).toFixed(2), stones: +(de.stones[0] / Math.max(1, de.stones[1])).toFixed(2), block3mm: +(bs / Math.max(1, bn)).toFixed(2) };

// Ảnh zoom: ảnh | mockup sạch | ký hiệu, ×2. --zoom 'x,y,mm;…' (px ảnh đã phóng); trang phục: mặc định 2 vùng mịn to nhất (đá quý/opal)
const ppm = img.w / 300, zooms = zoomArg ? zoomArg.split(';').map((z) => z.split(',').map(Number)) : (r.gems || []).slice().sort((a, b) => b.areaMm2 - a.areaMm2).slice(0, 2).map((b) => [b.x, b.y, Math.max(26, 2.4 * b.dEqMm)]);
for (const [i, [zx, zy, mm]] of zooms.entries()) {
  const S = Math.min(img.w, img.h, Math.round(mm * ppm)), x0 = Math.max(0, Math.min(img.w - S, Math.round(zx - S / 2))), y0 = Math.max(0, Math.min(img.h - S, Math.round(zy - S / 2)));
  const parts = [img, mClean, mSym].map((im) => crop(im, x0, y0, S, S)), z = 2, W = 3 * S * z + 16, H = S * z, out = new Uint8Array(W * H * 4).fill(255);
  parts.forEach((pt, k) => { for (let y = 0; y < H; y++) for (let x = 0; x < S * z; x++) { const sj = (Math.floor(y / z) * S + Math.floor(x / z)) * 4, dj = (y * W + k * (S * z + 8) + x) * 4; for (let c = 0; c < 3; c++) out[dj + c] = pt.data[sj + c]; out[dj + 3] = 255; } });
  files[`zoom_${i + 1}`] = path.join(OUT, await io.write(path.join(OUT, `zoom_${i + 1}`), W, H, out));
}

const sizes = {};
for (const s of doc.stones) { const d = physOfCode(s.code); sizes[d] = (sizes[d] || 0) + 1; }
const report = { mode: costume ? 'costume' : 'starry', upscaled: img !== img0 ? [img0.w, img.w] : null, deltaE00MockupVsImage: deltaE,
  flipDoc, vlm: vlmCheck, pearlSymbols: pearlSym, ...(r.big && { big: r.big }),
  ...(costume ? { materials: r.materials, from: r.from, flip: r.flip, rings: r.rings, gems: r.gems.map((b) => ({ x: Math.round(b.x), y: Math.round(b.y), areaMm2: +b.areaMm2.toFixed(1), dEqMm: +b.dEqMm.toFixed(1) })), dropped: r.dropped, lostNoCode: r.lost, coverageOutsideKeepOutPct: Math.round(r.coverageNoGems * 1000) / 10, fgAreaMm2: Math.round(r.fgAreaMm2) }
    : { anchoredPct: +r.anchoredPct.toFixed(1), regionAreaPct: +r.regionAreaPct.toFixed(1) }),
  source: SRC, ms: Date.now() - t0, regionFrom: costume ? (regionMask ? maskFile : 'foreground = not backgroundMask') : regionMask ? maskFile : { model: 'logistic', features: region.features, weights: region.w.map((v) => +v.toFixed(3)), trainAcc: +region.trainAcc.toFixed(3), trainAuc: +region.trainAuc.toFixed(3), pos: region.nPos, neg: region.nNeg, products: REAL },
  colorModel: { stones: color.n, meanDE76_imgVsCatalog: { identity: +color.fit.identityDE.toFixed(1), knnResidualLOO: +color.fit.knnDE.toFixed(1) } },
  detected: r.detected, regionTau: r.tau ?? null, stones: doc.stones.length, sizesPhysMm: sizes, codes: doc.palette.length,
  coveragePct: Math.round(r.coverage * 1000) / 10, meanCodeCostDE: +r.codeCost.toFixed(1),
  check: { ok: check.ok, overlaps: check.overlaps, errors: check.errors, warnings: check.warnings },
  offCatalog: doc.palette.filter((p) => !cat.codes[p.code]).length,
  rotatedPct: Math.round((1000 * doc.stones.filter((s) => s.rot).length) / doc.stones.length) / 10,
  geom: { starry_v2: r.geom, ...Object.fromEntries(REAL.map((p) => [p, realGeom(p)])) },
  bom, files,
};
fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 1) + '\n');
const g = report.geom;
console.log(`${outName || 'starry_v2'}: ${report.stones} viên (dò ${r.detected}), ${report.codes} mã, phủ ${report.coveragePct}%, checkDesign ${check.ok ? 'OK' : 'LỖI ' + check.errors.join('; ')}, chồng ${check.overlaps}, ngoài catalog ${report.offCatalog}, xoay ${report.rotatedPct}%, ${(report.ms / 1000).toFixed(1)}s`);
for (const [k, v] of Object.entries(g)) console.log(`  ${k}: nn1(2.8) p10/med/p90 ${v.nn1Main28.p10}/${v.nn1Main28.median}/${v.nn1Main28.p90} mm, khe med ${v.gapMedianMm}, n_touch TB ${v.nTouchMean} ${JSON.stringify(v.nTouchPct)}`);
console.log(`  lật mã (SVG) ${(100 * flipDoc.now.all).toFixed(1)}% / màu gần ${(100 * flipDoc.now.similar).toFixed(1)}%` + (flipDoc.compare ? `; SVG so sánh ${(100 * flipDoc.compare.all).toFixed(1)}% / ${(100 * flipDoc.compare.similar).toFixed(1)}%` : ''));
if (costume) console.log(`  lật mã ${(100 * r.flip.codeBefore).toFixed(1)}% → ${(100 * r.flip.codeAfter).toFixed(1)}% (${r.flip.edges} cạnh), lật cỡ ${(100 * r.flip.size.before).toFixed(1)}% → ${(100 * r.flip.size.after).toFixed(1)}%, vật liệu ${JSON.stringify(r.materials)}, nguồn ${JSON.stringify(r.from)}, vùng mịn ${r.gems.length}, ΔE00 ${JSON.stringify(deltaE)}`);
if (vlmCheck) for (const m of ['object', 'box']) for (const k of ['now', 'compare']) if (vlmCheck[m][k]) console.log(`  vật VLM ${m} (${k}): tầng 1 ${JSON.stringify(vlmCheck[m][k].tier1)} tầng 2 ${JSON.stringify(vlmCheck[m][k].tier2)}`);
if (r.big) console.log(`  viên to: ${r.big.placed}/${r.big.objects} vật (VLM ${r.big.fromVlm}/${r.big.vlmIn}), bỏ ${r.big.dropped}, cỡ ${JSON.stringify(r.big.sizes)}; ký hiệu ngọc ${pearlSym.map((p) => p.symbol + (p.ok ? '' : '✗')).join(' ')}`);
console.log('  sizes', JSON.stringify(sizes), 'BOM', bom.map((b) => `${b.symbol}=${b.code}×${b.count}`).join(' '));
console.log(Object.values(files).join('\n'));
