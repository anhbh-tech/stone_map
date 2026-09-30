// Định dạng số liệu dùng chung cho server (KPI) và client (biểu đồ): không import db.
import { fmt } from '../../../lib/money';

export type Format = 'money' | 'count' | 'percent';

export function formatMetric(v: number | null, f: Format, compact = false): string {
  if (v == null) return '—';
  if (f === 'money') {
    if (compact && Math.abs(v) >= 100000) return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1 }).format(v / 100);
    return compact && v % 100 === 0 ? fmt(v).replace(/\.00$/, '') : fmt(v);
  }
  if (f === 'percent') return `${(v * 100).toFixed(compact && v !== 0 ? 0 : 1)}%`;
  return new Intl.NumberFormat('en-US').format(v);
}

/** “+12.5%” / “−3.0%”; null → không hiện so sánh. */
export const formatChange = (c: number | null) => (c == null ? null : `${c >= 0 ? '+' : '−'}${Math.abs(c * 100).toFixed(1)}%`);

/** Trục Y “đẹp”: bước 1/2/5 × 10^n, 4 khoảng. */
export function niceMax(max: number, f: Format): { top: number; ticks: number[] } {
  if (!(max > 0)) return { top: f === 'percent' ? 0.01 : f === 'money' ? 10000 : 4, ticks: [] };
  const raw = max / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw)!;
  const unit = f === 'count' ? Math.max(1, Math.ceil(step)) : step;
  const top = unit * Math.ceil(max / unit);
  const ticks: number[] = [];
  for (let t = 0; t <= top + unit / 2; t += unit) ticks.push(Number(t.toFixed(10)));
  return { top, ticks };
}
