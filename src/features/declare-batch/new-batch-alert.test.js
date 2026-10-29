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

async function declare(client) {
  const form = await client.get('/batches/new');
  const values = { submission_token: form.body.match(/name="submission_token" value="([^"]+)"/)[1], ...batch };
  await client.post('/batches/review', values);
  return client.post('/batches', values);
}

async function loggedIn(fields) {
  const account = await env.createAccount(fields);
  const client = env.client();
  await client.login(account.email, account.password);
  return { account, client };
}

const recipients = () => env.mailbox.sent.map((message) => message.to).sort();

test('declaring a batch alerts each active association that wants it and can keep it cold', async () => {
  const { client } = await loggedIn({ role: 'STORE', organization_name: 'Épicerie du Marché' });
  const chilled = await env.createAccount({ role: 'ASSOCIATION', cold_capacity: ['AMBIENT', 'CHILLED'] });
  const other = await env.createAccount({ role: 'ASSOCIATION', cold_capacity: ['CHILLED'] });
  await env.createAccount({ role: 'ASSOCIATION', cold_capacity: ['AMBIENT'] });
  await env.createAccount({ role: 'ASSOCIATION', cold_capacity: ['CHILLED'], notify_new_batches: false });
  await env.createAccount({ role: 'ASSOCIATION', cold_capacity: ['CHILLED'], status: 'PENDING' });
  await env.createAccount({ role: 'STORE' });

  assert.equal((await declare(client)).status, 303);

  assert.deepEqual(recipients(), [chilled.email, other.email].sort());
  const [message] = env.mailbox.sent;
  assert.equal(message.subject, 'Nouveau lot disponible');
  assert.match(message.text, /Yaourts nature/);
  assert.match(message.text, /12,5 kg/);
  assert.match(message.text, /05\/11\/2026/);
  assert.match(message.text, /03\/11\/2026 14:00 – 03\/11\/2026 18:00/);
  assert.match(message.text, /Épicerie du Marché/);
  assert.match(message.text, /http:\/\/localhost:3000\/available-batches/);
});

test('a duplicate submission sends no second alert', async () => {
  const { client } = await loggedIn({ role: 'STORE' });
  await env.createAccount({ role: 'ASSOCIATION', cold_capacity: ['CHILLED'] });
  const form = await client.get('/batches/new');
  const values = { submission_token: form.body.match(/name="submission_token" value="([^"]+)"/)[1], ...batch };
  await client.post('/batches', values);
  await client.post('/batches', values);
  assert.equal(env.mailbox.sent.length, 1);
});

test('a failing mail service does not block the declaration', async () => {
  const { client } = await loggedIn({ role: 'STORE' });
  await env.createAccount({ role: 'ASSOCIATION', cold_capacity: ['CHILLED'] });
  env.mailbox.failing = true;

  const response = await declare(client);
  assert.equal(response.status, 303);
  const { rows } = await env.db.query("SELECT count(*)::int AS count FROM batch WHERE status = 'DECLARED'");
  assert.equal(rows[0].count, 1);
});

test('cancelling a reservation sends no new batch alert', async () => {
  const { client: store } = await loggedIn({ role: 'STORE' });
  await declare(store);
  const { client: association } = await loggedIn({ role: 'ASSOCIATION', cold_capacity: ['CHILLED'] });
  await env.createAccount({ role: 'ASSOCIATION', cold_capacity: ['CHILLED'] });
  const { rows: [{ id }] } = await env.db.query('SELECT id FROM batch');
  await association.get('/available-batches');
  await association.post(`/batches/${id}/reserve`, { reserved_by_name: 'Karim' });
  env.mailbox.sent.length = 0;

  const response = await association.post(`/batches/${id}/cancel-reservation`, {});
  assert.equal(response.status, 303);
  const { rows } = await env.db.query('SELECT status FROM batch');
  assert.equal(rows[0].status, 'DECLARED');
  assert.equal(env.mailbox.sent.length, 0);
});
