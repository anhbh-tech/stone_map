// Adapter: sản phẩm thật trong bảng `stones` của kit/db/kit.sqlite → stonemap-design/1 (1 layer).
//   importProduct(product, { file, layer = 'bg', cat }) → design, với expected = BOM (bảng bom) để QC so tổng.
//   Ký hiệu giữ nguyên như sản phẩm thật (kể cả chỗ phạm luật, vd Snowman L26 = '2'): QC phải thấy được.
//   mm làm tròn 1e-4 (0.1 µm) để design → svg → design so khớp tuyệt đối.
import { createRequire } from 'node:module';
import { DB_FILE, loadCatalog } from './catalog.js';
import { newDesign } from './design.js';

const r4 = (v) => Math.round(Number(v) * 1e4) / 1e4;

export function listProducts(file = DB_FILE) {
  return withDb(file, (db) => db.prepare('SELECT id, kind, compliant, canvas_mm, n_stones, n_codes FROM products ORDER BY id').all());
}

export function importProduct(product, { file = DB_FILE, layer = 'bg', cat = loadCatalog(file) } = {}) {
  return withDb(file, (db) => {
    const p = db.prepare('SELECT * FROM products WHERE id = ?').get(product);
    if (!p) throw new Error(`không có sản phẩm ${product} trong ${file}`);
    const d = newDesign({ id: `db:${product}`, w_mm: Number(p.canvas_mm), h_mm: Number(p.canvas_mm), catalogVersion: cat.version, layers: [layer] });
    const rows = db.prepare('SELECT position_id, code, symbol, shape, x_mm, y_mm, physical_mm, reference_mm, rotation_deg FROM stones WHERE product = ? ORDER BY position_id').all(product);
    d.layers[0].stones = rows.map((r) => ({
      id: r.position_id, layer, code: r.code, shape: r.shape || 'round',
      x_mm: r4(r.x_mm), y_mm: r4(r.y_mm), phys_mm: r4(r.physical_mm), ref_mm: r4(r.reference_mm), rot_deg: r4(r.rotation_deg || 0),
      locked: true, source: `db:${product}`,
    }));
    for (const r of rows) d.symbols[r.code] ??= String(r.symbol);
    const bom = db.prepare('SELECT code, count FROM bom WHERE product = ?').all(product);
    d.expected = { total: Number(p.n_stones), byCode: Object.fromEntries(bom.map((b) => [b.code, Number(b.count)])) };
    d.meta = { product, kind: p.kind, compliant: !!Number(p.compliant), svg: p.svg };
    return d;
  });
}

function withDb(file, fn) {
  const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite');
  const db = new DatabaseSync(file, { readOnly: true });
  try { return fn(db); } finally { db.close(); }
}
