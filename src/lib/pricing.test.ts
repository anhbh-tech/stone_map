import { describe, expect, it } from 'vitest';
import { bundleFor, totals } from './pricing';
import { DEFAULTS } from './settings';

const tiers = [{ min_qty: 2, percent_off: 10 }, { min_qty: 3, percent_off: 15 }, { min_qty: 5, percent_off: 20 }];
describe('pricing', () => {
  it('picks the highest tier reached and the next one', () => {
    expect(bundleFor(1, tiers)).toEqual({ tier: null, next: tiers[0] });
    expect(bundleFor(4, tiers)).toEqual({ tier: tiers[1], next: tiers[2] });
  });
  it('free standard shipping only above threshold after discount', () => {
    expect(totals([{ unit_cents: 3998, qty: 1 }], [], tiers, DEFAULTS).shipping_cents).toBe(699);
    const t = totals([{ unit_cents: 5998, qty: 2 }], [{ price_cents: 499 }], tiers, DEFAULTS);
    expect(t).toEqual({ subtotal_cents: 11996, discount_cents: 1200, addons_cents: 499, shipping_cents: 0, total_cents: 11295 });
  });
});
