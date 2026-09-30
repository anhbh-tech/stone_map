import Link from 'next/link';
import type { Settings } from '@/lib/types';

export function Footer({ s, shopHref }: { s: Settings; shopHref: string | null }) {
  const link = 'inline-flex min-h-11 items-center text-sm text-muted-foreground hover:text-foreground sm:min-h-8';
  return (
    // pb lớn dưới 1280px: dock nổi không bao giờ đè link cuối trang (#12).
    <footer className="mt-16 border-t border-border bg-card pb-24 xl:pb-8">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 pt-10 sm:grid-cols-3">
        <div>
          <p className="font-serif text-xl font-semibold">{s.shop.name}</p>
          <p className="mt-2 max-w-xs text-sm text-muted-foreground">Pearl mosaic portraits of your pet, previewed and approved by you before we print.</p>
          <a href={`mailto:${s.shop.support_email}`} className={link}>{s.shop.support_email}</a>
        </div>
        <nav aria-label="Shop">
          <p className="text-sm font-semibold">Shop</p>
          <ul className="mt-2">
            {shopHref && <li><Link href={shopHref} className={link}>Create a portrait</Link></li>}
            <li><Link href="/#how-it-works" className={link}>How it works</Link></li>
            <li><Link href="/cart" className={link}>Cart</Link></li>
          </ul>
        </nav>
        <nav aria-label="Policies">
          <p className="text-sm font-semibold">Policies</p>
          <ul className="mt-2">
            <li><Link href="/policies/shipping" className={link}>Shipping</Link></li>
            <li><Link href="/policies/refund" className={link}>Refunds &amp; reprints</Link></li>
            <li><Link href={s.privacy.policy_path} className={link}>Privacy</Link></li>
          </ul>
        </nav>
      </div>
      <p className="mx-auto mt-8 max-w-6xl px-4 text-xs text-muted-foreground">© {new Date().getFullYear()} {s.shop.name}. Payments on this site are simulated.</p>
    </footer>
  );
}
