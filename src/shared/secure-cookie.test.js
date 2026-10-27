import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setupTestApp } from './testing.js';

let env;
before(async () => {
  env = await setupTestApp({ config: { secureCookies: true } });
  await env.reset();
});
after(() => env.close());

test('session cookie is Secure in production', async () => {
  const { setCookie } = await env.client().get('/login');
  assert.match(setCookie, /; Secure/);
});
