// npm run seed — tạo dữ liệu mẫu. Chạy lại được: xoá sạch catalog rồi tạo lại, giữ đơn/thiết kế nếu --keep-orders.
import { db, tx } from '../src/lib/db';
import { DEFAULTS, setSetting } from '../src/lib/settings';
import { hashPassword } from '../src/lib/password';
import type { Settings } from '../src/lib/types';
import { seedCollections } from './seed-collections';

const d = db();
tx(() => {
  for (const k of Object.keys(DEFAULTS) as (keyof Settings)[]) setSetting(k, DEFAULTS[k]);

  // Xoá bảng tham chiếu variants/addons TRƯỚC (khoá ngoại). Giỏ hàng luôn xoá: dòng giỏ trỏ vào variant sắp tạo lại.
  d.exec('DELETE FROM cart_addons; DELETE FROM cart_lines;');
  if (!process.argv.includes('--keep-orders')) d.exec('DELETE FROM order_addons; DELETE FROM order_lines; DELETE FROM orders; DELETE FROM jobs; DELETE FROM designs;');
  d.exec('DELETE FROM bundle_tiers; DELETE FROM addons; DELETE FROM product_images; DELETE FROM variants;');
  if (!process.argv.includes('--keep-orders')) d.exec('DELETE FROM products;');

  const p = d.prepare(`INSERT INTO products (handle, title, subtitle, description_html, meta_title, meta_description, frame_included)
    VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(handle) DO UPDATE SET title=excluded.title RETURNING id`).get(
    'pearl-pet-portrait',
    'Pearl Pet Portrait',
    'Your pet, recreated as a hand-finished pearl mosaic on painted canvas',
    `<p>Upload a clear photo of your pet. Our AI turns it into a pearl-mosaic portrait in the style you choose, and you approve the preview before we print.</p>
<ul><li>Printed on museum-grade canvas, stretched and ready to hang</li><li>Frame sold separately — choose one in the options below</li><li>Not happy with the AI result? Choose “Designer finish” and a designer edits it by hand, free.</li></ul>`,
    'Pearl Pet Portrait — Custom Pearl Mosaic of Your Pet',
    'Turn your pet photo into a pearl-mosaic portrait. Approve the preview before printing. Sizes 8×8 to 20×20 in, ships in the US.',
    0,
  ) as { id: number };

  const v = d.prepare('INSERT INTO variants (product_id, sku, size, price_cents, compare_at_cents, print_px, position) VALUES (?, ?, ?, ?, ?, ?, ?)');
  [['8×8', 3998, 5998, 2000], ['12×12', 5998, 7998, 3000], ['16×16', 8998, 11998, 4000], ['20×20', 11998, 15998, 5000]]
    .forEach(([size, price, cmp, px], i) => v.run(p.id, `PPP-${String(size).replace('×', 'x')}`, size, price, cmp, px, i));

  const img = d.prepare('INSERT INTO product_images (product_id, url, alt, kind, position) VALUES (?, ?, ?, ?, ?)');
  img.run(p.id, '/demo/starry-king.webp', 'Pug recreated in pearls wearing a royal cape, Starry Night painted background', 'gallery', 0);
  img.run(p.id, '/demo/cafe-duke.webp', 'Shiba Inu pearl portrait in Café Terrace style', 'gallery', 1);
  img.run(p.id, '/demo/sunflower-queen.webp', 'Pearl pet portrait with a sunflower crown', 'gallery', 2);

  const a = d.prepare('INSERT INTO addons (handle, title, description, kind, price_cents, text_input, text_free, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  a.run('gold-frame', 'Gold floating frame', 'Matches the portrait, ready to hang', 'frame', 1398, 0, 1, 0);
  a.run('gift-card', 'Gift card', 'Printed card in the box. Your message is free.', 'card', 499, 1, 1, 1);
  a.run('priority', 'Priority production', 'Skips the queue: ships 2 days sooner', 'priority', 999, 0, 1, 2);
  a.run('protection', 'Order protection', 'Free reprint if lost or damaged in transit', 'protection', 299, 0, 1, 3);

  const t = d.prepare('INSERT INTO bundle_tiers (min_qty, percent_off) VALUES (?, ?)');
  [[2, 10], [3, 15], [5, 20]].forEach(([q, o]) => t.run(q, o));

  // Review MẪU cho dev (is_sample = 1): UI hiện nhãn "Sample review", production tự loại.
  d.exec('DELETE FROM reviews WHERE is_sample = 1');
  const r = d.prepare("INSERT INTO reviews (product_id, author, rating, title, body, photo_url, status, is_sample) VALUES (?, ?, ?, ?, ?, ?, 'published', 1)");
  r.run(p.id, 'Sample · Jamie R.', 5, 'Looks just like Mochi', 'The pearl texture is lovely and the preview matched what arrived.', '/demo/cafe-duke.webp');
  r.run(p.id, 'Sample · Priya S.', 4, 'Great gift', 'Took a week longer than I hoped, but my mum loved it.', null);
  r.run(p.id, 'Sample · Tom W.', 5, null, 'Approving the preview first made me confident ordering.', '/demo/starry-king.webp');

  d.prepare('INSERT INTO admin_users (username, password_hash) VALUES (?, ?) ON CONFLICT(username) DO UPDATE SET password_hash = excluded.password_hash')
    .run('admin', hashPassword('admin123'));

  seedCollections(d); // UI-2: collections + sản phẩm demo có nhãn
});
console.log('seeded', d.prepare('SELECT count(*) n FROM variants').get());
