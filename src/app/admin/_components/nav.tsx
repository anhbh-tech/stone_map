'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import { Icon, type IconName } from './icons';
import { callApi } from './form';

const ITEMS: { href: string; label: string; icon: IconName }[] = [
  { href: '/admin', label: 'Dashboard', icon: 'dashboard' },
  { href: '/admin/orders', label: 'Orders', icon: 'bag' },
  { href: '/admin/designs', label: 'Designer queue', icon: 'brush' },
  { href: '/admin/products', label: 'Products', icon: 'package' },
  { href: '/admin/addons', label: 'Add-ons', icon: 'puzzle' },
  { href: '/admin/bundle-tiers', label: 'Bundle tiers', icon: 'layers' },
  { href: '/admin/reviews', label: 'Reviews', icon: 'star' },
  { href: '/admin/emails', label: 'Email outbox', icon: 'mail' },
  { href: '/admin/settings', label: 'Settings', icon: 'settings' },
];

export function NavLinks({ badges = {}, onNavigate }: { badges?: Record<string, number>; onNavigate?: () => void }) {
  const path = usePathname();
  return (
    <ul className="grid gap-1">
      {ITEMS.map((it) => {
        const active = it.href === '/admin' ? path === '/admin' : path.startsWith(it.href);
        const n = badges[it.href];
        return (
          <li key={it.href}>
            <Link href={it.href} onClick={onNavigate} aria-current={active ? 'page' : undefined}
              className={`flex min-h-11 items-center gap-3 rounded-[var(--radius)] px-3 text-sm font-medium transition-colors duration-200 ${active ? 'bg-primary text-on-primary' : 'text-foreground hover:bg-muted'}`}>
              <Icon name={it.icon} />
              <span className="flex-1">{it.label}</span>
              {n ? <span className={`rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums ${active ? 'bg-on-primary text-primary' : 'bg-accent text-on-accent'}`}>{n}<span className="sr-only"> waiting</span></span> : null}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export function MobileNav({ badges }: { badges?: Record<string, number> }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="lg:hidden">
      <button type="button" aria-expanded={open} aria-controls="admin-mobile-nav" onClick={() => setOpen((o) => !o)}
        className="inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-[var(--radius)] border border-border px-3 text-sm font-medium">
        <Icon name={open ? 'x' : 'menu'} /> Menu
      </button>
      {open && (
        <nav id="admin-mobile-nav" aria-label="Admin" className="absolute inset-x-0 top-full z-20 border-b border-border bg-card p-3 shadow-sm">
          <NavLinks badges={badges} onNavigate={() => setOpen(false)} />
        </nav>
      )}
    </div>
  );
}

export function LogoutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  return (
    <button type="button" disabled={pending} onClick={async () => { setPending(true); await callApi('/api/admin/logout', 'POST'); router.replace('/admin/login'); router.refresh(); }}
      className="inline-flex min-h-11 items-center gap-2 whitespace-nowrap rounded-[var(--radius)] px-3 text-sm font-medium text-foreground hover:bg-muted disabled:opacity-60">
      <Icon name="logout" /> Sign out
    </button>
  );
}
