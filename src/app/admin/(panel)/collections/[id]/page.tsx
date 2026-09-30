import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { requireAdminPage } from '../../../_lib/session';
import { collectionProducts, getCollection } from '../../../_lib/collections';
import { MembershipForm } from '../../../_components/membership';
import { Card, PageHeader } from '../../../_components/ui';
import { ActionButton, ApiForm, Field, TextArea } from '../../../_components/form';

type P = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: P): Promise<Metadata> {
  const c = getCollection(Number((await params).id));
  return { title: c?.title ?? 'Collection' };
}

export default async function CollectionPage({ params }: P) {
  await requireAdminPage();
  const c = getCollection(Number((await params).id));
  if (!c) notFound();
  const products = collectionProducts(c.id);
  return (
    <>
      <PageHeader title={c.title} back={{ href: '/admin/collections', label: 'Collections' }} description={<>/collections/{c.handle}</>}
        actions={<a href={`/collections/${c.handle}`} className="inline-flex min-h-11 items-center text-sm underline underline-offset-4">View in store</a>} />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <Card title="Products" id="products" description={`${products.filter((p) => p.member).length} of ${products.length} products are in this collection.`}>
          <MembershipForm collectionId={c.id} products={products} />
        </Card>
        <div className="grid content-start gap-5">
          <Card title="Details" id="details">
            <ApiForm action={`/api/admin/collections/${c.id}`} method="PATCH" types={{ title: 'text', description: 'nulltext', image: 'nulltext', sort: 'int' }} ariaLabel="Collection details">
              <Field name="title" label="Title" required maxLength={80} defaultValue={c.title} />
              <TextArea name="description" label="Description" rows={4} maxLength={1000} defaultValue={c.description ?? ''} />
              <Field name="image" label="Image" defaultValue={c.image ?? ''} hint="A site path (/…) or an https:// URL." />
              <Field name="sort" label="Sort order" type="number" min={0} max={10000} required defaultValue={c.sort} hint="Lower numbers show first." />
            </ApiForm>
          </Card>
          <Card title="Delete collection" id="delete">
            <p className="mb-3 text-sm text-muted-foreground">Products stay in the catalog; only the grouping is removed.</p>
            <ActionButton action={`/api/admin/collections/${c.id}`} method="DELETE" label="Delete collection" icon="trash" tone="danger" redirect="/admin/collections" confirm={`Delete the collection “${c.title}”? This cannot be undone.`} />
          </Card>
        </div>
      </div>
    </>
  );
}
