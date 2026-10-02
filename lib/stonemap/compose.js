// SM-P3: ghép nhiều layer (bg < costume < pet) thành 1 design sản phẩm.
//   importKitSvg(svg, { layer, cat, locked }) → stones: map `pearl-kit-map/1` (lib/kit/svgio.js) → viên stonemap (mm, cỡ vật lý theo catalog).
//   importTemplate(file, { layer, variant, cat }) → { stones, template, mask }: kit/templates/<name>_template.json (KIT-16);
//     viên khớp `big` (queen_big.json, captain sửa tay: cùng mã, tâm lệch < 0.5 mm) thành locked.
//   importPetStones(list, { pxPerMm, cat }) → stones layer pet: [{ x, y (px ảnh nguồn), physMm, code }] (KIT-17 queen_pet_stones.json).
//   regionFns(mask, legend): { bg, costume, pet: (x_mm, y_mm, canvas) → bool } từ mask màu của template (đen/trắng/đỏ).
//   compose({ id, canvas, layers: [{ id, stones, region? }], cat, collideMm, share }) → { design, report }
//     1. mỗi layer chỉ giữ viên có tâm trong vùng của nó (region; locked luôn giữ);
//     2. va chạm giữa layer (khe vật lý < collideMm, mặc định 0 = chạm là chồng): duyệt từ layer trên xuống,
//        bỏ viên layer dưới; viên dưới locked thì bỏ viên trên (nếu viên trên không locked); cả 2 locked → giữ cả 2, ghi lockedConflicts;
//     3. share = ['pet']: mã của các layer đó đổi sang mã gần nhất (ΔE00 màu catalog, cùng shape + cỡ vật lý) đã có ở layer khác,
//        chỉ khi ΔE00 ≤ shareMaxDe (12; xa hơn thì giữ mã riêng, đỏ không thành nâu);
//     4. ký hiệu gán lại cho cả sản phẩm (assignSymbols, luật mới; hết chữ → 2 chữ để QC báo).
import fs from 'node:fs';
import path from 'node:path';
import { readKitSvg } from '../kit/svgio.js';
import { rgbToLab, de2000 } from '../kit/place.js';
import { decodePng } from '../png.js';
import { assignSymbols, refOf } from './catalog.js';
import { newDesign, counts, LAYER_IDS } from './design.js';
import { edgeGap } from './geom.js';

const r4 = (v) => Math.round(v * 1e4) / 1e4;

export function importKitSvg(svg, { layer, cat, locked = () => false, source = 'kit-svg' }) {
  const doc = readKitSvg(svg), k = doc.canvas.pxPerMm;
  return doc.stones.map((s) => {
    const e = cat.codes[s.code];
    const shape = s.shape || 'round';
    const st = { id: `${layer}:${s.id}`, layer, code: s.code, shape, x_mm: r4(s.x / k), y_mm: r4(s.y / k),
      phys_mm: e ? e.physMm : r4(s.dMm + 0.8), ref_mm: r4(s.dMm), rot_deg: r4(s.rot || 0), locked: false, source };
    st.locked = !!locked(st);
    return st;
  });
}

export function readMask(file) { const m = decodePng(fs.readFileSync(file)); return { w: m.w, h: m.h, data: m.data }; }

export function importTemplate(file, { layer, variant = null, cat }) {
  const tpl = JSON.parse(fs.readFileSync(file, 'utf8')), dir = path.dirname(file);
  const svgFile = tpl.svg || (variant ? tpl.costume?.[variant]?.svg : Object.values(tpl.costume || {})[0]?.svg);
  if (!svgFile) throw new Error(`${file}: không có svg${variant ? ` cho ${variant}` : ''}`);
  let big = [];
  if (tpl.big) big = JSON.parse(fs.readFileSync(path.join(dir, tpl.big), 'utf8')).stones || [];
  const locked = (s) => big.some((b) => b.code === s.code && Math.hypot(b.x_mm - s.x_mm, b.y_mm - s.y_mm) < 0.5);
  const stones = importKitSvg(fs.readFileSync(path.join(dir, svgFile), 'utf8'), { layer, cat, locked, source: `template:${tpl.name}${variant ? `:${variant}` : ''}` });
  const mask = tpl.mask?.file ? { ...readMask(path.join(dir, tpl.mask.file)), legend: tpl.mask.legend } : null;
  return { stones, template: tpl, mask, svg: svgFile };
}

export function importPetStones(list, { pxPerMm, cat, layer = 'pet', source = 'kit17' }) {
  return list.map((s, i) => ({ id: `${layer}:${i + 1}`, layer, code: s.code, shape: cat.codes[s.code]?.shape || 'round',
    x_mm: r4(s.x / pxPerMm), y_mm: r4(s.y / pxPerMm), phys_mm: s.physMm, ref_mm: refOf(s.physMm, cat), rot_deg: 0, locked: false, source }));
}

// legend: { tên vùng: '#RRGGBB' }, tên vùng của queen: background / costume / petFace.
export function regionFns(mask, legend, names = { bg: 'background', costume: 'costume', pet: 'petFace' }) {
  const rgb = Object.fromEntries(Object.entries(legend).map(([n, h]) => [n, [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))]));
  const at = (x, y, canvas) => {
    const px = Math.min(mask.w - 1, Math.max(0, Math.floor((x / canvas.w_mm) * mask.w))), py = Math.min(mask.h - 1, Math.max(0, Math.floor((y / canvas.h_mm) * mask.h)));
    const i = (py * mask.w + px) * 4, c = [mask.data[i], mask.data[i + 1], mask.data[i + 2]];
    let best = null, bd = Infinity;
    for (const [n, v] of Object.entries(rgb)) { const d = Math.abs(v[0] - c[0]) + Math.abs(v[1] - c[1]) + Math.abs(v[2] - c[2]); if (d < bd) { bd = d; best = n; } }
    return best;
  };
  return Object.fromEntries(Object.entries(names).map(([l, n]) => [l, (x, y, canvas) => at(x, y, canvas) === n]));
}

const labOf = (hex) => rgbToLab(...[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)));

// Lưới băm có xoá được, cho va chạm giữa layer.
function grid(cell) {
  const m = new Map(), key = (x, y) => `${Math.floor(x / cell)},${Math.floor(y / cell)}`;
  return {
    add(s) { const k = key(s.x_mm, s.y_mm); if (!m.has(k)) m.set(k, new Set()); m.get(k).add(s); },
    del(s) { m.get(key(s.x_mm, s.y_mm))?.delete(s); },
    near(s) {
      const i = Math.floor(s.x_mm / cell), j = Math.floor(s.y_mm / cell), out = [];
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (const t of m.get(`${i + a},${j + b}`) || []) out.push(t);
      return out;
    },
  };
}

export function compose({ id, canvas, layers, cat, collideMm = 0, share = [], shareMaxDe = 12 }) {
  const order = [...layers].sort((a, b) => LAYER_IDS.indexOf(a.id) - LAYER_IDS.indexOf(b.id));
  const report = { layers: {}, lockedConflicts: [], remap: {}, collideMm, shareMaxDe };
  // 1. vùng
  const inRegion = new Map();
  for (const L of order) {
    const keep = L.stones.filter((s) => s.locked || !L.region || L.region(s.x_mm, s.y_mm, canvas));
    report.layers[L.id] = { in: L.stones.length, droppedRegion: L.stones.length - keep.length, droppedCollision: 0, removedByLocked: 0 };
    inRegion.set(L.id, keep.map((s) => ({ ...s, layer: L.id })));
  }
  // 2. va chạm, từ trên xuống
  const maxP = Math.max(1, ...[...inRegion.values()].flat().map((s) => s.phys_mm)), G = grid(maxP), kept = new Set();
  for (const L of [...order].reverse()) {
    for (const s of inRegion.get(L.id)) {
      const hits = G.near(s).filter((t) => t.layer !== s.layer && Math.hypot(s.x_mm - t.x_mm, s.y_mm - t.y_mm) < (s.phys_mm + t.phys_mm) / 2 + collideMm && edgeGap(s, t, cat) < collideMm);
      if (!hits.length) { kept.add(s); G.add(s); continue; }
      if (!s.locked) { report.layers[L.id].droppedCollision++; continue; }
      for (const t of hits) {
        if (t.locked) { report.lockedConflicts.push({ a: s.id, b: t.id, gapMm: r4(edgeGap(s, t, cat)) }); continue; }
        kept.delete(t); G.del(t); report.layers[t.layer].removedByLocked++;
      }
      kept.add(s); G.add(s);
    }
  }
  // 3. dùng chung bảng mã
  const all = [...kept];
  if (share.length) {
    const pool = [...new Set(all.filter((s) => !share.includes(s.layer)).map((s) => s.code))].map((c) => cat.codes[c]).filter((e) => e?.fill);
    for (const s of all.filter((x) => share.includes(x.layer))) {
      if (!(s.code in report.remap)) {
        const e = cat.codes[s.code], same = pool.filter((p) => p.shape === e?.shape && Math.abs(p.physMm - s.phys_mm) < 1e-6 && p.kind === e.kind);
        if (!e?.fill || !same.length || same.some((p) => p.code === s.code)) report.remap[s.code] = { to: s.code, de00: 0 };
        else {
          const L0 = labOf(e.fill), best = same.map((p) => ({ to: p.code, de00: Math.round(de2000(L0, labOf(p.fill)) * 100) / 100 })).sort((a, b) => a.de00 - b.de00)[0];
          report.remap[s.code] = best.de00 <= shareMaxDe ? best : { to: s.code, de00: 0, nearest: best };
        }
      }
      if (report.remap[s.code].to !== s.code) { s.mergedFrom = s.code; s.code = report.remap[s.code].to; }
    }
    report.kept = {};
    for (const [k, v] of Object.entries(report.remap)) if (v.to === k) { if (v.nearest) report.kept[k] = v.nearest; delete report.remap[k]; }
  }
  // 4. design + ký hiệu
  const d = newDesign({ id, w_mm: canvas.w_mm, h_mm: canvas.h_mm, catalogVersion: cat.version, layers: order.map((l) => l.id) });
  for (const l of d.layers) l.stones = all.filter((s) => s.layer === l.id);
  const merged = new Map(); // design.merges cho QC merge-warnings: { from, to, de00, n, layer }
  for (const s of all) if (s.mergedFrom) { const k = `${s.layer}:${s.mergedFrom}`; if (!merged.has(k)) merged.set(k, { from: s.mergedFrom, to: s.code, de00: report.remap[s.mergedFrom].de00, n: 0, layer: s.layer }); merged.get(k).n++; delete s.mergedFrom; }
  if (merged.size) d.merges = [...merged.values()];
  d.symbols = assignSymbols(counts(d).byCode, cat, {}, { overflow: true });
  for (const l of d.layers) { const r = report.layers[l.id]; r.kept = l.stones.length; }
  return { design: d, report };
}
