// Sản phẩm theo theme từ đợt rollout của pearl_compare: 1 sản phẩm / theme (royal-starry, sunflower-queen, cafe-duke).
// seedThemes(): tạo sản phẩm + size + tag + collection ở trạng thái DRAFT (không có ảnh thì không bán, không hiện).
// loadRollout(): đọc <ROLLOUT_DIR>/<theme>/manifest.json (chỉ đọc), chép ảnh (đổi sang WebP) vào public/rollout/<theme>/,
// ghi gallery = 5 final + 1 template trống + 1 cutout pet ngọc, rồi bật ACTIVE. Thiếu manifest / manifest chưa đủ → giữ nguyên, báo lý do.
// Không bao giờ dùng ảnh giả: fixture manifest chỉ có trong test (tạo ở thư mục tạm).
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';

export const ROLLOUT_DIR = process.env.ROLLOUT_DIR || path.join(os.homedir(), 'pearl_compare', 'outputs', 'rollout');
export const PUBLIC_DIR = path.join(process.cwd(), 'public');
const GALLERY_FINALS = 5;

type ThemeDef = {
  theme: string; handle: string; title: string; style: string; sku: string;
  subtitle: string; lead: string; scene: string; tags: string[];
};

// Tên theo kiểu "nhân vật + chức danh"; câu chữ viết riêng cho Pearl Atelier.
export const THEMES: ThemeDef[] = [
  {
    theme: 'royal-starry', handle: 'the-starry-king', title: 'The Starry King', style: 'Starry King', sku: 'TSK',
    subtitle: 'Your pet as a pearl-set king under a swirling night sky',
    lead: 'Crowned, caped and glowing against a sky of swirling stars: your cat or dog takes the throne, rebuilt in pearls from a single photo.',
    scene: 'swirling starry-night sky', tags: ['theme:royal', 'theme:starry-night'],
  },
  {
    theme: 'sunflower-queen', handle: 'the-sunflower-queen', title: 'The Sunflower Queen', style: 'Sunflower Queen', sku: 'TSQ',
    subtitle: 'Your pet as a pearl-set queen crowned with sunflowers',
    lead: 'A crown of sunflowers and a royal gown for the queen of your house, set in pearls from a single photo of your cat or dog.',
    scene: 'sunflower background', tags: ['theme:royal', 'theme:floral'],
  },
  {
    theme: 'cafe-duke', handle: 'the-cafe-terrace-duke', title: 'The Café Terrace Duke', style: 'Café Terrace Duke', sku: 'TCD',
    subtitle: 'Your pet as a pearl-set duke on a lamplit café terrace',
    lead: 'Dressed as a duke for an evening on a lamplit café terrace, your cat or dog is rebuilt in pearls from a single photo.',
    scene: 'lamplit café terrace at night', tags: ['theme:royal', 'theme:cafe'],
  },
];

export const THEME_COLLECTION = { handle: 'character-portraits', title: 'Character portraits', description: 'Your pet as a king, a queen or a duke, set in pearls.' };

const SIZES: [string, number, number, number][] = [['8×8', 3998, 5998, 2000], ['12×12', 5998, 7998, 3000], ['16×16', 8998, 11998, 4000], ['20×20', 11998, 15998, 5000]];

/** Tạo / cập nhật 3 sản phẩm (DRAFT, chưa có ảnh). Gọi trong transaction của seed, sau seedCollections(). */
export function seedThemes(d: DatabaseSync) {
  const col = d.prepare(`INSERT INTO collections (handle, title, description, sort) VALUES (?, ?, ?, (SELECT coalesce(max(sort), -1) + 1 FROM collections))
    ON CONFLICT(handle) DO UPDATE SET title = excluded.title, description = excluded.description RETURNING id`)
    .get(THEME_COLLECTION.handle, THEME_COLLECTION.title, THEME_COLLECTION.description) as { id: number };
  const pets = d.prepare("SELECT id FROM collections WHERE handle = 'pet-portraits'").get() as { id: number } | undefined;

  const up = d.prepare(`INSERT INTO products (handle, title, subtitle, description_html, meta_title, meta_description, frame_included, status, info_tabs)
    VALUES (?, ?, ?, ?, ?, ?, 0, 'draft', ?) ON CONFLICT(handle) DO UPDATE SET title = excluded.title, subtitle = excluded.subtitle,
    description_html = excluded.description_html, meta_title = excluded.meta_title, meta_description = excluded.meta_description,
    info_tabs = excluded.info_tabs, status = 'draft' RETURNING id`);
  const v = d.prepare('INSERT INTO variants (product_id, sku, size, price_cents, compare_at_cents, print_px, position) VALUES (?, ?, ?, ?, ?, ?, ?)');
  const tag = d.prepare('INSERT OR IGNORE INTO product_tags (product_id, tag) VALUES (?, ?)');
  const link = d.prepare('INSERT INTO product_collections (product_id, collection_id, position) VALUES (?, ?, ?) ON CONFLICT DO UPDATE SET position = excluded.position');

  THEMES.forEach((t, i) => {
    const description = `<p>${t.lead}</p>
<ul><li>Upload a clear photo and approve your preview before we print</li><li>Printed on canvas, ready to hang; frame sold separately</li><li>Not happy with the AI result? Choose “Designer finish” and a designer edits it by hand.</li></ul>`;
    const info = { description: `**${t.title}** starts with a photo of your pet. We dress them in the ${t.style} look, rebuild them as a pearl mosaic and show you the preview **before you pay**.` };
    const { id } = up.get(t.handle, t.title, t.subtitle, description, `${t.title} — Custom Pearl Pet Portrait`,
      `${t.subtitle}. Made from your photo; approve the preview before printing. Sizes 8×8 to 20×20 in.`, JSON.stringify(info)) as { id: number };
    for (const table of ['variants', 'product_images', 'product_tags', 'product_collections']) d.prepare(`DELETE FROM ${table} WHERE product_id = ?`).run(id);
    SIZES.forEach(([size, price, cmp, px], n) => v.run(id, `${t.sku}-${size.replace('×', 'x')}`, size, price, cmp, px, n));
    // style:<id> ghi theme của sản phẩm để Personalizer có thể chọn sẵn style sau này.
    for (const x of ['type:canvas', ...t.tags, `style:${t.theme}`]) tag.run(id, x);
    link.run(id, col.id, i);
    // Đứng đầu Pet portraits (vị trí âm, trước các sản phẩm đã có).
    if (pets) link.run(id, pets.id, i - THEMES.length);
  });
}

const rel = z.string().min(1).refine((p) => !path.isAbsolute(p) && !p.split(/[\\/]/).includes('..'), 'must be a path inside the theme folder');
export const manifestSchema = z.object({
  theme: z.string(),
  product_name_hint: z.string().nullable().optional(),
  template_empty: rel,
  finals: z.array(z.object({
    file: rel,
    pet_source: z.string().optional(),
    pet_kind: z.enum(['cat', 'dog']),
    cutout: rel.nullable().optional(),
    pass: z.boolean(),
    cost_usd: z.number().optional(),
  }).passthrough()),
  cost_usd_total: z.number().optional(),
}).passthrough();
export type Manifest = z.infer<typeof manifestSchema>;
type Final = Manifest['finals'][number];

export type GalleryPlan =
  | { ok: true; finals: Final[]; cutout: { file: string; pet_kind: 'cat' | 'dog' }; template: string; kinds: ('cat' | 'dog')[] }
  | { ok: false; errors: string[] };

/** Chọn ảnh: 5 final đạt (ít nhất 1 mèo), cutout ưu tiên lấy từ final mèo, template trống. */
export function planGallery(m: Manifest): GalleryPlan {
  const passing = m.finals.filter((f) => f.pass);
  const errors: string[] = [];
  if (passing.length < GALLERY_FINALS) errors.push(`needs ${GALLERY_FINALS} passing finals, has ${passing.length}`);
  if (!passing.some((f) => f.pet_kind === 'cat')) errors.push('needs at least one passing cat final');

  let finals = passing.slice(0, GALLERY_FINALS);
  const firstCat = passing.find((f) => f.pet_kind === 'cat');
  if (firstCat && !finals.includes(firstCat)) finals = [...finals.slice(0, GALLERY_FINALS - 1), firstCat];

  const withCutout = (fs: Final[]) => fs.find((f) => f.cutout);
  const src = withCutout(finals.filter((f) => f.pet_kind === 'cat')) ?? withCutout(passing.filter((f) => f.pet_kind === 'cat')) ?? withCutout(finals) ?? withCutout(passing);
  if (!src) errors.push('needs a pearl pet cutout on a passing final');
  if (errors.length) return { ok: false, errors };
  return { ok: true, finals, cutout: { file: src!.cutout!, pet_kind: src!.pet_kind }, template: m.template_empty, kinds: [...new Set(finals.map((f) => f.pet_kind))].sort() };
}

export type LoadResult = { theme: string; handle: string; status: 'loaded' | 'missing' | 'incomplete'; errors: string[]; images: number };

const Kind = (k: 'cat' | 'dog') => (k === 'cat' ? 'Cat' : 'Dog');

/** Nạp ảnh từ manifest của mọi theme. `dest`/`urlBase` đổi được cho test; mặc định public/rollout → /rollout. */
export async function loadRollout(d: DatabaseSync, opts: { src?: string; dest?: string; urlBase?: string } = {}): Promise<LoadResult[]> {
  const src = opts.src ?? ROLLOUT_DIR;
  const urlBase = opts.urlBase ?? '/rollout';
  const dest = opts.dest ?? path.join(PUBLIC_DIR, ...urlBase.split('/').filter(Boolean));
  const out: LoadResult[] = [];
  for (const t of THEMES) {
    const res: LoadResult = { theme: t.theme, handle: t.handle, status: 'missing', errors: [], images: 0 };
    out.push(res);
    const product = d.prepare('SELECT id FROM products WHERE handle = ?').get(t.handle) as { id: number } | undefined;
    const dir = path.join(src, t.theme);
    const file = path.join(dir, 'manifest.json');
    if (!product) { res.errors.push('product not seeded (run npm run seed)'); continue; }
    if (!fs.existsSync(file)) { res.errors.push(`no manifest at ${file}`); continue; }

    res.status = 'incomplete';
    let m: Manifest;
    try {
      const parsed = manifestSchema.safeParse(JSON.parse(fs.readFileSync(file, 'utf8')));
      if (!parsed.success) { res.errors.push(...parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`)); continue; }
      m = parsed.data;
    } catch (e) { res.errors.push(`manifest is not JSON (${(e as Error).message})`); continue; }
    if (m.theme !== t.theme) { res.errors.push(`manifest theme is ${m.theme}, expected ${t.theme}`); continue; }
    const plan = planGallery(m);
    if (!plan.ok) { res.errors.push(...plan.errors); continue; }
    const missing = [...plan.finals.map((f) => f.file), plan.template, plan.cutout.file].filter((f) => !fs.existsSync(path.join(dir, f)));
    if (missing.length) { res.errors.push(...missing.map((f) => `missing file ${f}`)); continue; }

    const sharp = (await import('sharp')).default;
    const outDir = path.join(dest, t.theme);
    fs.mkdirSync(outDir, { recursive: true });
    // Tên file theo nội dung → nạp lại ảnh mới không bị cache cũ.
    const copy = async (from: string, name: string, max: number) => {
      const buf = await sharp(path.join(dir, from)).rotate().resize({ width: max, height: max, fit: 'inside', withoutEnlargement: true }).webp({ quality: 84 }).toBuffer();
      const hash = createHash('sha256').update(buf).digest('hex').slice(0, 10);
      const out = `${name}-${hash}.webp`;
      fs.writeFileSync(path.join(outDir, out), buf);
      return `${urlBase}/${t.theme}/${out}`;
    };
    const title = m.product_name_hint?.trim() || t.title;
    const rows: { url: string; alt: string }[] = [];
    for (const [i, f] of plan.finals.entries()) {
      rows.push({ url: await copy(f.file, `final-${i + 1}`, 2000), alt: `${Kind(f.pet_kind)} recreated in pearls as ${title}, ${t.scene}` });
    }
    rows.push({ url: await copy(plan.template, 'template', 2000), alt: `The ${t.style} setting on its own, before your pet is added` });
    rows.push({ url: await copy(plan.cutout.file, 'pearl-pet', 1600), alt: `Pearl ${plan.cutout.pet_kind} from ${title} on its own, full face and outfit` });

    d.exec('BEGIN');
    try {
      d.prepare('DELETE FROM product_images WHERE product_id = ?').run(product.id);
      const img = d.prepare("INSERT INTO product_images (product_id, url, alt, kind, position) VALUES (?, ?, ?, 'gallery', ?)");
      rows.forEach((r, i) => img.run(product.id, r.url, r.alt, i));
      d.prepare("DELETE FROM product_tags WHERE product_id = ? AND tag IN ('cat', 'dog')").run(product.id);
      for (const k of plan.kinds) d.prepare('INSERT OR IGNORE INTO product_tags (product_id, tag) VALUES (?, ?)').run(product.id, k);
      d.prepare("UPDATE products SET status = 'active', title = ? WHERE id = ?").run(title, product.id);
      d.exec('COMMIT');
    } catch (e) { d.exec('ROLLBACK'); throw e; }
    res.status = 'loaded';
    res.images = rows.length;
  }
  return out;
}

export const formatLoad = (r: LoadResult[]) =>
  r.map((x) => `${x.theme}: ${x.status}${x.images ? ` (${x.images} images)` : ''}${x.errors.length ? ` — ${x.errors.join('; ')}` : ''}`).join('\n');
