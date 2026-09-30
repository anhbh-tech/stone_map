import { admin, body, insertRow } from '@/app/admin/_lib/http';
import { staffCreate } from '@/app/admin/_lib/schemas';
import { listStaff } from '@/app/admin/_lib/staff';
import { hashPassword } from '@/lib/password';

export const GET = admin(() => Response.json({ staff: listStaff() }));

export const POST = admin(async (req) => {
  const { password, ...rest } = await body(req, staffCreate);
  const id = insertRow('admin_users', { ...rest, password_hash: hashPassword(password) });
  return Response.json({ id }, { status: 201 });
});
