// KIT-26 đối xứng gương qua 1 trục dọc (captain msg 021): trang phục vẽ đối xứng trái ↔ phải, trừ vật thể đè lên (quyền trượng).
// Không toạ độ cứng: trục = cực tiểu sai khác Lab giữa ảnh và ảnh lật (trong mask), vật thể bất đối xứng = phần dư sau lật, phía
// có phần lòi ra ngoài mask đối xứng (mask ∖ mirror(mask)) là vật thể; phía kia là trang phục bị che → vẫn đối xứng.
// Mọi toạ độ vào / ra = px canvas (3543 = 300 mm). Lưới làm việc res ô / mm (mặc định 2 → 0.5 mm).
import { lab } from './select.js';

export const SYM = {
  res: 2, smoothMm: 4, rangeMm: [90, 210], minOverlap: 0.5,
  dE: 30, // ô "khác" khi ΔE76 (ảnh làm mượt ±4 mm: hạt vẽ lệch vài mm giữa 2 bên) với ô gương > dE
  closeMm: 1.5, openMm: 1, minAreaMm2: 25, objDilateMm: 1.5,
  minStickMm2: 15, stickFrac: 0.3, // thành phần lòi ra ngoài mask đối xứng ≥ ngưỡng và ≥ 30 % diện tích của nó → vật thể (còn lại = vẽ lệch)
  iouTol: 0, refine: 0, // tuỳ chọn (tắt mặc định): bình nguyên IoU chọn ΔE nhỏ nhất / ước lượng lại trên mask trừ vật thể — trên Queen kéo trục lệch 3 mm khỏi giữa viền mask (153.8 → 150.75)
  onIoU: 0.85, onScore: 0.6, // bật khi mask lật trùng ≥ onIoU VÀ ≥ onScore ô (ngoài vật thể) giống ảnh lật
};

// ảnh ×4 (RGBA) + hàm mask (px canvas) → lưới Lab trung bình + mask, rồi làm mượt hộp ±smoothMm
export function symGrid(image, imageK, inside, Wpx, ppm, o = {}) {
  const P = { ...SYM, ...o }, res = P.res, n = Math.round((Wpx / ppm) * res), cp = ppm / res, up = cp * imageK;
  const Lb = new Float32Array(n * n * 3), m = new Uint8Array(n * n);
  for (let gy = 0; gy < n; gy++) for (let gx = 0; gx < n; gx++) {
    const x0 = Math.floor(gx * up), x1 = Math.min(image.w, Math.max(x0 + 1, Math.floor((gx + 1) * up))), y0 = Math.floor(gy * up), y1 = Math.min(image.h, Math.max(y0 + 1, Math.floor((gy + 1) * up)));
    let r = 0, g = 0, b = 0, c = 0;
    for (let y = y0; y < y1; y += 2) for (let x = x0; x < x1; x += 2) { const j = (y * image.w + x) * 4; r += image.data[j]; g += image.data[j + 1]; b += image.data[j + 2]; c++; }
    const L = lab([r / c, g / c, b / c]), i = gy * n + gx;
    Lb[i * 3] = L[0]; Lb[i * 3 + 1] = L[1]; Lb[i * 3 + 2] = L[2];
    m[i] = inside ? (inside((gx + 0.5) * cp, (gy + 0.5) * cp) ? 1 : 0) : 1;
  }
  return { n, res, cp, lab: boxSmooth3(Lb, n, Math.round(P.smoothMm * res)), m, hasMask: !!inside };
}

function boxSmooth3(A, n, r) {
  const out = new Float32Array(A.length), tmp = new Float32Array(A.length);
  for (let ch = 0; ch < 3; ch++) {
    for (let y = 0; y < n; y++) { let s = 0, c = 0; for (let x = -r; x < n + r; x++) { if (x + r < n && x + r >= 0) { s += A[(y * n + x + r) * 3 + ch]; c++; } if (x - r - 1 >= 0) { s -= A[(y * n + x - r - 1) * 3 + ch]; c--; } if (x >= 0 && x < n) tmp[(y * n + x) * 3 + ch] = s / c; } }
    for (let x = 0; x < n; x++) { let s = 0, c = 0; for (let y = -r; y < n + r; y++) { if (y + r < n && y + r >= 0) { s += tmp[((y + r) * n + x) * 3 + ch]; c++; } if (y - r - 1 >= 0) { s -= tmp[((y - r - 1) * n + x) * 3 + ch]; c--; } if (y >= 0 && y < n) out[(y * n + x) * 3 + ch] = s / c; } }
  }
  return out;
}
const dEAt = (g, i, j) => Math.hypot(g.lab[i * 3] - g.lab[j * 3], g.lab[i * 3 + 1] - g.lab[j * 3 + 1], g.lab[i * 3 + 2] - g.lab[j * 3 + 2]);

// trục: gương ô gx ↔ S − gx (S nguyên → trục tại (S + 1) / 2 ô, bước 0.25 mm). Chi phí = trung bình min(ΔE, 50) trên ô mask cả 2 phía;
// chỉ xét S mà phần chồng ≥ minOverlap × diện tích mask. Tinh chỉnh dưới ô: parabol qua 3 điểm quanh cực tiểu
export function estimateAxis(g, o = {}) {
  const P = { ...SYM, ...o }, { n, m } = g, area = m.reduce((a, v) => a + v, 0), curve = [];
  for (let S = Math.round(2 * P.rangeMm[0] * g.res - 1); S <= Math.round(2 * P.rangeMm[1] * g.res - 1); S++) {
    let both = 0, any = 0, cost = 0;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const i = y * n + x, xm = S - x, a = m[i], b = xm >= 0 && xm < n ? m[y * n + xm] : 0;
      if (a || b) any++;
      if (a && b) { both++; cost += Math.min(50, dEAt(g, i, y * n + xm)); }
    }
    curve.push({ S, iou: both / Math.max(1, any), cost: both ? cost / both : Infinity, overlap: both / Math.max(1, area) });
  }
  const okC = curve.filter((c) => c.overlap >= P.minOverlap);
  if (!okC.length) return null;
  // có mask: trục = IoU mask lật lớn nhất (ΔE ảnh không tin được: hạt vẽ không thẳng hàng 2 bên, đo theo dải ngang lệch 126–154 mm;
  // IoU mask Queen 152.3 mm ≈ trục vị trí của sản phẩm thật trong DB 152.8 mm); không mask: ΔE ảnh nhỏ nhất. Dưới ô: parabol 3 điểm
  // có mask: trong các trục có IoU ≥ IoU lớn nhất − iouTol (bình nguyên: vật thể lòi ra bù trừ thân lệch) chọn ΔE ảnh nhỏ nhất
  const top = Math.max(...okC.map((c) => c.iou)), key = g.hasMask ? (c) => (c.iou >= top - P.iouTol ? c.cost : Infinity) : (c) => c.cost;
  if (P.axisMm != null) { // trục chỉnh tay (--sym-axis <mm>): giữ IoU / chi phí tại ô gần nhất để báo cáo
    const S0 = Math.round(2 * P.axisMm * g.res - 1), c0 = curve.find((c) => c.S === S0) || { S: S0, iou: 0, cost: Infinity };
    return { S: S0, axisPx: P.axisMm * g.res * g.cp, axisMm: +P.axisMm.toFixed(2), iou: +c0.iou.toFixed(3), cost: +c0.cost.toFixed(2), curve, manual: true };
  }
  const best = okC.reduce((a, c) => (key(c) < key(a) ? c : a), okC[0]), k = curve.indexOf(best);
  let sub = 0;
  if (k > 0 && k < curve.length - 1) { const a = key(curve[k - 1]), b = key(best), c = key(curve[k + 1]), den = a - 2 * b + c; if (Number.isFinite(den) && den > 0) sub = Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / den)); }
  const S = best.S + sub, axisCells = (S + 1) / 2;
  return { S: best.S, axisPx: axisCells * g.cp, axisMm: +(axisCells / g.res).toFixed(2), iou: +best.iou.toFixed(3), cost: +best.cost.toFixed(2), curve };
}

// phần dư sau lật → vật thể bất đối xứng (1 phía) + điểm đối xứng
export function asymmetry(g, ax, o = {}) {
  const P = { ...SYM, ...o }, { n, m } = g, S = ax.S, mir = (x) => S - x;
  const diff = new Uint8Array(n * n), stick = new Uint8Array(n * n);
  let inM = 0, same = 0;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const i = y * n + x, xm = mir(x);
    if (!m[i]) continue;
    const mm = xm >= 0 && xm < n && m[y * n + xm];
    if (!mm) { stick[i] = 1; diff[i] = 1; continue; }
    if (dEAt(g, i, y * n + xm) > P.dE) diff[i] = 1;
  }
  const r = (mm) => Math.max(1, Math.round(mm * g.res));
  let A = open(close(diff, n, r(P.closeMm)), n, r(P.openMm));
  // thành phần (mỗi phía riêng, cắt tại trục) → vật thể nếu phần lòi ra ngoài mask đối xứng ≥ minStick và > 2 × phía gương
  const axC = (S + 1) / 2, side = (x) => (x + 0.5 < axC ? -1 : 1);
  const lab2 = new Int32Array(n * n).fill(-1), comps = [];
  for (let i0 = 0; i0 < n * n; i0++) {
    if (!A[i0] || lab2[i0] >= 0) continue;
    const s0 = side(i0 % n), st = [i0], px = []; lab2[i0] = comps.length;
    while (st.length) { const u = st.pop(); px.push(u); const x = u % n, y = (u / n) | 0; for (const v of [x > 0 ? u - 1 : -1, x < n - 1 ? u + 1 : -1, y > 0 ? u - n : -1, y < n - 1 ? u + n : -1]) if (v >= 0 && A[v] && lab2[v] < 0 && side(v % n) === s0) { lab2[v] = comps.length; st.push(v); } }
    comps.push({ side: s0, px, stick: px.reduce((a, u) => a + stick[u], 0) });
  }
  const cell2 = 1 / (g.res * g.res), obj = new Uint8Array(n * n), objComps = [];
  for (const c of comps) {
    if (c.px.length * cell2 < P.minAreaMm2) continue;
    let twin = 0; for (const u of c.px) { const x = u % n, y = (u / n) | 0, xm = mir(x); if (xm >= 0 && xm < n) twin += stick[y * n + xm]; }
    if (c.stick * cell2 >= P.minStickMm2 && c.stick > 2 * twin && c.stick >= P.stickFrac * c.px.length) { for (const u of c.px) obj[u] = 1; objComps.push({ side: c.side, areaMm2: Math.round(c.px.length * cell2), stickMm2: Math.round(c.stick * cell2) }); }
  }
  const objD = dilate(obj, n, r(P.objDilateMm));
  // điểm: ô mask ngoài vật thể (cả 2 phía của vật thể) giống ô gương
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const i = y * n + x, xm = mir(x);
    if (!m[i] || objD[i] || (xm >= 0 && xm < n && objD[y * n + xm])) continue;
    inM++; if (!diff[i]) same++;
  }
  const score = inM ? same / inM : 0;
  return { diff: A, obj: objD, objComps, score: +score.toFixed(3) };
}

// gói lại: bật / tắt + hàm tra theo px canvas
export function symmetryOf(image, imageK, inside, Wpx, ppm, o = {}) {
  const P = { ...SYM, ...o }, g = symGrid(image, imageK, inside, Wpx, ppm, P);
  let ax = estimateAxis(g, P);
  if (!ax) return { on: false, reason: 'no-axis' };
  let as = asymmetry(g, ax, P);
  // vật thể (quyền trượng) kéo IoU mask lệch về phía nó → ước lượng lại trên mask trừ vật thể, tới khi trục đứng yên (≤ 3 lượt)
  for (let it = 0; it < P.refine && !ax.manual && g.hasMask && as.objComps.length; it++) {
    const ax2 = estimateAxis({ ...g, m: g.m.map((v, i) => (v && !as.obj[i] ? 1 : 0)) }, P);
    if (!ax2 || ax2.S === ax.S) break;
    ax = { ...ax2, iouNoObj: ax2.iou, iou: +estimateAxis(g, { ...P, axisMm: ax2.axisMm }).iou };
    as = asymmetry(g, ax, P);
  }
  // không mask (ảnh cả khung, vd Snowman): nền đều lật vẫn giống → điểm vô nghĩa; đối xứng chỉ áp cho trang phục có mask (P.force = ép)
  const iouRule = ax.iouNoObj ?? ax.iou; // IoU mask lật trên phần ngoài vật thể
  const on = P.force || (g.hasMask && iouRule >= P.onIoU && as.score >= P.onScore);
  const cellOf = (x, y) => { const gx = Math.floor(x / g.cp), gy = Math.floor(y / g.cp); return gx < 0 || gy < 0 || gx >= g.n || gy >= g.n ? -1 : gy * g.n + gx; };
  const mirCell = (x, y) => cellOf(2 * ax.axisPx - x, y);
  // vùng của 1 điểm: out (ngoài mask) | obj (vật thể bất đối xứng, vd quyền trượng) | asym (vẽ khác bên gương, ô hoặc ô gương lệch màu)
  // | sym (ghép gương được)
  const zone = (x, y) => { const i = cellOf(x, y); if (i < 0 || !g.m[i]) return 'out'; if (as.obj[i]) return 'obj'; const j = mirCell(x, y); return as.diff[i] || (j >= 0 && as.diff[j]) ? 'asym' : 'sym'; };
  return {
    on, reason: on ? (P.force ? 'force' : 'ok') : !g.hasMask ? 'không mask trang phục' : `iou ${+iouRule.toFixed(3)} / score ${as.score} dưới ngưỡng ${P.onIoU} / ${P.onScore}`, manualAxis: !!ax.manual, zone,
    axisPx: ax.axisPx, axisMm: ax.axisMm, iou: ax.iou, iouNoObj: ax.iouNoObj != null ? +ax.iouNoObj.toFixed(3) : undefined, cost: ax.cost, score: as.score, objComps: as.objComps,
    objAreaMm2: Math.round(as.obj.reduce((a, v) => a + v, 0) / g.res / g.res),
    mirrorX: (x) => 2 * ax.axisPx - x,
    isObj: (x, y) => { const i = cellOf(x, y); return i >= 0 && !!as.obj[i]; },
    inMask: (x, y) => { const i = cellOf(x, y); return i >= 0 && !!g.m[i]; },
    grid: { n: g.n, cp: g.cp, obj: as.obj, diff: as.diff, m: g.m }, params: P,
  };
}

// ── hình thái nhị phân (hộp vuông bán kính r ô, qua tổng tích luỹ)
function boxCount(A, n, r) {
  const I = new Int32Array((n + 1) * (n + 1));
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) I[(y + 1) * (n + 1) + x + 1] = A[y * n + x] + I[y * (n + 1) + x + 1] + I[(y + 1) * (n + 1) + x] - I[y * (n + 1) + x];
  return (x, y) => { const x0 = Math.max(0, x - r), y0 = Math.max(0, y - r), x1 = Math.min(n, x + r + 1), y1 = Math.min(n, y + r + 1); return [I[y1 * (n + 1) + x1] - I[y0 * (n + 1) + x1] - I[y1 * (n + 1) + x0] + I[y0 * (n + 1) + x0], (x1 - x0) * (y1 - y0)]; };
}
export function dilate(A, n, r) { const c = boxCount(A, n, r), o = new Uint8Array(n * n); for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) o[y * n + x] = c(x, y)[0] > 0 ? 1 : 0; return o; }
export function erode(A, n, r) { const c = boxCount(A, n, r), o = new Uint8Array(n * n); for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { const [s, t] = c(x, y); o[y * n + x] = s === t ? 1 : 0; } return o; }
const close = (A, n, r) => erode(dilate(A, n, r), n, r);
const open = (A, n, r) => dilate(erode(A, n, r), n, r);

// ── ghép cặp gương: điểm vùng "sym" phía phải lật sang trái, cặp (trái, gương phải) gần nhau (≤ tol(a, b) mm) và cùng loại (same(a, b)),
// gần nhất trước (tham lam toàn cục). Điểm cách trục < axisTol(a) mm không ghép (cột trên trục giữ đơn). → [[chỉ số trái, chỉ số phải, mm]]
export function mirrorPairs(items, sym, ppm, o) {
  const ax = sym.axisPx, cell = 8 * ppm, G = new Map(), L = [];
  items.forEach((a, k) => {
    if (sym.zone(a.x, a.y) !== 'sym' || Math.abs(a.x - ax) / ppm < o.axisTol(a)) return;
    if (a.x < ax) { L.push(k); return; }
    const mx = 2 * ax - a.x, kk = `${Math.floor(mx / cell)},${Math.floor(a.y / cell)}`;
    (G.get(kk) || G.set(kk, []).get(kk)).push(k);
  });
  const cand = [];
  for (const i of L) {
    const p = items[i], gx = Math.floor(p.x / cell), gy = Math.floor(p.y / cell);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) for (const j of G.get(`${gx + dx},${gy + dy}`) || []) {
      const q = items[j], d = Math.hypot(p.x - (2 * ax - q.x), p.y - q.y) / ppm;
      if (d <= o.tol(p, q) && o.same(p, q)) cand.push([i, j, d]);
    }
  }
  cand.sort((a, b) => a[2] - b[2]);
  const used = new Set(), out = [];
  for (const c of cand) { if (used.has(c[0]) || used.has(c[1])) continue; used.add(c[0]); used.add(c[1]); out.push(c); }
  return out;
}

// tỉ lệ cặp gương: % viên (ngoài vật thể) có viên gương cùng mã, tâm lệch ≤ tolMm; theo vùng sym / asym / tất cả.
// stones [{ x, y (px canvas), code }]
export function pairRate(stones, sym, ppm, tolMm = 0.5) {
  const cell = 4 * ppm, G = new Map(), kk = (x, y) => `${Math.floor(x / cell)},${Math.floor(y / cell)}`;
  for (const s of stones) (G.get(kk(s.x, s.y)) || G.set(kk(s.x, s.y), []).get(kk(s.x, s.y))).push(s);
  const r = { all: [0, 0], sym: [0, 0], asym: [0, 0] };
  for (const s of stones) {
    const z = sym.zone(s.x, s.y); if (z === 'obj' || z === 'out') continue;
    const mx = 2 * sym.axisPx - s.x, gx = Math.floor(mx / cell), gy = Math.floor(s.y / cell);
    let hit = false;
    for (let dy = -1; dy <= 1 && !hit; dy++) for (let dx = -1; dx <= 1 && !hit; dx++) for (const t of G.get(`${gx + dx},${gy + dy}`) || []) if (t.code === s.code && Math.hypot(t.x - mx, t.y - s.y) / ppm <= tolMm) { hit = true; break; }
    for (const k of ['all', z]) { r[k][0]++; if (hit) r[k][1]++; }
  }
  return Object.fromEntries(Object.entries(r).map(([k, [n, ok]]) => [k, { stones: n, paired: ok, pct: n ? +((100 * ok) / n).toFixed(1) : null }]));
}
