'use client';
// Chọn size, số lượng theo bậc giảm giá, và add-on (#7: lời chúc thiệp miễn phí).
// Nút lựa chọn KHÔNG ghi giá (PRODUCT.md: giá chỉ hiện 1 chỗ cạnh tiêu đề và đổi theo lựa chọn); add-on chỉ ghi phần cộng thêm "+$x".
import { useState } from 'react';
import type { Addon, BundleTier, Variant } from '@/lib/catalog';
import { fmt } from '@/lib/money';
import { bundleRows } from '../pdp/logic';
import { api } from './api';

// Đang chọn = viền + nền đỏ nhạt, giống selectedCls ở Personalizer.
const optionCard =
  'flex min-h-12 cursor-pointer items-center justify-center gap-1 rounded-lg border border-input bg-card px-3 py-2 text-center text-card-foreground transition-colors duration-150 hover:border-foreground has-[:checked]:border-accent has-[:checked]:bg-accent-soft has-[:checked]:ring-1 has-[:checked]:ring-accent has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60';

export function SizePicker({ variants, value, onChange }: { variants: Variant[]; value: number; onChange: (id: number) => void; currency?: string }) {
  const current = variants.find((v) => v.id === value);
  return (
    <fieldset className="min-w-0">
      <legend className="text-sm">
        <span className="font-semibold">Size:</span> <span className="text-muted-foreground">{current ? `${current.size} in` : 'inches'}</span>
      </legend>
      <div className="mt-2 grid grid-cols-4 gap-2">
        {variants.map((v) => (
          <label key={v.id} className={`${optionCard} font-semibold`} data-testid="size-option">
            <input type="radio" name="size" value={v.id} checked={v.id === value} onChange={() => onChange(v.id)} className="sr-only" />
            {v.size}<span className="sr-only"> inches</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function BundlePicker({ unitCents, tiers, qty, onChange }: { unitCents: number; tiers: BundleTier[]; qty: number; onChange: (q: number) => void; currency?: string }) {
  const rows = bundleRows(unitCents, tiers);
  if (rows.length < 2) return null;
  return (
    <fieldset className="min-w-0">
      <legend className="text-sm"><span className="font-semibold">Quantity:</span> <span className="text-muted-foreground">{qty === 1 ? '1 portrait' : `${qty} portraits`}</span></legend>
      <p className="text-sm text-muted-foreground">Order more copies of this portrait and save. The discount applies to portraits only.</p>
      <div className="mt-2 grid grid-cols-4 gap-2">
        {rows.map((r) => (
          <label key={r.qty} className={`${optionCard} flex-col gap-0`} data-testid="bundle-option">
            <input type="radio" name="qty" value={r.qty} checked={r.qty === qty} onChange={() => onChange(r.qty)} className="sr-only" />
            <span className="font-semibold">{r.qty}<span className="sr-only">{r.qty === 1 ? ' portrait' : ' portraits'}</span></span>
            {r.percent_off > 0 && <span className="text-xs font-semibold text-sale">Save {r.percent_off}%</span>}
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
    <fieldset className="min-w-0">
      <legend className="text-sm font-semibold">Add-ons <span className="font-normal text-muted-foreground">(optional)</span></legend>
      <div className="mt-2 grid grid-cols-1 gap-2">
        {addons.map((a) => {
          const cur = value[a.id] || { on: false, text: '' };
          const st = status[a.id];
          const msgId = `addon-${a.id}-msg`;
          return (
            <div key={a.id} className="rounded-lg border border-input bg-card text-card-foreground transition-colors duration-150 has-[:checked]:border-accent has-[:checked]:bg-accent-soft has-[:checked]:ring-1 has-[:checked]:ring-accent">
              <label className="flex min-h-11 cursor-pointer flex-wrap items-start gap-x-3 gap-y-1 px-4 py-3">
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
                <span className="ml-auto text-sm font-medium tabular-nums">{a.price_cents ? `+${fmt(a.price_cents, currency)}` : 'Free'}</span>
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
                    className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-base"
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
