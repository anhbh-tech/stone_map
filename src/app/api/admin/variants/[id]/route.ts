import { admin, body, HttpError, intId, notFound, updateRow } from '@/app/admin/_lib/http';
import { variantPatch } from '@/app/admin/_lib/schemas';
import { db } from '@/lib/db';

type P = { id: string };
type Row = { id: number; price_cents: number; compare_at_cents: number | null };

export const PATCH = admin<P>(async (req, { id }) => {
  const vid = intId(id);
  const cur = (db().prepare('SELECT * FROM variants WHERE id = ?').get(vid) as Row | undefined) ?? notFound('Variant');
  const patch = await body(req, variantPatch);
  const price = patch.price_cents ?? cur.price_cents;
  const cmp = patch.compare_at_cents !== undefined ? patch.compare_at_cents : cur.compare_at_cents;
  if (cmp != null && cmp <= price)
    throw new HttpError(422, 'invalid', 'Compare-at price must be higher than the price', { compare_at_cents: 'Must be higher than the price' });
  updateRow('variants', vid, patch);
  return Response.json(db().prepare('SELECT * FROM variants WHERE id = ?').get(vid));
});

export const DELETE = admin<P>((_req, { id }) => {
  if (!db().prepare('DELETE FROM variants WHERE id = ?').run(intId(id)).changes) notFound('Variant');
  return new Response(null, { status: 204 });
});
