// Collections: bảng collections / product_collections của UI-2 (ui2_001_customers.sql), admin đọc/ghi đúng các cột trong hợp đồng.
import { db } from '../../../lib/db';

export type Collection = { id: number; handle: string; title: string; description: string | null; image: string | null; sort: number };
export type CollectionRow = Collection & { products: number };

export const listCollections = () =>
  db().prepare(`SELECT c.*, (SELECT count(*) FROM product_collections pc WHERE pc.collection_id = c.id) AS products
    FROM collections c ORDER BY c.sort, c.title`).all() as CollectionRow[];

export const getCollection = (id: number) => db().prepare('SELECT * FROM collections WHERE id = ?').get(id) as Collection | undefined;

/** Mọi sản phẩm, đánh dấu cái nào đang thuộc collection (form chọn sản phẩm). */
export const collectionProducts = (id: number) =>
  db().prepare(`SELECT p.id, p.title, p.handle, p.status, pc.position, (pc.product_id IS NOT NULL) AS member
    FROM products p LEFT JOIN product_collections pc ON pc.product_id = p.id AND pc.collection_id = ?
    ORDER BY member DESC, pc.position, p.title`).all(id)
    // Row của node:sqlite có prototype null: chép ra object thường để truyền được vào Client Component.
    .map((r) => ({ ...r })) as { id: number; title: string; handle: string; status: string; position: number | null; member: 0 | 1 }[];

export const collectionsForProduct = (productId: number) =>
  db().prepare(`SELECT c.id, c.title FROM collections c JOIN product_collections pc ON pc.collection_id = c.id WHERE pc.product_id = ? ORDER BY c.sort, c.title`)
    .all(productId) as { id: number; title: string }[];
