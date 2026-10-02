// SM-P3: sản phẩm Queen = Starry (bg) + Queen costume + pet → outputs/stonemap/queen_product/. 0 API.
//   node lib/stonemap/queen_product.js [--costume chain|print] [--pet <pet.design.json>|empty] [--pet-codes shared|own] [--px-per-mm 8] [--out dir]
//   pet mặc định: outputs/stonemap/queen_product/pet.design.json nếu có, không thì dựng từ KIT-17 outputs/kit/kit17/queen_pet_stones.json
//     (px ảnh 1254 = 300 mm; chạy `node tools/pet_queen.mjs --mask <mask mặt 1254 px>`), không có nữa thì layer rỗng.
//   Ảnh in sạch cho mockup: requirements/BG.png → Trang phục Queen.png (alpha) → Mẫu Queen.png ở vùng mặt (đỏ trong queen_mask.png).
//   Ra: design.json, map.svg, bom.csv, bom.json, legend.png (+ legend.svg), qc.json (mọi plugin: holes với mask = cả canvas vì nền đính kín,
//   outside-region với vùng đá của starry_mask + vùng từng layer của queen_mask, ΔE mockup vs ảnh in), mockup.png,
//   report.json (pass_ / issues / n_stones / n_codes / coverage_ratio / mean_dE / merges / merge_warnings như map_generator RUN.md §3.3).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePng, encodePng } from '../png.js';
import { loadCatalog } from './catalog.js';
import { newDesign, counts, validate, FORMAT } from './design.js';
import { writeSvg } from './svg.js';
import { importTemplate, importPetStones, regionFns, compose } from './compose.js';
import { bomOf, bomCsv, legendPng, legendSvg } from './bom.js';
import { outline } from './geom.js';
import { allStones } from './design.js';
import { renderMockup } from './render3d.js';
import { runQc } from './qc/index.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const TPL = path.join(ROOT, 'kit', 'templates');

// mask RGBA của template → mask 1 byte / px theo hàm chọn (c = [r, g, b], x, y px).
function maskOf(m, pick) {
  const data = new Uint8Array(m.w * m.h);
  for (let y = 0, i = 0; y < m.h; y++) for (let x = 0; x < m.w; x++, i++) data[i] = pick([m.data[i * 4], m.data[i * 4 + 1], m.data[i * 4 + 2]], x, y) ? 1 : 0;
  return { w: m.w, h: m.h, data };
}

export function printImage(req, mask) {
  const bg = decodePng(fs.readFileSync(path.join(req, 'BG.png'))), co = decodePng(fs.readFileSync(path.join(req, 'Trang phục Queen.png')));
  const pet = decodePng(fs.readFileSync(path.join(req, 'Mẫu Queen.png'))), W = bg.w, H = bg.h, out = new Uint8Array(W * H * 4);
  if (co.w !== W || pet.w !== W) throw new Error('ảnh in lệch cỡ');
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4, a = co.data[i + 3] / 255;
    const mi = (Math.floor(((y + 0.5) * mask.h) / H) * mask.w + Math.floor(((x + 0.5) * mask.w) / W)) * 4, face = mask.data[mi] > 128 && mask.data[mi + 1] < 128;
    for (let c = 0; c < 3; c++) out[i + c] = face ? pet.data[i + c] : Math.round(bg.data[i + c] * (1 - a) + co.data[i + c] * a);
    out[i + 3] = 255;
  }
  return { w: W, h: H, data: out };
}

export async function buildQueen({ costume = 'chain', pet = null, petCodes = 'shared', pxPerMm = 8, out = path.join(ROOT, 'outputs', 'stonemap', 'queen_product'),
  req = process.env.KIT_REQ || path.join(process.cwd(), 'requirements'), mockup = true } = {}) {
  const t0 = Date.now(), cat = loadCatalog();
  fs.mkdirSync(out, { recursive: true });
  const bg = importTemplate(path.join(TPL, 'starry_template.json'), { layer: 'bg', cat });
  const co = importTemplate(path.join(TPL, 'queen_template.json'), { layer: 'costume', variant: costume, cat });
  const canvas = { w_mm: co.template.canvasMm, h_mm: co.template.canvasMm };
  // pet
  let petDesign = null, petFrom = 'empty';
  const petFile = pet && pet !== 'empty' ? pet : path.join(out, 'pet.design.json'), kit17 = path.join(ROOT, 'outputs', 'kit', 'kit17', 'queen_pet_stones.json');
  if (pet !== 'empty' && fs.existsSync(petFile)) { petDesign = JSON.parse(fs.readFileSync(petFile, 'utf8')); petFrom = path.relative(ROOT, petFile); }
  else if (pet !== 'empty' && fs.existsSync(kit17)) {
    petDesign = newDesign({ id: 'pet:kit17', w_mm: canvas.w_mm, h_mm: canvas.h_mm, catalogVersion: cat.version, layers: ['pet'] });
    petDesign.layers[0].stones = importPetStones(JSON.parse(fs.readFileSync(kit17, 'utf8')), { pxPerMm: 1254 / canvas.w_mm, cat });
    petDesign.symbols = {};
    fs.writeFileSync(path.join(out, 'pet.design.json'), JSON.stringify(petDesign));
    petFrom = path.relative(ROOT, kit17);
  }
  const petStones = petDesign ? petDesign.layers.flatMap((l) => l.stones).map((s) => ({ ...s, layer: 'pet' })) : [];
  const region = regionFns(co.mask, co.mask.legend);
  const { design, report } = compose({ id: `queen:${costume}`, canvas, cat, share: petCodes === 'shared' ? ['pet'] : [],
    layers: [{ id: 'bg', stones: bg.stones, region: region.bg }, { id: 'costume', stones: co.stones, region: region.costume }, { id: 'pet', stones: petStones, region: region.pet }] });
  design.meta = { product: 'queen', costume, templates: { bg: bg.svg, costume: co.svg }, pet: petFrom, petCodes };
  const errs = validate(design);
  if (errs.length) throw new Error(`design lỗi: ${errs.slice(0, 5).join('; ')}`);
  const bom = bomOf(design, cat);
  design.expected = { total: bom.totals.total, byCode: Object.fromEntries(bom.rows.map((r) => [r.code, r.total])) }; // QC layer-total: Σ layer = BOM xuất ra
  fs.writeFileSync(path.join(out, 'design.json'), JSON.stringify(design));
  fs.writeFileSync(path.join(out, 'map.svg'), writeSvg(design, { cat }));
  fs.writeFileSync(path.join(out, 'bom.json'), JSON.stringify(bom, null, 1) + '\n');
  fs.writeFileSync(path.join(out, 'bom.csv'), bomCsv(bom));
  fs.writeFileSync(path.join(out, 'legend.svg'), legendSvg(bom));
  const legend = legendPng(bom, path.join(out, 'legend.png'));
  // mockup + QC
  const ctx = { mask: { w: 1, h: 1, data: Uint8Array.of(1) }, region: maskOf(bg.mask, (c) => c[0] > 128), // nền đính kín: cả canvas phải phủ đá
    layerRegions: Object.fromEntries(['bg', 'costume', 'pet'].map((l) => [l, maskOf(co.mask, (c, x, y) => region[l]((x + 0.5) / co.mask.w * canvas.w_mm, (y + 0.5) / co.mask.h * canvas.h_mm, canvas))])) };
  let print = null, mock = null;
  if (mockup) {
    try { print = printImage(req, co.mask); } catch (e) { report.printError = e.message; }
    const t = Date.now();
    mock = renderMockup(design, cat, { print, pxPerMm });
    report.mockupMs = Date.now() - t;
    fs.writeFileSync(path.join(out, 'mockup.png'), encodePng(mock.w, mock.h, mock.data, {}, { rgb: true }));
    if (print) {
      const pv = renderMockup({ ...design, layers: [] }, cat, { print, pxPerMm: 2 }), mk = renderMockup(design, cat, { print, pxPerMm: 2 });
      Object.assign(ctx, { mockup: { width: mk.w, height: mk.h, data: mk.data }, preview: { width: pv.w, height: pv.h, data: pv.data } });
    }
  }
  const qc = await runQc(design, ctx);
  fs.writeFileSync(path.join(out, 'qc.json'), JSON.stringify(qc, null, 1) + '\n');
  const c = counts(design);
  const issues = qc.checks.flatMap((k) => k.findings.filter((f) => f.level === 'error' || f.level === 'warn').map((f) => `${f.level.toUpperCase()} ${k.id}: ${f.msg}`));
  const area = (s) => (s.shape === 'round' ? Math.PI * (s.phys_mm / 2) ** 2 : Math.abs(outline(s, cat, 48).reduce((a, p, i, P) => a + p[0] * P[(i + 1) % P.length][1] - P[(i + 1) % P.length][0] * p[1], 0)) / 2);
  const regionMm2 = canvas.w_mm * canvas.h_mm * (ctx.region.data.reduce((a, v) => a + (v > 0), 0) / ctx.region.data.length);
  const dE = qc.checks.find((k) => k.id === 'delta-e')?.findings[0]?.data?.mean ?? null;
  const summary = { pass_: qc.checks.every((k) => k.status !== 'error'), issues, n_stones: c.total, n_codes: c.codes,
    coverage_ratio: Math.round((allStones(design).reduce((a, s) => a + area(s), 0) / regionMm2) * 1e4) / 1e4, mean_dE: dE,
    merges: design.merges || [], merge_warnings: (design.merges || []).filter((m) => m.de00 > 20), legend: legend ? 'legend.png' : 'legend.svg (không có rsvg-convert)', ms: Date.now() - t0, out: path.relative(ROOT, out), format: FORMAT, costume, pet: petFrom, petCodes, counts: { total: c.total, codes: c.codes, byLayer: Object.fromEntries(Object.entries(c.byLayer).map(([k, v]) => [k, { total: v.total, codes: v.codes }])) },
    compose: report, qc: { status: qc.status, checks: Object.fromEntries(qc.checks.map((k) => [k.id, { status: k.status, msgs: k.findings.map((f) => `${f.level}: ${f.msg}`) }])) }, mockup: mock ? [mock.w, mock.h] : null };
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(summary, null, 1) + '\n');
  return { design, bom, qc, report: summary };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), flag = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
  const r = await buildQueen({ costume: flag('--costume', 'chain'), pet: flag('--pet', null), petCodes: flag('--pet-codes', 'shared'), pxPerMm: Number(flag('--px-per-mm', 8)), out: flag('--out') && path.resolve(flag('--out')) });
  const s = r.report;
  console.log(`pass_ ${s.pass_}, ${s.n_stones} viên ${s.n_codes} mã, coverage ${s.coverage_ratio}, mean_dE ${s.mean_dE}, merges ${s.merges.length} (warn ${s.merge_warnings.length}), ${s.legend}`);
  console.log(`queen ${s.costume}: ${s.counts.total} viên ${s.counts.codes} mã (${Object.entries(s.counts.byLayer).map(([k, v]) => `${k} ${v.total}/${v.codes} mã`).join(', ')}), pet ${s.pet}, ${(s.ms / 1000).toFixed(1)} s`);
  console.log(`  compose ${JSON.stringify(s.compose.layers)} lockedConflicts ${s.compose.lockedConflicts.length} remap ${JSON.stringify(s.compose.remap)} giữ riêng ${JSON.stringify(s.compose.kept)}`);
  for (const [id, k] of Object.entries(s.qc.checks)) console.log(`  ${id} ${k.status}: ${k.msgs.join(' | ')}`);
  console.log(`  → ${s.out}/ (mockup ${s.mockup})`);
}
