import { admin, body, HttpError, intId, notFound, updateRow } from '@/app/admin/_lib/http';
import { getProduct } from '@/app/admin/_lib/repo';
import { productPatch } from '@/app/admin/_lib/schemas';
import { db } from '@/lib/db';

type P = { id: string };

export const GET = admin<P>((_req, { id }) => Response.json(getProduct(intId(id)) ?? notFound('Product')));

export const PATCH = admin<P>(async (req, { id }) => {
  const pid = intId(id);
  const current = getProduct(pid) ?? notFound('Product');
  const patch = await body(req, productPatch);
  const next = { ...current, ...patch };
  // Bán được (#9): phải có meta description viết tay, ít nhất 1 ảnh (alt bắt buộc ở DB) và 1 variant.
  if (next.status === 'active') {
    const missing: Record<string, string> = {};
    if (!next.meta_description) missing.meta_description = 'Required before the product can be active';
    if (!current.images.length) missing.images = 'Add at least one image with alt text first';
    if (!current.variants.length) missing.variants = 'Add at least one size first';
    if (Object.keys(missing).length) throw new HttpError(422, 'not_publishable', Object.values(missing).join('; '), missing);
  }
  updateRow('products', pid, patch);
  return Response.json(getProduct(pid));
});

export const DELETE = admin<P>((_req, { id }) => {
  const pid = intId(id);
  // Đã có đơn / design → không xoá, chỉ archive (giữ lịch sử).
  const used = db().prepare('SELECT 1 FROM designs WHERE product_id = ? LIMIT 1').get(pid);
  if (used) throw new HttpError(409, 'in_use', 'Product has designs or orders; archive it instead');
  if (!db().prepare('DELETE FROM products WHERE id = ?').run(pid).changes) notFound('Product');
  return new Response(null, { status: 204 });
});
