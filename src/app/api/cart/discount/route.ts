import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { CartError, applyDiscountCode, removeDiscountCode } from '@/lib/cart';
import { CodeInput } from '@/lib/discounts';
import { cartId, cartResponse, fail, readJson } from '../_http';

// POST { code } → CartView với mã đã áp (server tự tính số tiền). Lỗi: 404 discount_not_found, 410 discount_expired/…,
// 422 discount_min_subtotal / discount_min_qty, 409 cart_empty. DELETE → bỏ mã.
export async function POST(req: NextRequest) {
  try {
    const { code } = await readJson(req, z.object({ code: z.string().max(64) }));
    const parsed = CodeInput.safeParse({ code });
    if (!parsed.success) throw new CartError(400, 'discount_invalid_format', code.trim() ? `We couldn't find the code ${code.trim().toUpperCase()}. Check the spelling and try again.` : 'Enter a discount code.');
    const id = cartId(req);
    if (!id) throw new CartError(409, 'cart_empty', 'Add a portrait to your cart before using a code.');
    applyDiscountCode(id, parsed.data.code);
    return cartResponse(req, id);
  } catch (e) { return fail(e); }
}

export async function DELETE(req: NextRequest) {
  try {
    const id = cartId(req);
    if (id) removeDiscountCode(id);
    return cartResponse(req, id);
  } catch (e) { return fail(e); }
}
