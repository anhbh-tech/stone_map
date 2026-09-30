// Tài khoản khách (UI-2): đăng ký / đăng nhập / phiên. Cùng cách với phiên admin (src/lib/auth.ts):
// cookie httpOnly giữ token ngẫu nhiên, DB (customer_sessions) chỉ giữ sha256 → lộ file DB không lộ phiên.
// Import tương đối để vitest chạy không cần alias.
import crypto from 'node:crypto';
import { z } from 'zod';
import { db } from './db';
import { hashPassword, verifyPassword } from './password';

export const CUSTOMER_COOKIE = 'pa_customer';
export const CUSTOMER_TTL_S = 30 * 24 * 3600;

export type Customer = { id: number; email: string; name: string | null };

export class AccountError extends Error {
  constructor(public status: number, public code: string, message: string, public field?: string) { super(message); }
}

export const RegisterInput = z.object({
  name: z.string().trim().min(1, 'Enter your name').max(120),
  email: z.email('Enter a valid email address').max(200),
  password: z.string().min(8, 'Use at least 8 characters').max(200),
});
export const LoginInput = z.object({
  email: z.string().trim().min(1, 'Enter your email').max(200),
  password: z.string().min(1, 'Enter your password').max(200),
});

const sha = (token: string) => crypto.createHash('sha256').update(token).digest('hex');
const DUMMY_HASH = `${'0'.repeat(32)}:${'0'.repeat(64)}`;
const normEmail = (e: string) => e.trim().toLowerCase();

export function registerCustomer(input: z.infer<typeof RegisterInput>): Customer {
  const email = normEmail(input.email);
  if (db().prepare('SELECT 1 FROM customers WHERE email = ?').get(email)) {
    throw new AccountError(409, 'email_taken', 'An account with this email already exists. Sign in instead.', 'email');
  }
  return db().prepare('INSERT INTO customers (email, name, password_hash) VALUES (?, ?, ?) RETURNING id, email, name')
    .get(email, input.name, hashPassword(input.password)) as Customer;
}

/** Đúng email + mật khẩu → khách, ngược lại null. Không phân biệt "sai email" với "sai mật khẩu". */
export function checkCustomer(email: string, password: string): Customer | null {
  const row = db().prepare('SELECT id, email, name, password_hash FROM customers WHERE email = ?').get(normEmail(email)) as
    | (Customer & { password_hash: string })
    | undefined;
  let ok = false;
  try { ok = verifyPassword(password, row?.password_hash ?? DUMMY_HASH); } catch { ok = false; }
  return row && ok ? { id: row.id, email: row.email, name: row.name } : null;
}

export function createCustomerSession(customerId: number, now = new Date()): { token: string; expires: Date } {
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = new Date(now.getTime() + CUSTOMER_TTL_S * 1000);
  const d = db();
  d.prepare('DELETE FROM customer_sessions WHERE expires_at <= ?').run(now.toISOString());
  d.prepare('INSERT INTO customer_sessions (token, customer_id, expires_at) VALUES (?, ?, ?)').run(sha(token), customerId, expires.toISOString());
  return { token, expires };
}

export function customerForToken(token: string | undefined | null, now = new Date()): Customer | null {
  if (!token || token.length > 200) return null;
  const row = db()
    .prepare('SELECT c.id, c.email, c.name FROM customer_sessions s JOIN customers c ON c.id = s.customer_id WHERE s.token = ? AND s.expires_at > ?')
    .get(sha(token), now.toISOString()) as Customer | undefined;
  return row ? { id: row.id, email: row.email, name: row.name } : null;
}

export function destroyCustomerSession(token: string | undefined | null) {
  if (token) db().prepare('DELETE FROM customer_sessions WHERE token = ?').run(sha(token));
}

/** lax (không phải strict như admin): khách bấm link từ email về shop vẫn thấy mình đang đăng nhập. CSRF: API chỉ nhận JSON. */
export const customerCookie = (token: string, expires: Date, secure: boolean) => ({
  name: CUSTOMER_COOKIE, value: token, httpOnly: true, sameSite: 'lax' as const, secure, path: '/', expires,
});

/** "next" sau đăng nhập: chỉ đường nội bộ (chống open redirect), không quay lại trang login/register. */
export function safeAccountNext(next: string | null | undefined): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.includes('\\') || /^\/account\/(login|register)/.test(next)) return '/account';
  return next;
}

export const firstName = (c: Pick<Customer, 'name' | 'email'>) => (c.name?.trim().split(/\s+/)[0] || c.email.split('@')[0]);
