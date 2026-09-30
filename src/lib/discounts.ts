// Mã giảm giá dùng chung cho checkout (src/lib/cart.ts) và admin (/admin/discounts). Bảng discounts: db/migrations/ui3_001_admin.sql.
// Mọi số tiền tính ở server từ DB; client chỉ gửi chuỗi mã.
import { z } from 'zod';
import { db } from './db';
import { fmt } from './money';

export type Discount = {
  id: number; code: string; kind: 'percent' | 'fixed' | 'free_shipping'; value: number;
  min_subtotal_cents: number | null; min_qty: number | null; starts_at: string | null; ends_at: string | null;
  usage_limit: number | null; active: 0 | 1; show_on_pdp?: 0 | 1; created_at: string;
};
export type DiscountState = 'active' | 'scheduled' | 'expired' | 'disabled' | 'used_up';

/** Cùng quy tắc với form admin: 3–32 ký tự, chữ hoa/số/gạch. */
export const CodeInput = z.object({ code: z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9_-]{2,31}$/, 'Enter a code of 3–32 letters or digits') });

const t = (s: string) => new Date(s.includes('T') ? s : `${s.replace(' ', 'T')}Z`).getTime();

export function discountState(d: Pick<Discount, 'active' | 'starts_at' | 'ends_at' | 'usage_limit'>, used: number, now = new Date()): DiscountState {
  if (!d.active) return 'disabled';
  if (d.ends_at && t(d.ends_at) <= now.getTime()) return 'expired';
  if (d.usage_limit != null && used >= d.usage_limit) return 'used_up';
  if (d.starts_at && t(d.starts_at) > now.getTime()) return 'scheduled';
  return 'active';
}

/** Mô tả ngắn: “15% off · 2+ items”. */
export function discountSummary(d: Pick<Discount, 'kind' | 'value' | 'min_qty' | 'min_subtotal_cents'>, money: (c: number) => string = fmt) {
  const what = d.kind === 'percent' ? `${d.value}% off` : d.kind === 'fixed' ? `${money(d.value)} off` : 'Free shipping';
  const cond = [d.min_qty ? `${d.min_qty}+ items` : '', d.min_subtotal_cents ? `orders over ${money(d.min_subtotal_cents)}` : ''].filter(Boolean);
  return cond.length ? `${what} · ${cond.join(', ')}` : what;
}

export type Rejection = 'not_found' | 'inactive' | 'not_started' | 'expired' | 'used_up' | 'min_qty' | 'min_subtotal';
export type Evaluation = { ok: true; discount_cents: number; free_shipping: boolean } | { ok: false; reason: Exclude<Rejection, 'not_found'> };

/**
 * Áp một mã lên giỏ. Điều kiện tối thiểu so với subtotal hàng (trước mọi giảm giá);
 * phần giảm tính trên `base_cents` (hàng sau giảm theo bậc số lượng), không bao giờ âm.
 */
export function evaluateDiscount(d: Discount, cart: { subtotal_cents: number; qty: number; base_cents?: number }, used: number, now = new Date()): Evaluation {
  const state = discountState(d, used, now);
  if (state === 'disabled') return { ok: false, reason: 'inactive' };
  if (state === 'scheduled') return { ok: false, reason: 'not_started' };
  if (state === 'expired') return { ok: false, reason: 'expired' };
  if (state === 'used_up') return { ok: false, reason: 'used_up' };
  if (d.min_qty != null && cart.qty < d.min_qty) return { ok: false, reason: 'min_qty' };
  if (d.min_subtotal_cents != null && cart.subtotal_cents < d.min_subtotal_cents) return { ok: false, reason: 'min_subtotal' };
  if (d.kind === 'free_shipping') return { ok: true, discount_cents: 0, free_shipping: true };
  const base = cart.base_cents ?? cart.subtotal_cents;
  const off = d.kind === 'percent' ? Math.round((base * d.value) / 100) : d.value;
  return { ok: true, discount_cents: Math.max(0, Math.min(off, base)), free_shipping: false };
}

const day = (s: string) => new Date(t(s)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

/** Câu báo lỗi cho khách: nói rõ vì sao và (nếu được) cần làm gì. */
export function rejectionMessage(code: string, reason: Rejection, d?: Discount, cart?: { subtotal_cents: number; qty: number }) {
  switch (reason) {
    case 'not_found': return `We couldn't find the code ${code}. Check the spelling and try again.`;
    case 'expired': return `The code ${code} expired${d?.ends_at ? ` on ${day(d.ends_at)}` : ''}.`;
    case 'not_started': return `The code ${code} isn't active yet${d?.starts_at ? `. It starts on ${day(d.starts_at)}` : ''}.`;
    case 'inactive': return `The code ${code} is no longer available.`;
    case 'used_up': return `The code ${code} has reached its usage limit.`;
    case 'min_subtotal': {
      const min = d?.min_subtotal_cents ?? 0;
      const gap = cart ? Math.max(0, min - cart.subtotal_cents) : 0;
      return `The code ${code} needs an order of ${fmt(min)} or more.${gap ? ` Add ${fmt(gap)} more to use it.` : ''}`;
    }
    case 'min_qty': {
      const min = d?.min_qty ?? 0;
      const gap = cart ? Math.max(0, min - cart.qty) : 0;
      return `The code ${code} needs ${min} or more portraits in your cart.${gap ? ` Add ${gap} more to use it.` : ''}`;
    }
  }
}

export const findDiscount = (code: string) =>
  db().prepare('SELECT * FROM discounts WHERE code = ? COLLATE NOCASE').get(code.trim()) as Discount | undefined;

/** Lượt dùng = số đơn đã lưu mã này (không có bộ đếm riêng để khỏi lệch). */
export const discountUses = (code: string) =>
  (db().prepare('SELECT count(*) n FROM orders WHERE discount_code = ? COLLATE NOCASE').get(code) as { n: number }).n;

export type PdpCode = { code: string; spend: string; get: string };

/** Mã đang dùng được và được đánh dấu hiện trên PDP ("Buy More, Save More!"), xếp theo điều kiện tăng dần. */
export function pdpCodes(now = new Date()): PdpCode[] {
  const rows = db().prepare(`SELECT d.*, (SELECT count(*) FROM orders o WHERE o.discount_code = d.code COLLATE NOCASE) used
    FROM discounts d WHERE d.show_on_pdp = 1 AND d.active = 1 ORDER BY coalesce(d.min_qty, 0), coalesce(d.min_subtotal_cents, 0), d.code`).all() as (Discount & { used: number })[];
  return rows.filter((d) => discountState(d, d.used, now) === 'active').map((d) => ({
    code: d.code,
    spend: d.min_qty ? `Buy ${d.min_qty} ${d.min_qty === 1 ? 'item' : 'items'}` : d.min_subtotal_cents ? `Spend ${fmt(d.min_subtotal_cents)}` : 'Any order',
    get: d.kind === 'percent' ? `${d.value}% off` : d.kind === 'fixed' ? `${fmt(d.value)} off` : 'Free shipping',
  }));
}
