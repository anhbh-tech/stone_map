import { admin, body, intId, notFound, updateRow } from '@/app/admin/_lib/http';
import { addonPatch } from '@/app/admin/_lib/schemas';
import { db } from '@/lib/db';

type P = { id: string };

export const PATCH = admin<P>(async (req, { id }) => {
  const rid = intId(id);
  if (!updateRow('addons', rid, await body(req, addonPatch))) notFound('Add-on');
  return Response.json(db().prepare('SELECT * FROM addons WHERE id = ?').get(rid));
});

export const DELETE = admin<P>((_req, { id }) => {
  if (!db().prepare('DELETE FROM addons WHERE id = ?').run(intId(id)).changes) notFound('Add-on');
  return new Response(null, { status: 204 });
});
