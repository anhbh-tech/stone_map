// Sửa P1 từ docs/critique/ui1-shell.md: trang chủ dẫn tới sản phẩm thật + lối theo dịp (#5),
// giỏ không để chữ mã giảm cũ, gợi ý mã rẻ hơn, báo còn bao nhiêu tới free ship (#2, #14). Dữ liệu phụ xoá ở afterAll.
import { DatabaseSync } from 'node:sqlite';
import { expect, test } from '@playwright/test';
import { E2E_DB_PATH } from '../../playwright.config';

const DESIGN = 'DSN-UI1CRT';

function sql<T>(q: string, ...args: (string | number | null)[]): T[] {
  const d = new DatabaseSync(E2E_DB_PATH);
  try { return d.prepare(q).all(...args) as T[]; } finally { d.close(); }
}
const exec = (q: string, ...args: (string | number | null)[]) => { const d = new DatabaseSync(E2E_DB_PATH); try { d.prepare(q).run(...args); } finally { d.close(); } };

let variant = 0;
let price = 0;
test.beforeAll(() => {
  const [p] = sql<{ id: number; v: number; price: number }>(`SELECT p.id, v.id v, v.price_cents price FROM products p
    JOIN variants v ON v.product_id = p.id WHERE p.handle = 'pearl-pet-portrait' ORDER BY v.price_cents LIMIT 1`);
  variant = p.v;
  price = p.price;
  exec("INSERT INTO designs (id, product_id, mode, status, style, pet_name) VALUES (?, ?, 'ai', 'confirmed', 'royal-starry', 'Pip')", DESIGN, p.id);
});
test.afterAll(() => {
  exec('DELETE FROM cart_lines WHERE design_id = ?', DESIGN);
  exec('DELETE FROM designs WHERE id = ?', DESIGN);
});

for (const vp of [{ width: 1440, height: 900 }, { width: 375, height: 812 }]) {
  test(`home links every featured portrait and the occasions at ${vp.width}px`, async ({ page }) => {
    await page.setViewportSize(vp);
    await page.goto('/');
    const cards = page.getByRole('region', { name: 'Featured portraits' }).getByTestId('product-card');
    expect(await cards.count()).toBeGreaterThanOrEqual(2);
    const hrefs = await cards.getByRole('link').evaluateAll((as) => as.map((a) => a.getAttribute('href')));
    expect(new Set(hrefs).size).toBe(hrefs.length); // mỗi thẻ một sản phẩm khác nhau
    for (const h of hrefs) expect(h).toMatch(/^\/products\/[a-z0-9-]+$/);
    const occasions = page.getByRole('navigation', { name: 'Shop by occasion' }).getByRole('link');
    await expect(occasions.first()).toHaveAttribute('href', /^\/collections\//);
    await occasions.first().click();
    await expect(page).toHaveURL(/\/collections\//);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(vp.width);
  });
}

test('cart: suggests the cheaper code, drops stale hints, and shows the free-shipping gap', async ({ page }) => {
  test.skip(price * 2 >= 7999 * 1.1, 'seed price changed: the 2-portrait cart no longer sits under the free-shipping line');
  expect((await page.request.post('/api/cart/lines', { data: { variant_id: variant, qty: 2, design_id: DESIGN } })).ok()).toBe(true);
  await page.goto('/cart');
  const box = page.getByTestId('discount-code');

  // Bậc 10% tự động; PEARL2 (15%) rẻ hơn → gợi ý, một nút áp.
  await expect(box.getByTestId('discount-better')).toContainText('Code PEARL2 saves you');
  await expect(page.getByTestId('free-shipping')).toContainText(/Add \$\d+\.\d{2} more for free shipping/);
  await box.getByRole('button', { name: 'Use PEARL2' }).click();
  await expect(page.getByTestId('code-discount')).toContainText('Discount PEARL2');
  await expect(page.getByTestId('bundle-hint')).toHaveCount(0); // không còn "Add 1 more to save 15%"
  await expect(box.getByTestId('discount-better')).toHaveCount(0);

  // Lên 3: PEARL2 = bậc 15% → giữ bậc, gợi ý PEARL3.
  await page.getByRole('button', { name: 'Increase quantity' }).click();
  await expect(page.getByTestId('line-qty')).toHaveText('3');
  await expect(box.getByTestId('discount-note')).toHaveText(/^Your bundle discount is already better/);
  await expect(box.getByTestId('discount-better')).toContainText('Code PEARL3 saves you $');
  await expect(page.getByTestId('free-shipping')).not.toContainText('more for free shipping');

  // Về 1: mã không còn đủ điều kiện → lý do hiện, không còn lời "applied" cũ trong live region.
  await page.getByRole('button', { name: 'Decrease quantity' }).click();
  await page.getByRole('button', { name: 'Decrease quantity' }).click();
  await expect(page.getByTestId('line-qty')).toHaveText('1');
  await expect(box).toContainText('needs 2 or more');
  await expect(box.getByRole('status')).not.toContainText('applied');
});
