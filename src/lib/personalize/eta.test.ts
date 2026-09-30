import { describe, expect, it } from 'vitest';
import { etaMs, p75, progressOf, remainingMs, typicalMs, MIN_SAMPLES } from './eta';

describe('eta', () => {
  it('p75 of real durations', () => {
    expect(p75([10, 20, 30, 40, 50])).toBe(40);
    expect(p75([])).toBeNull();
  });
  it('falls back until there are enough samples', () => {
    expect(typicalMs([1000, 2000], 12000)).toBe(12000);
    expect(typicalMs(Array.from({ length: MIN_SAMPLES }, (_, i) => 1000 * (i + 1)), 12000)).toBe(4000);
  });
  it('counts the jobs ahead in the queue', () => {
    const T = 10_000;
    expect(etaMs({ status: 'queued', runningMs: 0, typical: T }, [])).toBe(T);
    const running = { status: 'running' as const, runningMs: 4_000, typical: T };
    const queued = { status: 'queued' as const, runningMs: 0, typical: T };
    expect(etaMs({ status: 'queued', runningMs: 0, typical: T }, [running, queued])).toBe(T + 6_000 + T);
  });
  it('progress rises steadily, never reaches 1 while running, and does not park at 0.99', () => {
    const T = 12_000;
    let prev = -1;
    for (let e = 0; e <= 3 * T; e += 250) {
      const p = progressOf(e, remainingMs(e, T));
      expect(p).toBeGreaterThanOrEqual(prev);
      expect(p).toBeLessThan(1);
      prev = p;
    }
    // Đúng dự kiến → khoảng 86 %, gấp đôi → 96 %: vẫn còn khoảng để nhích, và eta vẫn > 0.
    expect(progressOf(T, remainingMs(T, T))).toBeCloseTo(0.862, 2);
    expect(progressOf(2 * T, remainingMs(2 * T, T))).toBeCloseTo(0.962, 2);
    expect(remainingMs(10 * T, T)).toBeGreaterThan(0);
  });
  it('progress is elapsed / (elapsed + eta)', () => {
    expect(progressOf(3000, 9000)).toBe(0.25);
    expect(progressOf(0, 9000)).toBe(0);
  });
});
