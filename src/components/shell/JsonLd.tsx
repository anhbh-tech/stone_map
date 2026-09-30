import { ldJson } from '@/lib/seo';

/** <script type="application/ld+json"> an toàn (thoát "<"). Dùng được ở mọi page/layout server. */
export function JsonLd({ data }: { data: unknown }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: ldJson(data) }} />;
}
