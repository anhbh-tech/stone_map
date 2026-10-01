// UI-2 seed: collections + sản phẩm DEMO (tag "demo" → nhãn "Demo" trên thẻ, không liệt kê ở production).
// Gọi từ scripts/seed.ts trong cùng transaction. Chạy lại được: upsert theo handle, variant/ảnh demo tạo lại mỗi lần.
// Ảnh dùng lại 3 ảnh mẫu trong public/demo; alt mô tả đúng ảnh, không mô tả sản phẩm demo.
import type { DatabaseSync } from 'node:sqlite';

const IMG = {
  starry: { url: '/demo/starry-king.webp', alt: 'Pug recreated in pearls wearing a royal cape, Starry Night painted background' },
  cafe: { url: '/demo/cafe-duke.webp', alt: 'Shiba Inu pearl portrait in Café Terrace style' },
  sunflower: { url: '/demo/sunflower-queen.webp', alt: 'Pearl pet portrait with a sunflower crown' },
};

export const COLLECTIONS = [
  { handle: 'pet-portraits', title: 'Pet portraits', description: 'Your pet rebuilt in pearls on canvas, from a single photo.' },
  { handle: 'christmas', title: 'Christmas', description: 'Festive portraits and kits to wrap for the holidays.' },
  { handle: 'memorial', title: 'Memorial', description: 'Gentle keepsakes to remember a pet who has passed.' },
  { handle: 'diy-kits', title: 'DIY pearl kits', description: 'Place every pearl yourself: a printed guide of your pet and all the pearls you need.' },
  { handle: 'gifts-under-50', title: 'Gifts under $50', description: 'Small pieces that still carry their face.' },
] as const;
type Handle = (typeof COLLECTIONS)[number]['handle'];

type Demo = {
  handle: string; title: string; subtitle: string; tags: string[]; collections: Handle[];
  sizes: [string, number, number | null][]; images: (keyof typeof IMG)[];
};

const DIY = (price: number): [string, number, number | null][] => [['12×12', price, null], ['16×16', price + 1000, null]];

export const DEMO_PRODUCTS: Demo[] = [
  {
    handle: 'demo-christmas-scarf-portrait', title: 'Christmas Scarf Pet Portrait', subtitle: 'Your pet in a knitted holiday scarf, set in pearls on canvas',
    tags: ['theme:christmas', 'type:canvas', 'dog', 'cat'], collections: ['christmas', 'pet-portraits'],
    sizes: [['8×8', 3998, 5998], ['12×12', 5998, 7998], ['16×16', 8998, null]], images: ['sunflower', 'starry'],
  },
  {
    handle: 'demo-christmas-pearl-kit', title: 'Christmas Pearl Art Kit', subtitle: 'A festive DIY pearl kit made from your pet photo',
    tags: ['theme:christmas', 'type:diy-kit', 'dog', 'cat'], collections: ['christmas', 'diy-kits', 'gifts-under-50'],
    sizes: DIY(3498), images: ['cafe'],
  },
  {
    handle: 'demo-pearl-art-kit', title: 'Pet Pearl Art Kit', subtitle: 'Everything you need to set your pet portrait in pearls at home',
    tags: ['type:diy-kit', 'theme:floral', 'dog', 'cat'], collections: ['diy-kits', 'gifts-under-50'],
    sizes: DIY(2998), images: ['sunflower'],
  },
  {
    handle: 'demo-rainbow-bridge-portrait', title: 'Rainbow Bridge Memorial Portrait', subtitle: 'A soft pearl portrait to remember them by',
    tags: ['theme:memorial', 'type:canvas', 'dog', 'cat'], collections: ['memorial', 'pet-portraits'],
    sizes: [['12×12', 6498, null], ['16×16', 9498, null], ['20×20', 12498, null]], images: ['starry'],
  },
  {
    handle: 'demo-memorial-ornament', title: 'Memorial Pearl Ornament', subtitle: 'A small round pearl keepsake with their name',
    tags: ['theme:memorial', 'type:ornament'], collections: ['memorial', 'gifts-under-50', 'christmas'],
    sizes: [['4 in round', 2498, null]], images: ['cafe'],
  },
  {
    // Handle giữ nguyên (link/đơn cũ); tên không nói "cat" vì ảnh demo duy nhất có là chó — tên phải khớp ảnh.
    handle: 'demo-royal-cat-portrait', title: 'Royal Robe Pet Portrait', subtitle: 'Your pet crowned and caped, rendered in pearls',
    tags: ['theme:royal', 'type:canvas', 'dog', 'cat'], collections: ['pet-portraits'],
    sizes: [['8×8', 3998, null], ['12×12', 5998, null], ['16×16', 8998, null], ['20×20', 11998, null]], images: ['starry', 'sunflower'],
  },
  {
    handle: 'demo-starry-night-portrait', title: 'Starry Night Pet Portrait', subtitle: 'Swirling night sky behind your pet, in pearls',
    tags: ['theme:starry-night', 'type:canvas', 'dog'], collections: ['pet-portraits'],
    sizes: [['12×12', 5998, null], ['16×16', 8998, null]], images: ['starry'],
  },
  {
    handle: 'demo-birthday-portrait', title: 'Birthday Party Pet Portrait', subtitle: 'Party hat, confetti and your pet, set in pearls',
    tags: ['theme:birthday', 'type:canvas', 'dog', 'cat'], collections: ['pet-portraits'],
    sizes: [['8×8', 3998, null], ['12×12', 5998, null]], images: ['cafe', 'sunflower'],
  },
  {
    handle: 'demo-memorial-pearl-kit', title: 'Memorial Pearl Art Kit', subtitle: 'Set their portrait pearl by pearl, a quiet way to remember',
    tags: ['theme:memorial', 'type:diy-kit'], collections: ['memorial', 'diy-kits', 'gifts-under-50'],
    sizes: DIY(3298), images: ['sunflower'],
  },
  {
    handle: 'demo-floral-crown-portrait', title: 'Floral Crown Pet Portrait', subtitle: 'A crown of sunflowers for your favourite face',
    tags: ['theme:floral', 'type:canvas', 'dog', 'cat'], collections: ['pet-portraits'],
    sizes: [['8×8', 3998, null], ['12×12', 5998, null], ['16×16', 8998, null]], images: ['sunflower'],
  },
  {
    handle: 'demo-christmas-ornament', title: 'Christmas Pearl Ornament', subtitle: 'Hang their face on the tree this year',
    tags: ['theme:christmas', 'type:ornament'], collections: ['christmas', 'gifts-under-50'],
    sizes: [['4 in round', 2298, 2998]], images: ['starry'],
  },
];

const DEMO_NOTE = '<p><strong>Demo listing.</strong> This product is sample data for the development store and is not for sale.</p>';

export function seedCollections(d: DatabaseSync) {
  // Sản phẩm thật (không demo) giữ tag/collection của chính nó; ở đây chỉ gắn sản phẩm chính.
  const col = d.prepare(`INSERT INTO collections (handle, title, description, sort) VALUES (?, ?, ?, ?)
    ON CONFLICT(handle) DO UPDATE SET title = excluded.title, description = excluded.description, sort = excluded.sort RETURNING id`);
  const ids = Object.fromEntries(COLLECTIONS.map((c, i) => [c.handle, (col.get(c.handle, c.title, c.description, i) as { id: number }).id])) as Record<Handle, number>;

  const link = d.prepare('INSERT INTO product_collections (product_id, collection_id, position) VALUES (?, ?, ?) ON CONFLICT DO UPDATE SET position = excluded.position');
  const tag = d.prepare('INSERT OR IGNORE INTO product_tags (product_id, tag) VALUES (?, ?)');
  const pos: Record<string, number> = {};
  const next = (h: Handle) => (pos[h] = (pos[h] ?? -1) + 1);

  const main = d.prepare("SELECT id FROM products WHERE handle = 'pearl-pet-portrait'").get() as { id: number } | undefined;
  if (main) {
    for (const t of ['type:canvas', 'theme:royal', 'theme:starry-night', 'theme:floral', 'dog', 'cat']) tag.run(main.id, t);
    link.run(main.id, ids['pet-portraits'], next('pet-portraits'));
  }

  const up = d.prepare(`INSERT INTO products (handle, title, subtitle, description_html, meta_description, frame_included)
    VALUES (?, ?, ?, ?, ?, 0) ON CONFLICT(handle) DO UPDATE SET title = excluded.title, subtitle = excluded.subtitle,
    description_html = excluded.description_html, meta_description = excluded.meta_description RETURNING id`);
  const v = d.prepare('INSERT INTO variants (product_id, sku, size, price_cents, compare_at_cents, print_px, position) VALUES (?, ?, ?, ?, ?, ?, ?)');
  const img = d.prepare("INSERT INTO product_images (product_id, url, alt, kind, position) VALUES (?, ?, ?, 'gallery', ?)");
  DEMO_PRODUCTS.forEach((p, n) => {
    const { id } = up.get(p.handle, p.title, `${p.subtitle} (demo)`, `${DEMO_NOTE}<p>${p.subtitle}.</p>`, `Demo listing: ${p.subtitle}.`) as { id: number };
    // Ngày tạo lệch nhau để sort "Newest" có thứ tự ổn định.
    d.prepare("UPDATE products SET created_at = datetime('now', ?) WHERE id = ?").run(`-${DEMO_PRODUCTS.length - n} hours`, id);
    d.prepare('DELETE FROM variants WHERE product_id = ?').run(id);
    d.prepare('DELETE FROM product_images WHERE product_id = ?').run(id);
    d.prepare('DELETE FROM product_tags WHERE product_id = ?').run(id);
    d.prepare('DELETE FROM product_collections WHERE product_id = ?').run(id);
    p.sizes.forEach(([size, price, cmp], i) => v.run(id, `DEMO-${n + 1}-${i + 1}`, size, price, cmp, 3000, i));
    p.images.forEach((k, i) => img.run(id, IMG[k].url, IMG[k].alt, i));
    for (const t of ['demo', ...p.tags]) tag.run(id, t);
    for (const h of p.collections) link.run(id, ids[h], next(h));
  });
}
