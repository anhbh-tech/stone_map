// Kiểm dữ liệu vào cho mọi route ghi của admin. Tiền là cent nguyên (form đổi $ → cent trước khi gửi).
import { z } from 'zod';
import type { Settings } from '../../../lib/types';

const text = (max: number) => z.string().trim().min(1, 'Required').max(max, `At most ${max} characters`);
const optText = (max: number) =>
  z.string().trim().max(max, `At most ${max} characters`).nullish().transform((v) => (v ? v : null));
const cents = z.number().int('Whole cents only').positive('Must be more than $0');
const flag = z.union([z.boolean(), z.literal(0), z.literal(1)]).transform((v) => (v ? 1 : 0));

// ── Catalog
export const productCreate = z.object({
  handle: z.string().trim().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Lowercase letters, digits and dashes').max(80),
  title: text(70),
});
export const productPatch = z
  .object({
    title: text(70),                    // ngắn, không nhồi từ khoá (#9)
    subtitle: optText(200),
    description_html: z.string().max(20000).nullish().transform((v) => v ?? ''),
    meta_title: optText(70),
    meta_description: optText(160),     // viết tay, bắt buộc khi bán (#9)
    frame_included: flag,               // #3: 1 → add-on khung bị ẩn
    status: z.enum(['draft', 'active', 'archived']),
  })
  .partial();

// Lưu ý zod v4: .default() vẫn chạy bên trong .partial() → schema PATCH dựng từ bản không có default.
const variantBase = z.object({
  sku: text(40),
  size: text(20),
  price_cents: cents,
  compare_at_cents: cents.nullish().transform((v) => v ?? null),
  print_px: z.number().int().min(500, 'At least 500 px').max(12000, 'At most 12000 px'),
  position: z.number().int().min(0),
});
export const variantCreate = variantBase.extend({ product_id: z.number().int().positive(), position: z.number().int().min(0).default(0) });
export const variantPatch = variantBase.partial();

const imageBase = z.object({
  alt: text(250),                       // alt bắt buộc (#9)
  kind: z.enum(['gallery', 'mockup_scene']),
  position: z.number().int().min(0),
});
export const imageCreate = imageBase.extend({
  product_id: z.number().int().positive(),
  url: z.string().trim().min(1, 'Required').max(500).refine((u) => u.startsWith('/') || /^https:\/\//.test(u), 'Use a site path (/…) or an https:// URL'),
  kind: imageBase.shape.kind.default('gallery'),
  position: z.number().int().min(0).default(0),
});
export const imagePatch = imageBase.partial();

const addonBase = z.object({
  title: text(80),
  description: optText(300),
  kind: z.enum(['frame', 'card', 'protection', 'priority', 'care']),
  price_cents: z.number().int('Whole cents only').min(0, 'Cannot be negative'),
  text_input: flag,
  text_free: flag,
  active: flag,
  position: z.number().int().min(0),
});
export const addonCreate = addonBase.extend({
  handle: z.string().trim().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Lowercase letters, digits and dashes').max(60),
  text_input: flag.default(0),
  text_free: flag.default(1),
  active: flag.default(1),
  position: z.number().int().min(0).default(0),
});
export const addonPatch = addonBase.partial();

export const tierCreate = z.object({
  min_qty: z.number().int().min(2, 'Bundles start at 2 items').max(100),
  percent_off: z.number().int().min(0).max(90, 'At most 90%'),
});
export const tierPatch = tierCreate.partial();

// ── Settings (#3: nguồn sự thật duy nhất). Mỗi key 1 schema; `satisfies` giữ khớp với src/lib/types.ts.
const days = z.number().int().min(0).max(120);
const method = z.object({ price_cents: z.number().int().min(0), min_days: days, max_days: days })
  .refine((m) => m.max_days >= m.min_days, { message: 'Max days must be ≥ min days', path: ['max_days'] });

export const settingsSchemas = {
  shop: z.object({ name: text(80), support_email: z.email('Enter a valid email'), currency: z.literal('USD') }),
  shipping: z.object({
    regions: z.array(z.string().trim().min(2).max(40)).min(1, 'At least one region'),
    free_over_cents: z.number().int().positive().nullable(),
    standard: method,
    express: method,
    production_days: days,
  }),
  claims: z.object({
    customers_count: z.number().int().min(0).nullable(),
    rating: z.number().min(1).max(5).nullable(),
    reviews_count: z.number().int().min(0).nullable(),
  }),
  privacy: z.object({
    retention_days: z.number().int().min(1).max(3650),
    processors: z.array(z.string().trim().min(1).max(120)),
    policy_path: z.string().trim().regex(/^\/[\w\-/]*$/, 'Site path starting with /'),
  }),
  ai: z.object({
    provider: z.enum(['mock', 'gemini', 'openai']),
    model: text(80),
    mock_ms: z.number().int().min(0).max(600000),
    styles: z.array(z.object({ id: z.string().trim().regex(/^[a-z0-9-]+$/, 'id: lowercase, digits, dashes'), name: text(60) })).min(1, 'At least one style'),
  }),
  preflight: z.object({
    min_side_px: z.number().int().min(100).max(10000),
    min_sharpness: z.number().min(0).max(10000),
    min_pet_confidence: z.number().min(0).max(1),
  }),
} satisfies { [K in keyof Settings]: z.ZodType<Settings[K]> };

export const isSettingsKey = (k: string): k is keyof Settings => Object.hasOwn(settingsSchemas, k);

// ── Vận hành
export const ORDER_STATUSES = ['paid', 'in_production', 'shipped', 'delivered', 'refunded', 'canceled'] as const;
export const orderPatch = z.object({ status: z.enum(ORDER_STATUSES) });
// in_review = giao lại cho designer (AI không đạt); assignee_id null = bỏ giao.
export const designPatch = z.object({
  status: z.enum(['approved', 'rejected', 'in_review']).optional(),
  assignee_id: z.number().int().positive().nullable().optional(),
}).refine((v) => v.status !== undefined || v.assignee_id !== undefined, { message: 'Nothing to update' });

export const orderFulfill = z.object({
  carrier: optText(60),
  tracking_number: optText(80),
  tracking_url: optText(500).refine((u) => !u || /^https:\/\//.test(u), 'Use an https:// link'),
  notify: flag.default(0),
});
export const orderComment = z.object({ message: text(2000) });

// ── Discounts. Ngày nhập dạng YYYY-MM-DD (UTC): bắt đầu 00:00, kết thúc hết ngày đó.
const day = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD').nullish().transform((v) => v || null);
const discountBase = z.object({
  kind: z.enum(['percent', 'fixed', 'free_shipping']),
  value: z.number().int('Whole numbers only').min(0),
  min_subtotal_cents: cents.nullish().transform((v) => v ?? null),
  min_qty: z.number().int().min(1).max(100).nullish().transform((v) => v ?? null),
  starts_at: day,
  ends_at: day,
  usage_limit: z.number().int().min(1).nullish().transform((v) => v ?? null),
  active: flag,
  show_on_pdp: flag,
});
const discountRules = <T extends { kind?: string; value?: number; starts_at?: string | null; ends_at?: string | null }>(v: T, ctx: z.RefinementCtx) => {
  if (v.kind === 'percent' && v.value !== undefined && (v.value < 1 || v.value > 100)) ctx.addIssue({ code: 'custom', path: ['value'], message: 'Percent must be 1–100' });
  if (v.kind === 'fixed' && v.value !== undefined && v.value < 1) ctx.addIssue({ code: 'custom', path: ['value'], message: 'Must be more than $0' });
  if (v.starts_at && v.ends_at && v.ends_at < v.starts_at) ctx.addIssue({ code: 'custom', path: ['ends_at'], message: 'End date must be on or after the start date' });
};
export const discountCreate = discountBase.extend({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9_-]{2,31}$/, '3–32 letters, digits, dashes'),
  active: flag.default(1),
  show_on_pdp: flag.default(0),
}).superRefine(discountRules);
export const discountPatch = discountBase.partial().superRefine(discountRules);

// ── Collections (bảng của UI-2; chỉ ghi các cột trong hợp đồng)
export const collectionCreate = z.object({
  handle: z.string().trim().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Lowercase letters, digits and dashes').max(80),
  title: text(80),
});
export const collectionPatch = z.object({
  title: text(80),
  description: optText(1000),
  image: optText(500).refine((u) => !u || u.startsWith('/') || /^https:\/\//.test(u), 'Use a site path (/…) or an https:// URL'),
  sort: z.number().int().min(0).max(10000),
}).partial();
export const collectionProducts = z.object({ product_ids: z.array(z.number().int().positive()).max(500) });

// ── Nhân viên
export const staffCreate = z.object({
  username: z.string().trim().toLowerCase().regex(/^[a-z0-9._-]{3,32}$/, '3–32 lowercase letters, digits, . _ -'),
  display_name: optText(80),
  password: z.string().min(8, 'At least 8 characters').max(200),
  role: z.enum(['owner', 'designer']).default('designer'),
});

export const REVIEW_STATUSES = ['pending', 'published', 'hidden'] as const;
// is_sample không có trong schema sửa: không bao giờ đổi được sau khi tạo (review thật không thể thành mẫu và ngược lại).
export const reviewPatch = z.object({ status: z.enum(REVIEW_STATUSES) }).strict();
export const reviewCreate = z.object({
  product_id: z.number().int().positive().nullable(),
  order_number: optText(20),            // có đơn → "Verified buyer"
  author: text(80),
  rating: z.number().int().min(1).max(5),
  title: optText(120),
  body: text(4000),
  photo_url: optText(500).refine((u) => !u || u.startsWith('/') || /^https:\/\//.test(u), 'Use a site path (/…) or an https:// URL'),
  status: z.enum(REVIEW_STATUSES).default('pending'),
}).strict();
