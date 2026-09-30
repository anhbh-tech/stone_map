// Tiện ích chung cho /api/account/*: chỉ nhận JSON cùng origin, lỗi theo hợp đồng { error: { code, message, fields? } }.
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { AccountError, CUSTOMER_COOKIE, customerForToken, type Customer } from '@/lib/customer';

export const isHttps = (req: NextRequest) => req.nextUrl.protocol === 'https:' || req.headers.get('x-forwarded-proto') === 'https';
export const clientKey = (req: NextRequest) => req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local';

export function errorJson(status: number, code: string, message: string, fields?: Record<string, string>) {
  return NextResponse.json({ error: { code, message, ...(fields ? { fields } : {}) } }, { status });
}

/** Body JSON hợp lệ theo schema. Form HTML liên trang không gửi được application/json (chặn CSRF đơn giản) + kiểm Origin. */
export async function readBody<T extends z.ZodType>(req: NextRequest, schema: T): Promise<z.infer<T>> {
  const origin = req.headers.get('origin');
  if (origin && origin !== req.nextUrl.origin && origin !== `${req.headers.get('x-forwarded-proto') ?? req.nextUrl.protocol.replace(':', '')}://${req.headers.get('host')}`) {
    throw new AccountError(403, 'bad_origin', 'Cross-origin requests are not allowed.');
  }
  if (!(req.headers.get('content-type') ?? '').includes('application/json')) throw new AccountError(415, 'unsupported_media_type', 'Send JSON.');
  let raw: unknown;
  try { raw = await req.json(); } catch { throw new AccountError(400, 'invalid_json', 'Request body is not valid JSON.'); }
  const r = schema.safeParse(raw);
  if (!r.success) {
    const fields: Record<string, string> = {};
    for (const i of r.error.issues) fields[i.path.join('.') || 'body'] ??= i.message;
    const first = r.error.issues[0];
    throw Object.assign(new AccountError(400, 'invalid_request', first?.message ?? 'Check the highlighted fields.'), { fields });
  }
  return r.data;
}

export function fail(e: unknown) {
  if (e instanceof AccountError) {
    const fields = (e as AccountError & { fields?: Record<string, string> }).fields ?? (e.field ? { [e.field]: e.message } : undefined);
    return errorJson(e.status, e.code, e.message, fields);
  }
  console.error(e);
  return errorJson(500, 'internal', 'Something went wrong. Please try again.');
}

export function requireCustomer(req: NextRequest): Customer {
  const c = customerForToken(req.cookies.get(CUSTOMER_COOKIE)?.value);
  if (!c) throw new AccountError(401, 'unauthorized', 'Please sign in again.');
  return c;
}
