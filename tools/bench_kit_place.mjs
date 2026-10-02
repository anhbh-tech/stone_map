// Tự kiểm KIT-2 (không so với SVG mẫu — mẫu không phải ground truth, chỉ dùng kiểm định dạng / lấy mặt nạ vùng):
// chạy place() trên ảnh vào, đo chất lượng của chính bản đồ ra. Không gọi API, không nằm trong npm test (~15 s/layer).
//   node tools/bench_kit_place.mjs [starry king queen pet] [--opt '{"rowMm":2.6}'] [--preblur 1.5] [--tag x]
// Ảnh vào: _3 của từng layer trong mặt nạ vùng đá layer đó (_3 là ảnh hạt → làm mờ Gauss --preblur mm trước khi đặt,
// mặc định 1.5mm) + ảnh pet thật tools/fixtures/kit_pet_pom.png (raster sạch, mặt nạ như test, phóng lên 130mm).
// Số liệu (1 dòng / ảnh):
//  (a) render bản đồ (KIT-1 renderMap 'clean', lỗ trống = xám 50%) vs ảnh vào, cả hai làm mờ Gauss σ = 1 bước đá:
//      ΔE00 trung bình + SSIM (độ sáng L, trên lưới thu nhỏ ~4 px/bước, cửa sổ Gauss σ 1.5) trong mặt nạ
// Mã / màu từ catalog (lib/kit/catalog.js); (a) render vẽ cỡ reference như SVG, (b)–(d) dùng cỡ VẬT LÝ (physMm).
//  (b) mật độ phủ (Σ diện tích đĩa / diện tích mặt nạ) so với xếp lục giác lý thuyết π(d/2)² / (√3/2·p²)
//  (c) số cặp vi phạm khoảng cách tối thiểu (r1 + r2 + khe cứng) và số cặp chồng (< r1 + r2) — phải = 0
//  (d) % diện tích mặt nạ không có đá: còn đặt thêm được 1 viên chính (cách mép ≥ r, cách mọi viên ≥ r1 + r2 + khe)
//  (e) % viên lẻ màu: không viên cùng mã nào trong 1.25 bước
// KIT_SRC = thư mục "FIle Map đá"; PEARL_VENV_PY = python có OpenCV (đọc JPEG _3), mặc định ./.venv.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { place, rgbToLab, de2000 } from '../lib/kit/place.js';
import { loadCatalog } from '../lib/kit/catalog.js';
import { stoneField, renderMap, edt2 } from '../lib/kit/render.js';
import { LAYERS, shrinkOnWhite, grid } from '../lib/kit/build.js';
import { pixelIO } from '../lib/pixels.js';
import { decodePng, encodePng } from '../lib/png.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2), flag = (n) => { const i = args.indexOf(n); return i >= 0 ? args.splice(i, 2)[1] : null; };
const opt = JSON.parse(flag('--opt') || '{}'), tag = flag('--tag') || '', preblurMm = +(flag('--preblur') ?? 1.5);
const inputs = args.length ? args : [...Object.keys(LAYERS), 'pet'];
const src = process.env.KIT_SRC || path.join(process.cwd(), 'requirements', 'FIle Map đá');
const py = process.env.PEARL_VENV_PY || [path.join(ROOT, '.venv', 'bin', 'python'), path.join(process.cwd(), '.venv', 'bin', 'python')].find((f) => fs.existsSync(f)) || 'python3';
const OUT = path.join(ROOT, 'outputs', 'kit');
fs.mkdirSync(OUT, { recursive: true });
const catalog = loadCatalog();
const r2 = (v) => Math.round(v * 100) / 100;

// Gauss xấp xỉ (3 lần lọc hộp) trên RGB, trả ảnh mới.
function blurRGB(img, sigma) {
  const { w: W, h: H } = img, out = Uint8Array.from(img.data), r = Math.max(1, Math.round((Math.sqrt(4 * sigma * sigma + 1) - 1) / 2));
  const buf = new Float64Array(Math.max(W, H) + 1), tmp = new Float64Array(Math.max(W, H));
  const line = (o, stride, len) => {
    for (let c = 0; c < 3; c++) {
      buf[0] = 0;
      for (let i = 0; i < len; i++) buf[i + 1] = buf[i] + out[(o + i * stride) * 4 + c];
      for (let i = 0; i < len; i++) { const lo = Math.max(0, i - r), hi = Math.min(len - 1, i + r); tmp[i] = (buf[hi + 1] - buf[lo]) / (hi - lo + 1); }
      for (let i = 0; i < len; i++) out[(o + i * stride) * 4 + c] = Math.round(tmp[i]);
    }
  };
  for (let p = 0; p < 3; p++) { for (let y = 0; y < H; y++) line(y * W, 1, W); for (let x = 0; x < W; x++) line(x, W, H); }
  return { w: W, h: H, data: out };
}
// Thu nhỏ trung bình khối f×f.
const shrink = (a, W, H, f) => {
  const w = Math.floor(W / f), h = Math.floor(H / f), o = new Float32Array(w * h);
  for (let y = 0; y < h * f; y++) for (let x = 0; x < w * f; x++) o[Math.floor(y / f) * w + Math.floor(x / f)] += a[y * W + x];
  for (let i = 0; i < o.length; i++) o[i] /= f * f;
  return { a: o, w, h };
};
// SSIM (Wang 2004) trên 2 ảnh xám (L 0..100) cùng cỡ, cửa sổ Gauss σ 1.5 (bán kính 5), trung bình trong mặt nạ m.
function ssim(x, y, m, W, H) {
  const g = Array.from({ length: 11 }, (_, i) => Math.exp(-((i - 5) ** 2) / 4.5)), gs = g.reduce((a, b) => a + b, 0), C1 = (0.01 * 100) ** 2, C2 = (0.03 * 100) ** 2;
  const conv = (a) => {
    const t = new Float32Array(W * H), o = new Float32Array(W * H);
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) { let s = 0; for (let k = -5; k <= 5; k++) s += a[j * W + Math.min(W - 1, Math.max(0, i + k))] * g[k + 5]; t[j * W + i] = s / gs; }
    for (let i = 0; i < W; i++) for (let j = 0; j < H; j++) { let s = 0; for (let k = -5; k <= 5; k++) s += t[Math.min(H - 1, Math.max(0, j + k)) * W + i] * g[k + 5]; o[j * W + i] = s / gs; }
    return o;
  };
  const mx = conv(x), my = conv(y), xx = conv(x.map((v) => v * v)), yy = conv(y.map((v) => v * v)), xy = conv(x.map((v, i) => v * y[i]));
  let s = 0, n = 0;
  for (let i = 0; i < W * H; i++) {
    if (m[i] < 0.99) continue;
    const vx = xx[i] - mx[i] ** 2, vy = yy[i] - my[i] ** 2, cv = xy[i] - mx[i] * my[i];
    s += ((2 * mx[i] * my[i] + C1) * (2 * cv + C2)) / ((mx[i] ** 2 + my[i] ** 2 + C1) * (vx + vy + C2)); n++;
  }
  return n ? s / n : 0;
}
// Lân cận theo ô lưới px bản đồ.
function buckets(stones, cell) {
  const m = new Map();
  for (const s of stones) { const k = `${Math.floor(s.x / cell)},${Math.floor(s.y / cell)}`; (m.get(k) || m.set(k, []).get(k)).push(s); }
  return (x, y, fn) => { const cx = Math.floor(x / cell), cy = Math.floor(y / cell); for (let j = cy - 1; j <= cy + 1; j++) for (let i = cx - 1; i <= cx + 1; i++) for (const t of m.get(`${i},${j}`) || []) fn(t); };
}

// img: ảnh vào cỡ bản đồ (px bản đồ = px ảnh); mask theo px ảnh.
function selfCheck(img, mask, res, pal) {
  const P = res.params, k = P.pxPerMm, W = img.w, H = img.h, S = res.stones.map((s) => ({ ...s, dPhys: s.physMm })), pitch = P.pitchMm * k, gapMin = P.minMm - P.mainSizeMm;
  // (a) render vs ảnh vào, mờ σ = 1 bước
  const ren = renderMap({ px: Math.max(W, H), stones: res.stones }, pal), comp = { w: W, h: H, data: new Uint8Array(W * H * 4) };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const p = (y * ren.w + x) * 4, q = (y * W + x) * 4, a = ren.data[p + 3] / 255;
    for (let c = 0; c < 3; c++) comp.data[q + c] = Math.round(ren.data[p + c] * a + 128 * (1 - a));
    comp.data[q + 3] = 255;
  }
  const A = blurRGB(img, pitch), B = blurRGB(comp, pitch), LA = new Float32Array(W * H), LB = new Float32Array(W * H);
  let de = 0, nd = 0;
  for (let i = 0; i < W * H; i++) {
    if (!mask[i]) continue;
    const la = rgbToLab(A.data[i * 4], A.data[i * 4 + 1], A.data[i * 4 + 2]), lb = rgbToLab(B.data[i * 4], B.data[i * 4 + 1], B.data[i * 4 + 2]);
    LA[i] = la[0]; LB[i] = lb[0];
    if (i % 7 === 0) { de += de2000(la, lb); nd++; }
  }
  const f = Math.max(1, Math.round(pitch / 4)), sa = shrink(LA, W, H, f), sb = shrink(LB, W, H, f), sm = shrink(Float32Array.from(mask), W, H, f);
  const ss = ssim(sa.a, sb.a, sm.a, sa.w, sa.h);
  // (b) phủ vs lục giác
  let mArea = 0;
  for (let i = 0; i < W * H; i++) mArea += mask[i] ? 1 : 0;
  const cover = S.reduce((a, s) => a + Math.PI * ((s.dPhys * k) / 2) ** 2, 0) / mArea;
  const hexCover = (Math.PI * (P.mainSizeMm / 2) ** 2) / ((Math.sqrt(3) / 2) * P.pitchMm ** 2);
  // (c) vi phạm khoảng cách / chồng
  const near = buckets(S, Math.max(...S.map((s) => s.dPhys)) * k + gapMin * k + 1);
  let viol = 0, over = 0;
  for (const s of S) near(s.x, s.y, (t) => {
    if (t.id <= s.id) return;
    const d = Math.hypot(t.x - s.x, t.y - s.y), rr = ((s.dPhys + t.dPhys) / 2) * k;
    if (d < rr + gapMin * k - 1e-3) viol++;
    if (d < rr - 1e-3) over++;
  });
  // (d) chỗ còn đặt thêm được 1 viên chính
  const blocked = new Uint8Array(W * H), r0 = (P.mainSizeMm / 2) * k;
  for (const s of S) {
    const R = r0 + (s.dPhys / 2) * k + gapMin * k, R2 = R * R;
    for (let y = Math.max(0, Math.floor(s.y - R)); y <= Math.min(H - 1, Math.ceil(s.y + R)); y++) for (let x = Math.max(0, Math.floor(s.x - R)); x <= Math.min(W - 1, Math.ceil(s.x + R)); x++) if ((x + 0.5 - s.x) ** 2 + (y + 0.5 - s.y) ** 2 < R2) blocked[y * W + x] = 1;
  }
  const dIn = edt2(Uint8Array.from(mask, (v) => (v ? 0 : 1)), W, H);
  let free = 0;
  for (let i = 0; i < W * H; i++) if (mask[i] && !blocked[i] && dIn[i] >= r0 * r0) free++;
  // (e) lẻ màu
  const near2 = buckets(S, 1.25 * pitch + 1);
  let stray = 0;
  for (const s of S) { let same = false; near2(s.x, s.y, (q) => { if (q !== s && q.code === s.code && Math.hypot(q.x - s.x, q.y - s.y) <= 1.25 * pitch) same = true; }); if (!same) stray++; }
  return {
    n: S.length, de: r2(de / nd), ssim: Math.round(ss * 1000) / 1000, cover: r2(100 * cover), hexPct: r2((100 * cover) / hexCover),
    viol, over, empty: r2((100 * free) / mArea), stray: r2((100 * stray) / S.length), colors: res.stats.codes, comp,
  };
}

async function load(name) {
  if (name === 'pet') { // ảnh pet thật 360px → cỡ bản đồ 130mm (như test H); mặt nạ = không phải cỏ ∩ elip đầu + cổ
    const s = decodePng(fs.readFileSync(path.join(ROOT, 'tools/fixtures/kit_pet_pom.png'))), N = Math.round(130 * 11.81), f = s.w / N;
    const data = new Uint8Array(N * N * 4), mask = new Uint8Array(N * N);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const u = Math.min(s.w - 1, Math.floor(x * f)), v = Math.min(s.h - 1, Math.floor(y * f)), p = (v * s.w + u) * 4;
      data.set([s.data[p], s.data[p + 1], s.data[p + 2], 255], (y * N + x) * 4);
      mask[y * N + x] = s.data[p + 1] - Math.max(s.data[p], s.data[p + 2]) < 12 && ((u - 165) / 135) ** 2 + ((v - 200) / 160) ** 2 <= 1 ? 1 : 0;
    }
    return { img: { w: N, h: N, data }, mask, blur: 0, opts: {} };
  }
  const ref = JSON.parse(fs.readFileSync(path.join(ROOT, 'kit', `${name}.json`), 'utf8'));
  const base = path.join(src, LAYERS[name]), file = [`${base}_3.png`, `${base}_3.jpg`].find((f) => fs.existsSync(f));
  const io = pixelIO(py, path.join(ROOT, 'tools', 'pixels.py')), img = await io.read(file);
  const { alpha } = stoneField(ref); // bản đồ mẫu chỉ để lấy vùng đá của layer làm mặt nạ
  return { img, mask: Uint8Array.from(alpha, (a) => (a >= 0.5 ? 1 : 0)), blur: preblurMm, opts: { accents: false } };
}

const report = { opt, preblurMm, inputs: {} };
for (const name of inputs) {
  const t0 = Date.now(), { img, mask, blur, opts } = await load(name);
  const res = place(blur > 0 ? blurRGB(img, blur * 11.81) : img, mask, { catalog, ...opts, ...opt });
  const m = selfCheck(img, mask, res, catalog), secs = Math.round((Date.now() - t0) / 1000);
  const { comp, ...row } = m;
  report.inputs[name] = { ...row, kinds: res.stats.kinds, secs };
  console.log(`${name.padEnd(6)} ${m.n} viên ${m.colors} mã | (a) ΔE00 ${m.de} SSIM ${m.ssim} | (b) phủ ${m.cover}% = ${m.hexPct}% lục giác | (c) vi phạm ${m.viol} chồng ${m.over} | (d) trống ${m.empty}% | (e) lẻ ${m.stray}% | ${secs}s`);
  const f = Math.max(1, Math.round(img.w / 1200)), sh = (im) => shrinkOnWhite({ ...im, mask }, f);
  const g = grid([sh(img), sh(comp)], 2);
  fs.writeFileSync(path.join(OUT, `bench_${name}${tag}.png`), encodePng(g.w, g.h, g.data, {}, { rgb: true }));
  fs.writeFileSync(path.join(OUT, `bench_${name}${tag}.json`), JSON.stringify({ px: Math.max(img.w, img.h), stones: res.stones }));
}
fs.writeFileSync(path.join(OUT, `bench_place${tag}.json`), JSON.stringify(report, null, 1) + '\n');
process.exit(0);
