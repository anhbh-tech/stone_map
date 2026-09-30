// Crew UI-3 e2e: back office kiểu Shopify. Home (KPI + biểu đồ), Orders (lọc/tìm/sắp xếp, fulfill, timeline),
// Designs (giao designer, chuyển AI sang designer), Customers, Collections, Discounts, ngăn kéo điều hướng 375px.
// Dữ liệu phụ ghi thẳng vào DB tmp của config gốc và xoá hết ở afterAll (spec khác dùng chung DB).
// Bảng customers/collections là của UI-2: nếu DB chưa có thì tạo đúng hình hợp đồng rồi gỡ lại sau khi chạy.
import { DatabaseSync } from 'node:sqlite';
import { expect, test, type Page } from '@playwright/test';
import { E2E_DB_PATH } from './ui3.config';

const db = () => new DatabaseSync(E2E_DB_PATH);
const run = (fn: (d: DatabaseSync) => void) => { const d = db(); try { fn(d); } finally { d.close(); } };

const ORDERS = ['8801', '8802', '8803'];
const DESIGNS = ['DSN-UI3PRT', 'DSN-UI3REV', 'DSN-UI3AIP'];
const EMAIL = 'ui3.buyer@example.test';
const created: string[] = [];
let addedCustomerId = false;

test.beforeAll(() => run((d) => {
  const has = (t: string) => !!d.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t);
  // Hình bảng theo hợp đồng ui2_001_customers.sql; chỉ tạo khi thiếu.
  const contract: [string, string][] = [
    ['customers', "CREATE TABLE customers (id INTEGER PRIMARY KEY, email TEXT NOT NULL UNIQUE COLLATE NOCASE, name TEXT, password_hash TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')))"],
    ['customer_sessions', 'CREATE TABLE customer_sessions (id TEXT PRIMARY KEY, customer_id INTEGER NOT NULL, expires_at TEXT NOT NULL)'],
    ['customer_addresses', 'CREATE TABLE customer_addresses (id INTEGER PRIMARY KEY, customer_id INTEGER NOT NULL, address TEXT NOT NULL, is_default INTEGER NOT NULL DEFAULT 0)'],
    ['collections', 'CREATE TABLE collections (id INTEGER PRIMARY KEY, handle TEXT NOT NULL UNIQUE, title TEXT NOT NULL, description TEXT, image TEXT, sort INTEGER NOT NULL DEFAULT 0)'],
    ['product_collections', 'CREATE TABLE product_collections (product_id INTEGER NOT NULL, collection_id INTEGER NOT NULL, position INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (product_id, collection_id))'],
  ];
  for (const [t, sql] of contract) if (!has(t)) { d.exec(sql); created.push(t); }
  if (!(d.prepare("SELECT 1 FROM pragma_table_info('orders') WHERE name = 'customer_id'").get())) { d.exec('ALTER TABLE orders ADD customer_id INTEGER'); addedCustomerId = true; }

  d.exec(`INSERT INTO customers (email, name) VALUES ('${EMAIL}', 'Robin Vale')`);
  const pv = "(SELECT id FROM products ORDER BY id LIMIT 1), (SELECT id FROM variants ORDER BY position LIMIT 1)";
  d.exec(`INSERT INTO designs (id, product_id, variant_id, mode, pet_name, status, email, print_path) VALUES
    ('DSN-UI3PRT', ${pv}, 'designer', 'Pepper', 'approved', '${EMAIL}', 'storage/prints/DSN-UI3PRT.png'),
    ('DSN-UI3REV', ${pv}, 'designer', 'Juniper', 'in_review', '${EMAIL}', NULL),
    ('DSN-UI3AIP', ${pv}, 'ai', 'Waffles', 'ready', '${EMAIL}', NULL)`);
  const order = d.prepare(`INSERT INTO orders (number, email, name, address, shipping_method, subtotal_cents, total_cents, status, created_at)
    VALUES (?, ?, 'Robin Vale', '{"line1":"1 Test Way","city":"Austin","country":"US"}', 'standard', ?, ?, ?, datetime('now', ?)) RETURNING id`);
  const line = d.prepare("INSERT INTO order_lines (order_id, product_title, variant_size, sku, qty, unit_cents, design_id) VALUES (?, 'Pearl Pet Portrait', '12×12', 'UI3-SKU', 1, ?, ?)");
  const a = order.get('8801', EMAIL, 8000, 8000, 'paid', '-1 hours') as { id: number };
  line.run(a.id, 8000, 'DSN-UI3PRT');
  const b = order.get('8802', EMAIL, 6000, 6000, 'paid', '-2 hours') as { id: number };
  line.run(b.id, 6000, 'DSN-UI3REV');
  order.get('8803', EMAIL, 4000, 4000, 'refunded', '-3 hours');
}));

test.afterAll(() => run((d) => {
  const ids = ORDERS.map((n) => (d.prepare('SELECT id FROM orders WHERE number = ?').get(n) as { id: number } | undefined)?.id).filter((x): x is number => x != null);
  for (const id of ids) for (const t of ['order_lines', 'order_events', 'fulfillments']) d.prepare(`DELETE FROM ${t} WHERE order_id = ?`).run(id);
  d.prepare(`DELETE FROM orders WHERE number IN (${ORDERS.map(() => '?').join(',')})`).run(...ORDERS);
  d.prepare(`DELETE FROM jobs WHERE design_id IN (${DESIGNS.map(() => '?').join(',')})`).run(...DESIGNS);
  d.prepare(`DELETE FROM designs WHERE id IN (${DESIGNS.map(() => '?').join(',')})`).run(...DESIGNS);
  d.prepare('DELETE FROM email_outbox WHERE to_addr = ?').run(EMAIL);
  d.prepare("DELETE FROM discounts WHERE code = 'UI3TEST'").run();
  d.prepare("DELETE FROM admin_users WHERE username = 'dana'").run();
  d.prepare("DELETE FROM product_collections WHERE collection_id IN (SELECT id FROM collections WHERE handle = 'ui3-test')").run();
  d.prepare("DELETE FROM collections WHERE handle = 'ui3-test'").run();
  d.prepare('DELETE FROM customers WHERE email = ?').run(EMAIL);
  if (addedCustomerId) d.exec('ALTER TABLE orders DROP COLUMN customer_id');
  for (const t of [...created].reverse()) d.exec(`DROP TABLE ${t}`);
}));

async function login(page: Page) {
  await page.goto('/admin/login');
  await page.getByLabel('Username').fill('admin');
  await page.getByLabel('Password', { exact: true }).fill('admin123');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/admin$/);
}
const orderId = (n: string) => { const d = db(); try { return (d.prepare('SELECT id FROM orders WHERE number = ?').get(n) as { id: number }).id; } finally { d.close(); } };

test('home: KPIs come from the orders table, metric tabs switch the chart, table view is available', async ({ page }) => {
  await login(page);
  await expect(page.getByRole('heading', { level: 1, name: 'Home' })).toBeVisible();
  const kpi = page.getByTestId('kpi-orders');
  await expect(kpi).toContainText('Orders');
  await kpi.click();
  await expect(page).toHaveURL(/metric=orders/);
  await expect(page.getByTestId('kpi-orders')).toHaveAttribute('aria-current', 'true');
  await page.getByRole('link', { name: '30 days' }).click();
  await expect(page).toHaveURL(/range=30d/);
  await expect(page).toHaveURL(/metric=orders/);
  await page.getByText('View as table').click();
  await expect(page.getByRole('region', { name: /Orders, last 30 days data/ }).locator('tbody tr')).toHaveCount(30);
  const chart = page.getByRole('group', { name: /Orders, last 30 days/ });
  await chart.focus();
  await page.keyboard.press('End');
  await expect(page.locator('[aria-live="polite"]').filter({ hasText: /previous period/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /design.* waiting for review/ })).toBeVisible();
});

test('orders: filter by payment, search, sort, then fulfill with tracking and see it on the timeline', async ({ page }) => {
  await login(page);
  await page.goto('/admin/orders');
  await page.getByLabel('Payment').selectOption('refunded');
  await page.getByRole('button', { name: 'Apply' }).click();
  await expect(page).toHaveURL(/payment=refunded/);
  const table = page.getByRole('table');
  await expect(table.getByRole('link', { name: '#8803' })).toBeVisible();
  await expect(table.getByRole('link', { name: '#8801' })).toHaveCount(0);

  await page.goto('/admin/orders');
  await page.getByPlaceholder(/^Search by order number/).fill('UI3-SKU');
  await page.getByRole('button', { name: 'Apply' }).click();
  await expect(page.getByRole('table').locator('tbody tr')).toHaveCount(2);
  await page.getByRole('link', { name: /^Total/ }).click();
  await expect(page.getByRole('columnheader', { name: /Total/ })).toHaveAttribute('aria-sort', 'descending');
  await expect(page.getByRole('table').locator('tbody tr').first()).toContainText('#8801');

  // Đơn có design chưa duyệt: không fulfill được, trang nói lý do.
  await page.goto(`/admin/orders/${orderId('8802')}`);
  await expect(page.getByRole('note')).toContainText('DSN-UI3REV');
  await expect(page.getByRole('button', { name: 'Mark as fulfilled' })).toHaveCount(0);

  await page.goto(`/admin/orders/${orderId('8801')}`);
  await expect(page.getByRole('heading', { level: 1, name: '#8801' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Robin Vale' })).toBeVisible(); // khách có tài khoản (cùng email)
  const form = page.getByRole('form', { name: 'Fulfill order' });
  await form.getByLabel('Carrier').fill('USPS');
  await form.getByLabel('Tracking number').fill('9400UI3');
  await form.getByLabel('Tracking link').fill('http://not-https.example');
  await form.getByRole('button', { name: 'Mark as fulfilled' }).click();
  await expect(form.getByText('Use an https:// link', { exact: true })).toBeVisible();
  await form.getByLabel('Tracking link').fill('https://tools.usps.com/go/TrackConfirmAction?tLabels=9400UI3');
  await form.getByRole('button', { name: 'Mark as fulfilled' }).click();
  await expect(page.getByRole('heading', { name: 'Shipments' })).toBeVisible();
  const timeline = page.getByRole('list', { name: /Order timeline/ });
  await expect(timeline).toContainText('Marked as fulfilled · USPS 9400UI3');
  await expect(timeline).toContainText(`Shipping email queued to ${EMAIL}`);
  await expect(page.getByText('Fulfilled', { exact: true }).first()).toBeVisible();

  const comment = page.getByRole('form', { name: 'Add a comment' });
  await comment.getByLabel('Comment').fill('Packed with extra padding');
  await comment.getByRole('button', { name: 'Post' }).click();
  await expect(timeline).toContainText('Packed with extra padding');

  await page.goto('/admin/emails');
  await expect(page.getByRole('link', { name: /order #8801 is on its way/ })).toBeVisible();
});

test('designs: add a designer, assign a design, filter by designer, hand an AI preview over', async ({ page }) => {
  await login(page);
  await page.goto('/admin/settings#settings-staff');
  const staff = page.getByRole('form', { name: 'Add staff member' });
  await staff.getByLabel('Username').fill('dana');
  await staff.getByLabel('Display name').fill('Dana Designer');
  await staff.getByLabel('Password').fill('long-enough-pw');
  await staff.getByRole('button', { name: 'Add staff member' }).click();
  await expect(page.locator('#settings-staff')).toContainText('Dana Designer');

  await page.goto('/admin/designs');
  const card = page.locator('li#DSN-UI3REV');
  await expect(card.getByRole('heading', { name: 'Juniper' })).toBeVisible();
  await card.getByLabel('Designer').selectOption({ label: 'Dana Designer' });
  await expect(card.getByRole('status').filter({ hasText: 'Assigned' })).toBeVisible();

  await page.getByLabel('Designer', { exact: true }).first().selectOption({ label: 'Dana Designer' });
  await page.getByRole('button', { name: 'Apply' }).click();
  await expect(page.locator('li#DSN-UI3REV')).toBeVisible();
  await page.goto('/admin/designs?assignee=unassigned');
  await expect(page.locator('li#DSN-UI3REV')).toHaveCount(0);

  await page.goto('/admin/designs?tab=ai');
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Hand design DSN-UI3AIP to a designer' }).click();
  await expect(page.locator('li#DSN-UI3AIP')).toHaveCount(0);
  await page.goto('/admin/designs');
  await expect(page.locator('li#DSN-UI3AIP')).toBeVisible();
});

test('customers: list, search and detail with their orders', async ({ page }) => {
  await login(page);
  await page.goto('/admin/customers?q=ui3.buyer');
  await page.getByRole('link', { name: 'Robin Vale' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Robin Vale' })).toBeVisible();
  const orders = page.getByRole('table', { name: /Orders from Robin Vale/ });
  await expect(orders.getByRole('link', { name: '#8803' })).toBeVisible();
  await expect(orders.locator('tbody tr')).toHaveCount(3);
});

test('collections: create one and pick its products', async ({ page }) => {
  await login(page);
  await page.goto('/admin/collections');
  const form = page.locator('#new-collection form');
  await form.getByLabel('Title').fill('UI3 test collection');
  await form.getByLabel('URL handle').fill('ui3-test');
  await form.getByRole('button', { name: 'Create collection' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'UI3 test collection' })).toBeVisible();
  await page.getByRole('checkbox').first().check();
  await page.getByRole('button', { name: /^Save 1 product$/ }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Products saved' })).toBeVisible();
  await page.goto('/admin/collections');
  await expect(page.getByRole('row', { name: /UI3 test collection/ })).toContainText('1');
});

test('discounts: create a buy-more code, disable it, delete it', async ({ page }) => {
  await login(page);
  await page.goto('/admin/discounts');
  await page.getByRole('link', { name: 'Create discount' }).first().click();
  const form = page.getByRole('form', { name: 'New discount' });
  await form.getByLabel('Discount code').fill('ui3test');
  await form.getByLabel('Percentage off').fill('10');
  await form.getByLabel('Minimum portraits in cart').fill('2');
  await form.getByRole('button', { name: 'Create discount' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'UI3TEST' })).toBeVisible();
  await expect(page.getByText('10% off · 2+ items')).toBeVisible();

  const edit = page.getByRole('form', { name: 'Edit discount' });
  await edit.getByLabel('Fixed amount').check();
  await edit.getByLabel('Amount off').fill('5');
  await edit.getByLabel('Active').uncheck();
  await edit.getByRole('button', { name: 'Save discount' }).click();
  await expect(edit.getByRole('status').filter({ hasText: 'Discount saved' })).toBeVisible();
  await page.reload();
  await expect(page.getByText('$5.00 off · 2+ items')).toBeVisible();

  await page.goto('/admin/discounts?state=disabled');
  await expect(page.getByRole('link', { name: 'UI3TEST' })).toBeVisible();
  await page.getByRole('link', { name: 'UI3TEST' }).click();
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Delete discount' }).click();
  await expect(page).toHaveURL(/\/admin\/discounts$/);
  await expect(page.getByRole('link', { name: 'UI3TEST' })).toHaveCount(0);
});

test('mobile: the navigation drawer opens, closes with Escape and returns focus', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await login(page);
  const open = page.getByRole('button', { name: 'Open navigation' });
  await open.click();
  const drawer = page.getByRole('navigation', { name: 'Admin' });
  await expect(drawer.getByRole('link', { name: 'Discounts' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);
  await expect(open).toBeFocused();
  await open.click();
  await page.getByRole('navigation', { name: 'Admin' }).getByRole('link', { name: /Orders/ }).click();
  await expect(page).toHaveURL(/\/admin\/orders$/);
  await expect(page.getByRole('navigation', { name: 'Admin' })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
});
