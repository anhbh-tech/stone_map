// Khách hàng: đọc bảng customers / customer_addresses / orders.customer_id của UI-2 (ui2_001_customers.sql) đúng hợp đồng.
// Admin chỉ đọc; không đổi cột. Đơn của khách = đơn gắn customer_id + đơn khách vãng lai cùng email (chưa đăng nhập lúc mua).
import { db, json } from '../../../lib/db';
import { like, offset, type ListState } from './list';

export const CUSTOMER_SORTS = ['created', 'name', 'orders', 'spent', 'last_order'] as const;
export type CustomerSort = (typeof CUSTOMER_SORTS)[number];

/** `id` null = khách vãng lai: chỉ có đơn (email), chưa tạo tài khoản. Shopify cũng coi họ là khách hàng. */
export type CustomerRow = { id: number | null; email: string; name: string | null; created_at: string; orders: number; spent_cents: number; last_order_at: string | null };

const OWNS = '(o.customer_id = c.id OR (o.customer_id IS NULL AND lower(o.email) = lower(c.email)))';
const STATS = `(SELECT count(*) FROM orders o WHERE ${OWNS}) AS orders,
  (SELECT coalesce(sum(o.total_cents), 0) FROM orders o WHERE ${OWNS} AND o.status NOT IN ('refunded','canceled')) AS spent_cents,
  (SELECT max(o.created_at) FROM orders o WHERE ${OWNS}) AS last_order_at`;

// Tài khoản (bảng customers của UI-2) + email đặt hàng chưa có tài khoản nào. Đơn của khách vãng lai: customer_id NULL, cùng email.
const PEOPLE = `WITH guests AS (
    SELECT lower(o.email) AS k, max(o.id) AS last_id, min(o.created_at) AS first_at FROM orders o
    WHERE o.customer_id IS NULL AND NOT EXISTS (SELECT 1 FROM customers x WHERE lower(x.email) = lower(o.email)) GROUP BY lower(o.email)
  ), people AS (
    SELECT c.id, c.email, c.name, c.created_at, ${STATS} FROM customers c
    UNION ALL
    SELECT NULL, o.email, o.name, g.first_at,
      (SELECT count(*) FROM orders y WHERE y.customer_id IS NULL AND lower(y.email) = g.k),
      (SELECT coalesce(sum(y.total_cents), 0) FROM orders y WHERE y.customer_id IS NULL AND lower(y.email) = g.k AND y.status NOT IN ('refunded','canceled')),
      (SELECT max(y.created_at) FROM orders y WHERE y.customer_id IS NULL AND lower(y.email) = g.k)
    FROM guests g JOIN orders o ON o.id = g.last_id
  )`;

export function searchCustomers(s: ListState<CustomerSort>): { rows: CustomerRow[]; total: number } {
  const d = db();
  const w = s.q ? "WHERE p.email LIKE ? ESCAPE '\\' OR p.name LIKE ? ESCAPE '\\'" : '';
  const args = s.q ? [like(s.q), like(s.q)] : [];
  const order = { created: 'p.created_at', name: "lower(coalesce(p.name, p.email))", orders: 'p.orders', spent: 'p.spent_cents', last_order: 'p.last_order_at' }[s.sort];
  const dir = s.dir === 'asc' ? 'ASC' : 'DESC';
  const rows = d.prepare(`${PEOPLE} SELECT p.* FROM people p ${w}
    ORDER BY ${order} ${dir} NULLS LAST, lower(p.email) ${dir} LIMIT ? OFFSET ?`).all(...args, s.per, offset(s)) as CustomerRow[];
  const total = (d.prepare(`${PEOPLE} SELECT count(*) AS n FROM people p ${w}`).get(...args) as { n: number }).n;
  return { rows, total };
}

/** Link tới trang khách: tài khoản theo id, khách vãng lai theo email. */
export const customerHref = (c: { id: number | null; email: string }) =>
  c.id != null ? `/admin/customers/${c.id}` : `/admin/customers/guest?email=${encodeURIComponent(c.email)}`;

type Addr = Record<string, string>;
export type CustomerDetail = CustomerRow & { addresses: { id: number; address: Addr; is_default: 0 | 1 }[]; last_address: Addr | null };

const lastAddress = (where: string, ...args: (string | number)[]) => {
  const r = db().prepare(`SELECT o.address FROM orders o WHERE ${where} ORDER BY o.id DESC LIMIT 1`).get(...args) as { address: string } | undefined;
  return r ? json(r.address, {} as Addr) : null;
};

export function getCustomer(id: number): CustomerDetail | null {
  const d = db();
  const c = d.prepare(`SELECT c.id, c.email, c.name, c.created_at, ${STATS} FROM customers c WHERE c.id = ?`).get(id) as CustomerRow | undefined;
  if (!c) return null;
  const addresses = (d.prepare('SELECT id, address, is_default FROM customer_addresses WHERE customer_id = ? ORDER BY is_default DESC, id').all(id) as { id: number; address: string; is_default: 0 | 1 }[])
    .map((a) => ({ ...a, address: json(a.address, {} as Addr) }));
  return { ...c, addresses, last_address: lastAddress('(o.customer_id = ? OR (o.customer_id IS NULL AND lower(o.email) = lower(?)))', id, c.email) };
}

/** Khách vãng lai theo email; null nếu email đó đã có tài khoản (dùng trang tài khoản) hoặc chưa có đơn. */
export function getGuest(email: string): CustomerDetail | null {
  const d = db();
  if (!email.trim() || d.prepare('SELECT 1 FROM customers WHERE lower(email) = lower(?)').get(email)) return null;
  const r = d.prepare(`SELECT count(*) AS orders, min(created_at) AS created_at, max(created_at) AS last_order_at,
      coalesce(sum(CASE WHEN status NOT IN ('refunded','canceled') THEN total_cents END), 0) AS spent_cents,
      (SELECT name FROM orders y WHERE y.customer_id IS NULL AND lower(y.email) = lower(?) ORDER BY y.id DESC LIMIT 1) AS name,
      (SELECT email FROM orders y WHERE y.customer_id IS NULL AND lower(y.email) = lower(?) ORDER BY y.id DESC LIMIT 1) AS email
    FROM orders WHERE customer_id IS NULL AND lower(email) = lower(?)`).get(email, email, email) as Omit<CustomerRow, 'id'>;
  if (!r.orders) return null;
  return { ...r, id: null, addresses: [], last_address: lastAddress('o.customer_id IS NULL AND lower(o.email) = lower(?)', email) };
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
