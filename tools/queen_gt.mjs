// KIT-15: bộ đáp án TAY cho Queen (không có SVG thật) để đo hạt nhỏ, 3 ô 25×25 mm khó. Ngân sách chung outputs/kit-vlm/calls.jsonl.
//   node tools/queen_gt.mjs prep                                    upscale 3543 px + DETECT tầng (KIT-12a) + ảnh ô có tag số, không gọi gì
//   node --env-file=<.env> tools/queen_gt.mjs vlm --thinking low|medium --run    1 call / ô: gán từng tag + thêm hạt thiếu
//   node --env-file=<.env> tools/queen_gt.mjs miss --thinking medium --run   4 call / ô (góc 12.5 mm): hạt đã có đánh chấm, hỏi hạt còn thiếu (sau 1 lần build)
//   node tools/queen_gt.mjs build                                   offline: ghép → outputs/kit/queen_gt/<ô>.json + <ô>-gt.png, chấm DETECT
// Đáp án nháp = kết quả thinking medium; khác low (bead?/vật liệu/cỡ) hoặc hạt thiếu chỉ một bên thấy → review: true (CAPTAIN duyệt/sửa).
// Sửa tay: đổi trường trong <ô>.json (physMm/material/color/shape, hoặc xoá mục / thêm {x, y, ...}), đặt "checked": true; chạy lại `build` để chấm
// (build không ghi đè ô đã checked).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePng, encodePng } from '../lib/png.js';
import { detectBeads, backgroundMask } from '../lib/kit/detect.js';
import { upscale } from '../lib/kit/select.js';
import { loadGlyphs } from '../lib/kit/glyphs.js';
import { callFlash, callBudget, resizeRegion, boxPx, drawTag, gtPrompt, GT_SCHEMA, missPrompt, MISS_SCHEMA, mat4 } from '../lib/kit/vlm.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2), flag = (k) => argv.includes(`--${k}`), arg = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 && argv[i + 1] != null ? argv[i + 1] : d; };
const cmd = argv[0] || 'build', RUN = flag('run'), THINK = arg('thinking', 'low');
const REQ = process.env.KIT_REQ || path.join(process.cwd(), 'requirements');
const OUTS = process.env.PEARL_OUT ? path.resolve(process.env.PEARL_OUT) : path.join(ROOT, 'outputs'), DIR = path.join(OUTS, 'kit', 'queen_gt');
const budget = callBudget(path.join(OUTS, 'kit-vlm', 'calls.jsonl'), 1000, fs, { usdCap: Number(arg('usd-cap', 2)), reserveUsd: 0.04 });
const W = 3543, PPM = 11.81, SIDE = Math.round(25 * PPM), SEND = 1024, K = SEND / SIDE;
// tâm ô theo toạ độ 0-1000 của ảnh Queen (box của KIT-12c queen-full / queen-stones)
const TILES = [
  { id: 'heart', cy: 615, cx: 476, what: 'collar heart ruby + marquise wings' },
  { id: 'pearls', cy: 560, cx: 330, what: 'pearl collar (ermine capelet)' },
  { id: 'cape', cy: 800, cx: 180, what: 'red cape with gold scrollwork' },
].map((t) => ({ ...t, x: Math.round((t.cx / 1000) * W - SIDE / 2), y: Math.round((t.cy / 1000) * W - SIDE / 2), w: SIDE, h: SIDE }));
const SIZES = [2.8, 4, 5, 6, 7, 8, 10, 12, 14], snap = (mm) => SIZES.reduce((a, b) => (Math.abs(b - mm) < Math.abs(a - mm) ? b : a)); // cỡ catalog gần nhất, nhỏ nhất 2.8
const r1 = (v) => Math.round(v * 10) / 10, pc = (a, b) => (b ? Math.round((1000 * a) / b) / 10 : null);
const tierOf = (mm) => (mm >= 8 ? 1 : mm >= 4.5 ? 2 : 3);
fs.mkdirSync(DIR, { recursive: true });

function image() {
  const f = path.join(DIR, 'queen-3543.png');
  if (fs.existsSync(f)) return decodePng(fs.readFileSync(f));
  const src = decodePng(fs.readFileSync(path.join(REQ, 'Trang phục Queen.png'))), img = upscale(src, W, Math.round((W * src.h) / src.w));
  fs.writeFileSync(f, encodePng(img.w, img.h, img.data, {}, { compact: true }));
  return img;
}
function detect(img) { // như tools/bench_kit_tiers.mjs (KIT-12a tầng)
  const f = path.join(DIR, 'detect.json');
  if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8'));
  const bg = backgroundMask(img), r = detectBeads(img, { canvasWmm: 300, stoneMm: 2.2, gapMm: 0.4, accentMm: [3.2, 4.2, 5.2, 7.2, 9.2, 11.2] }, bg.pct.bg ? bg.mask : null);
  const out = r.stones.map((s) => ({ x: r1(s.x), y: r1(s.y), physMm: s.physMm, tier: s.tier, material: s.material, kind: s.kind, ...(s.axesMm && { axesMm: s.axesMm }) }));
  fs.writeFileSync(f, JSON.stringify(out));
  return out;
}
const inTile = (s, t, pad = 0) => s.x >= t.x - pad && s.y >= t.y - pad && s.x < t.x + t.w + pad && s.y < t.y + t.h + pad;
function tagged(img, det, t) {
  const pts = det.filter((s) => inTile(s, t)), im = resizeRegion(img, t, SEND), G = loadGlyphs();
  pts.forEach((s, j) => drawTag(im, (s.x - t.x) * K, (s.y - t.y) * K, j + 1, 16, G));
  return { im, pts };
}

if (cmd === 'prep' || cmd === 'vlm') {
  const img = image(), det = detect(img);
  for (const t of TILES) {
    const { im, pts } = tagged(img, det, t);
    fs.writeFileSync(path.join(DIR, `${t.id}-tags.png`), encodePng(im.w, im.h, im.data, {}, { compact: true, rgb: true }));
    console.log(`${t.id} (${t.what}): ô ${t.x},${t.y} ${SIDE}px = 25 mm → ${SEND}px, ${pts.length} tag DETECT`);
    if (cmd !== 'vlm') continue;
    const f = path.join(DIR, `${t.id}-vlm-${THINK}.json`);
    if (fs.existsSync(f)) { console.log(`  đã có ${f}`); continue; }
    if (!RUN) { console.log('  chưa gọi (thêm --run)'); continue; }
    const png = encodePng(im.w, im.h, im.data, {}, { compact: true, rgb: true });
    const parts = [{ inlineData: { mimeType: 'image/png', data: png.toString('base64') } }, { text: gtPrompt(pts.length, 25) }];
    const r = await budget.call({ kind: 'queen-gt', img: 'queen', tile: t.id, thinking: THINK, sentPx: [im.w, im.h] }, () => callFlash(parts, GT_SCHEMA, { retries: 1, thinking: THINK }));
    fs.writeFileSync(f, JSON.stringify({ tile: t, thinking: THINK, model: r.model, usage: r.usage, pts, data: r.data }, null, 1));
    console.log(`  ${THINK}: ${r.data.items.length} mục, ${r.data.missing.length} hạt thiếu · token ${r.usage.in}/${r.usage.out}`);
  }
  console.log(`ngân sách: $${Math.round(budget.spent() * 1000) / 1000} / $${budget.usdCap}`);
} else if (cmd === 'miss') {
  const img = image(), G = loadGlyphs();
  for (const t of TILES) {
    const gtF = path.join(DIR, `${t.id}.json`);
    if (!fs.existsSync(gtF)) { console.log(`${t.id}: chạy build trước`); continue; }
    const known = JSON.parse(fs.readFileSync(gtF, 'utf8')).stones.filter((s) => !String(s.src).startsWith('vlm-missing-q'));
    for (const q of [0, 1, 2, 3]) {
      const h = SIDE / 2, a = { x: t.x + (q % 2) * h, y: t.y + (q >> 1) * h, w: h, h }, f = path.join(DIR, `${t.id}-miss${q}-${THINK}.json`), k = SEND / h;
      const im = resizeRegion(img, a, SEND);
      for (const s of known) { // chấm đen viền trắng ở tâm hạt đã biết
        const cx = (s.x - a.x) * k, cy = (s.y - a.y) * k;
        for (let v = Math.floor(cy - 9); v <= cy + 9; v++) for (let u = Math.floor(cx - 9); u <= cx + 9; u++) {
          const d = Math.hypot(u - cx, v - cy);
          if (d <= 9 && u >= 0 && v >= 0 && u < im.w && v < im.h) im.data.set(d <= 6 ? [0, 0, 0, 255] : [255, 255, 255, 255], (v * im.w + u) * 4);
        }
      }
      fs.writeFileSync(path.join(DIR, `${t.id}-miss${q}.png`), encodePng(im.w, im.h, im.data, {}, { compact: true, rgb: true }));
      if (fs.existsSync(f)) { console.log(`  đã có ${f}`); continue; }
      if (!RUN) { console.log(`${t.id} góc ${q}: chưa gọi (thêm --run)`); continue; }
      const png = encodePng(im.w, im.h, im.data, {}, { compact: true, rgb: true });
      const r = await budget.call({ kind: 'queen-gt-miss', img: 'queen', tile: t.id, q, thinking: THINK, sentPx: [im.w, im.h] },
        () => callFlash([{ inlineData: { mimeType: 'image/png', data: png.toString('base64') } }, { text: missPrompt(12.5) }], MISS_SCHEMA, { retries: 1, thinking: THINK }));
      fs.writeFileSync(f, JSON.stringify({ tile: t, q, area: a, thinking: THINK, model: r.model, usage: r.usage, data: r.data }, null, 1));
      console.log(`${t.id} góc ${q}: ${r.data.missing.length} hạt thiếu · token ${r.usage.in}/${r.usage.out}`);
    }
  }
  console.log(`ngân sách: $${Math.round(budget.spent() * 1000) / 1000} / $${budget.usdCap}`);
} else if (cmd === 'build') build();
else { console.error(`lệnh lạ: ${cmd}`); process.exit(1); }

function build() {
  const img = image(), det = detect(img), report = { tiles: {}, cost: {} };
  for (const t of TILES) {
    const res = Object.fromEntries(['medium', 'low'].map((k) => [k, path.join(DIR, `${t.id}-vlm-${k}.json`)]).filter(([, f]) => fs.existsSync(f)).map(([k, f]) => [k, JSON.parse(fs.readFileSync(f, 'utf8'))]));
    const main = res.medium || res.low, alt = res.medium && res.low;
    if (!main) { console.log(`${t.id}: chưa có kết quả VLM`); continue; }
    for (const [k, o] of Object.entries(res)) report.cost[`${t.id}/${k}`] = { usd: Math.round(((o.usage.in * 0.5 + o.usage.out * 3) / 1e6) * 1e4) / 1e4, out: o.usage.out };
    const gtF = path.join(DIR, `${t.id}.json`), old = fs.existsSync(gtF) ? JSON.parse(fs.readFileSync(gtF, 'utf8')) : null;
    let gt = old?.checked ? old : null;
    if (!gt) {
      const byN = (o) => new Map(o.data.items.map((x) => [x.n, x])), M = byN(main), A = alt ? byN(alt) : null, stones = [];
      main.pts.forEach((p, j) => {
        const v = M.get(j + 1), a = A?.get(j + 1);
        if (!v || !v.is_bead || v.material === 'none') return;
        const s = { x: p.x, y: p.y, measuredMm: v.size_mm, physMm: snap(v.size_mm), material: v.material, color: v.color, shape: v.shape, mat4: mat4(v.material, v.color), src: `detect#${j + 1}` };
        const why = !A ? [] : !a || !a.is_bead || a.material === 'none' ? ['low: không phải hạt'] : [
          ...(mat4(a.material, a.color) !== s.mat4 ? [`low: ${a.material}/${a.color}`] : []), ...(snap(a.size_mm) !== s.physMm ? [`low: ${snap(a.size_mm)} mm`] : []), ...(a.shape !== s.shape ? [`low: ${a.shape}`] : [])];
        stones.push({ ...s, ...(why.length && { review: why.join('; ') }) });
      });
      const miss = (o) => o.data.missing.map((m) => { const b = boxPx(m.box_2d, t); return b && { x: r1((b.x0 + b.x1) / 2), y: r1((b.y0 + b.y1) / 2), measuredMm: m.size_mm, boxMm: r1(((b.x1 - b.x0 + b.y1 - b.y0) / 2) / PPM), physMm: snap(m.size_mm), material: m.material, color: m.color, shape: m.shape, mat4: mat4(m.material, m.color) }; }).filter(Boolean);
      const mAlt = alt ? miss(alt) : [];
      for (const m of miss(main)) {
        if (stones.some((q) => Math.hypot(q.x - m.x, q.y - m.y) < 0.5 * Math.max(q.physMm, m.physMm) * PPM)) continue; // trùng tag
        const seen = mAlt.some((q) => Math.hypot(q.x - m.x, q.y - m.y) < 0.6 * m.physMm * PPM);
        stones.push({ ...m, src: 'vlm-missing', ...(alt && !seen && { review: 'chỉ medium thấy hạt thiếu này' }) });
      }
      for (const q of [0, 1, 2, 3]) { // lượt hạt thiếu theo góc (lệnh miss)
        const qf = path.join(DIR, `${t.id}-miss${q}-medium.json`);
        if (!fs.existsSync(qf)) continue;
        const o = JSON.parse(fs.readFileSync(qf, 'utf8'));
        report.cost[`${t.id}/miss${q}`] = { usd: Math.round(((o.usage.in * 0.5 + o.usage.out * 3) / 1e6) * 1e4) / 1e4, out: o.usage.out };
        for (const m of o.data.missing) {
          const b = boxPx(m.box_2d, o.area);
          if (!b) continue;
          const x = r1((b.x0 + b.x1) / 2), y = r1((b.y0 + b.y1) / 2), ph = snap(m.size_mm);
          if (stones.some((z) => Math.hypot(z.x - x, z.y - y) < 0.5 * Math.min(z.measuredMm || z.physMm, m.size_mm) * PPM)) continue;
          stones.push({ x, y, measuredMm: m.size_mm, boxMm: r1(((b.x1 - b.x0 + b.y1 - b.y0) / 2) / PPM), physMm: ph, material: m.material, color: m.color, shape: m.shape, mat4: mat4(m.material, m.color), src: `vlm-missing-q${q}` });
        }
      }
      stones.forEach((s, i) => { s.id = i + 1; s.xMm = r1(s.x / PPM); s.yMm = r1(s.y / PPM); });
      gt = { schema: 'pearl-kit-gt/1', image: 'requirements/Trang phục Queen.png upscaled to 3543 px (300 mm, 11.81 px/mm)', tile: { id: t.id, what: t.what, x: t.x, y: t.y, w: t.w, h: t.h, mm: 25 },
        source: `VLM ${main.thinking} on DETECT tags${alt ? ' (+ low for review flags)' : ''}, ${main.model}`, checked: false, stones };
      fs.writeFileSync(gtF, JSON.stringify(gt, null, 1));
    }
    overlay(img, t, gt.stones);
    // chấm DETECT (KIT-12a tầng) trên ô: hạt có tâm trong ô
    const D = det.filter((s) => inTile(s, t)), G = gt.stones, pairs = [];
    D.forEach((d, i) => G.forEach((g, j) => { const dd = Math.hypot(d.x - g.x, d.y - g.y); if (dd < 0.5 * Math.max(1.5, g.measuredMm || g.physMm) * PPM) pairs.push([dd, i, j]); }));
    pairs.sort((a, b) => a[0] - b[0]);
    const ud = new Set(), ug = new Set(), mt = [];
    for (const [, i, j] of pairs) if (!ud.has(i) && !ug.has(j)) { ud.add(i); ug.add(j); mt.push([D[i], G[j]]); }
    const byTier = Object.fromEntries([1, 2, 3].map((k) => { const g = G.filter((s) => tierOf(s.physMm) === k).length, d = D.filter((s) => tierOf(s.physMm) === k).length; return [k, { gt: g, detect: d, errPct: pc(d - g, g) }]; }));
    const conf = {};
    for (const [d, g] of mt) if (d.material !== g.mat4) { const k = `${g.mat4}→${d.material}`; conf[k] = (conf[k] || 0) + 1; }
    report.tiles[t.id] = { what: t.what, gt: G.length, review: G.filter((s) => s.review).length, detect: D.length, countErrPct: pc(D.length - G.length, G.length), byTier,
      matched: mt.length, recall: pc(mt.length, G.length), precision: pc(mt.length, D.length), materialOk: pc(mt.filter(([d, g]) => d.material === g.mat4).length, mt.length),
      sizeOk: pc(mt.filter(([d, g]) => d.physMm === g.physMm).length, mt.length), materialConfusion: conf,
      gtMix: Object.fromEntries(Object.entries(G.reduce((h, s) => ((h[`${s.mat4}/${s.physMm}`] = (h[`${s.mat4}/${s.physMm}`] || 0) + 1), h), {})).sort((a, b) => b[1] - a[1])),
      ...(alt && { lowVsMedium: { mediumBeads: G.filter((s) => s.src.startsWith('detect')).length, flagged: G.filter((s) => s.review).length, missingMedium: main.data.missing.length, missingLow: alt.data.missing.length } }) };
  }
  const all = Object.values(report.tiles), sum = (k) => all.reduce((a, x) => a + (x[k] || 0), 0);
  report.total = { gt: sum('gt'), detect: sum('detect'), countErrPct: pc(sum('detect') - sum('gt'), sum('gt')), matched: sum('matched'),
    materialOk: pc(all.reduce((a, x) => a + (x.materialOk * x.matched) / 100, 0), sum('matched')), sizeOk: pc(all.reduce((a, x) => a + (x.sizeOk * x.matched) / 100, 0), sum('matched')),
    usd: Math.round(Object.values(report.cost).reduce((a, c) => a + c.usd, 0) * 1e4) / 1e4 };
  fs.writeFileSync(path.join(DIR, 'report.json'), JSON.stringify(report, null, 1));
  console.log(JSON.stringify(report, null, 1));
}

// ảnh duyệt: ô 1024 px, vòng = cỡ đo (measuredMm; physMm = cỡ catalog gần nhất ≥ 2.8 trong json), màu theo vật liệu (vàng = gold, lam = pearl, trắng = white, lục = color), hồng = review; số = id trong <ô>.json
function overlay(img, t, stones) {
  const im = resizeRegion(img, t, SEND), G = loadGlyphs(), COL = { gold: [255, 160, 0], pearl: [0, 200, 255], white: [255, 255, 255], color: [0, 220, 0] };
  for (const s of stones) {
    const cx = (s.x - t.x) * K, cy = (s.y - t.y) * K, r = ((s.measuredMm || s.physMm) / 2) * PPM * K, c = s.review ? [255, 0, 255] : COL[s.mat4] || [255, 0, 0];
    for (let a = 0; a < 720; a++) for (const dr of [0, 1, 2]) {
      const x = Math.round(cx + (r - dr) * Math.cos((a * Math.PI) / 360)), y = Math.round(cy + (r - dr) * Math.sin((a * Math.PI) / 360));
      if (x >= 0 && y >= 0 && x < im.w && y < im.h) im.data.set([...c, 255], (y * im.w + x) * 4);
    }
  }
  for (const s of stones) drawTag(im, (s.x - t.x) * K, (s.y - t.y) * K, s.id, 14, G);
  fs.writeFileSync(path.join(DIR, `${t.id}-gt.png`), encodePng(im.w, im.h, im.data, {}, { compact: true, rgb: true }));
}
