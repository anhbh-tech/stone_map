import type { MetadataRoute } from 'next';
import { listProducts } from '@/lib/catalog';
import { absUrl } from '@/lib/seo';

// Sinh theo catalog hiện tại (admin thêm/lưu trữ sản phẩm là sitemap đổi theo) → không cache lúc build.
export const dynamic = 'force-dynamic';

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: absUrl('/'), changeFrequency: 'weekly', priority: 1 },
    ...listProducts().map((p) => ({ url: absUrl(`/products/${p.handle}`), changeFrequency: 'weekly' as const, priority: 0.9 })),
    ...['shipping', 'refund', 'privacy'].map((p) => ({ url: absUrl(`/policies/${p}`), changeFrequency: 'monthly' as const, priority: 0.3 })),
  ];
}
