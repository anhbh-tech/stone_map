// e2e sản phẩm theme từ rollout pearl_compare: nạp FIXTURE manifest (ô màu trơn tạo ở thư mục tạm, không phải ảnh sản phẩm)
// vào DB e2e qua đúng loader của seed, rồi kiểm tra collection, PDP gallery 7 ảnh và search. afterAll trả về trạng thái seed.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import sharp from 'sharp';
import { expect, test } from '@playwright/test';
import { E2E_DB_PATH } from '../../playwright.config';
import { loadRollout, seedThemes, THEMES } from '../../scripts/seed-themes';

// Tạo trong beforeAll (không ở top-level: Playwright nạp file spec cả ở process chính lẫn worker).
let SRC = '';
let DEST = '';

const withDb = async <T>(fn: (d: DatabaseSync) => T | Promise<T>) => { const d = new DatabaseSync(E2E_DB_PATH); try { return await fn(d); } finally { d.close(); } };

test.beforeAll(async () => {
  SRC = fs.mkdtempSync(path.join(os.tmpdir(), 'pearl-rollout-e2e-'));
  fs.mkdirSync(path.join('public', 'rollout'), { recursive: true });
  DEST = fs.mkdtempSync(path.join('public', 'rollout', 'e2e-'));
  for (const [n, t] of THEMES.entries()) {
    const dir = path.join(SRC, t.theme);
    fs.mkdirSync(dir);
    const kinds = ['cat', 'dog', 'dog', 'cat', 'dog'] as const;
    const finals = kinds.map((k, i) => ({ file: `f${i}.jpg`, pet_source: `/abs/pet-${i}.jpg`, pet_kind: k, cutout: `f${i}.cut.png`, pass: true, cost_usd: 0.3 }));
    const files = ['template.png', ...finals.flatMap((f) => [f.file, f.cutout])];
    await Promise.all(files.map((f, i) => sharp({ create: { width: 320, height: 320, channels: 3, background: { r: 40 + n * 60, g: 30 + i * 18, b: 90 } } })
      .toFormat(f.endsWith('.jpg') ? 'jpeg' : 'png').toFile(path.join(dir, f))));
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ theme: t.theme, product_name_hint: null, template_empty: 'template.png', finals, cost_usd_total: 1.5 }));
  }
  const r = await withDb((d) => loadRollout(d, { src: SRC, dest: DEST, urlBase: `/rollout/${path.basename(DEST)}` }));
  expect(r.map((x) => x.status)).toEqual(['loaded', 'loaded', 'loaded']);
});

test.afterAll(async () => {
  await withDb(async (d) => { seedThemes(d); await loadRollout(d); });
  if (SRC) fs.rmSync(SRC, { recursive: true, force: true });
  if (DEST) fs.rmSync(DEST, { recursive: true, force: true });
});

test('Character portraits collection lists the three theme products', async ({ page }) => {
  await page.goto('/collections/character-portraits');
  await expect(page.getByRole('heading', { level: 1, name: 'Character portraits' })).toBeVisible();
  for (const name of ['The Starry King', 'The Sunflower Queen', 'The Café Terrace Duke']) await expect(page.getByRole('link', { name }).first()).toBeVisible();
});

test('product page gallery: 5 finals, the empty template, then the pearl cat on its own', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/products/the-starry-king');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('The Starry King');
  const thumbs = page.getByRole('list', { name: 'Choose a photo' }).getByRole('button');
  await expect(thumbs).toHaveCount(7);

  const slides = page.getByTestId('gallery-track').first().locator('img');
  await expect(slides).toHaveCount(7);
  const alts = await slides.evaluateAll((els) => els.map((e) => e.getAttribute('alt')));
  expect(alts[0]).toBe('Cat recreated in pearls as The Starry King, swirling starry-night sky');
  expect(alts[5]).toBe('The Starry King setting on its own, before your pet is added');
  expect(alts[6]).toBe('Pearl cat from The Starry King on its own, full face and outfit');
  // Ảnh chép vào public/ thật sự tải được (qua next/image).
  await expect.poll(() => slides.first().evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth)).toBeGreaterThan(0);

  await thumbs.nth(6).click();
  await expect(thumbs.nth(6)).toHaveAttribute('aria-current', 'true');
});

test('search finds a theme product by its character name', async ({ page }) => {
  await page.goto('/search?q=sunflower%20queen');
  await expect(page.getByRole('link', { name: 'The Sunflower Queen' }).first()).toBeVisible();
});
