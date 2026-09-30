// Truy vấn đọc cho trang admin và GET /api/admin/*. Ghi nằm ở từng route handler.
import { db, json } from '../../../lib/db';
import type { Addon, BundleTier, ProductImage, Variant } from '../../../lib/catalog';
import type { DesignStatus } from '../../../lib/types';
import { mediaUrl } from './storage';

export type AdminProduct = {
  id: number; handle: string; title: string; subtitle: string | null; description_html: string;
  meta_title: string | null; meta_description: string | null; frame_included: 0 | 1; status: 'draft' | 'active' | 'archived';
  created_at: string; variants: Variant[]; images: ProductImage[];
};

export function listProducts() {
  return db().prepare(`SELECT p.id, p.handle, p.title, p.status, p.frame_included, p.meta_description,
      (SELECT count(*) FROM variants v WHERE v.product_id = p.id) AS variants,
      (SELECT count(*) FROM product_images i WHERE i.product_id = p.id) AS images,
      (SELECT min(price_cents) FROM variants v WHERE v.product_id = p.id) AS from_cents
    FROM products p ORDER BY p.id`).all() as {
    id: number; handle: string; title: string; status: string; frame_included: 0 | 1; meta_description: string | null;
    variants: number; images: number; from_cents: number | null;
  }[];
}

export function getProduct(id: number): AdminProduct | null {
  const d = db();
  const p = d.prepare('SELECT * FROM products WHERE id = ?').get(id) as Omit<AdminProduct, 'variants' | 'images'> | undefined;
  if (!p) return null;
  return {
    ...p,
    variants: d.prepare('SELECT * FROM variants WHERE product_id = ? ORDER BY position, id').all(id) as Variant[],
    images: d.prepare('SELECT * FROM product_images WHERE product_id = ? ORDER BY position, id').all(id) as ProductImage[],
  };
}

export const listAddons = () => db().prepare('SELECT * FROM addons ORDER BY position, id').all() as (Addon & { position: number })[];
export const listTiers = () => db().prepare('SELECT id, min_qty, percent_off FROM bundle_tiers ORDER BY min_qty').all() as (BundleTier & { id: number })[];

// ── Đơn hàng
export type OrderRow = {
  id: number; number: string; email: string; name: string; shipping_method: string; total_cents: number;
  status: string; created_at: string; lines: number; designs_pending: number;
};
export function listOrders(status?: string, limit = 100): OrderRow[] {
  return db().prepare(`SELECT o.id, o.number, o.email, o.name, o.shipping_method, o.total_cents, o.status, o.created_at,
      (SELECT coalesce(sum(qty), 0) FROM order_lines l WHERE l.order_id = o.id) AS lines,
      (SELECT count(*) FROM order_lines l JOIN designs g ON g.id = l.design_id WHERE l.order_id = o.id AND g.status = 'in_review') AS designs_pending
    FROM orders o ${status ? 'WHERE o.status = ?' : ''} ORDER BY o.created_at DESC, o.id DESC LIMIT ?`)
    .all(...(status ? [status, limit] : [limit])) as OrderRow[];
}

export type OrderLine = {
  id: number; product_title: string; variant_size: string; sku: string; qty: number; unit_cents: number;
  design_id: string | null; properties: Record<string, string>;
  design: { id: string; mode: string; status: DesignStatus; pet_name: string | null; preview_url: string | null; upload_url: string | null; has_print: boolean } | null;
};
export type OrderDetail = {
  id: number; number: string; email: string; name: string; address: Record<string, string>; shipping_method: string;
  subtotal_cents: number; discount_cents: number; addons_cents: number; shipping_cents: number; total_cents: number;
  status: string; created_at: string; lines: OrderLine[]; addons: { title: string; price_cents: number; text: string | null }[];
};

export function getOrder(id: number): OrderDetail | null {
  const d = db();
  const o = d.prepare('SELECT * FROM orders WHERE id = ?').get(id) as (Omit<OrderDetail, 'address' | 'lines' | 'addons'> & { address: string }) | undefined;
  if (!o) return null;
  const lines = d.prepare(`SELECT l.*, g.mode, g.status AS d_status, g.pet_name, g.preview_path, g.print_path, u.path AS upload_path
      FROM order_lines l LEFT JOIN designs g ON g.id = l.design_id LEFT JOIN uploads u ON u.id = g.upload_id
      WHERE l.order_id = ? ORDER BY l.id`).all(id) as (Omit<OrderLine, 'properties' | 'design'> & {
    properties: string; mode: string | null; d_status: DesignStatus | null; pet_name: string | null;
    preview_path: string | null; print_path: string | null; upload_path: string | null;
  })[];
  return {
    ...o,
    address: json(o.address, {} as Record<string, string>),
    lines: lines.map((l) => ({
      id: l.id, product_title: l.product_title, variant_size: l.variant_size, sku: l.sku, qty: l.qty, unit_cents: l.unit_cents,
      design_id: l.design_id, properties: json(l.properties, {} as Record<string, string>),
      design: l.design_id && l.d_status
        ? { id: l.design_id, mode: l.mode!, status: l.d_status, pet_name: l.pet_name, preview_url: mediaUrl(l.preview_path), upload_url: mediaUrl(l.upload_path), has_print: !!l.print_path }
        : null,
    })),
    addons: d.prepare('SELECT title, price_cents, text FROM order_addons WHERE order_id = ?').all(id) as OrderDetail['addons'],
  };
}

// ── Hàng chờ designer (#11)
export type QueueDesign = {
  id: string; mode: 'ai' | 'designer'; status: DesignStatus; style: string | null; pet_name: string | null; notes: string | null;
  email: string | null; created_at: string; updated_at: string; product_title: string | null; variant_size: string | null; print_px: number | null;
  upload_url: string | null; upload_size: string | null; preview_url: string | null; has_print: boolean; orders: { id: number; number: string }[];
};

export function listDesigns(statuses: DesignStatus[], mode: 'designer' | 'all' = 'designer', limit = 100): QueueDesign[] {
  const d = db();
  const rows = d.prepare(`SELECT g.id, g.mode, g.status, g.style, g.pet_name, g.notes, g.email, g.created_at, g.updated_at,
      g.preview_path, g.print_path, p.title AS product_title, v.size AS variant_size, v.print_px, u.path AS upload_path, u.width, u.height
    FROM designs g LEFT JOIN products p ON p.id = g.product_id LEFT JOIN variants v ON v.id = g.variant_id LEFT JOIN uploads u ON u.id = g.upload_id
    WHERE g.status IN (${statuses.map(() => '?').join(',')}) ${mode === 'designer' ? "AND g.mode = 'designer'" : ''}
    ORDER BY g.updated_at ASC LIMIT ?`).all(...statuses, limit) as (Omit<QueueDesign, 'upload_url' | 'upload_size' | 'preview_url' | 'has_print' | 'orders'> & {
    preview_path: string | null; print_path: string | null; upload_path: string | null; width: number | null; height: number | null;
  })[];
  const ordersFor = d.prepare('SELECT DISTINCT o.id, o.number FROM order_lines l JOIN orders o ON o.id = l.order_id WHERE l.design_id = ?');
  return rows.map(({ preview_path, print_path, upload_path, width, height, ...r }) => ({
    ...r,
    upload_url: mediaUrl(upload_path),
    upload_size: width && height ? `${width}×${height}` : null,
    preview_url: mediaUrl(preview_path),
    has_print: !!print_path,
    orders: ordersFor.all(r.id) as { id: number; number: string }[],
  }));
}

export const getDesignRow = (id: string) =>
  db().prepare('SELECT g.*, v.print_px FROM designs g LEFT JOIN variants v ON v.id = g.variant_id WHERE g.id = ?').get(id) as
    | { id: string; mode: 'ai' | 'designer'; status: DesignStatus; print_path: string | null; preview_path: string | null; email: string | null; pet_name: string | null; print_px: number | null }
    | undefined;

// ── Email outbox
export const listEmails = (limit = 200) =>
  db().prepare('SELECT id, to_addr, kind, subject, created_at FROM email_outbox ORDER BY id DESC LIMIT ?').all(limit) as { id: number; to_addr: string; kind: string; subject: string; created_at: string }[];
export const getEmail = (id: number) =>
  db().prepare('SELECT * FROM email_outbox WHERE id = ?').get(id) as { id: number; to_addr: string; kind: string; subject: string; html: string; created_at: string } | undefined;

// ── Reviews (#4)
export type AdminReview = {
  id: number; product_id: number | null; product_title: string | null; order_id: number | null; order_number: string | null;
  author: string; rating: number; title: string | null; body: string; photo_url: string | null;
  status: 'pending' | 'published' | 'hidden'; is_sample: 0 | 1; created_at: string;
};
export function listReviewsAdmin(status?: string): AdminReview[] {
  return db().prepare(`SELECT r.*, p.title AS product_title, o.number AS order_number
    FROM reviews r LEFT JOIN products p ON p.id = r.product_id LEFT JOIN orders o ON o.id = r.order_id
    ${status ? 'WHERE r.status = ?' : ''} ORDER BY CASE r.status WHEN 'pending' THEN 0 ELSE 1 END, r.created_at DESC, r.id DESC`)
    .all(...(status ? [status] : [])) as AdminReview[];
}

// ── Dashboard
export function dashboardCounts() {
  const d = db();
  const one = (sql: string) => (d.prepare(sql).get() as { n: number }).n;
  return {
    new_orders: one("SELECT count(*) AS n FROM orders WHERE status = 'paid'"),
    orders_today: one("SELECT count(*) AS n FROM orders WHERE date(created_at) = date('now')"),
    designer_queue: one("SELECT count(*) AS n FROM designs WHERE mode = 'designer' AND status = 'in_review'"),
    reviews_pending: one("SELECT count(*) AS n FROM reviews WHERE status = 'pending'"),
  };
}
