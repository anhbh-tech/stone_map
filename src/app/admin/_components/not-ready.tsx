// Bảng của UI-2 (customers / collections) chưa có trong DB này: nói rõ lý do thay vì báo lỗi.
import { EmptyState } from './ui';

export function TablesNotReady({ what }: { what: 'customers' | 'collections' }) {
  return (
    <div className="rounded-[var(--radius)] border border-border bg-card">
      <EmptyState icon={what === 'customers' ? 'users' : 'folder'} title={what === 'customers' ? 'Customer accounts are not set up yet' : 'Collections are not set up yet'}>
        {what === 'customers'
          ? 'This database has no customers table. It is created by the storefront account migration (ui2_001_customers.sql); run the app once after that change lands and customers who sign up will be listed here.'
          : 'This database has no collections table. It is created by the storefront migration (ui2_001_customers.sql); once it runs you can group products into collections here.'}
      </EmptyState>
    </div>
  );
}
