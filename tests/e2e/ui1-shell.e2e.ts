// e2e crew UI-1 — design system, store shell (announcement bar, header, breadcrumb, footer) và PDP (giá động, lựa chọn, gallery, thanh mua mobile).
// Chỉ đọc dữ liệu seed; add-on được mock để không ghi giỏ thật.
import { expect, test, type Page } from '@playwright/test';

const PDP = '/products/pearl-pet-portrait';
const RED = 'rgb(198, 42, 47)'; // --accent / --sale ở globals.css (light)

async function mockAddons(page: Page) {
  await page.route('**/api/cart/addons', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ lines: [] }) }));
}

test.describe('store shell', () => {
  test('announcement bar, header with search/account/cart, category row, multi-column footer', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('shipping-banner')).toBeVisible();
    await expect(page.getByText(/Order 2 portraits, save 10% automatically/)).toBeVisible(); // từ bundle_tiers, không gõ tay

    const header = page.locator('header').first();
    await expect(header.getByRole('link', { name: 'Pearl Atelier' })).toHaveAttribute('href', '/');
    const search = header.getByRole('search');
    await expect(search).toHaveCount(1); // một ô search duy nhất (không trùng id giữa mobile/desktop)
    await expect(search).toHaveAttribute('action', '/search');
    await expect(header.getByRole('link', { name: /account|sign in/i })).toBeVisible();
    await expect(header.getByRole('link', { name: /^Cart, \d+ items?$/ })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();

    const footer = page.locator('footer');
    for (const col of ['Shop', 'Help', 'Account']) await expect(footer.getByRole('navigation', { name: col })).toBeVisible();
    await expect(footer.getByRole('link', { name: 'Shipping & delivery' })).toHaveAttribute('href', '/policies/shipping');
  });

  test('search submits to /search?q=', async ({ page }) => {
    await page.goto('/');
    const box = page.locator('header').getByRole('searchbox');
    await box.fill('corgi');
    await box.press('Enter');
    await expect(page).toHaveURL(/\/search\?q=corgi/);
  });

  test('display font is loaded and headings do not fake-bold it', async ({ page }) => {
    await page.goto(PDP);
    const h1 = page.locator('h1');
    const style = await h1.evaluate((e) => { const c = getComputedStyle(e); return { family: c.fontFamily, synthesis: c.fontSynthesis }; });
    expect(style.family).toMatch(/Caprasimo/);
    expect(style.synthesis).toBe('none');
    expect(await page.evaluate(() => document.fonts.check('16px Caprasimo'))).toBe(true);
  });
});

test.describe('product page', () => {
  test('breadcrumb: Home › product, current page marked', async ({ page }) => {
    await page.goto(PDP);
    const crumbs = page.getByRole('navigation', { name: 'Breadcrumb' });
    await expect(crumbs.getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/');
    await expect(crumbs.locator('[aria-current="page"]')).toHaveText('Pearl Pet Portrait');
    const ld = (await page.locator('script[type="application/ld+json"]').allTextContents()).map((t) => JSON.parse(t));
    expect(ld[0]['@type']).toBe('Product');
    expect(ld.some((d) => d['@type'] === 'BreadcrumbList')).toBe(true);
  });

  test('one red price near the title, updates with size, quantity and add-ons; strike + % off', async ({ page }) => {
    await mockAddons(page);
    await page.goto(PDP);
    const price = page.getByTestId('price');
    await expect(page.locator('[data-price]').first()).toHaveCSS('color', RED);
    await expect(price).toContainText('$39.98');
    await expect(price).toContainText('$59.98'); // compare_at gạch
    await expect(page.getByTestId('sale-badge')).toHaveText('Save 33%');

    // Giá nằm ngay dưới tiêu đề, trước mọi lựa chọn.
    const h1 = (await page.locator('h1').boundingBox())!;
    const p = (await price.boundingBox())!;
    const size = (await page.getByTestId('size-option').first().boundingBox())!;
    expect(p.y).toBeGreaterThan(h1.y);
    expect(p.y).toBeLessThan(size.y);

    await page.getByTestId('size-option').nth(1).click();
    await expect(price).toContainText('$59.98');
    await expect(price).toContainText('$79.98');

    // 2 bản: 2 × 59.98 = 119.96, −10% = 107.96; gạch 2 × 79.98 = 159.96 → giảm 33%.
    await page.getByTestId('bundle-option').nth(1).click();
    await expect(price).toContainText('$107.96');
    await expect(price).toContainText('$159.96');
    await expect(price).toContainText('for 2 portraits');

    // Add-on cộng 1 lần: 107.96 + 13.98 = 121.94.
    await page.getByLabel(/Gold floating frame/).check();
    await expect(price).toContainText('$121.94');
    await expect(price).toContainText('add-ons included');

    // Các nút lựa chọn không ghi giá (add-on chỉ ghi phần cộng thêm).
    for (const id of ['size-option', 'bundle-option']) {
      for (const o of await page.getByTestId(id).all()) await expect(o).not.toContainText('$');
    }
    // Giá chỉ hiện một chỗ: không còn tổng dòng trùng ở khối Add to cart.
    await expect(page.getByTestId('line-total')).toHaveCount(0);
  });

  test('selected options are outlined in red', async ({ page }) => {
    await page.goto(PDP);
    const sel = page.getByTestId('size-option').first();
    await expect(sel.locator('input')).toBeChecked();
    await expect(sel).toHaveCSS('border-top-color', RED);
    await expect(page.getByTestId('size-option').nth(1)).not.toHaveCSS('border-top-color', RED);
    // Nút mua đỏ chỉ khi bấm được; lúc chưa có ảnh (disabled) là màu trung tính, không phải đỏ nhạt.
    const atc = page.getByRole('button', { name: 'Add to cart' });
    await expect(atc).toBeDisabled();
    await expect(atc).not.toHaveCSS('background-color', RED);
    await expect(page.getByTestId('sale-badge')).toHaveCSS('background-color', RED);
  });

  test('desktop gallery: square main image ≤ 70vh in a ~55% column, 64px thumbnail strip', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(PDP);
    const track = page.getByRole('list', { name: /Product photos/ });
    const box = (await track.boundingBox())!;
    expect(Math.abs(box.width - box.height)).toBeLessThan(2);
    expect(box.height).toBeLessThanOrEqual(900 * 0.7 + 1);
    expect(box.width).toBeLessThan(1440 * 0.55);
    const thumbs = page.getByRole('list', { name: 'Choose a photo' }).getByRole('button');
    await expect(thumbs).toHaveCount(3);
    const t = (await thumbs.first().boundingBox())!;
    expect(t.width).toBeGreaterThanOrEqual(56);
    expect(t.width).toBeLessThanOrEqual(72);
    // Thumbnail đầu + ảnh chính cùng nằm trong màn hình đầu.
    expect(t.y + t.height).toBeLessThanOrEqual(900);

    await expect(thumbs.first()).toHaveAttribute('aria-current', 'true');
    await thumbs.nth(2).click();
    await expect(thumbs.nth(2)).toHaveAttribute('aria-current', 'true');
    await expect(thumbs.nth(2)).toHaveCSS('border-top-color', RED);
    await page.getByRole('button', { name: 'Next photo' }).click();
    await expect(thumbs.first()).toHaveAttribute('aria-current', 'true'); // vòng lại
  });
});

test.describe('mobile 375px', () => {
  test.use({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });

  test('title and price in the first screen; swipe gallery with dots; menu drawer', async ({ page }) => {
    await page.goto(PDP);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
    const p = (await page.getByTestId('price').boundingBox())!;
    expect(p.y + p.height).toBeLessThanOrEqual(812);
    await expect(page.getByTestId('gallery-dots')).toBeVisible();
    await expect(page.getByRole('list', { name: 'Choose a photo' })).toBeHidden();

    const track = page.getByRole('list', { name: /Product photos/ });
    await track.evaluate((el) => el.scrollTo({ left: el.clientWidth, behavior: 'instant' }));
    await expect(page.getByTestId('gallery-dots').locator('span').nth(1)).toHaveClass(/w-5/);

    await page.getByRole('button', { name: 'Open menu' }).click();
    const menu = page.getByRole('dialog', { name: 'Menu' });
    await expect(menu).toBeVisible();
    await expect(menu.getByRole('link', { name: 'How it works' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
  });

  test('sticky buy bar appears once the price and the buy box scroll away, and leads to the next step', async ({ page }) => {
    await page.goto(PDP);
    const bar = page.getByTestId('sticky-buy');
    await expect(bar).toHaveAttribute('data-visible', 'false');
    await page.locator('#step-style').scrollIntoViewIfNeeded();
    await expect(bar).toHaveAttribute('data-visible', 'true');
    await expect(bar.getByTestId('price')).toHaveCount(0); // bản thu gọn, không nhân đôi testid
    await expect(bar).toContainText('$39.98');
    await expect.poll(async () => { const b = (await bar.boundingBox())!; return b.y + b.height; }).toBeLessThanOrEqual(812 + 1); // hết trượt lên
    expect((await bar.boundingBox())!.height).toBeLessThanOrEqual(80);

    // Chưa có ảnh → nút (đỏ, bấm được) đưa về bước upload, không phải thêm giỏ.
    await expect(bar.getByRole('button', { name: 'Personalize it' })).toHaveCSS('background-color', RED);
    await bar.getByRole('button', { name: 'Personalize it' }).click();
    await expect(page.locator('#step-photo')).toBeInViewport();

    // Khối Add to cart trên trang đang hiện → thanh ẩn, không có hai nút mua cùng lúc.
    await page.getByRole('button', { name: 'Add to cart' }).scrollIntoViewIfNeeded();
    await expect(bar).toHaveAttribute('data-visible', 'false');
    await expect(page.getByRole('button', { name: 'Add to cart' })).toHaveCount(1);
  });
});
