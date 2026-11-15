// Émission d'une attestation de don, partagée entre `certificates` (émission) et `monitoring`
// (annule et remplace, ticket suivant). À appeler dans une transaction ; ne modifie jamais
// une attestation existante.

// Verrou d'émission : toutes les émissions passent l'une après l'autre. Le numéro de séquence
// est ainsi calculé sans doublon, et deux émissions pour le même commerce ne se croisent pas.
const ISSUE_LOCK_KEY = 91_001;

// Période en dates calendaires de Paris, bornes incluses : de 00 h 00 le premier jour
// (compris) à 00 h 00 le lendemain du dernier jour (exclu).
const PERIOD_WHERE = `
  batch.store_id = $1 AND batch.status = 'COLLECTED'
  AND batch.collected_at >= $2::date::timestamp AT TIME ZONE 'Europe/Paris'
  AND batch.collected_at < ($3::date + 1)::timestamp AT TIME ZONE 'Europe/Paris'`;

// Lots collectés du commerce dans la période, du plus ancien au plus récent.
export async function selectCollectedBatches(client, { storeId, periodStart, periodEnd }) {
  const { rows } = await client.query(
    `SELECT batch.id, batch.weight_kg, batch.value_eur FROM batch
     WHERE ${PERIOD_WHERE} ORDER BY batch.collected_at, batch.id`,
    [storeId, periodStart, periodEnd],
  );
  return rows;
}

// Émet une attestation et renvoie { id, number }, ou null s'il n'y a aucun lot à attester.
// Poids et valeur sont copiés dans certificate_batch : ils ne changent plus ensuite.
export async function issueCertificate(client, { storeId, periodStart, periodEnd, issuedBy, now }) {
  await client.query('SELECT pg_advisory_xact_lock($1)', [ISSUE_LOCK_KEY]);
  const batches = await selectCollectedBatches(client, { storeId, periodStart, periodEnd });
  if (batches.length === 0) return null;

  // Numéro PS91-AAAA-NNNN : année d'émission en heure de Paris, séquence remise à 1 chaque année.
  const { rows: [{ number }] } = await client.query(
    `SELECT 'PS91-' || year || '-' || lpad((coalesce(max(substr(number, 11)::int), 0) + 1)::text, 4, '0') AS number
     FROM (SELECT to_char($1::timestamptz AT TIME ZONE 'Europe/Paris', 'YYYY') AS year) AS issue
     LEFT JOIN donation_certificate ON donation_certificate.number LIKE 'PS91-' || issue.year || '-%'
     GROUP BY year`,
    [now],
  );
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
      'INSERT INTO certificate_batch (certificate_id, batch_id, weight_kg, value_eur) VALUES ($1, $2, $3, $4)',
      [id, batch.id, batch.weight_kg, batch.value_eur],
    );
  }
  return { id, number };
}
