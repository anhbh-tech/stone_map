import { cookies } from 'next/headers';
import { getSettings, shippingHeadline } from '@/lib/settings';
import { bundleTiers, listProducts } from '@/lib/catalog';
import { CART_COOKIE, cartCount } from '@/lib/cart';
import { Header } from '@/components/shell/Header';
import { Footer } from '@/components/shell/Footer';
import { FloatingDock } from '@/components/shell/FloatingDock';
import { PageViews } from '@/components/shell/PageViews';

// Khung storefront kiểu Shopify: announcement bar → header → nội dung → footer nhiều cột.
// Mọi câu trong announcement bar sinh từ dữ liệu (#3: settings; bậc giảm giá: bundle_tiers). Không popup giảm giá (#9), 1 dock nổi duy nhất (#12).
export default async function StoreLayout({ children }: { children: React.ReactNode }) {
  const s = getSettings();
  const count = cartCount((await cookies()).get(CART_COOKIE)?.value);
  const first = listProducts()[0];
  const shopHref = first ? `/products/${first.handle}` : null;
  const tier = bundleTiers().find((t) => t.min_qty > 1 && t.percent_off > 0);
  return (
    <>
      <a href="#main" className="sr-only z-50 rounded-md bg-primary px-4 py-2 text-on-primary focus:not-sr-only focus:fixed focus:left-4 focus:top-4">Skip to content</a>
      <div className="bg-primary text-on-primary">
        <div className="mx-auto flex min-h-10 max-w-7xl items-center justify-center gap-x-4 px-4 py-2 text-center text-sm font-medium">
          <p data-testid="shipping-banner">{shippingHeadline(s)}</p>
          {tier && (
            <>
              <span aria-hidden="true" className="hidden size-1 rounded-full bg-on-primary-muted md:block" />
              <p className="hidden md:block">Order {tier.min_qty} portraits, save {tier.percent_off}% automatically</p>
            </>
          )}
        </div>
      </div>
      <Header shopName={s.shop.name} cartCount={count} />
      <main id="main" className="flex-1">{children}</main>
      <Footer s={s} shopHref={shopHref} />
      <FloatingDock supportEmail={s.shop.support_email} />
      <PageViews />
    </>
  );
}
