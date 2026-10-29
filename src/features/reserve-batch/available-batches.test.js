import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
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
    expiry_date: '2026-11-05',
    pickup_start: '2026-11-03T14:00',
    pickup_end: '2026-11-03T18:00',
    cold_requirement: 'AMBIENT',
    status: 'DECLARED',
    ...fields,
  };
  tokenCount += 1;
  await env.db.query(
    `INSERT INTO batch (store_id, nature, quantity, quantity_unit, weight_kg, value_eur,
                        expiry_date, date_type, pickup_start, pickup_end, cold_requirement,
                        status, submission_token, created_at)
     VALUES ($1, $2, 4, 'cagettes', 12.5, 30, $3, 'DLC',
             $4::timestamp AT TIME ZONE 'Europe/Paris', $5::timestamp AT TIME ZONE 'Europe/Paris',
             $6, $7, $8, $9)`,
    [storeId, batch.nature, batch.expiry_date, batch.pickup_start, batch.pickup_end,
      batch.cold_requirement, batch.status, `token-${tokenCount}`, env.clock.now()],
  );
}

async function setup() {
  const store = await env.createAccount({
    role: 'STORE',
    organization_name: 'Primeur du Marché',
    address: '3 place du Marché, 91100 Corbeil-Essonnes',
  });
  const association = await env.createAccount({ role: 'ASSOCIATION' });
  const client = env.client();
  await client.login(association.email, association.password);
  return { store, association, client };
}

test('association sees available batches with their details and the store', async () => {
  const { store, client } = await setup();
  await insertBatch(store.id);

  const { status, body } = await client.get('/available-batches');
  assert.equal(status, 200);
  assert.match(body, /Fruits et légumes/);
  assert.match(body, /4 cagettes/);
  assert.match(body, /12,5 kg/);
  assert.match(body, /DLC 05\/11\/2026/);
  assert.match(body, /du 03\/11\/2026 14:00 au 03\/11\/2026 18:00/);
  assert.match(body, /Froid<\/dt><dd>Ambiant/);
  assert.match(body, /Primeur du Marché/);
  assert.match(body, /3 place du Marché, 91100 Corbeil-Essonnes/);
});

test('available batches are sorted by expiry date ascending', async () => {
  const { store, client } = await setup();
  await insertBatch(store.id, { nature: 'Lot du 5', expiry_date: '2026-11-05' });
  await insertBatch(store.id, { nature: 'Lot du 3', expiry_date: '2026-11-03' });
  await insertBatch(store.id, { nature: 'Lot du 4', expiry_date: '2026-11-04' });

  const { body } = await client.get('/available-batches');
  const order = ['Lot du 3', 'Lot du 4', 'Lot du 5'].map((nature) => body.indexOf(nature));
  assert.ok(order.every((index) => index > -1), 'tous les lots sont listés');
  assert.deepEqual([...order].sort((a, b) => a - b), order);
});

test('only DECLARED batches are available', async () => {
  const { store, client } = await setup();
  for (const status of ['RESERVED', 'COLLECTED', 'CANCELLED', 'EXPIRED']) {
    await insertBatch(store.id, { nature: `Lot ${status}`, status });
  }
  await insertBatch(store.id, { nature: 'Lot DECLARED' });

  const { body } = await client.get('/available-batches');
  assert.match(body, /Lot DECLARED/);
  assert.doesNotMatch(body, /Lot (RESERVED|COLLECTED|CANCELLED|EXPIRED)/);
});

test('a batch whose pickup slot has passed is not available, even before the scheduler expires it', async () => {
  const { store, client } = await setup();
  await insertBatch(store.id, { pickup_start: '2026-11-02T14:00', pickup_end: '2026-11-02T18:00' });

  assert.match((await client.get('/available-batches')).body, /Fruits et légumes/);
  // 18 h à Paris = 17 h UTC ; le lot reste DECLARED en base.
  env.clock.set('2026-11-02T17:00:00Z');
  assert.doesNotMatch((await client.get('/available-batches')).body, /Fruits et légumes/);
});

test('a batch whose expiry date has passed is not available', async () => {
  const { store, client } = await setup();
  // Cas impossible à la déclaration, mais possible par une correction de la Coordination.
  await insertBatch(store.id, { expiry_date: '2026-11-01' });

  assert.doesNotMatch((await client.get('/available-batches')).body, /Fruits et légumes/);
});

test('cold capacity page offers AMBIENT, CHILLED and FROZEN boxes in a fieldset, AMBIENT alone by default', async () => {
  const { client } = await setup();

  const { status, body } = await client.get('/cold-capacity');
  assert.equal(status, 200);
  assert.match(body, /<fieldset[\s\S]*<legend[\s\S]*<\/fieldset>/);
  const boxes = [...body.matchAll(/<input[^>]*name="cold_capacity"[^>]*>/g)].map(([input]) => input);
  assert.deepEqual(boxes.map((input) => input.match(/value="(\w+)"/)[1]), ['AMBIENT', 'CHILLED', 'FROZEN']);
  assert.deepEqual(boxes.map((input) => input.includes(' checked')), [true, false, false]);
});

test('association changes its cold capacity at any time', async () => {
  const { association, client } = await setup();
  await client.get('/cold-capacity');

  const saved = await client.post('/cold-capacity', { cold_capacity: ['AMBIENT', 'FROZEN'] });
  assert.equal(saved.status, 303);
  const page = await client.get(saved.location);
  assert.match(page.body, /Capacité de froid enregistrée/);
  assert.match(page.body, /value="FROZEN" checked/);

  await client.post('/cold-capacity', { cold_capacity: ['CHILLED', 'CHILLED'] });
  const { rows } = await env.db.query('SELECT cold_capacity FROM account WHERE id = $1', [association.id]);
  assert.deepEqual(rows[0].cold_capacity, ['CHILLED']);
});

test('cold capacity rejects an unknown cold level', async () => {
  const { association, client } = await setup();
  await client.get('/cold-capacity');

  for (const level of ['HOT', 'toString']) {
    const { status } = await client.post('/cold-capacity', { cold_capacity: ['AMBIENT', level] });
    assert.equal(status, 400, level);
  }
  const { rows } = await env.db.query('SELECT cold_capacity FROM account WHERE id = $1', [association.id]);
  assert.deepEqual(rows[0].cold_capacity, ['AMBIENT']);
});

test('cold capacity requires at least one cold level and keeps the previous one', async () => {
  const { association, client } = await setup();
  await client.get('/cold-capacity');

  const { status, body } = await client.post('/cold-capacity', {});
  assert.equal(status, 400);
  assert.match(body, /Cochez au moins une case/);
  assert.match(body, /value="AMBIENT" checked/);
  const { rows } = await env.db.query('SELECT cold_capacity FROM account WHERE id = $1', [association.id]);
  assert.deepEqual(rows[0].cold_capacity, ['AMBIENT']);
});

test('available batches are filtered by cold capacity by default', async () => {
  const { store, client } = await setup();
  await insertBatch(store.id, { nature: 'Pain', cold_requirement: 'AMBIENT' });
  await insertBatch(store.id, { nature: 'Yaourts', cold_requirement: 'CHILLED' });

  const filtered = await client.get('/available-batches');
  assert.match(filtered.body, /Pain/);
  assert.doesNotMatch(filtered.body, /Yaourts/);

  await client.get('/cold-capacity');
  await client.post('/cold-capacity', { cold_capacity: ['AMBIENT', 'CHILLED'] });
  assert.match((await client.get('/available-batches')).body, /Yaourts/);
});

test('association can turn off the cold capacity filter', async () => {
  const { store, client } = await setup();
  await insertBatch(store.id, { nature: 'Pain', cold_requirement: 'AMBIENT' });
  await insertBatch(store.id, { nature: 'Glaces', cold_requirement: 'FROZEN' });

  const filtered = await client.get('/available-batches');
  assert.match(filtered.body, /href="\/available-batches\?all=1"/);

  const all = await client.get('/available-batches?all=1');
  assert.match(all.body, /Pain/);
  assert.match(all.body, /Glaces/);
  // Le froid est écrit en toutes lettres, pas porté par la couleur seule.
  assert.match(all.body, /Froid<\/dt><dd>Surgelé/);
  assert.match(all.body, /Incompatible avec votre capacité de froid/);
  assert.match(all.body, /href="\/available-batches"/);
});

test('other profiles get 403 on available batches and cold capacity', async () => {
  for (const role of ['STORE', 'COORDINATOR']) {
    const account = await env.createAccount({ role });
    const client = env.client();
    await client.login(account.email, account.password);
    assert.equal((await client.get('/available-batches')).status, 403, role);
    assert.equal((await client.get('/cold-capacity')).status, 403, role);
    assert.equal((await client.post('/cold-capacity', { cold_capacity: 'FROZEN' })).status, 403, role);
  }
});

test('without a session, available batches redirect to login and saving cold capacity gets 401', async () => {
  const client = env.client();
  const page = await client.get('/available-batches');
  assert.equal(page.status, 303);
  assert.equal(page.location, '/login');
  assert.equal((await client.post('/cold-capacity', { cold_capacity: 'FROZEN' })).status, 401);
});

test('association home page links to available batches and cold capacity', async () => {
  const { client } = await setup();
  const { body } = await client.get('/');
  assert.match(body, /href="\/available-batches"/);
  assert.match(body, /href="\/cold-capacity"/);
});
