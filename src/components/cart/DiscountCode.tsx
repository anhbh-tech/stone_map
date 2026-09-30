'use client';
import { useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { AppliedCode, CartView } from '@/lib/cart';
import { fmt } from '@/lib/money';
import { Icon } from '@/components/shell/Icon';

type ApiError = { error: { code: string; message: string } };

/**
 * Ô nhập mã giảm giá cho giỏ và checkout. Không dùng <form> (checkout đã là một form): Enter trong ô = Apply.
 * Server kiểm mã và trả CartView đã tính lại; client không tự tính số tiền.
 * `onView` (giỏ) nhận CartView mới; không có thì làm mới trang server (checkout tính tổng theo từng cách ship).
 */
export function DiscountCode({ applied, error: stored, note, onView }: {
  applied: AppliedCode | null; error: { code: string; message: string } | null; note?: { code: string; message: string } | null; onView?: (v: CartView) => void;
}) {
  const id = useId();
  const router = useRouter();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const shown = error ?? stored?.message ?? null;

  async function call(method: 'POST' | 'DELETE') {
    if (method === 'POST' && !code.trim()) { setError('Enter a discount code.'); return; }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/cart/discount', {
        method, headers: method === 'POST' ? { 'content-type': 'application/json' } : undefined,
        body: method === 'POST' ? JSON.stringify({ code }) : undefined,
      });
      const data = (await res.json()) as CartView | ApiError;
      if ('error' in data) { setError(data.error.message); return; }
      setCode('');
      setStatus(data.discount ? `Code ${data.discount.code} applied. You save ${fmt(data.discount.amount_cents)}.` : data.discount_note ? data.discount_note.message : 'Discount code removed.');
      if (onView) onView(data); else router.refresh();
    } catch {
      setError('Could not reach the store. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 border-t border-border pt-4" data-testid="discount-code">
      <p role="status" className="sr-only">{status}</p>
      {applied || note ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className={`inline-flex min-w-0 items-center gap-2 rounded-full border px-3 py-1.5 text-sm ${applied ? 'border-border bg-muted' : 'border-dashed border-input'}`}>
            <Icon name="tag" size={16} className="shrink-0" />
            <span className={`font-semibold tracking-wide ${applied ? '' : 'text-muted-foreground line-through'}`}>{applied?.code ?? note?.code}</span>
            <span className="truncate text-muted-foreground">{applied ? applied.summary : 'Not applied'}</span>
          </span>
          <button type="button" onClick={() => call('DELETE')} disabled={busy} aria-label={`Remove discount code ${applied?.code ?? note?.code}`}
            className="inline-flex min-h-11 items-center px-1 text-sm font-medium underline underline-offset-4 disabled:opacity-60">
            Remove
          </button>
        </div>
      ) : (
        <>
          <label htmlFor={`${id}-code`} className="text-sm font-medium">Discount code</label>
          <div className="mt-1 flex gap-2">
            <input id={`${id}-code`} value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" autoCapitalize="characters" spellCheck={false} maxLength={32}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); call('POST'); } }}
              aria-invalid={shown ? true : undefined} aria-describedby={shown ? `${id}-err` : undefined}
              className={`block min-h-12 min-w-0 flex-1 rounded-md border bg-background px-3 uppercase placeholder:normal-case ${shown ? 'border-destructive' : 'border-input'}`} />
            <button type="button" onClick={() => call('POST')} disabled={busy} aria-busy={busy}
              className="inline-flex min-h-12 shrink-0 items-center rounded-full border border-foreground px-5 font-semibold transition-colors hover:bg-muted disabled:cursor-wait disabled:opacity-60">
              {busy ? 'Applying…' : 'Apply'}
            </button>
          </div>
        </>
      )}
      {shown && <p id={`${id}-err`} className="mt-2 text-sm text-destructive">{shown}</p>}
      {!applied && note && !shown && <p data-testid="discount-note" className="mt-2 text-sm text-muted-foreground">{note.message}</p>}
    </div>
  );
}
