// KIT-27 dấu hiệu hình trái tim từ ảnh (captain msg 022: tim đỏ giữa vương miện ra 'B' tròn).
// Khớp viền SAM với khuôn catalog không phân biệt được tim có khung vàng / mặt cắt bóng (tim 0.78 < tròn 0.87),
// nên đo trực tiếp trên mask màu: vùng cùng tông (hue ± hueTol, chroma ≥ chromaK × chroma hạt) nối với tâm,
// bán kính viền ngoài r(θ) theo 180 tia (lấp lỗ do điểm sáng), làm mượt; tim = 1 khía sâu (rmin ≤ (1 − notch) × trung vị)
// có 2 thuỳ 2 bên và 1 mũi nhọn đối diện (± 30°). Góc xoay: khía hướng lên = 0°.
import { lab } from './select.js';

export const CUE = { rays: 180, smooth: 3, notch: 0.2, notchW: 80, sym: 0.11, bottom: 0.95, lobe: 0.85, lobeDeg: 40, hueTol: 28, chromaK: 0.45, minChroma: 25, cells: 140 };

// img = { w, h, data RGBA }, (cx, cy, rPx) theo px ảnh, ref = [L, a, b] của hạt
export function heartCue(img, cx, cy, rPx, ref, o = {}) {
  const P = { ...CUE, ...o }, C0 = Math.hypot(ref[1], ref[2]);
  if (C0 < P.minChroma) return { heart: false, reason: 'low-chroma' };
  const h0 = Math.atan2(ref[2], ref[1]), s = Math.max(1, Math.round(rPx / P.cells)), n = 2 * Math.ceil(rPx / s) + 1, half = (n - 1) / 2;
  const ins = new Uint8Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = Math.round(cx + (i - half) * s), y = Math.round(cy + (j - half) * s);
    if (x < 0 || y < 0 || x >= img.w || y >= img.h) continue;
    const q = (y * img.w + x) * 4, [, a, b] = lab([img.data[q], img.data[q + 1], img.data[q + 2]]), C = Math.hypot(a, b);
    let dh = Math.abs(Math.atan2(b, a) - h0); if (dh > Math.PI) dh = 2 * Math.PI - dh;
    ins[j * n + i] = C >= P.chromaK * C0 && (dh * 180) / Math.PI <= P.hueTol ? 1 : 0;
  }
  // thành phần nối với tâm (hạt tâm = điểm trong gần tâm nhất)
  let seed = -1, sd = Infinity;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) if (ins[j * n + i]) { const d = Math.hypot(i - half, j - half); if (d < sd) { sd = d; seed = j * n + i; } }
  if (seed < 0 || sd > 0.3 * half) return { heart: false, reason: 'no-centre' };
  const comp = new Uint8Array(n * n), st = [seed]; comp[seed] = 1;
  while (st.length) {
    const u = st.pop(), i = u % n, j = (u - i) / n;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const a = i + di, b = j + dj, v = b * n + a; if (a >= 0 && b >= 0 && a < n && b < n && ins[v] && !comp[v]) { comp[v] = 1; st.push(v); } }
  }
  let mx = 0, my = 0, m = 0;
  for (let u = 0; u < n * n; u++) if (comp[u]) { mx += u % n; my += Math.floor(u / n); m++; }
  mx /= m; my /= m;
  // tia từ tâm hạt (không phải trọng tâm thành phần: vùng màu có thể tràn sang hạt đỏ kề bên), dừng ở bán kính hạt (rPx / s)
  const r = new Float64Array(P.rays), lim = half;
  for (let k = 0; k < P.rays; k++) {
    const t = (2 * Math.PI * k) / P.rays, dx = Math.cos(t), dy = Math.sin(t);
    for (let d = 0; d <= lim; d += 0.5) { const i = Math.round(half + dx * d), j = Math.round(half + dy * d); if (i < 0 || j < 0 || i >= n || j >= n) break; if (comp[j * n + i]) r[k] = d; }
  }
  const rs = r.map((_, k) => { let a = 0; for (let q = -P.smooth; q <= P.smooth; q++) a += r[(k + q + P.rays) % P.rays]; return a / (2 * P.smooth + 1); });
  const srt = [...rs].sort((a, b) => a - b), med = srt[P.rays >> 1], p75 = srt[Math.floor(0.75 * P.rays)];
  let kMin = 0; rs.forEach((v, k) => { if (v < rs[kMin]) kMin = k; });
  const deg = 360 / P.rays, at = (k) => rs[((k % P.rays) + P.rays) % P.rays], H2 = P.rays >> 1;
  const notch = 1 - rs[kMin] / p75, bottom = at(kMin + H2) / p75;
  // bề rộng khía (góc liền quanh khía có r < 0.85·p75) và đối xứng 2 thuỳ qua trục khía
  let w = 1; for (let q = 1; q < H2 && at(kMin + q) < 0.85 * p75; q++) w++; for (let q = 1; q < H2 && at(kMin - q) < 0.85 * p75; q++) w++;
  let sy = 0; for (let q = 1; q < H2; q++) sy += Math.abs(at(kMin + q) - at(kMin - q)); sy /= (H2 - 1) * p75;
  const notchW = w * deg, sym = sy, tip = bottom, lobes = Math.min(at(kMin - Math.round(P.lobeDeg / deg)), at(kMin + Math.round(P.lobeDeg / deg))) / p75, opp = 180;
  const heart = notch >= P.notch && notchW <= P.notchW && sym <= P.sym && bottom >= P.bottom && lobes >= P.lobe && p75 > 0.3 * half;
  const notchDeg = kMin * deg; // ảnh: y xuống; khía lên = −90° → xoay 0
  let rotDeg = notchDeg + 90; rotDeg = ((rotDeg + 180) % 360 + 360) % 360 - 180;
  return { heart, notch: +notch.toFixed(3), notchW: +notchW.toFixed(0), sym: +sym.toFixed(3), bottom: +tip.toFixed(3), lobes: +lobes.toFixed(3), rotDeg: +rotDeg.toFixed(1), radiusPx: +(med * s).toFixed(1), areaFrac: +(m / (n * n)).toFixed(3) };
}
