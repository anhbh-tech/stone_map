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

// Duyệt hàng chờ designer (#11): approve cần đã có bản làm tay (file in); reject để khách gửi ảnh khác.
export const PATCH = admin<P>(async (req, { id }) => {
  const d = getDesignRow(id) ?? notFound('Design');
  const { status } = await body(req, designPatch);
  if (d.status !== 'in_review') throw new HttpError(409, 'not_in_review', `Design is ${d.status}, not waiting for review`);
  if (status === 'approved' && !d.print_path) throw new HttpError(409, 'artwork_required', 'Upload the finished artwork before approving');
  tx(() => {
    db().prepare("UPDATE designs SET status = ?, updated_at = datetime('now') WHERE id = ?").run(status, id);
    if (d.email) {
      const m = reviewEmail(getSettings(), { id, pet_name: d.pet_name, approved: status === 'approved' });
      db().prepare("INSERT INTO email_outbox (to_addr, kind, subject, html) VALUES (?, 'design_review', ?, ?)").run(d.email, m.subject, m.html);
    }
  });
  return Response.json({ ...getDesignRow(id), print_url: d.print_path ? `/api/admin/designs/${id}/print` : null });
});
