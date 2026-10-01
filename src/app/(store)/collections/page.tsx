import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { listCollections, listProducts } from '@/lib/listing';
import { Breadcrumbs } from '@/components/shell/Breadcrumbs';
import { UiIcon } from '@/components/nav/icons';
import { ProductGrid } from '@/components/listing/ProductCard';

export const metadata: Metadata = {
  title: 'Shop by collection',
  description: 'Browse pearl pet portraits by occasion: Christmas, memorial keepsakes, DIY pearl kits and small gifts.',
  alternates: { canonical: '/collections' },
};

export default function CollectionsPage() {
  const cols = listCollections().filter((c) => c.count > 0);
  const all = listProducts({ collectionId: null }, { theme: [], type: [], price: null, sort: 'featured', page: 1 }, 12);
  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 pb-16 pt-4">
      <Breadcrumbs items={[{ name: 'Collections', path: '/collections' }]} />
      <h1 className="mt-4 text-4xl font-semibold text-balance md:text-5xl">Shop by collection</h1>
      <p className="mt-3 max-w-prose text-muted-foreground">Every piece starts from a photo of your pet. Pick the occasion, then the style.</p>

      {/* < 640: lưới 2 cột ô vuông gọn (6 collection ≈ 1,5 màn hình thay vì 6); từ sm: thẻ 4:3 kèm mô tả. */}
      <ul className="mt-8 grid grid-cols-2 gap-x-3 gap-y-6 sm:mt-10 sm:gap-x-5 sm:gap-y-10 lg:grid-cols-3">
        {cols.map((c, i) => (
          <li key={c.id} className="group relative">
            <div className="relative aspect-square overflow-hidden sm:aspect-[4/3] rounded-[var(--radius)] border border-border bg-muted">
              {c.cover && (
                <Image src={c.cover.url} alt={c.cover.alt} fill preload={i < 3} sizes="(min-width: 1024px) 360px, 50vw"
                  className="object-cover transition-transform duration-500 ease-out group-hover:scale-[1.03]" />
              )}
            </div>
            <h2 className="mt-3 flex items-center justify-between gap-2 text-lg font-semibold leading-tight sm:mt-4 sm:gap-3 sm:text-2xl">
              <Link href={`/collections/${c.handle}`} className="after:absolute after:inset-0 after:rounded-[var(--radius)] focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-offset-2 focus-visible:after:outline-ring">
                {c.title}
              </Link>
              <UiIcon name="chevronRight" size={20} className="hidden shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 sm:block" />
            </h2>
            {c.description && <p className="mt-1 hidden text-sm text-muted-foreground sm:block">{c.description}</p>}
            <p className="mt-1 text-sm text-muted-foreground sm:mt-2 sm:font-medium sm:text-foreground">{c.count} {c.count === 1 ? 'product' : 'products'}</p>
          </li>
        ))}
      </ul>

      <section className="mt-14 border-t border-border pt-8" aria-labelledby="all-products">
        <h2 id="all-products" className="mb-6 text-2xl font-semibold">All products</h2>
        <ProductGrid items={all.items} label="All products" />
      </section>

      <div className="mt-10 flex flex-wrap items-center justify-between gap-4">
        <p className="text-muted-foreground">Filter by style, size and price on the full list.</p>
        <Link href="/collections/all" className="inline-flex min-h-12 items-center gap-2 rounded-full border border-input bg-background px-6 font-medium hover:bg-muted">
          All products ({all.total}) <UiIcon name="chevronRight" size={18} />
        </Link>
      </div>
    </div>
  );
}
