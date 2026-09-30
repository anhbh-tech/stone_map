import { NextResponse, type NextRequest } from 'next/server';
import { CUSTOMER_COOKIE, destroyCustomerSession } from '@/lib/customer';
import { fail, readBody } from '../_http';
import { z } from 'zod';

// POST {} → 204, xoá phiên ở DB và cookie.
export async function POST(req: NextRequest) {
  try {
    await readBody(req, z.object({}).loose());
    destroyCustomerSession(req.cookies.get(CUSTOMER_COOKIE)?.value);
    const res = new NextResponse(null, { status: 204 });
    res.cookies.delete(CUSTOMER_COOKIE);
    return res;
  } catch (e) { return fail(e); }
}
