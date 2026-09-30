import { admin, body, intId, notFound, updateRow } from '@/app/admin/_lib/http';
import { getOrder } from '@/app/admin/_lib/repo';
import { orderPatch } from '@/app/admin/_lib/schemas';

type P = { id: string };

export const GET = admin<P>((_req, { id }) => Response.json(getOrder(intId(id)) ?? notFound('Order')));

export const PATCH = admin<P>(async (req, { id }) => {
  const oid = intId(id);
  if (!updateRow('orders', oid, await body(req, orderPatch))) notFound('Order');
  return Response.json(getOrder(oid));
});
