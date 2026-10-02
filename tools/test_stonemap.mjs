// Test SM-P0 (STONEMAP nền móng) + SM-P3 (ghép layer, BOM, mockup 3D) không tốn API: node tools/test_stonemap.mjs
// design.json ⇄ SVG sửa được, catalog có version (mọi shape), QC plugin trên 2 sản phẩm thật (Snowman / Dachshund, bảng stones của kit.sqlite).
// SVG + design + QC của 2 sản phẩm → outputs/stonemap/ (để mở bằng Inkscape / trình duyệt). Số liệu: docs/STONEMAP.md.
import fs from 'node:fs';
import path from 'node:path';
import { decodePng } from '../lib/png.js';
import { createRequire } from 'node:module';
import { loadCatalog, assignSymbols, refOf, STONE_LETTERS, DB_FILE } from '../lib/stonemap/catalog.js';
import { newDesign, validate, counts, diff, allStones } from '../lib/stonemap/design.js';
import { writeSvg, readSvg, parseTransform } from '../lib/stonemap/svg.js';
import { edgeGap } from '../lib/stonemap/geom.js';
import { importProduct } from '../lib/stonemap/import.js';
import { loadChecks, runQc, register, unregister } from '../lib/stonemap/qc/index.js';
import { BINS } from '../lib/stonemap/qc/gap.js';
import { compose, importTemplate, regionFns } from '../lib/stonemap/compose.js';
import { bomOf, bomCsv, legendSvg, legendPng } from '../lib/stonemap/bom.js';
import { renderMockup } from '../lib/stonemap/render3d.js';
import { neighbours } from '../lib/stonemap/geom.js';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const OUT = path.join(ROOT, 'outputs', 'stonemap');
let fail = 0;
const ok = (cond, msg) => { if (!cond) { fail++; console.log('FAIL', msg); } };
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;
const cat = loadCatalog();
const find = (r, id) => r.checks.find((c) => c.id === id);

// ── catalog
{
  ok(/^cat-[0-9a-f]{12}$/.test(cat.version), `catalog: version ${cat.version}`);
  const shapes = new Set(Object.values(cat.codes).map((e) => e.shape));
  for (const s of ['round', 'marquise', 'teardrop', 'heart', 'star', 'flower', 'rose']) ok(shapes.has(s), `catalog: có shape ${s}`);
  ok(Object.keys(cat.codes).length === 432 && !cat.skipped.length, `catalog: 432 mã, 0 bỏ (${Object.keys(cat.codes).length}, ${cat.skipped})`);
  const m = cat.codes.M011;
  ok(m.shape === 'marquise' && m.physW === 3 && m.physH === 6 && m.refW === 2.6 && m.refH === 5.2 && m.physMm === 6 && m.refMm === 5.2, 'catalog: M011 marquise 3×6, vẽ 2.6×5.2');
  ok(cat.codes.S001.shape === 'teardrop' && cat.codes.X001.refMm === 3.2 && cat.codes.H057.shape === 'rose', 'catalog: giọt / tim / hồng');
  ok(refOf(2.8) === 2.2 && refOf(4) === 3.2 && near(refOf(7), 6.2) && refOf(10) === 9.2, 'catalog: size_map 2.8→2.2, 4→3.2, 7→6.2 (−0.8), 10→9.2');
  ok(cat.codes['7']?.kind === 'pearl' && cat.codes.L94.kind === 'stone', 'catalog: PEARL = ngọc trai');

  const sym = assignSymbols({ L94: 1117, L4: 664, Z94: 552, 5: 28, 7: 18, Q121: 17 });
  ok(sym['5'] === '5' && sym['7'] === '7', `symbols: ngọc trai = cỡ (${JSON.stringify(sym)})`);
  ok(sym.L94 === 'A' && sym.L4 === 'B' && sym.Z94 === 'C' && sym.Q121 === 'E', 'symbols: đá nhiều viên nhận chữ trước, bỏ D');
  ok(new Set(Object.values(sym)).size === 6, 'symbols: duy nhất');
  const fx = assignSymbols({ L94: 10, L4: 5 }, cat, { L4: 'A', L94: 'X' });
  ok(fx.L4 === 'A' && fx.L94 === 'B', `symbols: giữ ký hiệu đã chốt hợp luật, bỏ X (${JSON.stringify(fx)})`);
  const many = Object.fromEntries(Object.values(cat.codes).filter((e) => e.kind === 'stone').slice(0, 16).map((e, i) => [e.code, 100 - i]));
  let threw = false;
  try { assignSymbols(many); } catch { threw = true; }
  ok(threw, `symbols: 16 mã đá > ${STONE_LETTERS.length} chữ → lỗi`);
}

// ── design tổng hợp: 3 layer, mọi shape, xoay
const synth = () => {
  const d = newDesign({ id: 'synth', w_mm: 60, h_mm: 40, catalogVersion: cat.version, layers: ['bg', 'costume', 'pet'] });
  const add = (layer, id, code, x, y, rot = 0) => {
    const e = cat.codes[code];
    d.layers.find((l) => l.id === layer).stones.push({ id, layer, code, shape: e.shape, x_mm: x, y_mm: y, phys_mm: e.physMm, ref_mm: e.refMm, rot_deg: rot, locked: false, source: 'test' });
  };
  add('bg', 'b1', 'L94', 5, 5); add('bg', 'b2', 'L94', 8, 5); add('bg', 'b3', 'Z94', 5, 9, 15.5);
  add('costume', 'c1', 'M011', 20, 10, 30); add('costume', 'c2', 'S001', 30, 10, -45); add('costume', 'c3', 'X001', 40, 10, 90);
  add('pet', 'p1', 'X062', 20, 25, 12); add('pet', 'p2', 'H001', 30, 25); add('pet', 'p3', 'H057', 45, 25, 200); add('pet', 'p4', '7', 10, 30);
  d.symbols = assignSymbols(counts(d).byCode);
  return d;
};
{
  const d = synth();
  ok(!validate(d).length, `design: hợp lệ (${validate(d)})`);
  const c = counts(d);
  ok(c.total === 10 && c.codes === 9 && c.byLayer.bg.total === 3 && c.byLayer.costume.total === 3 && c.byLayer.pet.total === 4 && c.byLayer.bg.byCode.L94 === 2, 'design: counts theo layer + tổng');
  const bad = structuredClone(d);
  bad.layers[0].stones[1].id = 'b1'; bad.layers[1].stones[0].layer = 'pet'; bad.layers[2].stones[0].x_mm = 99; delete bad.symbols.L94;
  bad.layers.reverse();
  const e = validate(bad).join(' | ');
  ok(/id trùng/.test(e) && /layer pet ≠ costume/.test(e) && /ngoài canvas/.test(e) && /chưa có ký hiệu/.test(e) && /sai thứ tự/.test(e), `design: validate bắt lỗi (${e})`);

  const svg = writeSvg(d, { cat });
  ok(/<g id="layer-bg" data-layer="bg">/.test(svg) && /<g id="layer-costume"/.test(svg) && /<g id="layer-pet"/.test(svg), 'svg: mỗi layer 1 <g id>');
  ok(/data-id="c1" data-code="M011" data-layer="costume" data-shape="marquise" data-phys="6" data-ref="5.2"[^>]*transform="translate\(20 10\) rotate\(30\)"/.test(svg), 'svg: data-* + translate/rotate');
  ok(/data-id="c1"[^\n]*<path d="M0 -2.6 L/.test(svg) && /data-id="c1"[^\n]* L1.3 0 L/.test(svg), 'svg: marquise vẽ ở cỡ ref 2.6×5.2 (đường viền lib/kit/shapes.js)');
  ok(/<circle r="1.1"/.test(svg) && /data-id="c2"[^\n]* L0 1.6 Z/.test(svg), 'svg: tròn r = ref/2, giọt mũi xuống dưới (0, +1.6)');
  const back = readSvg(svg), df = diff(d, back);
  ok(df.same && JSON.stringify(back.symbols) === JSON.stringify(d.symbols) && back.catalogVersion === cat.version, `svg: round-trip tổng hợp 0 lệch (${JSON.stringify(df)})`);
  ok(back.layers.map((l) => l.id).join() === 'bg,costume,pet', 'svg: giữ thứ tự layer');

  // Sửa kiểu Inkscape: viên thành matrix(...), layer có translate → đọc ra toạ độ canvas đúng.
  const r = (30 * Math.PI) / 180;
  const ink = svg.replace('transform="translate(20 10) rotate(30)"', `transform="matrix(${Math.cos(r)} ${Math.sin(r)} ${-Math.sin(r)} ${Math.cos(r)} 21 11)"`)
    .replace('<g id="layer-pet" data-layer="pet">', '<g id="layer-pet" data-layer="pet" transform="translate(1.5,-2)">');
  const inkD = readSvg(ink), c1 = allStones(inkD).find((s) => s.id === 'c1'), p1 = allStones(inkD).find((s) => s.id === 'p1');
  ok(near(c1.x_mm, 21) && near(c1.y_mm, 11) && near(c1.rot_deg, 30), `svg: matrix() → x 21 y 11 rot 30 (${c1.x_mm} ${c1.y_mm} ${c1.rot_deg})`);
  ok(near(p1.x_mm, 21.5) && near(p1.y_mm, 23) && near(p1.rot_deg, 12), `svg: transform layer cộng vào viên (${p1.x_mm} ${p1.y_mm})`);
  const m = parseTransform('rotate(90 10 10)');
  ok(near(m[4], 20) && near(m[5], 0), 'svg: rotate(a cx cy)');
}

// ── hình học vật lý, mọi shape
{
  const S = (code, x, y, rot = 0) => { const e = cat.codes[code]; return { id: `${code}@${x},${y}`, code, shape: e.shape, x_mm: x, y_mm: y, phys_mm: e.physMm, ref_mm: e.refMm, rot_deg: rot }; };
  ok(near(edgeGap(S('L94', 0, 0), S('L94', 3, 0), cat), 0.2), 'geom: tròn 2.8 cách 3 → khe 0.2');
  ok(near(edgeGap(S('M011', 10, 10), S('M011', 13.2, 10), cat), 0.2, 1e-3), `geom: marquise 3×6 cạnh nhau → khe 0.2 (${edgeGap(S('M011', 10, 10), S('M011', 13.2, 10), cat)})`);
  ok(near(edgeGap(S('M011', 10, 10), S('M011', 12.8, 10), cat), -0.2, 1e-3), 'geom: marquise chồng 0.2');
  ok(near(edgeGap(S('M011', 10, 10, 90), S('M011', 10, 13.2, 90), cat), 0.2, 1e-3), 'geom: marquise xoay 90° xếp dọc → khe 0.2');
  ok(edgeGap(S('M011', 10, 10), S('M011', 10, 13.2), cat) < 0, 'geom: marquise đứng xếp dọc 3.2 mm → chồng (trục dài 6)');
  ok(near(edgeGap(S('S001', 0, 0), S('L94', 0, 3.6), cat), 0.2, 2e-2), `geom: đáy giọt ↔ tròn (${edgeGap(S('S001', 0, 0), S('L94', 0, 3.6), cat)})`);
  const q = await runQc((() => { const d = synth(); d.layers[1].stones.push({ ...d.layers[1].stones[0], id: 'c1b', x_mm: 22.4 }); return d; })(), {}, { only: ['overlap'] });
  ok(find(q, 'overlap').status === 'error' && find(q, 'overlap').findings[0].data.pairs.some((p) => [p.a, p.b].sort().join() === 'c1,c1b'), 'qc: chồng marquise xoay 30° bắt được');
}

// ── QC registry + stub
{
  const checks = await loadChecks();
  ok(['catalog', 'code-count', 'delta-e', 'gap', 'holes', 'layer-total', 'merge-warnings', 'outside-region', 'overlap', 'symbols'].every((id) => checks.some((c) => c.id === id)) && checks.length === 10, `qc: 10 plugin trong lib/stonemap/qc (${checks.map((c) => c.id)})`);
  register({ id: 'test-extra', level: 'warn', title: 'thêm 1 file = thêm kiểm định', run: (d) => [{ level: 'warn', msg: `${counts(d).total}` }] });
  const d = synth(), r = await runQc(d);
  ok(find(r, 'test-extra')?.findings[0].msg === '10', 'qc: plugin đăng ký thêm được chạy');
  unregister('test-extra');
  ok(find(r, 'code-count').status === 'pass' && find(r, 'catalog').status === 'pass' && find(r, 'symbols').status === 'pass', `qc: tổng hợp code-count/catalog/symbols pass`);
  ok(find(r, 'holes').status === 'info' && find(r, 'delta-e').status === 'info' && find(r, 'layer-total').status === 'info', 'qc: thiếu mask/ảnh/BOM → info bỏ qua');

  // code-count: 14 → warn, 16 → error
  const wide = (n) => { const x = newDesign({ id: 'w', w_mm: 100, h_mm: 100, catalogVersion: cat.version }); Object.values(cat.codes).filter((e) => e.shape === 'round').slice(0, n).forEach((e, i) => x.layers[0].stones.push({ id: `s${i}`, layer: 'bg', code: e.code, shape: 'round', x_mm: 5 + (i % 8) * 10, y_mm: 5 + Math.floor(i / 8) * 10, phys_mm: e.physMm, ref_mm: e.refMm, rot_deg: 0, locked: false, source: 't' })); return x; };
  ok(find(await runQc(wide(13), {}, { only: ['code-count'] }), 'code-count').status === 'pass', 'qc: 13 mã pass');
  ok(find(await runQc(wide(14), {}, { only: ['code-count'] }), 'code-count').status === 'warn', 'qc: 14 mã warn');
  ok(find(await runQc(wide(16), {}, { only: ['code-count'] }), 'code-count').status === 'error', 'qc: 16 mã error');

  // catalog: mã lạ / shape / cỡ sai
  const bad = synth();
  bad.layers[0].stones[0].code = 'ZZZ9'; bad.layers[0].stones[1].phys_mm = 3; bad.layers[1].stones[0].shape = 'round';
  const cf = find(await runQc(bad, {}, { only: ['catalog'] }), 'catalog').findings.map((f) => f.msg).join(' | ');
  ok(/ZZZ9 không có/.test(cf) && /L94 cỡ vật lý 2.8/.test(cf) && /M011 là marquise/.test(cf), `qc: catalog bắt mã lạ/cỡ/shape (${cf})`);

  // holes: mask cả canvas 20×20 mm, 1 viên ở góc → lỗ; lưới đá 3 mm phủ kín → pass
  const mask = { w: 20, h: 20, data: new Uint8Array(400).fill(1) };
  const grid = (full) => { const x = newDesign({ id: 'h', w_mm: 20, h_mm: 20, catalogVersion: cat.version }); for (let i = 0; i < 7; i++) for (let j = 0; j < 7; j++) if (full || (i < 2 && j < 2)) x.layers[0].stones.push({ id: `g${i}_${j}`, layer: 'bg', code: 'L94', shape: 'round', x_mm: 1.5 + i * 3, y_mm: 1.5 + j * 3, phys_mm: 2.8, ref_mm: 2.2, rot_deg: 0, locked: false, source: 't' }); return x; };
  const h1 = find(await runQc(grid(false), { mask }, { only: ['holes'] }), 'holes'), h2 = find(await runQc(grid(true), { mask }, { only: ['holes'] }), 'holes');
  ok(h1.status === 'warn' && h1.findings[0].data.n > 250 && h2.status === 'pass', `qc: holes stub (${h1.findings[0].msg} / ${h2.findings[0].msg})`);

  // ΔE: ảnh giống → 0 pass; đỏ vs xanh → warn
  const img = (r, g, b) => ({ width: 8, height: 8, data: Uint8Array.from({ length: 256 }, (_, i) => [r, g, b, 255][i % 4]) });
  const e1 = find(await runQc(d, { mockup: img(200, 30, 30), preview: img(200, 30, 30) }, { only: ['delta-e'] }), 'delta-e');
  const e2 = find(await runQc(d, { mockup: img(200, 30, 30), preview: img(30, 30, 200) }, { only: ['delta-e'] }), 'delta-e');
  ok(e1.status === 'pass' && e1.findings[0].data.mean === 0 && e2.status === 'warn' && e2.findings[0].data.mean > 30, `qc: ΔE stub (${e1.findings[0].msg} / ${e2.findings[0].msg})`);
}

// ── 2 sản phẩm thật
{
  const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite');
  const db = new DatabaseSync(DB_FILE, { readOnly: true });
  fs.mkdirSync(OUT, { recursive: true });
  const want = { snowman: { n: 3233, codes: 15, cc: 'warn', pairs: 8, edge: 6 }, dachshund: { n: 2147, codes: 12, cc: 'pass', pairs: 13, edge: 0 } };
  for (const [p, w] of Object.entries(want)) {
    const d = importProduct(p);
    ok(!validate(d).length, `${p}: design hợp lệ (${validate(d).slice(0, 3)})`);
    const c = counts(d);
    ok(c.total === w.n && c.codes === w.codes, `${p}: ${c.total} viên ${c.codes} mã`);
    const svg = writeSvg(d, { cat }), back = readSvg(svg), df = diff(d, back);
    ok(df.same && allStones(back).length === w.n, `${p}: round-trip design → svg → design 0 lệch (thiếu ${df.missing.length}, thừa ${df.extra.length}, đổi ${df.changed.length})`);
    ok(JSON.stringify(back.symbols) === JSON.stringify(d.symbols) && JSON.stringify(back.expected) === JSON.stringify(d.expected), `${p}: round-trip giữ ký hiệu + BOM`);
    ok(diff(back, readSvg(writeSvg(back, { cat }))).same, `${p}: round-trip lần 2 ổn định`);

    const r = await runQc(d);
    ok(find(r, 'code-count').status === w.cc, `${p}: code-count ${w.cc} (${find(r, 'code-count').status})`);
    ok(find(r, 'catalog').status === 'pass' && find(r, 'layer-total').status === 'pass', `${p}: catalog + layer-total pass`);
    const edge = find(r, 'outside-region').findings.find((f) => /^\d+ viên lố mép canvas/.test(f.msg));
    ok((edge ? Number(edge.msg.split(' ')[0]) : 0) === w.edge, `${p}: ${w.edge} viên lố mép canvas (${edge?.msg})`);
    const ov = find(r, 'overlap').findings[0];
    ok(ov.level === 'error' && ov.data.n === w.pairs, `${p}: ${w.pairs} cặp chồng (${ov.msg})`);
    // khe tự tính = cột nn1_gap_mm của DB (cùng bin)
    const hist = find(r, 'gap').findings[0].data.hist, dbH = Object.keys(hist).map(() => 0);
    for (const { g } of db.prepare('SELECT nn1_gap_mm AS g FROM stones WHERE product = ?').all(p)) dbH[BINS.findIndex((b, k) => g >= b && (g < BINS[k + 1] || k === BINS.length - 2))]++;
    const mine = Object.values(hist);
    ok(mine.reduce((a, b) => a + b, 0) === w.n && mine.slice(0, 3).every((v, k) => v === dbH[k]) && mine.every((v, k) => Math.abs(v - dbH[k]) <= 20), `${p}: phân bố khe khớp nn1_gap_mm DB (${mine} vs ${dbH})`);
    // luật ký hiệu: lỗi đúng các mã spec_symbol_ok = 0 của BOM
    const badDb = db.prepare('SELECT code FROM bom WHERE product = ? AND spec_symbol_ok = 0').all(p).map((x) => x.code).sort();
    const badQc = find(r, 'symbols').findings.filter((f) => f.level === 'error').map((f) => /đá (\S+)/.exec(f.msg)?.[1]).sort();
    ok(JSON.stringify(badQc) === JSON.stringify(badDb), `${p}: lỗi ký hiệu = BOM spec_symbol_ok=0 (${badQc} vs ${badDb})`);
    fs.writeFileSync(path.join(OUT, `${p}.svg`), svg);
    fs.writeFileSync(path.join(OUT, `${p}.design.json`), JSON.stringify(d));
    fs.writeFileSync(path.join(OUT, `${p}.qc.json`), JSON.stringify(r, null, 1));
    console.log(`${p}: ${c.total} viên ${c.codes} mã, round-trip ${df.same ? '0 lệch' : 'LỆCH'}, QC ${r.status}: ${r.checks.map((k) => `${k.id}=${k.status}`).join(' ')}`);
  }
  db.close();
}

// ── SM-P3: ghép layer
{
  const S = (layer, id, code, x, y, extra = {}) => { const e = cat.codes[code]; return { id, layer, code, shape: e.shape, x_mm: x, y_mm: y, phys_mm: e.physMm, ref_mm: e.refMm, rot_deg: 0, locked: false, source: 't', ...extra }; };
  const canvas = { w_mm: 40, h_mm: 20 };
  const bg = [], co = [S('costume', 'c1', 'M011', 10, 10), S('costume', 'c2', 'L4', 30, 10), S('costume', 'c3', 'L16', 20, 3)], pet = [S('pet', 'p1', 'L17', 20, 10)];
  for (let i = 0; i < 13; i++) for (let j = 0; j < 6; j++) bg.push(S('bg', `b${i}_${j}`, 'L94', 1.5 + i * 3, 1.5 + j * 3, i === 10 && j === 3 ? { locked: true } : {}));
  // b10_3 (31.5, 10.5) locked chạm c2 (30, 10) → c2 bị bỏ; vùng: bg không được ở x > 36
  const { design: d, report: r } = compose({ id: 't', canvas, cat, layers: [{ id: 'pet', stones: pet }, { id: 'bg', stones: bg, region: (x) => x < 36 }, { id: 'costume', stones: co }], share: ['pet'] });
  ok(d.layers.map((l) => l.id).join() === 'bg,costume,pet' && !validate(d).length, `compose: thứ tự bg < costume < pet, hợp lệ (${validate(d).slice(0, 2)})`);
  ok(r.layers.bg.droppedRegion === 6 && r.layers.bg.droppedCollision > 0 && r.layers.costume.removedByLocked === 1, `compose: bỏ theo vùng 6, va chạm ${r.layers.bg.droppedCollision}, viên locked bỏ c2 (${JSON.stringify(r.layers)})`);
  const ids = new Set(allStones(d).map((s) => s.id));
  ok(ids.has('b10_3') && !ids.has('c2') && ids.has('c1') && ids.has('p1') && ids.has('c3'), 'compose: locked giữ, layer trên giữ');
  const st = allStones(d), cross = neighbours(st, 6).filter(([i, j]) => st[i].layer !== st[j].layer && edgeGap(st[i], st[j], cat) < 0);
  ok(!cross.length, `compose: 0 va chạm giữa layer (${cross.length})`);
  ok(st.find((s) => s.id === 'p1').code === 'L16' && r.remap.L17?.to === 'L16', `compose: pet L17 → L16 dùng chung (ΔE ${r.remap.L17?.de00})`);
  ok(find(await runQc(d, {}, { only: ['symbols'] }), 'symbols').status === 'pass' && d.symbols.L94 === 'A', `compose: ký hiệu gán lại cả sản phẩm (${JSON.stringify(d.symbols)})`);
  const both = compose({ id: 't2', canvas, cat, layers: [{ id: 'bg', stones: [S('bg', 'x', 'L94', 10, 10, { locked: true })] }, { id: 'pet', stones: [S('pet', 'y', 'L4', 11, 10, { locked: true })] }] });
  ok(both.report.lockedConflicts.length === 1 && allStones(both.design).length === 2, 'compose: 2 viên locked chạm nhau → giữ cả 2, ghi lockedConflicts');
  const far = compose({ id: 't3', canvas, cat, share: ['pet'], layers: [{ id: 'bg', stones: [S('bg', 'x', 'L94', 5, 5)] }, { id: 'pet', stones: [S('pet', 'y', 'L26', 20, 10)] }] });
  ok(allStones(far.design).find((s) => s.id === 'y').code === 'L26' && far.report.kept.L26?.de00 > 12, 'compose: ΔE00 > 12 → giữ mã riêng');

  // BOM
  const b = bomOf(d, cat), csv = bomCsv(b).trim().split('\n');
  ok(b.totals.total === st.length && b.rows.reduce((a, x) => a + x.total, 0) === st.length && b.rows.every((x) => x.total === Object.values(x.byLayer).reduce((a, y) => a + y, 0)), 'bom: tổng = Σ mã = Σ layer');
  const m = b.rows.find((x) => x.code === 'M011');
  ok(m.shape === 'marquise' && m.phys_w_mm === 3 && m.phys_h_mm === 6 && m.ref_mm === 5.2 && m.series && m.color_hex && m.byLayer.costume === 1, `bom: thông tin catalog (${JSON.stringify(m)})`);
  ok(csv.length === b.rows.length + 2 && csv[0] === 'symbol,stone_code,series,kind,shape,physical_mm,phys_w_mm,phys_h_mm,reference_mm,color_name,hex,bg,costume,pet,count,count_with_10pct_spare' && csv.at(-1).startsWith('TOTAL'), `bom: csv header + dòng TOTAL (${csv[0]})`);
  const l94 = b.rows.find((x) => x.code === 'L94');
  ok(l94.color_name === 'opaque white' && l94.kind === 'stone' && l94.count_with_10pct_spare === Math.ceil(l94.total * 1.1) && b.totals.count_with_10pct_spare === b.rows.reduce((a, x) => a + Math.ceil(x.total * 1.1), 0), `bom: color_name / kind / +10 % (${l94.total} → ${l94.count_with_10pct_spare})`);
  ok(b.rows.every((x) => x.kind === cat.codes[x.code].kind), 'bom: kind stone|pearl theo catalog');
  const lg = legendSvg(b);
  ok(b.rows.every((x) => lg.includes(`>${x.code}<`) && lg.includes(`>${x.count_with_10pct_spare}<`)) && lg.includes('3×6 mm marquise') && lg.includes(`>${b.totals.count_with_10pct_spare}<`), 'legend: mọi mã + số +10 % + size marquise');
  const lgFile = path.join(OUT, 'test_legend.png');
  if (legendPng(b, lgFile)) { const pg = decodePng(fs.readFileSync(lgFile)); ok(pg.w === 960 && pg.h > 200, `legend.png ${pg.w}×${pg.h}`); } else console.log('legend.png: bỏ qua (không có rsvg-convert)');

  // QC outside-region: mask nửa trái; viên lố mép canvas; layerRegions
  const half = { w: 2, h: 1, data: Uint8Array.of(1, 0) };
  const orr = find(await runQc(d, { region: half }, { only: ['outside-region'] }), 'outside-region');
  const right = allStones(d).filter((x) => x.x_mm >= 20).length;
  ok(orr.status === 'error' && orr.findings.some((f) => f.msg.startsWith(`${right} viên có tâm ngoài vùng`)), `qc outside-region: ${right} viên ở nửa phải → error (${orr.findings.map((f) => f.msg)})`);
  const lr = find(await runQc(d, { layerRegions: { pet: half } }, { only: ['outside-region'] }), 'outside-region');
  ok(lr.status === 'error' && lr.findings.some((f) => /layer pet: 1\/1/.test(f.msg)), `qc outside-region: pet ngoài vùng layer (${lr.findings.map((f) => f.msg)})`);
  const edgeD = structuredClone(d); edgeD.layers[0].stones[0].x_mm = 0.5;
  ok(find(await runQc(edgeD, {}, { only: ['outside-region'] }), 'outside-region').findings.some((f) => /1 viên lố mép canvas/.test(f.msg)), 'qc outside-region: viên tâm 0.5 mm lố mép');
  ok(find(await runQc(d, {}, { only: ['outside-region'] }), 'outside-region').status === 'info', 'qc outside-region: không mask → chỉ kiểm mép (info)');

  // QC merge-warnings: compose ghi design.merges; ΔE > 20 → warn
  ok(d.merges?.length === 1 && d.merges[0].from === 'L17' && d.merges[0].to === 'L16' && d.merges[0].n === 1 && d.merges[0].layer === 'pet', `compose: design.merges (${JSON.stringify(d.merges)})`);
  ok(find(await runQc(d, {}, { only: ['merge-warnings'] }), 'merge-warnings').status === 'info', 'qc merge-warnings: ΔE 10 → info');
  const mw = find(await runQc({ ...d, merges: [{ from: 'L26', to: 'L16', de00: 40.26, n: 3 }] }, {}, { only: ['merge-warnings'] }), 'merge-warnings');
  ok(mw.status === 'warn' && /L26→L16 ΔE 40.26/.test(mw.findings[0].msg), 'qc merge-warnings: ΔE 40 → warn');
  ok(diff(d, readSvg(writeSvg(d, { cat }))).same && JSON.stringify(readSvg(writeSvg(d, { cat })).merges) === JSON.stringify(d.merges), 'svg: round-trip giữ merges');

  // mockup 3D: viên tròn / ngọc trai / tim / marquise trên nền xám
  const md = newDesign({ id: 'm', w_mm: 30, h_mm: 12, catalogVersion: cat.version });
  md.layers[0].stones = [S('bg', 'r', 'L4', 5, 6), S('bg', 'p', '7', 13, 6), S('bg', 'h', 'X001', 20, 6), S('bg', 'm', 'M011', 26, 6, { rot_deg: 30 })];
  const K = 10, grey = { w: 30, h: 12, data: new Uint8Array(30 * 12 * 4).fill(128) }, img = renderMockup(md, cat, { print: grey, pxPerMm: K });
  const px = (x, y) => { const i = (Math.round(y * K) * img.w + Math.round(x * K)) * 4; return [img.data[i], img.data[i + 1], img.data[i + 2]]; };
  const lum = (c) => c[0] + c[1] + c[2], L4 = [1, 3, 5].map((i) => parseInt(cat.codes.L4.fill.slice(i, i + 2), 16));
  ok(img.w === 300 && img.h === 120, 'render3d: cỡ = canvas × px/mm');
  ok(lum(px(13 - 1.2, 6 - 1.6)) > lum(px(13 + 1.8, 6 + 1.8)) + 60, `render3d: ngọc trai sáng phía đèn, tối phía kia (${px(13 - 1.2, 6 - 1.6)} / ${px(13 + 1.8, 6 + 1.8)})`);
  ok(lum(px(5.93, 7.24)) < 3 * 128 - 40, `render3d: bóng đổ dưới-phải tối hơn nền (${px(5.93, 7.24)})`);
  ok(lum(px(1, 1)) === 3 * 128, 'render3d: xa đá = ảnh in nguyên');
  ok(Math.abs(lum(px(5, 6)) - lum(L4)) < 120, `render3d: mặt bàn ≈ màu catalog L4 (${px(5, 6)} vs ${L4})`);
  const hb = px(20, 6 + 1.9);
  ok(lum(hb) < 3 * 128 - 10, `render3d: mũi tim xuống dưới (${hb})`);
}

// ── SM-P3: Queen = Starry bg + Queen costume (pet rỗng), không mockup
{
  const T = path.join(ROOT, 'kit', 'templates');
  const bg = importTemplate(path.join(T, 'starry_template.json'), { layer: 'bg', cat }), co = importTemplate(path.join(T, 'queen_template.json'), { layer: 'costume', variant: 'chain', cat });
  const nBig = JSON.parse(fs.readFileSync(path.join(T, 'queen_big.json'), 'utf8')).stones.length;
  ok(bg.stones.length > 10000 && co.stones.length > 3000 && co.stones.filter((s) => s.locked).length >= 0.5 * nBig, `queen: nhập template bg ${bg.stones.length}, costume ${co.stones.length} (locked ${co.stones.filter((s) => s.locked).length} = queen_big)`);
  ok(co.stones.some((s) => s.shape === 'heart') && co.stones.some((s) => s.shape === 'teardrop') && co.stones.some((s) => s.shape === 'marquise'), 'queen: costume có tim / giọt / marquise');
  const rg = regionFns(co.mask, co.mask.legend);
  const { design: q, report: qr } = compose({ id: 'queen', canvas: { w_mm: 300, h_mm: 300 }, cat, layers: [{ id: 'bg', stones: bg.stones, region: rg.bg }, { id: 'costume', stones: co.stones, region: rg.costume }, { id: 'pet', stones: [] }] });
  const qc = counts(q), qs = allStones(q);
  ok(!validate(q).length && qc.total === qr.layers.bg.kept + qr.layers.costume.kept && qc.byLayer.pet.total === 0, `queen: ${qc.total} viên = bg ${qc.byLayer.bg.total} + costume ${qc.byLayer.costume.total}`);
  const cross = neighbours(qs, 18).filter(([i, j]) => qs[i].layer !== qs[j].layer && edgeGap(qs[i], qs[j], cat) < 0);
  ok(!cross.length && !qr.lockedConflicts.length, `queen: 0 va chạm bg ↔ costume (${cross.length})`);
  ok(qc.codes <= 15 && Object.values(q.symbols).every((x) => /^([A-Z]|\d+)$/.test(x)), `queen: ${qc.codes} mã ≤ 15 (palette chung KIT-18), ký hiệu 1 chữ / số (${qc.codes})`);
  console.log(`queen (pet rỗng): ${qc.total} viên ${qc.codes} mã, bg bỏ vùng ${qr.layers.bg.droppedRegion} va chạm ${qr.layers.bg.droppedCollision}, costume bỏ ${qr.layers.costume.droppedRegion + qr.layers.costume.droppedCollision}`);
}

console.log(fail ? `${fail} FAIL` : 'stonemap ok');
process.exit(fail ? 1 : 0);
