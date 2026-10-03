// KIT-25 chấm bản đồ (SVG kit20) với sản phẩm thật trong kit/db/kit.sqlite: vùng phủ (fill) và vùng chi tiết riêng.
//   node tools/kit25_score_db.mjs --svg outputs/kit/kit25/king/king.svg --regions outputs/kit/kit25/king/fill_regions.json --product king
//        [--align auto|none|dx,dy,s] [--out <json>]
// Khung: ảnh trang phục (Lanczos → 3543 px = 300 mm) có thể lệch khung sản phẩm → --align auto tìm tịnh tiến + tỉ lệ (lưới thô → mịn)
// sao cho viên ≥ 4 mm của bản đồ khớp viên ≥ 4 mm của DB nhiều nhất; chỉ chấm trong hộp bao trang phục của bản đồ (DB còn có nền / mặt).
// Ghép viên: gần nhất trước, tâm < ½ · max(1.5, cỡ DB) mm. Mỗi vùng phủ (đa giác của file vùng): viên DB / bản đồ trong đa giác — số
// viên, phủ (% diện tích), mã / chất liệu / cỡ chủ đạo; vùng phủ DB (thành phần cùng mã ≥ 3 láng giềng, tools/kit25_fill_learn.mjs) nằm
// trong đa giác của ta bao nhiêu (recall) và viên DB trong đa giác là viên vùng phủ DB bao nhiêu (precision).
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { loadCatalog, entryOf } from '../lib/kit/catalog.js';
import { readKitSvg } from '../lib/kit/svgio.js';
import { inRegion, regionAreaMm2, readFillRegions } from '../lib/kit/fill.js';
import { mat4Of } from './score_template_gt.mjs';
import { lab } from '../lib/kit/select.js';
import { learn } from './kit25_fill_learn.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), PPM = 11.81;
const args = process.argv.slice(2), flag = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const cat = loadCatalog();
const pc = (a, b) => (b ? Math.round((1000 * a) / b) / 10 : null);
const r2 = (v) => +v.toFixed(2);
const top = (v) => { const o = {}; for (const k of v) o[k] = (o[k] || 0) + 1; const e = Object.entries(o).sort((a, b) => b[1] - a[1]); return e.length ? { key: e[0][0], share: pc(e[0][1], v.length) } : null; };
const inCat = (code) => { try { return !!entryOf(code, cat)?.fill; } catch { return false; } }; // mã sản phẩm thật có trong catalog hiện tại
const areaOf = (s) => (s.shape && s.shape !== 'round' ? 0.7 * s.w * s.h : (Math.PI * s.d * s.d) / 4);

export function scoreDb({ svg, regionsFile, product, align = 'auto' }) {
  const doc = readKitSvg(fs.readFileSync(svg, 'utf8')), k = doc.canvas.widthPx / 300;
  const ours = doc.stones.map((s) => { const e = entryOf(s.code, cat); return { x: s.x / k, y: s.y / k, code: s.code, d: e.physMm ?? Math.max(e.physW, e.physH), w: e.physW, h: e.physH, shape: e.shape, mat: mat4Of(s.code) }; });
  const db = new DatabaseSync(path.join(ROOT, 'kit', 'db', 'kit.sqlite'));
  // mã ngoài catalog hiện tại (vd L5, L96 của Queen thật): chất liệu từ series / màu SVG như mat4Of (ngọc, vàng = hue 60–100° C* ≥ 40, trắng)
  const matDb = (s) => { try { return mat4Of(s.code); } catch { if (s.series === 'PEARL') return 'pearl'; const [L, a, b] = lab(s.hex.match(/\w\w/g).map((v) => parseInt(v, 16))), C = Math.hypot(a, b), hue = (Math.atan2(b, a) * 180) / Math.PI; return L >= 75 && C <= 12 ? 'white' : C >= 40 && hue >= 60 && hue <= 100 ? 'gold' : 'color'; } };
  const DB0 = db.prepare('SELECT x_mm x, y_mm y, physical_mm d, code, shape, svg_w_mm w, svg_h_mm h, catalog_series series, svg_fill_hex hex FROM stones WHERE product = ?').all(product).map((s) => ({ ...s, shape: s.shape === 'round' ? undefined : s.shape, mat: matDb(s) }));
  const regions = regionsFile ? readFillRegions(regionsFile).regions.filter((r) => r.enabled !== false).map((r) => ({ ...r, mm: { polygon: r.polygon.map(([x, y]) => [x / PPM, y / PPM]), holes: (r.holes || []).map((q) => q.map(([x, y]) => [x / PPM, y / PPM])) } })) : [];
  // căn khung: DB → khung bản đồ: x' = s·(x − 150) + 150 + dx
  const bigO = ours.filter((s) => s.d >= 4), bigD = DB0.filter((s) => s.d >= 4);
  const hits = (dx, dy, sc) => { let n = 0; for (const t of bigD) { const x = sc * (t.x - 150) + 150 + dx, y = sc * (t.y - 150) + 150 + dy; if (bigO.some((o) => Math.abs(o.x - x) < 1.5 && Math.abs(o.y - y) < 1.5)) n++; } return n; };
  let A = { dx: 0, dy: 0, s: 1 };
  if (align === 'auto') {
    let best = { n: hits(0, 0, 1), ...A };
    for (const [step, span, ss] of [[2, 30, [0.9, 0.95, 1, 1.05, 1.1]], [0.5, 3, [-0.02, -0.01, 0, 0.01, 0.02]], [0.2, 0.6, [-0.004, 0, 0.004]]]) {
      const c = { ...best };
      for (const sv of ss) for (let dx = c.dx - span; dx <= c.dx + span + 1e-9; dx += step) for (let dy = c.dy - span; dy <= c.dy + span + 1e-9; dy += step) {
        const s = step === 2 ? sv : c.s + sv, n = hits(dx, dy, s);
        if (n > best.n) best = { n, dx, dy, s };
      }
    }
    A = { dx: r2(best.dx), dy: r2(best.dy), s: +best.s.toFixed(3), bigMatched: best.n, bigDb: bigD.length, bigOurs: bigO.length };
  } else if (align !== 'none') { const [dx, dy, s] = align.split(',').map(Number); A = { dx, dy, s }; }
  const T = (t) => ({ ...t, x: A.s * (t.x - 150) + 150 + A.dx, y: A.s * (t.y - 150) + 150 + A.dy, d: t.d * A.s });
  const box = [Math.min(...ours.map((s) => s.x)), Math.min(...ours.map((s) => s.y)), Math.max(...ours.map((s) => s.x)), Math.max(...ours.map((s) => s.y))];
  const inBox = (s) => s.x >= box[0] - 1 && s.y >= box[1] - 1 && s.x <= box[2] + 1 && s.y <= box[3] + 1;
  // vùng phủ DB (cùng định nghĩa tools/kit25_fill_learn.mjs)
  const fillDb = new Set();
  for (const r of learn(product, { members: true }).regions) for (const m of r.members) fillDb.add(`${m.x},${m.y}`);
  for (const s of DB0) s.fill = fillDb.has(`${s.x},${s.y}`);
  const DB = DB0.map(T).filter(inBox);
  const inAny = (s) => regions.find((r) => inRegion(s.x, s.y, r.mm));
  // ghép viên
  const pairs = [];
  ours.forEach((o, i) => DB.forEach((g, j) => { const dd = Math.hypot(o.x - g.x, o.y - g.y); if (dd < 0.5 * Math.max(1.5, g.d)) pairs.push([dd, i, j]); }));
  pairs.sort((a, b) => a[0] - b[0]);
  const uo = new Set(), ug = new Set(), M = [];
  for (const [, i, j] of pairs) if (!uo.has(i) && !ug.has(j)) { uo.add(i); ug.add(j); M.push([ours[i], DB[j]]); }
  const zone = (inside) => {
    const G = DB.filter((g) => !!inAny(g) === inside), O = ours.filter((o) => !!inAny(o) === inside), MM = M.filter(([, g]) => !!inAny(g) === inside);
    return { db: G.length, ours: O.length, matched: MM.length, recall: pc(MM.length, G.length), precision: pc(MM.length, O.length),
      materialOk: pc(MM.filter(([o, g]) => o.mat === g.mat).length, MM.length), sizeOk: pc(MM.filter(([o, g]) => Math.abs(o.d - g.d / A.s) < 0.3).length, MM.length), codeOk: pc(MM.filter(([o, g]) => o.code === g.code).length, MM.length) };
  };
  const perRegion = regions.map((r) => {
    const a = regionAreaMm2(r.mm, 1), G = DB.filter((g) => inRegion(g.x, g.y, r.mm)), O = ours.filter((o) => inRegion(o.x, o.y, r.mm));
    const tg = top(G.map((g) => g.code)), to = top(O.map((o) => o.code));
    const gMat = top(G.map((g) => g.mat)), gSize = top(G.map((g) => g.d / A.s));
    return { id: r.id, material: r.material, areaMm2: Math.round(a), db: { n: G.length, coverPct: pc(G.reduce((s, g) => s + areaOf(g), 0), a), code: tg, material: gMat, sizeMm: gSize && { key: +(+gSize.key).toFixed(1), share: gSize.share }, fillStonesPct: pc(G.filter((g) => g.fill).length, G.length) },
      ours: { n: O.length, coverPct: pc(O.reduce((s, o) => s + areaOf(o), 0), a), code: to, sizeMm: r.physMm },
      codeOk: !!(tg && to && tg.key === to.key), dbCodeInCatalog: !!tg && inCat(tg.key), materialOk: !!(gMat && gMat.key === r.material), sizeOk: !!(gSize && Math.abs(+gSize.key - r.physMm) < 0.3), countRatio: G.length ? r2(O.length / G.length) : null };
  });
  const nF = DB.filter((g) => g.fill).length, nFin = DB.filter((g) => g.fill && inAny(g)).length, nIn = DB.filter((g) => inAny(g)).length;
  const fr = perRegion.filter((r) => r.db.n);
  return {
    product, svg: path.relative(ROOT, svg), regions: regionsFile && path.relative(ROOT, regionsFile), align: A, box: box.map(Math.round),
    all: zone(false).db + zone(true).db ? { db: DB.length, ours: ours.length, matched: M.length, recall: pc(M.length, DB.length), precision: pc(M.length, ours.length) } : null,
    fillZone: zone(true), detailZone: zone(false),
    dbFillInOurRegions: { dbFillStones: nF, inside: nFin, recall: pc(nFin, nF), precision: pc(nFin, nIn) },
    regionSummary: { n: perRegion.length, withDb: fr.length, codeOk: fr.filter((r) => r.codeOk).length, codeAttainable: fr.filter((r) => r.dbCodeInCatalog).length, materialOk: fr.filter((r) => r.materialOk).length, sizeOk: fr.filter((r) => r.sizeOk).length,
      dbCoverPct: pc(fr.reduce((s, r) => s + (r.db.coverPct * r.areaMm2) / 100, 0), fr.reduce((s, r) => s + r.areaMm2, 0)), oursCoverPct: pc(fr.reduce((s, r) => s + (r.ours.coverPct * r.areaMm2) / 100, 0), fr.reduce((s, r) => s + r.areaMm2, 0)),
      dbStones: fr.reduce((s, r) => s + r.db.n, 0), ourStones: fr.reduce((s, r) => s + r.ours.n, 0) },
    perRegion,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = scoreDb({ svg: path.resolve(flag('--svg')), regionsFile: flag('--regions') && path.resolve(flag('--regions')), product: flag('--product'), align: flag('--align', 'auto') });
  if (flag('--out')) fs.writeFileSync(path.resolve(flag('--out')), JSON.stringify(r, null, 1));
  const { perRegion, ...head } = r;
  console.log(JSON.stringify(head));
  for (const x of perRegion) console.log(`${x.id} ${x.material} ${x.areaMm2} mm² | DB ${x.db.n} viên phủ ${x.db.coverPct}% ${x.db.code?.key}(${x.db.code?.share}%) ${x.db.sizeMm?.key} mm fill ${x.db.fillStonesPct}% | ta ${x.ours.n} phủ ${x.ours.coverPct}% ${x.ours.code?.key} ${x.ours.sizeMm} mm | mã ${x.codeOk ? '✓' : x.dbCodeInCatalog ? '✗' : '✗ (mã DB ngoài catalog)'} chất liệu ${x.materialOk ? '✓' : '✗'} cỡ ${x.sizeOk ? '✓' : '✗'} số ${x.countRatio}`);
}
