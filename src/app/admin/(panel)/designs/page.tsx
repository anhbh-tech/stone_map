import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import type { DesignStatus } from '@/lib/types';
import { requireAdminPage } from '../../_lib/session';
import { listDesigns } from '../../_lib/repo';
import { Icon } from '../../_components/icons';
import { Card, Empty, PageHeader, StatusBadge, btn, fmtDate, linkCls } from '../../_components/ui';
import { ActionButton, UploadForm } from '../../_components/form';

export const metadata: Metadata = { title: 'Designer queue' };

const TABS: { key: string; label: string; statuses: DesignStatus[] }[] = [
  { key: 'in_review', label: 'Waiting', statuses: ['in_review'] },
  { key: 'approved', label: 'Approved', statuses: ['approved'] },
  { key: 'rejected', label: 'Rejected', statuses: ['rejected'] },
];

// Hàng chờ designer (#11): ảnh gốc, tên bé, ghi chú → upload bản làm tay → duyệt / từ chối.
export default async function DesignsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  await requireAdminPage();
  const q = (await searchParams).status;
  const tab = TABS.find((t) => t.key === q) ?? TABS[0];
  const designs = listDesigns(tab.statuses);
  return (
    <>
      <PageHeader title="Designer queue" description="Customers who chose Designer finish. Read the notes, make the artwork by hand, upload it, then approve. Oldest first." />
      <nav aria-label="Filter" className="mb-4 flex flex-wrap gap-2">
        {TABS.map((t) => (
          <Link key={t.key} href={`/admin/designs?status=${t.key}`} aria-current={t === tab ? 'page' : undefined}
            className={`inline-flex min-h-11 items-center rounded-full border px-4 text-sm font-medium ${t === tab ? 'border-primary bg-primary text-on-primary' : 'border-border bg-card hover:border-foreground'}`}>{t.label}</Link>
        ))}
      </nav>
      {designs.length === 0 ? <Empty>{tab.key === 'in_review' ? 'Nothing waiting for a designer.' : `No ${tab.label.toLowerCase()} designs.`}</Empty> : (
        <ul className="grid gap-6">
          {designs.map((d) => (
            <li key={d.id} id={d.id} className="scroll-mt-4">
              <Card>
                <div className="mb-4 flex flex-wrap items-center gap-2">
                  <h2 className="text-xl font-semibold">{d.pet_name || 'No pet name given'}</h2>
                  <StatusBadge status={d.status} />
                  <span className="text-sm text-muted-foreground">{d.id} · {d.product_title ?? 'Unknown product'}{d.variant_size ? ` · ${d.variant_size}` : ''}{d.print_px ? ` · print ${d.print_px}px` : ''}</span>
                </div>
                <div className="grid gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,1.2fr)]">
                  <div className="grid grid-cols-2 content-start gap-3">
                  <figure>
                    {d.upload_url
                      ? <a href={d.upload_url} target="_blank" rel="noopener" className="block"><Image src={d.upload_url} alt={`Original photo of ${d.pet_name || 'the pet'} from the customer`} width={320} height={320} unoptimized className="aspect-square w-full rounded-[var(--radius)] border border-border bg-muted object-contain" /></a>
                      : <div className="flex aspect-square items-center justify-center rounded-[var(--radius)] border border-dashed border-border text-sm text-muted-foreground">No photo</div>}
                    <figcaption className="mt-1 text-xs text-muted-foreground">Customer photo{d.upload_size ? ` · ${d.upload_size} px` : ''}{d.upload_url && ' · opens full size'}</figcaption>
                  </figure>
                  <figure>
                    {d.preview_url
                      ? <Image src={d.preview_url} alt={`Finished artwork for ${d.pet_name || 'the pet'}`} width={320} height={320} unoptimized className="aspect-square w-full rounded-[var(--radius)] border border-border object-cover" />
                      : <div className="flex aspect-square items-center justify-center rounded-[var(--radius)] border border-dashed border-border p-4 text-center text-xs text-muted-foreground sm:text-sm">No artwork uploaded yet</div>}
                    <figcaption className="mt-1 text-xs text-muted-foreground">Artwork preview</figcaption>
                  </figure>
                  </div>
                  <div className="grid content-start gap-4">
                    <div>
                      <h3 className="text-sm font-semibold">Customer notes</h3>
                      <p className="mt-1 whitespace-pre-wrap text-sm">{d.notes || <span className="text-muted-foreground">No notes</span>}</p>
                    </div>
                    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm">
                      <dt className="text-muted-foreground">Style</dt><dd>{d.style ?? '—'}</dd>
                      <dt className="text-muted-foreground">Email</dt><dd className="break-all">{d.email ?? '—'}</dd>
                      <dt className="text-muted-foreground">Orders</dt><dd>{d.orders.length ? d.orders.map((o) => <Link key={o.id} href={`/admin/orders/${o.id}`} className={`${linkCls} mr-2`}>{o.number}</Link>) : 'Not ordered yet'}</dd>
                      <dt className="text-muted-foreground">Waiting since</dt><dd>{fmtDate(d.updated_at)}</dd>
                    </dl>
                    {d.status !== 'approved' && (
                      <UploadForm action={`/api/admin/designs/${d.id}/artwork`} label={d.has_print ? 'Replace artwork' : 'Hand-made artwork'} accept="image/png,image/jpeg,image/webp,image/tiff"
                        hint={`PNG, JPEG, WebP or TIFF up to 40 MB. Saved as a ${d.print_px ?? 2000}×${d.print_px ?? 2000} px sRGB PNG at 300 dpi.`} />
                    )}
                    <div className="flex flex-wrap gap-2 border-t border-border pt-4">
                      {d.has_print && <a href={`/api/admin/designs/${d.id}/print`} download className={`${btn.base} ${btn.outline}`}><Icon name="download" /> Print file</a>}
                      {d.status === 'in_review' && (
                        <>
                          <ActionButton action={`/api/admin/designs/${d.id}`} payload={{ status: 'approved' }} label="Approve" icon="check" tone="accent" />
                          <ActionButton action={`/api/admin/designs/${d.id}`} payload={{ status: 'rejected' }} label="Reject" icon="x" tone="danger"
                            confirm={`Reject design ${d.id}? ${d.email ? 'The customer is emailed to send a different photo.' : 'There is no customer email on file.'}`} />
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
