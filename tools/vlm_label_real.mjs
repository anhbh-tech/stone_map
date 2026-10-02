// KIT-10: nhãn vùng đá bằng VLM (lib/kit/vlm.js) trên 2 sản phẩm thật, so với vùng có đá suy từ SVG thật (bảng stones, kit/db/kit.sqlite).
//   node tools/vlm_label_real.mjs                        kế hoạch: số call + ước phí, KHÔNG gọi mạng; đã có outputs/kit-vlm/<name>.json thì so luôn
//   node --env-file=.env tools/vlm_label_real.mjs --run  gọi Gemini Flash thật (cần GEMINI_API_KEY; ANALYZE_MODEL tuỳ chọn)
//   PEARL_MOCK=1 node tools/vlm_label_real.mjs           chạy hết luồng bằng nhãn giả (mockLabel), ra <name>.mock.json, 0 phí
// Cờ: --only snowman|dachshund · --tile-mm 40 · --overlap 0.1 · --max-calls 200 · --concurrency 4 · --image <png> --name <tên> (ảnh bất kỳ, không so)
// Env: KIT_REQ (thư mục requirements, mặc định ./requirements, chỉ đọc) · PEARL_OUT (thư mục outputs) · VLM_PRICE_IN/OUT (USD/1M token).
// Ra: outputs/kit-vlm/<name>.json (pearl-kit-vlm/1, regionMask dùng cho params.regionMask / nút "Mask VLM…" ở /kit.html),
//     <name>.mask.png cỡ ảnh (tools/map_starry.mjs --mask)
//     + <name>.compare.json; cache từng ô ở outputs/kit-vlm/cache/ (chạy lại không trả phí lại ô đã xong).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { decodePng, encodePng } from '../lib/png.js';
import { VLM, TILE_SCHEMA, regionToMask, tilePlan, tilePng, tileKey, labelTiles, mergeTiles, buildDoc, callFlash, mockLabel, estimateCost, decodeRegion, gtMask, scoreMask, centerRecall, rules } from '../lib/kit/vlm.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2), flag = (k) => argv.includes(`--${k}`), arg = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 && argv[i + 1] != null ? argv[i + 1] : d; };
const MOCK = !!process.env.PEARL_MOCK, RUN = flag('run') || MOCK;
const REQ = process.env.KIT_REQ || path.join(process.cwd(), 'requirements');
const OUT = path.join(process.env.PEARL_OUT ? path.resolve(process.env.PEARL_OUT) : path.join(ROOT, 'outputs'), 'kit-vlm');
const opts = { tileMm: Number(arg('tile-mm', VLM.tileMm)), overlap: Number(arg('overlap', VLM.overlap)) };
const maxCalls = Number(arg('max-calls', 200)), concurrency = Number(arg('concurrency', VLM.concurrency));
const model = MOCK ? 'mock' : process.env.ANALYZE_MODEL || VLM.model;
const suffix = MOCK ? '.mock' : '';
const pct = (v) => `${(100 * v).toFixed(1)}%`;
const rel = (f) => (f.startsWith(ROOT + path.sep) ? path.relative(ROOT, f) : f);

// đích: 2 sản phẩm thật trong DB, hoặc 1 ảnh tự chọn
let targets;
if (arg('image')) targets = [{ name: arg('name', path.basename(arg('image')).replace(/\.[^.]+$/, '')), file: path.resolve(arg('image')) }];
else {
  const db = new DatabaseSync(path.join(ROOT, 'kit', 'db', 'kit.sqlite'), { readOnly: true });
  const only = arg('only');
  targets = db.prepare("SELECT id, clean_image, viewbox_px, px_per_mm FROM products WHERE compliant = 1 ORDER BY id DESC").all()
    .filter((p) => !only || p.id === only)
    .map((p) => ({ name: p.id, file: path.join(REQ, p.clean_image), viewbox: p.viewbox_px, pxPerMm: p.px_per_mm,
      stones: db.prepare('SELECT cx_px x, cy_px y, physical_mm dMm, catalog_series series FROM stones WHERE product = ?').all(p.id) }));
  db.close();
}
if (!targets.length) { console.error('Không có ảnh nào để chạy'); process.exit(1); }

const cacheDir = path.join(OUT, 'cache');
const cache = MOCK ? null : {
  get: (k) => { try { return JSON.parse(fs.readFileSync(path.join(cacheDir, `${k}.json`), 'utf8')); } catch { return null; } },
  set: (k, v) => { fs.mkdirSync(cacheDir, { recursive: true }); fs.writeFileSync(path.join(cacheDir, `${k}.json`), JSON.stringify(v)); },
};

// 1) kế hoạch + ước phí cho mọi đích trước khi gọi gì
for (const t of targets) {
  if (!fs.existsSync(t.file)) { console.error(`Thiếu ảnh ${t.file} (KIT_REQ=${REQ})`); process.exit(1); }
  t.buf = fs.readFileSync(t.file);
  t.img = decodePng(t.buf);
  t.opts = { ...opts, pxPerMm: t.pxPerMm || VLM.pxPerMm };
  t.plan = tilePlan(t.img, t.opts);
  const live = t.plan.tiles.filter((x) => !x.skip);
  t.cached = cache ? live.filter((x) => cache.get(tileKey(model, tilePng(t.img, x).png))).length : 0;
  t.calls = MOCK ? 0 : live.length - t.cached;
  console.log(`${t.name}: ${t.img.w}×${t.img.h}px, ô ${t.opts.tileMm}mm = ${t.plan.tilePx}px bước ${t.plan.stridePx}px → ${t.plan.tiles.length} ô, bỏ ${t.plan.tiles.length - live.length} ô trống, ${live.length} ô cần nhãn (${t.cached} đã cache) → ${t.calls} call`);
}
const total = targets.reduce((a, t) => a + t.calls, 0), est = estimateCost(total);
console.log(`Tổng ${total} call ${model} · ước ~$${est.usd} (${est.tokensIn} token vào × $${est.inPerM}/M + ${est.tokensOut} token ra × $${est.outPerM}/M, ước tính thô)`);

if (RUN && total > maxCalls) { console.error(`Dừng: ${total} call > --max-calls ${maxCalls}`); process.exit(1); }
if (RUN && !MOCK && !process.env.GEMINI_API_KEY) { console.error('Thiếu GEMINI_API_KEY: chạy bằng node --env-file=.env tools/vlm_label_real.mjs --run'); process.exit(1); }
if (!RUN) console.log('Chưa gọi gì. Gọi thật: node --env-file=.env tools/vlm_label_real.mjs --run   (thử offline: PEARL_MOCK=1 node tools/vlm_label_real.mjs)');

// 2) gọi + ghép + lưu; 3) so với đáp án
fs.mkdirSync(OUT, { recursive: true });
for (const t of targets) {
  const file = path.join(OUT, `${t.name}${suffix}.json`);
  let doc;
  if (RUN) {
    let n = 0;
    const call = MOCK ? async (parts, tile) => ({ model: 'mock', data: mockLabel(t.img, tile), usage: { in: 0, out: 0 } }) : (parts) => callFlash(parts, TILE_SCHEMA);
    const tiles = await labelTiles(t.img, t.plan, { call, model, cache, concurrency,
      onTile: (tile, r) => { n++; if (r.error) console.log(`  ô ${tile.i}: LỖI ${r.error}`); else if (!MOCK && process.stdout.isTTY) process.stdout.write(`\r  ${t.name}: ${n} ô`); } });
    if (!MOCK && process.stdout.isTTY) process.stdout.write('\n');
    const merged = mergeTiles(t.img, tiles);
    doc = buildDoc(t.img, { name: t.name, sha1: crypto.createHash('sha1').update(t.buf).digest('hex'), plan: t.plan, tiles, merged, opts: t.opts, model });
    fs.writeFileSync(file, JSON.stringify(doc));
    // cùng mặt nạ cỡ ảnh dạng PNG (trắng đục = dán đá) cho tools/map_starry.mjs --mask
    const full = regionToMask(doc.regionMask, t.img.w, t.img.h), rgba = new Uint8Array(full.length * 4);
    for (let j = 0; j < full.length; j++) if (full[j]) rgba.fill(255, j * 4, j * 4 + 4);
    fs.writeFileSync(file.replace(/\.json$/, '.mask.png'), encodePng(t.img.w, t.img.h, rgba, {}, { compact: true }));
    const s = doc.stats;
    console.log(`${t.name}: ${s.labelled}/${s.tiles - s.skipped} ô có nhãn, ${s.errors} lỗi, ${s.calls} call mới (${s.cached} cache), token ${s.usage.in}/${s.usage.out} ≈ $${s.costUsd} → ${rel(file)}`);
  } else if (fs.existsSync(file)) doc = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!doc || !t.stones) continue;

  const k = t.img.w / (t.viewbox || t.img.w), stones = t.stones.map((s) => ({ ...s, x: s.x * k, y: s.y * k }));
  const gt = gtMask(stones, t.img.w, t.img.h, { pxPerMm: t.pxPerMm });
  const pred = decodeRegion(doc.regionMask);
  if (pred.w !== gt.grid.w || pred.h !== gt.grid.h) { console.log(`${t.name}: lưới mask ${pred.w}×${pred.h} ≠ đáp án ${gt.grid.w}×${gt.grid.h}, bỏ qua so`); continue; }
  const frac = (m) => m.reduce((a, b) => a + b, 0) / m.length;
  const cmp = {
    name: t.name, model: doc.model, maskPct: frac(pred.bits), gtDiscPct: frac(gt.disc), gtClosedPct: frac(gt.closed),
    closed: scoreMask(pred.bits, gt.closed), disc: scoreMask(pred.bits, gt.disc), centers: centerRecall(pred.bits, gt.grid, stones), rules: rules(doc, gt, stones),
  };
  fs.writeFileSync(path.join(OUT, `${t.name}${suffix}.compare.json`), JSON.stringify(cmp, null, 1));
  console.log(`\n${t.name} (${doc.model}): mask VLM ${pct(cmp.maskPct)} ảnh · đáp án: đĩa đá ${pct(cmp.gtDiscPct)}, vùng đóng 1.5mm ${pct(cmp.gtClosedPct)}`);
  console.log(`  vs vùng đóng: IoU ${cmp.closed.iou} precision ${cmp.closed.precision} recall ${cmp.closed.recall} · vs đĩa: precision ${cmp.disc.precision} recall ${cmp.disc.recall}`);
  console.log(`  tâm viên thật trong mask: ${pct(cmp.centers.all)} (${Object.entries(cmp.centers.bySeries).map(([s, v]) => `${s} ${pct(v.recall)}/${v.n}`).join(', ')})`);
  console.log('  vùng VLM → % diện tích có đá thật:');
  for (const r of cmp.rules.table.filter((x) => !x.key.startsWith('material+family:') || x.areaMm2 >= 200)) {
    const ser = Object.entries(r.series).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([s, n]) => `${s} ${n}`).join(', ');
    console.log(`    ${r.key.padEnd(30)} ${String(r.regions).padStart(4)} vùng ${String(r.areaMm2).padStart(6)} mm²  ${pct(r.stoneFrac).padStart(6)}  ${r.verdict.padEnd(6)} ${ser}`);
  }
  const d = cmp.rules.derived;
  console.log(`  luật rút ra (trong mẫu): nhãn stone → IoU ${d.byLabel.iou} · vật liệu {${d.byMaterial.materials.join(', ')}} → IoU ${d.byMaterial.iou} (P ${d.byMaterial.precision} R ${d.byMaterial.recall})`
    + ` · vật liệu/màu {${d.byMaterialFamily.combos.join(', ')}} → IoU ${d.byMaterialFamily.iou} (P ${d.byMaterialFamily.precision} R ${d.byMaterialFamily.recall})`);
}
