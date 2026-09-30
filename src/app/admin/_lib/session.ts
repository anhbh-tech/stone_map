// Kiểm phiên trong Server Component / Route Handler (proxy.ts đã chặn trước, đây là lớp thứ hai).
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE, userForToken, type AdminUser } from '../../../lib/auth';

export async function currentAdmin(): Promise<AdminUser | null> {
  return userForToken((await cookies()).get(SESSION_COOKIE)?.value);
}

/** Dùng đầu mỗi trang admin: chưa đăng nhập → /admin/login. Gọi cookies() nên trang luôn render động. */
export async function requireAdminPage(): Promise<AdminUser> {
  const user = await currentAdmin();
  if (!user) redirect('/admin/login');
  return user;
}
