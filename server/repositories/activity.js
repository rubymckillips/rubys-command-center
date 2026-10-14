import { safeNumericId } from '../db.js';

const eventColumns = 'id, item_id AS "itemId", action, section, occurred_at AS "occurredAt"';

export function createActivityRepository(pool, workspaceId = 'legacy') {
  return {
    async record({ itemId = null, action, section, occurredAt = new Date().toISOString() }, client = pool) {
      const result = await client.query(`
        INSERT INTO activity_events (item_id, action, section, occurred_at, workspace_id)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING ${eventColumns}
      `, [itemId, action, section, occurredAt, workspaceId]);
      return { ...result.rows[0], id: safeNumericId(result.rows[0].id) };
    },

    async list() {
      const result = await pool.query(`SELECT ${eventColumns} FROM activity_events WHERE workspace_id=$1 ORDER BY id ASC`, [workspaceId]);
      return result.rows.map((event) => ({ ...event, id: safeNumericId(event.id) }));
    },
  };
}
