// Cổng vào admin (Next 16: proxy.ts thay middleware, chạy Node runtime nên đọc được SQLite).
// Chưa có phiên hợp lệ: trang → redirect /admin/login?next=…, API → 401 JSON. Request ghi (POST/PATCH/PUT/DELETE)
// từ origin khác → 403. Trang và route handler vẫn tự kiểm phiên lần nữa (src/app/admin/_lib/session.ts).
import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE, userForToken } from './lib/auth';

const PUBLIC = new Set(['/admin/login', '/api/admin/login']);

const apiError = (status: number, code: string, message: string) =>
  NextResponse.json({ error: { code, message } }, { status });

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const isApi = pathname.startsWith('/api/');

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const origin = req.headers.get('origin');
    if (origin && origin !== req.nextUrl.origin && origin !== `${req.headers.get('x-forwarded-proto') ?? req.nextUrl.protocol.replace(':', '')}://${req.headers.get('host')}`) {
      return apiError(403, 'bad_origin', 'Cross-origin admin requests are not allowed');
    }
  }
  if (PUBLIC.has(pathname)) return NextResponse.next();

  const user = userForToken(req.cookies.get(SESSION_COOKIE)?.value);
  if (user) return NextResponse.next();

  if (isApi) return apiError(401, 'unauthorized', 'Sign in required');
  const url = req.nextUrl.clone();
  url.pathname = '/admin/login';
  url.search = '';
  if (pathname !== '/admin') url.searchParams.set('next', pathname + req.nextUrl.search);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ['/admin', '/admin/:path*', '/api/admin/:path*'],
};
