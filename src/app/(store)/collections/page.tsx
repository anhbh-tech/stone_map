import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { listCollections, listProducts } from '@/lib/listing';
import { Breadcrumbs } from '@/components/shell/Breadcrumbs';
import { UiIcon } from '@/components/nav/icons';

export const metadata: Metadata = {
  title: 'Shop by collection',
  description: 'Browse pearl pet portraits by occasion: Christmas, memorial keepsakes, DIY pearl kits and small gifts.',
  alternates: { canonical: '/collections' },
};

export default function CollectionsPage() {
  const cols = listCollections().filter((c) => c.count > 0);
  const all = listProducts({ collectionId: null }, { theme: [], type: [], price: null, sort: 'featured', page: 1 }, 1);
  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 pb-16 pt-4">
      <Breadcrumbs items={[{ name: 'Collections', path: '/collections' }]} />
      <h1 className="mt-4 text-4xl font-semibold text-balance md:text-5xl">Shop by collection</h1>
      <p className="mt-3 max-w-prose text-muted-foreground">Every piece starts from a photo of your pet. Pick the occasion, then the style.</p>

      <ul className="mt-10 grid gap-x-5 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
        {cols.map((c, i) => (
          <li key={c.id} className="group relative">
            <div className="relative aspect-[4/3] overflow-hidden rounded-[var(--radius)] border border-border bg-muted">
              {c.cover && (
                <Image src={c.cover.url} alt={c.cover.alt} fill preload={i < 3} sizes="(min-width: 1024px) 360px, (min-width: 640px) 50vw, 100vw"
                  className="object-cover transition-transform duration-500 ease-out group-hover:scale-[1.03]" />
              )}
            </div>
            <h2 className="mt-4 flex items-center justify-between gap-3 text-2xl font-semibold">
              <Link href={`/collections/${c.handle}`} className="after:absolute after:inset-0 after:rounded-[var(--radius)] focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-offset-2 focus-visible:after:outline-ring">
                {c.title}
              </Link>
              <UiIcon name="chevronRight" size={20} className="shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
            </h2>
            {c.description && <p className="mt-1 text-sm text-muted-foreground">{c.description}</p>}
            <p className="mt-2 text-sm font-medium text-foreground">{c.count} {c.count === 1 ? 'product' : 'products'}</p>
          </li>
        ))}
      </ul>

      <div className="mt-14 flex flex-wrap items-center justify-between gap-4 border-t border-border pt-8">
        <p className="text-muted-foreground">Not sure where to start? See the whole shop in one place.</p>
        <Link href="/collections/all" className="inline-flex min-h-12 items-center gap-2 rounded-full border border-input bg-background px-6 font-medium hover:bg-muted">
          All products ({all.total}) <UiIcon name="chevronRight" size={18} />
        </Link>
      </div>
    </div>
  );
}
