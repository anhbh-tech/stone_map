import { NextResponse, type NextRequest } from 'next/server';
import { loginThrottled, recordLoginFailure } from '@/lib/auth';
import { AccountError, ForgotInput, requestPasswordReset } from '@/lib/customer';
import { clientKey, fail, readBody } from '../_http';

// POST { email } → 200 { sent: true } dù email có tài khoản hay không (không lộ ai là khách).
// Có tài khoản → email đặt lại mật khẩu vào outbox (tối đa 3/giờ/tài khoản). Mỗi IP tối đa 10 yêu cầu / 15 phút.
export async function POST(req: NextRequest) {
  try {
    const input = await readBody(req, ForgotInput);
    const key = `forgot|${clientKey(req)}`;
    const wait = loginThrottled(key);
    if (wait) {
      const res = fail(new AccountError(429, 'too_many_attempts', `Too many requests. Try again in ${Math.ceil(wait / 60)} min.`));
      res.headers.set('Retry-After', String(wait));
      return res;
    }
    recordLoginFailure(key);
    requestPasswordReset(input.email);
    return NextResponse.json({ sent: true });
  } catch (e) { return fail(e); }
}
