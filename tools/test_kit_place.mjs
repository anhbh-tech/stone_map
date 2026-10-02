// Test KIT-2 (ảnh → bản đồ đá) không tốn API: node tools/test_kit_place.mjs
// lib/kit/place.js trên ảnh tổng hợp + 1 ảnh pet thật (tools/fixtures/kit_pet_pom.png, ảnh khách có sẵn, không gen).
// Ảnh xem trước (render KIT-1) → outputs/kit/place-*.png. Tự kiểm trên ảnh _3: tools/bench_kit_place.mjs.
// Mã / màu / cỡ từ catalog thật (lib/kit/catalog.js ← kit/db/kit.sqlite); SVG xuất ra phải qua checkDesign (luật sản xuất).
import fs from 'node:fs';
import path from 'node:path';
import { place, placeStones, estimateGrid, resolveParams, rgbToLab, de2000, hungarian, MM_PX } from '../lib/kit/place.js';
import { loadCatalog, assignSymbols, checkDesign, physOf, refOf, groupOf } from '../lib/kit/catalog.js';
import { writeKitSvg, readKitSvg } from '../lib/kit/svgio.js';
import { renderMap } from '../lib/kit/render.js';
import { decodePng, encodePng } from '../lib/png.js';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const OUT = path.join(ROOT, 'outputs', 'kit');
const CAT = loadCatalog(), DEF = resolveParams({}, CAT);
let fail = 0;
const ok = (cond, msg) => { if (!cond) { fail++; console.log('FAIL', msg); } };

const mkImg = (W, H, fn) => {
  const data = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const c = fn(x, y); data.set([c[0], c[1], c[2], 255], (y * W + x) * 4); }
  return { w: W, h: H, data };
};
const maskOf = (W, H, fn) => Uint8Array.from({ length: W * H }, (_, i) => (fn(i % W, (i / W) | 0) ? 1 : 0));
const mm = (v) => v * MM_PX;
const phys = (s) => s.physMm ?? physOf(s.dMm); // va chạm theo cỡ vật lý (viên ra: dMm = cỡ vẽ reference)
const minDist = (a, b, o = DEF) => (phys(a) + phys(b)) / 2 + o.minMm - o.mainSizeMm;
const hex = (s) => [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16));
const near = (rgb, d = 2.8) => Object.entries(CAT.codes).filter(([, e]) => e.physMm === d).reduce((m, [c, e]) => (de2000(rgbToLab(...rgb), rgbToLab(...hex(e.fill))) < m[1] ? [c, de2000(rgbToLab(...rgb), rgbToLab(...hex(e.fill)))] : m), ['', Infinity])[0];

function overlaps(S, o = DEF) {
  let bad = 0;
  for (let i = 0; i < S.length; i++) for (let j = i + 1; j < S.length; j++) if (Math.hypot(S[i].x - S[j].x, S[i].y - S[j].y) < mm(minDist(S[i], S[j], o)) - 1e-3) bad++;
  return bad;
}
// Viên nằm trọn trong mặt nạ: điểm ảnh có tâm cách tâm viên < r − 1px đều thuộc mặt nạ.
function outside(S, mask, W, H, frame) {
  let bad = 0;
  for (const s of S) {
    const cx = (s.x - frame.x) / frame.scale, cy = (s.y - frame.y) / frame.scale, r = mm(phys(s) / 2) / frame.scale - 1;
    for (let y = Math.floor(cy - r); y <= cy + r; y++) for (let x = Math.floor(cx - r); x <= cx + r; x++) {
      if (Math.hypot(x + 0.5 - cx, y + 0.5 - cy) >= r) continue;
      if (x < 0 || y < 0 || x >= W || y >= H || !mask[y * W + x]) { bad++; break; }
    }
  }
  return bad;
}
// Render bằng KIT-1 (kiểu _3 sạch) quanh vùng viên → outputs/kit/.
function preview(file, res, scale = 0.5) {
  const S = res.map.stones;
  if (!S.length) return;
  const x0 = Math.min(...S.map((s) => s.x)) - 60, y0 = Math.min(...S.map((s) => s.y)) - 60;
  const px = Math.ceil(Math.max(Math.max(...S.map((s) => s.x)) - x0, Math.max(...S.map((s) => s.y)) - y0) + 60);
  const img = renderMap({ px, stones: S.map((s) => ({ ...s, x: s.x - x0, y: s.y - y0 })) }, CAT, { scale });
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, file), encodePng(img.w, img.h, img.data));
}

// ── màu / gán
{
  // cặp chuẩn Sharma 2005: (50, 2.6772, −79.7751) ↔ (50, 0, −82.7485) = 2.0425; (50, 0, 0) ↔ (50, −1, 2) = 2.3669; (50, 2.5, 0) ↔ (73, 25, −18) = 27.1492
  const pairs = [[[50, 2.6772, -79.7751], [50, 0, -82.7485], 2.0425], [[50, 0, 0], [50, -1, 2], 2.3669], [[50, 2.5, 0], [73, 25, -18], 27.1492], [[2.0776, 0.0795, -1.135], [0.9033, -0.0636, -0.5514], 0.9082]];
  ok(pairs.every(([a, b, d]) => Math.abs(de2000(a, b) - d) < 1e-4), `CIEDE2000 cặp chuẩn: ${pairs.map(([a, b]) => de2000(a, b).toFixed(4))}`);
  const h = hungarian([[4, 1, 3], [2, 0, 5]]);
  ok(h[0] === 1 && h[1] === 0, `Hungarian 2×3 → [1,0] (${[...h]})`);
  const L = Object.values(CAT.codes);
  ok(L.length > 100 && L.every((e) => /^#[0-9A-F]{6}$/.test(e.fill)) && CAT.codes.L94.physMm === 2.8 && CAT.codes.L94.refMm === 2.2 && CAT.codes.L94.fill === '#EFEDEA' && CAT.codes['7'].kind === 'pearl' && CAT.codes['7'].refMm === 6.2 && !L.some((e) => /^[MSXH]/.test(e.series)),
    `catalog: ${L.length} mã tròn, L94 2.8→2.2 #EFEDEA, ngọc trai 7 → 6.2, không có marquise / giọt / tim`);
  ok(CAT.rules.maxCodesTarget === 13 && CAT.rules.maxCodesHard === 15 && refOf(2.8) === 2.2 && refOf(6) === 5.2 && physOf(9.2) === 10 && groupOf('Z94', 4) === 'K_Z94_S4', `catalog: luật 13/15 mã, size_map 2.8→2.2, 6→5.2, 9.2→10`);
  const sym = assignSymbols(new Map([['L94', 900], ['5', 4], ['Z94', 40], ['10', 2], ['L4', 300]]), CAT, { L4: 'K' });
  ok(JSON.stringify(sym) === JSON.stringify({ 5: '5', 10: '10', L4: 'K', L94: 'A', Z94: 'B' }), `ký hiệu theo thiết kế: ngọc trai = số = cỡ, đá = chữ theo số viên, giữ chữ đã chốt (${JSON.stringify(sym)})`);
  // KIT-14 captain: chữ không trùng tiền tố series catalog (L Z W D Q M S X H) và không I / O → 15 chữ = trần cứng 15 mã
  const stones15 = L.filter((e) => e.kind === 'stone'), many = assignSymbols(stones15.slice(0, 15).map((e, i) => [e.code, 100 - i]), CAT);
  let over16 = null; try { assignSymbols(stones15.slice(0, 16).map((e, i) => [e.code, 100 - i]), CAT); } catch (e) { over16 = e; }
  ok(new Set(Object.values(many)).size === 15 && Object.values(many).every((c) => /^[ABCEFGJKNPRTUVY]$/.test(c)) && over16, 'ký hiệu: 15 mã đá → 15 chữ ABCEFGJKNPRTUVY, mã thứ 16 → lỗi');
}

// ── A. đĩa đồng màu R = 40mm: không chồng (≥ 2.95mm), nằm trọn trong mặt nạ, hàng viền, schema KIT-1, ký hiệu toàn cục.
{
  const scale = 2.5, k = MM_PX / scale, W = Math.ceil(90 * k), c = W / 2, R = 40 * k;
  const img = mkImg(W, W, () => [200, 149, 47]), mask = maskOf(W, W, (x, y) => Math.hypot(x + 0.5 - c, y + 0.5 - c) <= R), frame = { x: 100, y: 200, scale };
  const t0 = Date.now(), r = placeStones(img, { mask, frame, accents: false }), S = r.map.stones;
  ok(S.every((s) => s.code === 'L16' && s.dMm === 2.2 && s.physMm === 2.8 && s.symbol === 'A' && s.group === 'K_L16_S2.8'), `A: đồng màu #C8952F → toàn L16 (catalog #C8952F) / 'A' / vẽ 2.2 / K_L16_S2.8 (${r.colors.map((x) => x.code)})`);
  ok(overlaps(S) === 0, `A: ${overlaps(S)} cặp gần hơn 2.95mm`);
  ok(outside(S, mask, W, W, frame) === 0, `A: ${outside(S, mask, W, W, frame)} viên lòi ra ngoài mặt nạ`);
  const rr = (s) => Math.hypot((s.x - frame.x) / scale - c, (s.y - frame.y) / scale - c) / k;
  const rim = S.filter((s) => s.kind === 'rim'), want = (2 * Math.PI * (40 - 1.4)) / 3;
  ok(rim.length >= want * 0.95 && rim.every((s) => Math.abs(rr(s) - 38.6) < 0.3), `A: hàng viền r ${Math.min(...rim.map(rr)).toFixed(2)}–${Math.max(...rim.map(rr)).toFixed(2)}mm, ${rim.length} viên ≈ chu vi/3mm = ${want.toFixed(0)}, lùi vào 1 bán kính`);
  ok(r.stats.coverage > 0.44 && r.stats.coverage < 0.79 && r.stats.nnMm[0] >= 2.949, `A: phủ vật lý ${r.stats.coverage} (lục giác 2.8/3.0 = 0.79), NN ${r.stats.nnMm}`);
  const s0 = S[0];
  ok(JSON.stringify(Object.keys(s0).slice(0, 8)) === JSON.stringify(['id', 'symbol', 'code', 'x', 'y', 'dMm', 'rot', 'group']) && /^P\d{5}$/.test(s0.id), `A: schema KIT-1 ${JSON.stringify(s0)}`);
  ok(new Set(S.map((s) => s.id)).size === S.length && S.every((s, i) => !i || s.y >= S[i - 1].y - mm(3)), 'A: id không trùng, thứ tự đọc theo hàng');
  console.log(`A disc: ${S.length} viên ${JSON.stringify(r.stats.kinds)}, phủ ${r.stats.coverage}, NN ${r.stats.nnMm}, ${Date.now() - t0}ms`);
  preview('place-A-disc.png', r);
}

// ── B. vân sọc nghiêng 30° (chu kỳ 6mm) bên trái, phẳng bên phải: streamline + xoay theo sọc, vùng phẳng không xoay.
{
  const scale = 2.5, k = MM_PX / scale, W = Math.ceil(120 * k), H = Math.ceil(60 * k), th = (30 * Math.PI) / 180;
  const img = mkImg(W, H, (x, y) => {
    if (x > W / 2) return [150, 150, 150];
    const v = 150 + 40 * Math.sin((2 * Math.PI * (-(x / k) * Math.sin(th) + (y / k) * Math.cos(th))) / 6);
    return [v, v, v];
  });
  const r = placeStones(img, { mask: maskOf(W, H, () => 1), frame: { x: 0, y: 0, scale }, accents: false, edges: false });
  const inner = (s) => s.y > mm(10) && s.y < mm(50);
  const L = r.map.stones.filter((s) => inner(s) && s.x > mm(10) && s.x < mm(50)), Rt = r.map.stones.filter((s) => inner(s) && s.x > mm(72) && s.x < mm(110));
  const near30 = L.filter((s) => Math.abs(s.rot - 30) < 8).length / L.length;
  ok(near30 >= 0.85, `B: vùng sọc ${(near30 * 100).toFixed(0)}% viên xoay 30° ±8°`);
  ok(Rt.length > 50 && Rt.filter((s) => s.rot !== 0).length <= Rt.length * 0.05, `B: vùng phẳng không xoay (${Rt.filter((s) => s.rot).length}/${Rt.length} viên xoay)`);
  ok(r.stats.kinds.line > r.map.stones.length * 0.6 && overlaps(r.map.stones) === 0, `B: phần lớn là streamline (${JSON.stringify(r.stats.kinds)}), không chồng`);
  console.log(`B stripes: ${r.map.stones.length} viên, sọc xoay 30°: ${(near30 * 100).toFixed(0)}%, rotatedFrac ${r.stats.rotatedFrac}`);
  preview('place-B-stripes.png', r);
}

// ── C. cạnh mạnh: 2 nửa navy / vàng tách bằng đường chéo → có hàng đá ôm 2 bên cạnh, viên không vắt qua cạnh, màu đúng phía.
{
  const scale = 2.5, k = MM_PX / scale, W = Math.ceil(70 * k), H = Math.ceil(50 * k);
  const NAVY = [11, 46, 140], GOLD = [245, 188, 31], side = (X, Y) => X - 0.5 * Y - 20; // > 0: vàng
  const img = mkImg(W, H, (x, y) => (side(x / k, y / k) > 0 ? GOLD : NAVY));
  const r = placeStones(img, { mask: maskOf(W, H, () => 1), frame: { x: 0, y: 0, scale }, accents: false });
  const dist = (s) => side(s.x / MM_PX, s.y / MM_PX) / Math.hypot(1, 0.5);
  const edge = r.map.stones.filter((s) => s.kind === 'edge');
  ok(edge.length >= 20 && edge.every((s) => Math.abs(Math.abs(dist(s)) - DEF.minMm / 2) < 0.3), `C: ${edge.length} viên cạnh, cách cạnh ≈ ${DEF.minMm / 2}mm`);
  // hàng viền đặt trước cạnh: chỗ cạnh cắt viền ngoài có thể còn 1 viên viền vắt cạnh (màu vẫn theo phía đa số) → chỉ xét viên trong
  const straddle = r.map.stones.filter((s) => s.kind !== 'rim' && Math.abs(dist(s)) < 1.0).length;
  ok(straddle === 0, `C: ${straddle} viên (ngoài hàng viền) vắt qua cạnh`);
  // viên viền nằm ngay trên cạnh (|d| < 0.5mm, chỗ cạnh cắt viền) không có "phía đúng" → bỏ khỏi phép đếm màu
  const sideOk = (s) => s.kind === 'rim' && Math.abs(dist(s)) < 0.5 || s.code === (dist(s) > 0 ? near(GOLD) : near(NAVY));
  const wrong = r.map.stones.filter((s) => !sideOk(s)).length;
  ok(wrong === 0, `C: ${wrong} viên sai màu phía (${r.colors.map((c) => c.code + ':' + c.count)}) ${r.map.stones.filter((s) => !sideOk(s)).map((s) => `${s.kind} ${s.code} ${(s.x / MM_PX).toFixed(1)},${(s.y / MM_PX).toFixed(1)} d ${dist(s).toFixed(2)}`)}`);
  console.log(`C edges: ${edge.length} viên cạnh / ${r.map.stones.length}, vắt cạnh ${straddle}`);
  preview('place-C-edges.png', r);
}

// ── D. màu lẻ: nền 2 nửa + đốm nhỏ màu gần (ΔE00 nhỏ) → lọc đa số xoá; đốm khác hẳn (vàng trên xanh) giữ; tắt lọc thì còn.
{
  const scale = 2.5, k = MM_PX / scale, W = Math.ceil(80 * k), H = Math.ceil(50 * k);
  const NAVY = [11, 46, 140], BLUE = [20, 80, 192], GOLD = [245, 188, 31], spots = [];
  for (let i = 0; i < 12; i++) spots.push([8 + (i % 6) * 12, i < 6 ? 14 : 36]);
  const img = mkImg(W, H, (x, y) => {
    const X = x / k, Y = y / k;
    for (const [sx, sy] of spots) if (Math.hypot(X - sx, Y - sy) < 1.6) return X < 40 ? BLUE : NAVY;
    if (Math.hypot(X - 60, Y - 25) < 3.2) return GOLD;
    return X < 40 ? NAVY : BLUE;
  });
  const base = { mask: maskOf(W, H, () => 1), frame: { x: 0, y: 0, scale }, accents: false, edges: false };
  const on = placeStones(img, base), off = placeStones(img, { ...base, despeckle: false });
  const single = (r) => { const S = r.map.stones; return S.filter((s) => !S.some((t) => t !== s && t.code === s.code && Math.hypot(t.x - s.x, t.y - s.y) <= mm(3.75))).map((s) => s.code); };
  const so = single(on), sf = single(off), gold = near(GOLD);
  ok(sf.filter((c) => c !== gold).length >= 4, `D: không lọc → còn đốm lẻ (${sf})`);
  ok(so.filter((c) => c !== gold).length === 0, `D: lọc đa số → hết đốm lẻ gần màu (${so}) ${on.map.stones.filter((s) => !on.map.stones.some((t) => t !== s && t.code === s.code && Math.hypot(t.x - s.x, t.y - s.y) <= mm(3.75))).map((s) => `${s.kind}@${(s.x / MM_PX).toFixed(1)},${(s.y / MM_PX).toFixed(1)}`)}`);
  ok(on.map.stones.some((s) => s.code === gold), `D: đốm vàng khác hẳn vẫn giữ (${on.colors.map((x) => x.code)})`);
  console.log(`D despeckle: đốm lẻ ${sf.length} → ${so.length}, đổi ${on.stats.despeckled} viên`);
}

// ── E. giới hạn K mã: dải nhiều sắc → ≤ K (12, 5), mã khác nhau (Hungarian), mỗi viên mã gần nhất trong tập.
{
  const scale = 2.5, k = MM_PX / scale, W = Math.ceil(100 * k), H = Math.ceil(40 * k);
  const img = mkImg(W, H, (x, y) => {
    const h = (x / W) * 6, f = h % 1, l = 0.35 + 0.55 * (y / H), q = [[1, f, 0], [1 - f, 1, 0], [0, 1, f], [0, 1 - f, 1], [f, 0, 1], [1, 0, 1 - f]][Math.floor(h) % 6];
    return q.map((v) => 255 * (l * v + (1 - l) * 0.2));
  });
  const base = { mask: maskOf(W, H, () => 1), frame: { x: 0, y: 0, scale }, accents: false, edges: false, despeckle: false };
  const free = placeStones(img, { ...base, maxColors: 99 }), r13 = placeStones(img, base), r5 = placeStones(img, { ...base, maxColors: 5 });
  ok(free.stats.codes === 15, `E: maxColors 99 → kẹp luật tối đa 15 (${free.stats.codes} mã)`);
  ok(r13.stats.codes <= 13 && r13.stats.codes > 5 && r5.stats.codes === 5, `E: mặc định (luật 13) → ${r13.stats.codes}, K 5 → ${r5.stats.codes}`);
  const act = r5.colors.map((c) => c.code), lab = (c) => rgbToLab(...hex(CAT.codes[c].fill));
  let wrong = 0;
  for (const s of r5.map.stones) {
    const p = (Math.floor(s.y / scale) * W + Math.floor(s.x / scale)) * 4, L = rgbToLab(img.data[p], img.data[p + 1], img.data[p + 2]);
    if (de2000(L, lab(s.code)) > Math.min(...act.map((c) => de2000(L, lab(c)))) + 6) wrong++;
  }
  ok(wrong <= r5.map.stones.length * 0.03, `E: ${wrong}/${r5.map.stones.length} viên xa mã gần nhất trong tập`);
  console.log(`E colors: kẹp ${free.stats.codes} → K13 ${r13.stats.codes}, K5 ${r5.stats.codes} [${act}]`);
  preview('place-E-colors13.png', r13);
}

// ── F. đá nhấn: 2 mắt đen Ø5.2mm + mũi Ø4mm (tối) + 1 điểm sáng Ø4mm trên lông nâu nhạt (đá nhấn vật lý 4/5mm); tự dò chỉ lấy đốm tối;
// bbox từ ngoài → đặt đúng chỗ tối nhất trong hộp; tắt → không có. Mã đá nhấn: mã catalog cỡ 4/5mm, ký hiệu chữ không trùng.
{
  const scale = 2.5, k = MM_PX / scale, W = Math.ceil(70 * k), H = Math.ceil(60 * k);
  const FUR = [200, 150, 90], DARK = [15, 12, 10], blobs = [[22, 22, 2.6, DARK], [48, 22, 2.6, DARK], [35, 36, 2, [40, 25, 20]], [35, 48, 2, [250, 248, 245]]];
  const img = mkImg(W, H, (x, y) => { for (const [bx, by, br, c] of blobs) if (Math.hypot(x / k - bx, y / k - by) <= br) return c; return FUR; });
  const mask = maskOf(W, H, (x, y) => Math.hypot(x / k - 35, y / k - 32) < 28), frame = { x: 0, y: 0, scale };
  const r = placeStones(img, { mask, frame }), acc = r.map.stones.filter((s) => s.kind === 'accent');
  const hit = blobs.map(([bx, by]) => acc.find((s) => Math.hypot(s.x / MM_PX - bx, s.y / MM_PX - by) < 1.0));
  ok(hit[0] && hit[1] && hit[2] && !hit[3] && acc.length === 3, `F: tự dò 3 đốm tối (mắt, mắt, mũi), bỏ điểm sáng (${acc.map((s) => `${(s.x / MM_PX).toFixed(1)},${(s.y / MM_PX).toFixed(1)} ${s.dMm} ${s.code}`)})`);
  const e0 = CAT.codes[hit[0]?.code];
  ok(e0 && e0.physMm === 5 && hit[0].physMm === 5 && hit[0].dMm === 4.2 && hit[0].group === `K_${e0.code}_S5` && de2000(rgbToLab(...hex(e0.fill)), rgbToLab(...DARK)) < 15 && hit[2].physMm === 4 && hit[2].dMm === 3.2,
    `F: mắt → mã catalog tối 5mm (vẽ 4.2) ${hit[0]?.code} ${e0?.fill}, mũi 4mm (vẽ 3.2) ${hit[2]?.code}`);
  ok(r.map.stones.every((s) => r.symbols[s.code] === s.symbol) && new Set(Object.values(r.symbols)).size === r.colors.length && r.colors.length <= 13, `F: ký hiệu mỗi viên = bảng của thiết kế, không trùng (${JSON.stringify(r.symbols)})`);
  const fb = placeStones(img, { mask, frame, features: [{ x: 18 * k, y: 19 * k, w: 8 * k, h: 6 * k }, { x: 31 * k, y: 33 * k, w: 8 * k, h: 6 * k }] });
  const fa = fb.map.stones.filter((s) => s.kind === 'accent');
  ok(fa.length === 2 && Math.hypot(fa[0].x / MM_PX - 22, fa[0].y / MM_PX - 22) < 1 && Math.hypot(fa[1].x / MM_PX - 35, fa[1].y / MM_PX - 36) < 1, `F: bbox từ ngoài → đá nhấn ở tâm phần tối (${fa.map((s) => `${(s.x / MM_PX).toFixed(1)},${(s.y / MM_PX).toFixed(1)}`)})`);
  const off = placeStones(img, { mask, frame, accents: false });
  ok(off.map.stones.every((s) => s.physMm === 2.8 && s.dMm === 2.2), 'F: accents:false → toàn 2.8mm (vẽ 2.2)');
  ok(overlaps(r.map.stones) === 0 && outside(r.map.stones, mask, W, H, frame) === 0, 'F: đá nhấn không chồng (r1 + r2 + khe), nằm trong mặt nạ');
  console.log(`F accents: ${acc.map((s) => s.dMm + 'mm ' + s.code + '/' + s.symbol).join(', ')}`);
  preview('place-F-accents.png', r);
}

// ── G. viên cố định (avoid, vd cổ áo trang phục) không bị đè.
{
  const scale = 2.5, k = MM_PX / scale, W = Math.ceil(50 * k);
  const avoid = [{ x: 500 + mm(25), y: 500 + mm(25), dMm: 7.2 }, { x: 500 + mm(10), y: 500 + mm(40), dMm: 2.2 }];
  const r = placeStones(mkImg(W, W, () => [230, 230, 230]), { mask: maskOf(W, W, () => 1), frame: { x: 500, y: 500, scale }, avoid, accents: false });
  const bad = r.map.stones.filter((s) => avoid.some((a) => Math.hypot(s.x - a.x, s.y - a.y) < mm(minDist(s, a)) - 1e-3)).length;
  ok(bad === 0 && r.map.stones.length > 100, `G: ${bad} viên đè viên cố định (${r.map.stones.length} viên)`);
}

let PET;
// ── H. ảnh pet thật (Pomeranian trắng trên cỏ): mặt nạ = không phải cỏ ∩ elip đầu+cổ; ảnh 360px = 130mm trên bản đồ.
{
  const img = decodePng(fs.readFileSync(path.join(ROOT, 'tools/fixtures/kit_pet_pom.png'))), { w: W, h: H, data } = img;
  const mask = maskOf(W, H, (x, y) => { const p = (y * W + x) * 4; return data[p + 1] - Math.max(data[p], data[p + 2]) < 12 && ((x - 165) / 135) ** 2 + ((y - 200) / 160) ** 2 <= 1; });
  const scale = (130 * MM_PX) / W, frame = { x: 1100, y: 900, scale };
  const t0 = Date.now(), r = placeStones(img, { mask, frame }), ms = Date.now() - t0, S = r.map.stones, acc = S.filter((s) => s.kind === 'accent');
  ok(S.length > 500, `H: ${S.length} viên`);
  ok(r.stats.codes <= 13 && r.stats.codes >= 3, `H: ${r.stats.codes} mã (≤ 13)`);
  ok(overlaps(S) === 0 && outside(S, mask, W, H, frame) === 0, `H: ${overlaps(S)} cặp chồng, ${outside(S, mask, W, H, frame)} viên lòi`);
  ok(r.stats.coverage > 0.4 && r.stats.nnMm[0] >= 2.949, `H: phủ ${r.stats.coverage}, NN ${r.stats.nnMm}`);
  // mắt / mũi đo tay trên ảnh 360px: mắt (133,195) (219,204), mũi (178,220)
  const feat = [[133, 195], [219, 204], [178, 220]].map(([x, y]) => [frame.x + x * scale, frame.y + y * scale]);
  const found = feat.filter(([x, y]) => acc.some((s) => Math.hypot(s.x - x, s.y - y) < mm(6))).length;
  ok(found === 3, `H: đá nhấn ở mắt / mũi ${found}/3`);
  ok(ms < 20000, `H: ${ms}ms`);
  console.log(`H pet: ${S.length} viên ${JSON.stringify(r.stats.kinds)}, ${r.stats.codes} mã [${r.colors.map((c) => c.code + ':' + c.count).join(' ')}], phủ ${r.stats.coverage}, NN ${r.stats.nnMm}, xoay ${r.stats.rotatedFrac}, lẻ đổi ${r.stats.despeckled}, ${ms}ms`);
  preview('place-H-pet.png', r);
  PET = r;
}

// ── I. tham số: mặc định = sản phẩm thật (vật lý); đổi cỡ / khe → cả lưới theo; place() thuần; tập con mã; khung khác.
{
  ok(DEF.pitchMm === 3 && Math.abs(DEF.minMm - 2.95) < 1e-9 && Math.abs(DEF.rowMm - 1.5 * Math.sqrt(3)) < 1e-9 && DEF.canvasPx === 3543 && JSON.stringify(DEF.stoneSizesMm) === JSON.stringify(CAT.sizes) && CAT.sizes[0] === 2.8 && JSON.stringify(DEF.accentSizesMm) === '[4,5]' && DEF.maxColors === 13,
    `I: mặc định 2.8 + 0.2 (bước ${DEF.pitchMm}, min ${DEF.minMm}, hàng ${DEF.rowMm}, ${DEF.canvasPx}px, cỡ ${DEF.stoneSizesMm}, ${DEF.maxColors} mã)`);
  const scale = 2.5, k = MM_PX / scale, W = Math.ceil(60 * k), c = W / 2;
  const img = mkImg(W, W, (x, y) => (x < c ? [200, 149, 47] : [11, 46, 140])), mask = maskOf(W, W, (x, y) => Math.hypot(x + 0.5 - c, y + 0.5 - c) <= 27 * k);
  const P = { mainSizeMm: 4, gapMm: 1.0, accents: false, frame: { x: 50, y: 50, scale } };
  const r = place(img, mask, P), o = r.params;
  ok(Array.isArray(r.stones) && r.stats.stones === r.stones.length && o.pitchMm === 5 && o.minMm === 4.75 && Math.abs(o.rowMm - 2.5 * Math.sqrt(3)) < 1e-9 && !('catalog' in o) && o.frame.scale === scale,
    `I: place() → { stones, params (đã tính: bước ${o.pitchMm}, min ${o.minMm}, hàng ${o.rowMm}), stats }`);
  ok(r.stones.every((s) => s.physMm === 4 && s.dMm === 3.2 && CAT.codes[s.code].physMm === 4) && overlaps(r.stones, o) === 0 && Math.abs(r.stats.nnMm[1] - 5) < 0.1, `I: đá Z 4mm + khe 1.0 → NN trung vị ${r.stats.nnMm[1]}mm ≈ 5, không chồng`);
  let err = '';
  try { place(img, mask, { mainSizeMm: 3.0, accents: false }); } catch (e) { err = e.message; }
  ok(/catalog không có mã cỡ 3mm/.test(err), `I: cỡ chính không có mã catalog → lỗi rõ (${err})`);
  ok(place(img, mask, { accents: false, maxColors: 99, frame: { x: 0, y: 0, scale } }).params.maxColors === 15, 'I: maxColors kẹp ≤ 15');
  const sub = place(img, mask, { accents: false, frame: { x: 0, y: 0, scale }, codes: ['L47', 'L74', 'L16'] });
  ok(sub.stones.every((s) => ['L47', 'L74', 'L16'].includes(s.code)), `I: tập con mã → chỉ mã trong tập (${sub.colors.map((x) => x.code)})`);
  const fine = place(img, mask, { accents: false, frame: { x: 0, y: 0, scale: 1 }, pxPerMm: 4.7, canvasMm: 100 });
  ok(fine.params.canvasPx === 470 && Math.abs(fine.stats.nnMm[1] - 3) < 0.1 && fine.stones.length > 100, `I: bản đồ 4.7 px/mm (ảnh = px bản đồ) → NN ${fine.stats.nnMm[1]}mm, ${fine.stones.length} viên`);
}

// ── J. ước lượng bước + cỡ hạt từ ảnh đã có hạt: render KIT-1 của bản đồ do place() đặt với cỡ / khe đã biết.
{
  const W = Math.round(45 * MM_PX), img = mkImg(W, W, (x, y) => { const u = x / W, v = y / W; return [120 + 100 * Math.sin(6 * u + 2 * v), 120 + 90 * Math.cos(5 * v - 3 * u), 140 + 80 * Math.sin(4 * (u + v))]; });
  for (const [d, g] of [[2.8, 0.2], [4, 0.5]]) { // render vẽ cỡ reference (2.2 / 3.2) → ước lượng ra cỡ vẽ
    const r = place(img, null, { mainSizeMm: d, gapMm: g, accents: false }), ref = refOf(d);
    const e = estimateGrid(renderMap({ px: W, stones: r.stones }, CAT), null, { windows: 1 });
    ok(e && Math.abs(e.pitchMm / (d + g) - 1) < 0.03 && Math.abs(e.sizeMm / ref - 1) < 0.1, `J: hạt ${d} (vẽ ${ref}) + khe ${g} → ước lượng bước ${e?.pitchMm}, cỡ ${e?.sizeMm}`);
  }
  const flat = estimateGrid(mkImg(300, 300, () => [128, 128, 128]), null);
  ok(flat === null, 'J: ảnh phẳng không hạt → null');
}

// ── K. SVG xuất ra (svgio pearl-kit-map/1) pass luật sản xuất: mã catalog tròn, ≤ 13 mã, chữ in hoa / số = cỡ ngọc trai,
// không trùng, data-group = K_<mã>_S<vật lý>, cỡ vẽ = reference, màu tô = catalog_hex, không chồng theo cỡ vật lý.
{
  const doc = { canvas: { widthMm: 300, heightMm: 300, pxPerMm: MM_PX }, layers: [{ id: 'PET', name: 'Pet' }],
    palette: PET.colors.map((c) => ({ code: c.code, symbol: c.symbol, rgb: c.fill, dMm: c.dMm })), stones: PET.map.stones.map((s) => ({ ...s, layer: 'PET' })) };
  const svg = writeKitSvg(doc), back = readKitSvg(svg), chk = checkDesign(back);
  ok(chk.ok && chk.codes <= 13 && chk.overlaps === 0 && back.stones.length === PET.map.stones.length, `K: SVG pet ${back.stones.length} viên ${chk.codes} mã qua luật (${chk.errors.slice(0, 3)})`);
  ok(back.stones.every((s) => s.group === groupOf(s.code, CAT.codes[s.code].physMm) && s.dMm === CAT.codes[s.code].refMm) && back.palette.every((p) => p.rgb === CAT.codes[p.code].fill) && /data-group="K_L\d+_S2\.8"/.test(svg) && /data-width-mm="2\.200000"/.test(svg),
    'K: data-group theo vật lý, ellipse vẽ reference, màu tô = catalog_hex');
  const bad = (f, re, msg) => { const c = checkDesign(f(structuredClone(back))); ok(!c.ok && c.errors.some((e) => re.test(e)), `K: bắt lỗi ${msg} (${c.errors[0]})`); };
  const top = back.palette[0].code, sec = back.palette[1].code;
  bad((d) => { d.palette[0].symbol = '4'; d.stones.forEach((s) => { if (s.code === top) s.symbol = '4'; }); return d; }, /ký hiệu "4" sai luật/, 'đá ký hiệu số');
  bad((d) => { d.palette[1].symbol = d.palette[0].symbol; d.stones.forEach((s) => { if (s.code === sec) s.symbol = d.palette[0].symbol; }); return d; }, /trùng/, 'ký hiệu trùng');
  bad((d) => { d.stones[0].group = `K_${d.stones[0].code}_S${d.stones[0].dMm}`; return d; }, /data-group/, 'data-group theo cỡ vẽ');
  bad((d) => { d.palette[0].rgb = '#123456'; return d; }, /≠ catalog/, 'màu khác catalog');
  bad((d) => { d.palette[0].code = 'L33'; d.stones.forEach((s) => { if (s.code === top) s.code = 'L33'; }); return d; }, /L33 không có trong catalog/, 'mã ngoài catalog (L33 của SVG cũ)');
  bad((d) => { d.stones[1].x = d.stones[0].x + 2.6 * MM_PX; d.stones[1].y = d.stones[0].y; return d; }, /chồng/, 'chồng viên theo cỡ vật lý (tâm 2.6mm < 2.8mm)');
  const pearl = checkDesign({ canvas: { pxPerMm: MM_PX }, palette: [{ code: '7', symbol: '7', rgb: '#EDE9E2', dMm: 6.2 }, { code: 'L94', symbol: 'A', rgb: '#EFEDEA', dMm: 2.2 }],
    stones: [{ id: 'P1', code: '7', symbol: '7', x: 100, y: 100, dMm: 6.2, group: 'K_7_S7' }, { id: 'P2', code: 'L94', symbol: 'A', x: 100 + 5 * MM_PX, y: 100, dMm: 2.2, group: 'K_L94_S2.8' }] });
  ok(pearl.ok, `K: ngọc trai 7mm ký hiệu "7", vẽ 6.2, K_7_S7 hợp luật (${pearl.errors})`);
}

console.log(fail ? `${fail} FAIL` : 'kit place ok');
process.exit(fail ? 1 : 0);
