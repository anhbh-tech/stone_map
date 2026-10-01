// Xử lý 1 job. ai_generate: gửi ảnh pet sang pearl_compare (POST /api/cutout) → poll job (progress thật) → chép final +
// cutout về storage. render_print: file in print_px² + mockup từ final (v2) hoặc theo transform (design cũ).
import fs from 'node:fs';
import sharp from 'sharp';
import { db, json } from '../lib/db';
import { getVariant } from '../lib/catalog';
import { getSettings } from '../lib/settings';
import type { JobStage, Settings } from '../lib/types';
import { FAILED_MESSAGE, type JobStepStage, type JobStepView } from '../lib/personalize/contract';
import { designView, getDesign, getUpload, nowIso, transition, TransitionError, uploadAvailable, type DesignRow } from '../lib/personalize/designs';
import { queuePreviewReady } from '../lib/personalize/email';
import { engineFor, importJob, isPcTheme, noFinalReason } from '../lib/personalize/engine';
import { fallbackMs, finishJob, recentDurations, setCheckResult, setProgress, setStage, type JobRow } from '../lib/personalize/jobs';
import { typicalMs } from '../lib/personalize/eta';
import { cutoutBody, pcConfig, PcError, type PcClient, type PcJob } from '../lib/personalize/pearl-compare';
import { IDENTITY, renderMockup, renderPrint, TransformSchema, type Transform } from '../lib/personalize/render';
import { removeStored, storagePath, writeStored } from '../lib/personalize/storage';

export { FAILED_MESSAGE };
export type Sleep = (ms: number) => Promise<void>;
export const realSleep: Sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Aborted extends Error {}
type Ctx = { aborted: boolean };
const guard = (ctx: Ctx) => { if (ctx.aborted) throw new Aborted('job timed out'); };

/**
 * Thời gian tối đa 1 job: 3× typical. Mock / file in: 60 s … 10 phút. pearl_compare (cảnh + cutout + 1 lần sửa ở 2K):
 * 6 … 15 phút. Quá hạn → failed + nhánh designer (progress không treo mãi).
 */
export function jobTimeoutMs(job: Pick<JobRow, 'kind' | 'provider'>, s: Settings): number {
  const t = typicalMs(recentDurations(job.kind, job.provider), fallbackMs(job.kind, job.provider, s));
  if (job.kind === 'ai_generate' && job.provider === 'pearl_compare') return Math.min(15 * 60_000, Math.max(6 * 60_000, 3 * t));
  return Math.min(10 * 60_000, Math.max(60_000, 3 * t));
}

const tagOf = (job: JobRow) => job.id.slice(-8).replace(/[^A-Za-z0-9_-]/g, '');

export function transformOf(d: DesignRow): Transform {
  if (d.pc) return IDENTITY;                           // v2: final đã render theo transform của khách
  const r = TransformSchema.safeParse(json(d.transform, {}));
  return r.success ? r.data : IDENTITY;
}

/** Cạnh file in: size khách chọn; chưa chọn → size lớn nhất của sản phẩm (in được mọi size). */
export function printPxFor(d: DesignRow): number {
  const v = d.variant_id ? getVariant(d.variant_id) : undefined;
  if (v && v.product_id === d.product_id) return v.print_px;
  const r = db().prepare('SELECT MAX(print_px) px FROM variants WHERE product_id = ?').get(d.product_id) as { px: number | null };
  return r.px ?? 2000;
}

const STAGE: Record<JobStepStage, JobStage> = { analyze: 'analyzing', scene: 'generating', cutout: 'generating', fix: 'checking', final: 'rendering' };
const KNOWN = new Set<string>(Object.keys(STAGE));
/** Bước pearl_compare → JobStepView (gộp các model cùng bước) + stage của pearl_store. */
export function stepsView(j: PcJob): { steps: JobStepView[]; stage: JobStage } {
  const by = new Map<JobStepStage, JobStepView>();
  for (const st of j.steps ?? []) {
    if (!KNOWN.has(st.stage)) continue;
    const k = st.stage as JobStepStage, prev = by.get(k);
    const status = prev?.status === 'running' || st.status === 'running' ? 'running' : prev?.status === 'error' || st.status === 'error' ? 'error' : 'done';
    by.set(k, { stage: k, status });
  }
  const steps = [...by.values()];
  const cur = [...steps].reverse().find((x) => x.status === 'running') ?? steps.at(-1);
  return { steps, stage: cur ? STAGE[cur.stage] : 'analyzing' };
}

/** Ảnh pet gửi pearl_compare: ≤ 1024 px (OUTPUT.md §3), JPEG, data URL. */
async function refDataUrl(path: string): Promise<string> {
  const buf = await sharp(fs.readFileSync(path)).rotate().resize(1024, 1024, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 90 }).toBuffer();
  return `data:image/jpeg;base64,${buf.toString('base64')}`;
}

const MAX_POLL_ERRORS = 5;

async function generate(job: JobRow, s: Settings, client: PcClient, sleep: Sleep, ctx: Ctx) {
  const d = getDesign(job.design_id);
  if (!d) throw new Error(`design ${job.design_id} missing`);
  if (!isPcTheme(d.style)) throw new PcError('rejected', `style ${d.style} has no pearl_compare theme`);
  const up = d.upload_id ? getUpload(d.upload_id) : undefined;
  if (!up || !uploadAvailable(up)) throw new Error('upload missing or expired');

  setStage(job.id, 'analyzing');
  let pj = await client.startCutout(cutoutBody(d.style, await refDataUrl(storagePath(up.path))));
  guard(ctx);
  setProgress(job.id, { ext_id: pj.id, progress: pj.progress ?? 0, ...stepsView(pj) });
  let errors = 0;
  while (pj.status === 'running') {
    await sleep(pcConfig().pollMs);
    guard(ctx);
    let next: PcJob | null;
    try { next = await client.job(pj.id); errors = 0; } catch (e) {
      // Mạng chập chờn: thử lại vài lượt rồi mới bỏ; timeout tổng của job vẫn chặn trên.
      if (++errors >= MAX_POLL_ERRORS) throw e;
      continue;
    }
    if (!next) throw new PcError('unavailable', `pearl_compare lost job ${pj.id} (restarted?)`);
    pj = next;
    setProgress(job.id, { progress: pj.progress ?? 0, ...stepsView(pj) });
  }
  guard(ctx);
  setCheckResult(job.id, { engine: client.name, pc_job: pj.id, notes: pj.notes ?? [], scene: pj.scene ?? null,
    cutouts: pj.cutouts.map((c) => ({ model: c.model, cutout: c.cutout, final: c.final, pass: c.pass, why: c.why })) });
  if (pj.status === 'error') throw new PcError('error', `pearl_compare job ${pj.id}: ${noFinalReason(pj)}`);

  setStage(job.id, 'rendering');
  const imp = await importJob(client, d.id, tagOf(job), pj);
  guard(ctx);
  let next: DesignRow;
  try {
    next = transition(d.id, 'job_succeeded', { ...imp, print_path: null });
  } catch (e) {
    [imp.source_path, imp.preview_path, imp.mockup_path, imp.cutout_path].forEach(removeStored);
    throw e;
  }
  for (const k of ['preview_path', 'mockup_path', 'source_path', 'cutout_path'] as const) {
    if (d[k] !== next[k]) removeStored(d[k]);
  }
  finishJob(job.id, 'succeeded');
  queuePreviewReady(next, designView(next).preview_url, s);
}

async function renderPrintJob(job: JobRow, ctx: Ctx) {
  setStage(job.id, 'rendering');
  const d = getDesign(job.design_id);
  if (!d?.source_path) throw new Error(`design ${job.design_id} has no generated image`);
  const src = fs.readFileSync(storagePath(d.source_path));
  const t = transformOf(d);
  const [print, mockup] = await Promise.all([renderPrint(src, t, printPxFor(d)), renderMockup(src, t)]);
  guard(ctx);
  const tag = tagOf(job);
  const print_path = writeStored('print', `${d.id}-${tag}.png`, print);
  const mockup_path = writeStored('mockups', `${d.id}-${tag}.webp`, mockup);
  db().prepare('UPDATE designs SET print_path = ?, mockup_path = ?, updated_at = ? WHERE id = ?').run(print_path, mockup_path, nowIso(), d.id);
  if (d.print_path !== print_path) removeStored(d.print_path);
  if (d.mockup_path !== mockup_path) removeStored(d.mockup_path);
  finishJob(job.id, 'succeeded');
}

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

const OFFLINE_MESSAGE = 'Our pearl studio is offline right now. Upload your original photo and our designers will make it by hand, or try again in a few minutes.';
const SLOW_MESSAGE = 'Your preview is taking longer than it should. Upload your original photo and our designers will make it by hand, or try again.';
/** Câu cho khách theo loại lỗi (chi tiết kỹ thuật chỉ vào log + check_result cho admin). */
export function failureMessage(e: unknown): string {
  if (e instanceof Aborted || (e instanceof PcError && e.code === 'timeout')) return SLOW_MESSAGE;
  if (e instanceof PcError && e.code === 'unavailable') return OFFLINE_MESSAGE;
  return FAILED_MESSAGE;
}

/** Chạy 1 job đã claim (status running). Không ném lỗi: mọi lỗi → job failed (+ design failed với ai_generate). */
export async function processJob(job: JobRow, opts: { settings?: Settings; sleep?: Sleep; timeoutMs?: number; client?: PcClient } = {}) {
  const s = opts.settings ?? getSettings();
  const ctx: Ctx = { aborted: false };
  const timeout = opts.timeoutMs ?? jobTimeoutMs(job, s);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const work = job.kind === 'render_print' ? renderPrintJob(job, ctx) : generate(job, s, opts.client ?? engineFor(s), opts.sleep ?? realSleep, ctx);
  try {
    await Promise.race([work, new Promise<never>((_, rej) => { timer = setTimeout(() => { ctx.aborted = true; rej(new Aborted(`timed out after ${timeout} ms`)); }, timeout); })]);
  } catch (e) {
    work.catch(() => {});                                // phần việc bị bỏ dở dừng ở guard() kế tiếp
    console.error(`[worker] job ${job.id} (${job.kind}) failed:`, msg(e));
    if (e instanceof TransitionError) { finishJob(job.id, 'canceled', 'Design changed while the job was running.'); return; }
    finishJob(job.id, 'failed', job.kind === 'ai_generate' ? failureMessage(e) : `Print render failed: ${msg(e)}`.slice(0, 300));
    if (job.kind === 'ai_generate') {
      const prev = json<Record<string, unknown>>((db().prepare('SELECT check_result c FROM jobs WHERE id = ?').get(job.id) as { c: string | null } | undefined)?.c ?? null, {});
      setCheckResult(job.id, { ...prev, error: msg(e).slice(0, 600) });
      try { transition(job.design_id, 'job_failed'); } catch { /* design đã đổi trạng thái */ }
    }
  } finally {
    clearTimeout(timer);
  }
}
