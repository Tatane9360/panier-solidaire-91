import { Router } from 'express';
import { requireRole } from '../../shared/access.js';
import { isDate } from '../../shared/batch-form.js';
import { issueCertificate, selectCollectedBatches } from '../../shared/certificates.js';
import { errorPage } from '../../shared/html.js';
import { certificateFormPage, certificatePage, overlapWarningPage } from './pages.js';

const NOT_FOUND = 'Attestation introuvable.';
const NO_BATCH = 'Aucun lot collecté pour ce commerce dans cette période.';

// Plus de 9 chiffres pourrait dépasser une colonne `integer` : un tel identifiant n'existe pas.
const isId = (id) => /^\d{1,9}$/.test(id);

const parisLocal = (column) => `to_char(${column} AT TIME ZONE 'Europe/Paris', 'YYYY-MM-DD"T"HH24:MI')`;

// Produire et consulter une attestation de don (Coordination).
export function certificatesRoutes({ db, clock, config }) {
  const router = Router();
  const coordinatorOnly = requireRole('COORDINATOR');

  const readStores = async () => (await db.query(
    "SELECT id, organization_name FROM account WHERE role = 'STORE' ORDER BY organization_name, id",
  )).rows;

  router.get('/certificates/new', coordinatorOnly, async (req, res) => {
    res.send(certificateFormPage({ session: req.session, stores: await readStores(), values: {}, errors: {} }));
  });

  // Lots des attestations ISSUED du commerce dont la période chevauche la nouvelle (les REPLACED sont ignorées).
  async function readOverlappingBatches({ storeId, periodStart, periodEnd }) {
    const { rows } = await db.query(
      `SELECT donation_certificate.number, batch.nature, ${parisLocal('batch.collected_at')} AS collected_at
       FROM donation_certificate
       JOIN certificate_batch ON certificate_batch.certificate_id = donation_certificate.id
       JOIN batch ON batch.id = certificate_batch.batch_id
       WHERE donation_certificate.store_id = $1 AND donation_certificate.status = 'ISSUED'
         AND donation_certificate.period_start <= $3::date AND donation_certificate.period_end >= $2::date
       ORDER BY donation_certificate.number, batch.collected_at, batch.id`,
      [storeId, periodStart, periodEnd],
    );
    return rows;
  }

  router.post('/certificates', coordinatorOnly, async (req, res) => {
    const values = {
      store_id: String(req.body.store_id ?? '').trim(),
      period_start: String(req.body.period_start ?? '').trim(),
      period_end: String(req.body.period_end ?? '').trim(),
    };
    const errors = {};
    const { rows: [store] } = isId(values.store_id)
      ? await db.query("SELECT id FROM account WHERE id = $1 AND role = 'STORE'", [values.store_id])
      : { rows: [] };
    if (!store) errors.store_id = 'Choisissez un commerce.';
    if (!isDate(values.period_start)) errors.period_start = 'Date de début invalide.';
    if (!isDate(values.period_end)) errors.period_end = 'Date de fin invalide.';
    else if (!errors.period_start && values.period_end < values.period_start) {
      errors.period_end = 'La fin de la période doit être le même jour ou après le début.';
    }
    const sendErrors = async () => res.status(400).send(
      certificateFormPage({ session: req.session, stores: await readStores(), values, errors }),
    );
    if (Object.keys(errors).length > 0) return sendErrors();

    const period = { storeId: store.id, periodStart: values.period_start, periodEnd: values.period_end };
    if ((await selectCollectedBatches(db, period)).length === 0) {
      errors.period_start = NO_BATCH;
      return sendErrors();
    }
    // Avertissement non bloquant : la Coordination confirme avec le bouton « Produire quand même ».
    if (!req.body.confirm) {
      const batches = await readOverlappingBatches(period);
      if (batches.length > 0) return res.send(overlapWarningPage({ session: req.session, values, batches }));
    }

    const issued = await db.withTransaction((client) => issueCertificate(client, {
      ...period, issuedBy: req.session.account.id, now: clock.now(),
    }));
    // Les lots ont pu changer de statut entre le contrôle et l'émission.
    if (!issued) {
      errors.period_start = NO_BATCH;
      return sendErrors();
    }
    return res.redirect(303, `/certificates/${issued.id}`);
  });

  router.get('/certificates/:id', coordinatorOnly, async (req, res) => {
    if (!isId(req.params.id)) return res.status(404).send(errorPage(NOT_FOUND));
    const { rows: [certificate] } = await db.query(
      `SELECT donation_certificate.number, donation_certificate.status,
              round(donation_certificate.total_weight_kg, 1)::text AS total_weight_kg,
              round(donation_certificate.total_value_eur, 2)::text AS total_value_eur,
              to_char(donation_certificate.period_start, 'YYYY-MM-DD') AS period_start,
              to_char(donation_certificate.period_end, 'YYYY-MM-DD') AS period_end,
              ${parisLocal('donation_certificate.issued_at')} AS issued_at,
              store.organization_name AS store_name, store.address AS store_address
       FROM donation_certificate JOIN account store ON store.id = donation_certificate.store_id
       WHERE donation_certificate.id = $1`,
      [req.params.id],
    );
    if (!certificate) return res.status(404).send(errorPage(NOT_FOUND));
    const { rows: batches } = await db.query(
      `SELECT batch.nature, batch.quantity, batch.quantity_unit, ${parisLocal('batch.collected_at')} AS collected_at,
              round(certificate_batch.weight_kg, 1)::text AS weight_kg,
              round(certificate_batch.value_eur, 2)::text AS value_eur
       FROM certificate_batch JOIN batch ON batch.id = certificate_batch.batch_id
       WHERE certificate_batch.certificate_id = $1
       ORDER BY batch.collected_at, batch.id`,
      [req.params.id],
    );
    return res.send(certificatePage({ certificate, batches, issuer: config.issuer }));
  });

  return router;
}
