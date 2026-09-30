import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { customerOrder } from '@/lib/account';
import { currentCustomer } from '@/lib/customer-session';
import { fmt } from '@/lib/money';
import { AddressLines } from '@/components/account/AddressBook';
import { DesignBadge, OrderProgress } from '@/components/account/OrderProgress';
import { UiIcon } from '@/components/nav/icons';

type Props = { params: Promise<{ number: string }> };

export const metadata: Metadata = { title: 'Order details', robots: { index: false, follow: false } };

const day = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
const placed = (s: string) => new Date(s.replace(' ', 'T') + 'Z').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

export default async function AccountOrderPage({ params }: Props) {
  const { number } = await params;
  const c = await currentCustomer();
  if (!c) redirect(`/account/login?next=${encodeURIComponent(`/account/orders/${number}`)}`);
  if (!/^\d{1,12}$/.test(number)) notFound();
  const o = customerOrder(c.id, number);
  if (!o) notFound();

  const rows: [string, number][] = [['Subtotal', o.subtotal_cents]];
  if (o.discount_cents) rows.push(['Multi-portrait discount', -o.discount_cents]);
  if (o.addons_cents) rows.push(['Add-ons', o.addons_cents]);
  rows.push(['Shipping', o.shipping_cents]);

  return (
    <div className="mx-auto max-w-4xl px-4 pb-16 pt-6">
      <Link href="/account" className="inline-flex min-h-11 items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground">
        <UiIcon name="chevronLeft" size={16} />Your account
      </Link>
      <div className="mt-2 flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-4xl font-semibold md:text-5xl">Order #{o.number}</h1>
        <p className="text-muted-foreground">Placed {placed(o.created_at)}</p>
      </div>

      <section aria-label="Order progress" className="mt-8 rounded-lg border border-border bg-card p-5 md:p-6">
        <OrderProgress status={o.status} />
        {o.delivery && (
          <p className="mt-6 flex flex-wrap items-center gap-2 text-sm">
            <UiIcon name="package" size={18} className="text-muted-foreground" />
            Estimated delivery <strong>{day(o.delivery.from)} – {day(o.delivery.to)}</strong>
            <span className="text-muted-foreground">({o.shipping_method})</span>
          </p>
        )}
      </section>

      <section aria-labelledby="items" className="mt-8">
        <h2 id="items" className="text-2xl font-semibold">Items and designs</h2>
        <ul className="mt-4 divide-y divide-border border-y border-border">
          {o.lines.map((l, i) => (
            <li key={i} className="flex gap-4 py-5">
              {l.thumbnail_url
                ? <Image src={l.thumbnail_url} alt={l.properties['Pet name'] ? `Preview of ${l.properties['Pet name']}'s portrait` : 'Preview of your portrait'} width={96} height={96} unoptimized className="size-24 shrink-0 rounded-md border border-border bg-muted object-cover" />
                : <span className="flex size-24 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground"><UiIcon name="sparkles" size={22} /></span>}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4">
                  <p className="font-medium">{l.title}</p>
                  <p className="tabular-nums">{fmt(l.unit_cents * l.qty)}</p>
                </div>
                <p className="text-sm text-muted-foreground">
                  {l.size} · Qty {l.qty}
                  {Object.entries(l.properties).map(([k, v]) => <span key={k}> · {k}: {v}</span>)}
                </p>
                {l.design_id && <p className="mt-1 text-xs text-muted-foreground">Design {l.design_id}</p>}
                <div className="mt-2"><DesignBadge status={l.design_status} withDetail /></div>
              </div>
            </li>
          ))}
        </ul>
        {o.addons.length > 0 && (
          <ul className="mt-4 grid gap-1 text-sm">
            {o.addons.map((a, i) => (
              <li key={i} className="flex justify-between gap-4"><span>{a.title}{a.text && <span className="text-muted-foreground"> — “{a.text}”</span>}</span><span className="tabular-nums">{a.price_cents ? fmt(a.price_cents) : 'Free'}</span></li>
            ))}
          </ul>
        )}
      </section>

      <div className="mt-8 grid gap-8 md:grid-cols-2">
        <section aria-labelledby="ship">
          <h2 id="ship" className="text-2xl font-semibold">Shipping to</h2>
          <div className="mt-3 text-sm text-muted-foreground"><p className="text-foreground">{o.name}</p><AddressLines a={o.address} /></div>
        </section>
        <section aria-labelledby="total">
          <h2 id="total" className="text-2xl font-semibold">Summary</h2>
          <dl className="mt-3 grid gap-1 text-sm tabular-nums">
            {rows.map(([k, v]) => (
              <div key={k} className="flex justify-between gap-4"><dt className="text-muted-foreground">{k}</dt><dd>{k === 'Shipping' && v === 0 ? 'Free' : v < 0 ? `−${fmt(-v)}` : fmt(v)}</dd></div>
            ))}
            <div className="mt-2 flex justify-between gap-4 border-t border-border pt-2 text-base font-semibold"><dt>Total</dt><dd>{fmt(o.total_cents)}</dd></div>
          </dl>
        </section>
      </div>
    </div>
  );
}
