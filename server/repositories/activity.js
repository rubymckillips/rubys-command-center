import { safeNumericId } from '../db.js';

const eventColumns = 'id, item_id AS "itemId", action, section, occurred_at AS "occurredAt"';

export function createActivityRepository(pool) {
  return {
    async record({ itemId = null, action, section, occurredAt = new Date().toISOString() }, client = pool) {
      const result = await client.query(`
        INSERT INTO activity_events (item_id, action, section, occurred_at)
        VALUES ($1, $2, $3, $4)
        RETURNING ${eventColumns}
      `, [itemId, action, section, occurredAt]);
      return { ...result.rows[0], id: safeNumericId(result.rows[0].id) };
    },

    async list() {
      const result = await pool.query(`SELECT ${eventColumns} FROM activity_events ORDER BY id ASC`);
      return result.rows.map((event) => ({ ...event, id: safeNumericId(event.id) }));
    },
  };
}
