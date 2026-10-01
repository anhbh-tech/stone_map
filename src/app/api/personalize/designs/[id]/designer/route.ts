// POST /api/personalize/designs/:id/designer { pet_name?, notes?, email? } → DesignViewV2 (in_review).
// Nhánh dự phòng khi AI lỗi / quá hạn / khách không ưng: "Upload original photo for designers" — giữ ảnh gốc đã upload,
// chuyển design sang designer finish và gửi duyệt luôn (vào giỏ được ngay, như designer mode).
import { z } from 'zod';
import { db, tx } from '../../../../../../lib/db';
import { designViewV2, getDesign, getUpload, nowIso, uploadAvailable } from '../../../../../../lib/personalize/designs';
import { apiError, handle, ok, readJson } from '../../../../../../lib/personalize/http';
import { finishJob } from '../../../../../../lib/personalize/jobs';
import { DesignFields } from '../../../../../../lib/personalize/validate';

type Ctx = { params: Promise<{ id: string }> };
const Body = z.object({ pet_name: DesignFields.pet_name, notes: DesignFields.notes, email: DesignFields.email }).strict();
const FROM = ['draft', 'generating', 'ready', 'failed'];

export const POST = handle(async (req: Request, ctx: Ctx) => {
  const d = getDesign((await ctx.params).id);
  if (!d) return apiError(404, 'not_found', 'Design not found.');
  const r = await readJson(req, Body);
  if ('error' in r) return r.error;
  if (d.mode === 'designer' && d.status === 'in_review') return ok(designViewV2(d));
  if (d.mode !== 'ai' || !FROM.includes(d.status)) return apiError(409, 'invalid_state', `This design is ${d.status} and cannot be sent to our designers.`);
  const up = d.upload_id ? getUpload(d.upload_id) : undefined;
  if (!up || !uploadAvailable(up)) return apiError(410, 'upload_expired', 'Your photo has expired from our servers. Please upload it again.');
  const b = r.data;
  const changed = tx(() => {
    // Job AI đang chạy: huỷ (worker gặp TransitionError ở bước cuối và bỏ kết quả).
    const running = db().prepare("SELECT id FROM jobs WHERE design_id = ? AND kind = 'ai_generate' AND status IN ('queued','running')").all(d.id) as { id: string }[];
    for (const j of running) finishJob(j.id, 'canceled', 'Sent to our designers instead.');
    return db().prepare(`UPDATE designs SET mode = 'designer', status = 'in_review', pet_name = COALESCE(?, pet_name), notes = COALESCE(?, notes),
      email = COALESCE(?, email), updated_at = ? WHERE id = ? AND status = ?`)
      .run(b.pet_name ?? null, b.notes ?? null, b.email ?? null, nowIso(), d.id, d.status).changes;
  });
  if (!changed) return apiError(409, 'invalid_state', 'This design just changed. Please try again.');
  return ok(designViewV2(getDesign(d.id)!));
});
