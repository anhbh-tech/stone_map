// Mã giảm giá cho admin: danh sách/chi tiết. Logic áp mã dùng chung với checkout nằm ở src/lib/discounts.ts.
import { db } from '../../../lib/db';
import { discountState, type Discount, type DiscountState } from '../../../lib/discounts';
export { discountState, discountSummary, evaluateDiscount, type Discount, type DiscountState, type Evaluation } from '../../../lib/discounts';
import { like, offset, type ListState } from './list';

export type DiscountRow = Discount & { used: number; state: DiscountState };
export const DISCOUNT_STATES: DiscountState[] = ['active', 'scheduled', 'expired', 'disabled', 'used_up'];
export const STATE_LABEL: Record<DiscountState, string> = { active: 'Active', scheduled: 'Scheduled', expired: 'Expired', disabled: 'Disabled', used_up: 'Used up' };

const USED = '(SELECT count(*) FROM orders o WHERE o.discount_code = d.code COLLATE NOCASE)';

export const DISCOUNT_SORTS = ['code', 'created', 'used'] as const;
export function searchDiscounts(s: ListState<(typeof DISCOUNT_SORTS)[number]>, state?: DiscountState): { rows: DiscountRow[]; total: number } {
  const order = { code: 'd.code', created: 'd.created_at', used: 'used' }[s.sort];
  const all = db().prepare(`SELECT d.*, ${USED} AS used FROM discounts d ${s.q ? "WHERE d.code LIKE ? ESCAPE '\\'" : ''}
    ORDER BY ${order} ${s.dir === 'asc' ? 'ASC' : 'DESC'}, d.id DESC`).all(...(s.q ? [like(s.q)] : [])) as (Discount & { used: number })[];
  // Trạng thái phụ thuộc giờ hiện tại → lọc sau khi tính (bảng nhỏ).
  const rows = all.map((d) => ({ ...d, state: discountState(d, d.used) })).filter((d) => !state || d.state === state);
  return { rows: rows.slice(offset(s), offset(s) + s.per), total: rows.length };
}

export function getDiscount(id: number): DiscountRow | null {
  const d = db().prepare(`SELECT d.*, ${USED} AS used FROM discounts d WHERE d.id = ?`).get(id) as (Discount & { used: number }) | undefined;
  return d ? { ...d, state: discountState(d, d.used) } : null;
}

export const ordersWithDiscount = (code: string, limit = 20) =>
  db().prepare('SELECT id, number, name, total_cents, code_discount_cents AS discount_cents, created_at FROM orders WHERE discount_code = ? COLLATE NOCASE ORDER BY created_at DESC LIMIT ?')
    .all(code, limit) as { id: number; number: string; name: string; total_cents: number; discount_cents: number; created_at: string }[];
