import type { NextRequest } from 'next/server';
import { AddLineInput, addLine, ensureCart } from '@/lib/cart';
import { db } from '@/lib/db';
import { cartId, cartResponse, fail, readJson } from '../_http';

// POST { variant_id, qty, design_id } → CartView. Design chưa confirmed / in_review → 409 design_not_confirmed.
export async function POST(req: NextRequest) {
  try {
    const input = await readJson(req, AddLineInput);
    const id = ensureCart(cartId(req));
    addLine(id, input);
    db().prepare("INSERT INTO events (name, session_id, payload) VALUES ('add_to_cart', ?, ?)")
      .run(req.cookies.get('pa_sid')?.value ?? null, JSON.stringify({ variant_id: input.variant_id, qty: input.qty, design_id: input.design_id }));
    return cartResponse(req, id);
  } catch (e) { return fail(e); }
}
