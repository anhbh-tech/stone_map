// Số liệu job cho dashboard + GET /api/admin/metrics/jobs: tính từ bảng jobs / uploads, không có số gõ tay.
import { db } from '../../../lib/db';

export type JobMetrics = {
  window_days: number;
  jobs: { total: number; succeeded: number; failed: number; canceled: number; pending: number };
  duration: { samples: number; p50_ms: number | null; p75_ms: number | null };   // queued → finished, job thành công
  failure_rate: number | null;          // failed / (succeeded + failed)
  uploads: { total: number; blocked: number };
  preflight_block_rate: number | null;  // uploads có preflight.ok = false / tổng upload
  by_provider: { provider: string; succeeded: number; failed: number; p75_ms: number | null }[];
};

/** Percentile kiểu nearest-rank trên mảng số (không cần sắp xếp trước). */
export function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * s.length);
  return s[Math.min(s.length, Math.max(1, rank)) - 1];
}

const ratio = (n: number, d: number) => (d > 0 ? n / d : null);

export function jobMetrics(windowDays = 7): JobMetrics {
  const d = db();
  const since = `-${Math.max(1, Math.floor(windowDays))} days`;
  const jobs = d.prepare(`SELECT status, provider,
      CASE WHEN finished_at IS NOT NULL THEN (julianday(finished_at) - julianday(queued_at)) * 86400000 END AS ms
    FROM jobs WHERE julianday(queued_at) >= julianday('now', ?)`).all(since) as { status: string; provider: string; ms: number | null }[];

  const count = (st: string) => jobs.filter((j) => j.status === st).length;
  const succeeded = count('succeeded');
  const failed = count('failed');
  const okDurations = jobs.filter((j) => j.status === 'succeeded' && j.ms != null && j.ms >= 0).map((j) => Math.round(j.ms!));

  const providers = [...new Set(jobs.map((j) => j.provider))].sort();
  const by_provider = providers.map((provider) => {
    const js = jobs.filter((j) => j.provider === provider);
    const ok = js.filter((j) => j.status === 'succeeded' && j.ms != null && j.ms >= 0).map((j) => Math.round(j.ms!));
    return { provider, succeeded: ok.length, failed: js.filter((j) => j.status === 'failed').length, p75_ms: percentile(ok, 75) };
  });

  const up = d.prepare(`SELECT count(*) AS total,
      coalesce(sum(CASE WHEN json_valid(preflight) AND json_extract(preflight, '$.ok') = 0 THEN 1 ELSE 0 END), 0) AS blocked
    FROM uploads WHERE julianday(created_at) >= julianday('now', ?)`).get(since) as { total: number; blocked: number };

  return {
    window_days: Math.max(1, Math.floor(windowDays)),
    jobs: { total: jobs.length, succeeded, failed, canceled: count('canceled'), pending: count('queued') + count('running') },
    duration: { samples: okDurations.length, p50_ms: percentile(okDurations, 50), p75_ms: percentile(okDurations, 75) },
    failure_rate: ratio(failed, succeeded + failed),
    uploads: { total: up.total, blocked: up.blocked },
    preflight_block_rate: ratio(up.blocked, up.total),
    by_provider,
  };
}
