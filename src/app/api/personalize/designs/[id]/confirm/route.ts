// POST /api/personalize/designs/:id/confirm { confirmed: true } → DesignView (confirmed). Khách tick "This is my pet" (#1).
// Worker render file in variants.print_px² theo designs.transform (job render_print).
import { z } from 'zod';
import { tx } from '../../../../../../lib/db';
import { getSettings } from '../../../../../../lib/settings';
import { designView, getDesign, nextStatus, nowIso, transition } from '../../../../../../lib/personalize/designs';
import { apiError, handle, ok, readJson } from '../../../../../../lib/personalize/http';
import { createJob, wakeWorker } from '../../../../../../lib/personalize/jobs';

type Ctx = { params: Promise<{ id: string }> };
const Body = z.object({ confirmed: z.boolean().optional() });

export const POST = handle(async (req: Request, ctx: Ctx) => {
  const d = getDesign((await ctx.params).id);
  if (!d) return apiError(404, 'not_found', 'Design not found.');
  const r = await readJson(req, Body);
  if ('error' in r) return r.error;
  if (r.data.confirmed !== true) return apiError(400, 'confirmation_required', 'Please tick the box to confirm this is your pet.');
  if (d.status === 'confirmed') return ok(designView(d));
  if (!nextStatus(d.mode, d.status, 'confirm') || !d.source_path) {
    return apiError(409, 'invalid_state', d.status === 'generating' ? 'Your preview is still being made.' : `This design is ${d.status} and cannot be confirmed.`);
  }
  const next = tx(() => {
    const n = transition(d.id, 'confirm', { confirmed_at: nowIso() });
    createJob(d.id, 'render_print', getSettings());
    return n;
  });
  wakeWorker();
  return ok(designView(next));
});
