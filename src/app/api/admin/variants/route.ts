import { admin, body, HttpError, insertRow } from '@/app/admin/_lib/http';
import { variantCreate } from '@/app/admin/_lib/schemas';
import { db } from '@/lib/db';

export const POST = admin(async (req) => {
  const input = await body(req, variantCreate);
  if (input.compare_at_cents != null && input.compare_at_cents <= input.price_cents)
    throw new HttpError(422, 'invalid', 'Compare-at price must be higher than the price', { compare_at_cents: 'Must be higher than the price' });
  const id = insertRow('variants', input);
  return Response.json(db().prepare('SELECT * FROM variants WHERE id = ?').get(id), { status: 201 });
});
