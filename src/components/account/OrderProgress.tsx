import { ORDER_STEPS, designStatusView, orderStatusLabel, type DesignTone, type OrderStatus } from '@/lib/order-status';
import type { DesignStatus } from '@/lib/types';
import { UiIcon } from '@/components/nav/icons';

/** Tiến độ đơn: 4 bước, bước hiện tại đánh dấu aria-current. Hoàn tiền / huỷ → một nhãn duy nhất. */
export function OrderProgress({ status, compact }: { status: OrderStatus; compact?: boolean }) {
  const at = ORDER_STEPS.findIndex((s) => s.id === status);
  if (at < 0) return <p className="text-sm font-semibold text-muted-foreground">{orderStatusLabel(status)}</p>;
  if (compact) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold text-foreground">{ORDER_STEPS[at].label}</span>
        <span className="flex gap-1" aria-hidden="true">
          {ORDER_STEPS.map((s, i) => <span key={s.id} className={`h-1.5 w-5 rounded-full ${i <= at ? 'bg-primary' : 'bg-border'}`} />)}
        </span>
        <span className="sr-only">Step {at + 1} of {ORDER_STEPS.length}</span>
      </div>
    );
  }
  return (
    <ol className="grid gap-3 sm:grid-cols-4 sm:gap-2">
      {ORDER_STEPS.map((s, i) => {
        const done = i < at, now = i === at;
        return (
          <li key={s.id} aria-current={now ? 'step' : undefined} className="flex items-center gap-3 sm:flex-col sm:items-start sm:gap-2">
            <span className="flex w-full items-center gap-2 max-sm:w-auto">
              <span className={`flex size-8 shrink-0 items-center justify-center rounded-full border-2 text-sm font-semibold ${done ? 'border-primary bg-primary text-on-primary' : now ? 'border-primary bg-card text-foreground' : 'border-border bg-card text-muted-foreground'}`}>
                {done ? <UiIcon name="check" size={16} /> : i + 1}
              </span>
              {i < ORDER_STEPS.length - 1 && <span aria-hidden="true" className={`hidden h-0.5 flex-1 rounded-full sm:block ${done ? 'bg-primary' : 'bg-border'}`} />}
            </span>
            <span className={`text-sm ${now ? 'font-semibold text-foreground' : done ? 'text-foreground' : 'text-muted-foreground'}`}>
              {s.label}{done && <span className="sr-only"> (done)</span>}{now && <span className="sr-only"> (current)</span>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

const TONE: Record<DesignTone, string> = {
  ok: 'border-success text-success',
  wait: 'border-border text-foreground',
  action: 'border-destructive text-destructive',
};

export function DesignBadge({ status, withDetail }: { status: DesignStatus | null; withDetail?: boolean }) {
  const v = designStatusView(status);
  if (!v) return null;
  return (
    <span className="block">
      <span className={`inline-flex items-center gap-1 rounded-full border bg-card px-2.5 py-0.5 text-xs font-semibold ${TONE[v.tone]}`}>
        {v.tone === 'ok' && <UiIcon name="check" size={14} />}{v.label}
      </span>
      {withDetail && <span className="mt-1 block text-sm text-muted-foreground">{v.detail}</span>}
    </span>
  );
}
