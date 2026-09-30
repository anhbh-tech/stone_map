import { NextResponse, type NextRequest } from 'next/server';
import { clearLoginFailures, loginThrottled, recordLoginFailure } from '@/lib/auth';
import { TrackInput, trackOrder } from '@/lib/account';
import { AccountError } from '@/lib/customer';
import { clientKey, fail, readBody } from '../_http';

// POST { number, email } → { order } (bản rút gọn, không có địa chỉ đầy đủ). Không khớp → 404.
// Giới hạn theo IP như đăng nhập: số đơn tuần tự nên cặp số đơn + email là thứ duy nhất chặn dò email.
export async function POST(req: NextRequest) {
  try {
    const input = await readBody(req, TrackInput);
    const key = `track|${clientKey(req)}`;
    const wait = loginThrottled(key);
    if (wait) throw new AccountError(429, 'too_many_attempts', `Too many lookups. Try again in ${Math.ceil(wait / 60)} min.`);
    const order = trackOrder(input);
    if (!order) {
      recordLoginFailure(key);
      throw new AccountError(404, 'order_not_found', 'We couldn’t find an order with that number and email. Check both against your confirmation email.');
    }
    clearLoginFailures(key);
    return NextResponse.json({ order });
  } catch (e) { return fail(e); }
}
