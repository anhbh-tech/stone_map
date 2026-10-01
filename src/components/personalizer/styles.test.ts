import { describe, expect, it } from 'vitest';
import { stylesFor } from './styles';

const all = [
  { id: 'royal-starry', name: 'Starry King' },
  { id: 'sunflower-queen', name: 'Sunflower Queen' },
  { id: 'cafe-duke', name: 'Café Terrace Duke' },
];

describe('stylesFor', () => {
  it('theme product offers (and so preselects) only its own theme', () => {
    expect(stylesFor(all, 'sunflower-queen')).toEqual([{ id: 'sunflower-queen', name: 'Sunflower Queen' }]);
    expect(stylesFor(all, 'cafe-duke')[0].id).toBe('cafe-duke');
  });
  it('product without a theme, or an unknown theme, keeps every style', () => {
    expect(stylesFor(all, null)).toBe(all);
    expect(stylesFor(all, 'nope')).toBe(all);
  });
});
