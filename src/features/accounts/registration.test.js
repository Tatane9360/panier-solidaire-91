import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { setupTestApp } from '../../shared/testing.js';

let env;
before(async () => {
  env = await setupTestApp();
});
beforeEach(() => env.reset());
after(() => env.close());

const registration = {
  organization_name: 'Épicerie du Marché',
  role: 'STORE',
  address: '3 place du Marché, 91000 Évry',
  email: 'epicerie@example.org',
  password: 'mot-de-passe-epicerie',
};

async function register(client, fields = registration) {
  await client.get('/register');
  return client.post('/register', fields);
}

test('registration form has exactly the expected fields', async () => {
  const { status, body } = await env.client().get('/register');
  assert.equal(status, 200);
  const names = [...body.matchAll(/<(?:input|select)[^>]*\sname="([^"]+)"/g)]
    .map((match) => match[1])
    .filter((name) => name !== '_csrf');
  assert.deepEqual(new Set(names), new Set(['organization_name', 'role', 'address', 'email', 'password']));
});

test('registration creates a PENDING account in the pilot territory, without access', async () => {
  // Le compte de la Coordination crée le territoire pilote.
  await env.createAccount({ role: 'COORDINATOR' });
  const client = env.client();

  const response = await register(client);
  assert.equal(response.status, 200);
  assert.match(response.body, /en attente de validation/);

  const { rows } = await env.db.query(
    'SELECT role, status, organization_name, address, territory_id FROM account WHERE email = $1',
    [registration.email],
  );
  assert.deepEqual(rows, [{
    role: 'STORE',
    status: 'PENDING',
    organization_name: registration.organization_name,
    address: registration.address,
    territory_id: 1,
  }]);

  const login = await client.login(registration.email, registration.password);
  assert.equal(login.status, 403);
  assert.match(login.body, /Compte non actif/);
});

test('registration with an email already used is refused with a clear message', async () => {
  await env.createAccount({ email: registration.email });

  const response = await register(env.client());
  assert.equal(response.status, 409);
  assert.match(response.body, /adresse e-mail est déjà utilisée/);
  const { rows } = await env.db.query('SELECT count(*)::int AS count FROM account');
  assert.equal(rows[0].count, 1);
});

test('registration cannot create a COORDINATOR account', async () => {
  const response = await register(env.client(), { ...registration, role: 'COORDINATOR' });
  assert.equal(response.status, 400);
  const { rows } = await env.db.query('SELECT count(*)::int AS count FROM account');
  assert.equal(rows[0].count, 0);
});

async function loginAsCoordinator() {
  const coordinator = await env.createAccount({ role: 'COORDINATOR' });
  const client = env.client();
  await client.login(coordinator.email, coordinator.password);
  return { coordinator, client };
}

async function pendingAccountId() {
  const { rows } = await env.db.query('SELECT id FROM account WHERE email = $1', [registration.email]);
  return rows[0].id;
}

test('coordinator sees pending registrations with the submitted information', async () => {
  const { client } = await loginAsCoordinator();
  await register(env.client());
  await env.createAccount({ organization_name: 'Commerce déjà actif' });

  const list = await client.get('/registrations');
  assert.equal(list.status, 200);
  assert.match(list.body, /Épicerie du Marché/);
  assert.match(list.body, /Commerce/);
  assert.match(list.body, /3 place du Marché, 91000 Évry/);
  assert.match(list.body, /epicerie@example\.org/);
  assert.doesNotMatch(list.body, /Commerce déjà actif/);
});

test('approving a registration activates the account, records the decision and emails the applicant', async () => {
  const { coordinator, client } = await loginAsCoordinator();
  await register(env.client());
  const id = await pendingAccountId();
  env.mailbox.sent.length = 0;

  await client.get('/registrations');
  const response = await client.post(`/registrations/${id}/approve`);
  assert.equal(response.status, 303);
  assert.equal(response.location, '/registrations');

  const { rows } = await env.db.query(
    'SELECT status, decided_by, decided_at, refusal_reason FROM account WHERE id = $1',
    [id],
  );
  assert.deepEqual(rows, [{
    status: 'ACTIVE',
    decided_by: coordinator.id,
    decided_at: env.clock.now(),
    refusal_reason: null,
  }]);

  assert.equal(env.mailbox.sent.length, 1);
  const [mail] = env.mailbox.sent;
  assert.equal(mail.to, registration.email);
  assert.equal(mail.subject, 'Votre inscription au Panier Solidaire 91');
  assert.match(mail.text, /validée/);

  const login = await env.client().login(registration.email, registration.password);
  assert.equal(login.status, 303);
});

test('refusing a registration records the optional reason and emails it to the applicant', async () => {
  const { coordinator, client } = await loginAsCoordinator();
  await register(env.client());
  const id = await pendingAccountId();

  await client.get('/registrations');
  const response = await client.post(`/registrations/${id}/refuse`, { refusal_reason: 'Hors du territoire' });
  assert.equal(response.status, 303);

  const { rows } = await env.db.query(
    'SELECT status, decided_by, decided_at, refusal_reason FROM account WHERE id = $1',
    [id],
  );
  assert.deepEqual(rows, [{
    status: 'REFUSED',
    decided_by: coordinator.id,
    decided_at: env.clock.now(),
    refusal_reason: 'Hors du territoire',
  }]);

  const [mail] = env.mailbox.sent;
  assert.equal(mail.to, registration.email);
  assert.equal(mail.subject, 'Votre inscription au Panier Solidaire 91');
  assert.match(mail.text, /refusée/);
  assert.match(mail.text, /Hors du territoire/);
  assert.doesNotMatch((await client.get('/registrations')).body, /Épicerie du Marché/);
});

test('refusing without a reason is allowed', async () => {
  const { client } = await loginAsCoordinator();
  await register(env.client());
  const id = await pendingAccountId();

  await client.get('/registrations');
  assert.equal((await client.post(`/registrations/${id}/refuse`, { refusal_reason: '' })).status, 303);
  const { rows } = await env.db.query('SELECT status, refusal_reason FROM account WHERE id = $1', [id]);
  assert.deepEqual(rows, [{ status: 'REFUSED', refusal_reason: null }]);
  assert.doesNotMatch(env.mailbox.sent[0].text, /Motif/);
});

test('an email failure is logged and does not block the decision', async (t) => {
  const { client } = await loginAsCoordinator();
  await register(env.client());
  const id = await pendingAccountId();
  const logged = t.mock.method(console, 'error', () => {});
  env.mailbox.failing = true;

  await client.get('/registrations');
  const response = await client.post(`/registrations/${id}/approve`);
  assert.equal(response.status, 303);
  const { rows } = await env.db.query('SELECT status FROM account WHERE id = $1', [id]);
  assert.equal(rows[0].status, 'ACTIVE');
  assert.equal(logged.mock.callCount(), 1);
});

test('a registration already decided cannot be decided again', async () => {
  const { client } = await loginAsCoordinator();
  await register(env.client());
  const id = await pendingAccountId();

  await client.get('/registrations');
  await client.post(`/registrations/${id}/approve`);
  await client.get('/registrations');
  const response = await client.post(`/registrations/${id}/refuse`);
  assert.equal(response.status, 404);
  assert.equal((await client.post('/registrations/abc/approve')).status, 404);
  const { rows } = await env.db.query('SELECT status FROM account WHERE id = $1', [id]);
  assert.equal(rows[0].status, 'ACTIVE');
  assert.equal(env.mailbox.sent.length, 1);
});

for (const role of ['STORE', 'ASSOCIATION']) {
  test(`${role} gets 403 on registration review`, async () => {
    const account = await env.createAccount({ role });
    await register(env.client());
    const id = await pendingAccountId();
    const client = env.client();
    await client.login(account.email, account.password);

    assert.equal((await client.get('/registrations')).status, 403);
    assert.equal((await client.post(`/registrations/${id}/approve`)).status, 403);
    assert.equal((await client.post(`/registrations/${id}/refuse`)).status, 403);
    const { rows } = await env.db.query('SELECT status FROM account WHERE id = $1', [id]);
    assert.equal(rows[0].status, 'PENDING');
  });
}

test('registration review without session redirects to login, decision gets 401', async () => {
  await env.createAccount({ role: 'COORDINATOR' });
  await register(env.client());
  const id = await pendingAccountId();
  const client = env.client();

  assert.equal((await client.get('/registrations')).location, '/login');
  await client.get('/login');
  assert.equal((await client.post(`/registrations/${id}/approve`)).status, 401);
});
