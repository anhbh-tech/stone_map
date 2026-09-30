import { admin, body, HttpError, insertRow } from '@/app/admin/_lib/http';
import { listReviewsAdmin } from '@/app/admin/_lib/repo';
import { REVIEW_STATUSES, reviewCreate } from '@/app/admin/_lib/schemas';
import { db } from '@/lib/db';

export const GET = admin((req) => {
  const s = new URL(req.url).searchParams.get('status');
  return Response.json({ reviews: listReviewsAdmin(s && (REVIEW_STATUSES as readonly string[]).includes(s) ? s : undefined) });
});

// Review thêm tay (ví dụ khách gửi qua email) luôn là review thật: is_sample = 0, không nhận từ body.
export const POST = admin(async (req) => {
  const { order_number, ...input } = await body(req, reviewCreate);
  let order_id: number | null = null;
  if (order_number) {
    const o = db().prepare('SELECT id FROM orders WHERE number = ? OR number = ?').get(order_number, `#${order_number.replace(/^#/, '')}`) as { id: number } | undefined;
    if (!o) throw new HttpError(422, 'invalid', 'No order with that number', { order_number: 'No order with that number' });
    order_id = o.id;
  }
  if (input.product_id != null && !db().prepare('SELECT 1 FROM products WHERE id = ?').get(input.product_id))
    throw new HttpError(422, 'invalid', 'Unknown product', { product_id: 'Unknown product' });
  const id = insertRow('reviews', { ...input, order_id, is_sample: 0 });
  return Response.json(listReviewsAdmin().find((r) => r.id === id), { status: 201 });
});
