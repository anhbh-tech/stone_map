// KIT-6/7 lab: ảnh pearl diamond painting → bản đồ đá (dạng chuẩn của lib/kit/svgio.js). Không gọi API, không thư viện ngoài.
//  NỀN  : backgroundMask — alpha + ô caro "trong suốt" vẽ chết (nối viền hoặc lỗ kín) + nền phẳng trắng/đen; nền không sinh đá.
//  DETECT: ảnh đã có hạt — dò từng hạt thật: đốm sáng đa thang (DoG chuẩn hoá theo tương phản cục bộ) → tâm (dưới điểm ảnh),
//          bán kính (vành tối) → cỡ VẬT LÝ gần nhất (đá: physOf(đá chính/nhấn); ngọc trai 5–14 mm) → reference cho SVG;
//          ngọc trai = trắng/kem + to ≥ 4.5 mm (isPearl); màu = trung bình đĩa 0.55r bỏ 20% sáng/tối nhất.
//          KIT-12a: vật to trơn (cabochon, opal, ngọc to 4.5–26 mm, bigObjects) dò TRƯỚC = 1 viên; hạt nhỏ có tâm trong nó bị loại.
//          Tầng ≥ 8 → 5–7 → 2.8–4 mm, tầng sau chỉ ở vùng chưa chiếm; mỗi viên có tier + material (gold/pearl/white/color);
//          nhận từ KIT-13: params.bigObjects (bbox viên to) + params.countHints (số hạt nhỏ theo vật liệu / crop). 0 gọi API.
//  PLACE : ảnh mượt — gọi place() của KIT-2 qua adapter runPlace; chưa có thì lưới lục giác (hexPlace).
//  Sau đó: đá → lượng tử màu (k-means Lab, ≤ maxColors) → mã C01.. (cỡ phụ: C01@4.2) + ký hiệu chữ; ngọc trai → mã = ký hiệu = cỡ.
import crypto from 'node:crypto';
import fs from 'node:fs';
import { PX_PER_MM, SCHEMA, sizeGroup, normalizeDoc } from './svgio.js';
import { CHARS } from './glyphs.js';
import { stoneField, renderMap, hex } from './render.js';
import { withRegion } from './vlm.js';

export const SIZES = [2.2, 3.2, 4.2, 5.2, 7.2]; // cỡ vẽ (reference) trong SVG
// Cỡ vật lý ⇄ reference: kit/db/size_map.json (docs/KIT-DATA.md §2; ngoài bảng: reference = vật lý − 0.8).
// Ảnh vẽ hạt theo cỡ VẬT LÝ → dò/khớp theo vật lý, SVG ghi reference (data-width-mm) + nhóm K_<mã>_S<vật lý>.
const SIZE_MAP = (() => {
  try { return JSON.parse(fs.readFileSync(new URL('../../kit/db/size_map.json', import.meta.url), 'utf8')).map((r) => [+r.physical_mm, +r.reference_mm]); }
  catch { return [[2.8, 2.2], [4, 3.2], [5, 4.2], [6, 5.2], [8, 7.2]]; }
})();
const r1 = (v) => Math.round(v * 10) / 10;
export const refOf = (phys) => SIZE_MAP.find(([p]) => p === phys)?.[1] ?? r1(phys - 0.8);
export const physOf = (ref) => SIZE_MAP.find(([, r]) => r === ref)?.[0] ?? r1(ref + 0.8);
export const PEARL_MM = [5, 6, 7, 8, 10, 11, 12, 14]; // catalog series PEARL: mã = số = đường kính
export const DEFAULTS = {
  mode: 'detect', canvasWmm: 300, canvasHmm: 0, // 0 = theo tỉ lệ ảnh
  stoneMm: 2.2, gapMm: 0.8, accentMm: [3.2, 4.2, 5.2, 7.2], maxColors: 24,
  sensitivity: 0.35, // ngưỡng đáp ứng đốm (thấp = nhận nhiều hạt hơn)
  overlap: 0.8,      // 2 hạt xung đột khi tâm cách < overlap·(r1 + r2)
  dropBg: false,     // ảnh không alpha: bỏ nền = điểm gần màu góc trên-trái (lệch kênh ≤ 12), như lib/kit/build.js
  pearls: true,      // DETECT: dò cả ngọc trai 5–14 mm (PEARL_MM) và tách khỏi đá
  big: true,         // DETECT: vật to trơn (cabochon/opal/ngọc to, 4.4–26 mm) = 1 viên, dò trước hạt nhỏ (bigObjects)
  clusterMin: 2,     // DETECT: đốm DoG ≥ 4.5 mm chứa ≥ n đốm nhỏ riêng biệt = cụm hạt nhỏ, bỏ (0 = tắt)
  bigObjects: null,  // DETECT: gợi ý KIT-13 [{ bbox: [x0, y0, x1, y1] }] px ảnh (≤ 1 = tỉ lệ) — viên to, xử lý trước tầng 1
  countHints: null,  // DETECT: KIT-13 [{ bbox?, counts: { gold, white, color } }] số hạt nhỏ (tầng 3) theo vật liệu / crop
};

const clampI = (v, a, b) => (v < a ? a : v > b ? b : v);
const r4 = (v) => Math.round(v * 1e4) / 1e4;
const q = (arr, p) => (arr.length ? arr[Math.min(arr.length - 1, Math.floor(p * arr.length))] : 0);
const toHex = (c) => '#' + c.map((v) => clampI(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('').toUpperCase();

export function normParams(p = {}) {
  const o = { ...DEFAULTS, ...p };
  const num = (v, d) => (Number.isFinite(+v) && +v > 0 ? +v : d);
  o.canvasWmm = num(o.canvasWmm, 300); o.canvasHmm = num(o.canvasHmm, 0); o.stoneMm = num(o.stoneMm, 2.2);
  o.gapMm = Number.isFinite(+o.gapMm) && +o.gapMm >= 0 ? +o.gapMm : 0.8;
  o.accentMm = [...new Set((Array.isArray(o.accentMm) ? o.accentMm : String(o.accentMm).split(/[\s,;]+/)).map(Number).filter((v) => v > 0 && v !== o.stoneMm))].sort((a, b) => a - b);
  o.maxColors = clampI(Math.round(num(o.maxColors, 24)), 1, 200);
  o.sensitivity = num(o.sensitivity, DEFAULTS.sensitivity); o.overlap = num(o.overlap, DEFAULTS.overlap);
  o.dropBg = o.dropBg === true || o.dropBg === 'true' || o.dropBg === 1;
  o.pearls = !(o.pearls === false || o.pearls === 'false' || o.pearls === 0);
  o.big = !(o.big === false || o.big === 'false' || o.big === 0);
  if (!['detect', 'place'].includes(o.mode)) throw new Error(`chế độ lạ: ${o.mode}`);
  return o;
}

// ── ảnh
export function hasAlpha(img) { for (let j = 3; j < img.data.length; j += 4) if (img.data[j] < 255) return true; return false; }
export function alphaMask(img) {
  const m = new Uint8Array(img.w * img.h);
  for (let j = 0; j < m.length; j++) m[j] = img.data[j * 4 + 3] >= 128 ? 1 : 0;
  return m;
}
// ── Nền (KIT-7, docs/KIT-DATA.md §5): ảnh khách/AI gen thường không alpha mà có ô caro "trong suốt" vẽ chết
// (2 mức xám bão hoà thấp, ô ~11–12 px), ở ngoài viền lẫn lỗ kín bên trong (cổ áo), hoặc nền phẳng trắng/đen.
// Nền không bao giờ sinh đá.
//  caro : điểm bão hoà thấp gần 1 trong 2 mức xám → thành phần liên thông 4 (mỗi ô caro 1 thành phần) → cụm ô sáng/tối
//         kề nhau xen kẽ (≥ 8 ô vuông mỗi loại, cỡ ô ≈ c) = nền, bất kể nối viền hay không; rồi lấp đường viền khử răng cưa
//         giữa các ô (xám bão hoà thấp giữa 2 mức) và ô bị viền vật cắt dở.
//  phẳng: thành phần trắng (≥ 240) / đen (≤ 20) bão hoà thấp chạm mép ảnh, lớn (≥ 4 ô) → nền.
//  alpha: < 128 → nền.  Cuối cùng: đốm vật < ½ ô giữa nền → nền; lỗ nền < ½ ô giữa vật → vật.
// → { bg: Uint8Array (1 = nền), mask: Uint8Array (1 = vùng đá), checker: {cell, levels} | null, pct: {alpha, checker, flat, bg} }
function components(on, W, H) {
  const lab = new Int32Array(W * H).fill(-1), comps = [], st = new Int32Array(W * H);
  for (let s0 = 0; s0 < W * H; s0++) {
    if (!on[s0] || lab[s0] >= 0) continue;
    const id = comps.length, c = { id, n: 0, x0: W, y0: H, x1: 0, y1: 0, edge: false };
    let sp = 0; st[sp++] = s0; lab[s0] = id;
    while (sp) {
      const j = st[--sp], x = j % W, y = (j - x) / W;
      c.n++; if (x < c.x0) c.x0 = x; if (x > c.x1) c.x1 = x; if (y < c.y0) c.y0 = y; if (y > c.y1) c.y1 = y;
      if (!x || !y || x === W - 1 || y === H - 1) c.edge = true;
      if (x > 0 && on[j - 1] && lab[j - 1] < 0) { lab[j - 1] = id; st[sp++] = j - 1; }
      if (x < W - 1 && on[j + 1] && lab[j + 1] < 0) { lab[j + 1] = id; st[sp++] = j + 1; }
      if (y > 0 && on[j - W] && lab[j - W] < 0) { lab[j - W] = id; st[sp++] = j - W; }
      if (y < H - 1 && on[j + W] && lab[j + W] < 0) { lab[j + W] = id; st[sp++] = j + W; }
    }
    c.w = c.x1 - c.x0 + 1; c.h = c.y1 - c.y0 + 1; comps.push(c);
  }
  return { lab, comps };
}
// Mở hình thái (co rồi giãn) bằng hộp (2r+1)², qua ảnh tích phân.
function openBox(on, W, H, r) {
  const boxAll = (src, want) => {
    const I = new Float64Array((W + 1) * (H + 1)), out = new Uint8Array(W * H), full = (2 * r + 1) ** 2;
    for (let y = 0; y < H; y++) { let row = 0; for (let x = 0; x < W; x++) { row += src[y * W + x]; I[(y + 1) * (W + 1) + x + 1] = I[y * (W + 1) + x + 1] + row; } }
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const x0 = Math.max(0, x - r), y0 = Math.max(0, y - r), x1 = Math.min(W, x + r + 1), y1 = Math.min(H, y + r + 1);
      const sum = I[y1 * (W + 1) + x1] - I[y0 * (W + 1) + x1] - I[y1 * (W + 1) + x0] + I[y0 * (W + 1) + x0], n = (x1 - x0) * (y1 - y0);
      out[y * W + x] = want === 'all' ? (sum === n ? 1 : 0) : sum > 0 ? 1 : 0;
    }
    return out;
  };
  return boxAll(boxAll(on, 'all'), 'any');
}
function checkerLevels(G, S, W, H, skip) {
  // histogram xám của điểm bão hoà thấp ở dải mép 3% (nền caro thường nối viền); không đủ → cả ảnh
  const hist = (edgeOnly) => {
    const h = new Float64Array(256), b = Math.max(4, Math.round(0.03 * Math.min(W, H)));
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (edgeOnly && x >= b && y >= b && x < W - b && y < H - b) continue;
      const j = y * W + x; if (S[j] <= 18 && !skip[j]) h[G[j] | 0]++;
    }
    return h;
  };
  for (const edgeOnly of [true, false]) {
    const h = hist(edgeOnly), tot = h.reduce((a, v) => a + v, 0);
    if (tot < 200) continue;
    const sm = h.map((_, i) => { let s = 0; for (let d = -3; d <= 3; d++) s += h[clampI(i + d, 0, 255)]; return s; });
    const peak = (a, b) => { let m = a; for (let i = a; i <= b; i++) if (sm[i] > sm[m]) m = i; return m; };
    const hi = peak(200, 255), lo = peak(60, hi - 30);
    if (sm[hi] > 0.05 * tot && sm[lo] > 0.05 * tot && sm[lo] > 0.2 * sm[hi] && sm[hi] > 0.2 * sm[lo]) return [lo, hi];
  }
  return null;
}
export function backgroundMask(img) {
  const W = img.w, H = img.h, N = W * H, d = img.data, G = new Float32Array(N), S = new Uint8Array(N), bg = new Uint8Array(N);
  let nAlpha = 0, nChk = 0, nFlat = 0;
  for (let j = 0; j < N; j++) {
    const r = d[j * 4], g = d[j * 4 + 1], b = d[j * 4 + 2];
    G[j] = 0.299 * r + 0.587 * g + 0.114 * b; S[j] = Math.max(r, g, b) - Math.min(r, g, b);
    if (d[j * 4 + 3] < 128) { bg[j] = 1; nAlpha++; }
  }
  let checker = null;
  const levels = checkerLevels(G, S, W, H, bg);
  if (levels) {
    const [lo, hi] = levels, tol = Math.max(10, (hi - lo) / 4), L = new Uint8Array(N), D = new Uint8Array(N);
    for (let j = 0; j < N; j++) if (S[j] <= 18 && !bg[j]) { if (Math.abs(G[j] - hi) <= tol) L[j] = 1; else if (Math.abs(G[j] - lo) <= tol) D[j] = 1; }
    const cl = components(L, W, H), cd = components(D, W, H), nl = cl.comps.length;
    // cỡ ô: trung vị cạnh lớn của các thành phần cỡ vừa, gần vuông
    const sides = [...cl.comps, ...cd.comps].filter((c) => c.n >= 25 && c.w <= 64 && c.h <= 64 && c.w <= 1.5 * c.h && c.h <= 1.5 * c.w && c.n >= 0.6 * c.w * c.h)
      .map((c) => Math.max(c.w, c.h)).sort((a, b) => a - b);
    if (sides.length >= 6) {
      const cell = q(sides, 0.5), small = (c) => c.w <= 1.6 * cell && c.h <= 1.6 * cell;
      const square = (c) => small(c) && c.w >= 0.6 * cell && c.h >= 0.6 * cell && c.n >= 0.6 * c.w * c.h;
      // union-find: ô sáng ↔ ô tối kề nhau (cách ≤ 2 px: đường khử răng cưa)
      const all = [...cl.comps, ...cd.comps], par = Int32Array.from(all, (_, i) => i);
      const find = (i) => { while (par[i] !== i) i = par[i] = par[par[i]]; return i; };
      const idOf = (j) => (cl.lab[j] >= 0 ? cl.lab[j] : cd.lab[j] >= 0 ? nl + cd.lab[j] : -1);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const j = y * W + x, a = cl.lab[j];
        if (a < 0 || !small(all[a])) continue;
        for (const [dx, dy] of [[1, 0], [2, 0], [3, 0], [0, 1], [0, 2], [0, 3], [-1, 0], [-2, 0], [-3, 0], [0, -1], [0, -2], [0, -3]]) {
          const u = x + dx, v = y + dy; if (u < 0 || v < 0 || u >= W || v >= H) continue;
          const b = cd.lab[v * W + u]; if (b < 0 || !small(all[nl + b])) continue;
          const ra = find(a), rb = find(nl + b); if (ra !== rb) par[ra] = rb;
        }
      }
      const cnt = new Map();
      all.forEach((c, i) => { if (!small(c) || !square(c)) return; const r = find(i), e = cnt.get(r) || [0, 0]; e[i < nl ? 0 : 1]++; cnt.set(r, e); });
      const okRoot = new Set([...cnt].filter(([, [a, b]]) => a >= 8 && b >= 8).map(([r]) => r));
      const chk = new Uint8Array(N);
      for (let j = 0; j < N; j++) { const i = idOf(j); if (i >= 0 && small(all[i]) && okRoot.has(find(i))) chk[j] = 1; }
      // lấp đường khử răng cưa + ô bị cắt dở: xám bão hoà thấp trong [lo − tol, hi + tol] kề ô caro (không lan từ nền alpha), ≤ 3 lượt
      for (let it = 0; it < 3; it++) {
        const add = [];
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
          const j = y * W + x;
          if (bg[j] || chk[j] || S[j] > 18 || G[j] < lo - tol || G[j] > hi + tol) continue;
          if ((x > 0 && chk[j - 1]) || (x < W - 1 && chk[j + 1]) || (y > 0 && chk[j - W]) || (y < H - 1 && chk[j + W])) add.push(j);
        }
        for (const j of add) chk[j] = 1;
      }
      for (let j = 0; j < N; j++) if (chk[j]) { bg[j] = 1; nChk++; }
      if (nChk) checker = { cell, levels: [Math.round(lo), Math.round(hi)] };
    }
  }
  // nền phẳng trắng / đen chạm mép
  const flatMin = Math.max(400, 4 * (checker?.cell || 12) ** 2);
  for (const pick of [(j) => G[j] >= 240, (j) => G[j] <= 20]) {
    let on = new Uint8Array(N);
    for (let j = 0; j < N; j++) if (!bg[j] && S[j] <= 18 && pick(j)) on[j] = 1;
    on = openBox(on, W, H, Math.max(3, Math.round((checker?.cell || 12) / 2))); // bỏ khe mảnh giữa các hạt (đen) / đốm sáng
    const { lab, comps } = components(on, W, H), big = comps.map((c) => c.edge && c.n >= flatMin);
    for (let j = 0; j < N; j++) if (lab[j] >= 0 && big[lab[j]]) { bg[j] = 1; nFlat++; }
  }
  // dọn: đốm vật nhỏ giữa nền → nền; lỗ nền nhỏ giữa vật → vật
  // (+ đảo vật xám không màu < 9 ô giữa nền caro: ô caro méo / gộp, không phải hạt — hạt trắng/ngọc vẫn có bão hoà ~50)
  const cell2 = (checker?.cell || 12) ** 2, minA = Math.max(8, 0.5 * cell2);
  for (const v of [0, 1]) {
    const on = Uint8Array.from(bg, (b) => (b === v ? 1 : 0)), { lab, comps } = components(on, W, H), sat = new Float64Array(comps.length);
    if (v === 0) for (let j = 0; j < N; j++) if (lab[j] >= 0) sat[lab[j]] += S[j];
    const flip = comps.map((c, i) => (v === 0 || !c.edge) && (c.n < minA || (v === 0 && checker && c.n < 9 * cell2 && sat[i] / c.n <= 8)));
    for (let j = 0; j < N; j++) if (lab[j] >= 0 && flip[lab[j]]) bg[j] = 1 - v;
  }
  for (let j = 0; j < N; j++) if (d[j * 4 + 3] < 128) bg[j] = 1;
  let nb = 0; for (let j = 0; j < N; j++) nb += bg[j];
  const pc = (n) => r4((100 * n) / N);
  return { bg, mask: Uint8Array.from(bg, (b) => 1 - b), checker, pct: { alpha: pc(nAlpha), checker: pc(nChk), flat: pc(nFlat), bg: pc(nb) } };
}

// Mặt nạ vùng cần phủ = không phải nền (alpha, caro vẽ chết, nền phẳng chạm mép; backgroundMask).
// dropBg (cũ): thêm điều kiện khác màu góc trên-trái > 12. Không có nền nào → null (cả ảnh).
export function regionMask(img, o, bgm = backgroundMask(img)) {
  const mask = Uint8Array.from(bgm.mask), { pct } = bgm;
  if (o.dropBg) {
    const d = img.data;
    for (let j = 0; j < mask.length; j++) if (Math.max(Math.abs(d[j * 4] - d[0]), Math.abs(d[j * 4 + 1] - d[1]), Math.abs(d[j * 4 + 2] - d[2])) <= 12) mask[j] = 0;
  } else if (!pct.bg) return null;
  return mask;
}
// Độ sáng, thu nhỏ hệ số nguyên f (trung bình hộp).
function gray(img, f = 1) {
  const W = Math.floor(img.w / f), H = Math.floor(img.h / f), g = new Float32Array(W * H), d = img.data;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let s = 0;
    for (let v = 0; v < f; v++) for (let u = 0; u < f; u++) { const j = ((y * f + v) * img.w + x * f + u) * 4; s += 0.299 * d[j] + 0.587 * d[j + 1] + 0.114 * d[j + 2]; }
    g[y * W + x] = s / (f * f);
  }
  return { W, H, g };
}

// Gauss ≈ 3 lần lọc hộp (Kovesi), mép kẹp.
function boxes(sigma) {
  const n = 3, wi = Math.floor(Math.sqrt((12 * sigma * sigma) / n + 1)), wl = wi % 2 ? wi : wi - 1, wu = wl + 2;
  const m = Math.round((12 * sigma * sigma - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4));
  return [0, 1, 2].map((i) => ((i < m ? wl : wu) - 1) / 2);
}
function box1(src, dst, W, H, r, horiz) {
  const n = horiz ? W : H, lines = horiz ? H : W, st = horiz ? 1 : W, ls = horiz ? W : 1, inv = 1 / (2 * r + 1);
  for (let l = 0; l < lines; l++) {
    const o = l * ls, at = (i) => src[o + clampI(i, 0, n - 1) * st];
    let acc = 0;
    for (let i = -r; i <= r; i++) acc += at(i);
    for (let i = 0; i < n; i++) { dst[o + i * st] = acc * inv; acc += at(i + r + 1) - at(i - r); }
  }
}
export function gauss(src, W, H, sigma) {
  let a = Float32Array.from(src), b = new Float32Array(W * H);
  if (sigma < 0.3) return a;
  for (const r of boxes(sigma)) { if (r < 1) continue; box1(a, b, W, H, r, true); box1(b, a, W, H, r, false); }
  return a;
}

// Thu nhỏ RGBA hệ số nguyên f (trung bình hộp, cả alpha).
function shrink(img, f) {
  if (f <= 1) return img;
  const W = Math.floor(img.w / f), H = Math.floor(img.h / f), out = new Uint8Array(W * H * 4), d = img.data;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) for (let c = 0; c < 4; c++) {
    let s = 0;
    for (let v = 0; v < f; v++) for (let u = 0; u < f; u++) s += d[((y * f + v) * img.w + x * f + u) * 4 + c];
    out[(y * W + x) * 4 + c] = Math.round(s / (f * f));
  }
  return { w: W, h: H, data: out };
}

// ── VẬT TO (KIT-12a): cabochon sapphire/ruby/opal, ngọc trai to = MỘT viên, dò TRƯỚC hạt nhỏ.
// Ảnh Lab ~3 px/mm. Hai nguồn ứng viên, chung cổng hình dạng (elip mô-men của vùng đã lấp lỗ — đốm sáng, lỗ khoan):
//  (a) vùng trơn: thành phần liên thông {gradient Lab < T} | {năng lượng dải 0.4 mm < T} | {gradient màu, L×0.25 < T}, nhiều ngưỡng
//      (≈ MSER trên gradient). Opal nhiều mảng màu chỉ ra nguyên viên ở bản dải; sapphire có đốm sáng ở bản gradient.
//  (b) mọc vùng có hạt giống: hạt giống = cực đại LoG màu đa thang 4.4–16 mm trên ảnh đã đóng/mở 0.8 mm; flood minimax theo ΔE
//      tới màu hạt giống (L × 0.6), giữ ngưỡng có biên rõ nhất (sau đó vùng nhảy, trước đó tăng ít). Bắt được bi bóng có bóng đổ.
// Cổng: IoU vùng–elip ≥ 0.85, trục dài/ngắn ≤ 1.8 (< 8 mm: ≤ 1.5 — dài hơn là mảnh / 2 hạt dính), lỗ ≤ 30% (vòng vàng bao hạt nhỏ
// không phải 1 viên), 4.5–26 mm (4 mm Z94 để cho DoG). Chọn theo tầng, to trước.
export const BIG_STONE_MM = [5, 6, 8, 10, 12]; // đá tròn mài giác ≥ 5 mm trong catalog (W5, D6/Q6, Q8, Q10, Q12); không có series oval
const BIG = { minMm: 4.5, maxMm: 26, iou: 0.85, ar: 1.8, arSmall: 1.5, smallMm: 8, holeMax: 0.3, lightMin: 150, gapRatio: 0.72, seedThr: 6, wL: 0.6, minQ: 0.3,
  T: { grad: [15, 20, 25, 30, 38, 46, 55, 65, 80], band: [3, 4, 5, 6, 8, 10, 13, 16], gradC: [6, 8, 10, 13, 16, 20, 25, 32, 40] },
  growT: [3, 4, 5, 6, 7, 8, 10, 12, 14, 17, 20, 24, 28, 33, 39, 46, 54] };
function labPlanes(img, f) {
  const W = Math.floor(img.w / f), H = Math.floor(img.h / f), P = [0, 1, 2].map(() => new Float32Array(W * H)), d = img.data;
  const LUT = Float32Array.from({ length: 256 }, (_, i) => { const v = i / 255; return v > 0.04045 ? ((v + 0.055) / 1.055) ** 2.4 : v / 12.92; });
  const h = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116), n = f * f;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let r = 0, g = 0, b = 0;
    for (let v = 0; v < f; v++) for (let u = 0; u < f; u++) { const j = ((y * f + v) * img.w + x * f + u) * 4; r += LUT[d[j]]; g += LUT[d[j + 1]]; b += LUT[d[j + 2]]; }
    r /= n; g /= n; b /= n;
    const X = h((0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047), Y = h(0.2126 * r + 0.7152 * g + 0.0722 * b), Z = h((0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883), i = y * W + x;
    P[0][i] = 116 * Y - 16; P[1][i] = 500 * (X - Y); P[2][i] = 200 * (Y - Z);
  }
  return { W, H, P };
}
// min/max hộp (2r+1)², tách được
function morph(src, W, H, r, isMax) {
  let a = src;
  for (const horiz of [true, false]) {
    const out = new Float32Array(W * H), n = horiz ? W : H, lines = horiz ? H : W, st = horiz ? 1 : W, ls = horiz ? W : 1;
    for (let l = 0; l < lines; l++) for (let i = 0; i < n; i++) {
      let m = isMax ? -Infinity : Infinity;
      for (let t = Math.max(0, i - r); t <= Math.min(n - 1, i + r); t++) { const v = a[l * ls + t * st]; if (isMax ? v > m : v < m) m = v; }
      out[l * ls + i * st] = m;
    }
    a = out;
  }
  return a;
}
const N4 = (j, W, H) => { const x = j % W; return [x > 0 ? j - 1 : -1, x < W - 1 ? j + 1 : -1, j >= W ? j - W : -1, j < W * (H - 1) ? j + W : -1]; };
// Vùng (chỉ số điểm trên lưới W) → lấp lỗ trong khung bao → elip mô-men (a, b = đường kính trục) + IoU vùng–elip + tỉ lệ lỗ.
function fitBlob(px, n, W, maxD) {
  let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
  for (let i = 0; i < n; i++) { const j = px[i], x = j % W, y = (j / W) | 0; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 - x0 > maxD || y1 - y0 > maxD) return null;
  const bw = x1 - x0 + 3, bh = y1 - y0 + 3, m = new Uint8Array(bw * bh); // 1 = vùng, 2 = ngoài
  for (let i = 0; i < n; i++) m[(((px[i] / W) | 0) - y0 + 1) * bw + (px[i] % W) - x0 + 1] = 1;
  const q = [0]; m[0] = 2;
  while (q.length) for (const k of N4(q.pop(), bw, bh)) if (k >= 0 && !m[k]) { m[k] = 2; q.push(k); }
  let N = 0, sx = 0, sy = 0;
  for (let j = 0; j < bw * bh; j++) if (m[j] !== 2) { N++; sx += j % bw; sy += (j / bw) | 0; }
  const cx = sx / N, cy = sy / N; let sxx = 0, syy = 0, sxy = 0;
  for (let j = 0; j < bw * bh; j++) if (m[j] !== 2) { const dx = (j % bw) - cx, dy = ((j / bw) | 0) - cy; sxx += dx * dx; syy += dy * dy; sxy += dx * dy; }
  sxx /= N; syy /= N; sxy /= N;
  const tr = (sxx + syy) / 2, dd = Math.sqrt(Math.max(0, ((sxx - syy) / 2) ** 2 + sxy * sxy)), a = 4 * Math.sqrt(tr + dd), b = 4 * Math.sqrt(Math.max(tr - dd, 1e-6)), th = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const ct = Math.cos(th), sn = Math.sin(th); let inE = 0, inter = 0;
  for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) { const dx = x - cx, dy = y - cy, u = dx * ct + dy * sn, v = dy * ct - dx * sn; if ((u / (a / 2)) ** 2 + (v / (b / 2)) ** 2 <= 1) { inE++; if (m[y * bw + x] !== 2) inter++; } }
  return { cx: x0 - 1 + cx + 0.5, cy: y0 - 1 + cy + 0.5, a, b, th, iou: inter / (inE + N - inter), hole: (N - n) / N, n: N };
}
class MinHeap {
  constructor() { this.k = []; this.v = []; }
  get size() { return this.k.length; }
  push(key, val) { const K = this.k, V = this.v; let i = K.length; K.push(key); V.push(val); while (i) { const p = (i - 1) >> 1; if (K[p] <= key) break; K[i] = K[p]; V[i] = V[p]; i = p; } K[i] = key; V[i] = val; }
  pop() { const K = this.k, V = this.v, top = V[0], last = K.length - 1, lk = K[last], lv = V[last]; K.pop(); V.pop();
    if (last) { let i = 0; for (;;) { let c = 2 * i + 1; if (c >= last) break; if (c + 1 < last && K[c + 1] < K[c]) c++; if (K[c] >= lk) break; K[i] = K[c]; V[i] = V[c]; i = c; } K[i] = lk; V[i] = lv; }
    return top; }
}
// Tầng (captain): ≥ 8 mm → 5–7 mm (đo 4.5–8) → hạt nhỏ 2.8–4 mm (DoG trong detectBeads); tầng sau chỉ dò ở vùng chưa bị tầng trước
// chiếm (ctx.occ: elip viên đã nhận + đĩa hạt DoG tầng trên). Gợi ý ngoài (KIT-13: bbox viên to) xử lý trước cả tầng 1.
export const TIERS = [{ tier: 1, lo: 8, hi: 26 }, { tier: 2, lo: 4.5, hi: 8 }]; // đường kính ĐO (mm); tầng 3 = phần còn lại
// Đặc trưng chung mọi tầng: lưới Lab, ứng viên vùng trơn (cổng nới, lọc theo tầng sau), hạt giống LoG màu.
// img RGBA; o: { canvasWmm | ppm, ...BIG }; allow: Uint8Array img.w×img.h (1 = được dò) hoặc null.
export function bigContext(img, o = {}, allow = null) {
  const c = { ...BIG, ...o }, ppm = c.ppm ?? img.w / (c.canvasWmm ?? 300), f = Math.max(1, Math.round(ppm / 3)), k = ppm / f;
  const { W, H, P } = labPlanes(img, f), WH = W * H, minD = c.minMm * k, maxD = c.maxMm * k;
  const ok = new Uint8Array(WH).fill(1);
  if (allow) for (let j = 0; j < WH; j++) ok[j] = allow[Math.min(img.h - 1, Math.floor(((j / W | 0) + 0.5) * f)) * img.w + Math.min(img.w - 1, Math.floor(((j % W) + 0.5) * f))];
  // (a) vùng trơn — giữ mọi vùng IoU ≥ 0.7 (gợi ý bbox dùng cổng nới), cổng chặt áp ở bigTier
  const S = P.map((p) => gauss(p, W, H, 0.25 * k)), grad = new Float32Array(WH), gradC = new Float32Array(WH);
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const j = y * W + x; let s = 0, sc = 0;
    for (let ch = 0; ch < 3; ch++) { const gx = S[ch][j + 1] - S[ch][j - 1], gy = S[ch][j + W] - S[ch][j - W], v = gx * gx + gy * gy; s += v; sc += ch ? v : v * 0.0625; }
    grad[j] = (Math.sqrt(s) / 2) * k; gradC[j] = (Math.sqrt(sc) / 2) * k;
  }
  const Bl = P.map((p) => gauss(p, W, H, 0.4 * k)), e = new Float32Array(WH);
  for (let j = 0; j < WH; j++) e[j] = Math.sqrt((P[0][j] - Bl[0][j]) ** 2 + (P[1][j] - Bl[1][j]) ** 2 + (P[2][j] - Bl[2][j]) ** 2);
  const band = gauss(e, W, H, 0.3 * k), on = new Uint8Array(WH), lab = new Int32Array(WH), px = new Int32Array(WH), minN = Math.PI * (0.3 * minD) ** 2, regions = [];
  for (const [map, Ts] of [[grad, c.T.grad], [band, c.T.band], [gradC, c.T.gradC]]) for (const T of Ts) {
    for (let j = 0; j < WH; j++) on[j] = map[j] < T && ok[j] ? 1 : 0;
    lab.fill(0); let id = 0;
    for (let s0 = 0; s0 < WH; s0++) {
      if (!on[s0] || lab[s0]) continue;
      let n = 0, top = 0; lab[s0] = ++id; px[top++] = s0; // px dùng làm ngăn xếp rồi danh sách (đọc từ đầu)
      while (n < top) { const j = px[n++]; for (const q of N4(j, W, H)) if (q >= 0 && on[q] && !lab[q]) { lab[q] = id; px[top++] = q; } }
      if (n < minN) continue;
      const E = fitBlob(px, n, W, maxD);
      if (E && E.iou >= 0.7 && E.hole <= c.holeMax) regions.push(E);
    }
  }
  // (b) hạt giống LoG màu cho mọc vùng
  const rm = Math.max(1, Math.round((0.8 * k) / 2));
  const clean = P.map((p, ch) => { let x = morph(morph(p, W, H, rm, false), W, H, rm, true); if (!ch) x = morph(morph(x, W, H, rm, true), W, H, rm, false); return x; });
  const sm = P.map((p) => gauss(p, W, H, 0.1 * k)), rho = 2 ** 0.25, sig = [];
  for (let s = (minD / 2) / Math.SQRT2 / rho; s <= ((16 * k) / 2 / Math.SQRT2) * rho * rho; s *= rho) sig.push(s);
  const G = clean.map((p) => sig.map((s) => gauss(p, W, H, s))), R = [];
  for (let i = 0; i < sig.length - 1; i++) { const a = new Float32Array(WH); for (let j = 0; j < WH; j++) { let s = 0; for (let ch = 0; ch < 3; ch++) s += (G[ch][i][j] - G[ch][i + 1][j]) ** 2; a[j] = Math.sqrt(s) / (rho - 1); } R.push(a); }
  const seeds = [];
  for (let i = 1; i < R.length - 1; i++) { const a = R[i];
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) { const j = y * W + x, v = a[j];
      if (v < c.seedThr || !ok[j] || v < R[i - 1][j] || v < R[i + 1][j]) continue;
      if (v < a[j - 1] || v < a[j + 1] || v < a[j - W] || v < a[j + W] || v < a[j - W - 1] || v < a[j - W + 1] || v < a[j + W - 1] || v < a[j + W + 1]) continue;
      seeds.push({ x: x + 0.5, y: y + 0.5, r: sig[i] * Math.sqrt(rho) * Math.SQRT2, v }); } }
  seeds.sort((p, q) => q.v - p.v);
  return { img, c, ppm, f, k, W, H, ok, occ: new Uint8Array(WH), regions, seeds, sm, clean, out: [] };
}
const shapeOk = (E, c, k, lo, hi) => { const d = E && Math.sqrt(E.a * E.b); return !!E && E.iou >= c.iou && E.hole <= c.holeMax && d >= lo * k && d < hi * k && E.a / E.b <= (d < c.smallMm * k ? c.arSmall : c.ar); };
// tỉ lệ điểm elip E (lưới ctx) đã bị chiếm
function occFrac(ctx, cx, cy, a, b, th) {
  const { W, H, occ } = ctx, R = a / 2 + 1, ct = Math.cos(th), sn = Math.sin(th); let n = 0, m = 0;
  for (let y = Math.max(0, Math.floor(cy - R)); y <= Math.min(H - 1, Math.ceil(cy + R)); y++) for (let x = Math.max(0, Math.floor(cx - R)); x <= Math.min(W - 1, Math.ceil(cx + R)); x++) {
    const dx = x + 0.5 - cx, dy = y + 0.5 - cy, u = dx * ct + dy * sn, v = dy * ct - dx * sn;
    if ((u / (a / 2)) ** 2 + (v / (b / 2)) ** 2 <= 1) { n++; if (occ[y * W + x]) m++; }
  }
  return n ? m / n : 1;
}
function paint(ctx, cx, cy, a, b, th) {
  const { W, H, occ } = ctx, R = a / 2 + 1, ct = Math.cos(th), sn = Math.sin(th);
  for (let y = Math.max(0, Math.floor(cy - R)); y <= Math.min(H - 1, Math.ceil(cy + R)); y++) for (let x = Math.max(0, Math.floor(cx - R)); x <= Math.min(W - 1, Math.ceil(cx + R)); x++) {
    const dx = x + 0.5 - cx, dy = y + 0.5 - cy, u = dx * ct + dy * sn, v = dy * ct - dx * sn;
    if ((u / (a / 2)) ** 2 + (v / (b / 2)) ** 2 <= 1) occ[y * W + x] = 1;
  }
}
// đánh dấu đĩa (px ảnh) đã chiếm — hạt DoG tầng trên chặn tầng dưới
export function occupyDisc(ctx, x, y, rPx) { if (ctx) paint(ctx, x / ctx.f, y / ctx.f, (2 * rPx) / ctx.f, (2 * rPx) / ctx.f, 0); }
const asObj = (ctx, E, src, tier, extra = {}) => ({ x: E.cx * ctx.f, y: E.cy * ctx.f, aMm: E.a / ctx.k, bMm: E.b / ctx.k, th: E.th, dMm: Math.sqrt(E.a * E.b) / ctx.k, iou: E.iou, hole: E.hole, src, tier, ...extra });
function accept(ctx, o) { ctx.out.push(o); paint(ctx, o.x / ctx.f, o.y / ctx.f, o.aMm * ctx.k, o.bMm * ctx.k, o.th); return o; }
// Một tầng [lo, hi) mm: vùng trơn trong tầng + mọc vùng từ hạt giống cỡ hợp tầng, chỉ trên điểm chưa chiếm. To trước; bỏ ứng viên
// có tâm gần viên đã nhận (mọi tầng) hoặc > 20% elip đã chiếm. Vật sáng (xám trung vị ≥ 150) có khe tối trong 0.6 r (p5 < 0.72 ×
// trung vị) = chùm ngọc nhỏ (mặt dây chuyền), không phải 1 viên — bỏ, để DoG dò từng hạt.
export function bigTier(ctx, { tier, lo, hi }) {
  const { c, k, W, H, f, ppm } = ctx, free = new Uint8Array(W * H), cand = [];
  for (let j = 0; j < free.length; j++) free[j] = ctx.ok[j] && !ctx.occ[j] ? 1 : 0;
  for (const E of ctx.regions) if (shapeOk(E, c, k, lo, hi)) cand.push(asObj(ctx, E, 'region', tier));
  const used = [], g = { W, H, k, sm: ctx.sm, clean: ctx.clean, ok: free, c, minD: lo * k, maxD: hi * k };
  for (const s of ctx.seeds) {
    const d = (2 * s.r) / k; if (d < 0.5 * lo || d > 1.25 * hi || !free[Math.floor(s.y) * W + Math.floor(s.x)]) continue;
    if (used.some((t) => Math.hypot(t.x - s.x, t.y - s.y) < 0.5 * (t.r + s.r))) continue;
    used.push(s);
    const r = growAt(s, g);
    if (r && r.q >= c.minQ && shapeOk(r.E, c, k, lo, hi)) cand.push(asObj(ctx, r.E, 'grow', tier));
  }
  cand.sort((p, q) => q.dMm - p.dMm);
  const got = [];
  for (const b of cand) {
    if (ctx.out.some((t) => Math.hypot(t.x - b.x, t.y - b.y) < 0.4 * (t.dMm + b.dMm) * ppm)) continue;
    if (occFrac(ctx, b.x / f, b.y / f, b.aMm * k, b.bMm * k, b.th) > 0.2) continue;
    const gi = grayIn(ctx.img, b.x, b.y, 0.3 * b.dMm * ppm);
    if (gi.p50 >= c.lightMin && gi.p05 < c.gapRatio * gi.p50) continue;
    got.push(accept(ctx, b));
  }
  return got;
}
// Gợi ý viên to từ ngoài (KIT-13 VLM): [{ bbox: [x0, y0, x1, y1] } | [x0, y0, x1, y1]] px ảnh (mọi số ≤ 1 → tỉ lệ ảnh).
// Mỗi bbox: chọn vùng trơn / vùng mọc (hạt giống ở tâm bbox) khớp elip nội tiếp bbox nhất (IoU elip, cổng nới IoU vùng ≥ 0.7);
// không có cái nào IoU ≥ 0.4 → lấy luôn elip nội tiếp bbox (src 'hint-box'). Không qua cổng vật sáng (VLM đã nói là 1 viên).
export function normBoxes(list, img) {
  if (typeof list === 'string') list = list.trim() ? JSON.parse(list) : [];
  if (!Array.isArray(list)) return [];
  return list.map((h, i) => {
    const b = Array.isArray(h) ? h : h?.bbox; if (!Array.isArray(b) || b.length !== 4 || !b.every(Number.isFinite)) return null;
    const s = b.every((v) => v >= 0 && v <= 1) ? [img.w, img.h, img.w, img.h] : [1, 1, 1, 1], [x0, y0, x1, y1] = b.map((v, j) => v * s[j]);
    return x1 > x0 && y1 > y0 ? { i, x0, y0, x1, y1, ...(Array.isArray(h) ? {} : h), bbox: [x0, y0, x1, y1] } : null;
  }).filter(Boolean);
}
function ellIoU(A, B) {
  const R = Math.max(A.a, B.a) / 2 + 1, x0 = Math.min(A.cx, B.cx) - R, y0 = Math.min(A.cy, B.cy) - R, x1 = Math.max(A.cx, B.cx) + R, y1 = Math.max(A.cy, B.cy) + R;
  const inE = (E, x, y) => { const dx = x - E.cx, dy = y - E.cy, c = Math.cos(E.th), s = Math.sin(E.th), u = dx * c + dy * s, v = dy * c - dx * s; return (u / (E.a / 2)) ** 2 + (v / (E.b / 2)) ** 2 <= 1; };
  const st = Math.max(0.25, (x1 - x0) / 80); let i = 0, u = 0;
  for (let y = y0; y <= y1; y += st) for (let x = x0; x <= x1; x += st) { const a = inE(A, x, y), b = inE(B, x, y); if (a && b) i++; if (a || b) u++; }
  return u ? i / u : 0;
}
export function bigHints(ctx, boxes) {
  const { c, k, f, W, H } = ctx, got = [];
  for (const h of [...boxes].sort((p, q) => (q.x1 - q.x0) * (q.y1 - q.y0) - (p.x1 - p.x0) * (p.y1 - p.y0))) {
    const w = (h.x1 - h.x0) / f, hh = (h.y1 - h.y0) / f, T = { cx: (h.x0 + h.x1) / 2 / f, cy: (h.y0 + h.y1) / 2 / f, a: Math.max(w, hh), b: Math.min(w, hh), th: w >= hh ? 0 : Math.PI / 2 };
    const dT = Math.sqrt(w * hh), cands = ctx.regions.filter((E) => E.cx * f >= h.x0 && E.cx * f <= h.x1 && E.cy * f >= h.y0 && E.cy * f <= h.y1 && Math.sqrt(E.a * E.b) >= 0.6 * dT && Math.sqrt(E.a * E.b) <= 1.4 * dT);
    const free = new Uint8Array(W * H); for (let j = 0; j < free.length; j++) free[j] = ctx.ok[j] && !ctx.occ[j] ? 1 : 0;
    const gr = growAt({ x: T.cx, y: T.cy, r: 0.3 * T.b }, { W, H, k, sm: ctx.sm, clean: ctx.clean, ok: free, c: { ...c, iou: 0.7 }, minD: 0.6 * dT, maxD: 1.5 * T.a });
    if (gr) cands.push(gr.E);
    let best = null, bi = 0.4;
    for (const E of cands) { const v = ellIoU(E, T); if (v > bi) { bi = v; best = E; } }
    const E = best || { ...T, iou: 1, hole: 0 };
    got.push(accept(ctx, asObj(ctx, E, best ? 'hint' : 'hint-box', Math.sqrt(E.a * E.b) / k >= TIERS[0].lo ? 1 : 2, { hint: h.i, hintIoU: r4(bi) })));
  }
  return got;
}
// → [{ x, y (px ảnh), aMm, bMm (trục), th (rad), dMm (= √(a·b)), iou, hole, src: 'region'|'grow'|'hint'|'hint-box', tier }]
// o.hints = bbox KIT-13 (normBoxes) xử lý trước.
export function bigObjects(img, o = {}, allow = null) {
  const ctx = bigContext(img, o, allow);
  if (o.hints?.length) bigHints(ctx, normBoxes(o.hints, img));
  for (const t of TIERS) bigTier(ctx, t);
  return ctx.out;
}
function grayIn(img, x, y, R) {
  const v = [], d = img.data;
  for (let yy = Math.max(0, Math.floor(y - R)); yy <= Math.min(img.h - 1, y + R); yy++) for (let xx = Math.max(0, Math.floor(x - R)); xx <= Math.min(img.w - 1, x + R); xx++)
    if ((xx - x) ** 2 + (yy - y) ** 2 <= R * R) { const j = (yy * img.w + xx) * 4; v.push(0.299 * d[j] + 0.587 * d[j + 1] + 0.114 * d[j + 2]); }
  v.sort((a, b) => a - b);
  return { p05: v[Math.floor(0.05 * (v.length - 1))] ?? 0, p50: v[v.length >> 1] ?? 0 };
}
// flood minimax từ đĩa hạt giống (mỗi điểm bắt đầu bằng ΔE của nó), cửa sổ ±max(3r, 4 mm); vùng ở ngưỡng t = {m ≤ t}.
function growAt(s, { W, H, k, sm, clean, ok, c, maxD, minD }) {
  const Rw = Math.min((maxD / 2) * 1.15, Math.max(3 * s.r, 4 * k)), x0 = Math.max(0, Math.floor(s.x - Rw)), y0 = Math.max(0, Math.floor(s.y - Rw));
  const x1 = Math.min(W - 1, Math.ceil(s.x + Rw)), y1 = Math.min(H - 1, Math.ceil(s.y + Rw)), bw = x1 - x0 + 1, bh = y1 - y0 + 1, rs = Math.max(1, 0.35 * s.r);
  const disc = [];
  for (let y = Math.floor(s.y - rs); y <= s.y + rs; y++) for (let x = Math.floor(s.x - rs); x <= s.x + rs; x++)
    if (x >= x0 && y >= y0 && x <= x1 && y <= y1 && (x + 0.5 - s.x) ** 2 + (y + 0.5 - s.y) ** 2 <= rs * rs) disc.push(y * W + x);
  if (!disc.length) return null;
  const c0 = clean.map((p) => { const v = disc.map((j) => p[j]).sort((a, b) => a - b); return v[v.length >> 1]; });
  const dist = (j) => Math.sqrt((c.wL * (sm[0][j] - c0[0])) ** 2 + (sm[1][j] - c0[1]) ** 2 + (sm[2][j] - c0[2]) ** 2);
  const m = new Float64Array(bw * bh).fill(Infinity), h = new MinHeap(), order = [], tMax = c.growT[c.growT.length - 1];
  for (const j of disc) { const l = (((j / W) | 0) - y0) * bw + (j % W) - x0, v = dist(j); if (v < m[l]) { m[l] = v; h.push(v, l); } }
  while (h.size) {
    const kk = h.k[0], l = h.pop();
    if (kk > m[l]) continue;
    if (kk > tMax) break;
    order.push(l);
    for (const q of N4(l, bw, bh)) { if (q < 0 || m[q] <= kk) continue; const g = (y0 + ((q / bw) | 0)) * W + x0 + (q % bw); if (!ok[g]) continue; const v = Math.max(kk, dist(g)); if (v < m[q]) { m[q] = v; h.push(v, q); } }
  }
  const res = [], gl = new Int32Array(order.length);
  for (let i = 0; i < order.length; i++) gl[i] = (y0 + ((order[i] / bw) | 0)) * W + x0 + (order[i] % bw);
  let n = 0, touch = false;
  for (const t of c.growT) {
    while (n < order.length && m[order[n]] <= t) { const l = order[n], x = l % bw, y = (l / bw) | 0; if (!x || !y || x === bw - 1 || y === bh - 1) touch = true; n++; }
    if (touch) break; // tràn ra mép cửa sổ
    res.push({ t, n, E: n >= Math.PI * (0.25 * minD) ** 2 ? fitBlob(gl, n, W, maxD) : null });
  }
  let best = null;
  for (let i = 0; i < res.length; i++) {
    const r = res[i], E = r.E;
    if (!E || E.iou < c.iou || E.hole > c.holeMax) continue;
    const d = Math.sqrt(E.a * E.b); if (d < minD || d > maxD || E.a / E.b > (d < c.smallMm * k ? c.arSmall : c.ar)) continue;
    const q = (res[i + 1] ? Math.log(res[i + 1].n / r.n) : 1) - (res[i - 1]?.E ? Math.log(r.n / res[i - 1].n) : 0);
    if (!best || q > best.q) best = { E, q };
  }
  return best;
}

// ── Dò hạt
// → { stones: [{x, y, rPx, dMeasMm, physMm, dMm (reference), kind: 'pearl'|'stone', score, feat}] (px ảnh), work: {f, scales} }
export function detectBeads(img, params, mask = null) {
  const o = normParams(params), kImg = img.w / o.canvasWmm; // px ảnh / mm
  // cỡ tìm (vật lý): đá = physOf(đá chính + đá nhấn), ngọc trai = PEARL_MM; o.raw: dùng nguyên cỡ đưa vào, không ngọc (estimateParams)
  const stoneP = o.raw ? [o.stoneMm, ...o.accentMm] : [...new Set([o.stoneMm, ...o.accentMm].map(physOf))].sort((a, b) => a - b);
  const pearlP = o.raw || !o.pearls ? [] : PEARL_MM, sizes = [...stoneP, ...pearlP], rMain = ((o.raw ? o.stoneMm : physOf(o.stoneMm)) / 2) * kImg;
  const f = Math.max(1, Math.floor(rMain / 5)), { W, H, g } = gray(img, f), k = kImg / f;
  const rMin = (0.55 * Math.min(...sizes) * k) / 2, rMax = (1.25 * Math.max(...sizes) * k) / 2, rho = 2 ** 0.25;
  if (rMin < 1) throw new Error(`hạt quá nhỏ trong ảnh (${(2 * rMain).toFixed(1)}px) — kiểm tra cỡ canvas / cỡ đá`);
  const sig = [];
  for (let s = rMin / Math.SQRT2 / Math.sqrt(rho); s <= (rMax / Math.SQRT2) * rho; s *= rho) sig.push(s);
  const G = sig.map((s) => gauss(g, W, H, s));
  // tương phản cục bộ: độ lệch chuẩn quanh ~2 bước hạt
  const pitch = (o.stoneMm + o.gapMm) * k, mean = gauss(g, W, H, 2 * pitch), dev = new Float32Array(W * H);
  for (let j = 0; j < W * H; j++) dev[j] = (g[j] - mean[j]) ** 2;
  const sd = gauss(dev, W, H, 2 * pitch);
  const best = new Float32Array(W * H), arg = new Uint8Array(W * H), n = sig.length - 1;
  for (let j = 0; j < W * H; j++) {
    let b = -Infinity, a = 0;
    const norm = 1 / ((rho - 1) * (Math.sqrt(sd[j]) + 2));
    for (let i = 0; i < n; i++) { const v = (G[i][j] - G[i + 1][j]) * norm; if (v > b) { b = v; a = i; } }
    best[j] = b; arg[j] = a;
  }
  // countHints (KIT-13): giữ thêm đốm yếu (≥ 0.6 × ngưỡng) làm kho bù khi đếm thiếu; chỉ nhận chúng qua applyCount
  const counts = o.raw ? [] : normCounts(o.countHints, img), sFloor = counts.length ? 0.6 * o.sensitivity : o.sensitivity;
  const inMask = (x, y) => !mask || mask[clampI(Math.floor((y + 0.5) * f), 0, img.h - 1) * img.w + clampI(Math.floor((x + 0.5) * f), 0, img.w - 1)];
  const cand = [];
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const j = y * W + x, v = best[j];
    if (v < sFloor) continue;
    if (v < best[j - 1] || v < best[j + 1] || v < best[j - W] || v < best[j + W] || v < best[j - W - 1] || v < best[j - W + 1] || v < best[j + W - 1] || v < best[j + W + 1]) continue;
    if (!inMask(x, y)) continue;
    // bán kính: parabol theo log thang quanh thang tốt nhất; σ_DoG ≈ σ_i·√ρ, đĩa r ↔ σ = r/√2
    const i = arg[j], val = (t) => (G[t][j] - G[t + 1][j]);
    let li = i;
    if (i > 0 && i < n - 1) { const a = val(i - 1), b = val(i), c = val(i + 1), den = a - 2 * b + c; if (den < 0) li = i + clampI((0.5 * (a - c)) / den, -0.5, 0.5); }
    const r = sig[0] * rho ** (li + 0.5) * Math.SQRT2;
    const px = (a, b, c) => { const den = a - 2 * b + c; return den < 0 ? clampI((0.5 * (a - c)) / den, -0.5, 0.5) : 0; };
    cand.push({ x: x + 0.5 + px(best[j - 1], v, best[j + 1]), y: y + 0.5 + px(best[j - W], v, best[j + W]), r, r0: r, score: v, weak: v < o.sensitivity });
  }
  // bán kính theo vành tối (cỡ DoG không tin được: đốm sáng nhỏ hơn hạt, hạt trắng sát nhau gộp thang)
  const gs = gauss(g, W, H, 0.7);
  if (o.refine !== false) {
    const lo = (0.45 * Math.min(...sizes) * k) / 2, hi = (1.15 * Math.max(...sizes) * k) / 2;
    for (const c of cand) Object.assign(c, fitRadius(gs, W, H, c.x, c.y, lo, hi));
  }
  // đốm to (> 1.6 × hạt chính, r sau khớp vành) mà trong 0.6r có khe tối (xám p10 < 0.85 × trung vị) = cụm hạt nhỏ gộp thang
  // (vd cổ áo hạt trắng sát nhau), không phải 1 hạt to: lòng ngọc trai / đá to mịn, chỉ có gradient tròn + 1 đốm sáng.
  {
    const big = (1.6 * rMain) / f, kept = cand.filter((c) => {
      if (c.r < big) return true;
      const R = 0.6 * c.r, v = [];
      for (let y = Math.max(0, Math.floor(c.y - R)); y <= Math.min(H - 1, Math.ceil(c.y + R)); y++) for (let x = Math.max(0, Math.floor(c.x - R)); x <= Math.min(W - 1, Math.ceil(c.x + R)); x++)
        if (Math.hypot(x + 0.5 - c.x, y + 0.5 - c.y) <= R) v.push(gs[y * W + x]);
      v.sort((a, b) => a - b);
      return q(v, 0.1) >= 0.85 * q(v, 0.5);
    });
    cand.splice(0, cand.length, ...kept);
  }
  // đốm sáng (đốm nhỏ gần tâm 1 đốm to hơn ≥ 1.6×, đáp ứng to ≥ ½ đốm nhỏ) = phản quang của hạt to: đốm to được xét TRƯỚC
  // (ưu tiên = đáp ứng đốm sáng) — không thì NMS giữ đốm sáng mạnh hơn và ngọc trai thành 1 đá 2.8 mm. Đốm to bị chặn → đốm sáng vẫn xét bình thường.
  for (const c of cand) c.prio = c.score;
  if (o.highlight !== false) {
    const cs = Math.max(4, rMax), grid = new Map();
    for (const c of cand) { const kk = `${Math.floor(c.x / cs)},${Math.floor(c.y / cs)}`; (grid.get(kk) || grid.set(kk, []).get(kk)).push(c); }
    for (const t of cand) {
      if (t.r < (1.6 * rMain) / f) continue;
      const gx = Math.floor(t.x / cs), gy = Math.floor(t.y / cs), reach = Math.ceil(t.r / cs);
      for (let dy = -reach; dy <= reach; dy++) for (let dx = -reach; dx <= reach; dx++)
        for (const c of grid.get(`${gx + dx},${gy + dy}`) || []) if (c !== t && t.r >= 1.6 * c.r && Math.hypot(c.x - t.x, c.y - t.y) < 0.85 * t.r && t.score >= 0.5 * c.score) t.prio = Math.max(t.prio, c.score);
    }
  }
  cand.sort((a, b) => b.prio - a.prio || b.r - a.r);
  // TẦNG (captain): ≥ 8 mm → 5–7 mm → 2.8–4 mm; tầng sau chỉ nhận ở vùng tầng trên chưa chiếm. Trong 1 tầng: viên to (bigTier; gợi ý
  // bbox KIT-13 trước cả tầng 1) rồi đốm DoG (đo theo vành tối; ranh giới tầng = trung bình nhân cỡ kề: 7|8 → 7.5, 4|5 → 4.47 mm).
  // Đốm DoG tầng 1–2 đánh dấu chiếm để vùng mọc tầng dưới không tràn vào; đốm có tâm trong elip viên to (nới 0.4 r) bị loại.
  const hints = o.raw ? [] : normBoxes(o.bigObjects, img);
  const ctx = o.raw || (!o.big && !hints.length) ? null : bigContext(img, { canvasWmm: o.canvasWmm }, mask), bigs = [];
  const maskOk = (b) => !mask || discIn(mask, img.w, img.h, b.x, b.y, 0.4 * b.dMm * kImg) >= 0.7;
  const inBig = (x, y, r) => bigs.some((b) => { const dx = x - b.x, dy = y - b.y, c = Math.cos(b.th), s = Math.sin(b.th), u = dx * c + dy * s, v = dy * c - dx * s;
    return (u / ((b.aMm * kImg) / 2 + 0.4 * r)) ** 2 + (v / ((b.bMm * kImg) / 2 + 0.4 * r)) ** 2 <= 1; });
  for (const c of cand) { const d = (2 * c.r) / k; c.tier = d >= 7.5 ? 1 : d >= 4.47 ? 2 : 3; }
  const cell = Math.max(2, rMax), grid = new Map(), keep = [];
  const key = (cx, cy) => cx * 73856093 ^ cy * 19349663;
  const free = (c) => {
    if (inBig(c.x * f, c.y * f, c.r * f)) return false;
    const gx = Math.floor(c.x / cell), gy = Math.floor(c.y / cell), reach = Math.ceil((c.r + rMax) / cell);
    for (let dy = -reach; dy <= reach; dy++) for (let dx = -reach; dx <= reach; dx++)
      for (const t of grid.get(key(gx + dx, gy + dy)) || []) if (Math.hypot(t.x - c.x, t.y - c.y) < o.overlap * (t.r + c.r)) return false;
    return true;
  };
  const put = (c) => { const kk = key(Math.floor(c.x / cell), Math.floor(c.y / cell)); (grid.get(kk) || grid.set(kk, []).get(kk)).push(c); };
  // nhận theo thứ tự đáp ứng; bỏ đốm chồng lên hạt đã nhận
  const take = (t) => { for (const c of cand) if (c.tier === t && !c.weak && free(c)) { keep.push(c); put(c); if (ctx && t < 3) occupyDisc(ctx, c.x * f, c.y * f, c.r * f); } };
  // đốm DoG tầng 1–2 chứa ≥ clusterMin đốm nhỏ mạnh riêng biệt trong clusterR·r = cụm hạt nhỏ gộp thang (lớp hạt trắng sát nhau),
  // không phải 1 viên to (ngọc thật: 1 đốm sáng) — bỏ, để tầng 3 dò từng hạt.
  if (+o.clusterMin > 0) {
    const small = cand.filter((c) => c.tier === 3 && !c.weak), cs = Math.max(2, rMax), sg = new Map();
    for (const c of small) { const kk = key(Math.floor(c.x / cs), Math.floor(c.y / cs)); (sg.get(kk) || sg.set(kk, []).get(kk)).push(c); }
    const cR = o.clusterR ?? 0.75, cMin = +o.clusterMin;
    for (const t of cand) {
      if (t.tier === 3 || t.weak) continue;
      const R = cR * t.r, gx = Math.floor(t.x / cs), gy = Math.floor(t.y / cs), reach = Math.ceil(R / cs), got = [];
      for (let dy = -reach; dy <= reach; dy++) for (let dx = -reach; dx <= reach; dx++)
        for (const c of sg.get(key(gx + dx, gy + dy)) || []) if (Math.hypot(c.x - t.x, c.y - t.y) <= R && !got.some((u) => Math.hypot(u.x - c.x, u.y - c.y) < o.overlap * (u.r + c.r))) got.push(c);
      if (got.length >= cMin) t.weak = t.cluster = true;
    }
  }
  if (hints.length) bigs.push(...bigHints(ctx, hints).filter(maskOk));
  for (const t of TIERS) { if (ctx && o.big) bigs.push(...bigTier(ctx, t).filter(maskOk)); take(t.tier); }
  take(3);
  // tâm theo vành tối (sau NMS, bán kính đã đo); 2 đốm hội tụ về 1 hạt → bỏ đốm yếu
  if (o.refine !== false) {
    for (const c of keep) for (let it = 0; it < 3; it++) {
      Object.assign(c, fitCenter(gs, W, H, c.x0 ??= c.x, c.y0 ??= c.y, c.r));
      Object.assign(c, fitRadius(gs, W, H, c.x, c.y, 0.85 * c.r, 1.3 * c.r));
    }
    const out = [];
    for (const c of keep) if (!out.some((t) => Math.hypot(t.x - c.x, t.y - c.y) < 0.5 * (t.r + c.r))) out.push(c);
    keep.length = 0; keep.push(...out);
  }
  const near = (d, list) => list.reduce((a, s) => (Math.abs(Math.log(d / s)) < Math.abs(Math.log(d / a)) ? s : a), list[0]);
  const fitSnap = (d, list) => [...list].reverse().find((v) => v <= d * (o.fitTol ?? 1)) ?? list[0];
  const stones = [];
  // viên to: tròn → ngọc trai (isPearl) hoặc đá BIG_STONE_MM; oval (≥ 8 mm, trục > 1.15) → đá, shape 'oval' + trục (catalog không có
  // oval — captain quyết). Cỡ = cỡ catalog LỚN NHẤT ≤ √(a·b)·fitTol (viên phải nằm trong vật vẽ; Snowman/Dachshund DB: đúng cỡ 25 vs 20
  // khi lấy gần nhất); > 1.15 × cỡ lớn nhất → cờ 'oversize'
  for (const b of bigs) {
    const rPx = (b.dMm * kImg) / 2, oval = b.dMm >= 8 && b.aMm / b.bMm > 1.15, feat = beadFeatures(img, b.x, b.y, 0.7 * rPx);
    const kind = !oval && pearlP.length && isPearl(b.dMm, feat) ? 'pearl' : 'stone', list = kind === 'pearl' ? pearlP : BIG_STONE_MM, physMm = fitSnap(b.dMm, list);
    const flags = [...(oval ? ['oval'] : []), ...(b.dMm > 1.15 * list[list.length - 1] ? ['oversize'] : [])];
    stones.push({ x: b.x, y: b.y, rPx, dMeasMm: r4(b.dMm), physMm, dMm: refOf(physMm), kind, score: r4(b.iou), feat, big: true, shape: oval ? 'oval' : 'round',
      axesMm: [r4(b.aMm), r4(b.bMm)], rotDeg: r4((b.th * 180) / Math.PI), src: b.src, flags, tier: tierOfMm(physMm), material: materialOf(img, b.x, b.y, rPx, kind, feat),
      ...(b.hint !== undefined && { hint: b.hint, hintIoU: b.hintIoU }) });
  }
  const toStone = (c) => {
    const x = c.x * f, y = c.y * f, rPx = c.r * f, dMeas = (2 * c.r) / k;
    if (mask && discIn(mask, img.w, img.h, x, y, 0.8 * rPx) < 0.7) return null; // viên chủ yếu nằm trên nền
    const feat = beadFeatures(img, x, y, 0.35 * 2 * rPx), kind = !o.raw && pearlP.length && isPearl(dMeas, feat) ? 'pearl' : 'stone';
    const physMm = kind === 'pearl' ? near(dMeas, pearlP) : near(dMeas, stoneP);
    return { x, y, rPx, dMeasMm: r4(dMeas), physMm, dMm: o.raw ? physMm : refOf(physMm), kind, score: r4(c.score), contrast: r4(c.contrast ?? 0), feat, tier: tierOfMm(physMm), material: materialOf(img, x, y, rPx, kind, feat) };
  };
  for (const c of keep) { const s = toStone(c); if (s) stones.push(s); }
  // đếm theo vật liệu từ KIT-13: chỉnh tầng 3 trong từng crop (thừa → bỏ đốm yếu nhất; thiếu → thêm đốm yếu từ kho, không chồng)
  const countRep = counts.length ? applyCounts(stones, counts, cand.filter((c) => c.weak && c.tier === 3 && !inBig(c.x * f, c.y * f, c.r * f)), (c) => {
    if (o.refine !== false) for (let it = 0; it < 3; it++) { Object.assign(c, fitCenter(gs, W, H, c.x0 ??= c.x, c.y0 ??= c.y, c.r)); Object.assign(c, fitRadius(gs, W, H, c.x, c.y, 0.85 * c.r, 1.3 * c.r)); }
    return toStone(c);
  }, f, kImg, o.overlap) : null;
  if (countRep) stones.splice(0, stones.length, ...stones.filter((s) => !s.removed));
  const tiers = { 1: 0, 2: 0, 3: 0 };
  for (const s of stones) tiers[s.tier]++;
  return { stones, work: { f, scales: sig.length, candidates: cand.length, big: bigs.length, tiers, ...(hints.length && { hints: hints.length }), ...(countRep && { countHints: countRep }) } };
}

// Tỉ lệ điểm trong mặt nạ trên đĩa (x, y, r) px ảnh.
function discIn(mask, W, H, x, y, r) {
  let n = 0, m = 0;
  for (let v = Math.floor(y - r); v <= Math.ceil(y + r); v++) for (let u = Math.floor(x - r); u <= Math.ceil(x + r); u++) {
    if (Math.hypot(u + 0.5 - x, v + 0.5 - y) > r) continue;
    n++; if (u >= 0 && v >= 0 && u < W && v < H && mask[v * W + u]) m++;
  }
  return n ? m / n : 0;
}
// Đặc trưng ảnh 1 hạt trên đĩa bán kính R (= 0.35 × đường kính, như bảng stones của kit/db): màu TB, độ lệch xám (std),
// bão hoà HSV TB (0–255), xám p98 (đốm sáng), L* của màu TB.
export function beadFeatures(img, x, y, R) {
  const d = img.data, gs = [], s = [0, 0, 0];
  let sat = 0;
  for (let v = Math.floor(y - R); v <= Math.ceil(y + R); v++) for (let u = Math.floor(x - R); u <= Math.ceil(x + R); u++) {
    if (u < 0 || v < 0 || u >= img.w || v >= img.h || Math.hypot(u + 0.5 - x, v + 0.5 - y) > Math.max(0.8, R)) continue;
    const j = (v * img.w + u) * 4, mx = Math.max(d[j], d[j + 1], d[j + 2]), mn = Math.min(d[j], d[j + 1], d[j + 2]);
    s[0] += d[j]; s[1] += d[j + 1]; s[2] += d[j + 2]; sat += mx ? (255 * (mx - mn)) / mx : 0; gs.push(0.299 * d[j] + 0.587 * d[j + 1] + 0.114 * d[j + 2]);
  }
  const n = gs.length || 1, mean = gs.reduce((a, v) => a + v, 0) / n, rgb = s.map((v) => v / n);
  gs.sort((a, b) => a - b);
  return { rgb: rgb.map(Math.round), std: r4(Math.sqrt(gs.reduce((a, v) => a + (v - mean) ** 2, 0) / n)), sat: Math.round(sat / n), peak: Math.round(q(gs, 0.98)), L: r4(lab(rgb)[0]) };
}
// Ngọc trai (docs/KIT-DATA.md §6, kit/db stones): trắng/kem (L* ≥ 62, bão hoà ≤ 100; ngọc thật TB 47–71) VÀ to (≥ 4.5 mm:
// ngọc 5–14 mm, còn trắng mịn 4 mm là Z94, 2.8 mm là L — độ mịn Z94 ≈ ngọc nên chỉ size phân biệt được).
export const isPearl = (dMeasMm, f) => dMeasMm >= 4.5 && f.L >= 62 && f.sat <= 100;
// Tầng theo cỡ VẬT LÝ đã chốt: 1 = ≥ 8 mm, 2 = 5–7 mm, 3 = 2.8–4 mm.
export const tierOfMm = (physMm) => (physMm >= 8 ? 1 : physMm >= 5 ? 2 : 3);
// Vật liệu (KIT-12a tầng, đếm cùng KIT-13): gold = họ vàng (L16/Z16/W16/D16, Q GOLD), pearl = series PEARL (ngọc trai, chỉ ≥ 5 mm),
// white = trắng đục 94 + pha lê 1 (L94/Z94/L1/Z1), color = còn lại. Luật trên màu đĩa (sampleColor, Lab) + bão hoà HSV TB của hạt,
// chỉnh trên vị trí thật của Snowman/Dachshund DB (đúng 93.8% / 86.3% hạt < 5 mm; pha lê trên nền vàng của Dachshund lẫn sang gold).
export const MATERIALS = ['gold', 'pearl', 'white', 'color'];
export function materialOf(img, x, y, rPx, kind, feat = beadFeatures(img, x, y, 0.7 * rPx)) {
  if (kind === 'pearl') return 'pearl';
  const [L, a, b] = lab(sampleColor(img, x, y, rPx)), C = Math.hypot(a, b), h = ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360;
  if ((L >= 55 && feat.sat < 130 && C < 42) || (C < 16 && L >= 60)) return 'white';
  return h >= 43 && h <= 92 && C >= 28 && L >= 20 ? 'gold' : 'color';
}
// countHints (KIT-13 VLM): [{ bbox?: [x0, y0, x1, y1] (px ảnh; mọi số ≤ 1 → tỉ lệ; thiếu = cả ảnh), counts: { gold, white, color, pearl? } }]
// = số hạt NHỎ (tầng 3) theo vật liệu trong crop. Hạt < 5 mm không có ngọc trai → 'pearl' cộng vào 'white' (hạt trắng mịn L94/Z94).
export function normCounts(list, img) {
  if (typeof list === 'string') list = list.trim() ? JSON.parse(list) : [];
  if (!Array.isArray(list)) return [];
  return list.map((h) => {
    if (!h || typeof h !== 'object' || !h.counts) return null;
    const box = h.bbox ? normBoxes([h.bbox], img)[0] : { x0: 0, y0: 0, x1: img.w, y1: img.h, bbox: [0, 0, img.w, img.h] };
    if (!box) return null;
    const c = {};
    for (const [m0, n] of Object.entries(h.counts)) {
      const m = { pearl: 'white', colour: 'color' }[m0] || m0;
      if (MATERIALS.includes(m) && Number.isFinite(+n) && +n >= 0) c[m] = (c[m] || 0) + Math.round(+n);
    }
    return Object.keys(c).length ? { x0: box.x0, y0: box.y0, x1: box.x1, y1: box.y1, bbox: box.bbox, counts: c } : null;
  }).filter(Boolean);
}
// Chỉnh tầng 3 theo countHints: thừa → đánh dấu removed các viên điểm thấp nhất; thiếu → thêm từ kho đốm yếu (điểm cao trước,
// đúng vật liệu, không chồng viên nào: elip viên to nới 0.4 r, đĩa overlap·(r1 + r2)). → [{ bbox, counts: { m: { hint, before, after } } }]
export function applyCounts(stones, counts, pool, toStone, f, kImg, overlap) {
  const out = [], hit = (s) => stones.some((t) => !t.removed && (t.big
    ? (() => { const dx = s.x - t.x, dy = s.y - t.y, th = (t.rotDeg * Math.PI) / 180, c = Math.cos(th), sn = Math.sin(th), u = dx * c + dy * sn, v = dy * c - dx * sn;
      return (u / ((t.axesMm[0] * kImg) / 2 + 0.4 * s.rPx)) ** 2 + (v / ((t.axesMm[1] * kImg) / 2 + 0.4 * s.rPx)) ** 2 <= 1; })()
    : Math.hypot(t.x - s.x, t.y - s.y) < overlap * (t.rPx + s.rPx)));
  const tried = new Map();
  for (const h of counts) {
    const inside = (x, y) => x >= h.x0 && x < h.x1 && y >= h.y0 && y < h.y1, rep = { bbox: h.bbox.map(r4), counts: {} };
    for (const [m, n] of Object.entries(h.counts)) {
      const cur = stones.filter((s) => !s.removed && s.tier === 3 && s.material === m && inside(s.x, s.y)), r = (rep.counts[m] = { hint: n, before: cur.length, after: cur.length });
      if (cur.length > n) { cur.sort((a, b) => a.score - b.score).slice(0, cur.length - n).forEach((s) => (s.removed = true)); r.after = n; continue; }
      for (const c of pool) {
        if (r.after >= n) break;
        if (c.used || !inside(c.x * f, c.y * f)) continue;
        if (!tried.has(c)) tried.set(c, toStone(c));
        const s = tried.get(c);
        if (!s || s.tier !== 3 || s.material !== m || !inside(s.x, s.y) || hit(s)) continue;
        c.used = true; stones.push({ ...s, fromHint: true }); r.after++;
      }
    }
    out.push(rep);
  }
  return out;
}

function nearestDist(pts) {
  const cell = 16, grid = new Map(), key = (x, y) => `${x},${y}`;
  pts.forEach((p, i) => { const kk = key(Math.floor(p.x / cell), Math.floor(p.y / cell)); (grid.get(kk) || grid.set(kk, []).get(kk)).push(i); });
  return pts.map((p, i) => {
    let d = Infinity;
    for (let reach = 1; reach < 64 && !(d <= (reach - 1) * cell); reach++) {
      const gx = Math.floor(p.x / cell), gy = Math.floor(p.y / cell);
      for (let dy = -reach; dy <= reach; dy++) for (let dx = -reach; dx <= reach; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== reach && reach > 1) continue;
        for (const j of grid.get(key(gx + dx, gy + dy)) || []) if (j !== i) d = Math.min(d, Math.hypot(pts[j].x - p.x, pts[j].y - p.y));
      }
      if (reach === 1) for (const j of grid.get(key(gx, gy)) || []) if (j !== i) d = Math.min(d, Math.hypot(pts[j].x - p.x, pts[j].y - p.y));
    }
    return d;
  });
}

// Mép hạt = vòng tối nơi hạt chạm khe/hạt bên (bóng tiếp xúc). M(c, ρ) = độ sáng trung bình trên đường tròn (c, ρ);
// leo toạ độ: bán kính = argmin M theo ρ, rồi tâm = argmin M theo c (ρ cố định). Độ tương phản = M(c, 0.5ρ) − M(c, ρ).
const NA = 32, COS = Float64Array.from({ length: NA }, (_, i) => Math.cos((2 * Math.PI * i) / NA)), SIN = Float64Array.from({ length: NA }, (_, i) => Math.sin((2 * Math.PI * i) / NA));
function ringMean(g, W, H, cx, cy, r, sd = 0) {
  let s = 0, s2 = 0, n = 0;
  for (let i = 0; i < NA; i++) {
    const x = cx + r * COS[i] - 0.5, y = cy + r * SIN[i] - 0.5, x0 = Math.floor(x), y0 = Math.floor(y);
    if (x0 < 0 || y0 < 0 || x0 >= W - 1 || y0 >= H - 1) continue;
    const tx = x - x0, ty = y - y0, j = y0 * W + x0;
    const v = (g[j] * (1 - tx) + g[j + 1] * tx) * (1 - ty) + (g[j + W] * (1 - tx) + g[j + W + 1] * tx) * ty;
    s += v; s2 += v * v; n++;
  }
  if (!n) return Infinity;
  return sd ? s / n + sd * Math.sqrt(Math.max(0, s2 / n - (s / n) ** 2)) : s / n;
}
// Bán kính: ρ = argmax C(c, ρ), C = trung bình 2 vòng trong (0.25ρ, 0.5ρ) − M(c, ρ) (đĩa sáng, vành tối của chính hạt).
const contrastAt = (g, W, H, cx, cy, t) => (ringMean(g, W, H, cx, cy, 0.25 * t) + ringMean(g, W, H, cx, cy, 0.5 * t)) / 2 - ringMean(g, W, H, cx, cy, t);
export function fitRadius(g, W, H, x, y, lo, hi) {
  let r = lo, e = -Infinity;
  for (let t = lo; t <= hi + 1e-9; t += Math.max(0.2, t / 25)) { const v = contrastAt(g, W, H, x, y, t); if (v > e) { e = v; r = t; } }
  return { r, contrast: e };
}
// Tâm: argmin (M + độ lệch chuẩn trên vòng)(·, r) quanh điểm DoG (vành tối tròn đều quanh tâm thật; đốm sáng lệch về phía ánh sáng), trôi ≤ 0.4r.
export function fitCenter(g, W, H, x, y, r) {
  let cx = x, cy = y, m = ringMean(g, W, H, x, y, r, 1);
  const st = Math.max(0.25, r / 16), lim = 0.4 * r;
  for (let it = 0; it < 6; it++) {
    let bx = cx, by = cy;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const nx = cx + dx * st, ny = cy + dy * st;
      if ((!dx && !dy) || Math.hypot(nx - x, ny - y) > lim) continue;
      const v = ringMean(g, W, H, nx, ny, r, 1); if (v < m - 1e-9) { m = v; bx = nx; by = ny; }
    }
    if (bx === cx && by === cy) break;
    cx = bx; cy = by;
  }
  return { x: cx, y: cy };
}

// Màu 1 viên: trung bình đĩa 0.55r, bỏ 20% sáng nhất / tối nhất (đốm sáng, khe).
export function sampleColor(img, x, y, r) {
  const R = Math.max(0.8, 0.55 * r), px = [];
  for (let v = Math.floor(y - R); v <= Math.ceil(y + R); v++) for (let u = Math.floor(x - R); u <= Math.ceil(x + R); u++) {
    if (u < 0 || v < 0 || u >= img.w || v >= img.h || Math.hypot(u + 0.5 - x, v + 0.5 - y) > R) continue;
    const j = (v * img.w + u) * 4, d = img.data;
    px.push([d[j], d[j + 1], d[j + 2], 0.299 * d[j] + 0.587 * d[j + 1] + 0.114 * d[j + 2]]);
  }
  if (!px.length) { const j = (clampI(Math.floor(y), 0, img.h - 1) * img.w + clampI(Math.floor(x), 0, img.w - 1)) * 4; return [img.data[j], img.data[j + 1], img.data[j + 2]]; }
  px.sort((a, b) => a[3] - b[3]);
  const a = Math.floor(px.length * 0.2), b = Math.max(a + 1, Math.ceil(px.length * 0.8)), s = [0, 0, 0];
  for (let i = a; i < b; i++) for (let c = 0; c < 3; c++) s[c] += px[i][c];
  return s.map((v) => v / (b - a));
}

// ── PLACE: stub lưới lục giác (tới khi KIT-2 merge place()). Viên phải nằm trọn trong mặt nạ. Toạ độ px bản đồ.
export function hexPlace(img, mask, params, frame) {
  const o = normParams(params), k = PX_PER_MM, p = (o.stoneMm + o.gapMm) * k, r = (o.stoneMm / 2) * k, dy = (p * Math.sqrt(3)) / 2;
  const { scale, ox, oy, widthPx, heightPx } = frame;
  const inside = (X, Y) => {
    const u = Math.floor((X - ox) / scale), v = Math.floor((Y - oy) / scale);
    return u >= 0 && v >= 0 && u < img.w && v < img.h && (!mask || mask[v * img.w + u]);
  };
  const stones = [];
  for (let j = 0, Y = r; Y <= heightPx - r; j++, Y = r + j * dy)
    for (let X = r + (j % 2 ? p / 2 : 0); X <= widthPx - r; X += p) {
      let ok = inside(X, Y);
      for (let t = 0; t < 8 && ok; t++) ok = inside(X + r * Math.cos((t * Math.PI) / 4), Y + r * Math.sin((t * Math.PI) / 4));
      if (ok) stones.push({ x: X, y: Y, dMm: o.stoneMm, rgb: sampleColor(img, (X - ox) / scale, (Y - oy) / scale, r / scale) });
    }
  return { stones, params: { pitchMm: r4(o.stoneMm + o.gapMm), grid: 'hex' }, stats: { engine: 'hex-stub' } };
}

// Adapter PLACE: mod = module lib/kit/place.js của KIT-2 nếu có (place(image, mask, params) → {stones, params, stats},
// hoặc placeStones(img, opts) → {map, colors, stats} như nhánh KIT-2 hiện tại); không có → hexPlace.
// Ra: { stones: [{x, y, dMm, rot?, rgb? | code/symbol}], palette?: [...], params, stats } toạ độ px bản đồ.
export async function runPlace(img, mask, params, frame, mod = null) {
  if (typeof mod?.place === 'function') {
    const r = await mod.place(img, mask, { ...params, frame: { x: frame.ox, y: frame.oy, scale: frame.scale } });
    // place() của KIT-2 trả màu đã lượng tử ở `colors` (cùng dạng placeStones), không phải `palette`.
    const pal = r.palette || (r.colors || []).map((c) => ({ code: c.code, symbol: c.symbol, rgb: c.fill, dMm: c.dMm }));
    return { stones: r.stones, palette: pal, params: r.params, stats: { engine: 'kit-2 place', ...r.stats } };
  }
  if (typeof mod?.placeStones === 'function') {
    const r = mod.placeStones(img, { mask, frame: { x: frame.ox, y: frame.oy, scale: frame.scale }, stoneMm: params.stoneMm, minMm: params.stoneMm + params.gapMm, maxColors: params.maxColors });
    const pal = (r.colors || []).map((c) => ({ code: c.code, symbol: c.symbol, rgb: c.fill, dMm: c.dMm }));
    return { stones: r.map.stones, palette: pal, params: { engine: 'placeStones' }, stats: { engine: 'kit-2 placeStones', ...r.stats } };
  }
  return hexPlace(img, mask, params, frame);
}

// ── màu → mã
function lab([r, g, b]) {
  const lin = (v) => { v /= 255; return v > 0.04045 ? ((v + 0.055) / 1.055) ** 2.4 : v / 12.92; };
  const R = lin(r), G = lin(g), B = lin(b);
  const X = (0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047, Y = 0.2126 * R + 0.7152 * G + 0.0722 * B, Z = (0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883;
  const h = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * h(Y) - 16, 500 * (h(X) - h(Y)), 200 * (h(Y) - h(Z))];
}
const d2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;

// k-means Lab có trọng số trên histogram (ô 3 đơn vị), khởi tạo tham lam (xa nhất × trọng số) — tất định.
export function quantize(colors, K) {
  const bins = new Map();
  colors.forEach((c, i) => {
    const L = lab(c), key = L.map((v) => Math.round(v / 3)).join(',');
    const b = bins.get(key) || bins.set(key, { s: [0, 0, 0], rgb: [0, 0, 0], w: 0 }).get(key);
    for (let t = 0; t < 3; t++) { b.s[t] += L[t]; b.rgb[t] += c[t]; } b.w++;
  });
  const pts = [...bins.values()].map((b) => ({ L: b.s.map((v) => v / b.w), w: b.w }));
  K = Math.min(K, pts.length);
  const C = [pts.reduce((a, p) => (p.w > a.w ? p : a), pts[0]).L], md = pts.map((p) => d2(p.L, C[0]));
  while (C.length < K) {
    let bi = 0, bv = -1;
    pts.forEach((p, i) => { const v = md[i] * Math.sqrt(p.w); if (v > bv) { bv = v; bi = i; } });
    C.push(pts[bi].L);
    pts.forEach((p, i) => { md[i] = Math.min(md[i], d2(p.L, pts[bi].L)); });
  }
  const near = (L) => { let b = 0, bv = Infinity; C.forEach((c, i) => { const v = d2(L, c); if (v < bv) { bv = v; b = i; } }); return b; };
  for (let it = 0; it < 20; it++) {
    const S = C.map(() => [0, 0, 0, 0]);
    for (const p of pts) { const s = S[near(p.L)]; for (let t = 0; t < 3; t++) s[t] += p.L[t] * p.w; s[3] += p.w; }
    S.forEach((s, i) => { if (s[3]) C[i] = [s[0] / s[3], s[1] / s[3], s[2] / s[3]]; });
  }
  const label = colors.map((c) => near(lab(c)));
  const rgb = C.map(() => [0, 0, 0, 0]);
  colors.forEach((c, i) => { const s = rgb[label[i]]; for (let t = 0; t < 3; t++) s[t] += c[t]; s[3]++; });
  return { label, rgb: rgb.map((s) => (s[3] ? s.slice(0, 3).map((v) => v / s[3]) : [0, 0, 0])), count: rgb.map((s) => s[3]) };
}

// Ký hiệu (docs/KIT-DATA.md §4): đá = CHỮ IN HOA (A…Z, rồi AA, AB…), ngọc trai = SỐ = cỡ vật lý.
const LETTERS = [...CHARS].filter((c) => c >= 'A' && c <= 'Z');
const symbolAt = (i) => (i < LETTERS.length ? LETTERS[i] : LETTERS[Math.floor(i / LETTERS.length - 1) % LETTERS.length] + LETTERS[i % LETTERS.length]);

// Viên có rgb → mã/ký hiệu. Đá: mã theo màu (C01 = cụm nhiều viên nhất), viên cỡ khác cỡ chính: C01@4.2.
// Ngọc trai (kind 'pearl'): mã = ký hiệu = cỡ vật lý ("6"), màu = TB các viên ngọc cỡ đó; không vào lượng tử màu.
export function assignCodes(stones, o) {
  const pearls = stones.filter((s) => s.kind === 'pearl'), rest = stones.filter((s) => s.kind !== 'pearl');
  const { label, rgb } = quantize(rest.map((s) => s.rgb), o.maxColors);
  const byKey = new Map();
  rest.forEach((s, i) => { const kk = `${label[i]}|${s.dMm}`; byKey.set(kk, (byKey.get(kk) || 0) + 1); });
  const cl = new Map();
  label.forEach((l) => cl.set(l, (cl.get(l) || 0) + 1));
  const order = [...cl.keys()].sort((a, b) => cl.get(b) - cl.get(a) || a - b), name = new Map(order.map((l, i) => [l, `C${String(i + 1).padStart(2, '0')}`]));
  const codes = [...byKey].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([kk], i) => {
    const [l, d] = kk.split('|'), dMm = +d;
    return { key: kk, code: name.get(+l) + (dMm === o.stoneMm ? '' : `@${dMm}`), symbol: symbolAt(i), rgb: toHex(rgb[+l]), dMm };
  });
  const byK = new Map(codes.map((c) => [c.key, c])), pc = new Map();
  for (const s of pearls) { const e = pc.get(s.physMm) || { n: 0, s: [0, 0, 0], dMm: s.dMm }; e.n++; s.rgb.forEach((v, t) => (e.s[t] += v)); pc.set(s.physMm, e); }
  const pearlCodes = [...pc].sort((a, b) => a[0] - b[0]).map(([mm, e]) => ({ code: String(mm), symbol: String(mm), rgb: toHex(e.s.map((v) => v / e.n)), dMm: e.dMm }));
  let ri = 0;
  return {
    palette: [...codes.map(({ key, ...c }) => c), ...pearlCodes],
    stones: stones.map((s) => {
      const c = s.kind === 'pearl' ? { code: String(s.physMm), symbol: String(s.physMm) } : byK.get(`${label[ri++]}|${s.dMm}`);
      return { ...s, code: c.code, symbol: c.symbol, ...(s.physMm && { group: `K_${c.code}_S${s.physMm}` }) };
    }),
  };
}

// Khoảng cách láng giềng gần nhất (mm): tâm-tâm và khe mép-mép. Láng giềng = khe mép-mép < touchMm;
// isolatedPct = % viên (có láng giềng) không có láng giềng nào cùng mã (viên lẻ màu).
export function neighborStats(stones, k = PX_PER_MM, touchMm = 1.5, minGap = 0) {
  const cell = 12 * k, grid = new Map(), key = (x, y) => `${x},${y}`;
  stones.forEach((s, i) => { const kk = key(Math.floor(s.x / cell), Math.floor(s.y / cell)); (grid.get(kk) || grid.set(kk, []).get(kk)).push(i); });
  const nn = [], gap = [];
  let overlaps = 0, isolated = 0, withNb = 0;
  stones.forEach((s, i) => {
    const gx = Math.floor(s.x / cell), gy = Math.floor(s.y / cell);
    let bd = Infinity, bg = Infinity, nb = 0, same = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) for (const j of grid.get(key(gx + dx, gy + dy)) || []) {
      if (j === i) continue;
      const t = stones[j], d = Math.hypot(t.x - s.x, t.y - s.y) / k;
      if (d < bd) bd = d;
      const gp = d - (s.dMm + t.dMm) / 2;
      if (gp < bg) bg = gp;
      if (gp < touchMm) { nb++; if (t.code === s.code) same++; }
    }
    if (Number.isFinite(bd)) { nn.push(bd); gap.push(bg); if (bg < -0.3) overlaps++; }
    if (nb) { withNb++; if (!same) isolated++; }
  });
  nn.sort((a, b) => a - b); gap.sort((a, b) => a - b);
  const pct = (a) => ({ p10: r4(q(a, 0.1)), median: r4(q(a, 0.5)), p90: r4(q(a, 0.9)) });
  // vi phạm theo cặp: chồng (khe < −0.05mm) / quá sát (khe < minGap − 0.1mm)
  let pairOverlap = 0, pairClose = 0;
  stones.forEach((s, i) => {
    const gx = Math.floor(s.x / cell), gy = Math.floor(s.y / cell);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) for (const j of grid.get(key(gx + dx, gy + dy)) || []) {
      if (j <= i) continue;
      const t = stones[j], gp = Math.hypot(t.x - s.x, t.y - s.y) / k - (s.dMm + t.dMm) / 2;
      if (gp < -0.05) pairOverlap++; else if (gp < minGap - 0.1) pairClose++;
    }
  });
  return { nnMm: pct(nn), gapMm: pct(gap), overlaps, violations: { overlap: pairOverlap, tooClose: pairClose, minGapMm: minGap },
    isolatedPct: withNb ? r4((100 * isolated) / withNb) : 0 };
}

// % diện tích mặt nạ (vùng cần phủ: alpha ≥ 128, không alpha = cả ảnh) không có đá: ô 0.5mm cách mép viên gần nhất > gapMm.
export function emptyAreaPct(stones, mask, img, fr, gapMm, cellMm = 0.5) {
  const c = cellMm * PX_PER_MM, GW = Math.ceil(fr.widthPx / c), GH = Math.ceil(fr.heightPx / c), cov = new Uint8Array(GW * GH);
  for (const s of stones) {
    const R = (s.dMm / 2 + gapMm) * PX_PER_MM;
    for (let v = Math.max(0, Math.floor((s.y - R) / c)); v <= Math.min(GH - 1, Math.floor((s.y + R) / c)); v++)
      for (let u = Math.max(0, Math.floor((s.x - R) / c)); u <= Math.min(GW - 1, Math.floor((s.x + R) / c)); u++)
        if (Math.hypot((u + 0.5) * c - s.x, (v + 0.5) * c - s.y) <= R) cov[v * GW + u] = 1;
  }
  let area = 0, empty = 0;
  for (let v = 0; v < GH; v++) for (let u = 0; u < GW; u++) {
    const ix = Math.floor(((u + 0.5) * c - fr.ox) / fr.scale), iy = Math.floor(((v + 0.5) * c - fr.oy) / fr.scale);
    if (ix < 0 || iy < 0 || ix >= img.w || iy >= img.h || (mask && !mask[iy * img.w + ix])) continue;
    area++; if (!cov[v * GW + u]) empty++;
  }
  return area ? r4((100 * empty) / area) : 0;
}

// CIEDE2000 (Sharma, Wu, Dalal 2005).
export function de2000([L1, a1, b1], [L2, a2, b2]) {
  const rad = Math.PI / 180, C1 = Math.hypot(a1, b1), C2 = Math.hypot(a2, b2), Cb = (C1 + C2) / 2, G = 0.5 * (1 - Math.sqrt(Cb ** 7 / (Cb ** 7 + 25 ** 7)));
  const A1 = (1 + G) * a1, A2 = (1 + G) * a2, c1 = Math.hypot(A1, b1), c2 = Math.hypot(A2, b2);
  const h = (b, a) => { if (!a && !b) return 0; const t = Math.atan2(b, a) / rad; return t < 0 ? t + 360 : t; };
  const h1 = h(b1, A1), h2 = h(b2, A2), dL = L2 - L1, dC = c2 - c1;
  let dh = 0;
  if (c1 * c2) dh = Math.abs(h2 - h1) <= 180 ? h2 - h1 : h2 - h1 > 180 ? h2 - h1 - 360 : h2 - h1 + 360;
  const dH = 2 * Math.sqrt(c1 * c2) * Math.sin((dh / 2) * rad), Lb = (L1 + L2) / 2, cb = (c1 + c2) / 2;
  let hb = h1 + h2;
  if (c1 * c2) hb = Math.abs(h1 - h2) <= 180 ? (h1 + h2) / 2 : h1 + h2 < 360 ? (h1 + h2 + 360) / 2 : (h1 + h2 - 360) / 2;
  const T = 1 - 0.17 * Math.cos((hb - 30) * rad) + 0.24 * Math.cos(2 * hb * rad) + 0.32 * Math.cos((3 * hb + 6) * rad) - 0.2 * Math.cos((4 * hb - 63) * rad);
  const SL = 1 + (0.015 * (Lb - 50) ** 2) / Math.sqrt(20 + (Lb - 50) ** 2), SC = 1 + 0.045 * cb, SH = 1 + 0.015 * cb * T;
  const RT = -2 * Math.sqrt(cb ** 7 / (cb ** 7 + 25 ** 7)) * Math.sin(60 * Math.exp(-(((hb - 275) / 25) ** 2)) * rad);
  return Math.sqrt((dL / SL) ** 2 + (dC / SC) ** 2 + (dH / SH) ** 2 + RT * (dC / SC) * (dH / SH));
}

// Tự kiểm: render bản đồ (PLACE: phẳng — mỗi điểm vùng đá = màu mã của viên gần nhất, KIT-1 stoneField; DETECT: hạt ngọc
// có khối + khe tối, KIT-1 renderMap 'clean', vì ảnh vào là ảnh hạt) trên nền trắng vs ảnh vào đặt theo khung; cả 2 làm mờ σ = 1 bước đá.
//  ΔE00 trung bình + SSIM (độ sáng, cửa sổ Gauss σ = 1 bước) trong mặt nạ; mật độ phủ = Σ diện tích viên / diện tích mặt nạ,
//  so với lục giác lý thuyết của đá chính + khe: π·d² / (2√3·(d + khe)²).
// SSIM độ sáng, cửa sổ Gauss σ = w, trung bình trong mặt nạ M (null = cả ảnh).
function ssimL(X, Y, W, H, w, M) {
  const N = W * H, g = (a) => gauss(a, W, H, w), mx = g(X), my = g(Y), xx = new Float32Array(N), yy = new Float32Array(N), xy = new Float32Array(N);
  for (let j = 0; j < N; j++) { xx[j] = X[j] * X[j]; yy[j] = Y[j] * Y[j]; xy[j] = X[j] * Y[j]; }
  const sxx = g(xx), syy = g(yy), sxy = g(xy), C1 = (0.01 * 255) ** 2, C2 = (0.03 * 255) ** 2;
  let ss = 0, n = 0;
  for (let j = 0; j < N; j++) if (!M || M[j]) {
    const vx = sxx[j] - mx[j] ** 2, vy = syy[j] - my[j] ** 2, cv = sxy[j] - mx[j] * my[j];
    ss += ((2 * mx[j] * my[j] + C1) * (2 * cv + C2)) / ((mx[j] ** 2 + my[j] ** 2 + C1) * (vx + vy + C2)); n++;
  }
  return n ? ss / n : 0;
}

export function selfCheck(stones, palette, img, mask, fr, o, maxPx = 700) {
  const sc = Math.min(1, maxPx / Math.max(fr.widthPx, fr.heightPx)), W = Math.round(fr.widthPx * sc), H = Math.round(fr.heightPx * sc), N = W * H;
  const fill = new Map(palette.map((p) => [p.code, hex(p.rgb)])), col = stones.map((s) => fill.get(s.code));
  const map = { px: Math.round(Math.max(W, H) / sc), stones }, shaded = o.mode === 'detect'; // ảnh vuông cạnh max(W,H)
  const ren = !stones.length ? null : shaded
    ? renderMap(map, { codes: Object.fromEntries(palette.map((p) => [p.code, { fill: p.rgb, edge: p.rgb }])) }, { style: 'clean', scale: sc })
    : stoneField(map, { scale: sc });
  const RW = ren ? ren.W ?? ren.w : 0, RH = ren ? ren.H ?? ren.h : 0;
  const inp = [new Float32Array(N), new Float32Array(N), new Float32Array(N)], out = [new Float32Array(N), new Float32Array(N), new Float32Array(N)], M = new Uint8Array(N);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const j = y * W + x, ix = Math.floor(((x + 0.5) / sc - fr.ox) / fr.scale), iy = Math.floor(((y + 0.5) / sc - fr.oy) / fr.scale);
    const inImg = ix >= 0 && iy >= 0 && ix < img.w && iy < img.h, q = inImg ? (iy * img.w + ix) * 4 : -1, a = inImg ? img.data[q + 3] / 255 : 0;
    M[j] = inImg && (!mask || mask[iy * img.w + ix]) ? 1 : 0;
    const r = ren && x < RW && y < RH ? y * RW + x : -1;
    for (let c = 0; c < 3; c++) {
      inp[c][j] = inImg ? img.data[q + c] * a + 255 * (1 - a) : 255;
      if (shaded) { const ra = r >= 0 ? ren.data[r * 4 + 3] / 255 : 0; out[c][j] = r >= 0 ? ren.data[r * 4 + c] * ra + 255 * (1 - ra) : 255; }
      else { const ow = r >= 0 ? ren.owner[r] : -1, ra = ow >= 0 ? ren.alpha[r] : 0; out[c][j] = ow >= 0 ? col[ow][c] * ra + 255 * (1 - ra) : 255; }
    }
  }
  const sig = (o.stoneMm + o.gapMm) * PX_PER_MM * sc, A = inp.map((ch) => gauss(ch, W, H, sig)), B = out.map((ch) => gauss(ch, W, H, sig));
  let de = 0, n = 0;
  for (let j = 0; j < N; j++) if (M[j]) { de += de2000(lab([A[0][j], A[1][j], A[2][j]]), lab([B[0][j], B[1][j], B[2][j]])); n++; }
  const lum = (C) => { const L = new Float32Array(N); for (let j = 0; j < N; j++) L[j] = 0.299 * C[0][j] + 0.587 * C[1][j] + 0.114 * C[2][j]; return L; };
  const ss = ssimL(lum(A), lum(B), W, H, Math.max(1.5, sig), M) * n;
  const areaMm2 = n / (sc * PX_PER_MM) ** 2, stoneMm2 = stones.reduce((a, s) => a + Math.PI * (s.dMm / 2) ** 2, 0);
  const hexCov = (Math.PI * o.stoneMm ** 2) / (2 * Math.sqrt(3) * (o.stoneMm + o.gapMm) ** 2), cov = areaMm2 ? stoneMm2 / areaMm2 : 0;
  return { check: { deltaE00: n ? r4(de / n) : null, ssim: n ? r4(ss / n) : null, blurMm: r4(o.stoneMm + o.gapMm), render: shaded ? 'clean' : 'flat', workPx: [W, H] },
    density: { coverage: r4(cov), hexCoverage: r4(hexCov), ratio: hexCov ? r4(cov / hexCov) : 0, areaMm2: Math.round(areaMm2) } };
}

function hist(values, step) {
  const m = {};
  for (const v of values) { const b = r4(Math.floor(v / step) * step); m[b] = (m[b] || 0) + 1; }
  return Object.entries(m).map(([b, n]) => [+b, n]).sort((a, b) => a[0] - b[0]);
}

// Khung: ảnh → canvas (contain, giữa). widthPx/heightPx = px bản đồ (11.81 px/mm).
export function frameOf(img, o) {
  const hMm = o.canvasHmm || r4((o.canvasWmm * img.h) / img.w), widthPx = Math.round(o.canvasWmm * PX_PER_MM), heightPx = Math.round(hMm * PX_PER_MM);
  const scale = Math.min(widthPx / img.w, heightPx / img.h);
  return { widthMm: o.canvasWmm, heightMm: hMm, widthPx, heightPx, scale, ox: (widthPx - img.w * scale) / 2, oy: (heightPx - img.h * scale) / 2 };
}

// Ảnh → doc (dạng chuẩn svgio). opts: { source: {name, bytes}, placeMod, now }
export async function buildKit(img, params, opts = {}) {
  const { regionMask: rm, ...o } = normParams(params), t0 = Date.now(), fr = frameOf(img, o);
  const bgm = backgroundMask(img), mask = withRegion(img, regionMask(img, o, bgm), rm); // params.regionMask: vùng đá của KIT-10 (lib/kit/vlm.js)
  let raw, extra = { background: { checker: bgm.checker, pct: bgm.pct } }, prePalette = null;
  if (o.mode === 'detect') {
    // kImg của detect theo bề rộng canvas; canvas cao khác tỉ lệ → dùng scale của khung
    const det = detectBeads(img, { ...o, canvasWmm: (img.w * fr.scale) / PX_PER_MM }, mask);
    raw = det.stones.map((s) => ({ x: fr.ox + s.x * fr.scale, y: fr.oy + s.y * fr.scale, dMm: s.dMm, physMm: s.physMm, kind: s.kind, dMeasMm: s.dMeasMm, rgb: sampleColor(img, s.x, s.y, s.rPx) }));
    const pearls = raw.filter((s) => s.kind === 'pearl'), big = det.stones.filter((s) => s.big);
    Object.assign(extra, { work: det.work, measuredMm: hist(raw.map((s) => s.dMeasMm), 0.2),
      big: { count: big.length, sizes: hist(big.map((s) => s.physMm), 1), flagged: big.filter((s) => s.flags.length).map((s) => ({ x: r4(fr.ox + s.x * fr.scale), y: r4(fr.oy + s.y * fr.scale), kind: s.kind, physMm: s.physMm, axesMm: s.axesMm, flags: s.flags })) },
      tiers: Object.fromEntries([1, 2, 3].map((t) => [t, Object.fromEntries(MATERIALS.map((m) => [m, det.stones.filter((s) => s.tier === t && s.material === m).length]).filter(([, n]) => n))])),
      pearls: { count: pearls.length, sizes: Object.fromEntries(PEARL_MM.map((mm) => [mm, pearls.filter((s) => s.physMm === mm).length]).filter(([, n]) => n)) } });
  } else {
    const pl = await runPlace(img, mask, o, fr, opts.placeMod);
    raw = pl.stones; prePalette = pl.palette; extra.place = { params: pl.params, ...pl.stats };
  }
  let stones, palette;
  if (prePalette?.length && raw.every((s) => s.code)) { stones = raw; palette = prePalette; } else ({ stones, palette } = assignCodes(raw, o));
  const pitch = o.stoneMm + o.gapMm;
  stones = [...stones].sort((a, b) => Math.round(a.y / (pitch * PX_PER_MM)) - Math.round(b.y / (pitch * PX_PER_MM)) || a.x - b.x)
    .map((s, i) => ({ id: `P${String(i + 1).padStart(5, '0')}`, symbol: s.symbol, code: s.code, x: r4(s.x), y: r4(s.y), dMm: s.dMm, rot: s.rot || 0,
      group: s.group || `K_${s.code}_${sizeGroup(s.dMm)}`, layer: `S${s.dMm}` }));
  const sizes = [...new Set(stones.map((s) => s.dMm))].sort((a, b) => a - b);
  const layers = sizes.map((d) => ({ id: `S${d}`, name: `Đá ${d}mm` }));
  const sizeCount = Object.fromEntries(sizes.map((d) => [d, stones.filter((s) => s.dMm === d).length]));
  const src = opts.source || {};
  const doc = {
    schema: SCHEMA,
    canvas: { widthMm: fr.widthMm, heightMm: fr.heightMm, pxPerMm: PX_PER_MM, widthPx: fr.widthPx, heightPx: fr.heightPx },
    params: { mode: o.mode, canvasWmm: o.canvasWmm, canvasHmm: fr.heightMm, stoneMm: o.stoneMm, gapMm: o.gapMm, accentMm: o.accentMm, maxColors: o.maxColors, dropBg: o.dropBg,
      ...(o.mode === 'detect' && { sensitivity: o.sensitivity, overlap: o.overlap }) },
    source: { name: src.name || null, sha1: src.bytes ? crypto.createHash('sha1').update(src.bytes).digest('hex') : null, widthPx: img.w, heightPx: img.h,
      frame: { scale: r4(fr.scale), x: r4(fr.ox), y: r4(fr.oy) } },
    createdAt: (opts.now || new Date()).toISOString(),
    palette, layers, stones,
  };
  doc.stats = { stones: stones.length, sizes: sizeCount, codes: palette.length, colors: new Set(palette.map((p) => p.rgb)).size, ...neighborStats(stones, PX_PER_MM, 1.5, o.gapMm), emptyPct: emptyAreaPct(stones, mask, img, fr, o.gapMm),
    ...selfCheck(stones, palette, img, mask, fr, o), ...extra, ms: Date.now() - t0 };
  return normalizeDoc(doc);
}

// Nút "tự ước lượng": thử 1 thang bước P (ảnh thu về ≤ 700px): dò hạt 1 cỡ (đá 0.85P, khe 0.15P), vẽ lại
// từng hạt bằng màu của nó (renderMap 'clean') và chấm SSIM độ sáng với ảnh vào ở độ phân giải gốc — bước đúng
// tái tạo cấu trúc hạt tốt (bước nhỏ bắt đốm sáng / bước lớn gộp hạt). Ảnh thật thì SSIM cứ tăng khi P giảm
// (nhiều đá nhỏ = gần ảnh hơn), nên chọn P LỚN NHẤT có SSIM ≥ max − 25%·(max − min). Ở bước thắng: bước = phân vị 75% khoảng
// cách tâm láng giềng gần nhất (trung vị bị hạt dò trùng / sai kéo xuống ~10%), cỡ hạt = trung vị đường kính đo (vật lý) → đá chính + khe.
export function estimateParams(img, params = {}) {
  const o = normParams(params), fr = frameOf(img, o), kImg = PX_PER_MM / fr.scale; // px ảnh / mm
  const fd = Math.max(1, Math.ceil(Math.max(img.w, img.h) / 700)), sm = shrink(img, fd), mask = regionMask(sm, o), N = sm.w * sm.h;
  const L = new Float32Array(N);
  for (let j = 0; j < N; j++) { const a = sm.data[j * 4 + 3] / 255; L[j] = (0.299 * sm.data[j * 4] + 0.587 * sm.data[j * 4 + 1] + 0.114 * sm.data[j * 4 + 2]) * a + 255 * (1 - a); }
  const tryP = (P) => {
    const det = detectBeads(sm, { ...o, canvasWmm: sm.w, stoneMm: 0.85 * P, gapMm: 0.15 * P, accentMm: [], raw: true }, mask); // 1 px = 1 "mm"
    if (det.stones.length < 20) return { P, det, ssim: -1 };
    const codes = {}, stones = det.stones.map((s, i) => { const c = sampleColor(sm, s.x, s.y, s.rPx); codes[i] = { fill: c, edge: c }; return { x: s.x, y: s.y, dMm: (2 * s.rPx) / PX_PER_MM, code: i }; });
    const ren = renderMap({ px: Math.max(sm.w, sm.h), stones }, { codes }, { style: 'clean', scale: 1 }), B = new Float32Array(N);
    for (let y = 0; y < sm.h; y++) for (let x = 0; x < sm.w; x++) {
      const r = (y * ren.w + x) * 4, a = ren.data[r + 3] / 255;
      B[y * sm.w + x] = (0.299 * ren.data[r] + 0.587 * ren.data[r + 1] + 0.114 * ren.data[r + 2]) * a + 255 * (1 - a);
    }
    return { P, det, ssim: ssimL(L, B, sm.w, sm.h, 1.5, mask) };
  };
  const tried = [];
  for (let P = 5; P <= Math.min(60, Math.min(sm.w, sm.h) / 12); P *= 1.2) tried.push(tryP(P));
  const ok = tried.filter((t) => t.ssim >= 0);
  if (!ok.length) throw new Error('không thấy hạt rõ ở cỡ nào — ảnh mượt thì dùng PLACE');
  const hi = Math.max(...ok.map((t) => t.ssim)), lo = Math.min(...ok.map((t) => t.ssim));
  const best = ok.filter((t) => t.ssim >= hi - 0.25 * (hi - lo)).reduce((a, t) => (t.P > a.P ? t : a));
  const nn = nearestDist(best.det.stones).filter(Number.isFinite).sort((a, b) => a - b), ds = best.det.stones.map((s) => 2 * s.rPx).sort((a, b) => a - b);
  const pMm = (q(nn, 0.75) * fd) / kImg, dMeas = (q(ds, 0.5) * fd) / kImg;
  // hạt trong ảnh = cỡ vật lý → cỡ đá gần nhất (vật lý) → ô "Đá chính" nhận reference; khe = bước − reference (bước lưới = đá + khe)
  const phys = SIZES.map(physOf).reduce((a, s) => (Math.abs(s - dMeas) < Math.abs(a - dMeas) ? s : a)), stoneMm = refOf(phys);
  return {
    pitchPx: r4(q(nn, 0.75) * fd), pitchMm: r4(pMm), beadMm: r4(dMeas), beads: best.det.stones.length, ssim: r4(best.ssim), imagePxPerMm: r4(kImg),
    physMm: phys, stoneMm, gapMm: Math.max(0, Math.round((pMm - stoneMm) * 10) / 10),
    tried: tried.map((t) => [r4(t.P * fd), r4(t.ssim)]),
  };
}
