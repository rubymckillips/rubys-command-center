import { describe, expect, it } from 'vitest';
import { reorderIds } from './order.js';

describe('reorderIds', () => {
  it('moves the first item to the last position', () => {
    expect(reorderIds(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a']);
  });

  it('moves the last item to the first position', () => {
    expect(reorderIds(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b']);
  });

  it('leaves an item in place when dropped onto itself', () => {
    expect(reorderIds(['a', 'b', 'c'], 1, 1)).toEqual(['a', 'b', 'c']);
  });

  it('preserves every ID', () => {
    const ids = ['first', 'second', 'third', 'fourth'];
    const reordered = reorderIds(ids, 1, 3);

    expect(reordered).toHaveLength(ids.length);
    expect(new Set(reordered)).toEqual(new Set(ids));
  });
});
