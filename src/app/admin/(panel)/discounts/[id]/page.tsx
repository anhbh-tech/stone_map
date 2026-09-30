import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { fmt } from '@/lib/money';
import { requireAdminPage } from '../../../_lib/session';
import { STATE_LABEL, discountSummary, getDiscount, ordersWithDiscount } from '../../../_lib/discounts';
import { DiscountForm } from '../../../_components/discount-form';
import { Card, PageHeader, StatusBadge, fmtDay, linkCls } from '../../../_components/ui';
import { ActionButton } from '../../../_components/form';

type P = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: P): Promise<Metadata> {
  const d = getDiscount(Number((await params).id));
  return { title: d ? d.code : 'Discount' };
}

export default async function DiscountPage({ params }: P) {
  await requireAdminPage();
  const d = getDiscount(Number((await params).id));
  if (!d) notFound();
  const orders = ordersWithDiscount(d.code);
  return (
    <>
      <PageHeader title={d.code} back={{ href: '/admin/discounts', label: 'Discounts' }} meta={<StatusBadge status={d.state} label={STATE_LABEL[d.state]} />} description={discountSummary(d, fmt)} />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <Card title="Settings" id="discount-settings"><DiscountForm initial={d} /></Card>
        <div className="grid content-start gap-5">
          <Card title="Summary" id="summary">
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-sm">
              <dt className="text-muted-foreground">Used</dt><dd className="tnum">{d.used}{d.usage_limit ? ` of ${d.usage_limit}` : ' (no limit)'}</dd>
              <dt className="text-muted-foreground">Starts</dt><dd>{d.starts_at ? fmtDay(d.starts_at) : 'Immediately'}</dd>
              <dt className="text-muted-foreground">Ends</dt><dd>{d.ends_at ? fmtDay(d.ends_at) : 'No end date'}</dd>
              <dt className="text-muted-foreground">Created</dt><dd>{fmtDay(d.created_at)}</dd>
            </dl>
          </Card>
          <Card title="Orders" id="orders">
            {orders.length === 0 ? <p className="text-sm text-muted-foreground">No orders have used this code.</p> : (
              <ul className="grid gap-1.5 text-sm">
                {orders.map((o) => <li key={o.id} className="flex justify-between gap-2"><Link href={`/admin/orders/${o.id}`} className={linkCls}>#{o.number}</Link><span className="tnum text-muted-foreground">−{fmt(o.discount_cents)}</span></li>)}
              </ul>
            )}
          </Card>
          <Card title="Delete" id="delete">
            <p className="mb-3 text-sm text-muted-foreground">Past orders keep the code they used.</p>
            <ActionButton action={`/api/admin/discounts/${d.id}`} method="DELETE" label="Delete discount" icon="trash" tone="danger" redirect="/admin/discounts" confirm={`Delete ${d.code}? Customers will no longer be able to use it.`} />
          </Card>
        </div>
      </div>
    </>
  );
}
