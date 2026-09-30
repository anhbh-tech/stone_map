import Link from 'next/link';
import { SearchBox } from '../nav/SearchBox';
import { AccountLink } from '../nav/AccountLink';
import { CategoryMenu } from '../nav/CategoryMenu';
import { CartBadge } from './CartBadge';
import { MobileMenu } from './MobileMenu';

const extra = [
  { href: '/#how-it-works', label: 'How it works' },
  { href: '/policies/shipping', label: 'Shipping' },
];

/**
 * Header storefront kiểu Shopify. Logo là link chữ, không phải <h1> — mỗi trang tự có đúng 1 h1 (#9).
 * ≥ lg: hàng 1 logo · ô search · account · giỏ; hàng 2 menu category. Dính đầu trang.
 * < lg: menu · logo giữa · account · giỏ, ô search full width bên dưới. Không dính (PDP có thanh preview trên + thanh mua dưới).
 * SearchBox / AccountLink / CategoryMenu thuộc crew UI-2 (src/components/nav), header chỉ đặt chỗ.
 */
export function Header({ shopName, cartCount }: { shopName: string; cartCount: number }) {
  const logo = 'inline-flex min-h-11 items-center whitespace-nowrap font-display text-[min(1.5rem,7vw)] leading-none text-foreground hover:text-secondary lg:text-[1.75rem]';
  return (
    <header className="z-30 border-b border-border bg-background lg:sticky lg:top-0">
      {/* Một SearchBox duy nhất (tránh trùng id): mobile nằm hàng 2 full width, lg chuyển lên giữa hàng 1. */}
      <div className="mx-auto grid max-w-7xl grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-x-2 gap-y-1 px-2 pb-3 pt-1.5 sm:px-4 lg:h-[4.5rem] lg:grid-cols-[auto_minmax(0,1fr)_auto] lg:gap-x-10 lg:px-8 lg:py-0">
        <div className="col-start-1 row-start-1 flex items-center lg:hidden">
          <MobileMenu shopName={shopName}>
            <CategoryMenu variant="mobile" />
            <ul className="mt-2">
              {extra.map((l) => (
                <li key={l.href}><Link href={l.href} className="flex min-h-12 items-center border-b border-border text-base text-foreground">{l.label}</Link></li>
              ))}
            </ul>
          </MobileMenu>
        </div>
        <Link href="/" className={`${logo} col-start-2 row-start-1 lg:col-start-1`}>{shopName}</Link>
        <div className="col-span-3 row-start-2 px-2 sm:px-0 lg:col-span-1 lg:col-start-2 lg:row-start-1 lg:flex lg:justify-center">
          <div className="w-full lg:max-w-xl"><SearchBox variant="header" /></div>
        </div>
        <div className="col-start-3 row-start-1 flex items-center justify-end gap-0.5">
          <AccountLink />
          <CartBadge key={cartCount} initial={cartCount} />
        </div>
      </div>
      <nav aria-label="Main" className="hidden border-t border-border lg:block">
        <div className="mx-auto flex h-12 max-w-7xl items-center gap-6 px-8">
          <CategoryMenu variant="desktop" />
          <ul className="flex items-center gap-6">
            {extra.map((l) => (
              <li key={l.href}><Link href={l.href} className="inline-flex min-h-11 items-center text-sm font-medium text-foreground decoration-2 hover:underline">{l.label}</Link></li>
            ))}
          </ul>
        </div>
      </nav>
    </header>
  );
}
