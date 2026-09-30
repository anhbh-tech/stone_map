// Tiện ích cho route handler dưới /api/admin: kiểm phiên, đọc body theo zod, lỗi đúng hợp đồng
// `{ error: { code, message, fields? } }` (fields = lỗi theo từng ô để form hiện ngay dưới ô nhập).
import type { z } from 'zod';
import { currentAdmin } from './session';
import { db } from '../../../lib/db';
import type { AdminUser } from '../../../lib/auth';

export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string, public fields?: Record<string, string>) { super(message); }
}

export const fail = (status: number, code: string, message: string, fields?: Record<string, string>) =>
  Response.json({ error: { code, message, ...(fields ? { fields } : {}) } }, { status });

type Ctx<P> = { params: Promise<P> };

/** Bọc route handler: 401 nếu chưa đăng nhập, đổi lỗi ràng buộc SQLite thành 409/422 thay vì 500. */
export function admin<P = Record<string, never>>(fn: (req: Request, params: P, user: AdminUser) => Promise<Response> | Response) {
  return async (req: Request, ctx: Ctx<P>) => {
    const user = await currentAdmin();
    if (!user) return fail(401, 'unauthorized', 'Sign in required');
    try {
      return await fn(req, await ctx.params, user);
    } catch (e) {
      if (e instanceof HttpError) return fail(e.status, e.code, e.message, e.fields);
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('UNIQUE constraint')) return fail(409, 'duplicate', `Already exists (${msg.split(': ')[1] ?? 'unique field'})`);
      if (msg.includes('FOREIGN KEY constraint')) return fail(409, 'in_use', 'Still referenced by carts, orders or designs');
      if (msg.includes('CHECK constraint')) return fail(422, 'invalid', `Value rejected by the database (${msg.split(': ')[1] ?? 'check'})`);
      console.error('[admin api]', e);
      return fail(500, 'internal', 'Unexpected server error');
    }
  };
}

export function parse<S extends z.ZodType>(schema: S, data: unknown): z.infer<S> {
  const r = schema.safeParse(data);
  if (r.success) return r.data;
  const fields: Record<string, string> = {};
  for (const i of r.error.issues) {
    const k = i.path.join('.') || '_';
    fields[k] ??= i.message;
  }
  throw new HttpError(422, 'invalid', Object.entries(fields).map(([k, m]) => (k === '_' ? m : `${k}: ${m}`)).join('; '), fields);
}

export async function body<S extends z.ZodType>(req: Request, schema: S): Promise<z.infer<S>> {
  let data: unknown;
  try { data = await req.json(); } catch { throw new HttpError(400, 'bad_json', 'Request body must be JSON'); }
  return parse(schema, data);
}

export function intId(v: string): number {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(404, 'not_found', 'Not found');
  return n;
}

export function notFound(what = 'Record'): never {
  throw new HttpError(404, 'not_found', `${what} not found`);
}

/** UPDATE theo patch đã qua zod (key chỉ có thể là cột trong schema, zod bỏ key lạ). Trả số dòng đổi. */
export function updateRow(table: string, id: number | string, patch: Record<string, unknown>): number {
  const keys = Object.keys(patch).filter((k) => patch[k] !== undefined);
  if (!keys.length) throw new HttpError(422, 'invalid', 'Nothing to update');
  const sql = `UPDATE ${table} SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`;
  const r = db().prepare(sql).run(...keys.map((k) => patch[k] as string | number | null), id);
  return Number(r.changes);
}

export function insertRow(table: string, data: Record<string, unknown>): number {
  const keys = Object.keys(data).filter((k) => data[k] !== undefined);
  const r = db().prepare(`INSERT INTO ${table} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`)
    .run(...keys.map((k) => data[k] as string | number | null));
  return Number(r.lastInsertRowid);
}
