'use client';
import { useEffect, useState } from 'react';
import { Icon } from './Icon';

/**
 * Nút nổi DUY NHẤT của storefront (#12): gom về góc phải dưới, không popup, không chat widget.
 * - Dưới 1280px (nội dung tràn gần mép phải): ẩn hẳn khi ở đầu trang hoặc đang cuộn xuống → không che nội dung; hiện khi cuộn ngược lên.
 * - Từ 1280px (lề hai bên rộng hơn dock): nút Help luôn có, "Back to top" hiện sau khi cuộn.
 * Trang có thanh dính ở đáy (vd. PDP) đặt `--dock-offset` trên <body>/<main> để đẩy dock lên trên thanh đó.
 */
export function FloatingDock({ supportEmail }: { supportEmail: string }) {
  const [scrolled, setScrolled] = useState(false);
  const [up, setUp] = useState(false);

  useEffect(() => {
    let last = window.scrollY;
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const y = window.scrollY;
        setScrolled(y > 600);
        if (Math.abs(y - last) > 8) { setUp(y < last); last = y; }
      });
    };
    addEventListener('scroll', onScroll, { passive: true });
    return () => { removeEventListener('scroll', onScroll); cancelAnimationFrame(raf); };
  }, []);

  const mobileShown = scrolled && up;
  const btn = 'size-12 items-center justify-center rounded-full border border-border bg-card text-card-foreground shadow-md transition-colors hover:bg-muted';
  return (
    <div
      data-testid="floating-dock"
      data-mobile-shown={mobileShown ? '1' : '0'}
      className={`fixed right-4 z-40 ${mobileShown ? 'flex' : 'hidden'} flex-col gap-3 xl:flex`}
      style={{ bottom: 'calc(max(1rem, env(safe-area-inset-bottom)) + var(--dock-offset, 0px))' }}
    >
      <button type="button" aria-label="Back to top" onClick={() => scrollTo({ top: 0, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })}
        className={`${btn} ${scrolled ? 'flex' : 'hidden'}`}>
        <Icon name="arrowUp" />
      </button>
      <a href={`mailto:${supportEmail}`} aria-label={`Email us at ${supportEmail}`} className={`${btn} flex`}>
        <Icon name="mail" />
      </a>
    </div>
  );
}
