import { NextResponse, type NextRequest } from 'next/server';
import { clearLoginFailures, loginThrottled, recordLoginFailure } from '@/lib/auth';
import { AccountError, LoginInput, checkCustomer, createCustomerSession, customerCookie } from '@/lib/customer';
import { clientKey, fail, isHttps, readBody } from '../_http';

// POST { email, password } → { customer } + cookie. Sai → 401 chung chung; 10 lần sai / 15 phút / IP+email → 429.
export async function POST(req: NextRequest) {
  try {
    const input = await readBody(req, LoginInput);
    const key = `customer|${clientKey(req)}|${input.email.trim().toLowerCase()}`;
    const wait = loginThrottled(key);
    if (wait) {
      const res = fail(new AccountError(429, 'too_many_attempts', `Too many failed attempts. Try again in ${Math.ceil(wait / 60)} min.`));
      res.headers.set('Retry-After', String(wait));
      return res;
    }
    const c = checkCustomer(input.email, input.password);
    if (!c) {
      recordLoginFailure(key);
      throw new AccountError(401, 'invalid_credentials', 'That email and password don’t match an account.');
    }
    clearLoginFailures(key);
    const { token, expires } = createCustomerSession(c.id);
    const res = NextResponse.json({ customer: { email: c.email, name: c.name } });
    res.cookies.set(customerCookie(token, expires, isHttps(req)));
    return res;
  } catch (e) { return fail(e); }
}
