// Social proof (#4): mọi con số lấy từ bảng reviews. Review mẫu (is_sample) chỉ có ở dev và luôn mang nhãn.
import { db } from './db';

export type Review = { id: number; author: string; rating: number; title: string | null; body: string; photo_url: string | null; verified: boolean; is_sample: boolean; created_at: string };
export type ReviewSummary = { count: number; average: number | null; histogram: Record<1 | 2 | 3 | 4 | 5, number>; has_samples: boolean };

const samplesAllowed = () => process.env.NODE_ENV !== 'production';
const where = (productId?: number) =>
  `status = 'published'${samplesAllowed() ? '' : ' AND is_sample = 0'}${productId ? ' AND (product_id = ? OR product_id IS NULL)' : ''}`;

export function reviewSummary(productId?: number): ReviewSummary {
  const rows = db().prepare(`SELECT rating, is_sample FROM reviews WHERE ${where(productId)}`).all(...(productId ? [productId] : [])) as { rating: number; is_sample: number }[];
  const histogram = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } as ReviewSummary['histogram'];
  for (const r of rows) histogram[r.rating as 1] += 1;
  const average = rows.length ? Math.round((rows.reduce((n, r) => n + r.rating, 0) / rows.length) * 10) / 10 : null;
  return { count: rows.length, average, histogram, has_samples: rows.some((r) => r.is_sample) };
}

export function listReviews(productId?: number, limit = 12): Review[] {
  const rows = db().prepare(`SELECT * FROM reviews WHERE ${where(productId)} ORDER BY created_at DESC LIMIT ?`).all(...(productId ? [productId] : []), limit) as (Omit<Review, 'verified' | 'is_sample'> & { order_id: number | null; is_sample: number })[];
  return rows.map(({ order_id, is_sample, ...r }) => ({ ...r, verified: order_id != null, is_sample: !!is_sample }));
}
