import type { NextRequest } from 'next/server';
import { CartError, QtyInput, removeLine, updateLine } from '@/lib/cart';
import { cartId, cartResponse, fail, lineIdParam, readJson } from '../../_http';

type Ctx = { params: Promise<{ id: string }> };

const requireCart = (req: NextRequest) => {
  const id = cartId(req);
  if (!id) throw new CartError(404, 'line_not_found', 'That item is no longer in your cart.');
  return id;
};

export async function PATCH(req: NextRequest, { params }: Ctx) {
  try {
    const line = lineIdParam((await params).id);
    const { qty } = await readJson(req, QtyInput);
    const id = requireCart(req);
    updateLine(id, line, qty);
    return cartResponse(req, id);
  } catch (e) { return fail(e); }
}

export async function DELETE(req: NextRequest, { params }: Ctx) {
  try {
    const line = lineIdParam((await params).id);
    const id = requireCart(req);
    removeLine(id, line);
    return cartResponse(req, id);
  } catch (e) { return fail(e); }
}
