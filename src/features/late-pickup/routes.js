import { Router } from 'express';
import { requireRole } from '../../shared/access.js';
import { writeHistory } from '../../shared/batch-history.js';
import { isDateTime } from '../../shared/batch-form.js';
import { errorPage, formatLocal } from '../../shared/html.js';
import { PICKUP_CONFIRMATION_WINDOW_HOURS } from '../../shared/pickup-window.js';
import { latePickupPage } from './pages.js';

const NOT_FOUND = 'Lot introuvable.';

// Plus de 9 chiffres pourrait dépasser une colonne `integer` : un tel lot n'existe pas.
const isBatchId = (id) => /^\d{1,9}$/.test(id);

// Lot expiré avec sa réservation active : l'association est celle de la réservation.
const SELECT_BATCH = `
  SELECT batch.id, batch.nature, batch.status, batch.store_id, batch.pickup_end,
         to_char(batch.pickup_start AT TIME ZONE 'Europe/Paris', 'YYYY-MM-DD"T"HH24:MI') AS pickup_start,
         to_char(batch.pickup_end AT TIME ZONE 'Europe/Paris', 'YYYY-MM-DD"T"HH24:MI') AS pickup_end_local,
         batch.pickup_start AS pickup_start_instant,
         store.organization_name AS store_name, association.organization_name AS association_name
  FROM batch
  JOIN account store ON store.id = batch.store_id
  LEFT JOIN reservation ON reservation.batch_id = batch.id AND reservation.cancelled_at IS NULL
  LEFT JOIN account association ON association.id = reservation.association_id
  WHERE batch.id = $1`;

// Refus dans la transaction : code HTTP et message.
class Refused extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Pourquoi la collecte tardive est impossible pour ce lot, ou null si elle est possible.
// Sans réservation active (association_name nul), un lot expiré ne devient jamais COLLECTED.
function whyNotPossible(batch, now) {
  if (batch.status !== 'EXPIRED' || !batch.association_name) {
    return 'Ce lot n’est pas un lot expiré réservé : sa collecte ne peut pas être enregistrée.';
  }
  // Fenêtre de l'association close dès que l'horloge atteint pickup_end + 24 h.
  if (now.getTime() < batch.pickup_end.getTime() + PICKUP_CONFIRMATION_WINDOW_HOURS * 60 * 60_000) {
    return 'Le créneau de ce lot est terminé depuis moins de 24 h : l’association peut encore confirmer la collecte.';
  }
  return null;
}

// Collecte tardive d'un lot EXPIRED (Coordination), depuis le suivi.
export function latePickupRoutes({ db, notifications, clock }) {
  const router = Router();
  const coordinatorOnly = requireRole('COORDINATOR');

  async function sendForm(res, session, batchId, { values = {}, errors = {}, status = 200 }) {
    const { rows: [batch] } = await db.query(SELECT_BATCH, [batchId]);
    if (!batch) return res.status(404).send(errorPage(NOT_FOUND));
    const refusal = whyNotPossible(batch, clock.now());
    if (refusal) return res.status(409).send(errorPage(refusal));
    return res.status(status).send(latePickupPage({ session, batch, values, errors }));
  }

  router.get('/monitoring/batches/:id/late-pickup', coordinatorOnly, (req, res) => {
    if (!isBatchId(req.params.id)) return res.status(404).send(errorPage(NOT_FOUND));
    return sendForm(res, req.session, req.params.id, {});
  });

  // Le verrou FOR UPDATE sur le lot sérialise la collecte tardive avec une confirmation
  // de l'association ou une annulation simultanée. Le statut est vérifié avant la saisie.
  router.post('/monitoring/batches/:id/late-pickup', coordinatorOnly, async (req, res) => {
    if (!isBatchId(req.params.id)) return res.status(404).send(errorPage(NOT_FOUND));
    const values = {
      collected_at: String(req.body.collected_at ?? '').trim(),
      reason: String(req.body.reason ?? '').trim(),
    };
    const now = clock.now();
    let result;
    try {
      result = await db.withTransaction(async (client) => {
        const { rows: [batch] } = await client.query(`${SELECT_BATCH} FOR UPDATE OF batch`, [req.params.id]);
        if (!batch) throw new Refused(404, NOT_FOUND);
        const refusal = whyNotPossible(batch, now);
        if (refusal) throw new Refused(409, refusal);
        const errors = {};
        let instant;
        let utc_offset;
        if (!values.reason) errors.reason = 'Le motif est obligatoire.';
        if (!isDateTime(values.collected_at)) {
          errors.collected_at = 'Date et heure invalides.';
        } else {
          // Paris est toujours à l'est de UTC : le décalage s'écrit avec un « + ».
          ({ rows: [{ instant, utc_offset }] } = await client.query(
            `SELECT $1::timestamp AT TIME ZONE 'Europe/Paris' AS instant,
                    to_char($1::timestamp AT TIME ZONE 'UTC' - $1::timestamp AT TIME ZONE 'Europe/Paris', '"+"HH24:MI') AS utc_offset`,
            [values.collected_at],
          ));
          if (instant < batch.pickup_start_instant) errors.collected_at = 'La collecte ne peut pas précéder le début du créneau.';
          else if (instant > now) errors.collected_at = 'La collecte ne peut pas être dans le futur.';
        }
        if (Object.keys(errors).length > 0) return { errors };

        // expired_at est conservé : seul le statut et collected_at changent.
        await client.query("UPDATE batch SET status = 'COLLECTED', collected_at = $2::timestamp AT TIME ZONE 'Europe/Paris' WHERE id = $1", [batch.id, values.collected_at]);
        const accountId = req.session.account.id;
        const history = { batchId: batch.id, accountId, changedAt: now, reason: values.reason };
        await writeHistory(client, { ...history, field: 'status', oldValue: 'EXPIRED', newValue: 'COLLECTED' });
        await writeHistory(client, { ...history, field: 'collected_at', oldValue: null, newValue: values.collected_at + utc_offset });
        return { batch };
      });
    } catch (error) {
      if (!(error instanceof Refused)) throw error;
      return res.status(error.status).send(errorPage(error.message));
    }
    if (result.errors) {
      return sendForm(res, req.session, req.params.id, { values, errors: result.errors, status: 400 });
    }
    // Après le COMMIT : un second envoi trouve le lot COLLECTED et est refusé, d'où une seule notification.
    await notifications.batchCollected({
      storeId: result.batch.store_id,
      nature: result.batch.nature,
      collectedAt: formatLocal(values.collected_at),
    });
    return res.redirect(303, '/monitoring/batches');
  });

  return router;
}
