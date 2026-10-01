import Link from 'next/link';
import { listCollections } from '@/lib/listing';
import { UiIcon } from './icons';

/**
 * Danh sách collection cho header (hợp đồng chung). Header của UI-1 đã bọc trong <nav> nên ở đây chỉ trả <ul>.
 * desktop: hàng link ngang, Figtree 500 0.875rem, hover gạch chân; mobile: dòng 48px kẻ Hairline, kèm số sản phẩm.
 * Collection rỗng bị ẩn: không dẫn khách tới trang trống.
 * Cuối danh sách luôn có "Track order": khách mua quà hay quay lại hỏi đơn tới đâu (Shopify/mogcustom để ở menu chính).
 */
export async function CategoryMenu({ variant }: { variant: 'desktop' | 'mobile' }) {
  const cols = listCollections().filter((c) => c.count > 0);
  if (variant === 'desktop') {
    const link = 'inline-flex min-h-11 items-center whitespace-nowrap text-sm font-medium text-foreground decoration-2 hover:underline';
    return (
      <ul className="flex items-center gap-6" data-testid="category-menu">
        {cols.map((c) => <li key={c.id}><Link href={`/collections/${c.handle}`} className={link}>{c.title}</Link></li>)}
        <li><Link href="/collections" className={link}>All collections</Link></li>
        <li><Link href="/track-order" className={link}>Track order</Link></li>
      </ul>
    );
  }
  const row = 'flex min-h-12 items-center justify-between gap-3 border-b border-border text-base font-medium text-foreground';
  return (
    <ul data-testid="category-menu">
      {cols.map((c) => (
        <li key={c.id}>
          <Link href={`/collections/${c.handle}`} className={row}>
            <span>{c.title}</span>
            <span className="flex items-center gap-1 text-sm font-normal text-muted-foreground">
              {c.count}<span className="sr-only"> {c.count === 1 ? 'product' : 'products'}</span>
              <UiIcon name="chevronRight" size={18} />
            </span>
          </Link>
        </li>
      ))}
      <li>
        <Link href="/collections/all" className={row}>
          All products <UiIcon name="chevronRight" size={18} className="text-muted-foreground" />
        </Link>
      </li>
      <li>
        <Link href="/track-order" className={row}>
          Track order <UiIcon name="chevronRight" size={18} className="text-muted-foreground" />
        </Link>
      </li>
    </ul>
  );
}
