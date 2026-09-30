import { admin } from '@/app/admin/_lib/http';
import { pick } from '@/app/admin/_lib/list';
import { RANGES, attention, overview } from '@/app/admin/_lib/analytics';

// ?range=today|7d|30d|90d → KPI (doanh thu, số đơn, AOV, conversion) + chuỗi theo ngày/giờ + việc đang chờ.
export const GET = admin((req) => {
  const range = pick(new URL(req.url).searchParams.get('range') ?? undefined, RANGES, '7d');
  return Response.json({ ...overview(range), attention: attention() });
});
