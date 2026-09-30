import { admin } from '@/app/admin/_lib/http';
import { listOrders } from '@/app/admin/_lib/repo';
import { ORDER_STATUSES } from '@/app/admin/_lib/schemas';

export const GET = admin((req) => {
  const status = new URL(req.url).searchParams.get('status') ?? undefined;
  const valid = status && (ORDER_STATUSES as readonly string[]).includes(status) ? status : undefined;
  return Response.json({ orders: listOrders(valid) });
});
