import { admin, body, insertRow } from '@/app/admin/_lib/http';
import { DISCOUNT_SORTS, DISCOUNT_STATES, searchDiscounts } from '@/app/admin/_lib/discounts';
import { listState, pick } from '@/app/admin/_lib/list';
import { discountCreate } from '@/app/admin/_lib/schemas';

export const GET = admin((req) => {
  const sp = Object.fromEntries(new URL(req.url).searchParams);
  const s = listState(sp, DISCOUNT_SORTS, 'created');
  const { rows, total } = searchDiscounts(s, pick(sp.state, DISCOUNT_STATES));
  return Response.json({ discounts: rows, total, page: s.page, per: s.per });
});

// Ngày YYYY-MM-DD (UTC): bắt đầu lúc 00:00:00, kết thúc lúc 23:59:59 của ngày đó.
export const POST = admin(async (req) => {
  const d = await body(req, discountCreate);
  const id = insertRow('discounts', {
    ...d,
    value: d.kind === 'free_shipping' ? 0 : d.value,
    starts_at: d.starts_at ? `${d.starts_at} 00:00:00` : null,
    ends_at: d.ends_at ? `${d.ends_at} 23:59:59` : null,
  });
  return Response.json({ id }, { status: 201 });
});
