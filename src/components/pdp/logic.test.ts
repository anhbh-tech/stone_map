import { describe, expect, it } from 'vitest';
import type { Variant } from '../../lib/catalog';
import { totals } from '../../lib/pricing';
import { DEFAULTS } from '../../lib/settings';
import { bundleRows, etaText, pickVariant, sizeScale } from './logic';

const v = (id: number, price: number): Variant => ({ id, product_id: 1, sku: `S${id}`, size: `${id}×${id}`, price_cents: price, compare_at_cents: null, print_px: 2000, position: id });
const variants = [v(12, 5998), v(8, 3998), v(16, 8998)];
const tiers = [{ min_qty: 2, percent_off: 10 }, { min_qty: 3, percent_off: 15 }, { min_qty: 5, percent_off: 20 }];

describe('pickVariant', () => {
  it('uses ?variant= when it is a real id', () => expect(pickVariant(variants, '16').id).toBe(16));
  it('falls back to the cheapest size', () => {
    expect(pickVariant(variants, undefined).id).toBe(8);
    expect(pickVariant(variants, 'nope').id).toBe(8);
    expect(pickVariant(variants, ['999']).id).toBe(8);
  });
});

describe('bundleRows', () => {
  it('lists 1 plus every tier', () => {
    expect(bundleRows(5998, tiers).map((r) => [r.qty, r.percent_off])).toEqual([[1, 0], [2, 10], [3, 15], [5, 20]]);
  });
  it('matches the cart totals() discount exactly', () => {
    for (const r of bundleRows(5998, tiers)) {
      const t = totals([{ unit_cents: 5998, qty: r.qty }], [], tiers, DEFAULTS);
      expect(r.total_cents).toBe(t.subtotal_cents - t.discount_cents);
      expect(r.save_cents).toBe(t.discount_cents);
    }
  });
  it('works with no tiers', () => expect(bundleRows(1000, [])).toEqual([{ qty: 1, percent_off: 0, unit_cents: 1000, total_cents: 1000, save_cents: 0 }]));
});

describe('etaText', () => {
  it('never shows a vague phrase', () => {
    expect(etaText(0)).toBe('Almost done');
    expect(etaText(7200)).toBe('About 8 seconds left');
    expect(etaText(41000)).toBe('About 45 seconds left');
    expect(etaText(61000)).toBe('About 2 minutes left');
    expect(etaText(59000)).toBe('About 60 seconds left');
  });
});

describe('sizeScale', () => {
  it('is relative to the largest size', () => {
    expect(sizeScale('20×20', ['8×8', '20×20'])).toBe(1);
    expect(sizeScale('8×8', ['8×8', '20×20'])).toBeCloseTo(0.4);
  });
});
