import { Router } from 'express';
import { requireRole } from '../../shared/access.js';
import { errorPage } from '../../shared/html.js';
import { hashPassword, verifyPassword } from '../../shared/password.js';
import { loginPage, homePage, registerPage, registeredPage, registrationsPage } from './pages.js';

const WRONG_CREDENTIALS = 'Adresse e-mail ou mot de passe incorrect.';
const NOT_ACTIVE = 'Compte non actif : votre inscription n’a pas été validée.';
const INCOMPLETE_REGISTRATION = 'Tous les champs sont obligatoires, et le type doit être commerce ou association.';
const EMAIL_TAKEN = 'Cette adresse e-mail est déjà utilisée par un compte.';

export function accountsRoutes({ db, notifications, clock }) {
  const router = Router();

  router.get('/login', (req, res) => {
    res.send(loginPage({ session: req.session }));
  });

  router.post('/login', async (req, res) => {
    const email = String(req.body.email ?? '').trim();
    const password = String(req.body.password ?? '');
    const { rows } = await db.query(
      'SELECT id, status, password_hash FROM account WHERE email = $1',
      [email],
    );
    const account = rows[0];

    // Un compte anonymisé n'a plus de mot de passe : il ne peut plus se connecter.
    const passwordOk = account?.password_hash
      ? await verifyPassword(password, account.password_hash)
      : false;
    if (!passwordOk || account.status === 'ANONYMIZED') {
      return res.status(401).send(loginPage({ session: req.session, error: WRONG_CREDENTIALS, email }));
    }
    if (account.status !== 'ACTIVE') {
      return res.status(403).send(loginPage({ session: req.session, error: NOT_ACTIVE, email }));
    }

    await req.startSession(account.id);
    res.redirect(303, '/');
  });

  router.get('/register', (req, res) => {
    res.send(registerPage({ session: req.session }));
  });

  router.post('/register', async (req, res) => {
    const values = {
      organization_name: String(req.body.organization_name ?? '').trim(),
      role: String(req.body.role ?? ''),
      address: String(req.body.address ?? '').trim(),
      email: String(req.body.email ?? '').trim(),
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
      return res.status(404).send(errorPage('Inscription introuvable ou déjà traitée'));
    }
    const { rows } = await db.query(
      `UPDATE account SET status = $1, decided_by = $2, decided_at = $3, refusal_reason = $4
       WHERE id = $5 AND status = 'PENDING'
       RETURNING email`,
      [approved ? 'ACTIVE' : 'REFUSED', req.session.account.id, clock.now(), refusalReason, id],
    );
    if (rows.length === 0) {
      return res.status(404).send(errorPage('Inscription introuvable ou déjà traitée'));
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
