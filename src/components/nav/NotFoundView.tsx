import Link from 'next/link';
import { listCollections } from '@/lib/listing';
import { SearchBox } from './SearchBox';
import { UiIcon } from './icons';

/**
 * Trang 404 của storefront (link cũ từ quảng cáo, gõ sai, sản phẩm/collection đã gỡ): vẫn trong header/footer,
 * cho khách 3 lối đi tiếp — tìm kiếm, collection, tra đơn — thay cho trang trắng mặc định của Next.
 * Next tự gắn status 404 + robots noindex; <title> do React 19 đưa lên <head>.
 */
export function NotFoundView() {
  const cols = listCollections().filter((c) => c.count > 0);
  const row = 'flex min-h-12 items-center justify-between gap-3 text-foreground decoration-2 underline-offset-4 hover:underline';
  return (
    <div className="mx-auto max-w-3xl px-4 pb-16 pt-12 sm:px-6 md:pt-16" data-testid="not-found">
      <title>Page not found | Pearl Atelier</title>
      <h1 className="text-4xl font-semibold text-balance md:text-5xl">We couldn’t find that page</h1>
      <p className="mt-4 max-w-prose text-muted-foreground">
        The link may be old, or the item is no longer in the shop. Search for what you had in mind, or pick up from a collection.
      </p>
      <div className="mt-8"><SearchBox variant="page" /></div>

      <div className="mt-12 grid gap-10 md:grid-cols-2">
        <section aria-labelledby="nf-browse">
          <h2 id="nf-browse" className="font-sans text-base font-semibold">Browse a collection</h2>
          <ul className="mt-3 divide-y divide-border border-y border-border">
            {cols.map((c) => (
              <li key={c.id}>
                <Link href={`/collections/${c.handle}`} className={row}>
                  {c.title}<span className="flex items-center gap-2 text-sm text-muted-foreground">{c.count}<span className="sr-only"> {c.count === 1 ? 'product' : 'products'}</span><UiIcon name="chevronRight" size={16} /></span>
                </Link>
              </li>
            ))}
            <li><Link href="/collections/all" className={row}>All products<UiIcon name="chevronRight" size={16} className="text-muted-foreground" /></Link></li>
          </ul>
        </section>
        <section aria-labelledby="nf-help">
          <h2 id="nf-help" className="font-sans text-base font-semibold">Looking for an order?</h2>
          <p className="mt-3 text-sm text-muted-foreground">Check its status with the order number and the email you used at checkout.</p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Link href="/track-order" className="inline-flex min-h-12 items-center gap-2 rounded-full bg-primary px-6 text-sm font-semibold text-on-primary hover:bg-secondary">
              <UiIcon name="package" size={18} /> Track your order
            </Link>
            <Link href="/" className="inline-flex min-h-12 items-center rounded-full border border-input bg-background px-6 text-sm font-semibold text-foreground hover:bg-muted">
              Back to the shop
            </Link>
          </div>
        </section>
      </div>
    </div>
  );
}
