import { openDatabase } from './db.js';
import { migrate } from './migrate.js';
import { seedLocalItems } from './seed.js';

if (process.env.NODE_ENV === 'production') throw new Error('Local examples cannot be seeded in production');
const database = await openDatabase(process.env.DATABASE_URL);
try {
  await migrate(database.pool);
  const seeded = await seedLocalItems(database.pool);
  console.log(seeded ? 'Added local sample items.' : 'Local sample items were already present.');
} finally {
  await database.close();
}
