// e2e InfoTabs trên PDP: accordion (aria-expanded, panel đóng không focus được), nội dung từ variants/settings,
// admin sửa phần riêng của sản phẩm và mặc định store. afterAll trả DB về seed (spec khác dùng chung DB).
import { DatabaseSync } from 'node:sqlite';
import { expect, test, type Page } from '@playwright/test';
import { E2E_DB_PATH } from '../../playwright.config';

const PDP = '/products/pearl-pet-portrait';
const INK = 'rgb(43, 29, 24)';
const LINEN = 'rgb(246, 242, 239)';

const restore = () => {
  const d = new DatabaseSync(E2E_DB_PATH);
  try {
    d.prepare("UPDATE products SET info_tabs = NULL WHERE handle = 'pearl-pet-portrait'").run();
    d.prepare("DELETE FROM settings WHERE key = 'pdp_info'").run();
  } finally { d.close(); }
};
test.beforeAll(restore);
test.afterAll(restore);

const tab = (page: Page, name: string) => page.getByRole('button', { name, exact: true });
const panel = (page: Page, name: string) => page.getByRole('region', { name, exact: true });

test('Description opens by default with sizes from the variants; other tabs toggle with aria-expanded', async ({ page }) => {
  await page.goto(PDP);
  const desc = tab(page, 'Description');
  await expect(desc).toHaveAttribute('aria-expanded', 'true');
  await expect(desc).toHaveCSS('background-color', LINEN);
  await expect(desc.locator('span[aria-hidden]')).toHaveCSS('background-color', INK);

  const d = panel(page, 'Description');
  await expect(d.getByRole('heading', { name: 'Product Description' })).toBeVisible();
  await expect(d.locator('strong').first()).toHaveText('Pearl Pet Portrait');
  await expect(d).toContainText('Available in four square sizes:');
  await expect(d.getByTestId('info-sizes').getByRole('listitem')).toHaveText(['8×8 in (20×20 cm)', '12×12 in (30×30 cm)', '16×16 in (41×41 cm)', '20×20 in (51×51 cm)']);
  await expect(d).toContainText('Warm Tip:');

  // Đóng: panel inert, cao 0, không tab vào được.
  const tips = tab(page, 'Shopping Tips');
  await expect(tips).toHaveAttribute('aria-expanded', 'false');
  const tp = page.locator(`#${await tips.getAttribute('aria-controls')}`);
  await expect(tp).toHaveAttribute('inert', '');
  await expect.poll(async () => (await tp.boundingBox())?.height ?? 0).toBeLessThan(1);

  await tips.click();
  await expect(tips).toHaveAttribute('aria-expanded', 'true');
  await expect(panel(page, 'Shopping Tips').locator('ol > li')).toHaveCount(5);
  await expect.poll(async () => (await tp.boundingBox())?.height ?? 0).toBeGreaterThan(100);

  // Bàn phím: Enter trên nút mở / Space đóng.
  const ship = tab(page, 'Shipping & Returns');
  await ship.focus();
  await page.keyboard.press('Enter');
  await expect(ship).toHaveAttribute('aria-expanded', 'true');
  const s = panel(page, 'Shipping & Returns');
  await expect(s).toContainText('Free US shipping on orders over $79.99');
  await expect(s).toContainText('within 4 hours of ordering');
  await expect(s).toContainText('weekends and public holidays');
  await expect(s.getByRole('link', { name: 'care@pearlatelier.test' }).first()).toHaveAttribute('href', 'mailto:care@pearlatelier.test');
  await page.keyboard.press('Space');
  await expect(ship).toHaveAttribute('aria-expanded', 'false');

  await desc.click();
  await expect(desc).toHaveAttribute('aria-expanded', 'false');
});

test('admin edits the product text and the store default, and the product page follows', async ({ page }) => {
  await page.goto('/admin/login');
  await page.getByLabel('Username').fill('admin');
  await page.getByLabel('Password', { exact: true }).fill('admin123');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/admin$/);

  const id = (() => { const d = new DatabaseSync(E2E_DB_PATH); try { return (d.prepare("SELECT id FROM products WHERE handle = 'pearl-pet-portrait'").get() as { id: number }).id; } finally { d.close(); } })();
  await page.goto(`/admin/products/${id}`);
  const form = page.getByRole('form', { name: 'Product info tabs' });
  await form.getByLabel('Description').fill('Hand-set **pearls** for {product}.');
  await form.getByLabel('Shopping Tips').fill('Use daylight, not flash\nCheck the name');
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(form.getByText('Saved')).toBeVisible();

  await page.goto('/admin/settings');
  const defaults = page.getByRole('form', { name: 'Product info tab defaults' });
  await defaults.getByLabel('Hours to change or cancel an order').fill('6');
  await defaults.getByRole('button', { name: 'Save' }).click();
  await expect(defaults.getByText('Saved')).toBeVisible();

  await page.goto(PDP);
  const d = panel(page, 'Description');
  await expect(d).toContainText('Hand-set pearls for Pearl Pet Portrait.');
  await expect(d.locator('strong', { hasText: 'pearls' })).toBeVisible();
  await tab(page, 'Shopping Tips').click();
  await expect(panel(page, 'Shopping Tips').locator('ol > li')).toHaveText(['Use daylight, not flash', 'Check the name']);
  await tab(page, 'Shipping & Returns').click();
  await expect(panel(page, 'Shipping & Returns')).toContainText('within 6 hours of ordering');
});

test.describe('mobile 375px', () => {
  test.use({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });

  test('tabs fit the width with 44px+ tap targets', async ({ page }) => {
    await page.goto(PDP);
    const tips = tab(page, 'Shopping Tips');
    await tips.scrollIntoViewIfNeeded();
    const b = (await tips.boundingBox())!;
    expect(b.height).toBeGreaterThanOrEqual(44);
    expect(b.x + b.width).toBeLessThanOrEqual(375);
    await tips.tap();
    await expect(tips).toHaveAttribute('aria-expanded', 'true');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  });
});
