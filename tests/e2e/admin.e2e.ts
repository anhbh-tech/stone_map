// Crew A e2e: đăng nhập (sai bị chặn / đúng vào được), settings.shipping đổi shippingHeadline (#3),
// hàng chờ designer (#11) và khoá is_sample của review (#4). Dữ liệu phụ ghi thẳng vào DB tmp của config.
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { expect, test, type Page } from '@playwright/test';
import { E2E_DB_PATH } from './admin.config';

const db = () => new DatabaseSync(E2E_DB_PATH);

// Spec này đổi settings và ẩn review mẫu; trả lại như cũ để spec crew khác (cùng DB ở lần chạy gốc) thấy dữ liệu seed.
let snapshot: { settings: { key: string; value: string }[]; reviews: { id: number; status: string }[] };
test.beforeAll(() => {
  const d = db();
  try {
    snapshot = {
      settings: d.prepare('SELECT key, value FROM settings').all() as typeof snapshot.settings,
      reviews: d.prepare('SELECT id, status FROM reviews').all() as typeof snapshot.reviews,
    };
  } finally { d.close(); }
});
test.afterAll(() => {
  const d = db();
  try {
    for (const r of snapshot.settings) d.prepare('UPDATE settings SET value = ? WHERE key = ?').run(r.value, r.key);
    for (const r of snapshot.reviews) d.prepare('UPDATE reviews SET status = ? WHERE id = ?').run(r.status, r.id);
    d.prepare("DELETE FROM reviews WHERE author = 'Alex P.'").run();
  } finally { d.close(); }
});

async function login(page: Page, password = 'admin123') {
  await page.goto('/admin/login');
  await page.getByLabel('Username').fill('admin');
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  if (password === 'admin123') await expect(page).toHaveURL(/\/admin$/);
}

test('unauthenticated requests are blocked', async ({ page, request }) => {
  await page.goto('/admin/settings');
  await expect(page).toHaveURL(/\/admin\/login\?next=%2Fadmin%2Fsettings$/);
  const api = await request.get('/api/admin/orders');
  expect(api.status()).toBe(401);
  expect((await api.json()).error.code).toBe('unauthorized');
});

test('wrong password is rejected and does not open the admin', async ({ page }) => {
  await login(page, 'wrong-password');
  await expect(page.locator('#login-error')).toHaveText('Incorrect username or password');
  await expect(page).toHaveURL(/\/admin\/login/);
  await page.goto('/admin');
  await expect(page).toHaveURL(/\/admin\/login/);
});

test('correct login opens the dashboard, sets an httpOnly cookie, and sign out ends the session', async ({ page, context }) => {
  await login(page);
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Home' })).toBeVisible();
  await expect(page.getByTestId('job-metrics')).toContainText('p75 duration');
  const cookie = (await context.cookies()).find((c) => c.name === 'pa_admin');
  expect(cookie?.httpOnly).toBe(true);
  expect(cookie?.sameSite).toBe('Strict');

  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/admin\/login/);
  await page.goto('/admin/orders');
  await expect(page).toHaveURL(/\/admin\/login/);
});

test('editing settings.shipping changes the shipping headline', async ({ page, request }) => {
  await login(page);
  await page.goto('/admin/settings');
  const headline = page.getByTestId('shipping-headline');
  await expect(headline).toHaveText('Free US shipping on orders over $79.99');

  const form = page.locator('#settings-shipping form');
  await form.getByLabel('Ship to regions').fill('US, CA');
  await form.getByLabel('Free shipping over').fill('120');
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(form.getByRole('status')).toHaveText('Saved');
  await expect(headline).toHaveText('Free US, CA shipping on orders over $120.00');

  // Không free ship → câu chữ đổi theo, vẫn từ cùng một hàm shippingHeadline().
  await form.getByLabel('Free shipping over').fill('');
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(headline).toHaveText('Shipping to US, CA');

  // Lỗi hiện ngay dưới ô sai.
  await form.getByLabel('Standard max days').fill('1');
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(form.getByText('Max days must be ≥ min days', { exact: true })).toBeVisible();
  await expect(headline).toHaveText('Shipping to US, CA');

  // Fixture `request` không mang cookie của trang → API ghi vẫn bị chặn.
  expect((await request.put('/api/admin/settings/shipping', { data: {} })).status()).toBe(401);
});

test('designer queue: upload hand-made artwork, approve, download print file, email queued', async ({ page }) => {
  const d = db();
  d.exec(`INSERT OR IGNORE INTO uploads (id, path, mime, width, height, sha, preflight, consent_at, expires_at)
    VALUES ('up_e2e', 'storage/uploads/up_e2e.jpg', 'image/jpeg', 1600, 1067, 'e2e', '{"ok":false}', datetime('now'), datetime('now', '+30 days'))`);
  d.exec(`INSERT OR REPLACE INTO designs (id, product_id, variant_id, upload_id, mode, pet_name, notes, status, email)
    VALUES ('DSN-E2EAAA', (SELECT id FROM products LIMIT 1), (SELECT id FROM variants ORDER BY position LIMIT 1), 'up_e2e',
            'designer', 'Mochi', 'Please remove the leash', 'in_review', 'buyer@example.test')`);
  d.close();

  await page.route('**/media/**', (r) => r.fulfill({ status: 404, body: '' })); // /media là của crew B
  await login(page);
  await page.goto('/admin/designs');
  const card = page.locator('li#DSN-E2EAAA');
  await expect(card.getByRole('heading', { name: 'Mochi' })).toBeVisible();
  await expect(card).toContainText('Please remove the leash');

  await card.getByLabel('Hand-made artwork').setInputFiles(path.join(__dirname, '../fixtures/pet-ok.jpg'));
  await card.getByRole('button', { name: 'Upload artwork' }).click();
  await expect(card.getByRole('status').filter({ hasText: 'Uploaded' })).toBeVisible();

  const download = page.waitForEvent('download');
  await card.getByRole('link', { name: 'Print file' }).click();
  expect((await download).suggestedFilename()).toBe('DSN-E2EAAA-2000px.png');

  await card.getByRole('button', { name: 'Approve' }).click();
  await expect(card).toHaveCount(0);
  await page.goto('/admin/designs?status=approved');
  await expect(page.locator('li#DSN-E2EAAA')).toContainText('Approved');

  await page.goto('/admin/emails');
  await expect(page.getByRole('link', { name: /Mochi's portrait is approved/ })).toBeVisible();
});

test('reviews: publish/hide works, is_sample cannot be changed, manual reviews are real', async ({ page }) => {
  await login(page);
  const api = page.request;
  const sample = db().prepare('SELECT id FROM reviews WHERE is_sample = 1 LIMIT 1').get() as { id: number };

  const bad = await api.patch(`/api/admin/reviews/${sample.id}`, { data: { is_sample: 0 }, headers: { origin: new URL(page.url()).origin } });
  expect(bad.status()).toBe(422);
  expect((await bad.json()).error.code).toBe('is_sample_immutable');
  expect((await api.post('/api/admin/reviews', { data: { product_id: null, author: 'X', rating: 5, body: 'b', is_sample: 1 } })).status()).toBe(422);

  await page.goto('/admin/reviews');
  const card = page.getByTestId(`review-${sample.id}`);
  await expect(card).toContainText('Sample review');
  await card.getByRole('button', { name: `Hide review ${sample.id}` }).click();
  await expect(card.getByRole('button', { name: `Publish review ${sample.id}` })).toBeVisible();
  expect((db().prepare('SELECT status FROM reviews WHERE id = ?').get(sample.id) as { status: string }).status).toBe('hidden');

  const form = page.locator('#new-review form');
  await form.getByLabel('Customer name').fill('Alex P.');
  await form.getByLabel(/^Review/).fill('Arrived quickly and looks like our dog.');
  await form.getByRole('button', { name: 'Add review' }).click();
  await expect(form.getByRole('status')).toHaveText('Review added');
  const added = db().prepare("SELECT is_sample, status FROM reviews WHERE author = 'Alex P.'").get() as { is_sample: number; status: string };
  expect(added).toEqual({ is_sample: 0, status: 'pending' });
});

test('products: meta description and image alt are required', async ({ page }) => {
  await login(page);
  await page.goto('/admin/products');
  await page.getByRole('link', { name: 'Pearl Pet Portrait' }).click();
  const details = page.getByRole('form', { name: 'Product details' });
  await details.getByLabel('Meta description').fill('');
  await details.getByRole('button', { name: 'Save' }).click();
  await expect(details.getByText('Required before the product can be active').first()).toBeVisible();

  const res = await page.request.post('/api/admin/images', { data: { product_id: 1, url: '/demo/cafe-duke.webp', alt: '   ' } });
  expect(res.status()).toBe(422);
  expect((await res.json()).error.fields.alt).toBe('Required');
  expect(await page.locator('h1').count()).toBe(1);
});
