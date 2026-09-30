// Timeline đơn: mới nhất trên cùng, mỗi mục một chấm + icon theo loại (không chỉ dựa vào màu).
import type { TimelineEntry } from '../_lib/orders';
import { Icon, type IconName } from './icons';
import { fmtDate } from './ui';

const ICON: Record<TimelineEntry['kind'], IconName> = { placed: 'bag', status: 'refresh', fulfillment: 'truck', comment: 'message', email: 'mail' };

export function Timeline({ entries }: { entries: TimelineEntry[] }) {
  return (
    <ol className="relative grid gap-4 before:absolute before:bottom-2 before:left-[15px] before:top-2 before:w-px before:bg-border" aria-label="Order timeline, newest first">
      {entries.map((e, i) => (
        <li key={i} className="relative flex gap-3">
          <span className={`z-10 flex size-8 shrink-0 items-center justify-center rounded-full border ${e.kind === 'comment' ? 'border-foreground bg-card text-foreground' : 'border-border bg-muted text-muted-foreground'}`} aria-hidden="true">
            <Icon name={ICON[e.kind]} size={15} />
          </span>
          <div className="min-w-0 flex-1 pt-1">
            <p className={`text-sm ${e.kind === 'comment' ? 'whitespace-pre-line rounded-[var(--radius)] bg-muted px-3 py-2' : ''}`}>{e.message}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              <time dateTime={e.at.replace(' ', 'T') + 'Z'}>{fmtDate(e.at)}</time>{e.author ? ` · ${e.author}` : ''}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}
