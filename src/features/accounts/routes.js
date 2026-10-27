import { Router } from 'express';
import { requireRole } from '../../shared/access.js';
import { verifyPassword } from '../../shared/password.js';
import { loginPage, homePage } from './pages.js';

const WRONG_CREDENTIALS = 'Adresse e-mail ou mot de passe incorrect.';
const NOT_ACTIVE = 'Compte non actif : votre inscription n’a pas été validée.';

export function accountsRoutes({ db }) {
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

  router.post('/logout', async (req, res) => {
    await req.endSession();
    res.redirect(303, '/login');
  });

  router.get('/', requireRole('STORE', 'ASSOCIATION', 'COORDINATOR'), (req, res) => {
    res.send(homePage({ session: req.session }));
  });

  return router;
}
