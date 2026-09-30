'use client';
import { useEffect, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import type { CartAddonView, CartLineView, CartView } from '@/lib/cart';
import { fmt } from '@/lib/money';
import { Icon } from '@/components/shell/Icon';
import { Summary } from './Summary';
import { announceCartCount } from '@/components/shell/CartBadge';

type ApiError = { error: { code: string; message: string } };

/** Giỏ tương tác: mọi thay đổi gọi /api/cart* và thay state bằng CartView server trả về (giá không tính ở client). */
export function CartClient({ initial, shopHref }: { initial: CartView; shopHref: string }) {
  const [view, setView] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  // Header có thể còn số cũ nếu tới đây bằng điều hướng client (PDP → /cart).
  useEffect(() => { announceCartCount(initial.count); }, [initial.count]);

  async function call(url: string, method: string, body?: unknown) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(url, { method, headers: body ? { 'content-type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
      const data = (await res.json()) as CartView | ApiError;
      if ('error' in data) setError(data.error.message);
      else {
        setView(data);
        setStatus(`Cart updated: ${data.count} ${data.count === 1 ? 'item' : 'items'}, total ${fmt(data.totals.total_cents)}`);
        announceCartCount(data.count);
      }
    } catch {
      setError('Could not reach the store. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  const title = <h1 className="text-4xl font-semibold md:text-5xl">{view.lines.length ? 'Your cart' : 'Your cart is empty'}</h1>;
  if (!view.lines.length) {
    return (
      <div>
        {title}
        <p className="mt-6 text-muted-foreground">Nothing here yet. Create a portrait and it will appear in your cart once you approve the preview.</p>
        <Link href={shopHref} className="mt-6 inline-flex min-h-12 items-center gap-2 rounded-md bg-accent px-6 font-semibold text-on-accent hover:opacity-90">
          Create your portrait <Icon name="arrowRight" size={18} />
        </Link>
      </div>
    );
  }

  return (
    <>
    {title}
    <div className="mt-6 grid gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="min-w-0">
        <p role="status" className="sr-only">{status}</p>
        <p role="alert" className={error ? 'mb-4 rounded-md border border-destructive px-4 py-3 text-destructive' : 'sr-only'}>{error}</p>
        {(view.bundle.hint || view.bundle.saving) && (
          <p role="status" data-testid="bundle-hint" className="mb-4 flex flex-wrap items-center gap-2 rounded-md bg-muted px-4 py-3 text-sm">
            <Icon name="tag" size={18} />
            <span>{[view.bundle.saving, view.bundle.hint].filter(Boolean).join(' · ')}</span>
            {view.bundle.hint && <Link href={shopHref} className="font-semibold text-foreground underline underline-offset-2">Create another portrait</Link>}
          </p>
        )}
        <ul data-testid="cart-lines" aria-busy={busy} className="divide-y divide-border rounded-[var(--radius)] border border-border bg-card">
          {view.lines.map((l) => (
            <Line key={l.id} line={l} busy={busy}
              onQty={(qty) => call(`/api/cart/lines/${l.id}`, 'PATCH', { qty })}
              onRemove={() => call(`/api/cart/lines/${l.id}`, 'DELETE')} />
          ))}
        </ul>
        {view.addons.length > 0 && (
          <fieldset className="mt-8" disabled={busy}>
            <legend className="font-serif text-2xl font-semibold">Finishing touches</legend>
            <ul className="mt-4 grid gap-3">
              {view.addons.map((a) => (
                <Addon key={a.id} addon={a} onChange={(on, text) => call('/api/cart/addons', 'PUT', { addon_id: a.id, on, text })} />
              ))}
            </ul>
          </fieldset>
        )}
      </div>
      <aside aria-label="Order summary" className="h-fit rounded-[var(--radius)] border border-border bg-card p-5 lg:sticky lg:top-6">
        <h2 className="text-2xl font-semibold">Summary</h2>
        <Summary totals={view.totals} addons={view.addons.filter((a) => a.on)} shippingNote="Standard. Express is available at checkout." />
        <Link href="/checkout" aria-disabled={busy}
          className="mt-5 flex min-h-12 w-full items-center justify-center gap-2 rounded-md bg-accent px-6 font-semibold text-on-accent hover:opacity-90">
          <Icon name="lock" size={18} /> Checkout
        </Link>
        <p className="mt-3 text-center text-xs text-muted-foreground">{view.shipping_headline}</p>
      </aside>
    </div>
    </>
  );
}

function Line({ line: l, busy, onQty, onRemove }: { line: CartLineView; busy: boolean; onQty: (q: number) => void; onRemove: () => void }) {
  const pet = l.properties['Pet name'];
  const step = 'flex size-11 touch-manipulation items-center justify-center rounded-md border border-border hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40';
  return (
    <li data-testid="cart-line" className="flex gap-4 p-4">
      {l.thumbnail_url ? (
        // Ảnh preview đã là webp do worker xuất sẵn cỡ web → unoptimized, vẫn giữ width/height (CLS).
        <Image src={l.thumbnail_url} alt={pet ? `Preview of ${pet}'s portrait` : 'Preview of your portrait'} width={96} height={96} unoptimized
          className="size-24 shrink-0 rounded-md border border-border bg-muted object-cover" />
      ) : (
        <span className="flex size-24 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground"><Icon name="sparkles" /></span>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="font-semibold">{l.product_title}</p>
          <p className="font-semibold">{fmt(l.line_cents)}</p>
        </div>
        <p className="text-sm text-muted-foreground">Size {l.size} in · {fmt(l.unit_cents)} each</p>
        <dl data-testid="line-props" className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 text-sm">
          {Object.entries(l.properties).map(([k, v]) => (
            <div key={k} className="contents"><dt className="text-muted-foreground">{k}</dt><dd className="break-words">{v}</dd></div>
          ))}
        </dl>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2" role="group" aria-label={`Quantity for ${pet ?? l.product_title}`}>
            <button type="button" className={step} aria-label="Decrease quantity" disabled={busy || l.qty <= 1} onClick={() => onQty(l.qty - 1)}><Icon name="minus" size={18} /></button>
            <output data-testid="line-qty" className="w-8 text-center font-semibold">{l.qty}</output>
            <button type="button" className={step} aria-label="Increase quantity" disabled={busy || l.qty >= 20} onClick={() => onQty(l.qty + 1)}><Icon name="plus" size={18} /></button>
          </div>
          <button type="button" onClick={onRemove} disabled={busy}
            className="ml-auto inline-flex min-h-11 items-center gap-1 rounded-md px-3 text-sm text-muted-foreground hover:text-destructive disabled:opacity-40">
            <Icon name="trash" size={18} /> Remove
          </button>
        </div>
      </div>
    </li>
  );
}

function Addon({ addon: a, onChange }: { addon: CartAddonView; onChange: (on: boolean, text?: string) => void }) {
  const [text, setText] = useState(a.text ?? '');
  const id = `addon-${a.id}`;
  return (
    <li className="rounded-[var(--radius)] border border-border bg-card p-4">
      <div className="flex items-start gap-3">
        <input id={id} type="checkbox" checked={a.on} onChange={(e) => onChange(e.target.checked, text || undefined)} className="mt-1 size-5 accent-[var(--accent)]" />
        <label htmlFor={id} className="flex-1 cursor-pointer">
          <span className="flex flex-wrap justify-between gap-2 font-medium"><span>{a.title}</span><span>{a.price_cents ? `+${fmt(a.price_cents)}` : 'Free'}</span></span>
          {a.description && <span className="block text-sm text-muted-foreground">{a.description}</span>}
        </label>
      </div>
      {a.text_input && a.on && (
        <div className="mt-3 pl-8">
          <label htmlFor={`${id}-text`} className="text-sm font-medium">Message{a.text_free ? ' (free)' : ''}</label>
          <textarea id={`${id}-text`} maxLength={300} rows={2} value={text} onChange={(e) => setText(e.target.value)}
            onBlur={() => { if (text !== (a.text ?? '')) onChange(true, text); }}
            className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2" />
          <p className="text-xs text-muted-foreground">{300 - text.length} characters left · saved when you leave the field</p>
        </div>
      )}
    </li>
  );
}
