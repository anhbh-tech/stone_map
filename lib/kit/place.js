// KIT-2: ảnh → bản đồ đá. Vào: ảnh đầu pet raster SẠCH (không bead) + mặt nạ; ra: các viên cùng schema KIT-1
// (kit/<layer>.json: { id, symbol, code, x, y, dMm, rot, group }, x/y = px bản đồ). Không gọi API. Mọi cỡ / khung là tham số (PLACE).
// Mã + màu + cỡ từ catalog thật (KIT-8, lib/kit/catalog.js ← kit/db/kit.sqlite): chỉ mã catalog tròn; mọi cỡ trong params và
// va chạm / độ phủ là cỡ VẬT LÝ (đá chính 2.8mm); viên ra dMm = cỡ vẽ reference (2.2mm), group = K_<mã>_S<vật lý>, physMm.
//   place(image, mask, params) → { stones, params, stats, colors, symbols }   (API chính, xem dưới)
//   placeStones(image, { mask, ...params }) → { map: { stones }, colors, symbols, stats }
//   estimateGrid(image, mask, { pxPerMm }) → { pitchMm, sizeMm, gapMm, … } gợi ý tham số từ ảnh đã có hạt
// 1) lưới làm việc workPxPerMm (mặc định = pxPerMm của bản đồ), Lab, làm mượt giữ biên (domain transform ~ bilateral, σ ≈ 1 bước đá)
// 2) hướng lông: structure tensor trên L (σ ≈ 1 bước), hướng = tiếp tuyến; sát mép mặt nạ trộn dần về tiếp tuyến viền
// 3) đặt tâm theo ưu tiên: (a) đá nhấn (accentSizesMm, mặc định 4/5mm vật lý) ở mắt/mũi (bbox từ ngoài, hoặc tự dò đốm tối gọn tương phản cao)
//    → (b) 1 hàng dọc viền, lùi vào 1 bán kính → (c) 2 hàng ôm 2 bên cạnh mạnh → (d) streamline cách đều Jobard–Lefer,
//    đá cách 1 bước trên mỗi đường → (e) vài vòng Lloyd ràng buộc. Khoảng cách cứng: r1 + r2 + khe (mặc định 2.8–2.8 = 2.95mm)
// 4) màu: trung bình Lab trọng số Gauss trong đĩa r; viên vắt qua biên chỉ lấy phía chiếm đa số
// 5) lượng tử CIEDE2000 tới mã catalog cùng cỡ vật lý; tổng ≤ maxColors mã (luật: 13, tối đa 15): đá nhấn lấy mã gần nhất
//    ở cỡ của nó trước, phần còn lại K mã đá chính (k-means màu các viên → Hungarian cụm↔mã); tuỳ chọn khuếch tán sai số;
//    dọn màu lẻ bằng lọc đa số trên đồ thị láng giềng (đối ngẫu Voronoi = Delaunay rời rạc), bảo vệ mắt/mũi
// 6) ký hiệu theo TỪNG thiết kế (catalog.assignSymbols): đá = chữ in hoa theo số viên giảm dần, ngọc trai = số = cỡ;
//    params.symbols = ký hiệu đã chốt từ vùng khác của cùng thiết kế
import { loadCatalog, assignSymbols, groupOf, physOf } from './catalog.js';
import { withRegion } from './vlm.js';

export const MM_PX = 11.81;

// Kích thước đá / khung CHỈ LÀ GIẢ ĐỊNH: mọi thứ là tham số, mặc định lấy từ file mẫu + sản phẩm thật (viewBox 3543 = 300mm,
// đá chính L 2.8mm vật lý, tâm-tâm ~3.0mm, khe vật lý trung vị 0.15–0.24mm — docs/KIT-DATA.md). Khoảng cách để null được tính theo bước p = mainSizeMm + gapMm (REL × p),
// nên đổi cỡ đá / khe là đổi cả lưới, độ mượt, hướng lông, ngưỡng cạnh… theo cùng tỉ lệ. Xem resolveParams().
export const PLACE = {
  canvasMm: 300, pxPerMm: MM_PX,     // bản đồ: toạ độ x/y viên = px bản đồ; ảnh nguồn đặt lên bản đồ qua frame
  workPxPerMm: null,                 // lưới làm việc (null = pxPerMm; benchmark có thể hạ để nhanh)
  stoneSizesMm: null,                // cỡ vật lý được dùng (null = mọi cỡ có mã trong catalog / codes)
  mainSizeMm: 2.8, gapMm: 0.2,       // đá chính + khe (vật lý) → bước p = 3.0mm (thật: trung vị tâm-tâm 3.02 / 2.95)
  accentSizesMm: [4, 5],             // đá nhấn mắt / mũi (vật lý; chỉ giữ cỡ có trong stoneSizesMm)
  maxColors: null, codes: null,      // tổng số mã (null = luật 13, kẹp ≤ 15); codes: tập con mã catalog được dùng
  symbols: null,                     // { mã: chữ } đã chốt (vùng khác cùng thiết kế); còn lại cấp theo số viên
  minGapFrac: 0.75,                  // khe cứng = minGapFrac × gapMm (2.8 + 0.15 = 2.95mm); khác cỡ: r1 + r2 + khe
  rowMm: null,                       // khoảng cách streamline (null = p·√3/2, hàng lục giác). File mẫu thưa hơn (~0.6 lục giác)
                                     // nhưng KHÔNG phải chuẩn; tự kiểm bằng tools/bench_kit_place.mjs
  stepMm: null,                      // khoảng cách đá trên 1 streamline (null = p)
  testFrac: 0.6,                     // dtest = testFrac × rowMm (dừng đường khi sát đường khác)
  minMm: null,                       // tâm-tâm tối thiểu 2 đá chính (null = mainSizeMm + minGapFrac × gapMm)
  insetMm: 0,                        // hàng viền lùi vào 1 bán kính + chừng này
  smoothMm: null, smoothDE: 14, smoothIter: 3,      // domain transform: σs (null = p), σr (Lab, chuẩn L1)
  flowMm: null, blendMm: null, coherence: 0.5,      // tensor σ (null = p); trộn về tiếp tuyến viền trong blendMm (null = 2p);
                                                    // dưới ngưỡng → rot 0 (mẫu: 67–78% viên xoay)
  edges: true, edgeGradMm: null, edgeDE: 20,        // cạnh mạnh: |∇Lab| ≥ edgeGradMm / mm (null = 75 / p) và ΔE00 2 bên (±p/2) ≥ edgeDE
  fill: true,                        // lấp khe sau streamline (circle packing tham lam) → không còn chỗ đặt thêm được viên
  lloyd: 3, lloydMaxMm: null,        // null = 0.117p
  relaxRounds: 1,                    // với fill: số vòng lấp khe ↔ Lloyd (thêm vòng không tăng mật độ: viên đã kẹt ở khe cứng)
  accents: true, maxAccents: 6, accentDE: 25, accentStd: 0.35, accentRing: 2.8, accentDark: true,
  diffuse: 0,                        // 0..1 hệ số khuếch tán sai số trên đồ thị láng giềng
  despeckle: true, minCluster: 2, despeckleDE: 20, protectMm: null,  // bảo vệ quanh đá nhấn (null = 1.5p)
  colorSplitDE: 12,                  // 2 cụm màu trong đĩa cách nhau ≥ ngưỡng (ΔE00) → viên vắt biên, lấy phía đa số
};
const REL = { stepMm: 1, rowMm: Math.sqrt(3) / 2, smoothMm: 1, flowMm: 1, blendMm: 2, lloydMaxMm: 0.35 / 3, protectMm: 1.5 };
// Tham số đầy đủ (mọi giá trị null đã tính theo p; cỡ lọc theo catalog) — đây là params trả về trong place().
export function resolveParams(params = {}, cat = loadCatalog()) {
  const o = { ...PLACE, ...params }, p = o.mainSizeMm + o.gapMm;
  for (const [key, f] of Object.entries(REL)) if (o[key] == null) o[key] = f * p;
  if (o.minMm == null) o.minMm = o.mainSizeMm + o.minGapFrac * o.gapMm;
  if (o.edgeGradMm == null) o.edgeGradMm = 75 / p;
  if (o.workPxPerMm == null) o.workPxPerMm = o.pxPerMm;
  const pal = Object.values(cat.codes).filter((e) => !o.codes || o.codes.includes(e.code));
  if (o.stoneSizesMm == null) o.stoneSizesMm = [...new Set(pal.map((e) => e.physMm))].sort((a, b) => a - b);
  o.accentSizesMm = o.accentSizesMm.filter((d) => o.stoneSizesMm.includes(d) && d > o.mainSizeMm);
  o.maxColors = Math.max(1, Math.min(o.maxColors ?? cat.rules.maxCodesTarget, cat.rules.maxCodesHard));
  o.pitchMm = p; o.canvasPx = Math.round(o.canvasMm * o.pxPerMm);
  return o;
}

// ── palette = mã catalog (tập con codes), mỗi mã 1 cỡ vật lý cố định
const hex = (s) => [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16));
function normPalette(cat, codes) {
  const entries = Object.values(cat.codes).filter((e) => !codes || codes.includes(e.code)).map((e) => ({ ...e, lab: rgbToLab(...hex(e.fill)) }));
  if (codes) for (const c of codes) if (!cat.codes[c]) throw new Error(`mã ${c} không có trong catalog (hoặc không tròn)`);
  return { entries, at: (d) => entries.filter((e) => Math.abs(e.physMm - d) < 1e-6) };
}

// ── màu
const LIN = Float64Array.from({ length: 256 }, (_, i) => { const c = i / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
const fLab = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
export function rgbToLab(r, g, b) {
  const R = LIN[Math.round(r)], G = LIN[Math.round(g)], B = LIN[Math.round(b)];
  const x = fLab((0.4124564 * R + 0.3575761 * G + 0.1804375 * B) / 0.95047);
  const y = fLab(0.2126729 * R + 0.7151522 * G + 0.072175 * B);
  const z = fLab((0.0193339 * R + 0.119192 * G + 0.9503041 * B) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}
const RAD = Math.PI / 180, P7 = 25 ** 7;
// CIEDE2000 (Sharma, Wu, Dalal 2005).
export function de2000([L1, a1, b1], [L2, a2, b2]) {
  const C1 = Math.hypot(a1, b1), C2 = Math.hypot(a2, b2), Cb7 = ((C1 + C2) / 2) ** 7, G = 0.5 * (1 - Math.sqrt(Cb7 / (Cb7 + P7)));
  const a1p = (1 + G) * a1, a2p = (1 + G) * a2, C1p = Math.hypot(a1p, b1), C2p = Math.hypot(a2p, b2);
  const hp = (b, a) => (b === 0 && a === 0 ? 0 : (Math.atan2(b, a) / RAD + 360) % 360);
  const h1 = hp(b1, a1p), h2 = hp(b2, a2p), cc = C1p * C2p;
  let dh = cc === 0 ? 0 : h2 - h1;
  if (dh > 180) dh -= 360; else if (dh < -180) dh += 360;
  const dL = L2 - L1, dC = C2p - C1p, dH = 2 * Math.sqrt(cc) * Math.sin((dh / 2) * RAD);
  const Lb = (L1 + L2) / 2, Cb = (C1p + C2p) / 2;
  const hb = cc === 0 ? h1 + h2 : Math.abs(h1 - h2) <= 180 ? (h1 + h2) / 2 : h1 + h2 < 360 ? (h1 + h2 + 360) / 2 : (h1 + h2 - 360) / 2;
  const T = 1 - 0.17 * Math.cos((hb - 30) * RAD) + 0.24 * Math.cos(2 * hb * RAD) + 0.32 * Math.cos((3 * hb + 6) * RAD) - 0.2 * Math.cos((4 * hb - 63) * RAD);
  const dTh = 30 * Math.exp(-(((hb - 275) / 25) ** 2)), Cb7p = Cb ** 7, Rc = 2 * Math.sqrt(Cb7p / (Cb7p + P7));
  const Sl = 1 + (0.015 * (Lb - 50) ** 2) / Math.sqrt(20 + (Lb - 50) ** 2), Sc = 1 + 0.045 * Cb, Sh = 1 + 0.015 * Cb * T;
  const Rt = -Math.sin(2 * dTh * RAD) * Rc, x = dL / Sl, y = dC / Sc, z = dH / Sh;
  return Math.sqrt(x * x + y * y + z * z + Rt * y * z);
}
const de76 = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);

// ── lưới
// Ảnh nguồn → lưới làm việc (gs điểm làm việc / px bản đồ) quanh hộp bao mặt nạ (+ lề): Lab + mặt nạ.
function workGrid(img, mask, frame, gs, marginMm) {
  let u0 = img.w, v0 = img.h, u1 = -1, v1 = -1;
  for (let v = 0; v < img.h; v++) for (let u = 0; u < img.w; u++) if (mask[v * img.w + u]) { if (u < u0) u0 = u; if (u > u1) u1 = u; if (v < v0) v0 = v; if (v > v1) v1 = v; }
  if (u1 < 0) return null;
  const m = marginMm / frame.mapPx;
  const X0 = Math.floor(Math.max(frame.x, frame.x + u0 * frame.scale - m)), Y0 = Math.floor(Math.max(frame.y, frame.y + v0 * frame.scale - m));
  const X1 = Math.ceil(Math.min(frame.x + img.w * frame.scale, frame.x + (u1 + 1) * frame.scale + m)), Y1 = Math.ceil(Math.min(frame.y + img.h * frame.scale, frame.y + (v1 + 1) * frame.scale + m));
  const W = Math.max(1, Math.round((X1 - X0) * gs)), H = Math.max(1, Math.round((Y1 - Y0) * gs)), n = W * H;
  const L = new Float32Array(n), A = new Float32Array(n), B = new Float32Array(n), M = new Uint8Array(n), d = img.data;
  const ident = gs === 1 && frame.scale === 1 && Number.isInteger(frame.x) && Number.isInteger(frame.y);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const q = y * W + x;
    let r, g, b, inm;
    if (ident) {
      const p = (Y0 - frame.y + y) * img.w + X0 - frame.x + x;
      r = d[p * 4]; g = d[p * 4 + 1]; b = d[p * 4 + 2]; inm = mask[p];
    } else { // song tuyến; mặt nạ lấy điểm gần nhất
      const U = (X0 + (x + 0.5) / gs - frame.x) / frame.scale - 0.5, V = (Y0 + (y + 0.5) / gs - frame.y) / frame.scale - 0.5;
      const ua = Math.min(img.w - 1, Math.max(0, Math.floor(U))), va = Math.min(img.h - 1, Math.max(0, Math.floor(V)));
      const ub = Math.min(img.w - 1, ua + 1), vb = Math.min(img.h - 1, va + 1), tx = Math.min(1, Math.max(0, U - ua)), ty = Math.min(1, Math.max(0, V - va));
      const s = (c) => (d[(va * img.w + ua) * 4 + c] * (1 - tx) + d[(va * img.w + ub) * 4 + c] * tx) * (1 - ty) + (d[(vb * img.w + ua) * 4 + c] * (1 - tx) + d[(vb * img.w + ub) * 4 + c] * tx) * ty;
      r = s(0); g = s(1); b = s(2);
      inm = mask[Math.min(img.h - 1, Math.max(0, Math.round(V))) * img.w + Math.min(img.w - 1, Math.max(0, Math.round(U)))];
    }
    const lab = rgbToLab(r, g, b);
    L[q] = lab[0]; A[q] = lab[1]; B[q] = lab[2]; M[q] = inm ? 1 : 0;
  }
  return { W, H, X0, Y0, L, A, B, M };
}

// Khoảng cách Euclid (px) từ tâm điểm ảnh trong mặt nạ tới tâm điểm ngoài gần nhất; ngoài khung = ngoài.
function edt(M, W, H) {
  const PW = W + 2, PH = H + 2, INF = 1e20, g = new Float64Array(PW * PH);
  for (let y = 1; y <= H; y++) for (let x = 1; x <= W; x++) g[y * PW + x] = M[(y - 1) * W + x - 1] ? INF : 0;
  const n = Math.max(PW, PH), f = new Float64Array(n), d = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1);
  const pass = (len) => {
    let k = 0; v[0] = 0; z[0] = -INF; z[1] = INF;
    for (let q = 1; q < len; q++) {
      let s;
      while ((s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k])) <= z[k]) k--;
      k++; v[k] = q; z[k] = s; z[k + 1] = INF;
    }
    k = 0;
    for (let q = 0; q < len; q++) { while (z[k + 1] < q) k++; d[q] = (q - v[k]) ** 2 + f[v[k]]; }
  };
  for (let x = 0; x < PW; x++) { for (let y = 0; y < PH; y++) f[y] = g[y * PW + x]; pass(PH); for (let y = 0; y < PH; y++) g[y * PW + x] = d[y]; }
  for (let y = 0; y < PH; y++) { for (let x = 0; x < PW; x++) f[x] = g[y * PW + x]; pass(PW); for (let x = 0; x < PW; x++) g[y * PW + x] = d[x]; }
  const out = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) out[y * W + x] = Math.sqrt(g[(y + 1) * PW + x + 1]);
  return out;
}

// Gauss xấp xỉ 3 lần lọc hộp (tổng chạy theo hàng rồi cột), tại chỗ.
function blur(a, W, H, sigma) {
  const r = Math.max(1, Math.round((Math.sqrt(4 * sigma * sigma + 1) - 1) / 2)), buf = new Float64Array(Math.max(W, H) + 1), tmp = new Float32Array(Math.max(W, H));
  const line = (o, stride, len) => {
    buf[0] = 0;
    for (let i = 0; i < len; i++) buf[i + 1] = buf[i] + a[o + i * stride];
    for (let i = 0; i < len; i++) { const lo = Math.max(0, i - r), hi = Math.min(len - 1, i + r); tmp[i] = (buf[hi + 1] - buf[lo]) / (hi - lo + 1); }
    for (let i = 0; i < len; i++) a[o + i * stride] = tmp[i];
  };
  for (let p = 0; p < 3; p++) {
    for (let y = 0; y < H; y++) line(y * W, 1, W);
    for (let x = 0; x < W; x++) line(x, W, H);
  }
  return a;
}

// Làm mượt giữ biên: domain transform, recursive filter (Gastal & Oliveira 2011). Mép mặt nạ = biên cứng.
function smoothLab(G, sigmaS, sigmaR, iters) {
  const { W, H, M } = G, C = [Float32Array.from(G.L), Float32Array.from(G.A), Float32Array.from(G.B)];
  const dH = new Float32Array(W * H), dV = new Float32Array(W * H), k = sigmaS / sigmaR;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    if (x) dH[i] = 1 + k * (Math.abs(G.L[i] - G.L[i - 1]) + Math.abs(G.A[i] - G.A[i - 1]) + Math.abs(G.B[i] - G.B[i - 1])) + (M[i] !== M[i - 1] ? 1e4 : 0);
    if (y) dV[i] = 1 + k * (Math.abs(G.L[i] - G.L[i - W]) + Math.abs(G.A[i] - G.A[i - W]) + Math.abs(G.B[i] - G.B[i - W])) + (M[i] !== M[i - W] ? 1e4 : 0);
  }
  const V = new Float32Array(W * H);
  for (let it = 0; it < iters; it++) {
    const sH = (sigmaS * Math.sqrt(3) * 2 ** (iters - it - 1)) / Math.sqrt(4 ** iters - 1), a = Math.exp(-Math.SQRT2 / sH);
    for (let i = 0; i < W * H; i++) V[i] = a ** dH[i];
    for (const c of C) for (let y = 0; y < H; y++) {
      const o = y * W;
      for (let x = 1; x < W; x++) c[o + x] += V[o + x] * (c[o + x - 1] - c[o + x]);
      for (let x = W - 2; x >= 0; x--) c[o + x] += V[o + x + 1] * (c[o + x + 1] - c[o + x]);
    }
    for (let i = 0; i < W * H; i++) V[i] = a ** dV[i];
    for (const c of C) for (let x = 0; x < W; x++) {
      for (let y = 1; y < H; y++) c[y * W + x] += V[y * W + x] * (c[(y - 1) * W + x] - c[y * W + x]);
      for (let y = H - 2; y >= 0; y--) c[y * W + x] += V[(y + 1) * W + x] * (c[(y + 1) * W + x] - c[y * W + x]);
    }
  }
  return C;
}

// Hướng lông: (ux, uy) đơn vị dọc nét + coh 0..1; trộn (góc nhân đôi) về tiếp tuyến viền khi gần mép.
function flowField(Ls, M, dt, W, H, k, o) {
  const n = W * H, xx = new Float32Array(n), xy = new Float32Array(n), yy = new Float32Array(n);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    if (!M[i]) continue;
    const gx = (Ls[y * W + Math.min(W - 1, x + 1)] - Ls[y * W + Math.max(0, x - 1)]) / 2, gy = (Ls[Math.min(H - 1, y + 1) * W + x] - Ls[Math.max(0, y - 1) * W + x]) / 2;
    xx[i] = gx * gx; xy[i] = gx * gy; yy[i] = gy * gy;
  }
  const s = o.flowMm * k;
  blur(xx, W, H, s); blur(xy, W, H, s); blur(yy, W, H, s);
  // eps: gradient 1 L*/mm — vùng phẳng (chỉ còn đuôi lọc của vùng vân bên cạnh) có tỉ số mag/tr cao nhưng không có vân
  const ux = new Float32Array(n), uy = new Float32Array(n), coh = new Float32Array(n), bl = o.blendMm * k, eps = 1 / (k * k);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x, tr = xx[i] + yy[i], df = xx[i] - yy[i], mag = Math.sqrt(df * df + 4 * xy[i] * xy[i]), c = mag / (tr + eps);
    // tiếp tuyến ⟂ gradient chính: vector góc nhân đôi của tiếp tuyến = −(vector góc nhân đôi của gradient)
    let vx = mag > 1e-9 ? (-df / mag) * c : 0, vy = mag > 1e-9 ? ((-2 * xy[i]) / mag) * c : 0;
    const w = M[i] ? Math.max(0, 1 - dt[i] / bl) : 0;
    if (w > 0) {
      const gx = dt[y * W + Math.min(W - 1, x + 1)] - dt[y * W + Math.max(0, x - 1)], gy = dt[Math.min(H - 1, y + 1) * W + x] - dt[Math.max(0, y - 1) * W + x];
      const gm = Math.hypot(gx, gy);
      if (gm > 1e-6) { const tx = -gy / gm, ty = gx / gm; vx = (1 - w) * vx + w * (tx * tx - ty * ty); vy = (1 - w) * vy + w * 2 * tx * ty; }
    }
    const m = Math.hypot(vx, vy);
    coh[i] = Math.min(1, m);
    if (m < 1e-6) { ux[i] = 1; uy[i] = 0; continue; }
    const t = 0.5 * Math.atan2(vy, vx);
    ux[i] = Math.cos(t); uy[i] = Math.sin(t);
  }
  return { ux, uy, coh };
}

// Đường đồng mức v = 0 (marching squares trên tâm điểm ảnh) → polyline [[x, y], …].
function contours(v, W, H) {
  const segs = [], at = (x, y) => v[y * W + x];
  const pt = (id) => {
    const cell = id >> 1, x = cell % W, y = (cell / W) | 0, [x2, y2] = id & 1 ? [x, y + 1] : [x + 1, y];
    const a = at(x, y), b = at(x2, y2), t = a / (a - b);
    return [x + 0.5 + (x2 - x) * t, y + 0.5 + (y2 - y) * t];
  };
  const T = { 1: [[0, 3]], 2: [[0, 1]], 3: [[3, 1]], 4: [[1, 2]], 5: [[3, 0], [1, 2]], 6: [[0, 2]], 7: [[3, 2]], 8: [[3, 2]], 9: [[0, 2]], 10: [[0, 1], [3, 2]], 11: [[1, 2]], 12: [[3, 1]], 13: [[0, 1]], 14: [[0, 3]] };
  for (let y = 0; y < H - 1; y++) for (let x = 0; x < W - 1; x++) {
    const c = (at(x, y) >= 0) | ((at(x + 1, y) >= 0) << 1) | ((at(x + 1, y + 1) >= 0) << 2) | ((at(x, y + 1) >= 0) << 3);
    if (!T[c]) continue;
    const e = [2 * (y * W + x), 2 * (y * W + x + 1) + 1, 2 * ((y + 1) * W + x), 2 * (y * W + x) + 1]; // trên, phải, dưới, trái
    for (const [p, q] of T[c]) segs.push([e[p], e[q]]);
  }
  const by = new Map();
  segs.forEach((s, i) => s.forEach((id) => { const l = by.get(id); l ? l.push(i) : by.set(id, [i]); }));
  const used = new Uint8Array(segs.length), lines = [];
  for (let s0 = 0; s0 < segs.length; s0++) {
    if (used[s0]) continue;
    used[s0] = 1;
    const ids = [segs[s0][0], segs[s0][1]];
    for (const dir of [1, 0]) for (;;) {
      const end = dir ? ids[ids.length - 1] : ids[0], nx = (by.get(end) || []).find((i) => !used[i]);
      if (nx === undefined) break;
      used[nx] = 1;
      const other = segs[nx][0] === end ? segs[nx][1] : segs[nx][0];
      dir ? ids.push(other) : ids.unshift(other);
    }
    lines.push(ids.map(pt));
  }
  return lines;
}

// Bảng băm điểm (thêm / bớt / duyệt lân cận).
function spatial(cell) {
  const m = new Map(), key = (i, j) => i * 73856093 ^ j * 19349663;
  return {
    add(s) { const k = key(Math.floor(s.x / cell), Math.floor(s.y / cell)); const b = m.get(k); b ? b.push(s) : m.set(k, [s]); },
    del(s) { const b = m.get(key(Math.floor(s.x / cell), Math.floor(s.y / cell))); const i = b ? b.indexOf(s) : -1; if (i >= 0) b.splice(i, 1); },
    near(x, y, r, fn) { // fn trả false → dừng, near trả false
      const cx = Math.floor(x / cell), cy = Math.floor(y / cell), R = Math.ceil(r / cell);
      for (let j = cy - R; j <= cy + R; j++) for (let i = cx - R; i <= cx + R; i++) for (const s of m.get(key(i, j)) || []) if (fn(s) === false) return false;
      return true;
    },
  };
}

// Hungarian (n ≤ m): mỗi hàng 1 cột khác nhau, tổng chi phí nhỏ nhất.
export function hungarian(a) {
  const n = a.length, m = a[0].length, INF = 1e18, u = new Float64Array(n + 1), v = new Float64Array(m + 1), p = new Int32Array(m + 1), way = new Int32Array(m + 1);
  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Float64Array(m + 1).fill(INF), used = new Uint8Array(m + 1);
    do {
      used[j0] = 1;
      const i0 = p[j0];
      let delta = INF, j1 = 0;
      for (let j = 1; j <= m; j++) if (!used[j]) {
        const cur = a[i0 - 1][j - 1] - u[i0] - v[j];
        if (cur < minv[j]) { minv[j] = cur; way[j] = j0; }
        if (minv[j] < delta) { delta = minv[j]; j1 = j; }
      }
      for (let j = 0; j <= m; j++) if (used[j]) { u[p[j]] += delta; v[j] -= delta; } else minv[j] -= delta;
      j0 = j1;
    } while (p[j0] !== 0);
    do { const j1 = way[j0]; p[j0] = p[j1]; j0 = j1; } while (j0);
  }
  const ans = new Int32Array(n);
  for (let j = 1; j <= m; j++) if (p[j]) ans[p[j] - 1] = j - 1;
  return ans;
}

// k-means (Lab, có trọng số), khởi tạo điểm xa nhất (tất định).
function kmeans(X, w, K, iters = 20) {
  const n = X.length, C = [], wsum = w.reduce((a, b) => a + b, 0);
  const mean = [0, 1, 2].map((j) => X.reduce((a, x, i) => a + x[j] * w[i], 0) / wsum), dmin = new Float64Array(n).fill(Infinity);
  let last = mean;
  for (let c = 0; c < Math.min(K, n); c++) {
    let best = 0;
    for (let i = 0; i < n; i++) { dmin[i] = Math.min(dmin[i], de76(X[i], last) ** 2); if (dmin[i] * w[i] > dmin[best] * w[best]) best = i; }
    last = X[best]; C.push([...last]);
  }
  const lab = new Int32Array(n);
  for (let it = 0; it < iters; it++) {
    for (let i = 0; i < n; i++) { let b = 0; for (let c = 1; c < C.length; c++) if (de76(X[i], C[c]) < de76(X[i], C[b])) b = c; lab[i] = b; }
    const S = C.map(() => [0, 0, 0, 0]);
    for (let i = 0; i < n; i++) { const s = S[lab[i]]; s[0] += X[i][0] * w[i]; s[1] += X[i][1] * w[i]; s[2] += X[i][2] * w[i]; s[3] += w[i]; }
    S.forEach((s, c) => { if (s[3]) C[c] = [s[0] / s[3], s[1] / s[3], s[2] / s[3]]; });
  }
  const wt = C.map(() => 0);
  for (let i = 0; i < n; i++) wt[lab[i]] += w[i];
  return { C, wt };
}

// API thuần (KIT-6 kit.html / pipeline gọi): ảnh RGBA { w, h, data } + mặt nạ (Uint8Array theo px ảnh; null = alpha ≥ 128)
// + params (PLACE + frame { x, y, scale }: px bản đồ = frame + px ảnh × scale, features, avoid ({x, y, dMm reference | physMm}),
// catalog (mặc định loadCatalog()), codes, symbols, idPrefix…)
// → { stones (schema KIT-1 + kind + physMm), params (đã tính đủ, không kèm catalog / ảnh), stats,
//     colors: [{ code, symbol, fill = catalog_hex, dMm = reference, physMm, kind, count }], symbols: { mã: ký hiệu } }.
export function place(image, mask, params = {}) {
  const catalog = params.catalog || loadCatalog();
  mask = withRegion(image, mask, params.regionMask); // vùng đá của KIT-10 (lib/kit/vlm.js)
  const r = placeStones(image, { ...params, regionMask: undefined, catalog, mask: mask || undefined });
  const { catalog: _c, mask: _m, regionMask: _r, avoid, features, ...rest } = params;
  const resolved = { ...resolveParams(rest, catalog), frame: { x: 0, y: 0, scale: 1, ...params.frame } };
  if (features) resolved.features = features;
  if (avoid) resolved.avoid = avoid.length;
  return { stones: r.map.stones, params: resolved, stats: r.stats, colors: r.colors, symbols: r.symbols };
}

export function placeStones(img, opts = {}) {
  const cat = opts.catalog || loadCatalog(), o = resolveParams(opts, cat);
  const frame = { x: 0, y: 0, scale: 1, ...opts.frame, mapPx: 1 / o.pxPerMm };
  const PAL = normPalette(cat, o.codes);
  if (!PAL.at(o.mainSizeMm).length) throw new Error(`catalog không có mã cỡ ${o.mainSizeMm}mm (cỡ có: ${o.stoneSizesMm.join(', ')})`);
  const mask = opts.mask || Uint8Array.from({ length: img.w * img.h }, (_, i) => (img.data[i * 4 + 3] >= 128 ? 1 : 0));
  const gs = o.workPxPerMm / o.pxPerMm, k = o.workPxPerMm; // gs = px làm việc / px bản đồ, k = px làm việc / mm
  const G = workGrid(img, mask, frame, gs, o.pitchMm / 3);
  if (!G) return { map: { stones: [] }, colors: [], symbols: {}, stats: { stones: 0 } };
  const { W, H, M } = G, N = W * H;
  const toMap = (x, y) => [G.X0 + x / gs, G.Y0 + y / gs];
  const idx = (x, y) => Math.min(H - 1, Math.max(0, Math.floor(y))) * W + Math.min(W - 1, Math.max(0, Math.floor(x)));
  const st = o.mainSizeMm, r0 = st / 2, gap = o.minMm - st;

  // 1–2) làm mượt giữ biên, khoảng cách tới mép, hướng lông
  const [Ls, As, Bs] = smoothLab(G, o.smoothMm * k, o.smoothDE, o.smoothIter);
  const dt = edt(M, W, H);
  const { ux, uy, coh } = flowField(Ls, M, dt, W, H, k, o);
  const dtAt = (x, y) => { // song tuyến; mép thật của mặt nạ gần hơn nửa điểm ảnh so với tâm điểm ngoài
    const u = x - 0.5, v = y - 0.5, x0 = Math.floor(u), y0 = Math.floor(v), tx = u - x0, ty = v - y0;
    const g = (i, j) => (i < 0 || j < 0 || i >= W || j >= H ? 0 : dt[j * W + i]);
    return (g(x0, y0) * (1 - tx) + g(x0 + 1, y0) * tx) * (1 - ty) + (g(x0, y0 + 1) * (1 - tx) + g(x0 + 1, y0 + 1) * tx) * ty - 0.5;
  };
  const fits = (x, y, s, slack = 0.02) => dtAt(x, y) >= (s / 2 + o.insetMm - slack) * k;
  const ang = (x, y) => { const i = idx(x, y); return Math.atan2(uy[i], ux[i]); };
  const coherent = (x, y) => coh[idx(x, y)] >= o.coherence;

  // viên: { x, y (lưới làm việc), s (mm), rot (rad), kind: accent | rim | edge | line | fill }
  const all = [], hash = spatial(o.minMm * k);
  let maxS = Math.max(st, ...(o.accents ? o.accentSizesMm : []));
  for (const a of opts.avoid || []) { const s = { x: (a.x - G.X0) * gs, y: (a.y - G.Y0) * gs, s: +(a.physMm ?? physOf(+a.dMm, cat)), obstacle: true }; hash.add(s); maxS = Math.max(maxS, s.s); }
  const minD = (s, t) => ((s + t) / 2 + gap) * k;
  const free = (x, y, s, self) => hash.near(x, y, minD(s, maxS), (t) => t === self || Math.hypot(t.x - x, t.y - y) >= minD(s, t.s) - 1e-6);
  const put = (s) => { all.push(s); hash.add(s); return s; };

  // 3a) đá nhấn mắt / mũi
  const accentStones = [];
  if (o.accents && o.accentSizesMm.length) {
    const sizes = [...o.accentSizesMm].sort((a, b) => b - a);
    if (opts.features?.length) {
      for (const f of opts.features) { // bbox px ảnh nguồn → tâm = trọng tâm 30% điểm tối nhất trong hộp, cỡ = lớn nhất vừa hộp
        const mx0 = (frame.x + f.x * frame.scale - G.X0) * gs, my0 = (frame.y + f.y * frame.scale - G.Y0) * gs;
        const bw = f.w * frame.scale * gs, bh = f.h * frame.scale * gs, px = [];
        for (let y = Math.max(0, Math.floor(my0)); y < Math.min(H, Math.ceil(my0 + bh)); y++) for (let x = Math.max(0, Math.floor(mx0)); x < Math.min(W, Math.ceil(mx0 + bw)); x++) if (M[y * W + x]) px.push(y * W + x);
        if (!px.length) continue;
        px.sort((a, b) => Ls[a] - Ls[b]);
        const dark = px.slice(0, Math.max(1, Math.ceil(px.length * 0.3)));
        const cx = dark.reduce((a, i) => a + (i % W) + 0.5, 0) / dark.length, cy = dark.reduce((a, i) => a + Math.floor(i / W) + 0.5, 0) / dark.length;
        const side = Math.min(bw, bh) / k;
        for (const s of sizes.filter((s) => s <= side * 1.1 || s === sizes[sizes.length - 1])) {
          if (fits(cx, cy, s) && free(cx, cy, s)) { accentStones.push(put({ x: cx, y: cy, s, rot: 0, kind: 'accent' })); break; }
        }
      }
    } else accentStones.push(...autoAccents());
  }
  // Đốm tối gọn tương phản cao: lõi (hộp ≈ đĩa đá) khác hẳn vành, lõi đồng màu; dò trên lưới thu nhỏ ~4 px/mm.
  function autoAccents() {
    const f = Math.max(1, Math.floor(k / 4)), w = Math.floor(W / f), h = Math.floor(H / f), kd = k / f, n = w * h;
    const dl = new Float32Array(n), da = new Float32Array(n), db = new Float32Array(n), dm = new Float32Array(n);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let c = 0, l = 0, a = 0, b = 0;
      for (let j = 0; j < f; j++) for (let i = 0; i < f; i++) { const p = (y * f + j) * W + x * f + i; if (M[p]) { c++; l += G.L[p]; a += G.A[p]; b += G.B[p]; } }
      const q = y * w + x;
      if (c * 2 >= f * f) { dm[q] = 1; dl[q] = l / c; da[q] = a / c; db[q] = b / c; }
    }
    const integ = (src) => {
      const I = new Float64Array((w + 1) * (h + 1));
      for (let y = 0; y < h; y++) { let s = 0; for (let x = 0; x < w; x++) { s += src[y * w + x]; I[(y + 1) * (w + 1) + x + 1] = I[y * (w + 1) + x + 1] + s; } }
      return I;
    };
    const IM = integ(dm), IL = integ(dl), IA = integ(da), IB = integ(db), IL2 = integ(dl.map((v) => v * v));
    const box = (I, x, y, r) => {
      const x0 = Math.max(0, x - r), y0 = Math.max(0, y - r), x1 = Math.min(w - 1, x + r), y1 = Math.min(h - 1, y + r), S = w + 1;
      return I[(y1 + 1) * S + x1 + 1] - I[y0 * S + x1 + 1] - I[(y1 + 1) * S + x0] + I[y0 * S + x0];
    };
    const cand = [];
    for (const s of o.accentSizesMm) {
      const h1 = Math.max(1, Math.round(0.886 * (s / 2) * kd - 0.5)), h2 = Math.max(h1 + 1, Math.round(o.accentRing * h1 + 0.3));
      const C = new Float32Array(n), ok = [];
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const q = y * w + x;
        if (!dm[q]) continue;
        const cc = box(IM, x, y, h1), co = box(IM, x, y, h2), rc = co - cc;
        if (cc < (2 * h1 + 1) ** 2 * 0.9 || rc < ((2 * h2 + 1) ** 2 - (2 * h1 + 1) ** 2) * 0.5) continue;
        const core = [box(IL, x, y, h1) / cc, box(IA, x, y, h1) / cc, box(IB, x, y, h1) / cc];
        const ring = [(box(IL, x, y, h2) - core[0] * cc) / rc, (box(IA, x, y, h2) - core[1] * cc) / rc, (box(IB, x, y, h2) - core[2] * cc) / rc];
        if (o.accentDark && core[0] >= ring[0]) continue;
        const de = de76(core, ring), sd = Math.sqrt(Math.max(0, box(IL2, x, y, h1) / cc - core[0] ** 2));
        if (de < o.accentDE || sd > o.accentStd * de) continue;
        C[q] = de; ok.push(q);
      }
      for (const q of ok) {
        const x = q % w, y = (q / w) | 0;
        let peak = true;
        for (let j = -h1; j <= h1 && peak; j++) for (let i = -h1; i <= h1; i++) {
          const xx = x + i, yy = y + j, p = yy * w + xx;
          if ((i || j) && xx >= 0 && yy >= 0 && xx < w && yy < h && (C[p] > C[q] || (C[p] === C[q] && p < q))) { peak = false; break; }
        }
        if (peak) cand.push({ x: (x + 0.5) * f, y: (y + 0.5) * f, s, de: C[q] });
      }
    }
    cand.sort((a, b) => b.de - a.de);
    const out = [];
    for (const c of cand) {
      if (out.length >= o.maxAccents) break;
      if (fits(c.x, c.y, c.s) && free(c.x, c.y, c.s)) out.push(put({ x: c.x, y: c.y, s: c.s, rot: 0, kind: 'accent' }));
    }
    return out;
  }

  const step = o.stepMm * k, row = o.rowMm * k, h = Math.max(0.5, (o.pitchMm / 7.5) * k);
  // mẫu đường (viền + streamline) để giữ khoảng cách hàng; đá nhấn / đá cạnh / viên cố định cũng là chướng ngại
  const lineHash = spatial(row);
  let lineId = 0;
  const lineFar = (x, y, thr) => lineHash.near(x, y, thr, (p) => Math.hypot(p.x - x, p.y - y) >= thr)
    && hash.near(x, y, thr + ((maxS - st) * k) / 2, (t) => t.kind === 'line' || t.kind === 'rim' || Math.hypot(t.x - x, t.y - y) >= thr + ((t.s - st) * k) / 2);
  // đặt viên dọc polyline: viên đầu ở điểm đầu tiên đặt được, sau đó tại đúng điểm dây cung = step (nội suy trên đoạn)
  // nếu không chồng, không thì điểm kế tiếp đặt được
  const stonesAlong = (pts, kind) => {
    let last = null;
    for (let i = 0; i < pts.length; i++) {
      let p = pts[i];
      if (last) {
        const d = Math.hypot(p[0] - last[0], p[1] - last[1]);
        if (d < step) continue;
        const b = pts[i - 1], db = Math.hypot(b[0] - last[0], b[1] - last[1]);
        if (db < step && d - db > 1e-9) { const t = (step - db) / (d - db); p = [b[0] + (p[0] - b[0]) * t, b[1] + (p[1] - b[1]) * t]; }
      }
      if (!fits(p[0], p[1], st) || !free(p[0], p[1], st)) continue;
      const q = pts[Math.min(pts.length - 1, i + 1)], b = pts[Math.max(0, i - 1)], t = Math.atan2(q[1] - b[1], q[0] - b[0]);
      put({ x: p[0], y: p[1], s: st, rot: kind === 'rim' || coherent(p[0], p[1]) ? t : 0, kind });
      last = p;
    }
  };
  const addLine = (pts) => { const l = lineId++; pts.forEach((p, i) => lineHash.add({ x: p[0], y: p[1], l, i })); return l; };
  const resample = (pts) => { // chia lại polyline theo bước h
    const out = [pts[0]];
    let acc = 0;
    for (let i = 1; i < pts.length; i++) {
      let [x0, y0] = pts[i - 1];
      const [x1, y1] = pts[i];
      let d = Math.hypot(x1 - x0, y1 - y0);
      while (acc + d >= h) { const t = (h - acc) / d; x0 += (x1 - x0) * t; y0 += (y1 - y0) * t; out.push([x0, y0]); d = Math.hypot(x1 - x0, y1 - y0); acc = 0; }
      acc += d;
    }
    return out;
  };

  // 3b) hàng viền: đường đồng mức dt = r (lùi vào 1 bán kính)
  const seedLines = [];
  for (const c of contours(Float32Array.from(dt, (v) => v - 0.5 - (r0 + o.insetMm) * k), W, H)) {
    if (c.length < 2) continue;
    const pts = resample(c);
    stonesAlong(pts, 'rim');
    addLine(pts);
    seedLines.push(pts);
  }

  // 3c) cạnh mạnh: cực đại gradient màu (ảnh đã mượt) có 2 bên tương phản → 1 viên mỗi bên, cách cạnh minMm/2
  if (o.edges) {
    const mag = new Float32Array(N), nx = new Float32Array(N), ny = new Float32Array(N);
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      if (!M[i]) continue;
      let gxx = 0, gyy = 0, gxy = 0;
      for (const C of [Ls, As, Bs]) { const gx = (C[i + 1] - C[i - 1]) / 2, gy = (C[i + W] - C[i - W]) / 2; gxx += gx * gx; gyy += gy * gy; gxy += gx * gy; }
      const df = gxx - gyy, l1 = (gxx + gyy + Math.sqrt(df * df + 4 * gxy * gxy)) / 2, t = 0.5 * Math.atan2(2 * gxy, df);
      mag[i] = Math.sqrt(l1) * k; nx[i] = Math.cos(t); ny[i] = Math.sin(t);
    }
    const cand = [];
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      if (mag[i] < o.edgeGradMm) continue;
      const dx = Math.round(nx[i]), dy = Math.round(ny[i]);
      if (mag[i] < mag[i + dy * W + dx] || mag[i] <= mag[i - dy * W - dx]) continue; // NMS dọc pháp tuyến
      cand.push(i);
    }
    cand.sort((a, b) => mag[b] - mag[a]);
    const off = (o.minMm / 2) * k, probe = (o.pitchMm / 2) * k, lab = (x, y) => { const i = idx(x, y); return [Ls[i], As[i], Bs[i]]; };
    for (const i of cand) {
      const x = (i % W) + 0.5, y = Math.floor(i / W) + 0.5, a = nx[i], b = ny[i];
      if (!hash.near(x, y, off * 0.9, (t) => Math.hypot(t.x - x, t.y - y) >= off * 0.9)) continue; // đã có viên đè lên cạnh
      if (de2000(lab(x - a * probe, y - b * probe), lab(x + a * probe, y + b * probe)) < o.edgeDE) continue;
      const t = Math.atan2(a, -b); // tiếp tuyến cạnh
      for (const sg of [-1, 1]) {
        const px = x + sg * a * off, py = y + sg * b * off;
        if (fits(px, py, st) && free(px, py, st)) put({ x: px, y: py, s: st, rot: t, kind: 'edge' });
      }
    }
  }

  // 3d) streamline cách đều (Jobard–Lefer): hạt giống ở ±row theo pháp tuyến các đường đã có; vết theo hướng lông
  // (RK2, giữ chiều), dừng khi ra khỏi vùng đặt được / sát đường khác < dtest / tự quấn; đặt đá cách step trên đường.
  const dtest = o.testFrac * row;
  const field = (x, y, px, py) => { const i = idx(x, y); let a = ux[i], b = uy[i]; if (a * px + b * py < 0) { a = -a; b = -b; } return [a, b]; };
  const trace = (sx, sy, dir0, own) => {
    const out = [];
    let x = sx, y = sy, [px, py] = dir0;
    for (let n = 0; n < 50000; n++) {
      const [a1, b1] = field(x, y, px, py), [a2, b2] = field(x + (a1 * h) / 2, y + (b1 * h) / 2, a1, b1);
      const nx2 = x + a2 * h, ny2 = y + b2 * h;
      if (!fits(nx2, ny2, st, 0.3) || !lineFar(nx2, ny2, dtest)) break;
      if (!own.near(nx2, ny2, dtest, (p) => p.n > n - (2 * dtest) / h || Math.hypot(p.x - nx2, p.y - ny2) >= dtest)) break; // tự quấn
      out.push([nx2, ny2]); own.add({ x: nx2, y: ny2, n });
      x = nx2; y = ny2; px = a2; py = b2;
    }
    return out;
  };
  const seedFrom = (pts) => {
    const out = [], every = Math.max(1, Math.round(step / h / 2));
    for (let i = 0; i < pts.length; i += every) {
      const p = pts[i], q = pts[Math.min(pts.length - 1, i + 1)], b = pts[Math.max(0, i - 1)];
      const tx = q[0] - b[0], ty = q[1] - b[1], tl = Math.hypot(tx, ty) || 1;
      for (const sg of [-1, 1]) out.push([p[0] - (sg * ty * row) / tl, p[1] + (sg * tx * row) / tl]);
    }
    return out;
  };
  const queue = [];
  for (const pts of seedLines) queue.push(...seedFrom(pts));
  for (const s of all) if (s.kind === 'edge' || s.kind === 'accent') queue.push([s.x + row, s.y], [s.x - row, s.y], [s.x, s.y + row], [s.x, s.y - row]);
  const growFrom = (sx, sy) => {
    if (!fits(sx, sy, st, 0.3) || !lineFar(sx, sy, row * 0.98)) return false;
    const i0 = idx(sx, sy), d = [ux[i0], uy[i0]];
    const fwd = trace(sx, sy, d, spatial(dtest)), back = trace(sx, sy, [-d[0], -d[1]], spatial(dtest));
    const pts = [...back.reverse(), [sx, sy], ...fwd];
    addLine(pts);
    stonesAlong(pts, 'line');
    queue.push(...seedFrom(pts));
    return true;
  };
  const drain = () => { while (queue.length) { const [x, y] = queue.pop(); growFrom(x, y); } };
  drain();
  // vùng chưa có đường nào (đảo tách rời, lõi xa viền): quét thưa, gieo hạt mới
  for (let y = row / 2; y < H; y += row / 2) for (let x = row / 2; x < W; x += row / 2) if (M[idx(x, y)] && growFrom(x, y)) drain();

  // lấp khe: quét lưới mịn, đặt viên chính ở mọi chỗ còn vừa (circle packing tham lam)
  const fillGaps = () => {
    const fine = Math.max(1, 0.25 * k);
    let n = 0;
    for (let y = 0.5; y < H; y += fine) for (let x = 0.5; x < W; x += fine) if (M[idx(x, y)] && fits(x, y, st) && free(x, y, st)) { put({ x, y, s: st, rot: coherent(x, y) ? ang(x, y) : 0, kind: 'fill' }); n++; }
    return n;
  };

  // Voronoi rời rạc (theo mép viên) trong bán kính R quanh mỗi viên, chỉ trong mặt nạ → nhãn chủ từng điểm.
  const voronoi = (Rmm) => {
    const lab = new Int32Array(N).fill(-1), best = new Float32Array(N).fill(Infinity), R = Rmm * k;
    all.forEach((s, j) => {
      const rs = (s.s * k) / 2, rr = R + rs - r0 * k;
      for (let y = Math.max(0, Math.floor(s.y - rr)); y <= Math.min(H - 1, Math.ceil(s.y + rr)); y++) for (let x = Math.max(0, Math.floor(s.x - rr)); x <= Math.min(W - 1, Math.ceil(s.x + rr)); x++) {
        const i = y * W + x;
        if (!M[i]) continue;
        const dd = Math.hypot(x + 0.5 - s.x, y + 0.5 - s.y);
        if (dd > rr) continue;
        if (dd - rs < best[i]) { best[i] = dd - rs; lab[i] = j; }
      }
    });
    return lab;
  };
  // 3e) Lloyd ràng buộc: viên streamline / lấp khe dịch nửa đường về tâm khối ô Voronoi (≤ lloydMaxMm), chỉ khi vẫn
  // nằm trong vùng và không chồng; đá nhấn / viền / cạnh giữ nguyên.
  // Có fill: xen kẽ lấp khe ↔ Lloyd (relaxRounds vòng) — Lloyd dàn đều làm lộ khe mới, vòng sau lấp tiếp (CVT → gần lục giác).
  const lloyd = () => { for (let it = 0; it < o.lloyd; it++) {
    const lab = voronoi(o.stepMm * 0.75), S = all.map(() => [0, 0, 0]);
    for (let i = 0; i < N; i++) if (lab[i] >= 0) { const s = S[lab[i]]; s[0] += (i % W) + 0.5; s[1] += Math.floor(i / W) + 0.5; s[2]++; }
    let moved = 0;
    all.forEach((s, j) => {
      if ((s.kind !== 'line' && s.kind !== 'fill') || !S[j][2]) return;
      let dx = (S[j][0] / S[j][2] - s.x) / 2, dy = (S[j][1] / S[j][2] - s.y) / 2;
      const dl = Math.hypot(dx, dy), cap = o.lloydMaxMm * k;
      if (dl < 0.05 * k) return;
      if (dl > cap) { dx *= cap / dl; dy *= cap / dl; }
      const x = s.x + dx, y = s.y + dy;
      if (!fits(x, y, st) || !free(x, y, st, s)) return;
      hash.del(s); s.x = x; s.y = y; hash.add(s); moved++;
    });
    if (!moved) break;
  } };
  if (o.fill) { for (let r = 0; r < o.relaxRounds; r++) { const added = fillGaps(); lloyd(); if (!added && r) break; } fillGaps(); } else lloyd();

  // 4) màu từng viên: Lab gốc, trọng số Gauss (σ = r/2) trong đĩa r; 2 cụm cách xa → lấy cụm nặng hơn
  const sample = (s) => {
    const r = Math.max(0.75, (s.s / 2) * k), sg2 = 2 * (r / 2) ** 2, px = [];
    for (let y = Math.floor(s.y - r); y <= s.y + r; y++) for (let x = Math.floor(s.x - r); x <= s.x + r; x++) {
      if (x < 0 || y < 0 || x >= W || y >= H || !M[y * W + x]) continue;
      const d2 = (x + 0.5 - s.x) ** 2 + (y + 0.5 - s.y) ** 2;
      if (d2 <= r * r) px.push([y * W + x, Math.exp(-d2 / sg2)]);
    }
    const col = (i) => [G.L[i], G.A[i], G.B[i]];
    if (!px.length) return col(idx(s.x, s.y));
    const wmean = (set) => { const t = [0, 0, 0, 0]; for (const [i, w] of set) { t[0] += G.L[i] * w; t[1] += G.A[i] * w; t[2] += G.B[i] * w; t[3] += w; } return [t[0] / t[3], t[1] / t[3], t[2] / t[3], t[3]]; };
    const m0 = wmean(px);
    let c1 = col(px.reduce((m, p) => (de76(col(p[0]), m0) > de76(col(m[0]), m0) ? p : m))[0]);
    let c2 = col(px.reduce((m, p) => (de76(col(p[0]), c1) > de76(col(m[0]), c1) ? p : m))[0]);
    let g1 = [], g2 = [];
    for (let it = 0; it < 4; it++) {
      g1 = []; g2 = [];
      for (const p of px) (de76(col(p[0]), c1) <= de76(col(p[0]), c2) ? g1 : g2).push(p);
      if (!g1.length || !g2.length) break;
      c1 = wmean(g1); c2 = wmean(g2);
    }
    if (!g1.length || !g2.length || de2000(c1, c2) < o.colorSplitDE) return m0.slice(0, 3);
    return (c1[3] >= c2[3] ? c1 : c2).slice(0, 3);
  };
  for (const s of all) s.lab = sample(s);

  // đồ thị láng giềng: 2 viên kề nhau nếu ô Voronoi (bán kính 1 bước) chạm nhau — đối ngẫu Delaunay rời rạc
  const nb = all.map(() => new Set());
  {
    // cạnh dài (qua khe / lỗ) không tính là láng giềng: tâm cách ≤ 1.5 bước + chênh bán kính
    const lab = voronoi(o.stepMm), close = (a, b) => Math.hypot(all[a].x - all[b].x, all[a].y - all[b].y) <= (1.5 * o.stepMm + (all[a].s + all[b].s) / 2 - st) * k;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const a = lab[y * W + x];
      if (a < 0) continue;
      if (x + 1 < W) { const b = lab[y * W + x + 1]; if (b >= 0 && b !== a && close(a, b)) { nb[a].add(b); nb[b].add(a); } }
      if (y + 1 < H) { const b = lab[(y + 1) * W + x]; if (b >= 0 && b !== a && close(a, b)) { nb[a].add(b); nb[b].add(a); } }
    }
  }

  // 5) lượng tử. Đá nhấn: mã catalog gần nhất ở cỡ của nó (không có → hạ cỡ nhấn nhỏ hơn / cỡ chính). Đá chính: mã cỡ chính,
  // tổng mã ≤ maxColors → > K mã thì k-means (K cụm) → Hungarian cụm ↔ mã → mỗi viên mã gần nhất trong tập
  const closest = (lab, set) => set.reduce((m, e) => (de2000(lab, e.lab) < de2000(lab, m.lab) ? e : m));
  for (const s of all) if (s.kind === 'accent') {
    const sizes = [s.s, ...[...o.accentSizesMm].sort((x, y) => y - x).filter((d) => d < s.s), st];
    const d = sizes.find((q) => PAL.at(q).length);
    s.s = d; s.e = closest(s.lab, PAL.at(d));
  }
  const P = PAL.at(st), mainIdx = all.map((s, i) => (s.kind === 'accent' ? -1 : i)).filter((i) => i >= 0);
  const accCodes = new Set(all.filter((s) => s.kind === 'accent').map((s) => s.e.code)), K = Math.max(1, o.maxColors - accCodes.size);
  const nearest = (lab, set) => set.reduce((m, c) => (de2000(lab, P[c].lab) < de2000(lab, P[m].lab) ? c : m));
  const allIdx = P.map((_, i) => i);
  let act = [...new Set(mainIdx.map((i) => nearest(all[i].lab, allIdx)))];
  if (act.length > K) {
    const { C, wt } = kmeans(mainIdx.map((i) => all[i].lab), mainIdx.map(() => 1), Math.min(K, P.length));
    act = [...new Set(hungarian(C.map((c, j) => P.map((e) => (wt[j] + 1e-3) * de2000(c, e.lab)))))];
  }
  const order = all.map((_, i) => i).sort((a, b) => all[a].y - all[b].y || all[a].x - all[b].x);
  if (o.diffuse > 0) { // khuếch tán sai số trên đồ thị láng giềng, theo thứ tự đọc
    const err = all.map(() => [0, 0, 0]), done = new Uint8Array(all.length);
    for (const i of order) {
      if (all[i].kind === 'accent') { done[i] = 1; continue; }
      const s = all[i], t = s.lab.map((v, j) => v + err[i][j]);
      s.c = nearest(t, act); done[i] = 1;
      const e = t.map((v, j) => (v - P[s.c].lab[j]) * o.diffuse), rest = [...nb[i]].filter((j) => !done[j]);
      for (const j of rest) for (let q = 0; q < 3; q++) err[j][q] += e[q] / rest.length;
    }
  } else for (const s of all) if (s.kind !== 'accent') s.c = nearest(s.lab, act);

  // dọn màu lẻ: cụm cùng mã < minCluster viên (ngoài vùng bảo vệ quanh đá nhấn) → mã đa số quanh cụm nếu vẫn gần màu ảnh
  let despeckled = 0;
  if (o.despeckle && o.minCluster > 1) {
    const prot = new Uint8Array(all.length), pr = o.protectMm * k;
    all.forEach((s, i) => { if (s.kind === 'accent' || accentStones.some((a) => Math.hypot(a.x - s.x, a.y - s.y) < pr)) prot[i] = 1; });
    for (let pass = 0; pass < 2; pass++) {
      const seen = new Uint8Array(all.length);
      for (const i0 of order) {
        if (seen[i0] || prot[i0]) continue;
        const comp = [i0], cs = new Set(comp);
        seen[i0] = 1;
        for (let q = 0; q < comp.length && comp.length < o.minCluster; q++) for (const j of nb[comp[q]]) if (all[j].c === all[i0].c && !cs.has(j) && all[j].kind !== 'accent') { cs.add(j); comp.push(j); seen[j] = 1; }
        if (comp.length >= o.minCluster || comp.some((j) => prot[j])) continue;
        const votes = new Map();
        for (const m of comp) for (const j of nb[m]) if (!cs.has(j) && all[j].kind !== 'accent') votes.set(all[j].c, (votes.get(all[j].c) || 0) + 1);
        if (!votes.size) continue;
        const top = Math.max(...votes.values()), mean = [0, 1, 2].map((q) => comp.reduce((a, m) => a + all[m].lab[q], 0) / comp.length);
        const pick = [...votes].filter(([, v]) => v === top).map(([c]) => c).reduce((m, c) => (de2000(mean, P[c].lab) < de2000(mean, P[m].lab) ? c : m));
        if (de2000(mean, P[pick].lab) > o.despeckleDE) continue;
        for (const m of comp) { all[m].c = pick; despeckled++; }
      }
    }
  }

  // 6) mã + ký hiệu theo thiết kế (đá: chữ theo số viên, ngọc trai: số = cỡ)
  for (const s of all) if (s.kind !== 'accent') s.e = P[s.c];
  const tally = new Map();
  for (const s of all) tally.set(s.e.code, (tally.get(s.e.code) || 0) + 1);
  const symbols = assignSymbols(tally, cat, o.symbols || {});

  // 7) ra schema KIT-1, thứ tự đọc theo hàng 1 bước
  const r6 = (v) => Math.round(v * 1e6) / 1e6;
  const deg = (t) => { let d = (t * 180) / Math.PI; d = ((d % 180) + 180) % 180; d = d > 90 ? d - 180 : d; return Object.is(d, -0) ? 0 : r6(d); };
  const out = [...all].sort((a, b) => Math.round(a.y / step) - Math.round(b.y / step) || a.x - b.x);
  const pre = o.idPrefix ?? 'P', start = o.idStart ?? 1, count = new Map();
  const stones = out.map((s, n) => {
    const [X, Y] = toMap(s.x, s.y);
    count.set(s.e.code, (count.get(s.e.code) || 0) + 1);
    return { id: pre + String(start + n).padStart(5, '0'), symbol: symbols[s.e.code], code: s.e.code, x: r6(X), y: r6(Y), dMm: s.e.refMm, rot: s.kind === 'accent' ? 0 : deg(s.rot),
      group: groupOf(s.e.code, s.e.physMm), kind: s.kind, physMm: s.e.physMm };
  });
  const area = M.reduce((a, v) => a + v, 0) / (k * k), main = all.filter((s) => s.kind !== 'accent');
  const nn = main.map((s) => { let d = Infinity; hash.near(s.x, s.y, 2 * step, (t) => { if (t !== s && !t.obstacle) d = Math.min(d, Math.hypot(t.x - s.x, t.y - s.y)); }); return d / k; }).filter(Number.isFinite).sort((a, b) => a - b);
  const q = (p) => (nn.length ? Math.round(nn[Math.floor(p * (nn.length - 1))] * 1000) / 1000 : 0);
  const kinds = {};
  for (const s of all) kinds[s.kind] = (kinds[s.kind] || 0) + 1;
  return {
    map: { stones },
    colors: [...count].sort((a, b) => b[1] - a[1]).map(([code, n]) => { const e = cat.codes[code]; return { code, symbol: symbols[code], fill: e.fill, dMm: e.refMm, physMm: e.physMm, kind: e.kind, count: n }; }),
    symbols,
    stats: {
      stones: stones.length, kinds, colors: new Set(all.map((s) => s.e.fill)).size, codes: count.size, despeckled,
      rotatedFrac: main.length ? r6(main.filter((s) => deg(s.rot) !== 0).length / main.length) : 0,
      areaMm2: r6(area), coverage: r6(all.reduce((a, s) => a + Math.PI * (s.s / 2) ** 2, 0) / area), nnMm: [q(0.1), q(0.5), q(0.9)],
    },
  };
}

// ── ước lượng bước + cỡ hạt từ ảnh ĐÃ có hạt (ảnh _3, ảnh bead hoá, ảnh chụp tranh đá…) → gợi ý mainSizeMm / gapMm.
// Dò blob: với mỗi bước thử P (px), làm mượt Gauss σ = P/5, lấy cực đại địa phương (bán kính 0.4P, nổi hơn trung bình
// quanh nó) = tâm hạt, trung vị khoảng cách láng giềng gần nhất m(P). Bước = điểm tự nhất quán đầu tiên m(P) = P
// (P nhỏ: mỗi hạt nhiều đỉnh → m > P; P lớn: gộp hạt → m < P). Cỡ hạt: bản vá trung bình quanh các tâm, profile theo
// bán kính → đáy đầu tiên = vành bóng tiếp xúc ở mép hạt; đường kính = 2·r_đáy / SIZE_K (hiệu chỉnh trên ảnh render
// KIT-1 nhiều cỡ / khe: sai số cỡ ≈ ±6%, bước ≈ ±1%). Chỉ là GỢI Ý tham số; ảnh không có hạt rõ → null.
const SIZE_K = 1.16;
function gauss(a, W, H, sigma) {
  const r = Math.ceil(3 * sigma), k = Float64Array.from({ length: 2 * r + 1 }, (_, i) => Math.exp(-((i - r) ** 2) / (2 * sigma * sigma)));
  const ks = k.reduce((x, y) => x + y, 0), t = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { let v = 0; for (let i = -r; i <= r; i++) v += a[y * W + Math.min(W - 1, Math.max(0, x + i))] * k[i + r]; t[y * W + x] = v / ks; }
  for (let x = 0; x < W; x++) for (let y = 0; y < H; y++) { let v = 0; for (let j = -r; j <= r; j++) v += t[Math.min(H - 1, Math.max(0, y + j)) * W + x] * k[j + r]; a[y * W + x] = v / ks; }
  return a;
}
function integral(a, W, H) {
  const S = W + 1, I = new Float64Array(S * (H + 1));
  for (let y = 0; y < H; y++) { let s = 0; for (let x = 0; x < W; x++) { s += a[y * W + x]; I[(y + 1) * S + x + 1] = I[y * S + x + 1] + s; } }
  return (x0, y0, x1, y1) => I[(y1 + 1) * S + x1 + 1] - I[y0 * S + x1 + 1] - I[(y1 + 1) * S + x0] + I[y0 * S + x0];
}
// Chạy trên tối đa `windows` cửa sổ win² không chồng, phủ mặt nạ ≥ 98% mức cao nhất, gần trọng tâm mặt nạ trước;
// kết quả = trung vị các cửa sổ (bỏ cửa sổ không ra hạt).
export function estimateGrid(img, mask, { pxPerMm = MM_PX, win = 512, windows = 3 } = {}) {
  const { w: IW, h: IH, data } = img;
  mask = mask || Uint8Array.from({ length: IW * IH }, (_, i) => (data[i * 4 + 3] >= 128 ? 1 : 0));
  const W = Math.min(win, IW), H = Math.min(win, IH), cm = integral(Float32Array.from(mask), IW, IH);
  let mx = 0, my = 0, mc = 0, top = 0;
  for (let i = 0; i < IW * IH; i++) if (mask[i]) { mx += i % IW; my += (i / IW) | 0; mc++; }
  if (mc < 400) return null;
  mx /= mc; my /= mc;
  const wins = [], stp = Math.max(1, win >> 3);
  for (let y = 0; y + H <= IH; y += stp) for (let x = 0; x + W <= IW; x += stp) { const c = cm(x, y, x + W - 1, y + H - 1); wins.push([x, y, c]); top = Math.max(top, c); }
  const pick = [];
  for (const w of wins.filter((w) => w[2] >= 0.98 * top).sort((a, b) => Math.hypot(a[0] + W / 2 - mx, a[1] + H / 2 - my) - Math.hypot(b[0] + W / 2 - mx, b[1] + H / 2 - my))) {
    if (pick.length >= windows) break;
    if (pick.every((q) => Math.abs(q[0] - w[0]) >= W || Math.abs(q[1] - w[1]) >= H)) pick.push(w);
  }
  const res = pick.map(([x, y]) => gridWindow(img, mask, x, y, W, H)).filter(Boolean);
  if (!res.length) return null;
  const med = (k) => { const v = res.map((r) => r[k]).sort((a, b) => a - b); return v.length % 2 ? v[v.length >> 1] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2; };
  const pitchPx = med('pitchPx'), sizePx = Math.min(0.97 * pitchPx, med('sizePx')), r3 = (v) => Math.round(v * 1000) / 1000;
  return {
    pitchMm: r3(pitchPx / pxPerMm), sizeMm: r3(sizePx / pxPerMm), gapMm: r3((pitchPx - sizePx) / pxPerMm), pitchPx: r3(pitchPx), sizePx: r3(sizePx),
    windows: res.map((r) => ({ ...r.window, pitchPx: r3(r.pitchPx), sizePx: r3(r.sizePx), beads: r.beads, plateau: r.plateau })),
  };
}
// 1 cửa sổ: bước (px) + cỡ hạt (px) hoặc null.
function gridWindow(img, mask, bx, by, W, H) {
  const { w: IW, data } = img;
  let bc = 0;
  const n = W * H, L = new Float32Array(n), M = new Uint8Array(n);
  let mean = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const p = (by + y) * IW + bx + x, i = y * W + x;
    if (!mask[p]) continue;
    M[i] = 1; L[i] = rgbToLab(data[p * 4], data[p * 4 + 1], data[p * 4 + 2])[0]; mean += L[i]; bc++;
  }
  if (bc < 400) return null;
  mean /= bc;
  for (let i = 0; i < n; i++) L[i] = M[i] ? L[i] + ((i * 2654435761) % 1000) * 1e-6 : mean; // phá thế hoà giữa các điểm bằng nhau
  const peaksAt = (P) => {
    const rho = Math.max(2, Math.round(0.4 * P)), Ls = gauss(Float32Array.from(L), W, H, Math.max(1, P / 5)), box = integral(Ls, W, H), pk = [];
    const mx = new Float32Array(n), t = new Float32Array(n);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { let m = -Infinity; for (let i = Math.max(0, x - rho); i <= Math.min(W - 1, x + rho); i++) m = Math.max(m, Ls[y * W + i]); t[y * W + x] = m; }
    for (let x = 0; x < W; x++) for (let y = 0; y < H; y++) { let m = -Infinity; for (let j = Math.max(0, y - rho); j <= Math.min(H - 1, y + rho); j++) m = Math.max(m, t[j * W + x]); mx[y * W + x] = m; }
    for (let y = rho; y < H - rho; y++) for (let x = rho; x < W - rho; x++) {
      const i = y * W + x;
      if (M[i] && Ls[i] === mx[i] && Ls[i] - box(x - rho, y - rho, x + rho, y + rho) / (2 * rho + 1) ** 2 > 0.5) pk.push([x, y]);
    }
    const h = spatial(2 * P), pts = pk.map(([x, y]) => ({ x, y }));
    pts.forEach((q) => h.add(q));
    const nn = pts.map((q) => { let d = Infinity; h.near(q.x, q.y, 2 * P, (o) => { if (o !== q) d = Math.min(d, Math.hypot(o.x - q.x, o.y - q.y)); }); return d; }).filter(Number.isFinite).sort((a, b) => a - b);
    return { pk, m: nn.length ? nn[nn.length >> 1] : Infinity };
  };
  const sweep = [];
  for (let P = 6; P <= W / 5; P *= 1.08) { const r = peaksAt(P); sweep.push({ P, m: r.m, n: r.pk.length }); }
  // điểm cắt m = P (từ trên xuống); nhiều điểm cắt (vân nhỏ: nét ký hiệu, sợi vải…) → chọn điểm có m ổn định trên dải P
  // dài nhất (hạt thật: m = bước không đổi khi P đổi), hoà → nhiều đỉnh hơn
  let ci = -1, bq = -1;
  sweep.forEach((s, i) => {
    if (!i || s.n < 20 || s.m > s.P || sweep[i - 1].m <= sweep[i - 1].P) return;
    let q = 0;
    for (const d of [-1, 1]) for (let j = i + d; j >= 0 && j < sweep.length && Math.abs(sweep[j].m / s.m - 1) < 0.1; j += d) q++;
    if (q > bq || (q === bq && s.n > sweep[ci].n)) { bq = q; ci = i; }
  });
  if (ci < 0) return null;
  const a0 = sweep[ci - 1], a1 = sweep[ci], { pk, m } = peaksAt((a0.m + a1.m) / 2);
  // bản vá trung bình (trừ trung bình cục bộ) quanh các tâm → profile bán kính quanh trọng tâm phần sáng
  const R = Math.round(m), S = 2 * R + 1, acc = new Float64Array(S * S), box = integral(L, W, H);
  let cnt = 0;
  for (const [x, y] of pk) {
    if (x < R || y < R || x >= W - R || y >= H - R) continue;
    const mu = box(x - R, y - R, x + R, y + R) / S ** 2;
    cnt++;
    for (let j = -R; j <= R; j++) for (let i = -R; i <= R; i++) acc[(j + R) * S + i + R] += L[(y + j) * W + x + i] - mu;
  }
  if (!cnt) return null;
  let cx = 0, cy = 0, cw = 0;
  for (let j = -R; j <= R; j++) for (let i = -R; i <= R; i++) { const v = acc[(j + R) * S + i + R]; if (v > 0 && i * i + j * j <= (R / 2) ** 2) { cx += i * v; cy += j * v; cw += v; } }
  if (cw) { cx /= cw; cy /= cw; }
  const pr = new Float64Array(R + 2), pc = new Float64Array(R + 2);
  for (let j = -R; j <= R; j++) for (let i = -R; i <= R; i++) {
    const r = Math.hypot(i - cx, j - cy), r0 = Math.floor(r), t = r - r0, v = acc[(j + R) * S + i + R];
    if (r0 >= R) continue;
    pr[r0] += v * (1 - t); pc[r0] += 1 - t; pr[r0 + 1] += v * t; pc[r0 + 1] += t;
  }
  for (let r = 0; r <= R; r++) pr[r] = pc[r] ? pr[r] / pc[r] : 0;
  // đáy thấp nhất trong r ∈ [0.2, 0.62]·bước (hạt ≤ bước; bỏ vân trong lòng hạt như nét ký hiệu ở bản _1)
  let re = Math.max(1, Math.ceil(0.2 * m));
  for (let r = re + 1; r <= Math.min(R - 1, Math.floor(0.62 * m)); r++) if (pr[r] < pr[re]) re = r;
  { const a = pr[re - 1], b = pr[re], c = pr[re + 1], d = a - 2 * b + c; if (d > 1e-9) re += (0.5 * (a - c)) / d; }
  return { pitchPx: m, sizePx: Math.min(0.97 * m, (2 * re) / SIZE_K), beads: pk.length, plateau: bq, window: { x: bx, y: by, w: W, h: H } };
}
