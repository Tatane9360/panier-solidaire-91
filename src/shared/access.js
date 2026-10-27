// Contrôle d'accès centralisé. Il a lieu avant toute transaction.

const SAFE_METHODS = new Set(['GET', 'HEAD']);

// Pour toutes les actions (POST…) : sans session connectée → 401,
// sauf les actions publiques ; puis jeton CSRF invalide → 403.
export function protectActions({ publicActions }) {
  return (req, res, next) => {
    if (SAFE_METHODS.has(req.method)) return next();
    if (!req.session.account && !publicActions.includes(req.path)) {
      return res.status(401).send('Connexion requise.');
    }
    if (req.body?._csrf !== req.session.csrfToken) {
      return res.status(403).send('Jeton de sécurité invalide. Rechargez la page.');
    }
    next();
  };
}

// Pour chaque route protégée : page sans session → connexion ;
// autre profil ou compte non ACTIVE → 403.
export function requireRole(...roles) {
  return (req, res, next) => {
    const account = req.session.account;
    if (!account) {
      if (SAFE_METHODS.has(req.method)) return res.redirect(303, '/login');
      return res.status(401).send('Connexion requise.');
    }
    if (account.status !== 'ACTIVE' || !roles.includes(account.role)) {
      return res.status(403).send('Accès refusé.');
    }
    next();
  };
}
