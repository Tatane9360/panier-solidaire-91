// Lecture et contrôles du formulaire d'un lot, partagés par la déclaration (commerce) et la correction (Coordination).
export const FIELDS = [
  'nature', 'quantity', 'quantity_unit', 'weight_kg', 'value_eur', 'expiry_date',
  'date_type', 'pickup_start', 'pickup_end', 'cold_requirement', 'submission_token',
];

// Les valeurs sont gardées telles que saisies, pour être réaffichées.
export function readForm(body) {
  return Object.fromEntries(FIELDS.map((name) => [name, String(body[name] ?? '').trim()]));
}

const REQUIRED = 'Champ obligatoire.';
const CHOOSE = 'Choisissez une option.';
// Plus grande valeur d'une colonne PostgreSQL `integer`.
const MAX_INTEGER = 2_147_483_647;

// Les dates et créneaux saisis sont en heure de Paris : on les compare, en texte
// (format ISO, donc ordre chronologique), à la date et à l'heure de Paris de l'horloge.
export function validate(values, now) {
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
export function isDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}

// "2026-11-03T14:00", format envoyé par <input type="datetime-local">.
export function isDateTime(value) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return false;
  const date = new Date(`${value}:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}

export function isSubmissionToken(value) {
  return /^[0-9a-f]{32}$/.test(value);
}

// Le poids et la valeur acceptent la virgule française.
export function toDecimal(value) {
  return value.replace(',', '.');
}
