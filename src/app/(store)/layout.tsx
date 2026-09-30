import { cookies } from 'next/headers';
import { getSettings, shippingHeadline } from '@/lib/settings';
import { listProducts } from '@/lib/catalog';
import { CART_COOKIE, cartCount } from '@/lib/cart';
import { Header } from '@/components/shell/Header';
import { Footer } from '@/components/shell/Footer';
import { FloatingDock } from '@/components/shell/FloatingDock';
import { PageViews } from '@/components/shell/PageViews';

// Khung storefront. Banner ship sinh từ settings (#3), không popup giảm giá (#9), 1 dock nổi duy nhất (#12).
export default async function StoreLayout({ children }: { children: React.ReactNode }) {
  const s = getSettings();
  const count = cartCount((await cookies()).get(CART_COOKIE)?.value);
  const first = listProducts()[0];
  const shopHref = first ? `/products/${first.handle}` : null;
  return (
    <>
      <a href="#main" className="sr-only z-50 rounded-md bg-primary px-4 py-2 text-on-primary focus:not-sr-only focus:fixed focus:left-4 focus:top-4">Skip to content</a>
      <p data-testid="shipping-banner" className="bg-primary px-4 py-2 text-center text-sm text-on-primary">{shippingHeadline(s)}</p>
      <Header shopName={s.shop.name} cartCount={count} shopHref={shopHref} />
      <main id="main" className="flex-1">{children}</main>
      <Footer s={s} shopHref={shopHref} />
      <FloatingDock supportEmail={s.shop.support_email} />
      <PageViews />
    </>
  );
}
