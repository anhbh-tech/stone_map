import { describe, expect, it } from 'vitest';
import { parseEvent } from './pixel';

describe('parseEvent', () => {
  it('accepts { name, payload } and defaults payload', () => {
    expect(parseEvent('{"name":"page_viewed","payload":{"path":"/"}}')).toEqual({ name: 'page_viewed', payload: { path: '/' } });
    expect(parseEvent('{"name":"add_to_cart"}')).toEqual({ name: 'add_to_cart', payload: {} });
  });
  it('rejects malformed bodies', () => {
    for (const b of ['', 'nope', '[]', '{"name":"Bad Name"}', '{"name":"x"}', '{"name":"ok_name","payload":[1]}', `{"name":"big","payload":{"x":"${'a'.repeat(5000)}"}}`])
      expect(parseEvent(b)).toBeNull();
  });
});
