// Hình học viên (mm, toạ độ canvas) cho QC: chồng/khe tính trên cỡ VẬT LÝ, mọi shape.
//   physBox(s, cat): { w, h } vật lý (h = trục dài, dọc khi rot 0); tỉ lệ w/h theo catalog.
//   outline(s, cat, n): đa giác vật lý đã xoay/dời (null với tròn: dùng công thức đường tròn).
//   edgeGap(a, b, cat): khe mép-mép (âm = chồng, độ sâu), tròn ↔ tròn chính xác, khác: theo đa giác lấy mẫu.
//   neighbours(stones, radius): cặp (i, j) có tâm gần hơn radius, qua lưới băm.
import { refBox } from './svg.js';
import { outline as kitOutline, SHAPED as KIT_SHAPED } from '../kit/shapes.js';

export function physBox(s, cat) {
  const r = refBox(s, cat), k = s.phys_mm / s.ref_mm;
  return { w: r.w * k, h: r.h * k };
}

// Đa giác đơn vị (tâm gốc, bao trong [-.5,.5]²) theo shape, trục dài dọc.
const UNIT = {};
function unit(shape, n) {
  const key = `${shape}:${n}`;
  if (UNIT[key]) return UNIT[key];
  const pts = [];
  if (shape === 'star') for (let i = 0; i < 10; i++) { const a = (i / 10) * 2 * Math.PI - Math.PI / 2, r = i % 2 ? 0.2 : 0.5; pts.push([r * Math.cos(a), r * Math.sin(a)]); }
  else for (let i = 0; i < n; i++) { const a = (i / n) * 2 * Math.PI; pts.push([0.5 * Math.cos(a), 0.5 * Math.sin(a)]); }
  return (UNIT[key] = pts);
}

export function outline(s, cat, n = 32) {
  if (s.shape === 'round') return null;
  const { w, h } = physBox(s, cat), r = (s.rot_deg * Math.PI) / 180, c = Math.cos(r), sn = Math.sin(r);
  let pts;
  if (KIT_SHAPED.includes(s.shape)) pts = kitOutline(s.shape, w, h, n * 2); // tim / marquise / giọt: đúng hình của lib/kit/shapes.js
  else pts = unit(s.shape, n).map(([x, y]) => [x * w, y * h]); // hoa / hồng ≈ elip bao, sao = sao 5 cánh
  return pts.map(([x, y]) => [s.x_mm + x * c - y * sn, s.y_mm + x * sn + y * c]);
}

function inside(p, poly) {
  let o = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) o = !o;
  }
  return o;
}
function segDist(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy, t = L ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L)) : 0;
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}
const polyDist = (p, poly) => Math.min(...poly.map((a, i) => segDist(p, a, poly[(i + 1) % poly.length])));
const circlePoly = (s, n = 32) => Array.from({ length: n }, (_, i) => { const a = (i / n) * 2 * Math.PI; return [s.x_mm + (s.phys_mm / 2) * Math.cos(a), s.y_mm + (s.phys_mm / 2) * Math.sin(a)]; });

export function edgeGap(a, b, cat) {
  if (a.shape === 'round' && b.shape === 'round') return Math.hypot(a.x_mm - b.x_mm, a.y_mm - b.y_mm) - (a.phys_mm + b.phys_mm) / 2;
  const A = outline(a, cat) || circlePoly(a), B = outline(b, cat) || circlePoly(b);
  let depth = 0, overlap = false;
  for (const [P, Q] of [[A, B], [B, A]]) for (const p of P) if (inside(p, Q)) { overlap = true; depth = Math.max(depth, polyDist(p, Q)); }
  if (overlap) return -depth;
  return Math.min(Math.min(...A.map((p) => polyDist(p, B))), Math.min(...B.map((p) => polyDist(p, A))));
}

export function neighbours(stones, radius) {
  const cell = radius, grid = new Map(), out = [];
  const key = (i, j) => `${i},${j}`;
  stones.forEach((s, k) => {
    const i = Math.floor(s.x_mm / cell), j = Math.floor(s.y_mm / cell);
    for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) for (const m of grid.get(key(i + di, j + dj)) || []) {
      const t = stones[m];
      if (Math.hypot(s.x_mm - t.x_mm, s.y_mm - t.y_mm) < radius) out.push([m, k]);
    }
    const kk = key(i, j);
    if (!grid.has(kk)) grid.set(kk, []);
    grid.get(kk).push(k);
  });
  return out;
}
