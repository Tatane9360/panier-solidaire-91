import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { setupTestApp } from '../../shared/testing.js';

let env;
before(async () => {
  env = await setupTestApp({
    config: { issuer: { name: 'Panier Solidaire 91', address: '2 place de la Coordination, 91000 Évry', registration: 'RNA W911000000' } },
  });
});
beforeEach(() => env.reset());
after(() => env.close());

let tokenCount = 0;
async function insertBatch(storeId, { nature = 'Pain', status = 'COLLECTED', collectedAt = '2026-11-10T12:00:00Z', weight = 12.5, value = 30 } = {}) {
  tokenCount += 1;
  const { rows } = await env.db.query(
    `INSERT INTO batch (store_id, nature, quantity, quantity_unit, weight_kg, value_eur,
                        expiry_date, date_type, pickup_start, pickup_end, cold_requirement,
                        status, submission_token, created_at, collected_at)
     VALUES ($1, $2, 4, 'cagettes', $3, $4, '2026-12-31', 'DLC',
             '2026-11-03T14:00+01', '2026-11-03T18:00+01', 'AMBIENT', $5, $6, '2026-11-02T09:00:00Z', $7)
     RETURNING id`,
    [storeId, nature, weight, value, status, `token-${tokenCount}`, status === 'COLLECTED' ? collectedAt : null],
  );
  return rows[0].id;
}

async function coordinatorClient() {
  const coordinator = await env.createAccount({ role: 'COORDINATOR' });
  const client = env.client();
  await client.login(coordinator.email, coordinator.password);
  await client.get('/');
  return { client, coordinator };
}

const NOVEMBER = { period_start: '2026-11-01', period_end: '2026-11-30' };
const issue = (client, store, period = NOVEMBER, extra = {}) =>
  client.post('/certificates', { store_id: store.id, ...period, ...extra });

const certificates = async () => (await env.db.query(
  'SELECT id, number, status, total_weight_kg, total_value_eur FROM donation_certificate ORDER BY id',
)).rows;

test('certificate lists the COLLECTED batches of the store whose collected_at is in the period, bounds included', async () => {
  const store = await env.createAccount({ role: 'STORE', organization_name: 'Primeur du Marché', address: '5 rue du Four, 91000 Évry' });
  const other = await env.createAccount({ role: 'STORE' });
  // Les bornes sont en heure de Paris : 1er novembre 00:00 (= 31 octobre 23:00 UTC) est inclus, 1er décembre 00:00 est exclu.
  await insertBatch(store.id, { nature: 'Début de période', collectedAt: '2026-10-31T23:00:00Z', weight: 10, value: 20 });
  await insertBatch(store.id, { nature: 'Fin de période', collectedAt: '2026-11-30T22:59:00Z', weight: 2.25, value: 5.5 });
  await insertBatch(store.id, { nature: 'Avant la période', collectedAt: '2026-10-31T22:59:00Z' });
  await insertBatch(store.id, { nature: 'Après la période', collectedAt: '2026-11-30T23:00:00Z' });
  await insertBatch(store.id, { nature: 'Pas collecté', status: 'EXPIRED' });
  await insertBatch(other.id, { nature: 'Autre commerce' });
  const { client, coordinator } = await coordinatorClient();

  const response = await issue(client, store);
  assert.equal(response.status, 303);
  const [certificate] = await certificates();
  assert.equal(response.location, `/certificates/${certificate.id}`);
  assert.equal(certificate.number, 'PS91-2026-0001');
  assert.equal(Number(certificate.total_weight_kg), 12.25);
  assert.equal(Number(certificate.total_value_eur), 25.5);
  assert.equal((await env.db.query('SELECT issued_by FROM donation_certificate')).rows[0].issued_by, coordinator.id);

  const { body } = await client.get(response.location);
  assert.match(body, /Début de période/);
  assert.match(body, /Fin de période/);
  for (const absent of ['Avant la période', 'Après la période', 'Pas collecté', 'Autre commerce']) {
    assert.doesNotMatch(body, new RegExp(absent));
  }
});

test('certificate shows both identities, the period, the totals and the issue date', async () => {
  const store = await env.createAccount({ role: 'STORE', organization_name: 'Primeur du Marché', address: '5 rue du Four, 91000 Évry' });
  await insertBatch(store.id, { weight: 12.25, value: 30 });
  const { client } = await coordinatorClient();

  const { location } = await issue(client, store);
  const { status, body } = await client.get(location);
  assert.equal(status, 200);
  assert.match(body, /PS91-2026-0001/);
  assert.match(body, /Primeur du Marché/);
  assert.match(body, /5 rue du Four, 91000 Évry/);
  assert.match(body, /Panier Solidaire 91/);
  assert.match(body, /2 place de la Coordination/);
  assert.match(body, /RNA W911000000/);
  assert.match(body, /du 01\/11\/2026 au 30\/11\/2026/);
  assert.match(body, /Poids total[^]*12,3 kg/);
  assert.match(body, /Valeur totale[^]*30,00 €/);
  assert.match(body, /Émise le 02\/11\/2026/);
});

test('numbers follow a sequence that restarts every year of issue, in Paris time', async () => {
  const store = await env.createAccount({ role: 'STORE' });
  await insertBatch(store.id);
  const { client } = await coordinatorClient();

  await issue(client, store);
  await issue(client, store, NOVEMBER, { confirm: '1' });
  // 23 h 30 UTC le 31 décembre = 00 h 30 le 1er janvier à Paris : déjà 2027.
  env.clock.set('2026-12-31T23:30:00Z');
  const { client: later } = await coordinatorClient();
  await later.post('/certificates', { store_id: store.id, ...NOVEMBER, confirm: '1' });
  await later.post('/certificates', { store_id: store.id, ...NOVEMBER, confirm: '1' });
  assert.deepEqual((await certificates()).map((row) => row.number), [
    'PS91-2026-0001', 'PS91-2026-0002', 'PS91-2027-0001', 'PS91-2027-0002',
  ]);
});

test('nature, quantity, weight and value are frozen: correcting the batch later does not change the certificate', async () => {
  const store = await env.createAccount({ role: 'STORE' });
  const batchId = await insertBatch(store.id, { weight: 12.5, value: 30 });
  const { client } = await coordinatorClient();
  const { location } = await issue(client, store);
  const before = (await client.get(location)).body;

  await env.db.query("UPDATE batch SET nature = 'Autre chose', quantity = 77, quantity_unit = 'palettes', weight_kg = 99, value_eur = 999 WHERE id = $1", [batchId]);

  assert.equal((await client.get(location)).body, before);
  const { rows: [line] } = await env.db.query('SELECT weight_kg, value_eur FROM certificate_batch WHERE batch_id = $1', [batchId]);
  assert.deepEqual([Number(line.weight_kg), Number(line.value_eur)], [12.5, 30]);
  assert.match(before, /Pain/);
  assert.doesNotMatch(before, /Autre chose|palettes/);
});

test('an overlapping ISSUED certificate gives a warning listing the batches of the period already certified, then can be confirmed', async () => {
  const store = await env.createAccount({ role: 'STORE' });
  await insertBatch(store.id, { nature: 'Hors nouvelle période', collectedAt: '2026-11-05T12:00:00Z' });
  await insertBatch(store.id, { nature: 'Déjà attesté', collectedAt: '2026-11-09T12:00:00Z' });
  await insertBatch(store.id, { nature: 'Nouveau lot', collectedAt: '2026-11-20T12:00:00Z' });
  const { client } = await coordinatorClient();
  await issue(client, store, { period_start: '2026-11-01', period_end: '2026-11-10' });

  const warning = await issue(client, store, { period_start: '2026-11-08', period_end: '2026-11-30' });
  assert.equal(warning.status, 200);
  assert.match(warning.body, /PS91-2026-0001/);
  assert.match(warning.body, /Déjà attesté/);
  assert.doesNotMatch(warning.body, /Hors nouvelle période|Nouveau lot/);
  assert.equal((await certificates()).length, 1);

  const confirmed = await issue(client, store, { period_start: '2026-11-08', period_end: '2026-11-30' }, { confirm: '1' });
  assert.equal(confirmed.status, 303);
  assert.equal((await certificates()).length, 2);
});

test('overlapping periods without any batch in common still give a warning, saying so', async () => {
  const store = await env.createAccount({ role: 'STORE' });
  await insertBatch(store.id, { collectedAt: '2026-11-05T12:00:00Z' });
  await insertBatch(store.id, { nature: 'Nouveau lot', collectedAt: '2026-11-20T12:00:00Z' });
  const { client } = await coordinatorClient();
  await issue(client, store, { period_start: '2026-11-01', period_end: '2026-11-10' });

  const warning = await issue(client, store, { period_start: '2026-11-08', period_end: '2026-11-30' });
  assert.equal(warning.status, 200);
  assert.match(warning.body, /Aucun lot de cette période n’est déjà attesté/);
});

test('REPLACED certificates and other stores are ignored by the overlap warning', async () => {
  const store = await env.createAccount({ role: 'STORE' });
  const other = await env.createAccount({ role: 'STORE' });
  await insertBatch(store.id);
  await insertBatch(other.id);
  const { client } = await coordinatorClient();
  await issue(client, other);
  await issue(client, store);
  await env.db.query("UPDATE donation_certificate SET status = 'REPLACED' WHERE store_id = $1", [store.id]);

  assert.equal((await issue(client, store)).status, 303);
});

test('refuses a period without any collected batch, an invalid period and an account that is not a store', async () => {
  const store = await env.createAccount({ role: 'STORE' });
  const association = await env.createAccount({ role: 'ASSOCIATION' });
  await insertBatch(store.id);
  const { client } = await coordinatorClient();

  const empty = await issue(client, store, { period_start: '2027-01-01', period_end: '2027-01-31' });
  assert.equal(empty.status, 400);
  assert.match(empty.body, /Aucun lot collecté/);
  for (const period of [
    { period_start: '', period_end: '2026-11-30' },
    { period_start: 'bientôt', period_end: '2026-11-30' },
    { period_start: '2026-11-30', period_end: '2026-11-01' },
  ]) {
    assert.equal((await issue(client, store, period)).status, 400);
  }
  assert.equal((await issue(client, association)).status, 400);
  assert.equal((await client.post('/certificates', { store_id: 'abc', ...NOVEMBER })).status, 400);
  assert.equal((await certificates()).length, 0);
});

test('two simultaneous issues get two different numbers', async () => {
  const storeA = await env.createAccount({ role: 'STORE' });
  const storeB = await env.createAccount({ role: 'STORE' });
  await insertBatch(storeA.id);
  await insertBatch(storeB.id);
  const { client: clientA } = await coordinatorClient();
  const { client: clientB } = await coordinatorClient();

  const responses = await Promise.all([issue(clientA, storeA), issue(clientB, storeB)]);
  assert.deepEqual(responses.map((response) => response.status), [303, 303]);
  assert.deepEqual((await certificates()).map((row) => row.number).sort(), ['PS91-2026-0001', 'PS91-2026-0002']);
});

test('only the coordination can issue or read a certificate', async () => {
  const store = await env.createAccount({ role: 'STORE' });
  await insertBatch(store.id);
  const { client } = await coordinatorClient();
  const { location } = await issue(client, store);

  assert.equal((await client.get('/certificates/999')).status, 404);
  assert.equal((await client.get('/certificates/abc')).status, 404);
  assert.equal((await client.get('/certificates/new')).status, 200);

  assert.equal((await env.client().post('/certificates', { store_id: store.id, ...NOVEMBER })).status, 401);
  assert.equal((await env.client().get('/certificates/new')).status, 303);
  assert.equal((await env.client().get(location)).status, 303);
  for (const account of [store, await env.createAccount({ role: 'ASSOCIATION' })]) {
    const other = env.client();
    await other.login(account.email, account.password);
    await other.get('/');
    assert.equal((await other.get('/certificates/new')).status, 403);
    if (account.role !== 'STORE') assert.equal((await other.get(location)).status, 403);
    assert.equal((await other.post('/certificates', { store_id: store.id, ...NOVEMBER })).status, 403);
  }
  assert.equal((await certificates()).length, 1);
});

test('period bounds follow Paris summer time (UTC+2): July 1st 00:00 is included, August 1st 00:00 is not', async () => {
  const store = await env.createAccount({ role: 'STORE' });
  await insertBatch(store.id, { nature: 'Début juillet', collectedAt: '2026-06-30T22:00:00Z' });
  await insertBatch(store.id, { nature: 'Fin juillet', collectedAt: '2026-07-31T21:59:00Z' });
  await insertBatch(store.id, { nature: 'Fin juin', collectedAt: '2026-06-30T21:59:00Z' });
  await insertBatch(store.id, { nature: 'Début août', collectedAt: '2026-07-31T22:00:00Z' });
  const { client } = await coordinatorClient();

  const { location } = await issue(client, store, { period_start: '2026-07-01', period_end: '2026-07-31' });
  const { body } = await client.get(location);
  assert.match(body, /Début juillet/);
  assert.match(body, /Fin juillet/);
  assert.doesNotMatch(body, /Fin juin|Début août/);
});

async function storeClient(store) {
  const client = env.client();
  await client.login(store.email, store.password);
  await client.get('/');
  return client;
}

test('a store lists and prints its own certificates, never those of another store', async () => {
  const store = await env.createAccount({ role: 'STORE', organization_name: 'Primeur du Marché' });
  const other = await env.createAccount({ role: 'STORE', organization_name: 'Boulangerie Voisine' });
  await insertBatch(store.id, { nature: 'Pain à moi' });
  await insertBatch(other.id, { nature: 'Pain des autres' });
  const { client } = await coordinatorClient();
  const mine = (await issue(client, store)).location;
  const theirs = (await issue(client, other)).location;

  const storeSession = await storeClient(store);
  const list = await storeSession.get('/certificates');
  assert.equal(list.status, 200);
  assert.match(list.body, /PS91-2026-0001/);
  assert.match(list.body, new RegExp(`href="${mine}"`));
  assert.doesNotMatch(list.body, /PS91-2026-0002/);

  const own = await storeSession.get(mine);
  assert.equal(own.status, 200);
  assert.match(own.body, /Pain à moi/);
  // Même réponse que pour un identifiant inexistant : on ne révèle pas l'existence.
  assert.equal((await storeSession.get(theirs)).status, 404);
  assert.equal((await storeSession.get(theirs)).body, (await storeSession.get('/certificates/999')).body);
});

test('the certificate list is for stores only', async () => {
  assert.equal((await env.client().get('/certificates')).status, 303);
  const { client } = await coordinatorClient();
  assert.equal((await client.get('/certificates')).status, 403);
  const association = await env.createAccount({ role: 'ASSOCIATION' });
  assert.equal((await (await storeClient(association)).get('/certificates')).status, 403);
});

test('a REPLACED certificate stays readable, marked replaced, with a link to its replacement', async () => {
  const store = await env.createAccount({ role: 'STORE' });
  await insertBatch(store.id);
  const { client } = await coordinatorClient();
  const oldLocation = (await issue(client, store)).location;
  const newLocation = (await issue(client, store, NOVEMBER, { confirm: 1 })).location;
  const oldId = oldLocation.split('/').pop();
  const newId = newLocation.split('/').pop();
  await env.db.query("UPDATE donation_certificate SET status = 'REPLACED', replaced_by = $2 WHERE id = $1", [oldId, newId]);

  const session = await storeClient(store);
  const page = await session.get(oldLocation);
  assert.equal(page.status, 200);
  assert.match(page.body, /remplacée/);
  assert.match(page.body, new RegExp(`href="${newLocation}"`));
  assert.match((await session.get('/certificates')).body, /remplacée/);
  assert.doesNotMatch((await session.get(newLocation)).body, /remplacée/);
});
