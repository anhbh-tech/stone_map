import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAdminPage } from '../../_lib/session';
import { listCollections } from '../../_lib/collections';
import { Card, EmptyState, PageHeader, Table, linkCls, td, th, tr } from '../../_components/ui';
import { ApiForm, Field } from '../../_components/form';

export const metadata: Metadata = { title: 'Collections' };

export default async function CollectionsPage() {
  await requireAdminPage();
  const rows = listCollections();
  return (
    <>
      <PageHeader title="Collections" meta={<span className="text-sm text-muted-foreground tnum">{rows.length} total</span>}
        description="Group products for the storefront collection pages. Lower sort numbers show first." />
      <Card flush className="mb-5">
        {rows.length === 0 ? (
          <EmptyState icon="folder" title="No collections yet">Create one below, then pick the products that belong in it.</EmptyState>
        ) : (
          <Table caption="Collections" minWidth={520}>
            <thead><tr><th scope="col" className={th}>Title</th><th scope="col" className={`${th} text-right`}>Products</th><th scope="col" className={`${th} text-right`}>Sort</th></tr></thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id} className={tr}>
                  <td className={td}><Link href={`/admin/collections/${c.id}`} className={linkCls}>{c.title}</Link><div className="text-xs text-muted-foreground">/collections/{c.handle}</div></td>
                  <td className={`${td} text-right`}>{c.products}</td>
                  <td className={`${td} text-right text-muted-foreground`}>{c.sort}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      <Card title="New collection" id="new-collection">
        <ApiForm action="/api/admin/collections" types={{ handle: 'text', title: 'text' }} submitLabel="Create collection" successMessage="Created" redirect="/admin/collections/{id}" className="sm:grid-cols-2">
          <Field name="title" label="Title" required maxLength={80} />
          <Field name="handle" label="URL handle" required pattern="[a-z0-9]+(-[a-z0-9]+)*" hint="Lowercase and dashes, e.g. cat-portraits." />
        </ApiForm>
      </Card>
    </>
  );
}
