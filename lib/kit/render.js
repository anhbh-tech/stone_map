// Render bản đồ đá (JSON của lib/kit/svg.js) → RGBA, không cần thư viện ngoài.
//  style 'clean'   : kiểu file _3 — hạt ngọc tròn có khối (ánh sáng từ trên-trái, đốm sáng, mép tối), khe giữa các hạt
//                    tô bóng màu của hạt gần nhất; ngoài vùng đá (stoneField) alpha = 0.
//  style 'symbols' : kiểu file _1 — bản 'clean' + đúng hình SVG mẫu: đĩa viền (màu edge) + đĩa trong 0.87r (màu fill)
//                    + ký hiệu Arial Bold (palette: fontPx, màu chữ; x = tâm − advance/2, baseline = tâm + 0.36·fontPx).
import { PX_PER_MM } from './svg.js';
import { loadGlyphs, advancePx } from './glyphs.js';
import { isShaped, stonePoly, sdPoly } from './shapes.js';

export const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const clamp8 = (v) => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));
const LIGHT = (() => { const l = [-0.42, -0.62, 1], n = Math.hypot(...l); return l.map((v) => v / n); })();
const HALF = (() => { const h = [LIGHT[0], LIGHT[1], LIGHT[2] + 1], n = Math.hypot(...h); return h.map((v) => v / n); })();

// Màu một điểm trên hạt ngọc: (nx, ny) = vị trí so với tâm theo bán kính (|n| ≤ 1).
export function pearlShade(fill, nx, ny) {
  const rr = Math.min(1, nx * nx + ny * ny), nz = Math.sqrt(1 - rr), rho = Math.sqrt(rr);
  const diff = Math.max(0, nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2]), h = Math.max(0, nx * HALF[0] + ny * HALF[1] + nz * HALF[2]);
  const spec = h ** 90 * 0.75 + h ** 10 * 0.18;
  const rim = rho < 0.86 ? 0 : ((rho - 0.86) / 0.14) ** 1.5 * 0.55;
  return [0, 1, 2].map((c) => {
    let v = fill[c] * (0.52 + 0.55 * diff);
    v += (255 - v) * spec;
    return v * (1 - rim);
  });
}

// Khoảng cách Euclid (bình phương) tới điểm hạt giống gần nhất — Felzenszwalb & Huttenlocher, 2 lượt 1D.
export function edt2(seed, W, H) {
  const INF = 1e20, f = new Float64Array(Math.max(W, H)), d = new Float64Array(Math.max(W, H));
  const v = new Int32Array(Math.max(W, H)), z = new Float64Array(Math.max(W, H) + 1), out = new Float32Array(W * H);
  const pass = (n) => {
    let k = 0; v[0] = 0; z[0] = -INF; z[1] = INF;
    for (let q = 1; q < n; q++) {
      let s;
      while ((s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k])) <= z[k]) k--;
      k++; v[k] = q; z[k] = s; z[k + 1] = INF;
    }
    k = 0;
    for (let q = 0; q < n; q++) { while (z[k + 1] < q) k++; d[q] = (q - v[k]) ** 2 + f[v[k]]; }
  };
  for (let x = 0; x < W; x++) { for (let y = 0; y < H; y++) f[y] = seed[y * W + x] ? 0 : INF; pass(H); for (let y = 0; y < H; y++) out[y * W + x] = d[y]; }
  for (let y = 0; y < H; y++) { for (let x = 0; x < W; x++) f[x] = out[y * W + x]; pass(W); for (let x = 0; x < W; x++) out[y * W + x] = d[x]; }
  return out;
}

// Vùng đá + chủ của từng điểm: owner = viên có mép gần nhất (power-Voronoi theo d − r), key = d − r.
// Vùng = (đĩa nới marginMm) ∪ closing(đĩa, closeMm) — lấp lỗ giữa các viên thưa mà không nới viền ngoài.
// alpha 0..1 (khử răng cưa ở viền ngoài).
export function stoneField(map, { scale = 1, marginMm = 0.8, closeMm = 3 } = {}) {
  const W = Math.round(map.px * scale), H = W, N = W * H, k = PX_PER_MM * scale;
  const best = new Float32Array(N).fill(Infinity), owner = new Int32Array(N).fill(-1);
  const close = closeMm * k, margin = marginMm * k;
  map.stones.forEach((s, i) => {
    const cx = s.x * scale, cy = s.y * scale, shp = isShaped(s), r = ((shp ? Math.max(s.wMm, s.hMm) : s.dMm) * k) / 2, R = r + close + 1;
    const poly = shp ? stonePoly({ ...s, x: cx, y: cy }, k) : null;
    const x0 = Math.max(0, Math.floor(cx - R)), x1 = Math.min(W - 1, Math.ceil(cx + R)), y0 = Math.max(0, Math.floor(cy - R)), y1 = Math.min(H - 1, Math.ceil(cy + R));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const key = poly ? sdPoly(poly, x + 0.5, y + 0.5) : Math.hypot(x + 0.5 - cx, y + 0.5 - cy) - r, j = y * W + x;
      if (key < best[j] && key <= close) { best[j] = key; owner[j] = i; }
    }
  });
  const outside = new Uint8Array(N);
  for (let j = 0; j < N; j++) outside[j] = owner[j] < 0 ? 1 : 0;
  const dOut = edt2(outside, W, H), alpha = new Float32Array(N);
  for (let j = 0; j < N; j++) {
    if (owner[j] < 0) continue;
    const a1 = margin + 0.5 - best[j], a2 = Math.sqrt(dOut[j]) - close + 0.5;
    alpha[j] = Math.min(1, Math.max(0, a1, a2));
  }
  return { W, H, owner, best, alpha };
}

// opts: style, scale (ảnh ra = round(px·scale)), marginMm/closeMm (xem stoneField).
export function renderMap(map, palette, { style = 'clean', scale = 1, ...field } = {}) {
  const k = PX_PER_MM * scale;
  const st = map.stones.map((s) => {
    const p = palette.codes[s.code];
    if (!p) throw new Error(`palette thiếu mã ${s.code}`);
    const o = { cx: s.x * scale, cy: s.y * scale, r: (s.dMm * k) / 2, fill: hex(p.fill), edge: hex(p.edge), p, s };
    if (isShaped(s)) { const t = ((s.rot || 0) * Math.PI) / 180; Object.assign(o, { shp: true, c: Math.cos(t), sn: Math.sin(t), ax: (s.wMm * k) / 2, ay: (s.hMm * k) / 2, k }); }
    return o;
  });
  const { W, H, owner, best, alpha } = stoneField(map, { scale, ...field });
  const data = new Uint8Array(W * H * 4);
  for (let j = 0; j < W * H; j++) {
    const i = owner[j];
    if (i < 0 || alpha[j] <= 0) continue;
    const o = st[i], key = best[j], x = j % W, y = (j - x) / W;
    const cov = Math.min(1, Math.max(0, 0.5 - key));
    // khe: màu nền in của hạt gần nhất (tối hơn), sát mép hạt có bóng tiếp xúc.
    const g = 0.74 - 0.32 * Math.exp(-Math.max(0, key) / (0.25 * k)), grout = o.fill.map((v) => v * g);
    // viên có hình: toạ độ cục bộ chuẩn hoá theo trục (bóng như hạt, kéo theo hình)
    const dx = x + 0.5 - o.cx, dy = y + 0.5 - o.cy;
    const bead = cov > 0 ? (o.shp ? pearlShade(o.fill, Math.max(-1, Math.min(1, (dx * o.c + dy * o.sn) / o.ax)), Math.max(-1, Math.min(1, (dy * o.c - dx * o.sn) / o.ay))) : pearlShade(o.fill, dx / o.r, dy / o.r)) : grout;
    for (let c = 0; c < 3; c++) data[j * 4 + c] = clamp8(grout[c] + (bead[c] - grout[c]) * cov);
    data[j * 4 + 3] = clamp8(alpha[j] * 255);
  }
  const img = { w: W, h: H, data };
  if (style === 'symbols') { const g = loadGlyphs(); for (const o of st) drawSymbol(img, o, g, scale); }
  return img;
}

// Trộn màu c với độ phủ a (0..1) lên điểm j (alpha-over).
function blend(d, j, c, a) {
  if (a <= 0) return;
  const da = d[j + 3] / 255, oa = a + da * (1 - a);
  for (let q = 0; q < 3; q++) d[j + q] = clamp8((c[q] * a + d[j + q] * da * (1 - a)) / oa);
  d[j + 3] = clamp8(oa * 255);
}

function disc(img, cx, cy, r, c) {
  const x0 = Math.max(0, Math.floor(cx - r - 1)), x1 = Math.min(img.w - 1, Math.ceil(cx + r + 1));
  const y0 = Math.max(0, Math.floor(cy - r - 1)), y1 = Math.min(img.h - 1, Math.ceil(cy + r + 1));
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const cov = Math.min(1, Math.max(0, r + 0.5 - Math.hypot(x + 0.5 - cx, y + 0.5 - cy)));
    blend(img.data, (y * img.w + x) * 4, c, cov);
  }
}

// đa giác tô theo độ phủ từ khoảng cách có dấu (khử răng cưa 1 px)
function polyFill(img, poly, c) {
  const xs = poly.map((p) => p[0]), ys = poly.map((p) => p[1]);
  for (let y = Math.max(0, Math.floor(Math.min(...ys) - 1)); y <= Math.min(img.h - 1, Math.ceil(Math.max(...ys) + 1)); y++)
    for (let x = Math.max(0, Math.floor(Math.min(...xs) - 1)); x <= Math.min(img.w - 1, Math.ceil(Math.max(...xs) + 1)); x++) {
      const cov = Math.min(1, Math.max(0, 0.5 - sdPoly(poly, x + 0.5, y + 0.5)));
      if (cov > 0) blend(img.data, (y * img.w + x) * 4, c, cov);
    }
}

function drawSymbol(img, o, G, scale) {
  if (o.shp) {
    polyFill(img, stonePoly({ ...o.s, x: o.cx, y: o.cy }, o.k), o.edge);
    polyFill(img, stonePoly({ ...o.s, x: o.cx, y: o.cy }, o.k * 0.87), o.fill);
  } else {
    disc(img, o.cx, o.cy, o.r, o.edge);
    disc(img, o.cx, o.cy, o.r * 0.87, o.fill);
  }
  // ký hiệu nhiều chữ (ngọc 10/11/12/14 mm = "10"…): đặt từng glyph theo advance, cả chuỗi canh giữa (như <text> svgio)
  const sym = String(o.s.symbol), fs = o.p.fontPx * scale, k = fs / G.em, col = hex(o.p.text);
  let ox = o.cx - ([...sym].reduce((a, ch) => a + advancePx(ch, o.p.fontPx), 0) * scale) / 2;
  const oy = o.cy + G.baseline * fs;
  for (const ch of sym) {
    const g = G.glyphs[ch];
    if (!g) throw new Error(`thiếu glyph ${ch}`);
    const gx0 = ox + g.x * k, gy0 = oy + g.y * k, n = Math.max(2, Math.ceil(1 / k));
    for (let y = Math.max(0, Math.floor(gy0)); y < Math.min(img.h, Math.ceil(gy0 + g.h * k)); y++)
      for (let x = Math.max(0, Math.floor(gx0)); x < Math.min(img.w, Math.ceil(gx0 + g.w * k)); x++) {
        let sum = 0;
        for (let sy = 0; sy < n; sy++) for (let sx = 0; sx < n; sx++) {
          const u = Math.floor((x + (sx + 0.5) / n - gx0) / k), v = Math.floor((y + (sy + 0.5) / n - gy0) / k);
          if (u >= 0 && v >= 0 && u < g.w && v < g.h) sum += g.a[v * g.w + u];
        }
        blend(img.data, (y * img.w + x) * 4, col, sum / (n * n * 255));
      }
    ox += advancePx(ch, o.p.fontPx) * scale;
  }
}

// Ghép top lên base (cùng cỡ, alpha-over) → ảnh mới.
export function over(base, top) {
  const data = new Uint8Array(base.data);
  for (let j = 0; j < data.length; j += 4) blend(data, j, top.data.subarray(j, j + 3), top.data[j + 3] / 255);
  return { w: base.w, h: base.h, data };
}
