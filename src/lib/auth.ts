// Phiên admin: cookie httpOnly chứa token ngẫu nhiên; DB (admin_sessions) chỉ giữ sha256 của token,
// nên lộ file DB không lộ phiên. proxy.ts chặn /admin và /api/admin; mỗi trang / route kiểm lại (defense in depth).
// Import tương đối (không dùng "@/") để vitest chạy được không cần config alias.
import crypto from 'node:crypto';
import { db } from './db';
import { verifyPassword } from './password';

export const SESSION_COOKIE = 'pa_admin';
export const SESSION_TTL_S = 7 * 24 * 3600;

export type AdminUser = { id: number; username: string };

const sha = (token: string) => crypto.createHash('sha256').update(token).digest('hex');
// Hash giả để so khi username không tồn tại: thời gian phản hồi không lộ username nào có thật.
const DUMMY_HASH = `${'0'.repeat(32)}:${'0'.repeat(64)}`;

/** Kiểm username + password. Trả user hoặc null; không phân biệt "sai user" với "sai mật khẩu". */
export function checkCredentials(username: string, password: string): AdminUser | null {
  const row = db().prepare('SELECT id, username, password_hash FROM admin_users WHERE username = ?').get(username) as
    | { id: number; username: string; password_hash: string }
    | undefined;
  let ok = false;
  try { ok = verifyPassword(password, row?.password_hash ?? DUMMY_HASH); } catch { ok = false; }
  return row && ok ? { id: row.id, username: row.username } : null;
}

/** Tạo phiên mới, trả token thô (chỉ nằm trong cookie). */
export function createSession(userId: number, now = new Date()): { token: string; expires: Date } {
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = new Date(now.getTime() + SESSION_TTL_S * 1000);
  const d = db();
  d.prepare('DELETE FROM admin_sessions WHERE expires_at <= ?').run(now.toISOString());
  d.prepare('INSERT INTO admin_sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(sha(token), userId, expires.toISOString());
  return { token, expires };
}

export function userForToken(token: string | undefined | null, now = new Date()): AdminUser | null {
  if (!token || token.length > 200) return null;
  const row = db()
    .prepare('SELECT u.id, u.username FROM admin_sessions s JOIN admin_users u ON u.id = s.user_id WHERE s.token = ? AND s.expires_at > ?')
    .get(sha(token), now.toISOString()) as AdminUser | undefined;
  return row ? { id: row.id, username: row.username } : null;
}

export function destroySession(token: string | undefined | null) {
  if (token) db().prepare('DELETE FROM admin_sessions WHERE token = ?').run(sha(token));
}

export const sessionCookie = (token: string, expires: Date) => ({
  name: SESSION_COOKIE,
  value: token,
  httpOnly: true,
  sameSite: 'strict' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
  expires,
});

// ── Giới hạn thử mật khẩu (trong bộ nhớ, đủ cho 1 process): 10 lần sai / 15 phút cho mỗi IP+username.
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILS = 10;
const fails = new Map<string, { n: number; since: number }>();

export function loginThrottled(key: string, now = Date.now()): number {
  const f = fails.get(key);
  if (!f || now - f.since > WINDOW_MS) return 0;
  return f.n >= MAX_FAILS ? Math.ceil((f.since + WINDOW_MS - now) / 1000) : 0;
}
export function recordLoginFailure(key: string, now = Date.now()) {
  const f = fails.get(key);
  if (!f || now - f.since > WINDOW_MS) fails.set(key, { n: 1, since: now });
  else f.n += 1;
}
export const clearLoginFailures = (key: string) => fails.delete(key);

/** Đường dẫn "next" sau đăng nhập: chỉ nhận đường nội bộ dưới /admin (chống open redirect). */
export function safeNext(next: string | null | undefined): string {
  if (!next || !/^\/admin(\/|\?|$)/.test(next) || next.includes('\\') || next.startsWith('/admin/login')) return '/admin';
  return next;
}
