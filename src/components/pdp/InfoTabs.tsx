// Thông tin sản phẩm dạng accordion dưới khối mua: Description / Shopping Tips / Shipping & Returns.
// Server component: nội dung lấy từ products.info_tabs, rơi về mặc định store (settings 'pdp_info'); số liệu ship từ settings (#3).
import { addonsFor, type Product } from '@/lib/catalog';
import { getInfoDefaults, getProductInfo, resolveInfo, type Rich } from '@/lib/info-tabs';
import { getSettings } from '@/lib/settings';
import { InfoAccordion } from './InfoAccordion';

function RichText({ value }: { value: Rich }) {
  return value.map((s, i) => {
    const t = s.href ? <a href={s.href} className="underline underline-offset-4 hover:decoration-2">{s.text}</a> : s.text;
    return s.bold ? <strong key={i} className="font-semibold">{t}</strong> : <span key={i}>{t}</span>;
  });
}

export function InfoTabs({ product, className = '' }: { product: Product; className?: string }) {
  const info = resolveInfo({
    product,
    override: getProductInfo(product.id),
    defaults: getInfoDefaults(),
    settings: getSettings(),
    hasFrameAddon: addonsFor(product).some((a) => a.kind === 'frame'),
  });
  const prose = 'space-y-3 text-base leading-relaxed';

  return (
    <div className={className} data-testid="info-tabs">
      <InfoAccordion
        defaultOpen={['description']}
        sections={[
          {
            key: 'description',
            title: 'Description',
            content: (
              <div className={prose}>
                <h3 className="font-sans text-lg font-semibold">Product Description</h3>
                {info.paragraphs.map((p, i) => <p key={i}><RichText value={p} /></p>)}
                {info.sizes.length > 0 && (
                  <div>
                    <p className="font-semibold">{info.sizesLabel}</p>
                    <ul className="mt-1 list-disc space-y-0.5 pl-5 tabular-nums" data-testid="info-sizes">
                      {info.sizes.map((s) => <li key={s}>{s}</li>)}
                    </ul>
                  </div>
                )}
                {info.gift.map((p, i) => <p key={i}><RichText value={p} /></p>)}
                {info.warmTip && (
                  <p><strong className="font-semibold">Warm Tip:</strong> <RichText value={info.warmTip} /></p>
                )}
              </div>
            ),
          },
          {
            key: 'tips',
            title: 'Shopping Tips',
            content: (
              <ol className={`${prose} list-decimal pl-5 marker:font-semibold`}>
                {info.tips.map((t, i) => <li key={i} className="pl-1"><RichText value={t} /></li>)}
              </ol>
            ),
          },
          {
            key: 'shipping',
            title: 'Shipping & Returns',
            content: (
              <ul className={`${prose} list-disc pl-5`}>
                {info.shipping.map((t, i) => <li key={i} className="pl-1"><RichText value={t} /></li>)}
              </ul>
            ),
          },
        ]}
      />
    </div>
  );
}
