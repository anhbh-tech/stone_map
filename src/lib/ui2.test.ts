// UI-2: tài khoản khách, tìm kiếm FTS5, collections + lọc / sắp xếp / phân trang, tra đơn.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pearl-ui2-'));
process.env.DB_PATH = path.join(dir, 'store.db');
const { db } = await import('./db');
const { seedCollections } = await import('../../scripts/seed-collections');
const L = await import('./listing');
const C = await import('./customer');
const A = await import('./account');
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

const d = db();
const main = d.prepare("INSERT INTO products (handle, title, subtitle, description_html) VALUES ('pearl-pet-portrait', 'Pearl Pet Portrait', 'Your pet in pearls', '<p>Printed on canvas.</p>') RETURNING id").get() as { id: number };
d.prepare("INSERT INTO variants (product_id, sku, size, price_cents, compare_at_cents, position) VALUES (?, 'P-8', '8×8', 3998, 5998, 0), (?, 'P-12', '12×12', 5998, NULL, 1)").run(main.id, main.id);
seedCollections(d);
const q = (p: Partial<import('./listing').ListQuery> = {}) => ({ theme: [], type: [], price: null, sort: 'featured' as const, page: 1, ...p });

describe('ftsQuery', () => {
  it('turns free text into quoted prefix terms and drops FTS syntax', () => {
    expect(L.ftsQuery('Christmas  kit')).toBe('"christmas"* "kit"*');
    expect(L.ftsQuery('"*) OR (')).toBe('"or"*');
    expect(L.ftsQuery('  -- ')).toBeNull();
  });

  it('ranks real products above demo listings for best match and featured', () => {
    const real = d.prepare("INSERT INTO products (handle, title, subtitle) VALUES ('ui2-real-dog', 'Zebra Portrait', 'Real one') RETURNING id").get() as { id: number };
    d.prepare("INSERT INTO variants (product_id, sku, size, price_cents, position) VALUES (?, 'ZD-8', '8×8', 3998, 0)").run(real.id);
    d.prepare("INSERT INTO product_tags (product_id, tag) VALUES (?, 'dog')").run(real.id);
    d.exec("INSERT INTO products_fts(products_fts) VALUES ('rebuild')");
    try {
      const demosLast = (items: { demo: boolean }[]) => items.findIndex((i) => i.demo) > items.findLastIndex((i) => !i.demo);
      const best = L.listProducts({ fts: L.ftsQuery('dog')! }, q({ sort: 'relevance' }), 100).items;
      expect(best.some((i) => i.demo) && best.some((i) => !i.demo)).toBe(true);
      expect(demosLast(best)).toBe(true);
      expect(demosLast(L.listProducts({ collectionId: null }, q(), 100).items)).toBe(true);
    } finally {
      d.prepare('DELETE FROM products WHERE id = ?').run(real.id);
      d.exec("INSERT INTO products_fts(products_fts) VALUES ('rebuild')");
    }
  });

  it('expands common shorthand (xmas, kitty, puppy) so it still finds the catalogue word', () => {
    expect(L.ftsQuery('xmas kit')).toBe('("xmas"* OR "christmas"*) "kit"*');
    expect(L.ftsQuery('Kitty')).toBe('("kitty"* OR "cat"*)');
    expect(L.listProducts({ fts: L.ftsQuery('xmas')! }, q({ sort: 'relevance' })).total).toBeGreaterThan(0);
  });
});

describe('search', () => {
  it('finds products by title, tag and collection name, prefix-matched', () => {
    const titles = (s: string) => L.listProducts({ fts: L.ftsQuery(s)! }, q({ sort: 'relevance' })).items.map((p) => p.title);
    expect(titles('christ')).toContain('Christmas Scarf Pet Portrait');
    expect(titles('ornament')).toEqual(expect.arrayContaining(['Memorial Pearl Ornament', 'Christmas Pearl Ornament']));
    expect(titles('gifts under')).toContain('Pet Pearl Art Kit'); // chỉ khớp qua tên collection
    expect(titles('canvas')).toContain('Pearl Pet Portrait'); // mô tả / tag của sản phẩm thật
    expect(titles('zzzqqq')).toEqual([]);
  });

  it('keeps the index in sync when a product is renamed or tagged', () => {
    d.prepare("UPDATE products SET title = 'Pearl Pet Portrait Deluxe' WHERE id = ?").run(main.id);
    expect(L.suggest('delux').map((s) => s.handle)).toEqual(['pearl-pet-portrait']);
    d.prepare("INSERT INTO product_tags (product_id, tag) VALUES (?, 'hamster')").run(main.id);
    expect(L.suggest('hamst').map((s) => s.handle)).toEqual(['pearl-pet-portrait']);
  });

  it('hides archived products', () => {
    d.prepare("UPDATE products SET status = 'archived' WHERE handle = 'demo-royal-cat-portrait'").run();
    try {
      expect(L.suggest('royal cat').map((s) => s.handle)).not.toContain('demo-royal-cat-portrait');
    } finally {
      d.prepare("UPDATE products SET status = 'active' WHERE handle = 'demo-royal-cat-portrait'").run();
    }
  });
});

describe('collections', () => {
  const col = (h: string) => L.getCollection(h)!.id;

  it('filters by theme, type and price band, and counts facets from the collection', () => {
    const pets = { collectionId: col('pet-portraits') };
    expect(L.listProducts(pets, q({ theme: ['memorial'] })).items.map((p) => p.handle)).toEqual(['demo-rainbow-bridge-portrait']);
    const kits = L.listProducts({ collectionId: col('diy-kits') }, q({ price: 'under-50' }));
    expect(kits.items.every((p) => p.price_cents < 5000)).toBe(true);
    const f = L.facets({ collectionId: col('memorial') });
    expect(f.type.map((t) => t.value).sort()).toEqual(['canvas', 'diy-kit', 'ornament']);
  });

  it('sorts by price and paginates the virtual "all" collection', () => {
    const asc = L.listProducts({ collectionId: null }, q({ sort: 'price-asc' }), 5);
    expect(asc.total).toBe(12);
    expect(asc.pages).toBe(3);
    const prices = asc.items.map((p) => p.price_cents);
    expect(prices).toEqual([...prices].sort((a, b) => a - b));
    const last = L.listProducts({ collectionId: null }, q({ sort: 'price-asc', page: 99 }), 5);
    expect(last.page).toBe(3);
    expect(last.items).toHaveLength(2);
  });

  it('marks demo products and shows the lowest variant price with its compare-at price', () => {
    const all = L.listProducts({ collectionId: null }, q(), 50).items;
    const real = all.find((p) => p.handle === 'pearl-pet-portrait')!;
    expect(real).toMatchObject({ demo: false, price_cents: 3998, compare_at_cents: 5998, sizes: 2 });
    expect(all.filter((p) => p.demo)).toHaveLength(11);
  });

  it('parses query strings defensively', () => {
    const s = L.parseListQuery({ theme: ['christmas', 'x y', 'memorial'], price: 'free', sort: 'nope', page: '-3' }, L.COLLECTION_SORTS);
    expect(s).toEqual({ theme: ['christmas', 'memorial'], type: [], price: null, sort: 'featured', page: 1 });
  });
});

describe('customer accounts', () => {
  it('registers, rejects duplicate emails case-insensitively, and signs in', () => {
    const c = C.registerCustomer({ name: 'Mai Tran', email: 'Mai@Example.com', password: 'correct horse' });
    expect(c.email).toBe('mai@example.com');
    expect(() => C.registerCustomer({ name: 'X', email: 'MAI@example.com', password: 'whatever12' })).toThrow(/already exists/);
    expect(C.checkCustomer('mai@EXAMPLE.com', 'correct horse')).toMatchObject({ id: c.id });
    expect(C.checkCustomer('mai@example.com', 'wrong')).toBeNull();
    expect(C.checkCustomer('nobody@example.com', 'correct horse')).toBeNull();
  });

  it('stores only a hash of the session token and expires it', () => {
    const c = C.checkCustomer('mai@example.com', 'correct horse')!;
    const now = new Date('2026-09-30T00:00:00Z');
    const { token } = C.createCustomerSession(c.id, now);
    expect(d.prepare('SELECT count(*) AS n FROM customer_sessions WHERE token = ?').get(token)).toEqual({ n: 0 });
    expect(C.customerForToken(token, now)?.id).toBe(c.id);
    expect(C.customerForToken(token, new Date(now.getTime() + C.CUSTOMER_TTL_S * 1000 + 1))).toBeNull();
    C.destroyCustomerSession(token);
    expect(C.customerForToken(token, now)).toBeNull();
  });

  it('password reset: emails a one-time, 1-hour link only for real accounts, then replaces the password', () => {
    const now = new Date('2026-10-01T10:00:00Z');
    const outbox = () => d.prepare("SELECT to_addr, html FROM email_outbox WHERE kind = 'password_reset' ORDER BY id").all() as { to_addr: string; html: string }[];
    expect(C.requestPasswordReset('nobody@example.com', now)).toBeNull();
    expect(outbox()).toHaveLength(0);

    const token = C.requestPasswordReset('MAI@example.com', now)!;
    expect(token).toMatch(/^[\w-]{43}$/);
    const mail = outbox().at(-1)!;
    expect(mail.to_addr).toBe('mai@example.com');
    expect(mail.html).toContain(`/account/reset?token=${token}`);
    expect(d.prepare('SELECT count(*) AS n FROM customer_password_resets WHERE token = ?').get(token)).toEqual({ n: 0 });

    const { token: session } = C.createCustomerSession(C.checkCustomer('mai@example.com', 'correct horse')!.id, now);
    expect(() => C.resetPassword(token, 'new pearls 2026', new Date(now.getTime() + 3601_000))).toThrow(/expired/);
    expect(C.resetPassword(token, 'new pearls 2026', now).email).toBe('mai@example.com');
    expect(C.checkCustomer('mai@example.com', 'new pearls 2026')).not.toBeNull();
    expect(C.checkCustomer('mai@example.com', 'correct horse')).toBeNull();
    expect(C.customerForToken(session, now)).toBeNull(); // phiên cũ ở máy khác bị đăng xuất
    expect(() => C.resetPassword(token, 'again again', now)).toThrow(/expired or was already used/);

    // Tối đa 3 email / giờ / tài khoản: không spam hộp thư của khách.
    for (let i = 0; i < 5; i++) C.requestPasswordReset('mai@example.com', new Date(now.getTime() + i * 1000));
    expect(outbox()).toHaveLength(3);
    C.resetPassword(C.requestPasswordReset('mai@example.com', new Date(now.getTime() + 3700_000))!, 'correct horse', new Date(now.getTime() + 3700_000));
  });

  it('only redirects to internal paths after sign in', () => {
    expect(C.safeAccountNext('/checkout')).toBe('/checkout');
    expect(C.safeAccountNext('//evil.example')).toBe('/account');
    expect(C.safeAccountNext('https://evil.example')).toBe('/account');
    expect(C.safeAccountNext('/account/login')).toBe('/account');
  });
});

describe('orders and addresses', () => {
  let c: import('./customer').Customer;
  const addr = { line1: '1 Main St', line2: '', city: 'Austin', region: 'TX', postal_code: '78701', country: 'US' };
  beforeAll(() => {
    c = C.checkCustomer('mai@example.com', 'correct horse')!;
    d.prepare("INSERT INTO designs (id, product_id, mode, status) VALUES ('DSN-UI2A', ?, 'designer', 'in_review')").run(main.id);
    const order = d.prepare(`INSERT INTO orders (number, email, name, address, shipping_method, subtotal_cents, total_cents)
    VALUES ('1001', 'Mai@example.com', 'Mai Tran', ?, 'standard', 5998, 5998) RETURNING id`).get(JSON.stringify(addr)) as { id: number };
    d.prepare("INSERT INTO order_lines (order_id, product_title, variant_size, sku, qty, unit_cents, design_id, properties) VALUES (?, 'Pearl Pet Portrait', '12×12', 'P-12', 1, 5998, 'DSN-UI2A', ?)")
      .run(order.id, JSON.stringify({ 'Pet name': 'Bo', _preview_url: '/media/previews/x.webp' }));
  });

  it('attaches an order to the signed-in customer once and shows design status', () => {
    expect(A.ordersForCustomer(c.id)).toEqual([]);
    A.attachOrderToCustomer('1001', c.id);
    const [o] = A.ordersForCustomer(c.id);
    expect(o).toMatchObject({ number: '1001', status: 'paid', items: 1, designs: [{ id: 'DSN-UI2A', status: 'in_review' }] });
    expect(A.customerOrder(c.id, '1001')?.lines[0].properties).toEqual({ 'Pet name': 'Bo' });
    expect(A.customerOrder(c.id + 1, '1001')).toBeNull();
  });

  it('tracks an order by number + email without exposing the street address', () => {
    const t = A.trackOrder(A.TrackInput.parse({ number: '#1001', email: 'mai@EXAMPLE.com' }))!;
    expect(t).toMatchObject({ number: '1001', ship_to: 'Austin, TX', lines: [{ design_status: 'in_review', pet_name: 'Bo' }] });
    expect(JSON.stringify(t)).not.toContain('Main St');
    expect(A.trackOrder({ number: '1001', email: 'other@example.com' })).toBeNull();
  });

  it('keeps exactly one default address', () => {
    const a1 = A.addAddress(c.id, addr, false);
    const a2 = A.addAddress(c.id, { ...addr, line1: '2 Oak Ave' }, true);
    expect(A.listAddresses(c.id).map((a) => [a.id, a.is_default])).toEqual([[a2, true], [a1, false]]);
    A.deleteAddress(c.id, a2);
    expect(A.listAddresses(c.id)).toMatchObject([{ id: a1, is_default: true }]);
    expect(() => A.deleteAddress(c.id + 1, a1)).toThrow(/no longer saved/);
  });
});
