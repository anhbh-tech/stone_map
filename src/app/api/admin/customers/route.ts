import { admin } from '@/app/admin/_lib/http';
import { listState } from '@/app/admin/_lib/list';
import { CUSTOMER_SORTS, searchCustomers } from '@/app/admin/_lib/customers';

// ?q= &sort=created|name|orders|spent|last_order &dir= &page= → { customers, total, page, per }
export const GET = admin((req) => {
  const s = listState(Object.fromEntries(new URL(req.url).searchParams), CUSTOMER_SORTS, 'created');
  const { rows, total } = searchCustomers(s);
  return Response.json({ customers: rows, total, page: s.page, per: s.per });
});
