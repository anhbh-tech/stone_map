import Image from 'next/image';
import Link from 'next/link';
import { fmt } from '@/lib/money';
import type { ProductCard as Card } from '@/lib/listing';

/** Thẻ sản phẩm: ảnh vuông, tên, 1 giá ("From" khi nhiều size) — giá so sánh chỉ khi có trong DB. */
export function ProductCard({ p, priority }: { p: Card; priority?: boolean }) {
  const save = p.compare_at_cents && p.compare_at_cents > p.price_cents ? p.compare_at_cents - p.price_cents : 0;
  return (
    <li className="group relative flex flex-col" data-testid="product-card">
      <div className="relative aspect-square overflow-hidden rounded-[var(--radius)] border border-border bg-muted">
        {p.image ? (
          <Image src={p.image.url} alt={p.image.alt} fill preload={priority} sizes="(min-width: 1280px) 280px, (min-width: 768px) 30vw, 50vw"
            className="object-cover transition-transform duration-500 ease-out group-hover:scale-[1.03]" />
        ) : null}
        <div className="absolute left-2 top-2 flex flex-wrap gap-1.5">
          {save > 0 && <span className="rounded-full bg-accent px-2.5 py-0.5 text-xs font-semibold text-on-accent">Save {fmt(save)}</span>}
          {p.demo && <span className="rounded-full border border-border bg-card px-2.5 py-0.5 text-xs font-semibold text-foreground">Demo</span>}
        </div>
      </div>
      <h3 className="mt-3 font-sans text-base font-medium leading-snug text-foreground text-pretty">
        {/* Link phủ cả thẻ (after:inset-0): một điểm tab, vùng bấm là toàn bộ thẻ. */}
        <Link href={`/products/${p.handle}`} className="after:absolute after:inset-0 after:rounded-[var(--radius)] focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-offset-2 focus-visible:after:outline-ring hover:underline hover:underline-offset-4">
          {p.title}
        </Link>
      </h3>
      <p className="mt-1 flex flex-wrap items-baseline gap-x-2 text-sm tabular-nums">
        <span className="font-bold text-sale" data-testid="card-price">{p.sizes > 1 ? `From ${fmt(p.price_cents)}` : fmt(p.price_cents)}</span>
        {save > 0 && <s className="text-muted-foreground"><span className="sr-only">Regular price </span>{fmt(p.compare_at_cents!)}</s>}
      </p>
      <p className="mt-0.5 text-xs text-muted-foreground">{p.sizes} {p.sizes === 1 ? 'size' : 'sizes'}</p>
    </li>
  );
}

export function ProductGrid({ items, label = 'Products' }: { items: Card[]; label?: string }) {
  return (
    <section aria-label={label}>
      <ul className="grid grid-cols-2 gap-x-4 gap-y-8 md:grid-cols-3 xl:grid-cols-4">
        {items.map((p, i) => <ProductCard key={p.id} p={p} priority={i < 4} />)}
      </ul>
    </section>
  );
}
