// Danh sách sản phẩm cho /collections và /search (UI-2): thẻ sản phẩm, lọc theme / loại / giá, sắp xếp, phân trang, FTS5.
// Giá trên thẻ = giá variant thấp nhất ("From $39.98"), tính từ DB; không số liệu nào gõ tay.
import { db } from './db';

export const PAGE_SIZE = 12;
/** Sản phẩm gắn nhãn "demo" chỉ là dữ liệu seed cho dev: production không liệt kê. */
export const showDemo = () => process.env.NODE_ENV !== 'production';

export type ProductCard = {
  id: number; handle: string; title: string; subtitle: string | null;
  price_cents: number; compare_at_cents: number | null; sizes: number;
  image: { url: string; alt: string } | null;
  demo: boolean; created_at: string;
};
export type Collection = { id: number; handle: string; title: string; description: string | null; image: string | null; sort: number };
export type CollectionSummary = Collection & { count: number; cover: { url: string; alt: string } | null };

export type Sort = 'featured' | 'relevance' | 'price-asc' | 'price-desc' | 'newest' | 'title';
export const COLLECTION_SORTS: { id: Sort; label: string }[] = [
  { id: 'featured', label: 'Featured' }, { id: 'price-asc', label: 'Price: low to high' },
  { id: 'price-desc', label: 'Price: high to low' }, { id: 'newest', label: 'Newest' }, { id: 'title', label: 'Name: A–Z' },
];
export const SEARCH_SORTS: { id: Sort; label: string }[] = [
  { id: 'relevance', label: 'Best match' }, { id: 'price-asc', label: 'Price: low to high' },
  { id: 'price-desc', label: 'Price: high to low' }, { id: 'newest', label: 'Newest' },
];

export const PRICE_BANDS = [
  { id: 'under-50', label: 'Under $50', min: 0, max: 4999 },
  { id: '50-100', label: '$50 – $100', min: 5000, max: 10000 },
  { id: 'over-100', label: 'Over $100', min: 10001, max: Number.MAX_SAFE_INTEGER },
] as const;
export type PriceBand = (typeof PRICE_BANDS)[number]['id'];

// Nhãn hiển thị cho giá trị tag đã biết; tag lạ → "Title Case" từ chính giá trị.
const LABELS: Record<string, string> = {
  'diy-kit': 'DIY pearl kit', canvas: 'Canvas portrait', ornament: 'Ornament',
  christmas: 'Christmas', memorial: 'Memorial', royal: 'Royal', 'starry-night': 'Starry Night', floral: 'Floral', birthday: 'Birthday',
};
export const tagLabel = (v: string) => LABELS[v] ?? v.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

export type Filters = { theme: string[]; type: string[]; price: PriceBand | null };
export type ListQuery = Filters & { sort: Sort; page: number };

const SLUG = /^[a-z0-9][a-z0-9-]{0,40}$/;
const many = (v: string | string[] | undefined) => [...new Set((Array.isArray(v) ? v : v ? [v] : []).flatMap((x) => x.split(',')).filter((x) => SLUG.test(x)))].slice(0, 10);

/** searchParams (đã await) → truy vấn hợp lệ; giá trị lạ bị bỏ qua thay vì lỗi. */
export function parseListQuery(sp: Record<string, string | string[] | undefined>, sorts: { id: Sort }[]): ListQuery {
  const one = (k: string) => (Array.isArray(sp[k]) ? sp[k]![0] : (sp[k] as string | undefined));
  const sort = sorts.find((s) => s.id === one('sort'))?.id ?? sorts[0].id;
  const price = PRICE_BANDS.find((b) => b.id === one('price'))?.id ?? null;
  const page = Math.min(Math.max(1, Math.floor(Number(one('page')) || 1)), 500);
  return { theme: many(sp.theme), type: many(sp.type), price, sort, page };
}

// Cách gọi tắt / thân mật khách hay gõ → từ có trong catalog. Giữ cả từ gốc (OR) để không mất kết quả đang có.
const SYNONYMS: Record<string, string> = { xmas: 'christmas', kitty: 'cat', kitten: 'cat', kitties: 'cat', puppy: 'dog', pup: 'dog', doggy: 'dog' };

/** Chuỗi khách gõ → biểu thức FTS5 an toàn: mỗi từ thành "tu"* (prefix), nối AND; từ đồng nghĩa thành ("tu"* OR "goc"*). Không có từ nào → null. */
export function ftsQuery(q: string): string | null {
  const words = q.toLowerCase().normalize('NFKC').match(/[\p{L}\p{N}]+/gu)?.slice(0, 8) ?? [];
  return words.length ? words.map((w) => (SYNONYMS[w] ? `("${w}"* OR "${SYNONYMS[w]}"*)` : `"${w}"*`)).join(' ') : null;
}

// ── SQL dùng chung
const CARD_SELECT = `
  SELECT p.id, p.handle, p.title, p.subtitle, p.created_at,
    MIN(v.price_cents) AS price_cents,
    (SELECT v2.compare_at_cents FROM variants v2 WHERE v2.product_id = p.id ORDER BY v2.price_cents, v2.position LIMIT 1) AS compare_at_cents,
    COUNT(v.id) AS sizes,
    (SELECT url FROM product_images i WHERE i.product_id = p.id AND i.kind = 'gallery' ORDER BY i.position LIMIT 1) AS image_url,
    (SELECT alt FROM product_images i WHERE i.product_id = p.id AND i.kind = 'gallery' ORDER BY i.position LIMIT 1) AS image_alt,
    EXISTS (SELECT 1 FROM product_tags t WHERE t.product_id = p.id AND t.tag = 'demo') AS demo`;

type CardRow = Omit<ProductCard, 'image' | 'demo'> & { image_url: string | null; image_alt: string | null; demo: number };
const toCard = ({ image_url, image_alt, demo, ...r }: CardRow): ProductCard => ({
  ...r, demo: !!demo, image: image_url ? { url: image_url, alt: image_alt || r.title } : null,
});

function filterSql(f: Filters, args: (string | number)[]) {
  const where = ["p.status = 'active'"];
  if (!showDemo()) where.push("NOT EXISTS (SELECT 1 FROM product_tags t WHERE t.product_id = p.id AND t.tag = 'demo')");
  for (const [prefix, vals] of [['theme', f.theme], ['type', f.type]] as const) {
    if (!vals.length) continue;
    where.push(`EXISTS (SELECT 1 FROM product_tags t WHERE t.product_id = p.id AND t.tag IN (${vals.map(() => '?').join(',')}))`);
    args.push(...vals.map((v) => `${prefix}:${v}`));
  }
  let having = 'COUNT(v.id) > 0';
  const band = PRICE_BANDS.find((b) => b.id === f.price);
  if (band) { having += ' AND MIN(v.price_cents) BETWEEN ? AND ?'; }
  return { where: where.join(' AND '), having, band };
}

// "Featured" và "Best match": sản phẩm thật trước, sản phẩm demo (tag 'demo') chỉ lấp chỗ trống phía sau.
const ORDER: Record<Sort, string> = {
  featured: 'demo, featured_pos, p.id', relevance: 'demo, rank, p.id',
  'price-asc': 'price_cents, p.id', 'price-desc': 'price_cents DESC, p.id',
  newest: 'p.created_at DESC, p.id DESC', title: 'p.title COLLATE NOCASE, p.id',
};

export type ListResult = { items: ProductCard[]; total: number; page: number; pages: number };

/**
 * Một trang sản phẩm. scope: collection (id, null = mọi sản phẩm) hoặc tìm kiếm FTS.
 * Sort "featured" = position trong collection; "relevance" = bm25 (tiêu đề nặng nhất).
 */
export function listProducts(scope: { collectionId: number | null } | { fts: string }, q: ListQuery, pageSize = PAGE_SIZE): ListResult {
  // Thứ tự placeholder: FROM (fts / collection) → WHERE (bộ lọc tag) → HAVING (khoảng giá).
  const fromArgs: (string | number)[] = [];
  let from = 'products p';
  let extra = '0 AS featured_pos, 0 AS rank';
  if ('fts' in scope) {
    // bm25 phải chạy trực tiếp trên bảng FTS, không trong truy vấn GROUP BY → subquery; LIMIT -1 chặn SQLite gộp (flatten) nó vào truy vấn ngoài.
    from = `(SELECT rowid AS id, bm25(products_fts, 10.0, 1.0, 5.0, 4.0) AS rank FROM products_fts WHERE products_fts MATCH ? LIMIT -1) f
      JOIN products p ON p.id = f.id`;
    extra = '0 AS featured_pos, f.rank AS rank';
    fromArgs.push(scope.fts);
  } else if (scope.collectionId != null) {
    from = 'product_collections pc JOIN products p ON p.id = pc.product_id AND pc.collection_id = ?';
    extra = 'pc.position AS featured_pos, 0 AS rank';
    fromArgs.push(scope.collectionId);
  }
  const whereArgs: (string | number)[] = [];
  const { where, having, band } = filterSql(q, whereArgs);
  const base = `${CARD_SELECT}, ${extra}
    FROM ${from} LEFT JOIN variants v ON v.product_id = p.id
    WHERE ${where}
    GROUP BY p.id HAVING ${having}`;
  const all = [...fromArgs, ...whereArgs, ...(band ? [band.min, band.max] : [])];
  const d = db();
  const { n } = d.prepare(`SELECT count(*) AS n FROM (${base})`).get(...all) as { n: number };
  const pages = Math.max(1, Math.ceil(n / pageSize));
  const page = Math.min(q.page, pages);
  const rows = d.prepare(`${base} ORDER BY ${ORDER[q.sort]} LIMIT ? OFFSET ?`).all(...all, pageSize, (page - 1) * pageSize) as CardRow[];
  return { items: rows.map(toCard), total: n, page, pages };
}

export type Facet = { value: string; label: string; count: number };

/** Giá trị theme / loại có trong phạm vi (không tính bộ lọc đang chọn), kèm số sản phẩm. */
export function facets(scope: { collectionId: number | null } | { fts: string }): { theme: Facet[]; type: Facet[] } {
  const args: (string | number)[] = [];
  let join = '';
  if ('fts' in scope) { join = 'JOIN (SELECT rowid AS id FROM products_fts WHERE products_fts MATCH ?) f ON f.id = p.id'; args.push(scope.fts); }
  else if (scope.collectionId != null) { join = 'JOIN product_collections pc ON pc.product_id = p.id AND pc.collection_id = ?'; args.push(scope.collectionId); }
  const demo = showDemo() ? '' : "AND NOT EXISTS (SELECT 1 FROM product_tags t2 WHERE t2.product_id = p.id AND t2.tag = 'demo')";
  const rows = db().prepare(`SELECT t.tag, count(DISTINCT p.id) AS n FROM products p ${join} JOIN product_tags t ON t.product_id = p.id
    WHERE p.status = 'active' AND (t.tag LIKE 'theme:%' OR t.tag LIKE 'type:%') ${demo} GROUP BY t.tag ORDER BY t.tag`).all(...args) as { tag: string; n: number }[];
  const pick = (prefix: string) => rows.filter((r) => r.tag.startsWith(prefix)).map((r) => {
    const value = r.tag.slice(prefix.length);
    return { value, label: tagLabel(value), count: r.n };
  });
  return { theme: pick('theme:'), type: pick('type:') };
}

// ── Collections

export const getCollection = (handle: string) =>
  (db().prepare('SELECT * FROM collections WHERE handle = ?').get(handle) as Collection | undefined) ?? null;

/** Collection ảo "all" (như Shopify /collections/all): mọi sản phẩm đang bán. */
export const ALL_COLLECTION: Collection = { id: 0, handle: 'all', title: 'All products', description: 'Every portrait, kit and keepsake in the shop.', image: null, sort: -1 };

export function listCollections(): CollectionSummary[] {
  const demo = showDemo() ? '' : "AND NOT EXISTS (SELECT 1 FROM product_tags t WHERE t.product_id = p.id AND t.tag = 'demo')";
  const rows = db().prepare(`SELECT c.*,
      (SELECT count(*) FROM product_collections pc JOIN products p ON p.id = pc.product_id WHERE pc.collection_id = c.id AND p.status = 'active' ${demo}) AS count,
      (SELECT i.url FROM product_collections pc JOIN product_images i ON i.product_id = pc.product_id AND i.kind = 'gallery'
        WHERE pc.collection_id = c.id ORDER BY pc.position, i.position LIMIT 1) AS cover_url,
      (SELECT i.alt FROM product_collections pc JOIN product_images i ON i.product_id = pc.product_id AND i.kind = 'gallery'
        WHERE pc.collection_id = c.id ORDER BY pc.position, i.position LIMIT 1) AS cover_alt
    FROM collections c ORDER BY c.sort, c.title`).all() as (Collection & { count: number; cover_url: string | null; cover_alt: string | null })[];
  return rows.map(({ cover_url, cover_alt, ...c }) => ({
    ...c,
    // Ảnh riêng của collection thắng; không có → ảnh sản phẩm đầu tiên trong collection.
    cover: c.image ? { url: c.image, alt: c.title } : cover_url ? { url: cover_url, alt: cover_alt || c.title } : null,
  }));
}

// ── Gợi ý khi gõ: hợp đồng GET /api/search/suggest → { items: { handle, title, image }[] }
export type Suggestion = { handle: string; title: string; image: string | null };

export function suggest(q: string, limit = 6): Suggestion[] {
  const fts = ftsQuery(q);
  if (!fts) return [];
  return listProducts({ fts }, { theme: [], type: [], price: null, sort: 'relevance', page: 1 }, limit)
    .items.map((p) => ({ handle: p.handle, title: p.title, image: p.image?.url ?? null }));
}
