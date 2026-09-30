import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { fmt } from '@/lib/money';
import { db } from '@/lib/db';
import { requireAdminPage } from '../../_lib/session';
import { PRODUCT_SORTS, searchProducts } from '../../_lib/repo';
import { hrefWith, listState, pick, type SearchParams } from '../../_lib/list';
import { Icon } from '../../_components/icons';
import { Card, EmptyState, FilterBar, PageHeader, Pagination, SortHeader, StatusBadge, Table, Tabs, btn, linkCls, td, th, tr } from '../../_components/ui';
import { ApiForm, Field } from '../../_components/form';

export const metadata: Metadata = { title: 'Products' };

const STATUSES = ['active', 'draft', 'archived'] as const;

export default async function ProductsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requireAdminPage();
  const sp = await searchParams;
  const base = '/admin/products';
  const status = pick(sp.status, STATUSES);
  const s = listState(sp, PRODUCT_SORTS, 'title', 'asc');
  const { rows, total } = searchProducts(s, status);
  const counts = Object.fromEntries((db().prepare('SELECT status, count(*) AS n FROM products GROUP BY status').all() as { status: string; n: number }[]).map((r) => [r.status, r.n]));
  const all = Object.values(counts).reduce((a: number, n) => a + (n as number), 0);
  const tabs = [
    { href: base, label: 'All', count: all, current: !status },
    ...STATUSES.map((st) => ({ href: hrefWith(base, {}, { status: st }), label: st[0].toUpperCase() + st.slice(1), count: counts[st] ?? 0, current: status === st })),
  ];
  const sortProps = { sort: s.sort, dir: s.dir, base, sp };

  return (
    <>
      <PageHeader title="Products" meta={<span className="text-sm text-muted-foreground tnum">{all} total</span>}
        description="Every product needs a hand-written meta description and alt text on every image before it can go live."
        actions={<a href="#new-product" className={`${btn.base} ${btn.primary}`}><Icon name="plus" /> Add product</a>} />
      <section aria-label="Product list" className="mb-5 rounded-[var(--radius)] border border-border bg-card">
        <Tabs label="Product status" items={tabs} />
        <FilterBar base={base} q={s.q} sp={sp} placeholder="Search by title, handle or SKU" hidden={{ status }} />
        {rows.length === 0 ? (
          <div className="border-t border-border">
            {s.q
              ? <EmptyState title="No products match" action={<Link href={hrefWith(base, {}, { status })} className={`${btn.base} ${btn.outline}`}>Clear search</Link>}>Try the product handle or a variant SKU.</EmptyState>
              : <EmptyState icon="package" title={status ? `No ${status} products` : 'No products yet'} action={<a href="#new-product" className={`${btn.base} ${btn.primary}`}>Add product</a>}>Create a draft, add sizes and images, then set it active.</EmptyState>}
          </div>
        ) : (
          <>
            <div className="border-t border-border">
              <Table caption="Products" minWidth={760}>
                <thead><tr>
                  <SortHeader label="Product" col="title" {...sortProps} />
                  <SortHeader label="Status" col="status" {...sortProps} />
                  <th scope="col" className={`${th} text-right`}>Sizes</th>
                  <SortHeader label="From" col="price" align="right" {...sortProps} />
                  <th scope="col" className={`${th} text-right`}>Images</th>
                  <th scope="col" className={th}>Frame</th>
                  <th scope="col" className={th}>SEO</th>
                </tr></thead>
                <tbody>
                  {rows.map((p) => (
                    <tr key={p.id} className={tr}>
                      <td className={td}>
                        <div className="flex items-center gap-3">
                          <span className="size-10 shrink-0 overflow-hidden rounded-[calc(var(--radius)-4px)] border border-border bg-muted">
                            {p.image_url ? <Image src={p.image_url} alt="" width={40} height={40} unoptimized className="size-full object-cover" /> : <Icon name="package" size={16} className="m-3 text-muted-foreground" />}
                          </span>
                          <span className="min-w-0">
                            <Link href={`/admin/products/${p.id}`} className={linkCls}>{p.title}</Link>
                            <span className="block text-xs text-muted-foreground">/{p.handle}</span>
                          </span>
                        </div>
                      </td>
                      <td className={td}><StatusBadge status={p.status} label={p.status[0].toUpperCase() + p.status.slice(1)} /></td>
                      <td className={`${td} text-right`}>{p.variants}</td>
                      <td className={`${td} text-right`}>{p.from_cents != null ? fmt(p.from_cents) : '—'}</td>
                      <td className={`${td} text-right`}>{p.images}</td>
                      <td className={`${td} text-muted-foreground`}>{p.frame_included ? 'Included' : 'Sold separately'}</td>
                      <td className={td}>{p.meta_description ? <StatusBadge status="ok" tone="success" label="Ready" /> : <StatusBadge status="missing" tone="danger" label="Needs description" />}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
            <Pagination page={s.page} per={s.per} total={total} base={base} sp={sp} noun="products" />
          </>
        )}
      </section>
      <Card title="New product" id="new-product" description="Created as a draft. Add sizes, images and a meta description, then set it active.">
        <ApiForm action="/api/admin/products" types={{ handle: 'text', title: 'text' }} submitLabel="Create draft" successMessage="Created"
          redirect="/admin/products/{id}" className="sm:grid-cols-2">
          <Field name="handle" label="URL handle" required pattern="[a-z0-9]+(-[a-z0-9]+)*" hint="Lowercase and dashes, e.g. pearl-cat-portrait. Cannot be changed later." />
          <Field name="title" label="Title" required maxLength={70} hint="Short product name, no keyword stuffing." />
        </ApiForm>
      </Card>
    </>
  );
}
