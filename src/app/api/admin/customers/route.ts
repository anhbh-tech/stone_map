import { admin, HttpError } from '@/app/admin/_lib/http';
import { listState } from '@/app/admin/_lib/list';
import { CUSTOMER_SORTS, searchCustomers } from '@/app/admin/_lib/customers';
import { customersReady } from '@/app/admin/_lib/schema-info';

// ?q= &sort=created|name|orders|spent|last_order &dir= &page= → { customers, total, page, per }
export const GET = admin((req) => {
  if (!customersReady()) throw new HttpError(503, 'customers_unavailable', 'Customer accounts are not set up in this database yet');
  const s = listState(Object.fromEntries(new URL(req.url).searchParams), CUSTOMER_SORTS, 'created');
  const { rows, total } = searchCustomers(s);
  return Response.json({ customers: rows, total, page: s.page, per: s.per });
});
