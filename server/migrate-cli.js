import { openDatabase } from './db.js';
import { migrate } from './migrate.js';

const database = await openDatabase(process.env.DATABASE_URL);
try {
  const applied = await migrate(database.pool);
  console.log(`Database schema is current (${applied} migration files).`);
} finally {
  await database.close();
}
