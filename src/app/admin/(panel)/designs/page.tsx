import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { requireAdminPage } from '../../_lib/session';
import { DESIGN_TABS, designTabCounts, searchDesigns, type DesignTab, type QueueItem } from '../../_lib/designs';
import { listStaff, staffName } from '../../_lib/staff';
import { hrefWith, listState, one, pick, type SearchParams } from '../../_lib/list';
import { Icon } from '../../_components/icons';
import { AssignSelect } from '../../_components/assign';
import { EmptyState, FilterBar, PageHeader, Pagination, StatusBadge, Tabs, btn, fmtAgo, fmtDate, linkCls } from '../../_components/ui';
import { ActionButton, UploadForm } from '../../_components/form';

export const metadata: Metadata = { title: 'Designs' };

const TAB_KEYS = DESIGN_TABS.map((t) => t.key);
const EMPTY: Record<DesignTab, { title: string; body: string }> = {
  in_review: { title: 'Nothing waiting for a designer', body: 'Designer-finish orders and AI previews handed over for hand finishing land here, oldest first.' },
  ai: { title: 'No AI previews to check', body: 'Finished AI previews appear here so you can spot a bad one and hand it to a designer before it prints.' },
  failed: { title: 'No failed designs', body: 'AI jobs that could not produce a preview show up here.' },
  approved: { title: 'No approved designs yet', body: 'Approved designs have a print file and are ready for production.' },
  rejected: { title: 'No rejected designs', body: 'Rejected designs asked the customer for a different photo.' },
};
const MODE_LABEL = { designer: 'Photo for designer', ai: 'Generated with AI' };

type Staff = { id: number; name: string; role: string }[];

function Thumb({ src, alt, empty }: { src: string | null; alt: string; empty: string }) {
  return src
    ? <Image src={src} alt={alt} width={320} height={320} unoptimized className="aspect-square w-full rounded-[var(--radius)] border border-border bg-muted object-cover" />
    : <div className="flex aspect-square items-center justify-center rounded-[var(--radius)] border border-dashed border-border p-3 text-center text-xs text-muted-foreground">{empty}</div>;
}

function Meta({ d }: { d: QueueItem }) {
  return (
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm">
      <dt className="text-muted-foreground">Product</dt><dd>{d.product_title ?? 'Unknown product'}{d.variant_size ? ` · ${d.variant_size}` : ''}</dd>
      <dt className="text-muted-foreground">Style</dt><dd>{d.style ?? '—'}</dd>
      <dt className="text-muted-foreground">Email</dt><dd className="break-all">{d.email ?? '—'}</dd>
      <dt className="text-muted-foreground">Orders</dt><dd>{d.orders.length ? d.orders.map((o) => <Link key={o.id} href={`/admin/orders/${o.id}`} className={`${linkCls} mr-2`}>#{o.number}</Link>) : 'Not ordered yet'}</dd>
    </dl>
  );
}

/** Thẻ làm việc đầy đủ cho tab “Needs review”: ảnh gốc, bản làm tay, ghi chú, upload, giao việc, duyệt. */
function ReviewCard({ d, staff }: { d: QueueItem; staff: Staff }) {
  return (
    <li id={d.id} className="scroll-mt-20 rounded-[var(--radius)] border border-border bg-card p-4 sm:p-5">
      <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1">
        <h2 className="text-lg font-semibold"><Link href={`/admin/designs/${d.id}`} className="hover:underline">{d.pet_name || 'No pet name given'}</Link></h2>
        <StatusBadge status={d.status} />
        <span className="text-sm text-muted-foreground">{d.id} · {MODE_LABEL[d.mode]}{d.print_px ? ` · print ${d.print_px}px` : ''}</span>
        <span className="ml-auto inline-flex items-center gap-1 text-sm text-muted-foreground" title={fmtDate(d.updated_at)}><Icon name="clock" size={14} /> waiting {fmtAgo(d.updated_at).replace(' ago', '')}</span>
      </div>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1.2fr)]">
        <div className="grid grid-cols-2 content-start gap-3">
          <figure>
            {d.upload_url
              ? <a href={d.upload_url} target="_blank" rel="noopener" className="block"><Thumb src={d.upload_url} alt={`Original photo of ${d.pet_name || 'the pet'} from the customer`} empty="No photo" /></a>
              : <Thumb src={null} alt="" empty="No photo" />}
            <figcaption className="mt-1 text-xs text-muted-foreground">Customer photo{d.upload_size ? ` · ${d.upload_size} px` : ''}{d.upload_url && ' · opens full size'}</figcaption>
          </figure>
          <figure>
            <Thumb src={d.preview_url} alt={`${d.mode === 'ai' ? 'AI preview' : 'Finished artwork'} for ${d.pet_name || 'the pet'}`} empty="No artwork uploaded yet" />
            <figcaption className="mt-1 text-xs text-muted-foreground">{d.mode === 'ai' && !d.has_print ? 'AI preview (handed over)' : 'Artwork preview'}</figcaption>
          </figure>
        </div>
        <div className="grid content-start gap-4">
          <div>
            <h3 className="text-sm font-semibold">Customer notes</h3>
            <p className="mt-1 whitespace-pre-wrap text-sm">{d.notes || <span className="text-muted-foreground">No notes</span>}</p>
          </div>
          <Meta d={d} />
          <AssignSelect designId={d.id} value={d.assignee_id} staff={staff} />
          <UploadForm action={`/api/admin/designs/${d.id}/artwork`} label={d.has_print ? 'Replace artwork' : 'Hand-made artwork'} accept="image/png,image/jpeg,image/webp,image/tiff"
            hint={`PNG, JPEG, WebP or TIFF up to 40 MB. Saved as a ${d.print_px ?? 2000}×${d.print_px ?? 2000} px sRGB PNG at 300 dpi.`} />
          <div className="flex flex-wrap gap-2 border-t border-border pt-4">
            {d.has_print && <a href={`/api/admin/designs/${d.id}/print`} download className={`${btn.base} ${btn.outline}`}><Icon name="download" /> Print file</a>}
            <ActionButton action={`/api/admin/designs/${d.id}`} payload={{ status: 'approved' }} label="Approve" icon="check" tone="primary" />
            <ActionButton action={`/api/admin/designs/${d.id}`} payload={{ status: 'rejected' }} label="Reject" icon="x" tone="danger"
              confirm={`Reject design ${d.id}? ${d.email ? 'The customer is emailed to send a different photo.' : 'There is no customer email on file.'}`} />
          </div>
        </div>
      </div>
    </li>
  );
}

/** Thẻ gọn cho các tab còn lại: soát preview AI, giao lại cho designer, xem lịch sử. */
function CompactCard({ d, tab }: { d: QueueItem; tab: DesignTab }) {
  const handoff = tab === 'ai' || tab === 'failed';
  return (
    <li id={d.id} className="flex scroll-mt-20 flex-col rounded-[var(--radius)] border border-border bg-card p-3">
      <div className="grid grid-cols-2 gap-2">
        <Thumb src={d.upload_url} alt={`Customer photo for ${d.pet_name || d.id}`} empty="No photo" />
        <Thumb src={d.preview_url} alt={`${d.mode === 'ai' ? 'AI preview' : 'Artwork'} for ${d.pet_name || d.id}`} empty={tab === 'failed' ? 'Generation failed' : 'No preview'} />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <h2 className="text-base font-semibold"><Link href={`/admin/designs/${d.id}`} className="hover:underline">{d.pet_name || 'No pet name'}</Link></h2>
        <StatusBadge status={d.status} />
      </div>
      <p className="text-xs text-muted-foreground">{d.id} · {MODE_LABEL[d.mode]} · {fmtAgo(d.updated_at)}</p>
      <p className="mt-1 text-sm text-muted-foreground">{d.orders.length ? <>Order {d.orders.map((o) => <Link key={o.id} href={`/admin/orders/${o.id}`} className={`${linkCls} mr-1`}>#{o.number}</Link>)}</> : 'Not ordered yet'}{d.assignee ? ` · ${d.assignee}` : ''}</p>
      <div className="mt-auto flex flex-wrap gap-2 pt-3">
        <Link href={`/admin/designs/${d.id}`} className={`${btn.base} ${btn.outline}`}>Details</Link>
        {handoff && <ActionButton action={`/api/admin/designs/${d.id}`} payload={{ status: 'in_review' }} label="Hand to designer" icon="brush" tone="outline"
          ariaLabel={`Hand design ${d.id} to a designer`} confirm={`Send ${d.pet_name || d.id} to the designer queue for hand finishing?`} />}
      </div>
    </li>
  );
}

export default async function DesignsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requireAdminPage();
  const sp = await searchParams;
  const base = '/admin/designs';
  // ?status= là link cũ (email, e2e): approved / rejected / in_review.
  const tab = pick(sp.tab, TAB_KEYS) ?? pick(sp.status, TAB_KEYS) ?? 'in_review';
  const s = listState(sp, ['date'] as const, 'date', 'asc', 20);
  const staffRows = listStaff();
  const staff = staffRows.map((m) => ({ id: m.id, name: staffName(m), role: m.role }));
  const a = one(sp.assignee);
  const assignee = a === 'unassigned' ? 'unassigned' : staff.some((m) => String(m.id) === a) ? Number(a) : undefined;
  const { rows, total } = searchDesigns(tab, s, assignee);
  const counts = designTabCounts();
  const filtered = !!(s.q || assignee);

  const tabs = DESIGN_TABS.map((t) => ({ href: hrefWith(base, {}, { tab: t.key === 'in_review' ? undefined : t.key }), label: t.label, count: counts[t.key], current: t.key === tab }));
  const listSp = { ...sp, status: undefined };

  return (
    <>
      <PageHeader title="Designs" meta={<span className="text-sm text-muted-foreground tnum">{counts.in_review} waiting</span>}
        description="Check AI previews, hand the weak ones to a designer, and approve hand-made artwork. The oldest request is always first." />
      <section aria-label="Design queue" className="mb-4 rounded-[var(--radius)] border border-border bg-card">
        <Tabs label="Queue views" items={tabs} />
        <FilterBar base={base} q={s.q} sp={listSp} placeholder="Search by pet name, design ID, email or order number" hidden={{ tab: tab === 'in_review' ? undefined : tab }}
          selects={[{ name: 'assignee', label: 'Designer', value: assignee == null ? undefined : String(assignee), options: [{ value: 'unassigned', label: 'Unassigned' }, ...staff.map((m) => ({ value: String(m.id), label: m.name }))] }]} />
      </section>
      {rows.length === 0 ? (
        <div className="rounded-[var(--radius)] border border-border bg-card">
          {filtered
            ? <EmptyState title="No designs match" action={<Link href={hrefWith(base, {}, { tab: tab === 'in_review' ? undefined : tab })} className={`${btn.base} ${btn.outline}`}>Clear filters</Link>}>Try another pet name or design ID, or show every designer.</EmptyState>
            : <EmptyState icon={tab === 'in_review' ? 'check' : 'brush'} title={EMPTY[tab].title}>{EMPTY[tab].body}</EmptyState>}
        </div>
      ) : (
        <>
          {tab === 'in_review'
            ? <ul className="grid gap-4">{rows.map((d) => <ReviewCard key={d.id} d={d} staff={staff} />)}</ul>
            : <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{rows.map((d) => <CompactCard key={d.id} d={d} tab={tab} />)}</ul>}
          {total > s.per && (
            <div className="mt-4 rounded-[var(--radius)] border border-border bg-card [&>nav]:border-t-0">
              <Pagination page={s.page} per={s.per} total={total} base={base} sp={listSp} noun="designs" />
            </div>
          )}
        </>
      )}
    </>
  );
}
