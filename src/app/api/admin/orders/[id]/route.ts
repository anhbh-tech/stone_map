import { admin, body, intId, notFound } from '@/app/admin/_lib/http';
import { getOrder } from '@/app/admin/_lib/repo';
import { orderPatch } from '@/app/admin/_lib/schemas';
import { logOrderEvent } from '@/app/admin/_lib/orders';
import { db, tx } from '@/lib/db';

type P = { id: string };
const label = (s: string) => s.replace(/_/g, ' ');

export const GET = admin<P>((_req, { id }) => Response.json(getOrder(intId(id)) ?? notFound('Order')));

// Đổi trạng thái → ghi một dòng timeline (ai đổi, từ gì sang gì).
export const PATCH = admin<P>(async (req, { id }, user) => {
  const oid = intId(id);
  const { status } = await body(req, orderPatch);
  const cur = getOrder(oid) ?? notFound('Order');
  if (cur.status !== status) {
    tx(() => {
      db().prepare('UPDATE orders SET status = ? WHERE id = ?').run(status, oid);
      logOrderEvent(oid, 'status', `Status changed from ${label(cur.status)} to ${label(status)}`, user.username);
    });
  }
  return Response.json(getOrder(oid));
});
