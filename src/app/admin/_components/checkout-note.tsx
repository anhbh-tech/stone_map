import { Icon } from './icons';

/** Trung thực về phạm vi: checkout (src/lib/cart.ts, crew khác) chưa nhận mã. Bỏ khi đã nối. */
export function CheckoutNote() {
  return (
    <p role="note" className="mb-4 flex gap-2 rounded-[var(--radius)] border border-border bg-muted px-3 py-2.5 text-sm">
      <Icon name="alert" className="mt-0.5 shrink-0 text-muted-foreground" />
      <span>Checkout does not accept codes yet. Codes you set up here are stored and counted against orders once the storefront checkout applies them.</span>
    </p>
  );
}
