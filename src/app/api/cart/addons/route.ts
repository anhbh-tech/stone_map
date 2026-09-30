import type { NextRequest } from 'next/server';
import { AddonInput, CartError, setAddon } from '@/lib/cart';
import { cartId, cartResponse, fail, readJson } from '../_http';

// PUT { addon_id, on, text? } → CartView. Add-on là của cả giỏ; lời chúc thiệp miễn phí (#7).
export async function PUT(req: NextRequest) {
  try {
    const input = await readJson(req, AddonInput);
    const id = cartId(req);
    if (!id) throw new CartError(409, 'cart_empty', 'Add a portrait before choosing options.');
    setAddon(id, input);
    return cartResponse(req, id);
  } catch (e) { return fail(e); }
}
