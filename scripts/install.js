// Installation : tables, Territoire pilote et premier compte COORDINATOR.
// Relançable sans risque : ce qui existe déjà n'est pas recréé.
import { createDb } from '../src/shared/db.js';
import { systemClock } from '../src/shared/clock.js';
import { hashPassword } from '../src/shared/password.js';
import { migrate } from './migrate.js';

const REQUIRED = [
  'TERRITORY_NAME',
  'COORDINATOR_EMAIL',
  'COORDINATOR_PASSWORD',
  'COORDINATOR_ORGANIZATION_NAME',
  'COORDINATOR_ADDRESS',
];

export async function install(db, clock, env) {
  const missing = REQUIRED.filter((name) => !env[name]);
  if (missing.length > 0) throw new Error(`Variables manquantes : ${missing.join(', ')}`);

  await migrate(db);
  await db.query(
    'INSERT INTO territory (name) SELECT $1 WHERE NOT EXISTS (SELECT 1 FROM territory)',
    [env.TERRITORY_NAME],
  );
  await db.query(
    `INSERT INTO account (territory_id, role, status, email, password_hash, organization_name, address, created_at)
     VALUES ((SELECT min(id) FROM territory), 'COORDINATOR', 'ACTIVE', $1, $2, $3, $4, $5)
     ON CONFLICT (email) DO NOTHING`,
    [
      env.COORDINATOR_EMAIL.toLowerCase(),
      await hashPassword(env.COORDINATOR_PASSWORD),
      env.COORDINATOR_ORGANIZATION_NAME,
      env.COORDINATOR_ADDRESS,
      clock.now(),
    ],
  );
}

if (import.meta.main) {
  const db = createDb(process.env.DATABASE_URL);
  await install(db, systemClock, process.env);
  await db.end();
  console.log('Installation terminée.');
}
