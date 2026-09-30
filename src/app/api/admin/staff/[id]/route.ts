import { admin, HttpError, intId, notFound } from '@/app/admin/_lib/http';
import { db, tx } from '@/lib/db';

type P = { id: string };

// Xoá nhân viên: phiên của họ hết (CASCADE), design đang giao cho họ về "chưa giao" (SET NULL). Không tự xoá mình.
export const DELETE = admin<P>((_req, { id }, user) => {
  const sid = intId(id);
  if (sid === user.id) throw new HttpError(409, 'self_delete', 'You cannot remove your own account');
  tx(() => {
    db().prepare('UPDATE designs SET assignee_id = NULL WHERE assignee_id = ?').run(sid);
    if (!Number(db().prepare('DELETE FROM admin_users WHERE id = ?').run(sid).changes)) notFound('Staff member');
  });
  return new Response(null, { status: 204 });
});
