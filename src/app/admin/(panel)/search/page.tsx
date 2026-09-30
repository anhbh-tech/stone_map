import type { Metadata } from 'next';
import Link from 'next/link';
import { fmt } from '@/lib/money';
import { requireAdminPage } from '../../_lib/session';
import { searchOrders } from '../../_lib/orders';
import { searchCustomers } from '../../_lib/customers';
import { searchProducts } from '../../_lib/repo';
import { DESIGN_TABS, searchDesigns } from '../../_lib/designs';
import { hrefWith, one, type SearchParams } from '../../_lib/list';
import { EmptyState, FulfillmentBadge, PageHeader, StatusBadge, linkCls } from '../../_components/ui';

export const metadata: Metadata = { title: 'Search' };

const N = 5;

function Group({ title, total, href, children }: { title: string; total: number; href: string; children: React.ReactNode }) {
  return (
    <section aria-label={title} className="rounded-[var(--radius)] border border-border bg-card">
      <div className="flex items-center justify-between gap-3 px-4 pt-4 sm:px-5">
        <h2 className="text-base font-semibold">{title} <span className="font-normal text-muted-foreground tnum">({total})</span></h2>
        {total > N && <Link href={href} className={`${linkCls} text-sm`}>See all {total}</Link>}
      </div>
      <ul className="mt-2 pb-2">{children}</ul>
    </section>
  );
}
const row = 'flex min-h-11 items-center gap-3 px-4 py-2 text-sm transition-colors duration-150 hover:bg-muted sm:px-5';

export default async function SearchPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requireAdminPage();
  const sp = await searchParams;
  const q = one(sp.q).trim().slice(0, 100);
  if (!q) {
    return (<><PageHeader title="Search" /><div className="rounded-[var(--radius)] border border-border bg-card"><EmptyState title="Search the whole admin">Use the search box at the top to find orders by number or email, customers, products by title or SKU, and designs by pet name or ID.</EmptyState></div></>);
  }
  const s = { q, sort: 'date' as const, dir: 'desc' as const, page: 1, per: N };
  const orders = searchOrders(s);
  const customers = searchCustomers({ ...s, sort: 'created' });
  const products = searchProducts({ ...s, sort: 'title', dir: 'asc' });
  const designs = DESIGN_TABS.map((t) => ({ tab: t, ...searchDesigns(t.key, { ...s, dir: 'asc' }) })).filter((g) => g.total > 0);
  const designRows = designs.flatMap((g) => g.rows).slice(0, N);
  const designTotal = designs.reduce((a, g) => a + g.total, 0);
  const none = orders.total + customers.total + products.total + designTotal === 0;

  return (
    <>
      <PageHeader title={`Results for “${q}”`} />
      {none ? (
        <div className="rounded-[var(--radius)] border border-border bg-card">
          <EmptyState title="Nothing found">Check the spelling, or search by order number (1001), email, SKU or design ID.</EmptyState>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          {orders.total > 0 && (
            <Group title="Orders" total={orders.total} href={hrefWith('/admin/orders', {}, { q })}>
              {orders.rows.map((o) => (
                <li key={o.id}><Link href={`/admin/orders/${o.id}`} className={row}><span className="font-semibold">#{o.number}</span><span className="min-w-0 flex-1 truncate text-muted-foreground">{o.name}</span><FulfillmentBadge status={o.fulfillment} /><span className="tnum">{fmt(o.total_cents)}</span></Link></li>
              ))}
            </Group>
          )}
          {customers.total > 0 && (
            <Group title="Customers" total={customers.total} href={hrefWith('/admin/customers', {}, { q })}>
              {customers.rows.map((c) => (
                <li key={c.id}><Link href={`/admin/customers/${c.id}`} className={row}><span className="min-w-0 flex-1 truncate font-medium">{c.name || c.email}</span><span className="truncate text-muted-foreground">{c.email}</span></Link></li>
              ))}
            </Group>
          )}
          {products.total > 0 && (
            <Group title="Products" total={products.total} href={hrefWith('/admin/products', {}, { q })}>
              {products.rows.map((p) => (
                <li key={p.id}><Link href={`/admin/products/${p.id}`} className={row}><span className="min-w-0 flex-1 truncate font-medium">{p.title}</span><StatusBadge status={p.status} /></Link></li>
              ))}
            </Group>
          )}
          {designTotal > 0 && (
            <Group title="Designs" total={designTotal} href={hrefWith('/admin/designs', {}, { q, tab: designs[0].tab.key === 'in_review' ? undefined : designs[0].tab.key })}>
              {designRows.map((d) => (
                <li key={d.id}><Link href={`/admin/designs/${d.id}`} className={row}><span className="min-w-0 flex-1 truncate font-medium">{d.pet_name || 'No pet name'} <span className="font-normal text-muted-foreground">· {d.id}</span></span><StatusBadge status={d.status} /></Link></li>
              ))}
            </Group>
          )}
        </div>
      )}
    </>
  );
}
