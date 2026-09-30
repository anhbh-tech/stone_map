import Link from 'next/link';
import { Icon } from '../_components/icons';
import { btn } from '../_components/ui';

export default function AdminNotFound() {
  return (
    <div className="rounded-[var(--radius)] border border-border bg-card px-6 py-12 text-center">
      <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground"><Icon name="search" size={22} /></span>
      <h1 className="mt-3 text-xl font-semibold">Not found</h1>
      <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">This record does not exist or was deleted. Check the link, or search for it from the top bar.</p>
      <div className="mt-5 flex justify-center"><Link href="/admin" className={`${btn.base} ${btn.outline}`}>Go to Home</Link></div>
    </div>
  );
}
