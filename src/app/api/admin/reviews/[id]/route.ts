import { admin, body, HttpError, intId, notFound, updateRow } from '@/app/admin/_lib/http';
import { listReviewsAdmin } from '@/app/admin/_lib/repo';
import { reviewPatch } from '@/app/admin/_lib/schemas';

type P = { id: string };

// Chỉ đổi trạng thái (pending / published / hidden). Nội dung là lời của khách, is_sample cố định từ lúc tạo.
export const PATCH = admin<P>(async (req, { id }) => {
  const rid = intId(id);
  const raw = await req.clone().json().catch(() => null);
  if (raw && typeof raw === 'object' && 'is_sample' in raw)
    throw new HttpError(422, 'is_sample_immutable', 'Whether a review is a sample cannot be changed', { is_sample: 'Cannot be changed' });
  if (!updateRow('reviews', rid, await body(req, reviewPatch))) notFound('Review');
  return Response.json(listReviewsAdmin().find((r) => r.id === rid));
});
