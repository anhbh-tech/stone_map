import { pdpCodes } from '@/lib/discounts';
import { CopyCode } from './CopyCode';

/**
 * Bảng "Buy More, Save More!" dưới giá/buy box (UI-3). Server component: đọc mã active có show_on_pdp = 1
 * (admin bật trong /admin/discounts); không có mã nào thì không render gì. Khách nhập mã ở giỏ/checkout.
 */
export function BulkDiscounts() {
  const codes = pdpCodes();
  if (!codes.length) return null;
  const cell = 'px-3 py-2.5 text-left sm:px-4';
  return (
    <section aria-labelledby="bulk-discounts-title" data-testid="bulk-discounts" className="mt-6 overflow-hidden rounded-[var(--radius)] border border-border bg-card">
      <div className="px-3 pb-3 pt-4 sm:px-4">
        <h2 id="bulk-discounts-title" className="text-xl font-semibold">Buy More, Save More!</h2>
        <p className="mt-0.5 text-sm text-muted-foreground">Enter the code in your cart or at checkout.</p>
      </div>
      <table className="w-full text-sm">
        <thead className="bg-accent-hover text-on-accent">
          <tr>
            <th scope="col" className={`${cell} font-semibold`}>Spend</th>
            <th scope="col" className={`${cell} font-semibold`}>Get</th>
            <th scope="col" className={`${cell} font-semibold`}>Code</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {codes.map((c) => (
            <tr key={c.code}>
              <th scope="row" className={`${cell} font-medium`}>{c.spend}</th>
              <td className={cell}>{c.get}</td>
              <td className="py-1 pl-3 pr-1 sm:pl-4"><CopyCode code={c.code} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
