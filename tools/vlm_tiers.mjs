// KIT-13: VLM theo cỡ, to → nhỏ (lib/kit/vlm.js TIERS). Ngân sách cứng: TỔNG phí thật ≤ $2 (--usd-cap) cộng dồn
// mọi call trong outputs/kit-vlm/calls.jsonl (cùng file với KIT-12c), log từng call + phí.
//   node tools/vlm_tiers.mjs plan [img]                                  ngân sách + số call sẽ gửi từng tầng, không gọi gì
//   node --env-file=<.env> tools/vlm_tiers.mjs big   <img> --run          tầng 1 ≥ 8 mm: 1 call cả ảnh (1536 px) → box + vật liệu + màu + cỡ
//   node --env-file=<.env> tools/vlm_tiers.mjs mid   <img> --run          tầng 2 5-7 mm: ô 3×3 (1024 px), vùng tầng 1 tô xám
//   node --env-file=<.env> tools/vlm_tiers.mjs count <img> --run          tầng 3 2.8-4 mm: crop 25 mm (768 px), hỏi SỐ HẠT theo vật liệu/màu/cỡ
//   node --env-file=<.env> tools/vlm_tiers.mjs label <img> --run          tầng 3: cùng crop, tâm DETECT đánh số, hỏi vật liệu/màu từng số
//   node tools/vlm_tiers.mjs eval <img>                                  offline: so đáp án kit.sqlite (snowman/dachshund) + đường offline DETECT
// <img> = snowman | dachshund (đáp án trong kit.sqlite) | king | queen (requirements/Trang phục *.png, không đáp án).
// Cờ: --tag <t> (lưu/đọc kết quả riêng, vd so --thinking low) · --crops 8 (số crop tầng 3) · --crop-mm 25 · --thinking low|high · --concurrency 3 · --usd-cap 2 · --only <i,j> (chỉ chạy các ô/crop đó).
// Ra: outputs/kit-vlm/tiers/<img>-<tier>-<i>.json (+ <img>-label-<i>.png ảnh đã đánh số), <img>-eval.json; cache DETECT <img>-detect.json.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { decodePng, encodePng } from '../lib/png.js';
import { detectBeads, backgroundMask } from '../lib/kit/detect.js';
import { loadGlyphs } from '../lib/kit/glyphs.js';
import { rgbToLab } from '../lib/kit/place.js';
import { readKitSvg } from '../lib/kit/svgio.js';
import { callFlash, callBudget, resizeRegion, boxPx, drawTag, TIERS, TIER_SCHEMA, bigPrompt, midPrompt, COUNT_SCHEMA, countPrompt, LABEL_SCHEMA, labelPrompt, COLORS } from '../lib/kit/vlm.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2), flag = (k) => argv.includes(`--${k}`), arg = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 && argv[i + 1] != null ? argv[i + 1] : d; };
const pos = argv.filter((a, i) => !a.startsWith('--') && !(i && argv[i - 1].startsWith('--') && argv[i - 1] !== '--run'));
const [cmd = 'plan', name = 'snowman'] = pos;
const RUN = flag('run') && cmd !== 'plan', REQ = process.env.KIT_REQ || path.join(process.cwd(), 'requirements');
const OUT = path.join(process.env.PEARL_OUT ? path.resolve(process.env.PEARL_OUT) : path.join(ROOT, 'outputs'), 'kit-vlm'), DIR = path.join(OUT, 'tiers');
const budget = callBudget(path.join(OUT, 'calls.jsonl'), Number(arg('cap', 1000)), fs, { usdCap: Number(arg('usd-cap', 2)), reserveUsd: 0.03 });
const CROPS = Number(arg('crops', 8)), CROP_MM = Number(arg('crop-mm', 25)), CONC = Number(arg('concurrency', 3)), THINK = arg('thinking', undefined);
const TAG = arg('tag', ''), T = (tier) => (TAG ? `${tier}@${TAG}` : tier);
const ONLY = arg('only', '') ? new Set(arg('only').split(',').map(Number)) : null;
const r1 = (v) => Math.round(v * 10) / 10, r3 = (v) => Math.round(v * 1000) / 1000, pc = (a, b) => (b ? Math.round((1000 * a) / b) / 10 : null);
fs.mkdirSync(DIR, { recursive: true });

// ── ảnh + đáp án
const db = new DatabaseSync(path.join(ROOT, 'kit', 'db', 'kit.sqlite'), { readOnly: true });
const prod = db.prepare('SELECT * FROM products WHERE id = ? AND compliant = 1').get(name);
const file = prod ? path.join(REQ, prod.clean_image) : path.join(REQ, { king: 'Trang phục King.png', queen: 'Trang phục Queen.png' }[name] || name);
const img = decodePng(fs.readFileSync(file)), canvasMm = prod?.canvas_mm || 300, mmPx = canvasMm / img.w, pxMm = 1 / mmPx;
const NAMES = Object.fromEntries(db.prepare("SELECT stone_code c, catalog_color_name n, series s FROM catalog").all().map((r) => [r.c, r]));
// mã thật → (vật liệu, màu) theo bảng COLORS của prompt
function codeClass(code) {
  const r = NAMES[code] || {}, n = String(r.n || '').toLowerCase();
  const color = /pearl|opaque white|^white/.test(n) ? 'white' : /clear|crystal/.test(n) ? 'clear' : /gold|amber|yellow/.test(n) ? 'gold' : /red/.test(n) ? 'red'
    : /green/.test(n) ? 'green' : /brown/.test(n) ? 'brown' : /orange|copper/.test(n) ? 'orange' : /pink/.test(n) ? 'pink' : /blue|navy|sapphire/.test(n) ? 'blue'
    : /black|jet/.test(n) ? 'black' : /silver|grey|gray/.test(n) ? 'grey' : 'other';
  return { material: r.s === 'PEARL' ? 'pearl' : 'rhinestone', color };
}
const GT = prod ? db.prepare('SELECT code, cx_px, cy_px, physical_mm FROM stones WHERE product = ?').all(name)
  .map((s) => ({ code: s.code, x: (s.cx_px * img.w) / prod.viewbox_px, y: (s.cy_px * img.h) / prod.viewbox_px, mm: s.physical_mm, ...codeClass(s.code) })) : null;
const tierOf = (mm) => Object.entries(TIERS).find(([, [a, b]]) => mm >= a - 0.6 && mm <= b + 0.6)?.[0] || (mm > 14 ? 'big' : 'small');

// ── DETECT (đường offline) một lần, cache
function detect() {
  const f = path.join(DIR, `${name}-detect.json`);
  if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8'));
  const t0 = Date.now(), r = detectBeads(img, { canvasWmm: canvasMm, accentMm: [3.2, 4.2, 5.2, 7.2, 9.2] }, backgroundMask(img).mask);
  const out = r.stones.map((s) => ({ x: Math.round(s.x * 10) / 10, y: Math.round(s.y * 10) / 10, mm: s.physMm, meas: s.dMeasMm, kind: s.kind, rgb: s.feat.rgb }));
  fs.writeFileSync(f, JSON.stringify(out));
  console.log(`DETECT ${name}: ${out.length} hạt (${Math.round((Date.now() - t0) / 1000)} s) → ${f}`);
  return out;
}

// ── gửi 1 vùng
const resF = (tier, i) => path.join(DIR, `${name}-${T(tier)}${i == null ? '' : `-${i}`}.json`);
const has = (tier, i) => fs.existsSync(resF(tier, i));
const load = (tier, i) => JSON.parse(fs.readFileSync(resF(tier, i), 'utf8'));
async function send(tier, i, rgba, area, prompt, schema, extra = {}) {
  const png = encodePng(rgba.w, rgba.h, rgba.data, {}, { compact: true, rgb: true });
  const meta = { kind: `tier-${tier}`, img: name, i, area: [area.x, area.y, area.w, area.h].map(Math.round), sentPx: [rgba.w, rgba.h], ...(THINK && { thinking: THINK }) };
  const parts = [{ inlineData: { mimeType: 'image/png', data: png.toString('base64') } }, { text: prompt }];
  const r = await budget.call(meta, () => callFlash(parts, schema, { retries: 1, thinking: THINK }));
  const o = { name, tier, i, area, sent: [rgba.w, rgba.h], model: r.model, usage: r.usage, thinking: THINK || null, data: r.data, ...extra };
  fs.writeFileSync(resF(tier, i), JSON.stringify(o, null, 1));
  return o;
}
async function pool(jobs) { // song song CONC, dừng ngay khi hết ngân sách
  const out = [];
  let k = 0, stop = null;
  await Promise.all(Array.from({ length: Math.min(CONC, jobs.length) }, async () => {
    while (k < jobs.length && !stop) {
      const j = jobs[k++];
      try { out.push(await j()); } catch (e) { if (e.budget) stop = e; console.log(`  LỖI: ${e.message}`); }
    }
  }));
  if (stop) { console.log(`DỪNG: ${stop.message}`); process.exitCode = 2; }
  return out;
}

// ── kế hoạch vùng từng tầng
const FULL = { x: 0, y: 0, w: img.w, h: img.h };
function midTiles() {
  const n = 3, side = Math.ceil(img.w / n * 1.08), step = (img.w - side) / (n - 1), t = [];
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) t.push({ x: Math.round(c * step), y: Math.round(r * step), w: side, h: Math.min(side, img.h - Math.round(r * step)) });
  return t;
}
// crop tầng 3: có đáp án → cửa sổ 25 mm phủ đá nhỏ dày (≥ 45 %) đa dạng màu + 2 cửa sổ phủ thưa (15-35 %, vùng in xen đá);
// không đáp án → cửa sổ có nhiều hạt nhỏ DETECT nhất, rải đều.
function cropPlan() {
  const f = path.join(DIR, `${name}-crops.json`);
  if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8'));
  const side = Math.round(CROP_MM * pxMm), step = Math.round(side / 2), cands = [];
  const pts = GT ? GT.filter((s) => s.mm <= 4.5) : detect().filter((s) => s.mm <= 4.5);
  for (let y = 0; y + side <= img.h; y += step) for (let x = 0; x + side <= img.w; x += step) {
    const inn = pts.filter((s) => s.x >= x && s.y >= y && s.x < x + side && s.y < y + side);
    if (inn.length < 5) continue;
    const cov = inn.reduce((a, s) => a + Math.PI * (s.mm / 2) ** 2, 0) / CROP_MM ** 2, h = {};
    for (const s of inn) { const c = s.color || 'x'; h[c] = (h[c] || 0) + 1; }
    cands.push({ x, y, w: side, h: side, n: inn.length, cov: r3(cov), top: Object.keys(h).sort((a, b) => h[b] - h[a])[0], colors: h });
  }
  const far = (a, list) => list.every((b) => Math.abs(a.x - b.x) >= side || Math.abs(a.y - b.y) >= side), pick = [];
  if (GT) {
    const dense = cands.filter((c) => c.cov >= 0.45).sort((a, b) => b.cov - a.cov), seen = new Set();
    for (const c of dense) if (pick.length < CROPS - 2 && !seen.has(c.top) && far(c, pick)) { pick.push({ ...c, why: 'dense' }); seen.add(c.top); }
    for (const c of dense) if (pick.length < CROPS - 2 && far(c, pick)) pick.push({ ...c, why: 'dense' });
    for (const c of cands.filter((q) => q.cov >= 0.15 && q.cov <= 0.35).sort((a, b) => b.n - a.n)) if (pick.length < CROPS && far(c, pick)) pick.push({ ...c, why: 'partial' });
  } else for (const c of cands.sort((a, b) => b.n - a.n)) if (pick.length < CROPS && far(c, pick)) pick.push({ ...c, why: 'detect' });
  fs.writeFileSync(f, JSON.stringify(pick, null, 1));
  return pick;
}
const inArea = (s, a) => s.x >= a.x && s.y >= a.y && s.x < a.x + a.w && s.y < a.y + a.h;

// ── chạy tầng
async function runBig() {
  if (!RUN) return console.log(`big ${name}: 1 call, cả ảnh ${img.w}px → 1536 px`);
  const o = await send('big', null, resizeRegion(img, FULL, 1536), FULL, bigPrompt(canvasMm, (img.h * canvasMm) / img.w), TIER_SCHEMA);
  console.log(`big ${name}: ${o.data.stones.length} viên · token ${o.usage.in}/${o.usage.out}`);
}
function bigBoxes() { return has('big') ? (() => { const o = load('big'); return o.data.stones.map((s) => boxPx(s.box_2d, o.area)).filter(Boolean); })() : []; }
async function runMid() {
  const tiles = midTiles(), boxes = bigBoxes();
  if (!boxes.length) console.log('(chưa có tầng 1: không tô xám)');
  const grey = { w: img.w, h: img.h, data: Uint8Array.from(img.data) };
  for (const b of boxes) { // tô xám elip nội tiếp box tầng 1 (nới 10 %)
    const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2, ax = 0.55 * (b.x1 - b.x0), ay = 0.55 * (b.y1 - b.y0);
    for (let y = Math.max(0, Math.floor(cy - ay)); y < Math.min(img.h, cy + ay); y++) for (let x = Math.max(0, Math.floor(cx - ax)); x < Math.min(img.w, cx + ax); x++)
      if (((x - cx) / ax) ** 2 + ((y - cy) / ay) ** 2 <= 1) grey.data.set([128, 128, 128, 255], (y * img.w + x) * 4);
  }
  const todo = tiles.map((t, i) => ({ t, i })).filter(({ i }) => (!ONLY || ONLY.has(i)) && !has('mid', i));
  if (!RUN) return console.log(`mid ${name}: ${todo.length}/${tiles.length} ô còn gọi (ô ${r1(tiles[0].w * mmPx)} mm → 1024 px)`);
  const res = await pool(todo.map(({ t, i }) => () => send('mid', i, resizeRegion(grey, t, 1024), t, midPrompt(t.w * mmPx, t.h * mmPx), TIER_SCHEMA, { greyed: boxes.length })));
  for (const o of res) console.log(`mid ${name} ô ${o.i}: ${o.data.stones.length} viên · token ${o.usage.in}/${o.usage.out}`);
}
async function runCount() {
  const crops = cropPlan(), todo = crops.map((c, i) => ({ c, i })).filter(({ i }) => (!ONLY || ONLY.has(i)) && !has('count', i));
  if (!RUN) return console.log(`count ${name}: ${todo.length}/${crops.length} crop còn gọi (${CROP_MM} mm → 768 px)`);
  const res = await pool(todo.map(({ c, i }) => () => send('count', i, resizeRegion(img, c, 768), c, countPrompt(CROP_MM, CROP_MM), COUNT_SCHEMA, { crop: c })));
  for (const o of res) console.log(`count ${name} crop ${o.i}: tổng ${o.data.total} · ${o.data.groups.map((g) => `${g.material}/${g.color}/${g.size}:${g.count}`).join(' ')} · token ${o.usage.in}/${o.usage.out}`);
}
function labelImage(c) { // crop 768 px + tag số trên tâm DETECT (hạt ≤ 4.5 mm), tối đa 90
  const k = 768 / c.w, pts = detect().filter((s) => s.mm <= 4.5 && inArea(s, c)).slice(0, 90), G = loadGlyphs();
  const im = resizeRegion(img, c, 768), font = Math.max(14, Math.min(22, Math.round(1.1 * pxMm * k * 0.55)));
  pts.forEach((s, j) => drawTag(im, (s.x - c.x) * k, (s.y - c.y) * k, j + 1, font, G));
  return { im, pts };
}
async function runLabel() {
  const crops = cropPlan(), todo = crops.map((c, i) => ({ c, i })).filter(({ i }) => (!ONLY || ONLY.has(i)) && !has('label', i));
  for (const { c, i } of todo) { const { im } = labelImage(c); fs.writeFileSync(path.join(DIR, `${name}-${T('label')}-${i}.png`), encodePng(im.w, im.h, im.data, {}, { compact: true, rgb: true })); }
  if (!RUN) return console.log(`label ${name}: ${todo.length}/${crops.length} crop còn gọi; ảnh đánh số ở ${DIR}/${name}-label-<i>.png`);
  const res = await pool(todo.map(({ c, i }) => () => { const { im, pts } = labelImage(c); return send('label', i, im, c, labelPrompt(pts.length, CROP_MM), LABEL_SCHEMA, { crop: c, pts }); }));
  for (const o of res) console.log(`label ${name} crop ${o.i}: ${o.data.items.length}/${o.pts.length} số · token ${o.usage.in}/${o.usage.out}`);
}

// ── chấm offline
function match(pred, gt, tol = 0.6) { // 1-1 tham lam, lệch < tol·d_thật
  const pairs = [];
  pred.forEach((p, i) => gt.forEach((g, j) => { const d = Math.hypot(p.x - g.x, p.y - g.y); if (d < tol * g.mm * pxMm) pairs.push([d, i, j]); }));
  pairs.sort((a, b) => a[0] - b[0]);
  const pi = new Map(), gj = new Set();
  for (const [, i, j] of pairs) if (!pi.has(i) && !gj.has(j)) { pi.set(i, j); gj.add(j); }
  return pi;
}
const SIZES = [2.8, 4, 5, 6, 7, 8, 10, 12, 14], snapMm = (mm) => SIZES.reduce((a, b) => (Math.abs(b - mm) < Math.abs(a - mm) ? b : a));
function scoreTier(tier, pred, claimAll = true) { // pred: VLM = mọi mục máy báo (prompt đã giới hạn cỡ) | offline = hạt có cỡ thuộc tầng
  const inTier = (s) => tierOf(s.mm) === tier, P = claimAll ? pred : pred.filter(inTier), m = match(P, GT), gtT = GT.filter(inTier);
  const pairs = [...m].map(([i, j]) => [P[i], GT[j]]), hit = pairs.filter(([, g]) => inTier(g));
  return { gt: gtT.length, pred: P.length, matched: hit.length, recall: pc(hit.length, gtT.length), precision: pc(hit.length, P.length),
    onOtherTier: pairs.length - hit.length, onNothing: P.length - pairs.length,
    sizeOk: pc(hit.filter(([p, g]) => snapMm(p.mm) === g.mm).length, hit.length), sizeMae: hit.length ? r1(hit.reduce((a, [p, g]) => a + Math.abs(p.mm - g.mm), 0) / hit.length) : null,
    ...(P[0]?.material ? { pearlOk: pc(hit.filter(([p, g]) => (p.material === 'pearl') === (g.material === 'pearl')).length, hit.length), colorOk: pc(hit.filter(([p, g]) => p.color === g.color).length, hit.length) } : {}) };
}
const vlmItems = (o) => o.data.stones.map((s) => { const b = boxPx(s.box_2d, o.area); return b && { x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2, box: Math.min(b.x1 - b.x0, b.y1 - b.y0) * mmPx, mm: s.diameter_mm, material: s.material, color: s.color }; }).filter(Boolean);
function dedupe(list) { const out = []; for (const p of list) if (!out.some((q) => Math.hypot(p.x - q.x, p.y - q.y) < 0.5 * Math.max(p.mm, q.mm) * pxMm)) out.push(p); return out; }
// màu ảnh → COLORS: mã gần nhất (ΔE76) trong BOM thật cùng tầng của sản phẩm → lớp màu của mã đó (cận trên của đường offline: biết BOM)
function offlineColor(rgb, mm) {
  const lab = rgbToLab(...rgb), codes = [...new Set(GT.filter((s) => tierOf(s.mm) === tierOf(mm)).map((s) => s.code))];
  let best = null;
  for (const c of codes) { const h = db.prepare('SELECT color_hex_reference h FROM catalog WHERE stone_code = ?').get(c)?.h; if (!h) continue; const q = rgbToLab(...[1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))), d = Math.hypot(lab[0] - q[0], lab[1] - q[1], lab[2] - q[2]); if (!best || d < best.d) best = { c, d }; }
  return best ? codeClass(best.c) : { material: 'rhinestone', color: 'other' };
}
function evaluate() {
  const det = detect(), ev = { name, canvasMm, gt: GT ? Object.fromEntries(Object.keys(TIERS).map((t) => [t, GT.filter((s) => tierOf(s.mm) === t).length])) : null, tiers: {}, cost: {} };
  const usage = (tier) => fs.readdirSync(DIR).filter((f) => new RegExp(`^${name}-${T(tier).replace('@', '\\@')}(-\\d+)?\\.json$`).test(f)).map((f) => JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'))).filter((o) => o.usage);
  for (const t of ['big', 'mid', 'count', 'label']) { const u = usage(t); if (u.length) ev.cost[t] = { calls: u.length, usd: r3(u.reduce((a, o) => a + (o.usage.in * 0.5 + o.usage.out * 3) / 1e6, 0)), outTokens: Math.round(u.reduce((a, o) => a + o.usage.out, 0) / u.length) }; }
  const offline = det.map((s) => ({ ...s, ...offlineColorSafe(s) }));
  function offlineColorSafe(s) { return GT ? offlineColor(s.rgb, s.mm) : {}; }
  // tầng 1
  if (has('big')) {
    const v = vlmItems(load('big'));
    ev.tiers.big = { vlm: GT ? scoreTier('big', v) : { n: v.length }, vlmBoxSize: GT ? scoreTier('big', v.map((p) => ({ ...p, mm: p.box }))) : null };
  }
  if (GT) ev.tiers.big = { ...ev.tiers.big, offline: scoreTier('big', offline, false) };
  // tầng 2: gộp các ô, bỏ trùng vùng chồng
  const mids = midTiles().map((_, i) => has('mid', i) && load('mid', i)).filter(Boolean);
  if (mids.length) {
    const v = dedupe(mids.flatMap(vlmItems)), cover = mids.map((o) => o.area);
    const sub = (list) => list.filter((s) => cover.some((a) => inArea(s, a)));
    ev.tiers.mid = { tiles: mids.length, vlm: GT ? scoreTierSub('mid', v, sub) : { n: v.length }, vlmBoxSize: GT ? scoreTierSub('mid', v.map((p) => ({ ...p, mm: p.box })), sub) : null, offline: GT ? scoreTierSub('mid', offline, sub, false) : null };
  } else if (GT) ev.tiers.mid = { offline: scoreTier('mid', offline, false) };
  function scoreTierSub(tier, pred, sub, claimAll = true) { return scoreTier(tier, sub(pred), claimAll); }
  // tầng 1+2 gộp: VLM thấy hạt TRANH (to hơn đá kit ~1.4×) → cỡ kit = snap(f × cỡ VLM); f khớp trên chính sản phẩm (in-sample) + f = --kit-f
  if (GT && (has('big') || mids.length)) {
    const u = dedupe([...(has('big') ? vlmItems(load('big')) : []), ...mids.flatMap(vlmItems)]), m = match(u, GT), pairs = [...m].map(([i, j]) => [u[i], GT[j]]);
    const acc = (f) => pc(pairs.filter(([p, g]) => snapMm(f * p.mm) === g.mm).length, pairs.length);
    let best = { f: 1, acc: acc(1) };
    for (let f = 0.5; f <= 1.0001; f += 0.01) { const a = acc(f); if (a > best.acc) best = { f: r3(f), acc: a }; }
    const rec = (lo, hi) => { const g = GT.filter((s) => s.mm >= lo && s.mm <= hi), hit = pairs.filter(([, q]) => q.mm >= lo && q.mm <= hi).length; return { gt: g.length, hit, recall: pc(hit, g.length) }; };
    const by = {};
    for (const [p, g] of pairs) { const k = `${g.mm}`; (by[k] ||= []).push(snapMm(best.f * p.mm)); }
    ev.tiers.bigMid = { items: u.length, matched: pairs.length, onNothing: u.length - pairs.length, recallGe8: rec(8, 14), recall5to7: rec(5, 7), recall4: rec(4, 4), recall28: rec(2.8, 2.8),
      sizeOkRaw: acc(1), sizeFit: best, ...(arg('kit-f') && { sizeAtKitF: { f: Number(arg('kit-f')), acc: acc(Number(arg('kit-f'))) } }),
      kitSizeByGt: Object.fromEntries(Object.entries(by).map(([k, v]) => { const h = {}; for (const x of v) h[x] = (h[x] || 0) + 1; return [k, h]; })),
      pearlOk: pc(pairs.filter(([p, g]) => (p.material === 'pearl') === (g.material === 'pearl')).length, pairs.length), colorOk: pc(pairs.filter(([p, g]) => p.color === g.color).length, pairs.length) };
  }
  // tầng 3: đếm
  const crops = cropPlan(), rows = [];
  crops.forEach((c, i) => {
    if (!has('count', i)) return;
    const o = load('count', i), gtIn = GT ? GT.filter((s) => s.mm <= 4.5 && inArea(s, c)) : null, offIn = det.filter((s) => s.mm <= 4.5 && inArea(s, c));
    const vSmall = o.data.groups.filter((g) => g.size !== '5+'), vTot = vSmall.reduce((a, g) => a + g.count, 0);
    const hist = (list, key) => { const h = {}; for (const x of list) { const k = key(x); h[k] = (h[k] || 0) + (x.count ?? 1); } return h; };
    const row = { i, why: c.why, cov: c.cov, gt: gtIn?.length ?? null, vlm: vTot, vlmTotalField: o.data.total, offline: offIn.length,
      vlmBy: hist(vSmall, (g) => `${g.color}/${g.size}`), gtBy: gtIn && hist(gtIn, (s) => `${s.color}/${s.mm === 4 ? '4' : '2.8'}`) };
    if (gtIn) {
      const l1 = (h) => Object.keys({ ...h, ...row.gtBy }).reduce((a, k) => a + Math.abs((h[k] || 0) - (row.gtBy[k] || 0)), 0);
      Object.assign(row, { vlmErr: pc(vTot - gtIn.length, gtIn.length), offErr: pc(offIn.length - gtIn.length, gtIn.length),
        vlmMixErr: pc(l1(row.vlmBy) / 2, gtIn.length), offMixErr: pc(l1(hist(offIn.map((s) => ({ ...s, ...offlineColor(s.rgb, s.mm) })), (s) => `${s.color}/${s.mm === 4 ? '4' : '2.8'}`)) / 2, gtIn.length) });
    }
    rows.push(row);
  });
  if (rows.length) {
    const avg = (k, f = () => true) => { const r = rows.filter((x) => x[k] != null && f(x)); return r.length ? r1(r.reduce((a, x) => a + Math.abs(x[k]), 0) / r.length) : null; };
    ev.tiers.count = { crops: rows.length, meanAbsErrPct: { vlm: avg('vlmErr'), offline: avg('offErr'), vlmDense: avg('vlmErr', (x) => x.why === 'dense'), offlineDense: avg('offErr', (x) => x.why === 'dense') },
      mixErrPct: { vlm: avg('vlmMixErr'), offline: avg('offMixErr') }, rows };
  }
  // tầng 3: gán vật liệu/màu cho số
  const lrows = [], conf = { vlm: {}, offline: {} };
  crops.forEach((c, i) => {
    if (!has('label', i)) return;
    const o = load('label', i), byN = new Map(o.data.items.map((x) => [x.n, x])), pts = o.pts;
    const row = { i, why: c.why, tags: pts.length, answered: byN.size, none: o.data.items.filter((x) => x.material === 'none').length };
    if (GT) {
      const gtIn = GT.filter((s) => inArea(s, { x: c.x - 40, y: c.y - 40, w: c.w + 80, h: c.h + 80 })), m = match(pts, gtIn, 0.5);
      let vOk = 0, oOk = 0, vNoneOnStone = 0, vNoneOnPrint = 0, onPrint = 0;
      pts.forEach((p, j) => {
        const v = byN.get(j + 1);
        if (!m.has(j)) { onPrint++; if (v?.material === 'none') vNoneOnPrint++; return; }
        const g = gtIn[m.get(j)];
        if (v?.material === 'none') vNoneOnStone++;
        if (v && v.color === g.color) vOk++;
        const oc = offlineColor(p.rgb, p.mm).color;
        if (oc === g.color) oOk++;
        const kv = `${g.color}→${v?.material === 'none' ? 'none' : v?.color}`, ko = `${g.color}→${oc}`;
        conf.vlm[kv] = (conf.vlm[kv] || 0) + 1; conf.offline[ko] = (conf.offline[ko] || 0) + 1;
      });
      Object.assign(row, { onStone: m.size, vlmColorOk: pc(vOk, m.size), offlineColorOk: pc(oOk, m.size), vlmNoneOnStone: vNoneOnStone, onPrint, vlmNoneOnPrint: vNoneOnPrint });
    }
    lrows.push(row);
  });
  if (lrows.length) {
    const sum = (k) => lrows.reduce((a, x) => a + (x[k] || 0), 0);
    ev.tiers.label = { crops: lrows.length, tags: sum('tags'), answered: sum('answered'), ...(GT && {
      onStone: sum('onStone'), vlmColorOk: pc(lrows.reduce((a, x) => a + (x.vlmColorOk || 0) * x.onStone / 100, 0), sum('onStone')),
      offlineColorOk: pc(lrows.reduce((a, x) => a + (x.offlineColorOk || 0) * x.onStone / 100, 0), sum('onStone')), onPrint: sum('onPrint'), vlmNoneOnPrint: sum('vlmNoneOnPrint'), vlmNoneOnStone: sum('vlmNoneOnStone'), confusion: Object.fromEntries(Object.entries(conf).map(([k, h]) => [k, Object.fromEntries(Object.entries(h).filter(([q]) => q.split('→')[0] !== q.split('→')[1]).sort((a, b) => b[1] - a[1]).slice(0, 8))])) }), rows: lrows };
  }
  // không đáp án (King/Queen): đối chiếu bản đồ hiện có (--map, mặc định ./outputs/kit/<img>_costume_full/starry_v2.svg)
  const mapF = arg('map', path.join(process.cwd(), 'outputs', 'kit', `${name}_costume_full`, 'starry_v2.svg'));
  if (!GT && fs.existsSync(mapF)) {
    const doc = readKitSvg(fs.readFileSync(mapF, 'utf8')), S = doc.canvas.widthPx / img.w;
    const ms = doc.stones.map((q) => ({ x: q.x / S, y: q.y / S, mm: Number(/_S([\d.]+)$/.exec(q.group || '')?.[1]) || q.dMm + 0.8, ...codeClass(q.code) }));
    const inside = (p) => ms.filter((q) => Math.hypot(q.x - p.x, q.y - p.y) < (p.box / 2) * pxMm);
    const chk = (items) => { const r = items.map((p) => { const q = inside(p); return { n: q.length, sameSize: q.some((z) => Math.abs(z.mm - snapMm(0.68 * p.mm)) < 1.1) }; });
      return { items: items.length, fragmented: r.filter((x) => x.n >= 2).length, empty: r.filter((x) => !x.n).length, mapStonesInside: r.reduce((a, x) => a + x.n, 0), hasKitSizeStone: r.filter((x) => x.sameSize).length }; };
    ev.map = { file: mapF, stones: ms.length, ...(has('big') && { big: chk(vlmItems(load('big'))) }), ...(mids.length && { mid: chk(dedupe(mids.flatMap(vlmItems))) }) };
    const ag = { n: 0, same: 0, none: 0 };
    crops.forEach((c, i) => { if (!has('label', i)) return; const o = load('label', i), byN = new Map(o.data.items.map((x) => [x.n, x]));
      o.pts.forEach((p, j) => { const q = ms.filter((z) => Math.hypot(z.x - p.x, z.y - p.y) < 0.5 * z.mm * pxMm)[0], v = byN.get(j + 1); if (!q || !v) return; ag.n++; if (v.material === 'none') ag.none++; else if (v.color === q.color) ag.same++; }); });
    if (ag.n) ev.map.labelVsMapColor = { tagsOnMapStone: ag.n, sameColor: pc(ag.same, ag.n), vlmNone: ag.none };
  }
  const f = path.join(DIR, `${name}-eval${TAG ? `@${TAG}` : ''}.json`);
  fs.writeFileSync(f, JSON.stringify(ev, null, 1));
  const { rows: _r, ...cnt } = ev.tiers.count || {}, { rows: _l, ...lab } = ev.tiers.label || {};
  console.log(JSON.stringify({ ...ev, tiers: { ...ev.tiers, count: cnt, label: lab } }, null, 1));
  console.log(`→ ${f}`);
}

// ── lệnh
if (cmd === 'plan') {
  const lines = budget.lines(), done = lines.filter((l) => l.state === 'done');
  console.log(`Ngân sách: ${done.length} call xong, ${lines.filter((l) => l.state === 'error').length} lỗi, phí thật $${r3(budget.spent())} / trần $${budget.usdCap}`);
  const tiers = {};
  for (const l of done) { const k = `${l.kind} ${l.img}`; (tiers[k] ||= { n: 0, usd: 0 }); tiers[k].n++; tiers[k].usd += (l.usage.in * 0.5 + l.usage.out * 3) / 1e6; }
  for (const [k, v] of Object.entries(tiers)) console.log(`  ${k.padEnd(22)} ${String(v.n).padStart(3)} call $${r3(v.usd)}`);
  if (pos[1]) { await runBig(); await runMid(); await runCount(); await runLabel(); }
} else if (cmd === 'big') await runBig();
else if (cmd === 'mid') await runMid();
else if (cmd === 'count') await runCount();
else if (cmd === 'label') await runLabel();
else if (cmd === 'eval') evaluate();
else { console.error(`lệnh lạ: ${cmd}`); process.exit(1); }
console.log(`ngân sách: $${r3(budget.spent())} / $${budget.usdCap}`);
