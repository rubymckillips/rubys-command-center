import pg from 'pg';

const { Pool } = pg;

export async function openDatabase(connectionString, { searchPath } = {}) {
  if (!connectionString) throw new Error('DATABASE_URL is required');
  const options = searchPath ? `-c search_path=${searchPath}` : undefined;
  const pool = new Pool({ connectionString, max: 5, connectionTimeoutMillis: 10000, ...(options ? { options } : {}) });
  try {
    await pool.query('SELECT 1');
  } catch (error) {
    await pool.end();
    throw error;
  }
  return { pool, close: () => pool.end() };
}

export async function withTransaction(pool, callback) {
  const client = await pool.connect();
  let began = false;
  try {
    await client.query('BEGIN');
    began = true;
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    if (began) {
      try { await client.query('ROLLBACK'); } catch { /* preserve the original failure */ }
    }
    throw error;
  } finally {
    client.release();
  }
}

export function safeNumericId(value) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 0) throw new RangeError('Activity id exceeds the safe integer range');
  return id;
}
