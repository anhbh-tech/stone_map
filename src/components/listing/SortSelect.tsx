'use client';
import { useRouter } from 'next/navigation';
import { useId } from 'react';

/**
 * Sắp xếp: form GET thường (chạy không cần JS qua nút Apply trong <noscript>);
 * có JS thì đổi lựa chọn là điều hướng ngay, giữ các tham số khác (hidden) và về trang 1.
 */
export function SortSelect({ value, options, hidden }: { value: string; options: { id: string; label: string }[]; hidden: [string, string][] }) {
  const router = useRouter();
  const id = useId();
  return (
    <form method="get" className="flex items-center gap-2"
      onChange={(e) => {
        const params = new URLSearchParams();
        new FormData(e.currentTarget).forEach((v, k) => { if (typeof v === 'string' && v) params.append(k, v); });
        const qs = params.toString();
        router.push(qs ? `?${qs}` : '?', { scroll: false });
      }}>
      {hidden.map(([k, v], i) => <input key={`${k}${i}`} type="hidden" name={k} value={v} />)}
      <label htmlFor={id} className="whitespace-nowrap text-sm text-muted-foreground">Sort by</label>
      <span className="relative">
        <select id={id} name="sort" defaultValue={value} key={value}
          className="min-h-11 appearance-none rounded-md border border-input bg-card py-2 pl-3 pr-9 text-sm font-medium text-foreground hover:border-foreground">
          {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
        <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round"
          aria-hidden="true" className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"><path d="m6 9 6 6 6-6" /></svg>
      </span>
      <noscript><button type="submit" className="min-h-11 rounded-full border border-input px-4 text-sm font-medium">Apply</button></noscript>
    </form>
  );
}
