import type { Metadata } from 'next';
import Link from 'next/link';
import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { ORDERS_COOKIE, getOrder, ordersFromCookie } from '@/lib/cart';
import { deliveryWindow, getSettings } from '@/lib/settings';
import { LineList } from '@/components/cart/LineList';
import { Summary } from '@/components/cart/Summary';
import { Icon } from '@/components/shell/Icon';

type Props = { params: Promise<{ number: string }> };

export const metadata: Metadata = { title: 'Thank you', robots: { index: false, follow: false } };

const day = (d: Date) => d.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });

export default async function OrderPage({ params }: Props) {
  const { number } = await params;
  if (!/^\d{1,12}$/.test(number)) notFound();
  const s = getSettings();
  // Chỉ trình duyệt đã đặt đơn (cookie pa_orders) mới thấy chi tiết — số đơn tuần tự nên không dùng làm “mật khẩu”.
  const mine = ordersFromCookie((await cookies()).get(ORDERS_COOKIE)?.value).includes(number);
  const order = mine ? getOrder(number) : null;

  if (!order) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 text-center">
        <h1 className="text-4xl font-semibold">Order #{number}</h1>
        <p className="mt-4 text-muted-foreground">
          For your privacy, order details are only shown on the device that placed the order. Check your confirmation email, or write to{' '}
          <a href={`mailto:${s.shop.support_email}`} className="font-medium text-foreground underline">{s.shop.support_email}</a>.
        </p>
      </div>
    );
  }

  const w = deliveryWindow(s, order.shipping_method, new Date(order.created_at.replace(' ', 'T') + 'Z'));
  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <p className="flex items-center gap-2 text-sm font-semibold text-success"><Icon name="check" size={20} /> Order #{order.number} confirmed</p>
      <h1 className="mt-3 text-4xl font-semibold md:text-5xl">Thank you, {order.name.split(' ')[0]}</h1>
      <p className="mt-3 text-muted-foreground">
        A confirmation is on its way to <strong className="text-foreground">{order.email}</strong>. Estimated delivery: <strong className="text-foreground">{day(w.from)} – {day(w.to)}</strong> ({order.shipping_method}).
      </p>
      <section aria-labelledby="items" className="mt-8 rounded-[var(--radius)] border border-border bg-card p-5">
        <h2 id="items" className="text-2xl font-semibold">Your order</h2>
        <LineList showDesign items={order.lines.map((l, i) => ({ key: i, title: l.product_title, size: l.variant_size, qty: l.qty, cents: l.unit_cents * l.qty, thumbnail_url: l.thumbnail_url, properties: l.properties, design_id: l.design_id }))} />
        <Summary totals={order.totals} addons={order.addons} shippingNote={order.shipping_method === 'express' ? 'Express' : 'Standard'} />
      </section>
      <section aria-labelledby="ship-to" className="mt-6 text-sm">
        <h2 id="ship-to" className="text-xl font-semibold">Shipping to</h2>
        <address className="mt-2 not-italic text-muted-foreground">
          {order.name}<br />{order.address.line1}{order.address.line2 && <>, {order.address.line2}</>}<br />
          {order.address.city}, {order.address.region} {order.address.postal_code}<br />{order.address.country}
        </address>
      </section>
      <Link href="/" className="mt-8 inline-flex min-h-12 items-center rounded-md border border-border px-5 font-medium hover:bg-muted">Back to the shop</Link>
    </div>
  );
}
