import { admin } from '@/app/admin/_lib/http';
import { jobMetrics } from '@/app/admin/_lib/metrics';

export const GET = admin((req) => {
  const days = Number(new URL(req.url).searchParams.get('days') ?? 7);
  return Response.json(jobMetrics(Number.isFinite(days) ? Math.min(365, Math.max(1, days)) : 7));
});
