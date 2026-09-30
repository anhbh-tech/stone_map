import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { listAddresses, ordersForCustomer } from '@/lib/account';
import { firstName } from '@/lib/customer';
import { currentCustomer } from '@/lib/customer-session';
import { fmt } from '@/lib/money';
import { getSettings } from '@/lib/settings';
import { AddressBook } from '@/components/account/AddressBook';
import { DesignBadge, OrderProgress } from '@/components/account/OrderProgress';
import { SignOutButton } from '@/components/account/SignOutButton';
import { UiIcon } from '@/components/nav/icons';

export const metadata: Metadata = { title: 'Your account', robots: { index: false, follow: false } };

const placed = (s: string) => new Date(s.replace(' ', 'T') + 'Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

export default async function AccountPage() {
  const c = await currentCustomer();
  if (!c) redirect('/account/login?next=/account');
  const orders = ordersForCustomer(c.id);
  const addresses = listAddresses(c.id);
  const s = getSettings();

  return (
    <div className="mx-auto max-w-6xl px-4 pb-16 pt-8 md:pt-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-4xl font-semibold md:text-5xl">Hi, {firstName(c)}</h1>
          <p className="mt-2 text-muted-foreground">{c.email}</p>
        </div>
        <SignOutButton />
      </div>

      <div className="mt-10 grid gap-12 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <section aria-labelledby="orders">
          <h2 id="orders" className="text-3xl font-semibold">Orders</h2>
          {orders.length === 0 ? (
            <div className="mt-5 rounded-[var(--radius)] border border-dashed border-border px-6 py-10 text-center" data-testid="orders-empty">
              <p className="text-xl font-semibold">No orders yet</p>
              <p className="mx-auto mt-2 max-w-md text-muted-foreground">Orders you place while signed in show up here, with the status of each portrait.</p>
              <div className="mt-6 flex flex-wrap justify-center gap-3">
                <Link href="/collections/pet-portraits" className="inline-flex min-h-12 items-center gap-2 rounded-md bg-accent px-5 font-semibold text-on-accent hover:opacity-90">
                  Shop pet portraits <UiIcon name="chevronRight" size={18} />
                </Link>
                <Link href="/track-order" className="inline-flex min-h-12 items-center rounded-md border border-border px-5 font-medium hover:bg-muted">Track a guest order</Link>
              </div>
            </div>
          ) : (
            <ul className="mt-5 grid gap-4">
              {orders.map((o) => (
                <li key={o.number} className="relative rounded-[var(--radius)] border border-border bg-card p-4 transition-colors hover:border-foreground md:p-5" data-testid="order-row">
                  <div className="flex gap-4">
                    <div className="flex shrink-0 -space-x-6">
                      {o.thumbnails.length ? o.thumbnails.map((t, i) => (
                        <Image key={i} src={t.url} alt={t.alt} width={64} height={64} unoptimized className="size-16 rounded-md border-2 border-card bg-muted object-cover" />
                      )) : <span className="flex size-16 items-center justify-center rounded-md bg-muted text-muted-foreground"><UiIcon name="package" size={22} /></span>}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                        <h3 className="font-sans text-base font-semibold">
                          <Link href={`/account/orders/${o.number}`} className="after:absolute after:inset-0 after:rounded-[var(--radius)] focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-offset-2 focus-visible:after:outline-ring">
                            Order #{o.number}
                          </Link>
                        </h3>
                        <p className="text-sm tabular-nums text-muted-foreground">{placed(o.created_at)} · {o.items} {o.items === 1 ? 'item' : 'items'} · <span className="font-semibold text-foreground">{fmt(o.total_cents)}</span></p>
                      </div>
                      <div className="mt-2"><OrderProgress status={o.status} compact /></div>
                      {o.designs.length > 0 && (
                        <ul className="mt-3 flex flex-wrap gap-2" aria-label="Designs">
                          {o.designs.map((d) => <li key={d.id}><DesignBadge status={d.status} /></li>)}
                        </ul>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-6 text-sm text-muted-foreground">
            Placed an order as a guest? <Link href="/track-order" className="font-medium text-foreground underline underline-offset-4 hover:text-accent">Track it</Link> with the order number and email.
          </p>
        </section>

        <section aria-labelledby="addresses">
          <h2 id="addresses" className="text-3xl font-semibold">Addresses</h2>
          <div className="mt-5"><AddressBook initial={addresses} regions={s.shipping.regions} /></div>
        </section>
      </div>
    </div>
  );
}
