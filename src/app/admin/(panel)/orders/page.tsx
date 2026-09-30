import type { Metadata } from 'next';
import Link from 'next/link';
import { fmt } from '@/lib/money';
import { requireAdminPage } from '../../_lib/session';
import { listOrders } from '../../_lib/repo';
import { ORDER_STATUSES } from '../../_lib/schemas';
import { Card, Empty, PageHeader, StatusBadge, Table, fmtDate, linkCls, td, th } from '../../_components/ui';

export const metadata: Metadata = { title: 'Orders' };

export default async function OrdersPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  await requireAdminPage();
  const q = (await searchParams).status;
  const status = q && (ORDER_STATUSES as readonly string[]).includes(q) ? q : undefined;
  const orders = listOrders(status);
  const tab = (s: string | undefined, label: string) => (
    <Link key={label} href={s ? `/admin/orders?status=${s}` : '/admin/orders'} aria-current={s === status ? 'page' : undefined}
      className={`inline-flex min-h-11 items-center rounded-full border px-4 text-sm font-medium ${s === status ? 'border-primary bg-primary text-on-primary' : 'border-border bg-card hover:border-foreground'}`}>{label}</Link>
  );
  return (
    <>
      <PageHeader title="Orders" description="Paid orders need their print files sent to production. Designer-finish lines wait in the designer queue first." />
      <nav aria-label="Filter by status" className="mb-4 flex flex-wrap gap-2">
        {tab(undefined, 'All')}
        {ORDER_STATUSES.map((s) => tab(s, s.replace(/_/g, ' ')))}
      </nav>
      <Card>
        {orders.length === 0 ? <Empty>No orders{status ? ` with status “${status.replace(/_/g, ' ')}”` : ''}.</Empty> : (
          <Table caption="Orders">
            <thead><tr>
              <th scope="col" className={th}>Order</th><th scope="col" className={th}>Date</th><th scope="col" className={th}>Customer</th>
              <th scope="col" className={th}>Items</th><th scope="col" className={th}>Shipping</th><th scope="col" className={`${th} text-right`}>Total</th><th scope="col" className={th}>Status</th>
            </tr></thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id}>
                  <td className={td}><Link href={`/admin/orders/${o.id}`} className={linkCls}>{o.number}</Link></td>
                  <td className={`${td} whitespace-nowrap text-muted-foreground`}>{fmtDate(o.created_at)}</td>
                  <td className={td}>{o.name}<div className="text-xs text-muted-foreground">{o.email}</div></td>
                  <td className={`${td} tabular-nums`}>{o.lines}{o.designs_pending > 0 && <div className="mt-1"><StatusBadge status={`${o.designs_pending} in review`} tone="warning" /></div>}</td>
                  <td className={td}>{o.shipping_method}</td>
                  <td className={`${td} text-right tabular-nums`}>{fmt(o.total_cents)}</td>
                  <td className={td}><StatusBadge status={o.status} /></td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
