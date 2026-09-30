// Đọc catalog — dùng chung cho storefront, cart, admin. Ghi catalog chỉ ở module admin.
import { db } from './db';

export type Variant = { id: number; product_id: number; sku: string; size: string; price_cents: number; compare_at_cents: number | null; print_px: number; position: number };
export type ProductImage = { id: number; url: string; alt: string; kind: 'gallery' | 'mockup_scene'; position: number };
export type Product = {
  id: number; handle: string; title: string; subtitle: string | null; description_html: string;
  meta_title: string | null; meta_description: string | null; frame_included: 0 | 1; status: string;
  variants: Variant[]; images: ProductImage[];
};
export type Addon = { id: number; handle: string; title: string; description: string | null; kind: string; price_cents: number; text_input: 0 | 1; text_free: 0 | 1; active: 0 | 1 };
export type BundleTier = { min_qty: number; percent_off: number };

export function getProduct(handle: string): Product | null {
  const d = db();
  const p = d.prepare("SELECT * FROM products WHERE handle = ? AND status = 'active'").get(handle) as Omit<Product, 'variants' | 'images'> | undefined;
  if (!p) return null;
  return {
    ...p,
    variants: d.prepare('SELECT * FROM variants WHERE product_id = ? ORDER BY position').all(p.id) as Variant[],
    images: d.prepare('SELECT * FROM product_images WHERE product_id = ? ORDER BY position').all(p.id) as ProductImage[],
  };
}
export const listProducts = () => db().prepare("SELECT handle, title FROM products WHERE status = 'active' ORDER BY id").all() as { handle: string; title: string }[];
export const getVariant = (id: number) => db().prepare('SELECT * FROM variants WHERE id = ?').get(id) as Variant | undefined;

/** Add-on khung bị ẩn khi sản phẩm đã kèm khung (#3: không bán thứ mô tả nói là có sẵn). */
export function addonsFor(product: Pick<Product, 'frame_included'>): Addon[] {
  const all = db().prepare('SELECT * FROM addons WHERE active = 1 ORDER BY position').all() as Addon[];
  return product.frame_included ? all.filter((a) => a.kind !== 'frame') : all;
}
export const bundleTiers = () => db().prepare('SELECT min_qty, percent_off FROM bundle_tiers ORDER BY min_qty').all() as BundleTier[];
