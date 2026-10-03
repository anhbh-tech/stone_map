// KIT-25 quy ước vùng phủ (fill) học từ sản phẩm thật trong kit/db/kit.sqlite (snowman, dachshund — compliant=1).
// Vùng phủ = thành phần liên thông CÙNG MÃ (khe vật lý < 0.8 mm) mà phần lớn viên có ≥ 3 láng giềng cùng mã (2 chiều, không phải
// chuỗi 1 hàng). Đo: cỡ, bước (tâm–tâm / cỡ), khe, kiểu xếp (ψ6 lục giác vs hàng: 2 láng giềng gần thẳng hàng), mật độ phủ
// cục bộ (viên trong), có xen 2 cỡ cùng chất liệu không, số viên / vùng.
//   node tools/kit25_fill_learn.mjs [--out outputs/kit/kit25/fill_learn.json]
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2), flag = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const OUT = path.resolve(ROOT, flag('--out', 'outputs/kit/kit25/fill_learn.json'));
const db = new DatabaseSync(path.join(ROOT, 'kit', 'db', 'kit.sqlite'));
const TOUCH = 0.8, MIN_N = 15;
const med = (v) => { const s = [...v].sort((a, b) => a - b); return s.length ? s[s.length >> 1] : null; };
const q = (v, p) => { const s = [...v].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : null; };
const r2 = (v) => (v == null ? null : +v.toFixed(2));
const matOf = (s) => (s.series === 'PEARL' ? 'pearl' : s.family || '?');

export function learn(product, { members = false } = {}) {
  const S = db.prepare('SELECT x_mm x, y_mm y, physical_mm d, code, catalog_series series, catalog_family family FROM stones WHERE product = ?').all(product);
  const cell = 6, G = new Map(), key = (x, y) => `${Math.floor(x / cell)},${Math.floor(y / cell)}`;
  S.forEach((s, i) => { s.i = i; const k = key(s.x, s.y); (G.get(k) || G.set(k, []).get(k)).push(s); });
  for (const s of S) {
    s.nb = []; const gx = Math.floor(s.x / cell), gy = Math.floor(s.y / cell);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) for (const t of G.get(`${gx + dx},${gy + dy}`) || []) {
      if (t === s) continue;
      const D = Math.hypot(t.x - s.x, t.y - s.y), gap = D - (s.d + t.d) / 2;
      if (gap < TOUCH) s.nb.push({ t, D, gap, ang: Math.atan2(t.y - s.y, t.x - s.x) });
    }
    s.same = s.nb.filter((n) => n.t.code === s.code);
  }
  // thành phần cùng mã
  const comp = new Int32Array(S.length).fill(-1), comps = [];
  for (const s of S) {
    if (comp[s.i] >= 0) continue;
    const c = [], st = [s]; comp[s.i] = comps.length;
    while (st.length) { const u = st.pop(); c.push(u); for (const n of u.same) if (comp[n.t.i] < 0) { comp[n.t.i] = comps.length; st.push(n.t); } }
    comps.push(c);
  }
  const fills = [], chains = [];
  for (const c of comps) {
    if (c.length < MIN_N) continue;
    const deg = c.map((s) => s.same.length), twoD = deg.filter((d) => d >= 3).length / c.length;
    (twoD >= 0.5 ? fills : chains).push({ c, twoD });
  }
  const regions = fills.map(({ c, twoD }) => {
    const s0 = c[0], inner = c.filter((s) => s.same.length >= 3);
    // ψ6 (lục giác: 6 láng giềng cách 60°) và "hàng": 2 láng giềng gần nhất gần thẳng hàng (góc ≥ 150°) + láng giềng thứ 3 xa hơn ≥ 15 %
    const psi6 = med(inner.map((s) => { let re = 0, im = 0; for (const n of s.same) { re += Math.cos(6 * n.ang); im += Math.sin(6 * n.ang); } return Math.hypot(re, im) / s.same.length; }));
    const rowish = inner.filter((s) => {
      const nn = [...s.nb].sort((a, b) => a.D - b.D);
      if (nn.length < 3) return false;
      const da = Math.abs(((nn[0].ang - nn[1].ang + 3 * Math.PI) % (2 * Math.PI)) - Math.PI);
      return da <= Math.PI / 6 && nn[2].D >= 1.15 * nn[1].D;
    }).length / Math.max(1, inner.length);
    const nn1 = c.map((s) => Math.min(...s.nb.map((n) => n.D))), gaps = c.map((s) => Math.min(...s.nb.map((n) => n.gap)));
    const nn3 = inner.map((s) => [...s.nb].sort((a, b) => a.D - b.D)[2]?.D).filter(Boolean);
    // mật độ phủ cục bộ: viên trong (≥ 5 láng giềng bất kỳ) — Σ diện tích viên (mọi mã) trong bán kính 3·bước / diện tích tròn
    const pitch = med(nn1), R = 3 * pitch;
    const dens = c.filter((s) => s.nb.length >= 5).map((s) => {
      let a = Math.PI * (s.d / 2) ** 2; const gx = Math.floor(s.x / cell), gy = Math.floor(s.y / cell);
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) for (const t of G.get(`${gx + dx},${gy + dy}`) || []) if (t !== s && Math.hypot(t.x - s.x, t.y - s.y) <= R) a += Math.PI * (t.d / 2) ** 2;
      return a / (Math.PI * R * R);
    });
    // xen cỡ: láng giềng chạm khác mã, CÙNG chất liệu (họ màu / ngọc), khác cỡ
    const mixN = c.filter((s) => s.nb.some((n) => n.t.code !== s.code && matOf(n.t) === matOf(s) && n.t.d !== s.d)).length;
    const otherCodes = {}; for (const s of c) for (const n of s.nb) if (n.t.code !== s.code) otherCodes[n.t.code] = (otherCodes[n.t.code] || 0) + 1;
    return {
      code: s0.code, series: s0.series, family: s0.family, sizeMm: s0.d, n: c.length, twoD: r2(twoD),
      pitchMm: r2(pitch), pitchPerSize: r2(pitch / s0.d), gapMm: { p10: r2(q(gaps, 0.1)), med: r2(med(gaps)), p90: r2(q(gaps, 0.9)) },
      nn3PerNn1: r2(med(nn3) / pitch), psi6: r2(psi6), rowFrac: r2(rowish), density: r2(med(dens)), mixSizeFrac: r2(mixN / c.length),
      touchOtherCodes: Object.entries(otherCodes).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${k}:${v}`).join(' '),
      ...(members ? { members: c.map((s) => ({ x: s.x, y: s.y, d: s.d, code: s.code })) } : {}),
      bbox: [Math.min(...c.map((s) => s.x)), Math.min(...c.map((s) => s.y)), Math.max(...c.map((s) => s.x)), Math.max(...c.map((s) => s.y))].map((v) => Math.round(v)),
    };
  }).sort((a, b) => b.n - a.n);
  const all = (f) => regions.map(f).filter((v) => v != null);
  const W = (f) => { let a = 0, n = 0; for (const r of regions) { const v = f(r); if (v != null) { a += v * r.n; n += r.n; } } return n ? r2(a / n) : null; };
  return {
    product, stones: S.length, components: comps.length, fillRegions: regions.length, chainComps: chains.length,
    fillStones: regions.reduce((a, r) => a + r.n, 0), chainStones: chains.reduce((a, x) => a + x.c.length, 0),
    sizes: Object.fromEntries(Object.entries(regions.reduce((o, r) => ((o[r.sizeMm] = (o[r.sizeMm] || 0) + r.n), o), {})).sort((a, b) => b[1] - a[1])),
    byStoneWeighted: { pitchPerSize: W((r) => r.pitchPerSize), gapMed: W((r) => r.gapMm.med), psi6: W((r) => r.psi6), rowFrac: W((r) => r.rowFrac), density: W((r) => r.density), mixSizeFrac: W((r) => r.mixSizeFrac), nn3PerNn1: W((r) => r.nn3PerNn1) },
    psi6Range: [r2(Math.min(...all((r) => r.psi6))), r2(Math.max(...all((r) => r.psi6)))],
    regions,
  };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
function main() {
const out = { schema: 'pearl-kit25-fill-learn/1', touchMm: TOUCH, minStones: MIN_N, products: ['snowman', 'dachshund'].map(learn) };
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
for (const p of out.products) {
  console.log(`${p.product}: ${p.stones} viên, vùng phủ ${p.fillRegions} (${p.fillStones} viên), chuỗi ${p.chainComps} (${p.chainStones}); cỡ vùng phủ ${JSON.stringify(p.sizes)}; theo viên ${JSON.stringify(p.byStoneWeighted)}`);
  for (const r of p.regions.slice(0, 12)) console.log(`  ${r.code} ${r.sizeMm} mm ×${r.n} 2D ${r.twoD} bước/cỡ ${r.pitchPerSize} khe ${r.gapMm.med} ψ6 ${r.psi6} hàng ${r.rowFrac} nn3/nn1 ${r.nn3PerNn1} phủ ${r.density} xen cỡ ${r.mixSizeFrac} [${r.touchOtherCodes}]`);
}
console.log('→', path.relative(ROOT, OUT));
}
