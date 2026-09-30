// STUB của UI-1 theo hợp đồng chung: crew UI-2 sở hữu file này (liệt kê bảng collections). Khi rebase, bản của UI-2 thắng.
// Chưa có bảng collections trên nhánh này → đọc thử, lỗi thì chỉ còn link sản phẩm đầu tiên.
import Link from 'next/link';
import { db } from '@/lib/db';
import { listProducts } from '@/lib/catalog';

function items(): { href: string; title: string }[] {
  try {
    const rows = db().prepare('SELECT handle, title FROM collections ORDER BY sort, id').all() as { handle: string; title: string }[];
    if (rows.length) return rows.map((r) => ({ href: `/collections/${r.handle}`, title: r.title }));
  } catch { /* bảng chưa có */ }
  const first = listProducts()[0];
  return first ? [{ href: `/products/${first.handle}`, title: 'Pet portraits' }] : [];
}

export async function CategoryMenu({ variant }: { variant: 'desktop' | 'mobile' }) {
  const list = items();
  if (!list.length) return null;
  return (
    <ul className={variant === 'desktop' ? 'flex flex-wrap items-center gap-x-6' : 'flex flex-col'}>
      {list.map((c) => (
        <li key={c.href}>
          <Link href={c.href} className={variant === 'desktop'
            ? 'inline-flex min-h-11 items-center text-sm font-medium text-foreground decoration-2 hover:underline'
            : 'flex min-h-12 items-center border-b border-border text-base font-medium text-foreground'}>
            {c.title}
          </Link>
        </li>
      ))}
    </ul>
  );
}
