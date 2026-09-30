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
const dogs = (n: number, pass = true, tag = pass ? 'dog' : 'nodog'): F[] => Array.from({ length: n }, (_, i) => ({ file: `${tag}-${i}.jpg`, pet_kind: 'dog', pass, cutout: `${tag}-${i}.cut.png` }));
const load = () => T.loadRollout(d, { src: SRC, dest: DEST, urlBase: '/rollout-test' });
const status = (h: string) => (d.prepare('SELECT status FROM products WHERE handle = ?').get(h) as { status: string }).status;
const images = (h: string) => d.prepare('SELECT i.url, i.alt FROM product_images i JOIN products p ON p.id = i.product_id WHERE p.handle = ? ORDER BY i.position').all(h) as { url: string; alt: string }[];

describe('planGallery', () => {
  const m = (finals: F[]) => T.manifestSchema.parse({ theme: 'x', template_empty: 't.png', finals });

  it('takes up to 5 passing finals, swaps in a passing cat when the first five are dogs, and cuts out the cat', () => {
    const p = T.planGallery(m([...dogs(5), { file: 'fail.jpg', pet_kind: 'cat', pass: false, cutout: 'f.png' }, { file: 'cat.jpg', pet_kind: 'cat', pass: true, cutout: 'cat.cut.png' }]));
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.finals.map((f) => f.file)).toEqual(['dog-0.jpg', 'dog-1.jpg', 'dog-2.jpg', 'dog-3.jpg', 'cat.jpg']);
    expect(p.cutout).toEqual({ file: 'cat.cut.png', pet_kind: 'cat' });
    expect(p.kinds).toEqual(['cat', 'dog']);
    expect(p.skipped).toEqual(['fail.jpg']);
    expect(p.warnings).toEqual([]);
  });

  it('never loads a pass=false final, and leaves its slot empty', () => {
    // Như manifest royal-starry thật: 2 final đạt (mèo, chó) và 3 final pass=false.
    const p = T.planGallery(m([
      { file: 'a.jpg', pet_kind: 'dog', pass: false, cutout: 'a.png' }, { file: 'cat.jpg', pet_kind: 'cat', pass: true, cutout: 'cat.png' },
      { file: 'b.jpg', pet_kind: 'dog', pass: false, cutout: 'b.png' }, { file: 'c.jpg', pet_kind: 'dog', pass: false, cutout: 'c.png' },
      { file: 'dog.jpg', pet_kind: 'dog', pass: true, cutout: 'dog.png' },
    ]));
    expect(p).toMatchObject({ ok: true, cutout: { file: 'cat.png', pet_kind: 'cat' }, skipped: ['a.jpg', 'b.jpg', 'c.jpg'], warnings: ['2 of 5 finals (only pass=true loaded)'] });
    expect(p.ok && p.finals.map((f) => f.file)).toEqual(['cat.jpg', 'dog.jpg']);
    // Mèo duy nhất pass=false: không lấy, cả cutout của nó.
    const q = T.planGallery(m([...dogs(2), { file: 'cat.jpg', pet_kind: 'cat', pass: false, cutout: 'cat.png' }]));
    expect(q).toMatchObject({ ok: true, cutout: { file: 'dog-0.cut.png', pet_kind: 'dog' }, warnings: ['2 of 5 finals (only pass=true loaded)', 'no passing cat final yet'] });
  });

  it('loads nothing without a passing final; a gallery without a cutout is allowed but flagged', () => {
    expect(T.planGallery(m(dogs(3, false)))).toEqual({ ok: false, errors: ['no passing finals yet'] });
    const p = T.planGallery(m(dogs(5).map((f) => ({ ...f, cutout: null }))));
    expect(p).toMatchObject({ ok: true, cutout: null, warnings: ['no passing cat final yet', 'no pearl pet cutout on a passing final yet'] });
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
  // Như rollout thật: royal-starry 2 đạt / 3 pass=false, sunflower-queen 4 đạt / 2 pass=false, cafe-duke chưa có manifest.
  const royal = (fixed: boolean): F[] => [
    { file: 'r-a.jpg', pet_kind: 'dog', pass: fixed, cutout: 'r-a.cut.png' }, { file: 'r-cat.jpg', pet_kind: 'cat', pass: true, cutout: 'r-cat.cut.png' },
    { file: 'r-b.jpg', pet_kind: 'dog', pass: fixed, cutout: 'r-b.cut.png' }, { file: 'r-c.jpg', pet_kind: 'dog', pass: fixed, cutout: 'r-c.cut.png' },
    { file: 'r-dog.jpg', pet_kind: 'dog', pass: true, cutout: 'r-dog.cut.png' },
  ];
  beforeAll(async () => {
    await fixture('royal-starry', royal(false), { product_name_hint: 'The Starry King' });
    await fixture('sunflower-queen', [...dogs(3), { file: 'cat.jpg', pet_kind: 'cat', pass: true, cutout: 'cat.cut.png' }, ...dogs(2, false)]);
  });

  it('loads only passing finals per theme and leaves themes without a manifest draft', async () => {
    const r = await load();
    expect(r.map((x) => [x.theme, x.status, x.finals, x.images])).toEqual([['royal-starry', 'loaded', 2, 2], ['sunflower-queen', 'loaded', 4, 4], ['cafe-duke', 'missing', 0, 0]]);
    expect(r[0].skipped).toEqual(['r-a.jpg', 'r-b.jpg', 'r-c.jpg']);
    expect(r[2].errors[0]).toMatch(/no manifest at .*cafe-duke\/manifest\.json/);
    expect([status('the-starry-king'), status('the-sunflower-queen'), status('the-cafe-terrace-duke')]).toEqual(['active', 'active', 'draft']);
    expect(T.formatLoad(r).split('\n')[0]).toBe('royal-starry: loaded 2 images (2 finals); left out 3 pass=false: r-a.jpg, r-b.jpg, r-c.jpg — 2 of 5 finals (only pass=true loaded)');
  });

  it('keeps the gallery to slider-scene finals only (no empty template, no lone cutout), copied as WebP', async () => {
    const imgs = images('the-starry-king');
    expect(imgs.map((i) => i.url.replace(/-[0-9a-f]{10}\.webp$/, ''))).toEqual(
      ['final-1', 'final-2'].map((n) => `/rollout-test/royal-starry/${n}`));
    expect(imgs.map((i) => i.alt)).toEqual([
      'Cat recreated in pearls as The Starry King against a swirling starry-night sky, shown in its frame',
      'Dog recreated in pearls as The Starry King against a swirling starry-night sky, shown in its frame',
    ]);
    for (const i of imgs) expect((await sharp(path.join(DEST, i.url.replace('/rollout-test/', ''))).metadata()).format).toBe('webp');
    const tags = (d.prepare("SELECT tag FROM product_tags t JOIN products p ON p.id = t.product_id WHERE p.handle = 'the-starry-king' ORDER BY tag").all() as { tag: string }[]).map((x) => x.tag);
    expect(tags).toEqual(['cat', 'dog', 'style:royal-starry', 'theme:royal', 'theme:starry-night', 'type:canvas']);
    const col = L.getCollection('character-portraits')!;
    expect(L.listProducts({ collectionId: col.id }, { theme: [], type: [], price: null, sort: 'featured', page: 1 }).items.map((p) => p.handle)).toEqual(['the-starry-king', 'the-sunflower-queen']);
    expect(L.suggest('starry king').map((s) => s.handle)).toContain('the-starry-king');
  });

  it('is idempotent and picks up finals that pass after regeneration', async () => {
    const before = images('the-starry-king');
    await load();
    expect(images('the-starry-king')).toEqual(before);
    await fixture('royal-starry', royal(true));
    const [r] = await load();
    expect(r).toMatchObject({ status: 'loaded', finals: 5, images: 5, skipped: [], warnings: [] });
    expect(images('the-starry-king').map((i) => i.url.replace(/-[0-9a-f]{10}\.webp$/, '').split('/').at(-1))).toEqual(
      ['final-1', 'final-2', 'final-3', 'final-4', 'final-5']);
    // Thư mục đích chỉ còn đúng các file của gallery mới.
    expect(fs.readdirSync(path.join(DEST, 'royal-starry')).sort()).toEqual(images('the-starry-king').map((i) => path.basename(i.url)).sort());
  });

  it('never mixes themes: a manifest for another theme is rejected, and a theme with no passing final stays draft', async () => {
    await fixture('cafe-duke', dogs(5), { theme: 'royal-starry' });
    expect((await load())[2]).toMatchObject({ status: 'incomplete', errors: ['manifest theme is royal-starry, expected cafe-duke'] });
    await fixture('cafe-duke', dogs(3, false));
    expect((await load())[2]).toMatchObject({ status: 'incomplete', errors: ['no passing finals yet'] });
    expect([status('the-cafe-terrace-duke'), images('the-cafe-terrace-duke').length]).toEqual(['draft', 0]);
    // Seed lại: về draft, không còn ảnh, tới khi nạp lại.
    T.seedThemes(d);
    expect([status('the-starry-king'), images('the-starry-king').length]).toEqual(['draft', 0]);
  });
});
