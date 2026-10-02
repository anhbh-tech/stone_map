// KIT-18: chấm SVG mẫu trang phục (vd kit/templates/queen_costume_chain.svg) bằng đáp án tay KIT-15 outputs/kit/queen_gt/{heart,pearls,cape}.json
//   node tools/score_template_gt.mjs [svg …]   (offline; cùng luật ghép của tools/queen_gt.mjs build: tâm < ½ · max(1.5, cỡ GT) mm, gần nhất trước)
// Mỗi viên bản đồ → mat4 theo mã catalog: ngọc trai = pearl, vàng (materialOf) = gold, trắng / trong (L* ≥ 75, C* ≤ 12) = white, còn lại = color;
// cỡ = cỡ vật lý (viên hình: cạnh dài). Ra recall / precision / vật liệu đúng / cỡ đúng mỗi ô + riêng viên GT ≥ 4 mm.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCatalog, entryOf } from '../lib/kit/catalog.js';
import { readKitSvg } from '../lib/kit/svgio.js';
import { materialOf, lab } from '../lib/kit/select.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..'), PPM = 11.81;
const GT = path.join(ROOT, 'outputs', 'kit', 'queen_gt'), TILES = ['heart', 'pearls', 'cape'];
const cat = loadCatalog();
const hex2 = (h) => h.match(/\w\w/g).map((v) => parseInt(v, 16));
export function mat4Of(code) {
  const e = entryOf(code, cat);
  if (e.kind === 'pearl') return 'pearl';
  if (materialOf(e) === 'gold') return 'gold';
  const [L, a, b] = lab(hex2(e.fill));
  return L >= 75 && Math.hypot(a, b) <= 12 ? 'white' : 'color';
}
const pc = (a, b) => (b ? Math.round((1000 * a) / b) / 10 : null);
export function scoreSvg(file) {
  const d = readKitSvg(fs.readFileSync(file, 'utf8')), S = d.canvas.widthPx / 3543;
  return { file: path.relative(ROOT, file), ...scoreStones(d.stones.map((s) => ({ x: s.x / S, y: s.y / S, code: s.code }))) };
}
// stones: [{ x, y (px trên 3543), code }]
export function scoreStones(list) {
  const stones = list.map((s) => { const e = entryOf(s.code, cat); return { x: s.x, y: s.y, code: s.code, physMm: e.physMm, mat4: mat4Of(s.code), shape: e.shape || 'round' }; });
  const out = { tiles: {} };
  const tot = { gt: 0, map: 0, matched: 0, mat: 0, size: 0, big: 0, bigMatched: 0, bigMat: 0, bigSize: 0 };
  for (const id of TILES) {
    const gt = JSON.parse(fs.readFileSync(path.join(GT, `${id}.json`), 'utf8')), t = gt.tile, G = gt.stones;
    const D = stones.filter((s) => s.x >= t.x && s.y >= t.y && s.x < t.x + t.w && s.y < t.y + t.h), pairs = [];
    D.forEach((p, i) => G.forEach((g, j) => { const dd = Math.hypot(p.x - g.x, p.y - g.y); if (dd < 0.5 * Math.max(1.5, g.measuredMm || g.physMm) * PPM) pairs.push([dd, i, j]); }));
    pairs.sort((a, b) => a[0] - b[0]);
    const ud = new Set(), ug = new Set(), mt = [];
    for (const [, i, j] of pairs) if (!ud.has(i) && !ug.has(j)) { ud.add(i); ug.add(j); mt.push([D[i], G[j]]); }
    const conf = {};
    for (const [p, g] of mt) if (p.mat4 !== g.mat4 || p.physMm !== g.physMm) { const k = `${g.mat4}/${g.physMm}→${p.mat4}/${p.physMm}`; conf[k] = (conf[k] || 0) + 1; }
    const big = G.filter((g) => g.physMm >= 4), bm = mt.filter(([, g]) => g.physMm >= 4);
    const r = { gt: G.length, checked: !!gt.checked, map: D.length, matched: mt.length, recall: pc(mt.length, G.length), precision: pc(mt.length, D.length),
      materialOk: pc(mt.filter(([p, g]) => p.mat4 === g.mat4).length, mt.length), sizeOk: pc(mt.filter(([p, g]) => p.physMm === g.physMm).length, mt.length),
      gt4mm: { n: big.length, recall: pc(bm.length, big.length), materialOk: pc(bm.filter(([p, g]) => p.mat4 === g.mat4).length, bm.length), sizeOk: pc(bm.filter(([p, g]) => p.physMm === g.physMm).length, bm.length) },
      wrong: Object.fromEntries(Object.entries(conf).sort((a, b) => b[1] - a[1]).slice(0, 8)) };
    out.tiles[id] = r;
    tot.gt += G.length; tot.map += D.length; tot.matched += mt.length; tot.mat += mt.filter(([p, g]) => p.mat4 === g.mat4).length; tot.size += mt.filter(([p, g]) => p.physMm === g.physMm).length;
    tot.big += big.length; tot.bigMatched += bm.length; tot.bigMat += bm.filter(([p, g]) => p.mat4 === g.mat4).length; tot.bigSize += bm.filter(([p, g]) => p.physMm === g.physMm).length;
  }
  out.total = { gt: tot.gt, map: tot.map, recall: pc(tot.matched, tot.gt), precision: pc(tot.matched, tot.map), materialOk: pc(tot.mat, tot.matched), sizeOk: pc(tot.size, tot.matched),
    gt4mm: { n: tot.big, recall: pc(tot.bigMatched, tot.big), materialOk: pc(tot.bigMat, tot.bigMatched), sizeOk: pc(tot.bigSize, tot.bigMatched) } };
  return out;
}
if (import.meta.url === `file://${process.argv[1]}`) {
  const files = process.argv.slice(2).length ? process.argv.slice(2) : [path.join(ROOT, 'kit', 'templates', 'queen_costume_chain.svg')];
  for (const f of files) { const r = scoreSvg(path.resolve(f)); console.log(JSON.stringify(r)); }
}
