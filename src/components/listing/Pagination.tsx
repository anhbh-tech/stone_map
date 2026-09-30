import Link from 'next/link';
import { UiIcon } from '@/components/nav/icons';
import { listHref, type UrlState } from './urls';

/** 1 … 4 5 6 … 12: luôn có trang đầu, cuối và 1 trang mỗi bên trang hiện tại. */
export function pageList(page: number, pages: number): (number | '…')[] {
  const keep = new Set([1, pages, page - 1, page, page + 1].filter((n) => n >= 1 && n <= pages));
  const out: (number | '…')[] = [];
  [...keep].sort((a, b) => a - b).forEach((n, i, a) => { if (i && n - a[i - 1] > 1) out.push('…'); out.push(n); });
  return out;
}

const box = 'inline-flex min-h-11 min-w-11 items-center justify-center rounded-md px-3 text-sm font-medium tabular-nums';

export function Pagination({ path, state, page, pages }: { path: string; state: UrlState; page: number; pages: number }) {
  if (pages <= 1) return null;
  const href = (n: number) => listHref(path, state, { page: n });
  return (
    <nav aria-label="Pagination" className="mt-12 flex items-center justify-center gap-1">
      {page > 1
        ? <Link href={href(page - 1)} rel="prev" className={`${box} gap-1 hover:bg-muted`}><UiIcon name="chevronLeft" size={16} />Previous</Link>
        : <span className={`${box} gap-1 text-muted-foreground opacity-60`} aria-disabled="true"><UiIcon name="chevronLeft" size={16} />Previous</span>}
      <ul className="hidden items-center gap-1 sm:flex">
        {pageList(page, pages).map((n, i) => (
          <li key={i}>
            {n === '…' ? <span className={`${box} text-muted-foreground`} aria-hidden="true">…</span>
              : n === page ? <span className={`${box} bg-primary text-on-primary`} aria-current="page">{n}</span>
                : <Link href={href(n)} className={`${box} hover:bg-muted`} aria-label={`Page ${n}`}>{n}</Link>}
          </li>
        ))}
      </ul>
      <span className="px-2 text-sm text-muted-foreground sm:hidden">Page {page} of {pages}</span>
      {page < pages
        ? <Link href={href(page + 1)} rel="next" className={`${box} gap-1 hover:bg-muted`}>Next<UiIcon name="chevronRight" size={16} /></Link>
        : <span className={`${box} gap-1 text-muted-foreground opacity-60`} aria-disabled="true">Next<UiIcon name="chevronRight" size={16} /></span>}
    </nav>
  );
}
