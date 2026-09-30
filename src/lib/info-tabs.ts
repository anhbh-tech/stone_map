// Nội dung InfoTabs trên PDP (Description / Shopping Tips / Shipping & Returns).
// Mặc định toàn store: settings key 'pdp_info' (không nằm trong Settings của lead, getSettings() bỏ qua key lạ).
// Ghi đè theo sản phẩm: products.info_tabs (JSON, db/migrations/pdp_001_info_tabs.sql).
// Shipping & Returns sinh từ settings (#3: không gõ tay con số ship); chỉ số giờ sửa đơn là chỉnh được ở đây.
import { z } from 'zod';
import { db, json } from './db';
import { fmt } from './money';
import { shippingHeadline } from './settings';
import type { Settings } from './types';

export type InfoDefaults = {
  description: string;
  gift: string;
  warm_tip_framed: string;
  warm_tip_unframed: string;
  tips: string[];
  edit_hours: number;
};
/** Phần sản phẩm ghi đè; null / thiếu = dùng mặc định. */
export type ProductInfo = { description?: string | null; gift?: string | null; warm_tip?: string | null; tips?: string[] | null };

/** Một đoạn chữ: `**đậm**` và các token {product} {shop} {support_email} {production_days} đã được thay. */
export type Seg = { text: string; bold?: boolean; href?: string };
export type Rich = Seg[];
export type ResolvedInfo = {
  paragraphs: Rich[];
  sizesLabel: string;
  sizes: string[];
  gift: Rich[];
  warmTip: Rich | null;
  tips: Rich[];
  shipping: Rich[];
};

export const INFO_DEFAULTS: InfoDefaults = {
  description:
    '**{product}** starts with a photo of your pet. We rebuild it as a pearl mosaic and show you the preview **before you pay**, so you know how your pet will look.\n\n' +
    'Each piece is **made to order** for you, and someone on our team checks every design before it goes into production.',
  gift: 'A gift for the people who love their pets: a birthday or Christmas surprise, a housewarming present, or a gentle way to remember a companion who has crossed the rainbow bridge.',
  warm_tip_framed: 'This piece arrives in its frame, ready to hang the day it lands. There is nothing extra to buy.',
  warm_tip_unframed: 'The frame is sold separately. Pick one in the add-ons above if you would like it ready to hang.',
  tips: [
    'Choose a photo where your pet\'s face is sharp and fills most of the picture. Daylight from a window works best.',
    'Pick the style and size first. The price at the top updates as you go.',
    'Look closely at the preview. If something is not right, choose a designer finish instead.',
    'Check the spelling of your pet\'s name before you add it to the cart.',
    'Ordering for a holiday? Allow **{production_days} days** for us to make it, plus shipping.',
  ],
  edit_hours: 4,
};

const text = (max: number) => z.string().trim().max(max);
/** Danh sách tip: mảng, hoặc 1 chuỗi mỗi dòng 1 tip (form admin gửi textarea dạng text, không tách theo dấu phẩy). */
const tipList = z.preprocess(
  (v) => (typeof v === 'string' ? v.split('\n').map((x) => x.trim()).filter(Boolean) : v),
  z.array(text(300).min(1)).max(12),
);
const optional = <T extends z.ZodType>(s: T) => z.preprocess((v) => (v === '' || (Array.isArray(v) && !v.length) ? null : v), s.nullable().optional());

export const infoDefaultsSchema = z.object({
  description: text(3000).min(1),
  gift: text(1000),
  warm_tip_framed: text(500),
  warm_tip_unframed: text(500),
  tips: tipList,
  edit_hours: z.number().int().min(0).max(168),
}).strict() satisfies z.ZodType<InfoDefaults>;

export const productInfoSchema = z.object({
  description: optional(text(3000)),
  gift: optional(text(1000)),
  warm_tip: optional(text(500)),
  tips: optional(tipList),
}).strict();

export function getInfoDefaults(): InfoDefaults {
  const row = db().prepare("SELECT value FROM settings WHERE key = 'pdp_info'").get() as { value: string } | undefined;
  return { ...INFO_DEFAULTS, ...json<Partial<InfoDefaults>>(row?.value, {}) };
}

export function setInfoDefaults(v: InfoDefaults) {
  db().prepare("INSERT INTO settings (key, value) VALUES ('pdp_info', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(JSON.stringify(v));
}

export function getProductInfo(productId: number): ProductInfo {
  const row = db().prepare('SELECT info_tabs FROM products WHERE id = ?').get(productId) as { info_tabs: string | null } | undefined;
  return json<ProductInfo>(row?.info_tabs, {});
}

/** Lưu phần ghi đè; bỏ các field null để cột chỉ giữ cái thật sự khác mặc định. Trả false nếu không có sản phẩm. */
export function setProductInfo(productId: number, v: ProductInfo): boolean {
  const kept = Object.fromEntries(Object.entries(v).filter(([, x]) => x != null));
  const value = Object.keys(kept).length ? JSON.stringify(kept) : null;
  return db().prepare('UPDATE products SET info_tabs = ? WHERE id = ?').run(value, productId).changes > 0;
}

const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

/** "12×12" (inch, như seed) → "12×12 in (30×30 cm)"; chuỗi lạ giữ nguyên. */
export function sizeLabel(size: string): { label: string; square: boolean } {
  const m = size.trim().match(/^(\d+(?:\.\d+)?)\s*[×x]\s*(\d+(?:\.\d+)?)(?:\s*(?:in|")\.?)?$/i);
  if (!m) return { label: size, square: false };
  const [w, h] = [Number(m[1]), Number(m[2])];
  const cm = (n: number) => Math.round(n * 2.54);
  return { label: `${w}×${h} in (${cm(w)}×${cm(h)} cm)`, square: w === h };
}

/** `**đậm**` + token → các đoạn. {support_email} thành link mailto. */
export function rich(src: string, vars: Record<string, string>): Rich {
  const out: Rich = [];
  const push = (seg: Seg) => {
    const last = out.at(-1);
    if (last && !seg.href && !last.href && !!last.bold === !!seg.bold) last.text += seg.text;
    else if (seg.text) out.push(seg);
  };
  src.split(/(\*\*[^*]+?\*\*)/).forEach((part) => {
    const bold = part.length > 4 && part.startsWith('**') && part.endsWith('**');
    const body = bold ? part.slice(2, -2) : part;
    body.split(/(\{\w+\})/).forEach((t) => {
      const key = t.match(/^\{(\w+)\}$/)?.[1];
      if (key === 'support_email' && vars.support_email) push({ text: vars.support_email, href: `mailto:${vars.support_email}`, ...(bold && { bold }) });
      else push({ text: key && key in vars ? vars[key] : t, ...(bold && { bold }) });
    });
  });
  return out;
}

export function resolveInfo(input: {
  product: { title: string; frame_included: 0 | 1 | number; variants: { size: string }[] };
  override: ProductInfo;
  defaults: InfoDefaults;
  settings: Settings;
  /** Có add-on khung đang bán cho sản phẩm này không (không gợi ý thứ không có). */
  hasFrameAddon: boolean;
}): ResolvedInfo {
  const { product, override: o, defaults: d, settings: s } = input;
  const vars = {
    product: product.title,
    shop: s.shop.name,
    support_email: s.shop.support_email,
    production_days: String(s.shipping.production_days),
  };
  const r = (t: string) => rich(t, vars);
  const paras = (t: string) => t.split(/\n\s*\n/).map((x) => x.trim()).filter(Boolean).map(r);

  const sizes = product.variants.map((v) => sizeLabel(v.size));
  const n = sizes.length;
  const square = n > 0 && sizes.every((x) => x.square);
  const sizesLabel = `Available in ${WORDS[n] ?? n} ${square ? 'square ' : ''}size${n === 1 ? '' : 's'}:`;

  const tip = o.warm_tip ?? (product.frame_included ? d.warm_tip_framed : input.hasFrameAddon ? d.warm_tip_unframed : '');

  const sh = s.shipping;
  const pd = sh.production_days;
  const range = (m: { min_days: number; max_days: number }) => `${pd + m.min_days}–${pd + m.max_days}`;
  const intl = sh.regions.some((x) => x.toUpperCase() !== 'US');
  const shipping = [
    `**Estimated delivery:** ${range(sh.standard)} days with Standard or ${range(sh.express)} days with Express, including ${plural(pd, 'day')} to make your piece after you approve the preview. Carriers do not deliver on most weekends and public holidays, so those can add a day or two.`,
    `**Changes or cancellations:** email {support_email} within ${plural(d.edit_hours, 'hour')} of ordering and we will update or cancel it. After that your piece may already be in production.`,
    sh.free_over_cents != null
      ? `**Free shipping:** ${shippingHeadline(s)}. Below that, Standard is ${fmt(sh.standard.price_cents, s.shop.currency)}.`
      : `**Shipping:** ${shippingHeadline(s)}. Standard is ${fmt(sh.standard.price_cents, s.shop.currency)}, Express ${fmt(sh.express.price_cents, s.shop.currency)}.`,
    '**Tracking:** we email you as soon as your order ships, with its tracking number.',
    ...(intl ? ['**International orders** can take longer to arrive while they clear customs.'] : []),
    '**Returns:** every piece is made to order, so we cannot take change-of-mind returns. If it arrives damaged or does not match the preview you approved, email {support_email} and we will reprint it or refund you.',
  ];

  return {
    paragraphs: paras(o.description ?? d.description),
    sizesLabel,
    sizes: sizes.map((x) => x.label),
    gift: paras(o.gift ?? d.gift),
    warmTip: tip.trim() ? r(tip.trim()) : null,
    tips: (o.tips ?? d.tips).map(r),
    shipping: shipping.map(r),
  };
}
