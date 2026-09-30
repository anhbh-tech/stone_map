// Sản phẩm theme từ rollout pearl_compare: seed draft, chọn ảnh theo manifest, chép ảnh, bật active.
// Manifest + ảnh ở đây là FIXTURE tạo trong thư mục tạm (ô màu trơn), không phải ảnh sản phẩm.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pearl-themes-'));
process.env.DB_PATH = path.join(dir, 'store.db');
const { db } = await import('./db');
const { seedCollections } = await import('../../scripts/seed-collections');
const T = await import('../../scripts/seed-themes');
const L = await import('./listing');
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

const d = db();
seedCollections(d);
T.seedThemes(d);

const SRC = path.join(dir, 'rollout');
const DEST = path.join(dir, 'public');
const png = (file: string, r: number) =>
  sharp({ create: { width: 48, height: 48, channels: 4, background: { r, g: 120, b: 90, alpha: 1 } } }).png().toFile(file);

type F = { file: string; pet_kind: 'cat' | 'dog'; pass: boolean; cutout?: string | null };
async function fixture(theme: string, finals: F[], extra: Record<string, unknown> = {}) {
  const t = path.join(SRC, theme);
  fs.mkdirSync(t, { recursive: true });
  const files = ['template.png', ...finals.flatMap((f) => [f.file, f.cutout].filter(Boolean) as string[])];
  await Promise.all(files.map((f, i) => png(path.join(t, f), 20 + i * 10)));
  const manifest = { theme, product_name_hint: null, template_empty: 'template.png', cost_usd_total: 0, ...extra,
    finals: finals.map((f) => ({ pet_source: `/abs/${f.file}`, cost_usd: 0.3, ...f })) };
  fs.writeFileSync(path.join(t, 'manifest.json'), JSON.stringify(manifest));
}
const dogs = (n: number, pass = true): F[] => Array.from({ length: n }, (_, i) => ({ file: `dog-${i}.jpg`, pet_kind: 'dog', pass, cutout: `dog-${i}.cut.png` }));
const load = () => T.loadRollout(d, { src: SRC, dest: DEST, urlBase: '/rollout-test' });
const status = (h: string) => (d.prepare('SELECT status FROM products WHERE handle = ?').get(h) as { status: string }).status;
const images = (h: string) => d.prepare('SELECT i.url, i.alt FROM product_images i JOIN products p ON p.id = i.product_id WHERE p.handle = ? ORDER BY i.position').all(h) as { url: string; alt: string }[];

describe('planGallery', () => {
  const m = (finals: F[]) => T.manifestSchema.parse({ theme: 'x', template_empty: 't.png', finals });

  it('takes 5 passing finals, swaps in a cat when the first five are dogs, and cuts out the cat', () => {
    const p = T.planGallery(m([...dogs(5), { file: 'fail.jpg', pet_kind: 'cat', pass: false, cutout: 'f.png' }, { file: 'cat.jpg', pet_kind: 'cat', pass: true, cutout: 'cat.cut.png' }]));
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.finals.map((f) => f.file)).toEqual(['dog-0.jpg', 'dog-1.jpg', 'dog-2.jpg', 'dog-3.jpg', 'cat.jpg']);
    expect(p.cutout).toEqual({ file: 'cat.cut.png', pet_kind: 'cat' });
    expect(p.kinds).toEqual(['cat', 'dog']);
  });

  it('falls back to a dog cutout only when no cat has one', () => {
    const p = T.planGallery(m([{ file: 'cat.jpg', pet_kind: 'cat', pass: true, cutout: null }, ...dogs(4)]));
    expect(p.ok && p.cutout).toEqual({ file: 'dog-0.cut.png', pet_kind: 'dog' });
  });

  it('refuses a gallery without 5 passing finals, a cat, or a cutout', () => {
    expect(T.planGallery(m([...dogs(4), ...dogs(3, false)]))).toEqual({ ok: false, errors: ['needs 5 passing finals, has 4', 'needs at least one passing cat final'] });
    expect(T.planGallery(m(dogs(5).map((f) => ({ ...f, pet_kind: 'cat' as const, cutout: null }))))).toEqual({ ok: false, errors: ['needs a pearl pet cutout on a passing final'] });
  });

  it('only accepts paths inside the theme folder', () => {
    expect(T.manifestSchema.safeParse({ theme: 'x', template_empty: '../secret.png', finals: [] }).success).toBe(false);
    expect(T.manifestSchema.safeParse({ theme: 'x', template_empty: '/etc/t.png', finals: [] }).success).toBe(false);
  });
});

describe('seedThemes', () => {
  it('creates one draft product per theme with sizes, tags and collections, hidden from the store', () => {
    const rows = d.prepare(`SELECT p.handle, p.title, p.status, (SELECT count(*) FROM variants v WHERE v.product_id = p.id) AS sizes
      FROM products p WHERE handle IN (${T.THEMES.map(() => '?').join(',')}) ORDER BY p.id`).all(...T.THEMES.map((t) => t.handle));
    expect(rows).toEqual([
      { handle: 'the-starry-king', title: 'The Starry King', status: 'draft', sizes: 4 },
      { handle: 'the-sunflower-queen', title: 'The Sunflower Queen', status: 'draft', sizes: 4 },
      { handle: 'the-cafe-terrace-duke', title: 'The Café Terrace Duke', status: 'draft', sizes: 4 },
    ]);
    const col = L.getCollection('character-portraits')!;
    expect(L.listProducts({ collectionId: col.id }, { theme: [], type: [], price: null, sort: 'featured', page: 1 }).total).toBe(0);
  });
});

describe('loadRollout', () => {
  beforeAll(async () => {
    // royal-starry: đủ ảnh, có mèo ở vị trí 6. sunflower-queen: mới 4 final đạt. cafe-duke: chưa có manifest.
    await fixture('royal-starry', [...dogs(5), { file: 'cat.jpg', pet_kind: 'cat', pass: true, cutout: 'cat.cut.png' }], { product_name_hint: 'The Starry King' });
    await fixture('sunflower-queen', [...dogs(3), { file: 'cat.jpg', pet_kind: 'cat', pass: true, cutout: 'cat.cut.png' }, ...dogs(2, false)]);
  });

  it('loads a complete theme and leaves the others draft with a reason', async () => {
    const r = await load();
    expect(r.map((x) => [x.theme, x.status, x.images])).toEqual([['royal-starry', 'loaded', 7], ['sunflower-queen', 'incomplete', 0], ['cafe-duke', 'missing', 0]]);
    expect(r[1].errors).toEqual(['needs 5 passing finals, has 4']);
    expect(r[2].errors[0]).toMatch(/no manifest at .*cafe-duke\/manifest\.json/);
    expect([status('the-starry-king'), status('the-sunflower-queen'), status('the-cafe-terrace-duke')]).toEqual(['active', 'draft', 'draft']);
  });

  it('builds the gallery as 5 finals, the empty template, then the pearl cat cutout, copied as WebP', async () => {
    const imgs = images('the-starry-king');
    expect(imgs.map((i) => i.url.replace(/-[0-9a-f]{10}\.webp$/, ''))).toEqual([
      ...[1, 2, 3, 4, 5].map((n) => `/rollout-test/royal-starry/final-${n}`), '/rollout-test/royal-starry/template', '/rollout-test/royal-starry/pearl-pet',
    ]);
    expect(imgs[4].alt).toBe('Cat recreated in pearls as The Starry King, swirling starry-night sky');
    expect(imgs[5].alt).toBe('The Starry King setting on its own, before your pet is added');
    expect(imgs[6].alt).toBe('Pearl cat from The Starry King on its own, full face and outfit');
    for (const i of imgs) {
      const f = path.join(DEST, i.url.replace('/rollout-test/', ''));
      expect((await sharp(f).metadata()).format).toBe('webp');
    }
    const tags = (d.prepare("SELECT tag FROM product_tags t JOIN products p ON p.id = t.product_id WHERE p.handle = 'the-starry-king' ORDER BY tag").all() as { tag: string }[]).map((x) => x.tag);
    expect(tags).toEqual(['cat', 'dog', 'style:royal-starry', 'theme:royal', 'theme:starry-night', 'type:canvas']);
    const col = L.getCollection('character-portraits')!;
    expect(L.listProducts({ collectionId: col.id }, { theme: [], type: [], price: null, sort: 'featured', page: 1 }).items.map((p) => p.handle)).toEqual(['the-starry-king']);
    expect(L.suggest('starry king').map((s) => s.handle)).toContain('the-starry-king');
  });

  it('rejects a manifest for the wrong theme and is safe to run again', async () => {
    await fixture('cafe-duke', [...dogs(4), { file: 'cat.jpg', pet_kind: 'cat', pass: true, cutout: 'cat.cut.png' }], { theme: 'royal-starry' });
    const again = await load();
    expect(again[0]).toMatchObject({ status: 'loaded', images: 7 });
    expect(again[2]).toMatchObject({ status: 'incomplete', errors: ['manifest theme is royal-starry, expected cafe-duke'] });
    expect(images('the-starry-king')).toHaveLength(7);
    // Seed lại: về draft, không còn ảnh, tới khi nạp lại.
    T.seedThemes(d);
    expect([status('the-starry-king'), images('the-starry-king').length]).toEqual(['draft', 0]);
  });
});
