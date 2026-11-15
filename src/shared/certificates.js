// Émission d'une attestation de don, partagée entre `certificates` (émission) et `monitoring`
// (annule et remplace, ticket suivant). À appeler dans une transaction ; ne modifie jamais
// une attestation existante.

// Verrou d'émission : toutes les émissions passent l'une après l'autre. Le numéro de séquence
// est ainsi calculé sans doublon, et deux émissions pour le même commerce ne se croisent pas.
const ISSUE_LOCK_KEY = 91_001;

// Période en dates calendaires de Paris, bornes incluses : de 00 h 00 le premier jour
// (compris) à 00 h 00 le lendemain du dernier jour (exclu).
export const PERIOD_WHERE = `
  batch.store_id = $1 AND batch.status = 'COLLECTED'
  AND batch.collected_at >= $2::date::timestamp AT TIME ZONE 'Europe/Paris'
  AND batch.collected_at < ($3::date + 1)::timestamp AT TIME ZONE 'Europe/Paris'`;

// Lots collectés du commerce dans la période, du plus ancien au plus récent.
export async function selectCollectedBatches(client, { storeId, periodStart, periodEnd }) {
  const { rows } = await client.query(
    `SELECT batch.id, batch.nature, batch.quantity, batch.quantity_unit, batch.weight_kg, batch.value_eur FROM batch
     WHERE ${PERIOD_WHERE} ORDER BY batch.collected_at, batch.id`,
    [storeId, periodStart, periodEnd],
  );
  return rows;
}

// Émet une attestation et renvoie { id, number }, ou null s'il n'y a aucun lot à attester.
// Nature, quantité, poids et valeur sont copiés dans certificate_batch : ils ne changent plus ensuite.
export async function issueCertificate(client, { storeId, periodStart, periodEnd, issuedBy, now }) {
  await client.query('SELECT pg_advisory_xact_lock($1)', [ISSUE_LOCK_KEY]);
  const batches = await selectCollectedBatches(client, { storeId, periodStart, periodEnd });
  if (batches.length === 0) return null;

  // Numéro PS91-AAAA-NNNN : année d'émission en heure de Paris, séquence remise à 1 chaque année.
  // Sous le verrou, le nombre d'attestations déjà émises cette année donne le numéro suivant.
  const { rows: [{ year }] } = await client.query(
    "SELECT to_char($1::timestamptz AT TIME ZONE 'Europe/Paris', 'YYYY') AS year", [now],
  );
  const { rows: [{ issued }] } = await client.query(
    'SELECT count(*)::int AS issued FROM donation_certificate WHERE number LIKE $1', [`PS91-${year}-%`],
  );
  const number = `PS91-${year}-${String(issued + 1).padStart(4, '0')}`;
  // Les totaux sont sommés par PostgreSQL (numeric exact), pas en JavaScript (virgule flottante).
  const { rows: [totals] } = await client.query(
    `SELECT sum(batch.weight_kg) AS weight_kg, sum(batch.value_eur) AS value_eur FROM batch WHERE ${PERIOD_WHERE}`,
    [storeId, periodStart, periodEnd],
  );
  const { rows: [{ id }] } = await client.query(
    `INSERT INTO donation_certificate (number, store_id, issued_by, period_start, period_end,
                                       total_weight_kg, total_value_eur, issued_at, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'ISSUED')
     RETURNING id`,
    [number, storeId, issuedBy, periodStart, periodEnd, totals.weight_kg, totals.value_eur, now],
  );
  for (const batch of batches) {
    await client.query(
      `INSERT INTO certificate_batch (certificate_id, batch_id, nature, quantity, quantity_unit, weight_kg, value_eur)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [id, batch.id, batch.nature, batch.quantity, batch.quantity_unit, batch.weight_kg, batch.value_eur],
    );
  }
  return { id, number };
}

// Levée quand une opération change des attestations émises et que la Coordination n'a pas encore
// confirmé : la transaction est annulée, la route affiche l'avertissement.
export class ReplacementNeeded extends Error {
  constructor(certificates) {
    super('Des attestations émises seraient changées.');
    this.certificates = certificates;
  }
}

// Une attestation dit la même chose que les lots : mêmes lots, même poids, même valeur.
const signature = (rows) => rows.map((row) => `${row.batch_id ?? row.id}:${Number(row.weight_kg)}:${Number(row.value_eur)}`).sort().join('|');

// Attestations ISSUED du commerce dont le contenu figé ne correspond plus aux lots collectés de leur période.
async function findStaleCertificates(client, storeId) {
  const { rows: issued } = await client.query(
    `SELECT id, number, to_char(period_start, 'YYYY-MM-DD') AS period_start, to_char(period_end, 'YYYY-MM-DD') AS period_end
     FROM donation_certificate WHERE store_id = $1 AND status = 'ISSUED' ORDER BY id`,
    [storeId],
  );
  const stale = [];
  for (const certificate of issued) {
    const { rows: frozen } = await client.query(
      'SELECT batch_id, weight_kg, value_eur FROM certificate_batch WHERE certificate_id = $1', [certificate.id],
    );
    const current = await selectCollectedBatches(client, {
      storeId, periodStart: certificate.period_start, periodEnd: certificate.period_end,
    });
    if (signature(frozen) !== signature(current)) stale.push(certificate);
  }
  return stale;
}

// « Annule et remplace » : à appeler dans la transaction de l'opération, une fois le changement écrit.
// Sans confirmation, lève ReplacementNeeded. Avec confirmation, chaque attestation touchée passe REPLACED
// (replaced_by = la nouvelle) ; s'il ne reste aucun lot, elle passe REPLACED sans remplaçante.
export async function replaceStaleCertificates(client, { storeId, confirmed, issuedBy, now }) {
  // Même verrou que l'émission, pris avant la détection : deux opérations simultanées ne remplacent pas deux fois la même attestation.
  await client.query('SELECT pg_advisory_xact_lock($1)', [ISSUE_LOCK_KEY]);
  const stale = await findStaleCertificates(client, storeId);
  if (stale.length === 0) return;
  if (!confirmed) throw new ReplacementNeeded(stale);
  for (const old of stale) {
    const replacement = await issueCertificate(client, {
      storeId, periodStart: old.period_start, periodEnd: old.period_end, issuedBy, now,
    });
    await client.query(
      "UPDATE donation_certificate SET status = 'REPLACED', replaced_by = $2 WHERE id = $1",
      [old.id, replacement?.id ?? null],
    );
  }
}
