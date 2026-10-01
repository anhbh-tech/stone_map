// Hàng đợi job trong bảng jobs (SQLite). API ghi job 'queued'; worker (process riêng hoặc inline) claim nguyên tử.
import { db, json } from '../db';
import { newId } from '../ids';
import { getSettings } from '../settings';
import type { JobStage, JobStatus, Settings } from '../types';
import { FAILED_MESSAGE, STEP_MESSAGES, type JobStepView, type JobViewV2 } from './contract';
import { designViewV2, getDesign, nowIso } from './designs';
import { engineName } from './engine';
import { pcConfig } from './pearl-compare';
import { DEFAULT_PC_MS, DEFAULT_REAL_MS, DEFAULT_RENDER_MS, HISTORY_SIZE, etaMs, progressOf, typicalMs, type QueueItem } from './eta';

export type JobKind = 'ai_generate' | 'render_print';
export type JobRow = {
  id: string; design_id: string; kind: JobKind; status: JobStatus; stage: JobStage | null; provider: string; model: string;
  attempts: number; error: string | null; check_result: string | null; queued_at: string; started_at: string | null; finished_at: string | null;
  ext_id: string | null; progress: number | null; steps: string | null;   // v2: job pearl_compare, progress thật, JobStepView[]
};

/** Parse cả ISO của JS lẫn 'YYYY-MM-DD HH:MM:SS' (UTC) của datetime('now'). */
export function parseTs(s: string | null | undefined): number | null {
  if (!s) return null;
  const t = Date.parse(s.includes('T') ? s : `${s.replace(' ', 'T')}Z`);
  return Number.isFinite(t) ? t : null;
}

export const getJob = (id: string) => db().prepare('SELECT * FROM jobs WHERE id = ?').get(id) as JobRow | undefined;
export const activeJobFor = (designId: string, kind: JobKind = 'ai_generate') =>
  db().prepare("SELECT * FROM jobs WHERE design_id = ? AND kind = ? AND status IN ('queued','running') ORDER BY queued_at DESC LIMIT 1").get(designId, kind) as JobRow | undefined;

export function createJob(designId: string, kind: JobKind, s: Settings): JobRow {
  const id = newId('job');
  // ai_generate chạy ở pearl_compare (thật) hoặc bản giả lập (provider mock); model thật do pearl_compare chọn theo pcConfig().
  const engine = engineName(s);
  const provider = kind === 'ai_generate' ? engine : 'render';
  const model = kind === 'ai_generate' ? (engine === 'mock' ? s.ai.model : pcConfig().modelId) : 'sharp';
  db().prepare("INSERT INTO jobs (id, design_id, kind, status, stage, provider, model, queued_at) VALUES (?, ?, ?, 'queued', 'queued', ?, ?, ?)")
    .run(id, designId, kind, provider, model, nowIso());
  return getJob(id)!;
}

/** Thời lượng chạy thật (ms) của HISTORY_SIZE job thành công gần nhất cùng loại + provider. */
export function recentDurations(kind: string, provider: string): number[] {
  const rows = db().prepare(`SELECT started_at, finished_at FROM jobs WHERE kind = ? AND provider = ? AND status = 'succeeded'
    AND started_at IS NOT NULL AND finished_at IS NOT NULL ORDER BY finished_at DESC LIMIT ?`).all(kind, provider, HISTORY_SIZE) as { started_at: string; finished_at: string }[];
  return rows.map((r) => (parseTs(r.finished_at) ?? 0) - (parseTs(r.started_at) ?? 0)).filter((d) => d > 0);
}

export function fallbackMs(kind: string, provider: string, s: Settings) {
  if (kind === 'render_print') return DEFAULT_RENDER_MS;
  if (provider === 'mock') return s.ai.mock_ms;
  return provider === 'pearl_compare' ? DEFAULT_PC_MS : DEFAULT_REAL_MS;
}

export const stepsOf = (j: JobRow) => json<JobStepView[]>(j.steps, []);

export function jobView(job: JobRow, s: Settings = getSettings(), now = Date.now()): JobViewV2 {
  const queued = parseTs(job.queued_at) ?? now;
  const finished = parseTs(job.finished_at);
  const elapsed = Math.max(0, (finished ?? now) - queued);
  const done = job.status === 'succeeded' || job.status === 'failed' || job.status === 'canceled';

  const typicalCache = new Map<string, number>();
  const typical = (kind: string, provider: string) => {
    const k = `${kind}:${provider}`;
    if (!typicalCache.has(k)) typicalCache.set(k, typicalMs(recentDurations(kind, provider), fallbackMs(kind, provider, s)));
    return typicalCache.get(k)!;
  };
  const item = (j: Pick<JobRow, 'kind' | 'provider' | 'status' | 'started_at'>): QueueItem => ({
    status: j.status === 'running' ? 'running' : 'queued',
    runningMs: j.status === 'running' ? Math.max(0, now - (parseTs(j.started_at) ?? now)) : 0,
    typical: typical(j.kind, j.provider),
  });

  let eta = 0, queuePosition: number | null = null;
  if (!done) {
    // Đứng trước = mọi job đang chạy + job đang chờ xếp trước job này (worker lấy theo rowid = thứ tự insert).
    const ahead = job.status === 'queued'
      ? db().prepare(`SELECT kind, provider, status, started_at FROM jobs WHERE id != ?1 AND (status = 'running'
          OR (status = 'queued' AND rowid < (SELECT rowid FROM jobs WHERE id = ?1)))`)
        .all(job.id) as Pick<JobRow, 'kind' | 'provider' | 'status' | 'started_at'>[]
      : [];
    queuePosition = job.status === 'queued' ? ahead.length : 0;
    eta = etaMs(item(job), ahead.map(item));
  }
  // Progress thật của pearl_compare khi đã có; ETA theo đó: phần còn lại = thời gian đã chạy × (1 − p) / p.
  const real = job.status === 'running' && job.progress != null ? Math.max(0, Math.min(0.99, job.progress)) : null;
  if (real != null && real >= 0.05) {
    const ran = Math.max(1, now - (parseTs(job.started_at) ?? now));
    eta = Math.max(1000, Math.round((ran * (1 - real)) / real));
  }
  const steps = stepsOf(job);
  const current = [...steps].reverse().find((x) => x.status === 'running') ?? steps.at(-1);
  const design = job.status === 'succeeded' ? getDesign(job.design_id) : undefined;
  const failed = job.status === 'failed' && job.kind === 'ai_generate';
  return {
    id: job.id,
    design_id: job.design_id,
    status: job.status,
    stage: job.stage,
    queue_position: queuePosition,
    elapsed_ms: elapsed,
    eta_ms: eta,
    progress: job.status === 'succeeded' ? 1 : done ? 0 : real ?? progressOf(elapsed, eta),
    error: job.error,
    message: failed ? (job.error ?? FAILED_MESSAGE) : job.status === 'queued' || !current ? STEP_MESSAGES.queued : STEP_MESSAGES[current.stage],
    steps,
    fallback: failed ? 'designer_upload' : null,
    design: design ? designViewV2(design) : null,
  };
}

/** Claim nguyên tử job xếp hàng sớm nhất (rowid tăng theo thứ tự insert) (an toàn khi có nhiều worker cùng DB). */
export function claimNext(): JobRow | null {
  const row = db().prepare(`UPDATE jobs SET status = 'running', started_at = ?
    WHERE id = (SELECT id FROM jobs WHERE status = 'queued' ORDER BY rowid LIMIT 1) AND status = 'queued' RETURNING *`).get(nowIso()) as JobRow | undefined;
  return row ?? null;
}

export const setStage = (id: string, stage: JobStage) => db().prepare('UPDATE jobs SET stage = ? WHERE id = ?').run(stage, id);
/** Ghi tiến độ pearl_compare: progress chỉ tăng (pearl_compare đã không giảm; chặn thêm ở đây cho chắc). */
export const setProgress = (id: string, v: { ext_id?: string; progress: number; steps: JobStepView[]; stage: JobStage }) =>
  db().prepare('UPDATE jobs SET ext_id = COALESCE(?, ext_id), progress = MAX(COALESCE(progress, 0), ?), steps = ?, stage = ? WHERE id = ?')
    .run(v.ext_id ?? null, v.progress, JSON.stringify(v.steps), v.stage, id);
export const setCheckResult = (id: string, v: unknown) => db().prepare('UPDATE jobs SET check_result = ? WHERE id = ?').run(JSON.stringify(v), id);
export const checkResultOf = <T>(j: JobRow, fallback: T) => json<T>(j.check_result, fallback);

export function finishJob(id: string, status: 'succeeded' | 'failed' | 'canceled', error: string | null = null) {
  db().prepare('UPDATE jobs SET status = ?, error = ?, finished_at = ? WHERE id = ?').run(status, error, nowIso(), id);
}

/** API gọi sau khi xếp job: worker inline (src/worker/loop.ts) dậy ngay thay vì đợi lượt poll kế. Không có worker inline → no-op. */
export function wakeWorker() {
  (globalThis as typeof globalThis & { __pearlWorker?: { wake: () => void } }).__pearlWorker?.wake();
}
