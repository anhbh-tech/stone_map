import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSettings, shippingHeadline } from '@/lib/settings';
import { fmt } from '@/lib/money';
import { breadcrumbJsonLd } from '@/lib/seo';
import type { Settings } from '@/lib/types';
import { JsonLd } from '@/components/shell/JsonLd';

// Trang chính sách sinh hoàn toàn từ settings (#3, #10) — sửa ở /admin/settings là trang đổi theo.
const POLICIES = {
  privacy: { title: 'Privacy policy', description: 'What we do with your pet photos and personal details, and how long we keep them.' },
  shipping: { title: 'Shipping policy', description: 'Where we ship, how much it costs and how long it takes.' },
  refund: { title: 'Refunds and reprints', description: 'What happens if your portrait arrives damaged or does not match the preview you approved.' },
} as const;
type Slug = keyof typeof POLICIES;
type Props = { params: Promise<{ slug: string }> };

const isSlug = (s: string): s is Slug => Object.hasOwn(POLICIES, s);

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  if (!isSlug(slug)) return {};
  return { title: POLICIES[slug].title, description: POLICIES[slug].description, alternates: { canonical: `/policies/${slug}` } };
}

const days = (a: number, b: number) => (a === b ? `${a} days` : `${a}–${b} days`);

function Privacy({ s }: { s: Settings }) {
  return (
    <>
      <h2>Your pet photos</h2>
      <p>You upload a photo only after ticking the consent box. We use it to check the photo quality, create your portrait preview and print your order.</p>
      <p data-testid="retention">
        Uploaded photos are deleted automatically <strong>{s.privacy.retention_days} days</strong> after upload.
      </p>
      <h2>Who processes your photo</h2>
      {s.privacy.processors.length ? (
        <>
          <p>To create the portrait, your photo is sent to these processors:</p>
          <ul data-testid="processors">{s.privacy.processors.map((p) => <li key={p}>{p}</li>)}</ul>
        </>
      ) : (
        <p>Your photo is processed on our own servers only; it is not sent to any third-party processor.</p>
      )}
      <h2>Order details</h2>
      <p>We keep your name, email and shipping address to fulfil the order and to email you about it. We do not sell your data and this site loads no third-party tracking scripts; page analytics are collected by our own server.</p>
      <h2>Your choices</h2>
      <p>To have your photos or order details deleted sooner, email <a href={`mailto:${s.shop.support_email}`}>{s.shop.support_email}</a>.</p>
    </>
  );
}

function Shipping({ s }: { s: Settings }) {
  const sh = s.shipping;
  return (
    <>
      <p className="lead">{shippingHeadline(s)}.</p>
      <h2>Where we ship</h2>
      <p>We currently ship to: {sh.regions.join(', ')}.</p>
      <h2>Production</h2>
      <p>Every portrait is made to order. Production takes about {sh.production_days} days after you approve your preview.</p>
      <h2>Rates and delivery times</h2>
      <table>
        <thead><tr><th scope="col">Method</th><th scope="col">Price</th><th scope="col">In transit</th></tr></thead>
        <tbody>
          <tr>
            <td>Standard</td>
            <td>{fmt(sh.standard.price_cents)}{sh.free_over_cents != null && <> · free over {fmt(sh.free_over_cents)}</>}</td>
            <td>{days(sh.standard.min_days, sh.standard.max_days)}</td>
          </tr>
          <tr><td>Express</td><td>{fmt(sh.express.price_cents)}</td><td>{days(sh.express.min_days, sh.express.max_days)}</td></tr>
        </tbody>
      </table>
      {sh.free_over_cents != null && <p>The free-shipping threshold applies to the product total after any multi-portrait discount.</p>}
      <p>Questions about a delivery? Email <a href={`mailto:${s.shop.support_email}`}>{s.shop.support_email}</a>.</p>
    </>
  );
}

function Refund({ s }: { s: Settings }) {
  return (
    <>
      <p className="lead">Every portrait is made to order from the preview you approved, so we cannot accept returns for a change of mind.</p>
      <h2>Damaged or wrong</h2>
      <p>If your portrait arrives damaged, or does not match the preview you approved, email <a href={`mailto:${s.shop.support_email}`}>{s.shop.support_email}</a> with your order number and a photo. We will reprint it or refund you.</p>
      <h2>Before printing</h2>
      <p>Until you approve the preview nothing is printed. If the AI result is not right, you can choose a designer finish instead.</p>
      <h2>Cancellations</h2>
      <p>Contact us as soon as possible. If production has not started we will cancel and refund the order in full.</p>
    </>
  );
}

export default async function PolicyPage({ params }: Props) {
  const { slug } = await params;
  if (!isSlug(slug)) notFound();
  const s = getSettings();
  const { title } = POLICIES[slug];
  const Body = { privacy: Privacy, shipping: Shipping, refund: Refund }[slug];
  return (
    <article className="mx-auto max-w-3xl px-4 py-10">
      <JsonLd data={breadcrumbJsonLd([{ name: 'Home', path: '/' }, { name: title, path: `/policies/${slug}` }])} />
      <nav aria-label="Breadcrumb" className="text-sm text-muted-foreground">
        <ol className="flex gap-2"><li><Link href="/" className="hover:text-foreground">Home</Link></li><li aria-hidden="true">/</li><li aria-current="page">{title}</li></ol>
      </nav>
      <h1 className="mt-4 text-4xl font-semibold md:text-5xl">{title}</h1>
      <div className="policy mt-6 space-y-4 text-foreground [&_a]:text-accent [&_a]:underline [&_h2]:mt-8 [&_h2]:text-2xl [&_h2]:font-semibold [&_li]:ml-5 [&_li]:list-disc [&_.lead]:text-lg [&_table]:w-full [&_table]:text-left [&_td]:border-t [&_td]:border-border [&_td]:py-2 [&_td]:pr-3 [&_th]:py-2 [&_th]:pr-3">
        <Body s={s} />
      </div>
    </article>
  );
}
