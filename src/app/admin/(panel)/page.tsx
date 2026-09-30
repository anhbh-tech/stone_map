import type { Metadata } from 'next';
import Link from 'next/link';
import { fmt } from '@/lib/money';
import { requireAdminPage } from '../_lib/session';
import { dashboardCounts, listDesigns, listOrders } from '../_lib/repo';
import { jobMetrics } from '../_lib/metrics';
import { Card, Empty, PageHeader, Stat, StatusBadge, Table, fmtDate, linkCls, td, th } from '../_components/ui';

export const metadata: Metadata = { title: 'Dashboard' };

const secs = (ms: number | null) => (ms == null ? '—' : ms < 10000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms / 1000)} s`);
const pct = (r: number | null) => (r == null ? '—' : `${(r * 100).toFixed(1)}%`);
const WINDOWS = [1, 7, 30];

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  await requireAdminPage();
  const d = Number((await searchParams).days);
  const days = WINDOWS.includes(d) ? d : 7;
  const c = dashboardCounts();
  const m = jobMetrics(days);
  const orders = listOrders('paid', 8);
  const queue = listDesigns(['in_review'], 'designer', 6);

  return (
    <>
      <PageHeader title="Dashboard" description="What needs attention now, and how the AI pipeline is performing." />

      <section aria-labelledby="todo" className="mb-8">
        <h2 id="todo" className="sr-only">Work queues</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Stat label="New orders" value={c.new_orders} hint="Paid, not yet in production" icon="bag" href="/admin/orders?status=paid" />
          <Stat label="Designer queue" value={c.designer_queue} hint="Designs waiting for hand finishing" icon="brush" href="/admin/designs" />
          <Stat label="Reviews to moderate" value={c.reviews_pending} hint="Pending reviews" icon="star" href="/admin/reviews?status=pending" />
          <Stat label="Orders today" value={c.orders_today} hint="UTC day" icon="dashboard" href="/admin/orders" />
        </div>
      </section>

      <section aria-labelledby="jobs-title" className="mb-8">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="jobs-title" className="text-2xl font-semibold">AI jobs</h2>
            <p className="text-sm text-muted-foreground">From the jobs and uploads tables, last {days === 1 ? '24 hours' : `${days} days`}. Duration = queued → finished, successful jobs only.</p>
          </div>
          <nav aria-label="Time window" className="flex gap-1 rounded-[var(--radius)] border border-border bg-card p-1">
            {WINDOWS.map((w) => (
              <Link key={w} href={`/admin?days=${w}`} aria-current={w === days ? 'page' : undefined}
                className={`inline-flex min-h-11 min-w-11 items-center justify-center rounded-[calc(var(--radius)-4px)] px-3 text-sm font-medium ${w === days ? 'bg-primary text-on-primary' : 'hover:bg-muted'}`}>
                {w === 1 ? '24 h' : `${w} d`}
              </Link>
            ))}
          </nav>
        </div>
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-5" data-testid="job-metrics">
          <Stat label="p50 duration" value={secs(m.duration.p50_ms)} hint={`${m.duration.samples} successful jobs`} />
          <Stat label="p75 duration" value={secs(m.duration.p75_ms)} hint="Used for customer ETA" />
          <Stat label="Failure rate" value={pct(m.failure_rate)} hint={`${m.jobs.failed} failed of ${m.jobs.succeeded + m.jobs.failed} finished`} />
          <Stat label="Preflight blocked" value={pct(m.preflight_block_rate)} hint={`${m.uploads.blocked} of ${m.uploads.total} uploads`} />
          <Stat label="In queue now" value={m.jobs.pending} hint="Queued or running" />
        </div>
        {m.by_provider.length > 0 && (
          <div className="mt-3">
            <Table caption="Jobs by provider">
              <thead><tr><th scope="col" className={th}>Provider</th><th scope="col" className={th}>Succeeded</th><th scope="col" className={th}>Failed</th><th scope="col" className={th}>p75</th></tr></thead>
              <tbody>
                {m.by_provider.map((p) => (
                  <tr key={p.provider}><td className={td}>{p.provider}</td><td className={`${td} tabular-nums`}>{p.succeeded}</td><td className={`${td} tabular-nums`}>{p.failed}</td><td className={`${td} tabular-nums`}>{secs(p.p75_ms)}</td></tr>
                ))}
              </tbody>
            </Table>
          </div>
        )}
      </section>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card title="New orders" id="new-orders">
          {orders.length === 0 ? <Empty>No new orders.</Empty> : (
            <ul className="divide-y divide-border">
              {orders.map((o) => (
                <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                  <div className="min-w-0">
                    <Link href={`/admin/orders/${o.id}`} className={linkCls}>{o.number}</Link>
                    <span className="ml-2 text-sm text-muted-foreground">{o.name} · {o.lines} item{o.lines === 1 ? '' : 's'}</span>
                    <div className="text-xs text-muted-foreground">{fmtDate(o.created_at)}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    {o.designs_pending > 0 && <StatusBadge status="in_review" />}
                    <span className="font-medium tabular-nums">{fmt(o.total_cents)}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Designer queue" id="queue">
          {queue.length === 0 ? <Empty>Nothing waiting for a designer.</Empty> : (
            <ul className="divide-y divide-border">
              {queue.map((q) => (
                <li key={q.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                  <div className="min-w-0">
                    <Link href={`/admin/designs#${q.id}`} className={linkCls}>{q.id}</Link>
                    <span className="ml-2 text-sm text-muted-foreground">{q.pet_name ?? 'No pet name'}{q.variant_size ? ` · ${q.variant_size}` : ''}</span>
                    {q.notes && <p className="line-clamp-1 text-xs text-muted-foreground">“{q.notes}”</p>}
                  </div>
                  <span className="text-xs text-muted-foreground">waiting since {fmtDate(q.updated_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
