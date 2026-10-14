import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { withTransaction } from './db.js';

const migrationDirectory = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');
const lockKey = 'ps3-schema-migrations';

export async function migrate(pool) {
  const files = (await readdir(migrationDirectory))
    .filter((file) => /^\d+[-_].+\.sql$/.test(file))
    .sort((left, right) => left.localeCompare(right));
  return withTransaction(pool, async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [lockKey]);
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
    const applied = new Set((await client.query('SELECT version FROM schema_migrations')).rows.map(({ version }) => version));
    for (const file of files) {
      if (applied.has(file)) continue;
      const sql = await readFile(path.join(migrationDirectory, file), 'utf8');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations(version) VALUES ($1)', [file]);
    }
    return files.length;
  });
}
