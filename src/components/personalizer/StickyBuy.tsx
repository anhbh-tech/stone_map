'use client';
// Thanh mua dính đáy màn hình (< lg), kiểu sticky ATC của Shopify. Chỉ hiện khi CẢ khối giá lẫn khối "Add to cart" đã ra khỏi màn hình,
// nên không bao giờ có hai nút mua cùng lúc; ẩn thì inert + aria-hidden. Đẩy dock nổi lên trên qua --dock-offset (#12).
import { useEffect, useState, type RefObject } from 'react';
import type { LivePrice } from '../pdp/logic';
import { LoaderIcon } from '../pdp/icons';
import { Price } from './Price';

type Props = { watch: RefObject<HTMLElement | null>[]; price: LivePrice; currency: string; label: string; busy: boolean; onClick: () => void };
const BAR_PX = 72;

export function StickyBuy({ watch, price, currency, label, busy, onClick }: Props) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const els = watch.map((r) => r.current).filter((e): e is HTMLElement => !!e);
    if (!els.length) return;
    const onScreen = new Set<Element>(els);
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) { if (e.isIntersecting) onScreen.add(e.target); else onScreen.delete(e.target); }
      setShow(onScreen.size === 0 && window.scrollY > 200);
    }, { threshold: 0 });
    els.forEach((e) => io.observe(e));
    return () => io.disconnect();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- ref gắn 1 lần khi mount

  useEffect(() => {
    const mobile = matchMedia('(max-width: 1023.98px)').matches;
    document.body.style.setProperty('--dock-offset', show && mobile ? `${BAR_PX}px` : '0px');
    return () => { document.body.style.removeProperty('--dock-offset'); };
  }, [show]);

  return (
    <div
      data-testid="sticky-buy"
      data-visible={show}
      aria-hidden={!show}
      inert={!show}
      className={`fixed inset-x-0 bottom-0 z-30 border-t border-border bg-card pb-[env(safe-area-inset-bottom)] text-card-foreground transition-transform duration-200 ease-out lg:hidden ${show ? 'translate-y-0 shadow-[0_-4px_16px_-8px_color-mix(in_srgb,var(--foreground)_30%,transparent)]' : 'translate-y-full'}`}
    >
      <div className="mx-auto flex h-[72px] max-w-3xl items-center gap-3 px-4">
        <div className="min-w-0 flex-1"><Price price={price} currency={currency} compact /></div>
        <button
          type="button" onClick={onClick} disabled={busy}
          className="inline-flex min-h-12 shrink-0 items-center justify-center gap-2 rounded-full bg-accent px-6 font-semibold text-on-accent transition-colors duration-150 hover:bg-accent-hover disabled:bg-muted disabled:text-muted-foreground"
        >
          {busy && <LoaderIcon />} {label}
        </button>
      </div>
    </div>
  );
}
