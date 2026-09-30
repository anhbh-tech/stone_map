import { admin, body, HttpError, intId, notFound, updateRow } from '@/app/admin/_lib/http';
import { collectionProducts, getCollection } from '@/app/admin/_lib/collections';
import { collectionPatch } from '@/app/admin/_lib/schemas';
import { collectionsReady } from '@/app/admin/_lib/schema-info';
import { db } from '@/lib/db';

type P = { id: string };
const ready = () => { if (!collectionsReady()) throw new HttpError(503, 'collections_unavailable', 'Collections are not set up in this database yet'); };

export const GET = admin<P>((_req, { id }) => {
  ready();
  const c = getCollection(intId(id)) ?? notFound('Collection');
  return Response.json({ ...c, products: collectionProducts(c.id).filter((p) => p.member) });
});

export const PATCH = admin<P>(async (req, { id }) => {
  ready();
  const cid = intId(id);
  if (!updateRow('collections', cid, await body(req, collectionPatch))) notFound('Collection');
  return Response.json(getCollection(cid));
});

// product_collections ON DELETE CASCADE → xoá collection không xoá sản phẩm.
export const DELETE = admin<P>((_req, { id }) => {
  ready();
  if (!Number(db().prepare('DELETE FROM collections WHERE id = ?').run(intId(id)).changes)) notFound('Collection');
  return new Response(null, { status: 204 });
});
