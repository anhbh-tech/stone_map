// e2e crew C — PDP + personalizer. API personalize (crew B) và cart (crew D) được mock bằng page.route theo hợp đồng mục 4.
import { expect, test, type Page, type Request } from '@playwright/test';
import path from 'node:path';
import type { DesignView } from '../../src/lib/types';

const PDP = '/products/pearl-pet-portrait';
const FIX = path.resolve(__dirname, '../fixtures');

type Calls = { method: string; path: string; body: unknown }[];

function design(over: Partial<DesignView> = {}): DesignView {
  return {
    id: 'DSN-TEST01', mode: 'ai', status: 'draft', style: 'royal-starry', pet_name: null, notes: null,
    upload_url: '/demo/cafe-duke.webp', preview_url: null, mockup_url: null, print_url: null, confirmed: false, ...over,
  };
}

const bodyOf = (r: Request) => {
  const ct = r.headers()['content-type'] || '';
  if (ct.includes('application/json')) return r.postDataJSON();
  return r.postDataBuffer()?.toString('latin1') ?? null;
};

/** Mock toàn bộ API của crew B + D. Trả về danh sách request để test kiểm tra. */
async function mockApi(page: Page) {
  const calls: Calls = [];
  let polls = 0;
  let current = design();
  const json = (status: number, data: unknown) => ({ status, contentType: 'application/json', body: JSON.stringify(data) });

  await page.route('**/api/**', async (route) => {
    const r = route.request();
    const url = new URL(r.url());
    const p = url.pathname;
    const body = bodyOf(r);
    calls.push({ method: r.method(), path: p, body });

    if (p === '/api/personalize/uploads' && r.method() === 'POST') {
      const raw = String(body);
      if (!/name="consent"\r\n\r\n1/.test(raw)) return route.fulfill(json(400, { error: { code: 'consent_required', message: 'Consent required' } }));
      const notPet = raw.includes('filename="not-a-pet.jpg"');
      return route.fulfill(json(201, {
        upload_id: 'up_test', url: '/demo/cafe-duke.webp',
        preflight: notPet
          ? { ok: false, width: 900, height: 900, sharpness: 140, pet: { found: false, species: null, confidence: 0.05, box: null }, issues: [{ code: 'no_pet', message: 'We couldn’t find a pet in this photo.' }] }
          : { ok: true, width: 1600, height: 1067, sharpness: 210, pet: { found: true, species: 'dog', confidence: 0.97, box: [0.2, 0.1, 0.8, 0.9] }, issues: [] },
      }));
    }
    if (p === '/api/personalize/designs' && r.method() === 'POST') {
      const b = body as Record<string, string>;
      current = design({ mode: b.mode as DesignView['mode'], style: b.style ?? null, pet_name: b.pet_name ?? null, notes: b.notes ?? null });
      return route.fulfill(json(201, current));
    }
    const m = p.match(/^\/api\/personalize\/designs\/([^/]+)(?:\/(generate|confirm|submit))?$/);
    if (m) {
      if (!m[2] && r.method() === 'PATCH') return route.fulfill(json(200, current));
      if (m[2] === 'generate') return route.fulfill(json(202, { id: 'job_test', design_id: current.id, status: 'queued', stage: 'queued', queue_position: 1, elapsed_ms: 0, eta_ms: 4200, progress: 0, error: null, design: null }));
      if (m[2] === 'confirm') return route.fulfill(json(200, (current = { ...current, status: 'confirmed', confirmed: true })));
      if (m[2] === 'submit') return route.fulfill(json(200, (current = { ...current, status: 'in_review' })));
    }
    if (p === '/api/personalize/jobs/job_test') {
      polls += 1;
      if (polls < 2) return route.fulfill(json(200, { id: 'job_test', design_id: current.id, status: 'running', stage: 'generating', queue_position: 0, elapsed_ms: 2100, eta_ms: 2100, progress: 0.5, error: null, design: null }));
      current = { ...current, status: 'ready', preview_url: '/demo/starry-king.webp', mockup_url: null };
      return route.fulfill(json(200, { id: 'job_test', design_id: current.id, status: 'succeeded', stage: null, queue_position: null, elapsed_ms: 4300, eta_ms: 0, progress: 1, error: null, design: current }));
    }
    if (p === '/api/cart/lines' && r.method() === 'POST') return route.fulfill(json(200, { lines: [] }));
    if (p === '/api/cart/addons' && r.method() === 'PUT') return route.fulfill(json(200, { lines: [] }));
    return route.fulfill(json(404, { error: { code: 'not_mocked', message: p } }));
  });
  // Trang giỏ thuộc crew D — chỉ cần biết đã điều hướng tới.
  await page.route('**/cart', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Cart</title><h1>Cart</h1>' }));
  return calls;
}

async function uploadPhoto(page: Page, file: string) {
  const input = page.getByTestId('photo-input');
  await expect(input).toBeDisabled(); // chưa tick consent thì không upload được (#10)
  await page.getByTestId('consent').check();
  await expect(page.getByRole('link', { name: 'Privacy policy' })).toHaveAttribute('href', '/policies/privacy');
  await input.setInputFiles(path.join(FIX, file));
}

const generateBtn = (page: Page) => page.getByRole('button', { name: /Generate with AI/ });
const addToCart = (page: Page) => page.getByRole('button', { name: 'Add to cart' });

test.describe('PDP', () => {
  test.beforeEach(({}, info) => test.skip(info.project.name !== 'desktop', 'desktop-only'));

  test('exactly one h1, every image has alt, JSON-LD and meta description', async ({ page }) => {
    await page.goto(PDP);
    await expect(page.locator('h1')).toHaveCount(1);
    await expect(page.locator('img:not([alt])')).toHaveCount(0);
    const ld = JSON.parse((await page.locator('script[type="application/ld+json"]').first().textContent()) || '{}');
    expect(ld['@type']).toBe('Product');
    expect(ld.aggregateRating).toBeUndefined(); // còn review mẫu → không khai aggregateRating
    await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', /pearl-mosaic portrait/);
  });

  test('size buttons show price and difference; ?variant= follows the size (#6)', async ({ page }) => {
    await page.goto(PDP);
    const opts = page.getByTestId('size-option');
    await expect(opts).toHaveCount(4);
    await expect(opts.nth(0)).toContainText('$39.98');
    await expect(opts.nth(0)).toContainText('Base price');
    await expect(opts.nth(1)).toContainText('$59.98');
    await expect(opts.nth(1)).toContainText('+$20.00');
    await expect(opts.nth(3)).toContainText('+$80.00');

    await opts.nth(2).click();
    const id = await opts.nth(2).locator('input').getAttribute('value');
    await expect(page).toHaveURL(new RegExp(`variant=${id}`));
    await expect(page.getByTestId('price')).toContainText('$89.98');

    await page.goto(`${PDP}?variant=${id}`);
    await expect(opts.nth(2).locator('input')).toBeChecked();
    await expect(page.getByTestId('bundle-option').nth(1)).toContainText('Save 10%');
  });

  test('not-a-pet photo is blocked: red error under the upload box, Generate locked (#1)', async ({ page }) => {
    await mockApi(page);
    await page.goto(PDP);
    await uploadPhoto(page, 'not-a-pet.jpg');
    const err = page.getByTestId('preflight-error');
    await expect(err).toBeVisible();
    await expect(err).toContainText('couldn’t find a pet');
    await expect(page.getByTestId('photo-input')).toHaveAttribute('aria-describedby', /upload-error/);
    await expect(generateBtn(page)).toBeDisabled();
    // Gợi ý designer finish
    await err.getByRole('button', { name: /designer/ }).click();
    await expect(page.getByLabel('Notes for the designer (optional)')).toBeVisible();
  });

  test('AI flow: real ETA, options usable while waiting, cannot add to cart before “This is my pet” (#1 #2)', async ({ page }) => {
    const calls = await mockApi(page);
    await page.goto(PDP);
    await uploadPhoto(page, 'pet-ok.jpg');
    await expect(generateBtn(page)).toBeEnabled();
    await expect(addToCart(page)).toBeDisabled();
    await generateBtn(page).click();

    const progress = page.getByTestId('job-progress');
    await expect(progress).toBeVisible();
    await expect(page.getByTestId('eta')).toHaveText(/About \d+ seconds left/);
    await expect(progress).not.toContainText(/few seconds/i);
    // Trong lúc chờ vẫn đổi size + add-on được
    await page.getByTestId('size-option').nth(1).click();
    const sizeId = Number(await page.getByTestId('size-option').nth(1).locator('input').getAttribute('value'));
    await expect(page.getByTestId('price')).toContainText('$59.98');
    await progress.getByLabel(/Email me the link/).fill('me@example.com');
    await progress.getByRole('button', { name: 'Send link' }).click();
    await expect(progress).toContainText("We'll email me@example.com");

    await expect(page.getByTestId('preview-editor')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('img', { name: 'Your original photo' })).toBeVisible();
    await page.getByRole('button', { name: 'Rotate right' }).click();
    await page.getByRole('button', { name: 'On the wall' }).click();
    await expect(page.getByRole('img', { name: /on a wall/ })).toBeVisible();

    // Chưa tick xác nhận → không thêm giỏ được
    await expect(addToCart(page)).toBeDisabled();
    await expect(page.locator('#atc-reason')).toContainText('This is my pet');
    expect(calls.some((c) => c.path === '/api/cart/lines')).toBe(false);

    await page.getByTestId('pet-confirm').check();
    await addToCart(page).click();
    await page.waitForURL('**/cart');
    const confirm = calls.findIndex((c) => c.path.endsWith('/confirm'));
    const line = calls.findIndex((c) => c.path === '/api/cart/lines');
    expect(confirm).toBeGreaterThan(-1);
    expect(line).toBeGreaterThan(confirm);
    expect(calls[line].body).toEqual({ variant_id: sizeId, qty: 1, design_id: 'DSN-TEST01' });
    expect(calls.find((c) => c.method === 'PATCH' && (c.body as { transform?: unknown }).transform)).toBeTruthy();
    expect(calls.find((c) => c.method === 'PATCH' && (c.body as { email?: string }).email === 'me@example.com')).toBeTruthy();
  });

  test('designer finish sends pet name and notes, then adds to cart (#11)', async ({ page }) => {
    const calls = await mockApi(page);
    await page.goto(PDP);
    await page.getByText('Designer finish', { exact: true }).click();
    await uploadPhoto(page, 'pet-ok.jpg');
    await page.getByLabel(/Pet.s name/).fill('Mochi');
    await page.getByLabel('Notes for the designer (optional)').fill('Remove the leash');
    const btn = page.getByRole('button', { name: /Send to designer/ });
    await expect(btn).toBeDisabled();
    await page.getByTestId('pet-confirm').check();
    await btn.click();
    await page.waitForURL('**/cart');
    const created = calls.find((c) => c.path === '/api/personalize/designs')!.body as Record<string, unknown>;
    expect(created).toMatchObject({ mode: 'designer', pet_name: 'Mochi', notes: 'Remove the leash', upload_id: 'up_test' });
    expect(calls.some((c) => c.path.endsWith('/submit'))).toBe(true);
  });

  test('add-ons save to the cart; card message is free (#7)', async ({ page }) => {
    const calls = await mockApi(page);
    await page.goto(PDP);
    await expect(page.getByText('Gold floating frame')).toBeVisible(); // frame_included = 0 → khung hiện
    await page.getByLabel(/Gift card/).check();
    await expect.poll(() => calls.filter((c) => c.path === '/api/cart/addons').length).toBe(1);
    const msg = page.getByLabel(/Card message/);
    await expect(page.getByText('free, no extra charge')).toBeVisible();
    await msg.fill('Happy birthday');
    await msg.blur();
    await expect.poll(() => calls.filter((c) => c.path === '/api/cart/addons').at(-1)?.body).toMatchObject({ on: true, text: 'Happy birthday' });
  });

  test('reviews come from data and samples are labelled (#4)', async ({ page }) => {
    await page.goto(PDP);
    const block = page.locator('#reviews');
    await expect(block.getByRole('heading', { name: 'Customer reviews' })).toBeVisible();
    await expect(block.getByText('Sample review')).toHaveCount(3);
    await expect(block).toContainText('3 reviews');
    await expect(block).not.toContainText(/trustpilot/i);
  });
});

test.describe('PDP against the real personalize API (crew B)', () => {
  test.beforeEach(({}, info) => test.skip(info.project.name !== 'desktop', 'desktop-only'));
  test.setTimeout(90_000);

  test('real preflight blocks not-a-pet; real job, rotate, confirm, then cart line (#1 #2)', async ({ page }) => {
    // Chỉ mock giỏ (crew D); /api/personalize/* và /media/* là thật.
    const lines: unknown[] = [];
    await page.route('**/api/cart/**', (route) => {
      if (route.request().url().endsWith('/api/cart/lines')) lines.push(route.request().postDataJSON());
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{"lines":[]}' });
    });
    await page.route('**/cart', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Cart</title><h1>Cart</h1>' }));
    const apiErrors: string[] = [];
    page.on('response', (r) => { if (r.url().includes('/api/personalize/') && r.status() >= 400) apiErrors.push(`${r.status()} ${r.url()}`); });

    await page.goto(PDP);
    await uploadPhoto(page, 'not-a-pet.jpg');
    await expect(page.getByTestId('preflight-error')).toBeVisible({ timeout: 20_000 });
    await expect(generateBtn(page)).toBeDisabled();

    await page.getByTestId('photo-input').setInputFiles(path.join(FIX, 'pet-ok.jpg'));
    await expect(page.getByTestId('preflight-error')).toHaveCount(0, { timeout: 20_000 });
    await generateBtn(page).click();
    await expect(page.getByTestId('eta')).toHaveText(/About \d+ (seconds|minutes?) left|Almost done/);
    await expect(page.getByTestId('preview-editor')).toBeVisible({ timeout: 60_000 });
    for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'Rotate right' }).click(); // 270° → -90° theo TransformSchema
    await page.getByRole('slider').fill('1.5');
    await page.getByTestId('pet-confirm').check();
    await addToCart(page).click();
    await page.waitForURL('**/cart', { timeout: 20_000 });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ qty: 1, design_id: expect.stringMatching(/^DSN-/) });
    expect(apiErrors).toEqual([]);
  });
});

test.describe('PDP mobile 375px', () => {
  test.beforeEach(({}, info) => test.skip(info.project.name !== 'mobile-375', 'mobile-only'));

  test('preview shrinks to a slim sticky bar when scrolled away, no horizontal scroll (#12)', async ({ page }) => {
    await mockApi(page);
    await page.goto(PDP);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
    await uploadPhoto(page, 'pet-ok.jpg');
    await generateBtn(page).click();
    await expect(page.getByTestId('preview-editor')).toBeVisible({ timeout: 10_000 });
    const bar = page.getByTestId('sticky-preview');
    await expect(bar).toHaveAttribute('data-visible', 'false');
    await page.locator('#step-extras').scrollIntoViewIfNeeded();
    await page.getByRole('button', { name: 'Add to cart' }).scrollIntoViewIfNeeded();
    await expect(bar).toHaveAttribute('data-visible', 'true');
    const box = await bar.boundingBox();
    expect(box!.height).toBeLessThanOrEqual(80);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
    await bar.getByRole('button', { name: 'View' }).click();
    await expect(bar).toHaveAttribute('data-visible', 'false');
  });
});
