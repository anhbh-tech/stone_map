import { cookies } from 'next/headers';
import { SESSION_COOKIE, destroySession } from '@/lib/auth';

export async function POST() {
  const jar = await cookies();
  destroySession(jar.get(SESSION_COOKIE)?.value);
  jar.delete(SESSION_COOKIE);
  return new Response(null, { status: 204 });
}
