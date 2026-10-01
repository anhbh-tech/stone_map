// UI-2 e2e: tài khoản khách (đăng ký / đăng nhập / đăng xuất, sổ địa chỉ, đơn gắn vào tài khoản), tra đơn,
// tìm kiếm có gợi ý, collections (lọc / sắp xếp / phân trang). Chạy: npx playwright test -c tests/e2e/ui2.config.ts
// Dữ liệu tạo ra (khách, đơn, design, sản phẩm tạm) bị xoá ở afterAll; seed giữ nguyên.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { expect, test, type Page } from '@playwright/test';

const DB = process.env.E2E_D_DB!;
const PREVIEW = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'demo', 'cafe-duke.webp'));
const DESIGN = 'DSN-UI2E2E';
const EMAIL = 'ui2-e2e@example.com'; // cố định: worker khởi động lại sau lỗi vẫn dùng cùng khách
const PASSWORD = 'pearls-and-paws';
const TEMP_HANDLE = 'ui2-e2e-temp-product';

function sql<T = unknown>(q: string, ...args: (string | number | null)[]): T[] {
  const d = new DatabaseSync(DB);
  try { return d.prepare(q).all(...args) as T[]; } finally { d.close(); }
}
function exec(q: string, ...args: (string | number | null)[]) {
  const d = new DatabaseSync(DB);
  try { d.prepare(q).run(...args); } finally { d.close(); }
}

test.beforeAll(() => {
  cleanup();
  const [p] = sql<{ id: number }>("SELECT id FROM products WHERE handle = 'pearl-pet-portrait'");
  exec(`INSERT INTO designs (id, product_id, mode, status, style, pet_name, preview_path) VALUES (?, ?, 'ai', 'confirmed', 'royal-starry', 'Mochi', ?)
    ON CONFLICT(id) DO UPDATE SET status = excluded.status`, DESIGN, p.id, `previews/${DESIGN}.webp`);
});

function cleanup() {
  const orders = sql<{ id: number }>('SELECT o.id FROM orders o JOIN customers c ON c.id = o.customer_id WHERE c.email = ?', EMAIL);
  for (const o of orders) {
    exec('DELETE FROM order_lines WHERE order_id = ?', o.id);
    exec('DELETE FROM order_addons WHERE order_id = ?', o.id);
    exec('DELETE FROM orders WHERE id = ?', o.id);
  }
  exec('DELETE FROM customers WHERE email = ?', EMAIL);
  exec('DELETE FROM email_outbox WHERE to_addr = ?', EMAIL);
  exec('DELETE FROM designs WHERE id = ?', DESIGN);
  exec('DELETE FROM products WHERE handle = ?', TEMP_HANDLE);
}
test.afterAll(cleanup);

test.beforeEach(async ({ page }) => {
  await page.route('**/media/**', (r) => r.fulfill({ status: 200, contentType: 'image/webp', body: PREVIEW }));
});

const oneH1 = (page: Page) => expect(page.locator('h1')).toHaveCount(1);
const cookie = async (page: Page) => (await page.context().cookies()).find((c) => c.name === 'pa_customer');

test('account: register, sign out, sign in, and address book', async ({ page }) => {
  await page.goto('/account');
  await expect(page).toHaveURL(/\/account\/login\?next=(%2F|\/)account$/);
  await oneH1(page);

  await page.getByRole('link', { name: 'Create an account' }).click();
  await expect(page).toHaveURL(/\/account\/register/);
  await oneH1(page);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByText('Enter your name')).toBeVisible();

  await page.getByLabel('Name').fill('Mai Tran');
  await page.getByRole('textbox', { name: 'Email', exact: true }).fill(EMAIL);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Show password' }).click();
  await expect(page.getByLabel('Password', { exact: true })).toHaveAttribute('type', 'text');
  await page.getByRole('button', { name: 'Create account' }).click();

  await expect(page).toHaveURL(/\/account$/);
  await oneH1(page);
  await expect(page.locator('h1')).toHaveText('Hi, Mai');
  // Header (UI-1) render lại AccountLink sau router.refresh(): không cần tải lại trang.
  await expect(page.locator('header').getByTestId('account-link')).toHaveAccessibleName('Account, signed in as Mai');
  await expect(page.locator('header').getByTestId('account-link')).toHaveAttribute('href', '/account');
  await expect(page.getByTestId('orders-empty')).toBeVisible();
  const c = (await cookie(page))!;
  expect(c).toMatchObject({ httpOnly: true, sameSite: 'Lax' });
  // DB chỉ giữ hash của token.
  expect(sql('SELECT 1 FROM customer_sessions WHERE token = ?', c.value)).toHaveLength(0);

  // Trùng email → báo lỗi ngay ô email.
  const dup = await page.request.post('/api/account/register', { data: { name: 'X', email: EMAIL.toUpperCase(), password: 'whatever12' } });
  expect(dup.status()).toBe(409);
  expect((await dup.json()).error.code).toBe('email_taken');

  // Sổ địa chỉ: thêm 2, đổi mặc định, xoá.
  const book = page.getByTestId('address');
  const addAddress = async (line1: string) => {
    await page.getByRole('button', { name: 'Add address' }).click();
    await page.getByLabel('Street address').fill(line1);
    await page.getByLabel('City').fill('Austin');
    await page.getByLabel('State').fill('TX');
    await page.getByLabel('ZIP / postal code').fill('78701');
    await page.getByRole('button', { name: 'Save address' }).click();
  };
  await page.getByRole('button', { name: 'Add address' }).click();
  await page.getByRole('button', { name: 'Save address' }).click();
  await expect(page.locator('#new-line1-error')).toHaveText('Enter your street address');
  await page.getByRole('button', { name: 'Cancel' }).click();
  await addAddress('1 Pearl Street');
  await expect(book).toHaveCount(1);
  await expect(book.first()).toContainText('Default');
  await addAddress('22 Oyster Lane');
  await expect(book).toHaveCount(2);
  await book.filter({ hasText: '22 Oyster Lane' }).getByRole('button', { name: 'Make default' }).click();
  await expect(book.first()).toContainText('22 Oyster Lane');
  await expect(book.first()).toContainText('Default');
  await book.first().getByRole('button', { name: 'Remove' }).click();
  await book.first().getByRole('button', { name: 'Remove' }).click(); // xác nhận
  await expect(book).toHaveCount(1);
  await expect(book.first()).toContainText('1 Pearl Street');
  await expect(book.first()).toContainText('Default');
  await page.reload();
  await expect(book).toHaveCount(1);

  // Đăng xuất → /account đòi đăng nhập lại; mật khẩu sai bị từ chối.
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/$|\/account\/login/);
  expect(await cookie(page)).toBeUndefined();
  await expect(page.locator('header').getByTestId('account-link')).toHaveAccessibleName('Sign in');
  await page.goto('/account/login');
  await page.getByRole('textbox', { name: 'Email', exact: true }).fill(EMAIL);
  await page.getByLabel('Password', { exact: true }).fill('wrong-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.locator('main').getByRole('alert')).toContainText('don’t match an account');
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/account$/);

  // Chỉ chuyển hướng tới đường dẫn nội bộ.
  await page.goto('/account/login?next=//evil.example');
  await expect(page).toHaveURL(/\/account$/);

  // Chặn yêu cầu khác origin.
  const cross = await page.request.post('/api/account/login', { data: { email: EMAIL, password: PASSWORD }, headers: { origin: 'https://evil.example' } });
  expect(cross.status()).toBe(403);
});

test('checkout while signed in attaches the order; track order by number + email', async ({ page, browser }) => {
  // Không phụ thuộc test trước: tạo tài khoản nếu chưa có (409 = đã có).
  const reg = await page.request.post('/api/account/register', { data: { name: 'Mai Tran', email: EMAIL, password: PASSWORD } });
  expect([201, 409]).toContain(reg.status());
  await page.context().clearCookies();
  await page.goto('/account/login');
  await page.getByRole('textbox', { name: 'Email', exact: true }).fill(EMAIL);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/account$/);

  const [p] = sql<{ id: number }>("SELECT id FROM products WHERE handle = 'pearl-pet-portrait'");
  const [v] = sql<{ id: number }>('SELECT id FROM variants WHERE product_id = ? ORDER BY position LIMIT 1', p.id);
  expect((await page.request.post('/api/cart/lines', { data: { variant_id: v.id, qty: 1, design_id: DESIGN } })).status()).toBe(200);

  await page.goto('/checkout');
  await expect(page.getByTestId('checkout-account-note')).toContainText(EMAIL);
  await page.getByRole('textbox', { name: 'Email', exact: true }).fill(EMAIL);
  await page.getByLabel('Full name').fill('Mai Tran');
  await page.getByLabel('Address', { exact: true }).fill('1 Pearl Street');
  await page.getByLabel('City').fill('Austin');
  await page.getByLabel('State').fill('TX');
  await page.getByLabel('ZIP code').fill('78701');
  await page.getByRole('button', { name: /Place order/ }).click();
  await page.waitForURL(/\/orders\/\d+$/);
  const number = page.url().split('/').pop()!;
  const [row] = sql<{ email: string }>('SELECT c.email FROM orders o JOIN customers c ON c.id = o.customer_id WHERE o.number = ?', number);
  expect(row.email).toBe(EMAIL);

  await page.goto('/account');
  const order = page.getByTestId('order-row').filter({ hasText: `#${number}` });
  await expect(order).toBeVisible();
  await expect(order).toContainText('Preview approved');
  await order.getByRole('link').first().click();
  await expect(page).toHaveURL(new RegExp(`/account/orders/${number}$`));
  await oneH1(page);
  await expect(page.locator('main')).toContainText('1 Pearl Street');
  await expect(page.locator('main')).toContainText('Mochi');

  // Khách khác (chưa đăng nhập) không xem được đơn trong tài khoản, nhưng tra được bằng số đơn + email.
  const other = await browser.newContext();
  const guest = await other.newPage();
  await guest.goto(`/account/orders/${number}`);
  await expect(guest).toHaveURL(/\/account\/login/);
  await guest.goto('/track-order');
  await oneH1(guest);
  await guest.getByLabel('Order number').fill(`#${number}`);
  await guest.getByLabel('Email used at checkout').fill('someone-else@example.com');
  await guest.getByRole('button', { name: 'Track order' }).click();
  await expect(guest.locator('main').getByRole('alert').first()).toContainText('couldn’t find an order');
  await expect(guest.getByTestId('tracked-order')).toHaveCount(0);
  await guest.getByLabel('Email used at checkout').fill(EMAIL.toUpperCase());
  await guest.getByRole('button', { name: 'Track order' }).click();
  const tracked = guest.getByTestId('tracked-order');
  await expect(tracked).toContainText(`#${number}`);
  await expect(tracked).toContainText('Austin, TX');
  await expect(tracked).not.toContainText('Pearl Street');
  await expect(tracked.locator('[aria-current="step"]')).toContainText('Order placed');
  await other.close();
});

test('search: suggestions while typing, keyboard selection, results, sort and empty state', async ({ page }) => {
  await page.goto('/search');
  await oneH1(page);
  const box = page.getByRole('combobox', { name: 'Search the shop' });
  await box.pressSequentially('ornam', { delay: 30 });
  const list = page.getByRole('listbox', { name: 'Suggestions' });
  await expect(list.getByRole('option', { name: /Ornament/ })).toHaveCount(2);
  await expect(list.getByRole('option', { name: 'Search for “ornam”' })).toBeVisible();

  await box.press('ArrowDown');
  await expect(box).toHaveAttribute('aria-activedescendant', /opt-0$/);
  await box.press('Escape');
  await expect(list).toBeHidden();
  await box.press('Enter');
  await expect(page).toHaveURL(/\/search\?q=ornam$/);
  await oneH1(page);
  await expect(page.getByTestId('result-count')).toHaveText('2 results');

  await page.goto('/search?q=christmas');
  await expect(page.getByTestId('result-count')).toHaveText('4 results');
  await page.getByLabel('Sort by').selectOption('price-asc');
  await expect(page).toHaveURL(/sort=price-asc/);
  const prices = await page.locator('main [data-testid="product-card"] [data-testid="card-price"]').allTextContents();
  const cents = prices.map((s) => Number(s.replace(/[^\d.]/g, '')));
  expect(cents).toEqual([...cents].sort((a, b) => a - b));

  // Chọn gợi ý bằng bàn phím → trang sản phẩm.
  await page.goto('/search');
  const fetched = page.waitForResponse((r) => r.url().includes('/api/search/suggest?q=pearl%20pet%20por'));
  await box.pressSequentially('pearl pet por', { delay: 30 });
  await fetched;
  await expect(list.getByRole('option').first()).toContainText('Pearl Pet Portrait');
  await box.press('ArrowDown');
  await box.press('Enter');
  await expect(page).toHaveURL(/\/products\//);

  await page.goto('/search?q=zzqxv');
  await oneH1(page);
  await expect(page.getByTestId('search-empty')).toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);

  const s = await page.request.get('/api/search/suggest?q=kit');
  expect(s.status()).toBe(200);
  const { items } = await s.json();
  expect(items.length).toBeGreaterThan(0);
  expect(Object.keys(items[0]).sort()).toEqual(['handle', 'image', 'title']);
  expect((await (await page.request.get('/api/search/suggest?q=k')).json()).items).toEqual([]);
});

test('collections: index, filters, sort and pagination', async ({ page }) => {
  await page.goto('/collections');
  await oneH1(page);
  await page.getByRole('link', { name: /Christmas/ }).first().click();
  await expect(page).toHaveURL(/\/collections\/christmas$/);
  await oneH1(page);
  await expect(page.getByTestId('result-count')).toHaveText('4 products');
  await expect(page.locator('img:not([alt])')).toHaveCount(0);
  await expect(page.getByText('Demo').first()).toBeVisible();

  const filters = page.getByRole('complementary', { name: 'Filters' });
  await filters.getByRole('link', { name: /^Ornament/ }).click();
  await expect(page).toHaveURL(/type=ornament/);
  await expect(page.getByTestId('result-count')).toHaveText('2 products');
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
  await filters.getByRole('link', { name: /^Under \$50/ }).click();
  await expect(page).toHaveURL(/price=under-50/);
  await expect(page.getByTestId('result-count')).toHaveText('2 products');
  await page.getByRole('link', { name: 'Remove filter: Ornament' }).click();
  await expect(page).not.toHaveURL(/type=/);
  await expect(page.getByTestId('result-count')).toHaveText('4 products'); // cả 4 sản phẩm Christmas đều dưới $50

  await page.goto('/collections/pet-portraits?theme=birthday&theme=christmas&type=diy-kit');
  await expect(page.getByTestId('result-count')).toHaveText('0 products');
  await page.getByRole('link', { name: 'Clear filters' }).click();
  await expect(page).toHaveURL(/\/collections\/pet-portraits$/);

  // Handle không tồn tại → 404 thật (không soft-404 về /all), trang 404 của shop dẫn sang collection.
  const gone = await page.goto('/collections/nope');
  expect(gone?.status()).toBe(404);
  await expect(page).toHaveURL(/\/collections\/nope$/);
  await expect(page.getByTestId('not-found').getByRole('link', { name: /^Christmas/ })).toHaveAttribute('href', '/collections/christmas');

  // Thêm tạm 1 sản phẩm → /collections/all có 13 sản phẩm, 2 trang.
  exec("INSERT INTO products (handle, title) VALUES (?, 'UI2 E2E temporary product')", TEMP_HANDLE);
  const [t] = sql<{ id: number }>('SELECT id FROM products WHERE handle = ?', TEMP_HANDLE);
  exec("INSERT INTO variants (product_id, sku, size, price_cents, position) VALUES (?, 'UI2-E2E', '8×8', 100, 0)", t.id);
  await page.goto('/collections/all?sort=price-asc');
  await expect(page.getByTestId('result-count')).toHaveText('13 products');
  await expect(page.locator('main [data-testid="product-card"]').first()).toContainText('UI2 E2E temporary product');
  const pager = page.getByRole('navigation', { name: 'Pagination' });
  await pager.getByRole('link', { name: 'Next' }).click();
  await expect(page).toHaveURL(/page=2/);
  await expect(page).toHaveURL(/sort=price-asc/);
  await expect(page.locator('main [data-testid="product-card"]')).toHaveCount(1);
  await expect(pager.locator('[aria-current="page"]')).toHaveText('2');
  exec('DELETE FROM products WHERE id = ?', t.id);
  await page.reload();
  await expect(page.getByTestId('result-count')).toHaveText('12 products');
});

test('mobile 375: collection filter drawer and search have no horizontal scroll', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  for (const url of ['/collections', '/collections/pet-portraits', '/search?q=pet', '/account/login', '/track-order']) {
    await page.goto(url);
    await oneH1(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  }
  await page.goto('/collections/pet-portraits');
  const drawer = page.locator('details').filter({ hasText: 'Filter' });
  await drawer.locator('summary').click();
  await drawer.getByRole('link', { name: /^Memorial/ }).click();
  await expect(page.getByTestId('result-count')).toHaveText('1 product');
});

test('header (UI-1) mounts SearchBox, CategoryMenu and AccountLink and they work end to end', async ({ page }) => {
  await page.goto('/');
  const header = page.locator('header').first();
  await expect(header.getByTestId('account-link')).toHaveAttribute('href', '/account/login');

  // Gợi ý trong ô search của header → chọn sản phẩm bằng chuột.
  const box = header.getByRole('combobox', { name: 'Search products' });
  const fetched = page.waitForResponse((r) => r.url().includes('/api/search/suggest?q=scarf'));
  await box.pressSequentially('scarf', { delay: 30 });
  await fetched;
  const option = header.getByRole('option', { name: /Christmas Scarf Pet Portrait/ });
  await expect(option).toBeVisible();
  await option.click();
  await expect(page).toHaveURL(/\/products\/demo-christmas-scarf-portrait$/);
  await oneH1(page);

  // Enter không chọn gợi ý → trang kết quả, SearchBox trên trang nhận sẵn từ khoá.
  await page.goto('/');
  await header.getByRole('combobox', { name: 'Search products' }).fill('memorial');
  await header.getByRole('combobox', { name: 'Search products' }).press('Enter');
  await expect(page).toHaveURL(/\/search\?q=memorial$/);
  await expect(page.getByTestId('result-count')).toHaveText('3 results');

  // Cách gõ tắt vẫn ra đúng sản phẩm.
  await page.goto('/search?q=xmas');
  await expect(page.locator('main [data-testid="product-card"]').first()).toContainText('Christmas');

  // Hàng category của header (desktop).
  const main = page.getByRole('navigation', { name: 'Main' });
  await expect(main.getByRole('link', { name: 'Pet portraits' })).toHaveAttribute('href', '/collections/pet-portraits');
  await expect(main.getByRole('link', { name: 'Track order' })).toHaveAttribute('href', '/track-order');
  await main.getByRole('link', { name: 'Christmas' }).click();
  await expect(page).toHaveURL(/\/collections\/christmas$/);
  await expect(page.locator('h1')).toHaveText('Christmas');
});

test('mobile 375: header menu lists collections with counts', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/');
  await expect(page.locator('header').getByRole('combobox', { name: 'Search products' })).toBeVisible();
  await page.getByRole('button', { name: 'Open menu' }).click();
  const menu = page.getByRole('dialog', { name: 'Menu' });
  await menu.getByRole('link', { name: /^Memorial 3 products/ }).click();
  await expect(page).toHaveURL(/\/collections\/memorial$/);
  await expect(menu).toBeHidden();
  await expect(page.getByTestId('result-count')).toHaveText('3 products');

  await page.getByRole('button', { name: 'Open menu' }).click();
  await menu.getByRole('link', { name: 'Track order' }).click();
  await expect(page).toHaveURL(/\/track-order$/);
});

test('mobile 375: collections index is a 2-column grid, not one tall card per screen', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/collections');
  const tiles = page.locator('main ul').first().locator('> li');
  const [a, b] = [await tiles.nth(0).boundingBox(), await tiles.nth(1).boundingBox()];
  expect(Math.abs(a!.y - b!.y)).toBeLessThan(2);
  expect(a!.width).toBeLessThan(190);
});

test('404: unknown URLs and missing products get the shop 404 with a way back', async ({ page }) => {
  for (const url of ['/no-such-page', '/products/no-such-product']) {
    const res = await page.goto(url);
    expect(res?.status()).toBe(404);
    await expect(page).toHaveTitle('Page not found | Pearl Atelier');
    await oneH1(page);
    await expect(page.locator('h1')).toHaveText('We couldn’t find that page');
    await expect(page.locator('header').getByRole('combobox', { name: 'Search products' })).toBeVisible(); // vẫn trong khung shop
    await expect(page.getByTestId('not-found').getByRole('link', { name: 'Track your order' })).toHaveAttribute('href', '/track-order');
  }
  await page.getByTestId('not-found').getByRole('combobox', { name: 'Search the shop' }).fill('kit');
  await page.getByTestId('not-found').getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page).toHaveURL(/\/search\?q=kit$/);
});

test('forgot password: emailed one-time link sets a new password and signs in', async ({ page }) => {
  const reg = await page.request.post('/api/account/register', { data: { name: 'Mai Tran', email: EMAIL, password: PASSWORD } });
  expect([201, 409]).toContain(reg.status());
  await page.context().clearCookies();
  await page.goto('/account/login');
  await page.getByRole('link', { name: 'Forgot password?' }).click();
  await expect(page).toHaveURL(/\/account\/forgot$/);
  await oneH1(page);

  // Email không có tài khoản: cùng câu trả lời, không gửi gì.
  await page.getByRole('textbox', { name: 'Email' }).fill('nobody-ui2@example.com');
  await page.getByRole('button', { name: 'Send reset link' }).click();
  await expect(page.getByTestId('forgot-sent')).toContainText('If an account uses nobody-ui2@example.com');
  expect(sql("SELECT 1 FROM email_outbox WHERE to_addr = 'nobody-ui2@example.com'")).toHaveLength(0);

  await page.getByRole('button', { name: 'try another email' }).click();
  await page.getByRole('textbox', { name: 'Email' }).fill(EMAIL.toUpperCase());
  await page.getByRole('button', { name: 'Send reset link' }).click();
  await expect(page.getByTestId('forgot-sent')).toBeVisible();
  const [mail] = sql<{ html: string }>("SELECT html FROM email_outbox WHERE to_addr = ? AND kind = 'password_reset' ORDER BY id DESC LIMIT 1", EMAIL);
  const link = new URL(mail.html.match(/href="([^"]+)"/)![1].replace(/&#38;/g, '&'));

  await page.goto(link.pathname + link.search, { waitUntil: 'networkidle' });
  await oneH1(page);
  await page.getByLabel('New password').fill('short');
  await page.getByRole('button', { name: 'Save new password' }).click();
  await expect(page.getByText('Use at least 8 characters')).toBeVisible();
  await page.getByLabel('New password').fill('new-pearls-2026');
  await page.getByRole('button', { name: 'Save new password' }).click();
  await expect(page).toHaveURL(/\/account$/);

  // Link chỉ dùng một lần; mật khẩu mới đăng nhập được, mật khẩu cũ thì không.
  await page.goto(link.pathname + link.search, { waitUntil: 'networkidle' });
  await page.getByLabel('New password').fill('again-and-again');
  await page.getByRole('button', { name: 'Save new password' }).click();
  await expect(page.getByRole('main').getByRole('alert')).toContainText('expired or was already used');
  expect(page.url()).not.toContain('again-and-again');
  await expect(page.getByRole('link', { name: 'Send a new reset link' })).toBeVisible();
  expect((await page.request.post('/api/account/login', { data: { email: EMAIL, password: PASSWORD } })).status()).toBe(401);
  expect((await page.request.post('/api/account/login', { data: { email: EMAIL, password: 'new-pearls-2026' } })).status()).toBe(200);
  // Trả lại mật khẩu cũ (qua chính luồng đặt lại) cho các test khác dùng chung khách này.
  expect((await page.request.post('/api/account/forgot', { data: { email: EMAIL } })).status()).toBe(200);
  const [again] = sql<{ html: string }>("SELECT html FROM email_outbox WHERE to_addr = ? AND kind = 'password_reset' ORDER BY id DESC LIMIT 1", EMAIL);
  const token = new URL(again.html.match(/href="([^"]+)"/)![1]).searchParams.get('token');
  expect((await page.request.post('/api/account/reset', { data: { token, password: PASSWORD } })).status()).toBe(200);
});
