import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { setupTestApp } from '../../shared/testing.js';
import { expireEndedBatches } from '../../shared/expiration.js';

let env;
before(async () => {
  env = await setupTestApp();
});
beforeEach(() => env.reset());
after(() => env.close());

async function loggedIn(account) {
  const client = env.client();
  await client.login(account.email, account.password);
  return client;
}

// L'horloge de test démarre le 2 novembre 2026 à 10 h (heure de Paris).
// Lot réservé par l'association, créneau du 2 novembre de 8 h à 10 h 20.
async function setup() {
  const store = await env.createAccount({ role: 'STORE' });
  const association = await env.createAccount({ role: 'ASSOCIATION' });
  const { rows: [{ id: batchId }] } = await env.db.query(
    `INSERT INTO batch (store_id, nature, quantity, quantity_unit, weight_kg, value_eur,
                        expiry_date, date_type, pickup_start, pickup_end, cold_requirement,
                        status, submission_token, created_at)
     VALUES ($1, 'Fruits et légumes', 4, 'cagettes', 12.5, 30, '2026-11-05', 'DLC',
             '2026-11-02T07:00:00Z', '2026-11-02T09:20:00Z', 'AMBIENT', 'RESERVED', 'token', $2)
     RETURNING id`,
    [store.id, env.clock.now()],
  );
  await env.db.query(
    `INSERT INTO reservation (batch_id, association_id, reserved_at, reserved_by_name)
     VALUES ($1, $2, $3, 'Karim')`,
    [batchId, association.id, env.clock.now()],
  );
  return { store, association, batchId, client: await associationClient(association) };
}

// À rappeler après un saut d'horloge : la session expire après 30 min d'inactivité.
async function associationClient(association) {
  const client = await loggedIn(association);
  // Le formulaire de capacité de froid fournit le jeton CSRF, même sans réservation affichée.
  await client.get('/cold-capacity');
  return client;
}

async function batchRow(batchId) {
  const { rows } = await env.db.query(
    `SELECT batch.status, batch.collected_at, batch.expired_at, reservation.collected_by_name
     FROM batch JOIN reservation ON reservation.batch_id = batch.id WHERE batch.id = $1`,
    [batchId],
  );
  return rows[0];
}

test('association confirms the pickup from its reservations, the store is emailed and sees it', async () => {
  const { store, batchId, client } = await setup();
  const page = (await client.get('/reservations')).body;
  assert.match(page, new RegExp(`action="/batches/${batchId}/confirm-pickup"`));
  // Prénom prérempli avec celui de la réservation.
  assert.match(page, /name="collected_by_name"[^>]*value="Karim"/);

  env.clock.advanceMinutes(25);
  const confirmed = await client.post(`/batches/${batchId}/confirm-pickup`, { collected_by_name: 'Léa' });
  assert.equal(confirmed.status, 303);
  assert.match((await client.get(confirmed.location)).body, /Collecte confirmée/);
  assert.deepEqual(await batchRow(batchId), {
    status: 'COLLECTED', collected_at: env.clock.now(), expired_at: null, collected_by_name: 'Léa',
  });

  assert.equal(env.mailbox.sent.length, 1);
  const [mail] = env.mailbox.sent;
  assert.equal(mail.to, store.email);
  assert.equal(mail.subject, 'Votre lot a été collecté');
  assert.match(mail.text, /Fruits et légumes/);
  assert.match(mail.text, /02\/11\/2026 10:25/);

  const storePage = (await (await loggedIn(store)).get('/batches')).body;
  assert.match(storePage, /Statut : <strong>Collecté<\/strong>/);
  assert.match(storePage, /Collecté le<\/dt><dd>02\/11\/2026 10:25/);
  assert.match(storePage, /Bénévole<\/dt><dd>Léa/);

  // Une seule collecte, donc un seul e-mail.
  assert.equal((await client.post(`/batches/${batchId}/confirm-pickup`, { collected_by_name: 'Léa' })).status, 409);
  assert.equal(env.mailbox.sent.length, 1);
});

test('an expired batch is confirmed within 24 hours and keeps its expired_at', async () => {
  const { association, batchId } = await setup();
  env.clock.advanceMinutes(60);
  await expireEndedBatches(env.db, env.clock.now());
  const expiredAt = env.clock.now();
  // 23 h 59 après la fin du créneau (10 h 20).
  env.clock.set(new Date('2026-11-03T09:19:00Z'));
  const client = await associationClient(association);
  assert.match((await client.get('/reservations')).body, /confirm-pickup/);

  const { status } = await client.post(`/batches/${batchId}/confirm-pickup`, { collected_by_name: 'Karim' });
  assert.equal(status, 303);
  assert.deepEqual(await batchRow(batchId), {
    status: 'COLLECTED', collected_at: env.clock.now(), expired_at: expiredAt, collected_by_name: 'Karim',
  });
});

test('a reserved batch whose slot just ended, not yet expired by the scheduler, is accepted', async () => {
  const { batchId, client } = await setup();
  env.clock.advanceMinutes(20);
  const { status } = await client.post(`/batches/${batchId}/confirm-pickup`, { collected_by_name: 'Karim' });
  assert.equal(status, 303);
  assert.equal((await batchRow(batchId)).status, 'COLLECTED');
});

test('refuses the confirmation 24 hours after the end of the slot', async () => {
  const { association, batchId } = await setup();
  await expireEndedBatches(env.db, new Date('2026-11-02T10:00:00Z'));
  // 10 h 20 le lendemain pile : la fenêtre de 24 h est close.
  env.clock.set(new Date('2026-11-03T09:20:00Z'));
  const client = await associationClient(association);
  assert.doesNotMatch((await client.get('/reservations')).body, /Fruits et légumes/);

  const { status, body } = await client.post(`/batches/${batchId}/confirm-pickup`, { collected_by_name: 'Karim' });
  assert.equal(status, 409);
  assert.match(body, /plus de 24 h/);
  assert.equal((await batchRow(batchId)).status, 'EXPIRED');
  assert.equal(env.mailbox.sent.length, 0);
});

test('the volunteer name is required', async () => {
  const { batchId, client } = await setup();
  const { status, body } = await client.post(`/batches/${batchId}/confirm-pickup`, { collected_by_name: '  ' });
  assert.equal(status, 400);
  assert.match(body, /prénom du bénévole/);
  assert.equal((await batchRow(batchId)).status, 'RESERVED');
});

test('only the reserving association, on a batch with an active reservation', async () => {
  const { association, store, batchId, client } = await setup();

  const other = await loggedIn(await env.createAccount({ role: 'ASSOCIATION' }));
  await other.get('/cold-capacity');
  assert.equal((await other.post(`/batches/${batchId}/confirm-pickup`, { collected_by_name: 'Inès' })).status, 403);
  // Prénom vide en plus : le refus d'accès passe avant l'erreur de saisie.
  assert.equal((await other.post(`/batches/${batchId}/confirm-pickup`, { collected_by_name: ' ' })).status, 403);

  // Réservation annulée puis lot expiré : jamais COLLECTED.
  await env.db.query('UPDATE reservation SET cancelled_at = $1, cancelled_by = $2', [env.clock.now(), association.id]);
  await env.db.query("UPDATE batch SET status = 'EXPIRED', expired_at = $1", [env.clock.now()]);
  assert.equal((await client.post(`/batches/${batchId}/confirm-pickup`, { collected_by_name: 'Karim' })).status, 403);
  const { rows } = await env.db.query('SELECT status FROM batch WHERE id = $1', [batchId]);
  assert.equal(rows[0].status, 'EXPIRED');

  for (const id of ['999999', 'abc']) {
    assert.equal((await client.post(`/batches/${id}/confirm-pickup`, { collected_by_name: 'Karim' })).status, 404, id);
  }
  assert.equal((await env.client().post(`/batches/${batchId}/confirm-pickup`)).status, 401);
  const storeClient = await loggedIn(store);
  await storeClient.get('/');
  assert.equal((await storeClient.post(`/batches/${batchId}/confirm-pickup`)).status, 403);
  assert.equal(env.mailbox.sent.length, 0);
});

test('a mail failure does not block the confirmation', async () => {
  const { batchId, client } = await setup();
  env.mailbox.failing = true;
  const { status } = await client.post(`/batches/${batchId}/confirm-pickup`, { collected_by_name: 'Karim' });
  assert.equal(status, 303);
  assert.equal((await batchRow(batchId)).status, 'COLLECTED');
});
