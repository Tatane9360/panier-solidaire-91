// Passage des lots à EXPIRED, réservé au Planificateur (src/features/expire-batches/).
// Un lot réservé garde sa réservation active : seule une collecte peut encore le faire changer.
export async function expireEndedBatches(db, now) {
  await db.query(
    "UPDATE batch SET status = 'EXPIRED', expired_at = $1 WHERE status IN ('DECLARED', 'RESERVED') AND pickup_end <= $1",
    [now],
  );
}
