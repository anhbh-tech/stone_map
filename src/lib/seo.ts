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

// ── Crew D: Organization / WebSite / Breadcrumb + URL tuyệt đối cho canonical, sitemap, robots.

/** Gốc site cho URL tuyệt đối (JSON-LD, sitemap). Cùng nguồn với metadataBase ở app/layout.tsx. */
export const siteUrl = () => (process.env.SITE_URL || 'http://localhost:3000').replace(/\/+$/, '');
export const absUrl = (p: string) => new URL(p, siteUrl() + '/').toString();

export function organizationJsonLd(s: Settings) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: s.shop.name,
    url: absUrl('/'),
    email: s.shop.support_email,
    contactPoint: { '@type': 'ContactPoint', contactType: 'customer support', email: s.shop.support_email, areaServed: s.shipping.regions },
  };
}

export function websiteJsonLd(s: Settings) {
  return { '@context': 'https://schema.org', '@type': 'WebSite', name: s.shop.name, url: absUrl('/') };
}

/** items: [{ name: 'Home', path: '/' }, …] — mục cuối là trang hiện tại. */
export function breadcrumbJsonLd(items: { name: string; path: string }[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((it, i) => ({ '@type': 'ListItem', position: i + 1, name: it.name, item: absUrl(it.path) })),
  };
}

/** JSON cho <script type="application/ld+json">: thoát "<" để chuỗi trong DB không phá được thẻ script. */
export const ldJson = (data: unknown) => JSON.stringify(data).replace(/</g, '\\u003c');
