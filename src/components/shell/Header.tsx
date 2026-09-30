import Link from 'next/link';
import { CartBadge } from './CartBadge';

/** Header storefront. Logo là link chữ, không phải <h1> — mỗi trang tự có đúng 1 h1 (#9). */
export function Header({ shopName, cartCount, shopHref }: { shopName: string; cartCount: number; shopHref: string | null }) {
  const link = 'min-h-11 items-center whitespace-nowrap rounded-md px-2 text-sm font-medium text-foreground hover:text-accent';
  return (
    <header className="border-b border-border bg-background">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4">
        <Link href="/" className="whitespace-nowrap font-serif text-xl font-semibold tracking-wide text-foreground sm:text-2xl">{shopName}</Link>
        <nav aria-label="Main" className="flex items-center gap-1 sm:gap-3">
          {shopHref && <Link href={shopHref} className={`${link} inline-flex`}>Create yours</Link>}
          <Link href="/#how-it-works" className={`${link} hidden sm:inline-flex`}>How it works</Link>
          <Link href="/policies/shipping" className={`${link} hidden sm:inline-flex`}>Shipping</Link>
          <CartBadge key={cartCount} initial={cartCount} />
        </nav>
      </div>
    </header>
  );
}
