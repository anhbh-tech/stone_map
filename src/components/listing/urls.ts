// Dựng URL lọc / sắp xếp / phân trang cho /collections/[handle] và /search. Đổi bộ lọc → về trang 1.
import type { ListQuery } from '@/lib/listing';

export type UrlState = ListQuery & { q?: string };

export function listHref(path: string, s: UrlState, patch: Partial<UrlState> = {}) {
  const n = { ...s, page: 1, ...patch };
  const p = new URLSearchParams();
  if (n.q) p.set('q', n.q);
  for (const t of n.theme) p.append('theme', t);
  for (const t of n.type) p.append('type', t);
  if (n.price) p.set('price', n.price);
  if (n.sort && n.sort !== 'featured' && n.sort !== 'relevance') p.set('sort', n.sort);
  if (n.page > 1) p.set('page', String(n.page));
  const qs = p.toString();
  return qs ? `${path}?${qs}` : path;
}

export const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
