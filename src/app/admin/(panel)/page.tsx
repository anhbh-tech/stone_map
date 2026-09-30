import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { fmt } from '@/lib/money';
import { requireAdminPage } from '../_lib/session';
import { jobMetrics } from '../_lib/metrics';
import { METRICS, METRIC_FORMAT, RANGES, RANGE_LABEL, attention, overview, type Metric } from '../_lib/analytics';
import { formatChange, formatMetric } from '../_lib/metric-format';
import { searchOrders } from '../_lib/orders';
import { searchDesigns } from '../_lib/designs';
import { hrefWith, pick, type SearchParams } from '../_lib/list';
import { TrendChart } from '../_components/chart';
import { Icon, type IconName } from '../_components/icons';
import { Card, FulfillmentBadge, PageHeader, Table, fmtAgo, linkCls, td, th, tr } from '../_components/ui';

export const metadata: Metadata = { title: 'Home' };

const METRIC_LABEL: Record<Metric, string> = { revenue: 'Revenue', orders: 'Orders', aov: 'Average order value', conversion: 'Conversion rate' };
const METRIC_NOTE: Record<Metric, string> = {
  revenue: 'Order totals, excluding refunded and canceled orders.',
  orders: 'Every order placed, whatever its status now.',
  aov: 'Revenue divided by orders that were not refunded or canceled.',
  conversion: 'Sessions that completed checkout, out of sessions with any storefront event.',
};

const secs = (ms: number | null) => (ms == null ? '—' : ms < 10000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms / 1000)} s`);
const pct = (r: number | null) => (r == null ? '—' : `${(r * 100).toFixed(1)}%`);

export default async function Home({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requireAdminPage();
  const sp = await searchParams;
  const range = pick(sp.range, RANGES, '7d');
  const metric = pick(sp.metric, METRICS, 'revenue');
  const o = overview(range);
  const att = attention();
  const jobs = jobMetrics(range === 'today' ? 1 : range === '7d' ? 7 : 30);
  const recent = searchOrders({ q: '', sort: 'date', dir: 'desc', page: 1, per: 6 }).rows;
  const review = searchDesigns('in_review', { q: '', sort: 'date', dir: 'asc', page: 1, per: 4 });
  const prevLabel = range === 'today' ? 'Yesterday' : 'Previous period';
  const current = range === 'today' ? 'Today' : `Last ${RANGE_LABEL[range]}`;

  const todo: { n: number; label: string; href: string; icon: IconName }[] = [
    { n: att.not_started, label: `paid order${att.not_started === 1 ? '' : 's'} not started`, href: '/admin/orders?tab=unfulfilled', icon: 'bag' },
    { n: att.to_fulfill - att.not_started, label: `order${att.to_fulfill - att.not_started === 1 ? '' : 's'} in production to ship`, href: '/admin/orders?tab=in_production', icon: 'truck' },
    { n: att.designs_review, label: `design${att.designs_review === 1 ? '' : 's'} waiting for review`, href: '/admin/designs', icon: 'brush' },
    { n: att.designs_unassigned, label: `design${att.designs_unassigned === 1 ? '' : 's'} with no designer assigned`, href: '/admin/designs?assignee=unassigned', icon: 'user' },
    { n: att.reviews_pending, label: `review${att.reviews_pending === 1 ? '' : 's'} to moderate`, href: '/admin/reviews?status=pending', icon: 'star' },
    { n: att.jobs_failed_24h, label: `AI job${att.jobs_failed_24h === 1 ? '' : 's'} failed in the last 24 h`, href: '/admin/designs?tab=failed', icon: 'alert' },
  ];
  const open = todo.filter((t) => t.n > 0);

  return (
    <>
      <PageHeader title="Home" description={`Signed in as ${user.username}. All times in UTC.`}
        actions={
          <nav aria-label="Date range" className="flex rounded-[var(--radius)] border border-border bg-card p-0.5">
            {RANGES.map((r) => (
              <Link key={r} href={hrefWith('/admin', sp, { range: r })} aria-current={r === range ? 'page' : undefined}
                className={`inline-flex min-h-11 min-w-11 items-center justify-center rounded-[calc(var(--radius)-3px)] px-3 text-sm font-medium transition-colors duration-150 ${r === range ? 'bg-primary text-on-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}>
                {RANGE_LABEL[r]}
              </Link>
            ))}
          </nav>
        } />

      {/* xl: cột phải (việc cần làm + hàng đợi design) kéo dài 2 hàng để không bỏ trống dưới “Needs attention”. */}
      <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <section aria-labelledby="perf-title" className="min-w-0 rounded-[var(--radius)] border border-border bg-card xl:col-start-1 xl:row-start-1">
          <h2 id="perf-title" className="sr-only">Store performance, {current.toLowerCase()} compared with {prevLabel.toLowerCase()}</h2>
          <nav aria-label="Metric" className="grid grid-cols-2 border-b border-border md:grid-cols-4">
            {o.kpis.map((k, i) => {
              const on = k.metric === metric;
              const c = formatChange(k.change);
              return (
                <Link key={k.metric} href={hrefWith('/admin', sp, { metric: k.metric })} aria-current={on ? 'true' : undefined} data-testid={`kpi-${k.metric}`}
                  className={`relative flex min-h-11 flex-col gap-0.5 px-4 py-3 transition-colors duration-150 sm:px-5 ${i % 2 ? 'border-l border-border' : ''} ${i > 0 && i % 2 === 0 ? 'md:border-l md:border-border' : ''} ${i >= 2 ? 'max-md:border-t max-md:border-border' : ''} ${on ? 'bg-card' : 'bg-muted/40 hover:bg-muted'}`}>
                  {on && <span className="absolute inset-x-0 top-0 h-0.5 bg-foreground" aria-hidden="true" />}
                  <span className={`text-sm ${on ? 'font-semibold text-foreground' : 'text-muted-foreground'}`}>{METRIC_LABEL[k.metric]}</span>
                  <span className="text-xl font-semibold text-foreground tnum sm:text-2xl">{formatMetric(k.value, METRIC_FORMAT[k.metric])}</span>
                  <span className="text-xs text-muted-foreground tnum">
                    {c == null ? 'No prior data' : Math.abs(k.change!) < 0.0005 ? <span className="font-medium">No change</span> : (
                      <span className={`inline-flex items-center gap-0.5 font-medium ${k.change! > 0 ? 'text-success' : 'text-destructive'}`}>
                        <Icon name={k.change! > 0 ? 'arrowUp' : 'arrowDown'} size={12} />{c}
                        <span className="sr-only"> {k.change! > 0 ? 'up' : 'down'}</span>
                      </span>
                    )}
                    <span> vs {formatMetric(k.prev, METRIC_FORMAT[k.metric])}</span>
                  </span>
                </Link>
              );
            })}
          </nav>
          <div className="px-4 py-4 sm:px-5 sm:py-5">
            <p className="mb-3 text-sm text-muted-foreground">{METRIC_NOTE[metric]}</p>
            <TrendChart points={o.series[metric]} format={METRIC_FORMAT[metric]} title={`${METRIC_LABEL[metric]}, ${current.toLowerCase()}`} currentLabel={current} previousLabel={prevLabel} />
          </div>
        </section>

        <div className="grid min-w-0 content-start gap-5 xl:col-start-2 xl:row-span-2 xl:row-start-1">
        <section aria-labelledby="todo-title" className="rounded-[var(--radius)] border border-border bg-card">
          <h2 id="todo-title" className="px-4 pt-4 text-base font-semibold sm:px-5">Needs attention</h2>
          {open.length === 0 ? (
            <p className="flex items-center gap-2 px-4 pb-5 pt-2 text-sm text-muted-foreground sm:px-5"><Icon name="check" className="text-success" /> All caught up. Nothing is waiting on you.</p>
          ) : (
            <ul className="mt-2 pb-2">
              {open.map((t) => (
                <li key={t.href + t.label}>
                  <Link href={t.href} className="group flex min-h-11 items-center gap-3 px-4 py-2 text-sm transition-colors duration-150 hover:bg-muted sm:px-5">
                    <Icon name={t.icon} className="shrink-0 text-muted-foreground" />
                    <span className="flex-1"><strong className="font-semibold tnum">{t.n}</strong> {t.label}</span>
                    <Icon name="chevronRight" size={16} className="text-muted-foreground transition-transform duration-150 group-hover:translate-x-0.5" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
        <Card title="Designs to review" id="queue" flush actions={<Link href="/admin/designs" className={`${linkCls} -my-3 inline-flex min-h-11 items-center text-sm`}>Open queue</Link>}>
          {review.rows.length === 0 ? (
            <p className="px-4 pb-5 text-sm text-muted-foreground sm:px-5">Nothing waiting for a designer.</p>
          ) : (
            <ul className="pb-2">
              {review.rows.map((q) => (
                <li key={q.id}>
                  <Link href={`/admin/designs/${q.id}`} className="flex min-h-11 items-center gap-3 px-4 py-2 transition-colors duration-150 hover:bg-muted sm:px-5">
                    <span className="size-10 shrink-0 overflow-hidden rounded-[calc(var(--radius)-4px)] bg-muted">
                      {(q.preview_url ?? q.upload_url)
                        ? <Image src={(q.preview_url ?? q.upload_url)!} alt="" width={40} height={40} unoptimized className="size-full object-cover" />
                        : <span className="flex size-full items-center justify-center text-muted-foreground"><Icon name="brush" size={16} /></span>}
                    </span>
                    <span className="min-w-0 flex-1 text-sm">
                      <span className="block truncate font-medium">{q.pet_name ?? 'No pet name'} <span className="font-normal text-muted-foreground">· {q.id}</span></span>
                      <span className="block truncate text-xs text-muted-foreground">{q.assignee ? `Assigned to ${q.assignee}` : 'Unassigned'} · waiting {fmtAgo(q.updated_at).replace(' ago', '')}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
        </div>

        <Card title="Recent orders" id="recent" className="xl:col-start-1 xl:row-start-2" flush actions={<Link href="/admin/orders" className={`${linkCls} -my-3 inline-flex min-h-11 items-center text-sm`}>View all orders</Link>}>
          {recent.length === 0 ? (
            <p className="px-4 pb-5 text-sm text-muted-foreground sm:px-5">No orders yet. They appear here as soon as a customer checks out.</p>
          ) : (
            <>
            <ul className="md:hidden">
              {recent.map((r) => (
                <li key={r.id} className="border-t border-border">
                  <Link href={`/admin/orders/${r.id}`} className="block px-4 py-3 transition-colors duration-150 hover:bg-muted">
                    <span className="flex items-baseline justify-between gap-3"><span className="font-medium underline decoration-border underline-offset-4">#{r.number}</span><span className="font-medium tnum">{fmt(r.total_cents)}</span></span>
                    <span className="mt-0.5 block truncate text-sm text-muted-foreground">{r.name} · {fmtAgo(r.created_at)}</span>
                    <span className="mt-2 flex"><FulfillmentBadge status={r.fulfillment} /></span>
                  </Link>
                </li>
              ))}
            </ul>
            <div className="max-md:hidden">
            <Table caption="Six most recent orders" minWidth={520}>
              <thead><tr><th scope="col" className={th}>Order</th><th scope="col" className={th}>Customer</th><th scope="col" className={th}>Fulfillment</th><th scope="col" className={`${th} text-right`}>Total</th></tr></thead>
              <tbody>
                {recent.map((r) => (
                  <tr key={r.id} className={tr}>
                    <td className={td}><Link href={`/admin/orders/${r.id}`} className={linkCls}>#{r.number}</Link><div className="text-xs text-muted-foreground">{fmtAgo(r.created_at)}</div></td>
                    <td className={`${td} max-w-48 truncate`}>{r.name}</td>
                    <td className={td}><FulfillmentBadge status={r.fulfillment} /></td>
                    <td className={`${td} text-right font-medium`}>{fmt(r.total_cents)}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
            </div>
            </>
          )}
        </Card>
      </div>

      <section aria-labelledby="jobs-title" className="mt-8">
        <h2 id="jobs-title" className="text-base font-semibold">AI pipeline</h2>
        <p className="mb-3 text-sm text-muted-foreground">From the jobs and uploads tables, last {range === 'today' ? '24 hours' : range === '7d' ? '7 days' : '30 days'}. Duration is queued → finished, successful jobs only.</p>
        {/* Một dải nối liền như dải KPI (gap-px trên nền border = đường kẻ mảnh), không phải 5 thẻ rời. */}
        <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-[var(--radius)] border border-border bg-border lg:grid-cols-5" data-testid="job-metrics">
          {[
            ['p50 duration', secs(jobs.duration.p50_ms), `${jobs.duration.samples} successful jobs`],
            ['p75 duration', secs(jobs.duration.p75_ms), 'Used for customer ETA'],
            ['Failure rate', pct(jobs.failure_rate), `${jobs.jobs.failed} failed of ${jobs.jobs.succeeded + jobs.jobs.failed} finished`],
            ['Preflight blocked', pct(jobs.preflight_block_rate), `${jobs.uploads.blocked} of ${jobs.uploads.total} uploads`],
            ['In queue now', String(jobs.jobs.pending), 'Queued or running'],
          ].map(([label, value, hint], i) => (
            <div key={label} className={`bg-card px-4 py-3 ${i === 4 ? 'max-lg:col-span-2' : ''}`}>
              <dt className="text-sm text-muted-foreground">{label}</dt>
              <dd className="mt-0.5 text-xl font-semibold text-foreground tnum">{value}</dd>
              <dd className="text-xs text-muted-foreground">{hint}</dd>
            </div>
          ))}
        </dl>
        {jobs.jobs.succeeded + jobs.jobs.failed === 0 && <p className="mt-2 text-sm text-muted-foreground">No AI jobs finished in this period, so duration and failure rate have no data yet.</p>}
        {jobs.by_provider.length > 0 && (
          <div className="mt-3 rounded-[var(--radius)] border border-border bg-card">
            <Table caption="Jobs by provider" minWidth={420}>
              <thead><tr><th scope="col" className={th}>Provider</th><th scope="col" className={`${th} text-right`}>Succeeded</th><th scope="col" className={`${th} text-right`}>Failed</th><th scope="col" className={`${th} text-right`}>p75</th></tr></thead>
              <tbody>
                {jobs.by_provider.map((p) => (
                  <tr key={p.provider} className={tr}><td className={td}>{p.provider}</td><td className={`${td} text-right`}>{p.succeeded}</td><td className={`${td} text-right`}>{p.failed}</td><td className={`${td} text-right`}>{secs(p.p75_ms)}</td></tr>
                ))}
              </tbody>
            </Table>
          </div>
        )}
      </section>
    </>
  );
}
