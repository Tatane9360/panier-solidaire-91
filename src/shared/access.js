// Contrôle d'accès centralisé. Il a lieu avant toute transaction.
import { errorPage } from './html.js';

const SAFE_METHODS = new Set(['GET', 'HEAD']);

// Pour toutes les actions (POST…) : sans session connectée → 401,
// sauf les actions publiques ; puis jeton CSRF invalide → 403.
export function protectActions({ publicActions }) {
  return (req, res, next) => {
    if (SAFE_METHODS.has(req.method)) return next();
    if (!req.session.account && !publicActions.includes(req.path)) {
      return res.status(401).send(errorPage('Connexion requise'));
    }
    if (req.body?._csrf !== req.session.csrfToken) {
      return res.status(403).send(errorPage('Jeton de sécurité invalide : rechargez la page'));
    }
    next();
  };
}

// Pour chaque route protégée : sans session, redirection vers la connexion
// (une action sans session a déjà reçu 401 dans protectActions) ;
// autre profil ou compte non ACTIVE → 403.
export function requireRole(...roles) {
  return (req, res, next) => {
    const account = req.session.account;
    if (!account) return res.redirect(303, '/login');
    if (account.status !== 'ACTIVE' || !roles.includes(account.role)) {
      return res.status(403).send(errorPage('Accès refusé'));
    }
    next();
  };
}
