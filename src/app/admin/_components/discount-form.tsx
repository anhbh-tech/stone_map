'use client';
// Form mã giảm giá: loại (phần trăm / số tiền / miễn ship) quyết định ô “value” là % (int) hay $ (cent).
import { useState } from 'react';
import { ApiForm, Checkbox, Field, MoneyField } from './form';

type Kind = 'percent' | 'fixed' | 'free_shipping';
type Initial = { id: number; code: string; kind: Kind; value: number; min_subtotal_cents: number | null; min_qty: number | null; starts_at: string | null; ends_at: string | null; usage_limit: number | null; active: 0 | 1 };

const KINDS: { value: Kind; label: string; hint: string }[] = [
  { value: 'percent', label: 'Percentage', hint: 'e.g. 15% off the portraits' },
  { value: 'fixed', label: 'Fixed amount', hint: 'e.g. $10 off the order' },
  { value: 'free_shipping', label: 'Free shipping', hint: 'Waives the shipping charge' },
];

export function DiscountForm({ initial }: { initial?: Initial }) {
  const [kind, setKind] = useState<Kind>(initial?.kind ?? 'percent');
  const day = (s: string | null | undefined) => (s ? s.slice(0, 10) : '');
  const types = {
    ...(initial ? {} : { code: 'text' as const }),
    kind: 'text' as const,
    ...(kind === 'free_shipping' ? {} : { value: kind === 'fixed' ? ('money' as const) : ('int' as const) }),
    min_qty: 'nullint' as const, min_subtotal_cents: 'nullmoney' as const, starts_at: 'nulltext' as const, ends_at: 'nulltext' as const, usage_limit: 'nullint' as const, active: 'bool' as const,
  };
  return (
    <ApiForm action={initial ? `/api/admin/discounts/${initial.id}` : '/api/admin/discounts'} method={initial ? 'PATCH' : 'POST'} types={types}
      extra={kind === 'free_shipping' ? { value: 0 } : undefined} ariaLabel={initial ? 'Edit discount' : 'New discount'}
      submitLabel={initial ? 'Save discount' : 'Create discount'} successMessage={initial ? 'Discount saved' : 'Discount created'} redirect={initial ? undefined : '/admin/discounts/{id}'}>
      {!initial && <Field name="code" label="Discount code" required minLength={3} maxLength={32} autoComplete="off" className="max-w-sm" style={{ textTransform: 'uppercase' }}
        hint="Customers type this at checkout. 3–32 letters, digits or dashes; saved in capitals." />}
      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm font-medium">Type</legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {KINDS.map((k) => (
            <label key={k.value} className={`flex min-h-11 cursor-pointer items-start gap-3 rounded-[var(--radius)] border px-3 py-2.5 text-sm transition-colors duration-150 ${kind === k.value ? 'border-foreground bg-card' : 'border-border hover:border-foreground'}`}>
              <input type="radio" name="kind" value={k.value} checked={kind === k.value} onChange={() => setKind(k.value)} className="mt-0.5 size-4 shrink-0" />
              <span><span className="block font-medium">{k.label}</span><span className="block text-xs text-muted-foreground">{k.hint}</span></span>
            </label>
          ))}
        </div>
      </fieldset>
      {kind === 'percent' && <Field key="pct" name="value" label="Percentage off" type="number" inputMode="numeric" min={1} max={100} step={1} required defaultValue={initial?.kind === 'percent' ? initial.value : ''} className="max-w-48" hint="1 to 100" />}
      {kind === 'fixed' && <MoneyField key="amt" name="value" label="Amount off" required cents={initial?.kind === 'fixed' ? initial.value : null} className="max-w-48" hint="Never more than the order subtotal" />}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field name="min_qty" label="Minimum portraits in cart" type="number" inputMode="numeric" min={1} max={100} defaultValue={initial?.min_qty ?? ''} hint="Blank for no minimum. Use 2, 3, 5… for buy-more tiers." />
        <MoneyField name="min_subtotal_cents" label="Minimum subtotal" cents={initial?.min_subtotal_cents ?? null} hint="Blank for no minimum" />
        <Field name="starts_at" label="Starts" type="date" defaultValue={day(initial?.starts_at)} hint="UTC, from 00:00. Blank = now" />
        <Field name="ends_at" label="Ends" type="date" defaultValue={day(initial?.ends_at)} hint="UTC, through 23:59. Blank = no end" />
        <Field name="usage_limit" label="Total uses allowed" type="number" inputMode="numeric" min={1} defaultValue={initial?.usage_limit ?? ''} hint="Blank for unlimited" />
      </div>
      <Checkbox name="active" label="Active" defaultChecked={initial ? !!initial.active : true} hint="Turn off to pause the code without deleting it." />
    </ApiForm>
  );
}
