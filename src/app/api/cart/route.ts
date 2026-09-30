import type { NextRequest } from 'next/server';
import { cartId, cartResponse, fail } from './_http';

export async function GET(req: NextRequest) {
  try { return cartResponse(req, cartId(req)); } catch (e) { return fail(e); }
}
