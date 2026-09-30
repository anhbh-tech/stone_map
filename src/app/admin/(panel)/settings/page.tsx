import type { Metadata } from 'next';
import { getSettings, shippingHeadline } from '@/lib/settings';
import { requireAdminPage } from '../../_lib/session';
import { listStaff, staffName } from '../../_lib/staff';
import { Card, PageHeader, StatusBadge } from '../../_components/ui';
import { ActionButton, ApiForm, Field, MoneyField, Select, TextArea } from '../../_components/form';

const SECTIONS = [['shop', 'Shop'], ['shipping', 'Shipping'], ['claims', 'Marketing claims'], ['privacy', 'Privacy'], ['ai', 'AI generation'], ['preflight', 'Photo preflight'], ['staff', 'Staff']] as const;

export const metadata: Metadata = { title: 'Settings' };

// Mỗi key của Settings (src/lib/types.ts) một form, PUT /api/admin/settings/:key với cả giá trị của key đó.
// Đây là nguồn sự thật duy nhất cho câu chữ ship / khung / số liệu trên storefront (#3).
export default async function SettingsPage() {
  const me = await requireAdminPage();
  const s = getSettings();
  const staff = listStaff();
  const grid = 'sm:grid-cols-2 xl:grid-cols-3';
  return (
    <>
      <PageHeader title="Settings" description="The single source of truth for shipping, privacy, claims and AI copy shown in the store. Nothing about shipping or numbers is hard-coded in pages." />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[11rem_minmax(0,1fr)]">
      <nav aria-label="Settings sections" className="lg:sticky lg:top-20 lg:self-start">
        <ul className="flex gap-1 overflow-x-auto pb-1 text-sm lg:flex-col lg:overflow-visible">
          {SECTIONS.map(([k, label]) => (
            <li key={k} className="shrink-0"><a href={`#settings-${k}`} className="flex min-h-11 items-center rounded-[var(--radius)] px-3 font-medium text-muted-foreground hover:bg-muted hover:text-foreground">{label}</a></li>
          ))}
        </ul>
      </nav>
      <div className="grid gap-6">
        <Card title="Shop" id="settings-shop">
          <ApiForm action="/api/admin/settings/shop" method="PUT" types={{ name: 'text', support_email: 'text', currency: 'text' }} className={grid}>
            <Field name="name" label="Shop name" required defaultValue={s.shop.name} />
            <Field name="support_email" label="Support email" type="email" required defaultValue={s.shop.support_email} />
            <Select name="currency" label="Currency" defaultValue={s.shop.currency} options={['USD']} />
          </ApiForm>
        </Card>

        <Card title="Shipping" id="settings-shipping" description="Banner, product page, cart and shipping policy all read these values.">
          <div className="mb-4 rounded-[var(--radius)] border border-border bg-muted p-3 text-sm">
            <span className="text-muted-foreground">Storefront headline: </span>
            <strong data-testid="shipping-headline">{shippingHeadline(s)}</strong>
          </div>
          <ApiForm action="/api/admin/settings/shipping" method="PUT" className={grid}
            types={{ regions: 'lines', free_over_cents: 'nullmoney', 'standard.price_cents': 'money', 'standard.min_days': 'int', 'standard.max_days': 'int', 'express.price_cents': 'money', 'express.min_days': 'int', 'express.max_days': 'int', production_days: 'int' }}>
            <Field name="regions" label="Ship to regions" required defaultValue={s.shipping.regions.join(', ')} hint="Comma separated country codes, e.g. US or US, CA" />
            <MoneyField name="free_over_cents" label="Free shipping over" cents={s.shipping.free_over_cents} hint="Blank = no free shipping" />
            <Field name="production_days" label="Production days" type="number" min={0} max={120} required defaultValue={s.shipping.production_days} hint="Added to every delivery estimate" />
            <MoneyField name="standard.price_cents" label="Standard price" required cents={s.shipping.standard.price_cents} />
            <Field name="standard.min_days" label="Standard min days" type="number" min={0} max={120} required defaultValue={s.shipping.standard.min_days} />
            <Field name="standard.max_days" label="Standard max days" type="number" min={0} max={120} required defaultValue={s.shipping.standard.max_days} />
            <MoneyField name="express.price_cents" label="Express price" required cents={s.shipping.express.price_cents} />
            <Field name="express.min_days" label="Express min days" type="number" min={0} max={120} required defaultValue={s.shipping.express.min_days} />
            <Field name="express.max_days" label="Express max days" type="number" min={0} max={120} required defaultValue={s.shipping.express.max_days} />
          </ApiForm>
        </Card>

        <Card title="Marketing claims" id="settings-claims" description="Leave blank to hide. Only enter numbers you can back up. Star ratings and review counts on product pages come from the reviews table, not from here.">
          <ApiForm action="/api/admin/settings/claims" method="PUT" types={{ customers_count: 'nullint', rating: 'nullnum', reviews_count: 'nullint' }} className={grid}>
            <Field name="customers_count" label="Happy customers" type="number" min={0} defaultValue={s.claims.customers_count ?? ''} />
            <Field name="rating" label="Average rating" type="number" min={1} max={5} step={0.1} defaultValue={s.claims.rating ?? ''} />
            <Field name="reviews_count" label="Review count" type="number" min={0} defaultValue={s.claims.reviews_count ?? ''} />
          </ApiForm>
        </Card>

        <Card title="Privacy" id="settings-privacy" description="Shown next to the photo consent checkbox and on the privacy policy.">
          <ApiForm action="/api/admin/settings/privacy" method="PUT" types={{ retention_days: 'int', processors: 'lines', policy_path: 'text' }} className={grid}>
            <Field name="retention_days" label="Delete photos after (days)" type="number" min={1} max={3650} required defaultValue={s.privacy.retention_days} />
            <Field name="policy_path" label="Privacy policy path" required defaultValue={s.privacy.policy_path} />
            <TextArea name="processors" label="Processors" rows={3} defaultValue={s.privacy.processors.join('\n')} hint="One per line" />
          </ApiForm>
        </Card>

        <Card title="AI generation" id="settings-ai" description="Switching to gemini or openai needs the matching API key in .env on the server.">
          <ApiForm action="/api/admin/settings/ai" method="PUT" types={{ provider: 'text', model: 'text', mock_ms: 'int', styles: 'styles' }} className={grid}>
            <Select name="provider" label="Provider" defaultValue={s.ai.provider} options={['mock', 'gemini', 'openai']} />
            <Field name="model" label="Model" required defaultValue={s.ai.model} />
            <Field name="mock_ms" label="Mock duration (ms)" type="number" min={0} max={600000} required defaultValue={s.ai.mock_ms} />
            <TextArea name="styles" label="Styles" rows={6} className="sm:col-span-2 xl:col-span-3" defaultValue={s.ai.styles.map((x) => `${x.id} | ${x.name}`).join('\n')} hint="One per line: id | Display name" />
          </ApiForm>
        </Card>

        <Card title="Photo preflight" id="settings-preflight" description="Uploads below these limits are blocked from AI and offered Designer finish instead.">
          <ApiForm action="/api/admin/settings/preflight" method="PUT" types={{ min_side_px: 'int', min_sharpness: 'num', min_pet_confidence: 'num' }} className={grid}>
            <Field name="min_side_px" label="Min short side (px)" type="number" min={100} max={10000} required defaultValue={s.preflight.min_side_px} />
            <Field name="min_sharpness" label="Min sharpness" type="number" min={0} step="any" required defaultValue={s.preflight.min_sharpness} hint="Variance of Laplacian on a 512 px copy" />
            <Field name="min_pet_confidence" label="Min pet confidence" type="number" min={0} max={1} step={0.05} required defaultValue={s.preflight.min_pet_confidence} hint="0 – 1" />
          </ApiForm>
        </Card>
        <Card title="Staff" id="settings-staff" description="People who can sign in to this admin. Designers can be assigned designs in the queue.">
          <ul className="mb-5 divide-y divide-border rounded-[var(--radius)] border border-border">
            {staff.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center gap-3 px-3 py-2">
                <span className="flex size-8 items-center justify-center rounded-full bg-muted text-xs font-semibold uppercase" aria-hidden="true">{staffName(m).slice(0, 2)}</span>
                <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{staffName(m)}{m.id === me.id && <span className="font-normal text-muted-foreground"> (you)</span>}</span><span className="block truncate text-xs text-muted-foreground">{m.username}</span></span>
                <StatusBadge status={m.role} tone={m.role === 'owner' ? 'info' : 'neutral'} label={m.role === 'owner' ? 'Owner' : 'Designer'} />
                {m.id !== me.id && <ActionButton action={`/api/admin/staff/${m.id}`} method="DELETE" label="Remove" icon="trash" tone="danger" ariaLabel={`Remove ${staffName(m)}`} confirm={`Remove ${staffName(m)}? Their designs become unassigned.`} />}
              </li>
            ))}
          </ul>
          <h3 className="mb-3 text-sm font-semibold">Add staff member</h3>
          <ApiForm action="/api/admin/staff" types={{ username: 'text', display_name: 'nulltext', password: 'text', role: 'text' }} reset submitLabel="Add staff member" successMessage="Staff member added" className={grid} ariaLabel="Add staff member">
            <Field name="username" label="Username" required autoComplete="off" pattern="[a-z0-9._-]+" hint="Lowercase, used to sign in" />
            <Field name="display_name" label="Display name" maxLength={60} hint="Shown in the design queue" />
            <Field name="password" label="Password" type="password" required minLength={8} autoComplete="new-password" hint="At least 8 characters" />
            <Select name="role" label="Role" defaultValue="designer" options={[{ value: 'designer', label: 'Designer' }, { value: 'owner', label: 'Owner' }]} />
          </ApiForm>
        </Card>
      </div>
      </div>
    </>
  );
}
