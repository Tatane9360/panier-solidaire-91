import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { setupTestApp } from '../../shared/testing.js';

let env;
before(async () => {
  env = await setupTestApp();
});
beforeEach(() => env.reset());
after(() => env.close());

// Ce qu'envoie le script de la page d'accueil après l'autorisation du navigateur.
const device = {
  endpoint: 'https://fcm.googleapis.com/fcm/send/abc123',
  p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM',
  auth: 'tBHItJI5svbpez7KI4CCXg',
};

async function loggedIn(fields) {
  const account = await env.createAccount(fields);
  const client = env.client();
  await client.login(account.email, account.password);
  // L'accueil fournit le jeton CSRF au script d'abonnement.
  await client.get('/');
  return { account, client };
}

const subscriptions = async () =>
  (await env.db.query('SELECT account_id, endpoint, p256dh, auth FROM push_subscription ORDER BY id')).rows;

test('the home page offers stores and associations to turn notifications on', async () => {
  for (const role of ['STORE', 'ASSOCIATION']) {
    const { client } = await loggedIn({ role });
    const { body } = await client.get('/');
    assert.match(body, /id="notifications"[^>]*data-vapid-public-key="BTestPublicKeyForPushSubscriptionsInTests"/, role);
    assert.match(body, /Activer les notifications/, role);
    assert.match(body, /<script src="\/notifications\.js" defer><\/script>/, role);
  }
  const { client } = await loggedIn({ role: 'COORDINATOR' });
  assert.doesNotMatch((await client.get('/')).body, /id="notifications"/);
});

test('every page links the web manifest, and the service worker is served at the root', async () => {
  const client = env.client();
  assert.match((await client.get('/login')).body, /<link rel="manifest" href="\/manifest\.webmanifest">/);
  const manifest = JSON.parse((await client.get('/manifest.webmanifest')).body);
  // Sur iPhone, le push n'est possible que pour une application installée en mode standalone.
  assert.equal(manifest.display, 'standalone');
  const worker = await client.get('/sw.js');
  assert.equal(worker.status, 200);
  assert.match(worker.body, /addEventListener\('push'/);
});

test('a store or an association subscribes a device, then unsubscribes it', async () => {
  for (const role of ['STORE', 'ASSOCIATION']) {
    await env.reset();
    const { account, client } = await loggedIn({ role });

    assert.equal((await client.post('/push-subscriptions', device)).status, 204, role);
    assert.deepEqual(await subscriptions(), [{ account_id: account.id, ...device }], role);

    // Le navigateur peut renvoyer le même abonnement : il n'est enregistré qu'une fois.
    assert.equal((await client.post('/push-subscriptions', device)).status, 204, role);
    assert.equal((await subscriptions()).length, 1, role);

    assert.equal((await client.post('/push-subscriptions/delete', { endpoint: device.endpoint })).status, 204, role);
    assert.deepEqual(await subscriptions(), [], role);
  }
});

test('a device used by another account moves to the account that subscribes it last', async () => {
  const { client: first } = await loggedIn({ role: 'ASSOCIATION' });
  await first.post('/push-subscriptions', device);
  const { account: second, client } = await loggedIn({ role: 'ASSOCIATION' });

  await client.post('/push-subscriptions', device);
  assert.deepEqual((await subscriptions()).map((row) => row.account_id), [second.id]);
});

test('an account cannot unsubscribe the device of another account', async () => {
  const { client: owner } = await loggedIn({ role: 'ASSOCIATION' });
  await owner.post('/push-subscriptions', device);
  const { client } = await loggedIn({ role: 'ASSOCIATION' });

  assert.equal((await client.post('/push-subscriptions/delete', { endpoint: device.endpoint })).status, 204);
  assert.equal((await subscriptions()).length, 1);
});

test('refuses an address that is not a known push service, or malformed keys', async () => {
  const { client } = await loggedIn({ role: 'ASSOCIATION' });
  const invalid = [
    { ...device, endpoint: 'http://fcm.googleapis.com/fcm/send/abc' },
    // Le serveur enverrait une requête à cette adresse : seuls les services de push connus sont acceptés.
    { ...device, endpoint: 'https://intranet.example.org/fcm/send/abc' },
    { ...device, endpoint: 'https://fcm.googleapis.com.example.org/send' },
    { ...device, endpoint: 'pas une adresse' },
    { ...device, endpoint: `https://fcm.googleapis.com/${'a'.repeat(2000)}` },
    { ...device, p256dh: '' },
    { ...device, auth: 'pas du base64url !' },
    { endpoint: device.endpoint },
  ];
  for (const fields of invalid) {
    assert.equal((await client.post('/push-subscriptions', fields)).status, 400, JSON.stringify(fields).slice(0, 80));
  }
  assert.deepEqual(await subscriptions(), []);
});

test('accepts the push services of Chrome, Firefox, Safari and Edge', async () => {
  const { client } = await loggedIn({ role: 'ASSOCIATION' });
  const endpoints = [
    'https://fcm.googleapis.com/fcm/send/a',
    'https://updates.push.services.mozilla.com/wpush/v2/b',
    'https://web.push.apple.com/c',
    'https://wns2-par02p.notify.windows.com/w/?token=d',
  ];
  for (const endpoint of endpoints) {
    assert.equal((await client.post('/push-subscriptions', { ...device, endpoint })).status, 204, endpoint);
  }
  assert.equal((await subscriptions()).length, endpoints.length);
});

test('the Coordination gets 403, and without a session the actions get 401', async () => {
  const { client } = await loggedIn({ role: 'COORDINATOR' });
  assert.equal((await client.post('/push-subscriptions', device)).status, 403);
  assert.equal((await client.post('/push-subscriptions/delete', { endpoint: device.endpoint })).status, 403);
  const anonymous = env.client();
  assert.equal((await anonymous.post('/push-subscriptions', device)).status, 401);
  assert.equal((await anonymous.post('/push-subscriptions/delete', device)).status, 401);
  assert.deepEqual(await subscriptions(), []);
});
