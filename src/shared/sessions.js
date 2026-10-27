// Sessions en base (table `session`), prolongées à chaque requête.
// Un visiteur reçoit une session anonyme : elle porte le jeton CSRF du formulaire de connexion.
import { randomBytes } from 'node:crypto';

const COOKIE_NAME = 'sid';

export function sessions({ db, clock, config }) {
  const durationMs = config.sessionDurationMinutes * 60_000;
  const newExpiry = () => new Date(clock.now().getTime() + durationMs);

  function setCookie(res, value, maxAge = '') {
    const secure = config.secureCookies ? '; Secure' : '';
    res.setHeader(
      'Set-Cookie',
      `${COOKIE_NAME}=${value}; Path=/; HttpOnly; SameSite=Lax${secure}${maxAge}`,
    );
  }

  async function createSession(res, accountId) {
    const session = {
      sid: randomBytes(32).toString('hex'),
      csrfToken: randomBytes(32).toString('hex'),
      account: null,
    };
    await db.query(
      'INSERT INTO session (sid, account_id, csrf_token, expires_at) VALUES ($1, $2, $3, $4)',
      [session.sid, accountId, session.csrfToken, newExpiry()],
    );
    setCookie(res, session.sid);
    return session;
  }

  return async function sessionMiddleware(req, res, next) {
    const sid = readCookie(req.headers.cookie, COOKIE_NAME);
    const { rows } = await db.query(
      `SELECT session.sid, session.csrf_token, account.id, account.role, account.status, account.organization_name
       FROM session LEFT JOIN account ON account.id = session.account_id
       WHERE session.sid = $1 AND session.expires_at > $2`,
      [sid ?? '', clock.now()],
    );

    if (rows.length === 1) {
      const row = rows[0];
      await db.query('UPDATE session SET expires_at = $1 WHERE sid = $2', [newExpiry(), row.sid]);
      req.session = {
        sid: row.sid,
        csrfToken: row.csrf_token,
        account: row.id
          ? { id: row.id, role: row.role, status: row.status, organization_name: row.organization_name }
          : null,
      };
    } else {
      req.session = await createSession(res, null);
    }

    // Nouveau `sid` à la connexion, pour qu'un identifiant connu avant ne serve plus.
    req.startSession = async (accountId) => {
      await db.query('DELETE FROM session WHERE sid = $1', [req.session.sid]);
      req.session = await createSession(res, accountId);
    };
    req.endSession = async () => {
      await db.query('DELETE FROM session WHERE sid = $1', [req.session.sid]);
      setCookie(res, '', '; Max-Age=0');
    };
    next();
  };
}

function readCookie(header, name) {
  for (const part of (header ?? '').split(';')) {
    const [key, value] = part.trim().split('=');
    if (key === name) return value;
  }
  return undefined;
}
