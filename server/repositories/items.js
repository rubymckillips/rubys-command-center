import { randomUUID } from 'node:crypto';
import { withTransaction } from '../db.js';
import { createActivityRepository } from './activity.js';

const columns = `id, kind, section, title, notes, due_at AS "dueAt", completed,
  position, today_position AS "todayPosition", in_today AS "inToday", archived,
  source, source_id AS "sourceId", source_url AS "sourceUrl", class_name AS "className",
  source_details AS "sourceDetails", external_url AS "externalUrl", sync_state AS "syncState",
  created_at AS "createdAt", updated_at AS "updatedAt"`;

const localFieldNames = {
  title: 'title', notes: 'notes', dueAt: 'due_at', due_at: 'due_at',
  completed: 'completed', externalUrl: 'external_url', external_url: 'external_url',
};
const sourceFieldNames = {
  kind: 'kind', title: 'title', dueAt: 'due_at', due_at: 'due_at',
  source: 'source', sourceId: 'source_id', source_id: 'source_id',
  sourceUrl: 'source_url', source_url: 'source_url', className: 'class_name',
  class_name: 'class_name', sourceDetails: 'source_details', source_details: 'source_details',
  syncState: 'sync_state', sync_state: 'sync_state',
};

function normalize(item) {
  if (!item) return null;
  return { ...item, completed: Boolean(item.completed), inToday: Boolean(item.inToday), archived: Boolean(item.archived) };
}

async function lockPositions(client, section, today = false) {
  if (section) await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`items:section:${section}`]);
  if (today) await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', ['items:today']);
}

async function lockMutation(client) {
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', ['items:mutation']);
}

async function nextPosition(client, section, today = false, workspaceId = 'legacy') {
  const result = today
    ? await client.query('SELECT COALESCE(MAX(today_position), -1) + 1 AS next FROM items WHERE workspace_id=$1 AND in_today = TRUE AND archived = FALSE',[workspaceId])
    : await client.query('SELECT COALESCE(MAX(position), -1) + 1 AS next FROM items WHERE workspace_id=$2 AND section = $1 AND archived = FALSE', [section,workspaceId]);
  return result.rows[0].next;
}

export function createItemsRepository(pool, activityRepository, workspaceId = 'legacy') {
  activityRepository ??= createActivityRepository(pool,workspaceId);
  async function findById(client, id, { forUpdate = false } = {}) {
    const result = await client.query(`SELECT ${columns} FROM items WHERE id = $1 AND workspace_id=$2${forUpdate ? ' FOR UPDATE' : ''}`, [id,workspaceId]);
    return normalize(result.rows[0]);
  }

  async function record(client, itemId, action, section) {
    await activityRepository.record({ itemId, action, section }, client);
  }

  async function insert(client, input) {
    const id = input.id || randomUUID();
    const now = new Date().toISOString();
    const inToday = Boolean(input.inToday ?? input.in_today);
    const position = input.position ?? await nextPosition(client, input.section,false,workspaceId);
    const todayPosition = inToday ? (input.todayPosition ?? await nextPosition(client, null, true,workspaceId)) : null;
    await client.query(`
      INSERT INTO items (id, kind, section, title, notes, due_at, completed, position,
        today_position, in_today, source, source_id, source_url, class_name, source_details,
        external_url, sync_state, created_at, updated_at, workspace_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$18,$19)
    `, [id, input.kind || 'local', input.section, input.title, input.notes ?? null,
      input.dueAt ?? input.due_at ?? null, Boolean(input.completed), position, todayPosition, inToday,
      input.source ?? null, input.sourceId ?? input.source_id ?? null,
      input.sourceUrl ?? input.source_url ?? null, input.className ?? input.class_name ?? null,
      input.sourceDetails ?? input.source_details ?? null, input.externalUrl ?? input.external_url ?? null,
      input.syncState ?? input.sync_state ?? 'local', now,workspaceId]);
    return findById(client, id);
  }

  return {
    async list({ section, todayOnly = false } = {}) {
      const result = todayOnly
        ? await pool.query(`SELECT ${columns} FROM items WHERE workspace_id=$1 AND in_today = TRUE AND archived = FALSE ORDER BY today_position, id`,[workspaceId])
        : await pool.query(`SELECT ${columns} FROM items WHERE workspace_id=$2 AND section = $1 AND archived = FALSE ORDER BY position, id`, [section,workspaceId]);
      return result.rows.map(normalize);
    },

    async create(input) {
      return withTransaction(pool, async (client) => {
        const inToday = Boolean(input.inToday ?? input.in_today);
        await lockMutation(client);
        await lockPositions(client, input.section, inToday);
        const item = await insert(client, input);
        await record(client, item.id, 'created', item.section);
        return item;
      });
    },

    async update(id, patch) {
      return withTransaction(pool, async (client) => {
        const before = await findById(client, id, { forUpdate: true });
        if (!before) return null;
        const entries = Object.entries(patch).filter(([key]) => localFieldNames[key]);
        if (!entries.length) return before;
        const values = [id, new Date().toISOString()];
        const assignments = entries.map(([key]) => {
          values.push(key === 'completed' ? Boolean(patch[key]) : patch[key]);
          return `${localFieldNames[key]} = $${values.length}`;
        });
        assignments.push('updated_at = $2');
        await client.query(`UPDATE items SET ${assignments.join(', ')} WHERE id = $1`, values);
        const item = await findById(client, id);
        const action = patch.completed !== undefined && Boolean(patch.completed) !== before.completed ? 'completed' : 'updated';
        await record(client, id, action, item.section);
        return item;
      });
    },

    async upsertSource(input) {
      const normalized = {
        kind: input.kind, section: input.section, title: input.title,
        source: input.source, sourceId: input.sourceId ?? input.source_id,
        dueAt: input.dueAt ?? input.due_at, sourceUrl: input.sourceUrl ?? input.source_url,
        className: input.className ?? input.class_name, sourceDetails: input.sourceDetails ?? input.source_details,
        syncState: input.syncState ?? input.sync_state,
      };
      if (!normalized.source || !normalized.sourceId) throw new Error('source and sourceId are required for a source upsert');
      return withTransaction(pool, async (client) => {
        await lockMutation(client);
        const existingResult = await client.query(`SELECT ${columns} FROM items WHERE workspace_id=$3 AND source = $1 AND source_id = $2 FOR UPDATE`, [normalized.source, normalized.sourceId,workspaceId]);
        const existing = normalize(existingResult.rows[0]);
        await lockPositions(client, existing?.section || normalized.section, existing?.inToday || false);
        let item;
        if (!existing) {
          item = await insert(client, { ...normalized, sourceId: normalized.sourceId, syncState: normalized.syncState ?? 'synced' });
        } else {
          const entries = Object.entries(normalized).filter(([key, value]) => sourceFieldNames[key] && value !== undefined);
          const values = [existing.id, new Date().toISOString()];
          const assignments = entries.map(([key, value]) => {
            values.push(value);
            return `${sourceFieldNames[key]} = $${values.length}`;
          });
          assignments.push('updated_at = $2');
          await client.query(`UPDATE items SET ${assignments.join(', ')} WHERE id = $1`, values);
          item = await findById(client, existing.id);
        }
        await record(client, item.id, existing ? 'updated' : 'created', item.section);
        return item;
      });
    },

    async upsert(input) { return this.upsertSource(input); },

    async markSourceRecordsAbsent(source, presentSourceIds) {
      const ids = [...new Set(presentSourceIds)];
      const values = [new Date().toISOString(), source];
      const exclusion = ids.length ? ` AND source_id <> ALL($3::text[])` : '';
      if (ids.length) values.push(ids);
      values.push(workspaceId);
      const result = await pool.query(`UPDATE items SET sync_state = 'stale', updated_at = $1
        WHERE workspace_id=$${values.length} AND source = $2 AND source_id IS NOT NULL AND sync_state <> 'stale'${exclusion}`, values);
      return result.rowCount;
    },

    async remove(id) {
      return withTransaction(pool, async (client) => {
        await lockMutation(client);
        const item = await findById(client, id, { forUpdate: true });
        if (!item) return null;
        await lockPositions(client, item.section, item.inToday);
        if (item.source) {
          await client.query('UPDATE items SET archived = TRUE, in_today = FALSE, today_position = NULL, updated_at = $1 WHERE id = $2', [new Date().toISOString(), id]);
        } else {
          await client.query('DELETE FROM items WHERE id = $1', [id]);
          await client.query('UPDATE items SET position = position - 1 WHERE workspace_id=$3 AND section = $1 AND position > $2 AND archived = FALSE', [item.section, item.position,workspaceId]);
        }
        if (item.inToday) await client.query('UPDATE items SET today_position = today_position - 1 WHERE workspace_id=$2 AND in_today = TRUE AND today_position > $1 AND archived = FALSE', [item.todayPosition,workspaceId]);
        await record(client, id, item.source ? 'archived' : 'deleted', item.section);
        return item.source ? findById(client, id) : item;
      });
    },

    async setToday(id, included) {
      return withTransaction(pool, async (client) => {
        await lockMutation(client);
        const item = await findById(client, id, { forUpdate: true });
        if (!item) return null;
        await lockPositions(client, item.section, true);
        const now = new Date().toISOString();
        if (included && !item.inToday) {
          await client.query('UPDATE items SET in_today = TRUE, today_position = $1, updated_at = $2 WHERE id = $3', [await nextPosition(client, null, true,workspaceId), now, id]);
        } else if (!included && item.inToday) {
          await client.query('UPDATE items SET in_today = FALSE, today_position = NULL, updated_at = $1 WHERE id = $2', [now, id]);
          await client.query('UPDATE items SET today_position = today_position - 1 WHERE workspace_id=$2 AND in_today = TRUE AND today_position > $1 AND archived = FALSE', [item.todayPosition,workspaceId]);
        }
        await record(client, id, included ? 'today-added' : 'today-removed', item.section);
        return findById(client, id);
      });
    },

    async reorder(section, orderedIds) {
      const today = section === 'today';
      return withTransaction(pool, async (client) => {
        await lockMutation(client);
        await lockPositions(client, today ? null : section, today);
        const rowsResult = today
          ? await client.query(`SELECT ${columns} FROM items WHERE workspace_id=$1 AND in_today = TRUE AND archived = FALSE ORDER BY today_position, id`,[workspaceId])
          : await client.query(`SELECT ${columns} FROM items WHERE workspace_id=$2 AND section = $1 AND archived = FALSE ORDER BY position, id`, [section,workspaceId]);
        const rows = rowsResult.rows.map(normalize);
        const existingIds = new Set(rows.map(({ id }) => id));
        if (orderedIds.length !== rows.length || new Set(orderedIds).size !== rows.length || orderedIds.some((id) => !existingIds.has(id))) {
          throw new Error('orderedIds must contain exactly the items in the requested scope');
        }
        const now = new Date().toISOString();
        for (const [index, id] of orderedIds.entries()) {
          await client.query(`UPDATE items SET ${today ? 'today_position' : 'position'} = $1, updated_at = $2 WHERE id = $3`, [index, now, id]);
          await record(client, id, 'reordered', today ? 'today' : section);
        }
        return orderedIds.map((id) => rows.find((item) => item.id === id));
      }).then(async (ordered) => {
        const fresh = await this.list({ section: today ? undefined : section, todayOnly: today });
        const byId = new Map(fresh.map((item) => [item.id, item]));
        return ordered.map(({ id }) => byId.get(id));
      });
    },
  };
}
