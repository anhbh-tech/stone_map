import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { CART_COOKIE, getCart } from '@/lib/cart';
import { deliveryWindow, getSettings } from '@/lib/settings';
import { CheckoutForm, type MethodOption } from '@/components/cart/CheckoutForm';
import { LineList } from '@/components/cart/LineList';
import { CheckoutAccountNote } from '@/components/account/CheckoutAccountNote';

export const metadata: Metadata = { title: 'Checkout', robots: { index: false, follow: false }, alternates: { canonical: '/checkout' } };

const day = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

export default async function CheckoutPage() {
  const s = getSettings();
  const id = (await cookies()).get(CART_COOKIE)?.value;
  const standard = getCart(id, 'standard', s);
  if (!standard.lines.length) redirect('/cart');
  const methods: MethodOption[] = (['standard', 'express'] as const).map((m) => {
    const w = deliveryWindow(s, m);
    return { id: m, label: m === 'standard' ? 'Standard' : 'Express', window: `${day(w.from)} – ${day(w.to)}`, totals: m === 'standard' ? standard.totals : getCart(id, m, s).totals };
  });
  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <h1 className="text-4xl font-semibold md:text-5xl">Checkout</h1>
      <CheckoutAccountNote />
      <CheckoutForm methods={methods} regions={s.shipping.regions} addons={standard.addons.filter((a) => a.on).map((a) => ({ title: a.title, price_cents: a.price_cents }))}>
        <LineList items={standard.lines.map((l) => ({ key: l.id, title: l.product_title, size: l.size, qty: l.qty, cents: l.line_cents, thumbnail_url: l.thumbnail_url, properties: l.properties }))} />
      </CheckoutForm>
    </div>
  );
}
