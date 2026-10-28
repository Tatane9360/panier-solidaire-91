import { Router } from 'express';
import { requireRole } from '../../shared/access.js';
import { COLD_LABELS } from '../../shared/html.js';
import { availableBatchesPage, coldCapacityPage, reservationRefusedPage } from './pages.js';

// Consulter les lots disponibles, les réserver et déclarer sa capacité de froid (association).
export function reserveBatchRoutes({ db, clock }) {
  const router = Router();
  const associationOnly = requireRole('ASSOCIATION');

  async function readColdCapacity(accountId) {
    const { rows } = await db.query('SELECT cold_capacity FROM account WHERE id = $1', [accountId]);
    return rows[0].cold_capacity;
  }

  // Lot disponible : DECLARED, date limite (jour de Paris) et créneau non dépassés,
  // d'après l'horloge et sans attendre le planificateur.
  // Le filtre par capacité de froid est actif sauf avec ?all=1.
  router.get('/available-batches', associationOnly, async (req, res) => {
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
    res.send(availableBatchesPage({
      session: req.session,
      batches: rows,
      coldCapacity,
      filtered,
      reserved: req.query.reserved === '1',
    }));
  });

  // Réserver : le verrou FOR UPDATE fait attendre une réservation simultanée du même lot,
  // qui voit ensuite le lot RESERVED. L'index unique partiel de `reservation` le garantit aussi en base.
  router.post('/batches/:id/reserve', associationOnly, async (req, res) => {
    const reservedByName = String(req.body.reserved_by_name ?? '').trim();
    // Plus de 9 chiffres pourrait dépasser une colonne `integer` : un tel lot n'existe pas.
    if (!/^\d{1,9}$/.test(req.params.id)) {
      return res.status(404).send(reservationRefusedPage({ message: 'Lot introuvable.' }));
    }
    if (!reservedByName) {
      return res.status(400).send(reservationRefusedPage({ message: 'Indiquez le prénom du bénévole qui retirera le lot.' }));
    }

    const now = clock.now();
    const refusal = await db.withTransaction(async (client) => {
      const { rows } = await client.query(
        'SELECT status, pickup_end, cold_requirement FROM batch WHERE id = $1 FOR UPDATE',
        [req.params.id],
      );
      const batch = rows[0];
      const { rows: [association] } = await client.query(
        'SELECT cold_capacity FROM account WHERE id = $1',
        [req.session.account.id],
      );
      // Refus : rien n'est écrit, la fin de la transaction libère seulement le verrou.
      if (!batch) return { status: 404, message: 'Lot introuvable.' };
      if (batch.status === 'RESERVED') return { status: 409, message: 'Lot déjà réservé.' };
      if (batch.status !== 'DECLARED') return { status: 409, message: 'Ce lot n’est plus disponible.' };
      if (batch.pickup_end <= now) return { status: 409, message: 'Le créneau de retrait de ce lot est dépassé.' };
      // Obligation sanitaire : refus bloquant.
      if (!association.cold_capacity.includes(batch.cold_requirement)) {
        return { status: 409, message: 'Ce lot demande un niveau de froid que votre association ne sait pas respecter.', coldCapacityLink: true };
      }

      await client.query(
        `INSERT INTO reservation (batch_id, association_id, reserved_at, reserved_by_name)
         VALUES ($1, $2, $3, $4)`,
        [req.params.id, req.session.account.id, now, reservedByName],
      );
      await client.query("UPDATE batch SET status = 'RESERVED' WHERE id = $1", [req.params.id]);
      return null;
    });

    if (refusal) return res.status(refusal.status).send(reservationRefusedPage(refusal));
    res.redirect(303, '/available-batches?reserved=1');
  });

  router.get('/cold-capacity', associationOnly, async (req, res) => {
    const coldCapacity = await readColdCapacity(req.session.account.id);
    res.send(coldCapacityPage({ session: req.session, coldCapacity, saved: req.query.saved === '1' }));
  });

  // Aucune case cochée : le champ est absent. Une seule : une chaîne. Plusieurs : un tableau.
  // Le Set retire les doublons : la capacité est un ensemble.
  // La nouvelle capacité vaut pour les réservations futures seulement.
  router.post('/cold-capacity', associationOnly, async (req, res) => {
    const coldCapacity = [...new Set([req.body.cold_capacity ?? []].flat())];
    let error = '';
    // Une capacité vide masquerait tous les lots : c'est presque toujours une case décochée par erreur.
    if (coldCapacity.length === 0) error = 'Cochez au moins une case.';
    else if (!coldCapacity.every((level) => Object.keys(COLD_LABELS).includes(level))) error = 'Niveau de froid inconnu.';
    if (error) {
      return res.status(400).send(coldCapacityPage({
        session: req.session,
        coldCapacity: await readColdCapacity(req.session.account.id),
        error,
      }));
    }
    await db.query('UPDATE account SET cold_capacity = $1 WHERE id = $2', [coldCapacity, req.session.account.id]);
    res.redirect(303, '/cold-capacity?saved=1');
  });

  return router;
}
