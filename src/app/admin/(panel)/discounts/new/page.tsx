import type { Metadata } from 'next';
import { requireAdminPage } from '../../../_lib/session';
import { DiscountForm } from '../../../_components/discount-form';
import { Card, PageHeader } from '../../../_components/ui';

export const metadata: Metadata = { title: 'Create discount' };

export default async function NewDiscount() {
  await requireAdminPage();
  return (
    <>
      <PageHeader title="Create discount" back={{ href: '/admin/discounts', label: 'Discounts' }} />
      <div className="max-w-3xl"><Card><DiscountForm /></Card></div>
    </>
  );
}
