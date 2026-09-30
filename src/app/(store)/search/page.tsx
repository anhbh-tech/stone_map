import type { Metadata } from 'next';
import Link from 'next/link';
import { SEARCH_SORTS, ftsQuery, listCollections, listProducts, parseListQuery } from '@/lib/listing';
import { Pagination } from '@/components/listing/Pagination';
import { ProductGrid } from '@/components/listing/ProductCard';
import { SortSelect } from '@/components/listing/SortSelect';
import { SearchBox } from '@/components/nav/SearchBox';
import { UiIcon } from '@/components/nav/icons';

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const q = String((await searchParams).q ?? '').trim();
  return { title: q ? `Search: ${q.slice(0, 60)}` : 'Search', robots: { index: false, follow: true } };
}

// Từ gợi ý khi chưa gõ / không có kết quả: lấy từ chính tag trong catalog, không bịa "tìm nhiều nhất".
const IDEAS = ['Christmas', 'Memorial', 'DIY kit', 'Cat', 'Ornament'];

function Ideas() {
  const cols = listCollections().filter((c) => c.count > 0);
  return (
    <div className="mt-10 grid gap-10 md:grid-cols-2">
      <section aria-labelledby="try">
        <h2 id="try" className="font-sans text-base font-semibold">Try searching for</h2>
        <ul className="mt-3 flex flex-wrap gap-2">
          {IDEAS.map((w) => (
            <li key={w}>
              <Link href={`/search?q=${encodeURIComponent(w)}`} className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-border bg-card px-4 text-sm font-medium hover:border-foreground">
                <UiIcon name="search" size={14} className="text-muted-foreground" />{w}
              </Link>
            </li>
          ))}
        </ul>
      </section>
      <section aria-labelledby="browse">
        <h2 id="browse" className="font-sans text-base font-semibold">Or browse a collection</h2>
        <ul className="mt-3 divide-y divide-border border-y border-border">
          {cols.map((c) => (
            <li key={c.id}>
              <Link href={`/collections/${c.handle}`} className="flex min-h-12 items-center justify-between gap-3 text-foreground hover:text-accent">
                {c.title}<span className="flex items-center gap-2 text-sm text-muted-foreground">{c.count}<UiIcon name="chevronRight" size={16} /></span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

export default async function SearchPage({ searchParams }: Props) {
  const sp = await searchParams;
  const q = String(Array.isArray(sp.q) ? sp.q[0] : sp.q ?? '').trim().slice(0, 100);
  const state = { ...parseListQuery(sp, SEARCH_SORTS), theme: [], type: [], price: null, q };
  const fts = ftsQuery(q);
  const res = fts ? listProducts({ fts }, state) : null;

  return (
    <div className="mx-auto max-w-6xl px-4 pb-16 pt-8">
      <h1 className="text-4xl font-semibold text-balance md:text-5xl">{q ? <>Results for “{q}”</> : 'Search the shop'}</h1>
      <div className="mt-6 max-w-2xl"><SearchBox variant="page" defaultQuery={q} key={q} /></div>

      {!q && <Ideas />}

      {q && res && res.total > 0 && (
        <>
          <div className="mt-8 flex flex-wrap items-center justify-between gap-3 border-y border-border py-2">
            <p role="status" className="text-sm text-muted-foreground" data-testid="result-count">
              {res.total} {res.total === 1 ? 'result' : 'results'}
            </p>
            <SortSelect value={state.sort} options={SEARCH_SORTS} hidden={[['q', q]]} />
          </div>
          <div className="mt-6"><ProductGrid items={res.items} label="Search results" /></div>
          <Pagination path="/search" state={state} page={res.page} pages={res.pages} />
        </>
      )}

      {q && (!res || res.total === 0) && (
        <div className="mt-8" data-testid="search-empty">
          <p role="status" className="text-lg">
            No products match <strong>“{q}”</strong>.
          </p>
          <p className="mt-2 text-muted-foreground">Check the spelling, use fewer words, or try one of these.</p>
          <Ideas />
        </div>
      )}
    </div>
  );
}
