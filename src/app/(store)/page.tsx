import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { getProduct, listProducts } from '@/lib/catalog';
import { getSettings, shippingHeadline } from '@/lib/settings';
import { fmt } from '@/lib/money';
import { listReviews, reviewSummary } from '@/lib/reviews';
import { organizationJsonLd, websiteJsonLd } from '@/lib/seo';
import { Icon, type IconName } from '@/components/shell/Icon';
import { JsonLd } from '@/components/shell/JsonLd';

export const metadata: Metadata = {
  title: { absolute: 'Pearl Atelier — Custom Pearl Mosaic Pet Portraits' },
  description: 'Turn a photo of your pet into a pearl-mosaic portrait. Pick a style, approve the preview, and we print it on canvas.',
  alternates: { canonical: '/' },
};

const dayRange = (a: number, b: number) => (a === b ? `${a} days` : `${a}–${b} days`);

export default function Home() {
  const s = getSettings();
  const first = listProducts()[0];
  const product = first ? getProduct(first.handle) : null;
  const href = product ? `/products/${product.handle}` : '/cart';
  const from = product?.variants.length ? Math.min(...product.variants.map((v) => v.price_cents)) : null;
  const [hero, ...gallery] = product?.images.filter((i) => i.kind === 'gallery') ?? [];
  const summary = reviewSummary(product?.id);
  const reviews = summary.count ? listReviews(product?.id, 3) : [];
  const sh = s.shipping;

  const steps: { icon: IconName; title: string; body: string }[] = [
    { icon: 'upload', title: 'Upload a clear photo', body: 'We check sharpness and that your pet is in frame before any AI runs, so you never pay for a guess.' },
    { icon: 'eye', title: 'Approve the preview', body: 'See the portrait next to your original photo. Nothing is printed until you confirm it is your pet.' },
    { icon: 'truck', title: 'We print and ship', body: `Made in ${s.shipping.production_days} days, then ${dayRange(s.shipping.standard.min_days, s.shipping.standard.max_days)} standard shipping to ${s.shipping.regions.join(', ')}.` },
  ];

  return (
    <>
      <JsonLd data={organizationJsonLd(s)} />
      <JsonLd data={websiteJsonLd(s)} />

      <section className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-10 md:grid-cols-2 md:py-16">
        <div>
          <p className="text-sm font-semibold uppercase tracking-widest text-accent">Personalized pet portraits</p>
          <h1 className="mt-3 text-5xl font-semibold text-balance md:text-6xl">Your pet, recreated in pearls</h1>
          <p className="mt-4 max-w-prose text-lg text-muted-foreground">
            Upload a photo, pick a painterly style, and approve the preview before anything is printed.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link href={href} className="inline-flex min-h-12 items-center gap-2 rounded-md bg-accent px-6 font-semibold text-on-accent transition-opacity hover:opacity-90">
              Create your portrait <Icon name="arrowRight" size={18} />
            </Link>
            <a href="#how-it-works" className="inline-flex min-h-12 items-center rounded-md border border-border px-5 font-medium hover:bg-muted">How it works</a>
          </div>
          <ul className="mt-8 grid gap-3 text-sm text-muted-foreground">
            <li className="flex items-center gap-2"><Icon name="truck" size={18} className="text-foreground" />{shippingHeadline(s)}</li>
            {from != null && <li className="flex items-center gap-2"><Icon name="tag" size={18} className="text-foreground" />Sizes from {fmt(from)}</li>}
            <li className="flex items-center gap-2"><Icon name="check" size={18} className="text-foreground" />Delivered in {dayRange(sh.production_days + sh.standard.min_days, sh.production_days + sh.standard.max_days)} with standard shipping</li>
          </ul>
        </div>
        {hero && (
          <Image src={hero.url} alt={hero.alt} width={1143} height={1200} preload sizes="(min-width: 768px) 560px, 100vw"
            className="h-auto w-full rounded-[var(--radius)] border border-border bg-muted shadow-sm" />
        )}
      </section>

      {gallery.length > 0 && (
        <section aria-labelledby="styles" className="mx-auto max-w-6xl px-4 py-10">
          <h2 id="styles" className="text-3xl font-semibold md:text-4xl">Pick a style</h2>
          <p className="mt-2 text-muted-foreground">Example portraits. Styles available today: {s.ai.styles.map((x) => x.name).join(', ')}.</p>
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            {gallery.map((g) => (
              <Image key={g.id} src={g.url} alt={g.alt} width={1143} height={1200} sizes="(min-width: 640px) 50vw, 100vw"
                className="h-auto w-full rounded-[var(--radius)] border border-border bg-muted" />
            ))}
          </div>
        </section>
      )}

      <section id="how-it-works" aria-labelledby="how" className="scroll-mt-4 border-y border-border bg-card">
        <div className="mx-auto max-w-6xl px-4 py-12">
          <h2 id="how" className="text-3xl font-semibold md:text-4xl">How it works</h2>
          <ol className="mt-8 grid gap-8 md:grid-cols-3">
            {steps.map((st, i) => (
              <li key={st.title}>
                <span className="flex size-12 items-center justify-center rounded-full bg-muted text-foreground"><Icon name={st.icon} size={22} /></span>
                <h3 className="mt-4 text-2xl font-semibold"><span className="sr-only">Step {i + 1}: </span>{st.title}</h3>
                <p className="mt-2 text-muted-foreground">{st.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {reviews.length > 0 && summary.average != null && (
        <section aria-labelledby="reviews" className="mx-auto max-w-6xl px-4 py-12">
          <h2 id="reviews" className="text-3xl font-semibold md:text-4xl">What customers say</h2>
          <p className="mt-2 flex items-center gap-2 text-muted-foreground">
            <Icon name="star" size={18} filled className="text-accent" />
            {summary.average} out of 5 from {summary.count} {summary.count === 1 ? 'review' : 'reviews'}
            {summary.has_samples && ' (includes sample reviews)'}
          </p>
          <ul className="mt-6 grid gap-4 md:grid-cols-3">
            {reviews.map((r) => (
              <li key={r.id} className="rounded-[var(--radius)] border border-border bg-card p-5">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex text-accent" aria-label={`${r.rating} out of 5 stars`} role="img">
                    {Array.from({ length: 5 }, (_, i) => <Icon key={i} name="star" size={16} filled={i < r.rating} />)}
                  </span>
                  {r.is_sample && <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">Sample review</span>}
                </div>
                {r.title && <p className="mt-3 font-semibold">{r.title}</p>}
                <p className="mt-2 text-muted-foreground">{r.body}</p>
                <p className="mt-3 text-sm">{r.author}{r.verified && <span className="text-success"> · Verified buyer</span>}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mx-auto max-w-6xl px-4 py-12 text-center">
        <h2 className="text-3xl font-semibold md:text-4xl">Ready when you are</h2>
        <p className="mx-auto mt-2 max-w-prose text-muted-foreground">Try a style for free. You only pay once you love the preview.</p>
        <Link href={href} className="mt-6 inline-flex min-h-12 items-center gap-2 rounded-md bg-accent px-6 font-semibold text-on-accent transition-opacity hover:opacity-90">
          Start with a photo <Icon name="arrowRight" size={18} />
        </Link>
      </section>
    </>
  );
}
