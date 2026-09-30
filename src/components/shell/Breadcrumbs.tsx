// Breadcrumb dùng chung của storefront: Home / … / trang hiện tại. Kèm JSON-LD BreadcrumbList (tắt bằng ld={false} khi trang tự phát).
import Link from 'next/link';
import { breadcrumbJsonLd } from '@/lib/seo';
import { JsonLd } from './JsonLd';
import { Icon } from './Icon';

export type Crumb = { name: string; path: string };

export function Breadcrumbs({ items, ld = true, className = '' }: { items: Crumb[]; ld?: boolean; className?: string }) {
  const all = [{ name: 'Home', path: '/' }, ...items];
  return (
    <>
      <nav aria-label="Breadcrumb" className={`text-sm text-muted-foreground ${className}`}>
        <ol className="flex min-w-0 items-center gap-1">
          {all.map((c, i) => {
            const last = i === all.length - 1;
            return (
              <li key={c.path} className={`flex items-center gap-1 ${last ? 'min-w-0' : 'shrink-0'}`}>
                {i > 0 && <Icon name="chevronRight" size={14} className="shrink-0 opacity-60" />}
                {last
                  ? <span aria-current="page" className="truncate text-foreground">{c.name}</span>
                  : <Link href={c.path} className="inline-flex min-h-11 items-center hover:text-foreground hover:underline sm:min-h-8">{c.name}</Link>}
              </li>
            );
          })}
        </ol>
      </nav>
      {ld && <JsonLd data={breadcrumbJsonLd(all)} />}
    </>
  );
}
