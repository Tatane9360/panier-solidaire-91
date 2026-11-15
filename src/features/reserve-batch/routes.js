import { Router } from 'express';
import { requireRole } from '../../shared/access.js';
import { COLD_LABELS, formatLocal } from '../../shared/html.js';
import { PICKUP_CONFIRMATION_WINDOW_HOURS } from '../../shared/pickup-window.js';
import { releaseReservation } from '../../shared/reservations.js';
import {
  availableBatchesPage, coldCapacityPage, reservationRefusedPage, reservationsPage, cancellationRefusedPage, collectionRefusedPage,
} from './pages.js';

const NOT_FOUND = 'Lot introuvable.';

// Plus de 9 chiffres pourrait dépasser une colonne `integer` : un tel lot n'existe pas.
const isBatchId = (id) => /^\d{1,9}$/.test(id);

// Refus d'une réservation ou de son annulation : code HTTP et message affiché à l'association.
class BatchActionRefused extends Error {
  constructor(status, message, coldCapacityLink = false) {
    super(message);
    this.status = status;
    this.coldCapacityLink = coldCapacityLink;
  }
}

// Prénom du bénévole manquant. Levée après les contrôles d'accès et d'état du lot :
// une association qui n'a pas le droit d'agir sur ce lot reçoit d'abord ce refus-là.
class MissingVolunteerName extends Error {}

// Consulter les lots disponibles, les réserver, annuler sa réservation
// et déclarer sa capacité de froid (association).
export function reserveBatchRoutes({ db, notifications, clock }) {
  const router = Router();
  const associationOnly = requireRole('ASSOCIATION');

  async function readColdCapacity(accountId) {
    const { rows } = await db.query('SELECT cold_capacity FROM account WHERE id = $1', [accountId]);
    return rows[0].cold_capacity;
  }

  async function sendColdCapacityPage(req, res, { status = 200, error = '' } = {}) {
    res.status(status).send(coldCapacityPage({
      session: req.session,
      coldCapacity: await readColdCapacity(req.session.account.id),
      saved: req.query.saved === '1',
      error,
    }));
  }

  // Lot disponible : DECLARED, date limite (jour de Paris) et créneau non dépassés,
  // d'après l'horloge et sans attendre le planificateur.
  // Le filtre par capacité de froid est actif sauf avec ?all=1.
  // `nameError` : identifiant du lot dont le prénom du bénévole manquait.
  async function sendAvailableBatches(req, res, { status = 200, nameError = null } = {}) {
    const coldCapacity = await readColdCapacity(req.session.account.id);
    const filtered = req.query.all !== '1';
    const { rows } = await db.query(
      `SELECT batch.id, batch.nature, batch.quantity, batch.quantity_unit, batch.weight_kg,
              to_char(batch.expiry_date, 'YYYY-MM-DD') AS expiry_date, batch.date_type,
              to_char(batch.pickup_start AT TIME ZONE 'Europe/Paris', 'YYYY-MM-DD"T"HH24:MI') AS pickup_start,
              to_char(batch.pickup_end AT TIME ZONE 'Europe/Paris', 'YYYY-MM-DD"T"HH24:MI') AS pickup_end,
              batch.cold_requirement, store.organization_name, store.address
       FROM batch JOIN account AS store ON store.id = batch.store_id
       WHERE batch.status = 'DECLARED'
         AND batch.pickup_end > $1
         AND batch.expiry_date >= ($1::timestamptz AT TIME ZONE 'Europe/Paris')::date
         AND (NOT $2 OR batch.cold_requirement = ANY ($3))
       ORDER BY batch.expiry_date, batch.pickup_end, batch.id`,
      [clock.now(), filtered, coldCapacity],
    );
    res.status(status).send(availableBatchesPage({
      session: req.session,
      batches: rows,
      coldCapacity,
      filtered,
      reserved: req.query.reserved === '1',
      nameError,
    }));
  }

  router.get('/available-batches', associationOnly, (req, res) => sendAvailableBatches(req, res));

  // Réserver : le verrou FOR UPDATE fait attendre une réservation simultanée du même lot,
  // qui voit ensuite le lot RESERVED. L'index unique partiel de `reservation` est un filet
  // de sécurité en base : s'il se déclenchait malgré le verrou, la requête finirait en erreur 500.
  router.post('/batches/:id/reserve', associationOnly, async (req, res) => {
    const reservedByName = String(req.body.reserved_by_name ?? '').trim();
    if (!isBatchId(req.params.id)) {
      return res.status(404).send(reservationRefusedPage({ message: NOT_FOUND }));
    }
    const now = clock.now();
    try {
      await db.withTransaction(async (client) => {
        const { rows: [batch] } = await client.query(
          'SELECT status, pickup_end, cold_requirement FROM batch WHERE id = $1 FOR UPDATE',
          [req.params.id],
        );
        const { rows: [account] } = await client.query(
          'SELECT cold_capacity FROM account WHERE id = $1',
          [req.session.account.id],
        );
        // Chaque refus lève une BatchActionRefused : withTransaction fait alors ROLLBACK.
        if (!batch) throw new BatchActionRefused(404, NOT_FOUND);
        if (batch.status === 'RESERVED') throw new BatchActionRefused(409, 'Lot déjà réservé.');
        if (batch.status !== 'DECLARED') throw new BatchActionRefused(409, 'Ce lot n’est plus disponible.');
        if (batch.pickup_end <= now) throw new BatchActionRefused(409, 'Le créneau de retrait de ce lot est dépassé.');
        // Obligation sanitaire : refus bloquant.
        if (!account.cold_capacity.includes(batch.cold_requirement)) {
          throw new BatchActionRefused(
            409,
            'Ce lot demande un niveau de froid que votre association ne sait pas respecter.',
            true,
          );
        }
        if (!reservedByName) throw new MissingVolunteerName();

        await client.query(
          `INSERT INTO reservation (batch_id, association_id, reserved_at, reserved_by_name)
           VALUES ($1, $2, $3, $4)`,
          [req.params.id, req.session.account.id, now, reservedByName],
        );
        await client.query("UPDATE batch SET status = 'RESERVED' WHERE id = $1", [req.params.id]);
      });
    } catch (error) {
      // La liste est réaffichée, l'erreur reliée au champ du lot concerné.
      if (error instanceof MissingVolunteerName) {
        return sendAvailableBatches(req, res, { status: 400, nameError: Number(req.params.id) });
      }
      if (!(error instanceof BatchActionRefused)) throw error;
      return res.status(error.status).send(reservationRefusedPage(error));
    }
    res.redirect(303, '/available-batches?reserved=1');
  });

  // Mes réservations : réservations actives de l'association dont la collecte reste confirmable,
  // c'est-à-dire sur un lot RESERVED, ou EXPIRED depuis moins de 24 h après la fin du créneau.
  // Créneau terminé : le lot reste affiché, sans bouton d'annulation.
  // `nameError` : identifiant du lot dont le prénom du bénévole manquait.
  async function sendReservations(req, res, { status = 200, nameError = null } = {}) {
    const { rows } = await db.query(
      `SELECT batch.id, batch.nature, batch.quantity, batch.quantity_unit, batch.weight_kg,
              to_char(batch.pickup_start AT TIME ZONE 'Europe/Paris', 'YYYY-MM-DD"T"HH24:MI') AS pickup_start,
              to_char(batch.pickup_end AT TIME ZONE 'Europe/Paris', 'YYYY-MM-DD"T"HH24:MI') AS pickup_end,
              reservation.reserved_by_name, store.organization_name, store.address,
              batch.status = 'RESERVED' AND batch.pickup_end > $2 AS cancellable
       FROM reservation
       JOIN batch ON batch.id = reservation.batch_id
       JOIN account AS store ON store.id = batch.store_id
       WHERE reservation.association_id = $1 AND reservation.cancelled_at IS NULL
         AND batch.status IN ('RESERVED', 'EXPIRED')
         AND batch.pickup_end + make_interval(hours => $3) > $2
       ORDER BY batch.pickup_end, batch.id`,
      [req.session.account.id, clock.now(), PICKUP_CONFIRMATION_WINDOW_HOURS],
    );
    res.status(status).send(reservationsPage({
      session: req.session,
      batches: rows,
      cancelled: req.query.cancelled === '1',
      collected: req.query.collected === '1',
      nameError,
    }));
  }

  router.get('/reservations', associationOnly, (req, res) => sendReservations(req, res));

  // Confirmer la collecte : même verrou FOR UPDATE que la réservation et l'annulation.
  // Un lot EXPIRED garde son expired_at. L'e-mail part après le COMMIT : un second envoi
  // du formulaire trouve le lot COLLECTED et est refusé, d'où un seul e-mail par collecte.
  router.post('/batches/:id/confirm-pickup', associationOnly, async (req, res) => {
    const collectedByName = String(req.body.collected_by_name ?? '').trim();
    if (!isBatchId(req.params.id)) {
      return res.status(404).send(collectionRefusedPage({ message: NOT_FOUND }));
    }
    const now = clock.now();
    let collected;
    try {
      collected = await db.withTransaction(async (client) => {
        const { rows: [batch] } = await client.query(
          `SELECT batch.status, batch.pickup_end, batch.nature, batch.store_id, reservation.association_id,
                  to_char($2::timestamptz AT TIME ZONE 'Europe/Paris', 'YYYY-MM-DD"T"HH24:MI') AS collected_at
           FROM batch
           LEFT JOIN reservation ON reservation.batch_id = batch.id AND reservation.cancelled_at IS NULL
           WHERE batch.id = $1
           FOR UPDATE OF batch`,
          [req.params.id, now],
        );
        if (!batch) throw new BatchActionRefused(404, NOT_FOUND);
        // Sans réservation active, l'association n'est pas réservataire : un lot expiré
        // sans réservation ne devient donc jamais COLLECTED.
        if (batch.association_id !== req.session.account.id) {
          throw new BatchActionRefused(403, 'Seule l’association qui a réservé ce lot peut confirmer sa collecte.');
        }
        if (batch.status === 'COLLECTED') throw new BatchActionRefused(409, 'La collecte de ce lot est déjà confirmée.');
        if (!['RESERVED', 'EXPIRED'].includes(batch.status)) {
          throw new BatchActionRefused(409, 'Ce lot n’est plus réservé : sa collecte ne peut pas être confirmée.');
        }
        // Fenêtre close dès que l'horloge atteint pickup_end + 24 h, comme le créneau à pickup_end.
        const windowEnd = batch.pickup_end.getTime() + PICKUP_CONFIRMATION_WINDOW_HOURS * 60 * 60_000;
        if (now.getTime() >= windowEnd) {
          throw new BatchActionRefused(
            409,
            'Le créneau de retrait de ce lot est terminé depuis plus de 24 h : contactez la Coordination pour enregistrer la collecte.',
          );
        }
        if (!collectedByName) throw new MissingVolunteerName();

        await client.query(
          'UPDATE reservation SET collected_by_name = $1 WHERE batch_id = $2 AND cancelled_at IS NULL',
          [collectedByName, req.params.id],
        );
        await client.query("UPDATE batch SET status = 'COLLECTED', collected_at = $1 WHERE id = $2", [now, req.params.id]);
        return batch;
      });
    } catch (error) {
      // La liste est réaffichée, l'erreur reliée au champ du lot concerné.
      if (error instanceof MissingVolunteerName) {
        return sendReservations(req, res, { status: 400, nameError: Number(req.params.id) });
      }
      if (!(error instanceof BatchActionRefused)) throw error;
      return res.status(error.status).send(collectionRefusedPage(error));
    }
    await notifications.batchCollected({
      storeId: collected.store_id,
      nature: collected.nature,
      collectedAt: formatLocal(collected.collected_at),
    });
    res.redirect(303, '/reservations?collected=1');
  });

  // Annuler sa réservation : le verrou FOR UPDATE sur le lot sérialise l'annulation
  // avec une réservation, une collecte ou une expiration simultanées.
  router.post('/batches/:id/cancel-reservation', associationOnly, async (req, res) => {
    if (!isBatchId(req.params.id)) {
      return res.status(404).send(cancellationRefusedPage({ message: NOT_FOUND }));
    }
    const now = clock.now();
    try {
      await db.withTransaction(async (client) => {
        const { rows: [batch] } = await client.query(
          `SELECT batch.status, batch.pickup_end, reservation.association_id
           FROM batch LEFT JOIN reservation ON reservation.batch_id = batch.id AND reservation.cancelled_at IS NULL
           WHERE batch.id = $1
           FOR UPDATE OF batch`,
          [req.params.id],
        );
        if (!batch) throw new BatchActionRefused(404, NOT_FOUND);
        // Seule l'association réservataire : aussi pour un lot sans réservation active.
        if (batch.association_id !== req.session.account.id) {
          throw new BatchActionRefused(403, 'Seule l’association qui a réservé ce lot peut annuler la réservation.');
        }
        if (batch.status !== 'RESERVED') throw new BatchActionRefused(409, 'Ce lot n’est plus réservé : la réservation ne peut plus être annulée.');
        // Créneau terminé, même avant le planificateur : la réservation reste active
        // pour que la collecte puisse encore être enregistrée.
        if (batch.pickup_end <= now) {
          throw new BatchActionRefused(409, 'Le créneau de retrait de ce lot est terminé : la réservation ne peut plus être annulée.');
        }

        await releaseReservation(client, { batchId: req.params.id, cancelledBy: req.session.account.id, now });
        // Pas de notification « Nouveau lot disponible » : le lot n'est pas nouveau.
        await client.query("UPDATE batch SET status = 'DECLARED' WHERE id = $1", [req.params.id]);
      });
    } catch (error) {
      if (!(error instanceof BatchActionRefused)) throw error;
      return res.status(error.status).send(cancellationRefusedPage(error));
    }
    res.redirect(303, '/reservations?cancelled=1');
  });

  router.get('/cold-capacity', associationOnly, (req, res) => sendColdCapacityPage(req, res));

  // Aucune case cochée : le champ est absent. Une seule : une chaîne. Plusieurs : un tableau.
  // Le Set retire les doublons : la capacité est un ensemble.
  // La nouvelle capacité vaut pour les réservations futures seulement.
  router.post('/cold-capacity', associationOnly, async (req, res) => {
    const coldCapacity = [...new Set([req.body.cold_capacity ?? []].flat())];
    let error = '';
    // Une capacité vide masquerait tous les lots : c'est presque toujours une case décochée par erreur.
    if (coldCapacity.length === 0) error = 'Cochez au moins une case.';
    else if (!coldCapacity.every((level) => Object.keys(COLD_LABELS).includes(level))) error = 'Niveau de froid inconnu.';
    if (error) return sendColdCapacityPage(req, res, { status: 400, error });
    await db.query('UPDATE account SET cold_capacity = $1 WHERE id = $2', [coldCapacity, req.session.account.id]);
    res.redirect(303, '/cold-capacity?saved=1');
  });

  return router;
}
