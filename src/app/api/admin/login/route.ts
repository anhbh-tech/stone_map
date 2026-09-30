import { cookies } from 'next/headers';
import { z } from 'zod';
import { checkCredentials, clearLoginFailures, createSession, loginThrottled, recordLoginFailure, sessionCookie } from '@/lib/auth';
import { HttpError, body, fail } from '@/app/admin/_lib/http';

const Login = z.object({ username: z.string().trim().min(1, 'Required').max(80), password: z.string().min(1, 'Required').max(200) });

export async function POST(req: Request) {
  let input: z.infer<typeof Login>;
  try { input = await body(req, Login); } catch (e) {
    if (e instanceof HttpError) return fail(e.status, e.code, e.message, e.fields);
    throw e;
  }
  const key = `${req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local'}|${input.username.toLowerCase()}`;
  const wait = loginThrottled(key);
  if (wait) {
    const res = fail(429, 'too_many_attempts', `Too many failed attempts. Try again in ${Math.ceil(wait / 60)} min.`);
    res.headers.set('Retry-After', String(wait));
    return res;
  }
  const user = checkCredentials(input.username, input.password);
  if (!user) {
    recordLoginFailure(key);
    return fail(401, 'invalid_credentials', 'Incorrect username or password');
  }
  clearLoginFailures(key);
  const { token, expires } = createSession(user.id);
  (await cookies()).set(sessionCookie(token, expires));
  return Response.json({ username: user.username });
}
