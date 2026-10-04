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
import { decodePng, encodePng } from '../lib/png.js';
import { symmetryOf, mirrorPairs, pairRate } from '../lib/kit/symmetry.js';
import { jointPalette, stoneCost } from '../lib/kit/palette.js';
import { scoreStones, mat4Of } from './score_template_gt.mjs';
import { pottsExpand } from '../lib/kit/potts.js';
import { FILL, FILL_SCHEMA, detectFill, packRegion, inPoly, inRegion, regionAreaMm2, readFillRegions, writeFillRegions } from '../lib/kit/fill.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2), flag = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const SEG = path.resolve(ROOT, flag('--seg', 'outputs/kit/kit20/seg_sam_all.json')), OUT = path.resolve(ROOT, flag('--out', 'outputs/kit/kit20'));
const UP4 = path.resolve(ROOT, flag('--img', 'outputs/kit/kit20/up4.png')); // Real-ESRGAN ×4 của ảnh nguồn (tools/kit20_segment.py cùng dùng)
// KIT-25: ảnh khác (vd Snowman) chạy cùng code, không tham số riêng: --name (tên file ra), --img, --mask none; khung captain / GT KIT-15 /
// nền Starry chỉ là phần chấm của Queen
const NAME = flag('--name', 'queen'), isQueen = NAME === 'queen', MASKF = flag('--mask', 'kit/templates/queen_mask.png');
// hàng hạt captain chỉ ra (msg 015): tâm px 3543 của 7 hạt vẽ cùng cỡ dọc đường cong, khung crop
const CAPTAIN = { box: [2093, 1504, 306, 508], row: [[2343, 1693], [2332, 1773], [2310, 1818], [2277, 1862], [2232, 1904], [2178, 1939], [2118, 1970]] };
// KIT-23 (msg 018): vùng captain góp ý trên KIT-22 (khớp mẫu trên review.svg KIT-22, px 3543): fb1 mảng ngọc, fb2 viền vàng / ngọc to,
// fb3 cột hạt vàng xếp chồng, fb4 bông hoa 5 cánh. --kit22 = tắt mọi thay đổi KIT-23 (bảng trước / sau)
const FB = { fb1: [910, 2176, 371, 377], fb2: [1841, 545, 517, 459], fb3: [2710, 1594, 434, 455], fb4: [646, 3062, 409, 360] };
const kit22 = args.includes('--kit22');
const keepShade = kit22 || args.includes('--keep-shade'); // KIT-23 tắt 2 bộ lọc fb1 (pearlShade, gapGlint)
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
let upImg0 = null, mk0;
const upImage = () => (upImg0 ||= decodePng(fs.readFileSync(UP4)));
const maskInside = () => {
  if (mk0 === undefined) { const m = MASKF === 'none' ? null : decodePng(fs.readFileSync(path.resolve(ROOT, MASKF))); mk0 = m && ((x, y) => { const j = (Math.min(m.h - 1, Math.round(y)) * m.w + Math.min(m.w - 1, Math.round(x))) * 4; return m.data[j] > 200 && m.data[j + 1] > 200 && m.data[j + 2] > 200; }); }
  return mk0;
};

// ── 1b. KIT-26 đối xứng gương (captain msg 021, lib/kit/symmetry.js): trục dọc = IoU lớn nhất giữa mask và mask lật (--sym-axis <mm> chỉnh
// tay); phần dư sau lật → vật thể 1 phía (quyền trượng, lòi ra ngoài mask lật) + vùng vẽ lệch (ΔE ảnh với ô gương > 30 sau làm mượt ±4 mm,
// vd cột giữa vẽ lệch trục). Tắt tự động khi mask lật trùng < 0.85 hoặc < 60 % ô (ngoài vật thể) giống ảnh lật, hoặc không có mask.
// Vùng "sym": cặp gương hạt trái ↔ hạt phải (≤ ½ cỡ sau lật, cỡ ≤ 1.4×, ΔE ≤ 30) = cạnh Potts rất mạnh (1 nhãn chung, §2e); hạt không
// đổi (bảng mã / GT 1 bên như cũ). Union + xuất 2 bên y hệt ở mức viên (§3e), vùng phủ xếp lại đối xứng, lượt kín (§3f).
// Vật thể / vẽ lệch: giữ nguyên pipeline cũ
const symOn = !kit22 && !args.includes('--no-sym'), symInfo = { enabled: symOn };
let sym = null;
if (!kit22) {
  sym = symmetryOf(upImage(), upImage().w / W, maskInside(), W, PPM, { ...(flag('--sym-axis') && { axisMm: +flag('--sym-axis') }), ...(args.includes('--sym-force') && { force: true }) });
  Object.assign(symInfo, { on: !!sym.on, reason: sym.reason, axisMm: sym.axisMm, axisPx: sym.axisPx && +sym.axisPx.toFixed(1), manualAxis: sym.manualAxis, maskIoU: sym.iou, score: sym.score, objAreaMm2: sym.objAreaMm2, objComps: sym.objComps, params: sym.params && { ...sym.params, axisMm: undefined } });
  if (sym.grid) { const z = {}; for (let gy = 0; gy < sym.grid.n; gy++) for (let gx = 0; gx < sym.grid.n; gx++) { const k = sym.zone((gx + 0.5) * sym.grid.cp, (gy + 0.5) * sym.grid.cp); z[k] = (z[k] || 0) + 1; } symInfo.zoneMm2 = Object.fromEntries(Object.entries(z).filter(([k]) => k !== 'out').map(([k, v]) => [k, Math.round(v / sym.params.res ** 2)])); }
}
const symAct = symOn && !!sym?.on;

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
  // KIT-23: catalog không có ngọc hình → hạt ngọc luôn tròn (ngọc 'giọt' = ngọc tròn bị che; trước đây rơi sang Z16 vàng / M038 cam)
  let shape = b.shape === 'oval' || (m4 === 'pearl' && !kit22) || b.wMm < (b.shape === 'heart' ? 6 : +flag('--shape-min', 5.5)) ? 'round' : b.shape;
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
  const mk = MASKF === 'none' ? null : decodePng(fs.readFileSync(path.resolve(ROOT, MASKF)));
  const inCostume = (x, y) => { if (!mk) return true; const j = (Math.round(y) * mk.w + Math.round(x)) * 4; return mk.data[j] > 200 && mk.data[j + 1] > 200 && mk.data[j + 2] > 200; };
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
// ── 2c0. KIT-23 motif xoay (bông hoa, captain fb4): 4–8 hạt quanh 1 hạt tâm, chạm tâm (khoảng 0.7–1.3 × tổng bán kính), cùng bán kính
// ±15 %, cách góc đều (mỗi khe lệch ≤ 35 % khe trung bình), giống nhau (cỡ ≤ 1.4×, ΔE76 ≤ 25 so với hạt mồi), tâm khác vòng (ΔE76 > 20
// hoặc cỡ lệch > 1.25×: mảng ngọc xếp lục giác không phải hoa). Hạt trong motif không vào chuỗi KIT-21 (cánh hoa không phải hàng hạt)
const dE76 = (p, q) => Math.hypot(p.L - q.L, p.a - q.a, p.b - q.b);
const motifs = [];
{
  const cell = 14 * PPM, G = new Map(), kk = (x, y) => `${Math.floor(x / cell)},${Math.floor(y / cell)}`;
  const M = beads.filter((b) => b.dMm >= 2.5 && b.src !== 'chain');
  M.forEach((b) => { const q = kk(b.x, b.y); (G.get(q) || G.set(q, []).get(q)).push(b); });
  const used = new Set(), found = [];
  for (const c of M) {
    const gx = Math.floor(c.x / cell), gy = Math.floor(c.y / cell), R = [];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) for (const t of G.get(`${gx + dx},${gy + dy}`) || []) {
      if (t === c) continue;
      const D = Math.hypot(t.x - c.x, t.y - c.y) / PPM, rs = (c.dMm + t.dMm) / 2;
      if (D >= 0.7 * rs && D <= 1.3 * rs && t.dMm >= 0.6 * c.dMm) R.push({ t, D, ang: Math.atan2(t.y - c.y, t.x - c.x) });
    }
    let best = null;
    for (const s0 of R) {
      const S = R.filter((r) => Math.max(r.t.dMm, s0.t.dMm) / Math.min(r.t.dMm, s0.t.dMm) <= 1.4 && dE76(r.t, s0.t) <= 25 && Math.abs(r.D - s0.D) <= 0.15 * s0.D);
      if (S.length < 4 || S.length > 8 || (best && S.length <= best.length)) continue;
      const A = S.map((r) => r.ang).sort((x, y) => x - y), gaps = A.map((a, k) => (k + 1 < A.length ? A[k + 1] - a : A[0] + 2 * Math.PI - a)), mg = (2 * Math.PI) / S.length;
      if (gaps.some((g) => Math.abs(g - mg) > 0.35 * mg)) continue;
      const ring = S.map((r) => r.t), md = ring.map((t) => t.dMm).sort((x, y) => x - y)[ring.length >> 1];
      const mc = { L: ring.reduce((a, t) => a + t.L, 0) / ring.length, a: ring.reduce((a, t) => a + t.a, 0) / ring.length, b: ring.reduce((a, t) => a + t.b, 0) / ring.length };
      if (dE76(c, mc) <= 20 && Math.max(c.dMm, md) / Math.min(c.dMm, md) <= 1.25) continue;
      best = ring;
    }
    if (best) found.push({ c, ring: best });
  }
  // vòng to (nhiều cánh, cánh to) trước; mỗi hạt thuộc ≤ 1 vòng
  found.sort((p, q) => q.ring.length - p.ring.length || q.ring.reduce((a, t) => a + t.dMm, 0) - p.ring.reduce((a, t) => a + t.dMm, 0));
  for (const f of found) {
    if (f.ring.some((t) => used.has(t)) || used.has(f.c)) continue;
    f.ring.forEach((t) => used.add(t)); used.add(f.c);
    const m = { k: motifs.length, centre: f.c, ring: f.ring };
    if (!kit22) for (const t of f.ring) t.motif = m;
    motifs.push(m);
  }
}

// ── 2c1. KIT-24 cánh dài (captain msg 019): motif xoay có cánh dài → cả vòng thành hình giọt (cánh chạm tâm) / marquise (không chạm),
// trục dài theo hướng tâm → ngoài, mũi giọt chỉ vào tâm. Đo trên ảnh ×4 trong hình quạt ±π/n của từng cánh: lõi = điểm ảnh giống
// màu cánh (ΔE76 ≤ 22) nối với tâm cánh; dài thân = mép ngoài lõi − bán kính hạt tâm (mũi cánh nằm dưới viền tâm), rộng = bề ngang
// lớn nhất; tỉ lệ trung vị vòng ≥ --petal-ratio → hình. Cỡ = hình catalog gần nhất (cùng chất liệu) với thân + viền vàng của cánh
// (viền = (bề ngang lõi+viền − lõi) / 2, trung vị); mọi cánh cùng 1 bán kính = max(trung vị vẽ, tâm nhỏ nhất / 2 + khe + dài / 2).
const petal = { enabled: !kit22 && !args.includes('--no-petal'), ratioMin: +flag('--petal-ratio', 1.25), motifs: [] };
if (petal.enabled && motifs.length) {
  const up = decodePng(fs.readFileSync(UP4)), K = up.w / W, st = 1 / K / PPM;
  const px = (x, y) => { const X = Math.round(x * K), Y = Math.round(y * K); if (X < 0 || Y < 0 || X >= up.w || Y >= up.h) return null; const j = (Y * up.w + X) * 4; return lab([up.data[j], up.data[j + 1], up.data[j + 2]]); };
  const isGold = (p) => { const C = Math.hypot(p[1], p[2]), h = ((Math.atan2(p[2], p[1]) * 180) / Math.PI + 360) % 360; return h >= 55 && h <= 100 && C >= 30 && p[0] >= 40; };
  const med = (v) => [...v].sort((x, y) => x - y)[v.length >> 1];
  const grow = (t, c, n, rc, rim) => {
    const ang = Math.atan2(t.y - c.y, t.x - c.x), ux = Math.cos(ang), uy = Math.sin(ang), R0 = Math.hypot(t.x - c.x, t.y - c.y) / PPM;
    const sd = []; for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) sd.push(px(t.x + dx / K, t.y + dy / K));
    const md = [0, 1, 2].map((k) => med(sd.map((p) => p[k])));
    const ok = (p) => Math.hypot(p[0] - md[0], p[1] - md[1], p[2] - md[2]) <= 22 || (rim && isGold(p));
    const key = (r, u) => `${Math.round(r / st)},${Math.round(u / st)}`, seen = new Set([key(R0, 0)]), q = [[R0, 0]], P = [];
    while (q.length) {
      const [r, u] = q.pop(); P.push([r, u]);
      for (const [dr, du] of [[st, 0], [-st, 0], [0, st], [0, -st]]) {
        const r2 = r + dr, u2 = u + du, k = key(r2, u2); if (seen.has(k)) continue; seen.add(k);
        if (r2 < rc || r2 > 2.2 * R0 || Math.abs(Math.atan2(u2, r2)) > Math.PI / n) continue;
        const p = px(c.x + (r2 * ux - u2 * uy) * PPM, c.y + (r2 * uy + u2 * ux) * PPM); if (!p || !ok(p)) continue;
        q.push([r2, u2]);
      }
    }
    const rs = P.map((p) => p[0]).sort((x, y) => x - y), r0 = rs[Math.floor(rs.length * 0.01)], r1 = rs[Math.floor(rs.length * 0.99)];
    const widthAt = (r) => { const T = P.filter((p) => Math.abs(p[0] - r) < 0.3).map((p) => p[1]); return T.length ? Math.max(...T) - Math.min(...T) : 0; };
    const ws = Array.from({ length: 9 }, (_, k) => widthAt(r0 + ((r1 - r0) * (k + 1)) / 10)), wmax = Math.max(...ws);
    return { ang, ux, uy, R0, r0, r1, wmax, rWide: r0 + ((r1 - r0) * (ws.indexOf(wmax) + 1)) / 10, widthAt };
  };
  for (const m of motifs) {
    const c = m.centre, n = m.ring.length, rc = c.dMm / 2;
    const ms = m.ring.map((t) => ({ t, core: grow(t, c, n, rc, false), rim: grow(t, c, n, rc, true) }));
    const Lb = med(ms.map((q) => q.core.r1 - rc)), Wc = med(ms.map((q) => q.core.wmax)), ratio = Lb / Wc;
    const rim = Math.min(1.5, Math.max(0, (med(ms.map((q) => q.rim.widthAt(q.core.rWide))) - Wc) / 2)), touch = med(ms.map((q) => q.core.r0 - rc)) <= 1;
    const rep = { centre: [Math.round(c.x), Math.round(c.y)], n, ratio: +ratio.toFixed(2), ratios: ms.map((q) => +((q.core.r1 - rc) / q.core.wmax).toFixed(2)), bodyMm: [+Wc.toFixed(2), +Lb.toFixed(2)], rimMm: +rim.toFixed(2), touch, before: m.ring.map((t) => t.cls.shape === 'round' ? `${t.cls.m4}/${t.cls.physMm}` : `${t.cls.shape} ${t.cls.w}x${t.cls.h}`) };
    petal.motifs.push(rep);
    if (ratio < petal.ratioMin) { rep.shape = 'round'; continue; }
    const shape = touch ? 'teardrop' : 'marquise', rIn = touch ? SZ[c.cls.m4][0] / 2 + GAP : med(ms.map((q) => q.core.r0)) - rim;
    const Lout = med(ms.map((q) => q.core.r1)) + rim - rIn, Wout = Wc + 2 * rim, R0 = med(ms.map((q) => q.core.R0));
    rep.outlineMm = [+Wout.toFixed(2), +Lout.toFixed(2)]; rep.shape = shape; rep.shiftMm = [];
    for (const q of ms) {
      const t = q.t, cls0 = t.cls;
      const tt = { ...t, shape, wMm: Lout, hMm: Wout };
      const cl = classify(tt, cls0.m4 === 'pearl' ? 'white' : cls0.m4);
      if (cl.shape !== shape) { rep.shape = `round (${shape} không vừa catalog)`; break; }
      t.shape = shape; t.wMm = Lout; t.hMm = Wout; t.cls = cl; t.petal = rep;
    }
    if (!m.ring.every((t) => t.petal === rep)) { for (const t of m.ring) if (t.petal === rep) delete t.petal; continue; }
    const H = m.ring[0].cls.h, R = Math.max(R0, shape === 'teardrop' ? SZ[c.cls.m4][0] / 2 + GAP + H / 2 : R0);
    for (const q of ms) {
      const t = q.t, x = c.x + R * q.core.ux * PPM, y = c.y + R * q.core.uy * PPM;
      rep.shiftMm.push(+(Math.hypot(x - t.x, y - t.y) / PPM).toFixed(2));
      t.x = x; t.y = y; t.rotDeg = (Math.atan2(q.core.ux, -q.core.uy) * 180) / Math.PI; // +v cục bộ (mũi giọt) → −u (về tâm)
    }
    rep.radiusMm = +R.toFixed(2); rep.after = m.ring.map((t) => `${t.cls.shape} ${t.cls.w}x${t.cls.h}`);
  }
}

// ── 2c2. KIT-25 vùng phủ (lib/kit/fill.js, captain msg 020): hạt nhỏ dày 2 chiều cùng chất liệu (+ màu), vùng đủ rộng (≥ 1.6 hạt) và
// méo (CV cỡ, hạt vỡ, nhỏ hơn catalog) hoặc đặc (≥ 80 % hạt ≥ 3 láng giềng) → hạt mồi; vùng nở trên ảnh theo màu (SAM sót hạt nơi vẽ
// dày); mỗi vùng chỉ giữ đa giác + chất liệu + màu + cỡ catalog. Hạt nhỏ cùng chất liệu trong đa giác bỏ khỏi pipeline chi tiết; viên
// vùng phủ xếp SAU mọi viên chi tiết (§3d). Vùng ghi ra file sửa tay (kit/templates/<name>_fill_regions.json); rerun đọc file
// (--fill-detect = dò lại; file checked không bị ghi đè → <out>/fill_regions.detected.json)
const fillOn = !kit22 && !args.includes('--no-fill');
const FILLF = path.resolve(ROOT, flag('--fill-regions', `kit/templates/${NAME}_fill_regions.json`));
const fillInfo = { enabled: fillOn, file: path.relative(ROOT, FILLF), source: null, beadsRemoved: 0, stat: null };
let fillRegions = [], fillRemoved = []; // hạt bỏ khỏi pipeline chi tiết vì nằm trong vùng phủ (vẫn dùng cho lọc viền vàng / ánh khe như KIT-24)
const fillMember = (b, r) => (b.cls.shape || 'round') === 'round' && !b.motif && !b.petal && b.dMm <= FILL.maxBeadMm && b.cls.m4 === (r.beadMaterial || r.material) && inRegion(b.x, b.y, r);
if (fillOn) {
  let doc;
  if (fs.existsSync(FILLF) && !args.includes('--fill-detect')) { doc = readFillRegions(FILLF); fillInfo.source = 'file'; }
  else {
    const upF = upImage(), inside = maskInside();
    // KIT-26: đường tâm viền vàng (tools/kit20_chain.py) chặn vùng nở (viền / khung vương miện / quyền trượng không thành vùng phủ);
    // lọc như §3b: điểm C* ≥ 47 hoặc dải rộng ≥ 1 mm, không nằm trong lòng 1 hạt vẽ không phải vàng (bóng ấm giữa ngọc)
    const nonGoldB = beads.filter((b) => b.cls.m4 !== 'gold');
    const blockPts = flag('--chain') ? JSON.parse(fs.readFileSync(path.resolve(ROOT, flag('--chain')), 'utf8')).points.filter((c) => (Math.hypot(c.a, c.b) >= 47 || c.widthMm >= 1) && !nonGoldB.some((b) => Math.hypot(b.x - c.x, b.y - c.y) / PPM < 0.5 * b.dMm)).map((c) => ({ x: c.x, y: c.y, rMm: 1.4 })) : [];
    const det = detectFill(beads, (m4) => SZ[m4] || [], { ppm: PPM, image: upF, imageK: upF.w / W, inside, blockPts });
    det.stat.blockPts = blockPts.length;
    fillInfo.stat = det.stat; fillInfo.source = 'detect';
    doc = { schema: FILL_SCHEMA, image: path.relative(ROOT, UP4), canvasPx: W, canvasMm: MM, checked: false,
      note: 'sửa tay: polygon (px canvas 3543 = 300 mm), holes (vòng lỗ bên trong, không đính), material (viên), physMm, code (null = theo bảng mã), angleDeg, packPitchMm (null = đính kín cỡ + 0.15 mm; lớn hơn = khoan thưa), enabled; đặt checked: true khi captain duyệt; rerun đọc file này, --fill-detect dò lại (file checked không bị ghi đè)',
      params: FILL, createdAt: new Date().toISOString(), regions: det.regions };
    const target = fs.existsSync(FILLF) && readFillRegions(FILLF).checked ? path.join(OUT, 'fill_regions.detected.json') : FILLF;
    fs.mkdirSync(path.dirname(target), { recursive: true });
    writeFillRegions(target, doc); fillInfo.written = path.relative(ROOT, target);
  }
  fillInfo.checked = !!doc.checked;
  fillRegions = doc.regions.filter((r) => r.enabled !== false).map((r) => ({ ...r }));
  const take = new Set();
  for (const r of fillRegions) {
    r.members = beads.filter((b) => !take.has(b) && fillMember(b, r));
    r.members.forEach((b) => take.add(b));
    r.packed = packRegion(r, { ppm: PPM, gapMm: GAP, clip: maskInside() || undefined });
  }
  fillInfo.beadsRemoved = take.size; fillRemoved = [...take];
  for (let k = beads.length - 1; k >= 0; k--) if (take.has(beads[k])) beads.splice(k, 1);
}
// đa giác vùng phủ để chấm GT "vùng chi tiết" (cả khi --no-fill: --fill-eval <file>)
const evalPolys = fillOn ? fillRegions : flag('--fill-eval') ? readFillRegions(path.resolve(ROOT, flag('--fill-eval'))).regions.filter((r) => r.enabled !== false) : [];

// ── 2c. KIT-21 chuỗi hạt (captain msg 015): hạt liên tiếp cùng cỡ (±15 %), bước đều, hướng mượt = 1 chuỗi; hàng song song kề bên
// (cùng cỡ, cùng bước) = hàng xếp lớp → 1 nhóm. CỠ quyết định chuỗi (cùng cỡ dọc chuỗi = cùng loại), mỗi nhóm 1 nhãn vật liệu + 1 cỡ:
// phiếu = Σ độ tin màu + wPrior × tần suất vật liệu theo khoảng cỡ (chỉ phá hoà); chuyển màu dọc chuỗi = ánh sáng (luật gradient).
// Chuỗi vẽ chồng (bước vẽ < cỡ viên + khe) → đặt lại viên dọc đường chuỗi, bước = cỡ viên + 0.15 mm (không va chạm)
const chains = { enabled: !args.includes('--no-chains'), chains: 0, groups: 0, beadsInChains: 0, relabeled: 0, resized: 0, resampledChains: 0, removed: 0, added: 0, relabeledBy: {}, prior: {} };
if (chains.enabled) {
  const resampleMin = +flag('--resample-min', Infinity), // KIT-22: mặc định giữ vị trí vẽ (KIT-21 = --resample-min 4)
  taperTol = +flag('--taper', 1.45), chainSize = flag('--chain-size', 'd'), wPrior = +flag('--chain-wprior', 0.1), maxStepDE = +flag('--chain-step-de', 20), sizeTol = 1.15, pitchTol = 1.65; // bước lệch ≤ 65 % qua 1 hạt (hạt sau bị che → bước vẽ đổi)
  const sz = (b) => (b.hMm / b.wMm >= 0.6 ? b.wMm : b.dMm); // hạt cầu bị che một phần: trục dài ≈ đường kính thật
  for (const b of beads) b.conf ??= matConf(b);
  const C = beads.filter((b) => b.cls.shape === 'round' && sz(b) >= 2.2 && b.src !== 'chain' && !b.motif);
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
      // KIT-22: chuỗi thu nhỏ dần (hàng xa hơn): cạnh lệch cỡ tới taperTol được nếu màu không mâu thuẫn (cùng nhãn hoặc ΔE ≤ maxStepDE)
      const rr = Math.max(d1, d2) / Math.min(d1, d2), taper = rr > sizeTol;
      if (rr > taperTol || D < 0.6 * dm || D > 1.5 * dm) continue;
      // cùng nhãn, hoặc màu chuyển dần (ΔE76 ≤ maxStepDE giữa 2 hạt kề: ánh sáng), không nối hạt vàng với đá đỏ cạnh nó
      if (b.cls.m4 !== t.cls.m4 && Math.hypot(b.L - t.L, b.a - t.a, b.b - t.b) > maxStepDE) continue;
      E.push({ a: b, b: t, D, q: Math.abs(D - dm) / dm + (taper ? 0.3 : 0), taper }); // cạnh cùng cỡ trước
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
      const dB = chainSize === 'own' || Math.max(b.dMm, dMed) / Math.min(b.dMm, dMed) > sizeTol ? b.dMm : dMed; // own: chỉ nhãn theo nhóm, cỡ từng hạt
      b.cls = classify({ ...b, dMm: dB, wMm: dB, hMm: dB, shape: 'round' }, V.m);
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
// KIT-25: mỗi vùng phủ = 1 bản ghi, trọng số = số viên xếp được → bảng mã chọn chung với hạt chi tiết
const recF = fillRegions.map((r) => ({ layer: 'queen', mat: catMat({ mm: r.material, m4: r.material, physMm: r.physMm }), physMm: r.physMm, t: r.lab, one: false, gwl: 1, from: 'fill', wt: r.packed.points.length }));

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
const recS = isQueen && fs.existsSync(STARRY) ? JSON.parse(fs.readFileSync(STARRY, 'utf8')).records : [];
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
const bestPalette = (n) => crystals.map((c) => ({ crystal: c, ...jointPalette([...recQ, ...recF, ...recS], cat, { maxCodes: n, fixed: [c], ...NOCROSS }) })).sort((a, b) => a.total - b.total)[0];
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
const pal0 = bestPalette(pickN);
// KIT-23 (captain fb2): ngọc to (~8 mm) và nhỏ cùng ra '5' vì bảng chỉ có 1 mã ngọc → thêm mã ngọc mỗi cỡ catalog có ≥ --pearl-min hạt
// ngọc (cỡ đã snap), rồi gộp xuống ≤ maxCodes bằng chi phí map_generator (SPEC §2 bước 8, như mergePalette): bỏ mã a rẻ nhất, viên của a
// sang mã rẻ nhất còn lại; chi phí = Σ trọng số · (ΔE00² mới − ΔE00² cũ + 25² nếu nhỏ đi). Mã ngọc mới cũng dự gộp (= lợi của nó thấp
// hơn chi phí gộp mã khác thì bị gộp lại); giữ cứng: pha lê + mã ngọc đã có (--pearl-keep: giữ cả mã ngọc mới, đúng chữ captain)
const pearlHist = {};
for (const b of beads) if (b.cls.m4 === 'pearl' && b.cls.shape === 'round') pearlHist[b.cls.physMm] = (pearlHist[b.cls.physMm] || 0) + 1;
const pearlMin = +flag('--pearl-min', 5);
const pearlAdd = kit22 || args.includes('--no-pearl-codes') ? [] : Object.entries(pearlHist).filter(([mm, n]) => n >= pearlMin && cat.codes[String(+mm)]?.kind === 'pearl' && !pal0.codes.includes(String(+mm))).map(([mm]) => String(+mm));
function mergeDown(start, keep, n) {
  const E = (c) => entryOf(c, cat), Lb = new Map(start.map((c) => [c, lab(hex2(E(c).fill))])), grp = new Map();
  for (const r of [...recQ, ...recF, ...recS]) {
    const k = [r.layer, r.mat, r.physMm, r.shape || '', r.w || '', r.h || '', r.one ? 1 : 0, r.gwl, ...r.t.map((v) => Math.round(v))].join('|'), g = grp.get(k);
    if (g) { g.n += r.wt ?? 1; g.c++; } else grp.set(k, { r, n: r.wt ?? 1, c: 1 });
  }
  const G = [...grp.values()];
  const cost = G.map((g) => Object.fromEntries(start.map((c) => { const [v, , d] = stoneCost(g.r, E(c), Lb.get(c), NOCROSS); return [c, v < 1e4 ? { v, d: d ?? 0 } : null]; })));
  const bestIn = (gi, S) => { let a = null; for (const c of S) { const x = cost[gi][c]; if (x && (!a || x.v < a.x.v)) a = { c, x }; } return a; };
  let set = start.slice();
  const history = [];
  while (set.length > n) {
    let best = null, best0 = null;
    for (const a of set) {
      if (keep.includes(a)) continue;
      const S2 = set.filter((c) => c !== a), to = {};
      let mc = 0, cnt = 0, q = 0;
      G.forEach((g, gi) => {
        const cur = bestIn(gi, set);
        if (!cur || cur.c !== a) return;
        const nx = bestIn(gi, S2), lay = g.r.layer;
        cnt += g.c; if (lay === 'queen') q += g.c;
        if (!nx) { mc += g.n * 1e4; to['-'] = (to['-'] || 0) + g.c; return; }
        mc += g.n * (nx.x.d ** 2 - cur.x.d ** 2 + ((E(nx.c).physMm || 0) < (E(a).physMm || 0) - 1e-6 ? 625 : 0));
        to[nx.c] = (to[nx.c] || 0) + g.c;
      });
      (best0 ||= []).push({ a, cost: Math.round(mc) });
      if (!best || mc < best.mc) best = { a, mc, cnt, q, to };
    }
    set = set.filter((c) => c !== best.a);
    history.push({ removed: best.a, records: best.cnt, queen: best.q, into: best.to, cost: Math.round(best.mc), next: best0.sort((x, y) => x.cost - y.cost).slice(1, 4) });
  }
  return { codes: set, history };
}
const pearlKeep = args.includes('--pearl-keep') ? pearlAdd : [];
const merged = pearlAdd.length ? mergeDown([...pal0.codes, ...pearlAdd], [pal0.crystal, ...pal0.codes.filter((c) => cat.codes[c]?.kind === 'pearl'), ...pearlKeep], maxCodes) : { codes: pal0.codes, history: [] };
const pal = merged.codes.join() !== pal0.codes.join() ? { ...jointPalette([...recQ, ...recF, ...recS], cat, { maxCodes: merged.codes.length, cands: merged.codes, fixed: merged.codes, ...NOCROSS }), crystal: pal0.crystal } : pal0;
const codes = pal.codes, palE = codes.map((c) => entryOf(c, cat)), palL = palE.map((e) => lab(hex2(e.fill)));
const paletteMerge = { pearlHist, pearlMin, before: pal0.codes, added: pearlAdd, history: merged.history, after: codes, errorsBefore: errorsOf(pal0.codes), errorsAfter: errorsOf(codes) };

// mã từng viên: rẻ nhất trong bảng theo stoneCost; không lớp nào → bỏ
const ranked = (r) => palE.map((e, j) => [stoneCost(r, e, palL[j], NOCROSS)[0], e]).filter(([c]) => c < 1e4).sort((a, b) => a[0] - b[0]).map(([, e]) => e);
// ── 2e. KIT-23 MRF / Potts (captain msg 018, thay vá từng bước): nút = hạt, nhãn = mã trong bảng (mã ⇒ chất liệu + hình + cỡ catalog)
// U = stoneCost(hạt coi là chất liệu của mã, mã) / 20 (ΔE + thu cỡ + hình → tròn) + đổi chất liệu α·(0.5 + độ tin)
//     + cỡ λ·|ln(cỡ mã / cỡ hạt)| + chật: mã to hơn khoảng trống tới láng giềng mạnh j (2·(khoảng tâm − khe + nudge) − cỡ nhãn đầu của j) và to hơn cỡ nhỏ nhất cùng
//       chất liệu trong bảng:
//       1 + κ·(cỡ − max(khoảng trống, cỡ nhỏ nhất))
// cạnh Potts theo tương phản: láng giềng không gian (khoảng tâm ≤ 0.75·(d1 + d2), ~Delaunay) w = β·g_cỡ·g_chất·exp(−ΔE76² / 2σ²),
//   g_cỡ = 1 khi cỡ ≤ 1.2×, 0 khi ≥ 1.25× (ngọc to / nhỏ tách); g_chất = 1 cùng chất liệu, 0.5 ngọc / trắng, 0.1 khác; cạnh cấu trúc γ:
//   hạt liền nhau trong chuỗi / cột KIT-21 (½ khi cạnh thu cỡ dần); cánh cùng motif xoay: mọi cặp w_motif (1.5; 5 cánh → 6 / cánh,
//   hơn phạt hình → tròn 3 + thu cỡ của cánh giọt). Alpha-expansion.
// Cạnh "mạnh" (cấu trúc hoặc w ≥ β/2) = cặp cùng cấu trúc của chỉ số consistency
const MRF = { alpha: +flag('--mrf-alpha', 3), beta: +flag('--mrf-beta', 1), gamma: +flag('--mrf-gamma', 2), motif: +flag('--mrf-motif', 1.5), mirror: +flag('--mrf-mirror', 8), sigma: +flag('--mrf-sigma', 12), scale: 20, kappa: 2, size: +flag('--mrf-size', 1), fam: +flag('--mrf-fam', 1), cap: !args.includes('--no-cap') };
const mrfOn = !kit22 && !args.includes('--no-mrf'), nudge0 = +flag('--nudge', 0.2);
const famM = (m) => (m === 'pearl' || m === 'white' ? 'w' : m);
const graph = new Map(), BI = new Map(beads.map((b, k) => [b, k]));
const edge = (i, j, kind, w) => {
  if (i === j || !(w > 0)) return;
  const a = Math.min(i, j), c = Math.max(i, j), key = `${a},${c}`, g = graph.get(key) || graph.set(key, { i: a, j: c, ws: 0, wc: 0, kinds: new Set() }).get(key);
  if (kind === 'spatial') g.ws = Math.max(g.ws, w); else g.wc = Math.max(g.wc, w);
  g.kinds.add(kind);
};
{
  const cell = 12 * PPM, G = new Map(), kk = (x, y) => `${Math.floor(x / cell)},${Math.floor(y / cell)}`;
  beads.forEach((b, k) => { const q = kk(b.x, b.y); (G.get(q) || G.set(q, []).get(q)).push(k); });
  beads.forEach((b, k) => {
    const gx = Math.floor(b.x / cell), gy = Math.floor(b.y / cell);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) for (const j of G.get(`${gx + dx},${gy + dy}`) || []) {
      if (j <= k) continue;
      const t = beads[j], D = Math.hypot(t.x - b.x, t.y - b.y) / PPM;
      if (D > 0.75 * (b.dMm + t.dMm)) continue;
      const sr = Math.max(b.dMm, t.dMm) / Math.min(b.dMm, t.dMm), gs = sr <= 1.2 ? 1 : sr >= 1.25 ? 0 : (1.25 - sr) / 0.05;
      const gm = b.cls.m4 === t.cls.m4 ? 1 : famM(b.cls.m4) === famM(t.cls.m4) ? 0.5 : 0.1;
      edge(k, j, 'spatial', MRF.beta * gs * gm * Math.exp(-(dE76(b, t) ** 2) / (2 * MRF.sigma ** 2)));
    }
  });
  for (const ch of new Set(beads.map((b) => b.chain).filter(Boolean))) for (let q = 1; q < ch.path.length; q++) {
    const a = ch.path[q - 1], c = ch.path[q];
    if (BI.has(a) && BI.has(c)) edge(BI.get(a), BI.get(c), 'chain', MRF.gamma * (Math.max(a.dMm, c.dMm) / Math.min(a.dMm, c.dMm) > 1.15 ? 0.5 : 1));
  }
  for (const m of motifs) for (let p = 0; p < m.ring.length; p++) for (let q = p + 1; q < m.ring.length; q++) if (BI.has(m.ring[p]) && BI.has(m.ring[q])) edge(BI.get(m.ring[p]), BI.get(m.ring[q]), 'motif', MRF.motif);
}
const strong = (g) => g.wc > 0 || g.ws >= 0.5 * MRF.beta;
// KIT-26 cặp gương trên tập hạt cuối (sau láng giềng / chuỗi / vùng phủ): hạt trái ↔ hạt phải
const symPairs = symAct ? mirrorPairs(beads, sym, PPM, { axisTol: (a) => 0.3 * a.dMm, tol: (a, b) => 0.5 * Math.max(a.dMm, b.dMm), same: (a, b) => Math.max(a.dMm, b.dMm) / Math.min(a.dMm, b.dMm) <= 1.4 && Math.hypot(a.L - b.L, a.a - b.a, a.b - b.b) <= 30 }) : [];
if (symAct) symInfo.beadPairs = { beads: beads.length, pairs: symPairs.length, pairedPct: +((200 * symPairs.length) / Math.max(1, beads.filter((b) => sym.zone(b.x, b.y) === 'sym').length)).toFixed(1) };
const nB = beads.length, Lc = palE.length, U = new Float64Array(nB * Lc).fill(Infinity), clsM = [], clsR = [];
const recFrom = (c) => ({ layer: 'queen', mat: catMat(c), physMm: c.physMm, ...(c.shape !== 'round' && { shape: c.shape, w: c.w, h: c.h }), t: c.t, one: false, gwl: 1, from: 'bead' });
const capD = new Float64Array(nB).fill(Infinity), R0 = (e) => Math.max(e.physMm, e.physW || 0, e.physH || 0);
const unaryAll = (withCap) => beads.forEach((b, k) => {
  const own = b.cls.m4, conf = b.group || b.motif ? Math.max(b.conf ?? 0.5, 0.8) : b.conf ?? matConf(b), cm = {}, cr = {};
  palE.forEach((e, j) => {
    const mE = mat4Of(e.code);
    let c = (cm[mE] ??= mE === own ? b.cls : classify(b, mE)), v = stoneCost(recFrom(c), e, palL[j], NOCROSS)[0];
    // hạt hình (giọt / marquise) nhận mã tròn được, phạt như stoneCost hình → tròn (60 / 20 = 3): cánh hoa giọt + cánh tròn → 1 nhãn
    if (c.shape !== 'round' && !e.shape) {
      const r = (cr[mE] ??= classify({ ...b, shape: 'round' }, mE)), v2 = stoneCost(recFrom(r), e, palL[j], NOCROSS)[0] + NOCROSS.shapeToRound;
      if (!(v < 1e4) || v2 < v) { c = r; v = v2; }
    }
    if (!(v < 1e4)) return;
    // + cỡ: λ·|ln(cỡ mã / cỡ catalog của hạt)| (stoneCost thu cỡ gần phẳng: 8 → 2.8 chỉ đắt hơn 8 → 6 một chút)
    let u = v / MRF.scale + (mE === own ? 0 : MRF.alpha * (famM(mE) === famM(own) ? MRF.fam : 1) * (0.5 + conf)) + (e.shape || c.shape !== 'round' ? 0 : MRF.size * Math.abs(Math.log(e.physMm / c.physMm)));
    if (withCap && !e.shape && e.physMm > capD[k] + 1e-6) {
      const lo = Math.min(...palE.filter((e2) => !e2.shape && mat4Of(e2.code) === mE && (e2.kind === 'pearl') === (e.kind === 'pearl')).map((e2) => e2.physMm));
      if (e.physMm > lo + 1e-6) u += 1 + MRF.kappa * (e.physMm - Math.max(capD[k], lo)); // cỡ nhỏ nhất cùng chất liệu không bị phạt (ngọc 5)
    }
    U[k * Lc + j] = u;
  });
  clsM[k] = cm; clsR[k] = cr;
});
const argmin = (k) => { let b = 0; for (let l = 1; l < Lc; l++) if (U[k * Lc + l] < U[k * Lc + b]) b = l; return b; };
unaryAll(false);
if (MRF.cap) {
  // khoảng trống: viên k cỡ x không chạm j (đang ở nhãn đầu, cỡ s_j) khi x ≤ 2·(D − khe + nudge) − s_j
  const a0 = Int32Array.from({ length: nB }, (_, k) => argmin(k)), s0 = Float64Array.from({ length: nB }, (_, k) => (Number.isFinite(U[k * Lc + a0[k]]) ? R0(palE[a0[k]]) : 0));
  // chỉ láng giềng mạnh có nhãn đầu cùng chất liệu (mảng / cột cùng loại xếp khít), không phải hạt khác loại kề bên
  for (const g of graph.values()) if (strong(g) && mat4Of(codes[a0[g.i]]) === mat4Of(codes[a0[g.j]]) && !palE[a0[g.i]].shape && !palE[a0[g.j]].shape) {
    const D = Math.hypot(beads[g.i].x - beads[g.j].x, beads[g.i].y - beads[g.j].y) / PPM, f = 2 * (D - GAP + nudge0); // viên đặt sau đẩy ≤ nudge
    capD[g.i] = Math.min(capD[g.i], f - s0[g.j]); capD[g.j] = Math.min(capD[g.j], f - s0[g.i]);
  }
  U.fill(Infinity); unaryAll(true);
}
const mrf = { enabled: mrfOn, params: MRF, nodes: nB, edges: graph.size, strongEdges: [...graph.values()].filter(strong).length, motifs: motifs.length, motifBeads: motifs.reduce((a, m) => a + m.ring.length, 0) };
let labels = null;
if (mrfOn) {
  const init = Int32Array.from({ length: nB }, (_, k) => argmin(k));
  // KIT-26: cặp gương (hạt chủ ↔ bản gương, cùng mid) = cạnh rất mạnh → 1 nhãn (không tính vào consistency)
  const mirE = symPairs.map(([a, c]) => [a, c, MRF.mirror]);
  mrf.mirrorEdges = mirE.length;
  const r = pottsExpand({ n: nB, L: Lc, unary: U, edges: [...[...graph.values()].map((g) => [g.i, g.j, Math.max(g.ws, g.wc)]), ...mirE], init });
  labels = r.labels;
  mrf.energy = { init: +r.history[0].toFixed(1), final: +r.energy.toFixed(1) }; mrf.cycles = r.cycles;
  const by = {};
  let ch = 0;
  for (let k = 0; k < nB; k++) if (labels[k] !== init[k]) { ch++; const key = `${codes[init[k]]}→${codes[labels[k]]}`; by[key] = (by[key] || 0) + 1; }
  mrf.changed = ch; mrf.changedBy = Object.fromEntries(Object.entries(by).sort((x, y) => y[1] - x[1]).slice(0, 16));
}
if (flag('--debug-bead')) {
  const [dx, dy] = flag('--debug-bead').split(',').map(Number), k = beads.reduce((a, b, i) => (Math.hypot(b.x - dx, b.y - dy) < Math.hypot(beads[a].x - dx, beads[a].y - dy) ? i : a), 0);
  console.error('bead', k, beads[k].cls, 'cap', capD[k], 'U', codes.map((c, j) => `${c}:${U[k * Lc + j].toFixed(2)}`).join(' '), 'label', labels && codes[labels[k]], 'edges', [...graph.values()].filter((g) => g.i === k || g.j === k).map((g) => `${g.i === k ? g.j : g.i}:${g.ws.toFixed(2)}/${g.wc.toFixed(2)}`).join(' '));
}
// hạt "neo": có láng giềng mạnh cùng nhãn → va chạm thì chỉ đẩy ≤ nudge rồi bỏ, không đổi mã (giữ nhất quán); --mrf-fallback = như KIT-22
const anchor = new Uint8Array(nB);
if (labels && !args.includes('--mrf-fallback')) for (const g of graph.values()) if (strong(g) && labels[g.i] === labels[g.j]) anchor[g.i] = anchor[g.j] = 1;
mrf.relabeledMaterial = 0; mrf.relabeledBy = {};
const stones = [], noCode = [];
beads.forEach((b, i) => {
  let opts = ranked(recQ[i]);
  if (labels && Number.isFinite(U[i * Lc + labels[i]])) {
    const e = palE[labels[i]], mE = mat4Of(e.code);
    const toRound = !e.shape && clsM[i][mE].shape !== 'round';
    if (mE !== b.cls.m4 || toRound) {
      if (mE !== b.cls.m4) { const k = `${b.cls.m4}→${mE}`; mrf.relabeledBy[k] = (mrf.relabeledBy[k] || 0) + 1; mrf.relabeledMaterial++; b.mrfFrom = b.cls.m4; }
      if (toRound) mrf.toRound = (mrf.toRound || 0) + 1;
      b.cls = toRound ? clsR[i][mE] : clsM[i][mE]; recQ[i] = recFrom(b.cls); opts = ranked(recQ[i]);
    }
    opts = [e, ...opts.filter((x) => x !== e)];
  }
  if (!opts.length) { noCode.push({ x: b.x, y: b.y, cls: b.cls }); return; }
  // ngọc trai không vừa → đá trắng (sai vật liệu, vẫn có viên)
  const alt = b.cls.alt ? ranked({ ...recQ[i], mat: 'base', physMm: b.cls.alt.physMm }) : [];
  stones.push({ b, opts, alt, e: opts[0], rec: recQ[i], k: i, anchor: !!anchor[i] });
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
// KIT-22: va chạm → đẩy ≤ nudgeMm (12 hướng, bước 0.1 mm) trước, rồi hạ cỡ cùng vật liệu (mat4 mã = mat4 hạt; ngọc → đá trắng chỉ
// ngoài chuỗi); viên trong nhóm chuỗi giữ mã (chỉ đẩy, không đổi mã). Thứ tự: hạt vẽ ≥ 4 mm / hình → viền vàng 2.8 → hạt nhỏ
const nudgeMm = +flag('--nudge', 0.2), // 0.5 = trần captain; 0.2 giữ GT ≥ KIT-20 (bảng docs/KIT-20.md §KIT-22)
  lost2 = { nudged: 0, nudgeMm: [] };
const sameMat = (s, e) => { const m = mat4Of(e.code), b = s.b.cls.m4; return m === b || (b === 'pearl' && m === 'white') || (b === 'white' && m === 'pearl' && false); };
const DIRS = Array.from({ length: 12 }, (_, k) => [Math.cos((k * Math.PI) / 6), Math.sin((k * Math.PI) / 6)]);
const altNudge = args.includes('--alt-nudge'), shrinkSteps = +flag('--shrink-steps', 1);
function placeOne(s, tryE) {
  for (const e of tryE) {
    if (fits(s, e)) return { e };
    if (!altNudge && mat4Of(e.code) !== s.b.cls.m4) continue; // đổi vật liệu (ngọc → đá trắng) chỉ tại chỗ, không đẩy
    for (let r = 0.1; r <= nudgeMm + 1e-9; r += 0.1) for (const [dx, dy] of DIRS) {
      const t = { ...s, b: { ...s.b, x: s.b.x + dx * r * PPM, y: s.b.y + dy * r * PPM } };
      if (fits(t, e)) return { e, b: t.b, r };
    }
  }
  return null;
}
function commit(s, got) {
  if (got.b) { s.b = { ...got.b, nudgedMm: +got.r.toFixed(1) }; lost2.nudged++; }
  s.e = got.e; placed.push(s);
  const k = keyOf(s.b.x, s.b.y);
  (grid.get(k) || grid.set(k, []).get(k)).push(s);
}
function placeBead(s) {
  let smaller = s.opts.slice(1).filter((e) => R(e) < R(s.e) - 1e-6 && (e.kind === 'pearl') === (s.e.kind === 'pearl') && sameMat(s, e));
  // captain KIT-22: hạ tối đa shrinkSteps bậc cỡ catalog (các cỡ có trong bảng mã cùng vật liệu, theo thứ tự giảm)
  const steps = [...new Set(smaller.map(R))].sort((a, b) => b - a).slice(0, shrinkSteps);
  smaller = smaller.filter((e) => steps.includes(R(e)));
  const tryE = s.anchor ? [s.e] : s.b.group ? [s.e, ...smaller.filter((e) => e.kind === s.e.kind && mat4Of(e.code) === mat4Of(s.e.code)).slice(0, 1)] : [s.e, ...smaller, ...s.alt.filter((e) => sameMat(s, e))];
  const got = placeOne(s, tryE);
  if (args.includes('--debug') && CAPTAIN.row.some(([x, y]) => Math.hypot(x - s.b.x, y - s.b.y) < 12)) console.error('placeC', Math.round(s.b.x), Math.round(s.b.y), s.b.cls.m4, 'try', tryE.map((x) => x.code).join(','), '→', got?.e.code, got?.r ?? 0, 'group', !!s.b.group);
  if (!got) { lost.collision++; if (s.anchor) lost.anchorDropped = (lost.anchorDropped || 0) + 1; return; }
  if (got.e !== s.e) lost.shrunk++;
  commit(s, got);
}
const bigFirst = (s) => s.b.dMm >= 4 || !!s.e.shape;
const borderLast = args.includes('--border-last');
for (const s of stones) if (bigFirst(s)) placeBead(s);
if (borderLast) for (const s of stones) if (!bigFirst(s)) placeBead(s);

// ── 3b. viền vàng li ti (tools/kit20_chain.py: vùng vàng → đường tâm → điểm cách 2.95 mm): viên vàng 2.8 sau hạt to, TRƯỚC hạt nhỏ
// (captain KIT-22: dải viền ưu tiên hơn hạt nhỏ detect chồng lên nó); đẩy ≤ nudgeMm
const chainF = flag('--chain'), chain = { points: 0, placed: 0, collision: 0, nudged: 0 };
if (chainF) {
  const C = JSON.parse(fs.readFileSync(path.resolve(ROOT, chainF), 'utf8')).points;
  chain.points = C.length; chain.insideBead = 0;
  // "không có hạt thì không có đá" ngược lại: điểm viền nằm trong lòng 1 hạt vẽ không phải vàng (ngọc / đá ánh vàng, kể cả hạt bị bỏ
  // vì va chạm) là hạt, không phải viền → bỏ
  const bc = 8 * PPM, BG = new Map();
  for (const b of [...beads, ...fillRemoved]) if (b.cls.m4 !== 'gold') { const q = `${Math.floor(b.x / bc)},${Math.floor(b.y / bc)}`; (BG.get(q) || BG.set(q, []).get(q)).push(b); }
  const inBead = (x, y) => { const gx = Math.floor(x / bc), gy = Math.floor(y / bc); for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) for (const b of BG.get(`${gx + dx},${gy + dy}`) || []) if (Math.hypot(b.x - x, b.y - y) / PPM < 0.5 * b.dMm) return true; return false; };
  // KIT-23 (captain fb1): bóng ấm giữa các hạt ngọc lọt ngưỡng vàng (C* 43–46, viền thật C* ≥ 52) → điểm C* < 50 cách mép 1 hạt ngọc
  // ≤ 1 mm là bóng ngọc, không phải viền
  const PG = new Map();
  for (const b of [...beads, ...fillRemoved]) if (b.cls.m4 === 'pearl') { const q = `${Math.floor(b.x / bc)},${Math.floor(b.y / bc)}`; (PG.get(q) || PG.set(q, []).get(q)).push(b); }
  const pearlShade = (c) => { if (keepShade || Math.hypot(c.a, c.b) >= 47 || c.widthMm >= 1) return false; const gx = Math.floor(c.x / bc), gy = Math.floor(c.y / bc); for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) for (const b of PG.get(`${gx + dx},${gy + dy}`) || []) if (Math.hypot(b.x - c.x, b.y - c.y) / PPM < 0.5 * b.dMm + 1) return true; return false; };
  chain.pearlShade = 0;
  // KIT-25: điểm viền lẻ (< 2 điểm viền khác trong 1.2 bước) nằm trong vùng phủ không phải vàng = bóng ấm giữa hạt của vùng (trước đây
  // hạt vẽ ≥ 4 mm đặt trước chặn chúng; nay hạt vùng phủ bỏ khỏi pipeline chi tiết); đường viền thật đi qua vùng có láng giềng 2 phía
  const CG = new Map(), cgc = 4 * PPM, nonGold = fillRegions.filter((r) => r.material !== 'gold');
  for (const c of C) { const q = `${Math.floor(c.x / cgc)},${Math.floor(c.y / cgc)}`; (CG.get(q) || CG.set(q, []).get(q)).push(c); }
  const lonely = (c) => { let n = 0; const gx = Math.floor(c.x / cgc), gy = Math.floor(c.y / cgc); for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) for (const t of CG.get(`${gx + dx},${gy + dy}`) || []) if (t !== c && Math.hypot(t.x - c.x, t.y - c.y) / PPM <= 1.2 * 2.95) n++; return n < 2; };
  chain.fillLonely = 0;
  for (const c of C) {
    if (inBead(c.x, c.y)) { chain.insideBead++; continue; }
    if (pearlShade(c)) { chain.pearlShade++; continue; }
    if (nonGold.length && lonely(c) && nonGold.some((r) => inRegion(c.x, c.y, r))) { chain.fillLonely++; continue; }
    const rec = { layer: 'queen', mat: 'gold', physMm: 2.8, t: [c.L, c.a, c.b], one: false, gwl: 1 };
    const s = { b: { x: c.x, y: c.y, dMm: 2.8, score: 0, rotDeg: 0, cls: { m4: 'gold', physMm: 2.8, shape: 'round' }, src: 'chain' }, rec, opts: ranked(rec), alt: [] };
    const got = placeOne(s, s.opts.filter((x) => x.physMm === 2.8 && mat4Of(x.code) === 'gold').slice(0, 1));
    if (!got) {
      chain.collision++;
      if (args.includes('--debug')) { const w = placed.reduce((a, t) => (Math.hypot(t.b.x - c.x, t.b.y - c.y) < Math.hypot(a.b.x - c.x, a.b.y - c.y) ? t : a), placed[0]); const k = `${w.e.code}/${w.b.src || 'sam'}/${w.b.cls.m4}`; (chain.blockedBy ||= {})[k] = (chain.blockedBy[k] || 0) + 1; }
      continue;
    }
    if (got.b) chain.nudged++;
    commit(s, got); chain.placed++;
  }
}
// hạt nhỏ có tâm trong lòng 1 hạt vẽ to hơn ≥ 1.6× (đã đặt hay bị bỏ vì va chạm) là mảnh / ánh sáng của hạt đó → không viên
const BB = new Map(), bbc = 12 * PPM;
for (const s of stones) if (bigFirst(s)) { const q = `${Math.floor(s.b.x / bbc)},${Math.floor(s.b.y / bbc)}`; (BB.get(q) || BB.set(q, []).get(q)).push(s.b); }
const insideBig = (b) => { const gx = Math.floor(b.x / bbc), gy = Math.floor(b.y / bbc); for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) for (const t of BB.get(`${gx + dx},${gy + dy}`) || []) if (t.dMm >= 1.6 * b.dMm && Math.hypot(t.x - b.x, t.y - b.y) / PPM < 0.5 * t.dMm) return true; return false; };
// KIT-23 (captain fb1): hạt trắng nhỏ (< 3 mm) giữa ≥ 3 hạt ngọc to hơn ≥ 1.6× (chạm nhau) = ánh sáng khe giữa ngọc → không viên
const PB = new Map();
for (const b of [...beads, ...fillRemoved]) if (b.cls.m4 === 'pearl') { const q = `${Math.floor(b.x / bbc)},${Math.floor(b.y / bbc)}`; (PB.get(q) || PB.set(q, []).get(q)).push(b); }
const gapGlint = (b) => { if (keepShade || b.dMm >= 3 || (b.cls.m4 !== 'white' && b.cls.m4 !== 'pearl')) return false; let n = 0; const gx = Math.floor(b.x / bbc), gy = Math.floor(b.y / bbc); for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) for (const t of PB.get(`${gx + dx},${gy + dy}`) || []) if (t !== b && t.dMm >= 1.6 * b.dMm && Math.hypot(t.x - b.x, t.y - b.y) / PPM < 0.75 * (t.dMm + b.dMm)) n++; return n >= 3; };
lost.insideBig = 0; lost.gapGlint = 0;
if (!borderLast) for (const s of stones) if (!bigFirst(s)) { if (!args.includes('--keep-inside') && insideBig(s.b)) { lost.insideBig++; continue; } if (gapGlint(s.b)) { lost.gapGlint++; continue; } placeBead(s); }

// ── 3d. KIT-25 vùng phủ SAU mọi viên chi tiết (to / hình, viền vàng, hạt nhỏ khác chất liệu giữ 1:1 như KIT-24): xếp lại trong đa giác
// với viên đã đặt làm vật cản (đĩa bán kính + khe), 1 mã / vùng (mã rẻ nhất trong bảng cho bản ghi vùng, hoặc mã sửa tay có trong bảng);
// va chạm (viên hình) → đẩy ≤ nudge, không thì bỏ
for (const [k, r] of fillRegions.entries()) {
  const rec = recF[k], e = (r.code && palE.find((x) => x.code === r.code)) || ranked(rec)[0];
  r.result = { code: e?.code ?? null, codeNote: r.code && !palE.some((x) => x.code === r.code) ? `mã sửa tay ${r.code} không có trong bảng` : undefined, points: r.packed.points.length, placed: 0, collision: 0, nudged: 0 };
  if (!e) continue;
  const obstacles = placed.map((t) => ({ x: t.b.x, y: t.b.y, rMm: R(t.e) }));
  r.packed = packRegion(r, { ppm: PPM, gapMm: GAP, obstacles, clip: maskInside() || undefined }); // tâm viên trong mask (vùng nở có thể phủ lỗ mask)
  r.result.points = r.packed.points.length;
  for (const q of r.packed.points) {
    const s = { b: { x: q.x, y: q.y, dMm: r.physMm, score: 0, rotDeg: 0, cls: { m4: r.material, physMm: r.physMm, shape: 'round' }, src: 'fill', fill: r.id }, rec, opts: [e], e, alt: [] };
    const got = placeOne(s, [e]);
    if (!got) { r.result.collision++; continue; }
    if (got.b) r.result.nudged++;
    commit(s, got); r.result.placed++;
  }
}

// ── 3e. KIT-26 gương lượt cuối: viên vùng "sym" (ngoài vật thể / vẽ lệch) → union trái ∪ gương(phải), rồi xuất 2 bên y hệt.
// Viên vật thể / vẽ lệch giữ nguyên (đặt trước, thắng va chạm). Ứng viên (trái + gương của phải) theo thứ tự đặt gốc: viên chạm
// đúng bản gương của chính nó → đặt lên trục (xoay về 0 / 180°, đơn) nếu vừa, không thì bỏ; còn lại cần vừa cả 2 chỗ (bản gương dưới
// vật thể / ngoài mask → chỉ 1 viên). Vùng phủ hợp nhất theo cùng cách (viên vùng phủ phải → ứng viên trái)
const symRep = { on: symAct };
const obstaclesNow = () => placed.map((t) => ({ x: t.b.x, y: t.b.y, rMm: R(t.e) }));
const fillTargets = () => fillRegions.filter((r) => r.result?.code).flatMap((r) => [{ r, mirrored: false }, ...(symAct ? [{ r: { ...r, id: `${r.id}'`, polygon: r.polygon.map(([x, y]) => [2 * sym.axisPx - x, y]), holes: (r.holes || []).map((hl) => hl.map(([x, y]) => [2 * sym.axisPx - x, y])) }, mirrored: true }] : [])]);
const mirS = (s) => ({ ...s, b: { ...s.b, x: 2 * sym.axisPx - s.b.x, rotDeg: (360 - ((s.b.rotDeg || 0) % 360)) % 360 } });
const twin = new Map(); // chỉ số hạt ↔ hạt gương
for (const [a, c] of symPairs) { twin.set(a, c); twin.set(c, a); }
const stoneList = () => placed.map((t) => ({ x: t.b.x, y: t.b.y, code: t.e.code }));
if (sym?.axisPx) symRep.pairRateBefore = pairRate(stoneList(), sym, PPM);
// đặt cặp (viên trái + bản gương) đối xứng; trả về 'pair' | 'axis' | 'single' | null (không vừa)
function placeSym(s, mk) {
  const mi = maskInside(), inM = (t) => sym.zone(t.b.x, t.b.y) !== 'out' && (!mi || mi(t.b.x, t.b.y));
  if (!inM(s)) return null; // ngoài trang phục (đa giác vùng gương lòi ra ngoài mask bên này)
  const ax = sym.axisPx, m = mirS(s), zm = inM(m) ? sym.zone(m.b.x, m.b.y) : 'out', A = geo(s, s.e), selfGap = s.e.shape ? gapMm(A, geo(m, m.e), PPM) : (2 * Math.abs(s.b.x - ax)) / PPM - 2 * R(s.e);
  if (selfGap < GAP - 1e-3) { // chồng lên chính bản gương → 1 viên trên trục
    const rot = s.e.shape ? [0, 180, ...(s.e.shape === 'marquise' ? [90, 270] : [])].reduce((a, r) => (Math.abs(((s.b.rotDeg - r + 540) % 360) - 180) < Math.abs(((s.b.rotDeg - a + 540) % 360) - 180) ? r : a), 0) : 0;
    const t = { ...s, b: { ...s.b, x: ax, rotDeg: rot } };
    if (!fits(t, t.e)) return null;
    commit(t, { e: t.e }); return 'axis';
  }
  if (!fits(s, s.e)) return null;
  if (zm === 'obj' || zm === 'out') { commit(s, { e: s.e }); return 'single'; }
  if (!fits(m, m.e)) { commit(s, { e: s.e }); return 'single'; } // bản gương chạm viên vẽ lệch / vật thể bên kia
  if (mk !== undefined || s.k != null) { m.k = mk !== undefined ? mk : twin.get(s.k); m.b = { ...m.b, i: m.k != null ? beads[m.k].i : undefined }; }
  commit(s, { e: s.e }); commit(m, { e: m.e }); return 'pair';
}
if (symAct) {
  const ax = sym.axisPx, fixed = [], cand = [];
  let fillSym = 0;
  placed.forEach((t, o) => { const z = sym.zone(t.b.x, t.b.y); if (z !== 'sym') fixed.push(t); else if (t.b.src === 'fill') fillSym++; else if (t.b.x <= ax) cand.push({ s: t, from: 'left', o }); else { const sm = mirS(t); sm.k = twin.get(t.k); sm.b = { ...sm.b, i: sm.k != null ? beads[sm.k].i : undefined }; cand.push({ s: sm, from: 'right', orig: t, o: 1e9 + o }); } });
  placed.length = 0; grid.clear();
  for (const t of fixed) commit(t, { e: t.e });
  // trái trước (giữ đúng hạt vẽ 1 bên, mỗi bên theo thứ tự đặt gốc: to / hình → viền vàng → hạt nhỏ), gương của phải chỉ lấp chỗ trống
  cand.sort((p, q) => p.o - q.o);
  const st = { fixed: fixed.length, candidates: cand.length, fillRepacked: fillSym, left: 0, fromRight: 0, pair: 0, axis: 0, single: 0, dropped: 0, rightOutside: 0 };
  for (const c of cand) {
    if (c.from === 'right' && !sym.inMask(c.s.b.x, c.s.b.y)) { if (fits(c.orig, c.orig.e)) { commit(c.orig, { e: c.orig.e }); st.rightOutside++; } else st.dropped++; continue; }
    const r = placeSym(c.s, c.from === 'right' ? c.orig.k ?? null : undefined);
    if (!r) { st.dropped++; continue; }
    st[r]++; st[c.from === 'left' ? 'left' : 'fromRight']++;
  }
  // vùng phủ phần sym: xếp lại đối xứng trên vùng ∪ gương(vùng), tâm nửa trái, viên chi tiết đã đặt là vật cản → đặt cặp gương
  st.fill = { points: 0, pair: 0, axis: 0, single: 0, failed: 0 };
  for (const { r } of fillTargets()) {
    const e = palE.find((x) => x.code === r.result.code), k = fillRegions.findIndex((q) => q.id === r.id.replace(/'$/, ''));
    const pk = packRegion(r, { ppm: PPM, gapMm: GAP, obstacles: obstaclesNow(), clip: (x, y) => sym.zone(x, y) === 'sym' && x <= ax + 0.5 * R(e) * PPM });
    st.fill.points += pk.points.length;
    for (const q of pk.points) {
      const s = { b: { x: q.x, y: q.y, dMm: r.physMm, score: 0, rotDeg: 0, cls: { m4: r.material, physMm: r.physMm, shape: 'round' }, src: 'fill', fill: fillRegions[k].id }, rec: recF[k], opts: [e], e, alt: [] };
      const res = placeSym(s); if (res) st.fill[res]++; else st.fill.failed++;
    }
  }
  symRep.final = st;
}
// ── 3f. KIT-26 kín: sau mọi viên, lấp mọi lỗ còn chứa được 1 viên cỡ vùng trong vùng phủ (packRegion chỉ lấp lỗ, mọi viên đã đặt là vật
// cản); đối xứng: vùng + bản gương của vùng (hợp nhất 2 bên), tâm chỉ nửa trái (vùng sym) rồi đặt cặp gương; vùng vẽ lệch chỉ vùng gốc.
// holesLeft = điểm còn đặt được 1 viên sau lượt này (mục tiêu 0)
const kin = { added: 0, pair: 0, axis: 0, single: 0, failed: 0, holesLeft: {} };
if (fillOn && !args.includes('--no-kin')) {
  for (const { r, mirrored } of fillTargets()) {
    const e = palE.find((x) => x.code === r.result.code), k = fillRegions.findIndex((q) => q.id === r.id.replace(/'$/, '')), rec = recF[k];
    const mi = maskInside(), clip = (x, y) => { if (mi && !mi(x, y)) return false; if (!symAct) return true; const z = sym.zone(x, y); return z === 'sym' ? x <= sym.axisPx + 0.5 * R(e) * PPM : z !== 'out' && !mirrored; };
    const pk = packRegion(r, { ppm: PPM, gapMm: GAP, obstacles: obstaclesNow(), holesOnly: true, clip });
    for (const q of pk.points) {
      const s = { b: { x: q.x, y: q.y, dMm: r.physMm, score: 0, rotDeg: 0, cls: { m4: r.material, physMm: r.physMm, shape: 'round' }, src: 'fill', fill: r.id.replace(/'$/, ''), kin: true }, rec, opts: [e], e, alt: [] };
      if (symAct && sym.zone(q.x, q.y) === 'sym') { const res = placeSym(s); if (res) { kin[res]++; kin.added += res === 'pair' ? 2 : 1; } else kin.failed++; continue; }
      if (fits(s, e)) { commit(s, { e }); kin.single++; kin.added++; } else kin.failed++;
    }
  }
  // lỗ còn lại (bản gương không vừa: bên kia đã có viên lệch / vật thể) → 1 viên đơn: kín ưu tiên hơn đối xứng tuyệt đối
  if (symAct) for (const { r, mirrored } of fillTargets()) {
    const e = palE.find((x) => x.code === r.result.code), k = fillRegions.findIndex((q) => q.id === r.id.replace(/'$/, '')), mi = maskInside();
    for (const q of packRegion(r, { ppm: PPM, gapMm: GAP, obstacles: obstaclesNow(), holesOnly: true, clip: (x, y) => (mirrored ? sym.zone(x, y) === 'sym' : sym.zone(x, y) !== 'out') && (!mi || mi(x, y)) }).points) {
      const s = { b: { x: q.x, y: q.y, dMm: r.physMm, score: 0, rotDeg: 0, cls: { m4: r.material, physMm: r.physMm, shape: 'round' }, src: 'fill', fill: fillRegions[k].id, kin: true }, rec: recF[k], opts: [e], e, alt: [] };
      if (fits(s, e)) { commit(s, { e }); kin.singleAfterSym = (kin.singleAfterSym || 0) + 1; kin.added++; } else kin.failed++;
    }
  }
  for (const { r, mirrored } of fillTargets()) {
    if (mirrored && !symAct) continue;
    const mi = maskInside(), clip = (x, y) => (!mi || mi(x, y)) && (!mirrored || sym.zone(x, y) === 'sym'); // như lượt kín: tâm trong mask
    kin.holesLeft[r.id] = packRegion(r, { ppm: PPM, gapMm: GAP, obstacles: obstaclesNow(), holesOnly: true, clip }).points.length;
  }
  kin.holesLeftTotal = Object.values(kin.holesLeft).reduce((a, v) => a + v, 0);
}
if (sym?.axisPx) symRep.pairRateAfter = pairRate(stoneList(), sym, PPM);

// ── 3c. KIT-23 consistency: % cặp láng giềng mạnh (cùng cấu trúc: chuỗi / cột, motif, láng giềng cùng chất liệu + cỡ ≤ 1.2× + ΔE nhỏ)
// mà cả 2 đều có viên nhưng khác mã; missing = cặp chỉ 1 hạt có viên
const codeAt = new Map();
for (const s of placed) if (s.k != null) codeAt.set(s.k, s.e.code);
// KIT-26: viên bên phải phần sym là bản gương của viên trái, chỉ mang chỉ số hạt phải khi cặp gương → consistency chấm trên hạt còn
// nhận diện được (trái, trục, vẽ lệch, cặp); bên phải = gương bên trái nên không thêm thông tin
const inBox = (box) => (b) => !box || (b.x >= box[0] && b.y >= box[1] && b.x < box[0] + box[2] && b.y < box[1] + box[3]);
function consistency(box) {
  const inB = inBox(box), r = { pairs: 0, differ: 0, missing: 0, byKind: {} };
  for (const g of graph.values()) {
    if (!strong(g) || !inB(beads[g.i]) || !inB(beads[g.j])) continue;
    const ca = codeAt.get(g.i), cb = codeAt.get(g.j);
    if (!ca !== !cb) r.missing++;
    if (!ca || !cb) continue;
    const kind = g.kinds.has('motif') ? 'motif' : g.kinds.has('chain') ? 'chain' : 'spatial', o = (r.byKind[kind] ||= { pairs: 0, differ: 0 });
    o.pairs++; r.pairs++;
    if (ca !== cb) { o.differ++; r.differ++; }
  }
  r.pct = +((100 * r.differ) / Math.max(1, r.pairs)).toFixed(1);
  for (const o of Object.values(r.byKind)) o.pct = +((100 * o.differ) / Math.max(1, o.pairs)).toFixed(1);
  if (box) { r.codes = {}; for (const t of placed) if (inB(t.b)) r.codes[t.e.code] = (r.codes[t.e.code] || 0) + 1; }
  return r;
}
const consist = { all: consistency(null), regions: Object.fromEntries((isQueen ? [...Object.entries(FB), ['captain', CAPTAIN.box]] : []).map(([k, box]) => [k, consistency(box)])) };
// KIT-24 bảng hình: số viên đặt theo hình catalog; cánh motif đã đặt (mã / hình / cỡ / xoay)
const shapeCount = {}; for (const s of placed) { const k = s.e.shape ? `${s.e.shape} ${s.e.physW}x${s.e.physH}` : 'round'; shapeCount[k] = (shapeCount[k] || 0) + 1; }
const petalPlaced = placed.filter((s) => s.b.petal).map((s) => ({ x: Math.round(s.b.x), y: Math.round(s.b.y), code: s.e.code, shape: s.e.shape || 'round', size: s.e.shape ? `${s.e.physW}x${s.e.physH}` : s.e.physMm, rot: Math.round(s.b.rotDeg) }));
const motifRep = motifs.map((m) => ({ centre: [Math.round(m.centre.x), Math.round(m.centre.y)], centreCode: codeAt.get(BI.get(m.centre)) ?? null, ring: m.ring.map((t) => codeAt.get(BI.get(t)) ?? '-').join(' '), ringMm: m.ring.map((t) => +t.dMm.toFixed(1)) }));

if (args.includes('--dump')) {
  const r1 = (v) => (typeof v === 'number' ? +v.toFixed(2) : v);
  fs.writeFileSync(path.join(OUT, 'dump.json'), JSON.stringify({
    beads: beads.map((b) => ({ i: b.i, x: r1(b.x), y: r1(b.y), dMm: r1(b.dMm), wMm: r1(b.wMm), hMm: r1(b.hMm), shape: b.shape, rot: r1(b.rotDeg), L: r1(b.L), a: r1(b.a), b: r1(b.b), chroma: r1(b.chroma), edge: r1(b.edge), conf: r1(b.conf), src: b.src, m4: b.cls.m4, phys: b.cls.physMm, cshape: b.cls.shape, chain: b.chain?.k, inGroup: !!b.group })),
    placed: placed.map((s) => ({ i: s.b.i, x: r1(s.b.x), y: r1(s.b.y), code: s.e.code, src: s.b.src, want: s.opts[0]?.code })),
  }));
}
// ── KIT-25 báo cáo vùng phủ: mỗi vùng → mã, số viên xếp / đặt, phủ (diện tích viên / diện tích đa giác), hạt vẽ bị thay
function fillReport() {
  return fillRegions.map((r) => {
    const st = placed.filter((q) => q.b.fill === r.id), area = regionAreaMm2(r, PPM), e = st[0]?.e;
    // phủ tất cả viên có tâm trong vùng (gồm chuỗi vàng / viên chi tiết đặt trước) — so được với DB
    const all = placed.filter((q) => inRegion(q.b.x, q.b.y, r)), allPct = +((100 * all.reduce((a, q) => a + (q.e.physW ? 0.7 * q.e.physW * q.e.physH : Math.PI * (q.e.physMm / 2) ** 2), 0)) / area).toFixed(1);
    return { id: r.id, material: r.material, lab: r.lab, drawnMm: r.drawnMm, physMm: r.physMm, angleDeg: r.angleDeg, code: r.result?.code ?? null, codeNote: r.result?.codeNote,
      beadsReplaced: r.members.length, areaMm2: +area.toFixed(0), points: r.packed.points.length, ring: r.packed.ring, hex: r.packed.hex, holes: r.packed.holes, pitchMm: r.packed.pitchMm,
      placed: st.length, collision: r.result?.collision ?? 0, nudged: r.result?.nudged ?? 0, coveragePct: e ? +((100 * st.length * Math.PI * (e.physMm / 2) ** 2) / area).toFixed(1) : 0, allStones: all.length, allCoveragePct: allPct,
      signals: r.signals };
  });
}
// ảnh duyệt vùng: nền + đa giác (màu theo chất liệu) + nhãn id / chất liệu / cỡ / mã / số viên
function drawFillRegions(png) {
  const mime = /\.png$/i.test(reviewBg) ? 'image/png' : 'image/jpeg', href = `data:${mime};base64,${fs.readFileSync(reviewBg).toString('base64')}`;
  const col = { pearl: '#00e5ff', white: '#39ff14', gold: '#ffd400', color: '#ff2bd6' }, rp = fillReport(); // trắng → xanh lá (nổi trên ngọc)
  const body = fillRegions.map((r, k) => {
    const d = [r.polygon, ...(r.holes || [])].map((q) => 'M' + q.map(([x, y]) => `${x},${y}`).join('L') + 'Z').join(''), c = col[r.material] || '#00ff00', [cx, cy] = r.polygon.reduce((a, [x, y]) => [a[0] + x / r.polygon.length, a[1] + y / r.polygon.length], [0, 0]);
    const t = `${r.id} ${r.material} ${r.physMm}mm ${rp[k].code ?? '-'} ×${rp[k].placed}`;
    return `<path d="${d}" fill-rule="evenodd" fill="${c}" fill-opacity="0.22" stroke="${c}" stroke-width="5"/><text x="${cx.toFixed(0)}" y="${cy.toFixed(0)}" font-family="Helvetica" font-size="34" font-weight="bold" fill="#000" stroke="#fff" stroke-width="6" paint-order="stroke" text-anchor="middle">${t}</text>`;
  }).join('\n') + (symAct ? '\n' + fillRegions.map((r) => { // KIT-26: bản gương của vùng (hợp nhất 2 bên), nét đứt
    const d = [r.polygon, ...(r.holes || [])].map((q) => 'M' + q.map(([x, y]) => `${(2 * sym.axisPx - x).toFixed(1)},${y}`).join('L') + 'Z').join(''), c = col[r.material] || '#00ff00';
    return `<path d="${d}" fill-rule="evenodd" fill="none" stroke="${c}" stroke-width="4" stroke-dasharray="14 10"/>`;
  }).join('\n') + `\n<line x1="${sym.axisPx.toFixed(1)}" y1="0" x2="${sym.axisPx.toFixed(1)}" y2="${W}" stroke="#00ff00" stroke-width="4"/>` : '');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${W}" width="${W}" height="${W}"><image href="${href}" x="0" y="0" width="${W}" height="${W}" preserveAspectRatio="none"/>\n${body}\n</svg>`;
  const f = png.replace(/\.png$/, '.svg');
  fs.writeFileSync(f, svg);
  try { execFileSync('rsvg-convert', ['-w', '1772', '-h', '1772', '-o', png, f]); fs.rmSync(f); return png; } catch (e) { return `rsvg-convert lỗi: ${String(e.message).slice(0, 80)}`; }
}

// KIT-26 ảnh đối xứng: trục (xanh lá), vật thể bất đối xứng (cam), vùng vẽ lệch (xanh dương), vùng sym không tô; nhãn số
function drawSymmetry(png) {
  const { n, cp } = sym.grid, rgba = Buffer.alloc(n * n * 4), C = { obj: [255, 120, 0, 150], asym: [40, 120, 255, 120] };
  for (let gy = 0; gy < n; gy++) for (let gx = 0; gx < n; gx++) { const c = C[sym.zone((gx + 0.5) * cp, (gy + 0.5) * cp)]; if (c) rgba.set(c, (gy * n + gx) * 4); }
  const ov = `data:image/png;base64,${encodePng(n, n, rgba).toString('base64')}`, mime = /\.png$/i.test(reviewBg) ? 'image/png' : 'image/jpeg', href = `data:${mime};base64,${fs.readFileSync(reviewBg).toString('base64')}`;
  const pr = symRep.pairRateAfter, t = [`trục ${sym.axisMm} mm${sym.manualAxis ? ' (tay)' : ''} · IoU mask ${sym.iou} · điểm ${sym.score} · ${sym.on ? 'BẬT' : 'TẮT: ' + sym.reason}`, `cam = vật thể bất đối xứng ${sym.objAreaMm2} mm² · xanh = vẽ lệch ${symInfo.zoneMm2?.asym ?? 0} mm² · sym ${symInfo.zoneMm2?.sym ?? 0} mm²`, pr ? `cặp gương cùng mã: sym ${pr.sym.pct}% · tất cả ${pr.all.pct}% (trước lượt gương ${symRep.pairRateBefore?.all.pct}%)` : ''];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${W}" width="${W}" height="${W}"><image href="${href}" x="0" y="0" width="${W}" height="${W}" preserveAspectRatio="none"/><image href="${ov}" x="0" y="0" width="${W}" height="${W}" preserveAspectRatio="none" style="image-rendering:pixelated"/>` +
    `<line x1="${sym.axisPx.toFixed(1)}" y1="0" x2="${sym.axisPx.toFixed(1)}" y2="${W}" stroke="#00ff00" stroke-width="6"/>` + t.map((s, k) => `<text x="40" y="${80 + 60 * k}" font-family="Helvetica" font-size="48" font-weight="bold" fill="#fff" stroke="#000" stroke-width="8" paint-order="stroke">${s}</text>`).join('') + '</svg>';
  const f = png.replace(/\.png$/, '.svg');
  fs.writeFileSync(f, svg);
  try { execFileSync('rsvg-convert', ['-w', '1772', '-h', '1772', '-o', png, f]); fs.rmSync(f); return png; } catch (e) { return `rsvg-convert lỗi: ${String(e.message).slice(0, 80)}`; }
}

// ── 4. SVG + chấm + phủ
const src =decodePng(fs.readFileSync(UP4)), img = upscale(src, W, W);
const doc0 = buildDoc(img, placed.map((s) => ({ x: s.b.x, y: s.b.y, code: s.e.code, rot: s.e.shape ? s.b.rotDeg : 0 })), cat, PPM, MM, { mode: 'kit-20 bead-instance', seg: path.basename(SEG), method: seg.method, gapMm: GAP });
const doc = normalizeDoc({ ...doc0, source: { name: 'Trang phục Queen.png (Real-ESRGAN ×4, hạt → viên)', widthPx: W, heightPx: W }, createdAt: new Date().toISOString() });
const check = checkDesign(doc, cat);
fs.writeFileSync(path.join(OUT, `${NAME}.svg`), writeKitSvg(doc));
const mask = MASKF === 'none' ? null : decodePng(fs.readFileSync(path.resolve(ROOT, MASKF)));
let costPx = mask ? 0 : W * W;
if (mask) for (let j = 0; j < mask.w * mask.h; j++) { const r = mask.data[j * 4], g = mask.data[j * 4 + 1], b = mask.data[j * 4 + 2]; if (r > 200 && g > 200 && b > 200) costPx++; }
const areaOf = (e) => (e.shape ? (e.shape === 'marquise' ? 0.6 : e.shape === 'teardrop' ? 0.7 : 0.72) * e.physW * e.physH : (Math.PI * e.physMm ** 2) / 4);
const covered = placed.reduce((a, s) => a + areaOf(s.e), 0), costMm2 = costPx / PPM ** 2;
// KIT-25: GT KIT-15 chỉ có cho Queen; detail = bỏ hạt GT nằm trong vùng phủ
const gtOn = isQueen && !args.includes('--no-gt');
const NOGT = { tiles: {}, total: { gt: 0, map: 0, recall: null, precision: null, materialOk: null, sizeOk: null, shapeOk: null, gt4mm: { n: 0, recall: null, materialOk: null, sizeOk: null }, gold: {} } };
const scoreGT = (list, o) => (gtOn ? scoreStones(list, o) : NOGT);
const outsideFill = (g) => !evalPolys.some((r) => inRegion(g.x, g.y, r));
const detScore = scoreGT(beads.map((b) => ({ x: b.x, y: b.y, mat4: b.cls.m4, physMm: b.cls.physMm, shape: b.cls.shape })));
const mapScore = scoreGT(placed.map((s) => ({ x: s.b.x, y: s.b.y, code: s.e.code })));
// GT có 186 / 274 hạt vẽ < 2 mm (viền hạt vàng li ti ~1 mm, không thể mỗi hạt 1 viên 2.8): chấm riêng tập hạt vẽ ≥ 2 mm
const detScore2 = scoreGT(beads.map((b) => ({ x: b.x, y: b.y, mat4: b.cls.m4, physMm: b.cls.physMm, shape: b.cls.shape })), { minGtMm: 2 });
const mapScore2 = scoreGT(placed.map((s) => ({ x: s.b.x, y: s.b.y, code: s.e.code })), { minGtMm: 2 });
const mapScoreD = scoreGT(placed.filter((s) => outsideFill(s.b)).map((s) => ({ x: s.b.x, y: s.b.y, code: s.e.code })), { minGtMm: 2, gtFilter: outsideFill }); // cả GT lẫn viên ta: chỉ ngoài vùng phủ
const tiles = (sc) => Object.fromEntries(Object.entries(sc.tiles).map(([k, v]) => [k, { gt: v.gt, map: v.map, recall: v.recall, precision: v.precision, materialOk: v.materialOk, sizeOk: v.sizeOk, shapeOk: v.shapeOk, gt4mm: v.gt4mm, gold: v.gold, wrong: v.wrong }]));
const byCode = {};
for (const s of placed) byCode[s.e.code] = (byCode[s.e.code] || 0) + 1;
const evQ = pal.layers.queen, evS = pal.layers.starry;
const report = {
  schema: 'pearl-kit20-report/1', source: 'requirements/Trang phục Queen.png', segmentation: { file: path.relative(ROOT, SEG), method: seg.method, region: seg.region, tiles: seg.tiles, seconds: seg.seconds, params: seg.params },
  instances: { masks: all.length, beadLike: cand.length, droppedParts: drop.size, beads: beads.length, noCode: noCode.length, collisionDropped: lost.collision, shrunkForGap: lost.shrunk, nudged: lost2.nudged, nudgeMaxMm: nudgeMm, insideBigSkipped: lost.insideBig, gapGlintSkipped: lost.gapGlint, stones: placed.length },
  materialRule: MAT, sizeK, coverage: { costumeMm2: Math.round(costMm2), stoneMm2: Math.round(covered), pct: +((100 * covered) / costMm2).toFixed(1), note: seg.region === 'gt' ? 'chỉ 3 ô GT được tách → % phủ toàn trang phục không có nghĩa' : undefined },
  codeCurve: curve.map(({ codes, ...c }) => ({ ...c, added: codes.filter((x) => !(curve.find((d) => d.union === c.union - 1)?.codes || []).includes(x)) })),
  palette: { codes, crystal: pal.crystal, union: codes.length, maxCodes, queenCodesUsed: Object.keys(byCode).length, byCode, starryMeanDE: evS?.meanDE, queenMeanDE: evQ?.meanDE, },
  check: check.ok ? 'ok' : check.errors.slice(0, 10),
  chain: chainF ? { file: chainF, ...chain } : undefined,
  chains: { ...chains },
  kit23: { mrf, paletteMerge, consistency: consist, motifs: motifRep, anchorDropped: lost.anchorDropped || 0, fb: FB },
  kit24: { petal, shapes: shapeCount, petalStones: petalPlaced },
  kit26: { symmetry: symInfo, mirrorEdges: mrf.mirrorEdges ?? 0, ...symRep, kin },
  kit25: { fill: fillInfo, regions: fillReport(), detailGt2mm: { stones: mapScoreD.total, tiles: tiles(mapScoreD), polygons: evalPolys.length } },
  // vùng ảnh captain gửi (msg 015, outputs/kit/kit20/captain_chain_5EEEE.png, tìm bằng khớp mẫu trên review.svg): hàng hạt to trước
  // (lẽ ra toàn '5') + mã mọi viên ≥ 4 mm trong khung
  captainRegion: (() => {
    const box = CAPTAIN.box, inB = (s) => s.b.x >= box[0] && s.b.y >= box[1] && s.b.x < box[0] + box[2] && s.b.y < box[1] + box[3];
    // mỗi hạt vẽ của hàng → viên sinh từ CHÍNH hạt đó (cùng i, có thể đã đẩy ≤ 0.5 mm) hoặc '-' (bỏ vì va chạm); viên đặt lại
    // dọc chuỗi (--resample-min) không giữ i → viên gần nhất ≤ 3 mm
    const row = CAPTAIN.row.map(([x, y]) => {
      const b = beads.reduce((a, t) => (Math.hypot(t.x - x, t.y - y) < Math.hypot(a.x - x, a.y - y) ? t : a), beads[0]);
      let s = Math.hypot(b.x - x, b.y - y) / PPM < 1 ? placed.find((t) => t.b.i === b.i && t.b.src !== 'chain') : null;
      if (!s && b.src === 'chain-resample') { const t = placed.reduce((a, q) => (Math.hypot(q.b.x - x, q.b.y - y) < Math.hypot(a.b.x - x, a.b.y - y) ? q : a), placed[0]); if (Math.hypot(t.b.x - x, t.b.y - y) / PPM <= 3) s = t; }
      return { x, y, code: s ? s.e.code : null, shiftMm: s ? +(Math.hypot(s.b.x - x, s.b.y - y) / PPM).toFixed(2) : null };
    });
    const big = {};
    for (const s of placed) if (inB(s) && Math.max(s.e.physMm || 0, s.e.physW || 0) >= 4) big[s.e.code] = (big[s.e.code] || 0) + 1;
    // vùng đỏ A (captain KIT-22): hạt vẽ trong khung theo vật liệu vs viên đặt được (hạt đỏ ~2.5–3 mm vẽ khít nhau < 2.95 mm)
    const inP = (p) => p.x >= box[0] && p.y >= box[1] && p.x < box[0] + box[2] && p.y < box[1] + box[3];
    const beadsBy = {}, stonesBy = {};
    for (const b of beads) if (inP(b)) beadsBy[b.cls.m4] = (beadsBy[b.cls.m4] || 0) + 1;
    for (const t of placed) if (inP(t.b)) stonesBy[t.b.cls.m4] = (stonesBy[t.b.cls.m4] || 0) + 1;
    const red = beads.filter((b) => inP(b) && b.cls.m4 === 'color' && b.a > 30), redNN = red.map((b) => Math.min(...red.filter((q) => q !== b).map((q) => Math.hypot(q.x - b.x, q.y - b.y) / PPM))).sort((x, y) => x - y);
    return { box, row, rowCodes: row.map((r) => r.code ?? '-').join(' '), bigStonesInBox: big, beadsBy, stonesBy,
      red: { beads: red.length, stones: placed.filter((t) => inP(t.b) && t.b.cls.m4 === 'color' && t.b.a > 30).length, medianDrawnMm: +(red.map((b) => b.dMm).sort((x, y) => x - y)[red.length >> 1] || 0).toFixed(2), medianNeighbourMm: +(redNN[redNN.length >> 1] || 0).toFixed(2) } };
  })(),
  neighbour: { enabled: !args.includes('--no-neigh'), relabeled: neigh.relabeled.length, added: neigh.added.length, relabeledBy: neigh.relabeled.reduce((a, r) => ((a[`${r.from}→${r.to}`] = (a[`${r.from}→${r.to}`] || 0) + 1), a), {}), addedBy: neigh.added.reduce((a, r) => ((a[r.m4] = (a[r.m4] || 0) + 1), a), {}),
    beforeAfter: undefined },
  score: { beads: { total: detScore.total, tiles: tiles(detScore) }, stones: { total: mapScore.total, tiles: tiles(mapScore) },
    gtDrawnAtLeast2mm: { beads: { total: detScore2.total, tiles: tiles(detScore2) }, stones: { total: mapScore2.total, tiles: tiles(mapScore2) } } },
  gtNote: 'đáp án KIT-15 outputs/kit/queen_gt/*.json (checked=false: bản nháp VLM chưa captain soát); GT có ngọc 2.8/4 mm mà catalog không có (ngọc nhỏ nhất 5 mm)',
  apiCalls: 0, seconds: 0,
};
// review: ảnh gốc + viền mảnh + ký hiệu (tools/kit_review_overlay.mjs), crop ô GT
const reviewBg = path.resolve(ROOT, flag('--review-bg', 'outputs/kit/queen_template/input_upscaled.jpg'));
if (!args.includes('--no-review') && fillRegions.length) report.kit25.overlay = drawFillRegions(path.join(OUT, 'fill_regions.png'));
if (!args.includes('--no-review') && sym?.grid) report.kit26.overlay = drawSymmetry(path.join(OUT, 'symmetry.png'));
if (!args.includes('--no-review')) {
  const bg = reviewBg, rv = path.join(OUT, 'review.svg');
  execFileSync(process.execPath, [path.join(ROOT, 'tools', 'kit_review_overlay.mjs'), path.join(OUT, `${NAME}.svg`), bg, rv], { stdio: 'ignore' });
  const svg = fs.readFileSync(rv, 'utf8');
  report.review = { svg: rv, crops: {} };
  for (const id of isQueen ? ['heart', 'pearls', 'cape', 'captain', ...Object.keys(FB)] : []) {
    const fixed = id === 'captain' ? CAPTAIN.box : FB[id]; // khung ảnh captain gửi (không lề)
    const t = fixed ? { x: fixed[0], y: fixed[1], w: fixed[2], h: fixed[3] } : JSON.parse(fs.readFileSync(path.join(ROOT, 'outputs', 'kit', 'queen_gt', `${id}.json`), 'utf8')).tile, m = fixed ? 0 : 4 * PPM;
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
nSum.consistencyPct = consist.all.pct; nSum.consistency = Object.fromEntries(Object.entries(consist.regions).map(([k, v]) => [k, { pct: v.pct, pairs: v.pairs, missing: v.missing }])); nSum.palette = codes; nSum.byCode = byCode; nSum.motifs = motifRep;
const beforeF = flag('--before');
if (beforeF && fs.existsSync(beforeF)) report.kit23.beforeAfter = { before: JSON.parse(fs.readFileSync(beforeF, 'utf8')), after: nSum };
fs.writeFileSync(path.join(OUT, 'neigh_summary.json'), JSON.stringify(nSum) + '\n');
if (chOffF && fs.existsSync(chOffF)) report.chains.beforeAfter = { before: JSON.parse(fs.readFileSync(chOffF, 'utf8')), after: nSum };
if (offF && fs.existsSync(offF)) report.neighbour.beforeAfter = { before: JSON.parse(fs.readFileSync(offF, 'utf8')), after: nSum };
fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 1) + '\n');
const T = (s) => `recall ${s.recall} prec ${s.precision} mat ${s.materialOk} size ${s.sizeOk} shape ${s.shapeOk} | ≥4mm rec ${s.gt4mm.recall} mat ${s.gt4mm.materialOk} size ${s.gt4mm.sizeOk}`;
console.log(`${seg.method}/${seg.region}: ${all.length} mask → ${cand.length} giống hạt → ${beads.length} hạt → ${placed.length} viên (va chạm bỏ ${lost.collision}, thu cỡ ${lost.shrunk}, không mã ${noCode.length}); ${codes.length} mã chung [${codes.join(' ')}] pha lê ${pal.crystal}, Queen dùng ${Object.keys(byCode).length}; chuỗi vàng ${chain.placed}/${chain.points}; phủ ${report.coverage.pct}%; check ${check.ok ? 'ok' : 'LỖI'}`);
for (const c of report.codeCurve) console.log(`  mã ${c.union} (+pet ${c.product}) +[${c.added.join(' ')}]: sai vật liệu ${c.material}, hình ${c.shape}, cỡ ${c.size}, không mã ${c.noCode}, ΔE ${c.dE}, Starry ΔE ${c.starryDE}`);
console.log(`  KIT-25: vùng phủ ${fillOn ? `${fillInfo.source} ${fillRegions.length} vùng, thay ${fillInfo.beadsRemoved} hạt` : 'tắt'}; ` + report.kit25.regions.map((r) => `${r.id} ${r.material} ${r.drawnMm}→${r.physMm}mm ${r.code} ${r.placed}/${r.points} phủ ${r.coveragePct}% (tất cả ${r.allStones} viên ${r.allCoveragePct}%)`).join('; ') + (gtOn ? `; GT chi tiết ≥ 2 mm (ngoài vùng phủ) ${T(mapScoreD.total)}` : ''));
console.log(`  KIT-26: đối xứng ${symAct ? 'BẬT' : 'tắt'} (${sym?.reason ?? 'kit22'}) trục ${sym?.axisMm} mm IoU ${sym?.iou} điểm ${sym?.score} vật thể ${sym?.objAreaMm2} mm²; cặp hạt ${JSON.stringify(symInfo.beadPairs || {})}; lượt gương ${JSON.stringify(symRep.final || {})}; kín +${kin.added} (cặp ${kin.pair}, trục ${kin.axis}, đơn ${kin.single}, hỏng ${kin.failed}) lỗ còn ${kin.holesLeftTotal ?? '-'}; cặp gương cùng mã ${symRep.pairRateBefore?.sym.pct ?? '-'}→${symRep.pairRateAfter?.sym.pct ?? '-'}% (sym), ${symRep.pairRateBefore?.all.pct ?? '-'}→${symRep.pairRateAfter?.all.pct ?? '-'}% (tất cả)`);
console.log(`  KIT-24: cánh ${petal.motifs.map((m) => `[${m.centre}] ${m.shape} tỉ lệ ${m.ratio}${m.after ? ' → ' + m.after[0] : ''}`).join('; ')}; đặt ${petalPlaced.length} cánh ${petalPlaced.map((q) => q.code).join(' ')}; hình ` + JSON.stringify(shapeCount));
console.log(`  KIT-23: MRF ${mrf.enabled ? `đổi ${mrf.changed} nhãn, chất liệu ${mrf.relabeledMaterial}` : 'tắt'}; motif ${motifs.length}; bảng thử +[${pearlAdd.join(' ')}] gộp −[${merged.history.map((h) => h.removed).join(' ')}]; neo bỏ ${lost.anchorDropped || 0}; consistency ${consist.all.pct}% (${consist.all.differ}/${consist.all.pairs}, thiếu 1 bên ${consist.all.missing}); ` + Object.entries(consist.regions).map(([k, v]) => `${k} ${v.pct}%`).join(' ') + `; hàng captain ${report.captainRegion.rowCodes}`);
console.log(`  hạt:  ${T(detScore.total)}`);
console.log(`  viên: ${T(mapScore.total)}`);
for (const [k, v] of Object.entries(mapScore.tiles)) console.log(`   ${k}: gt ${v.gt} map ${v.map} · ${T(v)}`);
console.log(`  GT vẽ ≥ 2 mm — hạt: ${T(detScore2.total)}`);
console.log(`  GT vẽ ≥ 2 mm — viên: ${T(mapScore2.total)}`);
for (const [k, v] of Object.entries(mapScore2.tiles)) console.log(`   ${k}: gt ${v.gt} map ${v.map} · ${T(v)}`);
