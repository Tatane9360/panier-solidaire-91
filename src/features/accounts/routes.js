import { randomBytes } from 'node:crypto';
import { Router } from 'express';
import { requireRole } from '../../shared/access.js';
import { errorPage } from '../../shared/html.js';
import { hashPassword, verifyPassword } from '../../shared/password.js';
import { loginPage, homePage, registerPage, registeredPage, registrationsPage, alreadyLoggedInPage } from './pages.js';

const WRONG_CREDENTIALS = 'Adresse e-mail ou mot de passe incorrect.';
// Même message que l'e-mail existe ou non.
const BLOCKED = 'Trop de tentatives de connexion : la connexion est bloquée pendant 15 minutes.';
const NOT_ACTIVE = 'Compte non actif : votre inscription n’a pas été validée.';
const INCOMPLETE_REGISTRATION = 'Tous les champs sont obligatoires, et le type doit être commerce ou association.';
const EMAIL_TAKEN = 'Cette adresse e-mail est déjà utilisée par un compte.';
const REGISTRATION_NOT_FOUND = 'Inscription introuvable ou déjà traitée';

// Hash d'un mot de passe aléatoire, que personne ne connaît (voir POST /login).
const DUMMY_HASH = await hashPassword(randomBytes(16).toString('hex'));

export function accountsRoutes({ db, notifications, clock }) {
  const router = Router();

  router.get('/login', (req, res) => {
    res.send(loginPage({ session: req.session }));
  });

  router.post('/login', async (req, res) => {
    const email = String(req.body.email ?? '').trim().toLowerCase();
    const password = String(req.body.password ?? '');
    const now = clock.now();

    const result = await db.withTransaction(async (client) => {
      // Un verrou par e-mail : les tentatives simultanées pour un même e-mail passent une par une,
      // sinon une rafale de requêtes testerait plus de 5 mots de passe avant le blocage.
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [email]);

      // Bloqué : refus sans vérifier le mot de passe, et la tentative n'est pas comptée.
      const block = await client.query(
        `SELECT 1 FROM login_failure
         WHERE email = $1 AND starts_block AND failed_at > $2::timestamptz - interval '15 minutes'`,
        [email, now],
      );
      if (block.rowCount > 0) return { blocked: true };

      const { rows } = await client.query(
        'SELECT id, status, password_hash FROM account WHERE email = $1',
        [email],
      );
      const account = rows[0];

      // Sans compte, ou compte anonymisé (sans mot de passe), on vérifie quand même contre un faux
      // hash : la réponse prend le même temps et ne révèle pas si l'e-mail existe.
      const hash = account?.password_hash ?? DUMMY_HASH;
      const passwordOk = (await verifyPassword(password, hash)) && hash !== DUMMY_HASH;
      if (!passwordOk || account.status === 'ANONYMIZED') {
        // Cet échec est le 5e en 15 minutes si 4 autres le précèdent dans la fenêtre.
        const failure = await client.query(
          `INSERT INTO login_failure (email, failed_at, starts_block)
           SELECT $1, $2, count(*) >= 4 FROM login_failure
           WHERE email = $1 AND failed_at > $2::timestamptz - interval '15 minutes'
           RETURNING starts_block`,
          [email, now],
        );
        return { blocked: failure.rows[0].starts_block, wrongCredentials: true };
      }
      if (account.status === 'ACTIVE') {
        // Une connexion réussie remet le compteur d'échecs à zéro.
        await client.query('DELETE FROM login_failure WHERE email = $1', [email]);
      }
      return { account };
    });

    if (result.blocked) {
      return res.status(429).send(loginPage({ session: req.session, error: BLOCKED, email }));
    }
    if (result.wrongCredentials) {
      return res.status(401).send(loginPage({ session: req.session, error: WRONG_CREDENTIALS, email }));
    }
    if (result.account.status !== 'ACTIVE') {
      return res.status(403).send(loginPage({ session: req.session, error: NOT_ACTIVE, email }));
    }
    await req.startSession(result.account.id);
    res.redirect(303, '/');
  });

  // Une personne connectée doit se déconnecter avant d'inscrire une autre structure
  // (par exemple un autre site de son commerce).
  router.get('/register', (req, res) => {
    if (req.session.account) return res.send(alreadyLoggedInPage({ session: req.session }));
    res.send(registerPage({ session: req.session }));
  });

  router.post('/register', async (req, res) => {
    if (req.session.account) return res.status(403).send(alreadyLoggedInPage({ session: req.session }));
    const values = {
      organization_name: String(req.body.organization_name ?? '').trim(),
      role: String(req.body.role ?? ''),
      address: String(req.body.address ?? '').trim(),
      email: String(req.body.email ?? '').trim().toLowerCase(),
    };
    const password = String(req.body.password ?? '');
    const missing = !values.organization_name || !values.address || !values.email || !password;
    // Les COORDINATOR ne s'inscrivent pas : ils sont créés par le script d'installation.
    if (missing || !['STORE', 'ASSOCIATION'].includes(values.role)) {
      return res.status(400).send(registerPage({ session: req.session, error: INCOMPLETE_REGISTRATION, values }));
    }

    // L'index unique sur l'e-mail tranche, y compris pour deux inscriptions simultanées.
    const { rowCount } = await db.query(
      `INSERT INTO account (territory_id, role, status, email, password_hash, organization_name, address, created_at)
       VALUES ((SELECT min(id) FROM territory), $1, 'PENDING', $2, $3, $4, $5, $6)
       ON CONFLICT (email) DO NOTHING`,
      [values.role, values.email, await hashPassword(password), values.organization_name, values.address, clock.now()],
    );
    if (rowCount === 0) {
      return res.status(409).send(registerPage({ session: req.session, error: EMAIL_TAKEN, values }));
    }
    res.send(registeredPage());
  });

  router.get('/registrations', requireRole('COORDINATOR'), async (req, res) => {
    const { rows } = await db.query(
      `SELECT id, role, email, organization_name, address FROM account
       WHERE status = 'PENDING' ORDER BY created_at, id`,
    );
    res.send(registrationsPage({ session: req.session, accounts: rows }));
  });

  // Valider ou refuser : seul un compte encore PENDING change de statut.
  async function decide(req, res, { approved, refusalReason }) {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(404).send(errorPage(REGISTRATION_NOT_FOUND));
    }
    const { rows } = await db.query(
      `UPDATE account SET status = $1, decided_by = $2, decided_at = $3, refusal_reason = $4
       WHERE id = $5 AND status = 'PENDING'
       RETURNING email`,
      [approved ? 'ACTIVE' : 'REFUSED', req.session.account.id, clock.now(), refusalReason, id],
    );
    if (rows.length === 0) {
      return res.status(404).send(errorPage(REGISTRATION_NOT_FOUND));
    }
    await notifications.registrationDecided({ email: rows[0].email, approved, refusalReason });
    res.redirect(303, '/registrations');
  }

  router.post('/registrations/:id/approve', requireRole('COORDINATOR'), (req, res) =>
    decide(req, res, { approved: true, refusalReason: null }),
  );

  router.post('/registrations/:id/refuse', requireRole('COORDINATOR'), (req, res) =>
    decide(req, res, { approved: false, refusalReason: String(req.body.refusal_reason ?? '').trim() || null }),
  );

  router.post('/logout', async (req, res) => {
    await req.endSession();
    res.redirect(303, '/login');
  });

  router.get('/', requireRole('STORE', 'ASSOCIATION', 'COORDINATOR'), (req, res) => {
    res.send(homePage({ session: req.session }));
  });

  return router;
}
