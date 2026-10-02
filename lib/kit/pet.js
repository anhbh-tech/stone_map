// KIT-17: luồng thú cưng KHÔNG gọi API — (ảnh đã phóng ×4, lib/kit/upscale.js) → tâm hạt LoG đa cỡ (2.8 / 4 / 5 mm, detectBeads)
// → mã từng viên bằng k-NN học từ bảng stones (kit/db/kit.sqlite: màu ảnh img_mean_hex Lab + độ lấp lánh + size vật lý) thay cho
// "màu catalog gần nhất" → (tuỳ chọn) chuỗi theo hướng (flow). Chấm bằng tools/bench_kit_real.mjs (mode pet, một điểm số).
// Mã luôn thuộc `bom` đưa vào (bộ mã của thiết kế; bench = BOM thật của sản phẩm, như cách (b) của KIT-9).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { detectBeads, beadFeatures, physOf, refOf, gauss } from './detect.js';
import { edgeGap } from '../stonemap/geom.js';
import { readKitSvg } from './svgio.js';

const DB = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'kit', 'db', 'kit.sqlite');
export const PET = {
  // bench (docs/KIT-DATA.md §8): 2.8 / 4 mm + viên to (bigObjects) hơn 2.8 / 4 / 5 mm (66.0 vs 63.6); thêm ngọc trai, ngưỡng 0.7, chuỗi ETF
  // không tăng điểm (≤ +0.1) → tắt
  detect: { stoneMm: 2.2, accentMm: [3.2], pearls: false, big: true, gapMm: 0.4 },
  k: 15, wSize: 6, wStd: 0.3, code: 'resid', chainSnap: false, chainFill: false, chainDrop: false,
  sizeCost: 2, // viên to: chọn size+mã theo ΔE + 2·mm bớt (bench 66.0 → 66.1; mũi đen Queen khỏi thành 12 mm Q152 nâu vàng)
  bigNearestMm: 5, // viên ≥ 5 mm: màu gần nhất (ít mẫu to để học phần dư; mũi đen thú cưng thành vàng) — bench 66.0 = 66.0
  upMinPpm: 5, // ảnh < 5 px/mm (hạt 2.8 mm < 14 px) → phóng ×4 trước (÷6: 61.5 → 64.8; ÷3: ±0.2)
};
export function lab([r, g, b]) {
  const lin = (v) => { v /= 255; return v > 0.04045 ? ((v + 0.055) / 1.055) ** 2.4 : v / 12.92; };
  const R = lin(r), G = lin(g), B = lin(b);
  const X = (0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047, Y = 0.2126 * R + 0.7152 * G + 0.0722 * B, Z = (0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883;
  const h = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * h(Y) - 16, 500 * (h(X) - h(Y)), 200 * (h(Y) - h(Z))];
}
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const de = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

// Mẫu học: mọi viên của `products` (leave-one-product-out: bench truyền sản phẩm KHÁC sản phẩm đang chấm).
export function codeModel(products, dbFile = DB) {
  const db = new DatabaseSync(dbFile, { readOnly: true });
  const rows = db.prepare(`SELECT product, code, physical_mm d, img_mean_hex h, img_std sd, catalog_hex c, catalog_family fam FROM stones
    WHERE product IN (${products.map(() => '?').join(',')}) AND img_mean_hex IS NOT NULL AND catalog_hex IS NOT NULL`).all(...products);
  db.close();
  return { products, pts: rows.map((r) => { const l = lab(hex(r.h)), c = lab(hex(r.c)); return { lab: l, sd: r.sd, d: r.d, code: r.code, fam: r.fam, cat: c, res: c.map((v, i) => v - l[i]) }; }) };
}
// k láng giềng theo [Lab ảnh, std·wStd, size·wSize]
function knn(model, f, o) {
  const best = [];
  for (const p of model.pts) {
    const dd = (p.lab[0] - f.lab[0]) ** 2 + (p.lab[1] - f.lab[1]) ** 2 + (p.lab[2] - f.lab[2]) ** 2 + (o.wStd * (p.sd - f.sd)) ** 2 + (o.wSize * (p.d - f.d)) ** 2;
    if (best.length < o.k) { best.push([dd, p]); best.sort((a, b) => a[0] - b[0]); } else if (dd < best[o.k - 1][0]) { best[o.k - 1] = [dd, p]; best.sort((a, b) => a[0] - b[0]); }
  }
  return best;
}
// f = { lab, sd, d (vật lý) } → mã trong bom [{ code, physMm, lab }]. o.code:
//  'nearest' = màu ảnh → mã bom gần nhất (mốc KIT-9 b); 'resid' = màu ảnh + phần dư (catalog − ảnh) TB có trọng số của k láng giềng → mã
//  bom gần nhất; 'vote' = láng giềng có mã trong bom bỏ phiếu (trọng số 1/(d+1)), không ai → 'resid'.
export function predictCode(model, f, bom, o = PET) {
  const same = bom.filter((b) => Math.abs(b.physMm - f.d) < 1e-6), pool = same.length ? same : bom;
  const nearestTo = (L) => pool.reduce((a, b) => (de(L, b.lab) < de(L, a.lab) ? b : a)).code;
  if (o.code === 'nearest' || !model || f.d >= (o.bigNearestMm ?? Infinity)) return nearestTo(f.lab);
  const nb = knn(model, f, o);
  if (o.code === 'vote') {
    const codes = new Set(pool.map((b) => b.code)), v = new Map();
    for (const [dd, p] of nb) if (codes.has(p.code)) v.set(p.code, (v.get(p.code) || 0) + 1 / (Math.sqrt(dd) + 1));
    if (v.size) return [...v].sort((a, b) => b[1] - a[1])[0][0];
  }
  return nearestTo(residLab(nb, f));
}
const residLab = (nb, f) => {
  let w = 0; const r = [0, 0, 0];
  for (const [dd, p] of nb) { const wi = 1 / (Math.sqrt(dd) + 1); w += wi; for (let i = 0; i < 3; i++) r[i] += wi * p.res[i]; }
  return f.lab.map((v, i) => v + r[i] / w);
};
// Màu đích (Lab) mà predictCode chọn mã theo: 'resid' = màu ảnh + phần dư k-NN; nearest / viên to = màu ảnh.
export function targetLab(model, f, o = PET) {
  if (o.code === 'nearest' || !model || f.d >= (o.bigNearestMm ?? Infinity)) return f.lab;
  return residLab(knn(model, f, o), f);
}

// KIT-19: ép bảng mã chung của sản phẩm. items [{ t: Lab đích, physMm }] → { base, added, assign: [entry bom] }.
// Mỗi viên lấy mã có chi phí nhỏ nhất trong base ∪ added: ΔE76(đích, catalog) + sizeCost·(mm bớt); không bao giờ to hơn viên đo
// (khỏi đè hàng xóm), 4 mm thiếu màu thì xuống 2.8. added = tối đa maxNew mã ngoài base, chọn tham lam theo tổng ΔE giảm được.
export function fitPalette(items, bom, { codes, maxNew = 2, sizeCost = PET.sizeCost } = {}) {
  const by = new Map(bom.map((b) => [b.code, b])), base = [...new Set(codes)].filter((c) => by.has(c));
  const cost = (it, b) => (b.physMm > it.physMm + 1e-6 ? Infinity : de(it.t, b.lab) + sizeCost * (it.physMm - b.physMm));
  const K = base.map((c) => by.get(c)), best = items.map((it) => Math.min(Infinity, ...K.map((b) => cost(it, b)))), added = [];
  for (let n = 0; n < maxNew; n++) {
    let top = null, gain = 0;
    for (const b of bom) {
      if (K.includes(b)) continue;
      let g = 0; for (let i = 0; i < items.length; i++) { const c = cost(items[i], b); if (c < best[i]) g += Math.min(best[i], 1e3) - c; }
      if (g > gain) { gain = g; top = b; }
    }
    if (!top) break;
    K.push(top); added.push(top.code);
    items.forEach((it, i) => { best[i] = Math.min(best[i], cost(it, top)); });
  }
  if (!K.length) throw new Error('fitPalette: bảng mã rỗng (không mã nào của codes có trong bom, maxNew 0)');
  // không mã nào ≤ cỡ viên (bảng không có 2.8) → màu gần nhất bất kỳ cỡ
  const assign = items.map((it) => K.reduce((a, b) => { const ca = cost(it, a), cb = cost(it, b); return cb < ca || (ca === Infinity && cb === Infinity && de(it.t, b.lab) < de(it.t, a.lab)) ? b : a; }));
  return { base, added, assign };
}

// KIT-19: bảng mã chung Queen + Starry = kit/templates/product_queen_starry_palette.json (KIT-18: { codes: [...] } hoặc
// { palette: [{ code }] }); chưa có → tạm hợp mã starry_template.json + palette của queen_costume_chain.svg. → { codes, from }
export function productPalette(dir = path.join(path.dirname(DB), '..', 'templates')) {
  const f = path.join(dir, 'product_queen_starry_palette.json');
  if (fs.existsSync(f)) { const j = JSON.parse(fs.readFileSync(f, 'utf8')); return { codes: (j.codes || j.palette.map((e) => e.code)).map(String), from: f }; }
  const starry = JSON.parse(fs.readFileSync(path.join(dir, 'starry_template.json'), 'utf8')).codes;
  const queen = readKitSvg(fs.readFileSync(path.join(dir, 'queen_costume_chain.svg'), 'utf8')).palette.map((e) => e.code);
  return { codes: [...new Set([...queen, ...starry])], from: 'tạm: queen_costume_chain.svg ∪ starry_template.json (chưa có product_queen_starry_palette.json)' };
}

// KIT-19: viên pet không được đè/sát viên lớp khác (trang phục): khe mép-mép VẬT LÝ ≥ gapMm (lib/stonemap/geom.js edgeGap, mọi shape).
// stones/others dạng stonemap { x_mm, y_mm, phys_mm, ref_mm, shape, rot_deg, code }. Viên > 2.8 mm sát → thử thu về 2.8 (shrink(s) trả
// viên mới), vẫn sát → bỏ. → { stones, dropped, shrunk }
export function keepOut(stones, others, { gapMm = 0.15, cat, shrink = null } = {}) {
  const cell = 12, grid = new Map(), key = (x, y) => `${Math.floor(x / cell)},${Math.floor(y / cell)}`;
  for (const o of others) { const k = key(o.x_mm, o.y_mm); (grid.get(k) || grid.set(k, []).get(k)).push(o); }
  const clash = (s) => { const gx = Math.floor(s.x_mm / cell), gy = Math.floor(s.y_mm / cell);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) for (const o of grid.get(`${gx + dx},${gy + dy}`) || [])
      if (Math.hypot(o.x_mm - s.x_mm, o.y_mm - s.y_mm) < (o.phys_mm + s.phys_mm) / 2 + gapMm + 1e-9 && edgeGap(s, o, cat) < gapMm - 1e-9) return true;
    return false; };
  const out = []; let dropped = 0, shrunk = 0;
  for (const s of stones) {
    if (!clash(s)) { out.push(s); continue; }
    const t = s.phys_mm > 2.8 + 1e-6 && shrink ? shrink(s) : null;
    if (t && !clash(t)) { out.push(t); shrunk++; } else dropped++;
  }
  return { stones: out, dropped, shrunk };
}

// img RGBA (có thể đã phóng); o: { canvasWmm, mask, model, bom, ...PET } → { stones: [{ x, y (px ảnh), physMm, dMm, code, lab }], work }
export function petMap(img, o) {
  const p = { ...PET, ...o, detect: { ...PET.detect, ...(o.detect || {}) } }, kImg = img.w / p.canvasWmm;
  const det = detectBeads(img, { canvasWmm: p.canvasWmm, ...p.detect }, p.mask || null);
  let st = det.stones.map((s) => {
    const physMm = s.physMm, ft = beadFeatures(img, s.x, s.y, 0.35 * physMm * kImg); // như build_kit_db.py: đĩa 0.35 × size vật lý
    return { x: s.x, y: s.y, physMm, dMm: refOf(physMm), score: s.score, f: { lab: lab(ft.rgb), sd: ft.std, d: physMm } };
  });
  if (p.chainSnap || p.chainFill || p.chainDrop) st = chainFlow(img, st, kImg, p);
  if (p.noOverlap) st = resolveOverlap(st, kImg, p.minGapMm ?? -0.05, p.noOverlap);
  for (const s of st) {
    // viên to: chọn (size, mã) cùng lúc trong bom ≤ size đo: ΔE + sizeCost·(mm bớt) — catalog to ít màu (12 mm chỉ có Q152 nâu vàng),
    // mũi/mắt đen thú cưng phải xuống 8 / 6 mm đen thay vì 12 mm vàng
    if (p.sizeCost && s.physMm >= 5) {
      const pool = p.bom.filter((b) => b.physMm >= 5 && b.physMm <= s.physMm + 1e-6);
      if (pool.length) { const b = pool.reduce((a, c) => (de(s.f.lab, c.lab) + p.sizeCost * (s.physMm - c.physMm) < de(s.f.lab, a.lab) + p.sizeCost * (s.physMm - a.physMm) ? c : a));
        s.code = b.code; s.physMm = b.physMm; s.dMm = refOf(b.physMm); }
    } else s.code = predictCode(p.model, s.f, p.bom, p);
    s.lab = s.f.lab.map((v) => Math.round(v * 10) / 10);
  }
  const work = { detected: det.stones.length, ...det.work };
  // KIT-19 o.palette = { codes, maxNew }: chọn lại mã trong bảng chung (+ ≤ maxNew mã mới); ΔE76 đích↔catalog: deFree (mọi mã bom) vs deForced (bảng ép)
  if (p.palette) {
    const by = new Map(p.bom.map((b) => [b.code, b])), items = st.map((s) => ({ t: s.physMm >= 5 ? s.f.lab : targetLab(p.model, s.f, p), physMm: s.f.d }));
    const fp = fitPalette(items, p.bom, { sizeCost: p.sizeCost, ...p.palette }), mean = (a) => a.reduce((x, y) => x + y, 0) / (a.length || 1);
    // deFree = cùng luật chọn nhưng mọi mã bom (không ép); deModel = mã petMap gốc (4 mm chỉ chọn trong 4 mm)
    const free = fitPalette(items, p.bom, { sizeCost: p.sizeCost, codes: p.bom.map((b) => b.code), maxNew: 0 }).assign;
    const deModel = mean(st.map((s, i) => de(items[i].t, by.get(s.code).lab))), deFree = mean(free.map((b, i) => de(items[i].t, b.lab))), deForced = mean(fp.assign.map((b, i) => de(items[i].t, b.lab)));
    let changed = 0, resized = 0;
    st.forEach((s, i) => { const b = fp.assign[i]; if (b.code !== s.code) { changed++; s.free = s.code; s.code = b.code; } if (b.physMm !== s.physMm) { resized++; s.physMm = b.physMm; s.dMm = refOf(b.physMm); } });
    work.palette = { base: fp.base, added: fp.added, used: [...new Set(st.map((s) => s.code))].length, changed, resized, deModel: +deModel.toFixed(2), deFree: +deFree.toFixed(2), deForced: +deForced.toFixed(2), freeCodes: new Set(free.map((b) => b.code)).size };
  }
  for (const s of st) delete s.f;
  return { stones: st, work };
}

// KIT-19: viên pet không chồng nhau trên cỡ VẬT LÝ (khe mép-mép ≥ minGapMm; −0.05 = ngưỡng chồng của QC overlap).
// Lượt 1 giữ viên: viên to (≥ 5 mm) trước theo cỡ, rồi theo score; viên nhỏ xét ở 2.8 mm. Lượt 2 trả viên đo 4 mm về 4 mm nếu còn chỗ.
// (DETECT hay đo hạt 2.8 thành 4 mm trên ảnh mẫu → 4 mm đè hàng xóm; ảnh Queen: 942 cặp chồng, trung vị khe −0.66 mm.)
export function resolveOverlap(st, kImg, minGapMm = -0.05, how = true) {
  const cell = 9 * kImg, grid = new Map(), key = (x, y) => `${Math.floor(x / cell)},${Math.floor(y / cell)}`;
  const fits = (s, d, self) => { const gx = Math.floor(s.x / cell), gy = Math.floor(s.y / cell);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) for (const t of grid.get(`${gx + dx},${gy + dy}`) || [])
      if (t !== self && Math.hypot(t.x - s.x, t.y - s.y) / kImg - (t.physMm + d) / 2 < minGapMm - 1e-9) return false;
    return true; };
  const big = (s) => s.physMm >= 5, order = [...st].sort((a, b) => big(b) - big(a) || (big(a) ? b.physMm - a.physMm : 0) || (b.score || 0) - (a.score || 0));
  const out = [];
  for (const s of order) {
    let d = big(s) || how === 'size' ? s.physMm : Math.min(s.physMm, 2.8);
    if (!fits(s, d, null)) { if (how === 'size' && d > 2.8 && !big(s) && fits(s, 2.8, null)) d = 2.8; else continue; }
    const t = { ...s, physMm: d, dMm: refOf(d), measuredMm: s.physMm }, k = key(t.x, t.y);
    (grid.get(k) || grid.set(k, []).get(k)).push(t); out.push(t);
  }
  for (const t of out) if (t.measuredMm > t.physMm && fits(t, t.measuredMm, t)) { t.physMm = t.measuredMm; t.dMm = refOf(t.physMm); }
  for (const t of out) { if (t.f) t.f = { ...t.f, d: t.physMm }; delete t.measuredMm; }
  return out;
}

// Chuỗi theo hướng (ETF): hướng nét t = vector riêng nhỏ của tensor cấu trúc (gradient xám, làm mượt σ = 1 bước hạt) — dòng hạt
// dán dọc nét vẽ. Láng giềng "trên dòng" = trong 1.6 bước và lệch ≤ 30° so với ±t.
//  chainSnap: viên có láng giềng dòng ở 2 phía → kéo nửa đường về đoạn nối 2 láng giềng (chỉ thành phần vuông góc t)
//  chainFill: 2 viên trên dòng cách 1.7–2.4 bước mà trung điểm trống (không viên nào < 0.6 bước) → thêm 1 viên 2.8 mm ở trung điểm
//  chainDrop: viên không có láng giềng nào trong 1.6 bước → bỏ
// Đánh giá bằng bench; chỉ bật mặc định khi tăng điểm.
export function chainFlow(img, st, kImg, p) {
  const pitch = (physOf(p.detect.stoneMm) + p.detect.gapMm) * kImg, f = Math.max(1, Math.round(pitch / 6)), W = Math.floor(img.w / f), H = Math.floor(img.h / f);
  const g = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { let v = 0; for (let b = 0; b < f; b++) for (let a = 0; a < f; a++) { const j = ((y * f + b) * img.w + x * f + a) * 4; v += 0.299 * img.data[j] + 0.587 * img.data[j + 1] + 0.114 * img.data[j + 2]; } g[y * W + x] = v / (f * f); }
  const gs = gauss(g, W, H, 0.5), xx = new Float32Array(W * H), yy = new Float32Array(W * H), xy = new Float32Array(W * H);
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) { const j = y * W + x, gx = gs[j + 1] - gs[j - 1], gy = gs[j + W] - gs[j - W]; xx[j] = gx * gx; yy[j] = gy * gy; xy[j] = gx * gy; }
  const sg = pitch / f, Sxx = gauss(xx, W, H, sg), Syy = gauss(yy, W, H, sg), Sxy = gauss(xy, W, H, sg);
  const tan = (x, y) => { const j = Math.min(H - 1, Math.max(0, Math.floor(y / f))) * W + Math.min(W - 1, Math.max(0, Math.floor(x / f))), th = 0.5 * Math.atan2(2 * Sxy[j], Sxx[j] - Syy[j]) + Math.PI / 2; return [Math.cos(th), Math.sin(th)]; };
  const cell = 2.5 * pitch, grid = new Map(), key = (x, y) => `${Math.floor(x / cell)},${Math.floor(y / cell)}`;
  const put = (s) => { const k = key(s.x, s.y); (grid.get(k) || grid.set(k, []).get(k)).push(s); };
  st.forEach(put);
  const nbr = (x, y, R, self) => { const out = [], gx = Math.floor(x / cell), gy = Math.floor(y / cell);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) for (const t of grid.get(`${gx + dx},${gy + dy}`) || []) if (t !== self && Math.hypot(t.x - x, t.y - y) < R) out.push(t);
    return out; };
  const out = [], add = [], cos30 = Math.cos(Math.PI / 6);
  for (const s of st) {
    const near = nbr(s.x, s.y, 2.4 * pitch, s), [tx, ty] = tan(s.x, s.y);
    const line = near.map((t) => { const dx = t.x - s.x, dy = t.y - s.y, d = Math.hypot(dx, dy); return { t, d, c: (dx * tx + dy * ty) / d }; }).filter((q) => Math.abs(q.c) >= cos30);
    if (p.chainDrop && !near.some((t) => Math.hypot(t.x - s.x, t.y - s.y) < 1.6 * pitch)) continue;
    let q = s;
    if (p.chainSnap) {
      const fw = line.filter((l) => l.c > 0 && l.d < 1.6 * pitch).sort((a, b) => a.d - b.d)[0], bw = line.filter((l) => l.c < 0 && l.d < 1.6 * pitch).sort((a, b) => a.d - b.d)[0];
      if (fw && bw) { const mx = (fw.t.x + bw.t.x) / 2 - s.x, my = (fw.t.y + bw.t.y) / 2 - s.y, along = mx * tx + my * ty, px = mx - along * tx, py = my - along * ty;
        if (Math.hypot(px, py) < 0.6 * pitch) q = { ...s, x: s.x + 0.5 * px, y: s.y + 0.5 * py }; }
    }
    out.push(q);
    if (p.chainFill) for (const l of line) if (l.c > 0 && l.d >= 1.7 * pitch && l.d <= 2.4 * pitch) {
      const mx = (s.x + l.t.x) / 2, my = (s.y + l.t.y) / 2;
      if (!nbr(mx, my, 0.6 * pitch, null).length && !add.some((a) => Math.hypot(a.x - mx, a.y - my) < 0.6 * pitch)) {
        const ft = beadFeatures(img, mx, my, 0.35 * 2.8 * kImg);
        add.push({ x: mx, y: my, physMm: 2.8, dMm: refOf(2.8), score: 0, fill: true, f: { lab: lab(ft.rgb), sd: ft.std, d: 2.8 } });
      }
    }
  }
  return [...out, ...add];
}

// Ảnh bất kỳ → (phóng ×4 nếu < upMinPpm px/mm) → petMap; toạ độ trả về theo ảnh VÀO (img), mask theo ảnh vào.
export async function runPet(img, o) {
  const p = { ...PET, ...o }, ppm = img.w / p.canvasWmm;
  if (ppm >= p.upMinPpm) return { ...petMap(img, p), upscale: null, img };
  const { upscale4, lanczos } = await import('./upscale.js'), up = await upscale4(img, { force: p.upscale === 'lanczos' ? 'lanczos' : undefined });
  let mask = null;
  if (p.mask) { mask = new Uint8Array(up.img.w * up.img.h); for (let y = 0; y < up.img.h; y++) for (let x = 0; x < up.img.w; x++) mask[y * up.img.w + x] = p.mask[Math.floor(y / 4) * img.w + Math.floor(x / 4)]; }
  const r = petMap(up.img, { ...p, mask });
  return { stones: r.stones.map((s) => ({ ...s, x: s.x / 4, y: s.y / 4 })), work: r.work, upscale: { method: up.method, ms: up.ms, error: up.error }, img: up.img, upStones: r.stones };
}
// Giới hạn số mã (spec ≤ 13, cứng 15): giữ maxCodes mã nhiều viên nhất; viên mã bị bỏ → mã giữ lại gần nhất CÙNG size (Lab catalog);
// viên to (≥ 5 mm) không có mã giữ lại cùng size → thêm mã của nó khi tổng < hardMax, hết chỗ mới đổi sang mã gần nhất bất kỳ size.
export function limitCodes(stones, bom, maxCodes = 13, hardMax = 15) {
  const cnt = new Map(); for (const s of stones) cnt.set(s.code, (cnt.get(s.code) || 0) + 1);
  if (cnt.size <= maxCodes) return stones;
  const by = new Map(bom.map((b) => [b.code, b])), keep = new Set([...cnt].sort((a, b) => b[1] - a[1]).slice(0, maxCodes).map(([c]) => c));
  const nearest = (L, pool) => pool.reduce((a, b) => (de(L, b.lab) < de(L, a.lab) ? b : a)).code;
  return [...stones].sort((a, b) => b.physMm - a.physMm).map((s) => {
    if (keep.has(s.code)) return s;
    const L = by.get(s.code).lab, kept = [...keep].map((c) => by.get(c)), same = kept.filter((b) => Math.abs(b.physMm - s.physMm) < 1e-6);
    if (same.length) return { ...s, code: nearest(L, same) };
    if (s.physMm >= 5 && keep.size < hardMax) { keep.add(s.code); return s; }
    const c = nearest(L, kept); return { ...s, code: c, physMm: by.get(c).physMm, dMm: refOf(by.get(c).physMm), resized: true };
  });
}
