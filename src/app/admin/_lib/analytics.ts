// Số liệu Home: doanh thu, số đơn, AOV, conversion — tính từ bảng orders và events, không có số gõ tay.
// Mọi mốc thời gian là UTC (created_at của SQLite là datetime('now') UTC). Kỳ trước = cùng độ dài, ngay trước kỳ này.
import { db } from '../../../lib/db';

export const RANGES = ['today', '7d', '30d', '90d'] as const;
export type Range = (typeof RANGES)[number];
export const RANGE_LABEL: Record<Range, string> = { today: 'Today', '7d': '7 days', '30d': '30 days', '90d': '90 days' };
const DAYS: Record<Range, number> = { today: 1, '7d': 7, '30d': 30, '90d': 90 };

export const METRICS = ['revenue', 'orders', 'aov', 'conversion'] as const;
export type Metric = (typeof METRICS)[number];
export type Format = 'money' | 'count' | 'percent';
export const METRIC_FORMAT: Record<Metric, Format> = { revenue: 'money', orders: 'count', aov: 'money', conversion: 'percent' };

/** Đơn không tính vào doanh thu (net sales). */
const EXCLUDED = "('refunded','canceled')";

export type Bounds = { start: Date; end: Date; prevStart: Date; prevEnd: Date; unit: 'hour' | 'day'; buckets: number };

const HOUR = 3600_000;
const DAY = 24 * HOUR;
const utcMidnight = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

/** Today = từ 0h UTC đến giờ, theo giờ; N ngày = N ngày lịch gần nhất (tính cả hôm nay), theo ngày. */
export function rangeBounds(range: Range, now = new Date()): Bounds {
  const days = DAYS[range];
  const start = new Date(utcMidnight(now).getTime() - (days - 1) * DAY);
  const end = now;
  const len = days * DAY;
  return {
    start, end,
    prevStart: new Date(start.getTime() - len),
    prevEnd: new Date(end.getTime() - len),
    unit: range === 'today' ? 'hour' : 'day',
    buckets: range === 'today' ? 24 : days,
  };
}

/** 'YYYY-MM-DD HH:MM:SS', cùng định dạng với datetime('now') nên so sánh chuỗi được. */
export const sqlTime = (d: Date) => d.toISOString().slice(0, 19).replace('T', ' ');
const keyOf = (d: Date, unit: 'hour' | 'day') => (unit === 'hour' ? d.toISOString().slice(0, 13).replace('T', ' ') : d.toISOString().slice(0, 10));
const FMT = { hour: '%Y-%m-%d %H', day: '%Y-%m-%d' } as const;

export type Totals = { revenue: number; orders: number; paid: number; sessions: number; converted: number };
const ZERO: Totals = { revenue: 0, orders: 0, paid: 0, sessions: 0, converted: 0 };

/** Giá trị một chỉ số từ tổng; null khi chưa có mẫu số (hiện “—”, không phải 0). */
export function metricValue(m: Metric, t: Totals): number | null {
  switch (m) {
    case 'revenue': return t.revenue;
    case 'orders': return t.orders;
    case 'aov': return t.paid ? Math.round(t.revenue / t.paid) : null;
    case 'conversion': return t.sessions ? t.converted / t.sessions : null;
  }
}

/** Thay đổi tương đối so với kỳ trước; null khi kỳ trước = 0 hoặc thiếu số. */
export function change(cur: number | null, prev: number | null): number | null {
  if (cur == null || prev == null || prev === 0) return null;
  return (cur - prev) / prev;
}

function totalsBetween(from: Date, to: Date): Totals {
  const d = db();
  const o = d.prepare(`SELECT count(*) AS orders,
      coalesce(sum(CASE WHEN status NOT IN ${EXCLUDED} THEN total_cents END), 0) AS revenue,
      coalesce(sum(CASE WHEN status NOT IN ${EXCLUDED} THEN 1 END), 0) AS paid
    FROM orders WHERE created_at >= ? AND created_at < ?`).get(sqlTime(from), sqlTime(to)) as { orders: number; revenue: number; paid: number };
  const s = d.prepare(`SELECT count(DISTINCT session_id) AS sessions,
      count(DISTINCT CASE WHEN name = 'checkout_completed' THEN session_id END) AS converted
    FROM events WHERE session_id IS NOT NULL AND created_at >= ? AND created_at < ?`).get(sqlTime(from), sqlTime(to)) as { sessions: number; converted: number };
  return { ...o, ...s };
}

function bucketed(from: Date, to: Date, unit: 'hour' | 'day'): Map<string, Totals> {
  const d = db();
  const f = FMT[unit];
  const out = new Map<string, Totals>();
  const get = (k: string) => out.get(k) ?? (out.set(k, { ...ZERO }), out.get(k)!);
  for (const r of d.prepare(`SELECT strftime('${f}', created_at) AS k, count(*) AS orders,
      coalesce(sum(CASE WHEN status NOT IN ${EXCLUDED} THEN total_cents END), 0) AS revenue,
      coalesce(sum(CASE WHEN status NOT IN ${EXCLUDED} THEN 1 END), 0) AS paid
    FROM orders WHERE created_at >= ? AND created_at < ? GROUP BY k`).all(sqlTime(from), sqlTime(to)) as ({ k: string } & Totals)[]) {
    Object.assign(get(r.k), { orders: r.orders, revenue: r.revenue, paid: r.paid });
  }
  for (const r of d.prepare(`SELECT strftime('${f}', created_at) AS k, count(DISTINCT session_id) AS sessions,
      count(DISTINCT CASE WHEN name = 'checkout_completed' THEN session_id END) AS converted
    FROM events WHERE session_id IS NOT NULL AND created_at >= ? AND created_at < ? GROUP BY k`).all(sqlTime(from), sqlTime(to)) as ({ k: string } & Totals)[]) {
    Object.assign(get(r.k), { sessions: r.sessions, converted: r.converted });
  }
  return out;
}

export type Point = { key: string; label: string; value: number | null; prev: number | null; future: boolean };
export type Kpi = { metric: Metric; value: number | null; prev: number | null; change: number | null };
export type Overview = { range: Range; bounds: Bounds; kpis: Kpi[]; series: Record<Metric, Point[]> };

/** Nhãn trục X: giờ (“14:00”) hoặc ngày (“Sep 30”). */
export const bucketLabel = (d: Date, unit: 'hour' | 'day') =>
  unit === 'hour' ? `${String(d.getUTCHours()).padStart(2, '0')}:00` : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

export function overview(range: Range, now = new Date()): Overview {
  const b = rangeBounds(range, now);
  const cur = totalsBetween(b.start, b.end);
  const prev = totalsBetween(b.prevStart, b.prevEnd);
  const kpis = METRICS.map((metric) => {
    const value = metricValue(metric, cur);
    const p = metricValue(metric, prev);
    return { metric, value, prev: p, change: change(value, p) };
  });

  // Kỳ trước lấy trọn kỳ (không cắt ở "giờ này") để đường so sánh đủ điểm.
  const step = b.unit === 'hour' ? HOUR : DAY;
  const curB = bucketed(b.start, new Date(b.start.getTime() + b.buckets * step), b.unit);
  const prevB = bucketed(b.prevStart, b.start, b.unit);
  const series = Object.fromEntries(METRICS.map((m) => [m, [] as Point[]])) as Record<Metric, Point[]>;
  for (let i = 0; i < b.buckets; i++) {
    const at = new Date(b.start.getTime() + i * step);
    const future = at.getTime() > now.getTime();
    const c = curB.get(keyOf(at, b.unit)) ?? ZERO;
    const p = prevB.get(keyOf(new Date(at.getTime() - b.buckets * step), b.unit)) ?? ZERO;
    for (const m of METRICS) {
      series[m].push({ key: keyOf(at, b.unit), label: bucketLabel(at, b.unit), value: future ? null : metricValue(m, c) ?? (m === 'aov' || m === 'conversion' ? null : 0), prev: metricValue(m, p), future });
    }
  }
  return { range, bounds: b, kpis, series };
}

/** Việc đang chờ: hiện trên Home và badge ở sidebar. */
export function attention() {
  const d = db();
  const n = (sql: string) => (d.prepare(sql).get() as { n: number }).n;
  return {
    to_fulfill: n("SELECT count(*) AS n FROM orders WHERE status IN ('paid','in_production')"),
    not_started: n("SELECT count(*) AS n FROM orders WHERE status = 'paid'"),
    designs_review: n("SELECT count(*) AS n FROM designs WHERE status = 'in_review'"),
    designs_unassigned: n("SELECT count(*) AS n FROM designs WHERE status = 'in_review' AND assignee_id IS NULL"),
    reviews_pending: n("SELECT count(*) AS n FROM reviews WHERE status = 'pending'"),
    jobs_failed_24h: n("SELECT count(*) AS n FROM jobs WHERE status = 'failed' AND finished_at >= datetime('now', '-1 day')"),
  };
}
