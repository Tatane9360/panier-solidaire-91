// Dispositif de test : application réelle sur un port libre, vraie base de test,
// e-mails en mémoire et horloge contrôlée.
import { once } from 'node:events';
import { buildApp } from '../app.js';
import { createDb } from './db.js';
import { migrate } from '../../scripts/migrate.js';
import { hashPassword } from './password.js';
import { createNotifications, createMemoryTransport, createMemoryPushTransport } from './notifications/index.js';

const START = new Date('2026-11-02T09:00:00Z');
// Clé publique fictive : en test, aucun message ne part vers un vrai service de push.
const TEST_VAPID_PUBLIC_KEY = 'BTestPublicKeyForPushSubscriptionsInTests';

export async function setupTestApp({ config = {}, extend } = {}) {
  const db = createDb(process.env.TEST_DATABASE_URL);
  await migrate(db);
  const clock = createTestClock();
  const mailbox = createMemoryTransport();
  const pushes = createMemoryPushTransport();
  const notifications = createNotifications({ db, mailTransport: mailbox, pushTransport: pushes, from: 'test@example.org' });
  const app = buildApp({
    db,
    notifications,
    clock,
    config: { sessionDurationMinutes: 30, pageSize: 50, secureCookies: false, vapid: { publicKey: TEST_VAPID_PUBLIC_KEY }, ...config },
  });
  // Permet à un test d'ajouter une route, par exemple pour vérifier un contrôle d'accès.
  if (extend) extend(app);
  const server = app.listen(0);
  await once(server, 'listening');
  const baseUrl = `http://localhost:${server.address().port}`;

  return {
    db,
    clock,
    mailbox,
    pushes,
    client: () => createClient(baseUrl),
    createAccount: (fields) => createAccount(db, clock, fields),
    subscribeDevice: (accountId) => subscribeDevice(db, clock, accountId),
    async reset() {
      await resetDatabase(db);
      clock.set(START);
      mailbox.sent.length = 0;
      mailbox.failing = false;
      pushes.sent.length = 0;
      pushes.gone.clear();
      pushes.failing = false;
    },
    async close() {
      server.close();
      await db.end();
    },
  };
}

function createTestClock() {
  let current = START;
  return {
    now: () => new Date(current),
    set(date) {
      current = new Date(date);
    },
    advanceMinutes(minutes) {
      current = new Date(current.getTime() + minutes * 60_000);
    },
  };
}

async function resetDatabase(db) {
  // Les noms de tables viennent du catalogue PostgreSQL, jamais d'une saisie.
  const { rows } = await db.query(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'schema_migration'",
  );
  const tables = rows.map((row) => `"${row.tablename}"`).join(', ');
  await db.query(`TRUNCATE ${tables} RESTART IDENTITY CASCADE`);
}

let accountCount = 0;

async function createAccount(db, clock, fields = {}) {
  accountCount += 1;
  const account = {
    role: 'STORE',
    status: 'ACTIVE',
    email: `compte-${accountCount}@example.org`,
    password: 'mot-de-passe-de-test',
    organization_name: `Structure ${accountCount}`,
    address: '1 rue de l’Exemple, 91000 Évry',
    cold_capacity: ['AMBIENT'],
    ...fields,
  };
  await db.query(
    "INSERT INTO territory (name) SELECT 'Territoire de test' WHERE NOT EXISTS (SELECT 1 FROM territory)",
  );
  const { rows } = await db.query(
    `INSERT INTO account (territory_id, role, status, email, password_hash, organization_name, address,
                          cold_capacity, created_at)
     VALUES ((SELECT min(id) FROM territory), $1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id`,
    [
      account.role,
      account.status,
      account.email,
      await hashPassword(account.password),
      account.organization_name,
      account.address,
      account.cold_capacity,
      clock.now(),
    ],
  );
  return { ...account, id: rows[0].id };
}

// Abonne un appareil fictif au compte, comme le ferait le navigateur, et renvoie son adresse.
let deviceCount = 0;
async function subscribeDevice(db, clock, accountId) {
  deviceCount += 1;
  const endpoint = `https://fcm.googleapis.com/fcm/send/appareil-${deviceCount}`;
  await db.query(
    `INSERT INTO push_subscription (account_id, endpoint, p256dh, auth, created_at)
     VALUES ($1, $2, 'cle-publique-de-test', 'secret-de-test', $3)`,
    [accountId, endpoint, clock.now()],
  );
  return endpoint;
}

// Un tableau envoie plusieurs valeurs sous le même nom, comme des cases cochées.
function formBody(form) {
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(form)) {
    for (const item of [value].flat()) params.append(name, item);
  }
  return params;
}

// Client HTTP qui garde le cookie de session et le dernier jeton CSRF reçu.
function createClient(baseUrl) {
  let cookie = '';
  let csrfToken = '';

  async function request(method, path, form) {
    const response = await fetch(baseUrl + path, {
      method,
      redirect: 'manual',
      headers: form
        ? { cookie, 'content-type': 'application/x-www-form-urlencoded' }
        : { cookie },
      body: form ? formBody(form) : undefined,
    });
    const setCookie = response.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0];
    const body = await response.text();
    const token = body.match(/name="_csrf" value="([^"]+)"/);
    if (token) csrfToken = token[1];
    return {
      status: response.status,
      location: response.headers.get('location'),
      setCookie,
      body,
    };
  }

  return {
    get: (path) => request('GET', path),
    post: (path, form = {}) => request('POST', path, { _csrf: csrfToken, ...form }),
    postWithoutCsrf: (path, form = {}) => request('POST', path, form),
    async login(email, password) {
      await request('GET', '/login');
      return request('POST', '/login', { _csrf: csrfToken, email, password });
    },
  };
}
