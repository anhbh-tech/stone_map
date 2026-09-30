import type { Metadata } from 'next';
import Image from 'next/image';
import { notFound } from 'next/navigation';
import { fmt } from '@/lib/money';
import { requireAdminPage } from '../../../_lib/session';
import { getProduct } from '../../../_lib/repo';
import { Card, Empty, PageHeader, StatusBadge } from '../../../_components/ui';
import { ActionButton, ApiForm, Checkbox, CountedField, Field, MoneyField, Select, TextArea } from '../../../_components/form';

export const metadata: Metadata = { title: 'Edit product' };

const VARIANT_TYPES = { size: 'text', sku: 'text', price_cents: 'money', compare_at_cents: 'nullmoney', print_px: 'int', position: 'int' } as const;

export default async function ProductEdit({ params }: { params: Promise<{ id: string }> }) {
  await requireAdminPage();
  const p = getProduct(Number((await params).id));
  if (!p) notFound();
  const base = p.variants.length ? Math.min(...p.variants.map((v) => v.price_cents)) : 0;

  return (
    <>
      <PageHeader title={p.title} back={{ href: '/admin/products', label: 'All products' }}
        description={<>/{p.handle} · <StatusBadge status={p.status} /></>}
        actions={<a href={`/products/${p.handle}`} className="inline-flex min-h-11 items-center text-sm underline underline-offset-4">View in store</a>} />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card title="Details & SEO" id="details">
          <ApiForm action={`/api/admin/products/${p.id}`} method="PATCH" ariaLabel="Product details"
            types={{ title: 'text', subtitle: 'nulltext', meta_title: 'nulltext', meta_description: 'nulltext', description_html: 'nulltext', frame_included: 'bool', status: 'text' }}>
            <CountedField name="title" label="Title" max={70} required defaultValue={p.title} hint="Shown as the page H1. Keep it short." />
            <Field name="subtitle" label="Subtitle" maxLength={200} defaultValue={p.subtitle ?? ''} />
            <CountedField name="meta_title" label="Meta title" max={70} defaultValue={p.meta_title} hint="Search result title. Blank = product title." />
            <CountedField name="meta_description" label="Meta description" max={160} multiline defaultValue={p.meta_description} hint="Hand-written summary for search results. Required before the product can be active." />
            <TextArea name="description_html" label="Description (HTML)" rows={6} defaultValue={p.description_html} hint="What the customer gets. If the frame is sold separately, say so here." />
            <Checkbox name="frame_included" label="Frame included in the price" defaultChecked={!!p.frame_included}
              hint="When on, the frame add-on is hidden on this product so we never sell what the description says is included." />
            <Select name="status" label="Status" defaultValue={p.status} options={['draft', 'active', 'archived']} />
          </ApiForm>
        </Card>

        <div className="grid content-start gap-6">
          <Card title="Images" id="images" description="Alt text is required: describe the pet and style, not the file name.">
            {p.images.length === 0 ? <Empty>No images yet.</Empty> : (
              <ul className="grid gap-4">
                {p.images.map((img) => (
                  <li key={img.id} className="grid gap-3 border-b border-border pb-4 last:border-0 sm:grid-cols-[96px_minmax(0,1fr)]">
                    <Image src={img.url} alt={img.alt} width={96} height={96} unoptimized className="size-24 rounded-[var(--radius)] border border-border object-cover" />
                    <div className="grid gap-2">
                      <ApiForm action={`/api/admin/images/${img.id}`} method="PATCH" types={{ alt: 'text', kind: 'text', position: 'int' }} ariaLabel={`Image ${img.id}`}>
                        <Field name="alt" label="Alt text" required maxLength={250} defaultValue={img.alt} />
                        <div className="grid grid-cols-2 gap-3">
                          <Select name="kind" label="Kind" defaultValue={img.kind} options={[{ value: 'gallery', label: 'Gallery' }, { value: 'mockup_scene', label: 'Mockup scene' }]} />
                          <Field name="position" label="Order" type="number" min={0} defaultValue={img.position} />
                        </div>
                      </ApiForm>
                      <div><ActionButton action={`/api/admin/images/${img.id}`} method="DELETE" label="Remove image" icon="trash" tone="danger" confirm="Remove this image from the product?" /></div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <h3 className="mt-6 text-lg font-semibold">Add image</h3>
            <ApiForm action="/api/admin/images" extra={{ product_id: p.id }} types={{ url: 'text', alt: 'text', kind: 'text', position: 'int' }} submitLabel="Add image" successMessage="Image added" reset className="mt-2">
              <Field name="url" label="Image URL" required placeholder="/demo/starry-king.webp" hint="Site path (/…) or https:// URL, WebP or AVIF preferred." />
              <Field name="alt" label="Alt text" required maxLength={250} />
              <div className="grid grid-cols-2 gap-3">
                <Select name="kind" label="Kind" options={[{ value: 'gallery', label: 'Gallery' }, { value: 'mockup_scene', label: 'Mockup scene' }]} />
                <Field name="position" label="Order" type="number" min={0} defaultValue={p.images.length} />
              </div>
            </ApiForm>
          </Card>
        </div>
      </div>

      <Card title="Sizes & prices" id="variants" className="mt-6" description="Print size is the square print file in pixels the worker renders (and the designer upload is resized to).">
        {p.variants.length === 0 ? <Empty>No sizes yet.</Empty> : (
          <ul className="grid gap-4">
            {p.variants.map((v) => (
              <li key={v.id} className="border-b border-border pb-4 last:border-0">
                <div className="mb-2 flex flex-wrap items-baseline gap-2">
                  <h3 className="text-lg font-semibold">{v.size}</h3>
                  <span className="text-sm tabular-nums text-muted-foreground">{fmt(v.price_cents)}{v.price_cents !== base && ` (+${fmt(v.price_cents - base)} vs smallest)`}</span>
                </div>
                <ApiForm action={`/api/admin/variants/${v.id}`} method="PATCH" types={VARIANT_TYPES} ariaLabel={`Size ${v.size}`} className="sm:grid-cols-3 xl:grid-cols-6">
                  <Field name="size" label="Size" required defaultValue={v.size} />
                  <Field name="sku" label="SKU" required defaultValue={v.sku} />
                  <MoneyField name="price_cents" label="Price" required cents={v.price_cents} />
                  <MoneyField name="compare_at_cents" label="Compare at" cents={v.compare_at_cents} hint="Blank = none" />
                  <Field name="print_px" label="Print px" type="number" min={500} max={12000} required defaultValue={v.print_px} />
                  <Field name="position" label="Order" type="number" min={0} defaultValue={v.position} />
                </ApiForm>
                <div className="mt-2"><ActionButton action={`/api/admin/variants/${v.id}`} method="DELETE" label={`Delete ${v.size}`} icon="trash" tone="danger" confirm={`Delete size ${v.size}? Sizes already in carts or orders cannot be deleted.`} /></div>
              </li>
            ))}
          </ul>
        )}
        <h3 className="mt-6 text-lg font-semibold">Add size</h3>
        <ApiForm action="/api/admin/variants" extra={{ product_id: p.id }} types={VARIANT_TYPES} submitLabel="Add size" successMessage="Size added" reset className="mt-2 sm:grid-cols-3 xl:grid-cols-6">
          <Field name="size" label="Size" required placeholder="24×24" />
          <Field name="sku" label="SKU" required placeholder="PPP-24x24" />
          <MoneyField name="price_cents" label="Price" required cents={null} />
          <MoneyField name="compare_at_cents" label="Compare at" cents={null} hint="Blank = none" />
          <Field name="print_px" label="Print px" type="number" min={500} max={12000} required defaultValue={2000} />
          <Field name="position" label="Order" type="number" min={0} defaultValue={p.variants.length} />
        </ApiForm>
      </Card>
    </>
  );
}
