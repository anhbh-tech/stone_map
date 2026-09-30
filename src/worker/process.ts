// Xử lý 1 job. ai_generate: analyze → generate → check (chạy lại tối đa 1 lần) → render preview + mockup.
// render_print: file in print_px² theo designs.transform + mockup theo transform (khi khách xác nhận / đổi size).
import fs from 'node:fs';
import { db, json } from '../lib/db';
import { getVariant } from '../lib/catalog';
import { getSettings } from '../lib/settings';
import type { Settings } from '../lib/types';
import type { Img } from '../lib/personalize/ai';
import { designView, getDesign, getUpload, nowIso, transition, TransitionError, uploadAvailable, type DesignRow } from '../lib/personalize/designs';
import { queuePreviewReady } from '../lib/personalize/email';
import { fallbackMs, finishJob, recentDurations, setCheckResult, setStage, type JobRow } from '../lib/personalize/jobs';
import { typicalMs } from '../lib/personalize/eta';
import { providerFor, realSleep, type CheckResult, type Sleep } from '../lib/personalize/providers';
import { IDENTITY, renderMockup, renderPreview, renderPrint, TransformSchema, type Transform } from '../lib/personalize/render';
import { removeStored, storagePath, writeStored } from '../lib/personalize/storage';

export const FAILED_MESSAGE = "We couldn't create your preview this time. Please try again, or choose Designer finish and a designer will make it by hand.";

class Aborted extends Error {}
type Ctx = { aborted: boolean };
const guard = (ctx: Ctx) => { if (ctx.aborted) throw new Aborted('job timed out'); };

/** Thời gian tối đa 1 job: 3× typical, trong khoảng 60 s … 10 phút. Quá hạn → failed (progress không treo mãi gần 1). */
export function jobTimeoutMs(job: Pick<JobRow, 'kind' | 'provider'>, s: Settings): number {
  const t = typicalMs(recentDurations(job.kind, job.provider), fallbackMs(job.kind, job.provider, s));
  return Math.min(10 * 60_000, Math.max(60_000, 3 * t));
}

const EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
const tagOf = (job: JobRow) => job.id.slice(-8).replace(/[^A-Za-z0-9_-]/g, '');

export function transformOf(d: DesignRow): Transform {
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

async function generate(job: JobRow, s: Settings, sleep: Sleep, ctx: Ctx) {
  const d = getDesign(job.design_id);
  if (!d) throw new Error(`design ${job.design_id} missing`);
  const up = d.upload_id ? getUpload(d.upload_id) : undefined;
  if (!up || !uploadAvailable(up)) throw new Error('upload missing or expired');
  const ref: Img = { mime: up.mime || 'image/jpeg', buf: fs.readFileSync(storagePath(up.path)) };
  // Provider/model đã chốt lúc xếp hàng, không đổi giữa chừng nếu admin sửa settings.
  const p = providerFor({ ...s, ai: { ...s.ai, provider: job.provider as Settings['ai']['provider'], model: job.model } }, sleep);

  setStage(job.id, 'analyzing');
  const analysis = await p.analyze(ref).catch((e: unknown) => { console.warn('[worker] analyze failed:', msg(e)); return null; });
  guard(ctx);

  const checks: CheckResult[] = [];
  let img: Img | null = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    setStage(job.id, 'generating');
    db().prepare('UPDATE jobs SET attempts = ? WHERE id = ?').run(attempt, job.id);
    img = await p.generate({ style: d.style, ref, analysis, attempt });
    guard(ctx);
    setStage(job.id, 'checking');
    const c = await p.check(img).catch((e: unknown): CheckResult => ({ pass: true, why: [], judge: null, skipped: `judge error: ${msg(e)}` }));
    guard(ctx);
    checks.push(c);
    setCheckResult(job.id, { analysis, checks });
    if (c.pass) break;                                  // không đạt → chạy lại đúng 1 lần, lần 2 trả về dù kết quả ra sao
  }

  setStage(job.id, 'rendering');
  const tag = tagOf(job);
  const [preview, mockup] = await Promise.all([renderPreview(img!.buf), renderMockup(img!.buf)]);
  guard(ctx);
  const source_path = writeStored('generated', `${d.id}-${tag}.${EXT[img!.mime] || 'png'}`, img!.buf);
  const preview_path = writeStored('previews', `${d.id}-${tag}.webp`, preview);
  const mockup_path = writeStored('mockups', `${d.id}-${tag}.webp`, mockup);
  let next: DesignRow;
  try {
    next = transition(d.id, 'job_succeeded', { preview_path, mockup_path, source_path, print_path: null });
  } catch (e) {
    [source_path, preview_path, mockup_path].forEach(removeStored);
    throw e;
  }
  const cur = getDesign(d.id)!;
  if (d.preview_path !== cur.preview_path) removeStored(d.preview_path);
  if (d.mockup_path !== cur.mockup_path) removeStored(d.mockup_path);
  if (d.source_path !== cur.source_path) removeStored(d.source_path);
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

/** Chạy 1 job đã claim (status running). Không ném lỗi: mọi lỗi → job failed (+ design failed với ai_generate). */
export async function processJob(job: JobRow, opts: { settings?: Settings; sleep?: Sleep; timeoutMs?: number } = {}) {
  const s = opts.settings ?? getSettings();
  const ctx: Ctx = { aborted: false };
  const timeout = opts.timeoutMs ?? jobTimeoutMs(job, s);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const work = job.kind === 'render_print' ? renderPrintJob(job, ctx) : generate(job, s, opts.sleep ?? realSleep, ctx);
  try {
    await Promise.race([work, new Promise<never>((_, rej) => { timer = setTimeout(() => { ctx.aborted = true; rej(new Aborted(`timed out after ${timeout} ms`)); }, timeout); })]);
  } catch (e) {
    work.catch(() => {});                                // phần việc bị bỏ dở dừng ở guard() kế tiếp
    console.error(`[worker] job ${job.id} (${job.kind}) failed:`, msg(e));
    if (e instanceof TransitionError) { finishJob(job.id, 'canceled', 'Design changed while the job was running.'); return; }
    finishJob(job.id, 'failed', job.kind === 'ai_generate' ? FAILED_MESSAGE : `Print render failed: ${msg(e)}`.slice(0, 300));
    if (job.kind === 'ai_generate') {
      try { transition(job.design_id, 'job_failed'); } catch { /* design đã đổi trạng thái */ }
    }
  } finally {
    clearTimeout(timer);
  }
}
