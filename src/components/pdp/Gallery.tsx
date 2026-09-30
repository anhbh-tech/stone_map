// Gallery không cần JS (#8): mobile là dải cuộn ngang có snap, desktop là lưới. Khung giữ tỉ lệ nên không CLS.
import Image from 'next/image';
import type { ProductImage } from '@/lib/catalog';

export function Gallery({ images, title }: { images: ProductImage[]; title: string }) {
  const gallery = images.filter((i) => i.kind === 'gallery');
  if (!gallery.length) return null;
  return (
    <section aria-label={`${title} photos`}>
      <ul
        className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2 [scrollbar-width:thin] lg:mx-0 lg:grid lg:grid-cols-2 lg:overflow-visible lg:px-0"
        tabIndex={0}
        aria-label="Swipe for more photos"
      >
        {gallery.map((img, i) => (
          <li key={img.id} className={`relative aspect-[15/16] w-[85%] shrink-0 snap-center overflow-hidden rounded-lg border border-border bg-muted sm:w-[60%] lg:w-auto ${i === 0 ? 'lg:col-span-2' : ''}`}>
            <Image
              src={img.url}
              alt={img.alt}
              fill
              sizes={i === 0 ? '(min-width: 1024px) 50vw, 85vw' : '(min-width: 1024px) 25vw, 85vw'}
              className="object-cover"
              preload={i === 0}
              loading={i < 3 ? 'eager' : undefined}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}
