import { buildApp } from './app.js';
import { readConfig } from './shared/config.js';
import { createDb } from './shared/db.js';
import { systemClock } from './shared/clock.js';
import { expireBatches } from './features/expire-batches/expire-batches.js';
import { createNotifications, createSmtpTransport } from './shared/notifications/index.js';

const config = readConfig(process.env);
const db = createDb(config.databaseUrl);
const notifications = createNotifications({
  transport: createSmtpTransport(config.smtp),
  from: config.mailFrom,
  appUrl: config.appUrl,
});

const app = buildApp({ db, notifications, clock: systemClock, config });
app.listen(config.port, () => {
  console.log(`Panier Solidaire 91 : http://localhost:${config.port}`);
});

// Planificateur : au démarrage puis toutes les heures, avec la même base et la même horloge que l'application.
function runScheduler() {
  expireBatches({ db, clock: systemClock }).catch((error) => console.error('Planificateur :', error));
}
runScheduler();
setInterval(runScheduler, 60 * 60_000);
