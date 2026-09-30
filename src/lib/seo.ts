// JSON-LD + meta dùng chung (crew D mở rộng: Breadcrumb, Organization). Không sinh meta từ mô tả thô (#9).
import type { Product } from './catalog';
import type { Settings } from './types';
import type { ReviewSummary } from './reviews';

export function metaDescription(p: Pick<Product, 'meta_description' | 'subtitle' | 'title'>) {
  return (p.meta_description || p.subtitle || p.title).slice(0, 160);
}

export function productJsonLd(p: Product, s: Settings, url: string, reviews?: ReviewSummary) {
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
  // Điểm review chỉ từ reviewSummary() và không bao giờ khi còn review mẫu.
  if (reviews && reviews.count && reviews.average != null && !reviews.has_samples) {
    ld.aggregateRating = { '@type': 'AggregateRating', ratingValue: reviews.average, reviewCount: reviews.count };
  }
  return ld;
}
