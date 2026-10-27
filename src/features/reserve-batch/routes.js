import { Router } from 'express';
import { requireRole } from '../../shared/access.js';
import { COLD_LABELS } from '../../shared/html.js';
import { availableBatchesPage, coldCapacityPage } from './pages.js';

// Consulter les lots disponibles et déclarer sa capacité de froid (association).
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
      `SELECT batch.nature, batch.quantity, batch.quantity_unit, batch.weight_kg,
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
    res.send(availableBatchesPage({ batches: rows, coldCapacity, filtered }));
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
