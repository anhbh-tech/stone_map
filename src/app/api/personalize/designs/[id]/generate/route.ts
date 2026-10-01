// POST /api/personalize/designs/:id/generate { style? } → 202 JobViewV2 (job pearl_compare chạy ở worker). Đã có job đang chạy → trả job đó (idempotent).
import { z } from 'zod';
import { tx } from '../../../../../../lib/db';
import { getSettings } from '../../../../../../lib/settings';
import { getDesign, getUpload, nextStatus, transition, uploadAvailable, uploadPreflight } from '../../../../../../lib/personalize/designs';
import { apiError, engineError, handle, ok, readJson } from '../../../../../../lib/personalize/http';
import { activeJobFor, createJob, jobView, wakeWorker } from '../../../../../../lib/personalize/jobs';
import { checkStyle } from '../../../../../../lib/personalize/validate';
import { isPcTheme, themeForProduct } from '../../../../../../lib/personalize/engine';

type Ctx = { params: Promise<{ id: string }> };
const Body = z.object({ style: z.string().min(1).max(64).optional() });

export const POST = handle(async (req: Request, ctx: Ctx) => {
  const d = getDesign((await ctx.params).id);
  if (!d) return apiError(404, 'not_found', 'Design not found.');
  const r = await readJson(req, Body);
  if ('error' in r) return r.error;
  if (d.mode !== 'ai') return apiError(409, 'wrong_mode', 'Designer finish designs are made by hand; submit the design instead.');

  const s = getSettings();
  const running = activeJobFor(d.id);
  if (running) return ok(jobView(running, s), 202);

  const style = themeForProduct(d.product_id) ?? r.data.style ?? d.style; // sản phẩm theme: luôn đúng theme
  if (!style) return apiError(400, 'style_required', 'Choose a style first.');
  const se = checkStyle(style, s);
  if (se) return se;
  if (!isPcTheme(style)) return engineError({ code: 'not_found', message: `style ${style} has no pearl_compare theme` });

  const up = d.upload_id ? getUpload(d.upload_id) : undefined;
  if (!up || !uploadAvailable(up)) return apiError(410, 'upload_expired', 'Your photo has expired from our servers. Please upload it again.');
  const pf = uploadPreflight(up);
  if (!pf?.ok) return apiError(422, 'preflight_failed', pf?.issues[0]?.message ?? 'This photo did not pass our checks.');
  if (!nextStatus(d.mode, d.status, 'generate')) return apiError(409, 'invalid_state', `This design is ${d.status} and cannot be regenerated.`);

  const job = tx(() => {
    transition(d.id, 'generate', { style });
    return createJob(d.id, 'ai_generate', s);
  });
  wakeWorker();
  return ok(jobView(job, s), 202);
});
