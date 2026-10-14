import { beforeEach, describe, expect, it, vi } from 'vitest';

const { createItemsRepository } = vi.hoisted(() => ({ createItemsRepository: vi.fn() }));
vi.mock('../server/repositories/items.js', () => ({ createItemsRepository }));

import { seedLocalItems } from '../server/seed.js';

describe('local demo seeds', () => {
  beforeEach(() => createItemsRepository.mockReset());

  it('uses the generic Work and Projects sections', async () => {
    const create = vi.fn().mockResolvedValue({});
    createItemsRepository.mockReturnValue({ create });
    const pool = { query: vi.fn().mockResolvedValue({ rows: [{ count: '0' }] }) };

    expect(await seedLocalItems(pool)).toBe(true);

    const seededItems = create.mock.calls.map(([item]) => item);
    expect(seededItems.find((item) => item.section === 'work')?.title).toContain('work session');
    expect(seededItems.find((item) => item.section === 'projects')?.title).toContain('project brief');
  });
});
