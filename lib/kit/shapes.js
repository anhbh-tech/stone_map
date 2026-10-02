// KIT-14: hình viên không tròn của catalog (tim X, marquise M, giọt S) — đường viền, khoảng cách có dấu, khe giữa 2 viên.
// Toạ độ cục bộ (u, v) mm, tâm = tâm khung w × h, trục dài h theo v (dọc), mũi tim / mũi giọt hướng +v (xuống dưới ảnh).
// Xoay rot độ như SVG matrix(cos sin −sin cos x y): x = cx + u·cos − v·sin, y = cy + u·sin + v·cos.
// Viên: { x, y (px), shape, wMm, hMm, rot } hoặc tròn { x, y, dMm } (shape 'round' / thiếu).
export const SHAPED = ['heart', 'marquise', 'teardrop'];
export const isShaped = (s) => SHAPED.includes(s?.shape);
const cache = new Map();

// Đa giác n điểm (mm, cục bộ) của hình w × h.
export function outline(shape, w, h, n = 72) {
  const key = `${shape}|${w}|${h}|${n}`;
  if (cache.has(key)) return cache.get(key);
  let pts = [];
  if (shape === 'marquise') { // thấu kính: giao 2 cung tròn, dài h, rộng w
    const R = (h * h / 4 + w * w / 4) / w, d = R - w / 2, m = n >> 1;
    for (let i = 0; i <= m; i++) { const v = -h / 2 + (h * i) / m; pts.push([Math.max(0, Math.sqrt(Math.max(0, R * R - v * v)) - d), v]); }
    for (let i = m - 1; i > 0; i--) pts.push([-pts[i][0], pts[i][1]]);
  } else if (shape === 'teardrop') { // đầu tròn bán kính w/2 ở trên, mũi nhọn ở dưới (+v), 2 tiếp tuyến
    const r = w / 2, c = -h / 2 + r, L = h / 2 - c, a = Math.acos(Math.min(1, r / L));
    const m = n - 1;
    for (let i = 0; i < m; i++) { const t = Math.PI / 2 + a + ((2 * Math.PI - 2 * a) * i) / (m - 1); pts.push([r * Math.cos(t), c + r * Math.sin(t)]); }
    pts.push([0, h / 2]);
  } else if (shape === 'heart') { // tim tham số, chuẩn hoá vào khung w × h, mũi xuống dưới
    const raw = [];
    for (let i = 0; i < n; i++) { const t = (2 * Math.PI * i) / n; raw.push([16 * Math.sin(t) ** 3, -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t))]); }
    const xs = raw.map((p) => p[0]), ys = raw.map((p) => p[1]), x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    pts = raw.map(([x, y]) => [((x - x0) / (x1 - x0) - 0.5) * w, ((y - y0) / (y1 - y0) - 0.5) * h]);
  } else for (let i = 0; i < n; i++) { const t = (2 * Math.PI * i) / n; pts.push([(w / 2) * Math.cos(t), (h / 2) * Math.sin(t)]); }
  cache.set(key, pts);
  return pts;
}
// Đa giác thế giới (px) của 1 viên; k = px/mm; size: 'ref' (wMm/hMm như SVG) hoặc { w, h } mm khác (vd cỡ vật lý).
export function stonePoly(s, k, w = s.wMm, h = s.hMm) {
  const t = ((s.rot || 0) * Math.PI) / 180, c = Math.cos(t), sn = Math.sin(t);
  return outline(s.shape, w, h).map(([u, v]) => [s.x + (u * c - v * sn) * k, s.y + (u * sn + v * c) * k]);
}
// Khoảng cách có dấu (px) từ điểm tới đa giác: âm = bên trong.
export function sdPoly(poly, x, y) {
  let d = Infinity, inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j], ex = xi - xj, ey = yi - yj, l2 = ex * ex + ey * ey || 1;
    const t = Math.max(0, Math.min(1, ((x - xj) * ex + (y - yj) * ey) / l2)), dx = x - xj - t * ex, dy = y - yj - t * ey;
    d = Math.min(d, dx * dx + dy * dy);
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return (inside ? -1 : 1) * Math.sqrt(d);
}
// Khe (mm) giữa 2 viên theo cỡ cho trước: A/B = { x, y, shape?, w, h, rot } (tròn: w = h = d). Âm = chồng.
export function gapMm(A, B, k) {
  const round = (s) => !isShaped(s);
  if (round(A) && round(B)) return Math.hypot(A.x - B.x, A.y - B.y) / k - (A.w + B.w) / 2;
  const pa = round(A) ? null : stonePoly(A, k, A.w, A.h), pb = round(B) ? null : stonePoly(B, k, B.w, B.h);
  const dTo = (p, S, poly) => (poly ? sdPoly(poly, p[0], p[1]) : Math.hypot(p[0] - S.x, p[1] - S.y) - (S.w / 2) * k);
  let g = Infinity;
  for (const p of pa || stonePoly({ ...A, shape: 'round' }, k, A.w, A.w)) g = Math.min(g, dTo(p, B, pb));
  for (const p of pb || stonePoly({ ...B, shape: 'round' }, k, B.w, B.w)) g = Math.min(g, dTo(p, A, pa));
  return g / k;
}
