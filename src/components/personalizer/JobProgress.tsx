'use client';
// Tiến trình chờ (#2): ETA thật từ JobView.eta_ms, thanh progress theo JobView.progress; khách được nhập email để nhận link.
import { useState } from 'react';
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

export function JobProgress({ job, onEmail, savedEmail }: { job: JobView; onEmail: (email: string) => Promise<void>; savedEmail: string | null }) {
  const [email, setEmail] = useState(savedEmail || '');
  const [state, setState] = useState<'idle' | 'saving' | 'error'>('idle');
  const pct = Math.round(Math.min(1, Math.max(0, job.progress)) * 100);
  const stage = STAGE[job.stage || job.status] || 'Working on it';

  return (
    <div className="space-y-4 rounded-lg border border-border bg-card p-4 text-card-foreground" data-testid="job-progress">
      <div className="flex items-start gap-3">
        <SparklesIcon className="mt-0.5 shrink-0 text-accent" />
        <div className="flex-1">
          {/* Chỉ báo đọc khi đổi giai đoạn, không đọc lại ETA mỗi 1.5 s */}
          <p className="font-semibold" role="status">{stage}</p>
          <p className="text-sm text-muted-foreground" data-testid="eta">
            {etaText(job.eta_ms)}
            {job.queue_position ? ` · ${job.queue_position} ${job.queue_position === 1 ? 'portrait' : 'portraits'} ahead of yours` : ''}
          </p>
        </div>
        <span className="text-sm font-semibold tabular-nums">{pct}%</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-label="Portrait progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
        <div className="h-full rounded-full bg-accent transition-[width] duration-[1500ms] ease-linear" style={{ width: `${Math.max(pct, 3)}%` }} />
      </div>
      <p className="text-sm text-muted-foreground">You can keep choosing your size and add-ons while you wait.</p>

      <form
        className="space-y-2 border-t border-border pt-4"
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
              className="min-h-11 min-w-0 flex-1 rounded-md border border-border bg-background px-3 text-base"
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
  );
}
