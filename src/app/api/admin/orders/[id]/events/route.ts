import { admin, body, intId, notFound } from '@/app/admin/_lib/http';
import { orderComment } from '@/app/admin/_lib/schemas';
import { logOrderEvent, orderTimeline } from '@/app/admin/_lib/orders';
import { db } from '@/lib/db';

type P = { id: string };

export const GET = admin<P>((_req, { id }) => {
  const oid = intId(id);
  if (!db().prepare('SELECT 1 FROM orders WHERE id = ?').get(oid)) notFound('Order');
  return Response.json({ timeline: orderTimeline(oid) });
});

// Ghi chú nội bộ trên timeline (khách không thấy).
export const POST = admin<P>(async (req, { id }, user) => {
  const oid = intId(id);
  const { message } = await body(req, orderComment);
  if (!db().prepare('SELECT 1 FROM orders WHERE id = ?').get(oid)) notFound('Order');
  logOrderEvent(oid, 'comment', message, user.username);
  return Response.json({ timeline: orderTimeline(oid) }, { status: 201 });
});
