import { admin, body, HttpError, intId, notFound } from '@/app/admin/_lib/http';
import { getOrder } from '@/app/admin/_lib/repo';
import { orderFulfill } from '@/app/admin/_lib/schemas';
import { canFulfill } from '@/app/admin/_lib/order-status';
import { logOrderEvent } from '@/app/admin/_lib/orders';
import { shippedEmail } from '@/app/admin/_lib/emails';
import { db, tx } from '@/lib/db';
import { getSettings } from '@/lib/settings';

type P = { id: string };

// POST { carrier?, tracking_number?, tracking_url?, notify? } → đơn chuyển "shipped" (fulfilled), lưu vận đơn, ghi timeline.
// Không cho giao khi còn dòng chưa có file in hoặc design còn chờ duyệt: không gửi thứ chưa in được.
export const POST = admin<P>(async (req, { id }, user) => {
  const oid = intId(id);
  const input = await body(req, orderFulfill);
  const o = getOrder(oid) ?? notFound('Order');
  if (!canFulfill(o.status)) throw new HttpError(409, 'not_fulfillable', `Order is ${o.status.replace(/_/g, ' ')}; only paid or in-production orders can be fulfilled`);
  const blocked = o.lines.filter((l) => !l.design || l.design.status === 'in_review' || !l.design.has_print);
  if (blocked.length) {
    throw new HttpError(409, 'print_missing', `${blocked.length} ${blocked.length === 1 ? 'line still needs' : 'lines still need'} an approved print file (${blocked.map((l) => l.design?.id ?? l.sku).join(', ')})`);
  }
  tx(() => {
    db().prepare('INSERT INTO fulfillments (order_id, carrier, tracking_number, tracking_url) VALUES (?, ?, ?, ?)').run(oid, input.carrier, input.tracking_number, input.tracking_url);
    db().prepare("UPDATE orders SET status = 'shipped' WHERE id = ?").run(oid);
    const track = [input.carrier, input.tracking_number].filter(Boolean).join(' ');
    logOrderEvent(oid, 'fulfillment', `Marked as fulfilled${track ? ` · ${track}` : ' · no tracking number'}`, user.username);
    if (input.notify) {
      const m = shippedEmail(getSettings(), o, input);
      db().prepare("INSERT INTO email_outbox (to_addr, kind, subject, html) VALUES (?, 'shipping_confirmation', ?, ?)").run(o.email, m.subject, m.html);
      logOrderEvent(oid, 'fulfillment', `Shipping email queued to ${o.email}`, null);
    }
  });
  return Response.json(getOrder(oid), { status: 201 });
});
