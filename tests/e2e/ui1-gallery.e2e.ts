// e2e crew UI-1 — slider ảnh PDP: nút ‹ › (44px, disable ở đầu/cuối), chuyển ảnh bằng transform ~300ms, preload ảnh kề,
// vuốt theo ngón tay + snap, phím ←/→/Home/End, thumbnail đồng bộ, chấm mobile, lightbox, reduced-motion, 0 lỗi console.
// Chỉ đọc dữ liệu seed (3 ảnh gallery của Pearl Pet Portrait).
import { expect, test, type Page } from '@playwright/test';

const PDP = '/products/pearl-pet-portrait';

/** Gom lỗi console + lỗi JS chưa bắt; test cuối assert rỗng. */
function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  return errors;
}

const current = (page: Page, scope = 'gallery-viewport') => page.getByTestId(scope).locator('[aria-roledescription="slide"][aria-hidden="false"]');
const trackX = (page: Page, scope = 'gallery-viewport') =>
  page.getByTestId(scope).getByTestId('gallery-track').evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).m41);

/** Vuốt bằng touch thật qua CDP (pointerType=touch, tôn trọng touch-action như trên máy). */
async function swipe(page: Page, fromX: number, toX: number, y: number, steps = 8, stepMs = 16) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: fromX, y }] });
  for (let i = 1; i <= steps; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: fromX + ((toX - fromX) * i) / steps, y }] });
    await page.waitForTimeout(stepMs);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}

test.describe('PDP slider, desktop', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('next/prev: 44px labelled buttons, disabled at the ends, eased transform with no layout jump', async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto(PDP);
    const prev = page.getByRole('button', { name: 'Previous photo' });
    const next = page.getByRole('button', { name: 'Next photo' });
    for (const b of [prev, next]) {
      const r = (await b.boundingBox())!;
      expect(r.width).toBeGreaterThanOrEqual(44);
      expect(r.height).toBeGreaterThanOrEqual(44);
    }
    await expect(prev).toBeDisabled();
    await expect(current(page)).toHaveAttribute('aria-label', '1 of 3');

    const vp = page.getByTestId('gallery-viewport');
    const before = (await vp.boundingBox())!;
    const track = vp.getByTestId('gallery-track');
    expect(await track.evaluate((el) => getComputedStyle(el).transitionDuration)).toBe('0.3s');

    // Giữa chừng (~120ms) track đang trượt: vị trí nằm giữa ảnh 1 và ảnh 2 → không nhảy.
    const w = before.width;
    const mid = await track.evaluate(async (el) => {
      (document.querySelector('button[aria-label="Next photo"]') as HTMLButtonElement).click();
      await new Promise((r) => setTimeout(r, 120));
      return new DOMMatrix(getComputedStyle(el).transform).m41;
    });
    expect(mid).toBeLessThan(-2);
    expect(mid).toBeGreaterThan(-w + 2);
    await expect.poll(() => trackX(page)).toBeCloseTo(-w, 0);
    await expect(current(page)).toHaveAttribute('aria-label', '2 of 3');
    expect((await vp.boundingBox())!).toEqual(before); // khung ảnh không đổi kích thước/vị trí

    await next.click();
    await expect(current(page)).toHaveAttribute('aria-label', '3 of 3');
    await expect(next).toBeDisabled();
    await prev.click();
    await expect(current(page)).toHaveAttribute('aria-label', '2 of 3');
    expect(errors).toEqual([]);
  });

  test('neighbour photos are preloaded, far ones stay lazy until approached', async ({ page }) => {
    await page.goto(PDP);
    const imgs = page.getByTestId('gallery-track').locator('img');
    await expect(imgs).toHaveCount(3);
    await expect(imgs.nth(1)).toHaveAttribute('loading', 'eager');
    await expect.poll(() => imgs.nth(1).evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0)).toBe(true);
    await expect(imgs.nth(2)).toHaveAttribute('loading', 'lazy');
    await page.getByRole('button', { name: 'Next photo' }).click();
    await expect(imgs.nth(2)).toHaveAttribute('loading', 'eager');
  });

  test('arrow keys, Home and End move the slider; thumbnails follow and select', async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto(PDP);
    const thumbs = page.getByRole('list', { name: 'Choose a photo' }).getByRole('button');
    await page.getByRole('button', { name: 'Open photo 1 of 3 full screen' }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(current(page)).toHaveAttribute('aria-label', '2 of 3');
    await expect(thumbs.nth(1)).toHaveAttribute('aria-current', 'true');
    await page.keyboard.press('End');
    await expect(current(page)).toHaveAttribute('aria-label', '3 of 3');
    await page.keyboard.press('ArrowRight'); // đã ở cuối: đứng yên
    await expect(current(page)).toHaveAttribute('aria-label', '3 of 3');
    await page.keyboard.press('Home');
    await expect(current(page)).toHaveAttribute('aria-label', '1 of 3');

    await thumbs.nth(2).click();
    await expect(current(page)).toHaveAttribute('aria-label', '3 of 3');
    await expect(thumbs.nth(2)).toHaveAttribute('aria-current', 'true');
    await expect(thumbs.nth(0)).not.toHaveAttribute('aria-current', 'true');
    await page.keyboard.press('ArrowLeft'); // focus đang ở thumbnail: phím vẫn điều khiển gallery
    await expect(current(page)).toHaveAttribute('aria-label', '2 of 3');
    await expect(thumbs.nth(1)).toHaveAttribute('aria-current', 'true');
    expect(errors).toEqual([]);
  });

  test('mouse drag past 20% of the width moves one photo; a short drag snaps back', async ({ page }) => {
    await page.goto(PDP);
    const box = (await page.getByTestId('gallery-viewport').boundingBox())!;
    const y = box.y + box.height / 2;
    // Kéo chậm (40ms/bước) để không thành cú vuốt nhanh (flick có quán tính).
    const drag = async (from: number, to: number) => {
      await page.mouse.move(from, y);
      await page.mouse.down();
      for (let i = 1; i <= 8; i++) { await page.mouse.move(from + ((to - from) * i) / 8, y); await page.waitForTimeout(40); }
      await page.mouse.up();
    };
    await drag(box.x + box.width * 0.6, box.x + box.width * 0.52); // 8%: bật về
    await expect(current(page)).toHaveAttribute('aria-label', '1 of 3');
    await expect.poll(() => trackX(page)).toBeCloseTo(0, 0);
    await expect(page.getByRole('dialog')).toHaveCount(0); // kéo không bị hiểu là bấm mở lightbox
    await drag(box.x + box.width * 0.8, box.x + box.width * 0.3);
    await expect(current(page)).toHaveAttribute('aria-label', '2 of 3');
  });

  test('clicking the photo opens a lightbox that shares the position, keys work, Esc returns focus', async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto(PDP);
    await page.getByRole('button', { name: 'Next photo' }).click();
    const open = page.getByRole('button', { name: 'Open photo 2 of 3 full screen' });
    await open.click();
    const box = page.getByRole('dialog', { name: /photos, full screen/ });
    await expect(box).toBeVisible();
    await expect(box.getByTestId('lightbox-counter')).toHaveText('2 / 3');
    await expect(current(page, 'lightbox-viewport')).toHaveAttribute('aria-label', '2 of 3');
    // Ảnh lớn phủ gần cả màn hình, không bị cắt (object-contain).
    const img = (await current(page, 'lightbox-viewport').locator('img').boundingBox())!;
    expect(img.height).toBeGreaterThan(900 * 0.7);
    expect(await current(page, 'lightbox-viewport').locator('img').evaluate((i) => getComputedStyle(i).objectFit)).toBe('contain');

    await page.keyboard.press('ArrowRight');
    await expect(box.getByTestId('lightbox-counter')).toHaveText('3 / 3');
    await box.getByRole('button', { name: 'Previous photo' }).click();
    await expect(box.getByTestId('lightbox-counter')).toHaveText('2 / 3');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Escape');
    await expect(box).toBeHidden();
    await expect(current(page)).toHaveAttribute('aria-label', '3 of 3'); // gallery theo ảnh đã xem trong lightbox
    await expect(page.getByRole('button', { name: 'Open photo 3 of 3 full screen' })).toBeFocused();

    await page.getByRole('button', { name: 'Open photo 3 of 3 full screen' }).click();
    await box.getByRole('button', { name: 'Close full screen photos' }).click();
    await expect(box).toBeHidden();
    expect(errors).toEqual([]);
  });

  test('prefers-reduced-motion: the track moves without a transition', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(PDP);
    const track = page.getByTestId('gallery-viewport').getByTestId('gallery-track');
    expect(await track.evaluate((el) => getComputedStyle(el).transitionProperty)).toBe('none');
    const w = (await page.getByTestId('gallery-viewport').boundingBox())!.width;
    const x = await track.evaluate(async (el) => {
      (document.querySelector('button[aria-label="Next photo"]') as HTMLButtonElement).click();
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      return new DOMMatrix(getComputedStyle(el).transform).m41;
    });
    expect(x).toBeCloseTo(-w, 0);
  });
});

test.describe('PDP slider, mobile 375px', () => {
  test.use({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });

  test('finger swipe follows and snaps; short swipe springs back; dots track; no horizontal scroll; no console errors', async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto(PDP);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
    await expect(page.getByTestId('gallery-dots')).toBeVisible();
    await expect(page.getByRole('list', { name: 'Choose a photo' })).toBeHidden();
    const dot = (i: number) => page.getByTestId('gallery-dots').locator('span').nth(i);

    const box = (await page.getByTestId('gallery-viewport').boundingBox())!;
    const y = box.y + box.height * 0.3; // trên nút ‹ ›
    // Ngón tay đang kéo: track đi theo (chưa thả).
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 300, y }] });
    for (const x of [290, 270, 240, 220]) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] });
    await expect.poll(() => trackX(page)).toBeCloseTo(-80, 0);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.detach();
    await expect(current(page)).toHaveAttribute('aria-label', '2 of 3'); // 80px > 20% bề rộng → sang ảnh
    await expect(dot(1)).toHaveClass(/w-5/);
    await expect.poll(() => trackX(page)).toBeCloseTo(-box.width, 0);

    await swipe(page, 200, 170, y, 6, 60); // 30px chậm: bật về
    await expect(current(page)).toHaveAttribute('aria-label', '2 of 3');
    await expect.poll(() => trackX(page)).toBeCloseTo(-box.width, 0);

    await swipe(page, 150, 110, y, 3, 8); // 40px nhưng nhanh (flick): sang ảnh nhờ quán tính
    await expect(current(page)).toHaveAttribute('aria-label', '3 of 3');
    await swipe(page, 300, 60, y); // quá ảnh cuối: rubber band rồi đứng yên
    await expect(current(page)).toHaveAttribute('aria-label', '3 of 3');
    await swipe(page, 60, 320, y);
    await expect(current(page)).toHaveAttribute('aria-label', '2 of 3');
    await expect(dot(1)).toHaveClass(/w-5/);

    await page.getByRole('button', { name: 'Previous photo' }).click();
    await expect(dot(0)).toHaveClass(/w-5/);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
    expect(errors).toEqual([]);
  });

  test('a vertical swipe on the photo scrolls the page instead of changing photo', async ({ page }) => {
    await page.goto(PDP);
    const box = (await page.getByTestId('gallery-viewport').boundingBox())!;
    const cdp = await page.context().newCDPSession(page);
    const x = box.x + box.width / 2, y0 = box.y + box.height * 0.8;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: y0 }] });
    for (let i = 1; i <= 8; i++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + i, y: y0 - i * 30 }] });
      await page.waitForTimeout(16);
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.detach();
    await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(50);
    await expect(current(page)).toHaveAttribute('aria-label', '1 of 3');
  });

  test('lightbox on mobile: swipe inside it, fits the screen, no horizontal scroll', async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto(PDP);
    await page.getByRole('button', { name: 'Open photo 1 of 3 full screen' }).click();
    const box = page.getByRole('dialog', { name: /photos, full screen/ });
    await expect(box).toBeVisible();
    const vp = (await page.getByTestId('lightbox-viewport').boundingBox())!;
    expect(vp.width).toBeLessThanOrEqual(375);
    await swipe(page, 320, 60, vp.y + vp.height * 0.3);
    await expect(box.getByTestId('lightbox-counter')).toHaveText('2 / 3');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
    await box.getByRole('button', { name: 'Close full screen photos' }).click();
    await expect(current(page)).toHaveAttribute('aria-label', '2 of 3');
    expect(errors).toEqual([]);
  });
});
