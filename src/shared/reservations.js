// Libération d'une réservation, partagée entre l'association (annuler sa réservation)
// et la Coordination (annuler un lot réservé). La réservation est conservée :
// cancelled_at la met de côté et libère l'index unique partiel pour une nouvelle réservation.
// À appeler dans la transaction qui verrouille le lot ; le statut du lot reste à l'appelant.
export async function releaseReservation(client, { batchId, cancelledBy, now }) {
  await client.query(
    'UPDATE reservation SET cancelled_by = $1, cancelled_at = $2 WHERE batch_id = $3 AND cancelled_at IS NULL',
    [cancelledBy, now, batchId],
  );
}
