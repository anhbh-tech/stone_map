// Sửa nội dung InfoTabs của PDP: mặc định toàn store (trang Settings) và phần ghi đè của từng sản phẩm.
// Shipping & Returns sinh từ Settings › Shipping + Shop, nên ở đây chỉ có số giờ cho phép sửa / huỷ đơn.
import { getInfoDefaults, getProductInfo } from '@/lib/info-tabs';
import { Card } from './ui';
import { ApiForm, Field, TextArea } from './form';

const FORMAT = <>Wrap words in <code>**double asterisks**</code> for bold. Tokens: <code>{'{product}'}</code>, <code>{'{shop}'}</code>, <code>{'{support_email}'}</code>, <code>{'{production_days}'}</code>. A blank line starts a new paragraph.</>;

export function InfoTabsDefaultsCard({ id }: { id: string }) {
  const d = getInfoDefaults();
  return (
    <Card title="Product info tabs" id={id} description="Default Description, Shopping Tips and Shipping & Returns text under every product's buy box. Each product can override the text on its own page.">
      <ApiForm action="/api/admin/info-tabs" method="PUT" ariaLabel="Product info tab defaults"
        types={{ description: 'text', gift: 'text', warm_tip_framed: 'text', warm_tip_unframed: 'text', tips: 'text', edit_hours: 'int' }}>
        <TextArea name="description" label="Description" rows={5} required maxLength={3000} defaultValue={d.description} hint={FORMAT} />
        <TextArea name="gift" label="Gift paragraph" rows={3} maxLength={1000} defaultValue={d.gift} />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextArea name="warm_tip_framed" label="Warm Tip, frame included" rows={3} maxLength={500} defaultValue={d.warm_tip_framed} hint="Shown when the product has “Frame included” on" />
          <TextArea name="warm_tip_unframed" label="Warm Tip, frame sold separately" rows={3} maxLength={500} defaultValue={d.warm_tip_unframed} hint="Shown only while a frame add-on is on sale; blank hides it" />
        </div>
        <TextArea name="tips" label="Shopping Tips" rows={6} required defaultValue={d.tips.join('\n')} hint="One tip per line, shown as a numbered list" />
        <Field name="edit_hours" label="Hours to change or cancel an order" type="number" min={0} max={168} required defaultValue={d.edit_hours}
          hint="Shipping & Returns reads delivery days, free shipping and the support email from Shipping and Shop above" className="sm:max-w-xs" />
      </ApiForm>
    </Card>
  );
}

export function ProductInfoTabsCard({ productId, className }: { productId: number; className?: string }) {
  const o = getProductInfo(productId);
  const d = getInfoDefaults();
  const fallback = 'Blank = store default from Settings › Product info tabs';
  return (
    <Card title="Product info tabs" id="info-tabs" className={className} description="Text in the Description and Shopping Tips tabs on this product page. Sizes come from the sizes below; Shipping & Returns comes from Settings.">
      <ApiForm action={`/api/admin/products/${productId}/info-tabs`} method="PUT" ariaLabel="Product info tabs"
        types={{ description: 'nulltext', gift: 'nulltext', warm_tip: 'nulltext', tips: 'nulltext' }}>
        <TextArea name="description" label="Description" rows={5} maxLength={3000} defaultValue={o.description ?? ''} placeholder={d.description} hint={<>{fallback}. {FORMAT}</>} />
        <TextArea name="gift" label="Gift paragraph" rows={3} maxLength={1000} defaultValue={o.gift ?? ''} placeholder={d.gift} hint={fallback} />
        <TextArea name="warm_tip" label="Warm Tip" rows={2} maxLength={500} defaultValue={o.warm_tip ?? ''} hint="Blank = the default for framed or unframed products" />
        <TextArea name="tips" label="Shopping Tips" rows={5} defaultValue={o.tips?.join('\n') ?? ''} placeholder={d.tips.join('\n')} hint={`One tip per line. ${fallback}`} />
      </ApiForm>
    </Card>
  );
}
