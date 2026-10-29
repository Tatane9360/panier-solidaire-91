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
const batch = {
  nature: 'Yaourts nature',
  quantity: '4',
  quantity_unit: 'cartons',
  weight_kg: '12,5',
  value_eur: '30',
  expiry_date: '2026-11-05',
  date_type: 'DLC',
  pickup_start: '2026-11-03T14:00',
  pickup_end: '2026-11-03T18:00',
  cold_requirement: 'CHILLED',
};

const submissionToken = (body) => body.match(/name="submission_token" value="([^"]+)"/)[1];

async function declare(client) {
  const form = await client.get('/batches/new');
  const values = { submission_token: submissionToken(form.body), ...batch };
  await client.post('/batches/review', values);
  return client.post('/batches', values);
}

async function loggedIn(fields) {
  const account = await env.createAccount(fields);
  const client = env.client();
  await client.login(account.email, account.password);
  return { account, client };
}

// Association avec un appareil abonné ; renvoie l'adresse de l'appareil.
async function subscribedAssociation(fields) {
  const association = await env.createAccount({ role: 'ASSOCIATION', ...fields });
  return env.subscribeDevice(association.id);
}

const notifiedDevices = () => env.pushes.sent.map((push) => push.endpoint).sort();

test('declaring a batch notifies every device of active associations that can keep it cold', async () => {
  const { client } = await loggedIn({ role: 'STORE', organization_name: 'Épicerie du Marché' });
  const ambientAndChilled = await env.createAccount({ role: 'ASSOCIATION', cold_capacity: ['AMBIENT', 'CHILLED'] });
  // Compte partagé : deux appareils abonnés, tous deux prévenus.
  const phone = await env.subscribeDevice(ambientAndChilled.id);
  const tablet = await env.subscribeDevice(ambientAndChilled.id);
  const chilledOnly = await subscribedAssociation({ cold_capacity: ['CHILLED'] });
  await subscribedAssociation({ cold_capacity: ['AMBIENT'] });
  await subscribedAssociation({ cold_capacity: ['CHILLED'], status: 'PENDING' });
  // Aucun appareil abonné : rien à envoyer, et aucun e-mail non plus.
  await env.createAccount({ role: 'ASSOCIATION', cold_capacity: ['CHILLED'] });
  const otherStore = await env.createAccount({ role: 'STORE' });
  await env.subscribeDevice(otherStore.id);

  assert.equal((await declare(client)).status, 303);

  assert.deepEqual(notifiedDevices(), [phone, tablet, chilledOnly].sort());
  assert.equal(env.mailbox.sent.length, 0);
  const [push] = env.pushes.sent;
  assert.equal(push.title, 'Nouveau lot disponible');
  assert.match(push.body, /Yaourts nature/);
  assert.match(push.body, /12,5 kg/);
  assert.match(push.body, /05\/11\/2026/);
  assert.match(push.body, /03\/11\/2026 14:00 au 03\/11\/2026 18:00/);
  assert.match(push.body, /Épicerie du Marché/);
  assert.equal(push.url, '/available-batches');
});

test('a duplicate submission sends no second notification', async () => {
  const { client } = await loggedIn({ role: 'STORE' });
  await subscribedAssociation({ cold_capacity: ['CHILLED'] });
  const form = await client.get('/batches/new');
  const values = { submission_token: submissionToken(form.body), ...batch };
  await client.post('/batches', values);
  await client.post('/batches', values);
  assert.equal(env.pushes.sent.length, 1);
});

test('a failing push service is logged and does not block the declaration', async (t) => {
  const { client } = await loggedIn({ role: 'STORE' });
  await subscribedAssociation({ cold_capacity: ['CHILLED'] });
  const logged = t.mock.method(console, 'error', () => {});
  env.pushes.failing = true;

  const response = await declare(client);
  assert.equal(response.status, 303);
  assert.equal(response.location, '/batches?declared=1');
  const { rows } = await env.db.query("SELECT count(*)::int AS count FROM batch WHERE status = 'DECLARED'");
  assert.equal(rows[0].count, 1);
  assert.equal(logged.mock.callCount(), 1);
});

test('a device whose subscription is gone is removed, the others are still notified', async () => {
  const { client } = await loggedIn({ role: 'STORE' });
  const gone = await subscribedAssociation({ cold_capacity: ['CHILLED'] });
  const active = await subscribedAssociation({ cold_capacity: ['CHILLED'] });
  env.pushes.gone.add(gone);

  await declare(client);

  assert.deepEqual(notifiedDevices(), [active]);
  const { rows } = await env.db.query('SELECT endpoint FROM push_subscription');
  assert.deepEqual(rows, [{ endpoint: active }]);
});

test('cancelling a reservation sends no new batch notification', async () => {
  const { client: store } = await loggedIn({ role: 'STORE' });
  await declare(store);
  const { account, client: association } = await loggedIn({ role: 'ASSOCIATION', cold_capacity: ['CHILLED'] });
  await env.subscribeDevice(account.id);
  await subscribedAssociation({ cold_capacity: ['CHILLED'] });
  const { rows: [{ id }] } = await env.db.query('SELECT id FROM batch');
  await association.get('/available-batches');
  await association.post(`/batches/${id}/reserve`, { reserved_by_name: 'Karim' });
  env.pushes.sent.length = 0;

  const response = await association.post(`/batches/${id}/cancel-reservation`, {});
  assert.equal(response.status, 303);
  const { rows } = await env.db.query('SELECT status FROM batch');
  assert.equal(rows[0].status, 'DECLARED');
  assert.equal(env.pushes.sent.length, 0);
});
