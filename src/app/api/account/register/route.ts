import { NextResponse, type NextRequest } from 'next/server';
import { RegisterInput, createCustomerSession, customerCookie, registerCustomer } from '@/lib/customer';
import { fail, isHttps, readBody } from '../_http';

// POST { name, email, password } → 201 { customer } + cookie phiên. Email đã có → 409 email_taken.
export async function POST(req: NextRequest) {
  try {
    const input = await readBody(req, RegisterInput);
    const c = registerCustomer(input);
    const { token, expires } = createCustomerSession(c.id);
    const res = NextResponse.json({ customer: { email: c.email, name: c.name } }, { status: 201 });
    res.cookies.set(customerCookie(token, expires, isHttps(req)));
    return res;
  } catch (e) { return fail(e); }
}
