'use client';
import { useEffect, useRef, useState } from 'react';

/** Ô mã monospace + nút copy cho BulkDiscounts. Icon đổi thành dấu tick, trình đọc màn hình nghe "Copied"; lỗi clipboard thì nhắc tự chọn mã. */
export function CopyCode({ code }: { code: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  async function copy() {
    clearTimeout(timer.current);
    try {
      await navigator.clipboard.writeText(code);
      setState('copied');
    } catch {
      setState('failed');
    }
    timer.current = setTimeout(() => setState('idle'), 2500);
  }

  return (
    <span className="flex items-center gap-1">
      <code className="select-all rounded-md border border-dashed border-input bg-muted px-2 py-1 font-mono text-sm font-semibold tracking-wide">{code}</code>
      <button type="button" onClick={copy} aria-label={`Copy code ${code}`}
        className="inline-flex size-11 shrink-0 touch-manipulation items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
        <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          {state === 'copied'
            ? <path d="M20 6 9 17l-5-5" />
            : <><rect width="14" height="14" x="8" y="8" rx="2" /><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" /></>}
        </svg>
      </button>
      <span role="status" className="sr-only">
        {state === 'copied' ? 'Copied' : state === 'failed' ? 'Select the code to copy it' : ''}
      </span>
    </span>
  );
}
