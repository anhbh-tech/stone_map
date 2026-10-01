// Đơn "paid" tự sang "in_production" khi mọi dòng đã có file in được duyệt (design confirmed/approved + print_path).
// Gọi lúc checkout (design AI đã render) và lúc admin duyệt design làm tay; ghi một dòng vào timeline đơn.
import { db } from './db';

const READY = `o.status = 'paid'
  AND EXISTS (SELECT 1 FROM order_lines l WHERE l.order_id = o.id)
  AND NOT EXISTS (SELECT 1 FROM order_lines l LEFT JOIN designs g ON g.id = l.design_id
    WHERE l.order_id = o.id AND (g.id IS NULL OR g.status NOT IN ('confirmed', 'approved') OR g.print_path IS NULL))`;

export const PRODUCTION_STARTED = 'Moved to In production: every portrait has an approved print file';

function start(ids: number[]) {
  const d = db();
  const log = d.prepare("INSERT INTO order_events (order_id, kind, message, author) VALUES (?, 'status', ?, NULL)");
  for (const id of ids) {
    d.prepare("UPDATE orders SET status = 'in_production' WHERE id = ?").run(id);
    log.run(id, PRODUCTION_STARTED);
  }
  return ids;
}

export function startProductionIfReady(orderId: number): boolean {
  const r = db().prepare(`SELECT o.id FROM orders o WHERE o.id = ? AND ${READY}`).get(orderId) as { id: number } | undefined;
  return r ? start([r.id]).length > 0 : false;
}

/** Sau khi duyệt một design: các đơn chứa design đó và giờ đã đủ file in. */
export function startProductionForDesign(designId: string): number[] {
  const rows = db().prepare(`SELECT DISTINCT o.id FROM orders o JOIN order_lines x ON x.order_id = o.id WHERE x.design_id = ? AND ${READY}`).all(designId) as { id: number }[];
  return start(rows.map((r) => r.id));
}

/** Email của đơn gần nhất chứa design (khi design không có email riêng: khách không bấm "email me the link"). */
export const orderEmailForDesign = (designId: string) =>
  (db().prepare('SELECT o.email FROM orders o JOIN order_lines l ON l.order_id = o.id WHERE l.design_id = ? ORDER BY o.id DESC LIMIT 1').get(designId) as { email: string } | undefined)?.email ?? null;
