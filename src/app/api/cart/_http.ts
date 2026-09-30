// Tiện ích chung cho route /api/cart*, /api/checkout: cookie giỏ, đọc JSON, lỗi theo hợp đồng { error: { code, message } }.
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { CART_COOKIE, CartError, errorBody, getCart } from '@/lib/cart';

export const isHttps = (req: NextRequest) => req.nextUrl.protocol === 'https:' || req.headers.get('x-forwarded-proto') === 'https';

export const cookieOpts = (req: NextRequest, maxAgeDays: number) => ({
  httpOnly: true, sameSite: 'lax' as const, path: '/', secure: isHttps(req), maxAge: maxAgeDays * 86400,
});

export const cartId = (req: NextRequest) => req.cookies.get(CART_COOKIE)?.value ?? null;

/** Chỉ nhận application/json: form HTML liên trang không gửi được kiểu này nếu không qua CORS preflight (chặn CSRF đơn giản). */
export async function readJson<T extends z.ZodType>(req: NextRequest, schema: T): Promise<z.infer<T>> {
  if (!(req.headers.get('content-type') ?? '').includes('application/json')) throw new CartError(415, 'unsupported_media_type', 'Send JSON.');
  let body: unknown;
  try { body = await req.json(); } catch { throw new CartError(400, 'invalid_json', 'Request body is not valid JSON.'); }
  const r = schema.safeParse(body);
  if (!r.success) {
    const issue = r.error.issues[0];
    throw new CartError(400, 'invalid_request', issue ? `${issue.path.join('.') || 'body'}: ${issue.message}` : 'Invalid request.');
  }
  return r.data;
}

export function fail(e: unknown) {
  if (e instanceof CartError) return NextResponse.json(errorBody(e.code, e.message), { status: e.status });
  console.error(e);
  return NextResponse.json(errorBody('internal', 'Something went wrong. Please try again.'), { status: 500 });
}

/** Trả CartView và (nếu giỏ mới tạo) đặt cookie. */
export function cartResponse(req: NextRequest, id: string | null, status = 200) {
  const res = NextResponse.json(getCart(id), { status });
  if (id && id !== cartId(req)) res.cookies.set(CART_COOKIE, id, cookieOpts(req, 30));
  return res;
}

export const lineIdParam = (raw: string) => {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) throw new CartError(404, 'line_not_found', 'That item is no longer in your cart.');
  return n;
};
