import type { Totals } from '@/lib/pricing';
import { fmt } from '@/lib/money';

/** Bảng tổng tiền dùng chung cho giỏ, checkout, trang cảm ơn. Số liệu luôn là Totals từ pricing.totals(). */
export function Summary({ totals: t, addons = [], shippingNote, code }: {
  totals: Totals & { code_discount_cents?: number }; addons?: { title: string; price_cents: number; text?: string | null }[]; shippingNote?: string;
  /** Mã giảm giá đã áp (số tiền nằm ở totals.code_discount_cents, do server tính). */
  code?: { code: string; free_shipping: boolean } | null;
}) {
  const row = 'flex justify-between gap-4 py-1';
  return (
    <dl data-testid="totals" className="mt-4 text-sm">
      <div className={row}><dt>Subtotal</dt><dd>{fmt(t.subtotal_cents)}</dd></div>
      {t.discount_cents > 0 && <div className={`${row} text-success`}><dt>Multi-portrait discount</dt><dd>−{fmt(t.discount_cents)}</dd></div>}
      {code && !!t.code_discount_cents && <div className={`${row} text-success`} data-testid="code-discount"><dt>Discount <span className="font-semibold">{code.code}</span></dt><dd>−{fmt(t.code_discount_cents)}</dd></div>}
      {addons.map((a) => (
        <div key={a.title} className={row}>
          <dt className="min-w-0">{a.title}{a.text && <span className="block break-words text-xs text-muted-foreground">“{a.text}”</span>}</dt>
          <dd>{a.price_cents ? fmt(a.price_cents) : 'Free'}</dd>
        </div>
      ))}
      <div className={row}>
        <dt>Shipping{shippingNote && <span className="block text-xs text-muted-foreground">{shippingNote}{code?.free_shipping ? ` · free with ${code.code}` : ''}</span>}</dt>
        <dd>{t.shipping_cents ? fmt(t.shipping_cents) : 'Free'}</dd>
      </div>
      <div className={`${row} mt-2 border-t border-border pt-3 text-base font-semibold`}><dt>Total</dt><dd data-testid="total">{fmt(t.total_cents)}</dd></div>
    </dl>
  );
}
