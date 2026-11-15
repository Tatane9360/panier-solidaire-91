import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { setupTestApp } from '../../shared/testing.js';

let env;
before(async () => {
  env = await setupTestApp({ config: { issuer: { name: 'Panier Solidaire 91', address: '', registration: '' } } });
});
beforeEach(() => env.reset());
after(() => env.close());

let tokenCount = 0;
async function insertBatch(storeId, { nature = 'Pain', status = 'COLLECTED', collectedAt = '2026-11-10T12:00:00Z' } = {}) {
  tokenCount += 1;
  const { rows } = await env.db.query(
    `INSERT INTO batch (store_id, nature, quantity, quantity_unit, weight_kg, value_eur,
                        expiry_date, date_type, pickup_start, pickup_end, cold_requirement,
                        status, submission_token, created_at, collected_at, expired_at)
     VALUES ($1, $2, 4, 'cagettes', 10, 20, '2026-12-31', 'DLC',
             '2026-11-03T14:00+01', '2026-11-03T18:00+01', 'AMBIENT', $3, $4, '2026-11-02T09:00:00Z', $5, $6)
     RETURNING id`,
    [storeId, nature, status, `token-${tokenCount}`, status === 'COLLECTED' ? collectedAt : null,
      status === 'EXPIRED' ? '2026-11-03T18:05+01' : null],
  );
  return rows[0].id;
}

const NOVEMBER = { period_start: '2026-11-01', period_end: '2026-11-30' };

async function setup() {
  env.clock.set('2026-11-20T10:00:00Z');
  const store = await env.createAccount({ role: 'STORE' });
  const coordinator = await env.createAccount({ role: 'COORDINATOR' });
  const client = env.client();
  await client.login(coordinator.email, coordinator.password);
  await client.get('/');
  return { store, client };
}

const issue = async (client, store) => (await client.post('/certificates', { store_id: store.id, ...NOVEMBER })).location;
const cancel = (client, batchId, extra = {}) =>
  client.post(`/monitoring/batches/${batchId}/cancel`, { reason: 'Doublon', ...extra });
const certificates = async () => (await env.db.query(
  'SELECT id, number, status, replaced_by, total_weight_kg FROM donation_certificate ORDER BY id',
)).rows;
const frozenBatches = async (certificateId) => (await env.db.query(
  'SELECT batch_id FROM certificate_batch WHERE certificate_id = $1 ORDER BY batch_id', [certificateId],
)).rows.map((row) => row.batch_id);

test('cancelling a certified batch warns first and changes nothing until the coordination confirms', async () => {
  const { store, client } = await setup();
  const kept = await insertBatch(store.id, { nature: 'Pain' });
  const cancelled = await insertBatch(store.id, { nature: 'Lait' });
  await issue(client, store);

  const warning = await cancel(client, cancelled);
  assert.equal(warning.status, 200);
  assert.match(warning.body, /PS91-2026-0001/);
  assert.match(warning.body, /Confirmer : annule et remplace/);
  assert.equal((await env.db.query('SELECT status FROM batch WHERE id = $1', [cancelled])).rows[0].status, 'COLLECTED');
  assert.equal((await certificates()).length, 1);

  assert.equal((await cancel(client, cancelled, { confirm: 1 })).status, 303);
  const [old, replacement] = await certificates();
  assert.equal(old.status, 'REPLACED');
  assert.equal(old.replaced_by, replacement.id);
  assert.equal(replacement.status, 'ISSUED');
  assert.equal(replacement.number, 'PS91-2026-0002');
  assert.equal(Number(replacement.total_weight_kg), 10);
  assert.deepEqual(await frozenBatches(replacement.id), [kept]);
  // L'ancienne attestation n'est jamais modifiée : mêmes lots, même total.
  assert.deepEqual(await frozenBatches(old.id), [kept, cancelled]);
  assert.equal(Number(old.total_weight_kg), 20);
});

test('a late pickup inside the period of an issued certificate replaces it, and the store still reads the old one', async () => {
  const { store, client } = await setup();
  const first = await insertBatch(store.id);
  const late = await insertBatch(store.id, { status: 'EXPIRED' });
  await env.db.query(
    "INSERT INTO reservation (batch_id, association_id, reserved_at, reserved_by_name) VALUES ($1, $2, '2026-11-02T10:00:00Z', 'Awa')",
    [late, (await env.createAccount({ role: 'ASSOCIATION' })).id],
  );
  const oldLocation = await issue(client, store);
  const form = { collected_at: '2026-11-03T16:30', reason: 'Collecte faite mais non confirmée' };

  const warning = await client.post(`/monitoring/batches/${late}/late-pickup`, form);
  assert.equal(warning.status, 200);
  assert.match(warning.body, /PS91-2026-0001/);
  assert.equal((await env.db.query('SELECT status FROM batch WHERE id = $1', [late])).rows[0].status, 'EXPIRED');

  assert.equal((await client.post(`/monitoring/batches/${late}/late-pickup`, { ...form, confirm: 1 })).status, 303);
  const [old, replacement] = await certificates();
  assert.equal(old.status, 'REPLACED');
  assert.deepEqual(await frozenBatches(old.id), [first]);
  assert.deepEqual(await frozenBatches(replacement.id), [first, late]);

  const session = env.client();
  await session.login(store.email, store.password);
  const page = await session.get(oldLocation);
  assert.match(page.body, /remplacée/);
  assert.match(page.body, new RegExp(`href="/certificates/${replacement.id}"`));
});

test('cancelling the last batch of a certificate marks it REPLACED without an empty replacement', async () => {
  const { store, client } = await setup();
  const only = await insertBatch(store.id);
  await issue(client, store);

  assert.equal((await cancel(client, only, { confirm: 1 })).status, 303);
  const rows = await certificates();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, 'REPLACED');
  assert.equal(rows[0].replaced_by, null);
});

test('operations that do not change a certificate never warn', async () => {
  const { store, client } = await setup();
  await insertBatch(store.id);
  const declared = await insertBatch(store.id, { status: 'DECLARED' });
  const otherStore = await env.createAccount({ role: 'STORE' });
  const elsewhere = await insertBatch(otherStore.id);
  await issue(client, store);

  assert.equal((await cancel(client, declared)).status, 303);
  assert.equal((await cancel(client, elsewhere)).status, 303);
  assert.equal((await certificates()).length, 1);
  assert.equal((await certificates())[0].status, 'ISSUED');
});
