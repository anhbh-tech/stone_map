import { admin, body, intId, notFound, updateRow } from '@/app/admin/_lib/http';
import { tierPatch } from '@/app/admin/_lib/schemas';
import { db } from '@/lib/db';

type P = { id: string };

export const PATCH = admin<P>(async (req, { id }) => {
  const rid = intId(id);
  if (!updateRow('bundle_tiers', rid, await body(req, tierPatch))) notFound('Tier');
  return Response.json(db().prepare('SELECT * FROM bundle_tiers WHERE id = ?').get(rid));
});

export const DELETE = admin<P>((_req, { id }) => {
  if (!db().prepare('DELETE FROM bundle_tiers WHERE id = ?').run(intId(id)).changes) notFound('Tier');
  return new Response(null, { status: 204 });
});
