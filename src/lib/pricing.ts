// Tính giá — một chỗ duy nhất cho PDP (bảng mua nhiều), giỏ và checkout.
import type { BundleTier } from './catalog';
import type { Settings } from './types';

export function bundleFor(qty: number, tiers: BundleTier[]) {
  const tier = [...tiers].sort((a, b) => b.min_qty - a.min_qty).find((t) => qty >= t.min_qty) || null;
  const next = [...tiers].sort((a, b) => a.min_qty - b.min_qty).find((t) => t.min_qty > qty) || null;
  return { tier, next };
}

export type Totals = { subtotal_cents: number; discount_cents: number; addons_cents: number; shipping_cents: number; total_cents: number };

/** Giảm giá mua nhiều áp trên tổng tiền sản phẩm (không áp lên add-on / ship). */
export function totals(
  lines: { unit_cents: number; qty: number }[],
  addons: { price_cents: number }[],
  tiers: BundleTier[],
  s: Settings,
  method: 'standard' | 'express' = 'standard',
): Totals {
  const qty = lines.reduce((n, l) => n + l.qty, 0);
  const subtotal = lines.reduce((n, l) => n + l.unit_cents * l.qty, 0);
  const { tier } = bundleFor(qty, tiers);
  const discount = tier ? Math.round((subtotal * tier.percent_off) / 100) : 0;
  const addonsCents = addons.reduce((n, a) => n + a.price_cents, 0);
  const goods = subtotal - discount;
  const free = method === 'standard' && s.shipping.free_over_cents != null && goods >= s.shipping.free_over_cents;
  const shipping = qty === 0 ? 0 : free ? 0 : s.shipping[method].price_cents;
  return { subtotal_cents: subtotal, discount_cents: discount, addons_cents: addonsCents, shipping_cents: shipping, total_cents: goods + addonsCents + shipping };
}
