// KIT-11: map theo spec sản xuất (partial drill) cho 1 ảnh đã có hạt (vd nền Starry _3), học từ kit/db/kit.sqlite:
//  1. chọn vùng dán đá vs vùng in: hồi quy logistic trên đặc trưng ảnh (đĩa 2.8 mm + ngữ cảnh 3/8 mm) tại tâm viên của bảng stones
//     (dương) và điểm vùng in của 2 sản phẩm thật (âm); điểm trên lưới 1 mm, mượt Gauss → ngưỡng theo phân vị tới độ phủ vật lý
//     mục tiêu; params.regionMask (KIT-10) thay được bước này
//  2. tâm đá = hạt DETECT (lib/kit/detect.js detectBeads, cỡ vật lý của catalog) trong vùng; chạm → cỡ nhỏ hơn / xê dịch ≤ 0.6 mm;
//     lấp khe trong vùng bằng viên chính (khe 0.15 mm như dachshund)
//  3. màu → mã: Lab ảnh + k-NN phần dư (catalog − ảnh) từ bảng stones, rồi chọn ≤ maxCodes mã catalog tròn (tham lam, ΔE00)
//  4. doc dạng chuẩn svgio (cỡ vẽ = reference, data-group theo vật lý, màu = catalog) → checkDesign.
// Đặc trưng 1 điểm (như tools/build_kit_db.py): đĩa bán kính round(0.35·d_vật lý·px/mm): RGB trung bình, độ lệch chuẩn xám,
// bão hoà HSV trung bình (0..255), xám p98.
// KIT-12b mapCostume (trang phục dán kín, cuối file): vật liệu + cỡ trước (ngọc trai / đá giác Q / vàng / nền; Potts trên đồ thị
// láng giềng DETECT), đá quý mịn to = vùng cấm (smoothBlobs, bao lồi + viền gemGrowMm), vòng hạt quanh đá quý = 1 cỡ + 1 mã (gemRing:
// đếm đỉnh sáng trên đường tâm vòng), lấp lục giác + tiếp tuyến khe 0.15 mm, chọn mã trong lớp vật liệu (vàng phạt mã tối hơn ảnh),
// rồi mượt nhãn Potts (ICM, trọng số cạnh exp(−ΔE00²/2σ²)); o.bigStones = chỗ nhận viên to cố định mã của KIT-12a.
import { createRequire } from 'node:module';
import { DB_FILE, loadCatalog, groupOf, groupOfEntry, entryOf, assignSymbols } from './catalog.js';
import { isShaped, gapMm, stonePoly, sdPoly } from './shapes.js';
import { detectBeads, refOf as refOfDet, gauss, PEARL_MM } from './detect.js';
import { edt2 } from './render.js';
import { de2000 } from './place.js';
import { densify } from './pack.js';

const clampI = (v, a, b) => (v < a ? a : v > b ? b : v);
export const hex2 = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

export function lab([r, g, b]) {
  const lin = (v) => { v /= 255; return v > 0.04045 ? ((v + 0.055) / 1.055) ** 2.4 : v / 12.92; };
  const R = lin(r), G = lin(g), B = lin(b);
  const X = (0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047, Y = 0.2126 * R + 0.7152 * G + 0.0722 * B, Z = (0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883;
  const h = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * h(Y) - 16, 500 * (h(X) - h(Y)), 200 * (h(Y) - h(Z))];
}
const d2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;

// → { rgb, std, sat, peak } hoặc null (đĩa rỗng / ngoài alpha)
export function discFeatures(img, cx, cy, physMm, ppm) {
  const rad = Math.max(1, Math.round(0.35 * physMm * ppm)), x0 = Math.round(cx), y0 = Math.round(cy);
  const grays = [], sum = [0, 0, 0];
  let sat = 0;
  for (let y = Math.max(0, y0 - rad); y <= Math.min(img.h - 1, y0 + rad); y++) for (let x = Math.max(0, x0 - rad); x <= Math.min(img.w - 1, x0 + rad); x++) {
    if ((x - x0) ** 2 + (y - y0) ** 2 > rad * rad) continue;
    const j = (y * img.w + x) * 4, r = img.data[j], g = img.data[j + 1], b = img.data[j + 2];
    if (img.data[j + 3] < 128) return null;
    sum[0] += r; sum[1] += g; sum[2] += b;
    grays.push(Math.round(0.299 * r + 0.587 * g + 0.114 * b));
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    sat += mx ? Math.round((255 * (mx - mn)) / mx) : 0;
  }
  const n = grays.length;
  if (!n) return null;
  const mean = grays.reduce((a, v) => a + v, 0) / n, std = Math.sqrt(grays.reduce((a, v) => a + (v - mean) ** 2, 0) / n);
  grays.sort((a, b) => a - b);
  const pos = 0.98 * (n - 1), lo = Math.floor(pos), peak = grays[lo] + (grays[Math.min(n - 1, lo + 1)] - grays[lo]) * (pos - lo);
  return { rgb: sum.map((v) => Math.round(v / n)), std, sat: sat / n, peak };
}

let dbCache;
function openDb(file = DB_FILE) {
  if (dbCache?.file === file) return dbCache.db;
  const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite');
  dbCache = { file, db: new DatabaseSync(file, { readOnly: true }) };
  return dbCache.db;
}
export const REAL = ['snowman', 'dachshund'];
// Thống kê hộp vuông bán kính r quanh (x, y) qua ảnh tích phân: [xám TB, độ lệch xám, S (HSV) TB].
export function boxStats(img) {
  const W = img.w + 1, G = new Float64Array(W * (img.h + 1)), G2 = new Float64Array(G.length), S = new Float64Array(G.length);
  for (let y = 0; y < img.h; y++) {
    let a = 0, b = 0, c = 0;
    for (let x = 0; x < img.w; x++) {
      const j = (y * img.w + x) * 4, r = img.data[j], g = img.data[j + 1], bl = img.data[j + 2], gr = 0.299 * r + 0.587 * g + 0.114 * bl;
      const mx = Math.max(r, g, bl), mn = Math.min(r, g, bl);
      a += gr; b += gr * gr; c += mx ? (255 * (mx - mn)) / mx : 0;
      const k = (y + 1) * W + x + 1;
      G[k] = G[k - W] + a; G2[k] = G2[k - W] + b; S[k] = S[k - W] + c;
    }
  }
  return (x, y, r) => {
    const x0 = clampI(Math.round(x - r), 0, img.w), x1 = clampI(Math.round(x + r), 0, img.w), y0 = clampI(Math.round(y - r), 0, img.h), y1 = clampI(Math.round(y + r), 0, img.h);
    const n = Math.max(1, (x1 - x0) * (y1 - y0)), sum = (A) => (A[y1 * W + x1] - A[y0 * W + x1] - A[y1 * W + x0] + A[y0 * W + x0]) / n;
    const m = sum(G);
    return [m, Math.sqrt(Math.max(0, sum(G2) - m * m)), sum(S)];
  };
}
// Vector vùng tại 1 điểm: đĩa 2.8 mm (như bảng stones) + ngữ cảnh 3 / 8 mm (độ lệch xám, sáng hơn xung quanh, đốm sáng so với nền).
export function regionVec(img, box, x, y, ppm) {
  const f = discFeatures(img, x, y, 2.8, ppm);
  if (!f) return null;
  const A = box(x, y, 3 * ppm), B = box(x, y, 8 * ppm);
  return [lab(f.rgb)[0], f.std, f.sat, f.peak, A[1], B[1], A[0] - B[0], f.peak - B[0]];
}


// ── 1. Vùng dán đá. Dương = đặc trưng tại tâm từng viên của 2 sản phẩm thật (bảng stones). Âm = điểm lưới 2 mm của
// ảnh sạch cách mép viên gần nhất > 1.5 mm (vùng in), đĩa như viên 2.8 mm. decode(file) → RGBA; reqDir = requirements/.
export function trainRegion({ reqDir, decode, dbFile, stepMm = 2, clearMm = 1.5, seed = 1 } = {}) {
  const db = openDb(dbFile), pos = [], neg = [];
  for (const pid of REAL) {
    const P = db.prepare('SELECT * FROM products WHERE id = ?').get(pid), ppm = P.px_per_mm;
    const st = db.prepare('SELECT cx_px x, cy_px y, physical_mm d, img_mean_hex h, img_std std, img_sat sat, img_peak peak FROM stones WHERE product = ?').all(pid);
    const img = decode(`${reqDir}/${P.clean_image}`), box = boxStats(img), cell = 8 * ppm, grid = new Map();
    for (const s of st) { const v = regionVec(img, box, s.x, s.y, ppm); if (v) pos.push(v); }
    st.forEach((s) => { const k = `${Math.floor(s.x / cell)},${Math.floor(s.y / cell)}`; (grid.get(k) || grid.set(k, []).get(k)).push(s); });
    const step = stepMm * ppm;
    for (let y = step / 2; y < img.h; y += step) for (let x = step / 2; x < img.w; x += step) {
      let clear = true;
      const gx = Math.floor(x / cell), gy = Math.floor(y / cell);
      for (let dy = -1; dy <= 1 && clear; dy++) for (let dx = -1; dx <= 1 && clear; dx++)
        for (const s of grid.get(`${gx + dx},${gy + dy}`) || []) if (Math.hypot(s.x - x, s.y - y) / ppm - s.d / 2 < clearMm) { clear = false; break; }
      if (!clear) continue;
      const v = regionVec(img, box, x, y, ppm);
      if (v) neg.push(v);
    }
  }
  // cân bằng 2 lớp (lấy mẫu đều, tất định)
  let r = seed;
  const rnd = () => ((r = (r * 1103515245 + 12345) % 2147483648) / 2147483648);
  const big = pos.length > neg.length ? pos : neg, small = big === pos ? neg : pos;
  while (big.length > small.length) big.splice(Math.floor(rnd() * big.length), 1);
  // Hồi quy logistic trên đặc trưng chuyển được giữa các tranh (độ sáng, lấp lánh, bão hoà, đốm sáng + ngữ cảnh 3/8 mm): bỏ sắc độ a/b vì
  // màu vùng đá của người tuyết / chó không nói gì về bầu trời sao (k-NN theo màu chọn ngược: trời xanh thành đá, sao thành in).
  const all = [...pos, ...neg], D = all[0].length;
  const mu = Array.from({ length: D }, (_, i) => all.reduce((a, v) => a + v[i], 0) / all.length);
  const sd = Array.from({ length: D }, (_, i) => Math.sqrt(all.reduce((a, v) => a + (v[i] - mu[i]) ** 2, 0) / all.length) || 1);
  const X = all.map((v) => v.map((x, i) => (x - mu[i]) / sd[i])), Y = [...pos.map(() => 1), ...neg.map(() => 0)];
  const w = new Array(D + 1).fill(0);
  for (let it = 0; it < 800; it++) {
    const g = new Array(D + 1).fill(0);
    X.forEach((x, n) => { const e = 1 / (1 + Math.exp(-(w[D] + x.reduce((a, v, i) => a + v * w[i], 0)))) - Y[n]; x.forEach((v, i) => { g[i] += e * v; }); g[D] += e; });
    for (let i = 0; i <= D; i++) w[i] -= (0.5 * g[i]) / X.length;
  }
  let correct = 0, rankPos = 0;
  const z = X.map((x) => w[D] + x.reduce((a, v, i) => a + v * w[i], 0));
  z.forEach((t, n) => { if ((t > 0) === (Y[n] === 1)) correct++; });
  z.map((t, n) => [t, Y[n]]).sort((a, b) => a[0] - b[0]).forEach(([, y], i) => { if (y) rankPos += i + 1; });
  const auc = (rankPos - (pos.length * (pos.length + 1)) / 2) / (pos.length * neg.length);
  return { features: FEATURE_NAMES, mu, sd, w, trainAcc: correct / X.length, trainAuc: auc, nPos: pos.length, nNeg: neg.length };
}
export const FEATURE_NAMES = ['L', 'std', 'sat', 'peak', 'std3', 'std8', 'Lcontrast8', 'peakOver8'];

// Xác suất "dán đá" của 1 điểm theo mô hình logistic.
export function regionScore(model, v) {
  const D = model.features.length;
  let t = model.w[D];
  for (let i = 0; i < D; i++) t += ((v[i] - model.mu[i]) / model.sd[i]) * model.w[i];
  return 1 / (1 + Math.exp(-t));
}

// ── 3. Màu ảnh → Lab catalog: màu ảnh + phần dư (catalog − ảnh) trung bình của k láng giềng màu gần nhất trong bảng stones,
// trọng số Gauss theo ΔE (tau) và co về 0 khi ít láng giềng gần — màu không có trong dữ liệu (xanh đêm) giữ gần màu ảnh.
export function trainColor({ dbFile } = {}) {
  const db = openDb(dbFile);
  const rows = db.prepare(`SELECT img_mean_hex h, catalog_hex c, physical_mm d, code FROM stones WHERE product IN (${REAL.map(() => '?').join(',')}) AND catalog_hex IS NOT NULL`).all(...REAL);
  const pts = rows.map((r) => { const l = lab(hex2(r.h)), c = lab(hex2(r.c)); return { lab: l, cat: c, res: c.map((v, i) => v - l[i]), code: r.code, phys: r.d }; });
  const model = { pts, n: rows.length };
  // sai số trên chính dữ liệu, bỏ chính nó (leave-one-out), lấy mẫu 1/5
  let e0 = 0, e1 = 0, m = 0;
  for (let i = 0; i < pts.length; i += 5) { const p = pts[i]; e0 += Math.sqrt(d2(p.lab, p.cat)); e1 += Math.sqrt(d2(predictLab(model, p.lab, { skip: p }), p.cat)); m++; }
  model.fit = { identityDE: e0 / m, knnDE: e1 / m };
  return model;
}
export function predictLab(model, l, { k = 12, tau = 10, skip = null } = {}) {
  const near = [];
  for (const q of model.pts) {
    if (q === skip) continue;
    const d = Math.sqrt(d2(q.lab, l));
    if (near.length < k || d < near[near.length - 1][0]) { near.push([d, q]); near.sort((a, b) => a[0] - b[0]); if (near.length > k) near.pop(); }
  }
  let w = 0;
  const res = [0, 0, 0];
  for (const [d, q] of near) { const wi = Math.exp(-((d / tau) ** 2)); w += wi; for (let c = 0; c < 3; c++) res[c] += wi * q.res[c]; }
  return l.map((v, c) => v + res[c] / (w + 1));
}

// Chọn ≤ maxCodes mã catalog tròn cho các viên {target: Lab, physMm}: tham lam (mỗi bước thêm mã giảm tổng chi phí nhiều nhất).
// Chi phí viên ← mã c = ΔE00 (metric 'de76' = ΔE76)(target, catalog c) + downPenalty nếu c nhỏ hơn cỡ viên (viên được thu về cỡ c; không bao giờ to ra).
// shrink(s, e) (KIT-16): phạt thêm (số) khi viên s dùng mã e nhỏ hơn ngoài lớp của nó, Infinity = không; để ngân sách mã thiếu
// thì lớp ít viên (vd vàng 4 mm) thu về mã nhỏ có sẵn thay vì chiếm chỗ của màu chính (trắng 2.8)
// prefer (Set mã) + preferDE: mã của lớp khác cùng sản phẩm (vd trang phục) rẻ hơn preferDE ΔE00 khi chọn → dùng chung khi gần màu
// pool (Set mã, KIT-18 bảng mã chung sản phẩm): chỉ chọn trong pool (gồm cả mã hình trong pool)
export function chooseCodes(stones, cat, { maxCodes = 10, downPenalty = 8, minGain = 0.15, metric = 'de00', allowed = null, distOf = null, force = [], shrink = null, prefer = null, preferDE = 0, pool = null } = {}) {
  const dE0 = metric === 'de76' ? (a, b) => Math.sqrt(d2(a, b)) : de2000;
  const shapedIn = [...new Set([...force, ...(pool || [])])].map((c) => (cat.codes[c] ? null : cat.shaped?.[c])).filter(Boolean);
  const cands = [...Object.values(cat.codes), ...shapedIn].filter((e) => !pool || pool.has(e.code)).map((e) => ({ e, lab: lab(hex2(e.fill)) }));
  const UNCOV = 1e3, cur = new Float64Array(stones.length).fill(UNCOV), pick = new Array(stones.length).fill(null), chosen = [];
  const dE = (s, l) => (distOf ? distOf(s) : dE0)(s.target, l);
  const cost = (s, c) => (prefer?.has(c.e.code) ? -preferDE : 0) + (allowed ? (allowed(s, c.e) ? dE(s, c.lab) : shrink ? dE(s, c.lab) + shrink(s, c.e) : Infinity) : c.e.physMm > s.physMm + 1e-6 ? Infinity : dE(s, c.lab) + (c.e.physMm < s.physMm - 1e-6 ? downPenalty : 0));
  for (const code of force) { // mã bắt buộc (viên to đã chọn mã): vào trước, tính vào maxCodes
    const c = cands.find((q) => q.e.code === code); if (!c || chosen.includes(c)) continue;
    chosen.push(c);
    for (let i = 0; i < stones.length; i++) { const v = cost(stones[i], c); if (v < cur[i]) { cur[i] = v; pick[i] = c.e; } }
  }
  while (chosen.length < maxCodes) {
    let best = null, bestGain = 0;
    for (const c of cands) {
      if (chosen.includes(c)) continue;
      let gain = 0;
      for (let i = 0; i < stones.length; i++) { const v = cost(stones[i], c); if (v < cur[i]) gain += cur[i] - v; }
      if (gain > bestGain) { bestGain = gain; best = c; }
    }
    if (!best || (chosen.length && cur.every((v) => v < UNCOV) && bestGain < minGain * stones.length)) break;
    chosen.push(best);
    for (let i = 0; i < stones.length; i++) { const v = cost(stones[i], best); if (v < cur[i]) { cur[i] = v; pick[i] = best.e; } }
  }
  return { codes: chosen.map((c) => c.e.code), pick, meanCost: cur.reduce((a, v) => a + v, 0) / stones.length };
}


// Hướng nét (structure tensor, cửa sổ Gauss σ px) tại các tâm → góc xoay chữ (độ, (−90, 90]); nét yếu (coherence < cMin) → 0.
export function flowAngles(img, pts, sigmaPx, cMin = 0.25) {
  const R = Math.ceil(2 * sigmaPx), g = (x, y) => { const j = (clampI(y, 0, img.h - 1) * img.w + clampI(x, 0, img.w - 1)) * 4; return 0.299 * img.data[j] + 0.587 * img.data[j + 1] + 0.114 * img.data[j + 2]; };
  return pts.map((p) => {
    let jxx = 0, jyy = 0, jxy = 0;
    const x0 = Math.round(p.x), y0 = Math.round(p.y);
    for (let dy = -R; dy <= R; dy += 2) for (let dx = -R; dx <= R; dx += 2) {
      const w = Math.exp(-(dx * dx + dy * dy) / (2 * sigmaPx * sigmaPx)), x = x0 + dx, y = y0 + dy;
      const gx = g(x + 1, y) - g(x - 1, y), gy = g(x, y + 1) - g(x, y - 1);
      jxx += w * gx * gx; jyy += w * gy * gy; jxy += w * gx * gy;
    }
    const coh = Math.sqrt((jxx - jyy) ** 2 + 4 * jxy * jxy) / (jxx + jyy + 1e-9);
    if (coh < cMin) return 0;
    let a = (0.5 * Math.atan2(2 * jxy, jxx - jyy) * 180) / Math.PI + 90; // pháp tuyến gradient + 90° = hướng nét
    if (a > 90) a -= 180;
    return Math.round(a * 1e4) / 1e4;
  });
}

// Thống kê hình học như bảng stones: nn1_mm (tâm–tâm gần nhất), n_touch (số viên khe vật lý < 0.6 mm).
export function geomStats(stones, ppm) {
  const cell = 12 * ppm, grid = new Map();
  stones.forEach((s, i) => { const k = `${Math.floor(s.x / cell)},${Math.floor(s.y / cell)}`; (grid.get(k) || grid.set(k, []).get(k)).push(i); });
  return stones.map((s, i) => {
    let nn = Infinity, touch = 0, gapMin = Infinity;
    const gx = Math.floor(s.x / cell), gy = Math.floor(s.y / cell);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) for (const j of grid.get(`${gx + dx},${gy + dy}`) || []) {
      if (j === i) continue;
      const t = stones[j], d = Math.hypot(s.x - t.x, s.y - t.y) / ppm, gap = d - (s.physMm + t.physMm) / 2;
      nn = Math.min(nn, d); gapMin = Math.min(gapMin, gap); if (gap < 0.6) touch++;
    }
    return { nn1: nn, gap: gapMin, touch, physMm: s.physMm };
  });
}
export function summarizeGeom(g) {
  const q = (a, p) => (a.length ? a[Math.min(a.length - 1, Math.floor(p * a.length))] : null), r2 = (v) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 100) / 100);
  const main = g.filter((s) => s.physMm === 2.8).map((s) => s.nn1).sort((a, b) => a - b), gaps = g.map((s) => s.gap).sort((a, b) => a - b);
  const hist = [0, 0, 0, 0, 0];
  for (const s of g) hist[Math.min(4, s.touch)]++;
  return {
    n: g.length, nn1Main28: { p10: r2(q(main, 0.1)), median: r2(q(main, 0.5)), p90: r2(q(main, 0.9)) }, gapMedianMm: r2(q(gaps, 0.5)),
    nTouchPct: Object.fromEntries(['0', '1', '2', '3', '>=4'].map((k, i) => [k, Math.round((1000 * hist[i]) / (g.length || 1)) / 10])),
    nTouchMean: r2(g.reduce((a, s) => a + s.touch, 0) / (g.length || 1)),
  };
}
// Cùng thống kê cho sản phẩm thật (đọc thẳng cột nn1_mm / n_touch của bảng stones).
export function realGeom(pid, dbFile) {
  const rows = openDb(dbFile).prepare('SELECT nn1_mm nn1, nn1_gap_mm gap, n_touch touch, physical_mm physMm FROM stones WHERE product = ?').all(pid);
  return summarizeGeom(rows);
}

// ── Cả quy trình. img = RGBA (px = px bản đồ, vuông theo canvasMm). o: { canvasMm, ppm, coverage: [lo, hi], target, maxCodes,
//   regionMask (Uint8Array img.w·img.h, KIT-10; có thì bỏ qua bước 1), region (model trainRegion), color (model trainColor),
//   detect: params cho detectBeads, sizes (cỡ vật lý cho phép), smoothMm }
// Gauss tách được trên lưới (sigma theo ô), tại chỗ.
function blurGrid(a, w, h, sigma) {
  const r = Math.ceil(3 * sigma), k = Array.from({ length: 2 * r + 1 }, (_, i) => Math.exp(-((i - r) ** 2) / (2 * sigma * sigma)));
  const tmp = new Float32Array(a.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let v = 0, s = 0; for (let i = -r; i <= r; i++) { const xx = x + i; if (xx < 0 || xx >= w) continue; v += k[i + r] * a[y * w + xx]; s += k[i + r]; } tmp[y * w + x] = v / s; }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let v = 0, s = 0; for (let i = -r; i <= r; i++) { const yy = y + i; if (yy < 0 || yy >= h) continue; v += k[i + r] * tmp[yy * w + x]; s += k[i + r]; } a[y * w + x] = v / s; }
}

// Xếp đá không chồng (cỡ vật lý, khe ≥ minGapMm): hạt theo điểm DETECT giảm dần; chạm → thử cỡ nhỏ hơn, rồi xê dịch tới nudgeMm (8 hướng,
// bước 0.2 mm). fill: lấp khe trong vùng inside(x, y) bằng viên cỡ chính đặt tiếp xúc (khe fillGapMm) quanh viên đã có, 24 hướng.
// Mỗi viên ghi from = 'detect' | 'nudge' | 'fill'.
export function packStones(cands, inside, sizes, ppm, { nudgeMm = 0.6, minGapMm = 0, fillGapMm = 0.05, fill = true, w = Infinity, h = Infinity } = {}) {
  const main = Math.min(...sizes), cell = Math.max(...sizes) * ppm, grid = new Map(), out = [];
  const fits = (x, y, d) => {
    if (x < (d / 2) * ppm || y < (d / 2) * ppm || x > w - (d / 2) * ppm || y > h - (d / 2) * ppm) return false;
    const gx = Math.floor(x / cell), gy = Math.floor(y / cell);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) for (const t of grid.get(`${gx + dx},${gy + dy}`) || [])
      if (Math.hypot(t.x - x, t.y - y) / ppm - (t.physMm + d) / 2 < minGapMm) return false;
    return true;
  };
  const add = (t) => { out.push(t); const k = `${Math.floor(t.x / cell)},${Math.floor(t.y / cell)}`; (grid.get(k) || grid.set(k, []).get(k)).push(t); };
  const desc = [...sizes].sort((a, b) => b - a);
  for (const s of [...cands].sort((a, b) => b.score - a.score)) {
    const d = desc.filter((v) => v <= s.physMm + 1e-6).find((v) => fits(s.x, s.y, v));
    if (d != null) { add({ ...s, physMm: d, from: 'detect' }); continue; }
    let done = false;
    for (let r = 0.2; r <= nudgeMm + 1e-6 && !done; r += 0.2) for (let a = 0; a < 8 && !done; a++) {
      const x = s.x + Math.cos((a * Math.PI) / 4) * r * ppm, y = s.y + Math.sin((a * Math.PI) / 4) * r * ppm;
      if (inside(x, y) && fits(x, y, main)) { add({ ...s, x, y, physMm: main, from: 'nudge' }); done = true; }
    }
  }
  if (fill) for (let i = 0; i < out.length; i++) {
    const s = out[i], dist = ((s.physMm + main) / 2 + fillGapMm) * ppm;
    for (let a = 0; a < 24; a++) {
      const x = s.x + Math.cos((a * Math.PI) / 12) * dist, y = s.y + Math.sin((a * Math.PI) / 12) * dist;
      if (inside(x, y) && fits(x, y, main)) add({ x, y, physMm: main, score: 0, from: 'fill' });
    }
  }
  return out;
}

// placed [{x, y, code}] → doc dạng chuẩn svgio: ký hiệu theo thiết kế, cỡ vẽ = reference, group/layer theo cỡ vật lý, xoay theo nét.
export function buildDoc(img, placed, cat, ppm, canvasMm, params) {
  const rot = flowAngles(img, placed, 1.5 * ppm);
  const counts = new Map();
  for (const s of placed) counts.set(s.code, (counts.get(s.code) || 0) + 1);
  const sym = assignSymbols(counts, cat);
  const E = (code) => entryOf(code, cat);
  const palette = [...counts.keys()].map((code) => { const e = E(code); return { code, symbol: sym[code], rgb: e.fill, dMm: e.refMm, edge: e.edge, text: e.text, fontPx: e.fontPx }; });
  const pitch = 3 * ppm, layerOf = (e) => (e.shape ? `${e.shape.toUpperCase()}_${e.physW}x${e.physH}` : `S${e.physMm}`);
  // viên có hình (KIT-14): rot = góc trục dài (không theo hướng nét), cỡ vẽ wMm × hMm reference
  const stones = placed.map((s, i) => ({ ...s, rot: E(s.code).shape ? s.rot || 0 : rot[i] }))
    .sort((a, b) => E(b.code).physMm - E(a.code).physMm || Math.round(a.y / pitch) - Math.round(b.y / pitch) || a.x - b.x)
    .map((s, i) => { const e = E(s.code); return { id: `P${String(i + 1).padStart(5, '0')}`, symbol: sym[s.code], code: s.code, x: s.x, y: s.y, dMm: e.refMm, rot: s.rot, group: groupOfEntry(e), layer: layerOf(e),
      ...(e.shape && { shape: e.shape, wMm: e.refW, hMm: e.refH }) }; });
  const layers = [...new Map(placed.map((s) => E(s.code)).sort((a, b) => a.physMm - b.physMm || (a.shape ? 1 : 0) - (b.shape ? 1 : 0)).map((e) => [layerOf(e), e])).values()]
    .map((e) => ({ id: layerOf(e), name: e.shape ? `${e.shape} ${e.physW}×${e.physH}mm (vật lý)` : `Đá ${e.physMm}mm (vật lý)` }));
  return {
    canvas: { widthMm: canvasMm, heightMm: canvasMm, pxPerMm: ppm, widthPx: img.w, heightPx: img.h },
    params, palette, layers, stones,
  };
}

export function mapStarry(img, o) {
  const t0 = Date.now(), cat = o.cat || loadCatalog(), ppm = o.ppm ?? img.w / o.canvasMm, canvasMm = o.canvasMm;
  const sizes = o.sizes || [2.8, 4, 5, 6, 8];
  // detectBeads (KIT-7) nhận cỡ REFERENCE và trả physMm + kind; Starry: không dò ngọc trai
  const det = detectBeads(img, { canvasWmm: canvasMm, stoneMm: refOfDet(sizes[0]), gapMm: 0.2, accentMm: sizes.slice(1).map(refOfDet), pearls: false, ...o.detect });
  const beads = det.stones.map((s) => ({ x: s.x, y: s.y, physMm: s.physMm, score: s.score }));
  // 1. vùng: lưới gridMm; điểm logistic tại từng ô làm mượt Gauss smoothMm, hoặc params.regionMask (KIT-10, Uint8Array w×h) lấy mẫu tâm ô
  const g = (o.gridMm ?? 1) * ppm, gw = Math.ceil(img.w / g), gh = Math.ceil(img.h / g), score = new Float32Array(gw * gh);
  const cellAt = (x, y) => clampI(Math.floor(y / g), 0, gh - 1) * gw + clampI(Math.floor(x / g), 0, gw - 1);
  if (o.regionMask) {
    for (let j = 0; j < score.length; j++) score[j] = o.regionMask[clampI(Math.round(((j / gw) | 0) * g + g / 2), 0, img.h - 1) * img.w + clampI(Math.round((j % gw) * g + g / 2), 0, img.w - 1)] ? 1 : 0;
  } else {
    const box = boxStats(img);
    for (let j = 0; j < score.length; j++) { const v = regionVec(img, box, (j % gw) * g + g / 2, ((j / gw) | 0) * g + g / 2, ppm); score[j] = v ? regionScore(o.region, v) : 0; }
    blurGrid(score, gw, gh, (o.smoothMm ?? 4) / (o.gridMm ?? 1));
  }
  // o.excludeMask (Uint8Array w×h, 1 = nền: caro giả/alpha/nền phẳng từ backgroundMask) → ô đó không bao giờ có đá
  if (o.excludeMask) for (let j = 0; j < score.length; j++) if (o.excludeMask[clampI(Math.round(((j / gw) | 0) * g + g / 2), 0, img.h - 1) * img.w + clampI(Math.round((j % gw) * g + g / 2), 0, img.w - 1)]) score[j] = -1;
  let fgFrac = 1;
  if (o.excludeMask) { let n = 0; for (let j = 0; j < score.length; j++) if (score[j] >= 0) n++; fgFrac = n / score.length; }
  const area = canvasMm * canvasMm * fgFrac, [lo, hi] = o.coverage || [0.28, 0.35], target = o.target ?? (lo + hi) / 2;
  const cover = (st) => st.reduce((a, s) => a + Math.PI * (s.physMm / 2) ** 2, 0) / area;
  // 2. đá: hạt DETECT trong vùng (điểm cao trước; va chạm → cỡ nhỏ hơn → xê dịch ≤ nudgeMm), rồi lấp khe trong vùng bằng viên chính
  // xếp sát (khe fillGapMm) như sản phẩm thật; 3. mã màu (chỉ thu cỡ). Ngưỡng vùng theo phân vị điểm, lặp tới độ phủ mục tiêu.
  const run = (tau) => {
    const inside = (x, y) => { const v = score[cellAt(x, y)]; return v >= 0 && v >= tau; };
    const placed = packStones(beads.filter((b) => inside(b.x, b.y)), inside, sizes, ppm, { nudgeMm: o.nudgeMm ?? 0.6, minGapMm: o.minGapMm ?? 0.15, fillGapMm: o.fillGapMm ?? o.minGapMm ?? 0.15, fill: o.fill ?? true, w: img.w, h: img.h });
    placed.forEach((s) => { s.imgRgb = discFeatures(img, s.x, s.y, s.physMm, ppm)?.rgb || [128, 128, 128]; s.target = o.color ? predictLab(o.color, lab(s.imgRgb), o.colorOpt) : lab(s.imgRgb); });
    const chosen = chooseCodes(placed, cat, { maxCodes: o.maxCodes ?? 10, metric: o.metric });
    placed.forEach((s, i) => { s.code = chosen.pick[i].code; s.physMm = chosen.pick[i].physMm; });
    let inArea = 0;
    for (let j = 0; j < score.length; j++) if (score[j] >= 0 && score[j] >= tau) inArea++;
    return { tau, placed, chosen, coverage: cover(placed), maskFrac: inArea / (score.length * fgFrac) };
  };
  const sorted = Float32Array.from(score.filter((v) => v >= 0)).sort(), tauAt = (frac) => sorted[clampI(Math.round((1 - frac) * sorted.length), 0, sorted.length - 1)];
  let best = run(o.regionMask ? 0.5 : tauAt(Math.min(1, target / 0.6)));
  for (let it = 0; it < 6 && !o.regionMask && Math.abs(best.coverage - target) > 0.005; it++) {
    const k = best.coverage / Math.max(1e-6, best.maskFrac), r = run(tauAt(Math.min(1, target / k)));
    if (Math.abs(r.coverage - target) < Math.abs(best.coverage - target)) best = r; else break;
  }
  const { placed, chosen, tau } = best;
  // 4. doc dạng chuẩn
  const doc = buildDoc(img, placed, cat, ppm, canvasMm, { mode: 'kit-11 select+detect', coverage: [lo, hi], target, maxCodes: o.maxCodes ?? 10, sizes, regionTau: o.regionMask ? null : Math.round(tau * 1e4) / 1e4, regionAreaPct: Math.round(best.maskFrac * 1000) / 10, regionMask: !!o.regionMask });
  const geom = geomStats(placed, ppm);
  return { doc, placed, beads, regionScore: { score, gw, gh, cellPx: g }, detected: det.stones.length, anchoredPct: (100 * placed.filter((p) => p.from === 'detect').length) / placed.length, regionAreaPct: 100 * best.maskFrac, coverage: cover(placed), tau, codeCost: chosen.meanCost, geom: summarizeGeom(geom), ms: Date.now() - t0 };
}

// ══ KIT-12b: trang phục dán kín, mã nhất quán ═══════════════════════════════════════════════════════════════════════════════
// Phóng ảnh: Lanczos a=3 tách được tới W×H (cả alpha), rồi unsharp (Gauss sigmaPx, amount). Dùng cho ảnh 1254 px → 3543 px (11.81 px/mm).
export function upscale(img, W, H = W, { a = 3, sigmaPx = 1.2, amount = 0.6 } = {}) {
  const lanczos = (x) => (x === 0 ? 1 : Math.abs(x) >= a ? 0 : (a * Math.sin(Math.PI * x) * Math.sin((Math.PI * x) / a)) / (Math.PI * Math.PI * x * x));
  const taps = (n, N) => {
    const sc = n / N, sup = Math.max(1, sc) * a, out = [];
    for (let i = 0; i < N; i++) {
      const c = (i + 0.5) * sc - 0.5, lo = Math.floor(c - sup) + 1, hi = Math.floor(c + sup), idx = [], w = [];
      let s = 0;
      for (let k = lo; k <= hi; k++) { const v = lanczos((k - c) / Math.max(1, sc)); idx.push(clampI(k, 0, n - 1)); w.push(v); s += v; }
      out.push({ idx, w: w.map((v) => v / s) });
    }
    return out;
  };
  const tx = taps(img.w, W), ty = taps(img.h, H), mid = new Float32Array(W * img.h * 4), out = new Float32Array(W * H * 4);
  for (let y = 0; y < img.h; y++) for (let x = 0; x < W; x++) {
    const { idx, w } = tx[x];
    for (let c = 0; c < 4; c++) { let v = 0; for (let k = 0; k < idx.length; k++) v += w[k] * img.data[(y * img.w + idx[k]) * 4 + c]; mid[(y * W + x) * 4 + c] = v; }
  }
  for (let y = 0; y < H; y++) { const { idx, w } = ty[y]; for (let x = 0; x < W; x++) for (let c = 0; c < 4; c++) { let v = 0; for (let k = 0; k < idx.length; k++) v += w[k] * mid[(idx[k] * W + x) * 4 + c]; out[(y * W + x) * 4 + c] = v; } }
  const data = new Uint8Array(W * H * 4), ch = new Float32Array(W * H);
  for (let c = 0; c < 4; c++) {
    for (let j = 0; j < W * H; j++) ch[j] = out[j * 4 + c];
    const bl = c < 3 && amount ? gauss(ch, W, H, sigmaPx) : ch;
    for (let j = 0; j < W * H; j++) data[j * 4 + c] = clampI(Math.round(ch[j] + (c < 3 ? amount * (ch[j] - bl[j]) : 0)), 0, 255);
  }
  return { w: W, h: H, data };
}

// LCh của màu ảnh; vàng kim loại = sắc 45–105°, C ≥ 20, L ≥ 35 (L16 gold amber 75°, L23 yellow 95°, L74 orange copper 62°).
const lch = (l) => [l[0], Math.hypot(l[1], l[2]), ((Math.atan2(l[2], l[1]) * 180) / Math.PI + 360) % 360];
export const isGoldLab = (l) => { const [L, C, h] = lch(l); return C >= 20 && L >= 35 && h >= 45 && h <= 105; };
// Vật liệu của mã catalog: pearl (mã số) | facet (Q, mài giác) | gold (tên vàng/đồng/hổ phách/vàng chanh) | base (L/Z/W/D còn lại).
export function materialOf(e) {
  if (e.kind === 'pearl') return 'pearl';
  if (/gold|amber|bronze|copper|yellow/i.test(e.name || '')) return 'gold';
  return /^Q/.test(e.code) ? 'facet' : 'base';
}
export const MATERIAL_SIZES = { pearl: PEARL_MM, // ngọc trai: ký hiệu = cỡ ("10", render vẽ được nhiều chữ)
  facet: [8, 10, 12], gold: [2.8, 4, 5, 6], base: [2.8, 4, 5, 6] };
// KIT-14: cỡ kit của 1 vật to = f × cỡ vật vẽ (box VLM ≈ 1.4–1.6 × đá kit, KIT-13 REPORT: f = 0.63–0.68); cỡ chọn trong lớp vật liệu
export const BIG_F = 0.65;
export const deGoldF = (wL) => (a, b) => Math.sqrt(de2000(a, b) ** 2 + (wL * Math.max(0, a[0] - b[0])) ** 2);
// cỡ + mã chọn CÙNG LÚC: chi phí = ΔE00(màu vật, mã) + bigWS·|ln(cỡ / cỡ kit)| (Q12 chỉ có màu vàng → đá xanh to ra Q10 xanh)

// Potts / ICM trên đồ thị láng giềng: nhãn i ∈ labels(i); E = Σ unary(i, l) + λ Σ_(i,j) w_ij [l_i ≠ l_j]. Khởi tạo argmin unary,
// quét theo thứ tự cố định tới khi không đổi (≤ sweeps). edges: [[i, j, w]]. Trả nhãn + số lần đổi.
export function pottsICM(n, labels, unary, edges, lambda, sweeps = 8) {
  const adj = Array.from({ length: n }, () => []);
  for (const [i, j, w] of edges) { adj[i].push([j, w]); adj[j].push([i, w]); }
  const lab = Array.from({ length: n }, (_, i) => labels(i).reduce((b, l) => (unary(i, l) < unary(i, b) ? l : b), labels(i)[0]));
  let changed = 0;
  for (let it = 0; it < sweeps; it++) {
    let ch = 0;
    for (let i = 0; i < n; i++) {
      let best = lab[i], bv = Infinity;
      for (const l of labels(i)) {
        let v = unary(i, l);
        for (const [j, w] of adj[i]) if (lab[j] !== l) v += lambda * w;
        if (v < bv - 1e-9) { bv = v; best = l; }
      }
      if (best !== lab[i]) { lab[i] = best; ch++; }
    }
    changed += ch;
    if (!ch) break;
  }
  return { lab, changed };
}

// Cạnh giữa các viên chạm nhau (khe < touchMm) — cùng cỡ vật lý + cùng vật liệu nếu sameKind; w = exp(−ΔE00(ảnh)² / 2σ²).
export function touchEdges(st, ppm, { touchMm = 0.6, sigma = 8, sameKind = true } = {}) {
  const cell = 14 * ppm, grid = new Map(), edges = [];
  st.forEach((s, i) => { const k = `${Math.floor(s.x / cell)},${Math.floor(s.y / cell)}`; (grid.get(k) || grid.set(k, []).get(k)).push(i); });
  st.forEach((s, i) => {
    const gx = Math.floor(s.x / cell), gy = Math.floor(s.y / cell);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) for (const j of grid.get(`${gx + dx},${gy + dy}`) || []) {
      if (j <= i) continue;
      const t = st[j];
      if (sameKind && (t.physMm !== s.physMm || t.mat !== s.mat)) continue;
      if (Math.hypot(s.x - t.x, s.y - t.y) / ppm - (s.physMm + t.physMm) / 2 > touchMm) continue;
      edges.push([i, j, Math.exp(-(de2000(s.imgLab, t.imgLab) ** 2) / (2 * sigma * sigma))]);
    }
  });
  return edges;
}
// Lật mã của 1 bản đồ đã xuất (readKitSvg / doc.stones): vật liệu theo mã catalog, màu ảnh tại tâm (thân hạt) → { all, similar }.
export function docFlip(stones, cat, img, ppm) {
  const st = stones.filter((s) => cat.codes[s.code]).map((s) => { const e = cat.codes[s.code]; return { x: s.x, y: s.y, code: s.code, physMm: e.physMm, mat: materialOf(e), imgLab: lab(beadColor(img, s.x, s.y, Math.min(e.physMm, 6), ppm)) }; });
  const edges = touchEdges(st, ppm), sim = flipRateSimilar(st, edges);
  return { all: flipRate(st, edges), similar: sim.rate, edges: edges.length, similarEdges: sim.edges };
}
// Tỉ lệ "lật mã": cạnh chạm nhau cùng cỡ + cùng vật liệu có mã khác nhau.
export const flipRate = (st, edges) => (edges.length ? edges.filter(([i, j]) => st[i].code !== st[j].code).length / edges.length : 0);
// … chỉ trên cạnh có màu ảnh gần nhau (ΔE00 < maxDE): đây là chỗ phải cùng mã (vòng / chuỗi một màu)
export const flipRateSimilar = (st, edges, maxDE = 8) => { const e = edges.filter(([i, j]) => de2000(st[i].imgLab, st[j].imgLab) < maxDE); return { rate: flipRate(st, e), edges: e.length }; };

// Vùng mịn to (lòng đá quý / opal: không có vành hạt trên ≥ minMm): độ lệch xám hộp 1 mm < stdMax, đóng 1 mm, mở bán kính
// minMm/2 (bỏ lòng hạt 2.8–4 mm) → các thành phần liên thông {x, y, areaMm2, dEqMm, id}. gemMask(blobs đã chọn) nở thêm growMm
// (vành đá quý) → Uint8Array w×h. Thế chỗ cho viên to của KIT-12a: không đá nhỏ nào được đặt lên.
export function smoothBlobs(img, ppm, fg, { stdMax = 12, minMm = 5 } = {}) {
  const W = img.w, H = img.h, box = boxStats(img), f = 2, w = Math.ceil(W / f), h = Math.ceil(H / f), sm = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const X = x * f + 1, Y = y * f + 1; sm[y * w + x] = fg[Math.min(H - 1, Y) * W + Math.min(W - 1, X)] && box(X, Y, 0.5 * ppm)[1] < stdMax ? 1 : 0; }
  const morph = (m, r, grow) => { const d = edt2(Uint8Array.from(m, (v) => (grow ? v : 1 - v)), w, h); return Uint8Array.from(d, (v) => (grow ? (v <= r * r ? 1 : 0) : (v > r * r ? 1 : 0))); };
  const rc = (0.5 * ppm) / f, ro = ((minMm / 2) * ppm) / f;
  let m = morph(morph(sm, rc, true), rc, false); // đóng
  m = morph(morph(m, ro, false), ro, true);       // mở
  const cid = new Int32Array(w * h).fill(-1), blobs = [];
  for (let j = 0; j < w * h; j++) {
    if (!m[j] || cid[j] >= 0) continue;
    const q = [j], id = blobs.length;
    cid[j] = id;
    let n = 0, sx = 0, sy = 0;
    while (q.length) { const k = q.pop(), x = k % w, y = (k / w) | 0; n++; sx += x; sy += y;
      for (const [u, v] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) if (u >= 0 && v >= 0 && u < w && v < h && m[v * w + u] && cid[v * w + u] < 0) { cid[v * w + u] = id; q.push(v * w + u); } }
    blobs.push({ id, x: (sx / n + 0.5) * f, y: (sy / n + 0.5) * f, areaMm2: (n * f * f) / (ppm * ppm), dEqMm: (2 * Math.sqrt((n * f * f) / Math.PI)) / ppm });
  }
  // nở theo màu tới growMaxMm (BFS qua điểm có ΔE76 tới màu TB của vùng < dEMax), lấy bao lồi từng vùng (đá quý tròn/oval: lấp đốm
  // phản quang trắng làm thủng vùng mịn), rồi nở thêm growMm (vành) → Uint8Array W×H
  const rgbAt = (x, y) => { const j = (Math.min(H - 1, y * f + 1) * W + Math.min(W - 1, x * f + 1)) * 4; return lab([img.data[j], img.data[j + 1], img.data[j + 2]]); };
  const gemMask = (keepIds, growMm = 1.2, growMaxMm = 3, dEMax = 28) => {
    const sel = new Set(keepIds), owner = Int32Array.from(cid, (v) => (v >= 0 && sel.has(v) ? v : -1)), mean = new Map(), q = [], dist = new Float32Array(w * h);
    for (let j = 0; j < w * h; j++) if (owner[j] >= 0) { const e = mean.get(owner[j]) || [0, 0, 0, 0], c = rgbAt(j % w, (j / w) | 0); e[0] += c[0]; e[1] += c[1]; e[2] += c[2]; e[3]++; mean.set(owner[j], e); q.push(j); }
    const rMax = (growMaxMm * ppm) / f;
    for (let qi = 0; qi < q.length; qi++) {
      const k = q[qi], x = k % w, y = (k / w) | 0, e = mean.get(owner[k]), mc = [e[0] / e[3], e[1] / e[3], e[2] / e[3]];
      for (const [u, v] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
        if (u < 0 || v < 0 || u >= w || v >= h) continue;
        const n = v * w + u;
        if (owner[n] >= 0 || dist[k] + 1 > rMax || Math.sqrt(d2(rgbAt(u, v), mc)) > dEMax) continue;
        owner[n] = owner[k]; dist[n] = dist[k] + 1; q.push(n);
      }
    }
    const pts = new Map(), hull = new Uint8Array(w * h);
    for (let j = 0; j < w * h; j++) if (owner[j] >= 0) (pts.get(owner[j]) || pts.set(owner[j], []).get(owner[j])).push([j % w, (j / w) | 0]);
    for (const P of pts.values()) {
      P.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]), lo = [], up = [];
      for (const p of P) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
      for (const p of [...P].reverse()) { while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
      const Hh = [...lo.slice(0, -1), ...up.slice(0, -1)];
      let x0 = w, x1 = 0, y0 = h, y1 = 0;
      for (const [x, y] of Hh) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        let inn = true;
        for (let i = 0; i < Hh.length && inn; i++) if (cr(Hh[i], Hh[(i + 1) % Hh.length], [x, y]) < 0) inn = false;
        if (inn || Hh.length < 3) hull[y * w + x] = 1;
      }
    }
    const d = edt2(hull, w, h), r = ((growMm * ppm) / f) ** 2, out = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) out[y * W + x] = d[Math.floor(y / f) * w + Math.floor(x / f)] <= r && fg[y * W + x] ? 1 : 0;
    return out;
  };
  return { blobs, gemMask, idAt: (x, y) => cid[clampI(Math.floor(y / f), 0, h - 1) * w + clampI(Math.floor(x / f), 0, w - 1)] };
}

// Lấp khe dày: vị trí tiếp xúc ĐỒNG THỜI 2 viên đã có (khe gapMm) — kiểu xếp lục giác cục bộ, dày hơn bám 1 viên; rồi bám 1 viên.
export function tangentFill(placed, inside, ppm, { d = 2.8, gapMm = 0.15, w = Infinity, h = Infinity, maxSizeMm = 12, hex = false, angle = 0 } = {}) {
  const cell = (maxSizeMm / 2 + d + gapMm) * ppm, grid = new Map(), out = [];
  const add = (t) => { const k = `${Math.floor(t.x / cell)},${Math.floor(t.y / cell)}`; (grid.get(k) || grid.set(k, []).get(k)).push(t); };
  placed.forEach(add);
  const near = (x, y) => { const gx = Math.floor(x / cell), gy = Math.floor(y / cell), r = []; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) for (const t of grid.get(`${gx + dx},${gy + dy}`) || []) r.push(t); return r; };
  const fits = (x, y) => {
    const rr = (d / 2) * ppm;
    if (x < rr || y < rr || x > w - rr || y > h - rr || !inside(x, y)) return false;
    for (const t of near(x, y)) if (Math.hypot(t.x - x, t.y - y) / ppm - (t.physMm + d) / 2 < gapMm - 1e-6) return false;
    return true;
  };
  // hex: trước tiên quét lưới lục giác bước d + gapMm (xoay angle độ) — lõi vùng rộng xếp đặc như sản phẩm thật (≈ 82 % ở khe 0.15)
  if (hex && Number.isFinite(w)) {
    const p = (d + gapMm + 1e-3) * ppm, c = Math.cos((angle * Math.PI) / 180), sn = Math.sin((angle * Math.PI) / 180), R = Math.hypot(w, h);
    for (let j = -Math.ceil(R / (p * 0.866)); j <= Math.ceil(R / (p * 0.866)); j++) for (let i = -Math.ceil(R / p); i <= Math.ceil(R / p); i++) {
      const u = (i + (j & 1) / 2) * p, v = j * p * 0.8660254, x = w / 2 + u * c - v * sn, y = h / 2 + u * sn + v * c;
      if (x >= 0 && y >= 0 && x < w && y < h && fits(x, y)) { const n = { x, y, physMm: d, score: 0, from: 'fill' }; add(n); out.push(n); }
    }
  }
  const queue = [...placed, ...out], step = d * ppm;
  let sy = step / 2, sx = step / 2;
  const seed = () => { // vùng chưa có viên nào: gieo 1 viên ở điểm lưới đầu tiên còn chỗ
    for (; sy < h; sy += step, sx = step / 2) for (; sx < w; sx += step) if (fits(sx, sy)) { const n = { x: sx, y: sy, physMm: d, score: 0, from: 'fill' }; add(n); out.push(n); queue.push(n); return true; }
    return false;
  };
  for (let qi = 0; qi < queue.length || (Number.isFinite(w) && seed()); qi++) {
    const s = queue[qi], ra = (s.physMm / 2 + d / 2 + gapMm) * ppm;
    let any = false;
    for (const t of near(s.x, s.y)) {
      if (t === s) continue;
      const rb = (t.physMm / 2 + d / 2 + gapMm) * ppm, dx = t.x - s.x, dy = t.y - s.y, D = Math.hypot(dx, dy);
      if (D < 1e-6 || D > ra + rb) continue;
      const aa = (ra * ra - rb * rb + D * D) / (2 * D), hh = Math.sqrt(Math.max(0, ra * ra - aa * aa)), mx = s.x + (aa * dx) / D, my = s.y + (aa * dy) / D;
      for (const sg of [1, -1]) {
        const x = mx - (sg * hh * dy) / D, y = my + (sg * hh * dx) / D;
        if (fits(x, y)) { const n = { x, y, physMm: d, score: 0, from: 'fill' }; add(n); out.push(n); queue.push(n); any = true; }
      }
    }
    if (!any) for (let a = 0; a < 12; a++) {
      const x = s.x + Math.cos((a * Math.PI) / 6) * ra, y = s.y + Math.sin((a * Math.PI) / 6) * ra;
      if (fits(x, y)) { const n = { x, y, physMm: d, score: 0, from: 'fill' }; add(n); out.push(n); queue.push(n); break; }
    }
  }
  return out;
}

// Màu thân hạt: TB lớp sáng nhất (top frac theo xám) trong đĩa đường kính mm — bỏ khe tối giữa các hạt của ảnh (viên lấp khe
// không trùng tâm hạt ảnh: đĩa thường lấy cả khe → xanh đêm thành đen L93).
export function beadColor(img, x, y, mm, ppm, frac = 0.6) {
  const R = Math.max(1, (mm / 2) * ppm), px = [];
  for (let v = Math.max(0, Math.floor(y - R)); v <= Math.min(img.h - 1, Math.ceil(y + R)); v++) for (let u = Math.max(0, Math.floor(x - R)); u <= Math.min(img.w - 1, Math.ceil(x + R)); u++) {
    if ((u - x) ** 2 + (v - y) ** 2 > R * R) continue;
    const j = (v * img.w + u) * 4;
    px.push([0.299 * img.data[j] + 0.587 * img.data[j + 1] + 0.114 * img.data[j + 2], img.data[j], img.data[j + 1], img.data[j + 2]]);
  }
  if (!px.length) return [128, 128, 128];
  px.sort((a, b) => b[0] - a[0]);
  const n = Math.max(1, Math.round(frac * px.length)), m = [0, 0, 0];
  for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) m[c] += px[i][c + 1];
  return m.map((v) => v / n);
}

// Viền hạt quanh đá quý (motif cabochon + vòng ngọc / vòng hạt vàng): tia từ tâm vùng giữ chỗ tới mép (rho(θ)), quét lệch t ra ngoài;
// dải đồng màu (≥ minFrac góc có ΔE00 tới màu trung vị < maxDE) liên tục theo t = vòng hạt, bề rộng dải → cỡ hạt (snap sizes),
// tâm hạt = đỉnh sáng dọc đường tâm vòng (xem dưới). Trả [{x, y, physMm, imgLab, ring}] hoặc [] khi không có vòng.
export function gemRing(img, ppm, keep, gem, { sizes = [2.8, 4, 5, 6], gapMm = 0.15, maxDE = 12, minFrac = 0.7, nAng = 120, ringId = 0 } = {}) {
  const at = (x, y) => keep[clampI(Math.round(y), 0, img.h - 1) * img.w + clampI(Math.round(x), 0, img.w - 1)];
  const rho = [];
  for (let k = 0; k < nAng; k++) {
    const a = (2 * Math.PI * k) / nAng, c = Math.cos(a), sn = Math.sin(a);
    let r = 0;
    while (r < 40 * ppm && (at(gem.x + c * r, gem.y + sn * r) || r < 2)) r += 1;
    rho.push(r);
  }
  const colorAt = (x, y) => { const j = (clampI(Math.round(y), 0, img.h - 1) * img.w + clampI(Math.round(x), 0, img.w - 1)) * 4; return lab([img.data[j], img.data[j + 1], img.data[j + 2]]); };
  const band = [];
  for (let t = 0.25; t <= 6; t += 0.25) {
    const cs = rho.map((r, k) => { const a = (2 * Math.PI * k) / nAng; return colorAt(gem.x + Math.cos(a) * (r + t * ppm), gem.y + Math.sin(a) * (r + t * ppm)); });
    const med = [0, 1, 2].map((i) => cs.map((c) => c[i]).sort((a, b) => a - b)[cs.length >> 1]);
    band.push({ t, med, frac: cs.filter((c) => de2000(c, med) < maxDE).length / cs.length });
  }
  // đường tâm vòng = t có tỉ lệ đồng màu cao nhất (≤ 4 mm ra ngoài mép); dọc đường tâm: tín hiệu xám (0 nếu khác màu vòng),
  // làm mượt, đỉnh = tâm hạt ảnh (1:1); cỡ = cỡ lớn nhất ≤ bước đỉnh trung vị − khe + 0.25
  const cand = band.filter((b) => b.t <= 4 && b.frac >= minFrac);
  if (!cand.length) return [];
  const pk = cand.reduce((a, b) => (b.frac > a.frac ? b : a)), tc = pk.t, M = 720, box = boxStats(img);
  const P = [];
  for (let i = 0; i < M; i++) {
    const a = (2 * Math.PI * i) / M, kf = (a / (2 * Math.PI)) * nAng, k0 = Math.floor(kf) % nAng, r = rho[k0] + (rho[(k0 + 1) % nAng] - rho[k0]) * (kf - Math.floor(kf));
    P.push([gem.x + Math.cos(a) * (r + tc * ppm), gem.y + Math.sin(a) * (r + tc * ppm)]);
  }
  const seg = P.map((p, i) => Math.hypot(P[(i + 1) % M][0] - p[0], P[(i + 1) % M][1] - p[1])), L = seg.reduce((a, v) => a + v, 0), ds = L / M;
  const sig = P.map(([x, y]) => (de2000(colorAt(x, y), pk.med) < maxDE ? box(x, y, 0.3 * ppm)[0] : 0));
  const sg = Math.max(1, (0.4 * ppm) / ds), K = Math.ceil(3 * sg), sm = sig.map((_, i) => { let v = 0, w = 0; for (let k = -K; k <= K; k++) { const ww = Math.exp(-(k * k) / (2 * sg * sg)); v += ww * sig[(i + k + M) % M]; w += ww; } return v / w; });
  const win = Math.max(1, Math.round((1.2 * ppm) / ds)), peaks = [];
  for (let i = 0; i < M; i++) {
    let mx = true;
    for (let k = 1; k <= win && mx; k++) if (sm[(i + k) % M] > sm[i] || sm[(i - k + M) % M] >= sm[i]) mx = false;
    if (mx && sm[i] > 0) peaks.push(i);
  }
  if (peaks.length < 6) return [];
  const gaps = peaks.map((p, k) => (((peaks[(k + 1) % peaks.length] - p + M) % M) * ds) / ppm).sort((a, b) => a - b), pitch = gaps[gaps.length >> 1];
  // cỡ gần nhất với hạt ảnh (bước − khe); vừa bước → đặt đúng đỉnh (1:1), không vừa → n = ⌊chu vi / (cỡ + khe)⌋ hạt đều, pha theo đỉnh đầu
  const d = sizes.reduce((a, v) => (Math.abs(v - (pitch - gapMm)) < Math.abs(a - (pitch - gapMm)) ? v : a), sizes[0]);
  let idx = peaks;
  if (d + gapMm > pitch + 1e-6) { const n = Math.floor(L / ((d + gapMm) * ppm * 1.01)); idx = Array.from({ length: n }, (_, k) => (peaks[0] + Math.round((k * M) / n)) % M); }
  const out = idx.map((i) => ({ x: P[i][0], y: P[i][1], physMm: d, imgLab: lab(beadColor(img, P[i][0], P[i][1], d, ppm)), ring: ringId, score: 0, from: 'ring', pitchMm: pitch, onPeaks: idx === peaks }));
  return out;
}

// Trang phục (cả phần không phải nền được dán kín): o = { canvasMm, cat, fgMask (1 = trang phục), color (trainColor | null),
//   maxCodes, gapMm (0.15), lambdaSize, lambdaCode, sigma, smoothGems (true), bigStones [{x, y, physMm, code?}] (KIT-12a), keepOut }
// 1 DETECT (đá + ngọc trai) → vật liệu (ngọc / mài giác ≥ 8 mm / vàng / nền) + cỡ, làm mượt (vật liệu, cỡ) bằng Potts trên đồ thị hạt
// 2 xếp: viên to trước, chạm → xê dịch cùng cỡ, nền mới được thu cỡ; vùng mịn to (đá quý/opal) giữ chỗ cho viên to của KIT-12a
// 3 lấp khe tiếp xúc 2 viên (khe gapMm) bằng L 2.8 trong trang phục; 4 mã: chọn ≤ maxCodes mã chỉ trong lớp vật liệu + cỡ,
// rồi Potts/ICM trên viên chạm nhau cùng cỡ + vật liệu (ΔE00 + λ·w·[khác mã]) → vòng/chuỗi cùng màu ra 1 mã.
const polyAreaMm2 = (s) => { const p = stonePoly({ x: 0, y: 0, shape: s.shape }, 1, s.w, s.h); let a = 0; for (let i = 0, j = p.length - 1; i < p.length; j = i++) a += p[j][0] * p[i][1] - p[i][0] * p[j][1]; return Math.abs(a) / 2; };
export function mapCostume(img, o) {
  const t0 = Date.now(), cat = o.cat || loadCatalog(), canvasMm = o.canvasMm ?? 300, ppm = img.w / canvasMm, gap = o.gapMm ?? 0.15;
  const fg = o.fgMask, keep = new Uint8Array(img.w * img.h);
  // KIT-18 o.codePool = bảng mã chung sản phẩm (vd kit/templates/product_queen_starry_palette.json): mã chỉ trong pool; viên DETECT / vật
  // trắng / vòng hạt mà (vật liệu, cỡ) không có mã trong pool thì không đặt (chỗ đó lấp lưới 2.8) thay vì đặt rồi thu cỡ để lại lỗ
  const pool = o.codePool ? new Set(o.codePool) : null, poolE = pool ? [...pool].map((c) => entryOf(c, cat)).filter(Boolean) : null;
  const hasClass = (mat, d) => !pool || poolE.some((e) => !e.shape && Math.abs(e.physMm - d) < 1e-6 && (o.oneMaterial && mat !== 'pearl' ? e.kind !== 'pearl' : materialOf(e) === mat));
  // KIT-14: o.bigObjects = vật to từ VLM (tầng 1 ≥ 8 mm + tầng 2 5–7 mm: { bbox [x0,y0,x1,y1] px hoặc tỉ lệ, material, color }) →
  // DETECT params.bigObjects (KIT-12a: khớp vùng trơn / mọc màu trong box, hạt nhỏ có tâm trong vật bị loại) → MỖI vật = 1 viên
  const vlm = Array.isArray(o.bigObjects) ? o.bigObjects : [];
  // o.detect === false (nền vẽ phẳng, KIT-16 Starry): không DETECT, cả vùng = lưới lục giác 2.8 + mã Potts
  const det = o.detect === false ? { stones: [] } : detectBeads(img, { canvasWmm: canvasMm, stoneMm: refOfDet(2.8), gapMm: 0.2, accentMm: [4, 5, 6, 8, 10, 12].map(refOfDet), ...(vlm.length && { bigObjects: vlm }), ...o.detect }, fg);
  const frac = (b) => (b.every((v) => v >= 0 && v <= 1) ? [b[0] * img.w, b[1] * img.h, b[2] * img.w, b[3] * img.h] : b);
  const objects = [];
  if (o.bigFromDetect ?? !o.bigFixed) for (const s of det.stones) {
    if (!s.big || (s.hint === undefined && !(o.detectBig ?? !vlm.length))) continue;
    const v = s.hint !== undefined ? vlm[s.hint] : null, bb = v ? frac(v.bbox) : null, l = lab(beadColor(img, s.x, s.y, Math.max(2, 0.6 * s.dMeasMm), ppm));
    const boxMm = bb ? Math.sqrt((bb[2] - bb[0]) * (bb[3] - bb[1])) / ppm : s.dMeasMm, kMm = (o.bigF ?? BIG_F) * boxMm, [L, C] = lch(l);
    // ngọc hay đá trắng quyết theo CỠ (VLM gọi đá trắng đục là "pearl"): trắng + cỡ kit ≥ 4.5 mm = ngọc trai
    const whiteish = v ? v.color === 'white' && /pearl/i.test(v.material || '') : s.kind === 'pearl' && L >= 70 && C <= 15;
    const mat = whiteish && kMm >= 4.5 ? 'pearl' : v?.color === 'gold' || isGoldLab(l) ? 'gold' : kMm >= 7 ? 'facet' : 'base';
    // KIT-14 hình (VLM): tim / marquise / giọt → 1 viên catalog đúng hình, cỡ gần cỡ vẽ nhất, xoay theo trục dài (elip DETECT nếu
    // đủ dẹt, không thì theo box); tim đứng (mũi xuống)
    const shape = isShaped({ shape: v?.shape }) ? v.shape : null, bw = bb ? (bb[2] - bb[0]) / ppm : s.dMeasMm, bh = bb ? (bb[3] - bb[1]) / ppm : s.dMeasMm;
    const elong = s.axesMm[0] / s.axesMm[1] >= 1.3 && s.src === 'hint';
    const longMm = shape ? (elong ? Math.min(s.axesMm[0], 1.15 * Math.max(bw, bh)) : Math.max(bw, bh)) : 0, shortMm = shape ? (elong ? s.axesMm[1] : shape === 'heart' ? Math.min(bw, bh) : Math.min(bw, bh) * 0.85) : 0;
    const rotDeg = !shape || shape === 'heart' ? 0 : elong ? s.rotDeg - 90 : bw > bh ? 90 : 0;
    objects.push({ id: objects.length, x: bb && !elong && shape ? (bb[0] + bb[2]) / 2 : s.x, y: bb && !elong && shape ? (bb[1] + bb[3]) / 2 : s.y, aMm: s.axesMm[0], bMm: s.axesMm[1], th: (s.rotDeg * Math.PI) / 180, box: bb, boxMm, kMm, mat, imgLab: l,
      shape, longMm, shortMm, rotDeg,
      dEqMm: Math.sqrt(s.axesMm[0] * s.axesMm[1]), areaMm2: (Math.PI / 4) * s.axesMm[0] * s.axesMm[1], src: s.src, hint: s.hint, vlm: v ? { material: v.material, color: v.color, tier: v.tier } : null, flags: s.flags });
  }
  // KIT-16: o.bigFixed = viên to đã duyệt (kit/templates/<name>_big.json, đổi về px): { id, x, y, code, rotDeg, keepMm [w, h] vùng vẽ,
  //   border true | false | undefined (tự đo) } → mỗi mục = 1 viên đúng mã (chạm vẫn đặt, flag 'overlap'), không chọn lại
  for (const f of o.bigFixed || []) {
    const e = entryOf(f.code, cat);
    if (!e) throw new Error(`bigFixed ${f.id}: mã ${f.code} không có trong catalog`);
    const sw = e.physW ?? e.physMm, sh = e.physH ?? e.physMm, [kw, kh] = f.keepMm || [sw, sh], l = lab(beadColor(img, f.x, f.y, Math.max(2, 0.6 * Math.min(sw, sh)), ppm));
    objects.push({ id: objects.length, fid: f.id, x: f.x, y: f.y, aMm: Math.max(sw, sh), bMm: Math.min(sw, sh), th: 0, box: null, boxMm: Math.max(kw, kh), kMm: e.physMm, mat: materialOf(e), imgLab: l,
      shape: e.shape || null, shortMm: Math.max(kw, sw), longMm: Math.max(kh, sh), rotDeg: f.rotDeg || 0, fixedE: e, borderSet: f.border, ringSet: f.ring,
      dEqMm: Math.sqrt(kw * kh), areaMm2: (Math.PI / 4) * kw * kh, src: 'fixed', hint: undefined, vlm: null, flags: [] });
  }
  // vùng cấm của vật to: vật ≥ gemMinMm có vùng mịn KIT-12b (smoothBlobs, bao lồi + viền) chứa tâm, cỡ 0.5–1.4 × vật → vùng đó (elip
  // DETECT/box hay nuốt cả vòng ngọc quanh opal); còn lại = elip DETECT ∩ elip nội tiếp box VLM (nới khe)
  const sbB = objects.length ? smoothBlobs(img, ppm, fg, o.gemOpt) : null, blobIds = [];
  const paintPoly = (poly) => { const xs = poly.map((p) => p[0]), ys = poly.map((p) => p[1]);
    for (let y = Math.max(0, Math.floor(Math.min(...ys))); y <= Math.min(img.h - 1, Math.ceil(Math.max(...ys))); y++) for (let x = Math.max(0, Math.floor(Math.min(...xs))); x <= Math.min(img.w - 1, Math.ceil(Math.max(...xs))); x++)
      if (sdPoly(poly, x + 0.5, y + 0.5) <= 0) keep[y * img.w + x] = 1; };
  const drawnPoly = (b, off = 0) => stonePoly({ x: b.x, y: b.y, shape: b.shape, rot: b.rotDeg }, ppm, b.shortMm + 2 * off, b.longMm + 2 * off);
  for (const b of objects) {
    // viên cố định: cấm = chính viên + khe (phần vẽ thừa quanh viên nhỏ hơn hình vẽ được lấp 2.8 như hình vẽ); hình VLM: cấm = hình vẽ
    if (b.fixedE) { const e = b.fixedE; b.keep = 'stone'; paintPoly(stonePoly({ x: b.x, y: b.y, shape: e.shape || 'round', rot: b.rotDeg }, ppm, (e.physW ?? e.physMm) + 2 * gap, (e.physH ?? e.physMm) + 2 * gap)); continue; }
    if (b.shape) { b.keep = 'shape'; paintPoly(drawnPoly(b, gap)); continue; }
    const id = b.dEqMm >= (o.gemMinMm ?? 6) ? sbB.idAt(b.x, b.y) : -1, bl = id >= 0 ? sbB.blobs.find((q) => q.id === id) : null;
    if (bl && bl.dEqMm >= 0.5 * Math.min(b.dEqMm, b.boxMm) && bl.dEqMm <= 1.4 * Math.max(b.dEqMm, b.boxMm)) { blobIds.push(id); b.keep = 'blob'; continue; }
    b.keep = 'ellipse';
    const ells = [[b.x, b.y, (b.aMm / 2 + gap) * ppm, (b.bMm / 2 + gap) * ppm, b.th]];
    if (b.box) ells.push([(b.box[0] + b.box[2]) / 2, (b.box[1] + b.box[3]) / 2, (b.box[2] - b.box[0]) / 2 + gap * ppm, (b.box[3] - b.box[1]) / 2 + gap * ppm, 0]);
    const inE = (x, y) => ells.every(([cx, cy, ax, ay, th]) => { const dx = x - cx, dy = y - cy, c = Math.cos(th), sn = Math.sin(th), u = dx * c + dy * sn, w = dy * c - dx * sn; return (u / ax) ** 2 + (w / ay) ** 2 <= 1; });
    const R = Math.max(...ells.map((e) => Math.max(e[2], e[3])));
    for (let y = Math.max(0, Math.floor(b.y - R)); y <= Math.min(img.h - 1, Math.ceil(b.y + R)); y++) for (let x = Math.max(0, Math.floor(b.x - R)); x <= Math.min(img.w - 1, Math.ceil(b.x + R)); x++)
      if (inE(x, y)) keep[y * img.w + x] = 1;
  }
  if (blobIds.length) { const gm = sbB.gemMask(blobIds, o.gemGrowMm ?? 2.4, o.gemGrowMaxMm ?? 3, o.gemDEMax ?? 28); for (let j = 0; j < keep.length; j++) keep[j] ||= gm[j]; }
  // vùng mịn to = đá quý / opal (KIT-12b, khi không có vật to VLM); bỏ vùng chứa tâm 1 ngọc trai DETECT mà ≤ 9 mm (chính là lòng ngọc trai)
  let gems = objects.filter((b) => b.keep === 'blob');
  if (o.smoothGems ?? !objects.length) {
    const sb = smoothBlobs(img, ppm, fg, o.gemOpt), pearlIn = new Set(det.stones.filter((s) => s.kind === 'pearl').map((s) => sb.idAt(s.x, s.y)).filter((v) => v >= 0));
    const sg = sb.blobs.filter((b) => b.dEqMm >= (o.gemMinMm ?? 6) && !(pearlIn.has(b.id) && b.dEqMm <= 9));
    const gm = sb.gemMask(sg.map((b) => b.id), o.gemGrowMm ?? 2.4, o.gemGrowMaxMm ?? 3, o.gemDEMax ?? 28);
    for (let j = 0; j < keep.length; j++) keep[j] ||= gm[j];
    gems = [...gems, ...sg];
  }
  if (o.keepOut) for (let j = 0; j < keep.length; j++) keep[j] ||= o.keepOut[j];
  const at = (m, x, y) => m[clampI(Math.round(y), 0, img.h - 1) * img.w + clampI(Math.round(x), 0, img.w - 1)];
  const inside = (x, y) => at(fg, x, y) && !at(keep, x, y);
  // 1. vật liệu + cỡ
  let beads = det.stones.filter((s) => !(s.big && objects.length) && inside(s.x, s.y)).map((s) => {
    const f = discFeatures(img, s.x, s.y, Math.min(s.physMm, 6), ppm), l = lab(f?.rgb || [128, 128, 128]);
    const mat = s.kind === 'pearl' ? 'pearl' : s.physMm >= 8 ? 'facet' : isGoldLab(l) ? 'gold' : 'base';
    return { x: s.x, y: s.y, dMeas: s.dMeasMm, physMm: s.physMm, mat0: mat, mat, imgLab: l, score: s.score };
  });
  const LBL = [];
  for (const [m, sz] of Object.entries(MATERIAL_SIZES)) for (const d of sz) LBL.push({ m, d });
  const swap = { pearl: ['base'], base: ['pearl'], gold: [], facet: ['base', 'pearl'] };
  const lamS = o.lambdaSize ?? 1.5, sig = o.sigma ?? 8;
  const nbr = [];
  {
    const cell = 16 * ppm, grid = new Map();
    beads.forEach((b, i) => { const k = `${Math.floor(b.x / cell)},${Math.floor(b.y / cell)}`; (grid.get(k) || grid.set(k, []).get(k)).push(i); });
    beads.forEach((b, i) => { const gx = Math.floor(b.x / cell), gy = Math.floor(b.y / cell);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) for (const j of grid.get(`${gx + dx},${gy + dy}`) || []) {
        if (j <= i) continue;
        const t = beads[j];
        if (Math.hypot(b.x - t.x, b.y - t.y) / ppm > 0.6 * (b.dMeas + t.dMeas) + 0.6) continue;
        nbr.push([i, j, Math.exp(-(de2000(b.imgLab, t.imgLab) ** 2) / (2 * sig * sig))]);
      } });
  }
  // khoảng tâm tới hạt cùng màu gần nhất: cỡ > khoảng − khe sẽ chồng (chuỗi ngọc 4.3 mm không xếp được 5 mm) → phạt
  const nnSame = beads.map(() => Infinity);
  for (const [i, j, w] of nbr) if (w > 0.5) { const dd = Math.hypot(beads[i].x - beads[j].x, beads[i].y - beads[j].y) / ppm; nnSame[i] = Math.min(nnSame[i], dd); nnSame[j] = Math.min(nnSame[j], dd); }
  const sizeLab = pottsICM(beads.length, (i) => LBL.map((_, k) => k).filter((k) => LBL[k].m === beads[i].mat0 || swap[beads[i].mat0].includes(LBL[k].m)),
    (i, k) => (Math.log(beads[i].dMeas / LBL[k].d) / 0.12) ** 2 + (LBL[k].m === beads[i].mat0 ? 0 : 2) + (LBL[k].d > nnSame[i] - gap + 0.1 ? 4 : 0), nbr, lamS);
  const sizeBefore = beads.map((b) => `${b.mat0}|${b.physMm}`);
  beads.forEach((b, i) => { b.mat = LBL[sizeLab.lab[i]].m; b.physMm = LBL[sizeLab.lab[i]].d; });
  const sizeFlip = (lbl) => (nbr.length ? nbr.filter(([i, j]) => lbl[i] !== lbl[j] && Math.abs(Math.log(beads[i].dMeas / beads[j].dMeas)) < 0.15 && de2000(beads[i].imgLab, beads[j].imgLab) < 10).length / nbr.length : 0);
  const sizeStats = { before: sizeFlip(sizeBefore), after: sizeFlip(beads.map((b) => `${b.mat}|${b.physMm}`)), changed: sizeLab.changed };
  // 2. xếp: viên to KIT-12a (cố định) → hạt DETECT to trước
  const placed = [], cell = 14 * ppm, grid = new Map();
  // khe theo cỡ vật lý; viên có hình (KIT-14) theo đa giác + góc (lib/kit/shapes.js)
  const geoOf = (t) => (t.shape ? { x: t.x, y: t.y, shape: t.shape, w: t.w, h: t.h, rot: t.rot } : { x: t.x, y: t.y, w: t.physMm, h: t.physMm });
  const fitsG = (G) => {
    const rr = (Math.max(G.w, G.h) / 2) * ppm;
    if (G.x < rr || G.y < rr || G.x > img.w - rr || G.y > img.h - rr) return false;
    const gx = Math.floor(G.x / cell), gy = Math.floor(G.y / cell);
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) for (const t of grid.get(`${gx + dx},${gy + dy}`) || []) {
      const far = Math.hypot(t.x - G.x, t.y - G.y) / ppm - (t.physMm + Math.max(G.w, G.h)) / 2;
      if (far >= gap - 1e-6) continue;
      if (!t.shape && !G.shape) return false;
      if (gapMm(geoOf(t), G, ppm) < gap - 1e-6) return false;
    }
    return true;
  };
  const fits = (x, y, d) => fitsG({ x, y, w: d, h: d });
  const add = (t) => { placed.push(t); const k = `${Math.floor(t.x / cell)},${Math.floor(t.y / cell)}`; (grid.get(k) || grid.set(k, []).get(k)).push(t); };
  // 2·. vật to (VLM/DETECT): 1 viên tại tâm vật; (cỡ, mã) theo chi phí màu + cỡ, vật cùng (vật liệu VLM, màu, cỡ) → 1 mã chung;
  // chạm → phương án kế tiếp / xê dịch ≤ 0.6 mm
  let bigDropped = 0;
  const wS = o.bigWS ?? 25, codeLabAll = new Map(Object.values(cat.codes).map((e) => [e.code, lab(hex2(e.fill))]));
  const bigOpts = (b) => b.shape ? Object.values(cat.shaped).filter((e) => e.shape === b.shape)
    // cỡ GẦN NHẤT trước (captain: tim 20 mm vẽ → X 12×12), màu trong cỡ đó; mã lệch màu > shapeDEMax xếp sau
    .map((e) => { const dE = (isGoldLab(b.imgLab) ? deGoldF(o.goldWL ?? 1) : de2000)(b.imgLab, lab(hex2(e.fill)));
      const f = o.shapeF ?? 0.8; // hình vẽ (VLM / DETECT) gồm cả viền hạt vàng quanh đá: đá ≈ 0.8 × hình vẽ
      return { e, c: (dE > (o.shapeDEMax ?? 25) ? 1000 : 0) + 100 * (Math.abs(Math.log(e.physH / (f * b.longMm))) + Math.abs(Math.log(e.physW / (f * b.shortMm)))) / 2 + dE }; }).sort((p, q) => p.c - q.c)
    : Object.values(cat.codes).filter((e) => (b.mat === 'pearl' ? e.kind === 'pearl' : e.kind !== 'pearl' && e.physMm >= 2.8) && e.physMm <= 1.25 * b.kMm + 0.3)
    .map((e) => ({ e, c: (b.mat === 'pearl' ? 0 : (b.mat === 'gold' ? deGoldF(o.goldWL ?? 1) : de2000)(b.imgLab, codeLabAll.get(e.code))) + wS * Math.abs(Math.log(e.physMm / b.kMm)) })).sort((p, q) => p.c - q.c);
  for (const b of objects) { b.opts = b.fixedE ? [{ e: b.fixedE, c: 0 }] : bigOpts(b).filter((q) => !pool || pool.has(q.e.code)); b.want = b.opts[0]?.e; }
  const grp = new Map();
  for (const b of objects) if (b.want && b.vlm) { const k = `${b.vlm.material}|${b.vlm.color}|${b.want.physMm}|${b.mat}|${b.shape || ''}|${b.want.physW || ''}`; (grp.get(k) || grp.set(k, []).get(k)).push(b); }
  for (const g of grp.values()) {
    if (g.length < 2) continue;
    const sz = g[0].want.physMm, cs = [...new Set(g.flatMap((b) => b.opts.filter((q) => q.e.physMm === sz).map((q) => q.e.code)))];
    const tot = (code) => g.reduce((a, b) => a + (b.opts.find((q) => q.e.code === code)?.c ?? Infinity), 0), best = cs.sort((p, q) => tot(p) - tot(q))[0];
    for (const b of g) { const q = b.opts.find((z) => z.e.code === best); if (q) { q.c -= 100; b.opts = [q, ...b.opts.filter((z) => z !== q)]; b.want = q.e; } } // ưu tiên giữ qua sắp lại
  }
  // mã mới cho vật to tốn ngân sách mã chung: thêm newCodeDE cho mã chưa dùng (vd ngọc 7 → 8 đã có, đá xanh 8 → Q120 10 nếu vừa)
  const usedBig = new Set(), newDE = o.newCodeDE ?? 10;
  for (const b of [...objects].sort((p, q) => (q.want?.physMm || 0) - (p.want?.physMm || 0))) {
    if (b.want && b.want.physMm >= (o.bigFixMm ?? 7) || b.mat === 'pearl') b.opts = b.opts.map((q) => ({ ...q, c2: q.c + (usedBig.has(q.e.code) ? 0 : b.shape ? o.newShapeDE ?? 30 : newDE) })).sort((p, q) => p.c2 - q.c2);
    let ok = null;
    if (b.shape) { // viên có hình: thử theo thứ tự chi phí, xê dịch ≤ 0.6 mm; cùng góc
      for (const { e } of b.opts.slice(0, 20)) {
        for (let r = 0; !ok && r <= 0.6 + 1e-6; r += 0.3) for (let a = 0; a < (r ? 8 : 1) && !ok; a++) {
          const x = b.x + Math.cos((a * Math.PI) / 4) * r * ppm, y = b.y + Math.sin((a * Math.PI) / 4) * r * ppm;
          if (fitsG({ x, y, shape: e.shape, w: e.physW, h: e.physH, rot: b.rotDeg })) ok = { x, y, e };
        }
        if (ok) break;
      }
      if (!ok && b.fixedE) { ok = { x: b.x, y: b.y, e: b.fixedE }; b.flags.push('overlap'); }
      if (!ok) { bigDropped++; b.placed = null; continue; }
      b.placed = `${ok.e.physW}x${ok.e.physH}`; usedBig.add(ok.e.code);
      add({ x: ok.x, y: ok.y, physMm: ok.e.physMm, shape: ok.e.shape, w: ok.e.physW, h: ok.e.physH, rot: b.rotDeg, mat: materialOf(ok.e), fixedCode: ok.e.code, imgLab: b.imgLab, from: 'big', bigId: b.id });
      continue;
    }
    for (const d of [...new Set(b.opts.map((q) => q.e.physMm))]) {
      const e = b.opts.find((q) => q.e.physMm === d).e;
      for (let r = 0; !ok && r <= 0.6 + 1e-6; r += 0.3) for (let a = 0; a < (r ? 8 : 1) && !ok; a++) {
        const x = b.x + Math.cos((a * Math.PI) / 4) * r * ppm, y = b.y + Math.sin((a * Math.PI) / 4) * r * ppm;
        if (fits(x, y, e.physMm)) ok = { x, y, physMm: e.physMm, code: e.code };
      }
      if (ok) break;
    }
    if (!ok && b.fixedE) { ok = { x: b.x, y: b.y, physMm: b.fixedE.physMm, code: b.fixedE.code }; b.flags.push('overlap'); }
    if (!ok) { bigDropped++; b.placed = null; continue; }
    b.placed = ok.physMm;
    // mã cố định cho viên ≥ bigFixMm và ngọc trai (mỗi cỡ 1 mã); viên tầng 2 nhỏ hơn: giữ cỡ + vật liệu, mã chọn chung ngân sách ≤ maxCodes
    const fixed = !!b.fixedE || ok.physMm >= (o.bigFixMm ?? 7) || cat.codes[ok.code].kind === 'pearl';
    if (fixed) usedBig.add(ok.code);
    add({ x: ok.x, y: ok.y, physMm: ok.physMm, mat: materialOf(cat.codes[ok.code]), ...(fixed && { fixedCode: ok.code }), imgLab: b.imgLab, from: 'big', bigId: b.id });
  }
  // KIT-18 vật trắng DETECT hay sót (vòng ngọc trai quanh tim, pha lê trắng tròn 2 bên): thành phần liên thông điểm sáng ít màu
  // (L* ≥ whiteL, C* ≤ 30) trong trang phục ngoài vùng cấm, lõi ≥ whiteMinMm (2.6 mm; ngọc 4 mm có lõi 3.1–3.5 → ngọc 5, lõi nhỏ hơn → trắng 2.8 tại tâm), gần tròn → 1 viên tại tâm. Kem (b* ≥ pearlB) = ngọc trai
  // (cỡ ngọc nhỏ nhất catalog ≥ ước lượng, thường 5; không vừa → đá trắng 4), trung tính = pha lê (nền 4/5/6, ≥ 7.5 mài giác);
  // cỡ ước lượng = lõi sáng × whiteK (lõi sáng chưa gồm mép tối của hạt). o.whiteObjects: false để tắt (mặc định bật khi có bigFixed)
  const whites = [];
  if (o.whiteObjects ?? !!o.bigFixed) {
    const W = img.w, H = img.h, wm = new Uint8Array(W * H), wl = o.whiteL ?? 70;
    for (let j = 0; j < W * H; j++) {
      if (!fg[j] || keep[j]) continue;
      const r = img.data[j * 4], g = img.data[j * 4 + 1], bb = img.data[j * 4 + 2];
      if (r + g + bb < 480) continue; // L* ≥ 70 cần sáng; bỏ nhanh
      const [L, A, B] = lab([r, g, bb]);
      if (L >= wl && Math.hypot(A, B) <= 30) wm[j] = 1;
    }
    const seen = new Uint8Array(W * H), stack = new Int32Array(W * H);
    const pearlSz = Object.values(cat.codes).filter((e) => e.kind === 'pearl').map((e) => e.physMm).sort((p, q) => p - q);
    for (let s0 = 0; s0 < W * H; s0++) {
      if (!wm[s0] || seen[s0]) continue;
      let top = 0, n = 0, sx = 0, sy = 0, sL = 0, sA = 0, sB = 0, x0 = W, x1 = 0, y0 = H, y1 = 0;
      stack[top++] = s0; seen[s0] = 1;
      while (top) {
        const q = stack[--top], x = q % W, y = (q - x) / W;
        n++; sx += x; sy += y; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        if (n <= 4000) { const [L, A, B] = lab([img.data[q * 4], img.data[q * 4 + 1], img.data[q * 4 + 2]]); sL += L; sA += A; sB += B; }
        if (x > 0 && wm[q - 1] && !seen[q - 1]) { seen[q - 1] = 1; stack[top++] = q - 1; }
        if (x < W - 1 && wm[q + 1] && !seen[q + 1]) { seen[q + 1] = 1; stack[top++] = q + 1; }
        if (y > 0 && wm[q - W] && !seen[q - W]) { seen[q - W] = 1; stack[top++] = q - W; }
        if (y < H - 1 && wm[q + W] && !seen[q + W]) { seen[q + W] = 1; stack[top++] = q + W; }
      }
      const core = (2 * Math.sqrt(n / Math.PI)) / ppm, bw = (x1 - x0 + 1) / ppm, bh = (y1 - y0 + 1) / ppm, m = Math.min(n, 4000);
      if (core < (o.whiteMinMm ?? 2.6) || core > (o.whiteMaxMm ?? 9) || Math.max(bw, bh) / Math.min(bw, bh) > 1.6 || n / ((Math.PI / 4) * bw * bh * ppm * ppm) < 0.55) continue;
      const l = [sL / m, sA / m, sB / m], est = core * (o.whiteK ?? 1.25), pearl = l[2] >= (o.pearlB ?? 9);
      whites.push({ x: sx / n, y: sy / n, core, est, l, pearl });
    }
    whites.sort((p, q) => q.core - p.core);
    const poolWhite4 = poolE.some((e) => !e.shape && e.kind !== 'pearl' && materialOf(e) !== 'gold' && e.physMm >= 4 && (([L, A, B]) => L >= 75 && Math.hypot(A, B) <= 12)(lab(e.fill.replace('#', '').match(/\w\w/g).map((v) => parseInt(v, 16)))));
    for (const w of whites) {
      const near = (sz) => sz.reduce((a, d) => (Math.abs(d - w.est) < Math.abs(a - w.est) ? d : a), sz[0]);
      // pha lê: nền 4/5/6 (≥ 7 mm: mài giác 8/10/12) rồi cỡ nhỏ hơn; pool không có lớp nào → ngọc trai trắng cỡ ≤ (vẫn 1 viên tròn trắng)
      // không vừa cỡ nào → 1 viên trắng 2.8 tại tâm (vòng ngọc bước 3.8 mm quanh tim: ngọc 5 vừa cách 1, còn lại trắng thay vì chuỗi vàng)
      const opts = w.pearl ? [...pearlSz.filter((d) => d >= w.est - 0.6 && d <= w.est + 1.2).slice(0, 1).map((d) => ['pearl', d]), ...(w.est >= 3.6 ? [['base', 4]] : []), ['base', 2.8]]
        : [...(w.est >= 7 ? [['facet', near([8, 10, 12])]] : []), ...[6, 5, 4].filter((d) => d <= Math.max(4, near([4, 5, 6]))).map((d) => ['base', d]),
          ...pearlSz.filter((d) => d <= Math.max(5, w.est + 0.6)).reverse().map((d) => ['pearl', d]), ['base', 2.8]];
      let ok = null;
      // pha lê: ngọc trai chỉ khi pool không có đá trắng ≥ 4 mm nào, kể cả cỡ khác (không pool: không bao giờ) — có mã pha lê thì thà trắng 2.8
      const ok0 = opts.filter(([m, dd]) => hasClass(m, dd)), use = w.pearl ? ok0 : ok0.filter(([m, dd]) => m !== 'pearl' ? true : pool && !poolWhite4 && !ok0.some(([m2, d2]) => m2 !== 'pearl' && d2 >= 4));
      for (const [mat, d] of use) {
        for (let r = 0; !ok && r <= 0.6 + 1e-6; r += 0.3) for (let a = 0; a < (r ? 8 : 1) && !ok; a++) {
          const x = w.x + Math.cos((a * Math.PI) / 4) * r * ppm, y = w.y + Math.sin((a * Math.PI) / 4) * r * ppm;
          if (inside(x, y) && fits(x, y, d)) ok = { x, y, physMm: d, mat };
        }
        if (ok) break;
      }
      w.placed = ok?.physMm ?? null;
      if (ok) add({ ...ok, imgLab: w.l, score: 0, from: 'white' });
    }
  }
  // KIT-16 viền hạt vàng li ti (~1–1.5 mm, nhỏ hơn đá 2.8) quanh vật to: đo trên đường vẽ + khe + 0.7 mm (tỉ lệ điểm vàng ≥ borderGold),
  // bề rộng dải = trung vị khoảng tới điểm không vàng đầu tiên theo pháp tuyến. o.border: 'chain' = chuỗi đá 2.8 (vàng) đều theo đường
  // viền, tâm ở vẽ + khe + 1.4 mm, bước ≥ 2.95 mm (mặc định 3.0), 1 mã / viền; 'print' = dải để in (cấm đá); khác = như cũ (lấp tự do)
  const borders = [], chainJobs = [];
  const goldAt = (x, y) => isGoldLab(lab(beadColor(img, x, y, 0.8, ppm)));
  if (o.border === 'chain' || o.border === 'print') for (const b of objects) {
    if (!b.placed || !b.shortMm || b.borderSet === false || (b.borderSet !== true && !(b.shape || (b.fixedE ?? b.want)?.physMm >= (o.borderMinMm ?? 5)))) continue;
    const inner = drawnPoly(b, gap), ring = drawnPoly(b, gap + 0.7), nGold = ring.filter(([x, y]) => at(fg, x, y) && goldAt(x, y)).length, goldFrac = nGold / ring.length;
    b.goldFrac = +goldFrac.toFixed(2);
    if (b.borderSet === false || (b.borderSet !== true && goldFrac < (o.borderGold ?? 0.6))) continue;
    const ws = [];
    for (let i = 0; i < ring.length; i += 3) {
      const [x0, y0] = inner[i], [x1, y1] = ring[i], L = Math.hypot(x1 - x0, y1 - y0) || 1, ux = (x1 - x0) / L, uy = (y1 - y0) / L;
      let w = 0;
      for (let t = 0; t <= 5; t += 0.1) { if (!goldAt(x0 + ux * t * ppm, y0 + uy * t * ppm)) break; w = t; }
      ws.push(w);
    }
    const bandMm = Math.max(1, ws.sort((p, q) => p - q)[ws.length >> 1]);
    const bd = { id: borders.length, obj: b.id, fid: b.fid, goldFrac: b.goldFrac, bandMm: +bandMm.toFixed(1), mode: o.border, n: 0 };
    // KIT-18: chuỗi đặt SAU hạt DETECT ≥ 4 mm / ngọc / chuỗi ngọc (vòng ngọc quanh tim không bị chuỗi vàng chiếm), chỉ vào chỗ còn vừa
    if (o.border === 'chain' && hasClass('gold', 2.8)) chainJobs.push(() => {
      // tâm chuỗi trên đường viền vẽ (vẽ + ½ dải); viên kit gần kín hình vẽ thì đẩy ra cho mép trong chuỗi cách viên đúng khe
      const e = b.fixedE ?? b.want, inset = Math.max(0, Math.min(b.shortMm - (e.physW ?? e.physMm), b.longMm - (e.physH ?? e.physMm)) / 2);
      const P = drawnPoly(b, Math.max(bandMm / 2, gap + 1.4 - inset)), seg = P.map((p, i) => Math.hypot(P[(i + 1) % P.length][0] - p[0], P[(i + 1) % P.length][1] - p[1])), per = seg.reduce((a, v) => a + v, 0) / ppm;
      let n = Math.round(per / (o.borderStepMm ?? 3.0));
      while (n > 3 && per / n < 2.8 + gap + 0.02) n--;
      const pts = [];
      for (let k = 0, i = 0, acc = 0; k < n; k++) { const want = (k * per * ppm) / n; while (acc + seg[i] < want) acc += seg[i++]; const t = (want - acc) / (seg[i] || 1), A = P[i], B = P[(i + 1) % P.length]; pts.push([A[0] + t * (B[0] - A[0]), A[1] + t * (B[1] - A[1])]); }
      for (const [x, y] of pts) if (at(fg, x, y) && fits(x, y, 2.8)) { add({ x, y, physMm: 2.8, mat: 'gold', imgLab: lab(beadColor(img, x, y, 2.8, ppm)), score: 0, from: 'border', border: bd.id }); bd.n++; }
      bd.stepMm = +(per / n).toFixed(2); bd.slots = n;
    });
    if (o.border === 'print') paintPoly(drawnPoly(b, gap + bandMm)); // dải in; chuỗi: chỗ trống quanh chuỗi để lấp tiếp xúc
    borders.push(bd); b.border = bd.id;
  }
  if (o.chainLate === false) chainJobs.splice(0).forEach((f) => f()); // như KIT-16: chuỗi trước hạt DETECT
  // viên to cố định tròn ≥ gemMinMm không có viền vàng: vòng hạt quanh nó như đá quý KIT-12b (ring: false trong JSON để tắt)
  if (o.bigFixed) gems = objects.filter((b) => b.fixedE && !b.shape && b.border === undefined && b.ringSet !== false && (b.ringSet === true || b.dEqMm >= (o.gemMinMm ?? 6)));
  for (const b of o.bigStones || []) add({ x: b.x, y: b.y, physMm: b.physMm, mat: cat.codes[b.code] ? materialOf(cat.codes[b.code]) : 'facet', fixedCode: b.code, from: 'big', imgLab: lab(discFeatures(img, b.x, b.y, Math.min(b.physMm, 6), ppm)?.rgb || [128, 128, 128]) });
  // mặc định (detectSmall ≠ true): hạt nền/vàng 2.8 mm không lấy từ DETECT (tâm lệch, xếp thưa) — để lấp khe xếp sát lo; viên ≥ 4 mm, ngọc vẫn 1:1
  // 2a. viền hạt quanh đá quý: cả vòng 1 cỡ, đặt trước hạt DETECT, sau cùng ép 1 mã
  const rings = [];
  if (o.gemRings !== false) gems.forEach((g, gi) => {
    const rb = gemRing(img, ppm, keep, g, { gapMm: gap, ringId: gi });
    const ok = [];
    for (const b of rb) if (inside(b.x, b.y) && fits(b.x, b.y, b.physMm) && !ok.some((u) => Math.hypot(u.x - b.x, u.y - b.y) / ppm < b.physMm + gap)) ok.push(b);
    if (!rb.length || ok.length < 0.6 * rb.length) return;
    const vote = new Map();
    for (const b of ok) { const [L, C] = lch(b.imgLab), m = isGoldLab(b.imgLab) ? 'gold' : b.physMm >= 5 && L >= 70 && C <= 15 ? 'pearl' : 'base'; vote.set(m, (vote.get(m) || 0) + 1); }
    const mat = [...vote].sort((a, b) => b[1] - a[1])[0][0];
    if (!hasClass(mat, ok[0].physMm)) return;
    for (const b of ok) { b.mat = mat; add(b); }
    // dải vòng (đường tâm nối các hạt vòng kề nhau theo góc, bán kính d/2 + khe) cấm hạt khác: khe giữa hạt vòng không bị lấp 2.8 mm khác mã
    if (o.ringBand !== false) {
      const srt = [...ok].sort((p, q) => Math.atan2(p.y - g.y, p.x - g.x) - Math.atan2(q.y - g.y, q.x - g.x)), R = (ok[0].physMm / 2 + gap) * ppm, maxL = 3 * (ok[0].pitchMm || ok[0].physMm) * ppm;
      for (let i = 0; i < srt.length; i++) {
        const A = srt[i], B = srt[(i + 1) % srt.length], L = Math.hypot(B.x - A.x, B.y - A.y);
        if (L > maxL) continue;
        const x0 = Math.floor(Math.min(A.x, B.x) - R), x1 = Math.ceil(Math.max(A.x, B.x) + R), y0 = Math.floor(Math.min(A.y, B.y) - R), y1 = Math.ceil(Math.max(A.y, B.y) + R);
        for (let y = Math.max(0, y0); y <= Math.min(img.h - 1, y1); y++) for (let x = Math.max(0, x0); x <= Math.min(img.w - 1, x1); x++) {
          const t = L ? clampI(((x - A.x) * (B.x - A.x) + (y - A.y) * (B.y - A.y)) / (L * L), 0, 1) : 0;
          if (Math.hypot(x - A.x - t * (B.x - A.x), y - A.y - t * (B.y - A.y)) <= R) keep[y * img.w + x] = 1;
        }
      }
    }
    rings.push({ gem: gi, n: ok.length, peaks: rb.length, onPeaks: rb[0].onPeaks, physMm: rb[0].physMm, pitchMm: +rb[0].pitchMm.toFixed(2) });
  });
  const order = beads.filter((b) => o.detectSmall === true || b.physMm >= (o.detectMinMm ?? 4) || (b.mat === 'pearl' && o.detectPearls !== false)).sort((a, b) => b.physMm - a.physMm || b.score - a.score);
  let dropped = 0;
  for (const b of order) {
    let ok = null;
    if (!hasClass(b.mat, b.physMm)) { const d2 = (MATERIAL_SIZES[b.mat] || []).filter((v) => v < b.physMm && v >= 4 && hasClass(b.mat, v)).pop(); if (!d2) { dropped++; b.dropped = 'pool'; continue; } b.physMm = d2; }
    if (fits(b.x, b.y, b.physMm)) ok = { x: b.x, y: b.y, physMm: b.physMm, from: 'detect' };
    for (let r = 0.2; !ok && r <= 0.6 + 1e-6; r += 0.2) for (let a = 0; a < 8 && !ok; a++) {
      const x = b.x + Math.cos((a * Math.PI) / 4) * r * ppm, y = b.y + Math.sin((a * Math.PI) / 4) * r * ppm;
      if (inside(x, y) && fits(x, y, b.physMm)) ok = { x, y, physMm: b.physMm, from: 'nudge' };
    }
    if (!ok && (b.mat === 'base' || b.mat === 'gold')) { const d = MATERIAL_SIZES[b.mat].filter((v) => v < b.physMm).reverse().find((v) => fits(b.x, b.y, v)); if (d) ok = { x: b.x, y: b.y, physMm: d, from: 'shrink' }; }
    if (ok) add({ ...ok, mat: b.mat, imgLab: b.imgLab, score: b.score }); else { dropped++; b.dropped = true; }
  }
  // 2b. nối chuỗi: quanh mỗi viên ≥ 4 mm đã nhận, thử chỗ tiếp xúc cùng cỡ (24 hướng); nhận nếu thân hạt ở đó cùng màu (ΔE00 <
  // chainDE) và có dạng hạt (lõi 0.5r sáng hơn vành 0.9–1.1r ≥ rimMin xám) → vòng / chuỗi ngọc DETECT sót được nối đủ, cùng cỡ.
  const grayAt = (x, y) => { const j = (clampI(Math.round(y), 0, img.h - 1) * img.w + clampI(Math.round(x), 0, img.w - 1)) * 4; return 0.299 * img.data[j] + 0.587 * img.data[j + 1] + 0.114 * img.data[j + 2]; };
  const ring = (x, y, r0, r1) => { let v = 0, n = 0; for (let a = 0; a < 24; a++) for (let t = r0; t <= r1 + 1e-6; t += (r1 - r0) / 2 || 1) { v += grayAt(x + Math.cos((a * Math.PI) / 12) * t, y + Math.sin((a * Math.PI) / 12) * t); n++; } return v / n; };
  let chained = 0;
  if (o.chains !== false) {
    // hạt chuỗi trắng (ngọc / nền sáng ít màu); chỉ nối TIẾP hướng chuỗi: ngược hướng 1 láng giềng cùng cỡ đã có ± chainDeg
    const white = (t) => { const [L, C] = lch(t.imgLab); return t.mat === 'pearl' || (t.mat === 'base' && L >= 70 && C <= 15); };
    const q = placed.filter((t) => t.physMm >= 4 && t.from !== 'big' && white(t)), maxDeg = ((o.chainDeg ?? 35) * Math.PI) / 180;
    const sameNbr = (t) => q.filter((u) => u !== t && u.physMm === t.physMm && Math.hypot(u.x - t.x, u.y - t.y) / ppm < t.physMm + gap + 0.8);
    for (let qi = 0; qi < q.length && chained < 3000; qi++) {
      const sd = q[qi], R = (sd.physMm / 2) * ppm, dist = (sd.physMm + gap) * ppm, col = lab(beadColor(img, sd.x, sd.y, sd.physMm, ppm));
      const dirs = sameNbr(sd).map((u) => Math.atan2(sd.y - u.y, sd.x - u.x));
      if (!dirs.length) continue;
      for (let a = 0; a < 24; a++) {
        const ang = (a * Math.PI) / 12;
        if (!dirs.some((d0) => Math.abs(Math.atan2(Math.sin(ang - d0), Math.cos(ang - d0))) <= maxDeg)) continue;
        const x = sd.x + Math.cos(ang) * dist, y = sd.y + Math.sin(ang) * dist;
        if (!inside(x, y) || !fits(x, y, sd.physMm)) continue;
        const c = lab(beadColor(img, x, y, sd.physMm, ppm));
        if (de2000(c, col) > (o.chainDE ?? 8)) continue;
        if (ring(x, y, 0, 0.5 * R) - ring(x, y, 0.9 * R, 1.1 * R) < (o.rimMin ?? 10)) continue;
        const n = { x, y, physMm: sd.physMm, mat: sd.mat, imgLab: c, score: 0, from: 'chain' };
        add(n); q.push(n); chained++;
      }
    }
  }
  for (const f of chainJobs) f();
  // 3. lấp khe (L 2.8, khe gap) trong trang phục, ngoài vùng giữ chỗ
  let fill = o.fill === false ? [] : tangentFill(placed, inside, ppm, { d: 2.8, gapMm: gap, w: img.w, h: img.h, hex: o.hexFill ?? true, angle: o.hexAngle ?? 0 });
  // KIT-18 lấp dày quanh vật cản (lib/kit/pack.js): chèn viên vào lỗ + nới viên lấp; o.densify false để tắt
  let dens = null;
  if (fill.length && o.densify !== false) {
    const cOk = new Uint8Array(img.w * img.h);
    for (let j = 0; j < cOk.length; j++) cOk[j] = fg[j] && !keep[j] ? 1 : 0;
    const dz = densify({ w: img.w, h: img.h, ppm, d: 2.8, gapMm: gap, fixed: placed, movable: fill, centreOk: cOk, ...o.densifyOpt });
    dens = { before: fill.length, after: dz.stones.length, added: dz.added, tried: dz.tried }; fill = dz.stones;
  }
  // o.oneMaterial (nền vẽ phẳng): mọi hạt lấp = 1 lớp 'base', mọi mã tròn không ngọc cùng cỡ đều được (cam / xám không bị chặn vì không tên 'vàng')
  for (const s of fill) { s.imgLab = lab(beadColor(img, s.x, s.y, o.fillColorMm ?? 3.4, ppm)); s.mat = !o.oneMaterial && isGoldLab(s.imgLab) ? 'gold' : 'base'; placed.push(s); }
  // 4. mã: mục tiêu màu → ≤ maxCodes mã trong lớp vật liệu + cỡ → Potts trên viên chạm nhau
  for (const s of placed) s.target = o.color ? predictLab(o.color, s.imgLab, o.colorOpt) : s.imgLab;
  const allowed = (s, e) => (s.fixedCode ? e.code === s.fixedCode : !e.shape && (o.oneMaterial && s.mat !== 'pearl' ? e.kind !== 'pearl' : materialOf(e) === s.mat) && Math.abs(e.physMm - s.physMm) < 1e-6);
  // vàng không xỉn: trong lớp vàng phạt thêm mã TỐI hơn ảnh (ΔL* > 0) × goldWL — hạt vàng sáng sang L23 thay vì L16 tối hơn ảnh 9 L*
  const deGold = deGoldF(o.goldWL ?? 1);
  const distOf = (s) => (s.mat === 'gold' ? deGold : de2000);
  const shrink = (s, e) => (!s.fixedCode && !e.shape && e.physMm < s.physMm - 1e-6 && (e.kind === 'pearl') === (s.mat === 'pearl') ? o.shrinkPenalty ?? 80 : Infinity);
  o.onStones?.(placed, { allowed, distOf, shrink });
  const chosen = chooseCodes(placed, cat, { pool, maxCodes: pool ? pool.size : o.maxCodes ?? 13, ...(o.minGain !== undefined && { minGain: o.minGain }), metric: 'de00', allowed, distOf, shrink, prefer: o.preferCodes ? new Set(o.preferCodes) : null, preferDE: o.preferDE ?? 3, force: [...new Set(placed.filter((s) => s.fixedCode).map((s) => s.fixedCode))] });
  let shrunk = 0;
  placed.forEach((s, i) => { const e = chosen.pick[i]; s.code = e?.code; if (e && !allowed(s, e)) { s.physMm = e.physMm; s.mat = materialOf(e); shrunk++; const b = objects.find((q) => q.id === s.bigId); if (b) b.placed = e.physMm; } });
  // viên không có mã cùng lớp + cỡ trong ngân sách: lấy mã đã chọn gần nhất có cỡ ≤ (cùng chỗ, nhỏ hơn thì vẫn vừa)
  for (const s of placed) if (!s.code) {
    const c = chosen.codes.map((k) => cat.codes[k]).filter((e) => e && e.physMm <= s.physMm + 1e-6 && (e.kind === 'pearl') === (s.mat === 'pearl'))
      .map((e) => ({ e, c: distOf(s)(s.target, lab(hex2(e.fill))) + (o.bigWS ?? 25) * Math.abs(Math.log(e.physMm / s.physMm)) })).sort((p, q) => p.c - q.c)[0];
    if (c) { s.code = c.e.code; s.physMm = c.e.physMm; s.mat = materialOf(c.e); s.fixedCode = c.e.code; const b = objects.find((q) => q.id === s.bigId); if (b) b.placed = c.e.physMm; }
  }
  // KIT-18 lấp lần 2: chỗ trống do viên thu cỡ (thiếu mã) / vật trắng không vừa → lấp tiếp xúc 2.8 lần nữa, mã = mã đã chọn gần nhất cùng lớp
  if (o.refill !== false && o.fill !== false) {
    const codesE = chosen.codes.map((k) => entryOf(k, cat)).filter(Boolean);
    for (const s of tangentFill(placed.filter((t) => t.code), inside, ppm, { d: 2.8, gapMm: gap, w: img.w, h: img.h })) {
      s.imgLab = lab(beadColor(img, s.x, s.y, o.fillColorMm ?? 3.4, ppm)); s.mat = !o.oneMaterial && isGoldLab(s.imgLab) ? 'gold' : 'base';
      s.target = o.color ? predictLab(o.color, s.imgLab, o.colorOpt) : s.imgLab;
      const cs = codesE.filter((e) => allowed(s, e)), cand = cs.length ? cs : codesE.filter((e) => !e.shape && e.kind !== 'pearl' && Math.abs(e.physMm - 2.8) < 1e-6);
      const e = cand.map((q) => [distOf(s)(s.target, lab(hex2(q.fill))), q]).sort((p, q) => p[0] - q[0])[0]?.[1];
      if (e) { s.code = e.code; s.mat = materialOf(e); s.from = 'refill'; placed.push(s); }
    }
  }
  const lost = placed.filter((s) => !s.code).length;
  const st = placed.filter((s) => s.code), edges = touchEdges(st, ppm, { sigma: o.sigmaCode ?? 10 });
  const before = flipRate(st, edges), beforeSim = flipRateSimilar(st, edges), codeLab = Object.fromEntries(chosen.codes.map((c) => [c, lab(hex2(entryOf(c, cat).fill))]));
  const lamC = o.lambdaCode ?? 12;
  const icm = pottsICM(st.length, (i) => chosen.codes.filter((c) => allowed(st[i], entryOf(c, cat))), (i, c) => distOf(st[i])(st[i].target, codeLab[c]), edges, lamC);
  st.forEach((s, i) => { s.code = icm.lab[i]; });
  // vòng quanh đá quý = 1 mã: mã đa số trong vòng (cùng cỡ + vật liệu)
  for (const rg of rings) {
    const mem = st.filter((t) => t.ring === rg.gem && t.from === 'ring'), cnt = new Map();
    for (const t of mem) cnt.set(t.code, (cnt.get(t.code) || 0) + 1);
    const top = [...cnt].sort((a, b) => b[1] - a[1])[0]?.[0];
    rg.codesBefore = cnt.size; rg.code = top;
    for (const t of mem) t.code = top;
  }
  for (const bd of borders) {
    const mem = st.filter((t) => t.from === 'border' && t.border === bd.id), cnt = new Map();
    for (const t of mem) cnt.set(t.code, (cnt.get(t.code) || 0) + 1);
    bd.code = [...cnt].sort((a, b) => b[1] - a[1])[0]?.[0];
    for (const t of mem) t.code = bd.code;
  }
  const after = flipRate(st, edges), afterSim = flipRateSimilar(st, edges);
  const fgN = fg.reduce((a, v) => a + v, 0), area = fgN / (ppm * ppm);
  const coverage = st.reduce((a, s) => a + (s.shape ? polyAreaMm2(s) : Math.PI * (s.physMm / 2) ** 2), 0) / area;
  let keepN = 0;
  for (let j = 0; j < keep.length; j++) if (keep[j] && fg[j]) keepN++;
  const coverageNoGems = (coverage * area) / ((fgN - keepN) / (ppm * ppm));
  const doc = buildDoc(img, st, cat, ppm, canvasMm, { mode: objects.length ? 'kit-14 costume' : 'kit-12b costume', gapMm: gap, maxCodes: o.maxCodes ?? 13, lambdaSize: lamS, lambdaCode: lamC, coverageOf: 'foreground' });
  const mats = {};
  for (const s of st) mats[s.mat] = (mats[s.mat] || 0) + 1;
  const big = { objects: objects.length, placed: objects.filter((b) => b.placed).length, dropped: bigDropped, fromVlm: objects.filter((b) => b.hint !== undefined).length, vlmIn: vlm.length,
    sizes: Object.fromEntries([...new Set(objects.filter((b) => b.placed).map((b) => `${b.mat}${b.placed}`))].map((k) => [k, objects.filter((b) => b.placed && `${b.mat}${b.placed}` === k).length])),
    list: objects.map((b) => ({ x: Math.round(b.x), y: Math.round(b.y), axesMm: [+b.aMm.toFixed(1), +b.bMm.toFixed(1)], boxMm: +b.boxMm.toFixed(1), kMm: +b.kMm.toFixed(1), mat: b.mat, keep: b.keep, hint: b.hint, physMm: b.placed, code: st.find((s) => s.bigId === b.id)?.code, shape: b.shape || undefined, drawnMm: b.shape ? [+b.shortMm.toFixed(1), +b.longMm.toFixed(1)] : undefined, rotDeg: b.shape ? Math.round(b.rotDeg) : undefined, thDeg: Math.round((b.th * 180) / Math.PI), goldFrac: b.goldFrac, fid: b.fid, src: b.src, vlm: b.vlm, flags: b.flags })) };
  return { doc, placed: st, detected: det.stones.length, beads, whites, dens, dropped, lost, gems, rings, borders, objects, big, keepOut: keep, coverage, coverageNoGems, fgAreaMm2: area, materials: mats,
    shrunk, from: Object.fromEntries(['big', 'white', 'border', 'ring', 'detect', 'nudge', 'shrink', 'chain', 'fill', 'refill'].map((k) => [k, st.filter((s) => s.from === k).length])),
    flip: { codeBefore: before, codeAfter: after, similarBefore: beforeSim.rate, similarAfter: afterSim.rate, similarEdges: beforeSim.edges, codeChanged: icm.changed, edges: edges.length, size: sizeStats },
    codeCost: st.reduce((a, s) => a + de2000(s.target, codeLab[s.code]), 0) / st.length, geom: summarizeGeom(geomStats(st, ppm)), ms: Date.now() - t0 };
}
