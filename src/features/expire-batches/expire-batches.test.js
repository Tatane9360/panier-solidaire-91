import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { setupTestApp } from '../../shared/testing.js';
import { expireBatches } from './expire-batches.js';

let env;
before(async () => {
  env = await setupTestApp();
});
beforeEach(() => env.reset());
after(() => env.close());

// L'horloge de test démarre le 2 novembre 2026 à 10 h (heure de Paris).
let tokenCount = 0;
async function insertBatch(storeId, status = 'DECLARED') {
  tokenCount += 1;
  const { rows } = await env.db.query(
    `INSERT INTO batch (store_id, nature, quantity, quantity_unit, weight_kg, value_eur,
                        expiry_date, date_type, pickup_start, pickup_end, cold_requirement,
                        status, submission_token, created_at)
     VALUES ($1, 'Fruits et légumes', 4, 'cagettes', 12.5, 30, '2026-11-05', 'DLC',
             '2026-11-03T14:00'::timestamp AT TIME ZONE 'Europe/Paris',
             '2026-11-03T18:00'::timestamp AT TIME ZONE 'Europe/Paris',
             'AMBIENT', $2, $3, $4)
     RETURNING id`,
    [storeId, status, `token-${tokenCount}`, env.clock.now()],
  );
  return rows[0].id;
}

async function batchRow(id) {
  const { rows } = await env.db.query('SELECT status, expired_at FROM batch WHERE id = $1', [id]);
  return rows[0];
}

async function loggedIn(account) {
  const client = env.client();
  await client.login(account.email, account.password);
  return client;
}

test('batches expire only once the pickup slot has ended, other statuses are left alone', async () => {
  const store = await env.createAccount({ role: 'STORE' });
  const ids = {};
  for (const status of ['DECLARED', 'RESERVED', 'COLLECTED', 'CANCELLED']) {
    ids[status] = await insertBatch(store.id, status);
  }

  // 3 novembre, 17 h 59 à Paris : le créneau n'est pas encore terminé.
  env.clock.set('2026-11-03T16:59:00Z');
  await expireBatches({ db: env.db, clock: env.clock });
  assert.equal((await batchRow(ids.DECLARED)).status, 'DECLARED');

  // 18 h 00 pile : le créneau est dépassé.
  env.clock.set('2026-11-03T17:00:00Z');
  await expireBatches({ db: env.db, clock: env.clock });
  for (const status of ['DECLARED', 'RESERVED']) {
    assert.deepEqual(await batchRow(ids[status]), { status: 'EXPIRED', expired_at: env.clock.now() }, status);
  }
  for (const status of ['COLLECTED', 'CANCELLED']) {
    assert.deepEqual(await batchRow(ids[status]), { status, expired_at: null }, status);
  }
  const storePage = await (await loggedIn(store)).get('/batches');
  assert.equal(storePage.body.match(/Statut : <strong>Expiré<\/strong>/g).length, 2);

  // Un passage suivant ne réécrit pas expired_at.
  env.clock.advanceMinutes(60);
  await expireBatches({ db: env.db, clock: env.clock });
  assert.deepEqual((await batchRow(ids.DECLARED)).expired_at, new Date('2026-11-03T17:00:00Z'));
});

test('an expired reserved batch keeps its reservation and can be neither reserved nor cancelled', async () => {
  const store = await env.createAccount({ role: 'STORE' });
  const association = await env.createAccount({ role: 'ASSOCIATION' });
  const batchId = await insertBatch(store.id);
  const client = await loggedIn(association);
  assert.match((await client.get('/available-batches')).body, /Fruits et légumes/);
  await client.post(`/batches/${batchId}/reserve`, { reserved_by_name: 'Karim' });

  env.clock.set('2026-11-03T17:00:00Z');
  await expireBatches({ db: env.db, clock: env.clock });
  assert.equal((await batchRow(batchId)).status, 'EXPIRED');

  // La session a expiré avec le saut d'horloge : on se reconnecte.
  const again = await loggedIn(association);
  await again.get('/cold-capacity');
  assert.equal((await again.post(`/batches/${batchId}/cancel-reservation`)).status, 409);
  const other = await loggedIn(await env.createAccount({ role: 'ASSOCIATION' }));
  await other.get('/cold-capacity');
  assert.equal((await other.post(`/batches/${batchId}/reserve`, { reserved_by_name: 'Léa' })).status, 409);

  const { rows } = await env.db.query('SELECT cancelled_at FROM reservation WHERE batch_id = $1', [batchId]);
  assert.deepEqual(rows, [{ cancelled_at: null }]);
  assert.equal((await batchRow(batchId)).status, 'EXPIRED');
});

test('an expired batch no longer appears in the available batches', async () => {
  const store = await env.createAccount({ role: 'STORE' });
  await insertBatch(store.id);
  const association = await env.createAccount({ role: 'ASSOCIATION' });

  env.clock.set('2026-11-03T17:00:00Z');
  await expireBatches({ db: env.db, clock: env.clock });
  const client = await loggedIn(association);
  const { rows } = await env.db.query('SELECT status FROM batch');
  assert.deepEqual(rows, [{ status: 'EXPIRED' }]);
  assert.doesNotMatch((await client.get('/available-batches')).body, /Fruits et légumes/);
});

test('expired sessions and login failures older than 15 minutes are deleted', async () => {
  const now = env.clock.now().getTime();
  const at = (minutes) => new Date(now + minutes * 60_000);
  await env.db.query(
    `INSERT INTO session (sid, account_id, csrf_token, expires_at)
     VALUES ('expired', NULL, 't', $1), ('just-expired', NULL, 't', $2), ('alive', NULL, 't', $3)`,
    [at(-60), at(0), at(1)],
  );
  await env.db.query(
    `INSERT INTO login_failure (email, failed_at, starts_block)
     VALUES ('a@example.org', $1, false), ('b@example.org', $2, false), ('c@example.org', $3, false)`,
    [at(-16), at(-15), at(-14)],
  );

  await expireBatches({ db: env.db, clock: env.clock });

  const sessions = await env.db.query('SELECT sid FROM session ORDER BY sid');
  assert.deepEqual(sessions.rows, [{ sid: 'alive' }]);
  const failures = await env.db.query('SELECT email FROM login_failure ORDER BY email');
  assert.deepEqual(failures.rows, [{ email: 'c@example.org' }]);
});
