import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAdminPage } from '../../../_lib/session';
import { getDesignDetail } from '../../../_lib/designs';
import { listStaff, staffName } from '../../../_lib/staff';
import { Icon } from '../../../_components/icons';
import { AssignSelect } from '../../../_components/assign';
import { Card, PageHeader, StatusBadge, Table, btn, fmtDate, linkCls, td, th, tr } from '../../../_components/ui';
import { ActionButton, UploadForm } from '../../../_components/form';

type P = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: P): Promise<Metadata> {
  return { title: `Design ${(await params).id}` };
}

const secs = (ms: number | null) => (ms == null ? '—' : `${(ms / 1000).toFixed(1)} s`);

function Figure({ src, alt, caption, empty, href }: { src: string | null; alt: string; caption: string; empty: string; href?: boolean }) {
  const img = src && <Image src={src} alt={alt} width={480} height={480} unoptimized className="aspect-square w-full rounded-[var(--radius)] border border-border bg-muted object-contain" />;
  return (
    <figure className="min-w-0">
      {src ? (href ? <a href={src} target="_blank" rel="noopener" className="block">{img}</a> : img)
        : <div className="flex aspect-square items-center justify-center rounded-[var(--radius)] border border-dashed border-border p-4 text-center text-sm text-muted-foreground">{empty}</div>}
      <figcaption className="mt-1 text-xs text-muted-foreground">{caption}</figcaption>
    </figure>
  );
}

export default async function DesignPage({ params }: P) {
  await requireAdminPage();
  const d = getDesignDetail((await params).id);
  if (!d) notFound();
  const staff = listStaff().map((m) => ({ id: m.id, name: staffName(m), role: m.role }));
  const handoff = ['ready', 'confirmed', 'failed'].includes(d.status);
  const lastError = d.jobs.find((j) => j.error)?.error;

  return (
    <>
      <PageHeader title={d.pet_name || 'No pet name given'} back={{ href: d.status === 'in_review' ? '/admin/designs' : `/admin/designs?tab=${d.status === 'failed' ? 'failed' : d.status === 'approved' || d.status === 'rejected' ? d.status : 'ai'}`, label: 'Designs' }}
        meta={<StatusBadge status={d.status} />}
        description={<>{d.id} · {d.mode === 'ai' ? 'Generated with AI' : 'Photo for designer'} · created {fmtDate(d.created_at)}</>} />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="grid min-w-0 content-start gap-5">
          <Card title="Artwork" id="artwork">
            <div className="grid gap-3 sm:grid-cols-3">
              <Figure src={d.upload_url} alt={`Customer photo of ${d.pet_name || 'the pet'}`} caption={`Customer photo${d.upload_size ? ` · ${d.upload_size} px` : ''}`} empty="No photo" href />
              <Figure src={d.preview_url} alt={`${d.mode === 'ai' ? 'AI preview' : 'Artwork preview'} for ${d.pet_name || 'the pet'}`} caption={d.mode === 'ai' ? 'AI preview' : 'Artwork preview'} empty={d.status === 'failed' ? 'Generation failed' : 'No preview yet'} />
              <Figure src={d.mockup_url} alt={`Product mockup for ${d.pet_name || 'the pet'}`} caption="Mockup" empty="No mockup" />
            </div>
            {lastError && (
              <p role="note" className="mt-4 flex gap-2 rounded-[var(--radius)] border border-destructive bg-background px-3 py-2 text-sm">
                <Icon name="alert" className="mt-0.5 shrink-0 text-destructive" /><span><strong className="font-semibold">Last job error:</strong> {lastError}</span>
              </p>
            )}
          </Card>

          {d.status === 'in_review' && (
            <Card title="Finish and approve" id="review">
              <div className="grid gap-4">
                <UploadForm action={`/api/admin/designs/${d.id}/artwork`} label={d.has_print ? 'Replace artwork' : 'Hand-made artwork'} accept="image/png,image/jpeg,image/webp,image/tiff"
                  hint={`PNG, JPEG, WebP or TIFF up to 40 MB. Saved as a ${d.print_px ?? 2000}×${d.print_px ?? 2000} px sRGB PNG at 300 dpi.`} />
                <div className="flex flex-wrap gap-2 border-t border-border pt-4">
                  <ActionButton action={`/api/admin/designs/${d.id}`} payload={{ status: 'approved' }} label="Approve" icon="check" tone="primary" />
                  <ActionButton action={`/api/admin/designs/${d.id}`} payload={{ status: 'rejected' }} label="Reject" icon="x" tone="danger"
                    confirm={`Reject design ${d.id}? ${d.email ? 'The customer is emailed to send a different photo.' : 'There is no customer email on file.'}`} />
                </div>
              </div>
            </Card>
          )}

          <Card title="AI jobs" id="jobs" flush description={d.jobs.length ? 'Newest first. Duration is queued → finished.' : undefined}>
            {d.jobs.length === 0 ? <p className="px-4 pb-5 text-sm text-muted-foreground sm:px-5">No AI jobs for this design{d.mode === 'designer' ? ': the customer chose a designer finish.' : '.'}</p> : (
              <Table caption="AI jobs for this design" minWidth={640}>
                <thead><tr><th scope="col" className={th}>Job</th><th scope="col" className={th}>Status</th><th scope="col" className={th}>Model</th><th scope="col" className={`${th} text-right`}>Attempts</th><th scope="col" className={`${th} text-right`}>Duration</th><th scope="col" className={th}>Queued</th></tr></thead>
                <tbody>
                  {d.jobs.map((j) => (
                    <tr key={j.id} className={tr}>
                      <td className={`${td} font-mono text-xs`}>{j.id}</td>
                      <td className={td}><StatusBadge status={j.status === 'succeeded' ? 'approved' : j.status === 'failed' ? 'failed' : 'pending'} label={j.status} />{j.stage && <span className="ml-1 text-xs text-muted-foreground">{j.stage}</span>}</td>
                      <td className={`${td} text-sm`}>{j.provider} · {j.model}</td>
                      <td className={`${td} text-right`}>{j.attempts}</td>
                      <td className={`${td} text-right`}>{secs(j.ms)}</td>
                      <td className={`${td} whitespace-nowrap text-muted-foreground`}>{fmtDate(j.queued_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
        </div>

        <div className="grid content-start gap-5">
          <Card title="Assignment" id="assign">
            <AssignSelect designId={d.id} value={d.assignee_id} staff={staff} />
            {handoff && (
              <div className="mt-4 border-t border-border pt-4">
                <p className="mb-2 text-sm text-muted-foreground">Not good enough to print? Send it to the designer queue. The customer keeps their order.</p>
                <ActionButton action={`/api/admin/designs/${d.id}`} payload={{ status: 'in_review' }} label="Hand to designer" icon="brush" confirm={`Send ${d.pet_name || d.id} to the designer queue?`} />
              </div>
            )}
          </Card>
          <Card title="Details" id="details">
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-sm">
              <dt className="text-muted-foreground">Product</dt><dd>{d.product_title ?? 'Unknown'}{d.variant_size ? ` · ${d.variant_size}` : ''}</dd>
              <dt className="text-muted-foreground">Print size</dt><dd>{d.print_px ? `${d.print_px} px` : '—'}</dd>
              <dt className="text-muted-foreground">Style</dt><dd>{d.style ?? '—'}</dd>
              <dt className="text-muted-foreground">Email</dt><dd className="break-all">{d.email ?? '—'}</dd>
              <dt className="text-muted-foreground">Orders</dt><dd>{d.orders.length ? d.orders.map((o) => <Link key={o.id} href={`/admin/orders/${o.id}`} className={`${linkCls} mr-2`}>#{o.number}</Link>) : 'Not ordered yet'}</dd>
              <dt className="text-muted-foreground">Confirmed</dt><dd>{d.confirmed_at ? fmtDate(d.confirmed_at) : '—'}</dd>
              <dt className="text-muted-foreground">Updated</dt><dd>{fmtDate(d.updated_at)}</dd>
              <dt className="text-muted-foreground">Print file</dt><dd>{d.has_print ? <a href={`/api/admin/designs/${d.id}/print`} download className={`${linkCls} inline-flex items-center gap-1`}><Icon name="download" size={14} />Download</a> : 'Not rendered'}</dd>
            </dl>
          </Card>
          <Card title="Customer notes" id="notes">
            <p className="whitespace-pre-wrap text-sm">{d.notes || <span className="text-muted-foreground">No notes</span>}</p>
          </Card>
          {d.has_print && d.status !== 'in_review' && <a href={`/api/admin/designs/${d.id}/print`} download className={`${btn.base} ${btn.outline}`}><Icon name="download" /> Print file</a>}
        </div>
      </div>
    </>
  );
}
