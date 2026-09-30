import type { MetadataRoute } from 'next';
import { absUrl } from '@/lib/seo';

export const dynamic = 'force-dynamic';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: '*', allow: '/', disallow: ['/admin', '/api/', '/cart', '/checkout', '/orders/'] },
    sitemap: absUrl('/sitemap.xml'),
  };
}
