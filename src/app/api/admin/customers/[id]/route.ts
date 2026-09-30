import { admin, intId, notFound } from '@/app/admin/_lib/http';
import { getCustomer } from '@/app/admin/_lib/customers';
import { listState } from '@/app/admin/_lib/list';
import { searchOrders } from '@/app/admin/_lib/orders';

type P = { id: string };

export const GET = admin<P>((_req, { id }) => {
  const c = getCustomer(intId(id)) ?? notFound('Customer');
  const orders = searchOrders(listState({}, ['date'] as const, 'date', 'desc', 50), { customer_id: c.id, email: c.email }).rows;
  return Response.json({ ...c, order_list: orders });
});
