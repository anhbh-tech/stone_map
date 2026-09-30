import Link from 'next/link';
import { listCollections } from '@/lib/listing';
import { UiIcon } from './icons';

/**
 * Danh sách collection cho header (hợp đồng chung, UI-1 đặt vào header / menu mobile).
 * desktop: một hàng link ngang; mobile: danh sách dọc, mỗi dòng ≥ 48px, kèm số sản phẩm.
 * Collection rỗng bị ẩn: không dẫn khách tới trang trống.
 */
export async function CategoryMenu({ variant }: { variant: 'desktop' | 'mobile' }) {
  const cols = listCollections().filter((c) => c.count > 0);
  if (variant === 'desktop') {
    return (
      <nav aria-label="Shop by category">
        <ul className="flex flex-wrap items-center gap-x-1">
          {cols.map((c) => (
            <li key={c.id}>
              <Link href={`/collections/${c.handle}`} className="inline-flex min-h-11 items-center whitespace-nowrap rounded-md px-3 text-sm font-medium text-foreground hover:text-accent">
                {c.title}
              </Link>
            </li>
          ))}
          <li>
            <Link href="/collections" className="inline-flex min-h-11 items-center whitespace-nowrap rounded-md px-3 text-sm font-medium text-muted-foreground hover:text-accent">
              All collections
            </Link>
          </li>
        </ul>
      </nav>
    );
  }
  return (
    <nav aria-label="Shop by category">
      <ul className="divide-y divide-border border-y border-border">
        {cols.map((c) => (
          <li key={c.id}>
            <Link href={`/collections/${c.handle}`} className="flex min-h-12 items-center justify-between gap-3 px-1 text-base font-medium text-foreground hover:text-accent">
              <span>{c.title}</span>
              <span className="flex items-center gap-2 text-sm text-muted-foreground">
                {c.count}<span className="sr-only"> {c.count === 1 ? 'product' : 'products'}</span>
                <UiIcon name="chevronRight" size={18} />
              </span>
            </Link>
          </li>
        ))}
        <li>
          <Link href="/collections/all" className="flex min-h-12 items-center justify-between gap-3 px-1 text-base font-medium text-foreground hover:text-accent">
            All products <UiIcon name="chevronRight" size={18} className="text-muted-foreground" />
          </Link>
        </li>
      </ul>
    </nav>
  );
}
