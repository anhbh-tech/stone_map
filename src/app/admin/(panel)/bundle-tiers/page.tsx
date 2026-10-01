import type { Metadata } from 'next';
import { requireAdminPage } from '../../_lib/session';
import { listTiers } from '../../_lib/repo';
import { Card, Empty, PageHeader } from '../../_components/ui';
import { ActionButton, ApiForm, Field } from '../../_components/form';

export const metadata: Metadata = { title: 'Bundle tiers' };

export default async function TiersPage() {
  await requireAdminPage();
  const tiers = listTiers();
  return (
    <>
      <PageHeader title="Bundle tiers" description="Discount by number of portraits in the cart. The cart shows the next tier to the customer. Savings never stack: when a code saves more than the tier, the code replaces it." />
      <Card className="mb-6">
        {tiers.length === 0 ? <Empty>No bundle discounts.</Empty> : (
          <ul className="grid gap-3">
            {tiers.map((t) => (
              <li key={t.id} className="flex flex-wrap items-end gap-3 border-b border-border pb-3 last:border-0">
                <ApiForm inline action={`/api/admin/bundle-tiers/${t.id}`} method="PATCH" types={{ min_qty: 'int', percent_off: 'int' }} ariaLabel={`Tier ${t.min_qty}+`}>
                  <Field name="min_qty" label="From qty" type="number" min={2} max={100} required defaultValue={t.min_qty} className="w-28" />
                  <Field name="percent_off" label="% off" type="number" min={0} max={90} required defaultValue={t.percent_off} className="w-28" />
                </ApiForm>
                <ActionButton action={`/api/admin/bundle-tiers/${t.id}`} method="DELETE" label="Delete" icon="trash" tone="danger" ariaLabel={`Delete tier ${t.min_qty}+`} confirm={`Delete the ${t.min_qty}+ tier?`} />
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card title="Add tier" id="new-tier">
        <ApiForm inline action="/api/admin/bundle-tiers" types={{ min_qty: 'int', percent_off: 'int' }} submitLabel="Add tier" successMessage="Added" reset>
          <Field name="min_qty" label="From qty" type="number" min={2} max={100} required className="w-28" />
          <Field name="percent_off" label="% off" type="number" min={0} max={90} required className="w-28" />
        </ApiForm>
      </Card>
    </>
  );
}
