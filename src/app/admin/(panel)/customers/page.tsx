import type { Metadata } from 'next';
import Link from 'next/link';
import { fmt } from '@/lib/money';
import { requireAdminPage } from '../../_lib/session';
import { CUSTOMER_SORTS, searchCustomers } from '../../_lib/customers';
import { customersReady } from '../../_lib/schema-info';
import { listState, type SearchParams } from '../../_lib/list';
import { TablesNotReady } from '../../_components/not-ready';
import { EmptyState, FilterBar, PageHeader, Pagination, SortHeader, Table, btn, fmtDay, linkCls, td, tr } from '../../_components/ui';

export const metadata: Metadata = { title: 'Customers' };

export default async function CustomersPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requireAdminPage();
  const sp = await searchParams;
  const base = '/admin/customers';
  if (!customersReady()) return (<><PageHeader title="Customers" /><TablesNotReady what="customers" /></>);
  const s = listState(sp, CUSTOMER_SORTS, 'created');
  const { rows, total } = searchCustomers(s);
  const sortProps = { sort: s.sort, dir: s.dir, base, sp };
  return (
    <>
      <PageHeader title="Customers" meta={<span className="text-sm text-muted-foreground tnum">{total} {s.q ? 'found' : 'total'}</span>}
        description="Everyone with a storefront account. Guest orders placed with the same email count toward the customer." />
      <section aria-label="Customer list" className="rounded-[var(--radius)] border border-border bg-card">
        <FilterBar base={base} q={s.q} sp={sp} placeholder="Search by name or email" />
        {rows.length === 0 ? (
          <div className="border-t border-border">
            {s.q
              ? <EmptyState title="No customers match" action={<Link href={base} className={`${btn.base} ${btn.outline}`}>Clear search</Link>}>Check the spelling, or search by part of the email address.</EmptyState>
              : <EmptyState icon="users" title="No customers yet">Customers appear here when they create an account at checkout or on the account page.</EmptyState>}
          </div>
        ) : (
          <>
            <div className="border-t border-border">
              <Table caption="Customers" minWidth={680}>
                <thead>
                  <tr>
                    <SortHeader label="Customer" col="name" {...sortProps} />
                    <SortHeader label="Orders" col="orders" align="right" {...sortProps} />
                    <SortHeader label="Amount spent" col="spent" align="right" {...sortProps} />
                    <SortHeader label="Last order" col="last_order" {...sortProps} />
                    <SortHeader label="Joined" col="created" {...sortProps} />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((c) => (
                    <tr key={c.id} className={tr}>
                      <td className={`${td} max-w-72`}>
                        <Link href={`/admin/customers/${c.id}`} className={`${linkCls} block truncate`}>{c.name || c.email}</Link>
                        {c.name && <span className="block truncate text-xs text-muted-foreground">{c.email}</span>}
                      </td>
                      <td className={`${td} text-right`}>{c.orders}</td>
                      <td className={`${td} text-right font-medium`}>{fmt(c.spent_cents)}</td>
                      <td className={`${td} whitespace-nowrap text-muted-foreground`}>{c.last_order_at ? fmtDay(c.last_order_at) : 'No orders'}</td>
                      <td className={`${td} whitespace-nowrap text-muted-foreground`}>{fmtDay(c.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
            <Pagination page={s.page} per={s.per} total={total} base={base} sp={sp} noun="customers" />
          </>
        )}
      </section>
    </>
  );
}
