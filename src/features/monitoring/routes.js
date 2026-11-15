import { Router } from 'express';
import { requireRole } from '../../shared/access.js';
import { errorPage } from '../../shared/html.js';
import { FILTER_NAMES, readFilters } from './filters.js';
import { monitoringPage } from './pages.js';

// Instant d'une colonne en heure de Paris, au format "2026-11-03T14:00".
const parisLocal = (column) => `to_char(${column} AT TIME ZONE 'Europe/Paris', 'YYYY-MM-DD"T"HH24:MI')`;

// Filtres facultatifs : un filtre absent vaut NULL et laisse passer tous les lots.
// L'association est celle de la réservation active ; la période porte sur la date de déclaration (heure de Paris, bornes incluses).
const FROM_WHERE = `
  FROM batch
  JOIN account store ON store.id = batch.store_id
  LEFT JOIN reservation ON reservation.batch_id = batch.id AND reservation.cancelled_at IS NULL
  LEFT JOIN account association ON association.id = reservation.association_id
  WHERE ($1::int IS NULL OR batch.store_id = $1)
    AND ($2::int IS NULL OR reservation.association_id = $2)
    AND ($3::text IS NULL OR batch.status = $3)
    AND ($4::date IS NULL OR batch.created_at >= $4::timestamp AT TIME ZONE 'Europe/Paris')
    AND ($5::date IS NULL OR batch.created_at < ($5::date + 1)::timestamp AT TIME ZONE 'Europe/Paris')`;

// Suivi de tous les lots par la Coordination, paginé.
export function monitoringRoutes({ db, config }) {
  const router = Router();

  router.get('/monitoring/batches', requireRole('COORDINATOR'), async (req, res) => {
    const filters = readFilters(req.query);
    if (!filters) return res.status(400).send(errorPage('Filtre invalide'));

    const values = FILTER_NAMES.map((name) => filters[name]);
    const { rows: [{ total }] } = await db.query(`SELECT count(*)::int AS total ${FROM_WHERE}`, values);
    const pageCount = Math.max(1, Math.ceil(total / config.pageSize));
    // Une page au-delà de la dernière affiche la dernière.
    const pageNumber = Math.min(filters.page, pageCount);

    const { rows: batches } = await db.query(
      `SELECT batch.id, batch.nature, batch.status, store.organization_name AS store_name,
              association.organization_name AS association_name,
              ${parisLocal('batch.created_at')} AS created_at,
              ${parisLocal('batch.pickup_start')} AS pickup_start,
              ${parisLocal('batch.pickup_end')} AS pickup_end,
              ${parisLocal('reservation.reserved_at')} AS reserved_at,
              ${parisLocal('batch.collected_at')} AS collected_at,
              ${parisLocal('batch.expired_at')} AS expired_at
       ${FROM_WHERE}
       ORDER BY batch.created_at DESC, batch.id DESC
       LIMIT $6 OFFSET $7`,
      [...values, config.pageSize, (pageNumber - 1) * config.pageSize],
    );
    const { rows: accounts } = await db.query(
      `SELECT id, role, organization_name FROM account
       WHERE role IN ('STORE', 'ASSOCIATION') ORDER BY organization_name, id`,
    );

    res.send(monitoringPage({
      batches,
      filters,
      stores: accounts.filter((account) => account.role === 'STORE'),
      associations: accounts.filter((account) => account.role === 'ASSOCIATION'),
      total,
      pageNumber,
      pageCount,
    }));
  });

  return router;
}
