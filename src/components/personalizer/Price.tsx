// Giá DUY NHẤT của PDP, cạnh tiêu đề, màu đỏ, cập nhật theo size / số lượng / add-on (PRODUCT.md "One clear price, always current").
import { fmt } from '@/lib/money';
import type { LivePrice } from '../pdp/logic';

export function Price({ price, currency, note, compact }: { price: LivePrice; currency: string; note?: string; compact?: boolean }) {
  return (
    <div data-testid={compact ? undefined : 'price'} aria-live={compact ? undefined : 'polite'} aria-atomic="true" className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
      <span className="sr-only">{price.compare_cents ? 'Sale price ' : 'Price '}</span>
      <span data-price className={`font-bold text-sale ${compact ? 'text-lg' : 'text-[1.75rem] leading-none'}`}>{fmt(price.price_cents, currency)}</span>
      {price.compare_cents && (
        <>
          <span className={`text-muted-foreground ${compact ? 'text-sm' : 'text-lg'}`}>
            <span className="sr-only">Regular price </span><s data-price>{fmt(price.compare_cents, currency)}</s>
          </span>
          {!compact && (
            <span className="rounded-full bg-accent px-2.5 py-0.5 text-sm font-semibold text-on-accent" data-testid="sale-badge">Save {price.percent_off}%</span>
          )}
        </>
      )}
      {note && !compact && <span className="basis-full text-sm text-muted-foreground">{note}</span>}
    </div>
  );
}
