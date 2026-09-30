import type { Metadata } from 'next';
import Link from 'next/link';
import { db } from '@/lib/db';
import { requireAdminPage } from '../../_lib/session';
import { listReviewsAdmin } from '../../_lib/repo';
import { REVIEW_STATUSES } from '../../_lib/schemas';
import { Icon } from '../../_components/icons';
import { Card, Empty, PageHeader, StatusBadge, fmtDate } from '../../_components/ui';
import { ActionButton, ApiForm, Field, Select, TextArea } from '../../_components/form';

export const metadata: Metadata = { title: 'Reviews' };


// Social proof (#4): duyệt / ẩn review; thêm review thật nhận qua kênh khác. Không sửa được is_sample hay nội dung.
export default async function ReviewsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  await requireAdminPage();
  const q = (await searchParams).status;
  const status = q && (REVIEW_STATUSES as readonly string[]).includes(q) ? q : undefined;
  const reviews = listReviewsAdmin(status);
  const products = db().prepare('SELECT id, title FROM products ORDER BY id').all() as { id: number; title: string }[];
  const tab = (s: string | undefined, label: string) => (
    <Link key={label} href={s ? `/admin/reviews?status=${s}` : '/admin/reviews'} aria-current={s === status ? 'page' : undefined}
      className={`inline-flex min-h-11 items-center rounded-full border px-4 text-sm font-medium ${s === status ? 'border-primary bg-primary text-on-primary' : 'border-border bg-card hover:border-foreground'}`}>{label}</Link>
  );
  return (
    <>
      <PageHeader title="Reviews" description="Only published reviews count toward the stars and totals on product pages. Sample reviews are dev seed data: they are labelled in the store and never shown in production." />
      <nav aria-label="Filter by status" className="mb-4 flex flex-wrap gap-2">{tab(undefined, 'All')}{REVIEW_STATUSES.map((s) => tab(s, s))}</nav>
      <div className="grid gap-4">
        {reviews.length === 0 && <Empty>No reviews{status ? ` with status “${status}”` : ''}.</Empty>}
        {reviews.map((r) => (
          <Card key={r.id}>
            <article aria-labelledby={`review-${r.id}`} data-testid={`review-${r.id}`}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="flex text-accent" aria-hidden="true">{[1, 2, 3, 4, 5].map((i) => <Icon key={i} name="star" size={16} fill={i <= r.rating ? 'currentColor' : 'none'} />)}</span>
                <span className="sr-only">{r.rating} out of 5 stars</span>
                <h2 id={`review-${r.id}`} className="text-lg font-semibold">{r.title || 'Untitled review'}</h2>
                <StatusBadge status={r.status} />
                {r.is_sample ? <StatusBadge status="Sample review" tone="neutral" /> : null}
                {r.order_number ? <StatusBadge status={`Verified buyer · ${r.order_number}`} tone="success" /> : null}
              </div>
              <p className="mt-2 whitespace-pre-wrap text-sm">{r.body}</p>
              <p className="mt-2 text-xs text-muted-foreground">{r.author} · {r.product_title ?? 'Whole store'} · {fmtDate(r.created_at)}{r.photo_url && ' · has photo'}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {r.status !== 'published' && <ActionButton action={`/api/admin/reviews/${r.id}`} payload={{ status: 'published' }} label="Publish" icon="check" tone="accent" ariaLabel={`Publish review ${r.id}`} />}
                {r.status !== 'hidden' && <ActionButton action={`/api/admin/reviews/${r.id}`} payload={{ status: 'hidden' }} label="Hide" icon="eyeOff" ariaLabel={`Hide review ${r.id}`} />}
                {r.status !== 'pending' && <ActionButton action={`/api/admin/reviews/${r.id}`} payload={{ status: 'pending' }} label="Back to pending" ariaLabel={`Move review ${r.id} back to pending`} />}
              </div>
            </article>
          </Card>
        ))}
        <Card title="Add a review" id="new-review" description="For a real review a customer sent another way (email, social). It is saved as a real review; enter the order number to mark it Verified buyer.">
          <ApiForm action="/api/admin/reviews" reset submitLabel="Add review" successMessage="Review added"
            types={{ product_id: 'nullint', order_number: 'nulltext', author: 'text', rating: 'int', title: 'nulltext', body: 'text', photo_url: 'nulltext', status: 'text' }}
            className="sm:grid-cols-2 xl:grid-cols-3">
            <Select name="product_id" label="Product" options={[{ value: '', label: 'Whole store' }, ...products.map((p) => ({ value: String(p.id), label: p.title }))]} defaultValue={products[0] ? String(products[0].id) : ''} />
            <Field name="author" label="Customer name" required maxLength={80} hint="As they agreed to be shown, e.g. Jamie R." />
            <Select name="rating" label="Rating" defaultValue="5" options={['5', '4', '3', '2', '1'].map((n) => ({ value: n, label: `${n} star${n === '1' ? '' : 's'}` }))} />
            <Field name="order_number" label="Order number" placeholder="#1001" hint="Optional. Must match an existing order." />
            <Field name="title" label="Title" maxLength={120} />
            <Field name="photo_url" label="Photo URL" hint="Optional, site path or https://" />
            <TextArea name="body" label="Review" required maxLength={4000} className="sm:col-span-2 xl:col-span-3" hint="The customer's words, unedited." />
            <Select name="status" label="Status" defaultValue="pending" options={REVIEW_STATUSES} />
          </ApiForm>
        </Card>
      </div>
    </>
  );
}
