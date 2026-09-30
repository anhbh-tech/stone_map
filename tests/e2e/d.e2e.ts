// Crew D e2e: store shell, giỏ, checkout, SEO, hiệu năng. Chạy: npx playwright test -c tests/e2e/d.config.ts
// Personalization (crew B) chưa có trên nhánh này → design được chèn thẳng vào DB, ảnh /media/** được mock bằng page.route.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { expect, test, type Page } from '@playwright/test';

const DB = process.env.E2E_D_DB!;
const ROOT = path.join(__dirname, '..', '..');
const PREVIEW = fs.readFileSync(path.join(ROOT, 'public', 'demo', 'cafe-duke.webp'));
const OK = 'DSN-E2EOK1', REVIEW = 'DSN-E2EREV', DRAFT = 'DSN-E2EDRF';
let variants: number[] = [];

function sql<T = unknown>(q: string, ...args: (string | number | null)[]): T[] {
  const d = new DatabaseSync(DB);
  try { return d.prepare(q).all(...args) as T[]; } finally { d.close(); }
}
function exec(q: string, ...args: (string | number | null)[]) {
  const d = new DatabaseSync(DB);
  try { d.prepare(q).run(...args); } finally { d.close(); }
}
function setSetting(key: string, patch: Record<string, unknown>) {
  const [row] = sql<{ value: string }>('SELECT value FROM settings WHERE key = ?', key);
  exec('UPDATE settings SET value = ? WHERE key = ?', JSON.stringify({ ...JSON.parse(row.value), ...patch }), key);
  return () => exec('UPDATE settings SET value = ? WHERE key = ?', row.value, key);
}

test.beforeAll(() => {
  const [p] = sql<{ id: number }>("SELECT id FROM products WHERE handle = 'pearl-pet-portrait'");
  variants = sql<{ id: number }>('SELECT id FROM variants WHERE product_id = ? ORDER BY position', p.id).map((v) => v.id);
  const ins = `INSERT INTO designs (id, product_id, mode, status, style, pet_name, preview_path) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET status = excluded.status`;
  exec(ins, OK, p.id, 'ai', 'confirmed', 'royal-starry', 'Mochi', `previews/${OK}.webp`);
  exec(ins, REVIEW, p.id, 'designer', 'in_review', null, 'Bo', null);
  exec(ins, DRAFT, p.id, 'ai', 'ready', 'ocean', 'Kit', `previews/${DRAFT}.webp`);
});

test.beforeEach(async ({ page }) => {
  // /media/** thuộc crew B: trả ảnh mẫu.
  await page.route('**/media/**', (r) => r.fulfill({ status: 200, contentType: 'image/webp', body: PREVIEW }));
});

const add = (page: Page, design_id: string, variant = 0, qty = 1) =>
  page.request.post('/api/cart/lines', { data: { variant_id: variants[variant], qty, design_id } });

async function expectOneH1(page: Page) {
  await expect(page.locator('h1')).toHaveCount(1);
}

test('store shell: shipping banner comes from settings, one h1 per page, no popups', async ({ page }) => {
  for (const url of ['/', '/cart', '/policies/privacy', '/policies/shipping', '/policies/refund', '/orders/999999']) {
    await page.goto(url);
    await expectOneH1(page);
    await expect(page.getByTestId('shipping-banner')).toHaveText('Free US shipping on orders over $79.99');
    await expect(page.locator('[role="dialog"], dialog[open]')).toHaveCount(0);
  }
  const restore = setSetting('shipping', { free_over_cents: null, regions: ['US', 'CA'] });
  try {
    await page.goto('/');
    await expect(page.getByTestId('shipping-banner')).toHaveText('Shipping to US, CA');
  } finally { restore(); }
  // Header chỉ là link, h1 nằm trong <main>.
  await expect(page.locator('main h1')).toHaveCount(1);
});

test('cart API follows the contract', async ({ page }) => {
  const draft = await add(page, DRAFT);
  expect(draft.status()).toBe(409);
  expect((await draft.json()).error.code).toBe('design_not_confirmed');

  const form = await page.request.post('/api/cart/lines', { form: { variant_id: String(variants[0]), design_id: OK } });
  expect(form.status()).toBe(415);

  const ok = await add(page, OK);
  expect(ok.status()).toBe(200);
  const view = await ok.json();
  expect(view.lines).toHaveLength(1);
  expect(view.lines[0]).toMatchObject({ design_id: OK, properties: { 'Pet name': 'Mochi', Style: 'Starry King' } });
  expect(view.bundle.hint).toBe('Add 1 more to save 10%');

  const line = view.lines[0].id;
  expect((await page.request.patch(`/api/cart/lines/${line}`, { data: { qty: 3 } })).status()).toBe(200);
  expect((await (await page.request.get('/api/cart')).json()).totals.discount_cents).toBeGreaterThan(0);
  const addonId = view.addons.find((a: { kind: string }) => a.kind === 'card').id;
  const withCard = await (await page.request.put('/api/cart/addons', { data: { addon_id: addonId, on: true, text: 'Love you' } })).json();
  expect(withCard.addons.find((a: { id: number }) => a.id === addonId)).toMatchObject({ on: true, text: 'Love you' });
  const del = await page.request.delete(`/api/cart/lines/${line}`);
  expect((await del.json()).lines).toHaveLength(0);
  expect((await page.request.delete('/api/cart/lines/999999')).status()).toBe(404);
});

test('cart shows thumbnail + visible properties only, never URLs or "_" keys (#5)', async ({ page }) => {
  await add(page, OK, 1);
  await add(page, REVIEW, 0);
  await page.goto('/cart');
  await expectOneH1(page);
  const lines = page.getByTestId('cart-lines');
  await expect(lines.getByTestId('cart-line')).toHaveCount(2);
  await expect(lines.getByTestId('line-props').first()).toContainText('Mochi');
  await expect(lines.getByTestId('line-props').first()).toContainText('Starry King');
  await expect(lines.getByTestId('line-props').nth(1)).toContainText('Designer finish');
  await expect(lines.getByRole('img', { name: "Preview of Mochi's portrait" })).toBeVisible();

  const leaks = await lines.evaluate((root) => {
    const bad: string[] = [];
    for (const el of [root, ...root.querySelectorAll('*')])
      for (const a of el.attributes) if (/http/i.test(a.value)) bad.push(`${el.tagName}[${a.name}]=${a.value}`);
    return bad;
  });
  expect(leaks).toEqual([]);
  const text = await page.locator('main').innerText();
  expect(text).not.toMatch(/http|\/media\/|_design_id|_preview_url|_print_url/);

  await expect(page.getByTestId('bundle-hint')).toContainText('10% multi-portrait discount applied · Add 1 more to save 15%');
  await page.getByRole('group', { name: 'Quantity for Mochi' }).getByRole('button', { name: 'Increase quantity' }).click();
  await expect(page.getByTestId('bundle-hint')).toContainText('Add 2 more to save 20%');
  await expect(page.getByRole('link', { name: 'Cart, 3 items' })).toBeVisible();
});

test('checkout creates the order, keeps design_id and emails a confirmation', async ({ page, browser }) => {
  await add(page, OK, 0);
  await page.goto('/checkout');
  await expectOneH1(page);

  await page.getByRole('button', { name: /Place order/ }).click();
  const summary = page.getByRole('alert').filter({ hasText: 'There is a problem' });
  await expect(summary).toBeFocused();
  await expect(page.getByText('Enter an email address like name@example.com').first()).toBeVisible();

  const email = `jo+${Date.now()}@example.com`;
  await page.getByRole('textbox', { name: 'Email', exact: true }).fill(email);
  await page.getByLabel('Full name').fill('Jo Tester');
  await page.getByLabel('Address', { exact: true }).fill('1 Pearl Street');
  await page.getByLabel('City').fill('Austin');
  await page.getByLabel('State').fill('TX');
  await page.getByLabel('ZIP code').fill('78701');
  await page.getByRole('radio', { name: /Express/ }).check();
  await expect(page.getByRole('button', { name: /Place order · \$59\.97/ })).toBeVisible(); // 39.98 + express 19.99
  await page.getByRole('button', { name: /Place order/ }).click();

  await page.waitForURL(/\/orders\/\d+$/);
  await expectOneH1(page);
  await expect(page.locator('h1')).toHaveText('Thank you, Jo');
  await expect(page.getByRole('link', { name: 'Cart, 0 items' })).toBeVisible();
  const number = page.url().split('/').pop()!;

  const [order] = sql<{ id: number; email: string; shipping_method: string; total_cents: number }>('SELECT id, email, shipping_method, total_cents FROM orders WHERE number = ?', number);
  expect(order).toMatchObject({ email, shipping_method: 'express', total_cents: 5997 });
  expect(sql('SELECT design_id FROM order_lines WHERE order_id = ?', order.id)).toEqual([{ design_id: OK }]);
  const mails = sql<{ kind: string; subject: string }>('SELECT kind, subject FROM email_outbox WHERE to_addr = ?', email);
  expect(mails).toHaveLength(1);
  expect(mails[0]).toMatchObject({ kind: 'order_confirmation', subject: expect.stringContaining(`#${number}`) });
  expect(sql("SELECT 1 FROM events WHERE name = 'checkout_completed' AND payload LIKE ?", `%"order_number":"${number}"%`)).toHaveLength(1);

  // Trình duyệt khác không xem được chi tiết đơn.
  const other = await browser.newContext();
  const p2 = await other.newPage();
  await p2.goto(`/orders/${number}`);
  await expectOneH1(p2);
  await expect(p2.locator('main')).not.toContainText(email);
  await expect(p2.locator('main')).not.toContainText('Pearl Street');
  await other.close();

  // Giỏ trống → /checkout quay về /cart.
  await page.goto('/checkout');
  await expect(page).toHaveURL(/\/cart$/);
});

test('policies are generated from settings (#10)', async ({ page }) => {
  await page.goto('/policies/privacy');
  await expect(page.getByTestId('retention')).toContainText('30 days');
  await expect(page.getByTestId('processors')).toContainText('Google Gemini (AI generation)');
  const restore = setSetting('privacy', { retention_days: 45, processors: ['OpenAI (image generation)'] });
  try {
    await page.reload();
    await expect(page.getByTestId('retention')).toContainText('45 days');
    await expect(page.getByTestId('processors')).toContainText('OpenAI (image generation)');
  } finally { restore(); }
  await page.goto('/policies/shipping');
  await expect(page.locator('main')).toContainText('$6.99');
  await expect(page.locator('main')).toContainText('$19.99');
  expect((await page.request.get('/policies/unknown')).status()).toBe(404);
});

test('SEO: canonical, JSON-LD, robots and sitemap (#9)', async ({ page, baseURL }) => {
  await page.goto('/');
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', new RegExp(`^${baseURL}/?$`));
  const ld = (await page.locator('script[type="application/ld+json"]').allTextContents()).map((t) => JSON.parse(t));
  expect(ld.map((x) => x['@type'])).toEqual(expect.arrayContaining(['Organization', 'WebSite']));
  await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', /pearl-mosaic portrait/);

  await page.goto('/policies/shipping');
  const crumbs = (await page.locator('script[type="application/ld+json"]').allTextContents()).map((t) => JSON.parse(t));
  expect(crumbs.find((x) => x['@type'] === 'BreadcrumbList').itemListElement).toHaveLength(2);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', `${baseURL}/policies/shipping`);

  await page.goto('/cart');
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);

  const robots = await (await page.request.get('/robots.txt')).text();
  expect(robots).toContain('Disallow: /checkout');
  expect(robots).toContain(`Sitemap: ${baseURL}/sitemap.xml`);
  const sitemap = await (await page.request.get('/sitemap.xml')).text();
  expect(sitemap).toContain(`${baseURL}/products/pearl-pet-portrait`);
  expect(sitemap).toContain(`${baseURL}/policies/privacy`);
});

test('performance: home < 40 requests, 0 third-party, tracking via /api/events (#8)', async ({ page, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  const requests: string[] = [];
  page.on('request', (r) => { if (!r.url().startsWith('data:')) requests.push(r.url()); });
  const beacon = page.waitForRequest((r) => r.url() === `${origin}/api/events` && r.method() === 'POST');
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  const ev = await beacon;
  expect(JSON.parse(ev.postData() ?? '{}')).toMatchObject({ name: 'page_viewed', payload: { path: '/' } });

  console.log(`home requests: ${requests.length}`);
  expect(requests.length).toBeLessThan(40);
  expect(requests.filter((u) => new URL(u).origin !== origin)).toEqual([]);
  const scripts = await page.locator('script[src]').evaluateAll((els) => els.map((e) => (e as HTMLScriptElement).src));
  expect(scripts.filter((s) => new URL(s).origin !== origin)).toEqual([]);
  // Ảnh qua next/image: có alt, width/height.
  const imgs = await page.locator('main img').evaluateAll((els) => els.map((e) => ({ alt: e.getAttribute('alt'), w: e.getAttribute('width'), h: e.getAttribute('height'), src: e.getAttribute('src') })));
  expect(imgs.length).toBeGreaterThan(0);
  for (const i of imgs) {
    expect(i.alt).toBeTruthy();
    expect(i.w && i.h).toBeTruthy();
    expect(i.src).toContain('/_next/image');
  }
  await expect.poll(() => sql("SELECT 1 FROM events WHERE name = 'page_viewed'").length).toBeGreaterThan(0);
  expect((await page.request.post('/api/events', { data: { name: 'Bad Name' } })).status()).toBe(400);
});

test.describe('mobile 375px (#12)', () => {
  test.use({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });

  test('floating buttons live in one corner and never cover content', async ({ page }) => {
    await page.goto('/');
    const dock = page.getByTestId('floating-dock');
    await expect(dock).toBeHidden();                      // đầu trang: không che hero/CTA
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);

    await page.mouse.wheel(0, 1500);
    await page.waitForTimeout(300);
    await expect(dock).toBeHidden();                      // đang cuộn xuống đọc: vẫn ẩn
    await page.mouse.wheel(0, -300);
    await expect(dock).toBeVisible();                     // cuộn ngược lên: hiện ở góc phải dưới
    const box = (await dock.boundingBox())!;
    expect(box.x).toBeGreaterThan(375 / 2);
    expect(box.y).toBeGreaterThan(812 / 2);
    await expect(page.locator('[style*="position: fixed"], .fixed').filter({ visible: true })).toHaveCount(1);

    // Cuối trang: dock không đè link footer nào.
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.mouse.wheel(0, -20);
    await expect(dock).toBeVisible();
    const d = (await dock.boundingBox())!;
    for (const l of await page.locator('footer a').all()) {
      const b = (await l.boundingBox())!;
      const overlap = b.x < d.x + d.width && b.x + b.width > d.x && b.y < d.y + d.height && b.y + b.height > d.y;
      expect(overlap, await l.innerText()).toBe(false);
    }
  });
});
