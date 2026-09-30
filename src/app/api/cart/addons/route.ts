import type { NextRequest } from 'next/server';
import { AddonInput, ensureCart, setAddon } from '@/lib/cart';
import { cartId, cartResponse, fail, readJson } from '../_http';

// PUT { addon_id, on, text? } → CartView. Add-on là của cả giỏ; lời chúc thiệp miễn phí (#7).
// PDP lưu add-on trong lúc khách còn chờ AI, trước khi có dòng giỏ → tạo giỏ nếu chưa có; add-on hiện ra khi có dòng.
export async function PUT(req: NextRequest) {
  try {
    const input = await readJson(req, AddonInput);
    const id = ensureCart(cartId(req));
    setAddon(id, input);
    return cartResponse(req, id);
  } catch (e) { return fail(e); }
}
