// Mockup 3D tĩnh của 1 design: đá ở cỡ VẬT LÝ, màu catalog, bóng đổ, trên ảnh in sạch.
//   renderMockup(design, cat, { print, pxPerMm = 8, light, shadow }) → { w, h, data RGBA }
//   print = { w, h, data RGBA } (ảnh in, phóng về cỡ ra bằng song tuyến); thiếu → nền xám nhạt.
//   Normal map theo shape:
//     tròn  = đá mài giác: mặt bàn phẳng (ρ < 0.42) + 2 vòng 8 giác (vòng ngoài lệch nửa giác, dốc hơn);
//     ngọc trai = cầu trơn, bóng mềm + ánh xà cừ nhẹ ở viền;
//     marquise / tim / giọt (+ sao / hoa / hồng theo đa giác) = mặt bàn + vát theo trường khoảng cách tới viền, lượng tử 8 hướng ra giác.
//   Ánh sáng: 1 đèn trên-trái (L), Blinn-Phong; bóng đổ = viền viên dời (dx, dy) mm, mềm theo khoảng cách, nhân vào ảnh in.
import { outline as geomOutline } from './geom.js';

const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
const norm = (x, y, z) => { const l = Math.hypot(x, y, z) || 1; return [x / l, y / l, z / l]; };
const hex = (h) => [1, 3, 5].map((i) => parseInt((h || '#BBBBBB').slice(i, i + 2), 16) / 255);

function resample(img, W, H) {
  const out = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    const fy = ((y + 0.5) * img.h) / H - 0.5, y0 = clamp(Math.floor(fy), 0, img.h - 1), y1 = Math.min(img.h - 1, y0 + 1), ty = clamp(fy - y0);
    for (let x = 0; x < W; x++) {
      const fx = ((x + 0.5) * img.w) / W - 0.5, x0 = clamp(Math.floor(fx), 0, img.w - 1), x1 = Math.min(img.w - 1, x0 + 1), tx = clamp(fx - x0);
      for (let c = 0; c < 4; c++) {
        const a = img.data[(y0 * img.w + x0) * 4 + c], b = img.data[(y0 * img.w + x1) * 4 + c], d = img.data[(y1 * img.w + x0) * 4 + c], e = img.data[(y1 * img.w + x1) * 4 + c];
        out[(y * W + x) * 4 + c] = (a * (1 - tx) + b * tx) * (1 - ty) + (d * (1 - tx) + e * tx) * ty;
      }
    }
  }
  return out;
}

// Khoảng cách có dấu (mm, âm = trong) tới đa giác.
function sd(poly, x, y) {
  let d = Infinity, inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j], ex = xi - xj, ey = yi - yj, l2 = ex * ex + ey * ey || 1;
    const t = clamp(((x - xj) * ex + (y - yj) * ey) / l2), dx = x - xj - t * ex, dy = y - yj - t * ey;
    d = Math.min(d, dx * dx + dy * dy);
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return (inside ? -1 : 1) * Math.sqrt(d);
}

// Hình 1 viên: { R (bán kính bao, mm), dist(x, y) mm có dấu, normal(x, y, dist) → [nx, ny, nz] } trong toạ độ canvas mm.
function stoneGeom(s, cat) {
  const e = cat.codes[s.code], pearl = e?.kind === 'pearl';
  if (s.shape === 'round') {
    const R = s.phys_mm / 2;
    return { R, pearl, dist: (x, y) => Math.hypot(x - s.x_mm, y - s.y_mm) - R,
      normal(x, y) {
        const u = (x - s.x_mm) / R, v = (y - s.y_mm) / R, rho = Math.min(1, Math.hypot(u, v));
        if (pearl) return [u, v, Math.sqrt(Math.max(0, 1 - rho * rho))];
        if (rho < 0.42) return [0, 0, 1];
        const outer = rho > 0.74, n = 8, step = (2 * Math.PI) / n, a = Math.atan2(v, u) + (outer ? step / 2 : 0);
        const phi = Math.round(a / step) * step - (outer ? step / 2 : 0), slope = outer ? 0.95 : 0.5;
        return norm(Math.cos(phi) * slope, Math.sin(phi) * slope, 1);
      } };
  }
  const poly = geomOutline(s, cat, 36), R = Math.max(...poly.map(([x, y]) => Math.hypot(x - s.x_mm, y - s.y_mm)));
  const bevel = Math.max(0.3, 0.22 * Math.min(...poly.map(([x, y]) => Math.hypot(x - s.x_mm, y - s.y_mm))) * 2);
  return { R, pearl, dist: (x, y) => sd(poly, x, y),
    normal(x, y, d) {
      if (pearl) { const u = (x - s.x_mm) / R, v = (y - s.y_mm) / R; return [u, v, Math.sqrt(Math.max(0, 1 - u * u - v * v))]; }
      if (-d > bevel) return [0, 0, 1];
      const h = 0.05, gx = sd(poly, x + h, y) - sd(poly, x - h, y), gy = sd(poly, x, y + h) - sd(poly, x, y - h);
      const step = Math.PI / 4, phi = Math.round(Math.atan2(gy, gx) / step) * step, slope = -d > bevel / 2 ? 0.55 : 1.0;
      return norm(Math.cos(phi) * slope, Math.sin(phi) * slope, 1);
    } };
}

export function renderMockup(d, cat, { print = null, pxPerMm = 8, light = [-0.45, -0.6, 0.85], shadow = { dx: 0.25, dy: 0.35, soft: 0.35, alpha: 0.5 } } = {}) {
  const W = Math.round(d.canvas.w_mm * pxPerMm), H = Math.round(d.canvas.h_mm * pxPerMm), k = pxPerMm;
  const base = print ? resample(print, W, H) : new Uint8ClampedArray(W * H * 4).fill(235);
  const img = new Float32Array(W * H * 3);
  for (let i = 0; i < W * H; i++) for (let c = 0; c < 3; c++) img[i * 3 + c] = base[i * 4 + c] / 255;
  const stones = d.layers.flatMap((l) => l.stones), geoms = stones.map((s) => stoneGeom(s, cat));
  const L = norm(...light), Hh = norm(L[0], L[1], L[2] + 1);
  // bóng đổ: lấy max độ phủ bóng của các viên (không cộng dồn) rồi nhân vào nền
  const sh = new Float32Array(W * H);
  stones.forEach((s, n) => {
    const g = geoms[n], cx = s.x_mm + shadow.dx, cy = s.y_mm + shadow.dy, r = g.R + shadow.soft;
    for (let py = Math.max(0, Math.floor((cy - r) * k)); py < Math.min(H, Math.ceil((cy + r) * k)); py++) {
      for (let px = Math.max(0, Math.floor((cx - r) * k)); px < Math.min(W, Math.ceil((cx + r) * k)); px++) {
        const dd = g.dist((px + 0.5) / k - shadow.dx, (py + 0.5) / k - shadow.dy), a = shadow.alpha * clamp(0.5 - dd / shadow.soft);
        if (a > sh[py * W + px]) sh[py * W + px] = a;
      }
    }
  });
  for (let i = 0; i < W * H; i++) for (let c = 0; c < 3; c++) img[i * 3 + c] *= 1 - sh[i];
  // viên
  stones.forEach((s, n) => {
    const g = geoms[n], col = hex(cat.codes[s.code]?.fill), r = g.R + 1 / k;
    const spec = g.pearl ? 0.55 : 0.9, pw = g.pearl ? 28 : 70;
    for (let py = Math.max(0, Math.floor((s.y_mm - r) * k)); py < Math.min(H, Math.ceil((s.y_mm + r) * k)); py++) {
      for (let px = Math.max(0, Math.floor((s.x_mm - r) * k)); px < Math.min(W, Math.ceil((s.x_mm + r) * k)); px++) {
        const x = (px + 0.5) / k, y = (py + 0.5) / k, dd = g.dist(x, y), cov = clamp(0.5 - dd * k);
        if (cov <= 0) continue;
        const [nx, ny, nz] = g.normal(x, y, dd), diff = Math.max(0, nx * L[0] + ny * L[1] + nz * L[2]);
        const sp = spec * Math.max(0, nx * Hh[0] + ny * Hh[1] + nz * Hh[2]) ** pw, edge = -dd < 0.12 ? 0.78 : 1;
        const i = (py * W + px) * 3;
        for (let c = 0; c < 3; c++) {
          let v = col[c] * (0.32 + 0.78 * diff) * edge + sp;
          if (g.pearl) v += 0.06 * (1 - nz) * [1, 0.85, 1.1][c];
          img[i + c] = img[i + c] * (1 - cov) + clamp(v) * cov;
        }
      }
    }
  });
  const out = new Uint8Array(W * H * 4);
  for (let i = 0; i < W * H; i++) { for (let c = 0; c < 3; c++) out[i * 4 + c] = Math.round(clamp(img[i * 3 + c]) * 255); out[i * 4 + 3] = 255; }
  return { w: W, h: H, data: out };
}
