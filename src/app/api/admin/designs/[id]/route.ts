import { admin, body, HttpError, notFound } from '@/app/admin/_lib/http';
import { getDesignRow } from '@/app/admin/_lib/repo';
import { designPatch } from '@/app/admin/_lib/schemas';
import { reviewEmail } from '@/app/admin/_lib/emails';
import { db, tx } from '@/lib/db';
import { getSettings } from '@/lib/settings';

type P = { id: string };

export const GET = admin<P>((_req, { id }) => {
  const d = getDesignRow(id) ?? notFound('Design');
  return Response.json({ ...d, print_url: d.print_path ? `/api/admin/designs/${d.id}/print` : null });
});

// PATCH { status?, assignee_id? }
// - approved / rejected: chỉ khi design đang in_review (#11); approve cần đã có file in (bản làm tay hoặc render AI).
// - in_review: giao lại cho designer một design AI không đạt (ready / confirmed / failed) — cart vẫn nhận in_review.
// - assignee_id: giao cho nhân viên (null = bỏ giao).
export const PATCH = admin<P>(async (req, { id }) => {
  const d = getDesignRow(id) ?? notFound('Design');
  const { status, assignee_id } = await body(req, designPatch);
  if (assignee_id != null && !db().prepare('SELECT 1 FROM admin_users WHERE id = ?').get(assignee_id)) {
    throw new HttpError(422, 'invalid', 'Unknown staff member', { assignee_id: 'Unknown staff member' });
  }
  if (status === 'in_review') {
    if (!['ready', 'confirmed', 'failed'].includes(d.status)) throw new HttpError(409, 'not_handoffable', `Design is ${d.status}; only AI previews or failed designs can go to a designer`);
  } else if (status) {
    if (d.status !== 'in_review') throw new HttpError(409, 'not_in_review', `Design is ${d.status}, not waiting for review`);
    if (status === 'approved' && !d.print_path) throw new HttpError(409, 'artwork_required', 'Upload the finished artwork before approving');
  }
  tx(() => {
    // Giao việc không đổi updated_at: hàng chờ xếp theo thời gian chờ.
    if (assignee_id !== undefined) db().prepare("UPDATE designs SET assignee_id = ? WHERE id = ?").run(assignee_id, id);
    if (status) db().prepare("UPDATE designs SET status = ?, updated_at = datetime('now') WHERE id = ?").run(status, id);
    if (d.email && (status === 'approved' || status === 'rejected')) {
      const m = reviewEmail(getSettings(), { id, pet_name: d.pet_name, approved: status === 'approved' });
      db().prepare("INSERT INTO email_outbox (to_addr, kind, subject, html) VALUES (?, 'design_review', ?, ?)").run(d.email, m.subject, m.html);
    }
  });
  const now = getDesignRow(id)!;
  return Response.json({ ...now, print_url: now.print_path ? `/api/admin/designs/${id}/print` : null });
});
