import { fileURLToPath } from 'node:url';
import express from 'express';
import { sessions } from './shared/sessions.js';
import { protectActions } from './shared/access.js';
import { accountsRoutes } from './features/accounts/routes.js';
import { declareBatchRoutes } from './features/declare-batch/routes.js';
import { reserveBatchRoutes } from './features/reserve-batch/routes.js';

const publicDir = fileURLToPath(new URL('../public/', import.meta.url));

// Construit l'application à partir de ses dépendances : base, notifications, horloge.
export function buildApp({ db, notifications, clock, config }) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.static(publicDir));
  app.use(express.urlencoded({ extended: false }));
  app.use(sessions({ db, clock, config }));
  app.use(protectActions({ publicActions: ['/login', '/register'] }));
  app.use(accountsRoutes({ db, notifications, clock }));
  app.use(declareBatchRoutes({ db, clock }));
  app.use(reserveBatchRoutes({ db, notifications, clock }));
  return app;
}
