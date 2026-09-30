// Logic thuần của PDP (không React) — test ở logic.test.ts.
import type { BundleTier, Variant } from '../../lib/catalog';
import { bundleFor } from '../../lib/pricing';

/** ?variant=<id> → variant; không hợp lệ → size rẻ nhất. */
export function pickVariant(variants: Variant[], param: string | string[] | undefined): Variant {
  const id = Number(Array.isArray(param) ? param[0] : param);
  const cheapest = [...variants].sort((a, b) => a.price_cents - b.price_cents)[0];
  return variants.find((v) => v.id === id) || cheapest;
}

export type BundleRow = { qty: number; percent_off: number; unit_cents: number; total_cents: number; save_cents: number };

/** Bảng mua 1 / 2 / 3 / 5 từ bundle_tiers — cùng công thức giảm giá với `totals()` trong pricing.ts. */
export function bundleRows(unitCents: number, tiers: BundleTier[]): BundleRow[] {
  const qtys = [1, ...tiers.map((t) => t.min_qty).filter((q) => q > 1)].sort((a, b) => a - b);
  return [...new Set(qtys)].map((qty) => {
    const pct = bundleFor(qty, tiers).tier?.percent_off ?? 0;
    const subtotal = unitCents * qty;
    const save = Math.round((subtotal * pct) / 100);
    return { qty, percent_off: pct, total_cents: subtotal - save, save_cents: save, unit_cents: Math.round((subtotal - save) / qty) };
  });
}

export type LivePrice = { price_cents: number; compare_cents: number | null; percent_off: number | null };

/**
 * Giá duy nhất cạnh tiêu đề PDP: size × số lượng (trừ bậc giảm giá, cùng công thức với totals()) + add-on (tính 1 lần như giỏ).
 * Giá gạch = giá gốc (compare_at nếu có) × số lượng + add-on; chỉ hiện khi thật sự cao hơn. % giảm làm tròn.
 */
export function livePrice(variant: Pick<Variant, 'price_cents' | 'compare_at_cents'>, qty: number, tiers: BundleTier[], addonsCents: number): LivePrice {
  const row = bundleRows(variant.price_cents, tiers).find((r) => r.qty === qty);
  const pct = row ? row.percent_off : bundleFor(qty, tiers).tier?.percent_off ?? 0;
  const subtotal = variant.price_cents * qty;
  const price = subtotal - Math.round((subtotal * pct) / 100) + addonsCents;
  const unitRegular = variant.compare_at_cents && variant.compare_at_cents > variant.price_cents ? variant.compare_at_cents : variant.price_cents;
  const regular = unitRegular * qty + addonsCents;
  if (regular <= price) return { price_cents: price, compare_cents: null, percent_off: null };
  return { price_cents: price, compare_cents: regular, percent_off: Math.round(((regular - price) / regular) * 100) };
}

/** ETA từ JobView.eta_ms (#2) — luôn là số thật, không có "a few seconds". */
export function etaText(ms: number): string {
  if (ms <= 1000) return 'Almost done';
  const s = Math.ceil(ms / 1000);
  if (s < 60) return `About ${s > 15 ? Math.ceil(s / 5) * 5 : s} seconds left`;
  const m = Math.ceil(s / 60);
  return `About ${m} minute${m === 1 ? '' : 's'} left`;
}

export function formatRange(from: Date, to: Date) {
  const f = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  return `${f.format(from)} – ${f.format(to)}`;
}

/** Tỉ lệ cạnh tranh so với size lớn nhất, cho mockup treo tường. */
export function sizeScale(size: string, all: string[]): number {
  const n = (s: string) => Number(s.match(/\d+(\.\d+)?/)?.[0] || 0);
  const max = Math.max(...all.map(n), 1);
  return Math.max(0.2, n(size) / max);
}

/** Góc về khoảng -180..180 như TransformSchema của API (270° → -90°). */
export const normRotate = (deg: number) => { const r = ((deg % 360) + 360) % 360; return r > 180 ? r - 360 : r; };

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
