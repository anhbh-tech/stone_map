// Mã giảm giá: đọc cho admin + hàm thuần evaluateDiscount() để checkout dùng khi được nối vào (src/lib/cart.ts là của crew D).
import { db } from '../../../lib/db';
import { like, offset, type ListState } from './list';

export type Discount = {
  id: number; code: string; kind: 'percent' | 'fixed' | 'free_shipping'; value: number;
  min_subtotal_cents: number | null; min_qty: number | null; starts_at: string | null; ends_at: string | null;
  usage_limit: number | null; active: 0 | 1; created_at: string;
};
export type DiscountRow = Discount & { used: number; state: DiscountState };
export type DiscountState = 'active' | 'scheduled' | 'expired' | 'disabled' | 'used_up';
export const DISCOUNT_STATES: DiscountState[] = ['active', 'scheduled', 'expired', 'disabled', 'used_up'];
export const STATE_LABEL: Record<DiscountState, string> = { active: 'Active', scheduled: 'Scheduled', expired: 'Expired', disabled: 'Disabled', used_up: 'Used up' };

const t = (s: string) => new Date(s.includes('T') ? s : `${s.replace(' ', 'T')}Z`).getTime();

export function discountState(d: Pick<Discount, 'active' | 'starts_at' | 'ends_at' | 'usage_limit'>, used: number, now = new Date()): DiscountState {
  if (!d.active) return 'disabled';
  if (d.ends_at && t(d.ends_at) <= now.getTime()) return 'expired';
  if (d.usage_limit != null && used >= d.usage_limit) return 'used_up';
  if (d.starts_at && t(d.starts_at) > now.getTime()) return 'scheduled';
  return 'active';
}

/** Mô tả ngắn cho danh sách: “15% off · 2+ items”. */
export function discountSummary(d: Pick<Discount, 'kind' | 'value' | 'min_qty' | 'min_subtotal_cents'>, fmt: (c: number) => string) {
  const what = d.kind === 'percent' ? `${d.value}% off` : d.kind === 'fixed' ? `${fmt(d.value)} off` : 'Free shipping';
  const cond = [d.min_qty ? `${d.min_qty}+ items` : '', d.min_subtotal_cents ? `orders over ${fmt(d.min_subtotal_cents)}` : ''].filter(Boolean);
  return cond.length ? `${what} · ${cond.join(', ')}` : what;
}

export type Evaluation = { ok: true; discount_cents: number; free_shipping: boolean } | { ok: false; reason: 'inactive' | 'not_started' | 'expired' | 'used_up' | 'min_qty' | 'min_subtotal' };

/** Áp một mã lên giỏ: giảm trên subtotal (không âm), hoặc miễn phí ship. */
export function evaluateDiscount(d: Discount, cart: { subtotal_cents: number; qty: number }, used: number, now = new Date()): Evaluation {
  const state = discountState(d, used, now);
  if (state === 'disabled') return { ok: false, reason: 'inactive' };
  if (state === 'scheduled') return { ok: false, reason: 'not_started' };
  if (state === 'expired') return { ok: false, reason: 'expired' };
  if (state === 'used_up') return { ok: false, reason: 'used_up' };
  if (d.min_qty != null && cart.qty < d.min_qty) return { ok: false, reason: 'min_qty' };
  if (d.min_subtotal_cents != null && cart.subtotal_cents < d.min_subtotal_cents) return { ok: false, reason: 'min_subtotal' };
  if (d.kind === 'free_shipping') return { ok: true, discount_cents: 0, free_shipping: true };
  const off = d.kind === 'percent' ? Math.round((cart.subtotal_cents * d.value) / 100) : d.value;
  return { ok: true, discount_cents: Math.min(off, cart.subtotal_cents), free_shipping: false };
}

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
  db().prepare('SELECT id, number, name, total_cents, discount_cents, created_at FROM orders WHERE discount_code = ? COLLATE NOCASE ORDER BY created_at DESC LIMIT ?')
    .all(code, limit) as { id: number; number: string; name: string; total_cents: number; discount_cents: number; created_at: string }[];
