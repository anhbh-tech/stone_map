// Khối UI tĩnh của admin (Server Component). Chỉ dùng token trong globals.css.
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Icon, type IconName } from './icons';

export function PageHeader({ title, description, back, actions }: { title: string; description?: ReactNode; back?: { href: string; label: string }; actions?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {back && (
          <Link href={back.href} className="mb-2 inline-flex min-h-11 items-center gap-1.5 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
            <Icon name="arrowLeft" size={16} /> {back.label}
          </Link>
        )}
        <h1 className="text-3xl font-semibold text-foreground">{title}</h1>
        {description && <p className="mt-1 max-w-prose text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </header>
  );
}

export function Card({ title, description, children, className = '', id }: { title?: string; description?: ReactNode; children: ReactNode; className?: string; id?: string }) {
  return (
    <section id={id} aria-labelledby={title && id ? `${id}-title` : undefined} className={`rounded-[var(--radius)] border border-border bg-card p-4 text-card-foreground sm:p-5 ${className}`}>
      {title && <h2 id={id ? `${id}-title` : undefined} className="text-xl font-semibold">{title}</h2>}
      {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      <div className={title || description ? 'mt-4' : ''}>{children}</div>
    </section>
  );
}

type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';
const DOT: Record<Tone, string> = { neutral: 'bg-muted-foreground', success: 'bg-success', warning: 'bg-accent', danger: 'bg-destructive', info: 'bg-primary' };

const TONES: Record<string, Tone> = {
  active: 'success', draft: 'neutral', archived: 'neutral',
  paid: 'warning', in_production: 'info', shipped: 'info', delivered: 'success', refunded: 'danger', canceled: 'danger',
  in_review: 'warning', approved: 'success', rejected: 'danger', confirmed: 'info', ready: 'info', failed: 'danger', generating: 'neutral',
  pending: 'warning', published: 'success', hidden: 'neutral',
};

/** Trạng thái = chấm màu + chữ (không chỉ dựa vào màu). */
export function StatusBadge({ status, tone }: { status: string; tone?: Tone }) {
  const t = tone ?? TONES[status] ?? 'neutral';
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-border bg-background px-2.5 py-0.5 text-xs font-medium text-foreground">
      <span className={`size-2 rounded-full ${DOT[t]}`} aria-hidden="true" />
      {status.replace(/_/g, ' ')}
    </span>
  );
}

export function Stat({ label, value, hint, icon, href }: { label: string; value: ReactNode; hint?: ReactNode; icon?: IconName; href?: string }) {
  const body = (
    <>
      <div className="flex items-center justify-between gap-2 text-sm text-muted-foreground">
        <span>{label}</span>
        {icon && <Icon name={icon} size={18} />}
      </div>
      <div className="mt-2 font-serif text-3xl font-semibold tabular-nums text-foreground">{value}</div>
      {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
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

/** Bảng rộng cuộn ngang trong khung riêng, trang không bao giờ cuộn ngang. */
export function Table({ children, caption }: { children: ReactNode; caption: string }) {
  return (
    <div className="-mx-4 overflow-x-auto sm:mx-0" tabIndex={0} role="region" aria-label={caption}>
      <table className="w-full min-w-[640px] border-collapse text-left text-sm">
        <caption className="sr-only">{caption}</caption>
        {children}
      </table>
    </div>
  );
}
export const th = 'border-b border-border px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground';
export const td = 'border-b border-border px-3 py-3 align-top';

export const linkCls = 'font-medium text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground';
export const btn = {
  base: 'inline-flex min-h-11 items-center justify-center gap-2 rounded-[var(--radius)] px-4 text-sm font-semibold transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-60',
  primary: 'bg-primary text-on-primary hover:bg-secondary',
  accent: 'bg-accent text-on-accent hover:opacity-90',
  outline: 'border border-border bg-card text-foreground hover:border-foreground',
  danger: 'border border-destructive bg-card text-destructive hover:bg-destructive hover:text-on-destructive',
};

export const fmtDate = (s: string) => {
  const d = new Date(s.includes('T') ? s : `${s.replace(' ', 'T')}Z`);
  return Number.isNaN(d.getTime()) ? s : d.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }) + ' UTC';
};
