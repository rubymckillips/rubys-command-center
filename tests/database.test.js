import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { openDatabase, withTransaction } from '../server/db.js';
import { migrate } from '../server/migrate.js';
import { createActivityRepository } from '../server/repositories/activity.js';
import { createItemsRepository } from '../server/repositories/items.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) throw new Error('TEST_DATABASE_URL is required; refusing to use a default database');
if (databaseUrl === process.env.DATABASE_URL) throw new Error('TEST_DATABASE_URL must differ from DATABASE_URL');

const admin = await openDatabase(databaseUrl);
const databases = [];
afterEach(async () => {
  await Promise.all(databases.splice(0).map(async ({ schema, close }) => {
    await close();
    await admin.pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  }));
});
afterAll(() => admin.close());

async function repositories() {
  const schema = `suite_${randomUUID().replaceAll('-', '')}`;
  await admin.pool.query(`CREATE SCHEMA "${schema}"`);
  const db = await openDatabase(databaseUrl, { searchPath: schema });
  await migrate(db.pool);
  const activity = createActivityRepository(db.pool);
  databases.push({ schema, close: db.close });
  return { ...db, schema, activity, items: createItemsRepository(db.pool, activity) };
}

describe('Postgres persistence', () => {
  it('creates, updates, lists, and reopens durable items and activity', async () => {
    const { items, activity, schema } = await repositories();
    const created = await items.create({ section: 'tasks', title: 'Survives', notes: 'start' });
    await items.update(created.id, { notes: 'updated', completed: true });
    expect(await items.list({ section: 'tasks' })).toEqual([
      expect.objectContaining({ id: created.id, notes: 'updated', completed: true }),
    ]);
    expect((await activity.list()).map(({ action }) => action)).toEqual(['created', 'completed']);

    const reopened = await openDatabase(databaseUrl, { searchPath: schema });
    try {
      await migrate(reopened.pool);
      expect((await createItemsRepository(reopened.pool).list({ section: 'tasks' })).map(({ id }) => id)).toContain(created.id);
    } finally { await reopened.close(); }
  });

  it('keeps source rows unique and preserves local edits and archive state on repeat sync', async () => {
    const { items } = await repositories();
    const item = await items.upsertSource({ section: 'calendar', source: 'google-calendar', sourceId: 'event-1', title: 'Event' });
    await items.update(item.id, { notes: 'local', completed: true });
    await items.setToday(item.id, true);
    const changed = await items.upsertSource({ section: 'ignored', source: 'google-calendar', sourceId: 'event-1', title: 'Changed' });
    expect(changed).toMatchObject({ id: item.id, title: 'Changed', section: 'calendar', notes: 'local', completed: true, inToday: true });
    await items.remove(item.id);
    await items.upsertSource({ section: 'calendar', source: 'google-calendar', sourceId: 'event-1', title: 'Again' });
    expect(await items.list({ section: 'calendar' })).toEqual([]);
  });

  it('serializes concurrent source imports and position allocation', async () => {
    const { items, pool } = await repositories();
    await Promise.all(Array.from({ length: 8 }, (_, index) => items.create({ section: 'tasks', title: `Task ${index}` })));
    expect((await items.list({ section: 'tasks' })).map(({ position }) => position).sort((a, b) => a - b))
      .toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    await Promise.all(Array.from({ length: 8 }, (_, index) => items.upsertSource({
      section: 'calendar', source: 'google-calendar', sourceId: 'same-event', title: `Event ${index}`,
    })));
    expect((await pool.query("SELECT id, title FROM items WHERE source = 'google-calendar' AND source_id = 'same-event'")).rows)
      .toHaveLength(1);
  });

  it('reorders positions and keeps item changes atomic with activity', async () => {
    const { items, activity, pool } = await repositories();
    const first = await items.create({ section: 'tasks', title: 'First' });
    const second = await items.create({ section: 'tasks', title: 'Second' });
    await items.setToday(first.id, true);
    await items.setToday(second.id, true);
    expect((await items.reorder('today', [second.id, first.id])).map(({ id, todayPosition }) => [id, todayPosition]))
      .toEqual([[second.id, 0], [first.id, 1]]);

    const before = (await items.list({ section: 'tasks' })).map(({ id, title }) => [id, title]);
    const client = await pool.connect();
    try {
      await client.query('CREATE OR REPLACE FUNCTION reject_activity() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION \'blocked\'; END $$');
      await client.query('CREATE TRIGGER reject_activity_insert BEFORE INSERT ON activity_events FOR EACH ROW EXECUTE FUNCTION reject_activity()');
    } finally { client.release(); }
    await expect(items.update(first.id, { title: 'Cannot commit' })).rejects.toThrow();
    expect((await items.list({ section: 'tasks' })).map(({ id, title }) => [id, title])).toEqual(before);
    expect((await activity.list()).some(({ action }) => action === 'updated')).toBe(false);
  });

  it('rolls back a failed transaction', async () => {
    const { pool } = await repositories();
    await expect(withTransaction(pool, async (client) => {
      await client.query("INSERT INTO items(id, kind, section, title) VALUES ('rollback', 'local', 'tasks', 'No')");
      throw new Error('fail');
    })).rejects.toThrow('fail');
    expect((await pool.query("SELECT id FROM items WHERE id = 'rollback'")).rows).toEqual([]);
  });
});
