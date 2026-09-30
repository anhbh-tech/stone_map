'use client';
import { useState } from 'react';
import { UiIcon } from '@/components/nav/icons';
import type { Address, SavedAddress } from '@/lib/account';
import { Field, FormAlert, postJson, type FieldErrors } from './fields';

const KEYS = ['line1', 'line2', 'city', 'region', 'postal_code', 'country'] as const;

export function AddressLines({ a }: { a: Address }) {
  return (
    <address className="not-italic leading-relaxed">
      {a.line1}{a.line2 && <>, {a.line2}</>}<br />{a.city}, {a.region} {a.postal_code}<br />{a.country}
    </address>
  );
}

function AddressForm({ initial, regions, submitLabel, onSave, onCancel, idPrefix }: {
  initial?: Address; regions: string[]; submitLabel: string; idPrefix: string;
  onSave: (a: Address, makeDefault: boolean) => Promise<{ message: string; fields: FieldErrors } | null>; onCancel: () => void;
}) {
  const [errors, setErrors] = useState<FieldErrors>({});
  const [alert, setAlert] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const id = (k: string) => `${idPrefix}-${k}`;
  return (
    <form noValidate className="grid gap-4 sm:grid-cols-2"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        const a = Object.fromEntries(KEYS.map((k) => [k, String(f.get(k) ?? '').trim()])) as Address;
        setBusy(true);
        const err = await onSave(a, f.get('is_default') === 'on');
        setBusy(false);
        if (err) {
          setErrors(Object.fromEntries(Object.entries(err.fields).map(([k, v]) => [k.replace(/^address\./, ''), v])));
          setAlert(err.message);
        }
      }}>
      <div className="sm:col-span-2"><FormAlert message={alert} /></div>
      <Field id={id('line1')} label="Street address" error={errors.line1} className="sm:col-span-2">
        {(p) => <input {...p} name="line1" autoComplete="address-line1" defaultValue={initial?.line1} />}
      </Field>
      <Field id={id('line2')} label="Apartment, suite (optional)" error={errors.line2} className="sm:col-span-2">
        {(p) => <input {...p} name="line2" autoComplete="address-line2" defaultValue={initial?.line2} />}
      </Field>
      <Field id={id('city')} label="City" error={errors.city}>
        {(p) => <input {...p} name="city" autoComplete="address-level2" defaultValue={initial?.city} />}
      </Field>
      <Field id={id('region')} label="State" error={errors.region}>
        {(p) => <input {...p} name="region" autoComplete="address-level1" defaultValue={initial?.region} />}
      </Field>
      <Field id={id('postal_code')} label="ZIP / postal code" error={errors.postal_code}>
        {(p) => <input {...p} name="postal_code" autoComplete="postal-code" defaultValue={initial?.postal_code} />}
      </Field>
      <Field id={id('country')} label="Country" error={errors.country}>
        {(p) => (
          <select {...p} name="country" autoComplete="country" defaultValue={initial?.country ?? regions[0]}>
            {regions.map((r) => <option key={r} value={r}>{r === 'US' ? 'United States' : r}</option>)}
          </select>
        )}
      </Field>
      {!initial && (
        <label className="flex min-h-11 items-center gap-3 text-sm sm:col-span-2">
          <input type="checkbox" name="is_default" className="size-5 accent-[var(--primary)]" />Use as my default address
        </label>
      )}
      <div className="flex flex-wrap gap-3 sm:col-span-2">
        <button type="submit" disabled={busy} className="inline-flex min-h-12 items-center rounded-full bg-primary px-7 font-semibold text-on-primary transition-colors hover:bg-secondary disabled:opacity-60">{submitLabel}</button>
        <button type="button" onClick={onCancel} className="inline-flex min-h-12 items-center rounded-full border border-input bg-background px-6 font-medium hover:bg-muted">Cancel</button>
      </div>
    </form>
  );
}

/** Sổ địa chỉ: thêm, sửa, đặt mặc định, xoá (xác nhận ngay tại chỗ, không popup). */
export function AddressBook({ initial, regions }: { initial: SavedAddress[]; regions: string[] }) {
  const [list, setList] = useState(initial);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const [confirmDel, setConfirmDel] = useState<number | null>(null);
  const [status, setStatus] = useState('');
  const [error, setError] = useState<string | null>(null);

  const apply = async (url: string, body: unknown, method: string, done: string) => {
    const r = await postJson<{ addresses: SavedAddress[] }>(url, body, method);
    if (!r.ok) return { message: r.message, fields: r.fields };
    setList(r.data.addresses);
    setStatus(done);
    setError(null);
    return null;
  };
  const quick = async (url: string, method: string, done: string) => {
    const err = await apply(url, method === 'DELETE' ? undefined : { is_default: true }, method, done);
    if (err) setError(err.message);
  };

  return (
    <div>
      <p className="sr-only" aria-live="polite">{status}</p>
      {error && <p role="alert" className="mb-3 text-sm text-destructive">{error}</p>}
      {list.length === 0 && !adding && (
        <p className="text-muted-foreground">No saved addresses yet. Add one to see it here.</p>
      )}
      <ul className="grid gap-3">
        {list.map((s) => (
          <li key={s.id} className="rounded-lg border border-border bg-card p-4" data-testid="address">
            {editing === s.id ? (
              <AddressForm idPrefix={`edit-${s.id}`} initial={s.address} regions={regions} submitLabel="Save address" onCancel={() => setEditing(null)}
                onSave={async (a) => { const e = await apply(`/api/account/addresses/${s.id}`, { address: a }, 'PATCH', 'Address saved.'); if (!e) setEditing(null); return e; }} />
            ) : (
              <>
                <div className="flex items-start justify-between gap-3">
                  <span className="text-sm"><AddressLines a={s.address} /></span>
                  {s.is_default && <span className="shrink-0 rounded-full bg-muted px-2.5 py-0.5 text-xs font-semibold text-foreground">Default</span>}
                </div>
                <div className="mt-3 flex flex-wrap gap-x-1 gap-y-1 text-sm">
                  {confirmDel === s.id ? (
                    <>
                      <span className="inline-flex min-h-11 items-center pr-2 text-muted-foreground">Remove this address?</span>
                      <button type="button" onClick={async () => { await quick(`/api/account/addresses/${s.id}`, 'DELETE', 'Address removed.'); setConfirmDel(null); }}
                        className="inline-flex min-h-11 items-center rounded-md px-3 font-semibold text-destructive hover:bg-muted">Remove</button>
                      <button type="button" onClick={() => setConfirmDel(null)} className="inline-flex min-h-11 items-center rounded-md px-3 font-medium hover:bg-muted">Keep</button>
                    </>
                  ) : (
                    <>
                      <button type="button" onClick={() => { setEditing(s.id); setAdding(false); }} className="inline-flex min-h-11 items-center gap-1.5 rounded-md px-3 font-medium hover:bg-muted">
                        <UiIcon name="pencil" size={16} />Edit
                      </button>
                      {!s.is_default && (
                        <button type="button" onClick={() => quick(`/api/account/addresses/${s.id}`, 'PATCH', 'Default address updated.')} className="inline-flex min-h-11 items-center rounded-md px-3 font-medium hover:bg-muted">
                          Make default
                        </button>
                      )}
                      <button type="button" onClick={() => setConfirmDel(s.id)} className="inline-flex min-h-11 items-center rounded-md px-3 font-medium text-muted-foreground hover:bg-muted hover:text-destructive">
                        Remove
                      </button>
                    </>
                  )}
                </div>
              </>
            )}
          </li>
        ))}
      </ul>
      {adding ? (
        <div className="mt-4 rounded-lg border border-border bg-card p-4">
          <h3 className="mb-4 font-sans text-base font-semibold">New address</h3>
          <AddressForm idPrefix="new" regions={regions} submitLabel="Save address" onCancel={() => setAdding(false)}
            onSave={async (a, makeDefault) => { const e = await apply('/api/account/addresses', { address: a, is_default: makeDefault }, 'POST', 'Address added.'); if (!e) setAdding(false); return e; }} />
        </div>
      ) : (
        <button type="button" onClick={() => { setAdding(true); setEditing(null); }}
          className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-full border border-input bg-background px-5 text-sm font-medium hover:bg-muted">
          <UiIcon name="plus" size={18} />Add address
        </button>
      )}
    </div>
  );
}
