import { NextResponse, type NextRequest } from 'next/server';
import { ResetInput, createCustomerSession, customerCookie, resetPassword } from '@/lib/customer';
import { fail, isHttps, readBody } from '../_http';

// POST { token, password } → { customer } + cookie phiên mới (phiên cũ ở mọi máy bị xoá). Token hết hạn/đã dùng → 400 invalid_token.
export async function POST(req: NextRequest) {
  try {
    const input = await readBody(req, ResetInput);
    const c = resetPassword(input.token, input.password);
    const { token, expires } = createCustomerSession(c.id);
    const res = NextResponse.json({ customer: { email: c.email, name: c.name } });
    res.cookies.set(customerCookie(token, expires, isHttps(req)));
    return res;
  } catch (e) { return fail(e); }
}
