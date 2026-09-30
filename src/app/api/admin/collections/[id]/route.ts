import { admin, body, intId, notFound, updateRow } from '@/app/admin/_lib/http';
import { collectionProducts, getCollection } from '@/app/admin/_lib/collections';
import { collectionPatch } from '@/app/admin/_lib/schemas';
import { db } from '@/lib/db';

type P = { id: string };

export const GET = admin<P>((_req, { id }) => {
  const c = getCollection(intId(id)) ?? notFound('Collection');
  return Response.json({ ...c, products: collectionProducts(c.id).filter((p) => p.member) });
});

export const PATCH = admin<P>(async (req, { id }) => {
  const cid = intId(id);
  if (!updateRow('collections', cid, await body(req, collectionPatch))) notFound('Collection');
  return Response.json(getCollection(cid));
});

// product_collections ON DELETE CASCADE → xoá collection không xoá sản phẩm.
export const DELETE = admin<P>((_req, { id }) => {
  if (!Number(db().prepare('DELETE FROM collections WHERE id = ?').run(intId(id)).changes)) notFound('Collection');
  return new Response(null, { status: 204 });
});
