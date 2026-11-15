import { randomBytes } from 'node:crypto';
import { Router } from 'express';
import { requireRole } from '../../shared/access.js';
import { errorPage, formatDecimal, formatLocal } from '../../shared/html.js';
import { isSubmissionToken, readForm, toDecimal, validate } from '../../shared/batch-form.js';
import { batchFormPage, batchReviewPage, myBatchesPage } from './pages.js';

const EXPIRED_FORM = 'Formulaire expiré : recommencez la déclaration';

// Déclarer un lot en 3 actions : ouvrir le formulaire, valider (récapitulatif), confirmer.
export function declareBatchRoutes({ db, notifications, clock }) {
  const router = Router();
  const storeOnly = requireRole('STORE');

  router.get('/batches', storeOnly, async (req, res) => {
    const { rows } = await db.query(
      `SELECT batch.nature, batch.quantity, batch.quantity_unit, batch.weight_kg, batch.value_eur,
              to_char(batch.expiry_date, 'YYYY-MM-DD') AS expiry_date, batch.date_type,
              to_char(batch.pickup_start AT TIME ZONE 'Europe/Paris', 'YYYY-MM-DD"T"HH24:MI') AS pickup_start,
              to_char(batch.pickup_end AT TIME ZONE 'Europe/Paris', 'YYYY-MM-DD"T"HH24:MI') AS pickup_end,
              batch.cold_requirement, batch.status, reservation.reserved_by_name, reservation.collected_by_name,
              to_char(batch.collected_at AT TIME ZONE 'Europe/Paris', 'YYYY-MM-DD"T"HH24:MI') AS collected_at
       FROM batch
       LEFT JOIN reservation ON reservation.batch_id = batch.id AND reservation.cancelled_at IS NULL
       WHERE batch.store_id = $1
       ORDER BY batch.created_at DESC, batch.id DESC`,
      [req.session.account.id],
    );
    res.send(myBatchesPage({
      session: req.session,
      batches: rows,
      declared: req.query.declared === '1',
      duplicate: req.query.duplicate === '1',
    }));
  });

  // Le jeton de soumission suit le formulaire jusqu'à la confirmation.
  router.get('/batches/new', storeOnly, (req, res) => {
    const values = { submission_token: randomBytes(16).toString('hex') };
    res.send(batchFormPage({ session: req.session, values, errors: {} }));
  });

  // « Valider » : erreurs → formulaire ; sinon récapitulatif. « Modifier » revient au formulaire.
  router.post('/batches/review', storeOnly, (req, res) => {
    const values = readForm(req.body);
    if (!isSubmissionToken(values.submission_token)) {
      return res.status(400).send(errorPage(EXPIRED_FORM));
    }
    if (req.body.edit) {
      return res.send(batchFormPage({ session: req.session, values, errors: {} }));
    }
    const errors = validate(values, clock.now());
    if (Object.keys(errors).length > 0) {
      return res.status(400).send(batchFormPage({ session: req.session, values, errors }));
    }
    res.send(batchReviewPage({ session: req.session, values }));
  });

  // « Confirmer » : les champs cachés du récapitulatif sont revérifiés.
  router.post('/batches', storeOnly, async (req, res) => {
    const values = readForm(req.body);
    if (!isSubmissionToken(values.submission_token)) {
      return res.status(400).send(errorPage(EXPIRED_FORM));
    }
    const errors = validate(values, clock.now());
    if (Object.keys(errors).length > 0) {
      return res.status(400).send(batchFormPage({ session: req.session, values, errors }));
    }

    // L'index unique sur submission_token tranche : une double soumission ne crée qu'un lot.
    const { rowCount } = await db.query(
      `INSERT INTO batch (store_id, nature, quantity, quantity_unit, weight_kg, value_eur,
                          expiry_date, date_type, pickup_start, pickup_end, cold_requirement,
                          status, submission_token, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8,
               $9::timestamp AT TIME ZONE 'Europe/Paris', $10::timestamp AT TIME ZONE 'Europe/Paris',
               $11, 'DECLARED', $12, $13)
       ON CONFLICT (submission_token) DO NOTHING`,
      [
        req.session.account.id,
        values.nature,
        Number(values.quantity),
        values.quantity_unit,
        toDecimal(values.weight_kg),
        toDecimal(values.value_eur),
        values.expiry_date,
        values.date_type,
        values.pickup_start,
        values.pickup_end,
        values.cold_requirement,
        values.submission_token,
        clock.now(),
      ],
    );
    // Rien d'inséré : ce formulaire avait déjà servi, on le dit au commerce, sans nouvelle notification.
    // Le lot est enregistré : une panne pendant la notification ne doit pas faire croire l'inverse au commerce.
    if (rowCount === 1) {
      await notifyAssociations(values, req.session.account.id)
        .catch((error) => console.error('Notification « Nouveau lot disponible » :', error));
    }
    res.redirect(303, rowCount === 1 ? '/batches?declared=1' : '/batches?duplicate=1');
  });

  // Associations actives qui savent garder le lot au bon niveau de froid ;
  // chacune est prévenue sur ses appareils abonnés.
  async function notifyAssociations(values, storeId) {
    const { rows } = await db.query(
      `SELECT id FROM account
       WHERE role = 'ASSOCIATION' AND status = 'ACTIVE' AND $1 = ANY (cold_capacity)`,
      [values.cold_requirement],
    );
    const { rows: [store] } = await db.query('SELECT organization_name FROM account WHERE id = $1', [storeId]);
    await notifications.newBatchAvailable({
      associationIds: rows.map((row) => row.id),
      nature: values.nature,
      weightKg: formatDecimal(toDecimal(values.weight_kg)),
      expiryDate: formatLocal(values.expiry_date),
      pickupStart: formatLocal(values.pickup_start),
      pickupEnd: formatLocal(values.pickup_end),
      store: store.organization_name,
    });
  }

  return router;
}
