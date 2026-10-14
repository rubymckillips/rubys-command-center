import { randomUUID } from 'node:crypto';
import { openDatabase } from '../server/db.js';
import { migrate } from '../server/migrate.js';

const testUrl = process.env.TEST_DATABASE_URL;
if (!testUrl) throw new Error('TEST_DATABASE_URL is required; refusing to use a default database');
if (testUrl === process.env.DATABASE_URL) throw new Error('TEST_DATABASE_URL must differ from DATABASE_URL');

export async function openTestDatabase() {
  const admin = await openDatabase(testUrl);
  const schema = `suite_${randomUUID().replaceAll('-', '')}`;
  try {
    await admin.pool.query(`CREATE SCHEMA "${schema}"`);
    const database = await openDatabase(testUrl, { searchPath: schema });
    await migrate(database.pool);
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
