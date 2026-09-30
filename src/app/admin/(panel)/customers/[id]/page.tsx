import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { fmt } from '@/lib/money';
import { requireAdminPage } from '../../../_lib/session';
import { getCustomer } from '../../../_lib/customers';
import { ORDER_SORTS, searchOrders } from '../../../_lib/orders';
import { listState, type SearchParams } from '../../../_lib/list';
import { Card, FulfillmentBadge, PageHeader, Pagination, PaymentBadge, SortHeader, Stat, Table, fmtDate, fmtDay, linkCls, td, tr } from '../../../_components/ui';

type P = { params: Promise<{ id: string }>; searchParams: Promise<SearchParams> };

export async function generateMetadata({ params }: P): Promise<Metadata> {
  const c = getCustomer(Number((await params).id));
  return { title: c ? c.name || c.email : 'Customer' };
}

export default async function CustomerPage({ params, searchParams }: P) {
  await requireAdminPage();
  const c = getCustomer(Number((await params).id));
  if (!c) notFound();
  const sp = await searchParams;
  const base = `/admin/customers/${c.id}`;
  const s = listState(sp, ORDER_SORTS, 'date', 'desc', 10);
  const { rows, total } = searchOrders(s, { customer_id: c.id, email: c.email });
  const aov = c.orders ? Math.round(c.spent_cents / Math.max(1, c.orders)) : null;
  const sortProps = { sort: s.sort, dir: s.dir, base, sp };

  return (
    <>
      <PageHeader title={c.name || c.email} back={{ href: '/admin/customers', label: 'Customers' }} description={<>Customer since {fmtDay(c.created_at)}</>} />
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Orders" value={c.orders} />
        <Stat label="Amount spent" value={fmt(c.spent_cents)} hint="Excludes refunded and canceled" />
        <Stat label="Average order" value={aov == null ? '—' : fmt(aov)} hint="Amount spent ÷ all orders" />
        <Stat label="Last order" value={c.last_order_at ? fmtDay(c.last_order_at) : '—'} />
      </div>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <Card title="Orders" id="orders" flush>
          {rows.length === 0 ? <p className="px-4 pb-5 text-sm text-muted-foreground sm:px-5">This customer has not placed an order yet.</p> : (
            <>
              <Table caption={`Orders from ${c.name || c.email}`} minWidth={560}>
                <thead><tr>
                  <SortHeader label="Order" col="number" {...sortProps} />
                  <SortHeader label="Date" col="date" {...sortProps} />
                  <th scope="col" className="border-b border-border bg-muted/60 px-3 py-2 text-xs font-semibold text-muted-foreground">Status</th>
                  <SortHeader label="Total" col="total" align="right" {...sortProps} />
                </tr></thead>
                <tbody>
                  {rows.map((o) => (
                    <tr key={o.id} className={tr}>
                      <td className={td}><Link href={`/admin/orders/${o.id}`} className={linkCls}>#{o.number}</Link><div className="text-xs text-muted-foreground">{o.items} item{o.items === 1 ? '' : 's'}</div></td>
                      <td className={`${td} whitespace-nowrap text-muted-foreground`}>{fmtDate(o.created_at)}</td>
                      <td className={td}><span className="flex flex-wrap gap-1.5"><PaymentBadge status={o.payment} /><FulfillmentBadge status={o.fulfillment} /></span></td>
                      <td className={`${td} text-right font-medium`}>{fmt(o.total_cents)}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
              <Pagination page={s.page} per={s.per} total={total} base={base} sp={sp} noun="orders" />
            </>
          )}
        </Card>
        <div className="grid content-start gap-5">
          <Card title="Contact" id="contact">
            <p className="text-sm"><a href={`mailto:${c.email}`} className={`${linkCls} break-all`}>{c.email}</a></p>
          </Card>
          <Card title="Addresses" id="addresses">
            {c.addresses.length === 0 ? <p className="text-sm text-muted-foreground">No saved addresses.</p> : (
              <ul className="grid gap-3">
                {c.addresses.map((a) => (
                  <li key={a.id} className="text-sm">
                    {a.is_default ? <span className="mb-1 block text-xs font-semibold">Default</span> : null}
                    <address className="not-italic text-muted-foreground">{Object.values(a.address).filter(Boolean).map((v, i) => <div key={i}>{String(v)}</div>)}</address>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
