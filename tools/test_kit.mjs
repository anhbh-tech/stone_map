// Test KIT (bản đồ đá → JSON → render), không mạng, không cần file nguồn: node tools/test_kit.mjs
import fs from 'node:fs';
import os from 'node:os';
import { parseKitSvg, buildPalette, toKitSvg, PX } from '../lib/kit/svg.js';
import { renderMap, stoneField, edt2, over, hex } from '../lib/kit/render.js';
import { advancePx, loadGlyphs, CHARS } from '../lib/kit/glyphs.js';
import { mapJson } from '../lib/kit/build.js';
import { readKitSvg, writeKitSvg, normalizeDoc, SCHEMA } from '../lib/kit/svgio.js';
import { detectBeads, estimateParams, buildKit, runPlace, quantize, alphaMask, neighborStats, backgroundMask, regionMask, isPearl, beadFeatures, refOf, physOf, assignCodes, bigObjects, materialOf, normCounts, normBoxes, tierOfMm } from '../lib/kit/detect.js';
import { decodePng } from '../lib/png.js';
import { place } from '../lib/kit/place.js';
import * as vlm from '../lib/kit/vlm.js';
import { assignSymbols, loadCatalog, checkDesign, LETTERS } from '../lib/kit/catalog.js';
import { gapMm, stonePoly, sdPoly } from '../lib/kit/shapes.js';

let fail = 0;
const ok = (cond, msg) => { if (!cond) { fail++; console.log('FAIL', msg); } };
const throws = (fn, re, msg) => { try { fn(); ok(false, `${msg}: không lỗi`); } catch (e) { ok(re.test(e.message), `${msg}: ${e.message}`); } };
const kit = (f) => JSON.parse(fs.readFileSync(new URL(`../kit/${f}.json`, import.meta.url), 'utf8'));

// ── Parser: một viên copy nguyên từ file King mẫu.
const ONE = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="300mm" height="300mm" viewBox="0 0 3543 3543">
<g id="REFERENCE_MAP">
<g transform="matrix(0.000000000 -11.810000000 11.810000000 0.000000000 1733.000000 112.251445)"><ellipse cx="0" cy="0" rx="1.100000" ry="1.100000" fill="#543012" data-position-id="P00003" data-symbol="8" data-stone-code="L74" data-shape="round" data-center-x-source-px="1733.000000" data-center-y-source-px="112.251445" data-width-mm="2.200000" data-height-mm="2.200000" data-rotation-deg="-90.000000" id="P00003" data-group="K_L74_S2.8" data-reference-width-mm="2.2" data-reference-height-mm="2.2"/><ellipse cx="0" cy="0" rx="0.957000" ry="0.957000" fill="#C8742C" /></g>
<text x="1726.0469" y="121.2514" font-family="Arial" font-weight="700" font-size="25.000px" fill="#FFFFFF" data-position-id="P00003">8</text>
</g>
</svg>
`;
const one = parseKitSvg(ONE, 'king');
ok(JSON.stringify(one.map.stones) === JSON.stringify([{ id: 'P00003', symbol: '8', code: 'L74', x: 1733, y: 112.251445, dMm: 2.2, rot: -90, group: 'K_L74_S2.8' }]), `parse: ${JSON.stringify(one.map.stones)}`);
ok(one.map.layer === 'king' && one.map.sizeMm === 300 && one.map.px === PX, 'parse: đầu JSON');
{
  const l = one.look[0];
  ok(l.code === 'L74' && l.edge === '#543012' && l.fill === '#C8742C' && l.text === '#FFFFFF' && l.fontPx === 25 && Math.abs(l.inner - 0.87) < 1e-9
    && Math.abs(l.dx + 6.9531) < 1e-6 && Math.abs(l.dy - 9) < 1e-4, `parse: look ${JSON.stringify(l)}`);
}
throws(() => parseKitSvg(ONE.replace('>8</text>', '>9</text>'), 'x'), /text không khớp|đọc được/, 'parse: chữ khác data-symbol');
throws(() => parseKitSvg(ONE.replace('viewBox="0 0 3543 3543"', 'viewBox="0 0 100 100"'), 'x'), /viewBox/, 'parse: viewBox lạ');
throws(() => parseKitSvg(ONE.replace('data-shape="round"', 'data-shape="square"'), 'x'), /tròn/, 'parse: đá không tròn');
ok(advancePx('8', 25) === 13.90625 && advancePx('H', 25) === 18.046875, 'glyph: advance làm tròn 1/64 px như SVG mẫu');

// SVG ghi lại: dòng text giống hệt file mẫu (x, y 4 số lẻ), matrix xoay −90° đúng.
const pal1 = buildPalette([one]);
const back = toKitSvg(one.map, pal1);
ok(back.includes(ONE.split('\n')[4]), 'toKitSvg: dòng <text> trùng byte với file mẫu');
ok(back.includes('matrix(0.000000000 -11.810000000 11.810000000 0.000000000 1733.000000 112.251445)'), 'toKitSvg: matrix xoay');
throws(() => buildPalette([one, parseKitSvg(ONE.replace('#C8742C', '#C8742D'), 'queen')]), /mã L74: fill/, 'palette: cùng mã khác màu → lỗi');

// ── Dữ liệu đã nhập (kit/*.json, sinh bởi node lib/kit/build.js).
const palette = kit('palette'), maps = { starry: kit('starry'), king: kit('king'), queen: kit('queen') };
const KEYS = 'id,symbol,code,x,y,dMm,rot,group';
for (const [layer, n] of [['starry', 6691], ['king', 3066], ['queen', 3230]]) {
  const m = maps[layer];
  ok(m.layer === layer && m.sizeMm === 300 && m.px === 3543 && m.stones.length === n, `${layer}: ${m.stones.length} viên`);
  ok(m.stones.every((s) => Object.keys(s).join() === KEYS && palette.codes[s.code]?.symbol === s.symbol && palette.codes[s.code].dMm === s.dMm), `${layer}: schema + mã có trong palette`);
  ok(new Set(m.stones.map((s) => s.id)).size === n, `${layer}: id duy nhất`);
  const rotPct = m.stones.filter((s) => s.rot).length / n;
  ok(rotPct > 0.6 && rotPct < 0.75, `${layer}: ${(100 * rotPct).toFixed(1)}% viên có xoay`);
  const svg = toKitSvg(m, palette);
  ok(mapJson(parseKitSvg(svg, layer).map) === mapJson(m), `${layer}: JSON → SVG → JSON y nguyên`);
}
ok(Object.keys(palette.codes).length === 30, `palette: ${Object.keys(palette.codes).length} mã`);
ok(JSON.stringify(Object.keys(palette.sizes).map(Number).sort((a, b) => a - b)) === '[2.2,3.2,4.2,5.2,7.2]', 'palette: các cỡ 2.2/3.2/4.2/5.2/7.2');
ok(palette.symbolClash.W?.length === 2, 'palette: báo ký hiệu W dùng cho 2 mã');
for (const m of Object.values(maps)) {
  const sym = {};
  for (const s of m.stones) ok((sym[s.symbol] ||= s.code) === s.code, `${m.layer}: ký hiệu ${s.symbol} duy nhất trong layer`);
}
const G = loadGlyphs();
ok([...CHARS].every((c) => G.glyphs[c]?.a.length === G.glyphs[c].w * G.glyphs[c].h), 'glyph: đủ 0-9 A-Z');

// ── edt2 so với vét cạn.
{
  const W = 23, H = 17, seed = new Uint8Array(W * H);
  [[3, 4], [20, 2], [11, 15]].forEach(([x, y]) => { seed[y * W + x] = 1; });
  const d = edt2(seed, W, H);
  let bad = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const b = Math.min(...[[3, 4], [20, 2], [11, 15]].map(([u, v]) => (u - x) ** 2 + (v - y) ** 2));
    if (d[y * W + x] !== b) bad++;
  }
  ok(bad === 0, `edt2: ${bad} điểm sai`);
}

// ── Render bản đồ nhỏ: 3 viên 2.2mm cách 4mm (khe 1.8mm > 2·marginMm) + 1 viên 4.2mm lẻ.
{
  const k = 11.81, mm = (v) => v * k;
  const p = { codes: { A1: { symbol: 'Q', fill: '#0B2E8C', edge: '#04123A', text: '#FFFFFF', dMm: 2.2, fontPx: 25 }, B1: { symbol: '2', fill: '#EDE9E2', edge: '#63615E', text: '#111111', dMm: 4.2, fontPx: 47 } } };
  const st = (id, code, x, y, dMm) => ({ id, symbol: p.codes[code].symbol, code, x, y, dMm, rot: 0, group: 'K' });
  const map = { layer: 't', sizeMm: 20, px: 240, stones: [st('a', 'A1', 60, 60, 2.2), st('b', 'A1', 60 + mm(4), 60, 2.2), st('c', 'A1', 60 + mm(2), 60 + mm(3.4), 2.2), st('d', 'B1', 180, 180, 4.2)] };
  const clean = renderMap(map, p), sym = renderMap(map, p, { style: 'symbols' });
  const at = (im, x, y) => [...im.data.subarray((y * im.w + x) * 4, (y * im.w + x) * 4 + 4)];
  ok(clean.w === 240 && at(clean, 5, 230)[3] === 0 && at(clean, 120, 200)[3] === 0, 'render: ngoài vùng đá trong suốt');
  ok(at(clean, 60, 60)[3] === 255 && at(clean, 180, 180)[3] === 255, 'render: tâm viên đục');
  ok(at(clean, Math.round(60 + mm(2)), 60)[3] === 255, 'render: khe giữa 2 viên cạnh nhau được tô (closing)');
  ok(at(clean, Math.round(60 + mm(2)), Math.round(60 + mm(1.2)))[3] === 255, 'render: lỗ giữa 3 viên được lấp');
  // ngọc 10 mm: ký hiệu "10" (2 chữ, canh giữa), không phải "1"
  const p10 = { codes: { '10': { symbol: '10', fill: '#EDE9E2', edge: '#63615E', text: '#111111', dMm: 9.2, fontPx: 60 } } };
  const s10 = renderMap({ px: 240, stones: [{ id: 'p', symbol: '10', code: '10', x: 120, y: 120, dMm: 9.2, rot: 0, group: 'K' }] }, p10, { style: 'symbols' });
  const dark = (x0, x1) => { let n = 0; for (let y = 100; y < 140; y++) for (let x = x0; x < x1; x++) if (at(s10, x, y)[0] < 80) n++; return n; };
  ok(dark(95, 119) > 40 && dark(121, 145) > 40 && assignSymbols({ 10: 3, L50: 9 }, loadCatalog())['10'] === '10', `render: ký hiệu ngọc "10" đủ 2 chữ (${dark(95, 119)}/${dark(121, 145)} px tối)`);
  ok(at(clean, 180, Math.round(180 + mm(2.1 + 1.2)))[3] === 0, 'render: viền ngoài chỉ nới marginMm');
  const c = at(clean, 61, 61), f = hex('#0B2E8C');
  ok(c[2] > c[0] && c[2] > 100 && Math.abs(c[2] - f[2]) < 80, `render: màu hạt theo fill (${c})`);
  const hi = at(clean, Math.round(60 - mm(0.35)), Math.round(60 - mm(0.5))), lo = at(clean, Math.round(60 + mm(0.4)), Math.round(60 + mm(0.6)));
  ok(hi[0] + hi[1] + hi[2] > lo[0] + lo[1] + lo[2] + 60, `render: sáng trên-trái, tối dưới-phải (${hi} vs ${lo})`);
  // symbols: vòng viền = edge, đĩa trong = fill, chữ màu text nằm giữa.
  const e = at(sym, Math.round(180 + mm(2.1 * 0.935)), 180), fi = at(sym, Math.round(180 - mm(2.1 * 0.8)), 180);
  ok(JSON.stringify(e.slice(0, 3)) === JSON.stringify(hex('#63615E')), `symbols: vòng viền màu edge (${e})`);
  ok(JSON.stringify(fi.slice(0, 3)) === JSON.stringify(hex('#EDE9E2')), `symbols: đĩa trong màu fill (${fi})`);
  let n = 0, sx = 0, sy = 0;
  for (let y = 150; y < 210; y++) for (let x = 150; x < 210; x++) { const q = at(sym, x, y); if (q[0] < 40 && q[1] < 40) { n++; sx += x + 0.5; sy += y + 0.5; } }
  ok(n > 150 && Math.abs(sx / n - 180) < 2.5 && Math.abs(sy / n - 180) < 4, `symbols: chữ "2" giữa viên (${n} px, tâm ${(sx / n).toFixed(1)},${(sy / n).toFixed(1)})`);
  const q = at(sym, 60, 60);
  ok(q[3] === 255, 'symbols: đục');
  const top = { w: 240, h: 240, data: new Uint8Array(240 * 240 * 4) };
  top.data.set([255, 0, 0, 255], (10 * 240 + 10) * 4); top.data.set([255, 0, 0, 128], (60 * 240 + 60) * 4);
  const o = over(clean, top);
  ok(JSON.stringify(at(o, 10, 10)) === '[255,0,0,255]' && at(o, 60, 60)[0] > c[0] && at(o, 5, 230)[3] === 0, 'over: ghép alpha');
}

// ── Kit thật ở 1/10: vùng đá King ≈ nửa tranh, nền Starry phủ gần hết.
{
  const frac = (m) => { const f = stoneField(m, { scale: 0.1 }); let s = 0; for (const a of f.alpha) s += a; return s / f.alpha.length; };
  const fk = frac(maps.king), fs_ = frac(maps.starry);
  ok(fk > 0.45 && fk < 0.58, `king: vùng đá ${(100 * fk).toFixed(1)}%`);
  ok(fs_ > 0.85, `starry: vùng đá ${(100 * fs_).toFixed(1)}%`);
}

// ── KIT-6 svgio: đọc 3 file mẫu (dạng cũ, không metadata) → ghi pearl-kit-map/1 → đọc lại y hệt.
const want = { starry: 6691, king: 3066, queen: 3230 }, docs = {};
for (const layer of ['starry', 'king', 'queen']) {
  const d = readKitSvg(toKitSvg(maps[layer], palette));
  docs[layer] = d;
  ok(d.legacy === true && d.stones.length === want[layer] && d.canvas.widthMm === 300 && d.canvas.widthPx === PX, `svgio ${layer}: đọc mẫu ${d.stones.length} viên`);
  ok(d.stones.every((s, i) => { const m = maps[layer].stones[i]; return s.id === m.id && s.code === m.code && s.symbol === m.symbol && s.x === m.x && s.y === m.y && s.dMm === m.dMm && s.group === m.group; }), `svgio ${layer}: viên khớp JSON`);
  ok(d.bom.reduce((a, b) => a + b.count, 0) === want[layer] && d.palette.every((p) => palette.codes[p.code].fill === p.rgb && palette.codes[p.code].edge === p.edge), `svgio ${layer}: BOM + palette`);
  const w = writeKitSvg(d), r = readKitSvg(w);
  ok(r.legacy === false && JSON.stringify({ ...r, legacy: undefined }) === JSON.stringify(normalizeDoc(d)), `svgio ${layer}: write → read y hệt`);
  ok(writeKitSvg(r) === w, `svgio ${layer}: write(read(write)) byte y hệt`);
  ok(parseKitSvg(w, layer).map.stones.length === want[layer], `svgio ${layer}: KIT-1 parseKitSvg đọc được file mới`);
}
{
  const w = writeKitSvg({ ...docs.king, params: { mode: 'detect' }, source: { name: 'a]]>b.png', sha1: 'ab' }, createdAt: '2026-10-01T00:00:00.000Z', stats: { x: 1 } });
  const root = w.match(/<svg\b[^>]*>/)[0], meta = JSON.parse(w.match(/<!\[CDATA\[([\s\S]*?)\]\]>/)[1]);
  ok(/width="300mm"/.test(root) && /height="300mm"/.test(root) && /viewBox="0 0 3543 3543"/.test(root) && root.includes(`data-schema="${SCHEMA}"`) && /data-px-per-mm="11.81"/.test(root), `svgio: root ${root}`);
  ok(/<title>Pearl kit map 300×300 mm — 3066 viên/.test(w) && /<desc>[^<]*Nguồn: a\]\]&gt;b\.png sha1 ab/.test(w), 'svgio: title + desc');
  ok(meta.schema === SCHEMA && meta.source.name === 'a]]>b.png' && meta.bom.length === docs.king.palette.length && meta.layers[0].count === 3066 && meta.stats.x === 1 && !('stones' in meta), 'svgio: metadata JSON');
  ok((w.match(/inkscape:groupmode="layer"/g) || []).length === 2 && (w.match(/data-legend-code=/g) || []).length === docs.king.palette.length, 'svgio: layer Inkscape + legend');
  const r = readKitSvg(w);
  ok(r.source.name === 'a]]>b.png' && r.params.mode === 'detect' && r.stones.length === 3066, 'svgio: đọc lại metadata');
  throws(() => readKitSvg(w.replace(/data-symbol="([^"]*)"/, 'data-symbol="??"')), /text không khớp/, 'svgio: chữ khác data-symbol');
  throws(() => readKitSvg(w.replace(/"schema":"pearl-kit-map\/1"/, '"schema":"x/9"')), /schema lạ/, 'svgio: schema lạ');
}
// file mẫu thật (chỉ đọc, có thì test)
{
  const dir = `${process.cwd()}/requirements/FIle Map đá`;
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('_reference_symbols_only.svg')) : [];
  const got = files.map((f) => readKitSvg(fs.readFileSync(`${dir}/${f}`, 'utf8')).stones.length).sort((a, b) => a - b);
  ok(!files.length || JSON.stringify(got) === '[3066,3230,6691]', `svgio: file mẫu thật ${got}`);
}

// ── KIT-6 detect: vẽ lại 1 ô Starry (1000px bản đồ, ½ cỡ) rồi dò hạt → so với viên thật.
{
  const X0 = 1300, Y0 = 1900, S = 1000, sc = 0.5;
  const st = maps.starry.stones.filter((s) => s.x > X0 && s.x < X0 + S && s.y > Y0 && s.y < Y0 + S).map((s) => ({ ...s, x: s.x - X0, y: s.y - Y0 }));
  const img = renderMap({ px: S, stones: st }, palette, { scale: sc }), mask = alphaMask(img);
  const det = detectBeads(img, { canvasWmm: S / 11.81, stoneMm: 2.2, gapMm: 0.8 }, mask).stones;
  const near = (p, list, tol) => list.find((q) => Math.hypot(q.x - p.x, q.y - p.y) < tol);
  const truth = st.map((s) => ({ x: s.x * sc, y: s.y * sc, dMm: s.dMm })), tol = 0.35 * 2.2 * 11.81 * sc;
  const hit = truth.filter((t) => near(t, det, tol)), good = det.filter((d) => near(d, truth, tol));
  const size = hit.filter((t) => near(t, det, tol).dMm === t.dMm).length;
  ok(hit.length / truth.length > 0.93 && good.length / det.length > 0.65 && size / hit.length > 0.95,
    `detect: recall ${(hit.length / truth.length).toFixed(3)} precision ${(good.length / det.length).toFixed(3)} cỡ ${(size / hit.length).toFixed(3)} (${det.length}/${truth.length})`);
  const e = estimateParams(img, { canvasWmm: S / 11.81 });
  ok(e.stoneMm === 2.2 && e.pitchMm > 2.4 && e.pitchMm < 3.4, `estimate: đá ${e.stoneMm} bước ${e.pitchMm}mm (thật ≈ 3.0)`);
  const d = await buildKit(img, { mode: 'detect', canvasWmm: S / 11.81, stoneMm: 2.2, gapMm: 0.8, maxColors: 12 }, { source: { name: 'crop.png', bytes: Buffer.from('x') }, now: new Date(0) });
  ok(d.stones.length === det.length && d.stats.codes <= 12 * 5 && d.stats.check.ssim > 0.5 && d.stats.check.deltaE00 < 12, `detect buildKit: ${d.stones.length} viên, ${d.stats.codes} mã, ΔE00 ${d.stats.check.deltaE00} SSIM ${d.stats.check.ssim}`);
  ok(JSON.stringify({ ...readKitSvg(writeKitSvg(d)), legacy: undefined }) === JSON.stringify(d), 'detect buildKit: write → read y hệt');
}

// ── KIT-6 PLACE: stub lưới lục giác + adapter KIT-2 (place / placeStones).
{
  const w = 200, h = 150, data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.set([x, y, 120, Math.hypot(x - 100, y - 75) < 70 ? 255 : 0], (y * w + x) * 4);
  const img = { w, h, data }, opts = { source: { name: 't.png', bytes: Buffer.from('x') }, now: new Date(0) };
  const d = await buildKit(img, { mode: 'place', canvasWmm: 100, maxColors: 6 }, opts);
  ok(d.stones.length > 400 && d.stats.violations.overlap === 0 && d.stats.violations.tooClose === 0 && d.stats.codes <= 6 && d.stats.place.engine === 'hex-stub', `place stub: ${d.stones.length} viên, ${JSON.stringify(d.stats.violations)}`);
  ok(['nnMm', 'gapMm', 'isolatedPct', 'emptyPct', 'check', 'density', 'sizes'].every((k) => k in d.stats) && d.stats.density.ratio > 0.85 && d.stats.emptyPct < 10, `place stub: stats ${JSON.stringify(d.stats.density)} empty ${d.stats.emptyPct}`);
  ok(d.canvas.heightMm === 75 && d.source.sha1 === '11f6ad8ec52a2984abaafd7c3b516503785c2072' && d.createdAt === '1970-01-01T00:00:00.000Z', 'place stub: canvas + source');
  const fr = { ox: 0, oy: 0, scale: 5.905 }, P = { stoneMm: 2.2, gapMm: 0.8, maxColors: 6 };
  let seen;
  const a = await runPlace(img, null, P, fr, { place: async (i, m, p) => { seen = p; return { stones: [{ x: 1, y: 2, dMm: 2.2, code: 'A' }], palette: [{ code: 'A', rgb: '#FF0000', dMm: 2.2 }], params: { k: 1 }, stats: { n: 1 } }; } });
  ok(seen.frame.scale === 5.905 && seen.stoneMm === 2.2 && a.stones.length === 1 && a.stats.engine === 'kit-2 place' && a.stats.n === 1, 'adapter: place(image, mask, params)');
  const b = await runPlace(img, null, P, fr, { placeStones: (i, o) => ({ map: { stones: [{ x: 1, y: 2, dMm: 2.2, code: 'B' }] }, colors: [{ code: 'B', symbol: '1', fill: '#00FF00', dMm: 2.2 }], stats: {} }) });
  ok(b.stones[0].code === 'B' && b.palette[0].rgb === '#00FF00' && b.stats.engine === 'kit-2 placeStones', 'adapter: placeStones');
}

// ── KIT-6 quantize + láng giềng
{
  const cols = [...Array(60)].map((_, i) => (i < 30 ? [250 - (i % 3), 10, 10] : [10, 10, 240 + (i % 3)]));
  const q = quantize(cols, 2);
  ok(q.rgb.length === 2 && new Set(q.label.slice(0, 30)).size === 1 && q.label[0] !== q.label[59] && q.count.join() === '30,30', `quantize: ${JSON.stringify(q)}`);
  const k = 11.81, pts = [{ x: 0, y: 0, dMm: 2.2, code: 'A' }, { x: 3 * k, y: 0, dMm: 2.2, code: 'A' }, { x: 5.6 * k, y: 0, dMm: 2.2, code: 'B' }];
  const n = neighborStats(pts, k, 1.5, 0.8);
  ok(n.violations.tooClose === 1 && n.violations.overlap === 0 && Math.abs(n.isolatedPct - 100 / 3) < 0.01, `neighborStats: ${JSON.stringify(n)}`);
}

// ── KIT-7 nền: caro "trong suốt" vẽ chết (ô 11 px, 2 mức xám) ngoài viền + lỗ kín giữa vật; nền phẳng; alpha.
// Vật = vành khuyên hạt xanh 10 px trên khe tối (tâm 130,110; 40 < r < 90), lỗ r < 40 là caro.
const K7 = 4.18, PEARL_OK = new Set([5, 6, 7, 8, 10, 11, 12, 14]); // px/mm như ảnh 1254 px / 300 mm
function beadImage(bgFn, { alpha = false } = {}) {
  const W = 260, H = 220, img = { w: W, h: H, data: new Uint8Array(W * H * 4) }, obj = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const j = y * W + x, r = Math.hypot(x - 130, y - 110);
    obj[j] = r > 40 && r < 90 ? 1 : 0;
    img.data.set(obj[j] ? [20, 24, 60, 255] : [...bgFn(x, y), alpha ? 0 : 255], j * 4);
  }
  const beads = [];
  for (let row = 0, y = 6; y < H; row++, y += 9.5) for (let x = 6 + (row % 2) * 5.5; x < W; x += 11) {
    if (!(Math.hypot(x - 130, y - 110) > 46 && Math.hypot(x - 130, y - 110) < 84)) continue;
    beads.push({ x, y });
    for (let v = Math.floor(y - 5); v <= y + 5; v++) for (let u = Math.floor(x - 5); u <= x + 5; u++) {
      const d = Math.hypot(u + 0.5 - x, v + 0.5 - y); if (d > 4.8) continue;
      const sh = 0.55 + 0.45 * Math.sqrt(1 - (d / 4.8) ** 2), hl = Math.hypot(u + 0.5 - x + 1.5, v + 0.5 - y + 1.5) < 1.3 ? 90 : 0;
      img.data.set([Math.min(255, 40 * sh + hl), Math.min(255, 70 * sh + hl), Math.min(255, 210 * sh + hl), 255], (v * W + u) * 4);
    }
  }
  return { img, obj, beads, W, H };
}
const checker = (x, y) => { const v = (Math.floor(x / 11) + Math.floor(y / 11)) % 2 ? 163 : 252; return [v, v - 1, v + 1]; };
{
  const { img, obj, W, H } = beadImage(checker), m = backgroundMask(img);
  let bgOk = 0, bgN = 0, obOk = 0, obN = 0, hole = 0, holeN = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const j = y * W + x;
    if (obj[j]) { obN++; obOk += 1 - m.bg[j]; } else { bgN++; bgOk += m.bg[j]; if (Math.hypot(x - 130, y - 110) < 36) { holeN++; hole += m.bg[j]; } }
  }
  ok(m.checker && m.checker.cell >= 10 && m.checker.cell <= 12 && m.checker.levels[0] > 150 && m.checker.levels[1] > 245, `nền caro: ${JSON.stringify(m.checker)}`);
  ok(bgOk / bgN > 0.995 && obOk / obN > 0.995 && hole / holeN > 0.995, `nền caro: nền ${(bgOk / bgN).toFixed(4)} vật ${(obOk / obN).toFixed(4)} lỗ kín ${(hole / holeN).toFixed(4)}`);
  const o = { canvasWmm: W / K7, stoneMm: 2.2, gapMm: 0.4 }, onBg = (st) => st.filter((s) => !obj[Math.floor(s.y) * W + Math.floor(s.x)]).length;
  const raw = detectBeads(img, o, null).stones, det = detectBeads(img, o, regionMask(img, {})).stones;
  ok(onBg(raw) > 50 && onBg(det) === 0 && det.length > 100, `nền caro: viên trên nền ${onBg(raw)} (không mặt nạ) → ${onBg(det)} (${det.length} viên)`);
}
for (const [name, fn, opt] of [['trắng', () => [255, 255, 255]], ['đen', () => [0, 0, 0]], ['alpha', () => [255, 0, 255], { alpha: true }]]) {
  const { img, obj, W, H } = beadImage(fn, opt), m = backgroundMask(img);
  let bgOk = 0, bgN = 0, obOk = 0, obN = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const j = y * W + x, outer = Math.hypot(x - 130, y - 110) >= 90;
    if (obj[j]) { obN++; obOk += 1 - m.bg[j]; } else if (outer) { bgN++; bgOk += m.bg[j]; }
  }
  ok(!m.checker && bgOk / bgN > 0.995 && obOk / obN > 0.995, `nền ${name}: nền ngoài ${(bgOk / bgN).toFixed(4)} vật ${(obOk / obN).toFixed(4)}`);
}
{
  const W = 120, H = 90, img = { w: W, h: H, data: new Uint8Array(W * H * 4) };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) img.data.set([x * 2, y * 2, 128, 255], (y * W + x) * 4);
  ok(backgroundMask(img).pct.bg === 0 && regionMask(img, {}) === null, 'nền: ảnh mượt không nền → null');
}

// ── KIT-7 ngọc trai vs đá: cỡ vật lý (size_map) + màu trắng/kem + to.
ok(refOf(2.8) === 2.2 && refOf(4) === 3.2 && refOf(5) === 4.2 && refOf(6) === 5.2 && refOf(8) === 7.2 && refOf(11) === 10.2 && physOf(2.2) === 2.8 && physOf(7.2) === 8, 'size_map: vật lý ⇄ reference');
{
  const white = { L: 88, sat: 50 }, blue = { L: 35, sat: 200 };
  ok(isPearl(6, white) && isPearl(7.4, white) && !isPearl(4, white) && !isPearl(2.8, white) && !isPearl(6, blue), 'isPearl: trắng + ≥ 4.5 mm; Z94 4 mm / L 2.8 mm trắng là đá');
}
{
  // vành hạt xanh + 1 mảng hạt trắng nhỏ 2.8 mm + 4 ngọc kem 6 mm (25 px) có gradient tròn + 1 đốm sáng mềm
  const { img, W, H } = beadImage(checker), pearls = [[130, 30], [62, 110], [198, 110], [130, 190]];
  for (const [px, py] of pearls) for (let v = py - 14; v <= py + 14; v++) for (let u = px - 14; u <= px + 14; u++) {
    const d = Math.hypot(u + 0.5 - px, v + 0.5 - py); if (d > 13.5) continue;
    if (d > 12.5) { img.data.set([30, 28, 40, 255], (v * W + u) * 4); continue; }
    const sh = 0.7 + 0.3 * Math.sqrt(1 - (d / 12.5) ** 2), hl = Math.max(0, 1 - Math.hypot(u - px + 4, v - py + 4) / 5) * 40;
    img.data.set([Math.min(255, 240 * sh + hl), Math.min(255, 228 * sh + hl), Math.min(255, 205 * sh + hl), 255], (v * W + u) * 4);
  }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { // hạt xanh góc trái trên của vành → trắng
    const j = (y * W + x) * 4; if (x < 110 && y < 95 && img.data[j + 2] > 60 && img.data[j + 2] > img.data[j] + 40) { const t = img.data[j + 2]; img.data.set([t * 1.15, t * 1.13, t * 1.1].map((v) => Math.min(255, v)), j); }
  }
  const det = detectBeads(img, { canvasWmm: W / K7, stoneMm: 2.2, gapMm: 0.4 }, regionMask(img, {})).stones;
  const pe = det.filter((s) => s.kind === 'pearl'), whiteSmall = det.filter((s) => s.kind === 'stone' && s.x < 110 && s.y < 95 && s.feat.L > 62 && s.feat.sat < 100);
  const found = pearls.filter(([x, y]) => pe.some((s) => Math.hypot(s.x - x, s.y - y) < 6 && s.physMm >= 5 && s.physMm <= 7));
  ok(found.length === 4 && pe.length === 4, `ngọc trai: tìm ${found.length}/4, nhận ${pe.length} (${pe.map((s) => `${s.physMm}mm@${Math.round(s.x)},${Math.round(s.y)}`).join(' ')})`);
  ok(whiteSmall.length > 10 && whiteSmall.every((s) => s.physMm === 2.8), `ngọc trai: hạt trắng nhỏ là đá L 2.8 (${whiteSmall.length})`);
  const { palette, stones } = assignCodes(det.map((s) => ({ ...s, rgb: s.feat.rgb })), { maxColors: 6, stoneMm: 2.2 });
  const pc = palette.filter((p) => /^\d+$/.test(p.code));
  ok(pc.length >= 1 && pc.every((p) => p.symbol === p.code && PEARL_OK.has(+p.code)) && palette.filter((p) => !/^\d+$/.test(p.code)).every((p) => /^[A-Z]+$/.test(p.symbol))
    && stones.filter((s) => s.kind === 'pearl').every((s) => s.group === `K_${s.code}_S${s.physMm}`), `mã: ngọc = số = cỡ, đá = chữ (${palette.map((p) => p.code + ':' + p.symbol).join(' ')})`);
}
{
  // KIT-12a vật to = 1 viên: nền hạt xanh 2.8 mm (bước 3 mm) + cabochon xanh Ø 10.5 mm (bóng tròn + đốm sáng) + opal oval 16 × 11 mm
  // (mảng màu pastel mềm, viền vàng) + chùm 7 ngọc 5 mm sát nhau (không phải 1 viên)
  const W = 300, H = 240, img = { w: W, h: H, data: new Uint8Array(W * H * 4) }, px = K7, put = (x, y, c) => img.data.set([...c.map((v) => Math.max(0, Math.min(255, Math.round(v)))), 255], (y * W + x) * 4);
  for (let j = 0; j < W * H; j++) img.data.set([12, 14, 30, 255], j * 4);
  for (let row = 0, y = 4; y < H; row++, y += 3 * px * 0.866) for (let x = 4 + (row % 2) * 1.5 * px; x < W; x += 3 * px)
    for (let v = Math.floor(y - 7); v <= y + 7; v++) for (let u = Math.floor(x - 7); u <= x + 7; u++) {
      const d = Math.hypot(u + 0.5 - x, v + 0.5 - y); if (u < 0 || v < 0 || u >= W || v >= H || d > 1.4 * px) continue;
      const sh = 0.55 + 0.45 * Math.sqrt(1 - (d / (1.4 * px)) ** 2), hl = Math.hypot(u + 0.5 - x + 2, v + 0.5 - y + 2) < 1.6 ? 90 : 0;
      put(u, v, [40 * sh + hl, 70 * sh + hl, 210 * sh + hl]);
    }
  const cab = { x: 80, y: 120, r: 5.25 * px }, opal = { x: 200, y: 110, a: 8 * px, b: 5.5 * px }, cl = { x: 255, y: 200 };
  for (let v = 0; v < H; v++) for (let u = 0; u < W; u++) {
    const dc = Math.hypot(u + 0.5 - cab.x, v + 0.5 - cab.y);
    if (dc <= cab.r + 0.6 * px) { // viền vàng mảnh rồi lòng xanh đậm có bóng + đốm sáng
      if (dc > cab.r) { put(u, v, [200, 150, 40]); continue; }
      const sh = 0.45 + 0.55 * Math.sqrt(1 - (dc / cab.r) ** 2), hl = Math.max(0, 1 - Math.hypot(u - cab.x + 0.35 * cab.r, v - cab.y + 0.35 * cab.r) / (0.18 * cab.r)) * 200;
      put(u, v, [25 * sh + hl, 50 * sh + hl, 200 * sh + hl]); continue;
    }
    const eo = ((u + 0.5 - opal.x) / opal.a) ** 2 + ((v + 0.5 - opal.y) / opal.b) ** 2;
    if (eo <= 1.25) { if (eo > 1) { put(u, v, [205, 160, 50]); continue; }
      const t = 0.5 + 0.5 * Math.sin((u - opal.x) / 6) * Math.cos((v - opal.y) / 5);
      put(u, v, [215 + 30 * t, 220 - 15 * t, 240 - 30 * t]); }
  }
  for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0.5, 0.866], [-0.5, 0.866], [0.5, -0.866], [-0.5, -0.866]]) {
    const x = cl.x + dx * 5.1 * px, y = cl.y + dy * 5.1 * px;
    for (let v = Math.floor(y - 12); v <= y + 12; v++) for (let u = Math.floor(x - 12); u <= x + 12; u++) {
      const d = Math.hypot(u + 0.5 - x, v + 0.5 - y); if (u < 0 || v < 0 || u >= W || v >= H || d > 2.5 * px) continue;
      const sh = 0.6 + 0.4 * Math.sqrt(1 - (d / (2.5 * px)) ** 2); put(u, v, [245 * sh, 232 * sh, 210 * sh]);
    }
  }
  const det = detectBeads(img, { canvasWmm: W / K7, stoneMm: 2.2, gapMm: 0.4 }).stones;
  const inCab = det.filter((s) => Math.hypot(s.x - cab.x, s.y - cab.y) < cab.r), inOpal = det.filter((s) => ((s.x - opal.x) / opal.a) ** 2 + ((s.y - opal.y) / opal.b) ** 2 < 1);
  const c = inCab[0], q = inOpal[0];
  ok(inCab.length === 1 && c.big && c.kind === 'stone' && c.physMm === 10 && c.shape === 'round' && Math.abs(c.dMeasMm - 10.5) < 1,
    `vật to: cabochon Ø10.5 = 1 viên Q10 (${inCab.map((s) => `${s.big ? 'big ' : ''}${s.kind} ${s.physMm} đo ${s.dMeasMm}`).join(' | ')})`);
  ok(inOpal.length === 1 && q.big && q.shape === 'oval' && q.flags.includes('oval') && Math.abs(q.axesMm[0] - 16.5) < 1.5 && Math.abs(q.axesMm[1] - 11.5) < 1.2 && q.physMm === 12, // trục đo gồm 1 phần viền vàng
    `vật to: opal 16×11 = 1 viên oval (${inOpal.map((s) => `${s.big ? 'big ' : ''}${s.shape} ${s.axesMm} ${s.physMm} ${s.flags}`).join(' | ')})`);
  const clBig = det.filter((s) => s.big && Math.hypot(s.x - cl.x, s.y - cl.y) < 2.5 * px);
  ok(clBig.every((s) => s.physMm <= 6), `vật to: chùm 7 ngọc 5 mm không thành 1 viên to (${clBig.map((s) => s.physMm)})`);
  ok(detectBeads(img, { canvasWmm: W / K7, stoneMm: 2.2, gapMm: 0.4, big: false }).stones.every((s) => !s.big) && bigObjects(img, { canvasWmm: W / K7 }).length >= 2, 'vật to: big=false tắt; bigObjects dùng riêng');
  // tầng ≥ 8 → 5–7 → 2.8–4 mm: mỗi viên có tier (theo cỡ vật lý) + material; hạt nền xanh = tầng 3 'color'
  const r0 = detectBeads(img, { canvasWmm: W / K7, stoneMm: 2.2, gapMm: 0.4 }), st0 = r0.stones, blue = st0.filter((s) => !s.big && s.tier === 3);
  ok(c.tier === 1 && q.tier === 1 && st0.every((s) => s.tier === tierOfMm(s.physMm)) && r0.work.tiers[1] + r0.work.tiers[2] + r0.work.tiers[3] === st0.length
    && blue.length > 150 && blue.filter((s) => s.material === 'color').length >= 0.95 * blue.length, `tầng: ${JSON.stringify(r0.work.tiers)}, nền xanh ${blue.length} viên tầng 3 color`);
  // params.bigObjects (KIT-13): bbox cabochon khi big=false → 1 viên từ gợi ý; bbox tỉ lệ (≤ 1) như px; bbox trên nền hạt → 1 viên, hạt nhỏ trong đó bị bỏ
  const box = [cab.x - cab.r, cab.y - cab.r, cab.x + cab.r, cab.y + cab.r], o0 = { canvasWmm: W / K7, stoneMm: 2.2, gapMm: 0.4, big: false };
  const hb = detectBeads(img, { ...o0, bigObjects: [{ bbox: box }] }).stones.filter((s) => s.big), hn = detectBeads(img, { ...o0, bigObjects: JSON.stringify([box.map((v, i) => v / (i % 2 ? H : W))]) }).stones.filter((s) => s.big);
  ok(hb.length === 1 && hb[0].hint === 0 && hb[0].src === 'hint' && hb[0].physMm === 10 && hn.length === 1 && Math.hypot(hn[0].x - hb[0].x, hn[0].y - hb[0].y) < 1 && normBoxes([[0, 0, 0, 5]], img).length === 0,
    `bigObjects gợi ý: cabochon ${hb.map((s) => `${s.src} ${s.physMm} IoU ${s.hintIoU}`)} | tỉ lệ ${hn.map((s) => s.physMm)}`);
  const fb = [24, 24, 24 + 8 * px, 24 + 8 * px], hf = detectBeads(img, { ...o0, bigObjects: [fb] }).stones, inF = (s) => Math.hypot(s.x - (fb[0] + fb[2]) / 2, s.y - (fb[1] + fb[3]) / 2) < 4 * px; // trong elip nội tiếp bbox
  ok(hf.filter((s) => s.big).length === 1 && hf.filter((s) => !s.big && inF(s)).length === 0, `bigObjects gợi ý trên nền hạt: ${hf.filter((s) => s.big).map((s) => `${s.src} ${s.physMm}`)}, hạt nhỏ trong bbox ${hf.filter((s) => !s.big && inF(s)).length}`);
  // params.countHints: thừa → bỏ đốm yếu nhất tới đúng số; thiếu → thêm đốm yếu (không vượt số gợi ý); 'pearl' cộng vào 'white'
  const nC = blue.filter((s) => s.material === 'color').length, rc = detectBeads(img, { canvasWmm: W / K7, stoneMm: 2.2, gapMm: 0.4, countHints: [{ counts: { color: nC - 10 } }] });
  const rcC = rc.work.countHints[0].counts.color, ru = detectBeads(img, { canvasWmm: W / K7, stoneMm: 2.2, gapMm: 0.4, countHints: [{ bbox: [0, 0, 1, 1], counts: { color: nC + 30 } }] }).work.countHints[0].counts.color;
  ok(rcC.before === nC && rcC.after === nC - 10 && rc.stones.filter((s) => s.tier === 3 && s.material === 'color').length === nC - 10 && ru.after >= ru.before && ru.after <= nC + 30
    && JSON.stringify(normCounts([{ counts: { pearl: 3, white: 2, colour: 1, x: 9 } }], img)[0].counts) === '{"white":5,"color":1}', `countHints: thừa ${JSON.stringify(rcC)}, thiếu ${JSON.stringify(ru)}`);
  // vật liệu: vàng / trắng / màu trên đĩa phẳng; ngọc trai = kind pearl
  const disc = (rgb) => { const im = { w: 20, h: 20, data: new Uint8Array(1600) }; for (let j = 0; j < 400; j++) im.data.set([...rgb, 255], j * 4); return materialOf(im, 10, 10, 5, 'stone'); };
  ok(disc([205, 160, 60]) === 'gold' && disc([236, 234, 228]) === 'white' && disc([190, 30, 40]) === 'color' && disc([40, 110, 60]) === 'color' && materialOf(img, cab.x, cab.y, 9, 'pearl') === 'pearl',
    `material: ${[[205, 160, 60], [236, 234, 228], [190, 30, 40], [40, 110, 60]].map(disc)}`);
}
// fixture thật + DB (chỉ đọc; có thì test)
{
  const f = `${process.cwd()}/requirements/Trang phục King.png`;
  if (fs.existsSync(f)) {
    const img = decodePng(fs.readFileSync(f)), m = backgroundMask(img);
    const det = detectBeads(img, { stoneMm: 2.2, gapMm: 0.4 }, m.mask).stones, onBg = det.filter((s) => m.bg[Math.floor(s.y) * img.w + Math.floor(s.x)]).length;
    ok(m.checker && m.checker.cell >= 10 && m.checker.cell <= 13 && m.pct.bg > 45 && m.pct.bg < 55 && onBg === 0 && det.length > 2000,
      `Trang phục King: ${JSON.stringify(m.pct)} ô ${m.checker?.cell}, ${det.length} viên, ${onBg} trên nền, ${det.filter((s) => s.kind === 'pearl').length} ngọc`);
    // KIT-12a: sapphire giữa cổ áo (Ø ~15 mm) và opal oval (~20 × 15 mm) = đúng 1 viên mỗi chỗ (vùng đo tay trên ảnh phóng 3543 px)
    const sc = img.w / 3543, inside = (x, y, a, b) => det.filter((s) => ((s.x - x * sc) / (a * sc)) ** 2 + ((s.y - y * sc) / (b * sc)) ** 2 <= 1);
    const sap = inside(1690, 2200, 88, 88), op = inside(1664, 2733, 95, 120);
    ok(sap.length === 1 && sap[0].big && op.length === 1 && op[0].big && op[0].flags.includes('oval'),
      `Trang phục King: sapphire ${sap.length} viên, opal ${op.length} viên (${[...sap, ...op].map((s) => `${s.kind} ${s.physMm} ${s.axesMm} ${s.flags}`).join(' | ')})`);
  }
  const dbf = new URL('../kit/db/kit.sqlite', import.meta.url), REQ = `${process.cwd()}/requirements/`;
  if (fs.existsSync(dbf)) {
    const { DatabaseSync } = await import('node:sqlite'), db = new DatabaseSync(dbf.pathname);
    const p = db.prepare("SELECT * FROM products WHERE id = 'snowman'").get();
    if (p && fs.existsSync(REQ + p.clean_image)) {
      const img = decodePng(fs.readFileSync(REQ + p.clean_image)), k = img.w / p.viewbox_px * p.px_per_mm, cm = { pp: 0, pn: 0, zp: 0, zn: 0 };
      for (const t of db.prepare("SELECT cx_px x, cy_px y, physical_mm d, catalog_series s FROM stones WHERE product = 'snowman' AND catalog_series IN ('PEARL', 'Z', 'L')").all()) {
        const pr = isPearl(t.d, beadFeatures(img, t.x * img.w / p.viewbox_px, t.y * img.w / p.viewbox_px, 0.35 * t.d * k));
        if (t.s === 'PEARL') cm[pr ? 'pp' : 'pn']++; else cm[pr ? 'zp' : 'zn']++;
      }
      ok(cm.pp / (cm.pp + cm.pn) >= 0.9 && cm.zp === 0, `DB snowman: ngọc ở vị trí thật ${cm.pp}/${cm.pp + cm.pn}, đá L/Z bị nhận ngọc ${cm.zp}`);
    }
  }
}

// ── KIT-10 VLM vùng đá: ô, raster, ghép, RLE, params.regionMask, gọi Flash (fetch giả), so đáp án.
{
  const { encodeRegion, decodeRegion, regionToMask, withRegion, fillPoly, tilePlan, labelTiles, mergeTiles, buildDoc, mockLabel, callFlash, gtMask, scoreMask, centerRecall, rules, estimateCost } = vlm;
  const m = Uint8Array.from([0, 0, 1, 1, 1, 0, 1, 0, 0, 1, 1, 1]), rm = encodeRegion(m, 4, 3);
  ok(rm.schema === 'pearl-kit-region/1' && rm.rle.join() === '2,3,1,1,2,3' && decodeRegion(rm).bits.join() === m.join() && decodeRegion({ regionMask: rm }).w === 4, `vlm rle: ${rm.rle}`);
  ok(encodeRegion(Uint8Array.from([1, 1]), 2, 1).rle.join() === '0,2', 'vlm rle: bắt đầu bằng 1');
  throws(() => decodeRegion({ ...rm, rle: [2, 3] }), /rle/, 'vlm rle: thiếu độ dài');
  throws(() => decodeRegion({ w: 4, h: 3, rle: [12] }), /regionMask lạ/, 'vlm rle: schema');
  const big = regionToMask(rm, 8, 6);
  ok(big[0] === 0 && big[4] === 1 && big[7] === 1 && big[8 * 5 + 7] === 1 && big[8 * 5] === 0, 'vlm regionToMask: phóng lân cận gần nhất');
  const sq = new Uint8Array(100);
  fillPoly(sq, 10, 10, [[2, 2], [6, 2], [6, 5], [2, 5]], 1);
  ok(sq.reduce((a, b) => a + b, 0) === 12 && sq[2 * 10 + 2] && !sq[5 * 10 + 6], 'vlm fillPoly: hình chữ nhật 4×3');
  fillPoly(sq.fill(0), 10, 10, [[0, 0], [10, 0], [10, 10], [0, 10]], 1, { x0: 5, y0: 0, x1: 10, y1: 10 });
  ok(sq.reduce((a, b) => a + b, 0) === 50 && !sq[4] && sq[5], 'vlm fillPoly: clip');

  // ảnh 1000×600: nửa trái hạt (ô sáng/tối xen kẽ 6 px), nửa phải phẳng, dải dưới cùng trong suốt
  const W = 1000, H = 600, data = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const bead = x < 500 && ((x / 6 | 0) + (y / 6 | 0)) % 2;
    data.set(x < 500 ? (bead ? [250, 250, 245, 255] : [120, 110, 100, 255]) : [40, 120, 60, 255], (y * W + x) * 4);
    if (y >= 560) data[(y * W + x) * 4 + 3] = 0;
  }
  const img = { w: W, h: H, data }, plan = tilePlan(img, { tileMm: 40, overlap: 0.1, pxPerMm: 11.81 });
  const xs = [...new Set(plan.tiles.map((t) => t.x))], ys = [...new Set(plan.tiles.map((t) => t.y))];
  ok(plan.tilePx === 472 && xs.join() === '0,264,528' && ys.join() === '0,128' && xs.at(-1) + 472 === W && plan.tiles.every((t) => !t.skip), `vlm tilePlan: ${xs} × ${ys}`);
  const plan2 = tilePlan({ w: 600, h: 600, data: new Uint8Array(600 * 600 * 4) }, { tileMm: 20 });
  ok(plan2.tiles.every((t) => t.skip) && plan2.tiles.length === 9, 'vlm tilePlan: ô trong suốt bị bỏ');
  ok(estimateCost(100, vlm.PRICE, {}).usd > 0.5 && estimateCost(100, vlm.PRICE, {}).usd < 2 && estimateCost(10, vlm.PRICE, { VLM_PRICE_IN: '0', VLM_PRICE_OUT: '1' }).usd === 0.025, 'vlm estimateCost');

  // gọi giả: phần ô nằm bên trái x=500 là stone/pearl, còn lại print; ô 5 lỗi; cache lần 2
  const seen = [], store = new Map(), cache = { get: (k) => store.get(k), set: (k, v) => store.set(k, v) };
  const call = async (parts, t) => {
    seen.push(t.i);
    if (t.i === 5) throw new Error('HTTP 500: thử lỗi');
    const cut = Math.max(0, Math.min(1000, Math.round((1000 * (500 - t.x)) / t.w)));
    const regions = [{ label: 'print', material: 'other', color: '#287830', color_name: 'green', polygon: [0, cut, 0, 1000, 1000, 1000, 1000, cut] }];
    if (cut > 0) regions.push({ label: 'stone', material: 'pearl', color: '#F0F0EA', color_name: 'white', polygon: [0, 0, 0, cut, 1000, cut, 1000, 0] });
    return { model: 'fake', data: { regions: [...regions, { label: 'x', polygon: [1, 2] }] }, usage: { in: 100, out: 50 } };
  };
  const tiles = await labelTiles(img, plan, { call, model: 'fake', cache, concurrency: 2 });
  ok(seen.length === 6 && tiles[5].error === 'HTTP 500: thử lỗi' && tiles[0].regions.length === 2 && tiles[0].regions.every((r) => r.polygon.length === 8), `vlm labelTiles: ${seen.length} call, ô lỗi giữ lỗi, polygon hỏng bị bỏ`);
  const again = await labelTiles(img, plan, { call, model: 'fake', cache });
  ok(seen.length === 6 + 1 && again.filter((t) => t.cached).length === 5, `vlm labelTiles: cache (${seen.length - 6} call lại = ô lỗi)`);
  const merged = mergeTiles(img, tiles);
  const at = (x, y) => merged.mask[Math.floor(y / merged.grid.scale) * merged.grid.w + Math.floor(x / merged.grid.scale)];
  ok(merged.grid.w === 1000 && at(100, 100) === 1 && at(480, 300) === 1 && at(520, 300) === 0 && at(900, 100) === 0 && at(100, 580) === 0, 'vlm mergeTiles: nửa trái = stone, vùng trong suốt = 0');
  const doc = buildDoc(img, { name: 't', sha1: 'x', plan, tiles, merged, model: 'fake' });
  ok(doc.schema === 'pearl-kit-vlm/1' && doc.stats.calls === 5 && doc.stats.errors === 1 && doc.stats.usage.in === 500 && doc.regions.some((r) => r.family === 'white' && r.material === 'pearl')
    && Math.abs(doc.stats.stonePct - 46.7) < 1, `vlm buildDoc: ${JSON.stringify(doc.stats)}`);

  // params.regionMask: DETECT (buildKit) + PLACE stub + place() của KIT-2 chỉ đặt đá trong vùng
  const half = encodeRegion(Uint8Array.from({ length: 100 }, (_, j) => (j % 10 < 5 ? 1 : 0)), 10, 10);
  const wr = withRegion(img, null, doc);
  ok(withRegion(img, null, regionToMask(doc, W, H)).join() === wr.join(), 'vlm withRegion: nhận Uint8Array cỡ ảnh (select.js)');
  ok(wr[300 * W + 100] === 1 && wr[300 * W + 700] === 0 && wr[580 * W + 100] === 0 && withRegion(img, sq, null) === sq, 'vlm withRegion: AND alpha, null → giữ mask');
  // ảnh hạt tròn bước 3 mm (35 px) phủ kín, mặt nạ = nửa trái
  const crop = { w: 400, h: 300, data: new Uint8Array(400 * 300 * 4) };
  for (let y = 0; y < 300; y++) for (let x = 0; x < 400; x++) {
    const dx = ((x % 35) - 17) / 13, dy = ((y % 35) - 17) / 13, r = dx * dx + dy * dy, v = r < 1 ? 120 + 130 * (1 - r) : 40;
    crop.data.set([v, v * 0.9, v * 0.8, 255], (y * 400 + x) * 4);
  }
  const P = { canvasWmm: 400 / 11.81, stoneMm: 2.2, gapMm: 0.8, maxColors: 4 }, O = { source: { name: 'c.png', bytes: Buffer.from('x') }, now: new Date(0) };
  const dAll = await buildKit(crop, { ...P, mode: 'detect' }, O), dHalf = await buildKit(crop, { ...P, mode: 'detect', regionMask: half }, O);
  ok(dAll.stones.some((s) => s.x > 230) && dHalf.stones.length > 0 && dHalf.stones.every((s) => s.x < 205) && !('regionMask' in dHalf.params), `vlm DETECT regionMask: ${dAll.stones.length} → ${dHalf.stones.length} viên, chỉ nửa trái`);
  const pHalf = await buildKit(crop, { ...P, mode: 'place', regionMask: half }, O);
  ok(pHalf.stones.length > 0 && pHalf.stones.every((s) => s.x < 205), `vlm PLACE stub regionMask: ${pHalf.stones.length} viên`);
  const k2 = place(crop, null, { frame: { x: 0, y: 0, scale: 1 }, accents: false, regionMask: half });
  ok(k2.stones.length > 0 && k2.stones.every((s) => s.x < 205) && !('regionMask' in k2.params), `vlm place() regionMask: ${k2.stones.length} viên`);

  // mock: hạt → stone/pearl, phẳng → print
  const mk = mockLabel(img, { x: 0, y: 0, w: 472, h: 472 }), mk2 = mockLabel(img, { x: 528, y: 0, w: 472, h: 472 });
  ok(mk.regions.length === 16 && mk.regions.every((r) => r.label === 'stone') && mk2.regions.every((r) => r.label === 'print' && r.color_name === 'green'), 'vlm mockLabel');

  // callFlash: key trong header, schema trong body, thử lại khi 429, không lộ key trong lỗi
  const reqs = [];
  const fetchFn = async (url, o) => {
    reqs.push({ url, o });
    if (reqs.length === 1) return { ok: false, status: 429, json: async () => ({ error: { message: 'quota' } }) };
    return { ok: true, status: 200, json: async () => ({ modelVersion: 'gemini-x', candidates: [{ content: { parts: [{ text: '{"regions":[]}' }] } }], usageMetadata: { promptTokenCount: 7, candidatesTokenCount: 3, thoughtsTokenCount: 2 } }) };
  };
  const g = await callFlash([{ text: 'hi' }], vlm.TILE_SCHEMA, { env: { GEMINI_API_KEY: 'SECRET', ANALYZE_MODEL: 'm1' }, fetchFn, retries: 1 });
  const body = JSON.parse(reqs[1].o.body);
  ok(reqs.length === 2 && reqs[1].url.endsWith('/models/m1:generateContent') && !reqs[1].url.includes('SECRET') && reqs[1].o.headers['x-goog-api-key'] === 'SECRET'
    && body.generationConfig.responseSchema?.properties?.regions && body.generationConfig.temperature === 0 && g.model === 'gemini-x' && g.usage.in === 7 && g.usage.out === 5 && Array.isArray(g.data.regions), 'vlm callFlash: header key, thử lại 429, usage');
  let err;
  try { await callFlash([], {}, { env: { GEMINI_API_KEY: 'SECRET' }, fetchFn: async () => ({ ok: false, status: 400, json: async () => ({ error: { message: 'bad' } }) }) }); } catch (e) { err = e.message; }
  ok(err === 'HTTP 400: bad', `vlm callFlash: lỗi 400 (${err})`);
  try { await callFlash([], {}, { env: {} }); err = ''; } catch (e) { err = e.message; }
  ok(/GEMINI_API_KEY/.test(err), 'vlm callFlash: thiếu key');

  // so đáp án: 2 viên ở nửa trái; đóng 1.5mm nối khe 1mm
  const gstones = [{ x: 100, y: 100, dMm: 2.8, series: 'L' }, { x: 100 + 3.8 * 11.81, y: 100, dMm: 2.8, series: 'L' }, { x: 800, y: 300, dMm: 5, series: 'PEARL' }];
  const gt = gtMask(gstones, W, H), gat = (a, x, y) => a[Math.floor(y) * gt.grid.w + Math.floor(x)];
  ok(gat(gt.disc, 100, 100) && !gat(gt.disc, 100 + 1.9 * 11.81, 100) && gat(gt.closed, 100 + 1.9 * 11.81, 100) && !gat(gt.closed, 100, 100 + 3 * 11.81), 'vlm gtMask: đĩa + đóng nối khe');
  const sc = scoreMask(Uint8Array.from([1, 1, 0, 0]), Uint8Array.from([1, 0, 1, 0]));
  ok(sc.iou === 0.3333 && sc.precision === 0.5 && sc.recall === 0.5, `vlm scoreMask: ${JSON.stringify(sc)}`);
  const cr = centerRecall(merged.mask, merged.grid, gstones);
  ok(cr.all === 0.67 && cr.bySeries.L.recall === 1 && cr.bySeries.PEARL.recall === 0, `vlm centerRecall: ${JSON.stringify(cr)}`);
  const ru = rules(doc, gt, gstones), pearl = ru.table.find((r) => r.key === 'material:pearl');
  ok(pearl && pearl.series.L >= 2 && ru.table.find((r) => r.key === 'label:print').series.PEARL >= 1 && 'iou' in ru.derived.byMaterial, `vlm rules: ${JSON.stringify(pearl)}`);
}

// ── KIT-12c VLM vật thể to: box_2d → px, cắt/đổi cỡ, ngân sách call cứng (file jsonl), schema enum.
{
  const area = { x: 100, y: 50, w: 200, h: 400 }, b = vlm.boxPx([250, 500, 750, 1000], area);
  ok(b && b.x0 === 200 && b.x1 === 300 && b.y0 === 150 && b.y1 === 350, `boxPx ${JSON.stringify(b)}`);
  ok(vlm.boxPx([500, 0, 400, 10], area) === null && vlm.boxPx([0, 0, 1], area) === null && vlm.boxPx([0, -50, 1200, 10], area).x0 === 100, 'boxPx bad/clamped');
  const img = { w: 4, h: 4, data: new Uint8Array(64) };
  for (let j = 0; j < 16; j++) img.data.set(j < 8 ? [200, 0, 0, 255] : [0, 0, 0, 0], j * 4); // nửa trên đỏ, nửa dưới trong suốt
  const dn = vlm.resizeRegion(img, { x: 0, y: 0, w: 4, h: 4 }, 2), up = vlm.resizeRegion(img, { x: 0, y: 0, w: 2, h: 1 }, 8);
  ok(dn.w === 2 && dn.h === 2 && dn.data[0] === 200 && dn.data[1] === 0 && dn.data[8] === 255 && dn.data[11] === 255, `resizeRegion box ${[...dn.data]}`);
  ok(up.w === 8 && up.h === 4 && up.data.every((v, i) => v === [200, 0, 0, 255][i % 4]), 'resizeRegion bilinear');
  const dir = fs.mkdtempSync(`${os.tmpdir()}/kitvlm-`), file = `${dir}/calls.jsonl`, bud = vlm.callBudget(file, 2, fs);
  const fake = async () => ({ model: 'm', usage: { in: 1000, out: 1000 }, data: {} });
  await bud.call({ kind: 'a' }, fake);
  let err = null;
  try { await bud.call({ kind: 'b' }, async () => { throw new Error('boom'); }); } catch (e) { err = e; }
  let stop = null, ran = false;
  try { await bud.call({ kind: 'c' }, async () => { ran = true; return fake(); }); } catch (e) { stop = e; }
  const L = bud.lines();
  ok(err?.message === 'boom' && stop?.budget && !ran && bud.used() === 2, `callBudget cap: used ${bud.used()} ${stop?.message}`);
  ok(L.length === 4 && L[1].state === 'done' && L[1].usd === 0.004 && L[3].state === 'error' && L.every((l) => !JSON.stringify(l).includes('key')), `callBudget log ${JSON.stringify(L)}`);
  fs.rmSync(dir, { recursive: true, force: true });
  const en = (sch, path) => path.reduce((o, k) => o[k], sch);
  ok(en(vlm.OBJECT_SCHEMA, ['properties', 'objects', 'items', 'properties', 'material']).enum.join() === vlm.OBJ_MATERIALS.join()
    && en(vlm.STONES_SCHEMA, ['properties', 'stones', 'items', 'properties', 'shape']).enum.includes('marquise')
    && en(vlm.CROP_SCHEMA, ['properties', 'main', 'properties', 'structure']).enum.join() === vlm.STRUCTURES.join()
    && /box_2d/.test(vlm.objectPrompt(300)) && /12 x 9 mm/.test(vlm.cropPrompt(12.2, 9, 'x')) && /box_2d/.test(vlm.stonesPrompt()), 'KIT-12c schemas/prompts');
}

// ── KIT-13 tầng theo cỡ: trần $ (cộng dồn, giữ dự phòng cho call song song), tag số, schema/prompt.
{
  const dir = fs.mkdtempSync(`${os.tmpdir()}/kitvlm13-`), file = `${dir}/calls.jsonl`;
  fs.writeFileSync(file, `${JSON.stringify({ n: 1, state: 'sent' })}\n${JSON.stringify({ n: 1, state: 'done', usage: { in: 0, out: 30000 } })}\n`); // $0.09 đã tiêu
  const bud = vlm.callBudget(file, 100, fs, { usdCap: 0.15, reserveUsd: 0.03 });
  let release;
  const slow = bud.call({ kind: 'a' }, () => new Promise((ok) => { release = () => ok({ model: 'm', usage: { in: 0, out: 1000 }, data: {} }); }));
  let e2 = null; // 0.09 + 0.03×2 = 0.15 → vẫn được; call thứ 3 song song: 0.09 + 0.03×3 > 0.15 → chặn
  const second = bud.call({ kind: 'b' }, async () => ({ model: 'm', usage: { in: 0, out: 1000 }, data: {} }));
  try { await bud.call({ kind: 'c' }, async () => ({})); } catch (e) { e2 = e; }
  release(); await slow; await second;
  ok(e2?.budget && /trần/.test(e2.message) && Math.abs(bud.spent() - 0.096) < 1e-9 && new Set(bud.lines().filter((l) => l.state === 'sent').map((l) => l.n)).size === 3, `callBudget usdCap ${e2?.message} ${bud.spent()}`);
  let e3 = null;
  try { await bud.call({ kind: 'd' }, async () => ({})); } catch (e) { e3 = e; } // 0.096 + 0.03 = 0.126 ≤ 0.15 → được
  ok(!e3, 'callBudget under cap');
  fs.rmSync(dir, { recursive: true, force: true });
  const im = { w: 60, h: 30, data: new Uint8Array(60 * 30 * 4).fill(128) };
  vlm.drawTag(im, 30, 15, 12, 16, loadGlyphs());
  const px = (x, y) => [...im.data.subarray((y * 60 + x) * 4, (y * 60 + x) * 4 + 3)];
  let dark = 0; for (let y = 8; y < 23; y++) for (let x = 18; x < 42; x++) if (px(x, y)[0] < 60) dark++;
  ok(px(0, 0)[0] === 128 && dark > 20 && px(30, 15).length === 3, `drawTag dark ${dark}`);
  ok(vlm.TIER_SCHEMA.properties.stones.items.properties.color.enum.join() === vlm.COLORS.join() && vlm.LABEL_SCHEMA.properties.items.items.properties.material.enum.includes('none')
    && vlm.COUNT_SCHEMA.properties.groups.items.properties.size.enum.join() === '2.8,4,5+' && /267/.test(vlm.bigPrompt(30, 30)) && /8 mm/.test(vlm.bigPrompt(300, 300))
    && /1 to 12 sit/.test(vlm.labelPrompt(12, 25)) && /11%/.test(vlm.countPrompt(25, 25)) && vlm.TIERS.mid.join() === '5,7', 'KIT-13 schemas/prompts');
}

// ── KIT-15 đáp án tay Queen: vật liệu kiểu DETECT, schema / prompt.
ok(vlm.mat4('pearl', 'gold') === 'gold' && vlm.mat4('pearl', 'white') === 'pearl' && vlm.mat4('rhinestone', 'clear') === 'white' && vlm.mat4('cabochon', 'red') === 'color'
  && vlm.GT_SCHEMA.properties.items.items.properties.material.enum.includes('none') && vlm.MISS_SCHEMA.properties.missing.items.required.includes('box_2d')
  && /1 to 9 /.test(vlm.gtPrompt(9, 25)) && /1 mm = 41 px/.test(vlm.gtPrompt(9, 25)) && /1 mm = 82 px/.test(vlm.missPrompt(12.5)), 'KIT-15 mat4/schemas/prompts');

// KIT-17: phóng ×4 (Lanczos dự phòng, không cần binary Real-ESRGAN) + luồng thú cưng (LoG 2.8/4 mm + mã k-NN phần dư, ≤ 13 mã)
{
  const up = await import('../lib/kit/upscale.js'), pet = await import('../lib/kit/pet.js');
  const flat = { w: 6, h: 5, data: new Uint8Array(120).map((_, j) => (j % 4 === 3 ? 255 : 77)) }, L4 = up.lanczos(flat, 4), dn = up.boxDown(L4, 4);
  const r4x = await up.upscale4(flat, { force: 'lanczos' }), fr = up.findRealesrgan();
  ok(L4.w === 24 && L4.h === 20 && L4.data.every((v, j) => v === (j % 4 === 3 ? 255 : 77)) && dn.w === 6 && dn.data.every((v, j) => v === flat.data[j])
    && r4x.method === 'lanczos' && r4x.img.w === 24 && (fr === null || (fs.existsSync(fr.bin) && fs.existsSync(fr.models))), `KIT-17 upscale: lanczos/boxDown/upscale4, realesrgan ${fr ? fr.bin : 'không có (dùng Lanczos)'}`);
  // mã: ảnh cam → catalog vàng khi mẫu học nói "cam trong ảnh = L16" (phần dư); màu gần nhất chọn cam L74
  const bom = [{ code: 'L16', physMm: 2.8, lab: pet.lab([200, 149, 47]) }, { code: 'L74', physMm: 2.8, lab: pet.lab([200, 116, 44]) }, { code: 'L4', physMm: 2.8, lab: pet.lab([197, 30, 42]) }, { code: 'Z16', physMm: 4, lab: pet.lab([200, 149, 47]) }, { code: 'Z4', physMm: 4, lab: pet.lab([197, 30, 42]) }];
  const orange = pet.lab([215, 120, 40]), model = { pts: Array.from({ length: 20 }, (_, i) => { const l = pet.lab([212 + (i % 5), 118 + (i % 3), 40]), c = pet.lab([200, 149, 47]); return { lab: l, sd: 40, d: 2.8, code: 'L16', cat: c, res: c.map((v, j) => v - l[j]) }; }) };
  const f = { lab: orange, sd: 40, d: 2.8 };
  ok(pet.predictCode(model, f, bom, { ...pet.PET, code: 'nearest' }) === 'L74' && pet.predictCode(model, f, bom, pet.PET) === 'L16' && pet.predictCode(model, { ...f, d: 4 }, bom, pet.PET) === 'Z16',
    'KIT-17 mã k-NN phần dư (cam ảnh → L16), cùng size');
  const many = Array.from({ length: 20 }, (_, i) => ({ code: `C${i}`, physMm: i < 18 ? 2.8 : 6, lab: [50 + i, 10 * (i % 3), 5 * i] }));
  const sts = many.flatMap((b, i) => Array.from({ length: 20 - i }, () => ({ x: 0, y: 0, physMm: b.physMm, code: b.code })));
  const lim = pet.limitCodes(sts, many, 13), codes = new Set(lim.map((s) => s.code));
  ok(codes.size <= 15 && new Set(lim.filter((s) => s.physMm < 5).map((s) => s.code)).size <= 13 && lim.length === sts.length && lim.every((s) => s.physMm === 2.8 || s.physMm === 6), `KIT-17 limitCodes: ${codes.size} mã`);
  // petMap trên nền hạt 2 màu (đỏ trái, vàng phải) 4.18 px/mm → phóng ×4 (Lanczos) qua runPet, toạ độ trả theo ảnh vào
  const W = 160, H = 120, im = { w: W, h: H, data: new Uint8Array(W * H * 4) }, px = 4.18, pitch = 3.2 * px;
  for (let j = 0; j < W * H; j++) im.data.set([30, 30, 30, 255], j * 4);
  for (let y = pitch / 2; y < H; y += pitch) for (let x = pitch / 2; x < W; x += pitch) {
    const c = x < W / 2 ? [197, 30, 42] : [205, 155, 50];
    for (let v = Math.floor(y - 7); v <= y + 7; v++) for (let u = Math.floor(x - 7); u <= x + 7; u++) { const d = Math.hypot(u + 0.5 - x, v + 0.5 - y); if (u < 0 || v < 0 || u >= W || v >= H || d > 1.4 * px) continue; const sh = 0.55 + 0.45 * Math.sqrt(1 - (d / (1.4 * px)) ** 2); im.data.set([...c.map((t) => Math.round(t * sh)), 255], (v * W + u) * 4); }
  }
  const pr = await pet.runPet(im, { canvasWmm: W / px, model: null, bom, code: 'nearest', upscale: 'lanczos' }), left = pr.stones.filter((s) => s.x < W / 2 - 6), right = pr.stones.filter((s) => s.x > W / 2 + 6);
  const nExp = Math.round(W / pitch) * Math.round(H / pitch);
  ok(pr.upscale?.method === 'lanczos' && pr.stones.length >= 0.8 * nExp && pr.stones.length <= 1.25 * nExp && pr.stones.every((s) => s.x >= 0 && s.x < W && s.y >= 0 && s.y < H)
    && left.filter((s) => /4$/.test(s.code)).length >= 0.9 * left.length && right.filter((s) => /16|74/.test(s.code)).length >= 0.9 * right.length,
    `KIT-17 runPet: ${pr.stones.length}/${nExp} viên, trái đỏ ${left.filter((s) => /4$/.test(s.code)).length}/${left.length}, phải vàng ${right.filter((s) => /16|74/.test(s.code)).length}/${right.length}`);
}

// KIT-19: ép bảng mã chung (fitPalette, ≤ maxNew mã mới, không phóng cỡ), gỡ chồng pet, khe ≥ 0.15 mm với trang phục, bảng tạm Queen ∪ Starry
{
  const pet = await import('../lib/kit/pet.js'), { loadCatalog: smCat } = await import('../lib/stonemap/catalog.js');
  const B = (code, physMm, rgb) => ({ code, physMm, lab: pet.lab(rgb) });
  const bom = [B('G', 2.8, [200, 150, 50]), B('W', 2.8, [240, 240, 240]), B('O', 2.8, [220, 110, 30]), B('K', 2.8, [20, 20, 20]), B('G4', 4, [200, 150, 50]), B('O4', 4, [220, 110, 30])];
  const items = [...Array(30).fill({ t: pet.lab([222, 108, 32]), physMm: 2.8 }), ...Array(5).fill({ t: pet.lab([25, 25, 25]), physMm: 2.8 }), { t: pet.lab([218, 112, 30]), physMm: 4 }, { t: pet.lab([238, 238, 238]), physMm: 4 }];
  const f0 = pet.fitPalette(items, bom, { codes: ['G', 'W', 'G4', 'X999'], maxNew: 0 }), f1 = pet.fitPalette(items, bom, { codes: ['G', 'W', 'G4'], maxNew: 1 }), f2 = pet.fitPalette(items, bom, { codes: ['G', 'W', 'G4'], maxNew: 2 });
  ok(f0.added.length === 0 && f0.base.join() === 'G,W,G4' && f0.assign.every((b) => ['G', 'W', 'G4'].includes(b.code)) && f0.assign[36].code === 'W' && f0.assign[36].physMm === 2.8
    && f1.added.join() === 'O' && f1.assign[0].code === 'O' && f1.assign[30].code !== 'K' && f2.added.join() === 'O,K' && f2.assign[30].code === 'K'
    && [f0, f1, f2].every((f) => f.assign.every((b, i) => b.physMm <= items[i].physMm)), `KIT-19 fitPalette: +1 ${f1.added} +2 ${f2.added}, 4 mm trắng → ${f0.assign[36].code}@${f0.assign[36].physMm}`);
  // gỡ chồng (px = mm ở kImg 1): 2 viên 2.8 cách 2 mm → giữ 1 (score cao); 4 mm kẹp giữa 2 viên 2.8 cách 3 mm → 2.8; viên 8 mm giữ cỡ
  const st = [{ x: 0, y: 0, physMm: 2.8, score: 1 }, { x: 2, y: 0, physMm: 2.8, score: 0.5 }, { x: 20, y: 0, physMm: 4, score: 0.4 }, { x: 23, y: 0, physMm: 2.8, score: 0.9 }, { x: 17, y: 0, physMm: 2.8, score: 0.9 },
    { x: 50, y: 0, physMm: 8, score: 0 }, { x: 55, y: 0, physMm: 2.8, score: 2 }, { x: 80, y: 0, physMm: 4, score: 0.3 }];
  const ro = pet.resolveOverlap(st, 1, -0.05), at = (x) => ro.find((s) => s.x === x);
  ok(ro.length === 6 && at(0) && !at(2) && at(20)?.physMm === 2.8 && at(50)?.physMm === 8 && !at(55) && at(80)?.physMm === 4, `KIT-19 resolveOverlap: ${ro.map((s) => `${s.x}@${s.physMm}`).join(' ')}`);
  // khe với trang phục (mm, edgeGap mọi shape): sát 0.1 → bỏ; 4 mm sát nhưng 2.8 vừa → thu; xa → giữ; marquise xoay
  const cat = smCat(), R = (x, y, d, code = 'L16') => ({ x_mm: x, y_mm: y, phys_mm: d, ref_mm: d - 0.8, shape: 'round', rot_deg: 0, code });
  const costume = [R(10, 10, 2.8), R(30, 10, 2.8), { ...R(50, 10, 8, 'M029'), shape: 'marquise', ref_mm: 7.2, rot_deg: 90 }];
  const ko = pet.keepOut([R(12.9, 10, 2.8), R(33.5, 10, 4), R(40, 10, 2.8), R(50, 13.7, 2.8)], costume, { gapMm: 0.15, cat, shrink: (s) => ({ ...s, phys_mm: 2.8, ref_mm: 2.2 }) });
  ok(ko.dropped === 1 && ko.shrunk === 1 && ko.stones.length === 3 && ko.stones.some((s) => s.x_mm === 33.5 && s.phys_mm === 2.8) && ko.stones.some((s) => s.x_mm === 50),
    `KIT-19 keepOut: bỏ ${ko.dropped} thu ${ko.shrunk} còn ${ko.stones.length}`);
  const pp = pet.productPalette();
  ok(pp.codes.length === new Set(pp.codes).size && ['L94', 'L16', 'L47'].every((c) => pp.codes.includes(c)) && pp.codes.length <= 13, `KIT-19 productPalette ${pp.codes.length} mã (${pp.from.slice(0, 40)})`);
}

// KIT-14/16: viên hình (tim / marquise / giọt) + mẫu Queen cố định
{
  const k = 11.81, A = { x: 0, y: 0, shape: 'marquise', w: 6, h: 12, rot: 0 }, B = { ...A, x: 6.5 * k }, C = { ...A, x: 3 * k, rot: 90 };
  const mid = stonePoly({ x: 0, y: 0, shape: 'heart', rot: 0 }, k, 10, 10);
  ok(Math.abs(gapMm(A, B, k) - 0.5) < 0.05 && gapMm(A, C, k) < 0 && sdPoly(mid, 0, 0) < 0 && sdPoly(mid, 6 * k, 0) > 0, `shapes gap ${gapMm(A, B, k).toFixed(3)} / ${gapMm(A, C, k).toFixed(3)}`);
  const cat = loadCatalog(), f = 'kit/templates/queen_costume_chain.svg';
  if (fs.existsSync(f)) {
    const d = readKitSvg(fs.readFileSync(f, 'utf8')), chk = checkDesign(d, cat), sh = d.stones.filter((s) => s.shape && s.shape !== 'round');
    const big = JSON.parse(fs.readFileSync('kit/templates/queen_big.json', 'utf8')).stones;
    ok(chk.ok && sh.some((s) => s.shape === 'heart' && /^X/.test(s.code)) && sh.some((s) => s.shape === 'marquise' && /^M/.test(s.code) && Math.abs(s.rot || 0) > 1)
      && d.palette.every((p) => (cat.codes[p.code]?.kind === 'pearl' ? p.symbol === String(cat.codes[p.code].physMm) : p.symbol.length === 1 && LETTERS.includes(p.symbol)))
      && big.every((b) => (cat.codes[b.code] || cat.shaped[b.code]) && ((cat.shaped[b.code]?.shape) || 'round') === b.shape), `queen template ${chk.errors?.slice(0, 3)} shaped ${sh.length}`);
  }
}

// ── KIT-18 bảng mã chung (lib/kit/palette.js) + lấp dày (lib/kit/pack.js)
{
  const { mergePalette, remapBig } = await import('../lib/kit/palette.js');
  const { densify } = await import('../lib/kit/pack.js');
  const { lab } = await import('../lib/kit/select.js');
  const cat = loadCatalog(), labC = (c) => lab(cat.codes[c].fill.replace('#', '').match(/\w\w/g).map((v) => parseInt(v, 16)));
  const rec = (layer, code, n, mat = 'base', physMm = 2.8) => Array.from({ length: n }, () => ({ layer, mat, physMm, t: labC(code), gwl: 1 }));
  const R = [...rec('bg', 'L47', 50), ...rec('bg', 'L37', 5), ...rec('bg', 'L4', 40), ...rec('cos', '5', 10, 'pearl', 5)];
  const m = mergePalette(R, cat, { maxCodes: 3 });
  ok(m.codes.length === 3 && m.codes.includes('5') && m.codes.includes('L47') && m.codes.includes('L4') && m.merges.length === m.initialCodes - 3,
    `mergePalette: ${m.codes} sau ${m.merges.length} lần gộp (ít viên L37 gộp, ngọc trai không gộp sang đá)`);
  ok(mergePalette(R, cat, { maxCodes: 3, lock: ['L37'] }).codes.includes('L37'), 'mergePalette: mã khoá không bị gộp đi');
  const rb = remapBig([{ id: 1, code: 'Q111' }, { id: 2, code: 'L4' }], ['Z16', 'L4'], cat);
  ok(rb[0].to === null && rb[1].to === 'L4', `remapBig: đá đỏ 8 không thành vàng 4 (${JSON.stringify(rb)})`);
  // densify: lưới lục giác 2.8 vỡ quanh 1 viên 6 mm → thêm viên, mọi cặp vẫn ≥ khe
  const ppm = 11.81, W = 400, H = 400, P = (2.8 + 0.15) * ppm, big = { x: 200, y: 200, physMm: 6 }, fill = [];
  for (let r = 0, y = 20; y < H - 20; r++, y += P * Math.sqrt(3) / 2) for (let x = 20 + (r % 2) * P / 2; x < W - 20; x += P)
    if (Math.hypot(x - big.x, y - big.y) >= (3 + 1.4 + 0.15) * ppm + P * 0.6) fill.push({ x, y, physMm: 2.8 });
  const ok0 = new Uint8Array(W * H).fill(1), dn = densify({ w: W, h: H, ppm, d: 2.8, gapMm: 0.15, fixed: [big], movable: fill, centreOk: ok0 });
  let bad = 0;
  dn.stones.forEach((a, i) => { if (Math.hypot(a.x - big.x, a.y - big.y) / ppm < 3 + 1.4 + 0.15 - 1e-3) bad++; dn.stones.slice(i + 1).forEach((b) => { if (Math.hypot(a.x - b.x, a.y - b.y) / ppm < 2.95 - 0.002) bad++; }); });
  ok(dn.added > 0 && bad === 0, `densify: +${dn.added} viên quanh viên 6 mm, ${bad} cặp chồng`);
}
console.log(fail ? `test_kit: ${fail} FAIL` : 'test_kit: OK');
process.exit(fail ? 1 : 0);
