// KIT-12a tầng: chấm DETECT theo tầng trên sản phẩm thật (kit/db/kit.sqlite, Snowman + Dachshund), không gọi API, ~8 s.
//   node tools/bench_kit_tiers.mjs [--opt '{"clusterMin":2}'] [--hint 60] [--noise 0.3] [--pids snowman,dachshund]
// Tầng 1–2 (DB ≥ 5 mm): hit = viên dò (≥ 4.5 mm) chứa tâm DB, ok = đúng cỡ vật lý, fp = viên dò không chứa tâm DB ≥ 5 mm.
// Tầng 3 (DB < 5 mm vs dò tầng 3): sai số ĐẾM tổng + theo vật liệu (gold/white/color, materialOf), ghép 1-1 gần nhất ≤ 1.6 mm →
// recall / precision / đúng cỡ / đúng vật liệu + ma trận nhầm (DB>dò).
// --hint T: countHints giả lập từ DB (lưới ô T mm, đếm hạt < 5 mm theo vật liệu; --noise ±tỉ lệ, tất định) = trần của KIT-13.
// Vật liệu DB: series PEARL → pearl; họ 16 / GOLD → gold; họ 94 (trắng đục) / 1 (pha lê) → white; còn lại → color.
// Ra outputs/kit/tiers/report.json. KIT_REQ = thư mục requirements.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { decodePng } from '../lib/png.js';
import { detectBeads, backgroundMask } from '../lib/kit/detect.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2), flag = (n) => { const i = args.indexOf(n); return i >= 0 ? args.splice(i, 2)[1] : null; };
const opt = JSON.parse(flag('--opt') || '{}'), tileMm = +flag('--hint') || 0, noise = +flag('--noise') || 0, pids = (flag('--pids') || 'snowman,dachshund').split(',');
const REQ = process.env.KIT_REQ || path.join(process.cwd(), 'requirements'), OUT = path.join(ROOT, 'outputs', 'kit', 'tiers');
const db = new DatabaseSync(path.join(ROOT, 'kit', 'db', 'kit.sqlite'), { readOnly: true });
const matOf = (t) => (t.s === 'PEARL' ? 'pearl' : /16$|GOLD/.test(t.code + t.f) ? 'gold' : /^(94|1)$/.test(t.f) ? 'white' : 'color');
const pct = (a, b) => (b ? Math.round((100 * (a - b)) / b) : null), r3 = (v) => Math.round(v * 1000) / 1000;
const report = { opt, hint: tileMm ? { tileMm, noise } : null, products: {} };
fs.mkdirSync(OUT, { recursive: true });
for (const pid of pids) {
  const p = db.prepare('select * from products where id = ?').get(pid);
  const img = decodePng(fs.readFileSync(path.join(REQ, p.clean_image))), sc = img.w / p.viewbox_px, ppm = sc * p.px_per_mm;
  const st = db.prepare('select code, catalog_family f, cx_px x, cy_px y, physical_mm d, catalog_series s from stones where product = ?').all(pid)
    .map((t) => ({ ...t, x: t.x * sc, y: t.y * sc, m: matOf(t) }));
  const extra = {};
  if (tileMm) {
    const T = tileMm * ppm, hs = []; let seed = 7;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let y = 0; y < img.h; y += T) for (let x = 0; x < img.w; x += T) {
      const c = {};
      for (const t of st) if (t.d < 5 && t.x >= x && t.x < x + T && t.y >= y && t.y < y + T) c[t.m] = (c[t.m] || 0) + 1;
      for (const m of ['gold', 'white', 'color']) c[m] = Math.round((c[m] || 0) * (1 + noise * (2 * rnd() - 1)));
      hs.push({ bbox: [x, y, Math.min(img.w, x + T), Math.min(img.h, y + T)], counts: c });
    }
    extra.countHints = hs;
  }
  const bg = backgroundMask(img), t0 = Date.now();
  const r = detectBeads(img, { canvasWmm: p.canvas_mm, stoneMm: 2.2, gapMm: 0.4, accentMm: [3.2, 4.2, 5.2, 7.2, 9.2, 11.2], ...opt, ...extra }, bg.pct.bg ? bg.mask : null);
  const det = r.stones, ms = Date.now() - t0;
  // tầng 1–2
  const bigD = det.filter((d) => d.physMm >= 4.5), byBig = new Map(); let fp = 0;
  for (const b of bigD) {
    const t = st.filter((t) => Math.hypot(t.x - b.x, t.y - b.y) < b.rPx).sort((u, v) => (v.d >= 5) - (u.d >= 5) || Math.hypot(u.x - b.x, u.y - b.y) - Math.hypot(v.x - b.x, v.y - b.y))[0];
    if (t?.d >= 5 && !byBig.has(t)) byBig.set(t, b); else fp++;
  }
  const B = st.filter((t) => t.d >= 5), rows = {};
  for (const t of B) { const k = t.s + t.d, row = (rows[k] ||= { n: 0, hit: 0, ok: 0 }), b = byBig.get(t); row.n++; if (b) { row.hit++; if (b.physMm === t.d) row.ok++; } }
  // tầng 3
  const S = st.filter((t) => t.d < 5), Sd = det.filter((d) => d.tier === 3), pairs = [];
  for (const d of Sd) for (const t of S) { const dd = Math.hypot(t.x - d.x, t.y - d.y); if (dd < 1.6 * ppm) pairs.push([dd, d, t]); }
  pairs.sort((a, b) => a[0] - b[0]);
  const ud = new Set(), ut = new Set(), mt = [];
  for (const [, d, t] of pairs) if (!ud.has(d) && !ut.has(t)) { ud.add(d); ut.add(t); mt.push([d, t]); }
  const byMat = {}, conf = {};
  for (const m of ['gold', 'white', 'color', 'pearl']) { const a = S.filter((t) => t.m === m).length, b = Sd.filter((d) => d.material === m).length; if (a || b) byMat[m] = { db: a, det: b, countErrPct: pct(b, a) }; }
  for (const [d, t] of mt) conf[`${t.m}>${d.material}`] = (conf[`${t.m}>${d.material}`] || 0) + 1;
  report.products[pid] = { ms, stones: det.length, tiers: r.work.tiers,
    big: { db: B.length, hit: byBig.size, sizeOk: [...byBig].filter(([t, b]) => b.physMm === t.d).length, fp, rows },
    small: { db: S.length, det: Sd.length, countErrPct: pct(Sd.length, S.length), matched: mt.length, recall: r3(mt.length / S.length), precision: r3(mt.length / Math.max(1, Sd.length)),
      sizeOk: r3(mt.filter(([d, t]) => d.physMm === t.d).length / Math.max(1, mt.length)), materialOk: r3(mt.filter(([d, t]) => d.material === t.m).length / Math.max(1, mt.length)), byMaterial: byMat, confusion: conf } };
  const P = report.products[pid];
  console.log(`${pid}: ${det.length} viên ${JSON.stringify(r.work.tiers)} ${(ms / 1000).toFixed(1)}s | ≥5mm hit ${P.big.hit}/${P.big.db} đúng cỡ ${P.big.sizeOk} fp ${P.big.fp}`
    + ` | nhỏ ${P.small.det}/${P.small.db} (${P.small.countErrPct}%) R ${P.small.recall} P ${P.small.precision} cỡ ${P.small.sizeOk} vật liệu ${P.small.materialOk}`
    + ` | ${Object.entries(byMat).map(([m, v]) => `${m} ${v.det}/${v.db} (${v.countErrPct}%)`).join(' ')}`);
}
fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 1) + '\n');
console.log(path.join(OUT, 'report.json'));
