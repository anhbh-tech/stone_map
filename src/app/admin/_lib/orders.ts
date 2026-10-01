// Danh sách đơn có tìm/lọc/sắp xếp/phân trang + timeline. Chi tiết đơn vẫn ở repo.getOrder().
import { db } from '../../../lib/db';
import { like, offset, type ListState } from './list';
import { STATUSES_FOR, fulfillmentStatus, paymentStatus, type FulfillmentStatus, type PaymentStatus } from './order-status';

export const ORDER_SORTS = ['date', 'number', 'total', 'customer'] as const;
export type OrderSort = (typeof ORDER_SORTS)[number];

export type OrderListRow = {
  id: number; number: string; email: string; name: string; shipping_method: string; total_cents: number;
  status: string; created_at: string; items: number; designs_pending: number; customer_id: number | null; shipped: number;
  payment: PaymentStatus; fulfillment: FulfillmentStatus;
};

export type OrderFilter = { payment?: PaymentStatus; fulfillment?: FulfillmentStatus; status?: string; customer_id?: number; email?: string };

function where(f: OrderFilter, q: string) {
  const w: string[] = [];
  const args: (string | number)[] = [];
  const inList = (vals: readonly string[]) => { w.push(`o.status IN (${vals.map(() => '?').join(',')})`); args.push(...vals); };
  if (f.payment) inList(STATUSES_FOR.payment[f.payment]);
  if (f.fulfillment) {
    // Hoàn tiền / huỷ: "fulfilled" nếu đã có shipment, ngược lại "unfulfilled" (khớp fulfillmentStatus()).
    const closed = `(o.status IN ('refunded','canceled') AND ${f.fulfillment === 'fulfilled' ? '' : 'NOT '}EXISTS (SELECT 1 FROM fulfillments x WHERE x.order_id = o.id))`;
    const open = STATUSES_FOR.fulfillment[f.fulfillment].filter((s) => s !== 'refunded' && s !== 'canceled');
    const inOpen = `o.status IN (${open.map(() => '?').join(',')})`;
    w.push(f.fulfillment === 'in_production' ? inOpen : `(${inOpen} OR ${closed})`);
    args.push(...open);
  }
  if (f.status) inList([f.status]);
  if (f.customer_id != null || f.email) {
    // Đơn của khách: gắn customer_id (UI-2) hoặc đơn khách vãng lai cùng email.
    const parts: string[] = [];
    if (f.customer_id != null) { parts.push('o.customer_id = ?'); args.push(f.customer_id); }
    if (f.email) { parts.push('lower(o.email) = lower(?)'); args.push(f.email); }
    if (parts.length) w.push(`(${parts.join(' OR ')})`);
  }
  if (q) {
    const n = q.replace(/^#/, '');
    w.push(`(o.number = ? OR o.name LIKE ? ESCAPE '\\' OR o.email LIKE ? ESCAPE '\\'
      OR EXISTS (SELECT 1 FROM order_lines l WHERE l.order_id = o.id AND (l.design_id LIKE ? ESCAPE '\\' OR l.sku LIKE ? ESCAPE '\\')))`);
    args.push(n, like(q), like(q), like(q), like(q));
  }
  return { sql: w.length ? `WHERE ${w.join(' AND ')}` : '', args };
}

export function searchOrders(s: ListState<OrderSort>, f: OrderFilter = {}): { rows: OrderListRow[]; total: number } {
  const d = db();
  const { sql, args } = where(f, s.q);
  const order = { date: 'o.created_at', number: 'CAST(o.number AS INTEGER)', total: 'o.total_cents', customer: 'lower(o.name)' }[s.sort];
  const dir = s.dir === 'asc' ? 'ASC' : 'DESC';
  const rows = d.prepare(`SELECT o.id, o.number, o.email, o.name, o.shipping_method, o.total_cents, o.status, o.created_at, o.customer_id,
      (SELECT coalesce(sum(qty), 0) FROM order_lines l WHERE l.order_id = o.id) AS items,
      (SELECT count(*) FROM order_lines l JOIN designs g ON g.id = l.design_id WHERE l.order_id = o.id AND g.status = 'in_review') AS designs_pending,
      EXISTS (SELECT 1 FROM fulfillments x WHERE x.order_id = o.id) AS shipped
    FROM orders o ${sql} ORDER BY ${order} ${dir}, o.id ${dir} LIMIT ? OFFSET ?`).all(...args, s.per, offset(s)) as Omit<OrderListRow, 'payment' | 'fulfillment'>[];
  const total = (d.prepare(`SELECT count(*) AS n FROM orders o ${sql}`).get(...args) as { n: number }).n;
  return { rows: rows.map((r) => ({ ...r, payment: paymentStatus(r.status), fulfillment: fulfillmentStatus(r.status, !!r.shipped) })), total };
}

/** Đếm theo tab (All / Unfulfilled / In production / Fulfilled / Refunded). */
export function orderTabCounts() {
  const rows = db().prepare('SELECT status, count(*) AS n FROM orders GROUP BY status').all() as { status: string; n: number }[];
  const sum = (sts: readonly string[]) => rows.filter((r) => sts.includes(r.status)).reduce((a, r) => a + r.n, 0);
  return {
    all: rows.reduce((a, r) => a + r.n, 0),
    to_fulfill: sum(['paid']),
    in_production: sum(STATUSES_FOR.fulfillment.in_production),
    fulfilled: sum(STATUSES_FOR.fulfillment.fulfilled),
    refunded: sum(STATUSES_FOR.payment.refunded),
  };
}

// ── Timeline
export type TimelineEntry = { at: string; kind: 'placed' | 'status' | 'fulfillment' | 'comment' | 'email'; message: string; author: string | null; detail?: string | null };

export function orderTimeline(orderId: number): TimelineEntry[] {
  const d = db();
  const o = d.prepare('SELECT number, email, created_at FROM orders WHERE id = ?').get(orderId) as { number: string; email: string; created_at: string } | undefined;
  if (!o) return [];
  const out: TimelineEntry[] = [{ at: o.created_at, kind: 'placed', message: 'Order placed (simulated checkout, paid)', author: null }];
  for (const e of d.prepare('SELECT kind, message, author, created_at FROM order_events WHERE order_id = ? ORDER BY created_at, id').all(orderId) as { kind: TimelineEntry['kind']; message: string; author: string | null; created_at: string }[]) {
    out.push({ at: e.created_at, kind: e.kind, message: e.message, author: e.author });
  }
  // Email xác nhận: outbox không có khoá đơn, khớp theo người nhận + tiêu đề kết thúc bằng “#<số đơn>” (src/lib/cart.ts).
  for (const m of d.prepare("SELECT subject, created_at FROM email_outbox WHERE to_addr = ? AND kind = 'order_confirmation' AND subject LIKE ? ESCAPE '\\'")
    .all(o.email, like(`#${o.number}`).slice(0, -1)) as { subject: string; created_at: string }[]) {
    out.push({ at: m.created_at, kind: 'email', message: `Confirmation email queued: “${m.subject}”`, author: null });
  }
  return out.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
}

export const orderFulfillments = (orderId: number) =>
  db().prepare('SELECT id, carrier, tracking_number, tracking_url, created_at FROM fulfillments WHERE order_id = ? ORDER BY created_at DESC, id DESC').all(orderId) as
    { id: number; carrier: string | null; tracking_number: string | null; tracking_url: string | null; created_at: string }[];

export function logOrderEvent(orderId: number, kind: 'status' | 'fulfillment' | 'comment', message: string, author: string | null) {
  db().prepare('INSERT INTO order_events (order_id, kind, message, author) VALUES (?, ?, ?, ?)').run(orderId, kind, message, author);
}
