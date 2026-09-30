// Trả lỗi theo hợp đồng: { error: { code, message } } với HTTP 4xx/5xx.
import type { z } from 'zod';

export const apiError = (status: number, code: string, message: string) =>
  Response.json({ error: { code, message } }, { status, headers: { 'cache-control': 'no-store' } });

export const ok = (data: unknown, status = 200) => Response.json(data, { status, headers: { 'cache-control': 'no-store' } });

/** Đọc JSON body theo schema zod; lỗi → Response 400 để route trả thẳng. */
export async function readJson<T extends z.ZodType>(req: Request, schema: T): Promise<{ data: z.infer<T> } | { error: Response }> {
  let raw: unknown;
  try { raw = await req.json(); } catch { return { error: apiError(400, 'invalid_json', 'Request body must be JSON.') }; }
  const r = schema.safeParse(raw ?? {});
  if (!r.success) {
    const i = r.error.issues[0];
    return { error: apiError(400, 'invalid_body', `${i.path.join('.') || 'body'}: ${i.message}`) };
  }
  return { data: r.data };
}

/** Bọc handler: lỗi không lường trước → 500 dạng chuẩn, không lộ stack. */
export function handle<A extends unknown[]>(fn: (...a: A) => Promise<Response>) {
  return async (...a: A): Promise<Response> => {
    try { return await fn(...a); } catch (e) {
      console.error('[personalize]', e);
      return apiError(500, 'internal_error', 'Something went wrong on our side. Please try again.');
    }
  };
}
