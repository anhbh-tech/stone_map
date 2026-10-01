'use client';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { AppliedCode, CartTotals } from '@/lib/cart';
import { fmt } from '@/lib/money';
import { Icon } from '@/components/shell/Icon';
import { Summary } from './Summary';
import { DiscountCode } from './DiscountCode';
import { announceCartCount } from '@/components/shell/CartBadge';
import { US_STATES, usRegion } from '@/lib/us-states';

type Method = 'standard' | 'express';
export type MethodOption = { id: Method; label: string; window: string; totals: CartTotals };
type Field = 'email' | 'name' | 'line1' | 'city' | 'region' | 'postal_code' | 'country';
type Errors = Partial<Record<Field, string>>;

const LABELS: Record<Field, string> = { email: 'Email', name: 'Full name', line1: 'Address', city: 'City', region: 'State', postal_code: 'ZIP code', country: 'Country' };

function validate(f: FormData): Errors {
  const e: Errors = {};
  const v = (k: string) => String(f.get(k) ?? '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v('email'))) e.email = 'Enter an email address like name@example.com';
  if (v('name').length < 2) e.name = 'Enter your full name';
  if (v('line1').length < 3) e.line1 = 'Enter your street address';
  if (v('city').length < 2) e.city = 'Enter your city';
  const us = v('country') === 'US';
  if (us ? !usRegion(v('region')) : v('region').length < 2) e.region = us ? 'Choose a US state, like TX or Texas' : 'Enter your state';
  if (!(us ? /^\d{5}(-\d{4})?$/ : /^[A-Za-z0-9][A-Za-z0-9 -]{2,9}$/).test(v('postal_code'))) e.postal_code = us ? 'Enter a 5-digit ZIP code' : 'Enter a valid ZIP code';
  if (v('country').length !== 2) e.country = 'Choose a country';
  return e;
}

/** Checkout giả lập: không thu thông tin thẻ. Lỗi hiện ngay dưới ô + bảng lỗi đầu form nhận focus (ui-ux-pro-max: error summary). */
export function CheckoutForm({ methods, regions, addons, discount, discountError, discountNote, discountBetter, children }: {
  methods: MethodOption[]; regions: string[]; addons: { title: string; price_cents: number; text?: string | null }[];
  discount: AppliedCode | null; discountError: { code: string; message: string } | null; discountNote?: { code: string; message: string } | null;
  discountBetter?: { code: string; message: string } | null; children?: React.ReactNode;
}) {
  const [method, setMethod] = useState<Method>('standard');
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const summaryRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const current = methods.find((m) => m.id === method) ?? methods[0];
  const usOnly = regions.length === 1 && regions[0] === 'US';

  async function submit(ev: React.FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const f = new FormData(ev.currentTarget);
    const errs = validate(f);
    setErrors(errs);
    setFormError(null);
    if (Object.keys(errs).length) { requestAnimationFrame(() => summaryRef.current?.focus()); return; }
    const v = (k: string) => String(f.get(k) ?? '').trim();
    setBusy(true);
    try {
      const res = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: v('email'), name: v('name'), shipping_method: method,
          address: { line1: v('line1'), line2: v('line2'), city: v('city'), region: v('region'), postal_code: v('postal_code'), country: v('country') },
        }),
      });
      const data = await res.json();
      if (res.status === 201) {
        announceCartCount(0);
        router.push(`/orders/${encodeURIComponent(data.order_number)}`);
        router.refresh(); // layout (số lượng giỏ ở header) không tự render lại khi điều hướng client
        return;
      }
      setFormError(data?.error?.message ?? 'Something went wrong. Please try again.');
      requestAnimationFrame(() => summaryRef.current?.focus());
    } catch {
      setFormError('Could not reach the store. Check your connection and try again.');
    }
    setBusy(false);
  }

  const input = (k: Field) => ({
    id: k, name: k, 'aria-invalid': errors[k] ? true : undefined, 'aria-describedby': errors[k] ? `${k}-error` : undefined,
    className: `mt-1 block min-h-12 w-full rounded-md border bg-background px-3 ${errors[k] ? 'border-destructive' : 'border-input'}`,
  });
  const label = (k: Field | 'line2', text: string) => <label htmlFor={k} className="text-sm font-medium">{text}</label>;
  const err = (k: Field) => errors[k] && <p id={`${k}-error`} className="mt-1 text-sm text-destructive">{errors[k]}</p>;
  const list = Object.entries(errors) as [Field, string][];

  return (
    <form noValidate onSubmit={submit} className="mt-6 grid gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="min-w-0 space-y-8">
        {(list.length > 0 || formError) && (
          <div ref={summaryRef} tabIndex={-1} role="alert" aria-labelledby="error-title" className="rounded-md border border-destructive p-4">
            <h2 id="error-title" className="text-xl font-semibold text-destructive">There is a problem</h2>
            {formError && <p className="mt-1">{formError}</p>}
            <ul className="mt-2 list-disc pl-5">
              {list.map(([k, m]) => <li key={k}><a href={`#${k}`} className="text-destructive underline">{LABELS[k]}: {m}</a></li>)}
            </ul>
          </div>
        )}

        <fieldset className="space-y-4">
          <legend className="font-serif text-2xl font-semibold">Contact</legend>
          <div>{label('email', 'Email')}<input {...input('email')} type="email" autoComplete="email" inputMode="email" />{err('email')}
            <p className="mt-1 text-xs text-muted-foreground">We send your order confirmation here.</p></div>
        </fieldset>

        <fieldset className="space-y-4">
          <legend className="font-serif text-2xl font-semibold">Shipping address</legend>
          <div>{label('name', 'Full name')}<input {...input('name')} autoComplete="name" />{err('name')}</div>
          <div>{label('line1', 'Address')}<input {...input('line1')} autoComplete="address-line1" />{err('line1')}</div>
          <div>{label('line2', 'Apartment, suite (optional)')}
            <input id="line2" name="line2" autoComplete="address-line2" className="mt-1 block min-h-12 w-full rounded-md border border-input bg-background px-3" /></div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div>{label('city', 'City')}<input {...input('city')} autoComplete="address-level2" />{err('city')}</div>
            <div>{label('region', 'State')}<input {...input('region')} autoComplete="address-level1" list={usOnly ? 'us-states' : undefined} />{err('region')}
              {usOnly && <datalist id="us-states">{US_STATES.map(([c, n]) => <option key={c} value={c}>{n}</option>)}</datalist>}</div>
            <div>{label('postal_code', 'ZIP code')}<input {...input('postal_code')} autoComplete="postal-code" inputMode={usOnly ? 'numeric' : undefined} maxLength={usOnly ? 10 : undefined} />{err('postal_code')}</div>
          </div>
          <div>{label('country', 'Country')}
            <select {...input('country')} autoComplete="country" defaultValue={regions[0]}>
              {regions.map((r) => <option key={r} value={r}>{r === 'US' ? 'United States' : r}</option>)}
            </select>{err('country')}</div>
        </fieldset>

        <fieldset>
          <legend className="font-serif text-2xl font-semibold">Shipping method</legend>
          <div className="mt-4 grid gap-3">
            {methods.map((m) => (
              <label key={m.id} className={`flex min-h-12 cursor-pointer items-center gap-3 rounded-md border p-4 ${method === m.id ? 'border-foreground bg-muted' : 'border-input bg-card'}`}>
                <input type="radio" name="shipping_method" value={m.id} checked={method === m.id} onChange={() => setMethod(m.id)} className="size-5 accent-[var(--accent)]" />
                <span className="flex-1"><span className="block font-medium">{m.label}</span><span className="block text-sm text-muted-foreground">Estimated delivery {m.window}</span></span>
                <span className="font-semibold">{m.totals.shipping_cents ? fmt(m.totals.shipping_cents) : 'Free'}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend className="font-serif text-2xl font-semibold">Payment</legend>
          <p className="mt-3 flex items-start gap-3 rounded-md bg-muted p-4 text-sm">
            <Icon name="shield" size={20} className="shrink-0" />
            <span>Test mode: payment is simulated on this store. No card details are needed and nothing is charged.</span>
          </p>
        </fieldset>
      </div>

      <aside aria-label="Order summary" className="h-fit rounded-[var(--radius)] border border-border bg-card p-5 lg:sticky lg:top-6">
        <h2 className="text-2xl font-semibold">Order summary</h2>
        {children}
        <DiscountCode applied={discount} error={discountError} note={discountNote} better={discountBetter} />
        <Summary totals={current.totals} addons={addons} shippingNote={current.label} code={discount} />
        <button type="submit" disabled={busy} aria-busy={busy}
          className="mt-5 flex min-h-12 w-full items-center justify-center gap-2 rounded-full bg-accent px-6 font-semibold text-on-accent transition-colors hover:bg-accent-hover disabled:cursor-wait disabled:opacity-60">
          <Icon name="lock" size={18} /> {busy ? 'Placing order…' : `Place order · ${fmt(current.totals.total_cents)}`}
        </button>
      </aside>
    </form>
  );
}
