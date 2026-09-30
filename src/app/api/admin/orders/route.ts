import { admin } from '@/app/admin/_lib/http';
import { listState, pick } from '@/app/admin/_lib/list';
import { ORDER_SORTS, searchOrders } from '@/app/admin/_lib/orders';
import { FULFILLMENT, PAYMENT } from '@/app/admin/_lib/order-status';
import { ORDER_STATUSES } from '@/app/admin/_lib/schemas';

// ?q= &payment= &fulfillment= &status= &sort=date|number|total|customer &dir= &page= → { orders, total, page, per }
export const GET = admin((req) => {
  const sp = Object.fromEntries(new URL(req.url).searchParams);
  const s = listState(sp, ORDER_SORTS, 'date');
  const { rows, total } = searchOrders(s, { payment: pick(sp.payment, PAYMENT), fulfillment: pick(sp.fulfillment, FULFILLMENT), status: pick(sp.status, ORDER_STATUSES) });
  return Response.json({ orders: rows, total, page: s.page, per: s.per });
});
