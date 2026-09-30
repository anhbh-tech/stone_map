import { admin, body, HttpError, intId, notFound } from '@/app/admin/_lib/http';
import { collectionProducts, getCollection } from '@/app/admin/_lib/collections';
import { collectionProducts as schema } from '@/app/admin/_lib/schemas';
import { collectionsReady } from '@/app/admin/_lib/schema-info';
import { db, tx } from '@/lib/db';

type P = { id: string };

// PUT { product_ids: [...] } → thay toàn bộ danh sách sản phẩm; thứ tự trong mảng = position.
export const PUT = admin<P>(async (req, { id }) => {
  if (!collectionsReady()) throw new HttpError(503, 'collections_unavailable', 'Collections are not set up in this database yet');
  const cid = intId(id);
  if (!getCollection(cid)) notFound('Collection');
  const { product_ids } = await body(req, schema);
  const ids = [...new Set(product_ids)];
  tx(() => {
    db().prepare('DELETE FROM product_collections WHERE collection_id = ?').run(cid);
    const ins = db().prepare('INSERT INTO product_collections (product_id, collection_id, position) VALUES (?, ?, ?)');
    ids.forEach((pid, i) => ins.run(pid, cid, i));
  });
  return Response.json({ products: collectionProducts(cid).filter((p) => p.member) });
});
