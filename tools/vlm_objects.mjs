// KIT-12c: VLM hỗ trợ vật thể to (lib/kit/vlm.js). Ngân sách call cứng ở outputs/kit-vlm/calls.jsonl (mặc định 10, --cap).
//   node tools/vlm_objects.mjs plan                                   ngân sách đã dùng + ước phí 1 call, không gọi gì
//   node --env-file=<.env> tools/vlm_objects.mjs full king --run      cả ảnh thu nhỏ (768 px) → vật thể to + box_2d
//   node --env-file=<.env> tools/vlm_objects.mjs crop king --obj 3 --tag sapphire --run
//                                                                     crop phóng to quanh vật thể số 3 của lần 'full' (hoặc --box ymin,xmin,ymax,xmax 0-1000)
//   node --env-file=<.env> tools/vlm_objects.mjs stones king --run    cả ảnh độ phân giải gốc (1254 px) → từng viên rời: vật liệu + HÌNH + box_2d
//   node tools/vlm_objects.mjs report king [--map <svg>] [--big largest|print] [--big-mm 6]
//                                                                     offline: so với bản đồ hiện có, sửa thử (1 viên / chuỗi 1 mã, đặt lại vành khi đổi cỡ),
//                                                                     ảnh zoom trước/sau cho mỗi crop (+ <tag>-stones: cùng cửa sổ, chỉ dùng call 'stones')
// Không --run thì chỉ in ra sẽ gửi gì. PEARL_MOCK=1: dữ liệu giả, không tốn call, file *.mock.json.
// Ảnh: requirements/Trang phục King.png | Queen.png (KIT_REQ); bản đồ mặc định ./outputs/kit/<ảnh>_costume_full/starry_v2.svg.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePng, encodePng } from '../lib/png.js';
import { readKitSvg } from '../lib/kit/svgio.js';
import { renderMap } from '../lib/kit/render.js';
import { loadCatalog, refOf, LETTERS } from '../lib/kit/catalog.js';
import { rgbToLab } from '../lib/kit/place.js';
import { callFlash, callBudget, objectPrompt, OBJECT_SCHEMA, cropPrompt, CROP_SCHEMA, stonesPrompt, STONES_SCHEMA, boxPx, resizeRegion, estimateCost } from '../lib/kit/vlm.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2), flag = (k) => argv.includes(`--${k}`), arg = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 && argv[i + 1] != null ? argv[i + 1] : d; };
const [cmd = 'plan', name = 'king'] = argv.filter((a, i) => !a.startsWith('--') && !(i && argv[i - 1].startsWith('--') && !['--run'].includes(argv[i - 1])));
const MOCK = !!process.env.PEARL_MOCK, RUN = flag('run');
const REQ = process.env.KIT_REQ || path.join(process.cwd(), 'requirements');
const OUT = path.join(process.env.PEARL_OUT ? path.resolve(process.env.PEARL_OUT) : path.join(ROOT, 'outputs'), 'kit-vlm');
const DIR = path.join(OUT, 'objects'), SFX = MOCK ? '.mock' : '';
const CANVAS_MM = 300, SEND_FULL = 768, SEND_CROP = 768;
fs.mkdirSync(DIR, { recursive: true });
const budget = callBudget(path.join(OUT, 'calls.jsonl'), Number(arg('cap', 10)), fs);
const IMG = { king: 'Trang phục King.png', queen: 'Trang phục Queen.png' };
const r1 = (v) => Math.round(v * 10) / 10;
const loadImg = () => { const f = path.join(REQ, IMG[name] || name); return { file: f, img: decodePng(fs.readFileSync(f)) }; };
const mmPer = (img) => CANVAS_MM / img.w;
const resFile = (kind, tag) => path.join(DIR, `${name}-${kind}${tag ? `-${tag}` : ''}${SFX}.json`);
const save = (f, o) => { fs.writeFileSync(f, JSON.stringify(o, null, 1)); return f; };

async function ask(kind, img, area, outPx, prompt, schema, mock) {
  const send = resizeRegion(img, area, outPx), png = encodePng(send.w, send.h, send.data, {}, { compact: true, rgb: true });
  const est = estimateCost(1);
  console.log(`${kind} ${name}: vùng ${Math.round(area.w)}×${Math.round(area.h)}px (${r1(area.w * mmPer(img))}×${r1(area.h * mmPer(img))}mm) → gửi ${send.w}×${send.h}px PNG ${Math.round(png.length / 1024)}KB · ước ~$${est.usd}/call · ngân sách ${budget.used()}/${budget.cap}`);
  if (MOCK) return { model: 'mock', usage: { in: 0, out: 0 }, data: mock(), sent: { w: send.w, h: send.h } };
  if (!RUN) { console.log('Chưa gọi (thêm --run).'); process.exit(0); }
  const parts = [{ inlineData: { mimeType: 'image/png', data: png.toString('base64') } }, { text: prompt }];
  const r = await budget.call({ kind, img: name, area: [area.x, area.y, area.w, area.h].map(Math.round), sentPx: [send.w, send.h] }, () => callFlash(parts, schema, { retries: 0 }));
  return { ...r, sent: { w: send.w, h: send.h } };
}

function printObjects(objs, img) {
  objs.forEach((o, i) => {
    const b = boxPx(o.box_2d, { x: 0, y: 0, w: img.w, h: img.h }), k = mmPer(img);
    console.log(`  [${i}] ${o.label} · ${o.material}/${o.structure} ×${o.count} · ${o.bead_mm ?? '-'}mm · ${o.color} · box ${b ? `${r1((b.x1 - b.x0) * k)}×${r1((b.y1 - b.y0) * k)}mm @ ${r1(((b.x0 + b.x1) / 2) * k)},${r1(((b.y0 + b.y1) / 2) * k)}mm` : 'hỏng'}`);
  });
}

if (cmd === 'plan') {
  const lines = budget.lines(), done = lines.filter((l) => l.state === 'done');
  console.log(`Ngân sách: ${budget.used()}/${budget.cap} call đã gửi, ${done.length} xong, ${lines.filter((l) => l.state === 'error').length} lỗi, phí thật $${r1(done.reduce((a, l) => a + (l.usd || 0), 0) * 1000) / 1000}`);
  for (const l of done) console.log(`  #${l.n} ${l.kind} ${l.img} ${l.model} in ${l.usage?.in} out ${l.usage?.out} $${l.usd} ${l.ms}ms`);
  console.log(`Ước 1 call: ~$${estimateCost(1).usd} (thô)${done.length ? ` · thật TB $${Math.round((1e4 * done.reduce((a, l) => a + (l.usd || 0), 0)) / done.length) / 1e4} (token suy nghĩ tính là ra)` : ''}`);
} else if (cmd === 'full') {
  const { img } = loadImg(), area = { x: 0, y: 0, w: img.w, h: img.h };
  const mock = () => ({ objects: [{ label: 'mock big stone', material: 'faceted', structure: 'single', count: 1, bead_mm: 20, color: '#2040C0', box_2d: [450, 450, 520, 520] }, { label: 'mock pearl ring', material: 'pearl', structure: 'beads', count: 20, bead_mm: 5, color: '#F0EEE0', box_2d: [300, 400, 420, 600] }] });
  const r = await ask('full', img, area, SEND_FULL, objectPrompt(CANVAS_MM), OBJECT_SCHEMA, mock);
  const f = save(resFile('full'), { name, kind: 'full', area, model: r.model, usage: r.usage, sent: r.sent, data: r.data });
  console.log(`${r.model} · token ${r.usage?.in}/${r.usage?.out} → ${f}`);
  printObjects(r.data.objects || [], img);
} else if (cmd === 'stones') {
  const { img } = loadImg(), area = { x: 0, y: 0, w: img.w, h: img.h };
  const mock = () => ({ stones: [{ material: 'faceted', shape: 'marquise', color: '#F0F0F0', box_2d: [100, 100, 140, 120] }] });
  const r = await ask('stones', img, area, Math.max(img.w, img.h), stonesPrompt(CANVAS_MM), STONES_SCHEMA, mock);
  const f = save(resFile('stones'), { name, kind: 'stones', area, model: r.model, usage: r.usage, sent: r.sent, data: r.data });
  const h = {};
  for (const x of r.data.stones || []) { const k = `${x.material}/${x.shape}`; h[k] = (h[k] || 0) + 1; }
  console.log(`${r.model} · token ${r.usage?.in}/${r.usage?.out} → ${f}\n  ${(r.data.stones || []).length} viên: ${Object.entries(h).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ')}`);
} else if (cmd === 'crop') {
  const { img } = loadImg(), tag = arg('tag', 'crop');
  let b, hint = arg('hint', '');
  if (arg('box')) b = arg('box').split(',').map(Number);
  else {
    const full = JSON.parse(fs.readFileSync(resFile('full'), 'utf8')), o = full.data.objects[Number(arg('obj', 0))];
    if (!o) throw new Error(`không có vật thể ${arg('obj')}`);
    b = o.box_2d; hint ||= `${o.label} (${o.material}, ${o.structure})`;
  }
  const bp = boxPx(b, { x: 0, y: 0, w: img.w, h: img.h }), pad = Number(arg('pad', 0.25)), side = Math.max(bp.x1 - bp.x0, bp.y1 - bp.y0) * (1 + 2 * pad);
  const cx = (bp.x0 + bp.x1) / 2, cy = (bp.y0 + bp.y1) / 2, s = Math.min(side, img.w, img.h);
  const area = { x: Math.max(0, Math.min(img.w - s, cx - s / 2)), y: Math.max(0, Math.min(img.h - s, cy - s / 2)), w: s, h: s };
  const mock = () => ({ main: { label: 'mock', material: 'faceted', structure: 'single', count: 1, same_type: true, box_2d: [300, 300, 700, 700] }, beads: [{ material: 'faceted', color: '#2040C0', box_2d: [300, 300, 700, 700] }, { material: 'pearl', color: '#F0F0E0', box_2d: [100, 100, 160, 160] }] });
  const r = await ask('crop', img, area, SEND_CROP, cropPrompt(area.w * mmPer(img), area.h * mmPer(img), hint), CROP_SCHEMA, mock);
  const f = save(resFile('crop', tag), { name, kind: 'crop', tag, hint, area, model: r.model, usage: r.usage, sent: r.sent, data: r.data });
  const m = r.data.main || {};
  console.log(`${r.model} · token ${r.usage?.in}/${r.usage?.out} → ${f}`);
  console.log(`  main: ${m.label} · ${m.material}/${m.structure} ×${m.count} same_type=${m.same_type}`);
  const mats = {};
  for (const x of r.data.beads || []) mats[x.material] = (mats[x.material] || 0) + 1;
  console.log(`  beads: ${(r.data.beads || []).length} (${Object.entries(mats).map(([k, v]) => `${k} ${v}`).join(', ')})`);
} else if (cmd === 'report') {
  report();
} else { console.error(`lệnh lạ: ${cmd}`); process.exit(1); }

// ── offline: VLM ↔ bản đồ hiện có; sửa thử; ảnh zoom
function report() {
  const { img } = loadImg(), cat = loadCatalog();
  const mapFile = arg('map', path.join(process.cwd(), 'outputs', 'kit', `${name}_costume_full`, 'starry_v2.svg'));
  const doc = readKitSvg(fs.readFileSync(mapFile, 'utf8')), S = doc.canvas.widthPx / img.w, K = doc.canvas.pxPerMm; // px bản đồ / px ảnh, px bản đồ / mm
  const phys = (s) => Number(/_S([\d.]+)$/.exec(s.group || '')?.[1]) || s.dMm + 0.8;
  const stones = doc.stones.map((s) => ({ ...s, phys: phys(s) }));
  const pal = { codes: {} };
  for (const p of doc.palette) pal.codes[p.code] = { fill: p.rgb, edge: p.edge, text: p.text, fontPx: p.fontPx, symbol: p.symbol };
  const crops = fs.readdirSync(DIR).filter((f) => f.startsWith(`${name}-crop-`) && f.endsWith(`${SFX}.json`) && (MOCK || !f.includes('.mock.'))).map((f) => JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')));
  const fullF = resFile('full'), full = fs.existsSync(fullF) ? JSON.parse(fs.readFileSync(fullF, 'utf8')) : null;
  if (!full && !crops.length) { console.log(`Chưa có kết quả VLM cho ${name} (${DIR})`); return; }
  const meanLab = (b) => { // màu ảnh trung bình trong elip nội tiếp box px ảnh
    const c = [0, 0, 0], cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2, ax = (b.x1 - b.x0) / 2, ay = (b.y1 - b.y0) / 2;
    let n = 0;
    for (let y = Math.floor(b.y0); y < b.y1; y++) for (let x = Math.floor(b.x0); x < b.x1; x++) if (((x - cx) / ax) ** 2 + ((y - cy) / ay) ** 2 <= 0.6) { const j = (y * img.w + x) * 4; for (let i = 0; i < 3; i++) c[i] += img.data[j + i]; n++; }
    return rgbToLab(...c.map((v) => v / Math.max(1, n)));
  };
  const nearestCode = (lab, physMm, kind) => {
    let best = null;
    for (const e of Object.values(cat.codes)) {
      if (e.physMm !== physMm || (kind && e.kind !== kind)) continue;
      const q = rgbToLab(...[1, 3, 5].map((i) => parseInt(e.fill.slice(i, i + 2), 16))), d = Math.hypot(lab[0] - q[0], lab[1] - q[1], lab[2] - q[2]);
      if (!best || d < best.d) best = { code: e.code, d, e };
    }
    return best;
  };
  const sizesOf = (kind) => [...new Set(Object.values(cat.codes).filter((e) => e.kind === kind).map((e) => e.physMm))].sort((a, b) => a - b);
  const snap = (mm, list) => list.reduce((a, b) => (Math.abs(b - mm) < Math.abs(a - mm) ? b : a));
  const inEll = (s, b, grow = 0) => { // tâm viên (px bản đồ) trong elip box (px ảnh) nới thêm grow mm
    const cx = ((b.x0 + b.x1) / 2) * S, cy = ((b.y0 + b.y1) / 2) * S, ax = ((b.x1 - b.x0) / 2) * S + grow * K, ay = ((b.y1 - b.y0) / 2) * S + grow * K;
    return ((s.x - cx) / ax) ** 2 + ((s.y - cy) / ay) ** 2 <= 1;
  };
  const hist = (list) => { const h = {}; for (const s of list) h[s.code] = (h[s.code] || 0) + 1; return Object.fromEntries(Object.entries(h).sort((a, b) => b[1] - a[1])); };
  const out = { name, map: mapFile, mapStones: stones.length, objects: [], crops: [] };
  const big = sizesOf('stone').at(-1), bigPearl = sizesOf('pearl').at(-1);
  const freeLetter = () => [...LETTERS].find((L) => !Object.values(pal.codes).some((p) => p.symbol === L)) || 'Z';

  // 1) cả ảnh: mỗi vật thể → đá bản đồ nằm trong (vật thể 'single' đúng ra = 1 viên)
  for (const [i, o] of (full?.data.objects || []).entries()) {
    const b = boxPx(o.box_2d, full.area);
    if (!b) continue;
    const inside = stones.filter((s) => inEll(s, b)), wMm = (b.x1 - b.x0) * mmPer(img), hMm = (b.y1 - b.y0) * mmPer(img);
    out.objects.push({ i, label: o.label, material: o.material, structure: o.structure, count: o.count, beadMm: o.bead_mm, boxMm: [r1(wMm), r1(hMm)], mapStones: inside.length, mapCodes: hist(inside) });
  }

  const BIG_MM = Number(arg('big-mm', 6)), bigMode = arg('big', 'largest');
  // 1 viên (box VLM) → gỡ đá bản đồ trong elip, đặt 1 viên tròn catalog cỡ/màu gần nhất; hình không tròn chỉ gắn cờ (catalog chỉ tròn)
  function fixSingle(sg) {
    const dMm = Math.min(sg.b.x1 - sg.b.x0, sg.b.y1 - sg.b.y0) * mmPer(img), ovalMm = [r1((sg.b.x1 - sg.b.x0) * mmPer(img)), r1((sg.b.y1 - sg.b.y0) * mmPer(img))];
    const lab = meanLab(sg.b), kind = sg.material === 'pearl' && nearestCode(lab, snap(dMm, sizesOf('pearl')), 'pearl')?.d < 30 ? 'pearl' : 'stone'; // VLM hay gọi hạt vàng là ngọc → kiểm màu ảnh
    // cỡ: gần cỡ đo nhất; quá cỡ / không có mã cùng màu (ΔE76 ≥ 35) → hạ dần tới cỡ lớn nhất có mã màu gần (vd sapphire → Q xanh 10 mm)
    const max = kind === 'pearl' ? bigPearl : big, over = dMm > max + 1.5, want = over ? max : snap(dMm, sizesOf(kind));
    const size = sizesOf(kind).filter((z) => z <= want).reverse().find((z) => nearestCode(lab, z, kind)?.d < 35) ?? want;
    const removed = fixed.filter((q) => inEll(q, sg.b, 0.2));
    fixed = fixed.filter((q) => !inEll(q, sg.b, 0.2));
    const act = { type: 'single', label: sg.label, material: sg.material, kind, ...(sg.shape && sg.shape !== 'round' && { shape: sg.shape }), boxMm: ovalMm, removed: removed.length, removedCodes: hist(removed) };
    if (!over || bigMode === 'largest') {
      const nc = nearestCode(lab, size, kind), cx = ((sg.b.x0 + sg.b.x1) / 2) * S, cy = ((sg.b.y0 + sg.b.y1) / 2) * S;
      const bumped = fixed.filter((q) => Math.hypot(q.x - cx, q.y - cy) < ((size + q.phys) / 2 + 0.15) * K);
      fixed = fixed.filter((q) => !bumped.includes(q));
      fixed.push({ id: `V${fixed.length}`, code: nc.code, symbol: nc.code, x: cx, y: cy, dMm: refOf(size, cat), phys: size, group: `K_${nc.code}_S${size}` });
      pal.codes[nc.code] ||= { fill: nc.e.fill, edge: nc.e.edge, text: nc.e.text, fontPx: nc.e.fontPx, symbol: kind === 'pearl' ? String(size) : freeLetter() };
      Object.assign(act, { add: `${nc.code} ${size}mm (ΔE76 ${r1(nc.d)})`, bumped: bumped.length, ...(size < want - 0.5 || over ? { oversize: `đo ${r1(dMm)}mm, catalog tròn tối đa ${max}mm, có mã màu gần ở ${size}mm` } : {}) });
    } else Object.assign(act, { add: null, note: `${r1(dMm)}mm > ${max}mm → để in` });
    return act;
  }

  // nhóm đá bản đồ cùng 1 chuỗi → 1 mã (đa số); mã kéo theo cỡ catalog (Z94 = 4 mm): đổi cỡ, rồi gỡ viên chồng (khe < 0.15 mm)
  // đổi cỡ + b (box px ảnh của viên giữa) + vành phủ ≥ 270° → đặt lại đều trên elip qua tâm các đá (cỡ mới lớn hơn thì ít viên hơn, không thưa lỗ);
  // không thì giữ chỗ cũ, gỡ tham lam viên chồng.
  function unify(list, b) {
    const h = hist(list), top = Object.keys(h)[0], ph = cat.codes[top]?.physMm ?? list.find((q) => q.code === top).phys;
    const act = { mapStones: list.length, codes: h, purityBefore: r1((100 * h[top]) / list.length) / 100, to: top, sizeMm: ph };
    const clash = (a, c) => Math.hypot(a.x - c.x, a.y - c.y) < ((a.phys + c.phys) / 2 + 0.15) * K, before = fixed.length;
    const mk = (q, x, y) => ({ ...q, x, y, code: top, symbol: pal.codes[top].symbol, phys: ph, dMm: refOf(ph, cat), group: `K_${top}_S${ph}` });
    let keep = [];
    if (b && list.some((q) => Math.abs(q.phys - ph) > 0.01)) { // chỉ khi đổi cỡ; cùng cỡ thì giữ chỗ cũ
      const cx = ((b.x0 + b.x1) / 2) * S, cy = ((b.y0 + b.y1) / 2) * S, ax = ((b.x1 - b.x0) / 2) * S, ay = ((b.y1 - b.y0) / 2) * S;
      const ang = list.map((q) => Math.atan2((q.y - cy) / ay, (q.x - cx) / ax)).sort((u, v) => u - v);
      const gapMax = Math.max(...ang.map((a, i) => (i ? a - ang[i - 1] : a + 2 * Math.PI - ang.at(-1))));
      if (2 * Math.PI - gapMax >= 1.5 * Math.PI) {
        const t = list.reduce((a, q) => a + Math.hypot((q.x - cx) / ax, (q.y - cy) / ay), 0) / list.length, A = ax * t, B = ay * t;
        const pts = Array.from({ length: 720 }, (_, i) => [cx + A * Math.cos((i * Math.PI) / 360), cy + B * Math.sin((i * Math.PI) / 360)]);
        const seg = pts.map((p, i) => Math.hypot(p[0] - pts[(i + 1) % 720][0], p[1] - pts[(i + 1) % 720][1])), P = seg.reduce((a, v) => a + v, 0);
        const n = Math.floor(P / ((ph + 0.15) * K)), step = P / n;
        let acc = 0, next = 0;
        for (let i = 0; i < 720 && keep.length < n; i++) { if (acc >= next) { keep.push(mk(list[0], ...pts[i])); keep.at(-1).id = `${list[0].id}r${keep.length}`; next += step; } acc += seg[i]; }
        const pinned = fixed.filter((q) => String(q.id).startsWith('V')); // viên rời vừa đặt thắng điểm vành
        keep = keep.filter((k) => !pinned.some((q) => clash(k, q)));
        act.respaced = { perimeterMm: r1(P / K), n, blockedBySingles: n - keep.length };
      }
    }
    if (!keep.length) { for (const q of list) Object.assign(q, mk(q, q.x, q.y)); for (const q of list) if (!keep.some((k) => clash(k, q))) keep.push(q); }
    fixed = fixed.filter((q) => !list.includes(q) && !keep.some((k) => clash(k, q))).concat(keep);
    return { ...act, ringAfter: keep.length, droppedForOverlap: before - (fixed.length - keep.length) - list.length };
  }
  // không có hạt VLM (route 'stones'): vành đá bản đồ sát viên vừa đặt (≤ 1.5 cỡ viên ngoài elip), gom theo MÀU ẢNH dưới từng đá
  function ringOf(b) {
    const lab = (q) => { const r = (q.phys / 2) * K / S * 0.6; return meanLab({ x0: q.x / S - r, x1: q.x / S + r, y0: q.y / S - r, y1: q.y / S + r }); };
    const ring = fixed.filter((q) => !inEll(q, b, 0.2) && inEll(q, b, 1.5 * q.phys) && !String(q.id).startsWith('V')).map((q) => ({ q, lab: lab(q) }));
    const med = [0, 1, 2].map((i) => ring.map((x) => x.lab[i]).sort((a, c) => a - c)[ring.length >> 1] ?? 0);
    return ring.filter((x) => Math.hypot(x.lab[0] - med[0], x.lab[1] - med[1], x.lab[2] - med[2]) < 20).map((x) => x.q);
  }

  // 2) crop: hạt VLM ↔ đá bản đồ; sửa thử: 1 viên đúng cỡ / chuỗi cùng loại 1 mã
  let fixed = stones.map((x) => ({ ...x }));
  for (const c of crops) {
    const beads = (c.data.beads || []).map((x) => ({ ...x, b: boxPx(x.box_2d, c.area) })).filter((x) => x.b);
    const mainB = boxPx(c.data.main?.box_2d, c.area), m = c.data.main || {};
    const rec = { tag: c.tag, hint: c.hint, model: c.model, usage: c.usage, main: m, beads: beads.length, actions: [] };
    for (const x of beads) { x.dMm = (((x.b.x1 - x.b.x0) + (x.b.y1 - x.b.y0)) / 2) * mmPer(img); x.cx = ((x.b.x0 + x.b.x1) / 2) * S; x.cy = ((x.b.y0 + x.b.y1) / 2) * S; }
    // 1 viên: box main 'single' + hạt VLM ≥ BIG_MM (1:1 theo hạt thấy trong ảnh, đúng cỡ đo). Quá cỡ tròn lớn nhất catalog →
    // --big largest (mặc định: 1 viên cỡ lớn nhất, gắn cờ) | print (bỏ đá, để in).
    const singles = [];
    if (mainB && m.structure === 'single') singles.push({ b: mainB, material: m.material, label: m.label });
    for (const x of beads) if (x.dMm >= BIG_MM && !singles.some((q) => inEll({ x: x.cx, y: x.cy }, q.b))) singles.push({ b: x.b, material: x.material, label: `bead ${r1(x.dMm)}mm` });
    for (const sg of singles) rec.actions.push(fixSingle(sg));
    // chuỗi quanh vật chính: hạt VLM sát viền main (tâm cách elip ≤ 1.2 cỡ hạt), gom theo MÀU ẢNH (nhãn vật liệu VLM không tin được)
    // → đá bản đồ trùng các hạt đó gán 1 mã (đa số).
    if (mainB) {
      const ring = beads.filter((x) => !singles.some((q) => inEll({ x: x.cx, y: x.cy }, q.b)) && inEll({ x: x.cx, y: x.cy }, mainB, 1.2 * x.dMm));
      ring.forEach((x) => { x.lab = meanLab(x.b); });
      const med = [0, 1, 2].map((i) => ring.map((x) => x.lab[i]).sort((a, b) => a - b)[ring.length >> 1] ?? 0);
      const same = ring.filter((x) => Math.hypot(x.lab[0] - med[0], x.lab[1] - med[1], x.lab[2] - med[2]) < 20);
      const list = [...new Set(same.flatMap((x) => fixed.filter((q) => Math.hypot(q.x - x.cx, q.y - x.cy) <= (x.dMm / 2) * K)))];
      if (list.length >= 3) rec.actions.push({ type: 'unify', vlmRing: ring.length, sameColour: same.length, ...unify(list, mainB) });
    }
    out.crops.push(rec);
    zoom(c, stones, fixed.map((s) => ({ ...s, symbol: String(pal.codes[s.code]?.symbol || s.symbol).slice(0, 1) })), beads, singles); // glyph 1 ký tự (ngọc 10/12/14 hiện chữ số đầu)
  }
  // 3) 1 call độ phân giải gốc liệt kê từng viên rời (stones): viên ≥ BIG_MM mà bản đồ chẻ thành ≥ 2 viên → sửa thử trên bản sao riêng
  const stF = resFile('stones'), st = fs.existsSync(stF) ? JSON.parse(fs.readFileSync(stF, 'utf8')) : null;
  if (st) {
    const keepFixed = fixed, byShape = {}, list = [];
    fixed = stones.map((x) => ({ ...x }));
    for (const v of st.data.stones || []) {
      const b = boxPx(v.box_2d, st.area);
      if (!b) continue;
      const inside = stones.filter((q) => inEll(q, b)), dMm = r1(Math.min(b.x1 - b.x0, b.y1 - b.y0) * mmPer(img)), key = `${v.material}/${v.shape}`;
      const row = { material: v.material, shape: v.shape, minMm: dMm, mapStones: inside.length, mapCodes: hist(inside) };
      const g = (byShape[key] ||= { n: 0, big: 0, split: 0, mapStones: 0, fixed: 0 });
      g.n++; g.mapStones += inside.length;
      if (dMm >= BIG_MM && v.material !== 'metal') { g.big++; if (inside.length >= 2) { g.split++; g.fixed++; row.fix = fixSingle({ b, material: v.material, shape: v.shape, label: key }); if (dMm >= 12) { const rg = ringOf(b); if (rg.length >= 6 && Object.keys(hist(rg)).length > 1) row.fix.ring = unify(rg, b); } } } // kim loại (thánh giá, sao vàng) để in
      list.push({ ...row, b });
    }
    // cùng cửa sổ zoom như các crop, để so 1 call 'stones' với 2-3 call crop
    for (const c of crops) zoom({ ...c, tag: `${c.tag}-stones` }, stones, fixed.map((q) => ({ ...q, symbol: String(pal.codes[q.code]?.symbol || q.symbol).slice(0, 1) })), [], list.filter((r) => r.fix));
    list.forEach((r) => delete r.b);
    const fix = list.filter((r) => r.fix);
    out.stones = { model: st.model, usage: st.usage, n: list.length, byShape, fixed: fix.length, removed: fix.reduce((a, r) => a + r.fix.removed, 0),
      bumped: fix.reduce((a, r) => a + (r.fix.bumped || 0), 0), nonRound: fix.filter((r) => r.fix.shape).length, mapAfter: fixed.length, list };
    fixed = keepFixed;
  }
  const f = save(path.join(DIR, `${name}-report${SFX}.json`), out);
  console.log(`${name}: bản đồ ${stones.length} viên (${mapFile})`);
  for (const o of out.objects) console.log(`  [${o.i}] ${o.label} · ${o.material}/${o.structure} ×${o.count} · box ${o.boxMm.join('×')}mm → bản đồ có ${o.mapStones} viên ${JSON.stringify(o.mapCodes)}`);
  for (const c of out.crops) {
    console.log(`  crop ${c.tag}: main ${c.main.label} ${c.main.material}/${c.main.structure} ×${c.main.count} same_type=${c.main.same_type} · ${c.beads} hạt VLM`);
    for (const a of c.actions) console.log(`    ${JSON.stringify(a)}`);
  }
  if (out.stones) {
    const t = out.stones;
    console.log(`  stones (${t.model}): ${t.n} viên VLM · ${t.fixed} viên ≥ ${BIG_MM}mm bị bản đồ chẻ → gỡ ${t.removed} + đẩy ${t.bumped} đá, thêm ${t.fixed} viên (${t.nonRound} hình không tròn → tròn tạm) · bản đồ ${stones.length} → ${t.mapAfter}`);
    for (const [k, g] of Object.entries(t.byShape)) console.log(`    ${k.padEnd(18)} ${String(g.n).padStart(3)} viên, ${g.big} ≥ ${BIG_MM}mm, ${g.split} bị chẻ, TB ${r1(g.mapStones / g.n)} đá bản đồ/viên`);
  }
  console.log(`→ ${f}`);

  // ảnh zoom: [ảnh gốc + box VLM | bản đồ trước | bản đồ sau], cửa sổ vuông = vùng crop
  function zoom(c, before, after, beads, singles) {
    const X0 = c.area.x * S, Y0 = c.area.y * S, side = Math.round(c.area.w * S), out = 640, sc = out / side;
    const sub = (list) => ({ px: side, stones: list.filter((s) => s.x > X0 - 40 && s.y > Y0 - 40 && s.x < X0 + side + 40 && s.y < Y0 + side + 40).map((s) => ({ ...s, x: s.x - X0, y: s.y - Y0 })) });
    const bg = resizeRegion(img, c.area, out);
    const panel = (list) => {
      const r = renderMap(sub(list), pal, { style: 'symbols', scale: sc, marginMm: 0, closeMm: 0 }), p = Uint8Array.from(bg.data);
      for (let j = 0; j < out * out; j++) { const a = r.data[j * 4 + 3] / 255; for (let i = 0; i < 3; i++) p[j * 4 + i] = p[j * 4 + i] * (1 - a) + r.data[j * 4 + i] * a; }
      return p;
    };
    const src = Uint8Array.from(bg.data), rect = (b, col) => {
      const k = out / c.area.w, x0 = Math.round((b.x0 - c.area.x) * k), x1 = Math.round((b.x1 - c.area.x) * k), y0 = Math.round((b.y0 - c.area.y) * k), y1 = Math.round((b.y1 - c.area.y) * k);
      const put = (x, y) => { if (x >= 0 && y >= 0 && x < out && y < out) src.set(col, (y * out + x) * 4); };
      for (let x = x0; x <= x1; x++) for (const t of [0, 1]) { put(x, y0 + t); put(x, y1 - t); }
      for (let y = y0; y <= y1; y++) for (const t of [0, 1]) { put(x0 + t, y); put(x1 - t, y); }
    };
    for (const x of beads) rect(x.b, [255, 230, 0, 255]);
    for (const s of singles) rect(s.b, [255, 0, 255, 255]);
    const panels = [src, panel(before), panel(after)], W = out * 3 + 8, rgba = new Uint8Array(W * out * 4).fill(255);
    panels.forEach((p, k) => { for (let y = 0; y < out; y++) rgba.set(p.subarray(y * out * 4, (y + 1) * out * 4), (y * W + k * (out + 4)) * 4); });
    const file = path.join(DIR, `${name}-${c.tag}-zoom${SFX}.png`);
    fs.writeFileSync(file, encodePng(W, out, rgba, {}, { compact: true }));
    console.log(`  zoom ${c.tag}: ${file}`);
  }
}
