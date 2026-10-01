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
 * `better`: mã khác đang rẻ hơn cho giỏ này → một nút "Use CODE" (thay mã hiện tại, không cộng dồn).
 */
type Msg = { code: string; message: string };
const stateKey = (applied: AppliedCode | null, note?: Msg | null) => `${applied?.code ?? ''}:${applied?.amount_cents ?? ''}:${note?.code ?? ''}`;

export function DiscountCode({ applied, error: stored, note, better, onView }: {
  applied: AppliedCode | null; error: Msg | null; note?: Msg | null; better?: Msg | null; onView?: (v: CartView) => void;
}) {
  const id = useId();
  const router = useRouter();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Thông báo gắn với trạng thái mã lúc áp: đổi số lượng làm trạng thái khác đi thì thông báo cũ không còn đọc ra.
  const [status, setStatus] = useState({ text: '', key: '' });
  const shown = error ?? stored?.message ?? null;

  async function call(method: 'POST' | 'DELETE', value = code) {
    if (method === 'POST' && !value.trim()) { setError('Enter a discount code.'); return; }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/cart/discount', {
        method, headers: method === 'POST' ? { 'content-type': 'application/json' } : undefined,
        body: method === 'POST' ? JSON.stringify({ code: value }) : undefined,
      });
      const data = (await res.json()) as CartView | ApiError;
      if ('error' in data) { setError(data.error.message); return; }
      setCode('');
      setStatus({
        text: data.discount ? `Code ${data.discount.code} applied. You save ${fmt(data.discount.amount_cents)}.` : data.discount_note ? data.discount_note.message : 'Discount code removed.',
        key: stateKey(data.discount, data.discount_note),
      });
      if (onView) onView(data); else router.refresh();
    } catch {
      setError('Could not reach the store. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 border-t border-border pt-4" data-testid="discount-code">
      <p role="status" className="sr-only">{status.key === stateKey(applied, note) ? status.text : ''}</p>
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
            <input id={`${id}-code`} value={code} onChange={(e) => { setCode(e.target.value); setError(null); }} autoComplete="off" autoCapitalize="characters" spellCheck={false} maxLength={32}
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
      {better && (
        <p data-testid="discount-better" className="mt-2 flex flex-wrap items-center gap-x-2 text-sm">
          <span>{better.message}</span>
          <button type="button" onClick={() => call('POST', better.code)} disabled={busy}
            className="inline-flex min-h-11 items-center font-semibold underline underline-offset-4 disabled:opacity-60">
            Use {better.code}
          </button>
        </p>
      )}
    </div>
  );
}
