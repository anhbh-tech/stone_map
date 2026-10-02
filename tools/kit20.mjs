// KIT-20 Queen trang phục: MỖI HẠT VẼ = 1 VIÊN (không lưới / Potts / viên lấp). Đầu vào = kết quả tách hạt của tools/kit20_segment.py.
//   node tools/kit20.mjs [--seg outputs/kit/kit20/seg_sam_all.json] [--out outputs/kit/kit20] [--analyze] [--no-review]   (offline, 0 API)
// 1. gỡ mask chồng ở mức hạt vẽ: bỏ mask không giống 1 hạt (đặc < 0.86, khớp elip kém), mask nhỏ nằm trong hạt to = mảnh của hạt to
//    (trừ khi ≥ 3 hạt nhỏ phủ ≥ 45 % → mask to là cụm, giữ hạt nhỏ)
// 2. vật liệu (vàng / ngọc trai / pha lê trắng / màu) từ màu + độ lấp lánh; cỡ catalog gần nhất của vật liệu (ngọc < 5 mm → đá trắng);
//    hình (tròn / tim / marquise / giọt; oval → tròn) + góc → bảng mã chung ≤ 11 mã với nền Starry (jointPalette, 1 mã pha lê bắt buộc)
// 3. va chạm vật lý (khe ≥ 0.15 mm): viên to / rõ trước, viên sau chồng → thử 1 cỡ nhỏ hơn cùng chỗ, không thì bỏ (không dịch)
// 4. ra outputs/kit/kit20/{queen.svg, review.svg, report.json, review_<ô>.png}: chấm GT KIT-15 (recall / precision tâm, vật liệu, cỡ, hình)
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadCatalog, entryOf, checkDesign } from '../lib/kit/catalog.js';
import { normalizeDoc, writeKitSvg } from '../lib/kit/svgio.js';
import { buildDoc, upscale, materialOf, lab } from '../lib/kit/select.js';
import { gapMm } from '../lib/kit/shapes.js';
import { decodePng } from '../lib/png.js';
import { jointPalette, stoneCost } from '../lib/kit/palette.js';
import { scoreStones, mat4Of } from './score_template_gt.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2), flag = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const SEG = path.resolve(ROOT, flag('--seg', 'outputs/kit/kit20/seg_sam_all.json')), OUT = path.resolve(ROOT, flag('--out', 'outputs/kit/kit20'));
const UP4 = path.join(ROOT, 'outputs', 'kit', 'kit20', 'up4.png'); // Real-ESRGAN ×4 của ảnh nguồn (tools/kit20_segment.py cùng dùng)
// hàng hạt captain chỉ ra (msg 015): tâm px 3543 của 7 hạt vẽ cùng cỡ dọc đường cong, khung crop
const chainCollide = flag('--chain-collide', 'shrink');
const CAPTAIN = { box: [2093, 1504, 306, 508], row: [[2343, 1693], [2332, 1773], [2310, 1818], [2277, 1862], [2232, 1904], [2178, 1939], [2118, 1970]] };
const MM = 300, W = 3543, PPM = W / MM, GAP = 0.15, maxCodes = +flag('--max-codes', 13), minCodes = +flag('--min-codes', 9);
const cat = loadCatalog(), t0 = Date.now();
fs.mkdirSync(OUT, { recursive: true });
const seg = JSON.parse(fs.readFileSync(SEG, 'utf8'));
const hex2 = (h) => h.replace('#', '').match(/\w\w/g).map((v) => parseInt(v, 16));

// ── 1. gỡ chồng mức hạt vẽ
// fill = điểm mask / diện tích viền ngoài: vòng (viền vàng quanh ngọc, chuỗi khép kín) có lỗ → không phải 1 hạt
const beadLike = (b) => b.dMm >= 1.2 && b.dMm <= 20 && (b.fill ?? 1) >= 0.85 && (b.shape === 'heart' ? b.solidity >= 0.8 : b.shape === 'round' || b.shape === 'oval' ? b.solidity >= 0.88 && b.ellIoU >= 0.8 : b.solidity >= 0.86);
const all = seg.instances.map((b, i) => ({ ...b, i }));
const cand = all.filter(beadLike);
const inside = (s, b) => Math.hypot(s.x - b.x, s.y - b.y) / PPM < 0.5 * Math.min(b.wMm, b.hMm) * 0.85;
const drop = new Set();
cand.sort((p, q) => q.dMm - p.dMm);
for (const b of cand) {
  if (drop.has(b.i)) continue;
  const parts = cand.filter((s) => s !== b && !drop.has(s.i) && s.dMm < 0.62 * b.dMm && inside(s, b));
  const pa = parts.reduce((a, s) => a + s.dMm ** 2, 0) / b.dMm ** 2;
  if (parts.length >= 3 && pa >= 0.45) drop.add(b.i); // cụm hạt
  else for (const s of parts) drop.add(s.i); // mảnh của hạt to (mặt giác, điểm sáng)
}
// hai mask gần trùng (cùng hạt, 2 đề xuất): giữ điểm cao hơn
const keep0 = cand.filter((b) => !drop.has(b.i)).sort((p, q) => q.score - p.score);
const beads = [];
for (const b of keep0) if (!beads.some((k) => Math.hypot(k.x - b.x, k.y - b.y) / PPM < 0.35 * Math.min(k.dMm, b.dMm) && Math.abs(k.dMm - b.dMm) < 0.35 * Math.max(k.dMm, b.dMm))) beads.push(b);

// ── 2. vật liệu
// ngưỡng chỉnh theo trung vị đặc trưng hạt khớp GT (--analyze; ảnh vẽ ấm: ngọc trai C* ~24, pha lê C* ~9 + nhiều cạnh, vàng C* ~79 hue ~72°, đỏ hue ~40°)
const MAT = { chromaHi: +flag('--chroma-hi', 45), goldHue: [+flag('--gold-h0', 55), 100], whiteL: +flag('--white-l', 65), pearlC: +flag('--pearl-c', 15), pearlEdge: +flag('--pearl-edge', 0.05), goldDarkC: 30 };
function mat4(b) {
  const hue = (Math.atan2(b.b, b.a) * 180) / Math.PI, isGoldHue = hue >= MAT.goldHue[0] && hue <= MAT.goldHue[1];
  if (b.chroma >= MAT.chromaHi) return isGoldHue && b.L >= 40 ? 'gold' : 'color';
  if (b.L >= MAT.whiteL) return b.chroma >= MAT.pearlC && b.edge < MAT.pearlEdge ? 'pearl' : 'white';
  return isGoldHue && b.chroma >= MAT.goldDarkC ? 'gold' : 'color';
}
// cỡ catalog theo vật liệu: tròn
const roundSizes = (m) => {
  const S = new Set();
  for (const e of Object.values(cat.codes)) if (m === 'pearl' ? e.kind === 'pearl' : m === 'gold' ? materialOf(e) === 'gold' : e.kind !== 'pearl' && materialOf(e) !== 'gold') S.add(e.physMm);
  return [...S].sort((a, b) => a - b);
};
const SZ = { pearl: roundSizes('pearl'), gold: roundSizes('gold'), white: roundSizes('white'), color: roundSizes('color') };
const snap = (list, d) => list.reduce((a, v) => (Math.abs(v - d) < Math.abs(a - d) ? v : a), list[0]);
// cỡ hình có mã cùng nhóm màu (trắng / vàng / màu): viên pha lê trắng 10×7 không bị kéo về 5×10 chỉ có mã hồng
const entM4 = (e) => (materialOf(e) === 'gold' ? 'gold' : (([L, a, b]) => (L >= 75 && Math.hypot(a, b) <= 12 ? 'white' : 'color'))(lab(e.fill.replace('#', '').match(/\w\w/g).map((v) => parseInt(v, 16)))));
const shapedDims = (shape, m4) => [...new Set(Object.values(cat.shaped).filter((e) => e.shape === shape && (!m4 || entM4(e) === m4)).map((e) => `${e.physW}x${e.physH}`))].map((k) => k.split('x').map(Number));
const SHD = Object.fromEntries(['heart', 'marquise', 'teardrop'].map((sh) => [sh, Object.fromEntries([null, 'white', 'gold', 'color'].map((m) => [m, shapedDims(sh, m)]))]));
const sizeK = +flag('--size-k', 1), pearlMode = flag('--pearl-small', 'pearl'); // pearl = ngọc 5 trước, white = đá trắng ngay
function classify(b, force = null) {
  const m4 = force || mat4(b), t = [b.L, b.a, b.b];
  // hạt dài < 5.5 mm: hình không tin được (hạt tròn bị che / mask lệch) → tròn
  let shape = b.shape === 'oval' || b.wMm < (b.shape === 'heart' ? 6 : +flag('--shape-min', 5.5)) ? 'round' : b.shape;
  if (shape !== 'round') {
    const w = b.hMm * sizeK, h = b.wMm * sizeK; // python: wMm = trục dài, hMm = trục ngắn
    const m = m4 === 'pearl' ? 'white' : m4, dims = SHD[shape][m]?.length ? SHD[shape][m] : SHD[shape][null];
    // gần nhất theo tỉ lệ cạnh (log); hình to hơn catalog (tim vẽ 19 mm, tim lớn nhất 12×12) → cỡ lớn nhất của hình
    const dist = (d) => Math.abs(Math.log(d[0] / w)) + Math.abs(Math.log(d[1] / h));
    const [pw, ph] = dims.reduce((a, d) => (dist(d) < dist(a) ? d : a), dims[0]);
    if (dist([pw, ph]) <= 0.9 || Math.min(w, h) > Math.max(...dims.map((d) => d[0]))) return { m4, shape, w: pw, h: ph, physMm: Math.max(pw, ph), t, over: Math.max(w, h) > Math.max(pw, ph) + 1 ? +Math.max(w, h).toFixed(1) : undefined };
    shape = 'round';
  }
  const d = (b.shape === 'round' ? b.dMm : Math.min(b.dMm, b.hMm)) * sizeK; // hạt dài coi là tròn: cỡ theo trục ngắn
  // cỡ catalog gần nhất nhưng ≤ cỡ vẽ + 0.4 mm (hạt vẽ khít nhau: viên to hơn hạt sẽ chồng hạt bên)
  const cap = (list) => list.filter((v) => v <= d + 0.4);
  let mm = m4, phys = snap(cap(SZ[m4]).length ? cap(SZ[m4]) : SZ[m4].slice(0, 1), d);
  // ngọc trai nhỏ nhất 5 mm: hạt ngọc vẽ < 5 mm vẫn thử ngọc 5 (đúng vật liệu > đúng cỡ); va chạm → đá trắng cùng chỗ (alt)
  const alt = m4 === 'pearl' ? { mm: 'pearlAsWhite', physMm: snap(SZ.white.filter((v) => v <= d + 0.6), d) || 2.8 } : null;
  if (m4 === 'pearl' && (pearlMode === 'white' && phys > d + 0.8)) return { m4, ...alt, shape: 'round', t };
  return { m4, mm, shape: 'round', physMm: phys, t, alt };
}
const classifyAs = (b, m4) => classify(b, m4);
// lớp catalog (cho stoneCost): pearl | gold | base | facet; màu ≥ 8 mm = facet (Q), trắng ≥ 8 = facet
const catMat = (c) => (c.mm === 'pearl' ? 'pearl' : c.m4 === 'gold' ? 'gold' : c.physMm >= 8 && !c.w ? 'facet' : 'base');

for (const b of beads) b.cls = classify(b);

// ── 2b. ngữ cảnh láng giềng (msg 014): hạt cùng màu / chất liệu đi thành tập thể (chuỗi vàng, mảng ngọc, mảng đá đỏ)
// đồ thị: 2 hạt là láng giềng khi khoảng tâm ≤ 1.35·(r1 + r2) + 0.5 mm; "cùng cụm" khi cỡ vẽ lệch ≤ 40 %
// (b) lan truyền nhãn: hạt có độ tin riêng < 0.5 lấy nhãn đa số có trọng số (độ tin láng giềng × độ đều khoảng cách) nếu ≥ 70 % và ≥ 2
// (c) thêm hạt sót: 2 hạt cùng nhãn cùng cỡ cách nhau ~2 bước (bước = khoảng láng giềng trung vị của cặp), giữa không có hạt, ảnh tại
//     điểm giữa cùng vật liệu → thêm 1 hạt (không bịa: chỉ khi ảnh có hạt cùng chất liệu ở đó)
function matConf(b) {
  const hue = (Math.atan2(b.b, b.a) * 180) / Math.PI, m = b.cls.m4, cl = (v) => Math.max(0, Math.min(1, v));
  if (m === 'gold') return cl(Math.min((b.chroma - MAT.chromaHi) / 15, (hue - MAT.goldHue[0]) / 12, (MAT.goldHue[1] - hue) / 12) + 0.2);
  if (m === 'color') return b.chroma >= MAT.chromaHi ? cl(Math.min((b.chroma - MAT.chromaHi) / 15, (MAT.goldHue[0] - hue) / 12) + 0.2) : cl((MAT.whiteL - b.L) / 12);
  return cl(Math.min((b.L - MAT.whiteL) / 10, Math.abs(b.chroma - MAT.pearlC) / 6, Math.abs(b.edge - MAT.pearlEdge) / 0.03) + 0.1);
}
const neigh = { relabeled: [], added: [] };
if (!args.includes('--no-neigh')) {
  const nb = (list) => {
    const cell = 12 * PPM, G = new Map(), k = (x, y) => `${Math.floor(x / cell)},${Math.floor(y / cell)}`;
    list.forEach((b) => { const q = k(b.x, b.y); (G.get(q) || G.set(q, []).get(q)).push(b); });
    for (const b of list) {
      b.nb = [];
      const gx = Math.floor(b.x / cell), gy = Math.floor(b.y / cell);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) for (const t of G.get(`${gx + dx},${gy + dy}`) || []) {
        if (t === b) continue;
        const D = Math.hypot(t.x - b.x, t.y - b.y) / PPM;
        if (D <= 1.35 * (b.dMm + t.dMm) / 2 + 0.5) b.nb.push({ t, D, same: Math.max(b.dMm, t.dMm) / Math.min(b.dMm, t.dMm) <= 1.4 });
      }
    }
  };
  nb(beads);
  for (const b of beads) b.conf = matConf(b);
  for (let it = 0; it < 3; it++) {
    let ch = 0;
    for (const b of beads) {
      if (b.conf >= 0.5 || b.cls.shape !== 'round') continue;
      const v = {};
      const S = b.nb.filter((n) => n.same);
      if (S.length < 2) continue;
      const Dm = S.map((n) => n.D).sort((x, y) => x - y)[S.length >> 1];
      for (const n of S) v[n.t.cls.m4] = (v[n.t.cls.m4] || 0) + Math.max(0.2, n.t.conf ?? 0.5) * (1 / (1 + Math.abs(n.D - Dm) / Math.max(0.3, 0.15 * Dm)));
      const tot = Object.values(v).reduce((x, y) => x + y, 0), [top, w] = Object.entries(v).sort((x, y) => y[1] - x[1])[0];
      if (top !== b.cls.m4 && w >= 0.7 * tot && w >= 1) {
        neigh.relabeled.push({ x: +b.x.toFixed(1), y: +b.y.toFixed(1), from: b.cls.m4, to: top, conf: +b.conf.toFixed(2), votes: S.length });
        const own = b.cls.m4;
        b.cls = classifyAs(b, top); b.conf = 0.5; b.relabelFrom = own; ch++;
      }
    }
    if (!ch) break;
  }
  // (c) hạt sót trong chuỗi
  const up = decodePng(fs.readFileSync(UP4)), K = up.w / W;
  const mk = decodePng(fs.readFileSync(path.join(ROOT, 'kit', 'templates', 'queen_mask.png')));
  const inCostume = (x, y) => { const j = (Math.round(y) * mk.w + Math.round(x)) * 4; return mk.data[j] > 200 && mk.data[j + 1] > 200 && mk.data[j + 2] > 200; };
  const sample = (x, y, rMm) => {
    const cx = x * K, cy = y * K, R = rMm * PPM * K, Ls = [], As = [], Bs = [];
    for (let yy = Math.round(cy - R); yy <= cy + R; yy++) for (let xx = Math.round(cx - R); xx <= cx + R; xx++) {
      if ((xx - cx) ** 2 + (yy - cy) ** 2 > R * R || xx < 0 || yy < 0 || xx >= up.w || yy >= up.h) continue;
      const j = (yy * up.w + xx) * 4, [L, A, B] = lab([up.data[j], up.data[j + 1], up.data[j + 2]]); Ls.push(L); As.push(A); Bs.push(B);
    }
    const md = (v) => v.sort((p, q) => p - q)[v.length >> 1];
    const L = md(Ls), A = md(As), B = md(Bs);
    return { L, a: A, b: B, chroma: Math.hypot(A, B), edge: 0 };
  };
  const fam = (m) => (m === 'pearl' || m === 'white' ? 'w' : m);
  const add = [];
  const pairs = [];
  const cell = 12 * PPM, G = new Map(), kk = (x, y) => `${Math.floor(x / cell)},${Math.floor(y / cell)}`;
  beads.forEach((b) => { const q = kk(b.x, b.y); (G.get(q) || G.set(q, []).get(q)).push(b); });
  const near = (x, y) => { const gx = Math.floor(x / cell), gy = Math.floor(y / cell), o = []; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) o.push(...(G.get(`${gx + dx},${gy + dy}`) || [])); return o; };
  for (const b of beads) {
    if (b.cls.shape !== 'round') continue;
    const S = b.nb.filter((n) => n.same && n.t.cls.m4 === b.cls.m4);
    if (!S.length) continue;
    const p = S.map((n) => n.D).sort((x, y) => x - y)[S.length >> 1];
    for (const t of near(b.x, b.y)) {
      if (t === b || t.i < b.i || t.cls.m4 !== b.cls.m4 || t.cls.shape !== 'round' || Math.max(b.dMm, t.dMm) / Math.min(b.dMm, t.dMm) > 1.25) continue;
      const D = Math.hypot(t.x - b.x, t.y - b.y) / PPM;
      if (D < 1.75 * p || D > 2.3 * p) continue;
      pairs.push([b, t, p]);
    }
  }
  for (const [b, t, p] of pairs) {
    const x = (b.x + t.x) / 2, y = (b.y + t.y) / 2, d = (b.dMm + t.dMm) / 2;
    if (!inCostume(x, y)) continue;
    if ([...near(x, y), ...add].some((q) => Math.hypot(q.x - x, q.y - y) / PPM < 0.6 * Math.max(d, q.dMm))) continue;
    const f = sample(x, y, 0.3 * d), probe = { ...f, cls: {} };
    const m = mat4(probe);
    if (fam(m) !== fam(b.cls.m4)) continue;
    const nbd = { x, y, dMm: d, wMm: d, hMm: d, rotDeg: 0, shape: 'round', solidity: 1, ellIoU: 1, ...f, score: Math.min(b.score, t.score) * 0.9, src: 'gap-fill', i: 1e6 + add.length };
    nbd.cls = classifyAs(nbd, b.cls.m4);
    add.push(nbd);
    neigh.added.push({ x: +x.toFixed(1), y: +y.toFixed(1), m4: b.cls.m4, dMm: +d.toFixed(2), pitchMm: +p.toFixed(2) });
  }
  beads.push(...add);
}
// ── 2c. KIT-21 chuỗi hạt (captain msg 015): hạt liên tiếp cùng cỡ (±15 %), bước đều, hướng mượt = 1 chuỗi; hàng song song kề bên
// (cùng cỡ, cùng bước) = hàng xếp lớp → 1 nhóm. CỠ quyết định chuỗi (cùng cỡ dọc chuỗi = cùng loại), mỗi nhóm 1 nhãn vật liệu + 1 cỡ:
// phiếu = Σ độ tin màu + wPrior × tần suất vật liệu theo khoảng cỡ (chỉ phá hoà); chuyển màu dọc chuỗi = ánh sáng (luật gradient).
// Chuỗi vẽ chồng (bước vẽ < cỡ viên + khe) → đặt lại viên dọc đường chuỗi, bước = cỡ viên + 0.15 mm (không va chạm)
const chains = { enabled: !args.includes('--no-chains'), chains: 0, groups: 0, beadsInChains: 0, relabeled: 0, resized: 0, resampledChains: 0, removed: 0, added: 0, relabeledBy: {}, prior: {} };
if (chains.enabled) {
  const resampleMin = args.includes('--no-resample') ? Infinity : +flag('--resample-min', 4), chainSize = flag('--chain-size', 'd'), wPrior = +flag('--chain-wprior', 0.1), maxStepDE = +flag('--chain-step-de', 20), sizeTol = 1.15, pitchTol = 1.65; // bước lệch ≤ 65 % qua 1 hạt (hạt sau bị che → bước vẽ đổi)
  const sz = (b) => (b.hMm / b.wMm >= 0.6 ? b.wMm : b.dMm); // hạt cầu bị che một phần: trục dài ≈ đường kính thật
  for (const b of beads) b.conf ??= matConf(b);
  const C = beads.filter((b) => b.cls.shape === 'round' && sz(b) >= 2.2 && b.src !== 'chain');
  // tiên nghiệm vật liệu theo khoảng cỡ: hạt tròn độ tin ≥ 0.8, làm trơn +1
  const BINS = [2.2, 3, 4, 5, 6.5, 9, 99], binOf = (d) => BINS.findIndex((v, k) => d >= v && d < BINS[k + 1]), MATS = ['pearl', 'gold', 'white', 'color'];
  const cnt = BINS.slice(0, -1).map(() => Object.fromEntries(MATS.map((m) => [m, 1])));
  for (const b of C) if (b.conf >= 0.8 && binOf(sz(b)) >= 0) cnt[binOf(sz(b))][b.cls.m4]++;
  const prior = cnt.map((c) => { const t = MATS.reduce((a, m) => a + c[m], 0); return Object.fromEntries(MATS.map((m) => [m, c[m] / t])); });
  chains.prior = Object.fromEntries(prior.map((p, k) => [`${BINS[k]}-${BINS[k + 1]}`, Object.fromEntries(MATS.map((m) => [m, +p[m].toFixed(2)]))]));
  // cạnh ứng viên: cùng cỡ, khoảng tâm 0.6–1.5 × cỡ; nhận tham lam theo độ đều (|D − cỡ| / cỡ), bậc ≤ 2, không vòng,
  // qua 1 hạt hướng đổi ≤ 45° và bước lệch ≤ pitchTol
  const cell = 12 * PPM, G = new Map(), kk = (x, y) => `${Math.floor(x / cell)},${Math.floor(y / cell)}`;
  C.forEach((b, i) => { b.ci = i; const q = kk(b.x, b.y); (G.get(q) || G.set(q, []).get(q)).push(b); });
  const E = [];
  for (const b of C) {
    const gx = Math.floor(b.x / cell), gy = Math.floor(b.y / cell);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) for (const t of G.get(`${gx + dx},${gy + dy}`) || []) {
      if (t.ci <= b.ci) continue;
      const d1 = sz(b), d2 = sz(t), dm = (d1 + d2) / 2, D = Math.hypot(t.x - b.x, t.y - b.y) / PPM;
      if (Math.max(d1, d2) / Math.min(d1, d2) > sizeTol || D < 0.6 * dm || D > 1.5 * dm) continue;
      // cùng nhãn, hoặc màu chuyển dần (ΔE76 ≤ maxStepDE giữa 2 hạt kề: ánh sáng), không nối hạt vàng với đá đỏ cạnh nó
      if (b.cls.m4 !== t.cls.m4 && Math.hypot(b.L - t.L, b.a - t.a, b.b - t.b) > maxStepDE) continue;
      E.push({ a: b, b: t, D, q: Math.abs(D - dm) / dm });
    }
  }
  // hạt vẽ chồng kiểu 3D làm bước lệch cỡ → xếp cạnh theo độ thẳng của đoạn nối tiếp ở hai đầu (−cos góc a-b-c tốt nhất) trước,
  // rồi độ đều: điểm = q + (2 − tiếp(a→b) − tiếp(b→a)) / 2
  const nbE = C.map(() => []);
  for (const e of E) { nbE[e.a.ci].push([e.b, e.D]); nbE[e.b.ci].push([e.a, e.D]); }
  const cont = (a, b, D) => nbE[b.ci].reduce((best, [c, D2]) => {
    if (c === a || Math.max(D, D2) / Math.min(D, D2) > pitchTol) return best;
    const v1 = [a.x - b.x, a.y - b.y], v2 = [c.x - b.x, c.y - b.y];
    return Math.max(best, -(v1[0] * v2[0] + v1[1] * v2[1]) / Math.hypot(...v1) / Math.hypot(...v2));
  }, 0);
  for (const e of E) e.q += (2 - cont(e.a, e.b, e.D) - cont(e.b, e.a, e.D)) / 2;
  E.sort((p, q) => p.q - q.q);
  const uf = C.map((_, i) => i), find = (i) => (uf[i] === i ? i : (uf[i] = find(uf[i])));
  const adj = C.map(() => []);
  const smooth = (n, o, D) => adj[n.ci].every(({ t, D: D0 }) => {
    const v1 = [t.x - n.x, t.y - n.y], v2 = [o.x - n.x, o.y - n.y];
    const cos = (v1[0] * v2[0] + v1[1] * v2[1]) / Math.hypot(...v1) / Math.hypot(...v2);
    return cos <= -Math.cos(Math.PI / 4) && Math.max(D, D0) / Math.min(D, D0) <= pitchTol;
  });
  for (const e of E) {
    const { a: p, b: q, D } = e;
    if (adj[p.ci].length >= 2 || adj[q.ci].length >= 2 || find(p.ci) === find(q.ci)) continue;
    if (!smooth(p, q, D) || !smooth(q, p, D)) continue;
    adj[p.ci].push({ t: q, D }); adj[q.ci].push({ t: p, D }); uf[find(p.ci)] = find(q.ci);
  }
  // chuỗi = thành phần ≥ 3 hạt, xếp theo đường đi từ một đầu mút
  const comp = new Map();
  for (const b of C) if (adj[b.ci].length) { const r = find(b.ci); (comp.get(r) || comp.set(r, []).get(r)).push(b); }
  const CH = [];
  for (const L of comp.values()) {
    if (L.length < 3) continue;
    let cur = L.find((b) => adj[b.ci].length === 1) || L[0], prev = null;
    const path = [];
    while (cur) { path.push(cur); const nx = adj[cur.ci].find(({ t }) => t !== prev); prev = cur; cur = nx?.t; }
    const pitch = path.slice(1).map((b, k) => Math.hypot(b.x - path[k].x, b.y - path[k].y) / PPM).sort((x, y) => x - y);
    const ds = path.map(sz).sort((x, y) => x - y);
    const ch = { path, pitch: pitch[pitch.length >> 1], d: ds[ds.length >> 1], k: CH.length };
    for (const b of path) b.chain = ch;
    CH.push(ch);
  }
  chains.chains = CH.length; chains.beadsInChains = CH.reduce((a, c) => a + c.path.length, 0);
  const vote = (L) => {
    const v = Object.fromEntries(MATS.map((m) => [m, 0]));
    for (const b of L) { const pr = prior[binOf(sz(b))] || prior[0]; for (const m of MATS) v[m] += wPrior * pr[m]; v[b.cls.m4] += b.conf; }
    const R = Object.entries(v).sort((x, y) => y[1] - x[1]);
    return { m: R[0][0], margin: (R[0][1] - R[1][1]) / L.length, v };
  };
  // chuyển màu dọc chuỗi: nhãn tạo đúng 2 đoạn liền (mỗi đoạn ≥ 2 hạt), một đoạn trắng / ngọc và một đoạn vàng / màu, độ bão hoà
  // tăng dần → ánh sáng / phản chiếu (làm màu ấm lên, không làm nhạt đi) → cả chuỗi theo đoạn C* thấp
  const famOf = (m) => (m === 'pearl' || m === 'white' ? 'w' : 'k');
  chains.gradient = 0;
  for (const c of CH) {
    c.vote = vote(c.path);
    const runs = [];
    for (const b of c.path) { const f = famOf(b.cls.m4); if (runs.length && runs[runs.length - 1].f === f) runs[runs.length - 1].L.push(b); else runs.push({ f, L: [b] }); }
    if (runs.length !== 2 || runs.some((r) => r.L.length < 2)) continue;
    const w = runs.find((r) => r.f === 'w'), k = runs.find((r) => r.f === 'k');
    const mc = (L) => L.reduce((a, b) => a + b.chroma, 0) / L.length;
    if (!w || !k || mc(w.L) >= mc(k.L)) continue;
    const cw = {};
    for (const b of w.L) cw[b.cls.m4] = (cw[b.cls.m4] || 0) + b.conf;
    c.grad = Object.entries(cw).sort((x, y) => y[1] - x[1])[0][0];
    c.vote = { ...c.vote, m: c.grad, margin: 1 };
    chains.gradient++;
  }
  // hàng song song kề: cùng cỡ ±15 %, cùng bước ±30 %, ≥ 50 % hạt chuỗi ngắn có hạt chuỗi kia trong 1.6 bước;
  // gộp khi cùng nhãn hoặc một bên không chắc (lề phiếu < 0.35 / hạt)
  const gu = CH.map((_, i) => i), gf = (i) => (gu[i] === i ? i : (gu[i] = gf(gu[i])));
  for (const A of CH) {
    const near = new Map();
    for (const b of A.path) {
      const gx = Math.floor(b.x / cell), gy = Math.floor(b.y / cell);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) for (const t of G.get(`${gx + dx},${gy + dy}`) || []) {
        const B = t.chain;
        if (!B || B === A || B.k < A.k) continue;
        if (Math.hypot(t.x - b.x, t.y - b.y) / PPM > 1.6 * Math.max(A.pitch, B.pitch)) continue;
        (near.get(B) || near.set(B, new Set()).get(B)).add(b);
      }
    }
    for (const [B, S] of near) {
      if (Math.max(A.d, B.d) / Math.min(A.d, B.d) > sizeTol || Math.max(A.pitch, B.pitch) / Math.min(A.pitch, B.pitch) > 1.3) continue;
      if (S.size < Math.max(2, 0.5 * Math.min(A.path.length, B.path.length))) continue;
      if (A.vote.m !== B.vote.m && Math.min(A.vote.margin, B.vote.margin) >= 0.35) continue;
      gu[gf(A.k)] = gf(B.k);
    }
  }
  const groups = new Map();
  for (const c of CH) { const r = gf(c.k); (groups.get(r) || groups.set(r, []).get(r)).push(c); }
  chains.groups = groups.size;
  for (const g of groups.values()) {
    const gl = g.filter((c) => c.grad).map((c) => c.grad), L = g.flatMap((c) => c.path), V = gl.length ? { m: gl.sort((x, y) => gl.filter((v) => v === y).length - gl.filter((v) => v === x).length)[0] } : vote(L), ds = L.map(chainSize === 'w' ? sz : (b) => b.dMm).sort((x, y) => x - y), dMed = ds[ds.length >> 1];
    for (const b of L) {
      const before = `${b.cls.m4}/${b.cls.physMm}`;
      b.cls = classify({ ...b, dMm: dMed, wMm: dMed, hMm: dMed, shape: 'round' }, V.m);
      const after = `${b.cls.m4}/${b.cls.physMm}`;
      if (before.split('/')[0] !== V.m) { chains.relabeled++; const k = `${before.split('/')[0]}→${V.m}`; chains.relabeledBy[k] = (chains.relabeledBy[k] || 0) + 1; }
      else if (before !== after) chains.resized++;
      b.group = g;
    }
  }
  if (args.includes('--debug')) for (const [x, y] of CAPTAIN.row) {
    const b = C.reduce((a, t) => (Math.hypot(t.x - x, t.y - y) < Math.hypot(a.x - x, a.y - y) ? t : a), C[0]);
    console.error('captain', x, y, b.chain ? `chain ${b.chain.k} n${b.chain.path.length} pitch ${b.chain.pitch.toFixed(2)} d ${b.chain.d.toFixed(2)} vote ${b.chain.vote.m}/${b.chain.vote.margin.toFixed(2)} group ${gf(b.chain.k)} [${b.chain.path.map((p) => `${Math.round(p.x)},${Math.round(p.y)}`).join(' ')}]` : 'no chain', 'adj', adj[b.ci].length, b.cls.m4, sz(b).toFixed(2), b.conf.toFixed(2));
  }
  // đặt lại dọc chuỗi khi bước vẽ < cỡ viên + khe (hạt vẽ chồng kiểu 3D): nội suy theo độ dài cung, đặc trưng của hạt gốc gần nhất
  const add = [], drop = new Set();
  for (const c of CH) {
    const phys = c.path[0].cls.physMm, step = phys + GAP;
    if (c.pitch >= step - 0.05 || phys < resampleMin) continue;
    const P = c.path, seg = P.slice(1).map((b, k) => Math.hypot(b.x - P[k].x, b.y - P[k].y)), len = seg.reduce((a, v) => a + v, 0) / PPM;
    const n = Math.max(1, Math.floor(len / step + 1e-6)) + 1, off = (len - (n - 1) * step) / 2;
    for (const b of P) drop.add(b);
    for (let k = 0; k < n; k++) {
      let s2 = (off + k * step) * PPM, j = 0;
      while (j < seg.length - 1 && s2 > seg[j]) { s2 -= seg[j]; j++; }
      const f = seg.length ? Math.min(1, s2 / seg[j]) : 0, A = P[j], B = P[Math.min(j + 1, P.length - 1)];
      const x = A.x + f * (B.x - A.x), y = A.y + f * (B.y - A.y), src = f < 0.5 ? A : B;
      add.push({ ...src, x, y, src: 'chain-resample', i: 2e6 + add.length, chain: c });
    }
    chains.resampledChains++;
  }
  chains.removed = drop.size; chains.added = add.length;
  for (let k = beads.length - 1; k >= 0; k--) if (drop.has(beads[k])) beads.splice(k, 1);
  beads.push(...add);
}
const recQ = beads.map((b) => ({ layer: 'queen', mat: catMat(b.cls), physMm: b.cls.physMm, ...(b.cls.shape !== 'round' && { shape: b.cls.shape, w: b.cls.w, h: b.cls.h }), t: b.cls.t, one: false, gwl: 1, from: 'bead', wt: Math.max(1, (b.dMm / 2.8) ** 2) }));

if (args.includes('--analyze')) {
  // đặc trưng theo vật liệu GT (ghép tâm như scorer) — để chỉnh ngưỡng MAT
  const GTD = path.join(ROOT, 'outputs', 'kit', 'queen_gt'), rows = [];
  for (const id of ['heart', 'pearls', 'cape']) {
    const g = JSON.parse(fs.readFileSync(path.join(GTD, `${id}.json`), 'utf8'));
    for (const s of g.stones) { const b = beads.reduce((a, p) => (Math.hypot(p.x - s.x, p.y - s.y) < Math.hypot(a.x - s.x, a.y - s.y) ? p : a), beads[0]); if (Math.hypot(b.x - s.x, b.y - s.y) < 0.5 * Math.max(1.5, s.measuredMm || s.physMm) * PPM) rows.push([s.mat4, s.physMm, s.measuredMm, b]); }
  }
  const by = {};
  for (const [m, , , b] of rows) (by[m] ||= []).push(b);
  const med = (a) => { const v = a.slice().sort((x, y) => x - y); return v.length ? +v[v.length >> 1].toFixed(2) : null; };
  for (const [m, L] of Object.entries(by)) console.log(m, L.length, Object.fromEntries(['L', 'a', 'b', 'chroma', 'Lstd', 'spec', 'edge', 'dMm'].map((k) => [k, [med(L.map((b) => b[k]).filter((v) => v <= med(L.map((x) => x[k])))) , med(L.map((b) => b[k])), med(L.map((b) => b[k]).filter((v) => v >= med(L.map((x) => x[k]))))]])));
  const conf = {};
  for (const [m, , , b] of rows) { const k = `${m}→${mat4(b)}`; conf[k] = (conf[k] || 0) + 1; }
  console.log('nhầm vật liệu (GT→hạt):', conf);
  const sz = rows.map(([, p, mm, b]) => [p, mm, +b.dMm.toFixed(2)]);
  console.log('cỡ GT phys / measured / hạt dMm (20 đầu):', JSON.stringify(sz.slice(0, 20)));
  console.log('tỉ lệ measured/dMm trung vị', med(sz.filter((r) => r[1]).map((r) => r[1] / r[2])), 'phys/dMm', med(sz.map((r) => r[0] / r[2])));
}

// ── bảng mã chung với nền Starry (bản ghi trước chọn mã của Starry từ KIT-18 collect)
const STARRY = path.join(ROOT, 'outputs', 'kit', 'product_palette', 'collect_starry.json');
const recS = fs.existsSync(STARRY) ? JSON.parse(fs.readFileSync(STARRY, 'utf8')).records : [];
const isCrystal = (e) => e && !e.shape && e.kind !== 'pearl' && /clear|crystal/i.test(e.name || '') && materialOf(e) !== 'gold' && e.physMm >= 4 && (([L, a, b]) => L >= 75 && Math.hypot(a, b) <= 12)(lab(hex2(e.fill)));
// ưu tiên captain (msg 013): đúng vật liệu + hình > đúng cỡ > ΔE: đổi vật liệu cấm, hình → tròn +60, thu cỡ +20 +2/mm, rồi ΔE
const NOCROSS = { crossPenalty: 1e4, shapeToRound: 60, shapeWhitePenalty: 1e4 };
const crystals = Object.values(cat.codes).filter(isCrystal).map((e) => e.code);
// lỗi Queen với 1 bảng mã: mỗi viên → mã rẻ nhất; đếm sai vật liệu (mat4 mã ≠ mat4 hạt), sai hình, sai cỡ, không mã, ΔE TB
function errorsOf(codes) {
  const E = codes.map((c) => entryOf(c, cat)), Lb = E.map((e) => lab(hex2(e.fill)));
  const r = { material: 0, shape: 0, size: 0, noCode: 0, dE: 0, n: 0 };
  recQ.forEach((q, i) => {
    let best = null, bc = Infinity, bd = 0;
    E.forEach((e, j) => { const [c, , d] = stoneCost(q, e, Lb[j], NOCROSS); if (c < bc) { bc = c; best = e; bd = d; } });
    if (!best || !Number.isFinite(bc)) { r.noCode++; return; }
    const m4 = beads[i].cls.m4, cm = mat4Of(best.code);
    if (cm !== m4) { r.material++; const k = `${m4}${beads[i].cls.mm === 'pearlAsWhite' ? '<5mm' : ''}→${best.code}`; (r.materialBy ||= {})[k] = (r.materialBy[k] || 0) + 1; }
    if ((best.shape || 'round') !== (q.shape || 'round')) r.shape++;
    else if (best.shape ? best.physW !== q.w || best.physH !== q.h : best.physMm !== q.physMm) r.size++;
    r.dE += bd; r.n++;
  });
  r.dE = +(r.dE / Math.max(1, r.n)).toFixed(2); delete r.n;
  return r;
}
const bestPalette = (n) => crystals.map((c) => ({ crystal: c, ...jointPalette([...recQ, ...recS], cat, { maxCodes: n, fixed: [c], ...NOCROSS }) })).sort((a, b) => a.total - b.total)[0];
// bảng "thêm mã → giảm lỗi": union nền + trang phục từ minCodes tới maxCodes (sản phẩm = union + 2 mã pet; 13 lý tưởng / 15 trần)
const curve = [];
for (let n = minCodes; n <= maxCodes; n++) { const p = bestPalette(n); curve.push({ union: n, product: n + 2, crystal: p.crystal, codes: p.codes, starryDE: p.layers.starry?.meanDE, ...errorsOf(p.codes) }); }
// chọn: union nhỏ nhất mà thêm 1 mã nữa không còn giảm lỗi vật liệu + hình (≤ maxCodes); --codes N ép
// chọn số mã: ít nhất đạt lỗi vật liệu + hình nhỏ nhất của đường cong (được vượt 13 tới trần 15 chỉ vì lỗi này);
// sau đó thêm mã chỉ vì cỡ khi sản phẩm vẫn ≤ 13 và giảm ≥ 2 lỗi cỡ
const ms = (c) => c.material + c.shape, minMS = Math.min(...curve.map(ms));
let pickC = curve.find((c) => ms(c) === minMS);
for (const c of curve) if (c.union > pickC.union && c.product <= 13 && ms(c) <= ms(pickC) && c.size <= pickC.size - 2) pickC = c;
const pickN = flag('--codes') ? +flag('--codes') : pickC.union;
const runs = [bestPalette(pickN)];
const pal = runs[0], codes = pal.codes, palE = codes.map((c) => entryOf(c, cat)), palL = palE.map((e) => lab(hex2(e.fill)));

// mã từng viên: rẻ nhất trong bảng theo stoneCost; không lớp nào → bỏ
const ranked = (r) => palE.map((e, j) => [stoneCost(r, e, palL[j], NOCROSS)[0], e]).filter(([c]) => c < 1e4).sort((a, b) => a[0] - b[0]).map(([, e]) => e);
const stones = [], noCode = [];
beads.forEach((b, i) => {
  const opts = ranked(recQ[i]);
  if (!opts.length) { noCode.push({ x: b.x, y: b.y, cls: b.cls }); return; }
  // ngọc trai không vừa → đá trắng (sai vật liệu, vẫn có viên)
  const alt = b.cls.alt ? ranked({ ...recQ[i], mat: 'base', physMm: b.cls.alt.physMm }) : [];
  stones.push({ b, opts, alt, e: opts[0], rec: recQ[i] });
});
// ── 3. va chạm vật lý: to trước, rõ trước; chồng → thử mã sau (thường nhỏ hơn) cùng tâm, không thì bỏ
const geo = (s, e) => (e.shape ? { x: s.b.x, y: s.b.y, shape: e.shape, w: e.physW, h: e.physH, rot: s.b.rotDeg } : { x: s.b.x, y: s.b.y, w: e.physMm, h: e.physMm });
const R = (e) => Math.max(e.physMm, e.physW || 0, e.physH || 0) / 2;
stones.sort((p, q) => q.b.dMm - p.b.dMm || q.b.score - p.b.score); // hạt vẽ to / rõ trước (không theo cỡ catalog)
const placed = [], lost = { collision: 0, shrunk: 0 };
const cellPx = 16 * PPM, grid = new Map(), keyOf = (x, y) => `${Math.floor(x / cellPx)},${Math.floor(y / cellPx)}`;
const fits = (s, e) => {
  const gx = Math.floor(s.b.x / cellPx), gy = Math.floor(s.b.y / cellPx), A = geo(s, e);
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) for (const t of grid.get(`${gx + dx},${gy + dy}`) || []) {
    const far = Math.hypot(t.b.x - s.b.x, t.b.y - s.b.y) / PPM - R(t.e) - R(e);
    if (far >= GAP) continue;
    if (!e.shape && !t.e.shape) return false;
    if (gapMm(A, geo(t, t.e), PPM) < GAP - 1e-3) return false;
  }
  return true;
};
for (const s of stones) {
  // hạt trong nhóm chuỗi (KIT-21): cả chuỗi 1 mã → va chạm thì bỏ hạt, không thu thành mã khác (--chain-collide drop)
  const tryE = s.b.group && chainCollide === 'drop' ? [s.e] : [s.e, ...s.opts.slice(1).filter((e) => R(e) < R(s.e) - 1e-6 && (e.kind === 'pearl') === (s.e.kind === 'pearl')), ...s.alt];
  const e = tryE.find((x) => fits(s, x));
  if (!e) { lost.collision++; if (args.includes('--debug')) { const w = placed.reduce((a, t) => (Math.hypot(t.b.x - s.b.x, t.b.y - s.b.y) < Math.hypot(a.b.x - s.b.x, a.b.y - s.b.y) ? t : a), placed[0]); console.error('va chạm', JSON.stringify({ d: +(Math.hypot(w.b.x - s.b.x, w.b.y - s.b.y) / PPM).toFixed(2), lose: [s.e.code, +s.b.dMm.toFixed(1), s.b.cls.m4, s.rec.mat, s.rec.physMm, s.opts.map((e) => e.code).join()], win: [w.e.code, +w.b.dMm.toFixed(1), w.b.cls.m4] })); } continue; }
  if (e !== s.e) lost.shrunk++;
  s.e = e;
  placed.push(s);
  const k = keyOf(s.b.x, s.b.y);
  (grid.get(k) || grid.set(k, []).get(k)).push(s);
}

// ── 3b. chuỗi / viền vàng li ti (tools/kit20_chain.py: vùng vàng → đường giữa → điểm cách 3.0 mm): viên vàng 2.8 sau mọi hạt khác,
// chỉ nơi còn chỗ (hạt vàng vẽ ~1 mm không thể mỗi hạt 1 viên; 1 viên 2.8 thay ~3 hạt dọc chuỗi)
const chainF = flag('--chain'), chain = { points: 0, placed: 0, collision: 0 };
if (chainF) {
  const C = JSON.parse(fs.readFileSync(path.resolve(ROOT, chainF), 'utf8')).points;
  chain.points = C.length;
  for (const c of C) {
    const rec = { layer: 'queen', mat: 'gold', physMm: 2.8, t: [c.L, c.a, c.b], one: false, gwl: 1 };
    const s = { b: { x: c.x, y: c.y, dMm: 2.8, score: 0, rotDeg: 0, cls: { m4: 'gold', physMm: 2.8, shape: 'round' }, src: 'chain' }, rec, opts: ranked(rec), alt: [] };
    const e = s.opts.find((x) => x.physMm === 2.8 && fits(s, x));
    if (!e) {
      chain.collision++;
      if (args.includes('--debug')) { const w = placed.reduce((a, t) => (Math.hypot(t.b.x - c.x, t.b.y - c.y) < Math.hypot(a.b.x - c.x, a.b.y - c.y) ? t : a), placed[0]); const k = `${w.e.code}/${w.b.src || 'sam'}/${w.b.cls.m4}`; (chain.blockedBy ||= {})[k] = (chain.blockedBy[k] || 0) + 1; }
      continue;
    }
    s.e = e; placed.push(s); chain.placed++;
    const k = keyOf(s.b.x, s.b.y);
    (grid.get(k) || grid.set(k, []).get(k)).push(s);
  }
}

// ── 4. SVG + chấm + phủ
const src = decodePng(fs.readFileSync(UP4)), img = upscale(src, W, W);
const doc0 = buildDoc(img, placed.map((s) => ({ x: s.b.x, y: s.b.y, code: s.e.code, rot: s.e.shape ? s.b.rotDeg : 0 })), cat, PPM, MM, { mode: 'kit-20 bead-instance', seg: path.basename(SEG), method: seg.method, gapMm: GAP });
const doc = normalizeDoc({ ...doc0, source: { name: 'Trang phục Queen.png (Real-ESRGAN ×4, hạt → viên)', widthPx: W, heightPx: W }, createdAt: new Date().toISOString() });
const check = checkDesign(doc, cat);
fs.writeFileSync(path.join(OUT, 'queen.svg'), writeKitSvg(doc));
const mask = decodePng(fs.readFileSync(path.join(ROOT, 'kit', 'templates', 'queen_mask.png')));
let costPx = 0;
for (let j = 0; j < mask.w * mask.h; j++) { const r = mask.data[j * 4], g = mask.data[j * 4 + 1], b = mask.data[j * 4 + 2]; if (r > 200 && g > 200 && b > 200) costPx++; }
const areaOf = (e) => (e.shape ? (e.shape === 'marquise' ? 0.6 : e.shape === 'teardrop' ? 0.7 : 0.72) * e.physW * e.physH : (Math.PI * e.physMm ** 2) / 4);
const covered = placed.reduce((a, s) => a + areaOf(s.e), 0), costMm2 = costPx / PPM ** 2;
const detScore = scoreStones(beads.map((b) => ({ x: b.x, y: b.y, mat4: b.cls.m4, physMm: b.cls.physMm, shape: b.cls.shape })));
const mapScore = scoreStones(placed.map((s) => ({ x: s.b.x, y: s.b.y, code: s.e.code })));
// GT có 186 / 274 hạt vẽ < 2 mm (viền hạt vàng li ti ~1 mm, không thể mỗi hạt 1 viên 2.8): chấm riêng tập hạt vẽ ≥ 2 mm
const detScore2 = scoreStones(beads.map((b) => ({ x: b.x, y: b.y, mat4: b.cls.m4, physMm: b.cls.physMm, shape: b.cls.shape })), { minGtMm: 2 });
const mapScore2 = scoreStones(placed.map((s) => ({ x: s.b.x, y: s.b.y, code: s.e.code })), { minGtMm: 2 });
const tiles = (sc) => Object.fromEntries(Object.entries(sc.tiles).map(([k, v]) => [k, { gt: v.gt, map: v.map, recall: v.recall, precision: v.precision, materialOk: v.materialOk, sizeOk: v.sizeOk, shapeOk: v.shapeOk, gt4mm: v.gt4mm, gold: v.gold, wrong: v.wrong }]));
const byCode = {};
for (const s of placed) byCode[s.e.code] = (byCode[s.e.code] || 0) + 1;
const evQ = pal.layers.queen, evS = pal.layers.starry;
const report = {
  schema: 'pearl-kit20-report/1', source: 'requirements/Trang phục Queen.png', segmentation: { file: path.relative(ROOT, SEG), method: seg.method, region: seg.region, tiles: seg.tiles, seconds: seg.seconds, params: seg.params },
  instances: { masks: all.length, beadLike: cand.length, droppedParts: drop.size, beads: beads.length, noCode: noCode.length, collisionDropped: lost.collision, shrunkForGap: lost.shrunk, stones: placed.length },
  materialRule: MAT, sizeK, coverage: { costumeMm2: Math.round(costMm2), stoneMm2: Math.round(covered), pct: +((100 * covered) / costMm2).toFixed(1), note: seg.region === 'gt' ? 'chỉ 3 ô GT được tách → % phủ toàn trang phục không có nghĩa' : undefined },
  codeCurve: curve.map(({ codes, ...c }) => ({ ...c, added: codes.filter((x) => !(curve.find((d) => d.union === c.union - 1)?.codes || []).includes(x)) })),
  palette: { codes, crystal: pal.crystal, union: codes.length, maxCodes, queenCodesUsed: Object.keys(byCode).length, byCode, starryMeanDE: evS?.meanDE, queenMeanDE: evQ?.meanDE, },
  check: check.ok ? 'ok' : check.errors.slice(0, 10),
  chain: chainF ? { file: chainF, ...chain } : undefined,
  chains: { ...chains },
  // vùng ảnh captain gửi (msg 015, outputs/kit/kit20/captain_chain_5EEEE.png, tìm bằng khớp mẫu trên review.svg): hàng hạt to trước
  // (lẽ ra toàn '5') + mã mọi viên ≥ 4 mm trong khung
  captainRegion: (() => {
    const box = CAPTAIN.box, inB = (s) => s.b.x >= box[0] && s.b.y >= box[1] && s.b.x < box[0] + box[2] && s.b.y < box[1] + box[3];
    const row = CAPTAIN.row.map(([x, y]) => { const s = placed.reduce((a, t) => (Math.hypot(t.b.x - x, t.b.y - y) < Math.hypot(a.b.x - x, a.b.y - y) ? t : a), placed[0]); const d = Math.hypot(s.b.x - x, s.b.y - y) / PPM; return { x, y, code: d <= 3 ? s.e.code : null, dMm: +d.toFixed(2) }; });
    const big = {};
    for (const s of placed) if (inB(s) && Math.max(s.e.physMm || 0, s.e.physW || 0) >= 4) big[s.e.code] = (big[s.e.code] || 0) + 1;
    return { box, row, rowCodes: row.map((r) => r.code ?? '-').join(' '), bigStonesInBox: big };
  })(),
  neighbour: { enabled: !args.includes('--no-neigh'), relabeled: neigh.relabeled.length, added: neigh.added.length, relabeledBy: neigh.relabeled.reduce((a, r) => ((a[`${r.from}→${r.to}`] = (a[`${r.from}→${r.to}`] || 0) + 1), a), {}), addedBy: neigh.added.reduce((a, r) => ((a[r.m4] = (a[r.m4] || 0) + 1), a), {}),
    beforeAfter: undefined },
  score: { beads: { total: detScore.total, tiles: tiles(detScore) }, stones: { total: mapScore.total, tiles: tiles(mapScore) },
    gtDrawnAtLeast2mm: { beads: { total: detScore2.total, tiles: tiles(detScore2) }, stones: { total: mapScore2.total, tiles: tiles(mapScore2) } } },
  gtNote: 'đáp án KIT-15 outputs/kit/queen_gt/*.json (checked=false: bản nháp VLM chưa captain soát); GT có ngọc 2.8/4 mm mà catalog không có (ngọc nhỏ nhất 5 mm)',
  apiCalls: 0, seconds: 0,
};
// review: ảnh gốc + viền mảnh + ký hiệu (tools/kit_review_overlay.mjs), crop ô GT
if (!args.includes('--no-review')) {
  const bg = path.join(ROOT, 'outputs', 'kit', 'queen_template', 'input_upscaled.jpg'), rv = path.join(OUT, 'review.svg');
  execFileSync(process.execPath, [path.join(ROOT, 'tools', 'kit_review_overlay.mjs'), path.join(OUT, 'queen.svg'), bg, rv], { stdio: 'ignore' });
  const svg = fs.readFileSync(rv, 'utf8');
  report.review = { svg: rv, crops: {} };
  for (const id of ['heart', 'pearls', 'cape', 'captain']) {
    const [bx, by, bw, bh] = CAPTAIN.box, t = id === 'captain' ? { x: bx, y: by, w: bw, h: bh } : JSON.parse(fs.readFileSync(path.join(ROOT, 'outputs', 'kit', 'queen_gt', `${id}.json`), 'utf8')).tile, m = id === 'captain' ? 0 : 4 * PPM;
    const vb = `${(t.x - m).toFixed(0)} ${(t.y - m).toFixed(0)} ${(t.w + 2 * m).toFixed(0)} ${(t.h + 2 * m).toFixed(0)}`, pw = 1200, ph = Math.round((1200 * (t.h + 2 * m)) / (t.w + 2 * m));
    const cs = svg.replace(/viewBox="[^"]*"/, `viewBox="${vb}"`).replace(/ width="[^"]*" height="[^"]*"/, ` width="${pw}" height="${ph}"`);
    const f = path.join(OUT, `review_${id}.svg`), png = path.join(OUT, `review_${id}.png`);
    fs.writeFileSync(f, cs);
    try { execFileSync('rsvg-convert', ['-w', String(pw), '-h', String(ph), '-o', png, f]); report.review.crops[id] = png; fs.rmSync(f); } catch (e) { report.review.crops[id] = `rsvg-convert lỗi: ${String(e.message).slice(0, 80)}`; }
  }
}
report.seconds = +((Date.now() - t0) / 1000).toFixed(1);
// tóm tắt cho so sánh trước / sau bước láng giềng (msg 014): chạy --no-neigh --out <dir> rồi --neigh-off <dir>/neigh_summary.json
const pick = (t) => ({ recall: t.recall, precision: t.precision, materialOk: t.materialOk, sizeOk: t.sizeOk });
const nSum = { beadsGt2mm: pick(detScore2.total), stonesGt2mm: pick(mapScore2.total), beadsAll: pick(detScore.total), goldBeads: detScore.total.gold, goldStones: mapScore.total.gold, goldBeadsGt2mm: detScore2.total.gold, goldStonesGt2mm: mapScore2.total.gold, beads: beads.length, stones: placed.length };
const offF = flag('--neigh-off'), chOffF = flag('--chains-off');
nSum.captainRow = report.captainRegion.rowCodes; nSum.coveragePct = report.coverage.pct;
fs.writeFileSync(path.join(OUT, 'neigh_summary.json'), JSON.stringify(nSum) + '\n');
if (chOffF && fs.existsSync(chOffF)) report.chains.beforeAfter = { before: JSON.parse(fs.readFileSync(chOffF, 'utf8')), after: nSum };
if (offF && fs.existsSync(offF)) report.neighbour.beforeAfter = { before: JSON.parse(fs.readFileSync(offF, 'utf8')), after: nSum };
fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 1) + '\n');
const T = (s) => `recall ${s.recall} prec ${s.precision} mat ${s.materialOk} size ${s.sizeOk} shape ${s.shapeOk} | ≥4mm rec ${s.gt4mm.recall} mat ${s.gt4mm.materialOk} size ${s.gt4mm.sizeOk}`;
console.log(`${seg.method}/${seg.region}: ${all.length} mask → ${cand.length} giống hạt → ${beads.length} hạt → ${placed.length} viên (va chạm bỏ ${lost.collision}, thu cỡ ${lost.shrunk}, không mã ${noCode.length}); ${codes.length} mã chung [${codes.join(' ')}] pha lê ${pal.crystal}, Queen dùng ${Object.keys(byCode).length}; chuỗi vàng ${chain.placed}/${chain.points}; phủ ${report.coverage.pct}%; check ${check.ok ? 'ok' : 'LỖI'}`);
for (const c of report.codeCurve) console.log(`  mã ${c.union} (+pet ${c.product}) +[${c.added.join(' ')}]: sai vật liệu ${c.material}, hình ${c.shape}, cỡ ${c.size}, không mã ${c.noCode}, ΔE ${c.dE}, Starry ΔE ${c.starryDE}`);
console.log(`  hạt:  ${T(detScore.total)}`);
console.log(`  viên: ${T(mapScore.total)}`);
for (const [k, v] of Object.entries(mapScore.tiles)) console.log(`   ${k}: gt ${v.gt} map ${v.map} · ${T(v)}`);
console.log(`  GT vẽ ≥ 2 mm — hạt: ${T(detScore2.total)}`);
console.log(`  GT vẽ ≥ 2 mm — viên: ${T(mapScore2.total)}`);
for (const [k, v] of Object.entries(mapScore2.tiles)) console.log(`   ${k}: gt ${v.gt} map ${v.map} · ${T(v)}`);
