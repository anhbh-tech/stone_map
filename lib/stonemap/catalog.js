// STONEMAP catalog: bọc kit/db/kit.sqlite (docs/KIT-DB.md). Mọi shape/size (không chỉ tròn), có version.
//   loadCatalog(file?) → { version, file, codes: { code: entry }, sizeMap, rules, skipped }
//     version = 'cat-' + sha1(nội dung bảng catalog, sắp theo stone_code)[:12]; design ghim version này (design.catalogVersion)
//     entry = { code, series, kind: 'stone'|'pearl', shape, name, family, active, fill, physW, physH, physMm (cạnh dài), refW, refH, refMm }
//   refOf(physMm, cat): cỡ vẽ của đá tròn theo size_map (không có dòng → vật lý − 0.8)
//   assignSymbols(counts, cat, fixed?): đá = 1 chữ trong STONE_LETTERS (bỏ chữ đầu series L Z W D Q M S X H và I O),
//     nhiều viên nhận chữ trước; ngọc trai = số = cỡ (vd '5', '10'); duy nhất trong design.
import crypto from 'node:crypto';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

export const DB_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'kit', 'db', 'kit.sqlite');
export const STONE_LETTERS = 'ABCEFGJKNPRTUVY';
export const SERIES_LETTERS = 'LZWDQMSXH';
export const REF_GAP = 0.8;
export const SHAPES = ['round', 'marquise', 'teardrop', 'heart', 'star', 'flower', 'rose'];

const num = (v) => (v === '' || v == null ? NaN : Number(v));
const r6 = (v) => Math.round(v * 1e6) / 1e6;
const cache = new Map();

export function loadCatalog(file = DB_FILE) {
  if (cache.has(file)) return cache.get(file);
  const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite');
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const rows = db.prepare('SELECT * FROM catalog ORDER BY stone_code').all();
    const version = `cat-${crypto.createHash('sha1').update(JSON.stringify(rows)).digest('hex').slice(0, 12)}`;
    const sizeMap = db.prepare('SELECT physical_mm, reference_mm, status FROM size_map ORDER BY physical_mm').all()
      .map((r) => ({ physMm: Number(r.physical_mm), refMm: Number(r.reference_mm), status: r.status }));
    const raw = Object.fromEntries(db.prepare('SELECT key, value FROM rules').all().map((r) => { try { return [r.key, JSON.parse(r.value)]; } catch { return [r.key, r.value]; } }));
    const codes = {}, skipped = [];
    for (const r of rows) {
      const shape = SHAPES.includes(r.geometry_type) ? r.geometry_type : null, pd = num(r.physical_diameter_mm);
      const physW = shape === 'round' ? pd : num(r.physical_width_mm) || pd, physH = shape === 'round' ? pd : num(r.physical_height_mm) || pd;
      if (!shape || !(physW > 0) || !(physH > 0)) { skipped.push(r.stone_code); continue; }
      const rd = num(r.reference_diameter_mm);
      const refW = shape === 'round' ? (rd > 0 ? rd : refFrom(sizeMap, pd)) : num(r.reference_width_mm) || r6(physW - REF_GAP);
      const refH = shape === 'round' ? refW : num(r.reference_height_mm) || r6(physH - REF_GAP);
      const fill = String(r.color_hex_reference || '').toUpperCase();
      codes[r.stone_code] = {
        code: r.stone_code, series: r.series, kind: r.series === 'PEARL' ? 'pearl' : 'stone', shape, name: r.catalog_color_name, family: r.color_family,
        active: r.active === 'True', fill: /^#[0-9A-F]{6}$/.test(fill) ? fill : null,
        physW, physH, physMm: Math.max(physW, physH), refW, refH, refMm: Math.max(refW, refH),
      };
    }
    const cat = { version, file, codes, sizeMap, skipped,
      rules: { maxCodesTarget: Number(raw.max_codes_target) || 13, maxCodesHard: Number(raw.max_codes_hard) || 15 } };
    cache.set(file, cat);
    return cat;
  } finally { db.close(); }
}

function refFrom(sizeMap, physMm) { return sizeMap.find((m) => Math.abs(m.physMm - physMm) < 1e-6)?.refMm ?? r6(physMm - REF_GAP); }
export const refOf = (physMm, cat = loadCatalog()) => refFrom(cat.sizeMap, physMm);
export const pearlSymbol = (e) => String(r6(e.physMm));

// counts: Map | [[code, n]] | { code: n }. fixed = ký hiệu đã chốt (giữ nếu hợp luật và chưa bị dùng).
// overflow: hết 15 chữ thì mã đá ít viên nhất nhận 2 chữ ('AA', 'AB'…) thay vì báo lỗi (QC symbols sẽ báo error).
export function assignSymbols(counts, cat = loadCatalog(), fixed = {}, { overflow = false } = {}) {
  const list = (counts instanceof Map ? [...counts] : Array.isArray(counts) ? counts : Object.entries(counts))
    .sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]), 'en', { numeric: true }));
  const out = {}, used = new Set();
  for (const [code] of list) {
    const e = cat.codes[code];
    if (!e) throw new Error(`mã ${code} không có trong catalog ${cat.version}`);
    if (e.kind === 'pearl') {
      const s = pearlSymbol(e);
      if (used.has(s)) throw new Error(`2 mã ngọc trai cùng cỡ ${s} mm`);
      out[code] = s; used.add(s);
    }
  }
  for (const [code, sym] of Object.entries(fixed)) {
    if (cat.codes[code]?.kind === 'stone' && STONE_LETTERS.includes(sym) && sym.length === 1 && !used.has(sym) && list.some(([c]) => c === code)) { out[code] = sym; used.add(sym); }
  }
  for (const [code] of list) {
    if (out[code]) continue;
    const sym = [...STONE_LETTERS].find((c) => !used.has(c)) ?? (overflow ? [...STONE_LETTERS].flatMap((a) => [...STONE_LETTERS].map((b) => a + b)).find((c) => !used.has(c)) : null);
    if (!sym) throw new Error(`hết chữ ký hiệu (${STONE_LETTERS.length} chữ cho đá)`);
    out[code] = sym; used.add(sym);
  }
  return out;
}
