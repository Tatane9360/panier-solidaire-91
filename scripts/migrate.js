// Applique, dans l'ordre de leur nom, les fichiers SQL de scripts/migrations/ pas encore appliqués.
import { readdir, readFile } from 'node:fs/promises';
import { createDb } from '../src/shared/db.js';

const migrationsDir = new URL('./migrations/', import.meta.url);

export async function migrate(db) {
  await db.query('CREATE TABLE IF NOT EXISTS schema_migration (name text PRIMARY KEY)');
  const files = (await readdir(migrationsDir)).filter((name) => name.endsWith('.sql')).sort();

  for (const name of files) {
    const applied = await db.query('SELECT 1 FROM schema_migration WHERE name = $1', [name]);
    if (applied.rowCount > 0) continue;
    const sql = await readFile(new URL(name, migrationsDir), 'utf8');
    await db.withTransaction(async (client) => {
      await client.query(sql);
      await client.query('INSERT INTO schema_migration (name) VALUES ($1)', [name]);
    });
    console.log(`Migration appliquée : ${name}`);
  }
}

if (import.meta.main) {
  const db = createDb(process.env.DATABASE_URL);
  await migrate(db);
  await db.end();
}
