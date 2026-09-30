import { NextResponse, type NextRequest } from 'next/server';
import { CheckoutInput, ORDERS_COOKIE, addOrderToCookie, placeOrder } from '@/lib/cart';
import { cartId, cookieOpts, fail, readJson } from '../cart/_http';
import { attachOrderToCustomer } from '@/lib/account';
import { CUSTOMER_COOKIE, customerForToken } from '@/lib/customer';

// POST { email, name, address, shipping_method } → 201 { order_number }. Thanh toán giả lập: không thu thẻ.
export async function POST(req: NextRequest) {
  try {
    const input = await readJson(req, CheckoutInput);
    const { order_number } = placeOrder(cartId(req), input, req.cookies.get('pa_sid')?.value ?? null);
    // UI-2: khách đang đăng nhập → đơn vào lịch sử /account của họ.
    const customer = customerForToken(req.cookies.get(CUSTOMER_COOKIE)?.value);
    if (customer) attachOrderToCustomer(order_number, customer.id);
    const res = NextResponse.json({ order_number }, { status: 201 });
    res.cookies.set(ORDERS_COOKIE, addOrderToCookie(req.cookies.get(ORDERS_COOKIE)?.value, order_number), cookieOpts(req, 90));
    return res;
  } catch (e) { return fail(e); }
}
