// Crew UI-3: các sửa từ critique admin (docs/critique/ps-ui3-admin.md). Ship không tracking phải hỏi lại; hoàn tiền sau khi ship vẫn
// là Fulfilled; duyệt design cuối cùng đẩy đơn đã trả sang In production và mail về email của đơn; khách vãng lai có trong Customers;
// upload ảnh sản phẩm từ máy; rời form chưa lưu phải hỏi lại. Dữ liệu riêng (đơn 8804/8805), xoá ở afterAll.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import sharp from 'sharp';
import { expect, test, type Page } from '@playwright/test';
import { E2E_DB_PATH, E2E_STORAGE_DIR } from './ui3.config';

const db = () => new DatabaseSync(E2E_DB_PATH);
const run = <T,>(fn: (d: DatabaseSync) => T): T => { const d = db(); try { return fn(d); } finally { d.close(); } };

const ORDERS = ['8804', '8805'];
const DESIGN = 'DSN-UI3RV2';
const SHIPPABLE = 'DSN-UI3PR2';
const GUEST = 'ui3.guest@example.test';
const ALT = 'UI3 upload test image';

test.beforeAll(() => run((d) => {
  const pv = '(SELECT id FROM products ORDER BY id LIMIT 1), (SELECT id FROM variants ORDER BY position LIMIT 1)';
  d.exec(`INSERT INTO designs (id, product_id, variant_id, mode, pet_name, status, email, print_path) VALUES
    ('${DESIGN}', ${pv}, 'designer', 'Biscuit', 'in_review', NULL, 'storage/prints/${DESIGN}.png'),
    ('${SHIPPABLE}', ${pv}, 'designer', 'Clover', 'approved', NULL, 'storage/prints/${SHIPPABLE}.png')`);
  const order = d.prepare(`INSERT INTO orders (number, email, name, address, shipping_method, subtotal_cents, total_cents, status)
    VALUES (?, ?, 'Sam Guest', '{"line1":"2 Test Way","city":"Austin","region":"TX","postal_code":"78701","country":"US"}', 'standard', 5000, 5000, 'paid') RETURNING id`);
  const line = d.prepare("INSERT INTO order_lines (order_id, product_title, variant_size, sku, qty, unit_cents, design_id) VALUES (?, 'Pearl Pet Portrait', '12×12', 'UI3-SKU', 1, 5000, ?)");
  line.run((order.get('8804', GUEST) as { id: number }).id, SHIPPABLE);
  line.run((order.get('8805', GUEST) as { id: number }).id, DESIGN);
}));

test.afterAll(() => run((d) => {
  for (const n of ORDERS) {
    const id = (d.prepare('SELECT id FROM orders WHERE number = ?').get(n) as { id: number } | undefined)?.id;
    if (id == null) continue;
    for (const t of ['order_lines', 'order_events', 'fulfillments']) d.prepare(`DELETE FROM ${t} WHERE order_id = ?`).run(id);
    d.prepare('DELETE FROM orders WHERE id = ?').run(id);
  }
  d.prepare('DELETE FROM designs WHERE id IN (?, ?)').run(DESIGN, SHIPPABLE);
  d.prepare('DELETE FROM email_outbox WHERE to_addr = ?').run(GUEST);
  for (const r of d.prepare('SELECT id, url FROM product_images WHERE alt = ?').all(ALT) as { id: number; url: string }[]) {
    fs.rmSync(path.join(E2E_STORAGE_DIR, r.url.replace(/^\/media\//, '')), { force: true });
    d.prepare('DELETE FROM product_images WHERE id = ?').run(r.id);
  }
}));

async function login(page: Page) {
  await page.goto('/admin/login');
  await page.getByLabel('Username').fill('admin');
  await page.getByLabel('Password', { exact: true }).fill('admin123');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/admin$/);
}
const orderRow = (n: string) => run((d) => d.prepare('SELECT id, status FROM orders WHERE number = ?').get(n) as { id: number; status: string });
const shipments = (id: number) => run((d) => (d.prepare('SELECT count(*) n FROM fulfillments WHERE order_id = ?').get(id) as { n: number }).n);

test('shipping without tracking asks first; a refund after shipping still reads Fulfilled', async ({ page }) => {
  await login(page);
  const { id } = orderRow('8804');
  await page.goto(`/admin/orders/${id}`);
  const form = page.getByRole('form', { name: 'Fulfill order' });

  page.once('dialog', (dlg) => { expect(dlg.message()).toContain('without a tracking number'); void dlg.dismiss(); });
  await form.getByRole('button', { name: 'Mark as fulfilled' }).click();
  await expect(form.getByRole('button', { name: 'Mark as fulfilled' })).toBeEnabled();
  expect(shipments(id)).toBe(0);

  page.once('dialog', (dlg) => void dlg.accept());
  await form.getByRole('button', { name: 'Mark as fulfilled' }).click();
  await expect.poll(() => shipments(id)).toBe(1);

  await page.reload();
  await page.getByLabel('Order status').selectOption('refunded');
  page.once('dialog', (dlg) => { expect(dlg.message()).toContain('as refunded'); void dlg.accept(); });
  await page.getByRole('button', { name: 'Update status' }).click();
  await expect.poll(() => orderRow('8804').status).toBe('refunded');
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 }).locator('..').getByText('Fulfilled', { exact: true }).first()).toBeVisible();
});

test('approving the last design starts production and emails the order address; guests appear in Customers', async ({ page }) => {
  await login(page);
  const res = await page.request.patch(`/api/admin/designs/${DESIGN}`, { data: { status: 'approved' } });
  expect(res.ok()).toBe(true);
  expect(orderRow('8805').status).toBe('in_production');
  expect(run((d) => (d.prepare('SELECT count(*) n FROM email_outbox WHERE to_addr = ?').get(GUEST) as { n: number }).n)).toBeGreaterThan(0);

  await page.goto(`/admin/customers?q=${encodeURIComponent(GUEST)}`);
  const row = page.getByRole('row').filter({ hasText: GUEST });
  await expect(row).toContainText('Guest, no account');
  await row.getByRole('link').first().click();
  await expect(page).toHaveURL(/\/admin\/customers\/guest\?email=/);
  await expect(page.getByText('#8805').first()).toBeVisible();
});

test('product images upload from a file; leaving an unsaved form asks first', async ({ page }) => {
  await login(page);
  const pid = run((d) => (d.prepare('SELECT id FROM products ORDER BY id LIMIT 1').get() as { id: number }).id);
  await page.goto(`/admin/products/${pid}`);

  const png = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#b34' } }).png().toBuffer();
  await page.getByLabel('Image file').setInputFiles({ name: 'photo.png', mimeType: 'image/png', buffer: png });
  const upload = page.getByLabel('Image file').locator('xpath=ancestor::form');
  await upload.getByLabel('Alt text').fill(ALT);
  await upload.getByRole('button', { name: 'Upload image' }).click();
  await expect(upload.getByText('Image added')).toBeVisible();
  await expect(page.getByRole('img', { name: ALT })).toBeVisible();
  const url = run((d) => (d.prepare('SELECT url FROM product_images WHERE alt = ?').get(ALT) as { url: string }).url);
  expect(url).toMatch(/^\/media\/mockups\/product-\d+-\d+\.webp$/);
  expect((await page.request.get(url)).headers()['content-type']).toBe('image/webp');

  await page.locator('input[name="title"]').first().fill('Unsaved title');
  page.once('dialog', (dlg) => { expect(dlg.message()).toContain('unsaved changes'); void dlg.dismiss(); });
  await page.getByRole('navigation').getByRole('link', { name: 'Orders' }).first().click();
  await expect(page).toHaveURL(new RegExp(`/admin/products/${pid}$`));
});
