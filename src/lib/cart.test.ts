import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

// DB riêng cho file test này — phải đặt trước khi import db.ts.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pa-cart-'));
process.env.DB_PATH = path.join(tmp, 'store.db');
process.env.STORAGE_DIR = path.join(tmp, 'storage');

const { db } = await import('./db');
const cart = await import('./cart');
const { CartError, addLine, bundleHint, ensureCart, getCart, getOrder, mediaUrl, placeOrder, removeLine, setAddon, updateLine } = cart;

afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

const address = { line1: '1 Pearl St', line2: '', city: 'Austin', region: 'TX', postal_code: '78701', country: 'US' };
const checkout = (method: 'standard' | 'express' = 'standard') => ({ email: 'jo@example.com', name: 'Jo Tester', address, shipping_method: method });

function seed() {
  const d = db();
  d.exec(`DELETE FROM events; DELETE FROM email_outbox; DELETE FROM order_addons; DELETE FROM order_lines; DELETE FROM orders;
    DELETE FROM cart_addons; DELETE FROM cart_lines; DELETE FROM carts; DELETE FROM designs; DELETE FROM uploads;
    DELETE FROM bundle_tiers; DELETE FROM addons; DELETE FROM variants; DELETE FROM products;`);
  d.exec(`INSERT INTO products (id, handle, title) VALUES (1, 'pearl-pet-portrait', 'Pearl Pet Portrait'), (2, 'framed', 'Framed Portrait');
    UPDATE products SET frame_included = 1 WHERE id = 2;
    INSERT INTO variants (id, product_id, sku, size, price_cents) VALUES (10, 1, 'S', '8×8', 3998), (11, 1, 'M', '12×12', 5998), (20, 2, 'F', '12×12', 7998);
    INSERT INTO addons (id, handle, title, kind, price_cents, text_input) VALUES (1, 'frame', 'Gold frame', 'frame', 1398, 0), (2, 'card', 'Gift card', 'card', 499, 1);
    INSERT INTO bundle_tiers (min_qty, percent_off) VALUES (2, 10), (3, 15), (5, 20);
    INSERT INTO designs (id, product_id, mode, status, style, pet_name, preview_path) VALUES
      ('DSN-OK0001', 1, 'ai', 'confirmed', 'royal-starry', 'Mochi', 'previews/DSN-OK0001.webp'),
      ('DSN-REV001', 1, 'designer', 'in_review', NULL, 'Bo', NULL),
      ('DSN-DRAFT1', 1, 'ai', 'ready', 'ocean', 'Kit', 'previews/DSN-DRAFT1.webp'),
      ('DSN-FRAME1', 2, 'ai', 'confirmed', 'ocean', NULL, 'https://cdn.example.com/x.webp');`);
}

beforeEach(seed);

const code = (fn: () => unknown) => { try { fn(); } catch (e) { return e instanceof CartError ? `${e.status} ${e.code}` : String(e); } return 'ok'; };

describe('cart lines', () => {
  it('rejects designs that are not confirmed or in review with 409', () => {
    const id = ensureCart(null);
    expect(code(() => addLine(id, { variant_id: 10, qty: 1, design_id: 'DSN-DRAFT1' }))).toBe('409 design_not_confirmed');
    expect(code(() => addLine(id, { variant_id: 10, qty: 1, design_id: 'DSN-NOPE00' }))).toBe('404 design_not_found');
    expect(code(() => addLine(id, { variant_id: 20, qty: 1, design_id: 'DSN-OK0001' }))).toBe('400 design_product_mismatch');
    expect(code(() => addLine(id, { variant_id: 11, qty: 1, design_id: 'DSN-REV001' }))).toBe('ok');
  });

  it('shows only visible properties and a thumbnail, never "_" keys or URLs as text (#5)', () => {
    const id = ensureCart(null);
    addLine(id, { variant_id: 10, qty: 1, design_id: 'DSN-OK0001' });
    addLine(id, { variant_id: 11, qty: 1, design_id: 'DSN-REV001' });
    const v = getCart(id);
    expect(v.lines[0].properties).toEqual({ 'Pet name': 'Mochi', Style: 'Starry King' });
    expect(v.lines[1].properties).toEqual({ 'Pet name': 'Bo', Style: 'Designer finish' });
    expect(v.lines[0].thumbnail_url).toBe('/media/previews/DSN-OK0001.webp');
    expect(JSON.stringify(v.lines.map((l) => l.properties))).not.toMatch(/http|\/media|_design_id|_print_url/);
    // Hidden props are still stored for the workshop.
    const raw = db().prepare('SELECT properties FROM cart_lines WHERE cart_id = ? ORDER BY id').get(id) as { properties: string };
    expect(JSON.parse(raw.properties)).toMatchObject({ _design_id: 'DSN-OK0001', _preview_url: '/media/previews/DSN-OK0001.webp' });
  });

  it('drops thumbnails that point outside storage', () => {
    expect(mediaUrl('https://cdn.example.com/x.webp')).toBeNull();
    expect(mediaUrl('../etc/passwd')).toBeNull();
    expect(mediaUrl('storage/../secret')).toBeNull();
  });

  it('merges the same design + size, updates and removes lines only in the owning cart', () => {
    const id = ensureCart(null);
    const other = ensureCart(null);
    addLine(id, { variant_id: 10, qty: 1, design_id: 'DSN-OK0001' });
    addLine(id, { variant_id: 10, qty: 2, design_id: 'DSN-OK0001' });
    const v = getCart(id);
    expect(v.lines).toHaveLength(1);
    expect(v.count).toBe(3);
    expect(code(() => updateLine(other, v.lines[0].id, 1))).toBe('404 line_not_found');
    updateLine(id, v.lines[0].id, 1);
    expect(getCart(id).count).toBe(1);
    removeLine(id, v.lines[0].id);
    expect(getCart(id).lines).toHaveLength(0);
  });
});

describe('bundle + totals', () => {
  const tiers = [{ min_qty: 2, percent_off: 10 }, { min_qty: 3, percent_off: 15 }];
  it('suggests the next tier', () => {
    expect(bundleHint(0, tiers).hint).toBeNull();
    expect(bundleHint(1, tiers).hint).toBe('Add 1 more to save 10%');
    expect(bundleHint(2, tiers)).toMatchObject({ hint: 'Add 1 more to save 15%', saving: '10% multi-portrait discount applied' });
    expect(bundleHint(3, tiers).hint).toBeNull();
  });

  it('totals come from pricing.totals with DB prices and selected add-ons', () => {
    const id = ensureCart(null);
    addLine(id, { variant_id: 11, qty: 2, design_id: 'DSN-OK0001' });
    setAddon(id, { addon_id: 2, on: true, text: 'Happy birthday!' });
    const v = getCart(id);
    // 2 × 59.98 = 119.96, −10% = 107.96 → free standard shipping; card 4.99.
    expect(v.totals).toEqual({ subtotal_cents: 11996, discount_cents: 1200, addons_cents: 499, shipping_cents: 0, total_cents: 11295 });
    expect(v.addons.find((a) => a.id === 2)).toMatchObject({ on: true, text: 'Happy birthday!', text_free: true });
    expect(getCart(id, 'express').totals.shipping_cents).toBe(1999);
    setAddon(id, { addon_id: 2, on: false });
    expect(getCart(id).totals.addons_cents).toBe(0);
  });

  it('hides the frame add-on when every product already includes a frame (#3)', () => {
    const id = ensureCart(null);
    addLine(id, { variant_id: 20, qty: 1, design_id: 'DSN-FRAME1' });
    expect(getCart(id).addons.map((a) => a.kind)).toEqual(['card']);
    expect(code(() => setAddon(id, { addon_id: 1, on: true }))).toBe('404 addon_not_found');
    addLine(id, { variant_id: 10, qty: 1, design_id: 'DSN-OK0001' });
    expect(getCart(id).addons.map((a) => a.kind)).toEqual(['frame', 'card']);
  });
});

describe('checkout', () => {
  it('creates the order with design ids, emails a confirmation, fires an event and empties the cart', () => {
    const id = ensureCart(null);
    addLine(id, { variant_id: 10, qty: 1, design_id: 'DSN-OK0001' });
    setAddon(id, { addon_id: 1, on: true });
    const { order_number } = placeOrder(id, checkout('express'), 's_test123');
    expect(order_number).toBe('1001');
    const o = getOrder(order_number)!;
    expect(o.lines[0]).toMatchObject({ design_id: 'DSN-OK0001', properties: { 'Pet name': 'Mochi', Style: 'Starry King' } });
    expect(o.totals).toEqual({ subtotal_cents: 3998, discount_cents: 0, addons_cents: 1398, shipping_cents: 1999, total_cents: 7395 });
    expect(o.addons).toEqual([{ title: 'Gold frame', price_cents: 1398, text: null }]);
    const line = db().prepare('SELECT sku, properties FROM order_lines').get() as { sku: string; properties: string };
    expect(line.sku).toBe('S');
    expect(JSON.parse(line.properties)._design_id).toBe('DSN-OK0001');
    const mail = db().prepare('SELECT to_addr, kind, subject, html FROM email_outbox').get() as Record<string, string>;
    expect(mail).toMatchObject({ to_addr: 'jo@example.com', kind: 'order_confirmation' });
    expect(mail.subject).toContain('#1001');
    expect(mail.html).toContain('DSN-OK0001');
    expect(db().prepare("SELECT session_id FROM events WHERE name = 'checkout_completed'").get()).toEqual({ session_id: 's_test123' });
    expect(getCart(id).lines).toHaveLength(0);
    expect(code(() => placeOrder(id, checkout()))).toBe('409 cart_empty');
  });

  it('numbers orders sequentially and refuses regions not shipped to', () => {
    const id = ensureCart(null);
    addLine(id, { variant_id: 10, qty: 1, design_id: 'DSN-OK0001' });
    expect(code(() => placeOrder(id, { ...checkout(), address: { ...address, country: 'FR' } }))).toBe('400 region_not_shipped');
    expect(placeOrder(id, checkout()).order_number).toBe('1001');
    addLine(id, { variant_id: 10, qty: 1, design_id: 'DSN-OK0001' });
    expect(placeOrder(id, checkout()).order_number).toBe('1002');
  });

  it('re-checks design status at checkout', () => {
    const id = ensureCart(null);
    addLine(id, { variant_id: 10, qty: 1, design_id: 'DSN-OK0001' });
    db().prepare("UPDATE designs SET status = 'rejected' WHERE id = 'DSN-OK0001'").run();
    expect(code(() => placeOrder(id, checkout()))).toBe('409 design_not_confirmed');
    expect(db().prepare('SELECT count(*) n FROM orders').get()).toEqual({ n: 0 });
  });

  it('escapes customer input in the confirmation email', () => {
    const id = ensureCart(null);
    addLine(id, { variant_id: 10, qty: 1, design_id: 'DSN-OK0001' });
    placeOrder(id, { ...checkout(), name: '<img src=x onerror=alert(1)> Jo' });
    const { html } = db().prepare('SELECT html FROM email_outbox').get() as { html: string };
    expect(html).not.toContain('<img');
  });

  it('remembers at most 10 order numbers per browser', () => {
    let v: string | undefined;
    for (let i = 1001; i <= 1012; i++) v = cart.addOrderToCookie(v, String(i));
    expect(cart.ordersFromCookie(v)).toHaveLength(10);
    expect(cart.ordersFromCookie('1001.<x>.1002')).toEqual(['1001', '1002']);
  });
});
