'use client';
// Menu mobile (< lg): <dialog> modal trượt từ trái — trình duyệt lo focus trap + Esc. Nội dung (CategoryMenu…) là server component truyền vào children.
import { useEffect, useRef, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { Icon } from './Icon';

export function MobileMenu({ shopName, children }: { shopName: string; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const pathname = usePathname();
  useEffect(() => { ref.current?.close(); }, [pathname]);

  return (
    <>
      <button type="button" aria-label="Open menu" aria-haspopup="dialog" onClick={() => ref.current?.showModal()}
        className="inline-flex size-11 items-center justify-center rounded-md text-foreground transition-colors hover:bg-muted lg:hidden">
        <Icon name="menu" size={24} />
      </button>
      <dialog
        ref={ref} aria-label="Menu"
        onClick={(e) => { if (e.target === ref.current || (e.target as HTMLElement).closest('a')) ref.current?.close(); }}
        className="m-0 h-dvh max-h-none w-[min(22rem,88vw)] max-w-none bg-background p-0 text-foreground shadow-xl backdrop:bg-primary/40 open:flex open:flex-col lg:hidden"
      >
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-border pl-4 pr-2">
          <span className="font-display text-xl">{shopName}</span>
          <button type="button" aria-label="Close menu" onClick={() => ref.current?.close()} className="inline-flex size-11 items-center justify-center rounded-md transition-colors hover:bg-muted">
            <Icon name="x" size={22} />
          </button>
        </div>
        <nav aria-label="Menu" className="flex-1 overflow-y-auto px-4 pb-8 pt-2">{children}</nav>
      </dialog>
    </>
  );
}
