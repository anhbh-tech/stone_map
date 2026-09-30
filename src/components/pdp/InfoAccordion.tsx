'use client';
// Accordion của InfoTabs theo mẫu ARIA APG: heading > button[aria-expanded][aria-controls], panel role=region.
// Mở/đóng mượt bằng grid-template-rows 0fr → 1fr (không đo chiều cao bằng JS); tắt chuyển động khi prefers-reduced-motion.
// Panel đóng mang `inert`: không tab vào được, trình đọc màn hình bỏ qua.
import { useId, useState, type ReactNode } from 'react';

export type InfoSection = { key: string; title: string; content: ReactNode };

export function InfoAccordion({ sections, defaultOpen = [] }: { sections: InfoSection[]; defaultOpen?: string[] }) {
  const uid = useId();
  const [open, setOpen] = useState(() => new Set(defaultOpen));
  const toggle = (key: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (!next.delete(key)) next.add(key);
      return next;
    });

  return (
    <div className="space-y-2">
      {sections.map(({ key, title, content }) => {
        const isOpen = open.has(key);
        const btn = `${uid}-${key}-button`;
        const panel = `${uid}-${key}-panel`;
        return (
          <div key={key} data-testid="info-tab" data-open={isOpen}>
            <h2 className="font-sans text-base font-semibold">
              <button
                type="button"
                id={btn}
                aria-expanded={isOpen}
                aria-controls={panel}
                onClick={() => toggle(key)}
                className="group flex min-h-14 w-full cursor-pointer items-center justify-between gap-4 rounded-[var(--radius)] bg-muted py-2 pl-4 pr-2.5 text-left"
              >
                <span>{title}</span>
                <span aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary text-on-primary transition-colors duration-150 group-hover:bg-secondary">
                  <svg
                    width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" focusable="false"
                    className={`transition-transform duration-300 ease-out motion-reduce:transition-none ${isOpen ? 'rotate-180' : ''}`}
                  >
                    <path d="m6 9 6 6 6-6" />
                  </svg>
                </span>
              </button>
            </h2>
            <div
              id={panel}
              role="region"
              aria-labelledby={btn}
              inert={!isOpen}
              className={`grid transition-[grid-template-rows] duration-300 ease-out motion-reduce:transition-none ${isOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}
            >
              <div className="min-h-0 overflow-hidden">
                <div className="px-4 pb-4 pt-4">{content}</div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
