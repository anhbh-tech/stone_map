'use client';
// Gallery kiểu Shopify: một ảnh chính vuông (không quá 70vh, không chiếm cả màn hình) + dải thumbnail 64px (≥ lg) hoặc chấm (< lg).
// Track là scroll-snap thuần CSS → vuốt trên mobile không cần JS; JS chỉ đồng bộ ảnh đang xem với thumbnail/chấm và nút ‹ ›.
// Khung giữ tỉ lệ 1:1 nên không CLS.
import Image from 'next/image';
import { useEffect, useRef, useState } from 'react';
import type { ProductImage } from '@/lib/catalog';
import { Icon } from '../shell/Icon';

const smooth = () => (matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth') as ScrollBehavior;

export function Gallery({ images, title }: { images: ProductImage[]; title: string }) {
  const gallery = images.filter((i) => i.kind === 'gallery');
  const track = useRef<HTMLUListElement>(null);
  const [active, setActive] = useState(0);

  useEffect(() => {
    const el = track.current;
    if (!el) return;
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setActive(Math.round(el.scrollLeft / Math.max(1, el.clientWidth))));
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => { el.removeEventListener('scroll', onScroll); cancelAnimationFrame(raf); };
  }, []);

  if (!gallery.length) return null;
  const n = gallery.length;
  const go = (i: number) => {
    const el = track.current;
    if (!el) return;
    const to = (i + n) % n;
    el.scrollTo({ left: to * el.clientWidth, behavior: smooth() });
    setActive(to);
  };
  const arrow = 'absolute top-1/2 z-10 inline-flex size-11 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-card/90 text-card-foreground shadow-md transition-colors hover:bg-card';

  return (
    <section aria-label={`${title} photos`} aria-roledescription="carousel" className="mx-auto w-full max-w-[min(100%,70vh)] lg:mx-0 lg:max-w-[min(100%,70vh,calc(100vh-18.5rem))]">
      <div className="relative">
        <ul
          ref={track}
          tabIndex={0}
          aria-label="Product photos, swipe or use the arrow keys"
          className="flex aspect-square snap-x snap-mandatory overflow-x-auto overscroll-x-contain rounded-[var(--radius)] bg-muted [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {gallery.map((img, i) => (
            <li key={img.id} aria-roledescription="slide" aria-label={`${i + 1} of ${n}`} className="relative aspect-square w-full shrink-0 snap-center snap-always">
              <Image
                src={img.url}
                alt={img.alt}
                fill
                sizes="(min-width: 1280px) 630px, (min-width: 1024px) 50vw, 100vw"
                className="object-cover"
                preload={i === 0}
                loading={i === 0 ? 'eager' : 'lazy'}
              />
            </li>
          ))}
        </ul>
        {n > 1 && (
          <>
            <button type="button" aria-label="Previous photo" onClick={() => go(active - 1)} className={`${arrow} left-3`}><Icon name="chevronLeft" /></button>
            <button type="button" aria-label="Next photo" onClick={() => go(active + 1)} className={`${arrow} right-3`}><Icon name="chevronRight" /></button>
          </>
        )}
      </div>

      {n > 1 && (
        <>
          {/* < lg: chấm chỉ báo (vuốt + nút ‹ › là điều khiển). */}
          <div aria-hidden="true" className="mt-3 flex justify-center gap-2 lg:hidden" data-testid="gallery-dots">
            {gallery.map((img, i) => (
              <span key={img.id} className={`h-2 rounded-full transition-all duration-200 ${i === active ? 'w-5 bg-foreground' : 'w-2 bg-input'}`} />
            ))}
          </div>
          {/* ≥ lg: dải thumbnail 64px; đang xem = viền đỏ (đỏ = đang chọn). */}
          <ul className="mt-3 hidden gap-2 overflow-x-auto pb-1 lg:flex" aria-label="Choose a photo">
            {gallery.map((img, i) => (
              <li key={img.id} className="shrink-0">
                <button
                  type="button"
                  onClick={() => go(i)}
                  aria-label={`Show photo ${i + 1}: ${img.alt}`}
                  aria-current={i === active ? 'true' : undefined}
                  className={`relative block size-16 overflow-hidden rounded-md border-2 bg-muted transition-colors ${i === active ? 'border-accent' : 'border-transparent hover:border-input'}`}
                >
                  <Image src={img.url} alt="" fill sizes="64px" className="object-cover" />
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
