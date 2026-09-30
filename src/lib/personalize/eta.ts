// ETA thật cho job AI (#2): không có "a few seconds", không đứng ở 99%.
// typical = p75 thời gian chạy (started → finished) của 50 job thành công gần nhất cùng loại + provider;
// chưa đủ mẫu → settings.ai.mock_ms (mock) hoặc 60 s. eta = phần còn lại của job này + các job đứng trước.

export const HISTORY_SIZE = 50;
export const MIN_SAMPLES = 5;
export const DEFAULT_REAL_MS = 60_000;
export const DEFAULT_RENDER_MS = 3_000;

export function quantile(values: number[], q: number): number | null {
  const v = values.filter((x) => Number.isFinite(x) && x >= 0).sort((a, b) => a - b);
  if (!v.length) return null;
  const pos = (v.length - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return Math.round(v[lo] + (v[hi] - v[lo]) * (pos - lo));
}
export const p75 = (values: number[]) => quantile(values, 0.75);

/** Thời gian điển hình của 1 job: p75 lịch sử, hoặc fallback khi chưa đủ MIN_SAMPLES mẫu. */
export function typicalMs(durations: number[], fallbackMs: number): number {
  const q = durations.length >= MIN_SAMPLES ? p75(durations) : null;
  return Math.max(1, q ?? fallbackMs);
}

/**
 * Thời gian còn lại của 1 job đang chạy được `elapsed` ms, thời gian điển hình `typical`.
 * Nửa đầu: typical − elapsed. Sau đó không bao giờ về 0: r = max(typical − elapsed, 0.16·typical²/elapsed)
 * (hai nhánh gặp nhau ở 0.8·typical), nên progress = e/(e+r) = e²/(e²+0.16T²) vẫn tăng đều khi job chạy quá
 * dự kiến — 0.86 ở T, 0.96 ở 2T — thay vì kẹt ở 0.99. Job quá JOB_TIMEOUT bị worker đánh failed.
 */
export function remainingMs(elapsed: number, typical: number): number {
  const e = Math.max(0, elapsed);
  const linear = typical - e;
  if (e <= typical / 2) return Math.round(linear);
  return Math.max(1, Math.round(Math.max(linear, (0.16 * typical * typical) / e)));
}

export type QueueItem = { status: 'queued' | 'running'; runningMs: number; typical: number };

/** ETA cho 1 job: các job đứng trước (đang chạy → phần còn lại, đang chờ → typical) + phần của chính nó. */
export function etaMs(self: QueueItem, ahead: QueueItem[]): number {
  const own = self.status === 'running' ? remainingMs(self.runningMs, self.typical) : self.typical;
  const wait = ahead.reduce((sum, j) => sum + (j.status === 'running' ? remainingMs(j.runningMs, j.typical) : j.typical), 0);
  return Math.round(own + wait);
}

export function progressOf(elapsed: number, eta: number): number {
  if (elapsed <= 0) return 0;
  return Math.round((elapsed / (elapsed + Math.max(0, eta))) * 1000) / 1000;
}
