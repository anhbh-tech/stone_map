import { admin, body, insertRow } from '@/app/admin/_lib/http';
import { imageCreate } from '@/app/admin/_lib/schemas';
import { db } from '@/lib/db';

export const POST = admin(async (req) => {
  const id = insertRow('product_images', await body(req, imageCreate));
  return Response.json(db().prepare('SELECT * FROM product_images WHERE id = ?').get(id), { status: 201 });
});
