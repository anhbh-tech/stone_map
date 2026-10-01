import { describe, expect, it } from 'vitest';
import type { Pt } from './api';
import { canvasBgTransform, corners, dragRotate, dragScale, hitTest, innerRect, normTransform, toPet } from './layers';

// quad của royal-starry (docs/OUTPUT.md).
const quad: Pt[] = [[514, 181], [898, 169], [892, 617], [517, 612]];

describe('layers (giống pearl_compare public/layers.js)', () => {
  it('innerRect lấy cạnh trong của quad', () => {
    expect(innerRect(quad)).toEqual([517, 181, 892, 612]);
  });

  it('normTransform kẹp tâm, scale, đưa rotate về (-180, 180] và làm tròn 3 số', () => {
    expect(normTransform({ x: 0, y: 9999, scale: 50, rotate: 270 }, quad)).toEqual({ x: 517, y: 612, scale: 20, rotate: -90 });
    expect(normTransform({ x: 600.12345, y: 300, scale: 0.001, rotate: -180 }, quad)).toEqual({ x: 600.123, y: 300, scale: 0.01, rotate: 180 });
    expect(normTransform(null, quad)).toEqual({ x: 704.5, y: 396.5, scale: 1, rotate: 0 });
  });

  it('toPet là nghịch đảo của corners', () => {
    const t = { x: 700, y: 400, scale: 0.5, rotate: 30 };
    const [tl, , br] = corners(t, 200, 100);
    expect(toPet(t, 200, 100, ...tl).map((v) => +v.toFixed(6) + 0)).toEqual([0, 0]);
    expect(toPet(t, 200, 100, ...br).map((v) => +v.toFixed(6) + 0)).toEqual([200, 100]);
  });

  it('dragScale / dragRotate quanh tâm pet', () => {
    const t = { x: 100, y: 100, scale: 1, rotate: 0 };
    expect(dragScale(t, [150, 100], [200, 100]).scale).toBe(2);
    expect(dragRotate(t, [100, 50], [150, 100]).rotate).toBe(90);
  });

  it('canvasBgTransform phủ kín hình chữ nhật bao clip', () => {
    const t = canvasBgTransform([[0, 0], [100, 0], [100, 200], [0, 200]], 51, 51);
    expect(t).toEqual({ x: 50, y: 100, scale: 202 / 51, rotate: 0 });
  });

  it('hitTest: núm xoay, góc, thân, ngoài', () => {
    const t = { x: 100, y: 100, scale: 1, rotate: 0 };
    expect(hitTest(t, 40, 40, [100, 50], 6, 30)).toBe('rotate');
    expect(hitTest(t, 40, 40, [81, 81], 6, 30)).toBe('scale');
    expect(hitTest(t, 40, 40, [100, 100], 6, 30)).toBe('move');
    expect(hitTest(t, 40, 40, [10, 10], 6, 30)).toBeNull();
  });
});
