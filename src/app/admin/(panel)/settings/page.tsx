import type { Metadata } from 'next';
import { getSettings, shippingHeadline } from '@/lib/settings';
import { requireAdminPage } from '../../_lib/session';
import { Card, PageHeader } from '../../_components/ui';
import { ApiForm, Field, MoneyField, Select, TextArea } from '../../_components/form';

export const metadata: Metadata = { title: 'Settings' };

// Mỗi key của Settings (src/lib/types.ts) một form, PUT /api/admin/settings/:key với cả giá trị của key đó.
// Đây là nguồn sự thật duy nhất cho câu chữ ship / khung / số liệu trên storefront (#3).
export default async function SettingsPage() {
  await requireAdminPage();
  const s = getSettings();
  const grid = 'sm:grid-cols-2 xl:grid-cols-3';
  return (
    <>
      <PageHeader title="Settings" description="The single source of truth for shipping, privacy, claims and AI copy shown in the store. Nothing about shipping or numbers is hard-coded in pages." />
      <nav aria-label="Settings sections" className="mb-6 flex flex-wrap gap-2 text-sm">
        {['shop', 'shipping', 'claims', 'privacy', 'ai', 'preflight'].map((k) => (
          <a key={k} href={`#settings-${k}`} className="inline-flex min-h-11 items-center rounded-full border border-border bg-card px-4 font-medium hover:border-foreground">{k}</a>
        ))}
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
      </div>
    </>
  );
}
