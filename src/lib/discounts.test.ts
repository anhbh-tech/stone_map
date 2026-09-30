import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

// DB riêng cho file test này — phải đặt trước khi import db.ts.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pa-disc-'));
process.env.DB_PATH = path.join(tmp, 'store.db');
process.env.STORAGE_DIR = path.join(tmp, 'storage');

const { db } = await import('./db');
const { CartError, NOT_BETTER, addLine, applyDiscountCode, ensureCart, getCart, getOrder, placeOrder, removeDiscountCode, updateLine } = await import('./cart');
const { evaluateDiscount, pdpCodes, rejectionMessage } = await import('./discounts');
const { seedDiscounts } = await import('../../scripts/seed-discounts');

afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

const address = { line1: '1 Pearl St', line2: '', city: 'Austin', region: 'TX', postal_code: '78701', country: 'US' };
const checkout = { email: 'jo@example.com', name: 'Jo Tester', address, shipping_method: 'standard' as const };
const err = (fn: () => unknown) => { try { fn(); } catch (e) { return e instanceof CartError ? `${e.status} ${e.code}: ${e.message}` : String(e); } return 'ok'; };

beforeEach(() => {
  const d = db();
  d.exec(`DELETE FROM events; DELETE FROM email_outbox; DELETE FROM order_addons; DELETE FROM order_lines; DELETE FROM orders;
    DELETE FROM cart_addons; DELETE FROM cart_lines; DELETE FROM carts; DELETE FROM designs; DELETE FROM uploads; DELETE FROM discounts;
    DELETE FROM bundle_tiers; DELETE FROM addons; DELETE FROM variants; DELETE FROM products;`);
  d.exec(`INSERT INTO products (id, handle, title) VALUES (1, 'pearl-pet-portrait', 'Pearl Pet Portrait');
    INSERT INTO variants (id, product_id, sku, size, price_cents) VALUES (10, 1, 'S', '8×8', 3998), (11, 1, 'M', '12×12', 5998);
    INSERT INTO bundle_tiers (min_qty, percent_off) VALUES (2, 10);
    INSERT INTO designs (id, product_id, mode, status, style, pet_name) VALUES ('DSN-OK0001', 1, 'ai', 'confirmed', 'ocean', 'Mochi');
    INSERT INTO discounts (code, kind, value, min_subtotal_cents, ends_at, usage_limit, active) VALUES
      ('SAVE10', 'percent', 10, NULL, NULL, NULL, 1),
      ('FIVE', 'fixed', 500, 5000, NULL, NULL, 1),
      ('OLD', 'percent', 20, NULL, '2020-01-01 00:00:00', NULL, 1),
      ('ONCE', 'fixed', 1000, NULL, NULL, 1, 1),
      ('SHIP', 'free_shipping', 0, NULL, NULL, NULL, 1),
      ('QUARTER', 'percent', 25, NULL, NULL, NULL, 1),
      ('OFF', 'percent', 50, NULL, NULL, NULL, 0);`);
});

const cartWith = (variant: number, qty = 1) => { const id = ensureCart(null); addLine(id, { variant_id: variant, qty, design_id: 'DSN-OK0001' }); return id; };

describe('discount codes at checkout', () => {
  it('rejects unknown, expired, disabled and below-minimum codes with a clear reason', () => {
    const id = cartWith(10); // $39.98
    expect(err(() => applyDiscountCode(id, 'NOPE'))).toBe("404 discount_not_found: We couldn't find the code NOPE. Check the spelling and try again.");
    expect(err(() => applyDiscountCode(id, 'old'))).toBe('410 discount_expired: The code OLD expired on Jan 1, 2020.');
    expect(err(() => applyDiscountCode(id, 'OFF'))).toBe('410 discount_inactive: The code OFF is no longer available.');
    expect(err(() => applyDiscountCode(id, 'FIVE'))).toBe('422 discount_min_subtotal: The code FIVE needs an order of $50.00 or more. Add $10.02 more to use it.');
    expect(getCart(id).discount).toBeNull();
    expect(err(() => applyDiscountCode(ensureCart(null), 'SAVE10'))).toMatch(/^409 cart_empty/);
  });

  it('recomputes the code on the server; with no multi-portrait discount the code simply applies', () => {
    const id = cartWith(10);
    applyDiscountCode(id, 'save10'); // case-insensitive
    const v = getCart(id);
    expect(v.discount).toMatchObject({ code: 'SAVE10', amount_cents: 400, free_shipping: false, summary: '10% off' });
    expect(v.totals).toMatchObject({ subtotal_cents: 3998, discount_cents: 0, code_discount_cents: 400, shipping_cents: 699, total_cents: 3998 - 400 + 699 });
    expect(v.discount_note).toBeNull();
  });

  it('never stacks: the multi-portrait discount wins when the code is not better (ties included)', () => {
    const id = cartWith(10, 3); // 3 × 39.98 = 119.94; bundle 10% = 11.99; code 10% = 11.99 → tie
    applyDiscountCode(id, 'SAVE10');
    const v = getCart(id);
    expect(v.discount).toBeNull();
    expect(v.discount_error).toBeNull();
    expect(v.discount_note).toEqual({ code: 'SAVE10', message: NOT_BETTER });
    expect(NOT_BETTER).toMatch(/^Your bundle discount is already better/);
    expect(v.bundle.saving).toBe('10% multi-portrait discount applied');
    expect(v.totals).toMatchObject({ discount_cents: 1199, code_discount_cents: 0, shipping_cents: 0, total_cents: 11994 - 1199 });
    const { order_number } = placeOrder(id, checkout); // không chặn checkout
    expect(db().prepare('SELECT discount_code, discount_cents, code_discount_cents FROM orders WHERE number = ?').get(order_number)).toEqual({ discount_code: null, discount_cents: 1199, code_discount_cents: 0 });
  });

  it('never stacks: a better code replaces the multi-portrait discount', () => {
    const id = cartWith(10, 3);
    applyDiscountCode(id, 'QUARTER'); // 25% of 119.94 = 29.99 > bundle 11.99
    const v = getCart(id);
    expect(v.discount).toMatchObject({ code: 'QUARTER', amount_cents: 2999 });
    expect(v.discount_note).toBeNull();
    expect(v.bundle.saving).toBeNull();
    expect(v.totals).toMatchObject({ discount_cents: 0, code_discount_cents: 2999, shipping_cents: 0, total_cents: 11994 - 2999 });
    updateLine(id, v.lines[0].id, 1); // hết bậc số lượng → mã vẫn áp
    expect(getCart(id).totals).toMatchObject({ discount_cents: 0, code_discount_cents: 1000, total_cents: 3998 - 1000 + 699 });
    updateLine(id, v.lines[0].id, 3);
    const { order_number } = placeOrder(id, checkout);
    expect(db().prepare('SELECT discount_code, discount_cents, code_discount_cents, total_cents FROM orders WHERE number = ?').get(order_number))
      .toEqual({ discount_code: 'QUARTER', discount_cents: 0, code_discount_cents: 2999, total_cents: 8995 });
  });

  it('free-shipping codes zero the shipping line only', () => {
    const id = cartWith(10);
    applyDiscountCode(id, 'SHIP');
    const v = getCart(id);
    expect(v.discount).toMatchObject({ code: 'SHIP', free_shipping: true, amount_cents: 699 });
    expect(v.totals).toMatchObject({ code_discount_cents: 0, shipping_cents: 0, total_cents: 3998 });
    expect(getCart(id, 'express').totals.shipping_cents).toBe(0);
  });

  it('saves the code and amount on the order, and counts it against the usage limit', () => {
    const id = cartWith(11); // 59.98
    applyDiscountCode(id, 'ONCE');
    const { order_number } = placeOrder(id, checkout);
    const row = db().prepare('SELECT discount_code, code_discount_cents, total_cents FROM orders WHERE number = ?').get(order_number) as Record<string, unknown>;
    expect(row).toEqual({ discount_code: 'ONCE', code_discount_cents: 1000, total_cents: 5998 - 1000 + 699 });
    expect(getOrder(order_number)).toMatchObject({ discount_code: 'ONCE', totals: { code_discount_cents: 1000 } });
    const mail = db().prepare('SELECT html FROM email_outbox ORDER BY id DESC LIMIT 1').get() as { html: string };
    expect(mail.html).toContain('Discount ONCE');
    expect((db().prepare('SELECT discount_code FROM carts WHERE id = ?').get(id) as { discount_code: string | null }).discount_code).toBeNull();

    const again = cartWith(11);
    expect(err(() => applyDiscountCode(again, 'ONCE'))).toBe('410 discount_used_up: The code ONCE has reached its usage limit.');
  });

  it('keeps a code that stopped qualifying visible with its reason, and blocks checkout until it is removed', () => {
    const id = cartWith(11, 1); // 59.98 ≥ 50
    applyDiscountCode(id, 'FIVE');
    expect(getCart(id).totals.code_discount_cents).toBe(500);
    db().prepare("UPDATE discounts SET min_subtotal_cents = 9000 WHERE code = 'FIVE'").run(); // merchant raises the minimum
    const v = getCart(id);
    expect(v.discount).toBeNull();
    expect(v.discount_error?.message).toBe('The code FIVE needs an order of $90.00 or more. Add $30.02 more to use it.');
    expect(v.totals.total_cents).toBe(5998 + 699);
    expect(err(() => placeOrder(id, checkout))).toMatch(/^409 discount_invalid: The code FIVE needs an order of \$90\.00 or more\..* Remove the code to continue\.$/);
    removeDiscountCode(id);
    expect(err(() => placeOrder(id, checkout))).toBe('ok');
  });

  it('never goes below zero and messages minimum quantity', () => {
    const d = { id: 1, code: 'BIG', kind: 'fixed' as const, value: 99999, min_subtotal_cents: null, min_qty: 2, starts_at: null, ends_at: null, usage_limit: null, active: 1 as const, created_at: '' };
    expect(evaluateDiscount(d, { subtotal_cents: 3000, qty: 1 }, 0)).toEqual({ ok: false, reason: 'min_qty' });
    expect(evaluateDiscount(d, { subtotal_cents: 3000, qty: 2, base_cents: 2700 }, 0)).toEqual({ ok: true, discount_cents: 2700, free_shipping: false });
    expect(rejectionMessage('BIG', 'min_qty', d, { subtotal_cents: 3000, qty: 1 })).toBe('The code BIG needs 2 or more portraits in your cart. Add 1 more to use it.');
  });

  it('lists only active codes flagged for the PDP, in tier order, and the seeded tiers apply by quantity', () => {
    seedDiscounts(db());
    seedDiscounts(db()); // chạy lại được
    db().exec(`INSERT INTO discounts (code, kind, value, min_subtotal_cents, ends_at, active, show_on_pdp) VALUES
      ('SPEND80', 'fixed', 800, 8000, NULL, 1, 1), ('GONE', 'percent', 30, NULL, '2020-01-01 00:00:00', 1, 1), ('PAUSED', 'percent', 30, NULL, NULL, 0, 1)`);
    expect(pdpCodes()).toEqual([
      { code: 'SPEND80', spend: 'Spend $80.00', get: '$8.00 off' },
      { code: 'PEARL2', spend: 'Buy 2 items', get: '15% off' },
      { code: 'PEARL3', spend: 'Buy 3 items', get: '20% off' },
      { code: 'PEARL5', spend: 'Buy 5 items', get: '25% off' },
    ]); // SAVE10 (not flagged), GONE (expired), PAUSED (disabled) stay off the PDP

    const id = cartWith(10, 2);
    expect(err(() => applyDiscountCode(id, 'pearl3'))).toBe('422 discount_min_qty: The code PEARL3 needs 3 or more portraits in your cart. Add 1 more to use it.');
    updateLine(id, getCart(id).lines[0].id, 3);
    applyDiscountCode(id, 'pearl3');
    expect(getCart(id).totals).toMatchObject({ discount_cents: 0, code_discount_cents: 2399 }); // 20% > bậc tự động, không cộng dồn
  });
});
