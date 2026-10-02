// KIT-8: catalog đá thật + luật sản xuất, đọc từ kit/db/kit.sqlite (docs/KIT-DB.md, docs/KIT-DATA.md). Không gọi API.
//   loadCatalog(file?) → { codes: { code: entry }, shaped: { code: entry }, sizes, sizeMap, rules }   (mã catalog active; codes = tròn,
//     shaped = KIT-14 viên to không tròn: tim X, marquise M, giọt S/M — entry thêm shape, physW/physH, refW/refH; physMm/refMm = cạnh dài)
//   entryOf(code, cat) = codes[code] || shaped[code]
//     entry = { code, kind: 'stone' | 'pearl', series, family, name, physMm, refMm, fill (= catalog_hex), edge, text, fontPx }
//   refOf / physOf: cỡ vật lý ⇄ cỡ vẽ trong SVG (size_map; không có dòng → vật lý − 0.8, như luật DERIVED)
//   groupOf(code, physMm) = data-group 'K_<code>_S<vật lý>'
//   assignSymbols(counts, cat, fixed?) → { code: ký hiệu } theo từng thiết kế: đá = 1 CHỮ IN HOA, ngọc trai = số = cỡ, không trùng
//   checkDesign(doc, cat?) → { ok, errors, warnings } cho 1 bản đồ dạng chuẩn svgio (readKitSvg / normalizeDoc)
// Va chạm / độ phủ tính bằng cỡ VẬT LÝ; SVG vẽ cỡ reference (data-width-mm), nhóm theo vật lý.
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { isShaped, gapMm } from './shapes.js';

export const DB_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'kit', 'db', 'kit.sqlite');
export const REF_GAP = 0.8; // luật DERIVED của size_map: reference = vật lý − 0.8
export const OVERLAP_TOL = 0.05; // mm; sản phẩm thật: khe < −0.05 mm mới tính là chồng (docs/KIT-DATA.md §1)
// Chữ cho đá: bỏ I và O (dễ nhầm với số 1 / 0 của ngọc trai) và mọi chữ trùng tiền tố series catalog (L Z W D Q M S X H: 'M' trên
// bản đồ dễ đọc nhầm là marquise) → 15 chữ = 15 mã tối đa.
export const LETTERS = 'ABCEFGJKNPRTUVY';

const num = (v) => (v === '' || v == null ? NaN : Number(v));
const hex2 = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const toHex = (c) => '#' + c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('').toUpperCase();
const r6 = (v) => Math.round(v * 1e6) / 1e6;
// Như svgio: viền = fill·0.42, chữ #111111 trên nền sáng; cỡ chữ theo cỡ vẽ (mẫu 2.2 → 25, 3.2 → 35, 4.2 → 47, 5.2 → 60, 7.2 → 79 px).
const SIZE_FONT = { 2.2: 25, 3.2: 35, 4.2: 47, 5.2: 60, 7.2: 79 };
const edgeOf = (h) => toHex(hex2(h).map((v) => v * 0.42));
const textOf = (h) => { const [r, g, b] = hex2(h); return 0.299 * r + 0.587 * g + 0.114 * b > 145 ? '#111111' : '#FFFFFF'; };

const cache = new Map();
export function loadCatalog(file = DB_FILE) {
  if (cache.has(file)) return cache.get(file);
  const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite');
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const sizeMap = db.prepare('SELECT physical_mm, reference_mm, status FROM size_map ORDER BY physical_mm').all()
      .map((r) => ({ physMm: Number(r.physical_mm), refMm: Number(r.reference_mm), status: r.status }));
    const rules = {};
    for (const r of db.prepare('SELECT key, value FROM rules').all()) { try { rules[r.key] = JSON.parse(r.value); } catch { rules[r.key] = r.value; } }
    const codes = {};
    for (const r of db.prepare("SELECT * FROM catalog WHERE geometry_type = 'round' AND active = 'True'").all()) {
      const physMm = num(r.physical_diameter_mm), fill = String(r.color_hex_reference || '').toUpperCase();
      if (!(physMm > 0) || !/^#[0-9A-F]{6}$/.test(fill)) continue;
      const ref = num(r.reference_diameter_mm);
      codes[r.stone_code] = {
        code: r.stone_code, kind: r.series === 'PEARL' ? 'pearl' : 'stone', series: r.series, family: r.color_family, name: r.catalog_color_name,
        physMm, refMm: ref > 0 ? ref : refFrom(sizeMap, physMm), fill, edge: edgeOf(fill), text: textOf(fill),
      };
      codes[r.stone_code].fontPx = SIZE_FONT[codes[r.stone_code].refMm] ?? Math.round(codes[r.stone_code].refMm * 11.81 * 0.96);
    }
    const shaped = {};
    const SHAPE = { heart: 'heart', marquise: 'marquise', teardrop: 'teardrop' };
    for (const r of db.prepare("SELECT * FROM catalog WHERE geometry_type IN ('heart', 'marquise', 'teardrop') AND active = 'True'").all()) {
      const pw = num(r.physical_width_mm), ph = num(r.physical_height_mm), rw = num(r.reference_width_mm), rh = num(r.reference_height_mm), fill = String(r.color_hex_reference || '').toUpperCase();
      if (!(pw > 0 && ph > 0) || !/^#[0-9A-F]{6}$/.test(fill)) continue;
      const refW = rw > 0 ? r6(rw) : r6(pw - REF_GAP), refH = rh > 0 ? r6(rh) : r6(ph - REF_GAP);
      shaped[r.stone_code] = { code: r.stone_code, kind: 'stone', shape: SHAPE[r.geometry_type], series: r.series, family: r.color_family, name: r.catalog_color_name,
        physW: pw, physH: ph, physMm: Math.max(pw, ph), refW, refH, refMm: Math.max(refW, refH), fill, edge: edgeOf(fill), text: textOf(fill), fontPx: Math.round(Math.min(refW, refH) * 11.81 * 0.7) };
    }
    const sizes = [...new Set(Object.values(codes).map((e) => e.physMm))].sort((a, b) => a - b);
    const cat = {
      codes, shaped, sizes, sizeMap,
      rules: { maxCodesTarget: Number(rules.max_codes_target) || 13, maxCodesHard: Number(rules.max_codes_hard) || 15, text: rules.source_text || '' },
    };
    cache.set(file, cat);
    return cat;
  } finally { db.close(); }
}

function refFrom(sizeMap, physMm) { return sizeMap.find((m) => Math.abs(m.physMm - physMm) < 1e-6)?.refMm ?? r6(physMm - REF_GAP); }
export const refOf = (physMm, cat = loadCatalog()) => refFrom(cat.sizeMap, physMm);
export function physOf(refMm, cat = loadCatalog()) {
  const m = cat.sizeMap.find((q) => Math.abs(q.refMm - refMm) < 1e-6) || Object.values(cat.codes).find((e) => Math.abs(e.refMm - refMm) < 1e-6);
  return m ? m.physMm : r6(refMm + REF_GAP);
}
export const groupOf = (code, physMm) => `K_${code}_S${r6(physMm)}`;
export const entryOf = (code, cat = loadCatalog()) => cat.codes[code] || cat.shaped?.[code];
// data-group viên không tròn: K_<mã>_S<rộng>x<dài> (vật lý)
export const groupOfEntry = (e) => (e.shape ? `K_${e.code}_S${r6(e.physW)}x${r6(e.physH)}` : groupOf(e.code, e.physMm));

// counts: Map | [[code, n]] | { code: n }. Đá nhiều viên nhận chữ trước (A = mã nhiều nhất). fixed = ký hiệu đã chốt
// (vd từ vùng khác của cùng thiết kế) được giữ nếu hợp luật. Ngọc trai luôn là số = cỡ.
export function assignSymbols(counts, cat = loadCatalog(), fixed = {}) {
  const list = (counts instanceof Map ? [...counts] : Array.isArray(counts) ? counts : Object.entries(counts))
    .sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]), 'en', { numeric: true }));
  const out = {}, used = new Set();
  for (const [code] of list) {
    const e = entryOf(code, cat);
    if (!e) throw new Error(`mã ${code} không có trong catalog`);
    if (e.kind === 'pearl') { out[code] = String(r6(e.physMm)); used.add(out[code]); }
  }
  for (const [code, sym] of Object.entries(fixed)) {
    const e = entryOf(code, cat);
    if (e?.kind === 'stone' && LETTERS.includes(sym) && sym.length === 1 && !used.has(sym) && list.some(([c]) => c === code)) { out[code] = sym; used.add(sym); }
  }
  for (const [code] of list) {
    if (out[code]) continue;
    const sym = [...LETTERS].find((c) => !used.has(c));
    if (!sym) throw new Error(`hết chữ ký hiệu (${list.length} mã)`);
    out[code] = sym; used.add(sym);
  }
  return out;
}

// Luật sản xuất trên 1 bản đồ dạng chuẩn svgio: mã trong catalog + tròn; ≤ maxCodesHard mã (> target = cảnh báo);
// ký hiệu đá = 1 chữ in hoa, ngọc trai = số = cỡ, không trùng; data-group = K_<mã>_S<vật lý>; cỡ vẽ = reference;
// màu tô = catalog_hex; không 2 viên chồng nhau theo cỡ vật lý (khe < −OVERLAP_TOL).
export function checkDesign(doc, cat = loadCatalog()) {
  const errors = [], warnings = [], err = (m) => { if (errors.length < 50) errors.push(m); };
  const pal = new Map(doc.palette.map((p) => [p.code, p])), codes = [...new Set(doc.stones.map((s) => s.code))];
  if (codes.length > cat.rules.maxCodesHard) err(`${codes.length} mã > tối đa ${cat.rules.maxCodesHard}`);
  else if (codes.length > cat.rules.maxCodesTarget) warnings.push(`${codes.length} mã > mục tiêu ${cat.rules.maxCodesTarget}`);
  const bySym = new Map();
  for (const code of codes) {
    const e = entryOf(code, cat), p = pal.get(code);
    if (!e) { err(`mã ${code} không có trong catalog (hoặc hình chưa hỗ trợ)`); continue; }
    const sym = p?.symbol;
    if (e.kind === 'pearl' ? sym !== String(r6(e.physMm)) : !(sym?.length === 1 && LETTERS.includes(sym))) err(`mã ${code} (${e.kind}) ký hiệu "${sym}" sai luật`);
    if (bySym.has(sym)) err(`ký hiệu "${sym}" trùng: ${bySym.get(sym)} và ${code}`);
    bySym.set(sym, code);
    if (p && p.rgb.toUpperCase() !== e.fill) err(`mã ${code} màu ${p.rgb} ≠ catalog ${e.fill}`);
    if (p && Math.abs(p.dMm - e.refMm) > 1e-6) err(`mã ${code} palette cỡ ${p.dMm} ≠ reference ${e.refMm}`);
  }
  const k = doc.canvas.pxPerMm, phys = (s) => entryOf(s.code, cat)?.physMm ?? physOf(s.dMm, cat);
  for (const s of doc.stones) {
    const e = entryOf(s.code, cat);
    if (!e) continue;
    if (s.symbol !== pal.get(s.code)?.symbol) err(`${s.id}: ký hiệu ${s.symbol} ≠ bảng (${pal.get(s.code)?.symbol})`);
    if (Math.abs(s.dMm - e.refMm) > 1e-6) err(`${s.id}: cỡ vẽ ${s.dMm} ≠ reference ${e.refMm} của ${s.code}`);
    if (e.shape && (s.shape !== e.shape || Math.abs(s.wMm - e.refW) > 1e-6 || Math.abs(s.hMm - e.refH) > 1e-6)) err(`${s.id}: hình ${s.shape} ${s.wMm}×${s.hMm} ≠ ${e.shape} ${e.refW}×${e.refH} của ${s.code}`);
    if (!e.shape && isShaped(s)) err(`${s.id}: mã tròn ${s.code} vẽ hình ${s.shape}`);
    if (s.group !== groupOfEntry(e)) err(`${s.id}: data-group ${s.group} ≠ ${groupOfEntry(e)}`);
  }
  // khe theo cỡ vật lý; viên có hình: đa giác (lib/kit/shapes.js) theo góc xoay
  const geo = (s) => { const e = entryOf(s.code, cat); return e?.shape ? { x: s.x, y: s.y, shape: e.shape, w: e.physW, h: e.physH, rot: s.rot } : { x: s.x, y: s.y, w: phys(s), h: phys(s) }; };
  // chồng viên (vật lý): lưới băm theo cỡ lớn nhất
  const S = doc.stones, big = Math.max(0, ...S.map(phys)) * k, cell = Math.max(1, big), grid = new Map();
  const key = (x, y) => `${Math.floor(x / cell)},${Math.floor(y / cell)}`;
  let overlaps = 0;
  S.forEach((s, i) => { const kk = key(s.x, s.y); if (!grid.has(kk)) grid.set(kk, []); grid.get(kk).push(i); });
  S.forEach((s, i) => {
    const gx = Math.floor(s.x / cell), gy = Math.floor(s.y / cell), ps = phys(s);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) for (const j of grid.get(`${gx + dx},${gy + dy}`) || []) {
      if (j <= i) continue;
      const t = S[j], gap = Math.hypot(s.x - t.x, s.y - t.y) / k - (ps + phys(t)) / 2;
      if (gap < -OVERLAP_TOL && (entryOf(s.code, cat)?.shape || entryOf(t.code, cat)?.shape) && gapMm(geo(s), geo(t), k) >= -OVERLAP_TOL) continue;
      if (gap < -OVERLAP_TOL) { overlaps++; if (overlaps <= 5) err(`${s.id} chồng ${t.id} (khe ${gap.toFixed(3)} mm)`); }
    }
  });
  if (overlaps > 5) err(`… tổng ${overlaps} cặp chồng`);
  return { ok: !errors.length, errors, warnings, codes: codes.length, overlaps };
}
