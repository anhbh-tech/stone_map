// Nhân viên admin (chủ shop + designer) để giao design trong hàng chờ.
import { db } from '../../../lib/db';

export type Staff = { id: number; username: string; display_name: string | null; role: 'owner' | 'designer' };

export const listStaff = () =>
  db().prepare('SELECT id, username, display_name, role FROM admin_users ORDER BY role, lower(coalesce(display_name, username))').all() as Staff[];

export const staffName = (s: Pick<Staff, 'username' | 'display_name'>) => s.display_name || s.username;
