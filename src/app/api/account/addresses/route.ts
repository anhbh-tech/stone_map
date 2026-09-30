import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { AddressInput, addAddress, listAddresses } from '@/lib/account';
import { fail, readBody, requireCustomer } from '../_http';

export async function GET(req: NextRequest) {
  try { return NextResponse.json({ addresses: listAddresses(requireCustomer(req).id) }); } catch (e) { return fail(e); }
}

// POST { address, is_default? } → 201 { addresses }. Địa chỉ đầu tiên luôn là mặc định.
export async function POST(req: NextRequest) {
  try {
    const c = requireCustomer(req);
    const input = await readBody(req, z.object({ address: AddressInput, is_default: z.boolean().optional().default(false) }));
    addAddress(c.id, input.address, input.is_default);
    return NextResponse.json({ addresses: listAddresses(c.id) }, { status: 201 });
  } catch (e) { return fail(e); }
}
