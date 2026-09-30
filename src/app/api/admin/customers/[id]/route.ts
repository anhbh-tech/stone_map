import { admin, HttpError, intId, notFound } from '@/app/admin/_lib/http';
import { getCustomer } from '@/app/admin/_lib/customers';
import { listState } from '@/app/admin/_lib/list';
import { searchOrders } from '@/app/admin/_lib/orders';
import { customersReady } from '@/app/admin/_lib/schema-info';

type P = { id: string };

export const GET = admin<P>((_req, { id }) => {
  if (!customersReady()) throw new HttpError(503, 'customers_unavailable', 'Customer accounts are not set up in this database yet');
  const c = getCustomer(intId(id)) ?? notFound('Customer');
  const orders = searchOrders(listState({}, ['date'] as const, 'date', 'desc', 50), { customer_id: c.id, email: c.email }).rows;
  return Response.json({ ...c, order_list: orders });
});
