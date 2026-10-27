import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { setupTestApp } from '../../shared/testing.js';

let env;
before(async () => {
  env = await setupTestApp();
});
beforeEach(() => env.reset());
after(() => env.close());

const BLOCKED = /Trop de tentatives de connexion/;

// Échecs successifs pour un même e-mail, espacés de `minutesApart` minutes.
async function failLogins(email, count, minutesApart = 1) {
  const responses = [];
  for (let i = 0; i < count; i += 1) {
    if (i > 0) env.clock.advanceMinutes(minutesApart);
    responses.push(await env.client().login(email, 'mauvais-mot-de-passe'));
  }
  return responses;
}

test('5 failures in 15 minutes block login for 15 minutes, even with the right password', async () => {
  const account = await env.createAccount();
  const responses = await failLogins(account.email, 5);
  assert.equal(responses[3].status, 401);
  assert.equal(responses[4].status, 429);
  assert.match(responses[4].body, BLOCKED);

  env.clock.advanceMinutes(14);
  const login = await env.client().login(account.email, account.password);
  assert.equal(login.status, 429);
  assert.match(login.body, BLOCKED);
});

test('login is possible again 15 minutes after the fifth failure, attempts during the block do not extend it', async () => {
  const account = await env.createAccount();
  await failLogins(account.email, 5);

  env.clock.advanceMinutes(10);
  assert.equal((await env.client().login(account.email, account.password)).status, 429);
  assert.equal((await env.client().login(account.email, 'mauvais-mot-de-passe')).status, 429);

  env.clock.advanceMinutes(5);
  const login = await env.client().login(account.email, account.password);
  assert.equal(login.status, 303);
});

test('failures spread over more than 15 minutes do not block', async () => {
  const account = await env.createAccount();
  // Échecs à 0, 4, 8, 12 et 16 minutes : jamais 5 dans la même fenêtre de 15 minutes.
  const responses = await failLogins(account.email, 5, 4);
  assert.equal(responses[4].status, 401);

  assert.equal((await env.client().login(account.email, account.password)).status, 303);
});

test('a successful login resets the failure count', async () => {
  const account = await env.createAccount();
  await failLogins(account.email, 4);
  assert.equal((await env.client().login(account.email, account.password)).status, 303);

  const [failure] = await failLogins(account.email, 1);
  assert.equal(failure.status, 401);
});

test('the block does not reveal whether the email exists', async () => {
  const account = await env.createAccount();
  const known = await failLogins(account.email, 5);
  const unknown = await failLogins('inconnu@example.org', 5);

  assert.deepEqual(unknown.map((response) => response.status), known.map((response) => response.status));
  assert.equal(unknown[4].body.replace(/value="[^"]*"/g, ''), known[4].body.replace(/value="[^"]*"/g, ''));
});

test('the block applies to one email only', async () => {
  const blocked = await env.createAccount();
  const other = await env.createAccount();
  await failLogins(blocked.email, 5);

  assert.equal((await env.client().login(other.email, other.password)).status, 303);
});
