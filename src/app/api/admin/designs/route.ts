import { admin } from '@/app/admin/_lib/http';
import { listDesigns } from '@/app/admin/_lib/repo';
import type { DesignStatus } from '@/lib/types';

const ALL: DesignStatus[] = ['draft', 'generating', 'ready', 'failed', 'confirmed', 'in_review', 'approved', 'rejected'];

// Mặc định: hàng chờ designer (mode designer, status in_review). ?status=a,b & ?mode=all để lọc khác.
export const GET = admin((req) => {
  const q = new URL(req.url).searchParams;
  const statuses = (q.get('status')?.split(',') ?? ['in_review']).filter((s): s is DesignStatus => (ALL as string[]).includes(s));
  return Response.json({ designs: listDesigns(statuses.length ? statuses : ['in_review'], q.get('mode') === 'all' ? 'all' : 'designer') });
});
