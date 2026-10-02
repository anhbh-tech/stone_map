// KIT-9: benchmark DETECT / PLACE hiện tại trên 2 sản phẩm thật (requirements/DATA/Output), đáp án = bảng stones
// của kit/db/kit.sqlite (dựng từ SVG đi kèm). Không gọi API, không nằm trong npm test.
//   node tools/bench_kit_real.mjs [snowman dachshund] [--modes detect,place,pet] [--opt '{"sensitivity":0.3}'] [--input orig|low|lanczos|esrgan]
// Ảnh vào = clean_image của bảng products (Snowman … 3.png, Dachshund 2.png), canvas = canvas_mm, gọi buildKit như
// /api/kit-lab/run (PLACE = lib/kit/place.js). Số liệu (ghi outputs/kit/bench_real.json):
//  - tâm đá: P/R/F1, khớp 1–1 tham lam theo khoảng cách khi lệch < 0.5 × đường kính VẬT LÝ của viên thật
//  - đúng size % (trên cặp khớp; cỡ ra là reference → đổi sang vật lý qua size_map)
//  - đúng mã % (trên cặp khớp): (a) cụm → mã thật đa số (cận trên của phân cụm màu),
//    (b) màu cụm → mã gần nhất (ΔE76 catalog_hex) trong BOM thật của sản phẩm, ưu tiên cùng size vật lý
//  - độ phủ vật lý Σ π(d_vật lý/2)² / diện tích như products.physical_coverage (painting canvas², ornament π/4·canvas²) (thật 29.6 % / 32.1 %)
//  - F1 vùng có đá vs vùng in: vùng = stoneField của KIT-1 (đĩa reference + closing 3 mm) cho cả ra lẫn thật
//  - KIT-17 ĐIỂM (một số): score = (F1 tâm + đúng mã (b) + đúng size) / 3, % — mode pet gán mã bom từng viên nên (b) = mã ra == mã thật
//  - mode pet (lib/kit/pet.js): LoG 2.8/4/5 mm + mã k-NN học từ stones của sản phẩm KHÁC (leave-one-product-out)
//  - --input: orig = ảnh sạch; low = thu ÷3 (≈ 3.9 px/mm, như ảnh 1254 px), low6 = ÷6; lanczos / esrgan (lanczos6 / esrgan6) = low phóng ×4 (lib/kit/upscale.js;
//    esrgan cache ở outputs/kit/kit17/cache/)
//  - KIT-19 --palette top:N | queen-starry [--max-new 2] (mode pet): ép bảng mã (fitPalette) — top:N = N mã nhiều viên nhất của BOM thật
//    (bảng chung đã biết, pet thêm ≤ max-new mã từ phần còn lại của BOM), queen-starry = bảng chung Queen + Starry (productPalette) ∩ BOM
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { buildKit, backgroundMask, regionMask } from '../lib/kit/detect.js';
import { petMap, codeModel, productPalette } from '../lib/kit/pet.js';
import { upscale4, boxDown } from '../lib/kit/upscale.js';
import { encodePng } from '../lib/png.js';
import { stoneField, hex } from '../lib/kit/render.js';
import { decodePng } from '../lib/png.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2), flag = (n) => { const i = args.indexOf(n); return i >= 0 ? args.splice(i, 2)[1] : null; };
const modes = (flag('--modes') || 'detect,place').split(','), opt = JSON.parse(flag('--opt') || '{}'), input = flag('--input') || 'orig';
const palSpec = flag('--palette'), maxNew = +(flag('--max-new') ?? 2);
if (palSpec) opt.palette = { spec: palSpec, maxNew };
const products = args.length ? args : ['snowman', 'dachshund'];
const REQ = process.env.KIT_REQ || path.join(process.cwd(), 'requirements');
const db = new DatabaseSync(path.join(ROOT, 'kit', 'db', 'kit.sqlite'), { readOnly: true });
const sizeMap = db.prepare('SELECT physical_mm, reference_mm FROM size_map').all();
const toPhysical = (ref) => sizeMap.find((s) => Math.abs(s.reference_mm - ref) < 1e-6)?.physical_mm ?? +(ref + 0.8).toFixed(1);
const pct = (v) => Math.round(v * 1000) / 10;

function lab([r, g, b]) {
  const lin = (v) => { v /= 255; return v > 0.04045 ? ((v + 0.055) / 1.055) ** 2.4 : v / 12.92; };
  const R = lin(r), G = lin(g), B = lin(b);
  const X = (0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047, Y = 0.2126 * R + 0.7152 * G + 0.0722 * B, Z = (0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883;
  const h = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * h(Y) - 16, 500 * (h(X) - h(Y)), 200 * (h(Y) - h(Z))];
}
const de76 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

// Khớp 1–1 tham lam: mọi cặp (ra, thật) lệch < 0.5·d_thật (px), xếp tăng dần theo khoảng cách.
export function matchCenters(pred, truth, pxPerMm, cell = 64) {
  const grid = new Map(), key = (x, y) => `${Math.floor(x / cell)},${Math.floor(y / cell)}`;
  truth.forEach((t, j) => { const k = key(t.x, t.y); (grid.get(k) || grid.set(k, []).get(k)).push(j); });
  const pairs = [];
  pred.forEach((p, i) => {
    const cx = Math.floor(p.x / cell), cy = Math.floor(p.y / cell);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) for (const j of grid.get(`${cx + dx},${cy + dy}`) || []) {
      const t = truth[j], d = Math.hypot(p.x - t.x, p.y - t.y);
      if (d < 0.5 * t.physMm * pxPerMm) pairs.push([d, i, j]);
    }
  });
  pairs.sort((a, b) => a[0] - b[0]);
  const usedP = new Uint8Array(pred.length), usedT = new Uint8Array(truth.length), out = [];
  for (const [d, i, j] of pairs) if (!usedP[i] && !usedT[j]) { usedP[i] = usedT[j] = 1; out.push({ i, j, d }); }
  return out;
}

function regionF1(pred, truth, px) {
  const a = stoneField({ px, stones: pred }).alpha, b = stoneField({ px, stones: truth }).alpha;
  let tp = 0, fp = 0, fn = 0;
  for (let j = 0; j < a.length; j++) { const p = a[j] >= 0.5, t = b[j] >= 0.5; if (p && t) tp++; else if (p) fp++; else if (t) fn++; }
  return { f1: pct((2 * tp) / (2 * tp + fp + fn)), precision: pct(tp / (tp + fp)), recall: pct(tp / (tp + fn)), predAreaPct: pct((tp + fp) / a.length), trueAreaPct: pct((tp + fn) / a.length) };
}

const REAL = ['snowman', 'dachshund'];
async function loadInput(P, kind) {
  const img = decodePng(fs.readFileSync(path.join(REQ, P.clean_image)));
  if (img.w !== P.viewbox_px) throw new Error(`${P.id}: ảnh ${img.w}px ≠ viewBox ${P.viewbox_px}`);
  if (kind === 'orig') return { img, method: 'orig' };
  const [, how, fs0] = /^(low|lanczos|esrgan)(\d*)$/.exec(kind) || [];
  if (!how) throw new Error(`--input lạ: ${kind}`);
  const low = boxDown(img, +fs0 || 3);
  if (how === 'low') return { img: low, method: kind };
  const cache = path.join(ROOT, 'outputs', 'kit', 'kit17', 'cache', `${P.id}_${kind}.png`);
  if (fs.existsSync(cache)) return { img: decodePng(fs.readFileSync(cache)), method: kind, cached: true };
  const r = await upscale4(low, { force: how === 'lanczos' ? 'lanczos' : undefined });
  if (r.method !== (how === 'esrgan' ? 'realesrgan' : how)) throw new Error(`${P.id}: muốn ${kind}, ra ${r.method} ${r.error || ''}`);
  fs.mkdirSync(path.dirname(cache), { recursive: true });
  fs.writeFileSync(cache, encodePng(r.img.w, r.img.h, r.img.data));
  return { img: r.img, method: kind, ms: r.ms };
}

export async function bench(pid, mode, o = opt, inputKind = input) {
  const P = db.prepare('SELECT * FROM products WHERE id = ?').get(pid);
  const truth = db.prepare('SELECT code, cx_px x, cy_px y, physical_mm physMm, reference_mm dMm FROM stones WHERE product = ?').all(pid);
  const bom = db.prepare('SELECT code, physical_mm, catalog_hex FROM bom WHERE product = ?').all(pid).map((b) => ({ ...b, lab: lab(hex(b.catalog_hex)) }));
  const { img } = await loadInput(P, inputKind);
  const t0 = Date.now();
  let pred, pal, perStone = false, palStats = null;
  if (mode === 'pet') {
    const bomP = bom.map((b) => ({ code: b.code, physMm: b.physical_mm, lab: b.lab }));
    let palette = o.palette;
    if (palette?.spec) { // o.palette.spec → codes theo sản phẩm
      const [k, n] = palette.spec.split(':'), top = db.prepare('SELECT code FROM bom WHERE product = ? ORDER BY count DESC, code').all(pid).map((b) => b.code);
      palette = { codes: k === 'top' ? top.slice(0, +n) : k === 'queen-starry' ? productPalette().codes : palette.spec.split(','), maxNew: palette.maxNew };
    }
    const r = petMap(img, { canvasWmm: P.canvas_mm, mask: regionMask(img, {}, backgroundMask(img)), model: codeModel(REAL.filter((q) => q !== pid)), bom: bomP, ...o, palette });
    palStats = r.work.palette || null;
    const s = P.viewbox_px / img.w;
    pred = r.stones.map((st) => ({ x: st.x * s, y: st.y * s, dMm: st.dMm, physMm: st.physMm, code: st.code }));
    perStone = true;
  } else {
    const placeMod = mode === 'place' ? await import('../lib/kit/place.js') : null;
    const doc = await buildKit(img, { mode, canvasWmm: P.canvas_mm, ...o }, { placeMod });
    // buildKit dùng 11.81 px/mm; sản phẩm dachshund 2894 px / 245 mm = 11.8122 → đổi về px SVG thật.
    const s = P.viewbox_px / doc.canvas.widthPx;
    pal = new Map(doc.palette.map((c) => [c.code, c]));
    pred = doc.stones.map((st) => ({ x: st.x * s, y: st.y * s, dMm: st.dMm, physMm: toPhysical(st.dMm), code: st.code }));
  }
  const ms = Date.now() - t0;
  const m = matchCenters(pred, truth, P.px_per_mm);
  const tp = m.length, precision = tp / pred.length, recall = tp / truth.length;
  const sizeOk = m.filter(({ i, j }) => Math.abs(pred[i].physMm - truth[j].physMm) < 1e-6).length;
  const size28 = m.filter(({ j }) => truth[j].physMm === 2.8).length; // mốc: đoán toàn 2.8 mm
  // (a) cụm → mã đa số
  const votes = new Map();
  for (const { i, j } of m) { const v = votes.get(pred[i].code) || votes.set(pred[i].code, new Map()).get(pred[i].code); v.set(truth[j].code, (v.get(truth[j].code) || 0) + 1); }
  const codeMajority = [...votes.values()].reduce((acc, v) => acc + Math.max(...v.values()), 0);
  // (b) màu cụm → mã BOM gần nhất (ưu tiên cùng size vật lý)
  const nearest = new Map();
  const codeOf = (p) => {
    const k = `${p.code}|${p.physMm}`;
    if (!nearest.has(k)) {
      const L = lab(hex(pal.get(p.code).rgb)), same = bom.filter((b) => Math.abs(b.physical_mm - p.physMm) < 1e-6), pool = same.length ? same : bom;
      nearest.set(k, pool.reduce((best, b) => (de76(L, b.lab) < de76(L, best.lab) ? b : best)).code);
    }
    return nearest.get(k);
  };
  const codeNearest = m.filter(({ i, j }) => (perStone ? pred[i].code : codeOf(pred[i])) === truth[j].code).length;
  // mẫu số = diện tích theo định nghĩa products.physical_coverage (painting: canvas²; ornament tròn: π/4·canvas²)
  const physArea = (arr) => arr.reduce((a, t) => a + Math.PI * (t.physMm / 2) ** 2, 0);
  const printMm2 = physArea(truth) / P.physical_coverage;
  const cov = (arr) => physArea(arr) / printMm2;
  const sizes = (arr) => Object.fromEntries([...arr.reduce((mm, t) => mm.set(t.physMm, (mm.get(t.physMm) || 0) + 1), new Map())].sort((a, b) => a[0] - b[0]));
  const f1 = (2 * precision * recall) / (precision + recall || 1), score = pct((f1 + codeNearest / (tp || 1) + sizeOk / (tp || 1)) / 3);
  return {
    product: pid, mode, input: inputKind, score, ms, predStones: pred.length, trueStones: truth.length, matched: tp,
    centers: { precision: pct(precision), recall: pct(recall), f1: pct(f1), meanOffsetMm: +(m.reduce((a, x) => a + x.d, 0) / (tp || 1) / P.px_per_mm).toFixed(3) },
    sizeOkPct: pct(sizeOk / (tp || 1)), sizeAll28Pct: pct(size28 / (tp || 1)), codeOkPct: { clusterMajority: pct(codeMajority / (tp || 1)), nearestBomColor: pct(codeNearest / (tp || 1)) },
    predCodes: new Set(pred.map((p) => p.code)).size, trueCodes: bom.length,
    coveragePct: { pred: pct(cov(pred)), true: pct(cov(truth)), printAreaMm2: Math.round(printMm2) },
    region: regionF1(pred, truth, P.viewbox_px),
    ...(palStats && { palette: palStats }),
    sizes: { pred: sizes(pred), true: sizes(truth) },
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const out = [];
  for (const mode of modes) for (const pid of products) {
    const r = await bench(pid, mode);
    out.push(r);
    console.log(`${pid} ${mode} [${r.input}] ĐIỂM ${r.score}${r.palette ? ` (bảng ${r.palette.base.length}+${r.palette.added.join(',') || '0'}, ΔE ${r.palette.deFree}→${r.palette.deForced})` : ''}: ${r.predStones}/${r.trueStones} viên, tâm P ${r.centers.precision} R ${r.centers.recall} F1 ${r.centers.f1} (lệch ${r.centers.meanOffsetMm}mm), size ${r.sizeOkPct}% (mốc toàn 2.8: ${r.sizeAll28Pct}%), mã ${r.codeOkPct.clusterMajority}/${r.codeOkPct.nearestBomColor}%, phủ ${r.coveragePct.pred}% (thật ${r.coveragePct.true}%), vùng F1 ${r.region.f1}, ${(r.ms / 1000).toFixed(1)}s`);
  }
  for (const mode of modes) { const rs = out.filter((r) => r.mode === mode); console.log(`ĐIỂM ${mode} [${input}] = ${(rs.reduce((a, r) => a + r.score, 0) / rs.length).toFixed(1)} (TB ${rs.map((r) => r.product).join(' + ')})`); }
  const file = path.join(ROOT, 'outputs', 'kit', 'bench_real.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ opt, results: out }, null, 1) + '\n');
  console.log(`ghi ${file}`);
}
