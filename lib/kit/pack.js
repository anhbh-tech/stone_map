// KIT-18 lấp dày quanh vật cản: lưới lục giác 2.8 bị vỡ quanh viên to / hạt DETECT / chuỗi viền để lại lỗ < 1 viên. densify thử từng
// lỗ (lớn trước, cho chồng ≤ insertMm): đặt 1 viên, nới cục bộ các viên lấp trong ~trialR bước (đẩy cặp chồng nhau ra; viên cố định +
// vùng cấm tâm đẩy theo gradient khoảng cách EDT), kiểm tra chính xác (đa giác viên hình, khe gapMm) → giữ, không thì trả như cũ.
// Chỉ viên lấp được dời; lõi lưới đều không chồng nên không động. Đo trên Queen: +1–2 % phủ (lưới vỡ quanh vật cản là giới hạn chính).
import { stonePoly, sdPoly, gapMm as polyGap } from './shapes.js';

// EDT bình phương (Felzenszwalb) 1 chiều
function edt1(f, n, d, v, z) {
  let k = 0; v[0] = 0; z[0] = -Infinity; z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) { k--; s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
    k++; v[k] = q; z[k] = s; z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) { while (z[k + 1] < q) k++; d[q] = (q - v[k]) ** 2 + f[v[k]]; }
}
// khoảng cách (px) tới điểm mask = 1 gần nhất
export function edt(mask, w, h) {
  const INF = 1e20, g = new Float32Array(w * h), n = Math.max(w, h), f = new Float64Array(n), d = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1);
  for (let x = 0; x < w; x++) { for (let y = 0; y < h; y++) f[y] = mask[y * w + x] ? 0 : INF; edt1(f, h, d, v, z); for (let y = 0; y < h; y++) g[y * w + x] = d[y]; }
  for (let y = 0; y < h; y++) { for (let x = 0; x < w; x++) f[x] = g[y * w + x]; edt1(f, w, d, v, z); for (let x = 0; x < w; x++) g[y * w + x] = Math.sqrt(d[x]); }
  return g;
}

const geoOf = (t) => (t.shape ? { x: t.x, y: t.y, shape: t.shape, w: t.w, h: t.h, rot: t.rot } : { x: t.x, y: t.y, w: t.physMm, h: t.physMm });

// o = { w, h, ppm, d (2.8), gapMm (0.15), fixed [{x, y, physMm, shape?, w?, h?, rot?}], movable [{x, y, physMm = d, …}],
//   centreOk Uint8Array w×h (1 = tâm được đặt), rounds (3), iters (25), insertMm (0.7), trialR (2.5) } → { stones (viên lấp), added, tried }
export function densify(o) {
  const { w: W, h: H, ppm } = o, d = o.d ?? 2.8, gap = o.gapMm ?? 0.15, r = (d / 2) * ppm, R2 = (d + gap) * ppm;
  // vật cản cố định → mask → EDT; vùng cấm tâm → EDT tới điểm cấm
  const F = new Uint8Array(W * H);
  for (const t of o.fixed) {
    const P = t.shape ? stonePoly({ x: t.x, y: t.y, shape: t.shape, rot: t.rot || 0 }, ppm, t.w, t.h) : null, rr = (Math.max(t.w ?? t.physMm, t.h ?? t.physMm, t.physMm) / 2) * ppm + 1;
    for (let y = Math.max(0, Math.floor(t.y - rr)); y <= Math.min(H - 1, Math.ceil(t.y + rr)); y++) for (let x = Math.max(0, Math.floor(t.x - rr)); x <= Math.min(W - 1, Math.ceil(t.x + rr)); x++)
      if (P ? sdPoly(P, x + 0.5, y + 0.5) <= 0 : Math.hypot(x + 0.5 - t.x, y + 0.5 - t.y) <= (t.physMm / 2) * ppm) F[y * W + x] = 1;
  }
  const Ef = edt(F, W, H), bad = new Uint8Array(W * H);
  for (let j = 0; j < W * H; j++) bad[j] = o.centreOk[j] ? 0 : 1;
  const Ec = edt(bad, W, H);
  const smp = (E, x, y) => E[Math.min(H - 1, Math.max(0, Math.round(y))) * W + Math.min(W - 1, Math.max(0, Math.round(x)))];
  const grad = (E, x, y) => { const gx = smp(E, x + 2, y) - smp(E, x - 2, y), gy = smp(E, x, y + 2) - smp(E, x, y - 2), L = Math.hypot(gx, gy) || 1; return [gx / L, gy / L]; };
  const needF = (r + gap * ppm); // khoảng tâm → mép viên cố định
  // lưới băm viên cố định (kiểm tra chính xác) + viên lấp
  const cellF = 16 * ppm, gridF = new Map();
  for (const t of o.fixed) { const k = `${Math.floor(t.x / cellF)},${Math.floor(t.y / cellF)}`; (gridF.get(k) || gridF.set(k, []).get(k)).push(t); }
  const exactFixed = (x, y) => {
    const G = { x, y, w: d, h: d }, gx = Math.floor(x / cellF), gy = Math.floor(y / cellF);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) for (const t of gridF.get(`${gx + dx},${gy + dy}`) || []) {
      const far = Math.hypot(t.x - x, t.y - y) / ppm - (Math.max(t.physMm, t.w || 0, t.h || 0) + d) / 2;
      if (far >= gap - 1e-6) continue;
      if (!t.shape) { if (Math.hypot(t.x - x, t.y - y) / ppm - (t.physMm + d) / 2 < gap - 1e-3) return false; continue; }
      if (polyGap(geoOf(t), G, ppm) < gap - 1e-3) return false;
    }
    return true;
  };
  const S = o.movable.map((s) => ({ ...s, physMm: d })), cell = R2, grid = new Map();
  const key = (x, y) => `${Math.floor(x / cell)},${Math.floor(y / cell)}`;
  const put = (s) => { s.k = key(s.x, s.y); (grid.get(s.k) || grid.set(s.k, new Set()).get(s.k)).add(s); };
  const move = (s, x, y) => { const k = key(x, y); s.x = x; s.y = y; if (k !== s.k) { grid.get(s.k).delete(s); s.k = k; (grid.get(k) || grid.set(k, new Set()).get(k)).add(s); } };
  const near = (x, y, rad = 1) => { const gx = Math.floor(x / cell), gy = Math.floor(y / cell), out = []; for (let dy = -rad; dy <= rad; dy++) for (let dx = -rad; dx <= rad; dx++) for (const t of grid.get(`${gx + dx},${gy + dy}`) || []) out.push(t); return out; };
  S.forEach(put);
  const okAt = (s, x, y) => x >= r && y >= r && x <= W - r && y <= H - r && o.centreOk[Math.round(y) * W + Math.round(x)] && exactFixed(x, y)
    && near(x, y).every((t) => t === s || Math.hypot(t.x - x, t.y - y) >= R2 - 0.005 * ppm);
  // 1 lần thử: viên mới tại (x, y), nới cục bộ các viên lấp trong bán kính ~2.5 bước; hợp lệ chính xác thì giữ, không thì trả về như cũ
  const trial = (x, y, iters) => {
    const TR = o.trialR ?? 2.5, L = near(x, y, Math.ceil(TR)).filter((t) => Math.hypot(t.x - x, t.y - y) < TR * R2), save = L.map((t) => [t, t.x, t.y]);
    const n = { x, y, physMm: d, score: 0, from: 'fill' }; put(n);
    const A = [n, ...L], inA = new Set(A);
    for (let it = 0; it < iters; it++) {
      let worst = 0;
      const mv = A.map(() => [0, 0]);
      A.forEach((s, i) => {
        for (const t of near(s.x, s.y)) {
          if (t === s) continue;
          const dx = s.x - t.x, dy = s.y - t.y, D = Math.hypot(dx, dy) || 1e-3;
          if (D >= R2 + 0.02) continue;
          worst = Math.max(worst, R2 - 0.03 - D);
          const k = (R2 + 0.1 - D) * (inA.has(t) ? 0.5 : 1);
          mv[i][0] += (dx / D) * k; mv[i][1] += (dy / D) * k;
        }
        const ef = smp(Ef, s.x, s.y);
        if (ef < needF + 0.3) { const [gx, gy] = grad(Ef, s.x, s.y), k = needF + 0.6 - ef; mv[i][0] += gx * k; mv[i][1] += gy * k; worst = Math.max(worst, needF - 0.2 - ef); }
        const ec = smp(Ec, s.x, s.y);
        if (ec < 1.5) { const [gx, gy] = grad(Ec, s.x, s.y), k = 2 - ec; mv[i][0] += gx * k; mv[i][1] += gy * k; worst = Math.max(worst, 1 - ec); }
      });
      if (worst <= 0) break;
      A.forEach((s, i) => { const Lm = Math.hypot(mv[i][0], mv[i][1]); if (!Lm) return; const m = Math.min(1, (0.3 * ppm) / Lm); move(s, s.x + mv[i][0] * m, s.y + mv[i][1] * m); });
    }
    if (A.every((s) => okAt(s, s.x, s.y))) { S.push(n); return true; }
    grid.get(n.k).delete(n);
    for (const [t, x0, y0] of save) move(t, x0, y0);
    return false;
  };
  // lỗ: điểm lưới bước 0.4 mm trong vùng tâm được phép, khoảng trống (tới viên cố định / viên lấp) ≥ r − insertMm, lớn trước
  const holes = () => {
    const st = Math.max(1, Math.round(0.4 * ppm)), out = [], need = r - (o.insertMm ?? 0.7) * ppm;
    for (let y = Math.round(r); y < H - r; y += st) for (let x = Math.round(r); x < W - r; x += st) {
      const j = y * W + x;
      if (!o.centreOk[j]) continue;
      let c = Ef[j] - gap * ppm;
      if (c < need) continue;
      for (const t of near(x, y)) { c = Math.min(c, Math.hypot(t.x - x, t.y - y) - r - gap * ppm); if (c < need) break; }
      if (c >= need) out.push([c, x, y]);
    }
    return out.sort((a, b) => b[0] - a[0]);
  };
  const n0 = S.length;
  let tried = 0;
  for (let round = 0; round < (o.rounds ?? 3); round++) {
    const hs = holes();
    let got = 0;
    for (const [, x, y] of hs) {
      // lỗ đã bị viên vừa chèn lấp: bỏ
      if (near(x, y).some((t) => Math.hypot(t.x - x, t.y - y) < r + gap * ppm)) continue;
      tried++;
      if (trial(x, y, o.iters ?? 25)) got++;
    }
    if (o.debug) console.error('densify round', round, 'holes', hs.length, 'added', got);
    if (!got) break;
  }
  return { stones: S.map(({ k, ...s }) => s), added: S.length - n0, tried };
}
