import { admin, body, intId, notFound, updateRow } from '@/app/admin/_lib/http';
import { getDiscount } from '@/app/admin/_lib/discounts';
import { discountPatch } from '@/app/admin/_lib/schemas';
import { db } from '@/lib/db';

type P = { id: string };

export const GET = admin<P>((_req, { id }) => Response.json(getDiscount(intId(id)) ?? notFound('Discount')));

// Mã (code) không đổi được sau khi tạo: đơn cũ tham chiếu theo code.
export const PATCH = admin<P>(async (req, { id }) => {
  const did = intId(id);
  const p = await body(req, discountPatch);
  const patch: Record<string, unknown> = { ...p };
  if (p.starts_at !== undefined) patch.starts_at = p.starts_at ? `${p.starts_at} 00:00:00` : null;
  if (p.ends_at !== undefined) patch.ends_at = p.ends_at ? `${p.ends_at} 23:59:59` : null;
  if (p.kind === 'free_shipping') patch.value = 0;
  if (!updateRow('discounts', did, patch)) notFound('Discount');
  return Response.json(getDiscount(did));
});

export const DELETE = admin<P>((_req, { id }) => {
  if (!Number(db().prepare('DELETE FROM discounts WHERE id = ?').run(intId(id)).changes)) notFound('Discount');
  return new Response(null, { status: 204 });
});
