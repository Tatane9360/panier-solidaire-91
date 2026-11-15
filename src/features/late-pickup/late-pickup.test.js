import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { setupTestApp } from '../../shared/testing.js';

let env;
before(async () => {
  env = await setupTestApp();
});
beforeEach(() => env.reset());
after(() => env.close());

// Le 5 novembre 10 h (Paris) : plus de 24 h après la fin du créneau.
const LATE = '2026-11-05T09:00:00Z';

let tokenCount = 0;
// Créneau du 3 novembre 14 h – 18 h (Paris) : la fenêtre de 24 h de l'association se ferme le 4 à 18 h.
// L'horloge est réglée avant la connexion : la session de la Coordination doit rester valable.
async function setup({ status = 'EXPIRED', reserved = true, reservationCancelled = false, now = LATE } = {}) {
  env.clock.set(now);
  const store = await env.createAccount({ role: 'STORE' });
  const association = await env.createAccount({ role: 'ASSOCIATION' });
  tokenCount += 1;
  const { rows: [{ id: batchId }] } = await env.db.query(
    `INSERT INTO batch (store_id, nature, quantity, quantity_unit, weight_kg, value_eur,
                        expiry_date, date_type, pickup_start, pickup_end, cold_requirement,
                        status, submission_token, created_at, expired_at)
     VALUES ($1, 'Pain', 4, 'cagettes', 12.5, 30, '2026-11-05', 'DLC',
             '2026-11-03T14:00+01', '2026-11-03T18:00+01', 'AMBIENT', $2, $3, '2026-11-02T09:00:00Z', '2026-11-03T18:05+01')
     RETURNING id`,
    [store.id, status, `token-${tokenCount}`],
  );
  if (reserved) {
    await env.db.query(
      `INSERT INTO reservation (batch_id, association_id, reserved_at, reserved_by_name, cancelled_at)
       VALUES ($1, $2, '2026-11-02T10:00:00Z', 'Awa', $3)`,
      [batchId, association.id, reservationCancelled ? '2026-11-02T11:00:00Z' : null],
    );
  }
  const coordinator = await env.createAccount({ role: 'COORDINATOR' });
  const client = env.client();
  await client.login(coordinator.email, coordinator.password);
  await client.get('/');
  return { store, association, coordinator, batchId, client };
}

const FORM = { collected_at: '2026-11-03T16:30', reason: 'Collecte faite mais non confirmée' };

const batchRow = async (batchId) => (await env.db.query(
  'SELECT status, collected_at, expired_at FROM batch WHERE id = $1', [batchId],
)).rows[0];

test('coordination records a late pickup: COLLECTED, entered date, expired_at kept, history and notification', async () => {
  const { store, coordinator, batchId, client } = await setup();
  const device = await env.subscribeDevice(store.id);

  const form = await client.get(`/monitoring/batches/${batchId}/late-pickup`);
  assert.equal(form.status, 200);
  assert.match(form.body, /name="reason"[^>]*required/);

  assert.equal((await client.post(`/monitoring/batches/${batchId}/late-pickup`, FORM)).status, 303);
  const batch = await batchRow(batchId);
  assert.equal(batch.status, 'COLLECTED');
  assert.deepEqual(batch.collected_at, new Date('2026-11-03T15:30:00Z'));
  assert.deepEqual(batch.expired_at, new Date('2026-11-03T17:05:00Z'));

  const { rows } = await env.db.query(
    'SELECT field, old_value, new_value, reason, changed_by FROM batch_history WHERE batch_id = $1 ORDER BY field',
    [batchId],
  );
  assert.deepEqual(rows, [
    { field: 'collected_at', old_value: null, new_value: '2026-11-03T16:30+01:00', reason: FORM.reason, changed_by: coordinator.id },
    { field: 'status', old_value: 'EXPIRED', new_value: 'COLLECTED', reason: FORM.reason, changed_by: coordinator.id },
  ]);
  const [push] = env.pushes.sent;
  assert.equal(push.endpoint, device);
  assert.equal(push.title, 'Votre lot a été collecté');
  assert.match(push.body, /03\/11\/2026 16:30/);
});

test('refuses a late pickup within 24 hours of the end of the slot: the association can still confirm', async () => {
  const { batchId, client } = await setup({ now: '2026-11-04T16:59:00Z' }); // 17 h 59 le 4 : 1 minute avant la fin de la fenêtre
  assert.equal((await client.post(`/monitoring/batches/${batchId}/late-pickup`, FORM)).status, 409);
  env.clock.advanceMinutes(1); // 18 h pile : la fenêtre est close
  assert.equal((await client.post(`/monitoring/batches/${batchId}/late-pickup`, FORM)).status, 303);
});

test('refuses an expired batch without active reservation, and any batch that is not EXPIRED', async () => {
  for (const options of [{ reserved: false }, { reservationCancelled: true }, { status: 'RESERVED' }, { status: 'COLLECTED' }, { status: 'CANCELLED' }]) {
    const { batchId, client } = await setup(options);
    assert.equal((await client.post(`/monitoring/batches/${batchId}/late-pickup`, FORM)).status, 409);
    assert.equal((await batchRow(batchId)).status, options.status ?? 'EXPIRED');
  }
  assert.equal(env.pushes.sent.length, 0);
});

test('the reason and a plausible pickup date are required', async () => {
  const { batchId, client } = await setup();
  const refused = [
    { ...FORM, reason: '  ' },
    { ...FORM, collected_at: '' },
    { ...FORM, collected_at: 'demain' },
    { ...FORM, collected_at: '2026-11-03T13:59' }, // avant le début du créneau
    { ...FORM, collected_at: '2026-11-05T10:01' }, // dans le futur
  ];
  for (const form of refused) {
    assert.equal((await client.post(`/monitoring/batches/${batchId}/late-pickup`, form)).status, 400);
  }
  assert.equal((await batchRow(batchId)).status, 'EXPIRED');
  assert.equal((await client.post(`/monitoring/batches/${batchId}/late-pickup`, { ...FORM, collected_at: '2026-11-05T10:00' })).status, 303);
});

test('a second submission is refused and sends no second notification', async () => {
  const { store, batchId, client } = await setup();
  await env.subscribeDevice(store.id);
  await client.post(`/monitoring/batches/${batchId}/late-pickup`, FORM);
  assert.equal((await client.post(`/monitoring/batches/${batchId}/late-pickup`, FORM)).status, 409);
  assert.equal(env.pushes.sent.length, 1);
});

test('monitoring links to the late pickup only for an expired batch with a reservation', async () => {
  const { batchId, client } = await setup();
  const { body } = await client.get('/monitoring/batches');
  assert.match(body, new RegExp(`href="/monitoring/batches/${batchId}/late-pickup"`));
  await setup({ reserved: false });
  const { body: other } = await client.get('/monitoring/batches');
  assert.equal(other.match(/late-pickup"/g).length, 1);
});

test('unknown batch gives 404 and other profiles get 401/403', async () => {
  const { store, batchId, client } = await setup();
  assert.equal((await client.get('/monitoring/batches/999/late-pickup')).status, 404);
  assert.equal((await client.post('/monitoring/batches/abc/late-pickup', FORM)).status, 404);

  assert.equal((await env.client().post(`/monitoring/batches/${batchId}/late-pickup`, FORM)).status, 401);
  assert.equal((await env.client().get(`/monitoring/batches/${batchId}/late-pickup`)).status, 303);
  const storeClient = env.client();
  await storeClient.login(store.email, store.password);
  await storeClient.get('/');
  assert.equal((await storeClient.get(`/monitoring/batches/${batchId}/late-pickup`)).status, 403);
  assert.equal((await storeClient.post(`/monitoring/batches/${batchId}/late-pickup`, FORM)).status, 403);
});
