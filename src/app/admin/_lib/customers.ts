// Khách hàng: đọc bảng customers / customer_addresses / orders.customer_id của UI-2 (ui2_001_customers.sql) đúng hợp đồng.
// Admin chỉ đọc; không đổi cột. Đơn của khách = đơn gắn customer_id + đơn khách vãng lai cùng email (chưa đăng nhập lúc mua).
import { db, json } from '../../../lib/db';
import { like, offset, type ListState } from './list';

export const CUSTOMER_SORTS = ['created', 'name', 'orders', 'spent', 'last_order'] as const;
export type CustomerSort = (typeof CUSTOMER_SORTS)[number];

export type CustomerRow = { id: number; email: string; name: string | null; created_at: string; orders: number; spent_cents: number; last_order_at: string | null };

const OWNS = '(o.customer_id = c.id OR (o.customer_id IS NULL AND lower(o.email) = lower(c.email)))';
const STATS = `(SELECT count(*) FROM orders o WHERE ${OWNS}) AS orders,
  (SELECT coalesce(sum(o.total_cents), 0) FROM orders o WHERE ${OWNS} AND o.status NOT IN ('refunded','canceled')) AS spent_cents,
  (SELECT max(o.created_at) FROM orders o WHERE ${OWNS}) AS last_order_at`;

export function searchCustomers(s: ListState<CustomerSort>): { rows: CustomerRow[]; total: number } {
  const d = db();
  const w = s.q ? "WHERE c.email LIKE ? ESCAPE '\\' OR c.name LIKE ? ESCAPE '\\'" : '';
  const args = s.q ? [like(s.q), like(s.q)] : [];
  const order = { created: 'c.created_at', name: "lower(coalesce(c.name, c.email))", orders: 'orders', spent: 'spent_cents', last_order: 'last_order_at' }[s.sort];
  const dir = s.dir === 'asc' ? 'ASC' : 'DESC';
  const rows = d.prepare(`SELECT c.id, c.email, c.name, c.created_at, ${STATS} FROM customers c ${w}
    ORDER BY ${order} ${dir} NULLS LAST, c.id ${dir} LIMIT ? OFFSET ?`).all(...args, s.per, offset(s)) as CustomerRow[];
  const total = (d.prepare(`SELECT count(*) AS n FROM customers c ${w}`).get(...args) as { n: number }).n;
  return { rows, total };
}

export type CustomerDetail = CustomerRow & { addresses: { id: number; address: Record<string, string>; is_default: 0 | 1 }[] };

export function getCustomer(id: number): CustomerDetail | null {
  const d = db();
  const c = d.prepare(`SELECT c.id, c.email, c.name, c.created_at, ${STATS} FROM customers c WHERE c.id = ?`).get(id) as CustomerRow | undefined;
  if (!c) return null;
  const addresses = (d.prepare('SELECT id, address, is_default FROM customer_addresses WHERE customer_id = ? ORDER BY is_default DESC, id').all(id) as { id: number; address: string; is_default: 0 | 1 }[])
    .map((a) => ({ ...a, address: json(a.address, {} as Record<string, string>) }));
  return { ...c, addresses };
}

/** Khách có tài khoản ứng với một đơn (để link từ trang đơn). */
export function customerForOrder(order: { email: string; customer_id?: number | null }): { id: number; name: string | null; email: string; orders: number } | null {
  const d = db();
  const c = (order.customer_id != null
    ? d.prepare('SELECT id, name, email FROM customers WHERE id = ?').get(order.customer_id)
    : d.prepare('SELECT id, name, email FROM customers WHERE lower(email) = lower(?)').get(order.email)) as { id: number; name: string | null; email: string } | undefined;
  if (!c) return null;
  const n = (d.prepare(`SELECT count(*) AS n FROM orders o, customers c WHERE c.id = ? AND ${OWNS}`).get(c.id) as { n: number }).n;
  return { ...c, orders: n };
}
