import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { fmt } from '@/lib/money';
import { requireAdminPage } from '../../../_lib/session';
import { getOrder } from '../../../_lib/repo';
import { ORDER_STATUSES } from '../../../_lib/schemas';
import { orderFulfillments, orderTimeline } from '../../../_lib/orders';
import { canFulfill, fulfillmentStatus, paymentStatus } from '../../../_lib/order-status';
import { customerForOrder, customerHref } from '../../../_lib/customers';
import { Icon } from '../../../_components/icons';
import { Timeline } from '../../../_components/timeline';
import { Card, FulfillmentBadge, PageHeader, PaymentBadge, StatusBadge, btn, fmtDate, linkCls, statusLabel } from '../../../_components/ui';
import { ApiForm, Checkbox, Field, Select, TextArea } from '../../../_components/form';

type P = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: P): Promise<Metadata> {
  const o = getOrder(Number((await params).id));
  return { title: o ? `Order #${o.number}` : 'Order not found' };
}

export default async function OrderPage({ params }: P) {
  await requireAdminPage();
  const o = getOrder(Number((await params).id));
  if (!o) notFound();
  const raw = o as typeof o & { discount_code?: string | null; code_discount_cents?: number; customer_id?: number | null };
  const addr = Object.entries(o.address).filter(([, v]) => v);
  const payment = paymentStatus(o.status);
  const shipments = orderFulfillments(o.id);
  const fulfillment = fulfillmentStatus(o.status, shipments.length > 0);
  const fulfillable = canFulfill(o.status);
  const blocked = o.lines.filter((l) => !l.design || l.design.status === 'in_review' || !l.design.has_print);
  const timeline = orderTimeline(o.id);
  const customer = customerForOrder({ email: o.email, customer_id: raw.customer_id ?? null });
  const items = o.lines.reduce((a, l) => a + l.qty, 0);

  return (
    <>
      <PageHeader title={`#${o.number}`} back={{ href: '/admin/orders', label: 'Orders' }}
        meta={<span className="flex flex-wrap gap-1.5"><PaymentBadge status={payment} /><FulfillmentBadge status={fulfillment} /></span>}
        description={<>{fmtDate(o.created_at)} · {items} item{items === 1 ? '' : 's'}</>} />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="grid min-w-0 content-start gap-5">
          <Card title={fulfillment === 'fulfilled' ? 'Fulfilled' : fulfillment === 'in_production' ? 'In production' : 'Unfulfilled'} id="items"
            actions={<FulfillmentBadge status={fulfillment} />}>
            <ul className="grid gap-5">
              {o.lines.map((l) => (
                <li key={l.id} className="grid gap-4 border-b border-border pb-5 last:border-0 last:pb-0 sm:grid-cols-[120px_minmax(0,1fr)]">
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-1">
                    {l.design?.preview_url ? (
                      <figure>
                        <Image src={l.design.preview_url} alt={`Preview of design ${l.design.id}${l.design.pet_name ? ` for ${l.design.pet_name}` : ''}`} width={120} height={120} unoptimized className="aspect-square w-full rounded-[var(--radius)] border border-border object-cover" />
                        <figcaption className="mt-1 text-xs text-muted-foreground">Preview</figcaption>
                      </figure>
                    ) : <div className="flex aspect-square items-center justify-center rounded-[var(--radius)] border border-dashed border-border p-2 text-center text-xs text-muted-foreground">No preview yet</div>}
                    {l.design?.upload_url && (
                      <figure>
                        <Image src={l.design.upload_url} alt={`Customer photo for design ${l.design.id}`} width={120} height={120} unoptimized className="aspect-square w-full rounded-[var(--radius)] border border-border object-cover" />
                        <figcaption className="mt-1 text-xs text-muted-foreground">Customer photo</figcaption>
                      </figure>
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-4">
                      <h3 className="text-base font-semibold">{l.product_title} — {l.variant_size}</h3>
                      <span className="text-sm tnum">{l.qty} × {fmt(l.unit_cents)} = <strong className="font-semibold">{fmt(l.qty * l.unit_cents)}</strong></span>
                    </div>
                    <p className="text-sm text-muted-foreground">SKU {l.sku}</p>
                    {l.design ? (
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                        <Link href={`/admin/designs/${l.design.id}`} className={linkCls}>Design {l.design.id}</Link>
                        <StatusBadge status={l.design.status} />
                        <span className="text-muted-foreground">{l.design.mode === 'designer' ? 'Designer finish' : 'AI'}</span>
                      </div>
                    ) : <p className="mt-2 text-sm text-destructive">No design attached to this line</p>}
                    {Object.keys(l.properties).length > 0 && (
                      <dl className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-sm">
                        {Object.entries(l.properties).map(([k, v]) => (
                          <div key={k} className="contents">
                            <dt className="text-muted-foreground">{k}{k.startsWith('_') && <span className="sr-only"> (hidden from customer)</span>}</dt>
                            <dd className="break-all">{v}</dd>
                          </div>
                        ))}
                      </dl>
                    )}
                    {l.design && (
                      <div className="mt-3">
                        {l.design.has_print
                          ? <a href={`/api/admin/designs/${l.design.id}/print`} download className={`${btn.base} ${btn.outline}`}><Icon name="download" /> Download print file</a>
                          : <p className="text-sm text-muted-foreground">Print file not rendered yet.</p>}
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </Card>

          {fulfillable && (
            <Card title="Mark as fulfilled" id="fulfill" description="Record the shipment. The order moves to shipped and the event is added to the timeline.">
              {blocked.length > 0 ? (
                <p role="note" className="flex gap-2 rounded-[var(--radius)] border border-(--admin-attention) bg-background px-3 py-2 text-sm">
                  <Icon name="alert" className="mt-0.5 shrink-0 text-(--admin-attention)" />
                  <span>{blocked.length} {blocked.length === 1 ? 'line still needs' : 'lines still need'} an approved print file ({blocked.map((l) => l.design?.id ?? l.sku).join(', ')}). Approve the design first, then fulfill.</span>
                </p>
              ) : (
                <ApiForm action={`/api/admin/orders/${o.id}/fulfill`} types={{ carrier: 'nulltext', tracking_number: 'nulltext', tracking_url: 'nulltext', notify: 'bool' }}
                  submitLabel="Mark as fulfilled" pendingLabel="Saving…" successMessage="Order fulfilled" ariaLabel="Fulfill order"
                  confirm={[{ field: 'tracking_number', empty: true, message: `Mark order #${o.number} as shipped without a tracking number? If "Email the customer" is ticked, ${o.email} is emailed now, and the email cannot be taken back.` }]}>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field name="carrier" label="Carrier" placeholder="USPS" autoComplete="off" />
                    <Field name="tracking_number" label="Tracking number" autoComplete="off" />
                  </div>
                  <Field name="tracking_url" label="Tracking link" type="url" inputMode="url" placeholder="https://" hint="Optional. Must start with https://" />
                  <Checkbox name="notify" label={`Email the customer (${o.email}) that the order shipped`} defaultChecked />
                </ApiForm>
              )}
            </Card>
          )}

          {shipments.length > 0 && (
            <Card title="Shipments" id="shipments">
              <ul className="grid gap-2 text-sm">
                {shipments.map((f) => (
                  <li key={f.id} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <Icon name="truck" className="text-muted-foreground" />
                    <span className="font-medium">{f.carrier ?? 'Carrier not recorded'}</span>
                    {f.tracking_number && (f.tracking_url
                      ? <a href={f.tracking_url} target="_blank" rel="noopener noreferrer" className={`${linkCls} inline-flex items-center gap-1`}>{f.tracking_number}<Icon name="external" size={14} /><span className="sr-only"> (opens in a new tab)</span></a>
                      : <span className="tnum">{f.tracking_number}</span>)}
                    <span className="text-muted-foreground">{fmtDate(f.created_at)}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <Card title="Timeline" id="timeline">
            <ApiForm action={`/api/admin/orders/${o.id}/events`} types={{ message: 'text' }} submitLabel="Post" pendingLabel="Posting…" successMessage="Comment added" reset tone="outline" ariaLabel="Add a comment" className="mb-6">
              <TextArea name="message" label="Comment" rows={2} placeholder="Leave a note for the team. Only staff can see it." />
            </ApiForm>
            <Timeline entries={timeline} />
          </Card>
        </div>

        <div className="grid content-start gap-5">
          <Card title="Customer" id="customer">
            {customer ? (
              <>
                <Link href={`/admin/customers/${customer.id}`} className={linkCls}>{customer.name || o.name}</Link>
                <p className="text-sm text-muted-foreground">{customer.orders} order{customer.orders === 1 ? '' : 's'}</p>
              </>
            ) : <Link href={customerHref({ id: null, email: o.email })} className={linkCls}>{o.name}</Link>}
            <p className="mt-2 text-sm"><a href={`mailto:${o.email}`} className={`${linkCls} break-all`}>{o.email}</a></p>
            {!customer && <p className="mt-1 text-xs text-muted-foreground">Guest checkout, no customer account.</p>}
            <h3 className="mt-4 text-sm font-semibold">Shipping address</h3>
            <address className="mt-1 text-sm not-italic text-muted-foreground">{addr.length ? addr.map(([k, v]) => <div key={k}>{v}</div>) : 'No address'}</address>
            <p className="mt-2 text-sm">Method: {o.shipping_method}</p>
          </Card>
          <Card title="Payment" id="totals" actions={<PaymentBadge status={payment} />}>
            <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 text-sm tnum">
              <dt>Subtotal</dt><dd className="text-right">{fmt(o.subtotal_cents)}</dd>
              {o.discount_cents > 0 && <><dt>Multi-portrait discount</dt><dd className="text-right">−{fmt(o.discount_cents)}</dd></>}
              {raw.discount_code && <><dt>Discount code <Link href={`/admin/discounts?q=${encodeURIComponent(raw.discount_code)}`} className={`${linkCls} font-mono`}>{raw.discount_code}</Link></dt><dd className="text-right">{raw.code_discount_cents ? `−${fmt(raw.code_discount_cents)}` : 'Free shipping'}</dd></>}
              {o.addons.map((a, i) => <div key={i} className="contents"><dt className="min-w-0 break-words">{a.title}{a.text ? ` — “${a.text}”` : ''}</dt><dd className="text-right">{fmt(a.price_cents)}</dd></div>)}
              <dt>Shipping</dt><dd className="text-right">{fmt(o.shipping_cents)}</dd>
              <dt className="border-t border-border pt-1 font-semibold">Total</dt><dd className="border-t border-border pt-1 text-right font-semibold">{fmt(o.total_cents)}</dd>
            </dl>
            <p className="mt-2 text-xs text-muted-foreground">Checkout is simulated: every order is recorded as paid.</p>
          </Card>
          <Card title="Status" id="status" description="Use this for refunds, cancellations and delivery. Fulfilling sets shipped for you.">
            <ApiForm action={`/api/admin/orders/${o.id}`} method="PATCH" types={{ status: 'text' }} submitLabel="Update status" successMessage="Status updated" tone="outline"
              confirm={[
                { field: 'status', values: ['refunded'], message: `Mark order #${o.number} (${fmt(o.total_cents)}) as refunded? Checkout is simulated, so refund the money yourself. This cannot be undone from here.` },
                { field: 'status', values: ['canceled'], message: `Cancel order #${o.number} (${fmt(o.total_cents)})? Production stops and the order leaves the to-do list.` },
              ].filter((r) => !r.values.includes(o.status))}>
              <Select name="status" label="Order status" defaultValue={o.status} options={ORDER_STATUSES.map((s) => ({ value: s, label: statusLabel(s) }))} />
            </ApiForm>
          </Card>
        </div>
      </div>
    </>
  );
}
