// POST /api/personalize/designs/:id/submit → DesignView (in_review). Chỉ mode designer: designer làm tay, admin duyệt.
import { designView, getDesign, nextStatus, transition } from '../../../../../../lib/personalize/designs';
import { apiError, handle, ok } from '../../../../../../lib/personalize/http';

type Ctx = { params: Promise<{ id: string }> };

export const POST = handle(async (_req: Request, ctx: Ctx) => {
  const d = getDesign((await ctx.params).id);
  if (!d) return apiError(404, 'not_found', 'Design not found.');
  if (d.mode !== 'designer') return apiError(409, 'wrong_mode', 'Only Designer finish designs are submitted for review.');
  if (d.status === 'in_review') return ok(designView(d));
  if (!d.upload_id) return apiError(400, 'upload_required', 'Upload a photo of your pet first.');
  if (!nextStatus(d.mode, d.status, 'submit')) return apiError(409, 'invalid_state', `This design is ${d.status} and cannot be submitted.`);
  return ok(designView(transition(d.id, 'submit')));
});
