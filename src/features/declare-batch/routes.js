import { randomBytes } from 'node:crypto';
import { Router } from 'express';
import { requireRole } from '../../shared/access.js';
import { errorPage } from '../../shared/html.js';
import { batchFormPage, batchReviewPage, myBatchesPage } from './pages.js';

const EXPIRED_FORM = 'Formulaire expiré : recommencez la déclaration';

// Déclarer un lot en 3 actions : ouvrir le formulaire, valider (récapitulatif), confirmer.
export function declareBatchRoutes({ db, clock }) {
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
    // Rien d'inséré : ce formulaire avait déjà servi, on le dit au commerce.
    res.redirect(303, rowCount === 1 ? '/batches?declared=1' : '/batches?duplicate=1');
  });

  return router;
}

const FIELDS = [
  'nature', 'quantity', 'quantity_unit', 'weight_kg', 'value_eur', 'expiry_date',
  'date_type', 'pickup_start', 'pickup_end', 'cold_requirement', 'submission_token',
];

// Les valeurs sont gardées telles que saisies, pour être réaffichées.
function readForm(body) {
  return Object.fromEntries(FIELDS.map((name) => [name, String(body[name] ?? '').trim()]));
}

const REQUIRED = 'Champ obligatoire.';
const CHOOSE = 'Choisissez une option.';
// Plus grande valeur d'une colonne PostgreSQL `integer`.
const MAX_INTEGER = 2_147_483_647;

// Les dates et créneaux saisis sont en heure de Paris : on les compare, en texte
// (format ISO, donc ordre chronologique), à la date et à l'heure de Paris de l'horloge.
function validate(values, now) {
  const errors = {};
  // La locale suédoise (sv-SE) écrit la date au format ISO : "2026-11-02 10:00:00".
  const parisNow = now.toLocaleString('sv-SE', { timeZone: 'Europe/Paris' }).replace(' ', 'T').slice(0, 16);
  const parisToday = parisNow.slice(0, 10);

  if (!values.nature) errors.nature = REQUIRED;
  if (!values.quantity_unit) errors.quantity_unit = REQUIRED;

  if (!values.quantity) errors.quantity = REQUIRED;
  else if (!/^\d+$/.test(values.quantity) || Number(values.quantity) < 1 || Number(values.quantity) > MAX_INTEGER) {
    errors.quantity = 'La quantité doit être un nombre entier supérieur à 0.';
  }

  if (!values.weight_kg) errors.weight_kg = REQUIRED;
  else if (!isPositiveDecimal(values.weight_kg)) errors.weight_kg = 'Le poids doit être un nombre supérieur à 0.';

  if (!values.value_eur) errors.value_eur = REQUIRED;
  else if (!isPositiveDecimal(values.value_eur)) errors.value_eur = 'La valeur doit être un nombre supérieur à 0.';

  if (!values.expiry_date) errors.expiry_date = REQUIRED;
  else if (!isDate(values.expiry_date)) errors.expiry_date = 'Date invalide.';
  else if (values.expiry_date < parisToday) errors.expiry_date = 'La date limite est déjà passée.';

  if (!['DLC', 'DDM'].includes(values.date_type)) errors.date_type = CHOOSE;
  if (!['AMBIENT', 'CHILLED', 'FROZEN'].includes(values.cold_requirement)) errors.cold_requirement = CHOOSE;

  if (!values.pickup_start) errors.pickup_start = REQUIRED;
  else if (!isDateTime(values.pickup_start)) errors.pickup_start = 'Date et heure invalides.';

  if (!values.pickup_end) errors.pickup_end = REQUIRED;
  else if (!isDateTime(values.pickup_end)) errors.pickup_end = 'Date et heure invalides.';
  else if (!errors.pickup_start && values.pickup_end <= values.pickup_start) {
    errors.pickup_end = 'La fin du créneau doit être après son début.';
  } else if (values.pickup_end <= parisNow) {
    errors.pickup_end = 'Le créneau de retrait est déjà terminé.';
  } else if (!errors.expiry_date && values.pickup_end.slice(0, 10) > values.expiry_date) {
    errors.pickup_end = 'Le créneau doit se terminer au plus tard le jour de la date limite.';
  }
  return errors;
}

function isPositiveDecimal(value) {
  return /^\d+([.,]\d+)?$/.test(value) && Number(toDecimal(value)) > 0;
}

// "2026-11-05" : on écarte aussi les dates inexistantes (31 février…).
function isDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}

// "2026-11-03T14:00", format envoyé par <input type="datetime-local">.
function isDateTime(value) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return false;
  const date = new Date(`${value}:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}

function isSubmissionToken(value) {
  return /^[0-9a-f]{32}$/.test(value);
}

// Le poids et la valeur acceptent la virgule française.
function toDecimal(value) {
  return value.replace(',', '.');
}
