// Vòng lặp worker: claim job → xử lý → lặp. Chạy như process riêng (npm run worker) hoặc trong process Next
// (WORKER_INLINE=1, qua src/instrumentation.ts). Nhiều worker cùng DB an toàn nhờ claim nguyên tử.
import { db } from '../lib/db';
import { getSettings } from '../lib/settings';
import { nowIso, transition } from '../lib/personalize/designs';
import { claimNext, finishJob, type JobRow } from '../lib/personalize/jobs';
import { purgeExpiredUploads } from '../lib/personalize/retention';
import { FAILED_MESSAGE, jobTimeoutMs, processJob } from './process';

const POLL_MS = 1000;
const PURGE_EVERY_MS = 60 * 60_000;
const REAP_EVERY_MS = 60_000;

type WorkerState = { running: boolean; wake: () => void; stop: () => Promise<void> };
// Cùng khoá với wakeWorker() trong lib/personalize/jobs.ts (route handler và instrumentation là 2 bundle khác nhau).
const g = globalThis as typeof globalThis & { __pearlWorker?: WorkerState };

/** Job 'running' quá hạn (worker chết giữa chừng) → failed để design không kẹt ở generating. */
export function reapStale(now = Date.now()): number {
  const s = getSettings();
  const rows = db().prepare("SELECT * FROM jobs WHERE status = 'running'").all() as JobRow[];
  let n = 0;
  for (const j of rows) {
    const started = Date.parse(j.started_at ?? '');
    // Gấp đôi hạn của processJob: chỉ bắt job mà không worker nào còn giữ.
    if (Number.isFinite(started) && now - started > 2 * jobTimeoutMs(j, s)) {
      finishJob(j.id, 'failed', j.kind === 'ai_generate' ? FAILED_MESSAGE : 'Print render was interrupted.');
      if (j.kind === 'ai_generate') { try { transition(j.design_id, 'job_failed'); } catch { /* đã đổi */ } }
      n++;
    }
  }
  return n;
}

function housekeeping() {
  try {
    const purged = purgeExpiredUploads();
    if (purged) console.log(`[worker] purged ${purged} expired upload(s) at ${nowIso()}`);
  } catch (e) { console.error('[worker] purge failed', e); }
}

export function startWorker(label = 'worker'): WorkerState {
  if (g.__pearlWorker?.running) return g.__pearlWorker;
  let stopped = false;
  let sleeping: { timer: ReturnType<typeof setTimeout>; resolve: () => void } | null = null;
  const nap = (ms: number) => new Promise<void>((resolve) => { sleeping = { timer: setTimeout(resolve, ms), resolve }; });
  const wake = () => { if (sleeping) { clearTimeout(sleeping.timer); const r = sleeping.resolve; sleeping = null; r(); } };

  const loop = (async () => {
    console.log(`[${label}] started (pid ${process.pid})`);
    let lastPurge = 0, lastReap = 0;
    while (!stopped) {
      const now = Date.now();
      if (now - lastPurge > PURGE_EVERY_MS) { housekeeping(); lastPurge = now; }
      if (now - lastReap > REAP_EVERY_MS) { try { reapStale(); } catch (e) { console.error(`[${label}] reap failed`, e); } lastReap = now; }
      let job: JobRow | null = null;
      try { job = claimNext(); } catch (e) { console.error(`[${label}] claim failed`, e); }
      if (job) { await processJob(job); continue; }
      await nap(POLL_MS);
    }
    console.log(`[${label}] stopped`);
  })();

  const state: WorkerState = {
    running: true,
    wake,
    stop: async () => { stopped = true; wake(); await loop; state.running = false; },
  };
  g.__pearlWorker = state;
  return state;
}
