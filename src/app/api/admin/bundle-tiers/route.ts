import { admin, body, insertRow } from '@/app/admin/_lib/http';
import { listTiers } from '@/app/admin/_lib/repo';
import { tierCreate } from '@/app/admin/_lib/schemas';
import { db } from '@/lib/db';

export const GET = admin(() => Response.json({ items: listTiers() }));

export const POST = admin(async (req) => {
  const id = insertRow('bundle_tiers', await body(req, tierCreate));
  return Response.json(db().prepare('SELECT * FROM bundle_tiers WHERE id = ?').get(id), { status: 201 });
});
