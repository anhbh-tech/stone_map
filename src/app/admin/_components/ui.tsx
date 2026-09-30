// Khối UI tĩnh của admin (Server Component). Chỉ dùng token trong globals.css.
// Danh sách: trạng thái lọc/sắp xếp/trang nằm trên URL (xem ../_lib/list.ts) → Tabs, SortHeader, Pagination, FilterBar đều là link/form GET.
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Icon, type IconName } from './icons';
import { hrefWith, pages, type SearchParams } from '../_lib/list';

export function PageHeader({ title, description, back, actions, meta }: { title: string; description?: ReactNode; back?: { href: string; label: string }; actions?: ReactNode; meta?: ReactNode }) {
  return (
    <header className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {back && (
          <Link href={back.href} className="-ml-2 mb-1 inline-flex min-h-11 items-center gap-1.5 rounded-[var(--radius)] px-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground">
            <Icon name="arrowLeft" size={16} /> {back.label}
          </Link>
        )}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h1 className="text-2xl font-semibold text-foreground">{title}</h1>
          {meta}
        </div>
        {description && <p className="mt-1 max-w-prose text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </header>
  );
}

export function Card({ title, description, children, className = '', id, actions, flush = false }: {
  title?: string; description?: ReactNode; children: ReactNode; className?: string; id?: string; actions?: ReactNode;
  /** Nội dung chạm viền (bảng): không padding thân. */ flush?: boolean;
}) {
  const head = title || description || actions;
  return (
    <section id={id} aria-labelledby={title && id ? `${id}-title` : undefined} className={`min-w-0 rounded-[var(--radius)] border border-border bg-card text-card-foreground ${className}`}>
      {head && (
        <div className={`flex flex-wrap items-start justify-between gap-2 px-4 pt-4 sm:px-5 ${flush ? 'pb-3' : ''}`}>
          <div className="min-w-0">
            {title && <h2 id={id ? `${id}-title` : undefined} className="text-base font-semibold">{title}</h2>}
            {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}
      <div className={flush ? '' : `px-4 pb-4 sm:px-5 sm:pb-5 ${head ? 'pt-3' : 'pt-4 sm:pt-5'}`}>{children}</div>
    </section>
  );
}

type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';
const DOT: Record<Tone, string> = { neutral: 'bg-muted-foreground', success: 'bg-success', warning: 'bg-accent', danger: 'bg-destructive', info: 'bg-primary' };
const RING: Record<Tone, string> = { neutral: 'border-border bg-background', success: 'border-border bg-background', warning: 'border-accent bg-background', danger: 'border-destructive bg-background', info: 'border-border bg-background' };

const TONES: Record<string, Tone> = {
  active: 'success', draft: 'neutral', archived: 'neutral',
  paid: 'warning', in_production: 'info', shipped: 'info', delivered: 'success', refunded: 'danger', canceled: 'danger',
  in_review: 'warning', approved: 'success', rejected: 'danger', confirmed: 'info', ready: 'info', failed: 'danger', generating: 'neutral',
  pending: 'warning', published: 'success', hidden: 'neutral',
  scheduled: 'info', expired: 'neutral', disabled: 'neutral', used_up: 'neutral',
};

/** `in_review` → `In review`: nhãn trạng thái viết hoa chữ đầu, thống nhất với Paid / Unfulfilled. */
export const statusLabel = (s: string) => { const t = s.replace(/_/g, ' '); return t.charAt(0).toUpperCase() + t.slice(1); };

/** Trạng thái = chấm màu + chữ (không chỉ dựa vào màu). */
export function StatusBadge({ status, tone, label }: { status: string; tone?: Tone; label?: string }) {
  const t = tone ?? TONES[status] ?? 'neutral';
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-medium text-foreground ${RING[t]}`}>
      <span className={`size-2 shrink-0 rounded-full ${DOT[t]}`} aria-hidden="true" />
      {label ?? statusLabel(status)}
    </span>
  );
}

const PAY_TONE: Record<string, Tone> = { paid: 'neutral', refunded: 'danger', voided: 'neutral' };
const FUL_TONE: Record<string, Tone> = { unfulfilled: 'warning', in_production: 'info', fulfilled: 'success' };
export const PaymentBadge = ({ status }: { status: string }) => <StatusBadge status={status} tone={PAY_TONE[status]} label={status === 'paid' ? 'Paid' : status === 'refunded' ? 'Refunded' : 'Voided'} />;
export const FulfillmentBadge = ({ status }: { status: string }) => <StatusBadge status={status} tone={FUL_TONE[status]} label={status === 'fulfilled' ? 'Fulfilled' : status === 'in_production' ? 'In production' : 'Unfulfilled'} />;

export function Stat({ label, value, hint, icon, href }: { label: string; value: ReactNode; hint?: ReactNode; icon?: IconName; href?: string }) {
  const body = (
    <>
      <div className="flex items-center justify-between gap-2 text-sm text-muted-foreground">
        <span>{label}</span>
        {icon && <Icon name={icon} size={18} />}
      </div>
      <div className="mt-1 text-2xl font-semibold text-foreground">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>}
    </>
  );
  const cls = 'block rounded-[var(--radius)] border border-border bg-card p-4';
  return href
    ? <Link href={href} className={`${cls} transition-colors duration-200 hover:border-foreground`}>{body}</Link>
    : <div className={cls}>{body}</div>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-[var(--radius)] border border-dashed border-border p-6 text-center text-sm text-muted-foreground">{children}</p>;
}

/** Trạng thái rỗng có hướng dẫn: nói vì sao trống và bước tiếp theo. */
export function EmptyState({ icon = 'search', title, children, action }: { icon?: IconName; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center">
      <span className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground"><Icon name={icon} size={22} /></span>
      <h2 className="mt-3 text-base font-semibold">{title}</h2>
      {children && <div className="mt-1 max-w-md text-sm text-muted-foreground">{children}</div>}
      {action && <div className="mt-4 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  );
}

/** Bảng rộng cuộn ngang trong khung riêng, trang không bao giờ cuộn ngang. */
export function Table({ children, caption, minWidth = 640 }: { children: ReactNode; caption: string; minWidth?: number }) {
  return (
    <div className="relative overflow-x-auto" tabIndex={0} role="region" aria-label={caption}>
      <table className="w-full border-collapse text-left text-sm" style={{ minWidth }}>
        <caption className="sr-only">{caption}</caption>
        {children}
      </table>
    </div>
  );
}
export const th = 'border-b border-border bg-muted/60 px-3 py-2 text-xs font-semibold text-muted-foreground first:pl-4 last:pr-4 sm:first:pl-5 sm:last:pr-5';
export const td = 'border-b border-border px-3 py-2.5 align-middle first:pl-4 last:pr-4 sm:first:pl-5 sm:last:pr-5';
export const tr = 'transition-colors duration-150 hover:bg-muted/50 [&:last-child>td]:border-b-0';

/** Tiêu đề cột sắp xếp được: link đổi sort/dir, aria-sort cho trình đọc màn hình. */
export function SortHeader({ label, col, sort, dir, base, sp, className = '', align = 'left' }: {
  label: string; col: string; sort: string; dir: 'asc' | 'desc'; base: string; sp: SearchParams; className?: string; align?: 'left' | 'right';
}) {
  const active = sort === col;
  const next = active && dir === 'desc' ? 'asc' : 'desc';
  return (
    <th scope="col" aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'} className={`${th} ${align === 'right' ? 'text-right' : ''} ${className}`}>
      <Link href={hrefWith(base, sp, { sort: col, dir: next })} className={`-mx-1 inline-flex min-h-8 items-center gap-1 rounded px-1 hover:text-foreground ${active ? 'text-foreground' : ''}`}>
        {label}
        <Icon name={active ? (dir === 'asc' ? 'arrowUp' : 'arrowDown') : 'sort'} size={14} className={active ? '' : 'opacity-50'} />
        <span className="sr-only">{active ? `, sorted ${dir === 'asc' ? 'ascending' : 'descending'}. Activate to sort ${next === 'asc' ? 'ascending' : 'descending'}` : ', activate to sort'}</span>
      </Link>
    </th>
  );
}

export function Pagination({ page, per, total, base, sp, noun = 'results' }: { page: number; per: number; total: number; base: string; sp: SearchParams; noun?: string }) {
  const last = pages(total, per);
  if (total === 0) return null;
  const from = (page - 1) * per + 1;
  const to = Math.min(total, page * per);
  const cls = 'inline-flex size-11 items-center justify-center rounded-[var(--radius)] border border-border bg-card hover:border-foreground';
  const off = `${cls} pointer-events-none opacity-40`;
  return (
    <nav aria-label="Pagination" className="flex items-center justify-between gap-3 border-t border-border px-4 py-2 text-sm sm:px-5">
      <p className="text-muted-foreground tnum">{from}–{to} of {total} {noun}</p>
      <div className="flex items-center gap-2">
        {page > 1 ? <Link href={hrefWith(base, sp, { page: page - 1 })} className={cls} aria-label="Previous page"><Icon name="chevronLeft" /></Link> : <span className={off} aria-hidden="true"><Icon name="chevronLeft" /></span>}
        <span className="tnum text-muted-foreground" aria-current="page">Page {page} of {last}</span>
        {page < last ? <Link href={hrefWith(base, sp, { page: page + 1 })} className={cls} aria-label="Next page"><Icon name="chevronRight" /></Link> : <span className={off} aria-hidden="true"><Icon name="chevronRight" /></span>}
      </div>
    </nav>
  );
}

/** Tab lọc dạng link (All / Unfulfilled / …) với số đếm. */
export function Tabs({ items, label }: { items: { href: string; label: string; count?: number; current: boolean }[]; label: string }) {
  return (
    <nav aria-label={label} className="-mb-px flex gap-1 overflow-x-auto border-b border-border px-2 sm:px-3">
      {items.map((t) => (
        <Link key={t.href} href={t.href} aria-current={t.current ? 'page' : undefined}
          className={`inline-flex min-h-11 shrink-0 items-center gap-2 border-b-2 px-3 text-sm font-medium transition-colors duration-150 ${t.current ? 'border-foreground text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>
          {t.label}
          {t.count != null && <span className={`rounded-full px-1.5 text-xs tnum ${t.current ? 'bg-foreground text-background' : 'bg-muted text-muted-foreground'}`}>{t.count}</span>}
        </Link>
      ))}
    </nav>
  );
}

const control = 'min-h-11 rounded-[var(--radius)] border border-border bg-background px-3 text-sm text-foreground focus-visible:border-foreground';

/** Thanh tìm + lọc: form GET, giữ các tham số ẩn (tab…). Không cần JS; Enter hoặc nút Apply để lọc. */
export function FilterBar({ base, q, placeholder, hidden = {}, selects = [], sp }: {
  base: string; q: string; placeholder: string; hidden?: Record<string, string | undefined>;
  selects?: { name: string; label: string; value?: string; options: { value: string; label: string }[] }[]; sp: SearchParams;
}) {
  const active = !!q || selects.some((s) => s.value);
  return (
    <form action={base} method="get" role="search" className="flex flex-wrap items-center gap-2 px-4 py-3 sm:px-5">
      {Object.entries(hidden).map(([k, v]) => v ? <input key={k} type="hidden" name={k} value={v} /> : null)}
      {sp.sort ? <input type="hidden" name="sort" value={String(sp.sort)} /> : null}
      {sp.dir ? <input type="hidden" name="dir" value={String(sp.dir)} /> : null}
      <label className="relative min-w-0 flex-1 basis-56">
        <span className="sr-only">Search</span>
        <Icon name="search" size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <input type="search" name="q" defaultValue={q} placeholder={placeholder} className={`${control} w-full pl-9 placeholder:text-muted-foreground`} />
      </label>
      {selects.map((s) => (
        <label key={s.name} className="flex min-w-0 items-center gap-2 text-sm">
          <span className="text-muted-foreground">{s.label}</span>
          <select name={s.name} defaultValue={s.value ?? ''} className={control}>
            <option value="">Any</option>
            {s.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
      ))}
      <button type="submit" className={`${btn.base} ${btn.outline}`}>Apply</button>
      {active && <Link href={hrefWith(base, hidden, {})} className={`${btn.base} text-muted-foreground hover:bg-muted hover:text-foreground`}>Clear</Link>}
    </form>
  );
}

export const linkCls = 'font-medium text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground';
export const btn = {
  base: 'inline-flex min-h-11 items-center justify-center gap-2 rounded-[var(--radius)] px-4 text-sm font-semibold transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-60',
  primary: 'bg-primary text-on-primary hover:bg-secondary',
  accent: 'bg-accent text-on-accent hover:opacity-90',
  outline: 'border border-border bg-card text-foreground hover:border-foreground',
  danger: 'border border-destructive bg-card text-destructive hover:bg-destructive hover:text-on-destructive',
};

const toDate = (s: string) => new Date(s.includes('T') ? s : `${s.replace(' ', 'T')}Z`);
export const fmtDate = (s: string) => {
  const d = toDate(s);
  return Number.isNaN(d.getTime()) ? s : d.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }) + ' UTC';
};
export const fmtDay = (s: string) => {
  const d = toDate(s);
  return Number.isNaN(d.getTime()) ? s : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
};
/** “3 h ago”, “2 d ago” — cho hàng chờ. */
export const fmtAgo = (s: string, now = Date.now()) => {
  const m = Math.max(0, Math.round((now - toDate(s).getTime()) / 60000));
  return m < 60 ? `${m} min ago` : m < 48 * 60 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
};
