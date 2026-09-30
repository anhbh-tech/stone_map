import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { CART_COOKIE, getCart } from '@/lib/cart';
import { listProducts } from '@/lib/catalog';
import { CartClient } from '@/components/cart/CartClient';

export const metadata: Metadata = { title: 'Cart', robots: { index: false, follow: true }, alternates: { canonical: '/cart' } };

export default async function CartPage() {
  const view = getCart((await cookies()).get(CART_COOKIE)?.value);
  const first = listProducts()[0];
  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <CartClient initial={view} shopHref={first ? `/products/${first.handle}` : '/'} />
    </div>
  );
}
