import type { Metadata } from 'next';
import Link from 'next/link';
import { fmt } from '@/lib/money';
import { requireAdminPage } from '../../_lib/session';
import { ORDER_SORTS, orderTabCounts, searchOrders, type OrderFilter } from '../../_lib/orders';
import { FULFILLMENT, PAYMENT } from '../../_lib/order-status';
import { ORDER_STATUSES } from '../../_lib/schemas';
import { hrefWith, listState, one, pick, type SearchParams } from '../../_lib/list';
import { Icon } from '../../_components/icons';
import { EmptyState, FilterBar, FulfillmentBadge, PageHeader, Pagination, PaymentBadge, SortHeader, StatusBadge, Table, Tabs, btn, fmtDate, fmtDay, linkCls, td, th, tr } from '../../_components/ui';

export const metadata: Metadata = { title: 'Orders' };

const TABS = [
  { key: 'all', label: 'All', filter: {} },
  { key: 'unfulfilled', label: 'Not started', filter: { status: 'paid' } },
  { key: 'in_production', label: 'In production', filter: { fulfillment: 'in_production' } },
  { key: 'fulfilled', label: 'Fulfilled', filter: { fulfillment: 'fulfilled' } },
  { key: 'refunded', label: 'Refunded', filter: { payment: 'refunded' } },
] as const satisfies readonly { key: string; label: string; filter: OrderFilter }[];
const TAB_KEYS = TABS.map((t) => t.key);
const COUNT: Record<(typeof TABS)[number]['key'], keyof ReturnType<typeof orderTabCounts>> = { all: 'all', unfulfilled: 'to_fulfill', in_production: 'in_production', fulfilled: 'fulfilled', refunded: 'refunded' };
const PAY_LABEL = { paid: 'Paid', refunded: 'Refunded', voided: 'Voided (canceled)' };
const FUL_LABEL = { unfulfilled: 'Unfulfilled', in_production: 'In production', fulfilled: 'Fulfilled' };

export default async function OrdersPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requireAdminPage();
  const sp = await searchParams;
  const base = '/admin/orders';
  const tab = pick(sp.tab, TAB_KEYS, 'all');
  const s = listState(sp, ORDER_SORTS, 'date');
  const payment = pick(sp.payment, PAYMENT);
  const fulfillment = pick(sp.fulfillment, FULFILLMENT);
  const legacyStatus = pick(sp.status, ORDER_STATUSES);
  const filter: OrderFilter = { ...TABS.find((t) => t.key === tab)!.filter, ...(payment && { payment }), ...(fulfillment && { fulfillment }), ...(legacyStatus && { status: legacyStatus }) };
  const { rows, total } = searchOrders(s, filter);
  const counts = orderTabCounts();
  const filtered = !!(s.q || payment || fulfillment || legacyStatus);

  const tabs = TABS.map((t) => ({ href: hrefWith(base, {}, { tab: t.key === 'all' ? undefined : t.key }), label: t.label, count: counts[COUNT[t.key]], current: t.key === tab && !legacyStatus }));
  const sortProps = { sort: s.sort, dir: s.dir, base, sp };

  return (
    <>
      <PageHeader title="Orders" meta={<span className="text-sm text-muted-foreground tnum">{counts.all} total</span>}
        description="Paid orders go to production once every design has a print file. Mark them fulfilled when they ship." />
      <section aria-label="Order list" className="rounded-[var(--radius)] border border-border bg-card">
        <Tabs label="Order views" items={tabs} />
        <FilterBar base={base} q={s.q} sp={sp} placeholder="Search by order number, customer, email, design ID or SKU" hidden={{ tab: tab === 'all' ? undefined : tab }}
          selects={[
            { name: 'payment', label: 'Payment', value: payment, options: PAYMENT.map((p) => ({ value: p, label: PAY_LABEL[p] })) },
            { name: 'fulfillment', label: 'Fulfillment', value: fulfillment, options: FULFILLMENT.map((f) => ({ value: f, label: FUL_LABEL[f] })) },
          ]} />
        {legacyStatus && (
          <p className="flex flex-wrap items-center gap-2 border-t border-border px-4 py-2 text-sm sm:px-5">
            Status is <StatusBadge status={legacyStatus} /> <Link href={base} className={linkCls}>Show all orders</Link>
          </p>
        )}
        {rows.length === 0 ? (
          <div className="border-t border-border">
            {filtered ? (
              <EmptyState title="No orders match these filters" action={<Link href={hrefWith(base, {}, { tab: tab === 'all' ? undefined : tab })} className={`${btn.base} ${btn.outline}`}>Clear filters</Link>}>
                Try a different order number or email, or clear the payment and fulfillment filters.
              </EmptyState>
            ) : (
              <EmptyState icon="bag" title={tab === 'all' ? 'No orders yet' : `No ${TABS.find((t) => t.key === tab)!.label.toLowerCase()} orders`}>
                {tab === 'all' ? 'Orders appear here as soon as a customer completes checkout on the storefront.' : 'Nothing in this view right now.'}
              </EmptyState>
            )}
          </div>
        ) : (
          <>
            <div className="hidden border-t border-border md:block">
              <Table caption={`Orders, sorted by ${s.sort} ${s.dir === 'asc' ? 'ascending' : 'descending'}`} minWidth={860}>
                <thead>
                  <tr>
                    <SortHeader label="Order" col="number" {...sortProps} />
                    <SortHeader label="Date" col="date" {...sortProps} />
                    <SortHeader label="Customer" col="customer" {...sortProps} />
                    <SortHeader label="Total" col="total" align="right" {...sortProps} />
                    <th scope="col" className={th}>Payment</th>
                    <th scope="col" className={th}>Fulfillment</th>
                    <th scope="col" className={`${th} text-right`}>Items</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((o) => (
                    <tr key={o.id} className={tr}>
                      <td className={td}>
                        <Link href={`/admin/orders/${o.id}`} className={`${linkCls} whitespace-nowrap`}>#{o.number}</Link>
                        {o.designs_pending > 0 && <span className="ml-2 inline-flex items-center gap-1 text-xs text-muted-foreground" title="Designs waiting for review"><Icon name="brush" size={14} />{o.designs_pending}<span className="sr-only"> design{o.designs_pending === 1 ? '' : 's'} waiting for review</span></span>}
                      </td>
                      <td className={`${td} whitespace-nowrap text-muted-foreground`} title={fmtDate(o.created_at)}>{fmtDay(o.created_at)}</td>
                      <td className={`${td} max-w-60`}>
                        {o.customer_id ? <Link href={`/admin/customers/${o.customer_id}`} className="block truncate hover:underline">{o.name}</Link> : <span className="block truncate">{o.name}</span>}
                        <span className="block truncate text-xs text-muted-foreground">{o.email}</span>
                      </td>
                      <td className={`${td} text-right font-medium`}>{fmt(o.total_cents)}</td>
                      <td className={td}><PaymentBadge status={o.payment} /></td>
                      <td className={td}><FulfillmentBadge status={o.fulfillment} /></td>
                      <td className={`${td} text-right`}>{o.items}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
            <ul className="divide-y divide-border border-t border-border md:hidden" aria-label="Orders">
              {rows.map((o) => (
                <li key={o.id}>
                  <Link href={`/admin/orders/${o.id}`} className="block px-4 py-3 transition-colors duration-150 hover:bg-muted/50">
                    <span className="flex items-baseline justify-between gap-3">
                      <span className="font-semibold">#{o.number}</span>
                      <span className="font-medium tnum">{fmt(o.total_cents)}</span>
                    </span>
                    <span className="mt-0.5 flex justify-between gap-3 text-sm text-muted-foreground">
                      <span className="truncate">{o.name}</span><span className="shrink-0">{fmtDay(o.created_at)}</span>
                    </span>
                    <span className="mt-2 flex flex-wrap gap-1.5"><PaymentBadge status={o.payment} /><FulfillmentBadge status={o.fulfillment} /></span>
                  </Link>
                </li>
              ))}
            </ul>
            <Pagination page={s.page} per={s.per} total={total} base={base} sp={sp} noun="orders" />
          </>
        )}
      </section>
      <p className="mt-3 text-xs text-muted-foreground">Payment status follows the order: refunded orders show as refunded, canceled ones as voided. {one(sp.q) ? '' : 'Search also matches design IDs, so a designer can find the order behind a portrait.'}</p>
    </>
  );
}
