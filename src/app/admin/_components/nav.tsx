'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Icon, type IconName } from './icons';
import { callApi } from './form';

type Item = { href: string; label: string; icon: IconName; badge?: string; children?: { href: string; label: string }[] };

// Nhóm như Shopify: việc hằng ngày trên cùng, danh mục sản phẩm gom một chỗ, Settings tách xuống đáy.
const ITEMS: Item[] = [
  { href: '/admin', label: 'Home', icon: 'home' },
  { href: '/admin/orders', label: 'Orders', icon: 'bag', badge: 'orders' },
  { href: '/admin/designs', label: 'Designs', icon: 'brush', badge: 'designs' },
  {
    href: '/admin/products', label: 'Products', icon: 'package',
    children: [
      { href: '/admin/collections', label: 'Collections' },
      { href: '/admin/addons', label: 'Add-ons' },
      { href: '/admin/bundle-tiers', label: 'Bundle tiers' },
    ],
  },
  { href: '/admin/customers', label: 'Customers', icon: 'users' },
  { href: '/admin/discounts', label: 'Discounts', icon: 'tag' },
  { href: '/admin/reviews', label: 'Reviews', icon: 'star', badge: 'reviews' },
  { href: '/admin/emails', label: 'Email outbox', icon: 'mail' },
];
const SETTINGS: Item = { href: '/admin/settings', label: 'Settings', icon: 'settings' };

const isActive = (path: string, href: string) => (href === '/admin' ? path === '/admin' : path === href || path.startsWith(href + '/'));

function Row({ it, path, badges, onNavigate }: { it: Item; path: string; badges: Record<string, number>; onNavigate?: () => void }) {
  const inGroup = isActive(path, it.href) || !!it.children?.some((c) => isActive(path, c.href));
  const self = isActive(path, it.href);
  const n = it.badge ? badges[it.badge] : 0;
  return (
    <li>
      <Link href={it.href} onClick={onNavigate} aria-current={self ? 'page' : undefined}
        className={`flex min-h-11 items-center gap-3 rounded-[var(--radius)] px-3 text-sm font-medium transition-colors duration-150 ${self ? 'bg-card text-foreground shadow-[0_0_0_1px_var(--border)]' : inGroup ? 'text-foreground' : 'text-secondary hover:bg-card/70 hover:text-foreground'}`}>
        <Icon name={it.icon} className={self || inGroup ? 'text-foreground' : 'text-muted-foreground'} />
        <span className="flex-1">{it.label}</span>
        {n ? <span className="rounded-full bg-accent px-2 py-0.5 text-xs font-semibold text-on-accent tnum">{n}<span className="sr-only"> waiting</span></span> : null}
      </Link>
      {it.children && inGroup && (
        <ul className="mb-1 ml-[1.375rem] mt-0.5 grid gap-0.5 border-l border-border pl-2">
          {it.children.map((c) => {
            const on = isActive(path, c.href);
            return (
              <li key={c.href}>
                <Link href={c.href} onClick={onNavigate} aria-current={on ? 'page' : undefined}
                  className={`flex min-h-11 items-center rounded-[var(--radius)] px-3 text-sm transition-colors duration-150 ${on ? 'bg-card font-medium text-foreground shadow-[0_0_0_1px_var(--border)]' : 'text-muted-foreground hover:bg-card/70 hover:text-foreground'}`}>
                  {c.label}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </li>
  );
}

export function NavLinks({ badges = {}, onNavigate }: { badges?: Record<string, number>; onNavigate?: () => void }) {
  const path = usePathname();
  return (
    <div className="flex h-full flex-col gap-4">
      <ul className="grid gap-0.5">{ITEMS.map((it) => <Row key={it.href} it={it} path={path} badges={badges} onNavigate={onNavigate} />)}</ul>
      <ul className="mt-auto grid gap-0.5 border-t border-border pt-3"><Row it={SETTINGS} path={path} badges={badges} onNavigate={onNavigate} /></ul>
    </div>
  );
}

/** Ngăn kéo điều hướng trên màn nhỏ: mở từ trái, Esc/nền mờ để đóng, trả focus về nút Menu. */
export function MobileNav({ badges }: { badges?: Record<string, number> }) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const closeBtn = useRef<HTMLButtonElement>(null);
  const path = usePathname();
  const [lastPath, setLastPath] = useState(path);
  if (path !== lastPath) { setLastPath(path); setOpen(false); }

  useEffect(() => {
    if (!open) return;
    closeBtn.current?.focus();
    const t = trigger.current;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = overflow; t?.focus(); };
  }, [open]);

  return (
    <div className="lg:hidden">
      <button ref={trigger} type="button" aria-expanded={open} aria-controls="admin-mobile-nav" onClick={() => setOpen(true)}
        className="inline-flex size-11 items-center justify-center rounded-[var(--radius)] admin-tb-hover" aria-label="Open navigation">
        <Icon name="menu" size={20} />
      </button>
      {open && (
        <div className="fixed inset-0 z-40 text-foreground">
          <button type="button" tabIndex={-1} aria-hidden="true" onClick={() => setOpen(false)} className="absolute inset-0 bg-foreground/40" />
          <nav id="admin-mobile-nav" aria-label="Admin" className="absolute inset-y-0 left-0 flex w-[min(20rem,85vw)] flex-col bg-muted p-3 shadow-lg">
            <div className="mb-2 flex items-center justify-between pl-3">
              <span className="text-sm font-semibold">Pearl Atelier</span>
              <button ref={closeBtn} type="button" onClick={() => setOpen(false)} aria-label="Close navigation"
                className="inline-flex size-11 items-center justify-center rounded-[var(--radius)] hover:bg-card"><Icon name="x" size={20} /></button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto"><NavLinks badges={badges} onNavigate={() => setOpen(false)} /></div>
          </nav>
        </div>
      )}
    </div>
  );
}

export function LogoutButton({ className = '' }: { className?: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  return (
    <button type="button" disabled={pending} onClick={async () => { setPending(true); await callApi('/api/admin/logout', 'POST'); router.replace('/admin/login'); router.refresh(); }}
      className={`inline-flex min-h-11 items-center gap-2 whitespace-nowrap rounded-[var(--radius)] px-3 text-sm font-medium disabled:opacity-60 ${className}`}>
      <Icon name="logout" /> <span className="max-sm:sr-only">Sign out</span>
    </button>
  );
}
