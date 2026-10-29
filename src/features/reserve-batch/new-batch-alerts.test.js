import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { setupTestApp } from '../../shared/testing.js';

let env;
before(async () => {
  env = await setupTestApp();
});
beforeEach(() => env.reset());
after(() => env.close());

async function loggedIn(fields) {
  const account = await env.createAccount(fields);
  const client = env.client();
  await client.login(account.email, account.password);
  return { account, client };
}

const preference = async (id) => (await env.db.query('SELECT notify_new_batches FROM account WHERE id = $1', [id])).rows[0].notify_new_batches;

test('association turns new batch alerts off then on from its account', async () => {
  const { account, client } = await loggedIn({ role: 'ASSOCIATION' });

  const pageBefore = await client.get('/cold-capacity');
  assert.match(pageBefore.body, /name="notify_new_batches" type="checkbox" value="1" checked/);

  // Case décochée : le champ est absent du formulaire.
  const off = await client.post('/new-batch-alerts', {});
  assert.equal(off.status, 303);
  assert.equal(await preference(account.id), false);
  const pageAfter = await client.get(off.location);
  assert.match(pageAfter.body, /Préférence d’alerte enregistrée/);
  assert.doesNotMatch(pageAfter.body, /name="notify_new_batches" type="checkbox" value="1" checked/);

  await client.post('/new-batch-alerts', { notify_new_batches: '1' });
  assert.equal(await preference(account.id), true);
});

test('only an association can change its alert preference', async () => {
  for (const role of ['STORE', 'COORDINATOR']) {
    const { client } = await loggedIn({ role });
    await client.get('/');
    assert.equal((await client.post('/new-batch-alerts', {})).status, 403, role);
  }
  assert.equal((await env.client().post('/new-batch-alerts', {})).status, 401);
});
