import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { setupTestApp } from '../../shared/testing.js';
import { install } from '../../../scripts/install.js';

let env;
before(async () => {
  env = await setupTestApp();
});
beforeEach(() => env.reset());
after(() => env.close());

test('coordinator created by the install script logs in, sees home and logs out', async () => {
  await install(env.db, env.clock, {
    TERRITORY_NAME: 'Essonne',
    COORDINATOR_EMAIL: 'coordination@example.org',
    COORDINATOR_PASSWORD: 'secret-de-test',
    COORDINATOR_ORGANIZATION_NAME: 'Panier Solidaire 91',
    COORDINATOR_ADDRESS: 'Évry',
  });
  const client = env.client();

  const login = await client.login('coordination@example.org', 'secret-de-test');
  assert.equal(login.status, 303);
  assert.equal(login.location, '/');

  const home = await client.get('/');
  assert.equal(home.status, 200);
  assert.match(home.body, /Panier Solidaire 91/);

  const logout = await client.post('/logout');
  assert.equal(logout.status, 303);
  assert.equal(logout.location, '/login');
  assert.equal((await client.get('/')).location, '/login');
});

for (const status of ['PENDING', 'REFUSED']) {
  test(`${status} account sees "compte non actif" and gets no session`, async () => {
    const account = await env.createAccount({ status });
    const client = env.client();

    const login = await client.login(account.email, account.password);
    assert.equal(login.status, 403);
    assert.match(login.body, /Compte non actif/);
    assert.equal((await client.get('/')).location, '/login');
  });
}

test('anonymized account cannot log in', async () => {
  const account = await env.createAccount({ status: 'ANONYMIZED' });
  const client = env.client();

  const login = await client.login(account.email, account.password);
  assert.equal(login.status, 401);
  assert.doesNotMatch(login.body, /Compte non actif/);
  assert.equal((await client.get('/')).location, '/login');
});

test('wrong password is refused', async () => {
  const account = await env.createAccount();
  const client = env.client();

  const login = await client.login(account.email, 'mauvais-mot-de-passe');
  assert.equal(login.status, 401);
  assert.match(login.body, /mot de passe incorrect/);
  assert.equal((await client.get('/')).location, '/login');
});
