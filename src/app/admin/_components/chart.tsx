'use client';
// Biểu đồ đường kỳ này vs kỳ trước (skill dataviz): kỳ này nét liền màu foreground, kỳ trước nét đứt muted-foreground,
// đã chạy validate_palette cho cả light/dark. SVG co giãn (preserveAspectRatio=none + non-scaling-stroke),
// nhãn trục/crosshair/tooltip là HTML đè lên nên chữ không bị kéo méo. Bàn phím: ←/→/Home/End, có live region + bảng dữ liệu.
import { useId, useMemo, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { formatMetric, niceMax, type Format } from '../_lib/metric-format';

export type ChartPoint = { key: string; label: string; value: number | null; prev: number | null; future: boolean };

function path(values: (number | null)[], top: number) {
  const n = values.length;
  const x = (i: number) => (n === 1 ? 50 : (i / (n - 1)) * 100);
  const y = (v: number) => 100 - (v / top) * 100;
  let d = '';
  let open = false;
  values.forEach((v, i) => {
    if (v == null) { open = false; return; }
    d += `${open ? 'L' : 'M'}${x(i).toFixed(3)} ${y(v).toFixed(3)} `;
    open = true;
  });
  return d.trim();
}

/** Vùng tô dưới đoạn liên tục đầu tiên (kỳ này chỉ có null ở tương lai nên là một đoạn). */
function area(values: (number | null)[], top: number) {
  const n = values.length;
  const last = values.findLastIndex((v) => v != null);
  if (last < 1) return '';
  const x = (i: number) => (i / (n - 1)) * 100;
  return `M0 100 ${values.slice(0, last + 1).map((v, i) => `L${x(i).toFixed(3)} ${(100 - ((v ?? 0) / top) * 100).toFixed(3)}`).join(' ')} L${x(last).toFixed(3)} 100 Z`;
}

export function TrendChart({ points, format, title, currentLabel, previousLabel }: {
  points: ChartPoint[]; format: Format; title: string; currentLabel: string; previousLabel: string;
}) {
  const uid = useId();
  const [active, setActive] = useState<number | null>(null);
  const n = points.length;
  const { top, ticks } = useMemo(() => {
    const max = Math.max(0, ...points.flatMap((p) => [p.value ?? 0, p.prev ?? 0]));
    const r = niceMax(max, format);
    return { top: r.top, ticks: r.ticks.length ? r.ticks : [0, r.top] };
  }, [points, format]);
  const cur = path(points.map((p) => p.value), top);
  const prev = path(points.map((p) => p.prev), top);
  const wash = area(points.map((p) => p.value), top);
  const xPct = (i: number) => (n === 1 ? 50 : (i / (n - 1)) * 100);
  const yPct = (v: number) => 100 - (v / top) * 100;

  // ≤ 7 nhãn trục X, cách đều, luôn có điểm đầu và cuối.
  const every = Math.max(1, Math.ceil((n - 1) / 6));
  const xLabels = points.map((p, i) => ({ i, label: p.label })).filter(({ i }) => i % every === 0 || i === n - 1)
    .filter(({ i }, k, arr) => !(k === arr.length - 2 && n - 1 - i < every / 2 && i !== 0));

  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const i = n === 1 ? 0 : Math.round(((e.clientX - r.left) / r.width) * (n - 1));
    setActive(Math.min(n - 1, Math.max(0, i)));
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const lastReal = Math.max(0, points.findLastIndex((p) => !p.future));
    const i = active ?? lastReal;
    const next = e.key === 'ArrowLeft' ? i - 1 : e.key === 'ArrowRight' ? i + 1 : e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : null;
    if (next == null) return;
    e.preventDefault();
    setActive(Math.min(n - 1, Math.max(0, next)));
  };

  const a = active == null ? null : points[active];
  const say = (p: ChartPoint) => `${p.label}: ${p.future ? 'not yet' : formatMetric(p.value, format)}, ${previousLabel.toLowerCase()} ${formatMetric(p.prev, format)}`;

  return (
    <figure className="m-0">
      <div className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-muted-foreground" aria-hidden="true">
        <span className="inline-flex items-center gap-2"><svg width="20" height="4"><line x1="0" y1="2" x2="20" y2="2" stroke="var(--foreground)" strokeWidth="2" strokeLinecap="round" /></svg>{currentLabel}</span>
        <span className="inline-flex items-center gap-2"><svg width="20" height="4"><line x1="1" y1="2" x2="20" y2="2" stroke="var(--muted-foreground)" strokeWidth="2" strokeDasharray="4 3" strokeLinecap="round" /></svg>{previousLabel}</span>
      </div>
      <div className="flex gap-2">
        {/* Trục Y */}
        <div className="relative h-56 w-14 shrink-0 text-right text-xs text-muted-foreground tnum sm:h-64" aria-hidden="true">
          {ticks.map((t) => <span key={t} className="absolute right-0 -translate-y-1/2 whitespace-nowrap" style={{ top: `${yPct(t)}%` }}>{formatMetric(t, format, true)}</span>)}
        </div>
        <div className="min-w-0 flex-1">
          <div role="group" tabIndex={0} aria-label={`${title}. Use left and right arrow keys to read each point.`} aria-describedby={`${uid}-live`}
            onPointerMove={onMove} onPointerLeave={() => setActive(null)} onKeyDown={onKey} onBlur={() => setActive(null)}
            className="relative h-56 touch-pan-y rounded-sm sm:h-64">
            {ticks.map((t) => <div key={t} className={`absolute inset-x-0 border-t ${t === 0 ? 'border-border' : 'border-border/60 border-dashed'}`} style={{ top: `${yPct(t)}%` }} aria-hidden="true" />)}
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible" aria-hidden="true">
              {wash && <path d={wash} fill="var(--foreground)" opacity="0.07" />}
              {prev && <path d={prev} fill="none" stroke="var(--muted-foreground)" strokeWidth="2" strokeDasharray="4 4" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />}
              {cur && <path d={cur} fill="none" stroke="var(--foreground)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />}
            </svg>
            {a && active != null && (
              <>
                <div className="pointer-events-none absolute inset-y-0 w-px bg-foreground/40" style={{ left: `${xPct(active)}%` }} aria-hidden="true" />
                {a.prev != null && <span className="pointer-events-none absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-card bg-muted-foreground" style={{ left: `${xPct(active)}%`, top: `${yPct(a.prev)}%` }} aria-hidden="true" />}
                {a.value != null && <span className="pointer-events-none absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-card bg-foreground" style={{ left: `${xPct(active)}%`, top: `${yPct(a.value)}%` }} aria-hidden="true" />}
                <div className={`admin-chart-tip absolute top-2 z-10 min-w-40 rounded-[var(--radius)] border border-border bg-card px-3 py-2 text-xs shadow-md ${xPct(active) > 60 ? '-translate-x-[calc(100%+12px)]' : 'translate-x-3'}`} style={{ left: `${xPct(active)}%` }} aria-hidden="true">
                  <div className="mb-1 font-semibold text-foreground">{a.label}</div>
                  <div className="flex items-center justify-between gap-4 text-foreground"><span className="inline-flex items-center gap-1.5"><span className="h-0.5 w-3 rounded bg-foreground" />{currentLabel}</span><span className="font-semibold tnum">{a.future ? '—' : formatMetric(a.value, format)}</span></div>
                  <div className="mt-0.5 flex items-center justify-between gap-4 text-muted-foreground"><span className="inline-flex items-center gap-1.5"><span className="h-0.5 w-3 rounded bg-muted-foreground" />{previousLabel}</span><span className="tnum">{formatMetric(a.prev, format)}</span></div>
                </div>
              </>
            )}
          </div>
          {/* Trục X */}
          <div className="relative mt-2 h-4 text-xs text-muted-foreground" aria-hidden="true">
            {xLabels.map(({ i, label }, k) => (
              // Màn hẹp: chỉ nhãn đầu, giữa, cuối để không chồng chữ.
              <span key={i} className={`absolute whitespace-nowrap ${i === 0 ? '' : i === n - 1 ? '-translate-x-full' : '-translate-x-1/2'} ${i === 0 || i === n - 1 || k === Math.floor(xLabels.length / 2) ? '' : 'max-sm:hidden'}`} style={{ left: `${xPct(i)}%` }}>{label}</span>
            ))}
          </div>
        </div>
      </div>
      <p id={`${uid}-live`} className="sr-only" aria-live="polite">{a ? say(a) : ''}</p>
      <details className="mt-4 text-sm">
        <summary className="inline-flex min-h-11 cursor-pointer items-center text-muted-foreground hover:text-foreground">View as table</summary>
        <div className="mt-2 max-h-72 overflow-auto rounded-[var(--radius)] border border-border" tabIndex={0} role="region" aria-label={`${title} data`}>
          <table className="w-full text-left text-sm">
            <caption className="sr-only">{title}</caption>
            <thead className="sticky top-0 bg-muted"><tr><th scope="col" className="px-3 py-2 font-semibold">Period</th><th scope="col" className="px-3 py-2 text-right font-semibold">{currentLabel}</th><th scope="col" className="px-3 py-2 text-right font-semibold">{previousLabel}</th></tr></thead>
            <tbody>
              {points.map((p) => (
                <tr key={p.key} className="border-t border-border"><td className="px-3 py-1.5">{p.label}</td><td className="px-3 py-1.5 text-right tnum">{p.future ? '—' : formatMetric(p.value, format)}</td><td className="px-3 py-1.5 text-right tnum text-muted-foreground">{formatMetric(p.prev, format)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
