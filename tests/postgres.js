import { randomUUID } from 'node:crypto';
import { openDatabase } from '../server/db.js';
import { migrate } from '../server/migrate.js';
import {readFile} from 'node:fs/promises';

const testUrl = process.env.TEST_DATABASE_URL;
if (!testUrl) throw new Error('TEST_DATABASE_URL is required; refusing to use a default database');
if (testUrl === process.env.DATABASE_URL) throw new Error('TEST_DATABASE_URL must differ from DATABASE_URL');

export async function openTestDatabase({legacy=false}={}) {
  const admin = await openDatabase(testUrl);
  const schema = `suite_${randomUUID().replaceAll('-', '')}`;
  try {
    await admin.pool.query(`CREATE SCHEMA "${schema}"`);
    const database = await openDatabase(testUrl, { searchPath: schema });
    if(legacy){
      await database.pool.query(await readFile(new URL('../server/migrations/001-initial.sql',import.meta.url),'utf8'));
      await database.pool.query('CREATE TABLE schema_migrations(version TEXT PRIMARY KEY,applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())');
      await database.pool.query("INSERT INTO schema_migrations(version) VALUES('001-initial.sql')");
    }else await migrate(database.pool);
    return {
      ...database,
      schema,
      connectionString: testUrl,
      async close() {
        await database.close();
        try { await admin.pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); }
        finally { await admin.close(); }
      },
    };
  } catch (error) {
    await admin.pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(() => {});
    await admin.close();
    throw error;
  }
}
