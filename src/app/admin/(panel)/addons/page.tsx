import type { Metadata } from 'next';
import { fmt } from '@/lib/money';
import { requireAdminPage } from '../../_lib/session';
import { listAddons } from '../../_lib/repo';
import { Card, Empty, PageHeader, StatusBadge } from '../../_components/ui';
import { ActionButton, ApiForm, Checkbox, Field, MoneyField, Select } from '../../_components/form';

export const metadata: Metadata = { title: 'Add-ons' };

const KINDS = ['frame', 'card', 'protection', 'priority', 'care'] as const;
const TYPES = { title: 'text', description: 'nulltext', kind: 'text', price_cents: 'money', text_input: 'bool', text_free: 'bool', active: 'bool', position: 'int' } as const;

export default async function AddonsPage() {
  await requireAdminPage();
  const addons = listAddons();
  return (
    <>
      <PageHeader title="Add-ons" description="Frame add-ons are hidden automatically on products that already include a frame. Gift-card messages should stay free." />
      <div className="grid gap-4">
        {addons.length === 0 && <Empty>No add-ons yet.</Empty>}
        {addons.map((a) => (
          <Card key={a.id}>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <h2 className="text-xl font-semibold">{a.title}</h2>
              <span className="tabular-nums text-muted-foreground">{fmt(a.price_cents)}</span>
              <StatusBadge status={a.active ? 'active' : 'hidden'} />
              <span className="text-xs text-muted-foreground">{a.handle}</span>
            </div>
            <ApiForm action={`/api/admin/addons/${a.id}`} method="PATCH" types={TYPES} ariaLabel={`Add-on ${a.title}`} className="sm:grid-cols-2 xl:grid-cols-4">
              <Field name="title" label="Title" required maxLength={80} defaultValue={a.title} />
              <Field name="description" label="Description" maxLength={300} defaultValue={a.description ?? ''} className="xl:col-span-2" />
              <Select name="kind" label="Kind" defaultValue={a.kind} options={KINDS} />
              <MoneyField name="price_cents" label="Price" required cents={a.price_cents} />
              <Field name="position" label="Order" type="number" min={0} defaultValue={a.position} />
              <Checkbox name="text_input" label="Has a text field" defaultChecked={!!a.text_input} hint="e.g. gift message" />
              <Checkbox name="text_free" label="Text is free" defaultChecked={!!a.text_free} />
              <Checkbox name="active" label="Active (offered in store)" defaultChecked={!!a.active} />
            </ApiForm>
            <div className="mt-2"><ActionButton action={`/api/admin/addons/${a.id}`} method="DELETE" label="Delete" icon="trash" tone="danger" confirm={`Delete “${a.title}”? If it was ever used in a cart, turn off Active instead.`} /></div>
          </Card>
        ))}
        <Card title="New add-on" id="new-addon">
          <ApiForm action="/api/admin/addons" types={{ ...TYPES, handle: 'text' }} submitLabel="Create add-on" successMessage="Created" reset className="sm:grid-cols-2 xl:grid-cols-4">
            <Field name="handle" label="Handle" required pattern="[a-z0-9]+(-[a-z0-9]+)*" placeholder="silver-frame" />
            <Field name="title" label="Title" required maxLength={80} />
            <Field name="description" label="Description" maxLength={300} className="xl:col-span-2" />
            <Select name="kind" label="Kind" options={KINDS} />
            <MoneyField name="price_cents" label="Price" required cents={null} />
            <Field name="position" label="Order" type="number" min={0} defaultValue={addons.length} />
            <Checkbox name="text_input" label="Has a text field" />
            <Checkbox name="text_free" label="Text is free" defaultChecked />
            <Checkbox name="active" label="Active (offered in store)" defaultChecked />
          </ApiForm>
        </Card>
      </div>
    </>
  );
}
