// Tham số danh sách admin (tìm, lọc, sắp xếp, phân trang) sống trên URL: link chia sẻ được, nút Back đúng, không cần JS.
export type SearchParams = Record<string, string | string[] | undefined>;
export type Dir = 'asc' | 'desc';
export type ListState<S extends string> = { q: string; sort: S; dir: Dir; page: number; per: number };

export const PER_PAGE = 25;

export const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';

/** Chỉ nhận giá trị trong danh sách cho phép; sai → mặc định. */
export function pick<T extends string>(v: string | string[] | undefined, allowed: readonly T[], fallback: T): T;
export function pick<T extends string>(v: string | string[] | undefined, allowed: readonly T[]): T | undefined;
export function pick<T extends string>(v: string | string[] | undefined, allowed: readonly T[], fallback?: T) {
  const s = one(v);
  return (allowed as readonly string[]).includes(s) ? (s as T) : fallback;
}

export function listState<S extends string>(sp: SearchParams, sorts: readonly S[], defaultSort: S, defaultDir: Dir = 'desc', per = PER_PAGE): ListState<S> {
  const page = Math.floor(Number(one(sp.page)));
  return {
    q: one(sp.q).trim().slice(0, 100),
    sort: pick(sp.sort, sorts, defaultSort),
    dir: pick(sp.dir, ['asc', 'desc'] as const, defaultDir),
    page: Number.isFinite(page) && page > 0 ? page : 1,
    per,
  };
}

export const offset = (s: { page: number; per: number }) => (s.page - 1) * s.per;
export const pages = (total: number, per: number) => Math.max(1, Math.ceil(total / per));

/** Dựng href giữ nguyên các tham số khác; giá trị rỗng/undefined bị bỏ. Đổi bộ lọc → về trang 1. */
export function hrefWith(base: string, current: SearchParams, patch: Record<string, string | number | undefined | null>) {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(current)) {
    const s = one(v);
    if (s && !(k in patch)) u.set(k, s);
  }
  for (const [k, v] of Object.entries(patch)) if (v !== undefined && v !== null && v !== '') u.set(k, String(v));
  if (!('page' in patch)) u.delete('page');
  const qs = u.toString();
  return qs ? `${base}?${qs}` : base;
}

/** LIKE an toàn: escape % _ \ trong chuỗi người dùng. Dùng với `LIKE ? ESCAPE '\'`. */
export const like = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
