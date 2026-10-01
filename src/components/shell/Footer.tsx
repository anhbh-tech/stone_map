import Link from 'next/link';
import type { Settings } from '@/lib/types';

type Col = { title: string; links: { href: string; label: string; external?: boolean }[] };

/** Footer nhiều cột kiểu Shopify. Link /collections, /search, /account là route của crew UI-2. */
export function Footer({ s, shopHref }: { s: Settings; shopHref: string | null }) {
  const cols: Col[] = [
    {
      title: 'Shop',
      links: [
        ...(shopHref ? [{ href: shopHref, label: 'Create a portrait' }] : []),
        { href: '/collections', label: 'All collections' },
        { href: '/search', label: 'Search' },
        { href: '/cart', label: 'Cart' },
      ],
    },
    {
      title: 'Help',
      links: [
        { href: '/#how-it-works', label: 'How it works' },
        { href: '/policies/shipping', label: 'Shipping & delivery' },
        { href: '/policies/refund', label: 'Refunds & reprints' },
        { href: `mailto:${s.shop.support_email}`, label: 'Contact us', external: true },
      ],
    },
    {
      title: 'Account',
      links: [
        { href: '/account/login', label: 'Sign in' },
        { href: '/account', label: 'Order history' },
        { href: s.privacy.policy_path, label: 'Privacy' },
      ],
    },
  ];
  const link = 'inline-flex min-h-11 items-center text-sm text-on-primary-muted hover:text-on-primary hover:underline';
  return (
    // pb lớn dưới 1280px: dock nổi không bao giờ đè link cuối trang (#12).
    <footer className="mt-20 bg-primary pb-24 text-on-primary xl:pb-10">
      <div className="mx-auto grid max-w-7xl grid-cols-2 gap-x-6 gap-y-10 px-4 pt-14 sm:px-6 lg:grid-cols-[minmax(0,1.4fr)_repeat(3,minmax(0,1fr))] lg:px-8">
        <div className="col-span-2 lg:col-span-1">
          <p className="font-display text-2xl">{s.shop.name}</p>
          <p className="mt-3 max-w-xs text-sm text-on-primary-muted">Pearl mosaic portraits of your pet, previewed and approved by you before we print.</p>
          <a href={`mailto:${s.shop.support_email}`} className={link}>{s.shop.support_email}</a>
        </div>
        {cols.map((c) => (
          <nav key={c.title} aria-label={c.title}>
            <p className="text-sm font-semibold">{c.title}</p>
            <ul className="mt-3">
              {c.links.map((l) => (
                <li key={l.href}>{l.external ? <a href={l.href} className={link}>{l.label}</a> : <Link href={l.href} className={link}>{l.label}</Link>}</li>
              ))}
            </ul>
          </nav>
        ))}
      </div>
      <div className="mx-auto mt-12 max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="border-t border-on-primary-muted/25 pt-6"><p className="text-xs text-on-primary-muted">© {new Date().getFullYear()} {s.shop.name}. Payments on this site are simulated; no card details are collected.</p></div>
      </div>
    </footer>
  );
}
