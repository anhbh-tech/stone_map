import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ALL_COLLECTION, COLLECTION_SORTS, facets, getCollection, listProducts, parseListQuery } from '@/lib/listing';
import { Crumbs } from '@/components/listing/Crumbs';
import { ActiveFilters, FilterPanel, activeCount } from '@/components/listing/Filters';
import { Pagination } from '@/components/listing/Pagination';
import { ProductGrid } from '@/components/listing/ProductCard';
import { SortSelect } from '@/components/listing/SortSelect';
import { listHref } from '@/components/listing/urls';
import { UiIcon } from '@/components/nav/icons';
import Link from 'next/link';

type Props = { params: Promise<{ handle: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

const find = (handle: string) => (handle === 'all' ? ALL_COLLECTION : getCollection(handle));

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const c = find((await params).handle);
  if (!c) return {};
  const sp = await searchParams;
  // Trang đã lọc / sắp xếp / trang 2+ trỏ canonical về trang gốc và không index (tránh trùng lặp).
  const variant = Object.keys(sp).some((k) => ['theme', 'type', 'price', 'sort', 'page'].includes(k));
  return {
    title: c.title,
    description: c.description ?? `Shop ${c.title.toLowerCase()} pearl pet portraits.`,
    alternates: { canonical: `/collections/${c.handle}` },
    ...(variant ? { robots: { index: false, follow: true } } : {}),
  };
}

export default async function CollectionPage({ params, searchParams }: Props) {
  const c = find((await params).handle);
  if (!c) notFound();
  const state = parseListQuery(await searchParams, COLLECTION_SORTS);
  const scope = { collectionId: c.handle === 'all' ? null : c.id };
  const res = listProducts(scope, state);
  const f = facets(scope);
  const path = `/collections/${c.handle}`;
  const hidden: [string, string][] = [...state.theme.map((v) => ['theme', v] as [string, string]), ...state.type.map((v) => ['type', v] as [string, string]), ...(state.price ? [['price', state.price] as [string, string]] : [])];
  const n = activeCount(state);

  return (
    <div className="mx-auto max-w-6xl px-4 pb-16 pt-4">
      <Crumbs items={[{ name: 'Home', path: '/' }, { name: 'Collections', path: '/collections' }, { name: c.title, path }]} />
      <h1 className="mt-4 text-4xl font-semibold text-balance md:text-5xl">{c.title}</h1>
      {c.description && <p className="mt-3 max-w-prose text-muted-foreground">{c.description}</p>}

      <div className="mt-8 lg:grid lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-10">
        <aside aria-label="Filters" className="hidden lg:block">
          <h2 className="sr-only">Filter</h2>
          <div><FilterPanel path={path} state={state} theme={f.theme} type={f.type} /></div>
        </aside>

        <div className="min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-3 border-y border-border py-2">
            <p role="status" className="text-sm text-muted-foreground" data-testid="result-count">
              {res.total} {res.total === 1 ? 'product' : 'products'}
            </p>
            <SortSelect value={state.sort} options={COLLECTION_SORTS} hidden={hidden} />
          </div>

          <details className="group/f mt-3 rounded-[var(--radius)] border border-border bg-card lg:hidden" open={n > 0 || undefined}>
            <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-2 px-4 font-medium [&::-webkit-details-marker]:hidden">
              <span className="flex items-center gap-2"><UiIcon name="sliders" size={18} />Filter{n > 0 && <span className="rounded-full bg-accent px-2 text-xs font-semibold leading-5 text-on-accent">{n}</span>}</span>
              <UiIcon name="chevronDown" size={18} className="transition-transform group-open/f:rotate-180" />
            </summary>
            <div className="border-t border-border p-4"><FilterPanel path={path} state={state} theme={f.theme} type={f.type} /></div>
          </details>

          {n > 0 && <div className="mt-4"><ActiveFilters path={path} state={state} /></div>}

          <div className="mt-6">
            {res.items.length ? <ProductGrid items={res.items} label={`${c.title} products`} /> : (
              <div className="rounded-[var(--radius)] border border-dashed border-border px-6 py-14 text-center">
                <p className="text-xl font-semibold">Nothing matches these filters</p>
                <p className="mt-2 text-muted-foreground">Try removing a filter, or see everything in {c.title}.</p>
                <Link href={listHref(path, { ...state, theme: [], type: [], price: null })} className="mt-6 inline-flex min-h-12 items-center rounded-md bg-primary px-5 font-semibold text-on-primary hover:opacity-90">
                  Clear filters
                </Link>
              </div>
            )}
          </div>
          <Pagination path={path} state={state} page={res.page} pages={res.pages} />
        </div>
      </div>
    </div>
  );
}
