'use client';
// Gallery kiểu Shopify: ảnh chính vuông (≤ 70vh, không chiếm cả màn hình) + dải thumbnail 64px (≥ lg) hoặc chấm (< lg).
// Track là một dải flex dịch bằng transform (300ms ease-out) — không đổi layout nên không CLS/giật. Vuốt bằng Pointer Events:
// ảnh theo ngón tay, thả ra thì snap theo quãng kéo hoặc tốc độ vuốt (quán tính); touch-action: pan-y để cuộn dọc vẫn là của trình duyệt.
// Ảnh kề ảnh đang xem được tải sẵn (loading=eager). Phím ←/→/Home/End khi focus trong gallery. Bấm ảnh mở lightbox (<dialog>).
// prefers-reduced-motion: bỏ transition (dịch tức thì), cuộn thumbnail không smooth.
import Image from 'next/image';
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import type { ProductImage } from '@/lib/catalog';
import { Icon } from '../shell/Icon';

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const EASE = 'transition-transform duration-300 ease-[cubic-bezier(0.22,0.61,0.36,1)] motion-reduce:transition-none';
const clamp = (i: number, n: number) => Math.max(0, Math.min(n - 1, i));

/** Phím điều hướng dùng chung cho gallery và lightbox. Trả về index mới, hoặc null nếu không phải phím của carousel. */
function keyTo(key: string, index: number, n: number): number | null {
  if (key === 'ArrowLeft') return clamp(index - 1, n);
  if (key === 'ArrowRight') return clamp(index + 1, n);
  if (key === 'Home') return 0;
  if (key === 'End') return n - 1;
  return null;
}

type Gesture = { id: number; x0: number; y0: number; lastX: number; lastT: number; v: number; axis: 'x' | 'y' | null };

function Slider({ images, index, onIndex, onOpen, fit, sizes, first, className }: {
  images: ProductImage[];
  index: number;
  onIndex: (i: number) => void;
  onOpen?: (i: number) => void;
  fit: 'cover' | 'contain';
  sizes: string;
  first?: boolean;
  className: string;
}) {
  const n = images.length;
  const viewport = useRef<HTMLDivElement>(null);
  const g = useRef<Gesture | null>(null);
  const dragged = useRef(false);
  const [dx, setDx] = useState<number | null>(null);

  const down = (e: PointerEvent<HTMLDivElement>) => {
    if (n < 2 || (e.pointerType === 'mouse' && e.button !== 0)) return;
    g.current = { id: e.pointerId, x0: e.clientX, y0: e.clientY, lastX: e.clientX, lastT: e.timeStamp, v: 0, axis: null };
    dragged.current = false;
  };
  const move = (e: PointerEvent<HTMLDivElement>) => {
    const s = g.current;
    if (!s || s.id !== e.pointerId) return;
    const x = e.clientX - s.x0;
    if (!s.axis) {
      if (Math.abs(x) < 6 && Math.abs(e.clientY - s.y0) < 6) return;
      s.axis = Math.abs(x) > Math.abs(e.clientY - s.y0) ? 'x' : 'y';
      if (s.axis === 'y') { g.current = null; return; }
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    const dt = e.timeStamp - s.lastT;
    if (dt > 0) s.v = 0.8 * ((e.clientX - s.lastX) / dt) + 0.2 * s.v;
    s.lastX = e.clientX; s.lastT = e.timeStamp;
    dragged.current = true;
    // Kéo quá ảnh đầu/cuối: lực cản 1/3 (rubber band) rồi bật về.
    const edge = (index === 0 && x > 0) || (index === n - 1 && x < 0);
    setDx(edge ? x / 3 : x);
  };
  const up = (e: PointerEvent<HTMLDivElement>) => {
    const s = g.current;
    g.current = null;
    if (!s || s.id !== e.pointerId || s.axis !== 'x') { setDx(null); return; }
    const w = viewport.current?.clientWidth || 1;
    const x = e.clientX - s.x0;
    const flick = e.timeStamp - s.lastT < 80 && Math.abs(s.v) > 0.35; // px/ms
    let to = index;
    if (x < -w * 0.2 || (flick && s.v < 0)) to = index + 1;
    else if (x > w * 0.2 || (flick && s.v > 0)) to = index - 1;
    setDx(null);
    onIndex(clamp(to, n));
  };
  const cancel = () => { g.current = null; setDx(null); };

  return (
    <div
      ref={viewport}
      onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={cancel}
      className={`relative touch-pan-y select-none overflow-hidden ${className}`}
      data-testid={first ? 'gallery-viewport' : 'lightbox-viewport'}
    >
      <div
        className={`flex h-full will-change-transform ${dx === null ? EASE : ''}`}
        style={{ transform: `translate3d(calc(${-index * 100}% + ${dx ?? 0}px), 0, 0)` }}
        data-testid="gallery-track"
      >
        {images.map((img, i) => {
          const pic = (
            <Image
              src={img.url}
              alt={img.alt}
              fill
              sizes={sizes}
              draggable={false}
              className={fit === 'cover' ? 'object-cover' : 'object-contain'}
              preload={first && i === 0}
              // Ảnh đang xem + hai ảnh kề tải ngay, để vuốt/bấm tới là đã có ảnh.
              loading={Math.abs(i - index) <= 1 || (first && i === 0) ? 'eager' : 'lazy'}
            />
          );
          return (
            <div key={img.id} role="group" aria-roledescription="slide" aria-label={`${i + 1} of ${n}`} aria-hidden={i !== index} className="relative h-full w-full shrink-0">
              {onOpen ? (
                <button
                  type="button"
                  tabIndex={i === index ? 0 : -1}
                  aria-label={`Open photo ${i + 1} of ${n} full screen`}
                  onClick={() => { if (!dragged.current) onOpen(i); }}
                  className="absolute inset-0 cursor-zoom-in focus-visible:outline-offset-[-4px]"
                >
                  {pic}
                </button>
              ) : pic}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const arrowCls = 'absolute top-1/2 z-10 inline-flex size-11 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-card/90 text-card-foreground shadow-md transition-[background-color,opacity] duration-150 hover:bg-card disabled:pointer-events-none disabled:opacity-0';

function Arrows({ index, n, go, inset = 'left-3', insetR = 'right-3' }: { index: number; n: number; go: (i: number) => void; inset?: string; insetR?: string }) {
  if (n < 2) return null;
  return (
    <>
      <button type="button" aria-label="Previous photo" disabled={index === 0} onClick={() => go(index - 1)} className={`${arrowCls} ${inset}`}><Icon name="chevronLeft" /></button>
      <button type="button" aria-label="Next photo" disabled={index === n - 1} onClick={() => go(index + 1)} className={`${arrowCls} ${insetR}`}><Icon name="chevronRight" /></button>
    </>
  );
}

function Lightbox({ images, index, go, open, onClose, title }: { images: ProductImage[]; index: number; go: (i: number) => void; open: boolean; onClose: () => void; title: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  const n = images.length;
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
    if (!open) return;
    // Khoá cuộn trang phía sau khi xem ảnh lớn.
    const html = document.documentElement;
    const prev = html.style.overflow;
    html.style.overflow = 'hidden';
    return () => { html.style.overflow = prev; };
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-label={`${title} photos, full screen`}
      onClose={onClose}
      onKeyDown={(e) => { const to = keyTo(e.key, index, n); if (to !== null) { e.preventDefault(); go(to); } }}
      className="m-0 h-dvh max-h-none w-dvw max-w-none bg-background p-0 text-foreground backdrop:bg-primary/60 open:flex open:flex-col"
    >
      <div className="flex h-14 shrink-0 items-center justify-between px-2 sm:px-4">
        <p className="pl-2 text-sm font-medium tabular-nums" aria-live="polite" data-testid="lightbox-counter">{index + 1} / {n}</p>
        <button type="button" aria-label="Close full screen photos" onClick={onClose} className="inline-flex size-11 items-center justify-center rounded-full transition-colors hover:bg-muted">
          <Icon name="x" size={24} />
        </button>
      </div>
      {open && (
        <div className="relative min-h-0 flex-1 pb-4 sm:px-4">
          <Slider images={images} index={index} onIndex={go} fit="contain" sizes="100vw" className="h-full" />
          <Arrows index={index} n={n} go={go} inset="left-2 sm:left-6" insetR="right-2 sm:right-6" />
        </div>
      )}
    </dialog>
  );
}

export function Gallery({ images, title }: { images: ProductImage[]; title: string }) {
  const gallery = images.filter((i) => i.kind === 'gallery');
  const n = gallery.length;
  const [index, setIndex] = useState(0);
  const [zoom, setZoom] = useState(false);
  const strip = useRef<HTMLUListElement>(null);
  const root = useRef<HTMLElement>(null);
  const go = (i: number) => setIndex(clamp(i, n));
  // Đóng lightbox: trả focus về ảnh đang xem (có thể khác ảnh đã bấm mở, vì lightbox cũng chuyển ảnh).
  const closeZoom = () => {
    setZoom(false);
    requestAnimationFrame(() => root.current?.querySelector<HTMLElement>('[data-testid="gallery-viewport"] [aria-hidden="false"] button')?.focus());
  };

  // Thumbnail đang chọn luôn nằm trong dải (tự cuộn ngang khi dải dài hơn khung), không đụng cuộn dọc của trang.
  useEffect(() => {
    const el = strip.current;
    const btn = el?.children[index] as HTMLElement | undefined;
    if (!el || !btn || el.scrollWidth <= el.clientWidth) return;
    el.scrollTo({ left: btn.offsetLeft - (el.clientWidth - btn.offsetWidth) / 2, behavior: reduced() ? 'auto' : 'smooth' });
  }, [index]);

  if (!n) return null;
  const onKey = (e: KeyboardEvent<HTMLElement>) => {
    if ((e.target as Element).closest('dialog')) return; // lightbox tự xử lý phím của nó
    const to = keyTo(e.key, index, n);
    if (to === null) return;
    e.preventDefault();
    go(to);
  };

  return (
    <section
      ref={root}
      aria-label={`${title} photos`}
      aria-roledescription="carousel"
      onKeyDown={onKey}
      className="mx-auto w-full max-w-[min(100%,70vh)] lg:mx-0 lg:max-w-[min(100%,70vh,calc(100vh-18.5rem))]"
    >
      <div className="relative">
        <Slider
          images={gallery}
          index={index}
          onIndex={go}
          onOpen={() => setZoom(true)}
          fit="cover"
          sizes="(min-width: 1280px) 630px, (min-width: 1024px) 50vw, 100vw"
          first
          className="aspect-square rounded-[var(--radius)] bg-muted"
        />
        <Arrows index={index} n={n} go={go} />
      </div>
      <p className="sr-only" aria-live="polite">{`Photo ${index + 1} of ${n}: ${gallery[index]?.alt ?? ''}`}</p>

      {n > 1 && (
        <>
          {/* < lg: chấm chỉ báo (vuốt + nút ‹ › là điều khiển). */}
          <div aria-hidden="true" className="mt-3 flex justify-center gap-2 lg:hidden" data-testid="gallery-dots">
            {gallery.map((img, i) => (
              <span key={img.id} className={`h-2 rounded-full transition-[width,background-color] duration-300 motion-reduce:transition-none ${i === index ? 'w-5 bg-foreground' : 'w-2 bg-input'}`} />
            ))}
          </div>
          {/* ≥ lg: dải thumbnail 64px; đang xem = viền đỏ (đỏ = đang chọn). */}
          <ul ref={strip} className="relative mt-3 hidden gap-2 overflow-x-auto pb-1 [scrollbar-width:thin] lg:flex" aria-label="Choose a photo">
            {gallery.map((img, i) => (
              <li key={img.id} className="shrink-0">
                <button
                  type="button"
                  onClick={() => go(i)}
                  aria-label={`Show photo ${i + 1}: ${img.alt}`}
                  aria-current={i === index ? 'true' : undefined}
                  className={`relative block size-16 overflow-hidden rounded-md border-2 bg-muted transition-colors ${i === index ? 'border-accent' : 'border-transparent hover:border-input'}`}
                >
                  <Image src={img.url} alt="" fill sizes="64px" className="object-cover" />
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      <Lightbox images={gallery} index={index} go={go} open={zoom} onClose={closeZoom} title={title} />
    </section>
  );
}
