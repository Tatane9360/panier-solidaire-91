// Tâche du Planificateur, lancée toutes les heures par le serveur.
import { expireEndedBatches } from '../../shared/expiration.js';

export async function expireBatches({ db, clock }) {
  const now = clock.now();
  await expireEndedBatches(db, now);
  await db.query('DELETE FROM session WHERE expires_at <= $1', [now]);
  // Passé 15 minutes, un échec ne sert plus au blocage : on ne garde pas cette donnée personnelle.
  await db.query("DELETE FROM login_failure WHERE failed_at <= $1::timestamptz - interval '15 minutes'", [now]);
}
