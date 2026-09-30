// Đơn hàng + địa chỉ của khách (UI-2): trang /account, /account/orders/[number], /track-order.
import { z } from 'zod';
import { db, json } from './db';
import { deliveryWindow, getSettings } from './settings';
import { visibleProps, type DesignStatus, type LineProperties } from './types';
import type { OrderStatus } from './order-status';
import { AccountError } from './customer';

export const AddressInput = z.object({
  line1: z.string().trim().min(3, 'Enter your street address').max(200),
  line2: z.string().trim().max(200).optional().default(''),
  city: z.string().trim().min(2, 'Enter your city').max(100),
  region: z.string().trim().min(2, 'Enter your state').max(100),
  postal_code: z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9 -]{2,9}$/, 'Enter a valid ZIP / postal code'),
  country: z.string().trim().length(2, 'Choose a country'),
});
export type Address = z.infer<typeof AddressInput>;

export type OrderSummary = {
  number: string; created_at: string; status: OrderStatus; total_cents: number; shipping_method: 'standard' | 'express';
  items: number; thumbnails: { url: string; alt: string }[];
  designs: { id: string; status: DesignStatus }[];
};

export type OrderDetail = Omit<OrderSummary, 'thumbnails' | 'designs'> & {
  email: string; name: string; address: Address;
  subtotal_cents: number; discount_cents: number; addons_cents: number; shipping_cents: number;
  delivery: { from: string; to: string } | null;
  lines: {
    title: string; size: string; qty: number; unit_cents: number; thumbnail_url: string | null;
    properties: Record<string, string>; design_id: string | null; design_status: DesignStatus | null;
  }[];
  addons: { title: string; price_cents: number; text: string | null }[];
};

type OrderRow = {
  id: number; number: string; email: string; name: string; address: string; status: OrderStatus; created_at: string;
  shipping_method: 'standard' | 'express'; subtotal_cents: number; discount_cents: number; addons_cents: number; shipping_cents: number; total_cents: number;
};
const orderDate = (s: string) => new Date(s.replace(' ', 'T') + 'Z');

function linesFor(orderId: number) {
  return (db().prepare(`SELECT l.product_title, l.variant_size, l.qty, l.unit_cents, l.design_id, l.properties, d.status AS design_status
      FROM order_lines l LEFT JOIN designs d ON d.id = l.design_id WHERE l.order_id = ? ORDER BY l.id`).all(orderId) as {
    product_title: string; variant_size: string; qty: number; unit_cents: number; design_id: string | null; properties: string; design_status: DesignStatus | null;
  }[]).map((l) => {
    const p = json<LineProperties>(l.properties, {});
    return {
      title: l.product_title, size: l.variant_size, qty: l.qty, unit_cents: l.unit_cents,
      thumbnail_url: p._preview_url ?? null, properties: visibleProps(p), design_id: l.design_id, design_status: l.design_status,
    };
  });
}

export function ordersForCustomer(customerId: number, limit = 50): OrderSummary[] {
  const rows = db().prepare('SELECT * FROM orders WHERE customer_id = ? ORDER BY created_at DESC, id DESC LIMIT ?').all(customerId, limit) as OrderRow[];
  return rows.map((o) => {
    const lines = linesFor(o.id);
    return {
      number: o.number, created_at: o.created_at, status: o.status, total_cents: o.total_cents, shipping_method: o.shipping_method,
      items: lines.reduce((n, l) => n + l.qty, 0),
      thumbnails: lines.filter((l) => l.thumbnail_url).slice(0, 3).map((l) => ({ url: l.thumbnail_url!, alt: `Preview of ${l.properties['Pet name'] || 'your pet'} for ${l.title}` })),
      designs: lines.filter((l) => l.design_id && l.design_status).map((l) => ({ id: l.design_id!, status: l.design_status! })),
    };
  });
}

function detail(o: OrderRow): OrderDetail {
  const lines = linesFor(o.id);
  const done = o.status === 'delivered' || o.status === 'refunded' || o.status === 'canceled';
  const w = done ? null : deliveryWindow(getSettings(), o.shipping_method, orderDate(o.created_at));
  return {
    number: o.number, created_at: o.created_at, status: o.status, total_cents: o.total_cents, shipping_method: o.shipping_method,
    email: o.email, name: o.name, address: json(o.address, {} as Address),
    subtotal_cents: o.subtotal_cents, discount_cents: o.discount_cents, addons_cents: o.addons_cents, shipping_cents: o.shipping_cents,
    items: lines.reduce((n, l) => n + l.qty, 0),
    delivery: w ? { from: w.from.toISOString(), to: w.to.toISOString() } : null,
    lines,
    addons: db().prepare('SELECT title, price_cents, text FROM order_addons WHERE order_id = ?').all(o.id) as OrderDetail['addons'],
  };
}

export function customerOrder(customerId: number, number: string): OrderDetail | null {
  const o = db().prepare('SELECT * FROM orders WHERE number = ? AND customer_id = ?').get(number, customerId) as OrderRow | undefined;
  return o ? detail(o) : null;
}

export const TrackInput = z.object({
  number: z.string().trim().transform((s) => s.replace(/^#/, '')).pipe(z.string().regex(/^\d{1,12}$/, 'Enter the order number from your confirmation email')),
  email: z.email('Enter the email you used at checkout').max(200),
});

/** Tra đơn bằng số đơn + email (như trang "Track order"). Trả bản rút gọn: không có địa chỉ đầy đủ. */
export function trackOrder(input: z.infer<typeof TrackInput>) {
  const o = db().prepare('SELECT * FROM orders WHERE number = ? AND email = ? COLLATE NOCASE').get(input.number, input.email.trim()) as OrderRow | undefined;
  if (!o) return null;
  const d = detail(o);
  return {
    number: d.number, created_at: d.created_at, status: d.status, shipping_method: d.shipping_method, total_cents: d.total_cents,
    delivery: d.delivery, ship_to: `${d.address.city ?? ''}, ${d.address.region ?? ''}`.replace(/^, |, $/g, ''),
    lines: d.lines.map(({ title, size, qty, thumbnail_url, design_status, properties }) => ({ title, size, qty, thumbnail_url, design_status, pet_name: properties['Pet name'] ?? null })),
  };
}
export type TrackedOrder = NonNullable<ReturnType<typeof trackOrder>>;

/** Gắn đơn vừa đặt vào khách đang đăng nhập (checkout). Chỉ gắn đơn chưa có chủ. */
export function attachOrderToCustomer(number: string, customerId: number) {
  db().prepare('UPDATE orders SET customer_id = ? WHERE number = ? AND customer_id IS NULL').run(customerId, number);
}

// ── Sổ địa chỉ

export type SavedAddress = { id: number; address: Address; is_default: boolean };
export const MAX_ADDRESSES = 10;

export function listAddresses(customerId: number): SavedAddress[] {
  return (db().prepare('SELECT id, address, is_default FROM customer_addresses WHERE customer_id = ? ORDER BY is_default DESC, id').all(customerId) as
    { id: number; address: string; is_default: number }[]).map((r) => ({ id: r.id, address: json(r.address, {} as Address), is_default: !!r.is_default }));
}

export function addAddress(customerId: number, a: Address, makeDefault: boolean) {
  const d = db();
  const { n } = d.prepare('SELECT count(*) AS n FROM customer_addresses WHERE customer_id = ?').get(customerId) as { n: number };
  if (n >= MAX_ADDRESSES) throw new AccountError(409, 'too_many_addresses', `You can save up to ${MAX_ADDRESSES} addresses. Remove one first.`);
  const { id } = d.prepare('INSERT INTO customer_addresses (customer_id, address, is_default) VALUES (?, ?, 0) RETURNING id').get(customerId, JSON.stringify(a)) as { id: number };
  if (makeDefault || n === 0) setDefaultAddress(customerId, id);
  return id;
}

export function updateAddress(customerId: number, id: number, a: Address) {
  const r = db().prepare('UPDATE customer_addresses SET address = ? WHERE id = ? AND customer_id = ?').run(JSON.stringify(a), id, customerId);
  if (!r.changes) throw new AccountError(404, 'address_not_found', 'That address is no longer saved.');
}

export function setDefaultAddress(customerId: number, id: number) {
  const d = db();
  if (!d.prepare('SELECT 1 FROM customer_addresses WHERE id = ? AND customer_id = ?').get(id, customerId)) throw new AccountError(404, 'address_not_found', 'That address is no longer saved.');
  d.prepare('UPDATE customer_addresses SET is_default = (id = ?) WHERE customer_id = ?').run(id, customerId);
}

export function deleteAddress(customerId: number, id: number) {
  const d = db();
  const row = d.prepare('SELECT is_default FROM customer_addresses WHERE id = ? AND customer_id = ?').get(id, customerId) as { is_default: number } | undefined;
  if (!row) throw new AccountError(404, 'address_not_found', 'That address is no longer saved.');
  d.prepare('DELETE FROM customer_addresses WHERE id = ?').run(id);
  // Xoá địa chỉ mặc định → địa chỉ cũ nhất còn lại thành mặc định.
  if (row.is_default) d.prepare('UPDATE customer_addresses SET is_default = 1 WHERE id = (SELECT id FROM customer_addresses WHERE customer_id = ? ORDER BY id LIMIT 1)').run(customerId);
}
