// Une ligne de l'historique d'un lot (correction, annulation, collecte tardive par la Coordination).
// À appeler dans la transaction de l'opération, avec l'heure de l'horloge injectée.
export function writeHistory(client, { batchId, accountId, changedAt, field, oldValue, newValue, reason }) {
  return client.query(
    `INSERT INTO batch_history (batch_id, changed_by, changed_at, field, old_value, new_value, reason)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [batchId, accountId, changedAt, field, oldValue, newValue, reason || null],
  );
}
