import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { setupTestApp } from '../../shared/testing.js';

let env;
before(async () => {
  env = await setupTestApp();
});
beforeEach(() => env.reset());
after(() => env.close());

let tokenCount = 0;
async function insertBatch(storeId, status = 'DECLARED') {
  tokenCount += 1;
  const { rows } = await env.db.query(
    `INSERT INTO batch (store_id, nature, quantity, quantity_unit, weight_kg, value_eur,
                        expiry_date, date_type, pickup_start, pickup_end, cold_requirement,
                        status, submission_token, created_at)
     VALUES ($1, 'Pain', 4, 'cagettes', 12.5, 30, '2026-11-05', 'DLC',
             '2026-11-03T14:00+01', '2026-11-03T18:00+01', 'AMBIENT', $2, $3, '2026-11-02T09:00:00Z')
     RETURNING id`,
    [storeId, status, `token-${tokenCount}`],
  );
  return rows[0].id;
}

async function reserve(batchId, associationId) {
  await env.db.query(
    `INSERT INTO reservation (batch_id, association_id, reserved_at, reserved_by_name)
     VALUES ($1, $2, '2026-11-02T10:00:00Z', 'Awa')`,
    [batchId, associationId],
  );
}

async function coordinatorClient() {
  const coordinator = await env.createAccount({ role: 'COORDINATOR' });
  const client = env.client();
  await client.login(coordinator.email, coordinator.password);
  await client.get('/'); // récupère le jeton CSRF de la session connectée
  return { client, coordinator };
}

const CORRECTED = {
  nature: 'Pain et viennoiseries',
  quantity: '4',
  quantity_unit: 'cagettes',
  weight_kg: '15,5',
  value_eur: '30',
  expiry_date: '2026-11-05',
  date_type: 'DLC',
  pickup_start: '2026-11-03T14:00',
  pickup_end: '2026-11-03T18:00',
  cold_requirement: 'AMBIENT',
};

const history = async (batchId) => (await env.db.query(
  'SELECT field, old_value, new_value, reason, changed_by FROM batch_history WHERE batch_id = $1 ORDER BY field',
  [batchId],
)).rows;

test('edit form is prefilled and the monitoring list links to it', async () => {
  const store = await env.createAccount({ role: 'STORE' });
  const batchId = await insertBatch(store.id);
  const { client } = await coordinatorClient();

  const list = await client.get('/monitoring/batches');
  assert.match(list.body, new RegExp(`href="/monitoring/batches/${batchId}/edit"`));
  const form = await client.get(`/monitoring/batches/${batchId}/edit`);
  assert.equal(form.status, 200);
  assert.match(form.body, /value="Pain"/);
  assert.match(form.body, /value="2026-11-03T14:00"/);
});

test('correction updates the batch and records one history line per changed field', async () => {
  const store = await env.createAccount({ role: 'STORE' });
  const batchId = await insertBatch(store.id);
  const { client, coordinator } = await coordinatorClient();

  const response = await client.post(`/monitoring/batches/${batchId}/edit`, { ...CORRECTED, reason: 'Erreur de saisie' });
  assert.equal(response.status, 303);
  const { rows: [batch] } = await env.db.query('SELECT nature, weight_kg, status FROM batch WHERE id = $1', [batchId]);
  assert.equal(batch.nature, 'Pain et viennoiseries');
  assert.equal(Number(batch.weight_kg), 15.5);
  assert.equal(batch.status, 'DECLARED');
  assert.deepEqual(await history(batchId), [
    { field: 'nature', old_value: 'Pain', new_value: 'Pain et viennoiseries', reason: 'Erreur de saisie', changed_by: coordinator.id },
    { field: 'weight_kg', old_value: '12.5', new_value: '15.5', reason: 'Erreur de saisie', changed_by: coordinator.id },
  ]);
});

test('correction applies the same checks as the declaration', async () => {
  const store = await env.createAccount({ role: 'STORE' });
  const batchId = await insertBatch(store.id);
  const { client } = await coordinatorClient();

  const response = await client.post(`/monitoring/batches/${batchId}/edit`, { ...CORRECTED, weight_kg: '0', expiry_date: '2026-11-01' });
  assert.equal(response.status, 400);
  assert.match(response.body, /Le poids doit être un nombre supérieur à 0/);
  assert.match(response.body, /La date limite est déjà passée/);
  assert.deepEqual(await history(batchId), []);
});

test('a batch that is not DECLARED or RESERVED cannot be corrected', async () => {
  const store = await env.createAccount({ role: 'STORE' });
  const { client } = await coordinatorClient();
  for (const status of ['COLLECTED', 'EXPIRED', 'CANCELLED']) {
    const batchId = await insertBatch(store.id, status);
    assert.equal((await client.post(`/monitoring/batches/${batchId}/edit`, CORRECTED)).status, 409);
    assert.deepEqual(await history(batchId), []);
  }
});

test('cancelling a DECLARED batch needs a reason and is recorded', async () => {
  const store = await env.createAccount({ role: 'STORE' });
  const batchId = await insertBatch(store.id);
  const { client, coordinator } = await coordinatorClient();

  assert.equal((await client.post(`/monitoring/batches/${batchId}/cancel`, { reason: '  ' })).status, 400);
  assert.equal((await env.db.query('SELECT status FROM batch WHERE id = $1', [batchId])).rows[0].status, 'DECLARED');

  assert.equal((await client.post(`/monitoring/batches/${batchId}/cancel`, { reason: 'Doublon' })).status, 303);
  assert.equal((await env.db.query('SELECT status FROM batch WHERE id = $1', [batchId])).rows[0].status, 'CANCELLED');
  assert.deepEqual(await history(batchId), [
    { field: 'status', old_value: 'DECLARED', new_value: 'CANCELLED', reason: 'Doublon', changed_by: coordinator.id },
  ]);
});

test('cancelling a RESERVED batch releases its reservation', async () => {
  const store = await env.createAccount({ role: 'STORE' });
  const association = await env.createAccount({ role: 'ASSOCIATION' });
  const batchId = await insertBatch(store.id, 'RESERVED');
  await reserve(batchId, association.id);
  const { client, coordinator } = await coordinatorClient();

  await client.post(`/monitoring/batches/${batchId}/cancel`, { reason: 'Lot retiré par le commerce' });
  const { rows: [reservation] } = await env.db.query('SELECT cancelled_by, cancelled_at FROM reservation WHERE batch_id = $1', [batchId]);
  assert.equal(reservation.cancelled_by, coordinator.id);
  assert.deepEqual(reservation.cancelled_at, env.clock.now());
});

test('a COLLECTED batch can be cancelled, an EXPIRED or CANCELLED one cannot', async () => {
  const store = await env.createAccount({ role: 'STORE' });
  const { client } = await coordinatorClient();
  const collected = await insertBatch(store.id, 'COLLECTED');
  assert.equal((await client.post(`/monitoring/batches/${collected}/cancel`, { reason: 'Collecte confirmée par erreur' })).status, 303);
  for (const status of ['EXPIRED', 'CANCELLED']) {
    const batchId = await insertBatch(store.id, status);
    assert.equal((await client.post(`/monitoring/batches/${batchId}/cancel`, { reason: 'Test' })).status, 409);
    assert.equal((await env.db.query('SELECT status FROM batch WHERE id = $1', [batchId])).rows[0].status, status);
    assert.deepEqual(await history(batchId), []);
  }
});

test('unknown batch gives 404', async () => {
  const { client } = await coordinatorClient();
  assert.equal((await client.get('/monitoring/batches/999/edit')).status, 404);
  assert.equal((await client.post('/monitoring/batches/999/cancel', { reason: 'Test' })).status, 404);
  assert.equal((await client.post('/monitoring/batches/abc/edit', CORRECTED)).status, 404);
});

test('only the coordination can correct or cancel', async () => {
  const store = await env.createAccount({ role: 'STORE' });
  const batchId = await insertBatch(store.id);
  const visitor = env.client();
  assert.equal((await visitor.post(`/monitoring/batches/${batchId}/cancel`, { reason: 'Test' })).status, 401);
  assert.equal((await visitor.get(`/monitoring/batches/${batchId}/edit`)).status, 303);

  const client = env.client();
  await client.login(store.email, store.password);
  await client.get('/');
  assert.equal((await client.get(`/monitoring/batches/${batchId}/edit`)).status, 403);
  assert.equal((await client.post(`/monitoring/batches/${batchId}/edit`, CORRECTED)).status, 403);
  assert.equal((await client.post(`/monitoring/batches/${batchId}/cancel`, { reason: 'Test' })).status, 403);
  assert.equal((await env.db.query('SELECT status FROM batch WHERE id = $1', [batchId])).rows[0].status, 'DECLARED');
});

test('the status is checked before the input: an EXPIRED batch gives 409 even with invalid input', async () => {
  const store = await env.createAccount({ role: 'STORE' });
  const batchId = await insertBatch(store.id, 'EXPIRED');
  const { client } = await coordinatorClient();

  assert.equal((await client.post(`/monitoring/batches/${batchId}/edit`, { ...CORRECTED, weight_kg: '0' })).status, 409);
  assert.equal((await client.post(`/monitoring/batches/${batchId}/cancel`, { reason: '' })).status, 409);
});

test('changing the cold requirement of a RESERVED batch is refused if the association cannot keep it', async () => {
  const store = await env.createAccount({ role: 'STORE' });
  const association = await env.createAccount({ role: 'ASSOCIATION', cold_capacity: ['AMBIENT', 'CHILLED'] });
  const batchId = await insertBatch(store.id, 'RESERVED');
  await reserve(batchId, association.id);
  const { client } = await coordinatorClient();

  const refused = await client.post(`/monitoring/batches/${batchId}/edit`, { ...CORRECTED, cold_requirement: 'FROZEN' });
  assert.equal(refused.status, 409);
  assert.match(refused.body, /incompatible avec l’association/);
  assert.deepEqual(await history(batchId), []);

  const accepted = await client.post(`/monitoring/batches/${batchId}/edit`, { ...CORRECTED, cold_requirement: 'CHILLED' });
  assert.equal(accepted.status, 303);
  assert.equal((await history(batchId))[0].new_value, 'CHILLED');
});

test('history keeps the pickup slot as an instant with its offset', async () => {
  const store = await env.createAccount({ role: 'STORE' });
  const batchId = await insertBatch(store.id);
  const { client } = await coordinatorClient();

  await client.post(`/monitoring/batches/${batchId}/edit`, { ...CORRECTED, pickup_end: '2026-11-03T19:00' });
  const line = (await history(batchId)).find((entry) => entry.field === 'pickup_end');
  assert.deepEqual(
    [line.field, line.old_value, line.new_value],
    ['pickup_end', '2026-11-03T18:00+01:00', '2026-11-03T19:00+01:00'],
  );
});

test('cancelling while an association reserves leaves a CANCELLED batch without active reservation', async () => {
  const store = await env.createAccount({ role: 'STORE' });
  const association = await env.createAccount({ role: 'ASSOCIATION' });
  const batchId = await insertBatch(store.id);
  const { client: coordinator } = await coordinatorClient();
  const associationClient = env.client();
  await associationClient.login(association.email, association.password);
  await associationClient.get('/cold-capacity');

  // Le lot est verrouillé : les deux requêtes attendent, puis passent l'une après l'autre.
  let release;
  const released = new Promise((resolve) => { release = resolve; });
  const holding = env.db.withTransaction(async (lockClient) => {
    await lockClient.query('SELECT id FROM batch WHERE id = $1 FOR UPDATE', [batchId]);
    await released;
  });
  await new Promise((resolve) => setTimeout(resolve, 100));
  const pending = Promise.all([
    coordinator.post(`/monitoring/batches/${batchId}/cancel`, { reason: 'Doublon' }),
    associationClient.post(`/batches/${batchId}/reserve`, { reserved_by_name: 'Karim' }),
  ]);
  await new Promise((resolve) => setTimeout(resolve, 200));
  release();
  await holding;
  await pending;

  assert.equal((await env.db.query('SELECT status FROM batch WHERE id = $1', [batchId])).rows[0].status, 'CANCELLED');
  const { rows: [{ count }] } = await env.db.query(
    'SELECT count(*)::int AS count FROM reservation WHERE batch_id = $1 AND cancelled_at IS NULL',
    [batchId],
  );
  assert.equal(count, 0);
});
