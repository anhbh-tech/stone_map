// JSON-LD + meta dùng chung (crew D mở rộng: Breadcrumb, Organization). Không sinh meta từ mô tả thô (#9).
import type { Product } from './catalog';
import type { Settings } from './types';

export function metaDescription(p: Pick<Product, 'meta_description' | 'subtitle' | 'title'>) {
  return (p.meta_description || p.subtitle || p.title).slice(0, 160);
}

export function productJsonLd(p: Product, s: Settings, url: string) {
  const prices = p.variants.map((v) => v.price_cents);
  const ld: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: p.title,
    description: metaDescription(p),
    image: p.images.map((i) => new URL(i.url, url).toString()),
    brand: { '@type': 'Brand', name: s.shop.name },
    offers: {
      '@type': 'AggregateOffer',
      priceCurrency: s.shop.currency,
      lowPrice: (Math.min(...prices) / 100).toFixed(2),
      highPrice: (Math.max(...prices) / 100).toFixed(2),
      offerCount: p.variants.length,
      availability: 'https://schema.org/InStock',
    },
  };
  // Chỉ khai báo điểm review khi có số thật (claims null = không có).
  if (s.claims.rating != null && s.claims.reviews_count) {
    ld.aggregateRating = { '@type': 'AggregateRating', ratingValue: s.claims.rating, reviewCount: s.claims.reviews_count };
  }
  return ld;
}
