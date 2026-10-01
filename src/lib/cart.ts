// Giỏ + checkout giả lập (crew D). Giá luôn tính lại từ DB qua pricing.totals — không tin số từ trình duyệt.
// Properties của dòng giỏ do server sinh từ design; khách chỉ thấy visibleProps() + thumbnail, không bao giờ URL hay key "_" (#5).
import { z } from 'zod';
import { db, json, tx } from './db';
import { bundleTiers, type BundleTier } from './catalog';
import { bundleFor, totals, type Totals } from './pricing';
import { deliveryWindow, getSettings, shippingHeadline } from './settings';
import { fmt } from './money';
import { newId } from './ids';
import { mediaUrl } from './personalize/storage'; // quy tắc /media của crew B: chỉ uploads/previews/mockups công khai
import { designLineProps } from './personalize/designs';
import { visibleProps, type DesignStatus, type LineProperties, type Settings } from './types';
import { discountSummary, discountUses, evaluateDiscount, findDiscount, pdpCodes, rejectionMessage } from './discounts';
import { usRegion } from './us-states';
import { startProductionIfReady } from './production';

export const CART_COOKIE = 'cart_id';
export const ORDERS_COOKIE = 'pa_orders';
export const MAX_QTY = 99;
/** Design vào được giỏ: AI đã được khách xác nhận, hoặc đã gửi designer (và sau đó được duyệt). */
export const ADDABLE: readonly DesignStatus[] = ['confirmed', 'in_review', 'approved'];

export class CartError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
export const errorBody = (code: string, message: string) => ({ error: { code, message } });

export type ShippingMethod = 'standard' | 'express';
export type CartLineView = {
  id: number; variant_id: number; product_title: string; product_handle: string; size: string;
  qty: number; unit_cents: number; compare_at_cents: number | null; line_cents: number;
  design_id: string | null;
  thumbnail_url: string | null;          // ảnh preview để hiện thumbnail, không bao giờ in ra dạng chữ
  properties: Record<string, string>;    // đã lọc qua visibleProps()
};
export type CartAddonView = {
  id: number; handle: string; title: string; description: string | null; kind: string; price_cents: number;
  text_input: boolean; text_free: boolean; on: boolean; text: string | null;
};
/** Totals của pricing + phần giảm do mã; total_cents đã trừ mã (và ship nếu mã miễn phí ship). */
export type CartTotals = Totals & { code_discount_cents: number };
export type AppliedCode = { code: string; summary: string; amount_cents: number; free_shipping: boolean };
export type CartView = {
  id: string | null;
  count: number;
  lines: CartLineView[];
  addons: CartAddonView[];
  bundle: { tier: BundleTier | null; next: BundleTier | null; hint: string | null; saving: string | null };
  totals: CartTotals;
  /** Mã đang áp và hợp lệ với giỏ hiện tại. */
  discount: AppliedCode | null;
  /** Mã đã lưu nhưng không còn dùng được (hết hạn, giỏ dưới mức tối thiểu…): hiện lý do, không âm thầm bỏ. */
  discount_error: { code: string; message: string } | null;
  /** Mã hợp lệ nhưng không lợi hơn giảm giá theo số lượng: giữ giảm theo số lượng, báo khách (không chặn checkout). */
  discount_note: { code: string; message: string } | null;
  /** Mã hiện trên PDP đủ điều kiện và rẻ hơn tổng hiện tại (kể cả khi đang áp mã khác): gợi ý đổi, không tự áp. */
  discount_better: { code: string; message: string } | null;
  shipping_headline: string;
  /** Còn thiếu bao nhiêu (tiền hàng sau giảm theo số lượng) để được free ship standard; null khi đã free / không có ngưỡng. */
  free_shipping_gap_cents: number | null;
};

/** "Add 1 more to save 15%" — gợi ý bậc giảm kế tiếp từ bundleFor(). */
export function bundleHint(qty: number, tiers: BundleTier[]) {
  const { tier, next } = bundleFor(qty, tiers);
  const plain = (t: BundleTier | null) => (t ? { min_qty: t.min_qty, percent_off: t.percent_off } : null); // row node:sqlite có null prototype
  return {
    tier: plain(tier), next: plain(next),
    hint: qty > 0 && next ? `Add ${next.min_qty - qty} more to save ${next.percent_off}%` : null,
    saving: tier ? `${tier.percent_off}% multi-portrait discount applied` : null,
  };
}

type LineRow = {
  id: number; variant_id: number; design_id: string | null; qty: number; properties: string;
  size: string; price_cents: number; compare_at_cents: number | null; title: string; handle: string; frame_included: number;
};
type AddonRow = {
  id: number; handle: string; title: string; description: string | null; kind: string; price_cents: number;
  text_input: number; text_free: number; selected: number; text: string | null;
};

const cartExists = (id: string | null | undefined): id is string =>
  !!id && !!db().prepare('SELECT 1 FROM carts WHERE id = ?').get(id);

export function ensureCart(id: string | null | undefined): string {
  if (cartExists(id)) return id;
  const nid = newId('cart');
  db().prepare('INSERT INTO carts (id) VALUES (?)').run(nid);
  return nid;
}

export function cartCount(id: string | null | undefined): number {
  if (!id) return 0;
  const r = db().prepare('SELECT COALESCE(SUM(qty), 0) n FROM cart_lines WHERE cart_id = ?').get(id) as { n: number };
  return Number(r.n);
}

function rawLines(id: string) {
  return db().prepare(`SELECT l.id, l.variant_id, l.design_id, l.qty, l.properties, v.size, v.price_cents, v.compare_at_cents,
      p.title, p.handle, p.frame_included
    FROM cart_lines l JOIN variants v ON v.id = l.variant_id JOIN products p ON p.id = v.product_id
    WHERE l.cart_id = ? ORDER BY l.id`).all(id) as LineRow[];
}

function rawAddons(id: string | null, lines: LineRow[]) {
  const rows = db().prepare(`SELECT a.id, a.handle, a.title, a.description, a.kind, a.price_cents, a.text_input, a.text_free,
      (ca.addon_id IS NOT NULL) selected, ca.text
    FROM addons a LEFT JOIN cart_addons ca ON ca.addon_id = a.id AND ca.cart_id = ?
    WHERE a.active = 1 ORDER BY a.position, a.id`).all(id ?? '') as AddonRow[];
  // Khung chỉ bán khi còn ít nhất 1 sản phẩm chưa kèm khung (#3).
  const allFramed = lines.length > 0 && lines.every((l) => l.frame_included);
  return rows.filter((a) => !(a.kind === 'frame' && allFramed));
}

export function getCart(id: string | null | undefined, method: ShippingMethod = 'standard', s: Settings = getSettings()): CartView {
  const cid = cartExists(id) ? id : null;
  const lines = cid ? rawLines(cid) : [];
  const addons = lines.length ? rawAddons(cid, lines) : [];
  const tiers = bundleTiers();
  const qty = lines.reduce((n, l) => n + l.qty, 0);
  const on = addons.filter((a) => a.selected);
  const priced = lines.map((l) => ({ unit_cents: l.price_cents, qty: l.qty }));
  const base = totals(priced, on, tiers, s, method);
  const stored = cid ? (db().prepare('SELECT discount_code FROM carts WHERE id = ?').get(cid) as { discount_code: string | null }).discount_code : null;
  const code = stored && lines.length ? applyCode(stored, base, totals(priced, on, [], s, method), qty) : { t: { ...base, code_discount_cents: 0 }, discount: null, error: null, note: null };
  const t = code.t;
  const bundle = bundleHint(qty, tiers);
  const better = lines.length ? betterCode(stored, t.total_cents, base, totals(priced, on, [], s, method), qty) : null;
  return {
    id: cid,
    count: qty,
    lines: lines.map((l) => {
      const props = json<LineProperties>(l.properties, {});
      return {
        id: l.id, variant_id: l.variant_id, product_title: l.title, product_handle: l.handle, size: l.size,
        qty: l.qty, unit_cents: l.price_cents, compare_at_cents: l.compare_at_cents, line_cents: l.price_cents * l.qty,
        design_id: l.design_id, thumbnail_url: props._preview_url ?? null, properties: visibleProps(props),
      };
    }),
    addons: addons.map((a) => ({
      id: a.id, handle: a.handle, title: a.title, description: a.description, kind: a.kind, price_cents: a.price_cents,
      text_input: !!a.text_input, text_free: !!a.text_free, on: !!a.selected, text: a.text,
    })),
    // Mã thắng → không nói "đã áp giảm theo số lượng", cũng không gợi ý bậc số lượng (mã đã thay nó).
    bundle: code.discount ? { ...bundle, saving: null, hint: null } : t.discount_cents ? bundle : { ...bundle, saving: null },
    totals: t,
    discount: code.discount,
    discount_error: code.error,
    discount_note: code.note,
    discount_better: better,
    shipping_headline: shippingHeadline(s),
    free_shipping_gap_cents: freeShippingGap(t, !!code.discount, method, s),
  };
}

type Msg = { code: string; message: string };
type CodeResult = { t: CartTotals; discount: AppliedCode | null; error: Msg | null; note: Msg | null };

export const NOT_BETTER = 'Your bundle discount is already better, so we kept it. Codes don’t combine with the multi-portrait discount.';

/** Cùng ngưỡng với pricing.totals(): tiền hàng = subtotal trừ giảm theo số lượng (khi có mã thì không có giảm đó). */
function freeShippingGap(t: CartTotals, coded: boolean, method: ShippingMethod, s: Settings) {
  const over = s.shipping.free_over_cents;
  if (method !== 'standard' || over == null || t.shipping_cents === 0) return null;
  const gap = over - (t.subtotal_cents - (coded ? 0 : t.discount_cents));
  return gap > 0 ? gap : null;
}

/** Mã PDP rẻ nhất cho giỏ này, nếu nó rẻ hơn `current` (tổng đang tính, có hoặc không có mã). */
function betterCode(stored: string | null, current: number, bundled: Totals, plain: Totals, qty: number): Msg | null {
  let best: { code: string; total: number } | null = null;
  for (const { code } of pdpCodes()) {
    if (code === stored) continue;
    const r = applyCode(code, bundled, plain, qty);
    if (r.discount && r.t.total_cents < (best?.total ?? current)) best = { code, total: r.t.total_cents };
  }
  return best && { code: best.code, message: `Code ${best.code} saves you ${fmt(current - best.total)} more on this cart.` };
}

/**
 * Tính lại mã trên Totals của server. Không cộng dồn (quyết định của captain): so "chỉ giảm theo số lượng" (`bundled`)
 * với "chỉ mã" (`plain` = cùng giỏ không có bậc giảm, mã tính trên subtotal) và lấy tổng thấp hơn; bằng nhau → giữ giảm theo số lượng.
 * Add-on và ship không bị giảm, trừ mã miễn phí ship.
 */
function applyCode(raw: string, bundled: Totals, plain: Totals, qty: number): CodeResult {
  const none = { ...bundled, code_discount_cents: 0 };
  const d = findDiscount(raw);
  if (!d) return { t: none, discount: null, error: { code: raw, message: rejectionMessage(raw, 'not_found') }, note: null };
  const cart = { subtotal_cents: plain.subtotal_cents, qty };
  const r = evaluateDiscount(d, cart, discountUses(d.code));
  if (!r.ok) return { t: none, discount: null, error: { code: d.code, message: rejectionMessage(d.code, r.reason, d, cart) }, note: null };
  const shipping = r.free_shipping ? 0 : plain.shipping_cents;
  const total = plain.total_cents - r.discount_cents - (plain.shipping_cents - shipping);
  if (bundled.discount_cents > 0 && total >= bundled.total_cents) return { t: none, discount: null, error: null, note: { code: d.code, message: NOT_BETTER } };
  return {
    t: { ...plain, shipping_cents: shipping, code_discount_cents: r.discount_cents, total_cents: total },
    discount: { code: d.code, summary: discountSummary(d), amount_cents: plain.total_cents - total, free_shipping: r.free_shipping },
    error: null, note: null,
  };
}

/** Khách nhập mã: kiểm với giỏ hiện tại, chỉ lưu khi hợp lệ; lỗi nói rõ lý do (không tồn tại, hết hạn, chưa đủ tối thiểu…). */
export function applyDiscountCode(cartId: string, code: string) {
  const cart = getCart(cartId);
  if (!cart.id || !cart.lines.length) throw new CartError(409, 'cart_empty', 'Add a portrait to your cart before using a code.');
  const d = findDiscount(code);
  if (!d) throw new CartError(404, 'discount_not_found', rejectionMessage(code, 'not_found'));
  const ctx = { subtotal_cents: cart.totals.subtotal_cents, qty: cart.count };
  const r = evaluateDiscount(d, ctx, discountUses(d.code));
  if (!r.ok) throw new CartError(r.reason === 'min_qty' || r.reason === 'min_subtotal' ? 422 : 410, `discount_${r.reason}`, rejectionMessage(d.code, r.reason, d, ctx));
  db().prepare("UPDATE carts SET discount_code = ?, updated_at = datetime('now') WHERE id = ?").run(d.code, cartId);
}

export function removeDiscountCode(cartId: string) {
  db().prepare("UPDATE carts SET discount_code = NULL, updated_at = datetime('now') WHERE id = ?").run(cartId);
}

// ── Ghi

export const AddLineInput = z.object({
  variant_id: z.number().int().positive(),
  qty: z.number().int().min(1).max(MAX_QTY).default(1),
  design_id: z.string().min(1).max(40),
});
export const QtyInput = z.object({ qty: z.number().int().min(1).max(MAX_QTY) });
export const AddonInput = z.object({
  addon_id: z.number().int().positive(),
  on: z.boolean(),
  text: z.string().trim().max(300).optional(),
});

type DesignRow = {
  id: string; product_id: number; mode: 'ai' | 'designer'; status: DesignStatus; style: string | null; pet_name: string | null;
  preview_path: string | null; mockup_path: string | null; upload_path: string | null;
};

/** Properties sinh từ design: "_" = ẩn với khách; hiện chỉ Pet name + Style. */
function lineProperties(d: DesignRow, s: Settings): LineProperties {
  const props: LineProperties = { _design_id: d.id, _print_url: `/api/admin/designs/${encodeURIComponent(d.id)}/print` };
  const thumb = mediaUrl(d.preview_path) ?? mediaUrl(d.mockup_path) ?? mediaUrl(d.upload_path);
  if (thumb) props._preview_url = thumb;
  if (d.pet_name?.trim()) props['Pet name'] = d.pet_name.trim();
  props.Style = d.mode === 'designer' ? 'Designer finish' : s.ai.styles.find((x) => x.id === d.style)?.name ?? 'Custom';
  Object.assign(props, designLineProps(d.id));   // v2: transform + final pearl_compare (ẩn, theo dòng sang đơn)
  return props;
}

export function addLine(cartId: string, input: z.infer<typeof AddLineInput>) {
  const d = db();
  const variant = d.prepare('SELECT v.id, v.product_id FROM variants v JOIN products p ON p.id = v.product_id WHERE v.id = ? AND p.status = \'active\'')
    .get(input.variant_id) as { id: number; product_id: number } | undefined;
  if (!variant) throw new CartError(404, 'variant_not_found', 'That size is no longer available.');
  const design = d.prepare(`SELECT ds.id, ds.product_id, ds.mode, ds.status, ds.style, ds.pet_name, ds.preview_path, ds.mockup_path, u.path upload_path
    FROM designs ds LEFT JOIN uploads u ON u.id = ds.upload_id WHERE ds.id = ?`).get(input.design_id) as DesignRow | undefined;
  if (!design) throw new CartError(404, 'design_not_found', 'We could not find that design.');
  if (!ADDABLE.includes(design.status)) throw new CartError(409, 'design_not_confirmed', 'Please confirm your preview before adding it to the cart.');
  if (design.product_id !== variant.product_id) throw new CartError(400, 'design_product_mismatch', 'This design belongs to a different product.');

  tx(() => {
    const same = d.prepare('SELECT id, qty FROM cart_lines WHERE cart_id = ? AND variant_id = ? AND design_id = ?')
      .get(cartId, variant.id, design.id) as { id: number; qty: number } | undefined;
    if (same) d.prepare('UPDATE cart_lines SET qty = ? WHERE id = ?').run(Math.min(MAX_QTY, same.qty + input.qty), same.id);
    else d.prepare('INSERT INTO cart_lines (cart_id, variant_id, design_id, qty, properties) VALUES (?, ?, ?, ?, ?)')
      .run(cartId, variant.id, design.id, input.qty, JSON.stringify(lineProperties(design, getSettings())));
    d.prepare("UPDATE carts SET updated_at = datetime('now') WHERE id = ?").run(cartId);
  });
}

function ownLine(cartId: string, lineId: number) {
  const r = db().prepare('SELECT id FROM cart_lines WHERE id = ? AND cart_id = ?').get(lineId, cartId);
  if (!r) throw new CartError(404, 'line_not_found', 'That item is no longer in your cart.');
}

export function updateLine(cartId: string, lineId: number, qty: number) {
  ownLine(cartId, lineId);
  db().prepare('UPDATE cart_lines SET qty = ? WHERE id = ?').run(qty, lineId);
}

export function removeLine(cartId: string, lineId: number) {
  ownLine(cartId, lineId);
  db().prepare('DELETE FROM cart_lines WHERE id = ?').run(lineId);
}

export function setAddon(cartId: string, input: z.infer<typeof AddonInput>) {
  const lines = rawLines(cartId);
  const addon = rawAddons(cartId, lines).find((a) => a.id === input.addon_id);
  if (!addon) throw new CartError(404, 'addon_not_found', 'That option is not available for your cart.');
  if (!input.on) {
    db().prepare('DELETE FROM cart_addons WHERE cart_id = ? AND addon_id = ?').run(cartId, addon.id);
    return;
  }
  const text = addon.text_input && input.text ? input.text : null;
  db().prepare('INSERT INTO cart_addons (cart_id, addon_id, text) VALUES (?, ?, ?) ON CONFLICT(cart_id, addon_id) DO UPDATE SET text = excluded.text')
    .run(cartId, addon.id, text);
}

// ── Checkout giả lập

export const CheckoutInput = z.object({
  email: z.email('Enter a valid email address').max(200),
  name: z.string().trim().min(2, 'Enter your full name').max(120),
  address: z.object({
    line1: z.string().trim().min(3, 'Enter your street address').max(200),
    line2: z.string().trim().max(200).optional().default(''),
    city: z.string().trim().min(2, 'Enter your city').max(100),
    region: z.string().trim().min(2, 'Enter your state').max(100),
    postal_code: z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9 -]{2,9}$/, 'Enter a valid ZIP / postal code'),
    country: z.string().trim().toUpperCase().length(2, 'Choose a country'),
  }).superRefine((a, ctx) => {
    if (a.country !== 'US') return;
    if (!usRegion(a.region)) ctx.addIssue({ code: 'custom', path: ['region'], message: 'Choose a US state' });
    if (!/^\d{5}(-\d{4})?$/.test(a.postal_code)) ctx.addIssue({ code: 'custom', path: ['postal_code'], message: 'Enter a 5-digit ZIP code' });
  }).transform((a) => (a.country === 'US' ? { ...a, region: usRegion(a.region) ?? a.region } : a)),
  shipping_method: z.enum(['standard', 'express']),
});
export type CheckoutData = z.infer<typeof CheckoutInput>;

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const day = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

// Email xác nhận: HTML inline-style (mail client bỏ <style>), màu theo token DESIGN.md, link tuyệt đối qua SITE_URL.
const C = { ink: '#2b1d18', muted: '#6e5f58', line: '#e7dfda', linen: '#f6f2ef', ok: '#15803d' };
const FONT = "font-family:Figtree,'Helvetica Neue',Arial,sans-serif";
const site = () => (process.env.SITE_URL || 'http://localhost:3000').replace(/\/+$/, '');

function confirmationEmail(number: string, data: CheckoutData, cart: CartView, s: Settings) {
  const w = deliveryWindow(s, data.shipping_method);
  const td = `padding:8px 0;border-bottom:1px solid ${C.line};vertical-align:top`;
  const rows = cart.lines.map((l) => {
    const props = Object.entries(l.properties).map(([k, v]) => `${esc(k)}: ${esc(v)}`).join(' · ');
    const img = l.thumbnail_url
      ? `<img src="${esc(site() + l.thumbnail_url)}" alt="Preview of your portrait" width="64" height="64" style="display:block;width:64px;height:64px;border-radius:6px;border:1px solid ${C.line};object-fit:cover">`
      : '';
    return `<tr><td width="76" style="${td}">${img}</td>
<td style="${td}"><strong>${esc(l.product_title)}</strong> · ${esc(l.size)} in${l.qty > 1 ? ` × ${l.qty}` : ''}<br><span style="color:${C.muted};font-size:13px">${props}${l.design_id ? `<br>Design ref (for support): ${esc(l.design_id)}` : ''}</span></td>
<td align="right" style="${td};white-space:nowrap">${fmt(l.line_cents)}</td></tr>`;
  }).join('');
  const t = cart.totals;
  const sum = (label: string, value: string, strong = false) =>
    `<tr><td style="padding:4px 0;${strong ? `font-weight:700;font-size:16px;border-top:1px solid ${C.line};padding-top:10px` : ''}">${label}</td><td align="right" style="padding:4px 0;white-space:nowrap;${strong ? `font-weight:700;font-size:16px;border-top:1px solid ${C.line};padding-top:10px` : ''}">${value}</td></tr>`;
  // Cùng thứ tự với Summary trên web: tạm tính hàng → giảm → add-on → ship → tổng.
  const addons = cart.addons.filter((a) => a.on).map((a) =>
    sum(`${esc(a.title)}${a.text ? `<br><span style="color:${C.muted};font-size:13px">Card message: “${esc(a.text)}”</span>` : ''}`, a.price_cents ? fmt(a.price_cents) : 'Free')).join('');
  const a = data.address;
  const track = `${site()}/track-order`;
  const designer = cart.lines.some((l) => l.properties.Style === 'Designer finish');
  return `<div style="background:${C.linen};padding:24px 12px;${FONT};color:${C.ink};font-size:15px;line-height:1.5">
<div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid ${C.line};border-radius:10px;padding:28px 24px">
<p style="margin:0 0 20px;font-family:Georgia,serif;font-size:22px">${esc(s.shop.name)}</p>
<h1 style="margin:0;font-family:Georgia,serif;font-weight:400;font-size:26px;line-height:1.2">Thanks for your order, ${esc(data.name.split(' ')[0])}!</h1>
<p style="margin:12px 0 0">Order <strong>#${number}</strong> is confirmed. Estimated delivery: <strong>${day(w.from)} – ${day(w.to)}</strong> (${data.shipping_method === 'express' ? 'Express' : 'Standard'} shipping).</p>
<p style="margin:12px 0 0;color:${C.muted}">${designer ? 'A designer now hand-finishes your portrait from your photo, and we email you when it is ready.' : 'You approved your preview, so we make exactly that design.'} Each portrait takes about ${s.shipping.production_days} days in the studio, and we email tracking when it ships.</p>
<p style="margin:20px 0 4px"><a href="${esc(track)}" style="display:inline-block;background:${C.ink};color:#ffffff;text-decoration:none;font-weight:600;border-radius:9999px;padding:12px 24px">Track your order</a></p>
<p style="margin:0;color:${C.muted};font-size:13px">Use order number #${number} and ${esc(data.email)}.</p>
<table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="margin-top:24px;border-collapse:collapse;border-top:1px solid ${C.line}">${rows}</table>
<table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="margin-top:12px;border-collapse:collapse">
${sum('Subtotal', fmt(t.subtotal_cents))}
${t.discount_cents ? sum('Multi-portrait discount', `−${fmt(t.discount_cents)}`) : ''}
${cart.discount && t.code_discount_cents ? sum(`Discount ${esc(cart.discount.code)}`, `−${fmt(t.code_discount_cents)}`) : ''}
${addons}
${sum(`Shipping${cart.discount?.free_shipping ? ` (${esc(cart.discount.code)})` : ''}`, t.shipping_cents ? fmt(t.shipping_cents) : 'Free')}
${sum('Total', fmt(t.total_cents), true)}</table>
<p style="margin:24px 0 4px;font-weight:600">Shipping to</p>
<p style="margin:0;color:${C.muted}">${esc(data.name)}<br>${esc(a.line1)}${a.line2 ? `, ${esc(a.line2)}` : ''}<br>${esc(a.city)}, ${esc(a.region)} ${esc(a.postal_code)}<br>${a.country === 'US' ? 'United States' : esc(a.country)}</p>
<p style="margin:24px 0 0;color:${C.muted};font-size:13px">Questions? Reply to this email or write to <a href="mailto:${esc(s.shop.support_email)}" style="color:${C.ink}">${esc(s.shop.support_email)}</a>.</p>
</div></div>`;
}

export function placeOrder(cartId: string | null | undefined, data: CheckoutData, sessionId: string | null = null): { order_number: string } {
  const s = getSettings();
  if (!s.shipping.regions.includes(data.address.country)) throw new CartError(400, 'region_not_shipped', `We currently ship to ${s.shipping.regions.join(', ')} only.`);
  const cart = getCart(cartId, data.shipping_method, s);
  if (!cart.id || !cart.lines.length) throw new CartError(409, 'cart_empty', 'Your cart is empty.');
  // Mã đã lưu nhưng không còn hợp lệ: dừng lại cho khách thấy thay vì âm thầm tính giá cao hơn.
  if (cart.discount_error) throw new CartError(409, 'discount_invalid', `${cart.discount_error.message} Remove the code to continue.`);
  const d = db();
  return tx(() => {
    for (const l of cart.lines) {
      const st = l.design_id && (d.prepare('SELECT status FROM designs WHERE id = ?').get(l.design_id) as { status: DesignStatus } | undefined)?.status;
      if (!st || !ADDABLE.includes(st)) throw new CartError(409, 'design_not_confirmed', 'One of your designs needs to be confirmed again before checkout.');
    }
    const { n } = d.prepare('SELECT COALESCE(MAX(CAST(number AS INTEGER)), 1000) + 1 n FROM orders').get() as { n: number };
    const number = String(n);
    const t = cart.totals;
    // Giới hạn lượt dùng kiểm lại trong transaction (lượt = số đơn đã lưu mã).
    if (cart.discount) {
      const dc = findDiscount(cart.discount.code);
      const again = dc && evaluateDiscount(dc, { subtotal_cents: t.subtotal_cents, qty: cart.count }, discountUses(dc.code));
      if (!dc || !again || !again.ok) throw new CartError(409, 'discount_invalid', `${rejectionMessage(cart.discount.code, dc && again && !again.ok ? again.reason : 'not_found', dc)} Remove the code to continue.`);
    }
    const order = d.prepare(`INSERT INTO orders (number, email, name, address, shipping_method, subtotal_cents, discount_cents, addons_cents, shipping_cents, total_cents, discount_code, code_discount_cents)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`).get(
      number, data.email, data.name, JSON.stringify(data.address), data.shipping_method,
      t.subtotal_cents, t.discount_cents, t.addons_cents, t.shipping_cents, t.total_cents,
      cart.discount?.code ?? null, t.code_discount_cents,
    ) as { id: number };
    // order_lines giữ design_id + đủ properties (kể cả "_") cho xưởng / admin.
    const raw = rawLines(cart.id!);
    const ol = d.prepare('INSERT INTO order_lines (order_id, product_title, variant_size, sku, qty, unit_cents, design_id, properties) VALUES (?, ?, ?, (SELECT sku FROM variants WHERE id = ?), ?, ?, ?, ?)');
    for (const l of raw) ol.run(order.id, l.title, l.size, l.variant_id, l.qty, l.price_cents, l.design_id, l.properties);
    const oa = d.prepare('INSERT INTO order_addons (order_id, title, price_cents, text) VALUES (?, ?, ?, ?)');
    for (const a of cart.addons.filter((x) => x.on)) oa.run(order.id, a.title, a.price_cents, a.text);
    startProductionIfReady(order.id); // design AI đã có file in → vào xưởng ngay
    d.prepare('DELETE FROM cart_lines WHERE cart_id = ?').run(cart.id);
    d.prepare('DELETE FROM cart_addons WHERE cart_id = ?').run(cart.id);
    d.prepare("UPDATE carts SET email = ?, discount_code = NULL, updated_at = datetime('now') WHERE id = ?").run(data.email, cart.id);
    d.prepare("INSERT INTO email_outbox (to_addr, kind, subject, html) VALUES (?, 'order_confirmation', ?, ?)")
      .run(data.email, `Your ${s.shop.name} order #${number}`, confirmationEmail(number, data, cart, s));
    d.prepare("INSERT INTO events (name, session_id, payload) VALUES ('checkout_completed', ?, ?)")
      .run(sessionId, JSON.stringify({ order_number: number, total_cents: t.total_cents, qty: cart.count, shipping_method: data.shipping_method, discount_code: cart.discount?.code ?? null }));
    return { order_number: number };
  });
}

// ── Đọc đơn (trang cảm ơn)

export type OrderView = {
  number: string; email: string; name: string; shipping_method: ShippingMethod; created_at: string;
  address: CheckoutData['address'];
  totals: CartTotals;
  discount_code: string | null;
  lines: { product_title: string; variant_size: string; qty: number; unit_cents: number; design_id: string | null; thumbnail_url: string | null; properties: Record<string, string> }[];
  addons: { title: string; price_cents: number; text: string | null }[];
};

export function getOrder(number: string): OrderView | null {
  const d = db();
  const o = d.prepare('SELECT * FROM orders WHERE number = ?').get(number) as
    | (Omit<OrderView, 'address' | 'totals' | 'lines' | 'addons'> & CartTotals & { id: number; address: string })
    | undefined;
  if (!o) return null;
  const lines = d.prepare('SELECT product_title, variant_size, qty, unit_cents, design_id, properties FROM order_lines WHERE order_id = ? ORDER BY id')
    .all(o.id) as { product_title: string; variant_size: string; qty: number; unit_cents: number; design_id: string | null; properties: string }[];
  return {
    number: o.number, email: o.email, name: o.name, shipping_method: o.shipping_method, created_at: o.created_at,
    address: json(o.address, {} as CheckoutData['address']),
    totals: { subtotal_cents: o.subtotal_cents, discount_cents: o.discount_cents, addons_cents: o.addons_cents, shipping_cents: o.shipping_cents, total_cents: o.total_cents, code_discount_cents: o.code_discount_cents ?? 0 },
    discount_code: o.discount_code ?? null,
    lines: lines.map(({ properties, ...l }) => {
      const p = json<LineProperties>(properties, {});
      return { ...l, thumbnail_url: p._preview_url ?? null, properties: visibleProps(p) };
    }),
    addons: d.prepare('SELECT title, price_cents, text FROM order_addons WHERE order_id = ?').all(o.id) as OrderView['addons'],
  };
}

/** Cookie pa_orders: các số đơn trình duyệt này vừa đặt — trang cảm ơn chỉ hiện chi tiết cho đúng người đặt. */
export const ordersFromCookie = (v: string | undefined) => (v ?? '').split('.').filter((x) => /^\d{1,12}$/.test(x));
export const addOrderToCookie = (v: string | undefined, number: string) => [...ordersFromCookie(v).filter((x) => x !== number), number].slice(-10).join('.');
