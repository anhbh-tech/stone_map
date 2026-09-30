// Mã giảm giá lúc checkout: báo lỗi rõ (không tồn tại / hết hạn / chưa đủ tối thiểu), tổng tiền do server tính,
// mã + số tiền giảm lưu vào đơn và hiện ở trang cảm ơn, email, admin. Dữ liệu phụ xoá hết ở afterAll.
import { DatabaseSync } from 'node:sqlite';
import { expect, test, type Page } from '@playwright/test';
import { E2E_DB_PATH } from '../../playwright.config';

const DESIGN = 'DSN-UI3DSC';
const CODES = ['E2ESAVE10', 'E2EOLD', 'E2EMIN', 'E2EBIG30'];
const EMAIL = 'ui3.discounts@example.test';

function sql<T>(q: string, ...args: (string | number | null)[]): T[] {
  const d = new DatabaseSync(E2E_DB_PATH);
  try { return d.prepare(q).all(...args) as T[]; } finally { d.close(); }
}
const exec = (q: string, ...args: (string | number | null)[]) => { const d = new DatabaseSync(E2E_DB_PATH); try { d.prepare(q).run(...args); } finally { d.close(); } };

let variant = 0;
async function login(page: Page) {
  await page.goto('/admin/login');
  await page.getByLabel('Username').fill('admin');
  await page.getByLabel('Password', { exact: true }).fill('admin123');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/admin$/);
}
test.beforeAll(() => {
  const [p] = sql<{ id: number; v: number }>("SELECT p.id, (SELECT id FROM variants WHERE product_id = p.id ORDER BY position LIMIT 1) v FROM products p WHERE handle = 'pearl-pet-portrait'");
  variant = p.v;
  exec("INSERT INTO designs (id, product_id, mode, status, style, pet_name) VALUES (?, ?, 'ai', 'confirmed', 'royal-starry', 'Nori')", DESIGN, p.id);
  exec("INSERT INTO discounts (code, kind, value) VALUES ('E2ESAVE10', 'percent', 10)");
  exec("INSERT INTO discounts (code, kind, value, ends_at) VALUES ('E2EOLD', 'percent', 20, '2021-03-01 00:00:00')");
  exec("INSERT INTO discounts (code, kind, value, min_subtotal_cents) VALUES ('E2EMIN', 'fixed', 500, 100000)");
  exec("INSERT INTO discounts (code, kind, value) VALUES ('E2EBIG30', 'percent', 30)");
});

test.afterAll(() => {
  for (const { id } of sql<{ id: number }>('SELECT id FROM orders WHERE email = ?', EMAIL)) {
    for (const t of ['order_lines', 'order_addons', 'order_events', 'fulfillments']) exec(`DELETE FROM ${t} WHERE order_id = ?`, id);
    exec('DELETE FROM orders WHERE id = ?', id);
  }
  exec('DELETE FROM email_outbox WHERE to_addr = ?', EMAIL);
  exec("DELETE FROM events WHERE name = 'checkout_completed' AND payload LIKE '%E2ESAVE10%'");
  exec('DELETE FROM cart_lines WHERE design_id = ?', DESIGN);
  exec('DELETE FROM designs WHERE id = ?', DESIGN);
  exec("UPDATE discounts SET show_on_pdp = 1 WHERE code = 'PEARL5'"); // seed gốc
  exec(`DELETE FROM discounts WHERE code IN (${CODES.map(() => '?').join(',')})`, ...CODES);
});

test('discount code: clear errors, server-side totals, saved on the order', async ({ page }) => {
  expect((await page.request.post('/api/cart/lines', { data: { variant_id: variant, qty: 1, design_id: DESIGN } })).ok()).toBe(true);
  await page.goto('/cart');
  const box = page.getByTestId('discount-code');
  const field = box.getByLabel('Discount code');
  const apply = box.getByRole('button', { name: 'Apply' });
  const total = page.getByTestId('total');
  const before = await total.innerText();

  await field.fill('nope-123');
  await apply.click();
  await expect(box.getByText("We couldn't find the code NOPE-123. Check the spelling and try again.")).toBeVisible();
  await expect(field).toHaveAttribute('aria-invalid', 'true');

  await field.fill('e2eold');
  await field.press('Enter');
  await expect(box.getByText('The code E2EOLD expired on Mar 1, 2021.')).toBeVisible();

  await field.fill('E2EMIN');
  await apply.click();
  await expect(box.getByText(/^The code E2EMIN needs an order of \$1,000\.00 or more\. Add \$[\d,.]+ more to use it\.$/)).toBeVisible();
  await expect(total).toHaveText(before);

  await field.fill('e2esave10');
  await apply.click();
  await expect(box.getByText('E2ESAVE10', { exact: true })).toBeVisible();
  await expect(page.getByTestId('code-discount')).toContainText('Discount E2ESAVE10');
  await expect(total).not.toHaveText(before);

  // Checkout mang mã theo giỏ; client gửi thêm giá giả cũng bị bỏ qua.
  await page.goto('/checkout');
  await expect(page.getByTestId('discount-code').getByText('E2ESAVE10', { exact: true })).toBeVisible();
  await expect(page.getByTestId('code-discount')).toBeVisible();
  const forged = await page.request.post('/api/checkout', {
    data: { email: EMAIL, name: 'Robin Tester', shipping_method: 'standard', total_cents: 1, code_discount_cents: 999999, discount_code: 'E2EOLD',
      address: { line1: '1 Pearl Street', line2: '', city: 'Austin', region: 'TX', postal_code: '78701', country: 'US' } },
  });
  expect(forged.ok()).toBe(true);
  const { order_number } = await forged.json() as { order_number: string };

  const [o] = sql<{ subtotal_cents: number; discount_cents: number; addons_cents: number; shipping_cents: number; total_cents: number; discount_code: string; code_discount_cents: number }>(
    'SELECT subtotal_cents, discount_cents, addons_cents, shipping_cents, total_cents, discount_code, code_discount_cents FROM orders WHERE number = ?', order_number);
  expect(o.discount_code).toBe('E2ESAVE10');
  expect(o.code_discount_cents).toBe(Math.round((o.subtotal_cents - o.discount_cents) / 10));
  expect(o.total_cents).toBe(o.subtotal_cents - o.discount_cents - o.code_discount_cents + o.addons_cents + o.shipping_cents);
  expect(sql('SELECT 1 FROM email_outbox WHERE to_addr = ? AND html LIKE ?', EMAIL, '%Discount E2ESAVE10%')).toHaveLength(1);

  await page.goto(`/orders/${order_number}`);
  await expect(page.getByTestId('code-discount')).toContainText('E2ESAVE10');

  // Admin thấy mã trên đơn.
  await login(page);
  const [{ id }] = sql<{ id: number }>('SELECT id FROM orders WHERE number = ?', order_number);
  await page.goto(`/admin/orders/${id}`);
  await expect(page.locator('#totals')).toContainText('Discount code E2ESAVE10');
});

test('Buy More, Save More! table on the PDP lists flagged codes, copies them, and follows the admin flag', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/products/pearl-pet-portrait');
  const box = page.getByTestId('bulk-discounts');
  await expect(box.getByRole('heading', { name: 'Buy More, Save More!' })).toBeVisible();
  await expect(box.getByRole('columnheader')).toHaveText(['Spend', 'Get', 'Code']);
  const rows = box.locator('tbody tr');
  await expect(rows).toHaveText([/^Buy 2 items\s*15% off\s*PEARL2/, /^Buy 3 items\s*20% off\s*PEARL3/, /^Buy 5 items\s*25% off\s*PEARL5/]);
  await expect(box).not.toContainText('E2ESAVE10'); // không đánh dấu show_on_pdp
  await box.getByRole('button', { name: 'Copy code PEARL3' }).click();
  await expect(rows.nth(1).getByRole('status')).toHaveText('Copied');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('PEARL3');

  await login(page);
  await page.goto('/admin/discounts?q=PEARL5');
  await page.getByRole('link', { name: 'PEARL5' }).click();
  const edit = page.getByRole('form', { name: 'Edit discount' });
  await expect(edit.getByLabel('Show on product pages')).toBeChecked();
  await edit.getByLabel('Show on product pages').uncheck();
  await edit.getByRole('button', { name: 'Save discount' }).click();
  await expect(edit.getByRole('status').filter({ hasText: 'Discount saved' })).toBeVisible();
  await page.goto('/products/pearl-pet-portrait');
  await expect(page.getByTestId('bulk-discounts').locator('tbody tr')).toHaveCount(2);
  await expect(page.getByTestId('bulk-discounts')).not.toContainText('PEARL5');
});

test('codes never stack with the multi-portrait discount: the larger one applies and the cart says which', async ({ page }) => {
  expect((await page.request.post('/api/cart/lines', { data: { variant_id: variant, qty: 2, design_id: DESIGN } })).ok()).toBe(true);
  await page.goto('/cart');
  const box = page.getByTestId('discount-code');
  const totals = page.getByTestId('totals');
  await expect(totals).toContainText('Multi-portrait discount');
  const bundled = await page.getByTestId('total').innerText();

  // Bundle thắng: 10% = 10% → giữ giảm theo số lượng, báo khách, không có dòng mã.
  await box.getByLabel('Discount code').fill('E2ESAVE10');
  await box.getByRole('button', { name: 'Apply' }).click();
  await expect(box.getByTestId('discount-note')).toHaveText(/^Your bundle discount is already better/);
  await expect(box.getByText('Not applied')).toBeVisible();
  await expect(totals).toContainText('Multi-portrait discount');
  await expect(page.getByTestId('code-discount')).toHaveCount(0);
  await expect(page.getByTestId('total')).toHaveText(bundled);
  await page.goto('/checkout');
  await expect(page.getByTestId('discount-note')).toBeVisible();
  await page.goto('/cart');

  // Mã thắng: 30% > 10% → thay giảm theo số lượng.
  await box.getByRole('button', { name: 'Remove discount code E2ESAVE10' }).click();
  await box.getByLabel('Discount code').fill('E2EBIG30');
  await box.getByRole('button', { name: 'Apply' }).click();
  await expect(page.getByTestId('code-discount')).toContainText('Discount E2EBIG30');
  await expect(totals).not.toContainText('Multi-portrait discount');
  await expect(page.getByTestId('bundle-hint')).not.toContainText('multi-portrait discount applied');
  const [{ price }] = sql<{ price: number }>('SELECT price_cents price FROM variants WHERE id = ?', variant);
  const cents = Number((await page.getByTestId('total').innerText()).replace(/[^\d]/g, ''));
  const shipping = await totals.innerText();
  expect(cents).toBe(2 * price - Math.round(2 * price * 0.3) + (/Shipping\s*Free/.test(shipping) ? 0 : 699));
});
