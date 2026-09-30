import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { fmt } from '@/lib/money';
import { requireAdminPage } from '../../../_lib/session';
import { getOrder } from '../../../_lib/repo';
import { ORDER_STATUSES } from '../../../_lib/schemas';
import { Icon } from '../../../_components/icons';
import { Card, PageHeader, StatusBadge, btn, fmtDate, linkCls } from '../../../_components/ui';
import { ApiForm, Select } from '../../../_components/form';

export const metadata: Metadata = { title: 'Order' };

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdminPage();
  const o = getOrder(Number((await params).id));
  if (!o) notFound();
  const addr = Object.entries(o.address).filter(([, v]) => v);
  return (
    <>
      <PageHeader title={`Order ${o.number}`} back={{ href: '/admin/orders', label: 'All orders' }}
        description={<>{fmtDate(o.created_at)} · <StatusBadge status={o.status} /></>} />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Card title="Items" id="items">
          <ul className="grid gap-5">
            {o.lines.map((l) => (
              <li key={l.id} className="grid gap-4 border-b border-border pb-5 last:border-0 sm:grid-cols-[160px_minmax(0,1fr)]">
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-1">
                  {l.design?.preview_url ? (
                    <figure>
                      <Image src={l.design.preview_url} alt={`Preview of design ${l.design.id}${l.design.pet_name ? ` for ${l.design.pet_name}` : ''}`} width={160} height={160} unoptimized className="aspect-square w-full rounded-[var(--radius)] border border-border object-cover" />
                      <figcaption className="mt-1 text-xs text-muted-foreground">Preview</figcaption>
                    </figure>
                  ) : <div className="flex aspect-square items-center justify-center rounded-[var(--radius)] border border-dashed border-border p-2 text-center text-xs text-muted-foreground">No preview yet</div>}
                  {l.design?.upload_url && (
                    <figure>
                      <Image src={l.design.upload_url} alt={`Customer photo for design ${l.design.id}`} width={160} height={160} unoptimized className="aspect-square w-full rounded-[var(--radius)] border border-border object-cover" />
                      <figcaption className="mt-1 text-xs text-muted-foreground">Customer photo</figcaption>
                    </figure>
                  )}
                </div>
                <div className="min-w-0">
                  <h3 className="text-lg font-semibold">{l.product_title} — {l.variant_size}</h3>
                  <p className="text-sm tabular-nums text-muted-foreground">{l.qty} × {fmt(l.unit_cents)} · SKU {l.sku}</p>
                  {l.design ? (
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                      <span>Design <strong>{l.design.id}</strong></span>
                      <StatusBadge status={l.design.status} />
                      <span className="text-muted-foreground">{l.design.mode === 'designer' ? 'Designer finish' : 'AI'}</span>
                      {l.design.status === 'in_review' && <Link href={`/admin/designs#${l.design.id}`} className={linkCls}>Open in designer queue</Link>}
                    </div>
                  ) : <p className="mt-2 text-sm text-destructive">No design attached to this line</p>}
                  <dl className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-sm">
                    {Object.entries(l.properties).map(([k, v]) => (
                      <div key={k} className="contents">
                        <dt className="text-muted-foreground">{k}{k.startsWith('_') && <span className="sr-only"> (hidden from customer)</span>}</dt>
                        <dd className="break-all">{v}</dd>
                      </div>
                    ))}
                  </dl>
                  {l.design && (
                    <div className="mt-3">
                      {l.design.has_print
                        ? <a href={`/api/admin/designs/${l.design.id}/print`} download className={`${btn.base} ${btn.accent}`}><Icon name="download" /> Download print file</a>
                        : <p className="text-sm text-muted-foreground">Print file not rendered yet.</p>}
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </Card>
        <div className="grid content-start gap-6">
          <Card title="Status" id="status">
            <ApiForm action={`/api/admin/orders/${o.id}`} method="PATCH" types={{ status: 'text' }} submitLabel="Update status" successMessage="Status updated">
              <Select name="status" label="Order status" defaultValue={o.status} options={ORDER_STATUSES} />
            </ApiForm>
          </Card>
          <Card title="Customer" id="customer">
            <p className="font-medium">{o.name}</p>
            <p className="text-sm"><a href={`mailto:${o.email}`} className={linkCls}>{o.email}</a></p>
            <address className="mt-2 text-sm not-italic text-muted-foreground">{addr.map(([k, v]) => <div key={k}>{v}</div>)}</address>
            <p className="mt-2 text-sm">Shipping: {o.shipping_method}</p>
          </Card>
          <Card title="Totals" id="totals">
            <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-y-1 text-sm tabular-nums">
              <dt>Subtotal</dt><dd className="text-right">{fmt(o.subtotal_cents)}</dd>
              {o.discount_cents > 0 && <><dt>Bundle discount</dt><dd className="text-right">−{fmt(o.discount_cents)}</dd></>}
              {o.addons.map((a, i) => <div key={i} className="contents"><dt>{a.title}{a.text ? ` — “${a.text}”` : ''}</dt><dd className="text-right">{fmt(a.price_cents)}</dd></div>)}
              <dt>Shipping</dt><dd className="text-right">{fmt(o.shipping_cents)}</dd>
              <dt className="border-t border-border pt-1 font-semibold">Total</dt><dd className="border-t border-border pt-1 text-right font-semibold">{fmt(o.total_cents)}</dd>
            </dl>
          </Card>
        </div>
      </div>
    </>
  );
}
