// Regression H-01 (docs/critique/handoff-from-ps-ui3-admin.md): PDP sản phẩm theme phải chọn sẵn đúng theme, và server
// luôn lưu theme của sản phẩm vào design dù client gửi style khác. API thật + provider mock (không gen trả phí).
// Chạy: npx playwright test -c tests/e2e/personalizer-theme-style.config.ts
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { expect, test } from '@playwright/test';
import { E2E_DB_PATH } from '../../playwright.config';

const FIX = path.join(__dirname, '..', 'fixtures');
const HANDLE = 'the-sunflower-queen';
const withDb = <T>(fn: (d: DatabaseSync) => T) => { const d = new DatabaseSync(E2E_DB_PATH); try { return fn(d); } finally { d.close(); } };

let productId = 0;
let addedImage = false;

test.describe.configure({ mode: 'serial' });

// Sản phẩm theme là draft trong DB e2e (chưa nạp ảnh rollout) → bật active + 1 ảnh demo trong lúc chạy, afterAll trả lại.
test.beforeAll(() => withDb((d) => {
  const p = d.prepare('SELECT id, status FROM products WHERE handle = ?').get(HANDLE) as { id: number; status: string };
  productId = p.id;
  d.prepare("UPDATE products SET status = 'active' WHERE id = ?").run(p.id);
  const n = (d.prepare('SELECT COUNT(*) AS n FROM product_images WHERE product_id = ?').get(p.id) as { n: number }).n;
  if (!n) {
    d.prepare("INSERT INTO product_images (product_id, url, alt, kind, position) VALUES (?, '/demo/sunflower-queen.webp', 'e2e', 'gallery', 1)").run(p.id);
    addedImage = true;
  }
}));

test.afterAll(() => withDb((d) => {
  // seedThemes() (afterAll của ui2-theme-products) dựng lại size của sản phẩm → bỏ tham chiếu variant của design test tạo.
  d.prepare('UPDATE designs SET variant_id = NULL WHERE product_id = ?').run(productId);
  if (addedImage) d.prepare("DELETE FROM product_images WHERE product_id = ? AND alt = 'e2e'").run(productId);
  d.prepare("UPDATE products SET status = 'draft' WHERE id = ?").run(productId);
}));

test('Sunflower Queen PDP preselects its theme and the design is created as sunflower-queen', async ({ page }) => {
  await page.goto(`/products/${HANDLE}`);
  const styles = page.getByRole('group', { name: 'Style' }).getByRole('radio');
  await expect(styles).toHaveCount(1);
  await expect(page.getByRole('radio', { name: 'Sunflower Queen' })).toBeChecked();
  await expect(page.getByRole('radio', { name: 'Starry King' })).toHaveCount(0);

  await page.getByTestId('consent').check();
  const uploaded = page.waitForResponse((r) => r.url().endsWith('/api/personalize/uploads'));
  await page.getByTestId('photo-input').setInputFiles(path.join(FIX, 'pet-ok.jpg'));
  expect((await uploaded).status()).toBe(201);
  const created = page.waitForResponse((r) => r.url().endsWith('/api/personalize/designs') && r.request().method() === 'POST');
  const generated = page.waitForResponse((r) => r.url().endsWith('/generate'));
  await page.getByRole('button', { name: /Generate with AI/ }).click();
  const design = await (await created).json();
  expect(design.style).toBe('sunflower-queen');
  expect((await generated).request().postDataJSON()).toEqual({ style: 'sunflower-queen' });
  const saved = await (await page.request.get(`/api/personalize/designs/${design.id}`)).json();
  expect(saved.style).toBe('sunflower-queen');
});

test('API keeps the product theme when the client sends another style', async ({ request }) => {
  const up = await (await request.post('/api/personalize/uploads', {
    multipart: { consent: '1', file: { name: 'pet-ok.jpg', mimeType: 'image/jpeg', buffer: fs.readFileSync(path.join(FIX, 'pet-ok.jpg')) } },
  })).json();
  const cr = await request.post('/api/personalize/designs', { data: { product_id: productId, upload_id: up.upload_id, mode: 'ai', style: 'royal-starry' } });
  expect(cr.status()).toBe(201);
  const d = await cr.json();
  expect(d.style).toBe('sunflower-queen');

  const pr = await request.patch(`/api/personalize/designs/${d.id}`, { data: { style: 'royal-starry' } });
  expect((await pr.json()).style).toBe('sunflower-queen');

  const gr = await request.post(`/api/personalize/designs/${d.id}/generate`, { data: { style: 'royal-starry' } });
  expect(gr.status()).toBe(202);
  expect((await (await request.get(`/api/personalize/designs/${d.id}`)).json()).style).toBe('sunflower-queen');
});
