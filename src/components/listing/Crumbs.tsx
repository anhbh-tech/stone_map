import Link from 'next/link';
import { breadcrumbJsonLd } from '@/lib/seo';
import { JsonLd } from '@/components/shell/JsonLd';
import { UiIcon } from '@/components/nav/icons';

/** Breadcrumb hiển thị + JSON-LD. Mục cuối là trang hiện tại (aria-current). */
export function Crumbs({ items }: { items: { name: string; path: string }[] }) {
  return (
    <>
      <JsonLd data={breadcrumbJsonLd(items)} />
      <nav aria-label="Breadcrumb" className="text-sm text-muted-foreground">
        <ol className="flex flex-wrap items-center gap-1">
          {items.map((it, i) => (
            <li key={it.path} className="flex items-center gap-1">
              {i > 0 && <UiIcon name="chevronRight" size={14} />}
              {i === items.length - 1
                ? <span aria-current="page" className="text-foreground">{it.name}</span>
                : <Link href={it.path} className="inline-flex min-h-11 items-center hover:text-foreground hover:underline underline-offset-4">{it.name}</Link>}
            </li>
          ))}
        </ol>
      </nav>
    </>
  );
}
