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
  nature: 'Fruits et légumes',
  quantity: '4',
  quantity_unit: 'cagettes',
  weight_kg: '12,5',
  value_eur: '30',
  expiry_date: '2026-11-05',
  date_type: 'DLC',
  pickup_start: '2026-11-03T14:00',
  pickup_end: '2026-11-03T18:00',
  cold_requirement: 'CHILLED',
};

async function loginAsStore(fields) {
  const store = await env.createAccount({ role: 'STORE', ...fields });
  const client = env.client();
  await client.login(store.email, store.password);
  return { store, client };
}

const submissionToken = (body) => body.match(/name="submission_token" value="([^"]+)"/)[1];

// Ouvrir le formulaire, valider, confirmer.
async function declare(client, fields = batch) {
  const form = await client.get('/batches/new');
  const values = { submission_token: submissionToken(form.body), ...fields };
  await client.post('/batches/review', values);
  return client.post('/batches', values);
}

test('store declares a batch in 3 navigation actions from its home page', async () => {
  const { client } = await loginAsStore();

  const home = await client.get('/');
  assert.match(home.body, /href="\/batches\/new"/);

  const form = await client.get('/batches/new');
  assert.equal(form.status, 200);
  assert.match(form.body, /action="\/batches\/review"/);
  const token = submissionToken(form.body);

  const review = await client.post('/batches/review', { ...batch, submission_token: token });
  assert.equal(review.status, 200);
  assert.match(review.body, /action="\/batches"/);
  assert.match(review.body, /Fruits et légumes/);

  const confirm = await client.post('/batches', { ...batch, submission_token: token });
  assert.equal(confirm.status, 303);
  assert.equal(confirm.location, '/batches?declared=1');

  const list = await client.get(confirm.location);
  assert.match(list.body, /Lot déclaré/);
  assert.match(list.body, /Fruits et légumes/);
  assert.match(list.body, /Déclaré/);
});

test('declared batch is DECLARED with its fields and the declaration time', async () => {
  const { store, client } = await loginAsStore();
  await declare(client);

  const { rows } = await env.db.query(
    `SELECT store_id, nature, quantity, quantity_unit, weight_kg::text, value_eur::text,
            to_char(expiry_date, 'YYYY-MM-DD') AS expiry_date, date_type, pickup_start, pickup_end,
            cold_requirement, status, created_at
     FROM batch`,
  );
  assert.deepEqual(rows, [{
    store_id: store.id,
    nature: 'Fruits et légumes',
    quantity: 4,
    quantity_unit: 'cagettes',
    weight_kg: '12.5',
    value_eur: '30',
    expiry_date: '2026-11-05',
    date_type: 'DLC',
    // 14 h et 18 h à Paris, en heure d'hiver (UTC+1).
    pickup_start: new Date('2026-11-03T13:00:00Z'),
    pickup_end: new Date('2026-11-03T17:00:00Z'),
    cold_requirement: 'CHILLED',
    status: 'DECLARED',
    created_at: new Date('2026-11-02T09:00:00Z'),
  }]);
});

const countBatches = async () => (await env.db.query('SELECT count(*)::int AS count FROM batch')).rows[0].count;

test('submitting the same declaration twice creates a single batch', async () => {
  const { client } = await loginAsStore();
  const form = await client.get('/batches/new');
  const values = { ...batch, submission_token: submissionToken(form.body) };

  const [first, second] = await Promise.all([client.post('/batches', values), client.post('/batches', values)]);
  assert.equal(first.status, 303);
  assert.equal(second.status, 303);
  assert.equal((await client.post('/batches', values)).status, 303);
  assert.equal(await countBatches(), 1);
});

test('two declarations from two forms create two batches', async () => {
  const { client } = await loginAsStore();
  await declare(client);
  await declare(client);
  assert.equal(await countBatches(), 2);
});

// Ouvre le formulaire puis le valide, sans confirmer.
async function review(client, fields) {
  const form = await client.get('/batches/new');
  return client.post('/batches/review', { submission_token: submissionToken(form.body), ...fields });
}

test('all fields are required', async () => {
  const { client } = await loginAsStore();
  const empty = Object.fromEntries(Object.keys(batch).map((name) => [name, '']));

  const response = await review(client, empty);
  assert.equal(response.status, 400);
  for (const name of Object.keys(batch)) {
    assert.match(response.body, new RegExp(`id="erreur-${name}"`), name);
  }
  assert.equal((await declare(client, empty)).status, 400);
  assert.equal(await countBatches(), 0);
});

test('refuses a weight, a value or a quantity that is not above zero', async () => {
  const { client } = await loginAsStore();
  const response = await review(client, { ...batch, weight_kg: '0', value_eur: '-3', quantity: '0' });
  assert.equal(response.status, 400);
  assert.match(response.body, /id="erreur-weight_kg"/);
  assert.match(response.body, /id="erreur-value_eur"/);
  assert.match(response.body, /id="erreur-quantity"/);
});

test('refuses a past expiry date but accepts today', async () => {
  const { client } = await loginAsStore();
  const past = await review(client, { ...batch, expiry_date: '2026-11-01' });
  assert.equal(past.status, 400);
  assert.match(past.body, /id="erreur-expiry_date"/);

  const today = await review(client, {
    ...batch,
    expiry_date: '2026-11-02',
    pickup_start: '2026-11-02T11:00',
    pickup_end: '2026-11-02T12:00',
  });
  assert.equal(today.status, 200);
});

test('refuses a pickup slot that ends after the expiry date', async () => {
  const { client } = await loginAsStore();
  const after = await review(client, { ...batch, pickup_start: '2026-11-05T20:00', pickup_end: '2026-11-06T08:00' });
  assert.equal(after.status, 400);
  assert.match(after.body, /id="erreur-pickup_end"/);

  const sameDay = await review(client, { ...batch, pickup_start: '2026-11-05T18:00', pickup_end: '2026-11-05T20:00' });
  assert.equal(sameDay.status, 200);
});

test('refuses a pickup slot that ends before it starts or has already ended', async () => {
  const { client } = await loginAsStore();
  const reversed = await review(client, { ...batch, pickup_start: '2026-11-03T18:00', pickup_end: '2026-11-03T14:00' });
  assert.equal(reversed.status, 400);
  assert.match(reversed.body, /id="erreur-pickup_end"/);

  // 9 h 30 à Paris, alors que l'horloge indique 10 h.
  const ended = await review(client, { ...batch, pickup_start: '2026-11-02T09:00', pickup_end: '2026-11-02T09:30' });
  assert.equal(ended.status, 400);
  assert.match(ended.body, /id="erreur-pickup_end"/);
});

test('form errors are linked to their field and announced', async () => {
  const { client } = await loginAsStore();
  const response = await review(client, { ...batch, weight_kg: '0' });
  assert.match(response.body, /role="alert"/);
  // La saisie est réaffichée telle quelle.
  assert.match(response.body, /id="weight_kg"[^>]*value="0" aria-invalid="true" aria-describedby="erreur-weight_kg"/);
});

test('confirmation checks the fields again', async () => {
  const { client } = await loginAsStore();
  const response = await declare(client, { ...batch, value_eur: '0' });
  assert.equal(response.status, 400);
  assert.equal(await countBatches(), 0);
});

test('my batches lists only the batches of the logged-in store, most recent first', async () => {
  const other = await loginAsStore();
  await declare(other.client, { ...batch, nature: 'Lot d’un autre commerce' });

  const { client } = await loginAsStore();
  await declare(client, { ...batch, nature: 'Pain de la veille' });
  env.clock.advanceMinutes(5);
  await declare(client, { ...batch, nature: 'Yaourts' });

  const { status, body } = await client.get('/batches');
  assert.equal(status, 200);
  assert.doesNotMatch(body, /Lot d’un autre commerce/);
  assert.ok(body.indexOf('Yaourts') < body.indexOf('Pain de la veille'));
});

test('other profiles get 403 on batch declaration pages and actions', async () => {
  for (const role of ['ASSOCIATION', 'COORDINATOR']) {
    const account = await env.createAccount({ role });
    const client = env.client();
    await client.login(account.email, account.password);
    await client.get('/');

    assert.equal((await client.get('/batches')).status, 403, role);
    assert.equal((await client.get('/batches/new')).status, 403, role);
    assert.equal((await client.post('/batches/review', batch)).status, 403, role);
    assert.equal((await client.post('/batches', batch)).status, 403, role);
  }
  assert.equal(await countBatches(), 0);
});

test('visitor without session is sent to login, and gets 401 on actions', async () => {
  const client = env.client();
  assert.equal((await client.get('/batches')).location, '/login');
  assert.equal((await client.get('/batches/new')).location, '/login');
  assert.equal((await client.post('/batches', batch)).status, 401);
});
