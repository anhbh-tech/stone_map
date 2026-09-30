// Ngày giao Standard/Express — mọi con số từ settings qua deliveryWindow()/shippingHeadline() (#3).
import { deliveryWindow, shippingHeadline } from '@/lib/settings';
import type { Settings } from '@/lib/types';
import { fmt } from '@/lib/money';
import { formatRange } from './logic';
import { TruckIcon, ZapIcon } from './icons';

export function Delivery({ settings: s, now = new Date() }: { settings: Settings; now?: Date }) {
  const rows = [
    { method: 'standard' as const, label: 'Standard', Icon: TruckIcon },
    { method: 'express' as const, label: 'Express', Icon: ZapIcon },
  ];
  return (
    <section aria-labelledby="delivery-title" className="rounded-lg border border-border bg-card p-4 text-card-foreground">
      <h2 id="delivery-title" className="font-sans text-lg font-semibold">Estimated delivery</h2>
      <ul className="mt-3 space-y-2">
        {rows.map(({ method, label, Icon }) => {
          const w = deliveryWindow(s, method, now);
          const price = s.shipping[method].price_cents;
          return (
            <li key={method} className="flex items-start gap-3 text-sm">
              <Icon className="mt-0.5 shrink-0 text-muted-foreground" />
              <span className="flex-1">
                <span className="font-medium">{label}</span> · {formatRange(w.from, w.to)}
              </span>
              <span className="text-muted-foreground">{fmt(price, s.shop.currency)}</span>
            </li>
          );
        })}
      </ul>
      <p className="mt-3 text-sm text-muted-foreground">
        {shippingHeadline(s)}. Includes {s.shipping.production_days} days to make your portrait after you approve the preview.
      </p>
    </section>
  );
}
