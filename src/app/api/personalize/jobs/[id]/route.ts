// GET /api/personalize/jobs/:id → JobView. Trình duyệt poll mỗi 1.5 s.
import { apiError, handle, ok } from '../../../../../lib/personalize/http';
import { getJob, jobView } from '../../../../../lib/personalize/jobs';

type Ctx = { params: Promise<{ id: string }> };

export const GET = handle(async (_req: Request, ctx: Ctx) => {
  const job = getJob((await ctx.params).id);
  return job ? ok(jobView(job)) : apiError(404, 'not_found', 'Job not found.');
});
