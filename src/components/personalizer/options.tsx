'use client';
// Chọn size (#6: mỗi nút ghi giá + mức chênh), số lượng theo bậc giảm giá, và add-on (#7: lời chúc thiệp miễn phí).
import { useState } from 'react';
import type { Addon, BundleTier, Variant } from '@/lib/catalog';
import { delta, fmt } from '@/lib/money';
import { bundleRows } from '../pdp/logic';
import { api } from './api';

const optionCard =
  'flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 text-card-foreground transition-colors duration-150 hover:border-foreground has-[:checked]:border-primary has-[:checked]:ring-1 has-[:checked]:ring-primary has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60';

export function SizePicker({ variants, value, onChange, currency }: { variants: Variant[]; value: number; onChange: (id: number) => void; currency: string }) {
  const base = Math.min(...variants.map((v) => v.price_cents));
  return (
    <fieldset>
      <legend className="text-sm font-semibold">Size <span className="font-normal text-muted-foreground">(inches)</span></legend>
      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {variants.map((v) => {
          const d = delta(v.price_cents, base, currency);
          return (
            <label key={v.id} className={`${optionCard} flex-col items-start gap-0.5`} data-testid="size-option">
              <input type="radio" name="size" value={v.id} checked={v.id === value} onChange={() => onChange(v.id)} className="sr-only" />
              <span className="font-semibold">{v.size}</span>
              <span className="text-sm">{fmt(v.price_cents, currency)}</span>
              <span className="text-xs text-muted-foreground">{d || 'Base price'}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

export function BundlePicker({ unitCents, tiers, qty, onChange, currency }: { unitCents: number; tiers: BundleTier[]; qty: number; onChange: (q: number) => void; currency: string }) {
  const rows = bundleRows(unitCents, tiers);
  if (rows.length < 2) return null;
  return (
    <fieldset>
      <legend className="text-sm font-semibold">Quantity</legend>
      <p className="text-sm text-muted-foreground">Order more copies of this portrait and save. The discount applies to portraits only.</p>
      <div className="mt-2 grid gap-2">
        {rows.map((r) => (
          <label key={r.qty} className={optionCard} data-testid="bundle-option">
            <input type="radio" name="qty" value={r.qty} checked={r.qty === qty} onChange={() => onChange(r.qty)} className="sr-only" />
            <span className="flex-1">
              <span className="font-medium">{r.qty === 1 ? '1 portrait' : `${r.qty} portraits`}</span>
              {r.percent_off > 0 && <span className="ml-2 rounded-full bg-accent px-2 py-0.5 text-xs font-semibold text-on-accent">Save {r.percent_off}%</span>}
              {r.qty > 1 && <span className="block text-sm text-muted-foreground">{fmt(r.unit_cents, currency)} each</span>}
            </span>
            <span className="text-right">
              <span className="font-semibold">{fmt(r.total_cents, currency)}</span>
              {r.save_cents > 0 && <span className="block text-xs text-muted-foreground line-through">{fmt(unitCents * r.qty, currency)}</span>}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

type AddonState = Record<number, { on: boolean; text: string }>;

/** Add-on lưu ngay vào giỏ qua PUT /api/cart/addons; lỗi → trả về trạng thái cũ và báo cạnh add-on đó. */
export function Addons({ addons, currency, value, onChange }: { addons: Addon[]; currency: string; value: AddonState; onChange: (v: AddonState) => void }) {
  const [status, setStatus] = useState<Record<number, 'saving' | 'saved' | 'error' | undefined>>({});
  if (!addons.length) return null;

  async function save(a: Addon, on: boolean, text: string, prev: AddonState) {
    setStatus((s) => ({ ...s, [a.id]: 'saving' }));
    try {
      await api.setAddon({ addon_id: a.id, on, ...(a.text_input && text ? { text } : {}) });
      setStatus((s) => ({ ...s, [a.id]: 'saved' }));
    } catch {
      onChange(prev);
      setStatus((s) => ({ ...s, [a.id]: 'error' }));
    }
  }

  return (
    <fieldset>
      <legend className="text-sm font-semibold">Add-ons <span className="font-normal text-muted-foreground">(optional)</span></legend>
      <div className="mt-2 grid gap-2">
        {addons.map((a) => {
          const cur = value[a.id] || { on: false, text: '' };
          const st = status[a.id];
          const msgId = `addon-${a.id}-msg`;
          return (
            <div key={a.id} className="rounded-lg border border-border bg-card text-card-foreground has-[:checked]:border-primary">
              <label className="flex min-h-11 cursor-pointer items-start gap-3 px-4 py-3">
                <input
                  type="checkbox"
                  className="mt-1 size-5 shrink-0 accent-accent"
                  checked={cur.on}
                  aria-describedby={st === 'error' ? `addon-${a.id}-err` : undefined}
                  onChange={(e) => {
                    const next = { ...value, [a.id]: { ...cur, on: e.target.checked } };
                    onChange(next);
                    save(a, e.target.checked, cur.text, value);
                  }}
                />
                <span className="flex-1">
                  <span className="font-medium">{a.title}</span>
                  {a.description && <span className="block text-sm text-muted-foreground">{a.description}</span>}
                </span>
                <span className="text-sm font-medium">{a.price_cents ? `+${fmt(a.price_cents, currency)}` : 'Free'}</span>
              </label>
              {a.text_input === 1 && cur.on && (
                <div className="px-4 pb-4">
                  <label htmlFor={msgId} className="text-sm font-medium">
                    Card message {a.text_free === 1 && <span className="font-normal text-muted-foreground">— free, no extra charge</span>}
                  </label>
                  <textarea
                    id={msgId}
                    rows={3}
                    maxLength={250}
                    value={cur.text}
                    onChange={(e) => onChange({ ...value, [a.id]: { ...cur, text: e.target.value } })}
                    onBlur={() => save(a, true, cur.text, value)}
                    className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-base"
                    placeholder="Happy birthday, Mum! Love, Sam"
                  />
                  <p className="text-xs text-muted-foreground">{cur.text.length}/250</p>
                </div>
              )}
              <p className="px-4 pb-2 text-xs" aria-live="polite">
                {st === 'saving' && <span className="text-muted-foreground">Saving…</span>}
                {st === 'error' && <span id={`addon-${a.id}-err`} className="text-destructive">Couldn&apos;t save this option. Please try again.</span>}
              </p>
            </div>
          );
        })}
      </div>
    </fieldset>
  );
}
export type { AddonState };
