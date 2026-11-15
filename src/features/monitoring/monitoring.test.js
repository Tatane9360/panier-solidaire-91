import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { setupTestApp } from '../../shared/testing.js';

let env;
before(async () => {
  env = await setupTestApp({ config: { pageSize: 2 } });
});
beforeEach(() => env.reset());
after(() => env.close());

let tokenCount = 0;
async function insertBatch(storeId, { nature, status = 'DECLARED', createdAt = '2026-11-02T09:00:00Z' }) {
  tokenCount += 1;
  const { rows } = await env.db.query(
    `INSERT INTO batch (store_id, nature, quantity, quantity_unit, weight_kg, value_eur,
                        expiry_date, date_type, pickup_start, pickup_end, cold_requirement,
                        status, submission_token, created_at)
     VALUES ($1, $2, 4, 'cagettes', 12.5, 30, '2026-11-05', 'DLC',
             '2026-11-03T14:00+01', '2026-11-03T18:00+01', 'AMBIENT', $3, $4, $5)
     RETURNING id`,
    [storeId, nature, status, `token-${tokenCount}`, createdAt],
  );
  return rows[0].id;
}

async function reserve(batchId, associationId, { cancelled = false } = {}) {
  await env.db.query(
    `INSERT INTO reservation (batch_id, association_id, reserved_at, reserved_by_name, cancelled_at)
     VALUES ($1, $2, '2026-11-02T10:00:00Z', 'Awa', $3)`,
    [batchId, associationId, cancelled ? '2026-11-02T11:00:00Z' : null],
  );
}

async function coordinatorClient() {
  const coordinator = await env.createAccount({ role: 'COORDINATOR' });
  const client = env.client();
  await client.login(coordinator.email, coordinator.password);
  return client;
}

test('coordinator sees all batches of every status', async () => {
  const store = await env.createAccount({ role: 'STORE', organization_name: 'Primeur du Marché' });
  const statuses = ['DECLARED', 'RESERVED', 'COLLECTED', 'CANCELLED', 'EXPIRED'];
  for (const [index, status] of statuses.entries()) {
    await insertBatch(store.id, { nature: `Lot ${status}`, status, createdAt: `2026-11-0${index + 1}T09:00:00Z` });
  }
  const client = await coordinatorClient();

  // La page fait 2 lots dans ce fichier de tests : 3 pages pour 5 lots.
  let bodies = '';
  for (const pageNumber of [1, 2, 3]) {
    const { status, body } = await client.get(`/monitoring/batches?page=${pageNumber}`);
    assert.equal(status, 200);
    bodies += body;
  }
  assert.match(bodies, /5 lots/);
  for (const status of statuses) assert.match(bodies, new RegExp(`Lot ${status}`));
  assert.match(bodies, /Primeur du Marché/);
  assert.match(bodies, /Créneau du 03\/11\/2026 14:00 au 03\/11\/2026 18:00/);
});

test('monitoring shows the association of an active reservation only', async () => {
  const store = await env.createAccount({ role: 'STORE' });
  const active = await env.createAccount({ role: 'ASSOCIATION', organization_name: 'Entraide 91' });
  const former = await env.createAccount({ role: 'ASSOCIATION', organization_name: 'Ancienne Asso' });
  await reserve(await insertBatch(store.id, { nature: 'Lot réservé', status: 'RESERVED' }), active.id);
  await reserve(await insertBatch(store.id, { nature: 'Lot annulé' }), former.id, { cancelled: true });
  const client = await coordinatorClient();

  const { body } = await client.get('/monitoring/batches');
  assert.match(body, /<td class="p-2">Entraide 91<\/td>/);
  assert.doesNotMatch(body, /<td class="p-2">Ancienne Asso<\/td>/);
  assert.match(body, /Réservé le 02\/11\/2026 11:00/);
});

test('monitoring filters by store, association and status', async () => {
  const storeA = await env.createAccount({ role: 'STORE' });
  const storeB = await env.createAccount({ role: 'STORE' });
  const association = await env.createAccount({ role: 'ASSOCIATION' });
  await insertBatch(storeA.id, { nature: 'Lot A déclaré' });
  const reserved = await insertBatch(storeB.id, { nature: 'Lot B réservé', status: 'RESERVED' });
  await reserve(reserved, association.id);
  const client = await coordinatorClient();

  const byStore = (await client.get(`/monitoring/batches?store=${storeA.id}`)).body;
  assert.match(byStore, /Lot A déclaré/);
  assert.doesNotMatch(byStore, /Lot B réservé/);

  const byAssociation = (await client.get(`/monitoring/batches?association=${association.id}`)).body;
  assert.match(byAssociation, /Lot B réservé/);
  assert.doesNotMatch(byAssociation, /Lot A déclaré/);

  const byStatus = (await client.get('/monitoring/batches?status=DECLARED')).body;
  assert.match(byStatus, /Lot A déclaré/);
  assert.doesNotMatch(byStatus, /Lot B réservé/);
});

test('monitoring filters by declaration period in Paris time, bounds included', async () => {
  const store = await env.createAccount({ role: 'STORE' });
  // Paris est en UTC+1 en novembre : 31 oct. 23 h 30 = 22 h 30 UTC, 1er nov. 23 h 30 = 22 h 30 UTC,
  // 3 nov. 00 h 30 = 2 nov. 23 h 30 UTC.
  await insertBatch(store.id, { nature: 'Avant', createdAt: '2026-10-31T22:30:00Z' });
  await insertBatch(store.id, { nature: 'Premier jour', createdAt: '2026-11-01T22:30:00Z' });
  await insertBatch(store.id, { nature: 'Dernier jour', createdAt: '2026-11-02T22:30:00Z' });
  await insertBatch(store.id, { nature: 'Après', createdAt: '2026-11-02T23:30:00Z' });
  const client = await coordinatorClient();

  const { body } = await client.get('/monitoring/batches?from=2026-11-01&to=2026-11-02&page=1');
  assert.match(body, /2 lots/);
  assert.match(body, /Premier jour/);
  assert.match(body, /Dernier jour/);
  assert.doesNotMatch(body, /Avant|Après/);
});

test('monitoring paginates with the configured page size and keeps the filters in the links', async () => {
  const store = await env.createAccount({ role: 'STORE' });
  for (let i = 1; i <= 5; i += 1) {
    await insertBatch(store.id, { nature: `Lot ${i}`, createdAt: `2026-11-0${i}T09:00:00Z` });
  }
  const client = await coordinatorClient();

  const first = (await client.get('/monitoring/batches?status=DECLARED')).body;
  assert.match(first, /5 lots/);
  assert.match(first, /Page 1 sur 3/);
  assert.match(first, /Lot 5/);
  assert.match(first, /Lot 4/);
  assert.doesNotMatch(first, /Lot 3/);
  assert.match(first, /href="\/monitoring\/batches\?status=DECLARED&amp;page=2"/);

  const last = (await client.get('/monitoring/batches?status=DECLARED&page=3')).body;
  assert.match(last, /Lot 1/);
  assert.doesNotMatch(last, /Page suivante/);
});

test('monitoring shows the last page when the requested page is past the end', async () => {
  const store = await env.createAccount({ role: 'STORE' });
  for (let i = 1; i <= 3; i += 1) {
    await insertBatch(store.id, { nature: `Lot ${i}`, createdAt: `2026-11-0${i}T09:00:00Z` });
  }
  const client = await coordinatorClient();

  const { status, body } = await client.get('/monitoring/batches?page=99');
  assert.equal(status, 200);
  assert.match(body, /Page 2 sur 2/);
  assert.match(body, /Lot 1/);
  assert.doesNotMatch(body, /Aucun lot ne correspond/);
});

test('monitoring refuses invalid filters', async () => {
  const client = await coordinatorClient();
  for (const query of ['status=INCONNU', 'from=demain', 'store=abc', 'page=0']) {
    assert.equal((await client.get(`/monitoring/batches?${query}`)).status, 400, query);
  }
});

test('monitoring is reserved to the coordination', async () => {
  const anonymous = await env.client().get('/monitoring/batches');
  assert.equal(anonymous.status, 303);
  assert.equal(anonymous.location, '/login');

  for (const role of ['STORE', 'ASSOCIATION']) {
    const account = await env.createAccount({ role });
    const client = env.client();
    await client.login(account.email, account.password);
    assert.equal((await client.get('/monitoring/batches')).status, 403, role);
  }
});
