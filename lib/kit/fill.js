// KIT-25 vùng phủ (fill): nơi ảnh AI vẽ hạt nhỏ dày đặc nhưng méo (hạt dính, cỡ dao động, nhỏ hơn catalog) thì 1 hạt vẽ = 1 viên sai.
// Thay vì map từng hạt: tìm vùng (đặc trưng chung, không màu / toạ độ / ảnh riêng), mỗi vùng chỉ giữ biên (đa giác), chất liệu + màu
// (trung vị), cỡ hạt (trung vị → cỡ catalog, không nhỏ hơn cỡ nhỏ nhất), rồi xếp viên kín: 1 hàng ôm biên + lưới lục giác theo hướng
// chính của vùng + lấp lỗ, né viên chi tiết đã đặt.
// Dò (detectFill): hạt tròn ≤ 5 mm ngoài chuỗi / motif; "dày" = ≥ 6 hạt cùng chất liệu + màu trong 3× cỡ, phủ cục bộ (mọi hạt) ≥ 55 %,
// tản 2 chiều; thành phần liên thông ≥ 15 hạt, ≥ 50 % hạt có ≥ 3 láng giềng (định nghĩa vùng phủ học từ DB), rộng ≥ 1.6 hạt (hẹp =
// cột / viền / cuộn → chi tiết), và méo (CV ≥ 0.15 | vỡ ≥ 30 % | < 0.9 × cỡ catalog ≥ 50 %) hoặc đặc (≥ 80 % hạt ≥ 3 láng giềng).
// Rồi nở trên ảnh (growRegions) vì SAM sót nhiều hạt đúng nơi vẽ dày.
// Quy ước học từ sản phẩm thật (tools/kit25_fill_learn.mjs, docs/KIT-20.md §KIT-25): vùng phủ chỉ 1 mã / 1 cỡ, bước = cỡ + 0.15 mm,
// xếp gần lục giác (láng giềng thứ 3 ở 1.07× láng giềng gần nhất), không xen 2 cỡ.
// Toạ độ: px canvas (ppm px/mm). Hạt: { x, y, dMm, cls: { m4, shape }, L, a, b, src, solidity?, motif?, petal? }.
import fs from 'node:fs';
import { edt } from './pack.js';
import { lab as rgbLab } from './select.js';

export const FILL = {
  maxBeadMm: 5, // hạt vẽ to hơn = chi tiết (ngọc to, đá hình)
  nbK: 3, // bán kính láng giềng = nbK × cỡ hạt
  minNb: 6, cover: 0.55, twoD: 0.2, dE: 20, // dày: ≥ minNb hạt cùng chất liệu + màu (ΔE76) quanh, phủ cục bộ (mọi hạt) ≥ cover, tản 2 chiều (λ2/λ1)
  solid: 0.8, // vùng đặc (≥ 80 % hạt có ≥ 3 láng giềng) = vùng phủ dù vẽ đều (designer xếp procedural, DB)
  lWeight: 0.5, // ΔL nặng ½ trong khoảng cách màu (dải sáng / tối trên cùng 1 vùng)
  minWidth: 1.6, // bề rộng trung bình vùng (2·diện tích / chu vi đa giác) ≥ 1.6 hạt vẽ: hẹp hơn = cột / viền / cuộn → chi tiết
  regionTwoD: 0.5, // vùng: ≥ 50 % hạt có ≥ 3 láng giềng trong vùng (định nghĩa vùng phủ học từ DB; loại cuộn / viền mảnh)
  cv: 0.15, frag: 0.3, sub: 0.5, // dấu hiệu méo: CV cỡ, tỉ lệ hạt vỡ (không phải mask SAM nguyên / solidity < 0.9), tỉ lệ hạt < 0.9 × cỡ catalog nhỏ nhất
  link: 1.6, minBeads: 15, // nối hạt (≤ link × bán kính tổng), vùng ≥ minBeads hạt (= MIN_N học từ DB)
  res: 4, padMm: 0.3, closeMm: 1.0, simplifyMm: 0.25, // raster đa giác (px/mm), nới hạt, đóng khe, làm gọn biên
  gapMm: 0.15, // khe trung vị sản phẩm thật
  pitchTol: 1.05, // cỡ + khe ≤ bước vẽ × 1.05
  edgeRows: 1, // số hàng theo đường biên trước lưới lục giác (Infinity = cả vùng theo đường đồng mức)
  holeMm2: 100, // lỗ trong vùng nở > 100 mm² (lớn hơn 1 viên to) giữ làm lỗ, nhỏ hơn lấp (viên chi tiết đặt trước làm vật cản)
  grow: true, growRes: 2, growSmoothMm: 1, growDE: 20, // nở vùng trên ảnh (o.image): ô 0.5 mm, màu trung bình ±1 mm, ΔE (lW) ≤ growDE so với màu hạt mồi
  // KIT-26 mồi thưa (cần nở trên ảnh): SAM sót phần lớn hạt nơi vẽ dày tối màu (đỏ thẫm Queen: 46 hạt SAM / ~300 hạt vẽ trong 1 mảng
  // 2340 mm²) → không thành cụm dày. Hạt nhỏ còn lại cùng chất liệu + màu nối lỏng ≤ sparseLink × bán kính tổng, ≥ sparseMin hạt → mồi;
  // chỉ nhận nếu nở thành vùng ≥ sparseAreaMm2 và đủ rộng (minWidth): ảnh xác nhận mảng màu đều, không phải 1 hàng hạt
  sparse: true, sparseLink: 2.5, sparseMin: 6, sparseAreaMm2: 100,
  coreMin: 2, widthLoose: 1.3, // KIT-26: vùng nở hẹp theo 2·A/P nhưng lõi (2 × p90 khoảng tới biên sau đóng 1 bán kính hạt) ≥ 2 hạt → vẫn là vùng phủ
};

const grid = (items, cell) => {
  const G = new Map();
  for (const t of items) { const k = `${Math.floor(t.x / cell)},${Math.floor(t.y / cell)}`; (G.get(k) || G.set(k, []).get(k)).push(t); }
  return (x, y, r) => { const out = [], n = Math.ceil(r / cell), gx = Math.floor(x / cell), gy = Math.floor(y / cell); for (let dy = -n; dy <= n; dy++) for (let dx = -n; dx <= n; dx++) for (const t of G.get(`${gx + dx},${gy + dy}`) || []) out.push(t); return out; };
};
// màu cùng vùng: ΔE76 với ΔL nhân lW (sáng / tối do ánh sáng vẽ không đổi màu đá; lW = 1 → ΔE76)
let lW = 1;
const dE76 = (p, q) => Math.hypot(lW * (p.L - q.L), p.a - q.a, p.b - q.b);
const med = (v) => { const s = [...v].sort((a, b) => a - b); return s.length ? s[s.length >> 1] : NaN; };

// sizes(m4) → cỡ tròn catalog tăng dần của chất liệu; o = { ppm, ...FILL }
export function detectFill(beads, sizes, o = {}) {
  const P = { ...FILL, ...o }, ppm = P.ppm;
  lW = P.lWeight;
  const cand = beads.filter((b) => (b.cls.shape || 'round') === 'round' && !b.motif && !b.petal && b.dMm <= P.maxBeadMm && b.src !== 'chain');
  const near = grid(cand, 10 * ppm);
  const broken = (t) => t.src !== 'sam' || (t.solidity ?? 1) < 0.9;
  const cover = coverMap(beads, ppm); // phủ cục bộ bởi MỌI hạt (ngọc to, chuỗi vàng chiếm chỗ không làm vùng "thưa")
  for (const b of cand) {
    const R = P.nbK * Math.max(b.dMm, 2), N = near(b.x, b.y, R * ppm).filter((t) => t !== b && t.cls.m4 === b.cls.m4 && Math.hypot(t.x - b.x, t.y - b.y) / ppm <= R && dE76(t, b) <= P.dE);
    const S = [b, ...N], f = { n: N.length };
    f.density = S.reduce((a, t) => a + (t.dMm / 2) ** 2, 0) / (R * R);
    f.cover = cover(b.x, b.y, R);
    let sxx = 0, syy = 0, sxy = 0;
    for (const t of N) { const dx = (t.x - b.x) / ppm, dy = (t.y - b.y) / ppm; sxx += dx * dx; syy += dy * dy; sxy += dx * dy; }
    const tr = sxx + syy, det = sxx * syy - sxy * sxy, l1 = tr / 2 + Math.sqrt(Math.max(0, (tr * tr) / 4 - det)), l2 = tr / 2 - Math.sqrt(Math.max(0, (tr * tr) / 4 - det));
    f.twoD = l1 > 0 ? l2 / l1 : 0;
    const ds = S.map((t) => t.dMm), m = ds.reduce((a, v) => a + v, 0) / ds.length;
    f.cv = Math.sqrt(ds.reduce((a, v) => a + (v - m) ** 2, 0) / ds.length) / m;
    f.frag = S.filter(broken).length / S.length;
    const min = sizes(b.cls.m4)[0] ?? 0;
    f.sub = S.filter((t) => t.dMm < 0.9 * min).length / S.length;
    f.dense = f.n >= P.minNb && f.cover >= P.cover && f.twoD >= P.twoD;
    f.N = N;
    b.fillF = f;
  }
  // vùng = thành phần liên thông của hạt dày (cùng chất liệu, ΔE ≤ dE, khoảng cách ≤ link × bán kính tổng); dấu hiệu méo xét ở
  // mức vùng (trung vị / tỉ lệ trên mọi hạt của vùng: bền hơn từng hạt)
  const F = new Set(cand.filter((b) => b.fillF.dense));
  const seen = new Set(), comps = [], thin = [], tidy = [], rej = new Set(), nearF = grid([...F], 10 * ppm);
  for (const b of F) {
    if (seen.has(b)) continue;
    const c = [], st = [b]; seen.add(b);
    while (st.length) {
      const u = st.pop(); c.push(u);
      for (const t of nearF(u.x, u.y, 8 * ppm)) if (!seen.has(t) && t.cls.m4 === u.cls.m4 && dE76(t, u) <= P.dE && Math.hypot(t.x - u.x, t.y - u.y) / ppm <= (P.link * (t.dMm + u.dMm)) / 2) { seen.add(t); st.push(t); }
    }
    if (c.length < P.minBeads) continue;
    const nc = grid(c, 8 * ppm), deg = c.map((u) => nc(u.x, u.y, 8 * ppm).filter((t) => t !== u && Math.hypot(t.x - u.x, t.y - u.y) / ppm <= (P.link * (t.dMm + u.dMm)) / 2).length);
    const twoD = deg.filter((d) => d >= 3).length / c.length;
    // kiểu xếp như kit25_fill_learn: hàng = 2 láng giềng gần nhất gần thẳng hàng (≥ 150°) và láng giềng thứ 3 xa hơn ≥ 15 %; ψ6
    let rows = 0, inner = 0, psi = 0;
    for (const u of c) {
      const nn = nc(u.x, u.y, 8 * ppm).filter((t) => t !== u).map((t) => ({ D: Math.hypot(t.x - u.x, t.y - u.y), a: Math.atan2(t.y - u.y, t.x - u.x) })).sort((p, q) => p.D - q.D);
      if (nn.length < 3) continue;
      inner++;
      const da = Math.abs(((nn[0].a - nn[1].a + 3 * Math.PI) % (2 * Math.PI)) - Math.PI);
      if (da <= Math.PI / 6 && nn[2].D >= 1.15 * nn[1].D) rows++;
      const k6 = nn.filter((q) => q.D <= 1.3 * nn[0].D); let re = 0, im = 0; for (const q of k6) { re += Math.cos(6 * q.a); im += Math.sin(6 * q.a); } psi += Math.hypot(re, im) / k6.length;
    }
    const rowFrac = rows / Math.max(1, inner), psi6 = psi / Math.max(1, inner);
    const ds = c.map((t) => t.dMm), m = ds.reduce((a, v) => a + v, 0) / ds.length, min = sizes(c[0].cls.m4)[0] ?? 0;
    const sig = { twoD, rowFrac, psi6, cv: Math.sqrt(ds.reduce((a, v) => a + (v - m) ** 2, 0) / ds.length) / m, frag: c.filter(broken).length / c.length, sub: c.filter((t) => t.dMm < 0.9 * min).length / c.length };
    const row = { n: c.length, m4: c[0].cls.m4, at: [Math.round(c.reduce((a, t) => a + t.x, 0) / c.length), Math.round(c.reduce((a, t) => a + t.y, 0) / c.length)], dMm: +med(ds).toFixed(2), ...Object.fromEntries(Object.entries(sig).map(([k, v]) => [k, +v.toFixed(2)])) };
    if (twoD < P.regionTwoD) { thin.push(row); c.forEach((t) => rej.add(t)); continue; }
    if (twoD < P.solid && sig.cv < P.cv && sig.frag < P.frag && sig.sub < P.sub) { tidy.push(row); c.forEach((t) => rej.add(t)); continue; } // dày nhưng vẽ đều → pipeline chi tiết 1:1
    c.poly = polygonOf(c, ppm, P); row.width = +widthOf({ polygon: c.poly }, ppm, med(ds)).toFixed(2); c.sig = row;
    // hẹp (cột / viền / cuộn) → chi tiết; khi nở trên ảnh, bề rộng xét SAU khi nở (SAM chỉ thấy dải hẹp trong 1 mảng rộng → mảng nở ra)
    if (row.width < P.minWidth && !(P.grow && P.image)) { thin.push(row); continue; }
    comps.push(c);
  }
  if (P.sparse && P.grow && P.image) {
    const used = new Set([...comps.flat(), ...rej]), rest = cand.filter((b) => !used.has(b)), nr = grid(rest, 10 * ppm), seen2 = new Set();
    for (const b of rest) {
      if (seen2.has(b)) continue;
      const c = [], st = [b]; seen2.add(b);
      while (st.length) {
        const u = st.pop(); c.push(u);
        for (const t of nr(u.x, u.y, 10 * ppm)) if (!seen2.has(t) && t.cls.m4 === u.cls.m4 && dE76(t, u) <= P.dE && Math.hypot(t.x - u.x, t.y - u.y) / ppm <= (P.sparseLink * (t.dMm + u.dMm)) / 2) { seen2.add(t); st.push(t); }
      }
      if (c.length < P.sparseMin) continue;
      const ds = c.map((t) => t.dMm);
      c.poly = polygonOf(c, ppm, { ...P, closeMm: P.sparseLink * med(ds) / 2 }); c.sparse = true;
      c.sig = { n: c.length, m4: c[0].cls.m4, at: [Math.round(c.reduce((a, t) => a + t.x, 0) / c.length), Math.round(c.reduce((a, t) => a + t.y, 0) / c.length)], dMm: +med(ds).toFixed(2), width: +widthOf({ polygon: c.poly }, ppm, med(ds)).toFixed(2), twoD: 0, rowFrac: 0, psi6: 0, cv: 0, frag: 0, sub: 0 };
      comps.push(c);
    }
  }
  const stat = { candidates: cand.length, dense: F.size, regions: comps.length, fillBeads: comps.reduce((a, c) => a + c.length, 0), thin, tidy };
  const regions = comps.sort((a, b) => !!a.sparse - !!b.sparse || b.length - a.length).map((c, k) => { // mồi dày nở trước
    const sig = (key) => +med(c.map((b) => b.fillF[key])).toFixed(2);
    const drawn = med(c.map((b) => b.dMm)), sz = sizeRule(c, sizes, P);
    return {
      id: `F${k + 1}`, enabled: true, material: sz.material, beadMaterial: c[0].cls.m4, lab: ['L', 'a', 'b'].map((q) => +med(c.map((b) => b[q])).toFixed(1)),
      drawnMm: +drawn.toFixed(2), pitchMm: sz.pitchMm, physMm: sz.physMm, code: null, packPitchMm: null, angleDeg: +regionAngle(c, ppm).toFixed(1), pack: 'hex', beads: c.length,
      signals: { width: c.sig.width, cover: sig('cover'), nbTwoD: sig('twoD'), twoD: c.sig.twoD, rowFrac: c.sig.rowFrac, psi6: c.sig.psi6, cv: c.sig.cv, frag: c.sig.frag, sub: c.sig.sub },
      polygon: c.poly, seed: c.sparse ? 'sparse' : 'dense',
    };
  });
  for (const b of cand) { if (P.keepF) b._f = { ...b.fillF, N: undefined }; delete b.fillF; }
  if (P.grow && P.image) {
    stat.grow = growRegions(regions, comps, beads, { ...P, sizes });
    for (let i = regions.length - 1; i >= 0; i--) {
      const r = regions[i], wd = +widthOf(r, ppm, r.drawnMm).toFixed(2);
      r.signals = { ...r.signals, seedWidth: r.signals.width, width: wd };
      const core = r.coreMm / r.drawnMm;
      if (r.seed === 'sparse' && (regionAreaMm2(r, ppm) < P.sparseAreaMm2 || core < P.minWidth)) { (stat.sparseDrop ||= []).push({ n: r.beads, m4: r.beadMaterial, at: [0, 1].map((j) => Math.round(r.polygon.reduce((a, p) => a + p[j], 0) / r.polygon.length)), areaMm2: Math.round(regionAreaMm2(r, ppm)), core: +core.toFixed(2) }); regions.splice(i, 1); continue; }
      // biên vùng nở răng cưa (đốm ảnh) → 2·A/P thấp hơn bề rộng thật; nhận khi lõi (đã đóng) ≥ coreMin hạt và 2·A/P ≥ widthLoose (dải đỏ giữa hoa văn)
      if (wd < P.minWidth && !(core >= P.coreMin && wd >= P.widthLoose)) { thin.push({ n: r.beads, m4: r.beadMaterial, at: [0, 1].map((j) => Math.round(r.polygon.reduce((a, p) => a + p[j], 0) / r.polygon.length)), width: wd, core: +core.toFixed(2), areaMm2: Math.round(regionAreaMm2(r, ppm)), seedWidth: r.signals.seedWidth, grown: true }); regions.splice(i, 1); }
    }
    stat.regions = regions.length; stat.fillBeads = regions.reduce((a, r) => a + r.beads, 0);
    regions.forEach((r, i) => (r.id = `F${i + 1}`));
  }
  return { regions, stat };
}

// tỉ lệ phủ hạt (mọi chất liệu / cỡ) trong đĩa bán kính R mm quanh (x, y): raster 2 px/mm + ảnh tích phân, đĩa ≈ vuông cùng diện tích
function coverMap(beads, ppm) {
  const res = 2, xs = beads.map((b) => b.x), ys = beads.map((b) => b.y);
  const fr = frameOf(xs, ys, ppm, res, 30), { w, h, k } = fr, m = new Uint8Array(w * h);
  for (const b of beads) {
    const cx = (b.x - fr.x0) * k, cy = (b.y - fr.y0) * k, r = (b.dMm / 2) * res;
    for (let y = Math.max(0, Math.floor(cy - r)); y <= Math.min(h - 1, Math.ceil(cy + r)); y++) for (let x = Math.max(0, Math.floor(cx - r)); x <= Math.min(w - 1, Math.ceil(cx + r)); x++) if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) m[y * w + x] = 1;
  }
  const I = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) I[(y + 1) * (w + 1) + x + 1] = m[y * w + x] + I[y * (w + 1) + x + 1] + I[(y + 1) * (w + 1) + x] - I[y * (w + 1) + x];
  return (x, y, R) => {
    const cx = (x - fr.x0) * k, cy = (y - fr.y0) * k, a = R * res * Math.sqrt(Math.PI) / 2;
    const x0 = Math.max(0, Math.round(cx - a)), x1 = Math.min(w, Math.round(cx + a)), y0 = Math.max(0, Math.round(cy - a)), y1 = Math.min(h, Math.round(cy + a));
    const n = (x1 - x0) * (y1 - y0);
    return n > 0 ? (I[y1 * (w + 1) + x1] - I[y0 * (w + 1) + x1] - I[y1 * (w + 1) + x0] + I[y0 * (w + 1) + x0]) / n : 0;
  };
}

// Nở vùng trên ảnh: SAM bỏ sót nhiều hạt đúng nơi vẽ dày (hạt dính) → vùng hạt mồi chỉ là mảng nhỏ. Lưới ô 1/growRes mm, màu ô = Lab
// trung bình ảnh (o.image RGBA, cạnh = canvas × k) làm mịn ±growSmoothMm; vùng nở BFS từ ô trong đa giác mồi sang ô kề có màu cách màu
// tham chiếu (trung vị màu ô mồi) ≤ growDE (ΔL nặng lWeight), trong trang phục (o.inside(x, y) px canvas), không nằm trong hạt chi tiết
// (to / hình / motif / chuỗi) hay hạt nhỏ chất liệu khác. Vùng lớn nở trước, ô đã có chủ không lấy lại; 2 vùng cùng chất liệu chạm nhau
// và màu tham chiếu cách ≤ growDE → gộp. Đa giác mới = maskPoly (đóng khe, lấp lỗ).
function growRegions(regions, comps, beads, P) {
  const ppm = P.ppm, g = P.growRes, img = P.image, W = Math.round((img.w / P.imageK) / ppm * g), H = Math.round((img.h / P.imageK) / ppm * g);
  const fr = { x0: 0, y0: 0, k: g / ppm, w: W, h: H }, n = W * H, ipm = P.imageK * ppm / g; // px ảnh / ô
  const L = new Float32Array(n), A = new Float32Array(n), B = new Float32Array(n);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    let r = 0, gg = 0, bb = 0, c = 0;
    for (let y = Math.floor(j * ipm); y < Math.min(img.h, Math.floor((j + 1) * ipm)); y += 2) for (let x = Math.floor(i * ipm); x < Math.min(img.w, Math.floor((i + 1) * ipm)); x += 2) { const q = (y * img.w + x) * 4; r += img.data[q]; gg += img.data[q + 1]; bb += img.data[q + 2]; c++; }
    const [l, a, b] = rgbLab([r / c, gg / c, bb / c]); L[j * W + i] = l; A[j * W + i] = a; B[j * W + i] = b;
  }
  const box = (src) => { const rs = Math.round(P.growSmoothMm * g), out = new Float32Array(n), tmp = new Float32Array(n);
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) { let s_ = 0, c = 0; for (let d = -rs; d <= rs; d++) { const x = i + d; if (x >= 0 && x < W) { s_ += src[j * W + x]; c++; } } tmp[j * W + i] = s_ / c; }
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) { let s_ = 0, c = 0; for (let d = -rs; d <= rs; d++) { const y = j + d; if (y >= 0 && y < H) { s_ += tmp[y * W + i]; c++; } } out[j * W + i] = s_ / c; }
    return out; };
  const sL = box(L), sA = box(A), sB = box(B);
  // ô bị chặn: 0 = tự do, 1..4 = hạt nhỏ chất liệu m (cho phép vùng cùng chất liệu), 9 = chi tiết / ngoài trang phục
  const MAT = { pearl: 1, gold: 2, white: 3, color: 4 }, blk = new Uint8Array(n);
  if (P.inside) for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) if (!P.inside((i + 0.5) / fr.k, (j + 0.5) / fr.k)) blk[j * W + i] = 9;
  // KIT-26: điểm chuỗi / viền (o.blockPts [{ x, y, rMm }], vd đường tâm viền vàng tools/kit20_chain.py) = chi tiết → chặn
  for (const q of P.blockPts || []) {
    const cx = q.x * fr.k, cy = q.y * fr.k, r = q.rMm * g;
    for (let y = Math.max(0, Math.floor(cy - r)); y <= Math.min(H - 1, Math.ceil(cy + r)); y++) for (let x = Math.max(0, Math.floor(cx - r)); x <= Math.min(W - 1, Math.ceil(cx + r)); x++) if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r * r) blk[y * W + x] = 9;
  }
  for (const b of beads) {
    const small = (b.cls.shape || 'round') === 'round' && !b.motif && !b.petal && b.dMm <= P.maxBeadMm && b.src !== 'chain', v = small ? MAT[b.cls.m4] || 9 : 9;
    const cx = b.x * fr.k, cy = b.y * fr.k, r = (b.dMm / 2) * g * (small ? 0.8 : 1);
    for (let y = Math.max(0, Math.floor(cy - r)); y <= Math.min(H - 1, Math.ceil(cy + r)); y++) for (let x = Math.max(0, Math.floor(cx - r)); x <= Math.min(W - 1, Math.ceil(cx + r)); x++) if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r * r && blk[y * W + x] !== 9) blk[y * W + x] = v;
  }
  const own = new Int32Array(n).fill(-1), refs = [], sizeBefore = regions.map((r) => polyAreaMm2(r.polygon, ppm));
  const dist = (q, t) => Math.hypot(P.lWeight * (sL[q] - t[0]), sA[q] - t[1], sB[q] - t[2]);
  regions.forEach((r, k) => {
    const lp = r.polygon.map(([x, y]) => [x * fr.k, y * fr.k]), xs = lp.map((p) => p[0]), ys = lp.map((p) => p[1]), seed = [], mv = MAT[r.beadMaterial || r.material];
    // KIT-26: ô mồi bỏ ô bị chặn (viên chi tiết / hạt chất liệu khác trong lòng đa giác mồi — mồi thưa đóng khe rộng, ôm cả viên to)
    for (let y = Math.max(0, Math.floor(Math.min(...ys))); y <= Math.min(H - 1, Math.ceil(Math.max(...ys))); y++) for (let x = Math.max(0, Math.floor(Math.min(...xs))); x <= Math.min(W - 1, Math.ceil(Math.max(...xs))); x++) { const q = y * W + x; if (own[q] < 0 && !(blk[q] && blk[q] !== mv) && inPoly(x + 0.5, y + 0.5, lp)) seed.push(q); }
    const ref = [med(seed.map((q) => sL[q])), med(seed.map((q) => sA[q])), med(seed.map((q) => sB[q]))]; refs.push(ref);
    const st = [];
    for (const q of seed) { own[q] = k; st.push(q); }
    while (st.length) {
      const u = st.pop(), x = u % W, y = (u / W) | 0;
      for (const v of [x > 0 ? u - 1 : -1, x < W - 1 ? u + 1 : -1, y > 0 ? u - W : -1, y < H - 1 ? u + W : -1]) {
        if (v < 0 || own[v] >= 0 || (blk[v] && blk[v] !== mv) || dist(v, ref) > P.growDE) continue;
        own[v] = k; st.push(v);
      }
    }
  });
  // gộp vùng chạm nhau cùng chất liệu, màu gần
  const par = regions.map((_, k) => k), find = (k) => (par[k] === k ? k : (par[k] = find(par[k])));
  for (let u = 0; u < n; u++) { const a = own[u]; if (a < 0) continue; for (const v of [u % W < W - 1 ? u + 1 : -1, u + W < n ? u + W : -1]) { const b = v >= 0 ? own[v] : -1; if (b >= 0 && b !== a && regions[a].beadMaterial === regions[b].beadMaterial && Math.hypot(P.lWeight * (refs[a][0] - refs[b][0]), refs[a][1] - refs[b][1], refs[a][2] - refs[b][2]) <= P.growDE) { const ra = find(a), rb = find(b); if (ra !== rb) par[Math.max(ra, rb)] = Math.min(ra, rb); } } }
  const out = [];
  regions.forEach((r, k) => {
    if (find(k) !== k) return;
    const grp = regions.map((_, q) => q).filter((q) => find(q) === k), m = new Uint8Array(n);
    let cells = 0; for (let u = 0; u < n; u++) if (own[u] >= 0 && find(own[u]) === k) { m[u] = 1; cells++; }
    if (!cells) return; // mồi nằm trọn trong vùng đã nở trước (không còn ô) → bỏ
    // bề rộng thật (ô sở hữu, chưa lấp lỗ): 2 × phân vị 90 khoảng cách tới biên — vòng 1 hạt quanh viên to (lấp lỗ thành đĩa) ≈ 1 hạt
    // ô nở lốm đốm (khe tối giữa hạt / đốm sáng > growDE) → đóng 1 bán kính hạt vẽ trước khi đo, không tính lỗ to
    const beadsN = grp.reduce((a, q) => a + regions[q].beads, 0), drawn = med(grp.flatMap((q) => comps[q].map((b) => b.dMm)));
    const rc = (drawn / 2) * g, dOut = edt(m, W, H), mc = new Uint8Array(n); for (let u = 0; u < n; u++) mc[u] = dOut[u] <= rc ? 0 : 1;
    const dC = edt(mc, W, H); for (let u = 0; u < n; u++) mc[u] = dC[u] > rc ? 1 : 0;
    const dIn = edt(mc.map((v) => 1 - v), W, H), ds = []; for (let u = 0; u < n; u++) if (mc[u]) ds.push(dIn[u]);
    ds.sort((a, b) => a - b); const coreMm = (2 * ds[Math.floor(0.9 * (ds.length - 1))]) / g;
    const sz = sizeRule(grp.flatMap((q) => comps[q]), P.sizes, P);
    out.push({ ...r, coreMm: +coreMm.toFixed(2), seed: grp.some((q) => regions[q].seed !== 'sparse') ? 'dense' : 'sparse', beads: beadsN, lab: r.lab, drawnMm: +drawn.toFixed(2), material: sz.material, pitchMm: sz.pitchMm, physMm: sz.physMm, merged: grp.length > 1 ? grp.map((q) => regions[q].id) : undefined, seedAreaMm2: Math.round(grp.reduce((a, q) => a + sizeBefore[q], 0)), ...maskPoly(m, fr, g, P, true) });
  });
  const before = sizeBefore.reduce((a, v) => a + v, 0);
  regions.splice(0, regions.length, ...out.sort((a, b) => regionAreaMm2(b, ppm) - regionAreaMm2(a, ppm)));
  return { seedAreaMm2: Math.round(before), grownAreaMm2: Math.round(regions.reduce((a, r) => a + regionAreaMm2(r, ppm), 0)), merged: regions.filter((r) => r.merged).length };
}

// cỡ viên vùng phủ: bước vẽ = trung vị khoảng tới hạt gần nhất trong vùng; cỡ = cỡ catalog lớn nhất có cỡ + khe ≤ bước × pitchTol
// (viên phải lọt bước vẽ: mask SAM gồm cả viền / bóng nên cỡ vẽ lớn hơn thật), không có thì cỡ nhỏ nhất. Ngọc vẽ nhỏ hơn ngọc catalog
// nhỏ nhất → đá trắng (luật KIT-20; DB Queen thật: mảng ngọc cổ áo = L94 2.8 mm). → { material, physMm, pitchMm }
function sizeRule(c, sizes, P) {
  // KIT-26: chỉ khoảng tới láng giềng chạm (≤ 1.6 × cỡ vẽ; mồi thưa có hạt cách xa vì SAM sót); < 5 khoảng → bước = cỡ vẽ trung vị
  const near = grid(c, 8 * P.ppm), nn = c.map((u) => Math.min(...near(u.x, u.y, 8 * P.ppm).filter((t) => t !== u).map((t) => Math.hypot(t.x - u.x, t.y - u.y))) / P.ppm).filter((d, i) => Number.isFinite(d) && d <= 1.6 * c[i].dMm);
  const pitch = nn.length >= 5 ? med(nn) : med(c.map((t) => t.dMm)), fit = (L) => L.filter((v) => v + P.gapMm <= pitch * P.pitchTol);
  let material = c[0].cls.m4, list = sizes(material);
  if (material === 'pearl' && !fit(list).length && (sizes('white') || []).length) { material = 'white'; list = sizes('white'); }
  const f = fit(list);
  return { material, physMm: f.length ? Math.max(...f) : list[0], pitchMm: +pitch.toFixed(2) };
}

// bề rộng trung bình (hạt vẽ): 2·A/P của vùng (trừ lỗ, chu vi gồm lỗ) / cỡ vẽ trung vị
function widthOf(r, ppm, d) {
  const perOf = (poly) => poly.reduce((a, [x, y], i) => { const [x2, y2] = poly[(i + 1) % poly.length]; return a + Math.hypot(x2 - x, y2 - y); }, 0) / ppm;
  const per = [r.polygon, ...(r.holes || [])].reduce((a, q) => a + perOf(q), 0);
  return (2 * regionAreaMm2(r, ppm)) / per / d;
}

// hướng chính (lục giác): góc trung bình mod 60° của vector tới láng giềng gần nhất
function regionAngle(c, ppm) {
  const near = grid(c, 8 * ppm);
  let re = 0, im = 0;
  for (const b of c) {
    let best = null, bd = Infinity;
    for (const t of near(b.x, b.y, 6 * ppm)) { if (t === b) continue; const d = Math.hypot(t.x - b.x, t.y - b.y); if (d < bd) { bd = d; best = t; } }
    if (best) { const a = Math.atan2(best.y - b.y, best.x - b.x); re += Math.cos(6 * a); im += Math.sin(6 * a); }
  }
  return ((Math.atan2(im, re) / 6) * 180) / Math.PI;
}

// raster cục bộ: { x0, y0 (px canvas), w, h, k (px raster / px canvas) }
function frameOf(xs, ys, ppm, res, marginMm) {
  const k = res / ppm, x0 = Math.min(...xs) - marginMm * ppm, y0 = Math.min(...ys) - marginMm * ppm;
  return { x0, y0, k, w: Math.ceil((Math.max(...xs) + marginMm * ppm - x0) * k) + 1, h: Math.ceil((Math.max(...ys) + marginMm * ppm - y0) * k) + 1 };
}

// đa giác ngoài (px canvas) của hợp các đĩa hạt (nới padMm), đóng khe closeMm, thành phần lớn nhất, lấp lỗ
function polygonOf(c, ppm, P) {
  const fr = frameOf(c.map((b) => b.x), c.map((b) => b.y), ppm, P.res, 6), { w, h, k } = fr, m = new Uint8Array(w * h);
  for (const b of c) {
    const cx = (b.x - fr.x0) * k, cy = (b.y - fr.y0) * k, r = (b.dMm / 2 + P.padMm) * P.res;
    for (let y = Math.max(0, Math.floor(cy - r)); y <= Math.min(h - 1, Math.ceil(cy + r)); y++) for (let x = Math.max(0, Math.floor(cx - r)); x <= Math.min(w - 1, Math.ceil(cx + r)); x++) if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) m[y * w + x] = 1;
  }
  return maskPoly(m, fr, P.res, P);
}

// mask (raster fr, res px/mm) → đa giác ngoài (px canvas): đóng khe closeMm, thành phần lớn nhất, lấp lỗ, Douglas–Peucker;
// keepHoles: lỗ > holeMm2 giữ lại → { polygon, holes: [vòng] } (vd mảng đỏ bị viền vàng bao quanh không thuộc vùng vàng)
function maskPoly(m, fr, res, P, keepHoles = false) {
  const { w, h, k } = fr;
  const rc = P.closeMm * res, dOut = edt(m, w, h), dil = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) dil[i] = dOut[i] <= rc ? 1 : 0;
  const inv = new Uint8Array(w * h); for (let i = 0; i < w * h; i++) inv[i] = dil[i] ? 0 : 1;
  const dIn = edt(inv, w, h), cl = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) cl[i] = dIn[i] > rc ? 1 : 0;
  const toCanvas = (ring) => simplify(ring, P.simplifyMm * res).map(([x, y]) => [+(x / k + fr.x0).toFixed(1), +(y / k + fr.y0).toFixed(1)]);
  const { out, holes } = largest(cl, w, h, keepHoles ? P.holeMm2 * res * res : Infinity);
  const polygon = toCanvas(trace(out, w, h));
  return keepHoles ? { polygon, holes: holes.map((hm) => toCanvas(trace(hm, w, h))).filter((r) => r.length >= 3) } : polygon;
}

// thành phần 4-liên thông lớn nhất, lỗ bên trong được lấp (trừ lỗ ≥ keepPx điểm: trả riêng từng mask lỗ)
function largest(m, w, h, keepPx = Infinity) {
  const lab = new Int32Array(w * h).fill(-1), sizes = [];
  for (let i = 0; i < w * h; i++) {
    if (!m[i] || lab[i] >= 0) continue;
    const id = sizes.length, st = [i]; lab[i] = id; let n = 0;
    while (st.length) { const u = st.pop(); n++; const x = u % w, y = (u / w) | 0; for (const v of [x > 0 ? u - 1 : -1, x < w - 1 ? u + 1 : -1, y > 0 ? u - w : -1, y < h - 1 ? u + w : -1]) if (v >= 0 && m[v] && lab[v] < 0) { lab[v] = id; st.push(v); } }
    sizes.push(n);
  }
  const best = sizes.indexOf(Math.max(...sizes)), out = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) out[i] = lab[i] === best ? 1 : 0;
  // lấp lỗ: nền không nối được ra mép khung
  const bg = new Uint8Array(w * h), st = [];
  for (let x = 0; x < w; x++) for (const y of [0, h - 1]) if (!out[y * w + x] && !bg[y * w + x]) { bg[y * w + x] = 1; st.push(y * w + x); }
  for (let y = 0; y < h; y++) for (const x of [0, w - 1]) if (!out[y * w + x] && !bg[y * w + x]) { bg[y * w + x] = 1; st.push(y * w + x); }
  while (st.length) { const u = st.pop(), x = u % w, y = (u / w) | 0; for (const v of [x > 0 ? u - 1 : -1, x < w - 1 ? u + 1 : -1, y > 0 ? u - w : -1, y < h - 1 ? u + w : -1]) if (v >= 0 && !out[v] && !bg[v]) { bg[v] = 1; st.push(v); } }
  const holes = [];
  if (keepPx < Infinity) {
    const seen = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) {
      if (out[i] || bg[i] || seen[i]) continue;
      const comp = [], st2 = [i]; seen[i] = 1;
      while (st2.length) { const u = st2.pop(); comp.push(u); const x = u % w, y = (u / w) | 0; for (const v of [x > 0 ? u - 1 : -1, x < w - 1 ? u + 1 : -1, y > 0 ? u - w : -1, y < h - 1 ? u + w : -1]) if (v >= 0 && !out[v] && !bg[v] && !seen[v]) { seen[v] = 1; st2.push(v); } }
      if (comp.length >= keepPx) { const hm = new Uint8Array(w * h); for (const u of comp) { hm[u] = 1; bg[u] = 1; } holes.push(hm); }
    }
  }
  for (let i = 0; i < w * h; i++) if (!bg[i]) out[i] = 1;
  return { out, holes };
}

// dò biên Moore (8-liên thông) → vòng điểm (px raster, góc điểm ảnh)
function trace(m, w, h) {
  const at = (x, y) => x >= 0 && y >= 0 && x < w && y < h && m[y * w + x] === 1;
  let s = -1; for (let i = 0; i < w * h && s < 0; i++) if (m[i]) s = i;
  if (s < 0) return [];
  const D = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
  const sx = s % w, sy = (s / w) | 0, out = [[sx + 0.5, sy + 0.5]];
  let x = sx, y = sy, dir = 6; // tới từ phía trên (điểm đầu quét hàng → trên trống)
  for (let it = 0; it < 4 * w * h; it++) {
    let found = false;
    for (let k = 0; k < 8; k++) {
      const d = (dir + 6 + k) % 8, nx = x + D[d][0], ny = y + D[d][1];
      if (at(nx, ny)) { x = nx; y = ny; dir = d; found = true; break; }
    }
    if (!found || (x === sx && y === sy)) break;
    out.push([x + 0.5, y + 0.5]);
  }
  return out;
}

// Douglas–Peucker trên vòng kín
function simplify(pts, tol) {
  if (pts.length < 4) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = 1;
  let far = 0, fd = -1; for (let i = 1; i < pts.length; i++) { const d = Math.hypot(pts[i][0] - pts[0][0], pts[i][1] - pts[0][1]); if (d > fd) { fd = d; far = i; } }
  keep[far] = 1;
  const rec = (a, b) => {
    const [x1, y1] = pts[a], [x2, y2] = pts[b % pts.length], L = Math.hypot(x2 - x1, y2 - y1) || 1e-9;
    let mi = -1, md = tol;
    for (let i = a + 1; i < b; i++) { const [x, y] = pts[i % pts.length], d = Math.abs((x2 - x1) * (y1 - y) - (x1 - x) * (y2 - y1)) / L; if (d > md) { md = d; mi = i; } }
    if (mi >= 0) { keep[mi % pts.length] = 1; rec(a, mi); rec(mi, b); }
  };
  rec(0, far); rec(far, pts.length);
  return pts.filter((_, i) => keep[i]);
}

export function inPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
// điểm trong vùng: trong đa giác ngoài, ngoài mọi lỗ
export const inRegion = (x, y, r) => inPoly(x, y, r.polygon) && !(r.holes || []).some((hl) => inPoly(x, y, hl));
export const regionAreaMm2 = (r, ppm) => polyAreaMm2(r.polygon, ppm) - (r.holes || []).reduce((a, hl) => a + polyAreaMm2(hl, ppm), 0);
export const polyAreaMm2 = (poly, ppm) => Math.abs(poly.reduce((a, [x, y], i) => { const [x2, y2] = poly[(i + 1) % poly.length]; return a + x * y2 - x2 * y; }, 0)) / 2 / ppm / ppm;

// Xếp viên trong 1 vùng: cỡ s (mm), bước p = s + gap; tâm hợp lệ = cách biên ≥ s/2. Hàng biên: điểm trên đường đồng mức s/2, cách ≥ p,
// theo thứ tự lan dọc biên; trong: lưới lục giác xoay angleDeg (pha tốt nhất trong 12), bỏ điểm gần hàng biên < p; rồi lấp lỗ (quét
// raster 0.25 mm, nhận điểm cách mọi điểm ≥ p). o.obstacles [{ x, y (px canvas), rMm }] = viên đã đặt (hàng biên ôm cả chúng).
// KIT-26: o.holesOnly = chỉ lấp lỗ (lượt kín sau cùng: viên đã đặt là vật cản); o.clip(x, y) px canvas → false = không đặt tâm ở đó
// → [{ x, y (px canvas), ring }]
export function packRegion(region, o = {}) {
  const P = { ...FILL, ...o }, ppm = P.ppm, s = region.physMm, p = Math.max(s + P.gapMm + 0.02, region.packPitchMm || 0), poly = region.polygon; // packPitchMm (sửa tay): bước thưa hơn = khoan một phần
  const fr = frameOf(poly.map((q) => q[0]), poly.map((q) => q[1]), ppm, P.res, 1), { w, h, k } = fr, out = new Uint8Array(w * h);
  const lp = poly.map(([x, y]) => [(x - fr.x0) * k, (y - fr.y0) * k]);
  const lh = (region.holes || []).map((hl) => hl.map(([x, y]) => [(x - fr.x0) * k, (y - fr.y0) * k]));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out[y * w + x] = inPoly(x + 0.5, y + 0.5, lp) && !lh.some((hl) => inPoly(x + 0.5, y + 0.5, hl)) ? 0 : 1;
  // vật cản (viên chi tiết đã đặt): đĩa bán kính + khe tính là ngoài vùng → tâm hợp lệ cách viên ≥ s/2 + khe + bán kính
  for (const ob of o.obstacles || []) {
    const cx = (ob.x - fr.x0) * k, cy = (ob.y - fr.y0) * k, r = (ob.rMm + P.gapMm + 0.02) * P.res;
    if (cx < -r || cy < -r || cx > w + r || cy > h + r) continue;
    for (let y = Math.max(0, Math.floor(cy - r)); y <= Math.min(h - 1, Math.ceil(cy + r)); y++) for (let x = Math.max(0, Math.floor(cx - r)); x <= Math.min(w - 1, Math.ceil(cx + r)); x++) if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r * r) out[y * w + x] = 1;
  }
  const din = edt(out, w, h), half = (s / 2) * P.res + 0.5 /* EDT = tới tâm ô ngoài gần nhất ≈ biên thật + ½ ô */, ok = (x, y) => x >= 0 && y >= 0 && x < w && y < h && din[y * w + x] >= half && (!o.clip || o.clip((x + 0.5) / k + fr.x0, (y + 0.5) / k + fr.y0));
  const pr = p * P.res, cell = pr, G = new Map(), pts = [];
  const free = (x, y) => { const gx = Math.floor(x / cell), gy = Math.floor(y / cell); for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) for (const q of G.get(`${gx + dx},${gy + dy}`) || []) if ((q[0] - x) ** 2 + (q[1] - y) ** 2 < pr * pr - 1e-6 * pr) return false; return true; }; // − ε: điểm lưới cách đúng p
  const add = (x, y, ring) => { pts.push([x, y, ring]); const kk = `${Math.floor(x / cell)},${Math.floor(y / cell)}`; (G.get(kk) || G.set(kk, []).get(kk)).push([x, y]); };
  // hàng theo đường đồng mức: hàng k = điểm cách biên s/2 + k·(√3/2)·p (k < rows; rows = Infinity → mọi hàng), lấy dọc đường theo thứ
  // tự lan, nhận điểm cách mọi điểm đã có ≥ p (hàng sau tự lọt vào khe hàng trước → gần lục giác, ôm biên)
  const rowsN = o.holesOnly ? 0 : o.rows ?? P.edgeRows, rhR = (pr * Math.sqrt(3)) / 2;
  for (let kRow = 0; kRow < rowsN; kRow++) {
    const lev = half + kRow * rhR, okL = (x, y) => x >= 0 && y >= 0 && x < w && y < h && din[y * w + x] >= lev && (!o.clip || o.clip((x + 0.5) / k + fr.x0, (y + 0.5) / k + fr.y0)), edge = [];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (okL(x, y) && (!okL(x - 1, y) || !okL(x + 1, y) || !okL(x, y - 1) || !okL(x, y + 1))) edge.push(y * w + x);
    if (!edge.length) break;
    const onE = new Set(edge), seenE = new Set();
    for (const e0 of edge) {
      if (seenE.has(e0)) continue;
      const q = [e0]; seenE.add(e0);
      for (let qi = 0; qi < q.length; qi++) {
        const u = q[qi], x = u % w, y = (u / w) | 0;
        if (free(x, y)) add(x, y, kRow === 0);
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const v = (y + dy) * w + (x + dx); if ((dx || dy) && onE.has(v) && !seenE.has(v)) { seenE.add(v); q.push(v); } }
      }
    }
  }
  const nRing = pts.filter((q) => q[2]).length, nRows = pts.length;
  // lưới lục giác: chọn pha có nhiều điểm hợp lệ nhất
  const t = ((region.angleDeg || 0) * Math.PI) / 180, c = Math.cos(t), sn = Math.sin(t), rh = (pr * Math.sqrt(3)) / 2, Rm = Math.hypot(w, h);
  const lattice = (ox, oy) => { const L = []; for (let j = -Math.ceil(Rm / rh); j <= Math.ceil(Rm / rh); j++) for (let i = -Math.ceil(Rm / pr) - 1; i <= Math.ceil(Rm / pr) + 1; i++) { const u = i * pr + (j & 1 ? pr / 2 : 0) + ox, v = j * rh + oy, x = w / 2 + u * c - v * sn, y = h / 2 + u * sn + v * c; const xi = Math.round(x), yi = Math.round(y); if (ok(xi, yi) && free(x, y)) L.push([x, y]); } return L; };
  let best = [];
  if (!o.holesOnly) for (let a = 0; a < 4; a++) for (let b = 0; b < 3; b++) { const L = lattice((a * pr) / 4, (b * rh) / 3); if (L.length > best.length) best = L; }
  for (const [x, y] of best) if (free(x, y)) add(x, y, false);
  const nHex = pts.length - nRows;
  // lấp lỗ
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (ok(x, y) && free(x, y)) add(x, y, false);
  return { points: pts.map(([x, y, ring]) => ({ x: (x + 0.5) / k + fr.x0, y: (y + 0.5) / k + fr.y0, ring })) /* chỉ số ô → toạ độ tâm ô */, ring: nRing, rows: nRows - nRing, hex: nHex, holes: pts.length - nRows - nHex, pitchMm: +(pr / P.res).toFixed(2) };
}

export const FILL_SCHEMA = 'pearl-kit-fill-regions/1';
export function readFillRegions(file) { const d = JSON.parse(fs.readFileSync(file, 'utf8')); if (d.schema !== FILL_SCHEMA) throw new Error(`${file}: schema ${d.schema} ≠ ${FILL_SCHEMA}`); return d; }
export function writeFillRegions(file, doc) {
  // 1 vùng / dòng, đa giác 1 dòng: dễ sửa tay
  const head = { ...doc, regions: undefined }, lines = doc.regions.map((r) => '  ' + JSON.stringify(r));
  fs.writeFileSync(file, JSON.stringify(head, null, 1).replace(/\n}$/, `,\n "regions": [\n${lines.join(',\n')}\n ]\n}\n`));
}
