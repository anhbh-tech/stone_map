import type { Metadata } from 'next';
import Link from 'next/link';
import { fmt } from '@/lib/money';
import { requireAdminPage } from '../../_lib/session';
import { listProducts } from '../../_lib/repo';
import { Card, Empty, PageHeader, StatusBadge, Table, linkCls, td, th } from '../../_components/ui';
import { ApiForm, Field } from '../../_components/form';

export const metadata: Metadata = { title: 'Products' };

export default async function ProductsPage() {
  await requireAdminPage();
  const products = listProducts();
  return (
    <>
      <PageHeader title="Products" description="Titles stay short; every product needs a hand-written meta description and alt text on every image before it can go live." />
      <Card className="mb-6">
        {products.length === 0 ? <Empty>No products yet.</Empty> : (
          <Table caption="Products">
            <thead><tr>
              <th scope="col" className={th}>Title</th><th scope="col" className={th}>Status</th><th scope="col" className={th}>Sizes</th>
              <th scope="col" className={th}>From</th><th scope="col" className={th}>Images</th><th scope="col" className={th}>Frame</th><th scope="col" className={th}>SEO</th>
            </tr></thead>
            <tbody>
              {products.map((p) => (
                <tr key={p.id}>
                  <td className={td}><Link href={`/admin/products/${p.id}`} className={linkCls}>{p.title}</Link><div className="text-xs text-muted-foreground">/{p.handle}</div></td>
                  <td className={td}><StatusBadge status={p.status} /></td>
                  <td className={`${td} tabular-nums`}>{p.variants}</td>
                  <td className={`${td} tabular-nums`}>{p.from_cents != null ? fmt(p.from_cents) : '—'}</td>
                  <td className={`${td} tabular-nums`}>{p.images}</td>
                  <td className={td}>{p.frame_included ? 'Included' : 'Sold separately'}</td>
                  <td className={td}>{p.meta_description ? <StatusBadge status="ok" tone="success" /> : <StatusBadge status="missing description" tone="danger" />}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
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
