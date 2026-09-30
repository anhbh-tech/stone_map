'use client';
// Mobile (#12): khi khung preview cuộn khỏi màn hình, chỉ còn 1 thanh mảnh 64px phía trên — không phải preview to che nửa màn hình.
import Image from 'next/image';
import { useEffect, useState, type RefObject } from 'react';

type Props = { target: RefObject<HTMLElement | null>; observeKey: string; src: string | null; title: string; detail: string };

export function StickyPreview({ target, observeKey, src, title, detail }: Props) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const el = target.current;
    if (!el || !src) return;
    const io = new IntersectionObserver(([e]) => setShow(!e.isIntersecting && e.boundingClientRect.top < 0), { threshold: 0 });
    io.observe(el);
    return () => io.disconnect();
  }, [target, src, observeKey]);

  if (!src) return null;
  return (
    <div
      aria-hidden={!show}
      inert={!show}
      data-testid="sticky-preview"
      data-visible={show}
      className={`fixed inset-x-0 top-0 z-30 border-b border-border bg-card pt-[env(safe-area-inset-top)] text-card-foreground shadow-sm transition-transform duration-200 ease-out md:hidden ${show ? 'translate-y-0' : '-translate-y-full'}`}
    >
      <div className="flex h-16 items-center gap-3 px-4">
        <Image src={src} alt="" width={48} height={48} unoptimized className="size-12 rounded-md border border-border object-cover" />
        <p className="min-w-0 flex-1 text-sm leading-tight">
          <span className="block truncate font-semibold">{title}</span>
          <span className="block truncate text-muted-foreground">{detail}</span>
        </p>
        <button
          type="button"
          onClick={() => target.current?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' })}
          className="min-h-11 shrink-0 rounded-md border border-primary px-3 text-sm font-semibold"
        >
          View
        </button>
      </div>
    </div>
  );
}
