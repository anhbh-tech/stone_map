import { describe, expect, it } from 'vitest';
import { lockedStyle } from './validate';

describe('lockedStyle', () => {
  it('theme product keeps its theme whatever style the client sends', () => {
    expect(lockedStyle('sunflower-queen', 'royal-starry')).toBe('sunflower-queen');
    expect(lockedStyle('sunflower-queen', 'sunflower-queen')).toBe('sunflower-queen');
  });
  it('product without a theme keeps the requested style; no style stays empty', () => {
    expect(lockedStyle(null, 'ocean')).toBe('ocean');
    expect(lockedStyle('cafe-duke', undefined)).toBeNull();
    expect(lockedStyle(null, null)).toBeNull();
  });
});
