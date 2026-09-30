import { admin, body, intId, notFound, updateRow } from '@/app/admin/_lib/http';
import { imagePatch } from '@/app/admin/_lib/schemas';
import { db } from '@/lib/db';

type P = { id: string };

export const PATCH = admin<P>(async (req, { id }) => {
  const iid = intId(id);
  if (!updateRow('product_images', iid, await body(req, imagePatch))) notFound('Image');
  return Response.json(db().prepare('SELECT * FROM product_images WHERE id = ?').get(iid));
});

export const DELETE = admin<P>((_req, { id }) => {
  if (!db().prepare('DELETE FROM product_images WHERE id = ?').run(intId(id)).changes) notFound('Image');
  return new Response(null, { status: 204 });
});
