'use client';
// Modal "AI Filter" chặn trang trong lúc gen (#2): không có nút đóng, Esc không đóng, focus nằm trong modal, aria-busy.
// % = JobView.progress thật; giữa hai lần poll (1.5 s) ước lượng tiếp từ elapsed/eta để thanh chạy đều, không bao giờ vượt 97% trước khi xong.
// Khách vẫn được nhập email để nhận link nếu hàng đợi dài. Mount = mở, unmount (job xong/lỗi) = đóng.
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { JobView } from '@/lib/types';
import { etaText } from '../pdp/logic';
import { MailIcon, SparklesIcon } from '../pdp/icons';

const STAGE: Record<string, string> = {
  queued: 'Waiting in line',
  analyzing: 'Studying your photo',
  generating: 'Painting your portrait',
  checking: 'Checking it looks like your pet',
  rendering: 'Preparing the preview',
};

/** % hiển thị: max(thật, ước lượng theo thời gian trôi qua kể từ lần poll gần nhất), chỉ tăng. */
function useEstimatedPct(job: JobView) {
  const [est, setEst] = useState(0);
  useEffect(() => {
    const at = performance.now();
    const total = job.elapsed_ms + job.eta_ms;
    if (total <= 0) return;
    const t = setInterval(() => setEst((prev) => Math.max(prev, Math.min(0.97, (job.elapsed_ms + performance.now() - at) / total))), 250);
    return () => clearInterval(t);
  }, [job]);
  return Math.round(Math.max(Math.min(1, Math.max(0, job.progress)), est) * 100);
}

export function JobProgress({ job, onEmail, savedEmail }: { job: JobView; onEmail: (email: string) => Promise<void>; savedEmail: string | null }) {
  const [email, setEmail] = useState(savedEmail || '');
  const [state, setState] = useState<'idle' | 'saving' | 'error'>('idle');
  const ref = useRef<HTMLDialogElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const pct = useEstimatedPct(job);
  const stage = STAGE[job.stage || job.status] || 'Working on it';

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    const html = document.documentElement;
    const prev = html.style.overflow;
    html.style.overflow = 'hidden';
    if (!d.open) d.showModal();
    titleRef.current?.focus(); // không để bàn phím mobile bật lên vì focus rơi vào ô email
    // Chrome cho Esc lần hai đóng dialog dù cancel bị chặn → mở lại ngay khi job còn chạy.
    const reopen = () => { if (d.isConnected && !d.open) d.showModal(); };
    d.addEventListener('close', reopen);
    return () => { d.removeEventListener('close', reopen); if (d.open) d.close(); html.style.overflow = prev; };
  }, []);

  // Giữ Tab vòng trong modal (showModal đã làm phần còn lại của trang inert).
  const trap = (e: KeyboardEvent) => {
    if (e.key !== 'Tab' || !ref.current) return;
    const els = [...ref.current.querySelectorAll<HTMLElement>('input, button, [href], [tabindex]:not([tabindex="-1"])')].filter((el) => !el.hasAttribute('disabled'));
    if (!els.length) { e.preventDefault(); return; }
    const first = els[0], last = els[els.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || active === titleRef.current)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
  };

  return (
    <dialog
      ref={ref} aria-labelledby="ai-filter-title" aria-describedby="ai-filter-status" aria-busy="true" aria-modal="true"
      onCancel={(e) => e.preventDefault()} onKeyDown={trap}
      data-testid="job-progress"
      className="m-auto w-[min(26rem,calc(100vw-2rem))] max-w-none rounded-xl bg-card p-0 text-card-foreground shadow-xl backdrop:bg-primary/60 backdrop:backdrop-blur-[2px]"
    >
      <div className="space-y-5 p-6 text-center">
        <span className="mx-auto flex size-14 items-center justify-center rounded-full bg-muted text-foreground" aria-hidden="true">
          <SparklesIcon size={28} className="motion-safe:animate-pulse" />
        </span>
        <div className="space-y-1">
          <h2 id="ai-filter-title" ref={titleRef} tabIndex={-1} className="font-sans text-xl font-semibold outline-none">AI Filter</h2>
          <p id="ai-filter-status" className="font-medium tabular-nums" data-testid="ai-filter-pct">Applying AI filter... ({pct}%)</p>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-label="Portrait progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
          <div className="h-full rounded-full bg-foreground transition-[width] duration-300 ease-linear" style={{ width: `${Math.max(pct, 3)}%` }} />
        </div>
        <div className="space-y-1 text-sm text-muted-foreground">
          <p>Please wait, this may take a few seconds</p>
          {/* Chỉ báo đọc khi đổi giai đoạn, không đọc lại % mỗi 250 ms */}
          <p><span role="status">{stage}</span> · <span data-testid="eta">
            {etaText(job.eta_ms)}
            {job.queue_position ? ` · ${job.queue_position} ${job.queue_position === 1 ? 'portrait' : 'portraits'} ahead of yours` : ''}
          </span></p>
        </div>

        <form
          className="space-y-2 border-t border-border pt-4 text-left"
          onSubmit={async (e) => {
            e.preventDefault();
            setState('saving');
            try { await onEmail(email.trim()); setState('idle'); } catch { setState('error'); }
          }}
        >
          <label htmlFor="notify-email" className="flex items-center gap-2 text-sm font-medium"><MailIcon size={16} /> Email me the link when it&apos;s ready</label>
          {savedEmail ? (
            <p className="text-sm" role="status">We&apos;ll email <span className="font-medium">{savedEmail}</span> when your preview is ready. You can close this page.</p>
          ) : (
            <div className="flex gap-2">
              <input
                id="notify-email" type="email" required autoComplete="email" inputMode="email" value={email}
                onChange={(e) => setEmail(e.target.value)}
                aria-describedby={state === 'error' ? 'notify-email-err' : undefined}
                className="min-h-11 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-base"
                placeholder="you@example.com"
              />
              <button type="submit" disabled={state === 'saving'} className="min-h-11 rounded-md border border-primary px-4 text-sm font-semibold hover:bg-muted disabled:opacity-60">
                {state === 'saving' ? 'Saving…' : 'Send link'}
              </button>
            </div>
          )}
          {state === 'error' && <p id="notify-email-err" className="text-sm text-destructive">Couldn&apos;t save your email. Please try again.</p>}
        </form>
      </div>
    </dialog>
  );
}
