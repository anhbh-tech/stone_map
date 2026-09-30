import { NextResponse, type NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { newId } from '@/lib/ids';
import { MAX_BODY, parseEvent } from '@/lib/pixel';
import { errorBody } from '@/lib/cart';
import { cookieOpts } from '../cart/_http';

const SID = 'pa_sid';

// POST { name, payload } (sendBeacon, text/plain hoặc JSON) → 204. Endpoint duy nhất thay cho script tracking bên thứ ba (#8).
export async function POST(req: NextRequest) {
  const text = await req.text();
  if (text.length > MAX_BODY) return NextResponse.json(errorBody('payload_too_large', 'Event too large.'), { status: 413 });
  const ev = parseEvent(text);
  if (!ev) return NextResponse.json(errorBody('invalid_event', 'Expected { name, payload }.'), { status: 400 });
  const known = req.cookies.get(SID)?.value;
  const sid = known && /^s_[\w-]{6,32}$/.test(known) ? known : newId('s');
  db().prepare('INSERT INTO events (name, session_id, payload) VALUES (?, ?, ?)').run(ev.name, sid, JSON.stringify(ev.payload));
  const res = new NextResponse(null, { status: 204 });
  if (sid !== known) res.cookies.set(SID, sid, cookieOpts(req, 1));
  return res;
}
