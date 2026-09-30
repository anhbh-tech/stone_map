import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { AddressInput, deleteAddress, listAddresses, setDefaultAddress, updateAddress } from '@/lib/account';
import { AccountError } from '@/lib/customer';
import { fail, readBody, requireCustomer } from '../../_http';

type Ctx = { params: Promise<{ id: string }> };
const idOf = async (ctx: Ctx) => {
  const n = Number((await ctx.params).id);
  if (!Number.isInteger(n) || n <= 0) throw new AccountError(404, 'address_not_found', 'That address is no longer saved.');
  return n;
};

// PATCH { address?, is_default: true? } → { addresses }
export async function PATCH(req: NextRequest, ctx: Ctx) {
  try {
    const c = requireCustomer(req);
    const id = await idOf(ctx);
    const input = await readBody(req, z.object({ address: AddressInput.optional(), is_default: z.literal(true).optional() }));
    if (input.address) updateAddress(c.id, id, input.address);
    if (input.is_default) setDefaultAddress(c.id, id);
    return NextResponse.json({ addresses: listAddresses(c.id) });
  } catch (e) { return fail(e); }
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  try {
    const c = requireCustomer(req);
    deleteAddress(c.id, await idOf(ctx));
    return NextResponse.json({ addresses: listAddresses(c.id) });
  } catch (e) { return fail(e); }
}
