import { admin, body, insertRow } from '@/app/admin/_lib/http';
import { listAddons } from '@/app/admin/_lib/repo';
import { addonCreate } from '@/app/admin/_lib/schemas';
import { db } from '@/lib/db';

export const GET = admin(() => Response.json({ items: listAddons() }));

export const POST = admin(async (req) => {
  const id = insertRow('addons', await body(req, addonCreate));
  return Response.json(db().prepare('SELECT * FROM addons WHERE id = ?').get(id), { status: 201 });
});
