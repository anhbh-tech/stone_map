// e2e crew UI-1 — khối mua của PDP: trạng thái chọn/focus đỏ, tiêu đề "Choose Creation Method", số lượng cạnh Add to cart,
// Add to cart không bao giờ disabled (thiếu bước → lỗi đỏ tại chỗ), thẻ ảnh Change/Edit, modal AI Filter.
// Mọi /api/** đều mock — không bao giờ gọi generate thật (tốn tiền); không ghi giỏ thật.
import { expect, test, type Page, type Request } from '@playwright/test';
import path from 'node:path';
import type { DesignView } from '../../src/lib/types';

const PDP = '/products/pearl-pet-portrait';
const FIX = path.resolve(__dirname, '../fixtures');
const RED = 'rgb(198, 42, 47)'; // --accent (light)
const PREVIEW = '/demo/starry-king.webp';

type Call = { method: string; path: string; body: unknown };

const bodyOf = (r: Request) => {
  const ct = r.headers()['content-type'] || '';
  if (ct.includes('application/json')) return r.postDataJSON();
  return r.postDataBuffer()?.toString('latin1') ?? null;
};

/** Mock API personalize + cart. Job đứng ở "running" cho tới khi gọi release(). */
async function mockApi(page: Page) {
  const calls: Call[] = [];
  let done = false;
  let base: DesignView = {
    id: 'DSN-BUY01', mode: 'ai', status: 'draft', style: 'royal-starry', pet_name: null, notes: null,
    upload_url: '/demo/cafe-duke.webp', preview_url: null, mockup_url: null, print_url: null, confirmed: false,
  };
  const json = (status: number, data: unknown) => ({ status, contentType: 'application/json', body: JSON.stringify(data) });
  const job = (over: object) => ({ id: 'job_buy', design_id: base.id, queue_position: 0, error: null, design: null, ...over });

  await page.route('**/api/**', async (route) => {
    const r = route.request();
    const p = new URL(r.url()).pathname;
    calls.push({ method: r.method(), path: p, body: bodyOf(r) });
    if (p === '/api/personalize/uploads') {
      return route.fulfill(json(201, {
        upload_id: `up_${calls.length}`, url: '/demo/cafe-duke.webp',
        preflight: { ok: true, width: 1600, height: 1067, sharpness: 210, pet: { found: true, species: 'dog', confidence: 0.97, box: [0.2, 0.1, 0.8, 0.9] }, issues: [] },
      }));
    }
    if (p === '/api/personalize/designs') {
      const b = bodyOf(r) as { mode: DesignView['mode'] };
      base = { ...base, mode: b.mode, status: 'draft', preview_url: null };
      return route.fulfill(json(201, base));
    }
    const m = p.match(/^\/api\/personalize\/designs\/[^/]+(?:\/(generate|confirm|submit))?$/);
    if (m) {
      if (m[1] === 'generate') { done = false; return route.fulfill(json(202, job({ status: 'queued', stage: 'queued', elapsed_ms: 0, eta_ms: 8000, progress: 0 }))); }
      if (m[1] === 'confirm') return route.fulfill(json(200, (base = { ...base, status: 'confirmed', confirmed: true })));
      if (m[1] === 'submit') return route.fulfill(json(200, (base = { ...base, status: 'in_review' })));
      return route.fulfill(json(200, base));
    }
    if (p === '/api/personalize/jobs/job_buy') {
      if (!done) return route.fulfill(json(200, job({ status: 'running', stage: 'generating', elapsed_ms: 3000, eta_ms: 5000, progress: 0.4 })));
      base = { ...base, status: 'ready', preview_url: PREVIEW };
      return route.fulfill(json(200, job({ status: 'succeeded', stage: null, elapsed_ms: 8000, eta_ms: 0, progress: 1, design: base })));
    }
    return route.fulfill(json(200, { lines: [] })); // /api/cart/lines, /api/cart/addons
  });
  await page.route('**/cart', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Cart</title><h1>Cart</h1>' }));
  return { calls, release: () => { done = true; }, count: (suffix: string) => calls.filter((c) => c.path.endsWith(suffix)).length };
}

// Nút trong khối mua của trang (thanh dính mobile có nút cùng tên, test ở ui1-shell.e2e.ts).
const atc = (page: Page) => page.getByRole('region', { name: 'Add to cart' }).getByRole('button', { name: 'Add to cart', exact: true });
const aiFilter = (page: Page) => page.getByRole('dialog', { name: 'AI Filter' });
const generateBtn = (page: Page) => page.getByRole('button', { name: /Generate with AI|Try again/ });

async function upload(page: Page) {
  await page.getByTestId('consent').check();
  await page.getByTestId('photo-input').setInputFiles(path.join(FIX, 'pet-ok.jpg'));
  await expect(page.getByTestId('media-card')).toBeVisible();
}

/** Upload + gen (mock) tới khi có preview. */
async function toPreview(page: Page, api: Awaited<ReturnType<typeof mockApi>>) {
  await upload(page);
  await generateBtn(page).click();
  await expect(page.getByRole('dialog', { name: 'AI Filter' })).toBeVisible();
  api.release();
  await expect(page.getByRole('dialog', { name: 'AI Filter' })).toBeHidden({ timeout: 10_000 });
}

for (const vp of [{ name: '1440', width: 1440, height: 900, mobile: false }, { name: '375', width: 375, height: 812, mobile: true }]) {
  test.describe(`buy box @${vp.name}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height }, isMobile: vp.mobile, hasTouch: vp.mobile });

    test('(1) size and "Generate with AI" options: red selected state and red keyboard focus', async ({ page }) => {
      await page.goto(PDP);
      const sizes = page.getByTestId('size-option');
      await sizes.first().click();
      await page.keyboard.press('ArrowRight'); // bàn phím → :focus-visible
      await expect(sizes.nth(1).locator('input')).toBeChecked();
      await expect(sizes.nth(1)).toHaveCSS('border-top-color', RED);
      await expect(sizes.nth(1)).toHaveCSS('outline-color', RED);
      await expect(sizes.nth(1)).toHaveCSS('outline-style', 'solid');
      await expect(sizes.first()).not.toHaveCSS('border-top-color', RED);

      const modes = page.getByTestId('mode-option');
      await modes.nth(1).click();
      await page.keyboard.press('ArrowLeft');
      const ai = modes.filter({ hasText: 'Generate with AI' });
      await expect(ai.locator('input')).toBeChecked();
      await expect(ai).toHaveCSS('border-top-color', RED);
      await expect(ai).toHaveCSS('background-color', /rgb/); // accent-soft
      await expect(ai).not.toHaveCSS('background-color', 'rgb(255, 255, 255)');
      await expect(ai).toHaveCSS('outline-color', RED);
      await expect(modes.nth(1)).not.toHaveCSS('border-top-color', RED);

      // Các lựa chọn khác cùng kiểu: bundle + add-on + ô số lượng.
      await page.getByTestId('bundle-option').nth(1).click();
      await expect(page.getByTestId('bundle-option').nth(1)).toHaveCSS('border-top-color', RED);
      await page.getByTestId('qty-select').focus();
      await page.keyboard.press('Tab'); await page.keyboard.press('Shift+Tab');
      await expect(page.getByTestId('qty-select')).toHaveCSS('outline-color', RED);
    });

    test('(2) heading "Choose Creation Method" with a small muted parenthetical', async ({ page }) => {
      await page.goto(PDP);
      const h = page.locator('h2#step-photo');
      await expect(h).toHaveText('Choose Creation Method (If AI fails, upload original photo for designers)');
      const note = h.locator('span');
      const [hs, ns] = await Promise.all([h, note].map((l) => l.evaluate((e) => { const c = getComputedStyle(e); return { size: parseFloat(c.fontSize), color: c.color, weight: c.fontWeight }; })));
      expect(ns.size).toBeLessThan(hs.size);
      expect(ns.color).not.toBe(hs.color);
      expect(Number(ns.weight)).toBeLessThan(Number(hs.weight));
      await expect(page.getByRole('radiogroup', { name: /Choose Creation Method/ })).toHaveCount(0); // fieldset → group
      await expect(page.getByRole('group', { name: /Choose Creation Method/ })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(vp.width);
    });

    test('(3) quantity 1–10 and 10+ next to Add to cart; price follows; qty reaches the cart', async ({ page }) => {
      const api = await mockApi(page);
      await page.goto(PDP);
      const sel = page.getByTestId('qty-select');
      const price = page.getByTestId('price');
      await expect(sel.locator('option')).toHaveText(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '10+']);
      // Cùng hàng với nút Add to cart.
      const a = (await sel.boundingBox())!, b = (await atc(page).boundingBox())!;
      expect(Math.abs(a.y + a.height / 2 - (b.y + b.height / 2))).toBeLessThan(4);
      expect(a.x + a.width).toBeLessThanOrEqual(b.x);

      await sel.selectOption('2'); // 2 × 39.98 − 10% = 71.96
      await expect(price).toContainText('$71.96');
      await expect(price).toContainText('for 2 portraits');
      await expect(page.getByTestId('bundle-option').nth(1).locator('input')).toBeChecked(); // đồng bộ với bundle
      await page.getByTestId('bundle-option').first().click();
      await expect(sel).toHaveValue('1');
      await expect(price).toContainText('$39.98');

      await sel.selectOption('10+');
      const custom = page.getByTestId('qty-custom');
      await expect(custom).toHaveValue('11');
      await expect(custom).toHaveAttribute('min', '11');
      const max = Number(await custom.getAttribute('max'));
      expect(max).toBeGreaterThanOrEqual(11); // = MAX_QTY của cart API
      await expect(price).toContainText('for 11 portraits');
      await custom.fill('5'); await custom.blur();
      await expect(custom).toHaveValue('11'); // kẹp về min
      await custom.fill('9999'); await custom.blur();
      await expect(custom).toHaveValue(String(max)); // kẹp về max
      await sel.selectOption('3');
      await expect(custom).toHaveCount(0);
      await expect(price).toContainText('for 3 portraits');

      await toPreview(page, api);
      await page.getByTestId('pet-confirm').check();
      await atc(page).click();
      await page.waitForURL('**/cart');
      expect(api.calls.find((c) => c.path === '/api/cart/lines')!.body).toMatchObject({ qty: 3, design_id: 'DSN-BUY01' });
    });

    test('(4) Add to cart is never disabled: red required errors, scroll + focus, per requirement', async ({ page }) => {
      const api = await mockApi(page);
      await page.goto(PDP);
      await expect(atc(page)).toBeEnabled();
      await atc(page).scrollIntoViewIfNeeded();
      await atc(page).click();
      const err = page.getByTestId('req-error');
      await expect(err).toHaveText('Generate with AI is required');
      await expect(err).toHaveAttribute('role', 'alert');
      await expect(err).toHaveCSS('color', /rgb\((1[5-9]\d|2\d\d), \d{1,2}, \d{1,2}\)/); // --destructive: đỏ
      await expect(page.getByTestId('consent')).toBeFocused();
      await expect(page.locator('#step-photo')).toBeInViewport();
      // Lỗi nằm ngay dưới nhóm Creation Method, trước ô upload.
      const e = (await err.boundingBox())!, g = (await page.getByTestId('mode-option').last().boundingBox())!;
      expect(e.y).toBeGreaterThan(g.y);
      await expect(page.getByRole('group', { name: /Choose Creation Method/ })).toHaveAttribute('aria-describedby', 'req-photo-error');

      await page.getByTestId('consent').check();
      await atc(page).click();
      await expect(page.getByTestId('photo-input')).toBeFocused();

      await page.getByTestId('photo-input').setInputFiles(path.join(FIX, 'pet-ok.jpg'));
      await expect(err).toHaveCount(0); // đủ ảnh → lỗi ảnh tự tắt
      await atc(page).click();
      await expect(err).toHaveText('Generate with AI is required');
      await expect(page.locator('#generate-btn')).toBeFocused();
      await expect(page.locator('#generate-btn')).toHaveAttribute('aria-describedby', 'req-generate-error');

      await generateBtn(page).click();
      await expect(aiFilter(page)).toBeVisible();
      api.release();
      await expect(page.getByTestId('preview-editor')).toBeVisible({ timeout: 10_000 });
      await atc(page).click();
      await expect(err).toHaveText('Please confirm this is your pet');
      await expect(page.getByTestId('pet-confirm')).toBeFocused();
      expect(api.count('/api/cart/lines')).toBe(0);

      // Designer: thiếu ảnh → thông báo theo mode.
      await page.goto(PDP);
      await page.getByTestId('mode-option').filter({ hasText: 'Designer finish' }).click();
      await page.getByRole('button', { name: /Send to designer/ }).click();
      await expect(err).toHaveText('A photo of your pet is required');
    });

    test('(5) media card: thumbnail + Change (new photo, rerun) + Edit (reopen editor, no regenerate)', async ({ page }) => {
      const api = await mockApi(page);
      await page.goto(PDP);
      await upload(page);
      const card = page.getByTestId('media-card');
      await expect(card.getByRole('img', { name: 'Your uploaded pet photo' })).toBeVisible();
      await expect(card.getByRole('button', { name: 'Change photo' })).toBeVisible();
      await expect(card.getByRole('button', { name: 'Edit portrait' })).toHaveCount(0); // chưa có ảnh AI

      await generateBtn(page).click();
      await expect(aiFilter(page)).toBeVisible();
      api.release();
      await expect(aiFilter(page)).toBeHidden({ timeout: 10_000 });
      await expect(card.getByRole('img', { name: /portrait preview/ })).toHaveAttribute('src', PREVIEW);
      expect(api.count('/generate')).toBe(1);

      // Edit: mở lại editor của ảnh đã gen, không gen lại.
      await card.getByRole('button', { name: 'Edit portrait' }).click();
      const ed = page.getByRole('dialog', { name: 'Edit your portrait' });
      await expect(ed).toBeVisible();
      await ed.getByRole('button', { name: 'Rotate right' }).click();
      await ed.getByRole('button', { name: 'Done' }).click();
      await expect(ed).toBeHidden();
      expect(api.count('/generate')).toBe(1);
      await expect.poll(() => api.calls.some((c) => c.method === 'PATCH' && (c.body as { transform?: { rotate: number } }).transform?.rotate === 90)).toBe(true);

      // Change: chọn ảnh khác → upload lại → gen lại (mock).
      const chooser = page.waitForEvent('filechooser');
      await card.getByRole('button', { name: 'Change photo' }).click();
      await (await chooser).setFiles(path.join(FIX, 'pet-ok.jpg'));
      await expect(page.getByRole('dialog', { name: 'AI Filter' })).toBeVisible();
      expect(api.count('/personalize/uploads')).toBe(2);
      await expect.poll(() => api.count('/generate')).toBe(2);
      api.release();
      await expect(card.getByRole('button', { name: 'Edit portrait' })).toBeVisible({ timeout: 10_000 });
    });

    test('(6) blocking AI Filter modal while generating', async ({ page }) => {
      const api = await mockApi(page);
      await page.goto(PDP);
      await upload(page);
      await generateBtn(page).click();
      const modal = page.getByRole('dialog', { name: 'AI Filter' });
      await expect(modal).toBeVisible();
      await expect(modal).toHaveAttribute('aria-busy', 'true');
      await expect(modal).toContainText(/Applying AI filter\.\.\. \(\d{1,2}%\)/);
      await expect(modal).toContainText('Please wait, this may take a few seconds');
      await expect(modal.getByRole('progressbar', { name: 'Portrait progress' })).toHaveAttribute('aria-valuenow', /\d+/);
      await expect(modal.locator('svg').first()).toBeVisible(); // sparkle
      await expect(modal.getByRole('button', { name: /close|cancel/i })).toHaveCount(0);
      // % chạy tiếp giữa các lần poll (ước lượng), không vượt 97 khi chưa xong.
      const pctOf = async () => Number((await page.getByTestId('ai-filter-pct').textContent())!.match(/\((\d+)%\)/)![1]);
      const p1 = await pctOf();
      await expect.poll(pctOf).toBeGreaterThan(p1);
      expect(await pctOf()).toBeLessThanOrEqual(97);

      // Không đóng được: Esc (kể cả hai lần) vẫn giữ modal; focus nằm trong modal.
      await page.keyboard.press('Escape');
      await page.keyboard.press('Escape');
      await expect(modal).toBeVisible();
      for (let i = 0; i < 6; i++) {
        await page.keyboard.press('Tab');
        expect(await page.evaluate(() => !!document.activeElement?.closest('dialog[data-testid="job-progress"]'))).toBe(true);
      }
      await page.keyboard.press('Shift+Tab');
      expect(await page.evaluate(() => !!document.activeElement?.closest('dialog[data-testid="job-progress"]'))).toBe(true);
      // Phần trang phía sau bị chặn.
      expect(await page.evaluate(() => document.documentElement.style.overflow)).toBe('hidden');
      expect(await page.evaluate(() => document.querySelector('dialog:modal')?.getAttribute('data-testid'))).toBe('job-progress'); // showModal → phần sau inert
      expect(await atc(page).evaluate((b) => b.matches(':not(dialog *)') && !b.closest('dialog'))).toBe(true);

      api.release();
      await expect(modal).toBeHidden({ timeout: 10_000 });
      await expect(page.getByTestId('preview-editor')).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.style.overflow)).toBe('');
      expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe('BODY');
    });
  });
}
