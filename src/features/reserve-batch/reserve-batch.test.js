import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { setupTestApp } from '../../shared/testing.js';

let env;
before(async () => {
  env = await setupTestApp();
});
beforeEach(() => env.reset());
after(() => env.close());

// L'horloge de test démarre le 2 novembre 2026 à 10 h (heure de Paris).
let tokenCount = 0;
async function insertBatch(storeId, fields = {}) {
  const batch = {
    nature: 'Fruits et légumes',
    pickup_start: '2026-11-03T14:00',
    pickup_end: '2026-11-03T18:00',
    cold_requirement: 'AMBIENT',
    status: 'DECLARED',
    ...fields,
  };
  tokenCount += 1;
  const { rows } = await env.db.query(
    `INSERT INTO batch (store_id, nature, quantity, quantity_unit, weight_kg, value_eur,
                        expiry_date, date_type, pickup_start, pickup_end, cold_requirement,
                        status, submission_token, created_at)
     VALUES ($1, $2, 4, 'cagettes', 12.5, 30, '2026-11-05', 'DLC',
             $3::timestamp AT TIME ZONE 'Europe/Paris', $4::timestamp AT TIME ZONE 'Europe/Paris',
             $5, $6, $7, $8)
     RETURNING id`,
    [storeId, batch.nature, batch.pickup_start, batch.pickup_end,
      batch.cold_requirement, batch.status, `token-${tokenCount}`, env.clock.now()],
  );
  return rows[0].id;
}

async function loggedIn(account) {
  const client = env.client();
  await client.login(account.email, account.password);
  return client;
}

async function setup(batchFields) {
  const store = await env.createAccount({ role: 'STORE' });
  const association = await env.createAccount({ role: 'ASSOCIATION' });
  const batchId = await insertBatch(store.id, batchFields);
  const client = await loggedIn(association);
  // Le formulaire de capacité de froid fournit le jeton CSRF, même sans lot réservable affiché.
  await client.get('/cold-capacity');
  return { store, association, batchId, client };
}

test('association reserves an available batch from the list, and the store sees the volunteer name', async () => {
  // Il est 10 h le 2 novembre : le créneau du lot ne commence que le 3, la réservation est possible avant.
  const { store, batchId, client } = await setup();

  const list = await client.get('/available-batches');
  assert.match(list.body, new RegExp(`action="/batches/${batchId}/reserve"`));
  assert.match(list.body, /name="reserved_by_name"[^>]*required/);

  const reserved = await client.post(`/batches/${batchId}/reserve`, { reserved_by_name: 'Karim' });
  assert.equal(reserved.status, 303);
  const after = await client.get(reserved.location);
  assert.match(after.body, /Lot réservé/);
  assert.doesNotMatch(after.body, /Fruits et légumes/);

  const storePage = await (await loggedIn(store)).get('/batches');
  assert.match(storePage.body, /Statut : <strong>Réservé<\/strong>/);
  assert.match(storePage.body, /Bénévole<\/dt><dd>Karim/);
});

// Attend que `count` requêtes de la base de test soient bloquées sur un verrou.
async function waitForLockWaiters(count) {
  for (;;) {
    const { rows } = await env.db.query(
      `SELECT count(*)::int AS count FROM pg_stat_activity
       WHERE datname = current_database() AND wait_event_type = 'Lock'`,
    );
    if (rows[0].count >= count) return;
    await sleep(10);
  }
}

// Pour que les réservations se chevauchent à coup sûr, le test bloque les insertions
// dans `reservation` jusqu'à ce que les 5 requêtes attendent un verrou :
// sans FOR UPDATE, toutes auraient lu le lot DECLARED.
// 5 requêtes seulement : avec le verrou du test et l'attente, le pool de 10 connexions suffit.
test('simultaneous reservations of the same batch: only one succeeds, the others are told it is already reserved', async () => {
  const { batchId, client } = await setup();
  const clients = [client];
  for (let i = 0; i < 4; i += 1) {
    const other = await loggedIn(await env.createAccount({ role: 'ASSOCIATION' }));
    await other.get('/cold-capacity');
    clients.push(other);
  }

  let locked;
  let release;
  const lockAcquired = new Promise((resolve) => { locked = resolve; });
  const released = new Promise((resolve) => { release = resolve; });
  const holding = env.db.withTransaction(async (lockClient) => {
    await lockClient.query('LOCK TABLE reservation IN SHARE MODE');
    locked();
    await released;
  });
  await lockAcquired;

  const pending = Promise.all(
    clients.map((each) => each.post(`/batches/${batchId}/reserve`, { reserved_by_name: 'Karim' })),
  );
  await waitForLockWaiters(clients.length);
  release();
  await holding;
  const responses = await pending;

  const statuses = responses.map((response) => response.status);
  assert.equal(statuses.filter((status) => status === 303).length, 1);
  assert.equal(statuses.filter((status) => status === 409).length, 4);
  for (const response of responses.filter((each) => each.status === 409)) {
    assert.match(response.body, /Lot déjà réservé/);
  }
  const { rows } = await env.db.query('SELECT count(*)::int AS count FROM reservation WHERE batch_id = $1', [batchId]);
  assert.equal(rows[0].count, 1);
});

async function batchStatus(batchId) {
  const { rows } = await env.db.query('SELECT status FROM batch WHERE id = $1', [batchId]);
  return rows[0].status;
}

test('refuses reservation when cold requirement is not in capacity, and invites to update the capacity', async () => {
  const { batchId, client } = await setup({ cold_requirement: 'FROZEN' });

  const { status, body } = await client.post(`/batches/${batchId}/reserve`, { reserved_by_name: 'Karim' });
  assert.equal(status, 409);
  assert.match(body, /niveau de froid que votre association ne sait pas respecter/);
  assert.match(body, /href="\/cold-capacity"/);
  assert.equal(await batchStatus(batchId), 'DECLARED');
  // Le lot incompatible n'offre pas de formulaire de réservation.
  assert.doesNotMatch((await client.get('/available-batches?all=1')).body, /\/reserve"/);
});

test('refuses reservation when the pickup slot has passed, even before the scheduler expires the batch', async () => {
  const { batchId, client } = await setup({ pickup_start: '2026-11-02T08:00', pickup_end: '2026-11-02T10:20' });
  env.clock.advanceMinutes(20);

  const { status, body } = await client.post(`/batches/${batchId}/reserve`, { reserved_by_name: 'Karim' });
  assert.equal(status, 409);
  assert.match(body, /créneau de retrait de ce lot est dépassé/);
  assert.equal(await batchStatus(batchId), 'DECLARED');
});

test('reservation is possible during the pickup slot', async () => {
  // Il est 10 h à Paris : le créneau a commencé à 8 h.
  const { batchId, client } = await setup({ pickup_start: '2026-11-02T08:00', pickup_end: '2026-11-02T18:00' });

  const { status } = await client.post(`/batches/${batchId}/reserve`, { reserved_by_name: 'Karim' });
  assert.equal(status, 303);
  assert.equal(await batchStatus(batchId), 'RESERVED');
});

test('refuses reservation without the volunteer first name', async () => {
  const { batchId, client } = await setup();

  for (const form of [{}, { reserved_by_name: '   ' }]) {
    const { status, body } = await client.post(`/batches/${batchId}/reserve`, form);
    assert.equal(status, 400);
    // La liste est réaffichée, l'erreur annoncée et reliée au champ du lot.
    assert.match(body, /role="alert"[\s\S]*Indiquez le prénom du bénévole/);
    assert.match(body, new RegExp(`id="reserved_by_name-${batchId}"[^>]*aria-invalid="true" aria-describedby="erreur-reserved_by_name-${batchId}"`));
    assert.match(body, new RegExp(`id="erreur-reserved_by_name-${batchId}"`));
  }
  assert.equal(await batchStatus(batchId), 'DECLARED');
});

test('refuses reservation of a batch that is not DECLARED or does not exist', async () => {
  const store = await env.createAccount({ role: 'STORE' });
  const client = await loggedIn(await env.createAccount({ role: 'ASSOCIATION' }));
  await client.get('/cold-capacity');

  const reserved = await insertBatch(store.id, { status: 'RESERVED' });
  const answer = await client.post(`/batches/${reserved}/reserve`, { reserved_by_name: 'Karim' });
  assert.equal(answer.status, 409);
  assert.match(answer.body, /Lot déjà réservé/);

  for (const status of ['COLLECTED', 'CANCELLED', 'EXPIRED']) {
    const batchId = await insertBatch(store.id, { status });
    const { status: code, body } = await client.post(`/batches/${batchId}/reserve`, { reserved_by_name: 'Karim' });
    assert.equal(code, 409, status);
    assert.match(body, /plus disponible/);
    assert.equal(await batchStatus(batchId), status);
  }

  for (const id of ['999999', 'abc', '99999999999']) {
    assert.equal((await client.post(`/batches/${id}/reserve`, { reserved_by_name: 'Karim' })).status, 404, id);
  }
});

test('reservation without a session gets 401, other profiles and inactive accounts get 403', async () => {
  const { association, batchId, client } = await setup();

  assert.equal((await env.client().post(`/batches/${batchId}/reserve`, { reserved_by_name: 'Karim' })).status, 401);

  for (const role of ['STORE', 'COORDINATOR']) {
    const other = await loggedIn(await env.createAccount({ role }));
    await other.get('/');
    assert.equal((await other.post(`/batches/${batchId}/reserve`, { reserved_by_name: 'Karim' })).status, 403, role);
  }

  // Compte désactivé pendant que sa session est ouverte.
  await env.db.query("UPDATE account SET status = 'REFUSED' WHERE id = $1", [association.id]);
  assert.equal((await client.post(`/batches/${batchId}/reserve`, { reserved_by_name: 'Karim' })).status, 403);
  assert.equal(await batchStatus(batchId), 'DECLARED');
});
