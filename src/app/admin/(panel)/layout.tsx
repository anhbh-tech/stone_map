import Link from 'next/link';
import { requireAdminPage } from '../_lib/session';
import { attention } from '../_lib/analytics';
import { LogoutButton, MobileNav, NavLinks } from '../_components/nav';
import { Icon } from '../_components/icons';
import { UnsavedGuard } from '../_components/form';

export default async function PanelLayout({ children }: { children: React.ReactNode }) {
  const user = await requireAdminPage();
  const a = attention();
  const badges = { orders: a.to_fulfill, designs: a.designs_review, reviews: a.reviews_pending };
  return (
    <>
      <UnsavedGuard />
      <a href="#admin-main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-[var(--radius)] focus:bg-card focus:px-3 focus:py-2">Skip to content</a>
      <header className="admin-topbar sticky top-0 z-30 flex h-14 items-center gap-2 px-2 sm:gap-3 lg:px-4">
        <MobileNav badges={badges} />
        <Link href="/admin" className="admin-tb-hover flex min-h-11 shrink-0 items-center gap-2 rounded-[var(--radius)] px-2 text-sm font-semibold">
          Pearl Atelier <span className="hidden font-normal opacity-75 sm:inline">Admin</span>
        </Link>
        <form action="/admin/search" method="get" role="search" className="mx-auto min-w-0 flex-1 sm:max-w-xl">
          <label className="relative block">
            <span className="sr-only">Search orders, customers, products and designs</span>
            <Icon name="search" size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 opacity-80" />
            <input type="search" name="q" placeholder="Search" className="admin-tb-field h-10 w-full rounded-[var(--radius)] pl-9 pr-3 text-sm" />
          </label>
        </form>
        <div className="flex shrink-0 items-center gap-1 text-sm">
          <span className="hidden items-center gap-2 px-2 md:flex" title={`Signed in as ${user.username}`}>
            <span className="flex size-8 items-center justify-center rounded-full bg-secondary text-xs font-semibold uppercase text-on-secondary" aria-hidden="true">{user.username.slice(0, 2)}</span>
            <span className="max-w-32 truncate"><span className="sr-only">Signed in as </span>{user.username}</span>
          </span>
          <LogoutButton className="admin-tb-hover" />
        </div>
      </header>
      <div className="flex w-full flex-1">
        <nav aria-label="Admin" className="hidden w-60 shrink-0 border-r border-border bg-muted lg:block">
          <div className="sticky top-14 h-[calc(100dvh-3.5rem)] overflow-y-auto p-3">
            <NavLinks badges={badges} />
          </div>
        </nav>
        <main id="admin-main" className="min-w-0 flex-1 px-4 py-5 sm:px-6 lg:px-8 lg:py-6">
          <div className="mx-auto w-full max-w-[1200px]">{children}</div>
        </main>
      </div>
    </>
  );
}
