'use client';
import Image from 'next/image';
import { useRef, useState } from 'react';
import type { TrackedOrder } from '@/lib/account';
import { fmt } from '@/lib/money';
import { UiIcon } from '@/components/nav/icons';
import { Field, FormAlert, postJson, type FieldErrors } from './fields';
import { DesignBadge, OrderProgress } from './OrderProgress';

const day = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
const placed = (s: string) => new Date(s.replace(' ', 'T') + 'Z').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

/** Tra đơn bằng số đơn + email (POST, không để email trên URL). Kết quả hiện ngay dưới form, focus chuyển tới đó. */
export function TrackOrderForm() {
  const [errors, setErrors] = useState<FieldErrors>({});
  const [alert, setAlert] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [order, setOrder] = useState<TrackedOrder | null>(null);
  const alertRef = useRef<HTMLDivElement>(null);
  const resultRef = useRef<HTMLHeadingElement>(null);

  return (
    <>
      <form noValidate className="grid gap-5 sm:grid-cols-[1fr_1.4fr_auto] sm:items-start"
        onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          const number = String(f.get('number') ?? '').trim(), email = String(f.get('email') ?? '').trim();
          const errs: FieldErrors = {};
          if (!/^#?\d{1,12}$/.test(number)) errs.number = 'Enter the order number from your confirmation email';
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errs.email = 'Enter the email you used at checkout';
          setErrors(errs); setAlert(null);
          if (Object.keys(errs).length) { document.getElementById(`track-${Object.keys(errs)[0]}`)?.focus(); return; }
          setBusy(true);
          const r = await postJson<{ order: TrackedOrder }>('/api/account/track', { number, email });
          setBusy(false);
          if (r.ok) { setOrder(r.data.order); requestAnimationFrame(() => resultRef.current?.focus()); return; }
          setOrder(null); setErrors(Object.fromEntries(Object.entries(r.fields).map(([k, v]) => [k, v])));
          setAlert(r.message); requestAnimationFrame(() => alertRef.current?.focus());
        }}>
        <div className="sm:col-span-3"><FormAlert message={alert} ref={alertRef} /></div>
        <Field id="track-number" label="Order number" error={errors.number}>
          {(a) => <input {...a} name="number" inputMode="numeric" placeholder="e.g. 1001" autoComplete="off" />}
        </Field>
        <Field id="track-email" label="Email used at checkout" error={errors.email}>
          {(a) => <input {...a} name="email" type="email" autoComplete="email" autoCapitalize="none" spellCheck={false} />}
        </Field>
        <button type="submit" disabled={busy} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-md bg-accent px-6 font-semibold text-on-accent hover:opacity-90 disabled:opacity-60 sm:mt-6">
          {busy && <UiIcon name="loader" size={18} className="animate-spin motion-reduce:animate-none" />}Track order
        </button>
      </form>

      {order && (
        <section aria-labelledby="tracked" className="mt-10 rounded-[var(--radius)] border border-border bg-card p-5 md:p-6" data-testid="tracked-order">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="tracked" ref={resultRef} tabIndex={-1} className="text-3xl font-semibold outline-none">Order #{order.number}</h2>
            <p className="text-sm text-muted-foreground">Placed {placed(order.created_at)} · {fmt(order.total_cents)}</p>
          </div>
          <div className="mt-6"><OrderProgress status={order.status} /></div>
          {order.delivery && (
            <p className="mt-6 flex items-center gap-2 text-sm">
              <UiIcon name="package" size={18} className="text-muted-foreground" />
              Estimated delivery <strong>{day(order.delivery.from)} – {day(order.delivery.to)}</strong>
              <span className="text-muted-foreground">({order.shipping_method}{order.ship_to ? ` to ${order.ship_to}` : ''})</span>
            </p>
          )}
          <ul className="mt-6 divide-y divide-border border-t border-border">
            {order.lines.map((l, i) => (
              <li key={i} className="flex gap-4 py-4">
                {l.thumbnail_url
                  ? <Image src={l.thumbnail_url} alt={l.pet_name ? `Preview of ${l.pet_name}'s portrait` : 'Preview of your portrait'} width={72} height={72} unoptimized className="size-18 shrink-0 rounded-md border border-border bg-muted object-cover" />
                  : <span className="flex size-18 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground"><UiIcon name="sparkles" size={20} /></span>}
                <div className="min-w-0">
                  <p className="font-medium">{l.title}</p>
                  <p className="text-sm text-muted-foreground">{l.size} · Qty {l.qty}{l.pet_name ? ` · ${l.pet_name}` : ''}</p>
                  <div className="mt-2"><DesignBadge status={l.design_status} withDetail /></div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
