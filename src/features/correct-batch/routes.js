import { Router } from 'express';
import { requireRole } from '../../shared/access.js';
import { readForm, toDecimal, validate } from '../../shared/batch-form.js';
import { errorPage } from '../../shared/html.js';
import { releaseReservation } from '../../shared/reservations.js';
import { editBatchPage } from './pages.js';

const NOT_FOUND = 'Lot introuvable.';
const CORRECTABLE = ['DECLARED', 'RESERVED'];
const CANCELLABLE = ['DECLARED', 'RESERVED', 'COLLECTED'];
// Champs corrigeables, dans l'ordre des paramètres de l'UPDATE ($2, $3…).
const FIELDS = [
  'nature', 'quantity', 'quantity_unit', 'weight_kg', 'value_eur', 'expiry_date',
  'date_type', 'pickup_start', 'pickup_end', 'cold_requirement',
];
// Champs numériques : "12.50" et "12.5" sont la même valeur.
const NUMERIC_FIELDS = ['quantity', 'weight_kg', 'value_eur'];

// Plus de 9 chiffres pourrait dépasser une colonne `integer` : un tel lot n'existe pas.
const isBatchId = (id) => /^\d{1,9}$/.test(id);

const parisLocal = (column) => `to_char(${column} AT TIME ZONE 'Europe/Paris', 'YYYY-MM-DD"T"HH24:MI')`;

// Lot avec ses champs au format du formulaire (créneau en heure de Paris).
const SELECT_BATCH = `
  SELECT id, nature, quantity::text, quantity_unit, weight_kg::text, value_eur::text,
         to_char(expiry_date, 'YYYY-MM-DD') AS expiry_date, date_type,
         ${parisLocal('pickup_start')} AS pickup_start, ${parisLocal('pickup_end')} AS pickup_end,
         cold_requirement, status
  FROM batch WHERE id = $1`;

// Refus dans la transaction : code HTTP et message.
class Refused extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function sameValue(field, oldValue, newValue) {
  return NUMERIC_FIELDS.includes(field) ? Number(oldValue) === Number(newValue) : oldValue === newValue;
}

// Corriger ou annuler un lot (Coordination), depuis le suivi. Chaque opération est historisée.
export function correctBatchRoutes({ db, clock }) {
  const router = Router();
  const coordinatorOnly = requireRole('COORDINATOR');

  async function sendForm(res, session, batchId, { values, errors = {}, cancelError, status = 200 }) {
    const { rows: [batch] } = await db.query(SELECT_BATCH, [batchId]);
    if (!batch) return res.status(404).send(errorPage(NOT_FOUND));
    return res.status(status).send(editBatchPage({
      session,
      batch,
      values: values ?? batch,
      errors,
      cancelError,
      correctable: CORRECTABLE.includes(batch.status),
      cancellable: CANCELLABLE.includes(batch.status),
    }));
  }

  // Une ligne par champ modifié, dans la transaction de l'opération.
  function writeHistory(client, { batchId, accountId, field, oldValue, newValue, reason }) {
    return client.query(
      `INSERT INTO batch_history (batch_id, changed_by, changed_at, field, old_value, new_value, reason)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [batchId, accountId, clock.now(), field, oldValue, newValue, reason || null],
    );
  }

  router.get('/monitoring/batches/:id/edit', coordinatorOnly, (req, res) => {
    if (!isBatchId(req.params.id)) return res.status(404).send(errorPage(NOT_FOUND));
    return sendForm(res, req.session, req.params.id, {});
  });

  router.post('/monitoring/batches/:id/edit', coordinatorOnly, async (req, res) => {
    if (!isBatchId(req.params.id)) return res.status(404).send(errorPage(NOT_FOUND));
    const values = readForm(req.body);
    values.reason = String(req.body.reason ?? '').trim();
    const errors = validate(values, clock.now());
    if (Object.keys(errors).length > 0) {
      return sendForm(res, req.session, req.params.id, { values, errors, status: 400 });
    }
    const newValues = Object.fromEntries(FIELDS.map((field) => [
      field,
      NUMERIC_FIELDS.includes(field) ? toDecimal(values[field]) : values[field],
    ]));
    try {
      await db.withTransaction(async (client) => {
        const { rows: [batch] } = await client.query(`${SELECT_BATCH} FOR UPDATE`, [req.params.id]);
        if (!batch) throw new Refused(404, NOT_FOUND);
        if (!CORRECTABLE.includes(batch.status)) throw new Refused(409, 'Ce lot ne peut plus être corrigé.');
        const changed = FIELDS.filter((field) => !sameValue(field, batch[field], newValues[field]));
        if (changed.length === 0) return;
        await client.query(
          `UPDATE batch SET nature = $2, quantity = $3, quantity_unit = $4, weight_kg = $5, value_eur = $6,
                  expiry_date = $7, date_type = $8,
                  pickup_start = $9::timestamp AT TIME ZONE 'Europe/Paris',
                  pickup_end = $10::timestamp AT TIME ZONE 'Europe/Paris',
                  cold_requirement = $11
           WHERE id = $1`,
          [batch.id, ...FIELDS.map((field) => newValues[field])],
        );
        for (const field of changed) {
          await writeHistory(client, {
            batchId: batch.id, accountId: req.session.account.id, field,
            oldValue: batch[field], newValue: newValues[field], reason: values.reason,
          });
        }
      });
    } catch (error) {
      if (!(error instanceof Refused)) throw error;
      return res.status(error.status).send(errorPage(error.message));
    }
    return res.redirect(303, '/monitoring/batches');
  });

  router.post('/monitoring/batches/:id/cancel', coordinatorOnly, async (req, res) => {
    if (!isBatchId(req.params.id)) return res.status(404).send(errorPage(NOT_FOUND));
    const reason = String(req.body.reason ?? '').trim();
    if (!reason) {
      return sendForm(res, req.session, req.params.id, { cancelError: 'Le motif est obligatoire.', status: 400 });
    }
    try {
      await db.withTransaction(async (client) => {
        // Même verrou FOR UPDATE que la réservation : annulation et réservation ne se croisent pas.
        const { rows: [batch] } = await client.query(`${SELECT_BATCH} FOR UPDATE`, [req.params.id]);
        if (!batch) throw new Refused(404, NOT_FOUND);
        if (!CANCELLABLE.includes(batch.status)) throw new Refused(409, 'Ce lot ne peut plus être annulé.');
        const accountId = req.session.account.id;
        if (batch.status === 'RESERVED') {
          await releaseReservation(client, { batchId: batch.id, cancelledBy: accountId, now: clock.now() });
        }
        await client.query("UPDATE batch SET status = 'CANCELLED' WHERE id = $1", [batch.id]);
        await writeHistory(client, {
          batchId: batch.id, accountId, field: 'status', oldValue: batch.status, newValue: 'CANCELLED', reason,
        });
      });
    } catch (error) {
      if (!(error instanceof Refused)) throw error;
      return res.status(error.status).send(errorPage(error.message));
    }
    return res.redirect(303, '/monitoring/batches');
  });

  return router;
}
