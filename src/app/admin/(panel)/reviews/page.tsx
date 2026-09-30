import type { Metadata } from 'next';
import Link from 'next/link';
import { db } from '@/lib/db';
import { requireAdminPage } from '../../_lib/session';
import { REVIEW_SORTS, searchReviews } from '../../_lib/repo';
import { REVIEW_STATUSES } from '../../_lib/schemas';
import { hrefWith, listState, pick, type SearchParams } from '../../_lib/list';
import { Icon } from '../../_components/icons';
import { Card, EmptyState, FilterBar, PageHeader, Pagination, StatusBadge, Tabs, btn, fmtDate } from '../../_components/ui';
import { ActionButton, ApiForm, Field, Select, TextArea } from '../../_components/form';

export const metadata: Metadata = { title: 'Reviews' };

const RATINGS = ['5', '4', '3', '2', '1'] as const;
const LABEL: Record<string, string> = { pending: 'Pending', published: 'Published', hidden: 'Hidden' };

// Social proof (#4): duyệt / ẩn review; thêm review thật nhận qua kênh khác. Không sửa được is_sample hay nội dung.
export default async function ReviewsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requireAdminPage();
  const sp = await searchParams;
  const base = '/admin/reviews';
  const status = pick(sp.status, REVIEW_STATUSES);
  const rating = pick(sp.rating, RATINGS);
  const s = listState(sp, REVIEW_SORTS, 'date');
  const { rows: reviews, total } = searchReviews(s, { status, rating: rating ? Number(rating) : undefined });
  const counts = Object.fromEntries((db().prepare('SELECT status, count(*) AS n FROM reviews GROUP BY status').all() as { status: string; n: number }[]).map((r) => [r.status, r.n]));
  const all = Object.values(counts).reduce((a: number, n) => a + (n as number), 0);
  const products = db().prepare('SELECT id, title FROM products ORDER BY id').all() as { id: number; title: string }[];
  const tabs = [
    { href: base, label: 'All', count: all, current: !status },
    ...REVIEW_STATUSES.map((st) => ({ href: hrefWith(base, {}, { status: st }), label: LABEL[st] ?? st, count: counts[st] ?? 0, current: status === st })),
  ];
  const filtered = !!(s.q || rating);
  return (
    <>
      <PageHeader title="Reviews" meta={counts.pending ? <span className="text-sm text-muted-foreground tnum">{counts.pending} to moderate</span> : undefined}
        description="Only published reviews count toward the stars and totals on product pages. Sample reviews are dev seed data: they are labelled in the store and never shown in production." />
      <section aria-label="Review list" className="mb-5 rounded-[var(--radius)] border border-border bg-card">
        <Tabs label="Review status" items={tabs} />
        <FilterBar base={base} q={s.q} sp={sp} placeholder="Search by customer, title or text" hidden={{ status }}
          selects={[{ name: 'rating', label: 'Rating', value: rating, options: RATINGS.map((r) => ({ value: r, label: `${r} star${r === '1' ? '' : 's'}` })) }]} />
        {reviews.length === 0 ? (
          <div className="border-t border-border">
            {filtered
              ? <EmptyState title="No reviews match" action={<Link href={hrefWith(base, {}, { status })} className={`${btn.base} ${btn.outline}`}>Clear filters</Link>}>Try another name or rating.</EmptyState>
              : <EmptyState icon="star" title={status ? `No ${(LABEL[status] ?? status).toLowerCase()} reviews` : 'No reviews yet'}>New reviews wait here as pending until you publish them. You can also add one a customer sent another way, below.</EmptyState>}
          </div>
        ) : (
          <>
            <ul className="divide-y divide-border border-t border-border">
              {reviews.map((r) => (
                <li key={r.id}>
                  <article aria-labelledby={`review-${r.id}`} data-testid={`review-${r.id}`} className="px-4 py-4 sm:px-5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="flex text-accent" aria-hidden="true">{[1, 2, 3, 4, 5].map((i) => <Icon key={i} name="star" size={16} fill={i <= r.rating ? 'currentColor' : 'none'} />)}</span>
                      <span className="sr-only">{r.rating} out of 5 stars</span>
                      <h2 id={`review-${r.id}`} className="text-base font-semibold">{r.title || 'Untitled review'}</h2>
                      <StatusBadge status={r.status} />
                      {r.is_sample ? <StatusBadge status="Sample review" tone="neutral" /> : null}
                      {r.order_number ? <StatusBadge status={`Verified buyer · ${r.order_number}`} tone="success" /> : null}
                    </div>
                    <p className="mt-2 max-w-prose whitespace-pre-wrap text-sm">{r.body}</p>
                    <p className="mt-2 text-xs text-muted-foreground">{r.author} · {r.product_title ?? 'Whole store'} · {fmtDate(r.created_at)}{r.photo_url && ' · has photo'}</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {r.status !== 'published' && <ActionButton action={`/api/admin/reviews/${r.id}`} payload={{ status: 'published' }} label="Publish" icon="check" tone="primary" ariaLabel={`Publish review ${r.id}`} />}
                      {r.status !== 'hidden' && <ActionButton action={`/api/admin/reviews/${r.id}`} payload={{ status: 'hidden' }} label="Hide" icon="eyeOff" ariaLabel={`Hide review ${r.id}`} />}
                      {r.status !== 'pending' && <ActionButton action={`/api/admin/reviews/${r.id}`} payload={{ status: 'pending' }} label="Back to pending" ariaLabel={`Move review ${r.id} back to pending`} />}
                    </div>
                  </article>
                </li>
              ))}
            </ul>
            <Pagination page={s.page} per={s.per} total={total} base={base} sp={sp} noun="reviews" />
          </>
        )}
      </section>
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
    </>
  );
}
