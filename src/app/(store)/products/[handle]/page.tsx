// PDP (RSC; <main> do layout (store) của crew D bọc): đọc catalog/settings/reviews ở server, chỉ phần personalizer là client (#8). Đúng 1 <h1> (#9).
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { addonsFor, bundleTiers, getProduct } from '@/lib/catalog';
import { getSettings } from '@/lib/settings';
import { metaDescription, productJsonLd } from '@/lib/seo';
import { listReviews, reviewSummary } from '@/lib/reviews';
import { Gallery } from '@/components/pdp/Gallery';
import { Delivery } from '@/components/pdp/Delivery';
import { InfoTabs } from '@/components/pdp/InfoTabs';
import { BulkDiscounts } from '@/components/pdp/BulkDiscounts';
import { RatingLink, Reviews } from '@/components/pdp/Reviews';
import { pickVariant } from '@/components/pdp/logic';
import { Personalizer } from '@/components/personalizer/Personalizer';
import { MAX_QTY } from '@/lib/cart';
import { Breadcrumbs } from '@/components/shell/Breadcrumbs';
import { themeForProduct } from '@/lib/personalize/engine';

type Props = {
  params: Promise<{ handle: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

// Row của node:sqlite có prototype null → phải thành object thường trước khi truyền sang Client Component.
const plain = <T extends object>(row: T): T => ({ ...row });
const siteUrl = () => process.env.SITE_URL || 'http://localhost:3000';

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { handle } = await params;
  const p = getProduct(handle);
  if (!p) return { title: 'Product not found', robots: { index: false } };
  const description = metaDescription(p);
  const path = `/products/${p.handle}`;
  return {
    title: { absolute: p.meta_title || `${p.title} | ${getSettings().shop.name}` },
    description,
    alternates: { canonical: path },
    openGraph: {
      title: p.meta_title || p.title,
      description,
      url: path,
      type: 'website',
      images: p.images.filter((i) => i.kind === 'gallery').slice(0, 1).map((i) => ({ url: i.url, alt: i.alt })),
    },
  };
}

export default async function ProductPage({ params, searchParams }: Props) {
  const [{ handle }, sp] = await Promise.all([params, searchParams]);
  const product = getProduct(handle);
  if (!product || !product.variants.length) notFound();

  const settings = getSettings();
  const summary = reviewSummary(product.id);
  const reviews = listReviews(product.id);
  const variant = pickVariant(product.variants, sp.variant);
  const url = new URL(`/products/${product.handle}`, siteUrl()).toString();
  const jsonLd = productJsonLd(product, settings, url, summary);

  return (
    <div className="mx-auto w-full max-w-7xl flex-1 px-4 pb-16 sm:px-6 lg:px-8">
      {/* JSON-LD Product đứng trước BreadcrumbList. */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }} />
      <Breadcrumbs items={[{ name: product.title, path: `/products/${product.handle}` }]} className="py-2 lg:py-3" />
      {/* Desktop: cột ảnh ~55%, ảnh chính vuông tối đa 70vh, dính dưới header (cao ~121px). */}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,11fr)_minmax(0,9fr)] lg:gap-12 xl:gap-16">
        <div className="min-w-0 lg:sticky lg:top-[8.5rem] lg:self-start">
          <Gallery images={product.images.map(plain)} title={product.title} />
        </div>
        <div className="min-w-0">
          <Personalizer
            header={
              <header className="space-y-1.5">
                <h1 className="text-[2rem] leading-tight sm:text-[2.5rem]">{product.title}</h1>
                {product.subtitle && <p className="text-base text-muted-foreground sm:text-lg">{product.subtitle}</p>}
                <RatingLink summary={summary} />
              </header>
            }
            product={{ id: product.id, title: product.title }}
            variants={product.variants.map(plain)}
            initialVariantId={variant.id}
            tiers={bundleTiers().map(plain)}
            addons={addonsFor(product).map(plain)}
            maxQty={MAX_QTY}
            theme={themeForProduct(product.id)}
            settings={{
              shopName: settings.shop.name,
              currency: settings.shop.currency,
              styles: settings.ai.styles,
              privacy: settings.privacy,
              preflight: settings.preflight,
            }}
            delivery={<Delivery settings={settings} />}
          />
          <BulkDiscounts />
          <InfoTabs product={product} className="mt-8" />
        </div>
      </div>

      <section aria-labelledby="details-title" className="mt-16 max-w-prose border-t border-border pt-10">
        <h2 id="details-title" className="text-3xl font-semibold">Details</h2>
        {/* description_html do admin nhập (crew A), không phải nội dung người dùng */}
        <div className="mt-4 space-y-3 [&_li]:ml-5 [&_ul]:list-disc" dangerouslySetInnerHTML={{ __html: product.description_html }} />
      </section>

      <div className="mt-16">
        <Reviews summary={summary} reviews={reviews} />
      </div>
    </div>
  );
}
