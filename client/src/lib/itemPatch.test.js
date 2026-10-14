import { describe, expect, it } from 'vitest';
import { buildItemPatch } from './itemPatch.js';

describe('buildItemPatch', () => {
  it('keeps Canvas-owned title and due date out of an imported assignment PATCH', () => {
    expect(buildItemPatch(
      { source: 'canvas', title: 'Canvas assignment', dueAt: '2026-10-02T18:00' },
      { title: 'Changed title', dueAt: '2026-10-03T18:00', notes: 'My note', completed: true },
    )).toEqual({ notes: 'My note', completed: true });
  });

  it('keeps title and due date editable for local entries', () => {
    expect(buildItemPatch(
      { source: null, title: 'Local entry', dueAt: null },
      { title: 'Updated local entry', dueAt: '2026-10-03T18:00', notes: null, completed: false },
    )).toEqual({
      title: 'Updated local entry', dueAt: '2026-10-03T18:00', notes: null, completed: false,
    });
  });
});
