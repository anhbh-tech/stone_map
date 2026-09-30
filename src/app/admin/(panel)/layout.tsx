import Link from 'next/link';
import { requireAdminPage } from '../_lib/session';
import { dashboardCounts } from '../_lib/repo';
import { LogoutButton, MobileNav, NavLinks } from '../_components/nav';

export default async function PanelLayout({ children }: { children: React.ReactNode }) {
  const user = await requireAdminPage();
  const c = dashboardCounts();
  const badges = { '/admin/orders': c.new_orders, '/admin/designs': c.designer_queue, '/admin/reviews': c.reviews_pending };
  return (
    <>
      <a href="#admin-main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-[var(--radius)] focus:bg-card focus:px-3 focus:py-2">Skip to content</a>
      <header className="relative flex items-center justify-between gap-3 border-b border-border bg-card px-4 py-2 lg:px-6">
        <div className="flex items-center gap-3">
          <MobileNav badges={badges} />
          <Link href="/admin" className="whitespace-nowrap font-serif text-xl font-semibold">Pearl Atelier <span className="hidden font-sans text-sm font-medium text-muted-foreground sm:inline">Admin</span></Link>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <span className="hidden text-muted-foreground sm:inline">Signed in as <strong className="text-foreground">{user.username}</strong></span>
          <LogoutButton />
        </div>
      </header>
      <div className="mx-auto flex w-full max-w-[1440px] flex-1">
        <nav aria-label="Admin" className="hidden w-60 shrink-0 border-r border-border p-3 lg:block">
          <div className="sticky top-3"><NavLinks badges={badges} /></div>
        </nav>
        <main id="admin-main" className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8">{children}</main>
      </div>
    </>
  );
}
