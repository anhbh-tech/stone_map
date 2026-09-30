import { NextResponse, type NextRequest } from 'next/server';
import { suggest } from '@/lib/listing';

// GET ?q= → { items: { handle, title, image }[] } — gợi ý khi gõ trong SearchBox (hợp đồng chung với UI-1).
export function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get('q') ?? '').slice(0, 100);
  return NextResponse.json({ items: q.trim().length >= 2 ? suggest(q) : [] }, { headers: { 'Cache-Control': 'private, max-age=30' } });
}
