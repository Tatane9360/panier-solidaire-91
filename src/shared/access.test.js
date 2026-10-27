import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { setupTestApp } from './testing.js';
import { requireRole } from './access.js';

let env;
before(async () => {
  env = await setupTestApp({
    // Route réservée à la Coordination, pour vérifier le refus d'un autre profil.
    extend(app) {
      app.get('/coordination-only', requireRole('COORDINATOR'), (req, res) => res.send('ok'));
      app.post('/coordination-only', requireRole('COORDINATOR'), (req, res) => res.send('ok'));
    },
  });
});
beforeEach(() => env.reset());
after(() => env.close());

test('visitor without session is redirected to login from a page', async () => {
  const response = await env.client().get('/');
  assert.equal(response.status, 303);
  assert.equal(response.location, '/login');
});

test('action without session gets 401', async () => {
  const client = env.client();
  await client.get('/login');
  assert.equal((await client.post('/logout')).status, 401);
  assert.equal((await env.client().postWithoutCsrf('/logout')).status, 401);
});

test('other profile gets 403', async () => {
  const account = await env.createAccount({ role: 'STORE' });
  const client = env.client();
  await client.login(account.email, account.password);

  assert.equal((await client.get('/coordination-only')).status, 403);
});

test('logged-in account that is no longer ACTIVE gets 403', async () => {
  const account = await env.createAccount();
  const client = env.client();
  await client.login(account.email, account.password);
  await env.db.query("UPDATE account SET status = 'REFUSED' WHERE id = $1", [account.id]);

  assert.equal((await client.get('/')).status, 403);
});

test('session expires after 30 minutes of inactivity', async () => {
  const account = await env.createAccount();
  const client = env.client();
  await client.login(account.email, account.password);

  const other = env.client();
  await other.login(account.email, account.password);

  env.clock.advanceMinutes(29);
  assert.equal((await other.get('/')).status, 200);
  env.clock.advanceMinutes(1);
  assert.equal((await client.get('/')).location, '/login');
});

test('logged-in account that is no longer ACTIVE gets 403 on an action', async () => {
  const account = await env.createAccount({ role: 'COORDINATOR' });
  const client = env.client();
  await client.login(account.email, account.password);
  await client.get('/coordination-only');
  await env.db.query("UPDATE account SET status = 'REFUSED' WHERE id = $1", [account.id]);

  assert.equal((await client.post('/coordination-only')).status, 403);
});

test('activity keeps the session alive', async () => {
  const account = await env.createAccount();
  const client = env.client();
  await client.login(account.email, account.password);

  env.clock.advanceMinutes(20);
  assert.equal((await client.get('/')).status, 200);
  env.clock.advanceMinutes(20);
  assert.equal((await client.get('/')).status, 200);
});

test('session cookie is HttpOnly and SameSite=Lax, without Secure outside production', async () => {
  const { setCookie } = await env.client().get('/login');
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /SameSite=Lax/);
  assert.doesNotMatch(setCookie, /Secure/);
});

test('POST without a valid CSRF token is refused', async () => {
  const account = await env.createAccount();
  const client = env.client();

  await client.get('/login');
  const login = await client.postWithoutCsrf('/login', { email: account.email, password: account.password });
  assert.equal(login.status, 403);

  await client.login(account.email, account.password);
  await client.get('/');
  assert.equal((await client.postWithoutCsrf('/logout', { _csrf: 'faux' })).status, 403);
  assert.equal((await client.get('/')).status, 200);
});

test('login issues a new session id', async () => {
  const account = await env.createAccount();
  const client = env.client();
  const before = (await client.get('/login')).setCookie;
  const after = (await client.login(account.email, account.password)).setCookie;
  assert.notEqual(before.split(';')[0], after.split(';')[0]);
});
